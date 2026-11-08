import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

export interface ZoneBucket {
  zone: string;
  label: string;
  pct: number;
  seconds: number;
  expectedPct?: number;
  color: string;
}

export interface EChartsHistogramProps {
  title: string;
  subtitle?: string;
  buckets: ZoneBucket[];
  height?: number;
}

function formatSeconds(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return `${m}m ${String(rem).padStart(2, '0')}s`;
}

export const EChartsHistogram: React.FC<EChartsHistogramProps> = ({
  title,
  subtitle,
  buckets,
  height = 220,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    chartRef.current = chart;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && chartRef.current) {
          chartRef.current.resize();
        }
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !buckets.length) return;

    const hasExpected = buckets.some((b) => typeof b.expectedPct === 'number');

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      animationDuration: 300,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: 'rgba(9, 13, 22, 0.95)',
        borderColor: 'rgba(56, 189, 248, 0.35)',
        borderWidth: 1,
        textStyle: {
          color: '#e2e8f0',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 11,
        },
        formatter: (params: any) => {
          const list = Array.isArray(params) ? params : [params];
          if (!list.length) return '';
          const idx = list[0].dataIndex;
          const b = buckets[idx];
          if (!b) return '';
          return `
            <div>
              <div style="font-weight:700;color:#f8fafc;margin-bottom:4px;">${b.zone} — ${b.label}</div>
              <div style="color:${b.color};">Actual: <strong>${b.pct.toFixed(1)}%</strong> (${formatSeconds(b.seconds)})</div>
              ${
                typeof b.expectedPct === 'number'
                  ? `<div style="color:#94a3b8;">Archetype Target: <strong>${b.expectedPct.toFixed(1)}%</strong></div>`
                  : ''
              }
            </div>
          `;
        },
      },
      grid: {
        left: 38,
        right: 16,
        top: 22,
        bottom: 26,
      },
      xAxis: {
        type: 'category',
        data: buckets.map((b) => b.zone),
        axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.25)' } },
        axisLabel: {
          color: '#cbd5e1',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 10,
        },
      },
      yAxis: {
        type: 'value',
        max: (val) => Math.min(100, Math.max(40, Math.ceil(val.max / 10) * 10 + 10)),
        splitLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.08)' } },
        axisLabel: {
          color: '#64748b',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 9,
          formatter: '{value}%',
        },
      },
      series: [
        {
          name: 'Actual Time-in-Zone',
          type: 'bar',
          data: buckets.map((b) => ({
            value: Number(b.pct.toFixed(1)),
            itemStyle: {
              color: b.color,
              borderRadius: [4, 4, 0, 0],
            },
          })),
          barMaxWidth: 28,
          label: {
            show: true,
            position: 'top',
            color: '#cbd5e1',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 9,
            formatter: (p: any) => (p.value > 0 ? `${p.value}%` : ''),
          },
        },
        ...(hasExpected
          ? [
              {
                name: 'Coach Archetype Target',
                type: 'line' as const,
                data: buckets.map((b) => Number((b.expectedPct || 0).toFixed(1))),
                symbol: 'circle',
                symbolSize: 6,
                lineStyle: {
                  color: '#f8fafc',
                  width: 1.5,
                  type: 'dashed' as const,
                },
                itemStyle: {
                  color: '#38bdf8',
                  borderColor: '#f8fafc',
                  borderWidth: 1,
                },
              },
            ]
          : []),
      ],
    };

    chart.setOption(option, true);
  }, [buckets]);

  return (
    <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-mono uppercase tracking-wider text-slate-300 font-semibold">
          {title}
        </span>
        {subtitle && <span className="text-[10px] font-mono text-slate-400">{subtitle}</span>}
      </div>
      <div ref={containerRef} style={{ width: '100%', height: `${height}px` }} />
    </div>
  );
};
