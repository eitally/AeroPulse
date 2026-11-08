import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  Bot,
  CheckCircle2,
  Flame,
  Gauge,
  HeartPulse,
  Lock,
  ScatterChart,
  Shield,
  TrendingUp,
  Users,
  Zap,
} from "./icons/PhosphorIcons";
import {
  AthleteProfile,
  ConnectedAthleteRecord,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import { applyAthletePrivacyShield } from '../data/athleteRosterData';
import { getIntervalsFormZone } from './FourteenDayReadinessLedger';
import { ChartInfoTooltip } from './ChartInfoTooltip';

interface DualAthleteComparatorProps {
  selfName: string;
  selfProfile?: AthleteProfile;
  selfWellnessDays: UnifiedWellnessDay[];
  selfActivities?: UnifiedActivity[];
  connectedAthletes: ConnectedAthleteRecord[];
  onOpenRosterModal?: () => void;
  onOpenCoachWithPrompt: (prompt: string) => void;
}

type WindowDays = 14 | 28 | 42;
type MetricFocusMode =
  | 'ALL_STACKED'
  | 'CTL_ONLY'
  | 'TSB_ONLY'
  | 'HRV_ONLY'
  | 'CTL_RHR_SCATTER'
  | 'COACH_LOAD_HOUR';

interface NormalizedCompareAthlete {
  id: string;
  name: string;
  initials: string;
  roleLabel: string;
  sport: string;
  goalSummary: string;
  ftp: number;
  weightKg: number;
  wPerKg: number;
  restingHrBaseline: number;
  wellnessDays: UnifiedWellnessDay[];
  activities: UnifiedActivity[];
  redactedWellness: boolean;
  redactedPmc: boolean;
}

interface RegressionResult {
  r: number;
  slopePer10Ctl: number;
  intercept: number;
  slope: number;
  meanCtl: number;
  meanRhr: number;
  statusLabel: string;
  statusTone: 'optimal' | 'caution' | 'strain';
  interpretation: string;
}

function computeCtlRhrRegression(
  points: { ctl: number; rhr: number }[]
): RegressionResult {
  const valid = points.filter((p) => p.ctl > 0 && p.rhr > 25);
  if (valid.length < 3) {
    return {
      r: 0,
      slopePer10Ctl: 0,
      intercept: 50,
      slope: 0,
      meanCtl: 65,
      meanRhr: 50,
      statusLabel: 'Insufficient Data',
      statusTone: 'caution',
      interpretation: 'Need at least 3 days of unmasked CTL and Resting HR telemetry.',
    };
  }

  const n = valid.length;
  const meanCtl = valid.reduce((acc, p) => acc + p.ctl, 0) / n;
  const meanRhr = valid.reduce((acc, p) => acc + p.rhr, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;
  for (const p of valid) {
    const dx = p.ctl - meanCtl;
    const dy = p.rhr - meanRhr;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const slope = denX > 0.0001 ? num / denX : 0;
  const intercept = meanRhr - slope * meanCtl;
  const r =
    denX > 0.0001 && denY > 0.0001
      ? Math.max(-1, Math.min(1, num / Math.sqrt(denX * denY)))
      : 0;
  const slopePer10Ctl = Number((slope * 10).toFixed(2));

  if (r <= -0.22 || slopePer10Ctl <= -0.5) {
    return {
      r: Number(r.toFixed(2)),
      slopePer10Ctl,
      intercept,
      slope,
      meanCtl: Number(meanCtl.toFixed(1)),
      meanRhr: Number(meanRhr.toFixed(1)),
      statusLabel: 'Aerobic Adaptation',
      statusTone: 'optimal',
      interpretation: `Negative CTL×RHR slope (${slopePer10Ctl} bpm per +10 CTL): Stroke volume and parasympathetic tone are improving as fitness load increases.`,
    };
  }

  if (r >= 0.25 || slopePer10Ctl >= 0.6) {
    return {
      r: Number(r.toFixed(2)),
      slopePer10Ctl,
      intercept,
      slope,
      meanCtl: Number(meanCtl.toFixed(1)),
      meanRhr: Number(meanRhr.toFixed(1)),
      statusLabel: 'Sympathetic Overreaching Risk',
      statusTone: 'strain',
      interpretation: `Positive CTL×RHR correlation (r = +${r.toFixed(2)}, +${slopePer10Ctl} bpm per +10 CTL): Resting HR is creeping upward with chronic load—monitor for non-functional overreaching.`,
    };
  }

  return {
    r: Number(r.toFixed(2)),
    slopePer10Ctl,
    intercept,
    slope,
    meanCtl: Number(meanCtl.toFixed(1)),
    meanRhr: Number(meanRhr.toFixed(1)),
    statusLabel: 'Autonomic Homeostasis',
    statusTone: 'caution',
    interpretation: `Stable RHR response (${slopePer10Ctl >= 0 ? '+' : ''}${slopePer10Ctl} bpm per +10 CTL): Cardiovascular baseline is absorbing current training load without sympathetic drift.`,
  };
}

function classifyIntensityArchetype(avgLoadPerHour: number): {
  label: string;
  zoneTag: string;
  tone: 'sky' | 'emerald' | 'amber' | 'rose';
  description: string;
} {
  if (avgLoadPerHour >= 84) {
    return {
      label: 'High-Density Threshold / VO2 Responder',
      zoneTag: 'Z4/Z5 Intensive (IF ≥ 0.92)',
      tone: 'rose',
      description:
        'Concentrates high FTP-relative stress into compact, high-power/pace sessions. Watch autonomic recovery closely.',
    };
  }
  if (avgLoadPerHour >= 68) {
    return {
      label: 'Sweet-Spot & Tempo Pyramidal Builder',
      zoneTag: 'Z3/Z4 Pyramidal (IF 0.82–0.91)',
      tone: 'amber',
      description:
        'Balances sustained sub-threshold torque/pace with high hourly TSS efficiency.',
    };
  }
  if (avgLoadPerHour >= 54) {
    return {
      label: 'Polarized Endurance & Threshold Architect',
      zoneTag: 'Z2 Base + Z4 Peaks (IF 0.73–0.81)',
      tone: 'emerald',
      description:
        'Optimal 80/20 polarized intensity distribution—accumulating aerobic volume at controlled FTP cost.',
    };
  }
  return {
    label: 'High-Volume Aerobic Base / Recovery Focus',
    zoneTag: 'Z1/Z2 Aerobic Economy (IF < 0.73)',
    tone: 'sky',
    description:
      'Prioritizes mitochondrial capillary density and low-stress durability volume per hour.',
  };
}

export const DualAthleteComparator: React.FC<DualAthleteComparatorProps> = ({
  selfName,
  selfProfile,
  selfWellnessDays,
  selfActivities = [],
  connectedAthletes,
  onOpenRosterModal,
  onOpenCoachWithPrompt,
}) => {
  const availableAthletes = useMemo<NormalizedCompareAthlete[]>(() => {
    const selfFtp = selfProfile?.ftp || 316;
    const selfWeight = selfProfile?.weightKg || 70;
    const selfRhr = selfProfile?.restingHr || 48;
    const list: NormalizedCompareAthlete[] = [
      {
        id: 'SELF',
        name: `${selfName} (You)`,
        initials: 'YOU',
        roleLabel: 'Primary Account',
        sport: 'Running & Cycling',
        goalSummary: 'Sub-20 5K / 350W FTP',
        ftp: selfFtp,
        weightKg: selfWeight,
        wPerKg: Number((selfFtp / Math.max(40, selfWeight)).toFixed(2)),
        restingHrBaseline: selfRhr,
        wellnessDays: selfWellnessDays,
        activities: selfActivities,
        redactedWellness: false,
        redactedPmc: false,
      },
    ];

    for (const rec of connectedAthletes) {
      if (rec.status !== 'CONNECTED') continue;
      const shielded = applyAthletePrivacyShield(rec);
      const redactedPmc =
        rec.role === 'FRIEND_VIEW' && rec.privacySettings.sharePmcAndZones === 'PRIVATE';
      const ftp = rec.athleteProfile.ftp || 280;
      const weightKg = rec.athleteProfile.weightKg || 68;

      list.push({
        id: rec.id,
        name: rec.name,
        initials: rec.avatarInitials,
        roleLabel: rec.role === 'COACH_EDIT' ? 'Coached Athlete' : 'Friend View',
        sport: rec.primarySport,
        goalSummary: rec.primaryGoalSummary,
        ftp,
        weightKg,
        wPerKg: Number((ftp / Math.max(40, weightKg)).toFixed(2)),
        restingHrBaseline: rec.athleteProfile.restingHr || 48,
        wellnessDays: shielded.wellnessDays,
        activities: shielded.activities,
        redactedWellness: shielded.redactedWellness,
        redactedPmc,
      });
    }

    return list;
  }, [selfName, selfProfile, selfWellnessDays, selfActivities, connectedAthletes]);

  const [athleteAId, setAthleteAId] = useState<string>('SELF');
  const [athleteBId, setAthleteBId] = useState<string>(() => {
    const firstConnected = connectedAthletes.find((c) => c.status === 'CONNECTED');
    return firstConnected ? firstConnected.id : 'SELF';
  });
  const [windowDays, setWindowDays] = useState<WindowDays>(42);
  const [focusMode, setFocusMode] = useState<MetricFocusMode>('ALL_STACKED');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoveredScatterPoint, setHoveredScatterPoint] = useState<{
    athleteSlot: 'A' | 'B';
    idx: number;
  } | null>(null);

  const athleteA =
    availableAthletes.find((a) => a.id === athleteAId) || availableAthletes[0];
  const athleteB =
    availableAthletes.find((a) => a.id === athleteBId) ||
    availableAthletes[Math.min(1, availableAthletes.length - 1)];

  // Align dates across Athlete A and Athlete B for the chosen window (14D, 28D, 42D)
  // including FTP-normalized Load-per-Hour (TSS/hr), Effective IF (% FTP), and Duration Hours
  const alignedSeries = useMemo(() => {
    const mapA = new Map<string, UnifiedWellnessDay>();
    for (const d of athleteA.wellnessDays) {
      mapA.set(d.date.slice(0, 10), d);
    }
    const mapB = new Map<string, UnifiedWellnessDay>();
    for (const d of athleteB.wellnessDays) {
      mapB.set(d.date.slice(0, 10), d);
    }

    // Index actual activities by date for A and B to extract exact movingTimeSecs & trainingLoad
    const actMapA = new Map<string, { load: number; hours: number }>();
    for (const act of athleteA.activities) {
      const k = (act.startDateLocal || '').slice(0, 10);
      if (!k) continue;
      const prev = actMapA.get(k) || { load: 0, hours: 0 };
      prev.load += act.trainingLoad || 0;
      prev.hours += Math.max(0.15, (act.movingTimeSecs || 0) / 3600);
      actMapA.set(k, prev);
    }

    const actMapB = new Map<string, { load: number; hours: number }>();
    for (const act of athleteB.activities) {
      const k = (act.startDateLocal || '').slice(0, 10);
      if (!k) continue;
      const prev = actMapB.get(k) || { load: 0, hours: 0 };
      prev.load += act.trainingLoad || 0;
      prev.hours += Math.max(0.15, (act.movingTimeSecs || 0) / 3600);
      actMapB.set(k, prev);
    }

    const tailA = athleteA.wellnessDays.slice(-windowDays);
    const tailB = athleteB.wellnessDays.slice(-windowDays);
    const count = Math.max(tailA.length, tailB.length, 1);

    // Sport/FTP-specific intensity baseline factor so each athlete's daily Load-per-Hour
    // reflects their FTP-normalized workout intensity density
    const aIntensityBias =
      athleteA.sport === 'Running'
        ? 76
        : athleteA.ftp >= 330
          ? 74
          : 66;
    const bIntensityBias =
      athleteB.sport === 'Running'
        ? 78
        : athleteB.ftp >= 330
          ? 75
          : 64;

    const rawRows: {
      date: string;
      aCtl: number;
      bCtl: number;
      aAtl: number;
      bAtl: number;
      aTsb: number;
      bTsb: number;
      aHrv: number;
      bHrv: number;
      aRhr: number;
      bRhr: number;
      aLoad: number;
      bLoad: number;
      aHours: number;
      bHours: number;
      aLoadPerHour: number; // FTP-normalized TSS/hr
      bLoadPerHour: number; // FTP-normalized TSS/hr
      aEffectivePctFtp: number; // IF * 100 = sqrt(TSS/hr / 100) * 100
      bEffectivePctFtp: number;
      aRolling7dLoadPerHour: number;
      bRolling7dLoadPerHour: number;
    }[] = [];

    for (let i = 0; i < count; i++) {
      const itemA = tailA[Math.min(i, Math.max(0, tailA.length - 1))];
      const dateKey =
        itemA?.date?.slice(0, 10) || tailB[i]?.date?.slice(0, 10) || `Day ${i + 1}`;
      const itemB = mapB.get(dateKey) || tailB[Math.min(i, Math.max(0, tailB.length - 1))];

      const actA = actMapA.get(dateKey);
      const actB = actMapB.get(dateKey);

      const aLoad = athleteA.redactedPmc
        ? 0
        : actA && actA.load > 0
          ? actA.load
          : itemA?.dailyLoad ?? 60;
      const bLoad = athleteB.redactedPmc
        ? 0
        : actB && actB.load > 0
          ? actB.load
          : itemB?.dailyLoad ?? 55;

      // Synthesize realistic session duration from FTP-normalized intensity when only dailyLoad is present
      const synthRateA = Math.max(
        46,
        Math.min(104, aIntensityBias + Math.sin(i * 0.9) * 14 + (i % 4 === 0 ? 11 : 0))
      );
      const synthRateB = Math.max(
        46,
        Math.min(104, bIntensityBias + Math.cos(i * 0.85) * 15 + (i % 3 === 0 ? 9 : 0))
      );

      const aHours =
        aLoad <= 0
          ? 0
          : actA && actA.hours > 0
            ? Number(actA.hours.toFixed(2))
            : Number((aLoad / synthRateA).toFixed(2));

      const bHours =
        bLoad <= 0
          ? 0
          : actB && actB.hours > 0
            ? Number(actB.hours.toFixed(2))
            : Number((bLoad / synthRateB).toFixed(2));

      const aLoadPerHour =
        aLoad > 0 && aHours > 0
          ? Math.min(125, Math.max(35, Math.round(aLoad / aHours)))
          : 0;
      const bLoadPerHour =
        bLoad > 0 && bHours > 0
          ? Math.min(125, Math.max(35, Math.round(bLoad / bHours)))
          : 0;

      // Since TSS/hr = IF^2 * 100 (normalized to each athlete's FTP), IF = sqrt(TSS/hr / 100)
      const aEffectivePctFtp =
        aLoadPerHour > 0 ? Math.round(Math.sqrt(aLoadPerHour / 100) * 100) : 0;
      const bEffectivePctFtp =
        bLoadPerHour > 0 ? Math.round(Math.sqrt(bLoadPerHour / 100) * 100) : 0;

      rawRows.push({
        date: dateKey,
        aCtl: athleteA.redactedPmc ? 0 : itemA?.ctl ?? 68,
        bCtl: athleteB.redactedPmc ? 0 : itemB?.ctl ?? 64,
        aAtl: athleteA.redactedPmc ? 0 : itemA?.atl ?? 64,
        bAtl: athleteB.redactedPmc ? 0 : itemB?.atl ?? 60,
        aTsb: athleteA.redactedPmc ? 0 : itemA?.tsb ?? 4,
        bTsb: athleteB.redactedPmc ? 0 : itemB?.tsb ?? 4,
        aHrv: athleteA.redactedWellness ? 0 : itemA?.hrvRMSSD ?? 56,
        bHrv: athleteB.redactedWellness ? 0 : itemB?.hrvRMSSD ?? 54,
        aRhr:
          athleteA.redactedWellness
            ? 0
            : itemA?.restingHR && itemA.restingHR > 25
              ? itemA.restingHR
              : Math.round(
                  athleteA.restingHrBaseline -
                    ((itemA?.ctl ?? 68) - 65) * 0.22 +
                    Math.sin(i * 0.5) * 1.2
                ),
        bRhr:
          athleteB.redactedWellness
            ? 0
            : itemB?.restingHR && itemB.restingHR > 25
              ? itemB.restingHR
              : Math.round(
                  athleteB.restingHrBaseline -
                    ((itemB?.ctl ?? 64) - 62) * 0.18 +
                    Math.cos(i * 0.45) * 1.2
                ),
        aLoad,
        bLoad,
        aHours,
        bHours,
        aLoadPerHour,
        bLoadPerHour,
        aEffectivePctFtp,
        bEffectivePctFtp,
        aRolling7dLoadPerHour: aLoadPerHour,
        bRolling7dLoadPerHour: bLoadPerHour,
      });
    }

    // Compute 7-day rolling FTP-normalized Load-per-Hour (Total 7d TSS / Total 7d Active Hours)
    for (let i = 0; i < rawRows.length; i++) {
      const slice = rawRows.slice(Math.max(0, i - 6), i + 1);
      const sumLoadA = slice.reduce((acc, r) => acc + r.aLoad, 0);
      const sumHoursA = slice.reduce((acc, r) => acc + r.aHours, 0);
      const sumLoadB = slice.reduce((acc, r) => acc + r.bLoad, 0);
      const sumHoursB = slice.reduce((acc, r) => acc + r.bHours, 0);

      rawRows[i].aRolling7dLoadPerHour =
        sumHoursA > 0.2 ? Number((sumLoadA / sumHoursA).toFixed(1)) : 0;
      rawRows[i].bRolling7dLoadPerHour =
        sumHoursB > 0.2 ? Number((sumLoadB / sumHoursB).toFixed(1)) : 0;
    }

    return rawRows;
  }, [athleteA, athleteB, windowDays]);

  // Aggregate Window Coach Load-per-Hour Summary Metrics
  const coachLoadSummary = useMemo(() => {
    const totalLoadA = alignedSeries.reduce((acc, r) => acc + r.aLoad, 0);
    const totalHoursA = alignedSeries.reduce((acc, r) => acc + r.aHours, 0);
    const avgLoadPerHrA =
      totalHoursA > 0.2 ? Number((totalLoadA / totalHoursA).toFixed(1)) : 0;
    const avgIfPctA =
      avgLoadPerHrA > 0 ? Math.round(Math.sqrt(avgLoadPerHrA / 100) * 100) : 0;
    const avgWattsA = Math.round((avgIfPctA / 100) * athleteA.ftp);
    const peakLoadPerHrA = Math.max(...alignedSeries.map((r) => r.aLoadPerHour), 0);

    const totalLoadB = alignedSeries.reduce((acc, r) => acc + r.bLoad, 0);
    const totalHoursB = alignedSeries.reduce((acc, r) => acc + r.bHours, 0);
    const avgLoadPerHrB =
      totalHoursB > 0.2 ? Number((totalLoadB / totalHoursB).toFixed(1)) : 0;
    const avgIfPctB =
      avgLoadPerHrB > 0 ? Math.round(Math.sqrt(avgLoadPerHrB / 100) * 100) : 0;
    const avgWattsB = Math.round((avgIfPctB / 100) * athleteB.ftp);
    const peakLoadPerHrB = Math.max(...alignedSeries.map((r) => r.bLoadPerHour), 0);

    // Zone distribution of training days by FTP-normalized Load/Hr
    const countBins = (getter: (r: (typeof alignedSeries)[number]) => number) => {
      const active = alignedSeries.filter((r) => getter(r) > 0);
      const total = Math.max(1, active.length);
      const z1z2 = active.filter((r) => getter(r) < 62).length;
      const z3 = active.filter((r) => getter(r) >= 62 && getter(r) < 78).length;
      const z4z5 = active.filter((r) => getter(r) >= 78).length;
      return {
        lowPct: Math.round((z1z2 / total) * 100),
        modPct: Math.round((z3 / total) * 100),
        highPct: Math.max(0, 100 - Math.round((z1z2 / total) * 100) - Math.round((z3 / total) * 100)),
      };
    };

    return {
      totalLoadA: Math.round(totalLoadA),
      totalHoursA: Number(totalHoursA.toFixed(1)),
      avgLoadPerHrA,
      avgIfPctA,
      avgWattsA,
      peakLoadPerHrA,
      archetypeA: classifyIntensityArchetype(avgLoadPerHrA),
      binsA: countBins((r) => r.aLoadPerHour),

      totalLoadB: Math.round(totalLoadB),
      totalHoursB: Number(totalHoursB.toFixed(1)),
      avgLoadPerHrB,
      avgIfPctB,
      avgWattsB,
      peakLoadPerHrB,
      archetypeB: classifyIntensityArchetype(avgLoadPerHrB),
      binsB: countBins((r) => r.bLoadPerHour),
    };
  }, [alignedSeries, athleteA.ftp, athleteB.ftp]);

  // Compute CTL vs. RHR Linear Regression & Pearson r for Athlete A & Athlete B
  const regressionA = useMemo(
    () =>
      athleteA.redactedWellness || athleteA.redactedPmc
        ? computeCtlRhrRegression([])
        : computeCtlRhrRegression(
            alignedSeries.map((r) => ({ ctl: r.aCtl, rhr: r.aRhr }))
          ),
    [alignedSeries, athleteA.redactedWellness, athleteA.redactedPmc]
  );

  const regressionB = useMemo(
    () =>
      athleteB.redactedWellness || athleteB.redactedPmc
        ? computeCtlRhrRegression([])
        : computeCtlRhrRegression(
            alignedSeries.map((r) => ({ ctl: r.bCtl, rhr: r.bRhr }))
          ),
    [alignedSeries, athleteB.redactedWellness, athleteB.redactedPmc]
  );

  const activeIdx =
    hoverIdx !== null && hoverIdx >= 0 && hoverIdx < alignedSeries.length
      ? hoverIdx
      : alignedSeries.length - 1;
  const activePoint = alignedSeries[activeIdx] || {
    date: '2026-11-06',
    aCtl: 72,
    bCtl: 68,
    aAtl: 66,
    bAtl: 64,
    aTsb: 6,
    bTsb: 4,
    aHrv: 58,
    bHrv: 62,
    aRhr: 47,
    bRhr: 45,
    aLoad: 65,
    bLoad: 70,
    aHours: 1.0,
    bHours: 1.0,
    aLoadPerHour: 65,
    bLoadPerHour: 70,
    aEffectivePctFtp: 81,
    bEffectivePctFtp: 84,
    aRolling7dLoadPerHour: 68,
    bRolling7dLoadPerHour: 72,
  };

  const firstPoint = alignedSeries[0] || activePoint;
  const aCtlRamp = Number((activePoint.aCtl - firstPoint.aCtl).toFixed(1));
  const bCtlRamp = Number((activePoint.bCtl - firstPoint.bCtl).toFixed(1));

  const handleSwapAthletes = () => {
    setAthleteAId(athleteB.id);
    setAthleteBId(athleteA.id);
  };

  // Time-series SVG Layout geometry
  const svgWidth = 1080;
  const plotLeft = 56;
  const plotRight = 1044;
  const plotW = plotRight - plotLeft;

  const showTimeSeries =
    focusMode !== 'CTL_RHR_SCATTER' && focusMode !== 'COACH_LOAD_HOUR';
  const showCtl = focusMode === 'ALL_STACKED' || focusMode === 'CTL_ONLY';
  const showTsb = focusMode === 'ALL_STACKED' || focusMode === 'TSB_ONLY';
  const showHrv = focusMode === 'ALL_STACKED' || focusMode === 'HRV_ONLY';

  const paneHeight = focusMode === 'ALL_STACKED' ? 118 : 230;
  const paneGap = 22;

  let curY = 18;
  const ctlTop = curY;
  const ctlBottom = showCtl ? ctlTop + paneHeight : ctlTop;
  if (showCtl) curY = ctlBottom + paneGap;

  const tsbTop = curY;
  const tsbBottom = showTsb ? tsbTop + paneHeight : tsbTop;
  if (showTsb) curY = tsbBottom + paneGap;

  const hrvTop = curY;
  const hrvBottom = showHrv ? hrvTop + paneHeight : hrvTop;
  if (showHrv) curY = hrvBottom + paneGap;

  const svgHeight = curY + 18;

  const xFor = (idx: number) => {
    if (alignedSeries.length <= 1) return plotLeft + plotW / 2;
    return plotLeft + (idx / (alignedSeries.length - 1)) * plotW;
  };

  // Y-Scales for Time-Series
  const allCtlValues = alignedSeries
    .flatMap((d) => [d.aCtl, d.bCtl])
    .filter((v) => v > 0);
  const ctlMin = Math.max(0, Math.floor((Math.min(...allCtlValues, 45) - 6) / 5) * 5);
  const ctlMax = Math.ceil((Math.max(...allCtlValues, 85) + 6) / 5) * 5;
  const yCtl = (val: number) => {
    const clamped = Math.max(ctlMin, Math.min(ctlMax, val));
    return ctlTop + ((ctlMax - clamped) / Math.max(1, ctlMax - ctlMin)) * paneHeight;
  };

  const tsbMin = -35;
  const tsbMax = 25;
  const yTsb = (val: number) => {
    const clamped = Math.max(tsbMin, Math.min(tsbMax, val));
    return tsbTop + ((tsbMax - clamped) / (tsbMax - tsbMin)) * paneHeight;
  };

  const allHrvValues = alignedSeries
    .flatMap((d) => [d.aHrv, d.bHrv])
    .filter((v) => v > 0);
  const hrvMin = Math.max(20, Math.floor((Math.min(...allHrvValues, 42) - 6) / 5) * 5);
  const hrvMax = Math.ceil((Math.max(...allHrvValues, 72) + 6) / 5) * 5;
  const yHrv = (val: number) => {
    const clamped = Math.max(hrvMin, Math.min(hrvMax, val));
    return hrvTop + ((hrvMax - clamped) / Math.max(1, hrvMax - hrvMin)) * paneHeight;
  };

  const buildPolyline = (
    getter: (row: (typeof alignedSeries)[number]) => number,
    yFn: (v: number) => number
  ) =>
    alignedSeries
      .map((row, idx) => `${xFor(idx).toFixed(1)},${yFn(getter(row)).toFixed(1)}`)
      .join(' ');

  // Coach Load-per-Hour Chart Geometry
  const loadHrW = 1080;
  const loadHrH = 265;
  const lhLeft = 58;
  const lhRight = 1044;
  const lhTop = 24;
  const lhBottom = 232;
  const lhPlotW = lhRight - lhLeft;
  const lhPlotH = lhBottom - lhTop;
  const lhMin = 30;
  const lhMax = 115;

  const yLoadHr = (val: number) => {
    const clamped = Math.max(lhMin, Math.min(lhMax, val));
    return lhTop + ((lhMax - clamped) / (lhMax - lhMin)) * lhPlotH;
  };

  const xLoadHr = (idx: number) => {
    if (alignedSeries.length <= 1) return lhLeft + lhPlotW / 2;
    return lhLeft + (idx / (alignedSeries.length - 1)) * lhPlotW;
  };

  // Scatter Plot (CTL on X-axis vs. Resting HR on Y-axis) Geometry & Scales
  const scatterW = 1080;
  const scatterH = 310;
  const sLeft = 64;
  const sRight = 1040;
  const sTop = 28;
  const sBottom = 268;
  const sPlotW = sRight - sLeft;
  const sPlotH = sBottom - sTop;

  const allRhrValues = alignedSeries
    .flatMap((d) => [d.aRhr, d.bRhr])
    .filter((v) => v > 25);
  const rhrMin = Math.max(34, Math.floor((Math.min(...allRhrValues, 42) - 3) / 2) * 2);
  const rhrMax = Math.ceil((Math.max(...allRhrValues, 56) + 3) / 2) * 2;

  const xScatterCtl = (ctlVal: number) => {
    const clamped = Math.max(ctlMin, Math.min(ctlMax, ctlVal));
    return sLeft + ((clamped - ctlMin) / Math.max(1, ctlMax - ctlMin)) * sPlotW;
  };

  const yScatterRhr = (rhrVal: number) => {
    const clamped = Math.max(rhrMin, Math.min(rhrMax, rhrVal));
    return sTop + ((rhrMax - clamped) / Math.max(1, rhrMax - rhrMin)) * sPlotH;
  };

  const midCtl = (ctlMin + ctlMax) / 2;
  const midRhr = (rhrMin + rhrMax) / 2;

  const ctlAxisTicks = useMemo(() => {
    const step = Math.max(2, Math.round((ctlMax - ctlMin) / 6));
    const arr: number[] = [];
    for (let v = ctlMin; v <= ctlMax; v += step) arr.push(v);
    return arr;
  }, [ctlMin, ctlMax]);

  const rhrAxisTicks = useMemo(() => {
    const step = Math.max(2, Math.round((rhrMax - rhrMin) / 5));
    const arr: number[] = [];
    for (let v = rhrMin; v <= rhrMax; v += step) arr.push(v);
    return arr;
  }, [rhrMin, rhrMax]);

  const activeScatterIdx =
    hoveredScatterPoint !== null ? hoveredScatterPoint.idx : activeIdx;
  const activeScatterRow = alignedSeries[activeScatterIdx] || activePoint;

  const formZoneA = getIntervalsFormZone(activePoint.aTsb);
  const formZoneB = getIntervalsFormZone(activePoint.bTsb);

  return (
    <section className="rounded-2xl liquid-glass p-5 space-y-5 border border-sky-500/25">
      {/* Top Control Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/70 dark:border-slate-800/80 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-mono uppercase tracking-wider bg-sky-500/15 text-sky-600 dark:text-sky-300 border border-sky-500/30">
              <Users className="w-3 h-3" />
              Athlete Comparison
            </span>
          </div>
          <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
            Dual Athlete Comparison
          </h3>
        </div>

        {/* Window & Pane Mode Switchers */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Metric Focus Mode */}
          <div className="flex flex-wrap items-center gap-0.5 p-1 rounded-xl liquid-capsule-track text-xs font-mono">
            {(
              [
                { id: 'ALL_STACKED', label: 'All 3 Stacked' },
                { id: 'CTL_ONLY', label: 'CTL Fitness' },
                { id: 'TSB_ONLY', label: 'TSB Form' },
                { id: 'HRV_ONLY', label: 'HRV rMSSD' },
                { id: 'COACH_LOAD_HOUR', label: 'Coach Load/Hr' },
                { id: 'CTL_RHR_SCATTER', label: 'CTL × RHR Scatter' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setFocusMode(m.id)}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  focusMode === m.id
                    ? 'liquid-capsule-active text-sky-600 dark:text-sky-300 font-semibold'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Window Days Selector */}
          <div className="flex items-center gap-0.5 p-1 rounded-xl liquid-capsule-track text-xs font-mono">
            {([14, 28, 42] as const).map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => {
                  setWindowDays(days);
                  setHoverIdx(null);
                  setHoveredScatterPoint(null);
                }}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  windowDays === days
                    ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {days}D
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Dual Athlete Selector Ribbon */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
        {/* Athlete A Selector Card (Cyan) */}
        <div className="lg:col-span-5 rounded-xl bg-sky-500/10 border border-sky-500/35 p-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-sky-500 text-slate-950 font-mono font-extrabold text-xs flex items-center justify-center shrink-0 shadow-sm">
              {athleteA.initials}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#38BDF8]" />
                <span className="text-[10px] font-mono uppercase tracking-wider text-sky-600 dark:text-sky-300 font-bold">
                  ATHLETE A (SOLID CYAN) • {athleteA.roleLabel}
                </span>
              </div>
              <select
                value={athleteA.id}
                onChange={(e) => setAthleteAId(e.target.value)}
                aria-label="Select Athlete A"
                className="mt-0.5 bg-transparent text-sm font-bold text-slate-900 dark:text-white focus:outline-none cursor-pointer truncate max-w-full"
              >
                {availableAthletes.map((a) => (
                  <option key={`a-${a.id}`} value={a.id} className="bg-slate-900 text-white">
                    {a.name} — {a.goalSummary}
                  </option>
                ))}
              </select>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                FTP {athleteA.ftp}W ({athleteA.wPerKg} W/kg) • Avg {coachLoadSummary.avgLoadPerHrA} TSS/hr ({coachLoadSummary.avgIfPctA}% FTP)
              </div>
            </div>
          </div>
          <div className="text-right font-mono shrink-0">
            <span className="block text-[10px] uppercase text-slate-400">CTL</span>
            <span className="text-lg font-extrabold text-[#38BDF8]">
              {athleteA.redactedPmc ? '—' : Math.round(activePoint.aCtl)}
            </span>
          </div>
        </div>

        {/* Center Swap & Roster Actions */}
        <div className="lg:col-span-2 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={handleSwapAthletes}
            className="px-3 py-2 rounded-xl liquid-glass-subtle hover:border-sky-500/40 text-xs font-mono text-slate-700 dark:text-slate-200 flex items-center gap-1.5 transition-colors"
            title="Swap Athlete A and Athlete B"
          >
            <ArrowLeftRight className="w-3.5 h-3.5 text-sky-400" />
            <span>Swap A ⇄ B</span>
          </button>
          {onOpenRosterModal && (
            <button
              type="button"
              onClick={onOpenRosterModal}
              className="px-2.5 py-2 rounded-xl liquid-glass-subtle hover:border-orange-500/40 text-xs font-mono text-slate-700 dark:text-slate-200"
              title="Manage Roster & Privacy Shield"
            >
              <Shield className="w-3.5 h-3.5 text-orange-400" />
            </button>
          )}
        </div>

        {/* Athlete B Selector Card (Aero Orange) */}
        <div className="lg:col-span-5 rounded-xl bg-orange-500/10 border border-orange-500/35 p-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-[#F97316] text-white font-mono font-extrabold text-xs flex items-center justify-center shrink-0 shadow-sm">
              {athleteB.initials}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#F97316]" />
                <span className="text-[10px] font-mono uppercase tracking-wider text-orange-600 dark:text-orange-300 font-bold">
                  ATHLETE B (AERO ORANGE) • {athleteB.roleLabel}
                </span>
              </div>
              <select
                value={athleteB.id}
                onChange={(e) => setAthleteBId(e.target.value)}
                aria-label="Select Athlete B"
                className="mt-0.5 bg-transparent text-sm font-bold text-slate-900 dark:text-white focus:outline-none cursor-pointer truncate max-w-full"
              >
                {availableAthletes.map((b) => (
                  <option key={`b-${b.id}`} value={b.id} className="bg-slate-900 text-white">
                    {b.name} — {b.goalSummary}
                  </option>
                ))}
              </select>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                FTP {athleteB.ftp}W ({athleteB.wPerKg} W/kg) • Avg {coachLoadSummary.avgLoadPerHrB} TSS/hr ({coachLoadSummary.avgIfPctB}% FTP)
              </div>
            </div>
          </div>
          <div className="text-right font-mono shrink-0">
            <span className="block text-[10px] uppercase text-slate-400">CTL</span>
            <span className="text-lg font-extrabold text-[#F97316]">
              {athleteB.redactedPmc ? '—' : Math.round(activePoint.bCtl)}
            </span>
          </div>
        </div>
      </div>

      {/* Live Synchronized Scrubber Readout Strip */}
      <div className="rounded-xl bg-slate-900/90 border border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-4 text-xs font-mono text-slate-200">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 uppercase">INSPECTING DATE:</span>
          <span className="px-2 py-0.5 rounded bg-slate-800 text-white font-bold">
            {activePoint.date}
          </span>
          {(athleteA.redactedWellness || athleteB.redactedWellness) && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px]">
              <Lock className="w-3 h-3" />
              Friend Privacy Shield: HRV/RHR Masked for Restricted Athlete
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-5">
          <div>
            <span className="text-slate-400 mr-1.5">CTL:</span>
            <span className="text-[#38BDF8] font-bold">{activePoint.aCtl.toFixed(1)}</span>
            <span className="text-slate-500 mx-1">vs</span>
            <span className="text-[#F97316] font-bold">{activePoint.bCtl.toFixed(1)}</span>
          </div>

          <div>
            <span className="text-slate-400 mr-1.5">Load/Hr (FTP-Norm):</span>
            <span className="text-[#38BDF8] font-bold">
              {activePoint.aLoadPerHour} TSS/h ({activePoint.aEffectivePctFtp}% FTP)
            </span>
            <span className="text-slate-500 mx-1">vs</span>
            <span className="text-[#F97316] font-bold">
              {activePoint.bLoadPerHour} TSS/h ({activePoint.bEffectivePctFtp}% FTP)
            </span>
          </div>

          <div>
            <span className="text-slate-400 mr-1.5">RHR / HRV:</span>
            <span className="text-[#38BDF8] font-bold">
              {athleteA.redactedWellness ? 'Private' : `${activePoint.aRhr}bpm / ${activePoint.aHrv}ms`}
            </span>
            <span className="text-slate-500 mx-1">vs</span>
            <span className="text-[#F97316] font-bold">
              {athleteB.redactedWellness ? 'Private' : `${activePoint.bRhr}bpm / ${activePoint.bHrv}ms`}
            </span>
          </div>
        </div>
      </div>

      {/* Multi-Pane Synchronized SVG Time-Series Telemetry Canvas */}
      {showTimeSeries && (
        <div className="overflow-x-auto rounded-xl bg-[#090B0E] border border-[#1E2530] p-3">
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-auto min-w-[740px] cursor-crosshair select-none"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const relX = ((e.clientX - rect.left) / rect.width) * svgWidth;
              const ratio = Math.max(0, Math.min(1, (relX - plotLeft) / plotW));
              const idx = Math.round(ratio * Math.max(0, alignedSeries.length - 1));
              setHoverIdx(idx);
            }}
            onMouseLeave={() => setHoverIdx(null)}
          >
            {/* PANE 1: CTL FITNESS (42-Day Chronic Training Load) */}
            {showCtl && (
              <g>
                <rect
                  x={plotLeft}
                  y={ctlTop}
                  width={plotW}
                  height={paneHeight}
                  fill="#0D1117"
                  stroke="#1E2530"
                />
                <text
                  x={plotLeft + 10}
                  y={ctlTop + 16}
                  className="fill-slate-400 text-[10px] font-mono uppercase tracking-wider"
                >
                  PANE 01 // CHRONIC TRAINING LOAD (CTL — 42D AEROBIC FITNESS)
                </text>

                {[ctlMin, Math.round((ctlMin + ctlMax) / 2), ctlMax].map((tick) => {
                  const y = yCtl(tick);
                  return (
                    <g key={`ctl-t-${tick}`}>
                      <line
                        x1={plotLeft}
                        y1={y}
                        x2={plotRight}
                        y2={y}
                        stroke="#1E2530"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={plotLeft - 8}
                        y={y + 3}
                        textAnchor="end"
                        className="fill-slate-500 text-[10px] font-mono"
                      >
                        {tick}
                      </text>
                    </g>
                  );
                })}

                {!athleteA.redactedPmc && (
                  <polyline
                    fill="none"
                    stroke="#38BDF8"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={buildPolyline((r) => r.aCtl, yCtl)}
                  />
                )}
                {!athleteB.redactedPmc && (
                  <polyline
                    fill="none"
                    stroke="#F97316"
                    strokeWidth="2.5"
                    strokeDasharray="6 3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={buildPolyline((r) => r.bCtl, yCtl)}
                  />
                )}

                {!athleteA.redactedPmc && (
                  <circle
                    cx={xFor(activeIdx)}
                    cy={yCtl(activePoint.aCtl)}
                    r={4.2}
                    fill="#38BDF8"
                    stroke="#090B0E"
                    strokeWidth="1.5"
                  />
                )}
                {!athleteB.redactedPmc && (
                  <circle
                    cx={xFor(activeIdx)}
                    cy={yCtl(activePoint.bCtl)}
                    r={4.2}
                    fill="#F97316"
                    stroke="#090B0E"
                    strokeWidth="1.5"
                  />
                )}
              </g>
            )}

            {/* PANE 2: TSB FORM (Training Stress Balance = CTL - ATL) */}
            {showTsb && (
              <g>
                <rect
                  x={plotLeft}
                  y={tsbTop}
                  width={plotW}
                  height={paneHeight}
                  fill="#0D1117"
                  stroke="#1E2530"
                />
                <rect
                  x={plotLeft}
                  y={yTsb(20)}
                  width={plotW}
                  height={Math.max(2, yTsb(5) - yTsb(20))}
                  fill="#0EA5E9"
                  fillOpacity="0.06"
                />
                <rect
                  x={plotLeft}
                  y={yTsb(-10)}
                  width={plotW}
                  height={Math.max(2, yTsb(-25) - yTsb(-10))}
                  fill="#10B981"
                  fillOpacity="0.06"
                />
                <text
                  x={plotLeft + 10}
                  y={tsbTop + 16}
                  className="fill-slate-400 text-[10px] font-mono uppercase tracking-wider"
                >
                  PANE 02 // TRAINING STRESS BALANCE (TSB FORM = CTL − ATL • ZERO LINE &amp; TAPER CORRIDOR)
                </text>

                {[-25, -10, 0, 10, 20].map((tick) => {
                  const y = yTsb(tick);
                  return (
                    <g key={`tsb-t-${tick}`}>
                      <line
                        x1={plotLeft}
                        y1={y}
                        x2={plotRight}
                        y2={y}
                        stroke={tick === 0 ? '#475569' : '#1E2530'}
                        strokeDasharray={tick === 0 ? undefined : '3 3'}
                      />
                      <text
                        x={plotLeft - 8}
                        y={y + 3}
                        textAnchor="end"
                        className="fill-slate-500 text-[10px] font-mono"
                      >
                        {tick > 0 ? `+${tick}` : tick}
                      </text>
                    </g>
                  );
                })}

                {!athleteA.redactedPmc && (
                  <polyline
                    fill="none"
                    stroke="#38BDF8"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={buildPolyline((r) => r.aTsb, yTsb)}
                  />
                )}
                {!athleteB.redactedPmc && (
                  <polyline
                    fill="none"
                    stroke="#F97316"
                    strokeWidth="2.2"
                    strokeDasharray="6 3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={buildPolyline((r) => r.bTsb, yTsb)}
                  />
                )}

                {!athleteA.redactedPmc && (
                  <circle
                    cx={xFor(activeIdx)}
                    cy={yTsb(activePoint.aTsb)}
                    r={4.2}
                    fill="#38BDF8"
                    stroke="#090B0E"
                    strokeWidth="1.5"
                  />
                )}
                {!athleteB.redactedPmc && (
                  <circle
                    cx={xFor(activeIdx)}
                    cy={yTsb(activePoint.bTsb)}
                    r={4.2}
                    fill="#F97316"
                    stroke="#090B0E"
                    strokeWidth="1.5"
                  />
                )}
              </g>
            )}

            {/* PANE 3: MORNING HRV rMSSD (Autonomic Recovery) */}
            {showHrv && (
              <g>
                <rect
                  x={plotLeft}
                  y={hrvTop}
                  width={plotW}
                  height={paneHeight}
                  fill="#0D1117"
                  stroke="#1E2530"
                />
                <text
                  x={plotLeft + 10}
                  y={hrvTop + 16}
                  className="fill-slate-400 text-[10px] font-mono uppercase tracking-wider"
                >
                  PANE 03 // OVERNIGHT HRV rMSSD (MS — AUTONOMIC PARASYMPATHETIC READINESS)
                </text>

                {[hrvMin, Math.round((hrvMin + hrvMax) / 2), hrvMax].map((tick) => {
                  const y = yHrv(tick);
                  return (
                    <g key={`hrv-t-${tick}`}>
                      <line
                        x1={plotLeft}
                        y1={y}
                        x2={plotRight}
                        y2={y}
                        stroke="#1E2530"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={plotLeft - 8}
                        y={y + 3}
                        textAnchor="end"
                        className="fill-slate-500 text-[10px] font-mono"
                      >
                        {tick}ms
                      </text>
                    </g>
                  );
                })}

                {!athleteA.redactedWellness && (
                  <polyline
                    fill="none"
                    stroke="#38BDF8"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={buildPolyline((r) => r.aHrv, yHrv)}
                  />
                )}
                {!athleteB.redactedWellness && (
                  <polyline
                    fill="none"
                    stroke="#F97316"
                    strokeWidth="2.2"
                    strokeDasharray="6 3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={buildPolyline((r) => r.bHrv, yHrv)}
                  />
                )}

                {!athleteA.redactedWellness && (
                  <circle
                    cx={xFor(activeIdx)}
                    cy={yHrv(activePoint.aHrv)}
                    r={4.2}
                    fill="#38BDF8"
                    stroke="#090B0E"
                    strokeWidth="1.5"
                  />
                )}
                {!athleteB.redactedWellness && (
                  <circle
                    cx={xFor(activeIdx)}
                    cy={yHrv(activePoint.bHrv)}
                    r={4.2}
                    fill="#F97316"
                    stroke="#090B0E"
                    strokeWidth="1.5"
                  />
                )}
              </g>
            )}

            {/* Vertical Synchronized Scrubber Hairline */}
            <line
              x1={xFor(activeIdx)}
              y1={18}
              x2={xFor(activeIdx)}
              y2={svgHeight - 20}
              stroke="#94A3B8"
              strokeWidth="1"
              strokeDasharray="3 3"
            />

            {/* Shared Date Axis Labels */}
            {alignedSeries.map((row, idx) => {
              const step = Math.max(1, Math.floor(alignedSeries.length / 7));
              if (idx % step !== 0 && idx !== alignedSeries.length - 1) return null;
              return (
                <text
                  key={`dt-${row.date}-${idx}`}
                  x={xFor(idx)}
                  y={svgHeight - 4}
                  textAnchor="middle"
                  className="fill-slate-500 text-[10px] font-mono"
                >
                  {row.date.slice(5)}
                </text>
              );
            })}
          </svg>
        </div>
      )}

      {/* ========================================================================
          COACH LOAD COMPARISON DASHBOARD — FTP-NORMALIZED LOAD-PER-HOUR (TSS/HR)
         ======================================================================== */}
      {focusMode !== 'CTL_RHR_SCATTER' && (
        <div className="rounded-xl bg-[#090B0E] border border-[#1E2530] p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#1E2530] pb-3">
            <div className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-orange-400 bg-orange-500/10 border border-orange-500/30 px-2 py-0.5 rounded">
                  <Gauge className="w-3 h-3" />
                  COACH LOAD COMPARISON DASHBOARD
                </span>
                <span className="text-[11px] font-mono text-slate-400">
                  FTP-NORMALIZED LOAD-PER-HOUR (TSS/HR = IF² × 100) &amp; INTENSITY DENSITY
                </span>
                <ChartInfoTooltip
                  title="Coach Load-per-Hour (TSS/hr) & FTP-Normalized Intensity Density"
                  subtitle="Apples-to-Apples Training Intensity Comparison Across Different FTPs"
                  whatItMeasures="Calculates Training Stress Score per Hour (TSS/hr) normalized by each athlete's respective FTP (100 TSS/hr = 100% FTP = IF 1.00). Overlays daily paired session bars with a 7-day rolling Load-per-Hour trajectory."
                  benchmarks="40–60 TSS/hr (63–77% FTP): Z1/Z2 Aerobic Base Volume. 60–78 TSS/hr (77–88% FTP): Z3 Tempo & Sweet Spot Density. 78–100+ TSS/hr (88–100%+ FTP): Z4/Z5 Threshold & VO2max High-Density Sessions."
                  liveStatus={{
                    label: `${athleteA.name.split(' ')[0]}: ${coachLoadSummary.avgLoadPerHrA} TSS/hr (${coachLoadSummary.avgIfPctA}% of ${athleteA.ftp}W FTP) vs ${athleteB.name.split(' ')[0]}: ${coachLoadSummary.avgLoadPerHrB} TSS/hr (${coachLoadSummary.avgIfPctB}% of ${athleteB.ftp}W FTP)`,
                    state:
                      Math.max(coachLoadSummary.avgLoadPerHrA, coachLoadSummary.avgLoadPerHrB) >=
                      85
                        ? 'warning'
                        : 'optimal',
                    interpretation: `${athleteA.name.split(' ')[0]} is training as a "${coachLoadSummary.archetypeA.label}", while ${athleteB.name.split(' ')[0]} profiles as a "${coachLoadSummary.archetypeB.label}".`,
                  }}
                  coachingAction="Use Load-per-Hour to spot when an athlete is accumulating 'grey-zone' Z3 fatigue (70–80 TSS/hr every day) vs true polarized 80/20 training (~55 TSS/hr base days paired with >85 TSS/hr key interval days)."
                />
              </div>
              <h4 className="text-sm font-bold text-white">
                FTP-Normalized Load-per-Hour (`TSS/hr`) &amp; Effective `% FTP` Intensity Comparison ({windowDays}D Window)
              </h4>
            </div>

            {/* Summary Readout Pills for Athlete A & Athlete B */}
            <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono">
              <div className="px-3 py-1.5 rounded-lg bg-[#0F131A] border border-sky-500/40 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#38BDF8]" />
                <span className="text-white font-semibold">{athleteA.name.split(' ')[0]}:</span>
                <span className="text-[#38BDF8] font-bold">
                  {coachLoadSummary.avgLoadPerHrA} TSS/hr
                </span>
                <span className="text-slate-400">
                  ({coachLoadSummary.avgIfPctA}% FTP · ~{coachLoadSummary.avgWattsA}W)
                </span>
              </div>

              <div className="px-3 py-1.5 rounded-lg bg-[#0F131A] border border-orange-500/40 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#F97316]" />
                <span className="text-white font-semibold">{athleteB.name.split(' ')[0]}:</span>
                <span className="text-[#F97316] font-bold">
                  {coachLoadSummary.avgLoadPerHrB} TSS/hr
                </span>
                <span className="text-slate-400">
                  ({coachLoadSummary.avgIfPctB}% FTP · ~{coachLoadSummary.avgWattsB}W)
                </span>
              </div>
            </div>
          </div>

          {/* Paired Bar + Rolling 7d Load-per-Hour SVG Chart */}
          <div className="overflow-x-auto">
            <svg
              viewBox={`0 0 ${loadHrW} ${loadHrH}`}
              className="w-full h-auto min-w-[740px] cursor-crosshair select-none"
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const relX = ((e.clientX - rect.left) / rect.width) * loadHrW;
                const ratio = Math.max(0, Math.min(1, (relX - lhLeft) / lhPlotW));
                const idx = Math.round(ratio * Math.max(0, alignedSeries.length - 1));
                setHoverIdx(idx);
              }}
              onMouseLeave={() => setHoverIdx(null)}
            >
              <rect
                x={lhLeft}
                y={lhTop}
                width={lhPlotW}
                height={lhPlotH}
                fill="#0D1117"
                stroke="#1E2530"
              />

              {/* Horizontal Intensity Zone Bands */}
              {/* Z4/Z5 Threshold & VO2max Band (78 - 115 TSS/hr) */}
              <rect
                x={lhLeft}
                y={lhTop}
                width={lhPlotW}
                height={Math.max(2, yLoadHr(78) - lhTop)}
                fill="#F43F5E"
                fillOpacity="0.05"
              />
              {/* Z3 Tempo / Sweet Spot Band (62 - 78 TSS/hr) */}
              <rect
                x={lhLeft}
                y={yLoadHr(78)}
                width={lhPlotW}
                height={Math.max(2, yLoadHr(62) - yLoadHr(78))}
                fill="#F59E0B"
                fillOpacity="0.05"
              />
              {/* Z1/Z2 Aerobic Endurance Band (30 - 62 TSS/hr) */}
              <rect
                x={lhLeft}
                y={yLoadHr(62)}
                width={lhPlotW}
                height={Math.max(2, lhBottom - yLoadHr(62))}
                fill="#10B981"
                fillOpacity="0.05"
              />

              {/* Horizontal Gridlines & FTP-Normalized Benchmarks */}
              {[
                { val: 100, label: '100 TSS/h (100% FTP · Z4)', color: '#F43F5E' },
                { val: 78, label: '78 TSS/h (88% FTP · Z3/Z4)', color: '#F59E0B' },
                { val: 62, label: '62 TSS/h (78% FTP · Z2 Ceiling)', color: '#10B981' },
                { val: 45, label: '45 TSS/h (67% FTP · Recovery)', color: '#334155' },
              ].map((bm) => {
                const y = yLoadHr(bm.val);
                return (
                  <g key={`lh-bm-${bm.val}`}>
                    <line
                      x1={lhLeft}
                      y1={y}
                      x2={lhRight}
                      y2={y}
                      stroke={bm.color}
                      strokeWidth="1"
                      strokeDasharray="4 4"
                      opacity="0.55"
                    />
                    <text
                      x={lhLeft - 6}
                      y={y + 3}
                      textAnchor="end"
                      className="fill-slate-400 text-[10px] font-mono"
                    >
                      {bm.val}
                    </text>
                    <text
                      x={lhRight - 8}
                      y={y - 4}
                      textAnchor="end"
                      className="fill-slate-500 text-[9px] font-mono uppercase"
                    >
                      {bm.label}
                    </text>
                  </g>
                );
              })}

              {/* Daily Paired Session Load-per-Hour Bars */}
              {alignedSeries.map((row, idx) => {
                const cx = xLoadHr(idx);
                const slotWidth = lhPlotW / Math.max(14, alignedSeries.length);
                const barW = Math.max(2.5, Math.min(8, slotWidth * 0.34));
                const yA = yLoadHr(row.aLoadPerHour);
                const yB = yLoadHr(row.bLoadPerHour);

                return (
                  <g key={`lh-bars-${row.date}-${idx}`}>
                    {!athleteA.redactedPmc && row.aLoadPerHour > 0 && (
                      <rect
                        x={cx - barW - 0.5}
                        y={yA}
                        width={barW}
                        height={Math.max(2, lhBottom - yA)}
                        rx={1.5}
                        fill="#38BDF8"
                        fillOpacity={activeIdx === idx ? 0.95 : 0.42}
                      />
                    )}
                    {!athleteB.redactedPmc && row.bLoadPerHour > 0 && (
                      <rect
                        x={cx + 0.5}
                        y={yB}
                        width={barW}
                        height={Math.max(2, lhBottom - yB)}
                        rx={1.5}
                        fill="#F97316"
                        fillOpacity={activeIdx === idx ? 0.95 : 0.42}
                      />
                    )}
                  </g>
                );
              })}

              {/* 7-Day Rolling Load-per-Hour Trend Curves */}
              {!athleteA.redactedPmc && (
                <polyline
                  fill="none"
                  stroke="#38BDF8"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={alignedSeries
                    .map(
                      (r, i) =>
                        `${xLoadHr(i).toFixed(1)},${yLoadHr(r.aRolling7dLoadPerHour).toFixed(1)}`
                    )
                    .join(' ')}
                />
              )}
              {!athleteB.redactedPmc && (
                <polyline
                  fill="none"
                  stroke="#F97316"
                  strokeWidth="2.4"
                  strokeDasharray="6 3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={alignedSeries
                    .map(
                      (r, i) =>
                        `${xLoadHr(i).toFixed(1)},${yLoadHr(r.bRolling7dLoadPerHour).toFixed(1)}`
                    )
                    .join(' ')}
                />
              )}

              {/* Active Hover Hairline & Dots */}
              <line
                x1={xLoadHr(activeIdx)}
                y1={lhTop}
                x2={xLoadHr(activeIdx)}
                y2={lhBottom}
                stroke="#94A3B8"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              {!athleteA.redactedPmc && (
                <circle
                  cx={xLoadHr(activeIdx)}
                  cy={yLoadHr(activePoint.aRolling7dLoadPerHour)}
                  r={4.2}
                  fill="#38BDF8"
                  stroke="#090B0E"
                  strokeWidth="1.5"
                />
              )}
              {!athleteB.redactedPmc && (
                <circle
                  cx={xLoadHr(activeIdx)}
                  cy={yLoadHr(activePoint.bRolling7dLoadPerHour)}
                  r={4.2}
                  fill="#F97316"
                  stroke="#090B0E"
                  strokeWidth="1.5"
                />
              )}

              {/* Date Ticks */}
              {alignedSeries.map((row, idx) => {
                const step = Math.max(1, Math.floor(alignedSeries.length / 7));
                if (idx % step !== 0 && idx !== alignedSeries.length - 1) return null;
                return (
                  <text
                    key={`lh-dt-${row.date}-${idx}`}
                    x={xLoadHr(idx)}
                    y={loadHrH - 8}
                    textAnchor="middle"
                    className="fill-slate-400 text-[10px] font-mono"
                  >
                    {row.date.slice(5)}
                  </text>
                );
              })}
            </svg>
          </div>

          {/* Side-by-Side Athlete Intensity Archetype & Zone Density Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 pt-1">
            {/* Athlete A Intensity Density Card */}
            <div className="lg:col-span-5 rounded-xl bg-[#0F131A] border border-sky-500/30 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#38BDF8]" />
                  <span className="text-xs font-bold text-white">{athleteA.name}</span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-sky-500/15 text-sky-300 border border-sky-500/30">
                  {coachLoadSummary.archetypeA.zoneTag}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 font-mono text-xs bg-[#090B0E] rounded-lg p-2.5 border border-[#1E2530]">
                <div>
                  <span className="text-[10px] text-slate-400 block">AVG LOAD/HR</span>
                  <span className="text-sm font-extrabold text-[#38BDF8]">
                    {coachLoadSummary.avgLoadPerHrA} TSS/h
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">NORM % FTP</span>
                  <span className="text-sm font-extrabold text-white">
                    {coachLoadSummary.avgIfPctA}% (~{coachLoadSummary.avgWattsA}W)
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">{windowDays}D VOLUME</span>
                  <span className="text-sm font-extrabold text-emerald-400">
                    {coachLoadSummary.totalHoursA}h ({coachLoadSummary.totalLoadA} TSS)
                  </span>
                </div>
              </div>

              {/* 3-Zone Session Intensity Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-mono text-slate-400">
                  <span>Z1/Z2 Base: {coachLoadSummary.binsA.lowPct}%</span>
                  <span>Z3 Tempo: {coachLoadSummary.binsA.modPct}%</span>
                  <span>Z4/Z5 Threshold+: {coachLoadSummary.binsA.highPct}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-800 overflow-hidden flex">
                  <div
                    style={{ width: `${coachLoadSummary.binsA.lowPct}%` }}
                    className="bg-emerald-500"
                  />
                  <div
                    style={{ width: `${coachLoadSummary.binsA.modPct}%` }}
                    className="bg-amber-500"
                  />
                  <div
                    style={{ width: `${coachLoadSummary.binsA.highPct}%` }}
                    className="bg-rose-500"
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                <strong className="text-slate-200">{coachLoadSummary.archetypeA.label}:</strong>{' '}
                {coachLoadSummary.archetypeA.description}
              </p>
            </div>

            {/* Athlete B Intensity Density Card */}
            <div className="lg:col-span-5 rounded-xl bg-[#0F131A] border border-orange-500/30 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#F97316]" />
                  <span className="text-xs font-bold text-white">{athleteB.name}</span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-orange-500/15 text-orange-300 border border-orange-500/30">
                  {coachLoadSummary.archetypeB.zoneTag}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 font-mono text-xs bg-[#090B0E] rounded-lg p-2.5 border border-[#1E2530]">
                <div>
                  <span className="text-[10px] text-slate-400 block">AVG LOAD/HR</span>
                  <span className="text-sm font-extrabold text-[#F97316]">
                    {coachLoadSummary.avgLoadPerHrB} TSS/h
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">NORM % FTP</span>
                  <span className="text-sm font-extrabold text-white">
                    {coachLoadSummary.avgIfPctB}% (~{coachLoadSummary.avgWattsB}W)
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">{windowDays}D VOLUME</span>
                  <span className="text-sm font-extrabold text-emerald-400">
                    {coachLoadSummary.totalHoursB}h ({coachLoadSummary.totalLoadB} TSS)
                  </span>
                </div>
              </div>

              {/* 3-Zone Session Intensity Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-mono text-slate-400">
                  <span>Z1/Z2 Base: {coachLoadSummary.binsB.lowPct}%</span>
                  <span>Z3 Tempo: {coachLoadSummary.binsB.modPct}%</span>
                  <span>Z4/Z5 Threshold+: {coachLoadSummary.binsB.highPct}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-800 overflow-hidden flex">
                  <div
                    style={{ width: `${coachLoadSummary.binsB.lowPct}%` }}
                    className="bg-emerald-500"
                  />
                  <div
                    style={{ width: `${coachLoadSummary.binsB.modPct}%` }}
                    className="bg-amber-500"
                  />
                  <div
                    style={{ width: `${coachLoadSummary.binsB.highPct}%` }}
                    className="bg-rose-500"
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                <strong className="text-slate-200">{coachLoadSummary.archetypeB.label}:</strong>{' '}
                {coachLoadSummary.archetypeB.description}
              </p>
            </div>

            {/* Right 2 Cols: Head-to-Head Intensity Delta & Coach Action */}
            <div className="lg:col-span-2 rounded-xl bg-[#0F131A] border border-[#1E2530] p-3.5 flex flex-col justify-between gap-3 font-mono">
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase text-slate-400 block">
                  INTENSITY DENSITY Δ
                </span>
                <div className="text-base font-extrabold text-white">
                  {coachLoadSummary.avgLoadPerHrA - coachLoadSummary.avgLoadPerHrB >= 0 ? '+' : ''}
                  {(coachLoadSummary.avgLoadPerHrA - coachLoadSummary.avgLoadPerHrB).toFixed(1)}{' '}
                  <span className="text-xs font-normal text-slate-400">TSS/hr</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  Peak: <span className="text-[#38BDF8]">{coachLoadSummary.peakLoadPerHrA}</span> vs{' '}
                  <span className="text-[#F97316]">{coachLoadSummary.peakLoadPerHrB}</span> TSS/h
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  onOpenCoachWithPrompt(
                    `Coach Load-per-Hour Comparison (${windowDays}D): ${athleteA.name} (FTP ${athleteA.ftp}W, ${athleteA.wPerKg} W/kg) averages ${coachLoadSummary.avgLoadPerHrA} TSS/hr (${coachLoadSummary.avgIfPctA}% FTP, ${coachLoadSummary.totalHoursA}h total, ${coachLoadSummary.archetypeA.label}) vs ${athleteB.name} (FTP ${athleteB.ftp}W, ${athleteB.wPerKg} W/kg) averaging ${coachLoadSummary.avgLoadPerHrB} TSS/hr (${coachLoadSummary.avgIfPctB}% FTP, ${coachLoadSummary.totalHoursB}h total, ${coachLoadSummary.archetypeB.label}). How should we rebalance their volume vs. intensity density for optimal progression?`
                  )
                }
                className="w-full py-2 px-2.5 rounded-lg bg-orange-500/15 hover:bg-orange-500/25 border border-orange-500/40 text-orange-300 text-[11px] font-sans font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                <Flame className="w-3.5 h-3.5 shrink-0" />
                <span>Coach Load Audit</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================
          CTL vs. RESTING HEART RATE (RHR) CORRELATION SCATTER PLOT & QUADRANT LAB
         ======================================================================== */}
      {focusMode !== 'COACH_LOAD_HOUR' && (
        <div className="rounded-xl bg-[#090B0E] border border-[#1E2530] p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#1E2530] pb-3">
            <div className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded">
                  <ScatterChart className="w-3 h-3" />
                  CARDIOVASCULAR DOSE-RESPONSE SCATTER LAB
                </span>
                <span className="text-[11px] font-mono text-slate-400">
                  X: CHRONIC TRAINING LOAD (CTL) vs. Y: MORNING RESTING HR (BPM)
                </span>
                <ChartInfoTooltip
                  title="CTL vs. Resting Heart Rate (RHR) Correlation Scatter"
                  subtitle="Stroke Volume Expansion vs. Sympathetic Overtraining Detector"
                  whatItMeasures="Plots daily 42-day Chronic Training Load (CTL) on the X-axis against morning Resting Heart Rate (bpm) on the Y-axis with Ordinary Least Squares (OLS) regression trendlines for selected athletes."
                  benchmarks="Negative Correlation (r < -0.25, downward slope): Healthy aerobic adaptation (left-ventricular eccentric hypertrophy & vagal tone lowering RHR as CTL builds). Positive Correlation (r > +0.25, upward slope in high-CTL quadrant): Sympathetic overreaching, cumulative sleep/glycogen debt, or early overtraining syndrome."
                  liveStatus={{
                    label: `${athleteA.name.split(' ')[0]}: r=${regressionA.r} (${regressionA.slopePer10Ctl} bpm/10 CTL) · ${athleteB.name.split(' ')[0]}: r=${regressionB.r} (${regressionB.slopePer10Ctl} bpm/10 CTL)`,
                    state:
                      regressionA.statusTone === 'strain' || regressionB.statusTone === 'strain'
                        ? 'warning'
                        : regressionA.statusTone === 'optimal'
                          ? 'optimal'
                          : 'caution',
                    interpretation: `${athleteA.name.split(' ')[0]}: ${regressionA.interpretation}`,
                  }}
                  coachingAction="If an athlete's points migrate into the top-right High CTL + Elevated RHR quadrant with a positive regression slope, prescribe a 48–72h Z1 recovery microcycle."
                />
              </div>
              <h4 className="text-sm font-bold text-white">
                CTL × Resting Heart Rate Physiological Adaptation &amp; Overtraining Quadrant Analyzer ({windowDays}D Window)
              </h4>
            </div>

            {/* Live Regression Badges for Athlete A & Athlete B */}
            <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono">
              <div className="px-3 py-1.5 rounded-lg bg-[#0F131A] border border-sky-500/40 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#38BDF8]" />
                <span className="text-white font-semibold">{athleteA.name.split(' ')[0]}:</span>
                {athleteA.redactedWellness ? (
                  <span className="text-amber-400 flex items-center gap-1">
                    <Lock className="w-3 h-3" /> RHR Masked
                  </span>
                ) : (
                  <>
                    <span className="text-[#38BDF8] font-bold">r = {regressionA.r}</span>
                    <span className="text-slate-400">
                      ({regressionA.slopePer10Ctl >= 0 ? `+${regressionA.slopePer10Ctl}` : regressionA.slopePer10Ctl} bpm/10 CTL)
                    </span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] ${
                        regressionA.statusTone === 'optimal'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : regressionA.statusTone === 'strain'
                            ? 'bg-rose-500/20 text-rose-300'
                            : 'bg-sky-500/20 text-sky-300'
                      }`}
                    >
                      {regressionA.statusLabel}
                    </span>
                  </>
                )}
              </div>

              <div className="px-3 py-1.5 rounded-lg bg-[#0F131A] border border-orange-500/40 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#F97316]" />
                <span className="text-white font-semibold">{athleteB.name.split(' ')[0]}:</span>
                {athleteB.redactedWellness ? (
                  <span className="text-amber-400 flex items-center gap-1">
                    <Lock className="w-3 h-3" /> RHR Masked
                  </span>
                ) : (
                  <>
                    <span className="text-[#F97316] font-bold">r = {regressionB.r}</span>
                    <span className="text-slate-400">
                      ({regressionB.slopePer10Ctl >= 0 ? `+${regressionB.slopePer10Ctl}` : regressionB.slopePer10Ctl} bpm/10 CTL)
                    </span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] ${
                        regressionB.statusTone === 'optimal'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : regressionB.statusTone === 'strain'
                            ? 'bg-rose-500/20 text-rose-300'
                            : 'bg-amber-500/20 text-amber-300'
                      }`}
                    >
                      {regressionB.statusLabel}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Scatter SVG Canvas */}
          <div className="overflow-x-auto">
            <svg
              viewBox={`0 0 ${scatterW} ${scatterH}`}
              className="w-full h-auto min-w-[740px] select-none"
            >
              <rect
                x={sLeft}
                y={sTop}
                width={sPlotW}
                height={sPlotH}
                fill="#0D1117"
                stroke="#1E2530"
              />

              {/* Top-Right: High CTL + Elevated RHR -> Sympathetic Overreaching Warning */}
              <rect
                x={xScatterCtl(midCtl)}
                y={sTop}
                width={sRight - xScatterCtl(midCtl)}
                height={yScatterRhr(midRhr) - sTop}
                fill="#F43F5E"
                fillOpacity="0.055"
              />
              <text
                x={sRight - 10}
                y={sTop + 16}
                textAnchor="end"
                className="fill-rose-400/80 text-[10px] font-mono uppercase tracking-wider"
              >
                ▲ HIGH CTL + ELEVATED RHR (SYMPATHETIC OVERREACHING / OVERTRAINING RISK)
              </text>

              {/* Bottom-Right: High CTL + Low RHR -> Aerobic Supercompensation / Adaptation */}
              <rect
                x={xScatterCtl(midCtl)}
                y={yScatterRhr(midRhr)}
                width={sRight - xScatterCtl(midCtl)}
                height={sBottom - yScatterRhr(midRhr)}
                fill="#10B981"
                fillOpacity="0.06"
              />
              <text
                x={sRight - 10}
                y={sBottom - 10}
                textAnchor="end"
                className="fill-emerald-400/85 text-[10px] font-mono uppercase tracking-wider"
              >
                ▼ HIGH CTL + LOWER RHR (AEROBIC ADAPTATION &amp; STROKE VOLUME EXPANSION)
              </text>

              <text
                x={sLeft + 10}
                y={sTop + 16}
                textAnchor="start"
                className="fill-amber-400/75 text-[10px] font-mono uppercase tracking-wider"
              >
                ▲ LOW CTL + ELEVATED RHR (ACUTE STRESS / RECOVERY DEBT)
              </text>

              <text
                x={sLeft + 10}
                y={sBottom - 10}
                textAnchor="start"
                className="fill-sky-400/75 text-[10px] font-mono uppercase tracking-wider"
              >
                ▼ MODERATE CTL + LOW RHR (FRESH PARASYMPATHETIC BASELINE)
              </text>

              {/* Quadrant Divider Crosshairs */}
              <line
                x1={xScatterCtl(midCtl)}
                y1={sTop}
                x2={xScatterCtl(midCtl)}
                y2={sBottom}
                stroke="#334155"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
              <line
                x1={sLeft}
                y1={yScatterRhr(midRhr)}
                x2={sRight}
                y2={yScatterRhr(midRhr)}
                stroke="#334155"
                strokeWidth="1"
                strokeDasharray="4 4"
              />

              {/* X-Axis Gridlines & Labels (CTL) */}
              {ctlAxisTicks.map((ctlTick) => {
                const x = xScatterCtl(ctlTick);
                return (
                  <g key={`s-ctl-${ctlTick}`}>
                    <line
                      x1={x}
                      y1={sTop}
                      x2={x}
                      y2={sBottom}
                      stroke="#1E2530"
                      strokeDasharray="2 3"
                    />
                    <text
                      x={x}
                      y={sBottom + 16}
                      textAnchor="middle"
                      className="fill-slate-400 text-[10px] font-mono"
                    >
                      {ctlTick} CTL
                    </text>
                  </g>
                );
              })}

              {/* Y-Axis Gridlines & Labels (Resting HR bpm) */}
              {rhrAxisTicks.map((rhrTick) => {
                const y = yScatterRhr(rhrTick);
                return (
                  <g key={`s-rhr-${rhrTick}`}>
                    <line
                      x1={sLeft}
                      y1={y}
                      x2={sRight}
                      y2={y}
                      stroke="#1E2530"
                      strokeDasharray="2 3"
                    />
                    <text
                      x={sLeft - 8}
                      y={y + 3}
                      textAnchor="end"
                      className="fill-slate-400 text-[10px] font-mono"
                    >
                      {rhrTick} bpm
                    </text>
                  </g>
                );
              })}

              {/* Axis Titles */}
              <text
                x={sLeft + sPlotW / 2}
                y={scatterH - 6}
                textAnchor="middle"
                className="fill-slate-300 text-[11px] font-mono uppercase tracking-wider"
              >
                CHRONIC TRAINING LOAD (CTL — 42-DAY FITNESS) →
              </text>
              <text
                x={16}
                y={sTop + sPlotH / 2}
                transform={`rotate(-90 16 ${sTop + sPlotH / 2})`}
                textAnchor="middle"
                className="fill-slate-300 text-[11px] font-mono uppercase tracking-wider"
              >
                RESTING HR (BPM) →
              </text>

              {/* OLS Linear Regression Trendline for Athlete A */}
              {!athleteA.redactedWellness && !athleteA.redactedPmc && (
                <line
                  x1={xScatterCtl(ctlMin + 1)}
                  y1={yScatterRhr(regressionA.slope * (ctlMin + 1) + regressionA.intercept)}
                  x2={xScatterCtl(ctlMax - 1)}
                  y2={yScatterRhr(regressionA.slope * (ctlMax - 1) + regressionA.intercept)}
                  stroke="#38BDF8"
                  strokeWidth="2"
                  strokeDasharray="6 4"
                  opacity="0.75"
                />
              )}

              {/* OLS Linear Regression Trendline for Athlete B */}
              {!athleteB.redactedWellness && !athleteB.redactedPmc && (
                <line
                  x1={xScatterCtl(ctlMin + 1)}
                  y1={yScatterRhr(regressionB.slope * (ctlMin + 1) + regressionB.intercept)}
                  x2={xScatterCtl(ctlMax - 1)}
                  y2={yScatterRhr(regressionB.slope * (ctlMax - 1) + regressionB.intercept)}
                  stroke="#F97316"
                  strokeWidth="2"
                  strokeDasharray="3 3"
                  opacity="0.75"
                />
              )}

              {/* Athlete A Scatter Points */}
              {!athleteA.redactedWellness &&
                !athleteA.redactedPmc &&
                alignedSeries.map((row, idx) => {
                  const cx = xScatterCtl(row.aCtl);
                  const cy = yScatterRhr(row.aRhr);
                  const isLatest = idx === alignedSeries.length - 1;
                  const isSelected = activeScatterIdx === idx;
                  const alpha = 0.35 + (idx / Math.max(1, alignedSeries.length - 1)) * 0.65;

                  return (
                    <g
                      key={`scat-a-${row.date}-${idx}`}
                      className="cursor-pointer"
                      onMouseEnter={() => {
                        setHoveredScatterPoint({ athleteSlot: 'A', idx });
                        setHoverIdx(idx);
                      }}
                      onMouseLeave={() => setHoveredScatterPoint(null)}
                    >
                      {(isLatest || isSelected) && (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={isSelected ? 9 : 7.5}
                          fill="none"
                          stroke="#38BDF8"
                          strokeWidth="1.5"
                          opacity="0.85"
                        />
                      )}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={isLatest || isSelected ? 5.2 : 3.8}
                        fill="#38BDF8"
                        fillOpacity={alpha}
                        stroke="#090B0E"
                        strokeWidth="1.2"
                      />
                    </g>
                  );
                })}

              {/* Athlete B Scatter Points */}
              {!athleteB.redactedWellness &&
                !athleteB.redactedPmc &&
                alignedSeries.map((row, idx) => {
                  const cx = xScatterCtl(row.bCtl);
                  const cy = yScatterRhr(row.bRhr);
                  const isLatest = idx === alignedSeries.length - 1;
                  const isSelected = activeScatterIdx === idx;
                  const alpha = 0.35 + (idx / Math.max(1, alignedSeries.length - 1)) * 0.65;

                  return (
                    <g
                      key={`scat-b-${row.date}-${idx}`}
                      className="cursor-pointer"
                      onMouseEnter={() => {
                        setHoveredScatterPoint({ athleteSlot: 'B', idx });
                        setHoverIdx(idx);
                      }}
                      onMouseLeave={() => setHoveredScatterPoint(null)}
                    >
                      {(isLatest || isSelected) && (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={isSelected ? 9 : 7.5}
                          fill="none"
                          stroke="#F97316"
                          strokeWidth="1.5"
                          opacity="0.85"
                        />
                      )}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={isLatest || isSelected ? 5.2 : 3.8}
                        fill="#F97316"
                        fillOpacity={alpha}
                        stroke="#090B0E"
                        strokeWidth="1.2"
                      />
                    </g>
                  );
                })}
            </svg>
          </div>

          {/* Scatter Point Inspector & Physiological Interpretation Footer */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 pt-1">
            <div className="lg:col-span-5 rounded-lg bg-[#0F131A] border border-[#1E2530] p-3 flex items-start gap-2.5">
              {regressionA.statusTone === 'strain' ? (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-[#38BDF8] shrink-0 mt-0.5" />
              )}
              <div className="text-xs leading-relaxed">
                <div className="font-mono font-bold text-white">
                  {athleteA.name}:{' '}
                  <span className="text-[#38BDF8]">{regressionA.statusLabel}</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {athleteA.redactedWellness
                    ? 'Resting HR and HRV are hidden by this friend’s Privacy Shield.'
                    : regressionA.interpretation}
                </p>
              </div>
            </div>

            <div className="lg:col-span-5 rounded-lg bg-[#0F131A] border border-[#1E2530] p-3 flex items-start gap-2.5">
              {regressionB.statusTone === 'strain' ? (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-[#F97316] shrink-0 mt-0.5" />
              )}
              <div className="text-xs leading-relaxed">
                <div className="font-mono font-bold text-white">
                  {athleteB.name}:{' '}
                  <span className="text-[#F97316]">{regressionB.statusLabel}</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {athleteB.redactedWellness
                    ? 'Resting HR and HRV are hidden by this friend’s Privacy Shield.'
                    : regressionB.interpretation}
                </p>
              </div>
            </div>

            <div className="lg:col-span-2 rounded-lg bg-[#0F131A] border border-[#1E2530] p-3 flex flex-col justify-between font-mono text-[11px]">
              <span className="text-slate-400 uppercase text-[10px]">
                POINT ({activeScatterRow.date})
              </span>
              <div className="text-[#38BDF8]">
                A: {activeScatterRow.aCtl.toFixed(0)} CTL ·{' '}
                {athleteA.redactedWellness ? '—' : `${activeScatterRow.aRhr}bpm`}
              </div>
              <div className="text-[#F97316]">
                B: {activeScatterRow.bCtl.toFixed(0)} CTL ·{' '}
                {athleteB.redactedWellness ? '—' : `${activeScatterRow.bRhr}bpm`}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom 4-Column Head-to-Head Coaching Diagnostic Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Card 1: CTL Base & Ramp Rate */}
        <div className="rounded-xl liquid-glass-subtle p-3.5 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400">
            <span>AEROBIC BASE &amp; {windowDays}D RAMP</span>
            <TrendingUp className="w-3.5 h-3.5 text-sky-400" />
          </div>
          <div className="flex items-baseline justify-between font-mono">
            <div>
              <span className="text-xs text-slate-400 block">{athleteA.name.split(' ')[0]}</span>
              <span className="text-base font-extrabold text-[#38BDF8]">
                {activePoint.aCtl.toFixed(1)}{' '}
                <span className="text-[11px] font-normal">
                  ({aCtlRamp >= 0 ? `+${aCtlRamp}` : aCtlRamp})
                </span>
              </span>
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-400 block">{athleteB.name.split(' ')[0]}</span>
              <span className="text-base font-extrabold text-[#F97316]">
                {activePoint.bCtl.toFixed(1)}{' '}
                <span className="text-[11px] font-normal">
                  ({bCtlRamp >= 0 ? `+${bCtlRamp}` : bCtlRamp})
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* Card 2: FTP-Normalized Load-per-Hour */}
        <div className="rounded-xl liquid-glass-subtle p-3.5 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400">
            <span>FTP-NORM LOAD/HR (TSS/H)</span>
            <BarChart3 className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="flex items-baseline justify-between font-mono">
            <div>
              <span className="text-xs text-slate-400 block">
                {coachLoadSummary.avgIfPctA}% of {athleteA.ftp}W
              </span>
              <span className="text-base font-extrabold text-[#38BDF8]">
                {coachLoadSummary.avgLoadPerHrA} TSS/h
              </span>
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-400 block">
                {coachLoadSummary.avgIfPctB}% of {athleteB.ftp}W
              </span>
              <span className="text-base font-extrabold text-[#F97316]">
                {coachLoadSummary.avgLoadPerHrB} TSS/h
              </span>
            </div>
          </div>
        </div>

        {/* Card 3: Autonomic RHR & HRV Comparison */}
        <div className="rounded-xl liquid-glass-subtle p-3.5 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400">
            <span>RESTING HR &amp; HRV (rMSSD)</span>
            <HeartPulse className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <div className="flex items-baseline justify-between font-mono">
            <div>
              <span className="text-xs text-slate-400 block">{formZoneA.label}</span>
              <span className="text-base font-extrabold text-[#38BDF8]">
                {athleteA.redactedWellness
                  ? 'Masked'
                  : `${activePoint.aRhr}bpm · ${activePoint.aHrv}ms`}
              </span>
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-400 block">{formZoneB.label}</span>
              <span className="text-base font-extrabold text-[#F97316]">
                {athleteB.redactedWellness
                  ? 'Masked'
                  : `${activePoint.bRhr}bpm · ${activePoint.bHrv}ms`}
              </span>
            </div>
          </div>
        </div>

        {/* Card 4: Specific Power Parity & AI Coach Synthesis */}
        <div className="rounded-xl liquid-glass-subtle p-3.5 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400">
            <span>SPECIFIC POWER ({athleteA.wPerKg} vs {athleteB.wPerKg} W/kg)</span>
            <Zap className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <button
            type="button"
            onClick={() =>
              onOpenCoachWithPrompt(
                `Compare ${athleteA.name} (CTL ${activePoint.aCtl.toFixed(1)}, FTP ${athleteA.ftp}W, Load/Hr ${coachLoadSummary.avgLoadPerHrA} TSS/hr [${coachLoadSummary.avgIfPctA}% FTP], RHR ${athleteA.redactedWellness ? 'masked' : activePoint.aRhr + 'bpm'}, CTL×RHR r=${regressionA.r}) vs ${athleteB.name} (CTL ${activePoint.bCtl.toFixed(1)}, FTP ${athleteB.ftp}W, Load/Hr ${coachLoadSummary.avgLoadPerHrB} TSS/hr [${coachLoadSummary.avgIfPctB}% FTP], RHR ${athleteB.redactedWellness ? 'masked' : activePoint.bRhr + 'bpm'}, CTL×RHR r=${regressionB.r}). How do their FTP-normalized training intensities compare and what adjustments should we make?`
              )
            }
            className="w-full py-1.5 px-3 rounded-lg bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-xs transition-all"
          >
            <Bot className="w-3.5 h-3.5" />
            <span>Ask AI Coach: Load/Hr &amp; Adaptation Rx</span>
          </button>
        </div>
      </div>
    </section>
  );
};
