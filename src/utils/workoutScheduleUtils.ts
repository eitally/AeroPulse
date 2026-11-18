import type {
  PracticeVenueCategory,
  WorkoutSessionSlot,
} from '../types';

export interface SavedPracticeVenue {
  name: string;
  category: PracticeVenueCategory;
  defaultTime?: string;
}

export const DEFAULT_PRACTICE_VENUE_PRESETS: SavedPracticeVenue[] = [
  { name: 'School Track', category: 'TRACK', defaultTime: '15:45' },
  { name: 'XC Park / Trail', category: 'XC_COURSE', defaultTime: '15:45' },
  { name: 'Campus / Road Loop', category: 'ROAD_CAMPUS', defaultTime: '15:45' },
  { name: 'Weight Room', category: 'GYM_WEIGHTS', defaultTime: '06:45' },
];

const VENUE_CATEGORY_LABELS: Record<PracticeVenueCategory, string> = {
  TRACK: 'Track',
  XC_COURSE: 'XC Course',
  ROAD_CAMPUS: 'Road / Campus',
  GYM_WEIGHTS: 'Weight Room',
  POOL_CROSS: 'Pool / Cross',
  OTHER: 'Practice Venue',
};

export function getVenueCategoryLabel(category?: PracticeVenueCategory): string {
  if (!category) return 'Practice Venue';
  return VENUE_CATEGORY_LABELS[category] || 'Practice Venue';
}

export function sanitizeScheduledTime(raw?: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  const m = trimmed.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return undefined;
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
}

export function sanitizeSessionSlot(raw?: unknown): WorkoutSessionSlot | undefined {
  if (raw === 'AM' || raw === 'PM' || raw === 'SINGLE') return raw;
  return undefined;
}

export function sanitizePracticeVenueCategory(
  raw?: unknown
): PracticeVenueCategory | undefined {
  if (
    raw === 'TRACK' ||
    raw === 'XC_COURSE' ||
    raw === 'ROAD_CAMPUS' ||
    raw === 'GYM_WEIGHTS' ||
    raw === 'POOL_CROSS' ||
    raw === 'OTHER'
  ) {
    return raw;
  }
  return undefined;
}

export function formatPracticeTime12h(hhmm?: string): string | null {
  const clean = sanitizeScheduledTime(hhmm);
  if (!clean) return null;
  const [hh, mm] = clean.split(':').map(Number);
  const period = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${period}`;
}

export function formatSessionLogisticsLine(ev: {
  sessionSlot?: WorkoutSessionSlot;
  scheduledTime?: string;
  locationName?: string;
}): string | null {
  const slotPrefix =
    ev.sessionSlot && ev.sessionSlot !== 'SINGLE' ? ev.sessionSlot : null;
  const time12h = formatPracticeTime12h(ev.scheduledTime);
  const loc = ev.locationName?.trim() ? ev.locationName.trim() : null;
  const parts = [slotPrefix, time12h, loc].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function inferEventSortMinutes(ev: {
  scheduledTime?: string;
  sessionSlot?: WorkoutSessionSlot;
}): number {
  const clean = sanitizeScheduledTime(ev.scheduledTime);
  if (clean) {
    const [h, m] = clean.split(':').map(Number);
    return h * 60 + m;
  }
  if (ev.sessionSlot === 'AM') return 7 * 60;
  if (ev.sessionSlot === 'PM') return 15 * 60 + 45;
  return 12 * 60;
}

export function sortPlannedEventsChronologically<
  T extends {
    date: string;
    sessionSlot?: WorkoutSessionSlot;
    scheduledTime?: string;
  },
>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    const da = (a.date || '').slice(0, 10);
    const db = (b.date || '').slice(0, 10);
    if (da !== db) return da.localeCompare(db);
    return inferEventSortMinutes(a) - inferEventSortMinutes(b);
  });
}

function teamVenuesStorageKey(teamId?: string | null): string {
  return `thresh_saved_venues_v1:${teamId || 'personal'}`;
}

export function loadSavedTeamLocations(teamId?: string | null): SavedPracticeVenue[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(teamVenuesStorageKey(teamId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (v): v is SavedPracticeVenue =>
          Boolean(v && typeof v.name === 'string' && v.name.trim().length > 0)
      )
      .slice(0, 10);
  } catch {
    return [];
  }
}

export function saveTeamLocation(
  teamId: string | null | undefined,
  venue: SavedPracticeVenue
): SavedPracticeVenue[] {
  const name = venue.name.trim().slice(0, 80);
  if (!name) return loadSavedTeamLocations(teamId);
  const existing = loadSavedTeamLocations(teamId);
  const isDefault = DEFAULT_PRACTICE_VENUE_PRESETS.some(
    (d) => d.name.toLowerCase() === name.toLowerCase()
  );
  if (isDefault) return existing;
  const next: SavedPracticeVenue[] = [
    {
      name,
      category: sanitizePracticeVenueCategory(venue.category) || 'OTHER',
      ...(sanitizeScheduledTime(venue.defaultTime)
        ? { defaultTime: sanitizeScheduledTime(venue.defaultTime) }
        : {}),
    },
    ...existing.filter((v) => v.name.toLowerCase() !== name.toLowerCase()),
  ].slice(0, 8);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(teamVenuesStorageKey(teamId), JSON.stringify(next));
    } catch {
      // ignore
    }
  }
  return next;
}
