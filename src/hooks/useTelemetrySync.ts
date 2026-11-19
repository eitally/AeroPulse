import React, { useCallback, useEffect, useRef } from 'react';
import type {
  AthleteGearItem,
  AthleteProfile,
  ConnectionStatus,
  DistanceUnit,
  PlannedWorkoutEvent,
  StravaSyncWindow,
  TeamSummaryWithRole,
  ThreshUser,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import { getStoreMetadata, saveStoreMetadata } from '../db/workoutStore';
import {
  areActivityTimestampsClose,
  resolveActivityStartEpochMs,
} from '../utils/activityTimestamp';
import {
  CURRENT_PMC_MODEL_VERSION,
  buildCompleteAthleteProfile,
  clearPersistedTelemetrySnapshot,
  computeWellnessDaysFromActivities,
  decodeGooglePolylineClient,
  deduplicateActivitiesArchive,
  getSavedIntervalsHeaders,
  hasPendingTeamJoinInBrowser,
  isBrowserSessionLoggedOut,
  isGenericAthleteName,
  isUncalibratedDefaultProfile,
  loadPersistedTelemetrySnapshot,
  loadStravaSyncPolicyFromStorage,
  mergeActivitiesNonDestructive,
  mergeWellnessDaysNonDestructive,
  overlayBiometricsOntoActivityWellness,
  recalibrateStravaActivityLoadClient,
  reclassifyActivityEnvironment,
  repairAndRecomputeWellnessDays,
  safeParseResponseJson,
  savePersistedTelemetrySnapshot,
  saveRotatedStravaTokensToStorage,
  saveStravaSyncPolicyToStorage,
} from '../utils/telemetryStorage';

export function hasStravaClientCredentials(): boolean {
  try {
    const notLoggedOut = localStorage.getItem('aeropulse_logged_out') !== '1';
    return Boolean(
      notLoggedOut &&
        (localStorage.getItem('aeropulse_session_token') ||
          localStorage.getItem('aeropulse_strava_access_token') ||
          localStorage.getItem('aeropulse_strava_refresh_token'))
    );
  } catch {
    return false;
  }
}

export type CompleteStravaAuthFn = (opts: {
  tokens?: any;
  sessionToken?: string;
  hasExistingSyncPolicy?: boolean;
}) => Promise<void>;

interface UseTelemetrySyncParams {
  activitiesRef: React.MutableRefObject<UnifiedActivity[]>;
  setActivities: React.Dispatch<React.SetStateAction<UnifiedActivity[]>>;
  wellnessDaysRef: React.MutableRefObject<UnifiedWellnessDay[]>;
  setWellnessDays: React.Dispatch<React.SetStateAction<UnifiedWellnessDay[]>>;
  plannedEventsRef: React.MutableRefObject<PlannedWorkoutEvent[]>;
  setPlannedEvents: React.Dispatch<React.SetStateAction<PlannedWorkoutEvent[]>>;
  gearItemsRef: React.MutableRefObject<AthleteGearItem[]>;
  setGearItems: React.Dispatch<React.SetStateAction<AthleteGearItem[]>>;
  redactedStravaCountRef: React.MutableRefObject<number>;
  setRedactedStravaCount: React.Dispatch<React.SetStateAction<number>>;
  athleteProfileRef: React.MutableRefObject<AthleteProfile>;
  setAthleteProfile: React.Dispatch<React.SetStateAction<AthleteProfile>>;
  setConnectionStatus: React.Dispatch<React.SetStateAction<ConnectionStatus>>;
  setCurrentUser: React.Dispatch<React.SetStateAction<ThreshUser | null>>;
  setDistanceUnit: (unit: DistanceUnit) => void;
  setIdbSavedAt: (val: string | null) => void;
  setIsSyncing: React.Dispatch<React.SetStateAction<boolean>>;
  setSyncError: React.Dispatch<React.SetStateAction<string | null>>;
  setMyTeams: React.Dispatch<React.SetStateAction<TeamSummaryWithRole[]>>;
  setActiveTeamId: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveViewedAthleteId: React.Dispatch<React.SetStateAction<string>>;
  idbHydratedRef: React.MutableRefObject<boolean>;
  hasEnteredWorkspace: boolean;
  hasEnteredWorkspaceRef: React.MutableRefObject<boolean>;
  setHasEnteredWorkspace: (val: boolean) => void;
  isSessionLoggedOut: boolean;
  setIsSessionLoggedOut: (val: boolean) => void;
  isSampleDemoMode: boolean;
  completeStravaAuthHandshakeRef: React.MutableRefObject<CompleteStravaAuthFn | null>;
}

const AUTH_ERROR_LABELS: Record<string, string> = {
  invalid_state_csrf: 'Security verification timed out. Please try signing in again.',
  google_not_configured: 'Google Sign-In is not configured on this server yet.',
  google_token_exchange_failed: 'Google sign-in could not complete token exchange. Check redirect URI configuration.',
  google_userinfo_failed: 'Google sign-in succeeded, but reading your Google profile failed.',
  expired_or_invalid_magic_token: 'That sign-in link has expired or was already used. Request a fresh link.',
  missing_magic_token: 'Missing magic sign-in token.',
  missing_code: 'Authorization code was missing from the provider redirect.',
  internal_error: 'Sign-in hit a temporary server error. Please try again.',
};

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
    try {
      const isNotLoggedOut = () => !isBrowserSessionLoggedOut();
      const origin = encodeURIComponent(window.location.origin);
      const resp = await fetch(`/api/config/status?origin=${origin}`, {
        credentials: 'include',
        headers: getSavedIntervalsHeaders(),
      });
      if (!resp.ok) return null;
      const data = await safeParseResponseJson(resp);
      if (data?.error && !data?.callbackUrl) return null;

      let notLoggedOut = isNotLoggedOut();
      let savedStravaName: string | undefined;
      if (notLoggedOut) {
        try {
          savedStravaName = localStorage.getItem('aeropulse_strava_athlete_name') || undefined;
        } catch {
          // ignore
        }
      }
      let isActiveStravaSession = Boolean(
        notLoggedOut && (data.stravaConnected || hasStravaClientCredentials())
      );

      if (isActiveStravaSession && data.stravaAthleteId) {
        await reconcileStoreOwnerAthleteId(data.stravaAthleteId);
      }

      notLoggedOut = isNotLoggedOut();
      isActiveStravaSession = Boolean(
        notLoggedOut && (data.stravaConnected || hasStravaClientCredentials())
      );

      if (isActiveStravaSession && data.sessionToken) {
        try {
          localStorage.setItem('aeropulse_session_token', String(data.sessionToken));
        } catch {
          // ignore
        }
      }
      if (isActiveStravaSession && data.stravaTokens) {
        saveRotatedStravaTokensToStorage(data.stravaTokens);
      }
      if (isActiveStravaSession && data.stravaSyncPolicy?.confirmedAt) {
        saveStravaSyncPolicyToStorage(data.stravaSyncPolicy);
      }
      if (data.mapTileApiKey) {
        try {
          if (!localStorage.getItem('aeropulse_map_tile_api_key')) {
            localStorage.setItem('aeropulse_map_tile_api_key', data.mapTileApiKey);
          }
          if (data.mapTileProvider && !localStorage.getItem('aeropulse_map_tile_provider')) {
            localStorage.setItem('aeropulse_map_tile_provider', data.mapTileProvider);
          }
        } catch {
          // ignore
        }
      }

      if (isNotLoggedOut()) {
        try {
          const authMeResp = await fetch('/api/auth/me', { credentials: 'include' });
          if (authMeResp.ok) {
            const authMeData = await authMeResp.json();
            if (isNotLoggedOut() && authMeData?.authenticated && authMeData?.user) {
              setCurrentUser(authMeData.user);
              const linkedIds: string[] = [
                ...(data.stravaAthleteId ? [String(data.stravaAthleteId)] : []),
                ...((authMeData.user.authProviders || [])
                  .filter((p: any) => p.provider === 'strava' && p.providerId)
                  .map((p: any) => String(p.providerId))),
              ];
              await reconcileStoreOwnerAthleteId(authMeData.user.id, linkedIds);
              if (isNotLoggedOut()) {
                if (authMeData.sessionToken) {
                  try {
                    localStorage.setItem('aeropulse_session_token', String(authMeData.sessionToken));
                  } catch {
                    // ignore
                  }
                }
                try {
                  if (localStorage.getItem('aeropulse_auth_gate_passed') === '1') {
                    setIsSessionLoggedOut(false);
                    hasEnteredWorkspaceRef.current = true;
                    setHasEnteredWorkspace(true);
                  }
                } catch {
                  // ignore
                }
                if (authMeData.user.name && isGenericAthleteName(athleteProfileRef.current?.name)) {
                  setAthleteProfile((prev) => ({
                    ...prev,
                    name: authMeData.user.name,
                    ...(authMeData.user.birthMonthYear ? { birthMonthYear: authMeData.user.birthMonthYear } : {}),
                  }));
                } else if (authMeData.user.birthMonthYear && !athleteProfileRef.current?.birthMonthYear) {
                  setAthleteProfile((prev) => ({
                    ...prev,
                    birthMonthYear: authMeData.user.birthMonthYear,
                  }));
                }
              }
            }
          }
        } catch {
          // ignore
        }
      }
      notLoggedOut = isNotLoggedOut();
      isActiveStravaSession = Boolean(
        notLoggedOut && (data.stravaConnected || hasStravaClientCredentials())
      );
      if (!notLoggedOut) {
        savedStravaName = undefined;
      } else if (!savedStravaName) {
        try {
          savedStravaName = localStorage.getItem('aeropulse_strava_athlete_name') || undefined;
        } catch {
          // ignore
        }
      }
      if (isActiveStravaSession) {
        try {
          if (data.stravaAthleteName && !isGenericAthleteName(data.stravaAthleteName)) {
            localStorage.setItem(
              'aeropulse_strava_athlete_name',
              String(data.stravaAthleteName).trim()
            );
          }
          if (data.garminAthleteName && !isGenericAthleteName(data.garminAthleteName)) {
            localStorage.setItem(
              'aeropulse_garmin_athlete_name',
              String(data.garminAthleteName).trim()
            );
          }
          if (data.intervalsAthleteName && !isGenericAthleteName(data.intervalsAthleteName)) {
            localStorage.setItem(
              'aeropulse_intervals_athlete_name',
              String(data.intervalsAthleteName).trim()
            );
          }
          if (data.stravaAthleteWeightKg && Number(data.stravaAthleteWeightKg) > 30) {
            localStorage.setItem(
              'aeropulse_strava_athlete_weight_kg',
              String(data.stravaAthleteWeightKg)
            );
          }
          if (data.stravaAthleteFtp && Number(data.stravaAthleteFtp) > 80) {
            localStorage.setItem('aeropulse_strava_athlete_ftp', String(data.stravaAthleteFtp));
          }
          if (
            (data.stravaMeasurementPreference === 'mi' ||
              data.stravaMeasurementPreference === 'km') &&
            !localStorage.getItem('thresh_distance_unit_user_set')
          ) {
            setDistanceUnit(data.stravaMeasurementPreference);
          }
        } catch {
          // ignore
        }
      }
      const isClientStravaConnected = Boolean(notLoggedOut && data.stravaConnected);
      const isClientIntervalsConnected = Boolean(notLoggedOut && data.intervalsConnected);
      const isClientGarminConnected = Boolean(
        notLoggedOut &&
          (data.garminConnected ||
            localStorage.getItem('aeropulse_garmin_personal_api_key') ||
            localStorage.getItem('aeropulse_garmin_bearer_token'))
      );
      const isClientWahooConnected = Boolean(notLoggedOut && data.wahooConnected);
      const isClientPolarConnected = Boolean(notLoggedOut && data.polarConnected);
      const resolvedStravaName =
        data.stravaAthleteName && !isGenericAthleteName(data.stravaAthleteName)
          ? String(data.stravaAthleteName).trim()
          : savedStravaName && !isGenericAthleteName(savedStravaName)
            ? savedStravaName
            : undefined;
      const resolvedGarminName =
        data.garminAthleteName && !isGenericAthleteName(data.garminAthleteName)
          ? String(data.garminAthleteName).trim()
          : undefined;
      const resolvedIntervalsName =
        data.intervalsAthleteName && !isGenericAthleteName(data.intervalsAthleteName)
          ? String(data.intervalsAthleteName).trim()
          : undefined;
      const bestRealName = resolvedStravaName || resolvedGarminName || resolvedIntervalsName;

      if (isClientStravaConnected) {
        const currentProf = athleteProfileRef.current;
        const needsNameUpdate = bestRealName && isGenericAthleteName(currentProf?.name);
        const needsCalibration = isUncalibratedDefaultProfile(currentProf);
        if (needsNameUpdate || needsCalibration || data.athleteProfile) {
          const baseProf = data.athleteProfile || currentProf;
          const mergedProf = buildCompleteAthleteProfile(
            {
              ...baseProf,
              ...(currentProf?.source === 'CUSTOM_OVERRIDE'
                ? {
                    source: 'CUSTOM_OVERRIDE' as const,
                    thresholdPaceSecsPerKm: currentProf.thresholdPaceSecsPerKm,
                    ftp: currentProf.ftp,
                    indoorFtp: currentProf.indoorFtp,
                  }
                : {}),
              name: bestRealName || data.athleteProfile?.name || currentProf?.name,
              weightKg:
                data.athleteProfile?.weightKg && data.athleteProfile.weightKg !== 70
                  ? data.athleteProfile.weightKg
                  : !needsCalibration && currentProf?.weightKg && currentProf.weightKg !== 70
                    ? currentProf.weightKg
                    : data.stravaAthleteWeightKg || baseProf?.weightKg,
              ftp:
                currentProf?.source === 'CUSTOM_OVERRIDE' && currentProf.ftp
                  ? currentProf.ftp
                  : data.athleteProfile?.ftp &&
                      data.athleteProfile.ftp !== 250 &&
                      data.athleteProfile.ftp !== 280 &&
                      data.athleteProfile.ftp !== 300
                    ? data.athleteProfile.ftp
                    : !needsCalibration &&
                        currentProf?.ftp &&
                        currentProf.ftp !== 250 &&
                        currentProf.ftp !== 280 &&
                        currentProf.ftp !== 300
                      ? currentProf.ftp
                      : data.stravaAthleteFtp || baseProf?.ftp,
            },
            wellnessDaysRef.current[wellnessDaysRef.current.length - 1],
            activitiesRef.current
          );
          setAthleteProfile(mergedProf);
          athleteProfileRef.current = mergedProf;
        }
      }
      setConnectionStatus((prev) => ({
        ...prev,
        mode:
          isClientIntervalsConnected ||
          isClientStravaConnected ||
          isClientGarminConnected ||
          isClientWahooConnected ||
          isClientPolarConnected
            ? 'LIVE'
            : 'SANDBOX_CALIBRATION',
        garminConnected: isClientGarminConnected,
        garminAthleteName: isClientGarminConnected
          ? resolvedGarminName ||
            localStorage.getItem('aeropulse_garmin_athlete_name') ||
            prev.garminAthleteName
          : undefined,
        intervalsConnected: isClientIntervalsConnected,
        intervalsAuthMethod: isClientIntervalsConnected
          ? data.intervalsAuthMethod || 'USER_INPUT'
          : 'NONE',
        intervalsAthleteId: isClientIntervalsConnected ? data.intervalsAthleteId || '0' : '0',
        intervalsAthleteName: isClientIntervalsConnected
          ? resolvedIntervalsName || prev.intervalsAthleteName
          : undefined,
        intervalsSource: isClientIntervalsConnected ? data.intervalsSource || 'USER_INPUT' : 'NONE',
        wahooConfigured:
          typeof data.wahooConfigured === 'boolean' ? data.wahooConfigured : prev.wahooConfigured,
        wahooConnected: isClientWahooConnected,
        wahooAthleteId: isClientWahooConnected ? data.wahooAthleteId || prev.wahooAthleteId : undefined,
        wahooAthleteName: isClientWahooConnected
          ? data.wahooAthleteName || prev.wahooAthleteName
          : undefined,
        polarConfigured:
          typeof data.polarConfigured === 'boolean' ? data.polarConfigured : prev.polarConfigured,
        polarConnected: isClientPolarConnected,
        polarAthleteId: isClientPolarConnected ? data.polarAthleteId || prev.polarAthleteId : undefined,
        polarAthleteName: isClientPolarConnected
          ? data.polarAthleteName || prev.polarAthleteName
          : undefined,
        stravaConfigured:
          typeof data.stravaConfigured === 'boolean'
            ? data.stravaConfigured
            : prev.stravaConfigured,
        stravaConnected: isClientStravaConnected,
        stravaClientId: data.stravaClientId || prev.stravaClientId,
        stravaAthleteId: isClientStravaConnected
          ? data.stravaAthleteId || prev.stravaAthleteId
          : undefined,
        stravaAthleteName: isClientStravaConnected
          ? bestRealName || prev.stravaAthleteName
          : undefined,
        stravaMeasurementPreference:
          data.stravaMeasurementPreference || prev.stravaMeasurementPreference,
        stravaGrantedScope: isClientStravaConnected
          ? data.stravaGrantedScope ?? prev.stravaGrantedScope
          : undefined,
        stravaSyncPolicy: isClientStravaConnected
          ? data.stravaSyncPolicy || prev.stravaSyncPolicy
          : undefined,
        stravaSource: isClientStravaConnected ? data.stravaSource || 'OAUTH' : 'NONE',
        hasGeminiServerKey: Boolean(data.hasGeminiServerKey),
        currentOriginCallbackUrl:
          data.callbackUrl || `${window.location.origin}/api/strava/callback`,
        lastSyncedAt: isClientStravaConnected
          ? data.lastSyncedAt || prev.lastSyncedAt
          : prev.lastSyncedAt,
        nextHourlySyncAt: isClientStravaConnected
          ? data.nextHourlySyncAt || prev.nextHourlySyncAt
          : prev.nextHourlySyncAt,
        autoSyncCronActive: true,
        athleteFtp: athleteProfileRef.current.ftp || prev.athleteFtp,
        athleteIndoorFtp: athleteProfileRef.current.indoorFtp || prev.athleteIndoorFtp,
        athleteRunFtp: athleteProfileRef.current.runFtp || prev.athleteRunFtp,
        athleteLthr: athleteProfileRef.current.lthr || prev.athleteLthr,
        athleteMaxHr: athleteProfileRef.current.maxHr || prev.athleteMaxHr,
        athleteProfile: athleteProfileRef.current || prev.athleteProfile,
        stravaActivitiesCount:
          isClientStravaConnected && data.stravaActivitiesCount && data.stravaActivitiesCount > 0
            ? data.stravaActivitiesCount
            : prev.stravaActivitiesCount,
        mapTileProvider: data.mapTileProvider || prev.mapTileProvider || 'OSM_KEYLESS',
        mapTileApiKeyConfigured: Boolean(data.mapTileApiKeyConfigured || data.mapTileApiKey),
        mapTileApiKey: data.mapTileApiKey || prev.mapTileApiKey,
      }));
      return data;
    } catch {
      return null;
    }
  }, [reconcileStoreOwnerAthleteId]);


  const syncLiveTelemetry = useCallback(
    async (fullHistory = false, explicitStravaWindow?: StravaSyncWindow) => {
      if (isBrowserSessionLoggedOut()) return;
      setIsSyncing(true);
      setSyncError(null);
      try {
        const headers = getSavedIntervalsHeaders();
        const statusResp = await fetch(
          `/api/config/status?origin=${encodeURIComponent(window.location.origin)}`,
          { credentials: 'include', headers }
        );
        const statusData = statusResp.ok ? await statusResp.json() : {};
        if (isBrowserSessionLoggedOut()) return;
        if (statusData.stravaTokens) {
          saveRotatedStravaTokensToStorage(statusData.stravaTokens);
        }

        // Refresh headers in case status check rotated the Strava token
        const activeHeaders = getSavedIntervalsHeaders();
        const hasPersistedArchive =
          !fullHistory && !needsPmcModelV2SyncRef.current && activitiesRef.current.length >= 10;
        const deltaOldestDate = new Date(Date.now() - 60 * 86400 * 1000)
          .toISOString()
          .slice(0, 10);

        let mergedActivities: UnifiedActivity[] | null = null;
        let nextWellnessDays = wellnessDaysRef.current;
        let garminWellnessBiometrics: UnifiedWellnessDay[] = [];
        let nextPlannedEvents = plannedEventsRef.current;
        let nextGearItems = gearItemsRef.current;
        let nextRedactedCount = redactedStravaCountRef.current;
        let earliestDate: string | undefined;

        if (statusData.intervalsConnected) {
          const oldestParam = hasPersistedArchive ? deltaOldestDate : '2010-01-01';
          const intResp = await fetch(`/api/intervals/sync?oldest=${oldestParam}`, {
            credentials: 'include',
            headers: activeHeaders,
          });
          if (isBrowserSessionLoggedOut()) return;
          if (intResp.ok) {
            const intData = await intResp.json();
            if (isBrowserSessionLoggedOut()) return;
            if (Array.isArray(intData.wellnessDays) && intData.wellnessDays.length > 0) {
              nextWellnessDays = mergeWellnessDaysNonDestructive(
                wellnessDaysRef.current,
                intData.wellnessDays
              );
              setWellnessDays(nextWellnessDays);
            }
            if (typeof intData.redactedStravaCount === 'number') {
              nextRedactedCount = Math.max(nextRedactedCount, intData.redactedStravaCount);
              setRedactedStravaCount(nextRedactedCount);
            }
            if (Array.isArray(intData.plannedEvents) && intData.plannedEvents.length > 0) {
              nextPlannedEvents = intData.plannedEvents;
              setPlannedEvents(nextPlannedEvents);
            }
            if (Array.isArray(intData.activities)) {
              mergedActivities = intData.activities;
              earliestDate = intData.earliestActivityDate || undefined;
            }
            if (intData.athleteProfile) {
              if (
                intData.athleteProfile.name &&
                !isGenericAthleteName(intData.athleteProfile.name)
              ) {
                try {
                  localStorage.setItem(
                    'aeropulse_intervals_athlete_name',
                    String(intData.athleteProfile.name).trim()
                  );
                } catch {
                  // ignore
                }
              }
              const latestW =
                nextWellnessDays.length > 0
                  ? nextWellnessDays[nextWellnessDays.length - 1]
                  : undefined;
              const completeProf = buildCompleteAthleteProfile(
                intData.athleteProfile,
                latestW,
                mergedActivities || activitiesRef.current
              );
              setAthleteProfile(completeProf);
              athleteProfileRef.current = completeProf;
              if (
                Array.isArray(intData.athleteProfile.gearItems) &&
                intData.athleteProfile.gearItems.length > 0
              ) {
                nextGearItems = intData.athleteProfile.gearItems;
                setGearItems(nextGearItems);
              }
            }
          }
        }

        if (statusData.garminConnected) {
          const garminResp = await fetch('/api/garmin/sync', {
            credentials: 'include',
            headers: activeHeaders,
          });
          if (isBrowserSessionLoggedOut()) return;
          if (garminResp.ok) {
            const garminData = await garminResp.json();
            if (isBrowserSessionLoggedOut()) return;
            if (Array.isArray(garminData.wellnessDays) && garminData.wellnessDays.length > 0) {
              garminWellnessBiometrics = garminData.wellnessDays;
              if (nextWellnessDays.length > 0) {
                nextWellnessDays = overlayBiometricsOntoActivityWellness(
                  nextWellnessDays,
                  garminWellnessBiometrics
                );
                setWellnessDays(nextWellnessDays);
                wellnessDaysRef.current = nextWellnessDays;
              }
            }
            if (Array.isArray(garminData.activities) && garminData.activities.length > 0) {
              const garminActs = garminData.activities.map((a: UnifiedActivity) =>
                reclassifyActivityEnvironment(a)
              );
              mergedActivities = mergedActivities
                ? mergeActivitiesNonDestructive(mergedActivities, garminActs)
                : garminActs;
            }
            if (garminData.athleteProfile) {
              if (
                garminData.athleteProfile.name &&
                !isGenericAthleteName(garminData.athleteProfile.name)
              ) {
                try {
                  localStorage.setItem(
                    'aeropulse_garmin_athlete_name',
                    String(garminData.athleteProfile.name).trim()
                  );
                } catch {
                  // ignore
                }
              }
              const latestW =
                nextWellnessDays.length > 0
                  ? nextWellnessDays[nextWellnessDays.length - 1]
                  : undefined;
              const completeProf = buildCompleteAthleteProfile(
                garminData.athleteProfile,
                latestW,
                mergedActivities || activitiesRef.current
              );
              setAthleteProfile(completeProf);
              athleteProfileRef.current = completeProf;
            }
          }
        }

        let clientTzName = '';
        let clientTzOffsetMins = '';
        try {
          clientTzName = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
          clientTzOffsetMins = String(-new Date().getTimezoneOffset());
        } catch {
          // ignore Intl errors
        }
        const tzSyncHeaders: Record<string, string> = {
          ...activeHeaders,
          ...(clientTzName ? { 'x-client-tz': clientTzName } : {}),
          ...(clientTzOffsetMins ? { 'x-client-tz-offset-mins': clientTzOffsetMins } : {}),
        };

        if (statusData.wahooConnected) {
          const wahooResp = await fetch('/api/wahoo/sync', {
            credentials: 'include',
            headers: tzSyncHeaders,
          });
          if (isBrowserSessionLoggedOut()) return;
          if (wahooResp.ok) {
            const wahooData = await wahooResp.json();
            if (isBrowserSessionLoggedOut()) return;
            if (Array.isArray(wahooData.activities) && wahooData.activities.length > 0) {
              const wahooActs = wahooData.activities.map((a: UnifiedActivity) =>
                reclassifyActivityEnvironment(a)
              );
              mergedActivities = mergedActivities
                ? mergeActivitiesNonDestructive(mergedActivities, wahooActs)
                : wahooActs;
            }
          }
        }

        if (statusData.polarConnected) {
          const polarResp = await fetch('/api/polar/sync', {
            credentials: 'include',
            headers: tzSyncHeaders,
          });
          if (isBrowserSessionLoggedOut()) return;
          if (polarResp.ok) {
            const polarData = await polarResp.json();
            if (isBrowserSessionLoggedOut()) return;
            if (Array.isArray(polarData.activities) && polarData.activities.length > 0) {
              const polarActs = polarData.activities.map((a: UnifiedActivity) =>
                reclassifyActivityEnvironment(a)
              );
              mergedActivities = mergedActivities
                ? mergeActivitiesNonDestructive(mergedActivities, polarActs)
                : polarActs;
            }
          }
        }

        const savedWindow =
          (statusData.stravaSyncPolicy?.window as StravaSyncWindow | undefined) ||
          (loadStravaSyncPolicyFromStorage()?.window as StravaSyncWindow | undefined);
        const targetStravaWindow: StravaSyncWindow =
          explicitStravaWindow || (fullHistory ? 'all' : savedWindow || '90d');
        const grantedScopeStr = String(statusData.stravaGrantedScope || '');
        const stravaMissingActivityScope =
          Boolean(grantedScopeStr) && !grantedScopeStr.includes('activity:read');

        if (
          statusData.stravaConnected &&
          targetStravaWindow !== 'none' &&
          !stravaMissingActivityScope
        ) {
          const stravaActs = activitiesRef.current.filter(
            (a) => Boolean(a.stravaId) || a.sourceBadges?.includes('Strava')
          );
          const latestStravaMs = stravaActs.reduce((maxMs, a) => {
            const t = resolveActivityStartEpochMs(a);
            return Number.isFinite(t) && t > maxMs ? t : maxMs;
          }, 0);
          const useDelta =
            !fullHistory &&
            !explicitStravaWindow &&
            !needsPmcModelV2SyncRef.current &&
            stravaActs.length > 0 &&
            latestStravaMs > 0;
          const syncQs = new URLSearchParams({ window: targetStravaWindow });
          if (useDelta) {
            // 14-day overlap buffer catches any activity edits, late uploads, or kudos without re-pulling full history
            const deltaAfterEpoch = Math.max(
              0,
              Math.floor((latestStravaMs - 14 * 86400 * 1000) / 1000)
            );
            syncQs.set('deltaOnly', 'true');
            syncQs.set('afterEpoch', String(deltaAfterEpoch));
          } else if (fullHistory || targetStravaWindow === 'all') {
            syncQs.set('full', 'true');
          }
          const stravaResp = await fetch(`/api/strava/sync?${syncQs.toString()}`, {
            credentials: 'include',
            headers: activeHeaders,
          });
          if (isBrowserSessionLoggedOut()) return;
          if (stravaResp.ok) {
            const stravaData = await stravaResp.json();
            if (isBrowserSessionLoggedOut()) return;
            const stravaBackfillKey = `aeropulse_strava_backfill_v4_${stravaData.athleteId || 'self'}`;
            const oldestStravaMs = stravaActs.reduce((minMs, a) => {
              const t = resolveActivityStartEpochMs(a);
              return Number.isFinite(t) && t > 0 && t < minMs ? t : minMs;
            }, Number.POSITIVE_INFINITY);
            let cursorBeforeEpoch =
              stravaData.hasMoreHistory && stravaData.nextBeforeEpoch
                ? Number(stravaData.nextBeforeEpoch)
                : useDelta &&
                    stravaActs.length >= 1950 &&
                    Number.isFinite(oldestStravaMs) &&
                    typeof localStorage !== 'undefined' &&
                    localStorage.getItem(stravaBackfillKey) !== '1'
                  ? Math.floor(oldestStravaMs / 1000) + 60
                  : 0;
            if (cursorBeforeEpoch > 0 && !stravaData.rateLimitPaused) {
              const seenStravaIds = new Set<string>(
                Array.isArray(stravaData.activities)
                  ? stravaData.activities.map((a: any) => String(a.stravaId))
                  : []
              );
              const collectedActs: any[] = Array.isArray(stravaData.activities)
                ? [...stravaData.activities]
                : [];
              let lastHasMore = Boolean(stravaData.hasMoreHistory);
              let lastRatePaused = Boolean(stravaData.rateLimitPaused);
              for (let pass = 0; pass < 4 && cursorBeforeEpoch > 0; pass += 1) {
                const backfillQs = new URLSearchParams({
                  window: 'all',
                  full: 'true',
                  beforeEpoch: String(cursorBeforeEpoch),
                });
                const passResp = await fetch(`/api/strava/sync?${backfillQs.toString()}`, {
                  credentials: 'include',
                  headers: activeHeaders,
                });
                if (isBrowserSessionLoggedOut()) return;
                if (!passResp.ok) break;
                const passData = await passResp.json();
                if (isBrowserSessionLoggedOut()) return;
                const passActs = Array.isArray(passData.activities) ? passData.activities : [];
                let addedCount = 0;
                for (const pa of passActs) {
                  const sid = String(pa.stravaId);
                  if (!seenStravaIds.has(sid)) {
                    seenStravaIds.add(sid);
                    collectedActs.push(pa);
                    addedCount += 1;
                  }
                }
                lastHasMore = Boolean(passData.hasMoreHistory);
                lastRatePaused = Boolean(passData.rateLimitPaused);
                const nextCursor = Number(passData.nextBeforeEpoch || 0);
                if (
                  !lastHasMore ||
                  lastRatePaused ||
                  nextCursor <= 0 ||
                  nextCursor >= cursorBeforeEpoch ||
                  addedCount === 0
                ) {
                  cursorBeforeEpoch = 0;
                  break;
                }
                cursorBeforeEpoch = nextCursor;
              }
              stravaData.activities = collectedActs;
              stravaData.hasMoreHistory = lastHasMore;
              stravaData.rateLimitPaused = lastRatePaused;
              if (
                !isBrowserSessionLoggedOut() &&
                !lastHasMore &&
                !lastRatePaused &&
                typeof localStorage !== 'undefined'
              ) {
                try {
                  localStorage.setItem(stravaBackfillKey, '1');
                } catch {
                  // Ignore storage quota errors
                }
              }
            }
            if (isBrowserSessionLoggedOut()) return;
            if (stravaData.missingActivityScope) {
              setConnectionStatus((prev) => ({
                ...prev,
                stravaGrantedScope: 'read',
              }));
            }
            if (stravaData.stravaTokens) {
              saveRotatedStravaTokensToStorage({
                ...stravaData.stravaTokens,
                athleteId: stravaData.athleteId,
                athleteName: stravaData.athleteName,
              });
            } else if (stravaData.athleteName || stravaData.athleteId) {
              saveRotatedStravaTokensToStorage({
                athleteId: stravaData.athleteId,
                athleteName: stravaData.athleteName,
              });
            }
            if (stravaData.athleteProfile) {
              if (!statusData.intervalsConnected && !statusData.garminConnected) {
                const currentProf = athleteProfileRef.current;
                const latestW =
                  nextWellnessDays.length > 0
                    ? nextWellnessDays[nextWellnessDays.length - 1]
                    : undefined;
                const completeProf = buildCompleteAthleteProfile(
                  {
                    ...stravaData.athleteProfile,
                    ...(currentProf?.source === 'CUSTOM_OVERRIDE'
                      ? {
                          source: 'CUSTOM_OVERRIDE' as const,
                          thresholdPaceSecsPerKm: currentProf.thresholdPaceSecsPerKm,
                          ftp: currentProf.ftp,
                          indoorFtp: currentProf.indoorFtp,
                        }
                      : {}),
                  },
                  latestW,
                  stravaData.activities || activitiesRef.current
                );
                setAthleteProfile(completeProf);
                athleteProfileRef.current = completeProf;
                if (
                  Array.isArray(stravaData.gearItems) &&
                  stravaData.gearItems.length > 0 &&
                  statusData.stravaSyncPolicy?.importProfileAndGear !== false
                ) {
                  nextGearItems = stravaData.gearItems;
                  setGearItems(nextGearItems);
                }
              } else {
                // Preserve real Garmin / Intervals biometrics (weight, RHR, LTHR, Max HR, HR zones) while taking Strava gear & FTP fallback if needed
                const currentProf = athleteProfileRef.current;
                const currentUncalibrated = isUncalibratedDefaultProfile(currentProf);
                const mergedRawProfile = {
                  ...stravaData.athleteProfile,
                  ...(currentUncalibrated ? {} : currentProf),
                  name:
                    !isGenericAthleteName(currentProf.name)
                      ? currentProf.name
                      : !isGenericAthleteName(stravaData.athleteProfile.name)
                        ? stravaData.athleteProfile.name
                        : currentProf.name,
                  weightKg:
                    !currentUncalibrated &&
                    currentProf.weightKg &&
                    currentProf.weightKg !== 70 &&
                    currentProf.weightKg !== 71.5
                      ? currentProf.weightKg
                      : stravaData.athleteProfile.weightKg &&
                          stravaData.athleteProfile.weightKg !== 70
                        ? stravaData.athleteProfile.weightKg
                        : currentProf.weightKg,
                  ftp:
                    !currentUncalibrated &&
                    currentProf.ftp &&
                    currentProf.ftp !== 250 &&
                    currentProf.ftp !== 280 &&
                    currentProf.ftp !== 300
                      ? currentProf.ftp
                      : stravaData.athleteProfile.ftp &&
                          stravaData.athleteProfile.ftp !== 250 &&
                          stravaData.athleteProfile.ftp !== 280
                        ? stravaData.athleteProfile.ftp
                        : currentProf.ftp,
                  restingHr:
                    !currentUncalibrated &&
                    currentProf.restingHr &&
                    currentProf.restingHr !== 46 &&
                    currentProf.restingHr !== 50
                      ? currentProf.restingHr
                      : stravaData.athleteProfile.restingHr || currentProf.restingHr,
                  lthr:
                    !currentUncalibrated &&
                    currentProf.lthr &&
                    currentProf.lthr !== 163 &&
                    currentProf.lthr !== 174
                      ? currentProf.lthr
                      : stravaData.athleteProfile.lthr || currentProf.lthr,
                  maxHr:
                    !currentUncalibrated &&
                    currentProf.maxHr &&
                    currentProf.maxHr !== 182 &&
                    currentProf.maxHr !== 192
                      ? currentProf.maxHr
                      : stravaData.athleteProfile.maxHr || currentProf.maxHr,
                  hrZones:
                    !currentUncalibrated &&
                    Array.isArray(currentProf.hrZones) &&
                    currentProf.hrZones.length >= 5
                      ? currentProf.hrZones
                      : stravaData.athleteProfile.hrZones,
                  runHrZones:
                    !currentUncalibrated &&
                    Array.isArray(currentProf.runHrZones) &&
                    currentProf.runHrZones.length >= 5
                      ? currentProf.runHrZones
                      : stravaData.athleteProfile.runHrZones,
                };
                const latestW =
                  nextWellnessDays.length > 0
                    ? nextWellnessDays[nextWellnessDays.length - 1]
                    : undefined;
                const updatedProf = buildCompleteAthleteProfile(
                  mergedRawProfile,
                  latestW,
                  mergedActivities || activitiesRef.current
                );
                setAthleteProfile(updatedProf);
                athleteProfileRef.current = updatedProf;
                if (
                  Array.isArray(stravaData.gearItems) &&
                  stravaData.gearItems.length > 0 &&
                  nextGearItems.length === 0
                ) {
                  nextGearItems = stravaData.gearItems;
                  setGearItems(nextGearItems);
                }
              }
            }
            if (Array.isArray(stravaData.activities) && stravaData.activities.length > 0) {
              const toUnifiedFromStrava = (sa: any): UnifiedActivity => {
                const resolvedRoute =
                  Array.isArray(sa.routeLatLngs) && sa.routeLatLngs.length >= 2
                    ? sa.routeLatLngs
                    : decodeGooglePolylineClient(sa.summaryPolyline);
                return reclassifyActivityEnvironment({
                  id: `strava-${sa.stravaId}`,
                  stravaId: String(sa.stravaId),
                  startDateLocal: sa.startDateLocal,
                  ...(typeof sa.startDateUtcMs === 'number'
                    ? { startDateUtcMs: sa.startDateUtcMs }
                    : {}),
                  name: sa.name,
                  sportCategory: sa.sportCategory,
                  rawSportType: sa.rawSportType,
                  environment: sa.environment,
                  subType: sa.subType || (sa.environment === 'INDOOR' ? 'Smart Trainer' : 'Road'),
                  movingTimeSecs: sa.movingTimeSecs,
                  distanceMeters: sa.distanceMeters,
                  elevationGainMeters: sa.elevationGainMeters,
                  avgPower: sa.avgPower,
                  normalizedPower: sa.normalizedPower,
                  deviceWatts: sa.deviceWatts,
                  intensityFactor: sa.intensityFactor,
                  trainingLoad: sa.trainingLoad ?? 0,
                  loadModelVersion: sa.loadModelVersion,
                  avgHr: sa.avgHr || 0,
                  maxHr: sa.maxHr || 0,
                  avgCadence: sa.avgCadence,
                  avgPaceSecsPerKm: sa.avgPaceSecsPerKm,
                  gapPaceSecsPerKm: sa.avgPaceSecsPerKm,
                  aerobicDecouplingPct: 0,
                  efficiencyFactor: sa.efficiencyFactor || 0,
                  firstHalfEf: 0,
                  secondHalfEf: 0,
                  zoneSecs: { hr: [0, 0, 0, 0, 0, 0, 0] },
                  gearName: sa.gearName,
                  stravaPrCount: sa.stravaPrCount || 0,
                  kudosCount: sa.kudosCount || 0,
                  commentCount: sa.commentCount || 0,
                  achievementCount: sa.achievementCount || 0,
                  athleteCount: sa.athleteCount || 1,
                  hasKudoed: Boolean(sa.hasKudoed),
                  kudoers: Array.isArray(sa.kudoers) ? sa.kudoers : [],
                  comments: Array.isArray(sa.comments) ? sa.comments : [],
                  summaryPolyline: sa.summaryPolyline,
                  routeLatLngs: resolvedRoute,
                  startLatLng: sa.startLatLng,
                  endLatLng: sa.endLatLng,
                  segmentEfforts: sa.segmentEfforts || [],
                  sourceBadges: ['Strava'],
                });
              };

              if (!mergedActivities) {
                mergedActivities = stravaData.activities.map(toUnifiedFromStrava);
              } else {
                const byStravaId = new Map<string, any>();
                for (const sa of stravaData.activities) {
                  byStravaId.set(String(sa.stravaId), sa);
                }
                mergedActivities = mergedActivities.map((act) => {
                  let matched = act.stravaId ? byStravaId.get(String(act.stravaId)) : undefined;
                  if (!matched && !act.stravaId) {
                    const actDateStr = String(act.startDateLocal || '').slice(0, 10);
                    for (const [sid, sa] of byStravaId.entries()) {
                      const closeInTime = areActivityTimestampsClose(act, sa, 300);
                      const sameDate = actDateStr === String(sa.startDateLocal || '').slice(0, 10);
                      const distDiffRatio =
                        act.distanceMeters > 500 && sa.distanceMeters > 500
                          ? Math.abs(act.distanceMeters - sa.distanceMeters) /
                            Math.max(act.distanceMeters, sa.distanceMeters)
                          : 1;
                      if (
                        sa.sportCategory === act.sportCategory &&
                        (closeInTime || (sameDate && distDiffRatio <= 0.03))
                      ) {
                        matched = sa;
                        byStravaId.delete(sid);
                        break;
                      }
                    }
                  } else if (act.stravaId) {
                    byStravaId.delete(String(act.stravaId));
                  }

                  if (matched) {
                    const resolvedEnv =
                      matched.environment === 'INDOOR' || act.environment === 'INDOOR'
                        ? 'INDOOR'
                        : act.environment;
                    const resolvedSubType: UnifiedActivity['subType'] =
                      matched.subType === 'Virtual Cycling' || act.subType === 'Virtual Cycling'
                        ? 'Virtual Cycling'
                        : matched.subType === 'Smart Trainer' || act.subType === 'Smart Trainer'
                          ? 'Smart Trainer'
                          : matched.subType === 'Treadmill' || act.subType === 'Treadmill'
                            ? 'Treadmill'
                            : act.subType || matched.subType;

                    const isGenericStubName =
                      !act.name ||
                      act.id.startsWith('strava-') ||
                      /^Zwift\s+—\s+Virtual Cycling$/i.test(act.name.trim()) ||
                      /^Strava\s+Activity$/i.test(act.name.trim());

                    const hasAuthoritativeIntervals =
                      Boolean(act.intervalsId) || act.sourceBadges.includes('Intervals.icu');
                    const clearStalePower =
                      matched.deviceWatts === false &&
                      !hasAuthoritativeIntervals &&
                      !act.sourceBadges.includes('Garmin');

                    return reclassifyActivityEnvironment({
                      ...act,
                      ...(act.startDateUtcMs !== undefined || matched.startDateUtcMs !== undefined
                        ? { startDateUtcMs: act.startDateUtcMs ?? matched.startDateUtcMs }
                        : {}),
                      name: isGenericStubName && matched.name ? matched.name : act.name,
                      sportCategory:
                        !hasAuthoritativeIntervals &&
                        !act.sourceBadges.includes('Garmin') &&
                        matched.sportCategory
                          ? matched.sportCategory
                          : act.sportCategory,
                      rawSportType: matched.rawSportType || act.rawSportType,
                      environment: resolvedEnv,
                      subType: resolvedSubType,
                      stravaId: String(matched.stravaId || act.stravaId || ''),
                      deviceWatts: matched.deviceWatts ?? act.deviceWatts,
                      loadModelVersion: matched.loadModelVersion ?? act.loadModelVersion,
                      trainingLoad: hasAuthoritativeIntervals
                        ? act.trainingLoad && act.trainingLoad > 0
                          ? act.trainingLoad
                          : matched.trainingLoad ?? act.trainingLoad
                        : matched.trainingLoad ?? act.trainingLoad,
                      avgPower: clearStalePower ? undefined : act.avgPower ?? matched.avgPower,
                      normalizedPower: clearStalePower
                        ? undefined
                        : act.normalizedPower ?? matched.normalizedPower,
                      intensityFactor: hasAuthoritativeIntervals
                        ? act.intensityFactor ?? matched.intensityFactor
                        : matched.intensityFactor ?? act.intensityFactor,
                      variabilityIndex: act.variabilityIndex ?? matched.variabilityIndex,
                      avgHr: act.avgHr ?? matched.avgHr,
                      maxHr: act.maxHr ?? matched.maxHr,
                      gearName: matched.gearName || act.gearName,
                      stravaPrCount: matched.stravaPrCount ?? act.stravaPrCount,
                      kudosCount: matched.kudosCount ?? act.kudosCount,
                      commentCount: matched.commentCount ?? act.commentCount,
                      achievementCount: matched.achievementCount ?? act.achievementCount,
                      athleteCount: matched.athleteCount ?? act.athleteCount,
                      hasKudoed: matched.hasKudoed ?? act.hasKudoed,
                      kudoers:
                        Array.isArray(matched.kudoers) && matched.kudoers.length > 0
                          ? matched.kudoers
                          : act.kudoers,
                      comments:
                        Array.isArray(matched.comments) && matched.comments.length > 0
                          ? matched.comments
                          : act.comments,
                      summaryPolyline: matched.summaryPolyline || act.summaryPolyline,
                      routeLatLngs:
                        Array.isArray(act.routeLatLngs) && act.routeLatLngs.length > 2
                          ? act.routeLatLngs
                          : Array.isArray(matched.routeLatLngs) && matched.routeLatLngs.length >= 2
                            ? matched.routeLatLngs
                            : decodeGooglePolylineClient(matched.summaryPolyline) || act.routeLatLngs,
                      startLatLng: act.startLatLng || matched.startLatLng,
                      endLatLng: act.endLatLng || matched.endLatLng,
                      segmentEfforts:
                        Array.isArray(matched.segmentEfforts) && matched.segmentEfforts.length > 0
                          ? matched.segmentEfforts
                          : act.segmentEfforts,
                      sourceBadges: Array.from(new Set([...act.sourceBadges, 'Strava'])) as (
                        | 'Intervals.icu'
                        | 'Garmin'
                        | 'Strava'
                      )[],
                    });
                  }
                  return reclassifyActivityEnvironment(act);
                });

                const remainingStravaActivities = Array.from(byStravaId.values()).map(
                  toUnifiedFromStrava
                );
                mergedActivities = [...mergedActivities, ...remainingStravaActivities].sort(
                  (a, b) =>
                    new Date(b.startDateLocal).getTime() - new Date(a.startDateLocal).getTime()
                );
              }
            } else if (
              Array.isArray(stravaData.activities) &&
              !stravaData.missingActivityScope &&
              !stravaData.syncPaused &&
              mergedActivities === null
            ) {
              mergedActivities = [];
            }
          } else {
            const errJson = await stravaResp.json().catch(() => ({}));
            if (errJson?.error && !statusData.garminConnected && !statusData.intervalsConnected) {
              setSyncError(errJson.error);
            }
          }
        }

        if (
          mergedActivities === null &&
          (garminWellnessBiometrics.length > 0 || needsPmcModelV2SyncRef.current) &&
          activitiesRef.current.length > 0
        ) {
          mergedActivities = [];
        }

        if (isBrowserSessionLoggedOut()) return;

        if (mergedActivities !== null) {
          // Non-destructively merge, deduplicate & ensure legacy v1/v2 Garmin/Strava entries recalibrate to v3
          const mergedArchiveRaw = deduplicateActivitiesArchive(
            mergeActivitiesNonDestructive(activitiesRef.current, mergedActivities)
          );
          const combinedArchive = mergedArchiveRaw.map((a) =>
            (a.loadModelVersion || 0) < CURRENT_PMC_MODEL_VERSION
              ? recalibrateStravaActivityLoadClient(a, athleteProfileRef.current)
              : a
          );
          setActivities(combinedArchive);
          activitiesRef.current = combinedArchive;

          const combinedBiometrics =
            garminWellnessBiometrics.length > 0
              ? mergeWellnessDaysNonDestructive(nextWellnessDays, garminWellnessBiometrics)
              : nextWellnessDays;

          if (!statusData.intervalsConnected && combinedArchive.length > 0) {
            const activityDerivedWellness = computeWellnessDaysFromActivities(combinedArchive);
            nextWellnessDays = overlayBiometricsOntoActivityWellness(
              activityDerivedWellness,
              combinedBiometrics
            );
            setWellnessDays(nextWellnessDays);
            wellnessDaysRef.current = nextWellnessDays;
          } else if (statusData.intervalsConnected && combinedArchive.length > 0) {
            const repairedWellness = repairAndRecomputeWellnessDays(
              nextWellnessDays,
              combinedArchive,
              undefined,
              { profile: athleteProfileRef.current }
            );
            nextWellnessDays =
              garminWellnessBiometrics.length > 0
                ? overlayBiometricsOntoActivityWellness(
                    repairedWellness,
                    garminWellnessBiometrics
                  )
                : repairedWellness;
            setWellnessDays(nextWellnessDays);
            wellnessDaysRef.current = nextWellnessDays;
          } else if (nextWellnessDays.length === 0 && garminWellnessBiometrics.length > 0) {
            nextWellnessDays = garminWellnessBiometrics;
            setWellnessDays(nextWellnessDays);
            wellnessDaysRef.current = nextWellnessDays;
          }

          // Re-run profile calibration with the full merged activity archive
          const calibratedProf = buildCompleteAthleteProfile(
            athleteProfileRef.current,
            nextWellnessDays[nextWellnessDays.length - 1],
            combinedArchive
          );
          setAthleteProfile(calibratedProf);
          athleteProfileRef.current = calibratedProf;

          const oldestLoaded =
            combinedArchive.length > 0
              ? combinedArchive[combinedArchive.length - 1].startDateLocal.slice(0, 10)
              : earliestDate;
          const totalGarmin = combinedArchive.filter(
            (a) => a.sourceBadges.includes('Garmin') || a.sourceBadges.includes('Intervals.icu')
          ).length;
          const totalStrava = combinedArchive.filter(
            (a) => a.sourceBadges.includes('Strava') || Boolean(a.stravaId)
          ).length;

          setConnectionStatus((prev) => ({
            ...prev,
            totalActivitiesCount: combinedArchive.length,
            garminActivitiesCount: totalGarmin,
            stravaActivitiesCount: totalStrava,
            earliestActivityDate: oldestLoaded || prev.earliestActivityDate,
            lastSyncedAt: new Date().toISOString(),
          }));

          if (isBrowserSessionLoggedOut()) return;
          const savedTimestamp = await savePersistedTelemetrySnapshot({
            activities: combinedArchive,
            wellnessDays: nextWellnessDays,
            plannedEvents: nextPlannedEvents,
            gearItems: nextGearItems,
            athleteProfile: athleteProfileRef.current,
            redactedStravaCount: nextRedactedCount,
            earliestActivityDate: oldestLoaded,
          });
          if (savedTimestamp && !isBrowserSessionLoggedOut()) setIdbSavedAt(savedTimestamp);
          needsPmcModelV2SyncRef.current = false;
        } else if (garminWellnessBiometrics.length > 0 && nextWellnessDays.length === 0) {
          nextWellnessDays = garminWellnessBiometrics;
          setWellnessDays(nextWellnessDays);
          wellnessDaysRef.current = nextWellnessDays;
        }
        if (isBrowserSessionLoggedOut()) return;
        await fetchServerConfigStatus();
      } catch (err) {
        setSyncError(err instanceof Error ? err.message : 'Telemetry sync failed.');
      } finally {
        setIsSyncing(false);
      }
    },
    [fetchServerConfigStatus]
  );

  // Instant hydration from Browser IndexedDB + OAuth redirect URL handling on boot
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
          const exData = await safeParseResponseJson(exResp);
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
          statusData?.polarConnected)
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
