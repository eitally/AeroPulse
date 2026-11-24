import React from 'react';
import type {
  AthleteProfile,
  ConnectionStatus,
  DistanceUnit,
  ThreshUser,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../../types';
import {
  buildCompleteAthleteProfile,
  getSavedIntervalsHeaders,
  isBrowserSessionLoggedOut,
  isGenericAthleteName,
  isUncalibratedDefaultProfile,
  safeParseResponseJson,
  saveRotatedStravaTokensToStorage,
  saveStravaSyncPolicyToStorage,
} from '../../utils/telemetryStorage';
import { markSessionActiveHint } from '../../utils/sessionHint';
import {
  hasStravaClientCredentials,
  type WearablesServerConfigStatusResponse,
} from './stravaDtoMapper';

export interface FetchServerConfigStatusDeps {
  activitiesRef: React.MutableRefObject<UnifiedActivity[]>;
  wellnessDaysRef: React.MutableRefObject<UnifiedWellnessDay[]>;
  athleteProfileRef: React.MutableRefObject<AthleteProfile>;
  setAthleteProfile: React.Dispatch<React.SetStateAction<AthleteProfile>>;
  setConnectionStatus: React.Dispatch<React.SetStateAction<ConnectionStatus>>;
  setCurrentUser: React.Dispatch<React.SetStateAction<ThreshUser | null>>;
  setDistanceUnit: (unit: DistanceUnit) => void;
  hasEnteredWorkspaceRef: React.MutableRefObject<boolean>;
  setHasEnteredWorkspace: (val: boolean) => void;
  setIsSessionLoggedOut: (val: boolean) => void;
  reconcileStoreOwnerAthleteId: (
    incomingAthleteId?: string | number | null,
    allowedPreviousIds?: string[]
  ) => Promise<void>;
}

export async function runFetchServerConfigStatus(
  deps: FetchServerConfigStatusDeps
): Promise<WearablesServerConfigStatusResponse | null> {
  const {
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
  } = deps;
  try {
    const isNotLoggedOut = () => !isBrowserSessionLoggedOut();
    const origin = encodeURIComponent(window.location.origin);
    const resp = await fetch(`/api/config/status?origin=${origin}`, {
      credentials: 'include',
      headers: getSavedIntervalsHeaders(),
    });
    if (!resp.ok) return null;
    const data = await safeParseResponseJson<WearablesServerConfigStatusResponse>(resp);
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

    if (
      notLoggedOut &&
      (isActiveStravaSession ||
        data.garminConnected ||
        data.corosConnected ||
        data.wahooConnected ||
        data.polarConnected)
    ) {
      markSessionActiveHint();
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
          const authMeData = (await authMeResp.json()) as {
            authenticated?: boolean;
            sessionToken?: string;
            user?: ThreshUser;
          };
          if (isNotLoggedOut() && authMeData?.authenticated && authMeData?.user) {
            const authenticatedUser = authMeData.user;
            setCurrentUser(authenticatedUser);
            const linkedIds: string[] = [
              ...(data.stravaAthleteId ? [String(data.stravaAthleteId)] : []),
              ...((authenticatedUser.authProviders || [])
                .filter((p) => p.provider === 'strava' && p.providerId)
                .map((p) => String(p.providerId))),
            ];
            await reconcileStoreOwnerAthleteId(authenticatedUser.id, linkedIds);
            if (isNotLoggedOut()) {
              markSessionActiveHint();
              try {
                if (localStorage.getItem('aeropulse_auth_gate_passed') === '1') {
                  setIsSessionLoggedOut(false);
                  hasEnteredWorkspaceRef.current = true;
                  setHasEnteredWorkspace(true);
                }
              } catch {
                // ignore
              }
              if (authenticatedUser.name && isGenericAthleteName(athleteProfileRef.current?.name)) {
                setAthleteProfile((prev) => ({
                  ...prev,
                  name: authenticatedUser.name,
                  ...(authenticatedUser.birthMonthYear
                    ? { birthMonthYear: authenticatedUser.birthMonthYear }
                    : {}),
                }));
              } else if (
                authenticatedUser.birthMonthYear &&
                !athleteProfileRef.current?.birthMonthYear
              ) {
                setAthleteProfile((prev) => ({
                  ...prev,
                  birthMonthYear: authenticatedUser.birthMonthYear,
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
          localStorage.getItem('aeropulse_garmin_personal_api_key'))
    );
    const isClientWahooConnected = Boolean(notLoggedOut && data.wahooConnected);
    const isClientPolarConnected = Boolean(notLoggedOut && data.polarConnected);
    const isClientCorosConnected = Boolean(notLoggedOut && data.corosConnected);
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
        isClientPolarConnected ||
        isClientCorosConnected
          ? 'LIVE'
          : 'SANDBOX_CALIBRATION',
      garminConfigured:
        typeof data.garminConfigured === 'boolean'
          ? data.garminConfigured
          : prev.garminConfigured,
      garminConnected: isClientGarminConnected,
      garminAuthMethod: isClientGarminConnected
        ? data.garminAuthMethod ||
          (localStorage.getItem('aeropulse_garmin_personal_api_key') ? 'PERSONAL_KEY' : 'NONE')
        : 'NONE',
      garminCanPushWorkouts: Boolean(isClientGarminConnected && data.garminCanPushWorkouts),
      garminAthleteName: isClientGarminConnected
        ? resolvedGarminName ||
          localStorage.getItem('aeropulse_garmin_athlete_name') ||
          prev.garminAthleteName
        : undefined,
      intervalsConfigured:
        typeof data.intervalsConfigured === 'boolean'
          ? data.intervalsConfigured
          : prev.intervalsConfigured,
      intervalsConnected: isClientIntervalsConnected,
      intervalsAuthMethod: isClientIntervalsConnected
        ? data.intervalsAuthMethod || 'API_KEY'
        : 'NONE',
      intervalsScope: isClientIntervalsConnected ? data.intervalsScope || prev.intervalsScope : undefined,
      intervalsCanWriteCalendar: Boolean(
        isClientIntervalsConnected && data.intervalsCanWriteCalendar
      ),
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
      corosConfigured:
        typeof data.corosConfigured === 'boolean' ? data.corosConfigured : prev.corosConfigured,
      corosConnected: isClientCorosConnected,
      corosAthleteId: isClientCorosConnected ? data.corosAthleteId || prev.corosAthleteId : undefined,
      corosAthleteName: isClientCorosConnected
        ? data.corosAthleteName || prev.corosAthleteName
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
}
