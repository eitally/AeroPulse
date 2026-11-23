import React from 'react';
import { Send } from '../icons/PhosphorIcons';
import {
  type WearablePushTarget,
  type WorkoutExportOptions,
  pushWorkoutToWearable,
} from '../../utils/workoutExportActions';

export interface CalendarWatchPushItemsProps {
  options: WorkoutExportOptions;
  onPushResult?: (message: string, pushed: boolean) => void;
  onAfterClick?: () => void;
  itemClassName?: string;
  testIdPrefix?: string;
}

const WATCH_TARGETS: Array<{
  target: WearablePushTarget;
  label: string;
  title: string;
}> = [
  {
    target: 'garmin',
    label: 'Garmin Partner',
    title: 'Push via Official Garmin Training API v2 (Partner OAuth)',
  },
  {
    target: 'wahoo',
    label: 'Wahoo ELEMNT',
    title: 'Push structured workout directly to Wahoo Cloud / ELEMNT',
  },
  {
    target: 'coros',
    label: 'COROS Watch',
    title: 'Push directly to your COROS Training Calendar',
  },
  {
    target: 'intervals',
    label: 'Intervals Bridge',
    title: 'Push via Intervals.icu CALENDAR:WRITE (Garmin / COROS / Suunto / Wahoo)',
  },
];

/**
 * Shared 1-click watch push menu buttons for Calendar planned workouts and Coach Clipboard.
 */
export const CalendarWatchPushItems: React.FC<CalendarWatchPushItemsProps> = ({
  options,
  onPushResult,
  onAfterClick,
  itemClassName = 'w-full min-h-[34px] flex items-center gap-1.5 px-2 py-1 rounded-lg text-left text-2xs font-mono font-semibold text-ap-ink dark:text-ap-chalk hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer',
  testIdPrefix = 'calendar-push',
}) => {
  const handlePush = async (target: WearablePushTarget) => {
    onAfterClick?.();
    const res = await pushWorkoutToWearable(target, options);
    onPushResult?.(res.message, res.pushed);
  };

  return (
    <>
      {WATCH_TARGETS.map((item) => (
        <button
          key={item.target}
          type="button"
          data-testid={`${testIdPrefix}-${item.target}`}
          onClick={() => void handlePush(item.target)}
          className={itemClassName}
          title={item.title}
        >
          <Send className="w-3 h-3 shrink-0" weight="bold" />
          <span>{item.label}</span>
        </button>
      ))}
    </>
  );
};
