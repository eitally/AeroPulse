import type {
  ActivityInterval,
  ActivityStreamSet,
  TrackRepDistanceMeters,
  UnifiedActivity,
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
  } = params;

  const validSplits = lapSplitsSecs.filter((s) => Number.isFinite(s) && s > 0);
  const safeThresholdPace = Math.max(115, Math.min(480, thresholdPaceSecsPerKm || 245));
  const repDist = Math.max(100, repDistanceMeters);

  const intervals: ActivityInterval[] = [];
  const timeStream: number[] = [];
  const distanceStream: number[] = [];
  const velocityStream: number[] = [];
  const hrStream: number[] = [];
  const cadenceStream: number[] = [];

  let elapsedCursor = 0;
  let distCursor = 0;
  let totalWorkSecs = 0;
  let weightedLoadAcc = 0;

  validSplits.forEach((lapSecs, idx) => {
    const lapDuration = Math.max(1, Math.round(lapSecs));
    const lapPaceSecsKm = Math.round((lapSecs / repDist) * 1000);
    const speedMps = repDist / Math.max(1, lapSecs);
    const intensityRatio = Math.max(0.75, Math.min(1.45, safeThresholdPace / Math.max(120, lapPaceSecsKm)));
    const repTss = intensityRatio * intensityRatio * (lapSecs / 3600) * 100;
    weightedLoadAcc += repTss;
    totalWorkSecs += lapSecs;

    const startHr = Math.min(maxHr, Math.round(lthr * 0.9 + idx * 1.5));
    const endHr = Math.min(maxHr, Math.round(lthr * 1.02 + idx * 2));

    for (let s = 0; s < lapDuration; s++) {
      const frac = s / Math.max(1, lapDuration);
      timeStream.push(elapsedCursor + s);
      distanceStream.push(Number((distCursor + frac * repDist).toFixed(1)));
      velocityStream.push(Number(speedMps.toFixed(2)));
      hrStream.push(Math.round(startHr + frac * (endHr - startHr)));
      cadenceStream.push(repDist <= 400 ? 194 : 188);
    }

    intervals.push({
      id: `rep-${idx + 1}`,
      type: 'WORK',
      label: `Rep ${idx + 1} (${repDist}m): ${formatTrackMark(lapSecs, 2)}`,
      startTimeSecs: elapsedCursor,
      durationSecs: Number(lapSecs.toFixed(2)),
      distanceMeters: repDist,
      avgPaceSecsPerKm: lapPaceSecsKm,
      gapPaceSecsPerKm: lapPaceSecsKm,
      avgHr: Math.round((startHr + endHr) / 2),
      maxHr: endHr,
      avgCadence: repDist <= 400 ? 194 : 188,
      zone: intensityRatio >= 1.05 ? 5 : 4,
    });

    elapsedCursor += lapDuration;
    distCursor += repDist;

    if (restDurationSecs > 0 && idx < validSplits.length - 1) {
      const restInt = Math.max(5, Math.round(restDurationSecs));
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

  const totalWorkDist = validSplits.length * repDist;
  const avgWorkPaceSecsKm =
    totalWorkDist > 0 ? Math.round((totalWorkSecs / totalWorkDist) * 1000) : safeThresholdPace;
  // Warmup/cooldown aerobic baseline allowance (~28 rTSS for 25-30m easy track warmup/cooldown)
  const warmupCooldownSecs = 1500;
  const trainingLoad = Math.max(12, Math.round(weightedLoadAcc + 26));
  const avgLapSecs = totalWorkSecs / Math.max(1, validSplits.length);

  const streams: ActivityStreamSet = {
    time: timeStream,
    distance: distanceStream,
    velocitySmooth: velocityStream,
    heartrate: hrStream,
    cadence: cadenceStream,
  };

  const titlePrefix = sessionTitle?.trim() || `${validSplits.length}x${repDist}m Track Session`;

  return {
    id: `stopwatch-workout-${runnerId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    startDateLocal: `${dateIso}T15:30:00`,
    name: `${titlePrefix} (${formatTrackMark(avgLapSecs, 2)} avg · ${runnerName})`,
    sportCategory: 'Running',
    environment: 'OUTDOOR',
    subType: 'Track',
    movingTimeSecs: Math.round(totalWorkSecs + warmupCooldownSecs),
    distanceMeters: Math.round(distCursor + 4200),
    elevationGainMeters: 0,
    trainingLoad,
    avgHr: Math.round(lthr * 0.92),
    maxHr,
    avgCadence: repDist <= 400 ? 192 : 186,
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
