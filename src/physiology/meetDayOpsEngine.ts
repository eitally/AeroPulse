import { formatFieldMarkDual, parseFieldMarkToMeters } from './fieldEventsEngine';

export interface MeetEventSpec {
  code: string;
  label: string;
  category: 'TRACK' | 'RELAY' | 'FIELD';
  defaultLanes?: number;
}

export const ALL_MEET_DAY_EVENTS: ReadonlyArray<MeetEventSpec> = [
  { code: '100m', label: '100m Dash', category: 'TRACK', defaultLanes: 8 },
  { code: '200m', label: '200m Dash', category: 'TRACK', defaultLanes: 8 },
  { code: '400m', label: '400m Dash', category: 'TRACK', defaultLanes: 8 },
  { code: '800m', label: '800m Run', category: 'TRACK', defaultLanes: 8 },
  { code: '1600m', label: '1600m / Mile', category: 'TRACK', defaultLanes: 16 },
  { code: '3200m', label: '3200m / 2-Mile', category: 'TRACK', defaultLanes: 20 },
  { code: '100mH', label: '100m Hurdles', category: 'TRACK', defaultLanes: 8 },
  { code: '110mH', label: '110m Hurdles', category: 'TRACK', defaultLanes: 8 },
  { code: '300mH', label: '300m Hurdles', category: 'TRACK', defaultLanes: 8 },
  { code: '400mH', label: '400m Hurdles', category: 'TRACK', defaultLanes: 8 },
  { code: '4x100m', label: '4×100m Relay', category: 'RELAY', defaultLanes: 8 },
  { code: '4x200m', label: '4×200m Relay', category: 'RELAY', defaultLanes: 8 },
  { code: '4x400m', label: '4×400m Relay', category: 'RELAY', defaultLanes: 8 },
  { code: '4x800m', label: '4×800m Relay', category: 'RELAY', defaultLanes: 12 },
  { code: 'LJ', label: 'Long Jump', category: 'FIELD' },
  { code: 'TJ', label: 'Triple Jump', category: 'FIELD' },
  { code: 'HJ', label: 'High Jump', category: 'FIELD' },
  { code: 'PV', label: 'Pole Vault', category: 'FIELD' },
  { code: 'SP', label: 'Shot Put', category: 'FIELD' },
  { code: 'DISCUS', label: 'Discus', category: 'FIELD' },
  { code: 'JAVELIN', label: 'Javelin', category: 'FIELD' },
  { code: 'HAMMER', label: 'Hammer', category: 'FIELD' },
];

export interface MeetEntryRecord {
  id: string;
  athleteId: string;
  athleteName: string;
  genderDivision?: 'M' | 'F' | 'NONBINARY';
  graduationYear?: number;
  eventCode: string;
  seedMark: string;
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
}

export interface MeetFlightAssignment {
  flightNumber: number;
  orderIndex: number;
  athleteId: string;
  athleteName: string;
  seedMark: string;
  seedMeters: number | null;
}

const PREFERRED_LANE_ORDER = [4, 5, 3, 6, 2, 7, 1, 8];

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
  lanesPerHeat = 8
): MeetHeatAssignment[] {
  const filtered = entries
    .filter((e) => e.eventCode === eventCode)
    .map((e) => ({ ...e, seedSecs: parseTrackSeedTimeToSecs(e.seedMark) }))
    .sort((a, b) => {
      if (a.seedSecs === null && b.seedSecs === null) return a.athleteName.localeCompare(b.athleteName);
      if (a.seedSecs === null) return 1;
      if (b.seedSecs === null) return -1;
      return a.seedSecs - b.seedSecs;
    });

  const cap = Math.max(2, Math.min(20, lanesPerHeat));
  const assignments: MeetHeatAssignment[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const heatNumber = Math.floor(i / cap) + 1;
    const posInHeat = i % cap;
    const lane =
      cap <= 8
        ? PREFERRED_LANE_ORDER[posInHeat] ?? posInHeat + 1
        : posInHeat + 1;
    assignments.push({
      heatNumber,
      lane,
      athleteId: filtered[i].athleteId,
      athleteName: filtered[i].athleteName,
      seedMark: filtered[i].seedMark || 'NT',
      seedSecs: filtered[i].seedSecs,
    });
  }
  return assignments.sort((a, b) => a.heatNumber - b.heatNumber || a.lane - b.lane);
}

export function seedFieldFlights(
  entries: MeetEntryRecord[],
  eventCode: string,
  maxPerFlight = 12
): MeetFlightAssignment[] {
  const filtered = entries
    .filter((e) => e.eventCode === eventCode)
    .map((e) => ({ ...e, seedMeters: parseFieldMarkToMeters(e.seedMark) }))
    .sort((a, b) => {
      // Standard field seeding: NM / lowest seeds jump or throw first, top seed last in final flight
      const am = a.seedMeters ?? 0;
      const bm = b.seedMeters ?? 0;
      return am - bm || a.athleteName.localeCompare(b.athleteName);
    });

  const cap = Math.max(4, Math.min(24, maxPerFlight));
  return filtered.map((row, idx) => ({
    flightNumber: Math.floor(idx / cap) + 1,
    orderIndex: (idx % cap) + 1,
    athleteId: row.athleteId,
    athleteName: row.athleteName,
    seedMark:
      row.seedMeters && row.seedMeters > 0
        ? formatFieldMarkDual(row.seedMeters)
        : row.seedMark || 'NM',
    seedMeters: row.seedMeters,
  }));
}

function sanitizeCsvCell(raw: string | number | undefined): string {
  const s = String(raw ?? '').replace(/[\r\n;]/g, ' ').trim();
  if (/^[=+\-@]/.test(s)) return `'${s}`;
  return s;
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
      if (spec?.category === 'FIELD') {
        const flights = seedFieldFlights(params.entries, code);
        const rowsHtml = flights
          .map(
            (f) =>
              `<tr><td>F${f.flightNumber} #${f.orderIndex}</td><td>${escapeHtml(f.athleteName)}</td><td>${escapeHtml(f.seedMark)}</td><td></td><td></td><td></td><td></td></tr>`
          )
          .join('');
        return `<h3>${escapeHtml(spec.label)} Flight Sheet</h3><table><thead><tr><th>Order</th><th>Athlete</th><th>Seed</th><th>T1</th><th>T2</th><th>T3</th><th>Best</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
      }
      const heats = seedTrackHeats(params.entries, code, spec?.defaultLanes || 8);
      const rowsHtml = heats
        .map(
          (h) =>
            `<tr><td>H${h.heatNumber} Ln ${h.lane}</td><td>${escapeHtml(h.athleteName)}</td><td>${escapeHtml(h.seedMark)}</td><td></td><td></td></tr>`
        )
        .join('');
      return `<h3>${escapeHtml(spec?.label || code)} Heat Sheet</h3><table><thead><tr><th>Heat / Lane</th><th>Athlete</th><th>Seed</th><th>Split</th><th>Finish FAT</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
    })
    .join('');

  const html = `<!doctype html><html><head><title>${escapeHtml(params.meetTitle)} — MeetReady Meet Packet</title><style>body{font-family:system-ui,sans-serif;padding:20px;color:#111}h1,h2,h3{margin:12px 0 6px}table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px}th,td{border:1px solid #bbb;padding:5px 8px;text-align:left}.warn{background:#fee2e2;color:#991b1b;padding:8px 12px;border-radius:6px;margin-bottom:12px;font-weight:700}</style></head><body><h1>${escapeHtml(params.teamName)} — ${escapeHtml(params.meetTitle)}</h1><p>NFHS Rule 4-2 Compliance: ${violations.length === 0 ? 'All athletes within 4-event limit ✓' : `${violations.length} athlete(s) exceed 4-event cap`}</p>${violations.length > 0 ? `<div class="warn">Over 4 Events: ${violations.map((v) => `${escapeHtml(v.athleteName)} (${v.eventCount})`).join(', ')}</div>` : ''}${sections}</body></html>`;
  win.document.write(html);
  win.document.close();
  return true;
}
