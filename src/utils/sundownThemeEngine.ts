import { useCallback, useEffect, useState } from 'react';

export type DaytimePalette = 'DAYLIGHT' | 'TRACK_PINE';
export type SundownPolicy =
  | 'AUTO_MIDNIGHT_SLATE'
  | 'DAYTIME_ONLY'
  | 'ALWAYS_MIDNIGHT_SLATE';
export type EffectiveThemeVariant = 'DAYLIGHT' | 'TRACK_PINE' | 'MIDNIGHT_SLATE';

export interface LocalSundownWindow {
  sunriseMinutes: number;
  sunsetMinutes: number;
  sunriseLabel12h: string;
  sunsetLabel12h: string;
  currentMinutes: number;
  isAfterSundown: boolean;
}

const STORAGE_DAYTIME_KEY = 'thresh_daytime_palette';
const STORAGE_POLICY_KEY = 'thresh_sundown_policy';
const STORAGE_LEGACY_DARK_KEY = 'thresh_theme_dark';

export function formatMinutesTo12h(totalMins: number): string {
  const norm = ((Math.round(totalMins) % 1440) + 1440) % 1440;
  const h24 = Math.floor(norm / 60);
  const m = norm % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Estimates local hemisphere latitude from IANA timezone without requesting geolocation permissions.
 */
export function inferLatitudeFromTimezone(timeZone?: string): number {
  const tz =
    timeZone ||
    (typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || ''
      : '');
  if (
    /^Australia\/|^Pacific\/Auckland|^America\/Argentina|^America\/Santiago|^Africa\/Johannesburg/i.test(
      tz
    )
  ) {
    return -34;
  }
  if (/^Asia\/Singapore|^Asia\/Bangkok|^Pacific\/Honolulu|^Africa\/Nairobi/i.test(tz)) {
    return 15;
  }
  if (/^Europe\/London|^Europe\/Berlin|^Europe\/Paris|^America\/Edmonton|^America\/Vancouver/i.test(tz)) {
    return 49;
  }
  return 39;
}

/**
 * Computes seasonal local sunrise & sunset minutes from date and latitude using
 * standard solar declination math (zero permissions, zero network calls).
 */
export function computeLocalSundownWindow(
  now: Date = new Date(),
  latitudeDeg?: number
): LocalSundownWindow {
  const latDeg =
    typeof latitudeDeg === 'number' && Number.isFinite(latitudeDeg)
      ? Math.max(-60, Math.min(60, latitudeDeg))
      : inferLatitudeFromTimezone();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const dayOfYear = Math.max(
    1,
    Math.min(
      366,
      Math.floor((now.getTime() - startOfYear.getTime()) / 86_400_000) + 1
    )
  );
  const declRad =
    ((23.44 * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81))) * Math.PI) /
    180;
  const latRad = (latDeg * Math.PI) / 180;
  const cosH = Math.max(
    -0.85,
    Math.min(0.85, -Math.tan(latRad) * Math.tan(declRad))
  );
  const halfDayMinutes = ((Math.acos(cosH) * 180) / Math.PI) * 4;
  const solarNoonMinutes = 12 * 60 + 8;
  const sunriseMinutes = Math.round(
    Math.max(300, Math.min(510, solarNoonMinutes - halfDayMinutes))
  );
  const sunsetMinutes = Math.round(
    Math.max(990, Math.min(1260, solarNoonMinutes + halfDayMinutes))
  );
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const isAfterSundown =
    currentMinutes >= sunsetMinutes || currentMinutes < sunriseMinutes;

  return {
    sunriseMinutes,
    sunsetMinutes,
    sunriseLabel12h: formatMinutesTo12h(sunriseMinutes),
    sunsetLabel12h: formatMinutesTo12h(sunsetMinutes),
    currentMinutes,
    isAfterSundown,
  };
}

export function resolveEffectiveThemeState(params: {
  daytimePalette: DaytimePalette;
  sundownPolicy: SundownPolicy;
  isAfterSundown: boolean;
  sessionLightOverride?: boolean;
  isCleanEphemeralDemoBoot?: boolean;
  isBrandStudioRoute?: boolean;
  isDemoSession?: boolean;
  explicitLegacyDark?: '0' | '1' | null;
  hasExplicitPolicy?: boolean;
  hasExplicitSessionToggle?: boolean;
  systemPrefersDark?: boolean;
}): {
  activeVariant: EffectiveThemeVariant;
  isDark: boolean;
} {
  const afterDarkVariant: EffectiveThemeVariant =
    params.isAfterSundown && params.sundownPolicy !== 'DAYTIME_ONLY'
      ? 'MIDNIGHT_SLATE'
      : 'TRACK_PINE';

  if (params.isBrandStudioRoute && !params.hasExplicitSessionToggle && !params.hasExplicitPolicy) {
    const activeVariant: EffectiveThemeVariant =
      params.explicitLegacyDark === '1' ? afterDarkVariant : 'DAYLIGHT';
    return { activeVariant, isDark: activeVariant !== 'DAYLIGHT' };
  }

  if (params.isDemoSession && !params.hasExplicitPolicy && !params.hasExplicitSessionToggle) {
    if (params.explicitLegacyDark === '1') {
      return { activeVariant: afterDarkVariant, isDark: true };
    }
    if (params.explicitLegacyDark === '0' || !params.systemPrefersDark) {
      return { activeVariant: 'DAYLIGHT', isDark: false };
    }
    return { activeVariant: afterDarkVariant, isDark: true };
  }

  if (params.isCleanEphemeralDemoBoot) {
    const activeVariant: EffectiveThemeVariant = params.systemPrefersDark
      ? afterDarkVariant
      : 'DAYLIGHT';
    return { activeVariant, isDark: activeVariant !== 'DAYLIGHT' };
  }

  if (params.sessionLightOverride) {
    return { activeVariant: 'DAYLIGHT', isDark: false };
  }

  if (params.sundownPolicy === 'ALWAYS_MIDNIGHT_SLATE') {
    return { activeVariant: 'MIDNIGHT_SLATE', isDark: true };
  }

  if (params.isAfterSundown && params.sundownPolicy === 'AUTO_MIDNIGHT_SLATE') {
    return { activeVariant: 'MIDNIGHT_SLATE', isDark: true };
  }

  return {
    activeVariant: params.daytimePalette,
    isDark: params.daytimePalette !== 'DAYLIGHT',
  };
}

function readInitialDaytimePalette(): DaytimePalette {
  try {
    const saved = localStorage.getItem(STORAGE_DAYTIME_KEY);
    if (saved === 'DAYLIGHT' || saved === 'TRACK_PINE') return saved;
    const legacy = localStorage.getItem(STORAGE_LEGACY_DARK_KEY);
    if (legacy === '1') return 'TRACK_PINE';
    if (legacy === '0') return 'DAYLIGHT';
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ) {
      return 'TRACK_PINE';
    }
  } catch {
    // ignore storage access issues
  }
  return 'DAYLIGHT';
}

function readInitialSundownPolicy(): SundownPolicy {
  try {
    const saved = localStorage.getItem(STORAGE_POLICY_KEY);
    if (
      saved === 'AUTO_MIDNIGHT_SLATE' ||
      saved === 'DAYTIME_ONLY' ||
      saved === 'ALWAYS_MIDNIGHT_SLATE'
    ) {
      return saved;
    }
  } catch {
    // ignore
  }
  return 'AUTO_MIDNIGHT_SLATE';
}

function detectDemoSession(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('demo') === '1';
  } catch {
    return false;
  }
}

function detectBrandRoute(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.replace(/\/+$/, '') === '/brand';
}

function readLegacyDarkFlag(): '0' | '1' | null {
  try {
    const v = localStorage.getItem(STORAGE_LEGACY_DARK_KEY);
    return v === '1' || v === '0' ? v : null;
  } catch {
    return null;
  }
}

function readHasExplicitPolicy(): boolean {
  try {
    return localStorage.getItem(STORAGE_POLICY_KEY) !== null;
  } catch {
    return false;
  }
}

export function useSundownTheme() {
  const [daytimePalette, setDaytimePaletteState] = useState<DaytimePalette>(
    readInitialDaytimePalette
  );
  const [sundownPolicy, setSundownPolicyState] = useState<SundownPolicy>(
    readInitialSundownPolicy
  );
  const [sundownWindow, setSundownWindow] = useState<LocalSundownWindow>(() =>
    computeLocalSundownWindow()
  );
  const [sessionLightOverride, setSessionLightOverride] = useState<boolean>(false);
  const [hasExplicitSessionToggle, setHasExplicitSessionToggle] = useState<boolean>(false);
  const [hasExplicitPolicy, setHasExplicitPolicy] = useState<boolean>(readHasExplicitPolicy);

  useEffect(() => {
    const refresh = () => setSundownWindow(computeLocalSundownWindow());
    const id = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const systemPrefersDark =
    typeof window !== 'undefined' &&
    Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  const resolved = resolveEffectiveThemeState({
    daytimePalette,
    sundownPolicy,
    isAfterSundown: sundownWindow.isAfterSundown,
    sessionLightOverride,
    isBrandStudioRoute: detectBrandRoute(),
    isDemoSession: detectDemoSession(),
    explicitLegacyDark: readLegacyDarkFlag(),
    hasExplicitPolicy,
    hasExplicitSessionToggle,
    systemPrefersDark,
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolved.isDark);
    root.classList.toggle(
      'ap-midnight-slate',
      resolved.activeVariant === 'MIDNIGHT_SLATE'
    );
    if (!resolved.isDark) {
      root.classList.remove('ap-dusk');
    }
  }, [resolved.isDark, resolved.activeVariant]);

  const setDaytimePalette = useCallback((next: DaytimePalette) => {
    setHasExplicitSessionToggle(true);
    setHasExplicitPolicy(true);
    setDaytimePaletteState(next);
    setSessionLightOverride(next === 'DAYLIGHT' && sundownWindow.isAfterSundown);
    try {
      localStorage.setItem(STORAGE_DAYTIME_KEY, next);
      localStorage.setItem(STORAGE_POLICY_KEY, sundownPolicy);
    } catch {
      // ignore
    }
  }, [sundownWindow.isAfterSundown, sundownPolicy]);

  const setSundownPolicy = useCallback((next: SundownPolicy) => {
    setHasExplicitSessionToggle(true);
    setHasExplicitPolicy(true);
    setSundownPolicyState(next);
    setSessionLightOverride(false);
    try {
      localStorage.setItem(STORAGE_POLICY_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const toggleQuickLightDark = useCallback(() => {
    setHasExplicitSessionToggle(true);
    if (resolved.isDark) {
      setDaytimePaletteState('DAYLIGHT');
      setSessionLightOverride(true);
      try {
        localStorage.setItem(STORAGE_DAYTIME_KEY, 'DAYLIGHT');
        localStorage.setItem(STORAGE_LEGACY_DARK_KEY, '0');
      } catch {
        // ignore
      }
      return;
    }

    setSessionLightOverride(false);
    setDaytimePaletteState('TRACK_PINE');
    try {
      localStorage.setItem(STORAGE_DAYTIME_KEY, 'TRACK_PINE');
      localStorage.setItem(STORAGE_LEGACY_DARK_KEY, '1');
    } catch {
      // ignore
    }
  }, [resolved.isDark]);

  return {
    isDark: resolved.isDark,
    activeVariant: resolved.activeVariant,
    daytimePalette,
    setDaytimePalette,
    sundownPolicy,
    setSundownPolicy,
    sunsetLabel12h: sundownWindow.sunsetLabel12h,
    sunriseLabel12h: sundownWindow.sunriseLabel12h,
    isAfterSundown: sundownWindow.isAfterSundown,
    toggleQuickLightDark,
  };
}
