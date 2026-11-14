import type { UnifiedActivity, UnifiedWellnessDay } from '../types';

export type GarminLoadFocus = 'LOW_AEROBIC' | 'HIGH_AEROBIC' | 'ANAEROBIC';

export interface GarminLoadFocusMeta {
  type: GarminLoadFocus;
  label: 'Low Aerobic' | 'High Aerobic' | 'Anaerobic';
  shortLabel: 'Low Aer' | 'High Aer' | 'Anaerobic';
  barColor: string;
  solidColor: string;
  badgeBg: string;
}

export const GARMIN_LOAD_FOCUS_META: Record<GarminLoadFocus, GarminLoadFocusMeta> = {
  LOW_AEROBIC: {
    type: 'LOW_AEROBIC',
    label: 'Low Aerobic',
    shortLabel: 'Low Aer',
    barColor: 'rgba(13, 148, 136, 0.90)',
    solidColor: '#0D9488',
    badgeBg: 'rgba(13, 148, 136, 0.14)',
  },
  HIGH_AEROBIC: {
    type: 'HIGH_AEROBIC',
    label: 'High Aerobic',
    shortLabel: 'High Aer',
    barColor: 'rgba(234, 88, 12, 0.92)',
    solidColor: '#EA580C',
    badgeBg: 'rgba(234, 88, 12, 0.15)',
  },
  ANAEROBIC: {
    type: 'ANAEROBIC',
    label: 'Anaerobic',
    shortLabel: 'Anaerobic',
    barColor: 'rgba(124, 58, 237, 0.90)',
    solidColor: '#7C3AED',
    badgeBg: 'rgba(124, 58, 237, 0.15)',
  },
};

export interface ActivityLoadSegment {
  activityId: string;
  activityName: string;
  sportCategory?: string;
  load: number;
  rawActivityLoad: number;
  focus: GarminLoadFocusMeta;
  activity?: UnifiedActivity;
}

export interface GarminClassifyOptions {
  ftp?: number;
  lthr?: number;
  maxHr?: number;
  thresholdPaceSecsPerKm?: number;
}

export interface PMCDayPoint {
  date: string;
  ctl: number;
  atl: number;
  tsb: number;
  tss: number;
  eftp: number;
  rampRate: number;
  activities: UnifiedActivity[];
  segments?: ActivityLoadSegment[];
  classifyOpts?: GarminClassifyOptions;
  wellness?: UnifiedWellnessDay;
}

/**
 * Classifies a single workout into Garmin's Training Load Focus channels:
 * - Low Aerobic (Z1/Z2 Recovery, Base, Endurance, Warmup, Cooldown) -> Aerobic Teal (#0d9488)
 * - High Aerobic (Z3/Z4 Tempo, Sweet Spot, Lactate Threshold, Cruise Intervals) -> Thresh Vermilion (#ea580c)
 * - Anaerobic (Z5–Z6 VO2max, Anaerobic Capacity, Track Repeats, Sprints, Crit/Zwift Races, HIIT) -> Deep Violet (#7c3aed)
 */
export function classifyActivityGarminLoad(
  activity: UnifiedActivity,
  opts?: GarminClassifyOptions
): GarminLoadFocusMeta {
  const name = String(activity.name || '').trim();
  const ftp = opts?.ftp && opts.ftp > 80 ? opts.ftp : 300;
  const lthr = opts?.lthr && opts.lthr > 110 ? opts.lthr : 168;
  const athleteMaxHr = opts?.maxHr && opts.maxHr > 140 ? opts.maxHr : 190;
  const explicitLoad = Number(activity.trainingLoad ?? (activity as any).tss ?? 0);

  const hasHighIntensityTitleKeyword =
    /\b(race|interval|intervals|tempo|threshold|vo2|vo2max|anaerobic|sprint|sprints|track|crit|criterium|hiit|over-under|over\/under|sweet\s*spot|\bsst\b|time trial|\btt\b)\b/i.test(
      name
    );

  // 1. Explicit Warmup / Cooldown / Recovery / Easy / Z1-Z2 Base Title Intent or very short <= 12 TSS spin/commute
  if (
    !hasHighIntensityTitleKeyword &&
    (/\b(warmup|warm-up|warm up|cooldown|cool-down|cool down|recovery|shakeout|easy|zone 1|zone 2|\bz1\b|\bz2\b|base|endurance spin|aerobic spin|commute|walk|yoga|mobility|stretch|stretching|foundation)\b/i.test(
      name
    ) ||
      (explicitLoad > 0 && explicitLoad <= 14 && (activity.movingTimeSecs || 0) <= 1800))
  ) {
    return GARMIN_LOAD_FOCUS_META.LOW_AEROBIC;
  }

  // 2. Explicit Anaerobic / Race / Track / Sprint / VO2max Title Intent
  if (
    /\b(anaerobic|sprint|sprints|track|crit|criterium|hiit|zwift\s*-\s*race|zwift race|\brace\b|vo2|vo2max|microburst|microbursts|tabata|30\/30|40\/20|40\/15|attack|attacks|opener|openers|200m|400m|800m|wingate|neuromuscular|all-out)\b/i.test(
      name
    )
  ) {
    return GARMIN_LOAD_FOCUS_META.ANAEROBIC;
  }

  // 3. Explicit High Aerobic (Tempo / Sweet Spot / Threshold / Cruise / Structured Virtual Cycling Session) Title Intent
  if (
    /\b(tempo|sweet\s*spot|\bsweetspot\b|\bsst\b|threshold|\blt1\b|\blt2\b|lactate|cruise|over-under|over\/under|time trial|\btt\b|half marathon|marathon pace|progression|virtual cycling session)\b/i.test(
      name
    )
  ) {
    return GARMIN_LOAD_FOCUS_META.HIGH_AEROBIC;
  }

  // 4. Time-in-Zones Inspection (Power preferred when present, then Pace, then Heart Rate)
  const pwrZones = activity.zoneSecs?.power || [];
  const paceZones = activity.zoneSecs?.pace || [];
  const hrZones = activity.zoneSecs?.hr || [];
  const totalPwrSecs = pwrZones.reduce((s, v) => s + (v || 0), 0);
  const totalPaceSecs = paceZones.reduce((s, v) => s + (v || 0), 0);
  const totalHrSecs = hrZones.reduce((s, v) => s + (v || 0), 0);

  if (totalPwrSecs > 60) {
    const z3z4 = (pwrZones[2] || 0) + (pwrZones[3] || 0);
    const z5Plus = (pwrZones[4] || 0) + (pwrZones[5] || 0) + (pwrZones[6] || 0);
    const z6z7 = (pwrZones[5] || 0) + (pwrZones[6] || 0);

    if (
      z6z7 / totalPwrSecs >= 0.05 ||
      z5Plus / totalPwrSecs >= 0.14 ||
      (z5Plus / totalPwrSecs >= 0.09 && z5Plus >= z3z4 * 0.7)
    ) {
      return GARMIN_LOAD_FOCUS_META.ANAEROBIC;
    }
    if ((z3z4 + z5Plus) / totalPwrSecs >= 0.30 || z3z4 / totalPwrSecs >= 0.25) {
      return GARMIN_LOAD_FOCUS_META.HIGH_AEROBIC;
    }
    return GARMIN_LOAD_FOCUS_META.LOW_AEROBIC;
  }

  if (totalPaceSecs > 60 || totalHrSecs > 60) {
    const z = totalPaceSecs > 60 ? paceZones : hrZones;
    const totalZ = totalPaceSecs > 60 ? totalPaceSecs : totalHrSecs;
    const z3z4 = (z[2] || 0) + (z[3] || 0);
    const z5Plus = (z[4] || 0) + (z[5] || 0) + (z[6] || 0);
    const z6z7 = (z[5] || 0) + (z[6] || 0);

    if (
      z6z7 / totalZ >= 0.05 ||
      z5Plus / totalZ >= 0.15 ||
      (z5Plus / totalZ >= 0.10 && z5Plus >= z3z4 * 0.7)
    ) {
      return GARMIN_LOAD_FOCUS_META.ANAEROBIC;
    }
    if ((z3z4 + z5Plus) / totalZ >= 0.34 || z3z4 / totalZ >= 0.28) {
      return GARMIN_LOAD_FOCUS_META.HIGH_AEROBIC;
    }
    return GARMIN_LOAD_FOCUS_META.LOW_AEROBIC;
  }

  // 5. Fallback to Intensity Factor (IF), Variability Index (VI), and Heart Rate vs LTHR
  const rawIf = Number(activity.intensityFactor || 0);
  const np = Number(activity.normalizedPower || activity.avgPower || 0);
  const ifVal =
    rawIf > 3
      ? rawIf / 100
      : rawIf > 0
        ? rawIf
        : np > 0 && ftp > 0 && activity.sportCategory === 'Cycling'
          ? np / ftp
          : 0;
  const viVal =
    activity.variabilityIndex && activity.variabilityIndex > 0
      ? activity.variabilityIndex
      : activity.normalizedPower && activity.avgPower && activity.avgPower > 0
        ? activity.normalizedPower / activity.avgPower
        : 1.0;

  if (ifVal > 0) {
    if (
      ifVal >= 0.95 ||
      (ifVal >= 0.85 && viVal >= 1.13) ||
      (ifVal >= 0.91 && (activity.movingTimeSecs || 0) > 0 && (activity.movingTimeSecs || 0) <= 2400)
    ) {
      return GARMIN_LOAD_FOCUS_META.ANAEROBIC;
    }
    if (ifVal >= 0.80) {
      return GARMIN_LOAD_FOCUS_META.HIGH_AEROBIC;
    }
    return GARMIN_LOAD_FOCUS_META.LOW_AEROBIC;
  }

  const avgHr = Number(activity.avgHr || 0);
  const maxHr = Number(activity.maxHr || 0);
  if (avgHr > 0) {
    if (
      avgHr >= lthr * 0.96 ||
      (maxHr >= athleteMaxHr * 0.96 && avgHr >= lthr * 0.89)
    ) {
      return GARMIN_LOAD_FOCUS_META.ANAEROBIC;
    }
    if (avgHr >= lthr * 0.88) {
      return GARMIN_LOAD_FOCUS_META.HIGH_AEROBIC;
    }
    return GARMIN_LOAD_FOCUS_META.LOW_AEROBIC;
  }

  return GARMIN_LOAD_FOCUS_META.LOW_AEROBIC;
}

/**
 * Builds per-activity load segments for a single day so multi-activity days
 * render as a stacked bar where each activity is colored by its own Garmin Load Focus.
 */
export function buildDayLoadSegments(
  activities: UnifiedActivity[] = [],
  dailyLoad = 0,
  dateStr = '',
  opts?: GarminClassifyOptions
): ActivityLoadSegment[] {
  if (activities.length > 0) {
    const chronological = [...activities].sort((a, b) =>
      String(a.startDateLocal || '').localeCompare(String(b.startDateLocal || ''))
    );

    const rawList = chronological.map((act, idx) => {
      const focus = classifyActivityGarminLoad(act, opts);
      const explicitLoad = Number(act.trainingLoad ?? (act as any).tss ?? 0);
      const fallbackLoad = Math.max(
        8,
        Math.round(
          ((act.movingTimeSecs || 1800) / 3600) *
            (focus.type === 'ANAEROBIC' ? 75 : focus.type === 'HIGH_AEROBIC' ? 62 : 45)
        )
      );
      const rawLoad = explicitLoad > 0 ? explicitLoad : fallbackLoad;
      return {
        activityId: act.id || `${dateStr}-act-${idx}`,
        activityName: act.name || act.sportCategory || `Workout ${idx + 1}`,
        sportCategory: act.sportCategory,
        rawLoad,
        focus,
        activity: act,
      };
    });

    const sumRaw = rawList.reduce((acc, item) => acc + item.rawLoad, 0);
    const targetTotal = dailyLoad > 0 ? Math.max(dailyLoad, sumRaw) : sumRaw;
    const scale = sumRaw > 0 ? targetTotal / sumRaw : 1;

    return rawList.map((item) => ({
      activityId: item.activityId,
      activityName: item.activityName,
      sportCategory: item.sportCategory,
      load: Math.round(item.rawLoad * scale * 10) / 10,
      rawActivityLoad: Math.round(item.rawLoad),
      focus: item.focus,
      activity: item.activity,
    }));
  }

  if (dailyLoad <= 0) {
    return [];
  }

  const fallbackFocus =
    dailyLoad >= 110 ? GARMIN_LOAD_FOCUS_META.HIGH_AEROBIC : GARMIN_LOAD_FOCUS_META.LOW_AEROBIC;

  return [
    {
      activityId: `${dateStr}-daily`,
      activityName: 'Daily Training Load',
      load: Math.round(dailyLoad * 10) / 10,
      rawActivityLoad: Math.round(dailyLoad),
      focus: fallbackFocus,
    },
  ];
}

/**
 * Classifies a day's primary or single workout into Garmin's Training Load Focus jargon.
 */
export function classifyGarminLoadType(
  activities: UnifiedActivity[] = [],
  dailyLoad = 0,
  _maxHr = 0,
  opts?: GarminClassifyOptions
): GarminLoadFocusMeta {
  if (activities.length === 1) {
    return classifyActivityGarminLoad(activities[0], opts);
  }
  if (activities.length > 1) {
    const segments = buildDayLoadSegments(activities, dailyLoad, '', opts);
    const totals: Record<GarminLoadFocus, number> = {
      LOW_AEROBIC: 0,
      HIGH_AEROBIC: 0,
      ANAEROBIC: 0,
    };
    for (const seg of segments) {
      totals[seg.focus.type] += seg.load;
    }
    if (totals.ANAEROBIC >= totals.HIGH_AEROBIC && totals.ANAEROBIC >= totals.LOW_AEROBIC) {
      return GARMIN_LOAD_FOCUS_META.ANAEROBIC;
    }
    if (totals.HIGH_AEROBIC >= totals.LOW_AEROBIC) {
      return GARMIN_LOAD_FOCUS_META.HIGH_AEROBIC;
    }
    return GARMIN_LOAD_FOCUS_META.LOW_AEROBIC;
  }
  const segs = buildDayLoadSegments([], dailyLoad, '', opts);
  return segs[0]?.focus || GARMIN_LOAD_FOCUS_META.LOW_AEROBIC;
}
