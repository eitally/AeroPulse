import React from 'react';
import type {
  AthleteGearItem,
  AthleteProfile,
  ConnectionStatus,
  PlannedWorkoutEvent,
  StravaSyncWindow,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../../types';
import {
  areActivityTimestampsClose,
  resolveActivityStartEpochMs,
} from '../../utils/activityTimestamp';
import {
  CURRENT_PMC_MODEL_VERSION,
  buildCompleteAthleteProfile,
  computeWellnessDaysFromActivities,
  decodeGooglePolylineClient,
  deduplicateActivitiesArchive,
  getSavedIntervalsHeaders,
  isBrowserSessionLoggedOut,
  isGenericAthleteName,
  isUncalibratedDefaultProfile,
  loadStravaSyncPolicyFromStorage,
  mergeActivitiesNonDestructive,
  mergeWellnessDaysNonDestructive,
  overlayBiometricsOntoActivityWellness,
  recalibrateStravaActivityLoadClient,
  reclassifyActivityEnvironment,
  repairAndRecomputeWellnessDays,
  savePersistedTelemetrySnapshot,
  saveRotatedStravaTokensToStorage,
} from '../../utils/telemetryStorage';
import {
  toUnifiedFromStravaDto,
  type StravaSyncActivityDto,
  type StravaSyncPayload,
  type WearablesServerConfigStatusResponse,
} from './stravaDtoMapper';

export interface RunLiveTelemetrySyncDeps {
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
  setIdbSavedAt: (val: string | null) => void;
  setIsSyncing: React.Dispatch<React.SetStateAction<boolean>>;
  setSyncError: React.Dispatch<React.SetStateAction<string | null>>;
  needsPmcModelV2SyncRef: React.MutableRefObject<boolean>;
  fetchServerConfigStatus: () => Promise<WearablesServerConfigStatusResponse | null>;
}

export async function runLiveTelemetrySync(
  deps: RunLiveTelemetrySyncDeps,
  fullHistory = false,
  explicitStravaWindow?: StravaSyncWindow
): Promise<void> {
  const {
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
  } = deps;
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

    if (statusData.corosConnected) {
      const corosResp = await fetch('/api/coros/sync', {
        credentials: 'include',
        headers: tzSyncHeaders,
      });
      if (isBrowserSessionLoggedOut()) return;
      if (corosResp.ok) {
        const corosData = await corosResp.json();
        if (isBrowserSessionLoggedOut()) return;
        if (Array.isArray(corosData.activities) && corosData.activities.length > 0) {
          const corosActs = corosData.activities.map((a: UnifiedActivity) =>
            reclassifyActivityEnvironment(a)
          );
          mergedActivities = mergedActivities
            ? mergeActivitiesNonDestructive(mergedActivities, corosActs)
            : corosActs;
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
        const stravaData = (await stravaResp.json()) as StravaSyncPayload;
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
              ? stravaData.activities.map((a) => String(a.stravaId))
              : []
          );
          const collectedActs: StravaSyncActivityDto[] = Array.isArray(stravaData.activities)
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
            const passData = (await passResp.json()) as StravaSyncPayload;
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
              Array.isArray(stravaData.activities)
                ? stravaData.activities.map(toUnifiedFromStravaDto)
                : activitiesRef.current
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
          const toUnifiedFromStrava = toUnifiedFromStravaDto;

          if (!mergedActivities) {
            mergedActivities = stravaData.activities.map(toUnifiedFromStrava);
          } else {
            const byStravaId = new Map<string, StravaSyncActivityDto>();
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
              (a, b) => resolveActivityStartEpochMs(b) - resolveActivityStartEpochMs(a)
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
}
