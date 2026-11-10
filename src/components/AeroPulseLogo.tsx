import React from 'react';

interface AeroPulseLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  badgeText?: string;
  badgeTone?: 'cyan' | 'orange' | 'emerald';
}

/**
 * THRESH — "The Deflection Arc" Brand Mark & Solid Wordmark
 * Bold 270° open aerobic arc in Deep Ink (#111318 / #F4F5F7) paired with a
 * single-color Thresh Vermilion (#D9480F / #FB6514) S-curve tangent sweeping
 * cleanly through the open 2-o'clock threshold breach.
 */
export const AeroPulseLogo: React.FC<AeroPulseLogoProps> = ({
  size = 'md',
  showTagline = false,
  badgeText,
  badgeTone = 'cyan',
}) => {
  const boxClass =
    size === 'sm'
      ? 'w-8 h-8 rounded-xl'
      : size === 'lg'
        ? 'w-11 h-11 rounded-2xl'
        : 'w-9 h-9 rounded-xl';

  const svgClass =
    size === 'sm' ? 'w-5 h-5' : size === 'lg' ? 'w-7 h-7' : 'w-6 h-6';

  const titleClass =
    size === 'sm'
      ? 'text-sm sm:text-base font-extrabold tracking-[-0.03em]'
      : size === 'lg'
        ? 'text-xl sm:text-2xl font-extrabold tracking-[-0.03em]'
        : 'text-base sm:text-lg font-extrabold tracking-[-0.03em]';

  // WCAG 2.1 AA+ high-contrast semantic badge tokens (>= 4.5:1 on white)
  const badgeToneClasses =
    badgeTone === 'orange'
      ? 'bg-[#FFF4ED] dark:bg-[#FB6514]/15 text-[#B93800] dark:text-[#FB923C] border-[#FDBA74] dark:border-[#FB6514]/35'
      : badgeTone === 'emerald'
        ? 'bg-[#ECFDF5] dark:bg-emerald-500/15 text-[#065F46] dark:text-emerald-300 border-[#A7F3D0] dark:border-emerald-500/35'
        : 'bg-[#EFF6FF] dark:bg-blue-500/15 text-[#1D4ED8] dark:text-[#60A5FA] border-[#BFDBFE] dark:border-blue-400/35';

  return (
    <div className="inline-flex items-center gap-2.5 select-none">
      {/* Deflection Arc App Mark */}
      <div
        className={`${boxClass} relative flex items-center justify-center bg-white dark:bg-[#121419] border border-black/10 dark:border-white/12 shadow-2xs overflow-hidden shrink-0 transition-colors`}
      >
        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`${svgClass} relative z-10`}
          aria-hidden="true"
        >
          {/* 270° Open Aerobic Arc (open breach at 12:00–2:30) */}
          <path
            d="M 16 5.2 A 10.8 10.8 0 1 0 25.35 10.6"
            className="stroke-[#111318] dark:stroke-[#F4F5F7]"
            strokeWidth="3.1"
            strokeLinecap="round"
          />
          {/* Thresh Vermilion Physiological S-Curve Sweeping Through Open Breach */}
          <path
            d="M 8.6 22.8 C 13.8 22.8 14.8 18.2 16.4 15.2 C 18.0 12.2 20.4 7.0 26.6 6.4"
            className="stroke-[#D9480F] dark:stroke-[#FB6514]"
            strokeWidth="3.1"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* Solid THRESH Wordmark & Optional Descriptor */}
      <div className="leading-none">
        <div className="flex items-center gap-1.5">
          <span className={`${titleClass} font-display text-[#111318] dark:text-[#F4F5F7]`}>
            THRESH
          </span>
          {badgeText && (
            <span
              className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold uppercase tracking-wider border ${badgeToneClasses}`}
            >
              {badgeText}
            </span>
          )}
        </div>
        {showTagline && (
          <span className="block text-[11px] font-mono text-[#525866] dark:text-slate-400 mt-0.5 tracking-wider uppercase">
            RUN &amp; RIDE READINESS
          </span>
        )}
      </div>
    </div>
  );
};

export const ThreshLogo = AeroPulseLogo;

/**
 * Subtle non-interactive THRESH Deflection Arc watermark for hero cards
 */
export const ThreshBrandWatermark: React.FC<{ className?: string }> = ({
  className = 'w-36 h-36',
}) => (
  <svg
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`pointer-events-none select-none opacity-[0.04] dark:opacity-[0.06] ${className}`}
    aria-hidden="true"
  >
    <path
      d="M 32 10.4 A 21.6 21.6 0 1 0 50.7 21.2"
      stroke="currentColor"
      strokeWidth="6"
      strokeLinecap="butt"
    />
    <path
      d="M 17.2 45.6 C 27.6 45.6 29.6 36.4 32.8 30.4 C 36.0 24.4 40.8 14.0 53.2 12.8"
      stroke="#D9480F"
      strokeWidth="6"
      strokeLinecap="butt"
    />
  </svg>
);
