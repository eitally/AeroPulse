import { computeAccessibleTeamPalette, escapeTextForSafeAttr } from './teamPalette.ts';
import { getThreshThemePalette } from './themeTokens.ts';
import {
  buildS2SymbolInnerSvg,
  buildWAWordmarkInnerSvg,
} from './brandVectors.ts';

export type BrandAssetCategory = 'LOCKUPS' | 'STENCILS' | 'ICONS' | 'WORDMARK_AND_SOCIAL';

export type BrandSurfaceId =
  | 'auto'
  | 'obsidian'
  | 'chalk'
  | 'paper'
  | 'volt'
  | 'photo-sunlit'
  | 'photo-night'
  | 'bw-copier';

export type SurfaceLegalityStatus = 'RECOMMENDED' | 'CAUTION' | 'AVOID';

export interface BrandSurfaceLegality {
  status: SurfaceLegalityStatus;
  badgeLabel: string;
  rationale: string;
}

export interface BrandPngSizeSpec {
  key: '1x' | '2x' | '4x';
  label: string;
  width: number;
  height: number;
}

export interface BrandAssetDefinition {
  id: string;
  title: string;
  subtitle: string;
  category: BrandAssetCategory;
  width: number;
  height: number;
  viewBox: string;
  svgPath: string;
  staticPngPath?: string;
  isOneInkKnockout?: boolean;
  pngSizes: BrandPngSizeSpec[];
  recommendedFor: string;
  minPhysicalSpec: string;
  svgMarkup: string;
}

// =============================================================================
// Shared S2 × W-A SVG Builders (True Boolean Knockouts, Zero Matrix Distortion)
// =============================================================================

export function buildMultiToneLockupSvg(opts: {
  pineColor: string;
  accentColor: string;
  inkColor: string;
  backgroundRect?: { fill: string; rx?: number };
}): string {
  const bg = opts.backgroundRect
    ? `<rect x="0" y="0" width="472" height="124"${opts.backgroundRect.rx ? ` rx="${opts.backgroundRect.rx}"` : ''} fill="${opts.backgroundRect.fill}"/>`
    : '';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 472 124" fill="none">`,
    bg,
    buildS2SymbolInnerSvg(opts.pineColor, opts.accentColor, 'translate(6, -5.5) scale(0.98)'),
    buildWAWordmarkInnerSvg(opts.inkColor, opts.accentColor, 'translate(132, 33) scale(0.96)'),
    `</svg>`,
  ].join('');
}

/**
 * Pure monochrome single-ink SVG lockup with zero painted casing strokes, zero `<mask>`,
 * and zero `paint-order` CSS — 100% safe for screen-printing, vinyl plotters & CNC laser etching.
 */
export function buildOneInkKnockoutLockupSvg(inkColor: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 472 124" fill="none">`,
    buildS2SymbolInnerSvg(inkColor, inkColor, 'translate(6, -5.5) scale(0.98)'),
    buildWAWordmarkInnerSvg(inkColor, inkColor, 'translate(132, 33) scale(0.96)'),
    `</svg>`,
  ].join('');
}

export function buildGaugeIconSvg(opts: {
  tile?: { fill: string; stroke?: string; rx?: number };
  pineColor: string;
  accentColor: string;
}): string {
  const tileEl = opts.tile
    ? `<rect x="${opts.tile.stroke ? 2 : 0}" y="${opts.tile.stroke ? 2 : 0}" width="${opts.tile.stroke ? 124 : 128}" height="${opts.tile.stroke ? 124 : 128}"${opts.tile.rx ? ` rx="${opts.tile.rx}"` : ''} fill="${opts.tile.fill}"${opts.tile.stroke ? ` stroke="${opts.tile.stroke}" stroke-width="3.5"` : ''}/>`
    : '';
  const scaleTransform = opts.tile
    ? 'translate(64 64) scale(0.86) translate(-60.8 -69.15)'
    : 'translate(64 64) scale(1.06) translate(-60.8 -69.15)';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none">`,
    tileEl,
    buildS2SymbolInnerSvg(opts.pineColor, opts.accentColor, scaleTransform),
    `</svg>`,
  ].join('');
}

export function buildOneInkKnockoutGaugeSvg(inkColor: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none">`,
    buildS2SymbolInnerSvg(inkColor, inkColor, 'translate(64 64) scale(1.06) translate(-60.8 -69.15)'),
    `</svg>`,
  ].join('');
}

export function buildStandaloneWordmarkSvg(opts: {
  inkColor: string;
  accentColor: string;
}): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 328 96" fill="none">`,
    buildWAWordmarkInnerSvg(opts.inkColor, opts.accentColor, 'translate(12, 20) scale(0.9)'),
    `</svg>`,
  ].join('');
}

export function buildWatermarkTurnSvg(): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 220" fill="none">`,
    `<path d="M 260 190 H 120 A 70 70 0 0 1 120 50 H 260" stroke="#56BA00" stroke-width="8"/>`,
    `<path d="M 260 204 H 120 A 84 84 0 0 1 120 36 H 260" stroke="#28573B" stroke-width="8"/>`,
    `<path d="M 260 218 H 120 A 98 98 0 0 1 120 22 H 260" stroke="#28573B" stroke-width="8"/>`,
    `<path d="M 260 232 H 120 A 112 112 0 0 1 120 8 H 260" stroke="#28573B" stroke-width="8"/>`,
    `</svg>`,
  ].join('');
}

export function buildSocialOgBannerSvg(): string {
  const heroLockupInner = [
    `<g transform="translate(88, 178) scale(1.75)">`,
    buildS2SymbolInnerSvg('#399663', '#C8FF00', 'translate(6, -5.5) scale(0.98)'),
    buildWAWordmarkInnerSvg('#F4F7F4', '#C8FF00', 'translate(132, 33) scale(0.96)'),
    `</g>`,
  ].join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" fill="none">`,
    `<defs>`,
    `<radialGradient id="meetready-grad-og-flood" cx="14%" cy="6%" r="68%"><stop offset="0%" stop-color="#C8FF00" stop-opacity="0.18"/><stop offset="100%" stop-color="#0C1D14" stop-opacity="0"/></radialGradient>`,
    `<clipPath id="meetready-grad-og-clip"><rect x="34" y="34" width="1132" height="562" rx="28"/></clipPath>`,
    `</defs>`,
    `<rect width="1200" height="630" fill="#0C1D14"/>`,
    `<rect width="1200" height="630" fill="url(#meetready-grad-og-flood)"/>`,
    `<rect x="34" y="34" width="1132" height="562" rx="28" fill="#0B120E"/>`,
    `<g clip-path="url(#meetready-grad-og-clip)">`,
    `<g transform="translate(854, 44) scale(1.2)" opacity="0.14">`,
    `<path d="M 260 190 H 120 A 70 70 0 0 1 120 50 H 260" stroke="#C8FF00" stroke-width="8"/>`,
    `<path d="M 260 204 H 120 A 84 84 0 0 1 120 36 H 260" stroke="#399663" stroke-width="8"/>`,
    `<path d="M 260 218 H 120 A 98 98 0 0 1 120 22 H 260" stroke="#399663" stroke-width="8"/>`,
    `<path d="M 260 232 H 120 A 112 112 0 0 1 120 8 H 260" stroke="#399663" stroke-width="8"/>`,
    `</g>`,
    `</g>`,
    `<rect x="34" y="34" width="1132" height="562" rx="28" stroke="#2B543B" stroke-width="3"/>`,
    heroLockupInner,
    `<text x="92" y="462" fill="#F4F7F4" font-family="'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif" font-size="34" font-weight="700" letter-spacing="-0.8">Track &amp; Field · Cross Country</text>`,
    `<text x="92" y="510" fill="#93A39A" font-family="'JetBrains Mono', ui-monospace, SFMono-Regular, monospace" font-size="18" font-weight="600" letter-spacing="1.4">PACE PODS  ·  0.01S WATCHLESS TIMING  ·  1HZ PHYSIOLOGY</text>`,
    `<g transform="translate(92, 540)">`,
    `<rect x="0" y="0" width="54" height="10" rx="5" fill="#94A3B8"/>`,
    `<rect x="62" y="0" width="54" height="10" rx="5" fill="#0D9488"/>`,
    `<rect x="124" y="0" width="54" height="10" rx="5" fill="#D97706"/>`,
    `<rect x="186" y="0" width="54" height="10" rx="5" fill="#EA580C"/>`,
    `<rect x="248" y="0" width="54" height="10" rx="5" fill="#DC2626"/>`,
    `<rect x="310" y="0" width="54" height="10" rx="5" fill="#7C3AED"/>`,
    `</g>`,
    `</svg>`,
  ].join('');
}

// =============================================================================
// Canonical 17-Asset Catalog
// =============================================================================
export const BRAND_ASSET_CATALOG: BrandAssetDefinition[] = [
  {
    id: 'meetready-lockup-dark',
    title: 'Primary Lockup — Dark Stage',
    subtitle: 'S2 Redline Breach + MeetReady Wordmark (#C8FF00 / #F4F7F4)',
    category: 'LOCKUPS',
    width: 472,
    height: 124,
    viewBox: '0 0 472 124',
    svgPath: '/brand/meetready-lockup-dark.svg',
    staticPngPath: '/brand/meetready-lockup-dark-2x.png',
    pngSizes: [
      { key: '1x', label: '1x (472×124)', width: 472, height: 124 },
      { key: '2x', label: '2x (944×248)', width: 944, height: 248 },
      { key: '4x', label: '4x Print (1888×496)', width: 1888, height: 496 },
    ],
    recommendedFor: 'Obsidian-Pine surfaces, dark footers, night track tents',
    minPhysicalSpec: 'Min print 0.5 in (13 mm) tall · Min web 28 px tall',
    svgMarkup: buildMultiToneLockupSvg({
      pineColor: '#399663',
      accentColor: '#C8FF00',
      inkColor: '#F4F7F4',
    }),
  },
  {
    id: 'meetready-lockup-light',
    title: 'Primary Lockup — Light Stage',
    subtitle: 'S2 Redline Breach + MeetReady Wordmark (#1C5436 / #357A00 / #101411)',
    category: 'LOCKUPS',
    width: 472,
    height: 124,
    viewBox: '0 0 472 124',
    svgPath: '/brand/meetready-lockup-light.svg',
    staticPngPath: '/brand/meetready-lockup-light-2x.png',
    pngSizes: [
      { key: '1x', label: '1x (472×124)', width: 472, height: 124 },
      { key: '2x', label: '2x (944×248)', width: 944, height: 248 },
      { key: '4x', label: '4x Print (1888×496)', width: 1888, height: 496 },
    ],
    recommendedFor: 'Chalk/white slides, CMYK meet programs, locker-room QR headers',
    minPhysicalSpec: 'Min print 0.5 in (13 mm) tall · CMYK-safe Pine/Lime inks',
    svgMarkup: buildMultiToneLockupSvg({
      pineColor: '#1C5436',
      accentColor: '#357A00',
      inkColor: '#101411',
    }),
  },
  {
    id: 'meetready-sticker-diecut',
    title: 'Die-Cut Badge Pill',
    subtitle: 'Self-cased #0B1911 container guaranteeing >15:1 contrast over any photo',
    category: 'LOCKUPS',
    width: 472,
    height: 124,
    viewBox: '0 0 472 124',
    svgPath: '/brand/meetready-sticker-diecut.svg',
    staticPngPath: '/brand/meetready-sticker-diecut-2x.png',
    pngSizes: [
      { key: '1x', label: '1x (472×124)', width: 472, height: 124 },
      { key: '2x', label: '2x (944×248)', width: 944, height: 248 },
      { key: '4x', label: '4x Print (1888×496)', width: 1888, height: 496 },
    ],
    recommendedFor: 'Sunlit concrete race photos, die-cut stickers, scoreboard bugs',
    minPhysicalSpec: 'Self-framed rx=24 pill · safe on busy backgrounds',
    svgMarkup: buildMultiToneLockupSvg({
      pineColor: '#399663',
      accentColor: '#C8FF00',
      inkColor: '#F4F7F4',
      backgroundRect: { fill: '#0B1911', rx: 24 },
    }),
  },
  {
    id: 'meetready-1ink-stencil',
    title: '1-Ink Obsidian Stencil (Knockout)',
    subtitle: 'True boolean compound-path cutout — zero painted white strokes',
    category: 'STENCILS',
    width: 472,
    height: 124,
    viewBox: '0 0 472 124',
    svgPath: '/brand/meetready-1ink-stencil.svg',
    staticPngPath: '/brand/meetready-1ink-stencil-2x.png',
    isOneInkKnockout: true,
    pngSizes: [
      { key: '1x', label: '1x (472×124)', width: 472, height: 124 },
      { key: '2x', label: '2x (944×248)', width: 944, height: 248 },
      { key: '4x', label: '4x Print (1888×496)', width: 1888, height: 496 },
    ],
    recommendedFor: '600-DPI B&W laser heat sheets, white/volt gear, vinyl plotters',
    minPhysicalSpec: 'True 1-ink filled paths · plotter & silk-screen verified',
    svgMarkup: buildOneInkKnockoutLockupSvg('#101411'),
  },
  {
    id: 'meetready-1ink-stencil-white',
    title: '1-Ink Reversed White Stencil (Knockout)',
    subtitle: 'Pure #FFFFFF compound-path stencil for dark gear & night photography',
    category: 'STENCILS',
    width: 472,
    height: 124,
    viewBox: '0 0 472 124',
    svgPath: '/brand/meetready-1ink-stencil-white.svg',
    staticPngPath: '/brand/meetready-1ink-stencil-white-2x.png',
    isOneInkKnockout: true,
    pngSizes: [
      { key: '1x', label: '1x (472×124)', width: 472, height: 124 },
      { key: '2x', label: '2x (944×248)', width: 944, height: 248 },
      { key: '4x', label: '4x Print (1888×496)', width: 1888, height: 496 },
    ],
    recommendedFor: 'Dark team singlets, 10×10 EZ-Up tent valances, broadcast watermarks',
    minPhysicalSpec: 'Single-screen white plastisol / heat-transfer vinyl ready',
    svgMarkup: buildOneInkKnockoutLockupSvg('#FFFFFF'),
  },
  {
    id: 'meetready-1ink-stencil-volt',
    title: '1-Ink Track Volt Stencil (Knockout)',
    subtitle: 'Electric #C8FF00 single-ink cutout for dark Pine or Black banners',
    category: 'STENCILS',
    width: 472,
    height: 124,
    viewBox: '0 0 472 124',
    svgPath: '/brand/meetready-1ink-stencil-volt.svg',
    isOneInkKnockout: true,
    pngSizes: [
      { key: '1x', label: '1x (472×124)', width: 472, height: 124 },
      { key: '2x', label: '2x (944×248)', width: 944, height: 248 },
      { key: '4x', label: '4x Print (1888×496)', width: 1888, height: 496 },
    ],
    recommendedFor: 'Dark stadium scrims, spot-color Volt ink screen prints',
    minPhysicalSpec: 'Pantone 809 C / HTV fluorescent neon spot match',
    svgMarkup: buildOneInkKnockoutLockupSvg('#C8FF00'),
  },
  {
    id: 'meetready-gauge-symbol-dark',
    title: 'S2 Redline Symbol — Transparent (Dark)',
    subtitle: 'Standalone 1:1 chronometer + arrow mark for dark avatars & overlays',
    category: 'ICONS',
    width: 128,
    height: 128,
    viewBox: '0 0 128 128',
    svgPath: '/brand/meetready-gauge-symbol-dark.svg',
    pngSizes: [
      { key: '1x', label: '1x (256×256)', width: 256, height: 256 },
      { key: '2x', label: '2x (512×512)', width: 512, height: 512 },
      { key: '4x', label: '4x (1024×1024)', width: 1024, height: 1024 },
    ],
    recommendedFor: 'Dark circular club avatars, dark slides, compact mobile headers',
    minPhysicalSpec: 'Min print 0.35 in (9 mm) · Min UI 16 px favicon',
    svgMarkup: buildGaugeIconSvg({
      pineColor: '#399663',
      accentColor: '#C8FF00',
    }),
  },
  {
    id: 'meetready-gauge-symbol-light',
    title: 'S2 Redline Symbol — Transparent (Light)',
    subtitle: 'Standalone Stadium Pine & Volt Olive mark for white/chalk surfaces',
    category: 'ICONS',
    width: 128,
    height: 128,
    viewBox: '0 0 128 128',
    svgPath: '/brand/meetready-gauge-symbol-light.svg',
    pngSizes: [
      { key: '1x', label: '1x (256×256)', width: 256, height: 256 },
      { key: '2x', label: '2x (512×512)', width: 512, height: 512 },
      { key: '4x', label: '4x (1024×1024)', width: 1024, height: 1024 },
    ],
    recommendedFor: 'Light circular avatars, clipboards, stationery corner marks',
    minPhysicalSpec: 'Min print 0.35 in (9 mm) · WCAG AA Pine/Olive',
    svgMarkup: buildGaugeIconSvg({
      pineColor: '#1C5436',
      accentColor: '#357A00',
    }),
  },
  {
    id: 'meetready-gauge-symbol-1ink-black',
    title: 'S2 Redline Symbol — 1-Ink Black Knockout',
    subtitle: 'Unframed monochrome knockout symbol for embroidery & laser etch',
    category: 'ICONS',
    width: 128,
    height: 128,
    viewBox: '0 0 128 128',
    svgPath: '/brand/meetready-gauge-symbol-1ink-black.svg',
    isOneInkKnockout: true,
    pngSizes: [
      { key: '1x', label: '1x (256×256)', width: 256, height: 256 },
      { key: '2x', label: '2x (512×512)', width: 512, height: 512 },
      { key: '4x', label: '4x (1024×1024)', width: 1024, height: 1024 },
    ],
    recommendedFor: 'Relay batons, B&W heat-sheet footers, chest-hit singlets',
    minPhysicalSpec: 'True boolean cutout · <= 2.25 sq in NCAA/NFHS chest hit',
    svgMarkup: buildOneInkKnockoutGaugeSvg('#101411'),
  },
  {
    id: 'meetready-gauge-symbol-1ink-white',
    title: 'S2 Redline Symbol — 1-Ink White Knockout',
    subtitle: 'Unframed reversed #FFFFFF knockout symbol for dark kits & bottles',
    category: 'ICONS',
    width: 128,
    height: 128,
    viewBox: '0 0 128 128',
    svgPath: '/brand/meetready-gauge-symbol-1ink-white.svg',
    isOneInkKnockout: true,
    pngSizes: [
      { key: '1x', label: '1x (256×256)', width: 256, height: 256 },
      { key: '2x', label: '2x (512×512)', width: 512, height: 512 },
      { key: '4x', label: '4x (1024×1024)', width: 1024, height: 1024 },
    ],
    recommendedFor: 'Dark apparel embroidery, carbon frame decals, photo corner bugs',
    minPhysicalSpec: 'True boolean cutout · single-color stitch/vinyl safe',
    svgMarkup: buildOneInkKnockoutGaugeSvg('#FFFFFF'),
  },
  {
    id: 'meetready-icon-tile-dark',
    title: 'App Tile Icon — Obsidian Rounded',
    subtitle: 'Canonical rx=28 #0B1911 rounded-square tile with TL-2P1 Twin-Lane symbol',
    category: 'ICONS',
    width: 128,
    height: 128,
    viewBox: '0 0 128 128',
    svgPath: '/brand/meetready-icon-tile-dark.svg',
    pngSizes: [
      { key: '1x', label: '1x (256×256)', width: 256, height: 256 },
      { key: '2x', label: '2x (512×512)', width: 512, height: 512 },
      { key: '4x', label: '4x (1024×1024)', width: 1024, height: 1024 },
    ],
    recommendedFor: 'App launcher tiles, PWA splash/home icons (desktop/mobile browser 16px tabs use FAV-M /icon.svg)',
    minPhysicalSpec: 'App & PWA tile · Browser 16px tab uses decoupled FAV-M Volt Shield (/icon.svg)',
    svgMarkup: buildGaugeIconSvg({
      tile: { fill: '#0B1911', stroke: '#399663', rx: 28 },
      pineColor: '#399663',
      accentColor: '#C8FF00',
    }),
  },
  {
    id: 'meetready-icon-tile-light',
    title: 'App Tile Icon — Stadium Chalk Rounded',
    subtitle: 'Chalk #F4F7F2 rounded tile with #1C5436 architectural border',
    category: 'ICONS',
    width: 128,
    height: 128,
    viewBox: '0 0 128 128',
    svgPath: '/brand/meetready-icon-tile-light.svg',
    pngSizes: [
      { key: '1x', label: '1x (256×256)', width: 256, height: 256 },
      { key: '2x', label: '2x (512×512)', width: 512, height: 512 },
      { key: '4x', label: '4x (1024×1024)', width: 1024, height: 1024 },
    ],
    recommendedFor: 'Light-mode documentation cards & editorial callout tiles',
    minPhysicalSpec: 'rx=28 Chalk frame · matches Light Stage canvas',
    svgMarkup: buildGaugeIconSvg({
      tile: { fill: '#F4F7F2', stroke: '#1C5436', rx: 28 },
      pineColor: '#1C5436',
      accentColor: '#357A00',
    }),
  },
  {
    id: 'meetready-icon-square-fullbleed',
    title: 'Full-Bleed Square Icon (Partner Portals)',
    subtitle: 'Opaque edge-to-edge #0B1911 square for API portals & circular masks',
    category: 'ICONS',
    width: 128,
    height: 128,
    viewBox: '0 0 128 128',
    svgPath: '/brand/meetready-icon-square-fullbleed.svg',
    staticPngPath: '/brand/meetready-icon-square-512.png',
    pngSizes: [
      { key: '1x', label: '1x (256×256)', width: 256, height: 256 },
      { key: '2x', label: '2x (512×512)', width: 512, height: 512 },
      { key: '4x', label: '4x (1024×1024)', width: 1024, height: 1024 },
    ],
    recommendedFor: 'Strava/Garmin/COROS/Suunto developer portals & circular social crops',
    minPhysicalSpec: 'Zero transparent corners · 1024×1024 store/portal compliant',
    svgMarkup: buildGaugeIconSvg({
      tile: { fill: '#0B1911' },
      pineColor: '#399663',
      accentColor: '#C8FF00',
    }),
  },
  {
    id: 'meetready-wordmark-dark',
    title: 'Standalone Wordmark — Dark Stage',
    subtitle: 'Two-tone CamelCase MeetReady wordmark (#F4F7F4 Meet · #C8FF00 Ready)',
    category: 'WORDMARK_AND_SOCIAL',
    width: 328,
    height: 96,
    viewBox: '0 0 328 96',
    svgPath: '/brand/meetready-wordmark-dark.svg',
    pngSizes: [
      { key: '1x', label: '1x (328×96)', width: 328, height: 96 },
      { key: '2x', label: '2x (656×192)', width: 656, height: 192 },
      { key: '4x', label: '4x (1312×384)', width: 1312, height: 384 },
    ],
    recommendedFor: 'Compact dark footers, jersey collar tape & narrow co-brand strips',
    minPhysicalSpec: 'Canonical CamelCase MeetReady · crisp sans geometry',
    svgMarkup: buildStandaloneWordmarkSvg({
      inkColor: '#F4F7F4',
      accentColor: '#C8FF00',
    }),
  },
  {
    id: 'meetready-wordmark-light',
    title: 'Standalone Wordmark — Light Stage',
    subtitle: 'Two-tone CamelCase MeetReady wordmark (#101411 Meet · #357A00 Ready)',
    category: 'WORDMARK_AND_SOCIAL',
    width: 328,
    height: 96,
    viewBox: '0 0 328 96',
    svgPath: '/brand/meetready-wordmark-light.svg',
    pngSizes: [
      { key: '1x', label: '1x (328×96)', width: 328, height: 96 },
      { key: '2x', label: '2x (656×192)', width: 656, height: 192 },
      { key: '4x', label: '4x (1312×384)', width: 1312, height: 384 },
    ],
    recommendedFor: 'Compact white header strips & dense meet timing tables',
    minPhysicalSpec: 'Obsidian #101411 + Olive #357A00 Ready on crisp chalk/white',
    svgMarkup: buildStandaloneWordmarkSvg({
      inkColor: '#101411',
      accentColor: '#357A00',
    }),
  },
  {
    id: 'meetready-watermark-4lane',
    title: '4-Lane Banking Turn Watermark',
    subtitle: 'Signature architectural stadium-oval graphic motif (260×220)',
    category: 'WORDMARK_AND_SOCIAL',
    width: 260,
    height: 220,
    viewBox: '0 0 260 220',
    svgPath: '/brand/meetready-watermark-4lane.svg',
    pngSizes: [
      { key: '1x', label: '1x (520×440)', width: 520, height: 440 },
      { key: '2x', label: '2x (1040×880)', width: 1040, height: 880 },
      { key: '4x', label: '4x (2080×1760)', width: 2080, height: 1760 },
    ],
    recommendedFor: 'Slide deck corners, meet program endpapers, subtle card backdrops',
    minPhysicalSpec: 'Use at 4%–14% opacity behind primary content',
    svgMarkup: buildWatermarkTurnSvg(),
  },
  {
    id: 'meetready-og-1200x630',
    title: 'Social & OpenGraph Banner (1200×630)',
    subtitle: 'Official Stadium Track share card with locked Z1–Z6 spectrum bar',
    category: 'WORDMARK_AND_SOCIAL',
    width: 1200,
    height: 630,
    viewBox: '0 0 1200 630',
    svgPath: '/brand/meetready-og-1200x630.svg',
    staticPngPath: '/brand/meetready-og-1200x630.png',
    pngSizes: [
      { key: '1x', label: '1x (1200×630)', width: 1200, height: 630 },
      { key: '2x', label: '2x (2400×1260)', width: 2400, height: 1260 },
      { key: '4x', label: '4x (3600×1890)', width: 3600, height: 1890 },
    ],
    recommendedFor: 'OpenGraph link previews, press kits, coaching clinic title slides',
    minPhysicalSpec: '1.91:1 social aspect · powers meetready.app meta og:image',
    svgMarkup: buildSocialOgBannerSvg(),
  },
];

// =============================================================================
// Surface Stress-Tester Matrix
// =============================================================================
export const BRAND_SURFACES: Array<{
  id: BrandSurfaceId;
  label: string;
  shortLabel: string;
  swatchHex: string;
  description: string;
}> = [
  {
    id: 'auto',
    label: 'Optimal Surface (Auto)',
    shortLabel: 'Auto (Optimal)',
    swatchHex: '#1C5436',
    description: 'Pairs each mark with its intended native light or dark background',
  },
  {
    id: 'obsidian',
    label: 'Obsidian-Pine Stage',
    shortLabel: 'Obsidian',
    swatchHex: '#0B120E',
    description: 'Night trackside / dark cockpit (#0B120E)',
  },
  {
    id: 'chalk',
    label: 'Stadium Chalk Stage',
    shortLabel: 'Chalk',
    swatchHex: '#F4F7F2',
    description: 'Daylight workspace stage (#F4F7F2)',
  },
  {
    id: 'paper',
    label: 'Crisp Paper Card',
    shortLabel: 'Paper',
    swatchHex: '#FFFFFF',
    description: 'White banner, slide deck, or print sheet (#FFFFFF)',
  },
  {
    id: 'volt',
    label: 'Track Volt Flood',
    shortLabel: 'Volt',
    swatchHex: '#C8FF00',
    description: 'High-visibility #C8FF00 relay baton / tent accent',
  },
  {
    id: 'photo-sunlit',
    label: 'Sunlit Track Photo',
    shortLabel: 'Sun Photo',
    swatchHex: '#E2D4C0',
    description: 'Midday glare & red/tan track surface simulation',
  },
  {
    id: 'photo-night',
    label: 'Floodlit Night Photo',
    shortLabel: 'Night Photo',
    swatchHex: '#13241B',
    description: 'Stadium floodlights under dusk/night photography',
  },
  {
    id: 'bw-copier',
    label: '600-DPI B&W Copier',
    shortLabel: 'B&W Copier',
    swatchHex: '#EAEAEA',
    description: 'Office monochrome laser heat sheets & QR posters',
  },
];

const DARK_FIRST_IDS = new Set([
  'meetready-lockup-dark',
  'meetready-1ink-stencil-white',
  'meetready-1ink-stencil-volt',
  'meetready-gauge-symbol-dark',
  'meetready-gauge-symbol-1ink-white',
  'meetready-wordmark-dark',
]);

const LIGHT_FIRST_IDS = new Set([
  'meetready-lockup-light',
  'meetready-1ink-stencil',
  'meetready-gauge-symbol-light',
  'meetready-gauge-symbol-1ink-black',
  'meetready-wordmark-light',
]);

const SELF_FRAMED_IDS = new Set([
  'meetready-sticker-diecut',
  'meetready-icon-tile-dark',
  'meetready-icon-tile-light',
  'meetready-icon-square-fullbleed',
  'meetready-og-1200x630',
]);

export function resolveEffectiveSurfaceForAsset(
  assetId: string,
  surface: BrandSurfaceId,
  isDarkTheme: boolean
): Exclude<BrandSurfaceId, 'auto'> {
  if (surface !== 'auto') return surface;
  if (DARK_FIRST_IDS.has(assetId)) return 'obsidian';
  if (LIGHT_FIRST_IDS.has(assetId)) return 'chalk';
  if (assetId === 'meetready-icon-tile-dark' || assetId === 'meetready-icon-square-fullbleed') {
    return isDarkTheme ? 'obsidian' : 'chalk';
  }
  return isDarkTheme ? 'obsidian' : 'chalk';
}

export function evaluateAssetOnBackdrop(
  asset: BrandAssetDefinition,
  surface: BrandSurfaceId
): BrandSurfaceLegality {
  const id = asset.id;

  if (surface === 'auto') {
    return {
      status: 'RECOMMENDED',
      badgeLabel: asset.isOneInkKnockout ? 'Knockout Ready' : 'Native Pairing',
      rationale: asset.recommendedFor,
    };
  }

  if (SELF_FRAMED_IDS.has(id)) {
    if (
      surface === 'obsidian' &&
      (id === 'meetready-icon-tile-dark' ||
        id === 'meetready-icon-square-fullbleed' ||
        id === 'meetready-sticker-diecut')
    ) {
      return {
        status: 'RECOMMENDED',
        badgeLabel: 'Recommended',
        rationale: 'Self-cased Pine border keeps sharp definition over Obsidian.',
      };
    }
    if (surface === 'bw-copier' && id !== 'meetready-icon-tile-light') {
      return {
        status: 'CAUTION',
        badgeLabel: 'B&W Toner',
        rationale: 'Dark self-cased fill prints solid black; prefer 1-Ink Obsidian for toner efficiency.',
      };
    }
    if (surface === 'photo-sunlit' || surface === 'photo-night') {
      return {
        status: 'RECOMMENDED',
        badgeLabel: 'Recommended',
        rationale: 'Built-in container preserves >15:1 legibility across complex photography.',
      };
    }
    return {
      status: 'RECOMMENDED',
      badgeLabel: 'Self-Framed',
      rationale: 'Carries its own container background so contrast never collapses.',
    };
  }

  if (id === 'meetready-watermark-4lane') {
    if (surface === 'bw-copier') {
      return {
        status: 'CAUTION',
        badgeLabel: 'Monochrome',
        rationale: 'Convert lime lane to 40% black halftone on monochrome laser printers.',
      };
    }
    return {
      status: 'RECOMMENDED',
      badgeLabel: 'Recommended',
      rationale: 'Keep at 4%–14% opacity behind telemetry or slide headers.',
    };
  }

  if (DARK_FIRST_IDS.has(id)) {
    if (surface === 'obsidian' || surface === 'photo-night') {
      return {
        status: 'RECOMMENDED',
        badgeLabel: 'Recommended',
        rationale:
          id === 'meetready-1ink-stencil-white' || id === 'meetready-gauge-symbol-1ink-white'
            ? 'Crisp reversed white silhouette pops cleanly on dark textiles & floodlit stills.'
            : 'Tuned for Obsidian & dark floodlit tracks with zero halation.',
      };
    }
    if (surface === 'chalk' || surface === 'paper' || surface === 'volt') {
      return {
        status: 'AVOID',
        badgeLabel: 'Avoid Here',
        rationale: 'White/Volt strokes vanish on bright grounds — switch to Light Stage or 1-Ink Obsidian.',
      };
    }
    if (surface === 'bw-copier') {
      return {
        status: 'AVOID',
        badgeLabel: 'Avoid on Copier',
        rationale: 'White or electric Volt washes out to invisible pale grey on B&W toner.',
      };
    }
    return {
      status: 'CAUTION',
      badgeLabel: 'Glare Check',
      rationale: 'For sunlit concrete photos, use the self-cased Die-Cut Badge Pill instead.',
    };
  }

  if (LIGHT_FIRST_IDS.has(id)) {
    if (surface === 'chalk' || surface === 'paper' || surface === 'volt') {
      if (
        surface === 'volt' &&
        id !== 'meetready-1ink-stencil' &&
        id !== 'meetready-gauge-symbol-1ink-black'
      ) {
        return {
          status: 'CAUTION',
          badgeLabel: 'Use 1-Ink Black',
          rationale: 'Green accents lose separation on Track Volt; 1-Ink Obsidian hits >15:1 contrast.',
        };
      }
      return {
        status: 'RECOMMENDED',
        badgeLabel: 'Recommended',
        rationale:
          asset.isOneInkKnockout
            ? 'True boolean-knockout black stays razor-sharp at 600 DPI and on bright fabrics.'
            : 'High-contrast Pine & Turf Lime pass WCAG AA on chalk and paper.',
      };
    }
    if (surface === 'bw-copier') {
      if (asset.isOneInkKnockout) {
        return {
          status: 'RECOMMENDED',
          badgeLabel: 'Copier Gold Standard',
          rationale: 'Zero halftone gradients or grey drop-out — built for B&W heat sheets.',
        };
      }
      return {
        status: 'CAUTION',
        badgeLabel: 'Toner Check',
        rationale: 'Turf Lime dithers lightly in grayscale; 1-Ink Obsidian yields sharpest copy.',
      };
    }
    if (surface === 'obsidian' || surface === 'photo-night') {
      return {
        status: 'AVOID',
        badgeLabel: 'Avoid Here',
        rationale: 'Dark Pine/Obsidian inks sink into dark backgrounds — switch to Dark Stage or White.',
      };
    }
    return {
      status: 'CAUTION',
      badgeLabel: 'Check Shadows',
      rationale: 'Use only over bright highlights; Die-Cut Pill guarantees photo contrast.',
    };
  }

  return {
    status: 'RECOMMENDED',
    badgeLabel: 'Recommended',
    rationale: 'Ready for digital and print production.',
  };
}

// =============================================================================
// Live Team × MeetReady Co-Branding Lockup SVG Builder
// =============================================================================
export interface TeamCobrandSvgOptions {
  shortName: string;
  monogram: string;
  primaryHex: string;
  secondaryHex: string;
  variant: 'light' | 'dark' | '1ink-black' | '1ink-white';
}

export function buildTeamCobrandLockupSvg(opts: TeamCobrandSvgOptions): string {
  const palette = computeAccessibleTeamPalette(opts.primaryHex, opts.secondaryHex);
  const rawName = (opts.shortName || 'VARSITY XC').trim().slice(0, 22) || 'VARSITY XC';
  const rawMono = (opts.monogram || 'VX').trim().toUpperCase().slice(0, 3) || 'VX';
  const cleanName = escapeTextForSafeAttr(rawName);
  const cleanMono = escapeTextForSafeAttr(rawMono);

  // Measure approximate name block width cleanly in Helvetica/Plus Jakarta Sans caps (bold 30px)
  const nameWidth = Math.max(96, Math.round(rawName.length * 18.5 + 16));
  const crestX = 8;
  const crestSize = 72;
  const nameX = crestX + crestSize + 20;
  const xMarkX = nameX + nameWidth + 14;
  const lockupX = xMarkX + 34;
  const totalWidth = lockupX + 472 + 12;

  const isOneInk = opts.variant === '1ink-black' || opts.variant === '1ink-white';
  const monoInk = opts.variant === '1ink-white' ? '#FFFFFF' : '#101411';

  const gradId = `meetready-grad-cobrand-${opts.variant}`;

  let crestMarkup = '';
  let nameColor = monoInk;
  let crossColor = monoInk;
  let threshMarkup = '';

  if (isOneInk) {
    crestMarkup = [
      `<rect x="${crestX + 2}" y="26" width="${crestSize - 4}" height="${crestSize - 4}" rx="18" fill="none" stroke="${monoInk}" stroke-width="5"/>`,
      `<text x="${crestX + crestSize / 2}" y="71" text-anchor="middle" fill="${monoInk}" font-family="'Plus Jakarta Sans', -apple-system, sans-serif" font-size="26" font-weight="800" letter-spacing="-0.5">${cleanMono}</text>`,
    ].join('');
    threshMarkup = [
      `<g transform="translate(${lockupX}, 0)">`,
      buildS2SymbolInnerSvg(monoInk, monoInk, 'translate(6, -5.5) scale(0.98)'),
      buildWAWordmarkInnerSvg(monoInk, monoInk, 'translate(132, 33) scale(0.96)'),
      `</g>`,
    ].join('');
  } else {
    const isDark = opts.variant === 'dark';
    const accent = isDark ? palette.primaryOnDark : palette.primaryOnLight;
    const secondary = isDark ? palette.secondaryOnDark : palette.secondaryOnLight;
    const onPrimary = isDark ? palette.textOnPrimaryDark : palette.textOnPrimaryLight;
    const slatePine = isDark ? '#64748B' : '#334155';
    const inkColor = isDark ? '#F4F7F4' : '#101411';
    nameColor = inkColor;
    crossColor = isDark ? '#93A39A' : '#43584B';

    crestMarkup = [
      `<defs><linearGradient id="${gradId}-crest" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${accent}"/><stop offset="100%" stop-color="${secondary}"/></linearGradient></defs>`,
      `<rect x="${crestX}" y="24" width="${crestSize}" height="${crestSize}" rx="18" fill="url(#${gradId}-crest)" stroke="rgba(255,255,255,0.22)" stroke-width="2"/>`,
      `<text x="${crestX + crestSize / 2}" y="70" text-anchor="middle" fill="${onPrimary}" font-family="'Plus Jakarta Sans', -apple-system, sans-serif" font-size="27" font-weight="800" letter-spacing="-0.5">${cleanMono}</text>`,
    ].join('');

    threshMarkup = [
      `<g transform="translate(${lockupX}, 0)">`,
      buildS2SymbolInnerSvg(slatePine, accent, 'translate(6, -5.5) scale(0.98)'),
      buildWAWordmarkInnerSvg(inkColor, accent, 'translate(132, 33) scale(0.96)'),
      `</g>`,
    ].join('');
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} 124" width="${totalWidth}" height="124" fill="none">`,
    crestMarkup,
    `<text x="${nameX}" y="72" fill="${nameColor}" font-family="'Plus Jakarta Sans', -apple-system, sans-serif" font-size="30" font-weight="800" letter-spacing="-0.7">${cleanName}</text>`,
    `<text x="${xMarkX}" y="71" fill="${crossColor}" font-family="'Plus Jakarta Sans', -apple-system, sans-serif" font-size="26" font-weight="500">×</text>`,
    threshMarkup,
    `</svg>`,
  ].join('');
}

// =============================================================================
// Client-Side PNG Rasterizer & fflate Brand Kit ZIP Exporter
// =============================================================================
export async function rasterizeSvgToPngBlob(
  svgMarkup: string,
  widthPx: number,
  heightPx: number
): Promise<Blob> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('Canvas PNG rasterization requires a browser DOM environment.');
  }
  const sizedSvg = svgMarkup.replace(
    '<svg ',
    `<svg width="${widthPx}" height="${heightPx}" `
  );
  const svgBlob = new Blob([sizedSvg], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode SVG vector for PNG export.'));
      el.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to acquire 2D canvas context.');
    }
    ctx.clearRect(0, 0, widthPx, heightPx);
    ctx.drawImage(img, 0, 0, widthPx, heightPx);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas PNG encoding returned null.'));
      }, 'image/png');
    });
    return pngBlob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function buildDesignTokensExportJson(): string {
  const light = getThreshThemePalette(false);
  const dark = getThreshThemePalette(true);
  return JSON.stringify(
    {
      name: 'MeetReady',
      direction: '#1 Stadium Track — Track Volt & Obsidian',
      budgetRule: { neutralPercent: 80, structuralPinePercent: 15, trackVoltMaxPercent: 5 },
      architecture: {
        light: {
          outerSurround: '#163022',
          stageCanvas: light.canvasBg,
          cardSurface: light.cardBg,
          recessedWell: light.insetBg,
          contentBorder: '#2B5B3F',
          trackVolt: '#C8FF00',
          stadiumPine: '#1C5436',
          voltOliveInk: '#3F6212',
          obsidianInk: '#080A09',
          textPrimary: light.textPrimary,
          textSecondary: light.textSecondary,
          textMuted: light.textMuted,
        },
        dark: {
          outerSurround: '#0C1D14',
          stageCanvas: dark.canvasBg,
          cardSurface: dark.cardBg,
          recessedWell: dark.insetBg,
          contentBorder: '#2B543B',
          trackVolt: '#C8FF00',
          voltLimeInk: '#A3E635',
          obsidianInk: '#080A09',
          textPrimary: dark.textPrimary,
          textSecondary: dark.textSecondary,
          textMuted: dark.textMuted,
        },
      },
      sacredPhysiology: {
        lockedAgainstCoBranding: true,
        zones: {
          Z1_CoolMist: light.zones[0],
          Z2_AerobicTeal: light.zones[1],
          Z3_Ochre: light.zones[2],
          Z4_ThreshVermilion: light.zones[3],
          Z5_Crimson: light.zones[4],
          Z6_DeepViolet: light.zones[5],
        },
        banisterPmc: {
          light: {
            ctl: light.ctlCyan,
            atl: light.atlRose,
            tsbOptimal: light.tsbOptimalEmerald,
            tsbFresh: light.tsbFreshSky,
            tsbGrey: light.tsbGreyAmber,
            tsbOverreach: light.tsbOverreachRed,
          },
          dark: {
            ctl: dark.ctlCyan,
            atl: dark.atlRose,
            tsbOptimal: dark.tsbOptimalEmerald,
            tsbFresh: dark.tsbFreshSky,
            tsbGrey: dark.tsbGreyAmber,
            tsbOverreach: dark.tsbOverreachRed,
          },
        },
      },
      partnerIsolation: {
        stravaCtaBg: '#C23800',
        stravaCtaHover: '#A83000',
        stravaTextOnCta: '#FFFFFF',
      },
      typography: {
        display: 'Plus Jakarta Sans',
        body: 'Plus Jakarta Sans',
        telemetryMono: 'JetBrains Mono',
        minFontRem: 0.6875,
        minFontPx: 11,
      },
    },
    null,
    2
  );
}

export const BRAND_KIT_README_MD = `# MeetReady Official Brand Kit & Permissions

- **Canonical Name:** MeetReady (CamelCase \`MeetReady\` in running copy; domain \`https://meetready.app\`).
- **Canonical Positioning:** MeetReady — Track & Field & Cross Country Team OS.
- **Included Vectors (\`/svg/\`):** Primary Light/Dark lockups (S2 × MeetReady), Die-Cut Badge Pill, True Compound-Path 1-Ink Stencils (Obsidian Black, Reversed White, Track Volt), Standalone S2 Symbols & Tiled App Icons, Standalone MeetReady Wordmarks, 4-Lane Turn Watermark, and 1200x630 OpenGraph Card.
- **Usage & Print Policy:**
  - **Permitted:** Unmodified editorial coverage, podcasts, race meet heat sheets & programs, API partner directories, and active team tent banners, warm-ups, & roster posters using \`Team × MeetReady\` co-branding (following NFHS/NCAA competition uniform area limits <= 2.25 sq in on race singlets without implied institutional sponsorship).
  - **Prohibited:** Commercial merchandise resale, altering Z1–Z6 / Banister CTL-ATL-TSB physiological colors, placing raw #C8FF00 text on white paper, or fusing third-party hardware/platform logos into a combined MeetReady mark.
`;

export async function buildBrandKitZipUint8Array(
  extraPngEntries: Record<string, Uint8Array> = {}
): Promise<Uint8Array> {
  const { zipSync, strToU8 } = await import('fflate');
  const files: Record<string, Uint8Array> = {
    'BRAND_USAGE_AND_PERMISSIONS.md': strToU8(BRAND_KIT_README_MD),
    'tokens/meetready-design-tokens.json': strToU8(buildDesignTokensExportJson()),
  };

  for (const asset of BRAND_ASSET_CATALOG) {
    files[`svg/${asset.id}.svg`] = strToU8(asset.svgMarkup);
  }

  for (const [entryName, bytes] of Object.entries(extraPngEntries)) {
    files[`png/${entryName}`] = bytes;
  }

  return zipSync(files, { level: 6 });
}
