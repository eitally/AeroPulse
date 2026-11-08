/**
 * AeroPulse "Editorial Endurance Lab" Design System Tokens for JS/Canvas/SVG Charts
 * Provides synchronized Light Mode (Warm Stone / Archival Paper) and Dark Mode (Deep Obsidian)
 * color palettes for Apache ECharts, uPlot HTML5 Canvas, and custom SVG charts.
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

export function getAeroPulseThemePalette(isDark: boolean): AeroPulseThemePalette {
  return {
    isDark,
    canvasBg: isDark ? '#0B0C0F' : '#F6F4EF',
    cardBg: isDark ? '#15171E' : '#FFFEFB',
    insetBg: isDark ? '#101218' : '#F7F4EE',
    borderSubtle: isDark ? 'rgba(255, 255, 255, 0.09)' : 'rgba(214, 211, 204, 0.88)',
    textPrimary: isDark ? '#F8FAFC' : '#0F172A',
    textSecondary: isDark ? '#CBD5E1' : '#334155',
    textMuted: isDark ? '#94A3B8' : '#64748B',
    axisLine: isDark ? '#334155' : '#CBD5E1',
    splitLine: isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(15, 23, 42, 0.07)',
    tooltipBg: isDark ? 'rgba(15, 17, 23, 0.95)' : 'rgba(255, 254, 251, 0.96)',
    tooltipBorder: isDark ? '#334155' : '#D6D3CC',
    tooltipText: isDark ? '#F8FAFC' : '#0F172A',
    brandCobalt: '#2563EB',
    brandSignalOrange: '#EA580C',
    ctlCyan: '#38BDF8',
    atlRose: '#F43F5E',
    tsbOptimalEmerald: '#10B981',
    tsbFreshSky: '#38BDF8',
    tsbGreyAmber: '#F59E0B',
    tsbOverreachRed: '#EF4444',
    loadFocus: {
      lowAerobic: '#38BDF8',
      highAerobic: '#F97316',
      anaerobic: '#D946EF',
    },
    zones: [
      '#10B981', // Z1 Recovery
      '#38BDF8', // Z2 Aerobic Endurance
      '#EAB308', // Z3 Tempo / Sweet Spot
      '#F97316', // Z4 Lactate Threshold
      '#EF4444', // Z5 VO2max
      '#D946EF', // Z6 Anaerobic Capacity
    ],
  };
}
