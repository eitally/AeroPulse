import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CockpitHeader } from '../src/components/CockpitHeader';
import { MobileDock } from '../src/components/MobileDock';
import { CoachPracticeHome } from '../src/components/coach/CoachPracticeHome';
import { CoachClipboardWorkoutBuilder } from '../src/components/CoachClipboardWorkoutBuilder';
import { buildSampleDemoCoachSquad } from '../src/data/sampleDemoData';
import { buildCompleteAthleteProfile } from '../src/utils/telemetryStorage';

const ROOT = process.cwd();

describe('Phase 2 Track A: Clean 3-Section Coach Home & Dedicated Workouts Screen', () => {
  it('renders 5-tab Coach navigation (Home, Workouts, Meets & Plan, Timing, Team) on desktop header and mobile dock', () => {
    const squad = buildSampleDemoCoachSquad('2026-11-23');
    const headerHtml = renderToStaticMarkup(
      React.createElement(CockpitHeader, {
        activeTab: 'coach',
        setActiveTab: () => {},
        coachSubTab: 'CLIPBOARD',
        onSelectCoachSubTab: () => {},
        activeTeam: squad,
        myTeams: [squad],
        activeTeamId: squad.brand.teamId,
        onSelectActiveTeam: () => {},
        onOpenRosterModalWithTab: () => {},
        syncLiveTelemetry: async () => {},
        isSyncing: false,
        latestWellness: null,
        envFilter: 'COMBINED',
        setEnvFilter: () => {},
        selectedSport: 'ALL',
        setSelectedSport: () => {},
        lastProgressTab: 'curves',
        activeViewedAthleteId: 'SELF',
        setActiveViewedAthleteId: () => {},
        setSelectedActivity: () => {},
        primaryAthleteDisplayName: 'Coach Morales',
        primaryAthleteInitials: 'CM',
        combinedRoster: [],
        anySourceConnected: false,
        onOpenDataSources: () => {},
        onOpenCoach: () => {},
        onOpenTeamMessages: () => {},
        isDark: false,
        onToggleDark: () => {},
        currentUser: null,
        effectiveActivities: [],
        effectiveAthleteProfile: buildCompleteAthleteProfile({}),
        onOpenProfileModal: () => {},
        onOpenGuide: () => {},
        distanceUnit: 'mi',
        setDistanceUnit: () => {},
        isSampleDemoMode: false,
        onLogoutSession: () => {},
        onLogoutAndClearData: async () => {},
      })
    );

    expect(headerHtml).toContain('data-testid="coach-subtab-clipboard"');
    expect(headerHtml).toContain('data-testid="coach-subtab-workouts"');
    expect(headerHtml).toContain('data-testid="coach-subtab-team_plan"');
    expect(headerHtml).toContain('data-testid="coach-subtab-stopwatch"');
    expect(headerHtml).toContain('data-testid="coach-subtab-roster"');
    expect(headerHtml).toContain('>Home<');
    expect(headerHtml).toContain('>Workouts<');
    expect(headerHtml).toContain('>Meets &amp; Plan<');

    const dockHtml = renderToStaticMarkup(
      React.createElement(MobileDock, {
        activeTab: 'coach',
        onSelectTab: () => {},
        coachSubTab: 'WORKOUTS',
        onSelectCoachSubTab: () => {},
      })
    );
    expect(dockHtml).toContain('grid-cols-5');
    expect(dockHtml).toContain('data-testid="mobile-dock-coach-clipboard"');
    expect(dockHtml).toContain('data-testid="mobile-dock-coach-workouts"');
    expect(dockHtml).toContain('data-testid="mobile-dock-coach-team_plan"');
    expect(dockHtml).toContain('data-testid="mobile-dock-coach-stopwatch"');
    expect(dockHtml).toContain('data-testid="mobile-dock-coach-roster"');
  });

  it('keeps Coach Home first glance strictly scoped to (1) panel links, (2) alerts, and (3) messaging without Roll Call or Workout Builder', () => {
    const squad = {
      ...buildSampleDemoCoachSquad('2026-11-23'),
      announcements: [
        {
          id: 'ann-weather-1',
          teamId: 'demo',
          title: 'Lightning Shelter 30m Delay',
          body: 'Clear track immediately.',
          category: 'WEATHER' as const,
          authorName: 'Coach Morales',
          publishToParentHub: true,
          createdAt: '2026-11-23T14:00:00Z',
        },
      ],
      teamMessages: [
        {
          id: 'msg-1',
          teamId: 'demo',
          channelId: 'all-team',
          channelScope: 'ALL_TEAM' as const,
          senderSid: 'coach-1',
          senderMembershipId: 'mem-coach',
          senderName: 'Coach Morales',
          senderRole: 'HEAD_COACH' as const,
          body: 'Dynamic warmup on infield turf at 3:15 PM.',
          createdAt: '2026-11-23T13:30:00Z',
          guardianCcApplied: false,
          secondAdultVisible: true,
        },
      ],
    };

    const html = renderToStaticMarkup(
      React.createElement(CoachPracticeHome, {
        todayIso: '2026-11-23',
        activeTeam: squad,
        myTeams: [squad],
        connectedAthletesOnly: [],
        scopedConnectedAthletes: [],
        complexityTier: 'ESSENTIALS',
        flaggedTriageCount: 2,
        effectivePendingTimingCount: 1,
        upcomingConflictCount: 1,
        onTeamsUpdated: () => {},
        onOpenStopwatch: () => {},
        onOpenWorkoutsTab: () => {},
        onOpenMeetDayTab: () => {},
        onOpenDelegateModal: () => {},
        onOpenHealthAttention: () => {},
        onOpenRosterTab: () => {},
        onOpenSetupWizard: () => {},
        onOpenCreateTeamStudio: () => {},
        onOpenTeamMessages: () => {},
      })
    );

    // 1. Links to functional panels
    expect(html).toContain('data-testid="coach-quick-ops-strip"');
    expect(html).toContain('data-testid="quick-ops-stopwatch-btn"');
    expect(html).toContain('data-testid="quick-ops-workouts-btn"');
    expect(html).toContain('data-testid="quick-ops-roll-call-btn"');
    expect(html).toContain('data-testid="quick-ops-field-marks-btn"');
    expect(html).toContain('data-testid="quick-ops-meet-day-btn"');
    expect(html).toContain('data-testid="quick-ops-delegate-timing-btn"');

    // 2. Alerts
    expect(html).toContain('data-testid="coach-home-alerts"');
    expect(html).toContain('Lightning Shelter 30m Delay');
    expect(html).toContain('data-testid="coach-home-rsvp-alert"');

    // 3. Messaging
    expect(html).toContain('data-testid="coach-home-messaging"');
    expect(html).toContain('Dynamic warmup on infield turf');

    // Roll Call roster table, Weather Alert composer, and Workout Builder must NOT render on first glance
    expect(html).not.toContain('data-testid="roll-call-save-btn"');
    expect(html).not.toContain('data-testid="weather-alert-title-input"');
    expect(html).not.toContain('data-testid="coach-clipboard-builder"');
  });

  it('wires dedicated WORKOUTS screen in CoachWorkspaceView and Roll Call sub-pane inside CoachPracticeHome', () => {
    const workspaceSrc = fs.readFileSync(
      path.join(ROOT, 'src/components/CoachWorkspaceView.tsx'),
      'utf8'
    );
    const homeSrc = fs.readFileSync(
      path.join(ROOT, 'src/components/coach/CoachPracticeHome.tsx'),
      'utf8'
    );

    expect(workspaceSrc).toContain("subTab === 'WORKOUTS'");
    expect(workspaceSrc).toContain('data-testid="coach-workouts-screen"');
    expect(homeSrc).toContain("homePane === 'ROLL_CALL'");
    expect(homeSrc).toContain('data-testid="coach-back-to-home-btn"');
    expect(homeSrc).toContain('todayRsvpsByMemberId={todayRsvpsByMemberId}');

    const squad = buildSampleDemoCoachSquad('2026-11-23');
    const builderHtml = renderToStaticMarkup(
      React.createElement(CoachClipboardWorkoutBuilder, {
        activeTeam: squad,
        myTeams: [squad],
        connectedAthletes: [],
        primaryAthleteDisplayName: 'Coach Morales',
        selfProfile: buildCompleteAthleteProfile({}),
        complexityTier: 'ESSENTIALS',
        onTeamsUpdated: () => {},
        onCreatePlannedEvent: async () => {},
        onOpenStopwatchSubTab: () => {},
      })
    );
    expect(builderHtml).toContain('data-testid="coach-clipboard-builder"');
    expect(builderHtml).toContain('Clipboard Builder &amp; Pods');
  });
});
