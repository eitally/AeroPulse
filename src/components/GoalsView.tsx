import React, { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  AnnualMileageGoal,
  DistanceUnit,
  EnvironmentFilter,
  SportCategory,
  TargetGoal,
  UnifiedActivity,
} from '../types';
import {
  computeAnnualMileageSummary,
  convertMetersToUnit,
  convertUnitToMeters,
  formatDistance,
} from '../utils/formatters';

interface GoalsViewProps {
  annualMileageGoals: AnnualMileageGoal[];
  onUpdateAnnualMileageGoal: (sport: 'Running' | 'Cycling', targetMeters: number) => void;
  targetGoals: TargetGoal[];
  onAddTargetGoal: (goal: Omit<TargetGoal, 'id'>) => void;
  onDeleteTargetGoal: (id: string) => void;
  activities: UnifiedActivity[];
  envFilter: EnvironmentFilter;
  onSelectEnvFilter: (env: EnvironmentFilter) => void;
  distanceUnit: DistanceUnit;
  currentCtl: number;
}

export const GoalsView: React.FC<GoalsViewProps> = ({
  annualMileageGoals,
  onUpdateAnnualMileageGoal,
  targetGoals,
  onAddTargetGoal,
  onDeleteTargetGoal,
  activities,
  envFilter,
  onSelectEnvFilter,
  distanceUnit,
  currentCtl,
}) => {
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

  // Sync input fields when unit changes
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
      {/* 1. Annual Mileage Targets (Separate Running & Cycling with Outdoor vs. Indoor Treadmill/Trainer Filter) */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              2026 Annual Mileage Targets (Running & Cycling)
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Set separate annual distance goals for Running and Cycling and toggle between Combined, Outdoor Only, or Indoor (Treadmill / Smart Trainer)
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
                className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
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
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Running Annual Target (Road + Trail + Treadmill)
              </h2>
              <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400">
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
                className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white transition-colors whitespace-nowrap"
              >
                Update Run Target
              </button>
            </form>

            <div className="grid grid-cols-3 gap-3 text-xs font-mono tabular-nums pt-1">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3">
                <span className="text-slate-500 block">Outdoor Run YTD</span>
                <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                  {formatDistance(runSummary.outdoorMeters, distanceUnit, 1)}
                </span>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3">
                <span className="text-slate-500 block">Treadmill YTD</span>
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  {formatDistance(runSummary.indoorMeters, distanceUnit, 1)}
                </span>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3">
                <span className="text-slate-500 block">Req. Weekly Pace</span>
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {formatDistance(runSummary.requiredWeeklyMetersRemaining, distanceUnit, 1)}/wk
                </span>
              </div>
            </div>
          </div>

          {/* Cycling Annual Target Card */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Cycling Annual Target (Outdoor Road/Gravel + Smart Trainer)
              </h2>
              <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400">
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
                className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white transition-colors whitespace-nowrap"
              >
                Update Bike Target
              </button>
            </form>

            <div className="grid grid-cols-3 gap-3 text-xs font-mono tabular-nums pt-1">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3">
                <span className="text-slate-500 block">Outdoor Ride YTD</span>
                <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                  {formatDistance(bikeSummary.outdoorMeters, distanceUnit, 1)}
                </span>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3">
                <span className="text-slate-500 block">Smart Trainer YTD</span>
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  {formatDistance(bikeSummary.indoorMeters, distanceUnit, 1)}
                </span>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3">
                <span className="text-slate-500 block">Req. Weekly Pace</span>
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {formatDistance(bikeSummary.requiredWeeklyMetersRemaining, distanceUnit, 1)}/wk
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Target Race Calendar & Physiological Milestones */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-5">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Target Races & Physiological Performance Milestones
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Active goals automatically project your target Peak CTL onto the Overview chart and inform Gemini&apos;s daily workout options
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {targetGoals.map((goal) => {
            const now = new Date('2026-11-05T00:00:00Z').getTime();
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
              <label className="block text-[11px] text-slate-500 mb-1">Event / Goal Name</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Boston Marathon or 320W FTP"
                className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] text-slate-500 mb-1">Sport</label>
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
              <label className="block text-[11px] text-slate-500 mb-1">Priority</label>
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
              <label className="block text-[11px] text-slate-500 mb-1">Target Date</label>
              <input
                type="date"
                value={newTargetDate}
                onChange={(e) => setNewTargetDate(e.target.value)}
                className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] text-slate-500 mb-1">Target Value & Unit</label>
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
              className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-1.5 text-xs font-medium text-white transition-colors whitespace-nowrap"
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
