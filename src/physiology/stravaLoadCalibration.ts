import type { ActivityEnvironment, SportCategory } from '../types.ts';

export const STRAVA_LOAD_MODEL_VERSION = 2;
export const BANISTER_CTL_DECAY = Math.exp(-1 / 42);
export const BANISTER_ATL_DECAY = Math.exp(-1 / 7);

/**
 * Returns local calendar YYYY-MM-DD (avoids UTC evening rollover in US timezones).
 */
export function getLocalDateIso(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Shifts a YYYY-MM-DD calendar string by `deltaDays` using UTC calendar math (immune to DST drift).
 */
export function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const [yStr, mStr, dStr] = isoDate.slice(0, 10).split('-');
  const dt = new Date(
    Date.UTC(Number(yStr) || 2026, (Number(mStr) || 1) - 1, Number(dStr) || 1)
  );
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

export function isEBikeActivityText(
  rawSportType?: string | null,
  name?: string | null
): boolean {
  const combined = `${rawSportType || ''} ${name || ''}`;
  return /e[-_]?bike|e[-_]?mtb|emountainbike|velomobile/i.test(combined);
}

export function isVirtualCyclingText(text?: string | null): boolean {
  return /virtualride|virtual|zwift|watopia|makuri|neokyo|urukazi|alpe du zwift|ven-top|crit city|rouvy|mywhoosh|indievelo|trainingpeaks virtual|bkool|fulgaz|kinomap|\brgt\b/i.test(
    text || ''
  );
}

export interface ObservedPhysiologyMetrics {
  obsFtp: number;
  obsPMax: number;
  obsWPrime: number;
  obsBikeMaxHr: number;
  obsBikeLthr: number;
  obsRunMaxHr: number;
  obsRunLthr: number;
  obsThresholdPace: number;
  obsRunFtp: number;
  obsVo2Bike: number;
  obsVo2Run: number;
}

/**
 * Derives empirical cycling/running thresholds from activity history while strictly
 * ignoring un-metered Strava power estimates (`device_watts === false`), e-bikes,
 * and low-intensity / casual sessions so light weeks never collapse FTP/LTHR/LT2 downward.
 */
export function deriveObservedPhysiologyMetrics(
  activities?: Record<string, any>[] | null,
  weightKg = 70
): ObservedPhysiologyMetrics {
  let maxBikeWatts20m = 0;
  let maxBikePeakWatts = 0;
  let maxBikeHr = 0;
  let maxBikeSustainedHr = 0;
  let maxRunHr = 0;
  let maxRunSustainedHr = 0;
  let maxRunSustainedWatts = 0;
  let bestRunPaceSecsPerKm = 0;

  if (Array.isArray(activities)) {
    for (const a of activities) {
      if (!a) continue;
      const sport = String(
        a.sportCategory ||
          a.rawSportType ||
          a.sport_type ||
          a.type ||
          a.activityType?.typeKey ||
          ''
      );
      const rawType = String(a.rawSportType || a.sport_type || a.type || '');
      const actName = String(a.name || a.activityName || '');
      const isEBike = isEBikeActivityText(rawType || sport, actName);
      const isBike =
        !isEBike && /ride|cycling|virtualride|bike|biking|zwift|peloton|spin/i.test(sport);
      const isRun = /run|trailrun|virtualrun|running|treadmill/i.test(sport);

      const dur = Number(
        a.movingTimeSecs ?? a.movingDuration ?? a.moving_time ?? a.elapsed_time ?? a.duration ?? 0
      );
      const dist = Number(a.distanceMeters ?? a.distance ?? 0);
      const avgP = Number(a.avgPower ?? a.icu_average_watts ?? a.average_watts ?? 0);
      const np = Number(
        a.normalizedPower ??
          a.normPower ??
          a.icu_weighted_avg_watts ??
          a.weighted_average_watts ??
          avgP
      );
      const sustainedBikeW =
        avgP > 0 && np > avgP * 1.08 ? Math.round(avgP * 1.05) : np;
      const p20 = Number(a.max20MinPower ?? a.maxAvgPower_1200 ?? 0);
      const peakW = Number(a.max_watts ?? a.maxPower ?? a.maxAvgPower_1 ?? a.pMax ?? 0);
      const avgHr = Number(a.avgHr ?? a.averageHR ?? a.average_heartrate ?? 0);
      const peakHr = Number(a.maxHr ?? a.maxHR ?? a.max_heartrate ?? 0);

      const deviceWattsFlag = a.device_watts ?? a.deviceWatts;
      const hasMeteredBikeWatts = deviceWattsFlag !== false;

      if (isBike) {
        if (hasMeteredBikeWatts) {
          if (p20 >= 150 && p20 <= 600) {
            if (p20 > maxBikeWatts20m) maxBikeWatts20m = p20;
          } else if (
            dur >= 1200 &&
            sustainedBikeW >= 150 &&
            sustainedBikeW <= 600 &&
            (avgHr === 0 || avgHr >= 142 || (peakHr >= 160 && avgHr >= peakHr * 0.82)) &&
            sustainedBikeW > maxBikeWatts20m
          ) {
            maxBikeWatts20m = sustainedBikeW;
          }

          if (peakW >= 250 && peakW <= 2500 && peakW > maxBikePeakWatts) {
            maxBikePeakWatts = Math.round(peakW);
          } else if (sustainedBikeW >= 150 && np > 0 && np * 2.25 > maxBikePeakWatts) {
            maxBikePeakWatts = Math.round(np * 2.25);
          }
        }

        if (peakHr >= 158 && peakHr <= 225 && peakHr > maxBikeHr) {
          maxBikeHr = peakHr;
        }
        if (dur >= 1200 && avgHr >= 146 && avgHr <= 210 && avgHr > maxBikeSustainedHr) {
          maxBikeSustainedHr = avgHr;
        }
      } else if (isRun) {
        if (peakHr >= 158 && peakHr <= 225 && peakHr > maxRunHr) {
          maxRunHr = peakHr;
        }
        if (dur >= 1200 && avgHr >= 148 && avgHr <= 210 && avgHr > maxRunSustainedHr) {
          maxRunSustainedHr = avgHr;
        }
        if (deviceWattsFlag !== false && dur >= 1200 && np >= 120 && np <= 650 && np > maxRunSustainedWatts) {
          maxRunSustainedWatts = np;
        }
        const split5k = Number(a.fastestSplit_5000 ?? 0);
        const paceFrom5k =
          split5k >= 780 && split5k <= 2100 ? Math.round(split5k / 5) : 0;
        const pace =
          paceFrom5k ||
          Number(a.gapPaceSecsPerKm ?? a.avgPaceSecsPerKm ?? 0) ||
          (dist >= 3000 && dur >= 900 ? Math.round(dur / (dist / 1000)) : 0);
        const isHardEnoughForThreshold =
          pace <= 300 ||
          (pace <= 420 && (avgHr >= 150 || (peakHr >= 162 && avgHr >= peakHr * 0.85)));
        if (
          (paceFrom5k > 0 || (dur >= 1200 && dist >= 3000)) &&
          pace >= 165 &&
          pace <= 420 &&
          isHardEnoughForThreshold
        ) {
          if (bestRunPaceSecsPerKm === 0 || pace < bestRunPaceSecsPerKm) {
            bestRunPaceSecsPerKm = pace;
          }
        }
      }
    }
  }

  const anyMaxHr = Math.max(maxBikeHr, maxRunHr);
  const obsBikeMaxHr = maxBikeHr || anyMaxHr || 0;
  const obsBikeLthr =
    maxBikeSustainedHr >= 146
      ? Math.max(
          148,
          Math.min(obsBikeMaxHr ? obsBikeMaxHr - 6 : 200, Math.round(maxBikeSustainedHr * 0.98))
        )
      : obsBikeMaxHr >= 158
        ? Math.max(148, Math.round(obsBikeMaxHr * 0.9))
        : 0;
  const obsRunMaxHr = maxRunHr || obsBikeMaxHr || 0;
  const obsRunLthr =
    maxRunSustainedHr >= 148
      ? Math.max(
          150,
          Math.min(obsRunMaxHr ? obsRunMaxHr - 5 : 205, Math.round(maxRunSustainedHr * 0.98))
        )
      : obsRunMaxHr >= 158
        ? Math.max(150, Math.round(obsRunMaxHr * 0.91))
        : obsBikeLthr
          ? obsBikeLthr + 4
          : 0;
  const obsFtp = maxBikeWatts20m >= 150 ? Math.round(maxBikeWatts20m * 0.95) : 0;
  const obsPMax =
    maxBikePeakWatts >= 400
      ? Math.round(maxBikePeakWatts)
      : obsFtp > 0
        ? Math.round(obsFtp * 3.6)
        : 0;
  const obsWPrime = obsFtp > 0 ? Math.round(obsFtp * 75) : 0;
  const obsThresholdPace =
    bestRunPaceSecsPerKm > 0 ? Math.round(bestRunPaceSecsPerKm * 1.03) : 0;
  const safeW = weightKg > 30 ? weightKg : 70;
  const obsRunFtp =
    maxRunSustainedWatts >= 140
      ? Math.round(maxRunSustainedWatts * 0.92)
      : obsThresholdPace > 0
        ? Math.round(safeW * (1000 / obsThresholdPace) * 0.98)
        : 0;
  const obsVo2Bike =
    obsFtp > 0 && safeW > 30
      ? Math.max(32, Math.min(88, Math.round(10.8 * (obsFtp / safeW) + 7)))
      : 0;
  const obsVo2Run =
    obsThresholdPace > 0
      ? Math.max(32, Math.min(88, Math.round((1000 / obsThresholdPace) * 60 * 0.2 + 3.5)))
      : obsVo2Bike;

  return {
    obsFtp,
    obsPMax,
    obsWPrime,
    obsBikeMaxHr,
    obsBikeLthr,
    obsRunMaxHr,
    obsRunLthr,
    obsThresholdPace,
    obsRunFtp,
    obsVo2Bike,
    obsVo2Run,
  };
}

export interface StravaLoadInput {
  sportCategory: SportCategory;
  rawSportType?: string;
  name?: string;
  environment?: ActivityEnvironment;
  movingTimeSecs: number;
  distanceMeters?: number;
  elevationGainMeters?: number;
  normalizedPower?: number;
  avgPower?: number;
  hasRealDeviceWatts?: boolean;
  avgHr?: number;
  maxHr?: number;
  avgPaceSecsPerKm?: number;
  sufferScore?: number;
  calibratedFtp: number;
  calibratedBikeLthr: number;
  calibratedRunLthr: number;
  calibratedThresholdPaceSecsPerKm: number;
  restingHr?: number;
}

export interface StravaLoadResult {
  trainingLoad: number;
  intensityFactor?: number;
  isEBike: boolean;
  isLowImpactCasual: boolean;
  isModerateOutdoor: boolean;
}

export function computeHrrRatio(
  avgBpm: number,
  lthrBpm: number,
  restingHr = 54
): number {
  const safeRest = Math.max(38, Math.min(78, restingHr || 54));
  const reserve = Math.max(65, (lthrBpm || 163) - safeRest);
  return Math.max(0, Math.min(1.22, (avgBpm - safeRest) / reserve));
}

/**
 * Physiological v2 load model replacing Strava's inflated Relative Effort (`suffer_score`).
 * Uses metered Coggan Power TSS, HR Reserve (%HRR) TRIMP-scaled hrTSS, GAP rTSS with
 * HR cross-guard on easy jogs, and realistic low/moderate caps for walks, e-bikes, and mobility.
 */
export function computeStravaActivityLoadV2(input: StravaLoadInput): StravaLoadResult {
  const rawType = String(input.rawSportType || '').trim();
  const actName = String(input.name || '').trim();
  const isEBike = isEBikeActivityText(rawType, actName);
  const isLowImpactCasual =
    !isEBike &&
    (/^(walk|golf|yoga|pilates|stretch|mobility|meditation|breathwork|sailing|skateboard)/i.test(
      rawType
    ) ||
      (input.sportCategory === 'Strength' &&
        /\b(walk|walking|stroll|golf|yoga|pilates|stretch|stretching|mobility|meditation|breathwork|sauna)\b/i.test(
          actName
        )));
  const isModerateOutdoor =
    !isEBike &&
    !isLowImpactCasual &&
    (/^(hike|snowshoe|standuppaddling|kayaking|canoeing|rowing|alpineski|backcountryski|nordicski|surfing)/i.test(
      rawType
    ) ||
      (input.sportCategory === 'Strength' &&
        /\b(hike|hiking|snowshoe|paddle|kayak|canoe|ski|snowboard|rowing)\b/i.test(actName)));

  const movingTimeSecs = Math.max(0, Number(input.movingTimeSecs || 0));
  const hrs = movingTimeSecs / 3600;
  if (hrs <= 0.01) {
    return {
      trainingLoad: Math.min(20, Math.max(0, Math.round(Number(input.sufferScore || 0) * 0.25))),
      intensityFactor: undefined,
      isEBike,
      isLowImpactCasual,
      isModerateOutdoor,
    };
  }

  const restHr = Math.max(38, Math.min(78, Number(input.restingHr || 54)));
  const avgHr = Math.round(Number(input.avgHr || 0));
  const bikeLthr = Math.max(135, Number(input.calibratedBikeLthr || 163));
  const runLthr = Math.max(140, Number(input.calibratedRunLthr || 168));
  const ftp = Math.max(120, Number(input.calibratedFtp || 250));
  const thresholdPace = Math.max(155, Number(input.calibratedThresholdPaceSecsPerKm || 255));
  const distMeters = Math.max(0, Number(input.distanceMeters || 0));
  const elevGain = Math.max(0, Number(input.elevationGainMeters || 0));

  if (isEBike) {
    if (avgHr > 60) {
      const hrr = computeHrrRatio(avgHr, bikeLthr, restHr);
      return {
        trainingLoad: Math.min(Math.round(hrs * 40), Math.round(hrs * 65 * hrr * hrr)),
        intensityFactor: Number(Math.min(0.95, 0.35 + hrr * 0.5).toFixed(2)),
        isEBike,
        isLowImpactCasual,
        isModerateOutdoor,
      };
    }
    return {
      trainingLoad: Math.round(hrs * 18),
      intensityFactor: 0.42,
      isEBike,
      isLowImpactCasual,
      isModerateOutdoor,
    };
  }

  if (isLowImpactCasual) {
    if (avgHr > 60) {
      const hrr = computeHrrRatio(avgHr, bikeLthr, restHr);
      return {
        trainingLoad: Math.min(Math.round(hrs * 32), Math.round(hrs * 65 * hrr * hrr)),
        intensityFactor: Number(Math.min(0.85, 0.3 + hrr * 0.48).toFixed(2)),
        isEBike,
        isLowImpactCasual,
        isModerateOutdoor,
      };
    }
    return {
      trainingLoad: Math.round(hrs * 14),
      intensityFactor: 0.38,
      isEBike,
      isLowImpactCasual,
      isModerateOutdoor,
    };
  }

  if (isModerateOutdoor) {
    if (avgHr > 60) {
      const hrr = computeHrrRatio(avgHr, runLthr, restHr);
      return {
        trainingLoad: Math.round(hrs * 78 * hrr * hrr),
        intensityFactor: Number(Math.min(1.05, 0.4 + hrr * 0.55).toFixed(2)),
        isEBike,
        isLowImpactCasual,
        isModerateOutdoor,
      };
    }
    return {
      trainingLoad: Math.round(hrs * 24),
      intensityFactor: 0.5,
      isEBike,
      isLowImpactCasual,
      isModerateOutdoor,
    };
  }

  if (input.sportCategory === 'Cycling') {
    const np = Number(input.normalizedPower || input.avgPower || 0);
    if (input.hasRealDeviceWatts && np > 0) {
      const ifVal = Math.max(0.25, Math.min(1.35, np / ftp));
      return {
        trainingLoad: Math.round(((movingTimeSecs * np * ifVal) / (ftp * 3600)) * 100),
        intensityFactor: Number(ifVal.toFixed(2)),
        isEBike,
        isLowImpactCasual,
        isModerateOutdoor,
      };
    }
    if (avgHr > 60) {
      const hrr = computeHrrRatio(avgHr, bikeLthr, restHr);
      return {
        trainingLoad: Math.round(hrs * 92 * hrr * hrr),
        intensityFactor: Number(Math.min(1.18, 0.45 + hrr * 0.55).toFixed(2)),
        isEBike,
        isLowImpactCasual,
        isModerateOutdoor,
      };
    }
    const speedKph = distMeters > 0 && hrs > 0 ? distMeters / 1000 / hrs : 18;
    const rate = speedKph < 16 ? 20 : speedKph < 22 ? 28 : 35;
    return {
      trainingLoad: Math.round(hrs * rate),
      intensityFactor: Number(Math.sqrt(rate / 100).toFixed(2)),
      isEBike,
      isLowImpactCasual,
      isModerateOutdoor,
    };
  }

  if (input.sportCategory === 'Running') {
    const hrrRun = avgHr > 60 ? computeHrrRatio(avgHr, runLthr, restHr) : 0;
    const hrLoad = avgHr > 60 ? Math.round(hrs * 95 * hrrRun * hrrRun) : 0;

    let paceLoad = 0;
    let paceIf = 0;
    const rawPace =
      input.avgPaceSecsPerKm && input.avgPaceSecsPerKm > 120
        ? input.avgPaceSecsPerKm
        : distMeters > 200 && movingTimeSecs > 0
          ? movingTimeSecs / (distMeters / 1000)
          : 0;
    if (rawPace > 120) {
      const gradeFraction = distMeters > 0 ? elevGain / distMeters : 0;
      const gapPace =
        rawPace / (1 + Math.min(0.25, Math.max(0, gradeFraction) * 3.1));
      paceIf = Math.max(0.35, Math.min(1.25, thresholdPace / gapPace));
      paceLoad = Math.round(hrs * 100 * paceIf * paceIf);
    }

    if (hrLoad > 0 && paceLoad > 0) {
      let resolvedLoad: number;
      if (hrrRun <= 0.78 && paceLoad > hrLoad * 1.2) {
        resolvedLoad = Math.round(hrLoad * 1.05);
      } else if (movingTimeSecs < 1500) {
        resolvedLoad = Math.max(hrLoad, paceLoad);
      } else {
        resolvedLoad = Math.round(0.5 * paceLoad + 0.5 * hrLoad);
      }
      const effIf = Math.min(
        1.22,
        Math.sqrt(Math.max(0.1, resolvedLoad / Math.max(0.1, hrs * 100)))
      );
      return {
        trainingLoad: resolvedLoad,
        intensityFactor: Number(effIf.toFixed(2)),
        isEBike,
        isLowImpactCasual,
        isModerateOutdoor,
      };
    }

    if (paceLoad > 0) {
      return {
        trainingLoad: paceLoad,
        intensityFactor: Number(paceIf.toFixed(2)),
        isEBike,
        isLowImpactCasual,
        isModerateOutdoor,
      };
    }

    if (hrLoad > 0) {
      return {
        trainingLoad: hrLoad,
        intensityFactor: Number(Math.min(1.18, 0.45 + hrrRun * 0.55).toFixed(2)),
        isEBike,
        isLowImpactCasual,
        isModerateOutdoor,
      };
    }

    return {
      trainingLoad: Math.round(hrs * 38),
      intensityFactor: 0.62,
      isEBike,
      isLowImpactCasual,
      isModerateOutdoor,
    };
  }

  if (input.sportCategory === 'Swimming') {
    if (avgHr > 60) {
      const hrr = computeHrrRatio(avgHr, bikeLthr, restHr);
      return {
        trainingLoad: Math.round(hrs * 88 * hrr * hrr),
        intensityFactor: Number(Math.min(1.15, 0.45 + hrr * 0.55).toFixed(2)),
        isEBike,
        isLowImpactCasual,
        isModerateOutdoor,
      };
    }
    return {
      trainingLoad: Math.round(hrs * 36),
      intensityFactor: 0.6,
      isEBike,
      isLowImpactCasual,
      isModerateOutdoor,
    };
  }

  // Strength / Gym / Workout / Multisport fallback
  if (avgHr > 60) {
    const hrr = computeHrrRatio(avgHr, bikeLthr, restHr);
    const load = Math.min(
      Math.round(hrs * 65),
      Math.max(Math.round(hrs * 16), Math.round(hrs * 76 * hrr * hrr))
    );
    return {
      trainingLoad: load,
      intensityFactor: Number(Math.min(1.0, 0.35 + hrr * 0.55).toFixed(2)),
      isEBike,
      isLowImpactCasual,
      isModerateOutdoor,
    };
  }

  return {
    trainingLoad: Math.round(hrs * 28),
    intensityFactor: 0.53,
    isEBike,
    isLowImpactCasual,
    isModerateOutdoor,
  };
}
