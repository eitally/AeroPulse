import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalDialog } from '../hooks/useModalDialog';
import {
  Activity,
  ArrowsLeftRight,
  Bike,
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Download,
  Dumbbell,
  FileText,
  Flame,
  Footprints,
  Heart,
  MapPin,
  Moon,
  Plus,
  ShareNetwork,
  Sliders,
  Sparkles,
  Timer,
  Trash2,
  Trophy,
  Waves,
  X,
} from "./icons/PhosphorIcons";
import {
  AthleteProfile,
  DistanceUnit,
  EnvironmentFilter,
  PlannedWorkoutEvent,
  PracticeVenueCategory,
  SportCategory,
  TargetGoal,
  TrackWorkoutSpec,
  UnifiedActivity,
  UnifiedWellnessDay,
  WorkoutSessionSlot,
} from '../types';
import { formatDistance, formatPace } from '../utils/formatters';
import { getLocalDateIso } from '../physiology/stravaLoadCalibration';
import {
  formatSessionLogisticsLine,
  sortPlannedEventsChronologically,
} from '../utils/workoutScheduleUtils';
import { ChartInfoTooltip } from './ChartInfoTooltip';
import {
  exportWorkoutAsErg,
  exportWorkoutAsFit,
  exportWorkoutAsZwo,
} from '../utils/workoutExportActions';
import { CalendarWatchPushItems } from './calendar/CalendarWatchPushItems';
import { openShareWorkoutRoute } from '../utils/shareWorkoutEngine';
import { VisualWorkoutBuilder } from './VisualWorkoutBuilder';
import {
  inferTrackWorkoutSpecFromPlannedEvent,
  stageWorkoutInTracksideStopwatch,
} from '../hooks/useTracksideStopwatch';
import { INTERVALS_EFFORT_ZONES } from '../utils/workoutParser';
import {
  WEEKDAYS,
  SHORT_WEEKDAYS,
  MONTH_NAMES,
  buildDayPlannedEffortStripe,
  getIsoWeekNumber,
  formatIntervalsDayHeader,
  formatCompactDuration,
  formatSleepHm,
  formatPaceWithUnit,
  buildActivityEffortPresentation,
  getSportHeaderColor,
  type DayPlannedEffortStripe,
  type EffortSlice,
  type ActivityEffortPresentation,
  type HoveredPrescriptionTooltipData,
} from './calendar/calendarEffortUtils';
import { CalendarMobileAgenda } from './calendar/CalendarMobileAgenda';
import { CalendarPlannedTooltip } from './calendar/CalendarPlannedTooltip';
import { CalendarCopyWeekPopover } from './calendar/CalendarCopyWeekPopover';
import {
  buildCopiedWeekBatchItems,
  buildReschedulePlannedEventPatch,
  getCalendarDragPayload,
  setCalendarDragPayload,
} from './calendar/calendarDragAndWeekCopyUtils';
import type { PlannedEventBatchItem } from './GoalsView';

export { INTERVALS_EFFORT_ZONES };
export type { DayPlannedEffortStripe, EffortSlice, ActivityEffortPresentation };

interface CalendarViewProps {
  activities: UnifiedActivity[];
  wellnessDays: UnifiedWellnessDay[];
  plannedEvents: PlannedWorkoutEvent[];
  targetGoals?: TargetGoal[];
  envFilter: EnvironmentFilter;
  selectedSport: SportCategory | 'ALL';
  onSelectSport?: (sport: SportCategory | 'ALL') => void;
  distanceUnit: DistanceUnit;
  athleteFtp: number;
  athleteProfile?: AthleteProfile;
  onSelectActivity: (activity: UnifiedActivity) => void;
  onCreatePlannedEvent: (event: {
    date: string;
    name: string;
    sportCategory: SportCategory;
    environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
    plannedDurationSecs: number;
    plannedLoad: number;
    workoutSyntax: string;
    description: string;
    scheduledTime?: string;
    sessionSlot?: WorkoutSessionSlot;
    locationName?: string;
    locationCategory?: PracticeVenueCategory;
    meetingNotes?: string;
    trackSpec?: TrackWorkoutSpec;
    replaceExistingDate?: boolean;
  }) => Promise<void>;
  onUpdatePlannedEvent?: (
    id: string,
    patch: {
      date: string;
      name: string;
      sportCategory: SportCategory;
      environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
      plannedDurationSecs: number;
      plannedLoad: number;
      workoutSyntax: string;
      description: string;
      scheduledTime?: string;
      sessionSlot?: WorkoutSessionSlot;
      locationName?: string;
      locationCategory?: PracticeVenueCategory;
      meetingNotes?: string;
      trackSpec?: TrackWorkoutSpec;
    }
  ) => Promise<void>;
  onDeletePlannedEvent: (id: string) => Promise<void>;
  onDeletePlanBlock?: (planBlockId: string) => Promise<void>;
  onBatchCreatePlannedEvents?: (
    events: PlannedEventBatchItem[],
    clearFutureEvents?: boolean
  ) => Promise<void>;
  onOpenTodayWorkout?: () => void;
  onOpenAthleteProfileModal?: () => void;
  onOpenGoalsArchitect?: () => void;
  onOpenOfficialRaceModal?: () => void;
  onOpenCoachWithPrompt: (prompt: string) => void;
  onOpenTracksideStopwatch?: () => void;
}


const CalendarViewInner: React.FC<CalendarViewProps> = ({
  activities,
  wellnessDays,
  plannedEvents,
  targetGoals = [],
  envFilter,
  selectedSport,
  onSelectSport,
  distanceUnit,
  athleteFtp,
  athleteProfile,
  onSelectActivity,
  onCreatePlannedEvent,
  onUpdatePlannedEvent,
  onDeletePlannedEvent,
  onDeletePlanBlock,
  onBatchCreatePlannedEvents,
  onOpenTodayWorkout,
  onOpenAthleteProfileModal,
  onOpenGoalsArchitect,
  onOpenOfficialRaceModal,
  onOpenCoachWithPrompt,
  onOpenTracksideStopwatch,
}) => {
  const [sportFilter, setSportFilter] = useState<SportCategory | 'ALL'>(selectedSport);
  useEffect(() => {
    setSportFilter(selectedSport);
  }, [selectedSport]);

  const [cardDensity, setCardDensity] = useState<'intervals' | 'compact'>('intervals');
  const [mobileLayout, setMobileLayout] = useState<'agenda' | 'grid'>('agenda');
  const [showDayEffortStripe, setShowDayEffortStripe] = useState<boolean>(true);
  const [showCellWellness, setShowCellWellness] = useState<boolean>(false);
  const [hoveredPrescription, setHoveredPrescription] = useState<HoveredPrescriptionTooltipData | null>(null);

  const todayIso = useMemo(() => getLocalDateIso(), []);

  // Default to the month of the most recent activity, or the upcoming planBlock month if activities lie in an earlier month
  const initialDate = useMemo(() => {
    const firstUpcomingBlock = plannedEvents
      .filter((e) => Boolean(e.planBlockId) && e.date.slice(0, 10) >= todayIso)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    if (activities.length > 0) {
      const latestStr = activities[0].startDateLocal.slice(0, 10);
      const [y, m] = latestStr.split('-').map(Number);
      if (y && m) {
        const latestYm = `${y}-${String(m).padStart(2, '0')}`;
        const hasPlannedInLatestMonth = plannedEvents.some(
          (e) => Boolean(e.planBlockId) && e.date.slice(0, 7) === latestYm
        );
        if (firstUpcomingBlock && !hasPlannedInLatestMonth) {
          const [by, bm] = firstUpcomingBlock.date.slice(0, 10).split('-').map(Number);
          if (by && bm) return { year: by, month: bm - 1 };
        }
        return { year: y, month: m - 1 };
      }
    }
    if (firstUpcomingBlock) {
      const [by, bm] = firstUpcomingBlock.date.slice(0, 10).split('-').map(Number);
      if (by && bm) return { year: by, month: bm - 1 };
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }, [activities, plannedEvents, todayIso]);

  const [viewYear, setViewYear] = useState(initialDate.year);
  const [viewMonth, setViewMonth] = useState(initialDate.month);

  // Workout Builder Modal State
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [editingPlannedEvent, setEditingPlannedEvent] = useState<PlannedWorkoutEvent | null>(null);
  const [pendingClearBlockConfirm, setPendingClearBlockConfirm] = useState(false);
  const [isClearingBlock, setIsClearingBlock] = useState(false);
  const [isViewOptionsOpen, setIsViewOptionsOpen] = useState(false);
  const viewOptionsRef = useRef<HTMLDivElement>(null);
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [pendingDeletePlannedId, setPendingDeletePlannedId] = useState<string | null>(null);
  const [draggingEventId, setDraggingEventId] = useState<string | null>(null);
  const [dragOverDateStr, setDragOverDateStr] = useState<string | null>(null);
  const [copyWeekIndex, setCopyWeekIndex] = useState<number | null>(null);
  const [movingEventId, setMovingEventId] = useState<string | null>(null);
  const [moveTargetDate, setMoveTargetDate] = useState<string>('');
  const [watchPushBanner, setWatchPushBanner] = useState<string | null>(null);
  const builderDialogRef = useRef<HTMLDivElement>(null);

  const activePlanBlock = useMemo(() => {
    const found = plannedEvents.find((e) => Boolean(e.planBlockId));
    if (!found?.planBlockId) return null;
    const count = plannedEvents.filter((e) => e.planBlockId === found.planBlockId).length;
    return {
      id: found.planBlockId,
      name: found.planBlockName || 'Training Plan Block',
      count,
    };
  }, [plannedEvents]);

  const handleLaunchPlannedInStopwatch = (ev: PlannedWorkoutEvent) => {
    const spec = inferTrackWorkoutSpecFromPlannedEvent(ev);
    if (!spec) return;
    stageWorkoutInTracksideStopwatch({ title: ev.name, spec });
    onOpenTracksideStopwatch?.();
  };

  const handleExportPlannedFit = (ev: PlannedWorkoutEvent) => {
    if (!ev.workoutSyntax) return;
    exportWorkoutAsFit({
      name: ev.name,
      sport: ev.sportCategory,
      workoutSyntax: ev.workoutSyntax,
      ftpWatts: athleteProfile?.ftp || athleteFtp || 280,
      lthrBpm: athleteProfile?.lthr || 170,
      thresholdPaceSecsPerKm: athleteProfile?.thresholdPaceSecsPerKm || 250,
      dateIso: ev.date,
    });
  };

  const handleExportPlannedZwo = (ev: PlannedWorkoutEvent) => {
    if (!ev.workoutSyntax) return;
    exportWorkoutAsZwo({
      name: ev.name,
      sport: ev.sportCategory,
      workoutSyntax: ev.workoutSyntax,
      description: ev.description,
      ftpWatts: athleteProfile?.ftp || athleteFtp || 280,
      thresholdPaceSecsPerKm: athleteProfile?.thresholdPaceSecsPerKm || 250,
      dateIso: ev.date,
    });
  };

  const handleExportPlannedErg = (ev: PlannedWorkoutEvent) => {
    if (!ev.workoutSyntax) return;
    exportWorkoutAsErg({
      name: ev.name,
      sport: ev.sportCategory,
      workoutSyntax: ev.workoutSyntax,
      ftpWatts: athleteProfile?.ftp || athleteFtp || 280,
      dateIso: ev.date,
    });
  };

  const handleSharePlannedWorkout = (ev: PlannedWorkoutEvent) => {
    openShareWorkoutRoute({
      kind: 'WORKOUT',
      version: 1,
      title: ev.name,
      sport: ev.sportCategory,
      date: ev.date.slice(0, 10),
      workoutSyntax: ev.workoutSyntax,
      plannedDurationSecs: ev.plannedDurationSecs,
      plannedLoad: ev.plannedLoad,
      description: ev.description,
      defaultUnit: distanceUnit,
      referenceFtpWatts: athleteProfile?.ftp || athleteFtp || 260,
      referenceThresholdPaceSecsPerKm: athleteProfile?.thresholdPaceSecsPerKm || 245,
    });
  };

  useModalDialog({
    isOpen: isBuilderOpen,
    onClose: () => {
      setIsBuilderOpen(false);
      setEditingPlannedEvent(null);
    },
    dialogRef: builderDialogRef,
  });

  useEffect(() => {
    if (!isViewOptionsOpen && !isActionsOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (isViewOptionsOpen && viewOptionsRef.current && !viewOptionsRef.current.contains(e.target as Node)) {
        setIsViewOptionsOpen(false);
      }
      if (isActionsOpen && actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setIsActionsOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsViewOptionsOpen(false);
        setIsActionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isViewOptionsOpen, isActionsOpen]);

  const [builderDate, setBuilderDate] = useState<string>(() => todayIso);

  // Index wellness by date
  const wellnessByDate = useMemo(() => {
    const map = new Map<string, UnifiedWellnessDay>();
    for (const w of wellnessDays) {
      map.set(w.date, w);
    }
    return map;
  }, [wellnessDays]);

  const activeSportFilter = sportFilter;

  // Index filtered activities by YYYY-MM-DD (sorted chronologically within each day)
  const activitiesByDate = useMemo(() => {
    const map = new Map<string, UnifiedActivity[]>();
    for (const act of activities) {
      if (envFilter !== 'COMBINED' && act.environment !== envFilter) continue;
      if (activeSportFilter !== 'ALL' && act.sportCategory !== activeSportFilter) continue;
      const dateStr = act.startDateLocal.slice(0, 10);
      const list = map.get(dateStr) || [];
      list.push(act);
      map.set(dateStr, list);
    }
    for (const [k, list] of map.entries()) {
      list.sort(
        (a, b) =>
          new Date(a.startDateLocal).getTime() - new Date(b.startDateLocal).getTime()
      );
      map.set(k, list);
    }
    return map;
  }, [activities, envFilter, activeSportFilter]);

  // Index planned workouts by YYYY-MM-DD in chronological AM -> PM order
  const plannedByDate = useMemo(() => {
    const map = new Map<string, PlannedWorkoutEvent[]>();
    for (const ev of sortPlannedEventsChronologically(plannedEvents)) {
      if (activeSportFilter !== 'ALL' && ev.sportCategory !== activeSportFilter) continue;
      const dateStr = ev.date.slice(0, 10);
      const list = map.get(dateStr) || [];
      list.push(ev);
      map.set(dateStr, list);
    }
    return map;
  }, [plannedEvents, activeSportFilter]);

  // Build Monday-aligned weeks for the active month
  const calendarWeeks = useMemo(() => {
    const firstDayOfMonth = new Date(viewYear, viewMonth, 1);
    const lastDayOfMonth = new Date(viewYear, viewMonth + 1, 0);

    // Day of week: Monday = 0 ... Sunday = 6
    const startOffset = (firstDayOfMonth.getDay() + 6) % 7;
    const endOffset = (7 - ((lastDayOfMonth.getDay() + 6) % 7) - 1 + 7) % 7;

    const gridStart = new Date(viewYear, viewMonth, 1 - startOffset);
    const gridEnd = new Date(viewYear, viewMonth + 1, endOffset);

    const weeks: {
      weekIndex: number;
      isoWeekNum: number;
      days: {
        dateStr: string;
        dayNumber: number;
        isCurrentMonth: boolean;
        wellness?: UnifiedWellnessDay;
        dayActivities: UnifiedActivity[];
        dayPlanned: PlannedWorkoutEvent[];
      }[];
      totalDurationSecs: number;
      totalDistanceMeters: number;
      totalElevationMeters: number;
      totalLoad: number;
      totalKcal: number;
      endOfWeekWellness?: UnifiedWellnessDay;
      ramp7d: number;
      bySport: {
        sport: SportCategory;
        timeSecs: number;
        distanceMeters: number;
        load: number;
      }[];
      weekZoneSharesPct: [number, number, number, number, number, number];
      weekZoneLabel: string;
      weekZoneRatio: string;
    }[] = [];

    const cursor = new Date(gridStart);
    let weekIdx = 0;

    while (cursor <= gridEnd) {
      const days = [];
      let totalDurationSecs = 0;
      let totalDistanceMeters = 0;
      let totalElevationMeters = 0;
      let totalLoad = 0;
      let totalKcal = 0;
      let endOfWeekWellness: UnifiedWellnessDay | undefined;
      let startOfWeekWellness: UnifiedWellnessDay | undefined;

      const sportTotals = new Map<
        SportCategory,
        { timeSecs: number; distanceMeters: number; load: number }
      >();
      const weekZoneSecs = [0, 0, 0, 0, 0, 0];

      for (let d = 0; d < 7; d++) {
        const yyyy = cursor.getFullYear();
        const mm = String(cursor.getMonth() + 1).padStart(2, '0');
        const dd = String(cursor.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;
        const isCurrentMonth = cursor.getMonth() === viewMonth;

        const wellness = wellnessByDate.get(dateStr);
        if (wellness) {
          if (!startOfWeekWellness) startOfWeekWellness = wellness;
          endOfWeekWellness = wellness;
        }
        const dayActivities = activitiesByDate.get(dateStr) || [];
        const dayPlanned = plannedByDate.get(dateStr) || [];

        for (const a of dayActivities) {
          totalDurationSecs += a.movingTimeSecs || 0;
          totalDistanceMeters += a.distanceMeters || 0;
          totalElevationMeters += a.elevationGainMeters || 0;
          totalLoad += a.trainingLoad || 0;

          // Estimate kcal from mechanical work or duration/HR
          const pwr = a.avgPower || a.normalizedPower || 0;
          const actKcal =
            pwr > 0
              ? Math.round((pwr * a.movingTimeSecs) / 1000)
              : Math.round((a.movingTimeSecs / 60) * 9.5);
          totalKcal += actKcal;

          const curSport = sportTotals.get(a.sportCategory) || {
            timeSecs: 0,
            distanceMeters: 0,
            load: 0,
          };
          curSport.timeSecs += a.movingTimeSecs || 0;
          curSport.distanceMeters += a.distanceMeters || 0;
          curSport.load += a.trainingLoad || 0;
          sportTotals.set(a.sportCategory, curSport);

          const pres = buildActivityEffortPresentation(a, athleteFtp, athleteProfile);
          for (let z = 0; z < 6; z++) {
            weekZoneSecs[z] += (pres.zoneSharesPct[z] / 100) * (a.movingTimeSecs || 0);
          }
        }

        days.push({
          dateStr,
          dayNumber: cursor.getDate(),
          isCurrentMonth,
          wellness,
          dayActivities,
          dayPlanned,
        });

        cursor.setDate(cursor.getDate() + 1);
      }

      const isoWeekNum = getIsoWeekNumber(days[0].dateStr);
      const ramp7d =
        endOfWeekWellness && startOfWeekWellness
          ? Number((endOfWeekWellness.ctl - startOfWeekWellness.ctl).toFixed(1))
          : endOfWeekWellness?.rampRate || 0;

      const bySportOrder: SportCategory[] = ['Cycling', 'Running', 'Swimming', 'Strength', 'Multisport'];
      const bySport = bySportOrder
        .filter((s) => sportTotals.has(s))
        .map((s) => ({
          sport: s,
          ...sportTotals.get(s)!,
        }));

      const totalWeekZoneSecs = Math.max(
        1,
        weekZoneSecs.reduce((acc, v) => acc + v, 0)
      );
      const weekZoneSharesPct = weekZoneSecs.map((v) =>
        Math.round((v / totalWeekZoneSecs) * 100)
      ) as [number, number, number, number, number, number];

      const baseShare = weekZoneSharesPct[0] + weekZoneSharesPct[1];
      const tempoThreshShare = weekZoneSharesPct[2] + weekZoneSharesPct[3];
      const vo2AnaerobicShare = weekZoneSharesPct[4] + weekZoneSharesPct[5];

      let weekZoneLabel = 'Base';
      if (vo2AnaerobicShare >= 15 && baseShare >= 68) {
        weekZoneLabel = 'Polarized';
      } else if (tempoThreshShare >= 22) {
        weekZoneLabel = 'Threshold';
      } else if (baseShare >= 85) {
        weekZoneLabel = 'Base';
      } else if (totalLoad > 0) {
        weekZoneLabel = 'Pyramidal';
      }

      const ratioNum =
        tempoThreshShare + vo2AnaerobicShare > 0
          ? (baseShare / Math.max(12, tempoThreshShare + vo2AnaerobicShare)).toFixed(2)
          : '1.80';

      weeks.push({
        weekIndex: weekIdx++,
        isoWeekNum,
        days,
        totalDurationSecs,
        totalDistanceMeters,
        totalElevationMeters,
        totalLoad,
        totalKcal,
        endOfWeekWellness,
        ramp7d,
        bySport,
        weekZoneSharesPct,
        weekZoneLabel,
        weekZoneRatio: ratioNum,
      });
    }

    return weeks;
  }, [
    viewYear,
    viewMonth,
    wellnessByDate,
    activitiesByDate,
    plannedByDate,
    athleteFtp,
    athleteProfile,
  ]);

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleJumpToday = () => {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
  };

  const handleOpenBuilderForDate = (
    dateStr: string,
    existingEvent?: PlannedWorkoutEvent | null
  ) => {
    setBuilderDate(dateStr);
    setEditingPlannedEvent(existingEvent ?? null);
    setIsBuilderOpen(true);
  };

  const handleSaveVisualBuilderWorkout = async (payload: {
    id?: string;
    date: string;
    name: string;
    sportCategory: SportCategory;
    environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
    plannedDurationSecs: number;
    plannedLoad: number;
    workoutSyntax: string;
    description: string;
    scheduledTime?: string;
    sessionSlot?: WorkoutSessionSlot;
    locationName?: string;
    locationCategory?: PracticeVenueCategory;
    replaceExistingDate?: boolean;
    trackSpec?: TrackWorkoutSpec;
  }) => {
    if (payload.id && onUpdatePlannedEvent) {
      await onUpdatePlannedEvent(payload.id, payload);
    } else {
      await onCreatePlannedEvent(payload);
    }
    setIsBuilderOpen(false);
    setEditingPlannedEvent(null);
  };


  const getSportIcon = (sport: SportCategory, className = 'w-3.5 h-3.5') => {
    if (sport === 'Cycling') return <Bike className={className} />;
    if (sport === 'Running') return <Footprints className={className} />;
    if (sport === 'Swimming') return <Waves className={className} />;
    if (sport === 'Strength') return <Dumbbell className={className} />;
    return <Activity className={className} />;
  };

  const primaryObjective = useMemo(() => {
    const aRace = targetGoals.find((g) => g.priority === 'A-Race') || targetGoals[0];
    if (aRace) {
      const daysOut = Math.max(
        7,
        Math.round(
          (new Date(`${aRace.targetDate}T00:00:00Z`).getTime() - Date.now()) / 86400000
        )
      );
      const weeksOut = Math.max(1, Math.round(daysOut / 7));
      const phase =
        weeksOut <= 2
          ? 'Peak & Taper'
          : weeksOut % 4 === 0
            ? 'Deload Week (-30%)'
            : weeksOut <= 6
              ? 'Specific Build'
              : 'Aerobic Base';
      const pct = Math.min(
        98,
        Math.max(20, Math.round((aRace.currentValue / Math.max(1, aRace.targetValue)) * 100))
      );
      const isPaceGoal =
        /pace|sec\/km|s\/km|min\/mi|min\/km/i.test(aRace.unit || '') ||
        /pace/i.test(aRace.title || '');
      const currentStr = isPaceGoal
        ? formatPaceWithUnit(aRace.currentValue, distanceUnit)
        : `${aRace.currentValue} ${aRace.unit}`;
      const targetStr = isPaceGoal
        ? formatPaceWithUnit(aRace.targetValue, distanceUnit)
        : `${aRace.targetValue} ${aRace.unit}`;
      return {
        hasGoal: true,
        title: aRace.title,
        sport: aRace.sportCategory,
        targetDate: aRace.targetDate,
        weeksOut,
        daysOut,
        phase,
        currentStr,
        targetStr,
        pct,
      };
    }
    const curFtp = athleteProfile?.ftp || athleteFtp || 0;
    const nextFtp = curFtp > 0 ? Math.round(curFtp * 1.05) : 0;
    return {
      hasGoal: false,
      title: 'No Primary Race or Block Goal Set',
      sport: (selectedSport === 'Running' ? 'Running' : 'Cycling') as SportCategory,
      targetDate: '',
      weeksOut: 0,
      daysOut: 0,
      phase: 'Unscheduled Block',
      currentStr: curFtp > 0 ? `${curFtp}W FTP` : 'Uncalibrated',
      targetStr: nextFtp > 0 ? `${nextFtp}W (+5%)` : 'Set Target in Progress',
      pct: 0,
    };
  }, [targetGoals, athleteProfile, athleteFtp, distanceUnit]);

  return (
    <div className="space-y-3">
      {/* Primary Objective & Block Phase Ribbon (1-line compact) */}
      <section className="rounded-2xl liquid-glass px-3.5 py-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="text-xs sm:text-sm font-bold text-ap-ink dark:text-ap-chalk truncate">
            {primaryObjective.title}
          </span>
          <span className="px-2 py-0.5 rounded-md ap-status-prime text-2xs font-mono font-bold shrink-0">
            {primaryObjective.phase}
          </span>
          {primaryObjective.hasGoal ? (
            <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark truncate">
              {primaryObjective.weeksOut}w · {primaryObjective.currentStr} →{' '}
              <strong>{primaryObjective.targetStr}</strong> ({primaryObjective.pct}%)
            </span>
          ) : (
            <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
              {primaryObjective.currentStr}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {onOpenTodayWorkout && (
            <button
              type="button"
              onClick={onOpenTodayWorkout}
              className="min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1 rounded-xl liquid-glass-subtle hover:border-ap-frame text-ap-muted dark:text-ap-muted-dark text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              <span>Today&apos;s Readiness &amp; Workout →</span>
            </button>
          )}
          {onOpenGoalsArchitect && (
            <button
              type="button"
              onClick={onOpenGoalsArchitect}
              className="min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-ap-obsidian hover:bg-[#242826] text-ap-chalk dark:bg-ap-volt dark:text-ap-obsidian border border-ap-frame text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Training Block &amp; Race Goals →</span>
            </button>
          )}
        </div>
      </section>

      {/* Top Calendar Header & Controls */}
      <section className="rounded-2xl liquid-glass p-3.5 sm:p-4 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarIcon className="w-4 h-4 ap-text-brand" />
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-ap-ink dark:text-ap-chalk">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </h1>
            <ChartInfoTooltip
              title="Training Calendar & Activity Effort Zones"
              subtitle="Weekly Load, Morning Readiness & Effort Skyline"
              whatItMeasures="Combines weekly load totals with daily morning vitals and intra-workout effort zones (Z1–Z6+)."
              benchmarks="Polarized weeks: 75–85% in Z1–Z2; 15–20% in Z4–Z6."
              coachingAction="Keep easy days in Z1/Z2 green so key sessions hit Z4–Z6 targets."
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 max-w-full">
            <select
              value={activeSportFilter}
              aria-label="Filter calendar by sport"
              onChange={(e) => {
                const sp = e.target.value as SportCategory | 'ALL';
                setSportFilter(sp);
                onSelectSport?.(sp);
              }}
              className="min-h-[44px] sm:min-h-[36px] rounded-xl liquid-glass-subtle px-3 py-1 text-xs font-semibold text-ap-ink dark:text-[#ECF2EE] cursor-pointer"
            >
              <option value="ALL">All Sports</option>
              <option value="Cycling">Cycling</option>
              <option value="Running">Running</option>
              <option value="Swimming">Swimming</option>
              <option value="Strength">Strength</option>
              <option value="Multisport">Cross-Train / Multisport</option>
            </select>

            {/* Month Switcher */}
            <div className="flex items-center gap-1 rounded-xl liquid-capsule-track p-1">
              <button
                type="button"
                onClick={handlePrevMonth}
                aria-label="Previous Month"
                className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] px-2 rounded-lg flex items-center justify-center hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
                title="Previous Month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleJumpToday}
                className="min-h-[44px] sm:min-h-[36px] px-2.5 rounded-lg hover:bg-white dark:hover:bg-slate-800 text-xs font-mono font-semibold text-slate-700 dark:text-slate-200 transition-colors"
              >
                Today
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                aria-label="Next Month"
                className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] px-2 rounded-lg flex items-center justify-center hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
                title="Next Month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Group 3: Secondary Tools & Views (Actions & View Popover) */}
            <div className="flex items-center gap-0.5 rounded-xl liquid-capsule-track p-1">
              {/* Actions Dropdown (AI Review & Log Race) */}
              <div ref={actionsRef} className="relative">
                <button
                  type="button"
                  aria-expanded={isActionsOpen}
                  aria-haspopup="menu"
                  onClick={() => {
                    setIsActionsOpen((v) => !v);
                    setIsViewOptionsOpen(false);
                  }}
                  className={`min-h-[44px] sm:min-h-[36px] px-2.5 sm:px-3 py-1 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
                    isActionsOpen
                      ? 'liquid-capsule-active text-ap-ink dark:text-[#ECF2EE] font-semibold'
                      : 'text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-white'
                  }`}
                  title="Secondary calendar actions (AI Review, Log Race)"
                >
                  <Sparkles className="w-3.5 h-3.5 ap-text-brand" />
                  <span>Actions</span>
                  {isActionsOpen ? (
                    <ChevronUp className="w-3.5 h-3.5 opacity-75" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 opacity-75" />
                  )}
                </button>

                {isActionsOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 sm:left-0 sm:right-auto mt-2 z-30 w-[min(14rem,calc(100vw-2rem))] rounded-2xl liquid-glass p-1.5 space-y-0.5 text-xs shadow-2xl border border-slate-200/80 dark:border-white/10"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsActionsOpen(false);
                        onOpenCoachWithPrompt(
                          `Review my ${MONTH_NAMES[viewMonth]} ${viewYear} training calendar, weekly load progression, and effort zone distribution. Propose 2 structured workouts for this week.`
                        );
                      }}
                      className="w-full min-h-[44px] sm:min-h-[36px] flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl text-left hover:bg-slate-200/60 dark:hover:bg-white/10 text-ap-ink dark:text-ap-chalk transition-colors cursor-pointer"
                    >
                      <span className="inline-flex items-center gap-2 font-semibold">
                        <Sparkles className="w-3.5 h-3.5 ap-text-brand shrink-0" />
                        <span>AI Calendar Review</span>
                      </span>
                      <span className="text-2xs font-mono px-1.5 py-0.5 rounded ap-status-prime">
                        Coach
                      </span>
                    </button>

                    {onOpenGoalsArchitect && (
                      <button
                        type="button"
                        role="menuitem"
                        data-testid="calendar-open-block-builder"
                        onClick={() => {
                          setIsActionsOpen(false);
                          onOpenGoalsArchitect();
                        }}
                        className="w-full min-h-[44px] sm:min-h-[36px] flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl text-left hover:bg-slate-200/60 dark:hover:bg-white/10 text-ap-ink dark:text-ap-chalk transition-colors cursor-pointer"
                      >
                        <span className="inline-flex items-center gap-2 font-semibold">
                          <Flame className="w-3.5 h-3.5 ap-text-brand shrink-0" />
                          <span>Build Training Block</span>
                        </span>
                        <span className="text-2xs font-mono px-1.5 py-0.5 rounded ap-status-info">
                          Plan
                        </span>
                      </button>
                    )}

                    {onOpenOfficialRaceModal && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setIsActionsOpen(false);
                          onOpenOfficialRaceModal();
                        }}
                        className="w-full min-h-[44px] sm:min-h-[36px] flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl text-left hover:bg-slate-200/60 dark:hover:bg-white/10 text-ap-ink dark:text-ap-chalk transition-colors cursor-pointer"
                      >
                        <span className="inline-flex items-center gap-2 font-semibold">
                          <Trophy className="w-3.5 h-3.5 text-[#D97706] shrink-0" />
                          <span>Log Official Race</span>
                        </span>
                        <span className="text-2xs font-mono px-1.5 py-0.5 rounded ap-status-caution">
                          Results
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="w-px h-4 bg-slate-300/80 dark:bg-white/15 my-auto" aria-hidden="true" />

              {/* View Options Popover (Density, Effort Stripes & Z1–Z6 Legend) */}
              <div ref={viewOptionsRef} className="relative">
                <button
                  type="button"
                  aria-expanded={isViewOptionsOpen}
                  onClick={() => {
                    setIsViewOptionsOpen((v) => !v);
                    setIsActionsOpen(false);
                  }}
                  className={`min-h-[44px] sm:min-h-[36px] px-2.5 sm:px-3 py-1 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
                    isViewOptionsOpen
                      ? 'liquid-capsule-active text-ap-ink dark:text-[#ECF2EE] font-semibold'
                      : 'text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-white'
                  }`}
                  title="Calendar display options"
                >
                  <Sliders className="w-3.5 h-3.5 ap-text-brand" />
                  <span>View</span>
                  {isViewOptionsOpen ? (
                    <ChevronUp className="w-3.5 h-3.5 opacity-75" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 opacity-75" />
                  )}
                </button>

                {isViewOptionsOpen && (
                  <div className="absolute right-0 mt-2 z-30 w-[min(19rem,calc(100vw-2rem))] rounded-2xl liquid-glass p-4 space-y-3.5 text-xs shadow-2xl border border-slate-200/80 dark:border-white/10">
                  <div className="space-y-1.5">
                    <div className="text-2xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
                      Card Density
                    </div>
                    <div className="grid grid-cols-2 gap-1 p-1 rounded-xl liquid-capsule-track">
                      <button
                        type="button"
                        aria-pressed={cardDensity === 'intervals'}
                        onClick={() => setCardDensity('intervals')}
                        className={`min-h-[40px] sm:min-h-[34px] px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                          cardDensity === 'intervals'
                            ? 'ap-nav-volt-active'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        Detailed
                      </button>
                      <button
                        type="button"
                        aria-pressed={cardDensity === 'compact'}
                        onClick={() => setCardDensity('compact')}
                        className={`min-h-[40px] sm:min-h-[34px] px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                          cardDensity === 'compact'
                            ? 'ap-nav-volt-active'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        Compact
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200/70 dark:border-white/10">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      Daily Effort Stripes
                    </span>
                    <button
                      type="button"
                      aria-pressed={showDayEffortStripe}
                      onClick={() => setShowDayEffortStripe((v) => !v)}
                      className={`min-h-[38px] sm:min-h-[32px] px-3 py-1 rounded-lg border text-2xs font-mono font-bold transition-all cursor-pointer ${
                        showDayEffortStripe
                          ? 'ap-status-prime'
                          : 'border-slate-300/70 dark:border-slate-700/70 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {showDayEffortStripe ? 'On' : 'Off'}
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200/70 dark:border-white/10">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      Daily Wellness (HRV / Sleep)
                    </span>
                    <button
                      type="button"
                      aria-pressed={showCellWellness}
                      onClick={() => setShowCellWellness((v) => !v)}
                      className={`min-h-[38px] sm:min-h-[32px] px-3 py-1 rounded-lg border text-2xs font-mono font-bold transition-all cursor-pointer ${
                        showCellWellness
                          ? 'ap-status-prime'
                          : 'border-slate-300/70 dark:border-slate-700/70 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {showCellWellness ? 'On' : 'Off'}
                    </button>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-slate-200/70 dark:border-white/10">
                    <div className="text-2xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
                      Effort Zone Key
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {INTERVALS_EFFORT_ZONES.map((z) => (
                        <span
                          key={z.code}
                          className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-mono text-2xs"
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-xs shrink-0"
                            style={{ backgroundColor: z.color }}
                          />
                          <strong className="text-slate-900 dark:text-white">{z.code}</strong>
                          <span className="truncate font-sans">{z.name}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Group 4: Active Plan Block Undo & Schedule CTA */}
          {activePlanBlock && onDeletePlanBlock && (
            pendingClearBlockConfirm ? (
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  data-testid="calendar-confirm-clear-block"
                  disabled={isClearingBlock}
                  onClick={async () => {
                    setIsClearingBlock(true);
                    try {
                      await onDeletePlanBlock(activePlanBlock.id);
                      setPendingClearBlockConfirm(false);
                    } finally {
                      setIsClearingBlock(false);
                    }
                  }}
                  className="min-h-[44px] sm:min-h-[36px] px-2.5 py-1 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer"
                >
                  {isClearingBlock ? 'Clearing...' : `Clear (${activePlanBlock.count})`}
                </button>
                <button
                  type="button"
                  onClick={() => setPendingClearBlockConfirm(false)}
                  className="min-h-[44px] sm:min-h-[36px] px-2.5 py-1 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  Keep
                </button>
              </div>
            ) : (
              <button
                type="button"
                data-testid="calendar-clear-plan-block"
                onClick={() => setPendingClearBlockConfirm(true)}
                className="min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-xl border border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-500/10 text-xs font-semibold whitespace-nowrap cursor-pointer"
                title={`Remove all ${activePlanBlock.count} workouts from ${activePlanBlock.name}`}
              >
                Clear Block ({activePlanBlock.count})
              </button>
            )
          )}
          <button
            type="button"
            onClick={() => handleOpenBuilderForDate(todayIso)}
            className="ap-btn-primary !min-h-[44px] sm:!min-h-[36px] px-3.5 py-1.5 text-xs font-bold whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" weight="bold" />
            <span>Schedule</span>
          </button>
        </div>
      </div>

        {/* Mobile / Tablet Layout Switcher (< xl only) */}
        <div className="flex xl:hidden pt-2 border-t border-slate-200/70 dark:border-slate-800/80 items-center justify-between gap-2 text-xs">
          <span className="text-2xs font-mono text-slate-500 dark:text-slate-400">
            Calendar Layout
          </span>
          <div className="flex items-center gap-0.5 p-1 rounded-lg liquid-capsule-track">
            <button
              type="button"
              aria-pressed={mobileLayout === 'agenda'}
              onClick={() => setMobileLayout('agenda')}
              className={`min-h-[44px] sm:min-h-[36px] px-3 py-1 rounded-md transition-all cursor-pointer ${
                mobileLayout === 'agenda'
                  ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              Agenda
            </button>
            <button
              type="button"
              aria-pressed={mobileLayout === 'grid'}
              onClick={() => setMobileLayout('grid')}
              className={`min-h-[44px] sm:min-h-[36px] px-3 py-1 rounded-md transition-all cursor-pointer ${
                mobileLayout === 'grid'
                  ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              Full Grid
            </button>
          </div>
        </div>
      </section>

      {watchPushBanner && (
        <div role="status" className="rounded-xl ap-status-prime px-4 py-2 text-xs font-medium flex items-center justify-between gap-2">
          <span>{watchPushBanner}</span>
          <button type="button" onClick={() => setWatchPushBanner(null)} className="font-mono text-2xs underline cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* Mobile & Tablet Week & Day Agenda View (< xl when mobileLayout === 'agenda') */}
      {mobileLayout === 'agenda' && (
        <CalendarMobileAgenda
          calendarWeeks={calendarWeeks}
          showDayEffortStripe={showDayEffortStripe}
          showCellWellness={showCellWellness}
          todayIso={todayIso}
          distanceUnit={distanceUnit}
          athleteFtp={athleteFtp}
          athleteProfile={athleteProfile}
          pendingDeletePlannedId={pendingDeletePlannedId}
          setPendingDeletePlannedId={setPendingDeletePlannedId}
          onSelectActivity={onSelectActivity}
          onOpenTodayWorkout={onOpenTodayWorkout}
          onUpdatePlannedEvent={onUpdatePlannedEvent}
          onDeletePlannedEvent={onDeletePlannedEvent}
          onBatchCreatePlannedEvents={onBatchCreatePlannedEvents}
          onOpenCoachWithPrompt={onOpenCoachWithPrompt}
          onOpenTracksideStopwatch={onOpenTracksideStopwatch}
          onOpenBuilderForDate={handleOpenBuilderForDate}
          handleLaunchPlannedInStopwatch={handleLaunchPlannedInStopwatch}
          handleExportPlannedFit={handleExportPlannedFit}
          handleExportPlannedZwo={handleExportPlannedZwo}
          handleExportPlannedErg={handleExportPlannedErg}
          handleSharePlannedWorkout={handleSharePlannedWorkout}
          getSportIcon={getSportIcon}
        />
      )}

      {/* Intervals.icu 8-Column Calendar Grid (Left Week Summary Column + 7 Day Columns) */}
      <section
        className={`${
          mobileLayout === 'agenda' ? 'hidden xl:block' : 'block'
        } rounded-2xl liquid-glass overflow-visible border border-slate-200/90 dark:border-slate-800/90`}
      >
        <div className="overflow-x-auto xl:overflow-visible">
          <div className="min-w-[940px]">
            {/* Sticky 8-Column Day Header Row */}
            <div className="grid grid-cols-8 border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-900/90 text-2xs font-bold tracking-wider uppercase text-slate-500 dark:text-slate-400">
              <div className="px-2.5 py-2.5 border-r border-slate-200 dark:border-slate-800 flex items-center justify-between gap-1">
                <span>WEEK</span>
                <span className="font-mono text-2xs text-slate-600 dark:text-slate-400 hidden 2xl:inline">CTL · TSB</span>
              </div>
              {WEEKDAYS.map((day) => (
                <div
                  key={day}
                  className="px-2.5 py-2.5 border-r last:border-r-0 border-slate-200 dark:border-slate-800 text-center"
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Week Rows */}
            <div className="divide-y divide-slate-300/80 dark:divide-slate-800">
              {calendarWeeks.map((week) => {
                const eow = week.endOfWeekWellness;
                const tsbVal = eow ? Math.round(eow.tsb) : null;
                const tsbColorClass =
                  tsbVal === null
                    ? 'text-slate-500'
                    : tsbVal >= 5
                      ? 'text-[#0284C7] dark:text-sky-400'
                      : tsbVal >= -10
                        ? 'text-slate-600 dark:text-slate-300'
                        : tsbVal >= -30
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400';

                return (
                  <div
                    key={week.weekIndex}
                    className="grid grid-cols-8 min-h-[210px] bg-white/60 dark:bg-ap-turf/40"
                  >
                    {/* COLUMN 1 (LEFT): STREAMLINED WEEKLY SUMMARY COLUMN */}
                    <div className="relative p-3 border-r border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-900/50 flex flex-col justify-between space-y-2.5 text-2xs">
                      <div className="space-y-2">
                        {/* Week Number Title */}
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
                            W{week.isoWeekNum}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {onBatchCreatePlannedEvents && (
                              <button
                                type="button"
                                data-testid={`calendar-copy-week-btn-w${week.isoWeekNum}`}
                                onClick={() =>
                                  setCopyWeekIndex((prev) =>
                                    prev === week.weekIndex ? null : week.weekIndex
                                  )
                                }
                                className="text-2xs font-semibold text-slate-700 dark:text-slate-200 hover:text-ap-clay dark:hover:text-ap-volt inline-flex items-center gap-0.5 cursor-pointer"
                                title={`Copy Week ${week.isoWeekNum} planned workouts`}
                              >
                                <Copy className="w-3 h-3" />
                                <span>Copy Week</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                onOpenCoachWithPrompt(
                                  `Analyze Week ${week.isoWeekNum} (${week.days[0].dateStr} to ${week.days[6].dateStr}): Total time ${formatCompactDuration(week.totalDurationSecs)}, Load ${week.totalLoad}, Fitness ${eow ? Math.round(eow.ctl) : '-'}, Fatigue ${eow ? Math.round(eow.atl) : '-'}, Form ${tsbVal ?? '-'}, Zone focus ${week.weekZoneLabel}.`
                                )
                              }
                              className="text-2xs font-semibold ap-text-brand hover:underline cursor-pointer"
                              title="Ask AI Coach about this week"
                            >
                              Coach
                            </button>
                          </div>
                        </div>

                        {copyWeekIndex === week.weekIndex && onBatchCreatePlannedEvents && (
                          <div
                            className={`absolute left-2 z-40 w-[248px] ${
                              week.weekIndex === calendarWeeks.length - 1
                                ? 'bottom-2'
                                : 'top-9'
                            }`}
                          >
                            <CalendarCopyWeekPopover
                              isoWeekNum={week.isoWeekNum}
                              sourceMondayIso={week.days[0].dateStr}
                              plannedCount={week.days.reduce(
                                (sum, d) => sum + d.dayPlanned.length,
                                0
                              )}
                              onConfirmCopy={async (targetMondayIso) => {
                                const batch = buildCopiedWeekBatchItems(
                                  week.days,
                                  targetMondayIso
                                );
                                if (batch.length > 0) {
                                  await onBatchCreatePlannedEvents(batch);
                                }
                              }}
                              onClose={() => setCopyWeekIndex(null)}
                            />
                          </div>
                        )}

                        {/* 4 Core Weekly Metrics: Time, Load, CTL, Form */}
                        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-2xs leading-tight">
                          <div className="flex flex-col min-w-0">
                            <span className="text-ap-muted dark:text-ap-muted-dark">Time</span>
                            <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 truncate">
                              {formatCompactDuration(week.totalDurationSecs)}
                            </span>
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="text-ap-muted dark:text-ap-muted-dark">Load</span>
                            <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 truncate">
                              {week.totalLoad}
                            </span>
                          </div>

                          {eow && (
                            <>
                              <div className="flex flex-col min-w-0">
                                <span className="text-ap-muted dark:text-ap-muted-dark">CTL</span>
                                <span className="font-mono font-bold tabular-nums text-[#0F766E] dark:text-[#2DD4BF] truncate">
                                  {Math.round(eow.ctl)}
                                </span>
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className="text-ap-muted dark:text-ap-muted-dark">Form</span>
                                <span
                                  className={`font-mono font-bold tabular-nums truncate ${tsbColorClass}`}
                                >
                                  {tsbVal !== null && tsbVal > 0 ? `+${tsbVal}` : tsbVal}
                                </span>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Per-Sport Time / Dist / Load Table */}
                        {week.bySport.length > 0 && (
                          <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800/80">
                            <div className="grid grid-cols-12 gap-1 text-2xs text-slate-600 dark:text-slate-400 pb-1 font-medium">
                              <span className="col-span-2" />
                              <span className="col-span-4 text-right">Time</span>
                              <span className="col-span-3 text-right">Dist</span>
                              <span className="col-span-3 text-right">Load</span>
                            </div>
                            <div className="space-y-1 font-mono tabular-nums text-2xs">
                              {week.bySport.map((row) => (
                                <div
                                  key={row.sport}
                                  className="grid grid-cols-12 gap-1 items-center text-slate-700 dark:text-slate-200 whitespace-nowrap"
                                >
                                  <span className="col-span-2 text-[#0284C7] dark:text-sky-400 flex items-center">
                                    {getSportIcon(row.sport, 'w-3 h-3')}
                                  </span>
                                  <span className="col-span-4 text-right font-medium truncate">
                                    {formatCompactDuration(row.timeSecs)}
                                  </span>
                                  <span className="col-span-3 text-right text-slate-600 dark:text-slate-300 truncate">
                                    {row.distanceMeters > 100
                                      ? formatDistance(row.distanceMeters, distanceUnit, 0)
                                      : '-'}
                                  </span>
                                  <span className="col-span-3 text-right font-semibold truncate">
                                    {row.load}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Weekly Zone Classification & Mini Effort Distribution Bar */}
                      {week.totalDurationSecs > 0 && (
                        <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800/80 space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-x-1 gap-y-0.5 text-2xs">
                            <span className="text-slate-500 dark:text-slate-400">Zones</span>
                            <span className="font-bold text-slate-900 dark:text-slate-100 font-mono">
                              {week.weekZoneLabel} {week.weekZoneRatio}
                            </span>
                          </div>
                          <div
                            className="h-1.5 w-full rounded-full overflow-hidden flex bg-slate-200 dark:bg-slate-800"
                            title={`Weekly Effort Zone Mix: Z1 ${week.weekZoneSharesPct[0]}% · Z2 ${week.weekZoneSharesPct[1]}% · Z3 ${week.weekZoneSharesPct[2]}% · Z4 ${week.weekZoneSharesPct[3]}% · Z5+ ${week.weekZoneSharesPct[4] + week.weekZoneSharesPct[5]}%`}
                          >
                            {week.weekZoneSharesPct.map((pct, zIdx) =>
                              pct > 0 ? (
                                <div
                                  key={zIdx}
                                  style={{
                                    width: `${pct}%`,
                                    backgroundColor: INTERVALS_EFFORT_ZONES[zIdx].color,
                                  }}
                                  className="h-full"
                                />
                              ) : null
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* COLUMNS 2–8: MONDAY THROUGH SUNDAY CELLS */}
                    {week.days.map((cell) => {
                      const isToday = cell.dateStr === todayIso;
                      const w = cell.wellness;
                      const dayLoadSum = cell.dayActivities.reduce(
                        (acc, a) => acc + (a.trainingLoad || 0),
                        0
                      );
                      const sleepHm = w && w.sleepSecs > 0 ? formatSleepHm(w.sleepSecs) : '';
                      const plannedStripe = buildDayPlannedEffortStripe(
                        cell.dateStr,
                        cell.dayPlanned,
                        w,
                        cell.dayActivities
                      );
                      const plannedZoneBreakdownTooltip = plannedStripe
                        ? INTERVALS_EFFORT_ZONES.map((z, idx) =>
                            plannedStripe.zoneSharesPct[idx] > 0
                              ? `${z.code} (${z.name}): ${plannedStripe.zoneSharesPct[idx]}%`
                              : null
                          )
                            .filter(Boolean)
                            .join(' · ')
                        : '';

                      return (
                        <div
                          key={cell.dateStr}
                          data-testid={`calendar-day-cell-${cell.dateStr}`}
                          onDragOver={(e) => {
                            if (!onUpdatePlannedEvent) return;
                            if (draggingEventId || (e.dataTransfer && e.dataTransfer.types.length > 0)) {
                              e.preventDefault();
                              if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                              if (dragOverDateStr !== cell.dateStr) {
                                setDragOverDateStr(cell.dateStr);
                              }
                            }
                          }}
                          onDragLeave={(e) => {
                            if (
                              dragOverDateStr === cell.dateStr &&
                              !e.currentTarget.contains(e.relatedTarget as Node | null)
                            ) {
                              setDragOverDateStr(null);
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const draggedId =
                              draggingEventId || getCalendarDragPayload(e.dataTransfer);
                            setDraggingEventId(null);
                            setDragOverDateStr(null);
                            if (!draggedId || !onUpdatePlannedEvent) return;
                            const draggedEv = plannedEvents.find((p) => p.id === draggedId);
                            if (!draggedEv || draggedEv.date.slice(0, 10) === cell.dateStr) return;
                            void onUpdatePlannedEvent(
                              draggedEv.id,
                              buildReschedulePlannedEventPatch(draggedEv, cell.dateStr)
                            );
                          }}
                          className={`p-2 min-w-0 overflow-hidden border-r last:border-r-0 border-slate-200 dark:border-slate-800 flex flex-col justify-between transition-colors group ${
                            dragOverDateStr === cell.dateStr
                              ? 'ring-2 ring-inset ring-ap-clay dark:ring-ap-volt bg-ap-clay/10 dark:bg-ap-volt/10'
                              : !cell.isCurrentMonth
                                ? 'bg-slate-200/55 dark:bg-ap-turf/80'
                                : isToday
                                  ? 'bg-blue-50/40 dark:bg-blue-950/20'
                                  : 'hover:bg-slate-50/60 dark:hover:bg-slate-900/30'
                          }`}
                        >
                          <div className="space-y-2">
                            {/* Day Header + Compact Morning Wellness Strip + Planned Workout Effort Stripe */}
                            <div className="space-y-1 text-center border-b border-slate-200/60 dark:border-slate-800/60 pb-1.5">
                              <div className="flex items-center justify-between gap-1">
                                {plannedStripe ? (
                                  <span
                                    className={`text-2xs font-mono font-bold px-1 py-0.2 rounded-xs leading-tight bg-white/85 dark:bg-[#0B110E]/80 border border-slate-300/70 dark:border-white/15 ${plannedStripe.dominantZone.inkClass}`}
                                    title={`Planned Target Zone: ${plannedStripe.dominantZone.code} ${plannedStripe.dominantZone.name}`}
                                  >
                                    {plannedStripe.dominantZone.code}
                                  </span>
                                ) : (
                                  <span className="w-4" aria-hidden="true" />
                                )}
                                <span
                                  className={`text-2xs font-mono ${
                                    isToday
                                      ? 'font-bold text-blue-600 dark:text-sky-400'
                                      : 'font-medium text-slate-500 dark:text-slate-400'
                                  }`}
                                >
                                  {formatIntervalsDayHeader(cell.dateStr)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleOpenBuilderForDate(
                                      cell.dateStr,
                                      plannedStripe ? plannedStripe.primaryEvent : null
                                    )
                                  }
                                  aria-label={`Schedule or edit planned workout on ${cell.dateStr}`}
                                  className="opacity-0 [@media(hover:none)]:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 min-h-[44px] min-w-[44px] xl:min-h-0 xl:min-w-0 p-1 inline-flex items-center justify-center rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-blue-500 transition-opacity"
                                  title={`Schedule or edit planned workout on ${cell.dateStr}`}
                                >
                                  <Plus className="w-3.5 h-3.5 xl:w-3 xl:h-3" />
                                </button>
                              </div>

                              {/* SMALL DIMENSIONAL DAILY PLANNED WORKOUT EFFORT SKYLINE (Compact stripe only when day also has completed sessions; avoids double-render with planned card below) */}
                              {showDayEffortStripe &&
                                plannedStripe &&
                                cell.dayActivities.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleOpenBuilderForDate(
                                      cell.dateStr,
                                      plannedStripe.primaryEvent
                                    )
                                  }
                                  onMouseEnter={(e) => {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
                                    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
                                    const cardW = 310;
                                    let left = rect.left + rect.width / 2 - cardW / 2;
                                    if (left + cardW > vw - 12) left = vw - cardW - 12;
                                    if (left < 12) left = 12;
                                    let top = rect.bottom + 6;
                                    if (top + 230 > vh - 12 && rect.top > 240) {
                                      top = rect.top - 225;
                                    }
                                    setHoveredPrescription({
                                      dateStr: cell.dateStr,
                                      stripe: plannedStripe,
                                      top,
                                      left,
                                      width: cardW,
                                    });
                                  }}
                                  onMouseLeave={() =>
                                    setHoveredPrescription((prev) =>
                                      prev?.dateStr === cell.dateStr ? null : prev
                                    )
                                  }
                                  className="w-full text-left group/stripe rounded-xs overflow-hidden border border-slate-200/80 dark:border-slate-800/80 hover:border-ap-cobalt/60 dark:hover:border-ap-volt/60 transition-colors focus-visible:ring-2 focus-visible:ring-ap-cobalt dark:focus-visible:ring-ap-volt"
                                  title={`${plannedStripe.sportCategory} (Scheduled Workout): ${plannedStripe.workoutName} (${plannedStripe.totalDurationMins}m · ~${plannedStripe.plannedLoad} TSS)\n${plannedStripe.description}\nZones: ${plannedZoneBreakdownTooltip}`}
                                >
                                  {/* Dimensional Mini Effort Skyline with Threshold Reference */}
                                  <div className="relative h-[18px] w-full flex items-stretch bg-slate-100/90 dark:bg-ap-turf">
                                    {/* Proportional Effort Amplitude Bars */}
                                    <div className="relative flex-1 flex items-end px-[1px] pt-[2px]">
                                      {/* 100% FTP / Threshold Reference Dashed Line */}
                                      <div
                                        className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-slate-400/45 dark:border-slate-500/45"
                                        style={{ bottom: '74%' }}
                                      />
                                      {plannedStripe.steps.map((st, sIdx) => (
                                        <div
                                          key={sIdx}
                                          style={{
                                            width: `${st.widthPct}%`,
                                            height: `${st.heightPct}%`,
                                            backgroundColor: st.color,
                                          }}
                                          className="border-r last:border-r-0 border-white/25 dark:border-slate-950/35 rounded-t-[1px] transition-all"
                                        />
                                      ))}
                                    </div>
                                  </div>
                                  {/* Compact Micro Label with Cycling / Running Modality Icon */}
                                  <div className="flex items-center justify-between gap-1 px-1 py-0.5 bg-slate-100/80 dark:bg-ap-carbon/90 group-hover/stripe:bg-[#E9EFE9] dark:group-hover/stripe:bg-ap-turf border-t border-slate-200/60 dark:border-slate-800/60 transition-colors">
                                    <span className="inline-flex items-center gap-1 text-2xs font-mono text-slate-600 dark:text-slate-300 truncate min-w-0">
                                      {plannedStripe.sportCategory === 'Running' ? (
                                        <Footprints className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                      ) : (
                                        <Bike className="w-2.5 h-2.5 text-blue-600 dark:text-sky-400 shrink-0" />
                                      )}
                                      <span className="truncate">
                                        {plannedStripe.workoutName}
                                      </span>
                                    </span>
                                    <span className="text-2xs font-mono font-semibold text-slate-600 dark:text-slate-300 shrink-0">
                                      {plannedStripe.totalDurationMins}m
                                    </span>
                                  </div>
                                </button>
                              )}

                              {/* Line 1 of Morning Wellness: Sleep duration + score + weight (shielded under Safe-Sport) */}
                              {showCellWellness &&
                                w &&
                                (sleepHm ||
                                  w.sleepScore > 0 ||
                                  (!athleteProfile?.safeSportHideWeight && w.weightKg > 0)) && (
                                <div className="flex flex-wrap items-center justify-center gap-x-1 text-2xs font-mono tabular-nums leading-tight pt-0.5">
                                  {sleepHm && (
                                    <span className="inline-flex items-center gap-0.5 text-slate-700 dark:text-slate-300 font-semibold">
                                      <Moon className="w-2.5 h-2.5 text-slate-800 dark:text-slate-200 fill-current" />
                                      <span>{sleepHm}</span>
                                    </span>
                                  )}
                                  {w.sleepScore > 0 && (
                                    <span
                                      className={`font-bold ${
                                        w.sleepScore >= 80
                                          ? 'text-emerald-600 dark:text-emerald-400'
                                          : w.sleepScore >= 65
                                            ? 'text-amber-600 dark:text-amber-400'
                                            : 'text-rose-600 dark:text-rose-400'
                                      }`}
                                    >
                                      {w.sleepScore}
                                    </span>
                                  )}
                                  {w.sleepQuality && (
                                    <span className="text-amber-600 dark:text-amber-400 font-semibold">
                                      Q{w.sleepQuality}
                                    </span>
                                  )}
                                  {!athleteProfile?.safeSportHideWeight && w.weightKg > 0 && (
                                    <span className="text-slate-600 dark:text-slate-400">
                                      {distanceUnit === 'mi'
                                        ? `${Math.round(w.weightKg * 2.20462)}lbs`
                                        : `${w.weightKg.toFixed(1)}kg`}
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* Line 2 of Morning Wellness: Resting HR + HRV + Day Load */}
                              {showCellWellness &&
                                w &&
                                (w.restingHR > 0 || w.hrvRMSSD > 0 || dayLoadSum > 0) && (
                                <div className="flex flex-wrap items-center justify-center gap-x-1 text-2xs font-mono tabular-nums leading-tight">
                                  {w.restingHR > 0 && (
                                    <span className="inline-flex items-center gap-0.5 text-rose-700 dark:text-rose-400 font-semibold">
                                      <Heart className="w-2.5 h-2.5 fill-current" />
                                      <span>{w.restingHR}bpm</span>
                                    </span>
                                  )}
                                  {w.restingHR > 0 && w.hrvRMSSD > 0 && (
                                    <span className="text-ap-muted dark:text-ap-muted-dark" aria-hidden="true">·</span>
                                  )}
                                  {w.hrvRMSSD > 0 && (
                                    <span className="text-emerald-800 dark:text-emerald-300 font-semibold">
                                      {w.hrvRMSSD}ms
                                    </span>
                                  )}
                                  {dayLoadSum > 0 && (
                                    <span className="text-ap-muted dark:text-slate-300 font-semibold">
                                      Load {dayLoadSum}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Completed Activity Cards with Effort Zones Through Each Activity */}
                            <div className="space-y-2">
                              {cell.dayActivities.map((act) => {
                                const effort = buildActivityEffortPresentation(
                                  act,
                                  athleteFtp,
                                  athleteProfile
                                );
                                const isVirtualRide =
                                  act.sportCategory === 'Cycling' &&
                                  (act.environment === 'INDOOR' ||
                                    act.subType === 'Virtual Cycling' ||
                                    act.subType === 'Smart Trainer' ||
                                    /zwift|trainer|virtual|watopia|makuri/i.test(act.name));

                                const powerVal = act.avgPower || act.normalizedPower || 0;
                                const paceLabel =
                                  act.sportCategory === 'Running' && act.avgPaceSecsPerKm
                                    ? formatPaceWithUnit(act.avgPaceSecsPerKm, distanceUnit)
                                    : '';
                                const gapLabel =
                                  act.sportCategory === 'Running' &&
                                  act.gapPaceSecsPerKm &&
                                  Math.abs(act.gapPaceSecsPerKm - (act.avgPaceSecsPerKm || 0)) >= 3
                                    ? formatPaceWithUnit(act.gapPaceSecsPerKm, distanceUnit)
                                    : '';

                                const zoneTooltip = INTERVALS_EFFORT_ZONES.map(
                                  (z, idx) => `${z.code}: ${effort.zoneSharesPct[idx]}%`
                                ).join(' · ');

                                return (
                                  <button
                                    key={act.id}
                                    type="button"
                                    onClick={() => onSelectActivity(act)}
                                    className="w-full text-left rounded-lg bg-white dark:bg-slate-900/95 border border-slate-300/85 dark:border-slate-700/85 shadow-xs hover:shadow-md hover:border-blue-500/70 transition-all overflow-hidden flex flex-col"
                                  >
                                    {/* 1. Sport-Colored Top Bar (or Gold Championship Bar for Official FAT Races) */}
                                    <div
                                      className={`px-2 py-1 flex items-center justify-between gap-1 text-2xs font-bold font-mono tabular-nums ${
                                        act.officialRaceData
                                          ? 'bg-amber-400 text-ap-obsidian'
                                          : getSportHeaderColor(act.sportCategory)
                                      }`}
                                    >
                                      <span className="inline-flex items-center gap-1 min-w-0 flex-1">
                                        {act.officialRaceData ? (
                                          <Trophy className="w-3.5 h-3.5 shrink-0" />
                                        ) : (
                                          getSportIcon(act.sportCategory, 'w-3.5 h-3.5 shrink-0')
                                        )}
                                        <span className="truncate">
                                          {act.officialRaceData
                                            ? act.officialRaceData.eventLabel
                                            : formatCompactDuration(act.movingTimeSecs)}
                                        </span>
                                      </span>
                                      {act.officialRaceData ? (
                                        <span className="font-extrabold shrink-0">
                                          {act.officialRaceData.displayFatTime}
                                        </span>
                                      ) : act.distanceMeters > 100 ? (
                                        <span className="truncate shrink-0">
                                          {formatDistance(act.distanceMeters, distanceUnit, 1)}
                                        </span>
                                      ) : isVirtualRide ? (
                                        <span className="text-2xs uppercase tracking-wider px-1 rounded bg-white/20 shrink-0">
                                          Virtual
                                        </span>
                                      ) : null}
                                    </div>

                                    {/* 2. Centered Physiological Telemetry Readout */}
                                    {cardDensity === 'intervals' && (
                                      <div className="px-1.5 pt-1.5 pb-1 text-center space-y-0.5 font-mono tabular-nums">
                                        {act.officialRaceData && (
                                          <div className="text-2xs font-bold text-amber-700 dark:text-amber-400">
                                            {act.officialRaceData.platform.replace(/^OFFICIAL\s+/i, '')} · VDOT{' '}
                                            {act.officialRaceData.vdotScore.toFixed(1)}
                                          </div>
                                        )}
                                        <div className="flex flex-wrap items-center justify-center gap-x-1.5 text-2xs font-bold leading-tight">
                                          {act.avgHr > 0 && (
                                            <span className="text-[#B91C1C] dark:text-rose-400">
                                              {act.avgHr}bpm
                                            </span>
                                          )}
                                          {powerVal > 0 && (
                                            <span className="text-[#4338CA] dark:text-indigo-300">
                                              {powerVal}W
                                            </span>
                                          )}
                                          {paceLabel && (
                                            <span className="text-[#0F766E] dark:text-[#2DD4BF]">
                                              {paceLabel}
                                            </span>
                                          )}
                                        </div>

                                          <div className="flex items-center justify-center gap-1.5 text-2xs font-bold text-slate-800 dark:text-slate-200 leading-tight">
                                            <span>Load {act.trainingLoad}</span>
                                            {plannedStripe && (() => {
                                              const targetMins = Math.max(
                                                1,
                                                plannedStripe.totalDurationMins
                                              );
                                              const actualMins = Math.max(
                                                1,
                                                Math.round(act.movingTimeSecs / 60)
                                              );
                                              const compliancePct = Math.round(
                                                (actualMins / targetMins) * 100
                                              );
                                              const inRange =
                                                compliancePct >= 85 && compliancePct <= 115;
                                              return (
                                                <span
                                                  className={`px-1 py-0.2 rounded-xs text-2xs font-mono ${
                                                    inRange
                                                      ? 'ap-status-prime'
                                                      : 'ap-status-caution'
                                                  }`}
                                                  title={`Scheduled vs. Actual Duration Adherence: ${compliancePct}% of scheduled ${plannedStripe.workoutName} (${targetMins}m)`}
                                                >
                                                  {compliancePct}% vs Plan
                                                </span>
                                              );
                                            })()}
                                          </div>

                                          {gapLabel && (
                                            <div className="text-2xs font-bold text-[#4338CA] dark:text-indigo-300 leading-tight">
                                              GAP {gapLabel}
                                            </div>
                                          )}
                                        </div>
                                      )}

                                    {/* 3. Dimensional Effort Zones Skyline Through the Activity (With Y-Axis Amplitude) */}
                                    <div
                                      className="w-full px-0.5 pt-1"
                                      title={`Completed Effort Zones (${act.sportCategory}) — ${zoneTooltip}`}
                                    >
                                      <div className="relative h-[22px] w-full flex items-stretch bg-slate-100/75 dark:bg-ap-turf rounded-xs overflow-hidden">
                                        <div className="relative flex-1 flex items-end px-[1px] pt-[2px]">
                                          <div
                                            className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-slate-400/40 dark:border-slate-500/40"
                                            style={{ bottom: '74%' }}
                                          />
                                          {effort.slices.map((s, idx) => (
                                            <div
                                              key={idx}
                                              style={{
                                                width: `${s.widthPct}%`,
                                                height: `${s.heightPct}%`,
                                                backgroundColor: s.color,
                                              }}
                                              className="transition-all border-r last:border-r-0 border-white/15 dark:border-slate-950/25 first:rounded-tl-[1px] last:rounded-tr-[1px]"
                                            />
                                          ))}
                                          {/* Continuous Z2 baseline rule along the bottom */}
                                          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#0D9488]/85" />
                                        </div>
                                      </div>
                                    </div>

                                    {/* 4. Centered Activity Title Footer */}
                                    <div className="px-1.5 py-1.5 bg-slate-50/90 dark:bg-slate-900/90 border-t border-slate-200/70 dark:border-slate-800/80 text-center flex items-center justify-center gap-1">
                                      <span className="text-2xs font-medium text-slate-700 dark:text-slate-200 leading-tight line-clamp-2">
                                        {act.name}
                                      </span>
                                      {act.stravaPrCount > 0 ? (
                                        <span
                                          className="inline-flex items-center text-2xs font-mono font-bold text-amber-600 dark:text-amber-400 shrink-0"
                                          title={`${act.stravaPrCount} Strava PR(s)`}
                                        >
                                          <Trophy className="w-2.5 h-2.5" />
                                        </span>
                                      ) : (
                                        <FileText className="w-2.5 h-2.5 text-slate-600 dark:text-slate-400 shrink-0 opacity-75" />
                                      )}
                                    </div>
                                  </button>
                                );
                              })}

                              {/* Planned Workout Cards with Effort Stripe & Skyline */}
                              {cell.dayPlanned.map((ev) => {
                                const evStripe = buildDayPlannedEffortStripe(
                                  cell.dateStr,
                                  [ev],
                                  w,
                                  cell.dayActivities
                                );
                                if (!evStripe) return null;
                                return (
                                  <div
                                    key={ev.id}
                                    data-testid={`calendar-planned-card-${ev.id}`}
                                    draggable={Boolean(onUpdatePlannedEvent)}
                                    onDragStart={(e) => {
                                      setDraggingEventId(ev.id);
                                      setCalendarDragPayload(e.dataTransfer, ev.id);
                                    }}
                                    onDragEnd={() => {
                                      setDraggingEventId(null);
                                      setDragOverDateStr(null);
                                    }}
                                    className={`rounded-lg border border-dashed border-blue-500/60 bg-blue-500/5 dark:bg-blue-500/10 overflow-hidden flex flex-col ${
                                      onUpdatePlannedEvent ? 'cursor-grab active:cursor-grabbing' : ''
                                    } ${draggingEventId === ev.id ? 'opacity-50' : ''}`}
                                  >
                                    {/* Top Intervals.icu Effort Stripe along Planned Card Header */}
                                    <div className="h-[4px] w-full flex">
                                      {evStripe.steps.map((s, i) => (
                                        <div
                                          key={i}
                                          style={{
                                            width: `${s.widthPct}%`,
                                            backgroundColor: s.color,
                                          }}
                                          className="h-full"
                                        />
                                      ))}
                                    </div>

                                    <div className="p-2 space-y-1.5">
                                      <div className="flex items-start justify-between gap-1">
                                        <div className="min-w-0">
                                          <div className="flex items-center gap-1 text-2xs font-mono uppercase tracking-wider text-blue-600 dark:text-sky-400 font-semibold">
                                            <span>Planned · {ev.sportCategory}</span>
                                            <span
                                              className={`px-1 rounded-xs text-2xs font-bold bg-white/85 dark:bg-[#0B110E]/80 border border-slate-300/70 dark:border-white/15 ${evStripe.dominantZone.inkClass}`}
                                            >
                                              {evStripe.dominantZone.code}
                                            </span>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => handleOpenBuilderForDate(ev.date.slice(0, 10), ev)}
                                            className="block w-full text-left text-2xs font-bold text-slate-900 dark:text-slate-100 hover:underline line-clamp-2 leading-snug cursor-pointer"
                                            title="Click to edit workout in place"
                                          >
                                            {ev.name}
                                          </button>
                                          {formatSessionLogisticsLine(ev) && (
                                            <div className="mt-0.5 flex items-center gap-1 text-2xs font-mono text-slate-600 dark:text-slate-300 truncate">
                                              <MapPin className="w-3 h-3 shrink-0" />
                                              <span className="truncate">{formatSessionLogisticsLine(ev)}</span>
                                            </div>
                                          )}
                                        </div>
                                        {pendingDeletePlannedId === ev.id ? (
                                          <div className="flex items-center gap-1 shrink-0">
                                            <button
                                              type="button"
                                              onClick={() => {
                                                onDeletePlannedEvent(ev.id);
                                                setPendingDeletePlannedId(null);
                                              }}
                                              className="min-h-[44px] xl:min-h-0 px-2 xl:px-1.5 py-1 xl:py-0.5 rounded bg-rose-600 text-white text-2xs font-bold"
                                            >
                                              Del
                                            </button>
                                            <button
                                              type="button"
                                              aria-label="Cancel planned workout deletion"
                                              onClick={() => setPendingDeletePlannedId(null)}
                                              className="min-h-[44px] min-w-[44px] xl:min-h-0 xl:min-w-0 px-2 xl:px-1.5 py-1 xl:py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-2xs"
                                            >
                                              ×
                                            </button>
                                          </div>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() => setPendingDeletePlannedId(ev.id)}
                                            aria-label={`Delete planned workout ${ev.name}`}
                                            className="min-h-[44px] min-w-[44px] xl:min-h-0 xl:min-w-0 p-1 inline-flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-rose-500 transition-colors"
                                            title="Delete planned workout"
                                          >
                                            <Trash2 className="w-3.5 h-3.5 xl:w-3 xl:h-3" />
                                          </button>
                                        )}
                                      </div>

                                      {evStripe.steps.length > 0 && (
                                        <div className="relative h-5 w-full flex items-end gap-[1px] pt-0.5 bg-slate-100/60 dark:bg-slate-900/50 px-0.5 rounded-xs overflow-hidden">
                                          {evStripe.steps.map((s, i) => (
                                            <div
                                              key={i}
                                              style={{
                                                width: `${s.widthPct}%`,
                                                height: `${s.heightPct}%`,
                                                backgroundColor: s.color,
                                              }}
                                              className="rounded-t-[1px]"
                                              title={`${s.label} (${s.durationMins}m · ${s.zoneCode})`}
                                            />
                                          ))}
                                          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#0D9488]/80" />
                                        </div>
                                      )}

                                      <div className="flex items-center justify-between text-2xs font-mono text-slate-600 dark:text-slate-300">
                                        <span>{formatCompactDuration(ev.plannedDurationSecs)}</span>
                                        <span>Load ~{ev.plannedLoad}</span>
                                      </div>

                                      {(ev.sportCategory === 'Running' &&
                                        Boolean(inferTrackWorkoutSpecFromPlannedEvent(ev))) ||
                                      Boolean(ev.workoutSyntax) ||
                                      Boolean(onUpdatePlannedEvent) ? (
                                        <div className="space-y-1.5 pt-1 border-t border-slate-200/70 dark:border-slate-800/70">
                                          <div className="flex flex-wrap items-center gap-1">
                                            {ev.sportCategory === 'Running' &&
                                              inferTrackWorkoutSpecFromPlannedEvent(ev) && (
                                                <button
                                                  type="button"
                                                  data-testid="calendar-launch-stopwatch"
                                                  onClick={() => handleLaunchPlannedInStopwatch(ev)}
                                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-ap-cobalt hover:bg-ap-clay-dark dark:bg-ap-volt dark:hover:bg-[#C8EF1E] text-white dark:text-ap-obsidian text-2xs font-mono font-bold transition-colors cursor-pointer"
                                                  title="Stage this track session in Trackside Stopwatch"
                                                >
                                                  <Timer className="w-3 h-3" weight="bold" />
                                                  <span>Time on Track</span>
                                                </button>
                                              )}
                                            <button
                                              type="button"
                                              data-testid="calendar-edit-planned-workout"
                                              onClick={() => handleOpenBuilderForDate(ev.date.slice(0, 10), ev)}
                                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-carbon text-slate-700 dark:text-slate-200 text-2xs font-mono font-semibold hover:border-ap-cobalt transition-colors cursor-pointer"
                                              title="Edit workout in place"
                                            >
                                              <span>Edit</span>
                                            </button>
                                            {onUpdatePlannedEvent && (
                                              <button
                                                type="button"
                                                data-testid={`calendar-move-planned-btn-${ev.id}`}
                                                aria-label={`Move ${ev.name} to another date`}
                                                onClick={() => {
                                                  setMovingEventId((prev) =>
                                                    prev === ev.id ? null : ev.id
                                                  );
                                                  setMoveTargetDate(ev.date.slice(0, 10));
                                                }}
                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-carbon text-slate-700 dark:text-slate-200 text-2xs font-mono font-semibold hover:border-ap-cobalt transition-colors cursor-pointer"
                                                title="Move workout to another date"
                                              >
                                                <ArrowsLeftRight className="w-3 h-3" />
                                                <span>Move</span>
                                              </button>
                                            )}
                                            {ev.workoutSyntax && (
                                              <details className="relative inline-block">
                                                <summary className="list-none inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-carbon text-slate-700 dark:text-slate-200 text-2xs font-mono font-semibold hover:border-ap-cobalt transition-colors cursor-pointer select-none">
                                                  <Download className="w-3 h-3" weight="bold" />
                                                  <span>Export ▾</span>
                                                </summary>
                                                <div className="absolute right-0 bottom-full mb-1 z-30 w-44 rounded-xl liquid-glass p-1 space-y-0.5 shadow-xl border border-emerald-900/15 dark:border-white/15">
                                                  <CalendarWatchPushItems
                                                    options={{
                                                      name: ev.name,
                                                      sport: ev.sportCategory,
                                                      workoutSyntax: ev.workoutSyntax,
                                                      description: ev.description,
                                                      ftpWatts: athleteProfile?.ftp || athleteFtp || 280,
                                                      lthrBpm: athleteProfile?.lthr || 170,
                                                      thresholdPaceSecsPerKm: athleteProfile?.thresholdPaceSecsPerKm || 250,
                                                      dateIso: ev.date.slice(0, 10),
                                                    }}
                                                    onPushResult={(msg) => setWatchPushBanner(msg)}
                                                  />
                                                  <button
                                                    type="button"
                                                    data-testid="calendar-export-fit"
                                                    onClick={() => handleExportPlannedFit(ev)}
                                                    className="w-full min-h-[34px] flex items-center gap-1.5 px-2 py-1 rounded-lg text-left text-2xs font-mono font-semibold text-ap-ink dark:text-ap-chalk hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                                                    title="Download Garmin .FIT workout file"
                                                  >
                                                    <Download className="w-3 h-3" weight="bold" />
                                                    <span>.FIT</span>
                                                  </button>
                                                  <button
                                                    type="button"
                                                    data-testid="calendar-export-zwo"
                                                    onClick={() => handleExportPlannedZwo(ev)}
                                                    className="w-full min-h-[34px] flex items-center gap-1.5 px-2 py-1 rounded-lg text-left text-2xs font-mono font-semibold text-ap-ink dark:text-ap-chalk hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                                                    title="Download Zwift .ZWO workout file"
                                                  >
                                                    <Download className="w-3 h-3" weight="bold" />
                                                    <span>.ZWO</span>
                                                  </button>
                                                  {ev.sportCategory === 'Cycling' && (
                                                    <button
                                                      type="button"
                                                      data-testid="calendar-export-erg"
                                                      onClick={() => handleExportPlannedErg(ev)}
                                                      className="w-full min-h-[34px] flex items-center gap-1.5 px-2 py-1 rounded-lg text-left text-2xs font-mono font-semibold text-ap-ink dark:text-ap-chalk hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                                                      title="Download TrainerRoad .ERG workout file"
                                                    >
                                                      <Download className="w-3 h-3" weight="bold" />
                                                      <span>.ERG</span>
                                                    </button>
                                                  )}
                                                  <button
                                                    type="button"
                                                    data-testid="calendar-share-workout"
                                                    onClick={() => handleSharePlannedWorkout(ev)}
                                                    className="w-full min-h-[34px] flex items-center gap-1.5 px-2 py-1 rounded-lg text-left text-2xs font-mono font-semibold text-ap-ink dark:text-ap-chalk hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                                                    title="Share interactive preview or PNG card"
                                                  >
                                                    <ShareNetwork className="w-3 h-3" weight="bold" />
                                                    <span>Share</span>
                                                  </button>
                                                </div>
                                              </details>
                                            )}
                                          </div>
                                          {movingEventId === ev.id && onUpdatePlannedEvent && (
                                            <div className="flex flex-wrap items-center gap-1 pt-0.5">
                                              <input
                                                type="date"
                                                aria-label={`New date for ${ev.name}`}
                                                data-testid={`calendar-move-date-input-${ev.id}`}
                                                value={moveTargetDate}
                                                onChange={(e) => setMoveTargetDate(e.target.value)}
                                                className="min-w-0 flex-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-carbon px-1.5 py-0.5 text-2xs font-mono text-ap-ink dark:text-ap-chalk"
                                              />
                                              <button
                                                type="button"
                                                data-testid={`calendar-move-confirm-${ev.id}`}
                                                onClick={() => {
                                                  if (
                                                    moveTargetDate &&
                                                    moveTargetDate !== ev.date.slice(0, 10)
                                                  ) {
                                                    void onUpdatePlannedEvent(
                                                      ev.id,
                                                      buildReschedulePlannedEventPatch(
                                                        ev,
                                                        moveTargetDate
                                                      )
                                                    );
                                                  }
                                                  setMovingEventId(null);
                                                }}
                                                className="px-2 py-0.5 rounded bg-ap-clay text-white dark:bg-ap-volt dark:text-ap-obsidian text-2xs font-bold cursor-pointer"
                                              >
                                                Apply
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <div className="pt-1" />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Structured Visual Workout Builder Modal */}
      {isBuilderOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => {
            setIsBuilderOpen(false);
            setEditingPlannedEvent(null);
          }}
        >
          <div
            ref={builderDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="thresh-workout-builder-title"
            tabIndex={-1}
            className="w-full max-w-2xl rounded-2xl liquid-glass p-5 sm:p-6 space-y-4 shadow-2xl focus:outline-none my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="thresh-workout-builder-title"
                  className="text-lg font-bold text-slate-900 dark:text-slate-100"
                >
                  {editingPlannedEvent
                    ? `Edit Session · ${editingPlannedEvent.name}`
                    : `Schedule Session for ${builderDate}`}
                </h2>
                <span className="px-2 py-0.5 rounded-md ap-status-info text-2xs font-mono uppercase font-semibold">
                  Visual Builder
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsBuilderOpen(false);
                  setEditingPlannedEvent(null);
                }}
                aria-label="Close workout builder"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <VisualWorkoutBuilder
              dateIso={builderDate}
              defaultSport={
                selectedSport !== 'ALL'
                  ? selectedSport
                  : athleteProfile?.primarySport === 'Running'
                    ? 'Running'
                    : 'Cycling'
              }
              athleteProfile={athleteProfile}
              athleteFtp={athleteFtp}
              distanceUnit={distanceUnit}
              initialEvent={editingPlannedEvent}
              submitLabel={editingPlannedEvent ? 'Save Changes' : 'Save to Calendar'}
              onSave={handleSaveVisualBuilderWorkout}
              onCancel={() => {
                setIsBuilderOpen(false);
                setEditingPlannedEvent(null);
              }}
              onOpenTracksideStopwatch={() => {
                setIsBuilderOpen(false);
                setEditingPlannedEvent(null);
                onOpenTracksideStopwatch?.();
              }}
            />
          </div>
        </div>
      )}

      <CalendarPlannedTooltip
        hoveredPrescription={hoveredPrescription}
        getSportIcon={getSportIcon}
      />
    </div>
  );
};

export const CalendarView = React.memo(CalendarViewInner);
