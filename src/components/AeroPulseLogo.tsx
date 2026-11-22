import React from 'react';
import type { TeamBrandConfig } from '../types';
import { computeAccessibleTeamPalette } from '../utils/teamPalette';
import {
  BREAK_LANE_M_ARROW_PATH,
  BREAK_LANE_M_LANES_PATH,
  FAV_F_SHIELD_T_PATH,
  FAV_M_ARROW_PATH,
  FAV_M_LANES_PATH,
  FAV_M_SINGLE_INK_PATH,
  MEETREADY_WORDMARK_OUTLINE_PATH,
  S2_ARROW_NEEDLE_PATH,
  S2_PINE_ARC_PATH,
  S2_VOLT_ARC_PATH,
} from '../utils/brandVectors';

export {
  BREAK_LANE_M_ARROW_PATH,
  BREAK_LANE_M_LANES_PATH,
  FAV_F_SHIELD_T_PATH,
  FAV_M_ARROW_PATH,
  FAV_M_LANES_PATH,
  FAV_M_SINGLE_INK_PATH,
  MEETREADY_WORDMARK_OUTLINE_PATH,
  S2_ARROW_NEEDLE_PATH,
  S2_PINE_ARC_PATH,
  S2_VOLT_ARC_PATH,
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
      ? '[--thresh-pine:#F6F3EC] [--thresh-ink:#F6F3EC]'
      : '[--thresh-pine:#F6F3EC] [--thresh-volt:#D8FF2A] [--thresh-ink:#F6F3EC]';
  }
  if (surface === 'on-light') {
    return isTeamOverride
      ? '[--thresh-pine:#121413] [--thresh-ink:#121413]'
      : '[--thresh-pine:#121413] [--thresh-volt:#B83A24] [--thresh-ink:#121413]';
  }
  return isTeamOverride
    ? '[--thresh-pine:#121413] dark:[--thresh-pine:#F6F3EC] [--thresh-ink:#121413] dark:[--thresh-ink:#F6F3EC]'
    : '[--thresh-pine:#121413] dark:[--thresh-pine:#F6F3EC] [--thresh-volt:#B83A24] dark:[--thresh-volt:#D8FF2A] [--thresh-ink:#121413] dark:[--thresh-ink:#F6F3EC]';
}

/**
 * Standalone 1:1 MeetReady Symbol Mark (`Velocity Chevron M`, 128×128).
 * Flat 2-ink solid interlocking peaks engineered for crisp SVG scaling & embroidery.
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
  accentColor = '#B83A24',
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
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel || undefined}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <path
        d={BREAK_LANE_M_LANES_PATH}
        fill={pineFill}
        fillRule="evenodd"
        clipRule="evenodd"
      />
      <path
        d={BREAK_LANE_M_ARROW_PATH}
        fill={voltFill}
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );
};

/**
 * Standalone Monolithic Outlined MeetReady Wordmark (326×64, zero <text> nodes).
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
  isTeamOverride = false,
  oneInkColor,
  ariaLabel = 'MeetReady',
}) => {
  const themeVarsClass = getSurfaceThemeVarsClass(surface, isTeamOverride);
  const inkFill = oneInkColor ?? 'var(--thresh-ink)';

  return (
    <svg
      viewBox="0 0 326 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${oneInkColor ? '' : themeVarsClass} ${className}`}
      role="img"
      aria-label={ariaLabel}
    >
      <path d={MEETREADY_WORDMARK_OUTLINE_PATH} fill={inkFill} fillRule="nonzero" />
    </svg>
  );
};

/**
 * Full MeetReady Lockup SVG (`Break-Lane M` × Outlined Monolithic `MeetReady`).
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
  const activeArrowColor = isTeamOverride ? accentColor : 'var(--thresh-volt)';

  return (
    <svg
      viewBox="0 0 472 124"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${themeVarsClass} ${className}`}
      role="img"
      aria-label={ariaLabel}
    >
      {/* Flat 2-ink Surging Break-Lane M Symbol */}
      <g transform="translate(6, 5) scale(0.94)">
        <path
          d={BREAK_LANE_M_LANES_PATH}
          fill="var(--thresh-pine)"
          fillRule="evenodd"
          clipRule="evenodd"
        />
        <path
          d={BREAK_LANE_M_ARROW_PATH}
          fill={activeArrowColor}
          fillRule="evenodd"
          clipRule="evenodd"
        />
      </g>

      {/* Monolithic Outlined MeetReady Wordmark (zero <text> font dependency) */}
      <g transform="translate(135, 54)">
        <path
          d={MEETREADY_WORDMARK_OUTLINE_PATH}
          fill="var(--thresh-ink)"
          fillRule="nonzero"
        />
      </g>
    </svg>
  );
};

/**
 * Compact 32x32 MeetReady Velocity Chevron M Squircle Icon (matches public/icon.svg 1:1).
 */
export const ThreshSquareTrackIcon: React.FC<{
  className?: string;
  accentColor?: string;
  inkColor?: string;
  isTeamOverride?: boolean;
}> = ({
  className = 'w-8 h-8',
  accentColor = '#D8FF2A',
  inkColor = '#121413',
  isTeamOverride = false,
}) => {
  if (isTeamOverride) {
    return (
      <svg
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden="true"
      >
        <rect width="32" height="32" rx="7" fill={accentColor} />
        <path
          d={FAV_M_SINGLE_INK_PATH}
          fill={inkColor}
          fillRule="evenodd"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="7" fill="#121413" />
      <path
        d={FAV_M_LANES_PATH}
        fill="#F6F3EC"
        fillRule="evenodd"
        clipRule="evenodd"
      />
      <path
        d={FAV_M_ARROW_PATH}
        fill="#D8FF2A"
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );
};

/**
 * MeetReady — Modular Sitewide Brand Lockup & Dynamic Team Co-Branded Header
 * - Horizontal UI headers render crisp 2-peak Velocity Chevron M SVG + native browser-hinted Archivo ExtraBold wordmark.
 * - `mark-only` and `wordmark-only` continue to render standalone vectors for modular kits.
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
  const horizontalMarkClass =
    size === 'sm'
      ? 'w-7 h-7 sm:w-8 sm:h-8'
      : size === 'lg'
        ? 'w-11 h-11 sm:w-12 sm:h-12'
        : 'w-8 h-8 sm:w-9 sm:h-9';

  const horizontalWordmarkTextClass =
    size === 'sm'
      ? 'text-lg sm:text-xl'
      : size === 'lg'
        ? 'text-2xl sm:text-3xl'
        : 'text-xl sm:text-2xl';

  const cobrandMarkClass =
    size === 'sm'
      ? 'w-5 h-5 sm:w-6 sm:h-6'
      : size === 'lg'
        ? 'w-9 h-9 sm:w-10 sm:h-10'
        : 'w-7 h-7 sm:w-8 sm:h-8';

  const cobrandWordmarkTextClass =
    size === 'sm'
      ? 'text-sm sm:text-base'
      : size === 'lg'
        ? 'text-xl sm:text-2xl'
        : 'text-base sm:text-lg';

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
      ? 'bg-[#FDF0ED] dark:bg-[#B83A24]/20 text-[#8F2A18] dark:text-[#F6B8AC] border-[#E8B4AA] dark:border-[#E05238]/40'
      : badgeTone === 'emerald'
        ? 'bg-[#E7F3EC] dark:bg-[#1E4D36]/30 text-[#1E4D36] dark:text-[#86EFAC] border-[#B6D9C4] dark:border-[#2F7A55]/45'
        : 'bg-[#D8FF2A] text-[#121413] border-[#121413]/25 dark:border-[#D8FF2A] font-bold';

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
      ? 'text-[#F6F3EC]'
      : surface === 'on-light'
        ? 'text-[#121413]'
        : 'text-[#121413] dark:text-[#F6F3EC]';

  const teamVarSelectorClass =
    surface === 'on-dark'
      ? '[--team-logo-accent:var(--team-logo-dark)]'
      : surface === 'on-light'
        ? '[--team-logo-accent:var(--team-logo-light)]'
        : '[--team-logo-accent:var(--team-logo-light)] dark:[--team-logo-accent:var(--team-logo-dark)]';

  const renderStandaloneMark = (isTeam = false) => {
    const accent = isTeam ? 'var(--team-logo-accent)' : '#B83A24';
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
      <span
        className="inline-flex items-center gap-2 shrink-0"
        aria-label={label}
      >
        <ThreshMark
          className={`${isTeam ? cobrandMarkClass : horizontalMarkClass} shrink-0`}
          surface={surface}
          accentColor={accent}
          isTeamOverride={isTeam}
          ariaLabel=""
        />
        <span
          className={`font-sans font-extrabold tracking-[-0.03em] leading-none ${
            isTeam ? cobrandWordmarkTextClass : horizontalWordmarkTextClass
          } ${teamTextColorClass}`}
        >
          MeetReady
        </span>
      </span>
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
                className={`${crestBoxClass} object-contain bg-white dark:bg-[#1A1D1B] p-0.5 border border-black/15 dark:border-white/15 shrink-0`}
              />
            ) : (
              <div
                className={`${crestBoxClass} flex items-center justify-center font-sans font-extrabold tracking-tight border border-white/25 shrink-0`}
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
              className={`${
                size === 'sm' ? 'hidden min-[420px]:inline' : 'inline'
              } ${teamTitleClass} font-sans truncate max-w-[110px] sm:max-w-[190px]`}
              title={teamBrand.name}
            >
              {teamBrand.shortName || teamBrand.name}
            </span>
            <span
              className={`font-normal text-xs shrink-0 ${
                surface === 'on-dark'
                  ? 'text-[#A39E93]'
                  : 'text-[#57544D] dark:text-[#A39E93]'
              }`}
            >
              ×
            </span>
            <span className="inline-flex items-center shrink-0">
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
              ? 'text-[#D8FF2A]'
              : 'text-[#B83A24] dark:text-[#D8FF2A]'
          }`}
        >
          {teamBrand?.mascotOrMotto ? teamBrand.mascotOrMotto : 'RUN. JUMP. THROW. MEET READY.'}
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
 * Signature 4-Lane Concentric Track Banking-Turn Watermark for subtle backdrop cards.
 */
export const ThreshBrandWatermark: React.FC<{ className?: string }> = ({
  className = 'w-48 h-40',
}) => (
  <svg
    viewBox="0 0 260 220"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`pointer-events-none select-none opacity-[0.06] dark:opacity-[0.08] ${className}`}
    aria-hidden="true"
  >
    <path
      d="M 260 190 H 120 A 70 70 0 0 1 120 50 H 260"
      className="stroke-[#B83A24] dark:stroke-[#D8FF2A]"
      strokeWidth="3"
    />
    <path
      d="M 260 204 H 120 A 84 84 0 0 1 120 36 H 260"
      className="stroke-[#121413] dark:stroke-[#F6F3EC]"
      strokeWidth="3"
    />
    <path
      d="M 260 218 H 120 A 98 98 0 0 1 120 22 H 260"
      className="stroke-[#121413] dark:stroke-[#F6F3EC]"
      strokeWidth="3"
    />
    <path
      d="M 260 232 H 120 A 112 112 0 0 1 120 8 H 260"
      className="stroke-[#121413] dark:stroke-[#F6F3EC]"
      strokeWidth="3"
    />
  </svg>
);
