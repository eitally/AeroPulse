import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardText,
  Download,
  Plus,
  Trash2,
  Trophy,
  X,
} from '../icons/PhosphorIcons';
import {
  ALL_MEET_DAY_EVENTS,
  MEET_DIVISION_CHOICES,
  generateAthleticNetEntryCsv,
  generateHyTekHy3File,
  generateHyTekSemiColonEntryCsv,
  inferDivisionFromSquadGroup,
  openPrintableMeetDayPacketWindow,
  seedFieldFlights,
  seedTrackHeats,
  validateNfhsFourEventLimits,
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
  meetEntriesToPacketEntries,
  packetEntriesToMeetEntries,
  saveLocalMeetDayPacket,
  saveMeetDayPacketApi,
} from '../../utils/meetDayOpsApi';
import { getLocalDateIso } from '../../physiology/stravaLoadCalibration';
import type {
  ConnectedAthleteRecord,
  MeetDayPacketRecord,
  TeamSummaryWithRole,
} from '../../types';

export interface MeetDayHeatAndFlightModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTeam: TeamSummaryWithRole | null;
  connectedAthletes: ConnectedAthleteRecord[];
  myTeams?: TeamSummaryWithRole[];
  onTeamsUpdated?: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string) => void;
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

function buildInitialMeetEntries(
  activeTeam: TeamSummaryWithRole | null,
  connectedAthletes: ConnectedAthleteRecord[]
): MeetEntryRecord[] {
  const rosterSource =
    (activeTeam?.memberships || []).filter((m) => m.role === 'ATHLETE' && m.status !== 'REVOKED')
      .length > 0
      ? (activeTeam?.memberships || [])
          .filter((m) => m.role === 'ATHLETE' && m.status !== 'REVOKED')
          .map((m) => ({
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
    const defaultEv =
      group === 'SPRINTS'
        ? idx % 2 === 0
          ? { code: '100m', mark: '11.24' }
          : { code: '400m', mark: '50.80' }
        : group === 'HURDLES'
          ? { code: '110mH', mark: '14.85' }
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
      genderDivision: ath.gender || (idx % 2 === 0 ? 'M' : 'F'),
      division: ath.division || 'Varsity',
      graduationYear: ath.gradYear,
      eventCode: defaultEv.code,
      seedMark: defaultEv.mark,
    });
  });

  if (seeded.length === 0) {
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

export const MeetDayHeatAndFlightModal: React.FC<MeetDayHeatAndFlightModalProps> = ({
  isOpen,
  onClose,
  activeTeam,
  connectedAthletes,
  myTeams,
  onTeamsUpdated,
}) => {
  const teamScopeKey = activeTeam?.brand.teamId || 'local';
  const isLiveServerTeam = Boolean(
    activeTeam && !activeTeam.brand.teamId.startsWith('demo_team_')
  );

  const [activePacketId, setActivePacketId] = useState<string>('');
  const [savedPackets, setSavedPackets] = useState<MeetDayPacketRecord[]>([]);
  const [meetTitle, setMeetTitle] = useState<string>('League Dual / Saturday Invitational');
  const [meetDate, setMeetDate] = useState<string>(() => getLocalDateIso());
  const [subTab, setSubTab] = useState<'ENTRIES' | 'HEATS' | 'FLIGHTS'>('ENTRIES');
  const [entries, setEntries] = useState<MeetEntryRecord[]>(() =>
    buildInitialMeetEntries(activeTeam, connectedAthletes)
  );
  const [partitionByDivision, setPartitionByDivision] = useState<boolean>(true);
  const [genderFilter, setGenderFilter] = useState<'ALL' | 'M' | 'F'>('ALL');
  const [divisionFilter, setDivisionFilter] = useState<string>('ALL');

  const [newAthleteKey, setNewAthleteKey] = useState<string>('');
  const [newEventCode, setNewEventCode] = useState<string>('100m');
  const [newSeedMark, setNewSeedMark] = useState<string>('11.40');
  const [newGenderOverride, setNewGenderOverride] = useState<MeetGenderDivision | ''>('');
  const [newDivisionOverride, setNewDivisionOverride] = useState<string>('');
  const [newRelayTeam, setNewRelayTeam] = useState<string>('A');
  const [newRelayLeg, setNewRelayLeg] = useState<1 | 2 | 3 | 4>(1);

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
    setEntries(packetEntriesToMeetEntries(pkt.entries));
  };

  useEffect(() => {
    if (!isOpen) {
      hydratedOpenRef.current = null;
      return;
    }
    if (hydratedOpenRef.current === teamScopeKey) return;
    hydratedOpenRef.current = teamScopeKey;
    setPacketFeedback(null);

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
      setEntries(buildInitialMeetEntries(activeTeam, connectedAthletes));
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

  const athleteChoices = useMemo(() => {
    const members = (activeTeam?.memberships || [])
      .filter((m) => m.role === 'ATHLETE' && m.status !== 'REVOKED')
      .map((m) => ({
        id: m.membershipId,
        name: m.invitedName,
        gender: resolveCompetitionGender(m.genderDivision, undefined, m.squadGroup) || ('M' as const),
        division: inferDivisionFromSquadGroup(m.squadGroup),
        gradYear: m.graduationYear,
      }));
    if (members.length > 0) return members;
    if (connectedAthletes.length > 0) {
      return connectedAthletes.map((a, idx) => ({
        id: a.id,
        name: a.name,
        gender:
          resolveCompetitionGender(
            a.genderDivision,
            a.athleteProfile?.competitionGender,
            a.location
          ) || (idx % 2 === 0 ? ('M' as const) : ('F' as const)),
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

  const nfhsAudit = useMemo(() => validateNfhsFourEventLimits(entries, 4), [entries]);
  const violations = useMemo(() => nfhsAudit.filter((r) => r.overLimit), [nfhsAudit]);

  const trackHeats = useMemo(
    () => seedTrackHeats(filteredEntries, selectedHeatEvent, 8, partitionByDivision),
    [filteredEntries, selectedHeatEvent, partitionByDivision]
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
    };
    setEntries((prev) => [next, ...prev]);
    if (selectedEventSpec?.category === 'FIELD') setSelectedFlightEvent(newEventCode);
    else setSelectedHeatEvent(newEventCode);
  };

  const handleExportHyTekCsv = () => {
    const csv = generateHyTekSemiColonEntryCsv({
      teamName: activeTeam?.brand.shortName || activeTeam?.brand.name || 'MeetReady',
      entries: filteredEntries,
    });
    const slug = (activeTeam?.brand.slug || 'meetready').toLowerCase();
    triggerFileDownload(csv, `${slug}-hytek-entries.csv`, 'text/csv;charset=utf-8;');
  };

  const handleExportHy3 = () => {
    const hy3 = generateHyTekHy3File({
      meetTitle,
      meetDate,
      entries: filteredEntries,
      teamCode: activeTeam?.brand.shortName || 'MTRDY',
      teamName: activeTeam?.brand.name || 'MeetReady Track & Field',
    });
    const slug = (activeTeam?.brand.slug || 'meetready').toLowerCase();
    triggerFileDownload(hy3, `${slug}-entries.hy3`, 'text/plain;charset=ascii;');
  };

  const handleExportAthleticNetCsv = () => {
    const csv = generateAthleticNetEntryCsv(filteredEntries);
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

  const handleSavePacket = async () => {
    if (isSavingPacket) return;
    setIsSavingPacket(true);
    setPacketFeedback(null);
    const packetId = activePacketId || `mdp_${Date.now()}`;
    const packetPayload = {
      packetId,
      meetTitle: meetTitle.trim() || 'Track & Field Meet',
      meetDate: meetDate || getLocalDateIso(),
      laneCount: 8,
      flightSize: 12,
      partitionByDivision,
      entries: meetEntriesToPacketEntries(entries),
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
        setPacketFeedback({
          tone: 'prime',
          text: `Saved "${res.packet.meetTitle}" (${entries.length} entries) to MeetReady team cloud.`,
        });
        return;
      }

      const nextList = saveLocalMeetDayPacket(teamScopeKey, packetPayload);
      setSavedPackets(nextList);
      setActivePacketId(packetId);
      syncTeamPacketsToParent(nextList);
      setPacketFeedback({
        tone: 'prime',
        text: `Saved "${packetPayload.meetTitle}" (${entries.length} entries) on device.`,
      });
    } catch (err) {
      const nextList = saveLocalMeetDayPacket(teamScopeKey, packetPayload);
      setSavedPackets(nextList);
      setActivePacketId(packetId);
      setPacketFeedback({
        tone: 'caution',
        text: `${err instanceof Error ? err.message : 'Cloud sync unavailable'} — saved locally on device.`,
      });
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
          onChange={(e) => setPartitionByDivision(e.target.checked)}
          className="accent-[#B83A24]"
        />
        <span>Separate Boys / Girls &amp; Divisions</span>
      </label>
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="meet-day-packet-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-2 sm:p-4"
    >
      <div className="w-full max-w-4xl max-h-[92vh] rounded-2xl bg-ap-chalk dark:bg-ap-obsidian text-ap-ink dark:text-ap-chalk border border-ap-edge flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-3 py-3 sm:px-5 border-b border-ap-frame/15 dark:border-ap-edge-dark flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 ap-text-brand shrink-0" />
              <h2 className="text-sm sm:text-lg font-extrabold tracking-tight truncate">
                Meet-Day Entries, Heats, Flights &amp; NFHS 4-Event Check
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={meetTitle}
                onChange={(e) => setMeetTitle(e.target.value)}
                aria-label="Meet Title"
                className="min-h-[38px] rounded-lg border border-ap-frame/20 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-xs font-semibold w-full sm:w-64"
              />
              <input
                type="date"
                value={meetDate}
                onChange={(e) => setMeetDate(e.target.value)}
                aria-label="Meet Date"
                className="min-h-[38px] rounded-lg border border-ap-frame/20 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 font-mono text-xs"
              />
              <button
                type="button"
                data-testid="meet-save-packet-btn"
                disabled={isSavingPacket}
                onClick={() => void handleSavePacket()}
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
                        setEntries(buildInitialMeetEntries(activeTeam, connectedAthletes));
                        return;
                      }
                      const found = savedPackets.find((p) => p.packetId === val);
                      if (found) applyPacketToEditor(found);
                    }}
                    className="min-h-[38px] max-w-[190px] rounded-lg border border-ap-frame/20 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 font-mono text-2xs"
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
          </div>
          <button
            type="button"
            aria-label="Close Meet-Day Modal"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-xl ap-card-inset inline-flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sub-Tabs & Export Buttons */}
        <div className="px-3 sm:px-5 py-2 border-b border-ap-frame/15 dark:border-ap-edge-dark flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex flex-wrap items-center gap-1 p-0.5 rounded-xl liquid-capsule-track text-xs font-bold">
            {(
              [
                { id: 'ENTRIES', label: `Entries (${entries.length})`, testId: 'meet-tab-entries' },
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
                className={`min-h-[44px] sm:min-h-[34px] px-2.5 sm:px-3 py-1 rounded-lg cursor-pointer ${
                  subTab === t.id ? 'ap-nav-volt-active' : 'text-ap-ink dark:text-ap-chalk'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
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
              onClick={() =>
                openPrintableMeetDayPacketWindow({
                  teamName: activeTeam?.brand.name || 'MeetReady Track & Field',
                  meetTitle,
                  entries: filteredEntries,
                  partitionByDivision,
                })
              }
              className="ap-btn-primary !min-h-[44px] sm:!min-h-[34px] px-3 py-1 text-2xs sm:text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
            >
              <ClipboardText className="w-3.5 h-3.5" />
              <span>Print Packet</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-3 text-xs">
          {packetFeedback && (
            <div
              role="status"
              data-testid="meet-packet-feedback"
              className={`rounded-xl px-3.5 py-2 font-semibold flex items-center gap-2 ${
                packetFeedback.tone === 'prime' ? 'ap-status-prime' : 'ap-status-caution'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{packetFeedback.text}</span>
            </div>
          )}

          {/* NFHS Rule 4-2 Banner */}
          <div data-testid="nfhs-event-limit-panel">
            {violations.length > 0 ? (
              <div
                data-testid="nfhs-over-limit-alert"
                className="rounded-xl ap-status-strained px-3.5 py-2.5 flex items-center gap-2 font-bold"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  NFHS Rule 4-2 Violation (&gt;4 events):{' '}
                  {violations
                    .map((v) => `${v.athleteName} (${v.eventCount}: ${v.events.join(', ')})`)
                    .join(' · ')}
                </span>
              </div>
            ) : (
              <div className="rounded-xl ap-status-prime px-3.5 py-2 flex items-center gap-2 font-semibold">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  NFHS Rule 4-2 Verified: All entered athletes are within the 4-event limit.
                </span>
              </div>
            )}
          </div>

          {genderAndDivisionFilterBar}

          {subTab === 'ENTRIES' && (
            <>
              <form
                onSubmit={handleAddEntry}
                className="rounded-xl ap-card-inset p-3 grid grid-cols-1 sm:grid-cols-12 gap-2 items-end"
              >
                <label className="sm:col-span-3 space-y-1">
                  <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
                    Athlete
                  </span>
                  <select
                    data-testid="meet-add-athlete-select"
                    value={activeAthleteChoice?.id || ''}
                    onChange={(e) => setNewAthleteKey(e.target.value)}
                    className="w-full min-h-[44px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 font-semibold"
                  >
                    {athleteChoices.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.gender === 'F' ? 'F' : 'M'})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="sm:col-span-2 space-y-1">
                  <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
                    Gender / Div
                  </span>
                  <div className="flex gap-1">
                    <select
                      aria-label="New Entry Gender"
                      value={newGenderOverride || activeAthleteChoice?.gender || 'M'}
                      onChange={(e) =>
                        setNewGenderOverride(e.target.value as MeetGenderDivision)
                      }
                      className="w-16 min-h-[44px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-1.5 font-mono font-bold"
                    >
                      <option value="M">Boys</option>
                      <option value="F">Girls</option>
                      <option value="NONBINARY">NB</option>
                    </select>
                    <select
                      aria-label="New Entry Division"
                      value={newDivisionOverride || activeAthleteChoice?.division || 'Varsity'}
                      onChange={(e) => setNewDivisionOverride(e.target.value)}
                      className="flex-1 min-w-0 min-h-[44px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-1.5 font-mono text-2xs"
                    >
                      {MEET_DIVISION_CHOICES.map((d) => (
                        <option key={d} value={d}>
                          {d === 'Junior Varsity' ? 'JV' : d}
                        </option>
                      ))}
                    </select>
                  </div>
                </label>

                <label className="sm:col-span-3 space-y-1">
                  <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
                    Event
                  </span>
                  <select
                    data-testid="meet-add-event-select"
                    value={newEventCode}
                    onChange={(e) => setNewEventCode(e.target.value)}
                    className="w-full min-h-[44px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 font-mono font-bold"
                  >
                    {ALL_MEET_DAY_EVENTS.map((ev) => (
                      <option key={ev.code} value={ev.code}>
                        {ev.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="sm:col-span-2 space-y-1">
                  <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
                    Seed Time / Mark
                  </span>
                  <input
                    type="text"
                    data-testid="meet-add-seed-input"
                    value={newSeedMark}
                    onChange={(e) => setNewSeedMark(e.target.value)}
                    placeholder="11.20 or 21' 6&quot;"
                    className="w-full min-h-[44px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 font-mono"
                  />
                </label>

                <button
                  type="submit"
                  data-testid="meet-add-entry-btn"
                  className="sm:col-span-2 ap-btn-primary !min-h-[44px] px-3 py-2 font-bold inline-flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> Add
                </button>

                {selectedEventSpec?.category === 'RELAY' && (
                  <div className="sm:col-span-12 flex flex-wrap items-center gap-2 pt-1 text-2xs font-mono">
                    <span className="text-ap-muted dark:text-ap-muted-dark">Relay Quartet:</span>
                    <select
                      aria-label="Relay Squad Letter"
                      value={newRelayTeam}
                      onChange={(e) => setNewRelayTeam(e.target.value)}
                      className="min-h-[34px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 font-bold"
                    >
                      <option value="A">Team A</option>
                      <option value="B">Team B</option>
                      <option value="C">Team C</option>
                    </select>
                    <select
                      aria-label="Relay Leg Order"
                      value={newRelayLeg}
                      onChange={(e) => setNewRelayLeg(Number(e.target.value) as 1 | 2 | 3 | 4)}
                      className="min-h-[34px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 font-bold"
                    >
                      <option value={1}>Leg 1 (Leadoff)</option>
                      <option value={2}>Leg 2</option>
                      <option value={3}>Leg 3</option>
                      <option value={4}>Leg 4 (Anchor)</option>
                    </select>
                  </div>
                )}
              </form>

              <div className="space-y-1.5">
                {filteredEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-xl ap-card-inset px-3 py-2 flex flex-wrap items-center justify-between gap-2 font-mono"
                  >
                    <div className="min-w-0 flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-ap-ink dark:text-ap-chalk font-sans">
                        {entry.athleteName}
                      </span>
                      <select
                        aria-label={`Gender for ${entry.athleteName} ${entry.eventCode}`}
                        value={entry.genderDivision || 'M'}
                        onChange={(e) => {
                          const nextG = e.target.value as MeetGenderDivision;
                          setEntries((prev) =>
                            prev.map((x) => (x.id === entry.id ? { ...x, genderDivision: nextG } : x))
                          );
                        }}
                        className="min-h-[30px] rounded-md border border-ap-frame/20 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-1.5 text-2xs font-bold"
                      >
                        <option value="M">Boys</option>
                        <option value="F">Girls</option>
                        <option value="NONBINARY">NB</option>
                      </select>
                      <select
                        aria-label={`Division for ${entry.athleteName} ${entry.eventCode}`}
                        value={entry.division || 'Varsity'}
                        onChange={(e) => {
                          const nextDiv = e.target.value;
                          setEntries((prev) =>
                            prev.map((x) => (x.id === entry.id ? { ...x, division: nextDiv } : x))
                          );
                        }}
                        className="min-h-[30px] rounded-md border border-ap-frame/20 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-1.5 text-2xs"
                      >
                        {availableDivisions.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                      <span className="px-1.5 py-0.5 rounded bg-ap-clay/15 dark:bg-ap-volt/15 text-ap-clay dark:text-ap-volt font-bold">
                        {entry.eventCode}
                        {entry.relayTeamCode ? ` (${entry.relayTeamCode}${entry.relayLegOrder ? ` #${entry.relayLegOrder}` : ''})` : ''}
                      </span>
                      <span className="text-ap-muted dark:text-ap-muted-dark">
                        Seed: {entry.seedMark}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${entry.athleteName} ${entry.eventCode}`}
                      onClick={() => setEntries((prev) => prev.filter((x) => x.id !== entry.id))}
                      className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center text-rose-500 hover:text-rose-400 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {subTab === 'HEATS' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {ALL_MEET_DAY_EVENTS.filter((e) => e.category !== 'FIELD').map((ev) => (
                  <button
                    key={ev.code}
                    type="button"
                    onClick={() => setSelectedHeatEvent(ev.code)}
                    className={`min-h-[36px] px-2.5 py-1 rounded-lg font-mono font-bold cursor-pointer ${
                      selectedHeatEvent === ev.code ? 'ap-nav-volt-active' : 'ap-card-inset'
                    }`}
                  >
                    {ev.code}
                  </button>
                ))}
              </div>
              {groupedHeats.length === 0 ? (
                <div className="rounded-xl ap-card-inset p-4 text-ap-muted dark:text-ap-muted-dark">
                  No entries in {selectedHeatEvent} matching the active division filter. Add an athlete in Entries tab.
                </div>
              ) : (
                <div className="space-y-3 font-mono">
                  {groupedHeats.map(([partLabel, rows]) => (
                    <div key={partLabel} className="space-y-1.5">
                      <div className="text-2xs font-bold uppercase tracking-wider text-ap-clay dark:text-ap-volt px-1">
                        {partLabel} · {selectedHeatEvent}
                      </div>
                      {rows.map((h) => (
                        <div
                          key={`${partLabel}-${h.heatNumber}-${h.lane}-${h.athleteId}`}
                          className="rounded-xl ap-card-inset px-3 py-2 flex items-center justify-between gap-2"
                        >
                          <span className="min-w-0 truncate">
                            <strong className="text-ap-clay dark:text-ap-volt">
                              Heat {h.heatNumber} · Lane {h.lane}
                            </strong>{' '}
                            — {h.athleteName}
                          </span>
                          <span className="font-bold shrink-0">Seed {h.seedMark}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {subTab === 'FLIGHTS' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {ALL_MEET_DAY_EVENTS.filter((e) => e.category === 'FIELD').map((ev) => (
                  <button
                    key={ev.code}
                    type="button"
                    onClick={() => setSelectedFlightEvent(ev.code)}
                    className={`min-h-[36px] px-2.5 py-1 rounded-lg font-mono font-bold cursor-pointer ${
                      selectedFlightEvent === ev.code ? 'ap-nav-volt-active' : 'ap-card-inset'
                    }`}
                  >
                    {ev.code}
                  </button>
                ))}
              </div>
              {groupedFlights.length === 0 ? (
                <div className="rounded-xl ap-card-inset p-4 text-ap-muted dark:text-ap-muted-dark">
                  No field entries in {selectedFlightEvent} matching the active division filter. Add an athlete in Entries tab.
                </div>
              ) : (
                <div className="space-y-3 font-mono">
                  {groupedFlights.map(([partLabel, rows]) => (
                    <div key={partLabel} className="space-y-1.5">
                      <div className="text-2xs font-bold uppercase tracking-wider text-ap-clay dark:text-ap-volt px-1">
                        {partLabel} · {selectedFlightEvent}
                      </div>
                      {rows.map((f) => (
                        <div
                          key={`${partLabel}-${f.flightNumber}-${f.orderIndex}-${f.athleteId}`}
                          className="rounded-xl ap-card-inset px-3 py-2 flex items-center justify-between gap-2"
                        >
                          <span className="min-w-0 truncate">
                            <strong className="text-ap-clay dark:text-ap-volt">
                              Flight {f.flightNumber} #{f.orderIndex}
                            </strong>{' '}
                            — {f.athleteName}
                          </span>
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
      </div>
    </div>
  );
};
