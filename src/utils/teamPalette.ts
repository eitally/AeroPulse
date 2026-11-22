export interface AccessibleTeamPalette {
  primaryHex: string;
  secondaryHex: string;
  primaryOnLight: string; // >= 4.5:1 against #FFFFFF & #F4F7F2
  primaryOnDark: string; // >= 4.5:1 against #15231B, #101B15 & #0B120E
  secondaryOnLight: string;
  secondaryOnDark: string;
  textOnPrimaryLight: '#FFFFFF' | '#080A09' | '#111318';
  textOnPrimaryDark: '#FFFFFF' | '#080A09';
  hairlineGradientLight: string;
  hairlineGradientDark: string;
}

export function escapeTextForSafeAttr(input: unknown): string {
  return String(input ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function normalizeHexColor(input: string, fallback = '#1C5436'): string {
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
  const hn = (((h % 360) + 360) % 360) / 360;
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
  return darken ? '#14532D' : '#A3E635';
}

function selectButtonInk(bgHex: string): '#FFFFFF' | '#080A09' {
  const whiteCr = contrastRatio(bgHex, '#FFFFFF');
  const darkCr = contrastRatio(bgHex, '#080A09');
  return darkCr >= whiteCr ? '#080A09' : '#FFFFFF';
}

/**
 * Generates WCAG 2.1 AA contrast-verified light & dark chrome variants for any
 * school or club color pair while keeping MeetReady's physiological zone colors untouched.
 */
export function computeAccessibleTeamPalette(
  rawPrimaryHex: string,
  rawSecondaryHex: string
): AccessibleTeamPalette {
  const primaryHex = normalizeHexColor(rawPrimaryHex, '#1C5436');
  const secondaryHex = normalizeHexColor(rawSecondaryHex, '#65A30D');

  let primaryOnLight = ensureContrastAgainstSurface(primaryHex, '#E9EFE9', 4.6);
  primaryOnLight = ensureContrastAgainstSurface(primaryOnLight, '#FFFFFF', 4.65);

  const primaryOnDark = ensureContrastAgainstSurface(primaryHex, '#15231B', 4.65);

  let secondaryOnLight = ensureContrastAgainstSurface(secondaryHex, '#E9EFE9', 4.55);
  secondaryOnLight = ensureContrastAgainstSurface(secondaryOnLight, '#FFFFFF', 4.6);

  const secondaryOnDark = ensureContrastAgainstSurface(secondaryHex, '#15231B', 4.6);

  const textOnPrimaryLight = selectButtonInk(primaryOnLight);
  const textOnPrimaryDark = selectButtonInk(primaryOnDark);

  return {
    primaryHex,
    secondaryHex,
    primaryOnLight,
    primaryOnDark,
    secondaryOnLight,
    secondaryOnDark,
    textOnPrimaryLight,
    textOnPrimaryDark,
    hairlineGradientLight: `linear-gradient(90deg, ${primaryOnLight} 0%, ${secondaryOnLight} 100%)`,
    hairlineGradientDark: `linear-gradient(90deg, ${primaryOnDark} 0%, ${secondaryOnDark} 100%)`,
  };
}
