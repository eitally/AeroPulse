import { Router, type Request, type Response } from 'express';
import {
  authenticateGarminConnect,
  clearGarminSessionAsync,
  fetchDirectGarminProfileAndWellness,
  normalizeGarminPersonalApiActivities,
  pushWorkoutToGarminConnect,
  saveGarminSession,
  saveGarminSessionAsync,
} from '../garminConnectService.ts';
import {
  decodeAndVerifyToken as decodeSessionTokenSafely,
  setSessionCookie,
} from '../securityUtils.ts';
import {
  GARMIN_SESSION_DIR,
  getActiveGarminSession,
  getGarminScopeKey,
  isAuthenticatedRequest,
  loadJsonFile,
  runtimeStore,
  saveSessionCacheAsync,
} from '../sessionContext.ts';
import {
  buildServerAthleteProfile,
  parseWorkoutSyntaxToSteps,
} from '../physiologyEngine.ts';
import { resolveStravaAthleteIdentity } from './stravaRouter.ts';
import {
  BANISTER_ATL_DECAY,
  BANISTER_CTL_DECAY,
  getLocalDateIso,
  shiftIsoDate,
} from '../../src/physiology/stravaLoadCalibration.ts';
import { normalizeRawStravaActivity } from '../stravaSyncService.ts';
import {
  areActivityTimestampsClose,
  resolveActivityStartEpochMs,
} from '../../src/utils/activityTimestamp.ts';

export const garminRouter = Router();

// Connect Direct Garmin Connect Account (Personal API Key GCDC_... or OAuth2/Web Bearer)
garminRouter.post('/api/config/garmin', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const session = await authenticateGarminConnect({
      personalApiKey: body.personalApiKey,
      email: body.email,
      password: body.password,
      directBearerToken: body.directBearerToken,
      oauth1Token: body.oauth1Token,
      oauth1TokenSecret: body.oauth1TokenSecret,
    });

    const sessionToken = setSessionCookie(
      req,
      res,
      session.fullName || session.displayName || 'garmin-athlete'
    );
    const createdClaims = decodeSessionTokenSafely(sessionToken);
    const scopeKey = createdClaims?.sid?.slice(0, 24) || getGarminScopeKey(req);
    await saveGarminSessionAsync(GARMIN_SESSION_DIR, scopeKey, session);

    // Fetch direct Garmin profile, recent sleep/HRV biometrics, and activities
    const garminData = await fetchDirectGarminProfileAndWellness(session, 28).catch(
      () => null
    );
    await saveGarminSessionAsync(GARMIN_SESSION_DIR, scopeKey, session);
    await saveSessionCacheAsync(req, res, createdClaims?.sid);

    const stravaIdentity = await resolveStravaAthleteIdentity(req).catch(() => null);
    const sId = String(stravaIdentity?.athleteId || '').replace(/[^0-9]/g, '');
    const sActs = sId
      ? loadJsonFile<Record<string, unknown>[]>(`/tmp/aeropulse-strava-archive-${sId}.json`, [])
      : [];

    const normalizedGarminActs = garminData?.activities
      ? normalizeGarminPersonalApiActivities(garminData.activities, 250)
      : [];

    const latestW =
      garminData?.wellnessRows && garminData.wellnessRows.length > 0
        ? {
            ...garminData.wellnessRows[garminData.wellnessRows.length - 1],
            weightKg: garminData.rawProfile?.weight,
            restingHR: garminData.rawProfile?.icu_resting_hr,
          }
        : {
            weightKg: garminData?.rawProfile?.weight,
            restingHR: garminData?.rawProfile?.icu_resting_hr,
          };

    const syncedProfile = buildServerAthleteProfile(
      {
        ...(garminData?.rawProfile || {}),
        name:
          garminData?.rawProfile?.name ||
          session.fullName ||
          session.displayName ||
          stravaIdentity?.athleteName,
        source: 'INTERVALS_GARMIN',
      },
      latestW,
      [...normalizedGarminActs, ...sActs]
    );

    res.json({
      ok: true,
      garminConnected: true,
      garminAthleteName:
        garminData?.rawProfile?.name ||
        session.fullName ||
        session.displayName ||
        syncedProfile.name,
      athleteProfile: syncedProfile,
      sessionToken,
      garminTokens: {
        personalApiKey: session.personalApiKey,
        oauth2AccessToken: session.oauth2AccessToken,
        oauth1Token: session.oauth1Token,
        oauth1TokenSecret: session.oauth1TokenSecret,
      },
    });
  } catch (err: unknown) {
    res.status(400).json({
      error:
        err instanceof Error
          ? err.message
          : 'Failed to authenticate with Garmin Connect',
    });
  }
});

// Sync Direct Garmin Connect Profile, Sleep/HRV/Weight Biometrics & Activities
garminRouter.get('/api/garmin/sync', async (req: Request, res: Response) => {
  try {
    const session = getActiveGarminSession(req);
    if (!session) {
      res.status(401).json({ error: 'Garmin Connect is not connected.' });
      return;
    }

    const garminData = await fetchDirectGarminProfileAndWellness(session, 28);
    const scopeKey = getGarminScopeKey(req);
    if (scopeKey !== 'unauthenticated') {
      saveGarminSession(GARMIN_SESSION_DIR, scopeKey, session);
    }

    const stravaIdentity = await resolveStravaAthleteIdentity(req).catch(() => null);
    const sId = String(stravaIdentity?.athleteId || '').replace(/[^0-9]/g, '');
    const sActs = sId
      ? loadJsonFile<Record<string, unknown>[]>(`/tmp/aeropulse-strava-archive-${sId}.json`, [])
      : [];

    const prelimActivities = normalizeGarminPersonalApiActivities(
      garminData.activities || [],
      runtimeStore.athleteFtp || 250
    );

    const latestW =
      garminData.wellnessRows && garminData.wellnessRows.length > 0
        ? {
            ...garminData.wellnessRows[garminData.wellnessRows.length - 1],
            weightKg: garminData.rawProfile?.weight,
            restingHR: garminData.rawProfile?.icu_resting_hr,
          }
        : {
            weightKg: garminData.rawProfile?.weight,
            restingHR: garminData.rawProfile?.icu_resting_hr,
          };

    const syncedProfile = buildServerAthleteProfile(
      {
        ...(garminData.rawProfile || {}),
        name:
          garminData.rawProfile?.name ||
          session.fullName ||
          session.displayName ||
          stravaIdentity?.athleteName,
        source: 'INTERVALS_GARMIN',
      },
      latestW,
      [...prelimActivities, ...sActs]
    );

    const normalizedActivities = normalizeGarminPersonalApiActivities(
      garminData.activities || [],
      syncedProfile.ftp || 250,
      {
        lthr: syncedProfile.lthr,
        runLthr: syncedProfile.runLthr,
        thresholdPaceSecsPerKm: syncedProfile.thresholdPaceSecsPerKm,
        restingHr: syncedProfile.restingHr,
      }
    );

    runtimeStore.athleteFtp = syncedProfile.ftp;
    runtimeStore.athleteIndoorFtp = syncedProfile.indoorFtp;
    runtimeStore.athleteRunFtp = syncedProfile.runFtp;
    runtimeStore.athleteLthr = syncedProfile.lthr;
    runtimeStore.athleteMaxHr = syncedProfile.maxHr;
    runtimeStore.athleteProfile = syncedProfile;
    await saveSessionCacheAsync(req, res);

    const loadByDate = new Map<string, number>();
    const garminActivitiesList: typeof normalizedActivities = [];
    for (const a of normalizedActivities) {
      const d = String(a.startDateLocal || '').slice(0, 10);
      if (d) {
        loadByDate.set(d, (loadByDate.get(d) || 0) + Number(a.trainingLoad || 0));
      }
      if (resolveActivityStartEpochMs(a) > 0) {
        garminActivitiesList.push(a);
      }
    }

    // Include non-duplicate cached Strava activities so pre-28d CTL warmup is accurate
    const stravaCal = {
      calibratedFtp: Math.max(120, syncedProfile.ftp || 250),
      calibratedBikeLthr: Math.max(135, syncedProfile.lthr || 163),
      calibratedRunLthr: Math.max(140, syncedProfile.runLthr || 168),
      calibratedThresholdPaceSecsPerKm: Math.max(
        155,
        syncedProfile.thresholdPaceSecsPerKm || 255
      ),
      restingHr: Math.max(38, Math.min(78, syncedProfile.restingHr || 52)),
    };
    for (const rawSa of sActs) {
      if (!rawSa || (!rawSa.start_date_local && !rawSa.start_date)) continue;
      const saNorm = normalizeRawStravaActivity(rawSa, stravaCal);
      const isDup = garminActivitiesList.some((gAct) =>
        areActivityTimestampsClose(gAct, saNorm, 300)
      );
      if (isDup) continue;
      const d = saNorm.startDateLocal.slice(0, 10);
      if (d) {
        loadByDate.set(d, (loadByDate.get(d) || 0) + Number(saNorm.trainingLoad || 0));
      }
    }

    let lastRhr = syncedProfile.restingHr || 0;
    let lastWeight = syncedProfile.weightKg || 0;
    let ctlRaw = 0;
    let atlRaw = 0;
    const wellnessRows = garminData.wellnessRows || [];
    const firstWellnessDate =
      wellnessRows.length > 0
        ? String(wellnessRows[0].id || '').slice(0, 10)
        : getLocalDateIso();
    const warmupStartDate = shiftIsoDate(firstWellnessDate, -365);
    for (
      let dWarm = warmupStartDate;
      dWarm < firstWellnessDate;
      dWarm = shiftIsoDate(dWarm, 1)
    ) {
      const warmLoad = loadByDate.get(dWarm) || 0;
      ctlRaw = ctlRaw * BANISTER_CTL_DECAY + warmLoad * (1 - BANISTER_CTL_DECAY);
      atlRaw = atlRaw * BANISTER_ATL_DECAY + warmLoad * (1 - BANISTER_ATL_DECAY);
    }

    const ctlHistory: number[] = [];
    const formattedWellnessDays = wellnessRows.map((w, idx) => {
      const d = String(w.id || '').slice(0, 10);
      const dailyLoad = loadByDate.get(d) || 0;
      ctlRaw = ctlRaw * BANISTER_CTL_DECAY + dailyLoad * (1 - BANISTER_CTL_DECAY);
      atlRaw = atlRaw * BANISTER_ATL_DECAY + dailyLoad * (1 - BANISTER_ATL_DECAY);
      const ctl = Number(ctlRaw.toFixed(1));
      const atl = Number(atlRaw.toFixed(1));
      ctlHistory.push(ctl);
      const ctl7dAgo = idx >= 7 ? ctlHistory[idx - 7] : ctlHistory[0] || 0;
      const rampRate = Number((ctl - ctl7dAgo).toFixed(1));
      const tsb = Number((ctlRaw - atlRaw).toFixed(1));
      const loadRatio = ctl > 0 ? Number((atlRaw / ctlRaw).toFixed(2)) : 0;

      if (Number(w.restingHR) >= 30) lastRhr = Math.round(Number(w.restingHR));
      if (Number(w.weight) >= 35) lastWeight = Number(Number(w.weight).toFixed(1));

      const hrv = Math.round(Number(w.hrv || 0));
      const baseline7d = Math.round(Number(w.hrvBaseline7d || hrv || 0));
      const hrvLow = baseline7d > 0
        ? Math.round(Number(w.hrvNormalLow || Math.max(20, baseline7d * 0.88)))
        : 0;
      const hrvHigh = baseline7d > 0
        ? Math.round(Number(w.hrvNormalHigh || Math.max(hrvLow + 8, baseline7d * 1.15)))
        : 0;

      const rawStatus = String(w.garminHrvStatus || '').toUpperCase();
      const hrvStatus: 'Balanced' | 'Unbalanced' | 'Low' | 'Poor' =
        rawStatus === 'BALANCED'
          ? 'Balanced'
          : rawStatus === 'UNBALANCED'
            ? 'Unbalanced'
            : rawStatus === 'LOW'
              ? 'Low'
              : rawStatus === 'POOR'
                ? 'Poor'
                : hrv > 0 && hrvLow > 0 && hrv < hrvLow
                  ? 'Low'
                  : 'Balanced';

      const sleepSecs = Math.round(Number(w.sleepSecs || 0));
      const sleepScore = Math.round(Number(w.sleepScore || 0));
      const sleepQuality: 'Excellent' | 'Good' | 'Fair' | 'Poor' =
        sleepScore >= 85
          ? 'Excellent'
          : sleepScore >= 75
            ? 'Good'
            : sleepScore >= 60
              ? 'Fair'
              : 'Poor';

      return {
        date: d,
        ctl,
        atl,
        tsb,
        loadRatio,
        rampRate,
        hrvRMSSD: hrv,
        hrvBaseline7d: baseline7d,
        hrvNormalBandLow: hrvLow,
        hrvNormalBandHigh: hrvHigh,
        hrvStatus,
        restingHR: lastRhr,
        sleepSecs,
        sleepScore,
        sleepQuality,
        sleepDebt7dSecs: Math.max(0, 7.8 * 3600 - sleepSecs),
        weightKg: lastWeight,
        vo2MaxCycling: syncedProfile.vo2MaxCycling,
        vo2MaxRunning: syncedProfile.vo2MaxRunning,
        steps: w.steps != null ? Number(w.steps) : undefined,
        rideEftp: syncedProfile.eFtp,
        rideWPrime: syncedProfile.wPrime,
        ridePMax: syncedProfile.pMax,
        runEftp: syncedProfile.runEFtp,
        garminTrainingStatus: hrvStatus === 'Low' ? ('Strained' as const) : ('Productive' as const),
        trainingStatusReason: `Synced directly via Garmin Connect Personal API (HRV ${hrv || baseline7d} ms · ${hrvStatus}, RHR ${lastRhr} bpm).`,
        readinessStatus: (hrvStatus === 'Low'
          ? 'Strain'
          : hrvStatus === 'Unbalanced'
            ? 'Caution'
            : 'Optimal') as 'Optimal' | 'Caution' | 'Strain',
        dailyLoad,
      };
    });

    res.json({
      ok: true,
      garminAthleteName: syncedProfile.name,
      athleteProfile: syncedProfile,
      wellnessDays: formattedWellnessDays,
      activities: normalizedActivities,
    });
  } catch (err: unknown) {
    res.status(400).json({
      error:
        err instanceof Error
          ? err.message
          : 'Failed to sync Garmin Connect Personal API',
    });
  }
});

garminRouter.delete('/api/config/garmin', async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) {
    res.status(401).json({ error: 'Authentication required to disconnect Garmin Connect.' });
    return;
  }
  const scopeKey = getGarminScopeKey(req);
  if (scopeKey !== 'unauthenticated') {
    await clearGarminSessionAsync(GARMIN_SESSION_DIR, scopeKey);
  }
  res.json({ ok: true, garminConnected: false });
});

// Direct Workout Push to Garmin Connect Calendar (Watches & Edge Head Units)
garminRouter.post('/api/garmin/workout/push', async (req: Request, res: Response) => {
  try {
    const session = getActiveGarminSession(req);
    if (!session) {
      res.status(400).json({
        error:
          'Garmin Connect is not connected yet. Connect your Garmin account in Data Sources first.',
      });
      return;
    }

    const body = req.body || {};
    const date = String(body.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const name = String(body.name || 'THRESH Daily Prescription');
    const sportCategory = body.sportCategory || 'Cycling';
    const ftpWatts = Number(body.ftpWatts || runtimeStore.athleteProfile?.ftp || 250);
    const lthrBpm = Number(body.lthrBpm || runtimeStore.athleteProfile?.lthr || 165);
    const workoutSyntax = String(body.workoutSyntax || '');
    const plannedDurationSecs = Number(body.plannedDurationSecs || 3600);

    const parsedSteps =
      Array.isArray(body.steps) && body.steps.length > 0
        ? body.steps
        : parseWorkoutSyntaxToSteps(workoutSyntax, plannedDurationSecs).map((st) => ({
            label: st.label,
            durationSecs: st.durationSecs || 600,
            targetPctFtp: st.targetPctFtp || 75,
          }));

    const pushRes = await pushWorkoutToGarminConnect(session, {
      date,
      name,
      sportCategory,
      description: body.description || workoutSyntax,
      ftpWatts,
      lthrBpm,
      steps: parsedSteps,
    });

    saveGarminSession(GARMIN_SESSION_DIR, getGarminScopeKey(req), session);
    res.json(pushRes);
  } catch (err: unknown) {
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Failed to push workout to Garmin Connect',
    });
  }
});

garminRouter.post('/api/garmin/disconnect', async (req: Request, res: Response) => {
  const scopeKey = getGarminScopeKey(req);
  if (scopeKey && scopeKey !== 'unauthenticated') {
    await clearGarminSessionAsync(GARMIN_SESSION_DIR, scopeKey);
  }
  await saveSessionCacheAsync(req, res);
  res.json({ connected: false });
});
