import { computeAccessibleTeamPalette, escapeTextForSafeAttr } from './teamPalette.ts';
import { getThreshThemePalette } from './themeTokens.ts';
import {
  buildBreakLaneMSymbolInnerSvg,
  buildMeetReadyWordmarkInnerSvg,
  buildS2SymbolInnerSvg,
  buildWAWordmarkInnerSvg,
} from './brandVectors.ts';
import { generateQrCodeSvgMarkup } from './qrCodeSvg.ts';

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
// Shared 1B-Pro Break-Lane M × Outlined MeetReady SVG Builders (Zero Gradients, Zero <text>)
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
    buildBreakLaneMSymbolInnerSvg(opts.pineColor, opts.accentColor, 'translate(6, 5) scale(0.94)'),
    buildMeetReadyWordmarkInnerSvg(opts.inkColor, opts.accentColor, 'translate(135, 54)'),
    `</svg>`,
  ].join('');
}

export function buildStackedLockupSvg(opts: {
  pineColor: string;
  accentColor: string;
  inkColor: string;
}): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" fill="none">`,
    buildBreakLaneMSymbolInnerSvg(opts.pineColor, opts.accentColor, 'translate(92, 16) scale(1.06)'),
    buildMeetReadyWordmarkInnerSvg(opts.inkColor, opts.accentColor, 'translate(28, 166) scale(0.815)'),
    `</svg>`,
  ].join('');
}

/**
 * Pure monochrome single-ink SVG lockup with zero painted casing strokes, zero `<mask>`,
 * zero `<text>`, and zero gradients — 100% safe for screen-printing, vinyl plotters & embroidery.
 */
export function buildOneInkKnockoutLockupSvg(inkColor: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 472 124" fill="none">`,
    buildBreakLaneMSymbolInnerSvg(inkColor, inkColor, 'translate(6, 5) scale(0.94)'),
    buildMeetReadyWordmarkInnerSvg(inkColor, inkColor, 'translate(135, 54)'),
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
  // Full-bleed tiles keep the mark comfortably inside the 64% iOS/Android safe zone; standalone symbols maximize frame fill.
  const scaleTransform = opts.tile
    ? 'translate(64 64) scale(0.68) translate(-64 -64)'
    : 'translate(64 64) scale(0.96) translate(-64 -64)';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none">`,
    tileEl,
    buildBreakLaneMSymbolInnerSvg(opts.pineColor, opts.accentColor, scaleTransform),
    `</svg>`,
  ].join('');
}

export function buildOneInkKnockoutGaugeSvg(inkColor: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none">`,
    buildBreakLaneMSymbolInnerSvg(
      inkColor,
      inkColor,
      'translate(64 64) scale(0.96) translate(-64 -64)'
    ),
    `</svg>`,
  ].join('');
}

export function buildStandaloneWordmarkSvg(opts: {
  inkColor: string;
  accentColor?: string;
}): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 344 80" fill="none">`,
    buildMeetReadyWordmarkInnerSvg(opts.inkColor, opts.inkColor, 'translate(10, 8)'),
    `</svg>`,
  ].join('');
}

export function buildWatermarkTurnSvg(): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 220" fill="none">`,
    `<path d="M 260 190 H 120 A 70 70 0 0 1 120 50 H 260" stroke="#B83A24" stroke-width="6"/>`,
    `<path d="M 260 204 H 120 A 84 84 0 0 1 120 36 H 260" stroke="#121413" stroke-width="6"/>`,
    `<path d="M 260 218 H 120 A 98 98 0 0 1 120 22 H 260" stroke="#121413" stroke-width="6"/>`,
    `<path d="M 260 232 H 120 A 112 112 0 0 1 120 8 H 260" stroke="#121413" stroke-width="6"/>`,
    `</svg>`,
  ].join('');
}

export function buildCircularCrestStickerSvg(): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 360" fill="none">`,
    `<defs>`,
    `<path id="meetready-grad-crest-top" d="M 52 182 A 128 128 0 1 1 308 182"/>`,
    `<path id="meetready-grad-crest-bot" d="M 46 184 A 134 134 0 0 0 314 184"/>`,
    `</defs>`,
    `<circle cx="180" cy="180" r="168" fill="#121413" stroke="#B83A24" stroke-width="8"/>`,
    `<circle cx="180" cy="180" r="154" stroke="#F6F3EC" stroke-opacity="0.22" stroke-width="2"/>`,
    `<circle cx="180" cy="180" r="94" stroke="#D8FF2A" stroke-width="2.5"/>`,
    buildBreakLaneMSymbolInnerSvg('#F6F3EC', '#D8FF2A', 'translate(180 180) scale(0.92) translate(-64 -64)'),
    `<text fill="#F6F3EC" font-family="'Archivo', -apple-system, sans-serif" font-size="24" font-weight="800" letter-spacing="3.5"><textPath href="#meetready-grad-crest-top" startOffset="50%" text-anchor="middle">MeetReady</textPath></text>`,
    `<text fill="#D8FF2A" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="16" font-weight="700" letter-spacing="2.6"><textPath href="#meetready-grad-crest-bot" startOffset="50%" text-anchor="middle">TRACK · FIELD · XC</textPath></text>`,
    `</svg>`,
  ].join('');
}

export function buildContourMarkStickerSvg(): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" fill="none">`,
    `<rect x="14" y="14" width="272" height="272" rx="64" fill="#F6F3EC" stroke="#121413" stroke-width="3"/>`,
    `<rect x="28" y="28" width="244" height="244" rx="52" fill="#121413" stroke="#B83A24" stroke-width="6"/>`,
    buildBreakLaneMSymbolInnerSvg('#F6F3EC', '#D8FF2A', 'translate(150 150) scale(1.42) translate(-64 -64)'),
    `</svg>`,
  ].join('');
}

export function buildMerchTeeBackSvg(): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 440" fill="none">`,
    `<rect width="600" height="440" rx="20" fill="#121413"/>`,
    `<g opacity="0.28">`,
    `<path d="M 600 370 H 390 A 105 105 0 0 1 390 160 H 600" stroke="#D8FF2A" stroke-width="7"/>`,
    `<path d="M 600 392 H 390 A 127 127 0 0 1 390 138 H 600" stroke="#B83A24" stroke-width="7"/>`,
    `<path d="M 600 414 H 390 A 149 149 0 0 1 390 116 H 600" stroke="#F6F3EC" stroke-width="5"/>`,
    `</g>`,
    buildBreakLaneMSymbolInnerSvg('#F6F3EC', '#D8FF2A', 'translate(54, 48) scale(0.72)'),
    `<text x="56" y="220" fill="#F6F3EC" font-family="'Barlow Condensed', 'Archivo', sans-serif" font-size="56" font-weight="800" letter-spacing="-0.5">BUILT FOR MEET DAY.</text>`,
    `<text x="56" y="276" fill="#D8FF2A" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="22" font-weight="700" letter-spacing="1.6">RUN. JUMP. THROW. MEET READY.</text>`,
    `<line x1="56" y1="316" x2="360" y2="316" stroke="#B83A24" stroke-width="4"/>`,
    `<text x="56" y="362" fill="#A39E93" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="18" font-weight="600" letter-spacing="2">TRACK · FIELD · XC · meetready.app</text>`,
    `</svg>`,
  ].join('');
}

export function buildBanner10x3QrSvg(): string {
  const bannerQrInner = generateQrCodeSvgMarkup('https://meetready.app/meet', '#121413', 228).replace(
    /^<svg[^>]*>|<\/svg>$/g,
    ''
  );
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 360" fill="none">`,
    `<rect width="1200" height="360" rx="16" fill="#121413"/>`,
    `<rect x="16" y="16" width="1168" height="328" rx="12" stroke="#B83A24" stroke-width="4"/>`,
    `<g transform="translate(52, 46) scale(0.95)">`,
    buildBreakLaneMSymbolInnerSvg('#F6F3EC', '#D8FF2A', 'translate(6, 5) scale(0.94)'),
    buildMeetReadyWordmarkInnerSvg('#F6F3EC', '#F6F3EC', 'translate(135, 54)'),
    `</g>`,
    `<text x="56" y="242" fill="#F6F3EC" font-family="'Barlow Condensed', 'Archivo', sans-serif" font-size="54" font-weight="800" letter-spacing="-0.6">BUILT FOR MEET DAY.</text>`,
    `<rect x="56" y="268" width="446" height="44" rx="22" fill="#D8FF2A"/>`,
    `<text x="279" y="297" text-anchor="middle" fill="#121413" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="18" font-weight="700" letter-spacing="1.4">TRACK · FIELD · XC · meetready.app</text>`,
    `<rect x="886" y="34" width="268" height="292" rx="20" fill="#F6F3EC"/>`,
    `<g transform="translate(906, 46)"><svg viewBox="0 0 33 33" width="228" height="228">${bannerQrInner}</svg></g>`,
    `<text x="1020" y="304" text-anchor="middle" fill="#121413" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="15" font-weight="700" letter-spacing="0.8">SCAN → TRY LIVE DEMO</text>`,
    `</svg>`,
  ].join('');
}

export function buildSocialOgBannerSvg(): string {
  const heroLockupInner = [
    `<g transform="translate(64, 86) scale(1.25)">`,
    buildBreakLaneMSymbolInnerSvg('#F6F3EC', '#D8FF2A', 'translate(6, 5) scale(0.94)'),
    buildMeetReadyWordmarkInnerSvg('#F6F3EC', '#F6F3EC', 'translate(135, 54)'),
    `</g>`,
  ].join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" fill="none">`,
    `<rect width="1200" height="630" fill="#121413"/>`,
    `<rect x="28" y="28" width="1144" height="574" rx="24" fill="#B83A24"/>`,
    `<path d="M 1172 520 H 780 A 210 210 0 0 1 780 100 H 1172" stroke="#F6F3EC" stroke-opacity="0.22" stroke-width="2.5"/>`,
    `<path d="M 1172 552 H 780 A 242 242 0 0 1 780 68 H 1172" stroke="#F6F3EC" stroke-opacity="0.22" stroke-width="2.5"/>`,
    heroLockupInner,
    `<text x="72" y="318" fill="#F6F3EC" font-family="'Barlow Condensed', 'Archivo', sans-serif" font-size="56" font-weight="800" letter-spacing="-0.6">EVERY EVENT. EVERY MARK.</text>`,
    `<text x="72" y="376" fill="#D8FF2A" font-family="'Barlow Condensed', 'Archivo', sans-serif" font-size="56" font-weight="800" letter-spacing="-0.6">ONE TEAM PLATFORM.</text>`,
    `<text x="72" y="432" fill="#F6F3EC" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="17" font-weight="600" letter-spacing="1.2">OFFLINE SPLITS · FIELD MARKS · PACE PODS</text>`,
    `<rect x="72" y="476" width="444" height="54" rx="27" fill="#D8FF2A"/>`,
    `<text x="294" y="510" text-anchor="middle" fill="#121413" font-family="'Archivo', -apple-system, sans-serif" font-size="20" font-weight="800">Free Founding Season · meetready.app</text>`,
    `<rect x="706" y="74" width="424" height="482" rx="22" fill="#121413" stroke="#F6F3EC" stroke-opacity="0.28" stroke-width="2"/>`,
    `<text x="740" y="122" fill="#A39E93" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="14" font-weight="700" letter-spacing="1.4">TRACKSIDE STOPWATCH &amp; FIELD</text>`,
    `<text x="740" y="202" fill="#D8FF2A" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="68" font-weight="700" letter-spacing="-2">01:08.42</text>`,
    `<rect x="740" y="236" width="356" height="74" rx="12" fill="#1A1D1B" stroke="#F6F3EC" stroke-opacity="0.16" stroke-width="1.5"/>`,
    `<text x="762" y="268" fill="#F6F3EC" font-family="'Archivo', sans-serif" font-size="20" font-weight="800">Pod A · Lucas Alvarez</text>`,
    `<text x="762" y="294" fill="#D8FF2A" font-family="'JetBrains Mono', monospace" font-size="16" font-weight="600">400m Split: 1:08.42  (-0.6s)</text>`,
    `<rect x="740" y="326" width="356" height="74" rx="12" fill="#1A1D1B" stroke="#F6F3EC" stroke-opacity="0.16" stroke-width="1.5"/>`,
    `<text x="762" y="358" fill="#F6F3EC" font-family="'Archivo', sans-serif" font-size="20" font-weight="800">Field Sheet · Jumps &amp; Throws</text>`,
    `<text x="762" y="384" fill="#A39E93" font-family="'JetBrains Mono', monospace" font-size="15" font-weight="600">HJ 6&apos;4&quot; PR · SP 48&apos;6&quot; · PV 14&apos;6&quot;</text>`,
    `<rect x="740" y="422" width="356" height="96" rx="12" fill="#1A1D1B" stroke="#F6F3EC" stroke-opacity="0.16" stroke-width="1.5"/>`,
    `<text x="762" y="458" fill="#F6F3EC" font-family="'Archivo', sans-serif" font-size="18" font-weight="700">FERPA / SafeSport Shield Active</text>`,
    `<text x="762" y="488" fill="#A39E93" font-family="'Archivo', sans-serif" font-size="15" font-weight="600">Zero ads · Free for students ($0)</text>`,
    `</svg>`,
  ].join('');
}

export function buildAdOgBannerSvg(): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" fill="none">`,
    `<rect width="1200" height="630" fill="#121413"/>`,
    `<rect x="28" y="28" width="1144" height="574" rx="24" fill="#F6F3EC" stroke="#121413" stroke-width="3"/>`,
    `<g transform="translate(64, 72) scale(1.05)">`,
    buildBreakLaneMSymbolInnerSvg('#121413', '#B83A24', 'translate(6, 5) scale(0.94)'),
    buildMeetReadyWordmarkInnerSvg('#121413', '#121413', 'translate(135, 54)'),
    `</g>`,
    `<text x="72" y="266" fill="#121413" font-family="'Archivo', -apple-system, sans-serif" font-size="46" font-weight="800" letter-spacing="-1">School &amp; Athletic Director Brief</text>`,
    `<text x="72" y="324" fill="#B83A24" font-family="'Archivo', -apple-system, sans-serif" font-size="28" font-weight="700">FERPA · COPPA · CA NDPA · SafeSport Weight Shield</text>`,
    `<rect x="72" y="370" width="504" height="162" rx="16" fill="#FFFFFF" stroke="#121413" stroke-width="2"/>`,
    `<text x="98" y="418" fill="#1E4D36" font-family="'JetBrains Mono', monospace" font-size="16" font-weight="700">FOUNDING SEASON PILOT</text>`,
    `<text x="98" y="468" fill="#121413" font-family="'Archivo', sans-serif" font-size="40" font-weight="800">$0 First Season</text>`,
    `<text x="98" y="504" fill="#57544D" font-family="'Archivo', sans-serif" font-size="20" font-weight="600">Then $250/yr flat school PO · Zero ads ever</text>`,
    `<rect x="612" y="370" width="516" height="162" rx="16" fill="#121413"/>`,
    `<text x="642" y="424" fill="#D8FF2A" font-family="'JetBrains Mono', monospace" font-size="18" font-weight="700">ZERO STUDENT TRACKING</text>`,
    `<text x="642" y="468" fill="#F6F3EC" font-family="'Archivo', sans-serif" font-size="24" font-weight="700">W-9 &amp; NDPA DPA Packet Included</text>`,
    `<text x="642" y="506" fill="#A39E93" font-family="'JetBrains Mono', monospace" font-size="18" font-weight="600">meetready.app/for-athletic-directors</text>`,
    `</svg>`,
  ].join('');
}

// =============================================================================
// Canonical 23-Asset Print, Apparel, Social & Digital Catalog
// =============================================================================
export const BRAND_ASSET_CATALOG: BrandAssetDefinition[] = [
  {
    id: 'meetready-lockup-dark',
    title: 'Primary Lockup — Dark Stage',
    subtitle: 'Velocity Chevron M (#F6F3EC / #D8FF2A) + Outlined MeetReady (#F6F3EC)',
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
    recommendedFor: 'Track Asphalt (#121413) surfaces, dark footers, apparel chest/banners',
    minPhysicalSpec: 'Flat 2-ink fills (no gradients) · Min 0.5 in tall · 0 font dependency',
    svgMarkup: buildMultiToneLockupSvg({
      pineColor: '#F6F3EC',
      accentColor: '#D8FF2A',
      inkColor: '#F6F3EC',
    }),
  },
  {
    id: 'meetready-lockup-light',
    title: 'Primary Lockup — Light Stage',
    subtitle: 'Track Asphalt & Mondo Clay Velocity Chevron M (#121413 / #B83A24) + Outlined MeetReady',
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
    recommendedFor: 'Stadium Chalk slides, CMYK meet programs, locker-room QR headers',
    minPhysicalSpec: 'CMYK-safe PMS Black 6 C + PMS 7621 C · 0 font dependency',
    svgMarkup: buildMultiToneLockupSvg({
      pineColor: '#121413',
      accentColor: '#B83A24',
      inkColor: '#121413',
    }),
  },
  {
    id: 'meetready-stacked-dark',
    title: 'Stacked Lockup — Dark Stage',
    subtitle: 'Centered Velocity Chevron M over monolithic MeetReady (4:3 badge proportion)',
    category: 'LOCKUPS',
    width: 320,
    height: 240,
    viewBox: '0 0 320 240',
    svgPath: '/brand/meetready-stacked-dark.svg',
    staticPngPath: '/brand/meetready-stacked-dark-2x.png',
    pngSizes: [
      { key: '1x', label: '1x (320×240)', width: 320, height: 240 },
      { key: '2x', label: '2x (640×480)', width: 640, height: 480 },
      { key: '4x', label: '4x Print (1280×960)', width: 1280, height: 960 },
    ],
    recommendedFor: 'Square/4:5 social ads, clinic booth podiums, center-chest hoodies',
    minPhysicalSpec: '2-ink flat embroidery/plastisol ready · 0 font dependency',
    svgMarkup: buildStackedLockupSvg({
      pineColor: '#F6F3EC',
      accentColor: '#D8FF2A',
      inkColor: '#F6F3EC',
    }),
  },
  {
    id: 'meetready-stacked-light',
    title: 'Stacked Lockup — Light Stage',
    subtitle: 'Centered Velocity Chevron M (#121413 / #B83A24) over monolithic MeetReady',
    category: 'LOCKUPS',
    width: 320,
    height: 240,
    viewBox: '0 0 320 240',
    svgPath: '/brand/meetready-stacked-light.svg',
    staticPngPath: '/brand/meetready-stacked-light-2x.png',
    pngSizes: [
      { key: '1x', label: '1x (320×240)', width: 320, height: 240 },
      { key: '2x', label: '2x (640×480)', width: 640, height: 480 },
      { key: '4x', label: '4x Print (1280×960)', width: 1280, height: 960 },
    ],
    recommendedFor: 'Coach clinic half-sheet flyers, AD briefs, chalk cotton tees',
    minPhysicalSpec: 'CMYK-safe Track Asphalt + Mondo Clay · 0 font dependency',
    svgMarkup: buildStackedLockupSvg({
      pineColor: '#121413',
      accentColor: '#B83A24',
      inkColor: '#121413',
    }),
  },
  {
    id: 'meetready-sticker-diecut',
    title: 'Clipboard & Bumper Sticker Pill',
    subtitle: 'Balanced #121413 container guaranteeing >15:1 contrast over any backdrop',
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
    recommendedFor: 'Coach clipboards, sunlit race photos, laptop lids, scoreboard bugs',
    minPhysicalSpec: '4.0" × 1.05" print cutout · add 0.125" bleed for plotter CutContour',
    svgMarkup: buildMultiToneLockupSvg({
      pineColor: '#F6F3EC',
      accentColor: '#D8FF2A',
      inkColor: '#F6F3EC',
      backgroundRect: { fill: '#121413', rx: 24 },
    }),
  },
  {
    id: 'meetready-sticker-crest',
    title: 'Circular Varsity Crest Sticker (3" × 3")',
    subtitle: 'Varsity circular badge enclosing Velocity Chevron M (TRACK · FIELD · XC)',
    category: 'LOCKUPS',
    width: 360,
    height: 360,
    viewBox: '0 0 360 360',
    svgPath: '/brand/meetready-sticker-crest.svg',
    staticPngPath: '/brand/meetready-sticker-crest-2x.png',
    pngSizes: [
      { key: '1x', label: '1x (360×360)', width: 360, height: 360 },
      { key: '2x', label: '2x (720×720)', width: 720, height: 720 },
      { key: '4x', label: '4x Print (1440×1440)', width: 1440, height: 1440 },
    ],
    recommendedFor: 'Hydro Flask / water bottle stickers, lifestyle tee backs, tote bags',
    minPhysicalSpec: '3.0" × 3.0" matte UV vinyl · min 2.25" diameter for arched typography',
    svgMarkup: buildCircularCrestStickerSvg(),
  },
  {
    id: 'meetready-1ink-stencil',
    title: '1-Ink Asphalt Stencil (Knockout)',
    subtitle: 'True boolean outlined <path> stencil — zero strokes, zero <text> nodes',
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
    minPhysicalSpec: 'True 1-ink filled paths · 0 font dependency · plotter & silk-screen verified',
    svgMarkup: buildOneInkKnockoutLockupSvg('#121413'),
  },
  {
    id: 'meetready-1ink-stencil-white',
    title: '1-Ink Reversed White Stencil (Knockout)',
    subtitle: 'Pure #FFFFFF outlined <path> stencil for dark gear & night banners',
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
    minPhysicalSpec: 'Single-screen low-bleed poly white plastisol / HTV ready · 0 fonts',
    svgMarkup: buildOneInkKnockoutLockupSvg('#FFFFFF'),
  },
  {
    id: 'meetready-1ink-stencil-volt',
    title: '1-Ink Starter Volt Stencil (Knockout)',
    subtitle: 'High-vis #D8FF2A single-ink outlined cutout for dark Asphalt or Pine textiles',
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
    recommendedFor: 'Dark stadium scrims, PMS 809 C fluorescent plastisol over white underbase',
    minPhysicalSpec: 'Pantone 809 C / Siser Fluo Yellow HTV · 0 font dependency',
    svgMarkup: buildOneInkKnockoutLockupSvg('#D8FF2A'),
  },
  {
    id: 'meetready-gauge-symbol-dark',
    title: 'Velocity Chevron M Emblem — Transparent (Dark)',
    subtitle: 'Standalone flat 2-ink mark (#F6F3EC + #D8FF2A) for dark apparel & avatars',
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
    recommendedFor: 'Hat crowns, left-chest polos (1.65" W), dark club avatars, overlays',
    minPhysicalSpec: 'Flat 2-thread embroidery (zero gradients) · min 0.75" satin width',
    svgMarkup: buildGaugeIconSvg({
      pineColor: '#F6F3EC',
      accentColor: '#D8FF2A',
    }),
  },
  {
    id: 'meetready-gauge-symbol-light',
    title: 'Velocity Chevron M Emblem — Transparent (Light)',
    subtitle: 'Standalone Track Asphalt & Mondo Clay mark (#121413 + #B83A24) for light media',
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
    minPhysicalSpec: 'PMS Black 6 C + PMS 7621 C · WCAG AAA light contrast',
    svgMarkup: buildGaugeIconSvg({
      pineColor: '#121413',
      accentColor: '#B83A24',
    }),
  },
  {
    id: 'meetready-gauge-symbol-1ink-black',
    title: 'Velocity Chevron M — 1-Ink Black Knockout',
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
    recommendedFor: 'Relay batons, B&W heat-sheet footers, left-chest singlets & shorts',
    minPhysicalSpec: 'True boolean cutout · <= 2.25 sq in NCAA/NFHS uniform compliant',
    svgMarkup: buildOneInkKnockoutGaugeSvg('#121413'),
  },
  {
    id: 'meetready-gauge-symbol-1ink-white',
    title: 'Velocity Chevron M — 1-Ink White Knockout',
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
    recommendedFor: 'Dark hat embroidery, carbon gear decals, photo corner bugs',
    minPhysicalSpec: 'True boolean cutout · Madeira Polyneon #1801 single-thread safe',
    svgMarkup: buildOneInkKnockoutGaugeSvg('#FFFFFF'),
  },
  {
    id: 'meetready-icon-tile-dark',
    title: 'App Tile Icon — Asphalt Rounded',
    subtitle: 'Canonical rx=28 #121413 rounded-square tile with flat 2-ink Velocity Chevron M',
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
    recommendedFor: 'App launcher showcases, web docs cards (browser tabs use /icon.svg)',
    minPhysicalSpec: 'Matches /icon.svg Velocity Chevron M silhouette 1:1',
    svgMarkup: buildGaugeIconSvg({
      tile: { fill: '#121413', stroke: '#B83A24', rx: 28 },
      pineColor: '#F6F3EC',
      accentColor: '#D8FF2A',
    }),
  },
  {
    id: 'meetready-icon-tile-light',
    title: 'App Tile Icon — Stadium Chalk Rounded',
    subtitle: 'Chalk #F6F3EC rounded tile with #121413 architectural border',
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
      tile: { fill: '#F6F3EC', stroke: '#121413', rx: 28 },
      pineColor: '#121413',
      accentColor: '#B83A24',
    }),
  },
  {
    id: 'meetready-icon-square-fullbleed',
    title: 'Full-Bleed App Icon (iOS / Android / Strava)',
    subtitle: 'Opaque edge-to-edge #121413 square with 64% safe-zone Velocity Chevron M',
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
    recommendedFor: 'iOS apple-touch-icon, Android maskable PWA, App Store & Strava portals',
    minPhysicalSpec: 'Zero transparent corners · zero iOS corner artifacts',
    svgMarkup: buildGaugeIconSvg({
      tile: { fill: '#121413' },
      pineColor: '#F6F3EC',
      accentColor: '#D8FF2A',
    }),
  },
  {
    id: 'meetready-sticker-mark-diecut',
    title: 'Hydro Flask Contour Mark Sticker (2.5" × 2.5")',
    subtitle: 'Waterproof UV-laminated matte vinyl Velocity Chevron M contour sticker',
    category: 'ICONS',
    width: 300,
    height: 300,
    viewBox: '0 0 300 300',
    svgPath: '/brand/meetready-sticker-mark-diecut.svg',
    staticPngPath: '/brand/meetready-sticker-mark-diecut-2x.png',
    pngSizes: [
      { key: '1x', label: '1x (300×300)', width: 300, height: 300 },
      { key: '2x', label: '2x (600×600)', width: 600, height: 600 },
      { key: '4x', label: '4x Print (1200×1200)', width: 1200, height: 1200 },
    ],
    recommendedFor: 'Water bottles, laptops, pole tubes, throwing-implement bags',
    minPhysicalSpec: '2.5" × 2.5" contour die-cut with 0.125" chalk vinyl frame',
    svgMarkup: buildContourMarkStickerSvg(),
  },
  {
    id: 'meetready-wordmark-dark',
    title: 'Standalone Wordmark — Dark Stage',
    subtitle: 'Monolithic outlined CamelCase MeetReady wordmark (#F6F3EC, zero <text>)',
    category: 'WORDMARK_AND_SOCIAL',
    width: 344,
    height: 80,
    viewBox: '0 0 344 80',
    svgPath: '/brand/meetready-wordmark-dark.svg',
    pngSizes: [
      { key: '1x', label: '1x (344×80)', width: 344, height: 80 },
      { key: '2x', label: '2x (688×160)', width: 688, height: 160 },
      { key: '4x', label: '4x (1376×320)', width: 1376, height: 320 },
    ],
    recommendedFor: 'Back cap arch embroidery (2.5" W), jacket nape hit, dark footers',
    minPhysicalSpec: 'Single-ink outlined <path> · 0 font dependency',
    svgMarkup: buildStandaloneWordmarkSvg({ inkColor: '#F6F3EC' }),
  },
  {
    id: 'meetready-wordmark-light',
    title: 'Standalone Wordmark — Light Stage',
    subtitle: 'Monolithic outlined CamelCase MeetReady wordmark (#121413, zero <text>)',
    category: 'WORDMARK_AND_SOCIAL',
    width: 344,
    height: 80,
    viewBox: '0 0 344 80',
    svgPath: '/brand/meetready-wordmark-light.svg',
    pngSizes: [
      { key: '1x', label: '1x (344×80)', width: 344, height: 80 },
      { key: '2x', label: '2x (688×160)', width: 688, height: 160 },
      { key: '4x', label: '4x (1376×320)', width: 1376, height: 320 },
    ],
    recommendedFor: 'Compact white headers, heat sheets & light apparel',
    minPhysicalSpec: 'Single-ink PMS Black 6 C outlined <path> · 0 font dependency',
    svgMarkup: buildStandaloneWordmarkSvg({ inkColor: '#121413' }),
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
    recommendedFor: 'Slide deck corners, meet program endpapers, tee back textures',
    minPhysicalSpec: 'Use at 4%–14% opacity behind primary content',
    svgMarkup: buildWatermarkTurnSvg(),
  },
  {
    id: 'meetready-merch-tee-back',
    title: 'Apparel Back Print Master (2-Ink Tee)',
    subtitle: 'BUILT FOR MEET DAY. + RUN. JUMP. THROW. MEET READY. (10.5" W Back Hit)',
    category: 'WORDMARK_AND_SOCIAL',
    width: 600,
    height: 440,
    viewBox: '0 0 600 440',
    svgPath: '/brand/meetready-merch-tee-back.svg',
    staticPngPath: '/brand/meetready-merch-tee-back-2x.png',
    pngSizes: [
      { key: '1x', label: '1x (600×440)', width: 600, height: 440 },
      { key: '2x', label: '2x (1200×880)', width: 1200, height: 880 },
      { key: '4x', label: '4x Print (2400×1760)', width: 2400, height: 1760 },
    ],
    recommendedFor: 'Bella+Canvas 3001 / Next Level 6210 Forest Pine or Obsidian coach & team tees',
    minPhysicalSpec: 'Soft-hand White + PMS 809 C over underbase · pair with 1.65" left-chest M',
    svgMarkup: buildMerchTeeBackSvg(),
  },
  {
    id: 'meetready-banner-10x3-qr',
    title: '10ft × 3ft Trackside Fence Banner + QR',
    subtitle: '30-ft legible lockup, BUILT FOR MEET DAY., & solid white EC-M QR card',
    category: 'WORDMARK_AND_SOCIAL',
    width: 1200,
    height: 360,
    viewBox: '0 0 1200 360',
    svgPath: '/brand/meetready-banner-10x3-qr.svg',
    staticPngPath: '/brand/meetready-banner-10x3-qr-2x.png',
    pngSizes: [
      { key: '1x', label: '1x (1200×360)', width: 1200, height: 360 },
      { key: '2x', label: '2x Print (2400×720)', width: 2400, height: 720 },
      { key: '4x', label: '4x Mega (4800×1440)', width: 4800, height: 1440 },
    ],
    recommendedFor: 'Invitational fences, clinic backdrop, 10x10 canopy valances',
    minPhysicalSpec: '13oz 70/30 matte wind-slit mesh vinyl · #2 brass grommets every 24"',
    svgMarkup: buildBanner10x3QrSvg(),
  },
  {
    id: 'meetready-og-1200x630',
    title: 'Social & OpenGraph Banner (1200×630)',
    subtitle: 'Break-Lane M + Every mark. Every mile. + live Stopwatch & Field UI proof',
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
    recommendedFor: 'OpenGraph link previews, paid social cards, coaching clinic title slides',
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
    swatchHex: '#B83A24',
    description: 'Pairs each mark with its intended Stadium Chalk or Track Asphalt background',
  },
  {
    id: 'obsidian',
    label: 'Track Asphalt Stage',
    shortLabel: 'Asphalt',
    swatchHex: '#121413',
    description: 'Night trackside / dark cockpit (#121413)',
  },
  {
    id: 'chalk',
    label: 'Stadium Chalk Stage',
    shortLabel: 'Chalk',
    swatchHex: '#F6F3EC',
    description: 'Daylight workspace stage (#F6F3EC)',
  },
  {
    id: 'paper',
    label: 'Matte White Card',
    shortLabel: 'Paper',
    swatchHex: '#FFFFFF',
    description: 'White banner, slide deck, or print sheet (#FFFFFF)',
  },
  {
    id: 'volt',
    label: 'Starter Volt Flood',
    shortLabel: 'Volt',
    swatchHex: '#D8FF2A',
    description: 'High-visibility #D8FF2A trigger & flood accent',
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
  'meetready-stacked-dark',
  'meetready-1ink-stencil-white',
  'meetready-1ink-stencil-volt',
  'meetready-gauge-symbol-dark',
  'meetready-gauge-symbol-1ink-white',
  'meetready-wordmark-dark',
]);

const LIGHT_FIRST_IDS = new Set([
  'meetready-lockup-light',
  'meetready-stacked-light',
  'meetready-1ink-stencil',
  'meetready-gauge-symbol-light',
  'meetready-gauge-symbol-1ink-black',
  'meetready-wordmark-light',
]);

const SELF_FRAMED_IDS = new Set([
  'meetready-sticker-diecut',
  'meetready-sticker-crest',
  'meetready-sticker-mark-diecut',
  'meetready-icon-tile-dark',
  'meetready-icon-tile-light',
  'meetready-icon-square-fullbleed',
  'meetready-merch-tee-back',
  'meetready-banner-10x3-qr',
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
  const monoInk = opts.variant === '1ink-white' ? '#FFFFFF' : '#121413';

  const gradId = `meetready-grad-cobrand-${opts.variant}`;

  let crestMarkup = '';
  let nameColor = monoInk;
  let crossColor = monoInk;
  let threshMarkup = '';

  if (isOneInk) {
    crestMarkup = [
      `<rect x="${crestX + 2}" y="26" width="${crestSize - 4}" height="${crestSize - 4}" rx="18" fill="none" stroke="${monoInk}" stroke-width="5"/>`,
      `<text x="${crestX + crestSize / 2}" y="71" text-anchor="middle" fill="${monoInk}" font-family="'Archivo', -apple-system, sans-serif" font-size="26" font-weight="800" letter-spacing="-0.5">${cleanMono}</text>`,
    ].join('');
    threshMarkup = [
      `<g transform="translate(${lockupX}, 0)">`,
      buildBreakLaneMSymbolInnerSvg(monoInk, monoInk, 'translate(6, 5) scale(0.94)'),
      buildMeetReadyWordmarkInnerSvg(monoInk, monoInk, 'translate(135, 54)'),
      `</g>`,
    ].join('');
  } else {
    const isDark = opts.variant === 'dark';
    const accent = isDark ? palette.primaryOnDark : palette.primaryOnLight;
    const secondary = isDark ? palette.secondaryOnDark : palette.secondaryOnLight;
    const onPrimary = isDark ? palette.textOnPrimaryDark : palette.textOnPrimaryLight;
    const slatePine = isDark ? '#F6F3EC' : '#121413';
    const inkColor = isDark ? '#F6F3EC' : '#121413';
    nameColor = inkColor;
    crossColor = isDark ? '#A39E93' : '#57544D';

    crestMarkup = [
      `<defs><linearGradient id="${gradId}-crest" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${accent}"/><stop offset="100%" stop-color="${secondary}"/></linearGradient></defs>`,
      `<rect x="${crestX}" y="24" width="${crestSize}" height="${crestSize}" rx="18" fill="url(#${gradId}-crest)" stroke="rgba(255,255,255,0.22)" stroke-width="2"/>`,
      `<text x="${crestX + crestSize / 2}" y="70" text-anchor="middle" fill="${onPrimary}" font-family="'Archivo', -apple-system, sans-serif" font-size="27" font-weight="800" letter-spacing="-0.5">${cleanMono}</text>`,
    ].join('');

    threshMarkup = [
      `<g transform="translate(${lockupX}, 0)">`,
      buildBreakLaneMSymbolInnerSvg(slatePine, accent, 'translate(6, 5) scale(0.94)'),
      buildMeetReadyWordmarkInnerSvg(inkColor, accent, 'translate(135, 54)'),
      `</g>`,
    ].join('');
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} 124" width="${totalWidth}" height="124" fill="none">`,
    crestMarkup,
    `<text x="${nameX}" y="72" fill="${nameColor}" font-family="'Archivo', -apple-system, sans-serif" font-size="30" font-weight="800" letter-spacing="-0.7">${cleanName}</text>`,
    `<text x="${xMarkX}" y="71" fill="${crossColor}" font-family="'Archivo', -apple-system, sans-serif" font-size="26" font-weight="500">×</text>`,
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
      direction: 'Mondo Clay & Stadium Chalk (Concept A · Velocity Chevron M)',
      budgetRule: { neutralPercent: 80, structuralAccentPercent: 15, starterVoltMaxPercent: 5 },
      architecture: {
        light: {
          stageCanvas: light.canvasBg,
          cardSurface: light.cardBg,
          recessedWell: light.insetBg,
          mondoClay: '#B83A24',
          infieldPine: '#1E4D36',
          starterVolt: '#D8FF2A',
          trackAsphalt: '#121413',
          textPrimary: light.textPrimary,
          textSecondary: light.textSecondary,
          textMuted: light.textMuted,
        },
        dark: {
          stageCanvas: dark.canvasBg,
          cardSurface: dark.cardBg,
          recessedWell: dark.insetBg,
          mondoClay: '#E05238',
          infieldPine: '#2F7A55',
          starterVolt: '#D8FF2A',
          stadiumChalk: '#F6F3EC',
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
        display: 'Barlow Condensed',
        body: 'Archivo',
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
- **Canonical Positioning:** MeetReady — Every mark. Every mile. Meet ready. (Track, Field & Cross Country Team Platform).
- **Production Ink System (Flat 2-Ink, Zero Gradients):**
  - Mondo Clay \`#B83A24\` (Light Accent / Hero Field): PMS 7621 C · Madeira #1839.
  - Starter Volt \`#D8FF2A\` (Dark Right Peak & Primary CTAs): PMS 809 C fluorescent plastisol over flash-cured white underbase · Madeira #1902.
  - Track Asphalt \`#121413\`: PMS Black 6 C · Madeira #1800.
  - Stadium Chalk \`#F6F3EC\`: Warm Off-White · Madeira #1801.
- **Included Vectors (\`/svg/\`):** Primary & Stacked Dark/Light Velocity Chevron M lockups (outlined <path> zero <text>), True Compound-Path 1-Ink Stencils, Velocity Chevron M Emblems, Circular Varsity Crest Sticker, 2.5" Contour Mark Sticker, 2-Ink Tee Back (BUILT FOR MEET DAY. / RUN. JUMP. THROW. MEET READY.), 10ft × 3ft QR Trackside Banner, Full-Bleed App Icons, and 1200×630 OpenGraph Card.
- **Usage & Print Policy:**
  - **Permitted:** Unmodified editorial coverage, podcasts, race meet heat sheets & programs, API partner directories, and active team tent banners, warm-ups, & roster posters using \`Team × MeetReady\` co-branding (following NFHS/NCAA competition uniform area limits <= 2.25 sq in on race singlets without implied institutional sponsorship).
  - **Prohibited:** Commercial merchandise resale, altering mark/wordmark proportions, using retired legacy brand names in public copy, adding gradients to embroidery files, or recoding Z1–Z6 / Banister CTL-ATL-TSB physiology colors.
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
