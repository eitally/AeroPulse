import type {
  DistanceUnit,
  TeamBrandConfig,
  TeamOrgType,
} from '../types.ts';

export interface AccessibleTeamPalette {
  primaryHex: string;
  secondaryHex: string;
  primaryOnLight: string; // >= 4.5:1 against #FFFFFF
  primaryOnDark: string; // >= 4.5:1 against #121419
  secondaryOnLight: string;
  secondaryOnDark: string;
  textOnPrimaryLight: '#FFFFFF' | '#111318';
  hairlineGradientLight: string;
  hairlineGradientDark: string;
}

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
    primaryHex: '#1D4ED8',
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

export function normalizeHexColor(input: string, fallback = '#1D4ED8'): string {
  const clean = String(input || '')
    .trim()
    .replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    return `#${clean
      .split('')
      .map((c) => c + c)
      .join('')
      .toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return `#${clean.toUpperCase()}`;
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const norm = normalizeHexColor(hex);
  const r = parseInt(norm.slice(1, 3), 16);
  const g = parseInt(norm.slice(3, 5), 16);
  const b = parseInt(norm.slice(5, 7), 16);
  return [r, g, b];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = ((h % 360) + 360) % 360 / 360;
  const sn = Math.max(0, Math.min(100, s)) / 100;
  const ln = Math.max(0, Math.min(100, l)) / 100;

  if (sn === 0) {
    const v = ln * 255;
    return [v, v, v];
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };

  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  return [
    hue2rgb(p, q, hn + 1 / 3) * 255,
    hue2rgb(p, q, hn) * 255,
    hue2rgb(p, q, hn - 1 / 3) * 255,
  ];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(hexA: string, hexB: string): number {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function ensureContrastAgainstSurface(
  hex: string,
  surfaceHex: string,
  minRatio = 4.55
): string {
  const clean = normalizeHexColor(hex);
  if (contrastRatio(clean, surfaceHex) >= minRatio) return clean;

  const surfaceLum = relativeLuminance(surfaceHex);
  const [r, g, b] = hexToRgb(clean);
  const [h, s, startL] = rgbToHsl(r, g, b);
  const darken = surfaceLum > 0.5;

  let curL = startL;
  for (let i = 0; i < 45; i++) {
    curL = darken ? Math.max(8, curL - 2) : Math.min(92, curL + 2);
    const [nr, ng, nb] = hslToRgb(h, Math.max(s, 35), curL);
    const candidate = rgbToHex(nr, ng, nb);
    if (contrastRatio(candidate, surfaceHex) >= minRatio) {
      return candidate;
    }
  }
  return darken ? '#1E3A8A' : '#93C5FD';
}

/**
 * Generates WCAG 2.1 AA contrast-verified light & dark chrome variants for any
 * school or club color pair while keeping THRESH's physiological zone colors untouched.
 */
export function computeAccessibleTeamPalette(
  rawPrimaryHex: string,
  rawSecondaryHex: string
): AccessibleTeamPalette {
  const primaryHex = normalizeHexColor(rawPrimaryHex, '#1D4ED8');
  const secondaryHex = normalizeHexColor(rawSecondaryHex, '#D9480F');

  const primaryOnLight = ensureContrastAgainstSurface(primaryHex, '#FFFFFF', 4.6);
  const primaryOnDark = ensureContrastAgainstSurface(primaryHex, '#121419', 4.6);
  const secondaryOnLight = ensureContrastAgainstSurface(
    secondaryHex,
    '#FFFFFF',
    4.5
  );
  const secondaryOnDark = ensureContrastAgainstSurface(
    secondaryHex,
    '#121419',
    4.5
  );

  const whiteContrast = contrastRatio(primaryOnLight, '#FFFFFF');
  const textOnPrimaryLight: '#FFFFFF' | '#111318' =
    whiteContrast >= 4.2 ? '#FFFFFF' : '#111318';

  return {
    primaryHex,
    secondaryHex,
    primaryOnLight,
    primaryOnDark,
    secondaryOnLight,
    secondaryOnDark,
    textOnPrimaryLight,
    hairlineGradientLight: `linear-gradient(90deg, ${primaryOnLight} 0%, ${secondaryOnLight} 100%)`,
    hairlineGradientDark: `linear-gradient(90deg, ${primaryOnDark} 0%, ${secondaryOnDark} 100%)`,
  };
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

export interface ParsedBulkRosterRow {
  invitedName: string;
  invitedEmail?: string;
  invitedPhone?: string;
  squadGroup: string;
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
      ].includes(c)
    );

  const colMap = {
    name: -1,
    firstName: -1,
    lastName: -1,
    email: -1,
    phone: -1,
    squad: -1,
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
      Boolean(graduationYear && graduationYear >= currentYear);

    rows.push({
      invitedName: invitedName || 'Team Athlete',
      invitedEmail,
      invitedPhone,
      squadGroup: squadGroup || defaultSquad,
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
 * (e.g., "17:45 5K", "5:12 1600m", "280W", "20m 300W") into calibrated
 * Lactate Threshold Pace & FTP so newcomers never face intimidating lab jargon.
 */
export function calibrateThresholdsFromSeedMark(
  seedInput: string,
  primarySport: 'Running' | 'Cycling' | 'Hybrid' = 'Running',
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
      summaryNote: 'Default starter zones (auto-refines on first Garmin / FIT sync)',
    };
  }

  // Check for Wattage input (e.g. "285W", "20m 300w", or bare 3-digit watts for cyclists)
  const twentyMinMatch = raw.match(/20\s*m(?:in)?\s*[:@]?\s*(\d{2,3})\s*w?/i);
  if (twentyMinMatch) {
    const ftp = Math.max(90, Math.min(550, Math.round(Number(twentyMinMatch[1]) * 0.95)));
    return {
      cyclingFtpWatts: ftp,
      thresholdPaceSecsPerKm: defaultPaceSecsKm,
      thresholdPaceInputDisplay: formatPaceDisplay(defaultPaceSecsKm, distanceUnit),
      summaryNote: `Estimated ${ftp}W FTP from 20-minute power (${twentyMinMatch[1]}W × 0.95)`,
    };
  }

  const wattsMatch =
    raw.match(/(\d{2,3})\s*w(?:atts)?\b/i) ||
    (primarySport === 'Cycling' && /^\d{2,3}$/.test(raw) ? [raw, raw] : null);
  if (wattsMatch) {
    const ftp = Math.max(85, Math.min(550, Math.round(Number(wattsMatch[1]))));
    return {
      cyclingFtpWatts: ftp,
      thresholdPaceSecsPerKm: defaultPaceSecsKm,
      thresholdPaceInputDisplay: formatPaceDisplay(defaultPaceSecsKm, distanceUnit),
      summaryNote: `Calibrated to ${ftp}W Cycling FTP`,
    };
  }

  // Parse Race Clock Time (e.g. "17:45 5K", "5:10 1600m", "4:55 mile", "11:10 3200m", "18:30")
  const clockMatch = raw.match(/(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)/);
  if (clockMatch) {
    const totalSecs = parseClockSecs(clockMatch[1]);
    if (totalSecs && totalSecs >= 100) {
      let distMeters = 5000;
      const lower = raw.toLowerCase();
      if (lower.includes('800')) distMeters = 800;
      else if (lower.includes('1500')) distMeters = 1500;
      else if (lower.includes('1600')) distMeters = 1600;
      else if (lower.includes('mile') || /\b1\s*mi\b/.test(lower)) distMeters = 1609.34;
      else if (lower.includes('3000') || lower.includes('3k')) distMeters = 3000;
      else if (lower.includes('3200') || lower.includes('2 mile')) distMeters = 3200;
      else if (lower.includes('10k') || lower.includes('10000')) distMeters = 10000;
      else if (lower.includes('half') || lower.includes('hm')) distMeters = 21097.5;
      else if (totalSecs < 570) distMeters = 1600; // < 9:30 bare time -> 1600m
      else distMeters = 5000; // 9:30+ bare time -> 5K

      // Daniels VDOT estimation
      const tMins = totalSecs / 60;
      const vMetersPerMin = distMeters / tMins;
      const vo2 =
        -4.6 + 0.182258 * vMetersPerMin + 0.000104 * vMetersPerMin * vMetersPerMin;
      const pctMax =
        0.8 +
        0.1894393 * Math.exp(-0.012778 * tMins) +
        0.2989558 * Math.exp(-0.1932605 * tMins);
      const vdot = Math.max(28, Math.min(86, Number((vo2 / pctMax).toFixed(1))));

      // Threshold intensity is ~88% of VDOT velocity
      const tVo2 = vdot * 0.88;
      const a = 0.000104;
      const b = 0.182258;
      const c = -4.6 - tVo2;
      const tVelMpm = (-b + Math.sqrt(Math.max(0.01, b * b - 4 * a * c))) / (2 * a);
      const ltSecsPerKm = Math.max(
        155,
        Math.min(460, Math.round((1000 / Math.max(120, tVelMpm)) * 60))
      );

      const disp = formatPaceDisplay(ltSecsPerKm, distanceUnit);
      return {
        cyclingFtpWatts: defaultFtp,
        thresholdPaceSecsPerKm: ltSecsPerKm,
        thresholdPaceInputDisplay: disp,
        vdotEstimate: vdot,
        summaryNote: `VDOT ${vdot} · Threshold Pace ${disp}/${distanceUnit} (from ${clockMatch[1]} ${Math.round(distMeters)}m)`,
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
  const body = `${greeting}Coach ${teamBrand.coachDisplayName} invited you to join ${teamBrand.name} on THRESH. Tap to claim your spot (Code ${teamBrand.joinCode}): ${magicJoinUrl}`;
  return `sms:${phoneE164}?&body=${encodeURIComponent(body)}`;
}
