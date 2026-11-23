import { useMemo, useState } from 'react';
import type {
  PlannedWorkoutEvent,
  PracticeVenueCategory,
  SportCategory,
  TeamBroadcastWorkout,
  TeamSummaryWithRole,
  TrackWorkoutSpec,
  WorkoutSessionSlot,
} from '../types';
import type { PlannedEventBatchItem } from '../components/GoalsView';
import { buildThreshSessionHeaders } from '../utils/teamLifecycleApi';
import { emitFunnelEvent, resolveFunnelTierFromOrgType } from '../utils/funnelTelemetry';

export interface UseCoachTeamPlanActionsParams {
  activeTeam: TeamSummaryWithRole | null;
  myTeams: TeamSummaryWithRole[];
  isDemoTeam: boolean;
  effectivePlannedEvents: PlannedWorkoutEvent[];
  onTeamsUpdated: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string | null) => void;
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
    sessionSlot?: WorkoutSessionSlot;
    locationName?: string;
    locationCategory?: PracticeVenueCategory;
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
      sessionSlot?: WorkoutSessionSlot;
      locationName?: string;
      locationCategory?: PracticeVenueCategory;
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
}

export function useCoachTeamPlanActions({
  activeTeam,
  myTeams,
  isDemoTeam,
  effectivePlannedEvents,
  onTeamsUpdated,
  onCreatePlannedEvent,
  onUpdatePlannedEvent,
  onDeletePlannedEvent,
  onDeletePlanBlock,
  onBatchCreatePlannedEvents,
}: UseCoachTeamPlanActionsParams) {
  const [teamPlanError, setTeamPlanError] = useState<string | null>(null);

  const canBroadcastTeam = Boolean(
    activeTeam &&
      (activeTeam.myRole === 'HEAD_COACH' ||
        activeTeam.myRole === 'ASSISTANT_COACH' ||
        activeTeam.myRole === 'ORG_ADMIN')
  );

  const teamPlanEvents = useMemo(() => {
    if (!activeTeam) return effectivePlannedEvents;
    const broadcastIds = new Set(
      (activeTeam.broadcastWorkouts || []).map((bw) => bw.broadcastId)
    );
    const scoped = effectivePlannedEvents.filter((ev) => broadcastIds.has(ev.id));
    return scoped.length > 0 ? scoped : effectivePlannedEvents;
  }, [activeTeam, effectivePlannedEvents]);

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
    if (canBroadcastTeam && activeTeam) {
      if (isDemoTeam) {
        const newBroadcast: TeamBroadcastWorkout = {
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
          emitFunnelEvent('workout_published', {
            role: 'COACH',
            tier: resolveFunnelTierFromOrgType(activeTeam.brand.orgType),
          });
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
    const isTeamBroadcast = Boolean(
      activeTeam &&
        (activeTeam.broadcastWorkouts?.some((bw) => bw.broadcastId === id) ||
          id.startsWith('bw_'))
    );
    if (canBroadcastTeam && activeTeam && isTeamBroadcast) {
      if (isDemoTeam) {
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
    if (canBroadcastTeam && activeTeam) {
      if (isDemoTeam) {
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
          emitFunnelEvent('workout_published', {
            role: 'COACH',
            tier: resolveFunnelTierFromOrgType(activeTeam.brand.orgType),
          });
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

  const handleTeamPlanDelete = async (id: string) => {
    setTeamPlanError(null);
    const isTeamBroadcast = Boolean(
      activeTeam &&
        (activeTeam.broadcastWorkouts?.some((bw) => bw.broadcastId === id) ||
          id.startsWith('bw_'))
    );
    if (canBroadcastTeam && activeTeam && isTeamBroadcast && isDemoTeam) {
      const updatedTeam: TeamSummaryWithRole = {
        ...activeTeam,
        broadcastWorkouts: (activeTeam.broadcastWorkouts || []).filter(
          (bw) => bw.broadcastId !== id
        ),
      };
      onTeamsUpdated(
        myTeams.map((t) =>
          t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
        ),
        updatedTeam.brand.teamId
      );
      await onDeletePlannedEvent(id);
      return;
    }
    await onDeletePlannedEvent(id);
  };

  const handleTeamPlanBlockDelete = async (planBlockId: string) => {
    setTeamPlanError(null);
    const hasDemoTeamBlock = Boolean(
      canBroadcastTeam &&
        activeTeam &&
        isDemoTeam &&
        activeTeam.broadcastWorkouts?.some((bw) => bw.planBlockId === planBlockId)
    );
    if (hasDemoTeamBlock && activeTeam) {
      const updatedTeam: TeamSummaryWithRole = {
        ...activeTeam,
        broadcastWorkouts: (activeTeam.broadcastWorkouts || []).filter(
          (bw) => bw.planBlockId !== planBlockId
        ),
      };
      onTeamsUpdated(
        myTeams.map((t) =>
          t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
        ),
        updatedTeam.brand.teamId
      );
    }
    await onDeletePlanBlock?.(planBlockId);
  };

  return {
    teamPlanError,
    teamPlanEvents,
    handleTeamPlanCreate,
    handleTeamPlanUpdate,
    handleTeamPlanBatchCreate,
    handleTeamPlanDelete,
    handleTeamPlanBlockDelete,
  };
}
