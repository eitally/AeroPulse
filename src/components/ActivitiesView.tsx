import React, { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useModalDialog } from '../hooks/useModalDialog';
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Columns2,
  ExternalLink,
  MapPin,
  MessageSquare,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  ThumbsUp,
  Timer,
  Trophy,
  Upload,
  Cpu,
  X,
  ZoomIn,
  ZoomOut,
} from "./icons/PhosphorIcons";
import {
  ActivityInterval,
  AthleteProfile,
  DistanceUnit,
  EnvironmentFilter,
  PlannedWorkoutEvent,
  SportCategory,
  UnifiedActivity,
  WorkoutQuickLog,
} from '../types';
import {
  formatDistance,
  formatDuration,
  formatMultiSportPace,
  formatPace,
  formatStopwatch,
} from '../utils/formatters';
import {
  buildRepeatedSegmentsFromActivities,
  SegmentEffortOverTimeChart,
} from './SegmentEffortOverTimeChart';
import { ChartInfoTooltip } from './ChartInfoTooltip';
import { useIsMobileViewport } from '../hooks/useIsMobileViewport';

import { lazyWithRetry } from '../utils/lazyWithRetry';
import { formatRaceTimingBadgeLabel, isHandTimedRaceData } from '../utils/raceTimingBadge';
import { WorkspaceErrorBoundary } from './WorkspaceErrorBoundary';

import { ActivitiesRoutesFeedPanel } from './activities/ActivitiesRoutesFeedPanel';
import { ActivitiesComparePanel } from './activities/ActivitiesComparePanel';
import { ActivityInspectorModal } from './activities/ActivityInspectorModal';
import { type SegmentHistorySummary } from './activities/activitySeriesUtils';
import { InteractiveRouteMap } from './activities/activityLazyViews';
import {
  buildSample1HzGpxString,
  parseWorkoutFileInWorker,
  upsampleAndAnalyzeActivityInWorker,
  ComputedStreamAnalytics,
} from '../workers/activityWorkerClient';
import { useLiveActivityStream, useLiveWorkoutStoreStats } from '../db/workoutStore';
import {
  importWorkoutFilesOrArchive,
  type ArchiveImportProgress,
} from '../utils/archiveImporter';
import { generatePostWorkoutDebrief } from '../physiology/workoutDebrief';
import { autoDetectUnstructuredIntervals } from '../physiology/scholasticEngine';
import { buildCompleteAthleteProfile } from '../utils/telemetryStorage';
import { QuickRunLoggerCard } from './QuickRunLoggerCard';

interface ActivitiesViewProps {
  activities: UnifiedActivity[];
  plannedEvents?: PlannedWorkoutEvent[];
  selectedSport: SportCategory | 'ALL';
  onSelectSport: (sport: SportCategory | 'ALL') => void;
  envFilter: EnvironmentFilter;
  onSelectEnvFilter: (env: EnvironmentFilter) => void;
  distanceUnit: DistanceUnit;
  selectedActivity: UnifiedActivity | null;
  onSelectActivity: (activity: UnifiedActivity | null) => void;
  onLoadActivityStreams?: (activity: UnifiedActivity) => Promise<void>;
  onScanMoreSegments?: () => Promise<void>;
  isScanningSegments?: boolean;
  onHydrateMoreRoutes?: () => Promise<void>;
  isHydratingRoutes?: boolean;
  onToggleKudos?: (activity: UnifiedActivity) => Promise<void>;
  onAddComment?: (activity: UnifiedActivity, commentText: string) => Promise<void>;
  onOpenOfficialRaceModal?: () => void;
  onImportParsedActivity?: (activity: UnifiedActivity) => void;
  onImportParsedActivities?: (activities: UnifiedActivity[]) => void;
  onOpenTracksideStopwatch?: () => void;
  athleteWeightKg?: number;
  athleteProfile?: AthleteProfile;
  inspectorOnly?: boolean;
  onOpenCompareView?: () => void;
}


const ActivitiesViewInner: React.FC<ActivitiesViewProps> = ({
  activities,
  plannedEvents = [],
  selectedSport,
  onSelectSport,
  envFilter,
  onSelectEnvFilter,
  distanceUnit,
  selectedActivity,
  onSelectActivity,
  onLoadActivityStreams,
  onScanMoreSegments,
  isScanningSegments = false,
  onHydrateMoreRoutes,
  isHydratingRoutes = false,
  onToggleKudos,
  onAddComment,
  onOpenOfficialRaceModal,
  onImportParsedActivity,
  onImportParsedActivities,
  onOpenTracksideStopwatch,
  athleteWeightKg = 72.5,
  athleteProfile,
  inspectorOnly = false,
  onOpenCompareView,
}) => {
  const isMobile = useIsMobileViewport();
  const [searchQuery, setSearchQuery] = useState('');
  const [yearFilter, setYearFilter] = useState<string>('ALL');
  const [visibleLimit, setVisibleLimit] = useState<number>(60);
  const [archiveImportProgress, setArchiveImportProgress] =
    useState<ArchiveImportProgress | null>(null);
  const [archiveImportBanner, setArchiveImportBanner] = useState<string | null>(null);
  const [explorerSelectedSegmentId, setExplorerSelectedSegmentId] = useState<string | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<
    'LOG' | 'MAP_KUDOS' | 'SEGMENTS' | 'COMPARE'
  >('LOG');
  const [compareIdA, setCompareIdA] = useState<string | null>(null);
  const [compareIdB, setCompareIdB] = useState<string | null>(null);
  const [selectedMatchedClusterKey, setSelectedMatchedClusterKey] = useState<string | null>(null);

  const plannedByDate = useMemo(() => {
    const map = new Map<string, PlannedWorkoutEvent[]>();
    for (const ev of plannedEvents) {
      if (!ev?.date) continue;
      const list = map.get(ev.date);
      if (list) list.push(ev);
      else map.set(ev.date, [ev]);
    }
    return map;
  }, [plannedEvents]);

  // Web Worker & Dexie Live Stream State
  const [isWorkerProcessing, setIsWorkerProcessing] = useState<boolean>(false);
  const [workerAnalytics, setWorkerAnalytics] = useState<ComputedStreamAnalytics | null>(null);
  const liveDexieStream = useLiveActivityStream(selectedActivity?.id || null);
  const dexieStats = useLiveWorkoutStoreStats();
  const importMenuDetailsRef = useRef<HTMLDetailsElement | null>(null);

  const activeSelectedStream = liveDexieStream?.streams || selectedActivity?.streams;



  const handleTriggerWorker1HzUpsample = useCallback(() => {
    if (!selectedActivity) return;
    setIsWorkerProcessing(true);
    upsampleAndAnalyzeActivityInWorker({
      ...selectedActivity,
      streams: activeSelectedStream,
    })
      .then(({ analytics }) => setWorkerAnalytics(analytics))
      .catch(() => undefined)
      .finally(() => setIsWorkerProcessing(false));
  }, [selectedActivity, activeSelectedStream]);

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (
        importMenuDetailsRef.current?.hasAttribute('open') &&
        !importMenuDetailsRef.current.contains(e.target as Node)
      ) {
        importMenuDetailsRef.current.removeAttribute('open');
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && importMenuDetailsRef.current?.hasAttribute('open')) {
        importMenuDetailsRef.current.removeAttribute('open');
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Automatically compute or upsample 1Hz stream analytics in Web Worker when selectedActivity changes
  useEffect(() => {
    if (!selectedActivity) {
      setWorkerAnalytics(null);
      return;
    }
    let cancelled = false;
    setIsWorkerProcessing(true);
    upsampleAndAnalyzeActivityInWorker(selectedActivity)
      .then(({ analytics }) => {
        if (!cancelled) {
          setWorkerAnalytics(analytics);
          setIsWorkerProcessing(false);
        }
      })
      .catch(() => {
        if (!cancelled) setIsWorkerProcessing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedActivity?.id]);

  const handleWorkoutFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files ? Array.from(e.target.files) : [];
    if (fileList.length === 0) return;

    const isBulkOrArchive =
      fileList.length > 1 || fileList.some((f) => /\.(zip|gz)$/i.test(f.name));

    setIsWorkerProcessing(true);
    setArchiveImportBanner(null);

    try {
      if (!isBulkOrArchive) {
        const parsed = await parseWorkoutFileInWorker(fileList[0]);
        if (onImportParsedActivities) {
          onImportParsedActivities([parsed.activity]);
        } else if (onImportParsedActivity) {
          onImportParsedActivity(parsed.activity);
        }
        onSelectActivity(parsed.activity);
        setWorkerAnalytics(parsed.analytics);
      } else {
        const result = await importWorkoutFilesOrArchive({
          files: fileList,
          existingActivities: activities,
          onProgress: (prog) => setArchiveImportProgress({ ...prog }),
        });
        if (result.importedActivities.length > 0) {
          if (onImportParsedActivities) {
            onImportParsedActivities(result.importedActivities);
          } else if (onImportParsedActivity) {
            for (const act of result.importedActivities) {
              onImportParsedActivity(act);
            }
          }
          onSelectActivity(result.importedActivities[0]);
        }
        setArchiveImportBanner(
          `Imported ${result.importedActivities.length} workout${
            result.importedActivities.length === 1 ? '' : 's'
          } from ${result.totalDiscovered} archive file${
            result.totalDiscovered === 1 ? '' : 's'
          }${
            result.skippedFiles.length > 0
              ? ` (${result.skippedFiles.length} duplicate/unsupported skipped)`
              : ''
          }.`
        );
      }
    } catch (err) {
      console.error('Worker file/archive parse error:', err);
      setArchiveImportBanner('Archive import encountered an unexpected format error.');
    } finally {
      setArchiveImportProgress(null);
      setIsWorkerProcessing(false);
      e.target.value = '';
    }
  };

  const handleSimulate1HzGpxInWorker = async () => {
    setIsWorkerProcessing(true);
    try {
      const gpxStr = buildSample1HzGpxString(
        'Hawk Hill & Coastal Headlands Threshold Repeat (1Hz GPX)',
        1200,
        305
      );
      const parsed = await parseWorkoutFileInWorker(
        gpxStr,
        'MeetReady-1Hz-Threshold-Telemetry.gpx'
      );
      if (onImportParsedActivity) {
        onImportParsedActivity(parsed.activity);
      }
      onSelectActivity(parsed.activity);
      setWorkerAnalytics(parsed.analytics);
    } catch (err) {
      console.error('Worker 1Hz GPX simulation failed:', err);
    } finally {
      setIsWorkerProcessing(false);
    }
  };

  const availableYears = useMemo(() => {
    const yrs = new Set<string>();
    for (const a of activities) {
      const y = a.startDateLocal.slice(0, 4);
      if (/^\d{4}$/.test(y)) yrs.add(y);
    }
    return Array.from(yrs).sort((a, b) => b.localeCompare(a));
  }, [activities]);

  // Live counts by environment modality for the selected sport/year/search
  const modalityCounts = useMemo(() => {
    let all = 0;
    let outdoor = 0;
    let indoor = 0;
    for (const act of activities) {
      if (selectedSport !== 'ALL' && act.sportCategory !== selectedSport) continue;
      if (yearFilter !== 'ALL' && !act.startDateLocal.startsWith(yearFilter)) continue;
      if (
        searchQuery.trim() &&
        !act.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !act.subType.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !(act.gearName || '').toLowerCase().includes(searchQuery.toLowerCase()) &&
        !(act.deviceName || '').toLowerCase().includes(searchQuery.toLowerCase())
      ) {
        continue;
      }
      all++;
      if (act.environment === 'INDOOR') indoor++;
      else outdoor++;
    }
    return { all, outdoor, indoor };
  }, [activities, selectedSport, yearFilter, searchQuery]);

  const filteredActivities = useMemo(() => {
    return activities.filter((act) => {
      if (selectedSport !== 'ALL' && act.sportCategory !== selectedSport) return false;
      if (envFilter !== 'COMBINED' && act.environment !== envFilter) return false;
      if (yearFilter !== 'ALL' && !act.startDateLocal.startsWith(yearFilter)) return false;
      if (
        searchQuery.trim() &&
        !act.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !act.subType.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !(act.gearName || '').toLowerCase().includes(searchQuery.toLowerCase()) &&
        !(act.deviceName || '').toLowerCase().includes(searchQuery.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [activities, selectedSport, envFilter, yearFilter, searchQuery]);

  // Resolve Workout A & Workout B from activities list (so updated streams automatically propagate)
  const compareActivityA = useMemo(
    () => activities.find((a) => a.id === compareIdA) || null,
    [activities, compareIdA]
  );
  const compareActivityB = useMemo(
    () => activities.find((a) => a.id === compareIdB) || null,
    [activities, compareIdB]
  );

  // When entering Split-View Comparator Mode with empty slots, pre-populate Workout A and a matched repeat Workout B
  const handleActivateSplitCompare = () => {
    setActiveWorkspace('COMPARE');
    const sourcePool = filteredActivities.length >= 2 ? filteredActivities : activities;
    if (!compareIdA && sourcePool.length > 0) {
      const first = sourcePool[0];
      setCompareIdA(first.id);
      if (onLoadActivityStreams) onLoadActivityStreams(first);
      if (!compareIdB && sourcePool.length > 1) {
        const matchedRepeat =
          sourcePool.find(
            (cand) =>
              cand.id !== first.id &&
              cand.sportCategory === first.sportCategory &&
              cand.environment === first.environment &&
              (first.distanceMeters > 1000
                ? Math.abs(cand.distanceMeters - first.distanceMeters) / first.distanceMeters <=
                  0.25
                : Math.abs(cand.movingTimeSecs - first.movingTimeSecs) /
                    Math.max(60, first.movingTimeSecs) <=
                  0.3)
          ) || sourcePool.find((cand) => cand.id !== first.id);
        if (matchedRepeat) {
          setCompareIdB(matchedRepeat.id);
          if (onLoadActivityStreams) onLoadActivityStreams(matchedRepeat);
        }
      }
    }
  };

  // Automatically load streams whenever Workout A or Workout B changes in Split-View Comparator
  useEffect(() => {
    if (activeWorkspace === 'COMPARE' && compareActivityA && onLoadActivityStreams) {
      onLoadActivityStreams(compareActivityA);
    }
  }, [activeWorkspace, compareActivityA, onLoadActivityStreams]);

  useEffect(() => {
    if (activeWorkspace === 'COMPARE' && compareActivityB && onLoadActivityStreams) {
      onLoadActivityStreams(compareActivityB);
    }
  }, [activeWorkspace, compareActivityB, onLoadActivityStreams]);

  const handleAssignToCompareSlot = (act: UnifiedActivity, slot?: 'A' | 'B') => {
    if (onLoadActivityStreams) {
      onLoadActivityStreams(act);
    }
    if (slot === 'A') {
      setCompareIdA(act.id);
      setActiveWorkspace('COMPARE');
      if (inspectorOnly) onOpenCompareView?.();
      return;
    }
    if (slot === 'B') {
      setCompareIdB(act.id);
      setActiveWorkspace('COMPARE');
      if (inspectorOnly) onOpenCompareView?.();
      return;
    }
    if (!compareIdA || compareIdA === act.id) {
      setCompareIdA(act.id);
    } else if (!compareIdB || compareIdB === act.id) {
      setCompareIdB(act.id);
    } else {
      setCompareIdB(act.id);
    }
    setActiveWorkspace('COMPARE');
    if (inspectorOnly) onOpenCompareView?.();
  };

  const handleAutoMatchRepeatForA = () => {
    if (!compareActivityA) return;
    const targetDist = compareActivityA.distanceMeters;
    const targetDur = compareActivityA.movingTimeSecs;
    const match = activities.find((a) => {
      if (a.id === compareActivityA.id) return false;
      if (a.sportCategory !== compareActivityA.sportCategory) return false;
      if (targetDist > 1000) {
        return Math.abs(a.distanceMeters - targetDist) / targetDist <= 0.2;
      }
      return Math.abs(a.movingTimeSecs - targetDur) / Math.max(60, targetDur) <= 0.25;
    });
    if (match) {
      setCompareIdB(match.id);
      if (onLoadActivityStreams) onLoadActivityStreams(match);
    }
  };

  // Aggregate summary of currently filtered workouts
  const summaryStats = useMemo(() => {
    const totalLoad = filteredActivities.reduce((acc, a) => acc + a.trainingLoad, 0);
    const totalDistanceMeters = filteredActivities.reduce((acc, a) => acc + a.distanceMeters, 0);
    const totalDurationSecs = filteredActivities.reduce((acc, a) => acc + a.movingTimeSecs, 0);
    const totalElevation = filteredActivities.reduce((acc, a) => acc + a.elevationGainMeters, 0);
    const withEf = filteredActivities.filter((a) => a.efficiencyFactor > 0);
    const avgEf =
      withEf.length > 0
        ? (withEf.reduce((acc, a) => acc + a.efficiencyFactor, 0) / withEf.length).toFixed(2)
        : '—';
    return { totalLoad, totalDistanceMeters, totalDurationSecs, totalElevation, avgEf };
  }, [filteredActivities]);

  // Automatically find Similar Historical Workouts (Repeats) for the selected activity
  const similarHistoricalWorkouts = useMemo(() => {
    if (!selectedActivity) return [];
    const targetDist = selectedActivity.distanceMeters;
    const targetDur = selectedActivity.movingTimeSecs;
    return activities
      .filter((a) => {
        if (a.id === selectedActivity.id) return false;
        if (a.sportCategory !== selectedActivity.sportCategory) return false;
        if (a.environment !== selectedActivity.environment) return false;
        if (targetDist > 1000) {
          return Math.abs(a.distanceMeters - targetDist) / targetDist <= 0.15;
        }
        return Math.abs(a.movingTimeSecs - targetDur) / Math.max(60, targetDur) <= 0.2;
      })
      .slice(0, 8);
  }, [selectedActivity, activities]);

  // Index all Strava Segment Efforts across the athlete's archive by segmentId
  const segmentHistoryBySegmentId = useMemo(() => {
    const map = new Map<
      string,
      {
        segmentId: string;
        name: string;
        sportCategory: SportCategory;
        distanceMeters: number;
        averageGradePct: number;
        prElapsedTimeSecs: number;
        efforts: {
          effortId: string;
          activityId: string;
          activityName: string;
          date: string;
          startDateLocal: string;
          elapsedTimeSecs: number;
          avgWatts?: number;
          avgPaceSecsPerKm?: number;
          avgHr?: number;
          prRank: 1 | 2 | 3 | null;
        }[];
      }
    >();

    for (const act of activities) {
      if (!Array.isArray(act.segmentEfforts) || act.segmentEfforts.length === 0) continue;
      for (const eff of act.segmentEfforts) {
        if (!eff || !(eff.elapsedTimeSecs > 0)) continue;
        const sid = String(eff.segmentId || eff.name);
        const existing = map.get(sid);
        const entry = {
          effortId: eff.id,
          activityId: act.id,
          activityName: act.name,
          date: (eff.startDateLocal || act.startDateLocal).slice(0, 10),
          startDateLocal: eff.startDateLocal || act.startDateLocal,
          elapsedTimeSecs: eff.elapsedTimeSecs,
          avgWatts: eff.avgWatts,
          avgPaceSecsPerKm:
            eff.avgPaceSecsPerKm ||
            (act.sportCategory === 'Running' && eff.distanceMeters > 0
              ? Math.round(eff.elapsedTimeSecs / (eff.distanceMeters / 1000))
              : undefined),
          avgHr: eff.avgHr || (act.avgHr > 0 ? act.avgHr : undefined),
          prRank: eff.prRank,
        };
        if (!existing) {
          map.set(sid, {
            segmentId: sid,
            name: eff.name,
            sportCategory: act.sportCategory,
            distanceMeters: eff.distanceMeters,
            averageGradePct: eff.averageGradePct,
            prElapsedTimeSecs: eff.elapsedTimeSecs,
            efforts: [entry],
          });
        } else {
          existing.efforts.push(entry);
          if (eff.elapsedTimeSecs < existing.prElapsedTimeSecs) {
            existing.prElapsedTimeSecs = eff.elapsedTimeSecs;
          }
          if (eff.averageGradePct && !existing.averageGradePct) {
            existing.averageGradePct = eff.averageGradePct;
          }
        }
      }
    }

    for (const seg of map.values()) {
      // Rank fastest 3 efforts
      const bySpeed = [...seg.efforts].sort((a, b) => a.elapsedTimeSecs - b.elapsedTimeSecs);
      bySpeed.forEach((e, idx) => {
        e.prRank = idx === 0 ? 1 : idx === 1 ? 2 : idx === 2 ? 3 : null;
      });
      // Sort chronologically by date ascending for time-series progression chart
      seg.efforts.sort(
        (a, b) => new Date(a.startDateLocal).getTime() - new Date(b.startDateLocal).getTime()
      );
    }

    return map;
  }, [activities]);

  const repeatedSegmentsList = useMemo(
    () => buildRepeatedSegmentsFromActivities(activities),
    [activities]
  );


  if (inspectorOnly && !selectedActivity) {
    return null;
  }

  return (
    <div className={inspectorOnly ? undefined : 'space-y-6'}>
      {!inspectorOnly && (
        <>
      {/* Filter, Summary KPI Strip & 4-Mode Workspace Switcher Header Card */}
      <section className="relative z-20 rounded-2xl liquid-glass p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Activities
            </h1>
            <ChartInfoTooltip
              title="Activity Log, Modality Separation & Aerobic Durability"
              subtitle="Exercise Physiology & Performance Coaching Context"
              whatItMeasures="Aggregates all outdoor GPS and indoor virtual/smart-trainer workouts with Normalized Power (NP), Efficiency Factor (EF = NP/HR), and Aerobic Decoupling (Pa:Hr cardiac drift)."
              benchmarks="Indoor smart-trainer/virtual cycling typically yields 3–7% lower 20m power than outdoor riding due to fixed flywheel inertia and higher thermal strain; decoupling <3.5% indicates strong aerobic durability."
              liveStatus={{
                label: `${modalityCounts.indoor.toLocaleString()} Virtual/Trainer · ${modalityCounts.outdoor.toLocaleString()} Outdoor · Avg EF ${summaryStats.avgEf}`,
                state: 'optimal',
                interpretation: `Both outdoor GPS and indoor virtual/smart-trainer sessions are indexed. Filter by Outdoor vs. Virtual/Trainer below to compare modality-specific output and cardiac drift.`,
              }}
              coachingAction="Compare Virtual/Trainer vs. Outdoor sessions separately when setting interval power targets, and check Pa:Hr decoupling on endurance rides >90m before progressing threshold volume."
            />
          </div>

          {/* Unified Sport Filter, Modality Filter (Outdoor vs Virtual/Trainer), Year Selector & Search Input */}
          <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto min-w-0">
            <select
              value={selectedSport}
              aria-label="Filter workouts by sport"
              onChange={(e) => {
                onSelectSport(e.target.value as SportCategory | 'ALL');
                setVisibleLimit(60);
              }}
              className="min-h-[44px] sm:min-h-[36px] rounded-xl liquid-glass-subtle px-3 py-1 text-xs font-semibold text-slate-900 dark:text-slate-100 cursor-pointer"
            >
              <option value="ALL">All Sports</option>
              <option value="Cycling">Cycling</option>
              <option value="Running">Running</option>
              <option value="Swimming">Swimming</option>
              <option value="Strength">Strength</option>
              <option value="Multisport">Cross-Train / Hike / Row</option>
            </select>

            <select
              value={envFilter}
              aria-label="Filter workouts by environment"
              onChange={(e) => {
                onSelectEnvFilter(e.target.value as EnvironmentFilter);
                setVisibleLimit(60);
              }}
              className="min-h-[44px] sm:min-h-[36px] rounded-xl liquid-glass-subtle px-3 py-1 text-xs font-semibold text-slate-900 dark:text-slate-100 cursor-pointer"
            >
              <option value="COMBINED">All Env ({modalityCounts.all})</option>
              <option value="OUTDOOR">Outdoor ({modalityCounts.outdoor})</option>
              <option value="INDOOR">Indoor / Virtual ({modalityCounts.indoor})</option>
            </select>

            <select
              value={yearFilter}
              aria-label="Filter workouts by year"
              onChange={(e) => {
                setYearFilter(e.target.value);
                setVisibleLimit(60);
              }}
              className="min-h-[44px] sm:min-h-[36px] rounded-xl liquid-glass-subtle px-3 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
            >
              <option value="ALL">All Years ({activities.length})</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>

            <div className="relative flex-1 sm:flex-initial w-full sm:w-56 min-w-[180px]">
              <Search className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                aria-label="Search workouts or routes"
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search workouts, routes..."
                className="w-full min-h-[44px] sm:min-h-[36px] rounded-xl liquid-glass-subtle pl-8 pr-3 py-1 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {onOpenTracksideStopwatch && (
              <button
                type="button"
                data-testid="log-open-stopwatch-btn"
                onClick={onOpenTracksideStopwatch}
                className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl liquid-glass-subtle hover:border-[#28573B] dark:hover:border-[#2E6B47] text-xs font-semibold text-slate-800 dark:text-slate-100 transition-colors whitespace-nowrap cursor-pointer"
                title="Open 0.01s Trackside Split Stopwatch"
              >
                <Timer className="w-3.5 h-3.5 ap-text-brand" />
                <span>Time Session</span>
              </button>
            )}

            {onImportParsedActivity && athleteProfile && (
              <QuickRunLoggerCard
                compact
                distanceUnit={distanceUnit}
                athleteProfile={athleteProfile}
                onSaveRun={onImportParsedActivity}
              />
            )}

            {/* Consolidated + Import & Actions Dropdown Menu */}
            <div className="relative">
              <details ref={importMenuDetailsRef} className="group">
                <summary className="list-none cursor-pointer min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/35 text-xs font-bold text-blue-700 dark:text-sky-300 transition-colors whitespace-nowrap select-none">
                  <Upload className="w-3.5 h-3.5 text-blue-500" />
                  <span>{isWorkerProcessing ? 'Parsing...' : '+ Import ▾'}</span>
                </summary>
                <div className="absolute right-0 mt-2 w-[min(16rem,calc(100vw-2rem))] rounded-2xl liquid-glass border border-slate-300/80 dark:border-white/15 shadow-2xl p-2 z-40 space-y-1 text-xs">
                  <div className="px-2.5 py-1 text-2xs font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400">
                    Import &amp; Telemetry Actions
                  </div>

                  <label className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-slate-200/60 dark:hover:bg-white/10 text-slate-800 dark:text-slate-100 font-medium cursor-pointer transition-colors">
                    <Upload className="w-4 h-4 text-cyan-500 shrink-0" />
                    <div className="flex-1">
                      <div className="font-semibold">
                        Import .FIT / .GPX / .TCX or Bulk .ZIP Archive
                      </div>
                      <div className="text-2xs text-slate-500">
                        Multi-file, Garmin/Strava .ZIP, and .FIT.GZ supported
                      </div>
                    </div>
                    <input
                      type="file"
                      multiple
                      accept=".fit,.fit.gz,.gpx,.gpx.gz,.tcx,.tcx.gz,.zip,.json"
                      onChange={(e) => {
                        importMenuDetailsRef.current?.removeAttribute('open');
                        handleWorkoutFileUpload(e);
                      }}
                      className="hidden"
                    />
                  </label>

                  {onOpenOfficialRaceModal && (
                    <button
                      type="button"
                      onClick={() => {
                        importMenuDetailsRef.current?.removeAttribute('open');
                        onOpenOfficialRaceModal();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-slate-200/60 dark:hover:bg-white/10 text-left text-slate-800 dark:text-slate-100 font-medium transition-colors"
                    >
                      <Trophy className="w-4 h-4 text-amber-500 shrink-0" />
                      <div>
                        <div className="font-semibold">Log Official Race Result</div>
                        <div className="text-2xs text-slate-500">Track, XC, or road chip times</div>
                      </div>
                    </button>
                  )}

                  {onScanMoreSegments && (
                    <button
                      type="button"
                      onClick={() => {
                        importMenuDetailsRef.current?.removeAttribute('open');
                        onScanMoreSegments();
                      }}
                      disabled={isScanningSegments}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-slate-200/60 dark:hover:bg-white/10 text-left text-slate-800 dark:text-slate-100 font-medium transition-colors disabled:opacity-50"
                    >
                      <Sparkles className="w-4 h-4 text-emerald-500 shrink-0" />
                      <div>
                        <div className="font-semibold">
                          {isScanningSegments ? 'Scanning Segments...' : 'Scan Route Segments'}
                        </div>
                        <div className="text-2xs text-slate-500">Index PRs &amp; repeated climbs</div>
                      </div>
                    </button>
                  )}

                  {onHydrateMoreRoutes && (
                    <button
                      type="button"
                      onClick={() => {
                        importMenuDetailsRef.current?.removeAttribute('open');
                        onHydrateMoreRoutes();
                      }}
                      disabled={isHydratingRoutes}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-slate-200/60 dark:hover:bg-white/10 text-left text-slate-800 dark:text-slate-100 font-medium transition-colors disabled:opacity-50"
                    >
                      <MapPin className="w-4 h-4 text-orange-500 shrink-0" />
                      <div>
                        <div className="font-semibold">
                          {isHydratingRoutes ? 'Hydrating GPS...' : 'Hydrate Missing GPS Routes'}
                        </div>
                        <div className="text-2xs text-slate-500">Backfill outdoor route polylines</div>
                      </div>
                    </button>
                  )}

                  <div className="border-t border-slate-200/70 dark:border-white/10 pt-1 mt-1">
                    <button
                      type="button"
                      onClick={() => {
                        importMenuDetailsRef.current?.removeAttribute('open');
                        handleSimulate1HzGpxInWorker();
                      }}
                      disabled={isWorkerProcessing}
                      className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xl hover:bg-slate-200/60 dark:hover:bg-white/10 text-left text-slate-600 dark:text-slate-300 font-medium transition-colors disabled:opacity-50"
                    >
                      <Cpu className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span className="text-2xs">Load Sample 1Hz Workout</span>
                    </button>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </div>

        {/* Live Bulk .ZIP / .FIT.GZ Archive Import Progress & Result Banner */}
        {archiveImportProgress && (
          <div className="rounded-xl border border-blue-500/35 bg-blue-500/10 px-4 py-3 space-y-2 text-xs font-mono">
            <div className="flex flex-wrap items-center justify-between gap-2 text-blue-700 dark:text-sky-300 font-semibold">
              <span>
                Extracting &amp; parsing archive ({archiveImportProgress.processed} /{' '}
                {archiveImportProgress.total}): {archiveImportProgress.currentFileName}
              </span>
              <span>
                {archiveImportProgress.importedCount} imported ·{' '}
                {archiveImportProgress.skippedCount} skipped
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-emerald-950/15 dark:bg-emerald-400/20 overflow-hidden">
              <div
                className="h-full bg-ap-cobalt dark:bg-ap-volt transition-all duration-150"
                style={{
                  width: `${Math.min(
                    100,
                    Math.round(
                      (archiveImportProgress.processed / Math.max(1, archiveImportProgress.total)) *
                        100
                    )
                  )}%`,
                }}
              />
            </div>
          </div>
        )}
        {!archiveImportProgress && archiveImportBanner && (
          <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-2.5 flex items-center justify-between gap-3 text-xs font-medium text-emerald-800 dark:text-emerald-200">
            <span>{archiveImportBanner}</span>
            <button
              type="button"
              onClick={() => setArchiveImportBanner(null)}
              className="text-emerald-700 dark:text-emerald-300 hover:underline font-mono text-2xs"
            >
              Dismiss ×
            </button>
          </div>
        )}

        {/* Filtered Rollup Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-1 text-xs font-mono tabular-nums">
          <div className="rounded-xl liquid-glass-subtle px-3.5 py-2.5">
            <span className="text-slate-500 block font-sans">Workouts</span>
            <span className="text-base font-bold text-slate-900 dark:text-slate-100">
              {filteredActivities.length.toLocaleString()}
            </span>
          </div>
          <div className="rounded-xl liquid-glass-subtle px-3.5 py-2.5">
            <span className="text-slate-500 block font-sans">Distance</span>
            <span className="text-base font-bold text-slate-900 dark:text-slate-100">
              {formatDistance(summaryStats.totalDistanceMeters, distanceUnit, 1)}
            </span>
          </div>
          <div className="rounded-xl liquid-glass-subtle px-3.5 py-2.5">
            <span className="text-slate-500 block font-sans">Duration</span>
            <span className="text-base font-bold text-slate-900 dark:text-slate-100">
              {formatDuration(summaryStats.totalDurationSecs)}
            </span>
          </div>
          <div className="rounded-xl liquid-glass-subtle px-3.5 py-2.5">
            <span className="text-slate-500 block font-sans">Load</span>
            <span className="text-base font-bold text-blue-600 dark:text-sky-400">
              {summaryStats.totalLoad.toLocaleString()} TSS
            </span>
          </div>
          <div className="rounded-xl liquid-glass-subtle px-3.5 py-2.5 col-span-2 sm:col-span-1">
            <span className="text-slate-500 block font-sans">Avg EF</span>
            <span className="text-base font-bold text-emerald-600 dark:text-emerald-400">
              {summaryStats.avgEf}
            </span>
          </div>
        </div>

        {/* 4-Mode Tabbed Workspace Switcher (One Active Panel at a Time) */}
        <div className="pt-2 border-t border-slate-200/70 dark:border-white/10">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5 p-1 rounded-xl liquid-capsule-track">
            <button
              type="button"
              onClick={() => setActiveWorkspace('LOG')}
              className={`min-h-[38px] flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                activeWorkspace === 'LOG'
                  ? 'liquid-capsule-active text-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <span>Log</span>
              <span className="px-1.5 py-0.5 rounded-md bg-slate-200/80 dark:bg-slate-800 text-2xs font-mono">
                {filteredActivities.length.toLocaleString()}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveWorkspace('MAP_KUDOS')}
              className={`min-h-[38px] flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                activeWorkspace === 'MAP_KUDOS'
                  ? 'liquid-capsule-active ap-text-strava'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <ThumbsUp className="w-3.5 h-3.5" />
              <span>Map &amp; Kudos</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveWorkspace('SEGMENTS')}
              className={`min-h-[38px] flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                activeWorkspace === 'SEGMENTS'
                  ? 'liquid-capsule-active text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Trophy className="w-3.5 h-3.5" />
              <span>Segments</span>
              <span className="px-1.5 py-0.5 rounded-md bg-slate-200/80 dark:bg-slate-800 text-2xs font-mono">
                {repeatedSegmentsList.length}
              </span>
            </button>

            <button
              type="button"
              onClick={handleActivateSplitCompare}
              className={`min-h-[38px] flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                activeWorkspace === 'COMPARE'
                  ? 'liquid-capsule-active text-blue-600 dark:text-sky-300'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span>Compare</span>
            </button>
          </div>
        </div>
      </section>

      {/* ==========================================================================
          WORKSPACE 2: STRAVA KUDOS FEED & INTERACTIVE GPS ROUTE MAP EXPLORER
         ========================================================================== */}
      {activeWorkspace === 'MAP_KUDOS' && (
        <ActivitiesRoutesFeedPanel
          activities={activities}
          filteredActivities={filteredActivities}
          distanceUnit={distanceUnit}
          isHydratingRoutes={isHydratingRoutes}
          onHydrateMoreRoutes={onHydrateMoreRoutes}
          onSelectActivity={onSelectActivity}
          onToggleKudos={onToggleKudos}
          onAddComment={onAddComment}
        />
      )}

      {/* ==========================================================================
          WORKSPACE 3: SEGMENT 'EFFORT OVER TIME' MULTI-ATTEMPT PROGRESS CHART EXPLORER
         ========================================================================== */}
      {activeWorkspace === 'SEGMENTS' && (
        <SegmentEffortOverTimeChart
          segments={repeatedSegmentsList}
          selectedSegmentId={explorerSelectedSegmentId}
          onSelectSegmentId={setExplorerSelectedSegmentId}
          distanceUnit={distanceUnit}
          athleteWeightKg={athleteWeightKg}
          onSelectActivity={(actId) => {
            const found = activities.find((a) => a.id === actId);
            if (found) onSelectActivity(found);
          }}
          onScanMoreSegments={onScanMoreSegments}
          isScanningSegments={isScanningSegments}
          showSegmentPicker={true}
        />
      )}

      {/* ==========================================================================
          WORKSPACE 4: SPLIT-VIEW SIDE-BY-SIDE WORKOUT COMPARISON WORKSPACE
         ========================================================================== */}
      {activeWorkspace === 'COMPARE' && (
        <ActivitiesComparePanel
          activities={activities}
          filteredActivities={filteredActivities}
          distanceUnit={distanceUnit}
          athleteWeightKg={athleteWeightKg}
          isMobile={isMobile}
          compareIdA={compareIdA}
          compareIdB={compareIdB}
          setCompareIdA={setCompareIdA}
          setCompareIdB={setCompareIdB}
          compareActivityA={compareActivityA}
          compareActivityB={compareActivityB}
          onAssignToCompareSlot={handleAssignToCompareSlot}
          handleAutoMatchRepeatForA={handleAutoMatchRepeatForA}
          onCloseCompare={() => setActiveWorkspace('LOG')}
        />
      )}

      {/* ==========================================================================
          WORKSPACE 1: HIGH-DENSITY ACTIVITY LOG TABLE + MATCHED RUNS & RIDES CLUSTER
         ========================================================================== */}
      {activeWorkspace === 'LOG' && (
        <div className="space-y-4">
          {/* Strava-Style "Matched Runs & Rides" Longitudinal Route/Course Progression Panel */}
          {(() => {
            const clusterMap = new Map<
              string,
              {
                key: string;
                title: string;
                sport: SportCategory;
                environment: 'OUTDOOR' | 'INDOOR';
                avgDistMeters: number;
                attempts: UnifiedActivity[];
              }
            >();

            for (const act of filteredActivities) {
              const distBucketKm = Math.max(1, Math.round((act.distanceMeters || 0) / 2500) * 2.5);
              const cleanName = act.name
                .replace(/\b(morning|afternoon|evening|lunch|night)\b/gi, '')
                .replace(/\s+/g, ' ')
                .trim();
              const key = `${act.sportCategory}:${cleanName.toLowerCase()}:${distBucketKm}`;
              const existing = clusterMap.get(key);
              if (existing) {
                existing.attempts.push(act);
              } else {
                clusterMap.set(key, {
                  key,
                  title: cleanName || `${act.sportCategory} Loop`,
                  sport: act.sportCategory,
                  environment: act.environment,
                  avgDistMeters: act.distanceMeters || 0,
                  attempts: [act],
                });
              }
            }

            const clusters = Array.from(clusterMap.values())
              .filter((c) => c.attempts.length >= 2)
              .sort((a, b) => b.attempts.length - a.attempts.length)
              .slice(0, 8);

            if (clusters.length === 0) return null;

            const activeCluster =
              clusters.find((c) => c.key === selectedMatchedClusterKey) || clusters[0];
            const chronologicalAttempts = [...activeCluster.attempts]
              .slice(0, 8)
              .reverse();
            const bestEfAttempt = [...activeCluster.attempts].sort(
              (a, b) => (b.efficiencyFactor || 0) - (a.efficiencyFactor || 0)
            )[0];
            const latestAttempt = activeCluster.attempts[0];

            return (
              <details className="group rounded-2xl liquid-glass border border-stone-200/80 dark:border-slate-800">
                <summary className="list-none cursor-pointer px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3 select-none">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-[#D9480F] dark:text-[#FB6514]">
                      <Trophy className="w-3.5 h-3.5" />
                      <span>Matched Runs &amp; Rides</span>
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                      Repeated Course Efficiency ({clusters.length} Matched Loops)
                    </span>
                  </div>
                  <span className="text-xs font-mono font-semibold text-[#0284C7] dark:text-[#60A5FA]">
                    <span className="group-open:hidden">Expand Matched Loops ▾</span>
                    <span className="hidden group-open:inline">Hide Matched Loops ▴</span>
                  </span>
                </summary>
                <div className="px-4 sm:px-5 pb-4 pt-2 border-t border-stone-200/70 dark:border-slate-800 space-y-3.5">
                <div className="flex flex-wrap items-center justify-end gap-3">
                  {bestEfAttempt &&
                    latestAttempt &&
                    bestEfAttempt.id !== latestAttempt.id && (
                      <button
                        type="button"
                        onClick={() => {
                          setCompareIdA(latestAttempt.id);
                          setCompareIdB(bestEfAttempt.id);
                          setActiveWorkspace('COMPARE');
                        }}
                        className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-ap-cobalt hover:bg-ap-clay-dark text-white dark:bg-ap-volt dark:hover:bg-[#C8EF1E] dark:text-ap-obsidian text-xs font-semibold transition-colors"
                      >
                        <Columns2 className="w-3.5 h-3.5" />
                        <span>Compare Latest vs. Best Attempt in Split-View</span>
                      </button>
                    )}
                </div>

                {/* Matched Route Selector Pills */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {clusters.map((cl) => {
                    const isAct = cl.key === activeCluster.key;
                    return (
                      <button
                        key={cl.key}
                        type="button"
                        onClick={() => setSelectedMatchedClusterKey(cl.key)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all inline-flex items-center gap-1.5 ${
                          isAct
                            ? 'bg-[#C23800] text-white font-semibold shadow-2xs'
                            : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span className="truncate max-w-[180px]">{cl.title}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-2xs font-mono ${
                            isAct
                              ? 'bg-white/20 text-white'
                              : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                          }`}
                        >
                          {cl.attempts.length}x
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Attempt-Over-Attempt Progression Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-xs font-mono tabular-nums">
                  {chronologicalAttempts.map((att, idx) => {
                    const isBest = bestEfAttempt?.id === att.id;
                    const outStr =
                      att.sportCategory === 'Running' && att.avgPaceSecsPerKm
                        ? formatPace(att.avgPaceSecsPerKm, distanceUnit)
                        : `${att.normalizedPower || att.avgPower || att.trainingLoad}${
                            att.normalizedPower || att.avgPower ? 'W' : ' TSS'
                          }`;
                    return (
                      <button
                        key={att.id}
                        type="button"
                        onClick={() => onSelectActivity(att)}
                        className={`text-left rounded-xl p-2.5 border transition-all flex flex-col justify-between space-y-1 ${
                          isBest
                            ? 'border-amber-500/60 bg-amber-500/10'
                            : 'border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-ap-turf/60 hover:border-blue-500/50'
                        }`}
                      >
                        <div className="flex items-center justify-between text-2xs text-slate-500">
                          <span>#{idx + 1}</span>
                          <span>{att.startDateLocal.slice(5, 10)}</span>
                        </div>
                        <div className="font-bold text-slate-900 dark:text-slate-100 truncate">
                          {outStr}
                        </div>
                        <div className="flex items-center justify-between text-2xs">
                          <span className="text-rose-500">
                            {att.avgHr > 0 ? `${att.avgHr}bpm` : '—'}
                          </span>
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-bold">
                            {isBest ? (
                              <>
                                <Trophy className="w-3 h-3 text-amber-500" />
                                <span>Best EF</span>
                              </>
                            ) : (
                              `EF ${att.efficiencyFactor || '—'}`
                            )}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                </div>
              </details>
            );
          })()}

        <section className="rounded-2xl liquid-glass overflow-hidden">
        {filteredActivities.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              No workouts match your current Sport ({selectedSport}), Year ({yearFilter}), and Environment ({envFilter}) filters.
            </p>
            <button
              onClick={() => {
                onSelectSport('ALL');
                onSelectEnvFilter('COMBINED');
                setYearFilter('ALL');
                setSearchQuery('');
              }}
              className="min-h-[40px] px-4 py-2 rounded-lg bg-ap-cobalt text-white dark:bg-ap-volt dark:text-ap-obsidian text-xs font-medium"
            >
              Reset All Filters
            </button>
          </div>
        ) : (
          <div>
            {/* Mobile Stacked Cards (RT-23 / UX-09: zero 8-column horizontal clipping on phones) */}
            <div
              data-testid="activities-mobile-cards"
              className="md:hidden divide-y divide-slate-200 dark:divide-slate-800"
            >
              {filteredActivities.slice(0, visibleLimit).map((act) => {
                const isCompareA = compareIdA === act.id;
                const isCompareB = compareIdB === act.id;
                const isPaceSport = Boolean(
                  act.avgPaceSecsPerKm &&
                    (act.sportCategory === 'Running' ||
                      act.sportCategory === 'Swimming' ||
                      act.sportCategory === 'Multisport' ||
                      act.subType === 'Rowing' ||
                      act.subType === 'Hiking' ||
                      act.subType === 'Walking' ||
                      act.subType === 'Nordic Ski' ||
                      act.subType === 'Paddling & Water')
                );
                const outputSummary = isPaceSport && act.avgPaceSecsPerKm
                  ? formatMultiSportPace(
                      act.avgPaceSecsPerKm,
                      distanceUnit,
                      act.sportCategory,
                      act.subType
                    )
                  : act.normalizedPower
                    ? `NP ${act.normalizedPower}W`
                    : '—';
                return (
                  <div
                    key={`mob-${act.id}`}
                    className="p-3.5 space-y-2"
                  >
                    <button
                      type="button"
                      onClick={() => onSelectActivity(act)}
                      className="w-full text-left min-h-[44px] space-y-1.5 cursor-pointer rounded-lg"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm text-slate-900 dark:text-slate-100 leading-snug">
                            {act.name}
                          </div>
                          <div className="text-2xs font-mono text-slate-600 dark:text-slate-300 mt-0.5">
                            {act.startDateLocal.slice(0, 10)} · {act.sportCategory} ·{' '}
                            {act.environment === 'INDOOR' ? 'Indoor' : 'Outdoor'}
                          </div>
                        </div>
                        <span className="shrink-0 font-mono text-xs font-bold ap-ink-sky">
                          {act.trainingLoad} TSS
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 pt-1 text-2xs font-mono tabular-nums text-slate-700 dark:text-slate-200">
                        <div>
                          <span className="block text-slate-500 dark:text-slate-400">Dist / Time</span>
                          <span className="font-semibold">
                            {act.distanceMeters > 0
                              ? formatDistance(act.distanceMeters, distanceUnit, 1)
                              : formatDuration(act.movingTimeSecs)}
                          </span>
                        </div>
                        <div>
                          <span className="block text-slate-500 dark:text-slate-400">Output</span>
                          <span className="font-semibold">{outputSummary}</span>
                        </div>
                        <div className="text-right">
                          <span className="block text-slate-500 dark:text-slate-400">Avg HR</span>
                          <span className="font-semibold">
                            {act.avgHr > 0 ? `${act.avgHr} bpm` : '—'}
                          </span>
                        </div>
                      </div>
                    </button>
                    <div className="flex items-center justify-between gap-2 pt-1 text-2xs font-mono">
                      <span className="text-slate-500 dark:text-slate-400 truncate">
                        {act.sourceBadges.join(' + ')}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleAssignToCompareSlot(act, 'A')}
                          aria-label={`Set ${act.name} as Workout A`}
                          className={`ap-touch px-2.5 rounded text-xs font-mono font-bold cursor-pointer ${
                            isCompareA
                              ? 'bg-ap-cobalt text-white dark:bg-ap-volt dark:text-ap-obsidian'
                              : 'border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          A
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAssignToCompareSlot(act, 'B')}
                          aria-label={`Set ${act.name} as Workout B`}
                          className={`ap-touch px-2.5 rounded text-xs font-mono font-bold cursor-pointer ${
                            isCompareB
                              ? 'bg-amber-500 text-ap-obsidian'
                              : 'border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          B
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300">
                    <th scope="col" className="py-3 px-4">Date &amp; Session</th>
                    <th scope="col" className="py-3 px-3">Sport &amp; Environment</th>
                    <th scope="col" className="py-3 px-3 text-right">Distance / Time</th>
                    <th scope="col" className="py-3 px-3 text-right">Output (NP / Pace)</th>
                    <th scope="col" className="py-3 px-3 text-right">HR &amp; Decoupling</th>
                    <th scope="col" className="py-3 px-3 text-right">Load &amp; Plan Compliance</th>
                    <th scope="col" className="py-3 px-3 text-center">Split Compare</th>
                    <th scope="col" className="py-3 px-4 text-right">Source</th>
                  </tr>
                </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                {filteredActivities.slice(0, visibleLimit).map((act) => {
                  const isSelected = selectedActivity?.id === act.id;
                  const isCompareA = compareIdA === act.id;
                  const isCompareB = compareIdB === act.id;
                  return (
                    <tr
                      key={act.id}
                      tabIndex={0}
                      aria-label={`Inspect workout ${act.name} on ${act.startDateLocal.slice(0, 10)}`}
                      onClick={() => onSelectActivity(act)}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectActivity(act);
                        }
                      }}
                      className={`cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                        isSelected
                          ? 'bg-blue-50/70 dark:bg-blue-950/30'
                          : isCompareA
                            ? 'bg-blue-500/5'
                            : isCompareB
                              ? 'bg-amber-500/5'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-900/60'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 flex flex-wrap items-center gap-2">
                          <span>{act.name}</span>
                          {act.officialRaceData && (
                            <span
                              className={`text-xs font-mono font-bold ${
                                isHandTimedRaceData(act.officialRaceData, act)
                                  ? 'text-cyan-700 dark:text-cyan-400'
                                  : 'text-amber-600 dark:text-amber-400'
                              }`}
                            >
                              [{formatRaceTimingBadgeLabel(act.officialRaceData, act)}]
                            </span>
                          )}
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 mt-0.5 font-mono text-xs flex flex-wrap items-center gap-1.5">
                          <span>
                            {act.startDateLocal.slice(0, 10)} · {act.gearName || act.deviceName || act.subType}
                          </span>
                          {act.officialRaceData && act.officialRaceData.lapSplitsSecs.length > 0 && (
                            <span className="text-amber-600 dark:text-amber-400 font-semibold">
                              · Splits ({act.officialRaceData.lapSplitDistanceMeters || 400}m):{' '}
                              {act.officialRaceData.lapSplitsSecs.map((s) => s.toFixed(1) + 's').join(', ')}
                            </span>
                          )}
                          {act.segmentEfforts && act.segmentEfforts.length > 0 && (
                            <span className="text-blue-600 dark:text-blue-400 font-semibold">
                              · {act.segmentEfforts.length} segments
                            </span>
                          )}
                          {act.stravaPrCount > 0 && (
                            <span className="text-amber-600 dark:text-amber-400 font-bold">
                              · {act.stravaPrCount} PR{act.stravaPrCount > 1 ? 's' : ''}
                            </span>
                          )}
                          {(act.kudosCount || 0) > 0 && (
                            <span className="inline-flex items-center gap-1 ap-text-strava font-bold">
                              <span>·</span>
                              <ThumbsUp className="w-3 h-3" />
                              <span>{act.kudosCount}</span>
                            </span>
                          )}
                          {((Array.isArray(act.routeLatLngs) && act.routeLatLngs.length > 2) ||
                            (act.streams?.latlng && act.streams.latlng.length > 2)) && (
                            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold">
                              <span>·</span>
                              <MapPin className="w-3 h-3" />
                              <span>GPS</span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-300 text-xs">
                        <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                          {act.sportCategory}
                        </div>
                        <div className="mt-1">
                          {act.environment === 'INDOOR' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30 text-2xs font-mono font-semibold">
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                              <span>
                                {act.subType === 'Virtual Cycling' ||
                                /zwift|watopia|makuri|virtual|rouvy|mywhoosh|trainerroad/i.test(
                                  `${act.name} ${act.deviceName || ''}`
                                )
                                  ? 'Virtual · Zwift / Trainer'
                                  : `Indoor · ${act.subType}`}
                              </span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 text-2xs font-mono font-semibold">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              <span>Outdoor · {act.subType}</span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {act.distanceMeters > 0
                            ? formatDistance(act.distanceMeters, distanceUnit, 1)
                            : '—'}
                        </div>
                        <div className="text-slate-500 text-xs">
                          {formatDuration(act.movingTimeSecs)} · +{distanceUnit === 'mi' ? `${Math.round(act.elevationGainMeters * 3.28084).toLocaleString()}ft` : `${act.elevationGainMeters}m`}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {act.avgPaceSecsPerKm &&
                        (act.sportCategory === 'Running' ||
                          act.sportCategory === 'Swimming' ||
                          act.sportCategory === 'Multisport' ||
                          act.subType === 'Rowing' ||
                          act.subType === 'Hiking' ||
                          act.subType === 'Walking' ||
                          act.subType === 'Nordic Ski' ||
                          act.subType === 'Paddling & Water') ? (
                          <>
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {formatMultiSportPace(
                                act.avgPaceSecsPerKm,
                                distanceUnit,
                                act.sportCategory,
                                act.subType
                              )}
                            </div>
                            <div className="text-slate-500 text-xs">
                              {act.normalizedPower
                                ? `${act.normalizedPower}W`
                                : act.sportCategory === 'Running' && act.gapPaceSecsPerKm
                                  ? `GAP ${formatPace(act.gapPaceSecsPerKm, distanceUnit)}`
                                  : act.subType || act.sportCategory}
                            </div>
                          </>
                        ) : act.normalizedPower ? (
                          <>
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              NP {act.normalizedPower}W
                            </div>
                            <div className="text-slate-500 text-xs">
                              Avg {act.avgPower}W · IF {act.intensityFactor?.toFixed(2) || '—'}
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        <div className="text-slate-900 dark:text-slate-100">
                          {act.avgHr > 0 ? `${act.avgHr} / ${act.maxHr} bpm` : '—'}
                        </div>
                        {act.efficiencyFactor > 0 && (
                          <div className="text-emerald-600 dark:text-emerald-400 text-xs">
                            EF {act.efficiencyFactor} · Drift {act.aerobicDecouplingPct}%
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        <div className="font-bold text-[#0284C7] dark:text-[#60A5FA]">
                          {act.trainingLoad} TSS
                        </div>
                        {(() => {
                          const dayPlans = plannedByDate.get(act.startDateLocal.slice(0, 10)) || [];
                          const matchedPlan =
                            dayPlans.find((p) => p.sportCategory === act.sportCategory) ||
                            dayPlans[0];
                          if (!matchedPlan || !matchedPlan.plannedLoad || matchedPlan.plannedLoad <= 0) {
                            return (
                              <span
                                className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-2xs font-medium text-slate-500 dark:text-slate-400 bg-stone-100 dark:bg-slate-800/80"
                                title="No scheduled calendar workout on this date"
                              >
                                Unscheduled
                              </span>
                            );
                          }
                          const adherence = Math.max(
                            0,
                            Math.min(
                              100,
                              Math.round(
                                (1 -
                                  Math.abs(act.trainingLoad - matchedPlan.plannedLoad) /
                                    Math.max(25, matchedPlan.plannedLoad)) *
                                  100
                              )
                            )
                          );
                          return (
                            <span
                              className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-2xs font-bold ${
                                adherence >= 85 ? 'ap-status-prime' : 'ap-status-caution'
                              }`}
                              title={`Scheduled: "${matchedPlan.name}" (${matchedPlan.plannedLoad} TSS)`}
                            >
                              {adherence}% vs Plan
                            </span>
                          );
                        })()}
                      </td>
                      <td
                        className="py-3 px-3 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleAssignToCompareSlot(act, 'A')}
                            title="Set as Workout A in Split-View Comparison"
                            className={`min-h-[28px] min-w-[28px] px-2 py-0.5 rounded text-xs font-mono font-bold transition-colors ${
                              isCompareA
                                ? 'bg-ap-cobalt text-white dark:bg-ap-volt dark:text-ap-obsidian'
                                : 'border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-blue-500 hover:text-blue-500'
                            }`}
                          >
                            A
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAssignToCompareSlot(act, 'B')}
                            title="Set as Workout B in Split-View Comparison"
                            className={`min-h-[28px] min-w-[28px] px-2 py-0.5 rounded text-xs font-mono font-bold transition-colors ${
                              isCompareB
                                ? 'bg-amber-500 text-ap-obsidian'
                                : 'border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-amber-500 hover:text-amber-500'
                            }`}
                          >
                            B
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-500">
                        {act.sourceBadges.join(' + ')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>

            {filteredActivities.length > visibleLimit && (
              <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-center">
                <button
                  onClick={() => setVisibleLimit((prev) => prev + 100)}
                  className="min-h-[38px] px-5 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors"
                >
                  Load More Workouts ({visibleLimit} of {filteredActivities.length.toLocaleString()} shown)
                </button>
              </div>
            )}
          </div>
        )}
        </section>
      </div>
      )}
        </>
      )}

      <ActivityInspectorModal
        selectedActivity={selectedActivity}
        activities={activities}
        distanceUnit={distanceUnit}
        athleteWeightKg={athleteWeightKg}
        athleteProfile={athleteProfile}
        compareIdB={compareIdB}
        onSelectActivity={onSelectActivity}
        onLoadActivityStreams={onLoadActivityStreams}
        onScanMoreSegments={onScanMoreSegments}
        isScanningSegments={isScanningSegments}
        onToggleKudos={onToggleKudos}
        onAddComment={onAddComment}
        isWorkerProcessing={isWorkerProcessing}
        workerAnalytics={workerAnalytics}
        liveDexieStream={liveDexieStream}
        activeSelectedStream={activeSelectedStream}
        onTriggerWorker1HzUpsample={handleTriggerWorker1HzUpsample}
        onAssignToCompareSlot={handleAssignToCompareSlot}
        similarHistoricalWorkouts={similarHistoricalWorkouts}
        segmentHistoryBySegmentId={segmentHistoryBySegmentId}
        repeatedSegmentsList={repeatedSegmentsList}
      />
    </div>
  );
};

export const ActivitiesView = React.memo(ActivitiesViewInner);
