import type {
  ActivityInterval,
  ActivityStreamSet,
  OfficialRaceMetadata,
  OfficialRacePlatform,
  OfficialTrackSurface,
  SpeedReservePhenotype,
  UnifiedActivity,
} from '../types.ts';
import {
  buildTrackSpeedReserveProfile,
  solveTrackPaceSecsPerKmForPctVdot,
} from '../physiology/trackSpeedReserveEngine.ts';
import { getLocalDateIso } from '../physiology/stravaLoadCalibration.ts';

export interface OfficialRaceEventDefinition {
  label: string;
  distanceMeters: number;
  defaultSplitMeters: 60 | 100 | 200 | 400 | 1000;
  defaultLapCount: number;
  category: 'TRACK' | 'XC' | 'ROAD';
  typicalSubType: 'Track' | 'Cross Country' | 'Road';
}

export const OFFICIAL_RACE_EVENTS: OfficialRaceEventDefinition[] = [
  {
    label: '60m',
    distanceMeters: 60,
    defaultSplitMeters: 60,
    defaultLapCount: 1,
    category: 'TRACK',
    typicalSubType: 'Track',
  },
  {
    label: '100m',
    distanceMeters: 100,
    defaultSplitMeters: 100,
    defaultLapCount: 1,
    category: 'TRACK',
    typicalSubType: 'Track',
  },
  {
    label: '200m',
    distanceMeters: 200,
    defaultSplitMeters: 200,
    defaultLapCount: 1,
    category: 'TRACK',
    typicalSubType: 'Track',
  },
  {
    label: '100mH',
    distanceMeters: 100,
    defaultSplitMeters: 100,
    defaultLapCount: 1,
    category: 'TRACK',
    typicalSubType: 'Track',
  },
  {
    label: '110mH',
    distanceMeters: 110,
    defaultSplitMeters: 100,
    defaultLapCount: 1,
    category: 'TRACK',
    typicalSubType: 'Track',
  },
  {
    label: '300mH',
    distanceMeters: 300,
    defaultSplitMeters: 200,
    defaultLapCount: 2,
    category: 'TRACK',
    typicalSubType: 'Track',
  },
  {
    label: '400mH',
    distanceMeters: 400,
    defaultSplitMeters: 200,
    defaultLapCount: 2,
    category: 'TRACK',
    typicalSubType: 'Track',
  },
  {
    label: '400m',
    distanceMeters: 400,
    defaultSplitMeters: 200,
    defaultLapCount: 2,
    category: 'TRACK',
    typicalSubType: 'Track',
  },
  {
    label: '800m',
    distanceMeters: 800,
    defaultSplitMeters: 400,
    defaultLapCount: 2,
    category: 'TRACK',
    typicalSubType: 'Track',
  },
  {
    label: '1500m',
    distanceMeters: 1500,
    defaultSplitMeters: 400,
    defaultLapCount: 4,
    category: 'TRACK',
    typicalSubType: 'Track',
  },
  {
    label: '1600m',
    distanceMeters: 1600,
    defaultSplitMeters: 400,
    defaultLapCount: 4,
    category: 'TRACK',
    typicalSubType: 'Track',
  },
  {
    label: '1 Mile',
    distanceMeters: 1609.34,
    defaultSplitMeters: 400,
    defaultLapCount: 4,
    category: 'TRACK',
    typicalSubType: 'Track',
  },
  {
    label: '3000m',
    distanceMeters: 3000,
    defaultSplitMeters: 400,
    defaultLapCount: 8,
    category: 'TRACK',
    typicalSubType: 'Track',
  },
  {
    label: '3200m',
    distanceMeters: 3200,
    defaultSplitMeters: 400,
    defaultLapCount: 8,
    category: 'TRACK',
    typicalSubType: 'Track',
  },
  {
    label: '5000m',
    distanceMeters: 5000,
    defaultSplitMeters: 1000,
    defaultLapCount: 5,
    category: 'TRACK',
    typicalSubType: 'Track',
  },
  {
    label: '10000m',
    distanceMeters: 10000,
    defaultSplitMeters: 1000,
    defaultLapCount: 10,
    category: 'TRACK',
    typicalSubType: 'Track',
  },
  {
    label: 'XC 5K',
    distanceMeters: 5000,
    defaultSplitMeters: 1000,
    defaultLapCount: 5,
    category: 'XC',
    typicalSubType: 'Cross Country',
  },
  {
    label: 'Road 5K',
    distanceMeters: 5000,
    defaultSplitMeters: 1000,
    defaultLapCount: 5,
    category: 'ROAD',
    typicalSubType: 'Road',
  },
  {
    label: 'Half Marathon',
    distanceMeters: 21097.5,
    defaultSplitMeters: 1000,
    defaultLapCount: 5,
    category: 'ROAD',
    typicalSubType: 'Road',
  },
];

export interface ParsedOfficialRaceCandidate {
  id: string;
  date: string; // YYYY-MM-DD
  meetName: string;
  eventLabel: string;
  eventDistanceMeters: number;
  fatTimeSecs: number;
  displayFatTime: string;
  platform: OfficialRacePlatform;
  trackType: OfficialTrackSurface;
  placeFinish?: string;
  windReading?: string;
  lapSplitDistanceMeters: 60 | 100 | 200 | 400 | 1000;
  lapSplitsSecs: number[];
  includeWarmupCooldown: boolean;
  sourceUrl?: string;
  startDateLocalIso?: string;
}

/**
 * Formats seconds into official FAT string with 0.01s precision for Track events
 * e.g., 51.48 -> "51.48", 115.84 -> "1:55.84", 258.62 -> "4:18.62"
 */
export function formatFatTime(seconds: number, forceHundredths = true): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00.00';
  const totalHundredths = Math.round(seconds * 100);
  const hundredths = totalHundredths % 100;
  const wholeSecsTotal = Math.floor(totalHundredths / 100);
  const hours = Math.floor(wholeSecsTotal / 3600);
  const mins = Math.floor((wholeSecsTotal % 3600) / 60);
  const secs = wholeSecsTotal % 60;

  const hStr = hundredths.toString().padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}${
      forceHundredths ? `.${hStr}` : ''
    }`;
  }
  if (mins === 0) {
    return `${secs}.${hStr}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}${
    forceHundredths || hundredths > 0 ? `.${hStr}` : ''
  }`;
}

/**
 * Parses an official FAT string ("1:55.84", "51.62", "4:18.6", "14:42.10", "1:18:30") into float seconds
 */
export function parseFatTimeString(raw: string): number {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[a-zA-Z]+$/g, '') // strip trailing 'a', 'c', 'h', 'PR', 'SR'
    .trim();
  if (!cleaned) return 0;

  const parts = cleaned.split(':').map((p) => p.trim());
  if (parts.length === 1) {
    const val = parseFloat(parts[0]);
    return Number.isFinite(val) && val > 0 ? Number(val.toFixed(2)) : 0;
  }
  if (parts.length === 2) {
    const mins = parseInt(parts[0], 10);
    const secs = parseFloat(parts[1]);
    if (!Number.isFinite(mins) || !Number.isFinite(secs)) return 0;
    return Number((mins * 60 + secs).toFixed(2));
  }
  if (parts.length === 3) {
    const hrs = parseInt(parts[0], 10);
    const mins = parseInt(parts[1], 10);
    const secs = parseFloat(parts[2]);
    if (!Number.isFinite(hrs) || !Number.isFinite(mins) || !Number.isFinite(secs)) return 0;
    return Number((hrs * 3600 + mins * 60 + secs).toFixed(2));
  }
  return 0;
}

/**
 * Computes Jack Daniels VDOT from race distance (meters) and duration (seconds).
 * Valid from 400m/800m middle-distance track races through Marathon.
 */
export function computeJackDanielsVdot(distanceMeters: number, timeSecs: number): number {
  if (!distanceMeters || !timeSecs || timeSecs <= 0) return 55.0;
  const timeMins = timeSecs / 60;
  const velocityMetersPerMin = distanceMeters / timeMins;

  // Oxygen cost of running at velocity v (m/min)
  const vo2Cost =
    -4.6 + 0.182258 * velocityMetersPerMin + 0.000104 * velocityMetersPerMin * velocityMetersPerMin;

  // Fraction of VO2max sustainable for duration t (mins)
  const pctVo2Max =
    0.8 +
    0.1894393 * Math.exp(-0.012778 * timeMins) +
    0.2989558 * Math.exp(-0.1932605 * timeMins);

  const rawVdot = vo2Cost / Math.max(0.55, pctVo2Max);
  return Number(Math.max(32, Math.min(88, rawVdot)).toFixed(1));
}

/**
 * Derives threshold pace (secs/km) from Jack Daniels VDOT (~88% VO2max T-pace)
 */
export function deriveThresholdPaceSecsPerKmFromVdot(vdot: number): number {
  const safeVdot = Math.max(22, Math.min(90, vdot));
  const raw = solveTrackPaceSecsPerKmForPctVdot(safeVdot, 0.88, [140, 430]);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 240;
}

/**
 * Computes Critical Speed (CS in m/s & pace secs/km), D' (Anaerobic Distance Capacity in meters),
 * and Sandford-Laursen Anaerobic Speed Reserve (ASR/SRR/phenotype) using multi-mark OLS regression
 * across 400m-10,000m (preferring severe-domain track marks 600m-5000m), or scaled single-mark calibration.
 */
export function computeCriticalSpeedAndDPrime(
  races: Array<{ distanceMeters: number; timeSecs: number }>
): {
  criticalSpeedMps: number;
  criticalPaceSecsPerKm: number;
  dPrimeMeters: number;
  vdotBest: number;
  vdotAer: number;
  asrMps: number;
  srr: number;
  phenotype: SpeedReservePhenotype;
} {
  const valid = races.filter(
    (r) => r.distanceMeters >= 400 && r.distanceMeters <= 10000 && r.timeSecs > 35
  );
  const vdotBest =
    valid.length > 0
      ? Math.max(...valid.map((r) => computeJackDanielsVdot(r.distanceMeters, r.timeSecs)))
      : 58.5;

  const profile = buildTrackSpeedReserveProfile({
    marks: valid.map((r) => ({ distanceMeters: r.distanceMeters, durationSecs: r.timeSecs })),
    thresholdPaceSecsPerKm: deriveThresholdPaceSecsPerKmFromVdot(vdotBest),
  });

  return {
    criticalSpeedMps: Number(profile.csMps.toFixed(2)),
    criticalPaceSecsPerKm: Math.round(profile.criticalPaceSecsPerKm),
    dPrimeMeters: profile.dPrimeMeters,
    vdotBest,
    vdotAer: profile.vdotAer,
    asrMps: profile.asrMps,
    srr: profile.srr,
    phenotype: profile.phenotype,
  };
}

/**
 * Estimates supramaximal race-day Training Load (TSS) for watchless track/road races.
 * Track races like the 800m or 1600m induce intense glycolytic + neuromuscular strain
 * that naive duration-only TRIMP under-scores.
 */
export function computeOfficialRaceTrainingLoad(
  distanceMeters: number,
  fatTimeSecs: number,
  includeWarmupCooldown: boolean
): number {
  let raceEffortTss = 45;
  if (distanceMeters <= 120) {
    raceEffortTss = 18; // 60m / 100m / 100mH / 110mH maximal neuromuscular sprint
  } else if (distanceMeters <= 250) {
    raceEffortTss = 24; // 200m sprint
  } else if (distanceMeters <= 350) {
    raceEffortTss = 30; // 300mH long hurdle sprint
  } else if (distanceMeters <= 450) {
    raceEffortTss = 34; // 400m / 400mH all-out glycolytic sprint
  } else if (distanceMeters <= 900) {
    raceEffortTss = 44; // 800m anaerobic + VO2max maximal effort
  } else if (distanceMeters <= 1700) {
    raceEffortTss = 54; // 1500m / 1600m / Mile championship race effort
  } else if (distanceMeters <= 3400) {
    raceEffortTss = 68; // 3000m / 3200m
  } else if (distanceMeters <= 5200) {
    raceEffortTss = 84; // 5000m / 5K XC
  } else if (distanceMeters <= 10500) {
    raceEffortTss = 108; // 10,000m
  } else {
    raceEffortTss = Math.round(Math.min(185, (fatTimeSecs / 3600) * 112));
  }

  const warmupCooldownTss = includeWarmupCooldown ? 32 : 0; // ~20m warmup + strides + 15m cooldown
  return raceEffortTss + warmupCooldownTss;
}

/**
 * Generates realistic default lap splits (in seconds, to 0.01s) that sum to fatTimeSecs
 */
export function generateDefaultLapSplits(
  eventDistanceMeters: number,
  fatTimeSecs: number,
  splitDistanceMeters: 60 | 100 | 200 | 400 | 1000 = 400
): number[] {
  if (!fatTimeSecs || fatTimeSecs <= 0) return [];
  const numLaps = Math.max(1, Math.round(eventDistanceMeters / splitDistanceMeters));
  if (numLaps <= 1) return [Number(fatTimeSecs.toFixed(2))];

  const avgLap = fatTimeSecs / numLaps;
  // Realistic championship pacing profile: slightly brisker Lap 1, steady middle, strong kick on final lap
  const weights: number[] = [];
  for (let i = 0; i < numLaps; i++) {
    if (i === 0) weights.push(0.988);
    else if (i === numLaps - 1) weights.push(0.984);
    else weights.push(1.0 + 0.014);
  }
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const rawSplits = weights.map((w) =>
    Number(((w / weightSum) * fatTimeSecs).toFixed(2))
  );
  // Adjust last split so the sum equals fatTimeSecs to the hundredth
  const sumExceptLast = rawSplits.slice(0, -1).reduce((s, v) => s + v, 0);
  rawSplits[rawSplits.length - 1] = Number(Math.max(1, fatTimeSecs - sumExceptLast).toFixed(2));
  return rawSplits;
}

/**
 * Synthesizes a complete UnifiedActivity (including per-second velocity/HR streams and lap intervals)
 * from an OfficialRaceCandidate so watchless track/XC/road races integrate into Calendar, Activity Log,
 * Stream Inspector, and Seasonal PR Trophy Matrix.
 */
export function synthesizeOfficialRaceActivity(
  candidate: ParsedOfficialRaceCandidate,
  athleteLthr = 172,
  athleteMaxHr = 192
): UnifiedActivity {
  const splitMeters = candidate.lapSplitDistanceMeters || (candidate.eventDistanceMeters <= 400 ? 200 : candidate.eventDistanceMeters >= 5000 ? 1000 : 400);
  const splits =
    candidate.lapSplitsSecs && candidate.lapSplitsSecs.length > 0
      ? candidate.lapSplitsSecs
      : generateDefaultLapSplits(candidate.eventDistanceMeters, candidate.fatTimeSecs, splitMeters);

  const vdot = computeJackDanielsVdot(candidate.eventDistanceMeters, candidate.fatTimeSecs);
  const trainingLoad = computeOfficialRaceTrainingLoad(
    candidate.eventDistanceMeters,
    candidate.fatTimeSecs,
    candidate.includeWarmupCooldown
  );

  // Build per-second synthetic telemetry stream across all laps so the Activity Stream Inspector works out-of-the-box
  const totalSecs = Math.max(5, Math.round(candidate.fatTimeSecs));
  const timeStream: number[] = [];
  const distanceStream: number[] = [];
  const velocityStream: number[] = [];
  const hrStream: number[] = [];
  const cadenceStream: number[] = [];
  const intervals: ActivityInterval[] = [];

  let elapsedSecsCursor = 0;
  let elapsedDistCursor = 0;

  splits.forEach((lapSecs, idx) => {
    const lapDist =
      idx === splits.length - 1
        ? Math.max(10, candidate.eventDistanceMeters - elapsedDistCursor)
        : splitMeters;
    const lapSpeedMps = lapDist / Math.max(0.5, lapSecs);
    const lapPaceSecsKm = Math.round(1000 / Math.max(0.5, lapSpeedMps));
    const lapDurationInt = Math.max(1, Math.round(lapSecs));

    const lapStartHr =
      idx === 0
        ? Math.round(athleteLthr * 0.92)
        : Math.min(athleteMaxHr, Math.round(athleteLthr * 1.01 + idx * 2.5));
    const lapEndHr = Math.min(
      athleteMaxHr,
      Math.round(athleteLthr * 1.03 + (idx + 1) * 3)
    );

    for (let s = 0; s < lapDurationInt; s++) {
      const t = elapsedSecsCursor + s;
      const frac = s / Math.max(1, lapDurationInt);
      timeStream.push(t);
      distanceStream.push(Number((elapsedDistCursor + frac * lapDist).toFixed(1)));
      velocityStream.push(Number((lapSpeedMps * (0.99 + 0.02 * Math.sin(s * 0.4))).toFixed(2)));
      hrStream.push(Math.round(lapStartHr + frac * (lapEndHr - lapStartHr)));
      cadenceStream.push(
        candidate.eventDistanceMeters <= 1650 ? 194 + (idx === splits.length - 1 ? 6 : 0) : 186
      );
    }

    intervals.push({
      id: `lap-${idx + 1}`,
      type: 'WORK',
      label: `Lap ${idx + 1} (${Math.round(lapDist)}m): ${formatFatTime(lapSecs)}`,
      startTimeSecs: Math.round(elapsedSecsCursor),
      durationSecs: Number(lapSecs.toFixed(2)),
      distanceMeters: Math.round(lapDist),
      avgPaceSecsPerKm: lapPaceSecsKm,
      gapPaceSecsPerKm: lapPaceSecsKm,
      avgHr: Math.round((lapStartHr + lapEndHr) / 2),
      maxHr: lapEndHr,
      avgCadence: candidate.eventDistanceMeters <= 1650 ? 196 : 186,
      zone: candidate.eventDistanceMeters <= 1650 ? 6 : 5,
    });

    elapsedSecsCursor += lapSecs;
    elapsedDistCursor += lapDist;
  });

  const streams: ActivityStreamSet = {
    time: timeStream,
    distance: distanceStream,
    velocitySmooth: velocityStream,
    heartrate: hrStream,
    cadence: cadenceStream,
  };

  const avgPaceSecsPerKm = Math.round((candidate.fatTimeSecs / candidate.eventDistanceMeters) * 1000);
  const firstHalfSplits = splits.slice(0, Math.ceil(splits.length / 2));
  const secondHalfSplits = splits.slice(Math.ceil(splits.length / 2));
  const firstHalfAvg =
    firstHalfSplits.reduce((s, v) => s + v, 0) / Math.max(1, firstHalfSplits.length);
  const secondHalfAvg =
    secondHalfSplits.length > 0
      ? secondHalfSplits.reduce((s, v) => s + v, 0) / secondHalfSplits.length
      : firstHalfAvg;
  const splitFadePct = Number((((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100).toFixed(1));

  // Effort zone distribution: high Z5/Z6/Z7 for race effort, plus Z1/Z2 if warmup/cooldown is included
  const warmupSecs = candidate.includeWarmupCooldown ? 2100 : 0; // 35 mins warmup + cooldown
  const z1Secs = candidate.includeWarmupCooldown ? 900 : 0;
  const z2Secs = candidate.includeWarmupCooldown ? 1200 : 0;
  const raceSecs = Math.round(candidate.fatTimeSecs);

  const zoneSecsHr =
    candidate.eventDistanceMeters <= 1700
      ? [z1Secs, z2Secs, 0, Math.round(raceSecs * 0.15), Math.round(raceSecs * 0.35), Math.round(raceSecs * 0.35), Math.round(raceSecs * 0.15)]
      : [z1Secs, z2Secs, 0, Math.round(raceSecs * 0.3), Math.round(raceSecs * 0.55), Math.round(raceSecs * 0.15), 0];

  const isIndoorTrack =
    candidate.trackType === 'INDOOR_BANKED_200M' || candidate.trackType === 'INDOOR_FLAT_200M';

  const subType: UnifiedActivity['subType'] =
    candidate.trackType === 'XC_COURSE'
      ? 'Cross Country'
      : candidate.trackType === 'ROAD'
        ? 'Road'
        : 'Track';

  const officialRaceData: OfficialRaceMetadata = {
    platform: candidate.platform,
    meetName: candidate.meetName,
    eventLabel: candidate.eventLabel,
    eventDistanceMeters: candidate.eventDistanceMeters,
    fatTimeSecs: candidate.fatTimeSecs,
    displayFatTime: candidate.displayFatTime || formatFatTime(candidate.fatTimeSecs),
    trackType: candidate.trackType,
    placeFinish: candidate.placeFinish,
    windReading: candidate.windReading,
    lapSplitDistanceMeters: splitMeters,
    lapSplitsSecs: splits,
    vdotScore: vdot,
    includeWarmupCooldown: candidate.includeWarmupCooldown,
    sourceUrl: candidate.sourceUrl,
  };

  return {
    id: candidate.id || `official-race-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    startDateLocal: candidate.startDateLocalIso || `${candidate.date.slice(0, 10)}T10:30:00`,
    name: `${candidate.eventLabel} Official Race (${officialRaceData.displayFatTime}) — ${candidate.meetName}`,
    sportCategory: 'Running',
    environment: isIndoorTrack ? 'INDOOR' : 'OUTDOOR',
    subType,
    movingTimeSecs: Math.round(candidate.fatTimeSecs) + warmupSecs,
    distanceMeters:
      candidate.eventDistanceMeters + (candidate.includeWarmupCooldown ? 5600 : 0),
    elevationGainMeters: candidate.trackType === 'XC_COURSE' ? 85 : 0,
    trainingLoad,
    avgHr: Math.round(athleteLthr * 1.02),
    maxHr: athleteMaxHr,
    avgCadence: candidate.eventDistanceMeters <= 1650 ? 196 : 186,
    avgPaceSecsPerKm,
    gapPaceSecsPerKm: avgPaceSecsPerKm,
    aerobicDecouplingPct: splitFadePct,
    efficiencyFactor: Number(((1000 / avgPaceSecsPerKm) * 60 / (athleteLthr * 1.02)).toFixed(2)),
    firstHalfEf: 1.58,
    secondHalfEf: 1.56,
    deviceName: `Watchless FAT Timing (${candidate.platform})`,
    zoneSecs: {
      hr: zoneSecsHr,
      pace: zoneSecsHr,
    },
    stravaPrCount: 1,
    segmentEfforts: [],
    intervals,
    streams,
    officialRaceData,
    sourceBadges: [candidate.platform],
  };
}

/**
 * Sample Athletic.net / TFRRS / MileSplit season dataset for 1-click inspection
 * or when testing watchless track & XC race imports.
 */
export const SAMPLE_OFFICIAL_TRACK_SEASON_TEXT = `Athletic.net / TFRRS Official Season Results — Alex Mercer
2026-10-24 | Bay Area Track Club Twilight | 800m | 1:56.38a | 2nd (Final) | Outdoor 400m | Splits: 56.92, 59.46 | Athletic.net
2026-10-10 | Pacific Collegiate Invitational | 1500m | 3:56.84a | 3rd (Heat 1) | Outdoor 400m | Splits: 46.8, 63.4, 64.1, 62.54 | TFRRS
2026-09-26 | Stanford Cobb Track Mile Night | 1600m | 4:16.42a | 1st (PR) | Outdoor 400m | Splits: 63.10, 64.85, 65.22, 63.25 | Athletic.net
2026-09-12 | Golden Gate Distance Carnival | 3200m | 9:18.60a | 4th (Final) | Outdoor 400m | MileSplit
2026-08-29 | Crystal Springs XC Opener | XC 5K | 15:34.20 | 5th (Varsity) | XC Course | Athletic.net`;

const MONTH_NAME_MAP: Record<string, string> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
};

function normalizeRaceEventToken(rawToken: string): string {
  const clean = rawToken.toLowerCase().replace(/,/g, '').replace(/\s+/g, ' ').trim();
  if (/^60\s*(?:m|meters?)$/.test(clean)) return '60m';
  if (/^100\s*(?:m|meters?)\s*(?:h|hurdles?)$/.test(clean)) return '100mH';
  if (/^110\s*(?:m|meters?)\s*(?:h|hurdles?)$/.test(clean)) return '110mH';
  if (/^300\s*(?:m|meters?)\s*(?:h|hurdles?)$/.test(clean)) return '300mH';
  if (/^400\s*(?:m|meters?)\s*(?:h|hurdles?)$/.test(clean)) return '400mH';
  if (/^100\s*(?:m|meters?)$/.test(clean)) return '100m';
  if (/^200\s*(?:m|meters?)$/.test(clean)) return '200m';
  if (/^400\s*(?:m|meters?)$/.test(clean)) return '400m';
  if (/^800\s*(?:m|meters?)$/.test(clean)) return '800m';
  if (/^1500\s*(?:m|meters?)$/.test(clean)) return '1500m';
  if (/^1600\s*(?:m|meters?)$/.test(clean)) return '1600m';
  if (/^(?:1\s*)?mile$/.test(clean)) return '1 Mile';
  if (/^3000\s*(?:m|meters?|s|sc|m\s*steeple(?:chase)?)$/.test(clean)) return '3000m';
  if (/^3200\s*(?:m|meters?)$/.test(clean)) return '3200m';
  if (/^5000\s*(?:m|meters?)$/.test(clean)) return '5000m';
  if (/^10000\s*(?:m|meters?)$/.test(clean)) return '10000m';
  if (/^xc\s*5k$/.test(clean)) return 'XC 5K';
  if (/^road\s*5k$/.test(clean)) return 'Road 5K';
  if (/^5k$/.test(clean)) return 'XC 5K';
  if (/half\s*marathon/.test(clean)) return 'Half Marathon';
  return rawToken;
}

/**
 * Deterministic text/table parser that extracts official race rows from pasted
 * Athletic.net, TFRRS, MileSplit, FlashResults, or formatted meet tables.
 */
export function parseOfficialResultsTextDeterministically(
  rawText: string,
  defaultUrl?: string
): ParsedOfficialRaceCandidate[] {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 5);

  const detectedPlatformFromUrl: OfficialRacePlatform = defaultUrl
    ? /tfrrs/i.test(defaultUrl)
      ? 'TFRRS'
      : /milesplit/i.test(defaultUrl)
        ? 'MileSplit'
        : /runsignup/i.test(defaultUrl)
          ? 'RunSignup'
          : 'Athletic.net'
    : 'Athletic.net';

  const results: ParsedOfficialRaceCandidate[] = [];
  const seenKeys = new Set<string>();
  const todayIso = getLocalDateIso();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip header lines
    if (/^athletic\.net\s*\/?\s*tfrrs/i.test(line) || /^date\s*\|\s*meet/i.test(line)) {
      continue;
    }

    // Match Event distance token (Sprints/Hurdles 60m-400mH through Half Marathon)
    const eventMatch = line.match(
      /\b(100\s*(?:meters?|m)\s*(?:h|hurdles?)|110\s*(?:meters?|m)\s*(?:h|hurdles?)|300\s*(?:meters?|m)\s*(?:h|hurdles?)|400\s*(?:meters?|m)\s*(?:h|hurdles?)|60\s*(?:meters?|m)|100\s*(?:meters?|m)|200\s*(?:meters?|m)|400\s*(?:meters?|m)|800\s*(?:meters?|m)|1500\s*(?:meters?|m)|1600\s*(?:meters?|m)|1\s*Mile|Mile|3000\s*(?:m\s*steeple(?:chase)?|meters?|sc|s|m)|3200\s*(?:meters?|m)|5000\s*(?:meters?|m)|10,?000\s*(?:meters?|m)|XC\s*5K|Road\s*5K|5K|Half\s*Marathon)\b/i
    );
    // Match FAT time token (e.g. 6.84, 10.74, 14.12, 21.84, 50.84, 1:56.38a, 4:16.42, 15:34.20)
    const timeMatch = line.match(
      /\b(\d{1,2}:\d{2}(?:\.\d{1,2})?[a-zA-Z]?|[1-6]\d\.\d{2}[a-zA-Z]?|[6-9]\.\d{2}[a-zA-Z]?)\b/
    );

    if (!eventMatch || !timeMatch) continue;

    const canonicalEventLabel = normalizeRaceEventToken(eventMatch[1]);
    const matchedDef =
      OFFICIAL_RACE_EVENTS.find(
        (d) => d.label.toLowerCase() === canonicalEventLabel.toLowerCase()
      ) || OFFICIAL_RACE_EVENTS[1];

    if (!matchedDef) continue;

    const fatTimeSecs = parseFatTimeString(timeMatch[1]);
    if (fatTimeSecs <= 5) continue;

    // Extract YYYY-MM-DD, MM/DD/YYYY, or natural month name dates ("Apr 4, 2026" / "May 14, 2026")
    const isoDateMatch = line.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    const slashDateMatch = line.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
    const monthDateMatch = line.match(
      /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/i
    );
    let dateStr = todayIso;
    if (isoDateMatch) {
      dateStr = isoDateMatch[1];
    } else if (slashDateMatch) {
      const m = slashDateMatch[1].padStart(2, '0');
      const d = slashDateMatch[2].padStart(2, '0');
      dateStr = `${slashDateMatch[3]}-${m}-${d}`;
    } else if (monthDateMatch) {
      const m = MONTH_NAME_MAP[monthDateMatch[1].toLowerCase()] || '01';
      const d = monthDateMatch[2].padStart(2, '0');
      dateStr = `${monthDateMatch[3]}-${m}-${d}`;
    }

    const dedupeKey = `${matchedDef.label}|${fatTimeSecs.toFixed(2)}|${dateStr}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    // Extract Splits if present ("Splits: 56.92, 59.46")
    let lapSplitsSecs: number[] = [];
    const splitsMatch = line.match(/splits?\s*:\s*([0-9.,\s:]+)/i);
    if (splitsMatch) {
      lapSplitsSecs = splitsMatch[1]
        .split(/[,\s]+/)
        .map((s) => parseFatTimeString(s))
        .filter((n) => n > 4 && n < 600);
    }
    if (lapSplitsSecs.length === 0) {
      lapSplitsSecs = generateDefaultLapSplits(
        matchedDef.distanceMeters,
        fatTimeSecs,
        matchedDef.defaultSplitMeters
      );
    }

    // Platform
    const platform: OfficialRacePlatform = /tfrrs/i.test(line)
      ? 'TFRRS'
      : /milesplit/i.test(line)
        ? 'MileSplit'
        : /runsignup/i.test(line)
          ? 'RunSignup'
          : /athletic\.net/i.test(line)
            ? 'Athletic.net'
            : detectedPlatformFromUrl;

    // Track Surface
    const trackType: OfficialTrackSurface = /banked/i.test(line)
      ? 'INDOOR_BANKED_200M'
      : /indoor/i.test(line)
        ? 'INDOOR_FLAT_200M'
        : /xc|cross country/i.test(line) || matchedDef.category === 'XC'
          ? 'XC_COURSE'
          : matchedDef.category === 'ROAD'
            ? 'ROAD'
            : 'OUTDOOR_400M';

    // Place
    const placeMatch = line.match(/\b(\d+(?:st|nd|rd|th)(?:\s*\([^)]+\))?)\b/i);
    const placeFinish = placeMatch ? placeMatch[1] : 'Official Finisher';

    // Meet name: pipe-delimited OR tab/multi-space TFRRS/Athletic.net columns
    const pipeParts = line.split('|').map((p) => p.trim());
    const colParts = pipeParts.length >= 2 ? pipeParts : line.split(/\t|\s{2,}/).map((p) => p.trim());
    let meetName = 'Official Track & Field Invitational';
    if (colParts.length >= 2) {
      const candidateMeet = colParts.find(
        (p) =>
          p.length > 3 &&
          !p.match(/^20\d{2}-\d{2}-\d{2}$/) &&
          !p.match(/^\d{1,2}\/\d{1,2}\/20\d{2}$/) &&
          !p.match(/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)/i) &&
          !p.match(/^(400|800|1500|1600|1\s*Mile|3000|3200|5000|10,?000)\s*(?:meters?|m|s|sc)?$|^XC\s*5K$|^5K$/i) &&
          !p.match(/^\d{1,2}:\d{2}/) &&
          !p.match(/^\d+(?:st|nd|rd|th)\b/i) &&
          !p.match(/splits?:/i)
      );
      if (candidateMeet) meetName = candidateMeet;
    }

    results.push({
      id: `parsed-race-${Date.now()}-${i}`,
      date: dateStr,
      meetName,
      eventLabel: matchedDef.label,
      eventDistanceMeters: matchedDef.distanceMeters,
      fatTimeSecs,
      displayFatTime: formatFatTime(fatTimeSecs),
      platform,
      trackType,
      placeFinish,
      lapSplitDistanceMeters: matchedDef.defaultSplitMeters,
      lapSplitsSecs,
      includeWarmupCooldown: true,
      sourceUrl: defaultUrl,
    });
  }

  return results;
}
