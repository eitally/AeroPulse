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
    barColor: 'rgba(56, 189, 248, 0.92)',
    solidColor: '#38bdf8',
    badgeBg: 'rgba(56, 189, 248, 0.16)',
  },
  HIGH_AEROBIC: {
    type: 'HIGH_AEROBIC',
    label: 'High Aerobic',
    shortLabel: 'High Aer',
    barColor: 'rgba(249, 115, 22, 0.94)',
    solidColor: '#f97316',
    badgeBg: 'rgba(249, 115, 22, 0.18)',
  },
  ANAEROBIC: {
    type: 'ANAEROBIC',
    label: 'Anaerobic',
    shortLabel: 'Anaerobic',
    barColor: 'rgba(217, 70, 239, 0.92)',
    solidColor: '#d946ef',
    badgeBg: 'rgba(217, 70, 239, 0.18)',
  },
};

export interface ActivityLoadSegment {
  activityId: string;
  activityName: string;
  sportCategory?: string;
  load: number;
  rawActivityLoad: number;
  focus: GarminLoadFocusMeta;
  activity?: UnifiedActivity;
}

export interface GarminClassifyOptions {
  ftp?: number;
  lthr?: number;
  maxHr?: number;
  thresholdPaceSecsPerKm?: number;
}

/**
 * Classifies a single workout into Garmin's Training Load Focus jargon:
 * - Low Aerobic (Z1/Z2 Recovery, Base, Endurance, Warmup, Cooldown) -> Cyan (#38bdf8)
 * - High Aerobic (Z3/Z4 Tempo, Sweet Spot, Lactate Threshold, Cruise Intervals) -> Orange (#f97316)
 * - Anaerobic (Z5–Z7 VO2max, Anaerobic Capacity, Track Repeats, Sprints, Crit/Zwift Races, HIIT) -> Magenta (#d946ef)
 */
export function classifyActivityGarminLoad(
  activity: UnifiedActivity,
  opts?: GarminClassifyOptions
): GarminLoadFocusMeta {
  const name = String(activity.name || '').trim();
  const ftp = opts?.ftp && opts.ftp > 80 ? opts.ftp : 300;
  const lthr = opts?.lthr && opts.lthr > 110 ? opts.lthr : 168;
  const athleteMaxHr = opts?.maxHr && opts.maxHr > 140 ? opts.maxHr : 190;
  const explicitLoad = Number(activity.trainingLoad ?? (activity as any).tss ?? 0);

  const hasHighIntensityTitleKeyword =
    /\b(race|interval|intervals|tempo|threshold|vo2|vo2max|anaerobic|sprint|sprints|track|crit|criterium|hiit|over-under|over\/under|sweet\s*spot|\bsst\b|time trial|\btt\b)\b/i.test(
      name
    );

  // 1. Explicit Warmup / Cooldown / Recovery / Easy / Z1-Z2 Base Title Intent or very short <= 12 TSS spin/commute
  if (
    !hasHighIntensityTitleKeyword &&
    (/\b(warmup|warm-up|warm up|cooldown|cool-down|cool down|recovery|shakeout|easy|zone 1|zone 2|\bz1\b|\bz2\b|base|endurance spin|aerobic spin|commute|walk|yoga|mobility|stretch|stretching|foundation)\b/i.test(
      name
    ) ||
      (explicitLoad > 0 && explicitLoad <= 14 && (activity.movingTimeSecs || 0) <= 1800))
  ) {
    return GARMIN_LOAD_FOCUS_META.LOW_AEROBIC;
  }

  // 2. Explicit Anaerobic / Race / Track / Sprint / VO2max Title Intent
  if (
    /\b(anaerobic|sprint|sprints|track|crit|criterium|hiit|zwift\s*-\s*race|zwift race|\brace\b|vo2|vo2max|microburst|microbursts|tabata|30\/30|40\/20|40\/15|attack|attacks|opener|openers|200m|400m|800m|wingate|neuromuscular|all-out)\b/i.test(
      name
    )
  ) {
    return GARMIN_LOAD_FOCUS_META.ANAEROBIC;
  }

  // 3. Explicit High Aerobic (Tempo / Sweet Spot / Threshold / Cruise / Structured Virtual Cycling Session) Title Intent
  if (
    /\b(tempo|sweet\s*spot|\bsweetspot\b|\bsst\b|threshold|\blt1\b|\blt2\b|lactate|cruise|over-under|over\/under|time trial|\btt\b|half marathon|marathon pace|progression|virtual cycling session)\b/i.test(
      name
    )
  ) {
    return GARMIN_LOAD_FOCUS_META.HIGH_AEROBIC;
  }

  // 4. Time-in-Zones Inspection (Power preferred when present, then Pace, then Heart Rate)
  const pwrZones = activity.zoneSecs?.power || [];
  const paceZones = activity.zoneSecs?.pace || [];
  const hrZones = activity.zoneSecs?.hr || [];
  const totalPwrSecs = pwrZones.reduce((s, v) => s + (v || 0), 0);
  const totalPaceSecs = paceZones.reduce((s, v) => s + (v || 0), 0);
  const totalHrSecs = hrZones.reduce((s, v) => s + (v || 0), 0);

  if (totalPwrSecs > 60) {
    const z3z4 = (pwrZones[2] || 0) + (pwrZones[3] || 0);
    const z5Plus = (pwrZones[4] || 0) + (pwrZones[5] || 0) + (pwrZones[6] || 0);
    const z6z7 = (pwrZones[5] || 0) + (pwrZones[6] || 0);

    if (
      z6z7 / totalPwrSecs >= 0.05 ||
      z5Plus / totalPwrSecs >= 0.14 ||
      (z5Plus / totalPwrSecs >= 0.09 && z5Plus >= z3z4 * 0.7)
    ) {
      return GARMIN_LOAD_FOCUS_META.ANAEROBIC;
    }
    if ((z3z4 + z5Plus) / totalPwrSecs >= 0.30 || z3z4 / totalPwrSecs >= 0.25) {
      return GARMIN_LOAD_FOCUS_META.HIGH_AEROBIC;
    }
    return GARMIN_LOAD_FOCUS_META.LOW_AEROBIC;
  }

  if (totalPaceSecs > 60 || totalHrSecs > 60) {
    const z = totalPaceSecs > 60 ? paceZones : hrZones;
    const totalZ = totalPaceSecs > 60 ? totalPaceSecs : totalHrSecs;
    const z3z4 = (z[2] || 0) + (z[3] || 0);
    const z5Plus = (z[4] || 0) + (z[5] || 0) + (z[6] || 0);
    const z6z7 = (z[5] || 0) + (z[6] || 0);

    if (
      z6z7 / totalZ >= 0.05 ||
      z5Plus / totalZ >= 0.15 ||
      (z5Plus / totalZ >= 0.10 && z5Plus >= z3z4 * 0.7)
    ) {
      return GARMIN_LOAD_FOCUS_META.ANAEROBIC;
    }
    if ((z3z4 + z5Plus) / totalZ >= 0.34 || z3z4 / totalZ >= 0.28) {
      return GARMIN_LOAD_FOCUS_META.HIGH_AEROBIC;
    }
    return GARMIN_LOAD_FOCUS_META.LOW_AEROBIC;
  }

  // 5. Fallback to Intensity Factor (IF), Variability Index (VI), and Heart Rate vs LTHR
  const rawIf = Number(activity.intensityFactor || 0);
  const np = Number(activity.normalizedPower || activity.avgPower || 0);
  const ifVal =
    rawIf > 3
      ? rawIf / 100
      : rawIf > 0
        ? rawIf
        : np > 0 && ftp > 0 && activity.sportCategory === 'Cycling'
          ? np / ftp
          : 0;
  const viVal =
    activity.variabilityIndex && activity.variabilityIndex > 0
      ? activity.variabilityIndex
      : activity.normalizedPower && activity.avgPower && activity.avgPower > 0
        ? activity.normalizedPower / activity.avgPower
        : 1.0;

  if (ifVal > 0) {
    if (
      ifVal >= 0.95 ||
      (ifVal >= 0.85 && viVal >= 1.13) ||
      (ifVal >= 0.91 && (activity.movingTimeSecs || 0) > 0 && (activity.movingTimeSecs || 0) <= 2400)
    ) {
      return GARMIN_LOAD_FOCUS_META.ANAEROBIC;
    }
    if (ifVal >= 0.80) {
      return GARMIN_LOAD_FOCUS_META.HIGH_AEROBIC;
    }
    return GARMIN_LOAD_FOCUS_META.LOW_AEROBIC;
  }

  const avgHr = Number(activity.avgHr || 0);
  const maxHr = Number(activity.maxHr || 0);
  if (avgHr > 0) {
    if (
      avgHr >= lthr * 0.96 ||
      (maxHr >= athleteMaxHr * 0.96 && avgHr >= lthr * 0.89)
    ) {
      return GARMIN_LOAD_FOCUS_META.ANAEROBIC;
    }
    if (avgHr >= lthr * 0.88) {
      return GARMIN_LOAD_FOCUS_META.HIGH_AEROBIC;
    }
    return GARMIN_LOAD_FOCUS_META.LOW_AEROBIC;
  }

  return GARMIN_LOAD_FOCUS_META.LOW_AEROBIC;
}

/**
 * Builds per-activity load segments for a single day so multi-activity days
 * render as a stacked bar where each activity is colored by its own Garmin Load Focus.
 */
export function buildDayLoadSegments(
  activities: UnifiedActivity[] = [],
  dailyLoad = 0,
  dateStr = '',
  opts?: GarminClassifyOptions
): ActivityLoadSegment[] {
  if (activities.length > 0) {
    // Sort chronologically (morning -> afternoon -> evening) so bottom of stack is first workout
    const chronological = [...activities].sort((a, b) =>
      String(a.startDateLocal || '').localeCompare(String(b.startDateLocal || ''))
    );

    const rawList = chronological.map((act, idx) => {
      const focus = classifyActivityGarminLoad(act, opts);
      const explicitLoad = Number(act.trainingLoad ?? (act as any).tss ?? 0);
      const fallbackLoad = Math.max(
        8,
        Math.round(
          ((act.movingTimeSecs || 1800) / 3600) *
            (focus.type === 'ANAEROBIC' ? 75 : focus.type === 'HIGH_AEROBIC' ? 62 : 45)
        )
      );
      const rawLoad = explicitLoad > 0 ? explicitLoad : fallbackLoad;
      return {
        activityId: act.id || `${dateStr}-act-${idx}`,
        activityName: act.name || act.sportCategory || `Workout ${idx + 1}`,
        sportCategory: act.sportCategory,
        rawLoad,
        focus,
        activity: act,
      };
    });

    const sumRaw = rawList.reduce((acc, item) => acc + item.rawLoad, 0);
    const targetTotal = dailyLoad > 0 ? Math.max(dailyLoad, sumRaw) : sumRaw;
    const scale = sumRaw > 0 ? targetTotal / sumRaw : 1;

    return rawList.map((item) => ({
      activityId: item.activityId,
      activityName: item.activityName,
      sportCategory: item.sportCategory,
      load: Math.round(item.rawLoad * scale * 10) / 10,
      rawActivityLoad: Math.round(item.rawLoad),
      focus: item.focus,
      activity: item.activity,
    }));
  }

  if (dailyLoad <= 0) {
    return [];
  }

  // Fallback for synthetic/unhydrated wellness days with no activity objects attached
  let fallbackFocus = GARMIN_LOAD_FOCUS_META.LOW_AEROBIC;
  if (dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1));
    const dow = dt.getUTCDay();
    const dayHash = ((d || 1) * 7 + (m || 1) * 13) % 10;
    if (dow === 2 && dailyLoad >= 80) {
      fallbackFocus =
        dayHash < 4 ? GARMIN_LOAD_FOCUS_META.ANAEROBIC : GARMIN_LOAD_FOCUS_META.HIGH_AEROBIC;
    } else if (dow === 4 && dailyLoad >= 78) {
      fallbackFocus = GARMIN_LOAD_FOCUS_META.HIGH_AEROBIC;
    } else if (dow === 6 && dailyLoad >= 145 && dayHash < 3) {
      fallbackFocus = GARMIN_LOAD_FOCUS_META.HIGH_AEROBIC;
    }
  }

  return [
    {
      activityId: `${dateStr}-daily`,
      activityName: 'Daily Training Load',
      load: Math.round(dailyLoad * 10) / 10,
      rawActivityLoad: Math.round(dailyLoad),
      focus: fallbackFocus,
    },
  ];
}

/**
 * Classifies a day's primary or single workout into Garmin's Training Load Focus jargon.
 */
export function classifyGarminLoadType(
  activities: UnifiedActivity[] = [],
  dailyLoad = 0,
  _maxHr = 0,
  opts?: GarminClassifyOptions
): GarminLoadFocusMeta {
  if (activities.length === 1) {
    return classifyActivityGarminLoad(activities[0], opts);
  }
  if (activities.length > 1) {
    const segments = buildDayLoadSegments(activities, dailyLoad, '', opts);
    const totals: Record<GarminLoadFocus, number> = {
      LOW_AEROBIC: 0,
      HIGH_AEROBIC: 0,
      ANAEROBIC: 0,
    };
    for (const seg of segments) {
      totals[seg.focus.type] += seg.load;
    }
    if (totals.ANAEROBIC >= totals.HIGH_AEROBIC && totals.ANAEROBIC >= totals.LOW_AEROBIC) {
      return GARMIN_LOAD_FOCUS_META.ANAEROBIC;
    }
    if (totals.HIGH_AEROBIC >= totals.LOW_AEROBIC) {
      return GARMIN_LOAD_FOCUS_META.HIGH_AEROBIC;
    }
    return GARMIN_LOAD_FOCUS_META.LOW_AEROBIC;
  }
  const segs = buildDayLoadSegments([], dailyLoad, '', opts);
  return segs[0]?.focus || GARMIN_LOAD_FOCUS_META.LOW_AEROBIC;
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
  segments?: ActivityLoadSegment[];
  classifyOpts?: GarminClassifyOptions;
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

    const axisLabelColor = isDark ? '#94a3b8' : '#475569';
    const axisLineColor = isDark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(15, 23, 42, 0.16)';
    const splitLineColor = isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(15, 23, 42, 0.08)';
    const tooltipBg = isDark ? 'rgba(15, 20, 28, 0.95)' : 'rgba(255, 253, 250, 0.96)';
    const tooltipText = isDark ? '#f8fafc' : '#0f172a';
    const tooltipMuted = isDark ? '#cbd5e1' : '#334155';
    const tooltipDivider = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(15, 23, 42, 0.1)';

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
        backgroundColor: tooltipBg,
        borderColor: isDark ? 'rgba(56, 189, 248, 0.35)' : 'rgba(15, 23, 42, 0.15)',
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
              ? `<span style="color:${tooltipText};font-weight:700;">${Math.round(pt.tss)} TSS</span> <span style="font-size:10px;">(${pt.segments
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
                  <div style="font-size:10px;color:#38bdf8;margin-bottom:3px;">STACKED WORKOUT LOAD (${pt.segments.length}) — Click to inspect</div>
                  ${pt.segments
                    .slice()
                    .reverse()
                    .map((seg) => {
                      return `<div style="font-size:10px;color:${tooltipMuted};display:flex;align-items:center;justify-content:space-between;gap:8px;">
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
                <span style="color:${tooltipMuted};">● Daily Load</span>
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
                fontSize: 10,
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
                  fontSize: 10,
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
          nameTextStyle: {
            color: '#38bdf8',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 10,
            padding: [0, 0, 0, 8],
          },
          splitLine: { lineStyle: { color: splitLineColor } },
          axisLabel: {
            color: axisLabelColor,
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
          splitLine: { lineStyle: { color: splitLineColor } },
          axisLabel: {
            color: axisLabelColor,
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
                splitLine: { lineStyle: { color: splitLineColor } },
                axisLabel: {
                  color: axisLabelColor,
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
          borderColor: isDark ? 'rgba(56, 189, 248, 0.2)' : 'rgba(15, 23, 42, 0.14)',
          backgroundColor: isDark ? 'rgba(15, 23, 42, 0.65)' : 'rgba(243, 239, 234, 0.85)',
          fillerColor: isDark ? 'rgba(56, 189, 248, 0.16)' : 'rgba(2, 132, 199, 0.14)',
          handleStyle: {
            color: '#38bdf8',
            borderColor: '#0284c7',
          },
          textStyle: {
            color: axisLabelColor,
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 9,
          },
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
    onSelectActivity,
    onSelectDate,
  ]);

  return (
    <div className="rounded-2xl liquid-glass p-3 sm:p-4 border border-stone-200/80 dark:border-slate-800/80">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 pb-2.5 border-b border-stone-200/80 dark:border-slate-800/80">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-[10px] font-mono uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
            <TrendingUp className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
            Interactive Fitness, Form &amp; Ramp Chart
          </span>
          <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
            CTL <strong className="text-cyan-600 dark:text-cyan-400">{summaryMetrics.latestCtl.toFixed(1)}</strong> · ATL{' '}
            <strong className="text-purple-600 dark:text-purple-400">{summaryMetrics.latestAtl.toFixed(1)}</strong> · TSB{' '}
            <strong
              className={
                summaryMetrics.latestTsb >= 0
                  ? 'text-cyan-600 dark:text-cyan-300'
                  : summaryMetrics.latestTsb >= -30
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
              }
            >
              {summaryMetrics.latestTsb > 0 ? '+' : ''}
              {summaryMetrics.latestTsb.toFixed(1)}
            </strong>{' '}
            · Ramp{' '}
            <strong
              className={
                summaryMetrics.latestRamp > 7
                  ? 'text-rose-600 dark:text-rose-400'
                  : summaryMetrics.latestRamp > 5
                    ? 'text-amber-600 dark:text-amber-400'
                    : summaryMetrics.latestRamp >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-sky-600 dark:text-sky-400'
              }
            >
              {summaryMetrics.latestRamp >= 0 ? '+' : ''}
              {summaryMetrics.latestRamp.toFixed(1)}/wk
            </strong>
          </span>

          {/* Garmin Daily Load Bar Color Legend */}
          {showTssBars && (
            <div className="flex items-center gap-1.5 pl-1 text-[10px] font-mono">
              <span className="text-slate-500 dark:text-slate-400">Stacked Activity Load:</span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30">
                <span className="w-2 h-2 rounded-full bg-[#38bdf8]" />
                Low Aerobic
              </span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/30">
                <span className="w-2 h-2 rounded-full bg-[#f97316]" />
                High Aerobic
              </span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border border-fuchsia-500/30">
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
                ? 'bg-sky-500/15 border-sky-500/40 text-sky-700 dark:text-sky-300'
                : 'liquid-glass-subtle border-stone-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-400'
            }`}
          >
            Load Focus Bars
          </button>
          <button
            type="button"
            onClick={() => setShowRampSubplot((v) => !v)}
            className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase transition-colors border ${
              showRampSubplot
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                : 'liquid-glass-subtle border-stone-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-400'
            }`}
          >
            Ramp Sub-Chart
          </button>
          <button
            type="button"
            onClick={() => setShowEftpOverlay((v) => !v)}
            className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase transition-colors border ${
              showEftpOverlay
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300'
                : 'liquid-glass-subtle border-stone-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-400'
            }`}
          >
            eFTP Step Line
          </button>
        </div>
      </div>

      <div ref={chartContainerRef} style={{ width: '100%', height: `${showRampSubplot ? Math.max(520, height) : height}px` }} />

      {selectedDay && (
        <div className="mt-3 pt-3 border-t border-stone-200/80 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-slate-600 dark:text-slate-400">
              Selected Date: <strong className="text-slate-900 dark:text-slate-100">{selectedDay.date}</strong>
            </span>
            <span className="text-cyan-600 dark:text-cyan-400">CTL {selectedDay.ctl.toFixed(1)}</span>
            <span className="text-purple-600 dark:text-purple-400">ATL {selectedDay.atl.toFixed(1)}</span>
            <span className="text-amber-600 dark:text-amber-300">
              TSB {selectedDay.tsb > 0 ? '+' : ''}
              {selectedDay.tsb.toFixed(1)}
            </span>
            <span className="text-emerald-600 dark:text-emerald-400">
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
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded liquid-glass-subtle hover:bg-stone-200/60 dark:hover:bg-slate-800 border text-slate-900 dark:text-slate-200 text-[11px] transition-colors"
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
              <span className="text-slate-500 text-[11px]">Rest / Recovery Day (0 TSS)</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
