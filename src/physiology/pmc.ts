import type {
  AthleteProfile,
  DualSportPmcPoint,
  ThresholdHistoryEntry,
  UnifiedActivity,
} from '../types';
import { computeCyclingTss, computeRunningTss } from './powerPaceMetrics';

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
  const dateStr = (activity.startDateLocal || '').slice(0, 10);
  const thresholds = resolveThresholdsAtDate(profile, dateStr);
  const dur = activity.movingTimeSecs || 0;

  if (activity.sportCategory === 'Cycling' && dur > 0) {
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
  windowDays = 90
): DualSportPmcPoint[] {
  if (activities.length === 0) return [];

  const sorted = [...activities].sort((a, b) =>
    a.startDateLocal.localeCompare(b.startDateLocal)
  );
  const firstDateStr = sorted[0].startDateLocal.slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);

  const byDay = new Map<string, { sys: number; cyc: number; run: number }>();
  for (const act of sorted) {
    const d = act.startDateLocal.slice(0, 10);
    const load = computeHistoricalActivityLoad(act, profile);
    const bucket = byDay.get(d) || { sys: 0, cyc: 0, run: 0 };
    bucket.sys += load;
    if (act.sportCategory === 'Cycling') bucket.cyc += load;
    else if (act.sportCategory === 'Running') bucket.run += load;
    byDay.set(d, bucket);
  }

  const ctlDecay = Math.exp(-1 / 42);
  const atlDecay = Math.exp(-1 / 7);

  let sysCtl = 0;
  let sysAtl = 0;
  let cycCtl = 0;
  let cycAtl = 0;
  let runCtl = 0;
  let runAtl = 0;

  const startMs = Date.parse(`${firstDateStr}T00:00:00Z`);
  const endMs = Math.max(startMs, Date.parse(`${todayStr}T00:00:00Z`));
  const dayMs = 86_400_000;

  const fullSeries: DualSportPmcPoint[] = [];
  for (let ms = startMs; ms <= endMs; ms += dayMs) {
    const dStr = new Date(ms).toISOString().slice(0, 10);
    const loads = byDay.get(dStr) || { sys: 0, cyc: 0, run: 0 };

    const sysTsb = sysCtl - sysAtl;
    const cycTsb = cycCtl - cycAtl;
    const runTsb = runCtl - runAtl;

    sysCtl = sysCtl * ctlDecay + loads.sys * (1 - ctlDecay);
    sysAtl = sysAtl * atlDecay + loads.sys * (1 - atlDecay);

    cycCtl = cycCtl * ctlDecay + loads.cyc * (1 - ctlDecay);
    cycAtl = cycAtl * atlDecay + loads.cyc * (1 - atlDecay);

    runCtl = runCtl * ctlDecay + loads.run * (1 - ctlDecay);
    runAtl = runAtl * atlDecay + loads.run * (1 - atlDecay);

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
