import React, { useMemo, useState } from 'react';
import type { ConnectedAthleteRecord, TrackSplitTimingContext } from '../../types';
import {
  buildSquadTopTimesBoard,
  optimizeTrackRelayLineup,
  type RelayCandidateInput,
  type SquadLeaderboardMarkInput,
  type TrackRelayEventType,
} from '../../physiology/trackMeetAndRelayEngine';
import { Timer, Trophy, Users } from '../icons/PhosphorIcons';

export interface ScholasticRelayAndTopTimesPanelProps {
  candidates: RelayCandidateInput[];
  roster: ConnectedAthleteRecord[];
}

const SAMPLE_BOARD_MARKS: SquadLeaderboardMarkInput[] = [
  {
    id: 'board-1',
    athleteId: 'demo-1',
    athleteName: 'Maya Chen',
    eventLabel: '400m',
    distanceMeters: 400,
    rawTimeSecs: 54.64,
    dateIso: '2026-10-24',
    meetName: 'Bay Area Twilight Invite',
    timingMethod: 'FAT',
    splitContext: 'OPEN_FAT',
  },
  {
    id: 'board-2',
    athleteId: 'demo-2',
    athleteName: 'Jordan Reyes',
    eventLabel: '400m',
    distanceMeters: 400,
    rawTimeSecs: 49.12,
    dateIso: '2026-10-17',
    meetName: 'League Dual Meet #2',
    timingMethod: 'HAND',
    splitContext: 'RELAY_LEADOFF',
  },
  {
    id: 'board-3',
    athleteId: 'demo-2',
    athleteName: 'Jordan Reyes',
    eventLabel: '400m',
    distanceMeters: 400,
    rawTimeSecs: 48.55,
    dateIso: '2026-10-24',
    meetName: 'Bay Area Twilight Invite',
    timingMethod: 'FAT',
    splitContext: 'RELAY_FLYING',
  },
  {
    id: 'board-4',
    athleteId: 'demo-3',
    athleteName: 'Liam Patel',
    eventLabel: '1600m',
    distanceMeters: 1600,
    rawTimeSecs: 256.42,
    dateIso: '2026-10-10',
    meetName: 'Pacific Collegiate Invite',
    timingMethod: 'FAT',
    splitContext: 'OPEN_FAT',
  },
];

export const ScholasticRelayAndTopTimesPanel: React.FC<
  ScholasticRelayAndTopTimesPanelProps
> = ({ candidates, roster }) => {
  const [relayEvent, setRelayEvent] = useState<TrackRelayEventType>('DMR');
  const [boardFilter, setBoardFilter] = useState<'OPEN_AND_LEADOFF' | 'FLYING_SPLITS'>(
    'OPEN_AND_LEADOFF'
  );

  const relayPlan = useMemo(
    () =>
      optimizeTrackRelayLineup({
        relayEvent,
        candidates,
      }),
    [relayEvent, candidates]
  );

  const combinedLeaderboardMarks = useMemo<SquadLeaderboardMarkInput[]>(() => {
    const derived: SquadLeaderboardMarkInput[] = [];
    for (const ath of roster) {
      for (const act of ath.activities || []) {
        if (!act.officialRaceData) continue;
        const meta = act.officialRaceData;
        const splitContext: TrackSplitTimingContext =
          meta.splitContext || (meta.timingMethod === 'HAND' ? 'HAND_CONVERTED' : 'OPEN_FAT');
        derived.push({
          id: act.id,
          athleteId: ath.id,
          athleteName: ath.name,
          eventLabel: meta.eventLabel,
          distanceMeters: meta.eventDistanceMeters,
          rawTimeSecs: meta.fatTimeSecs,
          dateIso: (act.startDateLocal || '').slice(0, 10),
          meetName: meta.meetName,
          timingMethod: meta.timingMethod || 'FAT',
          splitContext,
        });
      }
    }
    return derived.length > 0 ? derived : SAMPLE_BOARD_MARKS;
  }, [roster]);

  const topBoard = useMemo(
    () => buildSquadTopTimesBoard(combinedLeaderboardMarks),
    [combinedLeaderboardMarks]
  );

  const visibleMarks =
    boardFilter === 'OPEN_AND_LEADOFF'
      ? topBoard.openAndLeadoffMarks
      : topBoard.flyingRelaySplits;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Left 6 cols: CS + D' Relay Lineup Optimizer */}
      <div
        data-testid="relay-optimizer-panel"
        className="lg:col-span-6 rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10 p-5 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Users className="w-4 h-4 ap-text-brand" weight="duotone" />
              <span>CS + D&apos; Relay Lineup Optimizer</span>
            </h3>
            <span className="ap-status-prime px-2 py-0.5 rounded font-mono text-2xs font-bold uppercase">
              ASR Matched
            </span>
          </div>

          <div className="inline-flex items-center gap-1 p-1 rounded-xl liquid-capsule-track">
            {(['DMR', '4x400m', '4x800m'] as const).map((ev) => (
              <button
                key={ev}
                type="button"
                data-testid={`relay-event-btn-${ev}`}
                onClick={() => setRelayEvent(ev)}
                className={`min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg text-xs font-mono font-bold cursor-pointer ${
                  relayEvent === ev
                    ? 'liquid-capsule-active'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                {ev}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl ap-card-inset px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 font-mono tabular-nums">
          <div>
            <div className="text-2xs uppercase text-slate-600 dark:text-slate-300">
              Optimal Predicted {relayPlan.relayEvent}
            </div>
            <div className="text-lg font-extrabold text-slate-900 dark:text-white">
              {relayPlan.displayTotalTime}
            </div>
          </div>
          {relayPlan.gainOverDefaultSecs > 0 && (
            <span className="px-2 py-0.5 rounded ap-status-prime text-2xs font-bold">
              -{relayPlan.gainOverDefaultSecs.toFixed(2)}s vs unoptimized order
            </span>
          )}
        </div>

        <div className="space-y-2">
          {relayPlan.legs.map((leg) => (
            <div
              key={`${leg.legNumber}-${leg.athleteId}-${leg.distanceMeters}`}
              className="rounded-lg bg-white/85 dark:bg-[#101B15] border border-stone-200 dark:border-[#244331] px-3 py-2 flex items-center justify-between gap-2 text-xs"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 font-bold text-slate-900 dark:text-white">
                  <span className="font-mono text-2xs ap-text-brand">
                    Leg {leg.legNumber} ({leg.distanceMeters}m)
                  </span>
                  <span className="truncate">{leg.athleteName}</span>
                  <span className="px-1.5 py-0.5 rounded ap-card-inset font-mono text-2xs font-semibold">
                    {leg.phenotype}
                  </span>
                </div>
                <div className="text-2xs text-slate-600 dark:text-slate-300 truncate">
                  {leg.rationale}
                </div>
              </div>

              <div className="text-right font-mono tabular-nums shrink-0">
                <div className="font-extrabold text-slate-900 dark:text-white">
                  {leg.displaySplit}
                </div>
                <div className="text-2xs text-slate-500 dark:text-slate-400">
                  {leg.splitContext === 'RELAY_LEADOFF' ? 'Leadoff' : 'Flying'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right 6 cols: NFHS Hand -> FAT Top-Times Board */}
      <div
        data-testid="nfhs-top-times-board"
        className="lg:col-span-6 rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10 p-5 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Trophy className="w-4 h-4 ap-text-brand" weight="duotone" />
              <span>NFHS Hand→FAT Squad Top-Times</span>
            </h3>
            <span className="ap-status-caution px-2 py-0.5 rounded font-mono text-2xs font-bold uppercase">
              +0.24s / +0.14s Rule
            </span>
          </div>

          <div className="inline-flex items-center gap-1 p-1 rounded-xl liquid-capsule-track">
            <button
              type="button"
              data-testid="top-times-tab-open"
              onClick={() => setBoardFilter('OPEN_AND_LEADOFF')}
              className={`min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg text-2xs font-mono font-bold cursor-pointer ${
                boardFilter === 'OPEN_AND_LEADOFF'
                  ? 'liquid-capsule-active'
                  : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              Open &amp; Leadoff ({topBoard.openAndLeadoffMarks.length})
            </button>
            <button
              type="button"
              data-testid="top-times-tab-flying"
              onClick={() => setBoardFilter('FLYING_SPLITS')}
              className={`min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg text-2xs font-mono font-bold cursor-pointer ${
                boardFilter === 'FLYING_SPLITS'
                  ? 'liquid-capsule-active'
                  : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              Flying Relay ({topBoard.flyingRelaySplits.length})
            </button>
          </div>
        </div>

        <p className="text-2xs text-slate-600 dark:text-slate-300">
          Flying relay exchange splits stay isolated from official Open/Leadoff school &amp; meet qualifying boards; hand marks auto-round up to ceiling tenth + 0.24s (&lt;400m) / +0.14s (≥400m).
        </p>

        <div className="space-y-2">
          {visibleMarks.map((mark, idx) => (
            <div
              key={mark.id}
              className="rounded-lg bg-white/85 dark:bg-[#101B15] border border-stone-200 dark:border-[#244331] px-3 py-2 flex items-center justify-between gap-2 text-xs font-mono tabular-nums"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 font-sans">
                  <span className="font-mono text-2xs font-bold ap-text-brand">
                    #{idx + 1}
                  </span>
                  <span className="font-bold text-slate-900 dark:text-white truncate">
                    {mark.athleteName}
                  </span>
                  <span className="px-1.5 py-0.5 rounded ap-card-inset font-mono text-2xs">
                    {mark.eventLabel}
                  </span>
                </div>
                <div className="text-2xs text-slate-600 dark:text-slate-300 font-sans truncate">
                  {mark.meetName} · {mark.dateIso}
                </div>
              </div>

              <div className="text-right shrink-0">
                <div className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center justify-end gap-1">
                  <Timer className="w-3.5 h-3.5 ap-text-brand" weight="bold" />
                  <span>{mark.displayNormalizedTime}</span>
                </div>
                <div className="text-2xs text-slate-500 dark:text-slate-400">
                  {mark.splitContext}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
