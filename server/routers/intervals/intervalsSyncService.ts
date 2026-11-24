import {
  runtimeStore,
  saveSessionCache,
  loadJsonFile,
  getScopedPlannedEventsFile,
  ROUTES_BY_ACTIVITY_CACHE_FILE,
  SEGMENTS_BY_ACTIVITY_CACHE_FILE,
  STRAVA_KUDOS_CACHE_FILE,
} from '../../sessionContext.ts';
import {
  buildServerAthleteProfile,
  parseWorkoutSyntaxToSteps,
  type ServerLatestWellnessInput,
} from '../../physiologyEngine.ts';
import type {
  RawStravaActivity,
  StravaCachedSocialEntry,
} from '../../stravaSyncService.ts';
import type {
  ActivityInterval,
  PlannedWorkoutEvent,
  StravaSegmentEffort,
} from '../../../src/types.ts';
import {
  normalizeActivityTimestamps,
  stripTimezoneSuffix,
} from '../../../src/utils/activityTimestamp.ts';
import { classifyMultiSportActivity } from '../../../src/physiology/stravaLoadCalibration.ts';
import {
  getIntervalsAuthHeader,
  type NormalizedIntervalsSyncActivity,
  type RawIntervalsActivity,
  type RawIntervalsAthleteProfile,
  type RawIntervalsPlannedEvent,
  type RawIntervalsWellnessRow,
} from './intervalsAuthAndConfig.ts';

function rankSegmentEffortsAcrossActivities(activities: NormalizedIntervalsSyncActivity[]) {
  const bySegmentId = new Map<string, StravaSegmentEffort[]>();
  for (const act of activities) {
    if (!Array.isArray(act.segmentEfforts)) continue;
    for (const eff of act.segmentEfforts) {
      if (!eff || !eff.segmentId || !(eff.elapsedTimeSecs > 0)) continue;
      const sid = String(eff.segmentId);
      const list = bySegmentId.get(sid) || [];
      list.push(eff);
      bySegmentId.set(sid, list);
    }
  }

  for (const list of bySegmentId.values()) {
    list.sort((a, b) => a.elapsedTimeSecs - b.elapsedTimeSecs);
    list.forEach((eff, idx) => {
      if (idx === 0) eff.prRank = 1;
      else if (idx === 1) eff.prRank = 2;
      else if (idx === 2) eff.prRank = 3;
      else eff.prRank = null;
    });
  }

  for (const act of activities) {
    if (Array.isArray(act.segmentEfforts) && act.segmentEfforts.length > 0) {
      const prCount = act.segmentEfforts.filter((e) => e.prRank === 1).length;
      if (prCount > (act.stravaPrCount || 0)) {
        act.stravaPrCount = prCount;
      }
    }
  }
}

export async function syncIntervalsAllHistory(
  configOrKey: { apiKey?: string; accessToken?: string; athleteId?: string } | string,
  maybeAthleteId = '0',
  oldestActivitiesDate = '2010-01-01'
) {
  let authHeader: string;
  let athleteId: string;
  if (typeof configOrKey === 'string') {
    authHeader = 'Basic ' + Buffer.from(`API_KEY:${configOrKey}`).toString('base64');
    athleteId = maybeAthleteId || '0';
  } else {
    const header = getIntervalsAuthHeader(configOrKey);
    if (!header) {
      throw new Error(
        'Intervals.icu authentication header could not be constructed (missing API key or access token).'
      );
    }
    authHeader = header;
    athleteId = configOrKey.athleteId || maybeAthleteId || '0';
  }
  const now = new Date();
  const newest = new Date(now.getTime() + 86400 * 1000).toISOString().slice(0, 10);
  const futureEventsDate = new Date(now);
  futureEventsDate.setUTCDate(futureEventsDate.getUTCDate() + 90);
  const newestEvents = futureEventsDate.toISOString().slice(0, 10);
  const oldestEventsDate = new Date(now);
  oldestEventsDate.setUTCDate(oldestEventsDate.getUTCDate() - 180);
  const oldestEvents = oldestEventsDate.toISOString().slice(0, 10);

  const safeOldestActs = /^\d{4}-\d{2}-\d{2}$/.test(oldestActivitiesDate)
    ? oldestActivitiesDate
    : '2010-01-01';
  const isDeltaSync = safeOldestActs > '2020-01-01';
  const oldestWellness = isDeltaSync ? '2024-01-01' : '2018-01-01';

  // Fetch Activities, Wellness, Athlete Profile/Gear, and Calendar Events
  const [profileResp, wellnessResp, activitiesResp, eventsResp] = await Promise.all([
    fetch(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    }),
    fetch(
      `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/wellness?oldest=${oldestWellness}&newest=${newest}`,
      {
        headers: { Authorization: authHeader, Accept: 'application/json' },
      }
    ),
    fetch(
      `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/activities?oldest=${safeOldestActs}&newest=${newest}`,
      {
        headers: { Authorization: authHeader, Accept: 'application/json' },
      }
    ),
    fetch(
      `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/events?oldest=${oldestEvents}&newest=${newestEvents}`,
      {
        headers: { Authorization: authHeader, Accept: 'application/json' },
      }
    ),
  ]);

  if (!wellnessResp.ok || !activitiesResp.ok) {
    throw new Error(
      `Intervals.icu sync returned status wellness=${wellnessResp.status}, activities=${activitiesResp.status}`
    );
  }

  // Extract Athlete Profile, Sport Thresholds (FTP, LTHR, Max HR), and Real Bikes & Shoes
  let parsedRawProfile: RawIntervalsAthleteProfile | null = null;
  if (profileResp.ok) {
    const profile = (await profileResp.json()) as RawIntervalsAthleteProfile;
    parsedRawProfile = profile;
    runtimeStore.intervalsAthleteName =
      profile.name ||
      [profile.firstname, profile.lastname].filter(Boolean).join(' ') ||
      runtimeStore.intervalsAthleteName;

    if (Array.isArray(profile.sportSettings)) {
      const bikeSetting = profile.sportSettings.find(
        (s) => Array.isArray(s.types) && s.types.includes('Ride')
      );
      const runSetting = profile.sportSettings.find(
        (s) => Array.isArray(s.types) && s.types.includes('Run')
      );
      if (bikeSetting) {
        if (bikeSetting.ftp) runtimeStore.athleteFtp = Number(bikeSetting.ftp);
        if (bikeSetting.indoor_ftp) runtimeStore.athleteIndoorFtp = Number(bikeSetting.indoor_ftp);
        if (bikeSetting.lthr) runtimeStore.athleteLthr = Number(bikeSetting.lthr);
        if (bikeSetting.max_hr) runtimeStore.athleteMaxHr = Number(bikeSetting.max_hr);
      }
      if (runSetting && runSetting.ftp) {
        runtimeStore.athleteRunFtp = Number(runSetting.ftp);
      }
    }

    const bikes = Array.isArray(profile.bikes)
      ? profile.bikes.map((b) => ({
          id: String(b.id),
          name: String(b.name || 'Road Bike'),
          type: 'BIKE' as const,
          distanceMeters: Number(b.distance || 0),
          maxRecommendedMeters: 8046720, // 5,000 mi chain/service interval
          primary: Boolean(b.primary),
        }))
      : [];
    const shoes = Array.isArray(profile.shoes)
      ? profile.shoes.map((s) => ({
          id: String(s.id),
          name: String(s.name || 'Running Shoe'),
          type: 'SHOE' as const,
          distanceMeters: Number(s.distance || 0),
          maxRecommendedMeters: 724205, // 450 mi shoe retirement threshold
          primary: Boolean(s.primary),
        }))
      : [];
    if (bikes.length > 0 || shoes.length > 0) {
      runtimeStore.gearItems = [...bikes, ...shoes];
    }
  }

  const rawWellnessAll = (await wellnessResp.json()) as RawIntervalsWellnessRow[];
  const rawActivities = (await activitiesResp.json()) as RawIntervalsActivity[];
  const rawEvents = eventsResp.ok ? ((await eventsResp.json()) as RawIntervalsPlannedEvent[]) : [];

  // Filter out future empty wellness rows beyond today (or UTC tomorrow before morning sync)
  const rawWellness = rawWellnessAll.filter((w, i, a) => {
    const d = w?.id || w?.date;
    if (!d || d > newest) return false;
    if (i === a.length - 1 || d === newest) {
      const hasAnyTelemetry =
        w.sleepSecs != null || w.hrv != null || w.restingHR != null || w.steps != null;
      if (!hasAnyTelemetry && d >= newest) return false;
    }
    return true;
  });

  const redactedStravaCount = rawActivities.filter(
    (a) => a && a.source === 'STRAVA' && !a.type && a.moving_time == null
  ).length;

  // Normalize all-time Wellness + Garmin Sleep, HRV Corridor & 8-State Garmin Training Status
  let lastValidWeight =
    Number(parsedRawProfile?.icu_weight || parsedRawProfile?.weight || 0) > 30
      ? Number(Number(parsedRawProfile?.icu_weight || parsedRawProfile?.weight).toFixed(1))
      : 70.0;
  let lastValidVo2 = 50;
  let lastValidRhr =
    Number(parsedRawProfile?.icu_resting_hr || 0) > 25
      ? Math.round(Number(parsedRawProfile?.icu_resting_hr))
      : 49;

  const wellnessDays = rawWellness.map((w, idx, arr) => {
    const ctl = Number((w.ctl ?? 0).toFixed(1));
    const atl = Number((w.atl ?? 0).toFixed(1));
    const tsb = Number((ctl - atl).toFixed(1));
    const loadRatio = ctl > 5 ? Number((atl / ctl).toFixed(2)) : 1.0;
    const rampRate = Number((w.rampRate ?? 0).toFixed(1));

    const hrv = Math.round(w.hrv ?? w.hrvRMSSD ?? 0);
    // 7-day rolling HRV average
    const slice7 = arr
      .slice(Math.max(0, idx - 6), idx + 1)
      .map((item) => Number(item.hrv ?? item.hrvRMSSD ?? 0))
      .filter((v) => v > 0);
    const baseline7d =
      slice7.length > 0 ? slice7.reduce((a, b) => a + b, 0) / slice7.length : hrv;

    // 60-day normal baseline corridor (mean +/- 0.85 SD) matching Garmin HRV Status
    const slice60 = arr
      .slice(Math.max(0, idx - 59), idx + 1)
      .map((item) => Number(item.hrv ?? item.hrvRMSSD ?? 0))
      .filter((v) => v > 0);
    const mean60 =
      slice60.length > 0 ? slice60.reduce((a, b) => a + b, 0) / slice60.length : baseline7d || 52;
    const variance60 =
      slice60.length > 1
        ? slice60.reduce((acc, v) => acc + Math.pow(v - mean60, 2), 0) / slice60.length
        : 36;
    const sd60 = Math.max(4, Math.sqrt(variance60));
    const hrvNormalBandLow = Math.round(mean60 - 0.85 * sd60);
    const hrvNormalBandHigh = Math.round(mean60 + 0.85 * sd60);

    let hrvStatus: 'Balanced' | 'Unbalanced' | 'Low' = 'Balanced';
    const checkHrv = baseline7d || hrv;
    if (checkHrv > 0) {
      if (checkHrv < hrvNormalBandLow - 3 || (hrv > 0 && hrv < hrvNormalBandLow - 5)) {
        hrvStatus = 'Low';
      } else if (checkHrv < hrvNormalBandLow || checkHrv > hrvNormalBandHigh + 4) {
        hrvStatus = 'Unbalanced';
      }
    }

    if (w.restingHR && Number(w.restingHR) > 0) lastValidRhr = Math.round(Number(w.restingHR));
    if (w.weight && Number(w.weight) > 0) lastValidWeight = Number(Number(w.weight).toFixed(1));
    if (w.vo2max && Number(w.vo2max) > 0) lastValidVo2 = Number(w.vo2max);

    const sleepSecs = Number(w.sleepSecs ?? 0);
    const sleepScore = Number(
      w.sleepScore ?? (sleepSecs > 0 ? Math.min(98, Math.round((sleepSecs / 28800) * 85)) : 0)
    );
    const sleepQuality = w.sleepQuality != null ? Number(w.sleepQuality) : undefined;

    // 7-day rolling sleep debt vs 7.5h (27,000s) target
    const sleepSlice7 = arr
      .slice(Math.max(0, idx - 6), idx + 1)
      .map((item) => Number(item.sleepSecs ?? 0))
      .filter((s) => s > 0);
    const sleepDebt7dSecs =
      sleepSlice7.length > 0
        ? Math.max(
            0,
            Math.round(sleepSlice7.reduce((acc, s) => acc + Math.max(0, 27000 - s), 0))
          )
        : 0;

    // Extract eFTP & W' from sportInfo
    const rideSport = Array.isArray(w.sportInfo)
      ? w.sportInfo.find((s) => s.type === 'Ride')
      : undefined;
    const runSport = Array.isArray(w.sportInfo)
      ? w.sportInfo.find((s) => s.type === 'Run')
      : undefined;
    const rideEftp = rideSport?.eftp ? Math.round(Number(rideSport.eftp)) : undefined;
    const rideWPrime = rideSport?.wPrime ? Math.round(Number(rideSport.wPrime)) : undefined;
    const ridePMax = rideSport?.pMax ? Math.round(Number(rideSport.pMax)) : undefined;
    const runEftp = runSport?.eftp ? Math.round(Number(runSport.eftp)) : undefined;
    const runWPrime = runSport?.wPrime ? Math.round(Number(runSport.wPrime)) : undefined;
    const runPMax = runSport?.pMax ? Math.round(Number(runSport.pMax)) : undefined;

    // 28-day fitness / eFTP / VO2 trend for Garmin 8-State Training Status classification
    const prev28 = arr[Math.max(0, idx - 28)];
    const prevCtl = prev28 ? Number(prev28.ctl ?? ctl) : ctl;
    const ctlDelta28 = ctl - prevCtl;

    let garminTrainingStatus:
      | 'Peaking'
      | 'Productive'
      | 'Maintaining'
      | 'Recovery'
      | 'Unproductive'
      | 'Strained'
      | 'Overreaching'
      | 'Detraining' = 'Maintaining';
    let trainingStatusReason = 'Balanced acute-to-chronic workload and stable autonomic baseline.';

    if (loadRatio > 1.45 && (hrvStatus === 'Low' || tsb < -22)) {
      garminTrainingStatus = 'Overreaching';
      trainingStatusReason = `Very high acute load ratio (${loadRatio}x) with suppressed TSB (${tsb}) and HRV.`;
    } else if (hrvStatus === 'Low' && (sleepScore > 0 && sleepScore < 72 || tsb < -12)) {
      garminTrainingStatus = 'Strained';
      trainingStatusReason = `HRV (${hrv || Math.round(baseline7d)} ms) is below normal corridor (${hrvNormalBandLow}–${hrvNormalBandHigh} ms) with elevated fatigue.`;
    } else if (ctl > 45 && tsb >= 4 && tsb <= 20 && rampRate < 0 && hrvStatus === 'Balanced') {
      garminTrainingStatus = 'Peaking';
      trainingStatusReason = `High aerobic base (CTL ${ctl}) paired with fresh positive form (TSB +${tsb}) and balanced HRV.`;
    } else if (
      (rampRate >= 0.4 || ctlDelta28 >= 1.5 || (loadRatio >= 0.85 && loadRatio <= 1.3)) &&
      hrvStatus !== 'Low'
    ) {
      garminTrainingStatus = 'Productive';
      trainingStatusReason = `Optimal load ratio (${loadRatio}x) building aerobic fitness (CTL ${ctl}) with ${hrvStatus.toLowerCase()} HRV.`;
    } else if (loadRatio < 0.78 && tsb > 0 && ctlDelta28 >= -3) {
      garminTrainingStatus = 'Recovery';
      trainingStatusReason = `Reduced acute training load (${loadRatio}x) allowing supercompensation and freshness.`;
    } else if (rampRate < -3.5 && ctlDelta28 < -4 && loadRatio < 0.7) {
      garminTrainingStatus = 'Detraining';
      trainingStatusReason = `Sustained reduction in training load (Ramp ${rampRate}/wk) lowering chronic fitness.`;
    } else if (loadRatio > 1.15 && hrvStatus === 'Unbalanced') {
      garminTrainingStatus = 'Unproductive';
      trainingStatusReason = `High workload (${loadRatio}x) accompanied by unbalanced autonomic recovery.`;
    }

    let readinessStatus: 'Optimal' | 'Caution' | 'Strain' = 'Optimal';
    if (
      garminTrainingStatus === 'Strained' ||
      garminTrainingStatus === 'Overreaching' ||
      tsb < -18 ||
      hrvStatus === 'Low'
    ) {
      readinessStatus = 'Strain';
    } else if (
      garminTrainingStatus === 'Unproductive' ||
      tsb < -10 ||
      hrvStatus === 'Unbalanced' ||
      (sleepScore > 0 && sleepScore < 70)
    ) {
      readinessStatus = 'Caution';
    }

    return {
      date: w.id || w.date || newest,
      ctl,
      atl,
      tsb,
      loadRatio,
      rampRate,
      hrvRMSSD: hrv,
      hrvBaseline7d: Math.round(baseline7d),
      hrvNormalBandLow,
      hrvNormalBandHigh,
      hrvStatus,
      restingHR: w.restingHR ? Math.round(Number(w.restingHR)) : lastValidRhr,
      sleepSecs,
      sleepScore,
      sleepQuality,
      sleepDebt7dSecs,
      weightKg: w.weight ? Number(Number(w.weight).toFixed(1)) : lastValidWeight,
      vo2MaxCycling: w.vo2max ? Number(w.vo2max) : lastValidVo2,
      vo2MaxRunning: w.vo2max ? Number(w.vo2max) : lastValidVo2,
      spO2: w.spO2 ? Number(w.spO2) : undefined,
      respiration: w.respiration ? Number(w.respiration) : undefined,
      steps: w.steps != null ? Number(w.steps) : undefined,
      floorsClimbed: w.floorsClimbed != null ? Number(w.floorsClimbed) : undefined,
      soreness: w.soreness ?? undefined,
      rideEftp,
      rideWPrime,
      ridePMax,
      runEftp,
      runWPrime,
      runPMax,
      garminTrainingStatus,
      trainingStatusReason,
      readinessStatus,
      dailyLoad: Math.round(w.ctlLoad ?? w.atlLoad ?? 0),
    };
  });

  // Enrich & reconstruct Strava-originated Virtual Cycling / Trainer sessions from Strava cache or Intervals.icu daily wellness residual load
  const icuStravaAthleteId = String(parsedRawProfile?.strava_id || '').replace(/[^0-9]/g, '');
  const cachedStravaArchive = icuStravaAthleteId
    ? loadJsonFile<RawStravaActivity[]>(
        `/tmp/aeropulse-strava-archive-${icuStravaAthleteId}.json`,
        []
      )
    : [];
  const stravaArchiveById = new Map<string, RawStravaActivity>();
  for (const sa of cachedStravaArchive) {
    if (sa && sa.id) stravaArchiveById.set(String(sa.id), sa);
  }

  const garminStravaIds = new Set<string>();
  const knownGarminLoadByDate = new Map<string, number>();
  const stubsByDate = new Map<string, RawIntervalsActivity[]>();

  for (const a of rawActivities) {
    if (!a || !a.start_date_local) continue;
    const d = String(a.start_date_local).slice(0, 10);
    if (a.source !== 'STRAVA' && a.strava_id) {
      garminStravaIds.add(String(a.strava_id));
    }
    if (a.type || a.moving_time != null || a.elapsed_time != null) {
      knownGarminLoadByDate.set(
        d,
        (knownGarminLoadByDate.get(d) || 0) + Number(a.icu_training_load ?? 0)
      );
    } else if (a.source === 'STRAVA') {
      const list = stubsByDate.get(d) || [];
      list.push(a);
      stubsByDate.set(d, list);
    }
  }

  const enrichedRawActivities: RawIntervalsActivity[] = [];
  for (const a of rawActivities) {
    if (!a || !a.start_date_local) continue;
    if (a.source === 'STRAVA' && !a.type && a.moving_time == null && a.elapsed_time == null) {
      const sid = String(a.strava_id || a.id);
      if (garminStravaIds.has(sid)) continue;

      const cachedSa = stravaArchiveById.get(sid);
      if (cachedSa && (cachedSa.moving_time || cachedSa.elapsed_time)) {
        enrichedRawActivities.push({
          ...a,
          id: `strava-${sid}`,
          strava_id: sid,
          type: cachedSa.sport_type || cachedSa.type || 'Ride',
          name: cachedSa.name || 'Recorded Session',
          moving_time: cachedSa.moving_time || cachedSa.elapsed_time,
          elapsed_time: cachedSa.elapsed_time || cachedSa.moving_time,
          distance: cachedSa.distance ?? 0,
          total_elevation_gain: cachedSa.total_elevation_gain ?? 0,
          trainer: Boolean(cachedSa.trainer),
          average_watts: cachedSa.average_watts,
          icu_weighted_avg_watts: cachedSa.weighted_average_watts || cachedSa.average_watts,
          average_heartrate: cachedSa.average_heartrate,
          max_heartrate: cachedSa.max_heartrate,
          average_cadence: cachedSa.average_cadence,
          device_name: cachedSa.device_name || undefined,
        });
      }
      // Never synthesize fake Zwift workouts or fabricated watts/HR for redacted Intervals.icu stubs
      continue;
    }
    enrichedRawActivities.push(a);
  }

  // Normalize all-time Garmin / Intervals.icu / Reconstructed Virtual Cycling Activities
  const seenStravaIds = new Set<string>();
  const activities = enrichedRawActivities
    .filter((a) => {
      if (!a || !a.start_date_local) return false;
      if (!a.type && a.moving_time == null && a.elapsed_time == null) return false;
      if (a.source === 'STRAVA' && !a.name && a.moving_time == null) return false;
      const duration = Number(a.moving_time ?? a.elapsed_time ?? 0);
      if (duration <= 0) return false;
      if (a.strava_id) {
        const sid = String(a.strava_id);
        if (seenStravaIds.has(sid)) return false;
        seenStravaIds.add(sid);
      }
      return true;
    })
    .map((a): NormalizedIntervalsSyncActivity => {
      const rawType = String(a.type || '').trim();
      const rawSubType = String(a.sub_type || '').trim();
      const rawName = String(a.name || '').trim();
      const rawDevice = String(a.device_name || '').trim();
      const combinedMeta = `${rawType} ${rawSubType} ${rawName} ${rawDevice}`;

      const rawStartLatLng =
        Array.isArray(a.start_latlng) && a.start_latlng.length >= 2
          ? [Number(a.start_latlng[0]), Number(a.start_latlng[1])]
          : undefined;
      const isWatopiaOrMakuriGps =
        rawStartLatLng &&
        Number.isFinite(rawStartLatLng[0]) &&
        Number.isFinite(rawStartLatLng[1]) &&
        rawStartLatLng[0] >= -12.6 &&
        rawStartLatLng[0] <= -9.8 &&
        rawStartLatLng[1] >= 164.8 &&
        rawStartLatLng[1] <= 168.0;

      const hasNoLatLngStream =
        Array.isArray(a.stream_types) &&
        a.stream_types.length > 0 &&
        !a.stream_types.includes('latlng');

      const isVirtualPlatform =
        /virtual|zwift|watopia|makuri|neokyo|urukazi|alpe du zwift|ven-top|crit city|rouvy|mywhoosh|indievelo|trainingpeaks virtual|bkool|fulgaz|kinomap|rgt/i.test(
          combinedMeta
        ) || Boolean(isWatopiaOrMakuriGps);

      const classified = classifyMultiSportActivity(rawType || rawSubType, `${rawSubType} ${rawName}`, {
        trainer: Boolean(a.trainer) || isVirtualPlatform || /virtual|indoor|treadmill|zwift|trainer|spinning|peloton|wahoo|rouvy|mywhoosh|trainerroad|sufferfest|kickr|tacx|wattbike|stages|erg mode|ramp test|gym|weight|hiit|workout|yoga|pool/i.test(combinedMeta),
        hasGps: Boolean(rawStartLatLng) && !hasNoLatLngStream,
        isVirtualPlatform,
      });
      const sportCategory = classified.sportCategory;
      const isIndoor = classified.environment === 'INDOOR';
      const subType = classified.subType;

      const movingTimeSecs = Number(a.moving_time ?? a.elapsed_time ?? 0);
      const distanceMeters = Number(a.distance ?? 0);
      const avgPower = a.icu_average_watts ?? a.average_watts ?? undefined;
      const normalizedPower = a.icu_weighted_avg_watts ?? avgPower;
      const avgHr = Number(a.average_heartrate ?? 0);
      const maxHr = Number(a.max_heartrate ?? 0);
      const avgPaceSecsPerKm =
        sportCategory === 'Running' && distanceMeters > 0
          ? Math.round(movingTimeSecs / (distanceMeters / 1000))
          : undefined;
      const gapPaceSecsPerKm =
        sportCategory === 'Running' && a.gap && Number(a.gap) > 0
          ? Math.round(1000 / Number(a.gap))
          : undefined;

      const canUsePowerForIf =
        sportCategory === 'Cycling' ||
        (sportCategory === 'Running' && Number(runtimeStore.athleteRunFtp) > 0);
      const userFtp =
        sportCategory === 'Running'
          ? runtimeStore.athleteRunFtp || 350
          : runtimeStore.athleteFtp || 250;
      const rawIcuIf = Number(a.icu_intensity ?? 0);
      let trainingLoad = Math.round(Number(a.icu_training_load ?? 0));
      let intensityFactor: number | undefined =
        rawIcuIf > 0
          ? Number((rawIcuIf > 3 ? rawIcuIf / 100 : rawIcuIf).toFixed(2))
          : undefined;
      if (canUsePowerForIf && normalizedPower && movingTimeSecs > 0) {
        const ifVal = normalizedPower / userFtp;
        if (!intensityFactor) {
          intensityFactor = Number(ifVal.toFixed(2));
        }
        if (!trainingLoad) {
          trainingLoad = Math.round(
            ((movingTimeSecs * normalizedPower * ifVal) / (userFtp * 3600)) * 100
          );
        }
      } else if (avgHr > 0 && movingTimeSecs > 0) {
        const userLthr = runtimeStore.athleteLthr || 165;
        const hrRatio = Math.max(0.4, Math.min(1.25, avgHr / userLthr));
        if (!intensityFactor) {
          intensityFactor = Number(hrRatio.toFixed(2));
        }
        if (!trainingLoad) {
          trainingLoad = Math.round((movingTimeSecs / 3600) * Math.pow(hrRatio, 2) * 80);
        }
      } else if (!trainingLoad && movingTimeSecs > 0) {
        trainingLoad = Math.round((movingTimeSecs / 3600) * 45);
      }

      let efficiencyFactor = 0;
      if (sportCategory === 'Cycling' && normalizedPower && avgHr > 0) {
        efficiencyFactor = Number((normalizedPower / avgHr).toFixed(2));
      } else if (
        sportCategory === 'Running' &&
        distanceMeters > 0 &&
        movingTimeSecs > 0 &&
        avgHr > 0
      ) {
        const speedMetersPerMin = distanceMeters / (movingTimeSecs / 60);
        efficiencyFactor = Number((speedMetersPerMin / avgHr).toFixed(2));
      }

      const rawIntervals = Array.isArray(a.icu_intervals) ? a.icu_intervals : [];
      const intervals: ActivityInterval[] = rawIntervals.map((iv, idx: number) => {
        const dist = Number(iv.distance || 0);
        const dur = Number(iv.moving_time || iv.elapsed_time || 0);
        const avgSpeed = Number(iv.average_speed || 0);
        const gapSpeed = Number(iv.gap || avgSpeed);
        return {
          id: String(iv.id || `iv-${idx}`),
          type: iv.type === 'WORK' ? ('WORK' as const) : ('RECOVERY' as const),
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

      const hrZoneSecs = Array.isArray(a.icu_hr_zone_times)
        ? a.icu_hr_zone_times.slice(0, 7).map((v) => Math.max(0, Math.round(Number(v || 0))))
        : [0, 0, 0, 0, 0, 0, 0];
      const pwrZoneSecs = Array.isArray(a.icu_zone_times)
        ? a.icu_zone_times.slice(0, 7).map((v) => Math.max(0, Math.round(Number(v || 0))))
        : undefined;
      const intervalsSourceBadges = Array.from(
        new Set([
          'Intervals.icu',
          ...(a.source === 'GARMIN_CONNECT'
            ? ['Garmin']
            : a.source === 'STRAVA'
              ? ['Strava']
              : []),
        ])
      );

      const intervalsTimestamps = normalizeActivityTimestamps({
        startDateLocal: a.start_date_local
          ? stripTimezoneSuffix(String(a.start_date_local))
          : undefined,
        startDateUtc: a.start_date ? String(a.start_date) : undefined,
        startLatLng:
          Array.isArray(a.latlng) && a.latlng.length === 2
            ? [Number(a.latlng[0]), Number(a.latlng[1])]
            : undefined,
        fallbackBrowserTz: true,
      });

      return {
        id: String(a.id),
        intervalsId: String(a.id),
        intervalsActivityId: String(a.id),
        stravaId: a.strava_id ? String(a.strava_id) : undefined,
        garminActivityId: a.source === 'GARMIN_CONNECT' ? String(a.id) : undefined,
        source: a.source || 'INTERVALS_ICU',
        sourceBadges: intervalsSourceBadges,
        rawSportType: rawType || undefined,
        name: rawName || `${subType} ${sportCategory}`,
        startDateLocal: intervalsTimestamps.startDateLocal,
        ...(intervalsTimestamps.startDateUtcMs !== undefined
          ? { startDateUtcMs: intervalsTimestamps.startDateUtcMs }
          : {}),
        sportCategory,
        environment: isIndoor ? ('INDOOR' as const) : ('OUTDOOR' as const),
        subType,
        movingTimeSecs,
        distanceMeters,
        elevationGainMeters: Math.round(Number(a.total_elevation_gain ?? 0)),
        avgPower: avgPower ? Math.round(avgPower) : undefined,
        normalizedPower: normalizedPower ? Math.round(normalizedPower) : undefined,
        intensityFactor,
        trainingLoad,
        avgHr: avgHr > 0 ? Math.round(avgHr) : undefined,
        maxHr: maxHr > 0 ? Math.round(maxHr) : undefined,
        avgCadence: a.average_cadence ? Math.round(Number(a.average_cadence)) : undefined,
        avgPaceSecsPerKm,
        gapPaceSecsPerKm,
        efficiencyFactor,
        aerobicDecouplingPct:
          a.decoupling != null ? Number(Number(a.decoupling).toFixed(1)) : undefined,
        variabilityIndex:
          normalizedPower && avgPower && avgPower > 0
            ? Number((normalizedPower / avgPower).toFixed(2))
            : undefined,
        zoneSecs: {
          hr: hrZoneSecs,
          ...(pwrZoneSecs ? { power: pwrZoneSecs } : {}),
        },
        gearName: a.gear?.name || undefined,
        deviceName: a.device_name ? String(a.device_name) : undefined,
        hasSegments: Boolean(a.has_segments),
        intervals,
      };
    });

  // Attach cached Strava segment efforts & GPS routes
  const segmentsCache = loadJsonFile<Record<string, StravaSegmentEffort[]>>(
    SEGMENTS_BY_ACTIVITY_CACHE_FILE,
    {}
  );
  const routesCache = loadJsonFile<Record<string, [number, number][]>>(
    ROUTES_BY_ACTIVITY_CACHE_FILE,
    {}
  );
  const kudosCache = loadJsonFile<Record<string, StravaCachedSocialEntry>>(
    STRAVA_KUDOS_CACHE_FILE,
    {}
  );

  for (const act of activities) {
    if (Array.isArray(segmentsCache[act.id]) && segmentsCache[act.id].length > 0) {
      act.segmentEfforts = segmentsCache[act.id].map((eff) => ({ ...eff }));
    }
    const routePts = routesCache[act.id];
    if (Array.isArray(routePts) && routePts.length >= 2) {
      act.routeLatLngs = routePts;
      act.startLatLng = routePts[0];
      act.endLatLng = routePts[routePts.length - 1];
      const [firstLat, firstLng] = routePts[0];
      if (
        act.sportCategory === 'Cycling' &&
        firstLat >= -12.6 &&
        firstLat <= -9.8 &&
        firstLng >= 164.8 &&
        firstLng <= 168.0
      ) {
        act.environment = 'INDOOR';
        act.subType = 'Virtual Cycling';
      }
    }
    const kEntry = kudosCache[act.id] || (act.stravaId ? kudosCache[act.stravaId] : undefined);
    if (kEntry) {
      if (kEntry.kudosCount !== undefined) act.kudosCount = kEntry.kudosCount;
      if (kEntry.hasKudoed !== undefined) act.hasKudoed = kEntry.hasKudoed;
      if (Array.isArray(kEntry.kudoers)) act.kudoers = kEntry.kudoers;
      if (Array.isArray(kEntry.comments)) {
        act.comments = kEntry.comments;
        act.commentCount = kEntry.comments.length;
      }
    }
  }
  rankSegmentEffortsAcrossActivities(activities);

  // Merge user-created local planned workouts with Intervals.icu calendar events
  const cacheKey =
    typeof configOrKey === 'string'
      ? configOrKey
      : configOrKey.apiKey || configOrKey.accessToken || 'default';
  const scopedPlannedFile = getScopedPlannedEventsFile(undefined, cacheKey);
  const localPlanned = scopedPlannedFile
    ? loadJsonFile<PlannedWorkoutEvent[]>(scopedPlannedFile, [])
    : [];
  const icuPlanned = rawEvents
    .filter((ev) => ev && ev.start_date_local)
    .map((ev) => {
      const dur = Number(ev.moving_time ?? 3600);
      const desc = String(ev.description || '');
      return {
        id: `icu-ev-${ev.id}`,
        date: String(ev.start_date_local).slice(0, 10),
        name: String(ev.name || 'Planned Workout'),
        sportCategory: (/run/i.test(String(ev.type || '')) ? 'Running' : 'Cycling') as
          | 'Running'
          | 'Cycling',
        environmentPreference: (/indoor|virtual|trainer/i.test(String(ev.type || '') + desc)
          ? 'INDOOR'
          : 'FLEXIBLE') as 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE',
        description: desc || 'Structured workout synced from Intervals.icu calendar.',
        plannedLoad: Math.round(Number(ev.icu_training_load ?? 65)),
        plannedDurationSecs: dur,
        targetZoneSummary: 'Intervals.icu Calendar Event',
        workoutSyntax: desc,
        structuredSteps: parseWorkoutSyntaxToSteps(desc, dur),
        source: 'INTERVALS_ICU' as const,
      };
    });

  const plannedEvents = [...localPlanned, ...icuPlanned];

  const stravaLinkedCount = activities.filter((a) => Boolean(a.stravaId)).length;
  runtimeStore.garminActivitiesCount = activities.length;
  runtimeStore.redactedStravaCount = redactedStravaCount;
  if (runtimeStore.stravaActivitiesCount < stravaLinkedCount) {
    runtimeStore.stravaActivitiesCount = stravaLinkedCount;
  }
  runtimeStore.totalActivitiesCount = Math.max(
    activities.length,
    activities.length + Math.max(0, runtimeStore.stravaActivitiesCount - stravaLinkedCount)
  );
  runtimeStore.earliestActivityDate =
    activities.length > 0
      ? activities[activities.length - 1].startDateLocal.slice(0, 10)
      : runtimeStore.earliestActivityDate;
  const accumulatedWellnessSummary: ServerLatestWellnessInput = {};
  for (const w of wellnessDays) {
    if (w.weightKg && w.weightKg > 30 && w.weightKg !== 70) {
      accumulatedWellnessSummary.weightKg = w.weightKg;
    }
    if (w.restingHR && w.restingHR > 25 && w.restingHR !== 49) {
      accumulatedWellnessSummary.restingHR = w.restingHR;
    }
    if (w.vo2MaxCycling && w.vo2MaxCycling > 25 && w.vo2MaxCycling !== 50) {
      accumulatedWellnessSummary.vo2MaxCycling = w.vo2MaxCycling;
    }
    if (w.vo2MaxRunning && w.vo2MaxRunning > 25 && w.vo2MaxRunning !== 50) {
      accumulatedWellnessSummary.vo2MaxRunning = w.vo2MaxRunning;
    }
    if (w.rideEftp && w.rideEftp > 60) accumulatedWellnessSummary.rideEftp = w.rideEftp;
    if (w.rideWPrime && w.rideWPrime > 5000) accumulatedWellnessSummary.rideWPrime = w.rideWPrime;
    if (w.ridePMax && w.ridePMax > 300) accumulatedWellnessSummary.ridePMax = w.ridePMax;
    if (w.runEftp && w.runEftp > 80) accumulatedWellnessSummary.runEftp = w.runEftp;
  }
  const fullProfile = buildServerAthleteProfile(
    parsedRawProfile,
    accumulatedWellnessSummary,
    activities
  );
  runtimeStore.athleteProfile = fullProfile;
  runtimeStore.lastSyncedAt = new Date().toISOString();
  runtimeStore.nextHourlySyncAt = new Date(Date.now() + 3600 * 1000).toISOString();
  saveSessionCache();

  return {
    wellnessDays,
    activities,
    plannedEvents,
    redactedStravaCount,
    athleteProfile: {
      ...fullProfile,
      gearItems: runtimeStore.gearItems,
    },
    syncedAt: runtimeStore.lastSyncedAt,
    nextHourlySyncAt: runtimeStore.nextHourlySyncAt,
  };
}
