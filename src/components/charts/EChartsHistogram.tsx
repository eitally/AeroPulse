import React, { useEffect, useRef, useState } from 'react';
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
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : true
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const syncTheme = () => setIsDark(root.classList.contains('dark'));
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

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
    const tooltipBg = isDark ? 'rgba(15, 20, 28, 0.95)' : 'rgba(255, 253, 250, 0.96)';
    const tooltipText = isDark ? '#f8fafc' : '#0f172a';
    const axisLabelColor = isDark ? '#94a3b8' : '#475569';
    const xLabelColor = isDark ? '#cbd5e1' : '#334155';
    const axisLineColor = isDark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(15, 23, 42, 0.16)';
    const splitLineColor = isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(15, 23, 42, 0.08)';

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      animationDuration: 300,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: tooltipBg,
        borderColor: isDark ? 'rgba(56, 189, 248, 0.35)' : 'rgba(15, 23, 42, 0.15)',
        borderWidth: 1,
        textStyle: {
          color: tooltipText,
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
              <div style="font-weight:700;color:${tooltipText};margin-bottom:4px;">${b.zone} — ${b.label}</div>
              <div style="color:${b.color};">Actual: <strong>${b.pct.toFixed(1)}%</strong> (${formatSeconds(b.seconds)})</div>
              ${
                typeof b.expectedPct === 'number'
                  ? `<div style="color:${axisLabelColor};">Archetype Target: <strong>${b.expectedPct.toFixed(1)}%</strong></div>`
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
        axisLine: { lineStyle: { color: axisLineColor } },
        axisLabel: {
          color: xLabelColor,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 10,
        },
      },
      yAxis: {
        type: 'value',
        max: (val) => Math.min(100, Math.max(40, Math.ceil(val.max / 10) * 10 + 10)),
        splitLine: { lineStyle: { color: splitLineColor } },
        axisLabel: {
          color: axisLabelColor,
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
            color: xLabelColor,
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
                  color: tooltipText,
                  width: 1.5,
                  type: 'dashed' as const,
                },
                itemStyle: {
                  color: '#38bdf8',
                  borderColor: tooltipText,
                  borderWidth: 1,
                },
              },
            ]
          : []),
      ],
    };

    chart.setOption(option, true);
  }, [buckets, isDark]);

  return (
    <div className="rounded-xl liquid-glass-subtle p-3.5 border border-stone-200/80 dark:border-slate-800/80">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-mono uppercase tracking-wider text-slate-900 dark:text-slate-100 font-semibold">
          {title}
        </span>
        {subtitle && (
          <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
            {subtitle}
          </span>
        )}
      </div>
      <div ref={containerRef} style={{ width: '100%', height: `${height}px` }} />
    </div>
  );
};
