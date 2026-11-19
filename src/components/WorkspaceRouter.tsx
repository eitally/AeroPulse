import React, { Suspense, useEffect } from 'react';
import { Activity, Calendar, Timer } from './icons/PhosphorIcons';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { WorkspaceErrorBoundary } from './WorkspaceErrorBoundary';
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
  PracticeVenueCategory,
  SessionCheckInRecord,
  SportCategory,
  StravaSyncWindow,
  TargetGoal,
  TeamSummaryWithRole,
  TrackWorkoutSpec,
  UnifiedActivity,
  UnifiedWellnessDay,
  WorkoutSessionSlot,
} from '../types';
import type { SafetySwapEventInput } from '../physiology/sessionCheckInAndDigestEngine';
import type { PlannedEventBatchItem } from './GoalsView';
import type { SavedStopwatchEntry } from './TracksideStopwatchView';
import type {
  StopwatchOutboxFlushResult,
  StopwatchSaveResult,
} from '../utils/stopwatchTeamSync';

const CalendarView = lazyWithRetry(
  () => import('./CalendarView').then((m) => ({ default: m.CalendarView })),
  { chunkKey: 'CalendarView', restoreTab: 'calendar' }
);
const FitnessHealthView = lazyWithRetry(
  () => import('./FitnessHealthView').then((m) => ({ default: m.FitnessHealthView })),
  { chunkKey: 'FitnessHealthView', restoreTab: 'fitness' }
);
const TodayPhysiologyDeepDive = lazyWithRetry(
  () => import('./TodayPhysiologyDeepDive').then((m) => ({ default: m.TodayPhysiologyDeepDive })),
  { chunkKey: 'TodayPhysiologyDeepDive', restoreTab: 'fitness' }
);
const ActivitiesView = lazyWithRetry(
  () => import('./ActivitiesView').then((m) => ({ default: m.ActivitiesView })),
  { chunkKey: 'ActivitiesView', restoreTab: 'activities' }
);
const GoalsView = lazyWithRetry(
  () => import('./GoalsView').then((m) => ({ default: m.GoalsView })),
  { chunkKey: 'GoalsView', restoreTab: 'totals' }
);
const TracksideStopwatchView = lazyWithRetry(
  () => import('./TracksideStopwatchView').then((m) => ({ default: m.TracksideStopwatchView })),
  { chunkKey: 'TracksideStopwatchView', restoreTab: 'stopwatch' }
);
const CoachWorkspaceView = lazyWithRetry(
  () => import('./CoachWorkspaceView').then((m) => ({ default: m.CoachWorkspaceView })),
  { chunkKey: 'CoachWorkspaceView', restoreTab: 'coach' }
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
  effectiveSessionCheckIns?: SessionCheckInRecord[];
  onRecordSessionCheckIn?: (
    input: Omit<SessionCheckInRecord, 'id' | 'createdAt'>,
    safetySwapEvent?: SafetySwapEventInput | null
  ) => Promise<void> | void;
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
  onTeamsUpdated: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string | null) => void;
  onOpenPublicTeamHub?: (slugOrCode: string) => void;
  onOpenCoachGuide?: () => void;
  isSampleDemoMode?: boolean;
  plainLanguageMode?: boolean;
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
    scheduledTime?: string;
    sessionSlot?: WorkoutSessionSlot;
    locationName?: string;
    locationCategory?: PracticeVenueCategory;
    meetingNotes?: string;
    trackSpec?: TrackWorkoutSpec;
    replaceExistingDate?: boolean;
    planBlockId?: string;
    planBlockName?: string;
    planWeekNum?: number;
  }) => Promise<void>;
  handleUpdatePlannedEvent: (
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
  handleDeletePlannedEvent: (id: string) => Promise<void>;
  handleDeletePlanBlock: (planBlockId: string) => Promise<void>;
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
    scheduledTime?: string;
    sessionSlot?: WorkoutSessionSlot;
    locationName?: string;
    locationCategory?: PracticeVenueCategory;
    meetingNotes?: string;
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
  handleSaveStopwatchActivities: (
    entries: SavedStopwatchEntry[]
  ) => Promise<StopwatchSaveResult> | StopwatchSaveResult | number;
  handleFlushStopwatchOutbox?: () => Promise<StopwatchOutboxFlushResult>;
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
  effectiveSessionCheckIns = [],
  onRecordSessionCheckIn,
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
  onOpenPublicTeamHub,
  onOpenCoachGuide,
  isSampleDemoMode = false,
  plainLanguageMode = false,
  stravaSyncWindow,
  onOpenDataSources,

  handleSelectActivityAndOpenTab,
  handleCalendarCreatePlannedEvent,
  handleUpdatePlannedEvent,
  handleDeletePlannedEvent,
  handleDeletePlanBlock,
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
  handleFlushStopwatchOutbox,
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
    <WorkspaceErrorBoundary
      resetKey={activeTab}
      restoreTab={activeTab}
      fallbackTitle="Workspace View Needs Recovery"
    >
      <Suspense fallback={<ViewLoadingSkeleton />}>
      {/* Contextual Sub-Switcher inside Training Calendar (Calendar | Activity Log + quick Stopwatch / Plan Builder) */}
      {(activeTab === 'calendar' || activeTab === 'activities') && (
        <div className="rounded-2xl liquid-glass px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label="Training Calendar views"
            className="flex items-center gap-1 p-1 bg-white/80 dark:bg-[#121B15]/90 border border-emerald-900/15 dark:border-[#244331] rounded-xl shadow-xs"
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
              className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl liquid-glass-subtle hover:border-[#2B5B3F] text-xs font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Timer className="w-3.5 h-3.5 ap-text-brand" />
              <span>Time on Track</span>
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
          onUpdatePlannedEvent={handleUpdatePlannedEvent}
          onDeletePlannedEvent={handleDeletePlannedEvent}
          onDeletePlanBlock={handleDeletePlanBlock}
          onBatchCreatePlannedEvents={handleBatchCreatePlannedEvents}
          onOpenTodayWorkout={handleOpenTodayTab}
          onOpenAthleteProfileModal={handleOpenProfileModal}
          onOpenGoalsArchitect={handleOpenGoalsTab}
          onOpenOfficialRaceModal={handleOpenOfficialRaceModal}
          onOpenCoachWithPrompt={handleOpenCoachWithPrompt}
          onOpenTracksideStopwatch={() => setActiveTab('stopwatch')}
        />
      )}

      {activeTab === 'fitness' && (
        <div className="space-y-3.5">
          <FitnessHealthView
            wellnessDays={effectiveWellnessDays}
            plannedEvents={effectivePlannedEvents}
            activities={effectiveActivities}
            athleteProfile={effectiveAthleteProfile}
            distanceUnit={distanceUnit}
            plainLanguageMode={plainLanguageMode}
            sessionCheckIns={effectiveSessionCheckIns}
            onRecordSessionCheckIn={onRecordSessionCheckIn}
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
            onOpenTracksideStopwatch={() => setActiveTab('stopwatch')}
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
            standalone={false}
            initialOpen={false}
            initialSection="CURVES"
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

      {(activeTab === 'curves' || activeTab === 'trends' || activeTab === 'charts') && (
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
          standalone={true}
          initialOpen={true}
          initialSection={activeTab === 'curves' ? 'CURVES' : 'TRENDS'}
          initialTrendsSubView={activeTab === 'charts' ? 'CUSTOM_LAB' : 'TRENDS'}
          onScanMoreSegments={handleScanMoreSegments}
          onSelectActivity={handleSelectActivityAndOpenTab}
          onOpenActivitiesSegments={handleOpenActivitiesTab}
          onOpenCoachWithPrompt={handleOpenCoachWithPrompt}
          onUpdateAnnualMileageGoal={handleUpdateAnnualMileageGoal}
          onSaveProfileOverride={handleSaveProfileOverride}
          onOpenOfficialRaceModal={handleOpenOfficialRaceModal}
          onOpenDataSources={onOpenDataSources}
        />
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
          activeTeam={activeTeam}
          connectedRoster={combinedRoster}
          onTeamsUpdated={onTeamsUpdated}
          onBatchCreatePlannedEvents={handleBatchCreatePlannedEvents}
          onCreatePlannedEvent={handleCalendarCreatePlannedEvent}
          onDeletePlanBlock={handleDeletePlanBlock}
          onSaveProfileOverride={handleSaveProfileOverride}
          onSelectActivity={handleSelectActivityAndOpenTab}
          onSwitchToCalendar={handleSwitchToCalendarTab}
          onBackToCoachWorkspace={() => {
            setActiveTab('coach');
            setCoachSubTab('TEAM_PLAN');
          }}
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
          onFlushStopwatchOutbox={handleFlushStopwatchOutbox}
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
          selfSessionCheckIns={effectiveSessionCheckIns}
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
          onUpdatePlannedEvent={handleUpdatePlannedEvent}
          onDeletePlannedEvent={handleDeletePlannedEvent}
          onDeletePlanBlock={handleDeletePlanBlock}
          onBatchCreatePlannedEvents={handleBatchCreatePlannedEvents}
          onOpenProfileModal={handleOpenProfileModal}
          onOpenGoalsTab={handleOpenGoalsTab}
          onOpenOfficialRaceModal={handleOpenOfficialRaceModal}
          onOpenCoachWithPrompt={handleOpenCoachWithPrompt}
          onSaveStopwatchActivities={handleSaveStopwatchActivities}
          onFlushStopwatchOutbox={handleFlushStopwatchOutbox}
          onOpenAthleteToday={handleOpenTodayTab}
          onOpenRosterModal={handleOpenRosterModal}
          onOpenPublicTeamHub={onOpenPublicTeamHub}
          onOpenCoachGuide={onOpenCoachGuide}
          isSampleDemoMode={isSampleDemoMode}
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
    </WorkspaceErrorBoundary>
  );
};
