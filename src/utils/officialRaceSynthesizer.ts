import {
  ActivityInterval,
  ActivityStreamSet,
  OfficialRaceMetadata,
  OfficialRacePlatform,
  OfficialTrackSurface,
  UnifiedActivity,
} from '../types';

export interface OfficialRaceEventDefinition {
  label: string;
  distanceMeters: number;
  defaultSplitMeters: 200 | 400 | 1000;
  defaultLapCount: number;
  category: 'TRACK' | 'XC' | 'ROAD';
  typicalSubType: 'Track' | 'Cross Country' | 'Road';
}

export const OFFICIAL_RACE_EVENTS: OfficialRaceEventDefinition[] = [
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
  lapSplitDistanceMeters: 200 | 400 | 1000;
  lapSplitsSecs: number[];
  includeWarmupCooldown: boolean;
  sourceUrl?: string;
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
  const safeVdot = Math.max(35, Math.min(85, vdot));
  const targetVo2 = safeVdot * 0.88;
  // Invert quadratic: 0.000104 * v^2 + 0.182258 * v - (4.6 + targetVo2) = 0
  const a = 0.000104;
  const b = 0.182258;
  const c = -(4.6 + targetVo2);
  const velocityMetersPerMin = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  if (!Number.isFinite(velocityMetersPerMin) || velocityMetersPerMin <= 0) return 240;
  const secsPerKm = (1000 / velocityMetersPerMin) * 60;
  return Math.round(Math.max(165, Math.min(390, secsPerKm)));
}

/**
 * Computes Critical Speed (CS in m/s & pace secs/km) and D' (Anaerobic Distance Capacity in meters)
 * using 2+ race distances between 400m and 5000m (linear Distance-Time model: D = CS * t + D'),
 * or estimates from best official VDOT when only 1 race is available.
 */
export function computeCriticalSpeedAndDPrime(
  races: Array<{ distanceMeters: number; timeSecs: number }>
): {
  criticalSpeedMps: number;
  criticalPaceSecsPerKm: number;
  dPrimeMeters: number;
  vdotBest: number;
} {
  const valid = races.filter(
    (r) => r.distanceMeters >= 400 && r.distanceMeters <= 10000 && r.timeSecs > 35
  );
  const vdotBest =
    valid.length > 0
      ? Math.max(...valid.map((r) => computeJackDanielsVdot(r.distanceMeters, r.timeSecs)))
      : 58.5;

  // Check if we have at least one shorter middle-distance effort (<= 1610m) and one longer effort (>= 1500m)
  const sortedByDist = [...valid].sort((a, b) => a.distanceMeters - b.distanceMeters);
  if (sortedByDist.length >= 2) {
    const shortRace = sortedByDist[0];
    const longRace = sortedByDist[sortedByDist.length - 1];
    if (longRace.distanceMeters - shortRace.distanceMeters >= 600 && longRace.timeSecs > shortRace.timeSecs + 45) {
      const cs =
        (longRace.distanceMeters - shortRace.distanceMeters) /
        (longRace.timeSecs - shortRace.timeSecs);
      const dPrime = shortRace.distanceMeters - cs * shortRace.timeSecs;
      const clampedCs = Math.max(3.2, Math.min(6.4, cs));
      const clampedDPrime = Math.round(Math.max(140, Math.min(420, dPrime)));
      return {
        criticalSpeedMps: Number(clampedCs.toFixed(2)),
        criticalPaceSecsPerKm: Math.round(1000 / clampedCs),
        dPrimeMeters: clampedDPrime,
        vdotBest,
      };
    }
  }

  const thresholdPace = deriveThresholdPaceSecsPerKmFromVdot(vdotBest);
  const csPace = Math.round(thresholdPace * 0.975);
  const csMps = Number((1000 / csPace).toFixed(2));
  return {
    criticalSpeedMps: csMps,
    criticalPaceSecsPerKm: csPace,
    dPrimeMeters: Math.round(190 + (vdotBest - 50) * 4.2),
    vdotBest,
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
  if (distanceMeters <= 450) {
    raceEffortTss = 34; // 400m all-out glycolytic sprint
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
  splitDistanceMeters: 200 | 400 | 1000 = 400
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
  rawSplits[rawSplits.length - 1] = Number(Math.max(10, fatTimeSecs - sumExceptLast).toFixed(2));
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
  const totalSecs = Math.max(10, Math.round(candidate.fatTimeSecs));
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
        ? Math.max(100, candidate.eventDistanceMeters - elapsedDistCursor)
        : splitMeters;
    const lapSpeedMps = lapDist / Math.max(1, lapSecs);
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
    startDateLocal: `${candidate.date.slice(0, 10)}T10:30:00`,
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
  const todayIso = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip header lines
    if (/^athletic\.net\s*\/?\s*tfrrs/i.test(line) || /^date\s*\|\s*meet/i.test(line)) {
      continue;
    }

    // Match Event distance token (400m, 800m, 1500m, 1600m, 1 Mile, Mile, 3000m, 3200m, 5000m, 10000m, XC 5K, 5K)
    const eventMatch = line.match(
      /\b(400\s*m|800\s*m|1500\s*m|1600\s*m|1\s*Mile|Mile|3000\s*m|3200\s*m|5000\s*m|10000\s*m|10,000\s*m|XC\s*5K|Road\s*5K|5K|Half\s*Marathon)\b/i
    );
    // Match FAT time token (e.g. 50.84, 1:56.38a, 4:16.42, 9:18.60, 15:34.20)
    const timeMatch = line.match(
      /\b(\d{1,2}:\d{2}(?:\.\d{1,2})?[a-zA-Z]?|\b[456]\d\.\d{2}[a-zA-Z]?)\b/
    );

    if (!eventMatch || !timeMatch) continue;

    const rawEventToken = eventMatch[1].replace(/\s+/g, ' ').trim();
    const matchedDef =
      OFFICIAL_RACE_EVENTS.find(
        (d) => d.label.toLowerCase() === rawEventToken.toLowerCase()
      ) ||
      (/mile/i.test(rawEventToken)
        ? OFFICIAL_RACE_EVENTS.find((d) => d.label === '1 Mile')
        : /5k/i.test(rawEventToken)
          ? OFFICIAL_RACE_EVENTS.find((d) => d.label === 'XC 5K')
          : OFFICIAL_RACE_EVENTS[1]);

    if (!matchedDef) continue;

    const fatTimeSecs = parseFatTimeString(timeMatch[1]);
    if (fatTimeSecs <= 20) continue;

    // Extract YYYY-MM-DD or MM/DD/YYYY or Month DD, YYYY
    const isoDateMatch = line.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    const slashDateMatch = line.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
    let dateStr = todayIso;
    if (isoDateMatch) {
      dateStr = isoDateMatch[1];
    } else if (slashDateMatch) {
      const m = slashDateMatch[1].padStart(2, '0');
      const d = slashDateMatch[2].padStart(2, '0');
      dateStr = `${slashDateMatch[3]}-${m}-${d}`;
    }

    // Extract Splits if present ("Splits: 56.92, 59.46")
    let lapSplitsSecs: number[] = [];
    const splitsMatch = line.match(/splits?\s*:\s*([0-9.,\s:]+)/i);
    if (splitsMatch) {
      lapSplitsSecs = splitsMatch[1]
        .split(/[,\s]+/)
        .map((s) => parseFatTimeString(s))
        .filter((n) => n > 8 && n < 400);
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

    // Meet name: pipe-delimited segment or cleaned line
    const pipeParts = line.split('|').map((p) => p.trim());
    let meetName = 'Official Track & Field Invitational';
    if (pipeParts.length >= 2) {
      const candidateMeet = pipeParts.find(
        (p) =>
          p.length > 4 &&
          !p.match(/^20\d{2}-\d{2}-\d{2}$/) &&
          !p.match(/^(400m|800m|1500m|1600m|1 Mile|3000m|3200m|5000m|XC 5K)$/i) &&
          !p.match(/^\d{1,2}:\d{2}/) &&
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
