/**
 * Canonical THRESH Brand Vectors — S2 "TL-2P1 Parallel-Breach Twin-Lane" Symbol × W-A "Threshold Horizon" Wordmark
 * + Dedicated 32×32 "FAV-F" High-Vis Volt Shield Favicon Monogram.
 * Pure TypeScript constants (zero React / DOM dependencies) shared across React components,
 * Brand Asset Studio SVG/PNG exporters, QR join posters, and dynamic team favicons.
 */

// TL-2P1 Outer Pine Arc (R=31..45) + Inner Pine Inside-Lane Rail (R=22.2..25.0), collinear 315° parallel breach (d = -9.8px)
export const S2_PINE_ARC_PATH =
  'M 28.18 101.82 A 45 45 0 0 1 84.13 31.99 L 73.87 42.27 A 31 31 0 0 0 38.08 91.92 Z M 42.32 87.68 A 25 25 0 0 1 69.33 46.81 L 67.16 48.98 A 22.2 22.2 0 0 0 44.30 85.70 Z';

// TL-2P1 Outer Volt Arc (R=31..45) + Inner Volt Passing-Lane Rail (R=22.2..25.0), collinear 315° parallel breach (d = +9.8px)
export const S2_VOLT_ARC_PATH =
  'M 97.99 45.87 A 45 45 0 0 1 91.82 101.82 L 81.92 91.92 A 31 31 0 0 0 87.73 56.13 Z M 83.19 60.67 A 25 25 0 0 1 77.68 87.68 L 75.70 85.70 A 22.2 22.2 0 0 0 81.02 62.84 Z';

// Unified Hub (60,70 r=10) + true evenodd center pinhole (r=3.8) + +2.5px forward-reaching 315° Arrow-Needle
export const S2_ARROW_NEEDLE_PATH =
  'M 63.13 60.50 L 92.53 31.11 L 84.40 26.51 L 108.44 21.56 L 103.49 45.60 L 98.89 37.47 L 69.50 66.87 A 10 10 0 1 1 63.13 60.50 Z M 63.80 70.00 A 3.8 3.8 0 1 0 56.20 70.00 A 3.8 3.8 0 1 0 63.80 70.00 Z';

// Dedicated 32×32 FAV-F Threshold-Split Sheared "T" Silhouette (engineered for 16px browser tab legibility)
export const FAV_F_SHIELD_T_PATH =
  'M 6.5 6.5 H 26.8 L 25.3 12 H 5 Z M 13.4 14.5 H 19.6 L 17.8 25.5 H 11.6 Z';

export const WA_WORDMARK_INK_PATHS: Array<{ d: string; evenOdd?: boolean }> = [
  { d: 'M 0 0 H 49.4 L 46.6 11.2 H 30.75 V 64 H 17.25 V 11.2 H 0 Z' },
  { d: 'M 56 0 H 69.5 V 26.4 H 95.5 V 0 H 109 V 64 H 95.5 V 37.6 H 69.5 V 64 H 56 Z' },
  {
    d: 'M 121 0 H 155.8 A 19.2 19.2 0 0 1 155.8 38.4 H 134.5 V 64 H 121 Z M 134.5 11.2 V 27.2 H 155.0 A 8 8 0 0 0 155.0 11.2 Z',
    evenOdd: true,
  },
  { d: 'M 149.5 41.6 H 163.7 L 176.2 64 H 161.6 Z' },
  { d: 'M 186 0 H 236 V 11.2 H 199.5 V 52.8 H 236 V 64 H 186 Z' },
  {
    d: 'M 296.4 0 L 293.6 11.2 H 264.8 A 7.6 7.6 0 0 0 264.8 26.4 H 280.6 A 18.8 18.8 0 0 1 280.6 64 H 247.6 L 250.4 52.8 H 279.2 A 7.6 7.6 0 0 0 279.2 37.6 H 263.4 A 18.8 18.8 0 0 1 263.4 0 Z',
  },
  { d: 'M 310 0 H 323.5 V 26.4 H 349.5 V 0 H 363 V 64 H 349.5 V 37.6 H 323.5 V 64 H 310 Z' },
];

export const WA_THRESHOLD_BAR_PATH = 'M 205 26.4 H 236.4 L 233.6 37.6 H 205 Z';

export function buildS2SymbolInnerSvg(
  pineColor: string,
  accentColor: string,
  transform = 'translate(6, -5.5) scale(0.98)'
): string {
  return [
    `<g transform="${transform}">`,
    `<path d="${S2_PINE_ARC_PATH}" fill="${pineColor}"/>`,
    `<path d="${S2_VOLT_ARC_PATH}" fill="${accentColor}"/>`,
    `<path d="${S2_ARROW_NEEDLE_PATH}" fill="${accentColor}" fill-rule="evenodd" clip-rule="evenodd"/>`,
    `</g>`,
  ].join('');
}

export function buildWAWordmarkInnerSvg(
  inkColor: string,
  accentColor: string,
  transform = 'translate(134, 34) scale(0.89)'
): string {
  const letterEls = WA_WORDMARK_INK_PATHS.map((item) =>
    item.evenOdd
      ? `<path d="${item.d}" fill-rule="evenodd" clip-rule="evenodd"/>`
      : `<path d="${item.d}"/>`
  ).join('');
  return [
    `<g transform="${transform}">`,
    `<g fill="${inkColor}">${letterEls}</g>`,
    `<path d="${WA_THRESHOLD_BAR_PATH}" fill="${accentColor}"/>`,
    `</g>`,
  ].join('');
}
