import React, { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import {
  Cpu,
  Maximize2,
  RotateCcw,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from "../icons/PhosphorIcons";
import type {
  ActivityInterval,
  ActivityStreamSet,
  DistanceUnit,
  SportCategory,
} from '../../types';
import { formatPace, formatStopwatch } from '../../utils/formatters';
import {
  computeGradeAdjustedPaceStream,
  computeNormalizedPower,
} from '../../physiology/powerPaceMetrics';
import type { PeakWindowStat } from '../../workers/activityProcessor.worker';

// Shared uPlot cursor sync registry for synchronized vertical crosshairs across multiple charts
const syncRegistry = new Map<string, uPlot.SyncPubSub>();
function getUPlotSync(key: string): uPlot.SyncPubSub {
  let sync = syncRegistry.get(key);
  if (!sync) {
    sync = uPlot.sync(key);
    syncRegistry.set(key, sync);
  }
  return sync;
}

export interface UPlotStreamChartProps {
  streams: ActivityStreamSet;
  sportCategory: SportCategory;
  distanceUnit: DistanceUnit;
  athleteWeightKg?: number;
  athleteFtp?: number;
  intervals?: ActivityInterval[];
  peakWindows?: PeakWindowStat[];
  syncKey?: string;
  height?: number;
  zoomRange?: [number, number] | null;
  zoomWindowSecs?: { startSec: number; endSec: number; nonce: number } | null;
  onZoomRangeChange?: (range: [number, number] | null) => void;
  onHoverIndex?: (idx: number | null) => void;
  onTriggerWorker1HzUpsample?: () => void;
  isWorkerProcessing?: boolean;
  workerMetrics?: {
    normalizedPower?: number;
    intensityFactor?: number;
    variabilityIndex?: number;
    tss?: number;
    trimpBanister?: number;
    trimpEdwards?: number;
    aerobicDecouplingPct?: number;
  } | null;
}

const UPlotStreamChartInner: React.FC<UPlotStreamChartProps> = ({
  streams,
  sportCategory,
  distanceUnit,
  athleteWeightKg = 70,
  intervals = [],
  peakWindows = [],
  syncKey = 'aeropulse-1hz-telemetry',
  height = 260,
  zoomRange = null,
  zoomWindowSecs = null,
  onZoomRangeChange,
  onHoverIndex,
  onTriggerWorker1HzUpsample,
  isWorkerProcessing = false,
  workerMetrics = null,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const plotInstanceRef = useRef<uPlot | null>(null);
  const readoutRef = useRef<HTMLDivElement | null>(null);

  // Keep latest callbacks in refs so uPlot hooks never trigger React re-instantiation
  const onHoverIndexRef = useRef(onHoverIndex);
  const onZoomRangeChangeRef = useRef(onZoomRangeChange);
  useEffect(() => {
    onHoverIndexRef.current = onHoverIndex;
  }, [onHoverIndex]);
  useEffect(() => {
    onZoomRangeChangeRef.current = onZoomRangeChange;
  }, [onZoomRangeChange]);

  const [showCadence, setShowCadence] = useState<boolean>(true);
  const [showAltitude, setShowAltitude] = useState<boolean>(true);
  const [smoothWindow, setSmoothWindow] = useState<1 | 3 | 10 | 30>(1);
  const [selectedIdxBounds, setSelectedIdxBounds] = useState<[number, number] | null>(null);

  // Prepare aligned uPlot columnar data: [time, primaryOutput, heartrate, cadence, altitude]
  const preparedData = useMemo(() => {
    const rawTime = streams.time || [];
    const len = rawTime.length;
    if (len === 0) {
      return {
        data: [[0], [0], [0], [0], [0]] as uPlot.AlignedData,
        hasWatts: false,
        hasHr: false,
        hasCadence: false,
        hasAltitude: false,
      };
    }

    const rawWatts = streams.watts;
    const rawVel = streams.velocitySmooth;
    const rawHr = streams.heartrate;
    const rawCad = streams.cadence;
    const rawAlt = streams.altitude;

    const hasWatts = Boolean(rawWatts && rawWatts.some((w) => w != null && w > 0));
    const hasHr = Boolean(rawHr && rawHr.some((h) => h != null && h > 40));
    const hasCadence = Boolean(rawCad && rawCad.some((c) => c != null && c > 20));
    const hasAltitude = Boolean(rawAlt && rawAlt.some((a) => a != null));

    const smoothArray = (arr: (number | null | undefined)[]): (number | null)[] => {
      if (smoothWindow <= 1) {
        return arr.map((v) => (v != null && Number.isFinite(v) ? v : null));
      }
      const out: (number | null)[] = new Array(len);
      let sum = 0;
      let count = 0;
      const half = Math.floor(smoothWindow / 2);

      for (let i = 0; i < len; i++) {
        sum = 0;
        count = 0;
        const start = Math.max(0, i - half);
        const end = Math.min(len - 1, i + half);
        for (let j = start; j <= end; j++) {
          const val = arr[j];
          if (val != null && Number.isFinite(val)) {
            sum += val;
            count++;
          }
        }
        out[i] = count > 0 ? Number((sum / count).toFixed(1)) : null;
      }
      return out;
    };

    const timeCol = new Float64Array(len);
    const primaryRaw: (number | null)[] = new Array(len);
    const hrRaw: (number | null)[] = new Array(len);
    const cadRaw: (number | null)[] = new Array(len);
    const altRaw: (number | null)[] = new Array(len);

    for (let i = 0; i < len; i++) {
      timeCol[i] = rawTime[i] ?? i;
      if (hasWatts) {
        primaryRaw[i] = rawWatts?.[i] ?? null;
      } else if (rawVel && rawVel[i] != null) {
        // Convert m/s to km/h or mph for continuous upward-is-faster chart curve
        const speedMult = distanceUnit === 'mi' ? 2.23694 : 3.6;
        primaryRaw[i] = Number((rawVel[i] * speedMult).toFixed(2));
      } else {
        primaryRaw[i] = null;
      }
      hrRaw[i] = rawHr?.[i] && rawHr[i] > 35 ? rawHr[i] : null;
      cadRaw[i] = rawCad?.[i] && rawCad[i] > 15 ? rawCad[i] : null;
      altRaw[i] = rawAlt?.[i] != null ? rawAlt[i] : null;
    }

    const data: uPlot.AlignedData = [
      timeCol,
      smoothArray(primaryRaw),
      smoothArray(hrRaw),
      smoothArray(cadRaw),
      smoothArray(altRaw),
    ];

    return {
      data,
      hasWatts,
      hasHr,
      hasCadence,
      hasAltitude,
    };
  }, [streams, distanceUnit, smoothWindow]);

  // Instantiate uPlot and wire zero-re-render ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const initialWidth = Math.max(320, container.clientWidth || 760);
    const sync = getUPlotSync(syncKey);
    const isDark = document.documentElement.classList.contains('dark');
    const axisStroke = isDark ? '#94A3B8' : '#475569';
    const gridStroke = isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(100, 116, 139, 0.14)';

    const primaryLabel = preparedData.hasWatts
      ? 'Power (W)'
      : `Speed (${distanceUnit === 'mi' ? 'mph' : 'km/h'})`;

    const opts: uPlot.Options = {
      width: initialWidth,
      height,
      padding: [12, 14, 0, 6],
      legend: {
        show: false,
      },
      cursor: {
        drag: {
          x: true,
          y: false,
          uni: 12,
        },
        sync: {
          key: sync.key,
          setSeries: true,
        },
        points: {
          size: 7,
          width: 2,
        },
      },
      scales: {
        x: {
          time: false,
        },
        y: {
          auto: true,
          range: (_u, min, max) => [Math.max(0, (min || 0) * 0.9), Math.max(100, (max || 300) * 1.06)],
        },
        hr: {
          auto: true,
          range: (_u, min, max) => [
            Math.max(50, (min || 90) - 8),
            Math.max(165, (max || 180) + 6),
          ],
        },
        cad: {
          auto: true,
          range: (_u, min, max) => [Math.max(30, (min || 60) - 10), Math.max(120, (max || 110) + 15)],
        },
        alt: {
          auto: true,
          range: (_u, min, max) => [(min || 0) - 5, Math.max((min || 0) + 30, (max || 100) * 1.25)],
        },
      },
      axes: [
        {
          scale: 'x',
          stroke: axisStroke,
          grid: { stroke: gridStroke, width: 1 },
          ticks: { stroke: gridStroke, width: 1 },
          font: '11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          values: (_u, splits) => splits.map((s) => formatStopwatch(Math.round(s))),
        },
        {
          scale: 'y',
          side: 3, // Left axis
          stroke: '#3B82F6',
          grid: { stroke: gridStroke, width: 1 },
          ticks: { stroke: gridStroke, width: 1 },
          size: 52,
          font: '11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          values: (_u, splits) =>
            splits.map((v) =>
              preparedData.hasWatts ? `${Math.round(v)}W` : `${v.toFixed(1)}`
            ),
        },
        {
          scale: 'hr',
          side: 1, // Right axis
          stroke: '#EF4444',
          grid: { show: false },
          ticks: { stroke: gridStroke, width: 1 },
          size: 48,
          font: '11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          values: (_u, splits) => splits.map((v) => `${Math.round(v)}♥`),
        },
      ],
      series: [
        {
          label: 'Elapsed',
        },
        {
          label: primaryLabel,
          scale: 'y',
          stroke: '#3B82F6',
          width: 1.85,
          fill: (u) => {
            const ctx = u.ctx;
            const grad = ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
            grad.addColorStop(0, 'rgba(59, 130, 246, 0.28)');
            grad.addColorStop(1, 'rgba(59, 130, 246, 0.02)');
            return grad;
          },
          spanGaps: true,
        },
        {
          label: 'Heart Rate (bpm)',
          scale: 'hr',
          stroke: '#EF4444',
          width: 1.75,
          spanGaps: true,
        },
        {
          label: 'Cadence (rpm/spm)',
          scale: 'cad',
          stroke: '#10B981',
          width: 1.35,
          dash: [4, 2],
          show: showCadence && preparedData.hasCadence,
          spanGaps: true,
        },
        {
          label: 'Elevation (m)',
          scale: 'alt',
          stroke: '#A855F7',
          width: 1.15,
          fill: 'rgba(168, 85, 247, 0.08)',
          show: showAltitude && preparedData.hasAltitude,
          spanGaps: true,
        },
      ],
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx ?? null;
            if (onHoverIndexRef.current) {
              onHoverIndexRef.current(idx);
            }
            // Direct DOM readout update (zero React state re-render during 60fps mouse move)
            if (readoutRef.current) {
              if (idx != null && u.data[0][idx] != null) {
                const tSec = Math.round(u.data[0][idx]);
                const pVal = u.data[1][idx];
                const hrVal = u.data[2][idx];
                const cadVal = u.data[3][idx];
                const altVal = u.data[4][idx];
                const rawVel = streams.velocitySmooth?.[idx];

                const parts: string[] = [`T ${formatStopwatch(tSec)}`];
                if (pVal != null) {
                  if (preparedData.hasWatts) {
                    const wkg = (pVal / Math.max(40, athleteWeightKg)).toFixed(2);
                    parts.push(`PWR ${Math.round(pVal)}W (${wkg} W/kg)`);
                  } else if (rawVel && rawVel > 0.4) {
                    parts.push(`PACE ${formatPace(Math.round(1000 / rawVel), distanceUnit)}`);
                  } else {
                    parts.push(`PWR ${pVal}`);
                  }
                }
                if (hrVal != null) parts.push(`HR ${Math.round(hrVal)} bpm`);
                if (cadVal != null) parts.push(`CAD ${Math.round(cadVal)} rpm`);
                if (altVal != null) parts.push(`ELEV ${Math.round(altVal)}m`);
                readoutRef.current.textContent = parts.join('   ·   ');
              } else {
                readoutRef.current.textContent =
                  'Hover or drag across 1Hz canvas to inspect telemetry & zoom';
              }
            }
          },
        ],
        setScale: [
          (u, scaleKey) => {
            if (scaleKey !== 'x') return;
            const minTime = u.scales.x.min;
            const maxTime = u.scales.x.max;
            const xArr = u.data[0];
            if (!xArr || xArr.length < 2 || minTime == null || maxTime == null) return;

            const fullMin = xArr[0];
            const fullMax = xArr[xArr.length - 1];
            if (minTime <= fullMin + 0.5 && maxTime >= fullMax - 0.5) {
              setSelectedIdxBounds(null);
              if (onZoomRangeChangeRef.current) onZoomRangeChangeRef.current(null);
              return;
            }
            // Binary search start/end index
            let sIdx = 0;
            let eIdx = xArr.length - 1;
            for (let i = 0; i < xArr.length; i++) {
              if (xArr[i] <= minTime) sIdx = i;
              if (xArr[i] <= maxTime) eIdx = i;
            }
            setSelectedIdxBounds([sIdx, eIdx]);
            if (onZoomRangeChangeRef.current) {
              onZoomRangeChangeRef.current([sIdx, eIdx]);
            }
          },
        ],
      },
    };

    const instance = new uPlot(opts, preparedData.data, container);
    plotInstanceRef.current = instance;

    // Zero-re-render ResizeObserver directly resizing uPlot canvas
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const nextWidth = Math.floor(entry.contentRect.width);
        if (nextWidth > 120 && plotInstanceRef.current) {
          plotInstanceRef.current.setSize({ width: nextWidth, height });
        }
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      instance.destroy();
      plotInstanceRef.current = null;
    };
  }, [
    preparedData,
    height,
    syncKey,
    showCadence,
    showAltitude,
    distanceUnit,
    athleteWeightKg,
    streams.velocitySmooth,
  ]);

  // Synchronize external zoomRange changes into uPlot scale without rebuilding chart
  useEffect(() => {
    const u = plotInstanceRef.current;
    const xArr = preparedData.data[0];
    if (!u || !xArr || xArr.length < 2) return;

    if (!zoomRange) {
      const fullMin = xArr[0];
      const fullMax = xArr[xArr.length - 1];
      if (u.scales.x.min !== fullMin || u.scales.x.max !== fullMax) {
        u.setScale('x', { min: fullMin, max: fullMax });
      }
    } else {
      const sIdx = Math.max(0, Math.min(xArr.length - 2, zoomRange[0]));
      const eIdx = Math.max(sIdx + 1, Math.min(xArr.length - 1, zoomRange[1]));
      const targetMin = xArr[sIdx];
      const targetMax = xArr[eIdx];
      if (
        Math.abs((u.scales.x.min ?? 0) - targetMin) > 1 ||
        Math.abs((u.scales.x.max ?? 0) - targetMax) > 1
      ) {
        u.setScale('x', { min: targetMin, max: targetMax });
      }
    }
  }, [zoomRange, preparedData.data]);

  // Synchronize external zoomWindowSecs (e.g. from 30s Post-Workout Debrief insight click)
  useEffect(() => {
    const u = plotInstanceRef.current;
    const xArr = preparedData.data[0];
    if (!u || !xArr || xArr.length < 2 || !zoomWindowSecs) return;

    const fullMin = xArr[0];
    const fullMax = xArr[xArr.length - 1];
    const targetMin = Math.max(fullMin, Math.min(fullMax - 1, zoomWindowSecs.startSec));
    const targetMax = Math.max(targetMin + 1, Math.min(fullMax, zoomWindowSecs.endSec));
    u.setScale('x', { min: targetMin, max: targetMax });
  }, [zoomWindowSecs, preparedData.data]);

  const activeBounds = zoomRange ?? selectedIdxBounds;
  const totalSamples = streams.time?.length || 0;
  const zStart = activeBounds ? Math.max(0, Math.min(totalSamples - 2, activeBounds[0])) : 0;
  const zEnd = activeBounds
    ? Math.max(zStart + 1, Math.min(totalSamples - 1, activeBounds[1]))
    : Math.max(0, totalSamples - 1);
  const isZoomed = totalSamples >= 2 && (zStart > 0 || zEnd < totalSamples - 1);

  // Live interval window metrics whenever user drags to zoom or clicks a Debrief insight
  const selectedWindowStats = useMemo(() => {
    if (!isZoomed || totalSamples < 2) return null;
    const tArr = streams.time || [];
    const startSec = Math.round(tArr[zStart] ?? zStart);
    const endSec = Math.round(tArr[zEnd] ?? zEnd);
    const durationSecs = Math.max(1, endSec - startSec);

    let avgWatts: number | null = null;
    let npWatts: number | null = null;
    if (streams.watts && streams.watts.length > zStart) {
      const sliceW = streams.watts.slice(zStart, zEnd + 1);
      const validW = sliceW.filter((v): v is number => Number.isFinite(v) && v >= 0);
      if (validW.length > 0) {
        avgWatts = Math.round(validW.reduce((s, v) => s + v, 0) / validW.length);
        const np = computeNormalizedPower(sliceW);
        npWatts = np != null && np > 0 ? Math.round(np) : avgWatts;
      }
    }

    let avgPaceSecsKm: number | null = null;
    let gapPaceSecsKm: number | null = null;
    if (streams.velocitySmooth && streams.velocitySmooth.length > zStart) {
      const sliceVel = streams.velocitySmooth.slice(zStart, zEnd + 1);
      const validVel = sliceVel.filter((v): v is number => Number.isFinite(v) && v > 0.5);
      if (validVel.length > 0) {
        const meanMps = validVel.reduce((s, v) => s + v, 0) / validVel.length;
        avgPaceSecsKm = Math.round(1000 / meanMps);
        const sliceAlt = streams.altitude?.slice(zStart, zEnd + 1);
        const sliceDist = streams.distance?.slice(zStart, zEnd + 1);
        const gapRes = computeGradeAdjustedPaceStream(sliceVel, sliceAlt, sliceDist);
        if (gapRes.avgGapSecsPerKm && gapRes.avgGapSecsPerKm > 0) {
          gapPaceSecsKm = Math.round(gapRes.avgGapSecsPerKm);
        }
      }
    }

    let avgHr: number | null = null;
    let maxHr: number | null = null;
    if (streams.heartrate && streams.heartrate.length > zStart) {
      const validHr = streams.heartrate
        .slice(zStart, zEnd + 1)
        .filter((h): h is number => Number.isFinite(h) && h > 35);
      if (validHr.length > 0) {
        avgHr = Math.round(validHr.reduce((s, v) => s + v, 0) / validHr.length);
        maxHr = Math.round(Math.max(...validHr));
      }
    }

    let avgCad: number | null = null;
    if (streams.cadence && streams.cadence.length > zStart) {
      const validCad = streams.cadence
        .slice(zStart, zEnd + 1)
        .filter((c): c is number => Number.isFinite(c) && c > 15);
      if (validCad.length > 0) {
        avgCad = Math.round(validCad.reduce((s, v) => s + v, 0) / validCad.length);
      }
    }

    let elevGainM = 0;
    let elevLossM = 0;
    if (streams.altitude && streams.altitude.length > zStart + 1) {
      for (let i = zStart + 1; i <= Math.min(zEnd, streams.altitude.length - 1); i++) {
        const prev = streams.altitude[i - 1];
        const curr = streams.altitude[i];
        if (prev != null && curr != null && Number.isFinite(prev) && Number.isFinite(curr)) {
          const diff = curr - prev;
          if (diff > 0.15) elevGainM += diff;
          else if (diff < -0.15) elevLossM += Math.abs(diff);
        }
      }
    }

    return {
      startSec,
      endSec,
      durationSecs,
      avgWatts,
      npWatts,
      avgPaceSecsKm,
      gapPaceSecsKm,
      avgHr,
      maxHr,
      avgCad,
      elevGainM: Math.round(elevGainM),
      elevLossM: Math.round(elevLossM),
    };
  }, [isZoomed, totalSamples, streams, zStart, zEnd]);

  const handleResetZoom = () => {
    setSelectedIdxBounds(null);
    const u = plotInstanceRef.current;
    const xArr = preparedData.data[0];
    if (u && xArr && xArr.length >= 2) {
      u.setScale('x', { min: xArr[0], max: xArr[xArr.length - 1] });
    }
    if (onZoomRangeChange) onZoomRangeChange(null);
  };

  const handleStepZoom = (factor: number) => {
    const u = plotInstanceRef.current;
    const xArr = preparedData.data[0];
    if (!u || !xArr || xArr.length < 4) return;
    const curMin = u.scales.x.min ?? xArr[0];
    const curMax = u.scales.x.max ?? xArr[xArr.length - 1];
    const center = (curMin + curMax) / 2;
    const halfSpan = Math.max(10, ((curMax - curMin) / 2) * factor);
    const nextMin = Math.max(xArr[0], center - halfSpan);
    const nextMax = Math.min(xArr[xArr.length - 1], center + halfSpan);
    u.setScale('x', { min: nextMin, max: nextMax });
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-950/60 p-4 space-y-3">
      {/* Top Header: 1Hz Telemetry Badge, Smoothing, Series Toggles & Recalculate Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30 text-2xs font-mono font-bold uppercase tracking-wider">
            <Maximize2 className="w-3 h-3" />
            1Hz Telemetry Stream ({totalSamples.toLocaleString()} pts)
          </span>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Second-by-Second Workout Telemetry ({sportCategory})
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Rolling Smoothing Window Selector */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg liquid-capsule-track text-2xs font-mono">
            {([1, 3, 10, 30] as const).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setSmoothWindow(w)}
                className={`px-2 py-0.5 rounded-md transition-colors ${
                  smoothWindow === w
                    ? 'liquid-capsule-active text-blue-600 dark:text-sky-300 font-bold'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
                title={`Apply ${w}s rolling smoothing filter`}
              >
                {w === 1 ? '1Hz Raw' : `${w}s Avg`}
              </button>
            ))}
          </div>

          {preparedData.hasCadence && (
            <button
              type="button"
              onClick={() => setShowCadence((p) => !p)}
              className={`px-2 py-1 rounded-lg text-2xs font-mono font-semibold border transition-colors ${
                showCadence
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35'
                  : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              Cadence
            </button>
          )}

          {preparedData.hasAltitude && (
            <button
              type="button"
              onClick={() => setShowAltitude((p) => !p)}
              className={`px-2 py-1 rounded-lg text-2xs font-mono font-semibold border transition-colors ${
                showAltitude
                  ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/35'
                  : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              Elevation
            </button>
          )}

          <button
            type="button"
            onClick={() => handleStepZoom(0.55)}
            aria-label="Zoom in stream chart"
            className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-1.5 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5 text-blue-500" />
          </button>
          <button
            type="button"
            onClick={() => handleStepZoom(1.6)}
            disabled={!isZoomed}
            aria-label="Zoom out stream chart"
            className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-1.5 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 text-slate-600 dark:text-slate-300"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          {isZoomed && (
            <button
              type="button"
              onClick={handleResetZoom}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#1C5436] hover:bg-[#16422A] dark:bg-[#C8FF00] dark:hover:bg-[#B5EB00] text-white dark:text-[#080A09] text-xs font-semibold transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset 100%</span>
            </button>
          )}

          {onTriggerWorker1HzUpsample && (
            <button
              type="button"
              onClick={onTriggerWorker1HzUpsample}
              disabled={isWorkerProcessing}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/35 text-indigo-700 dark:text-indigo-300 text-xs font-mono font-semibold transition-colors"
              title="Recalculate 1Hz power, heart rate, and load metrics"
            >
              <Cpu className={`w-3.5 h-3.5 ${isWorkerProcessing ? 'animate-spin' : ''}`} />
              <span>{isWorkerProcessing ? 'Calculating...' : 'Recalculate 1Hz Metrics'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Computed NP / TSS / TRIMP Telemetry Strip */}
      {workerMetrics && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-indigo-500/8 dark:bg-indigo-500/12 border border-indigo-500/25 px-3 py-1.5 text-2xs font-mono">
          <span className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-300 font-bold">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Stream Summary:</span>
          </span>
          <div className="flex flex-wrap items-center gap-3 text-slate-700 dark:text-slate-200">
            {workerMetrics.normalizedPower ? (
              <span>
                NP: <strong className="text-blue-500">{workerMetrics.normalizedPower}W</strong>
              </span>
            ) : null}
            {workerMetrics.intensityFactor ? (
              <span>
                IF: <strong>{workerMetrics.intensityFactor}</strong>
              </span>
            ) : null}
            {workerMetrics.variabilityIndex ? (
              <span>
                VI: <strong>{workerMetrics.variabilityIndex}</strong>
              </span>
            ) : null}
            {workerMetrics.tss ? (
              <span>
                TSS: <strong className="text-amber-500">{workerMetrics.tss}</strong>
              </span>
            ) : null}
            {workerMetrics.trimpBanister ? (
              <span>
                Banister TRIMP: <strong className="text-rose-500">{workerMetrics.trimpBanister}</strong>
              </span>
            ) : null}
            {workerMetrics.trimpEdwards ? (
              <span>
                Edwards TRIMP: <strong>{workerMetrics.trimpEdwards}</strong>
              </span>
            ) : null}
            {workerMetrics.aerobicDecouplingPct !== undefined ? (
              <span>
                Decoupling: <strong>{workerMetrics.aerobicDecouplingPct}%</strong>
              </span>
            ) : null}
          </div>
        </div>
      )}

      {/* Quick Peak Duration & Interval Zoom Pills */}
      {(peakWindows.length > 0 || intervals.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-2xs font-mono text-slate-500 mr-1">Peak &amp; Lap Zoom:</span>
          <button
            type="button"
            onClick={handleResetZoom}
            className={`px-2 py-0.5 rounded-md font-mono text-2xs border transition-colors ${
              !isZoomed
                ? 'bg-[#1C5436] border-[#1C5436] text-white dark:bg-[#C8FF00] dark:border-[#C8FF00] dark:text-[#080A09] font-semibold'
                : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            Full
          </button>
          {peakWindows.map((pk) => (
            <button
              key={pk.durationSecs}
              type="button"
              onClick={() =>
                onZoomRangeChange && onZoomRangeChange([pk.startIndex, pk.endIndex])
              }
              className="px-2 py-0.5 rounded-md font-mono text-2xs border border-blue-500/30 bg-blue-500/8 text-blue-600 dark:text-sky-300 hover:bg-blue-500/20 transition-colors"
            >
              {pk.label}
              {pk.peakWatts ? ` (${pk.peakWatts}W)` : ''}
            </button>
          ))}
          {intervals
            .filter((iv) => iv.type === 'WORK')
            .slice(0, 5)
            .map((iv, idx) => (
              <button
                key={iv.id}
                type="button"
                onClick={() => {
                  const u = plotInstanceRef.current;
                  if (u) {
                    u.setScale('x', {
                      min: Math.max(0, iv.startTimeSecs - 10),
                      max: iv.startTimeSecs + iv.durationSecs + 10,
                    });
                  }
                }}
                className="px-2 py-0.5 rounded-md font-mono text-2xs border border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 transition-colors"
              >
                Work #{idx + 1} ({formatStopwatch(iv.durationSecs)})
              </button>
            ))}
        </div>
      )}

      {/* Live Selected Interval Window Inspector Bar (Drag-to-Zoom or Debrief Insight Zoom) */}
      {selectedWindowStats && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-blue-500/10 dark:bg-sky-500/12 border border-blue-500/30 px-3 py-2 text-xs font-mono tabular-nums">
          <div className="flex flex-wrap items-center gap-3 text-slate-800 dark:text-slate-100">
            <span className="font-bold text-blue-700 dark:text-sky-300">
              Selected Window: {formatStopwatch(selectedWindowStats.startSec)} →{' '}
              {formatStopwatch(selectedWindowStats.endSec)} (
              {formatStopwatch(selectedWindowStats.durationSecs)})
            </span>
            {selectedWindowStats.avgWatts != null && (
              <span>
                Avg: <strong>{selectedWindowStats.avgWatts}W</strong> (
                {(selectedWindowStats.avgWatts / Math.max(40, athleteWeightKg)).toFixed(2)} W/kg)
              </span>
            )}
            {selectedWindowStats.npWatts != null && (
              <span>
                NP: <strong className="text-blue-600 dark:text-sky-400">{selectedWindowStats.npWatts}W</strong>
              </span>
            )}
            {selectedWindowStats.avgPaceSecsKm != null && (
              <span>
                Pace: <strong>{formatPace(selectedWindowStats.avgPaceSecsKm, distanceUnit)}</strong>
              </span>
            )}
            {selectedWindowStats.gapPaceSecsKm != null && (
              <span>
                GAP:{' '}
                <strong className="text-blue-600 dark:text-sky-400">
                  {formatPace(selectedWindowStats.gapPaceSecsKm, distanceUnit)}
                </strong>
              </span>
            )}
            {selectedWindowStats.avgHr != null && (
              <span>
                HR: <strong className="text-rose-500">{selectedWindowStats.avgHr}</strong>
                {selectedWindowStats.maxHr ? ` / ${selectedWindowStats.maxHr} bpm` : ' bpm'}
              </span>
            )}
            {selectedWindowStats.avgCad != null && (
              <span>
                Cad: <strong>{selectedWindowStats.avgCad}</strong>
              </span>
            )}
            {(selectedWindowStats.elevGainM > 0 || selectedWindowStats.elevLossM > 0) && (
              <span>
                Elev Δ: <strong>+{selectedWindowStats.elevGainM}m</strong> / -
                {selectedWindowStats.elevLossM}m
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleResetZoom}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#1C5436] hover:bg-[#16422A] dark:bg-[#C8FF00] dark:hover:bg-[#B5EB00] text-white dark:text-[#080A09] text-2xs font-sans font-semibold transition-colors shrink-0"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset Full Stream ×</span>
          </button>
        </div>
      )}

      {/* Zero-Re-Render Live Cursor Readout Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-100/80 dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 px-3 py-1.5 text-xs font-mono">
        <div
          ref={readoutRef}
          className="text-slate-800 dark:text-slate-100 font-semibold truncate"
        >
          Hover or drag across 1Hz canvas to inspect telemetry &amp; zoom
        </div>
        <div className="flex items-center gap-3 text-2xs shrink-0">
          <span className="inline-flex items-center gap-1 text-blue-500 font-semibold">
            <span className="w-2.5 h-0.5 bg-blue-500 inline-block" />
            {preparedData.hasWatts ? 'Watts' : 'Speed'}
          </span>
          <span className="inline-flex items-center gap-1 text-red-500 font-semibold">
            <span className="w-2.5 h-0.5 bg-red-500 inline-block" />
            HR (bpm)
          </span>
          {showCadence && preparedData.hasCadence && (
            <span className="inline-flex items-center gap-1 text-emerald-500 font-semibold">
              <span className="w-2.5 h-0.5 bg-emerald-500 inline-block" />
              Cadence
            </span>
          )}
          {showAltitude && preparedData.hasAltitude && (
            <span className="inline-flex items-center gap-1 text-purple-400 font-semibold">
              <span className="w-2.5 h-0.5 bg-purple-400 inline-block" />
              Elev (m)
            </span>
          )}
        </div>
      </div>

      {/* uPlot Canvas Mount Target */}
      <div ref={containerRef} className="w-full overflow-hidden select-none" />
    </div>
  );
};

export const UPlotStreamChart = React.memo(UPlotStreamChartInner);
export default UPlotStreamChart;
