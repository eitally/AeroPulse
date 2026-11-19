import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  Database,
  Flame,
  Gauge,
  LineChart,
  Sliders,
  Timer,
  TrendingUp,
  Zap,
} from './icons/PhosphorIcons';
import type {
  AnnualMileageGoal,
  AthleteProfile,
  BenchmarkSegmentHistory,
  DistanceUnit,
  EnvironmentFilter,
  SportCategory,
  StravaSyncWindow,
  TargetGoal,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import { INITIAL_POWER_PACE_CURVES } from '../data/mockTelemetry';
import { PhysiologyView } from './PhysiologyView';
import { PhysiologicalTrendsView } from './PhysiologicalTrendsView';
import { CustomChartsView } from './CustomChartsView';
import { TrackProgressionAndCalibrationPanel } from './track/TrackProgressionAndCalibrationPanel';
import { ChartInfoTooltip } from './ChartInfoTooltip';
import { computeFatigueSlicedDurability } from '../physiology/durabilityEngine';
import {
  computeAnnualMileageSummary,
  convertMetersToUnit,
  convertUnitToMeters,
  formatDistance,
  formatDuration,
  formatPace,
} from '../utils/formatters';
import { buildCompleteAthleteProfile } from '../utils/telemetryStorage';

import { getLocalDateIso } from '../physiology/stravaLoadCalibration';

export type DeepDiveSectionId = 'CURVES' | 'DURABILITY' | 'PROGRESSION' | 'TRENDS';

export interface TodayPhysiologyDeepDiveProps {
  activities: UnifiedActivity[];
  wellnessDays: UnifiedWellnessDay[];
  annualMileageGoals: AnnualMileageGoal[];
  targetGoals: TargetGoal[];
  benchmarkSegments: BenchmarkSegmentHistory[];
  envFilter: EnvironmentFilter;
  onSelectEnvFilter: (env: EnvironmentFilter) => void;
  distanceUnit: DistanceUnit;
  athleteWeightKg: number;
  currentCtl: number;
  athleteProfile: AthleteProfile;
  isScanningSegments: boolean;
  stravaSyncWindow?: StravaSyncWindow;
  initialOpen?: boolean;
  initialSection?: DeepDiveSectionId;
  standalone?: boolean;
  initialTrendsSubView?: 'TRENDS' | 'CUSTOM_LAB';
  onScanMoreSegments: () => Promise<void>;
  onSelectActivity: (act: UnifiedActivity) => void;
  onOpenActivitiesSegments: () => void;
  onOpenCoachWithPrompt: (prompt: string) => void;
  onUpdateAnnualMileageGoal: (sport: 'Running' | 'Cycling', targetMeters: number) => void;
  onSaveProfileOverride: (updated: AthleteProfile) => Promise<void>;
  onOpenOfficialRaceModal?: () => void;
  onOpenDataSources?: () => void;
}

const ALL_SPORTS_LIST: SportCategory[] = ['Cycling', 'Running', 'Swimming', 'Strength', 'Multisport'];

const TodayPhysiologyDeepDiveInner: React.FC<TodayPhysiologyDeepDiveProps> = ({
  activities,
  wellnessDays,
  annualMileageGoals,
  targetGoals,
  benchmarkSegments,
  envFilter,
  onSelectEnvFilter,
  distanceUnit,
  athleteWeightKg,
  currentCtl,
  athleteProfile,
  isScanningSegments,
  stravaSyncWindow,
  initialOpen = false,
  initialSection = 'CURVES',
  standalone = false,
  initialTrendsSubView = 'TRENDS',
  onScanMoreSegments,
  onSelectActivity,
  onOpenActivitiesSegments,
  onOpenCoachWithPrompt,
  onUpdateAnnualMileageGoal,
  onSaveProfileOverride,
  onOpenOfficialRaceModal,
  onOpenDataSources,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    if (initialOpen) return true;
    try {
      return window.localStorage.getItem('thresh_today_deep_dive_open') === '1';
    } catch {
      return false;
    }
  });
  const [activeSection, setActiveSection] = useState<DeepDiveSectionId>(initialSection);
  const [trendsSubView, setTrendsSubView] = useState<'TRENDS' | 'CUSTOM_LAB'>(initialTrendsSubView);
  const [durabilitySport, setDurabilitySport] = useState<'Cycling' | 'Running'>(() =>
    athleteProfile.primarySport === 'Running' ? 'Running' : 'Cycling'
  );
  const [calibrationToast, setCalibrationToast] = useState<string | null>(null);
  const [totalsPeriod, setTotalsPeriod] = useState<'28d' | '90d' | 'YTD' | 'ALL'>('YTD');
  const [selectedPolarizationSports, setSelectedPolarizationSports] =
    useState<SportCategory[]>(ALL_SPORTS_LIST);
  const formId = useId();

  useEffect(() => {
    if (initialOpen || standalone) {
      setIsOpen(true);
    }
  }, [initialOpen, standalone]);

  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection);
    }
  }, [initialSection]);

  useEffect(() => {
    if (initialTrendsSubView) {
      setTrendsSubView(initialTrendsSubView);
    }
  }, [initialTrendsSubView]);

  const setOpenPersisted = (next: boolean) => {
    setIsOpen(next);
    try {
      window.localStorage.setItem('thresh_today_deep_dive_open', next ? '1' : '0');
    } catch {
      // ignore storage failure
    }
  };

  const handleSelectSection = (sec: DeepDiveSectionId) => {
    setActiveSection(sec);
    if (!isOpen) {
      setOpenPersisted(true);
    }
  };

  const currentYear = new Date().getFullYear();
  const todayIso = getLocalDateIso();

  const runGoal = annualMileageGoals.find((g) => g.sportCategory === 'Running') || {
    sportCategory: 'Running' as const,
    year: currentYear,
    targetDistanceMeters: 0,
  };
  const bikeGoal = annualMileageGoals.find((g) => g.sportCategory === 'Cycling') || {
    sportCategory: 'Cycling' as const,
    year: currentYear,
    targetDistanceMeters: 0,
  };

  const [runInput, setRunInput] = useState<string>(() =>
    Math.round(convertMetersToUnit(runGoal.targetDistanceMeters, distanceUnit)).toString()
  );
  const [bikeInput, setBikeInput] = useState<string>(() =>
    Math.round(convertMetersToUnit(bikeGoal.targetDistanceMeters, distanceUnit)).toString()
  );

  useEffect(() => {
    setRunInput(Math.round(convertMetersToUnit(runGoal.targetDistanceMeters, distanceUnit)).toString());
    setBikeInput(Math.round(convertMetersToUnit(bikeGoal.targetDistanceMeters, distanceUnit)).toString());
  }, [distanceUnit, runGoal.targetDistanceMeters, bikeGoal.targetDistanceMeters]);

  const runSummary = useMemo(
    () => computeAnnualMileageSummary('Running', runGoal.targetDistanceMeters, activities, envFilter),
    [runGoal.targetDistanceMeters, activities, envFilter]
  );
  const bikeSummary = useMemo(
    () => computeAnnualMileageSummary('Cycling', bikeGoal.targetDistanceMeters, activities, envFilter),
    [bikeGoal.targetDistanceMeters, activities, envFilter]
  );

  const durabilityReport = useMemo(() => {
    return computeFatigueSlicedDurability({
      discipline: durabilitySport,
      activities,
      streamMap: new Map(),
      athleteProfile,
    });
  }, [durabilitySport, activities, athleteProfile]);

  const raceAndFtpPredictions = useMemo(() => {
    const latestWithRunEftp = [...wellnessDays].reverse().find((w) => w.runEftp && w.runEftp > 150);
    const runEftp = athleteProfile.runFtp || latestWithRunEftp?.runEftp || 0;
    const vo2maxRun =
      athleteProfile.vo2MaxRunning ||
      latestWithRunEftp?.vo2MaxRunning ||
      latestWithRunEftp?.vo2MaxCycling ||
      0;
    const currentFtp = athleteProfile.ftp || latestWithRunEftp?.rideEftp || 0;
    const weightKg = Math.max(40, athleteProfile.weightKg || latestWithRunEftp?.weightKg || 70);
    const thresholdSpeedMps =
      runEftp > 0 ? 3.35 + ((Math.min(420, Math.max(240, runEftp)) - 260) / 160) * 0.85 : 0;
    const thresholdPaceSecsPerKm =
      athleteProfile.thresholdPaceSecsPerKm &&
      athleteProfile.thresholdPaceSecsPerKm >= 130 &&
      athleteProfile.thresholdPaceSecsPerKm <= 600
        ? athleteProfile.thresholdPaceSecsPerKm
        : thresholdSpeedMps > 0
          ? Math.round(1000 / thresholdSpeedMps)
          : 0;

    const explicitFtpGoal = targetGoals.find(
      (g) => g.sportCategory === 'Cycling' && g.unit.toUpperCase() === 'W' && g.targetValue > 0
    );
    const targetFtp =
      explicitFtpGoal?.targetValue ||
      (currentFtp > 0 ? Math.max(currentFtp + 15, Math.round(currentFtp * 1.08)) : 0);

    const events = [
      { label: '1 Mile', meters: 1609.34, factor: 0.89 },
      { label: '5K Road', meters: 5000, factor: 0.952 },
      { label: '10K Road', meters: 10000, factor: 0.995 },
      { label: 'Half Marathon', meters: 21097.5, factor: 1.045 },
      { label: 'Marathon', meters: 42195, factor: 1.105 },
    ].map((d) => {
      const paceSecsPerKm =
        thresholdPaceSecsPerKm > 0 ? Math.round(thresholdPaceSecsPerKm * d.factor) : 0;
      const totalSecs =
        paceSecsPerKm > 0 ? Math.round((d.meters / 1000) * paceSecsPerKm) : 0;
      return { label: d.label, paceSecsPerKm, totalSecs };
    });

    return {
      runEftp: Math.round(runEftp),
      vo2maxRun,
      thresholdPaceSecsPerKm,
      currentFtp,
      weightKg,
      targetFtp,
      ftp30d: currentFtp > 0 ? Math.round(currentFtp * 1.025) : 0,
      ftp60d: currentFtp > 0 ? Math.round(currentFtp * 1.052) : 0,
      events,
    };
  }, [wellnessDays, athleteProfile, targetGoals]);

  const paceAndPowerInsights = useMemo(() => {
    const recent14 = activities.slice(0, 14);
    const qualitySessions = recent14.filter(
      (a) =>
        (a.intensityFactor && a.intensityFactor >= 0.8) ||
        a.trainingLoad >= 55 ||
        /interval|threshold|tempo|vo2|race|track|sweet/i.test(a.name)
    );
    if (qualitySessions.length === 0) {
      return {
        badgeLabel: 'Awaiting Quality Work',
        headline: 'Log structured workouts with pace, power, or HR to unlock auto-calibration.',
        currentFtp: raceAndFtpPredictions.currentFtp,
        suggestedFtp: raceAndFtpPredictions.currentFtp,
        currentThreshPace: raceAndFtpPredictions.thresholdPaceSecsPerKm,
        suggestedPaceSecsPerKm: raceAndFtpPredictions.thresholdPaceSecsPerKm,
        qualityCount: 0,
      };
    }
    const avgDecoupling =
      qualitySessions.reduce((acc, a) => acc + (a.aerobicDecouplingPct ?? 0), 0) /
      qualitySessions.length;
    const avgIf =
      qualitySessions.reduce((acc, a) => acc + (a.intensityFactor ?? 0.8), 0) /
      qualitySessions.length;
    const isAhead = avgDecoupling > 0 && avgDecoupling <= 3.6 && avgIf >= 0.82;
    const isStrained = avgDecoupling > 5.2;
    const curFtp = raceAndFtpPredictions.currentFtp;
    const curPace = raceAndFtpPredictions.thresholdPaceSecsPerKm;
    return {
      badgeLabel: isAhead ? 'Strong Adaptation (+2%)' : isStrained ? 'High Drift' : 'On Target',
      headline: isAhead
        ? `Quality workouts held ${avgDecoupling.toFixed(1)}% cardiac drift (<3.5% ceiling).`
        : isStrained
          ? `Quality workouts averaged ${avgDecoupling.toFixed(1)}% drift; consider easing targets slightly.`
          : `Interval compliance and drift (${avgDecoupling.toFixed(1)}%) are steady.`,
      currentFtp: curFtp,
      suggestedFtp: curFtp > 0 ? (isAhead ? curFtp + 6 : isStrained ? Math.max(120, curFtp - 5) : curFtp + 3) : 0,
      currentThreshPace: curPace,
      suggestedPaceSecsPerKm: curPace > 0 ? (isAhead ? Math.max(145, curPace - 4) : isStrained ? curPace + 4 : Math.max(145, curPace - 2)) : 0,
      qualityCount: qualitySessions.length,
    };
  }, [activities, raceAndFtpPredictions]);

  const isAllSportsSelected = selectedPolarizationSports.length === ALL_SPORTS_LIST.length;

  const totalsAndPolarization = useMemo(() => {
    const latestDate =
      activities.length > 0 ? activities[0].startDateLocal.slice(0, 10) : todayIso;
    const latestMs = new Date(`${latestDate}T23:59:59Z`).getTime();
    const filtered = activities.filter((act) => {
      if (!isAllSportsSelected && !selectedPolarizationSports.includes(act.sportCategory)) return false;
      if (envFilter !== 'COMBINED' && act.environment !== envFilter) return false;
      const d = act.startDateLocal.slice(0, 10);
      if (totalsPeriod === 'YTD') return d.startsWith(latestDate.slice(0, 4));
      if (totalsPeriod === 'ALL') return true;
      const days = totalsPeriod === '28d' ? 28 : 90;
      const actMs = new Date(`${d}T12:00:00Z`).getTime();
      return latestMs - actMs <= days * 86400 * 1000;
    });

    let totalSecs = 0;
    let totalLoad = 0;
    let totalDistMeters = 0;
    let lowSecs = 0;
    let modSecs = 0;
    let highSecs = 0;
    for (const act of filtered) {
      totalSecs += act.movingTimeSecs || 0;
      totalLoad += act.trainingLoad || 0;
      totalDistMeters += act.distanceMeters || 0;
      const zArr =
        act.zoneSecs?.power && act.zoneSecs.power.some((s) => s > 0)
          ? act.zoneSecs.power
          : act.zoneSecs?.hr || [];
      if (zArr.some((s) => s > 0)) {
        lowSecs += (zArr[0] || 0) + (zArr[1] || 0);
        modSecs += zArr[2] || 0;
        highSecs += (zArr[3] || 0) + (zArr[4] || 0) + (zArr[5] || 0) + (zArr[6] || 0);
      } else {
        const ifVal = act.intensityFactor || 0.72;
        if (ifVal < 0.78) lowSecs += act.movingTimeSecs;
        else if (ifVal < 0.9) modSecs += act.movingTimeSecs;
        else highSecs += act.movingTimeSecs;
      }
    }
    const totZ = Math.max(1, lowSecs + modSecs + highSecs);
    const lowPct = Math.round((lowSecs / totZ) * 100);
    const modPct = Math.round((modSecs / totZ) * 100);
    const highPct = Math.max(0, 100 - lowPct - modPct);
    const distributionStyle =
      lowPct >= 75 && highPct >= 12 && modPct <= 12
        ? 'Polarized (80/20)'
        : modPct >= 25
          ? 'Threshold-Heavy'
          : lowPct >= 82
            ? 'Aerobic Base'
            : 'Pyramidal';
    return {
      count: filtered.length,
      totalSecs,
      totalDistMeters,
      totalLoad,
      lowPct,
      modPct,
      highPct,
      distributionStyle,
    };
  }, [activities, envFilter, totalsPeriod, isAllSportsSelected, selectedPolarizationSports, todayIso]);

  const sixZoneLevels = useMemo(() => {
    const recent28 = activities.slice(0, 40);
    const zSecs = [0, 0, 0, 0, 0, 0, 0];
    for (const act of recent28) {
      const pArr = act.zoneSecs?.power || [];
      const hArr = act.zoneSecs?.hr || [];
      const zArr = pArr.some((v) => v > 0) ? pArr : hArr;
      if (zArr.some((v) => v > 0)) {
        for (let i = 0; i < 7; i++) zSecs[i] += zArr[i] || 0;
      } else {
        zSecs[1] += act.movingTimeSecs * 0.65;
        zSecs[3] += act.movingTimeSecs * 0.25;
        zSecs[4] += act.movingTimeSecs * 0.1;
      }
    }
    const hasActs = recent28.length > 0;
    const ctlFactor = currentCtl > 0 ? Math.min(2.2, Math.max(0.6, currentCtl / 65)) : 1;
    const clampLvl = (v: number) => (hasActs ? Number(Math.min(9.9, Math.max(1.0, v)).toFixed(1)) : 0);
    return [
      { code: 'Z2', name: 'Endurance & Durability', level: clampLvl(1.5 + (zSecs[1] / 3600) * 0.45 * ctlFactor), color: '#0D9488' },
      { code: 'Z3', name: 'Tempo / Sweet Spot', level: clampLvl(1.2 + (zSecs[2] / 1800) * 0.5 * ctlFactor), color: '#D97706' },
      { code: 'Z4', name: 'Lactate Threshold', level: clampLvl(1.2 + (zSecs[3] / 1200) * 0.55 * ctlFactor), color: '#EA580C' },
      { code: 'Z5', name: 'VO2max Ceiling', level: clampLvl(1.0 + (zSecs[4] / 600) * 0.55 * ctlFactor), color: '#DC2626' },
      { code: 'Z6', name: "Anaerobic Capacity (W')", level: clampLvl(1.0 + (zSecs[5] / 300) * 0.55 * ctlFactor), color: '#7C3AED' },
      { code: 'Z7', name: 'Neuromuscular Sprint', level: clampLvl(1.0 + (zSecs[6] / 120) * 0.5 * ctlFactor), color: '#7C3AED' },
    ];
  }, [activities, currentCtl]);

  const navTabs: Array<{ id: DeepDiveSectionId; label: string; icon: typeof BarChart3 }> = [
    { id: 'CURVES', label: 'Power, Pace & PRs', icon: BarChart3 },
    { id: 'DURABILITY', label: 'Durability & Distribution', icon: Flame },
    { id: 'PROGRESSION', label: 'Zone Progression & Calibration', icon: Gauge },
    { id: 'TRENDS', label: 'Trends & Custom Lab', icon: TrendingUp },
  ];

  const renderStrava90dCue = () => {
    if (stravaSyncWindow !== '90d') return null;
    return (
      <div
        data-testid="strava-90d-history-cue"
        className="rounded-xl liquid-glass-subtle px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs"
      >
        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
          <Database className="w-4 h-4 ap-text-brand shrink-0" />
          <span>
            Showing your recent <strong>90-day Strava sync window</strong>. Pull all-time seasons or import your full Strava <code>.zip</code> archive anytime.
          </span>
        </div>
        {onOpenDataSources && (
          <button
            type="button"
            onClick={onOpenDataSources}
            className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl ap-btn-secondary text-xs font-semibold cursor-pointer whitespace-nowrap"
          >
            Sync Full History
          </button>
        )}
      </div>
    );
  };

  const effectiveOpen = standalone ? true : isOpen;

  return (
    <section
      data-testid={standalone ? 'standalone-progress-view' : 'today-physiology-deep-dive'}
      aria-label="Physiology & Telemetry Deep-Dive"
      className="rounded-2xl liquid-glass p-4 sm:p-5 space-y-4"
    >
      <div
        data-testid={standalone ? 'today-physiology-deep-dive' : undefined}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        {standalone ? (
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl bg-[#E3ECE5] dark:bg-[#15231B] flex items-center justify-center text-[#1C5436] dark:text-[#C8FF00] shrink-0">
              <Sliders className="w-4 h-4" weight="duotone" />
            </span>
            <div>
              <h1 className="text-lg sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                Progress &amp; Physiology Analytics
              </h1>
              <p className="text-2xs text-slate-600 dark:text-slate-300">
                Power/Pace curves, Durability, Zone progression, Calibration &amp; Custom charts
              </p>
            </div>
          </div>
        ) : (
          <button
            type="button"
            data-testid="today-physiology-deep-dive-toggle"
            aria-expanded={effectiveOpen}
            onClick={() => setOpenPersisted(!isOpen)}
            className="min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-2 text-left cursor-pointer group"
          >
            <span className="w-8 h-8 rounded-xl bg-[#E3ECE5] dark:bg-[#15231B] flex items-center justify-center text-[#1C5436] dark:text-[#C8FF00] shrink-0">
              <Sliders className="w-4 h-4" weight="duotone" />
            </span>
            <span>
              <span className="block text-sm sm:text-base font-bold text-slate-900 dark:text-white group-hover:underline">
                Physiology &amp; Telemetry Deep-Dive
              </span>
              <span className="block text-2xs text-slate-500 dark:text-slate-400">
                Power/Pace curves, Durability, Zone progression, Calibration &amp; Custom charts
              </span>
            </span>
            <span className="ml-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg liquid-glass-subtle text-2xs font-mono font-semibold text-slate-700 dark:text-slate-200">
              <span>{effectiveOpen ? 'Hide' : 'Explore'}</span>
              {effectiveOpen ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </span>
          </button>
        )}

        <div
          role="tablist"
          aria-label="Today physiology deep-dive sections"
          className="flex flex-wrap items-center gap-1.5"
        >
          {navTabs.map((tab) => {
            const Icon = tab.icon;
            const active = effectiveOpen && activeSection === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`today-deep-dive-tab-${tab.id.toLowerCase()}`}
                onClick={() => handleSelectSection(tab.id)}
                className={`min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-all cursor-pointer ${
                  active
                    ? 'ap-nav-volt-active shadow-xs'
                    : 'liquid-glass-subtle text-slate-700 dark:text-slate-200 hover:border-[#28573B]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" weight={active ? 'fill' : 'duotone'} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {effectiveOpen && (
        <div className="pt-2 border-t border-slate-200/70 dark:border-white/10 space-y-6">
          {activeSection === 'CURVES' && (
            <div className="space-y-6">
              {renderStrava90dCue()}
              <PhysiologyView
                curves={INITIAL_POWER_PACE_CURVES}
                benchmarkSegments={benchmarkSegments}
                activities={activities}
                wellnessDays={wellnessDays}
                envFilter={envFilter}
                distanceUnit={distanceUnit}
                athleteWeightKg={athleteWeightKg}
                athleteProfile={athleteProfile}
                onScanMoreSegments={onScanMoreSegments}
                isScanningSegments={isScanningSegments}
                onSelectActivity={onSelectActivity}
                onOpenActivitiesSegments={onOpenActivitiesSegments}
                onOpenCoachWithPrompt={onOpenCoachWithPrompt}
              />

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <section className="lg:col-span-6 rounded-2xl liquid-glass-subtle p-4 sm:p-5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <Timer className="w-4 h-4 text-[#059669]" />
                      <span>Running Race Time Predictor</span>
                    </h3>
                    <span className="text-2xs font-mono text-slate-500 dark:text-slate-400">
                      Run eFTP {raceAndFtpPredictions.runEftp}W · VO2max {raceAndFtpPredictions.vo2maxRun}
                    </span>
                  </div>
                  <div className="divide-y divide-slate-200/70 dark:divide-slate-800 text-xs font-mono tabular-nums">
                    {raceAndFtpPredictions.events.map((ev) => (
                      <div key={ev.label} className="py-2 flex items-center justify-between gap-2">
                        <span className="font-sans font-semibold text-slate-800 dark:text-slate-200">{ev.label}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-slate-500">
                            {ev.paceSecsPerKm > 0 ? formatPace(ev.paceSecsPerKm, distanceUnit) : '—'}
                          </span>
                          <span className="font-bold ap-ink-emerald dark:text-[#C8FF00]">
                            {ev.totalSecs > 0 ? formatDuration(ev.totalSecs) : '—'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {onOpenOfficialRaceModal && (
                    <button
                      type="button"
                      onClick={onOpenOfficialRaceModal}
                      className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl ap-btn-secondary text-xs font-semibold cursor-pointer"
                    >
                      + Log Official Race Result
                    </button>
                  )}
                </section>

                <section className="lg:col-span-6 rounded-2xl liquid-glass-subtle p-4 sm:p-5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4 ap-ink-sky" />
                      <span>90-Day Cycling FTP Trajectory</span>
                    </h3>
                    <span className="text-2xs font-mono font-bold ap-ink-sky">
                      {raceAndFtpPredictions.currentFtp > 0 ? `${raceAndFtpPredictions.currentFtp}W` : 'Uncalibrated'}
                    </span>
                  </div>
                  {raceAndFtpPredictions.currentFtp > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono tabular-nums">
                      {[
                        { label: 'Current', watts: raceAndFtpPredictions.currentFtp },
                        { label: '+30 Days', watts: raceAndFtpPredictions.ftp30d },
                        { label: '+60 Days', watts: raceAndFtpPredictions.ftp60d },
                        { label: '+90d Goal', watts: raceAndFtpPredictions.targetFtp },
                      ].map((pt) => (
                        <div key={pt.label} className="rounded-xl border border-slate-200 dark:border-[#244331] bg-white/75 dark:bg-[#101B15] p-3">
                          <div className="text-2xs font-sans text-slate-600 dark:text-slate-300">{pt.label}</div>
                          <div className="text-base font-bold text-slate-900 dark:text-white">{pt.watts}W</div>
                          {!athleteProfile.safeSportHideWeight && (
                            <div className="text-2xs font-semibold ap-ink-sky">
                              {(pt.watts / raceAndFtpPredictions.weightKg).toFixed(2)} W/kg
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Set Cycling FTP in Athlete Profile or sync a power ride to project 30/60/90-day trajectory.
                    </p>
                  )}
                </section>
              </div>
            </div>
          )}

          {activeSection === 'DURABILITY' && (
            <div className="space-y-6">
              {/* Fatigue-Sliced Durability */}
              <section className="rounded-2xl liquid-glass-subtle p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Flame className="w-4 h-4 text-[#EA580C]" />
                    <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                      Fatigue-Sliced Endurance Durability
                    </h3>
                    <ChartInfoTooltip
                      title="Fatigue-Sliced Endurance Durability"
                      subtitle="Fresh vs. Deep-Fatigue Work Retention"
                      whatItMeasures="Measures how much 5-minute and 20-minute output you retain after accumulating 10–40 kJ/kg (Cycling) or 500–2,000 kcal (Running)."
                      benchmarks="Retention >= 94% late in long efforts indicates strong metabolic durability and glycogen sparing."
                      coachingAction="Target fueled Z2-to-Tempo finish blocks to lift late-stage retention."
                    />
                  </div>
                  <div className="flex items-center gap-1 p-1 rounded-xl liquid-capsule-track">
                    {(['Running', 'Cycling'] as const).map((sp) => (
                      <button
                        key={sp}
                        type="button"
                        onClick={() => setDurabilitySport(sp)}
                        className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                          durabilitySport === sp ? 'liquid-capsule-active text-slate-900 dark:text-white' : 'text-slate-500'
                        }`}
                      >
                        {sp}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 font-mono text-xs tabular-nums">
                  {durabilityReport.buckets.map((pt) => (
                    <div key={pt.bucketIndex} className="rounded-xl border border-slate-200 dark:border-[#244331] bg-white/75 dark:bg-[#101B15] p-3 space-y-1">
                      <div className="text-2xs font-sans text-slate-500">{pt.fatigueLabel}</div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">
                        {pt.retentionPct > 0 ? `${pt.retentionPct}% retained` : '—'}
                      </div>
                      <div className="text-2xs text-slate-500">{pt.sampleCount} sessions</div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {durabilityReport.limiterExplanation} {durabilityReport.fuelingPrescription}
                </p>
              </section>

              {/* 80/20 Seiler Intensity Distribution + Annual Mileage */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <section className="lg:col-span-6 rounded-2xl liquid-glass-subtle p-4 sm:p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                      Volume &amp; 80/20 Polarization ({totalsAndPolarization.distributionStyle})
                    </h3>
                    <select
                      value={totalsPeriod}
                      aria-label="Polarization period"
                      onChange={(e) =>
                        setTotalsPeriod(e.target.value as '28d' | '90d' | 'YTD' | 'ALL')
                      }
                      className="min-h-[44px] sm:min-h-[34px] rounded-xl liquid-glass-subtle px-2.5 py-1 text-2xs font-mono font-bold text-slate-900 dark:text-slate-100 cursor-pointer"
                    >
                      <option value="28d">28d</option>
                      <option value="90d">90d</option>
                      <option value="YTD">YTD</option>
                      <option value="ALL">All</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-2xs">
                    <select
                      value={isAllSportsSelected ? 'ALL' : selectedPolarizationSports[0] || 'ALL'}
                      aria-label="Polarization sport filter"
                      onChange={(e) => {
                        const val = e.target.value;
                        setSelectedPolarizationSports(
                          val === 'ALL'
                            ? ALL_SPORTS_LIST
                            : ALL_SPORTS_LIST.filter((s) => s === val)
                        );
                      }}
                      className="min-h-[44px] sm:min-h-[34px] rounded-xl liquid-glass-subtle px-2.5 py-1 text-xs font-semibold text-slate-900 dark:text-slate-100 cursor-pointer"
                    >
                      <option value="ALL">All Sports</option>
                      {ALL_SPORTS_LIST.map((sp) => (
                        <option key={sp} value={sp}>
                          {sp}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-2 font-mono text-xs tabular-nums">
                    <div className="rounded-xl border border-slate-200 dark:border-[#244331] p-2.5">
                      <div className="text-2xs font-sans text-slate-500">Low (Z1–Z2)</div>
                      <div className="text-base font-bold text-[#059669]">{totalsAndPolarization.lowPct}%</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 dark:border-[#244331] p-2.5">
                      <div className="text-2xs font-sans text-slate-500">Tempo (Z3)</div>
                      <div className="text-base font-bold text-[#D97706]">{totalsAndPolarization.modPct}%</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 dark:border-[#244331] p-2.5">
                      <div className="text-2xs font-sans text-slate-500">High (Z4+)</div>
                      <div className="text-base font-bold text-[#DC2626]">{totalsAndPolarization.highPct}%</div>
                    </div>
                  </div>
                  <div className="text-2xs font-mono text-slate-600 dark:text-slate-300">
                    {totalsAndPolarization.count} sessions · {formatDistance(totalsAndPolarization.totalDistMeters, distanceUnit, 1)} · {totalsAndPolarization.totalLoad.toLocaleString()} TSS
                  </div>
                </section>

                <section className="lg:col-span-6 rounded-2xl liquid-glass-subtle p-4 sm:p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                      {currentYear} Annual Volume Targets
                    </h3>
                    <select
                      value={envFilter}
                      aria-label="Annual volume environment"
                      onChange={(e) =>
                        onSelectEnvFilter(e.target.value as 'COMBINED' | 'OUTDOOR' | 'INDOOR')
                      }
                      className="min-h-[44px] sm:min-h-[34px] rounded-xl liquid-glass-subtle px-2.5 py-1 text-2xs font-semibold text-slate-900 dark:text-slate-100 cursor-pointer"
                    >
                      <option value="COMBINED">All Environments</option>
                      <option value="OUTDOOR">Outdoor</option>
                      <option value="INDOOR">Indoor</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const val = Number(runInput);
                        if (val > 0) onUpdateAnnualMileageGoal('Running', convertUnitToMeters(val, distanceUnit));
                      }}
                      className="rounded-xl border border-slate-200 dark:border-[#244331] p-3 space-y-2"
                    >
                      <div className="flex justify-between font-mono">
                        <span className="font-sans font-bold text-slate-900 dark:text-white">Running YTD</span>
                        <span className="text-[#059669] font-bold">{runSummary.pctOfAnnualTarget}%</span>
                      </div>
                      <div className="font-mono font-bold text-slate-800 dark:text-slate-100">
                        {formatDistance(runSummary.combinedTotalMeters, distanceUnit, 1)}
                      </div>
                      <div className="flex gap-1.5">
                        <input
                          id={`${formId}-run-ytd`}
                          type="number"
                          value={runInput}
                          onChange={(e) => setRunInput(e.target.value)}
                          aria-label={`Running Annual Target (${distanceUnit})`}
                          className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 py-1 font-mono text-xs"
                        />
                        <button type="submit" className="min-h-[40px] px-3 rounded-lg ap-btn-primary text-2xs font-bold cursor-pointer">
                          Save
                        </button>
                      </div>
                    </form>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const val = Number(bikeInput);
                        if (val > 0) onUpdateAnnualMileageGoal('Cycling', convertUnitToMeters(val, distanceUnit));
                      }}
                      className="rounded-xl border border-slate-200 dark:border-[#244331] p-3 space-y-2"
                    >
                      <div className="flex justify-between font-mono">
                        <span className="font-sans font-bold text-slate-900 dark:text-white">Cycling YTD</span>
                        <span className="text-[#0284C7] font-bold">{bikeSummary.pctOfAnnualTarget}%</span>
                      </div>
                      <div className="font-mono font-bold text-slate-800 dark:text-slate-100">
                        {formatDistance(bikeSummary.combinedTotalMeters, distanceUnit, 1)}
                      </div>
                      <div className="flex gap-1.5">
                        <input
                          id={`${formId}-bike-ytd`}
                          type="number"
                          value={bikeInput}
                          onChange={(e) => setBikeInput(e.target.value)}
                          aria-label={`Cycling Annual Target (${distanceUnit})`}
                          className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 py-1 font-mono text-xs"
                        />
                        <button type="submit" className="min-h-[40px] px-3 rounded-lg ap-btn-primary text-2xs font-bold cursor-pointer">
                          Save
                        </button>
                      </div>
                    </form>
                  </div>
                </section>
              </div>
            </div>
          )}

          {activeSection === 'PROGRESSION' && (
            <div className="space-y-6">
              <TrackProgressionAndCalibrationPanel
                activities={activities}
                wellnessDays={wellnessDays}
                athleteProfile={athleteProfile}
                distanceUnit={distanceUnit}
                onApplyPosteriorCalibration={async (updatedPaceSecsKm, vdotAer) => {
                  const latestW = wellnessDays.length > 0 ? wellnessDays[wellnessDays.length - 1] : undefined;
                  const updated = buildCompleteAthleteProfile(
                    {
                      ...athleteProfile,
                      thresholdPaceSecsPerKm: Math.round(updatedPaceSecsKm),
                      vo2MaxRunning: Math.round(vdotAer),
                      source: 'CUSTOM_OVERRIDE',
                      lastSyncedAt: new Date().toISOString(),
                    },
                    latestW
                  );
                  await onSaveProfileOverride(updated);
                }}
              />

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <section className="lg:col-span-7 rounded-2xl liquid-glass-subtle p-4 sm:p-5 space-y-3">
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Gauge className="w-4 h-4 text-[#7C3AED]" />
                    <span>6-Zone Energy System Progression (1.0–10.0)</span>
                  </h3>
                  <div className="space-y-2.5">
                    {sixZoneLevels.map((item) => (
                      <div key={item.code} className="space-y-1">
                        <div className="flex justify-between text-xs font-mono">
                          <span className="font-sans font-semibold text-slate-800 dark:text-slate-200">
                            <strong style={{ color: item.color }} className="font-mono mr-1.5">{item.code}</strong>
                            {item.name}
                          </span>
                          <span className="font-bold text-slate-900 dark:text-white">
                            Lvl {item.level.toFixed(1)}
                          </span>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden">
                          <div
                            style={{ width: `${Math.min(100, (item.level / 10) * 100)}%`, backgroundColor: item.color }}
                            className="h-full rounded-full transition-all"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="lg:col-span-5 rounded-2xl liquid-glass-subtle p-4 sm:p-5 space-y-3 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0284C7]">
                        <Zap className="w-3.5 h-3.5" />
                        <span>Auto-Calibration Insights ({paceAndPowerInsights.qualityCount})</span>
                      </span>
                      <span className="px-2 py-0.5 rounded-full ap-status-prime font-mono text-2xs font-bold">
                        {paceAndPowerInsights.badgeLabel}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      {paceAndPowerInsights.headline}
                    </p>
                    <div className="text-2xs font-mono text-slate-700 dark:text-slate-200">
                      FTP {paceAndPowerInsights.currentFtp}W → {raceAndFtpPredictions.currentFtp > 0 ? `${paceAndPowerInsights.suggestedFtp}W` : '—'} · LT {formatPace(paceAndPowerInsights.currentThreshPace || 250, distanceUnit)} → {formatPace(paceAndPowerInsights.suggestedPaceSecsPerKm || 250, distanceUnit)}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={async () => {
                        const latestW = wellnessDays.length > 0 ? wellnessDays[wellnessDays.length - 1] : undefined;
                        const updated = buildCompleteAthleteProfile(
                          {
                            ...athleteProfile,
                            ftp: paceAndPowerInsights.suggestedFtp || athleteProfile.ftp,
                            thresholdPaceSecsPerKm:
                              paceAndPowerInsights.suggestedPaceSecsPerKm || athleteProfile.thresholdPaceSecsPerKm,
                            source: 'CUSTOM_OVERRIDE',
                            lastSyncedAt: new Date().toISOString(),
                          },
                          latestW
                        );
                        await onSaveProfileOverride(updated);
                        setCalibrationToast('Threshold pace and FTP zones updated.');
                      }}
                      className="w-full min-h-[44px] sm:min-h-[38px] px-3 py-1.5 rounded-xl ap-btn-primary text-xs font-bold cursor-pointer"
                    >
                      Apply Recommended Calibration
                    </button>
                    {calibrationToast && (
                      <div className="text-2xs font-mono text-[#059669] font-semibold">
                        {calibrationToast}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          )}

          {activeSection === 'TRENDS' && (
            <div className="space-y-4">
              {renderStrava90dCue()}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1 p-1 rounded-xl liquid-capsule-track">
                  <button
                    type="button"
                    data-testid="today-trends-subview-trends"
                    onClick={() => setTrendsSubView('TRENDS')}
                    className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                      trendsSubView === 'TRENDS' ? 'ap-nav-volt-active' : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <TrendingUp className="w-3.5 h-3.5" />
                    <span>Adaptation Trends</span>
                  </button>
                  <button
                    type="button"
                    data-testid="today-trends-subview-lab"
                    onClick={() => setTrendsSubView('CUSTOM_LAB')}
                    className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                      trendsSubView === 'CUSTOM_LAB' ? 'ap-nav-volt-active' : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <LineChart className="w-3.5 h-3.5" />
                    <span>Custom Correlation Lab</span>
                  </button>
                </div>
              </div>

              {trendsSubView === 'TRENDS' ? (
                <PhysiologicalTrendsView
                  activities={activities}
                  wellnessDays={wellnessDays}
                  athleteWeightKg={athleteWeightKg}
                  safeSportHideWeight={Boolean(athleteProfile?.safeSportHideWeight)}
                  distanceUnit={distanceUnit}
                  onOpenCoachWithPrompt={onOpenCoachWithPrompt}
                />
              ) : (
                <CustomChartsView
                  activities={activities}
                  wellnessDays={wellnessDays}
                  distanceUnit={distanceUnit}
                  onOpenCoachWithPrompt={onOpenCoachWithPrompt}
                />
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export const TodayPhysiologyDeepDive = React.memo(TodayPhysiologyDeepDiveInner);
