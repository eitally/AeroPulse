/**
 * MeetReady "#1 Stadium Track — Track Volt & Obsidian + Sundown P2 Midnight Slate" v3.1 Design System Tokens
 * Synchronized 1:1 with `src/index.css`:
 * - Daylight: Stadium Chalk (#F4F7F2) Canvas, Crisp Paper (#FFFFFF) Cards, Chalk Inset (#E9EFE9)
 * - Track Pine (Dark): Obsidian-Pine (#0B110E) Canvas, Carbon-Pine (#111A15) Cards, Deep Turf Inset (#080D0A)
 * - Sundown P2 Midnight Slate (Dark): #0E1318 Canvas, #151C24 Cards, #0A0D12 Inset, #EEF2F6 Ink, #D4FF33 Volt
 * - Locked 6-Zone Physiological Effort Spectrum & Banister PMC Encodings
 */

export type ThemePaletteVariant = 'DAYLIGHT' | 'TRACK_PINE' | 'MIDNIGHT_SLATE';

export interface AeroPulseThemePalette {
  isDark: boolean;
  variant: ThemePaletteVariant;
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

function resolvePaletteVariant(
  isDark: boolean,
  variant?: ThemePaletteVariant
): ThemePaletteVariant {
  if (variant) return variant;
  if (!isDark) return 'DAYLIGHT';
  if (
    typeof document !== 'undefined' &&
    document.documentElement?.classList?.contains('ap-midnight-slate')
  ) {
    return 'MIDNIGHT_SLATE';
  }
  return 'TRACK_PINE';
}

export function getAeroPulseThemePalette(
  isDark: boolean,
  variant?: ThemePaletteVariant
): AeroPulseThemePalette {
  const activeVariant = resolvePaletteVariant(isDark, variant);
  const isMidnight = activeVariant === 'MIDNIGHT_SLATE';
  const darkEffective = isDark || isMidnight;

  return {
    isDark: darkEffective,
    variant: activeVariant,
    canvasBg: isMidnight ? '#0E1318' : darkEffective ? '#0B110E' : '#F4F7F2',
    cardBg: isMidnight ? '#151C24' : darkEffective ? '#111A15' : '#FFFFFF',
    insetBg: isMidnight ? '#0A0D12' : darkEffective ? '#080D0A' : '#E9EFE9',
    borderSubtle: isMidnight
      ? 'rgba(148, 163, 184, 0.22)'
      : darkEffective
        ? 'rgba(57, 150, 99, 0.36)'
        : 'rgba(38, 88, 58, 0.19)',
    textPrimary: isMidnight ? '#EEF2F6' : darkEffective ? '#E6ECE8' : '#101411',
    textSecondary: isMidnight ? '#CBD5E1' : darkEffective ? '#C8D8CE' : '#1F3528',
    textMuted: darkEffective ? '#93A39A' : '#43584B',
    axisLine: isMidnight ? '#2A3644' : darkEffective ? '#254331' : '#B7C9BC',
    splitLine: isMidnight
      ? 'rgba(148, 163, 184, 0.12)'
      : darkEffective
        ? 'rgba(57, 150, 99, 0.14)'
        : 'rgba(38, 88, 58, 0.08)',
    tooltipBg: isMidnight
      ? 'rgba(21, 28, 36, 0.96)'
      : darkEffective
        ? 'rgba(17, 26, 21, 0.96)'
        : 'rgba(255, 255, 255, 0.98)',
    tooltipBorder: isMidnight
      ? 'rgba(148, 163, 184, 0.28)'
      : darkEffective
        ? 'rgba(57, 150, 99, 0.38)'
        : 'rgba(38, 88, 58, 0.22)',
    tooltipText: isMidnight ? '#EEF2F6' : darkEffective ? '#E6ECE8' : '#101411',
    brandCobalt: isMidnight ? '#D4FF33' : darkEffective ? '#C8FF00' : '#1C5436',
    brandSignalOrange: isMidnight ? '#D4FF33' : darkEffective ? '#C8FF00' : '#558B00',
    ctlCyan: darkEffective ? '#2DD4BF' : '#0D9488',
    atlRose: darkEffective ? '#FB7185' : '#E11D48',
    tsbOptimalEmerald: darkEffective ? '#34D399' : '#059669',
    tsbFreshSky: darkEffective ? '#38BDF8' : '#0284C7',
    tsbGreyAmber: darkEffective ? '#FBBF24' : '#D97706',
    tsbOverreachRed: darkEffective ? '#F87171' : '#DC2626',
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
      '#EA580C', // Z4 Threshold Vermilion (Lactate Threshold)
      '#DC2626', // Z5 Crimson (VO2max)
      '#7C3AED', // Z6 Deep Violet (Anaerobic)
    ],
  };
}

export const getThreshThemePalette = getAeroPulseThemePalette;
