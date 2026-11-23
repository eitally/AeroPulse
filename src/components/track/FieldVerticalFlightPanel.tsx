import React from 'react';
import { Award, Check, Trash2, X } from '../icons/PhosphorIcons';
import {
  formatBarHeightForUnit,
  formatFieldMarkDual,
  type VerticalFlightEvaluation,
  type VerticalFlightStanding,
} from '../../physiology/fieldEventsEngine';
import type { DistanceUnit, FieldTrialEntry } from '../../types';

export interface FieldVerticalFlightPanelProps {
  eventCode: 'HJ' | 'PV';
  unit: DistanceUnit;
  activeAthleteName: string;
  barHeightRaw: string;
  onChangeBarHeightRaw: (raw: string) => void;
  activeAttempts: FieldTrialEntry[];
  activeEval: VerticalFlightEvaluation;
  standings: VerticalFlightStanding[];
  onLogAttempt: (outcome: 'CLEAR' | 'MISS' | 'PASS') => void;
  onRaiseBar: () => void;
  onResetActiveAttempts: () => void;
  onSelectAthlete: (athleteId: string) => void;
}

export const FieldVerticalFlightPanel: React.FC<FieldVerticalFlightPanelProps> = ({
  eventCode,
  unit,
  activeAthleteName,
  barHeightRaw,
  onChangeBarHeightRaw,
  activeAttempts,
  activeEval,
  standings,
  onLogAttempt,
  onRaiseBar,
  onResetActiveAttempts,
  onSelectAthlete,
}) => {
  const raiseButtonLabel =
    unit === 'km'
      ? eventCode === 'PV'
        ? '+0.15m Bar ↑'
        : '+0.05m Bar ↑'
      : eventCode === 'PV'
        ? '+6" Bar ↑'
        : '+2" Bar ↑';

  return (
    <div className="rounded-xl bg-ap-carbon border border-ap-edge p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-ap-volt text-ap-obsidian font-mono text-2xs font-extrabold">
            UP NOW
          </span>
          <span className="text-xs sm:text-sm font-extrabold text-ap-chalk">
            {activeAthleteName} · {eventCode === 'PV' ? 'Pole Vault' : 'High Jump'}
          </span>
          {activeEval.isEliminated && (
            <span
              data-testid="field-vertical-eliminated-pill"
              className="px-2 py-0.5 rounded-lg bg-rose-600 text-white font-mono text-2xs font-extrabold"
            >
              {activeEval.isNoHeight ? 'ELIMINATED · NH' : 'ELIMINATED (3X)'}
            </span>
          )}
          {!activeEval.isEliminated && activeEval.consecutiveMisses > 0 && (
            <span className="px-2 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono text-2xs font-bold">
              {activeEval.consecutiveMisses}/3 Consecutive Misses
            </span>
          )}
        </div>
        {activeEval.bestClearedHeightMeters && (
          <span className="text-xs font-mono font-bold text-ap-volt tabular-nums">
            Cleared: {formatFieldMarkDual(activeEval.bestClearedHeightMeters)}
          </span>
        )}
      </div>

      {/* Shared Flight Bar Controls */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[160px]">
          <span className="block text-2xs font-mono uppercase text-ap-muted-dark mb-1">
            Current Bar Height ({unit === 'km' ? 'Metric m' : 'Imperial ft-in'})
          </span>
          <input
            type="text"
            data-testid="field-vertical-bar-input"
            value={barHeightRaw}
            onChange={(e) => onChangeBarHeightRaw(e.target.value)}
            placeholder={
              unit === 'km'
                ? eventCode === 'PV'
                  ? '3.80m'
                  : '1.78m'
                : eventCode === 'PV'
                  ? "12' 6\" or 3.81m"
                  : "5' 10\" or 1.78m"
            }
            className="w-full min-h-[44px] rounded-xl bg-ap-obsidian border border-ap-edge px-3 font-mono text-base font-extrabold text-ap-volt"
          />
        </label>
        <button
          type="button"
          data-testid="field-vertical-clear-btn"
          disabled={activeEval.isEliminated}
          onClick={() => onLogAttempt('CLEAR')}
          className="min-h-[44px] px-4 rounded-xl bg-emerald-500 text-ap-obsidian font-mono font-extrabold text-xs inline-flex items-center gap-1 cursor-pointer disabled:opacity-40"
        >
          <Check className="w-4 h-4" /> O Clear
        </button>
        <button
          type="button"
          data-testid="field-vertical-miss-btn"
          disabled={activeEval.isEliminated}
          onClick={() => onLogAttempt('MISS')}
          className="min-h-[44px] px-4 rounded-xl bg-rose-600 text-white font-mono font-extrabold text-xs inline-flex items-center gap-1 cursor-pointer disabled:opacity-40"
        >
          <X className="w-4 h-4" /> X Miss
        </button>
        <button
          type="button"
          data-testid="field-vertical-pass-btn"
          disabled={activeEval.isEliminated}
          onClick={() => onLogAttempt('PASS')}
          className="min-h-[44px] px-3 rounded-xl bg-ap-turf border border-ap-edge text-ap-chalk font-mono font-bold text-xs cursor-pointer disabled:opacity-40"
        >
          - Pass
        </button>
        <button
          type="button"
          data-testid="field-vertical-raise-btn"
          onClick={onRaiseBar}
          className="min-h-[44px] px-3 rounded-xl bg-ap-volt text-ap-obsidian font-mono font-extrabold text-xs cursor-pointer"
        >
          {raiseButtonLabel}
        </button>
      </div>

      {/* Active Athlete O / X / - Series */}
      {activeAttempts.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono bg-ap-obsidian border border-ap-edge rounded-xl px-3 py-2">
          <span
            data-testid="field-vertical-series-text"
            className="text-ap-chalk tabular-nums"
          >
            Series: {activeEval.verticalSeriesSummary}
          </span>
          <button
            type="button"
            onClick={onResetActiveAttempts}
            className="min-h-[36px] text-rose-400 inline-flex items-center gap-1 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" /> Reset
          </button>
        </div>
      )}

      {/* Live World Athletics / NFHS Countback Ranking */}
      {standings.some((s) => s.heightMarks.length > 0) && (
        <div
          data-testid="field-vertical-countback-standings"
          className="pt-2 border-t border-ap-edge space-y-1.5"
        >
          <div className="flex items-center gap-1.5 text-2xs font-mono uppercase tracking-wider text-ap-muted-dark">
            <Award className="w-3.5 h-3.5 text-ap-volt" />
            <span>Live Countback Standings (Cleared → Misses @ Bar → Total Misses)</span>
          </div>
          <div className="space-y-1">
            {standings
              .filter((s) => s.heightMarks.length > 0)
              .map((s) => (
                <button
                  key={s.athleteId}
                  type="button"
                  onClick={() => onSelectAthlete(s.athleteId)}
                  className="w-full text-left rounded-lg bg-ap-obsidian border border-ap-edge px-2.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-mono hover:border-ap-volt/60 cursor-pointer"
                >
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="font-extrabold text-ap-volt tabular-nums">
                      {s.placeRank !== null
                        ? `${s.isTied ? 'T-' : ''}#${s.placeRank}`
                        : 'NH'}
                    </span>
                    <span className="font-bold text-ap-chalk truncate">
                      {s.athleteName}
                    </span>
                    {s.isEliminated && (
                      <span className="px-1.5 py-0.5 rounded bg-rose-600/20 text-rose-300 border border-rose-500/40 text-2xs font-bold">
                        {s.isNoHeight ? 'NH' : 'ELIMINATED'}
                      </span>
                    )}
                    {s.needsJumpOff && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-2xs font-bold">
                        JUMP-OFF
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-2xs tabular-nums">
                    <span className="text-ap-muted-dark">
                      {s.heightMarks
                        .map(
                          (hm) =>
                            `${formatBarHeightForUnit(hm.heightMeters, unit)}:${hm.summary}`
                        )
                        .join(' · ')}
                    </span>
                    {s.bestClearedHeightMeters && (
                      <span className="text-ap-chalk font-bold">
                        ({s.missesAtClearingHeight ?? 0} @ bar / {s.totalMisses} tot)
                      </span>
                    )}
                  </div>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};
