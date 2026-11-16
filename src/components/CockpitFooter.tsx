import React from 'react';
import { AeroPulseLogo } from './AeroPulseLogo';

interface CockpitFooterProps {
  athleteFtp: number;
  onOpenProfile: () => void;
  onOpenDataSources: () => void;
  onOpenGuide: () => void;
  onOpenBrandStudio?: () => void;
}

export const CockpitFooter: React.FC<CockpitFooterProps> = ({
  athleteFtp,
  onOpenProfile,
  onOpenDataSources,
  onOpenGuide,
  onOpenBrandStudio,
}) => {
  return (
    <footer className="pt-5 border-t border-emerald-900/15 dark:border-[#244331] flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
      <div className="flex items-center gap-3">
        <AeroPulseLogo size="sm" />
        <span className="hidden sm:inline text-slate-600 dark:text-slate-400">·</span>
        <span className="hidden sm:inline font-mono text-2xs">
          Run &amp; Ride Threshold Telemetry
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4 font-medium">
        <button
          type="button"
          onClick={onOpenProfile}
          className="min-h-[44px] sm:min-h-0 inline-flex items-center hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
        >
          Zones &amp; FTP ({athleteFtp}W)
        </button>
        <button
          type="button"
          onClick={onOpenDataSources}
          className="min-h-[44px] sm:min-h-0 inline-flex items-center hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
        >
          Data Sources
        </button>
        <button
          type="button"
          onClick={onOpenGuide}
          className="min-h-[44px] sm:min-h-0 inline-flex items-center hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
        >
          Guide
        </button>
        <a
          href="/brand"
          onClick={(e) => {
            if (onOpenBrandStudio && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              onOpenBrandStudio();
            }
          }}
          className="min-h-[44px] sm:min-h-0 inline-flex items-center font-semibold ap-text-brand hover:underline cursor-pointer"
        >
          Brand &amp; Style Guide
        </a>
      </div>
    </footer>
  );
};
