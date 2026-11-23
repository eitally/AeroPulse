import React, { Suspense, useMemo, useState } from 'react';
import type {
  AthleteProfile,
  CoachEventGroup,
  ConnectedAthleteRecord,
  DistanceUnit,
  EnvironmentFilter,
  PlannedWorkoutEvent,
  PracticeVenueCategory,
  SportCategory,
  TargetGoal,
  TeamEventRecord,
  TeamEventRsvpCounts,
  TeamEventRsvpRecord,
  TeamSummaryWithRole,
  TrackWorkoutSpec,
  UnifiedActivity,
  UnifiedWellnessDay,
  WorkoutSessionSlot,
} from '../../types';
import type { PlannedEventBatchItem } from '../GoalsView';
import type { VdotPodRosterInput } from '../../physiology/scholasticEngine';
import type { SaveTeamEventInput } from '../../utils/teamEventsApi';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { WorkspaceErrorBoundary } from '../WorkspaceErrorBoundary';
import { Calendar, Trophy, Users } from '../icons/PhosphorIcons';
import type { CoachDelegateTimingPreset } from '../stopwatch/CoachDelegateTimingModal';
import type { TracksideStopwatchLaunchPreset } from '../TracksideStopwatchView';

const CoachTeamEventsBar = lazyWithRetry(
  () =>
    import('./CoachTeamEventsBar').then((m) => ({
      default: m.CoachTeamEventsBar,
    })),
  { chunkKey: 'CoachTeamEventsBar', restoreTab: 'coach' }
);

const CalendarView = lazyWithRetry(
  () => import('../CalendarView').then((m) => ({ default: m.CalendarView })),
  { chunkKey: 'CoachCalendarView', restoreTab: 'coach' }
);
const MeetDayHeatAndFlightModal = lazyWithRetry(
  () =>
    import('./MeetDayHeatAndFlightModal').then((m) => ({
      default: m.MeetDayHeatAndFlightModal,
    })),
  { chunkKey: 'MeetDayHeatAndFlightModal', restoreTab: 'coach' }
);
const ScholasticRelayAndTopTimesPanel = lazyWithRetry(
  () =>
    import('../track/ScholasticRelayAndTopTimesPanel').then((m) => ({
      default: m.ScholasticRelayAndTopTimesPanel,
    })),
  { chunkKey: 'ScholasticRelayAndTopTimesPanel', restoreTab: 'coach' }
);

export type MeetsPlanSubView = 'CALENDAR' | 'MEET_DAY' | 'RELAYS';

const VALID_EVENT_GROUP_CHIPS: ReadonlyArray<{ id: CoachEventGroup | 'ALL'; label: string }> = [
  { id: 'ALL', label: 'All Groups' },
  { id: 'DISTANCE', label: 'Distance' },
  { id: 'MID_DISTANCE', label: 'Mid-Dist' },
  { id: 'SPRINTS', label: 'Sprints' },
  { id: 'HURDLES', label: 'Hurdles' },
  { id: 'JUMPS', label: 'Jumps' },
  { id: 'POLE_VAULT', label: 'Pole Vault' },
  { id: 'THROWS', label: 'Throws' },
  { id: 'MULTI', label: 'Multi' },
];

export interface CoachMeetsAndPlanViewProps {
  subView: MeetsPlanSubView;
  onSelectSubView: (view: MeetsPlanSubView) => void;
  showRelayOptimizer: boolean;
  teamPlanError: string | null;
  activeTeam: TeamSummaryWithRole | null;
  myTeams: TeamSummaryWithRole[];
  connectedAthletesOnly: ConnectedAthleteRecord[];
  scopedConnectedAthletes: ConnectedAthleteRecord[];
  podRoster: VdotPodRosterInput[];
  primaryAthleteDisplayName: string;
  selfProfile: AthleteProfile;
  athleteFtp: number;
  teamPlanEvents: PlannedWorkoutEvent[];
  effectiveActivities: UnifiedActivity[];
  effectiveWellnessDays: UnifiedWellnessDay[];
  effectiveTargetGoals: TargetGoal[];
  envFilter: EnvironmentFilter;
  selectedSport: SportCategory | 'ALL';
  onSelectSport: (sport: SportCategory | 'ALL') => void;
  distanceUnit: DistanceUnit;
  isDemoTeam: boolean;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string | null) => void;
  onSelectActivityAndOpenTab: (act: UnifiedActivity) => void;
  onCreateTeamEvent: (eventInput: {
    date: string;
    name: string;
    sportCategory: SportCategory;
    environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
    plannedDurationSecs: number;
    plannedLoad: number;
    workoutSyntax: string;
    description: string;
    scheduledTime?: string;
    sessionSlot?: WorkoutSessionSlot;
    locationName?: string;
    locationCategory?: PracticeVenueCategory;
    meetingNotes?: string;
    trackSpec?: TrackWorkoutSpec;
    replaceExistingDate?: boolean;
  }) => Promise<void>;
  onUpdateTeamEvent: (
    id: string,
    patch: {
      date: string;
      name: string;
      sportCategory: SportCategory;
      environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
      plannedDurationSecs: number;
      plannedLoad: number;
      workoutSyntax: string;
      description: string;
      scheduledTime?: string;
      sessionSlot?: WorkoutSessionSlot;
      locationName?: string;
      locationCategory?: PracticeVenueCategory;
      meetingNotes?: string;
      trackSpec?: TrackWorkoutSpec;
    }
  ) => Promise<void>;
  onDeleteTeamEvent: (id: string) => Promise<void>;
  onDeleteTeamPlanBlock?: (planBlockId: string) => Promise<void>;
  onBatchCreateTeamEvents: (items: PlannedEventBatchItem[]) => Promise<void>;
  onOpenAthleteToday: () => void;
  onOpenProfileModal: () => void;
  onOpenGoalsTab: () => void;
  onOpenOfficialRaceModal: () => void;
  onOpenCoachWithPrompt: (prompt: string) => void;
  onLaunchStopwatchPreset: (preset: TracksideStopwatchLaunchPreset) => void;
  onOpenStopwatchDirect: () => void;
  onDelegateEventTimer: (preset: CoachDelegateTimingPreset) => void;
  teamEvents?: TeamEventRecord[];
  teamEventRsvpCounts?: Record<string, TeamEventRsvpCounts>;
  nextMeetRsvpsByMemberId?: Record<string, TeamEventRsvpRecord>;
  isSavingTeamEvent?: boolean;
  onSaveTeamEvent?: (input: SaveTeamEventInput) => Promise<void>;
  onDeleteScheduleEvent?: (eventId: string) => Promise<void>;
}

export const CoachMeetsAndPlanView: React.FC<CoachMeetsAndPlanViewProps> = ({
  subView,
  onSelectSubView,
  showRelayOptimizer,
  teamPlanError,
  activeTeam,
  myTeams,
  connectedAthletesOnly,
  scopedConnectedAthletes,
  podRoster,
  selfProfile,
  athleteFtp,
  teamPlanEvents,
  effectiveActivities,
  effectiveWellnessDays,
  effectiveTargetGoals,
  envFilter,
  selectedSport,
  onSelectSport,
  distanceUnit,
  isDemoTeam,
  onTeamsUpdated,
  onSelectActivityAndOpenTab,
  onCreateTeamEvent,
  onUpdateTeamEvent,
  onDeleteTeamEvent,
  onDeleteTeamPlanBlock,
  onBatchCreateTeamEvents,
  onOpenAthleteToday,
  onOpenProfileModal,
  onOpenGoalsTab,
  onOpenOfficialRaceModal,
  onOpenCoachWithPrompt,
  onLaunchStopwatchPreset,
  onOpenStopwatchDirect,
  onDelegateEventTimer,
  teamEvents = [],
  teamEventRsvpCounts = {},
  nextMeetRsvpsByMemberId = {},
  isSavingTeamEvent = false,
  onSaveTeamEvent,
  onDeleteScheduleEvent,
}) => {
  const [calendarGroupFilter, setCalendarGroupFilter] = useState<CoachEventGroup | 'ALL'>('ALL');

  const filteredCalendarEvents = useMemo(() => {
    if (calendarGroupFilter === 'ALL' || !activeTeam) return teamPlanEvents;
    const broadcastMap = new Map(
      (activeTeam.broadcastWorkouts || []).map((bw) => [bw.broadcastId, bw])
    );
    return teamPlanEvents.filter((ev) => {
      const bc = broadcastMap.get(ev.id);
      if (!bc || !bc.targetEventGroups || bc.targetEventGroups.length === 0) {
        return true;
      }
      return bc.targetEventGroups.includes(calendarGroupFilter);
    });
  }, [calendarGroupFilter, activeTeam, teamPlanEvents]);

  const relayCandidates = useMemo(
    () =>
      scopedConnectedAthletes
        .filter((a) => a.teamMemberStatus !== 'INJURED')
        .map((a) => ({
          id: a.id,
          name: a.name,
          thresholdPaceSecsPerKm: a.athleteProfile.thresholdPaceSecsPerKm || 250,
          genderDivision:
            a.genderDivision ||
            (a.athleteProfile.competitionGender === 'WOMEN'
              ? 'F'
              : a.athleteProfile.competitionGender === 'MEN'
                ? 'M'
                : undefined),
        })),
    [scopedConnectedAthletes]
  );

  return (
    <div className="space-y-3">
      {activeTeam && onSaveTeamEvent && onDeleteScheduleEvent && (
        <Suspense fallback={null}>
          <CoachTeamEventsBar
            teamId={activeTeam.brand.teamId}
            isDemoMode={isDemoTeam}
            events={teamEvents}
            rsvpCountsByEventId={teamEventRsvpCounts}
            isSaving={isSavingTeamEvent}
            onSaveEvent={onSaveTeamEvent}
            onDeleteEvent={onDeleteScheduleEvent}
          />
        </Suspense>
      )}
      {/* Clean Sub-View Segmented Bar */}
      <div className="rounded-2xl liquid-glass px-3 py-2 flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Meets and Plan Views"
          className="inline-flex flex-wrap items-center gap-1 p-0.5 rounded-xl liquid-capsule-track text-xs font-bold"
        >
          <button
            type="button"
            role="tab"
            data-testid="meets-subview-calendar"
            aria-selected={subView === 'CALENDAR'}
            onClick={() => onSelectSubView('CALENDAR')}
            className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-lg inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
              subView === 'CALENDAR'
                ? 'ap-nav-volt-active'
                : 'text-ap-ink dark:text-ap-chalk'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Team Calendar</span>
          </button>
          <button
            type="button"
            role="tab"
            data-testid="meets-subview-meetday"
            aria-selected={subView === 'MEET_DAY'}
            onClick={() => onSelectSubView('MEET_DAY')}
            className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-lg inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
              subView === 'MEET_DAY'
                ? 'ap-nav-volt-active'
                : 'text-ap-ink dark:text-ap-chalk'
            }`}
          >
            <Trophy className="w-3.5 h-3.5" />
            <span>Meet Day Hub</span>
          </button>
          {showRelayOptimizer && (
            <button
              type="button"
              role="tab"
              data-testid="meets-subview-relays"
              aria-selected={subView === 'RELAYS'}
              onClick={() => onSelectSubView('RELAYS')}
              className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-lg inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                subView === 'RELAYS'
                  ? 'ap-nav-volt-active'
                  : 'text-ap-ink dark:text-ap-chalk'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Relays &amp; Top Times</span>
            </button>
          )}
        </div>
      </div>

      {subView === 'MEET_DAY' && (
        <WorkspaceErrorBoundary fallbackTitle="Meet-Day Workspace" restoreTab="coach">
          <Suspense
            fallback={
              <div className="h-80 rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                Loading Meet-Day Command Center…
              </div>
            }
          >
            <MeetDayHeatAndFlightModal
              isOpen={true}
              inline={true}
              onClose={() => onSelectSubView('CALENDAR')}
              activeTeam={activeTeam}
              myTeams={myTeams}
              meetRsvpsByMemberId={nextMeetRsvpsByMemberId}
              connectedAthletes={connectedAthletesOnly}
              onTeamsUpdated={onTeamsUpdated}
              onLaunchEventStopwatch={(preset) => {
                onLaunchStopwatchPreset({
                  meetTitle: preset.meetTitle,
                  meetDate: preset.meetDate,
                  eventCode: preset.eventCode,
                  sessionType: 'RACE',
                  runners: preset.runners.map((r) => ({
                    membershipId: r.membershipId,
                    athleteName: r.athleteName,
                    hipOrLane: r.laneOrHip,
                  })),
                });
              }}
              onDelegateEventTimer={onDelegateEventTimer}
            />
          </Suspense>
        </WorkspaceErrorBoundary>
      )}

      {subView === 'RELAYS' && showRelayOptimizer && (
        <WorkspaceErrorBoundary fallbackTitle="Relay & Top Times" restoreTab="coach">
          <Suspense
            fallback={
              <div className="h-64 rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                Loading Relay Optimizer &amp; Top Times…
              </div>
            }
          >
            <ScholasticRelayAndTopTimesPanel
              candidates={relayCandidates.length > 0 ? relayCandidates : podRoster}
              roster={combinedFilterRoster(combinedFromScoped(connectedAthletesOnly))}
              meetRsvpsByMemberId={nextMeetRsvpsByMemberId}
            />
          </Suspense>
        </WorkspaceErrorBoundary>
      )}

      {subView === 'CALENDAR' && (
        <div className="space-y-3">
          {teamPlanError && (
            <div
              role="alert"
              className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50/90 dark:bg-red-950/50 px-3.5 py-2 text-xs font-semibold text-red-700 dark:text-red-300"
            >
              {teamPlanError}
            </div>
          )}

          {activeTeam && (
            <div
              role="group"
              aria-label="Filter team calendar by event group"
              className="flex flex-wrap items-center gap-1.5 rounded-xl liquid-glass-subtle px-3 py-2"
            >
              <span className="text-2xs font-mono uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark font-bold mr-1">
                Event Group:
              </span>
              {VALID_EVENT_GROUP_CHIPS.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  data-testid={`calendar-group-filter-${chip.id.toLowerCase()}`}
                  aria-pressed={calendarGroupFilter === chip.id}
                  onClick={() => setCalendarGroupFilter(chip.id)}
                  className={`min-h-[34px] px-2.5 py-0.5 rounded-full text-2xs font-mono font-semibold cursor-pointer ${
                    calendarGroupFilter === chip.id
                      ? 'ap-nav-volt-active'
                      : 'ap-card-inset text-ap-ink dark:text-ap-chalk'
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}

          <WorkspaceErrorBoundary fallbackTitle="Team Plan Calendar" restoreTab="coach">
            <Suspense
              fallback={
                <div className="h-80 rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                  Loading Team Plan Calendar…
                </div>
              }
            >
              <CalendarView
                activities={effectiveActivities}
                wellnessDays={effectiveWellnessDays}
                plannedEvents={filteredCalendarEvents}
                targetGoals={effectiveTargetGoals}
                envFilter={envFilter}
                selectedSport={selectedSport}
                onSelectSport={onSelectSport}
                distanceUnit={distanceUnit}
                athleteFtp={athleteFtp}
                athleteProfile={selfProfile}
                onSelectActivity={onSelectActivityAndOpenTab}
                onCreatePlannedEvent={onCreateTeamEvent}
                onUpdatePlannedEvent={onUpdateTeamEvent}
                onDeletePlannedEvent={onDeleteTeamEvent}
                onDeletePlanBlock={onDeleteTeamPlanBlock || (isDemoTeam ? undefined : undefined)}
                onBatchCreatePlannedEvents={onBatchCreateTeamEvents}
                onOpenTodayWorkout={onOpenAthleteToday}
                onOpenAthleteProfileModal={onOpenProfileModal}
                onOpenGoalsArchitect={onOpenGoalsTab}
                onOpenOfficialRaceModal={onOpenOfficialRaceModal}
                onOpenCoachWithPrompt={onOpenCoachWithPrompt}
                onOpenTracksideStopwatch={onOpenStopwatchDirect}
                activeTeam={activeTeam}
                isSampleDemoMode={isDemoTeam}
              />
            </Suspense>
          </WorkspaceErrorBoundary>
        </div>
      )}
    </div>
  );
};

function combinedFromScoped(list: ConnectedAthleteRecord[]): ConnectedAthleteRecord[] {
  return list;
}

function combinedFilterRoster(list: ConnectedAthleteRecord[]): ConnectedAthleteRecord[] {
  return list.filter(
    (a) => a.status === 'CONNECTED' && a.teamMemberStatus !== 'REVOKED'
  );
}
