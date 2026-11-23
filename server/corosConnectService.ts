import type { Request } from 'express';
import {
  STRAVA_LOAD_MODEL_VERSION,
  classifyMultiSportActivity,
  computeStravaActivityLoadV2,
} from '../src/physiology/stravaLoadCalibration.ts';
import {
  normalizeActivityTimestamps,
  parseClientTzOffsetMins,
} from '../src/utils/activityTimestamp.ts';
import { parseStructuredTrackWorkout } from '../src/utils/workoutParser.ts';
import type { UnifiedActivity } from '../src/types.ts';
import {
  getScopedRuntimeStore,
  requestContext,
  saveSessionCacheAsync,
} from './sessionContext.ts';

export const COROS_API_BASE = (process.env.COROS_API_BASE || 'https://open.coros.com').replace(/\/+$/, '');

export interface CorosRawWorkout {
  labelId?: string | number;
  workoutId?: string | number;
  id?: string | number;
  name?: string;
  title?: string;
  mode?: number | string;
  subMode?: number | string;
  sportType?: string | number;
  startTime?: number | string;
  startDateLocal?: string;
  startDateUtc?: string;
  endTime?: number | string;
  duration?: number;
  totalTime?: number;
  movingTimeSecs?: number;
  distance?: number;
  distanceMeters?: number;
  avgHr?: number;
  maxHr?: number;
  avgPower?: number;
  normalizedPower?: number;
  avgCadence?: number;
  elevationGain?: number;
  ascent?: number;
  calories?: number;
  trainingLoad?: number;
  tl?: number;
  deviceName?: string;
  device?: string;
  timezone?: number | string;
}

export interface CorosWorkoutStageDto {
  stageOrder: number;
  stageType: 'warmup' | 'work' | 'recovery' | 'cooldown' | 'repeat';
  label: string;
  targetType: 'time' | 'distance';
  targetValue: number;
  intensityType: 'pace' | 'power' | 'hr' | 'none';
  intensityLow?: number;
  intensityHigh?: number;
  repeatCount?: number;
  childStages?: CorosWorkoutStageDto[];
}

export interface CorosWorkoutPayload {
  name: string;
  sportType: number; // 100 = Run, 103 = Track Run, 200 = Cycling
  subSportType: string;
  planDate: string; // YYYY-MM-DD
  description: string;
  estimatedDurationSecs: number;
  estimatedDistanceMeters: number;
  stages: CorosWorkoutStageDto[];
}

export interface CorosWorkoutPushInput {
  date: string;
  name: string;
  sportCategory: string;
  description?: string;
  workoutSyntax?: string;
  ftpWatts?: number;
  lthrBpm?: number;
  thresholdPaceSecsPerKm?: number;
  steps?: Array<{
    label?: string;
    durationSecs?: number;
    distanceMeters?: number;
    targetPctFtp?: number;
    targetWatts?: number;
    targetMinWatts?: number;
    targetMaxWatts?: number;
    targetPaceSecsPerKm?: number;
    hrCeilingBpm?: number;
    stepType?: 'warmup' | 'interval' | 'recovery' | 'rest' | 'cooldown';
  }>;
}

export interface CorosWorkoutPushResult {
  pushed: boolean;
  workoutId?: string | number;
  message: string;
}

export function getEffectiveCorosClientConfig(req?: Request): {
  clientId: string;
  clientSecret: string;
} {
  const activeReq = req ?? requestContext.getStore();
  const headerClientId = String(activeReq?.headers['x-coros-client-id'] || '').trim();
  const headerClientSecret = String(activeReq?.headers['x-coros-client-secret'] || '').trim();
  const clientId = (headerClientId || process.env.COROS_CLIENT_ID || '').trim();
  const clientSecret = (headerClientSecret || process.env.COROS_CLIENT_SECRET || '').trim();
  return { clientId, clientSecret };
}

export function getEffectiveCorosTokens(req?: Request): {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  athleteId: string;
  athleteName: string;
} {
  const activeReq = req ?? requestContext.getStore();
  const store = getScopedRuntimeStore(activeReq);
  const headerToken = String(activeReq?.headers['x-coros-access-token'] || '').trim();
  const accessToken = (headerToken || store.corosAccessToken || '').trim();
  const refreshToken = (store.corosRefreshToken || '').trim();
  const expiresAt = store.corosExpiresAt || 0;
  const athleteId = store.corosAthleteId || '';
  const athleteName = store.corosAthleteName || '';
  return { accessToken, refreshToken, expiresAt, athleteId, athleteName };
}

export async function ensureValidCorosAccessToken(
  req?: Request,
  forceRefresh = false
): Promise<string> {
  const activeReq = req ?? requestContext.getStore();
  const store = getScopedRuntimeStore(activeReq);
  const { clientId, clientSecret } = getEffectiveCorosClientConfig(activeReq);
  const { accessToken, refreshToken, expiresAt } = getEffectiveCorosTokens(activeReq);

  if (!accessToken && !refreshToken) {
    return '';
  }

  const nowSecs = Math.floor(Date.now() / 1000);
  const needsRefresh =
    forceRefresh || !accessToken || (expiresAt > 0 && nowSecs >= expiresAt - 300);

  if (needsRefresh && clientId && clientSecret && refreshToken) {
    try {
      const resp = await fetch(`${COROS_API_BASE}/oauth2/accesstoken`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }).toString(),
      });

      if (resp.ok) {
        const raw = (await resp.json()) as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
          data?: {
            access_token?: string;
            refresh_token?: string;
            expires_in?: number;
          };
        };
        const tokenPayload = raw.data || raw;
        if (tokenPayload.access_token) {
          store.corosAccessToken = tokenPayload.access_token;
          if (tokenPayload.refresh_token) store.corosRefreshToken = tokenPayload.refresh_token;
          if (tokenPayload.expires_in) {
            store.corosExpiresAt = Math.floor(Date.now() / 1000) + Number(tokenPayload.expires_in);
          }
          if (activeReq) {
            activeReq.headers['x-coros-access-token'] = tokenPayload.access_token;
          }
          await saveSessionCacheAsync(activeReq);
          return tokenPayload.access_token;
        }
      }
    } catch {
      // non-fatal; fall back to existing token
    }
  }

  return accessToken;
}

function mapCorosSportText(raw: CorosRawWorkout): {
  rawSportType: string;
  isIndoorHint: boolean;
} {
  const modeNum = Number(raw.mode);
  const subModeNum = Number(raw.subMode);
  if (modeNum === 100) {
    if (subModeNum === 2) return { rawSportType: 'trail_running', isIndoorHint: false };
    if (subModeNum === 3) return { rawSportType: 'track_running', isIndoorHint: false };
    if (subModeNum === 1) return { rawSportType: 'treadmill', isIndoorHint: true };
    return { rawSportType: 'running', isIndoorHint: false };
  }
  if (modeNum === 101) return { rawSportType: 'treadmill', isIndoorHint: true };
  if (modeNum === 102) return { rawSportType: 'trail_running', isIndoorHint: false };
  if (modeNum === 103) return { rawSportType: 'track_running', isIndoorHint: false };
  if (modeNum === 200) return { rawSportType: 'cycling', isIndoorHint: false };
  if (modeNum === 201) return { rawSportType: 'indoor_cycling', isIndoorHint: true };
  if (modeNum === 300) return { rawSportType: 'pool_swimming', isIndoorHint: true };
  if (modeNum === 301) return { rawSportType: 'open_water_swimming', isIndoorHint: false };
  if (modeNum === 400) return { rawSportType: 'strength_training', isIndoorHint: true };

  const text = String(raw.sportType || raw.mode || raw.name || raw.title || 'running').trim();
  const lower = text.toLowerCase();
  return {
    rawSportType: text,
    isIndoorHint: /indoor|treadmill|trainer|pool|strength|gym/i.test(lower),
  };
}

/**
 * Normalizes a COROS Open API workout record into a MeetReady `UnifiedActivity`
 * with `sourceBadges: ['COROS']` for clean-room provenance and ±5m deduplication.
 */
export function normalizeCorosWorkout(
  raw: CorosRawWorkout,
  opts: {
    thresholdPaceSecsPerKm?: number;
    ftpWatts?: number;
    lthrBpm?: number;
    restingHr?: number;
    clientTzOffsetMins?: number;
  } = {}
): UnifiedActivity {
  const rawId = String(raw.labelId ?? raw.workoutId ?? raw.id ?? Date.now());
  const { rawSportType, isIndoorHint } = mapCorosSportText(raw);
  const name = String(raw.name || raw.title || 'COROS Workout').trim();

  const classified = classifyMultiSportActivity(rawSportType, name, {
    trainer: isIndoorHint,
    hasGps: !isIndoorHint,
  });

  const movingTimeSecs = Math.max(
    1,
    Math.round(Number(raw.movingTimeSecs ?? raw.totalTime ?? raw.duration ?? 0))
  );
  const distanceMeters = Math.max(0, Math.round(Number(raw.distanceMeters ?? raw.distance ?? 0)));
  const elevationGainMeters = Math.max(
    0,
    Math.round(Number(raw.elevationGain ?? raw.ascent ?? 0))
  );
  const avgHr = Math.max(0, Math.round(Number(raw.avgHr ?? 0)));
  const maxHr = Math.max(avgHr, Math.round(Number(raw.maxHr ?? 0)));
  const avgPower = Number(raw.avgPower) > 0 ? Math.round(Number(raw.avgPower)) : undefined;
  const normalizedPower =
    Number(raw.normalizedPower) > 0 ? Math.round(Number(raw.normalizedPower)) : avgPower;
  const avgCadence = Number(raw.avgCadence) > 0 ? Math.round(Number(raw.avgCadence)) : undefined;

  const avgPaceSecsPerKm =
    classified.sportCategory === 'Running' && distanceMeters > 0 && movingTimeSecs > 0
      ? Math.round((movingTimeSecs / distanceMeters) * 1000)
      : undefined;

  const hasRealPower = classified.sportCategory === 'Cycling' && Boolean(normalizedPower && normalizedPower > 0);
  const loadRes = computeStravaActivityLoadV2({
    sportCategory: classified.sportCategory,
    rawSportType,
    name,
    environment: classified.environment,
    movingTimeSecs,
    distanceMeters,
    elevationGainMeters,
    normalizedPower,
    avgPower,
    hasRealDeviceWatts: hasRealPower,
    avgHr,
    maxHr,
    avgPaceSecsPerKm,
    calibratedFtp: Math.max(120, Number(opts.ftpWatts || 250)),
    calibratedBikeLthr: Math.max(135, Number(opts.lthrBpm || 163)),
    calibratedRunLthr: Math.max(140, Number(opts.lthrBpm || 168)),
    calibratedThresholdPaceSecsPerKm: Math.max(120, Number(opts.thresholdPaceSecsPerKm || 245)),
    restingHr: Math.max(38, Math.min(78, Number(opts.restingHr || 52))),
  });

  const explicitCorosLoad = Number(raw.trainingLoad ?? raw.tl ?? 0);
  const trainingLoad =
    loadRes.trainingLoad > 0 ? loadRes.trainingLoad : Math.max(1, Math.round(explicitCorosLoad));

  let efficiencyFactor = 0;
  if (hasRealPower && normalizedPower && avgHr > 0) {
    efficiencyFactor = Number((normalizedPower / avgHr).toFixed(2));
  } else if (classified.sportCategory === 'Running' && distanceMeters > 0 && avgHr > 0) {
    const speedMPerMin = distanceMeters / (movingTimeSecs / 60);
    efficiencyFactor = Number((speedMPerMin / avgHr).toFixed(2));
  }

  let startDateUtc: string | undefined = raw.startDateUtc;
  let startDateLocal: string | undefined = raw.startDateLocal;
  if (!startDateUtc && raw.startTime !== undefined) {
    if (typeof raw.startTime === 'number' && Number.isFinite(raw.startTime)) {
      const ms = raw.startTime > 1e12 ? raw.startTime : raw.startTime * 1000;
      startDateUtc = new Date(ms).toISOString();
    } else if (typeof raw.startTime === 'string' && raw.startTime.trim()) {
      const num = Number(raw.startTime);
      if (Number.isFinite(num) && num > 1e8) {
        startDateUtc = new Date(num > 1e12 ? num : num * 1000).toISOString();
      } else {
        startDateLocal = raw.startTime.trim();
      }
    }
  }

  const parsedOffset =
    typeof raw.timezone === 'number' && Number.isFinite(raw.timezone)
      ? Math.round(raw.timezone * (Math.abs(raw.timezone) <= 14 ? 60 : 1))
      : parseClientTzOffsetMins(raw.timezone) ?? opts.clientTzOffsetMins;

  const timestamps = normalizeActivityTimestamps({
    startDateLocal,
    startDateUtc,
    timeZoneOffsetMins: parsedOffset,
    fallbackBrowserTz: true,
  });

  return {
    id: `coros-${rawId}`,
    corosId: rawId,
    startDateLocal: timestamps.startDateLocal,
    ...(timestamps.startDateUtcMs !== undefined
      ? { startDateUtcMs: timestamps.startDateUtcMs }
      : {}),
    name,
    sportCategory: classified.sportCategory,
    rawSportType,
    environment: classified.environment,
    subType: classified.subType,
    movingTimeSecs,
    distanceMeters,
    elevationGainMeters,
    avgPower,
    normalizedPower,
    deviceWatts: classified.sportCategory === 'Cycling' ? hasRealPower : undefined,
    intensityFactor: loadRes.intensityFactor,
    trainingLoad,
    loadModelVersion: STRAVA_LOAD_MODEL_VERSION,
    avgHr,
    maxHr,
    avgCadence,
    avgPaceSecsPerKm,
    gapPaceSecsPerKm: avgPaceSecsPerKm,
    aerobicDecouplingPct: 0,
    efficiencyFactor,
    firstHalfEf: 0,
    secondHalfEf: 0,
    calories: raw.calories != null ? Math.round(Number(raw.calories)) : undefined,
    deviceName: raw.deviceName || raw.device || 'COROS Watch',
    zoneSecs: { hr: [0, 0, 0, 0, 0, 0, 0] },
    segmentEfforts: [],
    stravaPrCount: 0,
    sourceBadges: ['COROS'],
  };
}

function buildCorosSingleStage(opts: {
  stageOrder: number;
  label: string;
  stageType: 'warmup' | 'work' | 'recovery' | 'cooldown';
  durationSecs: number;
  distanceMeters?: number;
  isRunning: boolean;
  targetPctFtp?: number;
  targetWatts?: number;
  targetMinWatts?: number;
  targetMaxWatts?: number;
  targetPaceSecsPerKm?: number;
  ftpWatts: number;
  thresholdPaceSecsPerKm: number;
  hrCeilingBpm?: number;
}): CorosWorkoutStageDto {
  const {
    stageOrder,
    label,
    stageType,
    durationSecs,
    distanceMeters,
    isRunning,
    targetPctFtp = 75,
    targetWatts,
    targetMinWatts,
    targetMaxWatts,
    targetPaceSecsPerKm,
    ftpWatts,
    thresholdPaceSecsPerKm,
    hrCeilingBpm,
  } = opts;
  const hasDistance = typeof distanceMeters === 'number' && distanceMeters > 0;
  const targetType = hasDistance ? 'distance' : 'time';
  const targetValue = hasDistance ? Math.round(distanceMeters) : Math.max(5, Math.round(durationSecs));

  if (stageType === 'recovery') {
    return {
      stageOrder,
      stageType,
      label,
      targetType,
      targetValue,
      intensityType: hrCeilingBpm ? 'hr' : 'none',
      ...(hrCeilingBpm ? { intensityLow: Math.max(90, hrCeilingBpm - 20), intensityHigh: hrCeilingBpm } : {}),
    };
  }

  if (isRunning) {
    const resolvedPace =
      targetPaceSecsPerKm && targetPaceSecsPerKm > 60
        ? targetPaceSecsPerKm
        : Math.round(thresholdPaceSecsPerKm / Math.max(0.4, targetPctFtp / 100));
    return {
      stageOrder,
      stageType,
      label,
      targetType,
      targetValue,
      intensityType: 'pace',
      intensityLow: Math.round(resolvedPace * 0.98),
      intensityHigh: Math.round(resolvedPace * 1.02),
    };
  }

  const centerWatts =
    Number(targetWatts) > 0
      ? Math.round(Number(targetWatts))
      : Math.round((targetPctFtp / 100) * ftpWatts);
  return {
    stageOrder,
    stageType,
    label,
    targetType,
    targetValue,
    intensityType: 'power',
    intensityLow:
      Number(targetMinWatts) > 0 ? Math.round(Number(targetMinWatts)) : Math.max(40, Math.round(centerWatts * 0.96)),
    intensityHigh:
      Number(targetMaxWatts) > 0 ? Math.round(Number(targetMaxWatts)) : Math.round(centerWatts * 1.04),
  };
}

/**
 * Builds an Official COROS Open API structured workout JSON payload, preserving
 * track repeat blocks, distances, warmups, cooldowns, and pace/power targets.
 */
export function buildCorosWorkoutPayload(input: CorosWorkoutPushInput): CorosWorkoutPayload {
  const isRunning = String(input.sportCategory).toLowerCase().includes('run');
  const ftpWatts = Math.max(100, Number(input.ftpWatts || 250));
  const thresholdPace = Math.max(95, Number(input.thresholdPaceSecsPerKm || 245));
  const syntax = String(input.workoutSyntax || '').trim();
  const astNodes = syntax ? parseStructuredTrackWorkout(syntax, thresholdPace) : [];

  let estimatedDurationSecs = 0;
  let estimatedDistanceMeters = 0;
  let hasTrackDistance = false;
  let stages: CorosWorkoutStageDto[] = [];

  const mapKind = (kind?: string): 'warmup' | 'work' | 'recovery' | 'cooldown' => {
    if (kind === 'warmup') return 'warmup';
    if (kind === 'cooldown') return 'cooldown';
    if (kind === 'rest' || kind === 'recovery') return 'recovery';
    return 'work';
  };

  if (astNodes.length > 0) {
    stages = astNodes.map((node, idx) => {
      if (node.type === 'step') {
        const s = node.step;
        const durSecs = Math.max(5, Math.round(s.durationSecs || s.durationMins * 60 || 60));
        estimatedDurationSecs += durSecs;
        if (s.distanceMeters) {
          estimatedDistanceMeters += Math.round(s.distanceMeters);
          hasTrackDistance = true;
        }
        return buildCorosSingleStage({
          stageOrder: idx + 1,
          label: s.label,
          stageType: mapKind(s.stepKind),
          durationSecs: durSecs,
          distanceMeters: s.distanceMeters,
          isRunning,
          targetPctFtp: s.intensityPct || 75,
          targetPaceSecsPerKm: s.targetPaceSecsPerKm,
          ftpWatts,
          thresholdPaceSecsPerKm: thresholdPace,
        });
      }

      const childStages = node.steps.map((inner, innerIdx) => {
        const durSecs = Math.max(5, Math.round(inner.durationSecs || inner.durationMins * 60 || 60));
        estimatedDurationSecs += durSecs * node.repeatCount;
        if (inner.distanceMeters) {
          estimatedDistanceMeters += Math.round(inner.distanceMeters) * node.repeatCount;
          hasTrackDistance = true;
        }
        return buildCorosSingleStage({
          stageOrder: innerIdx + 1,
          label: inner.label,
          stageType: mapKind(inner.stepKind),
          durationSecs: durSecs,
          distanceMeters: inner.distanceMeters,
          isRunning,
          targetPctFtp: inner.intensityPct || 75,
          targetPaceSecsPerKm: inner.targetPaceSecsPerKm,
          ftpWatts,
          thresholdPaceSecsPerKm: thresholdPace,
        });
      });

      return {
        stageOrder: idx + 1,
        stageType: 'repeat',
        label: node.label,
        targetType: 'time',
        targetValue: node.repeatCount,
        intensityType: 'none',
        repeatCount: node.repeatCount,
        childStages,
      };
    });
  } else {
    const rawSteps =
      Array.isArray(input.steps) && input.steps.length > 0
        ? input.steps
        : [{ label: input.name || 'Main Set', durationSecs: 1800, targetPctFtp: 75, stepType: 'interval' as const }];
    const total = rawSteps.length;
    stages = rawSteps.map((s, idx) => {
      const pct = Number(s.targetPctFtp || 75);
      const inferredKind =
        s.stepType
          ? mapKind(s.stepType)
          : idx === 0 && total > 1
            ? 'warmup'
            : idx === total - 1 && total > 1
              ? 'cooldown'
              : pct <= 60
                ? 'recovery'
                : 'work';
      const durSecs = Math.max(5, Math.round(s.durationSecs || 60));
      estimatedDurationSecs += durSecs;
      if (s.distanceMeters) {
        estimatedDistanceMeters += Math.round(s.distanceMeters);
        hasTrackDistance = true;
      }
      return buildCorosSingleStage({
        stageOrder: idx + 1,
        label: String(s.label || `Step ${idx + 1}`),
        stageType: inferredKind,
        durationSecs: durSecs,
        distanceMeters: s.distanceMeters,
        isRunning,
        targetPctFtp: pct,
        targetWatts: s.targetWatts,
        targetMinWatts: s.targetMinWatts,
        targetMaxWatts: s.targetMaxWatts,
        targetPaceSecsPerKm: s.targetPaceSecsPerKm,
        ftpWatts,
        thresholdPaceSecsPerKm: thresholdPace,
        hrCeilingBpm: s.hrCeilingBpm,
      });
    });
  }

  return {
    name: input.name.slice(0, 64),
    sportType: isRunning ? (hasTrackDistance ? 103 : 100) : 200,
    subSportType: isRunning ? (hasTrackDistance ? 'TrackRun' : 'Run') : 'Cycling',
    planDate: input.date.slice(0, 10),
    description: (input.description || 'Prescribed by MeetReady').slice(0, 500),
    estimatedDurationSecs,
    estimatedDistanceMeters,
    stages,
  };
}

/**
 * Pushes a structured workout to the athlete's COROS Training Calendar via COROS Open API.
 */
export async function pushWorkoutToCorosConnect(opts: {
  accessToken: string;
  openId?: string;
  input: CorosWorkoutPushInput;
}): Promise<CorosWorkoutPushResult> {
  const payload = buildCorosWorkoutPayload(opts.input);
  const resp = await fetch(`${COROS_API_BASE}/v2/coros/workout/create`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      ...(opts.openId ? { openId: opts.openId } : {}),
      ...payload,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`COROS workout push failed (${resp.status}): ${errText.slice(0, 180)}`);
  }

  const parsed = (await resp.json().catch(() => ({}))) as {
    result?: string;
    message?: string;
    workoutId?: string | number;
    id?: string | number;
    data?: { workoutId?: string | number; id?: string | number };
  };
  if (parsed.result && parsed.result !== '0000' && parsed.result !== '0') {
    throw new Error(`COROS API error (${parsed.result}): ${parsed.message || 'Unknown error'}`);
  }

  const workoutId = parsed.data?.workoutId ?? parsed.data?.id ?? parsed.workoutId ?? parsed.id;
  return {
    pushed: true,
    workoutId,
    message: `Pushed "${opts.input.name}" directly to your COROS Training Calendar (${payload.planDate}).`,
  };
}
