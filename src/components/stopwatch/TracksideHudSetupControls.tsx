import React from 'react';
import type {
  CoachEventGroup,
  TrackLaneNumber,
  TrackRepDistanceMeters,
} from '../../types';
import {
  RACE_STOPWATCH_PRESETS,
  WORKOUT_STOPWATCH_PRESETS,
  type RunnerSplitTelemetry,
} from '../../hooks/useTracksideStopwatch';
import { formatTrackMark } from '../../physiology/scholasticEngine';
import {
  EVENT_GROUP_FILTER_LABELS,
  REST_OPTIONS_SECS,
} from './tracksideStopwatchHelpers';
import {
  ArrowsLeftRight,
  FlagCheckered,
  Lightning,
  Play,
  ShareNetwork,
  SpeakerHigh,
  SpeakerSlash,
  Timer,
  Waves,
  WifiSlash,
} from '../icons/PhosphorIcons';

interface ModeRadioGroupProps {
  compact?: boolean;
  sessionType: 'WORKOUT' | 'RACE';
  setSessionType: (next: 'WORKOUT' | 'RACE') => void;
  onClearFeedback: () => void;
}

export const TracksideModeRadioGroup: React.FC<ModeRadioGroupProps> = ({
  compact = false,
  sessionType,
  setSessionType,
  onClearFeedback,
}) => (
  <div
    role="radiogroup"
    aria-label="Session Mode"
    className="inline-flex items-center gap-1 p-0.5 sm:p-1 rounded-xl liquid-capsule-track shrink-0"
  >
    <button
      type="button"
      role="radio"
      aria-checked={sessionType === 'WORKOUT'}
      data-testid="stopwatch-mode-workout"
      onClick={() => {
        setSessionType('WORKOUT');
        onClearFeedback();
      }}
      className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1 rounded-lg font-bold transition-all cursor-pointer ${
        compact ? 'px-2 text-2xs' : 'px-3.5 py-1.5 text-xs gap-1.5'
      } ${
        sessionType === 'WORKOUT'
          ? 'liquid-capsule-active'
          : 'text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-ap-chalk'
      }`}
    >
      <Timer
        className={compact ? 'w-3.5 h-3.5 ap-text-brand' : 'w-4 h-4 ap-text-brand'}
        weight="duotone"
      />
      <span>WORKOUT</span>
    </button>

    <button
      type="button"
      role="radio"
      aria-checked={sessionType === 'RACE'}
      data-testid="stopwatch-mode-race"
      onClick={() => {
        setSessionType('RACE');
        onClearFeedback();
      }}
      className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1 rounded-lg font-bold transition-all cursor-pointer ${
        compact ? 'px-2 text-2xs' : 'px-3.5 py-1.5 text-xs gap-1.5'
      } ${
        sessionType === 'RACE'
          ? 'liquid-capsule-active'
          : 'text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-ap-chalk'
      }`}
    >
      <FlagCheckered
        className={compact ? 'w-3.5 h-3.5 ap-text-brand' : 'w-4 h-4 ap-text-brand'}
        weight="duotone"
      />
      <span>RACE</span>
    </button>
  </div>
);

interface HeaderBarProps {
  onOpenActivitiesTab: () => void;
  isOnline: boolean;
  onOpenDelegateTiming?: () => void;
  pendingTimingCount: number;
  soundEnabled: boolean;
  setSoundEnabled: (next: boolean) => void;
  sessionType: 'WORKOUT' | 'RACE';
  setSessionType: (next: 'WORKOUT' | 'RACE') => void;
  onClearFeedback: () => void;
}

export const TracksideHeaderBar: React.FC<HeaderBarProps> = ({
  onOpenActivitiesTab,
  isOnline,
  onOpenDelegateTiming,
  pendingTimingCount,
  soundEnabled,
  setSoundEnabled,
  sessionType,
  setSessionType,
  onClearFeedback,
}) => (
  <div className="rounded-xl ap-card px-2.5 sm:px-3.5 py-1.5 flex flex-wrap items-center justify-between gap-2">
    <div className="flex flex-wrap items-center gap-2 min-w-0">
      <button
        type="button"
        data-testid="stopwatch-back-to-log-btn"
        onClick={onOpenActivitiesTab}
        aria-label="Back to Activities"
        className="min-h-[44px] min-w-[44px] sm:min-h-[34px] sm:min-w-[34px] inline-flex items-center justify-center px-2 rounded-lg liquid-capsule-track text-xs font-mono font-bold text-ap-ink dark:text-ap-chalk cursor-pointer shrink-0"
      >
        ←
      </button>
      <h1 className="text-sm sm:text-base font-extrabold text-ap-ink dark:text-ap-chalk tracking-tight whitespace-nowrap shrink-0">
        Trackside Stopwatch
      </h1>
      {!isOnline ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-2xs font-bold ap-status-caution shrink-0">
          <WifiSlash className="w-3 h-3" weight="bold" />
          <span>Offline Safe ✓</span>
        </span>
      ) : (
        <span className="inline-flex px-2 py-0.5 rounded-lg font-mono text-2xs font-semibold ap-card-inset text-ap-muted dark:text-ap-muted-dark shrink-0">
          <span className="md:hidden">Offline Safe ✓</span>
          <span className="hidden md:inline">Saved on Device (Offline Safe ✓)</span>
        </span>
      )}
    </div>
    <div className="flex items-center gap-1.5 shrink-0">
      {onOpenDelegateTiming && (
        <button
          type="button"
          data-testid="stopwatch-delegate-timing-btn"
          onClick={onOpenDelegateTiming}
          className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-2.5 rounded-lg ap-card-inset hover:border-ap-frame/40 text-2xs font-mono font-bold text-ap-ink dark:text-ap-chalk border border-ap-frame/15 dark:border-white/15 cursor-pointer shrink-0"
        >
          <ShareNetwork className="w-3.5 h-3.5 shrink-0" weight="bold" />
          <span>Delegate</span>
          {pendingTimingCount > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-ap-clay text-[#F6F3EC] dark:bg-ap-volt dark:text-[#121413] font-mono text-2xs leading-none">
              {pendingTimingCount}
            </span>
          )}
        </button>
      )}
      <button
        type="button"
        data-testid="stopwatch-header-beep-toggle"
        aria-pressed={soundEnabled}
        onClick={() => setSoundEnabled(!soundEnabled)}
        className={`min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1 px-2 rounded-lg text-2xs font-mono font-bold border cursor-pointer shrink-0 ${
          soundEnabled
            ? 'ap-status-info'
            : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark'
        }`}
      >
        {soundEnabled ? (
          <SpeakerHigh className="w-3.5 h-3.5 shrink-0" weight="bold" />
        ) : (
          <SpeakerSlash className="w-3.5 h-3.5 shrink-0" weight="bold" />
        )}
        <span className="hidden sm:inline">{soundEnabled ? 'Beep ON' : 'Muted'}</span>
      </button>
      <TracksideModeRadioGroup
        compact
        sessionType={sessionType}
        setSessionType={setSessionType}
        onClearFeedback={onClearFeedback}
      />
    </div>
  </div>
);

interface SetupFilterControlsProps {
  sessionType: 'WORKOUT' | 'RACE';
  workoutPresetId: string;
  setWorkoutPresetId: (id: string) => void;
  raceEventLabel: string;
  setRaceEventLabel: (label: string) => void;
  customPlanPreset: { label: string } | null;
  restDurationSecs: number;
  setRestDurationSecs: (secs: number) => void;
  selectedPodFilter: string;
  setSelectedPodFilter: (pod: string) => void;
  runnerTelemetries: RunnerSplitTelemetry[];
  activePodKeys: string[];
  hasAssignedEventGroups: boolean;
  isCoachingTeam: boolean;
  selectedEventGroupFilter: 'ALL' | CoachEventGroup;
  setSelectedEventGroupFilter: (group: 'ALL' | CoachEventGroup) => void;
  injuredAthleteCount: number;
  showInjuredAthletes: boolean;
  setShowInjuredAthletes: React.Dispatch<React.SetStateAction<boolean>>;
  runnerSearchQuery: string;
  setRunnerSearchQuery: (q: string) => void;
  onlyOnTrack: boolean;
  setOnlyOnTrack: React.Dispatch<React.SetStateAction<boolean>>;
  pinnedRunnerIds: string[];
  showPinStrip: boolean;
  setShowPinStrip: React.Dispatch<React.SetStateAction<boolean>>;
  showChuteBar: boolean;
  setShowChuteBar: (v: boolean) => void;
  showEnvPhysicsPanel: boolean;
  setShowEnvPhysicsPanel: React.Dispatch<React.SetStateAction<boolean>>;
  hasCustomEnvOrLane: boolean;
  trackLane: TrackLaneNumber;
  lapLengthMeters: number;
}

export const TracksideSetupFilterControls: React.FC<SetupFilterControlsProps> = ({
  sessionType,
  workoutPresetId,
  setWorkoutPresetId,
  raceEventLabel,
  setRaceEventLabel,
  customPlanPreset,
  restDurationSecs,
  setRestDurationSecs,
  selectedPodFilter,
  setSelectedPodFilter,
  runnerTelemetries,
  activePodKeys,
  hasAssignedEventGroups,
  isCoachingTeam,
  selectedEventGroupFilter,
  setSelectedEventGroupFilter,
  injuredAthleteCount,
  showInjuredAthletes,
  setShowInjuredAthletes,
  runnerSearchQuery,
  setRunnerSearchQuery,
  onlyOnTrack,
  setOnlyOnTrack,
  pinnedRunnerIds,
  showPinStrip,
  setShowPinStrip,
  showChuteBar,
  setShowChuteBar,
  showEnvPhysicsPanel,
  setShowEnvPhysicsPanel,
  hasCustomEnvOrLane,
  trackLane,
  lapLengthMeters,
}) => (
  <>
    <div className="min-w-[140px] flex-1 sm:flex-initial sm:w-52">
      {sessionType === 'WORKOUT' ? (
        <select
          aria-label="Workout Preset"
          value={workoutPresetId}
          onChange={(e) => setWorkoutPresetId(e.target.value)}
          className="min-h-[44px] sm:min-h-[38px] rounded-xl ap-card-inset font-sans font-semibold text-ap-ink dark:text-ap-chalk focus:outline-none focus:ring-2 focus:ring-ap-clay dark:focus:ring-ap-volt w-full px-3 text-xs"
        >
          {customPlanPreset && (
            <option
              value="custom-plan"
              className="bg-white dark:bg-ap-carbon text-ap-ink dark:text-ap-chalk"
            >
              Planned: {customPlanPreset.label}
            </option>
          )}
          {WORKOUT_STOPWATCH_PRESETS.map((p) => (
            <option
              key={p.id}
              value={p.id}
              className="bg-white dark:bg-ap-carbon text-ap-ink dark:text-ap-chalk"
            >
              {p.label}
            </option>
          ))}
        </select>
      ) : (
        <select
          aria-label="Race Event Distance"
          value={raceEventLabel}
          onChange={(e) => setRaceEventLabel(e.target.value)}
          className="min-h-[44px] sm:min-h-[38px] rounded-xl ap-card-inset font-sans font-semibold text-ap-ink dark:text-ap-chalk focus:outline-none focus:ring-2 focus:ring-ap-clay dark:focus:ring-ap-volt w-full px-3 text-xs"
        >
          {RACE_STOPWATCH_PRESETS.map((evt) => (
            <option
              key={evt.label}
              value={evt.label}
              className="bg-white dark:bg-ap-carbon text-ap-ink dark:text-ap-chalk"
            >
              {evt.label}
              {evt.targetLaps ? ` (${evt.targetLaps} x ${evt.splitMeters}m)` : ' (Open Laps)'}
            </option>
          ))}
        </select>
      )}
    </div>

    {sessionType === 'WORKOUT' && (
      <div className="w-48 shrink-0">
        <select
          aria-label="Recovery Countdown"
          title="Auto Recovery Countdown"
          value={restDurationSecs}
          onChange={(e) => setRestDurationSecs(Number(e.target.value))}
          className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card-inset px-3 text-xs font-mono font-semibold text-ap-ink dark:text-ap-chalk focus:outline-none focus:ring-2 focus:ring-ap-clay dark:focus:ring-ap-volt"
        >
          {REST_OPTIONS_SECS.map((sec) => (
            <option
              key={sec}
              value={sec}
              className="bg-white dark:bg-ap-carbon text-ap-ink dark:text-ap-chalk"
            >
              {sec === 0 ? 'Recovery: Open (Manual)' : `Auto Rest: ${sec}s Countdown`}
            </option>
          ))}
        </select>
      </div>
    )}

    <select
      aria-label="Filter runners by pacing pod"
      value={selectedPodFilter}
      onChange={(e) => setSelectedPodFilter(e.target.value)}
      className="min-h-[44px] sm:min-h-[38px] rounded-xl ap-card-inset px-2.5 text-xs font-mono font-semibold text-ap-ink dark:text-ap-chalk cursor-pointer"
    >
      <option value="ALL">All ({runnerTelemetries.length})</option>
      {activePodKeys.map((podKey) => {
        const count = runnerTelemetries.filter((t) => t.podKey === podKey).length;
        return (
          <option key={podKey} value={podKey}>
            {podKey} ({count})
          </option>
        );
      })}
    </select>

    {(hasAssignedEventGroups || isCoachingTeam) && (
      <select
        data-testid="stopwatch-event-group-filter"
        aria-label="Filter runners by event group"
        value={selectedEventGroupFilter}
        onChange={(e) =>
          setSelectedEventGroupFilter(e.target.value as 'ALL' | CoachEventGroup)
        }
        className="min-h-[44px] sm:min-h-[38px] rounded-xl ap-card-inset px-2.5 text-xs font-mono font-semibold text-ap-ink dark:text-ap-chalk cursor-pointer"
      >
        <option value="ALL">All Groups</option>
        {EVENT_GROUP_FILTER_LABELS.map((grp) => (
          <option key={grp.value} value={grp.value}>
            {grp.label}
          </option>
        ))}
      </select>
    )}

    {injuredAthleteCount > 0 && (
      <button
        type="button"
        data-testid="stopwatch-show-injured-toggle"
        aria-pressed={showInjuredAthletes}
        onClick={() => setShowInjuredAthletes((prev) => !prev)}
        className={`min-h-[44px] sm:min-h-[38px] px-2.5 rounded-xl text-2xs font-mono font-bold border cursor-pointer ${
          showInjuredAthletes
            ? 'ap-status-caution'
            : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark border-transparent'
        }`}
      >
        {showInjuredAthletes
          ? `Hiding Injured OFF (${injuredAthleteCount})`
          : `Show Injured (${injuredAthleteCount})`}
      </button>
    )}

    <input
      type="search"
      aria-label="Find runner"
      value={runnerSearchQuery}
      onChange={(e) => setRunnerSearchQuery(e.target.value)}
      placeholder="Find runner..."
      className="min-h-[44px] sm:min-h-[38px] w-32 sm:w-40 rounded-xl ap-card-inset px-2.5 text-xs text-ap-ink dark:text-ap-chalk"
    />

    <div className="inline-flex items-center gap-1 shrink-0">
      <button
        type="button"
        data-testid="stopwatch-on-track-toggle"
        aria-pressed={onlyOnTrack}
        onClick={() => {
          if (pinnedRunnerIds.length === 0) setShowPinStrip(true);
          else setOnlyOnTrack((prev) => !prev);
        }}
        className={`min-h-[44px] sm:min-h-[38px] px-2.5 rounded-xl text-2xs font-mono font-bold border cursor-pointer ${
          onlyOnTrack && pinnedRunnerIds.length > 0
            ? 'liquid-capsule-active border-ap-frame/30 dark:border-ap-volt/50'
            : 'ap-card-inset text-ap-ink dark:text-ap-chalk border-transparent'
        }`}
      >
        On Track{pinnedRunnerIds.length > 0 ? ` (${pinnedRunnerIds.length})` : ''}
      </button>
      <button
        type="button"
        aria-expanded={showPinStrip}
        onClick={() => setShowPinStrip((prev) => !prev)}
        className="min-h-[44px] sm:min-h-[38px] px-2 rounded-xl ap-card-inset text-2xs font-mono font-semibold text-ap-muted dark:text-ap-muted-dark cursor-pointer"
        title="Choose runners currently on the track"
      >
        {showPinStrip ? 'Hide Heat' : 'Pin Heat'}
      </button>
    </div>

    {sessionType === 'WORKOUT' && (
      <button
        type="button"
        data-testid="stopwatch-toggle-chute"
        aria-pressed={showChuteBar}
        onClick={() => setShowChuteBar(!showChuteBar)}
        className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1 px-2.5 rounded-xl text-2xs font-semibold border cursor-pointer shrink-0 ${
          showChuteBar
            ? 'ap-status-info font-bold'
            : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark'
        }`}
      >
        <Lightning className="w-3.5 h-3.5" weight="bold" />
        <span>Chute</span>
      </button>
    )}

    <button
      type="button"
      data-testid="stopwatch-toggle-env-physics"
      aria-expanded={showEnvPhysicsPanel}
      onClick={() => setShowEnvPhysicsPanel((prev) => !prev)}
      className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1 px-2.5 rounded-xl text-2xs font-semibold border cursor-pointer shrink-0 ${
        hasCustomEnvOrLane
          ? 'ap-status-caution font-bold'
          : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark'
      }`}
    >
      <Waves className="w-3.5 h-3.5" weight="bold" />
      <span>
        {trackLane > 1 ? `L${trackLane} (${lapLengthMeters.toFixed(0)}m)` : 'Lane / Env'}
      </span>
    </button>
  </>
);

interface WorkoutRepControlsProps {
  stopwatchRunning: boolean;
  restDurationSecs: number;
  podsAwaitingNextRep: Array<{ podKey: string; runnerIds: string[]; waitingCount: number }>;
  repCount: number;
  repDistanceMeters: TrackRepDistanceMeters;
  setCustomRepOverride: (count: number) => void;
  setCustomDistOverride: (dist: TrackRepDistanceMeters) => void;
  startNextRepAll: (targets: string[]) => number;
  startNextRepForPod: (podKey: string, runnerIds: string[]) => number;
  playFeedback: (kind: 'GUN' | 'SPLIT' | 'CHUTE' | 'BELL') => void;
  setLiveAnnouncement: (msg: string) => void;
}

export const TracksideWorkoutRepControls: React.FC<WorkoutRepControlsProps> = ({
  stopwatchRunning,
  restDurationSecs,
  podsAwaitingNextRep,
  repCount,
  repDistanceMeters,
  setCustomRepOverride,
  setCustomDistOverride,
  startNextRepAll,
  startNextRepForPod,
  playFeedback,
  setLiveAnnouncement,
}) => (
  <div
    data-testid="stopwatch-rep-stepper"
    className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 pt-2 border-t border-ap-frame/15 dark:border-white/10"
  >
    {!stopwatchRunning && (
      <>
        <div className="inline-flex items-center gap-1 shrink-0">
          <span className="text-2xs font-mono uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark">
            Reps
          </span>
          <button
            type="button"
            data-testid="stopwatch-rep-dec"
            aria-label="Decrease workout rep count"
            onClick={() => setCustomRepOverride(Math.max(1, repCount - 1))}
            className="min-h-[44px] min-w-[40px] sm:min-h-[34px] sm:min-w-[34px] rounded-lg ap-card-inset font-mono text-sm font-bold text-ap-ink dark:text-white cursor-pointer"
          >
            -
          </button>
          <span
            data-testid="stopwatch-rep-count"
            className="px-1.5 font-mono text-xs font-bold tabular-nums text-ap-ink dark:text-white whitespace-nowrap"
          >
            {repCount} reps
          </span>
          <button
            type="button"
            data-testid="stopwatch-rep-inc"
            aria-label="Increase workout rep count"
            onClick={() => setCustomRepOverride(Math.min(30, repCount + 1))}
            className="min-h-[44px] min-w-[40px] sm:min-h-[34px] sm:min-w-[34px] rounded-lg ap-card-inset font-mono text-sm font-bold text-ap-ink dark:text-white cursor-pointer"
          >
            +
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Quick rep distance">
          {([30, 60, 100, 200, 400, 800, 1000, 1600] as const).map((dist) => {
            const isSelected = repDistanceMeters === dist;
            return (
              <button
                key={dist}
                type="button"
                data-testid={`stopwatch-dist-${dist}`}
                aria-pressed={isSelected}
                onClick={() => setCustomDistOverride(dist)}
                className={`min-h-[44px] sm:min-h-[34px] px-2 sm:px-2.5 rounded-lg font-mono text-2xs font-bold transition-colors cursor-pointer ${
                  isSelected
                    ? 'liquid-capsule-active text-ap-ink dark:text-white'
                    : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-white'
                }`}
              >
                {dist}m
              </button>
            );
          })}
        </div>
      </>
    )}

    {stopwatchRunning && restDurationSecs > 0 && podsAwaitingNextRep.length > 0 && (
      <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto sm:ml-auto">
        <button
          type="button"
          data-testid="stopwatch-start-next-rep-btn"
          onClick={() => {
            const allTargets = Array.from(
              new Set(podsAwaitingNextRep.flatMap((p) => [p.podKey, ...p.runnerIds]))
            );
            const startSecs = startNextRepAll(allTargets);
            playFeedback('GUN');
            setLiveAnnouncement(
              `Started next rep for resting runners at ${formatTrackMark(startSecs, 2)}`
            );
          }}
          className="min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1 px-3 rounded-lg ap-btn-primary text-2xs font-bold cursor-pointer"
        >
          <Play className="w-3.5 h-3.5" weight="fill" />
          <span>Start Next Rep</span>
        </button>
        {podsAwaitingNextRep.length > 1 &&
          podsAwaitingNextRep.map((pod) => (
            <button
              key={`next-rep-${pod.podKey}`}
              type="button"
              data-testid={`stopwatch-start-next-rep-${pod.podKey}`}
              onClick={() => {
                const startSecs = startNextRepForPod(pod.podKey, pod.runnerIds);
                playFeedback('GUN');
                setLiveAnnouncement(
                  `Started next rep for ${pod.podKey} at ${formatTrackMark(startSecs, 2)}`
                );
              }}
              className="min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg ap-status-info font-mono text-2xs font-bold cursor-pointer"
            >
              Go {pod.podKey} ({pod.waitingCount})
            </button>
          ))}
      </div>
    )}
  </div>
);

interface RecentSwapStripProps {
  tapGapSecs: number;
  prevRunnerName: string;
  lastRunnerName: string;
  onSwapLastTwo: () => void;
}

export const TracksideRecentSwapStrip: React.FC<RecentSwapStripProps> = ({
  tapGapSecs,
  prevRunnerName,
  lastRunnerName,
  onSwapLastTwo,
}) => (
  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl ap-status-info px-3 py-2 text-xs">
    <span className="font-mono font-semibold truncate">
      Close finish detected ({tapGapSecs.toFixed(2)}s gap): {prevRunnerName} → {lastRunnerName}
    </span>
    <button
      type="button"
      data-testid="stopwatch-swap-last-two-btn"
      onClick={onSwapLastTwo}
      className="min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1.5 px-3 rounded-lg bg-[#121413] text-[#D8FF2A] font-mono text-2xs font-bold cursor-pointer shrink-0"
    >
      <ArrowsLeftRight className="w-3.5 h-3.5" weight="bold" />
      <span>Swap Last 2</span>
    </button>
  </div>
);
