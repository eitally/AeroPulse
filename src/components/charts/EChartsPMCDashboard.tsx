import React, { useEffect, useRef, useMemo, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import {
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ComposeOption } from 'echarts/core';
import type { BarSeriesOption, LineSeriesOption } from 'echarts/charts';
import type {
  DataZoomComponentOption,
  GridComponentOption,
  MarkLineComponentOption,
  TooltipComponentOption,
} from 'echarts/components';
import { UnifiedActivity } from '../../types';
import { getThreshThemePalette } from '../../utils/themeTokens';
import { TrendingUp, Zap } from "../icons/PhosphorIcons";
import {
  buildDayLoadSegments,
  classifyActivityGarminLoad,
  classifyGarminLoadType,
  GARMIN_LOAD_FOCUS_META,
  type ActivityLoadSegment,
  type GarminClassifyOptions,
  type GarminLoadFocus,
  type GarminLoadFocusMeta,
  type PMCDayPoint,
} from '../../physiology/garminLoadFocus';

export {
  buildDayLoadSegments,
  classifyActivityGarminLoad,
  classifyGarminLoadType,
  GARMIN_LOAD_FOCUS_META,
  type ActivityLoadSegment,
  type GarminClassifyOptions,
  type GarminLoadFocus,
  type GarminLoadFocusMeta,
  type PMCDayPoint,
};

echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  DataZoomComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

type PMCEChartsOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | DataZoomComponentOption
  | MarkLineComponentOption
>;

export interface EChartsPMCDashboardProps {
  timeline: PMCDayPoint[];
  onSelectActivity?: (activity: UnifiedActivity) => void;
  onSelectDate?: (date: string) => void;
  onSelectDateRange?: (startDate: string, endDate: string) => void;
  height?: number;
}

const EChartsPMCDashboardInner: React.FC<EChartsPMCDashboardProps> = ({
  timeline,
  onSelectActivity,
  onSelectDate,
  onSelectDateRange,
  height: _height = 540,
}) => {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<echarts.EChartsType | null>(null);
  const [showEftpOverlay, setShowEftpOverlay] = useState<boolean>(true);
  const [showTssBars, setShowTssBars] = useState<boolean>(true);
  const [showRampSubplot, setShowRampSubplot] = useState<boolean>(true);
  const [selectedDay, setSelectedDay] = useState<PMCDayPoint | null>(null);
  const [dragSelection, setDragSelection] = useState<{
    startX: number;
    currentX: number;
    startIdx: number;
    endIdx: number;
  } | null>(null);
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false
  );
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotion = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    setPrefersReducedMotion(mq.matches);
    mq.addEventListener('change', syncMotion);
    return () => mq.removeEventListener('change', syncMotion);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const syncTheme = () => setIsDark(root.classList.contains('dark'));
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Precompute per-activity Garmin Load Focus stacked segments and 7d Ramp Rate for every day
  const enrichedTimeline = useMemo(() => {
    return timeline.map((pt, idx) => {
      const prev7 = idx >= 7 ? timeline[idx - 7] : timeline[0];
      const computedRamp =
        typeof pt.rampRate === 'number' && pt.rampRate !== 0
          ? Number(pt.rampRate.toFixed(1))
          : Number((pt.ctl - (prev7?.ctl ?? pt.ctl)).toFixed(1));
      const opts = pt.classifyOpts || {
        ftp: pt.eftp || 300,
      };
      const segments =
        pt.segments && pt.segments.length > 0
          ? pt.segments
          : buildDayLoadSegments(pt.activities, pt.tss, pt.date, opts);
      const totalSegmentedTss = segments.reduce((s, seg) => s + seg.load, 0);
      const effectiveTss = totalSegmentedTss > 0 ? totalSegmentedTss : pt.tss;

      // Ensure small non-zero workouts on multi-activity days (e.g. a 3 TSS spin on a 97 TSS day)
      // have at least a ~10% visual band height while keeping the total stacked bar height = effectiveTss
      let visualLoads = segments.map((s) => s.load);
      if (segments.length > 1 && effectiveTss > 0) {
        const minSlice = Math.max(7, effectiveTss * 0.11);
        const boosted = segments.map((s) => (s.load > 0 ? Math.max(s.load, minSlice) : 0));
        const boostedSum = boosted.reduce((a, b) => a + b, 0);
        if (boostedSum > 0) {
          visualLoads = boosted.map((v) => Math.round((v / boostedSum) * effectiveTss * 10) / 10);
        }
      }

      const garminFocus = classifyGarminLoadType(pt.activities, effectiveTss, 0, opts);
      return {
        ...pt,
        tss: effectiveTss,
        rampRate: computedRamp,
        garminFocus,
        segments,
        visualLoads,
      };
    });
  }, [timeline]);

  const summaryMetrics = useMemo(() => {
    if (!enrichedTimeline.length) {
      return {
        latestCtl: 0,
        latestAtl: 0,
        latestTsb: 0,
        latestRamp: 0,
        peakCtl: 0,
        totalTss: 0,
      };
    }
    const latest = enrichedTimeline[enrichedTimeline.length - 1];
    let peakCtl = 0;
    let totalTss = 0;
    for (const pt of enrichedTimeline) {
      if (pt.ctl > peakCtl) peakCtl = pt.ctl;
      totalTss += pt.tss || 0;
    }
    return {
      latestCtl: latest.ctl,
      latestAtl: latest.atl,
      latestTsb: latest.tsb,
      latestRamp: latest.rampRate,
      peakCtl: Math.round(peakCtl * 10) / 10,
      totalTss: Math.round(totalTss),
    };
  }, [enrichedTimeline]);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const chart = echarts.init(container, undefined, {
      renderer: 'canvas',
    });
    chartInstanceRef.current = chart;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && chartInstanceRef.current) {
          chartInstanceRef.current.resize();
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartInstanceRef.current;
    if (!chart || !enrichedTimeline.length) return;

    const dates = enrichedTimeline.map((d) => d.date);
    const ctlData = enrichedTimeline.map((d) => Math.round(d.ctl * 10) / 10);
    const atlData = enrichedTimeline.map((d) => Math.round(d.atl * 10) / 10);
    const tsbData = enrichedTimeline.map((d) => Math.round(d.tsb * 10) / 10);
    const rampData = enrichedTimeline.map((d) => Math.round(d.rampRate * 10) / 10);
    const eftpData = enrichedTimeline.map((d) => Math.round(d.eftp));

    const themePalette = getThreshThemePalette(isDark);
    const axisLabelColor = themePalette.textMuted;
    const axisLineColor = themePalette.axisLine;
    const splitLineColor = themePalette.splitLine;
    const tooltipBg = themePalette.tooltipBg;
    const tooltipText = themePalette.tooltipText;
    const tooltipMuted = themePalette.textSecondary;
    const tooltipDivider = themePalette.borderSubtle;

    // Determine max activities in any single day so we can build stacked bar series per activity slot
    const maxSegmentsPerDay = Math.min(
      10,
      Math.max(1, ...enrichedTimeline.map((d) => d.segments.length))
    );

    const stackedActivityBarSeries = showTssBars
      ? Array.from({ length: maxSegmentsPerDay }, (_, slotIdx) => ({
          name: `Daily Load Slot ${slotIdx + 1}`,
          type: 'bar' as const,
          stack: 'daily-garmin-load',
          xAxisIndex: 0,
          yAxisIndex: 0,
          z: 5,
          barMaxWidth: 9,
          data: enrichedTimeline.map((d) => {
            const seg = d.segments[slotIdx];
            if (!seg || seg.load <= 0) {
              return {
                value: 0,
                itemStyle: { color: 'transparent' },
              };
            }
            const isTopSegment =
              slotIdx === Math.min(maxSegmentsPerDay, d.segments.length) - 1;
            const visualVal =
              d.visualLoads && d.visualLoads[slotIdx] != null
                ? d.visualLoads[slotIdx]
                : Math.round(seg.load * 10) / 10;
            return {
              value: visualVal,
              segmentMeta: seg,
              itemStyle: {
                color: seg.focus.barColor,
                borderRadius: isTopSegment ? [2, 2, 0, 0] : [0, 0, 0, 0],
              },
            };
          }),
          emphasis: {
            itemStyle: {
              opacity: 1,
            },
          },
        }))
      : [];

    const activeXAxisIndices = showRampSubplot ? [0, 1, 2] : [0, 1];
    const ctlColor = themePalette.ctlCyan;
    const atlColor = themePalette.atlRose;
    const eftpColor = themePalette.tsbGreyAmber;

    const option: PMCEChartsOption = {
      backgroundColor: 'transparent',
      animation: !prefersReducedMotion,
      animationDuration: prefersReducedMotion ? 0 : 350,
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          link: [{ xAxisIndex: 'all' }],
          lineStyle: {
            color: isDark ? 'rgba(45, 212, 191, 0.55)' : 'rgba(13, 148, 136, 0.45)',
            width: 1,
            type: 'dashed',
          },
        },
        backgroundColor: tooltipBg,
        borderColor: themePalette.tooltipBorder,
        borderWidth: 1,
        padding: [10, 14],
        textStyle: {
          color: tooltipText,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 11,
        },
        formatter: (params: any) => {
          const list = Array.isArray(params) ? params : [params];
          if (!list.length) return '';
          const idx = list[0].dataIndex;
          const pt = enrichedTimeline[idx];
          if (!pt) return '';

          const zoneLabel =
            pt.tsb > 15
              ? '<span style="color:#f59e0b">Transition (> +15)</span>'
              : pt.tsb >= 5
                ? '<span style="color:#38bdf8">Fresh / Race Ready (+5 to +15)</span>'
                : pt.tsb >= -10
                  ? `<span style="color:${axisLabelColor}">Grey Zone (-10 to +5)</span>`
                  : pt.tsb >= -30
                    ? '<span style="color:#10b981">Optimal Overload (-10 to -30)</span>'
                    : '<span style="color:#f43f5e">High Risk (< -30)</span>';

          const rampColor =
            pt.rampRate > 7
              ? '#f43f5e'
              : pt.rampRate > 5
                ? '#f59e0b'
                : pt.rampRate >= 0
                  ? '#10b981'
                  : '#38bdf8';

          const loadFocusHtml =
            pt.segments.length > 1
              ? `<span style="color:${tooltipText};font-weight:700;">${Math.round(pt.tss)} TSS</span> <span style="font-size:11px;">(${pt.segments
                  .map(
                    (seg) =>
                      `<span style="color:${seg.focus.solidColor};font-weight:700;">${Math.round(seg.load)} ${seg.focus.shortLabel}</span>`
                  )
                  .join(' + ')})</span>`
              : pt.segments.length === 1
                ? `<span style="color:${pt.segments[0].focus.solidColor};font-weight:700;">${Math.round(pt.tss)} TSS (${pt.segments[0].focus.label})</span>`
                : `<span style="color:${axisLabelColor};">0 TSS (Rest)</span>`;

          const actsHtml =
            pt.segments && pt.segments.length > 0 && pt.activities.length > 0
              ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid ${tooltipDivider};">
                  <div style="font-size:11px;color:#38bdf8;margin-bottom:3px;">STACKED WORKOUT LOAD (${pt.segments.length}) — Click to inspect</div>
                  ${pt.segments
                    .slice()
                    .reverse()
                    .map((seg) => {
                      return `<div style="font-size:11px;color:${tooltipMuted};display:flex;align-items:center;justify-content:space-between;gap:8px;">
                        <span><span style="color:${seg.focus.solidColor};">●</span> ${seg.activityName}</span>
                        <strong style="color:${seg.focus.solidColor};">${Math.round(seg.load)} TSS (${seg.focus.shortLabel})</strong>
                      </div>`;
                    })
                    .join('')}
                </div>`
              : '';

          return `
            <div style="min-width:245px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;border-bottom:1px solid ${tooltipDivider};padding-bottom:4px;">
                <strong style="color:${tooltipText};font-size:12px;">${pt.date}</strong>
                <span style="font-size:11px;color:${rampColor};font-weight:700;">Ramp ${pt.rampRate >= 0 ? '+' : ''}${pt.rampRate.toFixed(1)} CTL/wk</span>
              </div>
              <div style="display:grid;grid-template-columns:1fr auto;gap:3px 12px;font-size:11px;">
                <span style="color:${ctlColor};">● Fitness (CTL 42d)</span>
                <strong style="color:${ctlColor};text-align:right;">${pt.ctl.toFixed(1)}</strong>
                <span style="color:${atlColor};">● Fatigue (ATL 7d)</span>
                <strong style="color:${atlColor};text-align:right;">${pt.atl.toFixed(1)}</strong>
                <span style="color:#d97706;">● Form (TSB)</span>
                <strong style="text-align:right;color:${pt.tsb >= 0 ? ctlColor : pt.tsb >= -30 ? eftpColor : '#dc2626'};">${pt.tsb > 0 ? '+' : ''}${pt.tsb.toFixed(1)}</strong>
                <span style="color:${rampColor};">● 7d Ramp Rate</span>
                <strong style="text-align:right;color:${rampColor};">${pt.rampRate >= 0 ? '+' : ''}${pt.rampRate.toFixed(1)} /wk</strong>
                <span style="color:${tooltipMuted};">● Daily Load</span>
                <strong style="text-align:right;">${loadFocusHtml}</strong>
                <span style="color:${eftpColor};">● Modeled eFTP</span>
                <strong style="color:${eftpColor};text-align:right;">${Math.round(pt.eftp)} W</strong>
              </div>
              <div style="margin-top:5px;font-size:11px;">Form Zone: ${zoneLabel}</div>
              ${actsHtml}
            </div>
          `;
        },
      },
      axisPointer: {
        link: [{ xAxisIndex: 'all' }],
      },
      grid: [
        {
          left: 58,
          right: 60,
          top: 34,
          height: 260,
        },
        {
          left: 58,
          right: 60,
          top: 326,
          height: 115,
        },
        ...(showRampSubplot
          ? [
              {
                left: 58,
                right: 60,
                top: 473,
                height: 95,
              },
            ]
          : []),
      ],
      xAxis: [
        {
          type: 'category',
          gridIndex: 0,
          data: dates,
          boundaryGap: false,
          axisLine: { lineStyle: { color: axisLineColor } },
          axisLabel: { show: false },
          axisTick: { show: false },
        },
        {
          type: 'category',
          gridIndex: 1,
          data: dates,
          boundaryGap: false,
          axisLine: { lineStyle: { color: axisLineColor } },
          axisLabel: showRampSubplot
            ? { show: false }
            : {
                color: axisLabelColor,
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 11,
              },
          axisTick: { show: !showRampSubplot, lineStyle: { color: axisLineColor } },
        },
        ...(showRampSubplot
          ? [
              {
                type: 'category' as const,
                gridIndex: 2,
                data: dates,
                boundaryGap: false,
                axisLine: { lineStyle: { color: axisLineColor } },
                axisLabel: {
                  color: axisLabelColor,
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 11,
                },
                axisTick: { lineStyle: { color: axisLineColor } },
              },
            ]
          : []),
      ],
      yAxis: [
        {
          type: 'value',
          gridIndex: 0,
          name: 'CTL / ATL',
          nameGap: 10,
          nameTextStyle: {
            color: ctlColor,
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
            align: 'left',
            padding: [0, 0, 0, -42],
          },
          splitLine: { lineStyle: { color: splitLineColor } },
          axisLabel: {
            color: axisLabelColor,
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
          },
        },
        {
          type: 'value',
          gridIndex: 0,
          name: showEftpOverlay ? 'eFTP (W)' : 'TSS',
          position: 'right',
          nameGap: 10,
          min: (val: { min: number }) => Math.max(0, Math.floor(val.min * 0.85)),
          nameTextStyle: {
            color: eftpColor,
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
            align: 'right',
            padding: [0, -42, 0, 0],
          },
          splitLine: { show: false },
          axisLabel: {
            color: eftpColor,
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
          },
        },
        {
          type: 'value',
          gridIndex: 1,
          name: 'Form (TSB)',
          nameGap: 10,
          nameTextStyle: {
            color: '#f59e0b',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
            align: 'left',
            padding: [0, 0, 0, -42],
          },
          splitLine: { lineStyle: { color: splitLineColor } },
          axisLabel: {
            color: axisLabelColor,
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
          },
        },
        ...(showRampSubplot
          ? [
              {
                type: 'value' as const,
                gridIndex: 2,
                name: 'Ramp (/wk)',
                nameGap: 10,
                nameTextStyle: {
                  color: '#10b981',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 11,
                  align: 'left' as const,
                  padding: [0, 0, 0, -42],
                },
                splitLine: { lineStyle: { color: splitLineColor } },
                axisLabel: {
                  color: axisLabelColor,
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 11,
                },
              },
            ]
          : []),
      ],
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: activeXAxisIndices,
          start: 0,
          end: 100,
          zoomOnMouseWheel: false,
          moveOnMouseMove: false,
          moveOnMouseWheel: false,
        },
      ],
      series: [
        ...stackedActivityBarSeries,
        {
          name: 'Fitness (CTL)',
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: ctlData,
          smooth: 0.25,
          symbol: 'none',
          lineStyle: {
            width: 2.5,
            color: ctlColor,
          },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: isDark ? 'rgba(45, 212, 191, 0.28)' : 'rgba(13, 148, 136, 0.18)' },
              { offset: 1, color: isDark ? 'rgba(45, 212, 191, 0.01)' : 'rgba(13, 148, 136, 0.01)' },
            ]),
          },
        },
        {
          name: 'Fatigue (ATL)',
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: atlData,
          smooth: 0.25,
          symbol: 'none',
          lineStyle: {
            width: 2,
            color: atlColor,
          },
        },
        ...(showEftpOverlay
          ? [
              {
                name: 'eFTP (W)',
                type: 'line' as const,
                step: 'end' as const,
                xAxisIndex: 0,
                yAxisIndex: 1,
                data: eftpData,
                symbol: 'none',
                lineStyle: {
                  width: 1.8,
                  color: eftpColor,
                  type: 'dashed' as const,
                },
              },
            ]
          : []),
        {
          name: 'Form (TSB)',
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 2,
          data: tsbData,
          barMaxWidth: 9,
          itemStyle: {
            color: (params: any) => {
              const v = Number(params.value || 0);
              if (v > 15) return 'rgba(245, 158, 11, 0.78)';
              if (v >= 5) return 'rgba(56, 189, 248, 0.82)';
              if (v >= -10) return 'rgba(148, 163, 184, 0.55)';
              if (v >= -30) return 'rgba(16, 185, 129, 0.82)';
              return 'rgba(244, 63, 94, 0.88)';
            },
          },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: {
              type: 'dashed',
              color: axisLineColor,
            },
            data: [{ yAxis: 0 }, { yAxis: -10 }, { yAxis: -30 }],
          },
        },
        ...(showRampSubplot
          ? [
              {
                name: 'Ramp Rate (CTL/wk)',
                type: 'bar' as const,
                xAxisIndex: 2,
                yAxisIndex: 3,
                data: rampData,
                barMaxWidth: 8,
                itemStyle: {
                  color: (params: any) => {
                    const v = Number(params.value || 0);
                    if (v > 7) return 'rgba(244, 63, 94, 0.88)'; // Excessive ramp (> +7/wk)
                    if (v > 5) return 'rgba(245, 158, 11, 0.85)'; // Heavy build (+5 to +7/wk)
                    if (v >= 0) return 'rgba(16, 185, 129, 0.82)'; // Optimal productive ramp (0 to +5/wk)
                    return 'rgba(56, 189, 248, 0.72)'; // Recovery / taper (< 0/wk)
                  },
                  borderRadius: [2, 2, 0, 0],
                },
                markLine: {
                  silent: true,
                  symbol: 'none',
                  lineStyle: {
                    type: 'dashed' as const,
                    color: axisLineColor,
                  },
                  data: [{ yAxis: 0 }, { yAxis: 5 }],
                },
              },
            ]
          : []),
      ],
    };

    const targetHeight = showRampSubplot ? 625 : 498;
    chart.resize({ height: targetHeight });
    chart.setOption(option, true);

    chart.off('click');
    chart.on('click', (params: any) => {
      const idx = params?.dataIndex;
      if (typeof idx === 'number' && enrichedTimeline[idx]) {
        const day = enrichedTimeline[idx];
        setSelectedDay(day);
        if (onSelectDate) onSelectDate(day.date);
        const clickedSegActivity = params?.data?.segmentMeta?.activity;
        if (clickedSegActivity && onSelectActivity) {
          onSelectActivity(clickedSegActivity);
        } else if (day.activities.length === 1 && onSelectActivity) {
          onSelectActivity(day.activities[0]);
        }
      }
    });
  }, [
    enrichedTimeline,
    showEftpOverlay,
    showTssBars,
    showRampSubplot,
    isDark,
    prefersReducedMotion,
    onSelectActivity,
    onSelectDate,
  ]);

  const computedChartHeight = showRampSubplot ? 625 : 498;

  return (
    <div className="rounded-2xl liquid-glass p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 pb-2 border-b border-emerald-900/15 dark:border-emerald-400/15">
        <div className="flex flex-wrap items-center gap-2 text-2xs font-mono">
          <TrendingUp className="w-3.5 h-3.5 text-[#0F766E] dark:text-[#2DD4BF] shrink-0" />
          <span className="text-slate-700 dark:text-slate-300">
            CTL <strong className="text-[#0F766E] dark:text-[#2DD4BF]">{summaryMetrics.latestCtl.toFixed(1)}</strong> · ATL{' '}
            <strong className="text-[#BE123C] dark:text-[#FB7185]">{summaryMetrics.latestAtl.toFixed(1)}</strong> · TSB{' '}
            <strong
              className={
                summaryMetrics.latestTsb >= 0
                  ? 'text-[#0369A1] dark:text-[#38BDF8]'
                  : summaryMetrics.latestTsb >= -30
                    ? 'text-[#047857] dark:text-[#34D399]'
                    : 'text-[#B91C1C] dark:text-rose-400'
              }
            >
              {summaryMetrics.latestTsb > 0 ? '+' : ''}
              {summaryMetrics.latestTsb.toFixed(1)}
            </strong>{' '}
            · Ramp{' '}
            <strong
              className={
                summaryMetrics.latestRamp > 7
                  ? 'text-[#B91C1C] dark:text-rose-400'
                  : summaryMetrics.latestRamp > 5
                    ? 'text-[#B45309] dark:text-amber-400'
                    : summaryMetrics.latestRamp >= 0
                      ? 'text-[#047857] dark:text-[#34D399]'
                      : 'text-[#0369A1] dark:text-[#38BDF8]'
              }
            >
              {summaryMetrics.latestRamp >= 0 ? '+' : ''}
              {summaryMetrics.latestRamp.toFixed(1)}/wk
            </strong>
          </span>

          {showTssBars && (
            <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-emerald-900/15 dark:border-emerald-400/15 text-2xs font-mono text-slate-600 dark:text-slate-300">
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#0D9488]" />
                Low
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#EA580C]" />
                High
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#7C3AED]" />
                Anaerobic
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowTssBars((v) => !v)}
            className={`min-h-[36px] sm:min-h-[30px] px-2.5 py-1 rounded text-2xs font-mono uppercase transition-colors border ${
              showTssBars
                ? 'bg-teal-500/15 border-teal-500/40 text-teal-800 dark:text-teal-300'
                : 'liquid-glass-subtle text-slate-700 dark:text-slate-300'
            }`}
          >
            Load Bars
          </button>
          <button
            type="button"
            onClick={() => setShowRampSubplot((v) => !v)}
            className={`min-h-[36px] sm:min-h-[30px] px-2.5 py-1 rounded text-2xs font-mono uppercase transition-colors border ${
              showRampSubplot
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-800 dark:text-emerald-300'
                : 'liquid-glass-subtle text-slate-700 dark:text-slate-300'
            }`}
          >
            Ramp
          </button>
          <button
            type="button"
            onClick={() => setShowEftpOverlay((v) => !v)}
            className={`min-h-[36px] sm:min-h-[30px] px-2.5 py-1 rounded text-2xs font-mono uppercase transition-colors border ${
              showEftpOverlay
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-800 dark:text-amber-300'
                : 'liquid-glass-subtle text-slate-700 dark:text-slate-300'
            }`}
          >
            eFTP
          </button>
        </div>
      </div>

      <div
        className="relative select-none cursor-crosshair"
        onPointerDown={(e) => {
          if (e.button !== 0 || !chartContainerRef.current || enrichedTimeline.length < 2) return;
          const rect = chartContainerRef.current.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const plotLeft = 58;
          const plotRight = Math.max(plotLeft + 20, rect.width - 60);
          if (x < plotLeft || x > plotRight) return;
          const ratio = Math.max(0, Math.min(1, (x - plotLeft) / (plotRight - plotLeft)));
          const idx = Math.round(ratio * (enrichedTimeline.length - 1));
          setDragSelection({
            startX: x,
            currentX: x,
            startIdx: idx,
            endIdx: idx,
          });
        }}
        onPointerMove={(e) => {
          if (!dragSelection || !chartContainerRef.current || enrichedTimeline.length < 2) return;
          const rect = chartContainerRef.current.getBoundingClientRect();
          const plotLeft = 58;
          const plotRight = Math.max(plotLeft + 20, rect.width - 60);
          const x = Math.max(plotLeft, Math.min(plotRight, e.clientX - rect.left));
          const ratio = Math.max(0, Math.min(1, (x - plotLeft) / (plotRight - plotLeft)));
          const idx = Math.round(ratio * (enrichedTimeline.length - 1));
          setDragSelection((prev) =>
            prev
              ? {
                  ...prev,
                  currentX: x,
                  endIdx: idx,
                }
              : null
          );
        }}
        onPointerUp={() => {
          if (!dragSelection) return;
          const pixelDelta = Math.abs(dragSelection.currentX - dragSelection.startX);
          const loIdx = Math.min(dragSelection.startIdx, dragSelection.endIdx);
          const hiIdx = Math.max(dragSelection.startIdx, dragSelection.endIdx);
          setDragSelection(null);
          if (
            pixelDelta >= 12 &&
            hiIdx > loIdx &&
            onSelectDateRange &&
            enrichedTimeline[loIdx] &&
            enrichedTimeline[hiIdx]
          ) {
            onSelectDateRange(enrichedTimeline[loIdx].date, enrichedTimeline[hiIdx].date);
          }
        }}
        onPointerLeave={() => {
          if (dragSelection) setDragSelection(null);
        }}
      >
        <div
          ref={chartContainerRef}
          style={{
            width: '100%',
            height: `${computedChartHeight}px`,
          }}
        />
        {dragSelection && Math.abs(dragSelection.currentX - dragSelection.startX) >= 8 && (
          <div
            className="pointer-events-none absolute top-[34px] bottom-[28px] bg-teal-500/15 border-x-2 border-teal-500 z-20 flex items-start justify-center pt-2"
            style={{
              left: `${Math.min(dragSelection.startX, dragSelection.currentX)}px`,
              width: `${Math.abs(dragSelection.currentX - dragSelection.startX)}px`,
            }}
          >
            <span className="px-2 py-0.5 rounded-md bg-[#101B15]/95 text-teal-300 text-2xs font-mono font-bold whitespace-nowrap shadow-sm">
              {
                enrichedTimeline[Math.min(dragSelection.startIdx, dragSelection.endIdx)]
                  ?.date
              }{' '}
              →{' '}
              {
                enrichedTimeline[Math.max(dragSelection.startIdx, dragSelection.endIdx)]
                  ?.date
              }
            </span>
          </div>
        )}
      </div>

      {selectedDay && (
        <div className="mt-3 pt-3 border-t border-emerald-900/15 dark:border-emerald-400/15 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-slate-600 dark:text-slate-300">
              Selected Date: <strong className="text-slate-900 dark:text-slate-100">{selectedDay.date}</strong>
            </span>
            <span className="text-[#0F766E] dark:text-[#2DD4BF] font-semibold">CTL {selectedDay.ctl.toFixed(1)}</span>
            <span className="text-[#BE123C] dark:text-[#FB7185] font-semibold">ATL {selectedDay.atl.toFixed(1)}</span>
            <span className="text-[#B45309] dark:text-amber-300 font-semibold">
              TSB {selectedDay.tsb > 0 ? '+' : ''}
              {selectedDay.tsb.toFixed(1)}
            </span>
            <span className="text-[#047857] dark:text-emerald-400 font-semibold">
              Ramp {selectedDay.rampRate >= 0 ? '+' : ''}
              {selectedDay.rampRate.toFixed(1)}/wk
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedDay.activities.length > 0 ? (
              selectedDay.activities.map((act) => {
                const focus = classifyActivityGarminLoad(act, {
                  ftp: selectedDay.eftp || 300,
                });
                return (
                  <button
                    key={act.id}
                    type="button"
                    onClick={() => onSelectActivity && onSelectActivity(act)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded liquid-glass-subtle hover:bg-emerald-950/5 dark:hover:bg-emerald-400/10 border text-emerald-950 dark:text-emerald-50 text-2xs transition-colors"
                    style={{ borderColor: `${focus.solidColor}66` }}
                  >
                    <Zap className="w-3 h-3" style={{ color: focus.solidColor }} />
                    <span>
                      Inspect {act.name} ({Math.round(act.trainingLoad || 0)} TSS ·{' '}
                      <strong style={{ color: focus.solidColor }}>{focus.label}</strong>)
                    </span>
                  </button>
                );
              })
            ) : (
              <span className="text-slate-600 dark:text-slate-400 text-2xs">Rest / Recovery Day (0 TSS)</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const EChartsPMCDashboard = React.memo(EChartsPMCDashboardInner);
export default EChartsPMCDashboard;
