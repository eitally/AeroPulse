/**
 * THRESH "Precision Editorial" v2.0 Design System Tokens for JS/Canvas/SVG Charts
 * Synchronizes Warm Alabaster (#F7F6F2) Light Mode and Matte Carbon (#121419) Dark Mode
 * with the locked 6-zone physiological effort spectrum and WCAG-accessible chart accents.
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
    canvasBg: isDark ? '#0A0B0D' : '#F7F6F2',
    cardBg: isDark ? '#121419' : '#FFFFFF',
    insetBg: isDark ? '#181B22' : '#F1F0EC',
    borderSubtle: isDark ? 'rgba(255, 255, 255, 0.085)' : 'rgba(17, 19, 24, 0.08)',
    textPrimary: isDark ? '#F4F5F7' : '#111318',
    textSecondary: isDark ? '#CBD5E1' : '#334155',
    textMuted: isDark ? '#94A3B8' : '#525866',
    axisLine: isDark ? '#334155' : '#CBD5E1',
    splitLine: isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(17, 19, 24, 0.06)',
    tooltipBg: isDark ? 'rgba(18, 20, 25, 0.96)' : 'rgba(255, 255, 255, 0.98)',
    tooltipBorder: isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(17, 19, 24, 0.12)',
    tooltipText: isDark ? '#F4F5F7' : '#111318',
    brandCobalt: isDark ? '#60A5FA' : '#1D4ED8',
    brandSignalOrange: isDark ? '#FB6514' : '#D9480F',
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
