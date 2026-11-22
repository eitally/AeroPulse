import type {
  CoachEventGroup,
  DistanceUnit,
  TeamBrandConfig,
  TeamMemberRole,
  TeamOrgType,
} from '../types.ts';
import {
  buildTrackSpeedReserveProfile,
  solveTrackPaceSecsPerKmForPctVdot,
} from './trackSpeedReserveEngine.ts';
import {
  type AccessibleTeamPalette,
  computeAccessibleTeamPalette,
  contrastRatio,
  normalizeHexColor,
  relativeLuminance,
} from '../utils/teamPalette.ts';

export {
  type AccessibleTeamPalette,
  computeAccessibleTeamPalette,
  contrastRatio,
  normalizeHexColor,
  relativeLuminance,
};

export interface TeamPalettePreset {
  id: string;
  label: string;
  primaryHex: string;
  secondaryHex: string;
}

export const CURATED_TEAM_PALETTE_PRESETS: TeamPalettePreset[] = [
  {
    id: 'cardinal-slate',
    label: 'Varsity Cardinal & Slate',
    primaryHex: '#991B1B',
    secondaryHex: '#1E293B',
  },
  {
    id: 'forest-gold',
    label: 'Paly Forest & Athletic Gold',
    primaryHex: '#14532D',
    secondaryHex: '#D97706',
  },
  {
    id: 'navy-maize',
    label: 'Collegiate Navy & Maize',
    primaryHex: '#1E3A8A',
    secondaryHex: '#CA8A04',
  },
  {
    id: 'oregon-emerald',
    label: 'Track Emerald & Volt',
    primaryHex: '#065F46',
    secondaryHex: '#65A30D',
  },
  {
    id: 'belgian-velo',
    label: 'Classics Cobalt & Vermilion',
    primaryHex: '#0284C7',
    secondaryHex: '#D9480F',
  },
  {
    id: 'carolina-sky',
    label: 'Carolina Blue & Midnight',
    primaryHex: '#0284C7',
    secondaryHex: '#0F172A',
  },
  {
    id: 'royal-purple',
    label: 'Husky Purple & Gold',
    primaryHex: '#581C87',
    secondaryHex: '#B45309',
  },
  {
    id: 'club-terracotta',
    label: 'Club Espresso & Terracotta',
    primaryHex: '#C2410C',
    secondaryHex: '#292524',
  },
];

export interface OrgSafeguardingDefaults {
  defaultSafeSportShield: boolean;
  enableParentGuardianCc: boolean;
  defaultPrimarySport: 'Running' | 'Cycling' | 'Hybrid';
  defaultSquads: string[];
  orgBadgeLabel: string;
}

/**
 * Returns safeguarding & sport defaults for a given TeamOrgType.
 * High School programs automatically enable Safe-Sport Weight Shield (RED-S protection)
 * and Parent/Guardian CC email transparency by default.
 */
export function getOrgTypeSafeguardingDefaults(
  orgType: TeamOrgType
): OrgSafeguardingDefaults {
  switch (orgType) {
    case 'HIGH_SCHOOL':
      return {
        defaultSafeSportShield: true,
        enableParentGuardianCc: true,
        defaultPrimarySport: 'Running',
        defaultSquads: ['Varsity', 'Junior Varsity', 'Frosh/Soph'],
        orgBadgeLabel: 'High School · Safe-Sport Defaults ON',
      };
    case 'COLLEGIATE':
      return {
        defaultSafeSportShield: true,
        enableParentGuardianCc: false,
        defaultPrimarySport: 'Running',
        defaultSquads: ['Varsity Distance', 'Mid-Distance', 'Development'],
        orgBadgeLabel: 'Collegiate · NCAA CARA Enabled',
      };
    case 'RUNNING_CLUB':
      return {
        defaultSafeSportShield: false,
        enableParentGuardianCc: false,
        defaultPrimarySport: 'Running',
        defaultSquads: ['Marathon / Roads', 'Track Group', 'Community'],
        orgBadgeLabel: 'Running Club',
      };
    case 'CYCLING_CLUB':
      return {
        defaultSafeSportShield: false,
        enableParentGuardianCc: false,
        defaultPrimarySport: 'Cycling',
        defaultSquads: ['A Group / Race', 'B Group / Tempo', 'Social / Z2'],
        orgBadgeLabel: 'Cycling Team / Club',
      };
    case 'COACH_SQUAD':
    default:
      return {
        defaultSafeSportShield: false,
        enableParentGuardianCc: false,
        defaultPrimarySport: 'Hybrid',
        defaultSquads: ['Squad A', 'Squad B', '1-on-1 Coached'],
        orgBadgeLabel: 'Coaching Squad',
      };
  }
}

export function slugifyTeamName(name: string): string {
  const base = String(name || 'team')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base || 'thresh-team';
}

export function generateTeamJoinCode(shortName: string, suffixNum?: number): string {
  const prefix =
    String(shortName || 'TEAM')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 4) || 'TEAM';
  const digits =
    suffixNum !== undefined
      ? String(suffixNum).padStart(2, '0').slice(-2)
      : String(new Date().getFullYear()).slice(-2);
  return `${prefix}-${digits}`;
}

export const COACH_EVENT_GROUP_OPTIONS: ReadonlyArray<{
  id: CoachEventGroup;
  label: string;
  shortLabel: string;
}> = [
  { id: 'DISTANCE', label: 'Distance (3000m / 3200m / 5K / XC)', shortLabel: 'Distance' },
  { id: 'MID_DISTANCE', label: 'Mid-Distance (800m / 1600m / Mile)', shortLabel: 'Mid-Dist' },
  { id: 'SPRINTS', label: 'Sprints (100m / 200m / 400m)', shortLabel: 'Sprints' },
  { id: 'HURDLES', label: 'Hurdles (100H / 110H / 300H / 400H)', shortLabel: 'Hurdles' },
  { id: 'JUMPS', label: 'Jumps (LJ / TJ / HJ)', shortLabel: 'Jumps' },
  { id: 'POLE_VAULT', label: 'Pole Vault (PV)', shortLabel: 'Pole Vault' },
  { id: 'THROWS', label: 'Throws (SP / Discus / Javelin)', shortLabel: 'Throws' },
  { id: 'MULTI', label: 'Multi-Events (Pent / Hept / Dec)', shortLabel: 'Multi' },
];

export const COACH_EVENT_GROUPS: ReadonlySet<CoachEventGroup> = new Set(
  COACH_EVENT_GROUP_OPTIONS.map((opt) => opt.id)
);

const COACH_EVENT_GROUP_ALIASES: Record<string, CoachEventGroup> = {
  DIST: 'DISTANCE',
  DISTANCE: 'DISTANCE',
  XC: 'DISTANCE',
  CROSS_COUNTRY: 'DISTANCE',
  MID: 'MID_DISTANCE',
  MIDDIST: 'MID_DISTANCE',
  MID_DIST: 'MID_DISTANCE',
  MID_DISTANCE: 'MID_DISTANCE',
  SPRINT: 'SPRINTS',
  SPRINTS: 'SPRINTS',
  HURDLE: 'HURDLES',
  HURDLES: 'HURDLES',
  JUMP: 'JUMPS',
  JUMPS: 'JUMPS',
  PV: 'POLE_VAULT',
  VAULT: 'POLE_VAULT',
  POLE_VAULT: 'POLE_VAULT',
  THROW: 'THROWS',
  THROWS: 'THROWS',
  MULTI: 'MULTI',
  MULTIS: 'MULTI',
  MULTI_EVENT: 'MULTI',
  MULTI_EVENTS: 'MULTI',
};

export function normalizeCoachEventGroup(val: unknown): CoachEventGroup | null {
  if (typeof val !== 'string') return null;
  const normalized = val.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (COACH_EVENT_GROUPS.has(normalized as CoachEventGroup)) {
    return normalized as CoachEventGroup;
  }
  return COACH_EVENT_GROUP_ALIASES[normalized] || null;
}

export function sanitizeTargetEventGroups(raw: unknown): CoachEventGroup[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .map((g) => normalizeCoachEventGroup(g))
    .filter((g): g is CoachEventGroup => g !== null);
}

export interface ParsedBulkRosterRow {
  invitedName: string;
  invitedEmail?: string;
  invitedPhone?: string;
  squadGroup: string;
  eventGroup?: CoachEventGroup;
  genderDivision?: 'M' | 'F';
  graduationYear?: number;
  parentGuardianEmail?: string;
  seedMarkOrFtp?: string;
  isMinorU18: boolean;
}

function splitCsvLine(line: string, delimiter: ',' | '\t' | ';'): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function inferNameFromEmail(email: string): string {
  const local = email.split('@')[0] || 'Athlete';
  return local
    .replace(/[._-]+/g, ' ')
    .replace(/\d+/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ') || 'Team Athlete';
}

function normalizePhoneDisplay(raw: string): string | undefined {
  const cleaned = raw.trim();
  const digits = cleaned.replace(/[^\d+]/g, '');
  const onlyDigits = digits.replace(/\D/g, '');
  if (onlyDigits.length < 10 || onlyDigits.length > 15) return undefined;
  if (digits.startsWith('+')) return digits;
  if (onlyDigits.length === 10) return `+1${onlyDigits}`;
  if (onlyDigits.length === 11 && onlyDigits.startsWith('1')) return `+${onlyDigits}`;
  return `+${onlyDigits}`;
}

/**
 * Parses pasted CSV, Google Sheets TSV, or plain email/contact lists into structured
 * athlete roster rows, automatically applying High School U18 safeguarding flags.
 */
export function parseBulkRosterCsvOrText(
  rawText: string,
  orgType: TeamOrgType = 'HIGH_SCHOOL',
  defaultSquad = 'Varsity'
): ParsedBulkRosterRow[] {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const firstLine = lines[0];
  const delimiter: ',' | '\t' | ';' = firstLine.includes('\t')
    ? '\t'
    : firstLine.includes(',')
      ? ','
      : firstLine.includes(';')
        ? ';'
        : ',';

  const firstCols = splitCsvLine(firstLine, delimiter).map((c) =>
    c.toLowerCase().replace(/[^a-z0-9]/g, '')
  );

  const hasHeader =
    firstCols.length >= 2 &&
    firstCols.some((c) =>
      [
        'name',
        'athletename',
        'fullname',
        'first',
        'firstname',
        'email',
        'athleteemail',
        'phone',
        'mobile',
        'squad',
        'group',
        'pod',
        'parentemail',
        'guardianemail',
        'eventgroup',
        'event',
        'events',
        'discipline',
        'gender',
        'sex',
      ].includes(c)
    );

  const colMap = {
    name: -1,
    firstName: -1,
    lastName: -1,
    email: -1,
    phone: -1,
    squad: -1,
    eventGroup: -1,
    gender: -1,
    gradYear: -1,
    parentEmail: -1,
    seed: -1,
  };

  if (hasHeader) {
    firstCols.forEach((col, idx) => {
      if (['name', 'athletename', 'fullname', 'student', 'athlete'].includes(col)) {
        colMap.name = idx;
      } else if (['first', 'firstname', 'fname'].includes(col)) {
        colMap.firstName = idx;
      } else if (['last', 'lastname', 'lname'].includes(col)) {
        colMap.lastName = idx;
      } else if (['email', 'athleteemail', 'studentemail', 'mail'].includes(col)) {
        colMap.email = idx;
      } else if (
        ['phone', 'mobile', 'cell', 'cellphone', 'phonenumber', 'sms'].includes(col)
      ) {
        colMap.phone = idx;
      } else if (['squad', 'group', 'pod', 'level', 'division', 'team'].includes(col)) {
        colMap.squad = idx;
      } else if (['eventgroup', 'event', 'events', 'discipline'].includes(col)) {
        colMap.eventGroup = idx;
      } else if (['gender', 'sex', 'boysgirls', 'divisiongender'].includes(col)) {
        colMap.gender = idx;
      } else if (['gradyear', 'class', 'classyear', 'year', 'grad'].includes(col)) {
        colMap.gradYear = idx;
      } else if (
        [
          'parentemail',
          'guardianemail',
          'parent',
          'guardian',
          'parentcc',
          'momemail',
          'dademail',
        ].includes(col)
      ) {
        colMap.parentEmail = idx;
      } else if (
        ['seed', 'pr', 'seedmark', 'ftp', '5k', '1600m', 'mile', 'mark'].includes(col)
      ) {
        colMap.seed = idx;
      }
    });
  }

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const currentYear = new Date().getFullYear();
  const rows: ParsedBulkRosterRow[] = [];

  for (const line of dataLines) {
    // Support `First Last <user@domain.com>` single-column paste format
    const angleMatch = line.match(/^([^<,]+)<([^>]+@[^>]+)>$/);
    if (angleMatch && !hasHeader) {
      const invitedEmail = angleMatch[2].trim().toLowerCase();
      const invitedName = angleMatch[1].trim() || inferNameFromEmail(invitedEmail);
      rows.push({
        invitedName,
        invitedEmail,
        squadGroup: defaultSquad,
        isMinorU18: orgType === 'HIGH_SCHOOL',
      });
      continue;
    }

    const cols = splitCsvLine(line, delimiter);
    if (cols.every((c) => !c)) continue;

    let invitedName = '';
    let invitedEmail: string | undefined;
    let invitedPhone: string | undefined;
    let squadGroup = defaultSquad;
    let eventGroup: CoachEventGroup | undefined;
    let genderDivision: 'M' | 'F' | undefined;
    let graduationYear: number | undefined;
    let parentGuardianEmail: string | undefined;
    let seedMarkOrFtp: string | undefined;

    if (hasHeader) {
      if (colMap.name >= 0) {
        invitedName = cols[colMap.name] || '';
      } else if (colMap.firstName >= 0 || colMap.lastName >= 0) {
        invitedName = [
          colMap.firstName >= 0 ? cols[colMap.firstName] : '',
          colMap.lastName >= 0 ? cols[colMap.lastName] : '',
        ]
          .filter(Boolean)
          .join(' ');
      }
      if (colMap.email >= 0 && cols[colMap.email]?.includes('@')) {
        invitedEmail = cols[colMap.email].trim().toLowerCase();
      }
      if (colMap.phone >= 0 && cols[colMap.phone]) {
        invitedPhone = normalizePhoneDisplay(cols[colMap.phone]);
      }
      if (colMap.squad >= 0 && cols[colMap.squad]) {
        squadGroup = cols[colMap.squad].trim();
      }
      if (colMap.eventGroup >= 0 && cols[colMap.eventGroup]) {
        const rawEventGroup = cols[colMap.eventGroup].trim();
        eventGroup =
          normalizeCoachEventGroup(rawEventGroup) ||
          inferEventGroupFromSeedMark(rawEventGroup);
      }
      if (colMap.gender >= 0 && cols[colMap.gender]) {
        const gRaw = cols[colMap.gender].trim().toUpperCase();
        if (gRaw.startsWith('M') || gRaw === 'B') genderDivision = 'M';
        else if (gRaw.startsWith('F') || gRaw.startsWith('W') || gRaw === 'G') {
          genderDivision = 'F';
        }
      }
      if (colMap.gradYear >= 0 && cols[colMap.gradYear]) {
        const yr = parseInt(cols[colMap.gradYear].replace(/\D/g, ''), 10);
        if (yr >= 20 && yr <= 99) graduationYear = 2000 + yr;
        else if (yr >= 2020 && yr <= 2045) graduationYear = yr;
      }
      if (colMap.parentEmail >= 0 && cols[colMap.parentEmail]?.includes('@')) {
        parentGuardianEmail = cols[colMap.parentEmail].trim().toLowerCase();
      }
      if (colMap.seed >= 0 && cols[colMap.seed]) {
        seedMarkOrFtp = cols[colMap.seed].trim();
      }
    } else {
      // Heuristic column detection for headerless paste:
      // Scan each cell for email(s), phone, year, seed mark, or name
      const emailsFound: string[] = [];
      for (const cell of cols) {
        const trimmed = cell.trim();
        if (!trimmed) continue;
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
          emailsFound.push(trimmed.toLowerCase());
        } else if (!invitedPhone && normalizePhoneDisplay(trimmed) && /\d{3}.*\d{4}/.test(trimmed)) {
          invitedPhone = normalizePhoneDisplay(trimmed);
        } else if (!graduationYear && /^(202[4-9]|203[0-6])$/.test(trimmed)) {
          graduationYear = Number(trimmed);
        } else if (
          !seedMarkOrFtp &&
          (/^\d{1,2}:\d{2}(\.\d+)?/.test(trimmed) || /^\d{2,3}\s*w$/i.test(trimmed))
        ) {
          seedMarkOrFtp = trimmed;
        } else if (!invitedName) {
          invitedName = trimmed;
        } else if (squadGroup === defaultSquad) {
          squadGroup = trimmed;
        }
      }
      if (emailsFound[0]) invitedEmail = emailsFound[0];
      if (emailsFound[1]) parentGuardianEmail = emailsFound[1];
    }

    if (!invitedName && invitedEmail) {
      invitedName = inferNameFromEmail(invitedEmail);
    }
    if (!invitedName && !invitedEmail && !invitedPhone) continue;

    const isMinorU18 =
      orgType === 'HIGH_SCHOOL' ||
      Boolean(parentGuardianEmail) ||
      Boolean(graduationYear && orgType !== 'COLLEGIATE' && graduationYear >= currentYear + 1);

    rows.push({
      invitedName: invitedName || 'Team Athlete',
      invitedEmail,
      invitedPhone,
      squadGroup: squadGroup || defaultSquad,
      ...(eventGroup ? { eventGroup } : {}),
      ...(genderDivision ? { genderDivision } : {}),
      graduationYear,
      parentGuardianEmail,
      seedMarkOrFtp,
      isMinorU18,
    });
  }

  return rows;
}

export interface CalibratedSeedThresholds {
  cyclingFtpWatts: number;
  thresholdPaceSecsPerKm: number;
  thresholdPaceInputDisplay: string;
  easyPaceInputDisplay?: string;
  intervalPaceInputDisplay?: string;
  vdotEstimate?: number;
  summaryNote: string;
}

function parseClockSecs(clock: string): number | null {
  const parts = clock
    .trim()
    .split(':')
    .map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function formatPaceDisplay(secsPerKm: number, unit: DistanceUnit): string {
  const targetSecs = unit === 'mi' ? secsPerKm * 1.60934 : secsPerKm;
  const m = Math.floor(targetSecs / 60);
  const s = Math.round(targetSecs % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Converts a coach or athlete's natural-language race PR or power figure
 * (e.g., "17:45 5K", "5:12 1600m", "280W", "20m 300W", "280W 20m") into calibrated
 * Lactate Threshold Pace & FTP so newcomers never face intimidating lab jargon.
 */
export function calibrateThresholdsFromSeedMark(
  seedInput: string,
  primarySport: TeamBrandConfig['primarySport'] = 'Running',
  distanceUnit: DistanceUnit = 'mi'
): CalibratedSeedThresholds {
  const raw = String(seedInput || '').trim();
  const defaultPaceSecsKm = 270; // ~7:15/mi or 4:30/km
  const defaultFtp = 240;

  if (!raw) {
    return {
      cyclingFtpWatts: defaultFtp,
      thresholdPaceSecsPerKm: defaultPaceSecsKm,
      thresholdPaceInputDisplay: formatPaceDisplay(defaultPaceSecsKm, distanceUnit),
      easyPaceInputDisplay: formatPaceDisplay(Math.round(defaultPaceSecsKm * 1.24), distanceUnit),
      intervalPaceInputDisplay: formatPaceDisplay(Math.round(defaultPaceSecsKm * 0.91), distanceUnit),
      summaryNote: 'Default starter zones (auto-refines on first Strava / Garmin / FIT sync)',
    };
  }

  // Check for 20-minute power test input in either word order ("20m 300W" OR "300W 20m" / "300W (20 min)")
  const twentyMinMatch =
    raw.match(/20\s*m(?:in(?:ute)?s?)?\s*[:@-]?\s*(\d{2,3})\s*w?/i) ||
    raw.match(/(\d{2,3})\s*w(?:atts)?\s*(?:for\s*|@\s*|\(\s*|-)?\s*20\s*m(?:in)?/i);
  if (twentyMinMatch) {
    const rawWatts = Number(twentyMinMatch[1]);
    const ftp = Math.max(90, Math.min(550, Math.round(rawWatts * 0.95)));
    return {
      cyclingFtpWatts: ftp,
      thresholdPaceSecsPerKm: defaultPaceSecsKm,
      thresholdPaceInputDisplay: formatPaceDisplay(defaultPaceSecsKm, distanceUnit),
      summaryNote: `Estimated ${ftp}W FTP from 20-minute power (${rawWatts}W × 0.95)`,
    };
  }

  const wattsMatch =
    raw.match(/(\d{2,3})\s*w(?:atts)?\b/i) ||
    (primarySport !== 'Running' && /^\d{2,3}$/.test(raw) ? [raw, raw] : null);
  if (wattsMatch) {
    const ftp = Math.max(85, Math.min(550, Math.round(Number(wattsMatch[1]))));
    return {
      cyclingFtpWatts: ftp,
      thresholdPaceSecsPerKm: defaultPaceSecsKm,
      thresholdPaceInputDisplay: formatPaceDisplay(defaultPaceSecsKm, distanceUnit),
      summaryNote: `Calibrated to ${ftp}W Cycling FTP`,
    };
  }

  // Parse Race Clock Time (e.g. "17:45 5K", "5:10 1600m", "4:55 mile", "10:15 3200m", "18:30")
  const clockMatch = raw.match(/(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)/);
  if (clockMatch) {
    const totalSecs = parseClockSecs(clockMatch[1]);
    if (totalSecs && totalSecs >= 90) {
      let distMeters = 5000;
      const lower = raw.toLowerCase();
      if (/\b800\s*m?\b/.test(lower)) distMeters = 800;
      else if (/\b1500\s*m?\b/.test(lower)) distMeters = 1500;
      else if (/\b1600\s*m?\b/.test(lower)) distMeters = 1600;
      else if (lower.includes('mile') && !lower.includes('2 mile') && !lower.includes('two mile')) {
        distMeters = 1609.34;
      } else if (/\b3000\s*m?\b|\b3k\b/.test(lower)) distMeters = 3000;
      else if (/\b3200\s*m?\b|2\s*mile|two\s*mile/.test(lower)) distMeters = 3200;
      else if (/\b5k\b|\b5000\s*m?\b/.test(lower)) distMeters = 5000;
      else if (/\b10k\b|\b10000\s*m?\b/.test(lower)) distMeters = 10000;
      else if (lower.includes('half') || /\bhm\b/.test(lower)) distMeters = 21097.5;
      else if (lower.includes('marathon')) distMeters = 42195;
      else if (totalSecs < 165) distMeters = 800; // < 2:45 bare time -> 800m
      else if (totalSecs < 450) distMeters = 1600; // 2:45..7:29 bare time -> 1600m
      else if (totalSecs < 810) distMeters = 3200; // 7:30..13:29 bare time -> 3200m (never 5K WR!)
      else distMeters = 5000; // 13:30+ bare time -> 5K

      // 2-Parameter Speed-Reserve calibrated aerobic VDOT with un-clamped track paces
      const profile = buildTrackSpeedReserveProfile({
        marks: [{ distanceMeters: distMeters, durationSecs: totalSecs }],
      });
      const vdot = Math.max(24, Math.min(90, Number(profile.vdotAer.toFixed(1))));

      const ltSecsPerKm = Math.round(solveTrackPaceSecsPerKmForPctVdot(vdot, 0.88, [115, 520]));
      const easySecsPerKm = Math.round(solveTrackPaceSecsPerKmForPctVdot(vdot, 0.70, [145, 560]));
      const intervalSecsPerKm = Math.round(solveTrackPaceSecsPerKmForPctVdot(vdot, 0.98, [115, 480]));

      const disp = formatPaceDisplay(ltSecsPerKm, distanceUnit);
      const easyDisp = formatPaceDisplay(easySecsPerKm, distanceUnit);
      const intDisp = formatPaceDisplay(intervalSecsPerKm, distanceUnit);
      const eventLabel =
        distMeters === 1609.34
          ? 'Mile'
          : distMeters === 21097.5
            ? 'Half Marathon'
            : distMeters === 42195
              ? 'Marathon'
              : `${Math.round(distMeters)}m`;
      return {
        cyclingFtpWatts: defaultFtp,
        thresholdPaceSecsPerKm: ltSecsPerKm,
        thresholdPaceInputDisplay: disp,
        easyPaceInputDisplay: easyDisp,
        intervalPaceInputDisplay: intDisp,
        vdotEstimate: vdot,
        summaryNote: `VDOT ${vdot} · Easy ${easyDisp}/${distanceUnit} · Threshold ${disp}/${distanceUnit} · VO2 ${intDisp}/${distanceUnit} (from ${clockMatch[1]} ${eventLabel})`,
      };
    }
  }

  return {
    cyclingFtpWatts: defaultFtp,
    thresholdPaceSecsPerKm: defaultPaceSecsKm,
    thresholdPaceInputDisplay: formatPaceDisplay(defaultPaceSecsKm, distanceUnit),
    summaryNote: 'Starter zones ready',
  };
}

/**
 * Builds a zero-cost native iMessage / SMS URI (`sms:`) so coaches can text magic join links
 * from their phone or Mac without Twilio SMS fees.
 */
export function buildFreeNativeSmsUri(
  phoneE164: string,
  teamBrand: Pick<TeamBrandConfig, 'name' | 'joinCode' | 'coachDisplayName'>,
  magicJoinUrl: string,
  athleteFirstName?: string
): string {
  const greeting = athleteFirstName ? `Hi ${athleteFirstName} — ` : '';
  const body = `${greeting}Coach ${teamBrand.coachDisplayName} invited you to join ${teamBrand.name} on MeetReady. Tap to claim your spot (Code ${teamBrand.joinCode}): ${magicJoinUrl}`;
  return `sms:${phoneE164}?&body=${encodeURIComponent(body)}`;
}

/**
 * Infers an event group (SPRINTS / MID_DISTANCE / DISTANCE) from a seed mark or event label.
 */
export function inferEventGroupFromSeedMark(seed?: string): CoachEventGroup | undefined {
  if (!seed || !seed.trim()) return undefined;
  const s = seed.trim();
  const explicitGroup = normalizeCoachEventGroup(s);
  if (explicitGroup) return explicitGroup;
  if (/\b(?:3000\s*m?|3200\s*m?|5000\s*m?|5\s*k|6000\s*m?|6\s*k|8000\s*m?|8\s*k|10000\s*m?|10\s*k|2\s*miles?|2\s*mi|xc|cross\s*country)\b/i.test(s)) {
    return 'DISTANCE';
  }
  if (/\b(?:800\s*m?|1000\s*m?|1500\s*m?|1600\s*m?|1\s*mile|mile|steeple(?:chase)?|3000\s*sc)\b/i.test(s)) {
    return 'MID_DISTANCE';
  }
  // Check hurdles before generic sprints/dash patterns
  if (/\b(?:100\s*m?\s*h|110\s*m?\s*h|300\s*m?\s*h|400\s*m?\s*h|hurdles?)\b/i.test(s)) {
    return 'HURDLES';
  }
  if (/\b(?:pv|pole\s*vault)\b/i.test(s)) {
    return 'POLE_VAULT';
  }
  if (/\b(?:lj|tj|hj|long\s*jump|triple\s*jump|high\s*jump|jumps?)\b/i.test(s)) {
    return 'JUMPS';
  }
  if (/\b(?:sp|shot\s*put|shot|discus|disc|jav(?:elin)?|hammer|weight\s*throw|throws?)\b/i.test(s)) {
    return 'THROWS';
  }
  if (/\b(?:pent(?:athlon)?|hept(?:athlon)?|dec(?:athlon)?|multi(?:s|-events?)?)\b/i.test(s)) {
    return 'MULTI';
  }
  if (/\b(?:100\s*m?|200\s*m?|400\s*m?|dash|sprint)\b/i.test(s)) {
    return 'SPRINTS';
  }
  return undefined;
}

export interface CoachSpecialtyPreset {
  id: string;
  title: string;
  defaultRole: Extract<TeamMemberRole, 'HEAD_COACH' | 'ASSISTANT_COACH' | 'ATHLETIC_TRAINER'>;
  defaultEventGroups: CoachEventGroup[];
}

export const COACH_SPECIALTY_PRESETS: ReadonlyArray<CoachSpecialtyPreset> = [
  { id: 'head', title: 'Head Coach', defaultRole: 'HEAD_COACH', defaultEventGroups: [] },
  {
    id: 'distance',
    title: 'Distance Coach',
    defaultRole: 'ASSISTANT_COACH',
    defaultEventGroups: ['DISTANCE', 'MID_DISTANCE'],
  },
  { id: 'sprints', title: 'Sprint Coach', defaultRole: 'ASSISTANT_COACH', defaultEventGroups: ['SPRINTS'] },
  { id: 'hurdles', title: 'Hurdles Coach', defaultRole: 'ASSISTANT_COACH', defaultEventGroups: ['HURDLES'] },
  { id: 'jumps', title: 'Jumps Coach', defaultRole: 'ASSISTANT_COACH', defaultEventGroups: ['JUMPS'] },
  {
    id: 'pole_vault',
    title: 'Pole Vault Coach',
    defaultRole: 'ASSISTANT_COACH',
    defaultEventGroups: ['POLE_VAULT'],
  },
  { id: 'throws', title: 'Throws Coach', defaultRole: 'ASSISTANT_COACH', defaultEventGroups: ['THROWS'] },
  { id: 'multi', title: 'Multi-Events Coach', defaultRole: 'ASSISTANT_COACH', defaultEventGroups: ['MULTI'] },
  {
    id: 'trainer',
    title: 'Athletic Trainer',
    defaultRole: 'ATHLETIC_TRAINER',
    defaultEventGroups: [],
  },
];

/**
 * Returns true when an event coach or assistant owns a specific athlete via either explicit
 * athlete subset assignment (`assignedAthleteMembershipIds`) OR their assigned `coachEventGroups`.
 * Coaches without group/athlete restrictions (e.g. Head Coach) see all athletes.
 */
export function doesCoachOwnAthlete(params: {
  coachEventGroups?: CoachEventGroup[];
  assignedAthleteMembershipIds?: string[];
  athleteEventGroup?: CoachEventGroup | null;
  athleteMembershipId?: string;
}): boolean {
  const explicitIds = params.assignedAthleteMembershipIds || [];
  const groups = params.coachEventGroups || [];
  if (explicitIds.length === 0 && groups.length === 0) return true;
  if (params.athleteMembershipId && explicitIds.includes(params.athleteMembershipId)) {
    return true;
  }
  if (groups.length > 0 && params.athleteEventGroup && groups.includes(params.athleteEventGroup)) {
    return true;
  }
  return false;
}
