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
    label: '80% Stadium Chalk & Asphalt',
    lightHex: '#F6F3EC',
    darkHex: '#121413',
    detail: 'Warm Stadium Chalk / Matte White cards in daylight; Track Asphalt (#121413) after dark.',
  },
  {
    id: 'pine',
    percent: 15,
    label: '15% Mondo Clay & Track Ink',
    lightHex: '#B83A24',
    darkHex: '#E05238',
    detail: 'Committed Mondo Track Clay hero/accents, 1px asphalt hairlines, and Warm Stone inset wells.',
  },
  {
    id: 'volt',
    percent: 5,
    label: '<= 5% Starter Volt Focal Ink',
    lightHex: '#D8FF2A',
    darkHex: '#D8FF2A',
    detail: 'Primary CTAs and live stopwatch numerals — strictly paired with #121413 ink.',
  },
];

export const ARCHITECTURE_COLOR_TOKENS: BrandColorTokenSpec[] = [
  {
    id: 'track-volt',
    name: 'Starter Volt',
    role: 'Primary CTA fill, dark logo peak, live stopwatch digits',
    lightHex: '#D8FF2A',
    darkHex: '#D8FF2A',
    cssVar: '--color-ap-volt',
    tsKey: 'brandCobalt (dark)',
    contrastNote: 'PMS 809 C fluorescent plastisol over flash white · Madeira #1902 · #121413 ink',
    wcagBadge: '> 14:1 AAA',
  },
  {
    id: 'mondo-clay',
    name: 'Mondo Track Clay',
    role: 'Committed brand accent (#B83A24, PMS 7621 C), hero field & active tab bar',
    lightHex: '#B83A24',
    darkHex: '#E05238',
    cssVar: '--color-ap-clay',
    tsKey: 'brandCobalt (light)',
    contrastNote: 'PMS 7621 C clay · Madeira #1839 · Warm track surface authority',
    wcagBadge: '5.5:1 AA+',
  },
  {
    id: 'infield-pine',
    name: 'Infield Pine',
    role: 'Micro-telemetry labels & positive split delta pills',
    lightHex: '#1E4D36',
    darkHex: '#86EFAC',
    cssVar: '--color-ap-pine',
    contrastNote: 'Restrained secondary turf ink paired with #E7F3EC badge wells',
    wcagBadge: '8.9:1 AAA',
  },
  {
    id: 'workspace-stage',
    name: 'Stadium Chalk / Track Asphalt',
    role: 'Edge-to-edge workspace & page ground (.ap-content-stage)',
    lightHex: '#F6F3EC',
    darkHex: '#121413',
    cssVar: '--ap-canvas-bg',
    tsKey: 'canvasBg',
    contrastNote: 'Edge-to-edge architectural ground — zero outer green wrapper bezel',
    wcagBadge: 'Plane 1',
  },
  {
    id: 'telemetry-card',
    name: 'Matte White / Carbon Asphalt',
    role: 'Primary .ap-card telemetry container surface',
    lightHex: '#FFFFFF',
    darkHex: '#1A1D1B',
    cssVar: '--ap-card-bg',
    tsKey: 'cardBg',
    contrastNote: 'Bounded by crisp 1px Track Asphalt hairline',
    wcagBadge: 'Plane 2',
  },
  {
    id: 'inset-well',
    name: 'Warm Stone / Deep Asphalt',
    role: 'Nested KPI cells, pill tracks, form inputs',
    lightHex: '#EDE9DF',
    darkHex: '#151816',
    cssVar: '--ap-inset-bg',
    tsKey: 'insetBg',
    contrastNote: 'Flat tonal recess replacing stacked card shadows',
    wcagBadge: 'Plane 3',
  },
  {
    id: 'primary-ink',
    name: 'Primary Foreground Ink',
    role: 'Headings, KPI readouts & primary body copy',
    lightHex: '#121413',
    darkHex: '#F6F3EC',
    cssVar: '--ap-ink-primary',
    tsKey: 'textPrimary',
    contrastNote: 'Track Asphalt vs. Stadium Chalk',
    wcagBadge: '16.5:1 AAA',
  },
  {
    id: 'muted-ink',
    name: 'Muted Axis Ink',
    role: 'Chart axes, captions & metadata labels',
    lightHex: '#57544D',
    darkHex: '#A39E93',
    cssVar: '--ap-ink-muted',
    tsKey: 'textMuted',
    contrastNote: 'Warm stone neutral calibrated above AA floor',
    wcagBadge: '6.6:1 AA+',
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
    lightColors: '#E7F3EC bg / #1E4D36 ink',
    darkColors: '35% Infield Pine / #86EFAC ink',
    meaning: 'Optimal HRV / Ln rMSSD, CARA compliant, Safe-Sport shielded.',
  },
  {
    id: 'info',
    label: 'CALIBRATING · DAY-1 HONESTY',
    className: 'ap-status-info',
    lightColors: '#F2F0E9 bg / #121413 ink',
    darkColors: '8% Chalk / #F6F3EC ink',
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
    lightColors: '#FDF0ED bg / #8F2A18 ink',
    darkColors: '22% Mondo Clay / #F6B8AC ink',
    meaning: 'Suppressed HRV, 48h trainer-only lock, or TSB < -30 guardrail.',
  },
];

export const PARTNER_ISOLATION_TOKENS: BrandColorTokenSpec[] = [
  {
    id: 'strava-cta',
    name: 'Strava Partner OAuth Fill',
    role: 'Standalone Strava OAuth connect panels (.ap-btn-strava, >= 48px tall; unified multi-provider auth cards keep neutral outline Connect with Strava buttons beside the single Starter Volt CTA)',
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
    role: 'Display (Landing Hero Only)',
    fontFamily: 'Barlow Condensed',
    sizeLabel: 'clamp(2.25rem, 4.5vw, 4.15rem)',
    weightLabel: '800 ExtraBold uppercase',
    trackingLabel: '-0.015em',
    sampleText: 'EVERY EVENT. EVERY MARK. ONE TEAM PLATFORM.',
    className: 'font-display text-2xl sm:text-3xl font-extrabold uppercase tracking-[-0.015em] text-ap-ink dark:text-ap-chalk',
  },
  {
    role: 'UI / Operate Headline',
    fontFamily: 'Archivo',
    sizeLabel: '1.125rem / 18px',
    weightLabel: '700 Bold',
    trackingLabel: '-0.02em',
    sampleText: 'Adaptive CS + D’ Track Prescriptions & 0.01s Splits',
    className: 'font-sans text-lg font-bold tracking-tight text-ap-ink dark:text-ap-chalk',
  },
  {
    role: 'Body',
    fontFamily: 'Archivo',
    sizeLabel: '0.875rem / 14px · leading 1.6',
    weightLabel: '400 Regular',
    trackingLabel: '-0.01em',
    sampleText:
      'Calibrated directly from Critical Speed, Anaerobic Distance Capacity, and overnight Ln rMSSD — zero fabricated Day-1 scores.',
    className: 'font-sans text-sm leading-relaxed text-ap-ink/85 dark:text-ap-chalk/85 max-w-[68ch]',
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
    sampleText: '01:08.42  ·  4:05.12  ·  348W',
    isMono: true,
    className: 'font-mono tabular-nums text-2xl font-bold tracking-[-0.03em] text-ap-ink dark:text-ap-chalk',
  },
];

export const BRAND_DO_DONT_RULES = [
  {
    id: 'volt-on-white',
    doTitle: 'Dark Ink on Starter Volt',
    doDetail: 'Pair solid #D8FF2A fills with Track Asphalt (#121413), or use Mondo Clay (#B83A24) & Track Asphalt (#121413) on Stadium Chalk (#F6F3EC).',
    dontTitle: 'Never Raw Volt Text on White or Chalk',
    dontDetail: 'Raw #D8FF2A text on Chalk or paper drops below 1.4:1 contrast and washes out to dull chartreuse in 4-color CMYK.',
  },
  {
    id: 'one-ink-knockout',
    doTitle: 'True Outlined Vectors & Flat Embroidery',
    doDetail: 'Use flat 2-ink Velocity Chevron M solid fills (zero gradients) and outlined <path> stencils for caps (>=1.2mm satin stitch), tees, and vinyl plotters.',
    dontTitle: 'Never Send Live <text> or Gradients to Print',
    dontDetail: 'Never supply un-outlined font <text> nodes, gradient blends on machine embroidery, or #FFFFFF masking strokes.',
  },
  {
    id: 'sacred-zones',
    doTitle: 'Respect Sacred Physiology Zones',
    doDetail: 'Let Team Co-Branding theme outer chrome & CTAs while keeping Z1–Z6 and Banister CTL/ATL/TSB locked.',
    dontTitle: 'Never Re-Theme Z1–Z6 Colors',
    dontDetail: 'Re-coloring threshold or overreach markers into school colors breaks athlete fatigue recognition.',
  },
  {
    id: 'orthogonal-tabs',
    doTitle: 'Keep Operate Controls Flat & Orthogonal',
    doDetail: 'Reserve angled momentum for the Velocity Chevron M mark while keeping Operate tabs, split cards, and inputs orthogonal with crisp hairlines.',
    dontTitle: 'Never Distort or Combine Partner Logos',
    dontDetail: 'Never stretch the aspect ratio, split wordmark colors mid-word, or lock Strava/Garmin logos directly onto the MeetReady mark.',
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
    text: 'MeetReady — Every mark. Every mile. Meet ready. Track, Field & Cross Country platform uniting offline timing, field sheets & SafeSport.',
  },
  {
    id: 'short-35',
    label: 'Meet Program / Event Blurb',
    wordCountLabel: '38 words',
    text: 'MeetReady is the Track & Field and Cross Country team platform for every event group — uniting watchless 0.01s splits, jumps/throws/vaults field sheets, auto-scaled pace pods, Athletic.net/TFRRS sync, and built-in U18 SafeSport & FERPA guardrails.',
  },
  {
    id: 'standard-75',
    label: 'Full Press & Partner Boilerplate',
    wordCountLabel: '69 words',
    text: 'MeetReady (https://meetready.app) — Every mark. Every mile. Meet ready. Built for high school, collegiate, and club Track & Field and Cross Country programs, MeetReady replaces paper heat sheets and ad-supported sites with offline 0.01s stopwatch timing, complete jumps/throws/vaults field event logging, auto-scaled VDOT pace pods, Athletic.net & TFRRS roster sync, U18 SafeSport weight shielding, CARA 20-hour compliance audits, and zero advertising — ever.',
  },
];
