import { Router, type NextFunction, type Request, type Response } from 'express';
import { computeFatigueSlicedDurability } from '../../src/physiology/durabilityEngine.ts';
import { simulateCoursePacingAndFueling } from '../../src/physiology/raceSimulator.ts';
import { generateVerifiedRacePassport } from '../../src/physiology/raceRubberBander.ts';

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
    : [payload];

  res.status(200).json({
    ok: true,
    provider: provider.toUpperCase(),
    ingestionSource: `${provider.toUpperCase()}_WEBHOOK_FIRST_PARTY`,
    cleanRoomEligibleForAiAndCoaching: true,
    receivedCount: records.length,
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
  const title = String(body.name || 'THRESH Prescribed Session').trim();
  const sport = body.sportCategory === 'Running' ? 'Running' : 'Cycling';
  const ftp = Math.max(100, Number(body.ftp) || 280);
  const thresholdPaceSecsPerKm = Math.max(150, Number(body.thresholdPaceSecsPerKm) || 245);

  const rawSteps: { label?: string; durationSecs?: number; targetPctFtp?: number }[] =
    Array.isArray(body.steps) && body.steps.length > 0
      ? body.steps
      : [
          { label: 'Warmup', durationSecs: 600, targetPctFtp: 62 },
          { label: 'Threshold Main Set', durationSecs: 1800, targetPctFtp: 96 },
          { label: 'Cooldown', durationSecs: 600, targetPctFtp: 55 },
        ];

  const normalizedSteps = rawSteps.map((s, idx) => {
    const durationSecs = Math.max(30, Number(s.durationSecs) || 300);
    const pct = Math.max(40, Math.min(180, Number(s.targetPctFtp) || 75));
    const targetWatts = Math.round((ftp * pct) / 100);
    const targetPaceSecsPerKm = Math.round(thresholdPaceSecsPerKm / (pct / 100));
    return {
      stepOrder: idx + 1,
      label: String(s.label || `Step ${idx + 1}`),
      durationSecs,
      targetPctFtp: pct,
      targetWatts,
      targetPaceSecsPerKm,
    };
  });

  // 1. Apple Watch WorkoutKit JSON schema
  const appleWorkoutKitJson = {
    schemaVersion: '1.0',
    activityType: sport === 'Running' ? 'HKWorkoutActivityTypeRunning' : 'HKWorkoutActivityTypeCycling',
    displayName: title,
    blocks: normalizedSteps.map((st) => ({
      stepType: st.stepOrder === 1 ? 'warmup' : st.stepOrder === normalizedSteps.length ? 'cooldown' : 'work',
      goal: { type: 'time', seconds: st.durationSecs },
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

  // 2. Garmin Connect Training API Workout JSON
  const garminTrainingApiJson = {
    workoutName: title,
    sportType: { sportTypeKey: sport === 'Running' ? 'running' : 'cycling' },
    workoutSegments: [
      {
        segmentOrder: 1,
        sportType: { sportTypeKey: sport === 'Running' ? 'running' : 'cycling' },
        workoutSteps: normalizedSteps.map((st) => ({
          type: 'ExecutableStepDTO',
          stepOrder: st.stepOrder,
          description: st.label,
          endCondition: { conditionTypeKey: 'time' },
          endConditionValue: st.durationSecs,
          targetType: {
            workoutTargetTypeKey: sport === 'Cycling' ? 'power.zone' : 'pace.zone',
          },
          targetValueOne:
            sport === 'Cycling'
              ? Math.round(st.targetWatts * 0.96)
              : Math.round((1000 / (st.targetPaceSecsPerKm * 1.02)) * 100) / 100,
          targetValueTwo:
            sport === 'Cycling'
              ? Math.round(st.targetWatts * 1.04)
              : Math.round((1000 / (st.targetPaceSecsPerKm * 0.98)) * 100) / 100,
        })),
      },
    ],
  };

  // 3. Zwift .ZWO XML
  const zwoLines = [
    '<workout_file>',
    '  <author>Thresh</author>',
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

  res.status(200).json({
    ok: true,
    title,
    sport,
    appleWorkoutKitJson,
    garminTrainingApiJson,
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
    athleteName: String(body.athleteName || 'THRESH Athlete'),
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
