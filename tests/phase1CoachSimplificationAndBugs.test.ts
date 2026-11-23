import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CockpitHeader } from '../src/components/CockpitHeader';
import { CoachWorkspaceView } from '../src/components/CoachWorkspaceView';
import { CoachDeskDrawer } from '../src/components/coach/CoachDeskDrawer';
import {
  CoachClipboardWorkoutBuilder,
  shouldDefaultExpandWorkoutLibrary,
} from '../src/components/CoachClipboardWorkoutBuilder';
import {
  MeetDayHeatAndFlightModal,
  buildChronologicalScheduleBlocks,
} from '../src/components/coach/MeetDayHeatAndFlightModal';
import { TeamMessagingDrawer } from '../src/components/coach/TeamMessagingDrawer';
import { buildSampleDemoCoachSquad } from '../src/data/sampleDemoData';
import type { MeetEntryRecord } from '../src/physiology/meetDayOpsEngine';
import type { TeamSummaryWithRole } from '../src/types';
import { buildCompleteAthleteProfile } from '../src/utils/telemetryStorage';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Phase 1B & 1C: Coach Mode Simplification & Critical Trackside Field Fixes', () => {
  it('renders 1-line coach-compact-header and keeps Desk admin/setup triggers inside CoachDeskDrawer', () => {
    const squad = buildSampleDemoCoachSquad('2026-11-23');
    const coachHtml = renderToStaticMarkup(
      React.createElement(CoachWorkspaceView, {
        subTab: 'CLIPBOARD',
        setSubTab: () => {},
        activeTeam: squad,
        myTeams: [squad],
        activeTeamId: squad.brand.teamId,
        onSelectActiveTeam: () => {},
        combinedRoster: [],
        activeViewedAthleteId: 'SELF',
        onSelectAthleteViewport: () => {},
        primaryAthleteDisplayName: 'Coach Morales',
        selfProfile: buildCompleteAthleteProfile({}),
        athleteFtp: 280,
        effectivePlannedEvents: [],
        effectiveActivities: [],
        effectiveWellnessDays: [],
        effectiveTargetGoals: [],
        envFilter: 'COMBINED',
        selectedSport: 'ALL',
        onSelectSport: () => {},
        distanceUnit: 'mi',
        resendConfigured: false,
        onTeamsUpdated: () => {},
        onSelectActivityAndOpenTab: () => {},
        onCreatePlannedEvent: async () => {},
        onDeletePlannedEvent: async () => {},
        onBatchCreatePlannedEvents: async () => {},
        onOpenProfileModal: () => {},
        onOpenGoalsTab: () => {},
        onOpenOfficialRaceModal: () => {},
        onOpenCoachWithPrompt: () => {},
        onSaveStopwatchActivities: () => 0,
        onOpenAthleteToday: () => {},
        onOpenRosterModal: () => {},
      })
    );

    expect(coachHtml).toContain('data-testid="coach-compact-header"');
    expect(coachHtml).toContain('data-testid="coach-open-meet-packet-btn"');
    expect(coachHtml).toContain('data-testid="coach-open-injury-hub-btn"');
    expect(coachHtml).toContain('data-testid="coach-desk-menu-btn"');

    // Admin/setup triggers are moved out of the persistent header into Desk drawer
    expect(coachHtml).not.toContain('data-testid="coach-open-wizard-btn"');
    expect(coachHtml).not.toContain('data-testid="coach-open-external-sync-btn"');
    expect(coachHtml).not.toContain('data-testid="coach-open-cohort-plan-builder"');
    expect(coachHtml).not.toContain('data-testid="coach-open-district-ad-btn"');
    expect(coachHtml).not.toContain('data-testid="coach-open-guide-btn"');

    const deskHtml = renderToStaticMarkup(
      React.createElement(CoachDeskDrawer, {
        isOpen: true,
        onClose: () => {},
        activeTeam: squad,
        myTeams: [squad],
        activeTeamId: squad.brand.teamId,
        onSelectActiveTeam: () => {},
        complexityTier: 'ESSENTIALS',
        onSetComplexityTier: () => {},
        onOpenWizard: () => {},
        onOpenCohortPlanBuilder: () => {},
        onOpenExternalSync: () => {},
        onOpenDistrictOverview: () => {},
        onOpenCoachGuide: () => {},
        onOpenTeamStaffTab: () => {},
        onOpenProfileModal: () => {},
      })
    );

    expect(deskHtml).toContain('data-testid="coach-desk-drawer"');
    expect(deskHtml).toContain('data-testid="coach-complexity-essentials"');
    expect(deskHtml).toContain('data-testid="coach-complexity-pro"');
    expect(deskHtml).toContain('data-testid="coach-open-cohort-plan-builder"');
    expect(deskHtml).toContain('data-testid="coach-open-external-sync-btn"');
    expect(deskHtml).toContain('data-testid="coach-open-wizard-btn"');
    expect(deskHtml).toContain('data-testid="coach-open-district-ad-btn"');
    expect(deskHtml).toContain('data-testid="coach-open-guide-btn"');
  });

  it('collapses CoachClipboard library by default across viewports and hides multisport library chips on Track/XC squads', () => {
    expect(shouldDefaultExpandWorkoutLibrary(390)).toBe(false);
    expect(shouldDefaultExpandWorkoutLibrary(1440)).toBe(false);

    const squad = buildSampleDemoCoachSquad('2026-11-23');
    const stubStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
    vi.stubGlobal('window', { innerWidth: 1440, localStorage: stubStorage });

    const builderHtml = renderToStaticMarkup(
      React.createElement(CoachClipboardWorkoutBuilder, {
        activeTeam: squad,
        myTeams: [squad],
        connectedAthletes: [],
        primaryAthleteDisplayName: 'Coach Morales',
        selfProfile: buildCompleteAthleteProfile({}),
        onTeamsUpdated: () => {},
        onCreatePlannedEvent: async () => {},
        onOpenStopwatchSubTab: () => {},
      })
    );

    expect(builderHtml).toMatch(
      /data-testid="toggle-workout-library-btn"[^>]*aria-expanded="false"/
    );
    expect(builderHtml).not.toContain('data-testid="clipboard-sport-cycling"');
    expect(builderHtml).not.toContain('data-testid="clipboard-sport-swimming"');
    expect(builderHtml).not.toContain('data-testid="clipboard-sport-triathlon"');
  });

  it('builds chronological meet schedule blocks with delay offset and renders inline MeetDayHeatAndFlightModal', () => {
    const entries: MeetEntryRecord[] = [
      {
        id: 'e-1600',
        athleteId: 'a1',
        athleteName: 'Maya Chen',
        genderDivision: 'F',
        division: 'Varsity',
        eventCode: '1600m',
        seedMark: '5:08.20',
        eventStartTime: '11:30 AM',
        checkInCallTime: '11:05 AM',
        officialHeat: 1,
        officialLaneOrHip: 'Hip 3',
      },
      {
        id: 'e-100',
        athleteId: 'a2',
        athleteName: 'Devon Carter',
        genderDivision: 'M',
        division: 'Varsity',
        eventCode: '100m',
        seedMark: '10.94',
        eventStartTime: '9:45 AM',
        checkInCallTime: '9:20 AM',
        officialHeat: 2,
        officialLaneOrHip: 'Lane 4',
      },
    ];

    const blocks = buildChronologicalScheduleBlocks(entries, true, 15);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].eventCode).toBe('100m');
    expect(blocks[0].delayedStartTime).toBe('10:00 AM');
    expect(blocks[0].hasDelayApplied).toBe(true);
    expect(blocks[1].eventCode).toBe('1600m');
    expect(blocks[1].delayedStartTime).toBe('11:45 AM');

    const squad = buildSampleDemoCoachSquad('2026-11-23');
    const inlineEntriesHtml = renderToStaticMarkup(
      React.createElement(MeetDayHeatAndFlightModal, {
        isOpen: true,
        inline: true,
        onClose: () => {},
        activeTeam: squad,
        connectedAthletes: [],
        onLaunchEventStopwatch: () => {},
        onDelegateEventTimer: () => {},
      })
    );
    expect(inlineEntriesHtml.startsWith('<section')).toBe(true);
    expect(inlineEntriesHtml).not.toContain('fixed inset-0 z-50');
    expect(inlineEntriesHtml).toContain('data-testid="meet-tab-schedule"');
    expect(inlineEntriesHtml).toContain('data-testid="meet-entries-search-input"');
    expect(inlineEntriesHtml).toContain('data-testid="meet-filter-event"');
    expect(inlineEntriesHtml).toContain('data-testid="meet-mobile-exports-toggle"');

    const inlineScheduleHtml = renderToStaticMarkup(
      React.createElement(MeetDayHeatAndFlightModal, {
        isOpen: true,
        inline: true,
        initialSubTab: 'SCHEDULE',
        onClose: () => {},
        activeTeam: {
          ...squad,
          meetDayPackets: [
            {
              packetId: 'pkt-sched-1',
              meetTitle: 'Valley League Dual',
              meetDate: '2026-11-23',
              laneCount: 8,
              flightSize: 12,
              partitionByDivision: true,
              meetDelayMinutes: 15,
              entries: entries.map((e) => ({
                id: e.id,
                athleteName: e.athleteName,
                membershipId: e.athleteId,
                genderDivision: e.genderDivision,
                division: e.division,
                eventCode: e.eventCode,
                seedMarkRaw: e.seedMark,
                eventStartTime: e.eventStartTime,
                checkInCallTime: e.checkInCallTime,
                officialHeat: e.officialHeat,
                officialLaneOrHip: e.officialLaneOrHip,
              })),
              updatedAt: '2026-11-23T08:00:00Z',
            },
          ],
        },
        connectedAthletes: [],
        onLaunchEventStopwatch: () => {},
        onDelegateEventTimer: () => {},
      })
    );
    expect(inlineScheduleHtml).toContain('data-testid="meet-schedule-view"');
    expect(inlineScheduleHtml).toContain('10:00 AM');
    expect(inlineScheduleHtml).toContain('11:45 AM');
    expect(inlineScheduleHtml).toContain('(delayed +15m)');
  });

  it('resolves PARENT_FOLLOWER linked child in TeamMessagingDrawer, exposes inbox threads, and renders CockpitHeader mobile chat badge without empty coach strip', () => {
    const baseSquad = buildSampleDemoCoachSquad('2026-11-23');
    const customTeam: TeamSummaryWithRole = {
      ...baseSquad,
      brand: {
        ...baseSquad.brand,
        teamId: 'live_team_msg_1',
      },
      myRole: 'PARENT_FOLLOWER',
      myMembershipId: 'parent-mem-99',
      myLinkedChildMembershipIds: ['ath-child-2'],
      memberships: [
        {
          membershipId: 'ath-other-1',
          teamId: 'live_team_msg_1',
          userSid: 'u-other',
          invitedName: 'First Alphabet Athlete',
          role: 'ATHLETE',
          status: 'ACTIVE',
          squadGroup: 'Boys Varsity',
          isMinorU18: false,
          invitedAt: '2026-04-01T00:00:00Z',
        },
        {
          membershipId: 'ath-child-2',
          teamId: 'live_team_msg_1',
          userSid: 'u-child2',
          invitedName: 'Linked Child Chloe',
          role: 'ATHLETE',
          status: 'ACTIVE',
          squadGroup: 'Girls Varsity',
          isMinorU18: false,
          invitedAt: '2026-04-01T00:00:00Z',
        },
      ],
      teamMessages: [
        {
          id: 'dm-1',
          teamId: 'live_team_msg_1',
          channelId: 'direct:ath-child-2',
          channelScope: 'DIRECT_TRANSPARENT',
          targetMembershipId: 'ath-child-2',
          targetAthleteName: 'Linked Child Chloe',
          senderSid: 'u-coach',
          senderMembershipId: 'coach-1',
          senderName: 'Coach Morales',
          senderRole: 'HEAD_COACH',
          body: 'Checking on calf recovery before Saturday.',
          createdAt: '2026-11-23T12:00:00Z',
          guardianCcApplied: true,
          secondAdultVisible: true,
        },
      ],
    };

    const parentDrawerHtml = renderToStaticMarkup(
      React.createElement(TeamMessagingDrawer, {
        isOpen: true,
        onClose: () => {},
        activeTeam: customTeam,
        myTeams: [customTeam],
        onTeamsUpdated: () => {},
        viewerMode: 'ATHLETE',
        initialScope: 'DIRECT_TRANSPARENT',
      })
    );
    expect(parentDrawerHtml).toContain('Checking on calf recovery before Saturday.');
    expect(parentDrawerHtml).toContain('Linked Child Chloe');
    expect(parentDrawerHtml).not.toContain('First Alphabet Athlete');

    const coachDrawerHtml = renderToStaticMarkup(
      React.createElement(TeamMessagingDrawer, {
        isOpen: true,
        onClose: () => {},
        activeTeam: { ...customTeam, myRole: 'HEAD_COACH' },
        myTeams: [{ ...customTeam, myRole: 'HEAD_COACH' }],
        onTeamsUpdated: () => {},
        viewerMode: 'COACH',
        initialScope: 'DIRECT_TRANSPARENT',
      })
    );
    expect(coachDrawerHtml).toContain('data-testid="msg-active-threads-inbox"');
    expect(coachDrawerHtml).toContain('Linked Child Chloe');

    const headerHtml = renderToStaticMarkup(
      React.createElement(CockpitHeader, {
        activeTab: 'coach',
        setActiveTab: () => {},
        coachSubTab: 'CLIPBOARD',
        onSelectCoachSubTab: () => {},
        activeTeam: {
          ...baseSquad,
          teamMessages: [
            {
              id: 'm-1',
              teamId: baseSquad.brand.teamId,
              channelId: 'all-team',
              channelScope: 'ALL_TEAM',
              senderSid: 'u-coach',
              senderMembershipId: 'coach-1',
              senderName: 'Coach Morales',
              senderRole: 'HEAD_COACH',
              body: 'Practice at 3:15 PM',
              createdAt: '2026-11-23T12:00:00Z',
              guardianCcApplied: false,
              secondAdultVisible: true,
            },
          ],
        },
        myTeams: [baseSquad],
        activeTeamId: baseSquad.brand.teamId,
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
    expect(headerHtml).toContain('>Practice<');
    expect(headerHtml).toContain('>Meets &amp; Plan<');
    expect(headerHtml).toContain('>Timing<');
    expect(headerHtml).toContain('>Team<');
    expect(headerHtml).toContain('data-testid="header-team-chat-count"');
    // Empty bordered Coach mobile strip must not render when no stopwatch clock is active
    expect(headerHtml).not.toContain('md:hidden mt-2 pt-2 border-t');
  });
});
