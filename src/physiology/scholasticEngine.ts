import type {
  ActivityInterval,
  ActivityStreamSet,
  CrossTrainingEquivalence,
  CrossTrainingModality,
  NcaaCaraWeeklyAudit,
  NcaaTrackConversionResult,
  NcaaTrackFacilityType,
  RecruitingStandardComparison,
  ScholasticTrackEventLabel,
  SportCategory,
  StudentAthleteCheckIn,
  StudentAthleteGuardrailResult,
  UnifiedActivity,
  VdotPodAthleteMember,
  VdotPodIntensity,
  VdotTrainingPod,
} from '../types';

/**
 * Formats seconds with 0.01s or 0.1s precision into Track & Field stopwatch format (`m:ss.xx` or `ss.xx`).
 */
export function formatTrackMark(seconds: number, decimals: 1 | 2 = 2): string {
  const safe = Math.max(0, seconds);
  if (safe < 60) {
    return `${safe.toFixed(decimals)}s`;
  }
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const remSecs = safe - hrs * 3600 - mins * 60;
  const secStr = remSecs.toFixed(decimals).padStart(decimals === 2 ? 5 : 4, '0');
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${secStr}`;
  }
  return `${mins}:${secStr}`;
}

/**
 * Infers Jack Daniels VDOT from a running Lactate Threshold pace (`s/km`).
 * At T-pace (~88% VO2max): v (m/min) = 60,000 / paceSecsPerKm.
 */
export function estimateVdotFromThresholdPace(thresholdPaceSecsPerKm: number): number {
  const safePace = Math.max(150, Math.min(480, thresholdPaceSecsPerKm || 250));
  const vMetersPerMin = 60000 / safePace;
  const vo2AtThreshold = -4.6 + 0.182258 * vMetersPerMin + 0.000104 * vMetersPerMin * vMetersPerMin;
  const vdot = vo2AtThreshold / 0.88;
  return Number(Math.max(28, Math.min(86, vdot)).toFixed(1));
}

/**
 * Derives threshold pace (`s/km`) from a Jack Daniels VDOT score via Newton/quadratic inversion.
 */
export function deriveThresholdPaceFromVdot(vdot: number): number {
  const safeVdot = Math.max(28, Math.min(86, vdot));
  const targetVo2 = safeVdot * 0.88;
  // 0.000104 v^2 + 0.182258 v - (4.6 + targetVo2) = 0
  const a = 0.000104;
  const b = 0.182258;
  const c = -(4.6 + targetVo2);
  const disc = Math.max(0, b * b - 4 * a * c);
  const vMetersPerMin = (-b + Math.sqrt(disc)) / (2 * a);
  if (vMetersPerMin <= 50) return 360;
  return Number((60000 / vMetersPerMin).toFixed(1));
}

const INTENSITY_PACE_MULTIPLIERS: Record<
  VdotPodIntensity,
  { paceMultiplierVsThreshold: number; label: string; pctFtpSyntax: string }
> = {
  EASY: {
    paceMultiplierVsThreshold: 1.24,
    label: 'Easy / Aerobic Base',
    pctFtpSyntax: '68%-76% Pace',
  },
  MARATHON: {
    paceMultiplierVsThreshold: 1.065,
    label: 'Marathon / Steady State',
    pctFtpSyntax: '86%-91% Pace',
  },
  THRESHOLD_CV: {
    paceMultiplierVsThreshold: 0.99,
    label: 'Threshold / Tinman CV',
    pctFtpSyntax: '98%-102% Pace',
  },
  INTERVAL_VO2: {
    paceMultiplierVsThreshold: 0.915,
    label: 'VO2max Interval (3K–5K)',
    pctFtpSyntax: '106%-111% Pace',
  },
  REPETITION: {
    paceMultiplierVsThreshold: 0.855,
    label: 'Mile / Economy Repetition',
    pctFtpSyntax: '114%-120% Pace',
  },
};

const POD_TIERS = [
  'Pod A — Varsity Lead',
  'Pod B — Varsity Pack',
  'Pod C — Sub-Varsity',
  'Pod D — Developmental',
  'Pod E — Foundation',
  'Pod F — Return-to-Run',
];

export interface VdotPodRosterInput {
  id: string;
  name: string;
  thresholdPaceSecsPerKm: number;
  vdotOverride?: number;
}

/**
 * Clusters a High School or Collegiate roster into cohesive VDOT Pacing Pods (`±2.2 VDOT` / `~2s per 400m`)
 * and calculates exact 200m, 400m, 800m, 1000m, and 1600m track splits for one unified coach prescription.
 */
export function computeTeamVdotPacingPods(params: {
  roster: VdotPodRosterInput[];
  intensity: VdotPodIntensity;
  repCount: number;
  repDistanceMeters: 200 | 400 | 800 | 1000 | 1600;
  recoveryLabel?: string;
  maxPods?: number;
}): VdotTrainingPod[] {
  const {
    roster,
    intensity,
    repCount,
    repDistanceMeters,
    recoveryLabel = '60s jog',
    maxPods = 5,
  } = params;

  if (!roster || roster.length === 0) return [];

  const members: VdotPodAthleteMember[] = roster
    .map((r) => {
      const vdot =
        r.vdotOverride && r.vdotOverride > 25
          ? Number(r.vdotOverride.toFixed(1))
          : estimateVdotFromThresholdPace(r.thresholdPaceSecsPerKm);
      const tPace = deriveThresholdPaceFromVdot(vdot);
      return {
        id: r.id,
        name: r.name,
        vdot,
        thresholdPaceSecsPerKm: tPace,
      };
    })
    .sort((a, b) => b.vdot - a.vdot);

  // Greedy VDOT tolerance clustering (width <= 3.0 VDOT points per pod, merged if > maxPods)
  const rawClusters: VdotPodAthleteMember[][] = [];
  for (const athlete of members) {
    const current = rawClusters[rawClusters.length - 1];
    if (!current) {
      rawClusters.push([athlete]);
      continue;
    }
    const anchorVdot = current[0].vdot;
    if (anchorVdot - athlete.vdot <= 3.0 || rawClusters.length >= maxPods) {
      current.push(athlete);
    } else {
      rawClusters.push([athlete]);
    }
  }

  const intensitySpec = INTENSITY_PACE_MULTIPLIERS[intensity];

  return rawClusters.map((group, idx) => {
    const vdots = group.map((g) => g.vdot);
    const maxVdot = Math.max(...vdots);
    const minVdot = Math.min(...vdots);
    const centerVdot = Number(
      (vdots.reduce((acc, v) => acc + v, 0) / Math.max(1, vdots.length)).toFixed(1)
    );
    const centerTPaceSecsPerKm = deriveThresholdPaceFromVdot(centerVdot);
    const targetPaceSecsPerKm = Number(
      (centerTPaceSecsPerKm * intensitySpec.paceMultiplierVsThreshold).toFixed(1)
    );

    const splitForMeters = (m: number) =>
      Number(((targetPaceSecsPerKm / 1000) * m).toFixed(1));

    const splitsSecs = {
      split200m: splitForMeters(200),
      split400m: splitForMeters(400),
      split800m: splitForMeters(800),
      split1000m: splitForMeters(1000),
      split1600m: splitForMeters(1600),
    };

    const targetRepSecs = splitForMeters(repDistanceMeters);
    const repDisplay = formatTrackMark(targetRepSecs, 1);
    const lap400Display = formatTrackMark(splitsSecs.split400m, 1);
    const podName = POD_TIERS[idx] || `Pod ${String.fromCharCode(65 + idx)}`;

    const workoutPrescriptionLine = `${repCount} x ${repDistanceMeters}m @ ${repDisplay} (${lap400Display}/400m · ${intensitySpec.label}) w/ ${recoveryLabel}`;
    const approxRepSecsRounded = Math.max(20, Math.round(targetRepSecs));
    const workoutSyntax = `Warmup\n- 15m 65%-74% Pace\n\nMain Set ${repCount}x\n- ${approxRepSecsRounded}s ${intensitySpec.pctFtpSyntax} (${repDistanceMeters}m @ ${repDisplay})\n- 60s 60% Pace (${recoveryLabel})\n\nCooldown\n- 10m 62%-70% Pace`;

    return {
      podId: `POD_${String.fromCharCode(65 + idx)}`,
      podName,
      minVdot,
      maxVdot,
      centerVdot,
      athletes: group,
      intensity,
      targetPaceSecsPerKm,
      splitsSecs,
      workoutPrescriptionLine,
      workoutSyntax,
    };
  });
}

/**
 * Formats a printable / clipboard-ready Trackside Coach Split Sheet across all pods.
 */
export function formatPrintablePodSplitSheet(
  workoutTitle: string,
  dateStr: string,
  pods: VdotTrainingPod[]
): string {
  const header = `THRESH TRACKSIDE POD SHEET — ${workoutTitle.toUpperCase()} (${dateStr})`;
  const divider = '='.repeat(Math.min(76, header.length));
  const lines = [header, divider];

  for (const pod of pods) {
    const names = pod.athletes.map((a) => `${a.name} (${a.vdot})`).join(', ');
    lines.push(
      `\n[${pod.podName}] VDOT ${pod.minVdot === pod.maxVdot ? pod.centerVdot : `${pod.minVdot}–${pod.maxVdot}`}`
    );
    lines.push(`  Athletes: ${names}`);
    lines.push(`  Target:   ${pod.workoutPrescriptionLine}`);
    lines.push(
      `  Splits:   200m ${formatTrackMark(pod.splitsSecs.split200m, 1)} | 400m ${formatTrackMark(
        pod.splitsSecs.split400m,
        1
      )} | 800m ${formatTrackMark(pod.splitsSecs.split800m, 1)} | 1000m ${formatTrackMark(
        pod.splitsSecs.split1000m,
        1
      )} | 1600m ${formatTrackMark(pod.splitsSecs.split1600m, 1)}`
    );
  }
  return lines.join('\n');
}

/**
 * Official NCAA Track Facility Indexing Factors (200m Flat -> Banked/Outdoor).
 * Official NCAA rule: flat 200m indoor tracks incur tighter turn radii; multiplying a flat mark
 * by < 1.0000 yields the equivalent Banked/Oversized/Outdoor championship qualifying index mark.
 */
const NCAA_FLAT_TO_BANKED_FACTORS: Record<
  'MEN' | 'WOMEN',
  Record<ScholasticTrackEventLabel, number>
> = {
  MEN: {
    '800m': 0.9857,
    '1500m': 0.9869,
    '1600m': 0.9869,
    Mile: 0.9869,
    '3000m': 0.9885,
    '3200m': 0.9885,
    '5000m': 0.9907,
    '10000m': 0.9925,
  },
  WOMEN: {
    '800m': 0.9872,
    '1500m': 0.9882,
    '1600m': 0.9882,
    Mile: 0.9882,
    '3000m': 0.9896,
    '3200m': 0.9896,
    '5000m': 0.9919,
    '10000m': 0.9935,
  },
};

/**
 * Converts a track mark across Indoor 200m Flat, Indoor 200m Banked/Oversized, and Outdoor 400m
 * facilities plus NCAA altitude adjustment (`>= 3,000 ft` elevation).
 */
export function convertNcaaTrackPerformance(params: {
  eventLabel: ScholasticTrackEventLabel;
  gender: 'MEN' | 'WOMEN';
  rawTimeSecs: number;
  fromFacility: NcaaTrackFacilityType;
  toFacility: NcaaTrackFacilityType;
  altitudeFeet?: number;
}): NcaaTrackConversionResult {
  const {
    eventLabel,
    gender,
    rawTimeSecs,
    fromFacility,
    toFacility,
    altitudeFeet = 0,
  } = params;

  const safeRaw = Math.max(10, rawTimeSecs);
  const flatFactor = NCAA_FLAT_TO_BANKED_FACTORS[gender][eventLabel];

  // Normalize facility to Banked/Outdoor baseline first, then project to target facility:
  // Note: NCAA treats 200m Banked/Oversized and 400m Outdoor as 1:1 equivalent for distance events,
  // with a tiny +0.18% aerodynamic/turn adjustment between indoor banked and outdoor 400m.
  let facilityMultiplier = 1.0;
  if (fromFacility === 'INDOOR_FLAT_200M' && toFacility !== 'INDOOR_FLAT_200M') {
    facilityMultiplier = flatFactor;
  } else if (fromFacility !== 'INDOOR_FLAT_200M' && toFacility === 'INDOOR_FLAT_200M') {
    facilityMultiplier = Number((1 / flatFactor).toFixed(4));
  } else if (fromFacility === 'INDOOR_BANKED_200M' && toFacility === 'OUTDOOR_400M') {
    facilityMultiplier = 0.9985;
  } else if (fromFacility === 'OUTDOOR_400M' && toFacility === 'INDOOR_BANKED_200M') {
    facilityMultiplier = 1.0015;
  }

  const afterFacilitySecs = safeRaw * facilityMultiplier;

  // NCAA Altitude Indexing (applies at >= 3,000 ft for >= 800m events; scales nonlinearly with distance & elevation)
  let altitudeAllowanceSecs = 0;
  if (altitudeFeet >= 3000) {
    const elevExcessKft = Math.min(6.0, (altitudeFeet - 3000) / 1000); // 0..6 kft above 3,000ft
    const distanceWeight =
      eventLabel === '800m'
        ? 0.0022
        : eventLabel === '1500m' || eventLabel === '1600m' || eventLabel === 'Mile'
          ? 0.0048
          : eventLabel === '3000m' || eventLabel === '3200m'
            ? 0.0062
            : 0.0072;
    const baseThresholdBonus =
      eventLabel === '800m' ? 0.003 : 0.0075;
    const altCreditFraction = baseThresholdBonus + elevExcessKft * distanceWeight;
    altitudeAllowanceSecs = Number((afterFacilitySecs * altCreditFraction).toFixed(2));
  }

  const convertedTimeSecs = Number(
    Math.max(10, afterFacilitySecs - altitudeAllowanceSecs).toFixed(2)
  );
  const deltaSecs = Number((convertedTimeSecs - safeRaw).toFixed(2));

  const ruleParts: string[] = [];
  if (facilityMultiplier !== 1.0) {
    ruleParts.push(`NCAA ${gender === 'MEN' ? "Men's" : "Women's"} facility factor ×${facilityMultiplier.toFixed(4)}`);
  } else {
    ruleParts.push('1.0000 facility parity');
  }
  if (altitudeAllowanceSecs > 0) {
    ruleParts.push(
      `−${altitudeAllowanceSecs.toFixed(2)}s NCAA altitude allowance (${Math.round(altitudeFeet).toLocaleString()} ft)`
    );
  }

  return {
    eventLabel,
    gender,
    rawTimeSecs: Number(safeRaw.toFixed(2)),
    fromFacility,
    toFacility,
    altitudeFeet,
    facilityMultiplier,
    altitudeAllowanceSecs,
    convertedTimeSecs,
    displayRawTime: formatTrackMark(safeRaw, 2),
    displayConvertedTime: formatTrackMark(convertedTimeSecs, 2),
    deltaSecs,
    ncaaRuleSummary: ruleParts.join(' · '),
  };
}

/**
 * Representative High School Championship & NCAA D1/D2/D3 Recruiting Benchmark Standards (in seconds).
 */
const RECRUITING_STANDARDS_SECS: Record<
  'MEN' | 'WOMEN',
  Record<
    ScholasticTrackEventLabel,
    {
      HS_STATE: number;
      HS_NATIONALS: number;
      NCAA_D3_RECRUIT: number;
      NCAA_D2_SCHOLARSHIP: number;
      NCAA_D1_WALK_ON: number;
      NCAA_D1_SCHOLARSHIP: number;
    }
  >
> = {
  MEN: {
    '800m': {
      HS_STATE: 116.5, // 1:56.50
      NCAA_D3_RECRUIT: 115.0, // 1:55.00
      NCAA_D2_SCHOLARSHIP: 112.5, // 1:52.50
      HS_NATIONALS: 112.0, // 1:52.00
      NCAA_D1_WALK_ON: 111.5, // 1:51.50
      NCAA_D1_SCHOLARSHIP: 109.0, // 1:49.00
    },
    '1500m': {
      HS_STATE: 242.0, // 4:02.00
      NCAA_D3_RECRUIT: 238.0, // 3:58.00
      NCAA_D2_SCHOLARSHIP: 232.0, // 3:52.00
      HS_NATIONALS: 231.0, // 3:51.00
      NCAA_D1_WALK_ON: 230.0, // 3:50.00
      NCAA_D1_SCHOLARSHIP: 224.0, // 3:44.00
    },
    '1600m': {
      HS_STATE: 258.0, // 4:18.00
      NCAA_D3_RECRUIT: 255.0, // 4:15.00
      NCAA_D2_SCHOLARSHIP: 249.0, // 4:09.00
      HS_NATIONALS: 248.0, // 4:08.00
      NCAA_D1_WALK_ON: 247.0, // 4:07.00
      NCAA_D1_SCHOLARSHIP: 241.5, // 4:01.50
    },
    Mile: {
      HS_STATE: 259.6, // 4:19.60
      NCAA_D3_RECRUIT: 256.5, // 4:16.50
      NCAA_D2_SCHOLARSHIP: 250.5, // 4:10.50
      HS_NATIONALS: 249.5, // 4:09.50
      NCAA_D1_WALK_ON: 248.5, // 4:08.50
      NCAA_D1_SCHOLARSHIP: 243.0, // 4:03.00
    },
    '3000m': {
      HS_STATE: 525.0, // 8:45.00
      NCAA_D3_RECRUIT: 515.0, // 8:35.00
      NCAA_D2_SCHOLARSHIP: 500.0, // 8:20.00
      HS_NATIONALS: 498.0, // 8:18.00
      NCAA_D1_WALK_ON: 495.0, // 8:15.00
      NCAA_D1_SCHOLARSHIP: 482.0, // 8:02.00
    },
    '3200m': {
      HS_STATE: 562.0, // 9:22.00
      NCAA_D3_RECRUIT: 552.0, // 9:12.00
      NCAA_D2_SCHOLARSHIP: 538.0, // 8:58.00
      HS_NATIONALS: 534.0, // 8:54.00
      NCAA_D1_WALK_ON: 532.0, // 8:52.00
      NCAA_D1_SCHOLARSHIP: 520.0, // 8:40.00
    },
    '5000m': {
      HS_STATE: 930.0, // 15:30.00
      NCAA_D3_RECRUIT: 895.0, // 14:55.00
      HS_NATIONALS: 885.0, // 14:45.00
      NCAA_D2_SCHOLARSHIP: 868.0, // 14:28.00
      NCAA_D1_WALK_ON: 860.0, // 14:20.00
      NCAA_D1_SCHOLARSHIP: 835.0, // 13:55.00
    },
    '10000m': {
      HS_STATE: 1960.0, // 32:40
      NCAA_D3_RECRUIT: 1875.0, // 31:15
      HS_NATIONALS: 1860.0, // 31:00
      NCAA_D2_SCHOLARSHIP: 1810.0, // 30:10
      NCAA_D1_WALK_ON: 1790.0, // 29:50
      NCAA_D1_SCHOLARSHIP: 1735.0, // 28:55
    },
  },
  WOMEN: {
    '800m': {
      HS_STATE: 136.0, // 2:16.00
      NCAA_D3_RECRUIT: 135.0, // 2:15.00
      NCAA_D2_SCHOLARSHIP: 131.5, // 2:11.50
      HS_NATIONALS: 130.5, // 2:10.50
      NCAA_D1_WALK_ON: 130.0, // 2:10.00
      NCAA_D1_SCHOLARSHIP: 126.5, // 2:06.50
    },
    '1500m': {
      HS_STATE: 282.0, // 4:42.00
      NCAA_D3_RECRUIT: 278.0, // 4:38.00
      NCAA_D2_SCHOLARSHIP: 270.0, // 4:30.00
      HS_NATIONALS: 268.0, // 4:28.00
      NCAA_D1_WALK_ON: 266.0, // 4:26.00
      NCAA_D1_SCHOLARSHIP: 258.0, // 4:18.00
    },
    '1600m': {
      HS_STATE: 302.0, // 5:02.00
      NCAA_D3_RECRUIT: 298.0, // 4:58.00
      NCAA_D2_SCHOLARSHIP: 290.0, // 4:50.00
      HS_NATIONALS: 287.0, // 4:47.00
      NCAA_D1_WALK_ON: 286.0, // 4:46.00
      NCAA_D1_SCHOLARSHIP: 278.0, // 4:38.00
    },
    Mile: {
      HS_STATE: 304.0, // 5:04.00
      NCAA_D3_RECRUIT: 300.0, // 5:00.00
      NCAA_D2_SCHOLARSHIP: 292.0, // 4:52.00
      HS_NATIONALS: 289.0, // 4:49.00
      NCAA_D1_WALK_ON: 288.0, // 4:48.00
      NCAA_D1_SCHOLARSHIP: 280.0, // 4:40.00
    },
    '3000m': {
      HS_STATE: 615.0, // 10:15.00
      NCAA_D3_RECRUIT: 605.0, // 10:05.00
      NCAA_D2_SCHOLARSHIP: 585.0, // 9:45.00
      HS_NATIONALS: 580.0, // 9:40.00
      NCAA_D1_WALK_ON: 575.0, // 9:35.00
      NCAA_D1_SCHOLARSHIP: 555.0, // 9:15.00
    },
    '3200m': {
      HS_STATE: 658.0, // 10:58.00
      NCAA_D3_RECRUIT: 648.0, // 10:48.00
      NCAA_D2_SCHOLARSHIP: 628.0, // 10:28.00
      HS_NATIONALS: 620.0, // 10:20.00
      NCAA_D1_WALK_ON: 618.0, // 10:18.00
      NCAA_D1_SCHOLARSHIP: 598.0, // 9:58.00
    },
    '5000m': {
      HS_STATE: 1095.0, // 18:15.00
      NCAA_D3_RECRUIT: 1060.0, // 17:40.00
      HS_NATIONALS: 1035.0, // 17:15.00
      NCAA_D2_SCHOLARSHIP: 1025.0, // 17:05.00
      NCAA_D1_WALK_ON: 1005.0, // 16:45.00
      NCAA_D1_SCHOLARSHIP: 970.0, // 16:10.00
    },
    '10000m': {
      HS_STATE: 2310.0, // 38:30
      NCAA_D3_RECRUIT: 2220.0, // 37:00
      HS_NATIONALS: 2190.0, // 36:30
      NCAA_D2_SCHOLARSHIP: 2130.0, // 35:30
      NCAA_D1_WALK_ON: 2085.0, // 34:45
      NCAA_D1_SCHOLARSHIP: 2010.0, // 33:30
    },
  },
};

/**
 * Compares an athlete's NCAA-indexed track mark against HS State, HS Nationals,
 * and NCAA D3 / D2 / D1 Recruiting & Scholarship benchmarks.
 */
export function evaluateRecruitingStandards(params: {
  eventLabel: ScholasticTrackEventLabel;
  gender: 'MEN' | 'WOMEN';
  convertedTimeSecs: number;
}): RecruitingStandardComparison[] {
  const { eventLabel, gender, convertedTimeSecs } = params;
  const table = RECRUITING_STANDARDS_SECS[gender][eventLabel];

  const orderedTiers: {
    id: RecruitingStandardComparison['tierId'];
    label: string;
  }[] = [
    { id: 'HS_STATE', label: 'HS State Championship Qualifier' },
    { id: 'NCAA_D3_RECRUIT', label: 'NCAA D3 Impact Recruit' },
    { id: 'NCAA_D2_SCHOLARSHIP', label: 'NCAA D2 Scholarship Target' },
    { id: 'HS_NATIONALS', label: 'HS Nationals (Nike / New Balance)' },
    { id: 'NCAA_D1_WALK_ON', label: 'NCAA D1 Roster / Walk-On' },
    { id: 'NCAA_D1_SCHOLARSHIP', label: 'NCAA D1 Scholarship Standard' },
  ];

  return orderedTiers.map((tier) => {
    const stdSecs = table[tier.id];
    const gapSecs = Number((convertedTimeSecs - stdSecs).toFixed(2));
    const achieved = gapSecs <= 0;
    const ratio = stdSecs / Math.max(1, convertedTimeSecs);
    const progressPct = Math.max(40, Math.min(100, Math.round(ratio * 100)));

    return {
      tierId: tier.id,
      tierLabel: tier.label,
      standardSecs: stdSecs,
      displayStandard: formatTrackMark(stdSecs, 2),
      athleteConvertedSecs: convertedTimeSecs,
      gapSecs,
      achieved,
      progressPct,
    };
  });
}

const MODALITY_SPECS: Record<
  CrossTrainingModality,
  {
    label: string;
    minsPerRunMileAtModRpe: number;
    impactSavedPct: number;
    tssPerHourAtRpe6: number;
    note: string;
  }
> = {
  AQUA_JOGGING: {
    label: 'Deep-Water Aqua Jogging',
    minsPerRunMileAtModRpe: 9.0,
    impactSavedPct: 100,
    tssPerHourAtRpe6: 58,
    note: 'Zero tibial axial load; use cadence belt or tetherless form >175 spm for neuromuscular specificity.',
  },
  ALTER_G: {
    label: 'AlterG Anti-Gravity Treadmill (75% BW)',
    minsPerRunMileAtModRpe: 7.4,
    impactSavedPct: 62,
    tssPerHourAtRpe6: 66,
    note: 'Preserves running gait mechanics while cutting peak tibial ground-reaction force by ~60%.',
  },
  ELLIPTICAL: {
    label: 'High-Cadence Elliptical (90+ RPM)',
    minsPerRunMileAtModRpe: 8.5,
    impactSavedPct: 96,
    tssPerHourAtRpe6: 60,
    note: 'Maintain upright hip extension at 90–95 strides/min to mirror aerobic running stroke volume.',
  },
  ARC_TRAINER: {
    label: 'Cybex Arc Trainer',
    minsPerRunMileAtModRpe: 8.2,
    impactSavedPct: 96,
    tssPerHourAtRpe6: 64,
    note: 'High hip-flexor & glute recruitment with near-zero distal bone-stress impact.',
  },
  STATIONARY_BIKE: {
    label: 'Indoor Smart / Spin Bike (90+ RPM)',
    minsPerRunMileAtModRpe: 10.0,
    impactSavedPct: 100,
    tssPerHourAtRpe6: 62,
    note: '10:1 min-to-virtual-mile rule; keep cadence >90 rpm to emphasize central cardiac output over quad torque.',
  },
};

/**
 * Computes "Training Room Cross-Training -> Virtual Running Miles" equivalence for injured or
 * load-managed student-athletes so CTL and weekly team volume stay coherent without bone impact.
 */
export function computeCrossTrainingEquivalence(params: {
  modality: CrossTrainingModality;
  durationMins: number;
  rpe: number;
}): CrossTrainingEquivalence {
  const { modality, durationMins, rpe } = params;
  const safeMins = Math.max(5, Math.min(300, durationMins));
  const safeRpe = Math.max(1, Math.min(10, rpe));
  const spec = MODALITY_SPECS[modality];

  // Intensity factor scales virtual mileage & TSS around RPE 6 baseline
  const rpeFactor = 0.72 + safeRpe * 0.048; // 1.008 at RPE 6, 1.104 at RPE 8
  const rawMiles = (safeMins / spec.minsPerRunMileAtModRpe) * rpeFactor;
  const equivalentRunMiles = Number(rawMiles.toFixed(1));
  const equivalentRunKm = Number((rawMiles * 1.60934).toFixed(1));
  const estimatedSystemicTss = Math.round(
    (safeMins / 60) * spec.tssPerHourAtRpe6 * rpeFactor * rpeFactor
  );
  const caraCountableHours = Number((safeMins / 60).toFixed(2));

  return {
    modality,
    modalityLabel: spec.label,
    durationMins: safeMins,
    rpe: safeRpe,
    equivalentRunKm,
    equivalentRunMiles,
    estimatedSystemicTss,
    impactLoadSavedPct: spec.impactSavedPct,
    caraCountableHours,
    coachingNote: spec.note,
  };
}

/**
 * Audits rolling 7-day training volume against NCAA Bylaw 17.1 Countable Athletically Related
 * Activities (CARA: 20 hours/week max in-season, 4 hours/day max).
 */
export function summarizeNcaaCaraWeeklyHours(
  activities: UnifiedActivity[],
  referenceDateStr?: string,
  extraStrengthOrMeetingHours = 0
): NcaaCaraWeeklyAudit {
  const refMs = referenceDateStr
    ? new Date(`${referenceDateStr.slice(0, 10)}T23:59:59Z`).getTime()
    : Date.now();
  const startMs = refMs - 7 * 86400 * 1000;

  const hoursByDay = new Map<string, number>();
  let totalSecs = 0;

  for (const act of activities) {
    if (!act?.startDateLocal) continue;
    const tMs = new Date(act.startDateLocal).getTime();
    if (Number.isNaN(tMs) || tMs <= startMs || tMs > refMs) continue;
    const dayKey = act.startDateLocal.slice(0, 10);
    const secs = Math.max(0, act.movingTimeSecs || 0);
    totalSecs += secs;
    hoursByDay.set(dayKey, (hoursByDay.get(dayKey) || 0) + secs / 3600);
  }

  const rolling7dCountableHours = Number(
    (totalSecs / 3600 + Math.max(0, extraStrengthOrMeetingHours)).toFixed(2)
  );
  const maxSingleDayHours = Number(
    Math.max(0, ...Array.from(hoursByDay.values())).toFixed(2)
  );
  const weeklyCapHours = 20;
  const dailyCapHours = 4;
  const remainingWeeklyHours = Number(
    Math.max(0, weeklyCapHours - rolling7dCountableHours).toFixed(2)
  );
  const compliant =
    rolling7dCountableHours <= weeklyCapHours && maxSingleDayHours <= dailyCapHours;

  const statusLabel = !compliant
    ? rolling7dCountableHours > weeklyCapHours
      ? `Exceeds 20h NCAA CARA Cap (${rolling7dCountableHours}h)`
      : `Exceeds 4h Single-Day CARA Cap (${maxSingleDayHours}h)`
    : rolling7dCountableHours >= 17.5
      ? `Near 20h Cap (${remainingWeeklyHours}h remaining)`
      : `NCAA CARA Compliant (${rolling7dCountableHours}h / 20h)`;

  return {
    rolling7dCountableHours,
    weeklyCapHours,
    maxSingleDayHours,
    dailyCapHours,
    remainingWeeklyHours,
    compliant,
    statusLabel,
  };
}

/**
 * Evaluates a High School or Collegiate Student-Athlete Check-In for Bone Stress Injury (BSI)
 * red flags, Serum Ferritin iron-depletion thresholds (`< 30 ng/mL`), and Academic/Exam stress spikes.
 */
export function evaluateStudentAthleteGuardrail(
  checkIn: StudentAthleteCheckIn
): StudentAthleteGuardrailResult {
  const flags: string[] = [];

  if (checkIn.shinMetatarsalSoreness >= 2) {
    flags.push(`Focal shin/metatarsal tenderness (${checkIn.shinMetatarsalSoreness}/3)`);
  }
  if (checkIn.achillesTendonSoreness >= 2) {
    flags.push(`Achilles/calf tendon soreness (${checkIn.achillesTendonSoreness}/3)`);
  }
  if (checkIn.ferritinNgMl !== undefined && checkIn.ferritinNgMl > 0 && checkIn.ferritinNgMl < 30) {
    flags.push(`Low serum ferritin (${checkIn.ferritinNgMl} ng/mL < 30 ng/mL endurance floor)`);
  }
  if (checkIn.academicStress >= 4) {
    flags.push(`High academic/exam load (${checkIn.academicStress}/5)`);
  }
  if (checkIn.sleepHours < 6.5) {
    flags.push(`Sleep debt (${checkIn.sleepHours.toFixed(1)}h < 6.5h student-athlete floor)`);
  }

  // Priority 1: Focal Bone-Stress Injury (BSI) or Severe Tendon Stop
  if (checkIn.shinMetatarsalSoreness >= 2 || checkIn.achillesTendonSoreness >= 3) {
    return {
      status: 'BONE_STRESS_STOP',
      headline: 'Bone-Stress Guardrail Triggered — Zero-Impact Cross-Training Swap Required',
      recommendation:
        'Focal shin, tibial, or metatarsal tenderness >= 2/3 is a primary Bone Stress Injury (BSI) warning sign. Hold impact running/spikes today, route to Athletic Trainer evaluation, and substitute Aqua Jogging or Stationary Bike.',
      intensityScalePct: 0,
      suggestCrossTrainingSwap: true,
      flags,
    };
  }

  // Priority 2: Iron / Serum Ferritin Depletion Caution
  if (checkIn.ferritinNgMl !== undefined && checkIn.ferritinNgMl > 0 && checkIn.ferritinNgMl < 30) {
    const severeIron = checkIn.ferritinNgMl < 20;
    return {
      status: 'IRON_DEPLETION_CAUTION',
      headline: severeIron
        ? `Severe Iron Depletion Alert (Ferritin ${checkIn.ferritinNgMl} ng/mL)`
        : `Sub-Optimal Ferritin Reserve (${checkIn.ferritinNgMl} ng/mL)`,
      recommendation:
        'Serum ferritin < 30 ng/mL blunts erythropoiesis and mitochondrial enzymes in endurance runners, causing elevated HR at threshold. Cap VO2/anaerobic reps at controlled Threshold/CV effort and review iron protocol with team physician.',
      intensityScalePct: severeIron ? 78 : 88,
      suggestCrossTrainingSwap: false,
      flags,
    };
  }

  // Priority 3: Midterms / Finals Academic & Sleep Allostatic Load Modulation
  if (
    checkIn.academicStress >= 4 ||
    checkIn.sleepHours < 6.2 ||
    (checkIn.academicStress >= 3 && checkIn.energyFeel === 'FLAT') ||
    checkIn.achillesTendonSoreness === 2
  ) {
    return {
      status: 'ACADEMIC_MODULATION',
      headline: 'Exam / Allostatic Stress Modulation — Down-Scale Volume & Protect Recovery',
      recommendation:
        'Academic exam stress shares the same HPA-axis cortisol budget as VO2max intervals. Trim main-set volume by ~15–20% or shift to controlled Rhythm/CV pace (RPE <= 7) so you absorb fitness without illness.',
      intensityScalePct: 84,
      suggestCrossTrainingSwap: checkIn.achillesTendonSoreness === 2,
      flags,
    };
  }

  return {
    status: 'CLEARED_FULL_WORKOUT',
    headline: 'Cleared for Full Pod Prescription',
    recommendation:
      'Orthopedic, sleep, and academic stress markers are green. Execute assigned VDOT pod splits with relaxed mechanics.',
    intensityScalePct: 100,
    suggestCrossTrainingSwap: false,
    flags,
  };
}

const STANDARD_TRACK_REP_METERS = [200, 300, 400, 500, 600, 800, 1000, 1200, 1500, 1600, 2000, 3000, 3200];

function snapToNearestTrackDistanceLabel(distanceMeters: number): string | null {
  if (distanceMeters < 150) return null;
  for (const target of STANDARD_TRACK_REP_METERS) {
    const relErr = Math.abs(distanceMeters - target) / target;
    if (relErr <= 0.085) {
      return `~${target}m`;
    }
  }
  return null;
}

/**
 * Threshold-free + threshold-aware 1Hz Change-Point & Bimodal Hysteresis Detector
 * ("Forgot-to-Lap Recovery"). Extracts clean WORK and RECOVERY reps from unstructured
 * track repeats (`12x200m`, `8x400m`, `6x1000m`), fartleks, or cycling intervals even
 * when the athlete never pressed the watch Lap button.
 */
export function autoDetectUnstructuredIntervals(
  streams: ActivityStreamSet,
  sportCategory: SportCategory = 'Running',
  options?: {
    ftpWatts?: number;
    thresholdPaceSecsPerKm?: number;
    minWorkDurationSecs?: number;
  }
): ActivityInterval[] {
  const time = streams.time || [];
  if (time.length < 30) return [];

  const watts = streams.watts;
  const vel = streams.velocitySmooth;
  const hr = streams.heartrate;
  const cad = streams.cadence;

  const hasWatts = Boolean(
    watts &&
      watts.length === time.length &&
      (sportCategory === 'Cycling' || watts.filter((w) => w > 40).length > time.length * 0.3)
  );
  const hasVel = Boolean(
    vel && vel.length === time.length && vel.filter((v) => v > 0.8).length > time.length * 0.2
  );

  if (!hasWatts && !hasVel) return [];

  // 1. Build 5-second smoothed effort signal (watts or m/s) for crisp edge transitions
  const smoothed: number[] = new Array(time.length);
  for (let i = 0; i < time.length; i++) {
    let sum = 0;
    let cnt = 0;
    const lo = Math.max(0, i - 2);
    const hi = Math.min(time.length - 1, i + 2);
    for (let j = lo; j <= hi; j++) {
      const val = hasWatts ? Math.max(0, watts![j] || 0) : Math.max(0, vel![j] || 0);
      sum += val;
      cnt++;
    }
    smoothed[i] = cnt > 0 ? sum / cnt : 0;
  }

  // 2. Compute empirical distribution quantiles on moving samples to detect bimodal interval sessions
  const activeSamples = smoothed
    .filter((v) => (hasWatts ? v > 35 : v > 1.2))
    .slice()
    .sort((a, b) => a - b);
  if (activeSamples.length < 25) return [];

  const quantile = (q: number) =>
    activeSamples[Math.min(activeSamples.length - 1, Math.max(0, Math.floor(q * activeSamples.length)))];

  const p30 = quantile(0.3);
  const p50 = quantile(0.5);
  const p82 = quantile(0.82);
  const p92 = quantile(0.92);

  // Require meaningful contrast between recovery/jog and work surges (>15% spread)
  const spreadRatio = p82 / Math.max(0.1, p30);
  const minRequiredSpread = hasWatts ? 1.25 : 1.16;
  if (spreadRatio < minRequiredSpread) {
    return [];
  }

  // Dynamic hysteresis bands blended with athlete threshold if calibrated
  const calibratedRef = hasWatts
    ? options?.ftpWatts && options.ftpWatts > 90
      ? options.ftpWatts * 0.9
      : 0
    : options?.thresholdPaceSecsPerKm && options.thresholdPaceSecsPerKm > 120
      ? (1000 / options.thresholdPaceSecsPerKm) * 0.94
      : 0;

  const empiricalEntry = p50 + (p92 - p50) * 0.42;
  const workEntry =
    calibratedRef > 0 ? Math.min(empiricalEntry, calibratedRef) : empiricalEntry;
  const recoveryExit = workEntry * (hasWatts ? 0.84 : 0.88);

  const minWorkSecs = options?.minWorkDurationSecs ?? 18; // Captures 200m track reps (~24-36s)
  const minRecSecs = 15;

  // 3. Two-state hysteresis segmentation
  interface RawSeg {
    startIdx: number;
    endIdx: number;
    isWork: boolean;
  }
  const rawSegs: RawSeg[] = [];
  let inWork = smoothed[0] >= workEntry;
  let segStart = 0;

  for (let i = 1; i < time.length; i++) {
    const v = smoothed[i];
    const switchToWork = !inWork && v >= workEntry;
    const switchToRec = inWork && v <= recoveryExit;

    if (switchToWork || switchToRec) {
      const dur = (time[i] || 0) - (time[segStart] || 0);
      const minDur = inWork ? minWorkSecs : minRecSecs;
      if (dur >= minDur) {
        rawSegs.push({ startIdx: segStart, endIdx: i - 1, isWork: inWork });
        segStart = i;
        inWork = !inWork;
      }
    }
  }
  const tailDur = (time[time.length - 1] || 0) - (time[segStart] || 0);
  if (tailDur >= (inWork ? minWorkSecs : minRecSecs)) {
    rawSegs.push({ startIdx: segStart, endIdx: time.length - 1, isWork: inWork });
  }

  // Merge adjacent identical states if any micro-bounces were skipped
  const mergedSegs: RawSeg[] = [];
  for (const seg of rawSegs) {
    const prev = mergedSegs[mergedSegs.length - 1];
    if (prev && prev.isWork === seg.isWork) {
      prev.endIdx = seg.endIdx;
    } else {
      mergedSegs.push({ ...seg });
    }
  }

  const workCount = mergedSegs.filter((s) => s.isWork).length;
  if (workCount === 0) return [];

  const safeFtp = Math.max(110, options?.ftpWatts || 260);
  const safeThresholdMps =
    options?.thresholdPaceSecsPerKm && options.thresholdPaceSecsPerKm > 120
      ? 1000 / options.thresholdPaceSecsPerKm
      : p82 * 0.94;

  let wIdx = 0;
  let rIdx = 0;
  const intervals: ActivityInterval[] = [];

  for (const seg of mergedSegs) {
    const startT = time[seg.startIdx] || 0;
    const endT = time[seg.endIdx] || startT;
    const durSecs = Math.max(1, Math.round(endT - startT + 1));

    const sliceW = hasWatts ? watts!.slice(seg.startIdx, seg.endIdx + 1) : [];
    const avgWatts =
      sliceW.length > 0
        ? Math.round(sliceW.reduce((a, b) => a + (b || 0), 0) / sliceW.length)
        : undefined;

    const sliceVel = vel ? vel.slice(seg.startIdx, seg.endIdx + 1).filter((v) => v > 0.3) : [];
    const meanVel =
      sliceVel.length > 0 ? sliceVel.reduce((a, b) => a + b, 0) / sliceVel.length : undefined;
    const avgPaceSecsPerKm = meanVel && meanVel > 0.5 ? Math.round(1000 / meanVel) : undefined;

    const distMeters =
      streams.distance &&
      streams.distance[seg.endIdx] != null &&
      streams.distance[seg.startIdx] != null
        ? Math.max(0, Math.round(streams.distance[seg.endIdx] - streams.distance[seg.startIdx]))
        : meanVel
          ? Math.round(meanVel * durSecs)
          : 0;

    const sliceHr = hr ? hr.slice(seg.startIdx, seg.endIdx + 1).filter((v) => v > 40) : [];
    const avgHr =
      sliceHr.length > 0
        ? Math.round(sliceHr.reduce((a, b) => a + b, 0) / sliceHr.length)
        : undefined;
    const maxHr = sliceHr.length > 0 ? Math.max(...sliceHr) : undefined;

    const sliceCad = cad ? cad.slice(seg.startIdx, seg.endIdx + 1).filter((v) => v > 20) : [];
    const avgCadence =
      sliceCad.length > 0
        ? Math.round(sliceCad.reduce((a, b) => a + b, 0) / sliceCad.length)
        : undefined;

    const intensityPct = avgWatts
      ? Math.round((avgWatts / safeFtp) * 100)
      : meanVel
        ? Math.round((meanVel / Math.max(1.5, safeThresholdMps)) * 100)
        : undefined;

    if (seg.isWork) {
      wIdx++;
      const snappedTrack =
        sportCategory === 'Running' ? snapToNearestTrackDistanceLabel(distMeters) : null;
      intervals.push({
        id: `auto-rep-${intervals.length + 1}`,
        type: 'WORK',
        label: snappedTrack ? `Auto-Rep #${wIdx} (${snappedTrack})` : `Auto-Rep #${wIdx}`,
        startTimeSecs: Math.round(startT),
        durationSecs: durSecs,
        distanceMeters: distMeters,
        avgWatts,
        weightedAvgWatts: avgWatts ? Math.round(avgWatts * 1.02) : undefined,
        intensityPct,
        zone: intensityPct && intensityPct >= 105 ? 5 : 4,
        avgHr,
        maxHr,
        avgPaceSecsPerKm,
        gapPaceSecsPerKm: avgPaceSecsPerKm,
        avgCadence,
      });
    } else {
      rIdx++;
      const isWarmup = intervals.length === 0 && durSecs >= 180;
      const isCooldown = seg === mergedSegs[mergedSegs.length - 1] && durSecs >= 180;
      intervals.push({
        id: `auto-rec-${intervals.length + 1}`,
        type: 'RECOVERY',
        label: isWarmup ? 'Warmup' : isCooldown ? 'Cooldown' : `Float / Jog #${rIdx}`,
        startTimeSecs: Math.round(startT),
        durationSecs: durSecs,
        distanceMeters: distMeters,
        avgWatts,
        intensityPct,
        zone: 2,
        avgHr,
        maxHr,
        avgPaceSecsPerKm,
        gapPaceSecsPerKm: avgPaceSecsPerKm,
        avgCadence,
      });
    }
  }

  return intervals;
}
