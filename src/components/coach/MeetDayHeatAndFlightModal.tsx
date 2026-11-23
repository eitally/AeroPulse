import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowSquareOut,
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
  ClipboardText,
  Clock,
  Download,
  Plus,
  Search,
  Timer,
  Trash2,
  Trophy,
  Users,
  X,
} from '../icons/PhosphorIcons';
import { useModalDialog } from '../../hooks/useModalDialog';
import { formatFieldMarkImperial } from '../../physiology/fieldEventsEngine';
import {
  ALL_MEET_DAY_EVENTS,
  MEET_DIVISION_CHOICES,
  applyDelayToMeetTimeString,
  applyImportedAssignmentsToEntries,
  deserializePacketEntriesToMeetEntries,
  downloadMeetPacketHtmlFallback,
  formatOfficialLaneOrHip,
  generateAthleticNetEntryCsv,
  generateHyTekHy3File,
  generateHyTekSemiColonEntryCsv,
  groupEntriesIntoRelaySquads,
  inferDivisionFromSquadGroup,
  isRelayEventCode,
  openPrintableMeetDayPacketWindow,
  parseMeetTimeToSortMinutes,
  parseTrackSeedTimeToSecs,
  seedFieldFlights,
  seedTrackHeats,
  serializeMeetEntriesToPacketEntries,
  validateNfhsFourEventLimits,
  type ExternalHeatSheetParseResult,
  type MeetEntryRecord,
  type MeetFlightAssignment,
  type MeetGenderDivision,
  type MeetHeatAssignment,
} from '../../physiology/meetDayOpsEngine';
import {
  deleteLocalMeetDayPacket,
  deleteMeetDayPacketApi,
  fetchMeetDayPacketsApi,
  loadLocalMeetDayPackets,
  saveLocalMeetDayPacket,
  saveMeetDayPacketApi,
} from '../../utils/meetDayOpsApi';
import { getLocalDateIso } from '../../physiology/stravaLoadCalibration';
import type {
  ConnectedAthleteRecord,
  FieldEventLogRecord,
  MeetDayPacketRecord,
  MeetSeedingAuthority,
  TeamSummaryWithRole,
} from '../../types';
import { ExternalHeatSheetImportPanel, MeetDayEntryRow } from './ExternalHeatSheetImportPanel';

export interface MeetDayHeatAndFlightModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Renders full-width inline inside Meets & Plan Hub instead of a fixed modal overlay */
  inline?: boolean;
  /** Optional starting sub-tab (defaults to ENTRIES) */
  initialSubTab?: 'ENTRIES' | 'SCHEDULE' | 'HEATS' | 'FLIGHTS';
  activeTeam: TeamSummaryWithRole | null;
  connectedAthletes: ConnectedAthleteRecord[];
  myTeams?: TeamSummaryWithRole[];
  onTeamsUpdated?: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string) => void;
  onLaunchEventStopwatch?: (preset: {
    meetTitle: string;
    meetDate: string;
    eventCode: string;
    runners: Array<{ membershipId?: string; athleteName: string; laneOrHip?: string }>;
  }) => void;
  onDelegateEventTimer?: (preset: {
    meetTitle: string;
    meetDate: string;
    eventCode: string;
    heatLabel?: string;
    runners: Array<{ membershipId?: string; athleteName: string; hipOrLane?: string }>;
  }) => void;
}

function resolveCompetitionGender(
  explicit?: 'M' | 'F' | 'NONBINARY',
  competitionGender?: 'MEN' | 'WOMEN',
  squadGroup?: string
): MeetGenderDivision | undefined {
  if (explicit === 'M' || explicit === 'F' || explicit === 'NONBINARY') return explicit;
  if (competitionGender === 'MEN') return 'M';
  if (competitionGender === 'WOMEN') return 'F';
  if (squadGroup) {
    if (/\b(?:boys?|men'?s?)\b/i.test(squadGroup)) return 'M';
    if (/\b(?:girls?|women'?s?)\b/i.test(squadGroup)) return 'F';
  }
  return undefined;
}

function isDemoMeetTeamId(teamId?: string | null): boolean {
  if (!teamId) return false;
  return teamId.startsWith('demo_team_') || teamId.startsWith('demo-team-');
}

function matchMeetEventCodeFromText(
  rawLabel: string | undefined,
  gender?: MeetGenderDivision
): { code: string; trailingMark?: string } | null {
  if (!rawLabel) return null;
  const trimmed = rawLabel.trim();
  if (!trimmed) return null;
  const normalizedNameMap: Array<[RegExp, string]> = [
    [/^(?:1\s*)?mile(?:\s+(.*))?$/i, '1600m'],
    [/^long\s+jump(?:\s+(.*))?$/i, 'LJ'],
    [/^triple\s+jump(?:\s+(.*))?$/i, 'TJ'],
    [/^high\s+jump(?:\s+(.*))?$/i, 'HJ'],
    [/^pole\s+vault(?:\s+(.*))?$/i, 'PV'],
    [/^shot\s+put(?:\s+(.*))?$/i, 'SP'],
    [/^discus(?:\s+throw)?(?:\s+(.*))?$/i, 'DISCUS'],
    [/^javelin(?:\s+throw)?(?:\s+(.*))?$/i, 'JAVELIN'],
    [/^hammer(?:\s+throw)?(?:\s+(.*))?$/i, 'HAMMER'],
  ];
  for (const [re, code] of normalizedNameMap) {
    const m = trimmed.match(re);
    if (m) return { code, trailingMark: m[1]?.trim() || undefined };
  }
  const orderedSpecs = [...ALL_MEET_DAY_EVENTS].sort(
    (a, b) => b.code.length - a.code.length
  );
  for (const spec of orderedSpecs) {
    const escaped = spec.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^${escaped}(?:\\s+(.*))?$`, 'i');
    const m = trimmed.match(re);
    if (m) {
      let code = spec.code;
      if (code === '110mH' && gender === 'F') code = '100mH';
      if (code === '100mH' && gender === 'M') code = '110mH';
      return { code, trailingMark: m[1]?.trim() || undefined };
    }
  }
  return null;
}

function resolveBestLegalFieldMeters(log: FieldEventLogRecord): number | null {
  if (log.isNoHeight) return null;
  if (typeof log.bestWindLegalMeters === 'number' && log.bestWindLegalMeters > 0) {
    return log.bestWindLegalMeters;
  }
  if (
    typeof log.bestMarkMeters === 'number' &&
    log.bestMarkMeters > 0 &&
    !log.isWindAidedBest
  ) {
    return log.bestMarkMeters;
  }
  let bestLegal = 0;
  for (const att of log.attempts || []) {
    if (att.outcome !== 'MARK' && att.outcome !== 'CLEAR') continue;
    if (typeof att.windMps === 'number' && att.windMps > 2.0) continue;
    const m = att.markMeters ?? att.barHeightMeters ?? 0;
    if (m > bestLegal) bestLegal = m;
  }
  return bestLegal > 0 ? bestLegal : null;
}

export function buildEntriesFromRosterMarks(
  activeTeam: TeamSummaryWithRole | null
): MeetEntryRecord[] {
  if (!activeTeam) return [];
  const members = (activeTeam.memberships || []).filter(
    (m) => m.role === 'ATHLETE' && m.status !== 'REVOKED' && m.status !== 'ALUMNI'
  );
  const supportedFieldCodes = new Set(
    ALL_MEET_DAY_EVENTS.filter((e) => e.category === 'FIELD').map((e) => e.code)
  );
  const seeded: MeetEntryRecord[] = [];

  for (const m of members) {
    const gender = resolveCompetitionGender(m.genderDivision, undefined, m.squadGroup);
    const division = inferDivisionFromSquadGroup(m.squadGroup) || 'Varsity';
    const bestTrackByCode = new Map<
      string,
      { displayMark: string; secs: number | null }
    >();

    for (const act of m.coachRecordedActivities || []) {
      const race = act.officialRaceData;
      if (!race?.eventLabel || !race?.displayFatTime) continue;
      const matched = matchMeetEventCodeFromText(race.eventLabel, gender);
      if (!matched) continue;
      const secs =
        typeof race.fatTimeSecs === 'number' && race.fatTimeSecs > 0
          ? race.fatTimeSecs
          : parseTrackSeedTimeToSecs(race.displayFatTime);
      const prev = bestTrackByCode.get(matched.code);
      if (!prev || (secs !== null && (prev.secs === null || secs < prev.secs))) {
        bestTrackByCode.set(matched.code, {
          displayMark: race.displayFatTime,
          secs,
        });
      }
    }

    for (const [eventCode, markInfo] of bestTrackByCode.entries()) {
      seeded.push({
        id: `roster-${m.membershipId}-${eventCode}-${seeded.length}`,
        athleteId: m.membershipId,
        athleteName: m.invitedName,
        ...(gender ? { genderDivision: gender } : {}),
        division,
        graduationYear: m.graduationYear,
        eventCode,
        seedMark: markInfo.displayMark,
      });
    }

    // Pull best legal field marks from activeTeam.fieldMarkLogs
    const bestFieldByCode = new Map<string, number>();
    const normalizedMemberName = m.invitedName.trim().toLowerCase();
    for (const log of activeTeam.fieldMarkLogs || []) {
      if (!supportedFieldCodes.has(log.eventCode)) continue;
      const belongsToMember =
        log.membershipId === m.membershipId ||
        (!log.membershipId && log.athleteName.trim().toLowerCase() === normalizedMemberName);
      if (!belongsToMember) continue;
      const legalMeters = resolveBestLegalFieldMeters(log);
      if (!legalMeters) continue;
      const prevMeters = bestFieldByCode.get(log.eventCode) || 0;
      if (legalMeters > prevMeters) {
        bestFieldByCode.set(log.eventCode, legalMeters);
      }
    }

    for (const [eventCode, meters] of bestFieldByCode.entries()) {
      seeded.push({
        id: `roster-${m.membershipId}-${eventCode}-${seeded.length}`,
        athleteId: m.membershipId,
        athleteName: m.invitedName,
        ...(gender ? { genderDivision: gender } : {}),
        division,
        graduationYear: m.graduationYear,
        eventCode,
        seedMark: formatFieldMarkImperial(meters),
      });
    }

    if (m.seedMarkOrFtp) {
      const parsed = matchMeetEventCodeFromText(m.seedMarkOrFtp, gender);
      if (
        parsed &&
        parsed.trailingMark &&
        !bestTrackByCode.has(parsed.code) &&
        !bestFieldByCode.has(parsed.code)
      ) {
        seeded.push({
          id: `roster-${m.membershipId}-${parsed.code}-${seeded.length}`,
          athleteId: m.membershipId,
          athleteName: m.invitedName,
          ...(gender ? { genderDivision: gender } : {}),
          division,
          graduationYear: m.graduationYear,
          eventCode: parsed.code,
          seedMark: parsed.trailingMark,
        });
      }
    }
  }
  return seeded;
}

export function buildInitialMeetEntries(
  activeTeam: TeamSummaryWithRole | null,
  connectedAthletes: ConnectedAthleteRecord[]
): MeetEntryRecord[] {
  if (activeTeam && !isDemoMeetTeamId(activeTeam.brand.teamId)) {
    return [];
  }

  const eligibleMembers = (activeTeam?.memberships || []).filter(
    (m) => m.role === 'ATHLETE' && m.status !== 'REVOKED' && m.status !== 'ALUMNI'
  );

  const rosterSource =
    eligibleMembers.length > 0
      ? eligibleMembers.map((m) => ({
          id: m.membershipId,
          name: m.invitedName,
          gender: resolveCompetitionGender(m.genderDivision, undefined, m.squadGroup),
          division: inferDivisionFromSquadGroup(m.squadGroup),
          gradYear: m.graduationYear,
          eventGroup: m.eventGroup,
          seed: m.seedMarkOrFtp,
        }))
      : connectedAthletes.map((a) => ({
          id: a.id,
          name: a.name,
          gender: resolveCompetitionGender(
            a.genderDivision,
            a.athleteProfile?.competitionGender,
            a.location
          ),
          division: inferDivisionFromSquadGroup(
            a.athleteProfile?.academicDivision === 'HS_VARSITY' ? 'Varsity' : a.location
          ),
          gradYear: undefined,
          eventGroup: a.eventGroup,
          seed: undefined,
        }));

  const seeded: MeetEntryRecord[] = [];
  rosterSource.slice(0, 10).forEach((ath, idx) => {
    const group = ath.eventGroup || 'DISTANCE';
    const hurdlesCode = ath.gender === 'F' ? '100mH' : '110mH';
    const defaultEv =
      group === 'SPRINTS'
        ? idx % 2 === 0
          ? { code: '100m', mark: '11.24' }
          : { code: '400m', mark: '50.80' }
        : group === 'HURDLES'
          ? { code: hurdlesCode, mark: ath.gender === 'F' ? '15.10' : '14.85' }
          : group === 'JUMPS'
            ? { code: 'LJ', mark: "21' 2\"" }
            : group === 'POLE_VAULT'
              ? { code: 'PV', mark: "13' 6\"" }
              : group === 'THROWS'
                ? { code: 'SP', mark: "45' 4\"" }
                : idx % 2 === 0
                  ? { code: '1600m', mark: '4:28.50' }
                  : { code: '800m', mark: '1:59.20' };
    seeded.push({
      id: `init-${ath.id}-${defaultEv.code}`,
      athleteId: ath.id,
      athleteName: ath.name,
      ...(ath.gender ? { genderDivision: ath.gender } : {}),
      division: ath.division || 'Varsity',
      graduationYear: ath.gradYear,
      eventCode: defaultEv.code,
      seedMark: defaultEv.mark,
    });
  });

  if (seeded.length === 0 && !activeTeam) {
    seeded.push(
      {
        id: 'sample-1',
        athleteId: 'ath-1',
        athleteName: 'Devon Carter',
        genderDivision: 'M',
        division: 'Varsity',
        eventCode: '100m',
        seedMark: '10.94',
      },
      {
        id: 'sample-2',
        athleteId: 'ath-2',
        athleteName: 'Chloe Okafor',
        genderDivision: 'F',
        division: 'Varsity',
        eventCode: '100m',
        seedMark: '12.18',
      },
      {
        id: 'sample-3',
        athleteId: 'ath-1',
        athleteName: 'Devon Carter',
        genderDivision: 'M',
        division: 'Varsity',
        eventCode: 'LJ',
        seedMark: "21' 6.5\"",
      }
    );
  }
  return seeded;
}

function triggerFileDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function resolveEntryPartitionLabel(entry: MeetEntryRecord, partitionByDivision: boolean): string {
  if (!partitionByDivision) return 'Open';
  const gLabel =
    entry.genderDivision === 'F'
      ? 'Girls'
      : entry.genderDivision === 'M'
        ? 'Boys'
        : entry.genderDivision === 'NONBINARY'
          ? 'Non-Binary'
          : '';
  return [gLabel, entry.division || 'Varsity'].filter(Boolean).join(' ') || 'Open';
}

export interface MeetScheduleBlock {
  key: string;
  eventCode: string;
  eventLabel: string;
  isField: boolean;
  partLabel: string;
  delayedStartTime: string;
  delayedCallTime: string;
  hasDelayApplied: boolean;
  sortMinutes: number;
  catalogOrder: number;
  entries: MeetEntryRecord[];
  runners: Array<{ membershipId?: string; athleteName: string; laneOrHip?: string }>;
}

/**
 * Group active entries into chronological event/partition blocks ordered by
 * delay-adjusted start or call time, falling back to official event catalog order.
 */
export function buildChronologicalScheduleBlocks(
  entries: MeetEntryRecord[],
  partitionByDivision: boolean,
  meetDelayMinutes: number
): MeetScheduleBlock[] {
  const safeDelay = Math.max(0, Math.round(meetDelayMinutes || 0));
  const specByCode = new Map(ALL_MEET_DAY_EVENTS.map((spec, idx) => [spec.code, { spec, idx }]));
  const buckets = new Map<
    string,
    {
      eventCode: string;
      partLabel: string;
      delayedStartTime: string;
      delayedCallTime: string;
      hasDelayApplied: boolean;
      sortMinutes: number;
      entries: MeetEntryRecord[];
    }
  >();

  for (const entry of entries) {
    if (entry.scratched) continue;
    const partLabel = resolveEntryPartitionLabel(entry, partitionByDivision);
    const delayedStart = applyDelayToMeetTimeString(entry.eventStartTime, safeDelay);
    const delayedCall = applyDelayToMeetTimeString(entry.checkInCallTime, safeDelay);
    const timeKey = delayedStart || delayedCall || 'TBD';
    const key = `${entry.eventCode}::${partLabel}::${timeKey}`;
    const rawTime = entry.eventStartTime || entry.checkInCallTime;
    const parsedMins = parseMeetTimeToSortMinutes(rawTime);
    const entrySortMins = parsedMins !== null ? parsedMins + safeDelay : 9999;

    const existing = buckets.get(key);
    if (existing) {
      existing.entries.push(entry);
      if (entrySortMins < existing.sortMinutes) existing.sortMinutes = entrySortMins;
      if (safeDelay > 0 && rawTime) existing.hasDelayApplied = true;
    } else {
      buckets.set(key, {
        eventCode: entry.eventCode,
        partLabel,
        delayedStartTime: delayedStart,
        delayedCallTime: delayedCall,
        hasDelayApplied: safeDelay > 0 && Boolean(rawTime),
        sortMinutes: entrySortMins,
        entries: [entry],
      });
    }
  }

  const blocks: MeetScheduleBlock[] = Array.from(buckets.entries()).map(([key, bucket]) => {
    const specEntry = specByCode.get(bucket.eventCode);
    const isField = specEntry?.spec.category === 'FIELD';
    const isRelay = isRelayEventCode(bucket.eventCode);
    const runners = isField
      ? []
      : isRelay
        ? groupEntriesIntoRelaySquads(bucket.entries).map((sq) => ({
            membershipId: sq.representativeEntry.athleteId,
            athleteName: `${sq.eventCode} Team ${sq.relayTeamCode}`,
            laneOrHip: sq.officialLaneOrHip,
          }))
        : bucket.entries
            .filter((e) => !e.isAlternate)
            .map((e) => ({
              membershipId: e.athleteId,
              athleteName: e.athleteName,
              laneOrHip: e.officialLaneOrHip,
            }));

    return {
      key,
      eventCode: bucket.eventCode,
      eventLabel: specEntry?.spec.label || bucket.eventCode,
      isField,
      partLabel: bucket.partLabel,
      delayedStartTime: bucket.delayedStartTime,
      delayedCallTime: bucket.delayedCallTime,
      hasDelayApplied: bucket.hasDelayApplied,
      sortMinutes: bucket.sortMinutes,
      catalogOrder: specEntry?.idx ?? 999,
      entries: bucket.entries,
      runners,
    };
  });

  blocks.sort(
    (a, b) =>
      a.sortMinutes - b.sortMinutes ||
      a.catalogOrder - b.catalogOrder ||
      a.partLabel.localeCompare(b.partLabel)
  );
  return blocks;
}

export const MeetDayHeatAndFlightModal: React.FC<MeetDayHeatAndFlightModalProps> = ({
  isOpen,
  onClose,
  inline = false,
  initialSubTab = 'ENTRIES',
  activeTeam,
  connectedAthletes,
  myTeams,
  onTeamsUpdated,
  onLaunchEventStopwatch,
  onDelegateEventTimer,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const headingId = useId();
  useModalDialog({ isOpen: isOpen && !inline, onClose, dialogRef });

  const teamScopeKey = activeTeam?.brand.teamId || 'local';
  const isLiveServerTeam = Boolean(
    activeTeam && !isDemoMeetTeamId(activeTeam.brand.teamId)
  );

  const initialInlinePacket = activeTeam?.meetDayPackets?.[0] || null;
  const [activePacketId, setActivePacketId] = useState<string>(
    () => initialInlinePacket?.packetId || ''
  );
  const [savedPackets, setSavedPackets] = useState<MeetDayPacketRecord[]>(
    () => activeTeam?.meetDayPackets || []
  );
  const [meetTitle, setMeetTitle] = useState<string>(
    () => initialInlinePacket?.meetTitle || 'League Dual / Saturday Invitational'
  );
  const [meetDate, setMeetDate] = useState<string>(
    () => initialInlinePacket?.meetDate || getLocalDateIso()
  );
  const [seedingAuthority, setSeedingAuthority] = useState<MeetSeedingAuthority>(
    () => initialInlinePacket?.seedingAuthority || 'EXTERNAL_MEET'
  );
  const [athleticLiveUrl, setAthleticLiveUrl] = useState<string>(
    () => initialInlinePacket?.athleticLiveUrl || ''
  );
  const [meetDelayMinutes, setMeetDelayMinutes] = useState<number>(
    () => initialInlinePacket?.meetDelayMinutes || 0
  );
  const [hostSlowToFast, setHostSlowToFast] = useState<boolean>(false);
  const [subTab, setSubTab] = useState<'ENTRIES' | 'SCHEDULE' | 'HEATS' | 'FLIGHTS'>(initialSubTab);
  const [entries, setEntries] = useState<MeetEntryRecord[]>(() =>
    initialInlinePacket
      ? deserializePacketEntriesToMeetEntries(initialInlinePacket.entries)
      : buildInitialMeetEntries(activeTeam, connectedAthletes)
  );
  const [partitionByDivision, setPartitionByDivision] = useState<boolean>(
    () => (initialInlinePacket ? initialInlinePacket.partitionByDivision !== false : true)
  );
  const [genderFilter, setGenderFilter] = useState<'ALL' | 'M' | 'F'>('ALL');
  const [divisionFilter, setDivisionFilter] = useState<string>('ALL');
  const [eventFilter, setEventFilter] = useState<string>('ALL');
  const [entriesSearchQuery, setEntriesSearchQuery] = useState<string>('');
  const [mobileExportsOpen, setMobileExportsOpen] = useState<boolean>(false);
  const [exportScope, setExportScope] = useState<'FULL_TEAM' | 'FILTERED_ONLY'>('FULL_TEAM');
  const [showExternalImportPanel, setShowExternalImportPanel] = useState<boolean>(false);
  const [editingClerkEntryId, setEditingClerkEntryId] = useState<string | null>(null);
  const [printPopupBlocked, setPrintPopupBlocked] = useState<boolean>(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [showUnsavedCloseGuard, setShowUnsavedCloseGuard] = useState<boolean>(false);

  const [newAthleteKey, setNewAthleteKey] = useState<string>('');
  const [newEventCode, setNewEventCode] = useState<string>('100m');
  const [newSeedMark, setNewSeedMark] = useState<string>('11.40');
  const [newGenderOverride, setNewGenderOverride] = useState<MeetGenderDivision | ''>('');
  const [newDivisionOverride, setNewDivisionOverride] = useState<string>('');
  const [newRelayTeam, setNewRelayTeam] = useState<string>('A');
  const [newRelayLeg, setNewRelayLeg] = useState<1 | 2 | 3 | 4>(1);
  const [newIsAlternate, setNewIsAlternate] = useState<boolean>(false);

  const [selectedHeatEvent, setSelectedHeatEvent] = useState<string>('100m');
  const [selectedFlightEvent, setSelectedFlightEvent] = useState<string>('LJ');
  const [isSavingPacket, setIsSavingPacket] = useState<boolean>(false);
  const [packetFeedback, setPacketFeedback] = useState<{
    tone: 'prime' | 'caution';
    text: string;
  } | null>(null);

  const hydratedOpenRef = useRef<string | null>(null);

  const applyPacketToEditor = (pkt: MeetDayPacketRecord) => {
    setActivePacketId(pkt.packetId);
    setMeetTitle(pkt.meetTitle);
    setMeetDate(pkt.meetDate || getLocalDateIso());
    setPartitionByDivision(pkt.partitionByDivision !== false);
    setSeedingAuthority(pkt.seedingAuthority || 'EXTERNAL_MEET');
    setAthleticLiveUrl(pkt.athleticLiveUrl || '');
    setMeetDelayMinutes(pkt.meetDelayMinutes || 0);
    setEntries(deserializePacketEntriesToMeetEntries(pkt.entries));
    setHasUnsavedChanges(false);
    setShowUnsavedCloseGuard(false);
  };

  useEffect(() => {
    if (!isOpen) {
      hydratedOpenRef.current = null;
      setShowUnsavedCloseGuard(false);
      return;
    }
    if (hydratedOpenRef.current === teamScopeKey) return;
    hydratedOpenRef.current = teamScopeKey;
    setPacketFeedback(null);
    setPrintPopupBlocked(false);
    setHasUnsavedChanges(false);
    setShowUnsavedCloseGuard(false);

    const localList = loadLocalMeetDayPackets(teamScopeKey);
    const serverInline = activeTeam?.meetDayPackets || [];
    const initialList = serverInline.length > 0 ? serverInline : localList;
    setSavedPackets(initialList);

    if (initialList.length > 0) {
      applyPacketToEditor(initialList[0]);
    } else {
      setActivePacketId('');
      setMeetTitle('League Dual / Saturday Invitational');
      setMeetDate(getLocalDateIso());
      setPartitionByDivision(true);
      setSeedingAuthority('EXTERNAL_MEET');
      setAthleticLiveUrl('');
      setMeetDelayMinutes(0);
      setEntries(buildInitialMeetEntries(activeTeam, connectedAthletes));
      setHasUnsavedChanges(false);
      setShowUnsavedCloseGuard(false);
    }

    if (isLiveServerTeam && activeTeam) {
      let cancelled = false;
      void fetchMeetDayPacketsApi(activeTeam.brand.teamId)
        .then((res) => {
          if (cancelled || !Array.isArray(res.packets)) return;
          setSavedPackets(res.packets);
          if (res.packets.length > 0 && initialList.length === 0) {
            applyPacketToEditor(res.packets[0]);
          }
        })
        .catch(() => {
          // Keep local fallback quietly if offline
        });
      return () => {
        cancelled = true;
      };
    }
  }, [isOpen, teamScopeKey, isLiveServerTeam, activeTeam, connectedAthletes]);

  const injuredMemberIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of activeTeam?.memberships || []) {
      if (m.status === 'INJURED') ids.add(m.membershipId);
    }
    for (const c of activeTeam?.injuryCases || []) {
      if (c.rtpStage === 'OUT' || c.rtpStage === 'MODIFIED') ids.add(c.membershipId);
    }
    return ids;
  }, [activeTeam?.memberships, activeTeam?.injuryCases]);

  const athleteChoices = useMemo(() => {
    const members = (activeTeam?.memberships || [])
      .filter((m) => m.role === 'ATHLETE' && m.status !== 'REVOKED' && m.status !== 'ALUMNI')
      .map((m) => ({
        id: m.membershipId,
        name: m.invitedName,
        gender: resolveCompetitionGender(m.genderDivision, undefined, m.squadGroup) || ('M' as const),
        division: inferDivisionFromSquadGroup(m.squadGroup),
        gradYear: m.graduationYear,
      }));
    if (members.length > 0) return members;
    if (connectedAthletes.length > 0) {
      return connectedAthletes.map((a) => ({
        id: a.id,
        name: a.name,
        gender:
          resolveCompetitionGender(
            a.genderDivision,
            a.athleteProfile?.competitionGender,
            a.location
          ) || ('M' as const),
        division: 'Varsity',
        gradYear: undefined,
      }));
    }
    return [
      { id: 'ath-1', name: 'Devon Carter', gender: 'M' as const, division: 'Varsity', gradYear: 2026 },
      { id: 'ath-2', name: 'Chloe Okafor', gender: 'F' as const, division: 'Varsity', gradYear: 2027 },
    ];
  }, [activeTeam?.memberships, connectedAthletes]);

  const activeAthleteChoice =
    athleteChoices.find((a) => a.id === newAthleteKey) || athleteChoices[0];

  const availableDivisions = useMemo(() => {
    const set = new Set<string>(MEET_DIVISION_CHOICES);
    for (const e of entries) {
      if (e.division?.trim()) set.add(e.division.trim());
    }
    return Array.from(set);
  }, [entries]);

  const filteredEntries = useMemo(
    () =>
      entries.filter((e) => {
        if (genderFilter !== 'ALL' && e.genderDivision !== genderFilter) return false;
        if (
          divisionFilter !== 'ALL' &&
          (e.division || 'Varsity').toLowerCase() !== divisionFilter.toLowerCase()
        ) {
          return false;
        }
        return true;
      }),
    [entries, genderFilter, divisionFilter]
  );

  const isFilterActive = genderFilter !== 'ALL' || divisionFilter !== 'ALL';
  const activeAllEntries = useMemo(() => entries.filter((e) => !e.scratched), [entries]);
  const activeFilteredEntries = useMemo(
    () => filteredEntries.filter((e) => !e.scratched),
    [filteredEntries]
  );
  const availableEntryEvents = useMemo(() => {
    const orderMap = new Map(ALL_MEET_DAY_EVENTS.map((ev, idx) => [ev.code, idx]));
    return Array.from(new Set(entries.map((e) => e.eventCode))).sort(
      (a, b) => (orderMap.get(a) ?? 999) - (orderMap.get(b) ?? 999) || a.localeCompare(b)
    );
  }, [entries]);
  const visibleEntriesList = useMemo(() => {
    const q = entriesSearchQuery.trim().toLowerCase();
    return filteredEntries.filter((entry) => {
      if (eventFilter !== 'ALL' && entry.eventCode !== eventFilter) return false;
      if (!q) return true;
      return (
        entry.athleteName.toLowerCase().includes(q) ||
        entry.eventCode.toLowerCase().includes(q) ||
        (entry.seedMark || '').toLowerCase().includes(q) ||
        (entry.bibNumber || '').toLowerCase().includes(q) ||
        (entry.division || '').toLowerCase().includes(q)
      );
    });
  }, [filteredEntries, eventFilter, entriesSearchQuery]);
  const chronologicalScheduleBlocks = useMemo(
    () =>
      buildChronologicalScheduleBlocks(
        activeFilteredEntries,
        partitionByDivision,
        meetDelayMinutes
      ),
    [activeFilteredEntries, partitionByDivision, meetDelayMinutes]
  );
  const effectiveExportEntries =
    isFilterActive && exportScope === 'FILTERED_ONLY'
      ? activeFilteredEntries
      : activeAllEntries;

  const nfhsAudit = useMemo(() => validateNfhsFourEventLimits(entries, 4), [entries]);
  const violations = useMemo(() => nfhsAudit.filter((r) => r.overLimit), [nfhsAudit]);
  const alternateAdvisories = useMemo(
    () => nfhsAudit.filter((r) => !r.overLimit && r.hasAlternateAdvisory),
    [nfhsAudit]
  );

  const activeHeatDefaultLanes = useMemo(
    () => ALL_MEET_DAY_EVENTS.find((e) => e.code === selectedHeatEvent)?.defaultLanes || 8,
    [selectedHeatEvent]
  );

  const trackHeats = useMemo(
    () =>
      seedTrackHeats(
        filteredEntries,
        selectedHeatEvent,
        activeHeatDefaultLanes,
        partitionByDivision,
        { slowToFast: hostSlowToFast }
      ),
    [filteredEntries, selectedHeatEvent, activeHeatDefaultLanes, partitionByDivision, hostSlowToFast]
  );
  const fieldFlights = useMemo(
    () => seedFieldFlights(filteredEntries, selectedFlightEvent, 12, partitionByDivision),
    [filteredEntries, selectedFlightEvent, partitionByDivision]
  );

  const groupedHeats = useMemo(() => {
    const groups = new Map<string, MeetHeatAssignment[]>();
    for (const h of trackHeats) {
      const label = h.partitionLabel || 'Open';
      const bucket = groups.get(label) || [];
      bucket.push(h);
      groups.set(label, bucket);
    }
    return Array.from(groups.entries());
  }, [trackHeats]);

  const groupedFlights = useMemo(() => {
    const groups = new Map<string, MeetFlightAssignment[]>();
    for (const f of fieldFlights) {
      const label = f.partitionLabel || 'Open';
      const bucket = groups.get(label) || [];
      bucket.push(f);
      groups.set(label, bucket);
    }
    return Array.from(groups.entries());
  }, [fieldFlights]);

  const partitionEntriesByLabel = (list: MeetEntryRecord[]) => {
    const byPart = new Map<string, MeetEntryRecord[]>();
    for (const e of list) {
      const label = resolveEntryPartitionLabel(e, partitionByDivision);
      const arr = byPart.get(label) || [];
      arr.push(e);
      byPart.set(label, arr);
    }
    return Array.from(byPart.entries());
  };

  const externalTrackGroups = useMemo(() => {
    const matching = filteredEntries.filter(
      (e) => e.eventCode === selectedHeatEvent && !e.scratched
    );
    const isRelay = isRelayEventCode(selectedHeatEvent);
    return partitionEntriesByLabel(matching).map(([partLabel, partEntries]) => {
      if (isRelay) {
        const squads = groupEntriesIntoRelaySquads(partEntries).sort(
          (a, b) => (a.officialHeat ?? 999) - (b.officialHeat ?? 999) || a.relayTeamCode.localeCompare(b.relayTeamCode)
        );
        return { partLabel, isRelay: true as const, squads, entries: [] as MeetEntryRecord[] };
      }
      const individual = partEntries
        .filter((e) => !e.isAlternate)
        .sort((a, b) => (a.officialHeat ?? 999) - (b.officialHeat ?? 999) || a.athleteName.localeCompare(b.athleteName));
      return { partLabel, isRelay: false as const, squads: [], entries: individual };
    });
  }, [filteredEntries, selectedHeatEvent, partitionByDivision]);

  const externalFieldGroups = useMemo(() => {
    const matching = filteredEntries.filter(
      (e) => e.eventCode === selectedFlightEvent && !e.scratched && !e.isAlternate
    );
    return partitionEntriesByLabel(matching).map(([partLabel, partEntries]) => ({
      partLabel,
      entries: [...partEntries].sort(
        (a, b) =>
          (a.officialFlight ?? 999) - (b.officialFlight ?? 999) ||
          (a.officialOrder ?? 999) - (b.officialOrder ?? 999) ||
          a.athleteName.localeCompare(b.athleteName)
      ),
    }));
  }, [filteredEntries, selectedFlightEvent, partitionByDivision]);

  const selectedEventSpec = useMemo(
    () => ALL_MEET_DAY_EVENTS.find((ev) => ev.code === newEventCode),
    [newEventCode]
  );

  if (!isOpen) return null;

  const handleAddEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAthleteChoice) return;
    const isRelay = selectedEventSpec?.category === 'RELAY';
    const next: MeetEntryRecord = {
      id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      athleteId: activeAthleteChoice.id,
      athleteName: activeAthleteChoice.name,
      genderDivision: newGenderOverride || activeAthleteChoice.gender,
      division: newDivisionOverride || activeAthleteChoice.division || 'Varsity',
      graduationYear: activeAthleteChoice.gradYear,
      eventCode: newEventCode,
      seedMark: newSeedMark.trim() || (selectedEventSpec?.category === 'FIELD' ? 'NM' : 'NT'),
      ...(isRelay ? { relayTeamCode: newRelayTeam, relayLegOrder: newRelayLeg } : {}),
      ...(newIsAlternate ? { isAlternate: true } : {}),
    };
    setEntries((prev) => [next, ...prev]);
    setHasUnsavedChanges(true);
    if (selectedEventSpec?.category === 'FIELD') setSelectedFlightEvent(newEventCode);
    else setSelectedHeatEvent(newEventCode);
  };

  const updateEntryById = (entryId: string, patch: Partial<MeetEntryRecord>) => {
    setHasUnsavedChanges(true);
    setEntries((prev) => prev.map((x) => (x.id === entryId ? { ...x, ...patch } : x)));
  };

  const handleApplyImportedAssignments = (params: {
    parseResult: ExternalHeatSheetParseResult;
    mode: 'MERGE_PRESERVE_CLERK' | 'REPLACE_ALL_ASSIGNMENTS';
    overwriteClerkOverrides: boolean;
  }) => {
    setEntries((prev) => {
      const applied = applyImportedAssignmentsToEntries({
        entries: prev,
        parseResult: params.parseResult,
        mode: params.mode,
        overwriteClerkOverrides: params.overwriteClerkOverrides,
      });
      setPacketFeedback({
        tone: 'prime',
        text: `Applied official program (${applied.updatedCount} updated, ${applied.addedCount} added${
          !params.overwriteClerkOverrides ? `, ${applied.preservedClerkCount} Clerk Overrides preserved` : ''
        }).`,
      });
      return applied.entries;
    });
    setSeedingAuthority('EXTERNAL_MEET');
    setHasUnsavedChanges(true);
    setShowExternalImportPanel(false);
  };

  const handleExportHyTekCsv = () => {
    const csv = generateHyTekSemiColonEntryCsv({
      teamName: activeTeam?.brand.shortName || activeTeam?.brand.name || 'MeetReady',
      entries: effectiveExportEntries,
    });
    const slug = (activeTeam?.brand.slug || 'meetready').toLowerCase();
    triggerFileDownload(csv, `${slug}-hytek-entries.csv`, 'text/csv;charset=utf-8;');
  };

  const handleExportHy3 = () => {
    const hy3 = generateHyTekHy3File({
      meetTitle,
      meetDate,
      entries: effectiveExportEntries,
      teamCode: activeTeam?.brand.shortName || 'MTRDY',
      teamName: activeTeam?.brand.name || 'MeetReady Track & Field',
    });
    const slug = (activeTeam?.brand.slug || 'meetready').toLowerCase();
    triggerFileDownload(hy3, `${slug}-entries.hy3`, 'text/plain;charset=ascii;');
  };

  const handleExportAthleticNetCsv = () => {
    const csv = generateAthleticNetEntryCsv(effectiveExportEntries);
    const slug = (activeTeam?.brand.slug || 'meetready').toLowerCase();
    triggerFileDownload(csv, `${slug}-athleticnet-entries.csv`, 'text/csv;charset=utf-8;');
  };

  const syncTeamPacketsToParent = (nextPackets: MeetDayPacketRecord[]) => {
    if (!activeTeam || !onTeamsUpdated) return;
    const updatedTeam: TeamSummaryWithRole = {
      ...activeTeam,
      meetDayPackets: nextPackets,
    };
    const nextTeams = (myTeams && myTeams.length > 0 ? myTeams : [activeTeam]).map((t) =>
      t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
    );
    onTeamsUpdated(nextTeams, updatedTeam.brand.teamId);
  };

  const handleSavePacket = async (closeAfterSave = false) => {
    if (isSavingPacket) return;
    setIsSavingPacket(true);
    setPacketFeedback(null);
    setPrintPopupBlocked(false);
    const packetId = activePacketId || `mdp_${Date.now()}`;
    const trimmedLiveUrl = athleticLiveUrl.trim();
    const packetPayload: MeetDayPacketRecord = {
      packetId,
      meetTitle: meetTitle.trim() || 'Track & Field Meet',
      meetDate: meetDate || getLocalDateIso(),
      laneCount: 8,
      flightSize: 12,
      partitionByDivision,
      seedingAuthority,
      ...(trimmedLiveUrl ? { athleticLiveUrl: trimmedLiveUrl } : {}),
      meetDelayMinutes,
      entries: serializeMeetEntriesToPacketEntries(entries),
      updatedAt: new Date().toISOString(),
    };

    try {
      if (isLiveServerTeam && activeTeam) {
        const res = await saveMeetDayPacketApi(activeTeam.brand.teamId, packetPayload);
        setSavedPackets(res.packets);
        setActivePacketId(res.packet.packetId);
        saveLocalMeetDayPacket(teamScopeKey, res.packet);
        if (Array.isArray(res.teams) && onTeamsUpdated) {
          onTeamsUpdated(res.teams, activeTeam.brand.teamId);
        } else {
          syncTeamPacketsToParent(res.packets);
        }
        setHasUnsavedChanges(false);
        setShowUnsavedCloseGuard(false);
        setPacketFeedback({
          tone: 'prime',
          text: `Saved "${res.packet.meetTitle}" (${entries.length} entries) to MeetReady team cloud.`,
        });
        if (closeAfterSave) onClose();
        return;
      }

      const nextList = saveLocalMeetDayPacket(teamScopeKey, packetPayload);
      setSavedPackets(nextList);
      setActivePacketId(packetId);
      syncTeamPacketsToParent(nextList);
      setHasUnsavedChanges(false);
      setShowUnsavedCloseGuard(false);
      setPacketFeedback({
        tone: 'prime',
        text: `Saved "${packetPayload.meetTitle}" (${entries.length} entries) on device.`,
      });
      if (closeAfterSave) onClose();
    } catch (err) {
      const nextList = saveLocalMeetDayPacket(teamScopeKey, packetPayload);
      setSavedPackets(nextList);
      setActivePacketId(packetId);
      setHasUnsavedChanges(false);
      setShowUnsavedCloseGuard(false);
      setPacketFeedback({
        tone: 'caution',
        text: `${err instanceof Error ? err.message : 'Cloud sync unavailable'} — saved locally on device.`,
      });
      if (closeAfterSave) onClose();
    } finally {
      setIsSavingPacket(false);
    }
  };

  const handleDeleteSavedPacket = async (pktId: string) => {
    if (!pktId) return;
    try {
      if (isLiveServerTeam && activeTeam) {
        const res = await deleteMeetDayPacketApi(activeTeam.brand.teamId, pktId);
        setSavedPackets(res.packets);
        if (Array.isArray(res.teams) && onTeamsUpdated) {
          onTeamsUpdated(res.teams, activeTeam.brand.teamId);
        } else {
          syncTeamPacketsToParent(res.packets);
        }
      }
    } catch {
      // Fall back to local removal
    }
    const nextLocal = deleteLocalMeetDayPacket(teamScopeKey, pktId);
    if (!isLiveServerTeam) {
      setSavedPackets(nextLocal);
      syncTeamPacketsToParent(nextLocal);
    }
    if (activePacketId === pktId) {
      setActivePacketId('');
    }
    setPacketFeedback({ tone: 'prime', text: 'Deleted saved meet packet.' });
  };

  const genderAndDivisionFilterBar = (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl ap-card-inset px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark mr-1">
          Division:
        </span>
        {(
          [
            { id: 'ALL', label: 'All' },
            { id: 'M', label: 'Boys' },
            { id: 'F', label: 'Girls' },
          ] as const
        ).map((g) => (
          <button
            key={g.id}
            type="button"
            data-testid={`meet-filter-gender-${g.id.toLowerCase()}`}
            aria-pressed={genderFilter === g.id}
            onClick={() => setGenderFilter(g.id)}
            className={`min-h-[36px] px-2.5 rounded-lg font-mono text-2xs font-bold cursor-pointer ${
              genderFilter === g.id
                ? 'ap-nav-volt-active'
                : 'bg-white dark:bg-ap-carbon text-ap-ink dark:text-ap-chalk border border-ap-frame/15 dark:border-ap-edge-dark'
            }`}
          >
            {g.label}
          </button>
        ))}

        <select
          aria-label="Filter Division"
          data-testid="meet-filter-division-select"
          value={divisionFilter}
          onChange={(e) => setDivisionFilter(e.target.value)}
          className="min-h-[36px] rounded-lg border border-ap-frame/20 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 font-mono text-2xs font-semibold text-ap-ink dark:text-ap-chalk"
        >
          <option value="ALL">All Divisions</option>
          {availableDivisions.map((div) => (
            <option key={div} value={div}>
              {div}
            </option>
          ))}
        </select>
      </div>

      <label className="inline-flex items-center gap-1.5 text-2xs font-mono font-semibold text-ap-ink dark:text-ap-chalk cursor-pointer">
        <input
          type="checkbox"
          data-testid="meet-partition-toggle"
          checked={partitionByDivision}
          onChange={(e) => {
            setPartitionByDivision(e.target.checked);
            setHasUnsavedChanges(true);
          }}
          className="accent-[#B83A24]"
        />
        <span>Separate Boys / Girls &amp; Divisions</span>
      </label>
    </div>
  );

  const renderEventTimingButtons = (
    partLabel: string,
    runners: Array<{ membershipId?: string; athleteName: string; laneOrHip?: string }>,
    eventCodeOverride?: string
  ) => {
    if (runners.length === 0 || (!onLaunchEventStopwatch && !onDelegateEventTimer)) {
      return null;
    }
    const targetEventCode = eventCodeOverride || selectedHeatEvent;
    return (
      <div className="inline-flex flex-wrap items-center gap-1.5">
        {onLaunchEventStopwatch && (
          <button
            type="button"
            data-testid={`meet-time-event-${partLabel}`}
            onClick={() =>
              onLaunchEventStopwatch({
                meetTitle,
                meetDate,
                eventCode: targetEventCode,
                runners,
              })
            }
            className="ap-btn-primary !min-h-[32px] px-2.5 py-0.5 text-2xs font-bold inline-flex items-center gap-1 cursor-pointer"
          >
            <Timer className="w-3.5 h-3.5" />
            <span>Time This Event</span>
          </button>
        )}
        {onDelegateEventTimer && (
          <button
            type="button"
            data-testid={`meet-delegate-event-${partLabel}`}
            onClick={() =>
              onDelegateEventTimer({
                meetTitle,
                meetDate,
                eventCode: targetEventCode,
                heatLabel: partLabel,
                runners: runners.map((r) => ({
                  membershipId: r.membershipId,
                  athleteName: r.athleteName,
                  hipOrLane: r.laneOrHip,
                })),
              })
            }
            className="ap-btn-secondary !min-h-[32px] px-2.5 py-0.5 text-2xs font-bold inline-flex items-center gap-1 cursor-pointer"
          >
            <Users className="w-3.5 h-3.5" />
            <span>Delegate</span>
          </button>
        )}
      </div>
    );
  };

  const panelContent = (
    <>
      {/* Header */}
      <div className="px-3 py-3 sm:px-5 border-b border-ap-frame/15 dark:border-ap-edge-dark flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Trophy className="w-5 h-5 ap-text-brand shrink-0" />
              <h2 id={headingId} className="text-sm sm:text-lg font-extrabold tracking-tight truncate">
                Meet-Day Entries, Heats, Flights &amp; NFHS 4-Event Check
              </h2>
            </div>
            <div className="inline-flex flex-wrap items-center gap-1 p-0.5 rounded-xl liquid-capsule-track text-2xs font-mono font-bold">
              <button
                type="button"
                data-testid="meet-authority-external"
                aria-pressed={seedingAuthority === 'EXTERNAL_MEET'}
                onClick={() => {
                  setSeedingAuthority('EXTERNAL_MEET');
                  setHasUnsavedChanges(true);
                }}
                className={`min-h-[34px] px-2.5 rounded-lg cursor-pointer ${seedingAuthority === 'EXTERNAL_MEET' ? 'ap-nav-volt-active' : 'text-ap-ink dark:text-ap-chalk'}`}
              >
                External Meet (Athletic.net / Hy-Tek)
              </button>
              <button
                type="button"
                data-testid="meet-authority-host"
                aria-pressed={seedingAuthority === 'HOST_DUAL_MEET'}
                onClick={() => {
                  setSeedingAuthority('HOST_DUAL_MEET');
                  setHasUnsavedChanges(true);
                }}
                className={`min-h-[34px] px-2.5 rounded-lg cursor-pointer ${seedingAuthority === 'HOST_DUAL_MEET' ? 'ap-nav-volt-active' : 'text-ap-ink dark:text-ap-chalk'}`}
              >
                Host / Dual Meet Seeding
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={meetTitle}
              onChange={(e) => {
                setMeetTitle(e.target.value);
                setHasUnsavedChanges(true);
              }}
              aria-label="Meet Title"
              className="min-h-[38px] rounded-lg border border-ap-frame/20 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-xs font-semibold w-full sm:w-56"
            />
            <input
              type="date"
              value={meetDate}
              onChange={(e) => {
                setMeetDate(e.target.value);
                setHasUnsavedChanges(true);
              }}
              aria-label="Meet Date"
              className="min-h-[38px] rounded-lg border border-ap-frame/20 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 font-mono text-xs"
            />
            <button
              type="button"
              data-testid="meet-save-packet-btn"
              disabled={isSavingPacket}
              onClick={() => void handleSavePacket(false)}
              className="ap-btn-primary !min-h-[38px] px-3 py-1 text-xs font-bold cursor-pointer shrink-0"
            >
              {isSavingPacket ? 'Saving…' : 'Save Packet'}
            </button>
            {savedPackets.length > 0 && (
              <div className="inline-flex items-center gap-1 min-w-0">
                <select
                  aria-label="Saved Meet Packets"
                  data-testid="meet-saved-packets-select"
                  value={activePacketId}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) {
                      setActivePacketId('');
                      setMeetTitle('New Track & Field Meet');
                      setSeedingAuthority('EXTERNAL_MEET');
                      setAthleticLiveUrl('');
                      setMeetDelayMinutes(0);
                      setEntries(buildInitialMeetEntries(activeTeam, connectedAthletes));
                      setHasUnsavedChanges(false);
                      return;
                    }
                    const found = savedPackets.find((p) => p.packetId === val);
                    if (found) applyPacketToEditor(found);
                  }}
                  className="min-h-[38px] max-w-[170px] rounded-lg border border-ap-frame/20 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 font-mono text-2xs"
                >
                  <option value="">+ New Packet</option>
                  {savedPackets.map((p) => (
                    <option key={p.packetId} value={p.packetId}>
                      {p.meetTitle} ({p.meetDate})
                    </option>
                  ))}
                </select>
                {activePacketId && (
                  <button
                    type="button"
                    aria-label="Delete saved meet packet"
                    data-testid="meet-delete-packet-btn"
                    onClick={() => void handleDeleteSavedPacket(activePacketId)}
                    className="min-h-[38px] min-w-[38px] rounded-lg ap-card-inset inline-flex items-center justify-center text-rose-600 dark:text-rose-400 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-2xs font-mono">
            <div className="flex items-center gap-1 flex-1 min-w-[200px]">
              <input
                type="url"
                data-testid="meet-athleticlive-url-input"
                value={athleticLiveUrl}
                onChange={(e) => {
                  setAthleticLiveUrl(e.target.value);
                  setHasUnsavedChanges(true);
                }}
                aria-label="AthleticLIVE URL"
                placeholder="https://live.athletic.net/meets/..."
                className="flex-1 min-w-0 min-h-[34px] rounded-lg border border-ap-frame/20 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-2xs font-mono"
              />
              {/^https:\/\//i.test(athleticLiveUrl.trim()) && (
                <a
                  href={athleticLiveUrl.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open AthleticLIVE meet link"
                  className="min-h-[34px] min-w-[34px] rounded-lg ap-card-inset inline-flex items-center justify-center text-ap-clay dark:text-ap-volt"
                >
                  <ArrowSquareOut className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
            <div className="inline-flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-ap-muted dark:text-ap-muted-dark" />
              <span className="text-ap-muted dark:text-ap-muted-dark font-semibold">Delay:</span>
              {([0, 15, 30] as const).map((mins) => (
                <button
                  key={mins}
                  type="button"
                  data-testid={`meet-delay-${mins}`}
                  aria-pressed={meetDelayMinutes === mins}
                  onClick={() => {
                    setMeetDelayMinutes(mins);
                    setHasUnsavedChanges(true);
                  }}
                  className={`min-h-[32px] px-2 rounded-lg font-bold cursor-pointer ${meetDelayMinutes === mins ? 'ap-nav-volt-active' : 'bg-white dark:bg-ap-carbon border border-ap-frame/15 dark:border-ap-edge-dark'}`}
                >
                  {mins === 0 ? 'On Time' : `+${mins}m`}
                </button>
              ))}
            </div>
          </div>
        </div>
        {inline ? (
          <button
            type="button"
            aria-label="Close Meet-Day Modal"
            onClick={onClose}
            className="min-h-[44px] sm:min-h-[36px] px-3 rounded-xl ap-card-inset inline-flex items-center gap-1.5 text-xs font-bold cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Calendar</span>
          </button>
        ) : (
          <button
            type="button"
            aria-label="Close Meet-Day Modal"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-xl ap-card-inset inline-flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Unsaved Backdrop Guard */}
      {!inline && showUnsavedCloseGuard && (
        <div
          role="alertdialog"
          aria-label="Unsaved meet packet changes"
          data-testid="meet-unsaved-backdrop-guard"
          className="mx-3 mt-3 sm:mx-5 rounded-xl ap-status-caution px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold"
        >
          <span>Unsaved meet packet changes — save before closing?</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-testid="meet-guard-save-close-btn"
              disabled={isSavingPacket}
              onClick={() => void handleSavePacket(true)}
              className="ap-btn-primary !min-h-[34px] px-2.5 py-1 text-2xs font-bold cursor-pointer"
            >
              Save Packet
            </button>
            <button
              type="button"
              data-testid="meet-guard-discard-btn"
              onClick={() => {
                setShowUnsavedCloseGuard(false);
                setHasUnsavedChanges(false);
                onClose();
              }}
              className="ap-btn-secondary !min-h-[34px] px-2.5 py-1 text-2xs font-bold cursor-pointer"
            >
              Discard &amp; Close
            </button>
            <button
              type="button"
              data-testid="meet-guard-keep-editing-btn"
              onClick={() => setShowUnsavedCloseGuard(false)}
              className="min-h-[34px] px-2.5 py-1 rounded-lg bg-white dark:bg-ap-carbon border border-ap-frame/20 text-2xs font-bold cursor-pointer"
            >
              Keep Editing
            </button>
          </div>
        </div>
      )}

      {/* Sub-Tabs & Export Buttons */}
      <div className="px-3 sm:px-5 py-2 border-b border-ap-frame/15 dark:border-ap-edge-dark flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex flex-wrap items-center gap-1 p-0.5 rounded-xl liquid-capsule-track text-xs font-bold">
          {(
            [
              { id: 'ENTRIES', label: `Entries (${entries.length})`, testId: 'meet-tab-entries' },
              { id: 'SCHEDULE', label: 'Schedule / Now', testId: 'meet-tab-schedule' },
              { id: 'HEATS', label: 'Track Heats & Lanes', testId: 'meet-tab-heats' },
              { id: 'FLIGHTS', label: 'Field Flights', testId: 'meet-tab-flights' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              data-testid={t.testId}
              aria-pressed={subTab === t.id}
              onClick={() => setSubTab(t.id)}
              className={`min-h-[44px] sm:min-h-[34px] px-2.5 sm:px-3 py-1 rounded-lg cursor-pointer ${subTab === t.id ? 'ap-nav-volt-active' : 'text-ap-ink dark:text-ap-chalk'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 w-full sm:w-auto">
          <button
            type="button"
            data-testid="meet-mobile-exports-toggle"
            aria-expanded={mobileExportsOpen}
            onClick={() => setMobileExportsOpen((v) => !v)}
            className="sm:hidden ap-btn-secondary !min-h-[44px] px-3 py-1 text-xs font-bold inline-flex items-center justify-between gap-1.5 cursor-pointer"
          >
            <span className="inline-flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" />
              <span>Exports &amp; Print (.hy3 / CSV / PDF)</span>
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${mobileExportsOpen ? 'rotate-180' : ''}`}
            />
          </button>

          <div
            className={`${mobileExportsOpen ? 'flex' : 'hidden sm:flex'} flex-wrap items-center gap-1.5`}
          >
            <button
              type="button"
              data-testid="meet-export-hy3-btn"
              onClick={handleExportHy3}
              className="ap-btn-secondary !min-h-[44px] sm:!min-h-[34px] px-2.5 py-1 text-2xs sm:text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export .hy3 (Hy-Tek)</span>
            </button>
            <button
              type="button"
              data-testid="meet-export-athleticnet-btn"
              onClick={handleExportAthleticNetCsv}
              className="ap-btn-secondary !min-h-[44px] sm:!min-h-[34px] px-2.5 py-1 text-2xs sm:text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Athletic.net CSV</span>
            </button>
            <button
              type="button"
              data-testid="meet-export-hytek-btn"
              onClick={handleExportHyTekCsv}
              className="ap-btn-secondary !min-h-[44px] sm:!min-h-[34px] px-2.5 py-1 text-2xs sm:text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Hy-Tek CSV</span>
            </button>
            <button
              type="button"
              data-testid="meet-print-packet-btn"
              onClick={() => {
                const opened = openPrintableMeetDayPacketWindow({
                  teamName: activeTeam?.brand.name || 'MeetReady Track & Field',
                  meetTitle,
                  meetDate,
                  entries: effectiveExportEntries,
                  partitionByDivision,
                  seedingAuthority,
                  athleticLiveUrl: athleticLiveUrl.trim() || undefined,
                  meetDelayMinutes,
                  showItinerary: true,
                });
                setPrintPopupBlocked(!opened);
                if (!opened) {
                  setPacketFeedback({
                    tone: 'caution',
                    text: 'Print window was blocked by the browser. Allow pop-ups or use Download Offline HTML below.',
                  });
                }
              }}
              className="ap-btn-primary !min-h-[44px] sm:!min-h-[34px] px-3 py-1 text-2xs sm:text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
            >
              <ClipboardText className="w-3.5 h-3.5" />
              <span>Print Packet</span>
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className={inline ? 'p-3 sm:p-5 space-y-3 text-xs' : 'flex-1 overflow-y-auto p-3 sm:p-5 space-y-3 text-xs'}>
          {packetFeedback && (
            <div
              role="status" data-testid="meet-packet-feedback"
              className={`rounded-xl px-3.5 py-2 font-semibold flex flex-wrap items-center justify-between gap-2 ${packetFeedback.tone === 'prime' ? 'ap-status-prime' : 'ap-status-caution'}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {packetFeedback.tone === 'prime' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                <span>{packetFeedback.text}</span>
              </div>
              {printPopupBlocked && (
                <button
                  type="button" data-testid="meet-download-offline-html-btn"
                  onClick={() => {
                    downloadMeetPacketHtmlFallback({
                      teamName: activeTeam?.brand.name || 'MeetReady Track & Field',
                      meetTitle, meetDate, entries: effectiveExportEntries, partitionByDivision,
                      seedingAuthority, athleticLiveUrl: athleticLiveUrl.trim() || undefined, meetDelayMinutes, showItinerary: true,
                    });
                    setPacketFeedback({ tone: 'prime', text: 'Downloaded offline HTML meet packet.' });
                    setPrintPopupBlocked(false);
                  }}
                  className="ap-btn-secondary !min-h-[34px] px-2.5 py-1 text-2xs font-bold inline-flex items-center gap-1 cursor-pointer shrink-0"
                ><Download className="w-3.5 h-3.5" /><span>Download Offline HTML</span></button>
              )}
            </div>
          )}

          {/* NFHS Rule 4-2 Banner */}
          <div data-testid="nfhs-event-limit-panel" className="space-y-1.5">
            {violations.length > 0 ? (
              <div data-testid="nfhs-over-limit-alert" className="rounded-xl ap-status-strained px-3.5 py-2.5 flex items-center gap-2 font-bold">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>NFHS Rule 4-2 Violation (&gt;4 events): {violations.map((v) => `${v.athleteName} (${v.eventCount}: ${v.events.join(', ')})`).join(' · ')}</span>
              </div>
            ) : (
              <div className="rounded-xl ap-status-prime px-3.5 py-2 flex items-center gap-2 font-semibold">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>NFHS Rule 4-2 Verified: All active entered athletes are within the 4-event limit.</span>
              </div>
            )}
            {alternateAdvisories.length > 0 && (
              <div data-testid="nfhs-alternate-advisory" className="rounded-xl ap-status-caution px-3.5 py-2 flex items-center gap-2 font-semibold">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Alternate Advisory (count if activated): {alternateAdvisories.map((a) => `${a.athleteName} (${a.eventCount} active + ${a.alternateCount} alt: ${(a.alternateEvents || []).join(', ')})`).join(' · ')}</span>
              </div>
            )}
          </div>

          {genderAndDivisionFilterBar}

          {isFilterActive && (
            <div data-testid="meet-export-scope-banner" className="rounded-xl ap-status-caution px-3 py-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-2xs font-semibold">
                Filter active ({activeFilteredEntries.length} shown of {activeAllEntries.length} active team entries). Exports default to Full Team.
              </span>
              <div className="inline-flex flex-wrap items-center gap-1.5">
                <button
                  type="button" data-testid="meet-export-scope-full" aria-pressed={exportScope === 'FULL_TEAM'} onClick={() => setExportScope('FULL_TEAM')}
                  className={`min-h-[34px] px-2.5 rounded-lg font-mono text-2xs font-bold cursor-pointer ${exportScope === 'FULL_TEAM' ? 'ap-nav-volt-active' : 'bg-white dark:bg-ap-carbon text-ap-ink dark:text-ap-chalk border border-ap-frame/20'}`}
                >Export Full Team ({activeAllEntries.length})</button>
                <button
                  type="button" data-testid="meet-export-scope-filtered" aria-pressed={exportScope === 'FILTERED_ONLY'} onClick={() => setExportScope('FILTERED_ONLY')}
                  className={`min-h-[34px] px-2.5 rounded-lg font-mono text-2xs font-bold cursor-pointer ${exportScope === 'FILTERED_ONLY' ? 'ap-nav-volt-active' : 'bg-white dark:bg-ap-carbon text-ap-ink dark:text-ap-chalk border border-ap-frame/20'}`}
                >Export Filtered Only ({activeFilteredEntries.length})</button>
              </div>
            </div>
          )}

          {subTab === 'ENTRIES' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl ap-card-inset px-3 py-2">
                <span className="text-2xs text-ap-muted dark:text-ap-muted-dark">
                  {entries.length === 0
                    ? 'Start from a clean slate, pull verified marks, or paste official Friday-night heat sheets.'
                    : 'Seed missing roster marks or import official Hy-Tek / AthleticLIVE heat & flight assignments.'}
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button" data-testid="toggle-external-heat-import-btn" onClick={() => setShowExternalImportPanel((v) => !v)}
                    className={`!min-h-[44px] sm:!min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${showExternalImportPanel ? 'ap-nav-volt-active' : 'ap-btn-secondary'}`}
                  ><ClipboardPaste className="w-3.5 h-3.5" /><span>{showExternalImportPanel ? 'Hide Heat Sheet Importer' : 'Import Heat Sheet'}</span></button>
                  {activeTeam && (
                    <button
                      type="button" data-testid="meet-seed-roster-marks-btn"
                      onClick={() => {
                        const rosterEntries = buildEntriesFromRosterMarks(activeTeam);
                        if (rosterEntries.length === 0) {
                          setPacketFeedback({ tone: 'caution', text: 'No verified roster seed marks or official results found yet. Add entries manually or sync Athletic.net / TFRRS marks.' });
                          return;
                        }
                        setEntries((prev) => {
                          const existingKeys = new Set(prev.map((e) => `${e.athleteId}:${e.eventCode}`));
                          const additions = rosterEntries.filter((r) => !existingKeys.has(`${r.athleteId}:${r.eventCode}`));
                          if (additions.length > 0) setHasUnsavedChanges(true);
                          return [...prev, ...additions];
                        });
                        setPacketFeedback({ tone: 'prime', text: `Seeded ${rosterEntries.length} verified roster mark${rosterEntries.length === 1 ? '' : 's'}.` });
                      }}
                      className="ap-btn-secondary !min-h-[44px] sm:!min-h-[34px] px-3 py-1 text-xs font-bold cursor-pointer shrink-0"
                    >Seed from Roster Marks</button>
                  )}
                </div>
              </div>

              {showExternalImportPanel && (
                <ExternalHeatSheetImportPanel
                  entries={entries} memberships={activeTeam?.memberships || []}
                  onApplyImportedAssignments={handleApplyImportedAssignments} onClose={() => setShowExternalImportPanel(false)}
                />
              )}

              <form onSubmit={handleAddEntry} className="rounded-xl ap-card-inset p-3 grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                <label className="sm:col-span-3 space-y-1">
                  <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">Athlete</span>
                  <select data-testid="meet-add-athlete-select" value={activeAthleteChoice?.id || ''} onChange={(e) => setNewAthleteKey(e.target.value)} className="w-full min-h-[44px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 font-semibold">
                    {athleteChoices.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.gender === 'F' ? 'F' : 'M'})</option>)}
                  </select>
                </label>
                <label className="sm:col-span-2 space-y-1">
                  <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">Gender / Div</span>
                  <div className="flex gap-1">
                    <select aria-label="New Entry Gender" value={newGenderOverride || activeAthleteChoice?.gender || 'M'} onChange={(e) => setNewGenderOverride(e.target.value as MeetGenderDivision)} className="w-16 min-h-[44px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-1.5 font-mono font-bold">
                      <option value="M">Boys</option><option value="F">Girls</option><option value="NONBINARY">NB</option>
                    </select>
                    <select aria-label="New Entry Division" value={newDivisionOverride || activeAthleteChoice?.division || 'Varsity'} onChange={(e) => setNewDivisionOverride(e.target.value)} className="flex-1 min-w-0 min-h-[44px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-1.5 font-mono text-2xs">
                      {MEET_DIVISION_CHOICES.map((d) => <option key={d} value={d}>{d === 'Junior Varsity' ? 'JV' : d}</option>)}
                    </select>
                  </div>
                </label>
                <label className="sm:col-span-3 space-y-1">
                  <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">Event</span>
                  <select data-testid="meet-add-event-select" value={newEventCode} onChange={(e) => setNewEventCode(e.target.value)} className="w-full min-h-[44px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 font-mono font-bold">
                    {ALL_MEET_DAY_EVENTS.map((ev) => <option key={ev.code} value={ev.code}>{ev.label}</option>)}
                  </select>
                </label>
                <label className="sm:col-span-2 space-y-1">
                  <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">Seed Time / Mark</span>
                  <input type="text" data-testid="meet-add-seed-input" value={newSeedMark} onChange={(e) => setNewSeedMark(e.target.value)} placeholder="11.20 or 21' 6&quot;" className="w-full min-h-[44px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 font-mono" />
                </label>
                <button type="submit" data-testid="meet-add-entry-btn" className="sm:col-span-2 ap-btn-primary !min-h-[44px] px-3 py-2 font-bold inline-flex items-center justify-center gap-1 cursor-pointer">
                  <Plus className="w-4 h-4" /> Add
                </button>
                <div className="sm:col-span-12 flex flex-wrap items-center gap-3 pt-1 text-2xs font-mono">
                  {selectedEventSpec?.category === 'RELAY' && (
                    <>
                      <span className="text-ap-muted dark:text-ap-muted-dark">Relay Quartet:</span>
                      <select aria-label="Relay Squad Letter" value={newRelayTeam} onChange={(e) => setNewRelayTeam(e.target.value)} className="min-h-[34px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 font-bold">
                        <option value="A">Team A</option><option value="B">Team B</option><option value="C">Team C</option>
                      </select>
                      <select aria-label="Relay Leg Order" value={newRelayLeg} onChange={(e) => setNewRelayLeg(Number(e.target.value) as 1 | 2 | 3 | 4)} className="min-h-[34px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 font-bold">
                        <option value={1}>Leg 1 (Leadoff)</option><option value={2}>Leg 2</option><option value={3}>Leg 3</option><option value={4}>Leg 4 (Anchor)</option>
                      </select>
                    </>
                  )}
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={newIsAlternate} onChange={(e) => setNewIsAlternate(e.target.checked)} className="accent-[#B83A24]" />
                    <span>Mark as Alternate</span>
                  </label>
                </div>
              </form>

              <div
                data-testid="meet-entries-filter-strip"
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl ap-card-inset px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[200px]">
                  <div className="relative flex-1 min-w-[160px]">
                    <Search className="w-3.5 h-3.5 text-ap-muted dark:text-ap-muted-dark absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="search"
                      aria-label="Search meet entries"
                      data-testid="meet-entries-search-input"
                      value={entriesSearchQuery}
                      onChange={(e) => setEntriesSearchQuery(e.target.value)}
                      placeholder="Search athlete, event, bib, or seed..."
                      className="w-full min-h-[38px] rounded-lg border border-ap-frame/20 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon pl-8 pr-2.5 text-xs"
                    />
                  </div>
                  <select
                    aria-label="Filter by Event"
                    data-testid="meet-filter-event"
                    value={eventFilter}
                    onChange={(e) => setEventFilter(e.target.value)}
                    className="min-h-[38px] rounded-lg border border-ap-frame/20 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 font-mono text-2xs font-semibold text-ap-ink dark:text-ap-chalk"
                  >
                    <option value="ALL">All Events</option>
                    {availableEntryEvents.map((evCode) => (
                      <option key={evCode} value={evCode}>
                        {evCode}
                      </option>
                    ))}
                  </select>
                </div>
                <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark shrink-0">
                  Showing {visibleEntriesList.length} of {filteredEntries.length}
                </span>
              </div>

              <div className="space-y-1.5">
                {visibleEntriesList.length === 0 ? (
                  <div className="rounded-xl ap-card-inset p-4 text-center text-ap-muted dark:text-ap-muted-dark space-y-2">
                    <p>
                      {filteredEntries.length === 0
                        ? 'No entries match the active Boys / Girls or Division filter.'
                        : 'No entries match your search or event filter.'}
                    </p>
                    {(entriesSearchQuery.trim() || eventFilter !== 'ALL') && (
                      <button
                        type="button"
                        onClick={() => {
                          setEntriesSearchQuery('');
                          setEventFilter('ALL');
                        }}
                        className="ap-btn-secondary !min-h-[34px] px-3 py-1 text-2xs font-bold cursor-pointer"
                      >
                        Clear Search Filters
                      </button>
                    )}
                  </div>
                ) : (
                  visibleEntriesList.map((entry) => (
                    <MeetDayEntryRow
                      key={entry.id}
                      entry={entry}
                      availableDivisions={availableDivisions}
                      isInjured={injuredMemberIds.has(entry.athleteId)}
                      isClerkOpen={editingClerkEntryId === entry.id}
                      meetDelayMinutes={meetDelayMinutes}
                      onToggleClerk={() =>
                        setEditingClerkEntryId(editingClerkEntryId === entry.id ? null : entry.id)
                      }
                      onUpdate={(patch) => updateEntryById(entry.id, patch)}
                      onRemove={() => {
                        setHasUnsavedChanges(true);
                        setEntries((prev) => prev.filter((x) => x.id !== entry.id));
                      }}
                    />
                  ))
                )}
              </div>
            </>
          )}

          {subTab === 'SCHEDULE' && (
            <div data-testid="meet-schedule-view" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                  Chronological event call &amp; start order across your active team entries
                  {meetDelayMinutes > 0 ? ` (+${meetDelayMinutes}m meet delay applied)` : ''}.
                </span>
              </div>
              {chronologicalScheduleBlocks.length === 0 ? (
                <div className="rounded-xl ap-card-inset p-4 text-ap-muted dark:text-ap-muted-dark">
                  No active entries matching the current division filter. Add or import entries to build the meet schedule.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {chronologicalScheduleBlocks.map((block) => (
                    <div
                      key={block.key}
                      data-testid={`meet-schedule-block-${block.eventCode}`}
                      className="rounded-xl ap-card-inset p-3 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white dark:bg-ap-carbon border border-ap-frame/20 dark:border-ap-edge-dark font-mono text-2xs font-bold text-ap-clay dark:text-ap-volt">
                            <Clock className="w-3 h-3" />
                            <span>{block.delayedStartTime || block.delayedCallTime || 'Time TBD'}</span>
                            {block.hasDelayApplied && (
                              <span className="text-ap-muted dark:text-ap-muted-dark font-normal">
                                (delayed +{meetDelayMinutes}m)
                              </span>
                            )}
                          </span>
                          {block.delayedCallTime && block.delayedStartTime && (
                            <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                              Call {block.delayedCallTime}
                            </span>
                          )}
                          <span className="font-bold text-ap-ink dark:text-ap-chalk truncate">
                            {block.eventLabel}
                          </span>
                          <span className="text-2xs font-mono uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark">
                            {block.partLabel}
                          </span>
                        </div>
                        {!block.isField &&
                          renderEventTimingButtons(
                            `sched-${block.eventCode}-${block.partLabel}`,
                            block.runners,
                            block.eventCode
                          )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 font-mono text-2xs">
                        {block.entries.map((entry) => {
                          const slotTag = block.isField
                            ? entry.officialFlight
                              ? `Fl ${entry.officialFlight}${entry.officialOrder ? `#${entry.officialOrder}` : ''}`
                              : null
                            : entry.officialHeat || entry.officialLaneOrHip
                              ? [
                                  entry.officialHeat ? `H${entry.officialHeat}` : '',
                                  entry.officialLaneOrHip
                                    ? formatOfficialLaneOrHip(entry.eventCode, entry.officialLaneOrHip)
                                    : '',
                                ]
                                  .filter(Boolean)
                                  .join(' ')
                              : null;
                          return (
                            <span
                              key={entry.id}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white dark:bg-ap-carbon border border-ap-frame/15 dark:border-ap-edge-dark"
                            >
                              <span className="font-semibold">{entry.athleteName}</span>
                              {entry.bibNumber && (
                                <span className="text-ap-muted dark:text-ap-muted-dark">
                                  #{entry.bibNumber}
                                </span>
                              )}
                              {slotTag && (
                                <span className="text-ap-clay dark:text-ap-volt font-bold">
                                  · {slotTag}
                                </span>
                              )}
                              <span className="text-ap-muted dark:text-ap-muted-dark">
                                ({entry.seedMark})
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {subTab === 'HEATS' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {ALL_MEET_DAY_EVENTS.filter((e) => e.category !== 'FIELD').map((ev) => (
                    <button key={ev.code} type="button" onClick={() => setSelectedHeatEvent(ev.code)} className={`min-h-[36px] px-2.5 py-1 rounded-lg font-mono font-bold cursor-pointer ${selectedHeatEvent === ev.code ? 'ap-nav-volt-active' : 'ap-card-inset'}`}>
                      {ev.code}
                    </button>
                  ))}
                </div>
                {seedingAuthority === 'HOST_DUAL_MEET' && (
                  <button
                    type="button" data-testid="meet-host-slow-to-fast-toggle" aria-pressed={hostSlowToFast}
                    onClick={() => setHostSlowToFast((v) => !v)}
                    className="min-h-[34px] px-2.5 rounded-lg ap-card-inset font-mono text-2xs font-bold cursor-pointer"
                  >
                    Order: {hostSlowToFast ? 'Slow-to-Fast' : 'Fast-First'}
                  </button>
                )}
              </div>

              {seedingAuthority === 'EXTERNAL_MEET' ? (
                externalTrackGroups.length === 0 ? (
                  <div className="rounded-xl ap-card-inset p-4 text-ap-muted dark:text-ap-muted-dark">
                    No active entries in {selectedHeatEvent} matching the active division filter.
                  </div>
                ) : (
                  <div className="space-y-3 font-mono">
                    {externalTrackGroups.map((grp) => {
                      const runnersForEvent = grp.isRelay
                        ? grp.squads.map((sq) => ({ membershipId: sq.representativeEntry.athleteId, athleteName: `${sq.eventCode} Team ${sq.relayTeamCode}`, laneOrHip: sq.officialLaneOrHip }))
                        : grp.entries.map((e) => ({ membershipId: e.athleteId, athleteName: e.athleteName, laneOrHip: e.officialLaneOrHip }));
                      return (
                        <div key={grp.partLabel} className="space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                            <span className="text-2xs font-bold uppercase tracking-wider text-ap-clay dark:text-ap-volt">
                              {grp.partLabel} · {selectedHeatEvent} (Official Program)
                            </span>
                            {renderEventTimingButtons(grp.partLabel, runnersForEvent)}
                          </div>
                          {grp.isRelay
                            ? grp.squads.map((sq) => {
                                const slotLabel = sq.officialHeat || sq.officialLaneOrHip
                                  ? [sq.officialHeat ? `Heat ${sq.officialHeat}` : '', sq.officialLaneOrHip ? formatOfficialLaneOrHip(selectedHeatEvent, sq.officialLaneOrHip) : ''].filter(Boolean).join(' · ')
                                  : 'TBD (Official Program)';
                                const delayedStart = applyDelayToMeetTimeString(sq.eventStartTime, meetDelayMinutes);
                                const delayedCall = applyDelayToMeetTimeString(sq.checkInCallTime, meetDelayMinutes);
                                return (
                                  <div key={sq.squadKey} className="rounded-xl ap-card-inset px-3 py-2 space-y-1">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="min-w-0"><strong className="text-ap-clay dark:text-ap-volt">{slotLabel}</strong> — Team {sq.relayTeamCode}</span>
                                      <span className="font-bold shrink-0">Seed {sq.seedMark}{delayedCall ? ` · Call ${delayedCall}` : ''}{delayedStart ? ` · ${delayedStart}` : ''}</span>
                                    </div>
                                    <div className="text-2xs text-ap-muted dark:text-ap-muted-dark">
                                      Legs: {sq.activeLegs.map((l, i) => `${l.relayLegOrder || i + 1}) ${l.athleteName}`).join(' · ')}
                                      {sq.alternates.length > 0 ? ` · Alt: ${sq.alternates.map((a) => a.athleteName).join(', ')}` : ''}
                                    </div>
                                  </div>
                                );
                              })
                            : grp.entries.map((entry) => {
                                const slotLabel = entry.officialHeat || entry.officialLaneOrHip
                                  ? [entry.officialHeat ? `Heat ${entry.officialHeat}` : '', entry.officialLaneOrHip ? formatOfficialLaneOrHip(selectedHeatEvent, entry.officialLaneOrHip) : ''].filter(Boolean).join(' · ')
                                  : 'TBD (Official Program)';
                                const delayedStart = applyDelayToMeetTimeString(entry.eventStartTime, meetDelayMinutes);
                                const delayedCall = applyDelayToMeetTimeString(entry.checkInCallTime, meetDelayMinutes);
                                return (
                                  <div key={entry.id} className="rounded-xl ap-card-inset px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                                    <span className="min-w-0 truncate">
                                      <strong className="text-ap-clay dark:text-ap-volt">{slotLabel}</strong> — {entry.athleteName}{entry.bibNumber ? ` #${entry.bibNumber}` : ''}
                                    </span>
                                    <span className="font-bold shrink-0">Seed {entry.seedMark}{delayedCall ? ` · Call ${delayedCall}` : ''}{delayedStart ? ` · ${delayedStart}` : ''}</span>
                                  </div>
                                );
                              })}
                        </div>
                      );
                    })}
                  </div>
                )
              ) : groupedHeats.length === 0 ? (
                <div className="rounded-xl ap-card-inset p-4 text-ap-muted dark:text-ap-muted-dark">
                  No entries in {selectedHeatEvent} matching the active division filter. Add an athlete in Entries tab.
                </div>
              ) : (
                <div className="space-y-3 font-mono">
                  {groupedHeats.map(([partLabel, rows]) => {
                    const runnersForGroup = rows.map((h) => ({ membershipId: h.athleteId, athleteName: h.athleteName, laneOrHip: h.officialLaneOrHip || h.positionLabel || `Lane ${h.lane}` }));
                    return (
                      <div key={partLabel} className="space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                          <span className="text-2xs font-bold uppercase tracking-wider text-ap-clay dark:text-ap-volt">{partLabel} · {selectedHeatEvent}</span>
                          {renderEventTimingButtons(partLabel, runnersForGroup)}
                        </div>
                        {rows.map((h) => {
                          const posDisp = h.officialLaneOrHip ? formatOfficialLaneOrHip(selectedHeatEvent, h.officialLaneOrHip) : h.positionLabel || `Lane ${h.lane}`;
                          const heatDisp = h.officialHeat ?? h.heatNumber;
                          return (
                            <div key={`${partLabel}-${h.heatNumber}-${h.lane}-${h.athleteId}`} className="rounded-xl ap-card-inset px-3 py-2 flex items-center justify-between gap-2">
                              <span className="min-w-0 truncate"><strong className="text-ap-clay dark:text-ap-volt">Heat {heatDisp} · {posDisp}</strong> — {h.athleteName}</span>
                              <span className="font-bold shrink-0">Seed {h.seedMark}</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {subTab === 'FLIGHTS' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {ALL_MEET_DAY_EVENTS.filter((e) => e.category === 'FIELD').map((ev) => (
                  <button key={ev.code} type="button" onClick={() => setSelectedFlightEvent(ev.code)} className={`min-h-[36px] px-2.5 py-1 rounded-lg font-mono font-bold cursor-pointer ${selectedFlightEvent === ev.code ? 'ap-nav-volt-active' : 'ap-card-inset'}`}>
                    {ev.code}
                  </button>
                ))}
              </div>
              {seedingAuthority === 'EXTERNAL_MEET' ? (
                externalFieldGroups.length === 0 ? (
                  <div className="rounded-xl ap-card-inset p-4 text-ap-muted dark:text-ap-muted-dark">
                    No active field entries in {selectedFlightEvent} matching the active division filter.
                  </div>
                ) : (
                  <div className="space-y-3 font-mono">
                    {externalFieldGroups.map((grp) => (
                      <div key={grp.partLabel} className="space-y-1.5">
                        <div className="text-2xs font-bold uppercase tracking-wider text-ap-clay dark:text-ap-volt px-1">
                          {grp.partLabel} · {selectedFlightEvent} (Official Program)
                        </div>
                        {grp.entries.map((entry) => {
                          const flightLabel = entry.officialFlight ? `Flight ${entry.officialFlight}${entry.officialOrder ? ` #${entry.officialOrder}` : ''}` : 'TBD (Official Program)';
                          const delayedStart = applyDelayToMeetTimeString(entry.eventStartTime, meetDelayMinutes);
                          return (
                            <div key={entry.id} className="rounded-xl ap-card-inset px-3 py-2 flex items-center justify-between gap-2">
                              <span className="min-w-0 truncate"><strong className="text-ap-clay dark:text-ap-volt">{flightLabel}</strong> — {entry.athleteName}</span>
                              <span className="font-bold shrink-0">Seed {entry.seedMark}{delayedStart ? ` · ${delayedStart}` : ''}</span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )
              ) : groupedFlights.length === 0 ? (
                <div className="rounded-xl ap-card-inset p-4 text-ap-muted dark:text-ap-muted-dark">
                  No field entries in {selectedFlightEvent} matching the active division filter. Add an athlete in Entries tab.
                </div>
              ) : (
                <div className="space-y-3 font-mono">
                  {groupedFlights.map(([partLabel, rows]) => (
                    <div key={partLabel} className="space-y-1.5">
                      <div className="text-2xs font-bold uppercase tracking-wider text-ap-clay dark:text-ap-volt px-1">{partLabel} · {selectedFlightEvent}</div>
                      {rows.map((f) => (
                        <div key={`${partLabel}-${f.flightNumber}-${f.orderIndex}-${f.athleteId}`} className="rounded-xl ap-card-inset px-3 py-2 flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate"><strong className="text-ap-clay dark:text-ap-volt">Flight {f.flightNumber} #{f.orderIndex}</strong> — {f.athleteName}</span>
                          <span className="font-bold shrink-0">Seed {f.seedMark}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
    </>
  );

  if (inline) {
    return (
      <section
        data-testid="meet-day-packet-modal"
        aria-labelledby={headingId}
        className="w-full rounded-2xl bg-ap-chalk dark:bg-ap-obsidian text-ap-ink dark:text-ap-chalk border border-ap-edge flex flex-col shadow-sm overflow-hidden"
      >
        {panelContent}
      </section>
    );
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      tabIndex={-1}
      data-testid="meet-day-packet-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          if (hasUnsavedChanges) {
            setShowUnsavedCloseGuard(true);
            return;
          }
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-2 sm:p-4"
    >
      <div className="w-full max-w-4xl max-h-[92vh] rounded-2xl bg-ap-chalk dark:bg-ap-obsidian text-ap-ink dark:text-ap-chalk border border-ap-edge flex flex-col shadow-2xl overflow-hidden">
        {panelContent}
      </div>
    </div>
  );
};
