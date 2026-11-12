import React from 'react';
import { Timer } from './icons/PhosphorIcons';
import { useTracksideStopwatch } from '../hooks/useTracksideStopwatch';
import { formatTrackMark } from '../physiology/scholasticEngine';

interface TracksideLiveHeaderPillProps {
  onOpenTracksidePad: () => void;
  showIdleLauncher?: boolean;
}

export const TracksideLiveHeaderPill: React.FC<TracksideLiveHeaderPillProps> = React.memo(
  ({ onOpenTracksidePad, showIdleLauncher = false }) => {
    const { stopwatchRunning, stopwatchElapsedMs, totalSplitCount, hasActiveSession } =
      useTracksideStopwatch(200);

    if (!hasActiveSession && !showIdleLauncher) {
      return null;
    }

    if (!hasActiveSession) {
      return (
        <button
          type="button"
          onClick={onOpenTracksidePad}
          className="min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl liquid-capsule-track text-xs font-mono font-semibold text-slate-800 dark:text-slate-100 hover:border-[#28573B] dark:hover:border-[#C8FF00]/60 transition-colors whitespace-nowrap cursor-pointer"
          title="Open Trackside Watchless 0.01s Multi-Athlete Split Pad"
        >
          <Timer className="w-4 h-4 ap-text-brand shrink-0" weight="bold" />
          <span>Split Pad</span>
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={onOpenTracksidePad}
        role="status"
        aria-live="off"
        aria-label={`Active Trackside Stopwatch ${formatTrackMark(stopwatchElapsedMs / 1000, 1)}, ${totalSplitCount} splits recorded. Open Trackside Split Pad.`}
        className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-2 px-3 py-1.5 rounded-xl font-mono text-xs font-bold tabular-nums transition-all whitespace-nowrap cursor-pointer ${
          stopwatchRunning
            ? 'bg-[#101B15] text-[#C8FF00] border-2 border-[#2B5B3F] shadow-sm hover:border-[#C8FF00]/70'
            : 'ap-status-caution border border-amber-500/45'
        }`}
        title="Return to Live Trackside Split Pad (splits persisted automatically)"
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            stopwatchRunning ? 'bg-[#C8FF00] animate-pulse' : 'bg-amber-500'
          }`}
          aria-hidden="true"
        />
        <Timer className="w-4 h-4 shrink-0" weight="bold" />
        <span>{formatTrackMark(stopwatchElapsedMs / 1000, 1)}</span>
        {totalSplitCount > 0 && (
          <span className="px-1.5 py-0.5 rounded-md bg-white/10 text-2xs">
            {totalSplitCount} {totalSplitCount === 1 ? 'split' : 'splits'}
          </span>
        )}
      </button>
    );
  }
);

TracksideLiveHeaderPill.displayName = 'TracksideLiveHeaderPill';
