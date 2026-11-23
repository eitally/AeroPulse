import React, { Suspense, useEffect, useMemo, useState } from 'react';
import type {
  AthleteProfile,
  CoachComplexityTier,
  CoachEventGroup,
  CoachWorkspaceSubTab,
  ConnectedAthleteRecord,
  DistanceUnit,
  EnvironmentFilter,
  NcaaCaraSeasonSegment,
  PlannedWorkoutEvent,
  PracticeVenueCategory,
  SessionCheckInRecord,
  SportCategory,
  TargetGoal,
  TeamBroadcastWorkout,
  TeamSummaryWithRole,
  TrackWorkoutSpec,
  UnifiedActivity,
  UnifiedWellnessDay,
  WorkoutSessionSlot,
} from '../types';
import type { PlannedEventBatchItem } from './GoalsView';
import {
  buildNcaaCaraComplianceCsv,
  summarizeNcaaCaraWeeklyHours,
  type NcaaCaraCsvRow,
  type VdotPodRosterInput,
} from '../physiology/scholasticEngine';
import { evaluateSafeSportPatternWatch } from '../physiology/safeSportPatternWatchEngine';
import { resolveAthleteAgeTier } from '../physiology/ageAndComplianceEngine';
import { doesCoachOwnAthlete } from '../physiology/teamOnboardingEngine';
import { buildCoachSquadExecutionDigest } from '../physiology/sessionCheckInAndDigestEngine';
import { resolveWorkspaceSportAndRoleScope } from '../utils/workspaceScope';
import { buildThreshSessionHeaders } from '../utils/teamLifecycleApi';
import { hasSessionActiveHint } from '../utils/sessionHint';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { WorkspaceErrorBoundary } from './WorkspaceErrorBoundary';
import type { SavedStopwatchEntry } from './TracksideStopwatchView';
import type {
  StopwatchOutboxFlushResult,
  StopwatchSaveResult,
} from '../utils/stopwatchTeamSync';
import { CoachExecutionDigestPanel } from './CoachExecutionDigestPanel';
import { getLocalDateIso } from '../physiology/trainingProductivityEngine';
import {
  ChevronDown,
  Download,
  Globe,
  HeartPulse,
  HelpCircle,
  Layers,
  Shield,
  Users,
} from './icons/PhosphorIcons';

const CalendarView = lazyWithRetry(
  () => import('./CalendarView').then((m) => ({ default: m.CalendarView })),
  { chunkKey: 'CoachCalendarView', restoreTab: 'coach' }
);
const TeamManagementPanel = lazyWithRetry(
  () => import('./TeamManagementPanel').then((m) => ({ default: m.TeamManagementPanel })),
  { chunkKey: 'TeamManagementPanel', restoreTab: 'coach' }
);
const AthleticNetTfrrsSyncModal = lazyWithRetry(
  () =>
    import('./AthleticNetTfrrsSyncModal').then((m) => ({
      default: m.AthleticNetTfrrsSyncModal,
    })),
  { chunkKey: 'AthleticNetTfrrsSyncModal', restoreTab: 'coach' }
);
const TracksideStopwatchView = lazyWithRetry(
  () => import('./TracksideStopwatchView').then((m) => ({ default: m.TracksideStopwatchView })),
  { chunkKey: 'CoachTracksideStopwatchView', restoreTab: 'coach' }
);
const ScholasticRelayAndTopTimesPanel = lazyWithRetry(
  () =>
    import('./track/ScholasticRelayAndTopTimesPanel').then((m) => ({
      default: m.ScholasticRelayAndTopTimesPanel,
    })),
  { chunkKey: 'ScholasticRelayAndTopTimesPanel', restoreTab: 'coach' }
);
const CoachClipboardWorkoutBuilder = lazyWithRetry(
  () =>
    import('./CoachClipboardWorkoutBuilder').then((m) => ({
      default: m.CoachClipboardWorkoutBuilder,
    })),
  { chunkKey: 'CoachClipboardWorkoutBuilder', restoreTab: 'coach' }
);
const TracksideFieldEventsSheet = lazyWithRetry(
  () =>
    import('./track/TracksideFieldEventsSheet').then((m) => ({
      default: m.TracksideFieldEventsSheet,
    })),
  { chunkKey: 'TracksideFieldEventsSheet', restoreTab: 'coach' }
);
const CoachDailyOpsPanel = lazyWithRetry(
  () =>
    import('./coach/CoachDailyOpsPanel').then((m) => ({
      default: m.CoachDailyOpsPanel,
    })),
  { chunkKey: 'CoachDailyOpsPanel', restoreTab: 'coach' }
);
const CoachAthleteSummaryDrawer = lazyWithRetry(
  () =>
    import('./coach/CoachDailyOpsPanel').then((m) => ({
      default: m.CoachAthleteSummaryDrawer,
    })),
  { chunkKey: 'CoachAthleteSummaryDrawer', restoreTab: 'coach' }
);
const CoachOnboardingWizard = lazyWithRetry(
  () =>
    import('./coach/CoachOnboardingWizard').then((m) => ({
      default: m.CoachOnboardingWizard,
    })),
  { chunkKey: 'CoachOnboardingWizard', restoreTab: 'coach' }
);
const MeetDayHeatAndFlightModal = lazyWithRetry(
  () =>
    import('./coach/MeetDayHeatAndFlightModal').then((m) => ({
      default: m.MeetDayHeatAndFlightModal,
    })),
  { chunkKey: 'MeetDayHeatAndFlightModal', restoreTab: 'coach' }
);
const AthleticTrainerInjuryHub = lazyWithRetry(
  () =>
    import('./coach/AthleticTrainerInjuryHub').then((m) => ({
      default: m.AthleticTrainerInjuryHub,
    })),
  { chunkKey: 'AthleticTrainerInjuryHub', restoreTab: 'coach' }
);
const DistrictAdOverviewModal = lazyWithRetry(
  () =>
    import('./coach/DistrictAdOverviewModal').then((m) => ({
      default: m.DistrictAdOverviewModal,
    })),
  { chunkKey: 'DistrictAdOverviewModal', restoreTab: 'coach' }
);

export interface CoachWorkspaceViewProps {
  subTab: CoachWorkspaceSubTab;
  setSubTab: (tab: CoachWorkspaceSubTab) => void;
  activeTeam: TeamSummaryWithRole | null;
  myTeams: TeamSummaryWithRole[];
  activeTeamId: string | null;
  onSelectActiveTeam: (teamId: string | null) => void;
  combinedRoster: ConnectedAthleteRecord[];
  activeViewedAthleteId: string;
  onSelectAthleteViewport: (athleteId: string) => void;
  primaryAthleteDisplayName: string;
  selfProfile: AthleteProfile;
  athleteFtp: number;
  selfSessionCheckIns?: SessionCheckInRecord[];
  effectivePlannedEvents: PlannedWorkoutEvent[];
  effectiveActivities: UnifiedActivity[];
  effectiveWellnessDays: UnifiedWellnessDay[];
  effectiveTargetGoals: TargetGoal[];
  envFilter: EnvironmentFilter;
  selectedSport: SportCategory | 'ALL';
  onSelectSport: (sport: SportCategory | 'ALL') => void;
  distanceUnit: DistanceUnit;
  resendConfigured: boolean;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string | null) => void;
  onSelectActivityAndOpenTab: (act: UnifiedActivity) => void;
  onCreatePlannedEvent: (event: {
    date: string;
    name: string;
    sportCategory: SportCategory;
    environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
    plannedDurationSecs: number;
    plannedLoad: number;
    workoutSyntax: string;
    description: string;
    scheduledTime?: string;
    sessionSlot?: import('../types').WorkoutSessionSlot;
    locationName?: string;
    locationCategory?: import('../types').PracticeVenueCategory;
    meetingNotes?: string;
    trackSpec?: TrackWorkoutSpec;
    replaceExistingDate?: boolean;
  }) => Promise<void>;
  onUpdatePlannedEvent?: (
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
      sessionSlot?: import('../types').WorkoutSessionSlot;
      locationName?: string;
      locationCategory?: import('../types').PracticeVenueCategory;
      meetingNotes?: string;
      trackSpec?: TrackWorkoutSpec;
    }
  ) => Promise<void>;
  onDeletePlannedEvent: (id: string) => Promise<void>;
  onDeletePlanBlock?: (planBlockId: string) => Promise<void>;
  onBatchCreatePlannedEvents: (
    events: {
      date: string;
      name: string;
      sportCategory: SportCategory;
      environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
      plannedDurationSecs: number;
      plannedLoad: number;
      workoutSyntax: string;
      description: string;
      trackSpec?: TrackWorkoutSpec;
    }[],
    clearFutureEvents?: boolean
  ) => Promise<void>;
  onOpenProfileModal: () => void;
  onOpenGoalsTab: () => void;
  onOpenOfficialRaceModal: () => void;
  onOpenCoachWithPrompt: (prompt: string) => void;
  onSaveStopwatchActivities: (
    entries: SavedStopwatchEntry[]
  ) => Promise<StopwatchSaveResult> | StopwatchSaveResult | number;
  onFlushStopwatchOutbox?: () => Promise<StopwatchOutboxFlushResult>;
  onOpenAthleteToday: () => void;
  onOpenRosterModal: () => void;
  onOpenPublicTeamHub?: (slugOrCode: string) => void;
  onOpenCoachGuide?: () => void;
  isSampleDemoMode?: boolean;
}

export const CoachWorkspaceView: React.FC<CoachWorkspaceViewProps> = ({
  subTab,
  setSubTab,
  activeTeam,
  myTeams,
  activeTeamId,
  onSelectActiveTeam,
  combinedRoster,
  activeViewedAthleteId,
  onSelectAthleteViewport,
  primaryAthleteDisplayName,
  selfProfile,
  athleteFtp,
  selfSessionCheckIns = [],
  effectivePlannedEvents,
  effectiveActivities,
  effectiveWellnessDays,
  effectiveTargetGoals,
  envFilter,
  selectedSport,
  onSelectSport,
  distanceUnit,
  resendConfigured,
  onTeamsUpdated,
  onSelectActivityAndOpenTab,
  onCreatePlannedEvent,
  onUpdatePlannedEvent,
  onDeletePlannedEvent,
  onDeletePlanBlock,
  onBatchCreatePlannedEvents,
  onOpenProfileModal,
  onOpenGoalsTab,
  onOpenOfficialRaceModal,
  onOpenCoachWithPrompt,
  onSaveStopwatchActivities,
  onFlushStopwatchOutbox,
  onOpenAthleteToday,
  onOpenRosterModal,
  onOpenPublicTeamHub,
  onOpenCoachGuide,
  isSampleDemoMode = false,
}) => {
  const [openCreateTeamOnSwitch, setOpenCreateTeamOnSwitch] = useState<boolean>(false);
  const [isExternalSyncOpen, setIsExternalSyncOpen] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined' && window.location.hash === '#coach-sync';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const handleHashSync = () => {
      try {
        if (window.location.hash === '#coach-sync') {
          setIsExternalSyncOpen(true);
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener('hashchange', handleHashSync);
    return () => window.removeEventListener('hashchange', handleHashSync);
  }, []);

  const handleCloseExternalSync = () => {
    setIsExternalSyncOpen(false);
    try {
      if (typeof window !== 'undefined' && window.location.hash === '#coach-sync') {
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${window.location.search}#coach`
        );
      }
    } catch {
      // ignore
    }
  };

  const [teamPlanError, setTeamPlanError] = useState<string | null>(null);

  const handleTeamPlanCreate = async (eventInput: {
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
  }) => {
    setTeamPlanError(null);
    const canBroadcastTeam =
      activeTeam &&
      (activeTeam.myRole === 'HEAD_COACH' ||
        activeTeam.myRole === 'ASSISTANT_COACH' ||
        activeTeam.myRole === 'ORG_ADMIN');
    if (canBroadcastTeam && activeTeam) {
      if (isSampleDemoMode || activeTeam.brand.teamId.startsWith('demo_team_')) {
        const newBroadcast = {
          broadcastId: `bw_demo_${Date.now()}`,
          teamId: activeTeam.brand.teamId,
          targetSquadGroup: 'ALL',
          date: eventInput.date,
          name: eventInput.name,
          sportCategory: eventInput.sportCategory,
          plannedDurationSecs: eventInput.plannedDurationSecs,
          plannedLoad: eventInput.plannedLoad,
          workoutSyntax: eventInput.workoutSyntax,
          description: eventInput.description,
          ...(eventInput.scheduledTime ? { scheduledTime: eventInput.scheduledTime } : {}),
          ...(eventInput.sessionSlot ? { sessionSlot: eventInput.sessionSlot } : {}),
          ...(eventInput.locationName ? { locationName: eventInput.locationName } : {}),
          ...(eventInput.locationCategory
            ? { locationCategory: eventInput.locationCategory }
            : {}),
          ...(eventInput.meetingNotes ? { meetingNotes: eventInput.meetingNotes } : {}),
          ...(eventInput.trackSpec ? { trackSpec: eventInput.trackSpec } : {}),
          pushedByCoachName: activeTeam.brand.coachDisplayName || 'Coach',
          createdAt: new Date().toISOString(),
        };
        const updatedTeam = {
          ...activeTeam,
          broadcastWorkouts: [...(activeTeam.broadcastWorkouts || []), newBroadcast],
        };
        onTeamsUpdated(
          myTeams.map((t) =>
            t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
          ),
          updatedTeam.brand.teamId
        );
        return;
      }
      try {
        const resp = await fetch(
          `/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}/workouts/broadcast`,
          {
            method: 'POST',
            credentials: 'include',
            headers: buildThreshSessionHeaders(),
            body: JSON.stringify({
              origin: window.location.origin,
              targetSquadGroup: 'ALL',
              date: eventInput.date,
              name: eventInput.name,
              sportCategory: eventInput.sportCategory,
              plannedDurationSecs: eventInput.plannedDurationSecs,
              plannedLoad: eventInput.plannedLoad,
              workoutSyntax: eventInput.workoutSyntax,
              description: eventInput.description,
              ...(eventInput.scheduledTime ? { scheduledTime: eventInput.scheduledTime } : {}),
              ...(eventInput.sessionSlot ? { sessionSlot: eventInput.sessionSlot } : {}),
              ...(eventInput.locationName ? { locationName: eventInput.locationName } : {}),
              ...(eventInput.locationCategory
                ? { locationCategory: eventInput.locationCategory }
                : {}),
              ...(eventInput.meetingNotes ? { meetingNotes: eventInput.meetingNotes } : {}),
              ...(eventInput.trackSpec ? { trackSpec: eventInput.trackSpec } : {}),
              replaceSameDateTarget:
                typeof eventInput.replaceExistingDate === 'boolean'
                  ? eventInput.replaceExistingDate &&
                    (eventInput.sessionSlot || 'SINGLE') === 'SINGLE'
                  : (eventInput.sessionSlot || 'SINGLE') === 'SINGLE',
            }),
          }
        );
        const data = await resp.json().catch(() => ({}));
        if (resp.ok) {
          if (Array.isArray(data.teams)) {
            onTeamsUpdated(data.teams, activeTeam.brand.teamId);
          }
          return;
        }
        setTeamPlanError(data?.error || 'Could not broadcast team session to server.');
        return;
      } catch {
        // Fallback to local state only when offline
      }
    }
    await onCreatePlannedEvent(eventInput);
  };

  const handleTeamPlanUpdate = async (
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
  ) => {
    setTeamPlanError(null);
    const canBroadcastTeam =
      activeTeam &&
      (activeTeam.myRole === 'HEAD_COACH' ||
        activeTeam.myRole === 'ASSISTANT_COACH' ||
        activeTeam.myRole === 'ORG_ADMIN');
    const isTeamBroadcast = Boolean(
      activeTeam &&
        (activeTeam.broadcastWorkouts?.some((bw) => bw.broadcastId === id) ||
          id.startsWith('bw_'))
    );
    if (canBroadcastTeam && activeTeam && isTeamBroadcast) {
      if (isSampleDemoMode || activeTeam.brand.teamId.startsWith('demo_team_')) {
        const updatedBroadcasts = (activeTeam.broadcastWorkouts || []).map((bw) =>
          bw.broadcastId === id
            ? {
                ...bw,
                date: patch.date,
                name: patch.name,
                sportCategory: patch.sportCategory,
                plannedDurationSecs: patch.plannedDurationSecs,
                plannedLoad: patch.plannedLoad,
                workoutSyntax: patch.workoutSyntax,
                description: patch.description,
                scheduledTime: patch.scheduledTime,
                sessionSlot: patch.sessionSlot,
                locationName: patch.locationName,
                locationCategory: patch.locationCategory,
                meetingNotes: patch.meetingNotes,
                ...(patch.trackSpec ? { trackSpec: patch.trackSpec } : {}),
              }
            : bw
        );
        const updatedTeam = { ...activeTeam, broadcastWorkouts: updatedBroadcasts };
        onTeamsUpdated(
          myTeams.map((t) =>
            t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
          ),
          updatedTeam.brand.teamId
        );
        return;
      }
      try {
        const resp = await fetch(
          `/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}/workouts/${encodeURIComponent(id)}`,
          {
            method: 'PUT',
            credentials: 'include',
            headers: buildThreshSessionHeaders(),
            body: JSON.stringify({
              origin: window.location.origin,
              ...patch,
            }),
          }
        );
        const data = await resp.json().catch(() => ({}));
        if (resp.ok) {
          if (Array.isArray(data.teams)) {
            onTeamsUpdated(data.teams, activeTeam.brand.teamId);
          }
          return;
        }
        setTeamPlanError(data?.error || 'Could not update team session on server.');
        return;
      } catch {
        setTeamPlanError('Offline — unable to update team session on server.');
        return;
      }
    }
    await onUpdatePlannedEvent?.(id, patch);
  };

  const handleTeamPlanBatchCreate = async (items: PlannedEventBatchItem[]) => {
    setTeamPlanError(null);
    if (!items || items.length === 0) return;
    const canBroadcastTeam =
      activeTeam &&
      (activeTeam.myRole === 'HEAD_COACH' ||
        activeTeam.myRole === 'ASSISTANT_COACH' ||
        activeTeam.myRole === 'ORG_ADMIN');
    if (canBroadcastTeam && activeTeam) {
      if (isSampleDemoMode || activeTeam.brand.teamId.startsWith('demo_team_')) {
        const nowIso = new Date().toISOString();
        const nowTs = Date.now();
        const createdBroadcasts: TeamBroadcastWorkout[] = items.map((item, idx) => ({
          broadcastId: `bw_demo_${nowTs}_${idx}`,
          teamId: activeTeam.brand.teamId,
          targetSquadGroup: 'ALL',
          date: item.date,
          name: item.name,
          sportCategory: item.sportCategory,
          plannedDurationSecs: item.plannedDurationSecs,
          plannedLoad: item.plannedLoad,
          workoutSyntax: item.workoutSyntax,
          description: item.description,
          ...(item.scheduledTime ? { scheduledTime: item.scheduledTime } : {}),
          ...(item.sessionSlot ? { sessionSlot: item.sessionSlot } : {}),
          ...(item.locationName ? { locationName: item.locationName } : {}),
          ...(item.locationCategory ? { locationCategory: item.locationCategory } : {}),
          ...(item.meetingNotes ? { meetingNotes: item.meetingNotes } : {}),
          ...(item.trackSpec ? { trackSpec: item.trackSpec } : {}),
          ...(item.planBlockId ? { planBlockId: item.planBlockId } : {}),
          ...(item.planBlockName ? { planBlockName: item.planBlockName } : {}),
          ...(typeof item.planWeekNum === 'number' ? { planWeekNum: item.planWeekNum } : {}),
          pushedByCoachName: activeTeam.brand.coachDisplayName || 'Coach',
          createdAt: nowIso,
        }));
        const exactSigs = new Set(
          createdBroadcasts.map(
            (b) => `${b.date.slice(0, 10)}:${b.sportCategory}:${b.name.trim().toLowerCase()}`
          )
        );
        const existing = (activeTeam.broadcastWorkouts || []).filter(
          (bw) =>
            !exactSigs.has(
              `${bw.date.slice(0, 10)}:${bw.sportCategory}:${bw.name.trim().toLowerCase()}`
            )
        );
        const updatedTeam = {
          ...activeTeam,
          broadcastWorkouts: [...existing, ...createdBroadcasts],
        };
        onTeamsUpdated(
          myTeams.map((t) =>
            t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
          ),
          updatedTeam.brand.teamId
        );
        return;
      }
      try {
        const resp = await fetch(
          `/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}/workouts/broadcast-batch`,
          {
            method: 'POST',
            credentials: 'include',
            headers: buildThreshSessionHeaders(),
            body: JSON.stringify({
              origin: window.location.origin,
              targetSquadGroup: 'ALL',
              planBlockId: items[0]?.planBlockId,
              planBlockName: items[0]?.planBlockName,
              replaceExistingCohortRange: false,
              workouts: items.map((item) => ({
                date: item.date,
                name: item.name,
                sportCategory: item.sportCategory,
                plannedDurationSecs: item.plannedDurationSecs,
                plannedLoad: item.plannedLoad,
                workoutSyntax: item.workoutSyntax,
                description: item.description,
                ...(item.scheduledTime ? { scheduledTime: item.scheduledTime } : {}),
                ...(item.sessionSlot ? { sessionSlot: item.sessionSlot } : {}),
                ...(item.locationName ? { locationName: item.locationName } : {}),
                ...(item.locationCategory ? { locationCategory: item.locationCategory } : {}),
                ...(item.meetingNotes ? { meetingNotes: item.meetingNotes } : {}),
                ...(item.trackSpec ? { trackSpec: item.trackSpec } : {}),
                ...(typeof item.planWeekNum === 'number'
                  ? { planWeekNum: item.planWeekNum }
                  : {}),
              })),
            }),
          }
        );
        const data = await resp.json().catch(() => ({}));
        if (resp.ok) {
          if (Array.isArray(data.teams)) {
            onTeamsUpdated(data.teams, activeTeam.brand.teamId);
          }
          return;
        }
        setTeamPlanError(data?.error || 'Could not batch-broadcast team sessions to server.');
        return;
      } catch {
        setTeamPlanError('Offline — unable to batch-broadcast team sessions to server.');
        return;
      }
    }
    await onBatchCreatePlannedEvents(items);
  };
  const connectedAthletesOnly = useMemo(
    () =>
      combinedRoster.filter(
        (a) =>
          a.status === 'CONNECTED' &&
          a.teamMemberStatus !== 'ALUMNI' &&
          a.teamMemberStatus !== 'OFF_SEASON' &&
          a.teamMemberStatus !== 'REVOKED'
      ),
    [combinedRoster]
  );

  const staffMembers = useMemo(
    () =>
      (activeTeam?.memberships || []).filter(
        (m) =>
          m.status !== 'REVOKED' &&
          m.role !== 'ATHLETE' &&
          m.role !== 'PARENT_FOLLOWER'
      ),
    [activeTeam?.memberships]
  );

  const isScopedSelfCoach = Boolean(
    activeTeam?.myRole === 'ASSISTANT_COACH' &&
      ((activeTeam.myCoachEventGroups && activeTeam.myCoachEventGroups.length > 0) ||
        (activeTeam.myAssignedAthleteMembershipIds &&
          activeTeam.myAssignedAthleteMembershipIds.length > 0))
  );

  const [coachLensId, setCoachLensId] = useState<string>(() =>
    isScopedSelfCoach ? 'MY_SCOPE' : 'ALL_TEAM'
  );

  useEffect(() => {
    setCoachLensId(isScopedSelfCoach ? 'MY_SCOPE' : 'ALL_TEAM');
  }, [activeTeam?.brand.teamId, isScopedSelfCoach]);

  const activeLensScope = useMemo<{
    groups?: CoachEventGroup[];
    athleteIds?: string[];
  }>(() => {
    if (coachLensId === 'MY_SCOPE' && activeTeam) {
      return {
        groups: activeTeam.myCoachEventGroups,
        athleteIds: activeTeam.myAssignedAthleteMembershipIds,
      };
    }
    if (coachLensId !== 'ALL_TEAM') {
      const staff = staffMembers.find((s) => s.membershipId === coachLensId);
      if (staff) {
        return {
          groups: staff.coachEventGroups,
          athleteIds: staff.assignedAthleteMembershipIds,
        };
      }
    }
    return {};
  }, [coachLensId, activeTeam, staffMembers]);

  const effectiveAllowedEventGroups = useMemo<CoachEventGroup[] | undefined>(
    () =>
      activeLensScope.groups && activeLensScope.groups.length > 0
        ? activeLensScope.groups
        : undefined,
    [activeLensScope.groups]
  );
  const defaultCoachEventGroup = effectiveAllowedEventGroups?.[0];

  const scopedConnectedAthletes = useMemo(() => {
    if (
      (!activeLensScope.groups || activeLensScope.groups.length === 0) &&
      (!activeLensScope.athleteIds || activeLensScope.athleteIds.length === 0)
    ) {
      return connectedAthletesOnly;
    }
    return connectedAthletesOnly.filter((ath) => {
      const memId = ath.id.startsWith('team-mem-')
        ? ath.id.slice('team-mem-'.length)
        : ath.id;
      return doesCoachOwnAthlete({
        coachEventGroups: activeLensScope.groups,
        assignedAthleteMembershipIds: activeLensScope.athleteIds,
        athleteEventGroup: ath.eventGroup,
        athleteMembershipId: memId,
      });
    });
  }, [connectedAthletesOnly, activeLensScope]);

  const scopedStopwatchRoster = useMemo(() => {
    if (
      (!activeLensScope.groups || activeLensScope.groups.length === 0) &&
      (!activeLensScope.athleteIds || activeLensScope.athleteIds.length === 0)
    ) {
      return combinedRoster;
    }
    return combinedRoster.filter((ath) => {
      if (ath.id === 'SELF') return true;
      const memId = ath.id.startsWith('team-mem-')
        ? ath.id.slice('team-mem-'.length)
        : ath.id;
      return doesCoachOwnAthlete({
        coachEventGroups: activeLensScope.groups,
        assignedAthleteMembershipIds: activeLensScope.athleteIds,
        athleteEventGroup: ath.eventGroup,
        athleteMembershipId: memId,
      });
    });
  }, [combinedRoster, activeLensScope]);

  const podRoster = useMemo<VdotPodRosterInput[]>(() => {
    const activePodAthletes = scopedConnectedAthletes.filter(
      (a) => a.teamMemberStatus !== 'INJURED'
    );
    if (activePodAthletes.length === 0) {
      return [
        {
          id: 'SELF',
          name: primaryAthleteDisplayName || 'Lead Runner',
          thresholdPaceSecsPerKm: selfProfile.thresholdPaceSecsPerKm || 245,
        },
      ];
    }
    return activePodAthletes.map((a) => ({
      id: a.id,
      name: a.name,
      thresholdPaceSecsPerKm: a.athleteProfile.thresholdPaceSecsPerKm || 250,
    }));
  }, [scopedConnectedAthletes, primaryAthleteDisplayName, selfProfile.thresholdPaceSecsPerKm]);

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

  const [showRelayAndTopTimes, setShowRelayAndTopTimes] = useState<boolean>(false);
  const [complexityTierState, setComplexityTierState] = useState<CoachComplexityTier | null>(() => {
    try {
      const saved = window.localStorage.getItem('thresh_coach_complexity_tier');
      return saved === 'PRO' || saved === 'ESSENTIALS' ? saved : null;
    } catch {
      return null;
    }
  });
  const complexityTier: CoachComplexityTier =
    complexityTierState ??
    (activeTeam?.brand?.orgType === 'COLLEGIATE' ? 'PRO' : 'ESSENTIALS');
  const setComplexityTier = (next: CoachComplexityTier) => {
    setComplexityTierState(next);
    try {
      window.localStorage.setItem('thresh_coach_complexity_tier', next);
    } catch {
      // ignore storage failures
    }
  };
  const [tracksideMode, setTracksideMode] = useState<'STOPWATCH' | 'FIELD'>('STOPWATCH');
  const [showOnboardingWizard, setShowOnboardingWizard] = useState<boolean>(false);

  useEffect(() => {
    if (
      isSampleDemoMode ||
      subTab !== 'CLIPBOARD' ||
      myTeams.length > 0 ||
      connectedAthletesOnly.length > 0 ||
      showOnboardingWizard
    ) {
      return;
    }
    try {
      if (
        typeof window === 'undefined' ||
        !hasSessionActiveHint() ||
        window.sessionStorage.getItem('meetready_coach_wizard_seen') === '1'
      ) {
        return;
      }
    } catch {
      return;
    }
    const timer = window.setTimeout(() => {
      try {
        window.sessionStorage.setItem('meetready_coach_wizard_seen', '1');
      } catch {
        // ignore storage failures
      }
      setShowOnboardingWizard(true);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    isSampleDemoMode,
    subTab,
    myTeams.length,
    connectedAthletesOnly.length,
    showOnboardingWizard,
  ]);
  const [showMeetDayModal, setShowMeetDayModal] = useState<boolean>(false);
  const [showInjuryHubModal, setShowInjuryHubModal] = useState<boolean>(false);
  const [showDistrictAdModal, setShowDistrictAdModal] = useState<boolean>(false);
  const [drawerAthleteId, setDrawerAthleteId] = useState<string | null>(null);
  const [caraSegment, setCaraSegment] = useState<NcaaCaraSeasonSegment>('IN_SEASON');
  const [caraStrengthHours, setCaraStrengthHours] = useState<number>(0);
  const [caraMeetingHours, setCaraMeetingHours] = useState<number>(0);
  const [caraVaraHours, setCaraVaraHours] = useState<number>(0);

  const workspaceScope = useMemo(
    () =>
      resolveWorkspaceSportAndRoleScope({
        athleteProfile: selfProfile,
        activeTeam,
      }),
    [selfProfile, activeTeam]
  );

  const drawerAthlete = useMemo(
    () =>
      drawerAthleteId
        ? connectedAthletesOnly.find((a) => a.id === drawerAthleteId) || null
        : null,
    [connectedAthletesOnly, drawerAthleteId]
  );

  const todayIso = getLocalDateIso();

  const teamPlanEvents = useMemo(() => {
    if (!activeTeam) return effectivePlannedEvents;
    const broadcastIds = new Set(
      (activeTeam.broadcastWorkouts || []).map((bw) => bw.broadcastId)
    );
    const scoped = effectivePlannedEvents.filter((ev) => broadcastIds.has(ev.id));
    return scoped.length > 0 ? scoped : effectivePlannedEvents;
  }, [activeTeam, effectivePlannedEvents]);

  const flaggedTriageCount = useMemo(() => {
    const digest = buildCoachSquadExecutionDigest({
      roster: scopedConnectedAthletes,
      selfFallback: {
        id: 'SELF',
        name: primaryAthleteDisplayName || 'Coach / Demo Athlete',
        plannedEvents: effectivePlannedEvents,
        activities: effectiveActivities,
        sessionCheckIns: selfSessionCheckIns,
      },
      todayIso,
      windowDays: 7,
    });
    const flaggedIds = new Set<string>();
    for (const r of digest.rows) {
      if (!r.isSelfFallback && r.attentionReason !== 'ON_TRACK') flaggedIds.add(r.athleteId);
    }
    for (const ath of scopedConnectedAthletes) {
      const latestW =
        ath.wellnessDays && ath.wellnessDays.length > 0
          ? ath.wellnessDays[ath.wellnessDays.length - 1]
          : null;
      const tsb = latestW?.tsb ?? 0;
      const hrv = latestW?.hrvRMSSD ?? 60;
      const watchLight = evaluateSafeSportPatternWatch({
        activities: ath.activities || [],
        wellnessDays: ath.wellnessDays || [],
        isMinorU18:
          typeof ath.isMinorU18 === 'boolean'
            ? ath.isMinorU18
            : resolveAthleteAgeTier({
                birthMonthYear: ath.athleteProfile.birthMonthYear,
              }).isMinorU18,
      }).trafficLight;
      if (tsb < -20 || hrv < 48 || watchLight !== 'GREEN_CLEAR') {
        flaggedIds.add(ath.id);
      }
    }
    return flaggedIds.size;
  }, [
    scopedConnectedAthletes,
    primaryAthleteDisplayName,
    effectivePlannedEvents,
    effectiveActivities,
    selfSessionCheckIns,
    todayIso,
  ]);

  const activeInjuryBadgeCount = useMemo(() => {
    const ids = new Set<string>();
    for (const c of activeTeam?.injuryCases || []) {
      if (c.rtpStage !== 'CLEARED') ids.add(c.membershipId);
    }
    const cutoffMs = Date.parse(`${todayIso}T00:00:00Z`) - 6 * 86_400_000;
    for (const m of activeTeam?.memberships || []) {
      if (m.status === 'INJURED') ids.add(m.membershipId);
      const hasRecentPain = (m.liveSnapshot?.sessionCheckIns || []).some(
        (chk) => chk.painFlag && Date.parse(`${String(chk.date || '').slice(0, 10)}T12:00:00Z`) >= cutoffMs
      );
      if (hasRecentPain) ids.add(m.membershipId);
    }
    for (const ath of scopedConnectedAthletes) {
      const memId = ath.id.startsWith('team-mem-')
        ? ath.id.slice('team-mem-'.length)
        : ath.id;
      if (ath.teamMemberStatus === 'INJURED') ids.add(memId);
      const hasRecentPain = (ath.sessionCheckIns || []).some(
        (chk) => chk.painFlag && Date.parse(`${String(chk.date || '').slice(0, 10)}T12:00:00Z`) >= cutoffMs
      );
      if (hasRecentPain) ids.add(memId);
    }
    return ids.size;
  }, [activeTeam?.injuryCases, activeTeam?.memberships, scopedConnectedAthletes, todayIso]);

  return (
    <div className="space-y-3" data-testid="coach-workspace-view">
      {/* Unified Coach Mode Context Header — omitted on Stopwatch so athletes sit at 0px scroll */}
      {subTab !== 'STOPWATCH' && (
        <section className="rounded-2xl liquid-glass px-3.5 py-2.5 sm:px-4 sm:py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <h1 className="text-base sm:text-lg font-bold text-ap-ink dark:text-ap-chalk tracking-tight truncate">
                {activeTeam ? `${activeTeam.brand.name} · Coach` : 'Coach Workspace'}
              </h1>
              {activeTeam && (
                <span className="px-2 py-0.5 rounded-md text-2xs font-mono font-semibold bg-ap-inset text-ap-clay dark:bg-ap-turf dark:text-ap-volt">
                  {activeTeam.brand.joinCode}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label="Coach Workspace Complexity"
                className="inline-flex items-center gap-0.5 p-0.5 rounded-xl liquid-capsule-track text-2xs font-semibold"
              >
                <button
                  type="button"
                  data-testid="coach-complexity-essentials"
                  aria-pressed={complexityTier === 'ESSENTIALS'}
                  onClick={() => setComplexityTier('ESSENTIALS')}
                  className={`min-h-[44px] sm:min-h-[34px] px-2.5 py-1 rounded-lg cursor-pointer transition-colors ${
                    complexityTier === 'ESSENTIALS'
                      ? 'liquid-capsule-active text-ap-ink dark:text-white font-bold'
                      : 'text-ap-ink dark:text-ap-chalk'
                  }`}
                >
                  Simple
                </button>
                <button
                  type="button"
                  data-testid="coach-complexity-pro"
                  aria-pressed={complexityTier === 'PRO'}
                  onClick={() => setComplexityTier('PRO')}
                  className={`min-h-[44px] sm:min-h-[34px] px-2.5 py-1 rounded-lg cursor-pointer transition-colors ${
                    complexityTier === 'PRO'
                      ? 'liquid-capsule-active text-ap-ink dark:text-white font-bold'
                      : 'text-ap-ink dark:text-ap-chalk'
                  }`}
                >
                  Pro Metrics
                </button>
              </div>

              {myTeams.length > 0 && (
                <select
                  value={activeTeamId || ''}
                  onChange={(e) => onSelectActiveTeam(e.target.value || null)}
                  aria-label="Select Team in Coach Workspace"
                  className="min-h-[44px] sm:min-h-[36px] rounded-xl border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-xs font-semibold text-ap-ink dark:text-ap-chalk"
                >
                  {myTeams.map((t) => (
                    <option key={t.brand.teamId} value={t.brand.teamId}>
                      {t.brand.shortName || t.brand.name}
                    </option>
                  ))}
                  <option value="">Personal Mode</option>
                </select>
              )}

              {activeTeam && (staffMembers.length > 1 || isScopedSelfCoach) && (
                <select
                  data-testid="coach-scope-lens-select"
                  aria-label="Coach Scope Lens"
                  value={coachLensId}
                  onChange={(e) => setCoachLensId(e.target.value)}
                  className="min-h-[44px] sm:min-h-[36px] rounded-xl border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-xs font-semibold text-ap-ink dark:text-ap-chalk"
                >
                  {isScopedSelfCoach && (
                    <option value="MY_SCOPE">
                      My Group ({activeTeam.myCoachSpecialtyTitle || effectiveAllowedEventGroups?.join(', ') || 'Scoped'})
                    </option>
                  )}
                  <option value="ALL_TEAM">All Coaches (Full Team)</option>
                  {staffMembers
                    .filter(
                      (s) =>
                        (s.coachEventGroups && s.coachEventGroups.length > 0) ||
                        (s.assignedAthleteMembershipIds && s.assignedAthleteMembershipIds.length > 0)
                    )
                    .map((s) => (
                      <option key={s.membershipId} value={s.membershipId}>
                        {s.invitedName} — {s.coachSpecialtyTitle || s.coachEventGroups?.join('/')}
                      </option>
                    ))}
                </select>
              )}

              <button
                type="button"
                data-testid="coach-open-wizard-btn"
                onClick={() => setShowOnboardingWizard(true)}
                className="min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-xl ap-btn-secondary text-xs font-semibold cursor-pointer"
              >
                60s Setup
              </button>

              <button
                type="button"
                data-testid="coach-open-meet-packet-btn"
                onClick={() => setShowMeetDayModal(true)}
                className="min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-xl ap-btn-secondary text-xs font-semibold cursor-pointer"
              >
                Meet Packet
              </button>

              <button
                type="button"
                data-testid="coach-open-injury-hub-btn"
                onClick={() => setShowInjuryHubModal(true)}
                className="min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-xl ap-btn-secondary text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <HeartPulse className="w-3.5 h-3.5 text-ap-clay dark:text-ap-volt" />
                <span>Injury Hub</span>
                {activeInjuryBadgeCount > 0 && (
                  <span
                    data-testid="coach-injury-hub-badge"
                    className="px-1.5 py-0.5 rounded-full text-2xs font-mono font-bold bg-ap-clay text-white tabular-nums"
                  >
                    {activeInjuryBadgeCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                data-testid="coach-open-cohort-plan-builder"
                onClick={() => {
                  try {
                    window.sessionStorage.setItem('thresh_open_plan_cohort', 'TEAM_ALL');
                  } catch {
                    // ignore storage failures
                  }
                  onOpenGoalsTab();
                }}
                className="min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-xl ap-btn-secondary text-xs font-semibold cursor-pointer"
              >
                Build Cohort Plan
              </button>
              <button
                type="button"
                data-testid="coach-open-external-sync-btn"
                onClick={() => setIsExternalSyncOpen(true)}
                className="min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-xl ap-btn-secondary text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5" weight="duotone" />
                <span>Athletic.net / TFRRS</span>
              </button>
              {myTeams.some(
                (t) => t.myRole === 'HEAD_COACH' || t.myRole === 'ORG_ADMIN'
              ) && (
                <button
                  type="button"
                  data-testid="coach-open-district-ad-btn"
                  onClick={() => setShowDistrictAdModal(true)}
                  className="min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-xl ap-btn-secondary text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5 ap-text-brand" />
                  <span>District Overview</span>
                </button>
              )}
              {onOpenCoachGuide && (
                <button
                  type="button"
                  data-testid="coach-open-guide-btn"
                  onClick={onOpenCoachGuide}
                  className="min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-xl ap-btn-secondary text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <HelpCircle className="w-3.5 h-3.5 ap-text-brand" />
                  <span>Coach Guide</span>
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 1. CLIPBOARD (COACH HOME — Opens at 0px scroll directly on Workout Builder) */}
      {subTab === 'CLIPBOARD' && (
        <div className="space-y-3">
          {flaggedTriageCount > 0 ? (
            <button
              type="button"
              data-testid="clipboard-flagged-triage-btn"
              onClick={() => setSubTab('ROSTER')}
              className="w-full min-h-[44px] rounded-xl ap-status-caution px-3.5 py-2 flex items-center justify-between gap-2 text-xs font-bold cursor-pointer"
            >
              <span className="inline-flex items-center gap-2 min-w-0">
                <Shield className="w-4 h-4 shrink-0" weight="bold" />
                <span className="truncate">
                  {flaggedTriageCount}{' '}
                  {flaggedTriageCount === 1 ? 'Athlete' : 'Athletes'} Flagged (Pain / High Strain)
                </span>
              </span>
              <span className="font-mono text-2xs shrink-0 underline">
                Review Squad Triage →
              </span>
            </button>
          ) : (
            scopedConnectedAthletes.length > 0 && (
              <button
                type="button"
                onClick={() => setSubTab('ROSTER')}
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card-inset px-3.5 py-2 flex items-center justify-between gap-2 text-xs font-semibold text-ap-ink dark:text-ap-chalk cursor-pointer"
              >
                <span className="truncate">
                  All {scopedConnectedAthletes.length} connected athletes clear for full training today
                </span>
                <span className="font-mono text-2xs ap-text-brand shrink-0 underline">
                  Open 7d Squad Triage →
                </span>
              </button>
            )
          )}

          {myTeams.length === 0 && connectedAthletesOnly.length === 0 && (
            <section className="rounded-2xl liquid-glass px-3.5 py-2.5 sm:px-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Users className="w-4 h-4 ap-text-brand shrink-0" weight="duotone" />
                <span className="text-xs font-bold text-ap-ink dark:text-ap-chalk truncate">
                  No team roster connected yet
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="coach-empty-wizard-btn"
                  onClick={() => setShowOnboardingWizard(true)}
                  className="ap-btn-primary !min-h-[44px] sm:!min-h-[36px] px-3.5 py-1.5 text-xs font-bold cursor-pointer"
                >
                  60-Sec Setup Wizard
                </button>
                <button
                  type="button"
                  data-testid="coach-empty-setup-btn"
                  onClick={() => {
                    setOpenCreateTeamOnSwitch(true);
                    setSubTab('ROSTER');
                  }}
                  className="ap-btn-secondary !min-h-[44px] sm:!min-h-[36px] px-3.5 py-1.5 text-xs font-bold cursor-pointer"
                >
                  Set Up Team or Import Roster
                </button>
              </div>
            </section>
          )}

          {/* Track Multi-Set Workout Builder, Event Groups & Pace Pod Splits */}
          <WorkspaceErrorBoundary fallbackTitle="Coach Clipboard" restoreTab="coach">
            <Suspense
              fallback={
                <div className="h-64 rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                  Loading Coach Clipboard…
                </div>
              }
            >
              <CoachClipboardWorkoutBuilder
                activeTeam={activeTeam}
                myTeams={myTeams}
                connectedAthletes={scopedConnectedAthletes}
                primaryAthleteDisplayName={primaryAthleteDisplayName}
                selfProfile={selfProfile}
                complexityTier={complexityTier}
                defaultEventGroup={defaultCoachEventGroup}
                onTeamsUpdated={onTeamsUpdated}
                onCreatePlannedEvent={onCreatePlannedEvent}
                onOpenStopwatchSubTab={() => {
                  setTracksideMode('STOPWATCH');
                  setSubTab('STOPWATCH');
                }}
              />
            </Suspense>
          </WorkspaceErrorBoundary>

          {/* Daily 3:15 PM Trackside Habit: Roll Call, Broadcasts & Quick Launch */}
          <WorkspaceErrorBoundary fallbackTitle="Daily Practice Ops" restoreTab="coach">
            <Suspense
              fallback={
                <div className="h-32 rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                  Loading Practice Ops…
                </div>
              }
            >
              <CoachDailyOpsPanel
                activeTeam={activeTeam}
                myTeams={myTeams}
                complexityTier={complexityTier}
                allowedEventGroups={effectiveAllowedEventGroups}
                onLaunchStopwatch={() => {
                  setTracksideMode('STOPWATCH');
                  setSubTab('STOPWATCH');
                }}
                onLaunchFieldSheet={() => {
                  setTracksideMode('FIELD');
                  setSubTab('STOPWATCH');
                }}
                onTeamsUpdated={onTeamsUpdated}
              />
            </Suspense>
          </WorkspaceErrorBoundary>

          {workspaceScope.showRelayOptimizer && (
          <div className="rounded-2xl liquid-glass overflow-hidden">
            <button
              type="button"
              aria-expanded={showRelayAndTopTimes}
              onClick={() => setShowRelayAndTopTimes((prev) => !prev)}
              className="w-full min-h-[44px] px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs font-bold text-ap-ink dark:text-ap-chalk cursor-pointer"
            >
              <span>Relay Optimizer &amp; NFHS FAT Top Times</span>
              <ChevronDown
                className={`w-4 h-4 text-ap-muted dark:text-ap-muted-dark transition-transform ${
                  showRelayAndTopTimes ? 'rotate-180' : ''
                }`}
              />
            </button>
            {showRelayAndTopTimes && (
              <div className="px-3 pb-3 pt-1">
                <WorkspaceErrorBoundary fallbackTitle="Relay & Top Times" restoreTab="coach">
                  <Suspense
                    fallback={
                      <div className="h-32 rounded-xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                        Loading Relay Optimizer…
                      </div>
                    }
                  >
                    <ScholasticRelayAndTopTimesPanel
                      candidates={relayCandidates.length > 0 ? relayCandidates : podRoster}
                      roster={combinedRoster.filter(
                        (a) =>
                          a.status === 'CONNECTED' &&
                          a.teamMemberStatus !== 'REVOKED'
                      )}
                    />
                  </Suspense>
                </WorkspaceErrorBoundary>
              </div>
            )}
          </div>
          )}
        </div>
      )}

      {/* 2. TEAM PLAN */}
      {subTab === 'TEAM_PLAN' && (
        <div className="space-y-3">
          {teamPlanError && (
            <div
              role="alert"
              className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50/90 dark:bg-red-950/50 px-3.5 py-2 text-xs font-semibold text-red-700 dark:text-red-300"
            >
              {teamPlanError}
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
                plannedEvents={teamPlanEvents}
                targetGoals={effectiveTargetGoals}
                envFilter={envFilter}
                selectedSport={selectedSport}
                onSelectSport={onSelectSport}
                distanceUnit={distanceUnit}
                athleteFtp={athleteFtp}
                athleteProfile={selfProfile}
                onSelectActivity={onSelectActivityAndOpenTab}
                onCreatePlannedEvent={handleTeamPlanCreate}
                onUpdatePlannedEvent={handleTeamPlanUpdate}
                onDeletePlannedEvent={onDeletePlannedEvent}
                onDeletePlanBlock={onDeletePlanBlock}
                onBatchCreatePlannedEvents={handleTeamPlanBatchCreate}
                onOpenTodayWorkout={onOpenAthleteToday}
                onOpenAthleteProfileModal={onOpenProfileModal}
                onOpenGoalsArchitect={onOpenGoalsTab}
                onOpenOfficialRaceModal={onOpenOfficialRaceModal}
                onOpenCoachWithPrompt={onOpenCoachWithPrompt}
                onOpenTracksideStopwatch={() => setSubTab('STOPWATCH')}
              />
            </Suspense>
          </WorkspaceErrorBoundary>
        </div>
      )}

      {/* 3. STOPWATCH & FIELD EVENTS */}
      {subTab === 'STOPWATCH' && (
        <div className="space-y-3">
          <div
            role="group"
            aria-label="Trackside Timing or Field Marks"
            className="rounded-2xl liquid-glass px-3 py-2 flex flex-wrap items-center justify-between gap-2"
          >
            <div className="inline-flex items-center gap-1 p-0.5 rounded-xl liquid-capsule-track text-xs font-bold">
              <button
                type="button"
                data-testid="trackside-mode-stopwatch"
                aria-pressed={tracksideMode === 'STOPWATCH'}
                onClick={() => setTracksideMode('STOPWATCH')}
                className={`min-h-[44px] sm:min-h-[34px] px-3.5 py-1 rounded-lg cursor-pointer transition-colors ${
                  tracksideMode === 'STOPWATCH'
                    ? 'bg-white dark:bg-[#242826] text-ap-ink dark:text-ap-chalk border border-ap-frame dark:border-white/30 shadow-xs'
                    : 'text-ap-muted dark:text-ap-muted-dark border border-transparent hover:text-ap-ink dark:hover:text-ap-chalk'
                }`}
              >
                Track Stopwatch
              </button>
              <button
                type="button"
                data-testid="trackside-mode-field"
                aria-pressed={tracksideMode === 'FIELD'}
                onClick={() => setTracksideMode('FIELD')}
                className={`min-h-[44px] sm:min-h-[34px] px-3.5 py-1 rounded-lg cursor-pointer transition-colors ${
                  tracksideMode === 'FIELD'
                    ? 'bg-white dark:bg-[#242826] text-ap-ink dark:text-ap-chalk border border-ap-frame dark:border-white/30 shadow-xs'
                    : 'text-ap-muted dark:text-ap-muted-dark border border-transparent hover:text-ap-ink dark:hover:text-ap-chalk'
                }`}
              >
                Field Marks &amp; Multi
              </button>
            </div>
            <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
              {tracksideMode === 'STOPWATCH'
                ? 'Sprints · Hurdles · Mid-Dist · Distance Lanes'
                : 'LJ · TJ · HJ · PV · Throws · Pent / Hept / Dec'}
            </span>
          </div>

          {tracksideMode === 'STOPWATCH' ? (
            <WorkspaceErrorBoundary fallbackTitle="Trackside Stopwatch" restoreTab="coach">
              <Suspense
                fallback={
                  <div className="h-80 rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                    Loading Trackside Stopwatch…
                  </div>
                }
              >
                <TracksideStopwatchView
                  selfName={primaryAthleteDisplayName}
                  selfProfile={selfProfile}
                  roster={scopedStopwatchRoster}
                  myTeams={myTeams}
                  activeTeamId={activeTeamId}
                  onSaveStopwatchActivities={onSaveStopwatchActivities}
                  onFlushStopwatchOutbox={onFlushStopwatchOutbox}
                  onOpenActivitiesTab={() => setSubTab('TEAM_PLAN')}
                  postSaveActionLabel="View Team Plan"
                  onOpenRosterModal={() => setSubTab('ROSTER')}
                />
              </Suspense>
            </WorkspaceErrorBoundary>
          ) : (
            <WorkspaceErrorBoundary fallbackTitle="Trackside Field Sheet" restoreTab="coach">
              <Suspense
                fallback={
                  <div className="h-80 rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                    Loading Field &amp; Multi Sheet…
                  </div>
                }
              >
                <TracksideFieldEventsSheet
                  activeTeam={activeTeam}
                  myTeams={myTeams}
                  rosterAthletes={scopedConnectedAthletes}
                  allowedEventGroups={effectiveAllowedEventGroups}
                  defaultEventGroup={defaultCoachEventGroup}
                  distanceUnit={distanceUnit}
                  onTeamsUpdated={onTeamsUpdated}
                />
              </Suspense>
            </WorkspaceErrorBoundary>
          )}
        </div>
      )}

      {/* 4. ROSTER, SQUAD TRIAGE & TEAM SETTINGS */}
      {subTab === 'ROSTER' && (
        <div className="space-y-3">
          <CoachExecutionDigestPanel
            roster={scopedConnectedAthletes}
            selfFallback={{
              id: 'SELF',
              name: primaryAthleteDisplayName || 'Coach / Demo Athlete',
              plannedEvents: effectivePlannedEvents,
              activities: effectiveActivities,
              sessionCheckIns: selfSessionCheckIns,
            }}
            todayIso={todayIso}
            activeTeam={activeTeam}
            myTeams={myTeams}
            isSampleDemoMode={isSampleDemoMode}
            onTeamsUpdated={onTeamsUpdated}
            primaryAthleteDisplayName={primaryAthleteDisplayName}
            complexityTier={complexityTier}
            eventGroupFilter={effectiveAllowedEventGroups}
            onQuickInspectDrawer={(athId) => setDrawerAthleteId(athId)}
            onInspectAthlete={(athId) => {
              onSelectAthleteViewport(athId);
              onOpenAthleteToday();
            }}
            onOpenTeamPlan={() => setSubTab('TEAM_PLAN')}
          />

          <WorkspaceErrorBoundary fallbackTitle="Team Roster & Management" restoreTab="coach">
            <Suspense
              fallback={
                <div className="h-64 rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                  Loading Team Management…
                </div>
              }
            >
              <TeamManagementPanel
                selfName={primaryAthleteDisplayName}
                myTeams={myTeams}
                activeTeamId={activeTeamId}
                resendConfigured={resendConfigured}
                isSampleDemoMode={isSampleDemoMode}
                initialShowCreateStudio={openCreateTeamOnSwitch}
                onSelectActiveTeam={onSelectActiveTeam}
                onTeamsUpdated={onTeamsUpdated}
                onOpenClipboard={() => setSubTab('CLIPBOARD')}
                onOpenExternalSync={() => setIsExternalSyncOpen(true)}
                onOpenPublicTeamHub={onOpenPublicTeamHub}
              />
            </Suspense>
          </WorkspaceErrorBoundary>

          {activeTeam?.brand?.orgType === 'COLLEGIATE' && workspaceScope.showNcaaCara && (
          <section
            data-testid="coach-cara-audit"
            className="rounded-2xl liquid-glass p-4 sm:p-5 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  Weekly Practice Hours ({caraSegment === 'OUT_OF_SEASON' ? '8h Out-of-Season' : '20h In-Season'} Cap)
                </h2>
                <span className="px-2 py-0.5 rounded font-mono text-2xs font-bold ap-status-info">
                  3.0h Comp Day
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="group"
                  aria-label="NCAA CARA Season Segment"
                  className="inline-flex items-center gap-0.5 p-0.5 rounded-lg liquid-capsule-track text-2xs font-semibold"
                >
                  <button
                    type="button"
                    data-testid="cara-segment-in-season"
                    aria-pressed={caraSegment === 'IN_SEASON'}
                    onClick={() => setCaraSegment('IN_SEASON')}
                    className={`min-h-[44px] sm:min-h-[34px] px-2.5 py-0.5 rounded-md cursor-pointer ${
                      caraSegment === 'IN_SEASON'
                        ? 'ap-nav-volt-active'
                        : 'text-ap-muted dark:text-ap-muted-dark'
                    }`}
                  >
                    In-Season (20h)
                  </button>
                  <button
                    type="button"
                    data-testid="cara-segment-out-of-season"
                    aria-pressed={caraSegment === 'OUT_OF_SEASON'}
                    onClick={() => setCaraSegment('OUT_OF_SEASON')}
                    className={`min-h-[44px] sm:min-h-[34px] px-2.5 py-0.5 rounded-md cursor-pointer ${
                      caraSegment === 'OUT_OF_SEASON'
                        ? 'ap-nav-volt-active'
                        : 'text-ap-muted dark:text-ap-muted-dark'
                    }`}
                  >
                    Out-of-Season (8h)
                  </button>
                </div>

                {connectedAthletesOnly.length > 0 && (
                  <button
                    type="button"
                    data-testid="cara-export-csv-btn"
                    onClick={() => {
                      const csvRows: NcaaCaraCsvRow[] = connectedAthletesOnly.map((ath) => {
                        const audit = summarizeNcaaCaraWeeklyHours(
                          ath.activities,
                          todayIso,
                          0,
                          [],
                          {
                            seasonSegment: caraSegment,
                            strengthHours: caraStrengthHours,
                            meetingFilmHours: caraMeetingHours,
                            varaHours: caraVaraHours,
                          }
                        );
                        return {
                          athleteName: ath.name,
                          seasonSegment: caraSegment,
                          weekEndingIso: todayIso,
                          audit,
                          varaHours: caraVaraHours,
                        };
                      });
                      const csvContent = buildNcaaCaraComplianceCsv(csvRows);
                      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const anchor = document.createElement('a');
                      anchor.href = url;
                      anchor.download = `meetready-ncaa-cara-${todayIso}.csv`;
                      document.body.appendChild(anchor);
                      anchor.click();
                      document.body.removeChild(anchor);
                      URL.revokeObjectURL(url);
                    }}
                    className="ap-btn-secondary !min-h-[44px] sm:!min-h-[34px] px-3 py-1 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 ap-text-brand" />
                    <span>Export ARMS / Teamworks CSV</span>
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <label className="rounded-xl border border-stone-200 dark:border-ap-edge bg-white/70 dark:bg-ap-carbon px-3 py-2 flex items-center justify-between gap-2">
                <span className="text-2xs font-mono text-slate-600 dark:text-slate-300">
                  Weights / S&amp;C (h)
                </span>
                <input
                  data-testid="cara-weights-input"
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  value={caraStrengthHours}
                  onChange={(e) =>
                    setCaraStrengthHours(Math.max(0, Math.min(10, Number(e.target.value) || 0)))
                  }
                  className="w-20 min-h-[40px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2 py-1 text-right font-mono text-xs text-slate-900 dark:text-white"
                />
              </label>
              <label className="rounded-xl border border-stone-200 dark:border-ap-edge bg-white/70 dark:bg-ap-carbon px-3 py-2 flex items-center justify-between gap-2">
                <span className="text-2xs font-mono text-slate-600 dark:text-slate-300">
                  Meetings / Film (h)
                </span>
                <input
                  data-testid="cara-meetings-input"
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  value={caraMeetingHours}
                  onChange={(e) =>
                    setCaraMeetingHours(Math.max(0, Math.min(10, Number(e.target.value) || 0)))
                  }
                  className="w-20 min-h-[40px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2 py-1 text-right font-mono text-xs text-slate-900 dark:text-white"
                />
              </label>
              <label className="rounded-xl border border-stone-200 dark:border-ap-edge bg-white/70 dark:bg-ap-carbon px-3 py-2 flex items-center justify-between gap-2">
                <span className="text-2xs font-mono text-slate-600 dark:text-slate-300">
                  VARA Excluded (h)
                </span>
                <input
                  data-testid="cara-vara-input"
                  type="number"
                  min={0}
                  max={15}
                  step={0.5}
                  value={caraVaraHours}
                  onChange={(e) =>
                    setCaraVaraHours(Math.max(0, Math.min(15, Number(e.target.value) || 0)))
                  }
                  className="w-20 min-h-[40px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2 py-1 text-right font-mono text-xs text-slate-900 dark:text-white"
                />
              </label>
            </div>

            {connectedAthletesOnly.length === 0 ? (
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Connect roster athletes above to monitor rolling 7-day {caraSegment === 'OUT_OF_SEASON' ? '8h out-of-season' : '20h in-season'} practice hour caps, mandatory days off, and 3.0h competition day limits.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {connectedAthletesOnly.map((ath) => {
                  const baseAudit = summarizeNcaaCaraWeeklyHours(
                    ath.activities,
                    todayIso,
                    0,
                    [],
                    {
                      seasonSegment: caraSegment,
                      strengthHours: caraStrengthHours,
                      meetingFilmHours: caraMeetingHours,
                      varaHours: caraVaraHours,
                    }
                  );
                  const hours =
                    ath.activities.length === 0 && typeof ath.caraHours7d === 'number'
                      ? Number(
                          (ath.caraHours7d + caraStrengthHours + caraMeetingHours).toFixed(1)
                        )
                      : baseAudit.rolling7dCountableHours;
                  const compliant =
                    hours <= baseAudit.weeklyCapHours &&
                    baseAudit.maxSingleDayHours <= baseAudit.dailyCapHours &&
                    (ath.activities.length === 0 || baseAudit.daysOffCompliant !== false) &&
                    baseAudit.outOfSeasonSkillCompliant !== false;
                  return (
                    <div
                      key={`cara-${ath.id}`}
                      className="rounded-xl border border-stone-200 dark:border-ap-edge bg-white/80 dark:bg-ap-carbon p-3 text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-900 dark:text-white">{ath.name}</span>
                        <span
                          className={`px-2 py-0.5 rounded text-2xs font-mono font-bold ${
                            compliant ? 'ap-status-prime' : 'ap-status-strained'
                          }`}
                        >
                          {hours}h / {baseAudit.weeklyCapHours}h
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-1 text-2xs font-mono text-slate-600 dark:text-slate-300">
                        <span>
                          Days Off: {baseAudit.daysOffCount ?? 7}/{baseAudit.requiredDaysOff ?? 1}
                        </span>
                        {caraVaraHours > 0 && (
                          <span>VARA Excl: {caraVaraHours.toFixed(1)}h</span>
                        )}
                      </div>
                      {!compliant && (
                        <div className="text-2xs font-semibold text-rose-700 dark:text-rose-300">
                          {baseAudit.statusLabel}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          )}
        </div>
      )}

      {isExternalSyncOpen && (
        <WorkspaceErrorBoundary fallbackTitle="External Roster & Meet Sync" restoreTab="coach">
          <Suspense fallback={null}>
            <AthleticNetTfrrsSyncModal
              isOpen={isExternalSyncOpen}
              onClose={handleCloseExternalSync}
              activeTeam={activeTeam}
              myTeams={myTeams}
              selfName={primaryAthleteDisplayName}
              onTeamsUpdated={onTeamsUpdated}
              onOpenPublicHub={onOpenPublicTeamHub}
            />
          </Suspense>
        </WorkspaceErrorBoundary>
      )}

      {showOnboardingWizard && (
        <WorkspaceErrorBoundary fallbackTitle="Team Setup Wizard" restoreTab="coach">
          <Suspense fallback={null}>
            <CoachOnboardingWizard
              isOpen={showOnboardingWizard}
              myTeams={myTeams}
              selfName={primaryAthleteDisplayName}
              onClose={() => setShowOnboardingWizard(false)}
              onSetComplexityTier={(tier) => setComplexityTier(tier)}
              onTeamCreated={(teams, createdId) => {
                onTeamsUpdated(teams, createdId);
                setSubTab('CLIPBOARD');
              }}
              onOpenRosterStudio={() => {
                setOpenCreateTeamOnSwitch(false);
                setSubTab('ROSTER');
              }}
            />
          </Suspense>
        </WorkspaceErrorBoundary>
      )}

      {drawerAthlete && (
        <WorkspaceErrorBoundary fallbackTitle="Athlete Coach Summary" restoreTab="coach">
          <Suspense fallback={null}>
            <CoachAthleteSummaryDrawer
              athlete={drawerAthlete}
              activeTeam={activeTeam}
              onClose={() => setDrawerAthleteId(null)}
              onSwitchToProTelemetry={(athId) => {
                setComplexityTier('PRO');
                setDrawerAthleteId(null);
                onSelectAthleteViewport(athId);
                onOpenAthleteToday();
              }}
            />
          </Suspense>
        </WorkspaceErrorBoundary>
      )}

      {showMeetDayModal && (
        <WorkspaceErrorBoundary fallbackTitle="Meet-Day Entries & Packet" restoreTab="coach">
          <Suspense fallback={null}>
            <MeetDayHeatAndFlightModal
              isOpen={showMeetDayModal}
              onClose={() => setShowMeetDayModal(false)}
              activeTeam={activeTeam}
              myTeams={myTeams}
              connectedAthletes={connectedAthletesOnly}
              onTeamsUpdated={onTeamsUpdated}
            />
          </Suspense>
        </WorkspaceErrorBoundary>
      )}

      {showInjuryHubModal && (
        <WorkspaceErrorBoundary fallbackTitle="Athletic Trainer Injury Hub" restoreTab="coach">
          <Suspense fallback={null}>
            <AthleticTrainerInjuryHub
              isOpen={showInjuryHubModal}
              onClose={() => setShowInjuryHubModal(false)}
              activeTeam={activeTeam}
              myTeams={myTeams}
              isSampleDemoMode={isSampleDemoMode}
              onTeamsUpdated={onTeamsUpdated}
            />
          </Suspense>
        </WorkspaceErrorBoundary>
      )}

      {showDistrictAdModal && (
        <WorkspaceErrorBoundary fallbackTitle="District AD Overview" restoreTab="coach">
          <Suspense fallback={null}>
            <DistrictAdOverviewModal
              isOpen={showDistrictAdModal}
              onClose={() => setShowDistrictAdModal(false)}
              myTeams={myTeams}
              activeTeamId={activeTeamId}
              isSampleDemoMode={isSampleDemoMode}
              onSelectActiveTeam={(teamId) => onSelectActiveTeam(teamId)}
            />
          </Suspense>
        </WorkspaceErrorBoundary>
      )}
    </div>
  );
};
