import React from 'react';
import { createPortal } from 'react-dom';
import type { SportCategory } from '../../types';
import type { HoveredPrescriptionTooltipData } from './calendarEffortUtils';

export interface CalendarPlannedTooltipProps {
  hoveredPrescription: HoveredPrescriptionTooltipData | null;
  getSportIcon: (sport: SportCategory, className?: string) => React.ReactNode;
}

export const CalendarPlannedTooltip: React.FC<CalendarPlannedTooltipProps> = ({
  hoveredPrescription,
  getSportIcon,
}) => {
  return (
    <>
      {hoveredPrescription &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: 'fixed',
              top: `${hoveredPrescription.top}px`,
              left: `${hoveredPrescription.left}px`,
              width: `${hoveredPrescription.width}px`,
              zIndex: 9999,
            }}
            className="pointer-events-none rounded-2xl liquid-glass p-3.5 shadow-2xl border border-slate-300/90 dark:border-slate-700/90 text-xs space-y-2.5 animate-in fade-in duration-100"
          >
            {/* Header: Sport Badge (Cycling vs. Running) + Date */}
            <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-800/80 pb-2">
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-2xs font-mono font-bold uppercase tracking-wider ${
                  hoveredPrescription.stripe.sportCategory === 'Running'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/35'
                    : hoveredPrescription.stripe.sportCategory === 'Cycling'
                      ? 'bg-blue-500/15 text-blue-700 dark:text-sky-300 border border-blue-500/35'
                      : 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border border-teal-500/35'
                }`}
              >
                {getSportIcon(hoveredPrescription.stripe.sportCategory, 'w-3 h-3')}
                <span>
                  {hoveredPrescription.stripe.sportCategory}{' '}
                  {hoveredPrescription.stripe.source === 'SCHEDULED'
                    ? 'Scheduled Workout'
                    : 'Prescription'}
                </span>
              </span>
              <span className="text-2xs font-mono text-slate-500 dark:text-slate-400">
                {hoveredPrescription.dateStr}
              </span>
            </div>

            {/* Workout Title, Duration, Target Load & Dominant Zone */}
            <div>
              <div className="font-bold text-slate-900 dark:text-white text-sm leading-snug">
                {hoveredPrescription.stripe.workoutName}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-2xs font-mono">
                <span className="text-slate-700 dark:text-slate-200 font-semibold">
                  {hoveredPrescription.stripe.totalDurationMins} min
                </span>
                <span className="text-slate-600 dark:text-slate-400">·</span>
                <span className="text-blue-600 dark:text-sky-400 font-semibold">
                  ~{hoveredPrescription.stripe.plannedLoad} TSS
                </span>
                <span className="text-slate-600 dark:text-slate-400">·</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-2xs font-bold bg-white/85 dark:bg-[#0B110E]/80 border border-slate-300/70 dark:border-white/15 ${hoveredPrescription.stripe.dominantZone.inkClass}`}
                >
                  {hoveredPrescription.stripe.dominantZone.code}{' '}
                  {hoveredPrescription.stripe.dominantZone.name}
                </span>
              </div>
            </div>

            {/* Plain-English Prescription Description */}
            <p className="text-2xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {hoveredPrescription.stripe.description}
            </p>

            {/* Dimensional Skyline with Y-Axis (% FTP or % Threshold Pace) */}
            <div className="rounded-lg bg-slate-100/90 dark:bg-slate-900/90 p-2 border border-slate-200/70 dark:border-slate-800/70 space-y-1.5">
              <div className="flex items-center justify-between text-2xs font-mono text-slate-500 dark:text-slate-400">
                <span>
                  Y-Axis Amplitude:{' '}
                  {hoveredPrescription.stripe.sportCategory === 'Running'
                    ? '% Threshold Pace'
                    : hoveredPrescription.stripe.sportCategory === 'Cycling'
                      ? '% FTP'
                      : '% Effort'}
                </span>
                <span>Click stripe to edit</span>
              </div>
              <div className="relative h-8 w-full flex items-stretch">
                <div className="w-7 shrink-0 border-r border-slate-300/70 dark:border-slate-700/70 flex flex-col justify-between items-end pr-1 text-2xs font-mono text-slate-600 dark:text-slate-400">
                  <span>100%</span>
                  <span>50%</span>
                </div>
                <div className="relative flex-1 flex items-end gap-[1px] pl-1">
                  <div
                    className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-slate-400/50"
                    style={{ bottom: '74%' }}
                  />
                  {hoveredPrescription.stripe.steps.map((st, idx) => (
                    <div
                      key={idx}
                      style={{
                        width: `${st.widthPct}%`,
                        height: `${st.heightPct}%`,
                        backgroundColor: st.color,
                      }}
                      className="rounded-t-[2px]"
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Step-by-Step Intervals Breakdown */}
            <div className="space-y-1 pt-0.5">
              <div className="text-2xs font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400 font-semibold">
                Prescribed Structure ({hoveredPrescription.stripe.steps.length} steps)
              </div>
              <div className="space-y-0.5 max-h-28 overflow-hidden">
                {hoveredPrescription.stripe.steps.slice(0, 6).map((st, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2 text-2xs font-mono"
                  >
                    <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200 truncate">
                      <span
                        className="w-2 h-2 rounded-xs shrink-0"
                        style={{ backgroundColor: st.color }}
                      />
                      <span className="truncate">{st.label}</span>
                    </span>
                    <span className="text-slate-500 dark:text-slate-400 shrink-0">
                      {st.durationMins}m · {st.intensityPct}% ({st.zoneCode})
                    </span>
                  </div>
                ))}
                {hoveredPrescription.stripe.steps.length > 6 && (
                  <div className="text-2xs font-mono text-slate-600 dark:text-slate-400 italic">
                    +{hoveredPrescription.stripe.steps.length - 6} more interval steps…
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
