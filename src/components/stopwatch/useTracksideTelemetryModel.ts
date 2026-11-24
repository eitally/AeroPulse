import { useMemo } from 'react';
import type {
  AthleteProfile,
  CoachEventGroup,
  ConnectedAthleteRecord,
  NcaaTrackFacilityType,
  TeamSummaryWithRole,
  TrackEnvironmentConditions,
  TrackFootwearClass,
  TrackLaneNumber,
  TrackRepDistanceMeters,
  TrackWorkoutSpec,
} from '../../types';
import {
  computeRaceStandings,
  computeRelayQuartetTelemetry,
  computeRunnerSplitTelemetry,
  DEFAULT_POD_WAVE_OFFSETS,
  getRecentSwappableSplitPair,
  RACE_STOPWATCH_PRESETS,
  resolveRunnerRepStartTimestamps,
  WORKOUT_STOPWATCH_PRESETS,
  type RelayQuartetConfig,
  type RunnerSplitTelemetry,
  type TracksideSplitTapEntry,
  type TracksideWaveMode,
} from '../../hooks/useTracksideStopwatch';
import {
  computeTeamVdotPacingPods,
  computeTrackEnvironmentSplitAdjustment,
  computeWorldAthleticsOvalLaneGeometry,
  type VdotPodRosterInput,
} from '../../physiology/scholasticEngine';
import {
  evaluateSquadLiveAutoRegulation,
  type RunnerLiveAutoRegInput,
} from '../../physiology/trackLiveAutoRegulationEngine';

export interface UseTracksideTelemetryModelParams {
  selfName: string;
  selfProfile: AthleteProfile;
  roster: ConnectedAthleteRecord[];
  activeTeam: TeamSummaryWithRole | null;
  isCoachingTeam: boolean;
  sessionType: 'WORKOUT' | 'RACE';
  sessionTitle: string;
  workoutPresetId: string;
  customWorkoutSpec: TrackWorkoutSpec | null;
  raceEventLabel: string;
  restDurationSecs: number;
  customRepOverride: number | null;
  customDistOverride: TrackRepDistanceMeters | null;
  includeSelfRunner: boolean;
  extraPodAthletes: VdotPodRosterInput[];
  athleteLapTimestampsSecs: Record<string, number[]>;
  repStartTimestampsSecs: Record<string, number[]>;
  hipOrLaneByRunnerId: Record<string, string>;
  waveMode: TracksideWaveMode;
  podWaveOffsetsSecs: Record<string, number>;
  runnerLastTapEpochMs: Record<string, number>;
  nowEpochMs: number;
  stopwatchRunning: boolean;
  tapHistory: TracksideSplitTapEntry[];
  selectedPodFilter: string;
  selectedEventGroupFilter: 'ALL' | CoachEventGroup;
  showInjuredAthletes: boolean;
  runnerSearchQuery: string;
  onlyOnTrack: boolean;
  pinnedRunnerIds: string[];
  dismissedAutoRegSignatures: string[];
  trackLane: TrackLaneNumber;
  isStaggeredStart: boolean;
  trackFacility: NcaaTrackFacilityType;
  airTempF: number | null | undefined;
  dewPointF: number | null | undefined;
  windSpeedMps: number;
  altitudeMeters: number;
  footwearClass: TrackFootwearClass;
  showEnvPhysicsPanel: boolean;
  relayQuartets: RelayQuartetConfig[];
  relayBatonTimestampsSecs: Record<string, number[]>;
}

export function useTracksideTelemetryModel(params: UseTracksideTelemetryModelParams) {
  const {
    selfName,
    selfProfile,
    roster,
    activeTeam,
    isCoachingTeam,
    sessionType,
    sessionTitle,
    workoutPresetId,
    customWorkoutSpec,
    raceEventLabel,
    restDurationSecs,
    customRepOverride,
    customDistOverride,
    includeSelfRunner,
    extraPodAthletes,
    athleteLapTimestampsSecs,
    repStartTimestampsSecs,
    hipOrLaneByRunnerId,
    waveMode,
    podWaveOffsetsSecs,
    runnerLastTapEpochMs,
    nowEpochMs,
    stopwatchRunning,
    tapHistory,
    selectedPodFilter,
    selectedEventGroupFilter,
    showInjuredAthletes,
    runnerSearchQuery,
    onlyOnTrack,
    pinnedRunnerIds,
    dismissedAutoRegSignatures,
    trackLane,
    isStaggeredStart,
    trackFacility,
    airTempF,
    dewPointF,
    windSpeedMps,
    altitudeMeters,
    footwearClass,
    showEnvPhysicsPanel,
    relayQuartets,
    relayBatonTimestampsSecs,
  } = params;

  const customPlanPreset = useMemo(() => {
    if (!customWorkoutSpec) return null;
    return {
      id: 'custom-plan',
      label:
        sessionTitle ||
        `${customWorkoutSpec.repCount} x ${customWorkoutSpec.repDistanceMeters}m · ${customWorkoutSpec.zoneCode}`,
      repCount: customWorkoutSpec.repCount,
      repDistanceMeters: customWorkoutSpec.repDistanceMeters,
      intensity: customWorkoutSpec.podIntensity,
      defaultRestSecs: customWorkoutSpec.restDurationSecs,
    };
  }, [customWorkoutSpec, sessionTitle]);

  const baseWorkoutPreset = useMemo(
    () =>
      (workoutPresetId === 'custom-plan' && customPlanPreset ? customPlanPreset : null) ||
      WORKOUT_STOPWATCH_PRESETS.find((p) => p.id === workoutPresetId) ||
      WORKOUT_STOPWATCH_PRESETS[0],
    [workoutPresetId, customPlanPreset]
  );

  const activeWorkoutPreset = useMemo(() => {
    const repCount = customRepOverride ?? baseWorkoutPreset.repCount;
    const repDistanceMeters = customDistOverride ?? baseWorkoutPreset.repDistanceMeters;
    const isOverridden = customRepOverride !== null || customDistOverride !== null;
    return {
      ...baseWorkoutPreset,
      repCount,
      repDistanceMeters,
      label: isOverridden
        ? `${repCount} x ${repDistanceMeters}m · Custom`
        : baseWorkoutPreset.label,
    };
  }, [baseWorkoutPreset, customRepOverride, customDistOverride]);

  const activeRacePreset = useMemo(
    () =>
      RACE_STOPWATCH_PRESETS.find((p) => p.label === raceEventLabel) ||
      RACE_STOPWATCH_PRESETS.find((p) => p.label === '1600m') ||
      RACE_STOPWATCH_PRESETS[0],
    [raceEventLabel]
  );

  const connectedRoster = useMemo(
    () => roster.filter((a) => a.status === 'CONNECTED'),
    [roster]
  );

  const rosterInputs = useMemo<VdotPodRosterInput[]>(() => {
    const showSelf =
      includeSelfRunner ||
      (connectedRoster.length === 0 && extraPodAthletes.length === 0) ||
      Boolean(athleteLapTimestampsSecs.SELF?.length);
    return [
      ...(showSelf
        ? [
            {
              id: 'SELF',
              name: selfName || 'Athlete',
              thresholdPaceSecsPerKm: selfProfile.thresholdPaceSecsPerKm || 240,
            },
          ]
        : []),
      ...connectedRoster.map((c) => ({
        id: c.id,
        name: c.name,
        thresholdPaceSecsPerKm: c.athleteProfile.thresholdPaceSecsPerKm || 245,
      })),
      ...extraPodAthletes,
    ];
  }, [
    includeSelfRunner,
    connectedRoster,
    extraPodAthletes,
    selfName,
    selfProfile.thresholdPaceSecsPerKm,
    athleteLapTimestampsSecs.SELF,
  ]);

  const environmentConditions = useMemo<TrackEnvironmentConditions>(
    () => ({
      lane: trackLane,
      isStaggeredStart,
      facility: trackFacility,
      ...(typeof airTempF === 'number' ? { airTempF } : {}),
      ...(typeof dewPointF === 'number' ? { dewPointF } : {}),
      windSpeedMps,
      altitudeMeters,
    }),
    [
      trackLane,
      isStaggeredStart,
      trackFacility,
      airTempF,
      dewPointF,
      windSpeedMps,
      altitudeMeters,
    ]
  );

  const vdotPods = useMemo(
    () =>
      computeTeamVdotPacingPods({
        roster: rosterInputs,
        intensity: activeWorkoutPreset.intensity,
        repCount: activeWorkoutPreset.repCount,
        repDistanceMeters: activeWorkoutPreset.repDistanceMeters,
        recoveryLabel: restDurationSecs > 0 ? `${restDurationSecs}s rest` : 'Open rest',
        environment: environmentConditions,
      }),
    [rosterInputs, activeWorkoutPreset, restDurationSecs, environmentConditions]
  );

  const laneGeometry = useMemo(
    () => computeWorldAthleticsOvalLaneGeometry(trackLane),
    [trackLane]
  );

  const activeEnvAdjustment = useMemo(() => {
    const primaryPod = vdotPods[0];
    const baseSplit =
      customWorkoutSpec?.targetSplitSecs && customWorkoutSpec.targetSplitSecs > 0
        ? customWorkoutSpec.targetSplitSecs
        : primaryPod?.splitsSecs
          ? Number(
              (
                (primaryPod.targetPaceSecsPerKm /
                  (primaryPod.environmentAdjustment?.combinedSplitMultiplier || 1) /
                  1000) *
                activeWorkoutPreset.repDistanceMeters
              ).toFixed(1)
            )
          : 72;
    return computeTrackEnvironmentSplitAdjustment({
      baseTargetSplitSecs: baseSplit,
      repDistanceMeters: activeWorkoutPreset.repDistanceMeters,
      baseRestDurationSecs: restDurationSecs,
      intensity: activeWorkoutPreset.intensity,
      zoneCode: customWorkoutSpec?.zoneCode,
      environment: environmentConditions,
      isIntervalSession: sessionType === 'WORKOUT',
    });
  }, [
    vdotPods,
    customWorkoutSpec,
    activeWorkoutPreset,
    restDurationSecs,
    environmentConditions,
    sessionType,
  ]);

  const runnerPodLookup = useMemo(() => {
    const map = new Map<string, { podKey: string; targetLapSecs: number }>();
    const hasCustomTargetSplit =
      workoutPresetId === 'custom-plan' &&
      typeof customWorkoutSpec?.targetSplitSecs === 'number' &&
      customWorkoutSpec.targetSplitSecs > 0;
    const directCustomSplitSecs = hasCustomTargetSplit
      ? computeTrackEnvironmentSplitAdjustment({
          baseTargetSplitSecs: customWorkoutSpec!.targetSplitSecs!,
          repDistanceMeters: activeWorkoutPreset.repDistanceMeters,
          baseRestDurationSecs: restDurationSecs,
          zoneCode: customWorkoutSpec?.zoneCode,
          intensity: activeWorkoutPreset.intensity,
          environment: environmentConditions,
          isIntervalSession: true,
        }).adjustedTargetSplitSecs
      : null;

    for (const pod of vdotPods) {
      const podKey = pod.podName.split(' — ')[0] || pod.podName;
      const podSplitSecs =
        hasCustomTargetSplit && rosterInputs.length <= 1 && directCustomSplitSecs !== null
          ? directCustomSplitSecs
          : pod.targetRepSplitSecs ??
            Number(
              ((pod.targetPaceSecsPerKm / 1000) * activeWorkoutPreset.repDistanceMeters).toFixed(1)
            );
      for (const athlete of pod.athletes) {
        const athleteTarget =
          athlete.id === 'SELF' && directCustomSplitSecs !== null
            ? directCustomSplitSecs
            : podSplitSecs;
        map.set(athlete.id, { podKey, targetLapSecs: athleteTarget });
      }
    }
    return map;
  }, [
    vdotPods,
    activeWorkoutPreset.repDistanceMeters,
    activeWorkoutPreset.intensity,
    workoutPresetId,
    customWorkoutSpec,
    rosterInputs.length,
    restDurationSecs,
    environmentConditions,
  ]);

  const activePodKeys = useMemo(() => {
    const keys: string[] = [];
    for (const r of rosterInputs) {
      const key = runnerPodLookup.get(r.id)?.podKey || 'Pod A';
      if (!keys.includes(key)) keys.push(key);
    }
    return keys.length > 0 ? keys : ['Pod A'];
  }, [rosterInputs, runnerPodLookup]);

  const rosterMetaById = useMemo(() => {
    const outInjuryMemberIds = new Set<string>();
    for (const c of activeTeam?.injuryCases || []) {
      if (c.rtpStage === 'OUT') {
        outInjuryMemberIds.add(c.membershipId);
      }
    }
    const membershipById = new Map(
      (activeTeam?.memberships || []).map((m) => [m.membershipId, m])
    );
    const meta = new Map<string, { eventGroup?: CoachEventGroup; isInjured: boolean }>();
    for (const r of connectedRoster) {
      const memId = r.id.startsWith('team-mem-')
        ? r.id.slice('team-mem-'.length)
        : r.id;
      const membership = membershipById.get(memId);
      const isInjured =
        r.teamMemberStatus === 'INJURED' ||
        membership?.status === 'INJURED' ||
        outInjuryMemberIds.has(memId);
      const eventGroup = r.eventGroup || membership?.eventGroup;
      meta.set(r.id, { eventGroup, isInjured });
    }
    return meta;
  }, [connectedRoster, activeTeam?.injuryCases, activeTeam?.memberships]);

  const injuredAthleteCount = useMemo(() => {
    let count = 0;
    for (const r of rosterInputs) {
      if (rosterMetaById.get(r.id)?.isInjured) count += 1;
    }
    return count;
  }, [rosterInputs, rosterMetaById]);

  const hasAssignedEventGroups = useMemo(
    () => rosterInputs.some((r) => Boolean(rosterMetaById.get(r.id)?.eventGroup)),
    [rosterInputs, rosterMetaById]
  );

  const targetRaceLaps = sessionType === 'RACE' ? activeRacePreset.targetLaps : null;

  const runnerTelemetries = useMemo<RunnerSplitTelemetry[]>(() => {
    const rawList = rosterInputs.map((r) => {
      const podInfo = runnerPodLookup.get(r.id) || { podKey: 'Pod A', targetLapSecs: 75 };
      const waveOffset =
        podWaveOffsetsSecs[podInfo.podKey] ??
        DEFAULT_POD_WAVE_OFFSETS[podInfo.podKey] ??
        0;
      const repStarts = resolveRunnerRepStartTimestamps(
        { repStartTimestampsSecs },
        r.id,
        podInfo.podKey
      );
      return computeRunnerSplitTelemetry({
        runnerId: r.id,
        runnerName: r.name,
        podKey: podInfo.podKey,
        hipOrLane: hipOrLaneByRunnerId[r.id],
        rawTimestampsSecs: athleteLapTimestampsSecs[r.id] || [],
        repStartTimestampsSecs: repStarts,
        waveMode,
        waveOffsetSecs: waveOffset,
        targetLapSecs: sessionType === 'WORKOUT' ? podInfo.targetLapSecs : null,
        targetRaceLaps,
        sessionType,
        restDurationSecs,
        lastTapEpochMs: runnerLastTapEpochMs[r.id],
        nowEpochMs,
      });
    });
    return sessionType === 'RACE' ? computeRaceStandings(rawList) : rawList;
  }, [
    rosterInputs,
    runnerPodLookup,
    podWaveOffsetsSecs,
    repStartTimestampsSecs,
    hipOrLaneByRunnerId,
    athleteLapTimestampsSecs,
    waveMode,
    targetRaceLaps,
    sessionType,
    restDurationSecs,
    runnerLastTapEpochMs,
    nowEpochMs,
  ]);

  const recentSwapPair = useMemo(
    () => getRecentSwappableSplitPair(tapHistory, nowEpochMs, 4, 8000),
    [tapHistory, nowEpochMs]
  );

  const podsAwaitingNextRep = useMemo(() => {
    if (sessionType !== 'WORKOUT' || restDurationSecs <= 0) return [];
    const byPod = new Map<string, string[]>();
    for (const t of runnerTelemetries) {
      if (t.isAwaitingNextRepStart) {
        const list = byPod.get(t.podKey) || [];
        list.push(t.runnerId);
        byPod.set(t.podKey, list);
      }
    }
    return Array.from(byPod.entries()).map(([podKey, runnerIds]) => ({
      podKey,
      runnerIds,
      waitingCount: runnerIds.length,
    }));
  }, [runnerTelemetries, sessionType, restDurationSecs]);

  const filteredTelemetries = useMemo(() => {
    const cleanQuery = runnerSearchQuery.trim().toLowerCase();
    return runnerTelemetries.filter((t) => {
      const meta = rosterMetaById.get(t.runnerId);
      const hasRecordedMarks = t.lapSplitsSecs.length > 0;
      if (!hasRecordedMarks && !showInjuredAthletes && meta?.isInjured) {
        return false;
      }
      if (
        !hasRecordedMarks &&
        selectedEventGroupFilter !== 'ALL' &&
        meta?.eventGroup !== selectedEventGroupFilter
      ) {
        return false;
      }
      if (selectedPodFilter !== 'ALL' && t.podKey !== selectedPodFilter) return false;
      if (onlyOnTrack && pinnedRunnerIds.length > 0 && !pinnedRunnerIds.includes(t.runnerId)) {
        return false;
      }
      if (cleanQuery && !t.runnerName.toLowerCase().includes(cleanQuery)) return false;
      return true;
    });
  }, [
    runnerTelemetries,
    rosterMetaById,
    showInjuredAthletes,
    selectedEventGroupFilter,
    selectedPodFilter,
    runnerSearchQuery,
    onlyOnTrack,
    pinnedRunnerIds,
  ]);

  const maxColumnsInMatrix = useMemo(
    () => Math.max(1, ...filteredTelemetries.map((t) => t.lapSplitsSecs.length)),
    [filteredTelemetries]
  );

  const squadAutoRegSummary = useMemo(() => {
    if (sessionType !== 'WORKOUT') {
      return evaluateSquadLiveAutoRegulation([], dismissedAutoRegSignatures);
    }
    const rosterProfileById = new Map(roster.map((r) => [r.id, r.athleteProfile]));
    const inputs: RunnerLiveAutoRegInput[] = runnerTelemetries.map((t) => {
      const athProf = t.runnerId === 'SELF' ? selfProfile : rosterProfileById.get(t.runnerId);
      const podMeta = runnerPodLookup.get(t.runnerId);
      return {
        runnerId: t.runnerId,
        runnerName: t.runnerName,
        podKey: t.podKey,
        lapSplitsSecs: t.lapSplitsSecs,
        plannedRepCount: activeWorkoutPreset.repCount,
        repDistanceMeters: activeWorkoutPreset.repDistanceMeters,
        restDurationSecs,
        thresholdPaceSecsPerKm: athProf?.thresholdPaceSecsPerKm || selfProfile.thresholdPaceSecsPerKm || 245,
        targetSplitSecs: podMeta?.targetLapSecs ?? null,
        intensity: activeWorkoutPreset.intensity,
        zoneCode: customWorkoutSpec?.zoneCode,
      };
    });
    return evaluateSquadLiveAutoRegulation(inputs, dismissedAutoRegSignatures);
  }, [
    sessionType,
    runnerTelemetries,
    roster,
    selfProfile,
    runnerPodLookup,
    activeWorkoutPreset,
    restDurationSecs,
    customWorkoutSpec?.zoneCode,
    dismissedAutoRegSignatures,
  ]);

  const isRelayMode = sessionType === 'RACE' && Boolean(activeRacePreset.isRelay);

  const relayTelemetries = useMemo(
    () =>
      isRelayMode
        ? relayQuartets.map((quartet) =>
            computeRelayQuartetTelemetry({
              quartet,
              preset: activeRacePreset,
              rawHandoffTimestampsSecs: relayBatonTimestampsSecs[quartet.id] || [],
              isRunning: stopwatchRunning,
            })
          )
        : [],
    [isRelayMode, relayQuartets, activeRacePreset, relayBatonTimestampsSecs, stopwatchRunning]
  );

  const hasCustomEnvOrLane =
    showEnvPhysicsPanel ||
    trackLane > 1 ||
    trackFacility !== 'OUTDOOR_400M' ||
    windSpeedMps >= 4 ||
    altitudeMeters >= 1000 ||
    activeEnvAdjustment.heatSlowdownPct > 0 ||
    footwearClass !== 'DAILY_TRAINER';

  return {
    activeTeam,
    isCoachingTeam,
    customPlanPreset,
    baseWorkoutPreset,
    activeWorkoutPreset,
    activeRacePreset,
    connectedRoster,
    rosterInputs,
    environmentConditions,
    vdotPods,
    laneGeometry,
    activeEnvAdjustment,
    runnerPodLookup,
    activePodKeys,
    rosterMetaById,
    injuredAthleteCount,
    hasAssignedEventGroups,
    targetRaceLaps,
    runnerTelemetries,
    recentSwapPair,
    podsAwaitingNextRep,
    filteredTelemetries,
    maxColumnsInMatrix,
    squadAutoRegSummary,
    isRelayMode,
    relayTelemetries,
    hasCustomEnvOrLane,
  };
}
