/**
 * Canonical THRESH Brand Vectors — S2 "Redline Breach" Symbol × W-A "Threshold Horizon" Wordmark
 * Pure TypeScript constants (zero React / DOM dependencies) shared across React components,
 * Brand Asset Studio SVG/PNG exporters, QR join posters, and dynamic team favicons.
 */

export const S2_PINE_ARC_PATH =
  'M 28.18 101.82 A 45 45 0 0 1 83.18 31.43 L 75.97 43.43 A 31 31 0 0 0 38.08 91.92 Z';

export const S2_VOLT_ARC_PATH =
  'M 98.57 46.82 A 45 45 0 0 1 91.82 101.82 L 81.92 91.92 A 31 31 0 0 0 86.57 54.03 Z';

// Unified Hub + Piercing 315° Arrow-Needle with true evenodd center pinhole (cx=60, cy=70, r=3.8)
export const S2_ARROW_NEEDLE_PATH =
  'M 63.13 60.5 L 90.76 32.88 L 82.63 28.28 L 106.67 23.33 L 101.72 47.37 L 97.12 39.24 L 69.5 66.87 A 10 10 0 1 1 63.13 60.5 Z M 63.8 70 A 3.8 3.8 0 1 0 56.2 70 A 3.8 3.8 0 1 0 63.8 70 Z';

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
