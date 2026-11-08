import React from 'react';

interface AeroPulseLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  badgeText?: string;
  badgeTone?: 'cyan' | 'orange' | 'emerald';
}

export const AeroPulseLogo: React.FC<AeroPulseLogoProps> = ({
  size = 'md',
  showTagline = false,
  badgeText,
  badgeTone = 'cyan',
}) => {
  const boxClass =
    size === 'sm'
      ? 'w-7 h-7 rounded-lg'
      : size === 'lg'
        ? 'w-10 h-10 rounded-xl'
        : 'w-8 h-8 rounded-xl';

  const svgClass =
    size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-6 h-6' : 'w-5 h-5';

  const titleClass =
    size === 'sm'
      ? 'text-sm font-extrabold tracking-tight'
      : size === 'lg'
        ? 'text-lg sm:text-xl font-extrabold tracking-tight'
        : 'text-base sm:text-lg font-extrabold tracking-tight';

  const badgeToneClasses =
    badgeTone === 'orange'
      ? 'bg-[#F97316]/15 text-[#F97316] border-[#F97316]/40'
      : badgeTone === 'emerald'
        ? 'bg-[#10B981]/15 text-[#10B981] border-[#10B981]/40'
        : 'bg-[#38BDF8]/15 text-[#38BDF8] border-[#38BDF8]/40';

  return (
    <div className="inline-flex items-center gap-2.5 select-none">
      {/* Vector Pulse Crest */}
      <div
        className={`${boxClass} relative flex items-center justify-center bg-[#0B0F17] border border-sky-500/40 shadow-sm overflow-hidden shrink-0`}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-[#38BDF8]/25 via-transparent to-[#F97316]/25 pointer-events-none" />
        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`${svgClass} relative z-10`}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="ap-cyan-grad" x1="2" y1="4" x2="30" y2="28" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#38BDF8" />
              <stop offset="100%" stopColor="#0284C7" />
            </linearGradient>
            <linearGradient id="ap-orange-grad" x1="4" y1="24" x2="29" y2="8" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#F97316" />
              <stop offset="100%" stopColor="#FB923C" />
            </linearGradient>
          </defs>
          {/* Outer Aerodynamic Chevrons */}
          <path
            d="M5 22L12.5 7.5L17 16.5"
            stroke="url(#ap-cyan-grad)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* High-Frequency Pulse Wave */}
          <path
            d="M3.5 18.5H9L12.2 11L15.8 23.5L19.8 9.5L23 18.5H28.5"
            stroke="url(#ap-orange-grad)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Telemetry Apex Node */}
          <circle cx="19.8" cy="9.5" r="2" fill="#38BDF8" />
        </svg>
      </div>

      {/* Brand Wordmark & Optional Tagline */}
      <div className="leading-none">
        <div className="flex items-center gap-1.5">
          <span className={`${titleClass} text-slate-900 dark:text-white`}>
            Aero<span className="text-[#38BDF8]">Pulse</span>
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
          <span className="block text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
            PRECISION PHYSIOLOGY &amp; COACHING TELEMETRY
          </span>
        )}
      </div>
    </div>
  );
};
