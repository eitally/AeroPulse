import React from 'react';
import type {
  NcaaTrackFacilityType,
  TrackFootwearClass,
  TrackLaneNumber,
  TrackSplitEnvironmentAdjustment,
  TrackWorkoutSpec,
  VdotTrainingPod,
} from '../../types';
import {
  DEFAULT_POD_WAVE_OFFSETS,
  type RunnerSplitTelemetry,
  type TracksideWaveMode,
} from '../../hooks/useTracksideStopwatch';
import { computeWorldAthleticsOvalLaneGeometry } from '../../physiology/scholasticEngine';
import { STORAGE_KEYS } from '../../utils/storageKeys';
import {
  SpeakerHigh,
  SpeakerSlash,
  Sun,
  Trash,
  Waves,
} from '../icons/PhosphorIcons';

export interface TracksideEnvPhysicsPanelProps {
  showEnvPhysicsPanel: boolean;
  trackLane: TrackLaneNumber;
  setTrackLane: (lane: TrackLaneNumber) => void;
  trackFacility: NcaaTrackFacilityType;
  setTrackFacility: (facility: NcaaTrackFacilityType) => void;
  airTempF: number | null;
  setAirTempF: (val: number | null) => void;
  dewPointF: number | null;
  setDewPointF: (val: number | null) => void;
  windSpeedMps: number;
  setWindSpeedMps: (val: number) => void;
  altitudeMeters: number;
  setAltitudeMeters: (val: number) => void;
  footwearClass: TrackFootwearClass;
  setFootwearClass: (val: TrackFootwearClass) => void;
  isStaggeredStart: boolean;
  setIsStaggeredStart: (val: boolean) => void;
  laneGeometry: ReturnType<typeof computeWorldAthleticsOvalLaneGeometry>;
  activeEnvAdjustment: TrackSplitEnvironmentAdjustment;
}

export const TracksideEnvPhysicsPanel: React.FC<TracksideEnvPhysicsPanelProps> = ({
  showEnvPhysicsPanel,
  trackLane,
  setTrackLane,
  trackFacility,
  setTrackFacility,
  airTempF,
  setAirTempF,
  dewPointF,
  setDewPointF,
  windSpeedMps,
  setWindSpeedMps,
  altitudeMeters,
  setAltitudeMeters,
  footwearClass,
  setFootwearClass,
  isStaggeredStart,
  setIsStaggeredStart,
  laneGeometry,
  activeEnvAdjustment,
}) => {
  if (!showEnvPhysicsPanel) return null;

  return (
    <div
      data-testid="stopwatch-env-physics-panel"
      className="rounded-xl ap-card-inset p-3.5 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-2xs font-mono font-bold uppercase tracking-wider text-ap-ink dark:text-ap-chalk">
            World Athletics Oval Lane, Environment &amp; Spike Physics
          </div>
          <div className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark mt-0.5">
            {activeEnvAdjustment.advisoryNote}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="px-2 py-0.5 rounded-lg ap-status-prime font-mono text-2xs font-bold tabular-nums">
            {laneGeometry.lapLengthMeters.toFixed(2)}m/lap · +
            {((activeEnvAdjustment.combinedSplitMultiplier - 1) * 100).toFixed(1)}%
          </span>
          {activeEnvAdjustment.altitudeRestMultiplier > 1 && (
            <span className="px-2 py-0.5 rounded-lg ap-status-info font-mono text-2xs font-bold tabular-nums">
              Rest {activeEnvAdjustment.adjustedRestDurationSecs}s (
              {activeEnvAdjustment.altitudeRestMultiplier.toFixed(2)}x)
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
        <label className="space-y-1">
          <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
            Oval Lane
          </span>
          <select
            data-testid="stopwatch-lane-select"
            value={trackLane}
            onChange={(e) => setTrackLane(Number(e.target.value) as TrackLaneNumber)}
            className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card px-2.5 text-xs font-mono font-semibold text-ap-ink dark:text-ap-chalk"
          >
            {([1, 2, 3, 4, 5, 6, 7, 8] as TrackLaneNumber[]).map((ln) => {
              const g = computeWorldAthleticsOvalLaneGeometry(ln);
              return (
                <option key={ln} value={ln}>
                  L{ln} ({g.lapLengthMeters.toFixed(2)}m)
                </option>
              );
            })}
          </select>
        </label>

        <label className="space-y-1">
          <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
            Track Facility
          </span>
          <select
            data-testid="stopwatch-facility-select"
            value={trackFacility}
            onChange={(e) => setTrackFacility(e.target.value as NcaaTrackFacilityType)}
            className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card px-2.5 text-xs font-mono font-semibold text-ap-ink dark:text-ap-chalk"
          >
            <option value="OUTDOOR_400M">400m Outdoor</option>
            <option value="INDOOR_BANKED_200M">200m Banked</option>
            <option value="INDOOR_FLAT_200M">200m Flat (+Turn)</option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
            Air Temp (°F)
          </span>
          <input
            data-testid="stopwatch-temp-input"
            type="number"
            min={15}
            max={120}
            placeholder="72"
            value={airTempF ?? ''}
            onChange={(e) =>
              setAirTempF(e.target.value === '' ? null : Number(e.target.value))
            }
            className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card px-2.5 text-xs font-mono tabular-nums text-ap-ink dark:text-ap-chalk"
          />
        </label>

        <label className="space-y-1">
          <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
            Dew Point (°F)
          </span>
          <input
            data-testid="stopwatch-dew-input"
            type="number"
            min={10}
            max={90}
            placeholder="55"
            value={dewPointF ?? ''}
            onChange={(e) =>
              setDewPointF(e.target.value === '' ? null : Number(e.target.value))
            }
            className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card px-2.5 text-xs font-mono tabular-nums text-ap-ink dark:text-ap-chalk"
          />
        </label>

        <label className="space-y-1">
          <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
            Wind (m/s)
          </span>
          <input
            data-testid="stopwatch-wind-input"
            type="number"
            min={0}
            max={25}
            step={0.5}
            value={windSpeedMps}
            onChange={(e) => setWindSpeedMps(Number(e.target.value) || 0)}
            className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card px-2.5 text-xs font-mono tabular-nums text-ap-ink dark:text-ap-chalk"
          />
        </label>

        <label className="space-y-1">
          <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
            Altitude (m)
          </span>
          <input
            data-testid="stopwatch-altitude-input"
            type="number"
            min={0}
            max={4000}
            step={50}
            value={altitudeMeters}
            onChange={(e) => setAltitudeMeters(Number(e.target.value) || 0)}
            className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card px-2.5 text-xs font-mono tabular-nums text-ap-ink dark:text-ap-chalk"
          />
        </label>

        <label className="space-y-1 col-span-2 sm:col-span-2 lg:col-span-1">
          <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
            Footwear
          </span>
          <select
            data-testid="stopwatch-footwear-select"
            value={footwearClass}
            onChange={(e) => setFootwearClass(e.target.value as TrackFootwearClass)}
            className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card px-2.5 text-xs font-mono font-semibold text-ap-ink dark:text-ap-chalk"
          >
            <option value="DAILY_TRAINER">Daily Trainer (1.0x)</option>
            <option value="LIGHTWEIGHT_FLAT_SUPER_TRAINER">Super Trainer / Flat (1.1x)</option>
            <option value="CARBON_ROAD_RACER">Carbon Road Racer (1.2x)</option>
            <option value="TRADITIONAL_TRACK_SPIKE">Track Spike (1.35x)</option>
            <option value="CARBON_SUPER_SPIKE">Carbon Super-Spike (1.52x)</option>
          </select>
        </label>
      </div>

      {trackLane > 1 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            data-testid="stopwatch-stagger-toggle"
            aria-pressed={isStaggeredStart}
            onClick={() => setIsStaggeredStart(!isStaggeredStart)}
            className={`min-h-[44px] sm:min-h-[34px] px-3 rounded-lg text-2xs font-mono font-semibold cursor-pointer ${
              isStaggeredStart
                ? 'ap-status-info font-bold'
                : 'ap-card text-ap-muted dark:text-ap-muted-dark'
            }`}
          >
            {isStaggeredStart
              ? 'Staggered Starts Active (Exact 400m Mark Eq)'
              : 'Non-Staggered Lane Distance (Scaling Lap Split)'}
          </button>
        </div>
      )}
    </div>
  );
};

export interface TracksideWaveOffsetsPanelProps {
  waveMode: TracksideWaveMode;
  activePodKeys: string[];
  podWaveOffsetsSecs: Record<string, number>;
  stopwatchRunning: boolean;
  setPodWaveOffset: (podKey: string, offsetSecs: number) => void;
  triggerPodWaveNow: (podKey: string) => void;
}

export const TracksideWaveOffsetsPanel: React.FC<TracksideWaveOffsetsPanelProps> = ({
  waveMode,
  activePodKeys,
  podWaveOffsetsSecs,
  stopwatchRunning,
  setPodWaveOffset,
  triggerPodWaveNow,
}) => {
  if (waveMode !== 'POD_STAGGER' && waveMode !== 'PURSUIT') return null;

  return (
    <div className="rounded-xl ap-card-inset p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
        <span className="font-bold uppercase tracking-wider">
          {waveMode === 'PURSUIT'
            ? 'Pursuit Stagger Offsets — Finish Together'
            : 'Staggered Pod Start Offsets'}
        </span>
        <span>Adjust (-5s / +5s) or tap Go Now</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {activePodKeys.map((podKey) => {
          const offset = podWaveOffsetsSecs[podKey] ?? DEFAULT_POD_WAVE_OFFSETS[podKey] ?? 0;
          return (
            <div
              key={podKey}
              className="rounded-xl bg-white dark:bg-ap-carbon border border-ap-frame/15 dark:border-ap-edge-dark px-3 py-2 flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="text-xs font-bold text-ap-ink dark:text-ap-chalk truncate">
                  {podKey}
                </div>
                <div className="text-2xs font-mono text-ap-clay dark:text-ap-volt">
                  +{offset.toFixed(1)}s offset
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setPodWaveOffset(podKey, Math.max(0, offset - 5))}
                  aria-label={`Decrease ${podKey} offset by 5 seconds`}
                  className="min-h-[44px] sm:min-h-[32px] min-w-[36px] px-2 rounded-lg ap-card-inset font-mono text-2xs font-bold cursor-pointer"
                >
                  -5s
                </button>
                <button
                  type="button"
                  onClick={() => setPodWaveOffset(podKey, offset + 5)}
                  aria-label={`Increase ${podKey} offset by 5 seconds`}
                  className="min-h-[44px] sm:min-h-[32px] min-w-[36px] px-2 rounded-lg ap-card-inset font-mono text-2xs font-bold cursor-pointer"
                >
                  +5s
                </button>
                {stopwatchRunning && (
                  <button
                    type="button"
                    onClick={() => triggerPodWaveNow(podKey)}
                    className="min-h-[44px] sm:min-h-[32px] px-2 rounded-lg ap-status-info font-mono text-2xs font-bold cursor-pointer"
                    title={`Stamp ${podKey} start at current clock`}
                  >
                    Go Now
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export interface TracksideMultiSetAndPinStripProps {
  sessionType: 'WORKOUT' | 'RACE';
  customWorkoutSpec: TrackWorkoutSpec | null;
  showPinStrip: boolean;
  runnerTelemetries: RunnerSplitTelemetry[];
  pinnedRunnerIds: string[];
  onTogglePinnedRunner: (runnerId: string) => void;
  onClearPinnedRunners: () => void;
}

export const TracksideMultiSetStrip: React.FC<{
  sessionType: 'WORKOUT' | 'RACE';
  customWorkoutSpec: TrackWorkoutSpec | null;
}> = ({ sessionType, customWorkoutSpec }) => {
  if (
    sessionType !== 'WORKOUT' ||
    !customWorkoutSpec?.sets ||
    customWorkoutSpec.sets.length <= 1
  ) {
    return null;
  }
  return (
    <div
      data-testid="stopwatch-multiset-plan-strip"
      className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-ap-frame/15 dark:border-white/10 text-2xs font-mono"
    >
      <span className="font-bold uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark mr-1">
        Multi-Set Plan:
      </span>
      {customWorkoutSpec.warmupDistanceMeters && (
        <span className="px-2 py-0.5 rounded bg-ap-inset dark:bg-ap-turf text-ap-ink dark:text-ap-chalk">
          WU {(customWorkoutSpec.warmupDistanceMeters / 1609.344).toFixed(1)}mi
        </span>
      )}
      {customWorkoutSpec.sets.map((s, idx) => (
        <span
          key={`sw-set-${idx}`}
          className="px-2 py-0.5 rounded bg-ap-inset dark:bg-ap-turf text-ap-clay dark:text-ap-volt font-semibold"
        >
          {s.repCount}×{s.repDistanceMeters}m
        </span>
      ))}
      {customWorkoutSpec.cooldownDistanceMeters && (
        <span className="px-2 py-0.5 rounded bg-ap-inset dark:bg-ap-turf text-ap-ink dark:text-ap-chalk">
          CD {(customWorkoutSpec.cooldownDistanceMeters / 1609.344).toFixed(1)}mi
        </span>
      )}
    </div>
  );
};

export const TracksidePinHeatStrip: React.FC<{
  showPinStrip: boolean;
  runnerTelemetries: RunnerSplitTelemetry[];
  pinnedRunnerIds: string[];
  onTogglePinnedRunner: (runnerId: string) => void;
  onClearPinnedRunners: () => void;
}> = ({
  showPinStrip,
  runnerTelemetries,
  pinnedRunnerIds,
  onTogglePinnedRunner,
  onClearPinnedRunners,
}) => {
  if (!showPinStrip) return null;
  return (
    <div
      data-testid="stopwatch-pin-strip"
      className="rounded-xl ap-card px-3 py-2 flex flex-wrap items-center gap-1.5 text-2xs"
    >
      <span className="font-mono font-bold uppercase text-ap-muted dark:text-ap-muted-dark mr-1">
        Heat / On Track:
      </span>
      {runnerTelemetries.map((t) => {
        const pinned = pinnedRunnerIds.includes(t.runnerId);
        return (
          <button
            key={t.runnerId}
            type="button"
            aria-pressed={pinned}
            onClick={() => onTogglePinnedRunner(t.runnerId)}
            className={`min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg font-semibold cursor-pointer ${
              pinned
                ? 'liquid-capsule-active text-ap-ink dark:text-white'
                : 'ap-card-inset text-ap-ink dark:text-ap-chalk'
            }`}
          >
            {t.runnerName}
          </button>
        );
      })}
      {pinnedRunnerIds.length > 0 && (
        <button
          type="button"
          onClick={onClearPinnedRunners}
          className="min-h-[44px] sm:min-h-[34px] px-2 rounded-lg font-mono text-ap-muted dark:text-ap-muted-dark underline cursor-pointer"
        >
          Clear Heat
        </button>
      )}
    </div>
  );
};

export interface TracksideToolsPanelProps {
  sessionType: 'WORKOUT' | 'RACE';
  sessionTitle: string;
  setSessionTitle: (title: string) => void;
  wakeLockEnabled: boolean;
  setWakeLockEnabled: (enabled: boolean) => void;
  wakeLockState: 'ACTIVE' | 'IDLE' | 'UNSUPPORTED';
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  keyboardShortcutsEnabled: boolean;
  setKeyboardShortcutsEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  waveMode: TracksideWaveMode;
  setWaveMode: (mode: TracksideWaveMode) => void;
  vdotPods: VdotTrainingPod[];
  activePodKeys: string[];
  podWaveOffsetsSecs: Record<string, number>;
  stopwatchRunning: boolean;
  setPodWaveOffset: (podKey: string, offsetSecs: number) => void;
  triggerPodWaveNow: (podKey: string) => void;
  hasActiveSession: boolean;
  confirmReset: boolean;
  setConfirmReset: (val: boolean) => void;
  onResetStopwatch: () => void;
  onClearFeedback: () => void;
}

export const TracksideToolsPanel: React.FC<TracksideToolsPanelProps> = ({
  sessionType,
  sessionTitle,
  setSessionTitle,
  wakeLockEnabled,
  setWakeLockEnabled,
  wakeLockState,
  soundEnabled,
  setSoundEnabled,
  keyboardShortcutsEnabled,
  setKeyboardShortcutsEnabled,
  waveMode,
  setWaveMode,
  vdotPods,
  activePodKeys,
  podWaveOffsetsSecs,
  stopwatchRunning,
  setPodWaveOffset,
  triggerPodWaveNow,
  hasActiveSession,
  confirmReset,
  setConfirmReset,
  onResetStopwatch,
  onClearFeedback,
}) => {
  const toggleKeyboardShortcuts = () => {
    setKeyboardShortcutsEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEYS.STOPWATCH_SHORTCUTS, next ? '1' : '0');
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  return (
    <div className="pt-2.5 space-y-3 border-t border-ap-frame/15 dark:border-white/10">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1 text-2xs font-mono font-semibold text-ap-muted dark:text-ap-muted-dark">
          <span>{sessionType === 'RACE' ? 'Meet / Heat Name' : 'Session Name'}</span>
          <input
            type="text"
            value={sessionTitle}
            onChange={(e) => setSessionTitle(e.target.value)}
            placeholder={
              sessionType === 'RACE' ? 'e.g. League Finals Heat 1' : 'e.g. Tuesday Track Intervals'
            }
            aria-label="Meet or Session Name"
            className="min-h-[44px] sm:min-h-[38px] rounded-xl ap-card-inset px-3 text-xs font-sans text-ap-ink dark:text-ap-chalk placeholder:text-ap-muted dark:placeholder:text-ap-muted-dark focus:outline-none focus:ring-2 focus:ring-ap-clay dark:focus:ring-ap-volt"
          />
        </label>

        <div className="flex flex-col gap-1 text-2xs font-mono font-semibold text-ap-muted dark:text-ap-muted-dark">
          <span>Trackside Hardware &amp; Keys</span>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              aria-pressed={wakeLockEnabled}
              onClick={() => setWakeLockEnabled(!wakeLockEnabled)}
              className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center justify-center gap-1.5 px-2.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                wakeLockEnabled
                  ? wakeLockState === 'ACTIVE'
                    ? 'ap-status-prime'
                    : 'ap-status-info'
                  : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark'
              }`}
              title="Keep mobile display awake while timing live track sessions"
            >
              <Sun className="w-3.5 h-3.5 shrink-0" weight="bold" />
              <span className="truncate">
                {wakeLockEnabled ? (wakeLockState === 'ACTIVE' ? 'Awake On' : 'Wake Ready') : 'Wake Off'}
              </span>
            </button>

            <button
              type="button"
              aria-pressed={soundEnabled}
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center justify-center gap-1.5 px-2.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                soundEnabled ? 'ap-status-info' : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark'
              }`}
              title="Play crisp Web Audio confirmation beep + vibration on splits"
            >
              {soundEnabled ? (
                <SpeakerHigh className="w-3.5 h-3.5 shrink-0" weight="bold" />
              ) : (
                <SpeakerSlash className="w-3.5 h-3.5 shrink-0" weight="bold" />
              )}
              <span>{soundEnabled ? 'Beep On' : 'Muted'}</span>
            </button>

            <button
              type="button"
              data-testid="stopwatch-shortcuts-toggle"
              aria-pressed={keyboardShortcutsEnabled}
              onClick={toggleKeyboardShortcuts}
              className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center justify-center gap-1 px-2 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                keyboardShortcutsEnabled
                  ? 'ap-status-info'
                  : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark'
              }`}
              title="Enable or disable single-key shortcuts (Space, 1-9, C, Z)"
            >
              <span>{keyboardShortcutsEnabled ? 'Keys On' : 'Keys Off'}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label="Start Wave Mode"
          className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl liquid-capsule-track"
        >
          <button
            type="button"
            aria-pressed={waveMode === 'MASS'}
            onClick={() => setWaveMode('MASS')}
            className={`min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg text-xs font-semibold cursor-pointer ${
              waveMode === 'MASS'
                ? 'liquid-capsule-active'
                : 'text-ap-muted dark:text-ap-muted-dark'
            }`}
          >
            Mass Gun
          </button>
          <button
            type="button"
            data-testid="stopwatch-wave-toggle"
            aria-pressed={waveMode === 'POD_STAGGER'}
            onClick={() => {
              const nextMode = waveMode === 'POD_STAGGER' ? 'MASS' : 'POD_STAGGER';
              setWaveMode(nextMode);
              if (nextMode === 'POD_STAGGER') {
                for (const [podKey, defOffset] of Object.entries(DEFAULT_POD_WAVE_OFFSETS)) {
                  setPodWaveOffset(podKey, defOffset);
                }
              }
            }}
            className={`min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1 px-2.5 rounded-lg text-xs font-semibold cursor-pointer ${
              waveMode === 'POD_STAGGER'
                ? 'liquid-capsule-active ap-status-caution font-bold'
                : 'text-ap-muted dark:text-ap-muted-dark'
            }`}
          >
            <Waves className="w-3.5 h-3.5" weight="bold" />
            <span>Pod +10s</span>
          </button>
          <button
            type="button"
            data-testid="stopwatch-wave-pursuit"
            aria-pressed={waveMode === 'PURSUIT'}
            onClick={() => {
              setWaveMode('PURSUIT');
              for (const pod of vdotPods) {
                const podKey = pod.podName.split(' — ')[0] || pod.podName;
                if (typeof pod.pursuitStaggerOffsetSecs === 'number') {
                  setPodWaveOffset(podKey, pod.pursuitStaggerOffsetSecs);
                }
              }
            }}
            className={`min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg text-xs font-semibold cursor-pointer ${
              waveMode === 'PURSUIT'
                ? 'liquid-capsule-active ap-status-prime font-bold'
                : 'text-ap-muted dark:text-ap-muted-dark'
            }`}
            title="Offset faster pods so all pods finish each rep together"
          >
            Pursuit (Finish Together)
          </button>
        </div>

        {!confirmReset ? (
          <button
            type="button"
            data-testid="stopwatch-reset-btn"
            onClick={() => {
              if (hasActiveSession) {
                setConfirmReset(true);
              } else {
                onResetStopwatch();
              }
            }}
            disabled={!hasActiveSession}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl ap-card-inset text-xs font-semibold text-rose-700 dark:text-rose-300 disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed"
          >
            <Trash className="w-4 h-4" weight="bold" />
            <span>Reset</span>
          </button>
        ) : (
          <button
            type="button"
            data-testid="stopwatch-reset-confirm-btn"
            onClick={() => {
              onResetStopwatch();
              setConfirmReset(false);
              onClearFeedback();
            }}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl ap-status-strained font-bold text-xs cursor-pointer"
          >
            <span>Confirm Clear Splits</span>
          </button>
        )}
      </div>

      <TracksideWaveOffsetsPanel
        waveMode={waveMode}
        activePodKeys={activePodKeys}
        podWaveOffsetsSecs={podWaveOffsetsSecs}
        stopwatchRunning={stopwatchRunning}
        setPodWaveOffset={setPodWaveOffset}
        triggerPodWaveNow={triggerPodWaveNow}
      />
    </div>
  );
};
