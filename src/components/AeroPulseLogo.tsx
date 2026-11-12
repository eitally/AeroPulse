import React, { useId } from 'react';
import type { TeamBrandConfig } from '../types';
import { computeAccessibleTeamPalette } from '../physiology/teamOnboardingEngine';

interface AeroPulseLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  badgeText?: string;
  badgeTone?: 'volt' | 'cyan' | 'orange' | 'emerald';
  teamBrand?: TeamBrandConfig | null;
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [Number((cx + r * Math.cos(rad)).toFixed(2)), Number((cy + r * Math.sin(rad)).toFixed(2))];
}

/**
 * Watertight circular stadium lane with exact radial gauge cut at `endDeg`
 * and `-14°` velocity-sheared straightaway termination at `rightX`.
 */
function buildStadiumShearedLanePath(
  cx: number,
  cy: number,
  r: number,
  width: number,
  endDeg: number,
  rightX: number
): string {
  const hw = width / 2;
  const rOut = r + hw;
  const rIn = r - hw;
  const shear = 0.2493; // tan(14°)
  const yTop = Number((cy + rIn).toFixed(2));
  const yBot = Number((cy + rOut).toFixed(2));
  const xTopR = Number((rightX + hw * shear).toFixed(2));
  const xBotR = Number((rightX - hw * shear).toFixed(2));
  const [ox, oy] = polar(cx, cy, rOut, endDeg);
  const [ix, iy] = polar(cx, cy, rIn, endDeg);
  const delta = (((endDeg - 90) % 360) + 360) % 360;
  const largeArc = delta > 180 ? 1 : 0;
  return `M ${xBotR} ${yBot} L ${cx} ${yBot} A ${rOut} ${rOut} 0 ${largeArc} 1 ${ox} ${oy} L ${ix} ${iy} A ${rIn} ${rIn} 0 ${largeArc} 0 ${cx} ${yTop} L ${xTopR} ${yTop} Z`;
}

/**
 * Watertight radial gauge sector from `startDeg` clockwise to `endDeg`.
 */
function buildRadialSectorPath(
  cx: number,
  cy: number,
  r: number,
  width: number,
  startDeg: number,
  endDeg: number
): string {
  const hw = width / 2;
  const rOut = r + hw;
  const rIn = r - hw;
  const [ox1, oy1] = polar(cx, cy, rOut, startDeg);
  const [ox2, oy2] = polar(cx, cy, rOut, endDeg);
  const [ix2, iy2] = polar(cx, cy, rIn, endDeg);
  const [ix1, iy1] = polar(cx, cy, rIn, startDeg);
  const delta = (((endDeg - startDeg) % 360) + 360) % 360;
  const largeArc = delta > 180 ? 1 : 0;
  return `M ${ox1} ${oy1} A ${rOut} ${rOut} 0 ${largeArc} 1 ${ox2} ${oy2} L ${ix2} ${iy2} A ${rIn} ${rIn} 0 ${largeArc} 0 ${ix1} ${iy1} Z`;
}

/**
 * Watertight full-curve outer Lane-4 arrow starting radially at `endDeg` (348°),
 * wrapping 258° counter-clockwise around the stadium turn, and shooting straight
 * underneath THRESH into the V1 right-pointing spearhead.
 */
function buildFullWrapOuterArrowPath(
  cx: number,
  cy: number,
  r: number,
  width: number,
  endDeg: number,
  shaftEndX: number
): string {
  const hw = width / 2;
  const rOut = r + hw;
  const rIn = r - hw;
  const [ox, oy] = polar(cx, cy, rOut, endDeg);
  const [ix, iy] = polar(cx, cy, rIn, endDeg);
  const yTop = Number((cy + rIn).toFixed(2));
  const yBot = Number((cy + rOut).toFixed(2));
  return [
    `M ${ox} ${oy}`,
    `A ${rOut} ${rOut} 0 1 0 ${cx} ${yBot}`,
    `H ${shaftEndX}`,
    `L ${shaftEndX - 5.5} ${Number((cy + r + 11.8).toFixed(2))}`,
    `L ${shaftEndX + 21} ${cy + r}`,
    `L ${shaftEndX - 5.5} ${Number((cy + r - 11.8).toFixed(2))}`,
    `L ${shaftEndX} ${yTop}`,
    `H ${cx}`,
    `A ${rIn} ${rIn} 0 1 1 ${ix} ${iy}`,
    'Z',
  ].join(' ');
}

// Precomputed B3-3A + W1 Lockup Geometry (cx=64, cy=58, radii=[19, 30, 41, 52])
const LOCKUP_CX = 64;
const LOCKUP_CY = 58;
const LOCKUP_PINE_LANE_PATHS = [
  buildStadiumShearedLanePath(LOCKUP_CX, LOCKUP_CY, 19.0, 7.2, 241, 133.5),
  buildStadiumShearedLanePath(LOCKUP_CX, LOCKUP_CY, 30.0, 7.2, 259, 130.8),
  buildStadiumShearedLanePath(LOCKUP_CX, LOCKUP_CY, 41.0, 7.2, 277, 421.0),
];

const LOCKUP_INNER_THRESHOLD_PATHS = [
  buildRadialSectorPath(LOCKUP_CX, LOCKUP_CY, 19.0, 7.5, 248, 348),
  buildRadialSectorPath(LOCKUP_CX, LOCKUP_CY, 30.0, 7.5, 266, 348),
  buildRadialSectorPath(LOCKUP_CX, LOCKUP_CY, 41.0, 7.5, 284, 348),
];

const LOCKUP_FULL_LANE_4_ARROW_PATH = buildFullWrapOuterArrowPath(
  LOCKUP_CX,
  LOCKUP_CY,
  52.0,
  7.5,
  348,
  444
);

const [NEEDLE_TX, NEEDLE_TY] = polar(LOCKUP_CX, LOCKUP_CY, 51.8, 313);
const [NEEDLE_BX1, NEEDLE_BY1] = polar(LOCKUP_CX, LOCKUP_CY, 5.8, 223);
const [NEEDLE_BX2, NEEDLE_BY2] = polar(LOCKUP_CX, LOCKUP_CY, 5.8, 43);
const LOCKUP_GAUGE_WEDGE_PATH = `M ${NEEDLE_BX1} ${NEEDLE_BY1} L ${NEEDLE_TX} ${NEEDLE_TY} L ${NEEDLE_BX2} ${NEEDLE_BY2} Z`;
const [TICK_X1, TICK_Y1] = polar(LOCKUP_CX, LOCKUP_CY, 14, 355);
const [TICK_X2, TICK_Y2] = polar(LOCKUP_CX, LOCKUP_CY, 56, 355);

// W1 Nested Track-Grid Wordmark Paths (0px vertical split offset, overhanging aero T, stadium R & S)
const W1_WORDMARK_PATHS = [
  'M -6 0 H 39 L 36.2 13.8 H 26 V 64 H 12 V 13.8 H -8.8 Z',
  'M 43 0 H 57 V 25.2 H 69 V 0 H 83 V 64 H 69 V 38.4 H 57 V 64 H 43 Z',
  'M 90 0 H 118.5 C 128.4 0 133.5 5.8 133.5 16.8 C 133.5 25.4 129.2 31.2 121.6 33.6 L 134.2 64 H 118.8 L 107.6 35.6 H 104 V 64 H 90 Z M 104 11.2 V 24.2 H 115.2 C 118.2 24.2 119.6 22.0 119.6 17.7 C 119.6 13.4 118.2 11.2 115.2 11.2 Z',
  'M 139 0 H 177 L 174.4 13.0 H 153 V 25.4 H 173 L 170.6 37.8 H 153 V 51.0 H 176.5 L 174.0 64 H 139 Z',
  'M 181 17.2 C 181 6.4 188.0 0 200.6 0 H 208.6 C 217.8 0 222.5 5.2 222.5 14.2 V 17.5 H 208.6 V 14.4 C 208.6 11.8 206.8 10.6 203.4 10.6 H 199.4 C 196.2 10.6 194.6 12.2 194.6 15.6 C 194.6 19.6 197.4 21.8 209.6 26.2 C 218.8 29.5 222.8 34.8 222.8 45.8 C 222.8 57.6 215.8 64 203.2 64 H 195.2 C 185.8 64 181 58.6 181 49.2 V 45.8 H 194.8 V 49.2 C 194.8 52.0 196.6 53.4 200.0 53.4 H 204.2 C 207.4 53.4 209.0 51.6 209.0 47.6 C 209.0 43.2 206.2 40.8 194.0 36.4 C 184.8 33.0 181 27.6 181 17.2 Z',
  'M 228 0 H 242 V 25.2 H 254 V 0 H 268 V 64 H 254 V 38.4 H 242 V 64 H 228 Z',
];

// Precomputed Pure Interior Gauge Geometry for Square Icon / Favicon (128x128 optically centered at 64, 71.5)
const ICON_CX = 64;
const ICON_CY = 71.5;
const ICON_PINE_SECTORS = [
  buildRadialSectorPath(ICON_CX, ICON_CY, 19.5, 7.6, 134, 238),
  buildRadialSectorPath(ICON_CX, ICON_CY, 31.5, 7.6, 134, 258),
  buildRadialSectorPath(ICON_CX, ICON_CY, 43.5, 7.6, 134, 278),
];
const ICON_VOLT_SECTORS = [
  buildRadialSectorPath(ICON_CX, ICON_CY, 19.5, 7.8, 246, 348),
  buildRadialSectorPath(ICON_CX, ICON_CY, 31.5, 7.8, 266, 348),
  buildRadialSectorPath(ICON_CX, ICON_CY, 43.5, 7.8, 286, 348),
  // Outermost 4th lane wraps continuously from 134° around to 348°, mirroring B3-3A's full-wrap outer lane
  buildRadialSectorPath(ICON_CX, ICON_CY, 55.5, 8.0, 134, 348),
];
const [ICON_NTX, ICON_NTY] = polar(ICON_CX, ICON_CY, 56.0, 313);
const [ICON_NBX1, ICON_NBY1] = polar(ICON_CX, ICON_CY, 6.8, 223);
const [ICON_NBX2, ICON_NBY2] = polar(ICON_CX, ICON_CY, 6.8, 43);
const ICON_NEEDLE_PATH = `M ${ICON_NBX1} ${ICON_NBY1} L ${ICON_NTX} ${ICON_NTY} L ${ICON_NBX2} ${ICON_NBY2} Z`;
const [ICON_TX1, ICON_TY1] = polar(ICON_CX, ICON_CY, 14.5, 356);

/**
 * Full Custom THRESH Vector Lockup SVG:
 * B3-3A Smooth 4-Lane Stadium Gauge (1 visible darker Pine straightaway lane + full-wrap outer Volt arrow lane
 * + prominent cased B3 wedge needle) × W1 Nested Track-Grid Wordmark with G1 White→Volt Velocity Sweep.
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
  const rawId = useId();
  const gradId = `thresh-g1-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const themeVarsClass = isTeamOverride
    ? '[--thresh-pine:#334155] dark:[--thresh-pine:#64748B] [--thresh-casing:#FFFFFF] dark:[--thresh-casing:#101814] [--thresh-pin:#FFFFFF] dark:[--thresh-pin:#0E1912] [--thresh-g1-start:#0E1912] dark:[--thresh-g1-start:#F6FBF7]'
    : '[--thresh-pine:#1C5436] dark:[--thresh-pine:#399663] [--thresh-volt:#56BA00] dark:[--thresh-volt:#C8FF00] [--thresh-casing:#FFFFFF] dark:[--thresh-casing:#101814] [--thresh-pin:#FFFFFF] dark:[--thresh-pin:#0E1912] [--thresh-g1-0:#0E2619] [--thresh-g1-1:#185230] [--thresh-g1-2:#2E801E] [--thresh-g1-3:#4BA800] dark:[--thresh-g1-0:#F6FBF7] dark:[--thresh-g1-1:#E8FFD1] dark:[--thresh-g1-2:#D4FF38] dark:[--thresh-g1-3:#C8FF00]';

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
      <defs>
        {isTeamOverride ? (
          <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1="-6" y1="0" x2="268" y2="0">
            <stop offset="0%" style={{ stopColor: 'var(--thresh-g1-start)' }} />
            <stop offset="52%" style={{ stopColor: 'var(--thresh-g1-start)' }} />
            <stop offset="100%" style={{ stopColor: accentColor }} />
          </linearGradient>
        ) : (
          <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1="-6" y1="0" x2="268" y2="0">
            <stop offset="0%" style={{ stopColor: 'var(--thresh-g1-0)' }} />
            <stop offset="38%" style={{ stopColor: 'var(--thresh-g1-1)' }} />
            <stop offset="72%" style={{ stopColor: 'var(--thresh-g1-2)' }} />
            <stop offset="100%" style={{ stopColor: 'var(--thresh-g1-3)' }} />
          </linearGradient>
        )}
      </defs>

      {/* Darker Stadium Pine Base Lanes (Lanes 1 & 2 tuck beside T; Lane 3 runs full-width under THRESH) */}
      <g fill="var(--thresh-pine)">
        {LOCKUP_PINE_LANE_PATHS.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>

      {/* Stepped Inner Threshold Sectors + Continuous Full-Wrap Outer Lane-4 Arrow */}
      <g fill={activeGaugeColor}>
        {LOCKUP_INNER_THRESHOLD_PATHS.map((d, i) => (
          <path key={i} d={d} />
        ))}
        <path d={LOCKUP_FULL_LANE_4_ARROW_PATH} />
      </g>

      {/* Calibrated 355° Boundary Tick + Prominent Cased B3 Gauge Wedge Needle */}
      <line
        x1={TICK_X1}
        y1={TICK_Y1}
        x2={TICK_X2}
        y2={TICK_Y2}
        stroke={activeGaugeColor}
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <path
        d={LOCKUP_GAUGE_WEDGE_PATH}
        fill={activeGaugeColor}
        stroke="var(--thresh-casing)"
        strokeWidth="6"
        strokeLinejoin="round"
        style={{ paintOrder: 'stroke fill' }}
      />
      <circle
        cx={LOCKUP_CX}
        cy={LOCKUP_CY}
        r="9.8"
        fill={activeGaugeColor}
        stroke="var(--thresh-casing)"
        strokeWidth="3.8"
        style={{ paintOrder: 'stroke fill' }}
      />
      <circle cx={LOCKUP_CX} cy={LOCKUP_CY} r="3.6" fill="var(--thresh-pin)" />

      {/* W1 Nested Track-Grid Wordmark with G1 Horizontal Velocity Gradient */}
      <g transform="translate(144, 8) skewX(-14) scale(1.10, 1.29)" fill={`url(#${gradId})`}>
        {W1_WORDMARK_PATHS.map((d, i) => (
          <path
            key={i}
            d={d}
            fillRule={i === 2 ? 'evenodd' : undefined}
            clipRule={i === 2 ? 'evenodd' : undefined}
          />
        ))}
      </g>
    </svg>
  );
};

/**
 * Pure THRESH Gauge Square Icon Mark (mirrors the interior of the full B3-3A logo for compact badges & avatars).
 */
export const ThreshSquareTrackIcon: React.FC<{
  className?: string;
  accentColor?: string;
  isTeamOverride?: boolean;
}> = ({ className = 'w-8 h-8', accentColor = '#C8FF00', isTeamOverride = false }) => {
  const activeVolt = isTeamOverride ? accentColor : '#C8FF00';
  const pineColor = isTeamOverride ? '#64748B' : '#399663';

  return (
    <svg
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="2"
        y="2"
        width="124"
        height="124"
        rx="28"
        fill="#0B1911"
        stroke="#399663"
        strokeWidth="3.5"
      />
      <g transform="translate(64 66) scale(0.84) translate(-64 -70)">
        <g fill={pineColor}>
          {ICON_PINE_SECTORS.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        <g fill={activeVolt}>
          {ICON_VOLT_SECTORS.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        <line
          x1={ICON_TX1}
          y1={ICON_TY1}
          x2={120.5}
          y2={67.55}
          stroke={activeVolt}
          strokeWidth="4.2"
          strokeLinecap="round"
        />
        <path
          d={ICON_NEEDLE_PATH}
          fill={activeVolt}
          stroke="#0B1911"
          strokeWidth="7.4"
          strokeLinejoin="round"
          style={{ paintOrder: 'stroke fill' }}
        />
        <circle
          cx={ICON_CX}
          cy={ICON_CY}
          r="11.8"
          fill={activeVolt}
          stroke="#0B1911"
          strokeWidth="4.6"
          style={{ paintOrder: 'stroke fill' }}
        />
        <circle cx={ICON_CX} cy={ICON_CY} r="4.5" fill="#0B1911" />
      </g>
    </svg>
  );
};

/**
 * THRESH — Sitewide Brand Lockup & Dynamic Team Co-Branded Header
 * - Standalone: Renders the B3-3A × W1 Nested Track-Grid × G1 Velocity-Sweep lockup.
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
      ? 'h-8 sm:h-[38px] w-auto'
      : size === 'lg'
        ? 'h-12 sm:h-14 w-auto'
        : 'h-10 sm:h-11 w-auto';

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
          {teamBrand?.mascotOrMotto ? teamBrand.mascotOrMotto : 'RUN & RIDE READINESS'}
        </span>
      )}
    </div>
  );
};

export const ThreshLogo = AeroPulseLogo;

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
    className={`pointer-events-none select-none opacity-[0.13] dark:opacity-[0.22] ${className}`}
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
