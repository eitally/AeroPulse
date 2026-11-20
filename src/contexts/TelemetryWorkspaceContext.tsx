import React, { createContext, useContext } from 'react';
import type {
  ActiveTab,
  AnnualMileageGoal,
  AthleteGearItem,
  AthleteProfile,
  BenchmarkSegmentHistory,
  EnvironmentFilter,
  PlannedWorkoutEvent,
  PracticeVenueCategory,
  SessionCheckInRecord,
  SportCategory,
  TargetGoal,
  TrackWorkoutSpec,
  UnifiedActivity,
  UnifiedWellnessDay,
  WorkoutSessionSlot,
} from '../types';
import type { SafetySwapEventInput } from '../physiology/sessionCheckInAndDigestEngine';
import type { PlannedEventBatchItem } from '../components/GoalsView';

export interface PlannedEventMutationPayload {
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

export interface TelemetryWorkspaceContextValue {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  effectiveActivities: UnifiedActivity[];
  effectiveWellnessDays: UnifiedWellnessDay[];
  latestWellness: UnifiedWellnessDay | null;
  effectivePlannedEvents: PlannedWorkoutEvent[];
  effectiveTargetGoals: TargetGoal[];
  effectiveAnnualMileageGoals: AnnualMileageGoal[];
  effectiveGearItems: AthleteGearItem[];
  effectiveSessionCheckIns: SessionCheckInRecord[];
  onRecordSessionCheckIn?: (
    input: Omit<SessionCheckInRecord, 'id' | 'createdAt'>,
    safetySwapEvent?: SafetySwapEventInput | null
  ) => Promise<void> | void;
  envFilter: EnvironmentFilter;
  setEnvFilter: (env: EnvironmentFilter) => void;
  selectedSport: SportCategory | 'ALL';
  setSelectedSport: (sport: SportCategory | 'ALL') => void;
  athleteFtp: number;
  latestWeightKg: number;
  latestCtl: number;
  effectiveAthleteProfile: AthleteProfile;
  selectedActivity: UnifiedActivity | null;
  benchmarkSegments: BenchmarkSegmentHistory[];
  isScanningSegments: boolean;
  isHydratingRoutes: boolean;
  handleSelectActivityAndOpenTab: (act: UnifiedActivity) => void;
  handleCalendarCreatePlannedEvent: (
    event: PlannedEventMutationPayload & {
      replaceExistingDate?: boolean;
      planBlockId?: string;
      planBlockName?: string;
      planWeekNum?: number;
    }
  ) => Promise<void>;
  handleUpdatePlannedEvent: (id: string, patch: PlannedEventMutationPayload) => Promise<void>;
  handleDeletePlannedEvent: (id: string) => Promise<void>;
  handleDeletePlanBlock: (planBlockId: string) => Promise<void>;
  handleBatchCreatePlannedEvents: (batch: PlannedEventBatchItem[]) => Promise<void>;
  handleCreatePlannedEvent: (
    eventInput: PlannedEventMutationPayload & { replaceExistingDate?: boolean }
  ) => Promise<void>;
  handleScheduleProposedWorkout: (workout: Partial<PlannedWorkoutEvent>) => Promise<void>;
  handleSelectActivity: (activity: UnifiedActivity | null) => void;
  loadStreamsForActivity: (activity: UnifiedActivity) => Promise<void>;
  handleScanMoreSegments: () => Promise<void>;
  handleHydrateMoreRoutes: () => Promise<void>;
  handleToggleActivityKudos: (activity: UnifiedActivity) => Promise<void>;
  handleAddActivityComment: (activity: UnifiedActivity, text: string) => Promise<void>;
  handleImportSingleParsedActivity: (activity: UnifiedActivity) => void;
  handleImportMultipleParsedActivities: (activities: UnifiedActivity[]) => void;
  handleUpdateAnnualMileageGoal: (sport: 'Running' | 'Cycling' | 'Swimming', targetMeters: number) => void;
  handleAddTargetGoal: (newGoal: Omit<TargetGoal, 'id'>) => void;
  handleDeleteTargetGoal: (id: string) => void;
  handleSaveProfileOverride: (updatedProfile: AthleteProfile) => Promise<void>;
  handleOpenTodayTab: () => void;
  handleOpenActivitiesTab: () => void;
  handleOpenGoalsTab: () => void;
  handleSwitchToCalendarTab: () => void;
  handleOpenProfileModal: () => void;
  handleOpenOfficialRaceModal: () => void;
  handleOpenDataSources: () => void;
  handleOpenRosterModal: () => void;
  handleOpenCoachWithPrompt: (prompt: string) => void;
}

const TelemetryWorkspaceContext = createContext<TelemetryWorkspaceContextValue | null>(null);

export const TelemetryWorkspaceProvider: React.FC<
  React.PropsWithChildren<{ value: TelemetryWorkspaceContextValue }>
> = ({ value, children }) => (
  <TelemetryWorkspaceContext.Provider value={value}>
    {children}
  </TelemetryWorkspaceContext.Provider>
);

/** Reads workspace navigation, physiology streams, planned workouts, and activity actions. */
export function useTelemetryWorkspace(): TelemetryWorkspaceContextValue {
  const ctx = useContext(TelemetryWorkspaceContext);
  if (!ctx) {
    throw new Error('useTelemetryWorkspace must be used inside a TelemetryWorkspaceProvider');
  }
  return ctx;
}
