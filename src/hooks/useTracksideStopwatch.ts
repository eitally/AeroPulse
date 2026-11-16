import { useCallback, useEffect, useMemo, useState } from 'react';
import type { VdotPodRosterInput } from '../physiology/scholasticEngine';
import { OFFICIAL_RACE_EVENTS } from '../utils/officialRaceSynthesizer';
import { parseStructuredTrackWorkout } from '../utils/workoutParser';
import type {
  NcaaTrackFacilityType,
  PlannedWorkoutEvent,
  TrackFootwearClass,
  TrackLaneNumber,
  TrackRepDistanceMeters,
  TrackTrainingZoneCode,
  TrackWorkoutSpec,
  VdotPodIntensity,
  VdotTrainingPod,
} from '../types';

export const TRACKSIDE_STOPWATCH_STORAGE_KEY = 'thresh_trackside_stopwatch_v1';
const TRACKSIDE_SYNC_EVENT = 'thresh:trackside-stopwatch-sync';

export type TracksideSessionType = 'WORKOUT' | 'RACE';
export type TracksideViewMode = 'CARDS' | 'MATRIX';
export type TracksideWaveMode = 'MASS' | 'POD_STAGGER' | 'PURSUIT';

export interface WorkoutStopwatchPreset {
  id: string;
  label: string;
  repCount: number;
  repDistanceMeters: TrackRepDistanceMeters;
  intensity: VdotPodIntensity;
  defaultRestSecs: number;
}

export const WORKOUT_STOPWATCH_PRESETS: WorkoutStopwatchPreset[] = [
  {
    id: '8x400',
    label: '8 x 400m · VO2max',
    repCount: 8,
    repDistanceMeters: 400,
    intensity: 'INTERVAL_VO2',
    defaultRestSecs: 60,
  },
  {
    id: '12x400',
    label: '12 x 400m · Threshold/CV',
    repCount: 12,
    repDistanceMeters: 400,
    intensity: 'THRESHOLD_CV',
    defaultRestSecs: 45,
  },
  {
    id: '6x800',
    label: '6 x 800m · VO2max',
    repCount: 6,
    repDistanceMeters: 800,
    intensity: 'INTERVAL_VO2',
    defaultRestSecs: 90,
  },
  {
    id: '5x1000',
    label: '5 x 1000m · VO2max',
    repCount: 5,
    repDistanceMeters: 1000,
    intensity: 'INTERVAL_VO2',
    defaultRestSecs: 90,
  },
  {
    id: '4x1600',
    label: '4 x 1600m · Threshold',
    repCount: 4,
    repDistanceMeters: 1600,
    intensity: 'THRESHOLD_CV',
    defaultRestSecs: 60,
  },
  {
    id: 'open-400',
    label: 'Open 400m Laps',
    repCount: 12,
    repDistanceMeters: 400,
    intensity: 'THRESHOLD_CV',
    defaultRestSecs: 60,
  },
];

export interface RaceStopwatchPreset {
  label: string;
  distanceMeters: number;
  splitMeters: 200 | 400 | 1000;
  targetLaps: number | null;
}

const INCLUDED_RACE_EVENT_LABELS = new Set([
  '400m',
  '800m',
  '1500m',
  '1600m',
  '1 Mile',
  '3000m',
  '3200m',
  '5000m',
  'XC 5K',
]);

export const RACE_STOPWATCH_PRESETS: RaceStopwatchPreset[] = [
  ...OFFICIAL_RACE_EVENTS.filter((e) => INCLUDED_RACE_EVENT_LABELS.has(e.label)).map((e) => ({
    label: e.label,
    distanceMeters: e.distanceMeters,
    splitMeters: e.defaultSplitMeters,
    targetLaps: e.defaultLapCount,
  })),
  {
    label: 'Open Race',
    distanceMeters: 0,
    splitMeters: 400,
    targetLaps: null,
  },
];

export const DEFAULT_POD_WAVE_OFFSETS: Record<string, number> = {
  'Pod A': 0,
  'Pod B': 10,
  'Pod C': 20,
  'Pod D': 30,
};

export interface TracksideSplitTapEntry {
  runnerId: string;
  runnerName: string;
  timestampSecs: number;
  kind?: 'RUNNER_SPLIT' | 'CHUTE_QUEUE' | 'CHUTE_ASSIGN';
  previousLastTapEpochMs?: number;
}

export interface TracksideAutoRegPivotEntry {
  timestampEpochMs: number;
  action: 'EXTEND_REST_30S' | 'CONVERT_REMAINING_TO_CV' | 'END_SESSION_85_STIMULUS';
  summary: string;
}

export interface PersistedTracksideStopwatchState {
  isRunning: boolean;
  startedAtEpochMs: number | null;
  accumulatedMs: number;
  athleteLapTimestampsSecs: Record<string, number[]>;
  tapHistory: TracksideSplitTapEntry[];
  extraPodAthletes: VdotPodRosterInput[];
  sessionType?: TracksideSessionType;
  viewMode?: TracksideViewMode;
  showChuteBar?: boolean;
  workoutPresetId?: string;
  customWorkoutSpec?: TrackWorkoutSpec | null;
  raceEventLabel?: string;
  restDurationSecs?: number;
  waveMode?: TracksideWaveMode;
  podWaveOffsetsSecs?: Record<string, number>;
  chuteQueueSecs?: number[];
  runnerLastTapEpochMs?: Record<string, number>;
  sessionTitle?: string;
  soundEnabled?: boolean;
  wakeLockEnabled?: boolean;
  trackLane?: TrackLaneNumber;
  isStaggeredStart?: boolean;
  trackFacility?: NcaaTrackFacilityType;
  airTempF?: number | null;
  dewPointF?: number | null;
  windSpeedMps?: number;
  altitudeMeters?: number;
  footwearClass?: TrackFootwearClass;
  autoRegPivotHistory?: TracksideAutoRegPivotEntry[];
  endedEarlyStimulusRatio?: number | null;
  dismissedAutoRegSignatures?: string[];
}

const DEFAULT_STOPWATCH_STATE: PersistedTracksideStopwatchState = {
  isRunning: false,
  startedAtEpochMs: null,
  accumulatedMs: 0,
  athleteLapTimestampsSecs: {},
  tapHistory: [],
  extraPodAthletes: [],
  sessionType: 'WORKOUT',
  viewMode: 'CARDS',
  showChuteBar: false,
  workoutPresetId: '8x400',
  customWorkoutSpec: null,
  raceEventLabel: '1600m',
  restDurationSecs: 60,
  waveMode: 'MASS',
  podWaveOffsetsSecs: { ...DEFAULT_POD_WAVE_OFFSETS },
  chuteQueueSecs: [],
  runnerLastTapEpochMs: {},
  sessionTitle: '',
  soundEnabled: false,
  wakeLockEnabled: true,
  trackLane: 1,
  isStaggeredStart: false,
  trackFacility: 'OUTDOOR_400M',
  airTempF: null,
  dewPointF: null,
      windSpeedMps: 0,
  altitudeMeters: 0,
  footwearClass: 'DAILY_TRAINER',
  autoRegPivotHistory: [],
  endedEarlyStimulusRatio: null,
  dismissedAutoRegSignatures: [],
};

function sanitizeNumberRecord(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      out[k] = v;
    }
  }
  return out;
}

const VALID_REP_DISTANCES: TrackRepDistanceMeters[] = [
  150, 200, 300, 400, 500, 600, 800, 1000, 1200, 1600,
];

function sanitizeCustomWorkoutSpec(raw: unknown): TrackWorkoutSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Partial<TrackWorkoutSpec>;
  if (
    typeof candidate.repCount !== 'number' ||
    !Number.isFinite(candidate.repCount) ||
    candidate.repCount < 1
  ) {
    return null;
  }
  const repDistNum = Number(candidate.repDistanceMeters);
  if (!Number.isFinite(repDistNum) || repDistNum <= 0) return null;
  const snappedDist = VALID_REP_DISTANCES.reduce((best, cur) =>
    Math.abs(cur - repDistNum) < Math.abs(best - repDistNum) ? cur : best
  );
  return {
    repCount: Math.max(1, Math.round(candidate.repCount)),
    repDistanceMeters: snappedDist,
    zoneCode: candidate.zoneCode || 'CV',
    podIntensity: candidate.podIntensity || 'THRESHOLD_CV',
    ...(typeof candidate.targetSplitSecs === 'number' && Number.isFinite(candidate.targetSplitSecs)
      ? { targetSplitSecs: candidate.targetSplitSecs }
      : {}),
    restDurationSecs:
      typeof candidate.restDurationSecs === 'number' && Number.isFinite(candidate.restDurationSecs)
        ? Math.max(0, Math.round(candidate.restDurationSecs))
        : 60,
    ...(typeof candidate.recoveryCue === 'string' ? { recoveryCue: candidate.recoveryCue } : {}),
    ...(candidate.waveMode ? { waveMode: candidate.waveMode } : {}),
    ...(candidate.eventGroup ? { eventGroup: candidate.eventGroup } : {}),
    ...(candidate.phase ? { phase: candidate.phase } : {}),
  };
}

export function readPersistedTracksideStopwatch(): PersistedTracksideStopwatchState {
  if (typeof window === 'undefined') return DEFAULT_STOPWATCH_STATE;
  try {
    const raw = window.localStorage.getItem(TRACKSIDE_STOPWATCH_STORAGE_KEY);
    if (!raw) return DEFAULT_STOPWATCH_STATE;
    const parsed = JSON.parse(raw) as Partial<PersistedTracksideStopwatchState>;
    const sessionType: TracksideSessionType =
      parsed.sessionType === 'RACE' ? 'RACE' : 'WORKOUT';
    const viewMode: TracksideViewMode =
      parsed.viewMode === 'MATRIX' ? 'MATRIX' : 'CARDS';
    const waveMode: TracksideWaveMode =
      parsed.waveMode === 'PURSUIT'
        ? 'PURSUIT'
        : parsed.waveMode === 'POD_STAGGER'
          ? 'POD_STAGGER'
          : 'MASS';
    const podOffsets = sanitizeNumberRecord(parsed.podWaveOffsetsSecs);
    const customWorkoutSpec = sanitizeCustomWorkoutSpec(parsed.customWorkoutSpec);
    return {
      isRunning: Boolean(parsed.isRunning),
      startedAtEpochMs:
        typeof parsed.startedAtEpochMs === 'number' && Number.isFinite(parsed.startedAtEpochMs)
          ? parsed.startedAtEpochMs
          : null,
      accumulatedMs:
        typeof parsed.accumulatedMs === 'number' && Number.isFinite(parsed.accumulatedMs)
          ? Math.max(0, parsed.accumulatedMs)
          : 0,
      athleteLapTimestampsSecs:
        parsed.athleteLapTimestampsSecs && typeof parsed.athleteLapTimestampsSecs === 'object'
          ? parsed.athleteLapTimestampsSecs
          : {},
      tapHistory: Array.isArray(parsed.tapHistory) ? parsed.tapHistory : [],
      extraPodAthletes: Array.isArray(parsed.extraPodAthletes) ? parsed.extraPodAthletes : [],
      sessionType,
      viewMode,
      showChuteBar:
        typeof parsed.showChuteBar === 'boolean'
          ? parsed.showChuteBar
          : sessionType === 'RACE',
      workoutPresetId:
        parsed.workoutPresetId === 'custom-plan' && customWorkoutSpec
          ? 'custom-plan'
          : typeof parsed.workoutPresetId === 'string' &&
              WORKOUT_STOPWATCH_PRESETS.some((p) => p.id === parsed.workoutPresetId)
            ? parsed.workoutPresetId
            : '8x400',
      customWorkoutSpec,
      raceEventLabel:
        typeof parsed.raceEventLabel === 'string' &&
        RACE_STOPWATCH_PRESETS.some((p) => p.label === parsed.raceEventLabel)
          ? parsed.raceEventLabel
          : '1600m',
      restDurationSecs:
        typeof parsed.restDurationSecs === 'number' &&
        Number.isFinite(parsed.restDurationSecs) &&
        parsed.restDurationSecs >= 0
          ? parsed.restDurationSecs
          : 60,
      waveMode,
      podWaveOffsetsSecs:
        Object.keys(podOffsets).length > 0
          ? { ...DEFAULT_POD_WAVE_OFFSETS, ...podOffsets }
          : { ...DEFAULT_POD_WAVE_OFFSETS },
      chuteQueueSecs: Array.isArray(parsed.chuteQueueSecs)
        ? parsed.chuteQueueSecs.filter(
            (n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
          )
        : [],
      runnerLastTapEpochMs: sanitizeNumberRecord(parsed.runnerLastTapEpochMs),
      sessionTitle: typeof parsed.sessionTitle === 'string' ? parsed.sessionTitle : '',
      soundEnabled: typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : false,
      wakeLockEnabled:
        typeof parsed.wakeLockEnabled === 'boolean' ? parsed.wakeLockEnabled : true,
      trackLane:
        typeof parsed.trackLane === 'number' &&
        Number.isInteger(parsed.trackLane) &&
        parsed.trackLane >= 1 &&
        parsed.trackLane <= 8
          ? (parsed.trackLane as TrackLaneNumber)
          : 1,
      isStaggeredStart: Boolean(parsed.isStaggeredStart),
      trackFacility:
        parsed.trackFacility === 'INDOOR_FLAT_200M' ||
        parsed.trackFacility === 'INDOOR_BANKED_200M' ||
        parsed.trackFacility === 'OUTDOOR_400M'
          ? parsed.trackFacility
          : 'OUTDOOR_400M',
      airTempF:
        typeof parsed.airTempF === 'number' && Number.isFinite(parsed.airTempF)
          ? parsed.airTempF
          : null,
      dewPointF:
        typeof parsed.dewPointF === 'number' && Number.isFinite(parsed.dewPointF)
          ? parsed.dewPointF
          : null,
      windSpeedMps:
        typeof parsed.windSpeedMps === 'number' && Number.isFinite(parsed.windSpeedMps)
          ? Math.max(0, parsed.windSpeedMps)
          : 0,
      altitudeMeters:
        typeof parsed.altitudeMeters === 'number' && Number.isFinite(parsed.altitudeMeters)
          ? Math.max(0, parsed.altitudeMeters)
          : 0,
      footwearClass:
        parsed.footwearClass === 'CARBON_SUPER_SPIKE' ||
        parsed.footwearClass === 'TRADITIONAL_TRACK_SPIKE' ||
        parsed.footwearClass === 'CARBON_ROAD_RACER' ||
        parsed.footwearClass === 'LIGHTWEIGHT_FLAT_SUPER_TRAINER' ||
        parsed.footwearClass === 'DAILY_TRAINER'
          ? parsed.footwearClass
          : 'DAILY_TRAINER',
      autoRegPivotHistory: Array.isArray(parsed.autoRegPivotHistory)
        ? parsed.autoRegPivotHistory.filter(
            (e): e is TracksideAutoRegPivotEntry =>
              Boolean(e && typeof e.summary === 'string' && typeof e.action === 'string')
          )
        : [],
      endedEarlyStimulusRatio:
        typeof parsed.endedEarlyStimulusRatio === 'number' &&
        Number.isFinite(parsed.endedEarlyStimulusRatio)
          ? parsed.endedEarlyStimulusRatio
          : null,
      dismissedAutoRegSignatures: Array.isArray(parsed.dismissedAutoRegSignatures)
        ? parsed.dismissedAutoRegSignatures.filter((s): s is string => typeof s === 'string')
        : [],
    };
  } catch {
    return DEFAULT_STOPWATCH_STATE;
  }
}

function writePersistedTracksideStopwatch(next: PersistedTracksideStopwatchState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TRACKSIDE_STOPWATCH_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(TRACKSIDE_SYNC_EVENT));
  } catch {
    // ignore storage quota errors
  }
}

export function computeElapsedMs(
  state: Pick<PersistedTracksideStopwatchState, 'isRunning' | 'startedAtEpochMs' | 'accumulatedMs'>,
  nowEpochMs: number = Date.now()
): number {
  if (state.isRunning && state.startedAtEpochMs !== null) {
    return Math.max(0, state.accumulatedMs + Math.max(0, nowEpochMs - state.startedAtEpochMs));
  }
  return Math.max(0, state.accumulatedMs);
}

export function applyToggleStartPause(
  current: PersistedTracksideStopwatchState,
  nowEpochMs: number = Date.now()
): PersistedTracksideStopwatchState {
  return current.isRunning
    ? {
        ...current,
        isRunning: false,
        startedAtEpochMs: null,
        accumulatedMs: computeElapsedMs(current, nowEpochMs),
      }
    : {
        ...current,
        isRunning: true,
        startedAtEpochMs: nowEpochMs,
      };
}

export function applyResetStopwatch(
  current: PersistedTracksideStopwatchState
): PersistedTracksideStopwatchState {
  return {
    ...current,
    isRunning: false,
    startedAtEpochMs: null,
    accumulatedMs: 0,
    athleteLapTimestampsSecs: {},
    tapHistory: [],
    extraPodAthletes: current.extraPodAthletes,
    ...(current.chuteQueueSecs !== undefined ? { chuteQueueSecs: [] } : {}),
    ...(current.runnerLastTapEpochMs !== undefined ? { runnerLastTapEpochMs: {} } : {}),
    ...(current.autoRegPivotHistory !== undefined ? { autoRegPivotHistory: [] } : {}),
    ...(current.endedEarlyStimulusRatio !== undefined ? { endedEarlyStimulusRatio: null } : {}),
    ...(current.dismissedAutoRegSignatures !== undefined
      ? { dismissedAutoRegSignatures: [] }
      : {}),
  };
}

export function applyExtendWorkoutRestPlus30s(
  current: PersistedTracksideStopwatchState,
  addSecs: number = 30,
  nowEpochMs: number = Date.now()
): PersistedTracksideStopwatchState {
  const prevRest = current.restDurationSecs ?? 60;
  const nextRest = Math.min(600, Math.max(0, Math.round(prevRest + addSecs)));
  const entry: TracksideAutoRegPivotEntry = {
    timestampEpochMs: nowEpochMs,
    action: 'EXTEND_REST_30S',
    summary: `+${addSecs}s Rest (${prevRest}s -> ${nextRest}s)`,
  };
  return {
    ...current,
    restDurationSecs: nextRest,
    ...(current.customWorkoutSpec
      ? {
          customWorkoutSpec: {
            ...current.customWorkoutSpec,
            restDurationSecs: nextRest,
          },
        }
      : {}),
    autoRegPivotHistory: [...(current.autoRegPivotHistory || []), entry],
  };
}

export function applyConvertRemainingToCv(
  current: PersistedTracksideStopwatchState,
  nowEpochMs: number = Date.now()
): PersistedTracksideStopwatchState {
  const fallbackPreset =
    WORKOUT_STOPWATCH_PRESETS.find((p) => p.id === current.workoutPresetId) ||
    WORKOUT_STOPWATCH_PRESETS[0];
  const baseSpec: TrackWorkoutSpec = current.customWorkoutSpec
    ? { ...current.customWorkoutSpec }
    : {
        repCount: fallbackPreset.repCount,
        repDistanceMeters: fallbackPreset.repDistanceMeters,
        zoneCode:
          fallbackPreset.intensity === 'THRESHOLD_CV' ? 'CV' : 'I',
        podIntensity: fallbackPreset.intensity,
        restDurationSecs: current.restDurationSecs ?? fallbackPreset.defaultRestSecs,
      };

  const nextRest = Math.max(45, Math.min(90, Math.round(current.restDurationSecs ?? baseSpec.restDurationSecs ?? 60)));
  const scaledSplit =
    typeof baseSpec.targetSplitSecs === 'number' && baseSpec.targetSplitSecs > 0
      ? Number((baseSpec.targetSplitSecs * 1.075).toFixed(1))
      : undefined;

  const convertedSpec: TrackWorkoutSpec = {
    ...baseSpec,
    zoneCode: 'CV',
    podIntensity: 'THRESHOLD_CV',
    restDurationSecs: nextRest,
    ...(scaledSplit !== undefined ? { targetSplitSecs: scaledSplit } : {}),
  };

  const entry: TracksideAutoRegPivotEntry = {
    timestampEpochMs: nowEpochMs,
    action: 'CONVERT_REMAINING_TO_CV',
    summary: `Converted remaining ${convertedSpec.repDistanceMeters}m reps to Critical Velocity (CV)`,
  };

  return {
    ...current,
    workoutPresetId: 'custom-plan',
    customWorkoutSpec: convertedSpec,
    restDurationSecs: nextRest,
    autoRegPivotHistory: [...(current.autoRegPivotHistory || []), entry],
  };
}

export function applyEndSessionStimulusAchieved(
  current: PersistedTracksideStopwatchState,
  completedRepsCap: number,
  nowEpochMs: number = Date.now()
): PersistedTracksideStopwatchState {
  const pausedMs = computeElapsedMs(current, nowEpochMs);
  const fallbackPreset =
    WORKOUT_STOPWATCH_PRESETS.find((p) => p.id === current.workoutPresetId) ||
    WORKOUT_STOPWATCH_PRESETS[0];
  const baseSpec: TrackWorkoutSpec = current.customWorkoutSpec
    ? { ...current.customWorkoutSpec }
    : {
        repCount: fallbackPreset.repCount,
        repDistanceMeters: fallbackPreset.repDistanceMeters,
        zoneCode: fallbackPreset.intensity === 'THRESHOLD_CV' ? 'CV' : 'I',
        podIntensity: fallbackPreset.intensity,
        restDurationSecs: current.restDurationSecs ?? fallbackPreset.defaultRestSecs,
      };
  const cappedReps = Math.max(1, Math.round(completedRepsCap));
  const entry: TracksideAutoRegPivotEntry = {
    timestampEpochMs: nowEpochMs,
    action: 'END_SESSION_85_STIMULUS',
    summary: `Ended cleanly at ${cappedReps} reps (85% stimulus preserved)`,
  };

  return {
    ...current,
    isRunning: false,
    startedAtEpochMs: null,
    accumulatedMs: pausedMs,
    workoutPresetId: 'custom-plan',
    customWorkoutSpec: {
      ...baseSpec,
      repCount: cappedReps,
    },
    endedEarlyStimulusRatio: 0.85,
    autoRegPivotHistory: [...(current.autoRegPivotHistory || []), entry],
  };
}

export function applySetSessionType(
  current: PersistedTracksideStopwatchState,
  sessionType: TracksideSessionType
): PersistedTracksideStopwatchState {
  return {
    ...current,
    sessionType,
    showChuteBar: sessionType === 'RACE' ? true : Boolean(current.showChuteBar),
  };
}

function autoStartIfIdle(
  current: PersistedTracksideStopwatchState,
  nowEpochMs: number
): PersistedTracksideStopwatchState {
  if (!current.isRunning && current.accumulatedMs === 0) {
    return {
      ...current,
      isRunning: true,
      startedAtEpochMs: nowEpochMs,
    };
  }
  return current;
}

export function applyTapRunnerSplit(
  current: PersistedTracksideStopwatchState,
  runnerId: string,
  runnerName: string,
  nowEpochMs: number = Date.now(),
  options?: { maxRaceLaps?: number | null }
): {
  next: PersistedTracksideStopwatchState;
  currentElapsedSecs: number;
  blockedByFinishLock?: boolean;
} {
  const existingMarks = current.athleteLapTimestampsSecs[runnerId] || [];
  if (
    options?.maxRaceLaps &&
    options.maxRaceLaps > 0 &&
    existingMarks.length >= options.maxRaceLaps
  ) {
    return {
      next: current,
      currentElapsedSecs: existingMarks[existingMarks.length - 1] ?? 0,
      blockedByFinishLock: true,
    };
  }

  const activeState = autoStartIfIdle(current, nowEpochMs);
  const currentElapsedSecs = Number(
    Math.max(0.01, computeElapsedMs(activeState, nowEpochMs) / 1000).toFixed(2)
  );
  const prevTapEpoch = activeState.runnerLastTapEpochMs?.[runnerId];

  const next: PersistedTracksideStopwatchState = {
    ...activeState,
    athleteLapTimestampsSecs: {
      ...activeState.athleteLapTimestampsSecs,
      [runnerId]: [...existingMarks, currentElapsedSecs],
    },
    runnerLastTapEpochMs: {
      ...(activeState.runnerLastTapEpochMs || {}),
      [runnerId]: nowEpochMs,
    },
    tapHistory: [
      ...activeState.tapHistory,
      {
        runnerId,
        runnerName,
        timestampSecs: currentElapsedSecs,
        kind: 'RUNNER_SPLIT',
        ...(typeof prevTapEpoch === 'number' ? { previousLastTapEpochMs: prevTapEpoch } : {}),
      },
    ],
  };
  return { next, currentElapsedSecs };
}

export function applyRecordChuteTap(
  current: PersistedTracksideStopwatchState,
  nowEpochMs: number = Date.now()
): { next: PersistedTracksideStopwatchState; queuedTimestampSecs: number } {
  const activeState = autoStartIfIdle(current, nowEpochMs);
  const queuedTimestampSecs = Number(
    Math.max(0.01, computeElapsedMs(activeState, nowEpochMs) / 1000).toFixed(2)
  );
  const next: PersistedTracksideStopwatchState = {
    ...activeState,
    chuteQueueSecs: [...(activeState.chuteQueueSecs || []), queuedTimestampSecs],
    tapHistory: [
      ...activeState.tapHistory,
      {
        runnerId: '__CHUTE__',
        runnerName: 'Chute Tap',
        timestampSecs: queuedTimestampSecs,
        kind: 'CHUTE_QUEUE',
      },
    ],
  };
  return { next, queuedTimestampSecs };
}

export function applyAssignChuteToRunner(
  current: PersistedTracksideStopwatchState,
  runnerId: string,
  runnerName: string,
  nowEpochMs: number = Date.now(),
  options?: { maxRaceLaps?: number | null }
): {
  next: PersistedTracksideStopwatchState;
  assignedSecs: number | null;
  blockedByFinishLock?: boolean;
} {
  const queue = current.chuteQueueSecs || [];
  if (queue.length === 0) {
    return { next: current, assignedSecs: null };
  }
  const existingMarks = current.athleteLapTimestampsSecs[runnerId] || [];
  if (
    options?.maxRaceLaps &&
    options.maxRaceLaps > 0 &&
    existingMarks.length >= options.maxRaceLaps
  ) {
    return {
      next: current,
      assignedSecs: null,
      blockedByFinishLock: true,
    };
  }

  const [assignedSecs, ...remainingQueue] = queue;
  const prevTapEpoch = current.runnerLastTapEpochMs?.[runnerId];

  const next: PersistedTracksideStopwatchState = {
    ...current,
    chuteQueueSecs: remainingQueue,
    athleteLapTimestampsSecs: {
      ...current.athleteLapTimestampsSecs,
      [runnerId]: [...existingMarks, assignedSecs],
    },
    runnerLastTapEpochMs: {
      ...(current.runnerLastTapEpochMs || {}),
      [runnerId]: nowEpochMs,
    },
    tapHistory: [
      ...current.tapHistory,
      {
        runnerId,
        runnerName,
        timestampSecs: assignedSecs,
        kind: 'CHUTE_ASSIGN',
        ...(typeof prevTapEpoch === 'number' ? { previousLastTapEpochMs: prevTapEpoch } : {}),
      },
    ],
  };
  return { next, assignedSecs };
}

export function applyTriggerPodWaveNow(
  current: PersistedTracksideStopwatchState,
  podKey: string,
  nowEpochMs: number = Date.now()
): { next: PersistedTracksideStopwatchState; offsetSecs: number } {
  const offsetSecs = Number(Math.max(0, computeElapsedMs(current, nowEpochMs) / 1000).toFixed(2));
  const next: PersistedTracksideStopwatchState = {
    ...current,
    waveMode: current.waveMode === 'PURSUIT' ? 'PURSUIT' : 'POD_STAGGER',
    podWaveOffsetsSecs: {
      ...(current.podWaveOffsetsSecs || DEFAULT_POD_WAVE_OFFSETS),
      [podKey]: offsetSecs,
    },
  };
  return { next, offsetSecs };
}

export function applyUndoLastSplit(
  current: PersistedTracksideStopwatchState
): { next: PersistedTracksideStopwatchState; undone: TracksideSplitTapEntry | null } {
  if (current.tapHistory.length === 0) {
    return { next: current, undone: null };
  }
  const lastEntry = current.tapHistory[current.tapHistory.length - 1];
  const nextHistory = current.tapHistory.slice(0, -1);

  if (lastEntry.kind === 'CHUTE_QUEUE') {
    const queue = current.chuteQueueSecs || [];
    const idx = queue.lastIndexOf(lastEntry.timestampSecs);
    const nextQueue =
      idx >= 0 ? [...queue.slice(0, idx), ...queue.slice(idx + 1)] : queue.slice(0, -1);
    return {
      next: {
        ...current,
        chuteQueueSecs: nextQueue,
        tapHistory: nextHistory,
      },
      undone: lastEntry,
    };
  }

  const prevMarks = current.athleteLapTimestampsSecs[lastEntry.runnerId] || [];
  const nextMarks = prevMarks.slice(0, -1);
  const nextMap = { ...current.athleteLapTimestampsSecs };
  if (nextMarks.length > 0) {
    nextMap[lastEntry.runnerId] = nextMarks;
  } else {
    delete nextMap[lastEntry.runnerId];
  }

  let nextLastTapMap = current.runnerLastTapEpochMs;
  if (current.runnerLastTapEpochMs) {
    nextLastTapMap = { ...current.runnerLastTapEpochMs };
    if (typeof lastEntry.previousLastTapEpochMs === 'number') {
      nextLastTapMap[lastEntry.runnerId] = lastEntry.previousLastTapEpochMs;
    } else {
      delete nextLastTapMap[lastEntry.runnerId];
    }
  }

  const nextQueue =
    lastEntry.kind === 'CHUTE_ASSIGN'
      ? [lastEntry.timestampSecs, ...(current.chuteQueueSecs || [])]
      : current.chuteQueueSecs;

  return {
    next: {
      ...current,
      athleteLapTimestampsSecs: nextMap,
      tapHistory: nextHistory,
      ...(nextLastTapMap !== undefined ? { runnerLastTapEpochMs: nextLastTapMap } : {}),
      ...(nextQueue !== undefined ? { chuteQueueSecs: nextQueue } : {}),
    },
    undone: lastEntry,
  };
}

export interface RunnerRestTimerState {
  status: 'RESTING' | 'GO_NOW' | 'IDLE';
  remainingRestSecs: number;
  overdueSecs: number;
}

export interface RunnerSplitTelemetry {
  runnerId: string;
  runnerName: string;
  podKey: string;
  effectiveOffsetSecs: number;
  netCumulativeSecs: number[];
  lapSplitsSecs: number[];
  lapCount: number;
  lastLapSecs: number | null;
  bestLapSecs: number | null;
  avgLapSecs: number | null;
  netTotalSecs: number | null;
  lastDeltaVsTargetSecs: number | null;
  isBellLap: boolean;
  isFinishedLocked: boolean;
  restState: RunnerRestTimerState;
  rank: number | null;
  placeLabel: string | null;
}

export function formatOrdinalPlace(place: number): string {
  const mod100 = place % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${place}TH`;
  switch (place % 10) {
    case 1:
      return `${place}ST`;
    case 2:
      return `${place}ND`;
    case 3:
      return `${place}RD`;
    default:
      return `${place}TH`;
  }
}

export function computeRunnerSplitTelemetry(params: {
  runnerId: string;
  runnerName: string;
  podKey: string;
  rawTimestampsSecs: number[];
  waveMode?: TracksideWaveMode;
  waveOffsetSecs?: number;
  targetLapSecs: number | null;
  targetRaceLaps: number | null;
  sessionType: TracksideSessionType;
  restDurationSecs: number;
  lastTapEpochMs?: number;
  nowEpochMs?: number;
}): RunnerSplitTelemetry {
  const {
    runnerId,
    runnerName,
    podKey,
    rawTimestampsSecs,
    waveMode = 'MASS',
    waveOffsetSecs = 0,
    targetLapSecs,
    targetRaceLaps,
    sessionType,
    restDurationSecs,
    lastTapEpochMs,
    nowEpochMs = Date.now(),
  } = params;

  const effectiveOffsetSecs =
    waveMode === 'POD_STAGGER' || waveMode === 'PURSUIT'
      ? Number(Math.max(0, waveOffsetSecs).toFixed(2))
      : 0;

  const netCumulativeSecs = rawTimestampsSecs.map((raw) =>
    Number(Math.max(0.01, raw - effectiveOffsetSecs).toFixed(2))
  );
  const lapSplitsSecs = netCumulativeSecs.map((cum, idx) =>
    idx === 0
      ? cum
      : Number(Math.max(0.01, cum - netCumulativeSecs[idx - 1]).toFixed(2))
  );

  const lapCount = lapSplitsSecs.length;
  const lastLapSecs = lapCount > 0 ? lapSplitsSecs[lapCount - 1] : null;
  const bestLapSecs = lapCount > 0 ? Math.min(...lapSplitsSecs) : null;
  const netTotalSecs = lapCount > 0 ? netCumulativeSecs[lapCount - 1] : null;
  const avgLapSecs =
    lapCount > 0 && netTotalSecs !== null
      ? Number((netTotalSecs / lapCount).toFixed(2))
      : null;

  const lastDeltaVsTargetSecs =
    lastLapSecs !== null && targetLapSecs !== null && targetLapSecs > 0
      ? Number((lastLapSecs - targetLapSecs).toFixed(2))
      : null;

  const isBellLap =
    sessionType === 'RACE' &&
    targetRaceLaps !== null &&
    targetRaceLaps >= 2 &&
    lapCount === targetRaceLaps - 1;

  const isFinishedLocked =
    sessionType === 'RACE' &&
    targetRaceLaps !== null &&
    targetRaceLaps >= 1 &&
    lapCount >= targetRaceLaps;

  let restState: RunnerRestTimerState = {
    status: 'IDLE',
    remainingRestSecs: 0,
    overdueSecs: 0,
  };
  if (
    sessionType === 'WORKOUT' &&
    restDurationSecs > 0 &&
    lapCount > 0 &&
    typeof lastTapEpochMs === 'number'
  ) {
    const sinceTapSecs = Math.max(0, (nowEpochMs - lastTapEpochMs) / 1000);
    const remainingRestSecs = Math.round(restDurationSecs - sinceTapSecs);
    if (remainingRestSecs > 0) {
      restState = {
        status: 'RESTING',
        remainingRestSecs,
        overdueSecs: 0,
      };
    } else if (remainingRestSecs >= -20) {
      restState = {
        status: 'GO_NOW',
        remainingRestSecs,
        overdueSecs: Math.max(0, -remainingRestSecs),
      };
    }
  }

  return {
    runnerId,
    runnerName,
    podKey,
    effectiveOffsetSecs,
    netCumulativeSecs,
    lapSplitsSecs,
    lapCount,
    lastLapSecs,
    bestLapSecs,
    avgLapSecs,
    netTotalSecs,
    lastDeltaVsTargetSecs,
    isBellLap,
    isFinishedLocked,
    restState,
    rank: null,
    placeLabel: null,
  };
}

export function computeRaceStandings(
  telemetries: RunnerSplitTelemetry[]
): RunnerSplitTelemetry[] {
  const active = telemetries
    .filter((t) => t.lapCount > 0 && t.netTotalSecs !== null)
    .sort((a, b) => {
      if (a.isFinishedLocked !== b.isFinishedLocked) {
        return a.isFinishedLocked ? -1 : 1;
      }
      if (b.lapCount !== a.lapCount) {
        return b.lapCount - a.lapCount;
      }
      return (a.netTotalSecs ?? Infinity) - (b.netTotalSecs ?? Infinity);
    });

  const standingMap = new Map<string, { rank: number; placeLabel: string }>();
  active.forEach((item, idx) => {
    const rank = idx + 1;
    standingMap.set(item.runnerId, {
      rank,
      placeLabel: formatOrdinalPlace(rank),
    });
  });

  return telemetries.map((t) => {
    const standing = standingMap.get(t.runnerId);
    if (!standing) return t;
    return {
      ...t,
      rank: standing.rank,
      placeLabel: standing.placeLabel,
    };
  });
}

export function useTracksideStopwatch(tickIntervalMs: number = 50) {
  const [persisted, setPersisted] = useState<PersistedTracksideStopwatchState>(() =>
    readPersistedTracksideStopwatch()
  );
  const [nowEpochMs, setNowEpochMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncFromStorage = () => {
      setPersisted(readPersistedTracksideStopwatch());
      setNowEpochMs(Date.now());
    };
    window.addEventListener(TRACKSIDE_SYNC_EVENT, syncFromStorage);
    window.addEventListener('storage', syncFromStorage);
    return () => {
      window.removeEventListener(TRACKSIDE_SYNC_EVENT, syncFromStorage);
      window.removeEventListener('storage', syncFromStorage);
    };
  }, []);

  const hasActiveRestCountdown = useMemo(() => {
    if ((persisted.sessionType || 'WORKOUT') !== 'WORKOUT') return false;
    const restSecs = persisted.restDurationSecs ?? 60;
    if (restSecs <= 0) return false;
    const taps = persisted.runnerLastTapEpochMs || {};
    const values = Object.values(taps);
    if (values.length === 0) return false;
    const newestTap = Math.max(...values);
    return Date.now() - newestTap < (restSecs + 25) * 1000;
  }, [persisted.sessionType, persisted.restDurationSecs, persisted.runnerLastTapEpochMs]);

  useEffect(() => {
    if (!persisted.isRunning && !hasActiveRestCountdown) return;
    setNowEpochMs(Date.now());
    const interval = persisted.isRunning ? tickIntervalMs : Math.max(tickIntervalMs, 250);
    const id = window.setInterval(() => {
      setNowEpochMs(Date.now());
    }, interval);
    return () => window.clearInterval(id);
  }, [persisted.isRunning, hasActiveRestCountdown, tickIntervalMs]);

  const elapsedMs = computeElapsedMs(persisted, nowEpochMs);

  const totalSplitCount = useMemo(
    () =>
      Object.values(persisted.athleteLapTimestampsSecs).reduce(
        (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
        0
      ),
    [persisted.athleteLapTimestampsSecs]
  );

  const chuteQueueSecs = persisted.chuteQueueSecs || [];
  const hasActiveSession =
    persisted.isRunning ||
    persisted.accumulatedMs > 0 ||
    totalSplitCount > 0 ||
    chuteQueueSecs.length > 0;

  const commitState = useCallback((next: PersistedTracksideStopwatchState, now?: number) => {
    setPersisted(next);
    if (now !== undefined) setNowEpochMs(now);
    writePersistedTracksideStopwatch(next);
  }, []);

  const toggleStartPause = useCallback(() => {
    const current = readPersistedTracksideStopwatch();
    const now = Date.now();
    commitState(applyToggleStartPause(current, now), now);
  }, [commitState]);

  const resetStopwatch = useCallback(() => {
    const current = readPersistedTracksideStopwatch();
    commitState(applyResetStopwatch(current), Date.now());
  }, [commitState]);

  const tapRunnerSplit = useCallback(
    (runnerId: string, runnerName: string, options?: { maxRaceLaps?: number | null }) => {
      const current = readPersistedTracksideStopwatch();
      const now = Date.now();
      const { next, currentElapsedSecs, blockedByFinishLock } = applyTapRunnerSplit(
        current,
        runnerId,
        runnerName,
        now,
        options
      );
      if (!blockedByFinishLock) {
        commitState(next, now);
      }
      return currentElapsedSecs;
    },
    [commitState]
  );

  const recordChuteTap = useCallback(() => {
    const current = readPersistedTracksideStopwatch();
    const now = Date.now();
    const { next, queuedTimestampSecs } = applyRecordChuteTap(current, now);
    commitState(next, now);
    return queuedTimestampSecs;
  }, [commitState]);

  const assignChuteToRunner = useCallback(
    (runnerId: string, runnerName: string, options?: { maxRaceLaps?: number | null }) => {
      const current = readPersistedTracksideStopwatch();
      const now = Date.now();
      const { next, assignedSecs } = applyAssignChuteToRunner(
        current,
        runnerId,
        runnerName,
        now,
        options
      );
      if (assignedSecs !== null) {
        commitState(next, now);
      }
      return assignedSecs;
    },
    [commitState]
  );

  const clearChuteQueue = useCallback(() => {
    const current = readPersistedTracksideStopwatch();
    commitState({
      ...current,
      chuteQueueSecs: [],
      tapHistory: current.tapHistory.filter((t) => t.kind !== 'CHUTE_QUEUE'),
    });
  }, [commitState]);

  const undoLastSplit = useCallback((): TracksideSplitTapEntry | null => {
    const current = readPersistedTracksideStopwatch();
    const { next, undone } = applyUndoLastSplit(current);
    if (!undone) return null;
    commitState(next);
    return undone;
  }, [commitState]);

  const setExtraPodAthletes = useCallback(
    (
      updater:
        | VdotPodRosterInput[]
        | ((prev: VdotPodRosterInput[]) => VdotPodRosterInput[])
    ) => {
      const current = readPersistedTracksideStopwatch();
      const resolved =
        typeof updater === 'function' ? updater(current.extraPodAthletes) : updater;
      commitState({ ...current, extraPodAthletes: resolved });
    },
    [commitState]
  );

  const setSessionType = useCallback(
    (sessionType: TracksideSessionType) => {
      const current = readPersistedTracksideStopwatch();
      commitState(applySetSessionType(current, sessionType));
    },
    [commitState]
  );

  const setViewMode = useCallback(
    (viewMode: TracksideViewMode) => {
      const current = readPersistedTracksideStopwatch();
      commitState({ ...current, viewMode });
    },
    [commitState]
  );

  const setShowChuteBar = useCallback(
    (showChuteBar: boolean) => {
      const current = readPersistedTracksideStopwatch();
      commitState({ ...current, showChuteBar });
    },
    [commitState]
  );

  const setWorkoutPresetId = useCallback(
    (workoutPresetId: string) => {
      const current = readPersistedTracksideStopwatch();
      const preset = WORKOUT_STOPWATCH_PRESETS.find((p) => p.id === workoutPresetId);
      commitState({
        ...current,
        workoutPresetId,
        ...(preset ? { restDurationSecs: preset.defaultRestSecs } : {}),
      });
    },
    [commitState]
  );

  const setRaceEventLabel = useCallback(
    (raceEventLabel: string) => {
      const current = readPersistedTracksideStopwatch();
      commitState({ ...current, raceEventLabel });
    },
    [commitState]
  );

  const setRestDurationSecs = useCallback(
    (restDurationSecs: number) => {
      const current = readPersistedTracksideStopwatch();
      commitState({ ...current, restDurationSecs });
    },
    [commitState]
  );

  const setWaveMode = useCallback(
    (waveMode: TracksideWaveMode) => {
      const current = readPersistedTracksideStopwatch();
      commitState({ ...current, waveMode });
    },
    [commitState]
  );

  const setPodWaveOffset = useCallback(
    (podKey: string, offsetSecs: number) => {
      const current = readPersistedTracksideStopwatch();
      commitState({
        ...current,
        podWaveOffsetsSecs: {
          ...(current.podWaveOffsetsSecs || DEFAULT_POD_WAVE_OFFSETS),
          [podKey]: Math.max(0, Number(offsetSecs.toFixed(2))),
        },
      });
    },
    [commitState]
  );

  const triggerPodWaveNow = useCallback(
    (podKey: string) => {
      const current = readPersistedTracksideStopwatch();
      const now = Date.now();
      const { next, offsetSecs } = applyTriggerPodWaveNow(current, podKey, now);
      commitState(next, now);
      return offsetSecs;
    },
    [commitState]
  );

  const setSessionTitle = useCallback(
    (sessionTitle: string) => {
      const current = readPersistedTracksideStopwatch();
      commitState({ ...current, sessionTitle });
    },
    [commitState]
  );

  const setSoundEnabled = useCallback(
    (soundEnabled: boolean) => {
      const current = readPersistedTracksideStopwatch();
      commitState({ ...current, soundEnabled });
    },
    [commitState]
  );

  const setWakeLockEnabled = useCallback(
    (wakeLockEnabled: boolean) => {
      const current = readPersistedTracksideStopwatch();
      commitState({ ...current, wakeLockEnabled });
    },
    [commitState]
  );

  const setCustomWorkoutSpec = useCallback(
    (customWorkoutSpec: TrackWorkoutSpec | null) => {
      const current = readPersistedTracksideStopwatch();
      commitState({
        ...current,
        customWorkoutSpec,
        ...(customWorkoutSpec
          ? {
              workoutPresetId: 'custom-plan',
              restDurationSecs: customWorkoutSpec.restDurationSecs,
              ...(customWorkoutSpec.trackFacility
                ? { trackFacility: customWorkoutSpec.trackFacility }
                : {}),
              ...(customWorkoutSpec.footwearClass
                ? { footwearClass: customWorkoutSpec.footwearClass }
                : {}),
            }
          : {}),
      });
    },
    [commitState]
  );

  const setTrackLane = useCallback(
    (trackLane: TrackLaneNumber) => {
      const current = readPersistedTracksideStopwatch();
      commitState({ ...current, trackLane });
    },
    [commitState]
  );

  const setIsStaggeredStart = useCallback(
    (isStaggeredStart: boolean) => {
      const current = readPersistedTracksideStopwatch();
      commitState({ ...current, isStaggeredStart });
    },
    [commitState]
  );

  const setTrackFacility = useCallback(
    (trackFacility: NcaaTrackFacilityType) => {
      const current = readPersistedTracksideStopwatch();
      commitState({ ...current, trackFacility });
    },
    [commitState]
  );

  const setAirTempF = useCallback(
    (airTempF: number | null) => {
      const current = readPersistedTracksideStopwatch();
      commitState({ ...current, airTempF });
    },
    [commitState]
  );

  const setDewPointF = useCallback(
    (dewPointF: number | null) => {
      const current = readPersistedTracksideStopwatch();
      commitState({ ...current, dewPointF });
    },
    [commitState]
  );

  const setWindSpeedMps = useCallback(
    (windSpeedMps: number) => {
      const current = readPersistedTracksideStopwatch();
      commitState({ ...current, windSpeedMps: Math.max(0, windSpeedMps) });
    },
    [commitState]
  );

  const setAltitudeMeters = useCallback(
    (altitudeMeters: number) => {
      const current = readPersistedTracksideStopwatch();
      commitState({ ...current, altitudeMeters: Math.max(0, altitudeMeters) });
    },
    [commitState]
  );

  const setFootwearClass = useCallback(
    (footwearClass: TrackFootwearClass) => {
      const current = readPersistedTracksideStopwatch();
      commitState({ ...current, footwearClass });
    },
    [commitState]
  );

  const extendWorkoutRestPlus30s = useCallback(
    (addSecs: number = 30) => {
      const current = readPersistedTracksideStopwatch();
      const now = Date.now();
      commitState(applyExtendWorkoutRestPlus30s(current, addSecs, now), now);
    },
    [commitState]
  );

  const convertRemainingToCv = useCallback(() => {
    const current = readPersistedTracksideStopwatch();
    const now = Date.now();
    commitState(applyConvertRemainingToCv(current, now), now);
  }, [commitState]);

  const endSessionStimulusAchieved = useCallback(
    (completedRepsCap: number) => {
      const current = readPersistedTracksideStopwatch();
      const now = Date.now();
      commitState(applyEndSessionStimulusAchieved(current, completedRepsCap, now), now);
    },
    [commitState]
  );

  const dismissAutoRegCue = useCallback(
    (signature: string) => {
      const current = readPersistedTracksideStopwatch();
      const existing = current.dismissedAutoRegSignatures || [];
      if (existing.includes(signature)) return;
      commitState({
        ...current,
        dismissedAutoRegSignatures: [...existing, signature],
      });
    },
    [commitState]
  );

  return {
    stopwatchRunning: persisted.isRunning,
    stopwatchElapsedMs: elapsedMs,
    nowEpochMs,
    athleteLapTimestampsSecs: persisted.athleteLapTimestampsSecs,
    tapHistory: persisted.tapHistory,
    extraPodAthletes: persisted.extraPodAthletes,
    totalSplitCount,
    hasActiveSession,
    sessionType: persisted.sessionType || 'WORKOUT',
    viewMode: persisted.viewMode || 'CARDS',
    showChuteBar: Boolean(persisted.showChuteBar),
    workoutPresetId: persisted.workoutPresetId || '8x400',
    customWorkoutSpec: persisted.customWorkoutSpec || null,
    raceEventLabel: persisted.raceEventLabel || '1600m',
    restDurationSecs: persisted.restDurationSecs ?? 60,
    waveMode: persisted.waveMode || 'MASS',
    podWaveOffsetsSecs: persisted.podWaveOffsetsSecs || DEFAULT_POD_WAVE_OFFSETS,
    chuteQueueSecs,
    runnerLastTapEpochMs: persisted.runnerLastTapEpochMs || {},
    sessionTitle: persisted.sessionTitle || '',
    soundEnabled: Boolean(persisted.soundEnabled),
    wakeLockEnabled: persisted.wakeLockEnabled !== false,
    trackLane: persisted.trackLane ?? 1,
    isStaggeredStart: Boolean(persisted.isStaggeredStart),
    trackFacility: persisted.trackFacility || 'OUTDOOR_400M',
    airTempF: persisted.airTempF ?? null,
    dewPointF: persisted.dewPointF ?? null,
    windSpeedMps: persisted.windSpeedMps ?? 0,
    altitudeMeters: persisted.altitudeMeters ?? 0,
    footwearClass: persisted.footwearClass || 'DAILY_TRAINER',
    autoRegPivotHistory: persisted.autoRegPivotHistory || [],
    endedEarlyStimulusRatio: persisted.endedEarlyStimulusRatio ?? null,
    dismissedAutoRegSignatures: persisted.dismissedAutoRegSignatures || [],
    toggleStartPause,
    resetStopwatch,
    tapRunnerSplit,
    recordChuteTap,
    assignChuteToRunner,
    clearChuteQueue,
    undoLastSplit,
    setExtraPodAthletes,
    setSessionType,
    setViewMode,
    setShowChuteBar,
    setWorkoutPresetId,
    setCustomWorkoutSpec,
    setRaceEventLabel,
    setRestDurationSecs,
    setWaveMode,
    setPodWaveOffset,
    triggerPodWaveNow,
    setSessionTitle,
    setSoundEnabled,
    setWakeLockEnabled,
    setTrackLane,
    setIsStaggeredStart,
    setTrackFacility,
    setAirTempF,
    setDewPointF,
    setWindSpeedMps,
    setAltitudeMeters,
    setFootwearClass,
    extendWorkoutRestPlus30s,
    convertRemainingToCv,
    endSessionStimulusAchieved,
    dismissAutoRegCue,
  };
}

function snapRepDistance(meters: number): TrackRepDistanceMeters {
  return VALID_REP_DISTANCES.reduce((best, cur) =>
    Math.abs(cur - meters) < Math.abs(best - meters) ? cur : best
  );
}

function classifyZoneAndPodFromHints(
  textHint: string,
  intensityPct?: number
): { zoneCode: TrackTrainingZoneCode; podIntensity: VdotPodIntensity } {
  const pct = intensityPct ?? 0;
  if (pct >= 126 || /\bFR\b|800m\s*pace|fast\s*rep/i.test(textHint)) {
    return { zoneCode: 'FR', podIntensity: 'RACE_800M' };
  }
  if (pct >= 114 || /\bR\b|repetition|1500m|mile\s*pace/i.test(textHint)) {
    return { zoneCode: 'R', podIntensity: 'REPETITION' };
  }
  if (pct >= 106 || /\bI\b|vo2/i.test(textHint)) {
    return { zoneCode: 'I', podIntensity: 'INTERVAL_VO2' };
  }
  if (pct >= 98 || /\bCV\b|critical/i.test(textHint)) {
    return { zoneCode: 'CV', podIntensity: 'THRESHOLD_CV' };
  }
  if (pct >= 92 || /sub-?t/i.test(textHint)) {
    return { zoneCode: 'SUB_T', podIntensity: 'SUB_THRESHOLD' };
  }
  if (pct >= 84 || /\bT\b|thresh|tempo/i.test(textHint)) {
    return { zoneCode: 'T', podIntensity: 'THRESHOLD_CV' };
  }
  return { zoneCode: 'I', podIntensity: 'INTERVAL_VO2' };
}

/**
 * Extracts a structured TrackWorkoutSpec from an explicit PlannedWorkoutEvent (direct `trackSpec`,
 * `workoutSyntax` repeat AST, or `name` interval signature like `6x800m`).
 */
export function inferTrackWorkoutSpecFromPlannedEvent(
  ev: Pick<PlannedWorkoutEvent, 'name' | 'workoutSyntax' | 'trackSpec'>
): TrackWorkoutSpec | null {
  if (ev.trackSpec && ev.trackSpec.repDistanceMeters > 0) {
    return {
      ...ev.trackSpec,
      repDistanceMeters: snapRepDistance(ev.trackSpec.repDistanceMeters),
    };
  }

  const syntax = ev.workoutSyntax || '';
  if (syntax.trim()) {
    const ast = parseStructuredTrackWorkout(syntax);
    for (const node of ast) {
      if (node.type === 'repeat') {
        const workStep = node.steps.find((s) => s.stepKind !== 'rest' && (s.distanceMeters ?? 0) >= 100);
        if (workStep && workStep.distanceMeters) {
          const restStep = node.steps.find((s) => s.stepKind === 'rest');
          const { zoneCode, podIntensity } = classifyZoneAndPodFromHints(
            `${ev.name} ${workStep.label}`,
            workStep.intensityPct
          );
          return {
            repCount: node.repeatCount,
            repDistanceMeters: snapRepDistance(workStep.distanceMeters),
            zoneCode,
            podIntensity,
            ...(workStep.targetPaceSecsPerKm
              ? {
                  targetSplitSecs: Number(
                    ((workStep.targetPaceSecsPerKm * workStep.distanceMeters) / 1000).toFixed(1)
                  ),
                }
              : {}),
            restDurationSecs: Math.max(0, Math.round(restStep?.durationSecs ?? 60)),
            waveMode: 'MASS',
          };
        }
      }
    }
  }

  const match = `${ev.name}\n${syntax}`.match(
    /(\d{1,2})\s*[x×]\s*(150|200|300|400|500|600|800|1000|1200|1600)\s*m?\b/i
  );
  if (match) {
    const repCount = Math.max(1, Number(match[1]));
    const repDistanceMeters = snapRepDistance(Number(match[2]));
    const { zoneCode, podIntensity } = classifyZoneAndPodFromHints(`${ev.name} ${syntax}`);
    return {
      repCount,
      repDistanceMeters,
      zoneCode,
      podIntensity,
      restDurationSecs: 60,
      waveMode: 'MASS',
    };
  }

  return null;
}

/**
 * Stages a planned track session or squad pod sheet directly into Trackside Stopwatch storage
 * (`Pod of 1` solo or Multi-Pod Pursuit / Staggered offsets) for 1-tap navigation to `#stopwatch`.
 */
export function stageWorkoutInTracksideStopwatch(params: {
  title: string;
  spec: TrackWorkoutSpec;
  pods?: VdotTrainingPod[];
}): PersistedTracksideStopwatchState {
  const base = applyResetStopwatch(readPersistedTracksideStopwatch());
  const nextWaveMode: TracksideWaveMode =
    params.spec.waveMode === 'PURSUIT'
      ? 'PURSUIT'
      : params.spec.waveMode === 'POD_10S'
        ? 'POD_STAGGER'
        : 'MASS';

  const podWaveOffsetsSecs: Record<string, number> = { ...DEFAULT_POD_WAVE_OFFSETS };
  if (params.pods && params.pods.length > 0 && nextWaveMode === 'PURSUIT') {
    for (const pod of params.pods) {
      const podKey = pod.podName.split(' — ')[0] || pod.podName;
      if (typeof pod.pursuitStaggerOffsetSecs === 'number') {
        podWaveOffsetsSecs[podKey] = Number(Math.max(0, pod.pursuitStaggerOffsetSecs).toFixed(2));
      }
    }
  }

  const nextState: PersistedTracksideStopwatchState = {
    ...base,
    sessionType: 'WORKOUT',
    sessionTitle: params.title,
    workoutPresetId: 'custom-plan',
    customWorkoutSpec: {
      ...params.spec,
      repDistanceMeters: snapRepDistance(params.spec.repDistanceMeters),
    },
    restDurationSecs: Math.max(0, Math.round(params.spec.restDurationSecs ?? 60)),
    waveMode: nextWaveMode,
    podWaveOffsetsSecs,
  };

  writePersistedTracksideStopwatch(nextState);
  return nextState;
}
