import { useCallback, useEffect, useRef } from 'react';
import type {
  AthleteProfile,
  StravaSyncWindow,
  TeamSummaryWithRole,
  ThreshUser,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import { getStoreMetadata, saveStoreMetadata } from '../db/workoutStore';
import {
  CURRENT_PMC_MODEL_VERSION,
  type StravaExchangeResponse,
  buildCompleteAthleteProfile,
  clearPersistedTelemetrySnapshot,
  getSavedIntervalsHeaders,
  hasPendingTeamJoinInBrowser,
  isBrowserSessionLoggedOut,
  isGenericAthleteName,
  loadPersistedTelemetrySnapshot,
  loadStravaSyncPolicyFromStorage,
  safeParseResponseJson,
  saveStravaSyncPolicyToStorage,
} from '../utils/telemetryStorage';
import {
  AUTH_ERROR_LABELS,
  hasStravaClientCredentials,
  type CompleteStravaAuthFn,
  type UseTelemetrySyncParams,
} from './telemetrySync/stravaDtoMapper';
import { runFetchServerConfigStatus } from './telemetrySync/fetchServerConfigStatusRunner';
import { runLiveTelemetrySync } from './telemetrySync/runLiveTelemetrySync';

export { hasStravaClientCredentials, type CompleteStravaAuthFn };

export function useTelemetrySync({
  activitiesRef,
  setActivities,
  wellnessDaysRef,
  setWellnessDays,
  plannedEventsRef,
  setPlannedEvents,
  gearItemsRef,
  setGearItems,
  redactedStravaCountRef,
  setRedactedStravaCount,
  athleteProfileRef,
  setAthleteProfile,
  setConnectionStatus,
  setCurrentUser,
  setDistanceUnit,
  setIdbSavedAt,
  setIsSyncing,
  setSyncError,
  setMyTeams,
  setActiveTeamId,
  setActiveViewedAthleteId,
  idbHydratedRef,
  hasEnteredWorkspace,
  hasEnteredWorkspaceRef,
  setHasEnteredWorkspace,
  isSessionLoggedOut,
  setIsSessionLoggedOut,
  isSampleDemoMode,
  completeStravaAuthHandshakeRef,
}: UseTelemetrySyncParams) {
  const needsPmcModelV2SyncRef = useRef(false);

  const reconcileStoreOwnerAthleteId = useCallback(
    async (incomingAthleteId?: string | number | null, allowedPreviousIds: string[] = []) => {
      const cleanId = incomingAthleteId ? String(incomingAthleteId).trim() : '';
      if (!cleanId) return;
      try {
        const [snapshotMeta] = await Promise.all([
          getStoreMetadata<{ ownerAthleteId?: string }>('snapshot_meta'),
        ]);
        const idbOwner = snapshotMeta?.ownerAthleteId
          ? String(snapshotMeta.ownerAthleteId).trim()
          : '';
        const prevOwner =
          idbOwner ||
          localStorage.getItem('aeropulse_store_owner_athlete_id') ||
          localStorage.getItem('aeropulse_strava_athlete_id') ||
          '';
        const allowedSet = new Set([cleanId, ...allowedPreviousIds.map((x) => String(x).trim()).filter(Boolean)]);
        if (prevOwner && !allowedSet.has(prevOwner)) {
          await clearPersistedTelemetrySnapshot();
          setIdbSavedAt(null);
          setActivities([]);
          activitiesRef.current = [];
          setWellnessDays([]);
          wellnessDaysRef.current = [];
          setPlannedEvents([]);
          plannedEventsRef.current = [];
          setGearItems([]);
          gearItemsRef.current = [];
          setRedactedStravaCount(0);
          redactedStravaCountRef.current = 0;
          setMyTeams([]);
          setActiveTeamId(null);
          setActiveViewedAthleteId('SELF');
          localStorage.removeItem('thresh_primary_sport');
          const cleanProf = buildCompleteAthleteProfile(null);
          setAthleteProfile(cleanProf);
          athleteProfileRef.current = cleanProf;
          localStorage.removeItem('thresh_my_teams_v1');
          localStorage.removeItem('thresh_active_team_id_v1');
          localStorage.removeItem('thresh_personal_mode_v1');
          localStorage.removeItem('aeropulse_garmin_athlete_name');
          localStorage.removeItem('aeropulse_intervals_athlete_name');
          localStorage.removeItem('aeropulse_strava_sync_policy');
        }
        // Always stamp canonical owner onto IndexedDB metadata + localStorage without wiping pre-Strava data
        try {
          localStorage.setItem('aeropulse_store_owner_athlete_id', cleanId);
        } catch {
          // ignore
        }
        await saveStoreMetadata('snapshot_meta', {
          ...(snapshotMeta || {}),
          ownerAthleteId: cleanId,
        }).catch(() => undefined);
        if (activitiesRef.current.length === 0) {
        const cached = await loadPersistedTelemetrySnapshot();
        if (cached) {
          if ((cached.pmcModelVersion || 0) < CURRENT_PMC_MODEL_VERSION) {
            needsPmcModelV2SyncRef.current = true;
          }
          if (Array.isArray(cached.activities) && cached.activities.length > 0) {
            setActivities(cached.activities);
            activitiesRef.current = cached.activities;
          }
          if (Array.isArray(cached.wellnessDays) && cached.wellnessDays.length > 0) {
            setWellnessDays(cached.wellnessDays);
            wellnessDaysRef.current = cached.wellnessDays;
          }
          if (Array.isArray(cached.plannedEvents) && cached.plannedEvents.length > 0) {
            setPlannedEvents(cached.plannedEvents);
            plannedEventsRef.current = cached.plannedEvents;
          }
          if (Array.isArray(cached.gearItems) && cached.gearItems.length > 0) {
            setGearItems(cached.gearItems);
            gearItemsRef.current = cached.gearItems;
          }
          if (typeof cached.redactedStravaCount === 'number') {
            setRedactedStravaCount(cached.redactedStravaCount);
            redactedStravaCountRef.current = cached.redactedStravaCount;
          }
          if (cached.athleteProfile) {
            const latestW =
              Array.isArray(cached.wellnessDays) && cached.wellnessDays.length > 0
                ? cached.wellnessDays[cached.wellnessDays.length - 1]
                : undefined;
            const hydratedProf = buildCompleteAthleteProfile(
              cached.athleteProfile,
              latestW,
              cached.activities
            );
            setAthleteProfile(hydratedProf);
            athleteProfileRef.current = hydratedProf;
          }
          setIdbSavedAt(cached.savedAt);
        }
      }
      localStorage.setItem('aeropulse_store_owner_athlete_id', cleanId);
      if (!cleanId.startsWith('usr_')) {
        localStorage.setItem('aeropulse_strava_athlete_id', cleanId);
      }
    } catch {
      // ignore storage errors
    }
  }, []);



  const fetchServerConfigStatus = useCallback(async () => {
    return runFetchServerConfigStatus({
      activitiesRef,
      wellnessDaysRef,
      athleteProfileRef,
      setAthleteProfile,
      setConnectionStatus,
      setCurrentUser,
      setDistanceUnit,
      hasEnteredWorkspaceRef,
      setHasEnteredWorkspace,
      setIsSessionLoggedOut,
      reconcileStoreOwnerAthleteId,
    });
  }, [reconcileStoreOwnerAthleteId]);

  const syncLiveTelemetry = useCallback(
    async (fullHistory = false, explicitStravaWindow?: StravaSyncWindow) => {
      return runLiveTelemetrySync(
        {
          activitiesRef,
          setActivities,
          wellnessDaysRef,
          setWellnessDays,
          plannedEventsRef,
          setPlannedEvents,
          gearItemsRef,
          setGearItems,
          redactedStravaCountRef,
          setRedactedStravaCount,
          athleteProfileRef,
          setAthleteProfile,
          setConnectionStatus,
          setIdbSavedAt,
          setIsSyncing,
          setSyncError,
          needsPmcModelV2SyncRef,
          fetchServerConfigStatus,
        },
        fullHistory,
        explicitStravaWindow
      );
    },
    [fetchServerConfigStatus]
  );

  useEffect(() => {
    if (isSampleDemoMode) {
      idbHydratedRef.current = true;
      return;
    }
    let mounted = true;
    (async () => {
      let notLoggedOutAtBoot = true;
      try {
        notLoggedOutAtBoot = localStorage.getItem('aeropulse_logged_out') !== '1';
      } catch {
        notLoggedOutAtBoot = true;
      }
      if (notLoggedOutAtBoot) {
        const cached = await loadPersistedTelemetrySnapshot();
        if (mounted && cached) {
          if ((cached.pmcModelVersion || 0) < CURRENT_PMC_MODEL_VERSION) {
            needsPmcModelV2SyncRef.current = true;
          }
          if (Array.isArray(cached.activities) && cached.activities.length > 0) {
            setActivities(cached.activities);
            activitiesRef.current = cached.activities;
          }
          if (Array.isArray(cached.wellnessDays) && cached.wellnessDays.length > 0) {
            setWellnessDays(cached.wellnessDays);
            wellnessDaysRef.current = cached.wellnessDays;
          }
          if (Array.isArray(cached.plannedEvents) && cached.plannedEvents.length > 0) {
            setPlannedEvents(cached.plannedEvents);
            plannedEventsRef.current = cached.plannedEvents;
          }
          if (Array.isArray(cached.gearItems) && cached.gearItems.length > 0) {
            setGearItems(cached.gearItems);
            gearItemsRef.current = cached.gearItems;
          }
          if (cached.athleteProfile) {
            const latestW =
              Array.isArray(cached.wellnessDays) && cached.wellnessDays.length > 0
                ? cached.wellnessDays[cached.wellnessDays.length - 1]
                : undefined;
            const hydratedProf = buildCompleteAthleteProfile(
              cached.athleteProfile,
              latestW,
              cached.activities
            );
            setAthleteProfile(hydratedProf);
            athleteProfileRef.current = hydratedProf;
          }
          if (typeof cached.redactedStravaCount === 'number') {
            setRedactedStravaCount(cached.redactedStravaCount);
            redactedStravaCountRef.current = cached.redactedStravaCount;
          }
          setIdbSavedAt(cached.savedAt);

          const totalGarmin = cached.activities.filter(
            (a) => a.sourceBadges.includes('Garmin') || a.sourceBadges.includes('Intervals.icu')
          ).length;
          const totalStrava = cached.activities.filter(
            (a) => a.sourceBadges.includes('Strava') || Boolean(a.stravaId)
          ).length;
          const oldest =
            cached.earliestActivityDate ||
            (cached.activities.length > 0
              ? cached.activities[cached.activities.length - 1].startDateLocal.slice(0, 10)
              : undefined);

          setConnectionStatus((prev) => ({
            ...prev,
            totalActivitiesCount: cached.activities.length,
            garminActivitiesCount: totalGarmin,
            stravaActivitiesCount: totalStrava,
            earliestActivityDate: oldest || prev.earliestActivityDate,
            lastSyncedAt: cached.savedAt,
          }));
        }
      }
      idbHydratedRef.current = true;

      let exchangedUrlCode = false;
      try {
        const params = new URLSearchParams(window.location.search);
        const urlAuthErr = params.get('auth_error');
        const urlCode = params.get('code');
        const urlOAuthMarker = params.get('oauth');
        const urlOAuthJustConnected = params.get('oauth_just_connected');
        const urlAuthJustSignedIn = params.get('auth_just_signed_in');

        if (urlAuthJustSignedIn || urlOAuthJustConnected || urlOAuthMarker === 'strava_connected') {
          try {
            localStorage.removeItem('aeropulse_logged_out');
          } catch {
            // ignore
          }
          if (mounted) setIsSessionLoggedOut(false);
        }

        if (urlAuthErr) {
          setSyncError(AUTH_ERROR_LABELS[urlAuthErr] || urlAuthErr);
          params.delete('auth_error');
        } else if (urlCode) {
          params.delete('code');
          params.delete('scope');
          params.delete('state');
          const exResp = await fetch('/api/strava/exchange-code', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
            body: JSON.stringify({ code: urlCode }),
          });
          const exData = await safeParseResponseJson<StravaExchangeResponse>(exResp);
          if (exResp.ok && (exData.accessToken || exData.refreshToken || exData.tokens)) {
            const tokens = exData.tokens || {
              refreshToken: exData.refreshToken,
              accessToken: exData.accessToken,
              expiresAt: exData.expiresAt,
              clientId: exData.clientId,
              athleteId: exData.athleteId,
              athleteName: exData.athleteName,
              weightKg: exData.weightKg,
              ftp: exData.ftp,
              measurementPreference: exData.measurementPreference,
              grantedScope: exData.grantedScope,
            };
            if (completeStravaAuthHandshakeRef.current) {
              await completeStravaAuthHandshakeRef.current({
                tokens,
                sessionToken: exData.sessionToken,
                hasExistingSyncPolicy: exData.hasExistingSyncPolicy,
              });
            }
            exchangedUrlCode = true;
          } else if (exData?.error) {
            setSyncError(exData.error);
          }
        }

        let mutatedQuery = Boolean(urlAuthErr || urlCode);
        for (const transientKey of [
          'oauth',
          'oauth_just_connected',
          'auth_just_signed_in',
          'strava_athlete_id',
          'strava_athlete_name',
        ]) {
          if (params.has(transientKey)) {
            params.delete(transientKey);
            mutatedQuery = true;
          }
        }
        if (mutatedQuery) {
          const cleanQuery = params.toString();
          const nextUrl = `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}${window.location.hash}`;
          window.history.replaceState({}, '', nextUrl);
        }
      } catch {
        // ignore URL parse issues
      }

      let justConnectedViaOAuth = false;
      try {
        justConnectedViaOAuth = localStorage.getItem('aeropulse_oauth_just_connected') === '1';
        if (justConnectedViaOAuth) {
          localStorage.removeItem('aeropulse_oauth_just_connected');
          localStorage.removeItem('aeropulse_logged_out');
          if (mounted) setIsSessionLoggedOut(false);
          const savedName = localStorage.getItem('aeropulse_strava_athlete_name')?.trim();
          const savedWeight = Number(localStorage.getItem('aeropulse_strava_athlete_weight_kg') || 0);
          const savedFtp = Number(localStorage.getItem('aeropulse_strava_athlete_ftp') || 0);
          if (savedName && !isGenericAthleteName(savedName)) {
            const nextProf = buildCompleteAthleteProfile(
              {
                ...athleteProfileRef.current,
                name: savedName,
                ...(savedWeight > 30 ? { weightKg: savedWeight } : {}),
                ...(savedFtp > 80 ? { ftp: savedFtp } : {}),
              },
              wellnessDaysRef.current[wellnessDaysRef.current.length - 1],
              activitiesRef.current
            );
            setAthleteProfile(nextProf);
            athleteProfileRef.current = nextProf;
          }
        }
      } catch {
        // ignore storage errors
      }

      const statusData = await fetchServerConfigStatus();
      let isGatePassed = false;
      let notLoggedOut = true;
      try {
        notLoggedOut = !isBrowserSessionLoggedOut();
        const storedGatePassed = localStorage.getItem('aeropulse_auth_gate_passed') === '1' && notLoggedOut;
        const localSavedPolicy = notLoggedOut ? loadStravaSyncPolicyFromStorage() : null;
        const pendingTeamJoin = hasPendingTeamJoinInBrowser();
        const hasPersistedStravaSession = Boolean(
          notLoggedOut && statusData?.stravaConnected && !pendingTeamJoin
        );
        isGatePassed = storedGatePassed || hasPersistedStravaSession;
        if (hasPersistedStravaSession && !isBrowserSessionLoggedOut()) {
          if (!statusData?.stravaSyncPolicy?.window && !localSavedPolicy?.window) {
            const grantedScope = String(statusData?.stravaGrantedScope || '');
            const lacksScope = Boolean(grantedScope) && !grantedScope.includes('activity:read');
            saveStravaSyncPolicyToStorage({
              window: lacksScope ? 'none' : '90d',
              importProfileAndGear: true,
              confirmedAt: new Date().toISOString(),
              grantedScope: grantedScope || undefined,
            });
          }
          if (!isBrowserSessionLoggedOut()) {
            localStorage.setItem('aeropulse_auth_gate_passed', '1');
            if (mounted) {
              setIsSessionLoggedOut(false);
              hasEnteredWorkspaceRef.current = true;
              setHasEnteredWorkspace(true);
            }
          }
        }
      } catch {
        isGatePassed = false;
      }

      if (
        mounted &&
        !isBrowserSessionLoggedOut() &&
        isGatePassed &&
        (hasStravaClientCredentials() || statusData?.stravaConnected) &&
        (justConnectedViaOAuth ||
          exchangedUrlCode ||
          statusData?.stravaConnected ||
          statusData?.garminConnected ||
          statusData?.intervalsConnected ||
          statusData?.wahooConnected ||
          statusData?.polarConnected ||
          statusData?.corosConnected)
      ) {
        void syncLiveTelemetry(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [fetchServerConfigStatus, isSampleDemoMode, syncLiveTelemetry]);

  // Automatic Stale-While-Revalidate sync on Tab Focus / Visibility Change + 15-min timer
  useEffect(() => {
    if (isSampleDemoMode || !hasEnteredWorkspace || isSessionLoggedOut) return;

    let lastAutoSyncMs = Date.now();
    const MIN_REFOCUS_INTERVAL_MS = 3 * 60 * 1000;

    const triggerIfStale = () => {
      if (!hasStravaClientCredentials()) return;
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        if (now - lastAutoSyncMs >= MIN_REFOCUS_INTERVAL_MS) {
          lastAutoSyncMs = now;
          void syncLiveTelemetry(false);
        }
      }
    };

    const intervalId = window.setInterval(() => {
      if (!hasStravaClientCredentials()) return;
      lastAutoSyncMs = Date.now();
      void syncLiveTelemetry(false);
    }, 15 * 60 * 1000);

    document.addEventListener('visibilitychange', triggerIfStale);
    window.addEventListener('focus', triggerIfStale);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', triggerIfStale);
      window.removeEventListener('focus', triggerIfStale);
    };
  }, [hasEnteredWorkspace, isSampleDemoMode, isSessionLoggedOut, syncLiveTelemetry]);

  return {
    reconcileStoreOwnerAthleteId,
    fetchServerConfigStatus,
    syncLiveTelemetry,
  };
}
