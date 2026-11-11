import React from 'react';
import type { TeamBrandConfig } from '../types';
import { computeAccessibleTeamPalette } from '../physiology/teamOnboardingEngine';

interface AeroPulseLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  badgeText?: string;
  badgeTone?: 'volt' | 'cyan' | 'orange' | 'emerald';
  teamBrand?: TeamBrandConfig | null;
}

/**
 * Shared SVG Geometry Constants for THRESH:
 * T3 (Stepped-Zone 4-Lane Track Gauge) × Velocity Spur + V1 (Laser Spearhead)
 */
const T3_TRACK_BASE_PATHS_LOCKUP = [
  'M 417.84 138.5 L 96 138.5 A 46.5 46.5 0 0 1 91.14 45.75 L 92.03 54.21 A 38 38 0 0 0 96 130 L 420.36 130 Z',
  'M 414.23 150.7 L 96 150.7 A 58.7 58.7 0 1 1 108.2 34.58 L 106.44 42.9 A 50.2 50.2 0 1 0 96 142.2 L 416.75 142.2 Z',
  'M 410.61 162.9 L 96 162.9 A 70.9 70.9 0 1 1 131.45 30.6 L 127.2 37.96 A 62.4 62.4 0 1 0 96 154.4 L 413.13 154.4 Z',
  'M 407 175.1 L 96 175.1 A 83.1 83.1 0 1 1 157.76 36.4 L 151.44 42.08 A 74.6 74.6 0 1 0 96 166.6 L 409.52 166.6 Z',
];

const T3_TRACK_BASE_PATHS_SQUARE = [
  'M 176.84 138.5 L 96 138.5 A 46.5 46.5 0 0 1 91.14 45.75 L 92.03 54.21 A 38 38 0 0 0 96 130 L 179.36 130 Z',
  'M 173.23 150.7 L 96 150.7 A 58.7 58.7 0 1 1 108.2 34.58 L 106.44 42.9 A 50.2 50.2 0 1 0 96 142.2 L 175.75 142.2 Z',
  'M 169.61 162.9 L 96 162.9 A 70.9 70.9 0 1 1 131.45 30.6 L 127.2 37.96 A 62.4 62.4 0 1 0 96 154.4 L 172.13 154.4 Z',
  'M 166 175.1 L 96 175.1 A 83.1 83.1 0 1 1 157.76 36.4 L 151.44 42.08 A 74.6 74.6 0 1 0 96 166.6 L 168.52 166.6 Z',
];

const T3_REDLINE_SECTOR_PATHS = [
  'M 97.62 45.53 A 46.5 46.5 0 0 1 142.5 92 L 134 92 A 38 38 0 0 0 97.33 54.02 Z',
  'M 116.08 36.84 A 58.7 58.7 0 0 1 154.7 92 L 146.2 92 A 50.2 50.2 0 0 0 113.17 44.83 Z',
  'M 139.65 36.13 A 70.9 70.9 0 0 1 166.9 92 L 158.4 92 A 62.4 62.4 0 0 0 134.42 42.83 Z',
  'M 164.89 45.53 A 83.1 83.1 0 0 1 179.1 92 L 170.6 92 A 74.6 74.6 0 0 0 157.85 50.28 Z',
];

// Single watertight evenodd path: Center Hub + 312° Pointer + Transparent Axle Hole
const T3_POINTER_EVENODD_PATH =
  'M 107.89 88.14 A 12.5 12.5 0 1 1 98.6 79.77 L 116.79 65.63 L 120.05 68.57 Z M 100.5 92 A 4.5 4.5 0 1 0 91.5 92 A 4.5 4.5 0 1 0 100.5 92 Z';

// Velocity Spur Wordmark + V1 Laser Spearhead
const VELOCITY_SPUR_UPPER_PATHS = [
  'M -8 0 H 30.5 L 28.0 9.6 H 16.8 V 23.6 H 5.8 V 9.6 H -5.2 Z',
  'M 32.5 0 H 46.5 V 19.6 H 56.5 V 0 H 67.2 V 23.6 H 35.8 V 6.2 Z',
  'M 71.5 0 H 95.8 C 104.2 0 108.8 4.4 108.8 12.2 C 108.8 19.4 104.5 23.2 97.2 23.6 H 74.8 V 6.2 Z M 85.5 8.4 V 16.8 H 94.8 C 97.4 16.8 98.5 15.4 98.5 12.6 C 98.5 9.8 97.4 8.4 94.8 8.4 Z',
  'M 112.5 0 H 145.5 L 143.2 9.2 H 126.2 V 19.8 H 141.5 V 23.6 H 115.8 V 6.2 Z',
  'M 181.5 13.8 H 171.0 V 11.2 C 171.0 9.2 169.5 8.0 167.0 8.0 H 161.5 C 159.2 8.0 158.0 9.2 158.0 11.5 C 158.0 14.4 159.8 15.8 171.5 19.2 C 175.8 20.5 178.6 22.0 180.2 23.6 H 159.8 C 151.6 21.2 148.0 17.6 148.0 11.5 C 148.0 4.5 153.2 0 161.2 0 H 168.5 C 176.8 0 181.5 4.6 181.5 12.2 Z',
  'M 184.2 0 H 198.2 V 19.6 H 208.2 V 0 H 219.0 V 23.6 H 187.5 V 6.2 Z',
];

const VELOCITY_SPUR_LOWER_PATHS = [
  'M 5.8 29.4 H 16.8 V 54 H 5.8 Z',
  'M 35.8 29.4 H 67.2 V 54 H 56.5 V 33.8 H 46.5 V 54 H 35.8 Z',
  'M 74.8 29.4 H 85.5 V 54 H 74.8 Z M 89.2 29.4 H 100.5 L 109.5 54 H 98.2 Z',
  'M 115.8 29.4 H 141.5 V 32.8 H 126.2 V 44.8 H 145.5 L 143.2 54 H 115.8 Z',
  'M 149.8 29.4 H 170.2 C 178.4 31.8 182.0 35.6 182.0 42.0 C 182.0 49.4 176.8 54.0 168.5 54.0 H 161.0 C 152.8 54.0 148.0 49.4 148.0 41.8 V 39.8 H 158.5 V 42.4 C 158.5 44.6 160.0 45.8 162.5 45.8 H 168.0 C 170.5 45.8 171.8 44.6 171.8 42.2 C 171.8 39.2 169.8 37.8 158.2 34.4 C 154.0 33.1 151.4 31.4 149.8 29.4 Z',
  'M 187.5 29.4 H 219.0 V 54 H 208.2 V 33.8 H 198.2 V 54 H 187.5 Z',
];

const V1_LASER_SPEARHEAD_PATH =
  'M -12 24.9 H 226.5 L 222.5 17.5 L 242.5 26.5 L 222.5 35.5 L 226.5 28.1 H -14 Z';

/**
 * Full Custom THRESH Vector Lockup SVG (T3 Stepped Track Gauge × Velocity Spur + V1 Laser Spearhead).
 * Uses currentColor for primary ink and `accentColor` (defaults to `var(--ap-thresh-vermilion)`)
 * so active Team Primary Colors dynamically theme both the track gauge redline and wordmark spearhead.
 */
export const ThreshFullVectorLockup: React.FC<{
  className?: string;
  accentColor?: string;
  ariaLabel?: string;
}> = ({
  className = 'h-8 w-auto',
  accentColor = 'var(--ap-thresh-vermilion)',
  ariaLabel = 'THRESH',
}) => (
  <svg
    viewBox="10 6 436 173"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    role="img"
    aria-label={ariaLabel}
  >
    {/* 4-Lane Stepped-Zone Stadium Track Curve + 16.5° Sheared Straightaway */}
    <g fill="currentColor">
      {T3_TRACK_BASE_PATHS_LOCKUP.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </g>
    <g fill={accentColor}>
      {T3_REDLINE_SECTOR_PATHS.map((d, i) => (
        <path key={i} d={d} />
      ))}
      <path fillRule="evenodd" clipRule="evenodd" d={T3_POINTER_EVENODD_PATH} />
    </g>

    {/* Velocity Spur Custom Split Wordmark + V1 Laser Spearhead */}
    <g transform="translate(199, 69) skewX(-16.5)">
      <g transform="translate(3.8, 0)" fill="currentColor">
        {VELOCITY_SPUR_UPPER_PATHS.map((d, i) => (
          <path
            key={i}
            d={d}
            fillRule={i === 2 ? 'evenodd' : undefined}
            clipRule={i === 2 ? 'evenodd' : undefined}
          />
        ))}
      </g>
      <g fill="currentColor">
        {VELOCITY_SPUR_LOWER_PATHS.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <path d={V1_LASER_SPEARHEAD_PATH} fill={accentColor} />
    </g>
  </svg>
);

/**
 * Square T3 4-Lane Stepped Track-Gauge Icon Mark (for compact badges, avatars & watermarks)
 */
export const ThreshSquareTrackIcon: React.FC<{
  className?: string;
  accentColor?: string;
}> = ({ className = 'w-7 h-7', accentColor = 'var(--ap-thresh-vermilion)' }) => (
  <svg
    viewBox="8 4 178 176"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <g fill="currentColor">
      {T3_TRACK_BASE_PATHS_SQUARE.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </g>
    <g fill={accentColor}>
      {T3_REDLINE_SECTOR_PATHS.map((d, i) => (
        <path key={i} d={d} />
      ))}
      <path fillRule="evenodd" clipRule="evenodd" d={T3_POINTER_EVENODD_PATH} />
    </g>
  </svg>
);

/**
 * THRESH — Sitewide Brand Lockup & Dynamic Team Co-Branded Header
 * - Standalone: Renders the full T3 Stepped Track Gauge × Velocity Spur (V1 Spearhead) lockup.
 * - Active Team: Renders `[Team Crest / Monogram] <SHORT NAME> × [Team-Colored THRESH Lockup]`
 *   so every school or club sees its own primary color baked right into the THRESH track & spearhead!
 */
export const AeroPulseLogo: React.FC<AeroPulseLogoProps> = ({
  size = 'md',
  showTagline = false,
  badgeText,
  badgeTone = 'volt',
  teamBrand = null,
}) => {
  const standaloneSvgHeightClass =
    size === 'sm'
      ? 'h-7 sm:h-8 w-auto'
      : size === 'lg'
        ? 'h-12 sm:h-14 w-auto'
        : 'h-9 sm:h-11 w-auto';

  const cobrandSvgHeightClass =
    size === 'sm'
      ? 'h-5 sm:h-6 w-auto'
      : size === 'lg'
        ? 'h-8 sm:h-10 w-auto'
        : 'h-6 sm:h-7 w-auto';

  const crestBoxClass =
    size === 'sm'
      ? 'w-7 h-7 sm:w-8 sm:h-8 rounded-lg text-[10px]'
      : size === 'lg'
        ? 'w-10 h-10 sm:w-11 sm:h-11 rounded-xl text-xs'
        : 'w-8 h-8 sm:w-9 sm:h-9 rounded-xl text-[11px]';

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
        : 'bg-[#F7FEE7] dark:bg-[#C8FF00]/14 text-[#3F6212] dark:text-[#C8FF00] border-[#BEF264] dark:border-[#C8FF00]/35';

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

  return (
    <div
      className="inline-flex flex-col justify-center select-none min-w-0 [--team-logo-accent:var(--team-logo-light)] dark:[--team-logo-accent:var(--team-logo-dark)]"
      style={teamCssVars}
    >
      <div className="inline-flex items-center gap-2 text-[#101411] dark:text-[#F4F7F4] min-w-0">
        {teamBrand && teamPalette ? (
          <>
            {teamBrand.logoDataUrl ? (
              <img
                src={teamBrand.logoDataUrl}
                alt={`${teamBrand.shortName || teamBrand.name} crest`}
                className={`${crestBoxClass} object-contain bg-white dark:bg-[#121419] p-0.5 border border-black/15 dark:border-white/15 shadow-2xs shrink-0`}
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
              className={`${teamTitleClass} font-display truncate max-w-[115px] sm:max-w-[190px]`}
              title={teamBrand.name}
            >
              {teamBrand.shortName || teamBrand.name}
            </span>
            <span className="text-slate-400 dark:text-slate-500 font-normal text-xs shrink-0">
              ×
            </span>
            <ThreshFullVectorLockup
              className={`${cobrandSvgHeightClass} shrink-0`}
              accentColor="var(--team-logo-accent)"
              ariaLabel={`${teamBrand.shortName || teamBrand.name} on THRESH`}
            />
          </>
        ) : (
          <ThreshFullVectorLockup
            className={`${standaloneSvgHeightClass} shrink-0`}
            accentColor="var(--ap-thresh-vermilion)"
            ariaLabel="THRESH"
          />
        )}

        {badgeText && (
          <span
            className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold uppercase tracking-wider border shrink-0 ${badgeToneClasses}`}
          >
            {badgeText}
          </span>
        )}
      </div>

      {showTagline && (
        <span className="block text-[11px] font-mono text-[#525866] dark:text-slate-400 mt-1 tracking-wider uppercase truncate">
          {teamBrand?.mascotOrMotto
            ? teamBrand.mascotOrMotto
            : 'RUN & RIDE READINESS'}
        </span>
      )}
    </div>
  );
};

export const ThreshLogo = AeroPulseLogo;

/**
 * Subtle non-interactive T3 Stepped 4-Lane Track-Gauge watermark for hero cards
 */
export const ThreshBrandWatermark: React.FC<{ className?: string }> = ({
  className = 'w-36 h-36',
}) => (
  <svg
    viewBox="8 4 178 176"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`pointer-events-none select-none opacity-[0.045] dark:opacity-[0.065] ${className}`}
    aria-hidden="true"
  >
    <g fill="currentColor">
      {T3_TRACK_BASE_PATHS_SQUARE.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </g>
    <g fill="var(--ap-thresh-vermilion)">
      {T3_REDLINE_SECTOR_PATHS.map((d, i) => (
        <path key={i} d={d} />
      ))}
      <path fillRule="evenodd" clipRule="evenodd" d={T3_POINTER_EVENODD_PATH} />
    </g>
  </svg>
);
