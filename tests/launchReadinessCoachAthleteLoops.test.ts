import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSampleDemoCoachSquad,
  buildSampleDemoDataset,
} from '../src/data/sampleDemoData';
import { buildDemoSeedInjuryCases } from '../src/physiology/injuryHubEngine';
import { buildClientDistrictOverviewFromTeams } from '../src/utils/districtAdOverviewHelper';
import { buildDailyClearanceCsv } from '../src/components/coach/AthleticTrainerInjuryHub';
import { AthleteTeamStatusAndNotesCard } from '../src/components/today/AthleteTeamStatusAndNotesCard';
import { PracticeAttendanceCheckInCard } from '../src/components/today/PracticeAttendanceCheckInCard';
import { EveningCloseoutCard } from '../src/components/today/EveningCloseoutCard';
import { AthleteSessionCheckInCard } from '../src/components/AthleteSessionCheckInCard';
import {
  MeetDayHeatAndFlightModal,
  buildEntriesFromRosterMarks,
  buildInitialMeetEntries,
} from '../src/components/coach/MeetDayHeatAndFlightModal';
import {
  ALL_MEET_DAY_EVENTS,
  openPrintableMeetDayPacketWindow,
} from '../src/physiology/meetDayOpsEngine';
import { CalendarMobileAgenda } from '../src/components/calendar/CalendarMobileAgenda';
import { CalendarView } from '../src/components/CalendarView';
import { VisualWorkoutBuilder } from '../src/components/VisualWorkoutBuilder';
import {
  ShareWorkoutPage,
  resolvePresetSharedWorkoutFromSearch,
} from '../src/components/ShareWorkoutPage';
import {
  CoachDailyOpsPanel,
  buildAttendanceCsv,
} from '../src/components/coach/CoachDailyOpsPanel';
import { QuickRunLoggerCard } from '../src/components/QuickRunLoggerCard';
import { ActivityInspectorModal } from '../src/components/activities/ActivityInspectorModal';
import { PublicTeamHubPage } from '../src/components/PublicTeamHubPage';
import { captureLandingAttribution } from '../src/utils/attribution';
import {
  MAX_FIELD_OUTBOX_ATTEMPTS,
  clearFieldOutboxDb,
  flushFieldOutbox,
  loadFieldOutbox,
  saveFieldOutbox,
} from '../src/utils/fieldEventsOutbox';
import { buildSupportDiagnosticsSnapshot } from '../src/utils/supportDiagnostics';
import { STORAGE_KEYS } from '../src/utils/storageKeys';
import { doesActivityMatchGear } from '../src/utils/gearClosetUtils';
import { buildCompleteAthleteProfile } from '../src/utils/telemetryStorage';
import type {
  AthleteGearItem,
  TeamSummaryWithRole,
  UnifiedActivity,
} from '../src/types';

const originalFetch = globalThis.fetch;

function makeTestActivity(
  overrides: Partial<UnifiedActivity> & { id: string; startDateLocal: string; name: string }
): UnifiedActivity {
  return {
    sportCategory: 'Running',
    environment: 'OUTDOOR',
    subType: 'Track',
    movingTimeSecs: 2400,
    distanceMeters: 8047,
    elevationGainMeters: 15,
    intensityFactor: 0.85,
    trainingLoad: 72,
    avgHr: 158,
    maxHr: 178,
    aerobicDecouplingPct: 2,
    efficiencyFactor: 1.5,
    firstHalfEf: 1.52,
    secondHalfEf: 1.49,
    zoneSecs: { hr: [0, 0, 1200, 1200, 0, 0, 0] },
    stravaPrCount: 0,
    segmentEfforts: [],
    sourceBadges: [],
    ...overrides,
  };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
  await clearFieldOutboxDb();
});

describe('Launch-Readiness Coach & Athlete End-to-End Loops', () => {
  it('1. 3-Way Sample Demo Coherence & Multi-School District AD Rollup', () => {
    const todayIso = '2026-11-22';
    const ds = buildSampleDemoDataset(todayIso);
    expect(ds.demoTeams).toHaveLength(2);
    expect(ds.demoTeams[0].brand.name).toBe('Willow Glen High School XC');
    expect(ds.demoTeams[1].brand.name).toBe('Lincoln High School Track & XC');
    expect(ds.demoTeams[0].brand.districtName).toBe('San Jose Unified School District');
    expect(ds.demoTeams[1].brand.districtName).toBe('San Jose Unified School District');

    const willow = ds.demoTeams[0];
    expect(willow.injuryCases).toHaveLength(1);
    expect(willow.injuryCases?.[0].membershipId).toBe('demo-mem-ath-02');
    expect(willow.injuryCases?.[0].bodyRegion).toBe('SHIN');
    expect(willow.injuryCases?.[0].rtpStage).toBe('MODIFIED');
    expect(willow.injuryCases?.[0].privateClinicalNotes).toBeUndefined();

    const attToday = willow.attendanceByDate?.[todayIso];
    expect(attToday?.['demo-mem-ath-02']?.status).toBe('INJURED_MODIFIED');
    expect(attToday?.['demo-mem-ath-01']?.status).toBe('PRESENT');
    expect(attToday?.['demo-mem-ath-01']?.distanceMeters).toBe(18);
    expect(attToday?.['demo-mem-ath-04']?.status).toBe('PRESENT');
    expect(attToday?.['demo-mem-ath-04']?.distanceMeters).toBe(34);

    const rollup = buildClientDistrictOverviewFromTeams(ds.demoTeams, { todayIso });
    expect(rollup.schools).toHaveLength(2);
    const willowSchool = rollup.schools.find((s) => s.teamId === willow.brand.teamId);
    expect(willowSchool?.activeAtInjuries).toBe(1);
    expect(willowSchool?.modifiedAttendanceToday).toBe(1);

    const seededCases = buildDemoSeedInjuryCases(buildSampleDemoCoachSquad(todayIso));
    expect(seededCases[0].membershipId).toBe('demo-mem-ath-02');
    expect(seededCases[0].athleteName).toBe('Maya Chen');

    const csv = buildDailyClearanceCsv(
      [
        {
          ...willow.injuryCases![0],
          athleteName: '=HYPERLINK("evil")',
          privateClinicalNotes: 'SENSITIVE_CLINICAL_SECRET_DO_NOT_EXPORT',
        },
      ],
      'WGHS XC',
      todayIso
    );
    expect(csv).not.toContain('SENSITIVE_CLINICAL_SECRET_DO_NOT_EXPORT');
    expect(csv).toContain("'=HYPERLINK");
  });

  it('2. Closes athlete loop: RTP banner (no clinical leak), Guardian-CC comments, INJURED_MODIFIED receipt, and Closeout units/pain/button', () => {
    const todayIso = '2026-11-22';
    const squad = buildSampleDemoCoachSquad(todayIso);
    const athleteViewTeam: TeamSummaryWithRole = {
      ...squad,
      myRole: 'ATHLETE',
      myMembershipId: 'demo-mem-ath-02',
      injuryCases: [
        {
          ...squad.injuryCases![0],
          privateClinicalNotes: 'CONFIDENTIAL_AT_PALPATION_NOTE',
        },
      ],
    };

    const statusHtml = renderToStaticMarkup(
      React.createElement(AthleteTeamStatusAndNotesCard, {
        activeTeam: athleteViewTeam,
        myTeams: [athleteViewTeam],
        todayIso,
        isSampleDemoMode: true,
      })
    );
    expect(statusHtml).toContain('data-testid="athlete-at-rtp-banner"');
    expect(statusHtml).toContain('MODIFIED');
    expect(statusHtml).toContain('Zero-Impact Modulation Guidance');
    expect(statusHtml).not.toContain('CONFIDENTIAL_AT_PALPATION_NOTE');
    expect(statusHtml).toContain('data-testid="athlete-coach-notes-card"');
    expect(statusHtml).toContain('SafeSport Guardian-CC Active');
    expect(statusHtml).toContain('data-testid="athlete-coach-note-reply-input"');

    const attHtml = renderToStaticMarkup(
      React.createElement(PracticeAttendanceCheckInCard, {
        activeTeam: athleteViewTeam,
        todayIso,
        isSampleDemoMode: true,
      })
    );
    expect(attHtml).toContain('data-testid="gps-practice-checkin-receipt"');
    expect(attHtml).toContain('Modified Attendance ✓');

    const unloggedCloseoutHtml = renderToStaticMarkup(
      React.createElement(EveningCloseoutCard, {
        todayIso,
        activities: [],
        plannedEvents: [],
        distanceUnit: 'mi',
        sessionCheckIns: [],
        onRecordCheckIn: () => {},
        isDuskMode: false,
        onToggleDuskMode: () => {},
      })
    );
    expect(unloggedCloseoutHtml).toContain('0.0 mi');
    expect(unloggedCloseoutHtml).not.toContain('0 km');
    expect(unloggedCloseoutHtml).toContain('data-testid="watchless-did-workout-btn"');
    expect(unloggedCloseoutHtml).toContain('data-testid="checkin-submit-clear"');

    const completedActivity = makeTestActivity({
      id: 'act-1',
      startDateLocal: `${todayIso}T16:00:00`,
      name: 'Track Threshold',
    });
    const loggedCloseoutHtml = renderToStaticMarkup(
      React.createElement(EveningCloseoutCard, {
        todayIso,
        activities: [completedActivity],
        plannedEvents: [],
        distanceUnit: 'mi',
        sessionCheckIns: [],
        onRecordCheckIn: () => {},
        isDuskMode: false,
        onToggleDuskMode: () => {},
      })
    );
    expect(loggedCloseoutHtml).toContain('5.0 mi');
    expect(loggedCloseoutHtml).toContain('data-testid="checkin-submit-clear"');
    expect(loggedCloseoutHtml).not.toContain('data-testid="watchless-did-workout-btn"');

    const daytimeHtml = renderToStaticMarkup(
      React.createElement(AthleteSessionCheckInCard, {
        todayIso,
        plannedEvents: [],
        sessionCheckIns: [],
        onRecordCheckIn: () => {},
      })
    );
    expect(daytimeHtml).toContain('athlete-session-checkin-card');
    expect(daytimeHtml).toContain('checkin-rpe-5');
  });

  it('3. MeetDay real-team safety: starts empty, seeds real marks only, excludes ALUMNI, badges INJURED, maps F hurdles -> 100mH, and uses event defaultLanes + win.print()', () => {
    const realTeam: TeamSummaryWithRole = {
      ...buildSampleDemoCoachSquad('2026-11-22'),
      brand: {
        ...buildSampleDemoCoachSquad('2026-11-22').brand,
        teamId: 'tm_real_wghs',
      },
      memberships: [
        {
          membershipId: 'mem-f-hurdles',
          teamId: 'tm_real_wghs',
          role: 'ATHLETE',
          squadGroup: 'Varsity Girls',
          eventGroup: 'HURDLES',
          genderDivision: 'F',
          seedMarkOrFtp: '110mH 15.12',
          invitedName: 'Maya Hurdler',
          isMinorU18: true,
          status: 'INJURED',
          invitedAt: '2026-09-01T00:00:00Z',
        },
        {
          membershipId: 'mem-alumni',
          teamId: 'tm_real_wghs',
          role: 'ATHLETE',
          squadGroup: 'Alumni',
          genderDivision: 'M',
          seedMarkOrFtp: '100m 10.75',
          invitedName: 'Graduated Sprinter',
          isMinorU18: false,
          status: 'ALUMNI',
          invitedAt: '2024-09-01T00:00:00Z',
        },
      ],
    };

    expect(buildInitialMeetEntries(realTeam, [])).toEqual([]);
    const rosterSeeded = buildEntriesFromRosterMarks(realTeam);
    expect(rosterSeeded).toHaveLength(1);
    expect(rosterSeeded[0].athleteName).toBe('Maya Hurdler');
    expect(rosterSeeded[0].eventCode).toBe('100mH');
    expect(rosterSeeded[0].seedMark).toBe('15.12');

    expect(ALL_MEET_DAY_EVENTS.find((e) => e.code === '1600m')?.defaultLanes).toBe(16);

    const modalHtml = renderToStaticMarkup(
      React.createElement(MeetDayHeatAndFlightModal, {
        isOpen: true,
        onClose: () => {},
        activeTeam: {
          ...realTeam,
          meetDayPackets: [
            {
              packetId: 'pkt-1',
              meetTitle: 'BVAL Dual',
              meetDate: '2026-11-22',
              laneCount: 8,
              flightSize: 12,
              partitionByDivision: true,
              entries: [
                {
                  id: 'e1',
                  athleteName: 'Maya Hurdler',
                  membershipId: 'mem-f-hurdles',
                  genderDivision: 'F',
                  division: 'Varsity',
                  eventCode: '100mH',
                  seedMarkRaw: '15.12',
                },
              ],
              updatedAt: '2026-11-22T00:00:00Z',
            },
          ],
        },
        connectedAthletes: [],
      })
    );
    expect(modalHtml).toContain('aria-labelledby=');
    expect(modalHtml).toContain('meet-seed-roster-marks-btn');
    expect(modalHtml).toContain('[INJURED — AT RTP]');

    let printedHtml = '';
    const mockPrint = vi.fn();
    const mockFocus = vi.fn();
    vi.stubGlobal('window', {
      open: vi.fn(() => ({
        document: {
          write: (html: string) => {
            printedHtml = html;
          },
          close: vi.fn(),
        },
        focus: mockFocus,
        print: mockPrint,
      })),
    });
    const opened = openPrintableMeetDayPacketWindow({
      teamName: 'WGHS',
      meetTitle: 'BVAL Dual',
      entries: rosterSeeded,
    });
    expect(opened).toBe(true);
    expect(mockFocus).toHaveBeenCalledTimes(1);
    expect(mockPrint).toHaveBeenCalledTimes(1);
    expect(printedHtml).toContain('class="no-print"');
    expect(printedHtml).toContain('Print Meet Packet');
  });

  it('4. Mobile Calendar Watch Push, AT RTP badge, Team Library in Visual Builder, & Share ?preset=8x400', () => {
    const squad = buildSampleDemoCoachSquad('2026-11-22');
    const agendaHtml = renderToStaticMarkup(
      React.createElement(CalendarMobileAgenda, {
        calendarWeeks: [
          {
            weekIndex: 0,
            isoWeekNum: 47,
            days: [
              {
                dateStr: '2026-11-22',
                dayNumber: 22,
                isCurrentMonth: true,
                dayActivities: [],
                dayPlanned: [
                  {
                    id: 'plan-1',
                    date: '2026-11-22',
                    name: '6x400m Track',
                    sportCategory: 'Running',
                    environmentPreference: 'OUTDOOR',
                    plannedDurationSecs: 2400,
                    plannedLoad: 60,
                    targetZoneSummary: 'Z4–Z5 Mile Pace',
                    workoutSyntax: '- 6x 400m @ mile pace w/ 200m jog',
                    description: 'Mile pace track reps',
                    source: 'USER',
                  },
                ],
                wellness: undefined,
              },
            ],
            endOfWeekWellness: undefined,
            totalLoad: 60,
            totalDurationSecs: 2400,
            totalDistanceMeters: 0,
            totalElevationMeters: 0,
            totalKcal: 420,
            ramp7d: 2.0,
            bySport: [
              { sport: 'Running', timeSecs: 2400, distanceMeters: 0, load: 60 },
            ],
            weekZoneSharesPct: [20, 40, 20, 10, 10, 0],
            weekZoneLabel: 'Polarized',
            weekZoneRatio: '70/30',
          },
        ],
        showDayEffortStripe: true,
        showCellWellness: false,
        todayIso: '2026-11-22',
        distanceUnit: 'mi',
        athleteFtp: 260,
        pendingDeletePlannedId: null,
        setPendingDeletePlannedId: () => {},
        onSelectActivity: () => {},
        onOpenBuilderForDate: () => {},
        handleLaunchPlannedInStopwatch: () => {},
        handleExportPlannedFit: () => {},
        handleExportPlannedZwo: () => {},
        handleExportPlannedErg: () => {},
        handleSharePlannedWorkout: () => {},
        getSportIcon: () => null,
      })
    );
    expect(agendaHtml).toContain('w-52');
    expect(agendaHtml).toContain('data-testid="calendar-push-wahoo"');
    expect(agendaHtml).toContain('data-testid="calendar-push-garmin"');

    const calendarHtml = renderToStaticMarkup(
      React.createElement(CalendarView, {
        activities: [],
        wellnessDays: [],
        plannedEvents: [],
        envFilter: 'COMBINED',
        selectedSport: 'ALL',
        distanceUnit: 'mi',
        athleteFtp: 260,
        activeTeam: {
          ...squad,
          myMembershipId: 'demo-mem-ath-02',
        },
        onSelectActivity: () => {},
        onCreatePlannedEvent: async () => {},
        onUpdatePlannedEvent: async () => {},
        onDeletePlannedEvent: async () => {},
        onOpenCoachWithPrompt: () => {},
      })
    );
    expect(calendarHtml).toContain('data-testid="calendar-at-rtp-badge"');
    expect(calendarHtml).toContain('AT RTP: MODIFIED');

    const builderHtml = renderToStaticMarkup(
      React.createElement(VisualWorkoutBuilder, {
        dateIso: '2026-11-22',
        defaultSport: 'Running',
        distanceUnit: 'mi',
        activeTeam: squad,
        onSave: () => {},
      })
    );
    expect(builderHtml).toContain('data-testid="visual-builder-team-library-select"');
    expect(builderHtml).toContain('Load from Team Library');

    const preset = resolvePresetSharedWorkoutFromSearch('?preset=8x400');
    expect(preset).not.toBeNull();
    expect(preset?.title).toContain('8 × 400m');
    vi.stubGlobal('window', {
      location: { search: '?preset=8x400', origin: 'https://meetready.app' },
    });
    const shareHtml = renderToStaticMarkup(
      React.createElement(ShareWorkoutPage, {
        sharedWorkout: null,
        isDark: false,
        onToggleDark: () => {},
        hasActiveWorkspace: false,
        onImportToWorkspace: async () => {},
        onExitToSignIn: () => {},
        onExitToWorkspace: () => {},
      })
    );
    expect(shareHtml).toContain('8 × 400m Track Intervals');
    expect(shareHtml).toContain('data-testid="share-workout-hero"');
  });

  it('5. Daily Ops, Shoe Closet linkage, Attribution first-touch, Field outbox max attempts, and Support Diagnostics flag', async () => {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const squad = buildSampleDemoCoachSquad(todayIso);
    const opsHtml = renderToStaticMarkup(
      React.createElement(CoachDailyOpsPanel, {
        activeTeam: squad,
        myTeams: [squad],
        complexityTier: 'ESSENTIALS',
        onLaunchStopwatch: () => {},
        onLaunchFieldSheet: () => {},
        onTeamsUpdated: () => {},
      })
    );
    expect(opsHtml).toContain('data-testid="attendance-date-picker"');
    expect(opsHtml).toContain('data-testid="attendance-export-csv-btn"');
    expect(opsHtml).toContain('data-testid="roll-call-at-badge-demo-mem-ath-02"');
    expect(opsHtml).toContain('AT MODIFIED');
    expect(opsHtml).toContain('Schedule Change');

    const attCsv = buildAttendanceCsv({
      dateIso: todayIso,
      teamName: 'WGHS XC',
      members: squad.memberships.filter((m) => m.role === 'ATHLETE'),
      attendanceByMember: { 'demo-mem-ath-01': 'PRESENT', 'demo-mem-ath-02': 'INJURED_MODIFIED' },
      savedRecords: squad.attendanceByDate?.[todayIso],
      injuryCases: squad.injuryCases,
    });
    expect(attCsv).toContain('INJURED_MODIFIED');
    expect(attCsv).toContain('GPS_GEOFENCE');

    const shoe: AthleteGearItem = {
      id: 'shoe-peg-41',
      name: 'Nike Pegasus 41',
      type: 'SHOE',
      distanceMeters: 120000,
      maxRecommendedMeters: 720000,
      primary: true,
      footwearClass: 'DAILY_TRAINER',
    };
    const loggedAct = makeTestActivity({
      id: 'run-gear-test',
      startDateLocal: `${todayIso}T16:00:00`,
      name: 'Afternoon Easy Run',
      movingTimeSecs: 1800,
      distanceMeters: 6437,
      elevationGainMeters: 20,
      intensityFactor: 0.72,
      trainingLoad: 42,
      aerobicDecouplingPct: 1,
      efficiencyFactor: 1.4,
      zoneSecs: { hr: [0, 1800, 0, 0, 0, 0, 0] },
      gearId: shoe.id,
      gearName: shoe.name,
    });
    expect(doesActivityMatchGear(loggedAct, shoe)).toBe(true);

    const quickHtml = renderToStaticMarkup(
      React.createElement(QuickRunLoggerCard, {
        distanceUnit: 'mi',
        athleteProfile: buildCompleteAthleteProfile({}),
        onSaveRun: () => {},
        gearItems: [shoe],
      })
    );
    expect(quickHtml).toContain('quick-log-run-btn');

    const inspectorHtml = renderToStaticMarkup(
      React.createElement(ActivityInspectorModal, {
        selectedActivity: loggedAct,
        activities: [loggedAct],
        distanceUnit: 'mi',
        athleteWeightKg: 65,
        compareIdB: null,
        onSelectActivity: () => {},
        isScanningSegments: false,
        isWorkerProcessing: false,
        workerAnalytics: null,
        onTriggerWorker1HzUpsample: () => {},
        onAssignToCompareSlot: () => {},
        similarHistoricalWorkouts: [],
        segmentHistoryBySegmentId: new Map(),
        repeatedSegmentsList: [],
        gearItems: [shoe],
      })
    );
    expect(inspectorHtml).toContain('data-testid="inspector-quicklog-gear-select"');
    expect(inspectorHtml).toContain('Nike Pegasus 41');

    const hubHtml = renderToStaticMarkup(
      React.createElement(PublicTeamHubPage, {
        slugOrCode: 'willow-glen-high-school-xc',
        isDark: false,
        onToggleDark: () => {},
        onExitHub: () => {},
        initialPayloadForTest: {
          found: true,
          brand: {
            teamId: squad.brand.teamId,
            slug: squad.brand.slug,
            name: squad.brand.name,
            shortName: squad.brand.shortName,
            orgType: squad.brand.orgType,
            primarySport: squad.brand.primarySport,
            primaryHex: squad.brand.primaryHex,
            secondaryHex: squad.brand.secondaryHex,
            defaultSafeSportShield: true,
            coachDisplayName: squad.brand.coachDisplayName,
          },
          upcomingMeets: [],
          recentSchedule: [],
          rosterLeaderboard: [],
          announcements: [
            {
              id: 'ann-sched-1',
              teamId: squad.brand.teamId,
              title: 'Bus Departure Earlier',
              body: 'Buses roll at 1:30 PM sharp.',
              category: 'SCHEDULE_CHANGE',
              publishToParentHub: true,
              authorName: 'Coach Morales',
              createdAt: `${todayIso}T08:00:00Z`,
            },
            ...(squad.announcements || []),
          ],
          stats: {
            athleteCount: 1,
            meetCount: 0,
            officialResultCount: 0,
          },
        },
      })
    );
    expect(hubHtml).toContain(
      '/?role=coach&amp;utm_source=parent_hub&amp;utm_medium=footer&amp;utm_campaign=team_hub'
    );
    expect(hubHtml).toContain('[Schedule Change]');

    const store = new Map<string, string>();
    const stubWindowLocation = {
      search: '?utm_source=initial',
      pathname: '/start-coach',
      hash: '',
      hostname: 'meetready.app',
    };
    vi.stubGlobal('window', {
      location: stubWindowLocation,
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
      },
    });
    const first = captureLandingAttribution();
    expect(first?.landing_path).toBe('/start-coach');
    stubWindowLocation.search = '?utm_source=second_click';
    stubWindowLocation.pathname = '/other-page';
    const second = captureLandingAttribution();
    expect(second?.landing_path).toBe('/start-coach');
    expect(second?.utm_source).toBe('second_click');

    expect(MAX_FIELD_OUTBOX_ATTEMPTS).toBe(5);
    const localMap = new Map<string, string>();
    localMap.set(STORAGE_KEYS.SAMPLE_DEMO_ACTIVE, 'true');
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => localMap.get(k) ?? null,
      setItem: (k: string, v: string) => localMap.set(k, v),
      removeItem: (k: string) => localMap.delete(k),
    });
    const diagTrue = await buildSupportDiagnosticsSnapshot({ skipHealthProbe: true });
    expect(diagTrue.featureFlags.sampleDemoActive).toBe(true);
    localMap.set(STORAGE_KEYS.SAMPLE_DEMO_ACTIVE, '1');
    const diagOne = await buildSupportDiagnosticsSnapshot({ skipHealthProbe: true });
    expect(diagOne.featureFlags.sampleDemoActive).toBe(true);

    saveFieldOutbox([
      {
        batchId: 'poison-field-batch',
        clientBatchId: 'poison-field-batch',
        teamId: 'tm_live',
        entries: [
          {
            athleteName: 'Tester',
            date: todayIso,
            eventCode: 'LJ',
            attempts: [{ attemptNumber: 1, outcome: 'FOUL' }],
          },
        ],
        createdAt: `${todayIso}T00:00:00Z`,
        attempts: 5,
      },
    ]);
    const flushPoison = await flushFieldOutbox();
    expect(flushPoison.droppedBatches).toBe(1);
    expect(loadFieldOutbox()).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});
