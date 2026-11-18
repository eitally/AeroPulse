import { formatPracticeTime12h, sanitizeScheduledTime } from './workoutScheduleUtils';

export interface BedtimeReminderPrefs {
  enabled: boolean;
  timeHhMm: string; // e.g. '21:15'
  lastTriggeredDate?: string;
}

const STORAGE_KEY = 'thresh_bedtime_reminder_v1';

export function loadBedtimeReminderPrefs(): BedtimeReminderPrefs {
  if (typeof localStorage === 'undefined') {
    return { enabled: false, timeHhMm: '21:15' };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { enabled: false, timeHhMm: '21:15' };
    const parsed = JSON.parse(raw);
    return {
      enabled: Boolean(parsed?.enabled),
      timeHhMm: sanitizeScheduledTime(parsed?.timeHhMm) || '21:15',
      ...(typeof parsed?.lastTriggeredDate === 'string'
        ? { lastTriggeredDate: parsed.lastTriggeredDate.slice(0, 10) }
        : {}),
    };
  } catch {
    return { enabled: false, timeHhMm: '21:15' };
  }
}

export function saveBedtimeReminderPrefs(
  prefs: BedtimeReminderPrefs
): BedtimeReminderPrefs {
  const clean: BedtimeReminderPrefs = {
    enabled: Boolean(prefs.enabled),
    timeHhMm: sanitizeScheduledTime(prefs.timeHhMm) || '21:15',
    ...(prefs.lastTriggeredDate
      ? { lastTriggeredDate: prefs.lastTriggeredDate.slice(0, 10) }
      : {}),
  };
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch {
      // ignore storage quota errors
    }
  }
  return clean;
}

export type BedtimePermissionState =
  | 'granted'
  | 'denied'
  | 'default'
  | 'unsupported';

export function getBedtimeNotificationPermission(): BedtimePermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return window.Notification.permission;
}

export async function requestBedtimeNotificationPermission(): Promise<BedtimePermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  if (window.Notification.permission === 'granted') return 'granted';
  try {
    const res = await window.Notification.requestPermission();
    return res;
  } catch {
    return window.Notification.permission || 'denied';
  }
}

export function isPastReminderTime(
  timeHhMm: string,
  now: Date = new Date()
): boolean {
  const clean = sanitizeScheduledTime(timeHhMm) || '21:15';
  const [hh, mm] = clean.split(':').map(Number);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  return nowMins >= hh * 60 + mm;
}

export function checkAndFireBedtimeReminder(params: {
  prefs: BedtimeReminderPrefs;
  todayIso: string;
  hasLoggedToday: boolean;
  tomorrowSummary?: string;
  now?: Date;
}): boolean {
  if (!params.prefs.enabled || params.hasLoggedToday) return false;
  if (params.prefs.lastTriggeredDate === params.todayIso) return false;
  const now = params.now || new Date();
  if (!isPastReminderTime(params.prefs.timeHhMm, now)) return false;
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (window.Notification.permission !== 'granted') return false;

  try {
    new window.Notification('THRESH Bedtime Closeout (15s)', {
      body: params.tomorrowSummary
        ? `Tap your RPE + lock in tomorrow: ${params.tomorrowSummary}`
        : 'Log today’s effort + sleep target before lights out.',
      tag: `thresh-bedtime-${params.todayIso}`,
    });
    saveBedtimeReminderPrefs({
      ...params.prefs,
      lastTriggeredDate: params.todayIso,
    });
    return true;
  } catch {
    return false;
  }
}

export function buildBedtimeReminderIcs(timeHhMm: string): string {
  const clean = sanitizeScheduledTime(timeHhMm) || '21:15';
  const [hh, mm] = clean.split(':');
  const todayCompact = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const label = formatPracticeTime12h(clean) || '9:15 PM';
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//THRESH//Bedtime Closeout Reminder//EN',
    'BEGIN:VEVENT',
    `UID:thresh-bedtime-closeout@thresh.app`,
    `DTSTAMP:${todayCompact}T000000Z`,
    `DTSTART:${todayCompact}T${hh}${mm}00`,
    'DURATION:PT5M',
    'RRULE:FREQ=DAILY',
    `SUMMARY:THRESH 15s Bedtime Closeout (${label})`,
    'DESCRIPTION:Tap effort RPE, flag tightness, and confirm tomorrow workout time & location.',
    'BEGIN:VALARM',
    'TRIGGER:-PT0M',
    'ACTION:DISPLAY',
    'DESCRIPTION:THRESH Bedtime Closeout',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export function downloadBedtimeReminderIcs(timeHhMm: string): void {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return;
  const ics = buildBedtimeReminderIcs(timeHhMm);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'thresh-bedtime-closeout-reminder.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
