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

interface PhysiologicalTrendsViewProps {
  activities: UnifiedActivity[];
  wellnessDays: UnifiedWellnessDay[];
  envFilter?: EnvironmentFilter;
  distanceUnit?: DistanceUnit;
  athleteWeightKg: number;
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
    label: 'Garmin VO2max',
    shortLabel: 'VO2max',
    unit: 'mL/kg/min',
    color: '#0EA5E9',
    axisGroup: 'RIGHT_AUTONOMIC_EF',
    decimals: 1,
    description: 'Maximal aerobic oxygen uptake ceiling (Firstbeat / Garmin)',
  },
  {
    key: 'rideEftp',
    label: 'Cycling eFTP',
    shortLabel: 'Bike eFTP',
    unit: 'W',
    color: '#F97316',
    axisGroup: 'LEFT_POWER_VO2',
    decimals: 0,
    description: '3-parameter Critical Power modelled cycling functional threshold',
  },
  {
    key: 'wPerKg',
    label: 'Relative Power (W/kg)',
    shortLabel: 'W/kg',
    unit: 'W/kg',
    color: '#A855F7',
    axisGroup: 'RIGHT_AUTONOMIC_EF',
    decimals: 2,
    description: 'Cycling eFTP divided by synced body mass (climbing efficiency)',
  },
  {
    key: 'runEftp',
    label: 'Running eFTP',
    shortLabel: 'Run eFTP',
    unit: 'W',
    color: '#EC4899',
    axisGroup: 'LEFT_POWER_VO2',
    decimals: 0,
    description: 'Running metabolic threshold power from Intervals.icu / Stryd model',
  },
  {
    key: 'hrvRMSSD',
    label: 'Overnight HRV (7d rMSSD)',
    shortLabel: 'HRV rMSSD',
    unit: 'ms',
    color: '#10B981',
    axisGroup: 'RIGHT_AUTONOMIC_EF',
    decimals: 0,
    description: '7-day rolling vagal parasympathetic heart rate variability',
  },
  {
    key: 'restingHR',
    label: 'Resting Heart Rate',
    shortLabel: 'Resting HR',
    unit: 'bpm',
    color: '#F43F5E',
    axisGroup: 'RIGHT_AUTONOMIC_EF',
    decimals: 0,
    description: 'Overnight minimum resting heart rate (cardiac autonomic baseline)',
  },
  {
    key: 'efficiencyFactor',
    label: 'Aerobic Efficiency (EF×100)',
    shortLabel: 'Aerobic EF',
    unit: 'EF×100',
    color: '#F59E0B',
    axisGroup: 'RIGHT_AUTONOMIC_EF',
    decimals: 0,
    description: 'Rolling Normalized Power / Heart Rate ratio (scaled ×100 for legibility)',
  },
];

interface EnrichedTrendBucket {
  date: string;
  vo2Max: number;
  rideEftp: number;
  wPerKg: number;
  runEftp: number;
  hrvRMSSD: number;
  restingHR: number;
  efficiencyFactor: number; // scaled x100 e.g. 1.78 -> 178
  rawEf: number;
  weightKg: number;
  ctl: number;
}

export const PhysiologicalTrendsView: React.FC<PhysiologicalTrendsViewProps> = ({
  activities,
  wellnessDays,
  envFilter = 'COMBINED',
  distanceUnit = 'km',
  athleteWeightKg,
  onOpenCoachWithPrompt,
}) => {
  const [trendSpan, setTrendSpan] = useState<TrendSpan>('1Y');
  // Default to just 2 clean, complementary series so the chart is immediately legible and uncluttered
  const [selectedMetrics, setSelectedMetrics] = useState<TrendMetricKey[]>([
    'vo2Max',
    'rideEftp',
  ]);
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

    const now = new Date();
    let cutoffStr = '2010-01-01';
    if (trendSpan !== 'ALL') {
      const daysMap: Record<Exclude<TrendSpan, 'ALL'>, number> = {
        '6M': 180,
        '1Y': 365,
        '2Y': 730,
      };
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - daysMap[trendSpan]);
      cutoffStr = d.toISOString().slice(0, 10);
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

    // Carry forward last valid values so sparse days don't drop to zero
    let lastVo2 = 51;
    let lastRideEftp = 310;
    let lastRunEftp = 340;
    let lastWeight = athleteWeightKg || 70;
    let lastHrv = 52;
    let lastRhr = 49;
    let lastEf = 1.72;

    const dailyClean = source.map((w) => {
      const vo2 = w.vo2MaxCycling || w.vo2MaxRunning || 0;
      if (vo2 > 25) lastVo2 = vo2;
      if (w.rideEftp && w.rideEftp > 120) lastRideEftp = Math.round(w.rideEftp);
      if (w.runEftp && w.runEftp > 150) lastRunEftp = Math.round(w.runEftp);
      if (w.weightKg && w.weightKg > 35) lastWeight = Number(w.weightKg.toFixed(1));
      if (w.hrvBaseline7d > 15) lastHrv = Math.round(w.hrvBaseline7d);
      else if (w.hrvRMSSD > 15) lastHrv = Math.round(w.hrvRMSSD);
      if (w.restingHR > 30) lastRhr = Math.round(w.restingHR);

      const dayEfs = efByDate.get(w.date);
      if (dayEfs && dayEfs.length > 0) {
        const meanDayEf = dayEfs.reduce((a, b) => a + b, 0) / dayEfs.length;
        lastEf = Number((lastEf * 0.8 + meanDayEf * 0.2).toFixed(2));
      }

      const wPerKg = Number((lastRideEftp / Math.max(40, lastWeight)).toFixed(2));

      return {
        date: w.date,
        vo2Max: Number(lastVo2.toFixed(1)),
        rideEftp: lastRideEftp,
        wPerKg,
        runEftp: lastRunEftp,
        hrvRMSSD: lastHrv,
        restingHR: lastRhr,
        efficiencyFactor: Math.round(lastEf * 100),
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

  const firstPoint = trendSeries[0] || {
    date: '—',
    vo2Max: 51,
    rideEftp: 310,
    wPerKg: 4.4,
    runEftp: 340,
    hrvRMSSD: 52,
    restingHR: 49,
    efficiencyFactor: 172,
    rawEf: 1.72,
    weightKg: 70,
    ctl: 65,
  };

  const latestPoint = trendSeries[trendSeries.length - 1] || firstPoint;
  const activeIdx =
    hoverIdx !== null && trendSeries[hoverIdx]
      ? hoverIdx
      : Math.max(0, trendSeries.length - 1);
  const activePoint = trendSeries[activeIdx] || latestPoint;

  const getMetricValue = (pt: EnrichedTrendBucket, key: TrendMetricKey): number => {
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
    if (meta.key === 'efficiencyFactor') {
      return `${pt.rawEf.toFixed(2)} EF`;
    }
    const val = getMetricValue(pt, meta.key);
    return `${val.toFixed(meta.decimals)} ${meta.unit}`;
  };

  // Compute independent min/max for each selected metric so every toggled line utilizes the full vertical canvas cleanly
  const metricScales = useMemo(() => {
    const map = new Map<
      TrendMetricKey,
      { min: number; max: number; baseline: number; pctMin: number; pctMax: number }
    >();

    let globalPctMin = -5;
    let globalPctMax = 5;

    for (const meta of TREND_METRICS) {
      const vals = trendSeries.map((pt) => getMetricValue(pt, meta.key)).filter((v) => v > 0);
      const baseline = vals[0] || 1;
      const rawMin = vals.length > 0 ? Math.min(...vals) : 0;
      const rawMax = vals.length > 0 ? Math.max(...vals) : 100;
      const pad = Math.max(meta.key === 'wPerKg' ? 0.15 : 2, (rawMax - rawMin) * 0.18);

      const pcts = vals.map((v) => ((v - baseline) / Math.max(0.01, baseline)) * 100);
      const pMin = pcts.length > 0 ? Math.min(...pcts) : -5;
      const pMax = pcts.length > 0 ? Math.max(...pcts) : 5;
      if (selectedMetrics.includes(meta.key)) {
        globalPctMin = Math.min(globalPctMin, Math.floor(pMin - 2));
        globalPctMax = Math.max(globalPctMax, Math.ceil(pMax + 2));
      }

      map.set(meta.key, {
        min: Number((rawMin - pad).toFixed(2)),
        max: Number((rawMax + pad).toFixed(2)),
        baseline,
        pctMin: globalPctMin,
        pctMax: globalPctMax,
      });
    }

    // Update shared pct bounds across all selected metrics
    for (const [k, v] of map.entries()) {
      map.set(k, { ...v, pctMin: globalPctMin, pctMax: globalPctMax });
    }

    return map;
  }, [trendSeries, selectedMetrics]);

  const activeMetaList = TREND_METRICS.filter((m) => selectedMetrics.includes(m.key));
  const primaryLeftMeta =
    activeMetaList.find((m) => m.axisGroup === 'LEFT_POWER_VO2') || activeMetaList[0];
  const secondaryRightMeta =
    activeMetaList.find((m) => m.key !== primaryLeftMeta?.key) || primaryLeftMeta;

  // Chart Geometry
  const svgW = 1100;
  const svgH = 440;
  const plotLeft = 64;
  const plotRight = 1026;
  const plotTop = 26;
  const plotBottom = 382;
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;

  const xFor = (idx: number) =>
    plotLeft + (idx / Math.max(1, trendSeries.length - 1)) * plotW;

  const yForMetric = (pt: EnrichedTrendBucket, key: TrendMetricKey): number => {
    const scale = metricScales.get(key);
    if (!scale) return plotBottom;
    const val = getMetricValue(pt, key);
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
                whatItMeasures="Tracks your central cardiovascular ceiling (VO2max), neuromuscular/metabolic threshold power (Cycling & Running eFTP, W/kg), aerobic economy (Efficiency Factor EF), and autonomic nervous system cost (7d HRV rMSSD & Resting HR) on one unified timeline."
                benchmarks="True aerobic adaptation occurs when eFTP, W/kg, or EF rises while Overnight HRV remains stable within your baseline corridor and Resting HR stays steady or trends downward."
                liveStatus={{
                  label: `VO2max ${latestPoint.vo2Max} · Bike eFTP ${latestPoint.rideEftp}W (${latestPoint.wPerKg} W/kg) · HRV ${latestPoint.hrvRMSSD}ms`,
                  state:
                    latestPoint.rideEftp >= firstPoint.rideEftp &&
                    latestPoint.hrvRMSSD >= firstPoint.hrvRMSSD * 0.9
                      ? 'optimal'
                      : 'neutral',
                  interpretation: `Over the ${trendSpan} window, Cycling eFTP moved ${
                    latestPoint.rideEftp - firstPoint.rideEftp >= 0 ? '+' : ''
                  }${latestPoint.rideEftp - firstPoint.rideEftp}W while 7d HRV is ${latestPoint.hrvRMSSD}ms and Resting HR is ${latestPoint.restingHR} bpm.`,
                }}
                coachingAction="Toggle 2–3 complementary metrics below (e.g., Bike eFTP + HRV rMSSD, or VO2max + Aerobic EF) to verify that threshold gains are backed by autonomic stability rather than sympathetic overreaching."
              />
            </div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">
              Long-Term Physiological Trends — Select Metrics to Compare
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Click any metric pill below to include or remove it from the graph, or switch to{' '}
              <strong>% Change Mode</strong> to compare relative adaptation rates on a unified axis
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Scale Mode Switcher: Raw Normalized vs % Delta */}
            <div className="flex items-center gap-1 p-1 rounded-xl liquid-capsule-track text-xs">
              <button
                type="button"
                onClick={() => setScaleMode('RAW')}
                className={`min-h-[30px] px-2.5 py-1 rounded-lg font-semibold transition-all ${
                  scaleMode === 'RAW'
                    ? 'liquid-capsule-active text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Auto-Scaled Units
              </button>
              <button
                type="button"
                onClick={() => setScaleMode('PCT_CHANGE')}
                className={`min-h-[30px] px-2.5 py-1 rounded-lg font-semibold transition-all ${
                  scaleMode === 'PCT_CHANGE'
                    ? 'liquid-capsule-active text-blue-600 dark:text-sky-300'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                % Change vs Start
              </button>
            </div>

            {/* Time Horizon Selector */}
            <div className="flex items-center gap-1 p-1 rounded-xl liquid-capsule-track text-xs font-mono">
              {(
                [
                  { id: '6M', label: '6 Months' },
                  { id: '1Y', label: '1 Year' },
                  { id: '2Y', label: '2 Years' },
                  { id: 'ALL', label: 'All-Time' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTrendSpan(t.id)}
                  className={`min-h-[30px] px-2.5 py-1 rounded-lg transition-all ${
                    trendSpan === t.id
                      ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() =>
                onOpenCoachWithPrompt(
                  `Analyze my long-term physiological trends over ${trendSpan}: VO2max is ${latestPoint.vo2Max} mL/kg/min, Cycling eFTP is ${latestPoint.rideEftp}W (${latestPoint.wPerKg} W/kg), Running eFTP is ${latestPoint.runEftp}W, 7d HRV is ${latestPoint.hrvRMSSD}ms, Resting HR is ${latestPoint.restingHR} bpm, and Aerobic EF is ${latestPoint.rawEf}. What is my primary physiological limiter and how should I structure the next mesocycle?`
                )
              }
              className="min-h-[34px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-xs font-semibold shadow-sm transition-all"
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
              <SlidersHorizontal className="w-3.5 h-3.5 text-blue-500" />
              <span>Toggle Metrics Included on Graph ({selectedMetrics.length} active):</span>
            </div>

            {/* Quick Physiologist Presets */}
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-slate-400 font-mono uppercase">Quick Combos:</span>
              <button
                type="button"
                onClick={() => setSelectedMetrics(['vo2Max', 'rideEftp'])}
                className="px-2 py-0.5 rounded-md liquid-glass-subtle hover:border-blue-500/40 text-slate-700 dark:text-slate-300 font-medium transition-colors"
              >
                Ceiling + Bike eFTP
              </button>
              <button
                type="button"
                onClick={() => setSelectedMetrics(['rideEftp', 'wPerKg', 'efficiencyFactor'])}
                className="px-2 py-0.5 rounded-md liquid-glass-subtle hover:border-blue-500/40 text-slate-700 dark:text-slate-300 font-medium transition-colors"
              >
                Power + W/kg + EF
              </button>
              <button
                type="button"
                onClick={() => setSelectedMetrics(['hrvRMSSD', 'restingHR'])}
                className="px-2 py-0.5 rounded-md liquid-glass-subtle hover:border-blue-500/40 text-slate-700 dark:text-slate-300 font-medium transition-colors"
              >
                Autonomic (HRV + RHR)
              </button>
              <button
                type="button"
                onClick={() => setSelectedMetrics(['rideEftp', 'runEftp'])}
                className="px-2 py-0.5 rounded-md liquid-glass-subtle hover:border-blue-500/40 text-slate-700 dark:text-slate-300 font-medium transition-colors"
              >
                Bike vs Run eFTP
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {TREND_METRICS.map((meta) => {
              const isSelected = selectedMetrics.includes(meta.key);
              const startVal = getMetricValue(firstPoint, meta.key);
              const currVal = getMetricValue(activePoint, meta.key);
              const delta = currVal - startVal;
              const pctDelta = ((currVal - startVal) / Math.max(0.01, startVal)) * 100;

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
                      className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                        isSelected
                          ? 'bg-slate-900/10 dark:bg-white/10 text-slate-800 dark:text-slate-200 font-semibold'
                          : 'text-slate-400'
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
                      className={`text-[10px] font-semibold ${
                        meta.key === 'restingHR'
                          ? delta <= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                          : delta >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {pctDelta >= 0 ? `+${pctDelta.toFixed(1)}%` : `${pctDelta.toFixed(1)}%`}
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
            <span className="text-slate-400">|</span>
            <span className="text-slate-500">
              Fitness CTL: <strong className="text-sky-500">{activePoint.ctl}</strong>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {activeMetaList.map((meta) => {
              const scale = metricScales.get(meta.key);
              const curr = getMetricValue(activePoint, meta.key);
              const pct = scale
                ? ((curr - scale.baseline) / Math.max(0.01, scale.baseline)) * 100
                : 0;
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
                  <span className="text-[11px] text-slate-500">
                    ({pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`})
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Large Unified SVG Multi-Metric Canvas */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-white/10 bg-white/40 dark:bg-slate-950/45 p-3">
          <svg
            viewBox={`0 0 ${svgW} ${svgH}`}
            className="w-full h-[380px] sm:h-[440px] select-none overflow-visible"
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
                      className="text-[11px] font-mono"
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
                      className="text-[11px] font-mono"
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
            {primaryLeftMeta && (
              <text
                x={16}
                y={plotTop + plotH / 2}
                transform={`rotate(-90 16 ${plotTop + plotH / 2})`}
                textAnchor="middle"
                className="text-[11px] font-sans font-bold"
                fill={scaleMode === 'PCT_CHANGE' ? '#64748B' : primaryLeftMeta.color}
              >
                {scaleMode === 'PCT_CHANGE'
                  ? 'Relative Change vs. Window Start (%)'
                  : `${primaryLeftMeta.label} (${primaryLeftMeta.unit})`}
              </text>
            )}
            {secondaryRightMeta &&
              secondaryRightMeta.key !== primaryLeftMeta?.key &&
              scaleMode === 'RAW' && (
                <text
                  x={svgW - 14}
                  y={plotTop + plotH / 2}
                  transform={`rotate(90 ${svgW - 14} ${plotTop + plotH / 2})`}
                  textAnchor="middle"
                  className="text-[11px] font-sans font-bold"
                  fill={secondaryRightMeta.color}
                >
                  {secondaryRightMeta.label} ({secondaryRightMeta.unit})
                </text>
              )}

            {/* Area Fill for the Primary Selected Metric (when 1 or 2 metrics selected) */}
            {activeMetaList.length <= 2 &&
              primaryLeftMeta &&
              trendSeries.length > 1 &&
              (() => {
                const pts = trendSeries
                  .map((pt, i) => `${xFor(i)},${yForMetric(pt, primaryLeftMeta.key)}`)
                  .join(' ');
                const area = `${plotLeft},${plotBottom} ${pts} ${plotRight},${plotBottom}`;
                return <polygon points={area} fill={`url(#trend-grad-${primaryLeftMeta.key})`} />;
              })()}

            {/* Polylines for Every Selected Metric */}
            {activeMetaList.map((meta) => {
              const pointsStr = trendSeries
                .map((pt, i) => `${xFor(i)},${yForMetric(pt, meta.key)}`)
                .join(' ');
              return (
                <g key={`series-${meta.key}`}>
                  <polyline
                    fill="none"
                    stroke={meta.color}
                    strokeWidth="2.6"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    points={pointsStr}
                  />
                  {/* Active Hover Node */}
                  <circle
                    cx={xFor(activeIdx)}
                    cy={yForMetric(activePoint, meta.key)}
                    r={4.8}
                    fill={meta.color}
                    stroke="#ffffff"
                    strokeWidth="1.8"
                  />
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
            {[0, 0.2, 0.4, 0.6, 0.8, 1].map((frac, idx) => {
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
                  y={plotBottom + 22}
                  textAnchor="middle"
                  className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                >
                  {pt.date}
                </text>
              );
            })}

            <text
              x={plotLeft + plotW / 2}
              y={svgH - 8}
              textAnchor="middle"
              className="fill-slate-500 dark:fill-slate-400 text-xs font-sans font-semibold"
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
                        <span className="text-slate-400"> · </span>
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
