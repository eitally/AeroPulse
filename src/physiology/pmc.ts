import type {
  AthleteProfile,
  DualSportPmcPoint,
  ThresholdHistoryEntry,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types.ts';
import { computeCyclingTss, computeRunningTss } from './powerPaceMetrics.ts';
import {
  BANISTER_ATL_DECAY,
  BANISTER_CTL_DECAY,
  STRAVA_LOAD_MODEL_VERSION,
  getLocalDateIso,
  isEBikeActivityText,
  shiftIsoDate,
} from './stravaLoadCalibration.ts';

export interface ResolvedDateThresholds {
  ftp: number;
  indoorFtp: number;
  lthr: number;
  runLthr: number;
  thresholdPaceSecsPerKm: number;
}

/**
 * Resolves the athlete's effective thresholds on a specific YYYY-MM-DD date
 * using `profile.thresholdHistory` sorted chronologically.
 * Raising FTP in November never retroactively alters May's TSS!
 */
export function resolveThresholdsAtDate(
  profile: AthleteProfile,
  isoDate: string
): ResolvedDateThresholds {
  const cleanDate = (isoDate || '').slice(0, 10);
  const history = Array.isArray(profile.thresholdHistory)
    ? [...profile.thresholdHistory]
        .filter((h) => Boolean(h && h.effectiveDate))
        .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
    : [];

  let matched: ThresholdHistoryEntry | null = null;
  for (const entry of history) {
    if (entry.effectiveDate.slice(0, 10) <= cleanDate) {
      matched = entry;
    } else {
      break;
    }
  }

  // If activity predates the earliest history entry, use the earliest entry rather than today's peak FTP
  if (!matched && history.length > 0) {
    matched = history[0];
  }

  if (matched) {
    return {
      ftp: matched.ftp > 0 ? matched.ftp : profile.ftp || 250,
      indoorFtp:
        matched.indoorFtp && matched.indoorFtp > 0
          ? matched.indoorFtp
          : matched.ftp > 0
            ? matched.ftp
            : profile.indoorFtp || profile.ftp || 250,
      lthr: matched.lthr > 0 ? matched.lthr : profile.lthr || 170,
      runLthr: matched.runLthr && matched.runLthr > 0 ? matched.runLthr : profile.runLthr || 175,
      thresholdPaceSecsPerKm:
        matched.thresholdPaceSecsPerKm > 0
          ? matched.thresholdPaceSecsPerKm
          : profile.thresholdPaceSecsPerKm || 260,
    };
  }

  return {
    ftp: profile.ftp || 250,
    indoorFtp: profile.indoorFtp || profile.ftp || 250,
    lthr: profile.lthr || 170,
    runLthr: profile.runLthr || profile.lthr || 175,
    thresholdPaceSecsPerKm: profile.thresholdPaceSecsPerKm || 260,
  };
}

/**
 * Computes historical-threshold-aware TSS for an activity.
 */
export function computeHistoricalActivityLoad(
  activity: UnifiedActivity,
  profile: AthleteProfile
): number {
  if (isEBikeActivityText(activity.rawSportType, activity.name)) {
    return Number.isFinite(activity.trainingLoad) && activity.trainingLoad >= 0
      ? activity.trainingLoad
      : 0;
  }

  const hasHistoryOverrides =
    Array.isArray(profile.thresholdHistory) && profile.thresholdHistory.length > 0;
  if (
    activity.loadModelVersion === STRAVA_LOAD_MODEL_VERSION &&
    !hasHistoryOverrides &&
    profile.source !== 'CUSTOM_OVERRIDE' &&
    Number.isFinite(activity.trainingLoad)
  ) {
    return Math.max(0, activity.trainingLoad);
  }

  const dateStr = (activity.startDateLocal || '').slice(0, 10);
  const thresholds = resolveThresholdsAtDate(profile, dateStr);
  const dur = activity.movingTimeSecs || 0;

  if (activity.sportCategory === 'Cycling' && dur > 0 && activity.deviceWatts !== false) {
    const np = activity.normalizedPower || activity.avgPower || 0;
    const activeFtp =
      activity.environment === 'INDOOR' ? thresholds.indoorFtp : thresholds.ftp;
    if (np > 0 && activeFtp > 0) {
      return computeCyclingTss(dur, np, activeFtp);
    }
  }

  if (activity.sportCategory === 'Running' && dur > 0 && activity.distanceMeters > 200) {
    const rawPaceSecsPerKm = dur / (activity.distanceMeters / 1000);
    // Modest elevation grade boost when summary elevationGainMeters is present
    const gradeFraction =
      activity.elevationGainMeters > 0 && activity.distanceMeters > 0
        ? activity.elevationGainMeters / activity.distanceMeters
        : 0;
    const approxGapSecsPerKm = rawPaceSecsPerKm / (1 + Math.min(0.25, gradeFraction * 3.1));
    if (approxGapSecsPerKm > 100 && thresholds.thresholdPaceSecsPerKm > 0) {
      return computeRunningTss(dur, approxGapSecsPerKm, thresholds.thresholdPaceSecsPerKm);
    }
  }

  return Number.isFinite(activity.trainingLoad) && activity.trainingLoad > 0
    ? activity.trainingLoad
    : 0;
}

/**
 * Computes separated Cycling CTL/ATL, Running CTL/ATL, and Systemic CTL/ATL
 * using standard Banister 42d / 7d exponential decay constants.
 */
export function computeDualSportPmcSeries(
  activities: UnifiedActivity[],
  profile: AthleteProfile,
  windowDays = 90,
  options?: { seedWellnessDays?: UnifiedWellnessDay[] }
): DualSportPmcPoint[] {
  const sortedSeeds = Array.isArray(options?.seedWellnessDays)
    ? [...options!.seedWellnessDays]
        .filter((w) => w && typeof w.date === 'string' && w.date.length >= 10)
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];
  const hasSeedSeries = sortedSeeds.length > 0;
  if (activities.length === 0 && !hasSeedSeries) return [];

  const sorted = [...activities].sort((a, b) =>
    a.startDateLocal.localeCompare(b.startDateLocal)
  );
  const firstActivityDate = sorted[0]?.startDateLocal?.slice(0, 10) || sortedSeeds[0].date.slice(0, 10);
  const firstSeedDate = sortedSeeds[0]?.date?.slice(0, 10) || firstActivityDate;
  const seriesStartStr = firstSeedDate < firstActivityDate ? firstSeedDate : firstActivityDate;
  const todayStr = getLocalDateIso();
  const lastActivityDate =
    sorted.length > 0 ? sorted[sorted.length - 1].startDateLocal.slice(0, 10) : firstActivityDate;
  const endDateStr = todayStr >= lastActivityDate ? todayStr : lastActivityDate;

  const hasHistoryOverrides =
    Array.isArray(profile.thresholdHistory) && profile.thresholdHistory.length > 0;

  const byDay = new Map<string, { sys: number; cyc: number; run: number }>();
  let totalSysActLoad = 0;
  let totalCycActLoad = 0;
  let totalRunActLoad = 0;
  for (const act of sorted) {
    const d = act.startDateLocal.slice(0, 10);
    const useCanonicalSeedLoad =
      hasSeedSeries &&
      !hasHistoryOverrides &&
      Number.isFinite(act.trainingLoad) &&
      act.trainingLoad > 0;
    const load = useCanonicalSeedLoad
      ? Math.max(0, act.trainingLoad)
      : computeHistoricalActivityLoad(act, profile);
    const bucket = byDay.get(d) || { sys: 0, cyc: 0, run: 0 };
    bucket.sys += load;
    totalSysActLoad += load;
    if (act.sportCategory === 'Cycling') {
      bucket.cyc += load;
      totalCycActLoad += load;
    } else if (act.sportCategory === 'Running') {
      bucket.run += load;
      totalRunActLoad += load;
    }
    byDay.set(d, bucket);
  }

  const wellnessByDate = new Map<string, UnifiedWellnessDay>();
  for (const w of sortedSeeds) {
    wellnessByDate.set(w.date.slice(0, 10), w);
  }

  const cycShare =
    totalSysActLoad > 0
      ? totalCycActLoad / totalSysActLoad
      : profile.primarySport === 'Cycling'
        ? 1
        : 0;
  const runShare =
    totalSysActLoad > 0
      ? totalRunActLoad / totalSysActLoad
      : profile.primarySport === 'Running'
        ? 1
        : Math.max(0, 1 - cycShare);

  const ctlDecay = BANISTER_CTL_DECAY;
  const atlDecay = BANISTER_ATL_DECAY;

  let sysCtl = 0;
  let sysAtl = 0;
  let cycCtl = 0;
  let cycAtl = 0;
  let runCtl = 0;
  let runAtl = 0;

  if (hasSeedSeries && firstSeedDate <= firstActivityDate) {
    const w0 = sortedSeeds[0];
    const w0Load = byDay.get(firstSeedDate)?.sys ?? Math.max(0, Number(w0.dailyLoad || 0));
    const seedCtl0 = Math.max(0, (w0.ctl - w0Load * (1 - ctlDecay)) / ctlDecay);
    const seedAtl0 = Math.max(0, (w0.atl - w0Load * (1 - atlDecay)) / atlDecay);
    sysCtl = seedCtl0;
    sysAtl = seedAtl0;
    cycCtl = seedCtl0 * cycShare;
    cycAtl = seedAtl0 * cycShare;
    runCtl = seedCtl0 * runShare;
    runAtl = seedAtl0 * runShare;
  }

  const fullSeries: DualSportPmcPoint[] = [];
  for (let dStr = seriesStartStr; dStr <= endDateStr; dStr = shiftIsoDate(dStr, 1)) {
    const activityLoads = byDay.get(dStr);
    const seedDay = wellnessByDate.get(dStr);
    const loads = activityLoads
      ? activityLoads
      : seedDay && Number.isFinite(seedDay.dailyLoad) && seedDay.dailyLoad > 0
        ? {
            sys: seedDay.dailyLoad,
            cyc: seedDay.dailyLoad * cycShare,
            run: seedDay.dailyLoad * runShare,
          }
        : { sys: 0, cyc: 0, run: 0 };

    sysCtl = sysCtl * ctlDecay + loads.sys * (1 - ctlDecay);
    sysAtl = sysAtl * atlDecay + loads.sys * (1 - atlDecay);
    const sysTsb = sysCtl - sysAtl;

    cycCtl = cycCtl * ctlDecay + loads.cyc * (1 - ctlDecay);
    cycAtl = cycAtl * atlDecay + loads.cyc * (1 - atlDecay);
    const cycTsb = cycCtl - cycAtl;

    runCtl = runCtl * ctlDecay + loads.run * (1 - ctlDecay);
    runAtl = runAtl * atlDecay + loads.run * (1 - atlDecay);
    const runTsb = runCtl - runAtl;

    fullSeries.push({
      date: dStr,
      systemicLoad: Math.round(loads.sys * 10) / 10,
      systemicCtl: Math.round(sysCtl * 10) / 10,
      systemicAtl: Math.round(sysAtl * 10) / 10,
      systemicTsb: Math.round(sysTsb * 10) / 10,
      cyclingLoad: Math.round(loads.cyc * 10) / 10,
      cyclingCtl: Math.round(cycCtl * 10) / 10,
      cyclingAtl: Math.round(cycAtl * 10) / 10,
      cyclingTsb: Math.round(cycTsb * 10) / 10,
      runningLoad: Math.round(loads.run * 10) / 10,
      runningCtl: Math.round(runCtl * 10) / 10,
      runningAtl: Math.round(runAtl * 10) / 10,
      runningTsb: Math.round(runTsb * 10) / 10,
    });
  }

  return windowDays > 0 ? fullSeries.slice(-windowDays) : fullSeries;
}
