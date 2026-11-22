/**
 * MeetReady "Mondo Clay & Stadium Chalk + Sundown Midnight Slate" v4.0 Design System Tokens
 * Synchronized 1:1 with `src/index.css`:
 * - Daylight: Stadium Chalk (#F6F3EC) Canvas, Matte White (#FFFFFF) Cards, Warm Stone (#EDE9DF) Inset
 * - Track Asphalt (Dark): #121413 Canvas, #1A1D1B Cards, #151816 Inset, #F6F3EC Chalk Ink, #D8FF2A Volt
 * - Sundown P2 Midnight Slate (Dark): #0E1318 Canvas, #151C24 Cards, #0A0D12 Inset, #EEF2F6 Ink, #D8FF2A Volt
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
    canvasBg: isMidnight ? '#0E1318' : darkEffective ? '#121413' : '#F6F3EC',
    cardBg: isMidnight ? '#151C24' : darkEffective ? '#1A1D1B' : '#FFFFFF',
    insetBg: isMidnight ? '#0A0D12' : darkEffective ? '#151816' : '#EDE9DF',
    borderSubtle: isMidnight
      ? 'rgba(148, 163, 184, 0.22)'
      : darkEffective
        ? 'rgba(246, 243, 236, 0.14)'
        : 'rgba(18, 20, 19, 0.16)',
    textPrimary: isMidnight ? '#EEF2F6' : darkEffective ? '#F6F3EC' : '#121413',
    textSecondary: isMidnight ? '#CBD5E1' : darkEffective ? '#D6D1C7' : '#2C2A26',
    textMuted: darkEffective ? '#A39E93' : '#57544D',
    axisLine: isMidnight ? '#2A3644' : darkEffective ? '#2C312E' : '#CFC9BC',
    splitLine: isMidnight
      ? 'rgba(148, 163, 184, 0.12)'
      : darkEffective
        ? 'rgba(246, 243, 236, 0.1)'
        : 'rgba(18, 20, 19, 0.08)',
    tooltipBg: isMidnight
      ? 'rgba(21, 28, 36, 0.96)'
      : darkEffective
        ? 'rgba(26, 29, 27, 0.96)'
        : 'rgba(255, 255, 255, 0.98)',
    tooltipBorder: isMidnight
      ? 'rgba(148, 163, 184, 0.28)'
      : darkEffective
        ? 'rgba(246, 243, 236, 0.2)'
        : 'rgba(18, 20, 19, 0.18)',
    tooltipText: isMidnight ? '#EEF2F6' : darkEffective ? '#F6F3EC' : '#121413',
    brandCobalt: isMidnight ? '#D8FF2A' : darkEffective ? '#D8FF2A' : '#B83A24',
    brandSignalOrange: isMidnight ? '#D8FF2A' : darkEffective ? '#D8FF2A' : '#1E4D36',
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
