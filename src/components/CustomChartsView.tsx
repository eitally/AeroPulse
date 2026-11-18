import React, { useId, useMemo, useState } from 'react';
import { Plus, Trash2 } from "./icons/PhosphorIcons";
import {
  ChartMetricKey,
  CustomChartConfig,
  DistanceUnit,
  EnvironmentFilter,
  SportCategory,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import { ChartInfoTooltip } from './ChartInfoTooltip';
import { useIsMobileViewport } from '../hooks/useIsMobileViewport';

interface CustomChartsViewProps {
  activities: UnifiedActivity[];
  wellnessDays: UnifiedWellnessDay[];
  distanceUnit: DistanceUnit;
  onOpenCoachWithPrompt: (prompt: string) => void;
}

interface MetricDefinition {
  key: ChartMetricKey;
  label: string;
  unit: string;
  source: 'WELLNESS' | 'ACTIVITY';
  color: string;
  aggMode: 'AVG' | 'SUM';
}

const METRIC_DEFINITIONS: MetricDefinition[] = [
  // Health & PMC Metrics
  { key: 'ctl', label: 'Fitness (CTL)', unit: 'load', source: 'WELLNESS', color: '#0284C7', aggMode: 'AVG' },
  { key: 'atl', label: 'Fatigue (ATL)', unit: 'load', source: 'WELLNESS', color: '#E11D48', aggMode: 'AVG' },
  { key: 'tsb', label: 'Form (TSB = CTL-ATL)', unit: 'form', source: 'WELLNESS', color: '#059669', aggMode: 'AVG' },
  { key: 'dailyLoad', label: 'Daily Training Load', unit: 'TSS', source: 'WELLNESS', color: '#D97706', aggMode: 'SUM' },
  { key: 'loadRatio', label: 'Load Ratio (ACWR)', unit: 'x', source: 'WELLNESS', color: '#0D9488', aggMode: 'AVG' },
  { key: 'sleepScore', label: 'Sleep Score', unit: '/100', source: 'WELLNESS', color: '#7C3AED', aggMode: 'AVG' },
  { key: 'sleepHours', label: 'Sleep Duration', unit: 'hrs', source: 'WELLNESS', color: '#0284C7', aggMode: 'AVG' },
  { key: 'hrvRMSSD', label: 'Overnight HRV (rMSSD)', unit: 'ms', source: 'WELLNESS', color: '#059669', aggMode: 'AVG' },
  { key: 'restingHR', label: 'Resting HR', unit: 'bpm', source: 'WELLNESS', color: '#DC2626', aggMode: 'AVG' },
  { key: 'vo2MaxCycling', label: 'VO2max', unit: 'mL/kg', source: 'WELLNESS', color: '#0D9488', aggMode: 'AVG' },
  { key: 'rideEftp', label: 'Cycling eFTP', unit: 'W', source: 'WELLNESS', color: '#0284C7', aggMode: 'AVG' },
  { key: 'runEftp', label: 'Running eFTP', unit: 'W', source: 'WELLNESS', color: '#EA580C', aggMode: 'AVG' },
  { key: 'steps', label: 'Daily Steps', unit: 'steps', source: 'WELLNESS', color: '#0D9488', aggMode: 'SUM' },
  { key: 'weightKg', label: 'Body Weight', unit: 'kg', source: 'WELLNESS', color: '#94A3B8', aggMode: 'AVG' },

  // Activity / Workout Metrics
  { key: 'activityDistanceKm', label: 'Workout Distance', unit: 'km', source: 'ACTIVITY', color: '#0284C7', aggMode: 'SUM' },
  { key: 'activityDurationMins', label: 'Workout Moving Time', unit: 'min', source: 'ACTIVITY', color: '#0D9488', aggMode: 'SUM' },
  { key: 'activityLoad', label: 'Workout Load (TSS)', unit: 'TSS', source: 'ACTIVITY', color: '#D97706', aggMode: 'SUM' },
  { key: 'normalizedPower', label: 'Normalized Power (NP)', unit: 'W', source: 'ACTIVITY', color: '#7C3AED', aggMode: 'AVG' },
  { key: 'avgPower', label: 'Average Power', unit: 'W', source: 'ACTIVITY', color: '#7C3AED', aggMode: 'AVG' },
  { key: 'avgHr', label: 'Workout Average HR', unit: 'bpm', source: 'ACTIVITY', color: '#DC2626', aggMode: 'AVG' },
  { key: 'maxHr', label: 'Workout Max HR', unit: 'bpm', source: 'ACTIVITY', color: '#E11D48', aggMode: 'AVG' },
  { key: 'efficiencyFactor', label: 'Efficiency Factor (NP/HR)', unit: 'EF', source: 'ACTIVITY', color: '#059669', aggMode: 'AVG' },
  { key: 'aerobicDecouplingPct', label: 'Aerobic Decoupling (Drift %)', unit: '%', source: 'ACTIVITY', color: '#D97706', aggMode: 'AVG' },
  { key: 'avgPaceMinKm', label: 'Running Pace', unit: 'min/km', source: 'ACTIVITY', color: '#EA580C', aggMode: 'AVG' },
  { key: 'avgCadence', label: 'Average Cadence', unit: 'rpm/spm', source: 'ACTIVITY', color: '#0D9488', aggMode: 'AVG' },
  { key: 'elevationGainMeters', label: 'Elevation Gain', unit: 'm', source: 'ACTIVITY', color: '#56BA00', aggMode: 'SUM' },
];

const DEFAULT_SAVED_CHARTS: CustomChartConfig[] = [
  {
    id: 'preset-sleep-hrv',
    title: 'Sleep Score vs. Overnight HRV (7d Rolling)',
    chartType: 'TIME_SERIES',
    primaryMetric: 'sleepScore',
    secondaryMetric: 'hrvRMSSD',
    aggregation: 'DAILY',
    rollingWindowDays: 7,
    sportFilter: 'ALL',
    environmentFilter: 'COMBINED',
    dateRangePreset: '90D',
  },
  {
    id: 'preset-ef-hr',
    title: 'Aerobic Efficiency Factor (NP/HR) vs. Average Heart Rate',
    chartType: 'TIME_SERIES',
    primaryMetric: 'efficiencyFactor',
    secondaryMetric: 'avgHr',
    aggregation: 'WEEKLY',
    rollingWindowDays: 1,
    sportFilter: 'ALL',
    environmentFilter: 'COMBINED',
    dateRangePreset: '1Y',
  },
  {
    id: 'preset-scatter-power-hr',
    title: 'Normalized Power vs. Heart Rate Correlation (All Workouts)',
    chartType: 'SCATTER',
    primaryMetric: 'normalizedPower',
    secondaryMetric: 'avgHr',
    aggregation: 'DAILY',
    rollingWindowDays: 1,
    sportFilter: 'ALL',
    environmentFilter: 'COMBINED',
    dateRangePreset: '1Y',
  },
  {
    id: 'preset-volume-alltime',
    title: 'Monthly Distance & Training Load (All-Time History)',
    chartType: 'TIME_SERIES',
    primaryMetric: 'activityDistanceKm',
    secondaryMetric: 'activityLoad',
    aggregation: 'MONTHLY',
    rollingWindowDays: 1,
    sportFilter: 'ALL',
    environmentFilter: 'COMBINED',
    dateRangePreset: 'ALL',
  },
];

export const CustomChartsView: React.FC<CustomChartsViewProps> = ({
  activities,
  wellnessDays,
  distanceUnit = 'mi',
  onOpenCoachWithPrompt,
}) => {
  const isMobile = useIsMobileViewport();
  const [savedCharts, setSavedCharts] = useState<CustomChartConfig[]>(() => {
    try {
      const raw = localStorage.getItem('aeropulse_custom_charts');
      return raw ? JSON.parse(raw) : DEFAULT_SAVED_CHARTS;
    } catch {
      return DEFAULT_SAVED_CHARTS;
    }
  });

  const hasWearableBiometrics = useMemo(
    () => wellnessDays.some((d) => (d.hrvRMSSD || 0) > 0 || (d.sleepScore || 0) > 0),
    [wellnessDays]
  );

  // Active Interactive Builder State
  const [title, setTitle] = useState(() =>
    hasWearableBiometrics
      ? 'Custom Physiological & Workload Plot'
      : 'Aerobic Efficiency Factor vs. Heart Rate'
  );
  const [chartType, setChartType] = useState<'TIME_SERIES' | 'SCATTER'>('TIME_SERIES');
  const [primaryMetric, setPrimaryMetric] = useState<ChartMetricKey>(() =>
    hasWearableBiometrics ? 'ctl' : 'efficiencyFactor'
  );
  const [secondaryMetric, setSecondaryMetric] = useState<ChartMetricKey | 'NONE'>(() =>
    hasWearableBiometrics ? 'sleepScore' : 'avgHr'
  );
  const [aggregation, setAggregation] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>(() =>
    hasWearableBiometrics ? 'DAILY' : 'WEEKLY'
  );
  const [rollingWindowDays, setRollingWindowDays] = useState<1 | 7 | 14 | 28 | 42 | 90>(7);
  const [sportFilter, setSportFilter] = useState<SportCategory | 'ALL'>('ALL');
  const [environmentFilter, setEnvironmentFilter] = useState<EnvironmentFilter>('COMBINED');
  const [dateRangePreset, setDateRangePreset] = useState<
    '30D' | '90D' | '6M' | '1Y' | '2Y' | 'ALL' | 'CUSTOM'
  >('1Y');
  const [customStartDate, setCustomStartDate] = useState('2024-01-01');
  const [customEndDate, setCustomEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const formId = useId();

  const metricDefinitions = useMemo(
    () =>
      METRIC_DEFINITIONS.map((m) => {
        if (m.key === 'weightKg') {
          return { ...m, unit: distanceUnit === 'mi' ? 'lbs' : 'kg' };
        }
        if (m.key === 'activityDistanceKm') {
          return { ...m, unit: distanceUnit === 'mi' ? 'mi' : 'km' };
        }
        if (m.key === 'avgPaceMinKm') {
          return { ...m, unit: distanceUnit === 'mi' ? 'min/mi' : 'min/km' };
        }
        if (m.key === 'elevationGainMeters') {
          return { ...m, unit: distanceUnit === 'mi' ? 'ft' : 'm' };
        }
        return m;
      }),
    [distanceUnit]
  );

  const primaryDef =
    metricDefinitions.find((m) => m.key === primaryMetric) || metricDefinitions[0];
  const secondaryDef =
    secondaryMetric !== 'NONE'
      ? metricDefinitions.find((m) => m.key === secondaryMetric)
      : undefined;

  const loadPresetChart = (cfg: CustomChartConfig) => {
    setTitle(cfg.title);
    setChartType(cfg.chartType);
    setPrimaryMetric(cfg.primaryMetric);
    setSecondaryMetric(cfg.secondaryMetric);
    setAggregation(cfg.aggregation);
    setRollingWindowDays(cfg.rollingWindowDays);
    setSportFilter(cfg.sportFilter);
    setEnvironmentFilter(cfg.environmentFilter);
    setDateRangePreset(cfg.dateRangePreset);
    if (cfg.customStartDate) setCustomStartDate(cfg.customStartDate);
    if (cfg.customEndDate) setCustomEndDate(cfg.customEndDate);
  };

  const handleSaveCurrentChart = () => {
    const newChart: CustomChartConfig = {
      id: `custom-${Date.now()}`,
      title: title || `${primaryDef.label} vs ${secondaryDef?.label || 'Time'}`,
      chartType,
      primaryMetric,
      secondaryMetric,
      aggregation,
      rollingWindowDays,
      sportFilter,
      environmentFilter,
      dateRangePreset,
      customStartDate,
      customEndDate,
    };
    const updated = [newChart, ...savedCharts];
    setSavedCharts(updated);
    try {
      localStorage.setItem('aeropulse_custom_charts', JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  const [pendingDeleteChartId, setPendingDeleteChartId] = useState<string | null>(null);

  const handleDeleteSavedChart = (id: string) => {
    const updated = savedCharts.filter((c) => c.id !== id);
    setSavedCharts(updated);
    setPendingDeleteChartId(null);
    try {
      localStorage.setItem('aeropulse_custom_charts', JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  // Compute start & end date bounds
  const { startBound, endBound } = useMemo(() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (dateRangePreset === 'CUSTOM') {
      return { startBound: customStartDate, endBound: customEndDate };
    }
    if (dateRangePreset === 'ALL') {
      return { startBound: '2010-01-01', endBound: today };
    }
    const daysMap: Record<string, number> = {
      '30D': 30,
      '90D': 90,
      '6M': 180,
      '1Y': 365,
      '2Y': 730,
    };
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - (daysMap[dateRangePreset] || 365));
    return { startBound: d.toISOString().slice(0, 10), endBound: today };
  }, [dateRangePreset, customStartDate, customEndDate]);

  // Build daily joined table of wellness + filtered activities across the selected date window
  const dailyJoinedPoints = useMemo(() => {
    const wellByDate = new Map<string, UnifiedWellnessDay>();
    for (const w of wellnessDays) {
      const d = w.date.slice(0, 10);
      if (d >= startBound && d <= endBound) {
        wellByDate.set(d, w);
      }
    }

    const actsByDate = new Map<string, UnifiedActivity[]>();
    for (const a of activities) {
      const d = a.startDateLocal.slice(0, 10);
      if (d < startBound || d > endBound) continue;
      if (sportFilter !== 'ALL' && a.sportCategory !== sportFilter) continue;
      if (environmentFilter !== 'COMBINED' && a.environment !== environmentFilter) continue;
      const list = actsByDate.get(d) || [];
      list.push(a);
      actsByDate.set(d, list);
    }

    const allDates = Array.from(
      new Set([...wellByDate.keys(), ...actsByDate.keys()])
    ).sort();

    const extractMetricValue = (
      key: ChartMetricKey,
      w?: UnifiedWellnessDay,
      dayActs: UnifiedActivity[] = []
    ): number | null => {
      switch (key) {
        case 'ctl':
          return w ? w.ctl : null;
        case 'atl':
          return w ? w.atl : null;
        case 'tsb':
          return w ? w.tsb : null;
        case 'dailyLoad':
          return w ? w.dailyLoad : dayActs.reduce((acc, a) => acc + a.trainingLoad, 0);
        case 'loadRatio':
          return w && w.ctl > 5 ? Number((w.atl / w.ctl).toFixed(2)) : null;
        case 'rampRate':
          return w ? w.rampRate : null;
        case 'hrvRMSSD':
          return w && w.hrvRMSSD > 0 ? w.hrvRMSSD : null;
        case 'restingHR':
          return w && w.restingHR > 0 ? w.restingHR : null;
        case 'sleepScore':
          return w && w.sleepScore > 0 ? w.sleepScore : null;
        case 'sleepHours':
          return w && w.sleepSecs > 0 ? Number((w.sleepSecs / 3600).toFixed(2)) : null;
        case 'vo2MaxCycling':
          return w && w.vo2MaxCycling ? w.vo2MaxCycling : null;
        case 'rideEftp':
          return w && w.rideEftp ? w.rideEftp : null;
        case 'runEftp':
          return w && w.runEftp ? w.runEftp : null;
        case 'steps':
          return w && w.steps ? w.steps : null;
        case 'weightKg':
          return w && w.weightKg
            ? distanceUnit === 'mi'
              ? Number((w.weightKg * 2.20462262).toFixed(1))
              : w.weightKg
            : null;
        case 'activityDistanceKm':
          return dayActs.length > 0
            ? Number(
                (
                  dayActs.reduce((acc, a) => acc + a.distanceMeters, 0) /
                  (distanceUnit === 'mi' ? 1609.344 : 1000)
                ).toFixed(2)
              )
            : 0;
        case 'activityDurationMins':
          return dayActs.length > 0
            ? Math.round(dayActs.reduce((acc, a) => acc + a.movingTimeSecs, 0) / 60)
            : 0;
        case 'activityLoad':
          return dayActs.length > 0
            ? dayActs.reduce((acc, a) => acc + a.trainingLoad, 0)
            : 0;
        case 'avgPower': {
          const withP = dayActs.filter((a) => (a.avgPower || 0) > 0);
          return withP.length > 0
            ? Math.round(withP.reduce((acc, a) => acc + (a.avgPower || 0), 0) / withP.length)
            : null;
        }
        case 'normalizedPower': {
          const withNp = dayActs.filter((a) => (a.normalizedPower || 0) > 0);
          return withNp.length > 0
            ? Math.round(
                withNp.reduce((acc, a) => acc + (a.normalizedPower || 0), 0) / withNp.length
              )
            : null;
        }
        case 'avgHr': {
          const withHr = dayActs.filter((a) => a.avgHr > 0);
          return withHr.length > 0
            ? Math.round(withHr.reduce((acc, a) => acc + a.avgHr, 0) / withHr.length)
            : null;
        }
        case 'maxHr': {
          const withMax = dayActs.filter((a) => a.maxHr > 0);
          return withMax.length > 0 ? Math.max(...withMax.map((a) => a.maxHr)) : null;
        }
        case 'efficiencyFactor': {
          const withEf = dayActs.filter((a) => a.efficiencyFactor > 0);
          return withEf.length > 0
            ? Number(
                (
                  withEf.reduce((acc, a) => acc + a.efficiencyFactor, 0) / withEf.length
                ).toFixed(2)
              )
            : null;
        }
        case 'aerobicDecouplingPct': {
          const withDec = dayActs.filter((a) => a.aerobicDecouplingPct !== 0);
          return withDec.length > 0
            ? Number(
                (
                  withDec.reduce((acc, a) => acc + a.aerobicDecouplingPct, 0) / withDec.length
                ).toFixed(1)
              )
            : null;
        }
        case 'avgPaceMinKm': {
          const withPace = dayActs.filter((a) => (a.avgPaceSecsPerKm || 0) > 0);
          const paceMultiplier = distanceUnit === 'mi' ? 1.609344 : 1;
          return withPace.length > 0
            ? Number(
                (
                  withPace.reduce(
                    (acc, a) => acc + ((a.avgPaceSecsPerKm || 0) * paceMultiplier) / 60,
                    0
                  ) / withPace.length
                ).toFixed(2)
              )
            : null;
        }
        case 'avgCadence': {
          const withCad = dayActs.filter((a) => (a.avgCadence || 0) > 0);
          return withCad.length > 0
            ? Math.round(
                withCad.reduce((acc, a) => acc + (a.avgCadence || 0), 0) / withCad.length
              )
            : null;
        }
        case 'elevationGainMeters':
          return dayActs.length > 0
            ? Math.round(
                dayActs.reduce((acc, a) => acc + a.elevationGainMeters, 0) *
                  (distanceUnit === 'mi' ? 3.28084 : 1)
              )
            : 0;
        default:
          return null;
      }
    };

    const rawDaily = allDates.map((d) => {
      const w = wellByDate.get(d);
      const acts = actsByDate.get(d) || [];
      return {
        date: d,
        val1: extractMetricValue(primaryMetric, w, acts),
        val2:
          secondaryMetric !== 'NONE'
            ? extractMetricValue(secondaryMetric, w, acts)
            : null,
        label: acts[0]?.name || d,
        environment: acts[0]?.environment || 'OUTDOOR',
      };
    });

    // Apply aggregation (DAILY, WEEKLY, MONTHLY)
    let aggregated = rawDaily;
    if (aggregation !== 'DAILY') {
      const buckets = new Map<
        string,
        { v1s: number[]; v2s: number[]; env: 'OUTDOOR' | 'INDOOR' }
      >();
      for (const pt of rawDaily) {
        let bucketKey = pt.date.slice(0, 7);
        if (aggregation === 'WEEKLY') {
          const dt = new Date(pt.date);
          const day = (dt.getUTCDay() + 6) % 7;
          dt.setUTCDate(dt.getUTCDate() - day);
          bucketKey = dt.toISOString().slice(0, 10);
        }
        const b = buckets.get(bucketKey) || { v1s: [], v2s: [], env: pt.environment };
        if (pt.val1 !== null) b.v1s.push(pt.val1);
        if (pt.val2 !== null) b.v2s.push(pt.val2);
        buckets.set(bucketKey, b);
      }

      aggregated = Array.from(buckets.entries()).map(([k, b]) => {
        const reduceVals = (vals: number[], mode: 'AVG' | 'SUM') => {
          if (vals.length === 0) return null;
          const sum = vals.reduce((a, c) => a + c, 0);
          return mode === 'SUM'
            ? Number(sum.toFixed(1))
            : Number((sum / vals.length).toFixed(2));
        };
        return {
          date: k,
          val1: reduceVals(b.v1s, primaryDef.aggMode),
          val2: secondaryDef ? reduceVals(b.v2s, secondaryDef.aggMode) : null,
          label: k,
          environment: b.env,
        };
      });
    }

    // Apply rolling average window if > 1 and TIME_SERIES
    if (rollingWindowDays > 1 && chartType === 'TIME_SERIES' && aggregation === 'DAILY') {
      aggregated = aggregated.map((pt, idx, arr) => {
        const slice = arr.slice(Math.max(0, idx - rollingWindowDays + 1), idx + 1);
        const v1Slice = slice.map((s) => s.val1).filter((v): v is number => v !== null);
        const v2Slice = slice.map((s) => s.val2).filter((v): v is number => v !== null);
        return {
          ...pt,
          val1:
            v1Slice.length > 0
              ? Number((v1Slice.reduce((a, b) => a + b, 0) / v1Slice.length).toFixed(2))
              : null,
          val2:
            v2Slice.length > 0
              ? Number((v2Slice.reduce((a, b) => a + b, 0) / v2Slice.length).toFixed(2))
              : null,
        };
      });
    }

    const valid = aggregated.filter((p) => p.val1 !== null || p.val2 !== null);
    if (chartType === 'TIME_SERIES' && valid.length > 240) {
      const step = Math.ceil(valid.length / 240);
      return valid.filter((_, i) => i % step === 0 || i === valid.length - 1);
    }
    return valid;
  }, [
    wellnessDays,
    activities,
    startBound,
    endBound,
    sportFilter,
    environmentFilter,
    primaryMetric,
    secondaryMetric,
    aggregation,
    rollingWindowDays,
    chartType,
    primaryDef,
    secondaryDef,
    distanceUnit,
  ]);

  // Compute Pearson Correlation (r), R^2, and Linear Regression for Scatter Plots
  const regressionStats = useMemo(() => {
    const pairs = dailyJoinedPoints.filter(
      (p): p is typeof p & { val1: number; val2: number } =>
        p.val1 !== null && p.val2 !== null && (p.val1 !== 0 || p.val2 !== 0)
    );
    if (pairs.length < 3) {
      return { count: pairs.length, r: 0, r2: 0, slope: 0, intercept: 0, pairs };
    }
    const n = pairs.length;
    const meanX = pairs.reduce((a, p) => a + p.val1, 0) / n;
    const meanY = pairs.reduce((a, p) => a + p.val2, 0) / n;
    let num = 0;
    let denX = 0;
    let denY = 0;
    for (const p of pairs) {
      const dx = p.val1 - meanX;
      const dy = p.val2 - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    const slope = denX > 0 ? num / denX : 0;
    const intercept = meanY - slope * meanX;
    const r = denX > 0 && denY > 0 ? num / Math.sqrt(denX * denY) : 0;
    return {
      count: n,
      r: Number(r.toFixed(3)),
      r2: Number((r * r).toFixed(3)),
      slope: Number(slope.toFixed(3)),
      intercept: Number(intercept.toFixed(2)),
      pairs,
    };
  }, [dailyJoinedPoints]);

  const activeHoverPoint =
    hoverIdx !== null && dailyJoinedPoints[hoverIdx]
      ? dailyJoinedPoints[hoverIdx]
      : dailyJoinedPoints[dailyJoinedPoints.length - 1];

  return (
    <div className="space-y-6">
      {/* Saved Custom & Preset Charts Ribbon */}
      <section className="rounded-2xl liquid-glass p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Custom Chart Builder &amp; Correlation Lab
              </h1>
              <ChartInfoTooltip
                title="Custom Multi-Metric Time-Series & Correlation Lab"
                subtitle="Bivariate Physiological Regression (r, R², Linear Fit)"
                whatItMeasures="Lets you pair any wellness biomarker (Sleep Score, HRV rMSSD, Resting HR, CTL, ATL, TSB, Weight) with any workout performance metric (Normalized Power, Efficiency Factor, Decoupling, Load) as either a Dual-Axis Time-Series or X-vs-Y Scatter Plot."
                benchmarks="|r| ≥ 0.50 indicates a strong physiological correlation; |r| between 0.25 and 0.49 indicates a moderate relationship."
                liveStatus={{
                  label: `${primaryDef.label} vs ${secondaryDef?.label || 'Time'} · r = ${regressionStats.r} (R² = ${regressionStats.r2})`,
                  state: Math.abs(regressionStats.r) >= 0.35 ? 'optimal' : 'neutral',
                  interpretation: `Analyzing ${regressionStats.count} paired observations across the ${dateRangePreset} window (${startBound} to ${endBound}).`,
                }}
                coachingAction="Switch Chart Mode to 'Scatter / Correlation (X vs Y)' to test hypotheses like 'Does Sleep Score predict next-day Efficiency Factor?' or 'How strongly does CTL correlate with Cycling eFTP?'"
              />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Plot any combination of Sleep, HRV, CTL/ATL/TSB, Power, Heart Rate, Pace, and Efficiency over any custom date window
            </p>
          </div>
          <button
            type="button"
            onClick={handleSaveCurrentChart}
            className="min-h-[44px] sm:min-h-[38px] px-3.5 py-1.5 rounded-lg bg-[#1C5436] hover:bg-[#16422A] dark:bg-[#C8FF00] dark:hover:bg-[#B5EB00] text-white dark:text-[#080A09] text-sm font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Save Current Chart View</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          {savedCharts.map((cfg) => (
            <div
              key={cfg.id}
              className="flex items-center gap-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3 py-1 text-xs"
            >
              <button
                type="button"
                onClick={() => loadPresetChart(cfg)}
                className="min-h-[44px] sm:min-h-[32px] font-medium text-slate-800 dark:text-slate-200 hover:text-blue-500 transition-colors text-left"
              >
                {cfg.title}
              </button>
              {!cfg.id.startsWith('preset-') &&
                (pendingDeleteChartId === cfg.id ? (
                  <div className="inline-flex items-center gap-1 ml-1">
                    <button
                      type="button"
                      onClick={() => handleDeleteSavedChart(cfg.id)}
                      className="min-h-[44px] sm:min-h-[28px] px-2 py-0.5 rounded bg-rose-600 text-white text-2xs font-bold"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDeleteChartId(null)}
                      className="min-h-[44px] sm:min-h-[28px] px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-2xs"
                    >
                      Keep
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPendingDeleteChartId(cfg.id)}
                    aria-label={`Delete saved chart ${cfg.title}`}
                    className="min-h-[44px] min-w-[44px] sm:min-h-[28px] sm:min-w-[28px] inline-flex items-center justify-center rounded text-slate-600 dark:text-slate-400 hover:text-red-500 ml-1"
                    title="Delete saved chart"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                ))}
            </div>
          ))}
        </div>
      </section>

      {/* Interactive Chart Configuration Matrix */}
      <section className="rounded-2xl liquid-glass p-5 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-xs">
          {/* 1. Chart Type */}
          <div>
            <label
              htmlFor={`${formId}-chart-mode`}
              className="block font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Chart Mode
            </label>
            <select
              id={`${formId}-chart-mode`}
              value={chartType}
              onChange={(e) => setChartType(e.target.value as 'TIME_SERIES' | 'SCATTER')}
              className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 py-1.5 text-slate-900 dark:text-slate-100 font-medium"
            >
              <option value="TIME_SERIES">Multi-Axis Time-Series</option>
              <option value="SCATTER">Scatter / Correlation (X vs Y)</option>
            </select>
          </div>

          {/* 2. Primary Metric (Left Y or X-Axis) */}
          <div>
            <label
              htmlFor={`${formId}-primary-metric`}
              className="block font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              {chartType === 'SCATTER' ? 'X-Axis Metric' : 'Primary Metric (Left Axis)'}
            </label>
            <select
              id={`${formId}-primary-metric`}
              value={primaryMetric}
              onChange={(e) => setPrimaryMetric(e.target.value as ChartMetricKey)}
              className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 py-1.5 text-slate-900 dark:text-slate-100 font-medium"
            >
              {metricDefinitions.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label} ({m.unit})
                </option>
              ))}
            </select>
          </div>

          {/* 3. Secondary Metric (Right Y or Y-Axis) */}
          <div>
            <label
              htmlFor={`${formId}-secondary-metric`}
              className="block font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              {chartType === 'SCATTER' ? 'Y-Axis Metric' : 'Secondary Metric (Right Axis)'}
            </label>
            <select
              id={`${formId}-secondary-metric`}
              value={secondaryMetric}
              onChange={(e) =>
                setSecondaryMetric(e.target.value as ChartMetricKey | 'NONE')
              }
              className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 py-1.5 text-slate-900 dark:text-slate-100 font-medium"
            >
              {chartType === 'TIME_SERIES' && <option value="NONE">None (Single Metric)</option>}
              {metricDefinitions.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label} ({m.unit})
                </option>
              ))}
            </select>
          </div>

          {/* 4. Aggregation Bucket */}
          <div>
            <label
              htmlFor={`${formId}-time-aggregation`}
              className="block font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Time Aggregation
            </label>
            <select
              id={`${formId}-time-aggregation`}
              value={aggregation}
              onChange={(e) =>
                setAggregation(e.target.value as 'DAILY' | 'WEEKLY' | 'MONTHLY')
              }
              className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 py-1.5 text-slate-900 dark:text-slate-100 font-medium"
            >
              <option value="DAILY">Daily Data Points</option>
              <option value="WEEKLY">Weekly Aggregated</option>
              <option value="MONTHLY">Monthly Aggregated</option>
            </select>
          </div>

          {/* 5. Rolling Average Smoothing */}
          <div>
            <label
              htmlFor={`${formId}-rolling-smoothing`}
              className="block font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Rolling Smoothing
            </label>
            <select
              id={`${formId}-rolling-smoothing`}
              value={rollingWindowDays}
              onChange={(e) =>
                setRollingWindowDays(Number(e.target.value) as 1 | 7 | 14 | 28 | 42 | 90)
              }
              disabled={chartType === 'SCATTER' || aggregation !== 'DAILY'}
              className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 py-1.5 text-slate-900 dark:text-slate-100 font-medium disabled:opacity-50"
            >
              <option value={1}>Raw (1-Day)</option>
              <option value={7}>7-Day Rolling Avg</option>
              <option value={14}>14-Day Rolling Avg</option>
              <option value={28}>28-Day Rolling Avg</option>
              <option value={42}>42-Day Rolling Avg</option>
              <option value={90}>90-Day Rolling Avg</option>
            </select>
          </div>

          {/* 6. Sport Filter */}
          <div>
            <label
              htmlFor={`${formId}-sport-filter`}
              className="block font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Sport Filter
            </label>
            <select
              id={`${formId}-sport-filter`}
              value={sportFilter}
              onChange={(e) => setSportFilter(e.target.value as SportCategory | 'ALL')}
              className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 py-1.5 text-slate-900 dark:text-slate-100 font-medium"
            >
              <option value="ALL">All Sports</option>
              <option value="Cycling">Cycling Only</option>
              <option value="Running">Running Only</option>
              <option value="Strength">Strength / HIIT</option>
              <option value="Swimming">Swimming</option>
            </select>
          </div>
        </div>

        {/* Date Range Presets & Environment Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${formId}-time-period`} className="text-slate-500 font-medium">
              Time Period:
            </label>
            <select
              id={`${formId}-time-period`}
              aria-label="Chart time period"
              value={dateRangePreset}
              onChange={(e) =>
                setDateRangePreset(
                  e.target.value as '30D' | '90D' | '6M' | '1Y' | '2Y' | 'ALL' | 'CUSTOM'
                )
              }
              className="min-h-[44px] sm:min-h-[36px] rounded-xl liquid-glass-subtle px-3 py-1 text-xs font-mono font-semibold text-slate-900 dark:text-slate-100 cursor-pointer"
            >
              <option value="30D">30d</option>
              <option value="90D">90d</option>
              <option value="6M">6m</option>
              <option value="1Y">1y</option>
              <option value="2Y">2y</option>
              <option value="ALL">All-Time</option>
              <option value="CUSTOM">Custom Dates</option>
            </select>

            {dateRangePreset === 'CUSTOM' && (
              <div className="flex flex-wrap items-center gap-1.5 font-mono">
                <input
                  type="date"
                  value={customStartDate}
                  aria-label="Custom chart start date"
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 py-1"
                />
                <span>to</span>
                <input
                  type="date"
                  value={customEndDate}
                  aria-label="Custom chart end date"
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 py-1"
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor={`${formId}-env-filter`} className="text-slate-500 font-medium">
              Environment:
            </label>
            <select
              id={`${formId}-env-filter`}
              aria-label="Chart environment filter"
              value={environmentFilter}
              onChange={(e) => setEnvironmentFilter(e.target.value as EnvironmentFilter)}
              className="min-h-[44px] sm:min-h-[36px] rounded-xl liquid-glass-subtle px-3 py-1 text-xs font-semibold text-slate-900 dark:text-slate-100 cursor-pointer"
            >
              <option value="COMBINED">Combined</option>
              <option value="OUTDOOR">Outdoor</option>
              <option value="INDOOR">Indoor</option>
            </select>
          </div>
        </div>

        {/* Active Canvas Header & Readout */}
        <div className="rounded-lg bg-slate-50 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm font-mono tabular-nums">
          <div className="font-sans font-bold text-slate-900 dark:text-slate-100">
            {primaryDef.label}{' '}
            {secondaryDef ? `vs. ${secondaryDef.label}` : ''} ({startBound} → {endBound})
          </div>

          {chartType === 'TIME_SERIES' && activeHoverPoint ? (
            <div className="flex flex-wrap items-center gap-4 text-xs sm:text-sm">
              <span className="font-bold text-slate-700 dark:text-slate-200">
                Date: {activeHoverPoint.date}
              </span>
              <span style={{ color: primaryDef.color }} className="font-bold">
                {primaryDef.label}: {activeHoverPoint.val1 ?? '—'} {primaryDef.unit}
              </span>
              {secondaryDef && (
                <span style={{ color: secondaryDef.color }} className="font-bold">
                  {secondaryDef.label}: {activeHoverPoint.val2 ?? '—'} {secondaryDef.unit}
                </span>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-4 text-xs sm:text-sm">
              <span>Matched Pairs: {regressionStats.count}</span>
              <span className="text-blue-500 font-bold">
                Pearson r = {regressionStats.r} (R² = {regressionStats.r2})
              </span>
              <span className="text-emerald-500 font-semibold">
                Slope: {regressionStats.slope} {secondaryDef?.unit}/{primaryDef.unit}
              </span>
            </div>
          )}
        </div>

        {/* SVG Chart Canvas with Full X & Y Axis Titles and Larger Tick Labels */}
        <div
          className="rounded-xl border border-slate-200 dark:border-slate-800 p-2 sm:p-4 select-none"
          onMouseLeave={() => setHoverIdx(null)}
        >
          {(() => {
            const svgW = isMobile ? 360 : 940;
            const svgH = isMobile ? 225 : 295;
            const plotTop = isMobile ? 16 : 30;
            const plotBottom = isMobile ? 190 : 235;
            const plotH = plotBottom - plotTop;

            if (chartType === 'TIME_SERIES') {
              const plotLeft = isMobile ? 36 : 64;
              const plotRight = isMobile ? (secondaryDef ? 324 : 350) : 860;
              const plotW = plotRight - plotLeft;
              return (
                <svg
                  viewBox={`0 0 ${svgW} ${svgH}`}
                  className={isMobile ? 'w-full h-auto' : 'w-full h-80'}
                >
                  {(() => {
                    const len = Math.max(1, dailyJoinedPoints.length);
                    const v1Vals = dailyJoinedPoints
                      .map((p) => p.val1)
                      .filter((v): v is number => v !== null);
                    const v2Vals = dailyJoinedPoints
                      .map((p) => p.val2)
                      .filter((v): v is number => v !== null);

                    const min1 = v1Vals.length > 0 ? Math.min(...v1Vals) * 0.9 : 0;
                    const max1 = v1Vals.length > 0 ? Math.max(...v1Vals) * 1.05 || 100 : 100;
                    const span1 = Math.max(1, max1 - min1);

                    const min2 = v2Vals.length > 0 ? Math.min(...v2Vals) * 0.9 : 0;
                    const max2 = v2Vals.length > 0 ? Math.max(...v2Vals) * 1.05 || 100 : 100;
                    const span2 = Math.max(1, max2 - min2);

                    const toY1 = (v: number) => plotBottom - ((v - min1) / span1) * plotH;
                    const toY2 = (v: number) => plotBottom - ((v - min2) / span2) * plotH;

                    const line1Pts = dailyJoinedPoints
                      .map((p, i) => {
                        if (p.val1 === null) return null;
                        const x = plotLeft + (i / Math.max(1, len - 1)) * plotW;
                        return `${x},${Math.max(plotTop, Math.min(plotBottom, toY1(p.val1)))}`;
                      })
                      .filter(Boolean)
                      .join(' ');

                    const line2Pts = secondaryDef
                      ? dailyJoinedPoints
                          .map((p, i) => {
                            if (p.val2 === null) return null;
                            const x = plotLeft + (i / Math.max(1, len - 1)) * plotW;
                            return `${x},${Math.max(plotTop, Math.min(plotBottom, toY2(p.val2)))}`;
                          })
                          .filter(Boolean)
                          .join(' ')
                      : '';

                    return (
                      <>
                        {/* Left Y-Axis Title */}
                        {!isMobile && (
                          <text
                            x={15}
                            y={128}
                            transform="rotate(-90 15 128)"
                            textAnchor="middle"
                            fill={primaryDef.color}
                            className="text-2xs font-sans font-bold"
                          >
                            {primaryDef.label} ({primaryDef.unit})
                          </text>
                        )}

                        {/* Right Y-Axis Title */}
                        {!isMobile && secondaryDef && (
                          <text
                            x={926}
                            y={128}
                            transform="rotate(90 926 128)"
                            textAnchor="middle"
                            fill={secondaryDef.color}
                            className="text-2xs font-sans font-bold"
                          >
                            {secondaryDef.label} ({secondaryDef.unit})
                          </text>
                        )}

                        {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                          const y = plotBottom - f * plotH;
                          const valLeft = (min1 + f * span1).toFixed(span1 < 10 ? 1 : 0);
                          const valRight = (min2 + f * span2).toFixed(span2 < 10 ? 1 : 0);
                          return (
                            <g key={idx}>
                              <line
                                x1={plotLeft}
                                y1={y}
                                x2={plotRight}
                                y2={y}
                                stroke="currentColor"
                                className="text-slate-200 dark:text-slate-800"
                                strokeDasharray="3 3"
                              />
                              <text
                                x={plotLeft - 6}
                                y={y + 4}
                                textAnchor="end"
                                fill={primaryDef.color}
                                className="text-2xs font-mono font-semibold"
                              >
                                {valLeft}
                              </text>
                              {secondaryDef && (
                                <text
                                  x={plotRight + 6}
                                  y={y + 4}
                                  fill={secondaryDef.color}
                                  className="text-2xs font-mono font-semibold"
                                >
                                  {valRight}
                                </text>
                              )}
                            </g>
                          );
                        })}

                        {/* Primary Series */}
                        {primaryDef.aggMode === 'SUM' && aggregation !== 'DAILY' ? (
                          dailyJoinedPoints.map((p, i) => {
                            if (p.val1 === null) return null;
                            const x = plotLeft + (i / Math.max(1, len - 1)) * plotW;
                            const y = Math.max(plotTop, Math.min(plotBottom, toY1(p.val1)));
                            const barW = Math.max(4, Math.min(20, (plotW * 0.75) / len));
                            return (
                              <rect
                                key={i}
                                x={x - barW / 2}
                                y={y}
                                width={barW}
                                height={plotBottom - y}
                                fill={primaryDef.color}
                                opacity={0.7}
                                rx={2}
                              />
                            );
                          })
                        ) : (
                          <polyline
                            fill="none"
                            stroke={primaryDef.color}
                            strokeWidth="2.5"
                            points={line1Pts}
                          />
                        )}

                        {/* Secondary Series */}
                        {secondaryDef && line2Pts && (
                          <polyline
                            fill="none"
                            stroke={secondaryDef.color}
                            strokeWidth="2.25"
                            points={line2Pts}
                          />
                        )}

                        {/* X-Axis Date Ticks & Title */}
                        {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                          const ptIdx = Math.min(len - 1, Math.floor(f * (len - 1)));
                          const pt = dailyJoinedPoints[ptIdx];
                          if (!pt) return null;
                          const x = plotLeft + f * plotW;
                          return (
                            <text
                              key={idx}
                              x={x}
                              y={plotBottom + (isMobile ? 16 : 23)}
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
                          className="fill-slate-600 dark:fill-slate-300 text-2xs sm:text-xs font-sans font-bold"
                        >
                          Time Period ({aggregation} · {startBound} to {endBound})
                        </text>

                        {/* Hover Columns */}
                        {dailyJoinedPoints.map((_, i) => {
                          const x = plotLeft + (i / Math.max(1, len - 1)) * plotW;
                          const colW = plotW / len;
                          return (
                            <g key={i}>
                              {hoverIdx === i && (
                                <line
                                  x1={x}
                                  y1={plotTop}
                                  x2={x}
                                  y2={plotBottom}
                                  stroke="#3B82F6"
                                  strokeWidth="1.5"
                                  strokeDasharray="3 2"
                                />
                              )}
                              <rect
                                x={x - colW / 2}
                                y={0}
                                width={colW}
                                height={plotBottom + 20}
                                fill="transparent"
                                className="cursor-crosshair"
                                onMouseEnter={() => setHoverIdx(i)}
                                onMouseMove={() => setHoverIdx(i)}
                              />
                            </g>
                          );
                        })}
                      </>
                    );
                  })()}
                </svg>
              );
            }

            /* SCATTER / CORRELATION PLOTTER */
            const plotLeft = isMobile ? 36 : 68;
            const plotRight = isMobile ? 350 : 878;
            const plotW = plotRight - plotLeft;
            return (
              <svg
                viewBox={`0 0 ${svgW} ${svgH}`}
                className={isMobile ? 'w-full h-auto' : 'w-full h-80'}
              >
                {(() => {
                  const { pairs, slope, intercept } = regressionStats;
                  if (pairs.length === 0) {
                    return (
                      <text
                        x={svgW / 2}
                        y={svgH / 2}
                        textAnchor="middle"
                        className="fill-slate-400 text-xs sm:text-sm font-sans"
                      >
                        No overlapping data points for these two metrics in the selected date window.
                      </text>
                    );
                  }

                  const xs = pairs.map((p) => p.val1);
                  const ys = pairs.map((p) => p.val2);
                  const minX = Math.min(...xs) * 0.95;
                  const maxX = Math.max(...xs) * 1.05 || 100;
                  const spanX = Math.max(1, maxX - minX);

                  const minY = Math.min(...ys) * 0.95;
                  const maxY = Math.max(...ys) * 1.05 || 100;
                  const spanY = Math.max(1, maxY - minY);

                  const toX = (x: number) => plotLeft + ((x - minX) / spanX) * plotW;
                  const toY = (y: number) => plotBottom - ((y - minY) / spanY) * plotH;

                  const regY1 = slope * minX + intercept;
                  const regY2 = slope * maxX + intercept;

                  return (
                    <>
                      {/* Left Y-Axis Title */}
                      {!isMobile && (
                        <text
                          x={16}
                          y={135}
                          transform="rotate(-90 16 135)"
                          textAnchor="middle"
                          fill={secondaryDef?.color || '#3B82F6'}
                          className="text-2xs font-sans font-bold"
                        >
                          {secondaryDef?.label || 'Y Metric'} ({secondaryDef?.unit || ''})
                        </text>
                      )}

                      {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                        const y = plotBottom - f * plotH;
                        const x = plotLeft + f * plotW;
                        return (
                          <g key={idx}>
                            <line
                              x1={plotLeft}
                              y1={y}
                              x2={plotRight}
                              y2={y}
                              stroke="currentColor"
                              className="text-slate-200 dark:text-slate-800"
                              strokeDasharray="3 3"
                            />
                            <text
                              x={plotLeft - 6}
                              y={y + 4}
                              textAnchor="end"
                              className="fill-slate-500 dark:fill-slate-400 text-2xs font-mono"
                            >
                              {(minY + f * spanY).toFixed(spanY < 10 ? 1 : 0)}
                            </text>
                            <text
                              x={x}
                              y={plotBottom + (isMobile ? 16 : 21)}
                              textAnchor="middle"
                              className="fill-slate-500 dark:fill-slate-400 text-2xs font-mono"
                            >
                              {(minX + f * spanX).toFixed(spanX < 10 ? 1 : 0)}
                            </text>
                          </g>
                        );
                      })}

                      {/* X-Axis Title */}
                      <text
                        x={plotLeft + plotW / 2}
                        y={svgH - 6}
                        textAnchor="middle"
                        fill={primaryDef.color}
                        className="text-2xs sm:text-xs font-sans font-bold"
                      >
                        {primaryDef.label} ({primaryDef.unit})
                      </text>

                      {/* Linear Regression Trendline */}
                      <line
                        x1={toX(minX)}
                        y1={Math.max(plotTop, Math.min(plotBottom, toY(regY1)))}
                        x2={toX(maxX)}
                        y2={Math.max(plotTop, Math.min(plotBottom, toY(regY2)))}
                        stroke="#10B981"
                        strokeWidth="2.25"
                        strokeDasharray="6 4"
                      />

                    {/* Scatter Dots */}
                    {pairs.map((p, idx) => (
                      <circle
                        key={idx}
                        cx={toX(p.val1)}
                        cy={toY(p.val2)}
                        r={5}
                        fill={p.environment === 'INDOOR' ? '#6366F1' : '#3B82F6'}
                        opacity={0.8}
                      >
                        <title>
                          {p.date} ({p.label}): {primaryDef.label}={p.val1} {primaryDef.unit},{' '}
                          {secondaryDef?.label}={p.val2} {secondaryDef?.unit}
                        </title>
                      </circle>
                    ))}
                  </>
                );
              })()}
            </svg>
            );
          })()}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="text-xs text-slate-500">
            Showing {dailyJoinedPoints.length} data points across {startBound} to {endBound} (Sport: {sportFilter} · Env: {environmentFilter})
          </div>
          <button
            onClick={() =>
              onOpenCoachWithPrompt(
                `Analyze the relationship between ${primaryDef.label} (${primaryDef.unit}) and ${secondaryDef?.label || 'training load'} over ${startBound} to ${endBound} (Pearson r = ${regressionStats.r}). What actionable training takeaways do you see?`
              )
            }
            className="min-h-[38px] px-4 py-1.5 rounded-lg bg-[#1C5436] hover:bg-[#16422A] dark:bg-[#C8FF00] dark:hover:bg-[#B5EB00] text-white dark:text-[#080A09] text-sm font-semibold transition-colors"
          >
            Ask AI Coach to Interpret This Chart
          </button>
        </div>
      </section>
    </div>
  );
};
