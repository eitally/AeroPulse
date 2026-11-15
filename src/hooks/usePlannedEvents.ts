import React, { useCallback } from 'react';
import type {
  ConnectedAthleteRecord,
  PlannedWorkoutEvent,
  SportCategory,
  TeamSummaryWithRole,
  TrackWorkoutSpec,
} from '../types';
import { getSavedIntervalsHeaders } from '../utils/telemetryStorage';

interface UsePlannedEventsParams {
  activeConnectedAthlete: ConnectedAthleteRecord | null;
  activeTeam: TeamSummaryWithRole | null;
  handleTeamsUpdated: (teams: TeamSummaryWithRole[], preferredActiveId?: string | null) => void;
  isSampleDemoMode: boolean;
  triggerReadOnlyAlert: (athleteName: string, actionLabel: string) => void;
  setPlannedEvents: React.Dispatch<React.SetStateAction<PlannedWorkoutEvent[]>>;
  setSampleDemoPlannedEvents: React.Dispatch<React.SetStateAction<PlannedWorkoutEvent[]>>;
  setConnectedAthletes: React.Dispatch<React.SetStateAction<ConnectedAthleteRecord[]>>;
  setSampleDemoConnectedAthletes: React.Dispatch<React.SetStateAction<ConnectedAthleteRecord[]>>;
}

export function usePlannedEvents({
  activeConnectedAthlete,
  activeTeam,
  handleTeamsUpdated,
  isSampleDemoMode,
  triggerReadOnlyAlert,
  setPlannedEvents,
  setSampleDemoPlannedEvents,
  setConnectedAthletes,
  setSampleDemoConnectedAthletes,
}: UsePlannedEventsParams) {
  const handleCreatePlannedEvent = useCallback(
    async (eventInput: {
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
    }) => {
      if (activeConnectedAthlete) {
        if (activeConnectedAthlete.role === 'FRIEND_VIEW') {
          triggerReadOnlyAlert(activeConnectedAthlete.name, 'schedule workouts');
          return;
        }
        if (activeConnectedAthlete.id.startsWith('team-mem-') && activeTeam) {
          const targetMemId = activeConnectedAthlete.id.replace(/^team-mem-/, '');
          try {
            const resp = await fetch(
              `/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}/workouts/broadcast`,
              {
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
                  date: eventInput.date,
                  name: eventInput.name,
                  sportCategory:
                    eventInput.sportCategory === 'Cycling' ? 'Cycling' : 'Running',
                  plannedDurationSecs: eventInput.plannedDurationSecs,
                  plannedLoad: eventInput.plannedLoad,
                  workoutSyntax: eventInput.workoutSyntax,
                  description: eventInput.description,
                }),
              }
            );
            if (resp.ok) {
              const data = await resp.json();
              if (Array.isArray(data.teams)) {
                handleTeamsUpdated(data.teams, activeTeam.brand.teamId);
              }
              return;
            }
          } catch {
            // fall through to local state if offline
          }
        }
        const coachEvt: PlannedWorkoutEvent = {
          id: `coach-evt-${Date.now()}`,
          date: eventInput.date,
          name: eventInput.name,
          sportCategory: eventInput.sportCategory,
          environmentPreference: eventInput.environmentPreference,
          description: eventInput.description,
          plannedLoad: eventInput.plannedLoad,
          plannedDurationSecs: eventInput.plannedDurationSecs,
          targetZoneSummary: 'Coach Prescribed Session',
          workoutSyntax: eventInput.workoutSyntax,
          ...(eventInput.trackSpec ? { trackSpec: eventInput.trackSpec } : {}),
          source: 'USER',
        };
        const applyCoachEvt = (prev: ConnectedAthleteRecord[]) =>
          prev.map((a) => {
            if (a.id !== activeConnectedAthlete.id) return a;
            const base = eventInput.replaceExistingDate
              ? a.plannedEvents.filter(
                  (e) =>
                    !(
                      e.date.slice(0, 10) === eventInput.date.slice(0, 10) &&
                      e.sportCategory === eventInput.sportCategory
                    )
                )
              : a.plannedEvents;
            return {
              ...a,
              plannedEvents: [...base, coachEvt].sort((x, y) => x.date.localeCompare(y.date)),
            };
          });
        if (isSampleDemoMode) {
          setSampleDemoConnectedAthletes(applyCoachEvt);
        } else {
          setConnectedAthletes(applyCoachEvt);
        }
        return;
      }

      if (isSampleDemoMode) {
        setSampleDemoPlannedEvents((prev) => {
          const base = eventInput.replaceExistingDate
            ? prev.filter(
                (e) =>
                  !(
                    e.date.slice(0, 10) === eventInput.date.slice(0, 10) &&
                    e.sportCategory === eventInput.sportCategory
                  )
              )
            : prev;
          return [
            ...base,
            {
              id: `sample-local-${Date.now()}`,
              date: eventInput.date,
              name: eventInput.name,
              sportCategory: eventInput.sportCategory,
              environmentPreference: eventInput.environmentPreference,
              description: eventInput.description,
              plannedLoad: eventInput.plannedLoad,
              plannedDurationSecs: eventInput.plannedDurationSecs,
              targetZoneSummary: 'Sample Planned Session',
              workoutSyntax: eventInput.workoutSyntax,
              ...(eventInput.trackSpec ? { trackSpec: eventInput.trackSpec } : {}),
            },
          ].sort((a, b) => a.date.localeCompare(b.date));
        });
        return;
      }

      try {
        const resp = await fetch('/api/calendar/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getSavedIntervalsHeaders(),
          },
          body: JSON.stringify(eventInput),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.event) {
            setPlannedEvents((prev) => {
              const base = eventInput.replaceExistingDate
                ? prev.filter(
                    (e) =>
                      !(
                        e.date.slice(0, 10) === eventInput.date.slice(0, 10) &&
                        e.sportCategory === eventInput.sportCategory
                      )
                  )
                : prev;
              return [...base, data.event];
            });
            return;
          }
        }
      } catch {
        // Fallback to local state
      }
      setPlannedEvents((prev) => {
        const base = eventInput.replaceExistingDate
          ? prev.filter(
              (e) =>
                !(
                  e.date.slice(0, 10) === eventInput.date.slice(0, 10) &&
                  e.sportCategory === eventInput.sportCategory
                )
            )
          : prev;
        return [
          ...base,
          {
            id: `local-${Date.now()}`,
            date: eventInput.date,
            name: eventInput.name,
            sportCategory: eventInput.sportCategory,
            environmentPreference: eventInput.environmentPreference,
            description: eventInput.description,
            plannedLoad: eventInput.plannedLoad,
            plannedDurationSecs: eventInput.plannedDurationSecs,
            targetZoneSummary: 'Structured Workout',
            workoutSyntax: eventInput.workoutSyntax,
            ...(eventInput.trackSpec ? { trackSpec: eventInput.trackSpec } : {}),
          },
        ];
      });
    },
    [
      activeConnectedAthlete,
      activeTeam,
      handleTeamsUpdated,
      isSampleDemoMode,
      triggerReadOnlyAlert,
      setConnectedAthletes,
      setPlannedEvents,
      setSampleDemoConnectedAthletes,
      setSampleDemoPlannedEvents,
    ]
  );

  const handleBatchCreatePlannedEvents = useCallback(
    async (
      items: Array<{
        date: string;
        name: string;
        sportCategory: SportCategory;
        environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
        description: string;
        plannedLoad: number;
        plannedDurationSecs: number;
        targetZoneSummary?: string;
        workoutSyntax: string;
        trackSpec?: TrackWorkoutSpec;
        replaceExistingDate?: boolean;
      }>
    ) => {
      const nowTs = Date.now();
      const createdEvents = items.map((item, idx) => ({
        id: `plan-block-${nowTs}-${idx}`,
        date: item.date,
        name: item.name,
        sportCategory: item.sportCategory,
        environmentPreference: item.environmentPreference,
        description: item.description,
        plannedLoad: item.plannedLoad,
        plannedDurationSecs: item.plannedDurationSecs,
        targetZoneSummary: item.targetZoneSummary || 'Structured Workout',
        workoutSyntax: item.workoutSyntax,
        ...(item.trackSpec ? { trackSpec: item.trackSpec } : {}),
      }));

      if (activeConnectedAthlete) {
        if (activeConnectedAthlete.role === 'FRIEND_VIEW') {
          triggerReadOnlyAlert(activeConnectedAthlete.name, 'generate multi-week training plans');
          return;
        }
        const targetDates = new Set(items.map((i) => `${i.date.slice(0, 10)}:${i.sportCategory}`));
        const applyBatchToRoster = (prev: ConnectedAthleteRecord[]) =>
          prev.map((a) => {
            if (a.id !== activeConnectedAthlete.id) return a;
            const filtered = a.plannedEvents.filter(
              (e) => !targetDates.has(`${e.date.slice(0, 10)}:${e.sportCategory}`)
            );
            return {
              ...a,
              plannedEvents: [...filtered, ...createdEvents].sort((x, y) =>
                x.date.localeCompare(y.date)
              ),
            };
          });
        if (isSampleDemoMode) {
          setSampleDemoConnectedAthletes(applyBatchToRoster);
        } else {
          setConnectedAthletes(applyBatchToRoster);
        }
        return;
      }

      if (isSampleDemoMode) {
        setSampleDemoPlannedEvents((prev) => {
          const targetDates = new Set(items.map((i) => `${i.date.slice(0, 10)}:${i.sportCategory}`));
          const filtered = prev.filter(
            (e) => !targetDates.has(`${e.date.slice(0, 10)}:${e.sportCategory}`)
          );
          return [...filtered, ...createdEvents].sort((a, b) => a.date.localeCompare(b.date));
        });
        return;
      }

      setPlannedEvents((prev) => {
        const targetDates = new Set(items.map((i) => `${i.date.slice(0, 10)}:${i.sportCategory}`));
        const filtered = prev.filter(
          (e) => !targetDates.has(`${e.date.slice(0, 10)}:${e.sportCategory}`)
        );
        return [...filtered, ...createdEvents].sort((a, b) => a.date.localeCompare(b.date));
      });
    },
    [
      activeConnectedAthlete,
      isSampleDemoMode,
      triggerReadOnlyAlert,
      setConnectedAthletes,
      setPlannedEvents,
      setSampleDemoConnectedAthletes,
      setSampleDemoPlannedEvents,
    ]
  );

  const handleDeletePlannedEvent = useCallback(
    async (id: string) => {
      if (activeConnectedAthlete) {
        if (activeConnectedAthlete.role === 'FRIEND_VIEW') {
          triggerReadOnlyAlert(activeConnectedAthlete.name, 'delete planned workouts');
          return;
        }
        const removeFromRoster = (prev: ConnectedAthleteRecord[]) =>
          prev.map((a) =>
            a.id === activeConnectedAthlete.id
              ? { ...a, plannedEvents: a.plannedEvents.filter((e) => e.id !== id) }
              : a
          );
        if (isSampleDemoMode) {
          setSampleDemoConnectedAthletes(removeFromRoster);
        } else {
          setConnectedAthletes(removeFromRoster);
        }
        return;
      }

      if (isSampleDemoMode) {
        setSampleDemoPlannedEvents((prev) => prev.filter((e) => e.id !== id));
        return;
      }

      setPlannedEvents((prev) => prev.filter((e) => e.id !== id));
      try {
        await fetch(`/api/calendar/events/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: getSavedIntervalsHeaders(),
        });
      } catch {
        // ignore
      }
    },
    [
      activeConnectedAthlete,
      isSampleDemoMode,
      triggerReadOnlyAlert,
      setConnectedAthletes,
      setPlannedEvents,
      setSampleDemoConnectedAthletes,
      setSampleDemoPlannedEvents,
    ]
  );

  return {
    handleCreatePlannedEvent,
    handleBatchCreatePlannedEvents,
    handleDeletePlannedEvent,
  };
}
