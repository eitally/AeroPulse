import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Award,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronRight,
  Download,
  Gauge,
  Plus,
  Sliders,
  Sparkles,
  Target,
  Timer,
  Trash2,
  Trophy,
  X,
} from './icons/PhosphorIcons';
import {
  AnnualMileageGoal,
  AthleteGearItem,
  AthleteProfile,
  ConnectedAthleteRecord,
  DistanceUnit,
  EnvironmentFilter,
  PlannedWorkoutEvent,
  SpeedReservePhenotype,
  SportCategory,
  TargetGoal,
  TeamSummaryWithRole,
  TrackTargetEventGroup,
  TrackTrainingZoneCode,
  TrackWorkoutSpec,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import {
  buildTrackSpeedReserveProfile,
  defaultMetersForTrackEvent,
  parseTrackMarkClockInput,
} from '../physiology/trackSpeedReserveEngine';
import {
  generateAllEventsTrackPlan,
  type AllTrackFieldArchetypeId,
} from '../physiology/allEventsPlanEngine';
import {
  formatTrackSplitToken,
  generatePeriodizedTrackPlan,
  type TrackStartingPhaseOption,
} from '../physiology/trackPrescriptionEngine';
import {
  ENDURANCE_PLAN_ARCHETYPES,
  generateEnduranceTrainingPlan,
  resolvePlanStartMondayIso,
  type EndurancePlanArchetypeId,
  type PlanStartAnchorMode,
  type PlanVolumeTier,
} from '../physiology/cyclingPrescriptionEngine';
import { getLocalDateIso, shiftIsoDate } from '../physiology/stravaLoadCalibration';
import {
  formatDuration,
  formatGoalMetricValue,
  formatPace,
  formatPaceClockInput,
  parsePaceClockInput,
} from '../utils/formatters';
import {
  DEFAULT_SWIM_CSS_SECS_PER_100M,
  formatSwimClockInput,
  parseSwimClockInput,
} from '../physiology/swimZones';
import { buildCompleteAthleteProfile } from '../utils/telemetryStorage';
import {
  exportWorkoutAsErg,
  exportWorkoutAsFit,
  exportWorkoutAsZwo,
} from '../utils/workoutExportActions';
import {
  computeAmplitudeHeightPct,
  formatHumanReadableStepLine,
  parseWorkoutSteps,
} from '../utils/workoutParser';
import {
  inferTrackWorkoutSpecFromPlannedEvent,
  stageWorkoutInTracksideStopwatch,
} from '../hooks/useTracksideStopwatch';
import { ChartInfoTooltip } from './ChartInfoTooltip';
import {
  ArchetypeProgressionSparkline,
  BracketedIntervalTape,
  PublishWindowTimelineBracket,
} from './charts/MicroGraphics';
import { VisualWorkoutBuilder, type VisualWorkoutSavePayload } from './VisualWorkoutBuilder';
import { useModalDialog } from '../hooks/useModalDialog';
import { computeFatigueSlicedDurability } from '../physiology/durabilityEngine';
import { simulateCoursePacingAndFueling } from '../physiology/raceSimulator';
import {
  selectSessionsForPublishCadence,
  type PlanPublishAudience,
  type PlanPublishCadence,
} from '../physiology/planPublishEngine';
import { getSavedIntervalsHeaders } from '../utils/telemetryStorage';
import {
  ALL_GOAL_ARCHETYPES,
  TRACK_ARCHETYPES,
  WEEKDAY_CHIPS,
  type GoalArchetypeCategory,
  type GoalArchetypeId,
  type GoalArchetypeTemplate,
  type TrackArchetypeId,
} from './goals/goalArchetypeTemplates';
import { getTrackEventSeedPresets, TrackSpeedReservePanel } from './goals/TrackSpeedReservePanel';
import { RacePhysicsSimulatorBody } from './goals/RacePhysicsSimulatorBody';
import { ShoeSpikeClosetSection } from './goals/ShoeSpikeClosetSection';
export type {
  GoalArchetypeCategory,
  GoalArchetypeId,
  GoalArchetypeTemplate,
  TrackArchetypeId,
};

export interface PlannedEventBatchItem {
  date: string;
  name: string;
  sportCategory: SportCategory;
  environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
  plannedDurationSecs: number;
  plannedLoad: number;
  workoutSyntax: string;
  description: string;
  scheduledTime?: string;
  sessionSlot?: import('../types').WorkoutSessionSlot;
  locationName?: string;
  locationCategory?: import('../types').PracticeVenueCategory;
  meetingNotes?: string;
  trackSpec?: TrackWorkoutSpec;
  replaceExistingDate?: boolean;
  planBlockId?: string;
  planBlockName?: string;
  planWeekNum?: number;
}

interface GoalsViewProps {
  annualMileageGoals: AnnualMileageGoal[];
  onUpdateAnnualMileageGoal: (sport: 'Running' | 'Cycling' | 'Swimming', targetMeters: number) => void;
  targetGoals: TargetGoal[];
  onAddTargetGoal: (goal: Omit<TargetGoal, 'id'>) => void;
  onDeleteTargetGoal: (id: string) => void;
  activities: UnifiedActivity[];
  wellnessDays: UnifiedWellnessDay[];
  plannedEvents?: PlannedWorkoutEvent[];
  athleteProfile?: AthleteProfile;
  gearItems?: AthleteGearItem[];
  onSaveGearItems?: (nextItems: AthleteGearItem[]) => Promise<void> | void;
  envFilter: EnvironmentFilter;
  onSelectEnvFilter: (env: EnvironmentFilter) => void;
  distanceUnit: DistanceUnit;
  currentCtl: number;
  activeTeam?: TeamSummaryWithRole | null;
  connectedRoster?: ConnectedAthleteRecord[];
  onTeamsUpdated?: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string) => void;
  onBatchCreatePlannedEvents?: (events: PlannedEventBatchItem[]) => Promise<void>;
  onCreatePlannedEvent?: (eventInput: {
    date: string;
    name: string;
    sportCategory: SportCategory;
    environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
    plannedDurationSecs: number;
    plannedLoad: number;
    workoutSyntax: string;
    description: string;
    trackSpec?: TrackWorkoutSpec;
    replaceExistingDate?: boolean;
    planBlockId?: string;
    planBlockName?: string;
    planWeekNum?: number;
  }) => Promise<void>;
  onDeletePlanBlock?: (planBlockId: string) => Promise<void>;
  onSaveProfileOverride?: (updatedProfile: AthleteProfile) => Promise<void>;
  onSelectActivity?: (activity: UnifiedActivity) => void;
  onSwitchToCalendar?: () => void;
  onBackToCoachWorkspace?: () => void;
  onOpenOfficialRaceModal?: () => void;
  onOpenCoachWithPrompt?: (prompt: string) => void;
  onOpenTracksideStopwatch?: () => void;
}


const GoalsViewInner: React.FC<GoalsViewProps> = ({
  targetGoals,
  onAddTargetGoal,
  onDeleteTargetGoal,
  activities,
  wellnessDays,
  plannedEvents = [],
  athleteProfile,
  gearItems = [],
  onSaveGearItems,
  distanceUnit,
  currentCtl,
  activeTeam = null,
  connectedRoster = [],
  onTeamsUpdated,
  onBatchCreatePlannedEvents,
  onCreatePlannedEvent,
  onDeletePlanBlock,
  onOpenOfficialRaceModal,
  onSwitchToCalendar,
  onBackToCoachWorkspace,
  onOpenTracksideStopwatch,
}) => {
  const formId = useId();
  const todayIso = useMemo(() => getLocalDateIso(), []);

  // Top-Level Plan Builder Mode Switch
  const [builderMode, setBuilderMode] = useState<'GOAL_PLAN' | 'SINGLE_WORKOUT'>('GOAL_PLAN');
  const [singleWorkoutSavedMsg, setSingleWorkoutSavedMsg] = useState<string | null>(null);

  // Smart Default Archetype by athlete's primarySport
  const [archetypeCategory, setArchetypeCategory] = useState<GoalArchetypeCategory>(() =>
    athleteProfile?.primarySport === 'Swimming' || athleteProfile?.primarySport === 'Triathlon'
      ? 'SWIM_TRI'
      : athleteProfile?.primarySport === 'Running'
        ? 'ROAD'
        : 'CYCLING'
  );
  const [selectedArchetypeId, setSelectedArchetypeId] = useState<GoalArchetypeId>(() =>
    athleteProfile?.primarySport === 'Swimming'
      ? 'SWIM_CSS_ENDURANCE'
      : athleteProfile?.primarySport === 'Triathlon'
        ? 'TRI_OLYMPIC'
        : athleteProfile?.primarySport === 'Running'
          ? 'ROAD_HALF_MARATHON'
          : 'CYC_FTP_BUILDER'
  );
  const [blockWeeks, setBlockWeeks] = useState<4 | 8 | 12 | 16>(12);
  const [startAnchorMode, setStartAnchorMode] = useState<PlanStartAnchorMode>('NEXT_MONDAY');
  const [targetRaceDateIso, setTargetRaceDateIso] = useState<string>(() =>
    shiftIsoDate(getLocalDateIso(), 84)
  );
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([1, 2, 3, 5, 6]);
  const [longDayPreference, setLongDayPreference] = useState<'Saturday' | 'Sunday'>('Sunday');
  const [blockEnvPref, setBlockEnvPref] = useState<'FLEXIBLE' | 'OUTDOOR' | 'INDOOR'>('FLEXIBLE');
  const [volumeTier, setVolumeTier] = useState<PlanVolumeTier>('AUTO');

  // Track Speed-Reserve & Phase State
  const [trackStartingPhase, setTrackStartingPhase] =
    useState<TrackStartingPhaseOption>('FULL_PROGRESSION');
  const [trackPhenotypeOverride, setTrackPhenotypeOverride] = useState<
    SpeedReservePhenotype | 'AUTO'
  >('AUTO');
  const [trackSeedInput, setTrackSeedInput] = useState<string>('');
  const [trackGoalInput, setTrackGoalInput] = useState<string>('');

  // Preview Week, Inline Session Overrides & Populate/Undo State
  const [selectedPreviewWeekIdx, setSelectedPreviewWeekIdx] = useState<number>(0);
  const [sessionOverrides, setSessionOverrides] = useState<Record<string, PlannedEventBatchItem>>(
    {}
  );
  const [editingPreviewTarget, setEditingPreviewTarget] = useState<{
    key: string;
    session: PlannedEventBatchItem;
  } | null>(null);
  const previewEditDialogRef = useRef<HTMLDivElement>(null);
  const [isPopulatingCalendar, setIsPopulatingCalendar] = useState(false);
  const [populatedSuccessMsg, setPopulatedSuccessMsg] = useState<string | null>(null);
  const [lastPopulatedBlockId, setLastPopulatedBlockId] = useState<string | null>(null);
  const [lastPopulatedTeamBlock, setLastPopulatedTeamBlock] = useState<{
    teamId: string;
    blockId: string;
  } | null>(null);
  const [publishCadence, setPublishCadence] = useState<PlanPublishCadence>('FULL_BLOCK');
  const [publishAudience, setPublishAudience] = useState<PlanPublishAudience>('SELF');
  const [isRemovingBlock, setIsRemovingBlock] = useState(false);

  useModalDialog({
    isOpen: editingPreviewTarget !== null,
    onClose: () => setEditingPreviewTarget(null),
    dialogRef: previewEditDialogRef,
  });

  useEffect(() => {
    try {
      const pendingCohort = sessionStorage.getItem('thresh_open_plan_cohort');
      if (pendingCohort === 'TEAM_ALL') {
        sessionStorage.removeItem('thresh_open_plan_cohort');
        setBuilderMode('GOAL_PLAN');
        setPublishAudience('TEAM_ALL');
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const visibleArchetypes = useMemo(
    () =>
      archetypeCategory === 'ALL'
        ? ALL_GOAL_ARCHETYPES
        : ALL_GOAL_ARCHETYPES.filter((a) => a.category === archetypeCategory),
    [archetypeCategory]
  );

  const selectedArchetype = useMemo(
    () => ALL_GOAL_ARCHETYPES.find((a) => a.id === selectedArchetypeId) || ALL_GOAL_ARCHETYPES[0],
    [selectedArchetypeId]
  );

  const activeCalendarBlock = useMemo(() => {
    const found = plannedEvents.find((e) => Boolean(e.planBlockId));
    if (!found?.planBlockId) return null;
    const count = plannedEvents.filter((e) => e.planBlockId === found.planBlockId).length;
    return {
      id: found.planBlockId,
      name: found.planBlockName || 'Training Plan Block',
      count,
    };
  }, [plannedEvents]);

  const [pendingDeleteGoalId, setPendingDeleteGoalId] = useState<string | null>(null);
  const currentBikeFtp = useMemo(() => {
    const safeDays = Array.isArray(wellnessDays) ? wellnessDays : [];
    const latestRideEftp = [...safeDays]
      .reverse()
      .find((w) => w?.rideEftp && w.rideEftp > 0)?.rideEftp;
    return athleteProfile?.ftp || latestRideEftp || 250;
  }, [athleteProfile?.ftp, wellnessDays]);

  const safeThresholdPace = Math.max(95, athleteProfile?.thresholdPaceSecsPerKm || 250);
  const safeSwimCss = athleteProfile?.swimCssSecsPer100m || DEFAULT_SWIM_CSS_SECS_PER_100M;

  // Course Physics, Durability, Weather & Carb/Sodium Race Simulator State (stored cleanly in SI)
  const [simSport, setSimSport] = useState<'Cycling' | 'Running'>('Running');
  const [simRaceName, setSimRaceName] = useState<string>('Half Marathon / Gran Fondo A-Race');
  const [simDistKm, setSimDistKm] = useState<number>(21.1);
  const [simElevM, setSimElevM] = useState<number>(185);
  const [simTempC, setSimTempC] = useState<number>(18);
  const [simAltM, setSimAltM] = useState<number>(250);

  const raceSimulationReport = useMemo(() => {
    const prof = athleteProfile || buildCompleteAthleteProfile({});
    const durReport = computeFatigueSlicedDurability({
      discipline: simSport,
      activities,
      streamMap: new Map(),
      athleteProfile: prof,
    });
    return simulateCoursePacingAndFueling({
      sport: simSport,
      raceName: simRaceName,
      distanceKm: simDistKm,
      elevationGainMeters: simElevM,
      ambientTempC: simTempC,
      altitudeMeters: simAltM,
      athleteProfile: prof,
      durabilityReport: durReport,
    });
  }, [
    simSport,
    simRaceName,
    simDistKm,
    simElevM,
    simTempC,
    simAltM,
    athleteProfile,
    activities,
  ]);

  // Track Speed-Reserve Profile (derived from official FAT races, manual seed mark, or synced threshold pace)
  const trackSpeedReserveState = useMemo(() => {
    const officialMarks = (Array.isArray(activities) ? activities : [])
      .filter((a) => Boolean(a?.officialRaceData))
      .map((a) => ({
        distanceMeters: a.officialRaceData!.eventDistanceMeters,
        durationSecs: a.officialRaceData!.fatTimeSecs,
        eventLabel: a.officialRaceData!.eventLabel,
        dateIso: (a.startDateLocal || todayIso).slice(0, 10),
      }));

    const parsedManualSeed = parseTrackMarkClockInput(
      trackSeedInput,
      selectedArchetype.trackEventGroup
        ? defaultMetersForTrackEvent(selectedArchetype.trackEventGroup)
        : 1609.34
    );

    const marks = parsedManualSeed ? [parsedManualSeed] : officialMarks;
    const isCalibratingEstimate =
      marks.length === 0 &&
      !(athleteProfile?.thresholdPaceSecsPerKm && athleteProfile.thresholdPaceSecsPerKm > 0);

    const profile = buildTrackSpeedReserveProfile({
      marks,
      thresholdPaceSecsPerKm: athleteProfile?.thresholdPaceSecsPerKm,
      phenotypeOverride: trackPhenotypeOverride,
    });

    const parsedGoalMark = parseTrackMarkClockInput(
      trackGoalInput,
      selectedArchetype.trackEventGroup
        ? defaultMetersForTrackEvent(selectedArchetype.trackEventGroup)
        : 1609.34
    );

    return {
      profile,
      parsedManualSeed,
      goalTimeSecs: parsedGoalMark?.durationSecs,
      officialMarkCount: officialMarks.length,
      isCalibratingEstimate,
    };
  }, [
    activities,
    athleteProfile?.thresholdPaceSecsPerKm,
    selectedArchetype.trackEventGroup,
    trackGoalInput,
    trackPhenotypeOverride,
    trackSeedInput,
  ]);

  const resolvedStartMondayIso = useMemo(
    () =>
      resolvePlanStartMondayIso({
        anchorMode: startAnchorMode,
        todayIso,
        targetRaceDateIso,
        blockWeeks,
      }),
    [startAnchorMode, todayIso, targetRaceDateIso, blockWeeks]
  );

  const longDayOffset: number = longDayPreference === 'Saturday' ? 5 : 6;

  const trackPlanBundle = useMemo(() => {
    if (!selectedArchetype.trackEventGroup) return null;
    return generatePeriodizedTrackPlan({
      startDateIso: resolvedStartMondayIso,
      blockWeeks,
      eventGroup: selectedArchetype.trackEventGroup,
      dateProfile: trackSpeedReserveState.profile,
      startingPhase: trackStartingPhase,
      phenotypeOverride: trackPhenotypeOverride,
      goalTimeSecs: trackSpeedReserveState.goalTimeSecs,
      selectedWeekdays,
      longDayOffset,
    });
  }, [
    selectedArchetype.trackEventGroup,
    resolvedStartMondayIso,
    blockWeeks,
    trackSpeedReserveState.profile,
    trackSpeedReserveState.goalTimeSecs,
    trackStartingPhase,
    trackPhenotypeOverride,
    selectedWeekdays,
    longDayOffset,
  ]);

  // Unified Periodized Weeks (Track Oval Engine, All-Events Sprint/Hurdle/Field Engine, OR Endurance Engine)
  const isAllTfEventPlan =
    selectedArchetype.id === 'TRACK_SPRINTS' ||
    selectedArchetype.id === 'TRACK_HURDLES' ||
    selectedArchetype.id === 'TRACK_JUMPS_PV' ||
    selectedArchetype.id === 'TRACK_THROWS' ||
    selectedArchetype.id === 'TRACK_MULTI';

  const generatedPlanWeeks = useMemo(() => {
    const formatTrackWeekRows = (weeks: Array<{ weekNum: number; startDate: string; phaseLabel: string; isDeload: boolean; isTaper: boolean; targetTss: number; targetHours: number; zoneDistributionPct: [number, number, number, number, number, number]; sessions: PlannedWorkoutEvent[] }>) =>
      weeks.map((wk) => ({
        weekNum: wk.weekNum,
        startDateIso: wk.startDate,
        phase: wk.phaseLabel,
        isDeload: wk.isDeload,
        isTaper: wk.isTaper,
        targetTss: wk.targetTss,
        targetHours: wk.targetHours.toFixed(1),
        zoneDistributionPct: wk.zoneDistributionPct,
        sessions: wk.sessions.map((s) => ({
          date: s.date,
          name: s.name,
          sportCategory: s.sportCategory,
          environmentPreference:
            blockEnvPref === 'FLEXIBLE' ? s.environmentPreference : blockEnvPref,
          plannedDurationSecs: s.plannedDurationSecs,
          plannedLoad: s.plannedLoad,
          workoutSyntax: s.workoutSyntax || '',
          description: s.description,
          trackSpec: s.trackSpec,
          replaceExistingDate: true,
        })),
      }));

    const rawWeeks = trackPlanBundle
      ? formatTrackWeekRows(trackPlanBundle.weeks)
      : isAllTfEventPlan
        ? formatTrackWeekRows(
            generateAllEventsTrackPlan({
              archetypeId: selectedArchetype.id as AllTrackFieldArchetypeId,
              startDateIso: resolvedStartMondayIso,
              blockWeeks,
              selectedWeekdays,
            })
          )
      : generateEnduranceTrainingPlan({
          archetypeId: selectedArchetype.id as EndurancePlanArchetypeId,
          startDateIso: resolvedStartMondayIso,
          blockWeeks,
          selectedWeekdays,
          longDayOffset,
          environmentPreference: blockEnvPref,
          currentCtl,
          volumeTier,
          distanceUnit,
          athleteProfile,
          ftpWatts: currentBikeFtp,
          targetRaceDateIso: startAnchorMode === 'RACE_DATE' ? targetRaceDateIso : undefined,
        });

    return rawWeeks.map((wk) => {
      const mergedSessions = wk.sessions.map((s, sIdx) => {
        const key = `${wk.weekNum}-${sIdx}`;
        return sessionOverrides[key] || s;
      });
      const totalSecs = mergedSessions.reduce((acc, s) => acc + s.plannedDurationSecs, 0);
      const totalLoad = mergedSessions.reduce((acc, s) => acc + s.plannedLoad, 0);
      return {
        ...wk,
        sessions: mergedSessions,
        targetTss: totalLoad,
        targetHours: (totalSecs / 3600).toFixed(1),
      };
    });
  }, [
    trackPlanBundle,
    isAllTfEventPlan,
    selectedArchetype.id,
    resolvedStartMondayIso,
    blockWeeks,
    selectedWeekdays,
    longDayOffset,
    blockEnvPref,
    currentCtl,
    volumeTier,
    distanceUnit,
    athleteProfile,
    currentBikeFtp,
    startAnchorMode,
    targetRaceDateIso,
    sessionOverrides,
  ]);

  const handleSelectArchetype = (arch: GoalArchetypeTemplate) => {
    const prevEventGroup = selectedArchetype.trackEventGroup;
    setSelectedArchetypeId(arch.id);
    setBlockWeeks(arch.defaultWeeks);
    setSelectedPreviewWeekIdx(0);
    setSessionOverrides({});
    setPopulatedSuccessMsg(null);
    if (
      arch.trackEventGroup &&
      prevEventGroup &&
      arch.trackEventGroup !== prevEventGroup &&
      getTrackEventSeedPresets(prevEventGroup).presets.includes(trackSeedInput.trim())
    ) {
      setTrackSeedInput('');
    }
    if (arch.category === 'TRACK') {
      setSelectedWeekdays([1, 2, 4, 6]);
      setLongDayPreference('Sunday');
    } else if (selectedWeekdays.length < 4) {
      setSelectedWeekdays([1, 2, 3, 5, 6]);
    }
  };

  const toggleWeekdayPill = (dayOff: number) => {
    setSelectedWeekdays((prev) => {
      if (prev.includes(dayOff)) {
        if (prev.length <= 3) return prev;
        return prev.filter((d) => d !== dayOff);
      }
      return [...prev, dayOff].sort((a, b) => a - b);
    });
  };

  const handlePopulatePlanToCalendar = async () => {
    if (!onBatchCreatePlannedEvents) return;
    setIsPopulatingCalendar(true);
    setPopulatedSuccessMsg(null);
    try {
      const blockId = `plan-blk-${Date.now()}`;
      const selected = selectSessionsForPublishCadence(
        generatedPlanWeeks,
        publishCadence,
        selectedPreviewWeekIdx,
        {
          blockId,
          baseTitle: selectedArchetype.title,
          audience: publishAudience,
        }
      );

      const isTeamCoach = Boolean(
        activeTeam &&
          (activeTeam.myRole === 'HEAD_COACH' || activeTeam.myRole === 'ASSISTANT_COACH')
      );

      if (selected.cohort.isTeamBroadcast && isTeamCoach && activeTeam) {
        const resp = await fetch(
          `/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}/workouts/broadcast-batch`,
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              ...getSavedIntervalsHeaders(),
            },
            body: JSON.stringify({
              origin: window.location.origin,
              targetSquadGroup: selected.cohort.targetSquadGroup,
              ...(selected.cohort.targetEventGroups
                ? { targetEventGroups: selected.cohort.targetEventGroups }
                : {}),
              publishMode: publishCadence,
              planBlockId: blockId,
              planBlockName: selected.sessions[0]?.planBlockName || selectedArchetype.title,
              replaceExistingCohortRange: true,
              workouts: selected.sessions,
            }),
          }
        );
        if (resp.ok) {
          const data = await resp.json().catch(() => ({}));
          if (Array.isArray(data.teams) && onTeamsUpdated) {
            onTeamsUpdated(data.teams, activeTeam.brand.teamId);
          }
          setLastPopulatedTeamBlock({ teamId: activeTeam.brand.teamId, blockId });
          setLastPopulatedBlockId(null);
          setPopulatedSuccessMsg(
            `Published ${selected.sessions.length} workouts (${selected.cadenceLabel}) to ${selected.cohort.cohortLabel}.`
          );
          return;
        }
      }

      await onBatchCreatePlannedEvents(selected.sessions);
      setLastPopulatedBlockId(blockId);
      setLastPopulatedTeamBlock(null);

      // Upsert a matching TargetGoal automatically if none exists for this block title
      const alreadyTracked = (Array.isArray(targetGoals) ? targetGoals : []).some(
        (g) => (g?.title || '').toLowerCase() === selectedArchetype.title.toLowerCase()
      );
      if (!alreadyTracked) {
        const finalWeekLastDate =
          generatedPlanWeeks[generatedPlanWeeks.length - 1]?.sessions[
            generatedPlanWeeks[generatedPlanWeeks.length - 1].sessions.length - 1
          ]?.date || targetRaceDateIso;
        const isCycling = selectedArchetype.sportCategory === 'Cycling';
        const isSwimming = selectedArchetype.sportCategory === 'Swimming';
        const isMultisport = selectedArchetype.sportCategory === 'Multisport';
        onAddTargetGoal({
          title: selectedArchetype.title,
          type: 'RACE_EVENT',
          sportCategory: selectedArchetype.sportCategory,
          targetDate: startAnchorMode === 'RACE_DATE' ? targetRaceDateIso : finalWeekLastDate,
          priority: 'A-Race',
          currentValue: isCycling
            ? currentBikeFtp
            : isSwimming
              ? safeSwimCss
              : isMultisport
                ? Math.round(currentCtl)
                : safeThresholdPace,
          targetValue: isCycling
            ? Math.round(currentBikeFtp * 1.08)
            : isSwimming
              ? Math.max(65, Math.round(safeSwimCss * 0.96))
              : isMultisport
                ? Math.max(60, Math.round(currentCtl + 15))
                : Math.round(safeThresholdPace * 0.96),
          unit: isCycling ? 'W' : isSwimming ? 's/100m' : isMultisport ? 'CTL' : 's/km',
          notes: `Auto-created from ${blockWeeks}-week ${selectedArchetype.title} plan (${resolvedStartMondayIso}).`,
        });
      }

      setPopulatedSuccessMsg(
        selected.cohort.isTeamBroadcast
          ? `Published ${selected.sessions.length} workouts (${selected.cadenceLabel}) for ${selected.cohort.cohortLabel}.`
          : `Scheduled ${selected.sessions.length} workouts (${selected.cadenceLabel} of ${selectedArchetype.title} starting ${resolvedStartMondayIso}).`
      );
    } finally {
      setIsPopulatingCalendar(false);
    }
  };

  const handleUndoPopulatedBlock = async (blockIdToRemove: string) => {
    setIsRemovingBlock(true);
    try {
      if (lastPopulatedTeamBlock && lastPopulatedTeamBlock.blockId === blockIdToRemove) {
        const resp = await fetch(
          `/api/teams/${encodeURIComponent(lastPopulatedTeamBlock.teamId)}/workouts/blocks/${encodeURIComponent(blockIdToRemove)}`,
          {
            method: 'DELETE',
            credentials: 'include',
            headers: getSavedIntervalsHeaders(),
          }
        );
        if (resp.ok) {
          const data = await resp.json().catch(() => ({}));
          if (Array.isArray(data.teams) && onTeamsUpdated) {
            onTeamsUpdated(data.teams, lastPopulatedTeamBlock.teamId);
          }
        }
        setLastPopulatedTeamBlock(null);
        setPopulatedSuccessMsg(null);
        return;
      }
      if (!onDeletePlanBlock || !blockIdToRemove) return;
      await onDeletePlanBlock(blockIdToRemove);
      if (lastPopulatedBlockId === blockIdToRemove) {
        setLastPopulatedBlockId(null);
      }
      setPopulatedSuccessMsg(null);
    } finally {
      setIsRemovingBlock(false);
    }
  };

  // New Race / Performance Goal Form State
  const defaultGoalSport: SportCategory =
    athleteProfile?.primarySport === 'Cycling'
      ? 'Cycling'
      : athleteProfile?.primarySport === 'Swimming'
        ? 'Swimming'
        : athleteProfile?.primarySport === 'Triathlon' || athleteProfile?.primarySport === 'Hybrid'
          ? 'Multisport'
          : 'Running';
  const [newTitle, setNewTitle] = useState('');
  const [newSport, setNewSport] = useState<SportCategory>(defaultGoalSport);
  const [newPriority, setNewPriority] = useState<'A-Race' | 'B-Race' | 'Milestone'>('A-Race');
  const [newTargetDate, setNewTargetDate] = useState(() => shiftIsoDate(todayIso, 84));
  const [newTargetVal, setNewTargetVal] = useState(() =>
    defaultGoalSport === 'Cycling'
      ? String(Math.round(currentBikeFtp * 1.08))
      : defaultGoalSport === 'Swimming'
        ? formatSwimClockInput(Math.max(65, Math.round(safeSwimCss * 0.96)), distanceUnit)
        : defaultGoalSport === 'Running'
          ? formatPaceClockInput(Math.round(safeThresholdPace * 0.96), distanceUnit)
          : String(Math.max(60, Math.round(currentCtl + 15)))
  );
  const [newUnit, setNewUnit] = useState(() =>
    defaultGoalSport === 'Cycling'
      ? 'W'
      : defaultGoalSport === 'Swimming'
        ? 's/100m'
        : defaultGoalSport === 'Running'
          ? 's/km'
          : 'CTL'
  );
  const [newNotes, setNewNotes] = useState('');

  const handleAddGoalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const val =
      newUnit === 's/km'
        ? parsePaceClockInput(newTargetVal, distanceUnit) ??
          (Math.round(safeThresholdPace * 0.96) || 240)
        : newUnit === 's/100m'
          ? parseSwimClockInput(newTargetVal, distanceUnit) ??
            Math.max(65, Math.round(safeSwimCss * 0.96))
          : Number(newTargetVal) || 85;
    onAddTargetGoal({
      title: newTitle.trim(),
      type: newPriority === 'Milestone' ? 'PERFORMANCE_METRIC' : 'RACE_EVENT',
      sportCategory: newSport,
      targetDate: newTargetDate >= todayIso ? newTargetDate : todayIso,
      priority: newPriority,
      targetCtl: newUnit === 'CTL' ? val : undefined,
      currentValue:
        newUnit === 'CTL'
          ? currentCtl
          : newUnit === 'W'
            ? currentBikeFtp
            : newUnit === 's/km'
              ? safeThresholdPace
              : newUnit === 's/100m'
                ? safeSwimCss
                : Math.round(val * 0.92),
      targetValue: val,
      unit: newUnit,
      notes: newNotes.trim() || 'Custom performance target tracked by MeetReady.',
    });
    setNewTitle('');
    setNewNotes('');
  };

  const activePreviewWeek =
    generatedPlanWeeks[Math.min(selectedPreviewWeekIdx, Math.max(0, generatedPlanWeeks.length - 1))] ||
    generatedPlanWeeks[0] || {
      weekNum: 1,
      startDateIso: resolvedStartMondayIso,
      phase: 'Build',
      isDeload: false,
      isTaper: false,
      targetTss: 0,
      targetHours: '0.0',
      zoneDistributionPct: { low: 80, mod: 10, high: 10 },
      sessions: [],
    };

  const isImperial = distanceUnit === 'mi';
  const simDistDisplay = isImperial ? Number((simDistKm * 0.621371).toFixed(1)) : simDistKm;
  const simElevDisplay = isImperial ? Math.round(simElevM * 3.28084) : simElevM;
  const simTempDisplay = isImperial ? Math.round((simTempC * 9) / 5 + 32) : simTempC;
  const simAltDisplay = isImperial ? Math.round(simAltM * 3.28084) : simAltM;

  return (
    <div className="space-y-6">
      {/* ==========================================================================
          PLAN BUILDER TOP CARD (GOAL TRAINING PLAN | SINGLE WORKOUT BUILDER)
         ========================================================================== */}
      <section className="rounded-2xl liquid-glass p-5 space-y-5 border border-ap-cobalt/25 dark:border-ap-volt/20">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <Target className="w-5 h-5 ap-text-brand shrink-0" />
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">
              Plan Builder
            </h1>
            <ChartInfoTooltip
              title="Periodized Plan & Visual Workout Builder"
              subtitle="15 Goal Plans + Visual Repeat/Warm-Up/Cooldown Workout Studio"
              whatItMeasures="Creates individualized multi-week periodized training blocks calibrated to your Cycling FTP (or Indoor FTP) and Running Critical Speed/Threshold Pace, with every-4th-week -30% deloads and -50% race-week taper."
              benchmarks="Polarized 80/20 base blocks allocate >=75% of weekly duration to Z1/Z2 recovery/aerobic work. Time-crunched indoor blocks keep weekdays <=60m."
              coachingAction="Pick a goal plan or switch to Single Workout Builder for one-off sessions. Preview each session skyline before populating to your Training Calendar."
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Top Mode Switch */}
            <div
              role="group"
              aria-label="Plan Builder Mode"
              className="flex items-center gap-1 p-1 rounded-xl liquid-capsule-track"
            >
              <button
                type="button"
                data-testid="plan-mode-goal-block"
                aria-pressed={builderMode === 'GOAL_PLAN'}
                onClick={() => setBuilderMode('GOAL_PLAN')}
                className={`min-h-[44px] sm:min-h-[36px] px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  builderMode === 'GOAL_PLAN'
                    ? 'ap-nav-volt-active'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                Goal Training Plan
              </button>
              <button
                type="button"
                data-testid="plan-mode-single-workout"
                aria-pressed={builderMode === 'SINGLE_WORKOUT'}
                onClick={() => setBuilderMode('SINGLE_WORKOUT')}
                className={`min-h-[44px] sm:min-h-[36px] px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  builderMode === 'SINGLE_WORKOUT'
                    ? 'ap-nav-volt-active'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                Single Workout Builder
              </button>
            </div>

            {publishAudience !== 'SELF' && onBackToCoachWorkspace && (
              <button
                type="button"
                data-testid="goals-back-to-coach-btn"
                onClick={onBackToCoachWorkspace}
                className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl ap-btn-primary text-xs font-bold whitespace-nowrap cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to Coach Workspace</span>
              </button>
            )}

            {onOpenOfficialRaceModal && (
              <button
                type="button"
                onClick={onOpenOfficialRaceModal}
                className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl ap-btn-secondary text-xs font-semibold whitespace-nowrap cursor-pointer"
              >
                <Trophy className="w-3.5 h-3.5 text-amber-500" />
                <span>Log Race</span>
              </button>
            )}

            {onSwitchToCalendar && (
              <button
                type="button"
                onClick={onSwitchToCalendar}
                className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl ap-btn-secondary text-xs font-semibold whitespace-nowrap cursor-pointer"
              >
                <CalendarIcon className="w-3.5 h-3.5 ap-text-brand" />
                <span>Open Calendar</span>
              </button>
            )}
          </div>
        </div>

        {/* ======================================================================
            MODE B: SINGLE WORKOUT BUILDER
           ====================================================================== */}
        {builderMode === 'SINGLE_WORKOUT' ? (
          <div className="space-y-4">
            {singleWorkoutSavedMsg && (
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{singleWorkoutSavedMsg}</span>
                </span>
                {onSwitchToCalendar && (
                  <button
                    type="button"
                    onClick={onSwitchToCalendar}
                    className="inline-flex items-center gap-1 font-bold underline cursor-pointer"
                  >
                    <span>View on Calendar</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            <VisualWorkoutBuilder
              dateIso={todayIso}
              defaultSport={athleteProfile?.primarySport === 'Running' ? 'Running' : 'Cycling'}
              athleteProfile={athleteProfile}
              athleteFtp={currentBikeFtp}
              distanceUnit={distanceUnit}
              submitLabel="Add Workout to Calendar"
              onSave={async (payload: VisualWorkoutSavePayload) => {
                if (onCreatePlannedEvent) {
                  await onCreatePlannedEvent(payload);
                  setSingleWorkoutSavedMsg(
                    `Scheduled "${payload.name}" (${Math.round(payload.plannedDurationSecs / 60)}m · ~${payload.plannedLoad} TSS) on ${payload.date}.`
                  );
                }
              }}
              onOpenTracksideStopwatch={onOpenTracksideStopwatch}
            />
          </div>
        ) : (
          /* ======================================================================
             MODE A: 3-STEP GUIDED GOAL TRAINING PLAN
             ====================================================================== */
          <div className="space-y-6">
            {/* Active Block Reminder or Success Confirmation */}
            {populatedSuccessMsg ? (
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{populatedSuccessMsg}</span>
                </span>
                <div className="flex flex-wrap items-center gap-3">
                  {(lastPopulatedBlockId || lastPopulatedTeamBlock) && (onDeletePlanBlock || lastPopulatedTeamBlock) && (
                    <button
                      type="button"
                      data-testid="goals-undo-populated-block"
                      disabled={isRemovingBlock}
                      onClick={() =>
                        void handleUndoPopulatedBlock(
                          lastPopulatedTeamBlock?.blockId || lastPopulatedBlockId || ''
                        )
                      }
                      className="min-h-[44px] sm:min-h-[36px] px-2.5 py-1 rounded-lg border border-rose-500/40 text-rose-700 dark:text-rose-300 font-semibold hover:bg-rose-500/10 cursor-pointer"
                    >
                      {isRemovingBlock
                        ? 'Removing...'
                        : lastPopulatedTeamBlock
                          ? 'Recall Team Block'
                          : 'Undo Block'}
                    </button>
                  )}
                  {(publishAudience !== 'SELF' && onBackToCoachWorkspace) || onSwitchToCalendar ? (
                    <button
                      type="button"
                      onClick={() =>
                        publishAudience !== 'SELF' && onBackToCoachWorkspace
                          ? onBackToCoachWorkspace()
                          : onSwitchToCalendar?.()
                      }
                      className="inline-flex items-center gap-1 font-bold underline hover:opacity-80 cursor-pointer"
                    >
                      <span>
                        {publishAudience !== 'SELF' && onBackToCoachWorkspace
                          ? 'View in Team Plan'
                          : 'View on Calendar'}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
            ) : activeCalendarBlock && onDeletePlanBlock ? (
              <div className="rounded-xl bg-stone-50 dark:bg-ap-carbon border border-stone-200 dark:border-ap-edge px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-slate-700 dark:text-slate-200">
                  Active calendar block: <strong>{activeCalendarBlock.name}</strong> (
                  {activeCalendarBlock.count} workouts scheduled)
                </span>
                <button
                  type="button"
                  data-testid="goals-remove-active-block"
                  disabled={isRemovingBlock}
                  onClick={() => void handleUndoPopulatedBlock(activeCalendarBlock.id)}
                  className="min-h-[44px] sm:min-h-[36px] px-2.5 py-1 rounded-lg border border-rose-500/40 text-rose-700 dark:text-rose-300 font-semibold hover:bg-rose-500/10 cursor-pointer"
                >
                  {isRemovingBlock ? 'Removing...' : 'Remove Active Block'}
                </button>
              </div>
            ) : null}

            {/* STEP 1: CHOOSE DISCIPLINE & GOAL PLAN */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-ap-cobalt dark:bg-ap-volt text-white dark:text-ap-obsidian font-mono text-xs font-extrabold inline-flex items-center justify-center">
                    1
                  </span>
                  <span>Choose Discipline &amp; Goal Plan ({visibleArchetypes.length} Plans)</span>
                </h2>

                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { id: 'ALL', label: 'All Goals' },
                      { id: 'CYCLING', label: 'Cycling' },
                      { id: 'ROAD', label: 'Road Run' },
                      { id: 'TRACK', label: 'Track Oval' },
                      { id: 'SWIM_TRI', label: 'Swim & Tri' },
                    ] as const
                  ).map((cat) => {
                    const active = archetypeCategory === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        data-testid={`goals-cat-${cat.id}`}
                        aria-pressed={active}
                        onClick={() => {
                          setArchetypeCategory(cat.id);
                          const nextList =
                            cat.id === 'ALL'
                              ? ALL_GOAL_ARCHETYPES
                              : ALL_GOAL_ARCHETYPES.filter((a) => a.category === cat.id);
                          if (!nextList.some((a) => a.id === selectedArchetypeId) && nextList[0]) {
                            handleSelectArchetype(nextList[0]);
                          }
                        }}
                        className={`min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                          active
                            ? 'bg-ap-cobalt dark:bg-ap-volt text-white dark:text-ap-obsidian border-ap-cobalt dark:border-ap-volt font-bold'
                            : 'bg-white/80 dark:bg-slate-900/60 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-800 hover:border-ap-cobalt/50'
                        }`}
                      >
                        {cat.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {visibleArchetypes.map((arch) => {
                  const active = arch.id === selectedArchetypeId;
                  return (
                    <button
                      key={arch.id}
                      type="button"
                      onClick={() => handleSelectArchetype(arch)}
                      className={`text-left rounded-xl p-3.5 border transition-all flex flex-col justify-between space-y-2 cursor-pointer ${
                        active
                          ? 'border-ap-cobalt dark:border-ap-volt bg-ap-cobalt/[0.07] dark:bg-ap-volt/[0.08] shadow-xs'
                          : 'border-slate-200 dark:border-slate-800 bg-white/75 dark:bg-slate-900/50 hover:border-ap-cobalt/50'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-2xs font-mono px-1.5 py-0.5 rounded bg-emerald-900/10 dark:bg-ap-volt/15 text-ap-cobalt dark:text-ap-volt font-bold">
                            {arch.badge}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <ArchetypeProgressionSparkline
                              active={active}
                              levels={
                                arch.category === 'TRACK'
                                  ? [45, 58, 72, 82, 92, 48]
                                  : arch.category === 'ROAD'
                                    ? [40, 52, 66, 78, 88, 44]
                                    : [44, 56, 68, 74, 84, 50]
                              }
                            />
                            <span className="text-2xs font-mono text-slate-500">
                              {arch.defaultWeeks}w
                            </span>
                          </div>
                        </div>
                        <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          {arch.title}
                        </div>
                        <p className="text-2xs text-slate-600 dark:text-slate-300 line-clamp-1 leading-snug">
                          {arch.subtitle}
                        </p>
                      </div>
                      <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800/80 flex items-center justify-between text-2xs font-mono">
                        <span className="text-slate-500">Focus:</span>
                        <span className="font-bold text-ap-cobalt dark:text-ap-volt">
                          {arch.targetLabel}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Track Speed-Reserve & 7-Zone Split Calibration Panel (Track Oval archetypes) */}
            {selectedArchetype.trackEventGroup && (
              <TrackSpeedReservePanel
                formId={formId}
                distanceUnit={distanceUnit}
                trackEventGroup={selectedArchetype.trackEventGroup}
                trackStartingPhase={trackStartingPhase}
                setTrackStartingPhase={setTrackStartingPhase}
                trackPhenotypeOverride={trackPhenotypeOverride}
                setTrackPhenotypeOverride={setTrackPhenotypeOverride}
                trackSeedInput={trackSeedInput}
                setTrackSeedInput={setTrackSeedInput}
                trackGoalInput={trackGoalInput}
                setTrackGoalInput={setTrackGoalInput}
                setSelectedPreviewWeekIdx={setSelectedPreviewWeekIdx}
                trackSpeedReserveState={trackSpeedReserveState}
                trackPlanBundle={trackPlanBundle}
              />
            )}

            {/* STEP 2: FIT YOUR WEEKLY SCHEDULE & START DATE */}
            <div className="space-y-3 rounded-xl bg-stone-50/90 dark:bg-slate-900/60 p-4 border border-slate-200/80 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-ap-cobalt dark:bg-ap-volt text-white dark:text-ap-obsidian font-mono text-xs font-extrabold inline-flex items-center justify-center">
                    2
                  </span>
                  <span>Fit Your Weekly Schedule &amp; Start Date</span>
                </h2>
                <span className="text-2xs font-mono text-slate-600 dark:text-slate-300">
                  Block starts Mon {resolvedStartMondayIso}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                {/* Start Anchor */}
                <div>
                  <div className="block text-2xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Start Date Anchor
                  </div>
                  <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg liquid-capsule-track font-medium">
                    {(
                      [
                        { id: 'NEXT_MONDAY', label: 'Next Mon' },
                        { id: 'THIS_WEEK', label: 'This Wk' },
                        { id: 'RACE_DATE', label: 'Race Date' },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        aria-pressed={startAnchorMode === m.id}
                        onClick={() => {
                          setStartAnchorMode(m.id);
                          setSelectedPreviewWeekIdx(0);
                        }}
                        className={`min-h-[44px] sm:min-h-[36px] py-1 rounded-md text-2xs transition-all cursor-pointer ${
                          startAnchorMode === m.id
                            ? 'liquid-capsule-active text-ap-cobalt dark:text-ap-volt font-bold'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  {startAnchorMode === 'RACE_DATE' && (
                    <input
                      type="date"
                      aria-label="Target race date for plan anchor"
                      min={todayIso}
                      value={targetRaceDateIso}
                      onChange={(e) => setTargetRaceDateIso(e.target.value)}
                      className="mt-1.5 w-full min-h-[44px] sm:min-h-[36px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2.5 font-mono text-xs text-slate-900 dark:text-white"
                    />
                  )}
                </div>

                {/* Block Horizon */}
                <div>
                  <div className="block text-2xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Block Length
                  </div>
                  <div className="grid grid-cols-4 gap-1 p-0.5 rounded-lg liquid-capsule-track font-mono">
                    {([4, 8, 12, 16] as const).map((wks) => (
                      <button
                        key={wks}
                        type="button"
                        aria-pressed={blockWeeks === wks}
                        onClick={() => {
                          setBlockWeeks(wks);
                          setSelectedPreviewWeekIdx(0);
                          setSessionOverrides({});
                        }}
                        className={`min-h-[44px] sm:min-h-[36px] py-1 rounded-md text-2xs transition-all cursor-pointer ${
                          blockWeeks === wks
                            ? 'liquid-capsule-active text-ap-cobalt dark:text-ap-volt font-bold'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {wks}w
                      </button>
                    ))}
                  </div>
                </div>

                {/* Primary Long Session Day + Environment */}
                <div>
                  <div className="block text-2xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Long Day &amp; Modality
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <select
                      aria-label="Primary long session day"
                      value={longDayPreference}
                      onChange={(e) => {
                        const val = e.target.value as 'Saturday' | 'Sunday';
                        setLongDayPreference(val);
                        const dayOff = val === 'Saturday' ? 5 : 6;
                        if (!selectedWeekdays.includes(dayOff)) {
                          toggleWeekdayPill(dayOff);
                        }
                      }}
                      className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2 text-xs text-slate-900 dark:text-white"
                    >
                      <option value="Sunday">Long: Sunday</option>
                      <option value="Saturday">Long: Saturday</option>
                    </select>
                    <select
                      aria-label="Plan modality preference"
                      value={blockEnvPref}
                      onChange={(e) =>
                        setBlockEnvPref(e.target.value as 'FLEXIBLE' | 'OUTDOOR' | 'INDOOR')
                      }
                      className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2 text-xs text-slate-900 dark:text-white"
                    >
                      <option value="FLEXIBLE">Hybrid</option>
                      <option value="OUTDOOR">Outdoor</option>
                      <option value="INDOOR">Indoor / Virtual</option>
                    </select>
                  </div>
                </div>

                {/* CTL Volume Tier */}
                <div>
                  <div className="block text-2xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Weekly Volume Tier
                  </div>
                  <select
                    aria-label="Weekly volume tier"
                    value={volumeTier}
                    onChange={(e) => setVolumeTier(e.target.value as PlanVolumeTier)}
                    className="w-full min-h-[44px] sm:min-h-[36px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2.5 text-xs text-slate-900 dark:text-white"
                  >
                    <option value="AUTO">Auto (From Fitness CTL {Math.round(currentCtl)})</option>
                    <option value="STARTER">Starter (~3–5 hrs/wk)</option>
                    <option value="INTERMEDIATE">Intermediate (~6–9 hrs/wk)</option>
                    <option value="COMPETITIVE">Competitive (~9–13 hrs/wk)</option>
                  </select>
                </div>
              </div>

              {/* Interactive Weekday Selector */}
              <div className="pt-1 flex flex-wrap items-center justify-between gap-2">
                <span className="text-2xs font-semibold text-slate-600 dark:text-slate-300">
                  Training Days ({selectedWeekdays.length}/wk — min 3):
                </span>
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Selected training weekdays">
                  {WEEKDAY_CHIPS.map((day) => {
                    const active = selectedWeekdays.includes(day.offset);
                    return (
                      <button
                        key={day.offset}
                        type="button"
                        data-testid={`plan-weekday-${day.offset}`}
                        aria-pressed={active}
                        onClick={() => toggleWeekdayPill(day.offset)}
                        className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-lg text-xs font-mono font-semibold border transition-colors cursor-pointer ${
                          active
                            ? 'bg-ap-cobalt dark:bg-ap-volt text-white dark:text-ap-obsidian border-ap-cobalt dark:border-ap-volt'
                            : 'bg-white dark:bg-ap-turf text-slate-600 dark:text-slate-300 border-stone-300 dark:border-ap-edge-dark'
                        }`}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* STEP 3: PREVIEW WORKOUT SKYLINES, CUSTOMIZE & SCHEDULE */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-ap-cobalt dark:bg-ap-volt text-white dark:text-ap-obsidian font-mono text-xs font-extrabold inline-flex items-center justify-center">
                    3
                  </span>
                  <span>Preview Structure, Customize &amp; Populate Calendar</span>
                </h2>

                <button
                  type="button"
                  data-testid="goals-publish-plan-btn"
                  disabled={isPopulatingCalendar}
                  onClick={() => void handlePopulatePlanToCalendar()}
                  className="min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl ap-btn-primary disabled:opacity-50 text-xs font-bold shadow-xs cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    {isPopulatingCalendar
                      ? 'Publishing...'
                      : (() => {
                          const preview = selectSessionsForPublishCadence(
                            generatedPlanWeeks,
                            publishCadence,
                            selectedPreviewWeekIdx,
                            {
                              blockId: 'preview',
                              baseTitle: selectedArchetype.title,
                              audience: publishAudience,
                            }
                          );
                          return publishAudience === 'SELF' && publishCadence === 'FULL_BLOCK'
                            ? `Populate ${blockWeeks}-Week Block to Calendar`
                            : `Publish ${preview.sessions.length} Sessions (${preview.cohort.cohortLabel})`;
                        })()}
                  </span>
                </button>
              </div>

              {/* COACH-02: Rolling 1-2W vs Full Block Cadence & Team / Event-Group Targeting */}
              <div
                data-testid="plan-builder-publish-bar"
                className="rounded-xl ap-card-inset p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-2xs font-mono font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    Publish Window:
                  </span>
                  <div
                    role="group"
                    aria-label="Publish cadence window"
                    className="inline-flex items-center gap-1 p-0.5 rounded-lg liquid-capsule-track"
                  >
                    {(
                      [
                        { id: 'ROLLING_1W', label: 'Rolling 1W' },
                        { id: 'ROLLING_2W', label: 'Rolling 2W' },
                        { id: 'FULL_BLOCK', label: 'Full Block' },
                      ] as const
                    ).map((opt) => {
                      const active = publishCadence === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          data-testid={`plan-publish-cadence-${opt.id}`}
                          aria-pressed={active}
                          onClick={() => setPublishCadence(opt.id)}
                          className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                            active
                              ? 'ap-nav-volt-active'
                              : 'text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {publishCadence !== 'FULL_BLOCK' && (
                    <span className="text-2xs font-mono text-slate-600 dark:text-slate-300">
                      {publishCadence === 'ROLLING_1W'
                        ? `Week ${activePreviewWeek.weekNum} of ${generatedPlanWeeks.length}`
                        : `Weeks ${activePreviewWeek.weekNum}–${Math.min(generatedPlanWeeks.length, activePreviewWeek.weekNum + 1)} of ${generatedPlanWeeks.length}`}
                    </span>
                  )}
                  <PublishWindowTimelineBracket
                    totalWeeks={generatedPlanWeeks.length}
                    cadence={publishCadence}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label
                    htmlFor={`${formId}-publish-audience`}
                    className="text-2xs font-mono font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300"
                  >
                    Target Cohort:
                  </label>
                  <select
                    id={`${formId}-publish-audience`}
                    data-testid="plan-publish-audience"
                    value={publishAudience}
                    onChange={(e) => setPublishAudience(e.target.value as PlanPublishAudience)}
                    className="min-h-[44px] sm:min-h-[36px] rounded-xl border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-3 text-xs font-semibold text-slate-900 dark:text-white"
                  >
                    <option value="SELF">My Personal Calendar</option>
                    <option value="TEAM_ALL">
                      {activeTeam
                        ? `Entire Team (${activeTeam.brand.shortName})`
                        : 'Entire Team Squad'}
                    </option>
                    <option value="EVENT_DISTANCE">Distance / XC Cohort (3K–10K)</option>
                    <option value="EVENT_MID_DISTANCE">Mid-Distance (800m / Mile)</option>
                    <option value="EVENT_SPRINTS">Sprints Cohort (100m–400m)</option>
                    <option value="EVENT_HURDLES">Hurdles Cohort (100H–400H)</option>
                    <option value="EVENT_JUMPS">Jumps Cohort (LJ / TJ / HJ)</option>
                    <option value="EVENT_POLE_VAULT">Pole Vault Cohort</option>
                    <option value="EVENT_THROWS">Throws Cohort (SP / Discus / Jav)</option>
                    <option value="EVENT_MULTI">Multi-Events (Pent / Hept / Dec)</option>
                  </select>
                  {publishAudience !== 'SELF' && connectedRoster.length > 0 && (
                    <span className="text-2xs font-mono text-slate-600 dark:text-slate-400">
                      Roster ready ({connectedRoster.length})
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
                {/* Left 6 Cols: Mesocycle Progression Strip */}
                <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                        {blockWeeks}-Week Load Arc (Click Week to Inspect)
                      </div>
                      <div className="text-2xs text-slate-500">
                        Deload every 4th week (-30%) + crisp race-week taper (-50% TSS)
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-2xs font-mono">
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-xs bg-[#0D9488] dark:bg-[#2DD4BF]" /> Build
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500" /> Deload
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-xs bg-ap-cobalt dark:bg-ap-volt" /> Taper
                      </span>
                    </div>
                  </div>

                  <div
                    data-testid="plan-builder-load-arc"
                    className="flex items-end gap-1.5 overflow-x-auto pb-2 pt-3 px-1"
                  >
                    {generatedPlanWeeks.map((wk, idx) => {
                      const maxTss = Math.max(...generatedPlanWeeks.map((w) => w.targetTss), 300);
                      const hPct = Math.max(20, Math.round((wk.targetTss / maxTss) * 100));
                      const isSelected = idx === selectedPreviewWeekIdx;
                      const barColor = wk.isTaper
                        ? 'bg-ap-cobalt dark:bg-ap-volt'
                        : wk.isDeload
                          ? 'bg-emerald-500'
                          : 'bg-[#0D9488] dark:bg-[#2DD4BF]';

                      return (
                        <button
                          key={wk.weekNum}
                          type="button"
                          onClick={() => setSelectedPreviewWeekIdx(idx)}
                          className={`group flex-1 min-w-[44px] shrink-0 flex flex-col items-center justify-end rounded-lg p-1 transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-[#0D9488]/15 dark:bg-[#2DD4BF]/15 ring-1 ring-[#0D9488] dark:ring-[#2DD4BF]'
                              : 'hover:bg-slate-100 dark:hover:bg-slate-800/60'
                          }`}
                          title={`Week ${wk.weekNum} (${wk.phase}): ~${wk.targetTss} TSS · ${wk.targetHours}h`}
                        >
                          <span className="text-2xs font-mono font-bold text-slate-600 dark:text-slate-300 mb-1">
                            {wk.targetTss}
                          </span>
                          <div className="w-full h-24 flex items-end justify-center">
                            <div
                              style={{ height: `${hPct}%` }}
                              className={`w-full rounded-t-sm transition-all ${barColor}`}
                            />
                          </div>
                          <span
                            className={`text-2xs font-mono mt-1 ${
                              isSelected
                                ? 'font-bold text-ap-cobalt dark:text-ap-volt'
                                : 'text-slate-500'
                            }`}
                          >
                            W{wk.weekNum}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-2xs font-mono text-slate-500">
                    <span>
                      Week {activePreviewWeek.weekNum}:{' '}
                      <strong className="text-slate-900 dark:text-slate-100">
                        {activePreviewWeek.phase}
                      </strong>
                    </span>
                    <span>
                      Volume:{' '}
                      <strong className="text-ap-cobalt dark:text-ap-volt">
                        {activePreviewWeek.targetHours} hrs · ~{activePreviewWeek.targetTss} TSS
                      </strong>
                    </span>
                  </div>
                </div>

                {/* Right 6 Cols: Per-Session True Skylines + Edit + Exports */}
                <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2.5 bg-slate-50/50 dark:bg-slate-900/40">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      Week {activePreviewWeek.weekNum} Sessions ({activePreviewWeek.sessions.length})
                    </div>
                    <span className="text-2xs font-mono font-bold px-2 py-0.5 rounded ap-status-info">
                      {activePreviewWeek.phase}
                    </span>
                  </div>

                  <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                    {activePreviewWeek.sessions.map((sess, sIdx) => {
                      const sessionKey = `${activePreviewWeek.weekNum}-${sIdx}`;
                      const stepSkyline = parseWorkoutSteps(sess.workoutSyntax, safeThresholdPace);
                      const resolvedFirstLine = sess.workoutSyntax
                        .split('\n')
                        .map((l) =>
                          formatHumanReadableStepLine(
                            l,
                            sess.sportCategory,
                            safeThresholdPace,
                            distanceUnit,
                            currentBikeFtp
                          )
                        )
                        .filter((l) => l && !/^Main Set/i.test(l))
                        .slice(0, 2)
                        .join(' · ');
                      const trackSpec =
                        sess.sportCategory === 'Running'
                          ? sess.trackSpec ||
                            inferTrackWorkoutSpecFromPlannedEvent({
                              name: sess.name,
                              workoutSyntax: sess.workoutSyntax,
                            })
                          : null;

                      return (
                        <div
                          key={`${sess.date}-${sIdx}`}
                          className="rounded-lg bg-white dark:bg-ap-turf border border-slate-200/80 dark:border-slate-800 overflow-hidden"
                        >
                          <div className="p-2.5 space-y-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-2xs font-mono text-slate-500">
                                  {sess.date} · {sess.sportCategory} · {sess.environmentPreference}
                                </div>
                                <div className="font-bold text-slate-900 dark:text-slate-100 truncate">
                                  {sess.name}
                                </div>
                              </div>
                              <div className="text-right font-mono shrink-0">
                                <div className="font-bold text-ap-cobalt dark:text-ap-volt">
                                  {Math.round(sess.plannedDurationSecs / 60)}m
                                </div>
                                <div className="text-2xs text-slate-500">~{sess.plannedLoad} TSS</div>
                              </div>
                            </div>

                            {/* True Per-Session Effort Skyline */}
                            {stepSkyline.length > 0 && (
                              <div
                                data-testid={`goals-session-skyline-${sIdx}`}
                                className="h-7 w-full flex items-end gap-[2px] px-1 pt-1 rounded bg-stone-50 dark:bg-ap-carbon"
                              >
                                {stepSkyline.map((st, idx) => (
                                  <div
                                    key={idx}
                                    style={{
                                      flex: Math.max(0.25, st.durationMins),
                                      height: `${computeAmplitudeHeightPct(st.intensityPct, 45)}%`,
                                      backgroundColor: st.zoneColor,
                                    }}
                                    className="rounded-t-[2px]"
                                    title={`${st.label} (${st.durationMins}m @ ${st.intensityPct}%)`}
                                  />
                                ))}
                              </div>
                            )}

                            {resolvedFirstLine && (
                              <div className="text-2xs font-mono text-slate-600 dark:text-slate-300 truncate">
                                {resolvedFirstLine}
                              </div>
                            )}

                            <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-200/70 dark:border-slate-800/70">
                              {trackSpec && (
                                <button
                                  type="button"
                                  data-testid="goals-launch-stopwatch"
                                  onClick={() => {
                                    stageWorkoutInTracksideStopwatch({
                                      title: sess.name,
                                      spec: trackSpec,
                                    });
                                    onOpenTracksideStopwatch?.();
                                  }}
                                  className="min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-ap-cobalt hover:bg-ap-clay-dark dark:bg-ap-volt dark:hover:bg-[#C8EF1E] text-white dark:text-ap-obsidian text-2xs font-mono font-bold cursor-pointer"
                                >
                                  <Timer className="w-3.5 h-3.5" weight="bold" />
                                  <span>Time on Track</span>
                                </button>
                              )}

                              {sess.workoutSyntax && (
                                <button
                                  type="button"
                                  data-testid="goals-export-fit"
                                  onClick={() =>
                                    exportWorkoutAsFit({
                                      name: sess.name,
                                      sport: sess.sportCategory,
                                      workoutSyntax: sess.workoutSyntax,
                                      ftpWatts: currentBikeFtp || 280,
                                      lthrBpm: athleteProfile?.lthr || 170,
                                      thresholdPaceSecsPerKm: safeThresholdPace,
                                      dateIso: sess.date,
                                    })
                                  }
                                  className="min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-carbon text-slate-700 dark:text-slate-200 text-2xs font-mono font-semibold hover:border-ap-cobalt cursor-pointer"
                                >
                                  <Download className="w-3.5 h-3.5" weight="bold" />
                                  <span>.FIT</span>
                                </button>
                              )}

                              {sess.workoutSyntax && sess.sportCategory === 'Cycling' && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      exportWorkoutAsZwo({
                                        name: sess.name,
                                        sport: 'Cycling',
                                        workoutSyntax: sess.workoutSyntax,
                                        description: sess.description,
                                        ftpWatts: currentBikeFtp,
                                        dateIso: sess.date,
                                      })
                                    }
                                    className="min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-carbon text-slate-700 dark:text-slate-200 text-2xs font-mono font-semibold hover:border-ap-cobalt cursor-pointer"
                                  >
                                    <span>.ZWO</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      exportWorkoutAsErg({
                                        name: sess.name,
                                        sport: 'Cycling',
                                        workoutSyntax: sess.workoutSyntax,
                                        ftpWatts: currentBikeFtp,
                                        dateIso: sess.date,
                                      })
                                    }
                                    className="min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-carbon text-slate-700 dark:text-slate-200 text-2xs font-mono font-semibold hover:border-ap-cobalt cursor-pointer"
                                  >
                                    <span>.ERG</span>
                                  </button>
                                </>
                              )}

                              <button
                                type="button"
                                data-testid="goals-edit-preview-session"
                                onClick={() =>
                                  setEditingPreviewTarget({ key: sessionKey, session: sess })
                                }
                                className="min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-carbon text-slate-700 dark:text-slate-200 text-2xs font-mono font-semibold hover:border-ap-cobalt cursor-pointer ml-auto"
                              >
                                <Sliders className="w-3 h-3" />
                                <span>Edit</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ==========================================================================
          TARGET RACES & PERFORMANCE MILESTONES
         ========================================================================== */}
      <section className="rounded-2xl liquid-glass p-5 space-y-5">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <Award className="w-4 h-4 ap-text-brand" />
          <span>Target Races &amp; Performance Milestones</span>
        </h2>

        {targetGoals.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {targetGoals.map((goal) => {
              const safeTargetDate = goal.targetDate || todayIso;
              const [cy, cm, cd] = todayIso.split('-').map(Number);
              const todayNoonMs = new Date(cy || 2026, (cm || 1) - 1, cd || 1, 12, 0, 0).getTime();
              const [ty, tm, td] = safeTargetDate.split('-').map(Number);
              const parsedTargetNoon = new Date(
                ty || cy || 2026,
                (tm || 1) - 1,
                td || 1,
                12,
                0,
                0
              ).getTime();
              const rawDayDiff = Number.isFinite(parsedTargetNoon)
                ? Math.round((parsedTargetNoon - todayNoonMs) / 86_400_000)
                : 1;
              const isPastGoal = rawDayDiff < 0;
              const daysRemaining = Math.max(0, rawDayDiff);
              const weeksRemaining = Math.max(1, Math.max(1, daysRemaining) / 7);
              const ctlGap = goal.targetCtl ? Math.max(0, goal.targetCtl - currentCtl) : 0;
              const reqWeeklyRamp = (ctlGap / weeksRemaining).toFixed(1);
              const safeTitle = goal.title || 'Performance Target';
              const safeCurrentValue = Number.isFinite(Number(goal.currentValue))
                ? Number(goal.currentValue)
                : 0;
              const safeTargetValue = Number.isFinite(Number(goal.targetValue))
                ? Number(goal.targetValue)
                : 0;

              const phase = isPastGoal
                ? 'Completed'
                : daysRemaining === 0
                  ? 'Race Day'
                  : daysRemaining <= 14
                    ? 'Taper & Peak'
                    : daysRemaining <= 45
                      ? 'Specific Build'
                      : 'Aerobic Base';

              return (
                <div
                  key={goal.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                        {goal.priority || 'A-Race'} · {goal.sportCategory || 'Running'} · {safeTargetDate} (
                        {isPastGoal
                          ? 'Completed'
                          : daysRemaining === 0
                            ? 'Today · Race Day'
                            : `${daysRemaining}d out · ${phase}`}
                        )
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                        {safeTitle}
                      </h3>
                    </div>
                    {pendingDeleteGoalId === goal.id ? (
                      <div className="inline-flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            onDeleteTargetGoal(goal.id);
                            setPendingDeleteGoalId(null);
                          }}
                          className="min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-2xs font-bold"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDeleteGoalId(null)}
                          className="min-h-[44px] sm:min-h-[32px] px-2 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-2xs font-semibold"
                        >
                          Keep
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPendingDeleteGoalId(goal.id)}
                        className="min-h-[44px] min-w-[44px] sm:min-h-[34px] sm:min-w-[34px] flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-400 hover:text-red-500"
                        aria-label={`Remove ${safeTitle}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-300">{goal.notes}</p>

                  <div className="flex items-center justify-between text-xs font-mono tabular-nums pt-2 border-t border-slate-200 dark:border-slate-800">
                    <span>
                      Current:{' '}
                      <strong>
                        {formatGoalMetricValue(
                          safeCurrentValue,
                          goal.unit || 's/km',
                          distanceUnit,
                          safeTitle
                        )}
                      </strong>{' '}
                      → Target:{' '}
                      <strong className="text-emerald-600 dark:text-emerald-400">
                        {formatGoalMetricValue(
                          safeTargetValue,
                          goal.unit || 's/km',
                          distanceUnit,
                          safeTitle
                        )}
                      </strong>
                    </span>
                    {goal.targetCtl && (
                      <span className="ap-text-brand font-semibold">
                        Req Ramp: +{reqWeeklyRamp} CTL/wk
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-800 p-4 text-xs text-slate-500 dark:text-slate-400 text-center">
            No custom target races or performance milestones added yet.
          </div>
        )}

        <form
          onSubmit={handleAddGoalSubmit}
          className="rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-4 space-y-3"
        >
          <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
            Add Target Race or Performance Goal
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-4">
              <label htmlFor={`${formId}-goal-name`} className="block text-xs text-slate-500 mb-1">
                Event / Goal Name
              </label>
              <input
                id={`${formId}-goal-name`}
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Sub-20:00 5K or 350W FTP"
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={`${formId}-goal-sport`} className="block text-xs text-slate-500 mb-1">
                Sport
              </label>
              <select
                id={`${formId}-goal-sport`}
                value={newSport}
                onChange={(e) => {
                  const sp = e.target.value as SportCategory;
                  setNewSport(sp);
                  if (sp === 'Running') {
                    setNewUnit('s/km');
                    setNewTargetVal(
                      formatPaceClockInput(Math.round(safeThresholdPace * 0.96), distanceUnit)
                    );
                  } else if (sp === 'Cycling') {
                    setNewUnit('W');
                    setNewTargetVal(String(Math.round(currentBikeFtp * 1.08)));
                  } else if (sp === 'Swimming') {
                    setNewUnit('s/100m');
                    setNewTargetVal(
                      formatSwimClockInput(Math.max(65, Math.round(safeSwimCss * 0.96)), distanceUnit)
                    );
                  } else {
                    setNewUnit('CTL');
                    setNewTargetVal(String(Math.max(55, Math.round(currentCtl + 12))));
                  }
                }}
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              >
                <option value="Running">Running</option>
                <option value="Cycling">Cycling</option>
                <option value="Multisport">Multisport</option>
                <option value="Swimming">Swimming</option>
                <option value="Strength">Strength</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor={`${formId}-goal-priority`}
                className="block text-xs text-slate-500 mb-1"
              >
                Priority
              </label>
              <select
                id={`${formId}-goal-priority`}
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value as 'A-Race' | 'B-Race' | 'Milestone')}
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              >
                <option value="A-Race">A-Race</option>
                <option value="B-Race">B-Race</option>
                <option value="Milestone">Milestone</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={`${formId}-goal-date`} className="block text-xs text-slate-500 mb-1">
                Target Date
              </label>
              <input
                id={`${formId}-goal-date`}
                type="date"
                min={todayIso}
                value={newTargetDate}
                onChange={(e) => setNewTargetDate(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={`${formId}-goal-val`} className="block text-xs text-slate-500 mb-1">
                Target Value &amp; Unit
              </label>
              <div className="flex gap-1">
                {newUnit === 's/km' || newUnit === 's/100m' ? (
                  <input
                    id={`${formId}-goal-val`}
                    data-testid="goal-pace-clock-input"
                    type="text"
                    inputMode="numeric"
                    value={newTargetVal}
                    onChange={(e) => setNewTargetVal(e.target.value)}
                    placeholder={
                      newUnit === 's/100m'
                        ? distanceUnit === 'mi'
                          ? '1:40'
                          : '1:50'
                        : distanceUnit === 'mi'
                          ? '7:30'
                          : '4:35'
                    }
                    className="w-20 min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                ) : (
                  <input
                    id={`${formId}-goal-val`}
                    type="number"
                    value={newTargetVal}
                    onChange={(e) => setNewTargetVal(e.target.value)}
                    className="w-20 min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                )}
                <select
                  value={newUnit}
                  aria-label="Goal target unit"
                  onChange={(e) => {
                    const nextUnit = e.target.value;
                    setNewUnit(nextUnit);
                    if (nextUnit === 's/km') {
                      setNewTargetVal(
                        formatPaceClockInput(Math.round(safeThresholdPace * 0.96), distanceUnit)
                      );
                    } else if (nextUnit === 's/100m') {
                      setNewTargetVal(
                        formatSwimClockInput(
                          Math.max(65, Math.round(safeSwimCss * 0.96)),
                          distanceUnit
                        )
                      );
                    } else if (nextUnit === 'W') {
                      setNewTargetVal(String(Math.round(currentBikeFtp * 1.08)));
                    } else if (nextUnit === 'CTL') {
                      setNewTargetVal(String(Math.max(55, Math.round(currentCtl + 12))));
                    }
                  }}
                  className="flex-1 min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-1.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                >
                  <option value="s/km">Pace (/{distanceUnit})</option>
                  <option value="s/100m">Swim CSS (/{distanceUnit === 'mi' ? '100yd' : '100m'})</option>
                  <option value="W">Watts</option>
                  <option value="CTL">CTL</option>
                  {!athleteProfile?.safeSportHideWeight && <option value="W/kg">W/kg</option>}
                  <option value="min">min</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <input
              type="text"
              value={newNotes}
              aria-label="Optional goal notes"
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="Optional notes (e.g. target pacing strategy, nutrition, climb VAM)..."
              className="flex-1 min-w-[220px] min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              className="min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1.5 rounded-lg ap-btn-primary px-4 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Goal</span>
            </button>
          </div>
        </form>
      </section>

      {/* ==========================================================================
          SHOE & TRACK SPIKE CLOSET
         ========================================================================== */}
      <ShoeSpikeClosetSection
        gearItems={gearItems}
        activities={activities}
        distanceUnit={distanceUnit}
        onSaveGearItems={onSaveGearItems || (() => {})}
      />

      {/* ==========================================================================
          UNIT-AWARE RACE PHYSICS & FUELING SIMULATOR
         ========================================================================== */}
      <section className="rounded-2xl liquid-glass p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Race Physics &amp; Fueling Simulator
              </h2>
              <span className="ap-status-info px-2.5 py-0.5 rounded-full text-2xs font-mono font-semibold">
                {isImperial ? 'mi / ft / °F' : 'km / m / °C'}
              </span>
              <ChartInfoTooltip
                title="Race Physics & Fueling Simulator"
                subtitle="Grade, Thermal & Altitude Split Derating"
                whatItMeasures="Derates target splits for elevation grade, heat index, altitude hypoxia, and late-race durability while sizing carbs (g/hr), sodium, and fluids."
                benchmarks="60–110 g/hr carbs (1:0.8 glucose:fructose) · 600–1,000 mg/hr Na+."
                coachingAction="Cap early hills inside Target Cap to protect negative-split finish reserves."
              />
            </div>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl liquid-capsule-track">
            {(['Running', 'Cycling'] as const).map((sp) => (
              <button
                key={sp}
                type="button"
                onClick={() => {
                  setSimSport(sp);
                  if (sp === 'Cycling' && simDistKm < 30) {
                    setSimDistKm(112);
                    setSimElevM(1450);
                  } else if (sp === 'Running' && simDistKm > 45) {
                    setSimDistKm(21.1);
                    setSimElevM(185);
                  }
                }}
                className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  simSport === sp
                    ? 'liquid-capsule-active text-slate-900 dark:text-white'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {sp === 'Running' ? 'Road / Trail Run' : 'Road / Gravel / TT Bike'}
              </button>
            ))}
          </div>
        </div>

        <RacePhysicsSimulatorBody
          formId={formId}
          distanceUnit={distanceUnit}
          athleteProfile={athleteProfile}
          simRaceName={simRaceName}
          setSimRaceName={setSimRaceName}
          setSimDistKm={setSimDistKm}
          setSimElevM={setSimElevM}
          setSimTempC={setSimTempC}
          setSimAltM={setSimAltM}
          isImperial={isImperial}
          simDistDisplay={simDistDisplay}
          simElevDisplay={simElevDisplay}
          simTempDisplay={simTempDisplay}
          simAltDisplay={simAltDisplay}
          raceSimulationReport={raceSimulationReport}
        />
      </section>

      {/* Modal: Customize Previewed Session via VisualWorkoutBuilder */}
      {editingPreviewTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => setEditingPreviewTarget(null)}
        >
          <div
            ref={previewEditDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="goals-edit-session-title"
            tabIndex={-1}
            className="w-full max-w-2xl rounded-2xl liquid-glass p-5 sm:p-6 space-y-4 shadow-2xl focus:outline-none my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="goals-edit-session-title"
                  className="text-lg font-bold text-slate-900 dark:text-slate-100"
                >
                  Customize Plan Session · {editingPreviewTarget.session.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setEditingPreviewTarget(null)}
                aria-label="Close session editor"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <VisualWorkoutBuilder
              dateIso={editingPreviewTarget.session.date}
              defaultSport={editingPreviewTarget.session.sportCategory}
              athleteProfile={athleteProfile}
              athleteFtp={currentBikeFtp}
              distanceUnit={distanceUnit}
              initialEvent={{
                id: editingPreviewTarget.key,
                date: editingPreviewTarget.session.date,
                name: editingPreviewTarget.session.name,
                sportCategory: editingPreviewTarget.session.sportCategory,
                environmentPreference: editingPreviewTarget.session.environmentPreference,
                description: editingPreviewTarget.session.description,
                plannedLoad: editingPreviewTarget.session.plannedLoad,
                plannedDurationSecs: editingPreviewTarget.session.plannedDurationSecs,
                targetZoneSummary: 'Plan Preview Session',
                workoutSyntax: editingPreviewTarget.session.workoutSyntax,
                trackSpec: editingPreviewTarget.session.trackSpec,
              }}
              submitLabel="Apply to Plan Preview"
              onSave={(payload: VisualWorkoutSavePayload) => {
                setSessionOverrides((prev) => ({
                  ...prev,
                  [editingPreviewTarget.key]: {
                    date: payload.date,
                    name: payload.name,
                    sportCategory: payload.sportCategory,
                    environmentPreference: payload.environmentPreference,
                    plannedDurationSecs: payload.plannedDurationSecs,
                    plannedLoad: payload.plannedLoad,
                    workoutSyntax: payload.workoutSyntax,
                    description: payload.description,
                    trackSpec: payload.trackSpec,
                    replaceExistingDate: true,
                  },
                }));
                setEditingPreviewTarget(null);
              }}
              onCancel={() => setEditingPreviewTarget(null)}
              onOpenTracksideStopwatch={onOpenTracksideStopwatch}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export const GoalsView = React.memo(GoalsViewInner);
