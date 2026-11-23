import crypto from 'crypto';
import { parseStructuredTrackWorkout } from '../src/utils/workoutParser.ts';

export const WAHOO_OAUTH_SCOPES = 'user_read workouts_read workouts_write plans_write';

export interface WahooWorkoutStepInput {
  label?: string;
  durationSecs?: number;
  distanceMeters?: number;
  targetPctFtp?: number;
  targetWatts?: number;
  targetMinWatts?: number;
  targetMaxWatts?: number;
  targetPaceSecsPerKm?: number;
  hrCeilingBpm?: number;
  stepType?: 'warmup' | 'interval' | 'recovery' | 'cooldown' | 'work' | 'rest';
}

export interface WahooWorkoutPushInput {
  date?: string;
  name: string;
  sportCategory?: string;
  description?: string;
  workoutSyntax?: string;
  ftpWatts?: number;
  lthrBpm?: number;
  thresholdPaceSecsPerKm?: number;
  steps?: WahooWorkoutStepInput[];
}

export interface WahooPlanTarget {
  type: 'power' | 'speed' | 'hr';
  low: number;
  high: number;
}

export interface WahooPlanInterval {
  name: string;
  intensity_type: 'warmup' | 'active' | 'recovery' | 'cooldown' | 'rest';
  exit_trigger_type: 'time' | 'distance';
  exit_trigger_value: number;
  targets: WahooPlanTarget[];
  repeat?: number;
  intervals?: WahooPlanInterval[];
}

export interface WahooPlanJson {
  header: {
    version: string;
    name: string;
    description: string;
    workout_type_family: number;
    workout_type_location: number;
    estimated_duration: number;
    estimated_distance: number;
    ftp: number;
    threshold_pace_secs_per_km: number;
    plan_date: string;
  };
  name: string;
  sport: 'Running' | 'Cycling';
  planDate: string;
  estimatedDurationSecs: number;
  estimatedDistanceMeters: number;
  intervals: WahooPlanInterval[];
}

export interface WahooWorkoutPushResult {
  pushed: boolean;
  partialSuccess?: boolean;
  planId?: string | number;
  workoutId?: string | number;
  planJson: WahooPlanJson;
  message: string;
}

export class WahooCloudPushError extends Error {
  readonly status: number;
  readonly needsScopeUpgrade: boolean;
  readonly unauthorized: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'WahooCloudPushError';
    this.status = status;
    this.needsScopeUpgrade = status === 403;
    this.unauthorized = status === 401;
  }
}

export function hasWahooWorkoutPushScopes(scope?: string): boolean {
  if (!scope || typeof scope !== 'string') return false;
  const tokens = new Set(
    scope
      .toLowerCase()
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return tokens.has('workouts_write') && tokens.has('plans_write');
}

function mapIntensityType(
  kind?: string
): 'warmup' | 'active' | 'recovery' | 'cooldown' | 'rest' {
  if (kind === 'warmup') return 'warmup';
  if (kind === 'cooldown') return 'cooldown';
  if (kind === 'rest' || kind === 'recovery') return 'recovery';
  return 'active';
}

function buildSingleWahooInterval(params: {
  name: string;
  intensityType: WahooPlanInterval['intensity_type'];
  durationSecs: number;
  distanceMeters?: number;
  isRunning: boolean;
  targetPctFtp: number;
  targetWatts?: number;
  targetMinWatts?: number;
  targetMaxWatts?: number;
  targetPaceSecsPerKm?: number;
  ftpWatts: number;
  thresholdPaceSecsPerKm: number;
  hrCeilingBpm?: number;
}): WahooPlanInterval {
  const isRecovery =
    params.intensityType === 'recovery' || params.intensityType === 'rest';
  const exit_trigger_type: 'time' | 'distance' =
    params.distanceMeters && params.distanceMeters > 0 ? 'distance' : 'time';
  const exit_trigger_value =
    exit_trigger_type === 'distance'
      ? Math.round(params.distanceMeters || 400)
      : Math.max(5, Math.round(params.durationSecs || 60));

  const targets: WahooPlanTarget[] = [];
  if (!isRecovery) {
    if (params.isRunning) {
      const paceSecsKm = Math.max(
        95,
        params.targetPaceSecsPerKm ||
          Math.round(params.thresholdPaceSecsPerKm / (Math.max(40, params.targetPctFtp) / 100))
      );
      const speedMps = 1000 / paceSecsKm;
      targets.push({
        type: 'speed',
        low: Number((speedMps * 0.96).toFixed(2)),
        high: Number((speedMps * 1.04).toFixed(2)),
      });
    } else {
      const centerWatts =
        Number(params.targetWatts) > 0
          ? Math.round(Number(params.targetWatts))
          : Math.round((Math.max(40, params.targetPctFtp) / 100) * params.ftpWatts);
      const lowWatts =
        Number(params.targetMinWatts) > 0
          ? Math.round(Number(params.targetMinWatts))
          : Math.max(40, Math.round(centerWatts * 0.95));
      const highWatts =
        Number(params.targetMaxWatts) > 0
          ? Math.round(Number(params.targetMaxWatts))
          : Math.round(centerWatts * 1.05);
      targets.push({
        type: 'power',
        low: lowWatts,
        high: Math.max(lowWatts + 5, highWatts),
      });
    }
  } else if (params.hrCeilingBpm && params.hrCeilingBpm > 80) {
    targets.push({
      type: 'hr',
      low: 90,
      high: Math.round(params.hrCeilingBpm),
    });
  }

  return {
    name: String(params.name || 'Interval').slice(0, 64),
    intensity_type: params.intensityType,
    exit_trigger_type,
    exit_trigger_value,
    targets,
  };
}

/**
 * Compiles structured workout syntax or explicit steps into Wahoo Cloud `plan.json`.
 */
export function buildWahooPlanJson(input: WahooWorkoutPushInput): WahooPlanJson {
  const isRunning = String(input.sportCategory || 'Running')
    .toLowerCase()
    .includes('run');
  const ftpWatts = Math.max(100, Math.round(Number(input.ftpWatts || 250)));
  const thresholdPace = Math.max(95, Math.round(Number(input.thresholdPaceSecsPerKm || 245)));
  const planDate = String(input.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const syntax = String(input.workoutSyntax || '').trim();
  const astNodes = syntax ? parseStructuredTrackWorkout(syntax, thresholdPace) : [];

  let estimatedDurationSecs = 0;
  let estimatedDistanceMeters = 0;
  const intervals: WahooPlanInterval[] = [];

  if (astNodes.length > 0) {
    for (const node of astNodes) {
      if (node.type === 'step') {
        const s = node.step;
        const durSecs = Math.max(5, Math.round(s.durationSecs || s.durationMins * 60 || 60));
        estimatedDurationSecs += durSecs;
        if (s.distanceMeters) estimatedDistanceMeters += Math.round(s.distanceMeters);
        intervals.push(
          buildSingleWahooInterval({
            name: s.label,
            intensityType: mapIntensityType(s.stepKind),
            durationSecs: durSecs,
            distanceMeters: s.distanceMeters,
            isRunning,
            targetPctFtp: s.intensityPct || 75,
            targetPaceSecsPerKm: s.targetPaceSecsPerKm,
            ftpWatts,
            thresholdPaceSecsPerKm: thresholdPace,
          })
        );
      } else {
        const children = node.steps.map((inner) => {
          const durSecs = Math.max(
            5,
            Math.round(inner.durationSecs || inner.durationMins * 60 || 60)
          );
          estimatedDurationSecs += durSecs * node.repeatCount;
          if (inner.distanceMeters) {
            estimatedDistanceMeters += Math.round(inner.distanceMeters) * node.repeatCount;
          }
          return buildSingleWahooInterval({
            name: inner.label,
            intensityType: mapIntensityType(inner.stepKind),
            durationSecs: durSecs,
            distanceMeters: inner.distanceMeters,
            isRunning,
            targetPctFtp: inner.intensityPct || 75,
            targetPaceSecsPerKm: inner.targetPaceSecsPerKm,
            ftpWatts,
            thresholdPaceSecsPerKm: thresholdPace,
          });
        });
        intervals.push({
          name: node.label || `${node.repeatCount}x Repeat`,
          intensity_type: 'active',
          exit_trigger_type: 'time',
          exit_trigger_value: 0,
          targets: [],
          repeat: node.repeatCount,
          intervals: children,
        });
      }
    }
  } else {
    const rawSteps =
      Array.isArray(input.steps) && input.steps.length > 0
        ? input.steps
        : [
            {
              label: input.name || 'Main Set',
              durationSecs: 1800,
              targetPctFtp: 75,
              stepType: 'interval' as const,
            },
          ];
    const total = rawSteps.length;
    rawSteps.forEach((s, idx) => {
      const pct = Number(s.targetPctFtp || 75);
      const inferredKind = s.stepType
        ? mapIntensityType(s.stepType)
        : idx === 0 && total > 1
          ? 'warmup'
          : idx === total - 1 && total > 1
            ? 'cooldown'
            : pct <= 60
              ? 'recovery'
              : 'active';
      const durSecs = Math.max(5, Math.round(s.durationSecs || 60));
      estimatedDurationSecs += durSecs;
      if (s.distanceMeters) estimatedDistanceMeters += Math.round(s.distanceMeters);
      intervals.push(
        buildSingleWahooInterval({
          name: String(s.label || `Step ${idx + 1}`),
          intensityType: inferredKind,
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
        })
      );
    });
  }

  const cleanName = String(input.name || 'MeetReady Prescribed Session').trim().slice(0, 64);
  const cleanDescription = String(input.description || 'Prescribed by MeetReady').slice(0, 500);

  return {
    header: {
      version: '1.0',
      name: cleanName,
      description: cleanDescription,
      workout_type_family: isRunning ? 1 : 0, // 0=biking, 1=running in Wahoo plan schema
      workout_type_location: 0,
      estimated_duration: estimatedDurationSecs,
      estimated_distance: estimatedDistanceMeters,
      ftp: ftpWatts,
      threshold_pace_secs_per_km: thresholdPace,
      plan_date: planDate,
    },
    name: cleanName,
    sport: isRunning ? 'Running' : 'Cycling',
    planDate,
    estimatedDurationSecs,
    estimatedDistanceMeters,
    intervals,
  };
}

/**
 * Uploads a structured `plan.json` to Wahoo Cloud (`/v1/plans`) and schedules
 * a workout (`/v1/workouts`). Handles `/v1/workouts` 403 gracefully as partial success.
 */
export async function pushWorkoutToWahooCloud(opts: {
  accessToken: string;
  input: WahooWorkoutPushInput;
}): Promise<WahooWorkoutPushResult> {
  const planJson = buildWahooPlanJson(opts.input);
  const planBase64 = Buffer.from(JSON.stringify(planJson), 'utf8').toString('base64');
  const fileDataUrl = `data:application/json;base64,${planBase64}`;
  const externalId = `meetready_${planJson.planDate}_${crypto.randomBytes(4).toString('hex')}`;
  const nowIso = new Date().toISOString();

  const planResp = await fetch('https://api.wahooligan.com/v1/plans', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      plan: {
        file: fileDataUrl,
        filename: 'meetready-plan.json',
        external_id: externalId,
        provider_updated_at: nowIso,
      },
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!planResp.ok) {
    const errText = await planResp.text().catch(() => '');
    throw new WahooCloudPushError(
      `Wahoo plan upload failed (${planResp.status}): ${errText.slice(0, 180)}`,
      planResp.status
    );
  }

  const planData = (await planResp.json().catch(() => ({}))) as {
    id?: string | number;
    plan?: { id?: string | number };
  };
  const planId = planData.id ?? planData.plan?.id;

  const isRunning = planJson.sport === 'Running';
  const workoutResp = await fetch('https://api.wahooligan.com/v1/workouts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      workout: {
        name: planJson.name,
        starts: `${planJson.planDate}T08:00:00.000Z`,
        minutes: Math.max(1, Math.round(planJson.estimatedDurationSecs / 60)),
        workout_type_id: isRunning ? 1 : 0,
        ...(planId !== undefined ? { plan_id: planId } : {}),
        workout_token: externalId,
      },
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (workoutResp.status === 403) {
    return {
      pushed: true,
      partialSuccess: true,
      planId,
      planJson,
      message: `Uploaded "${planJson.name}" structured plan to your Wahoo Library (calendar scheduling skipped: 403).`,
    };
  }

  if (!workoutResp.ok) {
    const errText = await workoutResp.text().catch(() => '');
    throw new WahooCloudPushError(
      `Wahoo workout schedule failed (${workoutResp.status}): ${errText.slice(0, 180)}`,
      workoutResp.status
    );
  }

  const workoutData = (await workoutResp.json().catch(() => ({}))) as {
    id?: string | number;
    workout?: { id?: string | number };
  };
  const workoutId = workoutData.id ?? workoutData.workout?.id;

  return {
    pushed: true,
    partialSuccess: false,
    planId,
    workoutId,
    planJson,
    message: `Pushed "${planJson.name}" directly to your Wahoo Cloud / ELEMNT (${planJson.planDate}).`,
  };
}
