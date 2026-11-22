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
    <footer className="pt-5 pb-2 border-t border-ap-frame/15 dark:border-white/15 flex flex-wrap items-center justify-between gap-3 text-xs text-ap-muted dark:text-ap-muted-dark">
      <div className="flex items-center gap-3">
        <AeroPulseLogo size="sm" surface="auto" />
        <span className="hidden sm:inline opacity-45">·</span>
        <span className="hidden sm:inline font-mono text-2xs text-ap-muted dark:text-ap-muted-dark">
          Track, Field &amp; Cross Country Team Platform · Zero Ads · Not medical advice
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4 font-medium">
        <button
          type="button"
          onClick={onOpenProfile}
          className="min-h-[44px] sm:min-h-0 inline-flex items-center text-ap-muted hover:text-ap-ink dark:text-ap-muted-dark dark:hover:text-ap-chalk transition-colors cursor-pointer"
        >
          {hideCyclingFtpLabel ? 'Profile & Zones' : `Zones & FTP (${athleteFtp}W)`}
        </button>
        <button
          type="button"
          onClick={onOpenDataSources}
          className="min-h-[44px] sm:min-h-0 inline-flex items-center text-ap-muted hover:text-ap-ink dark:text-ap-muted-dark dark:hover:text-ap-chalk transition-colors cursor-pointer"
        >
          Data Sources
        </button>
        <button
          type="button"
          onClick={onOpenGuide}
          className="min-h-[44px] sm:min-h-0 inline-flex items-center text-ap-muted hover:text-ap-ink dark:text-ap-muted-dark dark:hover:text-ap-chalk transition-colors cursor-pointer"
        >
          Guide
        </button>
        <a
          href="/privacy"
          className="min-h-[44px] sm:min-h-0 inline-flex items-center text-ap-muted hover:text-ap-ink dark:text-ap-muted-dark dark:hover:text-ap-chalk transition-colors"
        >
          Privacy
        </a>
        <a
          href="/terms"
          className="min-h-[44px] sm:min-h-0 inline-flex items-center text-ap-muted hover:text-ap-ink dark:text-ap-muted-dark dark:hover:text-ap-chalk transition-colors"
        >
          Terms
        </a>
        <a
          href="/procurement"
          className="min-h-[44px] sm:min-h-0 inline-flex items-center text-ap-muted hover:text-ap-ink dark:text-ap-muted-dark dark:hover:text-ap-chalk transition-colors"
        >
          Compliance
        </a>
        <a
          href="/brand"
          onClick={(e) => {
            if (onOpenBrandStudio && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              onOpenBrandStudio();
            }
          }}
          className="min-h-[44px] sm:min-h-0 inline-flex items-center font-semibold text-ap-clay dark:text-ap-volt hover:underline cursor-pointer"
        >
          Brand &amp; Style Guide
        </a>
      </div>
    </footer>
  );
};
