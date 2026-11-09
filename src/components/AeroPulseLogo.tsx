import React, { useId } from 'react';

interface AeroPulseLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  badgeText?: string;
  badgeTone?: 'cyan' | 'orange' | 'emerald';
}

/**
 * THRESH — "01: The Inflection Ring" Brand Mark & Wordmark
 * Models the physiological S-curve shared by runners (Lactate Threshold Pace)
 * and cyclists (FTP deflection) crossing the aerobic ring into Signal Orange.
 * Automatically adapts to a Pure White badge in Light Mode and Obsidian in Dark Mode.
 */
export const AeroPulseLogo: React.FC<AeroPulseLogoProps> = ({
  size = 'md',
  showTagline = false,
  badgeText,
  badgeTone = 'cyan',
}) => {
  const gradId = useId();
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
      ? 'text-sm sm:text-base font-black tracking-tight'
      : size === 'lg'
        ? 'text-xl sm:text-2xl font-black tracking-tight'
        : 'text-base sm:text-lg font-black tracking-tight';

  const badgeToneClasses =
    badgeTone === 'orange'
      ? 'bg-[#EA580C]/10 text-[#EA580C] border-[#EA580C]/30'
      : badgeTone === 'emerald'
        ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/30'
        : 'bg-[#0B4F9E]/10 dark:bg-[#38BDF8]/15 text-[#0B4F9E] dark:text-[#38BDF8] border-[#0B4F9E]/25 dark:border-[#38BDF8]/35';

  return (
    <div className="inline-flex items-center gap-2.5 select-none">
      {/* Adaptive Vector Inflection Ring Badge (Pure White in Light Mode, Obsidian in Dark Mode) */}
      <div
        className={`${boxClass} relative flex items-center justify-center bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-sky-500/30 shadow-2xs overflow-hidden shrink-0 transition-colors`}
      >
        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`${svgClass} relative z-10`}
          aria-hidden="true"
        >
          <defs>
            <linearGradient
              id={gradId}
              x1="4"
              y1="24"
              x2="28"
              y2="8"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#0B4F9E" />
              <stop offset="48%" stopColor="#0284C7" />
              <stop offset="68%" stopColor="#EA580C" />
              <stop offset="100%" stopColor="#F97316" />
            </linearGradient>
          </defs>
          {/* Outer Aerobic Base Ring */}
          <circle
            cx="16"
            cy="16"
            r="10.2"
            className="stroke-[#0B4F9E] dark:stroke-[#38BDF8]"
            strokeWidth="3.2"
          />
          {/* White / Obsidian Knockout Halo for Crisp Crossover */}
          <path
            d="M3.5 23.5C11 23.5 13.5 19.5 16 16C18.5 12.5 21 8.5 28.5 8.5"
            className="stroke-white dark:stroke-[#0B0F17]"
            strokeWidth="5.4"
            strokeLinecap="round"
          />
          {/* Lactate / Power Threshold S-Curve Inflection */}
          <path
            d="M3.5 23.5C11 23.5 13.5 19.5 16 16C18.5 12.5 21 8.5 28.5 8.5"
            stroke={`url(#${gradId})`}
            strokeWidth="3.5"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* THRESH Brand Wordmark & Optional Tagline */}
      <div className="leading-none">
        <div className="flex items-center gap-1.5">
          <span className={`${titleClass} font-display text-slate-900 dark:text-white`}>
            THR<span className="text-[#EA580C]">ESH</span>
          </span>
          {badgeText && (
            <span
              className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider border ${badgeToneClasses}`}
            >
              {badgeText}
            </span>
          )}
        </div>
        {showTagline && (
          <span className="block text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-0.5 tracking-wider uppercase">
            RUN &amp; RIDE THRESHOLD INTELLIGENCE
          </span>
        )}
      </div>
    </div>
  );
};

/**
 * Subtle non-interactive THRESH Inflection Ring watermark for hero cards
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
    <circle cx="32" cy="32" r="21" stroke="currentColor" strokeWidth="5.5" />
    <path
      d="M6 47C22 47 27 39 32 32C37 25 42 17 58 17"
      stroke="#EA580C"
      strokeWidth="6"
      strokeLinecap="round"
    />
  </svg>
);
