import React, { Suspense, lazy, useEffect } from 'react';
import { Activity, Calendar, Target, Timer } from './icons/PhosphorIcons';
import type {
  ActiveTab,
  AnnualMileageGoal,
  AthleteGearItem,
  AthleteProfile,
  BenchmarkSegmentHistory,
  CoachWorkspaceSubTab,
  ConnectedAthleteRecord,
  DistanceUnit,
  EnvironmentFilter,
  PlannedWorkoutEvent,
  SportCategory,
  StravaSyncWindow,
  TargetGoal,
  TeamSummaryWithRole,
  TrackWorkoutSpec,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import type { PlannedEventBatchItem } from './GoalsView';
import type { SavedStopwatchEntry } from './TracksideStopwatchView';

const CalendarView = lazy(() =>
  import('./CalendarView').then((m) => ({ default: m.CalendarView }))
);
const FitnessHealthView = lazy(() =>
  import('./FitnessHealthView').then((m) => ({ default: m.FitnessHealthView }))
);
const TodayPhysiologyDeepDive = lazy(() =>
  import('./TodayPhysiologyDeepDive').then((m) => ({ default: m.TodayPhysiologyDeepDive }))
);
const ActivitiesView = lazy(() =>
  import('./ActivitiesView').then((m) => ({ default: m.ActivitiesView }))
);
const GoalsView = lazy(() =>
  import('./GoalsView').then((m) => ({ default: m.GoalsView }))
);
const TracksideStopwatchView = lazy(() =>
  import('./TracksideStopwatchView').then((m) => ({ default: m.TracksideStopwatchView }))
);
const CoachWorkspaceView = lazy(() =>
  import('./CoachWorkspaceView').then((m) => ({ default: m.CoachWorkspaceView }))
);

export const ViewLoadingSkeleton: React.FC = () => (
  <div className="rounded-2xl liquid-glass p-8 text-center text-xs font-mono text-slate-500 dark:text-slate-400 animate-pulse">
    Loading workspace view...
  </div>
);

export interface WorkspaceRouterProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  effectiveActivities: UnifiedActivity[];
  effectiveWellnessDays: UnifiedWellnessDay[];
  effectivePlannedEvents: PlannedWorkoutEvent[];
  effectiveTargetGoals: TargetGoal[];
  effectiveAnnualMileageGoals: AnnualMileageGoal[];
  effectiveGearItems: AthleteGearItem[];
  envFilter: EnvironmentFilter;
  setEnvFilter: (env: EnvironmentFilter) => void;
  selectedSport: SportCategory | 'ALL';
  setSelectedSport: (sport: SportCategory | 'ALL') => void;
  distanceUnit: DistanceUnit;
  athleteFtp: number;
  latestWeightKg: number;
  latestCtl: number;
  effectiveAthleteProfile: AthleteProfile;
  primaryAthleteDisplayName: string;
  combinedRoster: ConnectedAthleteRecord[];
  myTeams: TeamSummaryWithRole[];
  activeTeamId: string | null;
  selectedActivity: UnifiedActivity | null;
  benchmarkSegments: BenchmarkSegmentHistory[];
  isScanningSegments: boolean;
  isHydratingRoutes: boolean;
  coachSubTab: CoachWorkspaceSubTab;
  setCoachSubTab: (tab: CoachWorkspaceSubTab) => void;
  activeTeam: TeamSummaryWithRole | null;
  activeViewedAthleteId: string;
  onSelectAthleteViewport: (athleteId: string) => void;
  resendConfigured: boolean;
  onSelectActiveTeam: (teamId: string | null) => void;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string) => void;
  stravaSyncWindow?: StravaSyncWindow;
  onOpenDataSources?: () => void;

  // Handlers
  handleSelectActivityAndOpenTab: (act: UnifiedActivity) => void;
  handleCalendarCreatePlannedEvent: (event: {
    date: string;
    name: string;
    sportCategory: SportCategory;
    environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
    plannedDurationSecs: number;
    plannedLoad: number;
    workoutSyntax: string;
    description: string;
    trackSpec?: TrackWorkoutSpec;
    replaceExistingDate?: boolean;
  }) => Promise<void>;
  handleDeletePlannedEvent: (id: string) => Promise<void>;
  handleBatchCreatePlannedEvents: (batch: PlannedEventBatchItem[]) => Promise<void>;
  handleOpenTodayTab: () => void;
  handleOpenProfileModal: () => void;
  handleOpenGoalsTab: () => void;
  handleOpenOfficialRaceModal: () => void;
  handleOpenCoachWithPrompt: (prompt: string) => void;
  handleOpenRosterModal: () => void;
  handleCreatePlannedEvent: (eventInput: {
    date: string;
    name: string;
    sportCategory: SportCategory;
    environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
    plannedDurationSecs: number;
    plannedLoad: number;
    workoutSyntax: string;
    description: string;
    trackSpec?: TrackWorkoutSpec;
    replaceExistingDate?: boolean;
  }) => Promise<void>;
  handleSelectActivity: (activity: UnifiedActivity | null) => void;
  loadStreamsForActivity: (activity: UnifiedActivity) => Promise<void>;
  handleScanMoreSegments: () => Promise<void>;
  handleHydrateMoreRoutes: () => Promise<void>;
  handleToggleActivityKudos: (activity: UnifiedActivity) => Promise<void>;
  handleAddActivityComment: (activity: UnifiedActivity, text: string) => Promise<void>;
  handleImportSingleParsedActivity: (activity: UnifiedActivity) => void;
  handleImportMultipleParsedActivities: (activities: UnifiedActivity[]) => void;
  handleOpenActivitiesTab: () => void;
  handleUpdateAnnualMileageGoal: (sport: 'Running' | 'Cycling', targetMeters: number) => void;
  handleAddTargetGoal: (newGoal: Omit<TargetGoal, 'id'>) => void;
  handleDeleteTargetGoal: (id: string) => void;
  handleSaveProfileOverride: (updatedProfile: AthleteProfile) => Promise<void>;
  handleSwitchToCalendarTab: () => void;
  handleSaveStopwatchActivities: (entries: SavedStopwatchEntry[]) => number;
}

export const WorkspaceRouter: React.FC<WorkspaceRouterProps> = ({
  activeTab,
  setActiveTab,
  effectiveActivities,
  effectiveWellnessDays,
  effectivePlannedEvents,
  effectiveTargetGoals,
  effectiveAnnualMileageGoals,
  effectiveGearItems,
  envFilter,
  setEnvFilter,
  selectedSport,
  setSelectedSport,
  distanceUnit,
  athleteFtp,
  latestWeightKg,
  latestCtl,
  effectiveAthleteProfile,
  primaryAthleteDisplayName,
  combinedRoster,
  myTeams,
  activeTeamId,
  selectedActivity,
  benchmarkSegments,
  isScanningSegments,
  isHydratingRoutes,
  coachSubTab,
  setCoachSubTab,
  activeTeam,
  activeViewedAthleteId,
  onSelectAthleteViewport,
  resendConfigured,
  onSelectActiveTeam,
  onTeamsUpdated,
  stravaSyncWindow,
  onOpenDataSources,

  handleSelectActivityAndOpenTab,
  handleCalendarCreatePlannedEvent,
  handleDeletePlannedEvent,
  handleBatchCreatePlannedEvents,
  handleOpenTodayTab,
  handleOpenProfileModal,
  handleOpenGoalsTab,
  handleOpenOfficialRaceModal,
  handleOpenCoachWithPrompt,
  handleOpenRosterModal,
  handleCreatePlannedEvent,
  handleSelectActivity,
  loadStreamsForActivity,
  handleScanMoreSegments,
  handleHydrateMoreRoutes,
  handleToggleActivityKudos,
  handleAddActivityComment,
  handleImportSingleParsedActivity,
  handleImportMultipleParsedActivities,
  handleOpenActivitiesTab,
  handleUpdateAnnualMileageGoal,
  handleAddTargetGoal,
  handleDeleteTargetGoal,
  handleSaveProfileOverride,
  handleSwitchToCalendarTab,
  handleSaveStopwatchActivities,
}) => {
  // Warm lazy workspace chunks on idle so trackside Airplane Mode navigation never hits network
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void import('./CalendarView');
      void import('./TracksideStopwatchView');
      void import('./ActivitiesView');
      void import('./CoachWorkspaceView');
    }, 900);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <Suspense fallback={<ViewLoadingSkeleton />}>
      {/* Contextual Sub-Switcher inside Training Calendar (Calendar | Activity Log + quick Stopwatch / Plan Builder) */}
      {(activeTab === 'calendar' || activeTab === 'activities') && (
        <div className="rounded-2xl liquid-glass p-2 flex flex-wrap items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label="Training Calendar views"
            className="flex items-center gap-1 p-1 bg-white/70 dark:bg-[#121B15]/80 backdrop-blur-md border border-emerald-900/15 dark:border-[#244331] rounded-xl shadow-xs"
          >
            <button
              type="button"
              role="tab"
              data-testid="calendar-subview-grid"
              aria-selected={activeTab === 'calendar'}
              onClick={() => setActiveTab('calendar')}
              className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold tracking-tight transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                activeTab === 'calendar'
                  ? 'ap-nav-volt-active shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Calendar</span>
            </button>

            <button
              type="button"
              role="tab"
              data-testid="calendar-subview-log"
              aria-selected={activeTab === 'activities'}
              onClick={() => setActiveTab('activities')}
              className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold tracking-tight transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                activeTab === 'activities'
                  ? 'ap-nav-volt-active shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Activity Log ({effectiveActivities.length})</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="calendar-bar-stopwatch-btn"
              onClick={() => setActiveTab('stopwatch')}
              className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl liquid-glass-subtle hover:border-[#28573B] text-xs font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Timer className="w-3.5 h-3.5 ap-text-brand" />
              <span>Time Session</span>
            </button>
            <button
              type="button"
              data-testid="calendar-bar-plan-builder-btn"
              onClick={() => setActiveTab('totals')}
              className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl ap-btn-secondary text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Target className="w-3.5 h-3.5" />
              <span>Plan Builder</span>
            </button>
          </div>
        </div>
      )}

      {activeTab === 'calendar' && (
        <CalendarView
          activities={effectiveActivities}
          wellnessDays={effectiveWellnessDays}
          plannedEvents={effectivePlannedEvents}
          targetGoals={effectiveTargetGoals}
          envFilter={envFilter}
          selectedSport={selectedSport}
          onSelectSport={setSelectedSport}
          distanceUnit={distanceUnit}
          athleteFtp={athleteFtp}
          athleteProfile={effectiveAthleteProfile}
          onSelectActivity={handleSelectActivityAndOpenTab}
          onCreatePlannedEvent={handleCalendarCreatePlannedEvent}
          onDeletePlannedEvent={handleDeletePlannedEvent}
          onBatchCreatePlannedEvents={handleBatchCreatePlannedEvents}
          onOpenTodayWorkout={handleOpenTodayTab}
          onOpenAthleteProfileModal={handleOpenProfileModal}
          onOpenGoalsArchitect={handleOpenGoalsTab}
          onOpenOfficialRaceModal={handleOpenOfficialRaceModal}
          onOpenCoachWithPrompt={handleOpenCoachWithPrompt}
          onOpenTracksideStopwatch={() => setActiveTab('stopwatch')}
        />
      )}

      {(activeTab === 'fitness' ||
        activeTab === 'curves' ||
        activeTab === 'trends' ||
        activeTab === 'charts') && (
        <div className="space-y-6">
          <FitnessHealthView
            wellnessDays={effectiveWellnessDays}
            plannedEvents={effectivePlannedEvents}
            activities={effectiveActivities}
            athleteProfile={effectiveAthleteProfile}
            distanceUnit={distanceUnit}
            selfName={primaryAthleteDisplayName}
            selfProfile={effectiveAthleteProfile}
            selfWellnessDays={effectiveWellnessDays}
            connectedAthletes={combinedRoster}
            onOpenRosterModal={handleOpenRosterModal}
            onSelectActivity={handleSelectActivityAndOpenTab}
            onSyncMorphedToCalendar={handleCreatePlannedEvent}
            onOpenAthleteProfileModal={handleOpenProfileModal}
            onOpenCoachWithPrompt={handleOpenCoachWithPrompt}
            onQuickLogRun={handleImportSingleParsedActivity}
          />

          <TodayPhysiologyDeepDive
            activities={effectiveActivities}
            wellnessDays={effectiveWellnessDays}
            annualMileageGoals={effectiveAnnualMileageGoals}
            targetGoals={effectiveTargetGoals}
            benchmarkSegments={benchmarkSegments}
            envFilter={envFilter}
            onSelectEnvFilter={setEnvFilter}
            distanceUnit={distanceUnit}
            athleteWeightKg={latestWeightKg}
            currentCtl={latestCtl}
            athleteProfile={effectiveAthleteProfile}
            isScanningSegments={isScanningSegments}
            stravaSyncWindow={stravaSyncWindow}
            initialOpen={activeTab !== 'fitness'}
            initialSection={
              activeTab === 'curves'
                ? 'CURVES'
                : activeTab === 'trends' || activeTab === 'charts'
                  ? 'TRENDS'
                  : 'CURVES'
            }
            onScanMoreSegments={handleScanMoreSegments}
            onSelectActivity={handleSelectActivityAndOpenTab}
            onOpenActivitiesSegments={handleOpenActivitiesTab}
            onOpenCoachWithPrompt={handleOpenCoachWithPrompt}
            onUpdateAnnualMileageGoal={handleUpdateAnnualMileageGoal}
            onSaveProfileOverride={handleSaveProfileOverride}
            onOpenOfficialRaceModal={handleOpenOfficialRaceModal}
            onOpenDataSources={onOpenDataSources}
          />
        </div>
      )}

      {activeTab === 'activities' && (
        <ActivitiesView
          activities={effectiveActivities}
          plannedEvents={effectivePlannedEvents}
          selectedSport={selectedSport}
          onSelectSport={setSelectedSport}
          envFilter={envFilter}
          onSelectEnvFilter={setEnvFilter}
          distanceUnit={distanceUnit}
          selectedActivity={selectedActivity}
          onSelectActivity={handleSelectActivity}
          onLoadActivityStreams={loadStreamsForActivity}
          onScanMoreSegments={handleScanMoreSegments}
          isScanningSegments={isScanningSegments}
          onHydrateMoreRoutes={handleHydrateMoreRoutes}
          isHydratingRoutes={isHydratingRoutes}
          onToggleKudos={handleToggleActivityKudos}
          onAddComment={handleAddActivityComment}
          onOpenOfficialRaceModal={handleOpenOfficialRaceModal}
          onImportParsedActivity={handleImportSingleParsedActivity}
          onImportParsedActivities={handleImportMultipleParsedActivities}
          onOpenTracksideStopwatch={() => setActiveTab('stopwatch')}
          athleteWeightKg={latestWeightKg}
          athleteProfile={effectiveAthleteProfile}
        />
      )}

      {activeTab === 'totals' && (
        <GoalsView
          annualMileageGoals={effectiveAnnualMileageGoals}
          onUpdateAnnualMileageGoal={handleUpdateAnnualMileageGoal}
          targetGoals={effectiveTargetGoals}
          onAddTargetGoal={handleAddTargetGoal}
          onDeleteTargetGoal={handleDeleteTargetGoal}
          activities={effectiveActivities}
          wellnessDays={effectiveWellnessDays}
          plannedEvents={effectivePlannedEvents}
          gearItems={effectiveGearItems}
          envFilter={envFilter}
          onSelectEnvFilter={setEnvFilter}
          distanceUnit={distanceUnit}
          currentCtl={latestCtl}
          athleteProfile={effectiveAthleteProfile}
          onBatchCreatePlannedEvents={handleBatchCreatePlannedEvents}
          onSaveProfileOverride={handleSaveProfileOverride}
          onSelectActivity={handleSelectActivityAndOpenTab}
          onSwitchToCalendar={handleSwitchToCalendarTab}
          onOpenOfficialRaceModal={handleOpenOfficialRaceModal}
          onOpenCoachWithPrompt={handleOpenCoachWithPrompt}
          onOpenTracksideStopwatch={() => setActiveTab('stopwatch')}
        />
      )}

      {activeTab === 'stopwatch' && (
        <TracksideStopwatchView
          selfName={primaryAthleteDisplayName}
          selfProfile={effectiveAthleteProfile}
          roster={combinedRoster}
          myTeams={myTeams}
          activeTeamId={activeTeamId}
          onSaveStopwatchActivities={handleSaveStopwatchActivities}
          onOpenActivitiesTab={handleOpenActivitiesTab}
          onOpenRosterModal={handleOpenRosterModal}
        />
      )}

      {activeTab === 'coach' && (
        <CoachWorkspaceView
          subTab={coachSubTab}
          setSubTab={setCoachSubTab}
          activeTeam={activeTeam}
          myTeams={myTeams}
          activeTeamId={activeTeamId}
          onSelectActiveTeam={onSelectActiveTeam}
          combinedRoster={combinedRoster}
          activeViewedAthleteId={activeViewedAthleteId}
          onSelectAthleteViewport={onSelectAthleteViewport}
          primaryAthleteDisplayName={primaryAthleteDisplayName}
          selfProfile={effectiveAthleteProfile}
          athleteFtp={athleteFtp}
          effectivePlannedEvents={effectivePlannedEvents}
          effectiveActivities={effectiveActivities}
          effectiveWellnessDays={effectiveWellnessDays}
          effectiveTargetGoals={effectiveTargetGoals}
          envFilter={envFilter}
          selectedSport={selectedSport}
          onSelectSport={setSelectedSport}
          distanceUnit={distanceUnit}
          resendConfigured={resendConfigured}
          onTeamsUpdated={onTeamsUpdated}
          onSelectActivityAndOpenTab={handleSelectActivityAndOpenTab}
          onCreatePlannedEvent={handleCalendarCreatePlannedEvent}
          onDeletePlannedEvent={handleDeletePlannedEvent}
          onBatchCreatePlannedEvents={handleBatchCreatePlannedEvents}
          onOpenProfileModal={handleOpenProfileModal}
          onOpenGoalsTab={handleOpenGoalsTab}
          onOpenOfficialRaceModal={handleOpenOfficialRaceModal}
          onOpenCoachWithPrompt={handleOpenCoachWithPrompt}
          onSaveStopwatchActivities={handleSaveStopwatchActivities}
          onOpenAthleteToday={handleOpenTodayTab}
          onOpenRosterModal={handleOpenRosterModal}
        />
      )}

      {/* Global In-Place 3-Tab Activity Inspector Modal (no activeTab hijack) */}
      {selectedActivity !== null && activeTab !== 'activities' && (
        <ActivitiesView
          inspectorOnly
          onOpenCompareView={() => setActiveTab('activities')}
          activities={effectiveActivities}
          plannedEvents={effectivePlannedEvents}
          selectedSport={selectedSport}
          onSelectSport={setSelectedSport}
          envFilter={envFilter}
          onSelectEnvFilter={setEnvFilter}
          distanceUnit={distanceUnit}
          selectedActivity={selectedActivity}
          onSelectActivity={handleSelectActivity}
          onLoadActivityStreams={loadStreamsForActivity}
          onScanMoreSegments={handleScanMoreSegments}
          isScanningSegments={isScanningSegments}
          onHydrateMoreRoutes={handleHydrateMoreRoutes}
          isHydratingRoutes={isHydratingRoutes}
          onToggleKudos={handleToggleActivityKudos}
          onAddComment={handleAddActivityComment}
          onOpenOfficialRaceModal={handleOpenOfficialRaceModal}
          onImportParsedActivity={handleImportSingleParsedActivity}
          onImportParsedActivities={handleImportMultipleParsedActivities}
          onOpenTracksideStopwatch={() => setActiveTab('stopwatch')}
          athleteWeightKg={latestWeightKg}
          athleteProfile={effectiveAthleteProfile}
        />
      )}
    </Suspense>
  );
};
