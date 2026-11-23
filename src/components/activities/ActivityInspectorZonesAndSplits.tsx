import React, { useEffect, useState } from 'react';
import { Sparkles } from '../icons/PhosphorIcons';
import type {
  ActivityInterval,
  AthleteProfile,
  DistanceUnit,
  UnifiedActivity,
} from '../../types';
import {
  formatDistance,
  formatDuration,
  formatPace,
  formatStopwatch,
} from '../../utils/formatters';
import type { ComputedStreamAnalytics } from '../../workers/activityWorkerClient';
import { autoDetectUnstructuredIntervals } from '../../physiology/scholasticEngine';
import { ChartInfoTooltip } from '../ChartInfoTooltip';
import {
  SegmentEffortOverTimeChart,
  type RepeatedSegmentSummary,
} from '../SegmentEffortOverTimeChart';
import type { SegmentHistorySummary } from './activitySeriesUtils';

export interface ActivityInspectorZonesAndSplitsProps {
  selectedActivity: UnifiedActivity;
  distanceUnit: DistanceUnit;
  athleteWeightKg: number;
  athleteProfile?: AthleteProfile;
  resolvedStream?: UnifiedActivity['streams'];
  workerAnalytics: ComputedStreamAnalytics | null;
  isScanningSegments: boolean;
  onScanMoreSegments?: () => Promise<void>;
  onSelectActivity: (activity: UnifiedActivity | null) => void;
  modalSelectedSegmentId: string | null;
  setModalSelectedSegmentId: React.Dispatch<React.SetStateAction<string | null>>;
  segmentHistoryBySegmentId: Map<string, SegmentHistorySummary>;
  repeatedSegmentsList: RepeatedSegmentSummary[];
  similarHistoricalWorkouts: UnifiedActivity[];
  handleAssignToCompareSlot: (act: UnifiedActivity, slot?: 'A' | 'B') => void;
  zoomStreamToTimeWindow: (startSecs: number, endSecs: number) => void;
}

export const ActivityInspectorZonesAndSplits: React.FC<
  ActivityInspectorZonesAndSplitsProps
> = ({
  selectedActivity,
  distanceUnit,
  athleteWeightKg,
  athleteProfile,
  resolvedStream: resolvedStreamProp,
  workerAnalytics,
  isScanningSegments,
  onScanMoreSegments,
  onSelectActivity,
  modalSelectedSegmentId,
  setModalSelectedSegmentId,
  segmentHistoryBySegmentId,
  repeatedSegmentsList,
  similarHistoricalWorkouts,
  handleAssignToCompareSlot,
  zoomStreamToTimeWindow,
}) => {
  const [hrZoneHoverIdx, setHrZoneHoverIdx] = useState<number | null>(null);
  const [showAutoZoneInsight, setShowAutoZoneInsight] = useState<boolean>(true);
  const [zoneArchetypeOverride, setZoneArchetypeOverride] = useState<
    'AUTO' | 'RECOVERY' | 'ENDURANCE' | 'TEMPO_SWEETSPOT' | 'THRESHOLD' | 'VO2MAX_RACE'
  >('AUTO');
  const [recoveredIntervalsByActivityId, setRecoveredIntervalsByActivityId] = useState<
    Record<string, ActivityInterval[]>
  >({});
  const [intervalRecoveryNote, setIntervalRecoveryNote] = useState<string | null>(null);

  useEffect(() => {
    setZoneArchetypeOverride('AUTO');
  }, [selectedActivity.id]);

  return (
    <div className="space-y-6">
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
                const resolvedStream = resolvedStreamProp;
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
                            className={`px-1.5 py-0.2 rounded text-2xs font-mono font-bold ${
                              showAutoZoneInsight
                                ? 'bg-ap-cobalt text-white dark:bg-ap-volt dark:text-ap-obsidian'
                                : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
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
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-ap-cobalt text-white dark:bg-ap-volt dark:text-ap-obsidian text-2xs font-mono font-bold uppercase tracking-wider">
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
                        <div className="flex items-center justify-between text-2xs font-mono text-slate-500">
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
                          <div className="flex items-center justify-between text-2xs font-mono text-indigo-600 dark:text-indigo-400">
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

                    {/* Single Canonical Horizontal Zone Breakdown with Progress Bars, Coach Target Pins & Delta Badges */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-2xs font-semibold text-slate-500 border-b border-slate-200 dark:border-slate-800 pb-1">
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
                                <span className="font-mono text-2xs text-slate-500 hidden sm:inline">
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
                                    className={`text-2xs px-1.5 py-0.2 rounded font-mono ${
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
                );
              })()}

              {/* Auto-Detected Intervals & Lap Splits + 1Hz Unstructured Track/Fartlek Rep Recovery */}
              {(() => {
                const candidateStream = resolvedStreamProp;
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
                            className="min-h-[30px] px-3 py-1 rounded-lg bg-ap-cobalt hover:bg-ap-clay-dark dark:bg-ap-volt dark:hover:bg-[#C8EF1E] text-white dark:text-ap-obsidian text-xs font-semibold transition-colors whitespace-nowrap"
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
                                tabIndex={0}
                                onClick={() =>
                                  zoomStreamToTimeWindow(
                                    Math.max(0, iv.startTimeSecs - 15),
                                    iv.startTimeSecs + iv.durationSecs + 15
                                  )
                                }
                                onKeyDown={(e) => {
                                  if (e.target !== e.currentTarget) return;
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    zoomStreamToTimeWindow(
                                      Math.max(0, iv.startTimeSecs - 15),
                                      iv.startTimeSecs + iv.durationSecs + 15
                                    );
                                  }
                                }}
                                className={`cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                                  iv.type === 'WORK'
                                    ? 'bg-blue-500/5 dark:bg-blue-500/10 font-medium hover:bg-blue-500/15'
                                    : 'opacity-75 hover:bg-slate-50 dark:hover:bg-slate-900/50'
                                }`}
                              >
                                <td className="py-2.5 pr-3 font-sans">
                                  <span
                                    className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold mr-2 ${
                                      iv.type === 'WORK'
                                        ? 'bg-ap-cobalt text-white dark:bg-ap-volt dark:text-ap-obsidian'
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
                            tabIndex={0}
                            onClick={() => onSelectActivity(sim)}
                            onKeyDown={(e) => {
                              if (e.target !== e.currentTarget) return;
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onSelectActivity(sim);
                              }
                            }}
                            className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
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
                                className="min-h-[28px] px-2.5 py-1 rounded-md bg-ap-cobalt hover:bg-ap-clay-dark dark:bg-ap-volt dark:hover:bg-[#C8EF1E] text-white dark:text-ap-obsidian text-xs font-semibold transition-colors whitespace-nowrap"
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
  );
};
