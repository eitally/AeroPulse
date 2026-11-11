/**
 * THRESH "Track Volt & Obsidian" v3.0 Design System Tokens for JS/Canvas/SVG Charts
 * Synchronizes Stadium Chalk (#F4F5F0) Light Mode and Carbon-Pine (#121715) Dark Mode
 * with Track Volt (#C8FF00 / #558B00) brand chrome and the locked 6-zone effort spectrum.
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
    canvasBg: isDark ? '#080A09' : '#F4F5F0',
    cardBg: isDark ? '#121715' : '#FFFFFF',
    insetBg: isDark ? '#171E1B' : '#ECEEE6',
    borderSubtle: isDark ? 'rgba(200, 255, 0, 0.12)' : 'rgba(16, 20, 17, 0.09)',
    textPrimary: isDark ? '#F4F7F4' : '#101411',
    textSecondary: isDark ? '#D1D8D3' : '#334155',
    textMuted: isDark ? '#94A39B' : '#525866',
    axisLine: isDark ? '#2A3630' : '#CBD5E1',
    splitLine: isDark ? 'rgba(200, 255, 0, 0.08)' : 'rgba(16, 20, 17, 0.06)',
    tooltipBg: isDark ? 'rgba(14, 18, 16, 0.96)' : 'rgba(255, 255, 255, 0.98)',
    tooltipBorder: isDark ? 'rgba(200, 255, 0, 0.18)' : 'rgba(16, 20, 17, 0.12)',
    tooltipText: isDark ? '#F4F7F4' : '#101411',
    brandCobalt: isDark ? '#C8FF00' : '#3F6212',
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
