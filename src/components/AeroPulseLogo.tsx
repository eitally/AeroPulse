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
 * Bold High-Visibility SVG Geometry Constants for THRESH:
 * T3 (4-Lane Muscular Stadium Track Gauge, 11.0u lanes / 5.2u crisp channels)
 * × Velocity Spur + Bold V1 Laser Spearhead
 */
const T3_TRACK_BASE_PATHS_LOCKUP = [
  'M 438.4 143 L 98 143 A 47 47 0 0 1 91.46 49.46 L 92.99 60.35 A 36 36 0 0 0 98 132 L 441.65 132 Z',
  'M 433.6 159.2 L 98 159.2 A 63.2 63.2 0 1 1 108.97 33.76 L 107.06 44.59 A 52.2 52.2 0 1 0 98 148.2 L 436.86 148.2 Z',
  'M 428.8 175.4 L 98 175.4 A 79.4 79.4 0 1 1 135.28 25.89 L 130.11 35.61 A 68.4 68.4 0 1 0 98 164.4 L 432.06 164.4 Z',
  'M 424 191.6 L 98 191.6 A 95.6 95.6 0 1 1 166.77 29.59 L 158.86 37.23 A 84.6 84.6 0 1 0 98 180.6 L 427.26 180.6 Z',
];

const T3_TRACK_BASE_PATHS_SQUARE = [
  'M 188.4 143 L 98 143 A 47 47 0 0 1 91.46 49.46 L 92.99 60.35 A 36 36 0 0 0 98 132 L 191.65 132 Z',
  'M 183.6 159.2 L 98 159.2 A 63.2 63.2 0 1 1 108.97 33.76 L 107.06 44.59 A 52.2 52.2 0 1 0 98 148.2 L 186.86 148.2 Z',
  'M 178.8 175.4 L 98 175.4 A 79.4 79.4 0 1 1 135.28 25.89 L 130.11 35.61 A 68.4 68.4 0 1 0 98 164.4 L 182.06 164.4 Z',
  'M 174 191.6 L 98 191.6 A 95.6 95.6 0 1 1 166.77 29.59 L 158.86 37.23 A 84.6 84.6 0 1 0 98 180.6 L 177.26 180.6 Z',
];

const T3_REDLINE_SECTOR_PATHS = [
  'M 99.64 49.03 A 47 47 0 0 1 145 96 L 134 96 A 36 36 0 0 0 99.26 60.02 Z',
  'M 119.62 36.61 A 63.2 63.2 0 0 1 161.2 96 L 150.2 96 A 52.2 52.2 0 0 0 115.85 46.95 Z',
  'M 146.88 33.43 A 79.4 79.4 0 0 1 177.4 96 L 166.4 96 A 68.4 68.4 0 0 0 140.11 42.1 Z',
  'M 177.26 42.54 A 95.6 95.6 0 0 1 193.6 96 L 182.6 96 A 84.6 84.6 0 0 0 168.14 48.69 Z',
];

// Single watertight evenodd path: Bold Center Hub (r=15) + 312° Pointer + Transparent Axle Hole (r=5.2)
const T3_POINTER_EVENODD_PATH =
  'M 112.3 91.47 A 15 15 0 1 1 101.01 81.3 L 118.28 69.59 L 122.15 73.07 Z M 103.2 96 A 5.2 5.2 0 1 0 92.8 96 A 5.2 5.2 0 1 0 103.2 96 Z';

// Velocity Spur Wordmark + Bold V1 Laser Spearhead
const VELOCITY_SPUR_UPPER_PATHS = [
  'M -8 0 H 31.2 L 28.6 10.2 H 17.4 V 22.8 H 5.4 V 10.2 H -5.2 Z',
  'M 32.5 0 H 47.0 V 19.2 H 56.2 V 0 H 67.6 V 22.8 H 35.6 V 6.2 Z',
  'M 71.5 0 H 96.2 C 104.8 0 109.4 4.4 109.4 12.0 C 109.4 19.0 105.0 22.6 97.6 22.8 H 74.6 V 6.2 Z M 86.2 8.4 V 16.4 H 95.0 C 97.6 16.4 98.8 15.0 98.8 12.4 C 98.8 9.8 97.6 8.4 95.0 8.4 Z',
  'M 112.5 0 H 146.0 L 143.6 9.6 H 126.8 V 19.2 H 142.0 V 22.8 H 115.6 V 6.2 Z',
  'M 182.0 13.6 H 171.0 V 11.2 C 171.0 9.2 169.5 8.0 167.0 8.0 H 161.5 C 159.2 8.0 158.0 9.2 158.0 11.5 C 158.0 14.2 159.8 15.6 171.5 18.8 C 175.8 20.0 178.6 21.4 180.2 22.8 H 159.8 C 151.6 20.6 148.0 17.2 148.0 11.5 C 148.0 4.5 153.2 0 161.2 0 H 168.8 C 177.2 0 182.0 4.6 182.0 12.0 Z',
  'M 184.2 0 H 198.6 V 19.2 H 208.0 V 0 H 219.4 V 22.8 H 187.4 V 6.2 Z',
];

const VELOCITY_SPUR_LOWER_PATHS = [
  'M 5.4 30.2 H 17.4 V 54 H 5.4 Z',
  'M 35.6 30.2 H 67.6 V 54 H 56.2 V 34.4 H 47.0 V 54 H 35.6 Z',
  'M 74.6 30.2 H 86.2 V 54 H 74.6 Z M 89.4 30.2 H 101.2 L 110.2 54 H 98.4 Z',
  'M 115.6 30.2 H 142.0 V 33.6 H 126.8 V 44.4 H 146.0 L 143.6 54 H 115.6 Z',
  'M 149.8 30.2 H 170.2 C 178.4 32.4 182.2 36.0 182.2 42.2 C 182.2 49.4 177.0 54.0 168.6 54.0 H 161.0 C 152.8 54.0 148.0 49.4 148.0 41.8 V 39.8 H 158.8 V 42.4 C 158.8 44.6 160.2 45.8 162.8 45.8 H 168.0 C 170.5 45.8 171.8 44.6 171.8 42.2 C 171.8 39.4 169.8 38.0 158.2 34.8 C 154.0 33.6 151.4 32.0 149.8 30.2 Z',
  'M 187.4 30.2 H 219.4 V 54 H 208.0 V 34.4 H 198.6 V 54 H 187.4 Z',
];

const V1_LASER_SPEARHEAD_PATH =
  'M -12 24.1 H 224.2 L 219.5 15.2 L 238.8 26.5 L 219.5 37.8 L 224.2 28.9 H -14 Z';

/**
 * Full Custom THRESH Vector Lockup SVG (Bold T3 4-Lane Track Gauge × Velocity Spur + V1 Spearhead).
 * Standalone mode renders Electric Track Volt (`#C8FF00`) with a crisp dark casing in Light Mode
 * so Electric Volt pops vividly on white AND obsidian headers; Team mode uses `accentColor`.
 */
export const ThreshFullVectorLockup: React.FC<{
  className?: string;
  accentColor?: string;
  isTeamOverride?: boolean;
  ariaLabel?: string;
}> = ({
  className = 'h-9 w-auto',
  accentColor = '#C8FF00',
  isTeamOverride = false,
  ariaLabel = 'THRESH',
}) => {
  const voltStrokeClass = isTeamOverride
    ? ''
    : '[paint-order:stroke_fill] stroke-[#101411] stroke-[2.8px] [stroke-linejoin:round] dark:stroke-none';

  return (
    <svg
      viewBox="0 -2 458 196"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={ariaLabel}
    >
      {/* 4-Lane Bold Stepped-Zone Stadium Track Curve + 16.5° Sheared Straightaway */}
      <g fill="currentColor">
        {T3_TRACK_BASE_PATHS_LOCKUP.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <g fill={accentColor} className={voltStrokeClass}>
        {T3_REDLINE_SECTOR_PATHS.map((d, i) => (
          <path key={i} d={d} />
        ))}
        <path fillRule="evenodd" clipRule="evenodd" d={T3_POINTER_EVENODD_PATH} />
      </g>

      {/* Velocity Spur Custom Split Wordmark + Bold V1 Laser Spearhead */}
      <g transform="translate(208, 66) skewX(-16.5) scale(1.06)">
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
        <path d={V1_LASER_SPEARHEAD_PATH} fill={accentColor} className={voltStrokeClass} />
      </g>
    </svg>
  );
};

/**
 * Square Bold T3 4-Lane Stepped Track-Gauge Icon Mark (for compact badges, avatars & watermarks)
 */
export const ThreshSquareTrackIcon: React.FC<{
  className?: string;
  accentColor?: string;
  isTeamOverride?: boolean;
}> = ({ className = 'w-8 h-8', accentColor = '#C8FF00', isTeamOverride = false }) => {
  const voltStrokeClass = isTeamOverride
    ? ''
    : '[paint-order:stroke_fill] stroke-[#101411] stroke-[2.8px] [stroke-linejoin:round] dark:stroke-none';

  return (
    <svg
      viewBox="0 -2 198 196"
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
      <g fill={accentColor} className={voltStrokeClass}>
        {T3_REDLINE_SECTOR_PATHS.map((d, i) => (
          <path key={i} d={d} />
        ))}
        <path fillRule="evenodd" clipRule="evenodd" d={T3_POINTER_EVENODD_PATH} />
      </g>
    </svg>
  );
};

/**
 * THRESH — Sitewide Brand Lockup & Dynamic Team Co-Branded Header
 * - Standalone: Renders the bold T3 4-Lane Stepped Track Gauge × Velocity Spur (V1 Spearhead) lockup in Electric Volt.
 * - Active Team: Renders `[Team Crest / Monogram] <SHORT NAME> × [Team-Colored THRESH Lockup]`
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
      ? 'h-9 sm:h-10 w-auto'
      : size === 'lg'
        ? 'h-14 sm:h-16 w-auto'
        : 'h-11 sm:h-12 w-auto';

  const cobrandSvgHeightClass =
    size === 'sm'
      ? 'h-7 sm:h-8 w-auto'
      : size === 'lg'
        ? 'h-10 sm:h-12 w-auto'
        : 'h-8 sm:h-9 w-auto';

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
              isTeamOverride
              ariaLabel={`${teamBrand.shortName || teamBrand.name} on THRESH`}
            />
          </>
        ) : (
          <ThreshFullVectorLockup
            className={`${standaloneSvgHeightClass} shrink-0`}
            accentColor="#C8FF00"
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
        <span className="block text-[11px] font-mono text-[#3F6212] dark:text-[#C8FF00] font-semibold mt-1 tracking-wider uppercase truncate">
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
 * Bold non-interactive T3 Stepped 4-Lane Track-Gauge watermark for hero cards
 */
export const ThreshBrandWatermark: React.FC<{ className?: string }> = ({
  className = 'w-36 h-36',
}) => (
  <svg
    viewBox="0 -2 198 196"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`pointer-events-none select-none opacity-[0.075] dark:opacity-[0.095] ${className}`}
    aria-hidden="true"
  >
    <g fill="currentColor">
      {T3_TRACK_BASE_PATHS_SQUARE.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </g>
    <g fill="#84CC16" className="dark:fill-[#C8FF00]">
      {T3_REDLINE_SECTOR_PATHS.map((d, i) => (
        <path key={i} d={d} />
      ))}
      <path fillRule="evenodd" clipRule="evenodd" d={T3_POINTER_EVENODD_PATH} />
    </g>
  </svg>
);
