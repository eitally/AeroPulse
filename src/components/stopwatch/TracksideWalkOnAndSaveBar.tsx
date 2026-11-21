import React from 'react';
import type { ConnectedAthleteRecord } from '../../types';
import {
  RACE_STOPWATCH_PRESETS,
  type RunnerSplitTelemetry,
} from '../../hooks/useTracksideStopwatch';
import { formatStopwatchClockMs } from '../../utils/stopwatchActivitySynthesizer';
import type { VdotPodRosterInput } from '../../physiology/scholasticEngine';
import type { StopwatchOutboxFlushResult } from '../../utils/stopwatchTeamSync';
import { TracksideMeetPassportPanel } from '../track/TracksideMeetPassportPanel';
import {
  ArrowCounterClockwise,
  Check,
  CheckCircle2,
  Copy,
  DownloadSimple,
  Lightning,
  Pause,
  Play,
  Plus,
  ShareNetwork,
  Trophy,
  Users,
  WifiSlash,
} from '../icons/PhosphorIcons';

export interface TracksideWalkOnAndSaveBarProps {
  sessionType: 'WORKOUT' | 'RACE';
  sessionTitle: string;
  activeRacePreset: (typeof RACE_STOPWATCH_PRESETS)[number];
  runnerTelemetries: RunnerSplitTelemetry[];
  connectedRoster: ConnectedAthleteRecord[];
  extraPodAthletes: VdotPodRosterInput[];
  includeSelfRunner: boolean;
  setIncludeSelfRunner: React.Dispatch<React.SetStateAction<boolean>>;
  walkOnName: string;
  setWalkOnName: React.Dispatch<React.SetStateAction<string>>;
  copiedCsv: boolean;
  totalSplitCount: number;
  includeWarmupCooldown: boolean;
  setIncludeWarmupCooldown: React.Dispatch<React.SetStateAction<boolean>>;
  saveFeedbackMsg: string | null;
  saveFeedbackTone: 'prime' | 'caution';
  isSavingToThresh: boolean;
  pendingOutboxCount: number;
  isOnline: boolean;
  isFlushingOutbox: boolean;
  postSaveActionLabel: string;
  stopwatchRunning: boolean;
  stopwatchElapsedMs: number;
  isHoldingPause: boolean;
  setIsHoldingPause: React.Dispatch<React.SetStateAction<boolean>>;
  holdPauseTimerRef: React.MutableRefObject<number | null>;
  holdPauseSucceededRef: React.MutableRefObject<boolean>;
  showChuteBar: boolean;
  setShowChuteBar: (open: boolean) => void;
  chuteQueueSecs: number[];
  tapHistoryLength: number;
  onFlushStopwatchOutbox?: () => Promise<StopwatchOutboxFlushResult>;
  onManualFlushOutbox: () => Promise<void>;
  onAddWalkOn: (e: React.FormEvent) => void;
  onRemoveWalkOn: (id: string) => void;
  onCopyCsv: () => void;
  onDownloadCsv: () => void;
  onShareStopwatchCard: () => void;
  onSaveToThresh: () => Promise<void>;
  onOpenActivitiesTab: () => void;
  onOpenRosterModal: () => void;
  onGunToggle: () => void;
  onChuteTap: () => void;
  onUndo: () => void;
  setLiveAnnouncement: React.Dispatch<React.SetStateAction<string>>;
}

export const TracksideWalkOnAndSaveBar: React.FC<TracksideWalkOnAndSaveBarProps> = ({
  sessionType,
  sessionTitle,
  activeRacePreset,
  runnerTelemetries,
  connectedRoster,
  extraPodAthletes,
  includeSelfRunner,
  setIncludeSelfRunner,
  walkOnName,
  setWalkOnName,
  copiedCsv,
  totalSplitCount,
  includeWarmupCooldown,
  setIncludeWarmupCooldown,
  saveFeedbackMsg,
  saveFeedbackTone,
  isSavingToThresh,
  pendingOutboxCount,
  isOnline,
  isFlushingOutbox,
  postSaveActionLabel,
  stopwatchRunning,
  stopwatchElapsedMs,
  isHoldingPause,
  setIsHoldingPause,
  holdPauseTimerRef,
  holdPauseSucceededRef,
  showChuteBar,
  setShowChuteBar,
  chuteQueueSecs,
  tapHistoryLength,
  onFlushStopwatchOutbox,
  onManualFlushOutbox: handleManualFlushOutbox,
  onAddWalkOn: handleAddWalkOn,
  onRemoveWalkOn: handleRemoveWalkOn,
  onCopyCsv: handleCopyCsv,
  onDownloadCsv: handleDownloadCsv,
  onShareStopwatchCard: handleShareStopwatchCard,
  onSaveToThresh: handleSaveToThresh,
  onOpenActivitiesTab,
  onOpenRosterModal,
  onGunToggle: handleGunToggle,
  onChuteTap: handleChuteTap,
  onUndo: handleUndo,
  setLiveAnnouncement,
}) => {
  return (
    <>
      <section className="ap-card rounded-2xl p-4 sm:p-5 space-y-4 scroll-mb-28">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Quick Walk-On Runner Adder */}
          <form onSubmit={handleAddWalkOn} className="flex flex-wrap items-center gap-2 scroll-mb-28">
            <input
              type="text"
              value={walkOnName}
              onChange={(e) => setWalkOnName(e.target.value)}
              placeholder="Add walk-on runner name..."
              aria-label="Walk-On Runner Name"
              className="w-56 sm:w-60 min-h-[44px] sm:min-h-[38px] rounded-xl ap-card-inset px-3 text-xs text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#84CC16]"
            />
            <button
              type="submit"
              className="min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1.5 px-3.5 rounded-xl ap-card-inset hover:border-[#28573B] text-xs font-semibold text-slate-900 dark:text-white cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 ap-text-brand" weight="bold" />
              <span>Add Runner</span>
            </button>

            <button
              type="button"
              onClick={onOpenRosterModal}
              className="min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1.5 px-3 rounded-xl ap-card-inset text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              <Users className="w-3.5 h-3.5 ap-text-brand" weight="duotone" />
              <span>Manage Squad</span>
            </button>
          </form>

          {/* Include Self Toggle + Walk-on chips */}
          <div className="flex flex-wrap items-center gap-2">
            {(connectedRoster.length > 0 || extraPodAthletes.length > 0) && (
              <label className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-2 px-3 rounded-xl ap-card-inset text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeSelfRunner}
                  onChange={(e) => setIncludeSelfRunner(e.target.checked)}
                  className="accent-[#65A30D]"
                />
                <span>Include Myself</span>
              </label>
            )}

            {extraPodAthletes.map((w) => (
              <span
                key={w.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ap-card-inset text-2xs font-mono text-slate-700 dark:text-slate-200"
              >
                <span>{w.name}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveWalkOn(w.id)}
                  aria-label={`Remove ${w.name}`}
                  className="min-h-[44px] min-w-[44px] sm:min-h-[28px] sm:min-w-[28px] inline-flex items-center justify-center rounded-md text-rose-700 dark:text-rose-400 font-bold hover:bg-rose-500/10 cursor-pointer"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Bottom Export & 1-Click Save Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-emerald-900/10 dark:border-white/10">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="stopwatch-copy-csv"
              onClick={handleCopyCsv}
              disabled={totalSplitCount === 0}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-xl ap-card-inset text-xs font-semibold text-slate-800 dark:text-slate-100 disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed"
            >
              {copiedCsv ? (
                <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" weight="bold" />
              ) : (
                <Copy className="w-4 h-4" weight="duotone" />
              )}
              <span>{copiedCsv ? 'Copied CSV' : 'Copy CSV'}</span>
            </button>

            <button
              type="button"
              data-testid="stopwatch-export-csv"
              onClick={handleDownloadCsv}
              disabled={totalSplitCount === 0}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-xl ap-card-inset text-xs font-semibold text-slate-800 dark:text-slate-100 disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed"
            >
              <DownloadSimple className="w-4 h-4 ap-text-brand" weight="bold" />
              <span>Export .CSV</span>
            </button>

            <button
              type="button"
              data-testid="stopwatch-share-card"
              onClick={handleShareStopwatchCard}
              disabled={totalSplitCount === 0}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-xl ap-card-inset text-xs font-semibold text-slate-800 dark:text-slate-100 disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed"
            >
              <ShareNetwork className="w-4 h-4 ap-text-brand" weight="bold" />
              <span>Share PNG Card</span>
            </button>

            {sessionType === 'RACE' && (
              <label className="min-h-[44px] inline-flex items-center gap-2 px-3 rounded-xl ap-card-inset text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeWarmupCooldown}
                  onChange={(e) => setIncludeWarmupCooldown(e.target.checked)}
                  className="accent-[#65A30D]"
                />
                <span>Include Warmup/Cooldown</span>
              </label>
            )}
          </div>

          <button
            type="button"
            data-testid="stopwatch-save-thresh"
            onClick={() => void handleSaveToThresh()}
            disabled={totalSplitCount === 0 || isSavingToThresh}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1D3828] hover:bg-[#163022] text-white dark:bg-[#183122] dark:hover:bg-[#21422E] dark:text-ap-volt border border-ap-frame text-xs font-bold disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed transition-colors"
          >
            {sessionType === 'RACE' ? (
              <Trophy className="w-4 h-4 shrink-0" weight="duotone" />
            ) : (
              <CheckCircle2 className="w-4 h-4 shrink-0" weight="duotone" />
            )}
            <span>
              {isSavingToThresh
                ? 'Saving Splits…'
                : sessionType === 'RACE'
                  ? 'Save Official Race Marks to THRESH'
                  : 'Save Workout Splits to THRESH'}
            </span>
          </button>
        </div>

        {pendingOutboxCount > 0 && (
          <div
            role="status"
            data-testid="stopwatch-outbox-banner"
            className="rounded-xl ap-status-caution px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold"
          >
            <span className="inline-flex items-center gap-2">
              <WifiSlash className="w-4 h-4 shrink-0" weight="bold" />
              <span>
                Pending Sync: {pendingOutboxCount} offline athlete stopwatch{' '}
                {pendingOutboxCount === 1 ? 'log' : 'logs'} saved safely on device.
              </span>
            </span>
            {onFlushStopwatchOutbox && (
              <button
                type="button"
                data-testid="stopwatch-outbox-sync-now"
                onClick={() => void handleManualFlushOutbox()}
                disabled={!isOnline || isFlushingOutbox}
                className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#0B120E] text-ap-volt font-mono text-2xs font-bold disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed"
              >
                <ArrowCounterClockwise className="w-3.5 h-3.5" weight="bold" />
                <span>{isFlushingOutbox ? 'Syncing…' : 'Sync Now'}</span>
              </button>
            )}
          </div>
        )}

        {sessionType === 'RACE' && (
          <TracksideMeetPassportPanel
            sessionTitle={sessionTitle}
            eventLabel={activeRacePreset.label}
            eventDistanceMeters={activeRacePreset.distanceMeters}
            finishers={runnerTelemetries
              .filter((t) => t.lapCount > 0 && t.netTotalSecs !== null)
              .map((t) => ({
                runnerId: t.runnerId,
                runnerName: t.runnerName,
                netTotalSecs: t.netTotalSecs ?? 0,
                lapSplitsSecs: t.lapSplitsSecs,
              }))}
          />
        )}

        {saveFeedbackMsg && (
          <div
            role="status"
            data-testid="stopwatch-save-feedback"
            className={`rounded-xl ${
              saveFeedbackTone === 'caution' ? 'ap-status-caution' : 'ap-status-prime'
            } px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold`}
          >
            <span>{saveFeedbackMsg}</span>
            <button
              type="button"
              onClick={onOpenActivitiesTab}
              className="underline font-bold cursor-pointer"
            >
              {postSaveActionLabel}
            </button>
          </div>
        )}
      </section>

      {/* Fixed bottom thumb-zone bar on phones (<768px) — replaces MobileDock while timing (RT-25) */}
      <div
        data-testid="stopwatch-mobile-thumb-bar"
        role="region"
        aria-label="Trackside thumb controls"
        className="md:hidden fixed bottom-2 left-3 right-3 z-40 rounded-2xl liquid-glass-header px-2 py-2 grid grid-cols-3 gap-1.5"
      >
        <div
          data-testid="stopwatch-mobile-thumb-clock"
          className="col-span-3 flex items-center justify-between px-2 py-0.5 rounded-lg bg-white/95 dark:bg-[#0B120E] text-ap-obsidian dark:text-ap-volt border border-stone-300/80 dark:border-ap-frame font-mono text-xs font-extrabold tabular-nums"
        >
          <span className="text-2xs uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark">
            {stopwatchRunning ? 'Running' : stopwatchElapsedMs > 0 ? 'Paused' : 'Ready'}
          </span>
          <span>{formatStopwatchClockMs(stopwatchElapsedMs)}</span>
        </div>
        <button
          type="button"
          data-testid="stopwatch-mobile-gun-btn"
          aria-label={
            stopwatchRunning
              ? 'Hold 0.5 seconds to pause stopwatch'
              : stopwatchElapsedMs > 0
                ? 'Resume stopwatch'
                : 'Start Gun'
          }
          onPointerDown={(e) => {
            if (!stopwatchRunning) return;
            if (typeof e.button === 'number' && e.button !== 0) return;
            holdPauseSucceededRef.current = false;
            setIsHoldingPause(true);
            if (holdPauseTimerRef.current !== null) {
              window.clearTimeout(holdPauseTimerRef.current);
            }
            holdPauseTimerRef.current = window.setTimeout(() => {
              holdPauseTimerRef.current = null;
              holdPauseSucceededRef.current = true;
              setIsHoldingPause(false);
              handleGunToggle();
            }, 450);
          }}
          onPointerUp={() => {
            if (holdPauseTimerRef.current !== null) {
              window.clearTimeout(holdPauseTimerRef.current);
              holdPauseTimerRef.current = null;
            }
            setIsHoldingPause(false);
            if (stopwatchRunning && !holdPauseSucceededRef.current) {
              setLiveAnnouncement('Hold Pause for 0.5s to prevent accidental stops');
            }
          }}
          onPointerCancel={() => {
            if (holdPauseTimerRef.current !== null) {
              window.clearTimeout(holdPauseTimerRef.current);
              holdPauseTimerRef.current = null;
            }
            setIsHoldingPause(false);
          }}
          onPointerLeave={() => {
            if (holdPauseTimerRef.current !== null) {
              window.clearTimeout(holdPauseTimerRef.current);
              holdPauseTimerRef.current = null;
            }
            setIsHoldingPause(false);
          }}
          onClick={(e) => {
            if (!stopwatchRunning) {
              handleGunToggle();
              return;
            }
            // Keyboard Enter/Space activation produces detail === 0
            if (e.detail === 0) {
              handleGunToggle();
            }
          }}
          className={
            stopwatchRunning
              ? 'min-h-[52px] inline-flex items-center justify-center gap-1.5 px-2 rounded-xl ap-status-caution font-bold text-xs cursor-pointer select-none'
              : 'ap-btn-primary min-h-[52px] px-2 text-xs font-bold cursor-pointer'
          }
        >
          {stopwatchRunning ? (
            <>
              <Pause className="w-4 h-4 shrink-0" weight="fill" />
              <span className="truncate">{isHoldingPause ? 'Pausing…' : 'Hold Pause'}</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 shrink-0" weight="fill" />
              <span className="truncate">{stopwatchElapsedMs > 0 ? 'Resume' : 'Start Gun'}</span>
            </>
          )}
        </button>

        <button
          type="button"
          data-testid="stopwatch-mobile-chute-btn"
          onClick={() => {
            if (!showChuteBar && sessionType !== 'RACE') {
              setShowChuteBar(true);
            }
            handleChuteTap();
          }}
          className="min-h-[52px] inline-flex items-center justify-center gap-1 px-2 rounded-xl bg-[#0B120E] text-ap-volt border border-ap-frame text-xs font-bold cursor-pointer"
        >
          <Lightning className="w-4 h-4 shrink-0" weight="fill" />
          <span>Chute</span>
          {chuteQueueSecs.length > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-ap-cobalt text-ap-volt font-mono text-2xs">
              {chuteQueueSecs.length}
            </span>
          )}
        </button>

        <button
          type="button"
          data-testid="stopwatch-mobile-undo-btn"
          onClick={handleUndo}
          disabled={tapHistoryLength === 0}
          className="min-h-[52px] inline-flex items-center justify-center gap-1 px-2 rounded-xl ap-card-inset text-xs font-semibold text-ap-ink dark:text-ap-chalk disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed"
        >
          <ArrowCounterClockwise className="w-4 h-4 shrink-0" weight="bold" />
          <span>Undo</span>
        </button>
      </div>
    </>
  );
};
