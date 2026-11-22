import React from 'react';
import { AeroPulseLogo } from './AeroPulseLogo';

interface CockpitFooterProps {
  athleteFtp: number;
  hideCyclingFtpLabel?: boolean;
  onOpenProfile: () => void;
  onOpenDataSources: () => void;
  onOpenGuide: () => void;
  onOpenBrandStudio?: () => void;
}

export const CockpitFooter: React.FC<CockpitFooterProps> = ({
  athleteFtp,
  hideCyclingFtpLabel = false,
  onOpenProfile,
  onOpenDataSources,
  onOpenGuide,
  onOpenBrandStudio,
}) => {
  return (
    <footer className="pt-5 pb-2 border-t border-emerald-200/20 dark:border-[#244331] flex flex-wrap items-center justify-between gap-3 text-xs text-emerald-100/80 dark:text-slate-300">
      <div className="flex items-center gap-3">
        <AeroPulseLogo size="sm" surface="on-dark" />
        <span className="hidden sm:inline text-emerald-200/55 dark:text-slate-400">·</span>
        <span className="hidden sm:inline font-mono text-2xs text-emerald-100/75 dark:text-slate-400">
          Track, Field &amp; Cross Country Team Platform · Zero Ads · Not medical advice
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4 font-medium">
        <button
          type="button"
          onClick={onOpenProfile}
          className="min-h-[44px] sm:min-h-0 inline-flex items-center text-emerald-50/85 hover:text-white dark:text-slate-300 dark:hover:text-white transition-colors cursor-pointer"
        >
          {hideCyclingFtpLabel ? 'Profile & Zones' : `Zones & FTP (${athleteFtp}W)`}
        </button>
        <button
          type="button"
          onClick={onOpenDataSources}
          className="min-h-[44px] sm:min-h-0 inline-flex items-center text-emerald-50/85 hover:text-white dark:text-slate-300 dark:hover:text-white transition-colors cursor-pointer"
        >
          Data Sources
        </button>
        <button
          type="button"
          onClick={onOpenGuide}
          className="min-h-[44px] sm:min-h-0 inline-flex items-center text-emerald-50/85 hover:text-white dark:text-slate-300 dark:hover:text-white transition-colors cursor-pointer"
        >
          Guide
        </button>
        <a
          href="/privacy"
          className="min-h-[44px] sm:min-h-0 inline-flex items-center text-emerald-50/85 hover:text-white dark:text-slate-300 dark:hover:text-white transition-colors"
        >
          Privacy
        </a>
        <a
          href="/terms"
          className="min-h-[44px] sm:min-h-0 inline-flex items-center text-emerald-50/85 hover:text-white dark:text-slate-300 dark:hover:text-white transition-colors"
        >
          Terms
        </a>
        <a
          href="/for-athletic-directors"
          className="min-h-[44px] sm:min-h-0 inline-flex items-center text-emerald-50/85 hover:text-white dark:text-slate-300 dark:hover:text-white transition-colors"
        >
          For ADs
        </a>
        <a
          href="/procurement"
          className="min-h-[44px] sm:min-h-0 inline-flex items-center text-emerald-50/85 hover:text-white dark:text-slate-300 dark:hover:text-white transition-colors"
        >
          Schools &amp; NCAA
        </a>
        <a
          href="/brand"
          onClick={(e) => {
            if (onOpenBrandStudio && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              onOpenBrandStudio();
            }
          }}
          className="min-h-[44px] sm:min-h-0 inline-flex items-center font-semibold text-[#C8FF00] hover:underline cursor-pointer"
        >
          Brand &amp; Style Guide
        </a>
      </div>
    </footer>
  );
};
