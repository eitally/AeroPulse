import { Router, type NextFunction, type Request, type Response } from 'express';
import { buildCorosWorkoutPayload } from '../corosConnectService.ts';
import { computeFatigueSlicedDurability } from '../../src/physiology/durabilityEngine.ts';
import { simulateCoursePacingAndFueling } from '../../src/physiology/raceSimulator.ts';
import { generateVerifiedRacePassport } from '../../src/physiology/raceRubberBander.ts';
import {
  buildFitStepsFromWorkoutSyntax,
  encodeGarminFitWorkout,
  type FitWorkoutStepInput,
} from '../../src/utils/fitWorkoutEncoder.ts';
import {
  parseStructuredTrackWorkout,
  type StructuredWorkoutNode,
} from '../../src/utils/workoutParser.ts';

export const webhooksAndExportRouter = Router();

const SUPPORTED_WEBHOOK_PROVIDERS = new Set([
  'garmin',
  'wahoo',
  'coros',
  'polar',
  'whoop',
  'oura',
  'apple-healthkit',
]);

/**
 * Webhook Verification Handler (GET /api/webhooks/:provider)
 * Answers webhook subscription handshake/challenges from Wahoo, Garmin, Polar, etc.
 */
webhooksAndExportRouter.get('/api/webhooks/:provider', (req: Request, res: Response, next: NextFunction) => {
  const provider = String(req.params.provider || '').trim().toLowerCase();
  if (provider === 'strava' || provider === 'intervals') {
    next();
    return;
  }
  if (!SUPPORTED_WEBHOOK_PROVIDERS.has(provider)) {
    res.status(400).json({ ok: false, error: `Unsupported provider "${provider}"` });
    return;
  }
  const challenge = req.query['hub.challenge'] || req.query.challenge || req.query['webhook_challenge'];
  if (challenge) {
    res.status(200).type('text/plain').send(String(challenge));
    return;
  }
  res.status(200).json({ ok: true, provider: provider.toUpperCase(), verified: true });
});

/**
 * [P0.1] First-Party Hardware OAuth2 Push Webhook Receiver
 * Accepts normalized activity & overnight recovery/HRV pushes from Garmin Connect Developer Program,
 * Wahoo Cloud, COROS, Polar, WHOOP v2, Oura v2, and Apple HealthKit Companion without touching Strava API.
 */
webhooksAndExportRouter.post('/api/webhooks/:provider', (req: Request, res: Response, next: NextFunction) => {
  const provider = String(req.params.provider || '')
    .trim()
    .toLowerCase();
  if (provider === 'strava' || provider === 'intervals') {
    next();
    return;
  }
  if (!SUPPORTED_WEBHOOK_PROVIDERS.has(provider)) {
    res.status(400).json({
      ok: false,
      error: `Unsupported hardware webhook provider "${provider}". Supported: ${Array.from(
        SUPPORTED_WEBHOOK_PROVIDERS
      ).join(', ')}`,
    });
    return;
  }

  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const records = Array.isArray(payload.activities || payload.workouts || payload.records)
    ? payload.activities || payload.workouts || payload.records
    : payload.workout
      ? [payload.workout]
      : [payload];

  // Extract Wahoo workout summary & FIT file link if present
  let wahooWorkoutId: string | number | undefined;
  let wahooFileUrl: string | undefined;
  if (provider === 'wahoo' && payload.workout) {
    wahooWorkoutId = payload.workout.id;
    wahooFileUrl = payload.workout.file?.url;
  }

  // Extract Polar exercise webhook info if present
  let polarEvent: string | undefined;
  let polarEntityId: string | undefined;
  if (provider === 'polar') {
    polarEvent = payload.event;
    polarEntityId = payload.entity_id;
  }

  res.status(200).json({
    ok: true,
    provider: provider.toUpperCase(),
    ingestionSource: `${provider.toUpperCase()}_WEBHOOK_FIRST_PARTY`,
    cleanRoomEligibleForAiAndCoaching: true,
    receivedCount: records.length,
    workoutId: wahooWorkoutId,
    fileUrl: wahooFileUrl,
    polarEvent,
    polarEntityId,
    entityId: polarEntityId,
    receivedAt: new Date().toISOString(),
  });
});

/**
 * [P0.3] 2-Way Over-the-Air Structured Workout Compiler & Exporter
 * Compiles structured workout steps (`durationSecs`, `targetPctFtp`, `label`) into:
 *  - Apple Watch `WorkoutKit` CustomWorkout JSON
 *  - Garmin Connect Training API Workout JSON
 *  - Zwift `.ZWO` XML
 *  - Smart Trainer `.ERG` text
 */
webhooksAndExportRouter.post('/api/workouts/export', (req: Request, res: Response) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const title = String(body.name || 'MeetReady Prescribed Session').trim();
  const sport = body.sportCategory === 'Running' ? 'Running' : 'Cycling';
  const ftp = Math.max(100, Number(body.ftp) || 280);
  const thresholdPaceSecsPerKm = Math.max(95, Number(body.thresholdPaceSecsPerKm) || 245);
  const workoutSyntax = typeof body.workoutSyntax === 'string' ? body.workoutSyntax.trim() : '';

  interface ExportStepNormalized {
    stepOrder: number;
    label: string;
    durationSecs: number;
    distanceMeters?: number;
    targetPctFtp: number;
    targetWatts: number;
    targetPaceSecsPerKm: number;
    stepKind: 'warmup' | 'work' | 'rest' | 'cooldown';
  }

  let astNodes: StructuredWorkoutNode[] | null = null;
  let normalizedSteps: ExportStepNormalized[] = [];
  let fitSteps: FitWorkoutStepInput[] = [];

  if (workoutSyntax) {
    astNodes = parseStructuredTrackWorkout(workoutSyntax, thresholdPaceSecsPerKm);
    fitSteps = buildFitStepsFromWorkoutSyntax(workoutSyntax, {
      sport,
      ftpWatts: ftp,
      thresholdPaceSecsPerKm,
    });

    let stepOrder = 0;
    for (const node of astNodes) {
      const expand = node.type === 'step' ? [node.step] : node.steps;
      const reps = node.type === 'repeat' ? node.repeatCount : 1;
      for (let r = 0; r < reps; r++) {
        for (const s of expand) {
          stepOrder += 1;
          const pct = Math.max(40, Math.min(180, s.intensityPct || 75));
          const paceSecsKm = s.targetPaceSecsPerKm || Math.round(thresholdPaceSecsPerKm / (pct / 100));
          normalizedSteps.push({
            stepOrder,
            label: s.label,
            durationSecs: Math.max(5, Math.round(s.durationSecs || s.durationMins * 60)),
            distanceMeters: s.distanceMeters,
            targetPctFtp: pct,
            targetWatts: Math.round((ftp * pct) / 100),
            targetPaceSecsPerKm: Math.round(paceSecsKm),
            stepKind: s.stepKind || 'work',
          });
        }
      }
    }
  }

  if (normalizedSteps.length === 0) {
    const rawSteps: Array<{
      label?: string;
      durationSecs?: number;
      distanceMeters?: number;
      targetPctFtp?: number;
      targetPaceSecsPerKm?: number;
      repeatCount?: number;
      steps?: Array<{
        label?: string;
        durationSecs?: number;
        distanceMeters?: number;
        targetPctFtp?: number;
        targetPaceSecsPerKm?: number;
      }>;
    }> =
      Array.isArray(body.steps) && body.steps.length > 0
        ? body.steps
        : [
            { label: 'Warmup', durationSecs: 600, targetPctFtp: 62 },
            { label: 'Threshold Main Set', durationSecs: 1800, targetPctFtp: 96 },
            { label: 'Cooldown', durationSecs: 600, targetPctFtp: 55 },
          ];

    let orderIdx = 0;
    for (let i = 0; i < rawSteps.length; i++) {
      const s = rawSteps[i];
      const pushSimpleStep = (
        item: {
          label?: string;
          durationSecs?: number;
          distanceMeters?: number;
          targetPctFtp?: number;
          targetPaceSecsPerKm?: number;
        },
        kind: ExportStepNormalized['stepKind']
      ) => {
        orderIdx += 1;
        const dist =
          typeof item.distanceMeters === 'number' && item.distanceMeters > 0
            ? Math.round(item.distanceMeters)
            : undefined;
        const explicitPace =
          typeof item.targetPaceSecsPerKm === 'number' && item.targetPaceSecsPerKm > 60
            ? Math.round(item.targetPaceSecsPerKm)
            : undefined;
        const pct = explicitPace
          ? Math.max(40, Math.min(180, Math.round((thresholdPaceSecsPerKm / explicitPace) * 100)))
          : Math.max(40, Math.min(180, Number(item.targetPctFtp) || 75));
        const targetWatts = Math.round((ftp * pct) / 100);
        const targetPaceSecsPerKm = explicitPace ?? Math.round(thresholdPaceSecsPerKm / (pct / 100));
        const durationSecs =
          typeof item.durationSecs === 'number' && item.durationSecs > 0
            ? Math.max(5, Math.round(item.durationSecs))
            : dist
              ? Math.max(5, Math.round((dist / 1000) * targetPaceSecsPerKm))
              : 300;
        normalizedSteps.push({
          stepOrder: orderIdx,
          label: String(item.label || `Step ${orderIdx}`),
          durationSecs,
          distanceMeters: dist,
          targetPctFtp: pct,
          targetWatts,
          targetPaceSecsPerKm,
          stepKind: kind,
        });
        const speedMps = 1000 / Math.max(95, targetPaceSecsPerKm);
        fitSteps.push({
          label: String(item.label || `Step ${orderIdx}`).slice(0, 15),
          durationSecs,
          distanceMeters: dist,
          durationType: dist ? 'distance' : 'time',
          targetType: sport === 'Running' ? (kind === 'rest' ? 'open' : 'speed') : kind === 'rest' ? 'open' : 'power',
          targetMinSpeedMps: sport === 'Running' && kind !== 'rest' ? Number((speedMps * 0.975).toFixed(3)) : undefined,
          targetMaxSpeedMps: sport === 'Running' && kind !== 'rest' ? Number((speedMps * 1.025).toFixed(3)) : undefined,
          targetMinWatts: sport === 'Cycling' && kind !== 'rest' ? Math.round(targetWatts * 0.95) : undefined,
          targetMaxWatts: sport === 'Cycling' && kind !== 'rest' ? Math.round(targetWatts * 1.05) : undefined,
          intensity: kind === 'work' ? 'active' : kind,
        });
      };

      if (Array.isArray(s.steps) && s.steps.length > 0 && (s.repeatCount || 1) >= 2) {
        const repTotal = Math.round(s.repeatCount || 2);
        const startIdx = fitSteps.length;
        for (let r = 0; r < repTotal; r++) {
          for (let j = 0; j < s.steps.length; j++) {
            if (r === 0) {
              pushSimpleStep(s.steps[j], j % 2 === 1 ? 'rest' : 'work');
            } else {
              // Keep unrolled normalizedSteps while emitting single FIT loop
              const child = s.steps[j];
              const pct = Math.max(40, Math.min(180, Number(child.targetPctFtp) || 75));
              const pace = child.targetPaceSecsPerKm ?? Math.round(thresholdPaceSecsPerKm / (pct / 100));
              const dist = child.distanceMeters ? Math.round(child.distanceMeters) : undefined;
              const secs = child.durationSecs
                ? Math.max(5, Math.round(child.durationSecs))
                : dist
                  ? Math.max(5, Math.round((dist / 1000) * pace))
                  : 60;
              orderIdx += 1;
              normalizedSteps.push({
                stepOrder: orderIdx,
                label: String(child.label || `Rep Step ${orderIdx}`),
                durationSecs: secs,
                distanceMeters: dist,
                targetPctFtp: pct,
                targetWatts: Math.round((ftp * pct) / 100),
                targetPaceSecsPerKm: Math.round(pace),
                stepKind: j % 2 === 1 ? 'rest' : 'work',
              });
            }
          }
        }
        fitSteps.push({
          label: String(s.label || `Repeat ${repTotal}x`).slice(0, 15),
          durationType: 'repeat_until_steps_cmplt',
          repeatFromStepIndex: startIdx,
          repeatCount: repTotal,
          targetType: 'open',
          intensity: 'active',
        });
      } else {
        const kind: ExportStepNormalized['stepKind'] =
          i === 0 && rawSteps.length > 1
            ? 'warmup'
            : i === rawSteps.length - 1 && rawSteps.length > 2
              ? 'cooldown'
              : 'work';
        pushSimpleStep(s, kind);
      }
    }
  }

  // Binary native Garmin .FIT bytes (base64)
  const fitBytes = encodeGarminFitWorkout({
    name: title,
    sport,
    steps: fitSteps,
  });
  const fitWorkoutBase64 = Buffer.from(fitBytes).toString('base64');

  // Normalized Intervals.icu / COROS structured text
  const intervalsIcuText =
    workoutSyntax ||
    normalizedSteps
      .map((st) => {
        const durOrDist = st.distanceMeters ? `${st.distanceMeters}m` : `${st.durationSecs}s`;
        const cue = sport === 'Running' ? 'Pace' : 'FTP';
        return `- ${durOrDist} ${Math.max(45, st.targetPctFtp - 2)}%-${Math.min(180, st.targetPctFtp + 2)}% ${cue} (${st.label})`;
      })
      .join('\n');

  // 1. Apple Watch WorkoutKit JSON schema (supports both distance & time goals)
  const appleWorkoutKitJson = {
    schemaVersion: '1.0',
    activityType: sport === 'Running' ? 'HKWorkoutActivityTypeRunning' : 'HKWorkoutActivityTypeCycling',
    displayName: title,
    blocks: normalizedSteps.map((st, idx) => ({
      stepType:
        st.stepKind === 'warmup' || (idx === 0 && normalizedSteps.length > 2)
          ? 'warmup'
          : st.stepKind === 'cooldown' || (idx === normalizedSteps.length - 1 && normalizedSteps.length > 2)
            ? 'cooldown'
            : st.stepKind === 'rest'
              ? 'recovery'
              : 'work',
      goal: st.distanceMeters
        ? { type: 'distance', meters: st.distanceMeters }
        : { type: 'time', seconds: st.durationSecs },
      alert:
        sport === 'Cycling'
          ? {
              type: 'powerRange',
              minWatts: Math.round(st.targetWatts * 0.96),
              maxWatts: Math.round(st.targetWatts * 1.04),
            }
          : {
              type: 'paceRange',
              minSecsPerKm: Math.round(st.targetPaceSecsPerKm * 0.98),
              maxSecsPerKm: Math.round(st.targetPaceSecsPerKm * 1.02),
            },
    })),
  };

  // 2. Garmin Connect Training API Workout JSON (with RepeatGroupDTO when AST repeats exist)
  const toGarminExecStep = (
    st: {
      stepOrder: number;
      label: string;
      durationSecs: number;
      distanceMeters?: number;
      targetWatts: number;
      targetPaceSecsPerKm: number;
      stepKind?: string;
    }
  ) => ({
    type: 'ExecutableStepDTO',
    stepOrder: st.stepOrder,
    stepType: {
      stepTypeKey:
        st.stepKind === 'warmup'
          ? 'warmup'
          : st.stepKind === 'cooldown'
            ? 'cooldown'
            : st.stepKind === 'rest'
              ? 'rest'
              : 'interval',
    },
    description: st.label,
    endCondition: {
      conditionTypeKey: st.distanceMeters ? 'distance' : 'time',
    },
    endConditionValue: st.distanceMeters ? st.distanceMeters : st.durationSecs,
    targetType: {
      workoutTargetTypeKey:
        st.stepKind === 'rest'
          ? 'no.target'
          : sport === 'Cycling'
            ? 'power.zone'
            : 'pace.zone',
    },
    targetValueOne:
      st.stepKind === 'rest'
        ? null
        : sport === 'Cycling'
          ? Math.round(st.targetWatts * 0.96)
          : Math.round((1000 / (st.targetPaceSecsPerKm * 1.02)) * 100) / 100,
    targetValueTwo:
      st.stepKind === 'rest'
        ? null
        : sport === 'Cycling'
          ? Math.round(st.targetWatts * 1.04)
          : Math.round((1000 / (st.targetPaceSecsPerKm * 0.98)) * 100) / 100,
  });

  const garminWorkoutSteps = astNodes
    ? astNodes.map((node, idx) => {
        if (node.type === 'step') {
          const pct = Math.max(40, Math.min(180, node.step.intensityPct || 75));
          const pace =
            node.step.targetPaceSecsPerKm || Math.round(thresholdPaceSecsPerKm / (pct / 100));
          return toGarminExecStep({
            stepOrder: idx + 1,
            label: node.step.label,
            durationSecs: Math.max(5, Math.round(node.step.durationSecs || 60)),
            distanceMeters: node.step.distanceMeters,
            targetWatts: Math.round((ftp * pct) / 100),
            targetPaceSecsPerKm: Math.round(pace),
            stepKind: node.step.stepKind,
          });
        }
        return {
          type: 'RepeatGroupDTO',
          stepOrder: idx + 1,
          numberOfIterations: node.repeatCount,
          smartRepeat: false,
          workoutSteps: node.steps.map((inner, innerIdx) => {
            const pct = Math.max(40, Math.min(180, inner.intensityPct || 75));
            const pace =
              inner.targetPaceSecsPerKm || Math.round(thresholdPaceSecsPerKm / (pct / 100));
            return toGarminExecStep({
              stepOrder: innerIdx + 1,
              label: inner.label,
              durationSecs: Math.max(5, Math.round(inner.durationSecs || 60)),
              distanceMeters: inner.distanceMeters,
              targetWatts: Math.round((ftp * pct) / 100),
              targetPaceSecsPerKm: Math.round(pace),
              stepKind: inner.stepKind,
            });
          }),
        };
      })
    : normalizedSteps.map((st) => toGarminExecStep(st));

  const garminTrainingApiJson = {
    workoutName: title,
    sportType: { sportTypeKey: sport === 'Running' ? 'running' : 'cycling' },
    workoutSegments: [
      {
        segmentOrder: 1,
        sportType: { sportTypeKey: sport === 'Running' ? 'running' : 'cycling' },
        workoutSteps: garminWorkoutSteps,
      },
    ],
  };

  // 3. Zwift .ZWO XML
  const zwoLines = [
    '<workout_file>',
    '  <author>MeetReady</author>',
    `  <name>${title.replace(/[<>&]/g, '')}</name>`,
    `  <sportType>${sport === 'Running' ? 'run' : 'bike'}</sportType>`,
    '  <workout>',
    ...normalizedSteps.map(
      (st) =>
        `    <SteadyState Duration="${st.durationSecs}" Power="${(st.targetPctFtp / 100).toFixed(
          2
        )}" />`
    ),
    '  </workout>',
    '</workout_file>',
  ];

  // 4. Smart Trainer .ERG
  let elapsedMins = 0;
  const ergDataLines: string[] = [];
  for (const st of normalizedSteps) {
    const nextMins = Number((elapsedMins + st.durationSecs / 60).toFixed(2));
    ergDataLines.push(`${elapsedMins.toFixed(2)}\t${st.targetWatts}`);
    ergDataLines.push(`${nextMins.toFixed(2)}\t${st.targetWatts}`);
    elapsedMins = nextMins;
  }
  const ergText = [
    '[COURSE HEADER]',
    'VERSION = 2',
    'UNITS = ENGLISH',
    `DESCRIPTION = ${title}`,
    `FTP = ${ftp}`,
    'MINUTES WATTS',
    '[END COURSE HEADER]',
    '[COURSE DATA]',
    ...ergDataLines,
    '[END COURSE DATA]',
  ].join('\n');

  const corosWorkoutJson = buildCorosWorkoutPayload({
    date: String(body.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
    name: title,
    sportCategory: sport,
    description: typeof body.description === 'string' ? body.description : intervalsIcuText,
    workoutSyntax,
    ftpWatts: ftp,
    thresholdPaceSecsPerKm,
    steps: normalizedSteps.map((st) => ({
      label: st.label,
      durationSecs: st.durationSecs,
      distanceMeters: st.distanceMeters,
      targetPctFtp: st.targetPctFtp,
      targetWatts: st.targetWatts,
      targetPaceSecsPerKm: st.targetPaceSecsPerKm,
      stepType:
        st.stepKind === 'rest'
          ? 'recovery'
          : st.stepKind === 'work'
            ? 'interval'
            : st.stepKind,
    })),
  });

  res.status(200).json({
    ok: true,
    title,
    sport,
    fitWorkoutBase64,
    intervalsIcuText,
    appleWorkoutKitJson,
    garminTrainingApiJson,
    corosWorkoutJson,
    zwoXml: zwoLines.join('\n'),
    ergText,
  });
});

/**
 * Server-side 10x #2 Durability, 10x #4 Race Simulator, and 10x #6 Verified Race Passport endpoints
 */
webhooksAndExportRouter.post('/api/physiology/durability', (req: Request, res: Response) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const report = computeFatigueSlicedDurability({
    discipline: body.discipline === 'Running' ? 'Running' : 'Cycling',
    activities: Array.isArray(body.activities) ? body.activities : [],
    streamMap: new Map(),
    athleteProfile: body.athleteProfile || null,
  });
  res.status(200).json({ ok: true, report });
});

webhooksAndExportRouter.post('/api/physiology/race-simulator', (req: Request, res: Response) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const report = simulateCoursePacingAndFueling({
    sport: body.sport === 'Cycling' ? 'Cycling' : 'Running',
    raceName: String(body.raceName || 'Target A-Race'),
    distanceKm: Number(body.distanceKm) || 21.1,
    elevationGainMeters: Number(body.elevationGainMeters) || 180,
    ambientTempC: Number(body.ambientTempC) ?? 18,
    altitudeMeters: Number(body.altitudeMeters) || 200,
    athleteProfile: body.athleteProfile || {
      ftp: 280,
      thresholdPaceSecsPerKm: 245,
      weightKg: 72,
    },
  });
  res.status(200).json({ ok: true, report });
});

webhooksAndExportRouter.post('/api/physiology/race-passport', (req: Request, res: Response) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const passport = generateVerifiedRacePassport({
    athleteName: String(body.athleteName || 'MeetReady Athlete'),
    meetOrRaceName: String(body.meetOrRaceName || 'Official Championship'),
    eventLabel: String(body.eventLabel || '5000m'),
    platform: body.platform || 'Official FAT',
    raceDate: String(body.raceDate || new Date().toISOString().slice(0, 10)),
    certifiedDistanceMeters: Number(body.certifiedDistanceMeters) || 5000,
    rawGpsDistanceMeters: Number(body.rawGpsDistanceMeters) || 5080,
    officialChipOrFatSecs: Number(body.officialChipOrFatSecs) || 930,
    officialSplitsSecs: Array.isArray(body.officialSplitsSecs)
      ? body.officialSplitsSecs
      : undefined,
  });
  res.status(200).json({ ok: true, passport });
});
