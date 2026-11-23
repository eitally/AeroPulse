import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveCircadianHeroMode } from '../src/physiology/eveningHabitEngine';
import {
  FitnessHealthView,
  hasUrgentAthleteTeamSignal,
} from '../src/components/FitnessHealthView';
import {
  AthleteTeamStatusAndNotesCard,
  formatMeetTimeWithDelay,
  isDelegatedTimingAssignmentActive,
} from '../src/components/today/AthleteTeamStatusAndNotesCard';
import { CircadianFirstTouchHero } from '../src/components/CircadianFirstTouchHero';
import {
  AthleteSessionCheckInCard,
  deriveWatchlessCompletionPayload,
} from '../src/components/AthleteSessionCheckInCard';
import { EveningCloseoutCard } from '../src/components/today/EveningCloseoutCard';
import {
  CockpitHeader,
  shouldShowCoachWorkspaceSwitch,
  shouldShowMobileAthleteSwitcher,
} from '../src/components/CockpitHeader';
import {
  CoachWorkspaceView,
  shouldShowPrimarySetupWizardChip,
} from '../src/components/CoachWorkspaceView';
import {
  CoachClipboardWorkoutBuilder,
  isScholasticTrackOrXcTeam,
  shouldDefaultExpandWorkoutLibrary,
} from '../src/components/CoachClipboardWorkoutBuilder';
import {
  CoachDailyOpsPanel,
  applyMarkAllPresentDraft,
  buildExplicitAttendanceSaveEntries,
} from '../src/components/coach/CoachDailyOpsPanel';
import {
  buildSampleDemoCoachSquad,
  buildSampleDemoDataset,
} from '../src/data/sampleDemoData';
import { buildCompleteAthleteProfile } from '../src/utils/telemetryStorage';
import { DEFAULT_SELF_PRIVACY_SETTINGS } from '../src/data/athleteRosterData';
import type {
  ConnectedAthleteRecord,
  DelegatedTimingSessionRecord,
  PlannedWorkoutEvent,
  TeamSummaryWithRole,
  UnifiedActivity,
} from '../src/types';

function makeTrackPlanned(dateIso: string, overrides?: Partial<PlannedWorkoutEvent>): PlannedWorkoutEvent {
  return {
    id: `plan-${dateIso}`,
    date: dateIso,
    name: '5×800m CV + 4×200m R',
    sportCategory: 'Running',
    environmentPreference: 'OUTDOOR',
    description: 'Critical velocity intervals + mechanics finish.',
    plannedLoad: 76,
    plannedDurationSecs: 3300,
    targetZoneSummary: 'Z4–Z5 Track',
    workoutSyntax:
      'Warmup\n- 2mi Z1 Warmup\nMain Set 1\n- 5x800m at CV pace (90s jog)\nMain Set 2\n- 4x200m at mile pace (200m jog)\nCooldown\n- 1.5mi Z1 Cooldown',
    ...overrides,
  };
}

function makeActivity(dateIso: string): UnifiedActivity {
  return {
    id: `act-${dateIso}`,
    startDateLocal: `${dateIso}T16:15:00`,
    name: 'Afternoon Track Session',
    sportCategory: 'Running',
    environment: 'OUTDOOR',
    subType: 'Track',
    movingTimeSecs: 2400,
    distanceMeters: 8047,
    elevationGainMeters: 10,
    intensityFactor: 0.9,
    trainingLoad: 74,
    avgHr: 164,
    maxHr: 185,
    aerobicDecouplingPct: 2.0,
    efficiencyFactor: 1.52,
    firstHalfEf: 1.53,
    secondHalfEf: 1.51,
    zoneSecs: { hr: [300, 900, 600, 450, 150, 0, 0] },
    stravaPrCount: 0,
    segmentEfforts: [],
    sourceBadges: ['Garmin'],
  };
}

function makeDelegatedSession(todayIso: string, overrides?: Partial<DelegatedTimingSessionRecord>): DelegatedTimingSessionRecord {
  return {
    sessionId: 'dts-1',
    teamId: 'tm-1',
    passCode: 'WG-800-H2',
    meetTitle: 'BVAL Dual @ Willow Glen',
    meetDate: todayIso,
    eventCode: '800m',
    eventLabel: 'Boys 800m Varsity',
    heatLabel: 'Heat 2',
    stationType: '200M_MARK',
    stationLabel: '200m Split Mark',
    splitPlanLabel: '200m splits (4 laps)',
    targetSplitMeters: 200,
    targetLapCount: 4,
    runners: [
      { entryKey: 'r1', membershipId: 'ath-1', displayName: 'Lucas Alvarez', hipOrLane: 'Hip 3' },
      { entryKey: 'r2', membershipId: 'ath-2', displayName: 'Nolan Brooks', hipOrLane: 'Hip 5' },
    ],
    assignedMembershipId: 'ath-self',
    assignedDelegateName: 'Maya Chen',
    createdBySid: 'coach-sid',
    createdByName: 'Coach Morales',
    expiresAt: `${todayIso}T23:59:59Z`,
    createdAt: `${todayIso}T14:00:00Z`,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Field Daily Usability Improvements', () => {
  it('1. 9:15 PM circadian fix: resolves TONIGHT across 19:00-03:59 and renders single EveningCloseoutCard without duplicate', () => {
    expect(resolveCircadianHeroMode({ localHour: 21, hasCompletedToday: false })).toBe('TONIGHT');
    expect(resolveCircadianHeroMode({ localHour: 21, hasCompletedToday: true })).toBe('TONIGHT');
    expect(resolveCircadianHeroMode({ localHour: 3, hasCompletedToday: true })).toBe('TONIGHT');
    expect(resolveCircadianHeroMode({ localHour: 7, hasCompletedToday: false })).toBe('MORNING');
    expect(resolveCircadianHeroMode({ localHour: 15, hasCompletedToday: true })).toBe('POST_SESSION');

    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 22, 21, 15, 0));

    const todayIso = '2026-11-22';
    const ds = buildSampleDemoDataset(todayIso);
    const html = renderToStaticMarkup(
      React.createElement(FitnessHealthView, {
        wellnessDays: ds.wellnessDays,
        plannedEvents: ds.plannedEvents,
        activities: ds.activities,
        athleteProfile: ds.athleteProfile,
        distanceUnit: 'mi',
        sessionCheckIns: [],
        onRecordSessionCheckIn: () => {},
        onOpenCoachWithPrompt: () => {},
      })
    );

    expect(html).toContain('Tonight Closeout &amp; Tomorrow Lock-In');
    expect(html).toMatch(/data-testid="circadian-mode-tonight"[^>]*aria-pressed="true"/);
    const checkInCardMatches = html.match(/data-testid="athlete-session-checkin-card"/g) || [];
    expect(checkInCardMatches).toHaveLength(1);
  });

  it('2. Promotes AthleteTeamStatusAndNotesCard ABOVE Hero on urgent team signals & renders Assigned to Time + My Meet Day Card', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 22, 10, 0, 0));

    const todayIso = '2026-11-22';
    const ds = buildSampleDemoDataset(todayIso);
    const baseSquad = buildSampleDemoCoachSquad(todayIso);

    const athleteUrgentTeam: TeamSummaryWithRole = {
      ...baseSquad,
      myRole: 'ATHLETE',
      myMembershipId: 'demo-mem-ath-02',
      injuryCases: baseSquad.injuryCases,
      workoutComments: [],
      myDelegatedTimingAssignments: [makeDelegatedSession(todayIso)],
      myMeetDaySchedule: [
        {
          packetId: 'pkt-1',
          meetTitle: 'BVAL Center Meet',
          meetDate: todayIso,
          eventCode: '1600m',
          seedMarkRaw: '4:58.20',
          division: 'Varsity Girls',
          officialHeat: 1,
          officialLaneOrHip: 'Hip 4',
          officialFlight: 1,
          officialOrder: 2,
          checkInCallTime: '15:30',
          eventStartTime: '16:00',
          meetDelayMinutes: 15,
          scratched: false,
          athleticLiveUrl: 'https://live.athletic.net/meets/12345',
        },
        {
          packetId: 'pkt-1',
          meetTitle: 'BVAL Center Meet',
          meetDate: todayIso,
          eventCode: '800m',
          seedMarkRaw: '2:18.40',
          scratched: true,
          athleticLiveUrl: 'javascript:alert(1)',
        },
      ],
    };

    expect(hasUrgentAthleteTeamSignal(athleteUrgentTeam, todayIso)).toBe(true);
    expect(
      isDelegatedTimingAssignmentActive(
        makeDelegatedSession(todayIso, { revokedAt: '2026-11-22T15:00:00Z' }),
        todayIso
      )
    ).toBe(false);

    const shifted = formatMeetTimeWithDelay('15:30', 15);
    expect(shifted?.display).toBe('3:45 PM');
    expect(shifted?.delayApplied).toBe(true);

    const urgentHtml = renderToStaticMarkup(
      React.createElement(FitnessHealthView, {
        wellnessDays: ds.wellnessDays,
        plannedEvents: ds.plannedEvents,
        activities: ds.activities,
        athleteProfile: ds.athleteProfile,
        activeTeam: athleteUrgentTeam,
        myTeams: [athleteUrgentTeam],
        isSampleDemoMode: true,
        distanceUnit: 'mi',
        sessionCheckIns: [],
        onRecordSessionCheckIn: () => {},
        onOpenCoachWithPrompt: () => {},
        onLaunchDelegatedTiming: () => {},
      })
    );
    const teamIdx = urgentHtml.indexOf('data-testid="athlete-team-status-and-notes"');
    const heroIdx = urgentHtml.indexOf('data-testid="circadian-mode-tonight"');
    expect(teamIdx).toBeGreaterThan(-1);
    expect(heroIdx).toBeGreaterThan(teamIdx);

    const oldCommentOnlyTeam: TeamSummaryWithRole = {
      ...baseSquad,
      myRole: 'ATHLETE',
      myMembershipId: 'demo-mem-ath-01',
      injuryCases: [],
      myDelegatedTimingAssignments: [],
      myMeetDaySchedule: [],
      workoutComments: [
        {
          id: 'old-note',
          teamId: baseSquad.brand.teamId,
          targetMembershipId: 'demo-mem-ath-01',
          targetAthleteName: 'Lucas Alvarez',
          workoutDate: '2026-10-15',
          authorSid: 'coach-1',
          authorName: 'Coach Morales',
          authorRole: 'HEAD_COACH',
          body: 'Archive note from October.',
          guardianCcApplied: true,
          guardianVisible: true,
          createdAt: '2026-10-15T12:00:00Z',
        },
      ],
    };
    expect(hasUrgentAthleteTeamSignal(oldCommentOnlyTeam, todayIso)).toBe(false);

    const calmHtml = renderToStaticMarkup(
      React.createElement(FitnessHealthView, {
        wellnessDays: ds.wellnessDays,
        plannedEvents: ds.plannedEvents,
        activities: ds.activities,
        athleteProfile: ds.athleteProfile,
        activeTeam: oldCommentOnlyTeam,
        myTeams: [oldCommentOnlyTeam],
        isSampleDemoMode: true,
        distanceUnit: 'mi',
        sessionCheckIns: [],
        onRecordSessionCheckIn: () => {},
        onOpenCoachWithPrompt: () => {},
      })
    );
    const calmTeamIdx = calmHtml.indexOf('data-testid="athlete-team-status-and-notes"');
    const calmHeroIdx = calmHtml.indexOf('data-testid="circadian-mode-tonight"');
    expect(calmTeamIdx).toBeGreaterThan(calmHeroIdx);

    const cardHtml = renderToStaticMarkup(
      React.createElement(AthleteTeamStatusAndNotesCard, {
        activeTeam: athleteUrgentTeam,
        myTeams: [athleteUrgentTeam],
        todayIso,
        isSampleDemoMode: true,
        onLaunchDelegatedTiming: () => {},
      })
    );
    expect(cardHtml).toContain('data-testid="athlete-delegated-timing-card"');
    expect(cardHtml).toContain('Open Pocket Timing Pad');
    expect(cardHtml).toContain('Boys 800m Varsity');
    expect(cardHtml).toContain('data-testid="athlete-meet-day-card"');
    expect(cardHtml).toContain('Heat 1');
    expect(cardHtml).toContain('Lane / Hip Hip 4');
    expect(cardHtml).toContain('Flight 1 #2');
    expect(cardHtml).toContain('3:45 PM');
    expect(cardHtml).toContain('4:15 PM');
    expect(cardHtml).toContain('Meet Delay +15m');
    expect(cardHtml).toContain('SCRATCHED');
    expect(cardHtml).toContain('https://live.athletic.net/meets/12345');
    expect(cardHtml).not.toContain('javascript:alert(1)');
  });

  it('3. Athlete header cleanup: hides Coach button and mobile peer switcher for non-staff athletes while preserving Coach & Demo access', () => {
    const squad = buildSampleDemoCoachSquad('2026-11-22');
    const athleteTeam: TeamSummaryWithRole = { ...squad, myRole: 'ATHLETE' };
    const peerRoster: ConnectedAthleteRecord[] = [
      {
        id: 'peer-1',
        name: 'Teammate One',
        avatarInitials: 'TO',
        location: 'WGHS',
        stravaAthleteId: '101',
        inviteCode: 'T1',
        role: 'FRIEND_VIEW',
        status: 'CONNECTED',
        primaryGoalSummary: 'Track',
        primarySport: 'Running',
        athleteProfile: buildCompleteAthleteProfile({}),
        privacySettings: { ...DEFAULT_SELF_PRIVACY_SETTINGS },
        wellnessDays: [],
        activities: [],
        plannedEvents: [],
        targetGoals: [],
      },
    ];

    expect(
      shouldShowCoachWorkspaceSwitch({
        activeTab: 'fitness',
        myTeams: [athleteTeam],
        isSampleDemoMode: false,
        hasCoachOnboardingRole: false,
      })
    ).toBe(false);
    expect(
      shouldShowMobileAthleteSwitcher({
        activeTab: 'fitness',
        activeViewedAthleteId: 'SELF',
        myTeams: [athleteTeam],
        combinedRoster: peerRoster,
        isSampleDemoMode: false,
      })
    ).toBe(false);

    const athleteHeaderHtml = renderToStaticMarkup(
      React.createElement(CockpitHeader, {
        activeTab: 'fitness',
        setActiveTab: () => {},
        activeTeam: athleteTeam,
        myTeams: [athleteTeam],
        activeTeamId: athleteTeam.brand.teamId,
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
        primaryAthleteDisplayName: 'Maya Chen',
        primaryAthleteInitials: 'MC',
        combinedRoster: peerRoster,
        anySourceConnected: false,
        onOpenDataSources: () => {},
        onOpenCoach: () => {},
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
    expect(athleteHeaderHtml).not.toContain('data-testid="toggle-coach-workspace"');
    expect(athleteHeaderHtml).not.toContain('Switch Active Athlete Profile (Mobile)');

    const coachHeaderHtml = renderToStaticMarkup(
      React.createElement(CockpitHeader, {
        activeTab: 'fitness',
        setActiveTab: () => {},
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
        combinedRoster: peerRoster,
        anySourceConnected: false,
        onOpenDataSources: () => {},
        onOpenCoach: () => {},
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
    expect(coachHeaderHtml).toContain('data-testid="toggle-coach-workspace"');
    expect(coachHeaderHtml).toContain('Switch Active Athlete Profile (Mobile)');
  });

  it('4. CircadianFirstTouchHero shows >4 workout steps with Show all N steps toggle and removes 1-tap overwrite on coach sessions', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 22, 10, 0, 0));

    const todayIso = '2026-11-22';
    const ds = buildSampleDemoDataset(todayIso);
    const eightStepWorkout = makeTrackPlanned(todayIso);

    const heroHtml = renderToStaticMarkup(
      React.createElement(CircadianFirstTouchHero, {
        wellnessDays: ds.wellnessDays,
        activities: [],
        plannedEvents: [eightStepWorkout],
        athleteProfile: ds.athleteProfile,
        distanceUnit: 'mi',
        isWorkbenchExpanded: false,
        onToggleWorkbench: () => {},
        mode: 'MORNING',
        onSyncMorphedToCalendar: async () => {},
      })
    );

    expect(heroHtml).toContain('5 × 800m');
    expect(heroHtml).toContain('Main Set 2');
    expect(heroHtml).toContain('4 × 200m');
    expect(heroHtml).toContain('data-testid="hero-toggle-all-steps-btn"');
    expect(heroHtml).toContain('Show all 8 steps');
    expect(heroHtml).not.toContain('Use Readiness Workout');
    expect(heroHtml).toContain('data-testid="hero-preview-easy-alt-btn"');
    expect(heroHtml).toContain('Flag Soreness / Request Easy Swap');
  });

  it('5. Watchless completion derives honest duration/distance without fabricating pace PRs and keeps check-in contracts intact', () => {
    const todayIso = '2026-11-22';
    const trackPlan = makeTrackPlanned(todayIso, {
      plannedDurationSecs: 3000,
      workoutSyntax: 'Warmup\n- 1mi Z1 Warmup\n\nMain Set\n- 4x400m at mile pace (90s jog)\n\nCooldown\n- 1mi Z1 Cooldown',
    });
    const derived = deriveWatchlessCompletionPayload({
      todayPlanned: trackPlan,
      rpe: 7,
      dateIso: todayIso,
    });
    expect(derived.workoutName).toBe('5×800m CV + 4×200m R');
    expect(derived.durationMins).toBe(50);
    // 1mi (1609m) + 4*400m (1600m) + 1mi (1609m) = 4818m => 4.82 km
    expect(derived.distanceKm).toBeCloseTo(4.82, 1);
    expect(derived.rpe).toBe(7);

    const timeOnly = deriveWatchlessCompletionPayload({
      todayPlanned: makeTrackPlanned(todayIso, {
        name: '30m Easy Aerobic',
        plannedDurationSecs: 1800,
        workoutSyntax: 'Main Set\n- 30m 70% Pace',
      }),
      rpe: 4,
      dateIso: todayIso,
    });
    expect(timeOnly.durationMins).toBe(30);
    expect(timeOnly.distanceKm).toBe(0);

    const checkInHtml = renderToStaticMarkup(
      React.createElement(AthleteSessionCheckInCard, {
        todayIso,
        activities: [],
        plannedEvents: [trackPlan],
        sessionCheckIns: [],
        onRecordCheckIn: () => {},
        onLogWatchlessCompletion: () => {},
      })
    );
    expect(checkInHtml).toContain('data-testid="watchless-did-workout-btn"');
    expect(checkInHtml).toContain('data-testid="checkin-submit-clear"');

    const closeoutWithActivityHtml = renderToStaticMarkup(
      React.createElement(EveningCloseoutCard, {
        todayIso,
        activities: [makeActivity(todayIso)],
        plannedEvents: [trackPlan],
        sessionCheckIns: [],
        onRecordCheckIn: () => {},
        onLogWatchlessCompletion: () => {},
        isDuskMode: false,
        onToggleDuskMode: () => {},
      })
    );
    expect(closeoutWithActivityHtml).toContain('data-testid="checkin-submit-clear"');
    expect(closeoutWithActivityHtml).not.toContain('data-testid="watchless-did-workout-btn"');
  });

  it('6. Roll call never fabricates PRESENT for unmarked athletes, preserves explicit marks on Mark All Present, and expands mobile container', () => {
    const squad = buildSampleDemoCoachSquad('2026-11-22');
    const athletes = squad.memberships.filter((m) => m.role === 'ATHLETE');
    expect(athletes.length).toBeGreaterThanOrEqual(4);

    const partialMap = {
      [athletes[0].membershipId]: 'PRESENT' as const,
      [athletes[1].membershipId]: 'ABSENT' as const,
    };
    const saveEntries = buildExplicitAttendanceSaveEntries({
      members: athletes,
      attendanceMap: partialMap,
    });
    expect(saveEntries).toEqual([
      { membershipId: athletes[0].membershipId, status: 'PRESENT' },
      { membershipId: athletes[1].membershipId, status: 'ABSENT' },
    ]);

    const rtpMap = new Map<string, 'OUT' | 'MODIFIED'>([[athletes[2].membershipId, 'MODIFIED']]);
    const markAllDraft = applyMarkAllPresentDraft({
      visibleMembers: athletes.slice(0, 4),
      attendanceMap: {
        [athletes[1].membershipId]: 'ABSENT',
      },
      atRtpByMemberId: rtpMap,
    });
    expect(markAllDraft[athletes[0].membershipId]).toBe('PRESENT');
    expect(markAllDraft[athletes[1].membershipId]).toBe('ABSENT');
    expect(markAllDraft[athletes[2].membershipId]).toBe('INJURED_MODIFIED');
    expect(markAllDraft[athletes[3].membershipId]).toBe('PRESENT');

    const teamWithPartial: TeamSummaryWithRole = {
      ...squad,
      attendanceByDate: {
        '2026-11-22': {
          [athletes[0].membershipId]: {
            date: '2026-11-22',
            membershipId: athletes[0].membershipId,
            status: 'PRESENT',
            method: 'COACH_MANUAL',
            updatedAt: '2026-11-22T15:15:00Z',
          },
        },
      },
    };
    const opsHtml = renderToStaticMarkup(
      React.createElement(CoachDailyOpsPanel, {
        activeTeam: teamWithPartial,
        myTeams: [teamWithPartial],
        complexityTier: 'ESSENTIALS',
        onLaunchStopwatch: () => {},
        onLaunchFieldSheet: () => {},
        onTeamsUpdated: () => {},
      })
    );
    expect(opsHtml).toContain('data-testid="roll-call-counts"');
    expect(opsHtml).toContain('max-h-[420px] sm:max-h-72');
  });

  it('7. CoachWorkspaceView adds 3:15 PM Quick Ops strip, tucks 60s Setup for established squads, and CoachClipboard collapses library on mobile & groups Multisport', () => {
    const todayIso = '2026-11-22';
    const squad = buildSampleDemoCoachSquad(todayIso);
    expect(shouldShowPrimarySetupWizardChip(squad)).toBe(false);
    expect(shouldShowPrimarySetupWizardChip({ ...squad, broadcastWorkouts: [] })).toBe(true);

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
        onOpenDelegateTimingModal: () => {},
        pendingTimingSubmissionsCount: 3,
      })
    );
    expect(coachHtml).toContain('data-testid="coach-quick-ops-strip"');
    expect(coachHtml).toContain('Take Roll Call');
    expect(coachHtml).toContain('Track Stopwatch');
    expect(coachHtml).toContain('Delegate Timing');
    expect(coachHtml).toContain('Pending Splits (3)');
    expect(coachHtml).not.toContain('data-testid="coach-open-wizard-btn"');

    expect(shouldDefaultExpandWorkoutLibrary(390)).toBe(false);
    expect(shouldDefaultExpandWorkoutLibrary(767)).toBe(false);
    expect(shouldDefaultExpandWorkoutLibrary(768)).toBe(true);
    expect(shouldDefaultExpandWorkoutLibrary(1440)).toBe(true);
    expect(isScholasticTrackOrXcTeam(squad)).toBe(true);

    const stubProfile = buildCompleteAthleteProfile({});
    const stubStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
    vi.stubGlobal('window', { innerWidth: 390, localStorage: stubStorage });
    const mobileBuilderHtml = renderToStaticMarkup(
      React.createElement(CoachClipboardWorkoutBuilder, {
        activeTeam: squad,
        myTeams: [squad],
        connectedAthletes: [],
        primaryAthleteDisplayName: 'Coach Morales',
        selfProfile: stubProfile,
        onTeamsUpdated: () => {},
        onCreatePlannedEvent: async () => {},
        onOpenStopwatchSubTab: () => {},
      })
    );
    expect(mobileBuilderHtml).toContain('data-testid="clipboard-multisport-expander"');
    expect(mobileBuilderHtml).toContain('+ Multisport');
    expect(mobileBuilderHtml).not.toContain('data-testid="clipboard-sport-swimming"');
    expect(mobileBuilderHtml).not.toContain('data-testid="library-load-template-btn"');
    expect(mobileBuilderHtml).toMatch(/data-testid="toggle-workout-library-btn"[^>]*aria-expanded="false"/);

    vi.stubGlobal('window', { innerWidth: 1440, localStorage: stubStorage });
    const desktopBuilderHtml = renderToStaticMarkup(
      React.createElement(CoachClipboardWorkoutBuilder, {
        activeTeam: squad,
        myTeams: [squad],
        connectedAthletes: [],
        primaryAthleteDisplayName: 'Coach Morales',
        selfProfile: stubProfile,
        onTeamsUpdated: () => {},
        onCreatePlannedEvent: async () => {},
        onOpenStopwatchSubTab: () => {},
      })
    );
    expect(desktopBuilderHtml).toContain('data-testid="library-load-template-btn"');
    expect(desktopBuilderHtml).toMatch(/data-testid="toggle-workout-library-btn"[^>]*aria-expanded="true"/);
  });

  it('8. Enforces line-count ceilings across modified components', () => {
    const root = process.cwd();
    const countLines = (rel: string) =>
      fs.readFileSync(path.join(root, rel), 'utf8').split('\n').length;

    expect(countLines('src/components/FitnessHealthView.tsx')).toBeLessThan(2250);
    expect(countLines('src/components/CircadianFirstTouchHero.tsx')).toBeLessThan(1650);
    expect(countLines('src/components/CoachWorkspaceView.tsx')).toBeLessThanOrEqual(2400);
  });
});
