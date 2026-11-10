import { AthleteProfile } from '../types';

export type EffortZoneCode = 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5' | 'Z6+';

export const INTERVALS_EFFORT_ZONES = [
  {
    zone: 1 as const,
    code: 'Z1' as const,
    name: 'Recovery',
    color: '#94A3B8',
    heightPct: 28,
  },
  {
    zone: 2 as const,
    code: 'Z2' as const,
    name: 'Endurance',
    color: '#0D9488',
    heightPct: 44,
  },
  {
    zone: 3 as const,
    code: 'Z3' as const,
    name: 'Tempo / Sweet Spot',
    color: '#D97706',
    heightPct: 62,
  },
  {
    zone: 4 as const,
    code: 'Z4' as const,
    name: 'Threshold',
    color: '#EA580C',
    heightPct: 78,
  },
  {
    zone: 5 as const,
    code: 'Z5' as const,
    name: 'VO2max',
    color: '#DC2626',
    heightPct: 92,
  },
  {
    zone: 6 as const,
    code: 'Z6+' as const,
    name: 'Anaerobic / Sprint',
    color: '#7C3AED',
    heightPct: 100,
  },
] as const;

export const ZONE_META: Record<
  EffortZoneCode,
  { name: string; color: string; heightPct: number }
> = {
  Z1: { name: 'Recovery', color: '#94A3B8', heightPct: 28 },
  Z2: { name: 'Endurance', color: '#0D9488', heightPct: 44 },
  Z3: { name: 'Tempo / Sweet Spot', color: '#D97706', heightPct: 62 },
  Z4: { name: 'Threshold', color: '#EA580C', heightPct: 78 },
  Z5: { name: 'VO2max', color: '#DC2626', heightPct: 92 },
  'Z6+': { name: 'Anaerobic', color: '#7C3AED', heightPct: 100 },
};

export interface ParsedWorkoutStep {
  label: string;
  durationMins: number;
  intensityPct: number;
  zone: 1 | 2 | 3 | 4 | 5 | 6;
  zoneCode: EffortZoneCode;
  zoneColor: string;
}

export function getIntervalsZoneFromIntensityPct(intensityPct: number): {
  zone: 1 | 2 | 3 | 4 | 5 | 6;
  code: EffortZoneCode;
  name: string;
  color: string;
  heightPct: number;
} {
  if (intensityPct < 56) return INTERVALS_EFFORT_ZONES[0];
  if (intensityPct <= 75) return INTERVALS_EFFORT_ZONES[1];
  if (intensityPct <= 90) return INTERVALS_EFFORT_ZONES[2];
  if (intensityPct <= 105) return INTERVALS_EFFORT_ZONES[3];
  if (intensityPct <= 120) return INTERVALS_EFFORT_ZONES[4];
  return INTERVALS_EFFORT_ZONES[5];
}

export function classifyZoneFromPct(
  pctFtp: number,
  profile: AthleteProfile
): {
  code: EffortZoneCode;
  name: string;
  color: string;
  hrCeilingBpm: number;
} {
  const pz = profile.powerZones || [];
  const hz = profile.hrZones || [];
  const z1Max = pz[0]?.maxPct || 55;
  const z2Max = pz[1]?.maxPct || 75;
  const z3Max = pz[2]?.maxPct || 90;
  const z4Max = pz[3]?.maxPct || 105;
  const z5Max = pz[4]?.maxPct || 120;

  if (pctFtp <= z1Max) {
    return {
      code: 'Z1',
      name: pz[0]?.name || ZONE_META.Z1.name,
      color: ZONE_META.Z1.color,
      hrCeilingBpm: hz[0]?.maxBpm || Math.round(profile.lthr * 0.81),
    };
  }
  if (pctFtp <= z2Max) {
    return {
      code: 'Z2',
      name: pz[1]?.name || ZONE_META.Z2.name,
      color: ZONE_META.Z2.color,
      hrCeilingBpm: hz[1]?.maxBpm || Math.round(profile.lthr * 0.89),
    };
  }
  if (pctFtp <= z3Max) {
    return {
      code: 'Z3',
      name: pz[2]?.name || ZONE_META.Z3.name,
      color: ZONE_META.Z3.color,
      hrCeilingBpm: hz[2]?.maxBpm || Math.round(profile.lthr * 0.94),
    };
  }
  if (pctFtp <= z4Max) {
    return {
      code: 'Z4',
      name: pz[3]?.name || ZONE_META.Z4.name,
      color: ZONE_META.Z4.color,
      hrCeilingBpm: hz[3]?.maxBpm || profile.lthr,
    };
  }
  if (pctFtp <= z5Max) {
    return {
      code: 'Z5',
      name: pz[4]?.name || ZONE_META.Z5.name,
      color: ZONE_META.Z5.color,
      hrCeilingBpm: hz[4]?.maxBpm || Math.min(profile.maxHr, Math.round(profile.lthr * 1.04)),
    };
  }
  return {
    code: 'Z6+',
    name: pz[5]?.name || ZONE_META['Z6+'].name,
    color: ZONE_META['Z6+'].color,
    hrCeilingBpm: profile.maxHr,
  };
}

export function parseWorkoutSteps(syntax: string): ParsedWorkoutStep[] {
  if (!syntax || !syntax.trim()) return [];
  const lines = syntax
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-'));

  const steps: ParsedWorkoutStep[] = [];
  for (const line of lines) {
    const clean = line.replace(/^-+\s*/, '');
    const durMatch = clean.match(/(\d+)\s*(m|min|mins|h|hr|s|sec)/i);
    let durationMins = 10;
    if (durMatch) {
      const val = Number(durMatch[1]);
      const unit = durMatch[2].toLowerCase();
      if (unit.startsWith('h')) durationMins = val * 60;
      else if (unit.startsWith('s')) durationMins = Math.max(1, Math.round(val / 60));
      else durationMins = val;
    }

    const pctMatch = clean.match(/(\d{2,3})\s*%/);
    const rangeMatch = clean.match(/(\d{2,3})\s*-\s*(\d{2,3})\s*%/);
    let intensityPct = 65;
    if (rangeMatch) {
      intensityPct = Math.round((Number(rangeMatch[1]) + Number(rangeMatch[2])) / 2);
    } else if (pctMatch) {
      intensityPct = Number(pctMatch[1]);
    } else if (/z1|recovery|easy|warmup|cooldown/i.test(clean)) {
      intensityPct = 52;
    } else if (/z2|endurance|aerobic/i.test(clean)) {
      intensityPct = 68;
    } else if (/z3|tempo|sweet\s*spot/i.test(clean)) {
      intensityPct = 86;
    } else if (/z4|threshold|ftp/i.test(clean)) {
      intensityPct = 98;
    } else if (/z5|vo2/i.test(clean)) {
      intensityPct = 112;
    } else if (/z6|sprint|anaerobic/i.test(clean)) {
      intensityPct = 130;
    }

    const zoneMeta = getIntervalsZoneFromIntensityPct(intensityPct);

    steps.push({
      label: clean,
      durationMins,
      intensityPct,
      zone: zoneMeta.zone,
      zoneCode: zoneMeta.code,
      zoneColor: zoneMeta.color,
    });
  }
  return steps;
}

export function computeAmplitudeHeightPct(intensityPct: number, fallbackHeightPct: number): number {
  if (!Number.isFinite(intensityPct) || intensityPct <= 0) return fallbackHeightPct;
  return Math.max(20, Math.min(100, Math.round(((intensityPct - 35) / 85) * 100)));
}
