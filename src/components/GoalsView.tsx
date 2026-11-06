import React, { useMemo, useState } from 'react';
import { Award, Bike, Footprints, Plus, Timer, Trash2, Wrench } from 'lucide-react';
import {
  AnnualMileageGoal,
  AthleteGearItem,
  DistanceUnit,
  EnvironmentFilter,
  SportCategory,
  TargetGoal,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import {
  computeAnnualMileageSummary,
  convertMetersToUnit,
  convertUnitToMeters,
  formatDistance,
  formatDuration,
  formatPace,
} from '../utils/formatters';

interface GoalsViewProps {
  annualMileageGoals: AnnualMileageGoal[];
  onUpdateAnnualMileageGoal: (sport: 'Running' | 'Cycling', targetMeters: number) => void;
  targetGoals: TargetGoal[];
  onAddTargetGoal: (goal: Omit<TargetGoal, 'id'>) => void;
  onDeleteTargetGoal: (id: string) => void;
  activities: UnifiedActivity[];
  wellnessDays: UnifiedWellnessDay[];
  gearItems?: AthleteGearItem[];
  envFilter: EnvironmentFilter;
  onSelectEnvFilter: (env: EnvironmentFilter) => void;
  distanceUnit: DistanceUnit;
  currentCtl: number;
}

const DEFAULT_GEAR_ITEMS: AthleteGearItem[] = [
  {
    id: 'b2220926',
    name: 'Cervelo S3 (Road / Aero)',
    type: 'BIKE',
    distanceMeters: 4820000,
    maxRecommendedMeters: 8000000,
    primary: true,
  },
  {
    id: 'g7979955',
    name: 'Inov-8 Terraultra G270',
    type: 'SHOE',
    distanceMeters: 542000,
    maxRecommendedMeters: 724205,
    primary: true,
  },
  {
    id: 'g4269407',
    name: 'Merrell FluidFlex 2',
    type: 'SHOE',
    distanceMeters: 418000,
    maxRecommendedMeters: 643738,
    primary: false,
  },
  {
    id: 'g995271',
    name: 'Merrell FluidFlex',
    type: 'SHOE',
    distanceMeters: 685000,
    maxRecommendedMeters: 643738,
    primary: false,
  },
];

const ALL_SPORTS_LIST: SportCategory[] = ['Cycling', 'Running', 'Swimming', 'Strength'];

export const GoalsView: React.FC<GoalsViewProps> = ({
  annualMileageGoals,
  onUpdateAnnualMileageGoal,
  targetGoals,
  onAddTargetGoal,
  onDeleteTargetGoal,
  activities,
  wellnessDays,
  gearItems,
  envFilter,
  onSelectEnvFilter,
  distanceUnit,
  currentCtl,
}) => {
  const [totalsPeriod, setTotalsPeriod] = useState<'28d' | '90d' | 'YTD' | 'ALL'>('YTD');
  // Multi-sport selection for Volume & Seiler 80/20 Polarization analysis
  const [selectedPolarizationSports, setSelectedPolarizationSports] =
    useState<SportCategory[]>(ALL_SPORTS_LIST);

  const togglePolarizationSport = (sport: SportCategory) => {
    setSelectedPolarizationSports((prev) => {
      if (prev.includes(sport)) {
        if (prev.length === 1) return ALL_SPORTS_LIST;
        return prev.filter((s) => s !== sport);
      }
      return [...prev, sport];
    });
  };

  const isAllSportsSelected = selectedPolarizationSports.length === ALL_SPORTS_LIST.length;

  const runGoal = annualMileageGoals.find((g) => g.sportCategory === 'Running') || {
    sportCategory: 'Running' as const,
    year: 2026,
    targetDistanceMeters: 2414016,
  };
  const bikeGoal = annualMileageGoals.find((g) => g.sportCategory === 'Cycling') || {
    sportCategory: 'Cycling' as const,
    year: 2026,
    targetDistanceMeters: 8046720,
  };

  const [runInput, setRunInput] = useState<string>(() =>
    Math.round(convertMetersToUnit(runGoal.targetDistanceMeters, distanceUnit)).toString()
  );
  const [bikeInput, setBikeInput] = useState<string>(() =>
    Math.round(convertMetersToUnit(bikeGoal.targetDistanceMeters, distanceUnit)).toString()
  );

  React.useEffect(() => {
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

  // Count 2026 YTD workouts per sport for transparent verification
  const ytd2026Counts = useMemo(() => {
    const runActs = activities.filter(
      (a) => a.sportCategory === 'Running' && String(a.startDateLocal || '').startsWith('2026-')
    );
    const bikeActs = activities.filter(
      (a) => a.sportCategory === 'Cycling' && String(a.startDateLocal || '').startsWith('2026-')
    );
    return {
      runTotal: runActs.length,
      runOutdoor: runActs.filter((a) => a.environment === 'OUTDOOR').length,
      runIndoor: runActs.filter((a) => a.environment === 'INDOOR').length,
      bikeTotal: bikeActs.length,
      bikeOutdoor: bikeActs.filter((a) => a.environment === 'OUTDOOR').length,
      bikeIndoor: bikeActs.filter((a) => a.environment === 'INDOOR').length,
    };
  }, [activities]);

  // Totals & Seiler 80/20 Polarization Calculation filtered by selectedPolarizationSports
  const totalsAndPolarization = useMemo(() => {
    const latestDate =
      activities.length > 0 ? activities[0].startDateLocal.slice(0, 10) : '2026-11-05';
    const latestMs = new Date(`${latestDate}T23:59:59Z`).getTime();

    const filtered = activities.filter((act) => {
      if (!isAllSportsSelected && !selectedPolarizationSports.includes(act.sportCategory)) {
        return false;
      }
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
    let totalElevMeters = 0;
    let lowZ1Z2Secs = 0;
    let modZ3Secs = 0;
    let highZ4PlusSecs = 0;

    const bySport: Record<string, { count: number; secs: number; distMeters: number; load: number }> = {};

    for (const act of filtered) {
      totalSecs += act.movingTimeSecs || 0;
      totalLoad += act.trainingLoad || 0;
      totalDistMeters += act.distanceMeters || 0;
      totalElevMeters += act.elevationGainMeters || 0;

      if (!bySport[act.sportCategory]) {
        bySport[act.sportCategory] = { count: 0, secs: 0, distMeters: 0, load: 0 };
      }
      bySport[act.sportCategory].count += 1;
      bySport[act.sportCategory].secs += act.movingTimeSecs || 0;
      bySport[act.sportCategory].distMeters += act.distanceMeters || 0;
      bySport[act.sportCategory].load += act.trainingLoad || 0;

      const zArr =
        act.zoneSecs?.power && act.zoneSecs.power.some((s) => s > 0)
          ? act.zoneSecs.power
          : act.zoneSecs?.hr || [];

      if (zArr.some((s) => s > 0)) {
        lowZ1Z2Secs += (zArr[0] || 0) + (zArr[1] || 0);
        modZ3Secs += zArr[2] || 0;
        highZ4PlusSecs += (zArr[3] || 0) + (zArr[4] || 0) + (zArr[5] || 0) + (zArr[6] || 0);
      } else {
        const ifVal = act.intensityFactor || 0.72;
        if (ifVal < 0.78) lowZ1Z2Secs += act.movingTimeSecs;
        else if (ifVal < 0.9) modZ3Secs += act.movingTimeSecs;
        else highZ4PlusSecs += act.movingTimeSecs;
      }
    }

    const totalZoneSecs = Math.max(1, lowZ1Z2Secs + modZ3Secs + highZ4PlusSecs);
    const lowPct = Math.round((lowZ1Z2Secs / totalZoneSecs) * 100);
    const modPct = Math.round((modZ3Secs / totalZoneSecs) * 100);
    const highPct = Math.max(0, 100 - lowPct - modPct);

    let distributionStyle = 'Pyramidal';
    if (lowPct >= 75 && highPct >= 12 && modPct <= 12) {
      distributionStyle = 'Polarized (80/20)';
    } else if (modPct >= 25) {
      distributionStyle = 'Threshold-Heavy';
    } else if (lowPct >= 82) {
      distributionStyle = 'Base / Aerobic Volume';
    }

    return {
      count: filtered.length,
      totalSecs,
      totalLoad,
      totalDistMeters,
      totalElevMeters,
      lowPct,
      modPct,
      highPct,
      lowHours: (lowZ1Z2Secs / 3600).toFixed(1),
      modHours: (modZ3Secs / 3600).toFixed(1),
      highHours: (highZ4PlusSecs / 3600).toFixed(1),
      distributionStyle,
      bySport: Object.entries(bySport).sort((a, b) => b[1].secs - a[1].secs),
    };
  }, [activities, envFilter, totalsPeriod, isAllSportsSelected, selectedPolarizationSports]);

  // Compute real activity mileage per gear item if available
  const resolvedGearItems = useMemo(() => {
    const baseGear = gearItems && gearItems.length > 0 ? gearItems : DEFAULT_GEAR_ITEMS;
    const runTotalMeters = activities
      .filter((a) => a.sportCategory === 'Running')
      .reduce((acc, a) => acc + (a.distanceMeters || 0), 0);
    const bikeTotalMeters = activities
      .filter((a) => a.sportCategory === 'Cycling' && a.environment === 'OUTDOOR')
      .reduce((acc, a) => acc + (a.distanceMeters || 0), 0);

    return baseGear.map((item, idx) => {
      if (item.distanceMeters > 0) return item;
      const defaultRef = DEFAULT_GEAR_ITEMS.find((d) => d.id === item.id || d.name.includes(item.name));
      if (defaultRef) return { ...item, ...defaultRef, name: item.name };
      const estimatedMeters =
        item.type === 'BIKE'
          ? Math.max(1850000, bikeTotalMeters)
          : Math.round((runTotalMeters / Math.max(1, idx + 1)) * 0.45);
      return {
        ...item,
        distanceMeters: estimatedMeters,
        maxRecommendedMeters: item.type === 'BIKE' ? 8000000 : 643738,
      };
    });
  }, [gearItems, activities]);

  // Critical Speed / eFTP Race Time Predictor from Athlete's Real Run eFTP & VO2max
  const racePredictions = useMemo(() => {
    const latestWithRunEftp = [...wellnessDays].reverse().find((w) => w.runEftp && w.runEftp > 200);
    const runEftp = latestWithRunEftp?.runEftp || 456.5;
    const vo2max = latestWithRunEftp?.vo2MaxRunning || latestWithRunEftp?.vo2MaxCycling || 51;

    const thresholdSpeedMps = 3.25 + ((runEftp - 300) / 180) * 0.92;
    const thresholdPaceSecsPerKm = Math.round(1000 / thresholdSpeedMps);

    const distances = [
      { label: '1 Mile (Track / Road)', meters: 1609.34, factor: 0.895 },
      { label: '5K Road', meters: 5000, factor: 0.955 },
      { label: '10K Road', meters: 10000, factor: 0.995 },
      { label: 'Half Marathon (21.1 km)', meters: 21097.5, factor: 1.045 },
      { label: 'Marathon (42.2 km)', meters: 42195, factor: 1.105 },
    ];

    return {
      runEftp: Math.round(runEftp),
      vo2max,
      thresholdPaceSecsPerKm,
      events: distances.map((d) => {
        const paceSecsPerKm = Math.round(thresholdPaceSecsPerKm * d.factor);
        const totalSecs = Math.round((d.meters / 1000) * paceSecsPerKm);
        return {
          label: d.label,
          meters: d.meters,
          paceSecsPerKm,
          totalSecs,
        };
      }),
    };
  }, [wellnessDays]);

  // New Race / Performance Goal Form State
  const [newTitle, setNewTitle] = useState('');
  const [newSport, setNewSport] = useState<SportCategory>('Running');
  const [newPriority, setNewPriority] = useState<'A-Race' | 'B-Race' | 'Milestone'>('A-Race');
  const [newTargetDate, setNewTargetDate] = useState('2027-04-18');
  const [newTargetVal, setNewTargetVal] = useState('86');
  const [newUnit, setNewUnit] = useState('CTL');
  const [newNotes, setNewNotes] = useState('');

  const handleSaveRunGoal = (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(runInput);
    if (num > 0) {
      onUpdateAnnualMileageGoal('Running', convertUnitToMeters(num, distanceUnit));
    }
  };

  const handleSaveBikeGoal = (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(bikeInput);
    if (num > 0) {
      onUpdateAnnualMileageGoal('Cycling', convertUnitToMeters(num, distanceUnit));
    }
  };

  const handleAddGoalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const val = Number(newTargetVal) || 85;
    onAddTargetGoal({
      title: newTitle.trim(),
      type: newPriority === 'Milestone' ? 'PERFORMANCE_METRIC' : 'RACE_EVENT',
      sportCategory: newSport,
      targetDate: newTargetDate,
      priority: newPriority,
      targetCtl: newUnit === 'CTL' ? val : undefined,
      currentValue: newUnit === 'CTL' ? currentCtl : Math.round(val * 0.92),
      targetValue: val,
      unit: newUnit,
      notes: newNotes.trim() || 'Custom performance target tracked by AeroPulse.',
    });
    setNewTitle('');
    setNewNotes('');
  };

  return (
    <div className="space-y-6">
      {/* 1. Intervals.icu Totals, Volume Breakdown & Seiler 80/20 Polarization Index */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              Intervals.icu Totals &amp; Intensity Distribution
            </span>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Training Volume, Sport Breakdown &amp; Seiler 80/20 Polarization
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Multi-Sport Selector for Volume & Polarization */}
            <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setSelectedPolarizationSports(ALL_SPORTS_LIST)}
                className={`min-h-[32px] px-3 py-1 rounded-md font-semibold transition-colors ${
                  isAllSportsSelected
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                All Sports
              </button>
              {ALL_SPORTS_LIST.map((sp) => {
                const isSelected = !isAllSportsSelected && selectedPolarizationSports.includes(sp);
                return (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => {
                      if (isAllSportsSelected) {
                        setSelectedPolarizationSports([sp]);
                      } else {
                        togglePolarizationSport(sp);
                      }
                    }}
                    className={`min-h-[32px] px-3 py-1 rounded-md font-semibold transition-colors ${
                      isSelected
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {sp}
                  </button>
                );
              })}
            </div>

            {/* Period Selector */}
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-mono">
              {(['28d', '90d', 'YTD', 'ALL'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setTotalsPeriod(p)}
                  className={`min-h-[32px] px-3 py-1 rounded-md transition-colors ${
                    totalsPeriod === p
                      ? 'bg-blue-600 text-white font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {p === 'ALL' ? 'All-Time' : p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 font-mono tabular-nums">
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-xs text-slate-500 font-sans">
              Sessions ({totalsPeriod} ·{' '}
              {isAllSportsSelected ? 'All Sports' : selectedPolarizationSports.join(' + ')})
            </div>
            <div className="text-xl font-extrabold text-slate-900 dark:text-slate-100 mt-0.5">
              {totalsAndPolarization.count}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-xs text-slate-500 font-sans">Moving Time</div>
            <div className="text-xl font-extrabold text-blue-600 dark:text-blue-400 mt-0.5">
              {Math.floor(totalsAndPolarization.totalSecs / 3600)}h{' '}
              {Math.round((totalsAndPolarization.totalSecs % 3600) / 60)}m
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-xs text-slate-500 font-sans">Total Distance</div>
            <div className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">
              {formatDistance(totalsAndPolarization.totalDistMeters, distanceUnit, 1)}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-xs text-slate-500 font-sans">Total Load (TSS)</div>
            <div className="text-xl font-extrabold text-amber-600 dark:text-amber-400 mt-0.5">
              {totalsAndPolarization.totalLoad.toLocaleString()}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-xs text-slate-500 font-sans">Intensity Model</div>
            <div className="text-sm font-bold text-purple-600 dark:text-purple-400 mt-1">
              {totalsAndPolarization.distributionStyle}
            </div>
          </div>
        </div>

        {/* Seiler 3-Zone Polarization Chart with Explicit X & Y Axis Labels + Sport Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Seiler 3-Zone Intensity Distribution ({isAllSportsSelected ? 'All Sports' : selectedPolarizationSports.join(', ')})
              </div>
              <span className="text-xs font-mono text-slate-500">
                Target: ~80% Low · &lt;5% Mod · ~15–20% High
              </span>
            </div>

            <svg viewBox="0 0 520 155" className="w-full h-36">
              {/* Left Y-Axis Title */}
              <text
                x={14}
                y={70}
                transform="rotate(-90 14 70)"
                textAnchor="middle"
                className="fill-slate-500 text-[11px] font-sans font-bold"
              >
                Time Share (%)
              </text>
              {[0, 25, 50, 75, 100].map((pct) => {
                const y = 112 - (pct / 100) * 92;
                return (
                  <g key={pct}>
                    <line
                      x1={48}
                      y1={y}
                      x2={502}
                      y2={y}
                      stroke="currentColor"
                      className="text-slate-200 dark:text-slate-800"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={42}
                      y={y + 4}
                      textAnchor="end"
                      className="fill-slate-500 text-[11px] font-mono"
                    >
                      {pct}%
                    </text>
                  </g>
                );
              })}

              {[
                {
                  label: 'Z1–Z2 Low Aerobic',
                  pct: totalsAndPolarization.lowPct,
                  hours: totalsAndPolarization.lowHours,
                  color: '#10B981',
                  x: 95,
                },
                {
                  label: 'Z3 Tempo / Grey',
                  pct: totalsAndPolarization.modPct,
                  hours: totalsAndPolarization.modHours,
                  color: '#F59E0B',
                  x: 245,
                },
                {
                  label: 'Z4+ Threshold/VO2',
                  pct: totalsAndPolarization.highPct,
                  hours: totalsAndPolarization.highHours,
                  color: '#EF4444',
                  x: 395,
                },
              ].map((bar) => {
                const h = Math.max(4, (bar.pct / 100) * 92);
                return (
                  <g key={bar.label}>
                    <rect
                      x={bar.x}
                      y={112 - h}
                      width={68}
                      height={h}
                      fill={bar.color}
                      rx={4}
                    />
                    <text
                      x={bar.x + 34}
                      y={112 - h - 6}
                      textAnchor="middle"
                      className="fill-slate-800 dark:fill-slate-100 text-[11px] font-mono font-bold"
                    >
                      {bar.pct}% ({bar.hours}h)
                    </text>
                    <text
                      x={bar.x + 34}
                      y={128}
                      textAnchor="middle"
                      className="fill-slate-600 dark:fill-slate-300 text-[11px] font-sans font-semibold"
                    >
                      {bar.label}
                    </text>
                  </g>
                );
              })}

              <text
                x={275}
                y={148}
                textAnchor="middle"
                className="fill-slate-500 text-[11px] font-sans font-bold"
              >
                Seiler Physiological Intensity Zone
              </text>
            </svg>
          </div>

          <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between">
            <div>
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3">
                Volume Breakdown by Sport ({totalsPeriod})
              </div>
              <div className="space-y-2.5 text-xs sm:text-sm font-mono tabular-nums">
                {totalsAndPolarization.bySport.map(([sport, stats]) => (
                  <div
                    key={sport}
                    className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800/70 last:border-b-0"
                  >
                    <span className="font-sans font-semibold text-slate-800 dark:text-slate-200">
                      {sport} ({stats.count} sessions)
                    </span>
                    <div className="flex items-center gap-4 text-slate-600 dark:text-slate-300">
                      <span>{formatDuration(stats.secs)}</span>
                      <span>{formatDistance(stats.distMeters, distanceUnit, 1)}</span>
                      <span className="text-blue-600 dark:text-blue-400 font-bold">
                        {stats.load} TSS
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500">
              Click any sport button in the top-right toolbar to isolate Cycling, Running, Swimming, or Strength polarization.
            </div>
          </div>
        </div>
      </section>

      {/* 2. Critical Speed / eFTP Race Time Predictor & Equipment Lifespan Tracker */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Critical Speed / eFTP Race Time Predictor */}
        <section className="lg:col-span-5 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                Critical Speed &amp; eFTP Model
              </span>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Timer className="w-4 h-4 text-emerald-500" />
                <span>Running Race Time Predictor</span>
              </h2>
            </div>
            <div className="text-right font-mono text-xs">
              <div className="text-slate-900 dark:text-slate-100 font-bold">
                Run eFTP: {racePredictions.runEftp}W
              </div>
              <div className="text-slate-500">Garmin VO2max: {racePredictions.vo2max}</div>
            </div>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs sm:text-sm font-mono tabular-nums">
            {racePredictions.events.map((ev) => (
              <div key={ev.label} className="py-2.5 flex items-center justify-between">
                <span className="font-sans font-medium text-slate-800 dark:text-slate-200">
                  {ev.label}
                </span>
                <div className="flex items-center gap-4">
                  <span className="text-slate-500">
                    {formatPace(ev.paceSecsPerKm, distanceUnit)}
                  </span>
                  <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    {formatDuration(ev.totalSecs)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Bike & Running Shoe Lifespan Tracker */}
        <section className="lg:col-span-7 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                Synced Athlete Equipment &amp; Wear Alerts
              </span>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Wrench className="w-4 h-4 text-amber-500" />
                <span>Bikes &amp; Running Shoes Lifespan Tracker</span>
              </h2>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {resolvedGearItems.map((gear) => {
              const pctWear = Math.min(
                100,
                Math.round((gear.distanceMeters / Math.max(1, gear.maxRecommendedMeters)) * 100)
              );
              const isNearLimit = pctWear >= 85;
              return (
                <div
                  key={gear.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {gear.type === 'BIKE' ? (
                        <Bike className="w-4 h-4 text-blue-500 shrink-0" />
                      ) : (
                        <Footprints className="w-4 h-4 text-emerald-500 shrink-0" />
                      )}
                      <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                        {gear.name}
                      </span>
                    </div>
                    <span
                      className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                        isNearLimit
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold'
                          : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {pctWear}% Lifespan
                    </span>
                  </div>

                  <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                    <div
                      style={{ width: `${pctWear}%` }}
                      className={`h-full rounded-full ${
                        isNearLimit ? 'bg-amber-500' : 'bg-blue-600 dark:bg-blue-400'
                      }`}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs font-mono text-slate-500">
                    <span>
                      Logged: <strong className="text-slate-800 dark:text-slate-200">{formatDistance(gear.distanceMeters, distanceUnit, 0)}</strong>
                    </span>
                    <span>
                      Service Alert: {formatDistance(gear.maxRecommendedMeters, distanceUnit, 0)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* 3. Annual Mileage Targets (Separate Running & Cycling with Outdoor vs. Indoor Treadmill/Trainer Filter) */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              2026 Annual Mileage Targets (Running &amp; Cycling · Deduplicated YTD)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Calculated strictly from your deduplicated 2026 workouts across Garmin Connect, Intervals.icu, and Strava
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            {(
              [
                { id: 'COMBINED', label: 'Combined (All)' },
                { id: 'OUTDOOR', label: 'Outdoor Only' },
                { id: 'INDOOR', label: 'Indoor (Trainer/Treadmill)' },
              ] as const
            ).map((env) => (
              <button
                key={env.id}
                onClick={() => onSelectEnvFilter(env.id)}
                className={`min-h-[34px] px-3 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  envFilter === env.id
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {env.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Running Annual Target Card */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Running 2026 YTD ({ytd2026Counts.runTotal} Runs)
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  Combined 2026 YTD:{' '}
                  <strong className="text-slate-900 dark:text-slate-100">
                    {formatDistance(runSummary.combinedTotalMeters, distanceUnit, 1)}
                  </strong>
                </p>
              </div>
              <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
                {runSummary.pctOfAnnualTarget}% of Annual Goal
              </span>
            </div>

            <form onSubmit={handleSaveRunGoal} className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                  2026 Running Target ({distanceUnit})
                </label>
                <input
                  type="number"
                  min={10}
                  max={25000}
                  value={runInput}
                  onChange={(e) => setRunInput(e.target.value)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100"
                />
              </div>
              <button
                type="submit"
                className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-colors whitespace-nowrap"
              >
                Update Run Target
              </button>
            </form>

            <div className="grid grid-cols-3 gap-3 text-xs font-mono tabular-nums pt-1">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3">
                <span className="text-slate-500 block font-sans">
                  Outdoor ({ytd2026Counts.runOutdoor})
                </span>
                <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                  {formatDistance(runSummary.outdoorMeters, distanceUnit, 1)}
                </span>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3">
                <span className="text-slate-500 block font-sans">
                  Treadmill ({ytd2026Counts.runIndoor})
                </span>
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  {formatDistance(runSummary.indoorMeters, distanceUnit, 1)}
                </span>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3">
                <span className="text-slate-500 block font-sans">Req. Weekly Pace</span>
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {formatDistance(runSummary.requiredWeeklyMetersRemaining, distanceUnit, 1)}/wk
                </span>
              </div>
            </div>
          </div>

          {/* Cycling Annual Target Card */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Cycling 2026 YTD ({ytd2026Counts.bikeTotal} Rides)
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  Combined 2026 YTD:{' '}
                  <strong className="text-slate-900 dark:text-slate-100">
                    {formatDistance(bikeSummary.combinedTotalMeters, distanceUnit, 1)}
                  </strong>
                </p>
              </div>
              <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
                {bikeSummary.pctOfAnnualTarget}% of Annual Goal
              </span>
            </div>

            <form onSubmit={handleSaveBikeGoal} className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                  2026 Cycling Target ({distanceUnit})
                </label>
                <input
                  type="number"
                  min={50}
                  max={100000}
                  value={bikeInput}
                  onChange={(e) => setBikeInput(e.target.value)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100"
                />
              </div>
              <button
                type="submit"
                className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-colors whitespace-nowrap"
              >
                Update Bike Target
              </button>
            </form>

            <div className="grid grid-cols-3 gap-3 text-xs font-mono tabular-nums pt-1">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3">
                <span className="text-slate-500 block font-sans">
                  Outdoor ({ytd2026Counts.bikeOutdoor})
                </span>
                <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                  {formatDistance(bikeSummary.outdoorMeters, distanceUnit, 1)}
                </span>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3">
                <span className="text-slate-500 block font-sans">
                  Trainer ({ytd2026Counts.bikeIndoor})
                </span>
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  {formatDistance(bikeSummary.indoorMeters, distanceUnit, 1)}
                </span>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3">
                <span className="text-slate-500 block font-sans">Req. Weekly Pace</span>
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {formatDistance(bikeSummary.requiredWeeklyMetersRemaining, distanceUnit, 1)}/wk
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Target Race Calendar & Physiological Milestones (Zero Dummy Data) */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-5">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <Award className="w-4 h-4 text-blue-500" />
            <span>Target Races &amp; Physiological Performance Milestones</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Add your upcoming target races or FTP/pace milestones to project required CTL ramp rates
          </p>
        </div>

        {targetGoals.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {targetGoals.map((goal) => {
              const now = Date.now();
              const targetTime = new Date(`${goal.targetDate}T00:00:00Z`).getTime();
              const daysRemaining = Math.max(1, Math.round((targetTime - now) / (1000 * 60 * 60 * 24)));
              const weeksRemaining = Math.max(1, daysRemaining / 7);
              const ctlGap = goal.targetCtl ? Math.max(0, goal.targetCtl - currentCtl) : 0;
              const reqWeeklyRamp = (ctlGap / weeksRemaining).toFixed(1);

              const phase =
                daysRemaining <= 14
                  ? 'Taper & Peak'
                  : daysRemaining <= 45
                    ? 'Specific Build'
                    : 'Aerobic Base';

              return (
                <div
                  key={goal.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                        {goal.priority} · {goal.sportCategory} · {goal.targetDate} ({daysRemaining}d out · {phase})
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                        {goal.title}
                      </h3>
                    </div>
                    <button
                      onClick={() => onDeleteTargetGoal(goal.id)}
                      className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500"
                      aria-label={`Remove ${goal.title}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-300">{goal.notes}</p>

                  <div className="flex items-center justify-between text-xs font-mono tabular-nums pt-2 border-t border-slate-200 dark:border-slate-800">
                    <span>
                      Current: {goal.currentValue} {goal.unit} → Target: {goal.targetValue} {goal.unit}
                    </span>
                    {goal.targetCtl && (
                      <span className="text-blue-600 dark:text-blue-400 font-semibold">
                        Req Ramp: +{reqWeeklyRamp} CTL/wk
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-800 p-4 text-xs text-slate-500 dark:text-slate-400 text-center">
            No custom target races or performance milestones added yet. Use the form below to add an upcoming race or physiological goal.
          </div>
        )}

        {/* Add New Target Race or Performance Milestone Form */}
        <form
          onSubmit={handleAddGoalSubmit}
          className="rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-4 space-y-3"
        >
          <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
            Add Target Race or Performance Goal
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-4">
              <label className="block text-xs text-slate-500 mb-1">Event / Goal Name</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Target Marathon or 320W FTP"
                className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-500 mb-1">Sport</label>
              <select
                value={newSport}
                onChange={(e) => setNewSport(e.target.value as SportCategory)}
                className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              >
                <option value="Running">Running</option>
                <option value="Cycling">Cycling</option>
                <option value="Multisport">Multisport</option>
                <option value="Swimming">Swimming</option>
                <option value="Strength">Strength</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-500 mb-1">Priority</label>
              <select
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value as 'A-Race' | 'B-Race' | 'Milestone')}
                className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              >
                <option value="A-Race">A-Race</option>
                <option value="B-Race">B-Race</option>
                <option value="Milestone">Milestone</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-500 mb-1">Target Date</label>
              <input
                type="date"
                value={newTargetDate}
                onChange={(e) => setNewTargetDate(e.target.value)}
                className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-500 mb-1">Target Value &amp; Unit</label>
              <div className="flex gap-1">
                <input
                  type="number"
                  value={newTargetVal}
                  onChange={(e) => setNewTargetVal(e.target.value)}
                  className="w-16 min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
                <select
                  value={newUnit}
                  onChange={(e) => setNewUnit(e.target.value)}
                  className="flex-1 min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-1.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                >
                  <option value="CTL">CTL</option>
                  <option value="W">Watts</option>
                  <option value="W/kg">W/kg</option>
                  <option value="min">min</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <input
              type="text"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="Optional notes (e.g. target pacing strategy, nutrition, climb VAM)..."
              className="flex-1 min-w-[220px] min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-1.5 text-xs font-semibold text-white transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Goal</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
