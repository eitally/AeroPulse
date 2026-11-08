import React, { useEffect, useRef, useMemo, useState } from 'react';
import * as echarts from 'echarts';
import { UnifiedActivity, UnifiedWellnessDay } from '../../types';
import { TrendingUp, Zap } from "../icons/PhosphorIcons";

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
  height = 460,
}) => {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const [showEftpOverlay, setShowEftpOverlay] = useState<boolean>(true);
  const [showTssBars, setShowTssBars] = useState<boolean>(true);
  const [selectedDay, setSelectedDay] = useState<PMCDayPoint | null>(null);

  const summaryMetrics = useMemo(() => {
    if (!timeline.length) {
      return { latestCtl: 0, latestAtl: 0, latestTsb: 0, peakCtl: 0, totalTss: 0 };
    }
    const latest = timeline[timeline.length - 1];
    let peakCtl = 0;
    let totalTss = 0;
    for (const pt of timeline) {
      if (pt.ctl > peakCtl) peakCtl = pt.ctl;
      totalTss += pt.tss || 0;
    }
    return {
      latestCtl: latest.ctl,
      latestAtl: latest.atl,
      latestTsb: latest.tsb,
      peakCtl: Math.round(peakCtl * 10) / 10,
      totalTss: Math.round(totalTss),
    };
  }, [timeline]);

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
    if (!chart || !timeline.length) return;

    const dates = timeline.map((d) => d.date);
    const ctlData = timeline.map((d) => Math.round(d.ctl * 10) / 10);
    const atlData = timeline.map((d) => Math.round(d.atl * 10) / 10);
    const tsbData = timeline.map((d) => Math.round(d.tsb * 10) / 10);
    const tssData = timeline.map((d) => Math.round(d.tss));
    const eftpData = timeline.map((d) => Math.round(d.eftp));

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
          const pt = timeline[idx];
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

          const actsHtml =
            pt.activities && pt.activities.length > 0
              ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.1);">
                  <div style="font-size:10px;color:#38bdf8;margin-bottom:2px;">WORKOUTS (${pt.activities.length}) — Click point to inspect</div>
                  ${pt.activities
                    .slice(0, 3)
                    .map(
                      (a) =>
                        `<div style="font-size:10px;color:#cbd5e1;">• ${a.name} <span style="color:#10b981;">(${Math.round(a.trainingLoad || 0)} TSS)</span></div>`
                    )
                    .join('')}
                </div>`
              : '';

          return `
            <div style="min-width:210px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:4px;">
                <strong style="color:#f8fafc;font-size:12px;">${pt.date}</strong>
                <span style="font-size:10px;color:#94a3b8;">Ramp ${pt.rampRate >= 0 ? '+' : ''}${pt.rampRate.toFixed(1)}/wk</span>
              </div>
              <div style="display:grid;grid-template-columns:1fr auto;gap:3px 12px;font-size:11px;">
                <span style="color:#38bdf8;">● Fitness (CTL 42d)</span>
                <strong style="color:#38bdf8;text-align:right;">${pt.ctl.toFixed(1)}</strong>
                <span style="color:#c084fc;">● Fatigue (ATL 7d)</span>
                <strong style="color:#c084fc;text-align:right;">${pt.atl.toFixed(1)}</strong>
                <span style="color:#f59e0b;">● Form (TSB)</span>
                <strong style="text-align:right;color:${pt.tsb >= 0 ? '#38bdf8' : pt.tsb >= -30 ? '#10b981' : '#f43f5e'};">${pt.tsb > 0 ? '+' : ''}${pt.tsb.toFixed(1)}</strong>
                <span style="color:#cbd5e1;">● Daily Load (TSS)</span>
                <strong style="color:#f8fafc;text-align:right;">${Math.round(pt.tss)}</strong>
                <span style="color:#10b981;">● Modeled eFTP</span>
                <strong style="color:#10b981;text-align:right;">${Math.round(pt.eftp)} W</strong>
              </div>
              <div style="margin-top:5px;font-size:10px;">Zone: ${zoneLabel}</div>
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
          axisLabel: {
            color: '#94a3b8',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 10,
          },
          axisTick: { lineStyle: { color: 'rgba(148, 163, 184, 0.2)' } },
        },
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
          name: 'TSB (Form)',
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
      ],
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: [0, 1],
          start: 0,
          end: 100,
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
        },
        {
          type: 'slider',
          xAxisIndex: [0, 1],
          bottom: 6,
          height: 22,
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
                name: 'Daily TSS',
                type: 'bar' as const,
                xAxisIndex: 0,
                yAxisIndex: 0,
                data: tssData,
                barMaxWidth: 8,
                itemStyle: {
                  color: 'rgba(250, 204, 21, 0.35)',
                  borderRadius: [2, 2, 0, 0],
                },
                emphasis: {
                  itemStyle: {
                    color: '#facc15',
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
              { offset: 0, color: 'rgba(56, 189, 248, 0.38)' },
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
      ],
    };

    chart.setOption(option, true);

    chart.off('click');
    chart.on('click', (params: any) => {
      const idx = params?.dataIndex;
      if (typeof idx === 'number' && timeline[idx]) {
        const day = timeline[idx];
        setSelectedDay(day);
        if (onSelectDate) onSelectDate(day.date);
        if (day.activities.length === 1 && onSelectActivity) {
          onSelectActivity(day.activities[0]);
        }
      }
    });
  }, [timeline, showEftpOverlay, showTssBars, onSelectActivity, onSelectDate]);

  return (
    <div className="bg-slate-950/85 border border-slate-800/80 rounded-xl p-4 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 pb-2.5 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-[10px] font-mono uppercase tracking-wider text-cyan-300">
            <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
            Interactive Fitness &amp; Form Chart
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
            · Peak CTL <strong className="text-slate-200">{summaryMetrics.peakCtl}</strong>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowTssBars((v) => !v)}
            className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase transition-colors border ${
              showTssBars
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            }`}
          >
            Daily TSS Bars
          </button>
          <button
            type="button"
            onClick={() => setShowEftpOverlay((v) => !v)}
            className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase transition-colors border ${
              showEftpOverlay
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            }`}
          >
            eFTP Step Line
          </button>
        </div>
      </div>

      <div ref={chartContainerRef} style={{ width: '100%', height: `${height}px` }} />

      {selectedDay && (
        <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <div className="flex items-center gap-3">
            <span className="text-slate-400">
              Selected Date: <strong className="text-slate-100">{selectedDay.date}</strong>
            </span>
            <span className="text-cyan-400">CTL {selectedDay.ctl.toFixed(1)}</span>
            <span className="text-purple-400">ATL {selectedDay.atl.toFixed(1)}</span>
            <span className="text-amber-300">
              TSB {selectedDay.tsb > 0 ? '+' : ''}
              {selectedDay.tsb.toFixed(1)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedDay.activities.length > 0 ? (
              selectedDay.activities.map((act) => (
                <button
                  key={act.id}
                  type="button"
                  onClick={() => onSelectActivity && onSelectActivity(act)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-200 text-[11px] transition-colors"
                >
                  <Zap className="w-3 h-3 text-cyan-400" />
                  Inspect {act.name} ({Math.round(act.trainingLoad || 0)} TSS)
                </button>
              ))
            ) : (
              <span className="text-slate-500 text-[11px]">Rest / Recovery Day (0 TSS)</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
