import React, { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  DistanceUnit,
  EnvironmentFilter,
  PlannedWorkoutEvent,
  SportCategory,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import { formatDistance, formatDuration, formatPace } from '../utils/formatters';

interface CalendarViewProps {
  activities: UnifiedActivity[];
  wellnessDays: UnifiedWellnessDay[];
  plannedEvents: PlannedWorkoutEvent[];
  envFilter: EnvironmentFilter;
  selectedSport: SportCategory | 'ALL';
  distanceUnit: DistanceUnit;
  athleteFtp: number;
  onSelectActivity: (activity: UnifiedActivity) => void;
  onCreatePlannedEvent: (event: {
    date: string;
    name: string;
    sportCategory: SportCategory;
    environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
    plannedDurationSecs: number;
    plannedLoad: number;
    workoutSyntax: string;
    description: string;
  }) => Promise<void>;
  onDeletePlannedEvent: (id: string) => Promise<void>;
  onOpenCoachWithPrompt: (prompt: string) => void;
}

function parsePreviewSteps(syntax: string): { label: string; mins: number; pct: number }[] {
  const lines = syntax
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-'));
  const parsed: { label: string; mins: number; pct: number }[] = [];
  for (const line of lines) {
    const clean = line.replace(/^-\s*/, '');
    const minMatch = clean.match(/(\d+(?:\.\d+)?)\s*m/i);
    const secMatch = clean.match(/(\d+)\s*s/i);
    const pctMatch = clean.match(/(\d+)\s*%/);
    const mins = minMatch ? Number(minMatch[1]) : secMatch ? Number(secMatch[1]) / 60 : 8;
    const pct = pctMatch ? Number(pctMatch[1]) : 75;
    parsed.push({ label: clean, mins: Math.max(0.5, mins), pct: Math.min(150, Math.max(40, pct)) });
  }
  return parsed.length > 0
    ? parsed
    : [
        { label: 'Warmup', mins: 10, pct: 60 },
        { label: 'Main Effort', mins: 30, pct: 90 },
        { label: 'Cooldown', mins: 10, pct: 55 },
      ];
}

function downloadWorkoutFile(event: PlannedWorkoutEvent, format: 'zwo' | 'erg', ftp: number) {
  const steps = event.structuredSteps || [];
  let content = '';
  const safeName = event.name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();

  if (format === 'zwo') {
    const stepXml = steps
      .map((s) => {
        const dur = s.durationSecs || 600;
        const powerRel = ((s.targetPctFtp || 75) / 100).toFixed(2);
        return `    <SteadyState Duration="${dur}" Power="${powerRel}" />`;
      })
      .join('\n');
    content = `<?xml version="1.0" encoding="UTF-8"?>
<workout_file>
  <author>AeroPulse AI Coach</author>
  <name>${event.name}</name>
  <description>${event.description}</description>
  <sportType>${event.sportCategory === 'Running' ? 'run' : 'bike'}</sportType>
  <workout>
${stepXml || '    <SteadyState Duration="3600" Power="0.75" />'}
  </workout>
</workout_file>`;
  } else {
    let elapsedMins = 0;
    const ergLines: string[] = [];
    for (const s of steps) {
      const mins = Math.max(1, Math.round((s.durationSecs || 600) / 60));
      const watts = Math.round(((s.targetPctFtp || 75) / 100) * ftp);
      ergLines.push(`${elapsedMins.toFixed(1)}\t${watts}`);
      elapsedMins += mins;
      ergLines.push(`${elapsedMins.toFixed(1)}\t${watts}`);
    }
    content = `[COURSE HEADER]
VERSION = 2
UNITS = ENGLISH
DESCRIPTION = ${event.name}
FILE NAME = ${safeName}.erg
FTP = ${ftp}
MINUTES WATTS
[END COURSE HEADER]
[COURSE DATA]
${ergLines.join('\n')}
[END COURSE DATA]`;
  }

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  activities,
  wellnessDays,
  plannedEvents,
  envFilter,
  selectedSport,
  distanceUnit,
  athleteFtp,
  onSelectActivity,
  onCreatePlannedEvent,
  onDeletePlannedEvent,
  onOpenCoachWithPrompt,
}) => {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [currentMonthDate, setCurrentMonthDate] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [showWellnessMetrics, setShowWellnessMetrics] = useState<boolean>(true);

  // Workout Builder Modal State
  const [builderDate, setBuilderDate] = useState<string | null>(null);
  const [builderName, setBuilderName] = useState('Threshold Over-Unders 4x8m');
  const [builderSport, setBuilderSport] = useState<SportCategory>('Cycling');
  const [builderEnv, setBuilderEnv] = useState<'OUTDOOR' | 'INDOOR' | 'FLEXIBLE'>('INDOOR');
  const [builderDurationMins, setBuilderDurationMins] = useState(60);
  const [builderLoad, setBuilderLoad] = useState(78);
  const [builderSyntax, setBuilderSyntax] = useState(
    `- 12m 60% FTP Warmup\n- 8m 95% FTP Threshold\n- 3m 55% FTP Recovery\n- 8m 102% FTP Threshold\n- 3m 55% FTP Recovery\n- 8m 105% FTP Threshold\n- 3m 55% FTP Recovery\n- 8m 105% FTP Threshold\n- 7m 50% FTP Cooldown`
  );
  const [isSavingWorkout, setIsSavingWorkout] = useState(false);

  const previewSteps = useMemo(() => parsePreviewSteps(builderSyntax), [builderSyntax]);

  // Index activities, wellness, and planned events by YYYY-MM-DD
  const activitiesByDate = useMemo(() => {
    const map = new Map<string, UnifiedActivity[]>();
    for (const act of activities) {
      if (selectedSport !== 'ALL' && act.sportCategory !== selectedSport) continue;
      if (envFilter !== 'COMBINED' && act.environment !== envFilter) continue;
      const d = act.startDateLocal.slice(0, 10);
      const list = map.get(d) || [];
      list.push(act);
      map.set(d, list);
    }
    return map;
  }, [activities, selectedSport, envFilter]);

  const wellnessByDate = useMemo(() => {
    const map = new Map<string, UnifiedWellnessDay>();
    for (const w of wellnessDays) {
      map.set(w.date.slice(0, 10), w);
    }
    return map;
  }, [wellnessDays]);

  const plannedByDate = useMemo(() => {
    const map = new Map<string, PlannedWorkoutEvent[]>();
    for (const ev of plannedEvents) {
      if (selectedSport !== 'ALL' && ev.sportCategory !== selectedSport) continue;
      const d = ev.date.slice(0, 10);
      const list = map.get(d) || [];
      list.push(ev);
      map.set(d, list);
    }
    return map;
  }, [plannedEvents, selectedSport]);

  // Build weeks (Monday through Sunday) for the selected month
  const calendarWeeks = useMemo(() => {
    const year = currentMonthDate.getFullYear();
    const month = currentMonthDate.getMonth();
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    // Monday-based week start (0=Mon .. 6=Sun)
    const startOffset = (firstDayOfMonth.getDay() + 6) % 7;
    const gridStart = new Date(year, month, 1 - startOffset);

    const endOffset = (7 - ((lastDayOfMonth.getDay() + 6) % 7) - 1 + 7) % 7;
    const gridEnd = new Date(year, month + 1, endOffset);

    const weeks: {
      weekNumber: number;
      days: {
        dateStr: string;
        dayNumber: number;
        isCurrentMonth: boolean;
        isToday: boolean;
        activities: UnifiedActivity[];
        planned: PlannedWorkoutEvent[];
        wellness?: UnifiedWellnessDay;
        dayDurationSecs: number;
        dayLoad: number;
        dayPlannedLoad: number;
        dayPlannedDurationSecs: number;
      }[];
      summary: {
        totalLoad: number;
        plannedLoad: number;
        totalDurationSecs: number;
        bikeMeters: number;
        bikeIndoorMeters: number;
        runMeters: number;
        runIndoorMeters: number;
        endCtl?: number;
        endTsb?: number;
        avgSleepSecs: number;
        avgHrv: number;
      };
    }[] = [];

    const cursor = new Date(gridStart);
    while (cursor <= gridEnd) {
      const days = [];
      let totalLoad = 0;
      let plannedLoad = 0;
      let totalDurationSecs = 0;
      let bikeMeters = 0;
      let bikeIndoorMeters = 0;
      let runMeters = 0;
      let runIndoorMeters = 0;
      let endCtl: number | undefined;
      let endTsb: number | undefined;
      let sleepSum = 0;
      let sleepCount = 0;
      let hrvSum = 0;
      let hrvCount = 0;

      for (let i = 0; i < 7; i++) {
        const y = cursor.getFullYear();
        const m = String(cursor.getMonth() + 1).padStart(2, '0');
        const d = String(cursor.getDate()).padStart(2, '0');
        const dateStr = `${y}-${m}-${d}`;
        const dayActs = activitiesByDate.get(dateStr) || [];
        const dayPlans = plannedByDate.get(dateStr) || [];
        const dayWell = wellnessByDate.get(dateStr);

        let dayDurationSecs = 0;
        let dayLoad = 0;
        let dayPlannedLoad = 0;
        let dayPlannedDurationSecs = 0;

        for (const a of dayActs) {
          const load = a.trainingLoad || 0;
          const dur = a.movingTimeSecs || 0;
          dayLoad += load;
          dayDurationSecs += dur;
          totalLoad += load;
          totalDurationSecs += dur;
          if (a.sportCategory === 'Cycling') {
            bikeMeters += a.distanceMeters || 0;
            if (a.environment === 'INDOOR') bikeIndoorMeters += a.distanceMeters || 0;
          } else if (a.sportCategory === 'Running') {
            runMeters += a.distanceMeters || 0;
            if (a.environment === 'INDOOR') runIndoorMeters += a.distanceMeters || 0;
          }
        }
        for (const p of dayPlans) {
          dayPlannedLoad += p.plannedLoad || 0;
          dayPlannedDurationSecs += p.plannedDurationSecs || 0;
          plannedLoad += p.plannedLoad || 0;
        }
        if (dayWell) {
          if (dayWell.ctl > 0) {
            endCtl = dayWell.ctl;
            endTsb = dayWell.tsb;
          }
          if (dayWell.sleepSecs > 0) {
            sleepSum += dayWell.sleepSecs;
            sleepCount++;
          }
          if (dayWell.hrvRMSSD > 0) {
            hrvSum += dayWell.hrvRMSSD;
            hrvCount++;
          }
        }

        days.push({
          dateStr,
          dayNumber: cursor.getDate(),
          isCurrentMonth: cursor.getMonth() === month,
          isToday: dateStr === todayStr,
          activities: dayActs,
          planned: dayPlans,
          wellness: dayWell,
          dayDurationSecs,
          dayLoad,
          dayPlannedLoad,
          dayPlannedDurationSecs,
        });

        cursor.setDate(cursor.getDate() + 1);
      }

      const startOfYear = new Date(days[0].dateStr);
      const jan1 = new Date(startOfYear.getFullYear(), 0, 1);
      const weekNumber = Math.ceil(
        ((startOfYear.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7
      );

      weeks.push({
        weekNumber,
        days,
        summary: {
          totalLoad,
          plannedLoad,
          totalDurationSecs,
          bikeMeters,
          bikeIndoorMeters,
          runMeters,
          runIndoorMeters,
          endCtl,
          endTsb,
          avgSleepSecs: sleepCount > 0 ? Math.round(sleepSum / sleepCount) : 0,
          avgHrv: hrvCount > 0 ? Math.round(hrvSum / hrvCount) : 0,
        },
      });
    }

    return weeks;
  }, [currentMonthDate, activitiesByDate, plannedByDate, wellnessByDate, todayStr]);

  // Available years from all-time history for quick jumping
  const availableYears = useMemo(() => {
    const years = new Set<number>([new Date().getFullYear()]);
    for (const a of activities) {
      const y = Number(a.startDateLocal.slice(0, 4));
      if (y >= 2010 && y <= 2030) years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [activities]);

  // Monthly rollup summary
  const monthRollup = useMemo(() => {
    const prefix = `${currentMonthDate.getFullYear()}-${String(currentMonthDate.getMonth() + 1).padStart(2, '0')}`;
    const monthActs = activities.filter((a) => {
      if (!a.startDateLocal.startsWith(prefix)) return false;
      if (selectedSport !== 'ALL' && a.sportCategory !== selectedSport) return false;
      if (envFilter !== 'COMBINED' && a.environment !== envFilter) return false;
      return true;
    });
    const load = monthActs.reduce((acc, a) => acc + a.trainingLoad, 0);
    const secs = monthActs.reduce((acc, a) => acc + a.movingTimeSecs, 0);
    const bikeM = monthActs
      .filter((a) => a.sportCategory === 'Cycling')
      .reduce((acc, a) => acc + a.distanceMeters, 0);
    const runM = monthActs
      .filter((a) => a.sportCategory === 'Running')
      .reduce((acc, a) => acc + a.distanceMeters, 0);
    return { count: monthActs.length, load, secs, bikeM, runM };
  }, [activities, currentMonthDate, selectedSport, envFilter]);

  const handleSaveWorkout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!builderDate) return;
    setIsSavingWorkout(true);
    try {
      await onCreatePlannedEvent({
        date: builderDate,
        name: builderName,
        sportCategory: builderSport,
        environmentPreference: builderEnv,
        plannedDurationSecs: builderDurationMins * 60,
        plannedLoad: builderLoad,
        workoutSyntax: builderSyntax,
        description: builderSyntax,
      });
      setBuilderDate(null);
    } finally {
      setIsSavingWorkout(false);
    }
  };

  const monthLabel = currentMonthDate.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="space-y-5">
      {/* Top Calendar Controls & Monthly Summary Strip */}
      <section className="rounded-2xl liquid-glass p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1">
              <button
                onClick={() =>
                  setCurrentMonthDate(
                    new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() - 1, 1)
                  )
                }
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 transition-colors"
                aria-label="Previous month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-3 text-base font-bold text-slate-900 dark:text-slate-100 min-w-[155px] text-center">
                {monthLabel}
              </span>
              <button
                onClick={() =>
                  setCurrentMonthDate(
                    new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() + 1, 1)
                  )
                }
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 transition-colors"
                aria-label="Next month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Year Jump across All-Time History */}
            <select
              value={currentMonthDate.getFullYear()}
              onChange={(e) =>
                setCurrentMonthDate(new Date(Number(e.target.value), currentMonthDate.getMonth(), 1))
              }
              className="min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 text-sm font-mono text-slate-900 dark:text-slate-100"
            >
              {availableYears.map((yr) => (
                <option key={yr} value={yr}>
                  {yr} Archive
                </option>
              ))}
            </select>

            <button
              onClick={() => {
                const now = new Date();
                setCurrentMonthDate(new Date(now.getFullYear(), now.getMonth(), 1));
              }}
              className="min-h-[38px] px-3.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Today
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showWellnessMetrics}
                onChange={(e) => setShowWellnessMetrics(e.target.checked)}
                className="rounded border-slate-400 text-blue-600 focus:ring-blue-500"
              />
              <span>Show Garmin Sleep &amp; HRV</span>
            </label>

            <button
              onClick={() => setBuilderDate(todayStr)}
              className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white text-sm font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Workout Builder</span>
            </button>

            <button
              onClick={() =>
                onOpenCoachWithPrompt(
                  `Design a structured 5-day cycling and running schedule for this week (${todayStr}) based on my latest Garmin Sleep Score, HRV Status, and CTL/ATL/TSB.`
                )
              }
              className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
            >
              Ask AI Coach to Plan Week
            </button>
          </div>
        </div>

        {/* Monthly Totals Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-3 border-t border-slate-200 dark:border-slate-800 text-sm font-mono tabular-nums">
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5">
            <span className="text-xs text-slate-500 block font-sans">Month Workouts</span>
            <span className="text-base font-bold text-slate-900 dark:text-slate-100">
              {monthRollup.count} sessions
            </span>
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5">
            <span className="text-xs text-slate-500 block font-sans">Month Load (TSS)</span>
            <span className="text-base font-bold text-blue-600 dark:text-blue-400">
              {monthRollup.load} TSS
            </span>
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5">
            <span className="text-xs text-slate-500 block font-sans">Moving Duration</span>
            <span className="text-base font-bold text-slate-900 dark:text-slate-100">
              {formatDuration(monthRollup.secs)}
            </span>
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5">
            <span className="text-xs text-slate-500 block font-sans">Cycling Distance</span>
            <span className="text-base font-bold text-cyan-600 dark:text-cyan-400">
              {formatDistance(monthRollup.bikeM, distanceUnit, 1)}
            </span>
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5">
            <span className="text-xs text-slate-500 block font-sans">Running Distance</span>
            <span className="text-base font-bold text-orange-600 dark:text-orange-400">
              {formatDistance(monthRollup.runM, distanceUnit, 1)}
            </span>
          </div>
        </div>
      </section>

      {/* Intervals.icu Style 8-Column Calendar Grid (Mon-Sun + Weekly Totals Column) */}
      <section className="rounded-2xl liquid-glass overflow-x-auto">
        <div className="min-w-[1060px]">
          {/* Header Row */}
          <div className="grid grid-cols-8 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div
                key={d}
                className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-800"
              >
                {d}
              </div>
            ))}
            <div className="py-2.5 px-3 text-blue-600 dark:text-blue-400">
              Weekly Workload &amp; Totals
            </div>
          </div>

          {/* Week Rows */}
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {calendarWeeks.map((week, wIdx) => (
              <div key={wIdx} className="grid grid-cols-8 min-h-[170px]">
                {week.days.map((day) => {
                  const hasDayActivityOrPlan =
                    day.dayDurationSecs > 0 ||
                    day.dayLoad > 0 ||
                    day.dayPlannedLoad > 0 ||
                    day.dayPlannedDurationSecs > 0;

                  return (
                    <div
                      key={day.dateStr}
                      className={`group relative p-2.5 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between transition-colors ${
                        !day.isCurrentMonth
                          ? 'bg-slate-50/50 dark:bg-slate-950/30 opacity-60'
                          : day.isToday
                            ? 'bg-blue-500/5 dark:bg-blue-500/10'
                            : 'hover:bg-slate-50/80 dark:hover:bg-slate-900/40'
                      }`}
                    >
                      <div className="space-y-2">
                        {/* Date Number + Quick Add Button */}
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className={`text-sm font-mono font-bold ${
                              day.isToday
                                ? 'px-2 py-0.5 rounded bg-blue-600 text-white'
                                : 'text-slate-800 dark:text-slate-200'
                            }`}
                          >
                            {day.dayNumber}
                          </span>

                          <button
                            onClick={() => setBuilderDate(day.dateStr)}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-blue-500 transition-opacity"
                            title={`Plan workout on ${day.dateStr}`}
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Labeled Morning Garmin Sleep & HRV Line */}
                        {showWellnessMetrics &&
                          day.wellness &&
                          (day.wellness.sleepSecs > 0 || day.wellness.hrvRMSSD > 0) && (
                            <div
                              title={`Garmin Sleep: ${(day.wellness.sleepSecs / 3600).toFixed(1)}h (Score ${day.wellness.sleepScore}) · HRV: ${day.wellness.hrvRMSSD}ms (${day.wellness.hrvStatus || 'Balanced'}) · RHR: ${day.wellness.restingHR}bpm`}
                              className="rounded-md bg-slate-100/80 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 px-2 py-1 text-xs font-mono tabular-nums space-y-0.5"
                            >
                              {day.wellness.sleepSecs > 0 && (
                                <div className="flex items-center justify-between text-indigo-600 dark:text-indigo-400">
                                  <span className="font-sans text-slate-500 dark:text-slate-400">
                                    Sleep:
                                  </span>
                                  <span className="font-semibold">
                                    {(day.wellness.sleepSecs / 3600).toFixed(1)}h
                                    {day.wellness.sleepScore > 0
                                      ? ` (${day.wellness.sleepScore})`
                                      : ''}
                                  </span>
                                </div>
                              )}
                              {day.wellness.hrvRMSSD > 0 && (
                                <div className="flex items-center justify-between">
                                  <span className="font-sans text-slate-500 dark:text-slate-400">
                                    HRV:
                                  </span>
                                  <span
                                    className={
                                      day.wellness.hrvStatus === 'Low'
                                        ? 'text-red-500 font-semibold'
                                        : day.wellness.hrvStatus === 'Unbalanced'
                                          ? 'text-amber-500 font-semibold'
                                          : 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                    }
                                  >
                                    {day.wellness.hrvRMSSD} ms
                                  </span>
                                </div>
                              )}
                            </div>
                          )}

                        {/* Completed Workouts */}
                        {day.activities.map((act) => {
                          const isBike = act.sportCategory === 'Cycling';
                          const isRun = act.sportCategory === 'Running';
                          const isIndoor = act.environment === 'INDOOR';

                          const borderAccent = isBike
                            ? isIndoor
                              ? 'border-l-indigo-500 bg-indigo-500/10 dark:bg-indigo-500/15'
                              : 'border-l-cyan-500 bg-cyan-500/10 dark:bg-cyan-500/15'
                            : isRun
                              ? 'border-l-orange-500 bg-orange-500/10 dark:bg-orange-500/15'
                              : 'border-l-emerald-500 bg-emerald-500/10 dark:bg-emerald-500/15';

                          return (
                            <button
                              key={act.id}
                              onClick={() => onSelectActivity(act)}
                              className={`w-full text-left rounded-md border-l-3 px-2 py-1.5 text-xs transition-transform hover:scale-[1.01] ${borderAccent}`}
                            >
                              <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                                {act.name}
                              </div>
                              <div className="flex items-center justify-between font-mono text-xs text-slate-600 dark:text-slate-300 mt-0.5 tabular-nums">
                                <span>
                                  {act.distanceMeters > 0
                                    ? formatDistance(act.distanceMeters, distanceUnit, 1)
                                    : formatDuration(act.movingTimeSecs)}
                                </span>
                                <span className="font-bold text-blue-600 dark:text-blue-400">
                                  {act.trainingLoad > 0 ? `${act.trainingLoad} TSS` : ''}
                                </span>
                              </div>
                              {(act.normalizedPower || act.avgPaceSecsPerKm) && (
                                <div className="font-mono text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                                  {act.normalizedPower
                                    ? `NP ${act.normalizedPower}W`
                                    : act.avgPaceSecsPerKm
                                      ? formatPace(act.avgPaceSecsPerKm, distanceUnit)
                                      : ''}{' '}
                                  {act.avgHr > 0 ? `· ${act.avgHr}bpm` : ''}
                                </div>
                              )}
                            </button>
                          );
                        })}

                        {/* Planned Structured Workouts */}
                        {day.planned.map((plan) => (
                          <div
                            key={plan.id}
                            className="rounded-md border border-dashed border-blue-500/60 bg-blue-500/5 dark:bg-blue-950/30 p-2 text-xs space-y-1"
                          >
                            <div className="flex items-start justify-between gap-1">
                              <span className="font-semibold text-blue-700 dark:text-blue-300 leading-tight">
                                {plan.name}
                              </span>
                              <button
                                onClick={() => onDeletePlannedEvent(plan.id)}
                                className="text-slate-400 hover:text-red-500 shrink-0"
                                title="Remove planned workout"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="flex items-center justify-between font-mono text-xs text-slate-500 dark:text-slate-400">
                              <span>
                                {plan.sportCategory} · {Math.round(plan.plannedDurationSecs / 60)}m
                              </span>
                              <span className="font-semibold text-blue-500">
                                ~{plan.plannedLoad} TSS
                              </span>
                            </div>
                            {plan.structuredSteps && plan.structuredSteps.length > 0 && (
                              <div className="flex items-end gap-0.5 h-4 pt-0.5">
                                {plan.structuredSteps.slice(0, 10).map((s, idx) => {
                                  const pct = Math.min(130, Math.max(40, s.targetPctFtp || 75));
                                  const hPct = Math.round((pct / 130) * 100);
                                  return (
                                    <div
                                      key={idx}
                                      style={{ height: `${hPct}%` }}
                                      className={`flex-1 rounded-t-[1px] ${
                                        pct >= 100
                                          ? 'bg-amber-500'
                                          : pct >= 85
                                            ? 'bg-emerald-500'
                                            : 'bg-blue-500'
                                      }`}
                                      title={`${s.label}: ${s.duration} (${s.targetZoneOrOutput})`}
                                    />
                                  );
                                })}
                              </div>
                            )}
                            <div className="flex items-center gap-2 pt-0.5">
                              <button
                                onClick={() => downloadWorkoutFile(plan, 'zwo', athleteFtp)}
                                className="text-xs font-mono text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5"
                              >
                                <Download className="w-3 h-3" /> .ZWO
                              </button>
                              <button
                                onClick={() => downloadWorkoutFile(plan, 'erg', athleteFtp)}
                                className="text-xs font-mono text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5"
                              >
                                <Download className="w-3 h-3" /> .ERG
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Daily Duration & Load Summary Footer (matching Weekly Totals style) */}
                      {hasDayActivityOrPlan && (
                        <div className="mt-2 pt-1.5 border-t border-slate-200/80 dark:border-slate-800/90 text-xs font-mono tabular-nums space-y-0.5">
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span className="font-sans text-slate-500">Dur:</span>
                            <span className="font-semibold">
                              {formatDuration(
                                day.dayDurationSecs > 0
                                  ? day.dayDurationSecs
                                  : day.dayPlannedDurationSecs
                              )}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="font-sans text-slate-500">Load:</span>
                            <span className="font-bold text-blue-600 dark:text-blue-400">
                              {day.dayLoad > 0 ? `${day.dayLoad} TSS` : ''}
                              {day.dayPlannedLoad > 0
                                ? `${day.dayLoad > 0 ? ' ' : ''}(+${day.dayPlannedLoad})`
                                : ''}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Column 8: Intervals.icu Weekly Summary Sidebar */}
                <div className="p-3 bg-slate-50/70 dark:bg-slate-900/40 flex flex-col justify-between font-mono text-xs tabular-nums">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-slate-500 font-sans">
                      <span className="font-semibold">WK {week.weekNumber}</span>
                      {week.summary.endCtl !== undefined && (
                        <span className="font-mono text-blue-600 dark:text-blue-400 font-bold">
                          CTL {week.summary.endCtl}
                        </span>
                      )}
                    </div>

                    <div className="flex items-baseline justify-between pt-0.5">
                      <span className="text-slate-500 font-sans">Load:</span>
                      <span className="font-bold text-slate-900 dark:text-slate-100">
                        {week.summary.totalLoad} TSS
                        {week.summary.plannedLoad > 0 && (
                          <span className="text-blue-500 font-normal">
                            {' '}
                            (+{week.summary.plannedLoad})
                          </span>
                        )}
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between">
                      <span className="text-slate-500 font-sans">Duration:</span>
                      <span className="text-slate-800 dark:text-slate-200 font-semibold">
                        {formatDuration(week.summary.totalDurationSecs)}
                      </span>
                    </div>

                    {week.summary.bikeMeters > 0 && (
                      <div className="flex items-baseline justify-between text-cyan-600 dark:text-cyan-400">
                        <span className="font-sans">Bike:</span>
                        <span className="font-semibold">
                          {formatDistance(week.summary.bikeMeters, distanceUnit, 1)}
                        </span>
                      </div>
                    )}

                    {week.summary.runMeters > 0 && (
                      <div className="flex items-baseline justify-between text-orange-600 dark:text-orange-400">
                        <span className="font-sans">Run:</span>
                        <span className="font-semibold">
                          {formatDistance(week.summary.runMeters, distanceUnit, 1)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Weekly Average Sleep & HRV + End-of-week TSB Form */}
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1 text-xs">
                    {week.summary.avgSleepSecs > 0 && (
                      <div className="flex items-center justify-between text-slate-500">
                        <span className="font-sans">Avg Sleep:</span>
                        <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
                          {(week.summary.avgSleepSecs / 3600).toFixed(1)}h
                        </span>
                      </div>
                    )}
                    {week.summary.avgHrv > 0 && (
                      <div className="flex items-center justify-between text-slate-500">
                        <span className="font-sans">Avg HRV:</span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                          {week.summary.avgHrv} ms
                        </span>
                      </div>
                    )}
                    {week.summary.endTsb !== undefined && (
                      <div className="flex items-center justify-between text-slate-500">
                        <span className="font-sans">Form (TSB):</span>
                        <span
                          className={
                            week.summary.endTsb >= 0
                              ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                              : week.summary.endTsb < -18
                                ? 'text-red-500 font-bold'
                                : 'text-amber-500 font-bold'
                          }
                        >
                          {week.summary.endTsb > 0
                            ? `+${week.summary.endTsb}`
                            : week.summary.endTsb}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Intervals.icu Structured Workout Builder Modal */}
      {builderDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl rounded-2xl liquid-glass shadow-2xl overflow-hidden max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Intervals.icu Structured Workout Builder
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Schedule on calendar ({builderDate}), export .ZWO/.ERG, or push to Garmin via Intervals.icu
                </p>
              </div>
              <button
                onClick={() => setBuilderDate(null)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveWorkout} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={builderDate}
                    onChange={(e) => setBuilderDate(e.target.value)}
                    className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 text-sm font-mono text-slate-900 dark:text-slate-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Workout Title
                  </label>
                  <input
                    type="text"
                    value={builderName}
                    onChange={(e) => setBuilderName(e.target.value)}
                    className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Sport
                  </label>
                  <select
                    value={builderSport}
                    onChange={(e) => setBuilderSport(e.target.value as SportCategory)}
                    className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 py-1.5 text-sm text-slate-900 dark:text-slate-100"
                  >
                    <option value="Cycling">Cycling</option>
                    <option value="Running">Running</option>
                    <option value="Swimming">Swimming</option>
                    <option value="Strength">Strength</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Environment
                  </label>
                  <select
                    value={builderEnv}
                    onChange={(e) =>
                      setBuilderEnv(e.target.value as 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE')
                    }
                    className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 py-1.5 text-sm text-slate-900 dark:text-slate-100"
                  >
                    <option value="INDOOR">Indoor (Trainer/Treadmill)</option>
                    <option value="OUTDOOR">Outdoor</option>
                    <option value="FLEXIBLE">Flexible</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Duration (min)
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={480}
                    value={builderDurationMins}
                    onChange={(e) => setBuilderDurationMins(Number(e.target.value))}
                    className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 text-sm font-mono text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Planned TSS
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={500}
                    value={builderLoad}
                    onChange={(e) => setBuilderLoad(Number(e.target.value))}
                    className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 text-sm font-mono text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              {/* Visual Interval Profile Preview Chart with X & Y Axis Labels */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/60 dark:bg-slate-900/50 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Interval Intensity Profile Preview (% FTP / Threshold Pace)
                  </span>
                  <span className="font-mono text-slate-500">
                    Total Parsed Steps: {previewSteps.length}
                  </span>
                </div>
                <svg viewBox="0 0 600 135" className="w-full h-32">
                  {(() => {
                    const totalMins = Math.max(
                      1,
                      previewSteps.reduce((acc, s) => acc + s.mins, 0)
                    );
                    let accumMins = 0;
                    return (
                      <>
                        {/* Y-Axis Title */}
                        <text
                          x={12}
                          y={58}
                          transform="rotate(-90 12 58)"
                          textAnchor="middle"
                          className="fill-slate-500 text-[11px] font-sans font-semibold"
                        >
                          % FTP
                        </text>
                        {[50, 75, 100, 125].map((pct) => {
                          const y = 102 - (pct / 140) * 84;
                          return (
                            <g key={pct}>
                              <line
                                x1={44}
                                y1={y}
                                x2={586}
                                y2={y}
                                stroke="currentColor"
                                className="text-slate-200 dark:text-slate-800"
                                strokeDasharray="3 3"
                              />
                              <text
                                x={40}
                                y={y + 4}
                                textAnchor="end"
                                className="fill-slate-500 text-[11px] font-mono"
                              >
                                {pct}%
                              </text>
                            </g>
                          );
                        })}

                        {previewSteps.map((s, idx) => {
                          const x = 44 + (accumMins / totalMins) * 542;
                          const w = Math.max(4, (s.mins / totalMins) * 542 - 2);
                          const h = Math.min(86, (s.pct / 140) * 84);
                          accumMins += s.mins;
                          const fill =
                            s.pct >= 100
                              ? '#F59E0B'
                              : s.pct >= 85
                                ? '#10B981'
                                : '#3B82F6';
                          return (
                            <rect
                              key={idx}
                              x={x}
                              y={102 - h}
                              width={w}
                              height={h}
                              fill={fill}
                              rx={2}
                              opacity={0.85}
                            >
                              <title>
                                {s.label} ({s.mins}m @ {s.pct}%)
                              </title>
                            </rect>
                          );
                        })}

                        {/* X-Axis Ticks & Label */}
                        {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                          const x = 44 + f * 542;
                          return (
                            <text
                              key={idx}
                              x={x}
                              y={116}
                              textAnchor="middle"
                              className="fill-slate-500 text-[11px] font-mono"
                            >
                              {Math.round(f * totalMins)}m
                            </text>
                          );
                        })}
                        <text
                          x={315}
                          y={131}
                          textAnchor="middle"
                          className="fill-slate-500 text-[11px] font-sans font-semibold"
                        >
                          Elapsed Workout Time (minutes)
                        </text>
                      </>
                    );
                  })()}
                </svg>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Intervals.icu Step Syntax (one step per line starting with &quot;- &quot;)
                  </label>
                  <div className="flex items-center gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setBuilderName('Sweet Spot 3x12m (Indoor Trainer)');
                        setBuilderSport('Cycling');
                        setBuilderEnv('INDOOR');
                        setBuilderDurationMins(60);
                        setBuilderLoad(76);
                        setBuilderSyntax(
                          `- 10m 60% FTP Warmup\n- 12m 90% FTP Sweet Spot\n- 4m 55% FTP Recovery\n- 12m 92% FTP Sweet Spot\n- 4m 55% FTP Recovery\n- 12m 92% FTP Sweet Spot\n- 6m 50% FTP Cooldown`
                        );
                      }}
                      className="text-blue-500 hover:underline font-medium"
                    >
                      Preset: Sweet Spot
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBuilderName('Track 6x800m Threshold Repeats');
                        setBuilderSport('Running');
                        setBuilderEnv('OUTDOOR');
                        setBuilderDurationMins(55);
                        setBuilderLoad(72);
                        setBuilderSyntax(
                          `- 15m 70% Pace Warmup\n- 3m 103% Pace 800m #1\n- 90s 60% Jog\n- 3m 103% Pace 800m #2\n- 90s 60% Jog\n- 3m 105% Pace 800m #3\n- 90s 60% Jog\n- 3m 105% Pace 800m #4\n- 10m 65% Cooldown`
                        );
                      }}
                      className="text-orange-500 hover:underline font-medium"
                    >
                      Preset: Track 800s
                    </button>
                  </div>
                </div>
                <textarea
                  rows={5}
                  value={builderSyntax}
                  onChange={(e) => setBuilderSyntax(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3 text-sm font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setBuilderDate(null)}
                  className="min-h-[38px] px-4 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingWorkout}
                  className="min-h-[38px] px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold"
                >
                  {isSavingWorkout ? 'Scheduling...' : 'Schedule Workout on Calendar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
