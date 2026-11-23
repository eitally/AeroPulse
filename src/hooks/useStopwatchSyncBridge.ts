import React, { useCallback, useEffect } from 'react';
import type {
  AthleteGearItem,
  AthleteProfile,
  ConnectedAthleteRecord,
  PlannedWorkoutEvent,
  TeamSummaryWithRole,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import type { SavedStopwatchEntry } from '../components/TracksideStopwatchView';
import {
  enqueueStopwatchOutboxBatch,
  flushStopwatchOutbox,
  overlayPendingStopwatchOutboxOnTeams,
  partitionSavedStopwatchEntries,
  persistWalkOnStopwatchEntriesLocal,
  type StopwatchOutboxFlushResult,
  type StopwatchSaveResult,
} from '../utils/stopwatchTeamSync';
import {
  flushFieldOutbox,
  overlayPendingFieldOutboxOnTeams,
} from '../utils/fieldEventsOutbox';
import {
  mergeActivitiesNonDestructive,
  recomputeWellnessDaysWithActivityImport,
  savePersistedTelemetrySnapshot,
} from '../utils/telemetryStorage';
import { getLocalDateIso } from '../physiology/stravaLoadCalibration';

interface UseStopwatchSyncBridgeParams {
  isSampleDemoMode: boolean;
  isSessionLoggedOut: boolean;
  hasEnteredWorkspace: boolean;
  activeTeamId: string | null;
  effectiveActiveTeam: TeamSummaryWithRole | null;
  combinedRoster: ConnectedAthleteRecord[];
  activitiesRef: React.MutableRefObject<UnifiedActivity[]>;
  wellnessDaysRef: React.MutableRefObject<UnifiedWellnessDay[]>;
  plannedEventsRef: React.MutableRefObject<PlannedWorkoutEvent[]>;
  gearItemsRef: React.MutableRefObject<AthleteGearItem[]>;
  athleteProfileRef: React.MutableRefObject<AthleteProfile>;
  redactedStravaCountRef: React.MutableRefObject<number>;
  setActivities: React.Dispatch<React.SetStateAction<UnifiedActivity[]>>;
  setWellnessDays: React.Dispatch<React.SetStateAction<UnifiedWellnessDay[]>>;
  setConnectedAthletes: React.Dispatch<React.SetStateAction<ConnectedAthleteRecord[]>>;
  setSampleDemoConnectedAthletes: React.Dispatch<React.SetStateAction<ConnectedAthleteRecord[]>>;
  setMyTeams: React.Dispatch<React.SetStateAction<TeamSummaryWithRole[]>>;
  applyImportedActivities: (incomingActs: UnifiedActivity[]) => void;
}

/**
 * Bridges trackside stopwatch & field-event saves into local IndexedDB telemetry,
 * connected roster accounts, and the offline-resilient team sync outbox.
 */
export function useStopwatchSyncBridge({
  isSampleDemoMode,
  isSessionLoggedOut,
  hasEnteredWorkspace,
  activeTeamId,
  effectiveActiveTeam,
  combinedRoster,
  activitiesRef,
  wellnessDaysRef,
  plannedEventsRef,
  gearItemsRef,
  athleteProfileRef,
  redactedStravaCountRef,
  setActivities,
  setWellnessDays,
  setConnectedAthletes,
  setSampleDemoConnectedAthletes,
  setMyTeams,
  applyImportedActivities,
}: UseStopwatchSyncBridgeParams) {
  const applyUpdatedTeamToState = useCallback(
    (updatedTeam: TeamSummaryWithRole) => {
      setMyTeams((prev) => {
        const replaced = prev.map((t) =>
          t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
        );
        const withOutbox = overlayPendingFieldOutboxOnTeams(
          overlayPendingStopwatchOutboxOnTeams(replaced)
        );
        try {
          localStorage.setItem('thresh_my_teams_v1', JSON.stringify(withOutbox));
        } catch {
          // ignore
        }
        return withOutbox;
      });
    },
    [setMyTeams]
  );

  const handleFlushStopwatchOutbox = useCallback(async (): Promise<StopwatchOutboxFlushResult> => {
    if (isSampleDemoMode || isSessionLoggedOut || !hasEnteredWorkspace) {
      return { syncedBatches: 0, syncedEntries: 0, remainingBatches: 0, remainingEntries: 0 };
    }
    const swRes = await flushStopwatchOutbox(applyUpdatedTeamToState);
    if ((swRes.deadLetteredBatches || 0) > 0) {
      console.warn(
        `[MeetReady Stopwatch] DEAD_LETTERED ${swRes.deadLetteredBatches} poison-pill stopwatch batch(es).`
      );
    }
    void flushFieldOutbox(applyUpdatedTeamToState);
    return swRes;
  }, [isSampleDemoMode, isSessionLoggedOut, hasEnteredWorkspace, applyUpdatedTeamToState]);

  useEffect(() => {
    if (isSampleDemoMode || isSessionLoggedOut || !hasEnteredWorkspace) return;
    void handleFlushStopwatchOutbox();
    void flushFieldOutbox(applyUpdatedTeamToState);
    const onOnline = () => {
      void handleFlushStopwatchOutbox();
      void flushFieldOutbox(applyUpdatedTeamToState);
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [
    isSampleDemoMode,
    isSessionLoggedOut,
    hasEnteredWorkspace,
    handleFlushStopwatchOutbox,
    applyUpdatedTeamToState,
  ]);

  const handleSaveStopwatchActivities = useCallback(
    async (entries: SavedStopwatchEntry[]): Promise<StopwatchSaveResult> => {
      if (!entries || entries.length === 0) {
        return {
          savedCount: 0,
          selfCount: 0,
          rosterCount: 0,
          teamCount: 0,
          walkOnCount: 0,
          pendingTeamCount: 0,
          skippedReadOnlyNames: [],
          syncStatus: 'LOCAL_ONLY',
        };
      }

      const activeTeamForCoach = !isSampleDemoMode ? effectiveActiveTeam : null;
      const isTeamCoach = Boolean(
        activeTeamForCoach &&
          (activeTeamForCoach.myRole === 'HEAD_COACH' ||
            activeTeamForCoach.myRole === 'ASSISTANT_COACH')
      );
      const activeTeamMembershipIds = activeTeamForCoach
        ? new Set(activeTeamForCoach.memberships.map((m) => m.membershipId))
        : undefined;

      const {
        selfActs,
        rosterByRunnerId,
        teamApiEntries,
        walkOnEntries,
        skippedReadOnlyNames,
        savedCount,
      } = partitionSavedStopwatchEntries(entries, combinedRoster, {
        isTeamCoach,
        activeTeamMembershipIds,
      });

      if (selfActs.length > 0) {
        if (isSampleDemoMode) {
          applyImportedActivities(selfActs);
        } else {
          const merged = mergeActivitiesNonDestructive(activitiesRef.current, selfActs);
          activitiesRef.current = merged;
          setActivities(merged);
          const rebuiltWellness = recomputeWellnessDaysWithActivityImport(
            wellnessDaysRef.current,
            merged,
            getLocalDateIso(),
            athleteProfileRef.current
          );
          wellnessDaysRef.current = rebuiltWellness;
          setWellnessDays(rebuiltWellness);
          void savePersistedTelemetrySnapshot({
            activities: merged,
            wellnessDays: rebuiltWellness,
            plannedEvents: plannedEventsRef.current,
            gearItems: gearItemsRef.current,
            athleteProfile: athleteProfileRef.current,
            redactedStravaCount: redactedStravaCountRef.current,
          });
        }
      }

      if (walkOnEntries.length > 0 && !isSampleDemoMode) {
        persistWalkOnStopwatchEntriesLocal(walkOnEntries);
      }

      if (rosterByRunnerId.size > 0) {
        const mergeRosterActs = (prev: ConnectedAthleteRecord[]) =>
          prev.map((a) => {
            const added = rosterByRunnerId.get(a.id);
            return added && added.length > 0
              ? { ...a, activities: mergeActivitiesNonDestructive(a.activities, added) }
              : a;
          });
        if (isSampleDemoMode) {
          setSampleDemoConnectedAthletes(mergeRosterActs);
        } else {
          setConnectedAthletes(mergeRosterActs);
        }
      }

      let syncStatus: StopwatchSaveResult['syncStatus'] = 'LOCAL_ONLY';
      let pendingTeamCount = 0;
      let deadLetteredBatches = 0;
      let syncWarning: string | undefined;

      if (!isSampleDemoMode && activeTeamId && teamApiEntries.length > 0) {
        enqueueStopwatchOutboxBatch(activeTeamId, teamApiEntries);
        setMyTeams((prev) => {
          const withOutbox = overlayPendingFieldOutboxOnTeams(
            overlayPendingStopwatchOutboxOnTeams(prev)
          );
          try {
            localStorage.setItem('thresh_my_teams_v1', JSON.stringify(withOutbox));
          } catch {
            // ignore
          }
          return withOutbox;
        });
        const flushRes = await flushStopwatchOutbox(applyUpdatedTeamToState);
        pendingTeamCount = flushRes.remainingEntries;
        deadLetteredBatches = flushRes.deadLetteredBatches || 0;
        if (deadLetteredBatches > 0) {
          syncWarning = `DEAD_LETTERED: ${deadLetteredBatches} stopwatch batch(es) quarantined after permanent failure or max retries.`;
          console.warn(`[MeetReady Stopwatch] ${syncWarning}`);
          syncStatus = 'DEAD_LETTERED' as StopwatchSaveResult['syncStatus'];
        } else {
          syncStatus = flushRes.remainingEntries === 0 ? 'SYNCED' : 'PENDING_OFFLINE';
        }
      }

      return {
        savedCount,
        selfCount: selfActs.length,
        rosterCount: rosterByRunnerId.size,
        teamCount: teamApiEntries.length,
        walkOnCount: walkOnEntries.length,
        pendingTeamCount,
        skippedReadOnlyNames,
        syncStatus,
        ...(deadLetteredBatches > 0 ? { deadLetteredBatches, syncWarning } : {}),
      };
    },
    [
      combinedRoster,
      isSampleDemoMode,
      activeTeamId,
      effectiveActiveTeam,
      activitiesRef,
      wellnessDaysRef,
      plannedEventsRef,
      gearItemsRef,
      athleteProfileRef,
      redactedStravaCountRef,
      setActivities,
      setWellnessDays,
      setConnectedAthletes,
      setSampleDemoConnectedAthletes,
      setMyTeams,
      applyUpdatedTeamToState,
      applyImportedActivities,
    ]
  );

  return {
    applyUpdatedTeamToState,
    handleFlushStopwatchOutbox,
    handleSaveStopwatchActivities,
  };
}
