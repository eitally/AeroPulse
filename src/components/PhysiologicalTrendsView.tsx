import React, { useMemo, useState } from 'react';
import { Bot, HeartPulse, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { UnifiedActivity, UnifiedWellnessDay } from '../types';

interface PhysiologicalTrendsViewProps {
  wellnessDays: UnifiedWellnessDay[];
  activities: UnifiedActivity[];
  athleteWeightKg: number;
  onOpenCoachWithPrompt: (prompt: string) => void;
}

type TimeRangePreset = '90D' | '6M' | '1Y' | '2Y' | '5Y' | 'ALL';
type SmoothingWindow = 14 | 28 | 60;
type CorrelationPair = 'RHR_VS_HRV' | 'CTL_VS_VO2' | 'HRV_CV_VS_EF';

interface EnrichedPhysioDay {
  date: string;
  vo2Max: number;
  vo2Trend: number;
  vo2Changed: boolean;
  eftpWkg?: number;
  restingHR: number;
  rhrTrend: number;
  rhrBaseline60Low: number;
  rhrBaseline60High: number;
  hrvRMSSD: number;
  hrvTrend: number;
  hrvBandLow: number;
  hrvBandHigh: number;
  hrvStatus: 'Balanced' | 'Unbalanced' | 'Low';
  hrvCv7d: number; // 7-day Coefficient of Variation (%) = (SD / Mean) * 100
  ctl: number;
  tsb: number;
  sleepScore: number;
}

// Compute ordinary least squares (OLS) linear regression: y = slope * x + intercept, plus Pearson r
function computeLinearRegression(points: { x: number; y: number }[]) {
  const n = points.length;
  if (n < 2) {
    return { slope: 0, intercept: points[0]?.y || 0, r: 0 };
  }
  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let num = 0;
  let denX = 0;
  let denY = 0;
  for (const p of points) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const slope = denX > 0 ? num / denX : 0;
  const intercept = meanY - slope * meanX;
  const r = denX > 0 && denY > 0 ? num / Math.sqrt(denX * denY) : 0;
  return { slope, intercept, r };
}

export const PhysiologicalTrendsView: React.FC<PhysiologicalTrendsViewProps> = ({
  wellnessDays,
  activities,
  athleteWeightKg,
  onOpenCoachWithPrompt,
}) => {
  const [timeRange, setTimeRange] = useState<TimeRangePreset>('2Y');
  const [smoothingDays, setSmoothingDays] = useState<SmoothingWindow>(28);
  const [showRegressionLine, setShowRegressionLine] = useState<boolean>(true);
  const [showEftpOverlay, setShowEftpOverlay] = useState<boolean>(true);
  const [correlationPair, setCorrelationPair] = useState<CorrelationPair>('RHR_VS_HRV');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Enrich all-time wellness days with rolling trends, 60d RHR baseline corridor, and 7d HRV Stability CV%
  const allEnrichedDays = useMemo<EnrichedPhysioDay[]>(() => {
    if (wellnessDays.length === 0) return [];

    const sorted = [...wellnessDays].sort((a, b) => a.date.localeCompare(b.date));
    let prevVo2 = -1;

    return sorted.map((w, idx, arr) => {
      const vo2 = w.vo2MaxCycling || w.vo2MaxRunning || 0;
      const vo2Changed = idx === 0 || (vo2 > 0 && vo2 !== prevVo2);
      if (vo2 > 0) prevVo2 = vo2;

      const winStart = Math.max(0, idx - smoothingDays + 1);
      const winSlice = arr.slice(winStart, idx + 1);

      // Rolling VO2max trend
      const vo2Vals = winSlice
        .map((d) => d.vo2MaxCycling || d.vo2MaxRunning || 0)
        .filter((v) => v > 0);
      const vo2Trend =
        vo2Vals.length > 0
          ? Number((vo2Vals.reduce((a, b) => a + b, 0) / vo2Vals.length).toFixed(2))
          : vo2;

      // Rolling RHR trend & 60-day baseline band
      const rhrVals = winSlice.map((d) => d.restingHR).filter((v) => v > 0);
      const rhrTrend =
        rhrVals.length > 0
          ? Number((rhrVals.reduce((a, b) => a + b, 0) / rhrVals.length).toFixed(1))
          : w.restingHR;

      const rhr60Slice = arr
        .slice(Math.max(0, idx - 59), idx + 1)
        .map((d) => d.restingHR)
        .filter((v) => v > 0);
      const rhrMean60 =
        rhr60Slice.length > 0
          ? rhr60Slice.reduce((a, b) => a + b, 0) / rhr60Slice.length
          : w.restingHR || 48;
      const rhrVar60 =
        rhr60Slice.length > 1
          ? rhr60Slice.reduce((acc, v) => acc + Math.pow(v - rhrMean60, 2), 0) /
            rhr60Slice.length
          : 4;
      const rhrSd60 = Math.max(1.5, Math.sqrt(rhrVar60));

      // Rolling HRV trend & 7-day HRV Coefficient of Variation (CV% = SD / Mean * 100)
      const hrvVals = winSlice.map((d) => d.hrvRMSSD).filter((v) => v > 0);
      const hrvTrend =
        hrvVals.length > 0
          ? Number((hrvVals.reduce((a, b) => a + b, 0) / hrvVals.length).toFixed(1))
          : w.hrvBaseline7d || w.hrvRMSSD;

      const hrv7Slice = arr
        .slice(Math.max(0, idx - 6), idx + 1)
        .map((d) => d.hrvRMSSD)
        .filter((v) => v > 0);
      let hrvCv7d = 0;
      if (hrv7Slice.length >= 3) {
        const mean7 = hrv7Slice.reduce((a, b) => a + b, 0) / hrv7Slice.length;
        const variance7 =
          hrv7Slice.reduce((acc, v) => acc + Math.pow(v - mean7, 2), 0) / hrv7Slice.length;
        const sd7 = Math.sqrt(variance7);
        hrvCv7d = mean7 > 0 ? Number(((sd7 / mean7) * 100).toFixed(1)) : 0;
      }

      const weight = w.weightKg > 35 ? w.weightKg : athleteWeightKg || 72;
      const bestEftp = Math.max(w.rideEftp || 0, w.runEftp || 0);
      const eftpWkg = bestEftp > 0 ? Number((bestEftp / weight).toFixed(2)) : undefined;

      return {
        date: w.date,
        vo2Max: vo2,
        vo2Trend,
        vo2Changed,
        eftpWkg,
        restingHR: w.restingHR,
        rhrTrend,
        rhrBaseline60Low: Number((rhrMean60 - rhrSd60).toFixed(1)),
        rhrBaseline60High: Number((rhrMean60 + rhrSd60).toFixed(1)),
        hrvRMSSD: w.hrvRMSSD,
        hrvTrend,
        hrvBandLow: w.hrvNormalBandLow || 42,
        hrvBandHigh: w.hrvNormalBandHigh || 62,
        hrvStatus: w.hrvStatus || 'Balanced',
        hrvCv7d,
        ctl: w.ctl,
        tsb: w.tsb,
        sleepScore: w.sleepScore,
      };
    });
  }, [wellnessDays, smoothingDays, athleteWeightKg]);

  // Filter by selected time horizon
  const filteredDays = useMemo(() => {
    if (allEnrichedDays.length === 0) return [];
    if (timeRange === 'ALL') return allEnrichedDays;

    const daysCountMap: Record<Exclude<TimeRangePreset, 'ALL'>, number> = {
      '90D': 90,
      '6M': 180,
      '1Y': 365,
      '2Y': 730,
      '5Y': 1825,
    };
    const count = daysCountMap[timeRange];
    return allEnrichedDays.slice(-count);
  }, [allEnrichedDays, timeRange]);

  // Downsample to at most ~240 points for crisp SVG scatter-trend rendering while keeping all VO2 change points & recent days
  const chartDays = useMemo(() => {
    if (filteredDays.length <= 240) return filteredDays;
    const step = Math.ceil(filteredDays.length / 220);
    return filteredDays.filter(
      (d, idx) => idx % step === 0 || d.vo2Changed || idx === filteredDays.length - 1
    );
  }, [filteredDays]);

  // Summary statistics & OLS linear regression slopes over the selected window
  const windowStats = useMemo(() => {
    const validVo2 = filteredDays.filter((d) => d.vo2Max > 0);
    const validRhr = filteredDays.filter((d) => d.restingHR > 0);
    const validHrv = filteredDays.filter((d) => d.hrvRMSSD > 0);
    const validCv = filteredDays.filter((d) => d.hrvCv7d > 0);

    const currentVo2 = validVo2[validVo2.length - 1]?.vo2Max || 0;
    const peakVo2Obj = validVo2.reduce(
      (best, d) => (d.vo2Max > best.val ? { val: d.vo2Max, date: d.date } : best),
      { val: 0, date: '' }
    );
    const startVo2 = validVo2[0]?.vo2Max || currentVo2;
    const vo2Delta = Number((currentVo2 - startVo2).toFixed(1));

    const currentRhr = validRhr[validRhr.length - 1]?.restingHR || 0;
    const currentRhrTrend = validRhr[validRhr.length - 1]?.rhrTrend || currentRhr;
    const minRhrObj = validRhr.reduce(
      (best, d) => (d.restingHR < best.val ? { val: d.restingHR, date: d.date } : best),
      { val: 999, date: '' }
    );
    const startRhrTrend = validRhr[0]?.rhrTrend || currentRhrTrend;
    const rhrDelta = Number((currentRhrTrend - startRhrTrend).toFixed(1));

    const currentHrv = validHrv[validHrv.length - 1]?.hrvRMSSD || 0;
    const currentHrvTrend = validHrv[validHrv.length - 1]?.hrvTrend || currentHrv;
    const currentHrvCv = validCv[validCv.length - 1]?.hrvCv7d || 0;
    const avgHrvCv =
      validCv.length > 0
        ? Number((validCv.reduce((acc, d) => acc + d.hrvCv7d, 0) / validCv.length).toFixed(1))
        : 0;
    const balancedDaysPct =
      validHrv.length > 0
        ? Math.round(
            (validHrv.filter((d) => d.hrvStatus === 'Balanced').length / validHrv.length) * 100
          )
        : 0;

    // Linear regression on chartDays indices
    const vo2Reg = computeLinearRegression(
      chartDays
        .map((d, idx) => ({ x: idx, y: d.vo2Max }))
        .filter((p) => p.y > 0)
    );
    const rhrReg = computeLinearRegression(
      chartDays
        .map((d, idx) => ({ x: idx, y: d.restingHR }))
        .filter((p) => p.y > 0)
    );
    const hrvReg = computeLinearRegression(
      chartDays
        .map((d, idx) => ({ x: idx, y: d.hrvRMSSD }))
        .filter((p) => p.y > 0)
    );

    return {
      currentVo2,
      peakVo2: peakVo2Obj.val,
      peakVo2Date: peakVo2Obj.date,
      vo2Delta,
      currentRhr,
      currentRhrTrend,
      minRhr: minRhrObj.val < 999 ? minRhrObj.val : 0,
      minRhrDate: minRhrObj.date,
      rhrDelta,
      currentHrv,
      currentHrvTrend,
      currentHrvCv,
      avgHrvCv,
      balancedDaysPct,
      vo2Reg,
      rhrReg,
      hrvReg,
    };
  }, [filteredDays, chartDays]);

  // Season-by-Season (Annual) Physiological Progression Table
  const annualSummaryRows = useMemo(() => {
    const byYear = new Map<string, EnrichedPhysioDay[]>();
    for (const d of allEnrichedDays) {
      const y = d.date.slice(0, 4);
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y)!.push(d);
    }

    return Array.from(byYear.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([year, days]) => {
        const vo2s = days.map((d) => d.vo2Max).filter((v) => v > 0);
        const rhrs = days.map((d) => d.restingHR).filter((v) => v > 0);
        const hrvs = days.map((d) => d.hrvRMSSD).filter((v) => v > 0);
        const cvs = days.map((d) => d.hrvCv7d).filter((v) => v > 0);
        const eftps = days
          .map((d) => d.eftpWkg)
          .filter((v): v is number => v !== undefined && v > 0);

        const avgVo2 =
          vo2s.length > 0 ? (vo2s.reduce((a, b) => a + b, 0) / vo2s.length).toFixed(1) : '—';
        const maxVo2 = vo2s.length > 0 ? Math.max(...vo2s) : '—';
        const avgRhr =
          rhrs.length > 0 ? (rhrs.reduce((a, b) => a + b, 0) / rhrs.length).toFixed(1) : '—';
        const minRhr = rhrs.length > 0 ? Math.min(...rhrs) : '—';
        const avgHrv =
          hrvs.length > 0 ? Math.round(hrvs.reduce((a, b) => a + b, 0) / hrvs.length) : '—';
        const avgCv =
          cvs.length > 0 ? `${(cvs.reduce((a, b) => a + b, 0) / cvs.length).toFixed(1)}%` : '—';
        const peakWkg = eftps.length > 0 ? `${Math.max(...eftps).toFixed(2)} W/kg` : '—';

        return {
          year,
          daysCount: days.length,
          avgVo2,
          maxVo2,
          avgRhr,
          minRhr,
          avgHrv,
          avgCv,
          peakWkg,
        };
      });
  }, [allEnrichedDays]);

  // Cross-Metric Scatter Correlation Data
  const correlationScatterData = useMemo(() => {
    if (correlationPair === 'RHR_VS_HRV') {
      const pts = filteredDays
        .filter((d) => d.restingHR > 0 && d.hrvRMSSD > 0)
        .slice(-220)
        .map((d) => ({
          date: d.date,
          x: d.restingHR,
          y: d.hrvRMSSD,
          status: d.hrvStatus,
        }));
      return {
        title: 'Autonomic Coupling: Morning Resting HR vs. Overnight HRV rMSSD',
        xLabel: 'Resting Heart Rate (bpm)',
        yLabel: 'Overnight HRV rMSSD (ms)',
        points: pts,
        reg: computeLinearRegression(pts),
      };
    }

    if (correlationPair === 'CTL_VS_VO2') {
      const pts = filteredDays
        .filter((d) => d.ctl > 5 && d.vo2Max > 0)
        .slice(-220)
        .map((d) => ({
          date: d.date,
          x: d.ctl,
          y: d.vo2Max,
          status: d.hrvStatus,
        }));
      return {
        title: 'Aerobic Dose-Response: Chronic Training Load (CTL) vs. Garmin VO2max',
        xLabel: 'Chronic Training Load — CTL (TSS/day)',
        yLabel: 'VO2max (mL/kg/min)',
        points: pts,
        reg: computeLinearRegression(pts),
      };
    }

    // HRV_CV_VS_EF: Match workout Efficiency Factor (EF) with that day's 7d HRV Stability CV%
    const byDate = new Map<string, EnrichedPhysioDay>();
    for (const d of filteredDays) {
      if (d.hrvCv7d > 0) byDate.set(d.date, d);
    }
    const pts = activities
      .filter((a) => a.efficiencyFactor > 0.8 && byDate.has(a.startDateLocal.slice(0, 10)))
      .slice(0, 200)
      .map((a) => {
        const wDay = byDate.get(a.startDateLocal.slice(0, 10))!;
        return {
          date: wDay.date,
          x: wDay.hrvCv7d,
          y: a.efficiencyFactor,
          status: wDay.hrvStatus,
        };
      });

    return {
      title: 'HRV Stability (7d CV%) vs. Workout Aerobic Efficiency Factor (EF)',
      xLabel: '7-Day HRV Coefficient of Variation — CV (%) [Lower = More Stable]',
      yLabel: 'Workout Efficiency Factor (EF = NP/HR)',
      points: pts,
      reg: computeLinearRegression(pts),
    };
  }, [correlationPair, filteredDays, activities]);

  const activeHoverDay =
    hoverIndex !== null && chartDays[hoverIndex]
      ? chartDays[hoverIndex]
      : chartDays[chartDays.length - 1];

  return (
    <div className="space-y-6">
      {/* Header & Global Controls */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Physiological Trends — Long-Term VO2max, Resting HR &amp; HRV Stability
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Multi-year scatter-trend analysis across {allEnrichedDays.length.toLocaleString()} Garmin &amp; Intervals.icu wellness records ({allEnrichedDays[0]?.date || '2018'} to {allEnrichedDays[allEnrichedDays.length - 1]?.date || '2026'})
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Time Range Selector */}
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-mono">
              {(['90D', '6M', '1Y', '2Y', '5Y', 'ALL'] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setTimeRange(preset);
                    setHoverIndex(null);
                  }}
                  className={`min-h-[30px] px-2.5 py-1 rounded-md font-semibold transition-colors ${
                    timeRange === preset
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>

            {/* Smoothing Window Selector */}
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
              {([14, 28, 60] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setSmoothingDays(w)}
                  className={`min-h-[30px] px-2.5 py-1 rounded-md font-semibold transition-colors ${
                    smoothingDays === w
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {w}d Smooth
                </button>
              ))}
            </div>

            {/* Linear Regression Overlay Toggle */}
            <button
              type="button"
              onClick={() => setShowRegressionLine((prev) => !prev)}
              className={`min-h-[34px] px-3 py-1 rounded-lg border text-xs font-semibold transition-colors ${
                showRegressionLine
                  ? 'border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  : 'border-slate-300 dark:border-slate-700 text-slate-500'
              }`}
            >
              OLS Regression Line
            </button>

            <button
              type="button"
              onClick={() =>
                onOpenCoachWithPrompt(
                  `Analyze my long-term physiological trends over the ${timeRange} window: Garmin VO2max is ${windowStats.currentVo2} mL/kg/min (peak ${windowStats.peakVo2}, delta ${windowStats.vo2Delta >= 0 ? '+' : ''}${windowStats.vo2Delta}), Resting HR 28d trend is ${windowStats.currentRhrTrend} bpm (all-time min ${windowStats.minRhr} bpm), and Overnight HRV trend is ${windowStats.currentHrvTrend} ms with a 7-day HRV Stability CV of ${windowStats.currentHrvCv}% (${windowStats.balancedDaysPct}% balanced days). What does this say about my long-term aerobic adaptation and autonomic recovery?`
                )
              }
              className="min-h-[34px] inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
            >
              <Bot className="w-3.5 h-3.5" />
              <span>Ask AI Physiologist</span>
            </button>
          </div>
        </div>

        {/* Top KPI Summary Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
          {/* Card 1: VO2max */}
          <div className="rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-semibold">Aerobic Ceiling (VO2max)</span>
              <span
                className={`inline-flex items-center gap-0.5 font-mono font-bold ${
                  windowStats.vo2Delta >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {windowStats.vo2Delta >= 0 ? (
                  <TrendingUp className="w-3.5 h-3.5" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5" />
                )}
                {windowStats.vo2Delta >= 0 ? `+${windowStats.vo2Delta}` : windowStats.vo2Delta} mL/kg
              </span>
            </div>
            <div className="text-2xl font-extrabold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {windowStats.currentVo2 || '—'}{' '}
              <span className="text-xs font-normal text-slate-500">mL/kg/min</span>
            </div>
            <div className="text-xs font-mono text-slate-500">
              Peak: <strong>{windowStats.peakVo2}</strong> ({windowStats.peakVo2Date || 'All-Time'})
            </div>
          </div>

          {/* Card 2: Resting Heart Rate */}
          <div className="rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-semibold">Resting Heart Rate (RHR)</span>
              <span
                className={`inline-flex items-center gap-0.5 font-mono font-bold ${
                  windowStats.rhrDelta <= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {windowStats.rhrDelta > 0 ? `+${windowStats.rhrDelta}` : windowStats.rhrDelta} bpm
              </span>
            </div>
            <div className="text-2xl font-extrabold font-mono tabular-nums text-rose-600 dark:text-rose-400">
              {windowStats.currentRhr || '—'}{' '}
              <span className="text-xs font-normal text-slate-500">
                bpm ({smoothingDays}d avg: {windowStats.currentRhrTrend})
              </span>
            </div>
            <div className="text-xs font-mono text-slate-500">
              Window Low: <strong>{windowStats.minRhr} bpm</strong> ({windowStats.minRhrDate || '—'})
            </div>
          </div>

          {/* Card 3: Overnight HRV rMSSD */}
          <div className="rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-semibold">Overnight HRV (rMSSD)</span>
              <span className="font-mono font-bold text-purple-600 dark:text-purple-400">
                {windowStats.balancedDaysPct}% Balanced
              </span>
            </div>
            <div className="text-2xl font-extrabold font-mono tabular-nums text-purple-600 dark:text-purple-400">
              {windowStats.currentHrv || '—'}{' '}
              <span className="text-xs font-normal text-slate-500">
                ms ({smoothingDays}d avg: {windowStats.currentHrvTrend} ms)
              </span>
            </div>
            <div className="text-xs font-mono text-slate-500">
              60d Corridor:{' '}
              <strong>
                {activeHoverDay?.hrvBandLow || 42}–{activeHoverDay?.hrvBandHigh || 62} ms
              </strong>
            </div>
          </div>

          {/* Card 4: HRV Stability (7d Coefficient of Variation CV%) */}
          <div className="rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-semibold">HRV Stability (7d CV%)</span>
              <span
                className={`font-mono font-bold ${
                  windowStats.currentHrvCv <= 13
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : windowStats.currentHrvCv <= 18
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {windowStats.currentHrvCv <= 13
                  ? 'High Stability'
                  : windowStats.currentHrvCv <= 18
                    ? 'Moderate'
                    : 'Volatile'}
              </span>
            </div>
            <div className="text-2xl font-extrabold font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
              {windowStats.currentHrvCv ? `${windowStats.currentHrvCv}%` : '—'}{' '}
              <span className="text-xs font-normal text-slate-500">
                (Window Avg: {windowStats.avgHrvCv}%)
              </span>
            </div>
            <div className="text-xs font-mono text-slate-500">
              Lower CV% (&lt;13%) = stable autonomic recovery
            </div>
          </div>
        </div>
      </section>

      {/* ==========================================================================
          CHART 1: LONG-TERM VO2MAX & AEROBIC CEILING SCATTER-TREND CHART
         ========================================================================== */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              01. Long-Term VO2max &amp; Relative Threshold Power (W/kg) Scatter-Trend
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Daily Garmin VO2max observations (scatter dots), {smoothingDays}-day smoothed trajectory (emerald line), and OLS linear regression trend
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setShowEftpOverlay((prev) => !prev)}
              className={`min-h-[30px] px-2.5 py-1 rounded-md border text-xs font-mono font-semibold transition-colors ${
                showEftpOverlay
                  ? 'border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  : 'border-slate-300 dark:border-slate-700 text-slate-500'
              }`}
            >
              {showEftpOverlay ? 'Showing eFTP (W/kg) Scatter' : 'Show eFTP (W/kg) Scatter'}
            </button>

            {activeHoverDay && (
              <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5">
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  {activeHoverDay.date}
                </span>
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                  VO2max: {activeHoverDay.vo2Max || '—'} mL/kg/min
                </span>
                <span className="text-teal-600 dark:text-teal-400">
                  {smoothingDays}d Trend: {activeHoverDay.vo2Trend}
                </span>
                {activeHoverDay.eftpWkg && (
                  <span className="text-blue-600 dark:text-blue-400 font-bold">
                    eFTP: {activeHoverDay.eftpWkg} W/kg
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <svg
          viewBox="0 0 880 230"
          className="w-full h-56 select-none"
          onMouseLeave={() => setHoverIndex(null)}
        >
          {(() => {
            if (chartDays.length === 0) return null;
            const len = chartDays.length;
            const chartLeft = 64;
            const chartRight = 816;
            const chartW = chartRight - chartLeft;
            const chartTop = 18;
            const chartBottom = 176;
            const chartH = chartBottom - chartTop;

            const vo2Vals = chartDays.map((d) => d.vo2Max).filter((v) => v > 0);
            const minVo2 = vo2Vals.length > 0 ? Math.max(35, Math.min(...vo2Vals) - 2) : 45;
            const maxVo2 = vo2Vals.length > 0 ? Math.min(75, Math.max(...vo2Vals) + 2) : 62;
            const vo2Span = Math.max(6, maxVo2 - minVo2);

            const wkgVals = chartDays
              .map((d) => d.eftpWkg)
              .filter((v): v is number => v !== undefined && v > 0);
            const minWkg = wkgVals.length > 0 ? Math.max(2.0, Math.min(...wkgVals) - 0.3) : 3.2;
            const maxWkg = wkgVals.length > 0 ? Math.min(6.5, Math.max(...wkgVals) + 0.3) : 5.0;
            const wkgSpan = Math.max(0.8, maxWkg - minWkg);

            const trendPoints = chartDays
              .filter((d) => d.vo2Trend > 0)
              .map((d) => {
                const idx = chartDays.indexOf(d);
                const x = chartLeft + (idx / Math.max(1, len - 1)) * chartW;
                const y = chartBottom - ((d.vo2Trend - minVo2) / vo2Span) * chartH;
                return `${x},${Math.max(chartTop, Math.min(chartBottom, y))}`;
              })
              .join(' ');

            const regYStart =
              chartBottom -
              ((windowStats.vo2Reg.intercept - minVo2) / vo2Span) * chartH;
            const regYEnd =
              chartBottom -
              ((windowStats.vo2Reg.slope * (len - 1) + windowStats.vo2Reg.intercept - minVo2) /
                vo2Span) *
                chartH;

            return (
              <>
                {/* Left Y-Axis Title */}
                <text
                  x={16}
                  y={96}
                  transform="rotate(-90 16 96)"
                  textAnchor="middle"
                  className="fill-emerald-500 text-xs font-sans font-bold"
                >
                  VO2max (mL/kg/min)
                </text>

                {/* Right Y-Axis Title */}
                {showEftpOverlay && (
                  <text
                    x={866}
                    y={96}
                    transform="rotate(90 866 96)"
                    textAnchor="middle"
                    className="fill-blue-500 text-xs font-sans font-bold"
                  >
                    Relative eFTP (W/kg)
                  </text>
                )}

                {/* Horizontal Grid Lines & Y-Axis Ticks */}
                {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                  const y = chartBottom - f * chartH;
                  const vVal = (minVo2 + f * vo2Span).toFixed(1);
                  const wVal = (minWkg + f * wkgSpan).toFixed(2);
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
                        className="fill-emerald-600 dark:fill-emerald-400 text-[11px] font-mono"
                      >
                        {vVal}
                      </text>
                      {showEftpOverlay && (
                        <text
                          x={chartRight + 8}
                          y={y + 4}
                          textAnchor="start"
                          className="fill-blue-500 text-[11px] font-mono"
                        >
                          {wVal}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Optional eFTP (W/kg) Scatter Dots */}
                {showEftpOverlay &&
                  chartDays.map((d, idx) => {
                    if (!d.eftpWkg) return null;
                    const x = chartLeft + (idx / Math.max(1, len - 1)) * chartW;
                    const y = chartBottom - ((d.eftpWkg - minWkg) / wkgSpan) * chartH;
                    return (
                      <circle
                        key={`wkg-${idx}`}
                        cx={x}
                        cy={Math.max(chartTop, Math.min(chartBottom, y))}
                        r={2.3}
                        fill="#3B82F6"
                        fillOpacity={0.45}
                      />
                    );
                  })}

                {/* VO2max Scatter Dots */}
                {chartDays.map((d, idx) => {
                  if (d.vo2Max <= 0) return null;
                  const x = chartLeft + (idx / Math.max(1, len - 1)) * chartW;
                  const y = chartBottom - ((d.vo2Max - minVo2) / vo2Span) * chartH;
                  return (
                    <circle
                      key={`vo2-${idx}`}
                      cx={x}
                      cy={Math.max(chartTop, Math.min(chartBottom, y))}
                      r={d.vo2Changed ? 4 : 2.8}
                      fill="#10B981"
                      fillOpacity={d.vo2Changed ? 0.95 : 0.55}
                      stroke={d.vo2Changed ? '#064E3B' : 'none'}
                      strokeWidth={d.vo2Changed ? 1 : 0}
                    />
                  );
                })}

                {/* Rolling VO2max Trend Line */}
                {trendPoints && (
                  <polyline
                    fill="none"
                    stroke="#10B981"
                    strokeWidth="2.6"
                    points={trendPoints}
                  />
                )}

                {/* OLS Linear Regression Line */}
                {showRegressionLine && vo2Vals.length > 2 && (
                  <line
                    x1={chartLeft}
                    y1={Math.max(chartTop, Math.min(chartBottom, regYStart))}
                    x2={chartRight}
                    y2={Math.max(chartTop, Math.min(chartBottom, regYEnd))}
                    stroke="#06B6D4"
                    strokeWidth="2"
                    strokeDasharray="6 4"
                  />
                )}

                {/* X-Axis Date Ticks & Label */}
                {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                  const itemIdx = Math.min(len - 1, Math.round(f * (len - 1)));
                  const x = chartLeft + f * chartW;
                  return (
                    <text
                      key={idx}
                      x={x}
                      y={196}
                      textAnchor="middle"
                      className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                    >
                      {chartDays[itemIdx]?.date}
                    </text>
                  );
                })}
                <text
                  x={chartLeft + chartW / 2}
                  y={218}
                  textAnchor="middle"
                  className="fill-slate-600 dark:fill-slate-300 text-xs font-sans font-bold"
                >
                  Date (YYYY-MM-DD) · Synchronized Hover Across All 3 Physiological Charts
                </text>

                {/* Hover Crosshair & Hit Rects */}
                {chartDays.map((d, idx) => {
                  const x = chartLeft + (idx / Math.max(1, len - 1)) * chartW;
                  const colW = chartW / Math.max(1, len);
                  const isHovered = hoverIndex === idx;
                  const yVo2 =
                    d.vo2Max > 0
                      ? Math.max(
                          chartTop,
                          Math.min(chartBottom, chartBottom - ((d.vo2Max - minVo2) / vo2Span) * chartH)
                        )
                      : null;
                  return (
                    <g key={`hit-vo2-${idx}`}>
                      {isHovered && (
                        <>
                          <line
                            x1={x}
                            y1={chartTop}
                            x2={x}
                            y2={chartBottom}
                            stroke="#10B981"
                            strokeWidth="1.5"
                            strokeDasharray="3 2"
                          />
                          {yVo2 !== null && (
                            <circle
                              cx={x}
                              cy={yVo2}
                              r={5.5}
                              fill="#10B981"
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
                        height={190}
                        fill="transparent"
                        className="cursor-crosshair"
                        onMouseEnter={() => setHoverIndex(idx)}
                        onMouseMove={() => setHoverIndex(idx)}
                      />
                    </g>
                  );
                })}
              </>
            );
          })()}
        </svg>
      </section>

      {/* ==========================================================================
          CHART 2: LONG-TERM RESTING HEART RATE (RHR) SCATTER-TREND CHART
         ========================================================================== */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              02. Long-Term Resting Heart Rate (RHR) &amp; 60-Day Baseline Corridor Scatter-Trend
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Morning Garmin RHR scatter observations color-coded vs. rolling 60d normal corridor, {smoothingDays}-day trend line, and OLS trajectory
            </p>
          </div>

          {activeHoverDay && (
            <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5">
              <span className="font-bold text-slate-800 dark:text-slate-200">
                {activeHoverDay.date}
              </span>
              <span className="text-rose-600 dark:text-rose-400 font-bold">
                Morning RHR: {activeHoverDay.restingHR} bpm
              </span>
              <span className="text-amber-600 dark:text-amber-400">
                {smoothingDays}d Trend: {activeHoverDay.rhrTrend} bpm
              </span>
              <span className="text-slate-500">
                60d Band: {activeHoverDay.rhrBaseline60Low}–{activeHoverDay.rhrBaseline60High} bpm
              </span>
            </div>
          )}
        </div>

        <svg
          viewBox="0 0 880 230"
          className="w-full h-56 select-none"
          onMouseLeave={() => setHoverIndex(null)}
        >
          {(() => {
            if (chartDays.length === 0) return null;
            const len = chartDays.length;
            const chartLeft = 64;
            const chartRight = 836;
            const chartW = chartRight - chartLeft;
            const chartTop = 18;
            const chartBottom = 176;
            const chartH = chartBottom - chartTop;

            const rhrVals = chartDays.map((d) => d.restingHR).filter((v) => v > 0);
            const minRhr = rhrVals.length > 0 ? Math.max(34, Math.min(...rhrVals) - 3) : 38;
            const maxRhr = rhrVals.length > 0 ? Math.min(82, Math.max(...rhrVals) + 3) : 68;
            const rhrSpan = Math.max(10, maxRhr - minRhr);

            // 60-day normal corridor polygon
            const upperBand = chartDays.map((d, idx) => {
              const x = chartLeft + (idx / Math.max(1, len - 1)) * chartW;
              const y = chartBottom - ((d.rhrBaseline60High - minRhr) / rhrSpan) * chartH;
              return `${x},${Math.max(chartTop, Math.min(chartBottom, y))}`;
            });
            const lowerBand = [...chartDays].reverse().map((d, revIdx) => {
              const idx = len - 1 - revIdx;
              const x = chartLeft + (idx / Math.max(1, len - 1)) * chartW;
              const y = chartBottom - ((d.rhrBaseline60Low - minRhr) / rhrSpan) * chartH;
              return `${x},${Math.max(chartTop, Math.min(chartBottom, y))}`;
            });
            const bandPolygon = [...upperBand, ...lowerBand].join(' ');

            const rhrTrendPoints = chartDays
              .filter((d) => d.rhrTrend > 0)
              .map((d, idx) => {
                const x = chartLeft + (idx / Math.max(1, len - 1)) * chartW;
                const y = chartBottom - ((d.rhrTrend - minRhr) / rhrSpan) * chartH;
                return `${x},${Math.max(chartTop, Math.min(chartBottom, y))}`;
              })
              .join(' ');

            const regYStart =
              chartBottom -
              ((windowStats.rhrReg.intercept - minRhr) / rhrSpan) * chartH;
            const regYEnd =
              chartBottom -
              ((windowStats.rhrReg.slope * (len - 1) + windowStats.rhrReg.intercept - minRhr) /
                rhrSpan) *
                chartH;

            return (
              <>
                {/* Left Y-Axis Title */}
                <text
                  x={16}
                  y={96}
                  transform="rotate(-90 16 96)"
                  textAnchor="middle"
                  className="fill-rose-500 text-xs font-sans font-bold"
                >
                  Resting Heart Rate (bpm)
                </text>

                {/* Horizontal Grid Lines & Y-Axis Ticks */}
                {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                  const y = chartBottom - f * chartH;
                  const val = Math.round(minRhr + f * rhrSpan);
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
                        className="fill-rose-500 text-[11px] font-mono"
                      >
                        {val}
                      </text>
                    </g>
                  );
                })}

                {/* 60-Day RHR Normal Corridor Band */}
                {bandPolygon && (
                  <polygon
                    points={bandPolygon}
                    fill="#F43F5E"
                    fillOpacity={0.12}
                  />
                )}

                {/* Daily RHR Scatter Dots */}
                {chartDays.map((d, idx) => {
                  if (d.restingHR <= 0) return null;
                  const x = chartLeft + (idx / Math.max(1, len - 1)) * chartW;
                  const y = chartBottom - ((d.restingHR - minRhr) / rhrSpan) * chartH;
                  const isElevated = d.restingHR > d.rhrBaseline60High + 2;
                  const isLow = d.restingHR <= d.rhrBaseline60Low;
                  return (
                    <circle
                      key={`rhr-${idx}`}
                      cx={x}
                      cy={Math.max(chartTop, Math.min(chartBottom, y))}
                      r={2.8}
                      fill={isElevated ? '#F59E0B' : isLow ? '#10B981' : '#F43F5E'}
                      fillOpacity={0.65}
                    />
                  );
                })}

                {/* Rolling RHR Trend Line */}
                {rhrTrendPoints && (
                  <polyline
                    fill="none"
                    stroke="#F43F5E"
                    strokeWidth="2.5"
                    points={rhrTrendPoints}
                  />
                )}

                {/* OLS Linear Regression Line */}
                {showRegressionLine && rhrVals.length > 2 && (
                  <line
                    x1={chartLeft}
                    y1={Math.max(chartTop, Math.min(chartBottom, regYStart))}
                    x2={chartRight}
                    y2={Math.max(chartTop, Math.min(chartBottom, regYEnd))}
                    stroke="#3B82F6"
                    strokeWidth="2"
                    strokeDasharray="6 4"
                  />
                )}

                {/* X-Axis Date Ticks & Label */}
                {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                  const itemIdx = Math.min(len - 1, Math.round(f * (len - 1)));
                  const x = chartLeft + f * chartW;
                  return (
                    <text
                      key={idx}
                      x={x}
                      y={196}
                      textAnchor="middle"
                      className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                    >
                      {chartDays[itemIdx]?.date}
                    </text>
                  );
                })}
                <text
                  x={chartLeft + chartW / 2}
                  y={218}
                  textAnchor="middle"
                  className="fill-slate-600 dark:fill-slate-300 text-xs font-sans font-bold"
                >
                  Date (YYYY-MM-DD) · Emerald Dots = Below Baseline · Amber = Elevated Strain
                </text>

                {/* Hover Crosshair & Hit Rects */}
                {chartDays.map((d, idx) => {
                  const x = chartLeft + (idx / Math.max(1, len - 1)) * chartW;
                  const colW = chartW / Math.max(1, len);
                  const isHovered = hoverIndex === idx;
                  const yRhr =
                    d.restingHR > 0
                      ? Math.max(
                          chartTop,
                          Math.min(
                            chartBottom,
                            chartBottom - ((d.restingHR - minRhr) / rhrSpan) * chartH
                          )
                        )
                      : null;
                  return (
                    <g key={`hit-rhr-${idx}`}>
                      {isHovered && (
                        <>
                          <line
                            x1={x}
                            y1={chartTop}
                            x2={x}
                            y2={chartBottom}
                            stroke="#F43F5E"
                            strokeWidth="1.5"
                            strokeDasharray="3 2"
                          />
                          {yRhr !== null && (
                            <circle
                              cx={x}
                              cy={yRhr}
                              r={5.5}
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
                        height={190}
                        fill="transparent"
                        className="cursor-crosshair"
                        onMouseEnter={() => setHoverIndex(idx)}
                        onMouseMove={() => setHoverIndex(idx)}
                      />
                    </g>
                  );
                })}
              </>
            );
          })()}
        </svg>
      </section>

      {/* ==========================================================================
          CHART 3: LONG-TERM HRV rMSSD & HRV STABILITY (7d CV%) SCATTER-TREND CHART
         ========================================================================== */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              03. Overnight HRV (rMSSD) &amp; Autonomic Stability (7d CV%) Scatter-Trend
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Overnight Garmin HRV scatter dots (colored by Balanced / Unbalanced / Low status), 60-day normal corridor, {smoothingDays}d HRV trend (purple), and 7-day HRV Coefficient of Variation CV% (cyan)
            </p>
          </div>

          {activeHoverDay && (
            <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5">
              <span className="font-bold text-slate-800 dark:text-slate-200">
                {activeHoverDay.date}
              </span>
              <span className="text-purple-600 dark:text-purple-400 font-bold">
                HRV: {activeHoverDay.hrvRMSSD || '—'} ms ({activeHoverDay.hrvStatus})
              </span>
              <span className="text-emerald-600 dark:text-emerald-400">
                60d Corridor: {activeHoverDay.hrvBandLow}–{activeHoverDay.hrvBandHigh} ms
              </span>
              <span className="text-cyan-600 dark:text-cyan-400 font-bold">
                7d Stability CV: {activeHoverDay.hrvCv7d ? `${activeHoverDay.hrvCv7d}%` : '—'}
              </span>
            </div>
          )}
        </div>

        <svg
          viewBox="0 0 880 230"
          className="w-full h-56 select-none"
          onMouseLeave={() => setHoverIndex(null)}
        >
          {(() => {
            if (chartDays.length === 0) return null;
            const len = chartDays.length;
            const chartLeft = 64;
            const chartRight = 816;
            const chartW = chartRight - chartLeft;
            const chartTop = 18;
            const chartBottom = 176;
            const chartH = chartBottom - chartTop;

            const hrvVals = chartDays.map((d) => d.hrvRMSSD).filter((v) => v > 0);
            const minHrv = hrvVals.length > 0 ? Math.max(15, Math.min(...hrvVals) - 6) : 25;
            const maxHrv = hrvVals.length > 0 ? Math.min(130, Math.max(...hrvVals) + 6) : 85;
            const hrvSpan = Math.max(20, maxHrv - minHrv);

            const maxCv = 32; // 0% to 32% CV scale on right Y-axis

            // 60-day HRV Normal Corridor polygon
            const upperCorridor = chartDays.map((d, idx) => {
              const x = chartLeft + (idx / Math.max(1, len - 1)) * chartW;
              const y = chartBottom - ((d.hrvBandHigh - minHrv) / hrvSpan) * chartH;
              return `${x},${Math.max(chartTop, Math.min(chartBottom, y))}`;
            });
            const lowerCorridor = [...chartDays].reverse().map((d, revIdx) => {
              const idx = len - 1 - revIdx;
              const x = chartLeft + (idx / Math.max(1, len - 1)) * chartW;
              const y = chartBottom - ((d.hrvBandLow - minHrv) / hrvSpan) * chartH;
              return `${x},${Math.max(chartTop, Math.min(chartBottom, y))}`;
            });
            const corridorPolygon = [...upperCorridor, ...lowerCorridor].join(' ');

            const hrvTrendPoints = chartDays
              .filter((d) => d.hrvTrend > 0)
              .map((d) => {
                const idx = chartDays.indexOf(d);
                const x = chartLeft + (idx / Math.max(1, len - 1)) * chartW;
                const y = chartBottom - ((d.hrvTrend - minHrv) / hrvSpan) * chartH;
                return `${x},${Math.max(chartTop, Math.min(chartBottom, y))}`;
              })
              .join(' ');

            const cvPoints = chartDays
              .filter((d) => d.hrvCv7d > 0)
              .map((d) => {
                const idx = chartDays.indexOf(d);
                const x = chartLeft + (idx / Math.max(1, len - 1)) * chartW;
                const y = chartBottom - (Math.min(maxCv, d.hrvCv7d) / maxCv) * chartH;
                return `${x},${Math.max(chartTop, Math.min(chartBottom, y))}`;
              })
              .join(' ');

            return (
              <>
                {/* Left Y-Axis Title */}
                <text
                  x={16}
                  y={96}
                  transform="rotate(-90 16 96)"
                  textAnchor="middle"
                  className="fill-purple-500 text-xs font-sans font-bold"
                >
                  Overnight HRV rMSSD (ms)
                </text>

                {/* Right Y-Axis Title */}
                <text
                  x={866}
                  y={96}
                  transform="rotate(90 866 96)"
                  textAnchor="middle"
                  className="fill-cyan-500 text-xs font-sans font-bold"
                >
                  7d HRV Stability CV (%)
                </text>

                {/* Horizontal Grid Lines & Dual Y-Axis Ticks */}
                {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                  const y = chartBottom - f * chartH;
                  const hVal = Math.round(minHrv + f * hrvSpan);
                  const cvVal = Math.round(f * maxCv);
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
                        className="fill-purple-500 text-[11px] font-mono"
                      >
                        {hVal}
                      </text>
                      <text
                        x={chartRight + 8}
                        y={y + 4}
                        textAnchor="start"
                        className="fill-cyan-500 text-[11px] font-mono"
                      >
                        {cvVal}%
                      </text>
                    </g>
                  );
                })}

                {/* 60-Day Garmin HRV Normal Corridor Shaded Band */}
                {corridorPolygon && (
                  <polygon
                    points={corridorPolygon}
                    fill="#10B981"
                    fillOpacity={0.14}
                  />
                )}

                {/* Daily HRV rMSSD Scatter Dots */}
                {chartDays.map((d, idx) => {
                  if (d.hrvRMSSD <= 0) return null;
                  const x = chartLeft + (idx / Math.max(1, len - 1)) * chartW;
                  const y = chartBottom - ((d.hrvRMSSD - minHrv) / hrvSpan) * chartH;
                  const dotColor =
                    d.hrvStatus === 'Balanced'
                      ? '#10B981'
                      : d.hrvStatus === 'Unbalanced'
                        ? '#F59E0B'
                        : '#EF4444';
                  return (
                    <circle
                      key={`hrv-${idx}`}
                      cx={x}
                      cy={Math.max(chartTop, Math.min(chartBottom, y))}
                      r={3}
                      fill={dotColor}
                      fillOpacity={0.75}
                    />
                  );
                })}

                {/* 7-Day HRV Stability CV% Trend Line (Cyan) */}
                {cvPoints && (
                  <polyline
                    fill="none"
                    stroke="#06B6D4"
                    strokeWidth="1.8"
                    strokeDasharray="4 2"
                    points={cvPoints}
                  />
                )}

                {/* Rolling HRV rMSSD Trend Line (Purple) */}
                {hrvTrendPoints && (
                  <polyline
                    fill="none"
                    stroke="#8B5CF6"
                    strokeWidth="2.5"
                    points={hrvTrendPoints}
                  />
                )}

                {/* X-Axis Date Ticks & Label */}
                {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                  const itemIdx = Math.min(len - 1, Math.round(f * (len - 1)));
                  const x = chartLeft + f * chartW;
                  return (
                    <text
                      key={idx}
                      x={x}
                      y={196}
                      textAnchor="middle"
                      className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                    >
                      {chartDays[itemIdx]?.date}
                    </text>
                  );
                })}
                <text
                  x={chartLeft + chartW / 2}
                  y={218}
                  textAnchor="middle"
                  className="fill-slate-600 dark:fill-slate-300 text-xs font-sans font-bold"
                >
                  Date (YYYY-MM-DD) · Shaded Green Band = 60d Normal Corridor · Cyan Dashed = 7d Stability CV%
                </text>

                {/* Hover Crosshair & Hit Rects */}
                {chartDays.map((d, idx) => {
                  const x = chartLeft + (idx / Math.max(1, len - 1)) * chartW;
                  const colW = chartW / Math.max(1, len);
                  const isHovered = hoverIndex === idx;
                  const yHrv =
                    d.hrvRMSSD > 0
                      ? Math.max(
                          chartTop,
                          Math.min(
                            chartBottom,
                            chartBottom - ((d.hrvRMSSD - minHrv) / hrvSpan) * chartH
                          )
                        )
                      : null;
                  return (
                    <g key={`hit-hrv-${idx}`}>
                      {isHovered && (
                        <>
                          <line
                            x1={x}
                            y1={chartTop}
                            x2={x}
                            y2={chartBottom}
                            stroke="#8B5CF6"
                            strokeWidth="1.5"
                            strokeDasharray="3 2"
                          />
                          {yHrv !== null && (
                            <circle
                              cx={x}
                              cy={yHrv}
                              r={5.5}
                              fill="#8B5CF6"
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
                        height={190}
                        fill="transparent"
                        className="cursor-crosshair"
                        onMouseEnter={() => setHoverIndex(idx)}
                        onMouseMove={() => setHoverIndex(idx)}
                      />
                    </g>
                  );
                })}
              </>
            );
          })()}
        </svg>
      </section>

      {/* ==========================================================================
          BOTTOM GRID: CROSS-METRIC SCATTER CORRELATION & MULTI-YEAR PROGRESSION
         ========================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Interactive Physiological Cross-Metric Scatter-Regression Explorer */}
        <section className="lg:col-span-6 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Cross-Metric Physiological Scatter-Regression
              </h3>
              <p className="text-xs text-slate-500">
                {correlationScatterData.title} (r = {correlationScatterData.reg.r.toFixed(2)})
              </p>
            </div>

            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] font-semibold">
              {(
                [
                  { id: 'RHR_VS_HRV', label: 'RHR vs HRV' },
                  { id: 'CTL_VS_VO2', label: 'CTL vs VO2max' },
                  { id: 'HRV_CV_VS_EF', label: 'HRV CV% vs EF' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setCorrelationPair(item.id)}
                  className={`min-h-[28px] px-2.5 py-0.5 rounded-md transition-colors ${
                    correlationPair === item.id
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <svg viewBox="0 0 520 250" className="w-full h-60 select-none">
            {(() => {
              const pts = correlationScatterData.points;
              if (pts.length === 0) return null;
              const chartLeft = 58;
              const chartRight = 496;
              const chartW = chartRight - chartLeft;
              const chartTop = 18;
              const chartBottom = 196;
              const chartH = chartBottom - chartTop;

              const xs = pts.map((p) => p.x);
              const ys = pts.map((p) => p.y);
              const minX = Math.min(...xs);
              const maxX = Math.max(...xs);
              const spanX = Math.max(1, maxX - minX);
              const minY = Math.min(...ys);
              const maxY = Math.max(...ys);
              const spanY = Math.max(0.2, maxY - minY);

              const { slope, intercept } = correlationScatterData.reg;
              const yAtMinX = slope * minX + intercept;
              const yAtMaxX = slope * maxX + intercept;
              const regY1 = chartBottom - ((yAtMinX - minY) / spanY) * chartH;
              const regY2 = chartBottom - ((yAtMaxX - minY) / spanY) * chartH;

              return (
                <>
                  {/* Y-Axis Title */}
                  <text
                    x={14}
                    y={106}
                    transform="rotate(-90 14 106)"
                    textAnchor="middle"
                    className="fill-blue-500 text-[11px] font-sans font-bold"
                  >
                    {correlationScatterData.yLabel}
                  </text>

                  {/* Grid & Y Ticks */}
                  {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                    const y = chartBottom - f * chartH;
                    const val = minY + f * spanY;
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
                          className="fill-slate-500 text-[11px] font-mono"
                        >
                          {val >= 10 ? Math.round(val) : val.toFixed(2)}
                        </text>
                      </g>
                    );
                  })}

                  {/* X-Axis Ticks */}
                  {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                    const x = chartLeft + f * chartW;
                    const val = minX + f * spanX;
                    return (
                      <text
                        key={idx}
                        x={x}
                        y={216}
                        textAnchor="middle"
                        className="fill-slate-500 text-[11px] font-mono"
                      >
                        {val >= 10 ? Math.round(val) : val.toFixed(1)}
                      </text>
                    );
                  })}
                  <text
                    x={chartLeft + chartW / 2}
                    y={238}
                    textAnchor="middle"
                    className="fill-slate-600 dark:fill-slate-300 text-xs font-sans font-bold"
                  >
                    {correlationScatterData.xLabel}
                  </text>

                  {/* Scatter Points */}
                  {pts.map((p, idx) => {
                    const x = chartLeft + ((p.x - minX) / spanX) * chartW;
                    const y = chartBottom - ((p.y - minY) / spanY) * chartH;
                    const color =
                      p.status === 'Balanced'
                        ? '#10B981'
                        : p.status === 'Unbalanced'
                          ? '#F59E0B'
                          : '#3B82F6';
                    return (
                      <circle
                        key={idx}
                        cx={Math.max(chartLeft, Math.min(chartRight, x))}
                        cy={Math.max(chartTop, Math.min(chartBottom, y))}
                        r={3.5}
                        fill={color}
                        fillOpacity={0.7}
                      >
                        <title>
                          {p.date}: X={p.x}, Y={p.y}
                        </title>
                      </circle>
                    );
                  })}

                  {/* Linear Regression Trend Line */}
                  <line
                    x1={chartLeft}
                    y1={Math.max(chartTop, Math.min(chartBottom, regY1))}
                    x2={chartRight}
                    y2={Math.max(chartTop, Math.min(chartBottom, regY2))}
                    stroke="#3B82F6"
                    strokeWidth="2.2"
                    strokeDasharray="5 3"
                  />
                </>
              );
            })()}
          </svg>
        </section>

        {/* Right: Multi-Year Annual Physiological Progression Table */}
        <section className="lg:col-span-6 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Multi-Year Physiological Progression Archive (2018–2026)
              </h3>
              <p className="text-xs text-slate-500">
                Annual rollups of VO2max, Resting HR, Overnight HRV, 7d Stability CV%, and Peak eFTP
              </p>
            </div>
            <HeartPulse className="w-4 h-4 text-emerald-500" />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm border-collapse font-mono tabular-nums">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-sans text-slate-500">
                  <th className="py-2 pr-2">Season</th>
                  <th className="py-2 px-2 text-right">VO2max (Avg / Peak)</th>
                  <th className="py-2 px-2 text-right">RHR (Avg / Min)</th>
                  <th className="py-2 px-2 text-right">Avg HRV</th>
                  <th className="py-2 px-2 text-right">Stability CV%</th>
                  <th className="py-2 pl-2 text-right">Peak eFTP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {annualSummaryRows.map((row) => (
                  <tr
                    key={row.year}
                    className="hover:bg-slate-50 dark:hover:bg-slate-900/60 transition-colors"
                  >
                    <td className="py-2.5 pr-2 font-bold text-slate-900 dark:text-slate-100">
                      {row.year}
                    </td>
                    <td className="py-2.5 px-2 text-right text-emerald-600 dark:text-emerald-400 font-semibold">
                      {row.avgVo2} / <span className="font-bold">{row.maxVo2}</span>
                    </td>
                    <td className="py-2.5 px-2 text-right text-rose-600 dark:text-rose-400">
                      {row.avgRhr} / <span className="font-bold">{row.minRhr}</span> bpm
                    </td>
                    <td className="py-2.5 px-2 text-right text-purple-600 dark:text-purple-400 font-semibold">
                      {row.avgHrv !== '—' ? `${row.avgHrv} ms` : '—'}
                    </td>
                    <td className="py-2.5 px-2 text-right text-cyan-600 dark:text-cyan-400">
                      {row.avgCv}
                    </td>
                    <td className="py-2.5 pl-2 text-right text-blue-600 dark:text-blue-400 font-semibold">
                      {row.peakWkg}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
