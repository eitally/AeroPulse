import { formatFieldMarkDual, parseFieldMarkToMeters } from './fieldEventsEngine';
import type {
  MeetAssignmentSource,
  MeetDayPacketEntryRecord,
  MeetSeedingAuthority,
  TeamMembershipRecord,
} from '../types';

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
  isAlternate?: boolean;
  scratched?: boolean;
  officialHeat?: number;
  officialLaneOrHip?: string;
  officialFlight?: number;
  officialOrder?: number;
  eventStartTime?: string;
  checkInCallTime?: string;
  bibNumber?: string;
  assignmentSource?: MeetAssignmentSource;
}

export interface NfhsEventLimitAuditRow {
  athleteId: string;
  athleteName: string;
  eventCount: number;
  events: string[];
  overLimit: boolean;
  alternateCount?: number;
  alternateEvents?: string[];
  hasAlternateAdvisory?: boolean;
}

export interface MeetHeatAssignment {
  heatNumber: number;
  lane: number;
  positionLabel?: string;
  isUnlanedBoxHip?: boolean;
  athleteId: string;
  athleteName: string;
  seedMark: string;
  seedSecs: number | null;
  genderDivision?: MeetGenderDivision;
  division?: string;
  partitionLabel?: string;
  isRelaySquad?: boolean;
  relayTeamCode?: string;
  relayLegs?: MeetEntryRecord[];
  relayAlternates?: MeetEntryRecord[];
  officialHeat?: number;
  officialLaneOrHip?: string;
  eventStartTime?: string;
  checkInCallTime?: string;
  bibNumber?: string;
  assignmentSource?: MeetAssignmentSource;
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
  officialFlight?: number;
  officialOrder?: number;
  eventStartTime?: string;
  checkInCallTime?: string;
  bibNumber?: string;
  assignmentSource?: MeetAssignmentSource;
}

export interface RelaySquadGroup {
  squadKey: string;
  eventCode: string;
  genderDivision?: MeetGenderDivision;
  division?: string;
  relayTeamCode: string;
  partitionLabel: string;
  seedMark: string;
  seedSecs: number | null;
  activeLegs: MeetEntryRecord[];
  alternates: MeetEntryRecord[];
  allMembers: MeetEntryRecord[];
  officialHeat?: number;
  officialLaneOrHip?: string;
  eventStartTime?: string;
  checkInCallTime?: string;
  bibNumber?: string;
  assignmentSource?: MeetAssignmentSource;
  representativeEntry: MeetEntryRecord;
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

export function isRelayEventCode(eventCode: string): boolean {
  const spec = ALL_MEET_DAY_EVENTS.find((e) => e.code.toLowerCase() === String(eventCode || '').trim().toLowerCase());
  if (spec) return spec.category === 'RELAY';
  return /^4x|^dmr|^smr/i.test(String(eventCode || '').trim());
}

export function isFieldEventCode(eventCode: string): boolean {
  const spec = ALL_MEET_DAY_EVENTS.find((e) => e.code.toLowerCase() === String(eventCode || '').trim().toLowerCase());
  return spec?.category === 'FIELD';
}

export function isUnlanedDistanceEvent(eventCode: string): boolean {
  const code = String(eventCode || '').trim().toLowerCase();
  if (code === '800m' || code === '1500m' || code === '1600m' || code === '1 mile' || code === 'mile') return true;
  if (code === '3000m' || code === '3200m' || code === '5000m' || code === '10000m') return true;
  if (code === '4x800m' || code === 'dmr') return true;
  const distMatch = code.match(/^(\d{3,5})m$/);
  if (distMatch && Number(distMatch[1]) >= 800) return true;
  return false;
}

export function formatOfficialLaneOrHip(eventCode: string, laneOrHip?: string): string {
  const clean = String(laneOrHip || '').trim();
  if (!clean) return '';
  if (/[a-z]/i.test(clean)) return clean;
  return isUnlanedDistanceEvent(eventCode) ? `Box/Hip ${clean}` : `Lane ${clean}`;
}

function assignmentSourceRank(source?: MeetAssignmentSource): number {
  if (source === 'CLERK_OVERRIDE') return 4;
  if (source === 'IMPORTED_ATHLETICLIVE') return 3;
  if (source === 'IMPORTED_HYTEK') return 2;
  if (source === 'LOCAL_HOST_SEED') return 1;
  return 0;
}

export function groupEntriesIntoRelaySquads(
  entries: MeetEntryRecord[],
  opts?: { includeScratched?: boolean }
): RelaySquadGroup[] {
  const includeScratched = opts?.includeScratched === true;
  const relayBuckets = new Map<string, MeetEntryRecord[]>();

  for (const entry of entries) {
    if (!includeScratched && entry.scratched) continue;
    if (!isRelayEventCode(entry.eventCode)) continue;
    const teamCode = (entry.relayTeamCode || 'A').trim().toUpperCase() || 'A';
    const cleanDiv = entry.division?.trim() || 'Varsity';
    const key = `${entry.eventCode}|${entry.genderDivision || 'OPEN'}|${cleanDiv.toLowerCase()}|${teamCode}`;
    const list = relayBuckets.get(key) || [];
    list.push(entry);
    relayBuckets.set(key, list);
  }

  const squads: RelaySquadGroup[] = [];
  for (const [squadKey, members] of relayBuckets.entries()) {
    const explicitAlternates = members.filter((m) => m.isAlternate === true);
    const activeCandidates = members
      .filter((m) => !m.isAlternate)
      .sort((a, b) => (a.relayLegOrder ?? 9) - (b.relayLegOrder ?? 9));

    const activeLegs = activeCandidates.slice(0, 4);
    const overflowAlternates = activeCandidates.slice(4);
    const alternates = [...explicitAlternates, ...overflowAlternates];
    if (activeLegs.length === 0 && alternates.length === 0) continue;

    const orderedAll = [...activeLegs, ...alternates];
    const representative = orderedAll[0];

    let bestSeedMark = representative.seedMark || 'NT';
    let bestSeedSecs = parseTrackSeedTimeToSecs(bestSeedMark);
    for (const member of orderedAll) {
      const candidateSecs = parseTrackSeedTimeToSecs(member.seedMark);
      if (candidateSecs !== null && (bestSeedSecs === null || candidateSecs < bestSeedSecs)) {
        bestSeedSecs = candidateSecs;
        bestSeedMark = member.seedMark;
      }
    }

    const bestAssigned = [...orderedAll].sort(
      (a, b) => assignmentSourceRank(b.assignmentSource) - assignmentSourceRank(a.assignmentSource)
    )[0];
    const pickFirstDefined = <T>(getter: (m: MeetEntryRecord) => T | undefined): T | undefined => {
      const fromBest = getter(bestAssigned);
      if (fromBest !== undefined && fromBest !== '') return fromBest;
      for (const m of orderedAll) {
        const val = getter(m);
        if (val !== undefined && val !== '') return val;
      }
      return undefined;
    };

    const gDiv = representative.genderDivision;
    const div = representative.division?.trim() || 'Varsity';
    const relayTeamCode = (representative.relayTeamCode || 'A').trim().toUpperCase() || 'A';

    squads.push({
      squadKey,
      eventCode: representative.eventCode,
      ...(gDiv ? { genderDivision: gDiv } : {}),
      division: div,
      relayTeamCode,
      partitionLabel: buildPartitionLabel(gDiv, div),
      seedMark: bestSeedMark || 'NT',
      seedSecs: bestSeedSecs,
      activeLegs,
      alternates,
      allMembers: orderedAll,
      officialHeat: pickFirstDefined((m) => m.officialHeat),
      officialLaneOrHip: pickFirstDefined((m) => m.officialLaneOrHip),
      eventStartTime: pickFirstDefined((m) => m.eventStartTime),
      checkInCallTime: pickFirstDefined((m) => m.checkInCallTime),
      bibNumber: pickFirstDefined((m) => m.bibNumber),
      assignmentSource: pickFirstDefined((m) => m.assignmentSource),
      representativeEntry: representative,
    });
  }

  return squads;
}

export function validateNfhsFourEventLimits(
  entries: MeetEntryRecord[],
  maxEventsPerAthlete = 4
): NfhsEventLimitAuditRow[] {
  const byAthlete = new Map<
    string,
    { name: string; events: string[]; alternateEvents: string[] }
  >();
  for (const e of entries) {
    if (e.scratched) continue;
    const key = (e.athleteId || e.athleteName).trim().toLowerCase();
    const bucket = byAthlete.get(key) || {
      name: e.athleteName,
      events: [],
      alternateEvents: [],
    };
    if (e.isAlternate) {
      bucket.alternateEvents.push(e.eventCode);
    } else {
      bucket.events.push(e.eventCode);
    }
    byAthlete.set(key, bucket);
  }
  return Array.from(byAthlete.entries())
    .map(([athleteId, info]) => {
      const eventCount = info.events.length;
      const alternateCount = info.alternateEvents.length;
      return {
        athleteId,
        athleteName: info.name,
        eventCount,
        events: info.events,
        overLimit: eventCount > maxEventsPerAthlete,
        ...(alternateCount > 0
          ? {
              alternateCount,
              alternateEvents: info.alternateEvents,
              hasAlternateAdvisory: eventCount + alternateCount > maxEventsPerAthlete,
            }
          : {}),
      };
    })
    .sort((a, b) => {
      if (a.overLimit !== b.overLimit) return a.overLimit ? -1 : 1;
      const aAdv = Boolean(a.hasAlternateAdvisory);
      const bAdv = Boolean(b.hasAlternateAdvisory);
      if (aAdv !== bAdv) return aAdv ? -1 : 1;
      return b.eventCount - a.eventCount || a.athleteName.localeCompare(b.athleteName);
    });
}

function formatRelaySquadLabel(squad: RelaySquadGroup): string {
  const legsText = squad.activeLegs
    .map((leg, idx) => `${leg.relayLegOrder || idx + 1}. ${leg.athleteName}`)
    .join(' · ');
  const altText =
    squad.alternates.length > 0
      ? ` · Alt: ${squad.alternates.map((a) => a.athleteName).join(', ')}`
      : '';
  return `Team ${squad.relayTeamCode}${legsText ? ` (${legsText}${altText})` : ''}`;
}

export function seedTrackHeats(
  entries: MeetEntryRecord[],
  eventCode: string,
  lanesPerHeat = 8,
  partitionOption?: SeedPartitionOption,
  opts?: { slowToFast?: boolean; includeScratched?: boolean }
): MeetHeatAssignment[] {
  const includeScratched = opts?.includeScratched === true;
  const isRelay = isRelayEventCode(eventCode);
  const matching = entries.filter(
    (e) =>
      e.eventCode === eventCode &&
      (includeScratched || !e.scratched) &&
      (isRelay || !e.isAlternate)
  );
  if (matching.length === 0) return [];

  const shouldPartition = resolveShouldPartition(matching, partitionOption);
  const buckets = groupEntriesByPartition(matching, shouldPartition);
  const cap = Math.max(2, Math.min(20, lanesPerHeat));
  const slowToFast = opts?.slowToFast === true;
  const unlaned = isUnlanedDistanceEvent(eventCode);
  const allAssignments: MeetHeatAssignment[] = [];

  for (const bucket of buckets) {
    interface SeedSlot {
      athleteId: string;
      athleteName: string;
      seedMark: string;
      seedSecs: number | null;
      genderDivision?: MeetGenderDivision;
      division?: string;
      isRelaySquad?: boolean;
      relayTeamCode?: string;
      relayLegs?: MeetEntryRecord[];
      relayAlternates?: MeetEntryRecord[];
      officialHeat?: number;
      officialLaneOrHip?: string;
      eventStartTime?: string;
      checkInCallTime?: string;
      bibNumber?: string;
      assignmentSource?: MeetAssignmentSource;
    }

    const slots: SeedSlot[] = isRelay
      ? groupEntriesIntoRelaySquads(bucket.entries, { includeScratched }).map((sq) => ({
          athleteId: sq.representativeEntry.athleteId,
          athleteName: formatRelaySquadLabel(sq),
          seedMark: sq.seedMark,
          seedSecs: sq.seedSecs,
          genderDivision: sq.genderDivision || bucket.genderDivision,
          division: sq.division || bucket.division,
          isRelaySquad: true,
          relayTeamCode: sq.relayTeamCode,
          relayLegs: sq.activeLegs,
          relayAlternates: sq.alternates,
          officialHeat: sq.officialHeat,
          officialLaneOrHip: sq.officialLaneOrHip,
          eventStartTime: sq.eventStartTime,
          checkInCallTime: sq.checkInCallTime,
          bibNumber: sq.bibNumber,
          assignmentSource: sq.assignmentSource,
        }))
      : bucket.entries.map((e) => ({
          athleteId: e.athleteId,
          athleteName: e.athleteName,
          seedMark: e.seedMark || 'NT',
          seedSecs: parseTrackSeedTimeToSecs(e.seedMark),
          genderDivision: e.genderDivision || bucket.genderDivision,
          division: e.division?.trim() || bucket.division,
          officialHeat: e.officialHeat,
          officialLaneOrHip: e.officialLaneOrHip,
          eventStartTime: e.eventStartTime,
          checkInCallTime: e.checkInCallTime,
          bibNumber: e.bibNumber,
          assignmentSource: e.assignmentSource,
        }));

    if (slots.length === 0) continue;

    // Sort fastest-first (NT / null at the end)
    const fastSorted = [...slots].sort((a, b) => {
      if (a.seedSecs === null && b.seedSecs === null) {
        return a.athleteName.localeCompare(b.athleteName);
      }
      if (a.seedSecs === null) return 1;
      if (b.seedSecs === null) return -1;
      return a.seedSecs - b.seedSecs || a.athleteName.localeCompare(b.athleteName);
    });

    const totalHeats = Math.max(1, Math.ceil(fastSorted.length / cap));
    const bucketAssignments: MeetHeatAssignment[] = [];
    for (let i = 0; i < fastSorted.length; i++) {
      const heatIndexFromFastest = Math.floor(i / cap);
      const heatNumber = slowToFast
        ? totalHeats - heatIndexFromFastest
        : heatIndexFromFastest + 1;
      const posInHeat = i % cap;
      const lane =
        cap <= 8 && !unlaned
          ? PREFERRED_LANE_ORDER[posInHeat] ?? posInHeat + 1
          : posInHeat + 1;
      const row = fastSorted[i];
      const positionLabel = unlaned ? `Box/Hip ${lane}` : `Lane ${lane}`;
      bucketAssignments.push({
        heatNumber,
        lane,
        positionLabel,
        isUnlanedBoxHip: unlaned,
        athleteId: row.athleteId,
        athleteName: row.athleteName,
        seedMark: row.seedMark || 'NT',
        seedSecs: row.seedSecs,
        ...(row.genderDivision ? { genderDivision: row.genderDivision } : {}),
        ...(row.division ? { division: row.division } : {}),
        ...(shouldPartition ? { partitionLabel: bucket.partitionLabel } : {}),
        ...(row.isRelaySquad
          ? {
              isRelaySquad: true,
              relayTeamCode: row.relayTeamCode,
              relayLegs: row.relayLegs,
              relayAlternates: row.relayAlternates,
            }
          : {}),
        ...(row.officialHeat !== undefined ? { officialHeat: row.officialHeat } : {}),
        ...(row.officialLaneOrHip ? { officialLaneOrHip: row.officialLaneOrHip } : {}),
        ...(row.eventStartTime ? { eventStartTime: row.eventStartTime } : {}),
        ...(row.checkInCallTime ? { checkInCallTime: row.checkInCallTime } : {}),
        ...(row.bibNumber ? { bibNumber: row.bibNumber } : {}),
        ...(row.assignmentSource ? { assignmentSource: row.assignmentSource } : {}),
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
  const matching = entries.filter(
    (e) => e.eventCode === eventCode && !e.scratched && !e.isAlternate
  );
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
        ...(row.officialFlight !== undefined ? { officialFlight: row.officialFlight } : {}),
        ...(row.officialOrder !== undefined ? { officialOrder: row.officialOrder } : {}),
        ...(row.eventStartTime ? { eventStartTime: row.eventStartTime } : {}),
        ...(row.checkInCallTime ? { checkInCallTime: row.checkInCallTime } : {}),
        ...(row.bibNumber ? { bibNumber: row.bibNumber } : {}),
        ...(row.assignmentSource ? { assignmentSource: row.assignmentSource } : {}),
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
  const rows = params.entries
    .filter((entry) => !entry.scratched)
    .map((entry) => {
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
  const rows = entries
    .filter((entry) => !entry.scratched)
    .map((entry) => {
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
        escapeStandardCsvCell(entry.isAlternate ? 'ALT' : entry.relayLegOrder || ''),
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

  const activeEntries = params.entries.filter((e) => !e.scratched);

  // Deduplicate athletes for D1 records
  const athleteIndexMap = new Map<string, { numId: string; entry: MeetEntryRecord }>();
  let seq = 1;
  for (const entry of activeEntries) {
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

  for (const entry of activeEntries) {
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

  // Emit F1 / F2 using active legs 1-4 per relay squad (never spawning phantom B squads from alternates)
  for (const [bucketKey, members] of relayBuckets.entries()) {
    const [eventCode, gRaw, division, relayCode] = bucketKey.split('|');
    const gChar = gRaw === 'F' ? 'F' : gRaw === 'M' ? 'M' : 'X';
    const activeMembers = [...members]
      .filter((m) => !m.isAlternate)
      .sort((a, b) => (a.relayLegOrder ?? 9) - (b.relayLegOrder ?? 9));
    const quartet = (activeMembers.length > 0 ? activeMembers : members).slice(0, 4);
    const { seedStr, unitChar } = formatHy3SeedField(quartet[0], false);
    const evField = toAsciiField(eventCode, 10);
    const divField = toAsciiField(division, 12);
    const squadLetter = relayCode || 'A';

    lines.push(
      finalizeHy3Line(
        'F1',
        `${cleanTeamCode}${toAsciiField(squadLetter, 1)}  ${gChar}${gChar}${evField}${divField}${seedStr}${unitChar}`
      )
    );

    const legParts = [0, 1, 2, 3].map((idx) => {
      const m = quartet[idx];
      if (!m) return toAsciiField('', 22);
      const athleteKey = `${(m.athleteId || m.athleteName).toLowerCase()}|${m.genderDivision || 'X'}`;
      const numId = athleteIndexMap.get(athleteKey)?.numId || '00001';
      const { last } = splitNameLastFirst(m.athleteName);
      return `${numId}${idx + 1}${toAsciiField(last, 16)}`;
    });

    lines.push(finalizeHy3Line('F2', `${evField}${legParts.join('')}`));
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

function isSafeHttpOrHttpsUrl(rawUrl?: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function serializeMeetEntriesToPacketEntries(
  entries: MeetEntryRecord[]
): MeetDayPacketEntryRecord[] {
  return entries.map((e) => ({
    id: e.id,
    athleteName: e.athleteName,
    ...(e.athleteId ? { membershipId: e.athleteId } : {}),
    ...(e.genderDivision ? { genderDivision: e.genderDivision } : {}),
    ...(e.division ? { division: e.division } : {}),
    ...(e.graduationYear ? { graduationYear: e.graduationYear } : {}),
    eventCode: e.eventCode,
    seedMarkRaw: e.seedMark || 'NT',
    ...(e.relayTeamCode ? { relayTeamCode: e.relayTeamCode } : {}),
    ...(e.relayLegOrder ? { relayLegOrder: e.relayLegOrder } : {}),
    ...(e.isAlternate ? { isAlternate: true } : {}),
    ...(e.scratched ? { scratched: true } : {}),
    ...(typeof e.officialHeat === 'number' && Number.isFinite(e.officialHeat)
      ? { officialHeat: e.officialHeat }
      : {}),
    ...(e.officialLaneOrHip ? { officialLaneOrHip: e.officialLaneOrHip } : {}),
    ...(typeof e.officialFlight === 'number' && Number.isFinite(e.officialFlight)
      ? { officialFlight: e.officialFlight }
      : {}),
    ...(typeof e.officialOrder === 'number' && Number.isFinite(e.officialOrder)
      ? { officialOrder: e.officialOrder }
      : {}),
    ...(e.eventStartTime ? { eventStartTime: e.eventStartTime } : {}),
    ...(e.checkInCallTime ? { checkInCallTime: e.checkInCallTime } : {}),
    ...(e.bibNumber ? { bibNumber: e.bibNumber } : {}),
    ...(e.assignmentSource ? { assignmentSource: e.assignmentSource } : {}),
  }));
}

export function deserializePacketEntriesToMeetEntries(
  packetEntries: MeetDayPacketEntryRecord[]
): MeetEntryRecord[] {
  return packetEntries.map((p) => ({
    id: p.id,
    athleteId: p.membershipId || p.id,
    athleteName: p.athleteName,
    ...(p.genderDivision ? { genderDivision: p.genderDivision } : {}),
    ...(p.division ? { division: p.division } : {}),
    ...(p.graduationYear ? { graduationYear: p.graduationYear } : {}),
    eventCode: p.eventCode,
    seedMark: p.seedMarkRaw || 'NT',
    ...(p.relayTeamCode ? { relayTeamCode: p.relayTeamCode } : {}),
    ...(p.relayLegOrder ? { relayLegOrder: p.relayLegOrder } : {}),
    ...(p.isAlternate ? { isAlternate: true } : {}),
    ...(p.scratched ? { scratched: true } : {}),
    ...(typeof p.officialHeat === 'number' ? { officialHeat: p.officialHeat } : {}),
    ...(p.officialLaneOrHip ? { officialLaneOrHip: p.officialLaneOrHip } : {}),
    ...(typeof p.officialFlight === 'number' ? { officialFlight: p.officialFlight } : {}),
    ...(typeof p.officialOrder === 'number' ? { officialOrder: p.officialOrder } : {}),
    ...(p.eventStartTime ? { eventStartTime: p.eventStartTime } : {}),
    ...(p.checkInCallTime ? { checkInCallTime: p.checkInCallTime } : {}),
    ...(p.bibNumber ? { bibNumber: p.bibNumber } : {}),
    ...(p.assignmentSource ? { assignmentSource: p.assignmentSource } : {}),
  }));
}

export function parseMeetTimeToSortMinutes(rawTime?: string): number | null {
  const s = String(rawTime || '').trim();
  if (!s) return null;
  const ampmMatch = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampmMatch) {
    let hh = Number(ampmMatch[1]);
    const mm = Number(ampmMatch[2]);
    const meridiem = ampmMatch[3].toUpperCase();
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 1 || hh > 12 || mm < 0 || mm > 59) {
      return null;
    }
    if (meridiem === 'AM' && hh === 12) hh = 0;
    else if (meridiem === 'PM' && hh < 12) hh += 12;
    return hh * 60 + mm;
  }
  const h24Match = s.match(/^(\d{1,2}):(\d{2})$/);
  if (h24Match) {
    const hh = Number(h24Match[1]);
    const mm = Number(h24Match[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
      return null;
    }
    return hh * 60 + mm;
  }
  return null;
}

export function applyDelayToMeetTimeString(rawTime?: string, delayMinutes = 0): string {
  const clean = String(rawTime || '').trim();
  if (!clean) return '';
  const safeDelay = Number.isFinite(delayMinutes) ? Math.max(0, Math.round(delayMinutes)) : 0;
  if (safeDelay === 0) return clean;
  const baseMins = parseMeetTimeToSortMinutes(clean);
  if (baseMins === null) return `${clean} (+${safeDelay}m)`;
  const totalMins = (baseMins + safeDelay) % (24 * 60);
  const hh24 = Math.floor(totalMins / 60);
  const mm = totalMins % 60;
  const meridiem = hh24 >= 12 ? 'PM' : 'AM';
  const hh12 = hh24 === 0 ? 12 : hh24 > 12 ? hh24 - 12 : hh24;
  return `${hh12}:${String(mm).padStart(2, '0')} ${meridiem}`;
}

export interface ParsedExternalHeatAssignment {
  lineNumber: number;
  rawLine: string;
  eventCode: string;
  genderDivision?: MeetGenderDivision;
  division?: string;
  athleteName: string;
  matchedEntryId?: string;
  matchedMembershipId?: string;
  matchedAthleteName?: string;
  isRelaySquad?: boolean;
  relayTeamCode?: string;
  officialHeat?: number;
  officialLaneOrHip?: string;
  officialFlight?: number;
  officialOrder?: number;
  eventStartTime?: string;
  checkInCallTime?: string;
  bibNumber?: string;
  assignmentSource: MeetAssignmentSource;
}

export interface ExternalHeatSheetParseResult {
  detectedSource: 'IMPORTED_HYTEK' | 'IMPORTED_ATHLETICLIVE';
  matchedAssignments: ParsedExternalHeatAssignment[];
  unmatchedLines: string[];
  matchedEntryCount: number;
  newSuggestedEntriesCount: number;
  warnings: string[];
}

function normalizeAthleteNameTokens(rawName: string): string[] {
  let clean = String(rawName || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(?:FR|SO|JR|SR|GR|9|10|11|12)\b/gi, ' ')
    .replace(/['’`]/g, '')
    .trim();
  if (clean.includes(',')) {
    const [last, ...rest] = clean.split(',');
    clean = `${rest.join(' ')} ${last}`;
  }
  return clean
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function buildCanonicalNameSignature(rawName: string): string {
  const tokens = normalizeAthleteNameTokens(rawName);
  return tokens.join(' ');
}

function buildSortedTokenSignature(rawName: string): string {
  const tokens = normalizeAthleteNameTokens(rawName);
  return [...tokens].sort().join(' ');
}

function extractMeetEventCodeFromLine(
  line: string,
  genderHint?: MeetGenderDivision
): string | null {
  const s = String(line || '').trim();
  if (!s) return null;
  const g =
    /\b(?:girls?|women'?s?|female)\b/i.test(s)
      ? 'F'
      : /\b(?:boys?|men'?s?|male)\b/i.test(s)
        ? 'M'
        : genderHint;

  const patterns: Array<[RegExp, string]> = [
    [/\b4\s*[x×]\s*100\b/i, '4x100m'],
    [/\b4\s*[x×]\s*200\b/i, '4x200m'],
    [/\b4\s*[x×]\s*400\b/i, '4x400m'],
    [/\b4\s*[x×]\s*800\b/i, '4x800m'],
    [/\b(?:distance\s+medley|dmr)\b/i, 'DMR'],
    [/\b60\s*(?:m|meters?)?\s*(?:h|hurdles?)\b/i, '60mH'],
    [/\b100\s*(?:m|meters?)?\s*(?:h|hurdles?)\b/i, '100mH'],
    [/\b110\s*(?:m|meters?)?\s*(?:h|hurdles?)\b/i, g === 'F' ? '100mH' : '110mH'],
    [/\b300\s*(?:m|meters?)?\s*(?:h|hurdles?)\b/i, '300mH'],
    [/\b400\s*(?:m|meters?)?\s*(?:h|hurdles?)\b/i, '400mH'],
    [/\b60\s*(?:m|meters?)\b/i, '60m'],
    [/\b100\s*(?:m|meters?)\b/i, '100m'],
    [/\b200\s*(?:m|meters?)\b/i, '200m'],
    [/\b400\s*(?:m|meters?)\b/i, '400m'],
    [/\b800\s*(?:m|meters?)\b/i, '800m'],
    [/\b(?:1600\s*(?:m|meters?)|1\s*mile|mile)\b/i, '1600m'],
    [/\b(?:3200\s*(?:m|meters?)|2\s*mile)\b/i, '3200m'],
    [/\b(?:long\s+jump|lj)\b/i, 'LJ'],
    [/\b(?:triple\s+jump|tj)\b/i, 'TJ'],
    [/\b(?:high\s+jump|hj)\b/i, 'HJ'],
    [/\b(?:pole\s+vault|pv)\b/i, 'PV'],
    [/\b(?:shot\s+put|sp)\b/i, 'SP'],
    [/\bdiscus\b/i, 'DISCUS'],
    [/\bjavelin\b/i, 'JAVELIN'],
    [/\bhammer\b/i, 'HAMMER'],
  ];
  for (const [re, code] of patterns) {
    if (re.test(s)) return code;
  }
  return null;
}

function extractGenderFromLine(line: string): MeetGenderDivision | undefined {
  if (/\b(?:girls?|women'?s?|female)\b/i.test(line)) return 'F';
  if (/\b(?:boys?|men'?s?|male)\b/i.test(line)) return 'M';
  return undefined;
}

function extractDivisionFromLine(line: string): string | undefined {
  if (/\bfrosh\s*\/?\s*soph|\bf\/s\b|\bfreshman\b/i.test(line)) return 'Frosh/Soph';
  if (/\bjunior\s+varsity|\bjv\b/i.test(line)) return 'Junior Varsity';
  if (/\bvarsity\b/i.test(line)) return 'Varsity';
  return undefined;
}

function extractClockTimesFromLine(line: string): {
  startTime?: string;
  callTime?: string;
} {
  let callTime: string | undefined;
  let startTime: string | undefined;

  const callMatch = line.match(
    /(?:check[-\s]?in|call(?:\s*time)?)\s*[:@-]?\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i
  );
  if (callMatch) {
    callTime = callMatch[1].replace(/\s+/g, ' ').toUpperCase();
  }

  const withoutCall = callMatch ? line.replace(callMatch[0], ' ') : line;
  const startMatch = withoutCall.match(
    /(?:starts?(?:\s*at)?\s*[:@-]?\s*)?(\d{1,2}:\d{2}\s*(?:AM|PM))\b/i
  );
  if (startMatch) {
    startTime = startMatch[1].replace(/\s+/g, ' ').toUpperCase();
  }
  return { startTime, callTime };
}

function extractRosterMatchesForName(
  candidateName: string,
  eventCode: string | null,
  genderHint: MeetGenderDivision | undefined,
  teamEntries: MeetDayPacketEntryRecord[],
  memberships: TeamMembershipRecord[]
): Array<{
  matchedEntry?: MeetDayPacketEntryRecord;
  membership?: TeamMembershipRecord;
  displayName: string;
}> {
  const sig = buildCanonicalNameSignature(candidateName);
  const sortedSig = buildSortedTokenSignature(candidateName);
  if (!sig) return [];

  const tokens = sig.split(' ').filter(Boolean);
  const nameMatches = (targetName: string): boolean => {
    const tSig = buildCanonicalNameSignature(targetName);
    const tSorted = buildSortedTokenSignature(targetName);
    if (!tSig) return false;
    if (tSig === sig || tSorted === sortedSig) return true;
    // Allow first initial + last name unambiguous match (e.g. "D. Carter" -> "Devon Carter")
    if (tokens.length === 2 && tokens[0].length === 1) {
      const tTokens = tSig.split(' ');
      if (tTokens.length >= 2 && tTokens[0].startsWith(tokens[0]) && tTokens[tTokens.length - 1] === tokens[1]) {
        return true;
      }
    }
    return false;
  };

  const entryMatches = teamEntries.filter((e) => {
    if (!nameMatches(e.athleteName)) return false;
    if (genderHint && e.genderDivision && e.genderDivision !== genderHint) return false;
    return true;
  });

  if (entryMatches.length > 0) {
    const exactEventEntries = eventCode
      ? entryMatches.filter((e) => e.eventCode.toLowerCase() === eventCode.toLowerCase())
      : entryMatches;
    if (exactEventEntries.length > 0) {
      return exactEventEntries.map((e) => ({
        matchedEntry: e,
        membership: memberships.find((m) => m.membershipId === e.membershipId),
        displayName: e.athleteName,
      }));
    }
    const first = entryMatches[0];
    return [
      {
        membership: memberships.find((m) => m.membershipId === first.membershipId),
        displayName: first.athleteName,
      },
    ];
  }

  const memMatches = memberships.filter((m) => {
    if (m.role !== 'ATHLETE' || m.status === 'REVOKED' || m.status === 'ALUMNI') return false;
    if (!nameMatches(m.invitedName)) return false;
    if (genderHint && m.genderDivision && m.genderDivision !== genderHint) return false;
    return true;
  });
  if (memMatches.length === 1) {
    return [{ membership: memMatches[0], displayName: memMatches[0].invitedName }];
  }
  if (memMatches.length > 1) {
    // Only take exact full signature matches if initials collided
    const exact = memMatches.filter((m) => buildSortedTokenSignature(m.invitedName) === sortedSig);
    if (exact.length === 1) {
      return [{ membership: exact[0], displayName: exact[0].invitedName }];
    }
  }
  return [];
}

function isLikelyHeaderOrSeparatorLine(line: string): boolean {
  const t = line.trim();
  if (!t || /^[-=_*]{3,}$/.test(t)) return true;
  if (/^(?:lane|pos(?:\/hip)?|order)\s+.*athlete/i.test(t)) return true;
  if (/^top\s+\d+\s+advance/i.test(t)) return true;
  return false;
}

function cleanParsedAthleteCandidateName(rawSegment: string): string {
  return String(rawSegment || '')
    .replace(/\b(?:NT|NM|FOUL|NH|SCR|DNS|DNF|DQ)\b.*$/i, '')
    .replace(/\b\d{1,2}:\d{2}(?:\.\d{1,2})?[a-z]?\b.*$/i, '')
    .replace(/\b\d{1,2}-\d{2}(?:\.\d{1,2})?\b.*$/i, '')
    .replace(/\b\d{1,3}'\s*\d{1,2}(?:\.\d{1,2})?"?\b.*$/i, '')
    .replace(/\b\d{1,3}\.\d{2}[a-z]?\b.*$/i, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/#\d{1,6}/g, ' ')
    .replace(/\s{2,}|\t/g, '  ')
    .split(/\s{2,}/)[0]
    .trim();
}

export function parseExternalHeatSheetForRoster(
  rawText: string,
  teamEntries: MeetDayPacketEntryRecord[] = [],
  memberships: TeamMembershipRecord[] = []
): ExternalHeatSheetParseResult {
  const safeText = typeof rawText === 'string' ? rawText : '';
  const lines = safeText.split(/\r?\n/);

  const looksLikeEvt = lines.some((l) => /^\s*\d+\s*[,;]\s*\d+\s*[,;]\s*\d+\s*[,;]/.test(l));
  const looksLikeHyTek =
    looksLikeEvt ||
    /\bEvent\s+\d+\b/i.test(safeText) ||
    /={5,}/.test(safeText) ||
    /\bPrelims\b|\bFinals\b/i.test(safeText);
  const looksLikeAthleticLive =
    !looksLikeEvt &&
    (/\bathleticlive\b|\bathletic\.net\b|\bPos\/Hip\b|\bLn\s+\d+\b|\bOrder\s+\d+\b/i.test(
      safeText
    ) ||
      /·/.test(safeText));

  const detectedSource: 'IMPORTED_HYTEK' | 'IMPORTED_ATHLETICLIVE' =
    looksLikeAthleticLive && !looksLikeHyTek ? 'IMPORTED_ATHLETICLIVE' : 'IMPORTED_HYTEK';

  const matchedAssignments: ParsedExternalHeatAssignment[] = [];
  const unmatchedLines: string[] = [];
  const warnings: string[] = [];

  let currentEventCode: string | null = null;
  let currentGender: MeetGenderDivision | undefined;
  let currentDivision: string | undefined;
  let currentHeat: number | undefined;
  let currentFlight: number | undefined;
  let currentStartTime: string | undefined;
  let currentCallTime: string | undefined;
  let currentRelayTeamCode: string | undefined;
  let currentRelayLaneOrHip: string | undefined;

  const seenDedupe = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    try {
      const rawLine = lines[i];
      const line = rawLine.trim();
      if (!line || isLikelyHeaderOrSeparatorLine(line)) continue;

      // 1. FinishLynx .evt event header: eventNum,round,heat,eventName[,startTime]
      const evtHeaderMatch = line.match(
        /^(\d{1,4})\s*[,;]\s*(\d{1,2})\s*[,;]\s*(\d{1,3})\s*[,;]\s*([^,;]+)(?:[,;](.*))?$/
      );
      if (evtHeaderMatch) {
        const heatNum = Number(evtHeaderMatch[3]);
        const evTitle = evtHeaderMatch[4].trim();
        const extra = evtHeaderMatch[5] || '';
        const g = extractGenderFromLine(evTitle);
        const ev = extractMeetEventCodeFromLine(evTitle, g);
        if (ev) currentEventCode = ev;
        if (g) currentGender = g;
        const div = extractDivisionFromLine(evTitle);
        if (div) currentDivision = div;
        const times = extractClockTimesFromLine(`${evTitle} ${extra}`);
        currentStartTime = times.startTime;
        currentCallTime = times.callTime;
        if (currentEventCode && isFieldEventCode(currentEventCode)) {
          currentFlight = Number.isFinite(heatNum) && heatNum > 0 ? heatNum : 1;
          currentHeat = undefined;
        } else {
          currentHeat = Number.isFinite(heatNum) && heatNum > 0 ? heatNum : 1;
          currentFlight = undefined;
        }
        currentRelayTeamCode = undefined;
        currentRelayLaneOrHip = undefined;
        continue;
      }

      // 2. FinishLynx .evt athlete line: ,laneOrHip,bib,Last,First,School  OR  ,laneOrHip,bib,FullName,School
      if (/^[,;]/.test(line)) {
        const delim = line.includes(';') && !line.includes(',') ? ';' : ',';
        const cols = line.split(delim).map((c) => c.trim());
        const laneRaw = cols[1] || '';
        const bibRaw = cols[2] || '';
        const col3 = cols[3] || '';
        const col4 = cols[4] || '';
        const candidatesToTry = [col4 && col3 ? `${col4} ${col3}` : '', col3].filter(Boolean);
        let matchedAny = false;
        const evCode = currentEventCode || '100m';
        const isField = isFieldEventCode(evCode);

        for (const candName of candidatesToTry) {
          const matches = extractRosterMatchesForName(
            candName,
            evCode,
            currentGender,
            teamEntries,
            memberships
          );
          if (matches.length === 0) continue;
          for (const m of matches) {
            const laneNum = Number(laneRaw);
            const posFormatted = laneRaw
              ? isField
                ? undefined
                : formatOfficialLaneOrHip(evCode, laneRaw)
              : undefined;
            const dedupeKey = `${m.matchedEntry?.id || m.membership?.membershipId || m.displayName}|${evCode}|${currentHeat || currentFlight || 0}|${laneRaw}`;
            if (seenDedupe.has(dedupeKey)) {
              matchedAny = true;
              continue;
            }
            seenDedupe.add(dedupeKey);
            matchedAssignments.push({
              lineNumber: i + 1,
              rawLine: line,
              eventCode: m.matchedEntry?.eventCode || evCode,
              genderDivision: m.matchedEntry?.genderDivision || currentGender,
              division: m.matchedEntry?.division || currentDivision,
              athleteName: m.displayName,
              ...(m.matchedEntry ? { matchedEntryId: m.matchedEntry.id } : {}),
              ...(m.membership?.membershipId
                ? { matchedMembershipId: m.membership.membershipId }
                : m.matchedEntry?.membershipId
                  ? { matchedMembershipId: m.matchedEntry.membershipId }
                  : {}),
              matchedAthleteName: m.displayName,
              ...(isField
                ? {
                    officialFlight: currentFlight || 1,
                    ...(Number.isFinite(laneNum) && laneNum > 0
                      ? { officialOrder: laneNum }
                      : {}),
                  }
                : {
                    officialHeat: currentHeat || 1,
                    ...(posFormatted ? { officialLaneOrHip: posFormatted } : {}),
                  }),
              ...(currentStartTime ? { eventStartTime: currentStartTime } : {}),
              ...(currentCallTime ? { checkInCallTime: currentCallTime } : {}),
              ...(bibRaw ? { bibNumber: bibRaw } : {}),
              assignmentSource: 'IMPORTED_HYTEK',
            });
            matchedAny = true;
          }
          if (matchedAny) break;
        }
        if (!matchedAny) unmatchedLines.push(line);
        continue;
      }

      // 3. Detect Event / Section / Heat / Flight header lines
      const headerTimes = extractClockTimesFromLine(line);
      if (headerTimes.callTime) currentCallTime = headerTimes.callTime;
      if (headerTimes.startTime && (/^\s*(?:Event|Heat|Section|Flight|Start|Check[-\s]?in|Call)/i.test(line) || /·/.test(line))) {
        currentStartTime = headerTimes.startTime;
      }

      const detectedEv = extractMeetEventCodeFromLine(line, currentGender);
      const isExplicitEventHeader =
        /^Event\s+\d+/i.test(line) ||
        (detectedEv !== null &&
          (/\b(?:Boys?|Girls?|Men|Women|Varsity|Junior Varsity|JV|Frosh|Relay|Dash|Run|Hurdles|Jump|Vault|Put|Discus|Javelin|Hammer)\b/i.test(
            line
          ) ||
            /·/.test(line)));

      if (isExplicitEventHeader && detectedEv) {
        currentEventCode = detectedEv;
        const g = extractGenderFromLine(line);
        if (g) currentGender = g;
        const div = extractDivisionFromLine(line);
        if (div) currentDivision = div;
        currentHeat = undefined;
        currentFlight = undefined;
        currentRelayTeamCode = undefined;
        currentRelayLaneOrHip = undefined;
        const inlineTimes = extractClockTimesFromLine(line);
        currentStartTime = inlineTimes.startTime;
        currentCallTime = inlineTimes.callTime;
      }

      const heatHeaderMatch = line.match(/\b(?:Heat|Section)\s+(\d{1,3})\b/i);
      if (heatHeaderMatch) {
        currentHeat = Number(heatHeaderMatch[1]);
        currentFlight = undefined;
        currentRelayTeamCode = undefined;
        currentRelayLaneOrHip = undefined;
        const ht = extractClockTimesFromLine(line);
        if (ht.startTime) currentStartTime = ht.startTime;
        if (ht.callTime) currentCallTime = ht.callTime;
        // If this line was just a header (no athlete tokens after heat/time), continue
        if (/^(?:Heat|Section)\s+\d+/i.test(line) || isExplicitEventHeader) {
          continue;
        }
      }

      const flightHeaderMatch = line.match(/\bFlight\s+(\d{1,3})\b/i);
      if (flightHeaderMatch) {
        currentFlight = Number(flightHeaderMatch[1]);
        currentHeat = undefined;
        const ft = extractClockTimesFromLine(line);
        if (ft.startTime) currentStartTime = ft.startTime;
        if (ft.callTime) currentCallTime = ft.callTime;
        if (/^Flight\s+\d+/i.test(line) || isExplicitEventHeader) {
          continue;
        }
      }

      if (isExplicitEventHeader) continue;

      if (/^(?:Start\s*Time|Check[-\s]?in|Call\s*Time)(?:\s*[:@-]|\s+)/i.test(line)) {
        const tm = extractClockTimesFromLine(line);
        if (tm.startTime) currentStartTime = tm.startTime;
        if (tm.callTime) currentCallTime = tm.callTime;
        continue;
      }

      // 4. Relay squad line (e.g. "Lane 4  Willow Glen 'A'  42.85") followed by legs line ("1) Carter, Devon  2) Lee, Noah ...")
      if (currentEventCode && isRelayEventCode(currentEventCode)) {
        const relaySquadLineMatch = line.match(
          /^(?:(?:Lane|Ln|Hip|Box|Pos)\s*#?\s*)?(\d{1,2})\s+.+?\s+['"]([A-Z])['"]/i
        );
        if (relaySquadLineMatch) {
          currentRelayLaneOrHip = formatOfficialLaneOrHip(
            currentEventCode,
            relaySquadLineMatch[1]
          );
          currentRelayTeamCode = relaySquadLineMatch[2].toUpperCase();
          continue;
        }

        if (/\b1\)\s*/.test(line) && currentRelayLaneOrHip) {
          const legMatches = Array.from(line.matchAll(/(\d)\)\s*([^0-9\n]+?)(?=\s+\d\)|$)/g));
          let anyLegMatched = false;
          for (const lm of legMatches) {
            const rawLegName = cleanParsedAthleteCandidateName(lm[2]);
            const matches = extractRosterMatchesForName(
              rawLegName,
              currentEventCode,
              currentGender,
              teamEntries,
              memberships
            );
            for (const m of matches) {
              const dedupeKey = `${m.matchedEntry?.id || m.membership?.membershipId || m.displayName}|${currentEventCode}|${currentHeat || 1}|${currentRelayLaneOrHip}`;
              if (seenDedupe.has(dedupeKey)) {
                anyLegMatched = true;
                continue;
              }
              seenDedupe.add(dedupeKey);
              matchedAssignments.push({
                lineNumber: i + 1,
                rawLine: line,
                eventCode: m.matchedEntry?.eventCode || currentEventCode,
                genderDivision: m.matchedEntry?.genderDivision || currentGender,
                division: m.matchedEntry?.division || currentDivision,
                athleteName: m.displayName,
                ...(m.matchedEntry ? { matchedEntryId: m.matchedEntry.id } : {}),
                ...(m.membership?.membershipId
                  ? { matchedMembershipId: m.membership.membershipId }
                  : m.matchedEntry?.membershipId
                    ? { matchedMembershipId: m.matchedEntry.membershipId }
                    : {}),
                matchedAthleteName: m.displayName,
                isRelaySquad: true,
                relayTeamCode: m.matchedEntry?.relayTeamCode || currentRelayTeamCode,
                officialHeat: currentHeat || 1,
                officialLaneOrHip: currentRelayLaneOrHip,
                ...(currentStartTime ? { eventStartTime: currentStartTime } : {}),
                ...(currentCallTime ? { checkInCallTime: currentCallTime } : {}),
                assignmentSource: detectedSource,
              });
              anyLegMatched = true;
            }
          }
          if (!anyLegMatched) unmatchedLines.push(line);
          continue;
        }
      }

      // 5. Athlete entry row in Heat / Flight table
      const pipeCols = line.includes('|') ? line.split('|').map((p) => p.trim()) : null;
      if (pipeCols && pipeCols.length >= 3) {
        const joinedLine = pipeCols.join('  ');
        const inlineEvent = extractMeetEventCodeFromLine(joinedLine, currentGender) || currentEventCode;
        const inlineHeat = joinedLine.match(/\b(?:Heat|H)\s*(\d{1,2})\b/i)?.[1];
        const inlineFlight = joinedLine.match(/\b(?:Flight|F)\s*(\d{1,2})\b/i)?.[1];
        const inlineLane = joinedLine.match(
          /\b(Lane|Ln|Hip|Box|Alley|Order)\s*#?\s*(\d{1,2})\b/i
        );
        const inlineBib = joinedLine.match(/#(\d{2,6})\b/)?.[1];
        const rowTimes = extractClockTimesFromLine(joinedLine);
        if (inlineEvent) {
          let matchedPipe = false;
          for (const col of pipeCols) {
            const matches = extractRosterMatchesForName(
              col,
              inlineEvent,
              currentGender,
              teamEntries,
              memberships
            );
            if (matches.length === 0) continue;
            for (const m of matches) {
              const isField = isFieldEventCode(inlineEvent);
              const heatVal = inlineHeat ? Number(inlineHeat) : currentHeat;
              const flightVal = inlineFlight ? Number(inlineFlight) : currentFlight;
              const posRaw = inlineLane
                ? inlineLane[1].toLowerCase().startsWith('hip')
                  ? `Hip ${inlineLane[2]}`
                  : inlineLane[1].toLowerCase().startsWith('box')
                    ? `Box ${inlineLane[2]}`
                    : inlineLane[1].toLowerCase().startsWith('alley')
                      ? `Alley ${inlineLane[2]}`
                      : formatOfficialLaneOrHip(inlineEvent, inlineLane[2])
                : undefined;
              const dedupeKey = `${m.matchedEntry?.id || m.membership?.membershipId || m.displayName}|${inlineEvent}|${heatVal || flightVal || 0}|${posRaw || ''}`;
              if (seenDedupe.has(dedupeKey)) {
                matchedPipe = true;
                continue;
              }
              seenDedupe.add(dedupeKey);
              matchedAssignments.push({
                lineNumber: i + 1,
                rawLine: line,
                eventCode: m.matchedEntry?.eventCode || inlineEvent,
                genderDivision: m.matchedEntry?.genderDivision || currentGender,
                division: m.matchedEntry?.division || currentDivision,
                athleteName: m.displayName,
                ...(m.matchedEntry ? { matchedEntryId: m.matchedEntry.id } : {}),
                ...(m.membership?.membershipId
                  ? { matchedMembershipId: m.membership.membershipId }
                  : m.matchedEntry?.membershipId
                    ? { matchedMembershipId: m.matchedEntry.membershipId }
                    : {}),
                matchedAthleteName: m.displayName,
                ...(isField
                  ? {
                      officialFlight: flightVal || 1,
                      ...(inlineLane ? { officialOrder: Number(inlineLane[2]) } : {}),
                    }
                  : {
                      ...(heatVal ? { officialHeat: heatVal } : {}),
                      ...(posRaw ? { officialLaneOrHip: posRaw } : {}),
                    }),
                ...(rowTimes.startTime || currentStartTime
                  ? { eventStartTime: rowTimes.startTime || currentStartTime }
                  : {}),
                ...(rowTimes.callTime || currentCallTime
                  ? { checkInCallTime: rowTimes.callTime || currentCallTime }
                  : {}),
                ...(inlineBib ? { bibNumber: inlineBib } : {}),
                assignmentSource: detectedSource,
              });
              matchedPipe = true;
            }
          }
          if (!matchedPipe) unmatchedLines.push(line);
          continue;
        }
      }

      const rowMatch = line.match(
        /^(?:(Box\/Hip|Pos\/Hip|Lane|Ln|Hip|Box|Alley|Order|Pos)\s*#?\s*)?(\d{1,2})\s+(?:#?(\d{2,6})\s+)?(.+)$/i
      );
      if (rowMatch) {
        const keyword = (rowMatch[1] || '').toLowerCase();
        const posNum = rowMatch[2];
        const rest = rowMatch[4];
        const bibNum =
          rowMatch[3] || rest.match(/\b(?:Bib\s*#?|#)\s*(\d{2,6})\b/i)?.[1];
        const evCode = extractMeetEventCodeFromLine(rest, currentGender) || currentEventCode;
        if (!evCode) {
          unmatchedLines.push(line);
          continue;
        }
        const candName = cleanParsedAthleteCandidateName(rest);
        const matches = extractRosterMatchesForName(
          candName,
          evCode,
          currentGender,
          teamEntries,
          memberships
        );
        if (matches.length === 0) {
          unmatchedLines.push(line);
          continue;
        }
        const isField = isFieldEventCode(evCode) || currentFlight !== undefined || keyword === 'order';
        const posLabel =
          keyword === 'hip'
            ? `Hip ${posNum}`
            : keyword === 'box'
              ? `Box ${posNum}`
              : keyword === 'alley'
                ? `Alley ${posNum}`
                : formatOfficialLaneOrHip(evCode, posNum);
        const rowTimes = extractClockTimesFromLine(line);
        for (const m of matches) {
          const dedupeKey = `${m.matchedEntry?.id || m.membership?.membershipId || m.displayName}|${evCode}|${currentHeat || currentFlight || 0}|${posNum}`;
          if (seenDedupe.has(dedupeKey)) continue;
          seenDedupe.add(dedupeKey);
          matchedAssignments.push({
            lineNumber: i + 1,
            rawLine: line,
            eventCode: m.matchedEntry?.eventCode || evCode,
            genderDivision: m.matchedEntry?.genderDivision || currentGender,
            division: m.matchedEntry?.division || currentDivision,
            athleteName: m.displayName,
            ...(m.matchedEntry ? { matchedEntryId: m.matchedEntry.id } : {}),
            ...(m.membership?.membershipId
              ? { matchedMembershipId: m.membership.membershipId }
              : m.matchedEntry?.membershipId
                ? { matchedMembershipId: m.matchedEntry.membershipId }
                : {}),
            matchedAthleteName: m.displayName,
            ...(isField
              ? {
                  officialFlight: currentFlight || 1,
                  officialOrder: Number(posNum),
                }
              : {
                  officialHeat: currentHeat || 1,
                  officialLaneOrHip: posLabel,
                }),
            ...(rowTimes.startTime || currentStartTime
              ? { eventStartTime: rowTimes.startTime || currentStartTime }
              : {}),
            ...(rowTimes.callTime || currentCallTime
              ? { checkInCallTime: rowTimes.callTime || currentCallTime }
              : {}),
            ...(bibNum ? { bibNumber: bibNum } : {}),
            assignmentSource: detectedSource,
          });
        }
        continue;
      }

      // Fallback: inline "H2 Ln 4 Devon Carter"
      const inlineHMatch = line.match(/\bH(\d{1,2})\s*(?:Ln|L|Hip|Box)\s*(\d{1,2})\b/i);
      if (inlineHMatch) {
        const evCode = extractMeetEventCodeFromLine(line, currentGender) || currentEventCode;
        if (evCode) {
          const stripped = cleanParsedAthleteCandidateName(
            line.replace(inlineHMatch[0], ' ').replace(/\b\d+(?:m|mH)\b/gi, ' ')
          );
          const matches = extractRosterMatchesForName(
            stripped,
            evCode,
            currentGender,
            teamEntries,
            memberships
          );
          if (matches.length > 0) {
            for (const m of matches) {
              matchedAssignments.push({
                lineNumber: i + 1,
                rawLine: line,
                eventCode: m.matchedEntry?.eventCode || evCode,
                genderDivision: m.matchedEntry?.genderDivision || currentGender,
                division: m.matchedEntry?.division || currentDivision,
                athleteName: m.displayName,
                ...(m.matchedEntry ? { matchedEntryId: m.matchedEntry.id } : {}),
                ...(m.membership?.membershipId
                  ? { matchedMembershipId: m.membership.membershipId }
                  : {}),
                matchedAthleteName: m.displayName,
                officialHeat: Number(inlineHMatch[1]),
                officialLaneOrHip: formatOfficialLaneOrHip(evCode, inlineHMatch[2]),
                ...(currentStartTime ? { eventStartTime: currentStartTime } : {}),
                ...(currentCallTime ? { checkInCallTime: currentCallTime } : {}),
                assignmentSource: detectedSource,
              });
            }
            continue;
          }
        }
      }

      unmatchedLines.push(line);
    } catch {
      // Defensive non-throwing line boundary
    }
  }

  if (matchedAssignments.length === 0 && safeText.trim().length > 0) {
    warnings.push('No team roster athletes matched the pasted heat sheet lines.');
  }

  const matchedEntryCount = matchedAssignments.filter((a) => Boolean(a.matchedEntryId)).length;
  const newSuggestedEntriesCount = matchedAssignments.filter(
    (a) => !a.matchedEntryId && Boolean(a.matchedMembershipId)
  ).length;

  return {
    detectedSource,
    matchedAssignments,
    unmatchedLines,
    matchedEntryCount,
    newSuggestedEntriesCount,
    warnings,
  };
}

export interface PrintableMeetDayPacketParams {
  teamName: string;
  meetTitle: string;
  meetDate?: string;
  entries: MeetEntryRecord[];
  partitionByDivision?: boolean;
  seedingAuthority?: MeetSeedingAuthority;
  athleticLiveUrl?: string;
  meetDelayMinutes?: number;
  showItinerary?: boolean;
}

function formatExternalTrackAssignmentCell(
  code: string,
  opts: {
    officialHeat?: number;
    officialLaneOrHip?: string;
  }
): string {
  const pos = opts.officialLaneOrHip ? formatOfficialLaneOrHip(code, opts.officialLaneOrHip) : '';
  if (opts.officialHeat && pos) return `H${opts.officialHeat} ${pos}`;
  if (opts.officialHeat) return `H${opts.officialHeat} TBD`;
  if (pos) return pos;
  return 'TBD (Official Program)';
}

function formatExternalFieldAssignmentCell(opts: {
  officialFlight?: number;
  officialOrder?: number;
}): string {
  if (opts.officialFlight && opts.officialOrder) {
    return `F${opts.officialFlight} #${opts.officialOrder}`;
  }
  if (opts.officialFlight) return `F${opts.officialFlight}`;
  return 'TBD (Official Program)';
}

export function buildMeetDayPacketHtml(params: PrintableMeetDayPacketParams): string {
  const seedingAuthority: MeetSeedingAuthority = params.seedingAuthority || 'HOST_DUAL_MEET';
  const delayMins = Math.max(0, Math.round(params.meetDelayMinutes || 0));
  const showItinerary = params.showItinerary !== false;
  const activeEntries = params.entries.filter((e) => !e.scratched);
  const auditRows = validateNfhsFourEventLimits(params.entries);
  const violations = auditRows.filter((r) => r.overLimit);
  const alternateAdvisories = auditRows.filter((r) => !r.overLimit && r.hasAlternateAdvisory);
  const eventsPresent = Array.from(new Set(activeEntries.map((e) => e.eventCode)));

  // 1. Chronological Meet Schedule
  interface ScheduleSummaryRow {
    eventCode: string;
    eventLabel: string;
    partitionLabel: string;
    callTime: string;
    startTime: string;
    sortMins: number;
    entryCount: number;
  }
  const scheduleRows: ScheduleSummaryRow[] = [];
  for (const code of eventsPresent) {
    const spec = ALL_MEET_DAY_EVENTS.find((s) => s.code === code);
    const eventEntries = activeEntries.filter((e) => e.eventCode === code);
    const shouldPartition = resolveShouldPartition(eventEntries, params.partitionByDivision);
    const partitions = groupEntriesByPartition(eventEntries, shouldPartition);
    for (const part of partitions) {
      const startRaw = part.entries.find((e) => e.eventStartTime)?.eventStartTime;
      const callRaw = part.entries.find((e) => e.checkInCallTime)?.checkInCallTime;
      const startDisp = applyDelayToMeetTimeString(startRaw, delayMins) || 'TBD';
      const callDisp = applyDelayToMeetTimeString(callRaw, delayMins) || '—';
      const baseSort = parseMeetTimeToSortMinutes(startRaw || callRaw);
      scheduleRows.push({
        eventCode: code,
        eventLabel: spec?.label || code,
        partitionLabel: shouldPartition ? part.partitionLabel : 'Open',
        callTime: callDisp,
        startTime: startDisp,
        sortMins: baseSort !== null ? baseSort + delayMins : 9999,
        entryCount: isRelayEventCode(code)
          ? groupEntriesIntoRelaySquads(part.entries).length
          : part.entries.filter((e) => !e.isAlternate).length,
      });
    }
  }
  scheduleRows.sort((a, b) => a.sortMins - b.sortMins || a.eventLabel.localeCompare(b.eventLabel));

  const scheduleHtml =
    scheduleRows.length > 0
      ? `<h2>Chronological Meet Schedule${delayMins > 0 ? ` (+${delayMins}m Delay Applied)` : ''}</h2><table><thead><tr><th>Start Time</th><th>Call Time</th><th>Event</th><th>Division</th><th>Entries</th></tr></thead><tbody>${scheduleRows
          .map(
            (r) =>
              `<tr><td>${escapeHtml(r.startTime)}</td><td>${escapeHtml(r.callTime)}</td><td>${escapeHtml(r.eventLabel)}</td><td>${escapeHtml(r.partitionLabel)}</td><td>${r.entryCount}</td></tr>`
          )
          .join('')}</tbody></table>`
      : '';

  // 2. Event Heat & Flight Sheets
  const sections = eventsPresent
    .map((code) => {
      const spec = ALL_MEET_DAY_EVENTS.find((s) => s.code === code);
      const eventEntries = activeEntries.filter((e) => e.eventCode === code);
      const shouldPartition = resolveShouldPartition(eventEntries, params.partitionByDivision);
      const partitions = groupEntriesByPartition(eventEntries, shouldPartition);

      return partitions
        .map((part) => {
          const partHeading = shouldPartition ? ` — ${part.partitionLabel}` : '';
          if (spec?.category === 'FIELD') {
            if (seedingAuthority === 'EXTERNAL_MEET') {
              const rows = [...part.entries]
                .filter((e) => !e.isAlternate)
                .sort((a, b) => {
                  const fa = a.officialFlight ?? 999;
                  const fb = b.officialFlight ?? 999;
                  return fa - fb || (a.officialOrder ?? 999) - (b.officialOrder ?? 999) || a.athleteName.localeCompare(b.athleteName);
                });
              const rowsHtml = rows
                .map((e) => {
                  const assignCell = formatExternalFieldAssignmentCell({
                    officialFlight: e.officialFlight,
                    officialOrder: e.officialOrder,
                  });
                  const timeCell = applyDelayToMeetTimeString(e.eventStartTime, delayMins) || '—';
                  return `<tr><td>${escapeHtml(assignCell)}</td><td>${escapeHtml(e.athleteName)}${e.bibNumber ? ` #${escapeHtml(e.bibNumber)}` : ''}</td><td>${escapeHtml(e.seedMark || 'NM')}</td><td>${escapeHtml(timeCell)}</td><td></td><td></td><td></td><td></td></tr>`;
                })
                .join('');
              return `<h3>${escapeHtml(spec.label)}${escapeHtml(partHeading)} Flight Sheet</h3><table><thead><tr><th>Flight / Order</th><th>Athlete</th><th>Seed</th><th>Time</th><th>T1</th><th>T2</th><th>T3</th><th>Best</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
            }
            const flights = seedFieldFlights(part.entries, code, 12, false);
            const rowsHtml = flights
              .map(
                (f) =>
                  `<tr><td>F${f.flightNumber} #${f.orderIndex}</td><td>${escapeHtml(f.athleteName)}</td><td>${escapeHtml(f.seedMark)}</td><td></td><td></td><td></td><td></td></tr>`
              )
              .join('');
            return `<h3>${escapeHtml(spec.label)}${escapeHtml(partHeading)} Flight Sheet</h3><table><thead><tr><th>Order</th><th>Athlete</th><th>Seed</th><th>T1</th><th>T2</th><th>T3</th><th>Best</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
          }

          if (seedingAuthority === 'EXTERNAL_MEET') {
            const isRelay = isRelayEventCode(code);
            const unlaned = isUnlanedDistanceEvent(code);
            const posHeading = unlaned ? 'Heat / Box-Hip' : 'Heat / Lane';
            if (isRelay) {
              const squads = groupEntriesIntoRelaySquads(part.entries);
              const rowsHtml = squads
                .sort((a, b) => (a.officialHeat ?? 999) - (b.officialHeat ?? 999) || a.relayTeamCode.localeCompare(b.relayTeamCode))
                .map((sq) => {
                  const assignCell = formatExternalTrackAssignmentCell(code, {
                    officialHeat: sq.officialHeat,
                    officialLaneOrHip: sq.officialLaneOrHip,
                  });
                  const callCell = applyDelayToMeetTimeString(sq.checkInCallTime, delayMins);
                  const startCell = applyDelayToMeetTimeString(sq.eventStartTime, delayMins);
                  const timeLabel = [callCell ? `Call ${callCell}` : '', startCell ? `Run ${startCell}` : '']
                    .filter(Boolean)
                    .join(' · ') || '—';
                  return `<tr><td>${escapeHtml(assignCell)}</td><td>${escapeHtml(formatRelaySquadLabel(sq))}</td><td>${escapeHtml(sq.seedMark)}</td><td>${escapeHtml(timeLabel)}</td><td></td></tr>`;
                })
                .join('');
              return `<h3>${escapeHtml(spec?.label || code)}${escapeHtml(partHeading)} Heat Sheet</h3><table><thead><tr><th>${posHeading}</th><th>Relay Squad</th><th>Seed</th><th>Call / Start</th><th>Finish FAT</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
            }

            const rows = [...part.entries]
              .filter((e) => !e.isAlternate)
              .sort((a, b) => {
                const ha = a.officialHeat ?? 999;
                const hb = b.officialHeat ?? 999;
                return ha - hb || a.athleteName.localeCompare(b.athleteName);
              });
            const rowsHtml = rows
              .map((e) => {
                const assignCell = formatExternalTrackAssignmentCell(code, {
                  officialHeat: e.officialHeat,
                  officialLaneOrHip: e.officialLaneOrHip,
                });
                const callCell = applyDelayToMeetTimeString(e.checkInCallTime, delayMins);
                const startCell = applyDelayToMeetTimeString(e.eventStartTime, delayMins);
                const timeLabel = [callCell ? `Call ${callCell}` : '', startCell ? `Run ${startCell}` : '']
                  .filter(Boolean)
                  .join(' · ') || '—';
                return `<tr><td>${escapeHtml(assignCell)}</td><td>${escapeHtml(e.athleteName)}${e.bibNumber ? ` #${escapeHtml(e.bibNumber)}` : ''}</td><td>${escapeHtml(e.seedMark || 'NT')}</td><td>${escapeHtml(timeLabel)}</td><td></td></tr>`;
              })
              .join('');
            return `<h3>${escapeHtml(spec?.label || code)}${escapeHtml(partHeading)} Heat Sheet</h3><table><thead><tr><th>${posHeading}</th><th>Athlete</th><th>Seed</th><th>Call / Start</th><th>Finish FAT</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
          }

          // HOST_DUAL_MEET mode
          const heats = seedTrackHeats(part.entries, code, spec?.defaultLanes || 8, false);
          const unlaned = isUnlanedDistanceEvent(code);
          const posHeading = unlaned ? 'Heat / Box-Hip' : 'Heat / Lane';
          const rowsHtml = heats
            .map((h) => {
              const slotLabel =
                h.officialHeat !== undefined || h.officialLaneOrHip
                  ? formatExternalTrackAssignmentCell(code, {
                      officialHeat: h.officialHeat ?? h.heatNumber,
                      officialLaneOrHip: h.officialLaneOrHip || String(h.lane),
                    })
                  : `H${h.heatNumber} ${unlaned ? `Box/Hip ${h.lane}` : `Ln ${h.lane}`}`;
              return `<tr><td>${escapeHtml(slotLabel)}</td><td>${escapeHtml(h.athleteName)}</td><td>${escapeHtml(h.seedMark)}</td><td></td><td></td></tr>`;
            })
            .join('');
          return `<h3>${escapeHtml(spec?.label || code)}${escapeHtml(partHeading)} Heat Sheet</h3><table><thead><tr><th>${posHeading}</th><th>Athlete</th><th>Seed</th><th>Split</th><th>Finish FAT</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
        })
        .join('');
    })
    .join('');

  // 3. Athlete-by-Athlete Itinerary
  let itineraryHtml = '';
  if (showItinerary && activeEntries.length > 0) {
    const byAthlete = new Map<string, { name: string; rows: MeetEntryRecord[] }>();
    for (const e of activeEntries) {
      const key = (e.athleteId || e.athleteName).toLowerCase();
      const bucket = byAthlete.get(key) || { name: e.athleteName, rows: [] };
      bucket.rows.push(e);
      byAthlete.set(key, bucket);
    }
    const sortedAthletes = Array.from(byAthlete.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const itinRowsHtml = sortedAthletes
      .flatMap((ath) =>
        ath.rows.map((e, idx) => {
          const isField = isFieldEventCode(e.eventCode);
          let posCell = 'TBD (Official Program)';
          if (isField) {
            posCell =
              e.officialFlight !== undefined
                ? formatExternalFieldAssignmentCell({
                    officialFlight: e.officialFlight,
                    officialOrder: e.officialOrder,
                  })
                : seedingAuthority === 'HOST_DUAL_MEET'
                  ? 'Host Seeded Flight'
                  : 'TBD (Official Program)';
          } else if (e.officialHeat !== undefined || e.officialLaneOrHip) {
            posCell = formatExternalTrackAssignmentCell(e.eventCode, {
              officialHeat: e.officialHeat,
              officialLaneOrHip: e.officialLaneOrHip,
            });
          } else if (seedingAuthority === 'HOST_DUAL_MEET') {
            posCell = 'Host Seeded Heat';
          }
          const callStr = applyDelayToMeetTimeString(e.checkInCallTime, delayMins) || '—';
          const startStr = applyDelayToMeetTimeString(e.eventStartTime, delayMins) || 'TBD';
          const eventDisp = `${e.eventCode}${e.relayTeamCode ? ` (${e.relayTeamCode}${e.isAlternate ? ' ALT' : e.relayLegOrder ? ` #${e.relayLegOrder}` : ''})` : e.isAlternate ? ' (ALT)' : ''}`;
          return `<tr><td>${idx === 0 ? `<strong>${escapeHtml(ath.name)}</strong>` : ''}</td><td>${escapeHtml(eventDisp)}</td><td>${escapeHtml(posCell)}</td><td>${escapeHtml(callStr)}</td><td>${escapeHtml(startStr)}</td><td>${escapeHtml(e.seedMark || 'NT')}</td></tr>`;
        })
      )
      .join('');
    itineraryHtml = `<h2>Athlete-by-Athlete Itinerary</h2><table><thead><tr><th>Athlete</th><th>Event</th><th>Heat / Flight / Slot</th><th>Call Time</th><th>Start Time</th><th>Seed</th></tr></thead><tbody>${itinRowsHtml}</tbody></table>`;
  }

  const safeLiveUrl = isSafeHttpOrHttpsUrl(params.athleticLiveUrl)
    ? params.athleticLiveUrl!.trim()
    : '';
  const liveBanner = safeLiveUrl
    ? `<p>Live Results / Heat Sheets: <a href="${escapeHtml(safeLiveUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(safeLiveUrl)}</a></p>`
    : '';
  const delayBanner =
    delayMins > 0
      ? `<div class="warn" style="background:#fef3c7;color:#92400e;">Schedule Delay Applied: +${delayMins} minutes</div>`
      : '';
  const authorityLabel =
    seedingAuthority === 'EXTERNAL_MEET'
      ? 'External Meet Official Program (Athletic.net / Hy-Tek / Clerk)'
      : 'Host / Dual Meet Seeding';

  return `<!doctype html><html><head><title>${escapeHtml(params.meetTitle)} — MeetReady Meet Packet</title><style>body{font-family:system-ui,sans-serif;padding:20px;color:#111}h1,h2,h3{margin:12px 0 6px}table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px}th,td{border:1px solid #bbb;padding:5px 8px;text-align:left}.warn{background:#fee2e2;color:#991b1b;padding:8px 12px;border-radius:6px;margin-bottom:12px;font-weight:700}.advisory{background:#fffbeb;color:#92400e;border:1px solid #fde68a;padding:8px 12px;border-radius:6px;margin-bottom:12px;font-weight:600}.no-print{margin-bottom:12px}@media print{.no-print{display:none!important}}</style></head><body><div class="no-print"><button type="button" onclick="window.print()" style="padding:8px 14px;font-weight:700;border-radius:8px;border:1px solid #999;background:#fff;cursor:pointer;">Print Meet Packet</button></div><h1>${escapeHtml(params.teamName)} — ${escapeHtml(params.meetTitle)}</h1><p><strong>Mode:</strong> ${escapeHtml(authorityLabel)}${params.meetDate ? ` · <strong>Date:</strong> ${escapeHtml(params.meetDate)}` : ''}</p>${liveBanner}${delayBanner}<p>NFHS Rule 4-2 Compliance: ${violations.length === 0 ? 'All athletes within 4-event limit ✓' : `${violations.length} athlete(s) exceed 4-event cap`}</p>${violations.length > 0 ? `<div class="warn">Over 4 Events: ${violations.map((v) => `${escapeHtml(v.athleteName)} (${v.eventCount})`).join(', ')}</div>` : ''}${alternateAdvisories.length > 0 ? `<div class="advisory">Alternate Advisory: ${alternateAdvisories.map((v) => `${escapeHtml(v.athleteName)} (${v.eventCount} active + ${v.alternateCount} alt)`).join(', ')}</div>` : ''}${scheduleHtml}${sections}${itineraryHtml}</body></html>`;
}

export function openPrintableMeetDayPacketWindow(params: PrintableMeetDayPacketParams): boolean {
  if (typeof window === 'undefined') return false;
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) {
    downloadMeetPacketHtmlFallback(params);
    return false;
  }

  const html = buildMeetDayPacketHtml(params);
  win.document.open?.();
  win.document.write(html);
  win.document.close();
  try {
    win.opener = null;
  } catch {
    // ignore read-only opener implementations
  }
  try {
    win.focus?.();
    win.print?.();
  } catch {
    // ignore focus/print errors in headless contexts
  }
  return true;
}

export function downloadMeetPacketHtmlFallback(params: PrintableMeetDayPacketParams): string {
  const html = buildMeetDayPacketHtml(params);
  if (
    typeof document !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  ) {
    const slug = (params.meetTitle || 'meet-packet')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug || 'meetready-packet'}.html`;
    if (a.style) a.style.display = 'none';
    document.body?.appendChild?.(a);
    a.click();
    a.remove?.();
    URL.revokeObjectURL(url);
  }
  return html;
}

export function applyImportedAssignmentsToEntries(params: {
  entries: MeetEntryRecord[];
  parseResult: ExternalHeatSheetParseResult;
  mode: 'MERGE_PRESERVE_CLERK' | 'REPLACE_ALL_ASSIGNMENTS';
  overwriteClerkOverrides?: boolean;
}): {
  entries: MeetEntryRecord[];
  updatedCount: number;
  addedCount: number;
  preservedClerkCount: number;
} {
  const overwriteClerk = params.overwriteClerkOverrides === true;
  let preservedClerkCount = 0;

  const cleared =
    params.mode === 'REPLACE_ALL_ASSIGNMENTS'
      ? params.entries.map((e) => {
          if (e.assignmentSource === 'CLERK_OVERRIDE' && !overwriteClerk) {
            preservedClerkCount += 1;
            return e;
          }
          const next = { ...e };
          delete next.officialHeat;
          delete next.officialLaneOrHip;
          delete next.officialFlight;
          delete next.officialOrder;
          delete next.eventStartTime;
          delete next.checkInCallTime;
          delete next.bibNumber;
          delete next.assignmentSource;
          return next;
        })
      : [...params.entries];

  const byId = new Map(cleared.map((e) => [e.id, e]));
  const additions: MeetEntryRecord[] = [];
  let updatedCount = 0;

  for (const item of params.parseResult.matchedAssignments) {
    if (item.matchedEntryId && byId.has(item.matchedEntryId)) {
      const cur = byId.get(item.matchedEntryId)!;
      if (cur.assignmentSource === 'CLERK_OVERRIDE' && !overwriteClerk) {
        if (params.mode === 'MERGE_PRESERVE_CLERK') preservedClerkCount += 1;
        continue;
      }
      byId.set(cur.id, {
        ...cur,
        ...(item.officialHeat !== undefined ? { officialHeat: item.officialHeat } : {}),
        ...(item.officialLaneOrHip ? { officialLaneOrHip: item.officialLaneOrHip } : {}),
        ...(item.officialFlight !== undefined ? { officialFlight: item.officialFlight } : {}),
        ...(item.officialOrder !== undefined ? { officialOrder: item.officialOrder } : {}),
        ...(item.eventStartTime ? { eventStartTime: item.eventStartTime } : {}),
        ...(item.checkInCallTime ? { checkInCallTime: item.checkInCallTime } : {}),
        ...(item.bibNumber ? { bibNumber: item.bibNumber } : {}),
        assignmentSource: item.assignmentSource,
      });
      updatedCount += 1;
    } else if (item.matchedMembershipId) {
      const alreadyAdded = additions.some(
        (a) => a.athleteId === item.matchedMembershipId && a.eventCode === item.eventCode
      );
      if (!alreadyAdded) {
        additions.push({
          id: `imp-${Date.now()}-${additions.length}-${Math.random().toString(36).slice(2, 6)}`,
          athleteId: item.matchedMembershipId,
          athleteName: item.matchedAthleteName || item.athleteName,
          ...(item.genderDivision ? { genderDivision: item.genderDivision } : {}),
          division: item.division || 'Varsity',
          eventCode: item.eventCode,
          seedMark: 'NT',
          ...(item.isRelaySquad && item.relayTeamCode ? { relayTeamCode: item.relayTeamCode } : {}),
          ...(item.officialHeat !== undefined ? { officialHeat: item.officialHeat } : {}),
          ...(item.officialLaneOrHip ? { officialLaneOrHip: item.officialLaneOrHip } : {}),
          ...(item.officialFlight !== undefined ? { officialFlight: item.officialFlight } : {}),
          ...(item.officialOrder !== undefined ? { officialOrder: item.officialOrder } : {}),
          ...(item.eventStartTime ? { eventStartTime: item.eventStartTime } : {}),
          ...(item.checkInCallTime ? { checkInCallTime: item.checkInCallTime } : {}),
          ...(item.bibNumber ? { bibNumber: item.bibNumber } : {}),
          assignmentSource: item.assignmentSource,
        });
      }
    }
  }

  return {
    entries: [...Array.from(byId.values()), ...additions],
    updatedCount,
    addedCount: additions.length,
    preservedClerkCount,
  };
}
