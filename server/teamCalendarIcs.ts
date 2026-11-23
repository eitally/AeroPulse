import { formatPracticeTime12h } from '../src/utils/workoutScheduleUtils.ts';
import { isSafeHttpsUrl } from './securityUtils.ts';

export interface TimedTeamCalendarEventInput {
  uid: string;
  title: string;
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  locationName?: string;
  description?: string;
  busDepartureTime?: string;
  meetDelayMinutes?: number;
  liveResultsUrl?: string;
  updatedAt?: string;
  sequence?: number;
}

export function normalizeIcsTimezone(tz?: string): string {
  const clean = String(tz || '').trim();
  if (clean && /^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+$/.test(clean) && clean.length <= 64) {
    return clean;
  }
  return 'America/Los_Angeles';
}

export function escapeIcsText(raw?: string): string {
  return String(raw || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .trim();
}

export function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [line.slice(0, 75)];
  let idx = 75;
  while (idx < line.length) {
    chunks.push(` ${line.slice(idx, idx + 74)}`);
    idx += 74;
  }
  return chunks.join('\r\n');
}

export function formatIcsUtcTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function nextIcsDateYmd(isoDate: string): string {
  const parsed = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate.slice(0, 10).replace(/-/g, '');
  }
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10).replace(/-/g, '');
}

function parseHmTime(raw?: string): { hour: number; minute: number } | null {
  const clean = String(raw || '').trim();
  if (!clean) return null;
  const match24 = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const h = Number(match24[1]);
    const m = Number(match24[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return { hour: h, minute: m };
  }
  const match12 = clean.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (match12) {
    let h = Number(match12[1]);
    const m = Number(match12[2]);
    const ap = match12[3].toLowerCase();
    if (h < 1 || h > 12 || m < 0 || m > 59) return null;
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return { hour: h, minute: m };
  }
  return null;
}

function formatIcsLocalDateTime(
  dateIso: string,
  hour: number,
  minute: number,
  addMinutes = 0
): string {
  const [y, mo, d] = dateIso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y || 2026, (mo || 1) - 1, d || 1, hour, minute + addMinutes, 0));
  const yy = String(dt.getUTCFullYear()).padStart(4, '0');
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  const hh = String(dt.getUTCHours()).padStart(2, '0');
  const mi = String(dt.getUTCMinutes()).padStart(2, '0');
  return `${yy}${mm}${dd}T${hh}${mi}00`;
}

function resolveSequence(ev: TimedTeamCalendarEventInput): number {
  if (typeof ev.sequence === 'number' && Number.isFinite(ev.sequence) && ev.sequence >= 0) {
    return Math.min(2000000000, Math.round(ev.sequence));
  }
  if (ev.updatedAt) {
    const ms = Date.parse(ev.updatedAt);
    if (Number.isFinite(ms)) {
      return Math.max(1, Math.min(2000000000, Math.floor((ms - 1700000000000) / 1000)));
    }
  }
  return ev.meetDelayMinutes && ev.meetDelayMinutes > 0 ? 1 : 0;
}

export function buildTimedTeamCalendarIcs(params: {
  teamName: string;
  shortName: string;
  slug?: string;
  timezone?: string;
  originUrl?: string;
  calNameSuffix?: string;
  prodId?: string;
  events: TimedTeamCalendarEventInput[];
}): string {
  const tz = normalizeIcsTimezone(params.timezone);
  const dtStamp = formatIcsUtcTimestamp(new Date());
  const cleanOrigin = (params.originUrl || 'https://meetready.app').replace(/\/+$/, '');
  const safeSlug = params.slug ? params.slug.replace(/[^a-zA-Z0-9_-]/g, '') : '';
  const hubUrl = safeSlug ? `${cleanOrigin}/team/${safeSlug}` : '';
  const calTitle = `${params.teamName} ${params.calNameSuffix || 'Schedule'}`.trim();

  const seenIds = new Set<string>();
  const uniqueEvents = (params.events || [])
    .filter((ev) => {
      if (!ev?.uid || !/^\d{4}-\d{2}-\d{2}$/.test((ev.date || '').slice(0, 10))) return false;
      if (seenIds.has(ev.uid)) return false;
      seenIds.add(ev.uid);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${params.prodId || '-//MeetReady//Team Calendar//EN'}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calTitle)}`,
    `X-WR-TIMEZONE:${tz}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];

  for (const ev of uniqueEvents) {
    const cleanDate = ev.date.slice(0, 10);
    const uidSafe = String(ev.uid).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
    const startHm = parseHmTime(ev.startTime);
    const endHm = parseHmTime(ev.endTime);
    const parsedUpdatedMs = ev.updatedAt ? Date.parse(ev.updatedAt) : Number.NaN;
    const lastMod = Number.isFinite(parsedUpdatedMs)
      ? formatIcsUtcTimestamp(new Date(parsedUpdatedMs))
      : dtStamp;
    const sequence = resolveSequence(ev);
    const safeLiveUrl =
      ev.liveResultsUrl && isSafeHttpsUrl(ev.liveResultsUrl.trim())
        ? ev.liveResultsUrl.trim()
        : '';
    const eventUrl = safeLiveUrl || hubUrl;

    const delayLabel =
      typeof ev.meetDelayMinutes === 'number' && ev.meetDelayMinutes > 0
        ? `Delay: +${Math.round(ev.meetDelayMinutes)}m`
        : '';
    const busLabel = ev.busDepartureTime
      ? `Bus departure: ${formatPracticeTime12h(ev.busDepartureTime)}`
      : '';
    const descParts = [
      ev.startTime ? `Start: ${formatPracticeTime12h(ev.startTime)}` : '',
      delayLabel,
      busLabel,
      ev.description || '',
      safeLiveUrl ? `Live Results: ${safeLiveUrl}` : '',
      hubUrl ? `Team Hub: ${hubUrl}` : '',
    ].filter(Boolean);

    let dtStartLine: string;
    let dtEndLine: string;
    if (startHm) {
      dtStartLine = `DTSTART;TZID=${tz}:${formatIcsLocalDateTime(cleanDate, startHm.hour, startHm.minute)}`;
      dtEndLine = endHm
        ? `DTEND;TZID=${tz}:${formatIcsLocalDateTime(cleanDate, endHm.hour, endHm.minute)}`
        : `DTEND;TZID=${tz}:${formatIcsLocalDateTime(cleanDate, startHm.hour, startHm.minute, 90)}`;
    } else {
      dtStartLine = `DTSTART;VALUE=DATE:${cleanDate.replace(/-/g, '')}`;
      dtEndLine = `DTEND;VALUE=DATE:${nextIcsDateYmd(cleanDate)}`;
    }

    lines.push(
      'BEGIN:VEVENT',
      `UID:meetready-${uidSafe}@meetready.app`,
      `DTSTAMP:${dtStamp}`,
      `LAST-MODIFIED:${lastMod}`,
      `SEQUENCE:${sequence}`,
      dtStartLine,
      dtEndLine,
      `SUMMARY:${escapeIcsText(`${params.shortName} · ${ev.title}`)}`,
      ...(ev.locationName ? [`LOCATION:${escapeIcsText(ev.locationName)}`] : []),
      ...(eventUrl ? [`URL:${eventUrl}`] : []),
      ...(descParts.length > 0 ? [`DESCRIPTION:${escapeIcsText(descParts.join(' · '))}`] : []),
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}
