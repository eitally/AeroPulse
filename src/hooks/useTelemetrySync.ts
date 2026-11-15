import React, { useCallback } from 'react';
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
import {
  buildCompleteAthleteProfile,
  clearPersistedTelemetrySnapshot,
  computeWellnessDaysFromActivities,
  getSavedIntervalsHeaders,
  isGenericAthleteName,
  isUncalibratedDefaultProfile,
  mergeActivitiesNonDestructive,
  mergeWellnessDaysNonDestructive,
  reclassifyActivityEnvironment,
  safeParseResponseJson,
  savePersistedTelemetrySnapshot,
  saveRotatedStravaTokensToStorage,
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
}

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
}: UseTelemetrySyncParams) {
  const reconcileStoreOwnerAthleteId = useCallback(async (incomingAthleteId?: string | number | null) => {
    const cleanId = incomingAthleteId ? String(incomingAthleteId).trim() : '';
    if (!cleanId) return;
    try {
      const prevOwner =
        localStorage.getItem('aeropulse_store_owner_athlete_id') ||
        localStorage.getItem('aeropulse_strava_athlete_id') ||
        '';
      if (prevOwner && prevOwner !== cleanId) {
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
        localStorage.removeItem('aeropulse_garmin_athlete_name');
        localStorage.removeItem('aeropulse_intervals_athlete_name');
      }
      localStorage.setItem('aeropulse_store_owner_athlete_id', cleanId);
      localStorage.setItem('aeropulse_strava_athlete_id', cleanId);
    } catch {
      // ignore storage errors
    }
  }, []);


  const fetchServerConfigStatus = useCallback(async () => {
    try {
      let notLoggedOut = true;
      let savedStravaName: string | undefined;
      try {
        notLoggedOut = localStorage.getItem('aeropulse_logged_out') !== '1';
        savedStravaName = localStorage.getItem('aeropulse_strava_athlete_name') || undefined;
      } catch {
        // ignore
      }
      const origin = encodeURIComponent(window.location.origin);
      const resp = await fetch(`/api/config/status?origin=${origin}`, {
        credentials: 'include',
        headers: getSavedIntervalsHeaders(),
      });
      if (!resp.ok) return null;
      const data = await safeParseResponseJson(resp);
      if (data?.error && !data?.callbackUrl) return null;

      const isActiveStravaSession = Boolean(
        notLoggedOut && (data.stravaConnected || hasStravaClientCredentials())
      );

      if (isActiveStravaSession && data.stravaAthleteId) {
        await reconcileStoreOwnerAthleteId(data.stravaAthleteId);
      }

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

      if (notLoggedOut) {
        try {
          const authMeResp = await fetch('/api/auth/me', { credentials: 'include' });
          if (authMeResp.ok) {
            const authMeData = await authMeResp.json();
            if (authMeData?.authenticated && authMeData?.user) {
              setCurrentUser(authMeData.user);
              if (authMeData.user.name && isGenericAthleteName(athleteProfileRef.current?.name)) {
                setAthleteProfile((prev) => ({ ...prev, name: authMeData.user.name }));
              }
            }
          }
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
      const isClientIntervalsConnected = Boolean(isClientStravaConnected && data.intervalsConnected);
      const isClientGarminConnected = Boolean(
        isClientStravaConnected &&
          (data.garminConnected ||
            localStorage.getItem('aeropulse_garmin_personal_api_key') ||
            localStorage.getItem('aeropulse_garmin_bearer_token'))
      );
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
          isClientIntervalsConnected || isClientStravaConnected || isClientGarminConnected
            ? 'LIVE'
            : 'SANDBOX_CALIBRATION',
        garminConnected: isClientGarminConnected,
        garminAthleteName: isClientGarminConnected
          ? resolvedGarminName ||
            localStorage.getItem('aeropulse_garmin_athlete_name') ||
            prev.garminAthleteName
          : undefined,
        intervalsConnected: isClientIntervalsConnected,
        intervalsAthleteId: isClientIntervalsConnected ? data.intervalsAthleteId || '0' : '0',
        intervalsAthleteName: isClientIntervalsConnected
          ? resolvedIntervalsName || prev.intervalsAthleteName
          : undefined,
        intervalsSource: isClientIntervalsConnected ? data.intervalsSource || 'USER_INPUT' : 'NONE',
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
      setIsSyncing(true);
      setSyncError(null);
      try {
        const headers = getSavedIntervalsHeaders();
        const statusResp = await fetch(
          `/api/config/status?origin=${encodeURIComponent(window.location.origin)}`,
          { credentials: 'include', headers }
        );
        const statusData = statusResp.ok ? await statusResp.json() : {};
        if (statusData.stravaTokens) {
          saveRotatedStravaTokensToStorage(statusData.stravaTokens);
        }

        // Refresh headers in case status check rotated the Strava token
        const activeHeaders = getSavedIntervalsHeaders();
        const hasVirtualCyclingArchive =
          activitiesRef.current.filter(
            (a) => a.sportCategory === 'Cycling' && a.environment === 'INDOOR'
          ).length >= 50;
        const hasPersistedArchive =
          !fullHistory && activitiesRef.current.length >= 50 && hasVirtualCyclingArchive;
        const deltaOldestDate = new Date(Date.now() - 60 * 86400 * 1000)
          .toISOString()
          .slice(0, 10);

        let mergedActivities: UnifiedActivity[] | null = null;
        let nextWellnessDays = wellnessDaysRef.current;
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
          if (intResp.ok) {
            const intData = await intResp.json();
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
          if (garminResp.ok) {
            const garminData = await garminResp.json();
            if (Array.isArray(garminData.wellnessDays) && garminData.wellnessDays.length > 0) {
              nextWellnessDays = mergeWellnessDaysNonDestructive(
                nextWellnessDays,
                garminData.wellnessDays
              );
              setWellnessDays(nextWellnessDays);
              wellnessDaysRef.current = nextWellnessDays;
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

        if (statusData.wahooConnected) {
          const wahooResp = await fetch('/api/wahoo/sync', {
            credentials: 'include',
            headers: activeHeaders,
          });
          if (wahooResp.ok) {
            const wahooData = await wahooResp.json();
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
            headers: activeHeaders,
          });
          if (polarResp.ok) {
            const polarData = await polarResp.json();
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

        const savedWindow = statusData.stravaSyncPolicy?.window as StravaSyncWindow | undefined;
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
          const hasPersistedVirtualCycling = activitiesRef.current.some(
            (a) => a.sportCategory === 'Cycling' && a.environment === 'INDOOR'
          );
          const useDelta =
            !fullHistory &&
            !explicitStravaWindow &&
            hasPersistedArchive &&
            hasPersistedVirtualCycling;
          const syncQs = new URLSearchParams({ window: targetStravaWindow });
          if (useDelta) {
            syncQs.set('deltaOnly', 'true');
          } else if (fullHistory || targetStravaWindow === 'all') {
            syncQs.set('full', 'true');
          }
          const stravaResp = await fetch(`/api/strava/sync?${syncQs.toString()}`, {
            credentials: 'include',
            headers: activeHeaders,
          });
          if (stravaResp.ok) {
            const stravaData = await stravaResp.json();
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
              const toUnifiedFromStrava = (sa: any): UnifiedActivity =>
                reclassifyActivityEnvironment({
                  id: `strava-${sa.stravaId}`,
                  stravaId: String(sa.stravaId),
                  startDateLocal: sa.startDateLocal,
                  name: sa.name,
                  sportCategory: sa.sportCategory,
                  environment: sa.environment,
                  subType: sa.subType || (sa.environment === 'INDOOR' ? 'Smart Trainer' : 'Road'),
                  movingTimeSecs: sa.movingTimeSecs,
                  distanceMeters: sa.distanceMeters,
                  elevationGainMeters: sa.elevationGainMeters,
                  avgPower: sa.avgPower,
                  normalizedPower: sa.normalizedPower,
                  intensityFactor: sa.intensityFactor,
                  trainingLoad: sa.trainingLoad || 0,
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
                  routeLatLngs: Array.isArray(sa.routeLatLngs) ? sa.routeLatLngs : undefined,
                  startLatLng: sa.startLatLng,
                  endLatLng: sa.endLatLng,
                  segmentEfforts: sa.segmentEfforts || [],
                  sourceBadges: ['Strava'],
                });

              if (!mergedActivities) {
                mergedActivities = stravaData.activities.map(toUnifiedFromStrava);
              } else {
                const byStravaId = new Map<string, any>();
                for (const sa of stravaData.activities) {
                  byStravaId.set(String(sa.stravaId), sa);
                }
                mergedActivities = mergedActivities.map((act) => {
                  let matched = act.stravaId ? byStravaId.get(String(act.stravaId)) : undefined;
                  if (!matched) {
                    const actNorm = String(act.startDateLocal || '').replace(/Z$/i, '');
                    const actTime = new Date(actNorm).getTime();
                    for (const [sid, sa] of byStravaId.entries()) {
                      const saNorm = String(sa.startDateLocal || '').replace(/Z$/i, '');
                      const saTime = new Date(saNorm).getTime();
                      const timeDiffSecs = Math.abs(actTime - saTime) / 1000;
                      const sameDate = actNorm.slice(0, 10) === saNorm.slice(0, 10);
                      const distDiffRatio =
                        act.distanceMeters > 500 && sa.distanceMeters > 500
                          ? Math.abs(act.distanceMeters - sa.distanceMeters) /
                            Math.max(act.distanceMeters, sa.distanceMeters)
                          : 1;
                      if (
                        sa.sportCategory === act.sportCategory &&
                        (timeDiffSecs <= 300 || (sameDate && distDiffRatio <= 0.03))
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

                    return reclassifyActivityEnvironment({
                      ...act,
                      name: isGenericStubName && matched.name ? matched.name : act.name,
                      environment: resolvedEnv,
                      subType: resolvedSubType,
                      stravaId: String(matched.stravaId || act.stravaId || ''),
                      trainingLoad:
                        act.trainingLoad && act.trainingLoad > 0
                          ? act.trainingLoad
                          : matched.trainingLoad || act.trainingLoad,
                      avgPower: act.avgPower ?? matched.avgPower,
                      normalizedPower: act.normalizedPower ?? matched.normalizedPower,
                      intensityFactor: act.intensityFactor ?? matched.intensityFactor,
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
                          : Array.isArray(matched.routeLatLngs) && matched.routeLatLngs.length > 2
                            ? matched.routeLatLngs
                            : act.routeLatLngs,
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
            }
          } else {
            const errJson = await stravaResp.json().catch(() => ({}));
            if (errJson?.error && !statusData.garminConnected && !statusData.intervalsConnected) {
              setSyncError(errJson.error);
            }
          }
        }

        if (mergedActivities !== null) {
          // Non-destructively merge with existing persisted archive so deployments/delta syncs never lose workouts, streams, or routes
          const combinedArchive = mergeActivitiesNonDestructive(
            activitiesRef.current,
            mergedActivities
          );
          setActivities(combinedArchive);
          activitiesRef.current = combinedArchive;

          if (!statusData.intervalsConnected && combinedArchive.length > 0) {
            const activityDerivedWellness = computeWellnessDaysFromActivities(combinedArchive);
            nextWellnessDays =
              nextWellnessDays.length > 0
                ? mergeWellnessDaysNonDestructive(activityDerivedWellness, nextWellnessDays)
                : activityDerivedWellness;
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

          const savedTimestamp = await savePersistedTelemetrySnapshot({
            activities: combinedArchive,
            wellnessDays: nextWellnessDays,
            plannedEvents: nextPlannedEvents,
            gearItems: nextGearItems,
            athleteProfile: athleteProfileRef.current,
            redactedStravaCount: nextRedactedCount,
            earliestActivityDate: oldestLoaded,
          });
          if (savedTimestamp) setIdbSavedAt(savedTimestamp);
        }
        await fetchServerConfigStatus();
      } catch (err) {
        setSyncError(err instanceof Error ? err.message : 'Telemetry sync failed.');
      } finally {
        setIsSyncing(false);
      }
    },
    [fetchServerConfigStatus]
  );

  return {
    reconcileStoreOwnerAthleteId,
    fetchServerConfigStatus,
    syncLiveTelemetry,
  };
}
