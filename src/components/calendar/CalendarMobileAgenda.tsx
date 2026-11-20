import React from 'react';
import {
  ChevronRight,
  Clock,
  Download,
  FileText,
  Flame,
  Heart,
  MapPin,
  Moon,
  Plus,
  ShareNetwork,
  Sparkles,
  Timer,
  Trash2,
  Trophy,
} from '../icons/PhosphorIcons';
import type {
  AthleteProfile,
  DistanceUnit,
  PlannedWorkoutEvent,
  SportCategory,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../../types';
import { formatDistance } from '../../utils/formatters';
import { formatSessionLogisticsLine } from '../../utils/workoutScheduleUtils';
import { inferTrackWorkoutSpecFromPlannedEvent } from '../../hooks/useTracksideStopwatch';
import {
  buildActivityEffortPresentation,
  buildDayPlannedEffortStripe,
  formatCompactDuration,
  formatHeaderDate,
  getSportHeaderColor,
  type CalendarWeekSummary,
} from './calendarEffortUtils';

export interface CalendarMobileAgendaProps {
  calendarWeeks: CalendarWeekSummary[];
  showDayEffortStripe: boolean;
  showCellWellness: boolean;
  todayIso: string;
  distanceUnit: DistanceUnit;
  athleteFtp: number;
  athleteProfile?: AthleteProfile;
  pendingDeletePlannedId: string | null;
  setPendingDeletePlannedId: React.Dispatch<React.SetStateAction<string | null>>;
  onSelectActivity: (activity: UnifiedActivity) => void;
  onOpenTodayWorkout?: () => void;
  onDeletePlannedEvent?: (id: string) => Promise<void>;
  onOpenCoachWithPrompt?: (prompt: string) => void;
  onOpenTracksideStopwatch?: () => void;
  onOpenBuilderForDate: (dateStr: string, ev?: PlannedWorkoutEvent | null) => void;
  handleLaunchPlannedInStopwatch: (ev: PlannedWorkoutEvent) => void;
  handleExportPlannedFit: (ev: PlannedWorkoutEvent) => void;
  handleExportPlannedZwo: (ev: PlannedWorkoutEvent) => void;
  handleExportPlannedErg: (ev: PlannedWorkoutEvent) => void;
  handleSharePlannedWorkout: (ev: PlannedWorkoutEvent) => void;
  getSportIcon: (sport: SportCategory, className?: string) => React.ReactNode;
}

export const CalendarMobileAgenda: React.FC<CalendarMobileAgendaProps> = ({
  calendarWeeks,
  showDayEffortStripe,
  showCellWellness,
  todayIso,
  distanceUnit,
  athleteFtp,
  athleteProfile,
  pendingDeletePlannedId,
  setPendingDeletePlannedId,
  onSelectActivity,
  onOpenTodayWorkout,
  onDeletePlannedEvent,
  onOpenCoachWithPrompt,
  onOpenTracksideStopwatch,
  onOpenBuilderForDate: handleOpenBuilderForDate,
  handleLaunchPlannedInStopwatch,
  handleExportPlannedFit,
  handleExportPlannedZwo,
  handleExportPlannedErg,
  handleSharePlannedWorkout,
  getSportIcon,
}) => {
  return (
    <section className="xl:hidden space-y-3">
          {calendarWeeks.map((week) => {
            const eow = week.endOfWeekWellness;
            const tsbVal = eow ? Math.round(eow.tsb) : null;
            const activeDays = week.days.filter(
              (d) =>
                d.isCurrentMonth ||
                d.dayActivities.length > 0 ||
                d.dayPlanned.length > 0 ||
                d.dateStr === todayIso
            );
            if (activeDays.length === 0) return null;

            return (
              <div
                key={`mob-wk-${week.weekIndex}`}
                className="rounded-2xl liquid-glass overflow-hidden border border-slate-200/90 dark:border-slate-800/90"
              >
                {/* Mobile Week Summary Header */}
                <div className="p-3 bg-slate-100/90 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-extrabold font-mono">
                        W{week.isoWeekNum}
                      </span>
                      <span className="text-2xs font-mono text-slate-600 dark:text-slate-300">
                        {formatHeaderDate(week.days[0].dateStr)} –{' '}
                        {formatHeaderDate(week.days[6].dateStr)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenCoachWithPrompt?.(
                          `Analyze Week ${week.isoWeekNum} (${week.days[0].dateStr} to ${week.days[6].dateStr}): Total time ${formatCompactDuration(week.totalDurationSecs)}, Load ${week.totalLoad}, Fitness ${eow ? Math.round(eow.ctl) : '-'}, Form ${tsbVal ?? '-'}, Zone focus ${week.weekZoneLabel}.`
                        )
                      }
                      className="min-h-[44px] sm:min-h-[32px] inline-flex items-center px-3 sm:px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-600 dark:text-sky-400 text-2xs font-semibold"
                    >
                      AI Coach
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 text-2xs font-mono">
                    <div className="px-2 py-1 rounded-lg bg-white/80 dark:bg-ap-turf/60 border border-slate-200/70 dark:border-slate-800">
                      <span className="text-2xs uppercase text-slate-600 dark:text-slate-400 block">Time</span>
                      <strong className="text-slate-900 dark:text-white">
                        {week.totalDurationSecs > 0
                          ? formatCompactDuration(week.totalDurationSecs)
                          : '0m'}
                      </strong>
                    </div>
                    <div className="px-2 py-1 rounded-lg bg-white/80 dark:bg-ap-turf/60 border border-slate-200/70 dark:border-slate-800">
                      <span className="text-2xs uppercase text-slate-600 dark:text-slate-400 block">Load</span>
                      <strong className="text-slate-900 dark:text-white">{week.totalLoad}</strong>
                    </div>
                    <div className="px-2 py-1 rounded-lg bg-white/80 dark:bg-ap-carbon border border-emerald-900/15 dark:border-emerald-400/15">
                      <span className="text-2xs uppercase text-slate-600 dark:text-slate-400 block">CTL</span>
                      <strong className="text-[#0F766E] dark:text-[#2DD4BF]">
                        {eow ? Math.round(eow.ctl) : '—'}
                      </strong>
                    </div>
                    <div className="px-2 py-1 rounded-lg bg-white/80 dark:bg-ap-turf/60 border border-slate-200/70 dark:border-slate-800">
                      <span className="text-2xs uppercase text-slate-600 dark:text-slate-400 block">Form</span>
                      <strong className="text-emerald-600 dark:text-emerald-400">
                        {tsbVal !== null ? (tsbVal > 0 ? `+${tsbVal}` : tsbVal) : '—'}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Mobile Daily Cards */}
                <div className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
                  {activeDays.map((day) => {
                    const isToday = day.dateStr === todayIso;
                    const dayStripe = buildDayPlannedEffortStripe(
                      day.dateStr,
                      day.dayPlanned,
                      day.wellness,
                      day.dayActivities
                    );
                    const w = day.wellness;
                    const sleepH =
                      w && w.sleepSecs > 0 ? `${(w.sleepSecs / 3600).toFixed(1)}h` : null;

                    return (
                      <div
                        key={`mob-day-${day.dateStr}`}
                        className={`p-3 space-y-2 ${
                          isToday
                            ? 'bg-sky-500/[0.06] dark:bg-sky-500/[0.08]'
                            : !day.isCurrentMonth
                              ? 'bg-slate-100/70 dark:bg-slate-900/60'
                              : 'bg-white/75 dark:bg-ap-turf/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`text-xs font-bold font-mono ${
                                isToday
                                  ? 'px-2 py-0.5 rounded-md bg-ap-cobalt text-white dark:bg-ap-volt dark:text-ap-obsidian'
                                  : 'text-slate-900 dark:text-slate-100'
                              }`}
                            >
                              {formatHeaderDate(day.dateStr)}
                            </span>
                            {showCellWellness && w && (
                              <div className="flex items-center gap-2 text-2xs font-mono text-slate-600 dark:text-slate-300">
                                {sleepH && <span>{sleepH}</span>}
                                {w.restingHR > 0 && <span>{w.restingHR}bpm</span>}
                                {w.hrvRMSSD > 0 && (
                                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                    {Math.round(w.hrvRMSSD)}ms
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              handleOpenBuilderForDate(
                                day.dateStr,
                                dayStripe ? dayStripe.primaryEvent : null
                              )
                            }
                            className="min-h-[44px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>{dayStripe ? 'Edit' : 'Plan'}</span>
                          </button>
                        </div>

                        {/* Planned Effort Stripe (Compact strip only when day also has completed sessions; avoids double-render with planned card below) */}
                        {showDayEffortStripe && dayStripe && day.dayActivities.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              handleOpenBuilderForDate(day.dateStr, dayStripe.primaryEvent)
                            }
                            className="w-full text-left rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-ap-carbon/80 p-2 space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2 text-2xs">
                              <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">
                                {dayStripe.sportCategory === 'Running'
                                  ? 'Run'
                                  : dayStripe.sportCategory === 'Cycling'
                                    ? 'Bike'
                                    : dayStripe.sportCategory}{' '}
                                Rx: {dayStripe.workoutName}
                              </span>
                              <span
                                className={`font-mono font-bold shrink-0 ${dayStripe.dominantZone.inkClass}`}
                              >
                                {dayStripe.dominantZone.code} · {dayStripe.totalDurationMins}m
                              </span>
                            </div>
                            <div className="h-3 w-full flex items-end gap-[1px] rounded-xs bg-slate-200/50 dark:bg-slate-800/60 px-0.5 pt-0.5 overflow-hidden">
                              {dayStripe.steps.map((s, idx) => (
                                <div
                                  key={idx}
                                  style={{
                                    width: `${s.widthPct}%`,
                                    height: `${s.heightPct}%`,
                                    backgroundColor: s.color,
                                  }}
                                  className="rounded-t-[1px]"
                                />
                              ))}
                            </div>
                          </button>
                        )}

                        {/* Completed Activities */}
                        {day.dayActivities.map((act) => {
                          const effort = buildActivityEffortPresentation(
                            act,
                            athleteFtp,
                            athleteProfile
                          );
                          return (
                            <button
                              key={`mob-act-${act.id}`}
                              type="button"
                              onClick={() => onSelectActivity(act)}
                              className="w-full text-left cursor-pointer rounded-xl overflow-hidden border border-slate-300/90 dark:border-emerald-900/50 bg-white dark:bg-ap-turf shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ap-cobalt dark:focus-visible:ring-ap-volt"
                            >
                              <div
                                className={`px-2.5 py-1.5 flex items-center justify-between gap-2 ${getSportHeaderColor(
                                  act.sportCategory
                                )}`}
                              >
                                <div className="flex items-center gap-1.5 min-w-0 text-xs font-bold truncate">
                                  {getSportIcon(act.sportCategory, 'w-3.5 h-3.5 shrink-0')}
                                  <span className="truncate">{act.name}</span>
                                </div>
                                <span className="text-2xs font-mono font-extrabold shrink-0">
                                  {formatCompactDuration(act.movingTimeSecs)} · Load{' '}
                                  {act.trainingLoad}
                                </span>
                              </div>
                              <div className="p-2 flex items-center justify-between gap-3 text-2xs font-mono text-slate-700 dark:text-slate-200">
                                <span>
                                  {act.distanceMeters > 0
                                    ? formatDistance(act.distanceMeters, distanceUnit, 1)
                                    : act.subType}
                                </span>
                                <div className="flex items-center gap-2">
                                  {(act.normalizedPower || act.avgPower) && (
                                    <span className="font-bold text-blue-600 dark:text-sky-400">
                                      {act.normalizedPower || act.avgPower}W
                                    </span>
                                  )}
                                  {act.avgHr && (
                                    <span className="text-rose-600 dark:text-rose-400">
                                      {act.avgHr}bpm
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="px-2 pb-2">
                                <div className="h-3.5 w-full flex items-end gap-[1px] bg-slate-100 dark:bg-slate-900/70 rounded-xs overflow-hidden">
                                  {effort.slices.map((sl, sIdx) => (
                                    <div
                                      key={sIdx}
                                      style={{
                                        width: `${sl.widthPct}%`,
                                        height: `${sl.heightPct}%`,
                                        backgroundColor: sl.color,
                                      }}
                                    />
                                  ))}
                                </div>
                              </div>
                            </button>
                          );
                        })}

                        {/* Explicitly Scheduled Planned Events */}
                        {day.dayPlanned.map((ev) => {
                          const trackSpec =
                            ev.sportCategory === 'Running'
                              ? inferTrackWorkoutSpecFromPlannedEvent(ev)
                              : null;
                          return (
                            <div
                              key={`mob-plan-${ev.id}`}
                              className="rounded-xl border border-dashed border-ap-cobalt/45 dark:border-ap-volt/35 bg-ap-cobalt/[0.05] dark:bg-ap-volt/[0.04] p-2.5 flex flex-col gap-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100 line-clamp-2 leading-snug">
                                    {ev.name}
                                  </div>
                                  <div className="mt-0.5 text-2xs font-mono text-ap-cobalt dark:text-ap-volt font-semibold">
                                    Planned · {ev.sportCategory} ·{' '}
                                    {formatCompactDuration(ev.plannedDurationSecs)} · ~{ev.plannedLoad}{' '}
                                    TSS
                                  </div>
                                  {formatSessionLogisticsLine(ev) && (
                                    <div className="mt-0.5 text-2xs font-mono text-slate-600 dark:text-slate-300 inline-flex items-center gap-1 truncate">
                                      <Clock className="w-3 h-3 shrink-0" />
                                      <span className="truncate">{formatSessionLogisticsLine(ev)}</span>
                                    </div>
                                  )}
                                </div>
                                {pendingDeletePlannedId === ev.id ? (
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void onDeletePlannedEvent?.(ev.id);
                                        setPendingDeletePlannedId(null);
                                      }}
                                      className="min-h-[44px] sm:min-h-[36px] px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-2xs font-bold"
                                    >
                                      Delete
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setPendingDeletePlannedId(null)}
                                      className="min-h-[44px] sm:min-h-[36px] px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-2xs font-semibold"
                                    >
                                      Keep
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setPendingDeletePlannedId(ev.id)}
                                    aria-label={`Delete planned workout ${ev.name}`}
                                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-rose-700/75 dark:text-rose-300/75 hover:text-rose-600 dark:hover:text-rose-300 hover:bg-rose-500/10"
                                    title="Delete planned workout"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                              {(trackSpec || Boolean(ev.workoutSyntax)) && (
                                <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-emerald-900/10 dark:border-white/10">
                                  {trackSpec && (
                                    <button
                                      type="button"
                                      data-testid="calendar-launch-stopwatch"
                                      onClick={() => handleLaunchPlannedInStopwatch(ev)}
                                      className="min-h-[44px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-ap-cobalt hover:bg-[#16422A] dark:bg-ap-volt dark:hover:bg-[#B5EB00] text-white dark:text-ap-obsidian text-2xs font-mono font-bold transition-colors cursor-pointer"
                                    >
                                      <Timer className="w-3.5 h-3.5" weight="bold" />
                                      <span>Time on Track</span>
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    data-testid="calendar-edit-planned-workout"
                                    onClick={() => handleOpenBuilderForDate(ev.date.slice(0, 10), ev)}
                                    className="min-h-[44px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-carbon text-slate-800 dark:text-slate-200 text-2xs font-mono font-semibold hover:border-ap-cobalt transition-colors cursor-pointer"
                                  >
                                    <span>Edit</span>
                                  </button>
                                  <details className="relative inline-block">
                                    <summary className="min-h-[44px] list-none inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-carbon text-slate-800 dark:text-slate-200 text-2xs font-mono font-semibold hover:border-ap-cobalt transition-colors cursor-pointer select-none">
                                      <Download className="w-3.5 h-3.5" weight="bold" />
                                      <span>Export ▾</span>
                                    </summary>
                                    <div className="absolute right-0 bottom-full mb-1 z-30 w-36 rounded-xl liquid-glass p-1 space-y-1 shadow-xl border border-emerald-900/15 dark:border-white/15">
                                      {ev.workoutSyntax && (
                                        <button
                                          type="button"
                                          data-testid="calendar-export-fit"
                                          onClick={() => handleExportPlannedFit(ev)}
                                          className="w-full min-h-[44px] flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-left text-2xs font-mono font-semibold text-ap-ink dark:text-ap-chalk hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                                        >
                                          <Download className="w-3.5 h-3.5" weight="bold" />
                                          <span>.FIT</span>
                                        </button>
                                      )}
                                      {ev.workoutSyntax && (
                                        <button
                                          type="button"
                                          data-testid="calendar-export-zwo"
                                          onClick={() => handleExportPlannedZwo(ev)}
                                          className="w-full min-h-[44px] flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-left text-2xs font-mono font-semibold text-ap-ink dark:text-ap-chalk hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                                        >
                                          <Download className="w-3.5 h-3.5" weight="bold" />
                                          <span>.ZWO</span>
                                        </button>
                                      )}
                                      {ev.workoutSyntax && ev.sportCategory === 'Cycling' && (
                                        <button
                                          type="button"
                                          data-testid="calendar-export-erg"
                                          onClick={() => handleExportPlannedErg(ev)}
                                          className="w-full min-h-[44px] flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-left text-2xs font-mono font-semibold text-ap-ink dark:text-ap-chalk hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                                        >
                                          <Download className="w-3.5 h-3.5" weight="bold" />
                                          <span>.ERG</span>
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        data-testid="calendar-share-workout"
                                        onClick={() => handleSharePlannedWorkout(ev)}
                                        className="w-full min-h-[44px] flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-left text-2xs font-mono font-semibold text-ap-ink dark:text-ap-chalk hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                                      >
                                        <ShareNetwork className="w-3.5 h-3.5" weight="bold" />
                                        <span>Share</span>
                                      </button>
                                    </div>
                                  </details>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
    </section>
  );
};
