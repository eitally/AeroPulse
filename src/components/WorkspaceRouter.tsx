import React, { Suspense, lazy, useEffect } from 'react';
import { Target, BarChart3, TrendingUp, LineChart } from './icons/PhosphorIcons';
import type {
  ActiveTab,
  AnnualMileageGoal,
  AthleteGearItem,
  AthleteProfile,
  BenchmarkSegmentHistory,
  ConnectedAthleteRecord,
  DistanceUnit,
  EnvironmentFilter,
  PlannedWorkoutEvent,
  SportCategory,
  TargetGoal,
  TeamSummaryWithRole,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import type { PlannedEventBatchItem } from './GoalsView';
import type { SavedStopwatchEntry } from './TracksideStopwatchView';
import { INITIAL_POWER_PACE_CURVES } from '../data/mockTelemetry';

const CalendarView = lazy(() =>
  import('./CalendarView').then((m) => ({ default: m.CalendarView }))
);
const FitnessHealthView = lazy(() =>
  import('./FitnessHealthView').then((m) => ({ default: m.FitnessHealthView }))
);
const PhysiologicalTrendsView = lazy(() =>
  import('./PhysiologicalTrendsView').then((m) => ({ default: m.PhysiologicalTrendsView }))
);
const CustomChartsView = lazy(() =>
  import('./CustomChartsView').then((m) => ({ default: m.CustomChartsView }))
);
const ActivitiesView = lazy(() =>
  import('./ActivitiesView').then((m) => ({ default: m.ActivitiesView }))
);
const PhysiologyView = lazy(() =>
  import('./PhysiologyView').then((m) => ({ default: m.PhysiologyView }))
);
const GoalsView = lazy(() =>
  import('./GoalsView').then((m) => ({ default: m.GoalsView }))
);
const TracksideStopwatchView = lazy(() =>
  import('./TracksideStopwatchView').then((m) => ({ default: m.TracksideStopwatchView }))
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
  // Warm TracksideStopwatchView lazy chunk on idle so trackside Airplane Mode navigation never hits network
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void import('./TracksideStopwatchView');
    }, 900);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <Suspense fallback={<ViewLoadingSkeleton />}>
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
        />
      )}

      {/* Contextual Sub-Switcher for Progress Workspace */}
      {(activeTab === 'totals' ||
        activeTab === 'curves' ||
        activeTab === 'trends' ||
        activeTab === 'charts') && (
        <div className="rounded-2xl liquid-glass p-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <div
              role="tablist"
              aria-label="Progress &amp; Physiology Lab views"
              onKeyDown={(e) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
                const progressTabs: Array<'totals' | 'curves' | 'trends' | 'charts'> = [
                  'totals',
                  'curves',
                  'trends',
                  'charts',
                ];
                const currentIdx = progressTabs.indexOf(
                  activeTab as 'totals' | 'curves' | 'trends' | 'charts'
                );
                if (currentIdx === -1) return;
                e.preventDefault();
                const nextIdx =
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                    ? progressTabs.length - 1
                    : e.key === 'ArrowRight'
                    ? (currentIdx + 1) % progressTabs.length
                    : (currentIdx - 1 + progressTabs.length) % progressTabs.length;
                setActiveTab(progressTabs[nextIdx]);
                const nextTabEl = document.getElementById(`tab-${progressTabs[nextIdx]}`);
                if (nextTabEl) nextTabEl.focus();
              }}
              className="flex items-center gap-1 p-1 bg-white/70 dark:bg-[#121B15]/80 backdrop-blur-md border border-emerald-900/15 dark:border-[#244331] rounded-xl shadow-xs"
            >
              <button
                type="button"
                id="tab-totals"
                role="tab"
                tabIndex={activeTab === 'totals' ? 0 : -1}
                aria-selected={activeTab === 'totals'}
                aria-controls="panel-totals"
                onClick={() => setActiveTab('totals')}
                className={`relative px-3 py-1.5 rounded-lg text-xs font-semibold tracking-tight transition-all duration-200 cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'totals'
                    ? 'bg-emerald-600 text-white shadow-xs dark:bg-emerald-700'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/50 dark:hover:bg-[#1A2E22]'
                }`}
              >
                <Target
                  className={`w-3.5 h-3.5 ${
                    activeTab === 'totals' ? 'text-white' : 'text-slate-500 dark:text-slate-400'
                  }`}
                />
                Totals &amp; Volume
              </button>

              <button
                type="button"
                id="tab-curves"
                role="tab"
                tabIndex={activeTab === 'curves' ? 0 : -1}
                aria-selected={activeTab === 'curves'}
                aria-controls="panel-curves"
                onClick={() => setActiveTab('curves')}
                className={`relative px-3 py-1.5 rounded-lg text-xs font-semibold tracking-tight transition-all duration-200 cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'curves'
                    ? 'bg-emerald-600 text-white shadow-xs dark:bg-emerald-700'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/50 dark:hover:bg-[#1A2E22]'
                }`}
              >
                <BarChart3
                  className={`w-3.5 h-3.5 ${
                    activeTab === 'curves' ? 'text-white' : 'text-slate-500 dark:text-slate-400'
                  }`}
                />
                Power &amp; Pace Curves
              </button>

              <button
                type="button"
                id="tab-trends"
                role="tab"
                tabIndex={activeTab === 'trends' ? 0 : -1}
                aria-selected={activeTab === 'trends'}
                aria-controls="panel-trends"
                onClick={() => setActiveTab('trends')}
                className={`relative px-3 py-1.5 rounded-lg text-xs font-semibold tracking-tight transition-all duration-200 cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'trends'
                    ? 'bg-emerald-600 text-white shadow-xs dark:bg-emerald-700'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/50 dark:hover:bg-[#1A2E22]'
                }`}
              >
                <TrendingUp
                  className={`w-3.5 h-3.5 ${
                    activeTab === 'trends' ? 'text-white' : 'text-slate-500 dark:text-slate-400'
                  }`}
                />
                Physiological Trends
              </button>

              <button
                type="button"
                id="tab-charts"
                role="tab"
                tabIndex={activeTab === 'charts' ? 0 : -1}
                aria-selected={activeTab === 'charts'}
                aria-controls="panel-charts"
                onClick={() => setActiveTab('charts')}
                className={`relative px-3 py-1.5 rounded-lg text-xs font-semibold tracking-tight transition-all duration-200 cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'charts'
                    ? 'bg-emerald-600 text-white shadow-xs dark:bg-emerald-700'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/50 dark:hover:bg-[#1A2E22]'
                }`}
              >
                <LineChart
                  className={`w-3.5 h-3.5 ${
                    activeTab === 'charts' ? 'text-white' : 'text-slate-500 dark:text-slate-400'
                  }`}
                />
                Custom Correlation Charts
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'fitness' && (
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
        />
      )}

      {activeTab === 'trends' && (
        <PhysiologicalTrendsView
          wellnessDays={effectiveWellnessDays}
          activities={effectiveActivities}
          athleteWeightKg={latestWeightKg}
          distanceUnit={distanceUnit}
          onOpenCoachWithPrompt={handleOpenCoachWithPrompt}
        />
      )}

      {activeTab === 'charts' && (
        <CustomChartsView
          activities={effectiveActivities}
          wellnessDays={effectiveWellnessDays}
          distanceUnit={distanceUnit}
          onOpenCoachWithPrompt={handleOpenCoachWithPrompt}
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
          athleteWeightKg={latestWeightKg}
          athleteProfile={effectiveAthleteProfile}
        />
      )}

      {activeTab === 'curves' && (
        <PhysiologyView
          curves={INITIAL_POWER_PACE_CURVES}
          benchmarkSegments={benchmarkSegments}
          activities={effectiveActivities}
          wellnessDays={effectiveWellnessDays}
          envFilter={envFilter}
          distanceUnit={distanceUnit}
          athleteWeightKg={latestWeightKg}
          athleteProfile={effectiveAthleteProfile}
          onScanMoreSegments={handleScanMoreSegments}
          isScanningSegments={isScanningSegments}
          onSelectActivity={handleSelectActivityAndOpenTab}
          onOpenActivitiesSegments={handleOpenActivitiesTab}
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
    </Suspense>
  );
};
