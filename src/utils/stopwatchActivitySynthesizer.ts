import type {
  ActivityInterval,
  ActivityStreamSet,
  NcaaTrackFacilityType,
  TrackFootwearClass,
  TrackLaneNumber,
  TrackRepDistanceMeters,
  TrackTrainingZoneCode,
  TrackWorkoutSpec,
  UnifiedActivity,
  VdotPodIntensity,
} from '../types';
import type {
  RunnerSplitTelemetry,
  TracksideSessionType,
} from '../hooks/useTracksideStopwatch';
import {
  formatFatTime,
  synthesizeOfficialRaceActivity,
} from './officialRaceSynthesizer';
import { formatTrackMark } from '../physiology/scholasticEngine';
import {
  snapGpsStreamToStandardTrackOval,
  type OvalGpsSnapResult,
} from '../physiology/trackOvalGpsFusionEngine';

function csvEscape(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatStopwatchClockMs(elapsedMs: number): string {
  const safeMs = Math.max(0, Math.floor(elapsedMs));
  const totalHundredths = Math.floor(safeMs / 10);
  const hundredths = totalHundredths % 100;
  const totalSecs = Math.floor(totalHundredths / 100);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const hStr = String(hundredths).padStart(2, '0');
  const sStr = String(secs).padStart(2, '0');
  const mStr = String(mins).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${mStr}:${sStr}.${hStr}`;
  }
  return `${mStr}:${sStr}.${hStr}`;
}

export function buildTracksideStopwatchCsv(params: {
  sessionType: TracksideSessionType;
  sessionTitle: string;
  presetOrEventLabel: string;
  telemetries: RunnerSplitTelemetry[];
}): string {
  const { sessionType, sessionTitle, presetOrEventLabel, telemetries } = params;
  const maxLaps = Math.max(1, ...telemetries.map((t) => t.lapSplitsSecs.length));
  const lapHeaders = Array.from({ length: maxLaps }, (_, idx) => `Lap_${idx + 1}_s`);
  const headers = [
    'Session_Type',
    'Session_Title',
    'Preset_Or_Event',
    'Athlete',
    'Pod',
    'Wave_Offset_s',
    'Standing',
    'Laps_Completed',
    ...lapHeaders,
    'Best_Lap_s',
    'Avg_Lap_s',
    'Net_Total_s',
    'Display_Total',
  ];

  const rows = telemetries.map((t) => {
    const paddedLaps = Array.from({ length: maxLaps }, (_, idx) =>
      t.lapSplitsSecs[idx] !== undefined ? t.lapSplitsSecs[idx].toFixed(2) : ''
    );
    return [
      sessionType,
      sessionTitle || (sessionType === 'RACE' ? 'Trackside Timed Race' : 'Trackside Interval Workout'),
      presetOrEventLabel,
      t.runnerName,
      t.podKey,
      t.effectiveOffsetSecs.toFixed(2),
      t.placeLabel || '',
      t.lapCount,
      ...paddedLaps,
      t.bestLapSecs !== null ? t.bestLapSecs.toFixed(2) : '',
      t.avgLapSecs !== null ? t.avgLapSecs.toFixed(2) : '',
      t.netTotalSecs !== null ? t.netTotalSecs.toFixed(2) : '',
      t.netTotalSecs !== null ? formatFatTime(t.netTotalSecs) : '',
    ]
      .map(csvEscape)
      .join(',');
  });

  return [headers.map(csvEscape).join(','), ...rows].join('\n');
}

export interface ExpandedStopwatchRep {
  setNumber: number;
  repInSet: number;
  repDistanceMeters: TrackRepDistanceMeters;
  restDurationSecs: number;
  zoneCode: TrackTrainingZoneCode;
  podIntensity: VdotPodIntensity;
  targetSplitSecs?: number;
}

/**
 * Unrolls a multi-set `TrackWorkoutSpec` into a linear per-rep list with intra-set and inter-set rest.
 */
export function expandTrackWorkoutSpecReps(
  spec?: TrackWorkoutSpec | null
): ExpandedStopwatchRep[] {
  if (!spec) return [];
  const sets =
    spec.sets && spec.sets.length > 0
      ? spec.sets
      : [
          {
            repCount: spec.repCount,
            repDistanceMeters: spec.repDistanceMeters,
            zoneCode: spec.zoneCode,
            podIntensity: spec.podIntensity,
            targetSplitSecs: spec.targetSplitSecs,
            restDurationSecs: spec.restDurationSecs,
          },
        ];

  const out: ExpandedStopwatchRep[] = [];
  sets.forEach((setSpec, setIdx) => {
    const count = Math.max(1, Math.round(setSpec.repCount));
    for (let r = 0; r < count; r++) {
      const isLastInSet = r === count - 1;
      const hasNextSet = setIdx < sets.length - 1;
      const restSecs =
        isLastInSet && hasNextSet && typeof setSpec.setRestAfterSecs === 'number'
          ? setSpec.setRestAfterSecs
          : setSpec.restDurationSecs;
      out.push({
        setNumber: setIdx + 1,
        repInSet: r + 1,
        repDistanceMeters: setSpec.repDistanceMeters,
        restDurationSecs: Math.max(0, Math.round(restSecs)),
        zoneCode: setSpec.zoneCode,
        podIntensity: setSpec.podIntensity,
        ...(typeof setSpec.targetSplitSecs === 'number'
          ? { targetSplitSecs: setSpec.targetSplitSecs }
          : {}),
      });
    }
  });
  return out;
}

export function synthesizeTracksideWorkoutActivity(params: {
  runnerId: string;
  runnerName: string;
  thresholdPaceSecsPerKm: number;
  lthr?: number;
  maxHr?: number;
  sessionTitle?: string;
  presetLabel: string;
  repDistanceMeters: TrackRepDistanceMeters | number;
  restDurationSecs: number;
  lapSplitsSecs: number[];
  dateIso?: string;
  footwearClass?: TrackFootwearClass;
  trackFacility?: NcaaTrackFacilityType;
  stimulusCompletionRatio?: number;
  autoRegPivotSummary?: string;
  multiSetSpec?: TrackWorkoutSpec | null;
}): UnifiedActivity {
  const {
    runnerId,
    runnerName,
    thresholdPaceSecsPerKm,
    lthr = 172,
    maxHr = 194,
    sessionTitle,
    presetLabel,
    repDistanceMeters,
    restDurationSecs,
    lapSplitsSecs,
    dateIso = new Date().toISOString().slice(0, 10),
    footwearClass = 'DAILY_TRAINER',
    trackFacility = 'OUTDOOR_400M',
    stimulusCompletionRatio,
    autoRegPivotSummary,
    multiSetSpec,
  } = params;

  const validSplits = lapSplitsSecs.filter((s) => Number.isFinite(s) && s > 0);
  const safeThresholdPace = Math.max(115, Math.min(480, thresholdPaceSecsPerKm || 245));
  const fallbackRepDist = Math.max(100, repDistanceMeters);
  const expandedReps =
    multiSetSpec?.sets && multiSetSpec.sets.length > 0
      ? expandTrackWorkoutSpecReps(multiSetSpec)
      : [];
  const hasMultipleSets = (multiSetSpec?.sets?.length ?? 0) > 1;

  const intervals: ActivityInterval[] = [];
  const timeStream: number[] = [];
  const distanceStream: number[] = [];
  const velocityStream: number[] = [];
  const hrStream: number[] = [];
  const cadenceStream: number[] = [];

  let elapsedCursor = 0;
  let distCursor = 0;
  let totalWorkDist = 0;
  let totalWorkSecs = 0;
  let weightedLoadAcc = 0;

  validSplits.forEach((lapSecs, idx) => {
    const planRep = expandedReps[idx];
    const thisRepDist = planRep?.repDistanceMeters ?? fallbackRepDist;
    const thisRestSecs = planRep?.restDurationSecs ?? restDurationSecs;
    const lapDuration = Math.max(1, Math.round(lapSecs));
    const lapPaceSecsKm = Math.round((lapSecs / thisRepDist) * 1000);
    const speedMps = thisRepDist / Math.max(1, lapSecs);
    const intensityRatio = Math.max(0.75, Math.min(1.55, safeThresholdPace / Math.max(120, lapPaceSecsKm)));
    const repTss = intensityRatio * intensityRatio * (lapSecs / 3600) * 100;
    weightedLoadAcc += repTss;
    totalWorkSecs += lapSecs;
    totalWorkDist += thisRepDist;

    const startHr = Math.min(maxHr, Math.round(lthr * 0.9 + idx * 1.5));
    const endHr = Math.min(maxHr, Math.round(lthr * 1.02 + idx * 2));

    for (let s = 0; s < lapDuration; s++) {
      const frac = s / Math.max(1, lapDuration);
      timeStream.push(elapsedCursor + s);
      distanceStream.push(Number((distCursor + frac * thisRepDist).toFixed(1)));
      velocityStream.push(Number(speedMps.toFixed(2)));
      hrStream.push(Math.round(startHr + frac * (endHr - startHr)));
      cadenceStream.push(thisRepDist <= 400 ? 194 : 188);
    }

    const repLabel =
      hasMultipleSets && planRep
        ? `Set ${planRep.setNumber} · Rep ${planRep.repInSet} (${thisRepDist}m): ${formatTrackMark(lapSecs, 2)}`
        : `Rep ${idx + 1} (${thisRepDist}m): ${formatTrackMark(lapSecs, 2)}`;

    intervals.push({
      id: `rep-${idx + 1}`,
      type: 'WORK',
      label: repLabel,
      startTimeSecs: elapsedCursor,
      durationSecs: Number(lapSecs.toFixed(2)),
      distanceMeters: thisRepDist,
      avgPaceSecsPerKm: lapPaceSecsKm,
      gapPaceSecsPerKm: lapPaceSecsKm,
      avgHr: Math.round((startHr + endHr) / 2),
      maxHr: endHr,
      avgCadence: thisRepDist <= 400 ? 194 : 188,
      zone: intensityRatio >= 1.05 ? 5 : 4,
    });

    elapsedCursor += lapDuration;
    distCursor += thisRepDist;

    if (thisRestSecs > 0 && idx < validSplits.length - 1) {
      const restInt = Math.max(5, Math.round(thisRestSecs));
      for (let s = 0; s < restInt; s++) {
        timeStream.push(elapsedCursor + s);
        distanceStream.push(Number(distCursor.toFixed(1)));
        velocityStream.push(1.8);
        hrStream.push(Math.round(endHr - (s / restInt) * 28));
        cadenceStream.push(152);
      }
      intervals.push({
        id: `rec-${idx + 1}`,
        type: 'RECOVERY',
        label: `Recovery (${restInt}s)`,
        startTimeSecs: elapsedCursor,
        durationSecs: restInt,
        distanceMeters: Math.round(restInt * 1.8),
        avgHr: Math.round(endHr - 14),
        zone: 1,
      });
      elapsedCursor += restInt;
      distCursor += Math.round(restInt * 1.8);
    }
  });

  const avgWorkPaceSecsKm =
    totalWorkDist > 0 ? Math.round((totalWorkSecs / totalWorkDist) * 1000) : safeThresholdPace;
  const wuDist = Math.max(0, multiSetSpec?.warmupDistanceMeters ?? 0);
  const cdDist = Math.max(0, multiSetSpec?.cooldownDistanceMeters ?? 0);
  const hasExplicitWuCd = wuDist + cdDist > 0;
  const extraEasyDist = hasExplicitWuCd ? wuDist + cdDist : 4200;
  const easyPaceSecsKm = Math.round(safeThresholdPace * 1.24);
  const warmupCooldownSecs = hasExplicitWuCd
    ? Math.round((extraEasyDist / 1000) * easyPaceSecsKm)
    : 1500;
  const extraEasyTss = (warmupCooldownSecs / 3600) * 0.68 * 0.68 * 100;
  const trainingLoad = Math.max(12, Math.round(weightedLoadAcc + (hasExplicitWuCd ? extraEasyTss : 26)));
  const avgLapSecs = totalWorkSecs / Math.max(1, validSplits.length);

  const streams: ActivityStreamSet = {
    time: timeStream,
    distance: distanceStream,
    velocitySmooth: velocityStream,
    heartrate: hrStream,
    cadence: cadenceStream,
  };

  const titlePrefix = sessionTitle?.trim() || `${validSplits.length}x${fallbackRepDist}m Track Session`;
  const isSpikeShoe =
    footwearClass === 'TRADITIONAL_TRACK_SPIKE' || footwearClass === 'CARBON_SUPER_SPIKE';
  const spikedDistanceMeters = isSpikeShoe ? Math.round(totalWorkDist) : 0;
  const environment =
    trackFacility === 'INDOOR_FLAT_200M' || trackFacility === 'INDOOR_BANKED_200M'
      ? 'INDOOR'
      : 'OUTDOOR';

  return {
    id: `stopwatch-workout-${runnerId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    startDateLocal: `${dateIso}T15:30:00`,
    name: `${titlePrefix} (${formatTrackMark(avgLapSecs, 2)} avg · ${runnerName})`,
    sportCategory: 'Running',
    environment,
    subType: 'Track',
    movingTimeSecs: Math.round(totalWorkSecs + warmupCooldownSecs),
    distanceMeters: Math.round(distCursor + extraEasyDist),
    elevationGainMeters: 0,
    trainingLoad,
    avgHr: Math.round(lthr * 0.92),
    maxHr,
    avgCadence: fallbackRepDist <= 400 ? 192 : 186,
    avgPaceSecsPerKm: avgWorkPaceSecsKm,
    gapPaceSecsPerKm: avgWorkPaceSecsKm,
    aerobicDecouplingPct: 1.8,
    efficiencyFactor: Number((((1000 / Math.max(120, avgWorkPaceSecsKm)) * 60) / (lthr * 0.92)).toFixed(2)),
    firstHalfEf: 1.52,
    secondHalfEf: 1.49,
    deviceName: `THRESH Trackside Stopwatch (${presetLabel})`,
    zoneSecs: {
      hr: [900, 600, 0, Math.round(totalWorkSecs * 0.35), Math.round(totalWorkSecs * 0.5), Math.round(totalWorkSecs * 0.15), 0],
      pace: [900, 600, 0, Math.round(totalWorkSecs * 0.35), Math.round(totalWorkSecs * 0.5), Math.round(totalWorkSecs * 0.15), 0],
    },
    footwearClass,
    spikedDistanceMeters,
    trackFacility,
    ...(typeof stimulusCompletionRatio === 'number' && Number.isFinite(stimulusCompletionRatio)
      ? { stimulusCompletionRatio: Number(Math.max(0.1, Math.min(1, stimulusCompletionRatio)).toFixed(2)) }
      : {}),
    ...(autoRegPivotSummary ? { autoRegPivotSummary } : {}),
    stravaPrCount: 0,
    segmentEfforts: [],
    intervals,
    streams,
    sourceBadges: ['Official FAT'],
  };
}

export interface WatchStopwatchFusionResult {
  intervals: ActivityInterval[];
  fusedStreams: ActivityStreamSet;
  optimalLagSecs: number;
  correlationScore: number;
  ovalSnapSummary: OvalGpsSnapResult | null;
}

/**
 * Cross-correlates `#stopwatch` `0.01s` rep/rest edge templates onto a wearable `1Hz`
 * `velocitySmooth` / `cadence` / `heartrate` stream, applies Huber oval GPS snapping if
 * coordinates are present, and produces high-precision fused `WORK`/`RECOVERY` intervals.
 */
export function fuseWearableStreamWithStopwatchSplits(params: {
  wearableStreams: ActivityStreamSet;
  lapSplitsSecs: number[];
  repDistanceMeters: TrackRepDistanceMeters | number;
  restDurationSecs: number;
  lane?: TrackLaneNumber;
  wearableActivity?: Partial<UnifiedActivity>;
  thresholdPaceSecsPerKm?: number;
}): WatchStopwatchFusionResult {
  const {
    wearableStreams,
    lapSplitsSecs,
    repDistanceMeters,
    restDurationSecs,
    lane = 1,
    thresholdPaceSecsPerKm = 245,
  } = params;

  const validSplits = (lapSplitsSecs || []).filter((s) => Number.isFinite(s) && s > 0);
  const time = wearableStreams.time || [];
  const ovalSnapSummary =
    wearableStreams.latlng && wearableStreams.latlng.length >= 12
      ? snapGpsStreamToStandardTrackOval(wearableStreams.latlng, { lane })
      : null;

  const fusedStreams: ActivityStreamSet = {
    ...wearableStreams,
    ...(ovalSnapSummary
      ? {
          latlng: ovalSnapSummary.snappedLatLng,
          snappedTrackDistance: ovalSnapSummary.distanceTrackMeters,
        }
      : {}),
  };

  if (time.length < 10 || validSplits.length === 0) {
    return {
      intervals: [],
      fusedStreams,
      optimalLagSecs: 0,
      correlationScore: 0,
      ovalSnapSummary,
    };
  }

  const rawSig =
    wearableStreams.velocitySmooth && wearableStreams.velocitySmooth.length === time.length
      ? wearableStreams.velocitySmooth
      : wearableStreams.cadence && wearableStreams.cadence.length === time.length
        ? wearableStreams.cadence
        : wearableStreams.heartrate && wearableStreams.heartrate.length === time.length
          ? wearableStreams.heartrate
          : null;

  const tStart = Math.round(time[0] ?? 0);
  const tEnd = Math.round(time[time.length - 1] ?? time.length - 1);
  const gridLen = Math.max(1, tEnd - tStart + 1);

  const signal1Hz = new Array<number>(gridLen).fill(0);
  if (rawSig) {
    let ptr = 0;
    for (let k = 0; k < gridLen; k++) {
      const targetT = tStart + k;
      while (ptr + 1 < time.length && time[ptr + 1] <= targetT) ptr++;
      signal1Hz[k] = Number(rawSig[ptr] ?? 0);
    }
  }

  // Build 1Hz binary work (+1.0) / recovery (-0.5) pattern template from stopwatch timings
  const template: number[] = [];
  const restInt = Math.max(0, Math.round(restDurationSecs));
  for (let i = 0; i < validSplits.length; i++) {
    const repInt = Math.max(1, Math.round(validSplits[i]));
    for (let s = 0; s < repInt; s++) template.push(1.0);
    if (i < validSplits.length - 1 && restInt > 0) {
      for (let s = 0; s < restInt; s++) template.push(-0.5);
    }
  }

  let bestTau = 0;
  let bestCorr = 0;
  if (rawSig && template.length >= 4 && gridLen >= 10) {
    const winLen = Math.min(gridLen, template.length);
    let sumT = 0;
    for (let k = 0; k < winLen; k++) sumT += template[k];
    const meanT = sumT / winLen;
    let varT = 0;
    for (let k = 0; k < winLen; k++) {
      const d = template[k] - meanT;
      varT += d * d;
    }

    const maxTau = Math.max(0, gridLen - winLen);
    bestCorr = -Infinity;
    for (let tau = 0; tau <= maxTau; tau++) {
      let sumS = 0;
      for (let k = 0; k < winLen; k++) sumS += signal1Hz[tau + k];
      const meanS = sumS / winLen;

      let cov = 0;
      let varS = 0;
      for (let k = 0; k < winLen; k++) {
        const ds = signal1Hz[tau + k] - meanS;
        cov += (template[k] - meanT) * ds;
        varS += ds * ds;
      }
      const denom = Math.sqrt(Math.max(1e-9, varT * varS));
      const corr = cov / denom;
      if (corr > bestCorr) {
        bestCorr = corr;
        bestTau = tau;
      }
    }
    if (!Number.isFinite(bestCorr) || bestCorr === -Infinity) {
      bestCorr = 0;
    }
  }

  const optimalLagSecs = tStart + bestTau;
  const repDist = Math.max(100, repDistanceMeters);
  const safeThreshPace = Math.max(115, Math.min(540, thresholdPaceSecsPerKm));

  const sliceMean = (
    arr: number[] | undefined,
    startSec: number,
    endSec: number,
    minValid = -Infinity
  ): number | undefined => {
    if (!arr || arr.length !== time.length) return undefined;
    let sum = 0;
    let cnt = 0;
    for (let i = 0; i < time.length; i++) {
      const t = time[i];
      if (t >= startSec - 0.5 && t <= endSec + 0.5) {
        const val = arr[i];
        if (typeof val === 'number' && Number.isFinite(val) && val > minValid) {
          sum += val;
          cnt++;
        }
      }
    }
    return cnt > 0 ? sum / cnt : undefined;
  };

  const sliceMax = (arr: number[] | undefined, startSec: number, endSec: number): number | undefined => {
    if (!arr || arr.length !== time.length) return undefined;
    let mx = -Infinity;
    for (let i = 0; i < time.length; i++) {
      const t = time[i];
      if (t >= startSec - 0.5 && t <= endSec + 0.5 && Number.isFinite(arr[i])) {
        mx = Math.max(mx, arr[i]);
      }
    }
    return mx > -Infinity ? mx : undefined;
  };

  const intervals: ActivityInterval[] = [];
  let cursor = optimalLagSecs;

  for (let idx = 0; idx < validSplits.length; idx++) {
    const lapSecs = Number(validSplits[idx].toFixed(2));
    const repStart = cursor;
    const repEnd = repStart + lapSecs;
    const paceSecsPerKm = Math.round((lapSecs / repDist) * 1000);
    const speedMps = repDist / Math.max(0.5, lapSecs);

    const avgHrRaw = sliceMean(wearableStreams.heartrate, repStart, repEnd, 40);
    const maxHrRaw = sliceMax(wearableStreams.heartrate, repStart, repEnd);
    const avgCadRaw = sliceMean(wearableStreams.cadence, repStart, repEnd, 20);
    const avgGctRaw = sliceMean(wearableStreams.groundContactTimeMs, repStart, repEnd, 80);

    const avgCadence = avgCadRaw !== undefined ? Math.round(avgCadRaw) : undefined;
    const spm = avgCadence ? (avgCadence < 120 ? avgCadence * 2 : avgCadence) : undefined;
    const strideLengthMeters = spm ? Number(((speedMps * 60) / spm).toFixed(3)) : undefined;
    const intensityRatio = safeThreshPace / Math.max(95, paceSecsPerKm);

    intervals.push({
      id: `fused-rep-${idx + 1}`,
      type: 'WORK',
      label: `Rep ${idx + 1} (${repDist}m): ${formatTrackMark(lapSecs, 2)}`,
      startTimeSecs: Math.round(repStart),
      durationSecs: lapSecs,
      distanceMeters: repDist,
      avgPaceSecsPerKm: paceSecsPerKm,
      gapPaceSecsPerKm: paceSecsPerKm,
      ...(avgHrRaw !== undefined ? { avgHr: Math.round(avgHrRaw) } : {}),
      ...(maxHrRaw !== undefined ? { maxHr: Math.round(maxHrRaw) } : {}),
      ...(avgCadence !== undefined ? { avgCadence } : {}),
      ...(strideLengthMeters !== undefined ? { strideLengthMeters } : {}),
      ...(avgGctRaw !== undefined ? { avgGroundContactTimeMs: Math.round(avgGctRaw) } : {}),
      zone: intensityRatio >= 1.05 ? 5 : 4,
    });

    cursor = repEnd;

    if (restInt > 0 && idx < validSplits.length - 1) {
      const recStart = cursor;
      const recEnd = recStart + restInt;
      const recHr = sliceMean(wearableStreams.heartrate, recStart, recEnd, 40);
      const recCad = sliceMean(wearableStreams.cadence, recStart, recEnd, 20);
      const recVel = sliceMean(wearableStreams.velocitySmooth, recStart, recEnd, 0.2);

      intervals.push({
        id: `fused-rec-${idx + 1}`,
        type: 'RECOVERY',
        label: `Recovery (${restInt}s)`,
        startTimeSecs: Math.round(recStart),
        durationSecs: restInt,
        distanceMeters: recVel ? Math.round(recVel * restInt) : 0,
        ...(recHr !== undefined ? { avgHr: Math.round(recHr) } : {}),
        ...(recCad !== undefined ? { avgCadence: Math.round(recCad) } : {}),
        zone: 1,
      });

      cursor = recEnd;
    }
  }

  return {
    intervals,
    fusedStreams,
    optimalLagSecs,
    correlationScore: Number(bestCorr.toFixed(3)),
    ovalSnapSummary,
  };
}

export function synthesizeTracksideRaceActivity(params: {
  runnerId: string;
  runnerName: string;
  lthr?: number;
  maxHr?: number;
  sessionTitle?: string;
  eventLabel: string;
  eventDistanceMeters: number;
  lapSplitDistanceMeters: 200 | 400 | 1000;
  lapSplitsSecs: number[];
  netTotalSecs: number;
  placeFinish?: string;
  includeWarmupCooldown?: boolean;
  dateIso?: string;
}): UnifiedActivity {
  const {
    runnerId,
    runnerName,
    lthr = 172,
    maxHr = 194,
    sessionTitle,
    eventLabel,
    eventDistanceMeters,
    lapSplitDistanceMeters,
    lapSplitsSecs,
    netTotalSecs,
    placeFinish,
    includeWarmupCooldown = true,
    dateIso = new Date().toISOString().slice(0, 10),
  } = params;

  const inferredDistMeters =
    eventDistanceMeters > 0
      ? eventDistanceMeters
      : Math.max(200, lapSplitsSecs.length * lapSplitDistanceMeters);

  const trackType = eventLabel === 'XC 5K' ? 'XC_COURSE' : 'OUTDOOR_400M';
  const meetName = sessionTitle?.trim() || `Trackside Timed Meet (${runnerName})`;

  return synthesizeOfficialRaceActivity(
    {
      id: `stopwatch-race-${runnerId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date: dateIso,
      meetName,
      eventLabel: eventLabel === 'Open Race' ? `${inferredDistMeters}m` : eventLabel,
      eventDistanceMeters: inferredDistMeters,
      fatTimeSecs: netTotalSecs,
      displayFatTime: formatFatTime(netTotalSecs),
      platform: 'Official FAT',
      trackType,
      placeFinish: placeFinish || undefined,
      lapSplitDistanceMeters,
      lapSplitsSecs,
      includeWarmupCooldown,
    },
    lthr,
    maxHr
  );
}
