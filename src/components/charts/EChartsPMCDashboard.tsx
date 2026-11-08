import React, { useEffect, useRef, useMemo, useState } from 'react';
import * as echarts from 'echarts';
import { UnifiedActivity, UnifiedWellnessDay } from '../../types';
import { TrendingUp, Zap } from "../icons/PhosphorIcons";

export type GarminLoadFocus = 'LOW_AEROBIC' | 'HIGH_AEROBIC' | 'ANAEROBIC';

export interface GarminLoadFocusMeta {
  type: GarminLoadFocus;
  label: 'Low Aerobic' | 'High Aerobic' | 'Anaerobic';
  shortLabel: 'Low Aer' | 'High Aer' | 'Anaerobic';
  barColor: string;
  solidColor: string;
  badgeBg: string;
}

export const GARMIN_LOAD_FOCUS_META: Record<GarminLoadFocus, GarminLoadFocusMeta> = {
  LOW_AEROBIC: {
    type: 'LOW_AEROBIC',
    label: 'Low Aerobic',
    shortLabel: 'Low Aer',
    barColor: 'rgba(56, 189, 248, 0.72)',
    solidColor: '#38bdf8',
    badgeBg: 'rgba(56, 189, 248, 0.16)',
  },
  HIGH_AEROBIC: {
    type: 'HIGH_AEROBIC',
    label: 'High Aerobic',
    shortLabel: 'High Aer',
    barColor: 'rgba(249, 115, 22, 0.80)',
    solidColor: '#f97316',
    badgeBg: 'rgba(249, 115, 22, 0.18)',
  },
  ANAEROBIC: {
    type: 'ANAEROBIC',
    label: 'Anaerobic',
    shortLabel: 'Anaerobic',
    barColor: 'rgba(217, 70, 239, 0.86)',
    solidColor: '#d946ef',
    badgeBg: 'rgba(217, 70, 239, 0.18)',
  },
};

/**
 * Classifies a day's workouts into Garmin's Training Load Focus jargon:
 * - Low Aerobic (Z1/Z2 Recovery, Base, Endurance)
 * - High Aerobic (Z3/Z4 Tempo, Sweet Spot, Threshold, Cruise Intervals)
 * - Anaerobic (Z5–Z7 VO2max, Anaerobic Capacity, Track Repeats, Sprints, Races, HIIT)
 */
export function classifyGarminLoadType(
  activities: UnifiedActivity[] = [],
  dailyLoad = 0,
  maxHr = 0
): GarminLoadFocusMeta {
  if (activities.length > 0) {
    // Pick the primary (highest training load) activity of the day, or inspect combined zones
    const sorted = [...activities].sort(
      (a, b) => (b.trainingLoad || 0) - (a.trainingLoad || 0)
    );
    const primary = sorted[0];
    const combinedNames = activities.map((a) => a.name || '').join(' ');
    const maxIf = Math.max(
      ...activities.map((a) => a.intensityFactor || 0)
    );
    const peakHr = Math.max(
      maxHr,
      ...activities.map((a) => a.maxHr || 0)
    );

    // Check high-intensity zone share if power or HR zones exist
    const pwrZones = primary.zoneSecs?.power || [];
    const hrZones = primary.zoneSecs?.hr || [];
    const totalPwrSecs = pwrZones.reduce((s, v) => s + v, 0);
    const totalHrSecs = hrZones.reduce((s, v) => s + v, 0);

    const z5PlusPwrShare =
      totalPwrSecs > 0
        ? ((pwrZones[4] || 0) + (pwrZones[5] || 0) + (pwrZones[6] || 0)) / totalPwrSecs
        : 0;
    const z5PlusHrShare =
      totalHrSecs > 0
        ? ((hrZones[4] || 0) + (hrZones[5] || 0) + (hrZones[6] || 0)) / totalHrSecs
        : 0;
    const z3z4PwrShare =
      totalPwrSecs > 0
        ? ((pwrZones[2] || 0) + (pwrZones[3] || 0)) / totalPwrSecs
        : 0;
    const z3z4HrShare =
      totalHrSecs > 0
        ? ((hrZones[2] || 0) + (hrZones[3] || 0)) / totalHrSecs
        : 0;

    // 1. Anaerobic check
    if (
      /anaerobic|sprint|track|crit|hiit|zwift race|race|vo2|microburst|tabata|30\/30|40\/20|attack|opener|1k |800m|400m|mile/i.test(
        combinedNames
      ) ||
      maxIf >= 0.95 ||
      z5PlusPwrShare >= 0.16 ||
      z5PlusHrShare >= 0.20 ||
      (primary.sportCategory === 'Strength' && (primary.avgHr || 0) >= 145)
    ) {
      return GARMIN_LOAD_FOCUS_META.ANAEROBIC;
    }

    // 2. High Aerobic check (Tempo, Sweet Spot, Threshold)
    if (
      /tempo|sweet spot|threshold|ss|cruise|lt|lactate|progression|over-under|climb|half marathon|marathon|fast|group ride|build|interval/i.test(
        combinedNames
      ) ||
      maxIf >= 0.78 ||
      z3z4PwrShare >= 0.25 ||
      z3z4HrShare >= 0.30 ||
      peakHr >= 170 ||
      (primary.avgHr || 0) >= 150
    ) {
      return GARMIN_LOAD_FOCUS_META.HIGH_AEROBIC;
    }

    // 3. Otherwise Low Aerobic (Base, Z1, Z2, Recovery, Endurance)
    return GARMIN_LOAD_FOCUS_META.LOW_AEROBIC;
  }

  // Fallback when only dailyLoad / maxHr are present on a historical wellness record
  if (maxHr >= 178 || dailyLoad >= 135) {
    return GARMIN_LOAD_FOCUS_META.ANAEROBIC;
  }
  if (maxHr >= 156 || dailyLoad >= 75) {
    return GARMIN_LOAD_FOCUS_META.HIGH_AEROBIC;
  }
  return GARMIN_LOAD_FOCUS_META.LOW_AEROBIC;
}

export interface PMCDayPoint {
  date: string;
  ctl: number;
  atl: number;
  tsb: number;
  tss: number;
  eftp: number;
  rampRate: number;
  activities: UnifiedActivity[];
  wellness?: UnifiedWellnessDay;
}

export interface EChartsPMCDashboardProps {
  timeline: PMCDayPoint[];
  onSelectActivity?: (activity: UnifiedActivity) => void;
  onSelectDate?: (date: string) => void;
  height?: number;
}

export const EChartsPMCDashboard: React.FC<EChartsPMCDashboardProps> = ({
  timeline,
  onSelectActivity,
  onSelectDate,
  height = 540,
}) => {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const [showEftpOverlay, setShowEftpOverlay] = useState<boolean>(true);
  const [showTssBars, setShowTssBars] = useState<boolean>(true);
  const [showRampSubplot, setShowRampSubplot] = useState<boolean>(true);
  const [selectedDay, setSelectedDay] = useState<PMCDayPoint | null>(null);

  // Precompute Garmin Load Focus and accurate 7d Ramp Rate for every day in timeline
  const enrichedTimeline = useMemo(() => {
    return timeline.map((pt, idx) => {
      const prev7 = idx >= 7 ? timeline[idx - 7] : timeline[0];
      const computedRamp =
        typeof pt.rampRate === 'number' && pt.rampRate !== 0
          ? Number(pt.rampRate.toFixed(1))
          : Number((pt.ctl - (prev7?.ctl ?? pt.ctl)).toFixed(1));
      const garminFocus = classifyGarminLoadType(
        pt.activities,
        pt.tss,
        (pt.wellness as any)?.maxHr || 0
      );
      return {
        ...pt,
        rampRate: computedRamp,
        garminFocus,
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
    const tssData = enrichedTimeline.map((d) => ({
      value: Math.round(d.tss),
      itemStyle: {
        color: d.tss > 0 ? d.garminFocus.barColor : 'rgba(148, 163, 184, 0.15)',
        borderRadius: [2, 2, 0, 0],
      },
    }));
    const eftpData = enrichedTimeline.map((d) => Math.round(d.eftp));

    const activeXAxisIndices = showRampSubplot ? [0, 1, 2] : [0, 1];

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      animation: true,
      animationDuration: 350,
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          link: [{ xAxisIndex: 'all' }],
          lineStyle: {
            color: 'rgba(56, 189, 248, 0.55)',
            width: 1,
            type: 'dashed',
          },
        },
        backgroundColor: 'rgba(9, 13, 22, 0.96)',
        borderColor: 'rgba(56, 189, 248, 0.35)',
        borderWidth: 1,
        padding: [10, 14],
        textStyle: {
          color: '#e2e8f0',
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
                  ? '<span style="color:#94a3b8">Grey Zone (-10 to +5)</span>'
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
            pt.tss > 0
              ? `<span style="color:${pt.garminFocus.solidColor};font-weight:700;">${Math.round(pt.tss)} TSS (${pt.garminFocus.label})</span>`
              : `<span style="color:#94a3b8;">0 TSS (Rest)</span>`;

          const actsHtml =
            pt.activities && pt.activities.length > 0
              ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.1);">
                  <div style="font-size:10px;color:#38bdf8;margin-bottom:2px;">WORKOUTS (${pt.activities.length}) — Click point to inspect</div>
                  ${pt.activities
                    .slice(0, 3)
                    .map((a) => {
                      const actFocus = classifyGarminLoadType([a], a.trainingLoad, a.maxHr);
                      return `<div style="font-size:10px;color:#cbd5e1;">• ${a.name} <span style="color:${actFocus.solidColor};">(${Math.round(a.trainingLoad || 0)} TSS · ${actFocus.shortLabel})</span></div>`;
                    })
                    .join('')}
                </div>`
              : '';

          return `
            <div style="min-width:230px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:4px;">
                <strong style="color:#f8fafc;font-size:12px;">${pt.date}</strong>
                <span style="font-size:10px;color:${rampColor};font-weight:700;">Ramp ${pt.rampRate >= 0 ? '+' : ''}${pt.rampRate.toFixed(1)} CTL/wk</span>
              </div>
              <div style="display:grid;grid-template-columns:1fr auto;gap:3px 12px;font-size:11px;">
                <span style="color:#38bdf8;">● Fitness (CTL 42d)</span>
                <strong style="color:#38bdf8;text-align:right;">${pt.ctl.toFixed(1)}</strong>
                <span style="color:#c084fc;">● Fatigue (ATL 7d)</span>
                <strong style="color:#c084fc;text-align:right;">${pt.atl.toFixed(1)}</strong>
                <span style="color:#f59e0b;">● Form (TSB)</span>
                <strong style="text-align:right;color:${pt.tsb >= 0 ? '#38bdf8' : pt.tsb >= -30 ? '#10b981' : '#f43f5e'};">${pt.tsb > 0 ? '+' : ''}${pt.tsb.toFixed(1)}</strong>
                <span style="color:${rampColor};">● 7d Ramp Rate</span>
                <strong style="text-align:right;color:${rampColor};">${pt.rampRate >= 0 ? '+' : ''}${pt.rampRate.toFixed(1)} /wk</strong>
                <span style="color:#cbd5e1;">● Daily Load</span>
                <strong style="text-align:right;">${loadFocusHtml}</strong>
                <span style="color:#10b981;">● Modeled eFTP</span>
                <strong style="color:#10b981;text-align:right;">${Math.round(pt.eftp)} W</strong>
              </div>
              <div style="margin-top:5px;font-size:10px;">Form Zone: ${zoneLabel}</div>
              ${actsHtml}
            </div>
          `;
        },
      },
      axisPointer: {
        link: [{ xAxisIndex: 'all' }],
      },
      grid: showRampSubplot
        ? [
            {
              left: 52,
              right: 54,
              top: 20,
              height: '41%',
            },
            {
              left: 52,
              right: 54,
              top: '47%',
              height: '19%',
            },
            {
              left: 52,
              right: 54,
              top: '71%',
              height: '17%',
            },
          ]
        : [
            {
              left: 52,
              right: 54,
              top: 26,
              height: '52%',
            },
            {
              left: 52,
              right: 54,
              top: '64%',
              height: '23%',
            },
          ],
      xAxis: [
        {
          type: 'category',
          gridIndex: 0,
          data: dates,
          boundaryGap: false,
          axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.2)' } },
          axisLabel: { show: false },
          axisTick: { show: false },
        },
        {
          type: 'category',
          gridIndex: 1,
          data: dates,
          boundaryGap: false,
          axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.25)' } },
          axisLabel: showRampSubplot
            ? { show: false }
            : {
                color: '#94a3b8',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 10,
              },
          axisTick: { show: !showRampSubplot, lineStyle: { color: 'rgba(148, 163, 184, 0.2)' } },
        },
        ...(showRampSubplot
          ? [
              {
                type: 'category' as const,
                gridIndex: 2,
                data: dates,
                boundaryGap: false,
                axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.25)' } },
                axisLabel: {
                  color: '#94a3b8',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 10,
                },
                axisTick: { lineStyle: { color: 'rgba(148, 163, 184, 0.2)' } },
              },
            ]
          : []),
      ],
      yAxis: [
        {
          type: 'value',
          gridIndex: 0,
          name: 'CTL / ATL',
          nameTextStyle: {
            color: '#38bdf8',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 10,
            padding: [0, 0, 0, 8],
          },
          splitLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.08)' } },
          axisLabel: {
            color: '#94a3b8',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 10,
          },
        },
        {
          type: 'value',
          gridIndex: 0,
          name: showEftpOverlay ? 'eFTP (W)' : 'TSS',
          position: 'right',
          min: (val) => Math.max(0, Math.floor(val.min * 0.85)),
          nameTextStyle: {
            color: '#10b981',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 10,
          },
          splitLine: { show: false },
          axisLabel: {
            color: '#10b981',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 10,
          },
        },
        {
          type: 'value',
          gridIndex: 1,
          name: 'Form (TSB)',
          nameTextStyle: {
            color: '#f59e0b',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 10,
          },
          splitLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.08)' } },
          axisLabel: {
            color: '#94a3b8',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 10,
          },
        },
        ...(showRampSubplot
          ? [
              {
                type: 'value' as const,
                gridIndex: 2,
                name: 'Ramp (/wk)',
                nameTextStyle: {
                  color: '#10b981',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 10,
                },
                splitLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.08)' } },
                axisLabel: {
                  color: '#94a3b8',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 10,
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
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
        },
        {
          type: 'slider',
          xAxisIndex: activeXAxisIndices,
          bottom: 6,
          height: 20,
          borderColor: 'rgba(56, 189, 248, 0.2)',
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          fillerColor: 'rgba(56, 189, 248, 0.16)',
          handleStyle: {
            color: '#38bdf8',
            borderColor: '#0284c7',
          },
          textStyle: {
            color: '#94a3b8',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 9,
          },
        },
      ],
      series: [
        ...(showTssBars
          ? [
              {
                name: 'Daily Load (Garmin Focus)',
                type: 'bar' as const,
                xAxisIndex: 0,
                yAxisIndex: 0,
                data: tssData,
                barMaxWidth: 8,
                emphasis: {
                  itemStyle: {
                    opacity: 1,
                  },
                },
              },
            ]
          : []),
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
            color: '#38bdf8',
          },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(56, 189, 248, 0.35)' },
              { offset: 1, color: 'rgba(56, 189, 248, 0.02)' },
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
            color: '#c084fc',
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
                  color: '#10b981',
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
              color: 'rgba(148, 163, 184, 0.25)',
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
                    color: 'rgba(148, 163, 184, 0.25)',
                  },
                  data: [{ yAxis: 0 }, { yAxis: 5 }],
                },
              },
            ]
          : []),
      ],
    };

    chart.setOption(option, true);

    chart.off('click');
    chart.on('click', (params: any) => {
      const idx = params?.dataIndex;
      if (typeof idx === 'number' && enrichedTimeline[idx]) {
        const day = enrichedTimeline[idx];
        setSelectedDay(day);
        if (onSelectDate) onSelectDate(day.date);
        if (day.activities.length === 1 && onSelectActivity) {
          onSelectActivity(day.activities[0]);
        }
      }
    });
  }, [
    enrichedTimeline,
    showEftpOverlay,
    showTssBars,
    showRampSubplot,
    onSelectActivity,
    onSelectDate,
  ]);

  return (
    <div className="bg-slate-950/85 border border-slate-800/80 rounded-xl p-4 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 pb-2.5 border-b border-slate-800/80">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-[10px] font-mono uppercase tracking-wider text-cyan-300">
            <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
            Interactive Fitness, Form &amp; Ramp Chart
          </span>
          <span className="text-[11px] font-mono text-slate-400">
            CTL <strong className="text-cyan-400">{summaryMetrics.latestCtl.toFixed(1)}</strong> · ATL{' '}
            <strong className="text-purple-400">{summaryMetrics.latestAtl.toFixed(1)}</strong> · TSB{' '}
            <strong
              className={
                summaryMetrics.latestTsb >= 0
                  ? 'text-cyan-300'
                  : summaryMetrics.latestTsb >= -30
                    ? 'text-emerald-400'
                    : 'text-rose-400'
              }
            >
              {summaryMetrics.latestTsb > 0 ? '+' : ''}
              {summaryMetrics.latestTsb.toFixed(1)}
            </strong>{' '}
            · Ramp{' '}
            <strong
              className={
                summaryMetrics.latestRamp > 7
                  ? 'text-rose-400'
                  : summaryMetrics.latestRamp > 5
                    ? 'text-amber-400'
                    : summaryMetrics.latestRamp >= 0
                      ? 'text-emerald-400'
                      : 'text-sky-400'
              }
            >
              {summaryMetrics.latestRamp >= 0 ? '+' : ''}
              {summaryMetrics.latestRamp.toFixed(1)}/wk
            </strong>
          </span>

          {/* Garmin Daily Load Bar Color Legend */}
          {showTssBars && (
            <div className="flex items-center gap-1.5 pl-1 text-[10px] font-mono">
              <span className="text-slate-500">Load Bars:</span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                <span className="w-2 h-2 rounded-full bg-[#38bdf8]" />
                Low Aerobic
              </span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-300 border border-orange-500/30">
                <span className="w-2 h-2 rounded-full bg-[#f97316]" />
                High Aerobic
              </span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/30">
                <span className="w-2 h-2 rounded-full bg-[#d946ef]" />
                Anaerobic
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowTssBars((v) => !v)}
            className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase transition-colors border ${
              showTssBars
                ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            }`}
          >
            Load Focus Bars
          </button>
          <button
            type="button"
            onClick={() => setShowRampSubplot((v) => !v)}
            className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase transition-colors border ${
              showRampSubplot
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            }`}
          >
            Ramp Sub-Chart
          </button>
          <button
            type="button"
            onClick={() => setShowEftpOverlay((v) => !v)}
            className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase transition-colors border ${
              showEftpOverlay
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            }`}
          >
            eFTP Step Line
          </button>
        </div>
      </div>

      <div ref={chartContainerRef} style={{ width: '100%', height: `${showRampSubplot ? Math.max(520, height) : height}px` }} />

      {selectedDay && (
        <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-slate-400">
              Selected Date: <strong className="text-slate-100">{selectedDay.date}</strong>
            </span>
            <span className="text-cyan-400">CTL {selectedDay.ctl.toFixed(1)}</span>
            <span className="text-purple-400">ATL {selectedDay.atl.toFixed(1)}</span>
            <span className="text-amber-300">
              TSB {selectedDay.tsb > 0 ? '+' : ''}
              {selectedDay.tsb.toFixed(1)}
            </span>
            <span className="text-emerald-400">
              Ramp {selectedDay.rampRate >= 0 ? '+' : ''}
              {selectedDay.rampRate.toFixed(1)}/wk
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedDay.activities.length > 0 ? (
              selectedDay.activities.map((act) => {
                const focus = classifyGarminLoadType([act], act.trainingLoad, act.maxHr);
                return (
                  <button
                    key={act.id}
                    type="button"
                    onClick={() => onSelectActivity && onSelectActivity(act)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-200 text-[11px] transition-colors"
                  >
                    <Zap className="w-3 h-3 text-cyan-400" />
                    <span>
                      Inspect {act.name} ({Math.round(act.trainingLoad || 0)} TSS ·{' '}
                      <strong style={{ color: focus.solidColor }}>{focus.label}</strong>)
                    </span>
                  </button>
                );
              })
            ) : (
              <span className="text-slate-500 text-[11px]">Rest / Recovery Day (0 TSS)</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
