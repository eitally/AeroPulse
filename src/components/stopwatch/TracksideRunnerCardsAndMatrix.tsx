import React from 'react';
import { BellRinging, Lock } from '../icons/PhosphorIcons';
import type { RunnerSplitTelemetry } from '../../hooks/useTracksideStopwatch';
import { formatTrackMark } from '../../physiology/scholasticEngine';
import { formatFatTime } from '../../utils/officialRaceSynthesizer';

export interface TracksideRunnerCardsAndMatrixProps {
  viewMode: 'CARDS' | 'MATRIX';
  sessionType: 'WORKOUT' | 'RACE';
  filteredTelemetries: RunnerSplitTelemetry[];
  runnerPodLookup: Map<string, { podKey: string; targetLapSecs: number }>;
  chuteQueueSecs: number[];
  lastTappedRunnerId: string | null;
  targetRaceLaps: number | null;
  maxColumnsInMatrix: number;
  onRunnerAction: (telemetry: RunnerSplitTelemetry) => void;
}

export const TracksideRunnerCardsAndMatrix: React.FC<TracksideRunnerCardsAndMatrixProps> = ({
  viewMode,
  sessionType,
  filteredTelemetries,
  runnerPodLookup,
  chuteQueueSecs,
  lastTappedRunnerId,
  targetRaceLaps,
  maxColumnsInMatrix,
  onRunnerAction: handleRunnerAction,
}) => {
  return (
      <section className="space-y-3">
        {viewMode === 'CARDS' ? (
          <div
            className={`grid ${filteredTelemetries.length >= 4 ? 'grid-cols-2 gap-2' : 'grid-cols-1 gap-2.5'} md:grid-cols-2 xl:grid-cols-3`}
          >
            {filteredTelemetries.map((telemetry, idx) => {
              const podMeta = runnerPodLookup.get(telemetry.runnerId);
              const nextChuteTs = chuteQueueSecs[0];
              const isJustTapped = lastTappedRunnerId === telemetry.runnerId;

              return (
                <button
                  key={telemetry.runnerId}
                  type="button"
                  data-testid={`runner-card-${idx}`}
                  onClick={() => handleRunnerAction(telemetry)}
                  className={`min-h-[92px] rounded-xl p-3.5 gap-2.5 w-full text-left transition-all cursor-pointer flex flex-col justify-between border ${
                    isJustTapped ? 'ring-2 ring-ap-clay dark:ring-ap-volt' : ''
                  } ${
                    telemetry.isFinishedLocked
                      ? 'bg-[#F0F7F3] dark:bg-[#13231A] border-[#1E4D36]/45'
                      : telemetry.isBellLap
                        ? 'ap-card border-[#D97706]/60 ring-1 ring-[#D97706]/50'
                        : 'ap-card hover:border-[#121413]/45 dark:hover:border-ap-volt/60 active:scale-[0.98]'
                  }`}
                >
                  {/* Row 1: Athlete Name + Target Pod & Right Status Pill */}
                  <div className="flex items-start justify-between gap-1.5 w-full">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="ap-lane-badge shrink-0">
                        <span className="ap-lane-badge-inner">
                          {idx < 9 ? `L${idx + 1}` : `#${idx + 1}`}
                        </span>
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs sm:text-sm font-bold text-ap-ink dark:text-ap-chalk truncate">
                          {telemetry.runnerName}
                        </div>
                        <div className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark truncate">
                          {telemetry.podKey}
                          {telemetry.effectiveOffsetSecs > 0
                            ? ` +${telemetry.effectiveOffsetSecs.toFixed(0)}s`
                            : ''}
                          {sessionType === 'WORKOUT' && podMeta
                            ? ` · ${formatTrackMark(podMeta.targetLapSecs, 1)}`
                            : ''}
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-1">
                      {nextChuteTs !== undefined && !telemetry.isFinishedLocked ? (
                        <span className="px-1.5 py-0.5 rounded-md bg-[#121413] text-ap-volt font-mono text-2xs font-bold">
                          +{formatTrackMark(nextChuteTs, 2)}
                        </span>
                      ) : sessionType === 'RACE' ? (
                        <div className="flex items-center gap-1">
                          {telemetry.placeLabel && (
                            <span className="px-1.5 py-0.5 rounded-md ap-status-info font-mono text-2xs font-bold">
                              {telemetry.placeLabel}
                            </span>
                          )}
                          {telemetry.isFinishedLocked ? (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md ap-status-prime font-mono text-2xs font-bold">
                              <Lock className="w-3 h-3" weight="bold" />
                              <span>Fin</span>
                            </span>
                          ) : telemetry.isBellLap ? (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md ap-status-caution font-mono text-2xs font-bold">
                              <BellRinging className="w-3 h-3" weight="bold" />
                              <span>Bell</span>
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded-md ap-card-inset font-mono text-2xs font-semibold text-ap-muted dark:text-ap-muted-dark">
                              L{telemetry.lapCount}
                              {targetRaceLaps ? `/${targetRaceLaps}` : ''}
                            </span>
                          )}
                        </div>
                      ) : telemetry.restState.status === 'RESTING' ? (
                        <span className="px-1.5 py-0.5 rounded-md ap-status-caution font-mono text-2xs font-bold tabular-nums">
                          {telemetry.restState.remainingRestSecs}s
                        </span>
                      ) : telemetry.restState.status === 'GO_NOW' ? (
                        <span className="px-1.5 py-0.5 rounded-md ap-status-prime font-mono text-2xs font-bold tabular-nums">
                          GO +{telemetry.restState.overdueSecs}s
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded-md ap-card-inset font-mono text-2xs font-semibold text-ap-muted dark:text-ap-muted-dark">
                          {telemetry.lapCount}L
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Row 2: Last Split (+ Target Delta) or Tap Split Cue */}
                  <div className="flex items-center justify-between gap-2 w-full pt-2 border-t border-[#121413]/10 dark:border-white/10">
                    {telemetry.lastLapSecs !== null ? (
                      <>
                        <div className="flex items-baseline gap-1.5 min-w-0">
                          <span className="font-mono text-lg sm:text-xl font-extrabold tabular-nums text-ap-ink dark:text-ap-chalk">
                            {formatTrackMark(telemetry.lastLapSecs, 2)}
                          </span>
                          {telemetry.lastDeltaVsTargetSecs !== null && (
                            <span
                              className={`font-mono text-2xs font-bold tabular-nums px-1.5 py-0.5 rounded ${
                                telemetry.lastDeltaVsTargetSecs <= 0.5
                                  ? 'ap-status-prime'
                                  : 'ap-status-caution'
                              }`}
                            >
                              {telemetry.lastDeltaVsTargetSecs >= 0 ? '+' : ''}
                              {telemetry.lastDeltaVsTargetSecs.toFixed(1)}s
                            </span>
                          )}
                        </div>
                        <div className="text-right font-mono text-xs tabular-nums text-ap-muted dark:text-ap-muted-dark shrink-0">
                          <span className="font-bold text-ap-ink dark:text-ap-chalk">
                            {telemetry.netTotalSecs !== null
                              ? formatFatTime(telemetry.netTotalSecs)
                              : '--:--.--'}
                          </span>
                        </div>
                      </>
                    ) : (
                      <span className="w-full py-1.5 px-3 rounded-lg border border-[#121413]/22 dark:border-white/20 bg-[#FAF8F4] dark:bg-[#151816] text-center font-sans text-xs font-bold text-ap-ink dark:text-ap-chalk">
                        Tap Split
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          /* Matrix Clipboard Table View */
          <div className="ap-card rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table
                data-testid="stopwatch-matrix-table"
                className="w-full text-left border-collapse text-xs"
              >
                <thead>
                  <tr className="border-b border-ap-frame/15 dark:border-white/10 bg-[#EDE9DF] dark:bg-ap-turf font-mono text-2xs uppercase text-ap-ink dark:text-ap-chalk">
                    <th className="py-2.5 px-3 sticky left-0 bg-[#EDE9DF] dark:bg-ap-turf z-10">
                      Athlete &amp; Split Action
                    </th>
                    <th className="py-2.5 px-2.5">Pod</th>
                    <th className="py-2.5 px-2.5">
                      {sessionType === 'RACE' ? 'Status' : 'Recovery'}
                    </th>
                    {Array.from({ length: maxColumnsInMatrix }, (_, i) => (
                      <th key={`col-${i + 1}`} className="py-2.5 px-2.5 text-right">
                        L{i + 1}
                      </th>
                    ))}
                    <th className="py-2.5 px-2.5 text-right">Best</th>
                    <th className="py-2.5 px-2.5 text-right">Avg</th>
                    <th className="py-2.5 px-3 text-right">Net Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#121413]/10 dark:divide-white/10">
                  {filteredTelemetries.map((telemetry, idx) => (
                    <tr
                      key={`row-${telemetry.runnerId}`}
                      className="hover:bg-[#FAF8F4] dark:hover:bg-ap-turf/60"
                    >
                      <td className="py-2 px-3 sticky left-0 bg-white dark:bg-ap-carbon z-10">
                        <button
                          type="button"
                          data-testid={`matrix-split-btn-${idx}`}
                          onClick={() => handleRunnerAction(telemetry)}
                          className="min-h-[44px] inline-flex items-center gap-2 px-3 py-1.5 rounded-xl ap-card-inset hover:border-ap-frame/45 dark:hover:border-ap-volt/60 font-semibold text-ap-ink dark:text-ap-chalk cursor-pointer"
                        >
                          <span className="font-mono text-2xs ap-text-brand font-bold">
                            L{idx + 1}
                          </span>
                          <span className="truncate max-w-[140px]">
                            {telemetry.runnerName}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-[#121413] text-ap-volt font-mono text-2xs font-bold">
                            {telemetry.isFinishedLocked
                              ? 'Locked'
                              : chuteQueueSecs.length > 0
                                ? 'Assign #1'
                                : '+Split'}
                          </span>
                        </button>
                      </td>
                      <td className="py-2 px-2.5 font-mono text-2xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {telemetry.podKey}
                      </td>
                      <td className="py-2 px-2.5 whitespace-nowrap">
                        {sessionType === 'RACE' ? (
                          <span className="font-mono text-2xs font-bold text-slate-800 dark:text-slate-200">
                            {telemetry.placeLabel || '—'}{' '}
                            {telemetry.isFinishedLocked
                              ? '· Fin'
                              : telemetry.isBellLap
                                ? '· Bell'
                                : ''}
                          </span>
                        ) : telemetry.restState.status === 'RESTING' ? (
                          <span className="px-2 py-0.5 rounded ap-status-caution font-mono text-2xs font-bold">
                            {telemetry.restState.remainingRestSecs}s
                          </span>
                        ) : telemetry.restState.status === 'GO_NOW' ? (
                          <span className="px-2 py-0.5 rounded ap-status-prime font-mono text-2xs font-bold">
                            GO
                          </span>
                        ) : (
                          <span className="font-mono text-2xs text-slate-500 dark:text-slate-400">
                            —
                          </span>
                        )}
                      </td>
                      {Array.from({ length: maxColumnsInMatrix }, (_, lapIdx) => {
                        const splitVal = telemetry.lapSplitsSecs[lapIdx];
                        const isBest =
                          splitVal !== undefined &&
                          telemetry.bestLapSecs !== null &&
                          Math.abs(splitVal - telemetry.bestLapSecs) < 0.005;
                        return (
                          <td
                            key={`cell-${telemetry.runnerId}-${lapIdx}`}
                            className={`py-2 px-2.5 text-right font-mono tabular-nums ${
                              isBest
                                ? 'font-bold text-emerald-700 dark:text-emerald-400'
                                : 'text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {splitVal !== undefined ? formatTrackMark(splitVal, 2) : '—'}
                          </td>
                        );
                      })}
                      <td className="py-2 px-2.5 text-right font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                        {telemetry.bestLapSecs !== null
                          ? formatTrackMark(telemetry.bestLapSecs, 2)
                          : '—'}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {telemetry.avgLapSecs !== null
                          ? formatTrackMark(telemetry.avgLapSecs, 2)
                          : '—'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                        {telemetry.netTotalSecs !== null
                          ? formatFatTime(telemetry.netTotalSecs)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
  );
};
