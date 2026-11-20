import React from 'react';
import { FlagCheckered, Timer } from './icons/PhosphorIcons';
import { useTracksideStopwatch } from '../hooks/useTracksideStopwatch';
import { formatTrackMark } from '../physiology/scholasticEngine';

interface TracksideLiveHeaderPillProps {
  onOpenTracksidePad: () => void;
  showIdleLauncher?: boolean;
}

export const TracksideLiveHeaderPill: React.FC<TracksideLiveHeaderPillProps> = React.memo(
  ({ onOpenTracksidePad, showIdleLauncher = false }) => {
    const {
      stopwatchRunning,
      stopwatchElapsedMs,
      totalSplitCount,
      hasActiveSession,
      sessionType,
    } = useTracksideStopwatch(200);

    if (!hasActiveSession && !showIdleLauncher) {
      return null;
    }

    if (!hasActiveSession) {
      return (
        <button
          type="button"
          onClick={onOpenTracksidePad}
          className="min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl liquid-capsule-track text-xs font-mono font-semibold text-slate-800 dark:text-slate-100 hover:border-[#28573B] dark:hover:border-ap-volt/60 transition-colors whitespace-nowrap cursor-pointer"
          title="Open Trackside Stopwatch (0.01s Multi-Athlete Timing)"
        >
          <Timer className="w-4 h-4 ap-text-brand shrink-0" weight="bold" />
          <span>Stopwatch</span>
        </button>
      );
    }

    const ModeIcon = sessionType === 'RACE' ? FlagCheckered : Timer;

    return (
      <button
        type="button"
        onClick={onOpenTracksidePad}
        role="status"
        aria-live="off"
        aria-label={`Active Trackside ${sessionType} Stopwatch ${formatTrackMark(stopwatchElapsedMs / 1000, 1)}, ${totalSplitCount} splits recorded. Return to Stopwatch.`}
        className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl font-mono text-xs font-bold tabular-nums transition-all whitespace-nowrap cursor-pointer ${
          stopwatchRunning
            ? 'bg-ap-carbon text-ap-volt border-2 border-ap-frame shadow-sm hover:border-ap-volt/70'
            : 'ap-status-caution border border-amber-500/45'
        }`}
        title="Return to Trackside Stopwatch Workspace"
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            stopwatchRunning ? 'bg-ap-volt animate-pulse' : 'bg-amber-500'
          }`}
          aria-hidden="true"
        />
        <ModeIcon className="w-3.5 h-3.5 shrink-0" weight="bold" />
        <span className="text-2xs uppercase opacity-90">{sessionType}</span>
        <span>{formatTrackMark(stopwatchElapsedMs / 1000, 1)}</span>
        {totalSplitCount > 0 && (
          <span className="px-1.5 py-0.5 rounded-md bg-white/10 text-2xs">
            {totalSplitCount}
          </span>
        )}
      </button>
    );
  }
);

TracksideLiveHeaderPill.displayName = 'TracksideLiveHeaderPill';
