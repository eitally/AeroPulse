import type { AthleteProfile, SportCategory, TeamWorkoutLibraryCategory } from '../types.ts';
import {
  buildTrackSpeedReserveProfile,
  solve400mRacePaceSecsPerKm,
} from '../physiology/trackSpeedReserveEngine.ts';

export type EffortZoneCode = 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5' | 'Z6+';

export const INTERVALS_EFFORT_ZONES = [
  {
    zone: 1 as const,
    code: 'Z1' as const,
    name: 'Recovery',
    color: '#94A3B8',
    inkClass: 'text-slate-700 dark:text-slate-200',
    heightPct: 28,
  },
  {
    zone: 2 as const,
    code: 'Z2' as const,
    name: 'Endurance',
    color: '#0D9488',
    inkClass: 'ap-ink-teal',
    heightPct: 44,
  },
  {
    zone: 3 as const,
    code: 'Z3' as const,
    name: 'Tempo / Sweet Spot',
    color: '#D97706',
    inkClass: 'ap-ink-amber',
    heightPct: 62,
  },
  {
    zone: 4 as const,
    code: 'Z4' as const,
    name: 'Threshold',
    color: '#EA580C',
    inkClass: 'ap-ink-vermilion',
    heightPct: 78,
  },
  {
    zone: 5 as const,
    code: 'Z5' as const,
    name: 'VO2max',
    color: '#DC2626',
    inkClass: 'ap-ink-rose',
    heightPct: 92,
  },
  {
    zone: 6 as const,
    code: 'Z6+' as const,
    name: 'Anaerobic / Sprint',
    color: '#7C3AED',
    inkClass: 'ap-ink-violet',
    heightPct: 100,
  },
] as const;

export const ZONE_META: Record<
  EffortZoneCode,
  { name: string; color: string; inkClass: string; heightPct: number }
> = {
  Z1: { name: 'Recovery', color: '#94A3B8', inkClass: 'text-slate-700 dark:text-slate-200', heightPct: 28 },
  Z2: { name: 'Endurance', color: '#0D9488', inkClass: 'ap-ink-teal', heightPct: 44 },
  Z3: { name: 'Tempo / Sweet Spot', color: '#D97706', inkClass: 'ap-ink-amber', heightPct: 62 },
  Z4: { name: 'Threshold', color: '#EA580C', inkClass: 'ap-ink-vermilion', heightPct: 78 },
  Z5: { name: 'VO2max', color: '#DC2626', inkClass: 'ap-ink-rose', heightPct: 92 },
  'Z6+': { name: 'Anaerobic', color: '#7C3AED', inkClass: 'ap-ink-violet', heightPct: 100 },
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

function extractDistanceMeters(cleanLine: string, isRepeatWork = false): number | undefined {
  // Strip target pace clauses ("at 1 mile pace", "@ mile pace") so race-pace names never hijack step distance
  const distPart = cleanLine.replace(/(?:\b(?:at|@)\b).*$/i, '').trim();
  const source = distPart.length > 0 ? distPart : cleanLine;

  // 1. Explicit km / miles / meters words
  const kmMatch = source.match(/\b(\d+(?:\.\d+)?)\s*km\b/i);
  if (kmMatch) return Math.round(Number(kmMatch[1]) * 1000);

  const miMatch = source.match(/\b(\d+(?:\.\d+)?)\s*(?:mi|mile|miles)\b/i);
  if (miMatch) return Math.round(Number(miMatch[1]) * 1609.34);

  const metersWordMatch = source.match(/\b(\d+(?:\.\d+)?)\s*(?:meters|meter)\b/i);
  if (metersWordMatch) return Math.round(Number(metersWordMatch[1]));

  // 2. Disambiguate `<val>m` (where 15m 60% = 15 minutes vs 400m = 400m vs 30m fly/60m blocks/60m walk)
  const hasExplicitMinutesHint =
    /\b(?:ftp|tempo|threshold|sub-?t|cv|z1|z2|z3|z4|z5|easy|warmup|warm-up|wu|cooldown|cool-down|cd|steady|progression)\b|\d+\s*%/i.test(
      source
    );

  const mTokens = Array.from(source.matchAll(/\b(\d+)\s*m(?!in|ins|s)\b/gi));
  for (const tok of mTokens) {
    const val = Number(tok[1]);
    if (val >= 100) return val;
    if (val >= 10 && val <= 99 && !hasExplicitMinutesHint) {
      if (
        /\b(sprint|stride|fly|flys|flies|accel|acceleration|block|blocks|start|starts|wicket|wickets|hurdle|hurdles|hill|walk|jog|float)\b/i.test(
          source
        )
      ) {
        return val;
      }
      if (val >= 30 && /\b(rec|recovery)\b/i.test(source)) {
        return val;
      }
      if (isRepeatWork) {
        return val;
      }
    }
  }
  return undefined;
}

function resolveNamedTrackPaceSecsPerKm(
  cleanLine: string,
  thresholdPaceSecsPerKm: number
): { paceSecsPerKm?: number; forceIntensityPct?: number } {
  const sr = buildTrackSpeedReserveProfile({ thresholdPaceSecsPerKm });

  if (/\bwarm\s*-?\s*up\b|\bcool\s*-?\s*down\b/i.test(cleanLine)) {
    return { paceSecsPerKm: sr.zones.E.paceSecsPerKm, forceIntensityPct: 55 };
  }
  if (/\b(?:walk|standing|recovery)\b/i.test(cleanLine) && !/\bjog\b/i.test(cleanLine)) {
    return { forceIntensityPct: 48 };
  }
  if (/\b400\s*m?\s*(?:race\s*)?(?:pace|effort)\b/i.test(cleanLine)) {
    const pace = solve400mRacePaceSecsPerKm(sr);
    return { paceSecsPerKm: pace, forceIntensityPct: Math.round((thresholdPaceSecsPerKm / pace) * 100) };
  }
  if (/\b800\s*m?\s*(?:race\s*)?(?:pace|effort)\b|\bFR\b|fast\s*rep/i.test(cleanLine)) {
    const pace = sr.zones.FR.paceSecsPerKm;
    return { paceSecsPerKm: pace, forceIntensityPct: Math.round((thresholdPaceSecsPerKm / pace) * 100) };
  }
  if (/\b(?:1600\s*m?|1500\s*m?|1\s*mile|mile)\s*(?:race\s*)?(?:pace|effort)\b/i.test(cleanLine)) {
    const pace = sr.zones.R.paceSecsPerKm;
    return { paceSecsPerKm: pace, forceIntensityPct: Math.round((thresholdPaceSecsPerKm / pace) * 100) };
  }
  if (/\b(?:3200\s*m?|3000\s*m?|3k|2\s*mile|2\s*mi)\s*(?:race\s*)?(?:pace|effort)\b/i.test(cleanLine)) {
    const pace = Number(((sr.zones.I.paceSecsPerKm + sr.zones.R.paceSecsPerKm) / 2).toFixed(1));
    return { paceSecsPerKm: pace, forceIntensityPct: Math.round((thresholdPaceSecsPerKm / pace) * 100) };
  }
  if (/\b(?:5000\s*m?|5k)\s*(?:race\s*)?(?:pace|effort)\b/i.test(cleanLine)) {
    const pace = sr.zones.I.paceSecsPerKm;
    return { paceSecsPerKm: pace, forceIntensityPct: Math.round((thresholdPaceSecsPerKm / pace) * 100) };
  }
  if (/\b(?:10k|cv|critical\s*velocity)\b/i.test(cleanLine)) {
    const pace = sr.zones.CV.paceSecsPerKm;
    return { paceSecsPerKm: pace, forceIntensityPct: Math.round((thresholdPaceSecsPerKm / pace) * 100) };
  }
  if (/\b(?:threshold|lt2)\b/i.test(cleanLine)) {
    const pace = sr.zones.T.paceSecsPerKm;
    return { paceSecsPerKm: pace, forceIntensityPct: Math.round((thresholdPaceSecsPerKm / pace) * 100) };
  }
  if (/\b(?:sub-?t|sub-?threshold)\b/i.test(cleanLine)) {
    const pace = sr.zones.SUB_T.paceSecsPerKm;
    return { paceSecsPerKm: pace, forceIntensityPct: Math.round((thresholdPaceSecsPerKm / pace) * 100) };
  }
  return {};
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
  if (/\b(?:warm\s*-?\s*up|wu)\b/i.test(cleanLine)) return 'warmup';
  if (/\b(?:cool\s*-?\s*down|cd)\b/i.test(cleanLine)) return 'cooldown';
  if (/\b(?:jog|walk|rest|recovery|float|standing)\b/i.test(cleanLine)) return 'rest';
  return 'work';
}

function parseSingleWorkoutLine(
  cleanLine: string,
  thresholdPaceSecsPerKm = 250,
  explicitKind?: ParsedWorkoutStep['stepKind'],
  isRepeatWork = false
): ParsedWorkoutStep {
  const distanceMeters = extractDistanceMeters(cleanLine, isRepeatWork);
  const explicitPct = extractExplicitIntensityPct(cleanLine);
  const { paceSecsPerKm: parsedTargetPace, repSplitSecs } = extractTargetPaceSecsPerKm(
    cleanLine,
    distanceMeters
  );
  const stepKind = inferStepKind(cleanLine, explicitKind);
  const namedPace =
    explicitPct === undefined && !parsedTargetPace
      ? resolveNamedTrackPaceSecsPerKm(cleanLine, thresholdPaceSecsPerKm)
      : {};

  let intensityPct = explicitPct ?? namedPace.forceIntensityPct ?? 65;
  if (explicitPct === undefined && namedPace.forceIntensityPct === undefined) {
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
    } else if (/z1|recovery|easy|warm\s*-?\s*up|cool\s*-?\s*down|jog|float|walk/i.test(cleanLine)) {
      intensityPct = 55;
    } else if (/z2|endurance|aerobic/i.test(cleanLine)) {
      intensityPct = 68;
    } else if (/z3|tempo|sweet\s*spot/i.test(cleanLine)) {
      intensityPct = 86;
    } else if (/z4|threshold|ftp|\bT\b/i.test(cleanLine)) {
      intensityPct = 98;
    } else if (/z5|vo2|\bI\b/i.test(cleanLine)) {
      intensityPct = 110;
    } else if (
      /z6|sprint|anaerobic|fly|flys|flies|blocks?|starts?|accel/i.test(cleanLine) ||
      (distanceMeters !== undefined && distanceMeters < 100 && stepKind === 'work')
    ) {
      intensityPct = 135;
    }
  }

  const effectiveTargetPace =
    parsedTargetPace ??
    namedPace.paceSecsPerKm ??
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

function splitTopLevelClauses(line: string): string[] {
  const parts: string[] = [];
  let buf = '';
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '(') depth += 1;
    else if (ch === ')' && depth > 0) depth -= 1;

    if (depth === 0 && (ch === '+' || ch === ',')) {
      const trimmed = buf.trim();
      if (trimmed) parts.push(trimmed);
      buf = '';
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) parts.push(tail);
  return parts;
}

function normalizeInputLines(syntax: string): string[] {
  const out: string[] = [];
  for (const raw of syntax.split('\n')) {
    const line = raw.trim();
    if (!line) {
      out.push('');
      continue;
    }
    if (line.startsWith('-')) {
      out.push(line);
      continue;
    }
    if (line.includes('+') || line.includes(',')) {
      const clauses = splitTopLevelClauses(line);
      if (
        clauses.length > 1 &&
        clauses.some((c) =>
          /^(?:\d{1,2}\s*[x×]|\d+(?:\.\d+)?\s*(?:mi|mile|miles|km|m|min|mins|s|sec|secs)|warm\s*-?\s*up|cool\s*-?\s*down)/i.test(
            c
          )
        )
      ) {
        for (const c of clauses) {
          out.push(c.startsWith('-') ? c : `- ${c}`);
        }
        continue;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Parses both Intervals.icu multi-line syntax (`Main Set 8x\n- 400m @ 60.5s\n- 90s jog`)
 * and plain coach shorthand (`2mi warm-up, 2x200m at 800m pace, 4x800m at mile pace, 2mi cooldown`)
 * into a structured AST supporting sub-minute steps, track meter distances, pace targets, and Garmin .FIT loops.
 */
export function parseStructuredTrackWorkout(
  syntax: string,
  thresholdPaceSecsPerKm = 250
): StructuredWorkoutNode[] {
  if (!syntax || !syntax.trim()) return [];
  const rawLines = normalizeInputLines(syntax);
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

    const looksLikeStandaloneStep =
      !line.startsWith('-') &&
      (/^(\d{1,2})\s*[x×]\s*\d+/i.test(line) ||
        /^\d+(?:\.\d+)?\s*(?:mi|mile|miles|km|m|min|mins|s|sec|secs)\b/i.test(line));

    // Block repeat header (without leading `-`), e.g. "Main Set 8x", "8x", "Repeat 6x:"
    if (!line.startsWith('-') && !looksLikeStandaloneStep) {
      const headerRepeatMatch = line.match(
        /^(?:main\s+set\s+|set\s*\d*\s*:?\s*|repeat\s+)?(\d{1,2})\s*[x×]\b[:\s-]*(.*)$/i
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

    // Inline repeat line, e.g. "- 6x800m @ 2:24 (2m rest)" or "4x800m at mile pace"
    const inlineRepeatMatch = clean.match(/^(\d{1,2})\s*[x×](?:\s+|(?=\d))(.+)$/i);
    if (inlineRepeatMatch) {
      flushRepeat();
      const count = Math.max(1, Number(inlineRepeatMatch[1]));
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

      const workStep = parseSingleWorkoutLine(mainPart, thresholdPaceSecsPerKm, 'work', true);
      const groupSteps: ParsedWorkoutStep[] = [workStep];
      if (restPart) {
        groupSteps.push(parseSingleWorkoutLine(restPart, thresholdPaceSecsPerKm, 'rest', false));
      }
      nodes.push({
        type: 'repeat',
        repeatCount: count,
        label: `${count}x ${mainPart.slice(0, 14)}`.trim(),
        steps: groupSteps,
      });
      continue;
    }

    const inferredKind = inferStepKind(clean);
    const step = parseSingleWorkoutLine(
      clean,
      thresholdPaceSecsPerKm,
      undefined,
      Boolean(currentRepeat && inferredKind === 'work')
    );
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

  if (sport === 'Running' && thresholdPaceSecsPerKm && thresholdPaceSecsPerKm > 0) {
    const repDist = extractDistanceMeters(normalizedPrefix);
    const named = resolveNamedTrackPaceSecsPerKm(normalizedPrefix, thresholdPaceSecsPerKm);
    if (repDist && repDist >= 10 && repDist <= 3200 && named.paceSecsPerKm && !/\d+:\d{2}/.test(normalizedPrefix)) {
      const splitSecs = (named.paceSecsPerKm / 1000) * repDist;
      const mins = Math.floor(splitSecs / 60);
      const secs = splitSecs % 60;
      const splitStr =
        mins > 0
          ? `${mins}:${secs.toFixed(1).padStart(4, '0')}`
          : `${splitSecs.toFixed(1)}s`;
      return `${normalizedPrefix} (${splitStr}/rep)`;
    }
  }

  return normalizedPrefix;
}

export function inferWorkoutLibraryCategory(params: {
  sportCategory: SportCategory;
  name: string;
  description?: string;
  plannedLoad: number;
  isTrack?: boolean;
}): TeamWorkoutLibraryCategory {
  if (params.sportCategory === 'Swimming') return 'SWIMMING';
  if (params.sportCategory === 'Multisport') return 'TRIATHLON';
  if (params.sportCategory === 'Cycling') return 'CYCLING';

  const combinedText = `${params.name} ${params.description || ''}`;
  const isTrackSession =
    Boolean(params.isTrack) ||
    /\b(track|vo2|5k|mile|1600|800|400|1000|300|200|intervals?|repeats?|ladder|cv)\b/i.test(
      combinedText
    );
  const isXcOrTempoSession = /\b(tempo|sub-?t|xc|cross\s*country|hill|hills|threshold)\b/i.test(
    combinedText
  );

  if (isXcOrTempoSession && !params.isTrack) return 'XC_TEMPO';
  if (isTrackSession) return 'TRACK';
  if (isXcOrTempoSession) return 'XC_TEMPO';
  if (params.plannedLoad < 45) return 'RECOVERY';
  return 'ROAD';
}
