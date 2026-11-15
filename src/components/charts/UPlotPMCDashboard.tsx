import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
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

export interface UPlotPMCDashboardProps {
  timeline: PMCDayPoint[];
  onSelectActivity?: (activity: UnifiedActivity) => void;
  onSelectDate?: (date: string) => void;
  onSelectDateRange?: (startDate: string, endDate: string) => void;
  height?: number;
}

export type EChartsPMCDashboardProps = UPlotPMCDashboardProps;

const UPlotPMCDashboardInner: React.FC<UPlotPMCDashboardProps> = ({
  timeline,
  onSelectActivity,
  onSelectDate,
  onSelectDateRange,
  height: _height = 540,
}) => {
  const chartWrapperRef = useRef<HTMLDivElement | null>(null);
  const pane1Ref = useRef<HTMLDivElement | null>(null);
  const pane2Ref = useRef<HTMLDivElement | null>(null);
  const pane3Ref = useRef<HTMLDivElement | null>(null);

  const uplot1Ref = useRef<uPlot | null>(null);
  const uplot2Ref = useRef<uPlot | null>(null);
  const uplot3Ref = useRef<uPlot | null>(null);

  const [showEftpOverlay, setShowEftpOverlay] = useState<boolean>(true);
  const [showTssBars, setShowTssBars] = useState<boolean>(true);
  const [showRampSubplot, setShowRampSubplot] = useState<boolean>(true);
  const [selectedDay, setSelectedDay] = useState<PMCDayPoint | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

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

  // Keep callback refs stable
  const onSelectDateRef = useRef(onSelectDate);
  const onSelectActivityRef = useRef(onSelectActivity);
  useEffect(() => {
    onSelectDateRef.current = onSelectDate;
  }, [onSelectDate]);
  useEffect(() => {
    onSelectActivityRef.current = onSelectActivity;
  }, [onSelectActivity]);

  // Shared sync pub/sub key for synchronous crosshairs across all 3 uPlot panes
  const syncKey = useMemo(() => `pmc-uplot-sync-${Math.random().toString(36).slice(2, 8)}`, []);
  const syncObj = useMemo(() => uPlot.sync(syncKey), [syncKey]);

  // Build uPlot instances
  useEffect(() => {
    const pane1El = pane1Ref.current;
    const pane2El = pane2Ref.current;
    const pane3El = pane3Ref.current;
    const wrapper = chartWrapperRef.current;
    if (!pane1El || !pane2El || !wrapper || enrichedTimeline.length === 0) return;

    // Clean up previous plots
    uplot1Ref.current?.destroy();
    uplot2Ref.current?.destroy();
    uplot3Ref.current?.destroy();
    uplot1Ref.current = null;
    uplot2Ref.current = null;
    uplot3Ref.current = null;

    const width = Math.max(300, Math.floor(wrapper.getBoundingClientRect().width || 800));
    const themePalette = getThreshThemePalette(isDark);
    const axisColor = themePalette.axisLine;
    const gridColor = themePalette.splitLine;
    const ctlColor = themePalette.ctlCyan;
    const atlColor = themePalette.atlRose;
    const eftpColor = themePalette.tsbGreyAmber;
    const textMuted = themePalette.textMuted;

    const n = enrichedTimeline.length;
    const xIndices = Array.from({ length: n }, (_, i) => i);
    const ctlData = enrichedTimeline.map((d) => Math.round(d.ctl * 10) / 10);
    const atlData = enrichedTimeline.map((d) => Math.round(d.atl * 10) / 10);
    const eftpData = enrichedTimeline.map((d) => Math.round(d.eftp));
    const tsbData = enrichedTimeline.map((d) => Math.round(d.tsb * 10) / 10);
    const rampData = enrichedTimeline.map((d) => Math.round(d.rampRate * 10) / 10);

    const padLeft = 54;
    const padRight = 54;
    const sharedPadding: [number, number, number, number] = [8, padRight, 8, padLeft];

    const formatXAxisLabel = (_u: uPlot, splits: number[]) => {
      return splits.map((s) => {
        const idx = Math.round(s);
        const pt = enrichedTimeline[idx];
        if (!pt) return '';
        const parts = pt.date.split('-');
        return parts.length >= 3 ? `${parts[1]}/${parts[2]}` : pt.date;
      });
    };

    // Shared cursor config
    const createCursorOpts = (paneIdx: number): uPlot.Cursor => ({
      drag: { x: false, y: false },
      sync: {
        key: syncObj.key,
        setSeries: false,
      },
      points: {
        size: 6,
        width: 2,
      },
    });

    const handleCursorUpdate = (u: uPlot) => {
      const idx = u.cursor.idx;
      if (idx != null && idx >= 0 && idx < enrichedTimeline.length) {
        setHoveredIdx(idx);
        if (u.cursor.left != null && u.cursor.top != null) {
          const rect = u.root.getBoundingClientRect();
          const wrapRect = wrapper.getBoundingClientRect();
          setHoverPos({
            x: rect.left - wrapRect.left + u.cursor.left,
            y: rect.top - wrapRect.top + u.cursor.top,
          });
        }
      } else {
        setHoveredIdx(null);
        setHoverPos(null);
      }
    };

    // -------------------------------------------------------------
    // PANE 1: Main PMC (Fitness CTL, Fatigue ATL, eFTP, Stacked TSS)
    // -------------------------------------------------------------
    const opts1: uPlot.Options = {
      width,
      height: 270,
      padding: sharedPadding,
      legend: { show: false },
      cursor: createCursorOpts(0),
      scales: {
        x: {
          time: false,
          min: 0,
          max: Math.max(1, n - 1),
        },
        y: {
          auto: true,
          range: (_u, _min, max) => [0, Math.max(80, Math.ceil((max || 60) * 1.15))],
        },
        eftp: {
          auto: true,
          range: (_u, min, max) => [
            Math.max(0, Math.floor((min || 200) * 0.85)),
            Math.max(250, Math.ceil((max || 300) * 1.08)),
          ],
        },
      },
      axes: [
        {
          scale: 'x',
          show: false,
          stroke: axisColor,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: gridColor, width: 1 },
        },
        {
          scale: 'y',
          side: 3, // Left
          stroke: ctlColor,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: gridColor, width: 1 },
          size: padLeft,
          font: '11px JetBrains Mono, monospace',
          values: (_u, splits) => splits.map((v) => Math.round(v).toString()),
        },
        {
          scale: 'eftp',
          side: 1, // Right
          show: showEftpOverlay,
          stroke: eftpColor,
          grid: { show: false },
          ticks: { stroke: gridColor, width: 1 },
          size: padRight,
          font: '11px JetBrains Mono, monospace',
          values: (_u, splits) => splits.map((v) => `${Math.round(v)}W`),
        },
      ],
      series: [
        { label: 'Day' },
        {
          label: 'Fitness (CTL)',
          scale: 'y',
          stroke: ctlColor,
          width: 2.5,
          paths: uPlot.paths.spline ? uPlot.paths.spline() : undefined,
          fill: (u) => {
            const ctx = u.ctx;
            const grad = ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
            grad.addColorStop(0, isDark ? 'rgba(45, 212, 191, 0.28)' : 'rgba(13, 148, 136, 0.18)');
            grad.addColorStop(1, isDark ? 'rgba(45, 212, 191, 0.01)' : 'rgba(13, 148, 136, 0.01)');
            return grad;
          },
          spanGaps: true,
        },
        {
          label: 'Fatigue (ATL)',
          scale: 'y',
          stroke: atlColor,
          width: 2.0,
          paths: uPlot.paths.spline ? uPlot.paths.spline() : undefined,
          spanGaps: true,
        },
        {
          label: 'eFTP (W)',
          scale: 'eftp',
          stroke: eftpColor,
          width: 1.8,
          dash: [4, 4],
          paths: uPlot.paths.stepped ? uPlot.paths.stepped({ align: 1 }) : undefined,
          show: showEftpOverlay,
          spanGaps: true,
        },
      ],
      hooks: {
        setCursor: [handleCursorUpdate],
        draw: [
          (u) => {
            if (!showTssBars) return;
            const ctx = u.ctx;
            const y0 = u.valToPos(0, 'y', true);
            const plotW = u.bbox.width;
            const barW = Math.max(2, Math.min(9, (plotW / n) * 0.72));

            for (let i = 0; i < n; i++) {
              const pt = enrichedTimeline[i];
              if (!pt || pt.tss <= 0) continue;
              const xPos = u.valToPos(i, 'x', true);
              if (xPos < u.bbox.left - barW || xPos > u.bbox.left + u.bbox.width + barW) continue;

              const segs = pt.segments;
              const visualLoads = pt.visualLoads || segs.map((s) => s.load);
              let currentY = y0;

              for (let s = 0; s < segs.length; s++) {
                const seg = segs[s];
                const segLoad = visualLoads[s] || seg.load;
                if (segLoad <= 0) continue;
                const segH = Math.max(1, Math.abs(u.valToPos(segLoad, 'y', true) - y0));
                const isTopSeg = s === segs.length - 1;

                ctx.fillStyle = seg.focus.barColor;
                ctx.beginPath();
                if (isTopSeg && barW >= 4 && typeof ctx.roundRect === 'function') {
                  const r = Math.min(2, barW / 2);
                  ctx.roundRect(xPos - barW / 2, currentY - segH, barW, segH, [r, r, 0, 0]);
                } else {
                  ctx.rect(xPos - barW / 2, currentY - segH, barW, segH);
                }
                ctx.fill();
                currentY -= segH;
              }
            }
          },
        ],
      },
    };

    const inst1 = new uPlot(opts1, [xIndices, ctlData, atlData, eftpData], pane1El);
    uplot1Ref.current = inst1;

    // -------------------------------------------------------------
    // PANE 2: Form (TSB)
    // -------------------------------------------------------------
    const opts2: uPlot.Options = {
      width,
      height: 115,
      padding: sharedPadding,
      legend: { show: false },
      cursor: createCursorOpts(1),
      scales: {
        x: {
          time: false,
          min: 0,
          max: Math.max(1, n - 1),
        },
        tsb: {
          auto: true,
          range: (_u, min, max) => [
            Math.min(-35, Math.floor((min || 0) * 1.15)),
            Math.max(25, Math.ceil((max || 0) * 1.15)),
          ],
        },
      },
      axes: [
        {
          scale: 'x',
          show: !showRampSubplot,
          stroke: axisColor,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: gridColor, width: 1 },
          font: '11px JetBrains Mono, monospace',
          values: formatXAxisLabel,
        },
        {
          scale: 'tsb',
          side: 3, // Left
          stroke: '#f59e0b',
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: gridColor, width: 1 },
          size: padLeft,
          font: '11px JetBrains Mono, monospace',
          values: (_u, splits) => splits.map((v) => Math.round(v).toString()),
        },
        {
          scale: 'tsb',
          side: 1, // Right gutter placeholder to ensure exact horizontal plot alignment
          show: false,
          size: padRight,
        },
      ],
      series: [
        { label: 'Day' },
        {
          label: 'Form (TSB)',
          scale: 'tsb',
          show: false, // Rendered via hooks.draw for per-bar zone colors
        },
      ],
      hooks: {
        setCursor: [handleCursorUpdate],
        draw: [
          (u) => {
            const ctx = u.ctx;
            const y0 = u.valToPos(0, 'tsb', true);
            const plotW = u.bbox.width;
            const barW = Math.max(2, Math.min(9, (plotW / n) * 0.72));

            // Dashed reference lines at 0, -10, -30
            ctx.save();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = axisColor;
            ctx.lineWidth = 1;
            [0, -10, -30].forEach((refY) => {
              const yPos = u.valToPos(refY, 'tsb', true);
              ctx.beginPath();
              ctx.moveTo(u.bbox.left, yPos);
              ctx.lineTo(u.bbox.left + u.bbox.width, yPos);
              ctx.stroke();
            });
            ctx.restore();

            for (let i = 0; i < n; i++) {
              const pt = enrichedTimeline[i];
              if (!pt) continue;
              const xPos = u.valToPos(i, 'x', true);
              if (xPos < u.bbox.left - barW || xPos > u.bbox.left + u.bbox.width + barW) continue;

              const v = pt.tsb;
              const yVal = u.valToPos(v, 'tsb', true);
              let color = 'rgba(244, 63, 94, 0.88)';
              if (v > 15) color = 'rgba(245, 158, 11, 0.78)';
              else if (v >= 5) color = 'rgba(56, 189, 248, 0.82)';
              else if (v >= -10) color = 'rgba(148, 163, 184, 0.55)';
              else if (v >= -30) color = 'rgba(16, 185, 129, 0.82)';

              ctx.fillStyle = color;
              const topY = Math.min(y0, yVal);
              const h = Math.max(1, Math.abs(yVal - y0));
              ctx.fillRect(xPos - barW / 2, topY, barW, h);
            }
          },
        ],
      },
    };

    const inst2 = new uPlot(opts2, [xIndices, tsbData], pane2El);
    uplot2Ref.current = inst2;

    // -------------------------------------------------------------
    // PANE 3: 7-Day Ramp Rate Subplot (Toggleable)
    // -------------------------------------------------------------
    if (showRampSubplot && pane3El) {
      const opts3: uPlot.Options = {
        width,
        height: 95,
        padding: sharedPadding,
        legend: { show: false },
        cursor: createCursorOpts(2),
        scales: {
          x: {
            time: false,
            min: 0,
            max: Math.max(1, n - 1),
          },
          ramp: {
            auto: true,
            range: (_u, min, max) => [
              Math.min(-5, Math.floor((min || 0) * 1.2)),
              Math.max(10, Math.ceil((max || 0) * 1.2)),
            ],
          },
        },
        axes: [
          {
            scale: 'x',
            show: true,
            stroke: axisColor,
            grid: { stroke: gridColor, width: 1 },
            ticks: { stroke: gridColor, width: 1 },
            font: '11px JetBrains Mono, monospace',
            values: formatXAxisLabel,
          },
          {
            scale: 'ramp',
            side: 3, // Left
            stroke: '#10b981',
            grid: { stroke: gridColor, width: 1 },
            ticks: { stroke: gridColor, width: 1 },
            size: padLeft,
            font: '11px JetBrains Mono, monospace',
            values: (_u, splits) => splits.map((v) => Math.round(v).toString()),
          },
          {
            scale: 'ramp',
            side: 1, // Right placeholder
            show: false,
            size: padRight,
          },
        ],
        series: [
          { label: 'Day' },
          {
            label: 'Ramp Rate',
            scale: 'ramp',
            show: false,
          },
        ],
        hooks: {
          setCursor: [handleCursorUpdate],
          draw: [
            (u) => {
              const ctx = u.ctx;
              const y0 = u.valToPos(0, 'ramp', true);
              const plotW = u.bbox.width;
              const barW = Math.max(2, Math.min(8, (plotW / n) * 0.72));

              // Dashed reference lines at 0 and 5
              ctx.save();
              ctx.setLineDash([4, 4]);
              ctx.strokeStyle = axisColor;
              ctx.lineWidth = 1;
              [0, 5].forEach((refY) => {
                const yPos = u.valToPos(refY, 'ramp', true);
                ctx.beginPath();
                ctx.moveTo(u.bbox.left, yPos);
                ctx.lineTo(u.bbox.left + u.bbox.width, yPos);
                ctx.stroke();
              });
              ctx.restore();

              for (let i = 0; i < n; i++) {
                const pt = enrichedTimeline[i];
                if (!pt) continue;
                const xPos = u.valToPos(i, 'x', true);
                if (xPos < u.bbox.left - barW || xPos > u.bbox.left + u.bbox.width + barW) continue;

                const v = pt.rampRate;
                const yVal = u.valToPos(v, 'ramp', true);
                let color = 'rgba(56, 189, 248, 0.72)'; // Recovery / taper (< 0/wk)
                if (v > 7) color = 'rgba(244, 63, 94, 0.88)'; // Excessive ramp (> +7/wk)
                else if (v > 5) color = 'rgba(245, 158, 11, 0.85)'; // Heavy build (+5 to +7/wk)
                else if (v >= 0) color = 'rgba(16, 185, 129, 0.82)'; // Optimal productive ramp (0 to +5/wk)

                ctx.fillStyle = color;
                const topY = Math.min(y0, yVal);
                const h = Math.max(1, Math.abs(yVal - y0));
                ctx.fillRect(xPos - barW / 2, topY, barW, h);
              }
            },
          ],
        },
      };

      const inst3 = new uPlot(opts3, [xIndices, rampData], pane3El);
      uplot3Ref.current = inst3;
    }

    // Responsive resize observer
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const nextWidth = Math.floor(entry.contentRect.width);
        if (nextWidth > 120) {
          uplot1Ref.current?.setSize({ width: nextWidth, height: 270 });
          uplot2Ref.current?.setSize({ width: nextWidth, height: 115 });
          uplot3Ref.current?.setSize({ width: nextWidth, height: 95 });
        }
      }
    });
    ro.observe(wrapper);

    return () => {
      ro.disconnect();
      inst1.destroy();
      inst2.destroy();
      uplot3Ref.current?.destroy();
      uplot1Ref.current = null;
      uplot2Ref.current = null;
      uplot3Ref.current = null;
    };
  }, [
    enrichedTimeline,
    showEftpOverlay,
    showTssBars,
    showRampSubplot,
    isDark,
    syncObj,
  ]);

  // Pointer drag selection (brush) and click selection
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || !chartWrapperRef.current || enrichedTimeline.length < 2) return;
      const rect = chartWrapperRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const padLeft = 54;
      const padRight = Math.max(padLeft + 20, rect.width - 54);
      if (x < padLeft || x > padRight) return;
      const ratio = Math.max(0, Math.min(1, (x - padLeft) / (padRight - padLeft)));
      const idx = Math.round(ratio * (enrichedTimeline.length - 1));
      setDragSelection({
        startX: x,
        currentX: x,
        startIdx: idx,
        endIdx: idx,
      });
    },
    [enrichedTimeline]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragSelection || !chartWrapperRef.current || enrichedTimeline.length < 2) return;
      const rect = chartWrapperRef.current.getBoundingClientRect();
      const padLeft = 54;
      const padRight = Math.max(padLeft + 20, rect.width - 54);
      const x = Math.max(padLeft, Math.min(padRight, e.clientX - rect.left));
      const ratio = Math.max(0, Math.min(1, (x - padLeft) / (padRight - padLeft)));
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
    },
    [dragSelection, enrichedTimeline]
  );

  const handlePointerUp = useCallback(() => {
    if (!dragSelection) return;
    const pixelDelta = Math.abs(dragSelection.currentX - dragSelection.startX);
    const loIdx = Math.min(dragSelection.startIdx, dragSelection.endIdx);
    const hiIdx = Math.max(dragSelection.startIdx, dragSelection.endIdx);
    setDragSelection(null);

    if (pixelDelta >= 12 && hiIdx > loIdx && onSelectDateRange && enrichedTimeline[loIdx] && enrichedTimeline[hiIdx]) {
      onSelectDateRange(enrichedTimeline[loIdx].date, enrichedTimeline[hiIdx].date);
    } else if (pixelDelta < 8) {
      // Direct click selection
      const day = enrichedTimeline[loIdx];
      if (day) {
        setSelectedDay(day);
        if (onSelectDateRef.current) onSelectDateRef.current(day.date);
        if (day.activities.length === 1 && onSelectActivityRef.current) {
          onSelectActivityRef.current(day.activities[0]);
        }
      }
    }
  }, [dragSelection, enrichedTimeline, onSelectDateRange]);

  const activeHoverDay = hoveredIdx != null ? enrichedTimeline[hoveredIdx] : null;

  return (
    <div className="rounded-2xl liquid-glass p-3 sm:p-4">
      {/* Header bar with summary vitals, Load Focus legend, and toggles */}
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

      {/* Synchronized Multi-Pane Chart Canvas Container */}
      <div
        ref={chartWrapperRef}
        className="relative select-none cursor-crosshair"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          if (dragSelection) setDragSelection(null);
          setHoveredIdx(null);
          setHoverPos(null);
        }}
      >
        {/* Pane Labels */}
        <div className="absolute top-1 left-3 text-2xs font-mono font-bold text-[#0F766E] dark:text-[#2DD4BF] z-10 pointer-events-none">
          CTL / ATL
        </div>
        {showEftpOverlay && (
          <div className="absolute top-1 right-3 text-2xs font-mono font-bold text-amber-600 dark:text-amber-400 z-10 pointer-events-none">
            eFTP (W)
          </div>
        )}

        {/* Pane 1: Main PMC */}
        <div ref={pane1Ref} className="w-full h-[270px]" />

        {/* Pane 2: Form (TSB) */}
        <div className="relative mt-1">
          <div className="absolute top-1 left-3 text-2xs font-mono font-bold text-amber-600 dark:text-amber-400 z-10 pointer-events-none">
            Form (TSB)
          </div>
          <div ref={pane2Ref} className="w-full h-[115px]" />
        </div>

        {/* Pane 3: Ramp Rate (Optional) */}
        {showRampSubplot && (
          <div className="relative mt-1">
            <div className="absolute top-1 left-3 text-2xs font-mono font-bold text-emerald-600 dark:text-emerald-400 z-10 pointer-events-none">
              Ramp (/wk)
            </div>
            <div ref={pane3Ref} className="w-full h-[95px]" />
          </div>
        )}

        {/* Drag Selection Overlay */}
        {dragSelection && Math.abs(dragSelection.currentX - dragSelection.startX) >= 8 && (
          <div
            className="pointer-events-none absolute top-[8px] bottom-[8px] bg-teal-500/15 border-x-2 border-teal-500 z-20 flex items-start justify-center pt-2"
            style={{
              left: `${Math.min(dragSelection.startX, dragSelection.currentX)}px`,
              width: `${Math.abs(dragSelection.currentX - dragSelection.startX)}px`,
            }}
          >
            <span className="px-2 py-0.5 rounded-md bg-[#101B15]/95 text-teal-300 text-2xs font-mono font-bold whitespace-nowrap shadow-sm">
              {enrichedTimeline[Math.min(dragSelection.startIdx, dragSelection.endIdx)]?.date} →{' '}
              {enrichedTimeline[Math.max(dragSelection.startIdx, dragSelection.endIdx)]?.date}
            </span>
          </div>
        )}

        {/* Rich Floating Tooltip */}
        {activeHoverDay && hoverPos && !dragSelection && (
          <div
            className="pointer-events-none absolute z-30 min-w-[245px] p-3 rounded-xl border shadow-xl text-2xs font-mono transition-opacity backdrop-blur-md bg-white/95 dark:bg-slate-900/95 text-slate-900 dark:text-slate-100 border-slate-200 dark:border-slate-800"
            style={{
              left: `${Math.min(
                hoverPos.x + 14,
                (chartWrapperRef.current?.getBoundingClientRect().width || 800) - 275
              )}px`,
              top: `${Math.min(Math.max(10, hoverPos.y - 40), 320)}px`,
            }}
          >
            {/* Header: Date + Ramp Rate */}
            <div className="flex justify-between items-center pb-1.5 mb-1.5 border-b border-slate-200 dark:border-slate-800">
              <strong className="text-xs">{activeHoverDay.date}</strong>
              <span
                className={`font-bold ${
                  activeHoverDay.rampRate > 7
                    ? 'text-rose-500'
                    : activeHoverDay.rampRate > 5
                      ? 'text-amber-500'
                      : activeHoverDay.rampRate >= 0
                        ? 'text-emerald-500'
                        : 'text-sky-500'
                }`}
              >
                Ramp {activeHoverDay.rampRate >= 0 ? '+' : ''}
                {activeHoverDay.rampRate.toFixed(1)} CTL/wk
              </span>
            </div>

            {/* Grid Metrics */}
            <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
              <span className="text-[#0F766E] dark:text-[#2DD4BF]">● Fitness (CTL 42d)</span>
              <strong className="text-[#0F766E] dark:text-[#2DD4BF] text-right">
                {activeHoverDay.ctl.toFixed(1)}
              </strong>

              <span className="text-[#BE123C] dark:text-[#FB7185]">● Fatigue (ATL 7d)</span>
              <strong className="text-[#BE123C] dark:text-[#FB7185] text-right">
                {activeHoverDay.atl.toFixed(1)}
              </strong>

              <span className="text-amber-600 dark:text-amber-400">● Form (TSB)</span>
              <strong
                className={`text-right ${
                  activeHoverDay.tsb >= 0
                    ? 'text-[#0F766E] dark:text-[#2DD4BF]'
                    : activeHoverDay.tsb >= -30
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {activeHoverDay.tsb > 0 ? '+' : ''}
                {activeHoverDay.tsb.toFixed(1)}
              </strong>

              <span className="text-slate-500 dark:text-slate-400">● 7d Ramp Rate</span>
              <strong className="text-right">
                {activeHoverDay.rampRate >= 0 ? '+' : ''}
                {activeHoverDay.rampRate.toFixed(1)} /wk
              </strong>

              <span className="text-slate-500 dark:text-slate-400">● Daily Load</span>
              <strong className="text-right">
                {activeHoverDay.segments.length > 1 ? (
                  <span>
                    {Math.round(activeHoverDay.tss)} TSS (
                    {activeHoverDay.segments
                      .map((seg) => `${Math.round(seg.load)} ${seg.focus.shortLabel}`)
                      .join(' + ')}
                    )
                  </span>
                ) : activeHoverDay.segments.length === 1 ? (
                  <span>
                    {Math.round(activeHoverDay.tss)} TSS ({activeHoverDay.segments[0].focus.label})
                  </span>
                ) : (
                  '0 TSS (Rest)'
                )}
              </strong>

              <span className="text-amber-600 dark:text-amber-400">● Modeled eFTP</span>
              <strong className="text-amber-600 dark:text-amber-400 text-right">
                {Math.round(activeHoverDay.eftp)} W
              </strong>
            </div>

            {/* Form Zone */}
            <div className="mt-1.5 pt-1.5 border-t border-slate-200 dark:border-slate-800">
              Form Zone:{' '}
              {activeHoverDay.tsb > 15 ? (
                <span className="text-amber-500 font-semibold">Transition (&gt; +15)</span>
              ) : activeHoverDay.tsb >= 5 ? (
                <span className="text-sky-500 font-semibold">Fresh / Race Ready (+5 to +15)</span>
              ) : activeHoverDay.tsb >= -10 ? (
                <span className="text-slate-400 font-semibold">Grey Zone (-10 to +5)</span>
              ) : activeHoverDay.tsb >= -30 ? (
                <span className="text-emerald-500 font-semibold">Optimal Overload (-10 to -30)</span>
              ) : (
                <span className="text-rose-500 font-semibold">High Risk (&lt; -30)</span>
              )}
            </div>

            {/* Stacked Workouts Breakdown */}
            {activeHoverDay.segments && activeHoverDay.segments.length > 0 && activeHoverDay.activities.length > 0 && (
              <div className="mt-2 pt-1.5 border-t border-slate-200 dark:border-slate-800">
                <div className="text-sky-500 font-bold mb-1">
                  STACKED WORKOUT LOAD ({activeHoverDay.segments.length})
                </div>
                {activeHoverDay.segments
                  .slice()
                  .reverse()
                  .map((seg, sIdx) => (
                    <div key={sIdx} className="flex justify-between items-center text-slate-500 dark:text-slate-400 py-0.5">
                      <span className="truncate max-w-[150px]">
                        <span style={{ color: seg.focus.solidColor }}>●</span> {seg.activityName}
                      </span>
                      <strong style={{ color: seg.focus.solidColor }}>
                        {Math.round(seg.load)} TSS ({seg.focus.shortLabel})
                      </strong>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Selected Day Footer with Inspection Buttons */}
      {selectedDay && (
        <div className="mt-3 pt-3 border-t border-emerald-900/15 dark:border-emerald-400/15 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-slate-600 dark:text-slate-300">
              Selected Date: <strong className="text-slate-900 dark:text-slate-100">{selectedDay.date}</strong>
            </span>
            <span className="text-[#0F766E] dark:text-[#2DD4BF] font-semibold">
              CTL {selectedDay.ctl.toFixed(1)}
            </span>
            <span className="text-[#BE123C] dark:text-[#FB7185] font-semibold">
              ATL {selectedDay.atl.toFixed(1)}
            </span>
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

export const UPlotPMCDashboard = React.memo(UPlotPMCDashboardInner);
export const EChartsPMCDashboard = UPlotPMCDashboard;
export default UPlotPMCDashboard;
