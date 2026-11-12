import type {
  AthleteProfile,
  PostWorkoutDebriefReport,
  SportCategory,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import { classifyActivityGarminLoad } from '../components/charts/EChartsPMCDashboard';
import { generatePostWorkoutDebrief } from './workoutDebrief';

export type TrainingProductivityVerdict =
  | 'PRODUCTIVE'
  | 'PEAKING'
  | 'POLARIZATION_DEFICIT'
  | 'MAINTAINING'
  | 'RECOVERY'
  | 'OVERREACHING'
  | 'DETRAINING'
  | 'CALIBRATING';

export type LoadSystemBucketKey = 'LOW_AEROBIC' | 'HIGH_AEROBIC' | 'NEUROMUSCULAR';

export interface ThreeSystemLoadBreakdown {
  totalLoad: number;
  lowAerobicLoad: number;
  highAerobicLoad: number;
  neuromuscularLoad: number;
  dominantSystem: LoadSystemBucketKey;
  zoneSource: 'POWER' | 'PACE' | 'HR' | 'INTENSITY_MODEL';
}

export interface LoadFocusBucketSummary {
  key: LoadSystemBucketKey;
  label: string;
  shortLabel: string;
  zoneSubtitle: string;
  colorHex: string;
  loadPts: number;
  sharePct: number; // 0..100
  targetMinPct: number;
  targetMaxPct: number;
  targetMinPts: number;
  targetMaxPts: number;
  status: 'OPTIMAL' | 'SHORTFALL' | 'HEAVY';
  deltaPtsToTarget: number; // negative = pts needed to hit target floor, positive = pts above ceiling, 0 = inside box
}

export interface RollingDayLoadPoint {
  date: string;
  dayShort: string;
  totalLoad: number;
  lowAerobicLoad: number;
  highAerobicLoad: number;
  neuromuscularLoad: number;
  hrvMs: number;
  sleepScore: number;
}

export interface GapFillingPrescription {
  primaryDeficit:
    | 'LOW_AEROBIC'
    | 'HIGH_AEROBIC'
    | 'NEUROMUSCULAR'
    | 'RECOVERY_NEEDED'
    | 'BALANCED';
  focusBadge: string;
  headline: string;
  rationale: string;
  recommendedSport: SportCategory;
  recommendedTitleCycling: string;
  recommendedTitleRunning: string;
  recommendedDurationMins: number;
  recommendedTss: number;
  workoutSyntaxCycling: string;
  workoutSyntaxRunning: string;
}

export interface TrainingProductivitySummary {
  asOfDateIso: string;
  windowStartIso: string;
  verdict: TrainingProductivityVerdict;
  verdictLabel: string;
  verdictTone: 'prime' | 'info' | 'caution' | 'strained';
  headlineWhy: string;
  actionCallout: string;
  // 7-Day Rolling Load & Strain Corridor
  acuteLoad7d: number;
  chronicWeeklyLoad: number;
  optimalLoadMin: number;
  optimalLoadMax: number;
  loadTunnelStatus: 'UNDER' | 'OPTIMAL' | 'HIGH';
  acwr: number;
  ctl: number;
  atl: number;
  tsb: number;
  ctlRamp7d: number;
  // Autonomic & Sleep Absorption
  autonomicState: 'PRIME' | 'BALANCED' | 'CAUTION' | 'SUPPRESSED';
  hrvLatestMs: number;
  hrv7dAvgMs: number;
  hrvNormalFloorMs: number;
  rhrLatestBpm: number;
  rhrDeltaBpm: number;
  sleepScoreLatest: number;
  sleepHoursLatest: number;
  sleepScore7dAvg: number;
  readinessScore: number; // 0..100 composite morning readiness
  // Physiological Efficiency Response (Output per Heartbeat vs 28d Sport Baseline)
  efDeltaPct: number | null;
  efPrimarySport: 'Cycling' | 'Running';
  ef7dAvg: number | null;
  ef28dBaseline: number | null;
  // 3-Bucket Load Focus
  buckets: [
    LoadFocusBucketSummary,
    LoadFocusBucketSummary,
    LoadFocusBucketSummary,
  ];
  dailyWindow: RollingDayLoadPoint[];
  gapPrescription: GapFillingPrescription;
  activityCount7d: number;
}

export interface SessionZoneBarSegment {
  zone: string;
  label: string;
  pct: number;
  secs: number;
  colorHex: string;
}

export interface SessionImpactReceipt {
  isTodaySession: boolean;
  sessionDateIso: string;
  activities: UnifiedActivity[];
  primaryActivity: UnifiedActivity;
  combinedTitle: string;
  totalLoad: number;
  totalDurationMins: number;
  // 7-Day Needle Shift (Before -> After)
  verdictBefore: TrainingProductivityVerdict;
  verdictBeforeLabel: string;
  verdictAfter: TrainingProductivityVerdict;
  verdictAfterLabel: string;
  didImproveStatus: boolean;
  acuteLoadBefore: number;
  acuteLoadAfter: number;
  optimalLoadMin: number;
  optimalLoadMax: number;
  addedLowAerobicPts: number;
  addedHighAerobicPts: number;
  addedNeuromuscularPts: number;
  bucketShiftHighlights: {
    key: LoadSystemBucketKey;
    shortLabel: string;
    colorHex: string;
    addedPts: number;
    shareBeforePct: number;
    shareAfterPct: number;
    closedDeficit: boolean;
    insideTargetNow: boolean;
  }[];
  needleHeadline: string;
  // Performance Receipt vs Rolling Baseline
  primaryOutputLabel: string;
  primaryOutputValue: string;
  secondaryOutputValue: string;
  efValue: number | null;
  efBaseline28d: number | null;
  efDeltaPct: number | null;
  decouplingPct: number | null;
  decouplingVerdict: string;
  decouplingTone: 'prime' | 'caution' | 'strained' | 'neutral';
  hrZones5: SessionZoneBarSegment[];
  powerZones7: SessionZoneBarSegment[];
  debriefReport: PostWorkoutDebriefReport | null;
  recoveryHours: number;
  tomorrowHeadline: string;
}

/**
 * Returns local calendar YYYY-MM-DD (avoids UTC rollover at 4-5 PM in US timezones).
 */
export function getLocalDateIso(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Shifts a YYYY-MM-DD calendar string by `deltaDays` without DST drift.
 */
export function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const [yStr, mStr, dStr] = isoDate.slice(0, 10).split('-');
  const dt = new Date(
    Date.UTC(Number(yStr) || 2026, (Number(mStr) || 1) - 1, Number(dStr) || 1)
  );
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function formatDayShort(isoDate: string): string {
  const [yStr, mStr, dStr] = isoDate.slice(0, 10).split('-');
  const dt = new Date(
    Date.UTC(Number(yStr) || 2026, (Number(mStr) || 1) - 1, Number(dStr) || 1)
  );
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return names[dt.getUTCDay()] || isoDate.slice(5);
}

function formatPaceMmSs(secsPerKm: number, useMiles = false): string {
  const secs = useMiles ? secsPerKm * 1.60934 : secsPerKm;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  const unit = useMiles ? '/mi' : '/km';
  return s === 60 ? `${m + 1}:00${unit}` : `${m}:${String(s).padStart(2, '0')}${unit}`;
}

export const VERDICT_META: Record<
  TrainingProductivityVerdict,
  { label: string; tone: 'prime' | 'info' | 'caution' | 'strained' }
> = {
  PRODUCTIVE: { label: 'Productive', tone: 'prime' },
  PEAKING: { label: 'Peaking', tone: 'info' },
  POLARIZATION_DEFICIT: { label: 'Polarization Deficit', tone: 'caution' },
  MAINTAINING: { label: 'Maintaining', tone: 'info' },
  RECOVERY: { label: 'Recovery', tone: 'info' },
  OVERREACHING: { label: 'High Strain', tone: 'strained' },
  DETRAINING: { label: 'Detraining', tone: 'caution' },
  CALIBRATING: { label: 'Calibrating', tone: 'info' },
};

/**
 * Estimates fallback TSS when an activity has zero explicit trainingLoad.
 */
function resolveActivityEffectiveLoad(
  activity: UnifiedActivity,
  profile?: AthleteProfile | null
): number {
  const explicit = Number(activity.trainingLoad || 0);
  if (explicit > 0) return explicit;
  const hrs = Math.max(0, (activity.movingTimeSecs || 0) / 3600);
  if (hrs <= 0.05) return 0;

  const ftp =
    activity.sportCategory === 'Running'
      ? profile?.runFtp || 350
      : activity.environment === 'INDOOR'
        ? profile?.indoorFtp || profile?.ftp || 280
        : profile?.ftp || 280;
  const np = Number(activity.normalizedPower || activity.avgPower || 0);
  if (np > 40 && ftp > 60) {
    const ifVal = Math.min(1.35, Math.max(0.35, np / ftp));
    return Math.round(hrs * ifVal * ifVal * 100);
  }

  const lthr =
    activity.sportCategory === 'Running'
      ? profile?.runLthr || profile?.lthr || 162
      : profile?.lthr || 160;
  if (activity.avgHr > 70 && lthr > 100) {
    const hrRatio = Math.min(1.15, Math.max(0.45, activity.avgHr / lthr));
    return Math.round(hrs * hrRatio * hrRatio * 82);
  }
  return Math.round(hrs * 45);
}

/**
 * Distributes a single workout's TSS across Low Aerobic (Z1-Z2), High Aerobic (Z3-Z4),
 * and Neuromuscular / Anaerobic (Z5-Z7) using actual time-in-zone strain weights first,
 * falling back to intensity-factor / variability modeling when zone seconds are absent.
 */
export function partitionActivityLoadBuckets(
  activity: UnifiedActivity,
  profile?: AthleteProfile | null
): ThreeSystemLoadBreakdown {
  const totalLoad = resolveActivityEffectiveLoad(activity, profile);
  if (totalLoad <= 0) {
    return {
      totalLoad: 0,
      lowAerobicLoad: 0,
      highAerobicLoad: 0,
      neuromuscularLoad: 0,
      dominantSystem: 'LOW_AEROBIC',
      zoneSource: 'INTENSITY_MODEL',
    };
  }

  const pwr = activity.zoneSecs?.power || [];
  const pace = activity.zoneSecs?.pace || [];
  const hr = activity.zoneSecs?.hr || [];

  const totalPwrSecs = pwr.reduce((acc, v) => acc + (v || 0), 0);
  const totalPaceSecs = pace.reduce((acc, v) => acc + (v || 0), 0);
  const totalHrSecs = hr.reduce((acc, v) => acc + (v || 0), 0);

  let lowWeight = 0;
  let highWeight = 0;
  let neuroWeight = 0;
  let zoneSource: ThreeSystemLoadBreakdown['zoneSource'] = 'INTENSITY_MODEL';

  if (totalPwrSecs >= 60) {
    // 7-Zone Coggan Power quadratic strain weights (IF^2 proportional)
    zoneSource = 'POWER';
    lowWeight = (pwr[0] || 0) * 0.30 + (pwr[1] || 0) * 0.56;
    highWeight = (pwr[2] || 0) * 0.80 + (pwr[3] || 0) * 1.02;
    neuroWeight =
      (pwr[4] || 0) * 1.32 + (pwr[5] || 0) * 1.85 + (pwr[6] || 0) * 2.60;
  } else if (totalPaceSecs >= 60) {
    zoneSource = 'PACE';
    lowWeight = (pace[0] || 0) * 0.34 + (pace[1] || 0) * 0.58;
    highWeight = (pace[2] || 0) * 0.82 + (pace[3] || 0) * 1.04;
    neuroWeight =
      (pace[4] || 0) * 1.30 + (pace[5] || 0) * 1.75 + (pace[6] || 0) * 2.30;
  } else if (totalHrSecs >= 60) {
    zoneSource = 'HR';
    // Works seamlessly for both Garmin 5-Zone HR ([Z1..Z5, 0, 0]) and 7-Zone HR ([Z1..Z7])
    lowWeight = (hr[0] || 0) * 0.35 + (hr[1] || 0) * 0.60;
    highWeight = (hr[2] || 0) * 0.85 + (hr[3] || 0) * 1.08;
    neuroWeight =
      (hr[4] || 0) * 1.40 + (hr[5] || 0) * 1.75 + (hr[6] || 0) * 2.10;

    // Compensate for cardiac lag on short sprint/neuromuscular surges when HR-only
    const vi =
      activity.variabilityIndex && activity.variabilityIndex > 0
        ? activity.variabilityIndex
        : activity.normalizedPower && activity.avgPower && activity.avgPower > 0
          ? activity.normalizedPower / activity.avgPower
          : 1.0;
    const hasNeuroIntent =
      /\b(sprint|sprints|strides|opener|openers|hill repeats|track|200m|400m|crit|zwift race|microburst|neuromuscular|hiit)\b/i.test(
        activity.name || ''
      ) || vi >= 1.13;
    const sumBefore = lowWeight + highWeight + neuroWeight;
    if (hasNeuroIntent && sumBefore > 0 && neuroWeight / sumBefore < 0.16) {
      neuroWeight = Math.max(neuroWeight, sumBefore * 0.18);
    }
  } else {
    // Summary-level fallback using Garmin Focus Classifier + physiological warmup/cooldown distribution
    const focus = classifyActivityGarminLoad(activity, {
      ftp: profile?.ftp || 290,
      lthr: profile?.lthr || 162,
      maxHr: profile?.maxHr || 185,
      thresholdPaceSecsPerKm: profile?.thresholdPaceSecsPerKm || 250,
    });
    if (focus.type === 'ANAEROBIC') {
      lowWeight = 0.34;
      highWeight = 0.32;
      neuroWeight = 0.34;
    } else if (focus.type === 'HIGH_AEROBIC') {
      lowWeight = 0.32;
      highWeight = 0.58;
      neuroWeight = 0.10;
    } else {
      lowWeight = 0.88;
      highWeight = 0.10;
      neuroWeight = 0.02;
    }
  }

  const weightSum = Math.max(1e-6, lowWeight + highWeight + neuroWeight);
  const lowAerobicLoad = Number(((totalLoad * lowWeight) / weightSum).toFixed(1));
  const highAerobicLoad = Number(((totalLoad * highWeight) / weightSum).toFixed(1));
  const neuromuscularLoad = Number(
    Math.max(0, totalLoad - lowAerobicLoad - highAerobicLoad).toFixed(1)
  );

  let dominantSystem: LoadSystemBucketKey = 'LOW_AEROBIC';
  if (neuromuscularLoad >= totalLoad * 0.22 || neuromuscularLoad > highAerobicLoad && neuromuscularLoad > lowAerobicLoad) {
    dominantSystem = 'NEUROMUSCULAR';
  } else if (highAerobicLoad >= totalLoad * 0.38 || highAerobicLoad > lowAerobicLoad) {
    dominantSystem = 'HIGH_AEROBIC';
  }

  return {
    totalLoad,
    lowAerobicLoad,
    highAerobicLoad,
    neuromuscularLoad,
    dominantSystem,
    zoneSource,
  };
}

/**
 * Computes EWMA CTL (42d) & ATL (7d) directly from activities when wellness history has no pre-computed CTL.
 */
function computeFallbackPmcAtDate(
  activities: UnifiedActivity[],
  asOfDateIso: string,
  profile?: AthleteProfile | null
): { ctl: number; atl: number; tsb: number; ctlRamp7d: number } {
  const startIso = shiftIsoDate(asOfDateIso, -84);
  if (activities.length === 0) {
    return { ctl: 0, atl: 0, tsb: 0, ctlRamp7d: 0 };
  }

  const loadByDate = new Map<string, number>();
  for (const act of activities) {
    const d = (act.startDateLocal || '').slice(0, 10);
    if (!d || d < startIso || d > asOfDateIso) continue;
    loadByDate.set(d, (loadByDate.get(d) || 0) + resolveActivityEffectiveLoad(act, profile));
  }

  let ctl = 0;
  let atl = 0;
  let ctl7dAgo = 0;
  const sevenDaysAgoIso = shiftIsoDate(asOfDateIso, -7);

  for (let offset = -84; offset <= 0; offset++) {
    const dIso = shiftIsoDate(asOfDateIso, offset);
    const load = loadByDate.get(dIso) || 0;
    ctl = ctl + (load - ctl) / 42;
    atl = atl + (load - atl) / 7;
    if (dIso === sevenDaysAgoIso) {
      ctl7dAgo = ctl;
    }
  }

  return {
    ctl: Number(ctl.toFixed(1)),
    atl: Number(atl.toFixed(1)),
    tsb: Number((ctl - atl).toFixed(1)),
    ctlRamp7d: Number((ctl - ctl7dAgo).toFixed(1)),
  };
}

function buildBucketSummary(
  key: LoadSystemBucketKey,
  label: string,
  shortLabel: string,
  zoneSubtitle: string,
  colorHex: string,
  rawPts: number,
  total7dPts: number,
  referenceScalePts: number,
  targetMinPct: number,
  targetMaxPct: number
): LoadFocusBucketSummary {
  const loadPts = Math.round(rawPts);
  const sharePct =
    total7dPts > 0 ? Math.round((rawPts / total7dPts) * 100) : 0;
  const targetMinPts = Math.round((referenceScalePts * targetMinPct) / 100);
  const targetMaxPts = Math.round((referenceScalePts * targetMaxPct) / 100);

  let status: LoadFocusBucketSummary['status'] = 'OPTIMAL';
  let deltaPtsToTarget = 0;

  if (total7dPts > 0) {
    if (loadPts < targetMinPts && sharePct < targetMinPct) {
      status = 'SHORTFALL';
      deltaPtsToTarget = loadPts - targetMinPts; // negative = pts needed
    } else if (loadPts > targetMaxPts && sharePct > targetMaxPct) {
      status = 'HEAVY';
      deltaPtsToTarget = loadPts - targetMaxPts; // positive = surplus pts
    }
  } else {
    status = 'SHORTFALL';
    deltaPtsToTarget = -targetMinPts;
  }

  return {
    key,
    label,
    shortLabel,
    zoneSubtitle,
    colorHex,
    loadPts,
    sharePct,
    targetMinPct,
    targetMaxPct,
    targetMinPts,
    targetMaxPts,
    status,
    deltaPtsToTarget,
  };
}

function formatRunPaceKm(secsPerKm: number): string {
  const clamped = Math.max(135, Math.min(600, Math.round(secsPerKm)));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${mins}:${String(secs).padStart(2, '0')}/km`;
}

function buildGapFillingPrescription(params: {
  verdict: TrainingProductivityVerdict;
  autonomicState: TrainingProductivitySummary['autonomicState'];
  buckets: [
    LoadFocusBucketSummary,
    LoadFocusBucketSummary,
    LoadFocusBucketSummary,
  ];
  primarySport: SportCategory;
  profile?: AthleteProfile | null;
}): GapFillingPrescription {
  const { verdict, autonomicState, buckets, primarySport, profile } = params;
  const [lowBucket, highBucket, neuroBucket] = buckets;
  const ftp = profile?.ftp || 290;
  const runLthr = profile?.runLthr || profile?.lthr || 168;
  const z2MaxBpm =
    profile?.hrZones?.[1]?.maxBpm ||
    Math.round(((primarySport === 'Running' ? runLthr : profile?.lthr) || 160) * 0.88);
  const ssMidPct = Math.round(
    ((profile?.sweetSpotMinPct || 86) + (profile?.sweetSpotMaxPct || 94)) / 2
  );
  const ltPaceSecs = profile?.thresholdPaceSecsPerKm || 250;
  const runEasyPace = formatRunPaceKm(ltPaceSecs * 1.32);
  const runZ2Pace = formatRunPaceKm(ltPaceSecs * 1.22);
  const runTempoPace = formatRunPaceKm(ltPaceSecs * 1.07);
  const runLtPace = formatRunPaceKm(ltPaceSecs);
  const runStridePace = formatRunPaceKm(ltPaceSecs * 0.84);

  // 1. Overreaching or Suppressed Autonomics -> Parasympathetic Flush
  if (verdict === 'OVERREACHING' || autonomicState === 'SUPPRESSED') {
    const outputCue =
      primarySport === 'Running'
        ? `conversational pace ~${runEasyPace}`
        : `≤64% FTP / ~${Math.round(ftp * 0.62)}W`;
    return {
      primaryDeficit: 'RECOVERY_NEEDED',
      focusBadge: '🛡️ Autonomic Recovery Cap',
      headline: 'Cap intensity at strict Z1/Z2 to absorb recent acute strain',
      rationale: `Acute strain or overnight autonomic markers warrant parasympathetic recovery today. Keep HR ≤${z2MaxBpm} bpm (${outputCue}) so recent work converts into fitness.`,
      recommendedSport: primarySport === 'Running' ? 'Running' : 'Cycling',
      recommendedTitleCycling: '45m Z1/Z2 Parasympathetic Capillary Spin',
      recommendedTitleRunning: '35m Z1/Z2 Easy Recovery Shakeout',
      recommendedDurationMins: primarySport === 'Running' ? 35 : 45,
      recommendedTss: 28,
      workoutSyntaxCycling: `- 10m 50% FTP Smooth Spin\n- 25m 62% FTP Z2 Capillary Flush\n- 10m 48% FTP Cooldown`,
      workoutSyntaxRunning: `- 10m 74% Pace (${runEasyPace}) Easy Shakeout Jog\n- 18m 80% Pace (${runZ2Pace} · ≤${z2MaxBpm} bpm) Z2 Relaxed Aerobic\n- 7m 70% Pace Walk/Jog Cooldown`,
    };
  }

  // 2. Neuromuscular Shortfall when Autonomics are Prime/Balanced
  if (
    neuroBucket.status === 'SHORTFALL' &&
    (autonomicState === 'PRIME' || autonomicState === 'BALANCED')
  ) {
    const needed = Math.max(12, Math.abs(neuroBucket.deltaPtsToTarget));
    return {
      primaryDeficit: 'NEUROMUSCULAR',
      focusBadge: `⚡ Neuromuscular Shortfall (${neuroBucket.sharePct}% vs 6–14%)`,
      headline: `Add neuromuscular surges + Z2 base (+${needed} Neuro pts needed)`,
      rationale: `Your 7-day Neuromuscular/VO2 bucket is only ${neuroBucket.sharePct}% while autonomic readiness is ${autonomicState.toLowerCase()}. Pairing crisp 15–20s neuromuscular bursts inside a Z2 aerobic ride/run recruits fast-twitch motor units without heavy glycolytic fatigue.`,
      recommendedSport: primarySport === 'Running' ? 'Running' : 'Cycling',
      recommendedTitleCycling: '65m Z2 Base + 6x20s Neuromuscular Openers',
      recommendedTitleRunning: '50m Z2 Aerobic Run + 6x20s Hill/Track Strides',
      recommendedDurationMins: primarySport === 'Running' ? 50 : 65,
      recommendedTss: 58,
      workoutSyntaxCycling: `- 15m 62% FTP Z2 Warmup\n- 1m 145% FTP Neuromuscular Surge 1\n- 4m 64% FTP Z2 Float\n- 1m 145% FTP Neuromuscular Surge 2\n- 4m 64% FTP Z2 Float\n- 1m 150% FTP Neuromuscular Surge 3\n- 4m 64% FTP Z2 Float\n- 25m 68% FTP Steady Z2 Base\n- 10m 54% FTP Cooldown`,
      workoutSyntaxRunning: `- 15m 80% Pace (${runZ2Pace}) Easy Z2 Warmup\n- 1m 118% Pace (${runStridePace}) Crisp Track/Hill Stride Set 1\n- 3m 76% Pace (${runEasyPace}) Float Jog\n- 1m 118% Pace (${runStridePace}) Crisp Track/Hill Stride Set 2\n- 3m 76% Pace (${runEasyPace}) Float Jog\n- 1m 120% Pace (${runStridePace}) Crisp Track/Hill Stride Set 3\n- 18m 82% Pace (${runZ2Pace} · ≤${z2MaxBpm} bpm) Steady Z2 Run\n- 8m 74% Pace (${runEasyPace}) Cooldown`,
    };
  }

  // 3. Low Aerobic Shortfall or Polarization Deficit (Grey-Zone Heavy)
  if (lowBucket.status === 'SHORTFALL' || verdict === 'POLARIZATION_DEFICIT') {
    const needed = Math.max(25, Math.abs(lowBucket.deltaPtsToTarget));
    return {
      primaryDeficit: 'LOW_AEROBIC',
      focusBadge: `🌊 Low Aerobic Gap (${lowBucket.sharePct}% vs 65–78%)`,
      headline: `Rebalance polarization with disciplined Z2 base (+${needed} Low Aer pts)`,
      rationale: `High Aerobic load is ${highBucket.sharePct}% over the past 7 days while Low Aerobic Z1–Z2 sits at ${lowBucket.sharePct}%. A strictly capped Z2 endurance session (HR ≤${z2MaxBpm} bpm) expands mitochondrial density and clears residual threshold fatigue.`,
      recommendedSport: primarySport === 'Running' ? 'Running' : 'Cycling',
      recommendedTitleCycling: '75m Polarized Z2 Mitochondrial Endurance',
      recommendedTitleRunning: '55m Polarized Z2 Aerobic Foundation Run',
      recommendedDurationMins: primarySport === 'Running' ? 55 : 75,
      recommendedTss: 56,
      workoutSyntaxCycling: `- 12m 56% FTP Progressive Warmup\n- 53m 68% FTP Disciplined Z2 Base\n- 10m 54% FTP Cooldown`,
      workoutSyntaxRunning: `- 10m 76% Pace (${runEasyPace}) Easy Warmup\n- 38m 82% Pace (${runZ2Pace} · ≤${z2MaxBpm} bpm) Conversational Z2 Base\n- 7m 74% Pace (${runEasyPace}) Cooldown`,
    };
  }

  // 4. High Aerobic Shortfall
  if (highBucket.status === 'SHORTFALL' && autonomicState !== 'CAUTION') {
    const needed = Math.max(18, Math.abs(highBucket.deltaPtsToTarget));
    return {
      primaryDeficit: 'HIGH_AEROBIC',
      focusBadge: `🔥 High Aerobic Opportunity (${highBucket.sharePct}% vs 15–25%)`,
      headline: `Build threshold durability (+${needed} High Aerobic pts to target)`,
      rationale: `Your Low Aerobic foundation (${lowBucket.sharePct}%) is well-stocked and autonomic readiness supports quality work. Controlled Z3/Z4 Sweet Spot / Threshold intervals will push lactate clearance upward.`,
      recommendedSport: primarySport === 'Running' ? 'Running' : 'Cycling',
      recommendedTitleCycling: `60m 3x10m Sweet Spot / Threshold (${ssMidPct}% FTP)`,
      recommendedTitleRunning: '50m 3x8m Lactate Threshold Cruise Intervals',
      recommendedDurationMins: primarySport === 'Running' ? 50 : 60,
      recommendedTss: 72,
      workoutSyntaxCycling: `- 12m 58% FTP Warmup\n- 10m ${ssMidPct}% FTP Threshold Cruise 1\n- 4m 55% FTP Recovery\n- 10m ${ssMidPct + 2}% FTP Threshold Cruise 2\n- 4m 55% FTP Recovery\n- 10m ${ssMidPct + 2}% FTP Threshold Cruise 3\n- 10m 52% FTP Cooldown`,
      workoutSyntaxRunning: `- 12m 78% Pace (${runEasyPace}) Warmup Jog\n- 8m 99% Pace (${runLtPace} · ~${runLthr} bpm) Threshold Cruise 1\n- 2m 74% Pace (${runEasyPace}) Float Jog\n- 8m 100% Pace (${runLtPace} · ~${runLthr} bpm) Threshold Cruise 2\n- 2m 74% Pace (${runEasyPace}) Float Jog\n- 8m 100% Pace (${runLtPace} · ~${runLthr} bpm) Threshold Cruise 3\n- 10m 75% Pace (${runEasyPace}) Cooldown`,
    };
  }

  // 5. All 3 Systems Balanced inside Target Corridors!
  return {
    primaryDeficit: 'BALANCED',
    focusBadge: '✓ 3-System Load Balanced',
    headline: 'All 3 energy systems are inside your 7-day target corridor',
    rationale: `Low Aerobic (${lowBucket.sharePct}%), High Aerobic (${highBucket.sharePct}%), and Neuromuscular (${neuroBucket.sharePct}%) strain are balanced cleanly. Maintain momentum with steady aerobic volume or your scheduled session.`,
    recommendedSport: primarySport === 'Running' ? 'Running' : 'Cycling',
    recommendedTitleCycling: '65m Aerobic Endurance + Tempo Progression',
    recommendedTitleRunning: '50m Steady Aerobic Progression Run',
    recommendedDurationMins: primarySport === 'Running' ? 50 : 65,
    recommendedTss: 60,
    workoutSyntaxCycling: `- 12m 58% FTP Warmup\n- 35m 69% FTP Z2 Endurance\n- 8m 86% FTP Tempo Finish\n- 10m 54% FTP Cooldown`,
    workoutSyntaxRunning: `- 10m 78% Pace (${runEasyPace}) Warmup\n- 28m 83% Pace (${runZ2Pace} · ≤${z2MaxBpm} bpm) Steady Z2\n- 6m 93% Pace (${runTempoPace}) Aerobic Tempo Pickup\n- 6m 75% Pace (${runEasyPace}) Cooldown`,
  };
}

/**
 * Core 7-Day Rolling Training Productivity & 3-System Load Focus Engine.
 */
export function evaluateRollingTrainingProductivity(params: {
  activities: UnifiedActivity[];
  wellnessDays: UnifiedWellnessDay[];
  athleteProfile?: AthleteProfile | null;
  asOfDateIso?: string;
  excludeActivityIds?: ReadonlySet<string>;
}): TrainingProductivitySummary {
  const {
    activities,
    wellnessDays,
    athleteProfile,
    asOfDateIso = getLocalDateIso(),
    excludeActivityIds,
  } = params;

  const windowStartIso = shiftIsoDate(asOfDateIso, -6);
  const filteredActivities = excludeActivityIds
    ? activities.filter((a) => !excludeActivityIds.has(a.id))
    : activities;

  const wellnessUpToDate = wellnessDays.filter((w) => w.date <= asOfDateIso);

  // Determine primary sport over last 28 days
  const d28StartIso = shiftIsoDate(asOfDateIso, -27);
  const recent28Acts = filteredActivities.filter((a) => {
    const d = (a.startDateLocal || '').slice(0, 10);
    return d >= d28StartIso && d <= asOfDateIso;
  });
  const runCount = recent28Acts.filter((a) => a.sportCategory === 'Running').length;
  const bikeCount = recent28Acts.filter((a) => a.sportCategory === 'Cycling').length;
  const primarySport: 'Cycling' | 'Running' =
    runCount > bikeCount ? 'Running' : 'Cycling';

  // Index 7-day rolling window day-by-day
  const actsByDate = new Map<string, UnifiedActivity[]>();
  for (const act of filteredActivities) {
    const d = (act.startDateLocal || '').slice(0, 10);
    if (!d || d < windowStartIso || d > asOfDateIso) continue;
    const list = actsByDate.get(d);
    if (list) list.push(act);
    else actsByDate.set(d, [act]);
  }

  const wellnessByDate = new Map<string, UnifiedWellnessDay>();
  for (const w of wellnessUpToDate) {
    wellnessByDate.set(w.date.slice(0, 10), w);
  }

  let sumLow = 0;
  let sumHigh = 0;
  let sumNeuro = 0;
  let activityCount7d = 0;
  const dailyWindow: RollingDayLoadPoint[] = [];

  for (let offset = -6; offset <= 0; offset++) {
    const dIso = shiftIsoDate(asOfDateIso, offset);
    const dayActs = actsByDate.get(dIso) || [];
    const dayWell = wellnessByDate.get(dIso);

    let dLow = 0;
    let dHigh = 0;
    let dNeuro = 0;

    if (dayActs.length > 0) {
      for (const act of dayActs) {
        activityCount7d++;
        const part = partitionActivityLoadBuckets(act, athleteProfile);
        dLow += part.lowAerobicLoad;
        dHigh += part.highAerobicLoad;
        dNeuro += part.neuromuscularLoad;
      }
    } else if (dayWell && dayWell.dailyLoad > 0 && !excludeActivityIds) {
      // Wellness dailyLoad present without synced activity card
      dLow = dayWell.dailyLoad * 0.8;
      dHigh = dayWell.dailyLoad * 0.16;
      dNeuro = dayWell.dailyLoad * 0.04;
    }

    sumLow += dLow;
    sumHigh += dHigh;
    sumNeuro += dNeuro;

    dailyWindow.push({
      date: dIso,
      dayShort: dIso === asOfDateIso ? 'Today' : formatDayShort(dIso),
      totalLoad: Math.round(dLow + dHigh + dNeuro),
      lowAerobicLoad: Math.round(dLow),
      highAerobicLoad: Math.round(dHigh),
      neuromuscularLoad: Math.round(dNeuro),
      hrvMs: dayWell?.hrvRMSSD || 0,
      sleepScore: dayWell?.sleepScore || 0,
    });
  }

  const rawTotal7d = sumLow + sumHigh + sumNeuro;
  const acuteLoad7d = Math.round(rawTotal7d);

  // Resolve CTL, ATL, TSB, and 7d CTL Ramp Rate
  const latestW =
    wellnessUpToDate.length > 0
      ? wellnessUpToDate[wellnessUpToDate.length - 1]
      : null;
  const fallbackPmc = computeFallbackPmcAtDate(
    filteredActivities,
    asOfDateIso,
    athleteProfile
  );

  const useFallbackPmc =
    !latestW || (latestW.ctl <= 0.5 && filteredActivities.length > 0) || Boolean(excludeActivityIds);
  const ctl = useFallbackPmc ? fallbackPmc.ctl : latestW!.ctl;
  const atl = useFallbackPmc ? fallbackPmc.atl : latestW!.atl;
  const tsb = useFallbackPmc ? fallbackPmc.tsb : latestW!.tsb;

  const sevenDaysAgoW = wellnessByDate.get(shiftIsoDate(asOfDateIso, -7));
  const ctlRamp7d = useFallbackPmc
    ? fallbackPmc.ctlRamp7d
    : sevenDaysAgoW && sevenDaysAgoW.ctl > 0
      ? Number((ctl - sevenDaysAgoW.ctl).toFixed(1))
      : Number((latestW?.rampRate || 0).toFixed(1));

  // Chronic Weekly Baseline & Optimal Load Tunnel (Garmin Acute Load Tunnel analog)
  const chronicWeeklyLoad = Math.max(
    110,
    Math.round(ctl >= 16 ? ctl * 7 : Math.max(acuteLoad7d, 160))
  );
  const optimalLoadMin = Math.round(chronicWeeklyLoad * 0.80);
  const optimalLoadMax = Math.round(chronicWeeklyLoad * 1.25);
  const acwr = Number((acuteLoad7d / Math.max(1, chronicWeeklyLoad)).toFixed(2));

  const loadTunnelStatus: TrainingProductivitySummary['loadTunnelStatus'] =
    acuteLoad7d < optimalLoadMin
      ? 'UNDER'
      : acuteLoad7d > optimalLoadMax
        ? 'HIGH'
        : 'OPTIMAL';

  // Overnight Autonomic & Sleep Absorption (7d rolling)
  const recent7Wellness = wellnessUpToDate.slice(-7);
  const hrvSamples7d = recent7Wellness.filter((w) => w.hrvRMSSD > 0);
  const latestWithHrv =
    [...wellnessUpToDate].reverse().find((w) => w.hrvRMSSD > 0) || null;
  const latestWithSleep =
    [...wellnessUpToDate]
      .reverse()
      .find((w) => w.sleepScore > 0 || w.sleepSecs > 0) || null;

  const hrvLatestMs = latestWithHrv?.hrvRMSSD || 0;
  const hrv7dAvgMs =
    hrvSamples7d.length > 0
      ? Math.round(
          hrvSamples7d.reduce((s, w) => s + w.hrvRMSSD, 0) / hrvSamples7d.length
        )
      : latestWithHrv?.hrvBaseline7d || hrvLatestMs;
  const hrvNormalFloorMs =
    latestWithHrv?.hrvNormalBandLow ||
    (hrv7dAvgMs > 0 ? Math.round(hrv7dAvgMs * 0.87) : 0);

  const rhrLatestBpm =
    latestWithHrv?.restingHR ||
    latestW?.restingHR ||
    (wellnessUpToDate.length > 0 ? athleteProfile?.restingHr || 0 : 0);
  const baseRhr =
    wellnessUpToDate.length > 0 ? athleteProfile?.restingHr || rhrLatestBpm : rhrLatestBpm;
  const rhrDeltaBpm =
    rhrLatestBpm > 0 && baseRhr > 0 ? Math.round(rhrLatestBpm - baseRhr) : 0;

  const sleepScoreLatest = latestWithSleep?.sleepScore || 0;
  const sleepHoursLatest = latestWithSleep?.sleepSecs
    ? Number((latestWithSleep.sleepSecs / 3600).toFixed(1))
    : 0;
  const sleepSamples7d = recent7Wellness.filter((w) => w.sleepScore > 0);
  const sleepScore7dAvg =
    sleepSamples7d.length > 0
      ? Math.round(
          sleepSamples7d.reduce((s, w) => s + w.sleepScore, 0) /
            sleepSamples7d.length
        )
      : sleepScoreLatest;

  let autonomicState: TrainingProductivitySummary['autonomicState'] = 'BALANCED';
  if (
    (hrvLatestMs > 0 && hrvNormalFloorMs > 0 && hrvLatestMs < hrvNormalFloorMs) ||
    rhrDeltaBpm >= 5 ||
    (sleepScoreLatest > 0 && sleepScoreLatest < 58)
  ) {
    autonomicState = 'SUPPRESSED';
  } else if (
    rhrDeltaBpm >= 3 ||
    (sleepScoreLatest > 0 && sleepScoreLatest < 72) ||
    (hrvLatestMs > 0 && hrv7dAvgMs > 0 && hrvLatestMs <= hrv7dAvgMs - 5)
  ) {
    autonomicState = 'CAUTION';
  } else if (
    hrvLatestMs > 0 &&
    hrvLatestMs >= hrv7dAvgMs + 2 &&
    (sleepScoreLatest === 0 || sleepScoreLatest >= 78) &&
    rhrDeltaBpm <= 1
  ) {
    autonomicState = 'PRIME';
  }

  const hasAnyHistory =
    filteredActivities.length > 0 ||
    wellnessUpToDate.some(
      (w) => w.ctl > 0 || w.dailyLoad > 0 || w.hrvRMSSD > 0 || w.sleepSecs > 0
    );

  // Composite 0..100 Morning Readiness Score (0 while calibrating with zero synced history)
  const hrvPts =
    hrvLatestMs > 0 && hrv7dAvgMs > 0
      ? Math.min(35, Math.max(12, 26 + (hrvLatestMs - hrv7dAvgMs) * 1.4))
      : 26;
  const sleepPts =
    sleepScoreLatest > 0
      ? Math.min(35, Math.max(10, sleepScoreLatest * 0.35))
      : sleepHoursLatest > 0
        ? Math.min(35, Math.max(12, (sleepHoursLatest / 8) * 30))
        : 26;
  const formPts =
    tsb >= -12 && tsb <= 15
      ? 30
      : tsb < -28
        ? 12
        : tsb < -18
          ? 20
          : 25;
  const rhrPenalty = Math.max(0, rhrDeltaBpm - 1) * 2.5;
  const readinessScore = hasAnyHistory
    ? Math.round(Math.min(99, Math.max(25, hrvPts + sleepPts + formPts - rhrPenalty)))
    : 0;

  // Sport-Matched Rolling Aerobic Efficiency (EF = Output / Heartbeat, 7d vs 28d)
  const sportEfActs28 = recent28Acts.filter(
    (a) =>
      a.sportCategory === primarySport &&
      a.movingTimeSecs >= 1200 &&
      typeof a.efficiencyFactor === 'number' &&
      a.efficiencyFactor > 0.01 &&
      a.efficiencyFactor < 5.0
  );
  const sportEfActs7 = sportEfActs28.filter(
    (a) => (a.startDateLocal || '').slice(0, 10) >= windowStartIso
  );

  const ef28dBaseline =
    sportEfActs28.length >= 2
      ? Number(
          (
            sportEfActs28.reduce((s, a) => s + a.efficiencyFactor, 0) /
            sportEfActs28.length
          ).toFixed(2)
        )
      : null;
  const ef7dAvg =
    sportEfActs7.length >= 1
      ? Number(
          (
            sportEfActs7.reduce((s, a) => s + a.efficiencyFactor, 0) /
            sportEfActs7.length
          ).toFixed(2)
        )
      : null;
  const efDeltaPct =
    ef7dAvg !== null && ef28dBaseline !== null && ef28dBaseline > 0
      ? Number((((ef7dAvg - ef28dBaseline) / ef28dBaseline) * 100).toFixed(1))
      : null;

  // 3-Bucket Load Focus with Optimal Target Corridors
  const referenceScalePts = Math.max(acuteLoad7d, optimalLoadMin);
  const buckets: [
    LoadFocusBucketSummary,
    LoadFocusBucketSummary,
    LoadFocusBucketSummary,
  ] = [
    buildBucketSummary(
      'LOW_AEROBIC',
      'Low Aerobic',
      'Low Aer',
      'Z1–Z2 Base',
      '#0D9488',
      sumLow,
      rawTotal7d,
      referenceScalePts,
      65,
      78
    ),
    buildBucketSummary(
      'HIGH_AEROBIC',
      'High Aerobic',
      'High Aer',
      'Z3–Z4 Tempo/LT',
      '#EA580C',
      sumHigh,
      rawTotal7d,
      referenceScalePts,
      15,
      25
    ),
    buildBucketSummary(
      'NEUROMUSCULAR',
      'Neuromuscular',
      'Neuro / VO2',
      'Z5–Z7 VO2/Sprint',
      '#7C3AED',
      sumNeuro,
      rawTotal7d,
      referenceScalePts,
      6,
      14
    ),
  ];

  // Deterministic Training Productivity Verdict
  let verdict: TrainingProductivityVerdict = 'PRODUCTIVE';
  let headlineWhy = '';

  if (!hasAnyHistory) {
    verdict = 'CALIBRATING';
    headlineWhy =
      'Sync recent workouts from Strava (or optionally connect Garmin Connect / Intervals.icu or upload .FIT files) to calibrate your 7-day load corridor and energy-system focus.';
  } else if (
    acwr > 1.35 ||
    ctlRamp7d > 7.0 ||
    (acwr > 1.18 && autonomicState === 'SUPPRESSED') ||
    (tsb < -30 && autonomicState !== 'PRIME')
  ) {
    verdict = 'OVERREACHING';
    headlineWhy = `7-day acute load (${acuteLoad7d} TSS · ${acwr.toFixed(2)}x chronic) or ramp (${ctlRamp7d >= 0 ? `+${ctlRamp7d}` : ctlRamp7d} CTL/wk) is outpacing autonomic recovery.`;
  } else if (
    ctl >= 28 &&
    tsb >= 4 &&
    acwr >= 0.58 &&
    acwr <= 0.92 &&
    autonomicState !== 'SUPPRESSED' &&
    (efDeltaPct === null || efDeltaPct >= -1.5)
  ) {
    verdict = 'PEAKING';
    headlineWhy = `Fresh Form (TSB +${tsb.toFixed(0)}) with preserved fitness (CTL ${ctl.toFixed(0)}) and crisp aerobic efficiency — primed for peak output.`;
  } else if (acuteLoad7d < Math.round(chronicWeeklyLoad * 0.42) && ctl >= 20) {
    if (tsb < 8) {
      verdict = 'RECOVERY';
      headlineWhy = `Unloading week (${acuteLoad7d} TSS vs ${optimalLoadMin}–${optimalLoadMax} target) is shedding acute fatigue and rebounding Form.`;
    } else {
      verdict = 'DETRAINING';
      headlineWhy = `7-day load (${acuteLoad7d} TSS) is well below your ${optimalLoadMin} TSS maintenance floor, causing chronic fitness to decay (${ctlRamp7d} CTL/wk).`;
    }
  } else if (
    acuteLoad7d >= 110 &&
    buckets[1].sharePct > 36 &&
    buckets[0].sharePct < 56
  ) {
    verdict = 'POLARIZATION_DEFICIT';
    headlineWhy = `Good training volume (${acuteLoad7d} TSS), but ${buckets[1].sharePct}% is concentrated in High Aerobic Z3–Z4 with Low Aerobic Z1–Z2 under-fed (${buckets[0].sharePct}%).`;
  } else if (
    loadTunnelStatus === 'OPTIMAL' &&
    ctlRamp7d >= -0.4 &&
    autonomicState !== 'SUPPRESSED' &&
    (efDeltaPct === null || efDeltaPct >= -2.5)
  ) {
    verdict = 'PRODUCTIVE';
    const efPhrase =
      efDeltaPct !== null
        ? `, with ${primarySport.toLowerCase()} efficiency ${efDeltaPct >= 0 ? `+${efDeltaPct}%` : `${efDeltaPct}%`} vs 28d`
        : '';
    headlineWhy = `7-day load (${acuteLoad7d} TSS) sits cleanly inside your ${optimalLoadMin}–${optimalLoadMax} TSS optimal tunnel (${ctlRamp7d >= 0 ? `+${ctlRamp7d}` : ctlRamp7d} CTL/wk)${efPhrase}.`;
  } else if (acwr >= 0.50 && acwr < 0.80 && tsb <= 8) {
    verdict = 'RECOVERY';
    headlineWhy = `Controlled recovery load (${acuteLoad7d} TSS · ${acwr.toFixed(2)}x) is allowing autonomic rebound before your next build block.`;
  } else {
    verdict = 'MAINTAINING';
    headlineWhy = `7-day load (${acuteLoad7d} TSS · ${acwr.toFixed(2)}x) is holding baseline fitness steady (CTL ${ctl.toFixed(0)}); nudge missing load buckets to spark progression.`;
  }

  const gapPrescription = buildGapFillingPrescription({
    verdict,
    autonomicState,
    buckets,
    primarySport,
    profile: athleteProfile,
  });

  return {
    asOfDateIso,
    windowStartIso,
    verdict,
    verdictLabel: VERDICT_META[verdict].label,
    verdictTone: VERDICT_META[verdict].tone,
    headlineWhy,
    actionCallout: gapPrescription.headline,
    acuteLoad7d,
    chronicWeeklyLoad,
    optimalLoadMin,
    optimalLoadMax,
    loadTunnelStatus,
    acwr,
    ctl,
    atl,
    tsb,
    ctlRamp7d,
    autonomicState,
    hrvLatestMs,
    hrv7dAvgMs,
    hrvNormalFloorMs,
    rhrLatestBpm,
    rhrDeltaBpm,
    sleepScoreLatest,
    sleepHoursLatest,
    sleepScore7dAvg,
    readinessScore,
    efDeltaPct,
    efPrimarySport: primarySport,
    ef7dAvg,
    ef28dBaseline,
    buckets,
    dailyWindow,
    gapPrescription,
    activityCount7d,
  };
}

const VERDICT_RANK: Record<TrainingProductivityVerdict, number> = {
  CALIBRATING: 0,
  DETRAINING: 1,
  OVERREACHING: 2,
  POLARIZATION_DEFICIT: 3,
  RECOVERY: 4,
  MAINTAINING: 5,
  PRODUCTIVE: 6,
  PEAKING: 7,
};

const GARMIN_HR_5_COLORS = [
  { zone: 'Z1', label: 'Warm Up', colorHex: '#64748B' },
  { zone: 'Z2', label: 'Easy Base', colorHex: '#0284C7' },
  { zone: 'Z3', label: 'Aerobic', colorHex: '#0D9488' },
  { zone: 'Z4', label: 'Threshold', colorHex: '#EA580C' },
  { zone: 'Z5', label: 'Maximum', colorHex: '#DC2626' },
];

const POWER_7_COLORS = [
  { zone: 'Z1', label: 'Recovery', colorHex: '#64748B' },
  { zone: 'Z2', label: 'Endurance', colorHex: '#0284C7' },
  { zone: 'Z3', label: 'Tempo', colorHex: '#0D9488' },
  { zone: 'Z4', label: 'Threshold', colorHex: '#D97706' },
  { zone: 'Z5', label: 'VO2max', colorHex: '#EA580C' },
  { zone: 'Z6', label: 'Anaerobic', colorHex: '#9333EA' },
  { zone: 'Z7', label: 'Neuromusc', colorHex: '#C026D3' },
];

/**
 * Computes the Post-Workout Session Impact & Performance Receipt for Today's completed workout(s),
 * or for the most recent completed session when previewing Post-Session mode before training today.
 */
export function evaluateSessionImpactReceipt(params: {
  activities: UnifiedActivity[];
  wellnessDays: UnifiedWellnessDay[];
  athleteProfile?: AthleteProfile | null;
  todayIso?: string;
  distanceUnit?: 'mi' | 'km';
}): SessionImpactReceipt | null {
  const {
    activities,
    wellnessDays,
    athleteProfile,
    todayIso = getLocalDateIso(),
    distanceUnit = 'mi',
  } = params;

  if (!activities || activities.length === 0) return null;

  const todayActs = activities.filter(
    (a) => (a.startDateLocal || '').slice(0, 10) === todayIso
  );
  const isTodaySession = todayActs.length > 0;

  // Use today's workouts if present; otherwise let the athlete inspect their latest workout day
  const targetDateIso = isTodaySession
    ? todayIso
    : (activities[0].startDateLocal || '').slice(0, 10) || todayIso;
  const sessionActs = isTodaySession
    ? todayActs
    : activities.filter(
        (a) => (a.startDateLocal || '').slice(0, 10) === targetDateIso
      );

  if (sessionActs.length === 0) return null;

  // Primary session = highest training load on that day
  const sortedByLoad = [...sessionActs].sort(
    (a, b) =>
      resolveActivityEffectiveLoad(b, athleteProfile) -
      resolveActivityEffectiveLoad(a, athleteProfile)
  );
  const primaryActivity = sortedByLoad[0];
  const sessionIds = new Set(sessionActs.map((a) => a.id));

  const beforeSummary = evaluateRollingTrainingProductivity({
    activities,
    wellnessDays,
    athleteProfile,
    asOfDateIso: targetDateIso,
    excludeActivityIds: sessionIds,
  });

  const afterSummary = evaluateRollingTrainingProductivity({
    activities,
    wellnessDays,
    athleteProfile,
    asOfDateIso: targetDateIso,
  });

  let addedLow = 0;
  let addedHigh = 0;
  let addedNeuro = 0;
  let totalLoad = 0;
  let totalSecs = 0;

  for (const act of sessionActs) {
    const part = partitionActivityLoadBuckets(act, athleteProfile);
    addedLow += part.lowAerobicLoad;
    addedHigh += part.highAerobicLoad;
    addedNeuro += part.neuromuscularLoad;
    totalLoad += part.totalLoad;
    totalSecs += act.movingTimeSecs || 0;
  }

  const bucketShiftHighlights = afterSummary.buckets.map((afterB, idx) => {
    const beforeB = beforeSummary.buckets[idx];
    const addedPts = Math.round(
      idx === 0 ? addedLow : idx === 1 ? addedHigh : addedNeuro
    );
    const closedDeficit =
      beforeB.status === 'SHORTFALL' && afterB.status === 'OPTIMAL';
    return {
      key: afterB.key,
      shortLabel: afterB.shortLabel,
      colorHex: afterB.colorHex,
      addedPts,
      shareBeforePct: beforeB.sharePct,
      shareAfterPct: afterB.sharePct,
      closedDeficit,
      insideTargetNow: afterB.status === 'OPTIMAL',
    };
  });

  const didImproveStatus =
    VERDICT_RANK[afterSummary.verdict] > VERDICT_RANK[beforeSummary.verdict];
  const closedBucket = bucketShiftHighlights.find((b) => b.closedDeficit);

  let needleHeadline = '';
  if (didImproveStatus) {
    needleHeadline = `Shifted 7-day status from ${beforeSummary.verdictLabel} → ${afterSummary.verdictLabel} (${afterSummary.acuteLoad7d} TSS)`;
  } else if (closedBucket) {
    needleHeadline = `Closed ${closedBucket.shortLabel} shortfall (${closedBucket.shareBeforePct}% → ${closedBucket.shareAfterPct}% ✓)`;
  } else if (afterSummary.loadTunnelStatus === 'OPTIMAL') {
    needleHeadline = `Added +${Math.round(totalLoad)} TSS cleanly inside your ${afterSummary.optimalLoadMin}–${afterSummary.optimalLoadMax} TSS optimal corridor`;
  } else {
    needleHeadline = `Logged +${Math.round(totalLoad)} TSS (${beforeSummary.acuteLoad7d} → ${afterSummary.acuteLoad7d} 7d load)`;
  }

  // Primary Output & Sport-Matched 28d EF Baseline
  const useMiles = distanceUnit === 'mi';
  let primaryOutputLabel = 'Normalized Output';
  let primaryOutputValue = `${Math.round(totalLoad)} TSS`;
  let secondaryOutputValue = `${primaryActivity.avgHr || '—'} bpm avg HR`;

  if (primaryActivity.sportCategory === 'Cycling') {
    const np = primaryActivity.normalizedPower || primaryActivity.avgPower || 0;
    const ftp =
      primaryActivity.environment === 'INDOOR'
        ? athleteProfile?.indoorFtp || athleteProfile?.ftp || 290
        : athleteProfile?.ftp || 290;
    const ifVal =
      primaryActivity.intensityFactor && primaryActivity.intensityFactor > 0
        ? primaryActivity.intensityFactor > 3
          ? primaryActivity.intensityFactor / 100
          : primaryActivity.intensityFactor
        : np > 0 && ftp > 0
          ? np / ftp
          : 0;
    primaryOutputLabel = np > 0 ? 'NP & Intensity' : 'Session Load';
    primaryOutputValue =
      np > 0
        ? `${Math.round(np)}W NP${ifVal > 0 ? ` · IF ${ifVal.toFixed(2)}` : ''}`
        : `${Math.round(totalLoad)} TSS`;
    secondaryOutputValue = `Avg ${primaryActivity.avgHr || '—'} bpm · Max ${primaryActivity.maxHr || '—'} bpm`;
  } else if (primaryActivity.sportCategory === 'Running') {
    const pace =
      primaryActivity.gapPaceSecsPerKm || primaryActivity.avgPaceSecsPerKm || 0;
    const pwr = primaryActivity.normalizedPower || primaryActivity.avgPower || 0;
    primaryOutputLabel = primaryActivity.gapPaceSecsPerKm
      ? 'Grade-Adj Pace'
      : 'Avg Pace';
    primaryOutputValue =
      pace > 120
        ? `${formatPaceMmSs(pace, useMiles)}${pwr > 80 ? ` · ${Math.round(pwr)}W` : ''}`
        : `${Math.round(totalLoad)} TSS`;
    secondaryOutputValue = `Avg ${primaryActivity.avgHr || '—'} bpm · Max ${primaryActivity.maxHr || '—'} bpm`;
  }

  const d28Start = shiftIsoDate(targetDateIso, -28);
  const peerEfActs = activities.filter(
    (a) =>
      a.id !== primaryActivity.id &&
      a.sportCategory === primaryActivity.sportCategory &&
      (a.startDateLocal || '').slice(0, 10) >= d28Start &&
      (a.startDateLocal || '').slice(0, 10) <= targetDateIso &&
      a.movingTimeSecs >= 1200 &&
      a.efficiencyFactor > 0.01 &&
      a.efficiencyFactor < 5.0
  );

  const efValue =
    primaryActivity.efficiencyFactor && primaryActivity.efficiencyFactor > 0.01
      ? Number(primaryActivity.efficiencyFactor.toFixed(2))
      : null;
  const efBaseline28d =
    peerEfActs.length >= 1
      ? Number(
          (
            peerEfActs.reduce((s, a) => s + a.efficiencyFactor, 0) /
            peerEfActs.length
          ).toFixed(2)
        )
      : null;
  const efDeltaPct =
    efValue !== null && efBaseline28d !== null && efBaseline28d > 0
      ? Number((((efValue - efBaseline28d) / efBaseline28d) * 100).toFixed(1))
      : null;

  const decouplingPct =
    typeof primaryActivity.aerobicDecouplingPct === 'number' &&
    primaryActivity.movingTimeSecs >= 1200
      ? Number(primaryActivity.aerobicDecouplingPct.toFixed(1))
      : null;

  let decouplingVerdict = 'Short / Interval Session';
  let decouplingTone: SessionImpactReceipt['decouplingTone'] = 'neutral';
  if (decouplingPct !== null) {
    if (decouplingPct <= 3.5) {
      decouplingVerdict = 'Locked Aerobic Coupling (<3.5%)';
      decouplingTone = 'prime';
    } else if (decouplingPct <= 5.0) {
      decouplingVerdict = 'Normal Drift (3.5–5.0%)';
      decouplingTone = 'caution';
    } else {
      decouplingVerdict = 'Elevated Drift (>5.0% — Fuel/Hydrate)';
      decouplingTone = 'strained';
    }
  }

  // Build 5-Zone Garmin HR distribution (collapsing Z5..Z7 into Z5 if 7-zone source)
  const rawHr = primaryActivity.zoneSecs?.hr || [];
  const fiveHrSecs = [
    rawHr[0] || 0,
    rawHr[1] || 0,
    rawHr[2] || 0,
    rawHr[3] || 0,
    (rawHr[4] || 0) + (rawHr[5] || 0) + (rawHr[6] || 0),
  ];
  const sumHrSecs = fiveHrSecs.reduce((s, v) => s + v, 0);
  const hrZones5: SessionZoneBarSegment[] =
    sumHrSecs >= 30
      ? GARMIN_HR_5_COLORS.map((meta, i) => ({
          ...meta,
          secs: fiveHrSecs[i],
          pct: Math.round((fiveHrSecs[i] / sumHrSecs) * 100),
        }))
      : [];

  // Build 7-Zone Power distribution if available
  const rawPwr = primaryActivity.zoneSecs?.power || [];
  const sumPwrSecs = rawPwr.reduce((s, v) => s + (v || 0), 0);
  const powerZones7: SessionZoneBarSegment[] =
    sumPwrSecs >= 30
      ? POWER_7_COLORS.map((meta, i) => ({
          ...meta,
          secs: rawPwr[i] || 0,
          pct: Math.round(((rawPwr[i] || 0) / sumPwrSecs) * 100),
        }))
      : [];

  const debriefReport =
    athleteProfile && primaryActivity.streams
      ? generatePostWorkoutDebrief(
          primaryActivity,
          primaryActivity.streams,
          athleteProfile
        )
      : null;

  // Estimate Recovery Horizon (hours) & Tomorrow Preview
  const neuroRatio = totalLoad > 0 ? addedNeuro / totalLoad : 0;
  const highRatio = totalLoad > 0 ? addedHigh / totalLoad : 0;
  const baseRecHrs =
    10 +
    totalLoad * 0.22 +
    neuroRatio * 14 +
    highRatio * 8 +
    (afterSummary.autonomicState === 'SUPPRESSED'
      ? 10
      : afterSummary.autonomicState === 'CAUTION'
        ? 5
        : 0);
  const recoveryHours = Math.round(Math.min(56, Math.max(10, baseRecHrs)));

  const tomorrowHeadline =
    recoveryHours >= 34
      ? 'Tomorrow: Strict Z1/Z2 Recovery Spin or Rest Day'
      : afterSummary.gapPrescription.primaryDeficit === 'LOW_AEROBIC'
        ? 'Tomorrow: 60–75m Polarized Z2 Endurance Base'
        : afterSummary.gapPrescription.primaryDeficit === 'NEUROMUSCULAR'
          ? 'Tomorrow: Z2 Endurance + 5x15s Neuromuscular Openers'
          : 'Tomorrow: Ready for Scheduled Quality or Z2 Progression';

  return {
    isTodaySession,
    sessionDateIso: targetDateIso,
    activities: sessionActs,
    primaryActivity,
    combinedTitle: sessionActs.map((a) => a.name).join(' + '),
    totalLoad: Math.round(totalLoad),
    totalDurationMins: Math.max(1, Math.round(totalSecs / 60)),
    verdictBefore: beforeSummary.verdict,
    verdictBeforeLabel: beforeSummary.verdictLabel,
    verdictAfter: afterSummary.verdict,
    verdictAfterLabel: afterSummary.verdictLabel,
    didImproveStatus,
    acuteLoadBefore: beforeSummary.acuteLoad7d,
    acuteLoadAfter: afterSummary.acuteLoad7d,
    optimalLoadMin: afterSummary.optimalLoadMin,
    optimalLoadMax: afterSummary.optimalLoadMax,
    addedLowAerobicPts: Math.round(addedLow),
    addedHighAerobicPts: Math.round(addedHigh),
    addedNeuromuscularPts: Math.round(addedNeuro),
    bucketShiftHighlights,
    needleHeadline,
    primaryOutputLabel,
    primaryOutputValue,
    secondaryOutputValue,
    efValue,
    efBaseline28d,
    efDeltaPct,
    decouplingPct,
    decouplingVerdict,
    decouplingTone,
    hrZones5,
    powerZones7,
    debriefReport,
    recoveryHours,
    tomorrowHeadline,
  };
}
