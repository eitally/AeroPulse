import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  formatPace,
  formatStopwatch,
} from '../utils/formatters';
import { InteractiveRouteMap } from './InteractiveRouteMap';
import {
  buildRepeatedSegmentsFromActivities,
  SegmentEffortOverTimeChart,
} from './SegmentEffortOverTimeChart';
import { ChartInfoTooltip } from './ChartInfoTooltip';
import { UPlotStreamChart } from './charts/UPlotStreamChart';
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
  athleteWeightKg?: number;
  athleteProfile?: AthleteProfile;
}

interface NormalizedSeriesPoint {
  timeSecs: number;
  pct: number;
  power?: number;
  hr?: number;
  paceSecsPerKm?: number;
  cadence?: number;
}

// Build a 100-sample series from an activity's real stream (or deterministic physiological curve if stream is still loading/unrecorded)
function extractActivitySeries(
  activity: UnifiedActivity,
  smoothWindow = 3
): { points: NormalizedSeriesPoint[]; isRealStream: boolean } {
  const streams = activity.streams;
  if (streams && Array.isArray(streams.time) && streams.time.length > 2) {
    const len = streams.time.length;
    const maxTime = Math.max(1, streams.time[len - 1] || activity.movingTimeSecs || 3600);
    const rawWatts = streams.watts;
    const rawVel = streams.velocitySmooth;
    const rawHr = streams.heartrate;
    const rawCad = streams.cadence;

    const smoothAt = (arr: number[] | undefined, idx: number): number | undefined => {
      if (!arr || arr[idx] === undefined) return undefined;
      if (smoothWindow <= 1) return Math.round(arr[idx]);
      let sum = 0;
      let count = 0;
      const half = Math.floor(smoothWindow / 2);
      for (let i = Math.max(0, idx - half); i <= Math.min(arr.length - 1, idx + half); i++) {
        if (arr[i] != null && !Number.isNaN(arr[i])) {
          sum += arr[i];
          count++;
        }
      }
      return count > 0 ? Math.round(sum / count) : Math.round(arr[idx]);
    };

    const points: NormalizedSeriesPoint[] = streams.time.map((t, idx) => {
      const w = smoothAt(rawWatts, idx);
      const hr = smoothAt(rawHr, idx);
      const cad = smoothAt(rawCad, idx);
      const vel = rawVel && rawVel[idx] != null ? rawVel[idx] : undefined;
      const eqWatts =
        w !== undefined
          ? w
          : vel !== undefined && vel > 0
            ? Math.round(vel * 78)
            : undefined;
      const paceSecs = vel !== undefined && vel > 0.4 ? Math.round(1000 / vel) : undefined;
      return {
        timeSecs: Math.round(t),
        pct: Math.min(100, Math.max(0, (t / maxTime) * 100)),
        power: eqWatts,
        hr,
        paceSecsPerKm: paceSecs,
        cadence: cad,
      };
    });

    return { points, isRealStream: true };
  }

  // Honest empty series when an activity has no recorded 1Hz / coarse stream arrays
  return { points: [], isRealStream: false };
}

// Interpolate a series at a given X position (either elapsed seconds or 0-100% progress)
function sampleSeriesAt(
  points: NormalizedSeriesPoint[],
  mode: 'TIME' | 'PERCENT',
  targetVal: number
): NormalizedSeriesPoint | null {
  if (points.length === 0) return null;
  const maxVal =
    mode === 'TIME' ? points[points.length - 1].timeSecs : points[points.length - 1].pct;
  if (mode === 'TIME' && targetVal > maxVal) {
    return null; // Workout already finished before this elapsed second
  }

  let best = points[0];
  let bestDist = Infinity;
  for (const pt of points) {
    const val = mode === 'TIME' ? pt.timeSecs : pt.pct;
    const d = Math.abs(val - targetVal);
    if (d < bestDist) {
      bestDist = d;
      best = pt;
    }
  }
  return best;
}

export const ActivitiesView: React.FC<ActivitiesViewProps> = ({
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
  athleteWeightKg = 72.5,
  athleteProfile,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [yearFilter, setYearFilter] = useState<string>('ALL');
  const [visibleLimit, setVisibleLimit] = useState<number>(60);
  const [streamHoverIndex, setStreamHoverIndex] = useState<number | null>(null);
  const [streamZoomRange, setStreamZoomRange] = useState<[number, number] | null>(null);
  const [debriefZoomWindow, setDebriefZoomWindow] = useState<{
    startSec: number;
    endSec: number;
    nonce: number;
  } | null>(null);
  const [archiveImportProgress, setArchiveImportProgress] =
    useState<ArchiveImportProgress | null>(null);
  const [archiveImportBanner, setArchiveImportBanner] = useState<string | null>(null);
  const [quickLogsById, setQuickLogsById] = useState<Record<string, WorkoutQuickLog>>(() => {
    try {
      const raw = localStorage.getItem('thresh_quick_logs_v1');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [quickLogSavedMsg, setQuickLogSavedMsg] = useState<string | null>(null);

  const saveQuickLogForActivity = (actId: string, patch: Partial<WorkoutQuickLog>) => {
    setQuickLogsById((prev) => {
      const existing = prev[actId] || {
        rpe: 6,
        feelRating: 'NORMAL' as const,
        carbsGramsPerHour: 60,
        sodiumMgPerHour: 500,
        gearName: '',
        loggedAt: new Date().toISOString(),
      };
      const updated: WorkoutQuickLog = {
        ...existing,
        ...patch,
        loggedAt: new Date().toISOString(),
      };
      const next = { ...prev, [actId]: updated };
      try {
        localStorage.setItem('thresh_quick_logs_v1', JSON.stringify(next));
      } catch {
        // ignore quota errors
      }
      return next;
    });
    setQuickLogSavedMsg('Saved to Durability & Fueling ledger');
    window.setTimeout(() => setQuickLogSavedMsg(null), 2600);
  };
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
  const [hrZoneHoverIdx, setHrZoneHoverIdx] = useState<number | null>(null);
  const [showAutoZoneInsight, setShowAutoZoneInsight] = useState<boolean>(true);
  const [zoneArchetypeOverride, setZoneArchetypeOverride] = useState<
    'AUTO' | 'RECOVERY' | 'ENDURANCE' | 'TEMPO_SWEETSPOT' | 'THRESHOLD' | 'VO2MAX_RACE'
  >('AUTO');
  const [modalSelectedSegmentId, setModalSelectedSegmentId] = useState<string | null>(null);
  const [explorerSelectedSegmentId, setExplorerSelectedSegmentId] = useState<string | null>(null);

  // Unified 4-Mode Tabbed Workspace Switcher (one panel active at a time)
  const [activeWorkspace, setActiveWorkspace] = useState<
    'LOG' | 'MAP_KUDOS' | 'SEGMENTS' | 'COMPARE'
  >('LOG');

  // Strava Kudos Feed & Interactive Map Explorer State
  const [kudosFeedFilter, setKudosFeedFilter] = useState<
    'ALL' | 'WITH_KUDOS' | 'PR_HUNTS' | 'WITH_GPS'
  >('ALL');
  const [hoveredRouteActivityId, setHoveredRouteActivityId] = useState<string | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [modalCommentInput, setModalCommentInput] = useState<string>('');

  // Split-View Comparison Mode State
  const [compareIdA, setCompareIdA] = useState<string | null>(null);
  const [compareIdB, setCompareIdB] = useState<string | null>(null);
  const [compareXMode, setCompareXMode] = useState<'PERCENT' | 'TIME'>('PERCENT');
  const [smoothStreams, setSmoothStreams] = useState<boolean>(true);
  const [compareHoverStep, setCompareHoverStep] = useState<number | null>(null);
  const [selectedMatchedClusterKey, setSelectedMatchedClusterKey] = useState<string | null>(null);

  // Web Worker & Dexie Live Stream State
  const [isWorkerProcessing, setIsWorkerProcessing] = useState<boolean>(false);
  const [workerAnalytics, setWorkerAnalytics] = useState<ComputedStreamAnalytics | null>(null);
  const [recoveredIntervalsByActivityId, setRecoveredIntervalsByActivityId] = useState<
    Record<string, ActivityInterval[]>
  >({});
  const [intervalRecoveryNote, setIntervalRecoveryNote] = useState<string | null>(null);
  const liveDexieStream = useLiveActivityStream(selectedActivity?.id || null);
  const dexieStats = useLiveWorkoutStoreStats();
  const importMenuDetailsRef = useRef<HTMLDetailsElement | null>(null);

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
    setDebriefZoomWindow(null);
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
        'Thresh-1Hz-Threshold-Telemetry.gpx'
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
      return;
    }
    if (slot === 'B') {
      setCompareIdB(act.id);
      setActiveWorkspace('COMPARE');
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
        sportCategory: 'Cycling' | 'Running';
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
            sportCategory: act.sportCategory === 'Running' ? 'Running' : 'Cycling',
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

  // Whenever selectedActivity changes or its segmentEfforts load, auto-select the most-repeated segment on this activity
  useEffect(() => {
    if (!selectedActivity?.segmentEfforts || selectedActivity.segmentEfforts.length === 0) {
      setModalSelectedSegmentId(null);
      return;
    }
    const repeatedOnAct = Array.from(
      new Map(
        selectedActivity.segmentEfforts
          .map((eff) => segmentHistoryBySegmentId.get(String(eff.segmentId || eff.name)))
          .filter((s): s is NonNullable<typeof s> => Boolean(s && s.efforts.length >= 2))
          .map((s) => [s.segmentId, s] as const)
      ).values()
    ).sort((a, b) => b.efforts.length - a.efforts.length);

    if (repeatedOnAct.length > 0) {
      setModalSelectedSegmentId((prev) =>
        prev && repeatedOnAct.some((r) => r.segmentId === prev)
          ? prev
          : repeatedOnAct[0].segmentId
      );
    } else {
      setModalSelectedSegmentId(null);
    }
  }, [selectedActivity?.id, selectedActivity?.segmentEfforts, segmentHistoryBySegmentId]);

  // Reset stream zoom range and archetype override when switching selectedActivity
  useEffect(() => {
    setStreamZoomRange(null);
    setStreamHoverIndex(null);
    setZoneArchetypeOverride('AUTO');
  }, [selectedActivity?.id]);

  // Helper to zoom stream chart to a specific elapsed time window [startSecs, endSecs]
  const zoomStreamToTimeWindow = (startSecs: number, endSecs: number) => {
    const timeArr = (liveDexieStream?.streams || selectedActivity?.streams)?.time;
    if (!timeArr || timeArr.length < 2) return;
    let sIdx = 0;
    let eIdx = timeArr.length - 1;
    for (let i = 0; i < timeArr.length; i++) {
      if (timeArr[i] <= startSecs) sIdx = i;
      if (timeArr[i] <= endSecs) eIdx = i;
    }
    if (eIdx - sIdx < 3) {
      eIdx = Math.min(timeArr.length - 1, sIdx + 4);
      sIdx = Math.max(0, eIdx - 4);
    }
    setStreamZoomRange([sIdx, eIdx]);
  };

  // Helper to locate Peak N-second window in the stream and zoom directly to it
  const zoomStreamToPeakDuration = (windowSecs: number) => {
    const streams = liveDexieStream?.streams || selectedActivity?.streams;
    if (!streams || !streams.time || streams.time.length < 4) return;
    const timeArr = streams.time;
    const valArr =
      streams.watts && streams.watts.length > 0
        ? streams.watts
        : streams.velocitySmooth && streams.velocitySmooth.length > 0
          ? streams.velocitySmooth.map((v) => v * 80)
          : streams.heartrate || [];
    if (valArr.length === 0) return;

    let bestStart = 0;
    let bestEnd = Math.min(timeArr.length - 1, 6);
    let bestMean = -1;

    for (let i = 0; i < timeArr.length; i++) {
      const targetEndSecs = timeArr[i] + windowSecs;
      let j = i;
      let sum = 0;
      let count = 0;
      while (j < timeArr.length && timeArr[j] <= targetEndSecs) {
        if (valArr[j] != null && !Number.isNaN(valArr[j])) {
          sum += valArr[j];
          count++;
        }
        j++;
      }
      if (j - 1 > i && count >= 2 && timeArr[j - 1] - timeArr[i] >= windowSecs * 0.65) {
        const mean = sum / count;
        if (mean > bestMean) {
          bestMean = mean;
          bestStart = i;
          bestEnd = j - 1;
        }
      }
    }

    // Add a small 15% context pad around the peak effort so the lead-in and recovery are visible
    const span = Math.max(4, bestEnd - bestStart);
    const pad = Math.max(2, Math.round(span * 0.15));
    const paddedStart = Math.max(0, bestStart - pad);
    const paddedEnd = Math.min(timeArr.length - 1, bestEnd + pad);
    setStreamZoomRange([paddedStart, paddedEnd]);
  };

  // Compute aligned 100-step overlaid comparison data for Workout A and Workout B
  const overlaidComparisonData = useMemo(() => {
    if (!compareActivityA || !compareActivityB) return null;
    const win = smoothStreams ? 5 : 1;
    const seriesA = extractActivitySeries(compareActivityA, win);
    const seriesB = extractActivitySeries(compareActivityB, win);

    const maxDurationSecs = Math.max(
      compareActivityA.movingTimeSecs || 1,
      compareActivityB.movingTimeSecs || 1,
      seriesA.points[seriesA.points.length - 1]?.timeSecs || 1,
      seriesB.points[seriesB.points.length - 1]?.timeSecs || 1
    );

    const stepsCount = 100;
    const alignedSteps = Array.from({ length: stepsCount }, (_, idx) => {
      const frac = idx / (stepsCount - 1);
      const xVal = compareXMode === 'PERCENT' ? frac * 100 : Math.round(frac * maxDurationSecs);
      const ptA = sampleSeriesAt(seriesA.points, compareXMode, xVal);
      const ptB = sampleSeriesAt(seriesB.points, compareXMode, xVal);
      return {
        stepIndex: idx,
        frac,
        xLabel:
          compareXMode === 'PERCENT'
            ? `${Math.round(frac * 100)}%`
            : formatStopwatch(Math.round(frac * maxDurationSecs)),
        timeSecsA: ptA?.timeSecs,
        timeSecsB: ptB?.timeSecs,
        powerA: ptA?.power,
        powerB: ptB?.power,
        hrA: ptA?.hr,
        hrB: ptB?.hr,
        cadenceA: ptA?.cadence,
        cadenceB: ptB?.cadence,
      };
    });

    const allPowers = alignedSteps
      .flatMap((s) => [s.powerA, s.powerB])
      .filter((v): v is number => v !== undefined && v > 0);
    const maxPower = Math.max(320, ...allPowers, 100);

    const allHrs = alignedSteps
      .flatMap((s) => [s.hrA, s.hrB])
      .filter((v): v is number => v !== undefined && v > 0);
    const minHr = allHrs.length > 0 ? Math.max(60, Math.min(...allHrs) - 10) : 85;
    const maxHr = allHrs.length > 0 ? Math.max(175, Math.max(...allHrs) + 8) : 195;

    return {
      alignedSteps,
      maxDurationSecs,
      maxPower,
      minHr,
      maxHr,
      isRealStreamA: seriesA.isRealStream,
      isRealStreamB: seriesB.isRealStream,
    };
  }, [compareActivityA, compareActivityB, compareXMode, smoothStreams]);

  return (
    <div className="space-y-6">
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
            <div className="ap-toolbar-scroll p-1 rounded-xl liquid-capsule-track max-w-full">
              {(['ALL', 'Cycling', 'Running', 'Swimming', 'Strength'] as const).map((sport) => (
                <button
                  key={sport}
                  onClick={() => onSelectSport(sport)}
                  className={`min-h-[30px] px-2.5 py-1 text-xs rounded-lg transition-all whitespace-nowrap ${
                    selectedSport === sport
                      ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 font-medium'
                  }`}
                >
                  {sport === 'ALL' ? 'All Sports' : sport}
                </button>
              ))}
            </div>

            {/* Explicit Modality Filter: All vs Outdoor vs Virtual / Smart Trainer */}
            <div className="ap-toolbar-scroll p-1 rounded-xl liquid-capsule-track text-xs max-w-full">
              {(
                [
                  { id: 'COMBINED', label: 'All', count: modalityCounts.all },
                  { id: 'OUTDOOR', label: 'Outdoor', count: modalityCounts.outdoor },
                  { id: 'INDOOR', label: 'Virtual', count: modalityCounts.indoor },
                ] as const
              ).map((mod) => (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => {
                    onSelectEnvFilter(mod.id);
                    setVisibleLimit(60);
                  }}
                  className={`min-h-[30px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all whitespace-nowrap ${
                    envFilter === mod.id
                      ? mod.id === 'INDOOR'
                        ? 'liquid-capsule-active text-indigo-600 dark:text-indigo-300 font-semibold'
                        : mod.id === 'OUTDOOR'
                          ? 'liquid-capsule-active text-emerald-600 dark:text-emerald-300 font-semibold'
                          : 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 font-medium'
                  }`}
                >
                  <span>{mod.label}</span>
                  <span className="px-1.5 py-0.2 rounded bg-slate-200/70 dark:bg-slate-800/90 text-[10px] font-mono">
                    {mod.count}
                  </span>
                </button>
              ))}
            </div>

            <select
              value={yearFilter}
              onChange={(e) => {
                setYearFilter(e.target.value);
                setVisibleLimit(60);
              }}
              className="min-h-[36px] rounded-xl liquid-glass-subtle px-3 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
            >
              <option value="ALL">All Years ({activities.length})</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>

            <div className="relative flex-1 sm:flex-initial w-full sm:w-56 min-w-[180px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search workouts, routes..."
                className="w-full min-h-[36px] rounded-xl liquid-glass-subtle pl-8 pr-3 py-1 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Consolidated + Import & Actions Dropdown Menu */}
            <div className="relative">
              <details ref={importMenuDetailsRef} className="group">
                <summary className="list-none cursor-pointer min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/35 text-xs font-bold text-blue-700 dark:text-sky-300 transition-colors whitespace-nowrap select-none">
                  <Upload className="w-3.5 h-3.5 text-blue-500" />
                  <span>{isWorkerProcessing ? 'Parsing...' : '+ Import ▾'}</span>
                </summary>
                <div className="absolute right-0 mt-2 w-64 rounded-2xl liquid-glass border border-slate-300/80 dark:border-white/15 shadow-2xl p-2 z-40 space-y-1 text-xs">
                  <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    Import &amp; Telemetry Actions
                  </div>

                  <label className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-slate-200/60 dark:hover:bg-white/10 text-slate-800 dark:text-slate-100 font-medium cursor-pointer transition-colors">
                    <Upload className="w-4 h-4 text-cyan-500 shrink-0" />
                    <div className="flex-1">
                      <div className="font-semibold">
                        Import .FIT / .GPX / .TCX or Bulk .ZIP Archive
                      </div>
                      <div className="text-[10px] text-slate-500">
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
                        <div className="text-[10px] text-slate-500">Track, XC, or road chip times</div>
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
                        <div className="text-[10px] text-slate-500">Index PRs &amp; repeated climbs</div>
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
                        <div className="text-[10px] text-slate-500">Backfill outdoor route polylines</div>
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
                      <span className="text-[11px]">Load Sample 1Hz Workout</span>
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
            <div className="h-1.5 w-full rounded-full bg-blue-500/20 overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-150"
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
              className="text-emerald-700 dark:text-emerald-300 hover:underline font-mono text-[11px]"
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
              <span className="px-1.5 py-0.5 rounded-md bg-slate-200/80 dark:bg-slate-800 text-[10px] font-mono">
                {filteredActivities.length.toLocaleString()}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveWorkspace('MAP_KUDOS')}
              className={`min-h-[38px] flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                activeWorkspace === 'MAP_KUDOS'
                  ? 'liquid-capsule-active text-[#FC4C02]'
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
              <span className="px-1.5 py-0.5 rounded-md bg-slate-200/80 dark:bg-slate-800 text-[10px] font-mono">
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
        <section className="rounded-2xl liquid-glass p-5 space-y-5">
          {(() => {
            const totalKudosEarned = filteredActivities.reduce(
              (acc, a) => acc + (a.kudosCount || 0),
              0
            );
            const totalPrAchievements = filteredActivities.reduce(
              (acc, a) => acc + (a.stravaPrCount || 0),
              0
            );
            const mappedActivitiesCount = filteredActivities.filter(
              (a) =>
                (Array.isArray(a.routeLatLngs) && a.routeLatLngs.length > 2) ||
                (a.streams?.latlng && a.streams.latlng.length > 2)
            ).length;

            const feedActivities = filteredActivities
              .filter((act) => {
                if (kudosFeedFilter === 'WITH_KUDOS') {
                  return (act.kudosCount || 0) > 0 || Boolean(act.hasKudoed);
                }
                if (kudosFeedFilter === 'PR_HUNTS') {
                  return (
                    (act.stravaPrCount || 0) > 0 ||
                    Boolean(
                      act.segmentEfforts &&
                        act.segmentEfforts.some(
                          (e) => e.prRank === 1 || e.prRank === 2 || e.prRank === 3
                        )
                    )
                  );
                }
                if (kudosFeedFilter === 'WITH_GPS') {
                  return (
                    (Array.isArray(act.routeLatLngs) && act.routeLatLngs.length > 2) ||
                    Boolean(act.streams?.latlng && act.streams.latlng.length > 2) ||
                    act.environment === 'OUTDOOR'
                  );
                }
                return true;
              })
              .slice(0, 18);

            return (
              <>
                {/* Top Header & Kudos Rollup Strip */}
                <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-200 dark:border-slate-800">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-[#FC4C02] text-white">
                        <ThumbsUp className="w-3.5 h-3.5" />
                      </span>
                      <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                        Strava Kudos Feed &amp; Interactive GPS Route Map Explorer
                      </h2>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Explore outdoor GPS tracks on the interactive map, inspect Strava Kudos &amp; segment PR crowns, give kudos, or click any route to launch the full telemetry &amp; route scrubber
                    </p>
                  </div>

                  {/* Kudos & Route Rollup Pills + Feed Filter */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center gap-3 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-mono">
                      <span className="text-[#FC4C02] font-bold">
                        👍 {totalKudosEarned.toLocaleString()} Kudos
                      </span>
                      <span className="text-slate-300 dark:text-slate-700">|</span>
                      <span className="text-amber-600 dark:text-amber-400 font-bold">
                        🏆 {totalPrAchievements.toLocaleString()} PRs
                      </span>
                      <span className="text-slate-300 dark:text-slate-700">|</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                        🗺️ {mappedActivitiesCount} GPS Routes
                      </span>
                    </div>

                    <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
                      {(
                        [
                          { id: 'ALL', label: 'All Recent' },
                          { id: 'WITH_KUDOS', label: 'Most Kudoed' },
                          { id: 'PR_HUNTS', label: 'Segment PRs' },
                          { id: 'WITH_GPS', label: 'Outdoor GPS' },
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setKudosFeedFilter(tab.id)}
                          className={`min-h-[28px] px-2.5 py-0.5 rounded-md font-semibold transition-colors whitespace-nowrap ${
                            kudosFeedFilter === tab.id
                              ? 'bg-[#FC4C02] text-white'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 12-Column Split: Left 7 Cols Interactive Multi-Route Map, Right 5 Cols Strava Kudos Feed */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                  {/* Left 7 Columns: Interactive Multi-Workout GPS Route Map */}
                  <div className="lg:col-span-7 space-y-2">
                    <InteractiveRouteMap
                      mode="MULTI"
                      activities={filteredActivities}
                      distanceUnit={distanceUnit}
                      highlightedActivityId={hoveredRouteActivityId}
                      onHoverActivity={setHoveredRouteActivityId}
                      onSelectActivity={(act) => {
                        onSelectActivity(act);
                        setStreamHoverIndex(null);
                      }}
                      heightClass="h-[460px] sm:h-[540px]"
                    />
                    {onHydrateMoreRoutes && (
                      <div className="flex items-center justify-between gap-2 px-1">
                        <span className="text-xs text-slate-500">
                          Want more historical outdoor routes plotted on the map?
                        </span>
                        <button
                          type="button"
                          onClick={onHydrateMoreRoutes}
                          disabled={isHydratingRoutes}
                          className="min-h-[30px] px-3 py-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50 text-xs font-semibold text-emerald-700 dark:text-emerald-300 transition-colors whitespace-nowrap"
                        >
                          {isHydratingRoutes
                            ? 'Loading +40 GPS Tracks...'
                            : 'Load +40 More Historical GPS Routes'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Right 5 Columns: Strava Kudos & Activity Social Feed */}
                  <div className="lg:col-span-5 space-y-3 max-h-[580px] overflow-y-auto pr-1">
                    {feedActivities.length === 0 ? (
                      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center text-xs text-slate-500">
                        No workouts match the selected Kudos Feed filter. Switch back to &quot;All Recent&quot; to browse all workouts.
                      </div>
                    ) : (
                      feedActivities.map((act) => {
                        const hasGps =
                          (Array.isArray(act.routeLatLngs) && act.routeLatLngs.length > 2) ||
                          Boolean(act.streams?.latlng && act.streams.latlng.length > 2);
                        const isHovered = hoveredRouteActivityId === act.id;
                        const kudoers = act.kudoers || [];
                        const comments = act.comments || [];
                        const kudosTotal = Math.max(act.kudosCount || 0, kudoers.length);
                        const topSegments = (act.segmentEfforts || []).slice(0, 3);
                        const commentDraft = commentDrafts[act.id] || '';

                        return (
                          <div
                            key={act.id}
                            onMouseEnter={() => setHoveredRouteActivityId(act.id)}
                            onMouseLeave={() =>
                              setHoveredRouteActivityId((curr) => (curr === act.id ? null : curr))
                            }
                            className={`rounded-xl border p-4 space-y-3 transition-all ${
                              isHovered
                                ? 'border-[#FC4C02] bg-[#FC4C02]/5 shadow-md'
                                : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                          >
                            {/* Card Header: Sport Badge, Workout Name, Date, Strava External Link */}
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-slate-500">
                                  <span
                                    className={`px-1.5 py-0.5 rounded font-sans font-bold text-[10px] uppercase ${
                                      act.sportCategory === 'Running'
                                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                        : 'bg-[#FC4C02]/15 text-[#FC4C02]'
                                    }`}
                                  >
                                    {act.sportCategory}
                                  </span>
                                  <span>{act.startDateLocal.slice(0, 10)}</span>
                                  <span>·</span>
                                  <span>{act.gearName || act.subType}</span>
                                  {hasGps && (
                                    <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                                      <MapPin className="w-3 h-3" />
                                      GPS
                                    </span>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => onSelectActivity(act)}
                                  className="text-left text-sm font-bold text-slate-900 dark:text-slate-100 hover:text-[#FC4C02] dark:hover:text-[#FC4C02] transition-colors mt-0.5 line-clamp-1"
                                >
                                  {act.name}
                                </button>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {act.stravaId && (
                                  <a
                                    href={`https://www.strava.com/activities/${encodeURIComponent(
                                      act.stravaId
                                    )}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#FC4C02]/40 bg-[#FC4C02]/10 hover:bg-[#FC4C02]/20 text-[11px] font-semibold text-[#FC4C02] transition-colors whitespace-nowrap"
                                    title="Open activity on Strava.com"
                                  >
                                    <span>Strava</span>
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                                <button
                                  type="button"
                                  onClick={() => onSelectActivity(act)}
                                  className="px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold transition-colors whitespace-nowrap"
                                >
                                  Inspect Map &amp; Streams
                                </button>
                              </div>
                            </div>

                            {/* Key Workout Telemetry Strip */}
                            <div className="grid grid-cols-4 gap-2 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 rounded-lg p-2.5 border border-slate-200/80 dark:border-slate-800">
                              <div>
                                <div className="text-[10px] font-sans text-slate-500">Distance</div>
                                <div className="font-bold text-slate-900 dark:text-slate-100">
                                  {act.distanceMeters > 0
                                    ? formatDistance(act.distanceMeters, distanceUnit, 1)
                                    : 'Indoor'}
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] font-sans text-slate-500">Duration</div>
                                <div className="font-bold text-slate-900 dark:text-slate-100">
                                  {formatDuration(act.movingTimeSecs)}
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] font-sans text-slate-500">
                                  {act.sportCategory === 'Running' ? 'Avg Pace' : 'NP / Watts'}
                                </div>
                                <div className="font-bold text-blue-600 dark:text-blue-400">
                                  {act.sportCategory === 'Running' && act.avgPaceSecsPerKm
                                    ? formatPace(act.avgPaceSecsPerKm, distanceUnit)
                                    : act.normalizedPower
                                      ? `${act.normalizedPower}W`
                                      : act.avgPower
                                        ? `${act.avgPower}W`
                                        : `${act.trainingLoad} TSS`}
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] font-sans text-slate-500">
                                  Elev / HR
                                </div>
                                <div className="font-bold text-slate-900 dark:text-slate-100">
                                  +{distanceUnit === 'mi' ? `${Math.round(act.elevationGainMeters * 3.28084).toLocaleString()}ft` : `${act.elevationGainMeters}m`}
                                  {act.avgHr > 0 ? ` · ${act.avgHr}bpm` : ''}
                                </div>
                              </div>
                            </div>

                            {/* Strava Segment PR Trophy Case (if segments or PRs exist) */}
                            {(act.stravaPrCount > 0 || topSegments.length > 0) && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                {act.stravaPrCount > 0 && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-[11px] font-bold">
                                    <Trophy className="w-3 h-3" />
                                    {act.stravaPrCount} Strava PR{act.stravaPrCount > 1 ? 's' : ''}
                                  </span>
                                )}
                                {topSegments.map((seg, segIdx) => (
                                  <button
                                    key={`${seg.id}-${seg.segmentId}-${segIdx}`}
                                    type="button"
                                    onClick={() => onSelectActivity(act)}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-blue-500/15 text-[11px] font-mono text-slate-700 dark:text-slate-300 transition-colors"
                                  >
                                    {seg.prRank === 1 && (
                                      <span className="text-amber-500 font-bold">👑</span>
                                    )}
                                    <span className="truncate max-w-[130px] font-sans font-medium">
                                      {seg.name}
                                    </span>
                                    <span className="text-slate-500">
                                      {formatStopwatch(seg.elapsedTimeSecs)}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* Kudos Action Bar & Kudoer Avatar Pills */}
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/80 dark:border-slate-800">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => onToggleKudos && onToggleKudos(act)}
                                  className={`min-h-[30px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                                    act.hasKudoed
                                      ? 'bg-[#FC4C02] text-white shadow-xs'
                                      : 'border border-[#FC4C02]/40 bg-[#FC4C02]/10 text-[#FC4C02] hover:bg-[#FC4C02]/20'
                                  }`}
                                >
                                  <ThumbsUp className="w-3.5 h-3.5" />
                                  <span>
                                    {act.hasKudoed ? 'Kudoed' : 'Give Kudos'} ({kudosTotal})
                                  </span>
                                </button>

                                {/* Kudoer Avatar Initials Pills */}
                                {kudoers.slice(0, 4).map((k, kIdx) => {
                                  const dispName =
                                    k.name ||
                                    `${k.firstname || ''} ${k.lastname || ''}`.trim() ||
                                    'Athlete';
                                  const dispInitials =
                                    k.avatarInitials ||
                                    dispName
                                      .split(' ')
                                      .map((p) => p[0] || '')
                                      .join('')
                                      .slice(0, 2)
                                      .toUpperCase();
                                  const dispLoc =
                                    k.location || [k.city, k.state].filter(Boolean).join(', ');
                                  return (
                                    <span
                                      key={k.id || `${dispName}-${kIdx}`}
                                      title={`${dispName}${dispLoc ? ` (${dispLoc})` : ''}`}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-200/70 dark:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-300"
                                    >
                                      <span className="w-4 h-4 rounded-full bg-[#FC4C02]/20 text-[#FC4C02] font-mono text-[9px] font-bold flex items-center justify-center">
                                        {dispInitials}
                                      </span>
                                      <span className="truncate max-w-[90px]">{dispName}</span>
                                    </span>
                                  );
                                })}
                              </div>

                              <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-500">
                                <MessageSquare className="w-3 h-3" />
                                {comments.length} {comments.length === 1 ? 'note' : 'notes'}
                              </span>
                            </div>

                            {/* Activity Comments / Coaching Notes + Inline Quick Note Input */}
                            {comments.length > 0 && (
                              <div className="space-y-1.5 pt-1">
                                {comments.slice(-2).map((c) => (
                                  <div
                                    key={c.id}
                                    className="rounded-lg bg-white dark:bg-slate-950 border border-slate-200/70 dark:border-slate-800 px-2.5 py-1.5 text-xs"
                                  >
                                    <div className="flex items-center justify-between text-[10px] text-slate-500">
                                      <span className="font-bold text-slate-800 dark:text-slate-200">
                                        {c.authorName || c.athleteName || 'Athlete'}
                                      </span>
                                      <span className="font-mono">
                                        {c.createdAt.slice(0, 10)}
                                      </span>
                                    </div>
                                    <p className="text-slate-700 dark:text-slate-300 mt-0.5">
                                      {c.text}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}

                            {onAddComment && (
                              <form
                                onSubmit={async (e) => {
                                  e.preventDefault();
                                  if (!commentDraft.trim()) return;
                                  const text = commentDraft.trim();
                                  setCommentDrafts((prev) => ({ ...prev, [act.id]: '' }));
                                  await onAddComment(act, text);
                                }}
                                className="flex items-center gap-1.5 pt-1"
                              >
                                <input
                                  type="text"
                                  value={commentDraft}
                                  onChange={(e) =>
                                    setCommentDrafts((prev) => ({
                                      ...prev,
                                      [act.id]: e.target.value,
                                    }))
                                  }
                                  placeholder="Add workout note or Strava club comment..."
                                  className="flex-1 min-h-[30px] rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-2.5 py-1 text-xs text-slate-900 dark:text-slate-100"
                                />
                                <button
                                  type="submit"
                                  disabled={!commentDraft.trim()}
                                  className="min-h-[30px] px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-slate-800 hover:bg-[#FC4C02] disabled:opacity-40 text-white text-xs font-semibold transition-colors inline-flex items-center gap-1"
                                >
                                  <Send className="w-3 h-3" />
                                </button>
                              </form>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            );
          })()}
        </section>
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
        <section className="rounded-xl bg-white dark:bg-[#111827] border-2 border-blue-500/40 shadow-lg p-5 space-y-6">
          {/* Top Bar: Title, Alignment Controls, Smoothing Toggle & Close */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <Columns2 className="w-4 h-4 text-blue-500" />
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Split-View Workout Comparator — Overlaid Power &amp; Heart Rate Telemetry
                </h2>
                <ChartInfoTooltip
                  title="Split-View Overlaid Workout Telemetry"
                  subtitle="Head-to-Head Physiological Efficiency & Pacing Analysis"
                  whatItMeasures="Overlays second-by-second Power/Output and Heart Rate streams from two workouts (aligned by % completion or elapsed time) alongside side-by-side HR zone distribution."
                  benchmarks="Higher Normalized Power at the same or lower Heart Rate (higher EF) with lower Pa:Hr decoupling indicates superior mitochondrial efficiency and cardiac stroke volume."
                  liveStatus={
                    compareActivityA && compareActivityB
                      ? {
                          label: `A: EF ${compareActivityA.efficiencyFactor || '—'} vs B: EF ${compareActivityB.efficiencyFactor || '—'}`,
                          state:
                            (compareActivityA.efficiencyFactor || 0) >=
                            (compareActivityB.efficiencyFactor || 0)
                              ? 'optimal'
                              : 'neutral',
                          interpretation: `Comparing ${compareActivityA.name} (${compareActivityA.startDateLocal.slice(0, 10)}) against ${compareActivityB.name} (${compareActivityB.startDateLocal.slice(0, 10)}).`,
                        }
                      : undefined
                  }
                  coachingAction="Use 'Auto-Match Repeat' to pair two workouts of similar duration or route, then inspect the late-workout Heart Rate trace for divergence (cardiac drift)."
                />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Select any two workouts from the dropdowns below or click the <strong>A</strong> / <strong>B</strong> buttons on any row in the activity table below
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* X-Axis Alignment Mode */}
              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => setCompareXMode('PERCENT')}
                  className={`min-h-[30px] px-2.5 py-1 rounded-md font-semibold transition-colors ${
                    compareXMode === 'PERCENT'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Align by % Completion (0–100%)
                </button>
                <button
                  type="button"
                  onClick={() => setCompareXMode('TIME')}
                  className={`min-h-[30px] px-2.5 py-1 rounded-md font-semibold transition-colors ${
                    compareXMode === 'TIME'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Align by Elapsed Time (mm:ss)
                </button>
              </div>

              {/* Rolling Smoothing Toggle */}
              <button
                type="button"
                onClick={() => setSmoothStreams((prev) => !prev)}
                className={`min-h-[34px] px-3 py-1 rounded-lg border text-xs font-semibold transition-colors ${
                  smoothStreams
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}
              >
                {smoothStreams ? 'Smoothed Rolling Trace' : 'Raw 1s Stream'}
              </button>

              <button
                type="button"
                onClick={() => setActiveWorkspace('LOG')}
                className="min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Back to Activity Log
              </button>
            </div>
          </div>

          {/* Side-by-Side Workout A & Workout B Selector Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            {/* Workout A Card (Blue) */}
            <div className="lg:col-span-5 rounded-xl bg-blue-500/5 border border-blue-500/30 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
                  Workout A (Baseline · Blue)
                </span>
                {compareActivityA && (
                  <span className="text-xs font-mono text-slate-500">
                    {compareActivityA.startDateLocal.slice(0, 10)} · {compareActivityA.sportCategory}
                  </span>
                )}
              </div>

              <select
                value={compareIdA || ''}
                onChange={(e) => {
                  const found = activities.find((a) => a.id === e.target.value);
                  if (found) handleAssignToCompareSlot(found, 'A');
                }}
                className="w-full min-h-[38px] rounded-lg border border-blue-500/30 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
              >
                <option value="">Select Workout A...</option>
                {filteredActivities.slice(0, 250).map((act) => (
                  <option key={act.id} value={act.id}>
                    {act.startDateLocal.slice(0, 10)} — {act.name} (
                    {act.distanceMeters > 0
                      ? formatDistance(act.distanceMeters, distanceUnit, 1)
                      : formatDuration(act.movingTimeSecs)}
                    )
                  </option>
                ))}
              </select>

              {compareActivityA ? (
                <div className="grid grid-cols-3 gap-2 pt-1 text-xs font-mono tabular-nums">
                  <div className="rounded-lg bg-white/80 dark:bg-slate-900/80 p-2.5 border border-slate-200/70 dark:border-slate-800">
                    <div className="text-[11px] font-sans text-slate-500">Distance / Time</div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      {compareActivityA.distanceMeters > 0
                        ? formatDistance(compareActivityA.distanceMeters, distanceUnit, 2)
                        : 'Indoor'}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {formatDuration(compareActivityA.movingTimeSecs)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/80 dark:bg-slate-900/80 p-2.5 border border-slate-200/70 dark:border-slate-800">
                    <div className="text-[11px] font-sans text-slate-500">Power / Pace</div>
                    <div className="font-bold text-blue-600 dark:text-blue-400 mt-0.5">
                      {compareActivityA.normalizedPower
                        ? `NP ${compareActivityA.normalizedPower}W`
                        : compareActivityA.avgPaceSecsPerKm
                          ? formatPace(compareActivityA.avgPaceSecsPerKm, distanceUnit)
                          : `${compareActivityA.trainingLoad} TSS`}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Avg {compareActivityA.avgPower ? `${compareActivityA.avgPower}W` : '—'} · EF{' '}
                      {compareActivityA.efficiencyFactor || '—'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/80 dark:bg-slate-900/80 p-2.5 border border-slate-200/70 dark:border-slate-800">
                    <div className="text-[11px] font-sans text-slate-500">Heart Rate</div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      {compareActivityA.avgHr > 0 ? `${compareActivityA.avgHr} bpm` : '—'}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Max {compareActivityA.maxHr || '—'} · Drift{' '}
                      {compareActivityA.aerobicDecouplingPct}%
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-500 py-4 text-center">
                  Pick a workout above or click <strong>A</strong> on any row in the table.
                </div>
              )}
            </div>

            {/* Center Swap & Auto-Match Repeat Controls */}
            <div className="lg:col-span-2 flex flex-row lg:flex-col items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const temp = compareIdA;
                  setCompareIdA(compareIdB);
                  setCompareIdB(temp);
                }}
                className="w-full min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
              >
                <ArrowLeftRight className="w-3.5 h-3.5 text-blue-500" />
                <span>Swap A ↔ B</span>
              </button>
              <button
                type="button"
                onClick={handleAutoMatchRepeatForA}
                disabled={!compareActivityA}
                className="w-full min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-40 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 transition-colors"
                title="Automatically find a similar distance/duration repeat workout for Slot B"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Auto-Match Repeat</span>
              </button>
            </div>

            {/* Workout B Card (Amber) */}
            <div className="lg:col-span-5 rounded-xl bg-amber-500/5 border border-amber-500/30 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
                  Workout B (Comparison · Amber)
                </span>
                {compareActivityB && (
                  <span className="text-xs font-mono text-slate-500">
                    {compareActivityB.startDateLocal.slice(0, 10)} · {compareActivityB.sportCategory}
                  </span>
                )}
              </div>

              <select
                value={compareIdB || ''}
                onChange={(e) => {
                  const found = activities.find((a) => a.id === e.target.value);
                  if (found) handleAssignToCompareSlot(found, 'B');
                }}
                className="w-full min-h-[38px] rounded-lg border border-amber-500/30 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
              >
                <option value="">Select Workout B...</option>
                {filteredActivities.slice(0, 250).map((act) => (
                  <option key={act.id} value={act.id}>
                    {act.startDateLocal.slice(0, 10)} — {act.name} (
                    {act.distanceMeters > 0
                      ? formatDistance(act.distanceMeters, distanceUnit, 1)
                      : formatDuration(act.movingTimeSecs)}
                    )
                  </option>
                ))}
              </select>

              {compareActivityB ? (
                <div className="grid grid-cols-3 gap-2 pt-1 text-xs font-mono tabular-nums">
                  <div className="rounded-lg bg-white/80 dark:bg-slate-900/80 p-2.5 border border-slate-200/70 dark:border-slate-800">
                    <div className="text-[11px] font-sans text-slate-500">Distance / Time</div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      {compareActivityB.distanceMeters > 0
                        ? formatDistance(compareActivityB.distanceMeters, distanceUnit, 2)
                        : 'Indoor'}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {formatDuration(compareActivityB.movingTimeSecs)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/80 dark:bg-slate-900/80 p-2.5 border border-slate-200/70 dark:border-slate-800">
                    <div className="text-[11px] font-sans text-slate-500">Power / Pace</div>
                    <div className="font-bold text-amber-600 dark:text-amber-400 mt-0.5">
                      {compareActivityB.normalizedPower
                        ? `NP ${compareActivityB.normalizedPower}W`
                        : compareActivityB.avgPaceSecsPerKm
                          ? formatPace(compareActivityB.avgPaceSecsPerKm, distanceUnit)
                          : `${compareActivityB.trainingLoad} TSS`}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Avg {compareActivityB.avgPower ? `${compareActivityB.avgPower}W` : '—'} · EF{' '}
                      {compareActivityB.efficiencyFactor || '—'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/80 dark:bg-slate-900/80 p-2.5 border border-slate-200/70 dark:border-slate-800">
                    <div className="text-[11px] font-sans text-slate-500">Heart Rate</div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      {compareActivityB.avgHr > 0 ? `${compareActivityB.avgHr} bpm` : '—'}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Max {compareActivityB.maxHr || '—'} · Drift{' '}
                      {compareActivityB.aerobicDecouplingPct}%
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-500 py-4 text-center">
                  Pick a second workout above or click <strong>B</strong> on any row in the table.
                </div>
              )}
            </div>
          </div>

          {/* Overlaid Power & Heart Rate Charts + Head-to-Head Delta Analysis */}
          {compareActivityA && compareActivityB && overlaidComparisonData && (
            <div className="space-y-5">
              {/* SYNCHRONIZED 1HZ UPLOT TELEMETRY COMPARATOR (Shared uPlot.sync crosshair) */}
              {(compareActivityA.streams || compareActivityB.streams) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {compareActivityA.streams && (
                    <UPlotStreamChart
                      streams={compareActivityA.streams}
                      sportCategory={compareActivityA.sportCategory}
                      distanceUnit={distanceUnit}
                      athleteWeightKg={athleteWeightKg}
                      intervals={compareActivityA.intervals}
                      syncKey="aeropulse-compare-sync"
                      height={220}
                    />
                  )}
                  {compareActivityB.streams && (
                    <UPlotStreamChart
                      streams={compareActivityB.streams}
                      sportCategory={compareActivityB.sportCategory}
                      distanceUnit={distanceUnit}
                      athleteWeightKg={athleteWeightKg}
                      intervals={compareActivityB.intervals}
                      syncKey="aeropulse-compare-sync"
                      height={220}
                    />
                  )}
                </div>
              )}

              {/* 1. OVERLAID POWER / OUTPUT COMPARISON CHART */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Overlaid Power / Output Profile —{' '}
                      <span className="text-blue-600 dark:text-blue-400">
                        A: {compareActivityA.name} ({compareActivityA.startDateLocal.slice(0, 10)})
                      </span>{' '}
                      vs{' '}
                      <span className="text-amber-600 dark:text-amber-400">
                        B: {compareActivityB.name} ({compareActivityB.startDateLocal.slice(0, 10)})
                      </span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      Y-Axis: Power / Equivalent Output (Watts) · X-Axis:{' '}
                      {compareXMode === 'PERCENT'
                        ? 'Normalized Workout Progress (0% – 100%)'
                        : 'Elapsed Workout Time (mm:ss)'}
                    </p>
                  </div>

                  {/* Synchronized Hover Readout for Power */}
                  {compareHoverStep !== null &&
                  overlaidComparisonData.alignedSteps[compareHoverStep] ? (
                    <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5">
                      <span className="text-slate-500 font-semibold">
                        {compareXMode === 'PERCENT' ? 'Progress:' : 'Elapsed:'}{' '}
                        {overlaidComparisonData.alignedSteps[compareHoverStep].xLabel}
                      </span>
                      <span className="text-blue-600 dark:text-blue-400 font-bold">
                        A:{' '}
                        {overlaidComparisonData.alignedSteps[compareHoverStep].powerA !== undefined
                          ? `${overlaidComparisonData.alignedSteps[compareHoverStep].powerA}W`
                          : '—'}
                      </span>
                      <span className="text-amber-600 dark:text-amber-400 font-bold">
                        B:{' '}
                        {overlaidComparisonData.alignedSteps[compareHoverStep].powerB !== undefined
                          ? `${overlaidComparisonData.alignedSteps[compareHoverStep].powerB}W`
                          : '—'}
                      </span>
                      {overlaidComparisonData.alignedSteps[compareHoverStep].powerA !== undefined &&
                        overlaidComparisonData.alignedSteps[compareHoverStep].powerB !==
                          undefined && (
                          <span
                            className={`font-bold ${
                              overlaidComparisonData.alignedSteps[compareHoverStep].powerA! -
                                overlaidComparisonData.alignedSteps[compareHoverStep].powerB! >=
                              0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            Δ (A−B):{' '}
                            {overlaidComparisonData.alignedSteps[compareHoverStep].powerA! -
                              overlaidComparisonData.alignedSteps[compareHoverStep].powerB! >=
                            0
                              ? '+'
                              : ''}
                            {overlaidComparisonData.alignedSteps[compareHoverStep].powerA! -
                              overlaidComparisonData.alignedSteps[compareHoverStep].powerB!}
                            W
                          </span>
                        )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-4 text-xs font-mono">
                      <span className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-semibold">
                        <span className="w-3 h-0.5 bg-blue-500 inline-block" />A Avg:{' '}
                        {compareActivityA.avgPower || compareActivityA.normalizedPower || '—'}W
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-semibold">
                        <span className="w-3 h-0.5 bg-amber-500 inline-block" />B Avg:{' '}
                        {compareActivityB.avgPower || compareActivityB.normalizedPower || '—'}W
                      </span>
                    </div>
                  )}
                </div>

                <svg
                  viewBox="0 0 860 205"
                  className="w-full h-52 select-none"
                  onMouseLeave={() => setCompareHoverStep(null)}
                >
                  {(() => {
                    const { alignedSteps, maxPower } = overlaidComparisonData;
                    const len = alignedSteps.length;
                    const chartLeft = 62;
                    const chartRight = 830;
                    const chartW = chartRight - chartLeft;
                    const chartTop = 16;
                    const chartBottom = 156;
                    const chartH = chartBottom - chartTop;

                    const pointsA = alignedSteps
                      .filter((s) => s.powerA !== undefined)
                      .map((s) => {
                        const x = chartLeft + s.frac * chartW;
                        const y = chartBottom - (s.powerA! / maxPower) * chartH;
                        return `${x},${Math.max(chartTop, Math.min(chartBottom, y))}`;
                      })
                      .join(' ');

                    const pointsB = alignedSteps
                      .filter((s) => s.powerB !== undefined)
                      .map((s) => {
                        const x = chartLeft + s.frac * chartW;
                        const y = chartBottom - (s.powerB! / maxPower) * chartH;
                        return `${x},${Math.max(chartTop, Math.min(chartBottom, y))}`;
                      })
                      .join(' ');

                    return (
                      <>
                        {/* Y-Axis Title */}
                        <text
                          x={16}
                          y={86}
                          transform="rotate(-90 16 86)"
                          textAnchor="middle"
                          className="fill-blue-500 text-xs font-sans font-bold"
                        >
                          Power / Output (Watts)
                        </text>

                        {/* Horizontal Grid Lines & Y-Axis Ticks */}
                        {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                          const y = chartBottom - f * chartH;
                          const wVal = Math.round(f * maxPower);
                          return (
                            <g key={idx}>
                              <line
                                x1={chartLeft}
                                y1={y}
                                x2={chartRight}
                                y2={y}
                                stroke="currentColor"
                                className="text-slate-200 dark:text-slate-800"
                                strokeDasharray="3 3"
                              />
                              <text
                                x={chartLeft - 8}
                                y={y + 4}
                                textAnchor="end"
                                className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                              >
                                {wVal}W
                              </text>
                            </g>
                          );
                        })}

                        {/* Workout B Power Trace (Amber) */}
                        {pointsB && (
                          <polyline
                            fill="none"
                            stroke="#F59E0B"
                            strokeWidth="2.2"
                            strokeOpacity="0.9"
                            points={pointsB}
                          />
                        )}

                        {/* Workout A Power Trace (Blue) */}
                        {pointsA && (
                          <polyline
                            fill="none"
                            stroke="#3B82F6"
                            strokeWidth="2.2"
                            points={pointsA}
                          />
                        )}

                        {/* X-Axis Ticks & Label */}
                        {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                          const x = chartLeft + f * chartW;
                          const label =
                            compareXMode === 'PERCENT'
                              ? `${Math.round(f * 100)}%`
                              : formatStopwatch(
                                  Math.round(f * overlaidComparisonData.maxDurationSecs)
                                );
                          return (
                            <text
                              key={idx}
                              x={x}
                              y={174}
                              textAnchor="middle"
                              className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                            >
                              {label}
                            </text>
                          );
                        })}
                        <text
                          x={chartLeft + chartW / 2}
                          y={196}
                          textAnchor="middle"
                          className="fill-slate-600 dark:fill-slate-300 text-xs font-sans font-bold"
                        >
                          {compareXMode === 'PERCENT'
                            ? 'Normalized Workout Progress (% of Total Duration)'
                            : 'Elapsed Workout Time (mm:ss)'}
                        </text>

                        {/* Interactive Crosshair Hit Columns */}
                        {alignedSteps.map((s, idx) => {
                          const x = chartLeft + s.frac * chartW;
                          const colW = chartW / Math.max(1, len);
                          const isHovered = compareHoverStep === idx;
                          const yA =
                            s.powerA !== undefined
                              ? Math.max(
                                  chartTop,
                                  Math.min(chartBottom, chartBottom - (s.powerA / maxPower) * chartH)
                                )
                              : null;
                          const yB =
                            s.powerB !== undefined
                              ? Math.max(
                                  chartTop,
                                  Math.min(chartBottom, chartBottom - (s.powerB / maxPower) * chartH)
                                )
                              : null;
                          return (
                            <g key={idx}>
                              {isHovered && (
                                <>
                                  <line
                                    x1={x}
                                    y1={chartTop}
                                    x2={x}
                                    y2={chartBottom}
                                    stroke="#94A3B8"
                                    strokeWidth="1.5"
                                    strokeDasharray="3 2"
                                  />
                                  {yA !== null && (
                                    <circle
                                      cx={x}
                                      cy={yA}
                                      r={4.5}
                                      fill="#3B82F6"
                                      stroke="#fff"
                                      strokeWidth="1.5"
                                    />
                                  )}
                                  {yB !== null && (
                                    <circle
                                      cx={x}
                                      cy={yB}
                                      r={4.5}
                                      fill="#F59E0B"
                                      stroke="#fff"
                                      strokeWidth="1.5"
                                    />
                                  )}
                                </>
                              )}
                              <rect
                                x={x - colW / 2}
                                y={0}
                                width={colW}
                                height={180}
                                fill="transparent"
                                className="cursor-crosshair"
                                onMouseEnter={() => setCompareHoverStep(idx)}
                                onMouseMove={() => setCompareHoverStep(idx)}
                              />
                            </g>
                          );
                        })}
                      </>
                    );
                  })()}
                </svg>
              </div>

              {/* 2. OVERLAID HEART RATE COMPARISON CHART (Synchronized Crosshair) */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Overlaid Heart Rate Response —{' '}
                      <span className="text-blue-600 dark:text-blue-400">
                        A: {compareActivityA.name} (Avg {compareActivityA.avgHr || '—'} bpm)
                      </span>{' '}
                      vs{' '}
                      <span className="text-rose-600 dark:text-rose-400">
                        B: {compareActivityB.name} (Avg {compareActivityB.avgHr || '—'} bpm)
                      </span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      Y-Axis: Heart Rate (bpm) · X-Axis:{' '}
                      {compareXMode === 'PERCENT'
                        ? 'Normalized Workout Progress (0% – 100%)'
                        : 'Elapsed Workout Time (mm:ss)'}
                    </p>
                  </div>

                  {/* Synchronized Hover Readout for Heart Rate */}
                  {compareHoverStep !== null &&
                  overlaidComparisonData.alignedSteps[compareHoverStep] ? (
                    <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5">
                      <span className="text-slate-500 font-semibold">
                        {compareXMode === 'PERCENT' ? 'Progress:' : 'Elapsed:'}{' '}
                        {overlaidComparisonData.alignedSteps[compareHoverStep].xLabel}
                      </span>
                      <span className="text-blue-600 dark:text-blue-400 font-bold">
                        A HR:{' '}
                        {overlaidComparisonData.alignedSteps[compareHoverStep].hrA !== undefined
                          ? `${overlaidComparisonData.alignedSteps[compareHoverStep].hrA} bpm`
                          : '—'}
                      </span>
                      <span className="text-rose-600 dark:text-rose-400 font-bold">
                        B HR:{' '}
                        {overlaidComparisonData.alignedSteps[compareHoverStep].hrB !== undefined
                          ? `${overlaidComparisonData.alignedSteps[compareHoverStep].hrB} bpm`
                          : '—'}
                      </span>
                      {overlaidComparisonData.alignedSteps[compareHoverStep].hrA !== undefined &&
                        overlaidComparisonData.alignedSteps[compareHoverStep].hrB !== undefined && (
                          <span
                            className={`font-bold ${
                              overlaidComparisonData.alignedSteps[compareHoverStep].hrA! -
                                overlaidComparisonData.alignedSteps[compareHoverStep].hrB! <=
                              0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            Δ (A−B):{' '}
                            {overlaidComparisonData.alignedSteps[compareHoverStep].hrA! -
                              overlaidComparisonData.alignedSteps[compareHoverStep].hrB! >
                            0
                              ? '+'
                              : ''}
                            {overlaidComparisonData.alignedSteps[compareHoverStep].hrA! -
                              overlaidComparisonData.alignedSteps[compareHoverStep].hrB!}{' '}
                            bpm
                          </span>
                        )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-4 text-xs font-mono">
                      <span className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-semibold">
                        <span className="w-3 h-0.5 bg-blue-500 inline-block" />A Avg/Max:{' '}
                        {compareActivityA.avgHr || '—'}/{compareActivityA.maxHr || '—'} bpm
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-semibold">
                        <span className="w-3 h-0.5 bg-rose-500 inline-block" />B Avg/Max:{' '}
                        {compareActivityB.avgHr || '—'}/{compareActivityB.maxHr || '—'} bpm
                      </span>
                    </div>
                  )}
                </div>

                <svg
                  viewBox="0 0 860 205"
                  className="w-full h-52 select-none"
                  onMouseLeave={() => setCompareHoverStep(null)}
                >
                  {(() => {
                    const { alignedSteps, minHr, maxHr } = overlaidComparisonData;
                    const len = alignedSteps.length;
                    const chartLeft = 62;
                    const chartRight = 830;
                    const chartW = chartRight - chartLeft;
                    const chartTop = 16;
                    const chartBottom = 156;
                    const chartH = chartBottom - chartTop;
                    const hrSpan = Math.max(20, maxHr - minHr);

                    const pointsHrA = alignedSteps
                      .filter((s) => s.hrA !== undefined)
                      .map((s) => {
                        const x = chartLeft + s.frac * chartW;
                        const y = chartBottom - ((s.hrA! - minHr) / hrSpan) * chartH;
                        return `${x},${Math.max(chartTop, Math.min(chartBottom, y))}`;
                      })
                      .join(' ');

                    const pointsHrB = alignedSteps
                      .filter((s) => s.hrB !== undefined)
                      .map((s) => {
                        const x = chartLeft + s.frac * chartW;
                        const y = chartBottom - ((s.hrB! - minHr) / hrSpan) * chartH;
                        return `${x},${Math.max(chartTop, Math.min(chartBottom, y))}`;
                      })
                      .join(' ');

                    return (
                      <>
                        {/* Y-Axis Title */}
                        <text
                          x={16}
                          y={86}
                          transform="rotate(-90 16 86)"
                          textAnchor="middle"
                          className="fill-rose-500 text-xs font-sans font-bold"
                        >
                          Heart Rate (bpm)
                        </text>

                        {/* Horizontal Grid Lines & Y-Axis Ticks */}
                        {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                          const y = chartBottom - f * chartH;
                          const hrVal = Math.round(minHr + f * hrSpan);
                          return (
                            <g key={idx}>
                              <line
                                x1={chartLeft}
                                y1={y}
                                x2={chartRight}
                                y2={y}
                                stroke="currentColor"
                                className="text-slate-200 dark:text-slate-800"
                                strokeDasharray="3 3"
                              />
                              <text
                                x={chartLeft - 8}
                                y={y + 4}
                                textAnchor="end"
                                className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                              >
                                {hrVal}
                              </text>
                            </g>
                          );
                        })}

                        {/* Workout B Heart Rate Trace (Rose/Red) */}
                        {pointsHrB && (
                          <polyline
                            fill="none"
                            stroke="#F43F5E"
                            strokeWidth="2.2"
                            strokeOpacity="0.9"
                            points={pointsHrB}
                          />
                        )}

                        {/* Workout A Heart Rate Trace (Blue) */}
                        {pointsHrA && (
                          <polyline
                            fill="none"
                            stroke="#3B82F6"
                            strokeWidth="2.2"
                            points={pointsHrA}
                          />
                        )}

                        {/* X-Axis Ticks & Label */}
                        {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                          const x = chartLeft + f * chartW;
                          const label =
                            compareXMode === 'PERCENT'
                              ? `${Math.round(f * 100)}%`
                              : formatStopwatch(
                                  Math.round(f * overlaidComparisonData.maxDurationSecs)
                                );
                          return (
                            <text
                              key={idx}
                              x={x}
                              y={174}
                              textAnchor="middle"
                              className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                            >
                              {label}
                            </text>
                          );
                        })}
                        <text
                          x={chartLeft + chartW / 2}
                          y={196}
                          textAnchor="middle"
                          className="fill-slate-600 dark:fill-slate-300 text-xs font-sans font-bold"
                        >
                          {compareXMode === 'PERCENT'
                            ? 'Normalized Workout Progress (% of Total Duration)'
                            : 'Elapsed Workout Time (mm:ss)'}
                        </text>

                        {/* Interactive Crosshair Hit Columns */}
                        {alignedSteps.map((s, idx) => {
                          const x = chartLeft + s.frac * chartW;
                          const colW = chartW / Math.max(1, len);
                          const isHovered = compareHoverStep === idx;
                          const yA =
                            s.hrA !== undefined
                              ? Math.max(
                                  chartTop,
                                  Math.min(
                                    chartBottom,
                                    chartBottom - ((s.hrA - minHr) / hrSpan) * chartH
                                  )
                                )
                              : null;
                          const yB =
                            s.hrB !== undefined
                              ? Math.max(
                                  chartTop,
                                  Math.min(
                                    chartBottom,
                                    chartBottom - ((s.hrB - minHr) / hrSpan) * chartH
                                  )
                                )
                              : null;
                          return (
                            <g key={idx}>
                              {isHovered && (
                                <>
                                  <line
                                    x1={x}
                                    y1={chartTop}
                                    x2={x}
                                    y2={chartBottom}
                                    stroke="#94A3B8"
                                    strokeWidth="1.5"
                                    strokeDasharray="3 2"
                                  />
                                  {yA !== null && (
                                    <circle
                                      cx={x}
                                      cy={yA}
                                      r={4.5}
                                      fill="#3B82F6"
                                      stroke="#fff"
                                      strokeWidth="1.5"
                                    />
                                  )}
                                  {yB !== null && (
                                    <circle
                                      cx={x}
                                      cy={yB}
                                      r={4.5}
                                      fill="#F43F5E"
                                      stroke="#fff"
                                      strokeWidth="1.5"
                                    />
                                  )}
                                </>
                              )}
                              <rect
                                x={x - colW / 2}
                                y={0}
                                width={colW}
                                height={180}
                                fill="transparent"
                                className="cursor-crosshair"
                                onMouseEnter={() => setCompareHoverStep(idx)}
                                onMouseMove={() => setCompareHoverStep(idx)}
                              />
                            </g>
                          );
                        })}
                      </>
                    );
                  })()}
                </svg>
              </div>

              {/* 3. SIDE-BY-SIDE METRIC DELTA TABLE & DUAL HEART RATE ZONE COMPARISON */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Left: Head-to-Head Physiological Metrics Table */}
                <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Head-to-Head Physiological Telemetry Deltas (A vs B)
                    </h3>
                    <span className="text-xs font-mono text-slate-500">
                      Δ = Workout A − Workout B
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs sm:text-sm border-collapse font-mono tabular-nums">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-sans text-slate-500">
                          <th className="py-2 pr-3">Metric</th>
                          <th className="py-2 px-3 text-right text-blue-600 dark:text-blue-400">
                            Workout A ({compareActivityA.startDateLocal.slice(0, 10)})
                          </th>
                          <th className="py-2 px-3 text-right text-amber-600 dark:text-amber-400">
                            Workout B ({compareActivityB.startDateLocal.slice(0, 10)})
                          </th>
                          <th className="py-2 pl-3 text-right">Delta (A − B)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {(() => {
                          const npA = compareActivityA.normalizedPower || compareActivityA.avgPower || 0;
                          const npB = compareActivityB.normalizedPower || compareActivityB.avgPower || 0;
                          const efA = compareActivityA.efficiencyFactor || 0;
                          const efB = compareActivityB.efficiencyFactor || 0;
                          const hrA = compareActivityA.avgHr || 0;
                          const hrB = compareActivityB.avgHr || 0;
                          const driftA = compareActivityA.aerobicDecouplingPct || 0;
                          const driftB = compareActivityB.aerobicDecouplingPct || 0;

                          const rows = [
                            {
                              label: 'Distance',
                              valA:
                                compareActivityA.distanceMeters > 0
                                  ? formatDistance(compareActivityA.distanceMeters, distanceUnit, 2)
                                  : '—',
                              valB:
                                compareActivityB.distanceMeters > 0
                                  ? formatDistance(compareActivityB.distanceMeters, distanceUnit, 2)
                                  : '—',
                              delta:
                                compareActivityA.distanceMeters > 0 &&
                                compareActivityB.distanceMeters > 0
                                  ? `${compareActivityA.distanceMeters >= compareActivityB.distanceMeters ? '+' : '-'}${formatDistance(
                                      Math.abs(
                                        compareActivityA.distanceMeters -
                                          compareActivityB.distanceMeters
                                      ),
                                      distanceUnit,
                                      2
                                    )}`
                                  : '—',
                              good: true,
                            },
                            {
                              label: 'Moving Duration',
                              valA: formatDuration(compareActivityA.movingTimeSecs),
                              valB: formatDuration(compareActivityB.movingTimeSecs),
                              delta: `${compareActivityA.movingTimeSecs >= compareActivityB.movingTimeSecs ? '+' : '-'}${formatDuration(
                                Math.abs(
                                  compareActivityA.movingTimeSecs - compareActivityB.movingTimeSecs
                                )
                              )}`,
                              good: true,
                            },
                            {
                              label: 'Normalized / Avg Power',
                              valA: npA > 0 ? `${npA}W` : '—',
                              valB: npB > 0 ? `${npB}W` : '—',
                              delta:
                                npA > 0 && npB > 0
                                  ? `${npA - npB >= 0 ? '+' : ''}${npA - npB}W`
                                  : '—',
                              good: npA >= npB,
                            },
                            {
                              label: 'Average Pace',
                              valA: compareActivityA.avgPaceSecsPerKm
                                ? formatPace(compareActivityA.avgPaceSecsPerKm, distanceUnit)
                                : '—',
                              valB: compareActivityB.avgPaceSecsPerKm
                                ? formatPace(compareActivityB.avgPaceSecsPerKm, distanceUnit)
                                : '—',
                              delta:
                                compareActivityA.avgPaceSecsPerKm &&
                                compareActivityB.avgPaceSecsPerKm
                                  ? (() => {
                                      const rawDiff =
                                        compareActivityA.avgPaceSecsPerKm -
                                        compareActivityB.avgPaceSecsPerKm;
                                      const scaledDiff =
                                        distanceUnit === 'mi'
                                          ? Math.round(rawDiff * 1.609344)
                                          : Math.round(rawDiff);
                                      return `${scaledDiff <= 0 ? '' : '+'}${scaledDiff}s/${distanceUnit}`;
                                    })()
                                  : '—',
                              good:
                                (compareActivityA.avgPaceSecsPerKm || 0) <=
                                (compareActivityB.avgPaceSecsPerKm || 0),
                            },
                            {
                              label: 'Average Heart Rate',
                              valA: hrA > 0 ? `${hrA} bpm` : '—',
                              valB: hrB > 0 ? `${hrB} bpm` : '—',
                              delta:
                                hrA > 0 && hrB > 0
                                  ? `${hrA - hrB >= 0 ? '+' : ''}${hrA - hrB} bpm`
                                  : '—',
                              good: hrA <= hrB,
                            },
                            {
                              label: 'Efficiency Factor (EF)',
                              valA: efA > 0 ? efA.toFixed(2) : '—',
                              valB: efB > 0 ? efB.toFixed(2) : '—',
                              delta:
                                efA > 0 && efB > 0
                                  ? `${efA - efB >= 0 ? '+' : ''}${(efA - efB).toFixed(2)}`
                                  : '—',
                              good: efA >= efB,
                            },
                            {
                              label: 'Aerobic Decoupling (Drift)',
                              valA: `${driftA}%`,
                              valB: `${driftB}%`,
                              delta: `${driftA - driftB >= 0 ? '+' : ''}${(driftA - driftB).toFixed(1)}%`,
                              good: driftA <= driftB,
                            },
                            {
                              label: 'Training Load (TSS)',
                              valA: `${compareActivityA.trainingLoad} TSS`,
                              valB: `${compareActivityB.trainingLoad} TSS`,
                              delta: `${compareActivityA.trainingLoad - compareActivityB.trainingLoad >= 0 ? '+' : ''}${compareActivityA.trainingLoad - compareActivityB.trainingLoad} TSS`,
                              good: true,
                            },
                          ];

                          return rows.map((r, i) => (
                            <tr key={i}>
                              <td className="py-2 pr-3 font-sans font-medium text-slate-700 dark:text-slate-300">
                                {r.label}
                              </td>
                              <td className="py-2 px-3 text-right font-semibold text-slate-900 dark:text-slate-100">
                                {r.valA}
                              </td>
                              <td className="py-2 px-3 text-right font-semibold text-slate-900 dark:text-slate-100">
                                {r.valB}
                              </td>
                              <td
                                className={`py-2 pl-3 text-right font-bold ${
                                  r.delta === '—'
                                    ? 'text-slate-400'
                                    : r.good
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-amber-600 dark:text-amber-400'
                                }`}
                              >
                                {r.delta}
                              </td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Right: Side-by-Side Time in Heart Rate Zones (Workout A vs Workout B) */}
                <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Side-by-Side HR Zone Distribution (Z1–Z6)
                    </h3>
                    <span className="text-xs font-mono text-slate-500">
                      Blue: A · Amber: B
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    {['Z1 Rec', 'Z2 Endurance', 'Z3 Tempo', 'Z4 Threshold', 'Z5 VO2max', 'Z6 Anaerobic'].map(
                      (zLabel, idx) => {
                        const totA = Math.max(
                          1,
                          compareActivityA.zoneSecs.hr.reduce((a, b) => a + b, 0)
                        );
                        const totB = Math.max(
                          1,
                          compareActivityB.zoneSecs.hr.reduce((a, b) => a + b, 0)
                        );
                        const secsA = compareActivityA.zoneSecs.hr[idx] || 0;
                        const secsB = compareActivityB.zoneSecs.hr[idx] || 0;
                        const pctA = Math.round((secsA / totA) * 100);
                        const pctB = Math.round((secsB / totB) * 100);

                        return (
                          <div key={idx} className="space-y-1 text-xs">
                            <div className="flex items-center justify-between font-mono">
                              <span className="font-sans font-semibold text-slate-700 dark:text-slate-300">
                                {zLabel}
                              </span>
                              <span className="tabular-nums">
                                <strong className="text-blue-600 dark:text-blue-400">
                                  A: {Math.round(secsA / 60)}m ({pctA}%)
                                </strong>
                                {' · '}
                                <strong className="text-amber-600 dark:text-amber-400">
                                  B: {Math.round(secsB / 60)}m ({pctB}%)
                                </strong>
                              </span>
                            </div>
                            <div className="space-y-1">
                              <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                <div
                                  style={{ width: `${pctA}%` }}
                                  className="h-full bg-blue-500"
                                />
                              </div>
                              <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                <div
                                  style={{ width: `${pctB}%` }}
                                  className="h-full bg-amber-500"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      }
                    )}
                    <div className="text-center text-[11px] font-semibold text-slate-500 pt-1">
                      Y-Axis: Physiological HR Zone · X-Axis: Share of Workout Time (0% – 100%)
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
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
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#D9480F] dark:text-[#FB6514]">
                      <Trophy className="w-3.5 h-3.5" />
                      <span>Matched Runs &amp; Rides</span>
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                      Repeated Course Efficiency ({clusters.length} Matched Loops)
                    </span>
                  </div>
                  <span className="text-xs font-mono font-semibold text-[#1D4ED8] dark:text-[#60A5FA]">
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
                        className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold transition-colors"
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
                            ? 'bg-[#FC4C02] text-white font-semibold shadow-2xs'
                            : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span className="truncate max-w-[180px]">{cl.title}</span>
                        <span
                          className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${
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
                            : 'border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-950/60 hover:border-blue-500/50'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[10px] text-slate-500">
                          <span>#{idx + 1}</span>
                          <span>{att.startDateLocal.slice(5, 10)}</span>
                        </div>
                        <div className="font-bold text-slate-900 dark:text-slate-100 truncate">
                          {outStr}
                        </div>
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-rose-500">
                            {att.avgHr > 0 ? `${att.avgHr}bpm` : '—'}
                          </span>
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                            {isBest ? '★ Best EF' : `EF ${att.efficiencyFactor || '—'}`}
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
              className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium"
            >
              Reset All Filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4">Date &amp; Session</th>
                  <th className="py-3 px-3">Sport &amp; Environment</th>
                  <th className="py-3 px-3 text-right">Distance / Time</th>
                  <th className="py-3 px-3 text-right">Output (NP / Pace)</th>
                  <th className="py-3 px-3 text-right">HR &amp; Decoupling</th>
                  <th className="py-3 px-3 text-right">Load &amp; Plan Compliance</th>
                  <th className="py-3 px-3 text-center">Split Compare</th>
                  <th className="py-3 px-4 text-right">Source</th>
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
                      onClick={() => {
                        onSelectActivity(act);
                        setStreamHoverIndex(null);
                      }}
                      className={`cursor-pointer transition-colors ${
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
                            <span className="text-xs font-mono font-bold text-amber-600 dark:text-amber-400">
                              [{act.officialRaceData.platform} · {act.officialRaceData.displayFatTime} FAT ·{' '}
                              {act.officialRaceData.placeFinish || 'Official'}]
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
                            <span className="text-[#FC4C02] font-bold">
                              · 👍 {act.kudosCount}
                            </span>
                          )}
                          {((Array.isArray(act.routeLatLngs) && act.routeLatLngs.length > 2) ||
                            (act.streams?.latlng && act.streams.latlng.length > 2)) && (
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                              · 🗺️ GPS
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
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30 text-[11px] font-mono font-semibold">
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
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 text-[11px] font-mono font-semibold">
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
                        {act.sportCategory === 'Running' && act.avgPaceSecsPerKm ? (
                          <>
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {formatPace(act.avgPaceSecsPerKm, distanceUnit)}
                            </div>
                            <div className="text-slate-500 text-xs">
                              {act.normalizedPower
                                ? `${act.normalizedPower}W`
                                : `GAP ${formatPace(act.gapPaceSecsPerKm, distanceUnit)}`}
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
                        <div className="font-bold text-[#1D4ED8] dark:text-[#60A5FA]">
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
                                className="inline-block mt-0.5 px-1.5 py-0.2 rounded text-[10px] font-medium text-slate-500 dark:text-slate-400 bg-stone-100 dark:bg-slate-800/80"
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
                              className={`inline-block mt-0.5 px-1.5 py-0.2 rounded text-[10px] font-bold ${
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
                                ? 'bg-blue-600 text-white'
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
                                ? 'bg-amber-500 text-white'
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

      {/* Deep Activity Stream, Auto-Detected Intervals & Similar Workout Inspector Modal */}
      {selectedActivity && (
        <div className="ap-modal-backdrop" onClick={() => onSelectActivity(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={selectedActivity.name}
            className="ap-modal-sheet max-w-5xl liquid-glass shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sm:hidden w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mt-3" />

            {/* Header */}
            <div className="sticky top-0 z-30 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md flex flex-wrap items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedActivity.sportCategory} ·{' '}
                  {selectedActivity.environment === 'INDOOR'
                    ? `Indoor (${selectedActivity.subType})`
                    : `Outdoor (${selectedActivity.subType})`}{' '}
                  · {selectedActivity.startDateLocal.replace('T', ' ').slice(0, 16)} ·{' '}
                  {selectedActivity.deviceName || selectedActivity.sourceBadges.join(' + ')}
                </div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5 truncate">
                  {selectedActivity.name}
                </h2>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    handleAssignToCompareSlot(selectedActivity, 'A');
                    if (similarHistoricalWorkouts.length > 0 && !compareIdB) {
                      handleAssignToCompareSlot(similarHistoricalWorkouts[0], 'B');
                    }
                    onSelectActivity(null);
                  }}
                  className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                >
                  <Columns2 className="w-3.5 h-3.5" />
                  <span className="hidden xs:inline sm:inline">Open in Split-View Compare</span>
                  <span className="inline sm:hidden">Compare</span>
                </button>
                <button
                  onClick={() => onSelectActivity(null)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                  aria-label="Close inspector"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-4 sm:p-6 space-y-6">
              {/* Top Physiological & Aerobic Decoupling Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
                  <div className="text-xs text-slate-500">Distance &amp; Moving Time</div>
                  <div className="text-base font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                    {selectedActivity.distanceMeters > 0
                      ? formatDistance(selectedActivity.distanceMeters, distanceUnit, 2)
                      : 'Indoor Session'}{' '}
                    · {formatDuration(selectedActivity.movingTimeSecs)}
                  </div>
                  <div className="text-xs font-mono text-slate-500 mt-0.5">
                    Elevation +{distanceUnit === 'mi' ? `${Math.round(selectedActivity.elevationGainMeters * 3.28084).toLocaleString()} ft` : `${selectedActivity.elevationGainMeters} m`}
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
                  <div className="text-xs text-slate-500">Primary Output</div>
                  <div className="text-base font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                    {selectedActivity.sportCategory === 'Running' && selectedActivity.avgPaceSecsPerKm
                      ? `${formatPace(selectedActivity.avgPaceSecsPerKm, distanceUnit)} (GAP ${formatPace(selectedActivity.gapPaceSecsPerKm, distanceUnit)})`
                      : selectedActivity.normalizedPower
                        ? `NP ${selectedActivity.normalizedPower}W (Avg ${selectedActivity.avgPower}W)`
                        : `Load ${selectedActivity.trainingLoad} TSS`}
                  </div>
                  <div className="text-xs font-mono text-slate-500 mt-0.5">
                    Training Load: {selectedActivity.trainingLoad} TSS · IF{' '}
                    {selectedActivity.intensityFactor || '—'}
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
                  <div className="text-xs text-slate-500">Aerobic Decoupling &amp; Efficiency</div>
                  <div
                    className={`text-base font-bold font-mono tabular-nums mt-1 ${
                      selectedActivity.aerobicDecouplingPct <= 3.5
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    EF {selectedActivity.efficiencyFactor || '—'} · Drift{' '}
                    {selectedActivity.aerobicDecouplingPct}%
                  </div>
                  <div className="text-xs font-mono text-slate-500 mt-0.5">
                    1st Half EF {selectedActivity.firstHalfEf} → 2nd Half EF{' '}
                    {selectedActivity.secondHalfEf}
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
                  <div className="text-xs text-slate-500">Heart Rate &amp; Cadence</div>
                  <div className="text-base font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                    {selectedActivity.avgHr} bpm avg · {selectedActivity.maxHr} max
                  </div>
                  <div className="text-xs font-mono text-slate-500 mt-0.5">
                    Cadence: {selectedActivity.avgCadence || '—'}{' '}
                    {selectedActivity.sportCategory === 'Running' ? 'spm' : 'rpm'}
                  </div>
                </div>
              </div>

              {/* ==========================================================================
                  COACH INSIGHTS: AEROBIC EFFICIENCY (EF) & CARDIAC DECOUPLING SUMMARY CARD
                 ========================================================================== */}
              {(() => {
                // 1. Compute live stream-verified 1st-half vs 2nd-half EF and Decoupling % if streams exist, else use activity fields
                const streams = selectedActivity.streams;
                let efOverall = selectedActivity.efficiencyFactor || 0;
                let efFirstHalf = selectedActivity.firstHalfEf || 0;
                let efSecondHalf = selectedActivity.secondHalfEf || 0;
                let decouplingPct = selectedActivity.aerobicDecouplingPct ?? 0;

                if (
                  streams &&
                  Array.isArray(streams.heartrate) &&
                  streams.heartrate.length >= 20 &&
                  ((Array.isArray(streams.watts) && streams.watts.length >= 20) ||
                    (Array.isArray(streams.velocitySmooth) && streams.velocitySmooth.length >= 20))
                ) {
                  const hrArr = streams.heartrate;
                  const outArr =
                    streams.watts && streams.watts.length === hrArr.length
                      ? streams.watts
                      : (streams.velocitySmooth || []).map((v) => v * 78);
                  const len = Math.min(hrArr.length, outArr.length);
                  const mid = Math.floor(len / 2);

                  const calcHalfEf = (start: number, end: number) => {
                    let sumOut = 0;
                    let sumHr = 0;
                    let count = 0;
                    for (let i = start; i < end; i++) {
                      const h = hrArr[i];
                      const o = outArr[i];
                      if (h > 65 && o > 20) {
                        sumOut += o;
                        sumHr += h;
                        count++;
                      }
                    }
                    if (count < 5 || sumHr <= 0) return 0;
                    return Number((sumOut / sumHr).toFixed(2));
                  };

                  const streamEf1 = calcHalfEf(0, mid);
                  const streamEf2 = calcHalfEf(mid, len);
                  const streamEfAll = calcHalfEf(0, len);
                  if (streamEf1 > 0 && streamEf2 > 0) {
                    efFirstHalf = streamEf1;
                    efSecondHalf = streamEf2;
                    if (!efOverall && streamEfAll > 0) efOverall = streamEfAll;
                    decouplingPct = Number(
                      (((streamEf1 - streamEf2) / Math.max(0.1, streamEf1)) * 100).toFixed(1)
                    );
                  }
                }

                if (!efOverall && selectedActivity.avgHr > 0) {
                  const baseOut =
                    selectedActivity.normalizedPower ||
                    selectedActivity.avgPower ||
                    (selectedActivity.distanceMeters > 0
                      ? (selectedActivity.distanceMeters /
                          Math.max(1, selectedActivity.movingTimeSecs)) *
                        78
                      : 210);
                  efOverall = Number((baseOut / selectedActivity.avgHr).toFixed(2));
                }
                if (!efFirstHalf && efOverall > 0) {
                  efFirstHalf = Number((efOverall * (1 + decouplingPct / 200)).toFixed(2));
                }
                if (!efSecondHalf && efOverall > 0) {
                  efSecondHalf = Number((efOverall * (1 - decouplingPct / 200)).toFixed(2));
                }

                // 2. Compare against athlete's 90-day peer workouts (same sport & environment)
                const peerWorkouts = activities.filter(
                  (a) =>
                    a.id !== selectedActivity.id &&
                    a.sportCategory === selectedActivity.sportCategory &&
                    a.environment === selectedActivity.environment &&
                    a.efficiencyFactor > 0.6 &&
                    a.efficiencyFactor < 3.5
                );
                const baselinePeerEf =
                  peerWorkouts.length > 0
                    ? Number(
                        (
                          peerWorkouts
                            .slice(0, 30)
                            .reduce((acc, a) => acc + a.efficiencyFactor, 0) /
                          Math.min(30, peerWorkouts.length)
                        ).toFixed(2)
                      )
                    : efOverall || 1.72;
                const efVsBaselinePct =
                  baselinePeerEf > 0
                    ? Number((((efOverall - baselinePeerEf) / baselinePeerEf) * 100).toFixed(1))
                    : 0;

                // 3. Classify Performance Quality & Exercise Physiology Interpretation
                let qualityGrade: {
                  title: string;
                  tier: 'OPTIMAL' | 'GOOD' | 'MODERATE' | 'HIGH_DRIFT';
                  badgeClass: string;
                  summary: string;
                  prescription: string;
                };

                if (decouplingPct < 0) {
                  qualityGrade = {
                    title: 'Negative-Split / Super-Coupled Execution',
                    tier: 'OPTIMAL',
                    badgeClass:
                      'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/35',
                    summary: `Second-half Efficiency Factor (${efSecondHalf.toFixed(2)}) exceeded first-half Efficiency Factor (${efFirstHalf.toFixed(2)}), producing ${decouplingPct.toFixed(1)}% decoupling. You generated more mechanical output per heartbeat in the final half of the session, indicating exceptional pacing discipline and zero cardiovascular drift.`,
                    prescription:
                      'Aerobic durability at this duration and intensity is fully consolidated. You have physiological headroom to progress either total session duration (+15–20%) or threshold interval density.',
                  };
                } else if (decouplingPct <= 2.5) {
                  qualityGrade = {
                    title: 'Elite Aerobic Durability & Stroke-Volume Stability',
                    tier: 'OPTIMAL',
                    badgeClass:
                      'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35',
                    summary: `Cardiac decoupling was minimal at ${decouplingPct.toFixed(1)}% (1st Half EF ${efFirstHalf.toFixed(2)} → 2nd Half EF ${efSecondHalf.toFixed(2)}). Your cardiovascular system maintained stable stroke volume and mitochondrial economy throughout the effort with negligible late-session heart rate drift.`,
                    prescription:
                      'Because decoupling stayed well under the 3.5% physiological benchmark, your aerobic base strongly supports this workload. Ready to advance intensity toward LT2 / Z4 threshold intervals.',
                  };
                } else if (decouplingPct <= 5.0) {
                  qualityGrade = {
                    title: 'Controlled Endurance Coupling (Target Zone)',
                    tier: 'GOOD',
                    badgeClass:
                      'bg-blue-500/15 text-blue-700 dark:text-sky-300 border-blue-500/35',
                    summary: `Cardiac decoupling measured ${decouplingPct.toFixed(1)}% (1st Half EF ${efFirstHalf.toFixed(2)} → 2nd Half EF ${efSecondHalf.toFixed(2)}), sitting within the standard 2.5%–5.0% physiological adaptation window. Mild late-workout heart rate drift occurred as slow-twitch fibers fatigued and accessory motor units were recruited.`,
                    prescription:
                      'Solid productive stimulus. Repeat this workout duration 1–2 more times while focusing on steady carbohydrate/electrolyte intake (60–80g/hr) and active cooling to compress drift below 3.0%.',
                  };
                } else {
                  qualityGrade = {
                    title: 'Elevated Cardiac Drift / Fatigue Decoupling (>5.0%)',
                    tier: 'HIGH_DRIFT',
                    badgeClass:
                      'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35',
                    summary: `Efficiency Factor dropped from ${efFirstHalf.toFixed(2)} in the first half to ${efSecondHalf.toFixed(2)} in the second half (${decouplingPct.toFixed(1)}% decoupling, exceeding the 5.0% durability threshold). Heart rate rose disproportionately to power/pace in the second half due to plasma volume loss, thermal strain, glycogen depletion, or Muscular Endurance (ME) fatigue.`,
                    prescription:
                      'Prioritize steady Zone 2 aerobic volume, verify indoor fan cooling (if on Smart Trainer/Zwift) or hydration strategy, and hold off on increasing interval intensity until decoupling at this duration drops below 5.0%.',
                  };
                }

                const maxHalfEf = Math.max(0.1, efFirstHalf, efSecondHalf);
                const pctBar1 = Math.min(100, Math.round((efFirstHalf / maxHalfEf) * 100));
                const pctBar2 = Math.min(100, Math.round((efSecondHalf / maxHalfEf) * 100));

                return (
                  <div className="rounded-2xl liquid-glass p-5 border border-blue-500/25 space-y-4">
                    {/* Card Header */}
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200/70 dark:border-white/10 pb-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-blue-500/15 text-blue-600 dark:text-sky-300 text-[11px] font-mono font-bold uppercase tracking-wider">
                            <Sparkles className="w-3.5 h-3.5" />
                            Coach Insights
                          </span>
                          <span
                            className={`px-2.5 py-0.5 rounded-md border text-xs font-mono font-bold ${qualityGrade.badgeClass}`}
                          >
                            {qualityGrade.title}
                          </span>
                          <ChartInfoTooltip
                            title="Workout Aerobic Efficiency (EF) & Cardiac Decoupling (Pa:Hr%)"
                            subtitle="Session-Level Cardiovascular Economy & Durability Audit"
                            whatItMeasures="Calculates Efficiency Factor (EF = Normalized Power or Equivalent Output ÷ Average Heart Rate) for the entire workout and splits the session into First Half (EF₁) vs. Second Half (EF₂) to quantify Cardiac Decoupling: ((EF₁ − EF₂) ÷ EF₁) × 100."
                            benchmarks="Decoupling < 2.5%: Elite durability. 2.5% – 5.0%: Normal productive endurance drift. > 5.0%: Significant cardiovascular drift indicating thermal stress, dehydration, or incomplete aerobic durability."
                            liveStatus={{
                              label: `EF ${efOverall.toFixed(2)} (${efVsBaselinePct >= 0 ? '+' : ''}${efVsBaselinePct}% vs Peer Avg) · Drift ${decouplingPct.toFixed(1)}%`,
                              state:
                                decouplingPct <= 3.5
                                  ? 'optimal'
                                  : decouplingPct <= 5.0
                                    ? 'neutral'
                                    : 'caution',
                              interpretation: qualityGrade.summary,
                            }}
                            coachingAction={qualityGrade.prescription}
                          />
                        </div>
                        <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 mt-1.5">
                          Aerobic Efficiency (EF) &amp; Cardiac Decoupling Performance Quality Audit
                        </h3>
                      </div>

                      <div className="text-right font-mono text-xs">
                        <span className="text-slate-500 block font-sans text-[11px]">
                          Modality Peer Baseline ({selectedActivity.environment === 'INDOOR' ? 'Virtual / Trainer' : 'Outdoor'})
                        </span>
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          Peer Mean EF: {baselinePeerEf.toFixed(2)}
                        </span>{' '}
                        <span
                          className={`font-bold ${
                            efVsBaselinePct >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          ({efVsBaselinePct >= 0 ? `+${efVsBaselinePct}%` : `${efVsBaselinePct}%`})
                        </span>
                      </div>
                    </div>

                    {/* 3-Column Quantitative Breakdown + 1st vs 2nd Half Split Visual */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
                      {/* Left 7 Cols: KPI Metrics & 1st vs 2nd Half EF Comparison Bars */}
                      <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono tabular-nums">
                        {/* Metric 1: Overall Aerobic Efficiency (EF) */}
                        <div className="rounded-xl liquid-glass-subtle p-3.5 flex flex-col justify-between">
                          <div>
                            <div className="text-[11px] font-sans font-semibold text-slate-500">
                              Aerobic Efficiency (EF)
                            </div>
                            <div className="text-2xl font-extrabold text-blue-600 dark:text-sky-400 mt-1">
                              {efOverall.toFixed(2)}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              Watts / Heartbeat (NP ÷ HR)
                            </div>
                          </div>
                          <div className="mt-2 pt-2 border-t border-slate-200/60 dark:border-white/10 text-[11px]">
                            <span
                              className={`font-bold ${
                                efVsBaselinePct >= 0
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-amber-600 dark:text-amber-400'
                              }`}
                            >
                              {efVsBaselinePct >= 0 ? `+${efVsBaselinePct}%` : `${efVsBaselinePct}%`}
                            </span>{' '}
                            <span className="text-slate-500 font-sans">vs 90d peer mean</span>
                          </div>
                        </div>

                        {/* Metric 2: Cardiac Decoupling (Pa:Hr%) */}
                        <div className="rounded-xl liquid-glass-subtle p-3.5 flex flex-col justify-between">
                          <div>
                            <div className="text-[11px] font-sans font-semibold text-slate-500">
                              Cardiac Decoupling
                            </div>
                            <div
                              className={`text-2xl font-extrabold mt-1 ${
                                decouplingPct <= 3.5
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : decouplingPct <= 5.0
                                    ? 'text-sky-600 dark:text-sky-400'
                                    : 'text-amber-600 dark:text-amber-400'
                              }`}
                            >
                              {decouplingPct > 0 ? `+${decouplingPct.toFixed(1)}%` : `${decouplingPct.toFixed(1)}%`}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              1st vs 2nd Half Drift
                            </div>
                          </div>
                          <div className="mt-2 pt-2 border-t border-slate-200/60 dark:border-white/10 text-[11px] font-sans">
                            Benchmark:{' '}
                            <strong className="font-mono text-emerald-600 dark:text-emerald-400">
                              &lt; 3.5% Optimal
                            </strong>
                          </div>
                        </div>

                        {/* Metric 3: 1st Half vs 2nd Half EF Split Bars */}
                        <div className="rounded-xl liquid-glass-subtle p-3.5 flex flex-col justify-between space-y-2">
                          <div className="text-[11px] font-sans font-semibold text-slate-500">
                            Half-by-Half Economy Split
                          </div>
                          <div className="space-y-1.5 text-xs">
                            <div>
                              <div className="flex justify-between text-[11px]">
                                <span className="font-sans text-slate-500">1st Half EF₁</span>
                                <span className="font-bold text-slate-900 dark:text-white">
                                  {efFirstHalf.toFixed(2)}
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden mt-0.5">
                                <div
                                  className="h-full bg-blue-500 rounded-full"
                                  style={{ width: `${pctBar1}%` }}
                                />
                              </div>
                            </div>
                            <div>
                              <div className="flex justify-between text-[11px]">
                                <span className="font-sans text-slate-500">2nd Half EF₂</span>
                                <span
                                  className={`font-bold ${
                                    efSecondHalf >= efFirstHalf * 0.965
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-amber-600 dark:text-amber-400'
                                  }`}
                                >
                                  {efSecondHalf.toFixed(2)}
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden mt-0.5">
                                <div
                                  className={`h-full rounded-full ${
                                    efSecondHalf >= efFirstHalf * 0.965
                                      ? 'bg-emerald-500'
                                      : 'bg-amber-500'
                                  }`}
                                  style={{ width: `${pctBar2}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Right 5 Cols: Exercise Physiologist Narrative & Coach Prescription */}
                      <div className="lg:col-span-5 rounded-xl liquid-glass-subtle p-3.5 flex flex-col justify-between space-y-2.5 text-xs">
                        <div className="space-y-1">
                          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
                            Physiological Assessment
                          </div>
                          <p className="text-slate-700 dark:text-slate-200 leading-relaxed">
                            {qualityGrade.summary}
                          </p>
                        </div>
                        <div className="pt-2 border-t border-slate-200/70 dark:border-white/10 space-y-1">
                          <div className="text-[10px] font-mono uppercase tracking-wider text-blue-600 dark:text-sky-400 font-semibold">
                            Coach Prescription
                          </div>
                          <p className="text-slate-700 dark:text-slate-300 font-medium leading-relaxed">
                            {qualityGrade.prescription}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Strava Kudos, Club Kudoers & Workout Comments Bar inside Activity Details Modal */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onToggleKudos && onToggleKudos(selectedActivity)}
                      className={`min-h-[34px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                        selectedActivity.hasKudoed
                          ? 'bg-[#FC4C02] text-white shadow-xs'
                          : 'border border-[#FC4C02]/40 bg-[#FC4C02]/10 text-[#FC4C02] hover:bg-[#FC4C02]/20'
                      }`}
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                      <span>
                        {selectedActivity.hasKudoed ? 'Kudoed on Thresh / Strava' : 'Give Kudos'}{' '}
                        (
                        {Math.max(
                          selectedActivity.kudosCount || 0,
                          (selectedActivity.kudoers || []).length
                        )}
                        )
                      </span>
                    </button>

                    {(selectedActivity.kudoers || []).map((k, kIdx) => {
                      const dispName =
                        k.name ||
                        `${k.firstname || ''} ${k.lastname || ''}`.trim() ||
                        'Athlete';
                      const dispInitials =
                        k.avatarInitials ||
                        dispName
                          .split(' ')
                          .map((p) => p[0] || '')
                          .join('')
                          .slice(0, 2)
                          .toUpperCase();
                      return (
                        <span
                          key={k.id || `${dispName}-${kIdx}`}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300"
                        >
                          <span className="w-4 h-4 rounded-full bg-[#FC4C02]/20 text-[#FC4C02] font-mono text-[10px] font-bold flex items-center justify-center">
                            {dispInitials}
                          </span>
                          <span>{dispName}</span>
                        </span>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedActivity.stravaPrCount > 0 && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 text-xs font-bold font-mono">
                        <Trophy className="w-3.5 h-3.5" />
                        {selectedActivity.stravaPrCount} PR
                        {selectedActivity.stravaPrCount > 1 ? 's' : ''}
                      </span>
                    )}
                    {selectedActivity.stravaId && (
                      <a
                        href={`https://www.strava.com/activities/${encodeURIComponent(
                          selectedActivity.stravaId
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#FC4C02]/40 bg-[#FC4C02]/10 hover:bg-[#FC4C02]/20 text-xs font-semibold text-[#FC4C02] transition-colors"
                      >
                        <span>View on Strava</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Existing Comments + Add Comment Form */}
                {(selectedActivity.comments || []).length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    {(selectedActivity.comments || []).map((c) => (
                      <div
                        key={c.id}
                        className="rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs"
                      >
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span className="font-bold text-slate-900 dark:text-slate-100">
                            {c.authorName || c.athleteName || 'Athlete'}
                          </span>
                          <span className="font-mono">{c.createdAt.slice(0, 10)}</span>
                        </div>
                        <p className="text-slate-700 dark:text-slate-300 mt-0.5">{c.text}</p>
                      </div>
                    ))}
                  </div>
                )}

                {onAddComment && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!modalCommentInput.trim()) return;
                      const text = modalCommentInput.trim();
                      setModalCommentInput('');
                      await onAddComment(selectedActivity, text);
                    }}
                    className="flex items-center gap-2 pt-1"
                  >
                    <input
                      type="text"
                      value={modalCommentInput}
                      onChange={(e) => setModalCommentInput(e.target.value)}
                      placeholder="Add a coaching note or Strava comment to this workout..."
                      className="flex-1 min-h-[34px] rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="submit"
                      disabled={!modalCommentInput.trim()}
                      className="min-h-[34px] px-3.5 py-1.5 rounded-lg bg-[#FC4C02] hover:bg-[#E34402] disabled:opacity-40 text-white text-xs font-semibold transition-colors inline-flex items-center gap-1.5"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Post Note</span>
                    </button>
                  </form>
                )}
              </div>

              {/* Synchronized Interactive GPS Route Map (Outdoor Workouts or Workouts with GPS Coordinates) */}
              {(selectedActivity.environment === 'OUTDOOR' ||
                (Array.isArray(selectedActivity.routeLatLngs) &&
                  selectedActivity.routeLatLngs.length > 2) ||
                Boolean(
                  selectedActivity.streams?.latlng && selectedActivity.streams.latlng.length > 2
                )) && (
                <InteractiveRouteMap
                  mode="SINGLE"
                  activity={selectedActivity}
                  distanceUnit={distanceUnit}
                  activeStreamIndex={streamHoverIndex}
                  onHoverStreamIndex={setStreamHoverIndex}
                  zoomStreamRange={streamZoomRange}
                  selectedSegmentId={modalSelectedSegmentId}
                  onSelectSegmentId={(segId: string) => {
                    setModalSelectedSegmentId(segId);
                  }}
                  heightClass="h-[340px] sm:h-[400px]"
                />
              )}

              {/* 5-Second Post-Workout RPE, Fueling (g/hr Carbs & mg/hr Sodium) & Gear Quick-Log */}
              {(() => {
                const curLog = quickLogsById[selectedActivity.id] ||
                  selectedActivity.quickLog || {
                    rpe: 6,
                    feelRating: 'NORMAL' as const,
                    carbsGramsPerHour: selectedActivity.sportCategory === 'Cycling' ? 75 : 60,
                    sodiumMgPerHour: 550,
                    gearName: selectedActivity.gearName || '',
                    loggedAt: '',
                  };
                return (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-950/60 p-3.5 space-y-2.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="ap-status-prime px-2 py-0.5 rounded-md font-mono text-[10px] font-bold uppercase">
                          5s Post-Workout Quick-Log
                        </span>
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          RPE, Exogenous Fueling (`g/hr` · `mg/hr`) &amp; Gear Tag
                        </span>
                      </div>
                      {quickLogSavedMsg ? (
                        <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                          ✓ {quickLogSavedMsg}
                        </span>
                      ) : curLog.loggedAt ? (
                        <span className="font-mono text-[11px] text-slate-400">
                          Logged {new Date(curLog.loggedAt).toLocaleDateString()}
                        </span>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
                      {/* 1-Tap RPE 1–10 Selector */}
                      <div className="sm:col-span-5 flex flex-wrap items-center gap-1">
                        <span className="text-[11px] font-mono text-slate-500 mr-1">RPE:</span>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() =>
                              saveQuickLogForActivity(selectedActivity.id, { rpe: val })
                            }
                            className={`w-6 h-6 rounded-md font-mono text-[11px] font-bold transition-colors ${
                              curLog.rpe === val
                                ? val >= 8
                                  ? 'bg-rose-600 text-white'
                                  : val >= 5
                                    ? 'bg-amber-500 text-white'
                                    : 'bg-emerald-600 text-white'
                                : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
                            }`}
                          >
                            {val}
                          </button>
                        ))}
                      </div>

                      {/* Carbs g/hr */}
                      <div className="sm:col-span-2 flex items-center gap-1.5">
                        <label className="text-[11px] font-mono text-slate-500 whitespace-nowrap">
                          Carbs:
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={150}
                          step={5}
                          value={curLog.carbsGramsPerHour ?? 60}
                          onChange={(e) =>
                            saveQuickLogForActivity(selectedActivity.id, {
                              carbsGramsPerHour: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                          className="w-16 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-2 py-1 font-mono text-xs text-slate-900 dark:text-slate-100"
                        />
                        <span className="text-[10px] font-mono text-slate-400">g/hr</span>
                      </div>

                      {/* Sodium mg/hr */}
                      <div className="sm:col-span-2 flex items-center gap-1.5">
                        <label className="text-[11px] font-mono text-slate-500 whitespace-nowrap">
                          Na+:
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={2000}
                          step={50}
                          value={curLog.sodiumMgPerHour ?? 500}
                          onChange={(e) =>
                            saveQuickLogForActivity(selectedActivity.id, {
                              sodiumMgPerHour: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                          className="w-16 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-2 py-1 font-mono text-xs text-slate-900 dark:text-slate-100"
                        />
                        <span className="text-[10px] font-mono text-slate-400">mg/h</span>
                      </div>

                      {/* Gear / Shoe Tag */}
                      <div className="sm:col-span-3 flex items-center gap-1.5">
                        <label className="text-[11px] font-mono text-slate-500 whitespace-nowrap">
                          Gear:
                        </label>
                        <input
                          type="text"
                          placeholder={
                            selectedActivity.sportCategory === 'Cycling'
                              ? 'e.g. Road / Trainer Bike'
                              : 'e.g. Daily Trainer / Carbon Shoe'
                          }
                          value={curLog.gearName ?? ''}
                          onChange={(e) =>
                            saveQuickLogForActivity(selectedActivity.id, {
                              gearName: e.target.value,
                            })
                          }
                          className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-2.5 py-1 text-xs text-slate-900 dark:text-slate-100"
                        />
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* High-Frequency 1Hz uPlot Telemetry Canvas + Web Worker Analytics Strip */}
              {(() => {
                const activeStream = liveDexieStream?.streams || selectedActivity.streams;
                const hasStreamPoints = Boolean(activeStream && Array.isArray(activeStream.time) && activeStream.time.length > 1);
                if (!hasStreamPoints) {
                  return (
                    <div className="rounded-xl ap-well p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="space-y-0.5">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          Summary telemetry only — 1Hz stream not recorded
                        </div>
                        <div className="text-slate-600 dark:text-slate-400">
                          Upload the original Garmin .FIT / .GPX file or fetch provider streams if available.
                        </div>
                      </div>
                      {onLoadActivityStreams && (
                        <button
                          type="button"
                          onClick={() => onLoadActivityStreams(selectedActivity)}
                          className="ap-btn-secondary px-3 text-xs"
                        >
                          Fetch Provider Stream
                        </button>
                      )}
                    </div>
                  );
                }
                const effectiveProfile =
                  athleteProfile || buildCompleteAthleteProfile({ weightKg: athleteWeightKg });
                const debriefReport = generatePostWorkoutDebrief(
                  selectedActivity,
                  activeStream,
                  effectiveProfile
                );

                return (
                  <div className="space-y-4">
                    {debriefReport && debriefReport.insights.length > 0 && (
                      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/75 dark:bg-slate-950/75 p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="ap-status-info px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider">
                                30-Second Signal Debrief
                              </span>
                              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                {debriefReport.headline}
                              </h3>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              Deterministic 1Hz physiology scan — click any insight below to zoom the stream canvas to its exact telemetry window.
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 font-mono text-xs tabular-nums">
                            <span
                              className={`px-2.5 py-1 rounded-lg font-bold ${
                                debriefReport.executionScore >= 82
                                  ? 'ap-status-prime'
                                  : debriefReport.executionScore >= 65
                                    ? 'ap-status-caution'
                                    : 'ap-status-strained'
                              }`}
                            >
                              Execution {debriefReport.executionScore}/100
                            </span>
                            {debriefReport.wPrimeMinPct != null && (
                              <span className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200">
                                Min W&apos;: <strong>{debriefReport.wPrimeMinPct}%</strong>
                              </span>
                            )}
                            {debriefReport.aerobicDecouplingPct != null && (
                              <span className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200">
                                Drift: <strong>{debriefReport.aerobicDecouplingPct}%</strong>
                              </span>
                            )}
                            {debriefReport.bestHrr60Bpm != null && (
                              <span className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200">
                                Best HRR60: <strong>-{debriefReport.bestHrr60Bpm} bpm</strong>
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                          {debriefReport.insights.map((ins) => {
                            const pillClass =
                              ins.severity === 'PRIME'
                                ? 'ap-status-prime'
                                : ins.severity === 'CAUTION'
                                  ? 'ap-status-caution'
                                  : ins.severity === 'STRAINED'
                                    ? 'ap-status-strained'
                                    : 'ap-status-info';
                            return (
                              <button
                                key={ins.id}
                                type="button"
                                onClick={() =>
                                  setDebriefZoomWindow({
                                    startSec: ins.windowStartSec,
                                    endSec: ins.windowEndSec,
                                    nonce: Date.now(),
                                  })
                                }
                                className="text-left rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-500/60 dark:hover:border-sky-400/60 bg-slate-50/70 dark:bg-slate-900/60 p-3 space-y-1.5 transition-all group"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span
                                    className={`${pillClass} px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider`}
                                  >
                                    {ins.badge}
                                  </span>
                                  <span className="text-[11px] font-mono text-blue-600 dark:text-sky-400 font-semibold group-hover:underline">
                                    {ins.timestampLabel} ↗
                                  </span>
                                </div>
                                <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                                  {ins.title}
                                </div>
                                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                                  {ins.detail}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <UPlotStreamChart
                      streams={activeStream!}
                      sportCategory={selectedActivity.sportCategory}
                      distanceUnit={distanceUnit}
                      athleteWeightKg={athleteWeightKg}
                      intervals={
                        workerAnalytics?.intervals ||
                        liveDexieStream?.intervals ||
                        selectedActivity.intervals
                      }
                      peakWindows={workerAnalytics?.peakWindows}
                      workerMetrics={workerAnalytics}
                      isWorkerProcessing={isWorkerProcessing}
                      onTriggerWorker1HzUpsample={() => {
                        setIsWorkerProcessing(true);
                        upsampleAndAnalyzeActivityInWorker({
                          ...selectedActivity,
                          streams: activeStream,
                        })
                          .then(({ analytics }) => setWorkerAnalytics(analytics))
                          .finally(() => setIsWorkerProcessing(false));
                      }}
                      syncKey="thresh-activity-inspector"
                      onHoverIndex={setStreamHoverIndex}
                      zoomRange={streamZoomRange}
                      zoomWindowSecs={debriefZoomWindow}
                      onZoomRangeChange={setStreamZoomRange}
                      height={280}
                    />
                  </div>
                );
              })()}

              {/* Heart Rate Zone Distribution Summary Chart (Interactive SVG Histogram + Stacked Polarization + Zone Breakdown) */}
              {(() => {
                const rawHrZones = Array.isArray(selectedActivity.zoneSecs?.hr)
                  ? selectedActivity.zoneSecs.hr
                  : [0, 0, 0, 0, 0, 0, 0];

                // Fold Z7 into Z6 so we have 6 canonical physiological HR zones (Z1..Z6)
                let sixZones = [
                  Number(rawHrZones[0] || 0),
                  Number(rawHrZones[1] || 0),
                  Number(rawHrZones[2] || 0),
                  Number(rawHrZones[3] || 0),
                  Number(rawHrZones[4] || 0),
                  Number(rawHrZones[5] || 0) + Number(rawHrZones[6] || 0),
                ];

                let zoneSourceLabel = 'Synced FIT Heart Rate Zones';
                const rawSum = sixZones.reduce((a, b) => a + b, 0);

                // Compute exact time in each HR zone from second-by-second heartrate stream when summary zoneSecs are absent
                const resolvedStream = liveDexieStream?.streams || selectedActivity.streams;
                if (
                  rawSum <= 0 &&
                  resolvedStream?.heartrate &&
                  resolvedStream.heartrate.length > 1
                ) {
                  const hrArr = resolvedStream.heartrate;
                  const tArr = resolvedStream.time;
                  const computed = [0, 0, 0, 0, 0, 0];
                  for (let i = 0; i < hrArr.length; i++) {
                    const hr = hrArr[i];
                    if (!hr || hr <= 40) continue;
                    const dt =
                      i > 0 && tArr[i] != null && tArr[i - 1] != null
                        ? Math.max(1, Math.min(30, tArr[i] - tArr[i - 1]))
                        : Math.max(
                            1,
                            Math.round((selectedActivity.movingTimeSecs || 3600) / hrArr.length)
                          );
                    if (hr < 132) computed[0] += dt;
                    else if (hr < 146) computed[1] += dt;
                    else if (hr < 156) computed[2] += dt;
                    else if (hr < 164) computed[3] += dt;
                    else if (hr < 171) computed[4] += dt;
                    else computed[5] += dt;
                  }
                  if (computed.reduce((a, b) => a + b, 0) > 0) {
                    sixZones = computed;
                    zoneSourceLabel = 'Computed from Second-by-Second HR Stream';
                  }
                }

                const totalZoneSecs = Math.max(
                  1,
                  sixZones.reduce((a, b) => a + b, 0)
                );

                // Infer Coach Expected Zone Distribution Profile for the current activity type
                type ArchetypeId =
                  | 'RECOVERY'
                  | 'ENDURANCE'
                  | 'TEMPO_SWEETSPOT'
                  | 'THRESHOLD'
                  | 'VO2MAX_RACE';

                const ARCHETYPE_PROFILES: Record<
                  ArchetypeId,
                  {
                    id: ArchetypeId;
                    label: string;
                    shortLabel: string;
                    expectedPcts: [number, number, number, number, number, number]; // Z1..Z6 sum = 100
                    rationale: string;
                  }
                > = {
                  RECOVERY: {
                    id: 'RECOVERY',
                    label: 'Active Recovery / Regeneration',
                    shortLabel: 'Recovery (Z1)',
                    expectedPcts: [68, 28, 4, 0, 0, 0],
                    rationale:
                      'Parasympathetic flush & capillary perfusion (<81% LTHR) with zero glycolytic or autonomic strain.',
                  },
                  ENDURANCE: {
                    id: 'ENDURANCE',
                    label: 'Aerobic Endurance Base (Seiler Z2)',
                    shortLabel: 'Endurance (Z2)',
                    expectedPcts: [22, 64, 10, 4, 0, 0],
                    rationale:
                      'Maximizes PGC-1α mitochondrial biogenesis & fat oxidation below LT1 while avoiding Z3 grey-zone fatigue.',
                  },
                  TEMPO_SWEETSPOT: {
                    id: 'TEMPO_SWEETSPOT',
                    label: 'Tempo / Sweet Spot Muscular Endurance',
                    shortLabel: 'Tempo / SST (Z3)',
                    expectedPcts: [15, 38, 32, 12, 3, 0],
                    rationale:
                      'Sustained LT1–LT2 aerobic torque & glycogen economy for long climbs, gravel, or marathon pace.',
                  },
                  THRESHOLD: {
                    id: 'THRESHOLD',
                    label: 'Lactate Threshold (LT2 / FTP Intervals)',
                    shortLabel: 'Threshold (Z4)',
                    expectedPcts: [14, 28, 22, 28, 7, 1],
                    rationale:
                      'Accumulates 20–35% of session time near MLSS/LTHR (Z4) with Z1–Z2 recovery valleys between work reps.',
                  },
                  VO2MAX_RACE: {
                    id: 'VO2MAX_RACE',
                    label: 'VO2max Intervals / Race Execution',
                    shortLabel: 'VO2max / Race (Z5+)',
                    expectedPcts: [12, 26, 18, 22, 16, 6],
                    rationale:
                      'High-intensity central stroke-volume & anaerobic recruitment (>100% LTHR) typical of races or VO2max blocks.',
                  },
                };

                const titleAndSub = `${selectedActivity.name} ${selectedActivity.subType}`.toLowerCase();
                const ifVal = selectedActivity.intensityFactor || 0;
                const avgHrVal = selectedActivity.avgHr || 0;
                const durSecs = selectedActivity.movingTimeSecs || 0;
                const workIvCount = (selectedActivity.intervals || []).filter(
                  (iv) => iv.type === 'WORK' && (iv.intensityPct || 0) >= 95
                ).length;

                let detectedArchetypeId: ArchetypeId = 'ENDURANCE';
                if (
                  /race|crit|zwift.*race|vo2|hiit|tabata|sprint|5k|10k|anaerobic|track/i.test(
                    titleAndSub
                  ) ||
                  ifVal >= 0.94 ||
                  avgHrVal >= 158
                ) {
                  detectedArchetypeId = 'VO2MAX_RACE';
                } else if (
                  /threshold|ftp|lt2|over-under|cruise|tt|time trial|interval/i.test(titleAndSub) ||
                  ifVal >= 0.86 ||
                  avgHrVal >= 151 ||
                  workIvCount >= 3
                ) {
                  detectedArchetypeId = 'THRESHOLD';
                } else if (
                  /tempo|sweet spot|sst|climb|hilly|gravel|group|progression|half marathon|marathon/i.test(
                    titleAndSub
                  ) ||
                  ifVal >= 0.78 ||
                  avgHrVal >= 143
                ) {
                  detectedArchetypeId = 'TEMPO_SWEETSPOT';
                } else if (
                  /recovery|easy|shakeout|regen|warmup|cooldown|coffee|spin/i.test(titleAndSub) ||
                  (durSecs <= 2400 && avgHrVal > 0 && avgHrVal < 131) ||
                  (ifVal > 0 && ifVal < 0.63)
                ) {
                  detectedArchetypeId = 'RECOVERY';
                }

                const activeArchetypeId: ArchetypeId =
                  zoneArchetypeOverride === 'AUTO' ? detectedArchetypeId : zoneArchetypeOverride;
                const expectedProfile = ARCHETYPE_PROFILES[activeArchetypeId];

                const zoneMeta = [
                  {
                    zone: 'Z1',
                    name: 'Z1 Active Recovery',
                    shortLabel: 'Z1 Recovery',
                    bpmRange: '< 132 bpm',
                    pctLthr: '< 81% LTHR',
                    effect: 'Parasympathetic recovery & capillary perfusion',
                    colorHex: '#64748B',
                    barClass: 'bg-slate-500',
                    textClass: 'text-slate-600 dark:text-slate-300',
                  },
                  {
                    zone: 'Z2',
                    name: 'Z2 Aerobic Endurance',
                    shortLabel: 'Z2 Endurance',
                    bpmRange: '132–145 bpm',
                    pctLthr: '81–89% LTHR',
                    effect: 'Mitochondrial density & fat oxidation base',
                    colorHex: '#3B82F6',
                    barClass: 'bg-blue-500',
                    textClass: 'text-blue-600 dark:text-blue-400',
                  },
                  {
                    zone: 'Z3',
                    name: 'Z3 Tempo / Sweet Spot',
                    shortLabel: 'Z3 Tempo',
                    bpmRange: '146–155 bpm',
                    pctLthr: '90–95% LTHR',
                    effect: 'Muscular endurance & glycogen economy',
                    colorHex: '#10B981',
                    barClass: 'bg-emerald-500',
                    textClass: 'text-emerald-600 dark:text-emerald-400',
                  },
                  {
                    zone: 'Z4',
                    name: 'Z4 Lactate Threshold',
                    shortLabel: 'Z4 Threshold',
                    bpmRange: '156–163 bpm',
                    pctLthr: '96–100% LTHR',
                    effect: 'Lactate clearance & sustainable race pace',
                    colorHex: '#F59E0B',
                    barClass: 'bg-amber-500',
                    textClass: 'text-amber-600 dark:text-amber-400',
                  },
                  {
                    zone: 'Z5',
                    name: 'Z5 VO2max Ceiling',
                    shortLabel: 'Z5 VO2max',
                    bpmRange: '164–170 bpm',
                    pctLthr: '101–104% LTHR',
                    effect: 'Maximal stroke volume & central O2 uptake',
                    colorHex: '#F97316',
                    barClass: 'bg-orange-500',
                    textClass: 'text-orange-600 dark:text-orange-400',
                  },
                  {
                    zone: 'Z6',
                    name: 'Z6 Anaerobic Capacity',
                    shortLabel: 'Z6 Anaerobic',
                    bpmRange: '171+ bpm',
                    pctLthr: '> 104% LTHR',
                    effect: 'Glycolytic power & peak neuromuscular recruitment',
                    colorHex: '#EF4444',
                    barClass: 'bg-red-500',
                    textClass: 'text-red-600 dark:text-red-400',
                  },
                ].map((m, idx) => {
                  const secs = sixZones[idx] || 0;
                  const pct = Number(((secs / totalZoneSecs) * 100).toFixed(1));
                  const expectedPct = expectedProfile.expectedPcts[idx] || 0;
                  const expectedSecs = Math.round((expectedPct / 100) * totalZoneSecs);
                  const deltaPct = Number((pct - expectedPct).toFixed(1));
                  return {
                    ...m,
                    secs,
                    mins: Number((secs / 60).toFixed(1)),
                    pct,
                    expectedPct,
                    expectedSecs,
                    deltaPct,
                  };
                });

                const maxZoneSecs = Math.max(
                  60,
                  ...zoneMeta.map((z) =>
                    showAutoZoneInsight ? Math.max(z.secs, z.expectedSecs) : z.secs
                  )
                );
                const dominantZone = [...zoneMeta].sort((a, b) => b.secs - a.secs)[0];
                const lowAerobicSecs = zoneMeta[0].secs + zoneMeta[1].secs;
                const thresholdSecs = zoneMeta[2].secs + zoneMeta[3].secs;
                const highIntensitySecs = zoneMeta[4].secs + zoneMeta[5].secs;

                const lowAerobicPct = Math.round((lowAerobicSecs / totalZoneSecs) * 100);
                const thresholdPct = Math.round((thresholdSecs / totalZoneSecs) * 100);
                const highIntensityPct = Math.max(0, 100 - lowAerobicPct - thresholdPct);

                const expectedLowPct =
                  expectedProfile.expectedPcts[0] + expectedProfile.expectedPcts[1];
                const expectedThresholdPct =
                  expectedProfile.expectedPcts[2] + expectedProfile.expectedPcts[3];
                const expectedHighPct =
                  expectedProfile.expectedPcts[4] + expectedProfile.expectedPcts[5];

                // Compute 0-100% Zone Compliance Score (100 - Total Variation Distance)
                const totalAbsDeviation = zoneMeta.reduce(
                  (acc, z) => acc + Math.abs(z.pct - z.expectedPct),
                  0
                );
                const complianceScore = Math.max(
                  0,
                  Math.min(100, Math.round(100 - totalAbsDeviation * 0.5))
                );
                const biggestOverZone = [...zoneMeta].sort((a, b) => b.deltaPct - a.deltaPct)[0];
                const biggestUnderZone = [...zoneMeta].sort((a, b) => a.deltaPct - b.deltaPct)[0];

                let complianceSummary = '';
                if (complianceScore >= 82) {
                  complianceSummary = `High zone fidelity (${complianceScore}% match vs. ${expectedProfile.label}). Your actual cardiac time-in-zone closely tracked the coach's prescribed physiological envelope.`;
                } else if (
                  (activeArchetypeId === 'ENDURANCE' || activeArchetypeId === 'RECOVERY') &&
                  thresholdPct + highIntensityPct > expectedThresholdPct + expectedHighPct + 12
                ) {
                  complianceSummary = `Upward intensity creep detected (${complianceScore}% match): ${biggestOverZone.shortLabel} was +${biggestOverZone.deltaPct}% above the ${expectedProfile.shortLabel} target while ${biggestUnderZone.shortLabel} was ${biggestUnderZone.deltaPct}% below target. Guard ceiling discipline on surges/climbs.`;
                } else if (
                  (activeArchetypeId === 'THRESHOLD' || activeArchetypeId === 'VO2MAX_RACE') &&
                  lowAerobicPct > expectedLowPct + 15
                ) {
                  complianceSummary = `Lower cardiac strain than typical ${expectedProfile.shortLabel} template (${complianceScore}% match): ${biggestUnderZone.shortLabel} was ${biggestUnderZone.deltaPct}% below target, often due to short interval durations, cardiac lag, or extended coasting/recovery valleys.`;
                } else {
                  complianceSummary = `Moderate deviation from ${expectedProfile.shortLabel} prescription (${complianceScore}% match): Peak positive variance in ${biggestOverZone.shortLabel} (${biggestOverZone.deltaPct >= 0 ? `+${biggestOverZone.deltaPct}%` : `${biggestOverZone.deltaPct}%`}) vs. ${biggestUnderZone.shortLabel} (${biggestUnderZone.deltaPct}%).`;
                }

                const activeHoverZone =
                  hrZoneHoverIdx !== null && zoneMeta[hrZoneHoverIdx]
                    ? zoneMeta[hrZoneHoverIdx]
                    : dominantZone;

                return (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
                    {/* Header, Auto-Zone Insight Toggle & Archetype Selector */}
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                            Heart Rate Zone Distribution Summary (Z1–Z6 Time in Zone)
                          </h3>
                          <ChartInfoTooltip
                            title="Heart Rate Zone Distribution & Auto-Zone Coach Overlay"
                            subtitle="Actual Time-in-Zone vs. Prescribed Workout Archetype"
                            whatItMeasures="Compares your actual second-by-second time spent across the 6 physiological Heart Rate zones (Z1 Active Recovery through Z6 Anaerobic) against the Coach's Expected Zone Distribution for this session's physiological archetype."
                            benchmarks="Zone Compliance ≥ 80%: Disciplined execution matching intended energy-system stimulus. On Z2 Endurance days, Z3+ ('grey zone' creep) should remain under 15%."
                            liveStatus={{
                              label: `${expectedProfile.shortLabel} · ${complianceScore}% Zone Compliance`,
                              state:
                                complianceScore >= 80
                                  ? 'optimal'
                                  : complianceScore >= 65
                                    ? 'neutral'
                                    : 'caution',
                              interpretation: complianceSummary,
                            }}
                            coachingAction="Toggle 'Auto-Zone Insight' to inspect dashed coach target markers on each zone bar, or switch the target archetype dropdown to compare your session against Endurance, Tempo, Threshold, or VO2max templates."
                          />
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {zoneSourceLabel} · Total Tracked HR Time:{' '}
                          <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                            {formatDuration(totalZoneSecs)}
                          </span>{' '}
                          · Dominant Zone:{' '}
                          <span className={`font-mono font-bold ${dominantZone.textClass}`}>
                            {dominantZone.name} ({dominantZone.pct}%)
                          </span>
                        </p>
                      </div>

                      {/* Auto-Zone Insight Toggle + Archetype Override Selector */}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowAutoZoneInsight((prev) => !prev)}
                          className={`min-h-[32px] inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold transition-all border ${
                            showAutoZoneInsight
                              ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/40 shadow-2xs'
                              : 'liquid-capsule-track text-slate-600 dark:text-slate-400 border-transparent hover:text-slate-900 dark:hover:text-slate-200'
                          }`}
                        >
                          <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                          <span>Auto-Zone Insight</span>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold ${
                              showAutoZoneInsight
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                            }`}
                          >
                            {showAutoZoneInsight ? 'ON' : 'OFF'}
                          </span>
                        </button>

                        {showAutoZoneInsight && (
                          <select
                            value={zoneArchetypeOverride}
                            onChange={(e) =>
                              setZoneArchetypeOverride(
                                e.target.value as typeof zoneArchetypeOverride
                              )
                            }
                            aria-label="Target Workout Archetype for Auto-Zone Insight"
                            className="min-h-[32px] rounded-xl liquid-glass-subtle px-2.5 py-1 text-xs font-mono text-slate-800 dark:text-slate-200"
                          >
                            <option value="AUTO">
                              Auto-Detected: {ARCHETYPE_PROFILES[detectedArchetypeId].shortLabel}
                            </option>
                            <option value="RECOVERY">Target: Recovery (Z1)</option>
                            <option value="ENDURANCE">Target: Endurance Base (Z2)</option>
                            <option value="TEMPO_SWEETSPOT">Target: Tempo / Sweet Spot (Z3)</option>
                            <option value="THRESHOLD">Target: Lactate Threshold (Z4)</option>
                            <option value="VO2MAX_RACE">Target: VO2max / Race (Z5+)</option>
                          </select>
                        )}
                      </div>
                    </div>

                    {/* Auto-Zone Coach Insight Banner (when toggled ON) */}
                    {showAutoZoneInsight && (
                      <div className="rounded-xl bg-indigo-500/8 dark:bg-indigo-500/12 border border-indigo-500/30 p-3.5 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[10px] font-mono font-bold uppercase tracking-wider">
                              <Sparkles className="w-3 h-3" />
                              Auto-Zone Coach Overlay
                            </span>
                            <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                              Expected Archetype: {expectedProfile.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 font-mono text-xs">
                            <span
                              className={`px-2 py-0.5 rounded-md font-bold border ${
                                complianceScore >= 80
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35'
                                  : complianceScore >= 65
                                    ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/35'
                                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35'
                              }`}
                            >
                              {complianceScore}% Zone Compliance
                            </span>
                          </div>
                        </div>

                        <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                          {complianceSummary}{' '}
                          <span className="text-slate-500 dark:text-slate-400">
                            ({expectedProfile.rationale})
                          </span>
                        </p>
                      </div>
                    )}

                    {/* Active Zone Hover Readout */}
                    {activeHoverZone && (
                      <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className={`font-bold ${activeHoverZone.textClass}`}>
                            {activeHoverZone.name} ({activeHoverZone.bpmRange})
                          </span>
                          <span className="font-bold text-slate-900 dark:text-slate-100">
                            Actual: {formatStopwatch(activeHoverZone.secs)} ({activeHoverZone.pct}%)
                          </span>
                          {showAutoZoneInsight && (
                            <span className="text-indigo-600 dark:text-indigo-400 font-bold">
                              Coach Target: {formatStopwatch(activeHoverZone.expectedSecs)} (
                              {activeHoverZone.expectedPct}% · Δ{' '}
                              {activeHoverZone.deltaPct >= 0
                                ? `+${activeHoverZone.deltaPct}%`
                                : `${activeHoverZone.deltaPct}%`}
                              )
                            </span>
                          )}
                        </div>
                        <span className="font-sans text-slate-500 hidden sm:inline">
                          {activeHoverZone.effect}
                        </span>
                      </div>
                    )}

                    {/* 3-Bucket Seiler Polarization Summary Strip + Dual Stacked Distribution Bar */}
                    <div className="rounded-lg bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
                        <span className="text-blue-600 dark:text-blue-400 font-semibold">
                          Low Aerobic (Z1–Z2): {formatStopwatch(lowAerobicSecs)} ({lowAerobicPct}%
                          {showAutoZoneInsight ? ` vs ${expectedLowPct}% exp` : ''})
                        </span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                          Tempo / Threshold (Z3–Z4): {formatStopwatch(thresholdSecs)} ({thresholdPct}%
                          {showAutoZoneInsight ? ` vs ${expectedThresholdPct}% exp` : ''})
                        </span>
                        <span className="text-red-600 dark:text-red-400 font-semibold">
                          VO2max / Anaerobic (Z5–Z6): {formatStopwatch(highIntensitySecs)} (
                          {highIntensityPct}%
                          {showAutoZoneInsight ? ` vs ${expectedHighPct}% exp` : ''})
                        </span>
                      </div>

                      {/* Actual 100% Stacked Bar */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
                          <span>Actual Session Distribution</span>
                          <span>100%</span>
                        </div>
                        <div className="w-full h-3.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden flex">
                          {zoneMeta.map((z, idx) =>
                            z.pct > 0 ? (
                              <div
                                key={z.zone}
                                style={{ width: `${z.pct}%`, backgroundColor: z.colorHex }}
                                title={`${z.name}: Actual ${formatStopwatch(z.secs)} (${z.pct}%)`}
                                onMouseEnter={() => setHrZoneHoverIdx(idx)}
                                className="h-full transition-all cursor-pointer first:rounded-l-full last:rounded-r-full"
                              />
                            ) : null
                          )}
                        </div>
                      </div>

                      {/* Coach Expected 100% Stacked Bar (when Auto-Zone Insight is ON) */}
                      {showAutoZoneInsight && (
                        <div className="space-y-1 pt-0.5">
                          <div className="flex items-center justify-between text-[10px] font-mono text-indigo-600 dark:text-indigo-400">
                            <span>
                              Coach Expected Distribution ({expectedProfile.shortLabel})
                            </span>
                            <span>Target 100%</span>
                          </div>
                          <div className="w-full h-2.5 rounded-full bg-slate-200/70 dark:bg-slate-800/70 overflow-hidden flex opacity-85 border border-dashed border-indigo-500/40">
                            {zoneMeta.map((z, idx) =>
                              z.expectedPct > 0 ? (
                                <div
                                  key={`exp-${z.zone}`}
                                  style={{
                                    width: `${z.expectedPct}%`,
                                    backgroundColor: z.colorHex,
                                  }}
                                  title={`${z.name}: Coach Target ${formatStopwatch(z.expectedSecs)} (${z.expectedPct}%)`}
                                  onMouseEnter={() => setHrZoneHoverIdx(idx)}
                                  className="h-full transition-all cursor-pointer first:rounded-l-full last:rounded-r-full"
                                />
                              ) : null
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Interactive SVG Vertical Column Chart + Detailed Horizontal Zone Breakdown */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
                      {/* Left 7 Cols: SVG Vertical Bar Distribution Chart with Coach Expected Overlay */}
                      <div
                        className="lg:col-span-7 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50 p-3 select-none space-y-2"
                        onMouseLeave={() => setHrZoneHoverIdx(null)}
                      >
                        {showAutoZoneInsight && (
                          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] font-mono">
                            <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-semibold">
                              <span className="w-2.5 h-2.5 rounded-xs bg-blue-500 inline-block" />
                              Solid Bar = Actual Time in Zone
                            </span>
                            <span className="inline-flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 font-semibold">
                              <span className="w-3.5 h-0.5 border-t-2 border-dashed border-indigo-500 inline-block" />
                              Dashed Cap &amp; Curve = Coach Expected ({expectedProfile.shortLabel})
                            </span>
                          </div>
                        )}

                        <svg viewBox="0 0 540 226" className="w-full h-56">
                          {(() => {
                            const chartLeft = 58;
                            const chartRight = 492;
                            const chartW = chartRight - chartLeft;
                            const chartTop = 24;
                            const chartBottom = 170;
                            const chartH = chartBottom - chartTop;
                            const colSlotW = chartW / zoneMeta.length;
                            const barW = Math.min(44, colSlotW * 0.58);

                            // Connected Coach Expected Envelope Polyline points
                            const expectedEnvelopePoints = zoneMeta
                              .map((z, idx) => {
                                const cx = chartLeft + (idx + 0.5) * colSlotW;
                                const expH = (z.expectedSecs / maxZoneSecs) * chartH;
                                const expY = chartBottom - expH;
                                return `${cx},${expY}`;
                              })
                              .join(' ');

                            return (
                              <>
                                {/* Left Y-Axis Title */}
                                <text
                                  x={14}
                                  y={96}
                                  transform="rotate(-90 14 96)"
                                  textAnchor="middle"
                                  className="fill-slate-600 dark:fill-slate-300 text-[11px] font-sans font-bold"
                                >
                                  Time in Zone (mm:ss)
                                </text>

                                {/* Right Y-Axis Title */}
                                <text
                                  x={528}
                                  y={96}
                                  transform="rotate(90 528 96)"
                                  textAnchor="middle"
                                  className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans font-bold"
                                >
                                  Share of Workout (%)
                                </text>

                                {/* Horizontal Grid Lines & Ticks */}
                                {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                                  const y = chartBottom - f * chartH;
                                  const tSecs = Math.round(f * maxZoneSecs);
                                  const pctVal = Math.round(
                                    ((f * maxZoneSecs) / totalZoneSecs) * 100
                                  );
                                  return (
                                    <g key={idx}>
                                      <line
                                        x1={chartLeft}
                                        y1={y}
                                        x2={chartRight}
                                        y2={y}
                                        stroke="currentColor"
                                        className="text-slate-200 dark:text-slate-800"
                                        strokeDasharray="3 3"
                                      />
                                      <text
                                        x={chartLeft - 6}
                                        y={y + 4}
                                        textAnchor="end"
                                        className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono"
                                      >
                                        {formatStopwatch(tSecs)}
                                      </text>
                                      <text
                                        x={chartRight + 6}
                                        y={y + 4}
                                        className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono"
                                      >
                                        {pctVal}%
                                      </text>
                                    </g>
                                  );
                                })}

                                {/* Zone Bars + Coach Expected Ghost Bars & Target Caps */}
                                {zoneMeta.map((z, idx) => {
                                  const centerX = chartLeft + (idx + 0.5) * colSlotW;
                                  const barH = Math.max(
                                    z.secs > 0 ? 4 : 1,
                                    (z.secs / maxZoneSecs) * chartH
                                  );
                                  const barY = chartBottom - barH;
                                  const expH = (z.expectedSecs / maxZoneSecs) * chartH;
                                  const expY = chartBottom - expH;
                                  const isHovered = hrZoneHoverIdx === idx;

                                  return (
                                    <g key={z.zone}>
                                      {/* Coach Expected Ghost Bar (behind actual bar when Auto-Zone Insight is ON) */}
                                      {showAutoZoneInsight && z.expectedPct > 0 && (
                                        <rect
                                          x={centerX - barW / 2 - 3}
                                          y={expY}
                                          width={barW + 6}
                                          height={Math.max(2, expH)}
                                          rx={5}
                                          fill="#6366F1"
                                          fillOpacity={0.12}
                                          stroke="#6366F1"
                                          strokeWidth={1.25}
                                          strokeDasharray="3 2"
                                        />
                                      )}

                                      {/* Actual Zone Bar */}
                                      <rect
                                        x={centerX - barW / 2}
                                        y={barY}
                                        width={barW}
                                        height={barH}
                                        rx={5}
                                        fill={z.colorHex}
                                        fillOpacity={isHovered ? 1 : 0.88}
                                        stroke={isHovered ? '#0F172A' : 'none'}
                                        strokeWidth={isHovered ? 1.5 : 0}
                                      />

                                      {/* Coach Expected Horizontal Cap Line & Node */}
                                      {showAutoZoneInsight && (
                                        <>
                                          <line
                                            x1={centerX - barW / 2 - 5}
                                            y1={expY}
                                            x2={centerX + barW / 2 + 5}
                                            y2={expY}
                                            stroke="#6366F1"
                                            strokeWidth={2}
                                          />
                                          <circle
                                            cx={centerX}
                                            cy={expY}
                                            r={3}
                                            fill="#6366F1"
                                            stroke="#ffffff"
                                            strokeWidth={1.2}
                                          />
                                        </>
                                      )}

                                      {/* Value Label Above Bar (Actual % and Expected % when active) */}
                                      <text
                                        x={centerX}
                                        y={Math.max(
                                          12,
                                          (showAutoZoneInsight ? Math.min(barY, expY) : barY) - 5
                                        )}
                                        textAnchor="middle"
                                        className="fill-slate-800 dark:fill-slate-100 text-[10px] font-mono font-bold"
                                      >
                                        {z.secs > 0 ? `${Math.round(z.pct)}%` : '0%'}
                                        {showAutoZoneInsight ? ` / ${z.expectedPct}%` : ''}
                                      </text>

                                      {/* X-Axis Zone Label */}
                                      <text
                                        x={centerX}
                                        y={186}
                                        textAnchor="middle"
                                        className="fill-slate-700 dark:fill-slate-200 text-[11px] font-mono font-bold"
                                      >
                                        {z.zone}
                                      </text>
                                      <text
                                        x={centerX}
                                        y={199}
                                        textAnchor="middle"
                                        className="fill-slate-500 dark:fill-slate-400 text-[9px] font-mono"
                                      >
                                        {z.bpmRange.replace(' bpm', '')}
                                      </text>
                                      {/* Hit Target */}
                                      <rect
                                        x={centerX - colSlotW / 2}
                                        y={0}
                                        width={colSlotW}
                                        height={206}
                                        fill="transparent"
                                        className="cursor-pointer"
                                        onMouseEnter={() => setHrZoneHoverIdx(idx)}
                                      />
                                    </g>
                                  );
                                })}

                                {/* Coach Expected Connected Envelope Curve */}
                                {showAutoZoneInsight && (
                                  <polyline
                                    fill="none"
                                    stroke="#6366F1"
                                    strokeWidth="1.75"
                                    strokeDasharray="4 3"
                                    strokeOpacity="0.85"
                                    points={expectedEnvelopePoints}
                                    pointerEvents="none"
                                  />
                                )}

                                {/* X-Axis Title */}
                                <text
                                  x={chartLeft + chartW / 2}
                                  y={218}
                                  textAnchor="middle"
                                  className="fill-slate-600 dark:fill-slate-300 text-[11px] font-sans font-bold"
                                >
                                  X-Axis: Physiological Heart Rate Zones (Z1–Z6 · Actual % vs Coach Target %)
                                </text>
                              </>
                            );
                          })()}
                        </svg>
                      </div>

                      {/* Right 5 Cols: Detailed Zone Table with Horizontal Progress Bars, Coach Target Pins & Delta Badges */}
                      <div className="lg:col-span-5 space-y-2">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 border-b border-slate-200 dark:border-slate-800 pb-1">
                          <span>Zone &amp; HR Threshold</span>
                          <span>
                            {showAutoZoneInsight
                              ? 'Actual vs. Coach Expected'
                              : 'Time Spent & Share'}
                          </span>
                        </div>
                        {zoneMeta.map((z, idx) => (
                          <div
                            key={z.zone}
                            onMouseEnter={() => setHrZoneHoverIdx(idx)}
                            onMouseLeave={() => setHrZoneHoverIdx(null)}
                            className={`rounded-lg p-2 transition-colors cursor-pointer ${
                              hrZoneHoverIdx === idx
                                ? 'bg-slate-100 dark:bg-slate-800/80'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-900/50'
                            }`}
                          >
                            <div className="flex items-center justify-between text-xs gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className="w-2.5 h-2.5 rounded-xs shrink-0"
                                  style={{ backgroundColor: z.colorHex }}
                                />
                                <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                                  {z.shortLabel}
                                </span>
                                <span className="font-mono text-[11px] text-slate-500 hidden sm:inline">
                                  ({z.bpmRange})
                                </span>
                              </div>
                              <div className="font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100 shrink-0 flex items-center gap-1.5">
                                <span>
                                  {formatStopwatch(z.secs)}{' '}
                                  <span className="text-slate-500 font-normal">({z.pct}%)</span>
                                </span>
                                {showAutoZoneInsight && (
                                  <span
                                    className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                                      Math.abs(z.deltaPct) <= 6
                                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                        : z.deltaPct > 6
                                          ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
                                          : 'bg-slate-200/80 dark:bg-slate-800 text-slate-500'
                                    }`}
                                    title={`Coach Expected for ${expectedProfile.shortLabel}: ${z.expectedPct}% (${formatStopwatch(z.expectedSecs)})`}
                                  >
                                    exp {z.expectedPct}% (
                                    {z.deltaPct >= 0
                                      ? `+${Math.round(z.deltaPct)}%`
                                      : `${Math.round(z.deltaPct)}%`}
                                    )
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="mt-1.5 relative h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                              <div
                                style={{
                                  width: `${Math.min(100, z.pct)}%`,
                                  backgroundColor: z.colorHex,
                                }}
                                className="h-full rounded-full transition-all"
                              />
                              {/* Vertical Coach Expected Pin on Progress Bar */}
                              {showAutoZoneInsight && z.expectedPct > 0 && (
                                <div
                                  style={{ left: `${Math.min(99, z.expectedPct)}%` }}
                                  title={`Coach Target: ${z.expectedPct}%`}
                                  className="absolute top-0 bottom-0 w-0.5 bg-indigo-600 dark:bg-indigo-300 shadow-xs"
                                />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Auto-Detected Intervals & Lap Splits + 1Hz Unstructured Track/Fartlek Rep Recovery */}
              {(() => {
                const candidateStream = liveDexieStream?.streams || selectedActivity.streams;
                const manualRecovered = recoveredIntervalsByActivityId[selectedActivity.id];
                const baseIntervals =
                  selectedActivity.intervals && selectedActivity.intervals.length > 0
                    ? selectedActivity.intervals
                    : workerAnalytics?.intervals || [];
                const effectiveIntervals =
                  manualRecovered && manualRecovered.length > 0 ? manualRecovered : baseIntervals;

                if (effectiveIntervals.length === 0 && !candidateStream) return null;

                return (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          Intervals &amp; Lap Splits ({effectiveIntervals.length} Segments)
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Forgot to hit Lap on track repeats or fartleks? Run 1Hz change-point detection to extract true WORK &amp; float reps.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {manualRecovered && manualRecovered.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setRecoveredIntervalsByActivityId((prev) => {
                                const next = { ...prev };
                                delete next[selectedActivity.id];
                                return next;
                              });
                              setIntervalRecoveryNote(null);
                            }}
                            className="min-h-[30px] px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          >
                            Reset Device Laps
                          </button>
                        )}
                        {candidateStream && (
                          <button
                            type="button"
                            onClick={() => {
                              const detected = autoDetectUnstructuredIntervals(
                                candidateStream,
                                selectedActivity.sportCategory,
                                {
                                  ftpWatts: athleteProfile?.ftp,
                                  thresholdPaceSecsPerKm: athleteProfile?.thresholdPaceSecsPerKm,
                                }
                              );
                              const workCount = detected.filter((d) => d.type === 'WORK').length;
                              if (workCount > 0) {
                                setRecoveredIntervalsByActivityId((prev) => ({
                                  ...prev,
                                  [selectedActivity.id]: detected,
                                }));
                                setIntervalRecoveryNote(
                                  `Recovered ${workCount} unstructured WORK rep${
                                    workCount === 1 ? '' : 's'
                                  } (${detected.length} total segments) from 1Hz velocity/power telemetry.`
                                );
                              } else {
                                setIntervalRecoveryNote(
                                  'Steady-state effort detected — no distinct bimodal interval surges (>16% spread) found in 1Hz stream.'
                                );
                              }
                            }}
                            className="min-h-[30px] px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors whitespace-nowrap"
                          >
                            Recover Unstructured Reps (1Hz No-Lap Detector)
                          </button>
                        )}
                      </div>
                    </div>

                    {intervalRecoveryNote && (
                      <div className="rounded-lg ap-status-info px-3 py-1.5 text-xs font-medium">
                        {intervalRecoveryNote}
                      </div>
                    )}

                    {effectiveIntervals.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs sm:text-sm border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 text-xs">
                              <th className="py-2 pr-3">Interval / Type</th>
                              <th className="py-2 px-3 text-right">Duration &amp; Distance</th>
                              <th className="py-2 px-3 text-right">Power / %FTP</th>
                              <th className="py-2 px-3 text-right">Pace / GAP</th>
                              <th className="py-2 px-3 text-right">Heart Rate</th>
                              <th className="py-2 px-3 text-right">Cadence / Drift</th>
                              <th className="py-2 pl-3 text-right">Chart Zoom</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                            {effectiveIntervals.map((iv) => (
                              <tr
                                key={iv.id}
                                onClick={() =>
                                  zoomStreamToTimeWindow(
                                    Math.max(0, iv.startTimeSecs - 15),
                                    iv.startTimeSecs + iv.durationSecs + 15
                                  )
                                }
                                className={`cursor-pointer transition-colors ${
                                  iv.type === 'WORK'
                                    ? 'bg-blue-500/5 dark:bg-blue-500/10 font-medium hover:bg-blue-500/15'
                                    : 'opacity-75 hover:bg-slate-50 dark:hover:bg-slate-900/50'
                                }`}
                              >
                                <td className="py-2.5 pr-3 font-sans">
                                  <span
                                    className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold mr-2 ${
                                      iv.type === 'WORK'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                                    }`}
                                  >
                                    {iv.type}
                                  </span>
                                  <span className="text-slate-900 dark:text-slate-100">{iv.label}</span>
                                </td>
                                <td className="py-2.5 px-3 text-right">
                                  {formatStopwatch(iv.durationSecs)} ·{' '}
                                  {iv.distanceMeters > 0
                                    ? formatDistance(iv.distanceMeters, distanceUnit, 2)
                                    : '—'}
                                </td>
                                <td className="py-2.5 px-3 text-right">
                                  {iv.avgWatts ? `${iv.avgWatts}W` : '—'}{' '}
                                  {iv.intensityPct ? `(${iv.intensityPct}%)` : ''}
                                </td>
                                <td className="py-2.5 px-3 text-right">
                                  {iv.avgPaceSecsPerKm
                                    ? formatPace(iv.avgPaceSecsPerKm, distanceUnit)
                                    : '—'}
                                </td>
                                <td className="py-2.5 px-3 text-right">
                                  {iv.avgHr ? `${iv.avgHr} / ${iv.maxHr} bpm` : '—'}
                                </td>
                                <td className="py-2.5 px-3 text-right">
                                  {iv.avgCadence ? `${iv.avgCadence} rpm/spm` : '—'}
                                  {iv.decouplingPct !== undefined ? ` · ${iv.decouplingPct}%` : ''}
                                </td>
                                <td className="py-2.5 pl-3 text-right font-sans">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      zoomStreamToTimeWindow(
                                        Math.max(0, iv.startTimeSecs - 15),
                                        iv.startTimeSecs + iv.durationSecs + 15
                                      );
                                    }}
                                    className="min-h-[26px] px-2 py-0.5 rounded bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-semibold transition-colors whitespace-nowrap"
                                  >
                                    Zoom Section
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500 py-1">
                        No device laps recorded on this workout. Click &quot;Recover Unstructured Reps&quot; above to scan 1Hz velocity/power streams.
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Strava Segments on This Activity & Segment Performance Over Time Chart */}
              {(selectedActivity.environment === 'OUTDOOR' ||
                (selectedActivity.segmentEfforts && selectedActivity.segmentEfforts.length > 0)) && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        Strava Segments on This Activity (
                        {selectedActivity.segmentEfforts?.length || 0} Matched Segments)
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Click any segment biked or run more than once (2x+) to inspect your historical elapsed time, power/pace, and heart rate progression over time
                      </p>
                    </div>
                    {onScanMoreSegments && (
                      <button
                        type="button"
                        onClick={onScanMoreSegments}
                        disabled={isScanningSegments}
                        className="min-h-[32px] px-3 py-1 rounded-lg border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20 disabled:opacity-50 text-xs font-semibold text-blue-600 dark:text-blue-400 transition-colors whitespace-nowrap"
                      >
                        {isScanningSegments
                          ? 'Scanning Historical Segments...'
                          : 'Scan +30 Historical Workouts for Repeat Segments'}
                      </button>
                    )}
                  </div>

                  {selectedActivity.segmentEfforts && selectedActivity.segmentEfforts.length > 0 ? (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs sm:text-sm border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 text-xs">
                              <th className="py-2 pr-3">Strava Segment</th>
                              <th className="py-2 px-3 text-right">Distance &amp; Grade</th>
                              <th className="py-2 px-3 text-right">Elapsed Time</th>
                              <th className="py-2 px-3 text-right">Power / Pace</th>
                              <th className="py-2 px-3 text-right">Avg HR</th>
                              <th className="py-2 px-3 text-right">All-Time PR / Delta</th>
                              <th className="py-2 pl-3 text-right">History Over Time</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                            {selectedActivity.segmentEfforts.map((eff, effIdx) => {
                              const sid = String(eff.segmentId || eff.name);
                              const segHist = segmentHistoryBySegmentId.get(sid);
                              const totalAttempts = segHist?.efforts.length || 1;
                              const prSecs = segHist?.prElapsedTimeSecs || eff.elapsedTimeSecs;
                              const deltaSecs = eff.elapsedTimeSecs - prSecs;
                              const isSelectedForChart = modalSelectedSegmentId === sid;

                              return (
                                <tr
                                  key={`${eff.id}-${sid}-${effIdx}`}
                                  onClick={() => {
                                    if (totalAttempts >= 2) {
                                      setModalSelectedSegmentId(sid);
                                    }
                                  }}
                                  className={`${
                                    totalAttempts >= 2 ? 'cursor-pointer' : ''
                                  } transition-colors ${
                                    isSelectedForChart
                                      ? 'bg-blue-500/10 dark:bg-blue-500/15'
                                      : 'hover:bg-slate-50 dark:hover:bg-slate-900/60'
                                  }`}
                                >
                                  <td className="py-2.5 pr-3 font-sans">
                                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                                      {eff.name}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 text-right text-slate-600 dark:text-slate-300">
                                    {formatDistance(eff.distanceMeters, distanceUnit, 2)} ·{' '}
                                    {eff.averageGradePct > 0 ? `+${eff.averageGradePct}%` : `${eff.averageGradePct}%`}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-bold text-slate-900 dark:text-slate-100">
                                    {formatStopwatch(eff.elapsedTimeSecs)}
                                  </td>
                                  <td className="py-2.5 px-3 text-right text-blue-600 dark:text-blue-400 font-semibold">
                                    {eff.avgWatts
                                      ? athleteProfile?.safeSportHideWeight
                                        ? `${eff.avgWatts}W`
                                        : `${eff.avgWatts}W (${(eff.avgWatts / athleteWeightKg).toFixed(2)} W/kg)`
                                      : eff.avgPaceSecsPerKm
                                        ? formatPace(eff.avgPaceSecsPerKm, distanceUnit)
                                        : '—'}
                                  </td>
                                  <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                                    {eff.avgHr ? `${eff.avgHr} bpm` : '—'}
                                  </td>
                                  <td className="py-2.5 px-3 text-right">
                                    {eff.prRank === 1 || deltaSecs <= 0 ? (
                                      <span className="inline-block px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold text-xs">
                                        PR #1 ({formatStopwatch(prSecs)})
                                      </span>
                                    ) : eff.prRank === 2 ? (
                                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                        2nd Best (+{deltaSecs}s vs PR)
                                      </span>
                                    ) : eff.prRank === 3 ? (
                                      <span className="text-blue-600 dark:text-blue-400 font-semibold">
                                        3rd Best (+{deltaSecs}s vs PR)
                                      </span>
                                    ) : (
                                      <span className="text-slate-500">
                                        +{deltaSecs}s (PR {formatStopwatch(prSecs)})
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 pl-3 text-right font-sans">
                                    {totalAttempts >= 2 ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setModalSelectedSegmentId(sid);
                                        }}
                                        className={`min-h-[28px] px-2.5 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                                          isSelectedForChart
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20'
                                        }`}
                                      >
                                        {isSelectedForChart
                                          ? `Viewing Effort Over Time (${totalAttempts}x)`
                                          : `Effort Over Time (${totalAttempts}x)`}
                                      </button>
                                    ) : (
                                      <span className="text-xs font-mono text-slate-400">1st effort</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Inline 'Effort Over Time' Chart (for any selected segment on this activity with >= 2 efforts) */}
                      {modalSelectedSegmentId &&
                        (() => {
                          const repeatedOnCurrentAct = Array.from(
                            new Map(
                              (selectedActivity.segmentEfforts || [])
                                .map((eff) =>
                                  repeatedSegmentsList.find(
                                    (r) => r.segmentId === String(eff.segmentId || eff.name)
                                  )
                                )
                                .filter((r): r is NonNullable<typeof r> => Boolean(r))
                                .map((r) => [r.segmentId, r] as const)
                            ).values()
                          );

                          if (repeatedOnCurrentAct.length === 0) return null;

                          return (
                            <SegmentEffortOverTimeChart
                              segments={repeatedOnCurrentAct}
                              selectedSegmentId={modalSelectedSegmentId}
                              onSelectSegmentId={setModalSelectedSegmentId}
                              distanceUnit={distanceUnit}
                              athleteWeightKg={athleteWeightKg}
                              currentActivityId={selectedActivity.id}
                              onSelectActivity={(actId) => {
                                const found = activities.find((a) => a.id === actId);
                                if (found) onSelectActivity(found);
                              }}
                              onZoomToSegmentWindow={(startSecs, endSecs) => {
                                zoomStreamToTimeWindow(startSecs, endSecs);
                              }}
                              onScanMoreSegments={onScanMoreSegments}
                              isScanningSegments={isScanningSegments}
                              showSegmentPicker={repeatedOnCurrentAct.length > 1}
                              compact={false}
                            />
                          );
                        })()}
                    </>
                  ) : (
                    <div className="text-xs text-slate-500 py-3">
                      Loading Strava segment efforts from Intervals.icu / Strava streams for this outdoor workout...
                    </div>
                  )}
                </div>
              )}

              {/* Similar Historical Workouts & Repeat Comparison Table */}
              {similarHistoricalWorkouts.length > 0 && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Similar Historical Workouts &amp; Efficiency Progression ({similarHistoricalWorkouts.length} Matched Repeats)
                    </h3>
                    <span className="text-xs font-mono text-emerald-500">
                      Click &quot;Overlay in Split-View&quot; to compare streams side-by-side
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs sm:text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 text-xs">
                          <th className="py-2 pr-3">Date &amp; Workout</th>
                          <th className="py-2 px-3 text-right">Distance &amp; Time</th>
                          <th className="py-2 px-3 text-right">NP Watts / Pace</th>
                          <th className="py-2 px-3 text-right">Avg HR</th>
                          <th className="py-2 px-3 text-right">Efficiency Factor (EF)</th>
                          <th className="py-2 pl-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                        {similarHistoricalWorkouts.map((sim) => (
                          <tr
                            key={sim.id}
                            onClick={() => onSelectActivity(sim)}
                            className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/60"
                          >
                            <td className="py-2.5 pr-3 font-sans">
                              <span className="font-mono text-slate-500 mr-2">
                                {sim.startDateLocal.slice(0, 10)}
                              </span>
                              <span className="font-medium text-slate-900 dark:text-slate-100">
                                {sim.name}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {sim.distanceMeters > 0
                                ? formatDistance(sim.distanceMeters, distanceUnit, 2)
                                : '—'}{' '}
                              · {formatDuration(sim.movingTimeSecs)}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {sim.sportCategory === 'Running' && sim.avgPaceSecsPerKm
                                ? formatPace(sim.avgPaceSecsPerKm, distanceUnit)
                                : sim.normalizedPower
                                  ? `NP ${sim.normalizedPower}W`
                                  : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {sim.avgHr > 0 ? `${sim.avgHr} bpm` : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                              {sim.efficiencyFactor || '—'}
                            </td>
                            <td
                              className="py-2.5 pl-3 text-right font-sans"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  handleAssignToCompareSlot(selectedActivity, 'A');
                                  handleAssignToCompareSlot(sim, 'B');
                                  onSelectActivity(null);
                                }}
                                className="min-h-[28px] px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors whitespace-nowrap"
                              >
                                Overlay in Split-View
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
