import { formatFieldMarkDual, parseFieldMarkToMeters } from './fieldEventsEngine';

export interface MeetEventSpec {
  code: string;
  label: string;
  category: 'TRACK' | 'RELAY' | 'FIELD';
  defaultLanes?: number;
}

export const ALL_MEET_DAY_EVENTS: ReadonlyArray<MeetEventSpec> = [
  { code: '60m', label: '60m Dash', category: 'TRACK', defaultLanes: 8 },
  { code: '100m', label: '100m Dash', category: 'TRACK', defaultLanes: 8 },
  { code: '200m', label: '200m Dash', category: 'TRACK', defaultLanes: 8 },
  { code: '400m', label: '400m Dash', category: 'TRACK', defaultLanes: 8 },
  { code: '800m', label: '800m Run', category: 'TRACK', defaultLanes: 8 },
  { code: '1600m', label: '1600m / Mile', category: 'TRACK', defaultLanes: 16 },
  { code: '3200m', label: '3200m / 2-Mile', category: 'TRACK', defaultLanes: 20 },
  { code: '60mH', label: '60m Hurdles', category: 'TRACK', defaultLanes: 8 },
  { code: '100mH', label: '100m Hurdles', category: 'TRACK', defaultLanes: 8 },
  { code: '110mH', label: '110m Hurdles', category: 'TRACK', defaultLanes: 8 },
  { code: '300mH', label: '300m Hurdles', category: 'TRACK', defaultLanes: 8 },
  { code: '400mH', label: '400m Hurdles', category: 'TRACK', defaultLanes: 8 },
  { code: '4x100m', label: '4×100m Relay', category: 'RELAY', defaultLanes: 8 },
  { code: '4x200m', label: '4×200m Relay', category: 'RELAY', defaultLanes: 8 },
  { code: '4x400m', label: '4×400m Relay', category: 'RELAY', defaultLanes: 8 },
  { code: '4x800m', label: '4×800m Relay', category: 'RELAY', defaultLanes: 12 },
  { code: 'DMR', label: 'Distance Medley Relay (DMR)', category: 'RELAY', defaultLanes: 12 },
  { code: 'LJ', label: 'Long Jump', category: 'FIELD' },
  { code: 'TJ', label: 'Triple Jump', category: 'FIELD' },
  { code: 'HJ', label: 'High Jump', category: 'FIELD' },
  { code: 'PV', label: 'Pole Vault', category: 'FIELD' },
  { code: 'SP', label: 'Shot Put', category: 'FIELD' },
  { code: 'DISCUS', label: 'Discus', category: 'FIELD' },
  { code: 'JAVELIN', label: 'Javelin', category: 'FIELD' },
  { code: 'HAMMER', label: 'Hammer', category: 'FIELD' },
];

export type MeetGenderDivision = 'M' | 'F' | 'NONBINARY';

export interface MeetEntryRecord {
  id: string;
  athleteId: string;
  athleteName: string;
  genderDivision?: MeetGenderDivision;
  division?: string;
  graduationYear?: number;
  eventCode: string;
  seedMark: string;
  relayTeamCode?: string;
  relayLegOrder?: 1 | 2 | 3 | 4;
}

export interface NfhsEventLimitAuditRow {
  athleteId: string;
  athleteName: string;
  eventCount: number;
  events: string[];
  overLimit: boolean;
}

export interface MeetHeatAssignment {
  heatNumber: number;
  lane: number;
  athleteId: string;
  athleteName: string;
  seedMark: string;
  seedSecs: number | null;
  genderDivision?: MeetGenderDivision;
  division?: string;
  partitionLabel?: string;
}

export interface MeetFlightAssignment {
  flightNumber: number;
  orderIndex: number;
  athleteId: string;
  athleteName: string;
  seedMark: string;
  seedMeters: number | null;
  genderDivision?: MeetGenderDivision;
  division?: string;
  partitionLabel?: string;
}

const PREFERRED_LANE_ORDER = [4, 5, 3, 6, 2, 7, 1, 8];

export const MEET_DIVISION_CHOICES = ['Varsity', 'Junior Varsity', 'Frosh/Soph'] as const;

export function inferDivisionFromSquadGroup(squadGroup?: string): string {
  const s = String(squadGroup || '').toLowerCase();
  if (/frosh|fresh|f\/s|soph/i.test(s)) return 'Frosh/Soph';
  if (/junior\s*varsity|\bjv\b/i.test(s)) return 'Junior Varsity';
  if (/varsity|\bopen\b/i.test(s)) return 'Varsity';
  return squadGroup && squadGroup.trim() ? squadGroup.trim() : 'Varsity';
}

export function formatMeetGenderLabel(gender?: MeetGenderDivision): string {
  if (gender === 'F') return 'Girls';
  if (gender === 'M') return 'Boys';
  if (gender === 'NONBINARY') return 'Non-Binary';
  return '';
}

export function buildPartitionLabel(
  gender?: MeetGenderDivision,
  division?: string
): string {
  const gLabel = formatMeetGenderLabel(gender);
  const dLabel = String(division || '').trim();
  return [gLabel, dLabel].filter(Boolean).join(' ') || 'Open';
}

function resolvePartitionSortRank(gender?: MeetGenderDivision, division?: string): string {
  const gRank = gender === 'F' ? '0' : gender === 'M' ? '1' : gender === 'NONBINARY' ? '2' : '3';
  const dLower = String(division || '').trim().toLowerCase();
  const dRank =
    dLower === 'varsity'
      ? '0'
      : dLower === 'junior varsity' || dLower === 'jv'
        ? '1'
        : dLower === 'frosh/soph' || dLower === 'f/s'
          ? '2'
          : `3_${dLower}`;
  return `${gRank}|${dRank}`;
}

export type SeedPartitionOption = boolean | { partitionByDivision?: boolean };

function resolveShouldPartition(
  entriesForEvent: MeetEntryRecord[],
  partitionOption?: SeedPartitionOption
): boolean {
  if (typeof partitionOption === 'boolean') return partitionOption;
  if (partitionOption && typeof partitionOption.partitionByDivision === 'boolean') {
    return partitionOption.partitionByDivision;
  }
  return entriesForEvent.some((e) => Boolean(e.genderDivision || e.division?.trim()));
}

interface PartitionBucket {
  key: string;
  genderDivision?: MeetGenderDivision;
  division?: string;
  partitionLabel: string;
  sortRank: string;
  entries: MeetEntryRecord[];
}

function groupEntriesByPartition(
  entriesForEvent: MeetEntryRecord[],
  shouldPartition: boolean
): PartitionBucket[] {
  if (!shouldPartition) {
    return [
      {
        key: 'ALL',
        partitionLabel: 'Open',
        sortRank: '0',
        entries: entriesForEvent,
      },
    ];
  }

  const buckets = new Map<string, PartitionBucket>();
  for (const entry of entriesForEvent) {
    const cleanDiv = entry.division?.trim() || undefined;
    const key = `${entry.genderDivision || 'OPEN'}|${(cleanDiv || '').toLowerCase()}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.entries.push(entry);
    } else {
      buckets.set(key, {
        key,
        ...(entry.genderDivision ? { genderDivision: entry.genderDivision } : {}),
        ...(cleanDiv ? { division: cleanDiv } : {}),
        partitionLabel: buildPartitionLabel(entry.genderDivision, cleanDiv),
        sortRank: resolvePartitionSortRank(entry.genderDivision, cleanDiv),
        entries: [entry],
      });
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.sortRank.localeCompare(b.sortRank));
}

export function parseTrackSeedTimeToSecs(raw: string): number | null {
  const s = String(raw || '').trim();
  if (!s || /^nt$/i.test(s)) return null;
  const colon = s.match(/^(\d{1,2}):(\d{1,2}(?:\.\d{1,2})?)$/);
  if (colon) {
    const mins = Number(colon[1]);
    const secs = Number(colon[2]);
    if (Number.isFinite(mins) && Number.isFinite(secs) && secs < 60) {
      return Number((mins * 60 + secs).toFixed(2));
    }
    return null;
  }
  const plain = s.match(/^(\d{1,4}(?:\.\d{1,2})?)s?$/i);
  if (plain) {
    const val = Number(plain[1]);
    return Number.isFinite(val) && val > 0 ? Number(val.toFixed(2)) : null;
  }
  return null;
}

export function validateNfhsFourEventLimits(
  entries: MeetEntryRecord[],
  maxEventsPerAthlete = 4
): NfhsEventLimitAuditRow[] {
  const byAthlete = new Map<string, { name: string; events: string[] }>();
  for (const e of entries) {
    const key = (e.athleteId || e.athleteName).trim().toLowerCase();
    const bucket = byAthlete.get(key) || { name: e.athleteName, events: [] };
    bucket.events.push(e.eventCode);
    byAthlete.set(key, bucket);
  }
  return Array.from(byAthlete.entries())
    .map(([athleteId, info]) => ({
      athleteId,
      athleteName: info.name,
      eventCount: info.events.length,
      events: info.events,
      overLimit: info.events.length > maxEventsPerAthlete,
    }))
    .sort((a, b) => {
      if (a.overLimit !== b.overLimit) return a.overLimit ? -1 : 1;
      return b.eventCount - a.eventCount || a.athleteName.localeCompare(b.athleteName);
    });
}

export function seedTrackHeats(
  entries: MeetEntryRecord[],
  eventCode: string,
  lanesPerHeat = 8,
  partitionOption?: SeedPartitionOption
): MeetHeatAssignment[] {
  const matching = entries.filter((e) => e.eventCode === eventCode);
  if (matching.length === 0) return [];

  const shouldPartition = resolveShouldPartition(matching, partitionOption);
  const buckets = groupEntriesByPartition(matching, shouldPartition);
  const cap = Math.max(2, Math.min(20, lanesPerHeat));
  const allAssignments: MeetHeatAssignment[] = [];

  for (const bucket of buckets) {
    const sorted = bucket.entries
      .map((e) => ({ ...e, seedSecs: parseTrackSeedTimeToSecs(e.seedMark) }))
      .sort((a, b) => {
        if (a.seedSecs === null && b.seedSecs === null) {
          return a.athleteName.localeCompare(b.athleteName);
        }
        if (a.seedSecs === null) return 1;
        if (b.seedSecs === null) return -1;
        return a.seedSecs - b.seedSecs;
      });

    const bucketAssignments: MeetHeatAssignment[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const heatNumber = Math.floor(i / cap) + 1;
      const posInHeat = i % cap;
      const lane = cap <= 8 ? PREFERRED_LANE_ORDER[posInHeat] ?? posInHeat + 1 : posInHeat + 1;
      const gDiv = sorted[i].genderDivision || bucket.genderDivision;
      const div = sorted[i].division?.trim() || bucket.division;
      bucketAssignments.push({
        heatNumber,
        lane,
        athleteId: sorted[i].athleteId,
        athleteName: sorted[i].athleteName,
        seedMark: sorted[i].seedMark || 'NT',
        seedSecs: sorted[i].seedSecs,
        ...(gDiv ? { genderDivision: gDiv } : {}),
        ...(div ? { division: div } : {}),
        ...(shouldPartition ? { partitionLabel: bucket.partitionLabel } : {}),
      });
    }
    bucketAssignments.sort((a, b) => a.heatNumber - b.heatNumber || a.lane - b.lane);
    allAssignments.push(...bucketAssignments);
  }

  return allAssignments;
}

export function seedFieldFlights(
  entries: MeetEntryRecord[],
  eventCode: string,
  maxPerFlight = 12,
  partitionOption?: SeedPartitionOption
): MeetFlightAssignment[] {
  const matching = entries.filter((e) => e.eventCode === eventCode);
  if (matching.length === 0) return [];

  const shouldPartition = resolveShouldPartition(matching, partitionOption);
  const buckets = groupEntriesByPartition(matching, shouldPartition);
  const cap = Math.max(4, Math.min(24, maxPerFlight));
  const allFlights: MeetFlightAssignment[] = [];

  for (const bucket of buckets) {
    const sorted = bucket.entries
      .map((e) => ({ ...e, seedMeters: parseFieldMarkToMeters(e.seedMark) }))
      .sort((a, b) => {
        // Standard field seeding: NM / lowest seeds jump or throw first, top seed last in final flight
        const am = a.seedMeters ?? 0;
        const bm = b.seedMeters ?? 0;
        return am - bm || a.athleteName.localeCompare(b.athleteName);
      });

    sorted.forEach((row, idx) => {
      const gDiv = row.genderDivision || bucket.genderDivision;
      const div = row.division?.trim() || bucket.division;
      allFlights.push({
        flightNumber: Math.floor(idx / cap) + 1,
        orderIndex: (idx % cap) + 1,
        athleteId: row.athleteId,
        athleteName: row.athleteName,
        seedMark:
          row.seedMeters && row.seedMeters > 0
            ? formatFieldMarkDual(row.seedMeters)
            : row.seedMark || 'NM',
        seedMeters: row.seedMeters,
        ...(gDiv ? { genderDivision: gDiv } : {}),
        ...(div ? { division: div } : {}),
        ...(shouldPartition ? { partitionLabel: bucket.partitionLabel } : {}),
      });
    });
  }

  return allFlights;
}

function sanitizeCsvCell(raw: string | number | undefined, stripSemiColon = true): string {
  const normalized = String(raw ?? '')
    .replace(stripSemiColon ? /[\r\n;]/g : /[\r\n]/g, ' ')
    .trim();
  const formulaSafe = /^[\t\r\n ]*[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
  return formulaSafe;
}

function escapeStandardCsvCell(raw: string | number | undefined): string {
  const safe = sanitizeCsvCell(raw, false);
  if (/[",]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function generateHyTekSemiColonEntryCsv(params: {
  teamName: string;
  entries: MeetEntryRecord[];
}): string {
  const specByCode = new Map(ALL_MEET_DAY_EVENTS.map((e) => [e.code, e]));
  const header = 'Team;Athlete;Gender;GradYear;Event;Category;SeedMark';
  const rows = params.entries.map((entry) => {
    const spec = specByCode.get(entry.eventCode);
    return [
      sanitizeCsvCell(params.teamName),
      sanitizeCsvCell(entry.athleteName),
      sanitizeCsvCell(entry.genderDivision || 'X'),
      sanitizeCsvCell(entry.graduationYear || ''),
      sanitizeCsvCell(entry.eventCode),
      sanitizeCsvCell(spec?.category || 'TRACK'),
      sanitizeCsvCell(entry.seedMark || 'NT'),
    ].join(';');
  });
  return [header, ...rows].join('\n');
}

export function generateAthleticNetEntryCsv(entries: MeetEntryRecord[]): string {
  const specByCode = new Map(ALL_MEET_DAY_EVENTS.map((e) => [e.code, e]));
  const header = 'Athlete,Gender,Division,GradYear,Event,Category,SeedMark,RelayTeam,RelayLeg';
  const rows = entries.map((entry) => {
    const spec = specByCode.get(entry.eventCode);
    return [
      escapeStandardCsvCell(entry.athleteName),
      escapeStandardCsvCell(entry.genderDivision || 'X'),
      escapeStandardCsvCell(entry.division || 'Varsity'),
      escapeStandardCsvCell(entry.graduationYear || ''),
      escapeStandardCsvCell(entry.eventCode),
      escapeStandardCsvCell(spec?.category || 'TRACK'),
      escapeStandardCsvCell(entry.seedMark || (spec?.category === 'FIELD' ? 'NM' : 'NT')),
      escapeStandardCsvCell(entry.relayTeamCode || ''),
      escapeStandardCsvCell(entry.relayLegOrder || ''),
    ].join(',');
  });
  return [header, ...rows].join('\n');
}

function toAsciiField(raw: string, width: number, align: 'left' | 'right' = 'left'): string {
  const ascii = String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ');
  if (ascii.length >= width) {
    return ascii.slice(0, width);
  }
  return align === 'right' ? ascii.padStart(width, ' ') : ascii.padEnd(width, ' ');
}

function formatHy3DateMmDdYyyy(isoDate?: string): string {
  const match = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[2]}${match[3]}${match[1]}`;
  }
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yyyy = String(now.getFullYear());
  return `${mm}${dd}${yyyy}`;
}

function splitNameLastFirst(fullName: string): { last: string; first: string } {
  const clean = String(fullName || '').trim();
  if (clean.includes(',')) {
    const [last, first] = clean.split(',').map((p) => p.trim());
    return { last: last || 'Athlete', first: first || '' };
  }
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { last: parts[0] || 'Athlete', first: '' };
  return {
    last: parts[parts.length - 1],
    first: parts.slice(0, -1).join(' '),
  };
}

export function computeHyTekHy3Checksum(line128: string): string {
  const padded = toAsciiField(line128, 128, 'left');
  let sumEven = 0;
  let sumOdd = 0;
  for (let i = 0; i < 128; i++) {
    const code = padded.charCodeAt(i);
    if (i % 2 === 0) sumEven += code;
    else sumOdd += code;
  }
  const combined = Math.floor((sumEven + 2 * sumOdd) / 21) + 205;
  const tens = Math.floor((combined % 100) / 10);
  const ones = combined % 10;
  return `${ones}${tens}`;
}

function finalizeHy3Line(recordCode: string, payloadBody: string): string {
  const body128 = toAsciiField(`${recordCode}${payloadBody}`, 128, 'left');
  const checksum = computeHyTekHy3Checksum(body128);
  return `${body128}${checksum}`;
}

function formatHy3SeedField(entry: MeetEntryRecord, isField: boolean): { seedStr: string; unitChar: string } {
  if (isField) {
    const meters = parseFieldMarkToMeters(entry.seedMark);
    if (meters && meters > 0) {
      return { seedStr: toAsciiField(meters.toFixed(2), 8, 'right'), unitChar: 'M' };
    }
    return { seedStr: toAsciiField('NM', 8, 'right'), unitChar: 'M' };
  }
  const secs = parseTrackSeedTimeToSecs(entry.seedMark);
  if (secs && secs > 0) {
    return { seedStr: toAsciiField(secs.toFixed(2), 8, 'right'), unitChar: 'S' };
  }
  return { seedStr: toAsciiField('NT', 8, 'right'), unitChar: 'S' };
}

export function generateHyTekHy3File(params: {
  meetTitle: string;
  meetDate?: string;
  entries: MeetEntryRecord[];
  teamCode?: string;
  teamName?: string;
}): string {
  const specByCode = new Map(ALL_MEET_DAY_EVENTS.map((e) => [e.code, e]));
  const dateMmDdYyyy = formatHy3DateMmDdYyyy(params.meetDate);
  const cleanTeamCode = toAsciiField(
    (params.teamCode || 'MTRDY').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'MTRDY',
    5,
    'left'
  );
  const cleanTeamName = toAsciiField(params.teamName || 'MeetReady Track & Field', 30, 'left');
  const cleanMeetTitle = toAsciiField(params.meetTitle || 'MeetReady Track & Field Meet', 45, 'left');

  const lines: string[] = [];

  // A1 File Header
  lines.push(
    finalizeHy3Line(
      'A1',
      `02${toAsciiField('Meet Entries', 25)}${toAsciiField('MeetReady TF', 15)}3.0   ${dateMmDdYyyy} 09:00 AM`
    )
  );

  // B1 / B2 Meet Header
  lines.push(
    finalizeHy3Line(
      'B1',
      `${cleanMeetTitle}${toAsciiField('MeetReady Track Facility', 45)}${dateMmDdYyyy}${dateMmDdYyyy}   0000`
    )
  );
  lines.push(
    finalizeHy3Line(
      'B2',
      `${toAsciiField('TF', 4)}${toAsciiField('M', 2)}${toAsciiField('NFHS / NCAA', 20)}${cleanMeetTitle}`
    )
  );

  // C1 Team ID
  lines.push(
    finalizeHy3Line(
      'C1',
      `${cleanTeamCode}${cleanTeamName}${toAsciiField(cleanTeamCode.trim(), 16)}${toAsciiField('HS/CLUB', 12)}`
    )
  );

  // Deduplicate athletes for D1 records
  const athleteIndexMap = new Map<string, { numId: string; entry: MeetEntryRecord }>();
  let seq = 1;
  for (const entry of params.entries) {
    const key = `${(entry.athleteId || entry.athleteName).toLowerCase()}|${entry.genderDivision || 'X'}`;
    if (!athleteIndexMap.has(key)) {
      athleteIndexMap.set(key, {
        numId: String(seq).padStart(5, '0'),
        entry,
      });
      seq += 1;
    }
  }

  for (const { numId, entry } of athleteIndexMap.values()) {
    const gChar = entry.genderDivision === 'F' ? 'F' : entry.genderDivision === 'M' ? 'M' : 'X';
    const { last, first } = splitNameLastFirst(entry.athleteName);
    const grad = entry.graduationYear ? String(entry.graduationYear).slice(0, 4) : '    ';
    const divStr = toAsciiField(entry.division || 'Varsity', 12);
    lines.push(
      finalizeHy3Line(
        'D1',
        `${gChar}${numId}${toAsciiField(last, 20)}${toAsciiField(first, 20)}${toAsciiField(first, 15)}${gChar}  ${grad}${divStr}${cleanTeamCode}`
      )
    );
  }

  // Individual entries (E1 / E2) and Relay entries (F1 / F2)
  const relayBuckets = new Map<string, MeetEntryRecord[]>();

  for (const entry of params.entries) {
    const spec = specByCode.get(entry.eventCode);
    const isRelay = spec?.category === 'RELAY' || /^4x|^dmr/i.test(entry.eventCode);
    if (isRelay) {
      const relayTeam = (entry.relayTeamCode || 'A').toUpperCase().slice(0, 1);
      const bucketKey = `${entry.eventCode}|${entry.genderDivision || 'X'}|${entry.division || 'Varsity'}|${relayTeam}`;
      const arr = relayBuckets.get(bucketKey) || [];
      arr.push(entry);
      relayBuckets.set(bucketKey, arr);
      continue;
    }

    const athleteKey = `${(entry.athleteId || entry.athleteName).toLowerCase()}|${entry.genderDivision || 'X'}`;
    const numId = athleteIndexMap.get(athleteKey)?.numId || '00001';
    const gChar = entry.genderDivision === 'F' ? 'F' : entry.genderDivision === 'M' ? 'M' : 'X';
    const { last } = splitNameLastFirst(entry.athleteName);
    const evField = toAsciiField(entry.eventCode, 10);
    const divField = toAsciiField(entry.division || 'Varsity', 12);
    const { seedStr, unitChar } = formatHy3SeedField(entry, spec?.category === 'FIELD');

    lines.push(
      finalizeHy3Line(
        'E1',
        `${gChar}${numId}${toAsciiField(last, 5)}${gChar}${gChar} ${evField}${divField}${seedStr}${unitChar}`
      )
    );
    lines.push(
      finalizeHy3Line(
        'E2',
        `${evField}${seedStr}${unitChar} ${toAsciiField(entry.athleteName, 30)}${divField}`
      )
    );
  }

  // Emit F1 / F2 in quartets of up to 4 legs per relay team
  for (const [bucketKey, members] of relayBuckets.entries()) {
    const [eventCode, gRaw, division, relayCode] = bucketKey.split('|');
    const gChar = gRaw === 'F' ? 'F' : gRaw === 'M' ? 'M' : 'X';
    const sortedMembers = [...members].sort(
      (a, b) => (a.relayLegOrder ?? 9) - (b.relayLegOrder ?? 9)
    );

    for (let chunkStart = 0; chunkStart < sortedMembers.length; chunkStart += 4) {
      const chunk = sortedMembers.slice(chunkStart, chunkStart + 4);
      const letterIdx = Math.floor(chunkStart / 4);
      const squadLetter =
        letterIdx === 0
          ? relayCode || 'A'
          : String.fromCharCode(65 + Math.min(25, (relayCode.charCodeAt(0) - 65) + letterIdx));
      const { seedStr, unitChar } = formatHy3SeedField(chunk[0], false);
      const evField = toAsciiField(eventCode, 10);
      const divField = toAsciiField(division, 12);

      lines.push(
        finalizeHy3Line(
          'F1',
          `${cleanTeamCode}${toAsciiField(squadLetter, 1)}  ${gChar}${gChar}${evField}${divField}${seedStr}${unitChar}`
        )
      );

      const legParts = [0, 1, 2, 3].map((idx) => {
        const m = chunk[idx];
        if (!m) return toAsciiField('', 22);
        const athleteKey = `${(m.athleteId || m.athleteName).toLowerCase()}|${m.genderDivision || 'X'}`;
        const numId = athleteIndexMap.get(athleteKey)?.numId || '00001';
        const { last } = splitNameLastFirst(m.athleteName);
        return `${numId}${idx + 1}${toAsciiField(last, 16)}`;
      });

      lines.push(finalizeHy3Line('F2', `${evField}${legParts.join('')}`));
    }
  }

  return `${lines.join('\r\n')}\r\n`;
}

function escapeHtml(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function openPrintableMeetDayPacketWindow(params: {
  teamName: string;
  meetTitle: string;
  entries: MeetEntryRecord[];
  partitionByDivision?: boolean;
}): boolean {
  if (typeof window === 'undefined') return false;
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return false;

  const auditRows = validateNfhsFourEventLimits(params.entries);
  const violations = auditRows.filter((r) => r.overLimit);
  const eventsPresent = Array.from(new Set(params.entries.map((e) => e.eventCode)));

  const sections = eventsPresent
    .map((code) => {
      const spec = ALL_MEET_DAY_EVENTS.find((s) => s.code === code);
      const eventEntries = params.entries.filter((e) => e.eventCode === code);
      const shouldPartition = resolveShouldPartition(eventEntries, params.partitionByDivision);
      const partitions = groupEntriesByPartition(eventEntries, shouldPartition);

      return partitions
        .map((part) => {
          const partHeading = shouldPartition ? ` — ${part.partitionLabel}` : '';
          if (spec?.category === 'FIELD') {
            const flights = seedFieldFlights(part.entries, code, 12, false);
            const rowsHtml = flights
              .map(
                (f) =>
                  `<tr><td>F${f.flightNumber} #${f.orderIndex}</td><td>${escapeHtml(f.athleteName)}</td><td>${escapeHtml(f.seedMark)}</td><td></td><td></td><td></td><td></td></tr>`
              )
              .join('');
            return `<h3>${escapeHtml(spec.label)}${escapeHtml(partHeading)} Flight Sheet</h3><table><thead><tr><th>Order</th><th>Athlete</th><th>Seed</th><th>T1</th><th>T2</th><th>T3</th><th>Best</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
          }
          const heats = seedTrackHeats(part.entries, code, spec?.defaultLanes || 8, false);
          const rowsHtml = heats
            .map(
              (h) =>
                `<tr><td>H${h.heatNumber} Ln ${h.lane}</td><td>${escapeHtml(h.athleteName)}</td><td>${escapeHtml(h.seedMark)}</td><td></td><td></td></tr>`
            )
            .join('');
          return `<h3>${escapeHtml(spec?.label || code)}${escapeHtml(partHeading)} Heat Sheet</h3><table><thead><tr><th>Heat / Lane</th><th>Athlete</th><th>Seed</th><th>Split</th><th>Finish FAT</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
        })
        .join('');
    })
    .join('');

  const html = `<!doctype html><html><head><title>${escapeHtml(params.meetTitle)} — MeetReady Meet Packet</title><style>body{font-family:system-ui,sans-serif;padding:20px;color:#111}h1,h2,h3{margin:12px 0 6px}table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px}th,td{border:1px solid #bbb;padding:5px 8px;text-align:left}.warn{background:#fee2e2;color:#991b1b;padding:8px 12px;border-radius:6px;margin-bottom:12px;font-weight:700}.no-print{margin-bottom:12px}@media print{.no-print{display:none!important}}</style></head><body><div class="no-print"><button type="button" onclick="window.print()" style="padding:8px 14px;font-weight:700;border-radius:8px;border:1px solid #999;background:#fff;cursor:pointer;">Print Meet Packet</button></div><h1>${escapeHtml(params.teamName)} — ${escapeHtml(params.meetTitle)}</h1><p>NFHS Rule 4-2 Compliance: ${violations.length === 0 ? 'All athletes within 4-event limit ✓' : `${violations.length} athlete(s) exceed 4-event cap`}</p>${violations.length > 0 ? `<div class="warn">Over 4 Events: ${violations.map((v) => `${escapeHtml(v.athleteName)} (${v.eventCount})`).join(', ')}</div>` : ''}${sections}</body></html>`;
  win.document.write(html);
  win.document.close();
  win.focus?.();
  win.print?.();
  return true;
}
