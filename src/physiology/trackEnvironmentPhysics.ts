import type {
  NcaaTrackFacilityType,
  TrackEnvironmentConditions,
  TrackLaneNumber,
  TrackSplitEnvironmentAdjustment,
  TrackTrainingZoneCode,
  VdotPodIntensity,
} from '../types.ts';

export interface WorldAthleticsOvalLaneGeometry {
  lane: TrackLaneNumber;
  straightMeters: number;
  kerbRadiusMeters: number;
  laneWidthMeters: number;
  effectiveRadiusMeters: number;
  circumferenceMeters: number;
  lapLengthMeters: number;
  halfLapLengthMeters: number;
  laneRatio: number;
}

export interface TrackSplitEnvironmentParams {
  baseTargetSplitSecs: number;
  repDistanceMeters?: number;
  baseRestDurationSecs?: number;
  zoneCode?: TrackTrainingZoneCode;
  intensity?: VdotPodIntensity;
  environment?: TrackEnvironmentConditions;
  isIntervalSession?: boolean;
}

const STRAIGHT_METERS = 84.39;
const KERB_RADIUS_METERS = 36.5;
const LANE_WIDTH_METERS = 1.22;
const LANE_1_RADIUS_METERS = KERB_RADIUS_METERS + 0.3;
const LANE_1_CIRCUMFERENCE_METERS = 2 * STRAIGHT_METERS + 2 * Math.PI * LANE_1_RADIUS_METERS;

/**
 * Computes World Athletics 400m Standard Oval lane geometry (Lanes 1-8).
 * Lane 1 measures along 36.80m running radius (36.50m kerb + 0.30m);
 * Lanes 2-8 measure along kerb + (lane - 1) * 1.22m + 0.20m offset.
 */
export function computeWorldAthleticsOvalLaneGeometry(
  lane: TrackLaneNumber
): WorldAthleticsOvalLaneGeometry {
  const safeLane = (Math.max(1, Math.min(8, Math.round(lane))) as TrackLaneNumber) || 1;
  const effectiveRadiusMeters =
    safeLane === 1
      ? LANE_1_RADIUS_METERS
      : KERB_RADIUS_METERS + (safeLane - 1) * LANE_WIDTH_METERS + 0.2;
  const circumferenceMeters = 2 * STRAIGHT_METERS + 2 * Math.PI * effectiveRadiusMeters;
  const lapLengthMeters = Number(circumferenceMeters.toFixed(2));
  const halfLapLengthMeters = Number((circumferenceMeters / 2).toFixed(2));
  const laneRatio =
    safeLane === 1 ? 1.0 : circumferenceMeters / LANE_1_CIRCUMFERENCE_METERS;

  return {
    lane: safeLane,
    straightMeters: STRAIGHT_METERS,
    kerbRadiusMeters: KERB_RADIUS_METERS,
    laneWidthMeters: LANE_WIDTH_METERS,
    effectiveRadiusMeters: Number(effectiveRadiusMeters.toFixed(3)),
    circumferenceMeters,
    lapLengthMeters,
    halfLapLengthMeters,
    laneRatio,
  };
}

function resolveHeatBandContinuousSlowdown(hadleySumF: number): {
  continuousPct: number;
  abortTriggered: boolean;
} {
  if (hadleySumF <= 100) {
    return { continuousPct: 0, abortTriggered: false };
  }
  if (hadleySumF > 180) {
    return { continuousPct: 12.0, abortTriggered: true };
  }

  const breakpoints: Array<[number, number]> = [
    [100, 0.0],
    [110, 0.5],
    [120, 1.0],
    [130, 2.0],
    [140, 3.0],
    [150, 4.5],
    [160, 6.0],
    [170, 8.0],
    [180, 10.5],
  ];

  for (let i = 1; i < breakpoints.length; i++) {
    const [x1, y1] = breakpoints[i];
    if (hadleySumF <= x1) {
      const [x0, y0] = breakpoints[i - 1];
      const t = (hadleySumF - x0) / (x1 - x0);
      return {
        continuousPct: Number((y0 + t * (y1 - y0)).toFixed(2)),
        abortTriggered: false,
      };
    }
  }

  return { continuousPct: 10.5, abortTriggered: false };
}

function resolveZoneBucket(
  zoneCode?: TrackTrainingZoneCode,
  intensity?: VdotPodIntensity
): 'R_OR_FR' | 'INTERVAL' | 'AEROBIC_THRESHOLD' {
  if (zoneCode === 'R' || zoneCode === 'FR') return 'R_OR_FR';
  if (zoneCode === 'I') return 'INTERVAL';
  if (zoneCode === 'E' || zoneCode === 'SUB_T' || zoneCode === 'T' || zoneCode === 'CV') {
    return 'AEROBIC_THRESHOLD';
  }
  if (
    intensity === 'REPETITION' ||
    intensity === 'RACE_400M' ||
    intensity === 'RACE_800M' ||
    intensity === 'RACE_1600M'
  ) {
    return 'R_OR_FR';
  }
  if (intensity === 'INTERVAL_VO2' || intensity === 'RACE_3200M') {
    return 'INTERVAL';
  }
  return 'AEROBIC_THRESHOLD';
}

function resolveFacilityTurnMultiplier(
  facility: NcaaTrackFacilityType,
  zoneBucket: 'R_OR_FR' | 'INTERVAL' | 'AEROBIC_THRESHOLD'
): number {
  if (facility !== 'INDOOR_FLAT_200M') return 1.0;
  if (zoneBucket === 'R_OR_FR') return 1.015;
  if (zoneBucket === 'INTERVAL') return 1.012;
  return 1.009;
}

/**
 * Adjusts track workout split targets and recovery duration for:
 * 1) World Athletics Oval Lane 2-8 length & non-staggered geometry
 * 2) Indoor 200m flat turn centripetal penalties
 * 3) Mark Hadley T_air + T_dew thermal stress & >180 abort gate
 * 4) Davies/Pugh oval wind drag penalty + pacing tolerance window
 * 5) Daniels/Chapman altitude differential (>=1000m slows E/Sub-T/T/CV/I while preserving <=300m R/FR neuromuscular speed + extending rest)
 */
export function computeTrackEnvironmentSplitAdjustment(
  params: TrackSplitEnvironmentParams
): TrackSplitEnvironmentAdjustment {
  const {
    baseTargetSplitSecs,
    repDistanceMeters = 400,
    baseRestDurationSecs = 60,
    zoneCode,
    intensity,
    environment,
    isIntervalSession = true,
  } = params;

  const lane: TrackLaneNumber = environment?.lane ?? 1;
  const isStaggeredStart = Boolean(environment?.isStaggeredStart);
  const facility: NcaaTrackFacilityType = environment?.facility ?? 'OUTDOOR_400M';
  const airTempF =
    typeof environment?.airTempF === 'number' && Number.isFinite(environment.airTempF)
      ? environment.airTempF
      : null;
  const dewPointF =
    typeof environment?.dewPointF === 'number' && Number.isFinite(environment.dewPointF)
      ? environment.dewPointF
      : null;
  const windSpeedMps =
    typeof environment?.windSpeedMps === 'number' && Number.isFinite(environment.windSpeedMps)
      ? Math.max(0, environment.windSpeedMps)
      : 0;
  const altitudeMeters =
    typeof environment?.altitudeMeters === 'number' && Number.isFinite(environment.altitudeMeters)
      ? Math.max(0, environment.altitudeMeters)
      : 0;

  const zoneBucket = resolveZoneBucket(zoneCode, intensity);
  const geometry = computeWorldAthleticsOvalLaneGeometry(lane);
  const laneMultiplier = lane > 1 && !isStaggeredStart ? geometry.laneRatio : 1.0;
  const facilityMultiplier = resolveFacilityTurnMultiplier(facility, zoneBucket);

  // 1. Mark Hadley T_air + T_dew thermal model
  let hadleySumF: number | null = null;
  let heatSlowdownPct = 0;
  let heatAbortTriggered = false;
  if (airTempF !== null && dewPointF !== null) {
    hadleySumF = Number((airTempF + dewPointF).toFixed(1));
    const { continuousPct, abortTriggered } = resolveHeatBandContinuousSlowdown(hadleySumF);
    heatAbortTriggered = abortTriggered;
    if (isIntervalSession) {
      if (zoneBucket === 'R_OR_FR' && repDistanceMeters <= 300) {
        heatSlowdownPct = Number(Math.min(1.5, continuousPct * 0.2).toFixed(2));
      } else {
        heatSlowdownPct = Number((continuousPct * 0.5).toFixed(2));
      }
    } else {
      heatSlowdownPct = continuousPct;
    }
  }

  // 2. Davies / Pugh oval wind drag
  let windNetSlowdownPct = 0;
  let windTolerancePlusMinusSecs = 0.5;
  if (windSpeedMps >= 4) {
    windNetSlowdownPct = Number(
      Math.min(4.5, Math.max(0.2, 0.08 * Math.pow(windSpeedMps - 2.5, 1.6))).toFixed(2)
    );
    windTolerancePlusMinusSecs = Number((0.5 + (windSpeedMps - 3) * 0.35).toFixed(1));
  }

  // 3. Daniels / Chapman altitude differential (>=1000m)
  let altitudeSlowdownPct = 0;
  let altitudeRestMultiplier = 1.0;
  if (altitudeMeters >= 1000) {
    const altNorm = Math.max(0, Math.min(1.5, (altitudeMeters - 1000) / 1200));
    if (zoneBucket === 'R_OR_FR' && repDistanceMeters <= 300) {
      altitudeSlowdownPct = 0;
      altitudeRestMultiplier = Number((1.35 + Math.min(0.4, altNorm * 0.4)).toFixed(2));
    } else if (zoneBucket === 'R_OR_FR') {
      altitudeSlowdownPct = Number((1.2 + altNorm * 1.8).toFixed(2));
      altitudeRestMultiplier = Number((1.25 + Math.min(0.35, altNorm * 0.35)).toFixed(2));
    } else if (zoneBucket === 'INTERVAL') {
      altitudeSlowdownPct = Number((2.5 + altNorm * 4.5).toFixed(2));
      altitudeRestMultiplier = Number((1.15 + Math.min(0.25, altNorm * 0.25)).toFixed(2));
    } else {
      altitudeSlowdownPct = Number((1.5 + altNorm * 3.0).toFixed(2));
      altitudeRestMultiplier = Number((1.1 + Math.min(0.2, altNorm * 0.2)).toFixed(2));
    }
  }

  const combinedSplitMultiplier =
    laneMultiplier *
    facilityMultiplier *
    (1 + heatSlowdownPct / 100) *
    (1 + windNetSlowdownPct / 100) *
    (1 + altitudeSlowdownPct / 100);

  const adjustedTargetSplitSecs = Number((baseTargetSplitSecs * combinedSplitMultiplier).toFixed(2));
  const adjustedRestDurationSecs = Math.round(baseRestDurationSecs * altitudeRestMultiplier);

  const summaryBadges: string[] = [];
  if (lane > 1) {
    summaryBadges.push(
      isStaggeredStart
        ? `Lane ${lane} Staggered (400m eq)`
        : `Lane ${lane} (${geometry.lapLengthMeters.toFixed(2)}m)`
    );
  }
  if (facility === 'INDOOR_FLAT_200M') {
    summaryBadges.push(`200m Flat (+${((facilityMultiplier - 1) * 100).toFixed(1)}%)`);
  } else if (facility === 'INDOOR_BANKED_200M') {
    summaryBadges.push('200m Banked');
  }
  if (hadleySumF !== null && (heatSlowdownPct > 0 || heatAbortTriggered)) {
    summaryBadges.push(
      heatAbortTriggered
        ? `Heat Abort (T+Td ${Math.round(hadleySumF)})`
        : `Hadley +${heatSlowdownPct.toFixed(1)}%`
    );
  }
  if (windNetSlowdownPct > 0) {
    summaryBadges.push(`Wind +${windNetSlowdownPct.toFixed(1)}% (±${windTolerancePlusMinusSecs}s)`);
  }
  if (altitudeMeters >= 1000) {
    summaryBadges.push(
      altitudeSlowdownPct === 0
        ? `Alt ${Math.round(altitudeMeters)}m Speed Lock (${altitudeRestMultiplier.toFixed(2)}x rest)`
        : `Alt ${Math.round(altitudeMeters)}m +${altitudeSlowdownPct.toFixed(1)}% (${altitudeRestMultiplier.toFixed(2)}x rest)`
    );
  }

  let advisoryNote =
    summaryBadges.length === 0
      ? 'Lane 1 Outdoor Sea-Level Baseline (400.00m).'
      : `Adjusted for ${summaryBadges.join(' · ')}.`;

  if (heatAbortTriggered) {
    advisoryNote = `HEAT ABORT GATE (T_air + T_dew = ${Math.round(hadleySumF!)} > 180): Cancel high-density anaerobic track reps; move indoors or substitute easy hydration spin.`;
  } else if (altitudeMeters >= 1000 && zoneBucket === 'R_OR_FR' && repDistanceMeters <= 300) {
    advisoryNote = `Daniels/Chapman Altitude Rule (${Math.round(altitudeMeters)}m): ${repDistanceMeters}m ${zoneCode ?? 'R/FR'} neuromuscular split holds 100% sea-level velocity; recovery extended ${altitudeRestMultiplier.toFixed(2)}x (${adjustedRestDurationSecs}s) for PCr resynthesis.`;
  }

  return {
    lane,
    lapLengthMeters: geometry.lapLengthMeters,
    halfLapLengthMeters: geometry.halfLapLengthMeters,
    laneMultiplier: Number(laneMultiplier.toFixed(5)),
    facilityMultiplier: Number(facilityMultiplier.toFixed(4)),
    hadleySumF,
    heatSlowdownPct,
    heatAbortTriggered,
    windNetSlowdownPct,
    windTolerancePlusMinusSecs,
    altitudeSlowdownPct,
    altitudeRestMultiplier,
    combinedSplitMultiplier: Number(combinedSplitMultiplier.toFixed(5)),
    adjustedTargetSplitSecs,
    adjustedRestDurationSecs,
    summaryBadges,
    advisoryNote,
  };
}
