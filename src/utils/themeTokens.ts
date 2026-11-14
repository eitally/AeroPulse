/**
 * THRESH "#1 Stadium Track — Track Volt & Obsidian" v3.0 Design System Tokens for JS/Canvas/SVG Charts
 * Synchronized 1:1 with `src/index.css`:
 * - Light Mode: Stadium Chalk (#F4F7F2) Canvas, Crisp Paper (#FFFFFF) Cards, Chalk Inset (#E9EFE9)
 * - Dark Mode: Obsidian-Pine (#0B120E) Canvas, Carbon-Pine (#101B15) Cards, Deep Turf Inset (#15231B)
 * - Signature Brand Chrome: Track Volt (#C8FF00 Dark / #1C5436 & #558B00 Light)
 * - Locked 6-Zone Physiological Effort Spectrum & Banister PMC Encodings
 */

export interface AeroPulseThemePalette {
  isDark: boolean;
  canvasBg: string;
  cardBg: string;
  insetBg: string;
  borderSubtle: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  axisLine: string;
  splitLine: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  brandCobalt: string;
  brandSignalOrange: string;
  ctlCyan: string;
  atlRose: string;
  tsbOptimalEmerald: string;
  tsbFreshSky: string;
  tsbGreyAmber: string;
  tsbOverreachRed: string;
  loadFocus: {
    lowAerobic: string;
    highAerobic: string;
    anaerobic: string;
  };
  zones: [string, string, string, string, string, string];
}

export type ThreshThemePalette = AeroPulseThemePalette;

export function getAeroPulseThemePalette(isDark: boolean): AeroPulseThemePalette {
  return {
    isDark,
    canvasBg: isDark ? '#0B120E' : '#F4F7F2',
    cardBg: isDark ? '#101B15' : '#FFFFFF',
    insetBg: isDark ? '#15231B' : '#E9EFE9',
    borderSubtle: isDark ? 'rgba(57, 150, 99, 0.36)' : 'rgba(38, 88, 58, 0.19)',
    textPrimary: isDark ? '#F4F7F4' : '#101411',
    textSecondary: isDark ? '#C8D8CE' : '#1F3528',
    textMuted: isDark ? '#93A39A' : '#43584B',
    axisLine: isDark ? '#254331' : '#B7C9BC',
    splitLine: isDark ? 'rgba(57, 150, 99, 0.14)' : 'rgba(38, 88, 58, 0.08)',
    tooltipBg: isDark ? 'rgba(16, 27, 21, 0.96)' : 'rgba(255, 255, 255, 0.98)',
    tooltipBorder: isDark ? 'rgba(57, 150, 99, 0.38)' : 'rgba(38, 88, 58, 0.22)',
    tooltipText: isDark ? '#F4F7F4' : '#101411',
    brandCobalt: isDark ? '#C8FF00' : '#1C5436',
    brandSignalOrange: isDark ? '#C8FF00' : '#558B00',
    ctlCyan: isDark ? '#2DD4BF' : '#0D9488',
    atlRose: isDark ? '#FB7185' : '#E11D48',
    tsbOptimalEmerald: isDark ? '#34D399' : '#059669',
    tsbFreshSky: isDark ? '#38BDF8' : '#0284C7',
    tsbGreyAmber: isDark ? '#FBBF24' : '#D97706',
    tsbOverreachRed: isDark ? '#F87171' : '#DC2626',
    loadFocus: {
      lowAerobic: '#0D9488',
      highAerobic: '#EA580C',
      anaerobic: '#7C3AED',
    },
    // Canonical 6-Zone Physiological Effort Spectrum
    zones: [
      '#94A3B8', // Z1 Cool Mist (Recovery)
      '#0D9488', // Z2 Aerobic Teal (Endurance)
      '#D97706', // Z3 Ochre (Tempo / Sweet Spot)
      '#EA580C', // Z4 Thresh Vermilion (Lactate Threshold)
      '#DC2626', // Z5 Crimson (VO2max)
      '#7C3AED', // Z6 Deep Violet (Anaerobic)
    ],
  };
}

export const getThreshThemePalette = getAeroPulseThemePalette;
