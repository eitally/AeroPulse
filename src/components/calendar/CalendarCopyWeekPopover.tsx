import React, { useState } from 'react';
import { Copy, X } from '../icons/PhosphorIcons';
import {
  normalizeToMondayIso,
  resolveDefaultCopyTargetMondayIso,
  shiftIsoDate,
} from './calendarDragAndWeekCopyUtils';

export interface CalendarCopyWeekPopoverProps {
  isoWeekNum: number;
  sourceMondayIso: string;
  plannedCount: number;
  onConfirmCopy: (targetMondayIso: string) => Promise<void> | void;
  onClose: () => void;
}

export const CalendarCopyWeekPopover: React.FC<CalendarCopyWeekPopoverProps> = ({
  isoWeekNum,
  sourceMondayIso,
  plannedCount,
  onConfirmCopy,
  onClose,
}) => {
  const defaultNextMonday = resolveDefaultCopyTargetMondayIso(sourceMondayIso);
  const [targetMondayIso, setTargetMondayIso] = useState<string>(defaultNextMonday);
  const [copying, setCopying] = useState<boolean>(false);

  const normalizedTarget = normalizeToMondayIso(targetMondayIso);
  const targetSunday = shiftIsoDate(normalizedTarget, 6);
  const isSameWeek = normalizedTarget === normalizeToMondayIso(sourceMondayIso);

  const handleConfirm = async () => {
    if (plannedCount === 0 || isSameWeek || copying) return;
    setCopying(true);
    try {
      await onConfirmCopy(normalizedTarget);
      onClose();
    } finally {
      setCopying(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label={`Copy Week ${isoWeekNum} planned sessions`}
      data-testid={`copy-week-popover-w${isoWeekNum}`}
      className="rounded-xl border border-ap-frame/20 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon p-3 shadow-xl space-y-2.5 text-xs text-ap-ink dark:text-ap-chalk"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold inline-flex items-center gap-1.5">
          <Copy className="w-3.5 h-3.5 ap-text-brand shrink-0" />
          <span>Copy W{isoWeekNum} ({plannedCount})</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close copy week popover"
          className="min-h-[32px] min-w-[32px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {plannedCount === 0 ? (
        <p className="text-2xs text-ap-muted dark:text-ap-muted-dark">
          No planned workouts in W{isoWeekNum} to copy.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              data-testid="copy-week-next-preset"
              onClick={() => setTargetMondayIso(defaultNextMonday)}
              className={`min-h-[34px] px-2.5 py-1 rounded-lg text-2xs font-semibold cursor-pointer border ${
                normalizedTarget === defaultNextMonday
                  ? 'bg-ap-clay text-white border-ap-clay dark:bg-ap-volt dark:text-ap-obsidian dark:border-ap-volt'
                  : 'ap-card-inset border-slate-300 dark:border-ap-edge-dark'
              }`}
            >
              Next Week (+7d)
            </button>
            <button
              type="button"
              data-testid="copy-week-two-weeks-preset"
              onClick={() => setTargetMondayIso(shiftIsoDate(sourceMondayIso, 14))}
              className={`min-h-[34px] px-2.5 py-1 rounded-lg text-2xs font-semibold cursor-pointer border ${
                normalizedTarget === shiftIsoDate(sourceMondayIso, 14)
                  ? 'bg-ap-clay text-white border-ap-clay dark:bg-ap-volt dark:text-ap-obsidian dark:border-ap-volt'
                  : 'ap-card-inset border-slate-300 dark:border-ap-edge-dark'
              }`}
            >
              +2 Weeks
            </button>
          </div>

          <div className="space-y-1">
            <label className="block text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
              Target Week (Monday)
            </label>
            <input
              type="date"
              data-testid="copy-week-target-date"
              aria-label="Target week Monday date"
              value={normalizedTarget}
              onChange={(e) => {
                if (e.target.value) {
                  setTargetMondayIso(normalizeToMondayIso(e.target.value));
                }
              }}
              className="w-full min-h-[36px] rounded-lg border border-slate-300 dark:border-ap-edge-dark bg-ap-surface-warm dark:bg-ap-turf px-2 text-2xs font-mono text-ap-ink dark:text-ap-chalk"
            />
            <div className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
              Target: {normalizedTarget} → {targetSunday}
            </div>
            {isSameWeek && (
              <div className="text-2xs font-semibold text-rose-700 dark:text-rose-300">
                Choose a different target week.
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[34px] px-2.5 py-1 rounded-lg ap-btn-secondary text-2xs font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="copy-week-confirm-btn"
              disabled={isSameWeek || copying}
              onClick={() => void handleConfirm()}
              className="min-h-[34px] px-3 py-1 rounded-lg ap-btn-primary text-2xs font-bold cursor-pointer disabled:opacity-50"
            >
              {copying ? 'Copying…' : `Copy ${plannedCount} Session${plannedCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
};
