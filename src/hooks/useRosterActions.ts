import React, { useCallback } from 'react';
import type {
  ConnectedAthleteRecord,
  PlannedWorkoutEvent,
  SportCategory,
  TeamSummaryWithRole,
} from '../types';
import { createConnectedAthleteRecord } from '../data/athleteRosterData';
import { getSavedIntervalsHeaders } from '../utils/telemetryStorage';

interface UseRosterActionsParams {
  isSampleDemoMode: boolean;
  activeTeam: TeamSummaryWithRole | null;
  handleTeamsUpdated: (teams: TeamSummaryWithRole[], preferredActiveId?: string | null) => void;
  setConnectedAthletes: React.Dispatch<React.SetStateAction<ConnectedAthleteRecord[]>>;
  setSampleDemoConnectedAthletes: React.Dispatch<React.SetStateAction<ConnectedAthleteRecord[]>>;
  setActiveViewedAthleteId: React.Dispatch<React.SetStateAction<string>>;
}

export function useRosterActions({
  isSampleDemoMode,
  activeTeam,
  handleTeamsUpdated,
  setConnectedAthletes,
  setSampleDemoConnectedAthletes,
  setActiveViewedAthleteId,
}: UseRosterActionsParams) {
  const handleApproveAthleteRequest = useCallback(
    (athleteId: string, role: 'COACH_EDIT' | 'FRIEND_VIEW') => {
      const applyApprove = (prev: ConnectedAthleteRecord[]) =>
        prev.map((a) => (a.id === athleteId ? { ...a, role, status: 'CONNECTED' as const } : a));
      if (isSampleDemoMode) {
        setSampleDemoConnectedAthletes(applyApprove);
      } else {
        setConnectedAthletes(applyApprove);
      }
    },
    [isSampleDemoMode, setConnectedAthletes, setSampleDemoConnectedAthletes]
  );

  const handleRemoveOrDeclineAthlete = useCallback(
    (athleteId: string) => {
      const applyRemove = (prev: ConnectedAthleteRecord[]) => prev.filter((a) => a.id !== athleteId);
      if (isSampleDemoMode) {
        setSampleDemoConnectedAthletes(applyRemove);
      } else {
        setConnectedAthletes(applyRemove);
      }
      setActiveViewedAthleteId((curr) => (curr === athleteId ? 'SELF' : curr));
    },
    [isSampleDemoMode, setActiveViewedAthleteId, setConnectedAthletes, setSampleDemoConnectedAthletes]
  );

  const handleToggleAthleteRole = useCallback(
    (athleteId: string) => {
      const applyToggle = (prev: ConnectedAthleteRecord[]) =>
        prev.map((a) =>
          a.id === athleteId
            ? {
                ...a,
                role: (a.role === 'COACH_EDIT' ? 'FRIEND_VIEW' : 'COACH_EDIT') as
                  | 'COACH_EDIT'
                  | 'FRIEND_VIEW',
              }
            : a
        );
      if (isSampleDemoMode) {
        setSampleDemoConnectedAthletes(applyToggle);
      } else {
        setConnectedAthletes(applyToggle);
      }
    },
    [isSampleDemoMode, setConnectedAthletes, setSampleDemoConnectedAthletes]
  );

  const handleAddFollowByInviteOrName = useCallback(
    (query: string, role: 'COACH_EDIT' | 'FRIEND_VIEW', specialty: 'Running' | 'Cycling') => {
      const clean = query.trim();
      if (!clean) return;
      const newRecord = createConnectedAthleteRecord(clean, role, specialty);
      if (isSampleDemoMode) {
        setSampleDemoConnectedAthletes((prev) => [newRecord, ...prev]);
      } else {
        setConnectedAthletes((prev) => [newRecord, ...prev]);
      }
    },
    [isSampleDemoMode, setConnectedAthletes, setSampleDemoConnectedAthletes]
  );

  const handlePushCoachWorkout = useCallback(
    (
      athleteId: string,
      workout: {
        date: string;
        name: string;
        sportCategory: SportCategory;
        plannedDurationSecs: number;
        plannedLoad: number;
        workoutSyntax: string;
        description: string;
      }
    ) => {
      if (!isSampleDemoMode && athleteId.startsWith('team-mem-') && activeTeam) {
        const targetMemId = athleteId.replace(/^team-mem-/, '');
        fetch(`/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}/workouts/broadcast`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...getSavedIntervalsHeaders(),
          },
          body: JSON.stringify({
            origin: window.location.origin,
            targetSquadGroup: 'INDIVIDUAL',
            targetMembershipIds: [targetMemId],
            date: workout.date,
            name: workout.name,
            sportCategory: workout.sportCategory,
            plannedDurationSecs: workout.plannedDurationSecs,
            plannedLoad: workout.plannedLoad,
            workoutSyntax: workout.workoutSyntax,
            description: workout.description,
          }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data?.teams && Array.isArray(data.teams)) {
              handleTeamsUpdated(data.teams, activeTeam.brand.teamId);
            }
          })
          .catch(() => {});
        return;
      }
      const newEvt: PlannedWorkoutEvent = {
        id: `coach-push-${Date.now()}`,
        date: workout.date,
        name: workout.name,
        sportCategory: workout.sportCategory,
        environmentPreference: 'FLEXIBLE',
        description: workout.description,
        plannedLoad: workout.plannedLoad,
        plannedDurationSecs: workout.plannedDurationSecs,
        targetZoneSummary: 'Coach Prescribed Session',
        workoutSyntax: workout.workoutSyntax,
        source: 'USER',
      };
      const applyPush = (prev: ConnectedAthleteRecord[]) =>
        prev.map((a) =>
          a.id === athleteId
            ? {
                ...a,
                plannedEvents: [...a.plannedEvents, newEvt].sort((x, y) =>
                  x.date.localeCompare(y.date)
                ),
              }
            : a
        );
      if (isSampleDemoMode) {
        setSampleDemoConnectedAthletes(applyPush);
      } else {
        setConnectedAthletes(applyPush);
      }
    },
    [
      isSampleDemoMode,
      activeTeam,
      handleTeamsUpdated,
      setConnectedAthletes,
      setSampleDemoConnectedAthletes,
    ]
  );

  return {
    handleApproveAthleteRequest,
    handleRemoveOrDeclineAthlete,
    handleToggleAthleteRole,
    handleAddFollowByInviteOrName,
    handlePushCoachWorkout,
  };
}
