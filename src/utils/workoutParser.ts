import type { AthleteProfile } from '../types.ts';

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
  durationSecs: number;
  distanceMeters?: number;
  intensityPct: number;
  targetPaceSecsPerKm?: number;
  zone: 1 | 2 | 3 | 4 | 5 | 6;
  zoneCode: EffortZoneCode;
  zoneColor: string;
  stepKind?: 'warmup' | 'work' | 'rest' | 'cooldown';
  repeatGroupId?: string;
  repeatIndex?: number;
  repeatTotal?: number;
}

export type StructuredWorkoutNode =
  | { type: 'step'; step: ParsedWorkoutStep }
  | { type: 'repeat'; repeatCount: number; label: string; steps: ParsedWorkoutStep[] };

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

function parseClockOrSecondsToken(token: string): number | null {
  const trimmed = token.trim();
  const minSecMatch = trimmed.match(/^(\d{1,2}):(\d{2}(?:\.\d+)?)$/);
  if (minSecMatch) {
    return Number(minSecMatch[1]) * 60 + Number(minSecMatch[2]);
  }
  const secMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*s?$/i);
  if (secMatch) {
    return Number(secMatch[1]);
  }
  return null;
}

function extractDistanceMeters(cleanLine: string): number | undefined {
  // 1. Explicit km / miles / meters words
  const kmMatch = cleanLine.match(/\b(\d+(?:\.\d+)?)\s*km\b/i);
  if (kmMatch) return Math.round(Number(kmMatch[1]) * 1000);

  const miMatch = cleanLine.match(/\b(\d+(?:\.\d+)?)\s*(?:mi|mile|miles)\b/i);
  if (miMatch) return Math.round(Number(miMatch[1]) * 1609.34);

  const metersWordMatch = cleanLine.match(/\b(\d+(?:\.\d+)?)\s*(?:meters|meter)\b/i);
  if (metersWordMatch) return Math.round(Number(metersWordMatch[1]));

  // 2. Disambiguate `<val>m` (where 15m = 15 minutes vs 400m = 400 meters vs 60m sprint)
  const mTokens = Array.from(cleanLine.matchAll(/\b(\d+)\s*m(?!in|ins|s)\b/gi));
  for (const tok of mTokens) {
    const val = Number(tok[1]);
    if (val >= 100) return val;
    if (val >= 30 && val <= 90 && /\b(sprint|stride|fly|accel|hill)\b/i.test(cleanLine)) {
      return val;
    }
  }
  return undefined;
}

function extractExplicitIntensityPct(cleanLine: string): number | undefined {
  const rangeMatch = cleanLine.match(/(\d{2,3})\s*-\s*(\d{2,3})\s*%/);
  if (rangeMatch) {
    return Math.round((Number(rangeMatch[1]) + Number(rangeMatch[2])) / 2);
  }
  const pctMatch = cleanLine.match(/(\d{2,3})\s*%/);
  if (pctMatch) {
    return Number(pctMatch[1]);
  }
  return undefined;
}

function extractTargetPaceSecsPerKm(
  cleanLine: string,
  distanceMeters?: number
): { paceSecsPerKm?: number; repSplitSecs?: number } {
  // e.g. "@ 3:08/km", "@ 4:58/mi", "@ 1:12/400m"
  const unitPaceMatch = cleanLine.match(
    /(?:@|at)\s*(\d{1,2}:\d{2}(?:\.\d+)?|\d+(?:\.\d+)?s?)\s*\/\s*(km|mi|400m|200m|800m)\b/i
  );
  if (unitPaceMatch) {
    const secs = parseClockOrSecondsToken(unitPaceMatch[1]);
    if (secs && secs > 5) {
      const unit = unitPaceMatch[2].toLowerCase();
      if (unit === 'km') return { paceSecsPerKm: Number(secs.toFixed(1)) };
      if (unit === 'mi') return { paceSecsPerKm: Number((secs / 1.60934).toFixed(1)) };
      if (unit === '400m') return { paceSecsPerKm: Number((secs * 2.5).toFixed(1)) };
      if (unit === '200m') return { paceSecsPerKm: Number((secs * 5).toFixed(1)) };
      if (unit === '800m') return { paceSecsPerKm: Number((secs * 1.25).toFixed(1)) };
    }
  }

  // e.g. "400m @ 60.5s", "400m @ 1:00.5", "800m @ 2:24"
  const repTargetMatch = cleanLine.match(
    /(?:@|at)\s*(\d{1,2}:\d{2}(?:\.\d+)?|\d+(?:\.\d+)?\s*s)\b/i
  );
  if (repTargetMatch && distanceMeters && distanceMeters > 0) {
    const splitSecs = parseClockOrSecondsToken(repTargetMatch[1]);
    if (splitSecs && splitSecs > 4) {
      const paceSecsPerKm = Number(((splitSecs / distanceMeters) * 1000).toFixed(1));
      return { paceSecsPerKm, repSplitSecs: splitSecs };
    }
  }

  return {};
}

function inferStepKind(cleanLine: string, explicitKind?: ParsedWorkoutStep['stepKind']): ParsedWorkoutStep['stepKind'] {
  if (explicitKind) return explicitKind;
  if (/\bwarm\s*-?\s*up\b/i.test(cleanLine)) return 'warmup';
  if (/\bcool\s*-?\s*down\b/i.test(cleanLine)) return 'cooldown';
  if (/\b(?:jog|walk|rest|recovery|float|standing)\b/i.test(cleanLine)) return 'rest';
  return 'work';
}

function parseSingleWorkoutLine(
  cleanLine: string,
  thresholdPaceSecsPerKm = 250,
  explicitKind?: ParsedWorkoutStep['stepKind']
): ParsedWorkoutStep {
  const distanceMeters = extractDistanceMeters(cleanLine);
  const explicitPct = extractExplicitIntensityPct(cleanLine);
  const { paceSecsPerKm: parsedTargetPace, repSplitSecs } = extractTargetPaceSecsPerKm(
    cleanLine,
    distanceMeters
  );
  const stepKind = inferStepKind(cleanLine, explicitKind);

  let intensityPct = explicitPct ?? 65;
  if (explicitPct === undefined) {
    if (parsedTargetPace && parsedTargetPace > 60) {
      intensityPct = Math.round((thresholdPaceSecsPerKm / parsedTargetPace) * 100);
    } else if (/\bFR\b|fast\s*rep|800m\s*(?:race|pace|effort)/i.test(cleanLine)) {
      intensityPct = 122;
    } else if (/\bR\b|repetition|fast/i.test(cleanLine)) {
      intensityPct = 114;
    } else if (/\bsub-?t\b|sub-?threshold/i.test(cleanLine)) {
      intensityPct = 94;
    } else if (/\bcv\b|critical/i.test(cleanLine)) {
      intensityPct = 102;
    } else if (/z1|recovery|easy|warmup|cooldown|jog|float|walk/i.test(cleanLine)) {
      intensityPct = 55;
    } else if (/z2|endurance|aerobic/i.test(cleanLine)) {
      intensityPct = 68;
    } else if (/z3|tempo|sweet\s*spot/i.test(cleanLine)) {
      intensityPct = 86;
    } else if (/z4|threshold|ftp|\bT\b/i.test(cleanLine)) {
      intensityPct = 98;
    } else if (/z5|vo2|\bI\b/i.test(cleanLine)) {
      intensityPct = 110;
    } else if (/z6|sprint|anaerobic/i.test(cleanLine)) {
      intensityPct = 130;
    }
  }

  const effectiveTargetPace =
    parsedTargetPace ??
    (distanceMeters
      ? Number(((thresholdPaceSecsPerKm * 100) / Math.max(40, intensityPct)).toFixed(1))
      : undefined);

  // Duration extraction (supports hours, mins, fractional/sub-minute secs, or distance -> estimated secs)
  let durationSecs = 600;
  const hrMatch = cleanLine.match(/\b(\d+(?:\.\d+)?)\s*(?:h|hr|hrs)\b/i);
  const secMatch = cleanLine.match(/\b(\d+(?:\.\d+)?)\s*(?:s|sec|secs)\b/i);
  const minMatch = cleanLine.match(/\b(\d+(?:\.\d+)?)\s*(?:min|mins)\b/i);
  const bareMinMatch = !distanceMeters ? cleanLine.match(/\b(\d+(?:\.\d+)?)\s*m\b/i) : null;

  if (hrMatch) {
    durationSecs = Math.round(Number(hrMatch[1]) * 3600);
  } else if (distanceMeters) {
    if (repSplitSecs && repSplitSecs > 4) {
      durationSecs = Number(repSplitSecs.toFixed(1));
    } else if (effectiveTargetPace) {
      durationSecs = Number(((distanceMeters / 1000) * effectiveTargetPace).toFixed(1));
    }
  } else if (minMatch) {
    durationSecs = Math.round(Number(minMatch[1]) * 60);
  } else if (secMatch && !/@\s*\d+(?:\.\d+)?s\b/.test(cleanLine)) {
    durationSecs = Number(secMatch[1]);
  } else if (bareMinMatch) {
    durationSecs = Math.round(Number(bareMinMatch[1]) * 60);
  }

  const durationMins =
    durationSecs >= 60 && durationSecs % 60 === 0
      ? durationSecs / 60
      : Math.max(0.25, Number((durationSecs / 60).toFixed(2)));

  const zoneMeta = getIntervalsZoneFromIntensityPct(intensityPct);

  return {
    label: cleanLine,
    durationMins,
    durationSecs,
    distanceMeters,
    intensityPct,
    targetPaceSecsPerKm: effectiveTargetPace,
    zone: zoneMeta.zone,
    zoneCode: zoneMeta.code,
    zoneColor: zoneMeta.color,
    stepKind,
  };
}

/**
 * Parses both Intervals.icu multi-line syntax (`Main Set 8x\n- 400m @ 60.5s\n- 90s jog`)
 * and inline repeat syntax (`- 6x800m @ 2:24 (2m rest)`) into a structured AST supporting
 * sub-minute steps, track meter distances, pace targets, and Garmin .FIT repeat groups.
 */
export function parseStructuredTrackWorkout(
  syntax: string,
  thresholdPaceSecsPerKm = 250
): StructuredWorkoutNode[] {
  if (!syntax || !syntax.trim()) return [];
  const rawLines = syntax.split('\n').map((l) => l.trim());
  const nodes: StructuredWorkoutNode[] = [];

  let currentRepeat: { repeatCount: number; label: string; steps: ParsedWorkoutStep[] } | null =
    null;

  const flushRepeat = () => {
    if (currentRepeat && currentRepeat.steps.length > 0) {
      nodes.push({
        type: 'repeat',
        repeatCount: currentRepeat.repeatCount,
        label: currentRepeat.label,
        steps: currentRepeat.steps,
      });
    }
    currentRepeat = null;
  };

  for (const line of rawLines) {
    if (!line) {
      flushRepeat();
      continue;
    }

    // Block repeat header (without leading `-`), e.g. "Main Set 8x", "8x", "Repeat 6x:"
    if (!line.startsWith('-')) {
      const headerRepeatMatch = line.match(
        /^(?:main\s+set\s+|set\s*\d*\s*:?\s*|repeat\s+)?(\d{1,2})\s*x\b[:\s-]*(.*)$/i
      );
      if (headerRepeatMatch) {
        flushRepeat();
        const count = Math.max(2, Number(headerRepeatMatch[1]));
        const suffix = headerRepeatMatch[2]?.trim();
        currentRepeat = {
          repeatCount: count,
          label: suffix ? `${count}x ${suffix}` : `Repeat ${count}x`,
          steps: [],
        };
      } else {
        flushRepeat();
      }
      continue;
    }

    const clean = line.replace(/^-+\s*/, '').trim();
    if (!clean) continue;

    // Inline repeat line, e.g. "- 6x800m @ 2:24 (2m rest)" or "- 8 x 400m @ 60.5s w/ 90s jog"
    const inlineRepeatMatch = clean.match(/^(\d{1,2})\s*x(?:\s+|(?=\d))(.+)$/i);
    if (inlineRepeatMatch) {
      flushRepeat();
      const count = Math.max(2, Number(inlineRepeatMatch[1]));
      const remainder = inlineRepeatMatch[2].trim();

      let mainPart = remainder;
      let restPart: string | null = null;
      const parenRestMatch = remainder.match(
        /\(([^)]*(?:rest|jog|rec|float|walk|standing)[^)]*)\)\s*$/i
      );
      const withRestMatch = remainder.match(/\bw\/\s*(.+)$/i);
      if (parenRestMatch) {
        restPart = parenRestMatch[1].trim();
        mainPart = remainder.slice(0, parenRestMatch.index).trim();
      } else if (withRestMatch) {
        restPart = withRestMatch[1].trim();
        mainPart = remainder.slice(0, withRestMatch.index).trim();
      }

      const workStep = parseSingleWorkoutLine(mainPart, thresholdPaceSecsPerKm, 'work');
      const groupSteps: ParsedWorkoutStep[] = [workStep];
      if (restPart) {
        groupSteps.push(parseSingleWorkoutLine(restPart, thresholdPaceSecsPerKm, 'rest'));
      }
      nodes.push({
        type: 'repeat',
        repeatCount: count,
        label: `${count}x ${mainPart.slice(0, 14)}`.trim(),
        steps: groupSteps,
      });
      continue;
    }

    const step = parseSingleWorkoutLine(clean, thresholdPaceSecsPerKm);
    if (currentRepeat) {
      if (step.stepKind === 'cooldown' || step.stepKind === 'warmup') {
        flushRepeat();
        nodes.push({ type: 'step', step });
      } else {
        currentRepeat.steps.push(step);
      }
    } else {
      nodes.push({ type: 'step', step });
    }
  }

  flushRepeat();
  return nodes;
}

/**
 * Flattens structured workout AST into unrolled chronological steps for skyline & TSS summaries.
 */
export function parseWorkoutSteps(
  syntax: string,
  thresholdPaceSecsPerKm = 250
): ParsedWorkoutStep[] {
  const ast = parseStructuredTrackWorkout(syntax, thresholdPaceSecsPerKm);
  const steps: ParsedWorkoutStep[] = [];
  let repeatBlockIdx = 0;

  for (const node of ast) {
    if (node.type === 'step') {
      steps.push(node.step);
    } else {
      repeatBlockIdx += 1;
      const groupId = `rep-grp-${repeatBlockIdx}`;
      for (let i = 1; i <= node.repeatCount; i++) {
        for (const inner of node.steps) {
          steps.push({
            ...inner,
            repeatGroupId: groupId,
            repeatIndex: i,
            repeatTotal: node.repeatCount,
          });
        }
      }
    }
  }
  return steps;
}

export function computeAmplitudeHeightPct(intensityPct: number, fallbackHeightPct: number): number {
  if (!Number.isFinite(intensityPct) || intensityPct <= 0) return fallbackHeightPct;
  return Math.max(20, Math.min(100, Math.round(((intensityPct - 35) / 85) * 100)));
}

function formatPacePerUnitFromSecsPerKm(secsPerKm: number, distanceUnit: 'mi' | 'km' = 'km'): string {
  const safeSecsPerKm = Math.max(120, Math.min(720, secsPerKm));
  const targetSecs = distanceUnit === 'mi' ? Math.round(safeSecsPerKm * 1.609344) : Math.round(safeSecsPerKm);
  const mins = Math.floor(targetSecs / 60);
  const secs = targetSecs % 60;
  return `${mins}:${String(secs).padStart(2, '0')}/${distanceUnit}`;
}

/**
 * Formats a raw workout syntax line into plain, athlete-readable splits with resolved
 * personal pace or wattage targets instead of exposing raw `% Pace` or `% FTP` codes.
 */
export function formatHumanReadableStepLine(
  line: string,
  sport: 'Cycling' | 'Running' | 'Swimming' | 'Strength' | 'Multisport',
  thresholdPaceSecsPerKm?: number,
  distanceUnit: 'mi' | 'km' = 'km',
  ftpWatts?: number
): string {
  const trimmed = line.replace(/^\s*-\s*/, '').trim();
  if (!trimmed) return '';

  const repeatPrefixMatch = trimmed.match(/^(\d{1,2})\s*[x×]\s*(.+)$/i);
  const normalizedPrefix = repeatPrefixMatch
    ? `${repeatPrefixMatch[1]} × ${repeatPrefixMatch[2].trim()}`
    : trimmed;

  const pctPaceMatch = normalizedPrefix.match(/(\d+(?:\.\d+)?)\s*%\s*pace/i);
  if (pctPaceMatch && sport === 'Running' && thresholdPaceSecsPerKm && thresholdPaceSecsPerKm > 0) {
    const pct = Number(pctPaceMatch[1]);
    if (Number.isFinite(pct) && pct > 20) {
      const targetSecsPerKm = thresholdPaceSecsPerKm / (pct / 100);
      const splitLabel = formatPacePerUnitFromSecsPerKm(targetSecsPerKm, distanceUnit);
      return normalizedPrefix.replace(/(\d+(?:\.\d+)?)\s*%\s*pace/i, `@ ${splitLabel}`);
    }
  }

  const pctFtpMatch = normalizedPrefix.match(/(\d+(?:\.\d+)?)\s*%\s*ftp/i);
  if (pctFtpMatch && sport === 'Cycling' && ftpWatts && ftpWatts > 50) {
    const pct = Number(pctFtpMatch[1]);
    if (Number.isFinite(pct) && pct > 20) {
      const watts = Math.round((ftpWatts * pct) / 100);
      return normalizedPrefix.replace(/(\d+(?:\.\d+)?)\s*%\s*ftp/i, `@ ${watts}W`);
    }
  }

  return normalizedPrefix;
}
