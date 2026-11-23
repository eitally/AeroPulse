import React from 'react';
import { BellRinging, FlagCheckered, Plus, Trash } from '../icons/PhosphorIcons';
import type {
  RaceStopwatchPreset,
  RelayQuartetConfig,
  RelayQuartetTelemetry,
  RunnerSplitTelemetry,
} from '../../hooks/useTracksideStopwatch';
import type { AthleteProfile, ConnectedAthleteRecord, TrackLaneNumber, UnifiedActivity } from '../../types';
import type { VdotPodRosterInput } from '../../physiology/scholasticEngine';
import { formatFatTime } from '../../utils/officialRaceSynthesizer';
import { synthesizeTracksideRaceActivity } from '../../utils/stopwatchActivitySynthesizer';

export function buildRelayCsvTelemetries(
  relayTelemetries: RelayQuartetTelemetry[]
): RunnerSplitTelemetry[] {
  return relayTelemetries.map((rt) => {
    const splits = rt.legs
      .map((l) => l.legSplitSecs)
      .filter((s): s is number => s !== null);
    const cum = rt.legs
      .map((l) => l.cumulativeSecs)
      .filter((s): s is number => s !== null);
    const total = cum.length > 0 ? cum[cum.length - 1] : null;
    return {
      runnerId: rt.quartetId,
      runnerName: `${rt.quartetLabel} (${rt.legs.map((l) => l.athleteName).join(' / ')})`,
      podKey: 'Relay',
      effectiveOffsetSecs: 0,
      netCumulativeSecs: cum,
      lapSplitsSecs: splits,
      lapCount: splits.length,
      lastLapSecs: splits.length > 0 ? splits[splits.length - 1] : null,
      bestLapSecs: splits.length > 0 ? Math.min(...splits) : null,
      avgLapSecs:
        total !== null && splits.length > 0 ? Number((total / splits.length).toFixed(2)) : null,
      netTotalSecs: total,
      lastDeltaVsTargetSecs: null,
      isBellLap: false,
      isFinishedLocked: rt.isFinished,
      restState: { status: 'IDLE', remainingRestSecs: 0, overdueSecs: 0 },
      rank: null,
      placeLabel: null,
    };
  });
}

export function buildRelaySavedEntries(params: {
  relayTelemetries: RelayQuartetTelemetry[];
  activeRacePreset: RaceStopwatchPreset;
  rosterById: Map<string, ConnectedAthleteRecord>;
  selfProfile: AthleteProfile;
  sessionTitle: string;
  includeWarmupCooldown: boolean;
  startDateLocalIso: string;
  derivedStartMs: number;
  trackLane: TrackLaneNumber;
}): Array<{ runnerId: string; runnerName: string; activity: UnifiedActivity }> {
  return params.relayTelemetries
    .filter((rt) => rt.completedLegs > 0)
    .map((rt) => {
      const firstAssignedId = rt.legs.find((l) => l.athleteId)?.athleteId || 'SELF';
      const prof =
        firstAssignedId === 'SELF'
          ? params.selfProfile
          : params.rosterById.get(firstAssignedId)?.athleteProfile || params.selfProfile;
      const legSplits = rt.legs
        .map((l) => l.legSplitSecs)
        .filter((s): s is number => s !== null);
      const totalSecs =
        rt.totalActualSecs ?? rt.legs[rt.completedLegs - 1]?.cumulativeSecs ?? 0;
      return {
        runnerId: firstAssignedId,
        runnerName: `${rt.quartetLabel} (${rt.eventLabel})`,
        activity: synthesizeTracksideRaceActivity({
          runnerId: firstAssignedId,
          runnerName: rt.quartetLabel,
          lthr: prof.lthr || 172,
          maxHr: prof.maxHr || 194,
          sessionTitle: params.sessionTitle || `${rt.quartetLabel} ${rt.eventLabel}`,
          eventLabel: rt.eventLabel,
          eventDistanceMeters: params.activeRacePreset.distanceMeters,
          lapSplitDistanceMeters: params.activeRacePreset.splitMeters,
          lapSplitsSecs: legSplits,
          netTotalSecs: totalSecs,
          includeWarmupCooldown: params.includeWarmupCooldown,
          startDateLocalIso: params.startDateLocalIso,
          startDateUtcMs: params.derivedStartMs,
          lane: params.trackLane,
        }),
      };
    });
}

export interface TracksideRelayBatonPanelProps {
  activeRacePreset: RaceStopwatchPreset;
  quartets: RelayQuartetConfig[];
  relayTelemetries: RelayQuartetTelemetry[];
  rosterInputs: VdotPodRosterInput[];
  stopwatchRunning: boolean;
  onTapBatonHandoff: (quartetId: string) => void;
  onUpdateQuartet: (
    quartetId: string,
    updater: (prev: RelayQuartetConfig) => RelayQuartetConfig
  ) => void;
  onAddQuartet: () => void;
  onRemoveQuartet: (quartetId: string) => void;
}

export const TracksideRelayBatonPanel: React.FC<TracksideRelayBatonPanelProps> = ({
  activeRacePreset,
  quartets,
  relayTelemetries,
  rosterInputs,
  stopwatchRunning,
  onTapBatonHandoff,
  onUpdateQuartet,
  onAddQuartet,
  onRemoveQuartet,
}) => {
  const legDistances = activeRacePreset.legDistancesMeters || [400, 400, 400, 400];

  return (
    <section
      data-testid="trackside-relay-baton-panel"
      className="space-y-3"
    >
      <div className="rounded-xl ap-card px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <FlagCheckered className="w-4 h-4 ap-text-brand shrink-0" weight="duotone" />
            <span className="text-xs sm:text-sm font-extrabold text-ap-ink dark:text-ap-chalk">
              Relay Baton-Split Timing · {activeRacePreset.label}
            </span>
            <span className="px-2 py-0.5 rounded-md ap-card-inset font-mono text-2xs font-bold text-ap-clay dark:text-ap-volt">
              {legDistances.map((d) => `${d}m`).join(' → ')}
            </span>
          </div>
          <p className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark mt-0.5">
            Leg 1 records Leadoff split from gun; Legs 2–4 record Flying exchange-to-exchange splits.
          </p>
        </div>
        <button
          type="button"
          data-testid="relay-add-quartet-btn"
          onClick={onAddQuartet}
          className="ap-btn-secondary !min-h-[44px] sm:!min-h-[34px] px-3 py-1 text-xs font-bold inline-flex items-center gap-1 cursor-pointer shrink-0"
        >
          <Plus className="w-3.5 h-3.5" weight="bold" />
          <span>Add Quartet</span>
        </button>
      </div>

      <div className="space-y-3">
        {quartets.map((quartet, qIdx) => {
          const tel = relayTelemetries[qIdx];
          if (!tel) return null;
          const nextLegNum = Math.min(4, tel.completedLegs + 1);
          const isWarnAlert = /Warning/i.test(tel.exchangeAlert);

          return (
            <div
              key={quartet.id}
              data-testid={`relay-quartet-card-${quartet.id}`}
              className="rounded-2xl ap-card p-3 sm:p-4 space-y-3 border border-ap-frame/15 dark:border-ap-edge-dark"
            >
              {/* Quartet Header + Projected Finish + Big Baton CTA */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <input
                    type="text"
                    aria-label={`Relay Quartet ${qIdx + 1} Name`}
                    value={quartet.label}
                    onChange={(e) =>
                      onUpdateQuartet(quartet.id, (prev) => ({
                        ...prev,
                        label: e.target.value,
                      }))
                    }
                    className="min-h-[40px] sm:min-h-[34px] w-36 sm:w-44 rounded-lg ap-card-inset px-2.5 text-xs font-bold text-ap-ink dark:text-ap-chalk"
                  />
                  {quartets.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remove ${quartet.label}`}
                      onClick={() => onRemoveQuartet(quartet.id)}
                      className="min-h-[40px] min-w-[40px] sm:min-h-[34px] sm:min-w-[34px] rounded-lg ap-card-inset inline-flex items-center justify-center text-rose-500 cursor-pointer"
                    >
                      <Trash className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 font-mono">
                  {tel.projectedTeamFinishSecs !== null && (
                    <div
                      data-testid={`relay-projected-finish-${quartet.id}`}
                      className="px-2.5 py-1 rounded-lg bg-[#121413] text-[#D8FF2A] text-xs font-extrabold tabular-nums"
                    >
                      {tel.isFinished ? 'Official: ' : 'Proj: '}
                      {formatFatTime(tel.projectedTeamFinishSecs)}
                    </div>
                  )}

                  <button
                    type="button"
                    data-testid={`relay-baton-tap-${quartet.id}`}
                    disabled={tel.isFinished}
                    onClick={() => onTapBatonHandoff(quartet.id)}
                    className={`min-h-[48px] px-4 py-2 rounded-xl font-sans text-xs sm:text-sm font-extrabold cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                      tel.isFinished
                        ? 'ap-status-prime'
                        : 'ap-btn-primary shadow-sm'
                    }`}
                  >
                    {tel.isFinished
                      ? 'Relay Complete ✓'
                      : nextLegNum < 4
                        ? `Tap Baton Handoff · Exch ${nextLegNum}`
                        : 'Tap Anchor Finish (Leg 4)'}
                  </button>
                </div>
              </div>

              {/* Exchange Status Alert */}
              <div
                data-testid={`relay-exchange-alert-${quartet.id}`}
                className={`rounded-xl px-3 py-2 text-2xs sm:text-xs font-mono font-semibold flex items-center gap-2 ${
                  tel.isFinished
                    ? 'ap-status-prime'
                    : isWarnAlert
                      ? 'ap-status-caution'
                      : stopwatchRunning
                        ? 'ap-status-info'
                        : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark'
                }`}
              >
                <BellRinging className="w-3.5 h-3.5 shrink-0" weight="bold" />
                <span className="min-w-0 break-words">{tel.exchangeAlert}</span>
              </div>

              {/* 4 Relay Legs Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {tel.legs.map((leg, legIdx) => {
                  const isDone = leg.legSplitSecs !== null;
                  const isActiveLeg = !tel.isFinished && tel.completedLegs === legIdx;
                  return (
                    <div
                      key={`${quartet.id}-leg-${leg.legNumber}`}
                      data-testid={`relay-leg-${quartet.id}-${leg.legNumber}`}
                      className={`rounded-xl p-2.5 space-y-2 border ${
                        isActiveLeg
                          ? 'border-ap-clay dark:border-ap-volt bg-ap-clay/5 dark:bg-ap-volt/5'
                          : isDone
                            ? 'ap-card-inset border-emerald-600/30 dark:border-emerald-400/30'
                            : 'ap-card-inset border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 font-mono text-2xs">
                        <span className="font-extrabold text-ap-ink dark:text-ap-chalk">
                          Leg {leg.legNumber} · {leg.distanceMeters}m
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded font-bold ${
                            leg.timingContext === 'Leg 1 Leadoff'
                              ? 'ap-status-info'
                              : 'bg-[#121413]/10 dark:bg-white/10 text-ap-ink dark:text-ap-chalk'
                          }`}
                        >
                          {leg.timingContext}
                        </span>
                      </div>

                      <select
                        aria-label={`${quartet.label} Leg ${leg.legNumber} Athlete`}
                        data-testid={`relay-leg-select-${quartet.id}-${leg.legNumber}`}
                        value={leg.athleteId}
                        onChange={(e) => {
                          const nextId = e.target.value;
                          const matched = rosterInputs.find((r) => r.id === nextId);
                          const nextName = matched ? matched.name : `Leg ${leg.legNumber}`;
                          onUpdateQuartet(quartet.id, (prev) => {
                            const nextIds = [...prev.legRunnerIds] as [string, string, string, string];
                            const nextNames = [...prev.legRunnerNames] as [string, string, string, string];
                            nextIds[legIdx] = nextId;
                            nextNames[legIdx] = nextName;
                            return {
                              ...prev,
                              legRunnerIds: nextIds,
                              legRunnerNames: nextNames,
                            };
                          });
                        }}
                        className="w-full min-h-[40px] sm:min-h-[34px] rounded-lg border border-ap-frame/20 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 text-xs font-semibold text-ap-ink dark:text-ap-chalk"
                      >
                        <option value="">Assign Leg {leg.legNumber}…</option>
                        {rosterInputs.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>

                      <div className="flex items-baseline justify-between gap-2 font-mono pt-1 border-t border-ap-frame/10 dark:border-white/10">
                        <div>
                          <div className="text-2xs text-ap-muted dark:text-ap-muted-dark">
                            {leg.timingContext === 'Leg 1 Leadoff' ? 'Leadoff' : 'Flying Split'}
                          </div>
                          <div className="text-base font-extrabold tabular-nums text-ap-ink dark:text-ap-chalk">
                            {leg.legSplitSecs !== null ? formatFatTime(leg.legSplitSecs) : '--.--'}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-2xs text-ap-muted dark:text-ap-muted-dark">Cum</div>
                          <div className="text-xs font-bold tabular-nums text-ap-clay dark:text-ap-volt">
                            {leg.cumulativeSecs !== null ? formatFatTime(leg.cumulativeSecs) : '--:--'}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
