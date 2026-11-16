import { computeAccessibleTeamPalette } from '../physiology/teamOnboardingEngine.ts';
import { escapeTextForSafeAttr } from './teamQrHelper.ts';
import { getThreshThemePalette } from './themeTokens.ts';

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

const NEEDLE_DEG = 313;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const TAN_14 = Math.tan(14 * DEG_TO_RAD);

function fmt(n: number): number {
  return Number(n.toFixed(2));
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = deg * DEG_TO_RAD;
  return [fmt(cx + r * Math.cos(rad)), fmt(cy + r * Math.sin(rad))];
}

function localOffsetToPolar(
  cx: number,
  cy: number,
  u: number,
  v: number,
  baseDeg = NEEDLE_DEG
): [number, number] {
  const rad = baseDeg * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [fmt(cx + u * cos - v * sin), fmt(cy + u * sin + v * cos)];
}

/**
 * Watertight circular stadium lane with exact radial gauge cut at `endDeg`
 * and `-14°` velocity-sheared straightaway termination at `rightX`.
 */
function buildStadiumShearedLanePath(
  cx: number,
  cy: number,
  r: number,
  width: number,
  endDeg: number,
  rightX: number
): string {
  const hw = width / 2;
  const rOut = r + hw;
  const rIn = r - hw;
  const yTop = fmt(cy + rIn);
  const yBot = fmt(cy + rOut);
  const xTopR = fmt(rightX + hw * TAN_14);
  const xBotR = fmt(rightX - hw * TAN_14);
  const [ox, oy] = polar(cx, cy, rOut, endDeg);
  const [ix, iy] = polar(cx, cy, rIn, endDeg);
  const delta = (((endDeg - 90) % 360) + 360) % 360;
  const largeArc = delta > 180 ? 1 : 0;
  return `M ${xBotR} ${yBot} L ${cx} ${yBot} A ${rOut} ${rOut} 0 ${largeArc} 1 ${ox} ${oy} L ${ix} ${iy} A ${rIn} ${rIn} 0 ${largeArc} 0 ${cx} ${yTop} L ${xTopR} ${yTop} Z`;
}

/**
 * Watertight radial gauge sector from `startDeg` clockwise to `endDeg`.
 */
function buildRadialSectorPath(
  cx: number,
  cy: number,
  r: number,
  width: number,
  startDeg: number,
  endDeg: number
): string {
  const hw = width / 2;
  const rOut = r + hw;
  const rIn = r - hw;
  const [ox1, oy1] = polar(cx, cy, rOut, startDeg);
  const [ox2, oy2] = polar(cx, cy, rOut, endDeg);
  const [ix2, iy2] = polar(cx, cy, rIn, endDeg);
  const [ix1, iy1] = polar(cx, cy, rIn, startDeg);
  const delta = (((endDeg - startDeg) % 360) + 360) % 360;
  const largeArc = delta > 180 ? 1 : 0;
  return `M ${ox1} ${oy1} A ${rOut} ${rOut} 0 ${largeArc} 1 ${ox2} ${oy2} L ${ix2} ${iy2} A ${rIn} ${rIn} 0 ${largeArc} 0 ${ix1} ${iy1} Z`;
}

function solveWedgeMoatPhi(
  radius: number,
  needleLength: number,
  baseHalfWidth: number,
  moatWidth: number
): number {
  const D = Math.hypot(needleLength, baseHalfWidth);
  const c = baseHalfWidth * needleLength + moatWidth * D;
  const amp = Math.hypot(baseHalfWidth, needleLength) * radius;
  const clamped = Math.max(-1, Math.min(1, c / amp));
  const phase = Math.atan2(baseHalfWidth, needleLength);
  return Math.asin(clamped) - phase;
}

/**
 * Splits a radial gauge sector around the angled needle moat so 1-ink vinyl/screen-print
 * stencils require zero painted masking strokes (`stroke="#FFFFFF"`).
 */
function buildKnockoutRadialSectorPair(
  cx: number,
  cy: number,
  r: number,
  width: number,
  startDeg: number,
  endDeg: number,
  needleLength: number,
  baseHalfWidth: number,
  moatWidth: number
): string[] {
  const hw = width / 2;
  const rOut = r + hw;
  const rIn = r - hw;
  const phiOut = solveWedgeMoatPhi(rOut, needleLength, baseHalfWidth, moatWidth) * RAD_TO_DEG;
  const phiIn = solveWedgeMoatPhi(rIn, needleLength, baseHalfWidth, moatWidth) * RAD_TO_DEG;

  const leftEndOut = fmt(NEEDLE_DEG - phiOut);
  const leftEndIn = fmt(NEEDLE_DEG - phiIn);
  const rightStartOut = fmt(NEEDLE_DEG + phiOut);
  const rightStartIn = fmt(NEEDLE_DEG + phiIn);

  const paths: string[] = [];
  if (leftEndOut > startDeg + 1 && leftEndIn > startDeg + 1) {
    const [ox1, oy1] = polar(cx, cy, rOut, startDeg);
    const [ox2, oy2] = polar(cx, cy, rOut, leftEndOut);
    const [ix2, iy2] = polar(cx, cy, rIn, leftEndIn);
    const [ix1, iy1] = polar(cx, cy, rIn, startDeg);
    const la = leftEndOut - startDeg > 180 ? 1 : 0;
    const laIn = leftEndIn - startDeg > 180 ? 1 : 0;
    paths.push(
      `M ${ox1} ${oy1} A ${rOut} ${rOut} 0 ${la} 1 ${ox2} ${oy2} L ${ix2} ${iy2} A ${rIn} ${rIn} 0 ${laIn} 0 ${ix1} ${iy1} Z`
    );
  }
  if (endDeg > rightStartOut + 1 && endDeg > rightStartIn + 1) {
    const [ox1, oy1] = polar(cx, cy, rOut, rightStartOut);
    const [ox2, oy2] = polar(cx, cy, rOut, endDeg);
    const [ix2, iy2] = polar(cx, cy, rIn, endDeg);
    const [ix1, iy1] = polar(cx, cy, rIn, rightStartIn);
    const la = endDeg - rightStartOut > 180 ? 1 : 0;
    const laIn = endDeg - rightStartIn > 180 ? 1 : 0;
    paths.push(
      `M ${ox1} ${oy1} A ${rOut} ${rOut} 0 ${la} 1 ${ox2} ${oy2} L ${ix2} ${iy2} A ${rIn} ${rIn} 0 ${laIn} 0 ${ix1} ${iy1} Z`
    );
  }
  return paths;
}

/**
 * Watertight full-curve outer Lane-4 arrow starting radially at `endDeg` (348°),
 * wrapping 258° counter-clockwise around the stadium turn, and shooting straight
 * underneath THRESH into the V1 right-pointing spearhead.
 */
function buildFullWrapOuterArrowPath(
  cx: number,
  cy: number,
  r: number,
  width: number,
  endDeg: number,
  shaftEndX: number
): string {
  const hw = width / 2;
  const rOut = r + hw;
  const rIn = r - hw;
  const [ox, oy] = polar(cx, cy, rOut, endDeg);
  const [ix, iy] = polar(cx, cy, rIn, endDeg);
  const yTop = fmt(cy + rIn);
  const yBot = fmt(cy + rOut);
  return [
    `M ${ox} ${oy}`,
    `A ${rOut} ${rOut} 0 1 0 ${cx} ${yBot}`,
    `H ${shaftEndX}`,
    `L ${shaftEndX - 5.5} ${fmt(cy + r + 11.8)}`,
    `L ${shaftEndX + 21} ${cy + r}`,
    `L ${shaftEndX - 5.5} ${fmt(cy + r - 11.8)}`,
    `L ${shaftEndX} ${yTop}`,
    `H ${cx}`,
    `A ${rIn} ${rIn} 0 1 1 ${ix} ${iy}`,
    'Z',
  ].join(' ');
}

/**
 * Same outer Lane-4 arrow with the inner rim carved cleanly as a rounded notch
 * around the gauge needle tip (`needleLength + tipMoat < rOut`), yielding a single
 * pure compound contour with zero masking strokes.
 */
function buildKnockoutFullWrapOuterArrowPath(
  cx: number,
  cy: number,
  r: number,
  width: number,
  endDeg: number,
  shaftEndX: number,
  needleLength: number,
  baseHalfWidth: number,
  moatWidth: number
): string {
  const hw = width / 2;
  const rOut = r + hw;
  const rIn = r - hw;
  const [ox, oy] = polar(cx, cy, rOut, endDeg);
  const [ix, iy] = polar(cx, cy, rIn, endDeg);
  const yTop = fmt(cy + rIn);
  const yBot = fmt(cy + rOut);

  const phiIn = solveWedgeMoatPhi(rIn, needleLength, baseHalfWidth, moatWidth) * RAD_TO_DEG;
  const notchPlusDeg = fmt(NEEDLE_DEG + phiIn);
  const notchMinusDeg = fmt(NEEDLE_DEG - phiIn);
  const [nxPlus, nyPlus] = polar(cx, cy, rIn, notchPlusDeg);
  const [nxMinus, nyMinus] = polar(cx, cy, rIn, notchMinusDeg);

  // Tangent points on rounded cap of radius `moatWidth` around needle tip `(needleLength, 0)`
  const D = Math.hypot(needleLength, baseHalfWidth);
  const tipTanU = needleLength + (moatWidth * baseHalfWidth) / D;
  const tipTanV = (moatWidth * needleLength) / D;
  const [txPlus, tyPlus] = localOffsetToPolar(cx, cy, tipTanU, tipTanV);
  const [txMinus, tyMinus] = localOffsetToPolar(cx, cy, tipTanU, -tipTanV);

  const arcBackLarge = notchMinusDeg - 90 > 180 ? 1 : 0;

  return [
    `M ${ox} ${oy}`,
    `A ${rOut} ${rOut} 0 1 0 ${cx} ${yBot}`,
    `H ${shaftEndX}`,
    `L ${shaftEndX - 5.5} ${fmt(cy + r + 11.8)}`,
    `L ${shaftEndX + 21} ${cy + r}`,
    `L ${shaftEndX - 5.5} ${fmt(cy + r - 11.8)}`,
    `L ${shaftEndX} ${yTop}`,
    `H ${cx}`,
    `A ${rIn} ${rIn} 0 ${arcBackLarge} 1 ${nxMinus} ${nyMinus}`,
    `L ${txMinus} ${tyMinus}`,
    `A ${moatWidth} ${moatWidth} 0 0 1 ${txPlus} ${tyPlus}`,
    `L ${nxPlus} ${nyPlus}`,
    `A ${rIn} ${rIn} 0 0 1 ${ix} ${iy}`,
    'Z',
  ].join(' ');
}

/**
 * Unites the center circular hub and tapered wedge needle into one watertight outer contour,
 * punched with an opposite-winding inner pinhole (`fill-rule="evenodd"`).
 */
function buildUnifiedHubAndNeedleCompoundPath(
  cx: number,
  cy: number,
  needleLength: number,
  baseHalfWidth: number,
  hubRadius: number,
  pinholeRadius: number
): string {
  // Solve `(L * (1 - s))^2 + (b * s)^2 = hubRadius^2` from tip T (`s=0`) toward base B (`s=1`)
  const aCoeff = needleLength * needleLength + baseHalfWidth * baseHalfWidth;
  const bCoeff = -2 * needleLength * needleLength;
  const cCoeff = needleLength * needleLength - hubRadius * hubRadius;
  const disc = Math.max(0, bCoeff * bCoeff - 4 * aCoeff * cCoeff);
  const s = (-bCoeff - Math.sqrt(disc)) / (2 * aCoeff);

  const exitU = needleLength * (1 - s);
  const exitV = baseHalfWidth * s;
  const [tx, ty] = localOffsetToPolar(cx, cy, needleLength, 0);
  const [pPlusX, pPlusY] = localOffsetToPolar(cx, cy, exitU, exitV);
  const [pMinusX, pMinusY] = localOffsetToPolar(cx, cy, exitU, -exitV);

  const outerHubPlusNeedle = [
    `M ${pMinusX} ${pMinusY}`,
    `L ${tx} ${ty}`,
    `L ${pPlusX} ${pPlusY}`,
    `A ${hubRadius} ${hubRadius} 0 1 1 ${pMinusX} ${pMinusY}`,
    'Z',
  ].join(' ');

  // Counter-clockwise inner pinhole loop inside clockwise hub contour for evenodd cutout
  const pxLeft = fmt(cx - pinholeRadius);
  const pxRight = fmt(cx + pinholeRadius);
  const pinholeLoop = `M ${pxLeft} ${cy} A ${pinholeRadius} ${pinholeRadius} 0 1 0 ${pxRight} ${cy} A ${pinholeRadius} ${pinholeRadius} 0 1 0 ${pxLeft} ${cy} Z`;
  return `${outerHubPlusNeedle} ${pinholeLoop}`;
}

/**
 * Outlined capsule path for a rounded stroke boundary tick (zero `<line stroke=...>` needed).
 */
function buildRoundedCapsulePath(
  cx: number,
  cy: number,
  rStart: number,
  rEnd: number,
  deg: number,
  strokeWidth: number
): string {
  const rCap = strokeWidth / 2;
  const [p1x, p1y] = localOffsetToPolar(cx, cy, rStart, -rCap, deg);
  const [p2x, p2y] = localOffsetToPolar(cx, cy, rEnd, -rCap, deg);
  const [p3x, p3y] = localOffsetToPolar(cx, cy, rEnd, rCap, deg);
  const [p4x, p4y] = localOffsetToPolar(cx, cy, rStart, rCap, deg);
  return `M ${p1x} ${p1y} L ${p2x} ${p2y} A ${rCap} ${rCap} 0 0 1 ${p3x} ${p3y} L ${p4x} ${p4y} A ${rCap} ${rCap} 0 0 1 ${p1x} ${p1y} Z`;
}

// =============================================================================
// Shared Vector Coordinates (Exact Parity with src/components/AeroPulseLogo.tsx)
// =============================================================================
const LOCKUP_CX = 64;
const LOCKUP_CY = 58;
const LOCKUP_PINE_LANES = [
  buildStadiumShearedLanePath(LOCKUP_CX, LOCKUP_CY, 19.0, 7.2, 241, 133.5),
  buildStadiumShearedLanePath(LOCKUP_CX, LOCKUP_CY, 30.0, 7.2, 259, 130.8),
  buildStadiumShearedLanePath(LOCKUP_CX, LOCKUP_CY, 41.0, 7.2, 277, 421.0),
];
const LOCKUP_INNER_SECTORS = [
  buildRadialSectorPath(LOCKUP_CX, LOCKUP_CY, 19.0, 7.5, 248, 348),
  buildRadialSectorPath(LOCKUP_CX, LOCKUP_CY, 30.0, 7.5, 266, 348),
  buildRadialSectorPath(LOCKUP_CX, LOCKUP_CY, 41.0, 7.5, 284, 348),
];
const LOCKUP_ARROW_FULL = buildFullWrapOuterArrowPath(LOCKUP_CX, LOCKUP_CY, 52.0, 7.5, 348, 444);

const LOCKUP_KNOCKOUT_SECTORS = [
  ...buildKnockoutRadialSectorPair(LOCKUP_CX, LOCKUP_CY, 19.0, 7.5, 248, 348, 51.8, 5.8, 2.8),
  ...buildKnockoutRadialSectorPair(LOCKUP_CX, LOCKUP_CY, 30.0, 7.5, 266, 348, 51.8, 5.8, 2.8),
  ...buildKnockoutRadialSectorPair(LOCKUP_CX, LOCKUP_CY, 41.0, 7.5, 284, 348, 51.8, 5.8, 2.8),
];
const LOCKUP_KNOCKOUT_ARROW = buildKnockoutFullWrapOuterArrowPath(
  LOCKUP_CX,
  LOCKUP_CY,
  52.0,
  7.5,
  348,
  444,
  51.8,
  5.8,
  2.8
);
const LOCKUP_KNOCKOUT_HUB_NEEDLE = buildUnifiedHubAndNeedleCompoundPath(
  LOCKUP_CX,
  LOCKUP_CY,
  51.8,
  5.8,
  9.8,
  3.6
);
const LOCKUP_KNOCKOUT_TICK = buildRoundedCapsulePath(LOCKUP_CX, LOCKUP_CY, 14, 56, 355, 3.2);

const [NEEDLE_TX, NEEDLE_TY] = polar(LOCKUP_CX, LOCKUP_CY, 51.8, 313);
const [NEEDLE_BX1, NEEDLE_BY1] = polar(LOCKUP_CX, LOCKUP_CY, 5.8, 223);
const [NEEDLE_BX2, NEEDLE_BY2] = polar(LOCKUP_CX, LOCKUP_CY, 5.8, 43);
const LOCKUP_NEEDLE_TRIANGLE = `M ${NEEDLE_BX1} ${NEEDLE_BY1} L ${NEEDLE_TX} ${NEEDLE_TY} L ${NEEDLE_BX2} ${NEEDLE_BY2} Z`;
const [TICK_X1, TICK_Y1] = polar(LOCKUP_CX, LOCKUP_CY, 14, 355);
const [TICK_X2, TICK_Y2] = polar(LOCKUP_CX, LOCKUP_CY, 56, 355);

const W1_WORDMARK_PATHS = [
  'M -6 0 H 39 L 36.2 13.8 H 26 V 64 H 12 V 13.8 H -8.8 Z',
  'M 43 0 H 57 V 25.2 H 69 V 0 H 83 V 64 H 69 V 38.4 H 57 V 64 H 43 Z',
  'M 90 0 H 118.5 C 128.4 0 133.5 5.8 133.5 16.8 C 133.5 25.4 129.2 31.2 121.6 33.6 L 134.2 64 H 118.8 L 107.6 35.6 H 104 V 64 H 90 Z M 104 11.2 V 24.2 H 115.2 C 118.2 24.2 119.6 22.0 119.6 17.7 C 119.6 13.4 118.2 11.2 115.2 11.2 Z',
  'M 139 0 H 177 L 174.4 13.0 H 153 V 25.4 H 173 L 170.6 37.8 H 153 V 51.0 H 176.5 L 174.0 64 H 139 Z',
  'M 181 17.2 C 181 6.4 188.0 0 200.6 0 H 208.6 C 217.8 0 222.5 5.2 222.5 14.2 V 17.5 H 208.6 V 14.4 C 208.6 11.8 206.8 10.6 203.4 10.6 H 199.4 C 196.2 10.6 194.6 12.2 194.6 15.6 C 194.6 19.6 197.4 21.8 209.6 26.2 C 218.8 29.5 222.8 34.8 222.8 45.8 C 222.8 57.6 215.8 64 203.2 64 H 195.2 C 185.8 64 181 58.6 181 49.2 V 45.8 H 194.8 V 49.2 C 194.8 52.0 196.6 53.4 200.0 53.4 H 204.2 C 207.4 53.4 209.0 51.6 209.0 47.6 C 209.0 43.2 206.2 40.8 194.0 36.4 C 184.8 33.0 181 27.6 181 17.2 Z',
  'M 228 0 H 242 V 25.2 H 254 V 0 H 268 V 64 H 254 V 38.4 H 242 V 64 H 228 Z',
];

function renderW1WordmarkPaths(fillAttr: string, transform = 'translate(144, 8) skewX(-14) scale(1.10, 1.29)'): string {
  const pathEls = W1_WORDMARK_PATHS.map((d, idx) =>
    idx === 2
      ? `<path d="${d}" fill-rule="evenodd" clip-rule="evenodd"/>`
      : `<path d="${d}"/>`
  ).join('');
  return `<g transform="${transform}" fill="${fillAttr}">${pathEls}</g>`;
}

// =============================================================================
// Square Icon / Gauge Symbol Geometry (128x128 viewBox)
// =============================================================================
const ICON_CX = 64;
const ICON_CY = 71.5;
const ICON_PINE_SECTORS = [
  buildRadialSectorPath(ICON_CX, ICON_CY, 19.5, 7.6, 134, 238),
  buildRadialSectorPath(ICON_CX, ICON_CY, 31.5, 7.6, 134, 258),
  buildRadialSectorPath(ICON_CX, ICON_CY, 43.5, 7.6, 134, 278),
];
const ICON_VOLT_SECTORS = [
  buildRadialSectorPath(ICON_CX, ICON_CY, 19.5, 7.8, 246, 348),
  buildRadialSectorPath(ICON_CX, ICON_CY, 31.5, 7.8, 266, 348),
  buildRadialSectorPath(ICON_CX, ICON_CY, 43.5, 7.8, 286, 348),
  buildRadialSectorPath(ICON_CX, ICON_CY, 55.5, 8.0, 134, 348),
];
const [ICON_NTX, ICON_NTY] = polar(ICON_CX, ICON_CY, 56.0, 313);
const [ICON_NBX1, ICON_NBY1] = polar(ICON_CX, ICON_CY, 6.8, 223);
const [ICON_NBX2, ICON_NBY2] = polar(ICON_CX, ICON_CY, 6.8, 43);
const ICON_NEEDLE_TRI = `M ${ICON_NBX1} ${ICON_NBY1} L ${ICON_NTX} ${ICON_NTY} L ${ICON_NBX2} ${ICON_NBY2} Z`;
const [ICON_TX1, ICON_TY1] = polar(ICON_CX, ICON_CY, 14.5, 356);

// True 1-ink knockout gauge symbol sectors (splits 19.5, 31.5, 43.5, and outer 55.5 around 313° needle moat)
const ICON_KNOCKOUT_SECTORS = [
  ...buildKnockoutRadialSectorPair(ICON_CX, ICON_CY, 19.5, 7.8, 246, 348, 56.0, 6.8, 3.2),
  ...buildKnockoutRadialSectorPair(ICON_CX, ICON_CY, 31.5, 7.8, 266, 348, 56.0, 6.8, 3.2),
  ...buildKnockoutRadialSectorPair(ICON_CX, ICON_CY, 43.5, 7.8, 286, 348, 56.0, 6.8, 3.2),
  ...buildKnockoutRadialSectorPair(ICON_CX, ICON_CY, 55.5, 8.0, 134, 348, 56.0, 6.8, 3.2),
];
const ICON_KNOCKOUT_HUB_NEEDLE = buildUnifiedHubAndNeedleCompoundPath(
  ICON_CX,
  ICON_CY,
  56.0,
  6.8,
  11.8,
  4.5
);
const ICON_KNOCKOUT_TICK = buildRoundedCapsulePath(ICON_CX, ICON_CY, 14.5, 57.5, 356, 4.2);

// =============================================================================
// SVG Builders (Namespaced Gradients + True Compound Knockouts)
// =============================================================================

export function buildMultiToneLockupSvg(opts: {
  gradId: string;
  pineColor: string;
  accentColor: string;
  casingColor: string;
  pinColor: string;
  gradStops: Array<[string, string]>;
  backgroundRect?: { fill: string; rx?: number };
}): string {
  const bg = opts.backgroundRect
    ? `<rect x="0" y="0" width="472" height="124"${opts.backgroundRect.rx ? ` rx="${opts.backgroundRect.rx}"` : ''} fill="${opts.backgroundRect.fill}"/>`
    : '';
  const stops = opts.gradStops
    .map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`)
    .join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 472 124" fill="none">`,
    bg,
    `<defs><linearGradient id="${opts.gradId}" gradientUnits="userSpaceOnUse" x1="-6" y1="0" x2="268" y2="0">${stops}</linearGradient></defs>`,
    `<g fill="${opts.pineColor}">${LOCKUP_PINE_LANES.map((d) => `<path d="${d}"/>`).join('')}</g>`,
    `<g fill="${opts.accentColor}">${LOCKUP_INNER_SECTORS.map((d) => `<path d="${d}"/>`).join('')}<path d="${LOCKUP_ARROW_FULL}"/></g>`,
    `<line x1="${TICK_X1}" y1="${TICK_Y1}" x2="${TICK_X2}" y2="${TICK_Y2}" stroke="${opts.accentColor}" stroke-width="3.2" stroke-linecap="round"/>`,
    `<path d="${LOCKUP_NEEDLE_TRIANGLE}" fill="${opts.accentColor}" stroke="${opts.casingColor}" stroke-width="6" stroke-linejoin="round" style="paint-order:stroke fill"/>`,
    `<circle cx="${LOCKUP_CX}" cy="${LOCKUP_CY}" r="9.8" fill="${opts.accentColor}" stroke="${opts.casingColor}" stroke-width="3.8" style="paint-order:stroke fill"/>`,
    `<circle cx="${LOCKUP_CX}" cy="${LOCKUP_CY}" r="3.6" fill="${opts.pinColor}"/>`,
    renderW1WordmarkPaths(`url(#${opts.gradId})`),
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
    `<g fill="${inkColor}">`,
    LOCKUP_PINE_LANES.map((d) => `<path d="${d}"/>`).join(''),
    LOCKUP_KNOCKOUT_SECTORS.map((d) => `<path d="${d}"/>`).join(''),
    `<path d="${LOCKUP_KNOCKOUT_ARROW}"/>`,
    `<path d="${LOCKUP_KNOCKOUT_TICK}"/>`,
    `<path d="${LOCKUP_KNOCKOUT_HUB_NEEDLE}" fill-rule="evenodd" clip-rule="evenodd"/>`,
    `</g>`,
    renderW1WordmarkPaths(inkColor),
    `</svg>`,
  ].join('');
}

function buildMultiToneGaugeInnerGroup(opts: {
  pineColor: string;
  accentColor: string;
  casingColor: string;
  pinColor: string;
}): string {
  return [
    `<g transform="translate(64 66) scale(0.84) translate(-64 -70)">`,
    `<g fill="${opts.pineColor}">${ICON_PINE_SECTORS.map((d) => `<path d="${d}"/>`).join('')}</g>`,
    `<g fill="${opts.accentColor}">${ICON_VOLT_SECTORS.map((d) => `<path d="${d}"/>`).join('')}</g>`,
    `<line x1="${ICON_TX1}" y1="${ICON_TY1}" x2="120.5" y2="67.55" stroke="${opts.accentColor}" stroke-width="4.2" stroke-linecap="round"/>`,
    `<path d="${ICON_NEEDLE_TRI}" fill="${opts.accentColor}" stroke="${opts.casingColor}" stroke-width="7.4" stroke-linejoin="round" style="paint-order:stroke fill"/>`,
    `<circle cx="${ICON_CX}" cy="${ICON_CY}" r="11.8" fill="${opts.accentColor}" stroke="${opts.casingColor}" stroke-width="4.6" style="paint-order:stroke fill"/>`,
    `<circle cx="${ICON_CX}" cy="${ICON_CY}" r="4.5" fill="${opts.pinColor}"/>`,
    `</g>`,
  ].join('');
}

export function buildGaugeIconSvg(opts: {
  tile?: { fill: string; stroke?: string; rx?: number };
  pineColor: string;
  accentColor: string;
  casingColor: string;
  pinColor: string;
}): string {
  const tileEl = opts.tile
    ? `<rect x="${opts.tile.stroke ? 2 : 0}" y="${opts.tile.stroke ? 2 : 0}" width="${opts.tile.stroke ? 124 : 128}" height="${opts.tile.stroke ? 124 : 128}"${opts.tile.rx ? ` rx="${opts.tile.rx}"` : ''} fill="${opts.tile.fill}"${opts.tile.stroke ? ` stroke="${opts.tile.stroke}" stroke-width="3.5"` : ''}/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none">${tileEl}${buildMultiToneGaugeInnerGroup(opts)}</svg>`;
}

export function buildOneInkKnockoutGaugeSvg(inkColor: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none">`,
    `<g transform="translate(64 66) scale(0.84) translate(-64 -70)" fill="${inkColor}">`,
    ICON_PINE_SECTORS.map((d) => `<path d="${d}"/>`).join(''),
    ICON_KNOCKOUT_SECTORS.map((d) => `<path d="${d}"/>`).join(''),
    `<path d="${ICON_KNOCKOUT_TICK}"/>`,
    `<path d="${ICON_KNOCKOUT_HUB_NEEDLE}" fill-rule="evenodd" clip-rule="evenodd"/>`,
    `</g></svg>`,
  ].join('');
}

export function buildStandaloneWordmarkSvg(opts: {
  gradId: string;
  gradStops: Array<[string, string]>;
}): string {
  const stops = opts.gradStops
    .map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`)
    .join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 328 96" fill="none">`,
    `<defs><linearGradient id="${opts.gradId}" gradientUnits="userSpaceOnUse" x1="-6" y1="0" x2="268" y2="0">${stops}</linearGradient></defs>`,
    renderW1WordmarkPaths(`url(#${opts.gradId})`, 'translate(22, 6) skewX(-14) scale(1.10, 1.29)'),
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
    `<defs><linearGradient id="thresh-grad-og-lockup" gradientUnits="userSpaceOnUse" x1="-6" y1="0" x2="268" y2="0"><stop offset="0%" stop-color="#F6FBF7"/><stop offset="38%" stop-color="#E8FFD1"/><stop offset="72%" stop-color="#D4FF38"/><stop offset="100%" stop-color="#C8FF00"/></linearGradient></defs>`,
    `<g fill="#399663">${LOCKUP_PINE_LANES.map((d) => `<path d="${d}"/>`).join('')}</g>`,
    `<g fill="#C8FF00">${LOCKUP_INNER_SECTORS.map((d) => `<path d="${d}"/>`).join('')}<path d="${LOCKUP_ARROW_FULL}"/></g>`,
    `<line x1="${TICK_X1}" y1="${TICK_Y1}" x2="${TICK_X2}" y2="${TICK_Y2}" stroke="#C8FF00" stroke-width="3.2" stroke-linecap="round"/>`,
    `<path d="${LOCKUP_NEEDLE_TRIANGLE}" fill="#C8FF00" stroke="#0B120E" stroke-width="6" stroke-linejoin="round" style="paint-order:stroke fill"/>`,
    `<circle cx="${LOCKUP_CX}" cy="${LOCKUP_CY}" r="9.8" fill="#C8FF00" stroke="#0B120E" stroke-width="3.8" style="paint-order:stroke fill"/>`,
    `<circle cx="${LOCKUP_CX}" cy="${LOCKUP_CY}" r="3.6" fill="#0B120E"/>`,
    renderW1WordmarkPaths('url(#thresh-grad-og-lockup)'),
    `</g>`,
  ].join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" fill="none">`,
    `<defs>`,
    `<radialGradient id="thresh-grad-og-flood" cx="14%" cy="6%" r="68%"><stop offset="0%" stop-color="#C8FF00" stop-opacity="0.18"/><stop offset="100%" stop-color="#0C1D14" stop-opacity="0"/></radialGradient>`,
    `<clipPath id="thresh-grad-og-clip"><rect x="34" y="34" width="1132" height="562" rx="28"/></clipPath>`,
    `</defs>`,
    `<rect width="1200" height="630" fill="#0C1D14"/>`,
    `<rect width="1200" height="630" fill="url(#thresh-grad-og-flood)"/>`,
    `<rect x="34" y="34" width="1132" height="562" rx="28" fill="#0B120E"/>`,
    `<g clip-path="url(#thresh-grad-og-clip)">`,
    `<g transform="translate(854, 44) scale(1.2)" opacity="0.14">`,
    `<path d="M 260 190 H 120 A 70 70 0 0 1 120 50 H 260" stroke="#C8FF00" stroke-width="8"/>`,
    `<path d="M 260 204 H 120 A 84 84 0 0 1 120 36 H 260" stroke="#399663" stroke-width="8"/>`,
    `<path d="M 260 218 H 120 A 98 98 0 0 1 120 22 H 260" stroke="#399663" stroke-width="8"/>`,
    `<path d="M 260 232 H 120 A 112 112 0 0 1 120 8 H 260" stroke="#399663" stroke-width="8"/>`,
    `</g>`,
    `</g>`,
    `<rect x="34" y="34" width="1132" height="562" rx="28" stroke="#2B543B" stroke-width="3"/>`,
    heroLockupInner,
    `<text x="92" y="462" fill="#F4F7F4" font-family="'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif" font-size="34" font-weight="700" letter-spacing="-0.8">Run &amp; Ride Readiness</text>`,
    `<text x="92" y="510" fill="#93A39A" font-family="'JetBrains Mono', ui-monospace, SFMono-Regular, monospace" font-size="18" font-weight="600" letter-spacing="1.4">THRESHOLD PHYSIOLOGY  ·  ADAPTIVE LOAD  ·  0.01S TRACKSIDE TIMING</text>`,
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
    id: 'thresh-lockup-dark',
    title: 'Primary Lockup — Dark Stage',
    subtitle: 'Track Volt (#C8FF00) + Pine (#399663) full horizontal lockup',
    category: 'LOCKUPS',
    width: 472,
    height: 124,
    viewBox: '0 0 472 124',
    svgPath: '/brand/thresh-lockup-dark.svg',
    staticPngPath: '/brand/thresh-lockup-dark-2x.png',
    pngSizes: [
      { key: '1x', label: '1x (472×124)', width: 472, height: 124 },
      { key: '2x', label: '2x (944×248)', width: 944, height: 248 },
      { key: '4x', label: '4x Print (1888×496)', width: 1888, height: 496 },
    ],
    recommendedFor: 'Obsidian-Pine surfaces, dark-mode broadcasts, night track tents',
    minPhysicalSpec: 'Min print 0.5 in (13 mm) tall · Min web 28 px tall',
    svgMarkup: buildMultiToneLockupSvg({
      gradId: 'thresh-grad-lockup-dark',
      pineColor: '#399663',
      accentColor: '#C8FF00',
      casingColor: '#101814',
      pinColor: '#0E1912',
      gradStops: [
        ['0%', '#F6FBF7'],
        ['38%', '#E8FFD1'],
        ['72%', '#D4FF38'],
        ['100%', '#C8FF00'],
      ],
    }),
  },
  {
    id: 'thresh-lockup-light',
    title: 'Primary Lockup — Light Stage',
    subtitle: 'Stadium Pine (#1C5436) + Turf Lime (#56BA00) light-ground lockup',
    category: 'LOCKUPS',
    width: 472,
    height: 124,
    viewBox: '0 0 472 124',
    svgPath: '/brand/thresh-lockup-light.svg',
    staticPngPath: '/brand/thresh-lockup-light-2x.png',
    pngSizes: [
      { key: '1x', label: '1x (472×124)', width: 472, height: 124 },
      { key: '2x', label: '2x (944×248)', width: 944, height: 248 },
      { key: '4x', label: '4x Print (1888×496)', width: 1888, height: 496 },
    ],
    recommendedFor: 'Chalk/white slides, CMYK meet programs, locker-room QR headers',
    minPhysicalSpec: 'Min print 0.5 in (13 mm) tall · CMYK-safe Pine/Lime inks',
    svgMarkup: buildMultiToneLockupSvg({
      gradId: 'thresh-grad-lockup-light',
      pineColor: '#1C5436',
      accentColor: '#56BA00',
      casingColor: '#FFFFFF',
      pinColor: '#FFFFFF',
      gradStops: [
        ['0%', '#0E2619'],
        ['38%', '#185230'],
        ['72%', '#2E801E'],
        ['100%', '#4BA800'],
      ],
    }),
  },
  {
    id: 'thresh-sticker-diecut',
    title: 'Die-Cut Badge Pill',
    subtitle: 'Self-cased #0B1911 container guaranteeing >15:1 contrast over any photo',
    category: 'LOCKUPS',
    width: 472,
    height: 124,
    viewBox: '0 0 472 124',
    svgPath: '/brand/thresh-sticker-diecut.svg',
    staticPngPath: '/brand/thresh-sticker-diecut-2x.png',
    pngSizes: [
      { key: '1x', label: '1x (472×124)', width: 472, height: 124 },
      { key: '2x', label: '2x (944×248)', width: 944, height: 248 },
      { key: '4x', label: '4x Print (1888×496)', width: 1888, height: 496 },
    ],
    recommendedFor: 'Sunlit concrete race photos, die-cut stickers, scoreboard bugs',
    minPhysicalSpec: 'Self-framed rx=24 pill · safe on busy backgrounds',
    svgMarkup: buildMultiToneLockupSvg({
      gradId: 'thresh-grad-sticker-diecut',
      pineColor: '#399663',
      accentColor: '#C8FF00',
      casingColor: '#0B1911',
      pinColor: '#0E1912',
      backgroundRect: { fill: '#0B1911', rx: 24 },
      gradStops: [
        ['0%', '#F6FBF7'],
        ['38%', '#E8FFD1'],
        ['72%', '#D4FF38'],
        ['100%', '#C8FF00'],
      ],
    }),
  },
  {
    id: 'thresh-1ink-stencil',
    title: '1-Ink Obsidian Stencil (Knockout)',
    subtitle: 'True boolean compound-path cutout — zero painted white strokes',
    category: 'STENCILS',
    width: 472,
    height: 124,
    viewBox: '0 0 472 124',
    svgPath: '/brand/thresh-1ink-stencil.svg',
    staticPngPath: '/brand/thresh-1ink-stencil-2x.png',
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
    id: 'thresh-1ink-stencil-white',
    title: '1-Ink Reversed White Stencil (Knockout)',
    subtitle: 'Pure #FFFFFF compound-path stencil for dark gear & night photography',
    category: 'STENCILS',
    width: 472,
    height: 124,
    viewBox: '0 0 472 124',
    svgPath: '/brand/thresh-1ink-stencil-white.svg',
    staticPngPath: '/brand/thresh-1ink-stencil-white-2x.png',
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
    id: 'thresh-1ink-stencil-volt',
    title: '1-Ink Track Volt Stencil (Knockout)',
    subtitle: 'Electric #C8FF00 single-ink cutout for dark Pine or Black banners',
    category: 'STENCILS',
    width: 472,
    height: 124,
    viewBox: '0 0 472 124',
    svgPath: '/brand/thresh-1ink-stencil-volt.svg',
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
    id: 'thresh-gauge-symbol-dark',
    title: 'Gauge Symbol — Transparent (Dark)',
    subtitle: 'Unframed 4-lane gauge mark for circular avatars & overlays',
    category: 'ICONS',
    width: 128,
    height: 128,
    viewBox: '0 0 128 128',
    svgPath: '/brand/thresh-gauge-symbol-dark.svg',
    pngSizes: [
      { key: '1x', label: '1x (256×256)', width: 256, height: 256 },
      { key: '2x', label: '2x (512×512)', width: 512, height: 512 },
      { key: '4x', label: '4x (1024×1024)', width: 1024, height: 1024 },
    ],
    recommendedFor: 'Dark circular club avatars, dark slides, badge stamps',
    minPhysicalSpec: 'Min print 0.35 in (9 mm) · Min UI 20 px',
    svgMarkup: buildGaugeIconSvg({
      pineColor: '#399663',
      accentColor: '#C8FF00',
      casingColor: '#0B120E',
      pinColor: '#0B120E',
    }),
  },
  {
    id: 'thresh-gauge-symbol-light',
    title: 'Gauge Symbol — Transparent (Light)',
    subtitle: 'Unframed Stadium Pine & Turf Lime mark for white/chalk surfaces',
    category: 'ICONS',
    width: 128,
    height: 128,
    viewBox: '0 0 128 128',
    svgPath: '/brand/thresh-gauge-symbol-light.svg',
    pngSizes: [
      { key: '1x', label: '1x (256×256)', width: 256, height: 256 },
      { key: '2x', label: '2x (512×512)', width: 512, height: 512 },
      { key: '4x', label: '4x (1024×1024)', width: 1024, height: 1024 },
    ],
    recommendedFor: 'Light circular avatars, clipboards, stationery corner marks',
    minPhysicalSpec: 'Min print 0.35 in (9 mm) · WCAG AA Pine/Lime',
    svgMarkup: buildGaugeIconSvg({
      pineColor: '#1C5436',
      accentColor: '#56BA00',
      casingColor: '#FFFFFF',
      pinColor: '#FFFFFF',
    }),
  },
  {
    id: 'thresh-gauge-symbol-1ink-black',
    title: 'Gauge Symbol — 1-Ink Black Knockout',
    subtitle: 'Unframed monochrome knockout symbol for embroidery & laser etch',
    category: 'ICONS',
    width: 128,
    height: 128,
    viewBox: '0 0 128 128',
    svgPath: '/brand/thresh-gauge-symbol-1ink-black.svg',
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
    id: 'thresh-gauge-symbol-1ink-white',
    title: 'Gauge Symbol — 1-Ink White Knockout',
    subtitle: 'Unframed reversed #FFFFFF knockout symbol for dark kits & bottles',
    category: 'ICONS',
    width: 128,
    height: 128,
    viewBox: '0 0 128 128',
    svgPath: '/brand/thresh-gauge-symbol-1ink-white.svg',
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
    id: 'thresh-icon-tile-dark',
    title: 'App Tile Icon — Obsidian Rounded',
    subtitle: 'Canonical rx=28 #0B1911 rounded-square tile with #399663 border',
    category: 'ICONS',
    width: 128,
    height: 128,
    viewBox: '0 0 128 128',
    svgPath: '/brand/thresh-icon-tile-dark.svg',
    pngSizes: [
      { key: '1x', label: '1x (256×256)', width: 256, height: 256 },
      { key: '2x', label: '2x (512×512)', width: 512, height: 512 },
      { key: '4x', label: '4x (1024×1024)', width: 1024, height: 1024 },
    ],
    recommendedFor: 'Favicon parity, PWA tiles, desktop launcher badges',
    minPhysicalSpec: 'Matches /icon.svg · self-contained Pine casing',
    svgMarkup: buildGaugeIconSvg({
      tile: { fill: '#0B1911', stroke: '#399663', rx: 28 },
      pineColor: '#399663',
      accentColor: '#C8FF00',
      casingColor: '#0B1911',
      pinColor: '#0B1911',
    }),
  },
  {
    id: 'thresh-icon-tile-light',
    title: 'App Tile Icon — Stadium Chalk Rounded',
    subtitle: 'Chalk #F4F7F2 rounded tile with #1C5436 architectural border',
    category: 'ICONS',
    width: 128,
    height: 128,
    viewBox: '0 0 128 128',
    svgPath: '/brand/thresh-icon-tile-light.svg',
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
      accentColor: '#56BA00',
      casingColor: '#F4F7F2',
      pinColor: '#F4F7F2',
    }),
  },
  {
    id: 'thresh-icon-square-fullbleed',
    title: 'Full-Bleed Square Icon (Partner Portals)',
    subtitle: 'Opaque edge-to-edge #0B1911 square for API portals & circular masks',
    category: 'ICONS',
    width: 128,
    height: 128,
    viewBox: '0 0 128 128',
    svgPath: '/brand/thresh-icon-square-fullbleed.svg',
    staticPngPath: '/brand/thresh-icon-square-512.png',
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
      casingColor: '#0B1911',
      pinColor: '#0B1911',
    }),
  },
  {
    id: 'thresh-wordmark-dark',
    title: 'Wordmark Only (W1) — Dark Stage',
    subtitle: 'Standalone -14° THRESH letterforms for strips under 22px height',
    category: 'WORDMARK_AND_SOCIAL',
    width: 328,
    height: 96,
    viewBox: '0 0 328 96',
    svgPath: '/brand/thresh-wordmark-dark.svg',
    pngSizes: [
      { key: '1x', label: '1x (328×96)', width: 328, height: 96 },
      { key: '2x', label: '2x (656×192)', width: 656, height: 192 },
      { key: '4x', label: '4x (1312×384)', width: 1312, height: 384 },
    ],
    recommendedFor: 'Compact dark partner footers & jersey collar tape (< 22px height)',
    minPhysicalSpec: 'Use only when gauge sectors drop below crisp legibility',
    svgMarkup: buildStandaloneWordmarkSvg({
      gradId: 'thresh-grad-wordmark-dark',
      gradStops: [
        ['0%', '#F6FBF7'],
        ['38%', '#E8FFD1'],
        ['72%', '#D4FF38'],
        ['100%', '#C8FF00'],
      ],
    }),
  },
  {
    id: 'thresh-wordmark-light',
    title: 'Wordmark Only (W1) — Light Stage',
    subtitle: 'Standalone -14° THRESH letterforms tuned for bright paper strips',
    category: 'WORDMARK_AND_SOCIAL',
    width: 328,
    height: 96,
    viewBox: '0 0 328 96',
    svgPath: '/brand/thresh-wordmark-light.svg',
    pngSizes: [
      { key: '1x', label: '1x (328×96)', width: 328, height: 96 },
      { key: '2x', label: '2x (656×192)', width: 656, height: 192 },
      { key: '4x', label: '4x (1312×384)', width: 1312, height: 384 },
    ],
    recommendedFor: 'Compact white header strips & dense meet timing tables',
    minPhysicalSpec: 'Deep Pine → Turf Lime W1 sweep on crisp chalk/white',
    svgMarkup: buildStandaloneWordmarkSvg({
      gradId: 'thresh-grad-wordmark-light',
      gradStops: [
        ['0%', '#0E2619'],
        ['38%', '#185230'],
        ['72%', '#2E801E'],
        ['100%', '#4BA800'],
      ],
    }),
  },
  {
    id: 'thresh-watermark-4lane',
    title: '4-Lane Banking Turn Watermark',
    subtitle: 'Signature architectural stadium-oval graphic motif (260×220)',
    category: 'WORDMARK_AND_SOCIAL',
    width: 260,
    height: 220,
    viewBox: '0 0 260 220',
    svgPath: '/brand/thresh-watermark-4lane.svg',
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
    id: 'thresh-og-1200x630',
    title: 'Social & OpenGraph Banner (1200×630)',
    subtitle: 'Official Stadium Track share card with locked Z1–Z6 spectrum bar',
    category: 'WORDMARK_AND_SOCIAL',
    width: 1200,
    height: 630,
    viewBox: '0 0 1200 630',
    svgPath: '/brand/thresh-og-1200x630.svg',
    staticPngPath: '/brand/thresh-og-1200x630.png',
    pngSizes: [
      { key: '1x', label: '1x (1200×630)', width: 1200, height: 630 },
      { key: '2x', label: '2x (2400×1260)', width: 2400, height: 1260 },
      { key: '4x', label: '4x (3600×1890)', width: 3600, height: 1890 },
    ],
    recommendedFor: 'OpenGraph link previews, press kits, coaching clinic title slides',
    minPhysicalSpec: '1.91:1 social aspect · powers thresh.app meta og:image',
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
  'thresh-lockup-dark',
  'thresh-1ink-stencil-white',
  'thresh-1ink-stencil-volt',
  'thresh-gauge-symbol-dark',
  'thresh-gauge-symbol-1ink-white',
  'thresh-wordmark-dark',
]);

const LIGHT_FIRST_IDS = new Set([
  'thresh-lockup-light',
  'thresh-1ink-stencil',
  'thresh-gauge-symbol-light',
  'thresh-gauge-symbol-1ink-black',
  'thresh-wordmark-light',
]);

const SELF_FRAMED_IDS = new Set([
  'thresh-sticker-diecut',
  'thresh-icon-tile-dark',
  'thresh-icon-tile-light',
  'thresh-icon-square-fullbleed',
  'thresh-og-1200x630',
]);

export function resolveEffectiveSurfaceForAsset(
  assetId: string,
  surface: BrandSurfaceId,
  isDarkTheme: boolean
): Exclude<BrandSurfaceId, 'auto'> {
  if (surface !== 'auto') return surface;
  if (DARK_FIRST_IDS.has(assetId)) return 'obsidian';
  if (LIGHT_FIRST_IDS.has(assetId)) return 'chalk';
  if (assetId === 'thresh-icon-tile-dark' || assetId === 'thresh-icon-square-fullbleed') {
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
    if (surface === 'obsidian' && (id === 'thresh-icon-tile-dark' || id === 'thresh-icon-square-fullbleed' || id === 'thresh-sticker-diecut')) {
      return {
        status: 'RECOMMENDED',
        badgeLabel: 'Recommended',
        rationale: 'Self-cased Pine border keeps sharp definition over Obsidian.',
      };
    }
    if (surface === 'bw-copier' && id !== 'thresh-icon-tile-light') {
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

  if (id === 'thresh-watermark-4lane') {
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
          id === 'thresh-1ink-stencil-white' || id === 'thresh-gauge-symbol-1ink-white'
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
      if (surface === 'volt' && id !== 'thresh-1ink-stencil' && id !== 'thresh-gauge-symbol-1ink-black') {
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
// Live Team × THRESH Co-Branding Lockup SVG Builder
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

  const gradId = `thresh-grad-cobrand-${opts.variant}`;

  let crestMarkup = '';
  let nameColor = monoInk;
  let crossColor = monoInk;
  let threshMarkup = '';

  if (isOneInk) {
    // True single-ink knockout crest (hollow rounded square via evenodd compound path is tricky for text;
    // render solid filled pill? Avoid text color flip: stroke box cleanly without filling background!)
    crestMarkup = [
      `<rect x="${crestX + 2}" y="26" width="${crestSize - 4}" height="${crestSize - 4}" rx="18" fill="none" stroke="${monoInk}" stroke-width="5"/>`,
      `<text x="${crestX + crestSize / 2}" y="71" text-anchor="middle" fill="${monoInk}" font-family="'Plus Jakarta Sans', -apple-system, sans-serif" font-size="26" font-weight="800" letter-spacing="-0.5">${cleanMono}</text>`,
    ].join('');
    threshMarkup = [
      `<g transform="translate(${lockupX}, 0)" fill="${monoInk}">`,
      LOCKUP_PINE_LANES.map((d) => `<path d="${d}"/>`).join(''),
      LOCKUP_KNOCKOUT_SECTORS.map((d) => `<path d="${d}"/>`).join(''),
      `<path d="${LOCKUP_KNOCKOUT_ARROW}"/>`,
      `<path d="${LOCKUP_KNOCKOUT_TICK}"/>`,
      `<path d="${LOCKUP_KNOCKOUT_HUB_NEEDLE}" fill-rule="evenodd" clip-rule="evenodd"/>`,
      renderW1WordmarkPaths(monoInk),
      `</g>`,
    ].join('');
  } else {
    const isDark = opts.variant === 'dark';
    const accent = isDark ? palette.primaryOnDark : palette.primaryOnLight;
    const secondary = isDark ? palette.secondaryOnDark : palette.secondaryOnLight;
    const onPrimary = isDark ? palette.textOnPrimaryDark : palette.textOnPrimaryLight;
    const slatePine = isDark ? '#64748B' : '#334155';
    const casing = isDark ? '#101B15' : '#FFFFFF';
    const pin = isDark ? '#0B120E' : '#FFFFFF';
    const wordmarkStart = isDark ? '#F6FBF7' : '#0E1912';
    nameColor = isDark ? '#F4F7F4' : '#101411';
    crossColor = isDark ? '#93A39A' : '#43584B';

    crestMarkup = [
      `<defs><linearGradient id="${gradId}-crest" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${accent}"/><stop offset="100%" stop-color="${secondary}"/></linearGradient></defs>`,
      `<rect x="${crestX}" y="24" width="${crestSize}" height="${crestSize}" rx="18" fill="url(#${gradId}-crest)" stroke="rgba(255,255,255,0.22)" stroke-width="2"/>`,
      `<text x="${crestX + crestSize / 2}" y="70" text-anchor="middle" fill="${onPrimary}" font-family="'Plus Jakarta Sans', -apple-system, sans-serif" font-size="27" font-weight="800" letter-spacing="-0.5">${cleanMono}</text>`,
    ].join('');

    threshMarkup = [
      `<g transform="translate(${lockupX}, 0)">`,
      `<defs><linearGradient id="${gradId}-word" gradientUnits="userSpaceOnUse" x1="-6" y1="0" x2="268" y2="0"><stop offset="0%" stop-color="${wordmarkStart}"/><stop offset="52%" stop-color="${wordmarkStart}"/><stop offset="100%" stop-color="${accent}"/></linearGradient></defs>`,
      `<g fill="${slatePine}">${LOCKUP_PINE_LANES.map((d) => `<path d="${d}"/>`).join('')}</g>`,
      `<g fill="${accent}">${LOCKUP_INNER_SECTORS.map((d) => `<path d="${d}"/>`).join('')}<path d="${LOCKUP_ARROW_FULL}"/></g>`,
      `<line x1="${TICK_X1}" y1="${TICK_Y1}" x2="${TICK_X2}" y2="${TICK_Y2}" stroke="${accent}" stroke-width="3.2" stroke-linecap="round"/>`,
      `<path d="${LOCKUP_NEEDLE_TRIANGLE}" fill="${accent}" stroke="${casing}" stroke-width="6" stroke-linejoin="round" style="paint-order:stroke fill"/>`,
      `<circle cx="${LOCKUP_CX}" cy="${LOCKUP_CY}" r="9.8" fill="${accent}" stroke="${casing}" stroke-width="3.8" style="paint-order:stroke fill"/>`,
      `<circle cx="${LOCKUP_CX}" cy="${LOCKUP_CY}" r="3.6" fill="${pin}"/>`,
      renderW1WordmarkPaths(`url(#${gradId}-word)`),
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
      name: 'THRESH',
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

export const BRAND_KIT_README_MD = `# THRESH Official Brand Kit & Permissions

- **Canonical Name:** THRESH (always ALL-CAPS in running copy; retire legacy AeroPulse naming in public materials).
- **Canonical Tagline:** THRESH — Run & Ride Readiness.
- **Included Vectors (\`/svg/\`):** Primary Light/Dark lockups, Die-Cut Badge Pill, True Compound-Path 1-Ink Stencils (Obsidian Black, Reversed White, Track Volt), Unframed & Tiled Gauge Icons, W1 Wordmarks, 4-Lane Turn Watermark, and 1200x630 OpenGraph Card.
- **Usage & Print Policy:**
  - **Permitted:** Unmodified editorial coverage, podcasts, race meet heat sheets & programs, API partner directories, and active team tent banners, warm-ups, & roster posters using \`Team × THRESH\` co-branding (following NFHS/NCAA competition uniform area limits <= 2.25 sq in on race singlets without implied institutional sponsorship).
  - **Prohibited:** Commercial merchandise resale, altering Z1–Z6 / Banister CTL-ATL-TSB physiological colors, placing raw #C8FF00 text on white paper, or fusing third-party hardware/platform logos into a combined THRESH mark.
`;

export async function buildBrandKitZipUint8Array(
  extraPngEntries: Record<string, Uint8Array> = {}
): Promise<Uint8Array> {
  const { zipSync, strToU8 } = await import('fflate');
  const files: Record<string, Uint8Array> = {
    'BRAND_USAGE_AND_PERMISSIONS.md': strToU8(BRAND_KIT_README_MD),
    'tokens/thresh-design-tokens.json': strToU8(buildDesignTokensExportJson()),
  };

  for (const asset of BRAND_ASSET_CATALOG) {
    files[`svg/${asset.id}.svg`] = strToU8(asset.svgMarkup);
  }

  for (const [entryName, bytes] of Object.entries(extraPngEntries)) {
    files[`png/${entryName}`] = bytes;
  }

  return zipSync(files, { level: 6 });
}
