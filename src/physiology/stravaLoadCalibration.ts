import type { ActivityEnvironment, ActivitySubType, SportCategory } from '../types.ts';

export const STRAVA_LOAD_MODEL_VERSION = 4;
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
  return /e[-_]?bike|e[-_]?mtb|emountainbike/i.test(combined);
}

export function isVirtualCyclingText(text?: string | null): boolean {
  return /virtualride|virtual_ride|virtual|zwift|watopia|makuri|neokyo|urukazi|alpe du zwift|ven-top|crit city|rouvy|mywhoosh|indievelo|trainingpeaks virtual|bkool|fulgaz|kinomap|\brgt\b/i.test(
    text || ''
  );
}

export interface MultiSportClassification {
  sportCategory: SportCategory;
  subType: ActivitySubType;
  environment: ActivityEnvironment;
}

/**
 * Canonical multi-sport taxonomy mapper shared across Strava, Garmin, Intervals.icu,
 * and client IndexedDB recalibration. Inspects explicit `rawSportType` BEFORE free-text
 * workout titles so `"Assault Bike HIIT"` (`HIIT`) or `"Walk to Bike Shop"` (`Walk`)
 * are never miscategorized as Cycling.
 */
export function classifyMultiSportActivity(
  rawSportType?: string | null,
  name?: string | null,
  opts?: {
    trainer?: boolean;
    hasGps?: boolean;
    isVirtualPlatform?: boolean;
  }
): MultiSportClassification {
  const rawType = String(rawSportType || '').trim();
  const actName = String(name || '').trim();
  const combined = `${rawType} ${actName}`.trim();
  const hasGps = Boolean(opts?.hasGps);
  const trainer = Boolean(opts?.trainer);
  const isVirtual = Boolean(opts?.isVirtualPlatform) || isVirtualCyclingText(combined);

  // 1. Explicit Strava / Garmin raw sport types checked first
  if (/^(ebikeride|emountainbikeride)$/i.test(rawType) || (isEBikeActivityText(rawType, '') && !/run|walk|hike/i.test(rawType))) {
    return {
      sportCategory: 'Cycling',
      subType: 'EBike',
      environment: trainer ? 'INDOOR' : 'OUTDOOR',
    };
  }

  if (/^(hike|hiking|snowshoe)$/i.test(rawType)) {
    return { sportCategory: 'Multisport', subType: 'Hiking', environment: 'OUTDOOR' };
  }

  if (/^(walk|casual_walking|speed_walking)$/i.test(rawType)) {
    return {
      sportCategory: 'Multisport',
      subType: 'Walking',
      environment: trainer ? 'INDOOR' : 'OUTDOOR',
    };
  }

  if (/^(rowing|virtualrow|indoor_rowing)$/i.test(rawType)) {
    const indoor = trainer || /virtualrow|indoor_rowing/i.test(rawType) || !hasGps;
    return {
      sportCategory: 'Multisport',
      subType: 'Rowing',
      environment: indoor ? 'INDOOR' : 'OUTDOOR',
    };
  }

  if (/^elliptical$/i.test(rawType)) {
    return { sportCategory: 'Multisport', subType: 'Elliptical', environment: 'INDOOR' };
  }

  if (/^(stairstepper|stair_climbing|floor_climbing)$/i.test(rawType)) {
    return { sportCategory: 'Multisport', subType: 'Stair Stepper', environment: 'INDOOR' };
  }

  if (/^(nordicski|rollerski|cross_country_skiing|xc_ski)$/i.test(rawType)) {
    const indoor = trainer || (/skierg/i.test(actName) && !hasGps);
    return {
      sportCategory: 'Multisport',
      subType: 'Nordic Ski',
      environment: indoor ? 'INDOOR' : 'OUTDOOR',
    };
  }

  if (/^(alpineski|backcountryski|snowboard|resort_skiing_snowboarding)$/i.test(rawType)) {
    return {
      sportCategory: 'Multisport',
      subType: 'Alpine & Backcountry Ski',
      environment: 'OUTDOOR',
    };
  }

  if (/^(kayaking|canoeing|standuppaddling|stand_up_paddleboarding|surfing|windsurf|kitesurf|sailing)$/i.test(rawType)) {
    return {
      sportCategory: 'Multisport',
      subType: 'Paddling & Water',
      environment: 'OUTDOOR',
    };
  }

  if (/^(soccer|tennis|pickleball|basketball|golf|iceskate|inlineskate|skateboard|badminton|squash|racquetball|tabletennis)$/i.test(rawType)) {
    return {
      sportCategory: 'Multisport',
      subType: 'Court & Field',
      environment: /badminton|squash|racquetball|tabletennis/i.test(rawType) && !hasGps ? 'INDOOR' : 'OUTDOOR',
    };
  }

  if (/^hiit$/i.test(rawType)) {
    return { sportCategory: 'Strength', subType: 'HIIT & Circuit', environment: 'INDOOR' };
  }

  if (/^(rockclimbing|bouldering)$/i.test(rawType)) {
    return {
      sportCategory: 'Strength',
      subType: 'Climbing',
      environment: hasGps ? 'OUTDOOR' : 'INDOOR',
    };
  }

  if (/^(yoga|pilates|stretching|stretch|mobility|meditation|breathwork)$/i.test(rawType)) {
    return { sportCategory: 'Strength', subType: 'Yoga & Mobility', environment: 'INDOOR' };
  }

  if (/^(weighttraining|crossfit|workout|strength_training)$/i.test(rawType)) {
    const isHiitText = /hiit|crossfit|circuit|metcon|bootcamp|interval/i.test(combined);
    return {
      sportCategory: 'Strength',
      subType: isHiitText ? 'HIIT & Circuit' : 'Gym',
      environment: 'INDOOR',
    };
  }

  if (/swim|open_water|openwaterswim/i.test(rawType)) {
    const isOpenWater = /open[\s_-]*water|ocean|lake|sea/i.test(combined) || hasGps;
    return {
      sportCategory: 'Swimming',
      subType: isOpenWater ? 'Open Water' : 'Pool',
      environment: isOpenWater ? 'OUTDOOR' : 'INDOOR',
    };
  }

  if (/^(run|trailrun|virtualrun|running|treadmill_running|trail_running|track_running|virtual_run)$/i.test(rawType) || (/run|treadmill/i.test(rawType) && !/ride|cycle|bike/i.test(rawType))) {
    const isIndoorRun = trainer || /virtualrun|virtual_run|treadmill|indoor/i.test(combined);
    if (isIndoorRun) {
      return { sportCategory: 'Running', subType: 'Treadmill', environment: 'INDOOR' };
    }
    if (/trail/i.test(combined)) {
      return { sportCategory: 'Running', subType: 'Trail', environment: 'OUTDOOR' };
    }
    if (/\b(track|400m|200m)\b/i.test(actName)) {
      return { sportCategory: 'Running', subType: 'Track', environment: 'OUTDOOR' };
    }
    if (/\b(xc|cross country)\b/i.test(actName)) {
      return { sportCategory: 'Running', subType: 'Cross Country', environment: 'OUTDOOR' };
    }
    return { sportCategory: 'Running', subType: 'Road', environment: 'OUTDOOR' };
  }

  if (/^(ride|virtualride|gravelride|mountainbikeride|handcycle|velomobile|cycling|virtual_ride|indoor_cycling|road_biking|gravel_cycling|mountain_biking)$/i.test(rawType) || /ride|cycling|bike|virtualride|gravel|mountainbike|handcycle|velomobile/i.test(rawType)) {
    const isEBike = isEBikeActivityText(rawType, actName);
    if (isEBike) {
      return {
        sportCategory: 'Cycling',
        subType: 'EBike',
        environment: trainer ? 'INDOOR' : 'OUTDOOR',
      };
    }
    const isIndoorBike = trainer || isVirtual || /indoor|trainer|spinning|peloton/i.test(combined) || !hasGps;
    if (isVirtual) {
      return { sportCategory: 'Cycling', subType: 'Virtual Cycling', environment: 'INDOOR' };
    }
    if (isIndoorBike) {
      return { sportCategory: 'Cycling', subType: 'Smart Trainer', environment: 'INDOOR' };
    }
    if (/gravel/i.test(combined)) {
      return { sportCategory: 'Cycling', subType: 'Gravel', environment: 'OUTDOOR' };
    }
    if (/mountain|mtb|trail/i.test(combined)) {
      return { sportCategory: 'Cycling', subType: 'Trail', environment: 'OUTDOOR' };
    }
    return { sportCategory: 'Cycling', subType: 'Road', environment: 'OUTDOOR' };
  }

  if (/triathlon|duathlon|multisport/i.test(rawType)) {
    return { sportCategory: 'Multisport', subType: 'Road', environment: 'OUTDOOR' };
  }

  // Fallback when rawSportType is absent: infer cautiously from title
  if (/\b(hike|hiking|snowshoe)\b/i.test(actName)) {
    return { sportCategory: 'Multisport', subType: 'Hiking', environment: 'OUTDOOR' };
  }
  if (/\b(walk|walking)\b/i.test(actName)) {
    return { sportCategory: 'Multisport', subType: 'Walking', environment: trainer ? 'INDOOR' : 'OUTDOOR' };
  }
  if (/\b(row|rowing|erg|concept2)\b/i.test(actName)) {
    return { sportCategory: 'Multisport', subType: 'Rowing', environment: trainer || !hasGps ? 'INDOOR' : 'OUTDOOR' };
  }
  if (/\belliptical\b/i.test(actName)) {
    return { sportCategory: 'Multisport', subType: 'Elliptical', environment: 'INDOOR' };
  }
  if (/\b(yoga|pilates|mobility|stretch)\b/i.test(actName)) {
    return { sportCategory: 'Strength', subType: 'Yoga & Mobility', environment: 'INDOOR' };
  }
  if (/\b(hiit|crossfit|circuit)\b/i.test(actName)) {
    return { sportCategory: 'Strength', subType: 'HIIT & Circuit', environment: 'INDOOR' };
  }
  if (/ride|cycling|bike|zwift|peloton|spin/i.test(actName)) {
    return {
      sportCategory: 'Cycling',
      subType: isVirtual ? 'Virtual Cycling' : trainer || !hasGps ? 'Smart Trainer' : 'Road',
      environment: trainer || isVirtual || !hasGps ? 'INDOOR' : 'OUTDOOR',
    };
  }
  if (/\b(run|treadmill|jog|marathon|5k|10k)\b/i.test(actName)) {
    return {
      sportCategory: 'Running',
      subType: trainer || /treadmill/i.test(actName) ? 'Treadmill' : 'Road',
      environment: trainer || /treadmill/i.test(actName) ? 'INDOOR' : 'OUTDOOR',
    };
  }
  if (/\b(swim|pool)\b/i.test(actName)) {
    return {
      sportCategory: 'Swimming',
      subType: hasGps ? 'Open Water' : 'Pool',
      environment: hasGps ? 'OUTDOOR' : 'INDOOR',
    };
  }
  return { sportCategory: 'Strength', subType: 'Gym', environment: 'INDOOR' };
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
 * Physiological v4 load model replacing Strava's inflated Relative Effort (`suffer_score`).
 * Uses metered Coggan Power TSS, Swim Pace sTSS (velocity³), Minetti GAP/grade Hiking rTSS,
 * HR Reserve (%HRR) TRIMP-scaled hrTSS across Rowing/Elliptical/Ski/HIIT, corrected Strength
 * lifting load without HR-strap penalty, and low/restorative scaling for casual Walks & Mobility.
 */
export function computeStravaActivityLoadV2(input: StravaLoadInput): StravaLoadResult {
  const rawType = String(input.rawSportType || '').trim();
  const actName = String(input.name || '').trim();
  const combinedMeta = `${rawType} ${actName}`.trim();
  const isEBike = isEBikeActivityText(rawType, actName);

  const isMeditation = /^(meditation|breathwork|sauna)$/i.test(rawType) ||
    /\b(meditation|breathwork|sauna)\b/i.test(actName);
  const isYogaOrMobility = !isEBike && !isMeditation && (
    /^(yoga|pilates|stretching|stretch|mobility)$/i.test(rawType) ||
    /\b(yoga|pilates|stretching|stretch|mobility)\b/i.test(actName)
  );
  const isWalk = !isEBike && /^(walk|casual_walking|speed_walking|golf|sailing|skateboard)$/i.test(rawType);
  const isLowImpactCasual = !isEBike && (isMeditation || isYogaOrMobility || isWalk);

  const isHike = !isEBike && /^(hike|hiking|snowshoe)$/i.test(rawType);
  const isAerobicCrossTrain = !isEBike && /^(rowing|virtualrow|indoor_rowing|nordicski|rollerski|cross_country_skiing|xc_ski|elliptical|stairstepper|stair_climbing|floor_climbing|kayaking|canoeing|standuppaddling|stand_up_paddleboarding)$/i.test(rawType);
  const isBackcountrySki = !isEBike && /^backcountryski$/i.test(rawType);
  const isAlpineSki = !isEBike && /^(alpineski|snowboard|resort_skiing_snowboarding)$/i.test(rawType);
  const isHiitOrCourt = !isEBike && (
    /^(hiit|crossfit|soccer|tennis|pickleball|basketball|badminton|squash|racquetball|tabletennis)$/i.test(rawType) ||
    /^(workout)$/i.test(rawType) && /\b(hiit|crossfit|circuit|metcon|bootcamp)\b/i.test(actName)
  );

  const isModerateOutdoor =
    !isEBike &&
    !isLowImpactCasual &&
    (isHike || isBackcountrySki || isAlpineSki || isAerobicCrossTrain);

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
  const maxHr = Math.round(Number(input.maxHr || 0));
  const bikeLthr = Math.max(135, Number(input.calibratedBikeLthr || 163));
  const runLthr = Math.max(140, Number(input.calibratedRunLthr || 168));
  const ftp = Math.max(120, Number(input.calibratedFtp || 250));
  const thresholdPace = Math.max(155, Number(input.calibratedThresholdPaceSecsPerKm || 255));
  const distMeters = Math.max(0, Number(input.distanceMeters || 0));
  const elevGain = Math.max(0, Number(input.elevationGainMeters || 0));

  const buildResult = (
    trainingLoad: number,
    intensityFactor?: number
  ): StravaLoadResult => ({
    trainingLoad: Math.max(0, Math.round(trainingLoad)),
    intensityFactor:
      intensityFactor !== undefined ? Number(intensityFactor.toFixed(2)) : undefined,
    isEBike,
    isLowImpactCasual,
    isModerateOutdoor,
  });

  if (isEBike) {
    if (avgHr > 60) {
      const hrr = computeHrrRatio(avgHr, bikeLthr, restHr);
      return buildResult(
        Math.min(Math.round(hrs * 40), Math.round(hrs * 65 * hrr * hrr)),
        Math.min(0.95, 0.35 + hrr * 0.5)
      );
    }
    return buildResult(hrs * 18, 0.42);
  }

  if (isMeditation) {
    return buildResult(hrs * 3, 0.2);
  }

  if (isYogaOrMobility) {
    const isPilates = /pilates/i.test(combinedMeta);
    if (avgHr > 60) {
      const hrr = computeHrrRatio(avgHr, bikeLthr, restHr);
      const cap = isPilates ? 32 : 22;
      const coeff = isPilates ? 58 : 48;
      return buildResult(
        Math.min(Math.round(hrs * cap), Math.round(hrs * coeff * hrr * hrr)),
        Math.min(0.78, 0.28 + hrr * 0.45)
      );
    }
    return buildResult(hrs * (isPilates ? 18 : 10), isPilates ? 0.42 : 0.32);
  }

  if (isWalk) {
    const isGolf = /^golf$/i.test(rawType);
    if (isGolf) {
      return buildResult(hrs * 14, 0.37);
    }
    const grade = distMeters > 200 ? elevGain / distMeters : 0;
    if (avgHr > 60) {
      const hrr = computeHrrRatio(avgHr, bikeLthr, restHr);
      const hrCap = grade >= 0.03 ? 55 : 30;
      return buildResult(
        Math.min(Math.round(hrs * hrCap), Math.round(hrs * 65 * hrr * hrr)),
        Math.min(0.85, 0.3 + hrr * 0.48)
      );
    }
    const baseRate = grade >= 0.03 ? Math.min(46, 18 + Math.round(grade * 260)) : 15;
    return buildResult(hrs * baseRate, Math.sqrt(baseRate / 100));
  }

  if (isHike || isBackcountrySki) {
    const grade = distMeters > 200 ? Math.max(0, elevGain / distMeters) : 0;
    const speedKph = distMeters > 200 && hrs > 0 ? distMeters / 1000 / hrs : 4.2;
    const eqSpeedKph = speedKph * (1 + Math.min(1.6, grade * 9.5 + grade * grade * 28));
    const mechIf = Math.max(0.46, Math.min(1.04, eqSpeedKph / 12.2));
    const mechLoad = Math.round(hrs * 88 * mechIf * mechIf);

    if (avgHr > 60) {
      const hrr = computeHrrRatio(avgHr, runLthr, restHr);
      const hrLoad = Math.round(hrs * 85 * hrr * hrr);
      const combined = Math.round(0.55 * hrLoad + 0.45 * mechLoad);
      return buildResult(
        combined,
        Math.min(1.1, Math.sqrt(Math.max(0.1, combined / Math.max(0.1, hrs * 100))))
      );
    }
    return buildResult(isBackcountrySki && distMeters < 300 ? hrs * 48 : mechLoad, mechIf);
  }

  if (isAlpineSki) {
    if (avgHr > 60) {
      const hrr = computeHrrRatio(avgHr, bikeLthr, restHr);
      return buildResult(
        Math.min(Math.round(hrs * 38), Math.round(hrs * 60 * hrr * hrr)),
        Math.min(0.85, 0.35 + hrr * 0.45)
      );
    }
    return buildResult(hrs * 22, 0.47);
  }

  if (isAerobicCrossTrain) {
    const np = Number(input.normalizedPower || input.avgPower || 0);
    const rowFtp = Math.max(110, ftp * 0.88);
    const hasErgWatts = Boolean(input.hasRealDeviceWatts && np > 0);
    const powerIf = hasErgWatts ? Math.max(0.35, Math.min(1.3, np / rowFtp)) : 0;
    const powerLoad = hasErgWatts
      ? Math.round(((movingTimeSecs * np * powerIf) / (rowFtp * 3600)) * 100)
      : 0;
    const hrr = avgHr > 60 ? computeHrrRatio(avgHr, runLthr, restHr) : 0;
    const hrLoad = avgHr > 60 ? Math.min(Math.round(hrs * 115), Math.round(hrs * 92 * hrr * hrr)) : 0;

    if (powerLoad > 0 && hrLoad > 0) {
      const blended = Math.round(0.5 * powerLoad + 0.5 * hrLoad);
      return buildResult(
        blended,
        Math.min(1.22, Math.sqrt(Math.max(0.1, blended / Math.max(0.1, hrs * 100))))
      );
    }
    if (powerLoad > 0) return buildResult(powerLoad, powerIf);
    if (hrLoad > 0) return buildResult(hrLoad, Math.min(1.18, 0.42 + hrr * 0.58));

    // Rowing 500m-split speed fallback (if distance & time known)
    if (/row/i.test(combinedMeta) && distMeters >= 500 && hrs > 0) {
      const secsPer500 = movingTimeSecs / (distMeters / 500);
      const rowIf = Math.max(0.45, Math.min(1.15, 118 / secsPer500));
      return buildResult(hrs * 95 * rowIf * rowIf, rowIf);
    }
    return buildResult(hrs * 46, 0.68);
  }

  if (isHiitOrCourt) {
    if (avgHr > 60) {
      const hrr = computeHrrRatio(avgHr, runLthr, restHr);
      const peakBoost = maxHr >= 172 ? 1.1 : 1.0;
      const load = Math.min(Math.round(hrs * 95), Math.round(hrs * 88 * hrr * hrr * peakBoost));
      return buildResult(load, Math.min(1.12, 0.45 + hrr * 0.55));
    }
    const isPickle = /pickleball/i.test(rawType);
    const isHiit = /hiit|crossfit|workout|circuit|bootcamp/i.test(combinedMeta);
    const rate = isHiit ? 52 : isPickle ? 34 : 45;
    return buildResult(hrs * rate, Math.sqrt(rate / 100));
  }

  if (input.sportCategory === 'Cycling') {
    const np = Number(input.normalizedPower || input.avgPower || 0);
    if (input.hasRealDeviceWatts && np > 0) {
      const ifVal = Math.max(0.25, Math.min(1.35, np / ftp));
      return buildResult(
        ((movingTimeSecs * np * ifVal) / (ftp * 3600)) * 100,
        ifVal
      );
    }
    if (avgHr > 60) {
      const hrr = computeHrrRatio(avgHr, bikeLthr, restHr);
      return buildResult(hrs * 92 * hrr * hrr, Math.min(1.18, 0.45 + hrr * 0.55));
    }
    const speedKph = distMeters > 0 && hrs > 0 ? distMeters / 1000 / hrs : 18;
    const rate = speedKph < 16 ? 20 : speedKph < 22 ? 28 : 35;
    return buildResult(hrs * rate, Math.sqrt(rate / 100));
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
      return buildResult(resolvedLoad, effIf);
    }

    if (paceLoad > 0) return buildResult(paceLoad, paceIf);
    if (hrLoad > 0) return buildResult(hrLoad, Math.min(1.18, 0.45 + hrrRun * 0.55));
    return buildResult(hrs * 38, 0.62);
  }

  if (input.sportCategory === 'Swimming') {
    let sTss = 0;
    let swimIf = 0;
    if (distMeters >= 100 && movingTimeSecs > 0) {
      const pace100 = movingTimeSecs / (distMeters / 100);
      // Cubic velocity-drag sTSS relative to ~1:55/100m CSS reference
      swimIf = Math.max(0.45, Math.min(1.22, 115 / Math.max(55, pace100)));
      sTss = Math.round(hrs * 100 * Math.pow(swimIf, 3));
    }
    const swimLthr = Math.max(130, bikeLthr - 5);
    const hrr = avgHr > 65 ? computeHrrRatio(avgHr, swimLthr, restHr) : 0;
    const hrSwimLoad = avgHr > 65 ? Math.round(hrs * 90 * hrr * hrr) : 0;

    if (sTss > 0 && hrSwimLoad > 0) {
      const blended = Math.round(0.65 * sTss + 0.35 * hrSwimLoad);
      return buildResult(
        blended,
        Math.min(1.18, Math.cbrt(Math.max(0.1, blended / Math.max(0.1, hrs * 100))))
      );
    }
    if (sTss > 0) return buildResult(sTss, swimIf);
    if (hrSwimLoad > 0) return buildResult(hrSwimLoad, Math.min(1.15, 0.45 + hrr * 0.55));
    return buildResult(hrs * 42, 0.65);
  }

  // Strength / WeightTraining / Climbing / Gym fallback (fixes HR-strap penalty bug!)
  if (avgHr > 60) {
    const hrr = computeHrrRatio(avgHr, bikeLthr, restHr);
    const load = Math.min(
      Math.round(hrs * 58),
      Math.max(Math.round(hrs * 24), Math.round(hrs * (22 + 52 * hrr * hrr)))
    );
    return buildResult(load, Math.min(0.95, 0.4 + hrr * 0.45));
  }

  return buildResult(hrs * 30, 0.55);
}
