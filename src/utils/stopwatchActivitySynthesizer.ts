import type {
  ActivityInterval,
  ActivityStreamSet,
  DelegatedHandSplitCaptureSummary,
  DelegatedTimingStation,
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
  expandTrackWorkoutSpecReps,
  fuseWearableStreamWithStopwatchSplits,
  type ExpandedStopwatchRep,
  type WatchStopwatchFusionResult,
} from './stopwatchWearableFusion';

export {
  expandTrackWorkoutSpecReps,
  fuseWearableStreamWithStopwatchSplits,
  type ExpandedStopwatchRep,
  type WatchStopwatchFusionResult,
};

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

export function formatLocalWallClockIso(epochMs: number = Date.now()): string {
  const d = new Date(Number.isFinite(epochMs) ? epochMs : Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day}T${hh}:${mm}:${ss}`;
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
  startDateLocalIso?: string;
  startDateUtcMs?: number;
  lane?: TrackLaneNumber;
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
    dateIso,
    startDateLocalIso,
    startDateUtcMs,
    lane = 1,
    footwearClass = 'DAILY_TRAINER',
    trackFacility = 'OUTDOOR_400M',
    stimulusCompletionRatio,
    autoRegPivotSummary,
    multiSetSpec,
  } = params;

  const validSplits = lapSplitsSecs.filter((s) => Number.isFinite(s) && s > 0);
  const safeThresholdPace = Math.max(115, Math.min(480, thresholdPaceSecsPerKm || 245));
  const fallbackRepDist = Math.max(10, repDistanceMeters);
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

  const activityId = `stopwatch-workout-${runnerId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const resolvedStartDateLocal =
    startDateLocalIso || (dateIso ? `${dateIso.slice(0, 10)}T15:30:00` : formatLocalWallClockIso(Date.now()));

  return {
    id: activityId,
    startDateLocal: resolvedStartDateLocal,
    ...(typeof startDateUtcMs === 'number' && Number.isFinite(startDateUtcMs) && startDateUtcMs > 0
      ? { startDateUtcMs }
      : {}),
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
    deviceName: `MeetReady Trackside Stopwatch (${presetLabel})`,
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
    stopwatchFusionMeta: {
      stopwatchActivityId: activityId,
      lapSplitsSecs: validSplits.map((s) => Number(s.toFixed(2))),
      repDistanceMeters: fallbackRepDist,
      restDurationSecs: Math.max(0, Math.round(restDurationSecs)),
      lane,
      thresholdPaceSecsPerKm: safeThresholdPace,
      ...(multiSetSpec ? { multiSetSpec } : {}),
      fusedWithWearableStreams: false,
    },
    stravaPrCount: 0,
    segmentEfforts: [],
    intervals,
    streams,
    sourceBadges: ['Official FAT'],
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
  lapSplitDistanceMeters: 60 | 100 | 200 | 400 | 1000;
  lapSplitsSecs: number[];
  netTotalSecs: number;
  placeFinish?: string;
  includeWarmupCooldown?: boolean;
  dateIso?: string;
  startDateLocalIso?: string;
  startDateUtcMs?: number;
  lane?: TrackLaneNumber;
  timingStation?: DelegatedTimingStation;
  capturedByName?: string;
  isDelegated?: boolean;
  splitsEstimated?: boolean;
  handSplitCaptures?: DelegatedHandSplitCaptureSummary[];
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
    includeWarmupCooldown = false,
    dateIso,
    startDateLocalIso,
    startDateUtcMs,
    lane = 1,
    timingStation,
    capturedByName,
    isDelegated = false,
    splitsEstimated,
    handSplitCaptures,
  } = params;

  const inferredDistMeters =
    eventDistanceMeters > 0
      ? eventDistanceMeters
      : Math.max(200, lapSplitsSecs.length * lapSplitDistanceMeters);

  const trackType = eventLabel === 'XC 5K' ? 'XC_COURSE' : 'OUTDOOR_400M';
  const meetName = sessionTitle?.trim() || `Trackside Timed Meet (${runnerName})`;
  const resolvedEventLabel = eventLabel === 'Open Race' ? `${inferredDistMeters}m` : eventLabel;
  const resolvedStartIso =
    startDateLocalIso || (dateIso ? `${dateIso.slice(0, 10)}T10:30:00` : formatLocalWallClockIso(Date.now()));
  const resolvedDateIso = dateIso || resolvedStartIso.slice(0, 10);
  const raceId = `stopwatch-race-${runnerId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const synthesized = synthesizeOfficialRaceActivity(
    {
      id: raceId,
      date: resolvedDateIso,
      startDateLocalIso: resolvedStartIso,
      meetName,
      eventLabel: resolvedEventLabel,
      eventDistanceMeters: inferredDistMeters,
      fatTimeSecs: netTotalSecs,
      displayFatTime: formatFatTime(netTotalSecs),
      platform: 'MeetReady Stopwatch',
      trackType,
      placeFinish: placeFinish || undefined,
      lapSplitDistanceMeters,
      lapSplitsSecs,
      includeWarmupCooldown,
    },
    lthr,
    maxHr
  );

  const displayTime = synthesized.officialRaceData?.displayFatTime || formatFatTime(netTotalSecs);

  return {
    ...synthesized,
    name: `${resolvedEventLabel} Hand-Timed (${displayTime}) — ${meetName}`,
    deviceName: `MeetReady Trackside Stopwatch${timingStation ? ` (${timingStation})` : ''}`,
    sourceBadges: isDelegated ? ['Delegated Hand-Timed'] : ['Hand-Timed'],
    officialRaceData: {
      ...synthesized.officialRaceData!,
      platform: 'MeetReady Stopwatch',
      timingMethod: 'HAND',
      splitContext: 'HAND_CONVERTED',
      handTimedTotalSecs: Number(netTotalSecs.toFixed(2)),
      ...(capturedByName ? { capturedByName } : {}),
      ...(timingStation ? { timingStation } : {}),
      ...(splitsEstimated !== undefined ? { splitsEstimated } : {}),
      ...(handSplitCaptures ? { handSplitCaptures } : {}),
    },
    ...(typeof startDateUtcMs === 'number' && Number.isFinite(startDateUtcMs) && startDateUtcMs > 0
      ? { startDateUtcMs }
      : {}),
    stopwatchFusionMeta: {
      stopwatchActivityId: raceId,
      lapSplitsSecs: lapSplitsSecs.filter((s) => Number.isFinite(s) && s > 0).map((s) => Number(s.toFixed(2))),
      repDistanceMeters: lapSplitDistanceMeters,
      restDurationSecs: 0,
      lane,
      fusedWithWearableStreams: false,
    },
  };
}
