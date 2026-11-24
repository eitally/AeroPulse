import React, { Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useModalDialog } from '../../hooks/useModalDialog';
import {
  Columns2,
  ExternalLink,
  Send,
  Sparkles,
  ThumbsUp,
  Trophy,
  Upload,
  X,
} from '../icons/PhosphorIcons';
import type {
  AthleteGearItem,
  AthleteProfile,
  DistanceUnit,
  UnifiedActivity,
  WorkoutQuickLog,
} from '../../types';
import {
  useTelemetryWorkspace,
  type TelemetryWorkspaceContextValue,
} from '../../contexts/TelemetryWorkspaceContext';
import {
  formatDistance,
  formatDuration,
  formatMultiSportPace,
  formatPace,
  formatStopwatch,
} from '../../utils/formatters';
import { buildCompleteAthleteProfile } from '../../utils/telemetryStorage';
import { generatePostWorkoutDebrief } from '../../physiology/workoutDebrief';
import type { ComputedStreamAnalytics } from '../../workers/activityWorkerClient';
import type { StoredActivityStreamRecord } from '../../db/workoutStore';
import { ChartInfoTooltip } from '../ChartInfoTooltip';
import { WorkspaceErrorBoundary } from '../WorkspaceErrorBoundary';
import { InteractiveRouteMap, UPlotStreamChart } from './activityLazyViews';
import {
  SegmentEffortOverTimeChart,
  type RepeatedSegmentSummary,
} from '../SegmentEffortOverTimeChart';
import type { SegmentHistorySummary } from './activitySeriesUtils';
import { ActivityInspectorZonesAndSplits } from './ActivityInspectorZonesAndSplits';

export interface ActivityInspectorModalProps {
  selectedActivity: UnifiedActivity | null;
  activities: UnifiedActivity[];
  distanceUnit: DistanceUnit;
  athleteWeightKg: number;
  athleteProfile?: AthleteProfile;
  compareIdB: string | null;
  onSelectActivity: (activity: UnifiedActivity | null) => void;
  onLoadActivityStreams?: (activity: UnifiedActivity) => Promise<void>;
  onScanMoreSegments?: () => Promise<void>;
  isScanningSegments: boolean;
  onToggleKudos?: (activity: UnifiedActivity) => Promise<void>;
  onAddComment?: (activity: UnifiedActivity, commentText: string) => Promise<void>;
  isWorkerProcessing: boolean;
  workerAnalytics: ComputedStreamAnalytics | null;
  liveDexieStream?: StoredActivityStreamRecord;
  activeSelectedStream?: UnifiedActivity['streams'];
  onTriggerWorker1HzUpsample: () => void;
  onAssignToCompareSlot: (act: UnifiedActivity, slot?: 'A' | 'B') => void;
  similarHistoricalWorkouts: UnifiedActivity[];
  segmentHistoryBySegmentId: Map<string, SegmentHistorySummary>;
  repeatedSegmentsList: RepeatedSegmentSummary[];
  gearItems?: AthleteGearItem[];
  onUpdateActivityQuickLog?: (
    activityId: string,
    quickLog: WorkoutQuickLog,
    opts?: { syncGear?: boolean }
  ) => void;
}

export const ActivityInspectorModal: React.FC<ActivityInspectorModalProps> = ({
  selectedActivity,
  activities,
  distanceUnit,
  athleteWeightKg,
  athleteProfile,
  compareIdB,
  onSelectActivity,
  onLoadActivityStreams,
  onScanMoreSegments,
  isScanningSegments,
  onToggleKudos,
  onAddComment,
  isWorkerProcessing,
  workerAnalytics,
  liveDexieStream,
  activeSelectedStream,
  onTriggerWorker1HzUpsample,
  onAssignToCompareSlot: handleAssignToCompareSlot,
  similarHistoricalWorkouts,
  segmentHistoryBySegmentId,
  repeatedSegmentsList,
  gearItems: gearItemsProp,
  onUpdateActivityQuickLog: onUpdateActivityQuickLogProp,
}) => {
  let wsCtx: TelemetryWorkspaceContextValue | null = null;
  try {
    wsCtx = useTelemetryWorkspace();
  } catch {
    wsCtx = null;
  }
  const effectiveGearItems = gearItemsProp ?? wsCtx?.effectiveGearItems ?? [];
  const effectiveOnUpdateActivityQuickLog =
    onUpdateActivityQuickLogProp ?? wsCtx?.handleUpdateActivityQuickLog;
  const [streamHoverIndex, setStreamHoverIndex] = useState<number | null>(null);
  const [streamZoomRange, setStreamZoomRange] = useState<[number, number] | null>(null);
  const [debriefZoomWindow, setDebriefZoomWindow] = useState<{
    startSec: number;
    endSec: number;
    nonce: number;
  } | null>(null);
  const [quickLogsById, setQuickLogsById] = useState<Record<string, WorkoutQuickLog>>(() => {
    try {
      const raw = localStorage.getItem('thresh_quick_logs_v1');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const quickLogsByIdRef = useRef<Record<string, WorkoutQuickLog>>(quickLogsById);
  quickLogsByIdRef.current = quickLogsById;
  const [quickLogSavedMsg, setQuickLogSavedMsg] = useState<string | null>(null);
  const inspectorDialogRef = useRef<HTMLDivElement>(null);
  const formId = useId();
  useModalDialog({
    isOpen: Boolean(selectedActivity),
    onClose: () => onSelectActivity(null),
    dialogRef: inspectorDialogRef,
  });

  const saveQuickLogForActivity = (actId: string, patch: Partial<WorkoutQuickLog>) => {
    const prev = quickLogsByIdRef.current;
    const baseActivity =
      selectedActivity?.id === actId
        ? selectedActivity
        : activities.find((a) => a.id === actId);
    const existing = prev[actId] ||
      baseActivity?.quickLog || {
        rpe: 6,
        feelRating: 'NORMAL' as const,
        carbsGramsPerHour: baseActivity?.sportCategory === 'Cycling' ? 75 : 60,
        sodiumMgPerHour: 500,
        ...(baseActivity?.gearId ? { gearId: baseActivity.gearId } : {}),
        gearName: baseActivity?.gearName || '',
        loggedAt: new Date().toISOString(),
      };
    const updated: WorkoutQuickLog = {
      ...existing,
      ...patch,
      loggedAt: new Date().toISOString(),
    };
    const next = { ...prev, [actId]: updated };
    quickLogsByIdRef.current = next;
    setQuickLogsById(next);
    try {
      localStorage.setItem('thresh_quick_logs_v1', JSON.stringify(next));
    } catch {
      // ignore quota errors
    }
    const syncGear = 'gearId' in patch || 'gearName' in patch;
    effectiveOnUpdateActivityQuickLog?.(actId, updated, { syncGear });
    setQuickLogSavedMsg(
      syncGear
        ? 'Saved — Shoe & Spike Closet mileage updated'
        : 'Saved to Durability & Fueling ledger'
    );
    window.setTimeout(() => setQuickLogSavedMsg(null), 2600);
  };

  const [inspectorTab, setInspectorTab] = useState<'SUMMARY' | 'STREAMS' | 'SPLITS_ZONES'>(
    'SUMMARY'
  );
  const [modalSelectedSegmentId, setModalSelectedSegmentId] = useState<string | null>(null);
  const [modalCommentInput, setModalCommentInput] = useState<string>('');

  const selectedDebriefReport = useMemo(() => {
    if (
      !selectedActivity ||
      !activeSelectedStream ||
      !Array.isArray(activeSelectedStream.time) ||
      activeSelectedStream.time.length <= 1
    ) {
      return null;
    }
    const effectiveProfile =
      athleteProfile || buildCompleteAthleteProfile({ weightKg: athleteWeightKg });
    return generatePostWorkoutDebrief(selectedActivity, activeSelectedStream, effectiveProfile);
  }, [selectedActivity, activeSelectedStream, athleteProfile, athleteWeightKg]);

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

  // Reset stream zoom range, inspector tab, and archetype override when switching selectedActivity
  useEffect(() => {
    setStreamZoomRange(null);
    setStreamHoverIndex(null);
        setInspectorTab('SUMMARY');
  }, [selectedActivity?.id]);

  // Helper to zoom stream chart to a specific elapsed time window [startSecs, endSecs]
  const zoomStreamToTimeWindow = (startSecs: number, endSecs: number) => {
    setInspectorTab('STREAMS');
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

  useEffect(() => {
    setDebriefZoomWindow(null);
  }, [selectedActivity?.id]);

  if (!selectedActivity) return null;

  return (
        <div className="ap-modal-backdrop" onClick={() => onSelectActivity(null)}>
          <div
            ref={inspectorDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="thresh-activity-inspector-title"
            className="ap-modal-sheet max-w-5xl liquid-glass shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sm:hidden w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mt-3" />

            {/* Header */}
            <div className="sticky top-0 z-30 bg-white dark:bg-[#0D1310] flex flex-wrap items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedActivity.sportCategory} ·{' '}
                  {selectedActivity.environment === 'INDOOR'
                    ? `Indoor (${selectedActivity.subType})`
                    : `Outdoor (${selectedActivity.subType})`}{' '}
                  · {selectedActivity.startDateLocal.replace('T', ' ').slice(0, 16)} ·{' '}
                  {selectedActivity.deviceName || selectedActivity.sourceBadges.join(' + ')}
                </div>
                <h2 id="thresh-activity-inspector-title" className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5 truncate">
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
                  className="min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1.5 rounded-lg bg-ap-cobalt hover:bg-ap-clay-dark dark:bg-ap-volt dark:hover:bg-[#C8EF1E] px-3 py-1.5 text-xs font-semibold text-white dark:text-ap-obsidian transition-colors"
                >
                  <Columns2 className="w-3.5 h-3.5" />
                  <span className="hidden xs:inline sm:inline">Open in Split-View Compare</span>
                  <span className="inline sm:hidden">Compare</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSelectActivity(null)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                  aria-label="Close inspector"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-4 sm:p-6 space-y-6">
              {/* 3-Tab Segmented Navigation inside Activity Inspector (UX-06) */}
              <div
                data-testid="activity-inspector-tabs"
                role="tablist"
                aria-label="Activity Inspector Sections"
                className="grid grid-cols-3 sm:flex items-center gap-1 p-1 rounded-xl liquid-capsule-track w-full sm:w-fit"
              >
                {(
                  [
                    { id: 'SUMMARY', label: 'Summary' },
                    { id: 'STREAMS', label: 'Streams & Map' },
                    { id: 'SPLITS_ZONES', label: 'Splits & Zones' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={inspectorTab === tab.id}
                    onClick={() => setInspectorTab(tab.id)}
                    className={`min-h-[44px] sm:min-h-[34px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      inspectorTab === tab.id
                        ? 'ap-nav-volt-active shadow-xs'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {inspectorTab === 'SUMMARY' && (
                <>
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
                    {selectedActivity.avgPaceSecsPerKm &&
                    (selectedActivity.sportCategory === 'Running' ||
                      selectedActivity.sportCategory === 'Swimming' ||
                      selectedActivity.sportCategory === 'Multisport')
                      ? `${formatMultiSportPace(
                          selectedActivity.avgPaceSecsPerKm,
                          distanceUnit,
                          selectedActivity.sportCategory,
                          selectedActivity.subType
                        )}${
                          selectedActivity.sportCategory === 'Running' &&
                          selectedActivity.gapPaceSecsPerKm
                            ? ` (GAP ${formatPace(selectedActivity.gapPaceSecsPerKm, distanceUnit)})`
                            : ''
                        }`
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
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-blue-500/15 text-blue-600 dark:text-sky-300 text-2xs font-mono font-bold uppercase tracking-wider">
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
                        <span className="text-slate-500 block font-sans text-2xs">
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
                            <div className="text-2xs font-sans font-semibold text-slate-500">
                              Aerobic Efficiency (EF)
                            </div>
                            <div className="text-2xl font-extrabold text-blue-600 dark:text-sky-400 mt-1">
                              {efOverall.toFixed(2)}
                            </div>
                            <div className="text-2xs text-slate-500 mt-0.5">
                              Watts / Heartbeat (NP ÷ HR)
                            </div>
                          </div>
                          <div className="mt-2 pt-2 border-t border-slate-200/60 dark:border-white/10 text-2xs">
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
                            <div className="text-2xs font-sans font-semibold text-slate-500">
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
                            <div className="text-2xs text-slate-500 mt-0.5">
                              1st vs 2nd Half Drift
                            </div>
                          </div>
                          <div className="mt-2 pt-2 border-t border-slate-200/60 dark:border-white/10 text-2xs font-sans">
                            Benchmark:{' '}
                            <strong className="font-mono text-emerald-600 dark:text-emerald-400">
                              &lt; 3.5% Optimal
                            </strong>
                          </div>
                        </div>

                        {/* Metric 3: 1st Half vs 2nd Half EF Split Bars */}
                        <div className="rounded-xl liquid-glass-subtle p-3.5 flex flex-col justify-between space-y-2">
                          <div className="text-2xs font-sans font-semibold text-slate-500">
                            Half-by-Half Economy Split
                          </div>
                          <div className="space-y-1.5 text-xs">
                            <div>
                              <div className="flex justify-between text-2xs">
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
                              <div className="flex justify-between text-2xs">
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
                          <div className="text-2xs font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400 font-semibold">
                            Physiological Assessment
                          </div>
                          <p className="text-slate-700 dark:text-slate-200 leading-relaxed">
                            {qualityGrade.summary}
                          </p>
                        </div>
                        <div className="pt-2 border-t border-slate-200/70 dark:border-white/10 space-y-1">
                          <div className="text-2xs font-mono uppercase tracking-wider text-blue-600 dark:text-sky-400 font-semibold">
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
                      className={`min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                        selectedActivity.hasKudoed
                          ? 'bg-[#C23800] text-white shadow-xs'
                          : 'border border-[#C23800]/35 dark:border-[#FC4C02]/40 bg-[#C23800]/10 dark:bg-[#FC4C02]/10 ap-text-strava hover:bg-[#C23800]/20 dark:hover:bg-[#FC4C02]/20'
                      }`}
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                      <span>
                        {selectedActivity.hasKudoed ? 'Kudoed on MeetReady / Strava' : 'Give Kudos'}{' '}
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
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white dark:bg-ap-turf border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300"
                        >
                          <span className="w-4 h-4 rounded-full bg-[#C23800]/15 dark:bg-[#FC4C02]/20 ap-text-strava font-mono text-2xs font-bold flex items-center justify-center">
                            {dispInitials}
                          </span>
                          <span>{dispName}</span>
                        </span>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedActivity.stravaPrCount > 0 && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-400 text-xs font-bold font-mono">
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
                        className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#C23800]/35 dark:border-[#FC4C02]/40 bg-[#C23800]/10 dark:bg-[#FC4C02]/10 hover:bg-[#C23800]/20 dark:hover:bg-[#FC4C02]/20 text-xs font-semibold ap-text-strava transition-colors"
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
                        className="rounded-lg bg-white dark:bg-ap-turf border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs"
                      >
                        <div className="flex items-center justify-between text-2xs text-slate-500">
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
                      aria-label={`Add a coaching note to ${selectedActivity.name}`}
                      onChange={(e) => setModalCommentInput(e.target.value)}
                      placeholder="Add a coaching note or Strava comment to this workout..."
                      className="flex-1 min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-ap-turf px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="submit"
                      disabled={!modalCommentInput.trim()}
                      className="min-h-[44px] sm:min-h-[38px] px-3.5 py-1.5 rounded-lg bg-ap-obsidian hover:bg-ap-turf disabled:opacity-40 text-white text-xs font-semibold transition-colors inline-flex items-center gap-1.5"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Post Note</span>
                    </button>
                  </form>
                )}
              </div>
                </>
              )}

              {/* Synchronized Interactive GPS Route Map (Outdoor Workouts or Workouts with GPS Coordinates) */}
              {inspectorTab === 'STREAMS' &&
                (selectedActivity.environment === 'OUTDOOR' ||
                  (Array.isArray(selectedActivity.routeLatLngs) &&
                    selectedActivity.routeLatLngs.length > 2) ||
                  Boolean(
                    selectedActivity.streams?.latlng && selectedActivity.streams.latlng.length > 2
                  )) && (
                <WorkspaceErrorBoundary fallbackTitle="GPS Route Map" restoreTab="activities">
                  <Suspense
                    fallback={
                      <div className="h-[340px] sm:h-[400px] rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                        Loading GPS Route Map…
                      </div>
                    }
                  >
                    <InteractiveRouteMap
                      mode="SINGLE"
                      activity={selectedActivity}
                      distanceUnit={distanceUnit}
                      activeStreamIndex={streamHoverIndex}
                      onHoverStreamIndex={setStreamHoverIndex}
                      zoomStreamRange={streamZoomRange}
                      selectedSegmentId={modalSelectedSegmentId}
                      onSelectSegmentId={setModalSelectedSegmentId}
                      heightClass="h-[340px] sm:h-[400px]"
                    />
                  </Suspense>
                </WorkspaceErrorBoundary>
              )}

              {/* 5-Second Post-Workout RPE, Fueling (g/hr Carbs & mg/hr Sodium) & Gear Quick-Log */}
              {inspectorTab === 'SUMMARY' && (() => {
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
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-ap-turf/60 p-3.5 space-y-2.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="ap-status-prime px-2 py-0.5 rounded-md font-mono text-2xs font-bold uppercase">
                          5s Post-Workout Quick-Log
                        </span>
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          RPE, Exogenous Fueling (g/hr · mg/hr) &amp; Gear Tag
                        </span>
                      </div>
                      {quickLogSavedMsg ? (
                        <span className="font-mono text-2xs text-emerald-600 dark:text-emerald-400 font-semibold">
                          ✓ {quickLogSavedMsg}
                        </span>
                      ) : curLog.loggedAt ? (
                        <span className="font-mono text-2xs text-slate-600 dark:text-slate-400">
                          Logged {new Date(curLog.loggedAt).toLocaleDateString()}
                        </span>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
                      {/* 1-Tap RPE 1–10 Selector */}
                      <div className="sm:col-span-5 flex flex-wrap items-center gap-1">
                        <span className="text-2xs font-mono text-slate-500 mr-1">RPE:</span>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => (
                          <button
                            key={val}
                            type="button"
                            aria-pressed={curLog.rpe === val}
                            aria-label={`RPE ${val} of 10`}
                            onClick={() =>
                              saveQuickLogForActivity(selectedActivity.id, { rpe: val })
                            }
                            className={`min-h-[44px] min-w-[32px] sm:min-h-[28px] sm:min-w-[26px] rounded-md font-mono text-2xs font-bold transition-colors ${
                              curLog.rpe === val
                                ? val >= 8
                                  ? 'bg-rose-600 text-white'
                                  : val >= 5
                                    ? 'bg-amber-500 text-ap-obsidian'
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
                        <label
                          htmlFor={`${formId}-quicklog-carbs`}
                          className="text-2xs font-mono text-slate-500 whitespace-nowrap"
                        >
                          Carbs:
                        </label>
                        <input
                          id={`${formId}-quicklog-carbs`}
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
                          className="w-16 min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-2 py-1 font-mono text-xs text-slate-900 dark:text-slate-100"
                        />
                        <span className="text-2xs font-mono text-slate-600 dark:text-slate-400">g/hr</span>
                      </div>

                      {/* Sodium mg/hr */}
                      <div className="sm:col-span-2 flex items-center gap-1.5">
                        <label
                          htmlFor={`${formId}-quicklog-sodium`}
                          className="text-2xs font-mono text-slate-500 whitespace-nowrap"
                        >
                          Na+:
                        </label>
                        <input
                          id={`${formId}-quicklog-sodium`}
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
                          className="w-16 min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-2 py-1 font-mono text-xs text-slate-900 dark:text-slate-100"
                        />
                        <span className="text-2xs font-mono text-slate-600 dark:text-slate-400">mg/hr</span>
                      </div>

                      {/* Gear / Shoe Tag */}
                      <div className="sm:col-span-3 flex items-center gap-1.5">
                        <label
                          htmlFor={`${formId}-quicklog-gear`}
                          className="text-2xs font-mono text-slate-500 whitespace-nowrap"
                        >
                          Gear:
                        </label>
                        {(() => {
                          const sportGear = effectiveGearItems.filter(
                            (g) =>
                              !g.retired &&
                              (selectedActivity.sportCategory === 'Cycling'
                                ? g.type === 'BIKE'
                                : g.type === 'SHOE')
                          );
                          if (sportGear.length > 0) {
                            const matchedGearId =
                              curLog.gearId ||
                              (curLog.gearId === undefined ? selectedActivity.gearId : '') ||
                              sportGear.find(
                                (g) =>
                                  g.name ===
                                  (curLog.gearName !== undefined
                                    ? curLog.gearName
                                    : selectedActivity.gearName)
                              )?.id ||
                              '';
                            return (
                              <select
                                id={`${formId}-quicklog-gear`}
                                data-testid="inspector-quicklog-gear-select"
                                value={matchedGearId}
                                onChange={(e) => {
                                  const chosen = sportGear.find((g) => g.id === e.target.value);
                                  saveQuickLogForActivity(selectedActivity.id, {
                                    gearId: chosen ? chosen.id : '',
                                    gearName: chosen ? chosen.name : '',
                                    ...(chosen?.footwearClass
                                      ? { footwearClass: chosen.footwearClass }
                                      : { footwearClass: undefined }),
                                  });
                                }}
                                className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-2.5 py-1 text-xs text-slate-900 dark:text-slate-100 cursor-pointer"
                              >
                                <option value="">Select from Gear Closet…</option>
                                {sportGear.map((g) => (
                                  <option key={g.id} value={g.id}>
                                    {g.name}
                                    {g.primary ? ' (Primary)' : ''}
                                  </option>
                                ))}
                              </select>
                            );
                          }
                          return (
                            <input
                              id={`${formId}-quicklog-gear`}
                              type="text"
                              placeholder={
                                selectedActivity.sportCategory === 'Cycling'
                                  ? 'e.g. Road / Trainer Bike'
                                  : 'e.g. Daily Trainer / Carbon Shoe'
                              }
                              value={curLog.gearName ?? ''}
                              onChange={(e) =>
                                saveQuickLogForActivity(selectedActivity.id, {
                                  gearId: '',
                                  gearName: e.target.value,
                                })
                              }
                              className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-2.5 py-1 text-xs text-slate-900 dark:text-slate-100"
                            />
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* High-Frequency 1Hz uPlot Telemetry Canvas + Web Worker Analytics Strip */}
              {inspectorTab === 'STREAMS' && (() => {
                const activeStream = activeSelectedStream;
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
                const debriefReport = selectedDebriefReport;

                return (
                  <div className="space-y-4">
                    {debriefReport && debriefReport.insights.length > 0 && (
                      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/75 dark:bg-ap-turf/75 p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="ap-status-info px-2 py-0.5 rounded-md text-2xs font-mono font-bold uppercase tracking-wider">
                                30-Second Signal Debrief
                              </span>
                              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                {debriefReport.headline}
                              </h3>
                            </div>
                            <p className="text-2xs text-slate-500 dark:text-slate-400 mt-0.5">
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
                                    className={`${pillClass} px-2 py-0.5 rounded-md text-2xs font-mono font-bold uppercase tracking-wider`}
                                  >
                                    {ins.badge}
                                  </span>
                                  <span className="text-2xs font-mono text-blue-600 dark:text-sky-400 font-semibold group-hover:underline">
                                    {ins.timestampLabel} ↗
                                  </span>
                                </div>
                                <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                                  {ins.title}
                                </div>
                                <p className="text-2xs text-slate-600 dark:text-slate-300 leading-relaxed">
                                  {ins.detail}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <WorkspaceErrorBoundary fallbackTitle="1Hz Stream Canvas" restoreTab="activities">
                      <Suspense
                        fallback={
                          <div className="h-[280px] rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                            Loading 1Hz Stream Canvas…
                          </div>
                        }
                      >
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
                          onTriggerWorker1HzUpsample={onTriggerWorker1HzUpsample}
                          syncKey="thresh-activity-inspector"
                          onHoverIndex={setStreamHoverIndex}
                          zoomRange={streamZoomRange}
                          zoomWindowSecs={debriefZoomWindow}
                          onZoomRangeChange={setStreamZoomRange}
                          height={280}
                        />
                      </Suspense>
                    </WorkspaceErrorBoundary>
                  </div>
                );
              })()}

              {inspectorTab === 'SPLITS_ZONES' && (
                <ActivityInspectorZonesAndSplits
                  selectedActivity={selectedActivity}
                  distanceUnit={distanceUnit}
                  athleteWeightKg={athleteWeightKg}
                  athleteProfile={athleteProfile}
                  resolvedStream={liveDexieStream?.streams || selectedActivity.streams}
                  workerAnalytics={workerAnalytics}
                  isScanningSegments={isScanningSegments}
                  onScanMoreSegments={onScanMoreSegments}
                  onSelectActivity={onSelectActivity}
                  modalSelectedSegmentId={modalSelectedSegmentId}
                  setModalSelectedSegmentId={setModalSelectedSegmentId}
                  segmentHistoryBySegmentId={segmentHistoryBySegmentId}
                  repeatedSegmentsList={repeatedSegmentsList}
                  similarHistoricalWorkouts={similarHistoricalWorkouts}
                  handleAssignToCompareSlot={handleAssignToCompareSlot}
                  zoomStreamToTimeWindow={zoomStreamToTimeWindow}
                />
              )}
              {inspectorTab === 'STREAMS' &&
                (selectedActivity.environment === 'OUTDOOR' ||
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
                        className="min-h-[44px] sm:min-h-[32px] px-3 py-1 rounded-lg border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20 disabled:opacity-50 text-xs font-semibold text-blue-600 dark:text-blue-400 transition-colors whitespace-nowrap"
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
                                  tabIndex={totalAttempts >= 2 ? 0 : undefined}
                                  onClick={() => {
                                    if (totalAttempts >= 2) {
                                      setModalSelectedSegmentId(sid);
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (totalAttempts < 2 || e.target !== e.currentTarget) return;
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      setModalSelectedSegmentId(sid);
                                    }
                                  }}
                                  className={`${
                                    totalAttempts >= 2
                                      ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500'
                                      : ''
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
                                      ? athleteProfile?.safeSportHideWeight || athleteWeightKg <= 0
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
                                        className={`min-h-[44px] sm:min-h-[28px] px-2.5 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                                          isSelectedForChart
                                            ? 'bg-ap-cobalt text-white dark:bg-ap-volt dark:text-ap-obsidian'
                                            : 'bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20'
                                        }`}
                                      >
                                        {isSelectedForChart
                                          ? `Viewing Effort Over Time (${totalAttempts}x)`
                                          : `Effort Over Time (${totalAttempts}x)`}
                                      </button>
                                    ) : (
                                      <span className="text-xs font-mono text-slate-600 dark:text-slate-400">1st effort</span>
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
            </div>
          </div>
        </div>
  );
};
