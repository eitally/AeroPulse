import type { PlannedEventBatchItem } from '../GoalsView';
import type { PlannedWorkoutEvent } from '../../types';
import type { PlannedEventMutationPayload } from '../../contexts/TelemetryWorkspaceContext';

export const CALENDAR_DRAG_MIME = 'application/x-meetready-plan-id';

export function shiftIsoDate(dateIso: string, deltaDays: number): string {
  const clean = String(dateIso || '').slice(0, 10);
  const [y, m, d] = clean.split('-').map(Number);
  if (!y || !m || !d) return clean;
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function normalizeToMondayIso(dateIso: string): string {
  const clean = String(dateIso || '').slice(0, 10);
  const [y, m, d] = clean.split('-').map(Number);
  if (!y || !m || !d) return clean;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = dt.getUTCDay(); // 0 = Sun, 1 = Mon, ...
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  return shiftIsoDate(clean, diffToMonday);
}

export function resolveDefaultCopyTargetMondayIso(sourceWeekMondayIso: string): string {
  return shiftIsoDate(normalizeToMondayIso(sourceWeekMondayIso), 7);
}

export function buildReschedulePlannedEventPatch(
  ev: PlannedWorkoutEvent,
  targetDateIso: string
): PlannedEventMutationPayload {
  return {
    date: targetDateIso.slice(0, 10),
    name: ev.name,
    sportCategory: ev.sportCategory,
    environmentPreference: ev.environmentPreference,
    plannedDurationSecs: ev.plannedDurationSecs,
    plannedLoad: ev.plannedLoad,
    workoutSyntax: ev.workoutSyntax || '',
    description: ev.description || '',
    ...(ev.scheduledTime ? { scheduledTime: ev.scheduledTime } : {}),
    ...(ev.sessionSlot ? { sessionSlot: ev.sessionSlot } : {}),
    ...(ev.locationName ? { locationName: ev.locationName } : {}),
    ...(ev.locationCategory ? { locationCategory: ev.locationCategory } : {}),
    ...(ev.meetingNotes ? { meetingNotes: ev.meetingNotes } : {}),
    ...(ev.trackSpec ? { trackSpec: ev.trackSpec } : {}),
  };
}

export interface WeekDayPlannedSlice {
  dateStr: string;
  dayPlanned: PlannedWorkoutEvent[];
}

export function buildCopiedWeekBatchItems(
  weekDays: WeekDayPlannedSlice[],
  targetMondayIso: string
): PlannedEventBatchItem[] {
  const normalizedTargetMonday = normalizeToMondayIso(targetMondayIso);
  const items: PlannedEventBatchItem[] = [];

  for (let dayIdx = 0; dayIdx < weekDays.length; dayIdx += 1) {
    const day = weekDays[dayIdx];
    if (!day || !Array.isArray(day.dayPlanned) || day.dayPlanned.length === 0) continue;
    const targetDate = shiftIsoDate(normalizedTargetMonday, dayIdx);

    for (const ev of day.dayPlanned) {
      items.push({
        date: targetDate,
        name: ev.name,
        sportCategory: ev.sportCategory,
        environmentPreference: ev.environmentPreference,
        plannedDurationSecs: ev.plannedDurationSecs,
        plannedLoad: ev.plannedLoad,
        workoutSyntax: ev.workoutSyntax || '',
        description: ev.description || '',
        ...(ev.scheduledTime ? { scheduledTime: ev.scheduledTime } : {}),
        ...(ev.sessionSlot ? { sessionSlot: ev.sessionSlot } : {}),
        ...(ev.locationName ? { locationName: ev.locationName } : {}),
        ...(ev.locationCategory ? { locationCategory: ev.locationCategory } : {}),
        ...(ev.meetingNotes ? { meetingNotes: ev.meetingNotes } : {}),
        ...(ev.trackSpec ? { trackSpec: ev.trackSpec } : {}),
        replaceExistingDate: false,
      });
    }
  }

  return items;
}

export function setCalendarDragPayload(
  dataTransfer: DataTransfer | null | undefined,
  eventId: string
): void {
  if (!dataTransfer || !eventId) return;
  try {
    dataTransfer.effectAllowed = 'move';
    dataTransfer.setData(CALENDAR_DRAG_MIME, eventId);
    dataTransfer.setData('text/plain', eventId);
  } catch {
    // ignore synthetic DataTransfer restrictions
  }
}

export function getCalendarDragPayload(
  dataTransfer: DataTransfer | null | undefined
): string {
  if (!dataTransfer) return '';
  try {
    return (
      dataTransfer.getData(CALENDAR_DRAG_MIME) ||
      dataTransfer.getData('text/plain') ||
      ''
    ).trim();
  } catch {
    return '';
  }
}
