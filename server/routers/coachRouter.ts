import { Router, type Request, type Response } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import {
  isAuthorizedForAi,
  checkAiRateLimit,
  getClientAiRateLimitKey,
  isServerOwnedSecret,
  isAuthorizedForServerAi,
} from '../secretManager.ts';
import { sanitizeTelemetryForCleanRoom } from '../cleanRoomFirewall.ts';
import {
  requestContext,
  getScopedRuntimeStore,
  runtimeStore,
  saveSessionCache,
  saveSessionCacheAsync,
} from '../sessionContext.ts';
import { parseWorkoutSyntaxToSteps } from '../physiologyEngine.ts';
import {
  assertSafeExternalFetch,
  getVerifiedSessionClaims,
  isCanonicalAuthenticatedClaims,
} from '../securityUtils.ts';
import { getUserById } from '../authService.ts';
import { listTeamsForUser } from '../teamService.ts';
import { resolveAthleteAgeTier } from '../../src/physiology/ageAndComplianceEngine.ts';

export const coachRouter = Router();

export function getEffectiveGeminiApiKey(req?: Request): string {
  const activeReq = req ?? requestContext.getStore();
  const headerKey = (activeReq?.headers['x-gemini-api-key'] as string | undefined)?.trim();
  const bodyKey =
    typeof activeReq?.body?.geminiApiKey === 'string' ? activeReq.body.geminiApiKey.trim() : '';

  // 1. Explicit client BYO key takes precedence
  for (const c of [headerKey, bodyKey]) {
    const clean = (c || '').trim().replace(/^["']+|["']+$/g, '').trim();
    if (clean && clean !== 'MY_GEMINI_API_KEY' && clean !== 'YOUR_GEMINI_API_KEY') {
      return clean;
    }
  }

  // 2. User-stored BYO key in tenant vault / session store (if athlete previously saved a custom key)
  if (activeReq) {
    try {
      const currentScopeStore = getScopedRuntimeStore(activeReq);
      const storedKey = (currentScopeStore?.geminiApiKey || '').trim();
      if (storedKey && !isServerOwnedSecret(storedKey)) {
        const clean = storedKey.replace(/^["']+|["']+$/g, '').trim();
        if (clean && clean !== 'MY_GEMINI_API_KEY' && clean !== 'YOUR_GEMINI_API_KEY') {
          return clean;
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. Server-owned key fallbacks require a verified session
  if (!isAuthorizedForServerAi(activeReq)) {
    return '';
  }

  // SEC-02: Only canonical server-side env vars; omit client-prefixed VITE_/NEXT_PUBLIC_ and generic API_KEY
  const serverCandidates = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  ];

  for (const c of serverCandidates) {
    const clean = (c || '').trim().replace(/^["']+|["']+$/g, '').trim();
    if (clean && clean !== 'MY_GEMINI_API_KEY' && clean !== 'YOUR_GEMINI_API_KEY') {
      return clean;
    }
  }

  return '';
}

export function getGeminiClient(req?: Request): GoogleGenAI | null {
  const apiKey = getEffectiveGeminiApiKey(req);
  if (!apiKey) return null;
  if (!runtimeStore.geminiApiKey && !isServerOwnedSecret(apiKey)) {
    runtimeStore.geminiApiKey = apiKey;
  }
  return new GoogleGenAI({
    apiKey,
  });
}

export interface CoachTelemetrySummary {
  latestWellness?: {
    ctl?: number | null;
    atl?: number | null;
    tsb?: number | null;
    hrvRMSSD?: number | null;
    hrvBaseline7d?: number | null;
    hrvStatus?: string | null;
    sleepScore?: number | null;
    sleepSecs?: number | null;
    garminTrainingStatus?: string | null;
  };
  athleteThresholds?: {
    ftp?: number | null;
    lthr?: number | null;
    runLthr?: number | null;
  };
  athleteProfile?: {
    safeSportHideWeight?: boolean;
    birthMonthYear?: string;
  };
  safeSportHideWeight?: boolean;
  enforceZeroWeight?: boolean;
  birthMonthYear?: string;
  isMinorU18?: boolean;
}

export interface ProposedCoachWorkout {
  id: string;
  date: string;
  name: string;
  sportCategory: string;
  environmentPreference: string;
  description: string;
  plannedLoad: number;
  plannedDurationSecs: number;
  targetZoneSummary: string;
  workoutSyntax: string;
  structuredSteps: ReturnType<typeof parseWorkoutSyntaxToSteps>;
  source: 'AI_COACH';
}

interface RawAiProposedWorkout {
  date?: string;
  name?: string;
  sportCategory?: string;
  environmentPreference?: string;
  description?: string;
  plannedLoad?: number | string;
  plannedDurationSecs?: number | string;
  workoutSyntax?: string;
}

export async function generateGeminiContentWithFallback(
  ai: GoogleGenAI,
  params: { contents: string; config?: Record<string, unknown> }
) {
  const candidateModels = ['gemini-2.5-flash', 'gemini-2.0-flash'];
  let lastError: unknown = null;
  for (const model of candidateModels) {
    try {
      return await Promise.race([
        ai.models.generateContent({
          model,
          contents: params.contents,
          config: params.config,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Model ${model} timed out`)), 4500)
        ),
      ]);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Gemini API request failed across candidate models.');
}

export function buildDeterministicDailyWorkoutOptions(
  sportPreference: string,
  environmentPreference: string,
  durationMinutes: number,
  telemetrySummary: CoachTelemetrySummary = {}
) {
  const w = telemetrySummary?.latestWellness || {};
  const t = telemetrySummary?.athleteThresholds || {};
  const hasCtl = w.ctl != null && Number(w.ctl) > 0;
  const hasHrv = w.hrvRMSSD != null && Number(w.hrvRMSSD) > 0;
  const hasSleep = w.sleepScore != null && Number(w.sleepScore) > 0;
  const ctl = hasCtl ? Number(w.ctl).toFixed(1) : null;
  const tsb = hasCtl ? Number(w.tsb ?? 0).toFixed(1) : null;
  const hrv = hasHrv ? Math.round(Number(w.hrvRMSSD)) : null;
  const hrvStatus = hasHrv ? String(w.hrvStatus || 'Balanced') : null;
  const sleepScore = hasSleep ? Math.round(Number(w.sleepScore)) : null;
  const ftp = Math.round(Number(t.ftp || runtimeStore.athleteFtp || 250));
  const isRun = /run/i.test(sportPreference);
  const dur = Math.max(30, Math.round(Number(durationMinutes) || 60));
  const mainMins = Math.max(15, dur - 25);

  const loadContextNote = ctl
    ? `CTL ${ctl} · TSB ${tsb}`
    : 'your current threshold calibration while your 42-day load baseline builds';
  const biometricContextNote =
    hrv && sleepScore
      ? `morning HRV ${hrv} ms (${hrvStatus}) and Sleep Score ${sleepScore}`
      : hrv
        ? `morning HRV ${hrv} ms (${hrvStatus})`
        : 'your calibrated threshold zones (connect Garmin or Intervals.icu anytime to layer overnight HRV & sleep modulation)';

  return [
    {
      id: `opt-det-1-${Date.now()}`,
      tier: 'OPTIMAL',
      tierLabel: 'Option A · Optimal Progression',
      title: isRun ? 'Threshold Cruiser Progression' : 'Sweet Spot Aerobic Ramp',
      sportCategory: isRun ? 'Running' : 'Cycling',
      environment: environmentPreference || 'INDOOR',
      durationMinutes: dur,
      estimatedLoad: Math.round((dur * 72) / 60),
      summary: isRun
        ? `Structured 10m warmup, ${mainMins}m sub-threshold tempo, and 10m cooldown calibrated to your current fitness.`
        : `Warmup, sustained ${mainMins}m block at 88-92% FTP (${Math.round(ftp * 0.9)}W), and spinout cooldown.`,
      physiologicalWhy: `Chosen from ${biometricContextNote} with ${loadContextNote} to stimulate mitochondrial density without exceeding autonomic recovery reserve.`,
      workoutSyntax: isRun
        ? `- 10m Warmup easy jog\n- ${mainMins}m Sub-threshold tempo at 88% LTHR\n- 10m Cooldown easy jog`
        : `- 10m 60% FTP (${Math.round(ftp * 0.6)}W)\n- ${mainMins}m 88% FTP (${Math.round(ftp * 0.88)}W)\n- 10m 55% FTP (${Math.round(ftp * 0.55)}W)`,
      structuredSteps: [
        { label: 'Warmup', duration: '10m', targetZoneOrOutput: isRun ? 'Zone 1-2' : `${Math.round(ftp * 0.6)}W · Z1-Z2` },
        { label: 'Main Set', duration: `${mainMins}m`, targetZoneOrOutput: isRun ? '88% LTHR · Z3/Z4' : `${Math.round(ftp * 0.88)}W · Sweet Spot` },
        { label: 'Cooldown', duration: '10m', targetZoneOrOutput: isRun ? 'Easy jog' : `${Math.round(ftp * 0.55)}W · Recovery` },
      ],
    },
    {
      id: `opt-det-2-${Date.now()}`,
      tier: 'MODULATED',
      tierLabel: 'Option B · Aerobic Durability',
      title: isRun ? 'Zone 2 Base Durability' : 'Endurance Aerobic Cruise',
      sportCategory: isRun ? 'Running' : 'Cycling',
      environment: environmentPreference || 'OUTDOOR',
      durationMinutes: dur,
      estimatedLoad: Math.round((dur * 50) / 60),
      summary: `Steady Zone 2 aerobic volume building fat oxidation capacity and capillary beds with low cardiac drift.`,
      physiologicalWhy: `Respects ${biometricContextNote}. Keeps parasympathetic activation high while banking steady endurance hours.`,
      workoutSyntax: isRun
        ? `- 5m Warmup walk/jog\n- ${dur - 10}m Zone 2 aerobic base\n- 5m Cooldown walk`
        : `- 10m 55% FTP (${Math.round(ftp * 0.55)}W)\n- ${dur - 20}m 68% FTP (${Math.round(ftp * 0.68)}W)\n- 10m 50% FTP (${Math.round(ftp * 0.5)}W)`,
      structuredSteps: [
        { label: 'Warmup', duration: isRun ? '5m' : '10m', targetZoneOrOutput: 'Z1 Warmup' },
        { label: 'Base Durability', duration: `${isRun ? dur - 10 : dur - 20}m`, targetZoneOrOutput: isRun ? 'Zone 2' : `${Math.round(ftp * 0.68)}W · Z2` },
        { label: 'Cooldown', duration: isRun ? '5m' : '10m', targetZoneOrOutput: 'Recovery' },
      ],
    },
    {
      id: `opt-det-3-${Date.now()}`,
      tier: 'RECOVERY',
      tierLabel: 'Option C · Active Recovery & Flush',
      title: isRun ? 'Easy Shakeout & Mobility' : 'Spindle Flush Spin',
      sportCategory: isRun ? 'Running' : 'Cycling',
      environment: 'INDOOR',
      durationMinutes: Math.min(dur, 40),
      estimatedLoad: 20,
      summary: `Ultra-light Zone 1 flush stimulating lymph clearance and muscle blood flow without accumulating training fatigue.`,
      physiologicalWhy: `Safeguards recovery balance. Ideal when sleep or HRV signals caution or as an active rest day before high-intensity blocks.`,
      workoutSyntax: isRun
        ? `- 25m Easy conversational shakeout\n- 5m Mobility and stretching`
        : `- 30m 50% FTP (${Math.round(ftp * 0.5)}W) high-cadence spin\n- 5m Cooldown`,
      structuredSteps: [
        { label: 'Flush', duration: '30m', targetZoneOrOutput: isRun ? 'Zone 1 Recovery' : `${Math.round(ftp * 0.5)}W · Zone 1` },
        { label: 'Mobility', duration: '5m', targetZoneOrOutput: 'Stretching / Mobility' },
      ],
    },
  ];
}

export function buildDeterministicCoachChatResponse(
  message: string,
  telemetrySummary: CoachTelemetrySummary = {},
  todayStr: string
) {
  const w = telemetrySummary?.latestWellness || {};
  const t = telemetrySummary?.athleteThresholds || {};
  const hasCtl = w.ctl != null && Number(w.ctl) > 0;
  const hasHrv = w.hrvRMSSD != null && Number(w.hrvRMSSD) > 0;
  const hasSleep = w.sleepScore != null && Number(w.sleepScore) > 0;
  const ctl = hasCtl ? Number(w.ctl).toFixed(1) : null;
  const atl = hasCtl ? Number(w.atl || 0).toFixed(1) : null;
  const tsb = hasCtl ? Number(w.tsb ?? Number(ctl) - Number(atl)).toFixed(1) : null;
  const hrv = hasHrv ? Math.round(Number(w.hrvRMSSD)) : null;
  const hrvBaseline = hasHrv ? Math.round(Number(w.hrvBaseline7d || hrv)) : null;
  const hrvStatus = hasHrv
    ? String(w.hrvStatus || (hrv! < hrvBaseline! - 3 ? 'Unbalanced' : 'Balanced'))
    : null;
  const sleepHours = w.sleepSecs ? (Number(w.sleepSecs) / 3600).toFixed(1) : null;
  const sleepScore = hasSleep ? Math.round(Number(w.sleepScore)) : null;
  const statusLabel = w.garminTrainingStatus ? String(w.garminTrainingStatus) : null;
  const ftp = Math.round(Number(t.ftp || runtimeStore.athleteFtp || 250));
  const lthr = Math.round(Number(t.lthr || runtimeStore.athleteLthr || 165));
  const runLthr = Math.round(Number(t.runLthr || lthr));

  const addDays = (base: string, offset: number) => {
    const d = new Date(`${base}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  const isSuppressed =
    hrvStatus === 'Unbalanced' || hrvStatus === 'Low' || (tsb != null && Number(tsb) < -12);
  const wantsRunOnly = /\brun(ning)?\b/i.test(message) && !/\bcycl(e|ing)|bike|ride|trainer\b/i.test(message);
  const wantsMultiDay = /\b(week|5-day|schedule|plan|block|days)\b/i.test(message);

  const citedMetrics: string[] = [];
  if (sleepHours) citedMetrics.push(`Sleep ${sleepHours}h${sleepScore ? ` (${sleepScore})` : ''}`);
  if (hrv) citedMetrics.push(`HRV ${hrv} ms (${hrvStatus || 'Balanced'})`);
  if (ctl) citedMetrics.push(`CTL ${ctl} · TSB ${tsb}`);
  if (ftp) citedMetrics.push(`Cycling FTP ${ftp}W`);
  if (runLthr) citedMetrics.push(`Run LTHR ${runLthr} bpm`);

  let reply = '';
  const proposedWorkouts: ProposedCoachWorkout[] = [];

  if (wantsMultiDay) {
    reply = `### Microcycle Prescription (${todayStr})\n\nHere is your adaptive training microcycle structured against your physiological metrics:\n\n` +
      `- **Readiness Status:** ${hrvStatus || 'Calibrating'} (${hrv ? `HRV ${hrv} ms` : 'monitoring baselines'})\n` +
      `- **Chronic Training Load:** ${ctl ? `CTL ${ctl}, TSB ${tsb}` : 'Building 42d baseline'}\n\n` +
      `I've prepared ready-to-schedule workouts below. Tap **Add to Plan** on any workout to place it on your training calendar.`;

    const dayConfigs = wantsRunOnly
      ? [
          { day: 0, sport: 'Running', dur: 3600, load: 55, name: 'Zone 2 Aerobic Foundation', syntax: '- 10m Warmup\n- 40m Zone 2 aerobic pace\n- 10m Cooldown' },
          { day: 1, sport: 'Running', dur: 4500, load: 75, name: 'Threshold Cruise Intervals', syntax: '- 15m Warmup\n- 3x 8m at 92% LTHR (2m recovery)\n- 10m Cooldown' },
          { day: 2, sport: 'Running', dur: 2400, load: 30, name: 'Recovery Shakeout & Drills', syntax: '- 30m Conversational Zone 1 jog\n- 10m Mobility' },
          { day: 4, sport: 'Running', dur: 5400, load: 90, name: 'Long Aerobic Progression', syntax: '- 15m Easy\n- 55m Steady endurance\n- 20m Aerobic finish' },
        ]
      : [
          { day: 0, sport: 'Cycling', dur: 3600, load: 60, name: 'Sweet Spot Ramp', syntax: `- 10m 60% FTP\n- 30m 88% FTP (${Math.round(ftp * 0.88)}W)\n- 10m 55% FTP` },
          { day: 1, sport: 'Running', dur: 3600, load: 65, name: 'Tempo Aerobic Run', syntax: `- 10m Warmup\n- 35m Zone 3 tempo at ${Math.round(runLthr * 0.88)} bpm\n- 15m Cooldown` },
          { day: 2, sport: 'Cycling', dur: 2700, load: 35, name: 'Active Recovery Spin', syntax: `- 40m 50% FTP (${Math.round(ftp * 0.5)}W)\n- 5m Cooldown` },
          { day: 4, sport: 'Cycling', dur: 5400, load: 105, name: 'Over-Under Lactate Clearance', syntax: `- 15m Warmup\n- 3x 12m Over/Under (95%/105% FTP)\n- 15m Cooldown` },
        ];

    dayConfigs.forEach((cfg, idx) => {
      proposedWorkouts.push({
        id: `det-plan-${todayStr}-${idx}`,
        date: addDays(todayStr, cfg.day),
        name: cfg.name,
        sportCategory: cfg.sport,
        environmentPreference: 'OUTDOOR',
        description: `Prescribed by THRESH AI Coach based on ${hrvStatus || 'calibrated'} readiness.`,
        plannedLoad: cfg.load,
        plannedDurationSecs: cfg.dur,
        targetZoneSummary: `${cfg.load} TSS · AI Prescribed`,
        workoutSyntax: cfg.syntax,
        structuredSteps: parseWorkoutSyntaxToSteps(cfg.syntax, cfg.dur),
        source: 'AI_COACH' as const,
      });
    });
  } else {
    const recSport = wantsRunOnly ? 'Running' : 'Cycling';
    const recDur = 3600;
    const recLoad = isSuppressed ? 35 : 68;
    const recName = isSuppressed
      ? (recSport === 'Running' ? 'Aerobic Recovery Shakeout' : 'Autonomic Recovery Flush')
      : (recSport === 'Running' ? 'Threshold Cruise Intervals' : 'Sweet Spot Development');
    const recSyntax = isSuppressed
      ? (recSport === 'Running'
          ? '- 10m Warmup walk/jog\n- 25m Zone 1 conversational pace\n- 5m Cooldown'
          : `- 10m 50% FTP\n- 25m 55% FTP (${Math.round(ftp * 0.55)}W)\n- 10m 45% FTP`)
      : (recSport === 'Running'
          ? `- 10m Warmup\n- 3x 8m Threshold at ${runLthr} bpm (2m jog)\n- 10m Cooldown`
          : `- 10m 60% FTP\n- 3x 10m 90% FTP (${Math.round(ftp * 0.9)}W)\n- 10m 55% FTP`);

    reply = `### Physiological Assessment\n\n` +
      `Based on your telemetry snapshot for **${todayStr}**:\n\n` +
      `- **Autonomic State:** ${hrvStatus ? `${hrvStatus} (HRV ${hrv} ms)` : 'Calibrating baseline'}\n` +
      `- **Load Balance:** ${ctl ? `CTL ${ctl} · TSB ${tsb}` : '42-day baseline building'}\n` +
      `- **Prescription:** ${isSuppressed ? 'Modulated recovery session to restore autonomic tone.' : 'Productive aerobic workout to advance threshold power and pace.'}\n\n` +
      `I've formatted today's workout below. Tap **Add to Plan** to sync it to your schedule.`;

    proposedWorkouts.push({
      id: `det-single-${todayStr}`,
      date: todayStr,
      name: recName,
      sportCategory: recSport,
      environmentPreference: 'INDOOR',
      description: `Targeted session based on your current readiness (${hrvStatus || 'Calibrating'}).`,
      plannedLoad: recLoad,
      plannedDurationSecs: recDur,
      targetZoneSummary: `${recLoad} TSS · Prescribed Workout`,
      workoutSyntax: recSyntax,
      structuredSteps: parseWorkoutSyntaxToSteps(recSyntax, recDur),
      source: 'AI_COACH' as const,
    });
  }

  return {
    reply,
    citedMetrics,
    proposedWorkouts,
    engine: 'LOCAL_PHYSIOLOGY_ENGINE',
  };
}

async function resolveCallerYouthSafeguardStatus(
  req: Request,
  telemetrySummary?: CoachTelemetrySummary
): Promise<{ isMinorU18: boolean; forceZeroWeight: boolean }> {
  let isMinorU18 = false;
  let forceZeroWeight = Boolean(
    telemetrySummary?.athleteProfile?.safeSportHideWeight ||
      telemetrySummary?.safeSportHideWeight ||
      telemetrySummary?.enforceZeroWeight
  );

  const clientAgeCheck = resolveAthleteAgeTier({
    birthMonthYear:
      telemetrySummary?.athleteProfile?.birthMonthYear || telemetrySummary?.birthMonthYear,
  });
  if (clientAgeCheck.isMinorU18 || Boolean(telemetrySummary?.isMinorU18)) {
    isMinorU18 = true;
    forceZeroWeight = true;
  }

  const claims = getVerifiedSessionClaims(req);
  if (isCanonicalAuthenticatedClaims(claims)) {
    if (claims?.sub?.startsWith('usr_')) {
      const user = await getUserById(claims.sub).catch(() => null);
      if (user?.birthMonthYear) {
        const userAge = resolveAthleteAgeTier({ birthMonthYear: user.birthMonthYear });
        if (userAge.isMinorU18) {
          isMinorU18 = true;
          forceZeroWeight = true;
        }
      }
    }
    if (claims?.sid) {
      const teams = await listTeamsForUser(claims.sid, 'https://thresh.app').catch(() => []);
      for (const t of teams) {
        if (t.brand?.defaultSafeSportShield) {
          forceZeroWeight = true;
        }
        const myMem = t.memberships?.find((m) => m.userSid === claims.sid);
        if (myMem?.isMinorU18) {
          isMinorU18 = true;
          forceZeroWeight = true;
        }
      }
    }
  }

  return { isMinorU18, forceZeroWeight };
}

// Save Google Gemini API Key at Runtime (for AI Coach & Daily Workout Generator)
coachRouter.post('/api/gemini/config', async (req: Request, res: Response) => {
  const claims = getVerifiedSessionClaims(req);
  if (!isCanonicalAuthenticatedClaims(claims)) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const rawApiKey = String(req.body?.apiKey || req.body?.geminiApiKey || '').trim();
  runtimeStore.geminiApiKey = rawApiKey;
  await saveSessionCacheAsync(req, res);

  res.json({
    ok: true,
    hasGeminiServerKey: Boolean(runtimeStore.geminiApiKey),
  });
});

coachRouter.post('/api/coach/options', async (req: Request, res: Response) => {
  const rateCheck = checkAiRateLimit(getClientAiRateLimitKey(req));
  if (!rateCheck.allowed) {
    res.status(429).json({
      error: 'AI request limit reached. Please wait a moment before requesting another workout option.',
      retryAfterSecs: rateCheck.retryAfterSecs,
    });
    return;
  }

  const {
    sportPreference = 'Cycling',
    environmentPreference = 'INDOOR',
    durationMinutes = 60,
    telemetrySummary,
  } = req.body || {};

  const youthStatus = await resolveCallerYouthSafeguardStatus(req, telemetrySummary);
  const cleanTelemetry = sanitizeTelemetryForCleanRoom(telemetrySummary, {
    forceZeroWeight: youthStatus.forceZeroWeight,
    requireFirstPartyProvenance: true,
  });

  try {
    const ai =
      !isAuthorizedForAi(req) || youthStatus.isMinorU18 ? null : getGeminiClient(req);
    if (!ai) {
      res.json({
        options: buildDeterministicDailyWorkoutOptions(
          sportPreference,
          environmentPreference,
          durationMinutes,
          cleanTelemetry
        ),
        engine: 'LOCAL_PHYSIOLOGY_ENGINE',
      });
      return;
    }

    const prompt = `
You are THRESH AI Coach, an elite endurance sports physiologist and dual-sport running & cycling coach.
Generate 3 distinct, actionable daily workout options for today based on the athlete's live first-party Garmin health, sleep, HRV status, Training Status, and calibrated threshold telemetry:
- Preferred Sport for Today: ${sportPreference}
- Preferred Environment: ${environmentPreference} (e.g., OUTDOOR road/trail vs INDOOR Smart Trainer/Treadmill)
- Available Duration: ${durationMinutes} minutes
- Clean-Room Athlete Telemetry Context: ${JSON.stringify(cleanTelemetry)}

Return an array of 3 workout options in JSON matching the schema:
1. Tier "OPTIMAL" (Option A · Optimal Progression — pushes toward race/FTP/pace goals when readiness permits)
2. Tier "MODULATED" (Option B · Modulated Aerobic Durability — steady Zone 2 / controlled tempo advancing mileage with low autonomic cost)
3. Tier "RECOVERY" (Option C · Active Parasympathetic Recovery — low-strain Zone 1 spin/jog + mobility)
Include workoutSyntax (e.g., "- 10m 60% FTP\\n- 30m 85% FTP\\n- 10m 55% FTP") for each option.
`;

    const response = await generateGeminiContentWithFallback(ai, {
      contents: prompt,
      config: {
        systemInstruction:
          'Always cite exact numbers from the athlete telemetry (Garmin Sleep Score, Sleep Duration, HRV in ms vs 7d/60d baseline corridor, Garmin Training Status, Resting HR, CTL/ATL/TSB, eFTP, and annual mileage progress). Keep workout intervals crisp and practical.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              tier: { type: Type.STRING },
              tierLabel: { type: Type.STRING },
              title: { type: Type.STRING },
              sportCategory: { type: Type.STRING },
              environment: { type: Type.STRING },
              durationMinutes: { type: Type.INTEGER },
              estimatedLoad: { type: Type.INTEGER },
              summary: { type: Type.STRING },
              physiologicalWhy: { type: Type.STRING },
              workoutSyntax: { type: Type.STRING },
              structuredSteps: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    duration: { type: Type.STRING },
                    targetZoneOrOutput: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      },
    });

    const jsonText = (response.text ?? '[]').trim();
    const parsed = JSON.parse(jsonText);
    res.json({ options: parsed, engine: 'GEMINI_LIVE' });
  } catch {
    res.json({
      options: buildDeterministicDailyWorkoutOptions(
        sportPreference,
        environmentPreference,
        durationMinutes,
        cleanTelemetry
      ),
      engine: 'LOCAL_PHYSIOLOGY_ENGINE',
    });
  }
});

coachRouter.post('/api/coach/chat', async (req: Request, res: Response) => {
  if (!isAuthorizedForAi(req)) {
    res.status(401).json({
      error: 'Valid authenticated session or x-gemini-api-key required.',
    });
    return;
  }

  const rateCheck = checkAiRateLimit(getClientAiRateLimitKey(req));
  if (!rateCheck.allowed) {
    res.status(429).json({
      error: 'AI request limit reached. Please wait a moment before sending another message.',
      retryAfterSecs: rateCheck.retryAfterSecs,
    });
    return;
  }

  const { message, history = [], telemetrySummary } = req.body || {};
  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'Message is required.' });
    return;
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const youthStatus = await resolveCallerYouthSafeguardStatus(req, telemetrySummary);
  const cleanTelemetry = sanitizeTelemetryForCleanRoom(telemetrySummary, {
    forceZeroWeight: youthStatus.forceZeroWeight,
    requireFirstPartyProvenance: true,
  });

  try {
    const ai = youthStatus.isMinorU18 ? null : getGeminiClient(req);
    if (!ai) {
      res.json(buildDeterministicCoachChatResponse(message, cleanTelemetry, todayStr));
      return;
    }

    const conversationContext = Array.isArray(history)
      ? history
          .slice(-8)
          .map((m: { role: string; content: string }) => `${m.role.toUpperCase()}: ${m.content}`)
          .join('\n\n')
      : '';

    const response = await generateGeminiContentWithFallback(ai, {
      contents: `
TODAY'S DATE: ${todayStr}

ATHLETE CLEAN-ROOM HEALTH, SLEEP, READINESS & CALIBRATED TELEMETRY SNAPSHOT:
${JSON.stringify(cleanTelemetry, null, 2)}

RECENT CONVERSATION:
${conversationContext}

ATHLETE QUESTION OR PROGRAM REQUEST:
${message}
`,
      config: {
        systemInstruction: `You are THRESH AI Coach, an elite exercise physiologist and dual-sport running & cycling performance coach inside THRESH (THRESH — Run & Ride Readiness).
1. Ground every answer in the athlete's actual clean-room metrics provided in the snapshot: Sleep Score & Duration, 7d Sleep Debt, HRV Status & rMSSD (ms) vs baseline corridor, Training Status, Resting HR, CTL/ATL/TSB, Load Ratio (ACWR), calibrated Cycling FTP/eFTP, Running Threshold Pace, and first-party workouts. Never invent metrics that are missing or null—state clearly when calibration is needed.
2. Whenever the user asks about today's workout, tomorrow's session, or a multi-day / weekly cycling or running training plan, ALWAYS populate "proposedWorkouts" with 1 to 7 concrete, ready-to-schedule workouts (with exact YYYY-MM-DD dates starting from ${todayStr}, sportCategory "Cycling" or "Running", environmentPreference "OUTDOOR" or "INDOOR", plannedDurationSecs, plannedLoad, and step workoutSyntax lines starting with "- ").`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: {
              type: Type.STRING,
              description:
                'Clear, quantitative markdown coaching response referencing the athlete’s exact sleep, HRV, Training Status, CTL/ATL/TSB, and power/pace zones.',
            },
            citedMetrics: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description:
                '3 to 5 short metric badges cited in the analysis (e.g., "Sleep 7h 19m (Score 75)", "HRV 38 ms", "CTL 72.4 / TSB +14.7", "Cycling eFTP 310W").',
            },
            proposedWorkouts: {
              type: Type.ARRAY,
              description:
                '1 to 7 structured workouts that the athlete can schedule onto their Training Calendar with 1 click.',
              items: {
                type: Type.OBJECT,
                properties: {
                  date: { type: Type.STRING, description: 'YYYY-MM-DD date for the workout' },
                  name: { type: Type.STRING, description: 'Concise workout title' },
                  sportCategory: { type: Type.STRING, description: 'Cycling or Running' },
                  environmentPreference: {
                    type: Type.STRING,
                    description: 'OUTDOOR, INDOOR, or FLEXIBLE',
                  },
                  plannedDurationSecs: {
                    type: Type.INTEGER,
                    description: 'Total duration in seconds (e.g. 3600 for 60m)',
                  },
                  plannedLoad: {
                    type: Type.INTEGER,
                    description: 'Estimated TSS training load',
                  },
                  workoutSyntax: {
                    type: Type.STRING,
                    description:
                      'Intervals.icu step syntax, each step on a new line starting with "- " (e.g. "- 10m 60% FTP\\n- 4x 5m 105% FTP\\n- 10m 55% FTP")',
                  },
                  description: {
                    type: Type.STRING,
                    description: '1-sentence coaching rationale for this session',
                  },
                },
              },
            },
          },
        },
      },
    });

    const rawText = (response.text ?? '{}').trim();
    const parsed = JSON.parse(rawText) as {
      reply?: string;
      citedMetrics?: string[];
      proposedWorkouts?: RawAiProposedWorkout[];
    };
    const proposedWorkouts = Array.isArray(parsed.proposedWorkouts)
      ? parsed.proposedWorkouts.map((pw, i: number) => {
          const dur = Number(pw.plannedDurationSecs || 3600);
          const syntax = String(pw.workoutSyntax || '- 15m 65% FTP\n- 30m 85% FTP\n- 15m 55% FTP');
          return {
            id: `ai-prop-${Date.now()}-${i}`,
            date: String(pw.date || todayStr).slice(0, 10),
            name: String(pw.name || 'AI Prescribed Session'),
            sportCategory: /run/i.test(String(pw.sportCategory || '')) ? 'Running' : 'Cycling',
            environmentPreference: /indoor/i.test(String(pw.environmentPreference || ''))
              ? 'INDOOR'
              : /outdoor/i.test(String(pw.environmentPreference || ''))
                ? 'OUTDOOR'
                : 'FLEXIBLE',
            description: String(pw.description || syntax),
            plannedLoad: Number(pw.plannedLoad || 65),
            plannedDurationSecs: dur,
            targetZoneSummary: `${pw.plannedLoad || 65} TSS · AI Coach Prescription`,
            workoutSyntax: syntax,
            structuredSteps: parseWorkoutSyntaxToSteps(syntax, dur),
            source: 'AI_COACH' as const,
          };
        })
      : [];

    res.json({
      reply: parsed.reply || 'Here is my analysis based on your physiological profile.',
      citedMetrics: Array.isArray(parsed.citedMetrics) ? parsed.citedMetrics : [],
      proposedWorkouts,
      engine: 'GEMINI_LIVE',
    });
  } catch {
    res.json(buildDeterministicCoachChatResponse(message, cleanTelemetry, todayStr));
  }
});

// Parse Official Race Results from Athletic.net, TFRRS, MileSplit, or RunSignup URL / Raw Text
coachRouter.post(['/api/races/parse', '/races/parse'], async (req: Request, res: Response) => {
  const rateCheck = checkAiRateLimit(getClientAiRateLimitKey(req));
  if (!rateCheck.allowed) {
    res.status(429).json({
      error: 'Race parser rate limit reached. Please wait a moment.',
      retryAfterSecs: rateCheck.retryAfterSecs,
    });
    return;
  }

  try {
    const { url, rawText } = req.body as { url?: string; rawText?: string };
    let fetchedTextSnippet = '';
    let fetchNote = '';

    if (url && typeof url === 'string' && /^https?:\/\//i.test(url.trim())) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6500);
        const remoteResp = await assertSafeExternalFetch(
          url.trim(),
          {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
            },
            signal: controller.signal,
          },
          2
        );
        clearTimeout(timeoutId);
        if (!remoteResp) {
          fetchNote = 'Blocked unsafe, private-DNS, or cross-network redirect URL; parsed provided text only.';
        } else if (remoteResp.ok) {
          const html = await remoteResp.text();
          fetchedTextSnippet = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<\/?(tr|p|div|li|br|h1|h2|h3|h4|table)[^>]*>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{2,}/g, '\n')
            .slice(0, 18000);
        } else {
          fetchNote = `Remote site returned HTTP ${remoteResp.status}; parsed provided text.`;
        }
      } catch {
        fetchNote =
          'Remote platform throttled direct crawler access; parsed pasted results text.';
      }
    }

    const combinedInput = [
      url ? `SOURCE URL: ${url}` : '',
      rawText ? `USER PASTED RESULTS:\n${rawText}` : '',
      fetchedTextSnippet ? `FETCHED PAGE CONTENT:\n${fetchedTextSnippet}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    if (!combinedInput.trim()) {
      res.status(400).json({ error: 'Provide an Athletic.net / TFRRS / MileSplit URL or pasted race results text.' });
      return;
    }

    const ai = getGeminiClient(req);
    if (ai) {
      try {
        const response = await generateGeminiContentWithFallback(ai, {
          contents: `Extract all official track & field, cross country, or road race results from the following input (from Athletic.net, TFRRS, MileSplit, RunSignup, or meet result tables).
Convert every race into structured JSON with exact FAT time in seconds (to 0.01s precision, e.g. "1:56.38" -> 116.38, "4:16.42" -> 256.42), eventLabel ("400m", "800m", "1500m", "1600m", "1 Mile", "3000m", "3200m", "5000m", "10000m", "XC 5K", "Road 5K", "Half Marathon"), eventDistanceMeters, date (YYYY-MM-DD), meetName, placeFinish, platform ("Athletic.net", "TFRRS", "MileSplit", "RunSignup", or "Official FAT"), trackType ("OUTDOOR_400M", "INDOOR_BANKED_200M", "INDOOR_FLAT_200M", "XC_COURSE", or "ROAD"), and lapSplitsSecs (array of lap split times in seconds if present).

INPUT:
${combinedInput}`,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                races: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      date: { type: Type.STRING, description: 'YYYY-MM-DD' },
                      meetName: { type: Type.STRING },
                      eventLabel: { type: Type.STRING, description: 'e.g. 800m, 1500m, 1600m, 3200m, XC 5K' },
                      eventDistanceMeters: { type: Type.NUMBER },
                      displayFatTime: { type: Type.STRING, description: 'e.g. 1:56.38 or 4:16.42' },
                      fatTimeSecs: { type: Type.NUMBER, description: 'Total seconds with decimals, e.g. 116.38' },
                      platform: { type: Type.STRING, description: 'Athletic.net, TFRRS, MileSplit, RunSignup, or Official FAT' },
                      trackType: { type: Type.STRING, description: 'OUTDOOR_400M, INDOOR_BANKED_200M, INDOOR_FLAT_200M, XC_COURSE, or ROAD' },
                      placeFinish: { type: Type.STRING },
                      windReading: { type: Type.STRING },
                      lapSplitsSecs: {
                        type: Type.ARRAY,
                        items: { type: Type.NUMBER },
                      },
                    },
                  },
                },
              },
            },
          },
        });

        const parsedJson = JSON.parse((response.text ?? '{}').trim());
        if (Array.isArray(parsedJson.races) && parsedJson.races.length > 0) {
          res.json({
            races: parsedJson.races,
            fetchNote,
            source: 'GEMINI_STRUCTURED',
          });
          return;
        }
      } catch {
        // Fall through to deterministic response so the client parser handles it cleanly
      }
    }

    res.json({
      races: [],
      fetchNote:
        fetchNote ||
        'Used fast local deterministic parser for Athletic.net / TFRRS / MileSplit table rows.',
      source: 'CLIENT_DETERMINISTIC',
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to parse official race results.',
    });
  }
});
