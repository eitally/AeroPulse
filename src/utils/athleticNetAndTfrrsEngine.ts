import type {
  CoachEventGroup,
  ExternalTeamPlatform,
  OfficialRacePlatform,
  OfficialTrackSurface,
  PracticeVenueCategory,
  TeamBroadcastWorkout,
  TeamExternalSyncConfig,
  TeamMembershipRecord,
  TeamOrgType,
  TeamSummaryWithRole,
  UnifiedActivity,
} from '../types.ts';
import {
  computeOfficialRaceTrainingLoad,
  formatFatTime,
  parseFatTimeString,
  synthesizeOfficialRaceActivity,
  type ParsedOfficialRaceCandidate,
} from './officialRaceSynthesizer.ts';
import {
  calibrateThresholdsFromSeedMark,
  getOrgTypeSafeguardingDefaults,
  inferEventGroupFromSeedMark,
} from '../physiology/teamOnboardingEngine.ts';
import { getLocalDateIso } from '../physiology/stravaLoadCalibration.ts';

export type ExternalPasteKind = 'ICS_CALENDAR' | 'ROSTER' | 'SCHEDULE' | 'MEET_RESULTS';

export interface ParsedExternalTeamUrl {
  platform: 'ATHLETIC_NET' | 'TFRRS';
  canonicalUrl: string;
  athleticNetSchoolId?: string;
  athleticNetSportSlug?: 'xc' | 'track-and-field-outdoor' | 'track-and-field-indoor';
  tfrrsTeamCode?: string;
  genderHint?: 'M' | 'F';
  orgTypeHint?: TeamOrgType;
  inferredTeamName?: string;
}

export interface ParsedExternalMeetEvent {
  date: string; // YYYY-MM-DD
  name: string;
  locationName?: string;
  locationCategory: PracticeVenueCategory;
  scheduledTime?: string; // HH:mm
  distanceMeters?: number;
  description?: string;
  externalSource: ExternalTeamPlatform;
}

export interface ParsedExternalRosterAthlete {
  name: string;
  squadGroup: string;
  eventGroup?: CoachEventGroup;
  graduationYear?: number;
  gradeLabel?: string;
  genderDivision?: 'M' | 'F' | 'NONBINARY';
  seedMarkOrFtp?: string;
  externalSource: ExternalTeamPlatform;
  externalAthleteId?: string;
  externalProfileUrl?: string;
  isMinorU18: boolean;
}

export interface ParsedExternalMeetResultRow {
  athleteName: string;
  teamName?: string;
  gradeOrYear?: string;
  graduationYear?: number;
  genderDivision?: 'M' | 'F';
  squadGroup?: string;
  date: string;
  meetName: string;
  eventLabel: string;
  eventDistanceMeters: number;
  fatTimeSecs: number;
  displayFatTime: string;
  placeFinish?: string;
  trackType: OfficialTrackSurface;
  platform: OfficialRacePlatform;
  externalSource: ExternalTeamPlatform;
  externalAthleteId?: string;
  externalProfileUrl?: string;
  sourceUrl?: string;
}

export interface RosterMatchMemberRef {
  membershipId: string;
  invitedName: string;
  squadGroup: string;
  graduationYear?: number;
  externalAthleteId?: string;
}

export interface MatchedExternalMeetResult {
  row: ParsedExternalMeetResultRow;
  action: 'MATCHED' | 'CREATE_NEW';
  membershipId?: string;
  matchedAthleteName?: string;
  candidate: ParsedOfficialRaceCandidate;
  activity: UnifiedActivity;
}

export interface ThreshBookmarkletEnvelopeV1 {
  schema: 'THRESH_SYNC_V1';
  sourcePlatform: 'ATHLETIC_NET' | 'TFRRS';
  pageUrl: string;
  pageTitle?: string;
  schoolId?: string;
  sportSlug?: string;
  capturedAt: string;
  athletes?: Array<{
    name: string;
    externalAthleteId?: string;
    externalProfileUrl?: string;
    squadGroup?: string;
    gradeOrYear?: string;
    genderDivision?: 'M' | 'F';
    seedMark?: string;
    teamName?: string;
  }>;
  meets?: Array<{
    date: string;
    name: string;
    locationName?: string;
    scheduledTime?: string;
    distanceText?: string;
  }>;
  results?: Array<{
    athleteName: string;
    teamName?: string;
    externalAthleteId?: string;
    externalProfileUrl?: string;
    gradeOrYear?: string;
    date?: string;
    meetName?: string;
    eventText: string;
    markText: string;
    placeFinish?: string;
  }>;
  rawTextFallback?: string;
}

export const COURSE_DISTANCE_PRESETS: Array<{
  id: string;
  label: string;
  distanceMeters: number;
  eventLabel: string;
  trackType: OfficialTrackSurface;
}> = [
  {
    id: 'AUTO',
    label: 'Auto-Detect From Text / Course Name',
    distanceMeters: 5000,
    eventLabel: 'XC 5K',
    trackType: 'XC_COURSE',
  },
  {
    id: 'CRYSTAL_SPRINGS',
    label: 'Crystal Springs XC (2.95 mi · 4,748m)',
    distanceMeters: 4748,
    eventLabel: '2.95 mi XC (Crystal Springs)',
    trackType: 'XC_COURSE',
  },
  {
    id: 'MONTGOMERY_HILL',
    label: 'Montgomery Hill XC (2.74 mi · 4,410m)',
    distanceMeters: 4410,
    eventLabel: '2.74 mi XC (Montgomery Hill)',
    trackType: 'XC_COURSE',
  },
  {
    id: 'THREE_MILE_XC',
    label: 'Bay Area / Toro / Mt. SAC 3.0 mi (4,828m)',
    distanceMeters: 4828,
    eventLabel: '3.0 mi XC',
    trackType: 'XC_COURSE',
  },
  {
    id: 'FIVE_K_XC',
    label: 'Standard 5K XC / Woodward Park (5,000m)',
    distanceMeters: 5000,
    eventLabel: 'XC 5K',
    trackType: 'XC_COURSE',
  },
  {
    id: 'NCAA_6K_XC',
    label: 'NCAA Women 6K XC (6,000m)',
    distanceMeters: 6000,
    eventLabel: 'XC 6K',
    trackType: 'XC_COURSE',
  },
  {
    id: 'NCAA_8K_XC',
    label: 'NCAA Men 8K XC (8,000m)',
    distanceMeters: 8000,
    eventLabel: 'XC 8K',
    trackType: 'XC_COURSE',
  },
  {
    id: 'TRACK_1600',
    label: 'Track 1600m (Outdoor 400m)',
    distanceMeters: 1600,
    eventLabel: '1600m',
    trackType: 'OUTDOOR_400M',
  },
  {
    id: 'TRACK_3200',
    label: 'Track 3200m (Outdoor 400m)',
    distanceMeters: 3200,
    eventLabel: '3200m',
    trackType: 'OUTDOOR_400M',
  },
];

const ICONIC_COURSE_PATTERNS: Array<{
  pattern: RegExp;
  distanceMeters: number;
  eventLabel: string;
}> = [
  { pattern: /crystal\s*springs/i, distanceMeters: 4748, eventLabel: '2.95 mi XC (Crystal Springs)' },
  { pattern: /montgomery\s*hill/i, distanceMeters: 4410, eventLabel: '2.74 mi XC (Montgomery Hill)' },
  { pattern: /toro\s*park/i, distanceMeters: 4828, eventLabel: '3.0 mi XC (Toro Park)' },
  { pattern: /mt\.?\s*sac/i, distanceMeters: 4715, eventLabel: '2.93 mi XC (Mt. SAC)' },
  { pattern: /woodward\s*park/i, distanceMeters: 5000, eventLabel: 'XC 5K (Woodward Park)' },
  { pattern: /baylands/i, distanceMeters: 5000, eventLabel: 'XC 5K (Baylands)' },
  { pattern: /hellyer/i, distanceMeters: 4828, eventLabel: '3.0 mi XC (Hellyer)' },
  { pattern: /half\s*moon\s*bay/i, distanceMeters: 3862, eventLabel: '2.4 mi XC (Half Moon Bay)' },
  { pattern: /central\s*park|lynnbrook|fremont\s*high/i, distanceMeters: 3380, eventLabel: '2.1 mi XC' },
];

export function normalizeWebcalUrl(rawUrl: string): string {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  if (/^webcals:\/\//i.test(trimmed)) {
    return trimmed.replace(/^webcals:\/\//i, 'https://');
  }
  if (/^webcal:\/\//i.test(trimmed)) {
    return trimmed.replace(/^webcal:\/\//i, 'https://');
  }
  return trimmed;
}

function normalizeAthleticSportSlug(
  rawSegment?: string
): 'xc' | 'track-and-field-outdoor' | 'track-and-field-indoor' {
  const s = (rawSegment || '').toLowerCase();
  if (s.includes('indoor')) return 'track-and-field-indoor';
  if (s.includes('track') || s.includes('tf')) return 'track-and-field-outdoor';
  return 'xc';
}

function titleCaseSlug(slug: string): string {
  return slug
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      if (w.toLowerCase() === 'st') return 'St.';
      if (w.length <= 2 && w === w.toUpperCase()) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Parses Athletic.net or TFRRS team URLs into normalized team IDs & canonical URLs.
 * Supports:
 * - https://www.athletic.net/photos/team/1073/xc
 * - https://www.athletic.net/team/1073/xc
 * - https://www.athletic.net/team/1073/track-and-field-outdoor
 * - https://www.athletic.net/CrossCountry/School.aspx?SchoolID=1073
 * - https://www.tfrrs.org/teams/tf/CA_college_m_Stanford.html
 * - https://xc.tfrrs.org/teams/xc/CA_college_f_Stanford.html
 */
export function parseExternalTeamUrl(rawUrl: string): ParsedExternalTeamUrl | null {
  const cleaned = String(rawUrl || '').trim();
  if (!cleaned) return null;

  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (host === 'athletic.net' || host.endsWith('.athletic.net')) {
    const modernMatch = parsed.pathname.match(
      /^\/(?:photos\/)?team\/(\d{2,10})(?:\/([a-z0-9-]+))?/i
    );
    const schoolIdParam = parsed.searchParams.get('SchoolID');
    const schoolId = modernMatch?.[1] || (schoolIdParam && /^\d{2,10}$/.test(schoolIdParam) ? schoolIdParam : '');
    if (!schoolId) return null;

    const legacySport = /trackandfield/i.test(parsed.pathname)
      ? 'track-and-field-outdoor'
      : 'xc';
    const sportSlug = normalizeAthleticSportSlug(modernMatch?.[2] || legacySport);
    const canonicalUrl = `https://www.athletic.net/team/${schoolId}/${sportSlug}`;
    const knownSchoolName = schoolId === '1073' ? 'Willow Glen High School' : undefined;

    return {
      platform: 'ATHLETIC_NET',
      canonicalUrl,
      athleticNetSchoolId: schoolId,
      athleticNetSportSlug: sportSlug,
      orgTypeHint: 'HIGH_SCHOOL',
      ...(knownSchoolName ? { inferredTeamName: knownSchoolName } : {}),
    };
  }

  if (host === 'tfrrs.org' || host.endsWith('.tfrrs.org')) {
    const teamMatch = parsed.pathname.match(
      /^\/teams\/(?:(xc|tf)\/)?([A-Za-z0-9_-]+?)(?:\.html?)?$/i
    );
    const tfrrsCode = teamMatch?.[2] || parsed.pathname.replace(/[^A-Za-z0-9_-]/g, '');
    const codeParts = tfrrsCode.split('_');
    const genderRaw = (codeParts[2] || '').toLowerCase();
    const genderHint: 'M' | 'F' | undefined =
      genderRaw === 'm' ? 'M' : genderRaw === 'f' ? 'F' : undefined;
    const slugName = codeParts.length >= 4 ? titleCaseSlug(codeParts.slice(3).join(' ')) : undefined;
    const isCollege = tfrrsCode.toLowerCase().includes('_college_');

    return {
      platform: 'TFRRS',
      canonicalUrl: parsed.toString(),
      tfrrsTeamCode: tfrrsCode || undefined,
      genderHint,
      orgTypeHint: isCollege ? 'COLLEGIATE' : 'HIGH_SCHOOL',
      ...(slugName ? { inferredTeamName: slugName } : {}),
    };
  }

  return null;
}

export function resolveRaceEventDistance(
  rawText: string,
  fallbackMeters = 5000
): {
  eventLabel: string;
  distanceMeters: number;
  trackType: OfficialTrackSurface;
  isCrossCountry: boolean;
} {
  const s = String(rawText || '').trim();
  const isIndoor = /\bindoor\b|200m\s*banked|flat\s*200/i.test(s);
  const trackSurface: OfficialTrackSurface = isIndoor ? 'INDOOR_BANKED_200M' : 'OUTDOOR_400M';

  // Exact iconic XC course lookup (Crystal Springs 2.95 mi, Montgomery Hill 2.74 mi, etc.)
  for (const preset of ICONIC_COURSE_PATTERNS) {
    if (preset.pattern.test(s)) {
      return {
        eventLabel: preset.eventLabel,
        distanceMeters: preset.distanceMeters,
        trackType: 'XC_COURSE',
        isCrossCountry: true,
      };
    }
  }

  // Explicit distance in miles (e.g. "2.95 Miles", "2.74 mi", "3.0 Miles", "1 Mile")
  const mileMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:miles?|mi)\b/i);
  if (mileMatch) {
    const miles = parseFloat(mileMatch[1]);
    if (Number.isFinite(miles) && miles > 0) {
      const meters = Math.round(miles * 1609.344);
      if (Math.abs(miles - 1) < 0.02 && !/\bxc\b|cross\s*country/i.test(s)) {
        return { eventLabel: '1 Mile', distanceMeters: 1609, trackType: trackSurface, isCrossCountry: false };
      }
      if (Math.abs(miles - 2) < 0.03 && /\btrack\b|outdoor|indoor/i.test(s)) {
        return { eventLabel: '2 Mile', distanceMeters: 3219, trackType: trackSurface, isCrossCountry: false };
      }
      const isXc = /\bxc\b|cross|invitational|opener|classic|park|hill|springs|league|bval|ccs/i.test(s) || miles >= 1.9;
      return {
        eventLabel: isXc ? `${miles.toFixed(miles % 1 === 0 ? 1 : 2)} mi XC` : `${miles} mi`,
        distanceMeters: meters,
        trackType: isXc ? 'XC_COURSE' : 'ROAD',
        isCrossCountry: isXc,
      };
    }
  }

  // Track or XC metric distances: 5K, 6K, 8K, 10K, 100m..10000m
  const kMatch = s.match(/(\d+(?:\.\d+)?)\s*k\b/i);
  if (kMatch) {
    const km = parseFloat(kMatch[1]);
    if (Number.isFinite(km) && km > 0) {
      const meters = Math.round(km * 1000);
      const isXc = !/\broad\b|\btrack\b/i.test(s);
      return {
        eventLabel: isXc ? `XC ${km}K` : `Road ${km}K`,
        distanceMeters: meters,
        trackType: isXc ? 'XC_COURSE' : 'ROAD',
        isCrossCountry: isXc,
      };
    }
  }

  const meterMatch = s.match(/(\d{3,5}(?:,\d{3})?)\s*m(?:eters?)?\b/i);
  if (meterMatch) {
    const meters = parseInt(meterMatch[1].replace(/,/g, ''), 10);
    if (Number.isFinite(meters) && meters >= 60) {
      const isXc = /\bxc\b|cross\s*country|varsity|frosh|jv\b/i.test(s) && meters >= 3000;
      const eventLabel =
        isXc && meters === 5000 ? 'XC 5K' : `${meters}m`;
      return {
        eventLabel,
        distanceMeters: meters,
        trackType: isXc ? 'XC_COURSE' : trackSurface,
        isCrossCountry: isXc,
      };
    }
  }

  const isFallbackXc = fallbackMeters >= 3000;
  return {
    eventLabel: isFallbackXc
      ? fallbackMeters === 4748
        ? '2.95 mi XC'
        : fallbackMeters === 4410
          ? '2.74 mi XC'
          : `XC ${(fallbackMeters / 1000).toFixed(fallbackMeters % 1000 === 0 ? 0 : 1)}K`
      : `${fallbackMeters}m`,
    distanceMeters: fallbackMeters,
    trackType: isFallbackXc ? 'XC_COURSE' : trackSurface,
    isCrossCountry: isFallbackXc,
  };
}

function unescapeIcsValue(val: string): string {
  return val
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function parseIcsDateAndTime(rawValue: string): { date: string; scheduledTime?: string } | null {
  const clean = rawValue.trim();
  const dateOnly = clean.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnly) {
    return { date: `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}` };
  }
  const dateTimeMatch = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
  if (dateTimeMatch) {
    return {
      date: `${dateTimeMatch[1]}-${dateTimeMatch[2]}-${dateTimeMatch[3]}`,
      scheduledTime: `${dateTimeMatch[4]}:${dateTimeMatch[5]}`,
    };
  }
  return null;
}

function inferVenueCategoryFromMeetText(text: string): PracticeVenueCategory {
  if (/track|oval|stadium|relay|twilight|invite.*1600/i.test(text)) return 'TRACK';
  if (/road|half\s*marathon|10k\s*road|turkey\s*trot/i.test(text)) return 'ROAD_CAMPUS';
  return 'XC_COURSE';
}

/**
 * Parses an Athletic.net / Sidearm Sports RFC 5545 .ics calendar feed into THRESH Meet events.
 */
export function parseIcsCalendarToMeets(
  icsText: string,
  externalSource: ExternalTeamPlatform = 'ATHLETIC_NET'
): ParsedExternalMeetEvent[] {
  const unfolded = String(icsText || '').replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  const meets: ParsedExternalMeetEvent[] = [];

  let inEvent = false;
  let summary = '';
  let dtstart = '';
  let location = '';
  let description = '';

  const flushEvent = () => {
    if (!summary || !dtstart) return;
    const parsedDt = parseIcsDateAndTime(dtstart);
    if (!parsedDt) return;
    const dist = resolveRaceEventDistance(`${summary} ${location} ${description}`, 5000);
    meets.push({
      date: parsedDt.date,
      name: summary.slice(0, 100),
      ...(location ? { locationName: location.slice(0, 120) } : {}),
      locationCategory: inferVenueCategoryFromMeetText(`${summary} ${location}`),
      ...(parsedDt.scheduledTime ? { scheduledTime: parsedDt.scheduledTime } : {}),
      distanceMeters: dist.distanceMeters,
      ...(description ? { description: description.slice(0, 260) } : {}),
      externalSource,
    });
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      summary = '';
      dtstart = '';
      location = '';
      description = '';
      continue;
    }
    if (line === 'END:VEVENT') {
      flushEvent();
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0) continue;
    const rawKey = line.slice(0, colonIdx).split(';')[0].toUpperCase();
    const rawVal = unescapeIcsValue(line.slice(colonIdx + 1));

    if (rawKey === 'SUMMARY') summary = rawVal;
    else if (rawKey === 'DTSTART') dtstart = rawVal;
    else if (rawKey === 'LOCATION') location = rawVal;
    else if (rawKey === 'DESCRIPTION') description = rawVal;
  }

  return meets.sort((a, b) => a.date.localeCompare(b.date));
}

const MONTH_INDEX_MAP: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

export function parseFlexibleDateToIso(raw: string, fallbackYear = new Date().getFullYear()): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;

  const isoMatch = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const slashMatch = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (slashMatch) {
    const mm = parseInt(slashMatch[1], 10);
    const dd = parseInt(slashMatch[2], 10);
    let yy = slashMatch[3] ? parseInt(slashMatch[3], 10) : fallbackYear;
    if (yy < 100) yy += 2000;
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
  }

  const monthMatch = s.match(
    /(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/i
  );
  if (monthMatch) {
    const mm = MONTH_INDEX_MAP[monthMatch[1].toLowerCase()];
    const dd = parseInt(monthMatch[2], 10);
    const yy = monthMatch[3] ? parseInt(monthMatch[3], 10) : fallbackYear;
    if (mm && dd >= 1 && dd <= 31) {
      return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
  }

  return null;
}

export function tryParseBookmarkletEnvelope(rawText: string): ThreshBookmarkletEnvelopeV1 | null {
  const trimmed = String(rawText || '').trim();
  const payload = trimmed.startsWith('THRESH_SYNC_V1:')
    ? trimmed.slice('THRESH_SYNC_V1:'.length).trim()
    : trimmed;
  if (!payload.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(payload) as Partial<ThreshBookmarkletEnvelopeV1>;
    if (parsed && parsed.schema === 'THRESH_SYNC_V1') {
      return parsed as ThreshBookmarkletEnvelopeV1;
    }
  } catch {
    // ignore malformed json
  }
  return null;
}

export function parsePastedScheduleToMeets(
  rawText: string,
  options: { defaultYear?: number; externalSource?: ExternalTeamPlatform } = {}
): ParsedExternalMeetEvent[] {
  const source = options.externalSource || 'ATHLETIC_NET';
  const defaultYear = options.defaultYear || new Date().getFullYear();

  const envelope = tryParseBookmarkletEnvelope(rawText);
  if (envelope?.meets && envelope.meets.length > 0) {
    return envelope.meets
      .map((m): ParsedExternalMeetEvent | null => {
        const iso = parseFlexibleDateToIso(m.date, defaultYear);
        if (!iso || !m.name?.trim()) return null;
        const dist = resolveRaceEventDistance(
          `${m.name} ${m.locationName || ''} ${m.distanceText || ''}`,
          5000
        );
        return {
          date: iso,
          name: m.name.trim().slice(0, 100),
          ...(m.locationName ? { locationName: m.locationName.trim().slice(0, 120) } : {}),
          locationCategory: inferVenueCategoryFromMeetText(`${m.name} ${m.locationName || ''}`),
          ...(m.scheduledTime ? { scheduledTime: m.scheduledTime.trim() } : {}),
          distanceMeters: dist.distanceMeters,
          externalSource: envelope.sourcePlatform,
        };
      })
      .filter((x): x is ParsedExternalMeetEvent => x !== null);
  }

  if (rawText.includes('BEGIN:VEVENT')) {
    return parseIcsCalendarToMeets(rawText, source);
  }

  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const meets: ParsedExternalMeetEvent[] = [];
  for (const line of lines) {
    if (/^(date|calendar|season\s+schedule|meet\s*\|)/i.test(line)) continue;
    const cols = splitDelimitedLine(line);
    const dateIso = parseFlexibleDateToIso(cols[0] || line, defaultYear);
    if (!dateIso) continue;

    let name = '';
    let locationName: string | undefined;
    let scheduledTime: string | undefined;

    if (cols.length >= 2) {
      const remainder = cols
        .slice(1)
        .map((c) => c.trim())
        .filter(Boolean);
      name = remainder[0] || '';
      for (const cell of remainder.slice(1)) {
        const timeMatch = cell.match(/^(\d{1,2}:\d{2})\s*(am|pm)?$/i);
        if (timeMatch) {
          let hh = parseInt(timeMatch[1].split(':')[0], 10);
          const mm = parseInt(timeMatch[1].split(':')[1], 10);
          const ap = (timeMatch[2] || '').toLowerCase();
          if (ap === 'pm' && hh < 12) hh += 12;
          if (ap === 'am' && hh === 12) hh = 0;
          scheduledTime = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
        } else if (!/^\d+(?:\.\d+)?\s*(mi|km|k|m)$/i.test(cell) && !locationName) {
          locationName = cell;
        }
      }
    } else {
      const stripped = line
        .replace(
          /(?:\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s*\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i,
          ''
        )
        .replace(/^[,\-–|\s]+/, '')
        .trim();
      const parts = stripped.split(/\s+@\s+|\s+-\s+/);
      name = (parts[0] || '').trim();
      if (parts[1]) locationName = parts[1].trim();
    }

    if (!name || name.length < 3) continue;
    const dist = resolveRaceEventDistance(line, 5000);
    meets.push({
      date: dateIso,
      name: name.slice(0, 100),
      ...(locationName ? { locationName: locationName.slice(0, 120) } : {}),
      locationCategory: inferVenueCategoryFromMeetText(`${name} ${locationName || ''} ${line}`),
      ...(scheduledTime ? { scheduledTime } : {}),
      distanceMeters: dist.distanceMeters,
      externalSource: source,
    });
  }

  return meets;
}

function splitDelimitedLine(line: string): string[] {
  if (line.includes('\t')) {
    return line.split('\t').map((c) => c.trim());
  }
  if (line.includes('|')) {
    return line.split('|').map((c) => c.trim());
  }
  if (line.includes(';')) {
    return line.split(';').map((c) => c.trim());
  }
  if (line.includes(',')) {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  }
  return line.split(/\s{2,}/).map((c) => c.trim());
}

/**
 * Resolves High School (9-12, Fr/So/Jr/Sr) or Collegiate (FR-1..SR-4/GR) grade token into graduation year.
 */
export function resolveGraduationYearFromGradeToken(
  token: string,
  refDate = new Date()
): { graduationYear?: number; gradeLabel?: string; isCollegeClass?: boolean } {
  const clean = String(token || '').trim().toUpperCase();
  if (!clean) return {};
  const academicEndYear = refDate.getMonth() >= 6 ? refDate.getFullYear() + 1 : refDate.getFullYear();

  if (/^\d{4}$/.test(clean)) {
    const yr = parseInt(clean, 10);
    if (yr >= 2000 && yr <= 2045) return { graduationYear: yr, gradeLabel: String(yr) };
  }

  const gradeNum = clean.match(/^(?:GR(?:ADE)?\s*)?(9|10|11|12)(?:TH)?$/);
  if (gradeNum) {
    const g = parseInt(gradeNum[1], 10);
    return {
      graduationYear: academicEndYear + (12 - g),
      gradeLabel: `${g}th`,
    };
  }

  const colMatch = clean.match(/^(FR|SO|JR|SR)(?:-([1-5]))?$/);
  if (colMatch) {
    const mapOffset: Record<string, number> = { SR: 0, JR: 1, SO: 2, FR: 3 };
    return {
      graduationYear: academicEndYear + mapOffset[colMatch[1]],
      gradeLabel: clean,
      isCollegeClass: true,
    };
  }

  if (clean === 'FRESHMAN' || clean === 'FR') {
    return { graduationYear: academicEndYear + 3, gradeLabel: 'Fr' };
  }
  if (clean === 'SOPHOMORE' || clean === 'SO') {
    return { graduationYear: academicEndYear + 2, gradeLabel: 'So' };
  }
  if (clean === 'JUNIOR' || clean === 'JR') {
    return { graduationYear: academicEndYear + 1, gradeLabel: 'Jr' };
  }
  if (clean === 'SENIOR' || clean === 'SR') {
    return { graduationYear: academicEndYear, gradeLabel: 'Sr' };
  }
  if (clean === 'GR' || clean === 'GRAD') {
    return { graduationYear: academicEndYear, gradeLabel: 'GR', isCollegeClass: true };
  }

  return {};
}

export function normalizeAthleteMatchKey(name: string): string {
  const s = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  const commaParts = s.split(',').map((p) => p.trim()).filter(Boolean);
  const reordered =
    commaParts.length === 2 ? `${commaParts[1]} ${commaParts[0]}` : s;
  return reordered.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function formatAthleteDisplayName(rawName: string): string {
  const s = String(rawName || '').trim();
  const commaParts = s.split(',').map((p) => p.trim()).filter(Boolean);
  if (commaParts.length === 2) {
    return `${commaParts[1]} ${commaParts[0]}`.replace(/\s+/g, ' ').trim();
  }
  return s.replace(/\s+/g, ' ');
}

const ATHLETE_NAME_CELL_PATTERN =
  /^[A-Za-zÀ-ÿ'’.-]{1,24}(?:\s+[A-Za-zÀ-ÿ'’.-]{1,24}){1,4}$|^[A-Za-zÀ-ÿ'’.-]{2,24},\s*[A-Za-zÀ-ÿ'’.-]{1,24}(?:\s+[A-Za-zÀ-ÿ'’.-]{1,24})?$/;

function extractSeedTimeToken(raw: string): string | undefined {
  const match = raw.match(/\b(\d{1,2}:\d{2}(?:\.\d{1,2})?[a-zA-Z]*|\d{2}\.\d{2}[a-zA-Z]*)\b/);
  return match ? match[1] : undefined;
}

function detectSquadSectionHeader(line: string): string | null {
  const l = line.trim();
  if (l.length > 65 || /\d{1,2}:\d{2}/.test(l) || /@/.test(l)) return null;
  if (/^(?:boys?|men'?s?)\s+varsity\b/i.test(l)) return 'Boys Varsity';
  if (/^(?:girls?|women'?s?)\s+varsity\b/i.test(l)) return 'Girls Varsity';
  if (/^varsity\b/i.test(l)) return 'Varsity';
  if (/^(?:boys?|men'?s?)?\s*(?:junior\s+varsity|jv)\b/i.test(l)) return 'Junior Varsity';
  if (/^(?:boys?|girls?)?\s*(?:frosh\/?soph|freshman\/?sophomore|f\/s)\b/i.test(l)) return 'Frosh/Soph';
  if (/^(?:men'?s?|women'?s?)?\s*(?:roster|athletes?)\s*$/i.test(l)) {
    if (/women/i.test(l)) return 'Women';
    if (/men/i.test(l)) return 'Men';
  }
  return null;
}

function inferGenderFromSection(section: string): 'M' | 'F' | undefined {
  if (/\b(?:boys?|men'?s?|men)\b/i.test(section)) return 'M';
  if (/\b(?:girls?|women'?s?|women)\b/i.test(section)) return 'F';
  return undefined;
}

/**
 * Parses Athletic.net copy-pasted team rosters, TFRRS official CSV roster exports,
 * Hy-Tek CSV rosters, or Bookmarklet THRESH_SYNC_V1 payloads.
 */
export function parseExternalTeamRoster(
  rawText: string,
  options: {
    orgType?: TeamOrgType;
    defaultSquad?: string;
    externalSource?: ExternalTeamPlatform;
  } = {}
): ParsedExternalRosterAthlete[] {
  const orgType = options.orgType || 'HIGH_SCHOOL';
  const defaultSquad = options.defaultSquad || 'Varsity';
  const defaultSource =
    options.externalSource ||
    (/tfrrs/i.test(rawText) ? 'TFRRS' : 'ATHLETIC_NET');

  const envelope = tryParseBookmarkletEnvelope(rawText);
  if (envelope?.athletes && envelope.athletes.length > 0) {
    return envelope.athletes
      .filter((a) => Boolean(a.name?.trim()))
      .map((a) => {
        const gradeMeta = resolveGraduationYearFromGradeToken(a.gradeOrYear || '');
        const cleanSeed = a.seedMark ? extractSeedTimeToken(a.seedMark) || a.seedMark : undefined;
        return {
          name: formatAthleteDisplayName(a.name).slice(0, 64),
          squadGroup: a.squadGroup || defaultSquad,
          ...(cleanSeed && inferEventGroupFromSeedMark(cleanSeed)
            ? { eventGroup: inferEventGroupFromSeedMark(cleanSeed) }
            : {}),
          ...(gradeMeta.graduationYear ? { graduationYear: gradeMeta.graduationYear } : {}),
          ...(gradeMeta.gradeLabel ? { gradeLabel: gradeMeta.gradeLabel } : {}),
          ...(a.genderDivision ? { genderDivision: a.genderDivision } : {}),
          ...(cleanSeed ? { seedMarkOrFtp: cleanSeed } : {}),
          externalSource: envelope.sourcePlatform,
          ...(a.externalAthleteId ? { externalAthleteId: a.externalAthleteId } : {}),
          ...(a.externalProfileUrl ? { externalProfileUrl: a.externalProfileUrl } : {}),
          isMinorU18: orgType === 'HIGH_SCHOOL',
        };
      });
  }

  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const firstCols = splitDelimitedLine(lines[0]).map((c) =>
    c.toLowerCase().replace(/[^a-z0-9]/g, '')
  );
  const isTabularHeader =
    firstCols.length >= 2 &&
    firstCols.some((c) =>
      ['tfrrsid', 'athleteid', 'firstname', 'lastname', 'name', 'athlete', 'gender', 'year', 'grade'].includes(c)
    );

  if (isTabularHeader) {
    const colIdx = {
      tfrrsId: firstCols.findIndex((c) => c === 'tfrrsid' || c === 'athleteid' || c === 'aid'),
      firstName: firstCols.findIndex((c) => c === 'firstname' || c === 'first'),
      lastName: firstCols.findIndex((c) => c === 'lastname' || c === 'last'),
      name: firstCols.findIndex((c) => c === 'name' || c === 'athlete' || c === 'fullname'),
      gender: firstCols.findIndex((c) => c === 'gender' || c === 'sex'),
      year: firstCols.findIndex((c) => c === 'year' || c === 'class' || c === 'grade' || c === 'gradyear'),
      squad: firstCols.findIndex((c) => c === 'squad' || c === 'division' || c === 'group'),
      seed: firstCols.findIndex((c) => c === 'seed' || c === 'pr' || c === 'sb' || c === 'mark' || c === '5k'),
      event: firstCols.findIndex((c) => c === 'event' || c === 'events'),
    };

    const out: ParsedExternalRosterAthlete[] = [];
    for (const line of lines.slice(1)) {
      const cols = splitDelimitedLine(line);
      const rawName =
        colIdx.firstName >= 0 || colIdx.lastName >= 0
          ? `${colIdx.firstName >= 0 ? cols[colIdx.firstName] || '' : ''} ${colIdx.lastName >= 0 ? cols[colIdx.lastName] || '' : ''}`.trim()
          : cols[colIdx.name >= 0 ? colIdx.name : 0] || '';
      const name = formatAthleteDisplayName(rawName);
      if (!name || name.length < 2) continue;

      const extId = colIdx.tfrrsId >= 0 ? cols[colIdx.tfrrsId]?.trim() : undefined;
      const gRaw = colIdx.gender >= 0 ? cols[colIdx.gender]?.trim().toUpperCase() : '';
      const genderDivision: 'M' | 'F' | undefined =
        gRaw.startsWith('M') || gRaw === 'B'
          ? 'M'
          : gRaw.startsWith('F') || gRaw.startsWith('W') || gRaw === 'G'
            ? 'F'
            : undefined;
      const gradeMeta =
        colIdx.year >= 0 ? resolveGraduationYearFromGradeToken(cols[colIdx.year] || '') : {};
      const seedRaw = colIdx.seed >= 0 ? cols[colIdx.seed]?.trim() : '';
      const squadGroup =
        (colIdx.squad >= 0 && cols[colIdx.squad]?.trim()) ||
        (genderDivision === 'F' ? 'Women Varsity' : genderDivision === 'M' ? 'Men Varsity' : defaultSquad);
      const eventHint = colIdx.event >= 0 ? cols[colIdx.event]?.trim() : '';

      const inferredEventGroup =
        inferEventGroupFromSeedMark(eventHint || seedRaw) ||
        (/xc|cross|5k|6k|8k|3200/i.test(eventHint) ? 'DISTANCE' : undefined);
      out.push({
        name: name.slice(0, 64),
        squadGroup,
        ...(inferredEventGroup ? { eventGroup: inferredEventGroup } : {}),
        ...(gradeMeta.graduationYear ? { graduationYear: gradeMeta.graduationYear } : {}),
        ...(gradeMeta.gradeLabel ? { gradeLabel: gradeMeta.gradeLabel } : {}),
        ...(genderDivision ? { genderDivision } : {}),
        ...(seedRaw ? { seedMarkOrFtp: seedRaw } : {}),
        externalSource: extId && /^\d+$/.test(extId) && defaultSource === 'TFRRS' ? 'TFRRS' : defaultSource,
        ...(extId ? { externalAthleteId: extId } : {}),
        ...(extId && defaultSource === 'TFRRS'
          ? { externalProfileUrl: `https://www.tfrrs.org/athletes/${extId}.html` }
          : {}),
        isMinorU18: orgType === 'HIGH_SCHOOL' && !gradeMeta.isCollegeClass,
      });
    }
    return out;
  }

  // Freeform Select-All & Paste from Athletic.net / TFRRS team roster or season-best pages
  let activeSquad = defaultSquad;
  let activeGender: 'M' | 'F' | undefined;
  const seen = new Set<string>();
  const athletes: ParsedExternalRosterAthlete[] = [];

  for (const rawLine of lines) {
    const header = detectSquadSectionHeader(rawLine);
    if (header) {
      activeSquad = header;
      activeGender = inferGenderFromSection(header) || activeGender;
      continue;
    }

    // Skip navigation chrome from Select-All copies
    if (/^(?:athletic\.net|tfrrs|sign\s*in|home|calendar|records|rankings|photos|roster|season\s*bests|filters?)$/i.test(rawLine)) {
      continue;
    }

    const aidMatch = rawLine.match(/(?:AID=|\/athletes\/)(\d{4,10})/i);
    const strippedLine = rawLine.replace(/https?:\/\/\S+/g, '').trim();
    const cols = splitDelimitedLine(strippedLine);

    let name = '';
    let gradeMeta: ReturnType<typeof resolveGraduationYearFromGradeToken> = {};
    let seedMark: string | undefined;

    if (cols.length >= 2) {
      for (const cell of cols) {
        if (/^\d{1,3}\.?$/.test(cell) && parseInt(cell, 10) > 12) continue; // skip place rank
        if (!gradeMeta.gradeLabel) {
          const gm = resolveGraduationYearFromGradeToken(cell);
          if (gm.graduationYear || gm.gradeLabel) {
            gradeMeta = gm;
            continue;
          }
        }
        if (!seedMark) {
          const sm = extractSeedTimeToken(cell);
          if (sm) {
            seedMark = sm;
            continue;
          }
        }
        if (!name && ATHLETE_NAME_CELL_PATTERN.test(cell)) {
          name = formatAthleteDisplayName(cell);
        }
      }
    } else {
      // Single line space-separated copy (e.g. "Lucas Alvarez 11 15:24.8" or "12 Sofia Chen 18:19.4")
      const seed = extractSeedTimeToken(strippedLine);
      if (seed) seedMark = seed;
      const tokens = strippedLine
        .replace(seed || '', '')
        .trim()
        .split(/\s+/);
      const nameParts: string[] = [];
      for (const tok of tokens) {
        if (/^\d+\.$/.test(tok)) continue;
        const gm = resolveGraduationYearFromGradeToken(tok);
        if (!gradeMeta.gradeLabel && (gm.graduationYear || gm.gradeLabel)) {
          gradeMeta = gm;
          continue;
        }
        if (/^[A-Za-zÀ-ÿ'.,-]+$/.test(tok)) {
          nameParts.push(tok);
        }
      }
      if (nameParts.length >= 2) {
        name = formatAthleteDisplayName(nameParts.join(' '));
      }
    }

    if (!name || name.length < 3 || /^\d+$/.test(name)) continue;
    const key = normalizeAthleteMatchKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const freeformGroup = inferEventGroupFromSeedMark(seedMark || '');
    athletes.push({
      name: name.slice(0, 64),
      squadGroup: activeSquad,
      ...(freeformGroup ? { eventGroup: freeformGroup } : {}),
      ...(gradeMeta.graduationYear ? { graduationYear: gradeMeta.graduationYear } : {}),
      ...(gradeMeta.gradeLabel ? { gradeLabel: gradeMeta.gradeLabel } : {}),
      ...(activeGender ? { genderDivision: activeGender } : {}),
      ...(seedMark ? { seedMarkOrFtp: seedMark } : {}),
      externalSource: defaultSource,
      ...(aidMatch?.[1] ? { externalAthleteId: aidMatch[1] } : {}),
      isMinorU18: orgType === 'HIGH_SCHOOL' && !gradeMeta.isCollegeClass,
    });
  }

  return athletes;
}

/**
 * Parses whole-team Athletic.net, TFRRS, Hy-Tek semicolon/CSV, or Bookmarklet meet results,
 * supporting team filtering (e.g. "Willow Glen") and custom XC course distances (2.95 mi, etc.).
 */
export function parseExternalMeetResults(
  rawText: string,
  options: {
    defaultMeetName?: string;
    defaultDateIso?: string;
    defaultCourseOrDistance?: string;
    teamFilterKeyword?: string;
    externalSource?: ExternalTeamPlatform;
    sourceUrl?: string;
  } = {}
): ParsedExternalMeetResultRow[] {
  const defaultDate = options.defaultDateIso || getLocalDateIso();
  const defaultMeet = options.defaultMeetName || 'Official Invitational';
  const source: ExternalTeamPlatform =
    options.externalSource || (/tfrrs/i.test(rawText) ? 'TFRRS' : 'ATHLETIC_NET');
  const teamKeyword = (options.teamFilterKeyword || '').trim().toLowerCase();

  const envelope = tryParseBookmarkletEnvelope(rawText);
  if (envelope?.results && envelope.results.length > 0) {
    const out: ParsedExternalMeetResultRow[] = [];
    for (const r of envelope.results) {
      if (teamKeyword && r.teamName && !r.teamName.toLowerCase().includes(teamKeyword)) {
        continue;
      }
      const fatSecs = parseFatTimeString(r.markText);
      if (!r.athleteName || fatSecs <= 0) continue;
      const resolvedDist = resolveRaceEventDistance(
        `${r.eventText || ''} ${r.meetName || ''} ${options.defaultCourseOrDistance || ''}`,
        5000
      );
      const gm = resolveGraduationYearFromGradeToken(r.gradeOrYear || '');
      out.push({
        athleteName: formatAthleteDisplayName(r.athleteName),
        ...(r.teamName ? { teamName: r.teamName } : {}),
        ...(gm.gradeLabel ? { gradeOrYear: gm.gradeLabel } : {}),
        ...(gm.graduationYear ? { graduationYear: gm.graduationYear } : {}),
        date: parseFlexibleDateToIso(r.date || '') || defaultDate,
        meetName: r.meetName || envelope.pageTitle || defaultMeet,
        eventLabel: resolvedDist.eventLabel,
        eventDistanceMeters: resolvedDist.distanceMeters,
        fatTimeSecs: fatSecs,
        displayFatTime: formatFatTime(fatSecs),
        ...(r.placeFinish ? { placeFinish: r.placeFinish } : {}),
        trackType: resolvedDist.trackType,
        platform: envelope.sourcePlatform === 'TFRRS' ? 'TFRRS' : 'Athletic.net',
        externalSource: envelope.sourcePlatform,
        ...(r.externalAthleteId ? { externalAthleteId: r.externalAthleteId } : {}),
        ...(r.externalProfileUrl ? { externalProfileUrl: r.externalProfileUrl } : {}),
        sourceUrl: envelope.pageUrl || options.sourceUrl,
      });
    }
    return out;
  }

  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let currentMeet = defaultMeet;
  let currentDate = defaultDate;
  let currentCourse = options.defaultCourseOrDistance || '';
  let currentSquad: string | undefined;
  const results: ParsedExternalMeetResultRow[] = [];

  for (const rawLine of lines) {
    // Check metadata header lines (e.g., "Meet: Crystal Springs Invite | Date: 2026-10-17 | Course: Crystal Springs 2.95 mi")
    const meetHeader = rawLine.match(/^(?:meet|event\s*header)\s*:\s*([^|]+)/i);
    if (meetHeader) {
      currentMeet = meetHeader[1].trim();
      const d = parseFlexibleDateToIso(rawLine);
      if (d) currentDate = d;
      if (/mile|km|k\b|meter|springs|hill|park/i.test(rawLine)) {
        currentCourse = rawLine;
      }
      continue;
    }

    const sectionHeader = detectSquadSectionHeader(rawLine);
    if (sectionHeader) {
      currentSquad = sectionHeader;
      if (/mile|km|k\b|meter|springs|hill|park/i.test(rawLine)) {
        currentCourse = rawLine;
      }
      continue;
    }

    // Extract time mark anywhere in the row
    const markToken = extractSeedTimeToken(rawLine);
    if (!markToken) continue;
    const fatSecs = parseFatTimeString(markToken);
    if (!fatSecs || fatSecs < 9 || fatSecs > 7200) continue;

    // Extract optional explicit date & external athlete ID
    const rowDate = parseFlexibleDateToIso(rawLine) || currentDate;
    const aidMatch = rawLine.match(/(?:AID=|\/athletes\/)(\d{4,10})/i);

    const cols = splitDelimitedLine(rawLine.replace(/https?:\/\/\S+/g, '').trim());
    let athleteName = '';
    let teamName: string | undefined;
    let placeFinish: string | undefined;
    let gradeOrYear: string | undefined;
    let graduationYear: number | undefined;
    let eventContextText = `${currentCourse} ${currentMeet}`;

    if (cols.length >= 3) {
      for (const cell of cols) {
        if (!cell || cell === markToken || cell === rowDate) continue;
        if (/^(\d{1,4})(?:st|nd|rd|th)?$/i.test(cell) && !placeFinish && parseInt(cell, 10) <= 2000) {
          const val = parseInt(cell, 10);
          if (val >= 9 && val <= 12 && !gradeOrYear && !athleteName) {
            // Ambiguous before name unless small place; check next cells
            placeFinish = String(val);
          } else if (val >= 9 && val <= 12 && athleteName && !gradeOrYear) {
            const gm = resolveGraduationYearFromGradeToken(cell);
            gradeOrYear = gm.gradeLabel;
            graduationYear = gm.graduationYear;
          } else if (!placeFinish) {
            placeFinish = cell;
          }
          continue;
        }
        const gm = resolveGraduationYearFromGradeToken(cell);
        if ((gm.graduationYear || gm.gradeLabel) && !/^\d{4}$/.test(cell)) {
          gradeOrYear = gm.gradeLabel;
          graduationYear = gm.graduationYear;
          continue;
        }
        if (/(\d+(?:\.\d+)?\s*(?:miles?|mi|k|km|m)\b|crystal\s*springs|montgomery\s*hill|track|xc)/i.test(cell)) {
          eventContextText = `${cell} ${eventContextText}`;
          if (!/^\d{3,4}m$|^\d+(?:\.\d+)?\s*(?:miles?|mi|k)$/i.test(cell) && !currentMeet) {
            currentMeet = cell;
          }
          continue;
        }
        if (!athleteName && ATHLETE_NAME_CELL_PATTERN.test(cell)) {
          athleteName = formatAthleteDisplayName(cell);
          continue;
        }
        if (athleteName && !teamName && /[A-Za-z]{2,}/.test(cell) && !cell.includes(':')) {
          teamName = cell;
        }
      }
    } else {
      // Single-line pasted row e.g. "4  Lucas Alvarez  11  Willow Glen  15:18.4  2.95 mi"
      const tokens = rawLine
        .replace(markToken, '')
        .replace(rowDate, '')
        .trim()
        .split(/\s+/);
      const placeCandidate = tokens[0]?.match(/^(\d{1,3})\.?$/);
      if (placeCandidate) {
        placeFinish = placeCandidate[1];
        tokens.shift();
      }
      const words: string[] = [];
      for (const tok of tokens) {
        const gm = resolveGraduationYearFromGradeToken(tok);
        if (!gradeOrYear && (gm.graduationYear || gm.gradeLabel)) {
          gradeOrYear = gm.gradeLabel;
          graduationYear = gm.graduationYear;
          continue;
        }
        words.push(tok);
      }
      if (words.length >= 2) {
        athleteName = formatAthleteDisplayName(words.slice(0, 2).join(' '));
        if (words.length > 2) {
          teamName = words.slice(2).join(' ');
        }
      }
    }

    if (!athleteName || athleteName.length < 3) continue;
    if (teamKeyword && teamName && !teamName.toLowerCase().includes(teamKeyword)) {
      continue;
    }

    const resolvedDist = resolveRaceEventDistance(eventContextText, 5000);
    const platform: OfficialRacePlatform = source === 'TFRRS' ? 'TFRRS' : 'Athletic.net';

    results.push({
      athleteName: athleteName.slice(0, 64),
      ...(teamName ? { teamName } : {}),
      ...(gradeOrYear ? { gradeOrYear } : {}),
      ...(graduationYear ? { graduationYear } : {}),
      ...(currentSquad ? { squadGroup: currentSquad } : {}),
      date: rowDate,
      meetName: currentMeet,
      eventLabel: resolvedDist.eventLabel,
      eventDistanceMeters: resolvedDist.distanceMeters,
      fatTimeSecs: fatSecs,
      displayFatTime: formatFatTime(fatSecs),
      ...(placeFinish ? { placeFinish } : {}),
      trackType: resolvedDist.trackType,
      platform,
      externalSource: source,
      ...(aidMatch?.[1] ? { externalAthleteId: aidMatch[1] } : {}),
      ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}),
    });
  }

  return results;
}

/**
 * Matches parsed meet result rows against an existing THRESH team roster and generates
 * official race candidates & full UnifiedActivity objects with VDOT calibration.
 */
export function matchExternalResultsToRoster(
  parsedResults: ParsedExternalMeetResultRow[],
  rosterMembers: RosterMatchMemberRef[]
): {
  matched: MatchedExternalMeetResult[];
  matchedExistingCount: number;
  newWalkOnCount: number;
} {
  const byExternalId = new Map<string, RosterMatchMemberRef>();
  const byNormName = new Map<string, RosterMatchMemberRef>();

  for (const m of rosterMembers) {
    if (m.externalAthleteId) {
      byExternalId.set(m.externalAthleteId.trim(), m);
    }
    const key = normalizeAthleteMatchKey(m.invitedName);
    if (key) {
      byNormName.set(key, m);
    }
  }

  let matchedExistingCount = 0;
  let newWalkOnCount = 0;

  const matched: MatchedExternalMeetResult[] = parsedResults.map((row, idx) => {
    const extMatch = row.externalAthleteId ? byExternalId.get(row.externalAthleteId.trim()) : undefined;
    const nameMatch = byNormName.get(normalizeAthleteMatchKey(row.athleteName));
    const target = extMatch || nameMatch;

    if (target) matchedExistingCount += 1;
    else newWalkOnCount += 1;

    const candidate: ParsedOfficialRaceCandidate = {
      id: `ext-race-${row.date}-${idx}-${row.athleteName.replace(/[^a-z0-9]/gi, '').slice(0, 8)}`,
      date: row.date,
      meetName: row.meetName,
      eventLabel: row.eventLabel,
      eventDistanceMeters: row.eventDistanceMeters,
      fatTimeSecs: row.fatTimeSecs,
      displayFatTime: row.displayFatTime,
      platform: row.platform,
      trackType: row.trackType,
      placeFinish: row.placeFinish,
      lapSplitDistanceMeters:
        row.eventDistanceMeters <= 400
          ? 200
          : row.eventDistanceMeters >= 3000
            ? 1000
            : 400,
      lapSplitsSecs: [],
      includeWarmupCooldown: false,
      sourceUrl: row.externalProfileUrl || row.sourceUrl,
      startDateLocalIso: `${row.date}T09:00:00`,
    };

    const activity = synthesizeOfficialRaceActivity(candidate);

    return {
      row,
      action: target ? 'MATCHED' : 'CREATE_NEW',
      ...(target
        ? {
            membershipId: target.membershipId,
            matchedAthleteName: target.invitedName,
          }
        : {}),
      candidate,
      activity,
    };
  });

  return {
    matched,
    matchedExistingCount,
    newWalkOnCount,
  };
}

/**
 * Classifies pasted text / uploaded file contents automatically into Roster, Schedule,
 * .ics Calendar, or Multi-Athlete Meet Results.
 */
export function detectExternalPasteKind(rawText: string): ExternalPasteKind {
  const s = String(rawText || '').trim();
  if (!s) return 'ROSTER';
  if (s.includes('BEGIN:VCALENDAR') || s.includes('BEGIN:VEVENT')) {
    return 'ICS_CALENDAR';
  }
  const env = tryParseBookmarkletEnvelope(s);
  if (env) {
    if (env.results && env.results.length > 0) return 'MEET_RESULTS';
    if (env.meets && env.meets.length > 0 && (!env.athletes || env.athletes.length === 0)) {
      return 'SCHEDULE';
    }
    return 'ROSTER';
  }

  const lines = s.split(/\r?\n/).filter(Boolean);
  const meetHeaderLike = lines.some((l) => /^meet\s*:|place\s*[|\t;,]/i.test(l));
  const multiTimeRows = lines.filter((l) => Boolean(extractSeedTimeToken(l))).length;
  const dateRows = lines.filter((l) => Boolean(parseFlexibleDateToIso(l))).length;

  if (dateRows >= 2 && multiTimeRows === 0) {
    return 'SCHEDULE';
  }
  if (meetHeaderLike || (multiTimeRows >= 2 && /invitational|finals|chs|ccs|bval|dual|meet\s*results|5k|1600m|3200m|crystal\s*springs/i.test(s))) {
    return 'MEET_RESULTS';
  }
  return 'ROSTER';
}

/**
 * Builds the 1-Click "Send to THRESH" Bookmarklet URL coaches & parents drag to their
 * bookmarks bar to capture Athletic.net or TFRRS DOM tables right inside their live browser tab.
 */
export function buildThreshExternalSyncBookmarklet(appOrigin: string): string {
  const safeOrigin = String(appOrigin || 'https://thresh-dev.vercel.app').replace(/\/+$/, '');
  const code = `(function(){try{var u=location.href,h=location.hostname.toLowerCase(),p=h.indexOf('tfrrs')!==-1?'TFRRS':'ATHLETIC_NET',ath=[],seen={},rows=document.querySelectorAll('table tr,.athlete-row,[data-athlete-id]');for(var i=0;i<rows.length;i++){var r=rows[i],a=r.querySelector('a[href*="AID="],a[href*="/athletes/"],a[href*="/athlete/"]');var id='';if(a){var m=a.href.match(/(?:AID=|athletes?\\/)(\\d{4,10})/i);if(m)id=m[1];}var txt=(r.innerText||'').replace(/\\s+/g,' ').trim();if(txt.length>4&&txt.length<260&&!seen[txt]){seen[txt]=1;ath.push({name:a?(a.textContent||'').trim():txt.split(/\\t|\\s{2,}/)[0],externalAthleteId:id||undefined,externalProfileUrl:a?a.href:undefined,seedMark:(txt.match(/\\b\\d{1,2}:\\d{2}(?:\\.\\d{1,2})?[a-zA-Z]*\\b/)||[])[0]});}}var payload={schema:'THRESH_SYNC_V1',sourcePlatform:p,pageUrl:u,pageTitle:document.title,capturedAt:new Date().toISOString(),athletes:ath.slice(0,200),rawTextFallback:document.body.innerText.slice(0,30000)};var clip='THRESH_SYNC_V1:'+JSON.stringify(payload);if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(clip).catch(function(){});}var w=window.open('${safeOrigin}/#coach-sync','thresh_coach_sync');var n=0,t=setInterval(function(){n++;if(!w||n>20){clearInterval(t);return;}try{w.postMessage({type:'THRESH_EXTERNAL_SYNC_V1',payload:payload},'${safeOrigin}');}catch(e){}},350);}catch(e){alert('THRESH Sync could not read this page: '+e);}})();`;
  return `javascript:${encodeURIComponent(code)}`;
}

// ============================================================================
// Built-In Willow Glen HS (1073/xc) & Collegiate TFRRS Sample Payloads
// ============================================================================

export const WILLOW_GLEN_XC_PRESET = {
  teamName: 'Willow Glen High School XC',
  shortName: 'WGHS XC',
  mascotOrMotto: 'Rams · Run as One',
  orgType: 'HIGH_SCHOOL' as TeamOrgType,
  primaryHex: '#991B1B',
  secondaryHex: '#D97706',
  athleticNetUrl: 'https://www.athletic.net/team/1073/xc',
  athleticNetSchoolId: '1073',
  teamFilterKeyword: 'Willow Glen',
  sampleRosterText: `Boys Varsity
Lucas Alvarez, 12, Boys Varsity, 15:18.40
Mateo Navarro, 11, Boys Varsity, 15:54.10
Ethan Wu, 11, Boys Varsity, 16:22.80
Girls Varsity
Sofia Chen, 12, Girls Varsity, 18:14.20
Maya Patel, 10, Girls Varsity, 18:49.50
Junior Varsity
Noah Ramirez, 10, Junior Varsity, 17:45.00`,
  sampleScheduleIcs: `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Athletic.net//Willow Glen HS 1073//EN
BEGIN:VEVENT
DTSTART:20260919T090000
SUMMARY:Lowell Invitational (2.93 mi)
LOCATION:Golden Gate Park, San Francisco CA
DESCRIPTION:Willow Glen Rams Early-Season XC Invitational
END:VEVENT
BEGIN:VEVENT
DTSTART:20261017T083000
SUMMARY:Serra Crystal Springs Invitational (2.95 mi)
LOCATION:Crystal Springs Course, Belmont CA
DESCRIPTION:CCS Benchmark 2.95 mi Varsity & JV
END:VEVENT
BEGIN:VEVENT
DTSTART:20261103T133000
SUMMARY:BVAL League Championships (2.95 mi)
LOCATION:Crystal Springs Course, Belmont CA
DESCRIPTION:Blossom Valley Athletic League Championship
END:VEVENT
BEGIN:VEVENT
DTSTART:20261114T100000
SUMMARY:CIF Central Coast Section (CCS) Finals (2.95 mi)
LOCATION:Crystal Springs Course, Belmont CA
DESCRIPTION:CIF State Qualifier
END:VEVENT
BEGIN:VEVENT
DTSTART:20261128T093000
SUMMARY:CIF State Cross Country Championships (5K)
LOCATION:Woodward Park, Fresno CA
DESCRIPTION:California State Finals · 5,000m
END:VEVENT
END:VCALENDAR`,
  sampleMeetResultsText: `Meet: Serra Crystal Springs Invitational | Date: 2026-10-17 | Course: Crystal Springs 2.95 mi
1 | Lucas Alvarez | 12 | Willow Glen | 15:18.40
8 | Mateo Navarro | 11 | Willow Glen | 15:54.10
14 | Liam O'Connor | 11 | Rival High | 16:08.50
21 | Ethan Wu | 11 | Willow Glen | 16:22.80
3 | Sofia Chen | 12 | Willow Glen | 18:14.20
11 | Maya Patel | 10 | Willow Glen | 18:49.50`,
};

export const COLLEGIATE_TFRRS_PRESET = {
  teamName: 'Pacific University Track & XC',
  shortName: 'PACIFIC T&F',
  mascotOrMotto: 'Collegiate Distance & Track',
  orgType: 'COLLEGIATE' as TeamOrgType,
  primaryHex: '#1E3A8A',
  secondaryHex: '#CA8A04',
  tfrrsTeamUrl: 'https://xc.tfrrs.org/teams/xc/CA_college_m_Pacific.html',
  teamFilterKeyword: 'Pacific',
  sampleRosterText: `TFRRS ID,First Name,Last Name,Gender,Year,Squad,Seed
8491021,Jordan,Mercer,M,SR-4,Men Distance,14:12.40
8491044,Camille,Laurent,F,JR-3,Women Distance,16:28.15
8512903,Devon,Brooks,M,SO-2,Men Mid-Distance,1:51.64`,
};

/**
 * Applies external roster, meet schedule, and race result sync payloads directly onto a
 * TeamSummaryWithRole in local / Demo Sandbox mode, matching the backend behavior cleanly.
 */
export function applyExternalSyncLocallyToTeamSummary(
  team: TeamSummaryWithRole,
  batch: {
    externalSyncPatch?: Partial<TeamExternalSyncConfig>;
    athletes?: ParsedExternalRosterAthlete[];
    meets?: ParsedExternalMeetEvent[];
    results?: ParsedExternalMeetResultRow[];
  }
): {
  updatedTeam: TeamSummaryWithRole;
  addedAthletes: number;
  updatedAthletes: number;
  addedMeets: number;
  recordedResults: number;
} {
  const nowIso = new Date().toISOString();
  const memberships: TeamMembershipRecord[] = team.memberships.map((m) => ({
    ...m,
    coachRecordedActivities: Array.isArray(m.coachRecordedActivities)
      ? [...m.coachRecordedActivities]
      : [],
  }));
  const orgDefaults = getOrgTypeSafeguardingDefaults(team.brand.orgType);
  let addedAthletes = 0;
  let updatedAthletes = 0;
  let addedMeets = 0;
  let recordedResults = 0;

  const upsertAthlete = (cand: {
    name: string;
    squadGroup?: string;
    eventGroup?: CoachEventGroup;
    graduationYear?: number;
    genderDivision?: 'M' | 'F' | 'NONBINARY';
    seedMarkOrFtp?: string;
    externalSource: ExternalTeamPlatform;
    externalAthleteId?: string;
    externalProfileUrl?: string;
    isMinorU18?: boolean;
  }): { mem: TeamMembershipRecord; created: boolean } => {
    const key = normalizeAthleteMatchKey(cand.name);
    const existing = memberships.find((m) => {
      if (m.status === 'REVOKED' || m.role === 'PARENT_FOLLOWER') return false;
      if (cand.externalAthleteId && m.externalAthleteId === cand.externalAthleteId) return true;
      return Boolean(key) && normalizeAthleteMatchKey(m.invitedName) === key;
    });
    const safeSport = Boolean(
      team.brand.defaultSafeSportShield || cand.isMinorU18 || team.brand.orgType === 'HIGH_SCHOOL'
    );
    const isMinorImport = Boolean(cand.isMinorU18 || team.brand.orgType === 'HIGH_SCHOOL');
    const calibrated = cand.seedMarkOrFtp
      ? calibrateThresholdsFromSeedMark(cand.seedMarkOrFtp, team.brand.primarySport, 'mi')
      : undefined;

    if (existing) {
      existing.externalSource = existing.externalSource || cand.externalSource;
      if (cand.externalAthleteId) existing.externalAthleteId = cand.externalAthleteId;
      if (cand.externalProfileUrl) existing.externalProfileUrl = cand.externalProfileUrl;
      if (cand.graduationYear) existing.graduationYear = cand.graduationYear;
      if (cand.genderDivision) existing.genderDivision = cand.genderDivision;
      if (cand.seedMarkOrFtp && !existing.seedMarkOrFtp) existing.seedMarkOrFtp = cand.seedMarkOrFtp;
      if (!existing.eventGroup && (cand.eventGroup || cand.seedMarkOrFtp)) {
        const inferred = cand.eventGroup || inferEventGroupFromSeedMark(cand.seedMarkOrFtp);
        if (inferred) existing.eventGroup = inferred;
      }
      return { mem: existing, created: false };
    }

    const createdGroup = cand.eventGroup || inferEventGroupFromSeedMark(cand.seedMarkOrFtp);
    const createdMem: TeamMembershipRecord = {
      membershipId: `mem-ext-${Math.random().toString(36).slice(2, 9)}`,
      teamId: team.brand.teamId,
      role: 'ATHLETE',
      squadGroup: cand.squadGroup || orgDefaults.defaultSquads[0] || 'Varsity',
      ...(createdGroup ? { eventGroup: createdGroup } : {}),
      invitedName: cand.name,
      graduationYear: cand.graduationYear,
      isMinorU18: isMinorImport,
      parentConsentStatus: isMinorImport ? 'PENDING' : 'NOT_REQUIRED',
      seedMarkOrFtp: cand.seedMarkOrFtp,
      externalSource: cand.externalSource,
      externalAthleteId: cand.externalAthleteId,
      externalProfileUrl: cand.externalProfileUrl,
      genderDivision: cand.genderDivision,
      status: 'INVITED',
      invitedAt: nowIso,
      liveSnapshot: {
        updatedAt: nowIso,
        hasConnectedWatch: false,
        verdictLabel: `${cand.externalSource === 'TFRRS' ? 'TFRRS' : 'Athletic.net'} Synced`,
        readinessScore: 0,
        ctl: 0,
        atl: 0,
        tsb: 0,
        acuteLoad7d: 0,
        lowAerobicPct: 0,
        highAerobicPct: 0,
        neuromuscularPct: 0,
        caraHours7d: 0,
        thresholdPaceSecsPerKm: calibrated?.thresholdPaceSecsPerKm || 245,
        safeSportHideWeight: safeSport,
      },
      coachRecordedActivities: [],
    };
    memberships.push(createdMem);
    return { mem: createdMem, created: true };
  };

  for (const ath of batch.athletes || []) {
    const r = upsertAthlete(ath);
    if (r.created) addedAthletes += 1;
    else updatedAthletes += 1;
  }

  const existingMeets = new Set(
    (team.broadcastWorkouts || []).map(
      (bw) => `${bw.date}|${normalizeAthleteMatchKey(bw.name)}`
    )
  );
  const nextBroadcasts: TeamBroadcastWorkout[] = [...(team.broadcastWorkouts || [])];
  for (const m of batch.meets || []) {
    const key = `${m.date}|${normalizeAthleteMatchKey(m.name)}`;
    if (existingMeets.has(key)) continue;
    existingMeets.add(key);
    const estDist = m.distanceMeters || 5000;
    nextBroadcasts.unshift({
      broadcastId: `meet-local-${Math.random().toString(36).slice(2, 9)}`,
      teamId: team.brand.teamId,
      targetSquadGroup: 'ALL',
      date: m.date,
      name: m.name,
      sportCategory: 'Running',
      plannedDurationSecs: 5400,
      plannedLoad: computeOfficialRaceTrainingLoad(estDist, estDist >= 4000 ? 1100 : 300, true),
      workoutSyntax: `Warmup 20m Z1\nMain: ${m.name}\nCooldown 15m Z1`,
      description: m.description || `Synced ${m.externalSource} schedule`,
      ...(m.scheduledTime ? { scheduledTime: m.scheduledTime } : {}),
      locationName: m.locationName,
      locationCategory: m.locationCategory,
      planBlockId: `ext-sched-${m.externalSource.toLowerCase()}`,
      planBlockName: m.externalSource === 'TFRRS' ? 'TFRRS Meet Schedule' : 'Athletic.net Meet Schedule',
      isOfficialMeet: true,
      externalSource: m.externalSource,
      pushedByCoachName: team.brand.coachDisplayName,
      createdAt: nowIso,
    });
    addedMeets += 1;
  }

  for (const row of batch.results || []) {
    const { mem, created } = upsertAthlete({
      name: row.athleteName,
      squadGroup: row.squadGroup,
      graduationYear: row.graduationYear,
      genderDivision: row.genderDivision,
      seedMarkOrFtp: row.displayFatTime,
      externalSource: row.externalSource,
      externalAthleteId: row.externalAthleteId,
      externalProfileUrl: row.externalProfileUrl,
      isMinorU18: team.brand.orgType === 'HIGH_SCHOOL',
    });
    if (created) addedAthletes += 1;
    const acts = mem.coachRecordedActivities || [];
    const dup = acts.some(
      (a) =>
        a.startDateLocal?.slice(0, 10) === row.date &&
        a.officialRaceData?.eventDistanceMeters === row.eventDistanceMeters &&
        Math.abs((a.officialRaceData?.fatTimeSecs || 0) - row.fatTimeSecs) < 0.05
    );
    if (dup) continue;
    const activity = synthesizeOfficialRaceActivity({
      id: `ext-res-${Math.random().toString(36).slice(2, 9)}`,
      date: row.date,
      meetName: row.meetName,
      eventLabel: row.eventLabel,
      eventDistanceMeters: row.eventDistanceMeters,
      fatTimeSecs: row.fatTimeSecs,
      displayFatTime: row.displayFatTime,
      platform: row.platform,
      trackType: row.trackType,
      placeFinish: row.placeFinish,
      lapSplitDistanceMeters:
        row.eventDistanceMeters <= 400 ? 200 : row.eventDistanceMeters >= 3000 ? 1000 : 400,
      lapSplitsSecs: [],
      includeWarmupCooldown: false,
      sourceUrl: row.externalProfileUrl || row.sourceUrl,
      startDateLocalIso: `${row.date}T09:00:00`,
    });
    mem.coachRecordedActivities = [activity, ...acts];
    recordedResults += 1;
  }

  const updatedTeam: TeamSummaryWithRole = {
    ...team,
    brand: {
      ...team.brand,
      externalSync: {
        ...(team.brand.externalSync || {}),
        ...(batch.externalSyncPatch || {}),
        enablePublicParentHub:
          batch.externalSyncPatch?.enablePublicParentHub ??
          team.brand.externalSync?.enablePublicParentHub ??
          true,
        lastSyncedAt: nowIso,
      },
    },
    memberships,
    totalInvited: memberships.length,
    broadcastWorkouts: nextBroadcasts,
  };

  return {
    updatedTeam,
    addedAthletes,
    updatedAthletes,
    addedMeets,
    recordedResults,
  };
}

export function buildPresetExternalTeamSummary(
  presetKey: 'WILLOW_GLEN' | 'COLLEGIATE_TFRRS',
  coachDisplayName = 'Coach'
): TeamSummaryWithRole {
  const nowIso = new Date().toISOString();
  const isWg = presetKey === 'WILLOW_GLEN';
  const baseTeam: TeamSummaryWithRole = {
    brand: {
      teamId: isWg ? 'tm_wghs_1073_xc' : 'tm_pacific_tfrrs_demo',
      slug: isWg ? 'willow-glen-high-school-xc' : 'pacific-university-track-xc',
      joinCode: isWg ? 'WGHS-26' : 'PAC-26',
      name: isWg ? WILLOW_GLEN_XC_PRESET.teamName : COLLEGIATE_TFRRS_PRESET.teamName,
      shortName: isWg ? WILLOW_GLEN_XC_PRESET.shortName : COLLEGIATE_TFRRS_PRESET.shortName,
      mascotOrMotto: isWg
        ? WILLOW_GLEN_XC_PRESET.mascotOrMotto
        : COLLEGIATE_TFRRS_PRESET.mascotOrMotto,
      orgType: isWg ? 'HIGH_SCHOOL' : 'COLLEGIATE',
      primarySport: 'Running',
      primaryHex: isWg ? WILLOW_GLEN_XC_PRESET.primaryHex : COLLEGIATE_TFRRS_PRESET.primaryHex,
      secondaryHex: isWg
        ? WILLOW_GLEN_XC_PRESET.secondaryHex
        : COLLEGIATE_TFRRS_PRESET.secondaryHex,
      defaultSafeSportShield: true,
      enableParentGuardianCc: isWg,
      coachDisplayName,
      planTier: 'FOUNDING_TEAM',
      externalSync: isWg
        ? {
            platform: 'ATHLETIC_NET',
            athleticNetSchoolId: '1073',
            athleticNetSportSlug: 'xc',
            athleticNetUrl: WILLOW_GLEN_XC_PRESET.athleticNetUrl,
            teamFilterKeyword: WILLOW_GLEN_XC_PRESET.teamFilterKeyword,
            enablePublicParentHub: true,
          }
        : {
            platform: 'TFRRS',
            tfrrsTeamUrl: COLLEGIATE_TFRRS_PRESET.tfrrsTeamUrl,
            tfrrsTeamCode: 'CA_college_m_Pacific',
            teamFilterKeyword: COLLEGIATE_TFRRS_PRESET.teamFilterKeyword,
            enablePublicParentHub: true,
          },
      createdAt: nowIso,
    },
    myRole: 'HEAD_COACH',
    mySquadGroup: isWg ? 'Varsity' : 'Men Distance',
    myMembershipId: isWg ? 'mem_wg_coach' : 'mem_pac_coach',
    totalInvited: 1,
    openedCount: 1,
    activeCount: 1,
    watchConnectedCount: 0,
    memberships: [
      {
        membershipId: isWg ? 'mem_wg_coach' : 'mem_pac_coach',
        teamId: isWg ? 'tm_wghs_1073_xc' : 'tm_pacific_tfrrs_demo',
        role: 'HEAD_COACH',
        squadGroup: isWg ? 'Varsity' : 'Men Distance',
        invitedName: coachDisplayName,
        isMinorU18: false,
        status: 'ACTIVE',
        invitedAt: nowIso,
        openedAt: nowIso,
        joinedAt: nowIso,
      },
    ],
    broadcastWorkouts: [],
  };

  if (isWg) {
    const athletes = parseExternalTeamRoster(WILLOW_GLEN_XC_PRESET.sampleRosterText, {
      orgType: 'HIGH_SCHOOL',
      externalSource: 'ATHLETIC_NET',
    });
    const meets = parseIcsCalendarToMeets(WILLOW_GLEN_XC_PRESET.sampleScheduleIcs, 'ATHLETIC_NET');
    const results = parseExternalMeetResults(WILLOW_GLEN_XC_PRESET.sampleMeetResultsText, {
      teamFilterKeyword: 'Willow Glen',
      externalSource: 'ATHLETIC_NET',
    });
    return applyExternalSyncLocallyToTeamSummary(baseTeam, { athletes, meets, results }).updatedTeam;
  }

  const colAthletes = parseExternalTeamRoster(COLLEGIATE_TFRRS_PRESET.sampleRosterText, {
    orgType: 'COLLEGIATE',
    externalSource: 'TFRRS',
  });
  return applyExternalSyncLocallyToTeamSummary(baseTeam, { athletes: colAthletes }).updatedTeam;
}
