import React from 'react';
import type { TeamBrandConfig } from '../types';
import { computeAccessibleTeamPalette } from '../utils/teamPalette';
import {
  FAV_F_SHIELD_T_PATH,
  MEETREADY_WORDMARK_FONT_FAMILY,
  S2_ARROW_NEEDLE_PATH,
  S2_PINE_ARC_PATH,
  S2_VOLT_ARC_PATH,
  WA_THRESHOLD_BAR_PATH,
  WA_WORDMARK_INK_PATHS,
} from '../utils/brandVectors';

export {
  FAV_F_SHIELD_T_PATH,
  S2_ARROW_NEEDLE_PATH,
  S2_PINE_ARC_PATH,
  S2_VOLT_ARC_PATH,
  WA_THRESHOLD_BAR_PATH,
  WA_WORDMARK_INK_PATHS,
};

export type BrandSurfaceMode = 'auto' | 'on-light' | 'on-dark';

interface AeroPulseLogoProps {
  size?: 'sm' | 'md' | 'lg';
  mode?: 'horizontal' | 'mark-only' | 'wordmark-only';
  surface?: BrandSurfaceMode;
  showTagline?: boolean;
  badgeText?: string;
  badgeTone?: 'volt' | 'cyan' | 'orange' | 'emerald';
  teamBrand?: TeamBrandConfig | null;
}

function getSurfaceThemeVarsClass(
  surface: BrandSurfaceMode,
  isTeamOverride: boolean
): string {
  if (surface === 'on-dark') {
    return isTeamOverride
      ? '[--thresh-pine:#64748B] [--thresh-ink:#F4F7F4]'
      : '[--thresh-pine:#399663] [--thresh-volt:#C8FF00] [--thresh-ink:#F4F7F4]';
  }
  if (surface === 'on-light') {
    return isTeamOverride
      ? '[--thresh-pine:#334155] [--thresh-ink:#101411]'
      : '[--thresh-pine:#1C5436] [--thresh-volt:#357A00] [--thresh-ink:#101411]';
  }
  return isTeamOverride
    ? '[--thresh-pine:#334155] dark:[--thresh-pine:#64748B] [--thresh-ink:#101411] dark:[--thresh-ink:#F4F7F4]'
    : '[--thresh-pine:#1C5436] dark:[--thresh-pine:#399663] [--thresh-volt:#357A00] dark:[--thresh-volt:#C8FF00] [--thresh-ink:#101411] dark:[--thresh-ink:#F4F7F4]';
}

/**
 * Standalone 1:1 MeetReady Symbol Mark (`S2 Redline Breach`, 128×128).
 * Chronometer precision ring broken at 45° by a piercing threshold arrow-needle.
 */
export const ThreshMark: React.FC<{
  className?: string;
  surface?: BrandSurfaceMode;
  accentColor?: string;
  isTeamOverride?: boolean;
  oneInkColor?: string;
  ariaLabel?: string;
}> = ({
  className = 'w-9 h-9',
  surface = 'auto',
  accentColor = '#C8FF00',
  isTeamOverride = false,
  oneInkColor,
  ariaLabel = 'MeetReady mark',
}) => {
  const themeVarsClass = getSurfaceThemeVarsClass(surface, isTeamOverride);
  const pineFill = oneInkColor ?? 'var(--thresh-pine)';
  const voltFill = oneInkColor ?? (isTeamOverride ? accentColor : 'var(--thresh-volt)');

  return (
    <svg
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${oneInkColor ? '' : themeVarsClass} ${className}`}
      role="img"
      aria-label={ariaLabel}
    >
      <path d={S2_PINE_ARC_PATH} fill={pineFill} />
      <path d={S2_VOLT_ARC_PATH} fill={voltFill} />
      <path
        d={S2_ARROW_NEEDLE_PATH}
        fill={voltFill}
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );
};

/**
 * Standalone MeetReady Two-Tone CamelCase Wordmark (`Meet` + `Ready`, 364×64).
 */
export const ThreshWordmark: React.FC<{
  className?: string;
  surface?: BrandSurfaceMode;
  accentColor?: string;
  showVoltBar?: boolean;
  isTeamOverride?: boolean;
  oneInkColor?: string;
  ariaLabel?: string;
}> = ({
  className = 'h-6 w-auto',
  surface = 'auto',
  accentColor = '#C8FF00',
  showVoltBar = true,
  isTeamOverride = false,
  oneInkColor,
  ariaLabel = 'MeetReady',
}) => {
  const themeVarsClass = getSurfaceThemeVarsClass(surface, isTeamOverride);
  const inkFill = oneInkColor ?? 'var(--thresh-ink)';
  const barFill = oneInkColor
    ? oneInkColor
    : showVoltBar
      ? isTeamOverride
        ? accentColor
        : 'var(--thresh-volt)'
      : inkFill;

  return (
    <svg
      viewBox="0 0 364 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${oneInkColor ? '' : themeVarsClass} ${className}`}
      role="img"
      aria-label={ariaLabel}
    >
      <text
        x="0"
        y="46"
        fontFamily={MEETREADY_WORDMARK_FONT_FAMILY}
        fontSize="56"
        fontWeight="800"
        letterSpacing="-1.6"
      >
        <tspan fill={inkFill}>Meet</tspan>
        <tspan fill={barFill}>Ready</tspan>
      </text>
    </svg>
  );
};

/**
 * Full MeetReady Lockup SVG (`S2 Redline Breach` × `MeetReady`).
 * Accepts `surface="on-dark"` so footer / dark-surround placements stay high contrast in Light Mode.
 */
export const ThreshFullVectorLockup: React.FC<{
  className?: string;
  surface?: BrandSurfaceMode;
  accentColor?: string;
  isTeamOverride?: boolean;
  ariaLabel?: string;
}> = ({
  className = 'h-9 w-auto',
  surface = 'auto',
  accentColor = '#C8FF00',
  isTeamOverride = false,
  ariaLabel = 'MeetReady',
}) => {
  const themeVarsClass = getSurfaceThemeVarsClass(surface, isTeamOverride);
  const activeGaugeColor = isTeamOverride ? accentColor : 'var(--thresh-volt)';

  return (
    <svg
      viewBox="0 0 472 124"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${themeVarsClass} ${className}`}
      role="img"
      aria-label={ariaLabel}
    >
      {/* Standalone S2 Redline Breach Symbol */}
      <g transform="translate(6, -5.5) scale(0.98)">
        <path d={S2_PINE_ARC_PATH} fill="var(--thresh-pine)" />
        <path d={S2_VOLT_ARC_PATH} fill={activeGaugeColor} />
        <path
          d={S2_ARROW_NEEDLE_PATH}
          fill={activeGaugeColor}
          fillRule="evenodd"
          clipRule="evenodd"
        />
      </g>

      {/* CamelCase Two-Tone MeetReady Wordmark */}
      <g transform="translate(132, 33) scale(0.96)">
        <text
          x="0"
          y="46"
          fontFamily={MEETREADY_WORDMARK_FONT_FAMILY}
          fontSize="56"
          fontWeight="800"
          letterSpacing="-1.6"
        >
          <tspan fill="var(--thresh-ink)">Meet</tspan>
          <tspan fill={activeGaugeColor}>Ready</tspan>
        </text>
      </g>
    </svg>
  );
};

/**
 * Compact 32x32 MeetReady "High-Vis Volt Shield" Squircle Icon Mark for 16px/32px browser favicons and small tiles.
 */
export const ThreshSquareTrackIcon: React.FC<{
  className?: string;
  accentColor?: string;
  inkColor?: string;
  isTeamOverride?: boolean;
}> = ({
  className = 'w-8 h-8',
  accentColor = '#C8FF00',
  inkColor = '#080A09',
  isTeamOverride = false,
}) => {
  const tileFill = isTeamOverride ? accentColor : '#C8FF00';
  const primaryMark = isTeamOverride ? inkColor : '#080A09';

  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="7" fill={tileFill} />
      <path
        d={FAV_F_SHIELD_T_PATH}
        fill={primaryMark}
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );
};

/**
 * MeetReady — Modular Sitewide Brand Lockup & Dynamic Team Co-Branded Header
 * - Supports decoupled `mode`: `'horizontal'` (Symbol + Wordmark), `'mark-only'`, or `'wordmark-only'`.
 * - Supports explicit `surface` (`'auto' | 'on-light' | 'on-dark'`) so footers and dark chrome stay AAA contrast.
 */
export const AeroPulseLogo: React.FC<AeroPulseLogoProps> = ({
  size = 'md',
  mode = 'horizontal',
  surface = 'auto',
  showTagline = false,
  badgeText,
  badgeTone = 'volt',
  teamBrand = null,
}) => {
  const standaloneSvgHeightClass =
    size === 'sm'
      ? 'h-8 sm:h-[38px] w-auto'
      : size === 'lg'
        ? 'h-12 sm:h-14 w-auto'
        : 'h-10 sm:h-11 w-auto';

  const markOnlyClass =
    size === 'sm'
      ? 'w-7 h-7 sm:w-8 sm:h-8'
      : size === 'lg'
        ? 'w-11 h-11 sm:w-12 sm:h-12'
        : 'w-9 h-9 sm:w-10 sm:h-10';

  const wordmarkOnlyClass =
    size === 'sm'
      ? 'h-4 sm:h-[18px] w-auto'
      : size === 'lg'
        ? 'h-7 sm:h-8 w-auto'
        : 'h-5 sm:h-6 w-auto';

  const cobrandSvgHeightClass =
    size === 'sm'
      ? 'h-7 sm:h-8 w-auto'
      : size === 'lg'
        ? 'h-10 sm:h-12 w-auto'
        : 'h-8 sm:h-9 w-auto';

  const crestBoxClass =
    size === 'sm'
      ? 'w-7 h-7 sm:w-8 sm:h-8 rounded-lg text-2xs'
      : size === 'lg'
        ? 'w-10 h-10 sm:w-11 sm:h-11 rounded-xl text-xs'
        : 'w-8 h-8 sm:w-9 sm:h-9 rounded-xl text-2xs';

  const teamTitleClass =
    size === 'sm'
      ? 'text-xs sm:text-sm font-extrabold tracking-[-0.02em]'
      : size === 'lg'
        ? 'text-lg sm:text-xl font-extrabold tracking-[-0.03em]'
        : 'text-sm sm:text-base font-extrabold tracking-[-0.025em]';

  const badgeToneClasses =
    badgeTone === 'orange'
      ? 'bg-[#FFF4ED] dark:bg-[#FB6514]/15 text-[#B93800] dark:text-[#FB923C] border-[#FDBA74] dark:border-[#FB6514]/35'
      : badgeTone === 'emerald'
        ? 'bg-[#ECFDF5] dark:bg-emerald-500/15 text-[#065F46] dark:text-emerald-300 border-[#A7F3D0] dark:border-emerald-500/35'
        : 'bg-[#C8FF00] text-[#080A09] border-[#65A30D] dark:border-[#E2FF66] font-bold';

  const teamPalette = teamBrand
    ? computeAccessibleTeamPalette(teamBrand.primaryHex, teamBrand.secondaryHex)
    : null;

  const teamMonogram = teamBrand
    ? (teamBrand.shortName || teamBrand.name || 'TM')
        .split(/[\s-]+/)
        .filter(Boolean)
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : '';

  const teamCssVars = teamPalette
    ? ({
        '--team-logo-light': teamPalette.primaryOnLight,
        '--team-logo-dark': teamPalette.primaryOnDark,
      } as React.CSSProperties)
    : undefined;

  const teamTextColorClass =
    surface === 'on-dark'
      ? 'text-[#F4F7F4]'
      : surface === 'on-light'
        ? 'text-[#101411]'
        : 'text-[#101411] dark:text-[#F4F7F4]';

  const teamVarSelectorClass =
    surface === 'on-dark'
      ? '[--team-logo-accent:var(--team-logo-dark)]'
      : surface === 'on-light'
        ? '[--team-logo-accent:var(--team-logo-light)]'
        : '[--team-logo-accent:var(--team-logo-light)] dark:[--team-logo-accent:var(--team-logo-dark)]';

  const renderStandaloneMark = (isTeam = false) => {
    const accent = isTeam ? 'var(--team-logo-accent)' : '#C8FF00';
    const label =
      isTeam && teamBrand
        ? `${teamBrand.shortName || teamBrand.name} on MeetReady`
        : 'MeetReady';

    if (mode === 'mark-only') {
      return (
        <ThreshMark
          className={`${markOnlyClass} shrink-0`}
          surface={surface}
          accentColor={accent}
          isTeamOverride={isTeam}
          ariaLabel={label}
        />
      );
    }
    if (mode === 'wordmark-only') {
      return (
        <ThreshWordmark
          className={`${wordmarkOnlyClass} shrink-0`}
          surface={surface}
          accentColor={accent}
          isTeamOverride={isTeam}
          ariaLabel={label}
        />
      );
    }
    return (
      <ThreshFullVectorLockup
        className={`${isTeam ? cobrandSvgHeightClass : standaloneSvgHeightClass} shrink-0`}
        surface={surface}
        accentColor={accent}
        isTeamOverride={isTeam}
        ariaLabel={label}
      />
    );
  };

  return (
    <div
      className={`inline-flex flex-col justify-center select-none min-w-0 ${teamVarSelectorClass}`}
      style={teamCssVars}
    >
      <div className={`inline-flex items-center gap-2 ${teamTextColorClass} min-w-0`}>
        {teamBrand && teamPalette ? (
          <>
            {teamBrand.logoDataUrl ? (
              <img
                src={teamBrand.logoDataUrl}
                alt={`${teamBrand.shortName || teamBrand.name} crest`}
                className={`${crestBoxClass} object-contain bg-white dark:bg-[#121715] p-0.5 border border-black/15 dark:border-white/15 shadow-2xs shrink-0`}
              />
            ) : (
              <div
                className={`${crestBoxClass} flex items-center justify-center font-display font-extrabold tracking-tight border border-white/25 shadow-2xs shrink-0`}
                style={{
                  background: `linear-gradient(135deg, ${teamPalette.primaryOnLight} 0%, ${teamPalette.secondaryOnLight} 100%)`,
                  color: teamPalette.textOnPrimaryLight,
                }}
                title={teamBrand.name}
              >
                {teamMonogram}
              </div>
            )}
            <span
              className={`${teamTitleClass} font-display truncate max-w-[82px] sm:max-w-[190px]`}
              title={teamBrand.name}
            >
              {teamBrand.shortName || teamBrand.name}
            </span>
            <span
              className={`${size === 'sm' ? 'hidden sm:inline' : 'inline'} font-normal text-xs shrink-0 ${
                surface === 'on-dark'
                  ? 'text-emerald-200/75'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              ×
            </span>
            <span className={`${size === 'sm' ? 'hidden sm:inline-flex' : 'inline-flex'} items-center shrink-0`}>
              {renderStandaloneMark(true)}
            </span>
          </>
        ) : (
          renderStandaloneMark(false)
        )}

        {badgeText && (
          <span
            className={`px-1.5 py-0.5 rounded text-2xs font-mono font-semibold uppercase tracking-wider border shrink-0 ${badgeToneClasses}`}
          >
            {badgeText}
          </span>
        )}
      </div>

      {showTagline && (
        <span
          className={`block text-2xs font-mono font-semibold mt-1 tracking-wider uppercase truncate ${
            surface === 'on-dark'
              ? 'text-[#C8FF00]'
              : 'text-[#3F6212] dark:text-[#C8FF00]'
          }`}
        >
          {teamBrand?.mascotOrMotto ? teamBrand.mascotOrMotto : 'RUN & RIDE READINESS'}
        </span>
      )}
    </div>
  );
};

export const ThreshLogo = AeroPulseLogo;
export const ThreshLockup = AeroPulseLogo;
export const MeetReadyLogo = AeroPulseLogo;
export const MeetReadyMark = ThreshMark;

/**
 * Signature #1 Stadium Track 4-Lane Concentric Banking-Turn Watermark for hero & workout cards.
 */
export const ThreshBrandWatermark: React.FC<{ className?: string }> = ({
  className = 'w-48 h-40',
}) => (
  <svg
    viewBox="0 0 260 220"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`pointer-events-none select-none opacity-[0.045] dark:opacity-[0.065] ${className}`}
    aria-hidden="true"
  >
    <path
      d="M 260 190 H 120 A 70 70 0 0 1 120 50 H 260"
      className="stroke-[#65A30D] dark:stroke-[#C8FF00]"
      strokeWidth="8"
    />
    <path
      d="M 260 204 H 120 A 84 84 0 0 1 120 36 H 260"
      className="stroke-[#28573B] dark:stroke-[#399663]"
      strokeWidth="8"
    />
    <path
      d="M 260 218 H 120 A 98 98 0 0 1 120 22 H 260"
      className="stroke-[#28573B] dark:stroke-[#399663]"
      strokeWidth="8"
    />
    <path
      d="M 260 232 H 120 A 112 112 0 0 1 120 8 H 260"
      className="stroke-[#28573B] dark:stroke-[#399663]"
      strokeWidth="8"
    />
  </svg>
);
