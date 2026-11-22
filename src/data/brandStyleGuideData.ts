export type ColorCopyFormat = 'HEX' | 'RGB' | 'HSL' | 'CSS';

export interface BrandColorTokenSpec {
  id: string;
  name: string;
  role: string;
  lightHex: string;
  darkHex: string;
  cssVar: string;
  tsKey?: string;
  contrastNote: string;
  wcagBadge: string;
}

export interface PhysiologyZoneSpec {
  zone: string;
  name: string;
  domain: string;
  hex: string;
  cssVar: string;
  textOnSwatch: '#FFFFFF' | '#080A09';
}

export interface TypographySpecimenSpec {
  role: string;
  fontFamily: string;
  sizeLabel: string;
  weightLabel: string;
  trackingLabel: string;
  sampleText: string;
  isMono?: boolean;
  className: string;
}

export interface PressBoilerplateSpec {
  id: string;
  label: string;
  wordCountLabel: string;
  text: string;
}

function parseHexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.slice(0, 6);
  const r = parseInt(full.slice(0, 2) || '0', 16);
  const g = parseInt(full.slice(2, 4) || '0', 16);
  const b = parseInt(full.slice(4, 6) || '0', 16);
  return [r, g, b];
}

export function formatColorTokenValue(
  hex: string,
  format: ColorCopyFormat,
  cssVar?: string
): string {
  const upper = hex.toUpperCase();
  if (format === 'HEX') return upper;
  if (format === 'CSS') return cssVar ? `var(${cssVar})` : upper;

  const [r, g, b] = parseHexToRgb(upper);
  if (format === 'RGB') return `rgb(${r}, ${g}, ${b})`;

  // HSL
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
      default:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }
  return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

export const STADIUM_BUDGET_SLICES = [
  {
    id: 'neutral',
    percent: 80,
    label: '80% Neutral Stage & Paper',
    lightHex: '#F4F7F2',
    darkHex: '#0B120E',
    detail: 'Stadium Chalk / White cards in daylight; Obsidian-Pine / Carbon-Pine after dark.',
  },
  {
    id: 'pine',
    percent: 15,
    label: '15% Structural Pine & Wells',
    lightHex: '#163022',
    darkHex: '#15231B',
    detail: '2px Pine architectural framing, outer stadium surround, and flat recessed turf wells.',
  },
  {
    id: 'volt',
    percent: 5,
    label: '<= 5% Track Volt Focal Ink',
    lightHex: '#C8FF00',
    darkHex: '#C8FF00',
    detail: 'Primary CTAs, active tabs, and threshold needles — always paired with #080A09 ink.',
  },
];

export const ARCHITECTURE_COLOR_TOKENS: BrandColorTokenSpec[] = [
  {
    id: 'track-volt',
    name: 'Track Volt',
    role: 'Primary CTA fill, active track tab, gauge needle',
    lightHex: '#C8FF00',
    darkHex: '#C8FF00',
    cssVar: '--color-ap-volt',
    tsKey: 'brandCobalt (dark)',
    contrastNote: 'Pair solid fill strictly with Obsidian Ink (#080A09)',
    wcagBadge: '> 15:1 AAA',
  },
  {
    id: 'stadium-pine',
    name: 'Stadium Pine',
    role: 'Light-mode brand accent & inline brand ink',
    lightHex: '#1C5436',
    darkHex: '#399663',
    cssVar: '--ap-brand-primary',
    tsKey: 'brandCobalt (light)',
    contrastNote: 'Replaces raw Volt ink on white/chalk backgrounds',
    wcagBadge: '8.7:1 AAA',
  },
  {
    id: 'volt-olive-ink',
    name: 'Volt Olive / Lime Ink',
    role: 'Micro-telemetry uppercase labels (.ap-telemetry-label)',
    lightHex: '#3F6212',
    darkHex: '#A3E635',
    cssVar: '--color-ap-volt-ink',
    contrastNote: 'High-contrast telemetry kicker & hairline accent ink',
    wcagBadge: '7.1:1 AAA',
  },
  {
    id: 'stadium-surround',
    name: 'Stadium Surround',
    role: 'Outer body canvas behind the 2px Pine stage frame',
    lightHex: '#163022',
    darkHex: '#0C1D14',
    cssVar: '--ap-outer-bg',
    contrastNote: 'Lit by subtle 12%–14% upper-left floodlight radial glow',
    wcagBadge: 'Frame',
  },
  {
    id: 'workspace-stage',
    name: 'Chalk / Obsidian Stage',
    role: 'Primary .ap-content-stage background canvas',
    lightHex: '#F4F7F2',
    darkHex: '#0B120E',
    cssVar: '--ap-canvas-bg',
    tsKey: 'canvasBg',
    contrastNote: 'Opaque workspace plane — zero backdrop-filter blur',
    wcagBadge: 'Plane 2',
  },
  {
    id: 'telemetry-card',
    name: 'Crisp Paper / Carbon-Pine',
    role: 'Primary .ap-card telemetry container surface',
    lightHex: '#FFFFFF',
    darkHex: '#101B15',
    cssVar: '--ap-card-bg',
    tsKey: 'cardBg',
    contrastNote: 'Bounded by crisp 1px pine-tinted structural hairline',
    wcagBadge: 'Plane 3',
  },
  {
    id: 'inset-well',
    name: 'Chalk Inset / Deep Turf',
    role: 'Nested KPI bento cells, pill tracks, form inputs',
    lightHex: '#E9EFE9',
    darkHex: '#15231B',
    cssVar: '--ap-inset-bg',
    tsKey: 'insetBg',
    contrastNote: 'Shadowless recessed well replacing nested box shadows',
    wcagBadge: 'Plane 4',
  },
  {
    id: 'primary-ink',
    name: 'Primary Foreground Ink',
    role: 'Headings, KPI readouts & primary body copy',
    lightHex: '#101411',
    darkHex: '#F4F7F4',
    cssVar: '--ap-ink-primary',
    tsKey: 'textPrimary',
    contrastNote: 'Neutral obsidian vs. crisp mist white',
    wcagBadge: '16.8:1 AAA',
  },
  {
    id: 'muted-ink',
    name: 'Muted Axis Ink',
    role: 'Chart axes, captions & metadata labels',
    lightHex: '#43584B',
    darkHex: '#93A39A',
    cssVar: '--ap-ink-muted',
    tsKey: 'textMuted',
    contrastNote: 'Pine-tinted neutral calibrated cleanly above AA floor',
    wcagBadge: '6.2:1 AA+',
  },
];

export const SACRED_ZONES_SPECTRUM: PhysiologyZoneSpec[] = [
  {
    zone: 'Z1',
    name: 'Cool Mist',
    domain: 'Active Recovery',
    hex: '#94A3B8',
    cssVar: '--color-ap-z1',
    textOnSwatch: '#080A09',
  },
  {
    zone: 'Z2',
    name: 'Aerobic Teal',
    domain: 'Endurance Base',
    hex: '#0D9488',
    cssVar: '--color-ap-z2',
    textOnSwatch: '#FFFFFF',
  },
  {
    zone: 'Z3',
    name: 'Ochre',
    domain: 'Tempo / Sub-T',
    hex: '#D97706',
    cssVar: '--color-ap-z3',
    textOnSwatch: '#080A09',
  },
  {
    zone: 'Z4',
    name: 'Threshold Vermilion',
    domain: 'LT2 / CS / FTP',
    hex: '#EA580C',
    cssVar: '--color-ap-z4',
    textOnSwatch: '#FFFFFF',
  },
  {
    zone: 'Z5',
    name: 'Crimson',
    domain: 'VO2max / I-Pace',
    hex: '#DC2626',
    cssVar: '--color-ap-z5',
    textOnSwatch: '#FFFFFF',
  },
  {
    zone: 'Z6',
    name: 'Deep Violet',
    domain: "Anaerobic D' / W'",
    hex: '#7C3AED',
    cssVar: '--color-ap-z6',
    textOnSwatch: '#FFFFFF',
  },
];

export const SACRED_PMC_SERIES: BrandColorTokenSpec[] = [
  {
    id: 'pmc-ctl',
    name: '42d CTL (Fitness)',
    role: 'Chronic Training Load spline & Low Aerobic bar',
    lightHex: '#0D9488',
    darkHex: '#2DD4BF',
    cssVar: '--color-ap-ctl',
    tsKey: 'ctlCyan',
    contrastNote: 'Invariant across team themes — never overridden',
    wcagBadge: 'Locked',
  },
  {
    id: 'pmc-atl',
    name: '7d ATL (Fatigue)',
    role: 'Acute Training Load curve',
    lightHex: '#E11D48',
    darkHex: '#FB7185',
    cssVar: '--color-ap-atl',
    tsKey: 'atlRose',
    contrastNote: 'High-contrast rose against both Chalk & Obsidian canvases',
    wcagBadge: 'Locked',
  },
  {
    id: 'pmc-tsb-opt',
    name: 'TSB Optimal Window',
    role: 'Peak race-readiness form corridor (+5 to +20)',
    lightHex: '#059669',
    darkHex: '#34D399',
    cssVar: '--color-ap-tsb-opt',
    tsKey: 'tsbOptimalEmerald',
    contrastNote: 'Emerald taper zone indicator',
    wcagBadge: 'Locked',
  },
  {
    id: 'pmc-tsb-fresh',
    name: 'TSB Fresh / Transition',
    role: 'Fresh / unstrained training readiness band',
    lightHex: '#0284C7',
    darkHex: '#38BDF8',
    cssVar: '--color-ap-tsb-fresh',
    tsKey: 'tsbFreshSky',
    contrastNote: 'Canonical telemetry sky blue',
    wcagBadge: 'Locked',
  },
];

export const READINESS_PILL_SPECS = [
  {
    id: 'prime',
    label: 'PRIME · OPTIMAL PROGRESSION',
    className: 'ap-status-prime',
    lightColors: '#ECFDF5 bg / #065F46 ink',
    darkColors: '15% Emerald / #6EE7B7 ink',
    meaning: 'Optimal HRV / Ln rMSSD, CARA compliant, Safe-Sport shielded.',
  },
  {
    id: 'info',
    label: 'CALIBRATING · DAY-1 HONESTY',
    className: 'ap-status-info',
    lightColors: '#F7FEE7 bg / #365314 ink',
    darkColors: '12% Volt / #D9F99D ink',
    meaning: 'Balanced aerobic load or explicit uncalibrated Day-1 state.',
  },
  {
    id: 'caution',
    label: 'MODULATED -15% · DRIFT WATCH',
    className: 'ap-status-caution',
    lightColors: '#FFFBEB bg / #92400E ink',
    darkColors: '15% Amber / #FCD34D ink',
    meaning: 'Attenuated interval volume, heat/wind scaling, or drift notice.',
  },
  {
    id: 'strained',
    label: 'STOP · BONE-STRESS / OVERREACH',
    className: 'ap-status-strained',
    lightColors: '#FFF1F2 bg / #9F1239 ink',
    darkColors: '15% Rose / #FDA4AF ink',
    meaning: 'Suppressed HRV, 48h trainer-only lock, or TSB < -30 guardrail.',
  },
];

export const PARTNER_ISOLATION_TOKENS: BrandColorTokenSpec[] = [
  {
    id: 'strava-cta',
    name: 'Strava Partner OAuth Fill',
    role: 'Dedicated Connect with Strava button (.ap-btn-strava, >= 48px tall)',
    lightHex: '#C23800',
    darkHex: '#C23800',
    cssVar: '.ap-btn-strava',
    contrastNote: 'Deepened from #FC4C02 for 5.44:1 WCAG AA white ink contrast',
    wcagBadge: '5.44:1 AA',
  },
  {
    id: 'strava-text',
    name: 'Strava Provenance Ink',
    role: 'Attribution labels & Compatible with Strava badges',
    lightHex: '#B83500',
    darkHex: '#FF7A45',
    cssVar: '.ap-text-strava',
    contrastNote: 'Isolated exclusively to Strava sync & clean-room receipts',
    wcagBadge: 'Isolated',
  },
];

export const TYPOGRAPHY_HIERARCHY: TypographySpecimenSpec[] = [
  {
    role: 'Display',
    fontFamily: 'Plus Jakarta Sans',
    sizeLabel: 'clamp(1.5rem, 2.5vw, 1.875rem) / 24–30px',
    weightLabel: '700 Bold',
    trackingLabel: '-0.025em',
    sampleText: 'MeetReady Stadium Track OS',
    className: 'font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-white',
  },
  {
    role: 'Headline',
    fontFamily: 'Plus Jakarta Sans',
    sizeLabel: '1.125rem / 18px',
    weightLabel: '700 Bold',
    trackingLabel: '-0.025em',
    sampleText: 'Adaptive CS + D’ Track Prescriptions & 0.01s Splits',
    className: 'font-display text-lg font-bold tracking-tight text-slate-950 dark:text-white',
  },
  {
    role: 'Body',
    fontFamily: 'Plus Jakarta Sans',
    sizeLabel: '0.875rem / 14px · leading 1.62',
    weightLabel: '400 Regular',
    trackingLabel: '-0.011em',
    sampleText:
      'Calibrated directly from Critical Speed, Anaerobic Distance Capacity, and overnight Ln rMSSD — zero fabricated Day-1 scores.',
    className: 'text-sm leading-relaxed text-slate-700 dark:text-slate-300 max-w-[68ch]',
  },
  {
    role: 'Label (11px Floor)',
    fontFamily: 'JetBrains Mono',
    sizeLabel: '0.6875rem / 11px (--text-2xs floor)',
    weightLabel: '700 Bold',
    trackingLabel: '+0.06em uppercase',
    sampleText: 'LANE 4 STAGGER · 42D CTL 74 · SAFE-SPORT U18 ACTIVE',
    isMono: true,
    className: 'font-mono text-2xs font-bold uppercase tracking-[0.06em] ap-telemetry-label',
  },
  {
    role: 'KPI Readout',
    fontFamily: 'JetBrains Mono',
    sizeLabel: '1.5rem / 24px (tabular-nums)',
    weightLabel: '700 Bold',
    trackingLabel: '-0.03em',
    sampleText: '61.4s / 400m  ·  4:05.12  ·  348W',
    isMono: true,
    className: 'font-mono tabular-nums text-2xl font-bold tracking-[-0.03em] text-slate-950 dark:text-white',
  },
];

export const BRAND_DO_DONT_RULES = [
  {
    id: 'volt-on-white',
    doTitle: 'Dark Ink on Track Volt',
    doDetail: 'Pair solid #C8FF00 fills with Obsidian Ink (#080A09), or switch light text to Pine (#1C5436) & Volt Olive (#3F6212).',
    dontTitle: 'Never Raw Volt Text on White',
    dontDetail: 'Raw #C8FF00 text on Chalk or Crisp Paper drops below 1.4:1 contrast and disappears on projectors or B&W copiers.',
  },
  {
    id: 'one-ink-knockout',
    doTitle: 'True Compound-Path Knockouts',
    doDetail: 'Use the 1-Ink Black, White, or Volt knockout SVGs for singlets, heat-transfer vinyl, canopies, and laser heat sheets.',
    dontTitle: 'Never Paint Fake Background Strokes',
    dontDetail: 'Never cover multi-tone masks or slap #FFFFFF drop shadows under the mark on colored fabric or busy photos.',
  },
  {
    id: 'sacred-zones',
    doTitle: 'Respect Sacred Physiology Zones',
    doDetail: 'Let Team Co-Branding theme outer Pine chrome & CTAs while keeping Z1–Z6 and Banister CTL/ATL/TSB locked.',
    dontTitle: 'Never Re-Theme Z1–Z6 Colors',
    dontDetail: 'Re-coloring Lactate Threshold or Overreach markers into school colors breaks athlete fatigue recognition.',
  },
  {
    id: 'sheared-tabs',
    doTitle: 'Counter-Skew -14° Chrome Labels',
    doDetail: 'Always nest .ap-track-tab-inner (skewX(+14°)) inside -14° tabs and preserve at least 1R clear space around marks.',
    dontTitle: 'Never Distort or Combine Partner Logos',
    dontDetail: 'Never stretch the aspect ratio, skew wordmark letterforms, or lock Strava/Garmin logos directly onto the MeetReady badge.',
  },
];

export const BRAND_PERMISSIONS_POLICY = [
  {
    title: 'Editorial, Podcasts & Meet Timers',
    status: 'PERMITTED',
    detail:
      'Use unmodified MeetReady lockups, Die-Cut Pill badges, or 1-Ink Stencils in race heat sheets, FinishLynx/AthleticLIVE overlays, press coverage, coaching clinics, and API partner directories.',
  },
  {
    title: 'Active Team Tents, Warm-Ups & Rosters',
    status: 'PERMITTED',
    detail:
      'Scholastic, collegiate, and running/cycling clubs may use Team × MeetReady co-branded exports on team banners, booster flyers, locker-room QR posters, and practice warm-ups without implied institutional endorsement.',
  },
  {
    title: 'NFHS / NCAA Competition Uniform Rule',
    status: 'UNIFORM CAP',
    detail:
      'On official interscholastic or collegiate competition singlets and shorts, keep any single manufacturer/platform mark within the <= 2.25 sq in area limit (max 2.25 in any dimension) or place on non-competition warm-ups.',
  },
  {
    title: 'Commercial Merchandise Resale',
    status: 'PROHIBITED',
    detail:
      'Selling standalone MeetReady-branded retail merchandise, altering gauge/wordmark proportions, using retired legacy brand names in public copy, or recoding Z1–Z6 physiology colors is not permitted.',
  },
];

export const PRESS_BOILERPLATES: PressBoilerplateSpec[] = [
  {
    id: 'one-line',
    label: 'Partner Directory 1-Liner',
    wordCountLabel: '18 words',
    text: 'MeetReady — Track & Field & Cross Country Team OS uniting team pace pods, watchless 0.01s split timing, Banister load, and 1Hz physiology.',
  },
  {
    id: 'short-35',
    label: 'Meet Program / Event Blurb',
    wordCountLabel: '36 words',
    text: 'MeetReady combines laboratory-grade running and cycling physiology with scholastic and collegiate team operations — unifying Critical Speed and CP/W’ pacing, overnight HRV readiness, watchless 0.01s multi-athlete trackside timing, and automatic youth Safe-Sport protection in one workspace.',
  },
  {
    id: 'standard-75',
    label: 'Full Press & Partner Boilerplate',
    wordCountLabel: '72 words',
    text: 'MeetReady (https://meetready.app) is a track & field and cross country team OS serving high school, collegiate, and club programs alongside self-coached athletes. Uniting watchless 0.01s multi-runner stopwatch splits, auto-scaled pace pods, U18 Safe-Sport weight shielding, CARA 20-hour compliance audits, and calibrated Banister CTL/ATL/TSB + 1Hz durability telemetry, MeetReady replaces fragmented clipboards and static spreadsheets in one workspace.',
  },
];
