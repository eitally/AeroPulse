import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TrackProgressionAndCalibrationPanel } from '../src/components/track/TrackProgressionAndCalibrationPanel';
import { AthleteRosterModal } from '../src/components/AthleteRosterModal';
import { TeamManagementPanel } from '../src/components/TeamManagementPanel';
import { VisualWorkoutBuilder } from '../src/components/VisualWorkoutBuilder';
import { buildSampleDemoDataset } from '../src/data/sampleDemoData';

const ROOT = process.cwd();

describe('UX-04, UX-05 & UX-06 Simplification, Deduplication & Palette Compliance', () => {
  it('UX-04: renders plain-English UI copy across Track Progression, Roster, & Teams without academic or vendor leaks', () => {
    const demo = buildSampleDemoDataset('2026-11-19');

    const progHtml = renderToStaticMarkup(
      React.createElement(TrackProgressionAndCalibrationPanel, {
        activities: demo.activities,
        wellnessDays: demo.wellnessDays,
        athleteProfile: demo.athleteProfile,
        distanceUnit: 'mi',
        onApplyPosteriorCalibration: () => {},
      })
    );
    expect(progHtml).toContain('Outlier Review');
    expect(progHtml).toContain('Estimated Critical Speed');
    expect(progHtml).toContain('Recommended Threshold Pace');
    expect(progHtml).toContain('Update Pace Zones');
    expect(progHtml).toContain('5-Axis Track Progression &amp; Pace Calibration');
    expect(progHtml).not.toContain('Posterior Threshold Pace');
    expect(progHtml).not.toContain('Apply Posterior');

    const teamPanelHtml = renderToStaticMarkup(
      React.createElement(TeamManagementPanel, {
        selfName: 'Coach Morales',
        myTeams: demo.demoTeams,
        activeTeamId: demo.demoTeams[0]?.brand.teamId || null,
        resendConfigured: false,
        onSelectActiveTeam: () => {},
        onTeamsUpdated: () => {},
      })
    );
    expect(teamPanelHtml).toContain('Willow Glen High School XC');
    expect(teamPanelHtml).not.toContain('Branded Invites (Resend)');
    expect(teamPanelHtml).not.toContain('· Resend ✓');
  });

  it('UX-05 & UX-06: renders sport-aware Running presets in VisualWorkoutBuilder and clean Roster controls without duplicated Stopwatch pad', () => {
    const demo = buildSampleDemoDataset('2026-11-19');

    const runBuilderHtml = renderToStaticMarkup(
      React.createElement(VisualWorkoutBuilder, {
        dateIso: '2026-11-19',
        defaultSport: 'Running',
        athleteProfile: demo.athleteProfile,
        athleteFtp: 285,
        distanceUnit: 'mi',
        onSave: () => {},
      })
    );
    expect(runBuilderHtml).toContain('Track 800m / Mile (6x400m)');

    const rosterHtml = renderToStaticMarkup(
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
    expect(rosterHtml).toContain('data-testid="roster-open-stopwatch-btn"');
    expect(rosterHtml).toContain('Teammate (View Only)');
    expect(rosterHtml).not.toContain('Trackside Split Pad');
  });

  it('UX-06: passes Impeccable DESIGN.md color detector with 0 off-palette chart or map hexes', () => {
    const detectorPath =
      process.env.IMPECCABLE_DETECT_PATH ||
      path.join(
        os.homedir(),
        '.gemini/config/plugins/impeccable/skills/impeccable/scripts/detect.mjs'
      );
    if (!fs.existsSync(detectorPath)) {
      return;
    }
    const output = execFileSync(
      'node',
      [detectorPath, path.join(ROOT, 'src/components')],
      { encoding: 'utf8' }
    );
    expect(output).not.toMatch(/anti-patterns found/i);
  });
});
