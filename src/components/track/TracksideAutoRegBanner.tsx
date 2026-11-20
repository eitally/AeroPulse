import React from 'react';
import type { SquadLiveAutoRegSummary } from '../../physiology/trackLiveAutoRegulationEngine';
import type { TracksideAutoRegPivotEntry } from '../../hooks/useTracksideStopwatch';
import {
  ArrowsLeftRight,
  CheckCircle2,
  Clock,
  Pause,
  Pulse,
  Warning,
  X,
} from '../icons/PhosphorIcons';

export interface TracksideAutoRegBannerProps {
  autoRegSummary: SquadLiveAutoRegSummary;
  pivotHistory: TracksideAutoRegPivotEntry[];
  endedEarlyStimulusRatio: number | null;
  isFloatingFocusMode?: boolean;
  onExtendRest30s: () => void;
  onConvertRemainingToCv: () => void;
  onEndSession85Stimulus: (completedRepsCap: number) => void;
  onDismissCue: (signature: string) => void;
}

export const TracksideAutoRegBanner: React.FC<TracksideAutoRegBannerProps> = ({
  autoRegSummary,
  pivotHistory,
  endedEarlyStimulusRatio,
  isFloatingFocusMode = false,
  onExtendRest30s,
  onConvertRemainingToCv,
  onEndSession85Stimulus,
  onDismissCue,
}) => {
  const { primaryAlert } = autoRegSummary;
  const latestPivot =
    pivotHistory.length > 0 ? pivotHistory[pivotHistory.length - 1] : null;

  if (!primaryAlert && !latestPivot && endedEarlyStimulusRatio === null) {
    return null;
  }

  const toneClass = primaryAlert
    ? primaryAlert.cueType === 'NEURO_STOP_RULE'
      ? 'ap-status-strained'
      : primaryAlert.cueType === 'CV_CONVERSION_PIVOT' ||
          primaryAlert.cueType === 'METABOLIC_DRIFT_REST'
        ? 'ap-status-caution'
        : 'ap-status-info'
    : 'ap-status-prime';

  return (
    <div
      className={
        isFloatingFocusMode
          ? 'fixed bottom-[70px] left-2.5 right-2.5 z-30 space-y-1.5 lg:static lg:bottom-auto'
          : 'space-y-2'
      }
    >
      {primaryAlert && (
        <div
          data-testid="stopwatch-autoreg-banner"
          role="status"
          aria-live="polite"
          className={`rounded-xl ${
            isFloatingFocusMode ? 'px-3 py-2 shadow-2xl space-y-1.5' : 'px-4 py-3 space-y-2.5'
          } border ${toneClass}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 flex-1 min-w-0">
              {primaryAlert.cueType === 'NEURO_STOP_RULE' ? (
                <Warning className="w-4 h-4 shrink-0 mt-0.5" weight="bold" />
              ) : (
                <Pulse className="w-4 h-4 shrink-0 mt-0.5" weight="bold" />
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-extrabold tracking-tight">
                    {primaryAlert.runnerName} · {primaryAlert.headline}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-black/15 dark:bg-black/30 font-mono text-2xs font-bold tabular-nums">
                    Fade {primaryAlert.fadePct >= 0 ? '+' : ''}
                    {primaryAlert.fadePct.toFixed(1)}% · D&apos; {primaryAlert.dPrimeBalancePct}%
                  </span>
                </div>
                {!isFloatingFocusMode && (
                  <p className="text-xs mt-1 leading-relaxed opacity-95">
                    {primaryAlert.coachingCue}
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => onDismissCue(primaryAlert.signature)}
              aria-label={`Dismiss auto-regulation alert for ${primaryAlert.runnerName}`}
              className="min-h-[44px] min-w-[44px] sm:min-h-[34px] sm:min-w-[34px] inline-flex items-center justify-center rounded-lg hover:bg-black/10 cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" weight="bold" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-testid="autoreg-extend-rest-btn"
              onClick={onExtendRest30s}
              className={`min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold font-mono cursor-pointer transition-colors ${
                primaryAlert.recommendedAction === 'EXTEND_REST_30S'
                  ? 'bg-ap-carbon text-ap-volt border border-ap-frame'
                  : 'ap-card-inset text-ap-ink dark:text-ap-chalk'
              }`}
            >
              <Clock className="w-3.5 h-3.5 shrink-0" weight="bold" />
              <span>Extend Rest +30s</span>
            </button>

            <button
              type="button"
              data-testid="autoreg-convert-cv-btn"
              onClick={onConvertRemainingToCv}
              className={`min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold font-mono cursor-pointer transition-colors ${
                primaryAlert.recommendedAction === 'CONVERT_REMAINING_TO_CV'
                  ? 'bg-ap-carbon text-ap-volt border border-ap-frame'
                  : 'ap-card-inset text-ap-ink dark:text-ap-chalk'
              }`}
            >
              <ArrowsLeftRight className="w-3.5 h-3.5 shrink-0" weight="bold" />
              <span>Convert Remaining to CV</span>
            </button>

            <button
              type="button"
              data-testid="autoreg-end-85-btn"
              onClick={() => onEndSession85Stimulus(primaryAlert.completedReps)}
              className={`min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold font-mono cursor-pointer transition-colors ${
                primaryAlert.recommendedAction === 'END_SESSION_85_STIMULUS'
                  ? 'bg-ap-carbon text-ap-volt border border-ap-frame'
                  : 'ap-card-inset text-ap-ink dark:text-ap-chalk'
              }`}
            >
              <Pause className="w-3.5 h-3.5 shrink-0" weight="fill" />
              <span>End Session (85% Stimulus)</span>
            </button>
          </div>
        </div>
      )}

      {(latestPivot || endedEarlyStimulusRatio !== null) && (
        <div
          data-testid="stopwatch-autoreg-receipt"
          className="rounded-xl ap-status-prime px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-mono font-semibold"
        >
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" weight="bold" />
            <span>
              {endedEarlyStimulusRatio !== null
                ? `Auto-Regulated Stop: ${Math.round(endedEarlyStimulusRatio * 100)}% Quality Stimulus Preserved (${latestPivot?.summary || 'Session capped cleanly'})`
                : `Pivot Active: ${latestPivot?.summary}`}
            </span>
          </span>
          <span className="text-2xs uppercase tracking-wider px-2 py-0.5 rounded bg-black/10 dark:bg-black/25">
            {pivotHistory.length} {pivotHistory.length === 1 ? 'adjustment' : 'adjustments'}
          </span>
        </div>
      )}
    </div>
  );
};
