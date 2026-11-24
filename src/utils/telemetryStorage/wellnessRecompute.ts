import type {
  AthleteProfile,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../../types';
import {
  BANISTER_ATL_DECAY,
  BANISTER_CTL_DECAY,
  getLocalDateIso,
  shiftIsoDate,
} from '../../physiology/stravaLoadCalibration';
import { recalibrateStravaActivityLoadClient } from './profileCalibration';

export function mergeWellnessDaysNonDestructive(
  existing: UnifiedWellnessDay[],
  incoming: UnifiedWellnessDay[]
): UnifiedWellnessDay[] {
  if (!Array.isArray(existing) || existing.length === 0) return incoming;
  if (!Array.isArray(incoming) || incoming.length === 0) return existing;

  const byDate = new Map<string, UnifiedWellnessDay>();
  for (const w of existing) {
    if (w && w.date) byDate.set(w.date, w);
  }
  for (const w of incoming) {
    if (w && w.date) byDate.set(w.date, w);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Uses activity-derived Banister CTL/ATL/TSB/dailyLoad as the authoritative spine
 * while preserving non-zero hardware biometrics (HRV, RHR, sleep, weight, VO2)
 * from any existing or Garmin wellness history without ever overwriting PMC load.
 */
export function overlayBiometricsOntoActivityWellness(
  activityDerived: UnifiedWellnessDay[],
  biometricSource: UnifiedWellnessDay[],
  asOfDateIso: string = getLocalDateIso()
): UnifiedWellnessDay[] {
  if (!Array.isArray(activityDerived) || activityDerived.length === 0) {
    return Array.isArray(biometricSource)
      ? biometricSource.filter((w) => w && w.date && w.date.slice(0, 10) <= asOfDateIso)
      : [];
  }
  if (!Array.isArray(biometricSource) || biometricSource.length === 0) {
    return activityDerived;
  }

  const bioByDate = new Map<string, UnifiedWellnessDay>();
  for (const w of biometricSource) {
    if (!w || !w.date) continue;
    const d = w.date.slice(0, 10);
    if (d <= asOfDateIso) {
      bioByDate.set(d, w);
    }
  }

  const firstActDate = activityDerived[0].date.slice(0, 10);
  const priorBiometricDays: UnifiedWellnessDay[] = [];
  for (const [d, w] of bioByDate.entries()) {
    if (d < firstActDate) {
      priorBiometricDays.push(w);
    }
  }

  const overlaid = activityDerived.map((actDay) => {
    const bio = bioByDate.get(actDay.date.slice(0, 10));
    if (!bio) return actDay;
    return {
      ...actDay,
      hrvRMSSD: bio.hrvRMSSD > 0 ? bio.hrvRMSSD : actDay.hrvRMSSD,
      hrvBaseline7d: bio.hrvBaseline7d > 0 ? bio.hrvBaseline7d : actDay.hrvBaseline7d,
      hrvNormalBandLow:
        bio.hrvNormalBandLow && bio.hrvNormalBandLow > 0
          ? bio.hrvNormalBandLow
          : actDay.hrvNormalBandLow,
      hrvNormalBandHigh:
        bio.hrvNormalBandHigh && bio.hrvNormalBandHigh > 0
          ? bio.hrvNormalBandHigh
          : actDay.hrvNormalBandHigh,
      hrvStatus: bio.hrvStatus || actDay.hrvStatus,
      restingHR: bio.restingHR > 0 ? bio.restingHR : actDay.restingHR,
      sleepSecs: bio.sleepSecs > 0 ? bio.sleepSecs : actDay.sleepSecs,
      sleepScore: bio.sleepScore > 0 ? bio.sleepScore : actDay.sleepScore,
      sleepQuality: bio.sleepQuality ?? actDay.sleepQuality,
      sleepDebt7dSecs: bio.sleepDebt7dSecs ?? actDay.sleepDebt7dSecs,
      weightKg:
        bio.weightKg > 30 && bio.weightKg !== 70 ? bio.weightKg : actDay.weightKg,
      vo2MaxCycling: bio.vo2MaxCycling || actDay.vo2MaxCycling,
      vo2MaxRunning: bio.vo2MaxRunning || actDay.vo2MaxRunning,
      spO2: bio.spO2 ?? actDay.spO2,
      respiration: bio.respiration ?? actDay.respiration,
      steps: bio.steps ?? actDay.steps,
      floorsClimbed: bio.floorsClimbed ?? actDay.floorsClimbed,
      soreness: bio.soreness ?? actDay.soreness,
      rideEftp: bio.rideEftp || actDay.rideEftp,
      rideWPrime: bio.rideWPrime || actDay.rideWPrime,
      ridePMax: bio.ridePMax || actDay.ridePMax,
      runEftp: bio.runEftp || actDay.runEftp,
      runWPrime: bio.runWPrime || actDay.runWPrime,
      runPMax: bio.runPMax || actDay.runPMax,
    };
  });

  return [...priorBiometricDays, ...overlaid].sort((a, b) => a.date.localeCompare(b.date));
}

function buildBanisterWellnessDayRow(params: {
  dateStr: string;
  dailyLoad: number;
  ctl: number;
  atl: number;
  ctl7DaysAgo: number;
  reason: string;
}): UnifiedWellnessDay {
  const { dateStr, dailyLoad, ctl, atl, ctl7DaysAgo, reason } = params;
  const tsb = ctl - atl;
  const rampRate = Number((ctl - ctl7DaysAgo).toFixed(1));
  const loadRatio = ctl > 5 ? Number((atl / ctl).toFixed(2)) : 1.0;

  let garminTrainingStatus: UnifiedWellnessDay['garminTrainingStatus'] = 'Maintaining';
  if ((rampRate > 6 && atl >= 28) || tsb < -25) garminTrainingStatus = 'Overreaching';
  else if (rampRate >= 1.5 && tsb >= -22) garminTrainingStatus = 'Productive';
  else if (tsb > 10 && ctl > 35) garminTrainingStatus = 'Peaking';
  else if (rampRate < -2) garminTrainingStatus = 'Recovery';

  const readinessScore = Math.max(
    25,
    Math.min(96, Math.round(75 + Math.max(-25, Math.min(15, tsb)) * 0.7))
  );

  return {
    date: dateStr,
    ctl: Number(ctl.toFixed(1)),
    atl: Number(atl.toFixed(1)),
    tsb: Number(tsb.toFixed(1)),
    loadRatio,
    rampRate,
    hrvRMSSD: 0,
    hrvBaseline7d: 0,
    hrvNormalBandLow: 0,
    hrvNormalBandHigh: 0,
    restingHR: 0,
    sleepSecs: 0,
    sleepScore: 0,
    weightKg: 70,
    readinessStatus:
      readinessScore >= 80 ? 'Optimal' : readinessScore >= 60 ? 'Caution' : 'Strain',
    garminTrainingStatus,
    trainingStatusReason: reason,
    dailyLoad,
  };
}

function buildLoadByDateMap(activities: UnifiedActivity[]): Map<string, number> {
  const loadByDate = new Map<string, number>();
  for (const act of activities) {
    if (!act || !act.startDateLocal) continue;
    const d = act.startDateLocal.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      loadByDate.set(
        d,
        (loadByDate.get(d) || 0) + Math.max(0, Number(act.trainingLoad || 0))
      );
    }
  }
  return loadByDate;
}

/**
 * Repairs any cold-start Banister CTL cliff discontinuity (e.g. Garmin 28-day window reset
 * dropping CTL 68 -> ~3 on day 1 of the window) and rolls wellness days through today
 * using recalibrated v3 activity loads while preserving all hardware biometrics & eFTP.
 */
export function repairAndRecomputeWellnessDays(
  existingWellness: UnifiedWellnessDay[],
  activities: UnifiedActivity[],
  asOfDateIso: string = getLocalDateIso(),
  options?: { forceFullRecomputeIfNoCliff?: boolean; profile?: Partial<AthleteProfile> | null }
): UnifiedWellnessDay[] {
  const todayIso = (asOfDateIso || getLocalDateIso()).slice(0, 10);
  const calibratedActivities = activities.map((act) =>
    recalibrateStravaActivityLoadClient(act, options?.profile)
  );
  const filteredExisting = Array.isArray(existingWellness)
    ? [...existingWellness]
        .filter((w) => w && w.date && w.date.slice(0, 10) <= todayIso)
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];

  if (filteredExisting.length === 0) {
    return computeWellnessDaysFromActivities(calibratedActivities, todayIso);
  }

  let cliffIdx = -1;
  for (let i = 1; i < filteredExisting.length; i++) {
    const prev = filteredExisting[i - 1];
    const curr = filteredExisting[i];
    if (prev.ctl >= 15 && curr.ctl < prev.ctl * 0.65) {
      cliffIdx = i;
      break;
    }
  }

  if (cliffIdx > 0) {
    const loadByDate = buildLoadByDateMap(calibratedActivities);

    const prefix = filteredExisting.slice(0, cliffIdx);
    const anchor = prefix[prefix.length - 1];
    const anchorDate = anchor.date.slice(0, 10);
    let ctl = anchor.ctl;
    let atl = anchor.atl;
    const repaired: UnifiedWellnessDay[] = [...prefix];

    for (
      let dateStr = shiftIsoDate(anchorDate, 1);
      dateStr <= todayIso;
      dateStr = shiftIsoDate(dateStr, 1)
    ) {
      const dailyLoad = Math.round(loadByDate.get(dateStr) || 0);
      ctl = ctl * BANISTER_CTL_DECAY + dailyLoad * (1 - BANISTER_CTL_DECAY);
      atl = atl * BANISTER_ATL_DECAY + dailyLoad * (1 - BANISTER_ATL_DECAY);
      const ctl7DaysAgo =
        repaired.length >= 7 ? repaired[repaired.length - 7].ctl : anchor.ctl;
      repaired.push(
        buildBanisterWellnessDayRow({
          dateStr,
          dailyLoad,
          ctl,
          atl,
          ctl7DaysAgo,
          reason: 'Continuously propagated Banister load from verified prior baseline.',
        })
      );
    }

    return overlayBiometricsOntoActivityWellness(repaired, filteredExisting, todayIso);
  }

  const firstExisting = filteredExisting[0];
  const lastExisting = filteredExisting[filteredExisting.length - 1];
  const firstExistingDate = firstExisting.date.slice(0, 10);
  const lastExistingDate = lastExisting.date.slice(0, 10);

  const hasEarlierActivityHistory =
    firstExisting.ctl < 10 &&
    calibratedActivities.some(
      (a) => a.startDateLocal && a.startDateLocal.slice(0, 10) < firstExistingDate
    );

  if (options?.forceFullRecomputeIfNoCliff || hasEarlierActivityHistory) {
    const computed = computeWellnessDaysFromActivities(calibratedActivities, todayIso);
    return computed.length > 0
      ? overlayBiometricsOntoActivityWellness(computed, filteredExisting, todayIso)
      : filteredExisting;
  }

  if (lastExistingDate < todayIso) {
    const loadByDate = buildLoadByDateMap(calibratedActivities);
    const rolled: UnifiedWellnessDay[] = [...filteredExisting];
    let ctl = lastExisting.ctl;
    let atl = lastExisting.atl;
    for (
      let dateStr = shiftIsoDate(lastExistingDate, 1);
      dateStr <= todayIso;
      dateStr = shiftIsoDate(dateStr, 1)
    ) {
      const dailyLoad = Math.round(loadByDate.get(dateStr) || 0);
      ctl = ctl * BANISTER_CTL_DECAY + dailyLoad * (1 - BANISTER_CTL_DECAY);
      atl = atl * BANISTER_ATL_DECAY + dailyLoad * (1 - BANISTER_ATL_DECAY);
      const ctl7DaysAgo =
        rolled.length >= 7 ? rolled[rolled.length - 7].ctl : lastExisting.ctl;
      rolled.push(
        buildBanisterWellnessDayRow({
          dateStr,
          dailyLoad,
          ctl,
          atl,
          ctl7DaysAgo,
          reason: 'Rolled forward Banister load through today.',
        })
      );
    }
    return overlayBiometricsOntoActivityWellness(rolled, filteredExisting, todayIso);
  }

  return filteredExisting;
}

/**
 * Rebuilds the Banister CTL/ATL/TSB spine after importing or logging new activities
 * while preserving all synced hardware biometrics (HRV, RHR, sleep, weight, VO2).
 */
export function recomputeWellnessDaysWithActivityImport(
  existingWellness: UnifiedWellnessDay[],
  activities: UnifiedActivity[],
  asOfDateIso: string = getLocalDateIso(),
  profile?: Partial<AthleteProfile> | null
): UnifiedWellnessDay[] {
  const todayIso = (asOfDateIso || getLocalDateIso()).slice(0, 10);
  const calibratedActivities = activities.map((act) =>
    recalibrateStravaActivityLoadClient(act, profile)
  );
  const activitySpine = computeWellnessDaysFromActivities(calibratedActivities, todayIso);
  if (activitySpine.length === 0) {
    return Array.isArray(existingWellness)
      ? existingWellness.filter((w) => w && w.date && w.date.slice(0, 10) <= todayIso)
      : [];
  }
  return overlayBiometricsOntoActivityWellness(activitySpine, existingWellness, todayIso);
}

export function computeWellnessDaysFromActivities(
  activities: UnifiedActivity[],
  asOfDateIso?: string
): UnifiedWellnessDay[] {
  if (!Array.isArray(activities) || activities.length === 0) return [];
  const todayIso = (asOfDateIso || getLocalDateIso()).slice(0, 10);
  const lookbackDefaultIso = shiftIsoDate(todayIso, -180);
  const lookbackHardCapIso = shiftIsoDate(todayIso, -365);

  const loadByDate = new Map<string, number>();
  let earliestActIso = lookbackDefaultIso;
  for (const act of activities) {
    if (!act || !act.startDateLocal) continue;
    const d = act.startDateLocal.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (d < earliestActIso) {
      earliestActIso = d;
    }
    loadByDate.set(d, (loadByDate.get(d) || 0) + Math.max(0, Number(act.trainingLoad || 0)));
  }

  const startIso = earliestActIso < lookbackHardCapIso ? lookbackHardCapIso : earliestActIso;
  const days: UnifiedWellnessDay[] = [];
  let ctl = 0;
  let atl = 0;

  for (let dateStr = startIso; dateStr <= todayIso; dateStr = shiftIsoDate(dateStr, 1)) {
    const dailyLoad = Math.round(loadByDate.get(dateStr) || 0);
    ctl = ctl * BANISTER_CTL_DECAY + dailyLoad * (1 - BANISTER_CTL_DECAY);
    atl = atl * BANISTER_ATL_DECAY + dailyLoad * (1 - BANISTER_ATL_DECAY);
    const tsb = ctl - atl;
    const ctl7DaysAgo = days.length >= 7 ? days[days.length - 7].ctl : 0;
    const rampRate = Number((ctl - ctl7DaysAgo).toFixed(1));
    const loadRatio = ctl > 5 ? Number((atl / ctl).toFixed(2)) : 1.0;

    let garminTrainingStatus: UnifiedWellnessDay['garminTrainingStatus'] = 'Maintaining';
    if ((rampRate > 6 && atl >= 28) || tsb < -25) garminTrainingStatus = 'Overreaching';
    else if (rampRate >= 1.5 && tsb >= -22) garminTrainingStatus = 'Productive';
    else if (tsb > 10 && ctl > 35) garminTrainingStatus = 'Peaking';
    else if (rampRate < -2) garminTrainingStatus = 'Recovery';

    const readinessScore = Math.max(
      25,
      Math.min(96, Math.round(75 + Math.max(-25, Math.min(15, tsb)) * 0.7))
    );

    days.push({
      date: dateStr,
      ctl: Number(ctl.toFixed(1)),
      atl: Number(atl.toFixed(1)),
      tsb: Number(tsb.toFixed(1)),
      loadRatio,
      rampRate,
      hrvRMSSD: 0,
      hrvBaseline7d: 0,
      hrvNormalBandLow: 0,
      hrvNormalBandHigh: 0,
      restingHR: 0,
      sleepSecs: 0,
      sleepScore: 0,
      weightKg: 70,
      readinessStatus:
        readinessScore >= 80 ? 'Optimal' : readinessScore >= 60 ? 'Caution' : 'Strain',
      garminTrainingStatus,
      trainingStatusReason: 'Computed from Strava training load history.',
      dailyLoad,
    });
  }

  return days;
}
