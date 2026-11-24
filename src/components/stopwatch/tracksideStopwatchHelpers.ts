import React from 'react';
import type {
  AthleteProfile,
  CoachComplexityTier,
  CoachEventGroup,
  ConnectedAthleteRecord,
  NcaaTrackFacilityType,
  TeamSummaryWithRole,
  TrackFootwearClass,
  TrackLaneNumber,
  TrackWorkoutSpec,
  UnifiedActivity,
} from '../../types';
import type {
  RaceStopwatchPreset,
  RelayQuartetTelemetry,
  RunnerSplitTelemetry,
  WorkoutStopwatchPreset,
} from '../../hooks/useTracksideStopwatch';
import {
  formatLocalWallClockIso,
  formatStopwatchClockMs,
  synthesizeTracksideRaceActivity,
  synthesizeTracksideWorkoutActivity,
} from '../../utils/stopwatchActivitySynthesizer';
import { getLocalDateIso } from '../../physiology/stravaLoadCalibration';
import { openShareWorkoutRoute } from '../../utils/shareWorkoutEngine';
import type { StopwatchOutboxFlushResult, StopwatchSaveResult } from '../../utils/stopwatchTeamSync';
import { buildRelayCsvTelemetries, buildRelaySavedEntries } from './TracksideRelayBatonPanel';

export interface SavedStopwatchEntry {
  runnerId: string;
  runnerName: string;
  activity: UnifiedActivity;
}

export interface TracksideStopwatchLaunchPreset {
  meetTitle?: string;
  meetDate?: string;
  eventCode?: string;
  heatLabel?: string;
  sessionType?: 'WORKOUT' | 'RACE';
  runners?: Array<{
    membershipId?: string;
    athleteName: string;
    hipOrLane?: string;
  }>;
}

export interface TracksideStopwatchViewProps {
  selfName: string;
  selfProfile: AthleteProfile;
  roster: ConnectedAthleteRecord[];
  myTeams: TeamSummaryWithRole[];
  activeTeamId: string | null;
  onSaveStopwatchActivities: (
    entries: SavedStopwatchEntry[]
  ) => Promise<StopwatchSaveResult> | StopwatchSaveResult | number;
  onFlushStopwatchOutbox?: () => Promise<StopwatchOutboxFlushResult>;
  onOpenActivitiesTab: () => void;
  postSaveActionLabel?: string;
  onOpenRosterModal: () => void;
  onOpenDelegateTiming?: () => void;
  pendingTimingCount?: number;
  launchPreset?: TracksideStopwatchLaunchPreset | null;
  complexityTier?: CoachComplexityTier;
}

export interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
  removeEventListener?: (type: 'release', listener: () => void) => void;
}

export const EVENT_GROUP_FILTER_LABELS: Array<{ value: CoachEventGroup; label: string }> = [
  { value: 'SPRINTS', label: 'Sprints' },
  { value: 'HURDLES', label: 'Hurdles' },
  { value: 'MID_DISTANCE', label: 'Mid-Distance' },
  { value: 'DISTANCE', label: 'Distance' },
  { value: 'JUMPS', label: 'Jumps' },
  { value: 'THROWS', label: 'Throws' },
  { value: 'MULTI', label: 'Multis' },
];

export const REST_OPTIONS_SECS = [0, 30, 45, 60, 90, 120, 180] as const;

export type StopwatchSaveResultExtended = StopwatchSaveResult & {
  deadLetteredBatches?: number;
  syncWarning?: string;
};

export function resolveStopwatchSaveFeedback(
  saveResult: StopwatchSaveResultExtended,
  sessionType: 'WORKOUT' | 'RACE',
  endedEarlyStimulusRatio: number | null
): { tone: 'prime' | 'caution'; message: string } {
  const isDeadLettered =
    (saveResult.syncStatus as string) === 'DEAD_LETTERED' ||
    (saveResult.deadLetteredBatches ?? 0) > 0;

  if (saveResult.savedCount === 0) {
    return {
      tone: 'caution',
      message:
        saveResult.skippedReadOnlyNames.length > 0
          ? `Skipped read-only teammate logs (${saveResult.skippedReadOnlyNames.join(', ')}).`
          : 'No writable athlete logs selected.',
    };
  }

  const parts: string[] = [];
  let tone: 'prime' | 'caution' = 'prime';

  if (isDeadLettered) {
    tone = 'caution';
    parts.push(
      saveResult.syncWarning ||
        `Team cloud sync failed (${saveResult.deadLetteredBatches ?? 1} batch quarantined as DEAD_LETTERED). Local marks preserved; review roster permissions before retrying.`
    );
  } else if (saveResult.syncStatus === 'PENDING_OFFLINE') {
    tone = 'caution';
    parts.push(
      `Saved ${saveResult.savedCount} ${sessionType === 'RACE' ? 'Race' : 'Interval'} ${
        saveResult.savedCount === 1 ? 'Log' : 'Logs'
      } locally — Pending Sync (${saveResult.pendingTeamCount} team ${
        saveResult.pendingTeamCount === 1 ? 'entry' : 'entries'
      } queued until back online).`
    );
  } else {
    parts.push(
      sessionType === 'RACE'
        ? `Saved ${saveResult.savedCount} Hand-Timed Race ${saveResult.savedCount === 1 ? 'Mark' : 'Marks'} into MeetReady Activities.`
        : endedEarlyStimulusRatio !== null
          ? `Saved ${saveResult.savedCount} Interval Workout ${saveResult.savedCount === 1 ? 'Log' : 'Logs'} (${Math.round(endedEarlyStimulusRatio * 100)}% quality stimulus preserved) into MeetReady Activities.`
          : `Saved ${saveResult.savedCount} Interval Workout ${saveResult.savedCount === 1 ? 'Log' : 'Logs'} (rTSS computed) into MeetReady Activities.`
    );
  }

  if (saveResult.walkOnCount > 0) {
    parts.push(
      `${saveResult.walkOnCount} walk-on ${saveResult.walkOnCount === 1 ? 'entry' : 'entries'} saved to local Walk-On Archive (kept separate from your personal log).`
    );
  }
  if (saveResult.skippedReadOnlyNames.length > 0) {
    tone = 'caution';
    parts.push(`Skipped read-only: ${saveResult.skippedReadOnlyNames.join(', ')}.`);
  }

  return {
    tone,
    message: parts.join(' '),
  };
}

export function playTracksideFeedbackAudio(
  kind: 'GUN' | 'SPLIT' | 'CHUTE' | 'BELL',
  soundEnabled: boolean,
  audioCtxRef: React.MutableRefObject<AudioContext | null>
): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(kind === 'BELL' ? [20, 40, 20] : 15);
    }
  } catch {
    // ignore vibration errors
  }
  if (!soundEnabled || typeof window === 'undefined') return;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtxRef.current) {
      audioCtxRef.current = new Ctx();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    const playTone = (freq: number, delaySec: number, durationSec: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delaySec);
      gain.gain.setValueAtTime(0.3, ctx.currentTime + delaySec);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delaySec + durationSec);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + delaySec);
      osc.stop(ctx.currentTime + delaySec + durationSec);
    };
    if (kind === 'BELL') {
      playTone(1046, 0, 0.05);
      playTone(1318, 0.07, 0.06);
    } else if (kind === 'GUN') {
      playTone(1046, 0, 0.055);
    } else if (kind === 'CHUTE') {
      playTone(660, 0, 0.035);
    } else {
      playTone(880, 0, 0.035);
    }
  } catch {
    // ignore Web Audio restrictions
  }
}

export function shareTracksideStopwatchCard(params: {
  isRelayMode: boolean;
  relayTelemetries: RelayQuartetTelemetry[];
  runnerTelemetries: RunnerSplitTelemetry[];
  myTeams: TeamSummaryWithRole[];
  activeTeamId: string | null;
  sessionType: 'WORKOUT' | 'RACE';
  activeRacePreset: RaceStopwatchPreset;
  activeWorkoutPreset: Pick<WorkoutStopwatchPreset, 'label'>;
  sessionTitle: string;
  selfProfile: AthleteProfile;
}): void {
  const sourceTelemetries = params.isRelayMode
    ? buildRelayCsvTelemetries(params.relayTelemetries)
    : params.runnerTelemetries;
  const timed = sourceTelemetries.filter((t) => t.lapCount > 0 && t.netTotalSecs !== null);
  if (timed.length === 0) return;
  const teamName = params.myTeams.find((tm) => tm.brand.teamId === params.activeTeamId)?.brand.name;
  const presetLabel =
    params.sessionType === 'RACE' ? params.activeRacePreset.label : params.activeWorkoutPreset.label;
  openShareWorkoutRoute({
    kind: 'STOPWATCH',
    version: 1,
    title: params.sessionTitle.trim() || `${presetLabel} Splits`,
    sport: 'Running',
    date: getLocalDateIso(),
    description: `${presetLabel} · ${timed.length} timed ${timed.length === 1 ? 'athlete' : 'athletes'}`,
    teamName,
    referenceThresholdPaceSecsPerKm: params.selfProfile.thresholdPaceSecsPerKm || 245,
    splits: timed.slice(0, 16).map((t) => ({
      label: `${t.runnerName} (${t.lapCount} ${t.lapCount === 1 ? 'lap' : 'laps'})`,
      lapTime: formatStopwatchClockMs((t.netTotalSecs ?? 0) * 1000),
      paceOrPower:
        t.lapSplitsSecs.length > 0
          ? `Last ${formatStopwatchClockMs(t.lapSplitsSecs[t.lapSplitsSecs.length - 1] * 1000)}`
          : undefined,
    })),
  });
}

export async function copyStopwatchCsvToClipboard(csv: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(csv);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = csv;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

export function downloadStopwatchCsvFile(
  csv: string,
  sessionType: 'WORKOUT' | 'RACE',
  slugSource: string
): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const dateStamp = getLocalDateIso();
  const slug = slugSource.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  link.href = url;
  link.download = `meetready-stopwatch-${sessionType.toLowerCase()}-${slug}-${dateStamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function buildStopwatchSaveEntries(params: {
  isRelayMode: boolean;
  relayTelemetries: RelayQuartetTelemetry[];
  runnerTelemetries: RunnerSplitTelemetry[];
  roster: ConnectedAthleteRecord[];
  sessionStartedEpochMs: number | null;
  stopwatchElapsedMs: number;
  activeRacePreset: RaceStopwatchPreset;
  activeWorkoutPreset: Pick<WorkoutStopwatchPreset, 'label' | 'repDistanceMeters'>;
  selfProfile: AthleteProfile;
  sessionTitle: string;
  includeWarmupCooldown: boolean;
  trackLane: TrackLaneNumber;
  sessionType: 'WORKOUT' | 'RACE';
  restDurationSecs: number;
  footwearClass: TrackFootwearClass;
  trackFacility: NcaaTrackFacilityType;
  endedEarlyStimulusRatio: number | null;
  autoRegPivotHistory: Array<{ summary: string }>;
  customWorkoutSpec: TrackWorkoutSpec | null;
}): SavedStopwatchEntry[] | null {
  const relayCompleted = params.isRelayMode
    ? params.relayTelemetries.filter((rt) => rt.completedLegs > 0)
    : [];
  const timed = params.runnerTelemetries.filter((t) => t.lapCount > 0 && t.netTotalSecs !== null);
  if ((!params.isRelayMode && timed.length === 0) || (params.isRelayMode && relayCompleted.length === 0)) {
    return null;
  }

  const rosterById = new Map(params.roster.map((r) => [r.id, r]));
  const derivedStartMs =
    params.sessionStartedEpochMs ?? Math.max(0, Date.now() - Math.max(0, params.stopwatchElapsedMs));
  const startDateLocalIso = formatLocalWallClockIso(derivedStartMs);

  if (params.isRelayMode) {
    return buildRelaySavedEntries({
      relayTelemetries: params.relayTelemetries,
      activeRacePreset: params.activeRacePreset,
      rosterById,
      selfProfile: params.selfProfile,
      sessionTitle: params.sessionTitle,
      includeWarmupCooldown: params.includeWarmupCooldown,
      startDateLocalIso,
      derivedStartMs,
      trackLane: params.trackLane,
    });
  }

  return timed.map((t) => {
    const targetId = t.runnerId;
    const athleteProfileForTarget =
      targetId === 'SELF'
        ? params.selfProfile
        : rosterById.get(targetId)?.athleteProfile || params.selfProfile;
    const lthr = athleteProfileForTarget.lthr || 172;
    const maxHr = athleteProfileForTarget.maxHr || 194;
    const tPace = athleteProfileForTarget.thresholdPaceSecsPerKm || 240;

    const activity =
      params.sessionType === 'RACE'
        ? synthesizeTracksideRaceActivity({
            runnerId: t.runnerId,
            runnerName: t.runnerName,
            lthr,
            maxHr,
            sessionTitle: params.sessionTitle,
            eventLabel: params.activeRacePreset.label,
            eventDistanceMeters: params.activeRacePreset.distanceMeters,
            lapSplitDistanceMeters: params.activeRacePreset.splitMeters,
            lapSplitsSecs: t.lapSplitsSecs,
            netTotalSecs: t.netTotalSecs ?? 0,
            placeFinish: t.placeLabel ? `${t.placeLabel} (Stopwatch)` : undefined,
            includeWarmupCooldown: params.includeWarmupCooldown,
            startDateLocalIso,
            startDateUtcMs: derivedStartMs,
            lane: params.trackLane,
          })
        : synthesizeTracksideWorkoutActivity({
            runnerId: t.runnerId,
            runnerName: t.runnerName,
            thresholdPaceSecsPerKm: tPace,
            lthr,
            maxHr,
            sessionTitle: params.sessionTitle,
            presetLabel: params.activeWorkoutPreset.label,
            repDistanceMeters: params.activeWorkoutPreset.repDistanceMeters,
            restDurationSecs: params.restDurationSecs,
            lapSplitsSecs: t.lapSplitsSecs,
            startDateLocalIso,
            startDateUtcMs: derivedStartMs,
            lane: params.trackLane,
            footwearClass: params.footwearClass,
            trackFacility: params.trackFacility,
            stimulusCompletionRatio: params.endedEarlyStimulusRatio ?? undefined,
            autoRegPivotSummary:
              params.autoRegPivotHistory.length > 0
                ? params.autoRegPivotHistory.map((p) => p.summary).join(' · ')
                : undefined,
            multiSetSpec: params.customWorkoutSpec,
          });

    return {
      runnerId: targetId,
      runnerName: t.runnerName,
      activity,
    };
  });
}
