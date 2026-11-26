import express, { type Request, type Response } from 'express';
import {
  runtimeStore,
  saveSessionCache,
  loadJsonFile,
  saveJsonFile,
  getActiveGarminSession,
  ROUTES_BY_ACTIVITY_CACHE_FILE,
  SEGMENTS_BY_ACTIVITY_CACHE_FILE,
} from '../../sessionContext.ts';
import {
  buildServerAthleteProfile,
  type ServerLatestWellnessInput,
  type ServerStravaZonesPayload,
} from '../../physiologyEngine.ts';
import type {
  RawStravaActivity,
  RawStravaAthleteProfile,
} from '../../stravaSyncService.ts';
import type {
  ActivityInterval,
  StravaSegmentEffort,
} from '../../../src/types.ts';
import {
  fetchDirectGarminProfileAndWellness,
  normalizeGarminPersonalApiActivities,
} from '../../garminConnectService.ts';
import { computeIntervalsSegmentEfforts } from '../activitiesRouter.ts';
import { resolveStravaAthleteIdentity, ensureValidStravaAccessToken } from '../stravaRouter.ts';
import { extractStravaId, readStravaResponseJson } from '../../stravaIdUtils.ts';
import {
  getEffectiveIntervalsConfig,
  getIntervalsAuthHeader,
  type RawIntervalsActivity,
  type RawIntervalsAthleteProfile,
  type RawIntervalsWellnessRow,
} from './intervalsAuthAndConfig.ts';
import { syncIntervalsAllHistory } from './intervalsSyncService.ts';

export const intervalsProfileAndPushRouter = express.Router();

intervalsProfileAndPushRouter.post('/api/intervals/profile/sync', async (req: Request, res: Response) => {
  try {
    const config = getEffectiveIntervalsConfig(req);
    const intervalsAuth = getIntervalsAuthHeader(config);
    const athleteId = config.athleteId || '0';
    const stravaIdentity = await resolveStravaAthleteIdentity(req);
    const garminSession = getActiveGarminSession(req);

    if (!intervalsAuth) {
      // Check Direct Garmin Connect + Live Strava OAuth profile + /athlete/zones + cached Strava activities
      const [garminDirect, validStravaToken] = await Promise.all([
        garminSession
          ? fetchDirectGarminProfileAndWellness(garminSession, 14).catch(() => null)
          : Promise.resolve(null),
        ensureValidStravaAccessToken(req, false),
      ]);

      if (validStravaToken || garminDirect) {
        let sAth: RawStravaAthleteProfile = {};
        let sZones: ServerStravaZonesPayload | null = null;
        if (validStravaToken) {
          const sHeaders = { Authorization: `Bearer ${validStravaToken}` };
          const [sAthResp, sZonesResp] = await Promise.all([
            fetch('https://www.strava.com/api/v3/athlete', { headers: sHeaders }),
            fetch('https://www.strava.com/api/v3/athlete/zones', { headers: sHeaders }),
          ]);
          sAth = sAthResp.ok ? await readStravaResponseJson<RawStravaAthleteProfile>(sAthResp) : {};
          sZones = sZonesResp.ok
            ? await readStravaResponseJson<ServerStravaZonesPayload>(sZonesResp)
            : null;
        }
        const sId = (extractStravaId(sAth) || stravaIdentity?.athleteId || '').replace(/[^0-9]/g, '');
        const sActs = sId
          ? loadJsonFile<RawStravaActivity[]>(`/tmp/aeropulse-strava-archive-${sId}.json`, [])
          : [];
        const sName =
          garminDirect?.rawProfile?.name ||
          [sAth.firstname, sAth.lastname].filter(Boolean).join(' ').trim() ||
          String(sAth.username || '').trim() ||
          stravaIdentity?.athleteName ||
          'Athlete';

        const latestGarminW =
          garminDirect?.wellnessRows && garminDirect.wellnessRows.length > 0
            ? {
                ...garminDirect.wellnessRows[garminDirect.wellnessRows.length - 1],
                weightKg: garminDirect.rawProfile?.weight,
                restingHR: garminDirect.rawProfile?.icu_resting_hr,
              }
            : {
                weightKg: garminDirect?.rawProfile?.weight,
                restingHR: garminDirect?.rawProfile?.icu_resting_hr,
              };

        const normalizedGarminActs = garminDirect?.activities
          ? normalizeGarminPersonalApiActivities(
              garminDirect.activities,
              garminDirect.rawProfile?.ftp || 250
            )
          : [];

        const firstGarminSetting = Array.isArray(garminDirect?.rawProfile?.sportSettings)
          ? garminDirect.rawProfile.sportSettings[0]
          : undefined;
        const preservedDob =
          typeof runtimeStore.athleteProfile?.birthMonthYear === 'string'
            ? runtimeStore.athleteProfile.birthMonthYear
            : undefined;
        const directSyncedProfile = buildServerAthleteProfile(
          {
            ...(garminDirect?.rawProfile || {}),
            id: sId || garminDirect?.rawProfile?.id || '0',
            name: sName,
            ftp:
              firstGarminSetting?.ftp ??
              garminDirect?.rawProfile?.ftp ??
              (Number(sAth.ftp) > 80 ? Math.round(Number(sAth.ftp)) : undefined),
            weightKg:
              garminDirect?.rawProfile?.weight ??
              (Number(sAth.weight) > 30 ? Number(sAth.weight) : undefined),
            stravaZones: sZones,
            ...(preservedDob ? { birthMonthYear: preservedDob } : {}),
            source: garminDirect ? 'INTERVALS_GARMIN' : 'STRAVA_OAUTH',
          },
          latestGarminW,
          [...normalizedGarminActs, ...sActs]
        );
        runtimeStore.athleteProfile = directSyncedProfile;
        runtimeStore.athleteFtp = directSyncedProfile.ftp;
        runtimeStore.athleteIndoorFtp = directSyncedProfile.indoorFtp;
        runtimeStore.athleteRunFtp = directSyncedProfile.runFtp;
        runtimeStore.athleteLthr = directSyncedProfile.lthr;
        runtimeStore.athleteMaxHr = directSyncedProfile.maxHr;
        saveSessionCache(req);
        res.json({ ok: true, athleteProfile: directSyncedProfile, mode: 'LIVE' });
        return;
      }

      const fallbackProfile = buildServerAthleteProfile(req.body?.overrides || null, null);
      res.json({ ok: true, athleteProfile: fallbackProfile, mode: 'SANDBOX' });
      return;
    }

    const authHeader = intervalsAuth;
    const todayStr = new Date().toISOString().slice(0, 10);
    const newestStr = new Date(Date.now() + 86400 * 1000).toISOString().slice(0, 10);
    const oldest60d = new Date(Date.now() - 60 * 86400 * 1000).toISOString().slice(0, 10);

    const [profileResp, wellnessResp, actsResp, garminDirect] = await Promise.all([
      fetch(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}`, {
        headers: { Authorization: authHeader, Accept: 'application/json' },
      }),
      fetch(
        `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/wellness?oldest=${oldest60d}&newest=${newestStr}`,
        {
          headers: { Authorization: authHeader, Accept: 'application/json' },
        }
      ),
      fetch(
        `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/activities?oldest=${oldest60d}&newest=${todayStr}`,
        {
          headers: { Authorization: authHeader, Accept: 'application/json' },
        }
      ),
      garminSession
        ? fetchDirectGarminProfileAndWellness(garminSession, 14).catch(() => null)
        : Promise.resolve(null),
    ]);

    if (!profileResp.ok && !garminDirect) {
      res.status(profileResp.status).json({
        error: `Intervals.icu athlete profile request returned ${profileResp.status}.`,
      });
      return;
    }

    const rawProfile = profileResp.ok
      ? ((await profileResp.json()) as RawIntervalsAthleteProfile)
      : {};
    const rawWellnessList = wellnessResp.ok
      ? ((await wellnessResp.json()) as RawIntervalsWellnessRow[])
      : [];
    const rawActsList = actsResp.ok
      ? ((await actsResp.json()) as RawIntervalsActivity[])
      : [];

    const latestWellnessSummary: ServerLatestWellnessInput = {};
    for (const w of rawWellnessList) {
      if (w.weight && Number(w.weight) > 25) latestWellnessSummary.weightKg = Number(w.weight);
      if (w.restingHR && Number(w.restingHR) > 25)
        latestWellnessSummary.restingHR = Number(w.restingHR);
      if (w.vo2max && Number(w.vo2max) > 20) {
        latestWellnessSummary.vo2MaxCycling = Number(w.vo2max);
        latestWellnessSummary.vo2MaxRunning = Number(w.vo2max);
      }
      if (Array.isArray(w.sportInfo)) {
        const rideInfo = w.sportInfo.find((s) => s.type === 'Ride');
        const runInfo = w.sportInfo.find((s) => s.type === 'Run');
        if (rideInfo?.eftp) latestWellnessSummary.rideEftp = Math.round(Number(rideInfo.eftp));
        if (rideInfo?.wPrime) latestWellnessSummary.rideWPrime = Math.round(Number(rideInfo.wPrime));
        if (rideInfo?.pMax) latestWellnessSummary.ridePMax = Math.round(Number(rideInfo.pMax));
        if (runInfo?.eftp) latestWellnessSummary.runEftp = Math.round(Number(runInfo.eftp));
      }
    }

    if (garminDirect?.rawProfile?.weight) {
      latestWellnessSummary.weightKg = garminDirect.rawProfile.weight;
    }
    if (garminDirect?.rawProfile?.icu_resting_hr) {
      latestWellnessSummary.restingHR = garminDirect.rawProfile.icu_resting_hr;
    }

    const garminActs = garminDirect?.activities
      ? normalizeGarminPersonalApiActivities(
          garminDirect.activities,
          garminDirect.rawProfile?.ftp || 250
        )
      : [];

    const mergedRawProfile = {
      ...rawProfile,
      ...(garminDirect?.rawProfile || {}),
      name:
        garminDirect?.rawProfile?.name ||
        rawProfile.name ||
        [rawProfile.firstname, rawProfile.lastname].filter(Boolean).join(' ') ||
        stravaIdentity?.athleteName,
      weight:
        garminDirect?.rawProfile?.weight ||
        rawProfile.icu_weight ||
        rawProfile.weight ||
        stravaIdentity?.weightKg,
      ftp:
        garminDirect?.rawProfile?.ftp ||
        rawProfile.ftp ||
        stravaIdentity?.ftp,
      sportSettings:
        Array.isArray(garminDirect?.rawProfile?.sportSettings) &&
        garminDirect!.rawProfile!.sportSettings.length > 0
          ? garminDirect!.rawProfile!.sportSettings
          : rawProfile.sportSettings,
    };

    const preservedSyncedDob =
      typeof runtimeStore.athleteProfile?.birthMonthYear === 'string'
        ? runtimeStore.athleteProfile.birthMonthYear
        : undefined;
    const syncedProfile = buildServerAthleteProfile(
      {
        ...mergedRawProfile,
        ...(preservedSyncedDob ? { birthMonthYear: preservedSyncedDob } : {}),
      },
      latestWellnessSummary,
      [...garminActs, ...rawActsList]
    );
    runtimeStore.athleteFtp = syncedProfile.ftp;
    runtimeStore.athleteIndoorFtp = syncedProfile.indoorFtp;
    runtimeStore.athleteRunFtp = syncedProfile.runFtp;
    runtimeStore.athleteLthr = syncedProfile.lthr;
    runtimeStore.athleteMaxHr = syncedProfile.maxHr;
    runtimeStore.athleteProfile = syncedProfile;
    saveSessionCache(req);

    res.json({
      ok: true,
      athleteProfile: syncedProfile,
      mode: 'LIVE',
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to sync Athlete Profile & Zones.',
    });
  }
});


// Cross-Watch Bridge Workout Push to Intervals.icu Calendar (relays automatically to Garmin, COROS, Suunto & Wahoo)
intervalsProfileAndPushRouter.post('/api/intervals/workout/push', async (req: Request, res: Response) => {
  try {
    const config = getEffectiveIntervalsConfig(req);
    const authHeader = getIntervalsAuthHeader(config);
    if (!authHeader) {
      res.status(401).json({
        ok: false,
        pushed: false,
        connectRequired: true,
        error:
          'Intervals.icu is not connected yet. Connect Intervals.icu via OAuth 2.0 or Personal API Key in Data Sources.',
      });
      return;
    }

    const activeScope = String(
      config.scope || runtimeStore.intervalsScope || req.headers['x-intervals-scope'] || ''
    ).trim();
    if (
      config.accessToken &&
      !config.apiKey &&
      activeScope &&
      !activeScope.toUpperCase().includes('CALENDAR:WRITE')
    ) {
      res.status(403).json({
        ok: false,
        pushed: false,
        needsScopeUpgrade: true,
        error:
          'Your Intervals.icu OAuth connection only has read-only calendar permissions. Click "Upgrade Scope to Watch Push" in Data Sources to enable CALENDAR:WRITE.',
      });
      return;
    }

    const body = req.body || {};
    const date = String(body.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const scheduledTime =
      typeof body.scheduledTime === 'string' &&
      /^([01]?\d|2[0-3]):[0-5]\d$/.test(body.scheduledTime.trim())
        ? body.scheduledTime.trim().padStart(5, '0')
        : '08:00';
    const name = String(body.name || 'MeetReady Prescribed Session').trim();
    const sportCategory = String(body.sportCategory || 'Running');
    const envPref = String(body.environmentPreference || 'FLEXIBLE');
    const plannedDurationSecs = Math.max(60, Number(body.plannedDurationSecs || 1800));
    const plannedLoad = Math.max(1, Number(body.plannedLoad || 50));

    let workoutMarkdown = typeof body.workoutSyntax === 'string' ? body.workoutSyntax.trim() : '';
    if (!workoutMarkdown && Array.isArray(body.steps) && body.steps.length > 0) {
      const cue = sportCategory === 'Running' ? 'Pace' : 'FTP';
      workoutMarkdown = (
        body.steps as Array<{
          label?: string;
          durationSecs?: number;
          distanceMeters?: number;
          targetPctFtp?: number;
        }>
      )
        .map((st) => {
          const durOrDist = st.distanceMeters
            ? `${Math.round(st.distanceMeters)}m`
            : `${Math.max(15, Math.round(Number(st.durationSecs || 300)))}s`;
          const pct = Math.max(45, Math.min(180, Math.round(Number(st.targetPctFtp || 75))));
          return `- ${durOrDist} ${Math.max(45, pct - 2)}%-${Math.min(180, pct + 2)}% ${cue} (${String(
            st.label || 'Interval'
          )})`;
        })
        .join('\n');
    }
    if (!workoutMarkdown) {
      workoutMarkdown =
        typeof body.description === 'string' && body.description.trim()
          ? body.description.trim()
          : '- 30m 75% Pace';
    }

    const icuType =
      sportCategory === 'Running'
        ? 'Run'
        : sportCategory === 'Swimming'
          ? 'Swim'
          : sportCategory === 'Strength'
            ? 'WeightTraining'
            : envPref === 'INDOOR'
              ? 'VirtualRide'
              : 'Ride';

    const athleteId = config.athleteId || '0';
    const icuResp = await fetch(
      `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          category: 'WORKOUT',
          start_date_local: `${date}T${scheduledTime}:00`,
          name,
          type: icuType,
          description: workoutMarkdown,
          moving_time: plannedDurationSecs,
          icu_training_load: plannedLoad,
        }),
      }
    );

    if (icuResp.status === 403) {
      res.status(403).json({
        ok: false,
        pushed: false,
        needsScopeUpgrade: true,
        error:
          'Intervals.icu returned 403 Forbidden (missing CALENDAR:WRITE permission). Click "Upgrade Scope to Watch Push" in Data Sources to push workouts to Garmin, COROS, Suunto & Wahoo.',
      });
      return;
    }

    if (!icuResp.ok) {
      const errText = await icuResp.text().catch(() => '');
      res.status(icuResp.status).json({
        ok: false,
        pushed: false,
        error: `Intervals.icu workout push failed (${icuResp.status}): ${errText.slice(0, 160)}`,
      });
      return;
    }

    const created = (await icuResp.json().catch(() => ({}))) as { id?: string | number };
    res.json({
      ok: true,
      pushed: true,
      eventId: created?.id,
      message: `Pushed "${name}" to Intervals.icu Calendar (${date}) — synced to linked Garmin, COROS, Suunto & Wahoo watches.`,
    });
  } catch (error: unknown) {
    res.status(500).json({
      ok: false,
      pushed: false,
      error: error instanceof Error ? error.message : 'Failed to push workout to Intervals.icu',
    });
  }
});

intervalsProfileAndPushRouter.get('/api/intervals/sync', async (req: Request, res: Response) => {
  try {
    const config = getEffectiveIntervalsConfig(req);
    const authHeader = getIntervalsAuthHeader(config);
    if (!authHeader) {
      res
        .status(401)
        .json({ error: 'Intervals.icu is not connected (OAuth access token or API Key required).' });
      return;
    }
    const oldestParam = String(req.query.oldest || '2010-01-01').trim();
    const payload = await syncIntervalsAllHistory(config, config.athleteId, oldestParam);
    res.json(payload);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to sync Intervals.icu data',
    });
  }
});

// Fetch second-by-second streams (including GPS latlng), auto-detected Intervals.icu intervals, AND Strava Segment efforts
intervalsProfileAndPushRouter.get('/api/intervals/activities/:id/streams', async (req: Request, res: Response) => {
  try {
    const config = getEffectiveIntervalsConfig(req);
    const authHeader = getIntervalsAuthHeader(config);
    if (!authHeader) {
      res
        .status(401)
        .json({ error: 'Intervals.icu is not connected (OAuth access token or API Key required).' });
      return;
    }

    const activityId = req.params.id;
    const [streamsResp, detailResp, segmentsResp] = await Promise.all([
      fetch(
        `https://intervals.icu/api/v1/activity/${encodeURIComponent(activityId)}/streams?types=time,distance,latlng,watts,heartrate,velocity_smooth,cadence,altitude`,
        { headers: { Authorization: authHeader, Accept: 'application/json' } }
      ),
      fetch(
        `https://intervals.icu/api/v1/activity/${encodeURIComponent(activityId)}?intervals=true`,
        { headers: { Authorization: authHeader, Accept: 'application/json' } }
      ),
      fetch(
        `https://intervals.icu/api/v1/activity/${encodeURIComponent(activityId)}/segments`,
        { headers: { Authorization: authHeader, Accept: 'application/json' } }
      ),
    ]);

    const streamMap: Record<string, number[]> = {};
    let downsampledLatLng: [number, number][] | undefined;
    let rawStreamsList: { type: string; data: number[]; data2?: number[] }[] = [];
    if (streamsResp.ok) {
      const rawStreams = (await streamsResp.json()) as {
        type: string;
        data: number[];
        data2?: number[];
      }[];
      if (Array.isArray(rawStreams)) {
        rawStreamsList = rawStreams;
        const timeEntry = rawStreams.find((s) => s && s.type === 'time' && Array.isArray(s.data));
        const baseLen = timeEntry?.data?.length || rawStreams[0]?.data?.length || 1;
        const step = Math.max(1, Math.floor(baseLen / 500));

        for (const s of rawStreams) {
          if (!s || !s.type || !Array.isArray(s.data)) continue;
          if (s.type === 'latlng' && Array.isArray(s.data2)) {
            const latArr = s.data;
            const lngArr = s.data2;
            const paired: [number, number][] = [];
            for (let idx = 0; idx < latArr.length; idx += step) {
              const lat = latArr[idx];
              const lng = lngArr[idx];
              if (
                lat != null &&
                lng != null &&
                !Number.isNaN(lat) &&
                !Number.isNaN(lng) &&
                Math.abs(lat) > 0.01
              ) {
                paired.push([Number(lat.toFixed(5)), Number(lng.toFixed(5))]);
              } else if (paired.length > 0) {
                paired.push(paired[paired.length - 1]);
              }
            }
            if (paired.length > 2) {
              downsampledLatLng = paired;
              const routesCache = loadJsonFile<Record<string, [number, number][]>>(
                ROUTES_BY_ACTIVITY_CACHE_FILE,
                {}
              );
              const compactStep = Math.max(1, Math.floor(paired.length / 160));
              routesCache[String(activityId)] = paired.filter((_, i) => i % compactStep === 0);
              saveJsonFile(ROUTES_BY_ACTIVITY_CACHE_FILE, routesCache);
            }
          } else {
            streamMap[s.type] = s.data.filter((_, idx) => idx % step === 0);
          }
        }
      }
    }

    let intervals: ActivityInterval[] = [];
    let detailJson: RawIntervalsActivity = {};
    if (detailResp.ok) {
      detailJson = (await detailResp.json()) as RawIntervalsActivity;
      if (Array.isArray(detailJson.icu_intervals)) {
        intervals = detailJson.icu_intervals.map((iv, idx: number) => {
          const dist = Number(iv.distance || 0);
          const dur = Number(iv.moving_time || iv.elapsed_time || 0);
          const avgSpeed = Number(iv.average_speed || 0);
          const gapSpeed = Number(iv.gap || avgSpeed);
          return {
            id: String(iv.id || `iv-${idx}`),
            type: iv.type === 'WORK' ? 'WORK' : 'RECOVERY',
            label:
              iv.label ||
              iv.group_id ||
              (iv.type === 'WORK' ? `Work Interval #${idx + 1}` : `Recovery #${idx + 1}`),
            startTimeSecs: Number(iv.start_time || 0),
            durationSecs: dur,
            distanceMeters: Math.round(dist),
            avgWatts: iv.average_watts ? Math.round(Number(iv.average_watts)) : undefined,
            weightedAvgWatts: iv.weighted_average_watts
              ? Math.round(Number(iv.weighted_average_watts))
              : undefined,
            intensityPct: iv.intensity ? Math.round(Number(iv.intensity)) : undefined,
            zone: iv.zone ? Number(iv.zone) : undefined,
            avgHr: iv.average_heartrate ? Math.round(Number(iv.average_heartrate)) : undefined,
            maxHr: iv.max_heartrate ? Math.round(Number(iv.max_heartrate)) : undefined,
            avgPaceSecsPerKm: avgSpeed > 0 ? Math.round(1000 / avgSpeed) : undefined,
            gapPaceSecsPerKm: gapSpeed > 0 ? Math.round(1000 / gapSpeed) : undefined,
            avgCadence: iv.average_cadence ? Math.round(Number(iv.average_cadence)) : undefined,
            decouplingPct:
              iv.decoupling != null ? Number(Number(iv.decoupling).toFixed(1)) : undefined,
            strideLengthMeters: iv.average_stride
              ? Number(Number(iv.average_stride).toFixed(2))
              : undefined,
          };
        });
      }
    }

    let segmentEfforts: StravaSegmentEffort[] = [];
    if (segmentsResp.ok) {
      const rawSegments =
        (await segmentsResp.json()) as Parameters<typeof computeIntervalsSegmentEfforts>[0];
      const rawType = String(detailJson.type || '');
      const sportCategory = /run|trailrun|virtualrun|treadmill/i.test(rawType)
        ? 'Running'
        : 'Cycling';
      segmentEfforts = computeIntervalsSegmentEfforts(rawSegments, rawStreamsList, {
        id: String(activityId),
        name: String(detailJson.name || rawType || sportCategory),
        startDateLocal: String(detailJson.start_date_local || ''),
        sportCategory,
        avgHr: detailJson.average_heartrate
          ? Math.round(Number(detailJson.average_heartrate))
          : undefined,
      });
      if (segmentEfforts.length > 0) {
        const segmentsCache = loadJsonFile<Record<string, StravaSegmentEffort[]>>(
          SEGMENTS_BY_ACTIVITY_CACHE_FILE,
          {}
        );
        segmentsCache[String(activityId)] = segmentEfforts;
        saveJsonFile(SEGMENTS_BY_ACTIVITY_CACHE_FILE, segmentsCache);
      }
    }

    res.json({
      streams: {
        time: streamMap.time || [],
        distance: streamMap.distance,
        latlng: downsampledLatLng,
        watts: streamMap.watts,
        heartrate: streamMap.heartrate,
        velocitySmooth: streamMap.velocity_smooth,
        cadence: streamMap.cadence,
        altitude: streamMap.altitude,
      },
      intervals,
      segmentEfforts,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load activity streams and intervals',
    });
  }
});
