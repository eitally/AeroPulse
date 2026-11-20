import React, { useMemo, useState } from 'react';
import {
  Activity,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
} from "./icons/PhosphorIcons";
import {
  DistanceUnit,
  EnvironmentFilter,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import { formatDistance } from '../utils/formatters';
import { ChartInfoTooltip } from './ChartInfoTooltip';
import { useIsMobileViewport } from '../hooks/useIsMobileViewport';
import { getLocalDateIso, shiftIsoDate } from '../physiology/stravaLoadCalibration';

interface PhysiologicalTrendsViewProps {
  activities: UnifiedActivity[];
  wellnessDays: UnifiedWellnessDay[];
  envFilter?: EnvironmentFilter;
  distanceUnit?: DistanceUnit;
  athleteWeightKg: number;
  safeSportHideWeight?: boolean;
  onOpenCoachWithPrompt: (prompt: string) => void;
}

type TrendSpan = '6M' | '1Y' | '2Y' | 'ALL';

type TrendMetricKey =
  | 'vo2Max'
  | 'rideEftp'
  | 'wPerKg'
  | 'runEftp'
  | 'hrvRMSSD'
  | 'restingHR'
  | 'efficiencyFactor';

interface TrendMetricMeta {
  key: TrendMetricKey;
  label: string;
  shortLabel: string;
  unit: string;
  color: string;
  axisGroup: 'LEFT_POWER_VO2' | 'RIGHT_AUTONOMIC_EF';
  decimals: number;
  description: string;
}

const TREND_METRICS: TrendMetricMeta[] = [
  {
    key: 'vo2Max',
    label: 'VO2max',
    shortLabel: 'VO2max',
    unit: 'mL/kg/min',
    color: '#0284C7',
    axisGroup: 'RIGHT_AUTONOMIC_EF',
    decimals: 1,
    description: 'Maximal aerobic oxygen uptake ceiling',
  },
  {
    key: 'rideEftp',
    label: 'Cycling eFTP',
    shortLabel: 'Bike eFTP',
    unit: 'W',
    color: '#EA580C',
    axisGroup: 'LEFT_POWER_VO2',
    decimals: 0,
    description: '3-parameter Critical Power modelled cycling functional threshold',
  },
  {
    key: 'wPerKg',
    label: 'Relative Power (W/kg)',
    shortLabel: 'W/kg',
    unit: 'W/kg',
    color: '#7C3AED',
    axisGroup: 'RIGHT_AUTONOMIC_EF',
    decimals: 2,
    description: 'Cycling eFTP divided by synced body mass (climbing efficiency)',
  },
  {
    key: 'runEftp',
    label: 'Running eFTP',
    shortLabel: 'Run eFTP',
    unit: 'W',
    color: '#E11D48',
    axisGroup: 'LEFT_POWER_VO2',
    decimals: 0,
    description: 'Running metabolic threshold power',
  },
  {
    key: 'hrvRMSSD',
    label: 'Overnight HRV (7d rMSSD)',
    shortLabel: 'HRV rMSSD',
    unit: 'ms',
    color: '#059669',
    axisGroup: 'RIGHT_AUTONOMIC_EF',
    decimals: 0,
    description: '7-day rolling vagal parasympathetic heart rate variability',
  },
  {
    key: 'restingHR',
    label: 'Resting Heart Rate',
    shortLabel: 'Resting HR',
    unit: 'bpm',
    color: '#DC2626',
    axisGroup: 'RIGHT_AUTONOMIC_EF',
    decimals: 0,
    description: 'Overnight minimum resting heart rate (cardiac autonomic baseline)',
  },
  {
    key: 'efficiencyFactor',
    label: 'Aerobic Efficiency (EF×100)',
    shortLabel: 'Aerobic EF',
    unit: 'EF×100',
    color: '#D97706',
    axisGroup: 'RIGHT_AUTONOMIC_EF',
    decimals: 0,
    description: 'Rolling Normalized Power / Heart Rate ratio (scaled ×100 for legibility)',
  },
];

interface EnrichedTrendBucket {
  date: string;
  vo2Max: number | null;
  rideEftp: number | null;
  wPerKg: number | null;
  runEftp: number | null;
  hrvRMSSD: number | null;
  restingHR: number | null;
  efficiencyFactor: number | null; // scaled x100 e.g. 1.78 -> 178
  rawEf: number | null;
  weightKg: number | null;
  ctl: number;
}

export const PhysiologicalTrendsView: React.FC<PhysiologicalTrendsViewProps> = ({
  activities,
  wellnessDays,
  envFilter = 'COMBINED',
  distanceUnit = 'mi',
  athleteWeightKg,
  safeSportHideWeight = false,
  onOpenCoachWithPrompt,
}) => {
  const isMobile = useIsMobileViewport();
  const hideWeight = Boolean(safeSportHideWeight || athleteWeightKg <= 0);
  const visibleMetrics = useMemo(
    () => (hideWeight ? TREND_METRICS.filter((m) => m.key !== 'wPerKg') : TREND_METRICS),
    [hideWeight]
  );
  const [trendSpan, setTrendSpan] = useState<TrendSpan>('1Y');
  // Default to just 2 clean, complementary series so the chart is immediately legible and uncluttered
  const [selectedMetrics, setSelectedMetrics] = useState<TrendMetricKey[]>([
    'vo2Max',
    'rideEftp',
  ]);
  const effectiveSelectedMetrics = useMemo(() => {
    if (!hideWeight) return selectedMetrics;
    const filtered = selectedMetrics.filter((k) => k !== 'wPerKg');
    return filtered.length > 0 ? filtered : (['rideEftp'] as TrendMetricKey[]);
  }, [hideWeight, selectedMetrics]);
  const [scaleMode, setScaleMode] = useState<'RAW' | 'PCT_CHANGE'>('RAW');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showSeasonTable, setShowSeasonTable] = useState<boolean>(true);

  const toggleMetric = (key: TrendMetricKey) => {
    setSelectedMetrics((prev) => {
      if (prev.includes(key)) {
        if (prev.length <= 1) return prev; // Keep at least 1 metric visible
        return prev.filter((k) => k !== key);
      }
      return [...prev, key];
    });
  };

  // Build weekly/bi-weekly physiological series across the selected span
  const trendSeries = useMemo<EnrichedTrendBucket[]>(() => {
    const sorted = [...wellnessDays].sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length === 0) return [];

    let cutoffStr = '2010-01-01';
    if (trendSpan !== 'ALL') {
      const daysMap: Record<Exclude<TrendSpan, 'ALL'>, number> = {
        '6M': 180,
        '1Y': 365,
        '2Y': 730,
      };
      cutoffStr = shiftIsoDate(getLocalDateIso(), -daysMap[trendSpan]);
    }

    const filtered = sorted.filter((w) => w.date >= cutoffStr);
    const source = filtered.length >= 14 ? filtered : sorted;

    // Pre-index workout Efficiency Factor (EF) by date
    const efByDate = new Map<string, number[]>();
    for (const act of activities) {
      if (envFilter !== 'COMBINED' && act.environment !== envFilter) continue;
      if (act.efficiencyFactor && act.efficiencyFactor > 0.6 && act.efficiencyFactor < 3.5) {
        const dKey = act.startDateLocal.slice(0, 10);
        const list = efByDate.get(dKey) || [];
        list.push(act.efficiencyFactor);
        efByDate.set(dKey, list);
      }
    }

    // Only carry forward genuine observed positive values (never invent fake baselines)
    let lastVo2: number | null = null;
    let lastRideEftp: number | null = null;
    let lastRunEftp: number | null = null;
    let lastWeight: number | null = athleteWeightKg > 35 && athleteWeightKg !== 70 ? athleteWeightKg : null;
    let lastHrv: number | null = null;
    let lastRhr: number | null = null;
    let lastEf: number | null = null;

    const dailyClean = source.map((w) => {
      const vo2 = w.vo2MaxCycling || w.vo2MaxRunning || 0;
      if (vo2 > 25) lastVo2 = vo2;
      if (w.rideEftp && w.rideEftp > 60) lastRideEftp = Math.round(w.rideEftp);
      if (w.runEftp && w.runEftp > 80) lastRunEftp = Math.round(w.runEftp);
      if (w.weightKg && w.weightKg > 35 && w.weightKg !== 70) lastWeight = Number(w.weightKg.toFixed(1));
      if (w.hrvBaseline7d > 15) lastHrv = Math.round(w.hrvBaseline7d);
      else if (w.hrvRMSSD > 15) lastHrv = Math.round(w.hrvRMSSD);
      if (w.restingHR > 30) lastRhr = Math.round(w.restingHR);

      const dayEfs = efByDate.get(w.date);
      if (dayEfs && dayEfs.length > 0) {
        const meanDayEf = dayEfs.reduce((a, b) => a + b, 0) / dayEfs.length;
        lastEf =
          lastEf === null
            ? Number(meanDayEf.toFixed(2))
            : Number((lastEf * 0.8 + meanDayEf * 0.2).toFixed(2));
      }

      const wPerKg =
        lastRideEftp !== null && lastWeight !== null && lastWeight > 0
          ? Number((lastRideEftp / lastWeight).toFixed(2))
          : null;

      return {
        date: w.date,
        vo2Max: lastVo2 !== null ? Number(lastVo2.toFixed(1)) : null,
        rideEftp: lastRideEftp,
        wPerKg,
        runEftp: lastRunEftp,
        hrvRMSSD: lastHrv,
        restingHR: lastRhr,
        efficiencyFactor: lastEf !== null ? Math.round(lastEf * 100) : null,
        rawEf: lastEf,
        weightKg: lastWeight,
        ctl: Number((w.ctl || 0).toFixed(1)),
      };
    });

    // Downsample to ~65 smooth points so lines are crisp and easy to inspect
    const maxBuckets = 68;
    const step = Math.max(1, Math.floor(dailyClean.length / maxBuckets));
    const sampled: EnrichedTrendBucket[] = [];
    for (let i = 0; i < dailyClean.length; i += step) {
      sampled.push(dailyClean[i]);
    }
    if (
      dailyClean.length > 0 &&
      sampled[sampled.length - 1]?.date !== dailyClean[dailyClean.length - 1].date
    ) {
      sampled.push(dailyClean[dailyClean.length - 1]);
    }
    return sampled;
  }, [wellnessDays, activities, envFilter, trendSpan, athleteWeightKg]);

  // Multi-year season breakdown
  const yearlyComparison = useMemo(() => {
    const byYear: Record<
      string,
      {
        year: string;
        sessions: number;
        cyclingSessions: number;
        virtualCyclingSessions: number;
        runningSessions: number;
        totalDistanceMeters: number;
        totalSecs: number;
        totalLoad: number;
        peakRideEftp: number;
        peakRunEftp: number;
        peakVo2: number;
        avgEfSum: number;
        avgEfCount: number;
      }
    > = {};

    for (const act of activities) {
      if (envFilter !== 'COMBINED' && act.environment !== envFilter) continue;
      const yr = act.startDateLocal.slice(0, 4);
      if (!/^\d{4}$/.test(yr)) continue;
      if (!byYear[yr]) {
        byYear[yr] = {
          year: yr,
          sessions: 0,
          cyclingSessions: 0,
          virtualCyclingSessions: 0,
          runningSessions: 0,
          totalDistanceMeters: 0,
          totalSecs: 0,
          totalLoad: 0,
          peakRideEftp: 0,
          peakRunEftp: 0,
          peakVo2: 0,
          avgEfSum: 0,
          avgEfCount: 0,
        };
      }
      const b = byYear[yr];
      b.sessions += 1;
      if (act.sportCategory === 'Cycling') {
        b.cyclingSessions += 1;
        if (act.environment === 'INDOOR') b.virtualCyclingSessions += 1;
      }
      if (act.sportCategory === 'Running') b.runningSessions += 1;
      b.totalDistanceMeters += act.distanceMeters || 0;
      b.totalSecs += act.movingTimeSecs || 0;
      b.totalLoad += act.trainingLoad || 0;
      if (act.efficiencyFactor > 0) {
        b.avgEfSum += act.efficiencyFactor;
        b.avgEfCount += 1;
      }
    }

    for (const w of wellnessDays) {
      const yr = w.date.slice(0, 4);
      if (!byYear[yr]) continue;
      if ((w.rideEftp || 0) > byYear[yr].peakRideEftp) {
        byYear[yr].peakRideEftp = Math.round(w.rideEftp || 0);
      }
      if ((w.runEftp || 0) > byYear[yr].peakRunEftp) {
        byYear[yr].peakRunEftp = Math.round(w.runEftp || 0);
      }
      const vo2 = Math.max(w.vo2MaxCycling || 0, w.vo2MaxRunning || 0);
      if (vo2 > byYear[yr].peakVo2) {
        byYear[yr].peakVo2 = vo2;
      }
    }

    return Object.values(byYear)
      .sort((a, b) => b.year.localeCompare(a.year))
      .slice(0, 12);
  }, [activities, wellnessDays, envFilter]);

  const EMPTY_TREND_BUCKET: EnrichedTrendBucket = {
    date: '—',
    vo2Max: null,
    rideEftp: null,
    wPerKg: null,
    runEftp: null,
    hrvRMSSD: null,
    restingHR: null,
    efficiencyFactor: null,
    rawEf: null,
    weightKg: null,
    ctl: 0,
  };

  const firstPoint = trendSeries[0] || EMPTY_TREND_BUCKET;

  const latestPoint = trendSeries[trendSeries.length - 1] || firstPoint;
  const activeIdx =
    hoverIdx !== null && trendSeries[hoverIdx]
      ? hoverIdx
      : Math.max(0, trendSeries.length - 1);
  const activePoint = trendSeries[activeIdx] || latestPoint;

  const getMetricValue = (pt: EnrichedTrendBucket, key: TrendMetricKey): number | null => {
    switch (key) {
      case 'vo2Max':
        return pt.vo2Max;
      case 'rideEftp':
        return pt.rideEftp;
      case 'wPerKg':
        return pt.wPerKg;
      case 'runEftp':
        return pt.runEftp;
      case 'hrvRMSSD':
        return pt.hrvRMSSD;
      case 'restingHR':
        return pt.restingHR;
      case 'efficiencyFactor':
        return pt.efficiencyFactor;
    }
  };

  const formatMetricDisplay = (pt: EnrichedTrendBucket, meta: TrendMetricMeta): string => {
    const val = getMetricValue(pt, meta.key);
    if (val === null) return '—';
    if (meta.key === 'efficiencyFactor') {
      return pt.rawEf !== null ? `${pt.rawEf.toFixed(2)} EF` : '—';
    }
    return `${val.toFixed(meta.decimals)} ${meta.unit}`;
  };

  // Compute independent min/max for each selected metric so every toggled line utilizes the full vertical canvas cleanly
  const metricScales = useMemo(() => {
    const map = new Map<
      TrendMetricKey,
      {
        min: number;
        max: number;
        baseline: number;
        pctMin: number;
        pctMax: number;
        hasData: boolean;
      }
    >();

    let globalPctMin = -5;
    let globalPctMax = 5;

    for (const meta of TREND_METRICS) {
      const vals = trendSeries
        .map((pt) => getMetricValue(pt, meta.key))
        .filter((v): v is number => v !== null && v > 0);
      const hasData = vals.length > 0;
      const baseline = vals[0] ?? 1;
      const rawMin = hasData ? Math.min(...vals) : 0;
      const rawMax = hasData ? Math.max(...vals) : 100;
      const pad = Math.max(meta.key === 'wPerKg' ? 0.15 : 2, (rawMax - rawMin) * 0.18);

      const pcts = hasData
        ? vals.map((v) => ((v - baseline) / Math.max(0.01, baseline)) * 100)
        : [];
      const pMin = pcts.length > 0 ? Math.min(...pcts) : -5;
      const pMax = pcts.length > 0 ? Math.max(...pcts) : 5;
      if (effectiveSelectedMetrics.includes(meta.key) && hasData) {
        globalPctMin = Math.min(globalPctMin, Math.floor(pMin - 2));
        globalPctMax = Math.max(globalPctMax, Math.ceil(pMax + 2));
      }

      map.set(meta.key, {
        min: Number((rawMin - pad).toFixed(2)),
        max: Number((rawMax + pad).toFixed(2)),
        baseline,
        pctMin: globalPctMin,
        pctMax: globalPctMax,
        hasData,
      });
    }

    // Update shared pct bounds across all selected metrics
    for (const [k, v] of map.entries()) {
      map.set(k, { ...v, pctMin: globalPctMin, pctMax: globalPctMax });
    }

    return map;
  }, [trendSeries, effectiveSelectedMetrics]);

  const activeMetaList = visibleMetrics.filter((m) =>
    effectiveSelectedMetrics.includes(m.key)
  );
  const hasAnyActiveChartData = activeMetaList.some(
    (m) => Boolean(metricScales.get(m.key)?.hasData)
  );
  const primaryLeftMeta =
    activeMetaList.find(
      (m) => m.axisGroup === 'LEFT_POWER_VO2' && metricScales.get(m.key)?.hasData
    ) ||
    activeMetaList.find((m) => metricScales.get(m.key)?.hasData) ||
    activeMetaList[0];
  const secondaryRightMeta =
    activeMetaList.find(
      (m) => m.key !== primaryLeftMeta?.key && metricScales.get(m.key)?.hasData
    ) ||
    activeMetaList.find((m) => m.key !== primaryLeftMeta?.key) ||
    primaryLeftMeta;

  // Chart Geometry
  const svgW = isMobile ? 360 : 1100;
  const svgH = isMobile ? 245 : 440;
  const plotLeft = isMobile ? 36 : 64;
  const plotRight = isMobile
    ? secondaryRightMeta &&
      secondaryRightMeta.key !== primaryLeftMeta?.key &&
      scaleMode === 'RAW'
      ? 324
      : 350
    : 1026;
  const plotTop = isMobile ? 16 : 26;
  const plotBottom = isMobile ? 212 : 382;
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;

  const xFor = (idx: number) =>
    plotLeft + (idx / Math.max(1, trendSeries.length - 1)) * plotW;

  const yForMetric = (pt: EnrichedTrendBucket, key: TrendMetricKey): number | null => {
    const scale = metricScales.get(key);
    const val = getMetricValue(pt, key);
    if (!scale || !scale.hasData || val === null) return null;
    if (scaleMode === 'PCT_CHANGE') {
      const pct = ((val - scale.baseline) / Math.max(0.01, scale.baseline)) * 100;
      const span = Math.max(1, scale.pctMax - scale.pctMin);
      return plotBottom - ((pct - scale.pctMin) / span) * plotH;
    }
    const span = Math.max(0.05, scale.max - scale.min);
    return plotBottom - ((val - scale.min) / span) * plotH;
  };

  return (
    <div className="space-y-6">
      {/* ==========================================================================
          1. UNIFIED INTERACTIVE MULTI-METRIC PHYSIOLOGICAL TRENDS CHART
         ========================================================================== */}
      <section className="rounded-2xl liquid-glass p-5 space-y-5">
        {/* Top Header, Tooltip, Presets & Scale Controls */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/70 dark:border-white/10 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-sky-400">
                Custom Multi-Metric Physiological Explorer
              </span>
              <ChartInfoTooltip
                title="Long-Term Physiological Adaptation & Ceiling Explorer"
                subtitle="Exercise Physiologist Multi-System Trend Analysis"
                whatItMeasures={
                  hideWeight
                    ? 'Tracks your central cardiovascular ceiling (VO2max), threshold power (Cycling & Running eFTP), aerobic economy (Efficiency Factor EF), and autonomic nervous system cost (7d HRV rMSSD & Resting HR) on one unified timeline.'
                    : 'Tracks your central cardiovascular ceiling (VO2max), neuromuscular/metabolic threshold power (Cycling & Running eFTP, W/kg), aerobic economy (Efficiency Factor EF), and autonomic nervous system cost (7d HRV rMSSD & Resting HR) on one unified timeline.'
                }
                benchmarks={
                  hideWeight
                    ? 'True aerobic adaptation occurs when eFTP or EF rises while Overnight HRV remains stable within your baseline corridor and Resting HR stays steady or trends downward.'
                    : 'True aerobic adaptation occurs when eFTP, W/kg, or EF rises while Overnight HRV remains stable within your baseline corridor and Resting HR stays steady or trends downward.'
                }
                liveStatus={{
                  label: (() => {
                    const parts: string[] = [];
                    if (latestPoint.vo2Max !== null) parts.push(`VO2max ${latestPoint.vo2Max}`);
                    if (latestPoint.rideEftp !== null) {
                      parts.push(
                        `Bike eFTP ${latestPoint.rideEftp}W${!hideWeight && latestPoint.wPerKg !== null ? ` (${latestPoint.wPerKg} W/kg)` : ''}`
                      );
                    }
                    if (latestPoint.hrvRMSSD !== null) parts.push(`HRV ${latestPoint.hrvRMSSD}ms`);
                    return parts.length > 0 ? parts.join(' · ') : 'Awaiting wearable / threshold readings';
                  })(),
                  state:
                    latestPoint.rideEftp !== null &&
                    firstPoint.rideEftp !== null &&
                    latestPoint.rideEftp >= firstPoint.rideEftp &&
                    (latestPoint.hrvRMSSD === null ||
                      firstPoint.hrvRMSSD === null ||
                      latestPoint.hrvRMSSD >= firstPoint.hrvRMSSD * 0.9)
                      ? 'optimal'
                      : 'neutral',
                  interpretation:
                    latestPoint.rideEftp !== null && firstPoint.rideEftp !== null
                      ? `Over the ${trendSpan} window, Cycling eFTP moved ${
                          latestPoint.rideEftp - firstPoint.rideEftp >= 0 ? '+' : ''
                        }${latestPoint.rideEftp - firstPoint.rideEftp}W${
                          latestPoint.hrvRMSSD !== null ? ` while 7d HRV is ${latestPoint.hrvRMSSD}ms` : ''
                        }${
                          latestPoint.restingHR !== null ? ` and Resting HR is ${latestPoint.restingHR} bpm` : ''
                        }.`
                      : 'Sync a wearable or threshold power/pace workout to unlock longitudinal trend deltas.',
                }}
                coachingAction="Toggle 2–3 complementary metrics below (e.g., Bike eFTP + HRV rMSSD, or VO2max + Aerobic EF) to verify that threshold gains are backed by autonomic stability rather than sympathetic overreaching."
              />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">
              Long-Term Physiological Trends
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Click any metric pill below to include or remove it from the graph, or switch to{' '}
              <strong>% Change Mode</strong> to compare relative adaptation rates on a unified axis
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Scale Mode & Time Horizon Dropdowns */}
            <select
              value={scaleMode}
              aria-label="Scale mode"
              onChange={(e) => setScaleMode(e.target.value as 'RAW' | 'PCT_CHANGE')}
              className="min-h-[44px] sm:min-h-[34px] rounded-xl liquid-glass-subtle px-2.5 py-1 text-xs font-semibold text-slate-900 dark:text-slate-100 cursor-pointer"
            >
              <option value="RAW">Auto-Scaled Units</option>
              <option value="PCT_CHANGE">% Change vs Start</option>
            </select>

            <select
              value={trendSpan}
              aria-label="Physiological trends horizon"
              onChange={(e) => setTrendSpan(e.target.value as TrendSpan)}
              className="min-h-[44px] sm:min-h-[34px] rounded-xl liquid-glass-subtle px-2.5 py-1 text-xs font-mono font-semibold text-slate-900 dark:text-slate-100 cursor-pointer"
            >
              <option value="6M">6 Months</option>
              <option value="1Y">1 Year</option>
              <option value="2Y">2 Years</option>
              <option value="ALL">All-Time</option>
            </select>

            <button
              type="button"
              onClick={() => {
                const observedParts: string[] = [];
                if (latestPoint.vo2Max !== null) observedParts.push(`VO2max is ${latestPoint.vo2Max} mL/kg/min`);
                if (latestPoint.rideEftp !== null) {
                  observedParts.push(
                    `Cycling eFTP is ${latestPoint.rideEftp}W${!hideWeight && latestPoint.wPerKg !== null ? ` (${latestPoint.wPerKg} W/kg)` : ''}`
                  );
                }
                if (latestPoint.runEftp !== null) observedParts.push(`Running eFTP is ${latestPoint.runEftp}W`);
                if (latestPoint.hrvRMSSD !== null) observedParts.push(`7d HRV is ${latestPoint.hrvRMSSD}ms`);
                if (latestPoint.restingHR !== null) observedParts.push(`Resting HR is ${latestPoint.restingHR} bpm`);
                if (latestPoint.rawEf !== null) observedParts.push(`Aerobic EF is ${latestPoint.rawEf}`);
                const summary =
                  observedParts.length > 0
                    ? `Analyze my long-term physiological trends over ${trendSpan}: ${observedParts.join(', ')}. What is my primary physiological limiter and how should I structure the next mesocycle?`
                    : `I do not have recorded biometric or threshold test readings yet over ${trendSpan}. What minimal wearable or benchmark sessions should I record first to calibrate my baseline cleanly?`;
                onOpenCoachWithPrompt(summary);
              }}
              className="ap-btn-pine text-xs font-semibold cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Coach Trend Audit</span>
            </button>
          </div>
        </div>

        {/* Interactive Metric Toggle Pills + Quick Coaching Bundles */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <SlidersHorizontal className="w-3.5 h-3.5 ap-text-brand" />
              <span>Toggle Metrics Included on Graph ({effectiveSelectedMetrics.length} active):</span>
            </div>

            {/* Quick Physiologist Presets */}
            <div className="flex flex-wrap items-center gap-1.5 text-2xs">
              <span className="text-slate-600 dark:text-slate-400 font-mono uppercase">Quick Combos:</span>
              <button
                type="button"
                onClick={() => setSelectedMetrics(['vo2Max', 'rideEftp'])}
                className="ap-touch-row px-2.5 py-1 rounded-md liquid-glass-subtle hover:border-ap-cobalt/45 dark:hover:border-ap-volt/45 text-slate-700 dark:text-slate-300 font-medium transition-colors cursor-pointer"
              >
                Ceiling + Bike eFTP
              </button>
              <button
                type="button"
                onClick={() =>
                  setSelectedMetrics(
                    hideWeight
                      ? ['rideEftp', 'efficiencyFactor']
                      : ['rideEftp', 'wPerKg', 'efficiencyFactor']
                  )
                }
                className="ap-touch-row px-2.5 py-1 rounded-md liquid-glass-subtle hover:border-ap-cobalt/45 dark:hover:border-ap-volt/45 text-slate-700 dark:text-slate-300 font-medium transition-colors cursor-pointer"
              >
                {hideWeight ? 'Power + EF' : 'Power + W/kg + EF'}
              </button>
              <button
                type="button"
                onClick={() => setSelectedMetrics(['hrvRMSSD', 'restingHR'])}
                className="ap-touch-row px-2.5 py-1 rounded-md liquid-glass-subtle hover:border-ap-cobalt/45 dark:hover:border-ap-volt/45 text-slate-700 dark:text-slate-300 font-medium transition-colors cursor-pointer"
              >
                Autonomic (HRV + RHR)
              </button>
              <button
                type="button"
                onClick={() => setSelectedMetrics(['rideEftp', 'runEftp'])}
                className="ap-touch-row px-2.5 py-1 rounded-md liquid-glass-subtle hover:border-ap-cobalt/45 dark:hover:border-ap-volt/45 text-slate-700 dark:text-slate-300 font-medium transition-colors cursor-pointer"
              >
                Bike vs Run eFTP
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {visibleMetrics.map((meta) => {
              const isSelected = effectiveSelectedMetrics.includes(meta.key);
              const firstObserved =
                trendSeries
                  .map((pt) => getMetricValue(pt, meta.key))
                  .find((v): v is number => v !== null && v > 0) ?? null;
              const currVal = getMetricValue(activePoint, meta.key);
              const hasDelta = firstObserved !== null && currVal !== null;
              const delta = hasDelta ? currVal - firstObserved : 0;
              const pctDelta = hasDelta
                ? ((currVal - firstObserved) / Math.max(0.01, firstObserved)) * 100
                : null;

              return (
                <button
                  key={meta.key}
                  type="button"
                  onClick={() => toggleMetric(meta.key)}
                  title={meta.description}
                  className={`text-left rounded-xl p-2.5 transition-all border ${
                    isSelected
                      ? 'bg-white/85 dark:bg-slate-900/90 border-slate-300 dark:border-white/20 shadow-sm ring-1 ring-inset'
                      : 'bg-slate-100/40 dark:bg-slate-900/30 border-slate-200/50 dark:border-white/5 opacity-55 hover:opacity-90'
                  }`}
                  style={isSelected ? { borderColor: `${meta.color}66` } : undefined}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{
                          backgroundColor: isSelected ? meta.color : '#94A3B8',
                          boxShadow: isSelected ? `0 0 8px ${meta.color}80` : 'none',
                        }}
                      />
                      <span className="truncate">{meta.shortLabel}</span>
                    </span>
                    <span
                      className={`text-2xs font-mono px-1.5 py-0.2 rounded ${
                        isSelected
                          ? 'bg-slate-900/10 dark:bg-white/10 text-slate-800 dark:text-slate-200 font-semibold'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {isSelected ? 'ON' : 'OFF'}
                    </span>
                  </div>

                  <div className="mt-1.5 flex items-baseline justify-between font-mono tabular-nums">
                    <span
                      className="text-sm font-extrabold"
                      style={{ color: isSelected ? meta.color : undefined }}
                    >
                      {formatMetricDisplay(activePoint, meta)}
                    </span>
                    <span
                      className={`text-2xs font-semibold ${
                        pctDelta === null
                          ? 'text-slate-500 dark:text-slate-400'
                          : meta.key === 'restingHR'
                            ? delta <= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                            : delta >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {pctDelta === null
                        ? 'No data'
                        : pctDelta >= 0
                          ? `+${pctDelta.toFixed(1)}%`
                          : `${pctDelta.toFixed(1)}%`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Live Scrubber Readout Strip */}
        <div className="rounded-xl liquid-glass-subtle px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs font-mono tabular-nums">
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-blue-500" />
            <span className="font-sans font-semibold text-slate-700 dark:text-slate-300">
              Inspected Date:
            </span>
            <span className="font-bold text-slate-900 dark:text-white">{activePoint.date}</span>
            <span className="text-slate-600 dark:text-slate-400">|</span>
            <span className="text-slate-500">
              Fitness CTL: <strong className="text-sky-500">{activePoint.ctl}</strong>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {activeMetaList.map((meta) => {
              const scale = metricScales.get(meta.key);
              const curr = getMetricValue(activePoint, meta.key);
              const pct =
                scale && scale.hasData && curr !== null
                  ? ((curr - scale.baseline) / Math.max(0.01, scale.baseline)) * 100
                  : null;
              return (
                <div key={meta.key} className="inline-flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: meta.color }}
                  />
                  <span className="font-sans text-slate-500 dark:text-slate-400">
                    {meta.shortLabel}:
                  </span>
                  <strong className="text-slate-900 dark:text-white">
                    {formatMetricDisplay(activePoint, meta)}
                  </strong>
                  {pct !== null && (
                    <span className="text-2xs text-slate-500">
                      ({pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`})
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Large Unified SVG Multi-Metric Canvas */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-white/10 bg-white/40 dark:bg-ap-turf/45 p-2 sm:p-3">
          {!hasAnyActiveChartData ? (
            <div
              data-testid="trends-empty-state"
              className="py-12 px-4 text-center space-y-2"
            >
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                No observed readings yet for the selected metric(s)
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300 max-w-md mx-auto">
                Sync a wearable (Garmin, Polar, Wahoo, or Intervals.icu) or record threshold workouts to populate genuine trend curves without placeholder numbers.
              </p>
            </div>
          ) : (
          <svg
            viewBox={`0 0 ${svgW} ${svgH}`}
            className={
              isMobile
                ? 'w-full h-auto select-none overflow-visible'
                : 'w-full h-[440px] select-none overflow-visible'
            }
            onMouseLeave={() => setHoverIdx(null)}
          >
            <defs>
              {TREND_METRICS.map((m) => (
                <linearGradient
                  key={`grad-${m.key}`}
                  id={`trend-grad-${m.key}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={m.color} stopOpacity="0.22" />
                  <stop offset="100%" stopColor={m.color} stopOpacity="0.0" />
                </linearGradient>
              ))}
            </defs>

            {/* Horizontal Gridlines & Left/Right Axis Labels */}
            {[0, 0.25, 0.5, 0.75, 1].map((frac, idx) => {
              const y = plotBottom - frac * plotH;

              let leftTickLabel = '';
              let rightTickLabel = '';

              if (scaleMode === 'PCT_CHANGE') {
                const s = metricScales.get(primaryLeftMeta.key);
                const pctVal = s ? s.pctMin + frac * (s.pctMax - s.pctMin) : 0;
                leftTickLabel = `${pctVal > 0 ? '+' : ''}${pctVal.toFixed(0)}%`;
                rightTickLabel = leftTickLabel;
              } else {
                if (primaryLeftMeta) {
                  const sL = metricScales.get(primaryLeftMeta.key);
                  if (sL) {
                    const vL = sL.min + frac * (sL.max - sL.min);
                    leftTickLabel =
                      primaryLeftMeta.key === 'efficiencyFactor'
                        ? (vL / 100).toFixed(2)
                        : vL.toFixed(primaryLeftMeta.decimals);
                  }
                }
                if (secondaryRightMeta && secondaryRightMeta.key !== primaryLeftMeta?.key) {
                  const sR = metricScales.get(secondaryRightMeta.key);
                  if (sR) {
                    const vR = sR.min + frac * (sR.max - sR.min);
                    rightTickLabel =
                      secondaryRightMeta.key === 'efficiencyFactor'
                        ? (vR / 100).toFixed(2)
                        : vR.toFixed(secondaryRightMeta.decimals);
                  }
                }
              }

              return (
                <g key={idx}>
                  <line
                    x1={plotLeft}
                    y1={y}
                    x2={plotRight}
                    y2={y}
                    stroke="currentColor"
                    className="text-slate-200/80 dark:text-slate-800/90"
                    strokeDasharray="3 3"
                  />
                  {leftTickLabel && (
                    <text
                      x={plotLeft - 8}
                      y={y + 4}
                      textAnchor="end"
                      className="text-2xs font-mono"
                      fill={
                        scaleMode === 'PCT_CHANGE'
                          ? '#64748B'
                          : primaryLeftMeta?.color || '#64748B'
                      }
                    >
                      {leftTickLabel}
                    </text>
                  )}
                  {rightTickLabel && (
                    <text
                      x={plotRight + 8}
                      y={y + 4}
                      textAnchor="start"
                      className="text-2xs font-mono"
                      fill={
                        scaleMode === 'PCT_CHANGE'
                          ? '#64748B'
                          : secondaryRightMeta?.color || '#64748B'
                      }
                    >
                      {rightTickLabel}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Zero-Line in % Change Mode */}
            {scaleMode === 'PCT_CHANGE' &&
              (() => {
                const s = metricScales.get(primaryLeftMeta.key);
                if (!s || s.pctMin > 0 || s.pctMax < 0) return null;
                const zeroY =
                  plotBottom - ((0 - s.pctMin) / Math.max(1, s.pctMax - s.pctMin)) * plotH;
                return (
                  <line
                    x1={plotLeft}
                    y1={zeroY}
                    x2={plotRight}
                    y2={zeroY}
                    stroke="#94A3B8"
                    strokeWidth="1.25"
                    strokeDasharray="4 4"
                  />
                );
              })()}

            {/* Left & Right Y-Axis Titles */}
            {!isMobile && primaryLeftMeta && (
              <text
                x={16}
                y={plotTop + plotH / 2}
                transform={`rotate(-90 16 ${plotTop + plotH / 2})`}
                textAnchor="middle"
                className="text-2xs font-sans font-bold"
                fill={scaleMode === 'PCT_CHANGE' ? '#64748B' : primaryLeftMeta.color}
              >
                {scaleMode === 'PCT_CHANGE'
                  ? 'Relative Change vs. Window Start (%)'
                  : `${primaryLeftMeta.label} (${primaryLeftMeta.unit})`}
              </text>
            )}
            {!isMobile &&
              secondaryRightMeta &&
              secondaryRightMeta.key !== primaryLeftMeta?.key &&
              scaleMode === 'RAW' && (
                <text
                  x={svgW - 14}
                  y={plotTop + plotH / 2}
                  transform={`rotate(90 ${svgW - 14} ${plotTop + plotH / 2})`}
                  textAnchor="middle"
                  className="text-2xs font-sans font-bold"
                  fill={secondaryRightMeta.color}
                >
                  {secondaryRightMeta.label} ({secondaryRightMeta.unit})
                </text>
              )}

            {/* Area Fill for the Primary Selected Metric (when 1 or 2 metrics selected) */}
            {activeMetaList.length <= 2 &&
              primaryLeftMeta &&
              metricScales.get(primaryLeftMeta.key)?.hasData &&
              trendSeries.length > 1 &&
              (() => {
                const coords = trendSeries
                  .map((pt, i) => {
                    const y = yForMetric(pt, primaryLeftMeta.key);
                    return y !== null ? { x: xFor(i), y } : null;
                  })
                  .filter((c): c is { x: number; y: number } => c !== null);
                if (coords.length < 2) return null;
                const pts = coords.map((c) => `${c.x},${c.y}`).join(' ');
                const area = `${coords[0].x},${plotBottom} ${pts} ${coords[coords.length - 1].x},${plotBottom}`;
                return <polygon points={area} fill={`url(#trend-grad-${primaryLeftMeta.key})`} />;
              })()}

            {/* Polylines for Every Selected Metric */}
            {activeMetaList.map((meta) => {
              if (!metricScales.get(meta.key)?.hasData) return null;
              const coords = trendSeries
                .map((pt, i) => {
                  const y = yForMetric(pt, meta.key);
                  return y !== null ? { x: xFor(i), y } : null;
                })
                .filter((c): c is { x: number; y: number } => c !== null);
              if (coords.length === 0) return null;
              const pointsStr = coords.map((c) => `${c.x},${c.y}`).join(' ');
              const activeY = yForMetric(activePoint, meta.key);
              return (
                <g key={`series-${meta.key}`}>
                  {coords.length > 1 && (
                    <polyline
                      fill="none"
                      stroke={meta.color}
                      strokeWidth="2.6"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      points={pointsStr}
                    />
                  )}
                  {/* Active Hover Node */}
                  {activeY !== null && (
                    <circle
                      cx={xFor(activeIdx)}
                      cy={activeY}
                      r={4.8}
                      fill={meta.color}
                      stroke="#ffffff"
                      strokeWidth="1.8"
                    />
                  )}
                </g>
              );
            })}

            {/* Vertical Crosshair Line */}
            <line
              x1={xFor(activeIdx)}
              y1={plotTop}
              x2={xFor(activeIdx)}
              y2={plotBottom}
              stroke="#38BDF8"
              strokeWidth="1.2"
              strokeDasharray="3 3"
              opacity="0.85"
            />

            {/* X-Axis Date Ticks */}
            {[0, 0.25, 0.5, 0.75, 1].map((frac, idx) => {
              const i = Math.min(
                trendSeries.length - 1,
                Math.round(frac * Math.max(0, trendSeries.length - 1))
              );
              const pt = trendSeries[i];
              if (!pt) return null;
              return (
                <text
                  key={idx}
                  x={xFor(i)}
                  y={plotBottom + (isMobile ? 16 : 22)}
                  textAnchor="middle"
                  className="fill-slate-500 dark:fill-slate-400 text-2xs font-mono"
                >
                  {isMobile ? pt.date.slice(5) : pt.date}
                </text>
              );
            })}

            <text
              x={plotLeft + plotW / 2}
              y={svgH - 6}
              textAnchor="middle"
              className="fill-slate-500 dark:fill-slate-400 text-2xs sm:text-xs font-sans font-semibold"
            >
              Timeline ({trendSpan} Window · {firstPoint.date} → {latestPoint.date})
            </text>

            {/* Invisible Hover Hit Columns */}
            {trendSeries.map((pt, i) => {
              const colW = plotW / Math.max(1, trendSeries.length);
              return (
                <rect
                  key={pt.date}
                  x={xFor(i) - colW / 2}
                  y={plotTop}
                  width={colW}
                  height={plotH}
                  fill="transparent"
                  className="cursor-crosshair"
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseMove={() => setHoverIdx(i)}
                />
              );
            })}
          </svg>
          )}
        </div>
      </section>

      {/* ==========================================================================
          2. MULTI-YEAR SEASON COMPARISON TABLE (WITH VIRTUAL VS OUTDOOR BREAKDOWN)
         ========================================================================== */}
      <section className="rounded-2xl liquid-glass p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-500" />
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Multi-Year Season Comparison (Outdoor + Virtual Cycling &amp; Running Totals)
            </h2>
            <ChartInfoTooltip
              title="Multi-Year Macrocycle Progression Ledger"
              subtitle="Annualized Volume, Modality Split & Peak Physiological Ceiling"
              whatItMeasures="Aggregates annual workout counts (including explicit Virtual/Smart-Trainer vs. Outdoor Cycling breakdown), cumulative moving hours, TSS training load, peak Cycling/Running eFTP, and average Aerobic Efficiency (EF) per year."
              benchmarks="Progressive year-over-year aerobic development typically targets a 5–12% increase in annual training hours or average Efficiency Factor while protecting recovery."
              coachingAction="Compare your current season's Virtual + Outdoor volume and average EF against prior peak years to gauge macrocycle trajectory."
            />
          </div>

          <button
            type="button"
            onClick={() => setShowSeasonTable((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl liquid-glass-subtle text-xs font-semibold text-slate-700 dark:text-slate-300"
          >
            <span>{showSeasonTable ? 'Hide Season Table' : 'Show Season Table'}</span>
            {showSeasonTable ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {showSeasonTable && (
          <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-white/10">
            <table className="w-full text-left border-collapse text-xs sm:text-sm font-mono tabular-nums">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-100/60 dark:bg-slate-900/60 text-xs font-sans font-semibold text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-3">Season</th>
                  <th className="py-2.5 px-3 text-right">Total Sessions</th>
                  <th className="py-2.5 px-3 text-right">Bike (Virtual / Outdoor)</th>
                  <th className="py-2.5 px-3 text-right">Run Sessions</th>
                  <th className="py-2.5 px-3 text-right">Moving Hours</th>
                  <th className="py-2.5 px-3 text-right">Distance</th>
                  <th className="py-2.5 px-3 text-right">Cumulative Load</th>
                  <th className="py-2.5 px-3 text-right">Peak Bike / Run eFTP</th>
                  <th className="py-2.5 px-3 text-right">Avg Aerobic EF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/80">
                {yearlyComparison.map((yr) => {
                  const outdoorBikes = Math.max(
                    0,
                    yr.cyclingSessions - yr.virtualCyclingSessions
                  );
                  return (
                    <tr
                      key={yr.year}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-900/50 transition-colors"
                    >
                      <td className="py-2.5 px-3 font-sans font-bold text-slate-900 dark:text-slate-100">
                        {yr.year}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-slate-800 dark:text-slate-200">
                        {yr.sessions}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
                          {yr.virtualCyclingSessions} Virtual
                        </span>
                        <span className="text-slate-600 dark:text-slate-400"> · </span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                          {outdoorBikes} Outdoor
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-600 dark:text-slate-400">
                        {yr.runningSessions}
                      </td>
                      <td className="py-2.5 px-3 text-right text-blue-600 dark:text-sky-400 font-semibold">
                        {(yr.totalSecs / 3600).toFixed(1)}h
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-800 dark:text-slate-200">
                        {formatDistance(yr.totalDistanceMeters, distanceUnit, 0)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-amber-600 dark:text-amber-400 font-semibold">
                        {yr.totalLoad.toLocaleString()} TSS
                      </td>
                      <td className="py-2.5 px-3 text-right text-orange-600 dark:text-orange-400 font-semibold">
                        {yr.peakRideEftp > 0 ? `${yr.peakRideEftp}W` : '—'} /{' '}
                        {yr.peakRunEftp > 0 ? `${yr.peakRunEftp}W` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right text-emerald-600 dark:text-emerald-400 font-bold">
                        {yr.avgEfCount > 0 ? (yr.avgEfSum / yr.avgEfCount).toFixed(2) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
