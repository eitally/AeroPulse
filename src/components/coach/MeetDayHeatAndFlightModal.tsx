import React, { useMemo, useState } from 'react';
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
  generateHyTekSemiColonEntryCsv,
  openPrintableMeetDayPacketWindow,
  seedFieldFlights,
  seedTrackHeats,
  validateNfhsFourEventLimits,
  type MeetEntryRecord,
} from '../../physiology/meetDayOpsEngine';
import type { ConnectedAthleteRecord, TeamSummaryWithRole } from '../../types';

export interface MeetDayHeatAndFlightModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTeam: TeamSummaryWithRole | null;
  connectedAthletes: ConnectedAthleteRecord[];
}

function buildInitialMeetEntries(
  activeTeam: TeamSummaryWithRole | null,
  connectedAthletes: ConnectedAthleteRecord[]
): MeetEntryRecord[] {
  const rosterSource =
    (activeTeam?.memberships || []).filter((m) => m.role === 'ATHLETE').length > 0
      ? (activeTeam?.memberships || [])
          .filter((m) => m.role === 'ATHLETE')
          .map((m) => ({
            id: m.membershipId,
            name: m.invitedName,
            gender: m.genderDivision,
            gradYear: m.graduationYear,
            eventGroup: m.eventGroup,
            seed: m.seedMarkOrFtp,
          }))
      : connectedAthletes.map((a) => ({
          id: a.id,
          name: a.name,
          gender: a.genderDivision,
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
      genderDivision: ath.gender,
      graduationYear: ath.gradYear,
      eventCode: defaultEv.code,
      seedMark: defaultEv.mark,
    });
  });

  if (seeded.length === 0) {
    seeded.push(
      { id: 'sample-1', athleteId: 'ath-1', athleteName: 'Devon Carter', eventCode: '100m', seedMark: '10.94' },
      { id: 'sample-2', athleteId: 'ath-2', athleteName: 'Chloe Okafor', eventCode: '100m', seedMark: '12.18' },
      { id: 'sample-3', athleteId: 'ath-1', athleteName: 'Devon Carter', eventCode: 'LJ', seedMark: "21' 6.5\"" }
    );
  }
  return seeded;
}

export const MeetDayHeatAndFlightModal: React.FC<MeetDayHeatAndFlightModalProps> = ({
  isOpen,
  onClose,
  activeTeam,
  connectedAthletes,
}) => {
  const [meetTitle, setMeetTitle] = useState<string>('League Dual / Saturday Invitational');
  const [subTab, setSubTab] = useState<'ENTRIES' | 'HEATS' | 'FLIGHTS'>('ENTRIES');
  const [entries, setEntries] = useState<MeetEntryRecord[]>(() =>
    buildInitialMeetEntries(activeTeam, connectedAthletes)
  );
  const [newAthleteKey, setNewAthleteKey] = useState<string>('');
  const [newEventCode, setNewEventCode] = useState<string>('100m');
  const [newSeedMark, setNewSeedMark] = useState<string>('11.40');
  const [selectedHeatEvent, setSelectedHeatEvent] = useState<string>('100m');
  const [selectedFlightEvent, setSelectedFlightEvent] = useState<string>('LJ');

  const athleteChoices = useMemo(() => {
    const members = (activeTeam?.memberships || [])
      .filter((m) => m.role === 'ATHLETE')
      .map((m) => ({
        id: m.membershipId,
        name: m.invitedName,
        gender: m.genderDivision,
        gradYear: m.graduationYear,
      }));
    if (members.length > 0) return members;
    if (connectedAthletes.length > 0) {
      return connectedAthletes.map((a) => ({
        id: a.id,
        name: a.name,
        gender: a.genderDivision,
        gradYear: undefined,
      }));
    }
    return [{ id: 'ath-1', name: 'Devon Carter', gender: 'M' as const, gradYear: 2026 }];
  }, [activeTeam?.memberships, connectedAthletes]);

  const activeAthleteChoice =
    athleteChoices.find((a) => a.id === newAthleteKey) || athleteChoices[0];

  const nfhsAudit = useMemo(() => validateNfhsFourEventLimits(entries, 4), [entries]);
  const violations = useMemo(() => nfhsAudit.filter((r) => r.overLimit), [nfhsAudit]);
  const trackHeats = useMemo(
    () => seedTrackHeats(entries, selectedHeatEvent, 8),
    [entries, selectedHeatEvent]
  );
  const fieldFlights = useMemo(
    () => seedFieldFlights(entries, selectedFlightEvent, 12),
    [entries, selectedFlightEvent]
  );

  if (!isOpen) return null;

  const handleAddEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAthleteChoice) return;
    const next: MeetEntryRecord = {
      id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      athleteId: activeAthleteChoice.id,
      athleteName: activeAthleteChoice.name,
      genderDivision: activeAthleteChoice.gender,
      graduationYear: activeAthleteChoice.gradYear,
      eventCode: newEventCode,
      seedMark: newSeedMark.trim() || 'NT',
    };
    setEntries((prev) => [next, ...prev]);
    const spec = ALL_MEET_DAY_EVENTS.find((ev) => ev.code === newEventCode);
    if (spec?.category === 'FIELD') setSelectedFlightEvent(newEventCode);
    else setSelectedHeatEvent(newEventCode);
  };

  const handleExportHyTekCsv = () => {
    const csv = generateHyTekSemiColonEntryCsv({
      teamName: activeTeam?.brand.shortName || activeTeam?.brand.name || 'MeetReady',
      entries,
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(activeTeam?.brand.slug || 'thresh').toLowerCase()}-hytek-entries.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="meet-day-packet-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
    >
      <div className="w-full max-w-4xl max-h-[90vh] rounded-2xl bg-white dark:bg-ap-obsidian text-ap-ink dark:text-ap-chalk border border-ap-edge flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 sm:px-5 border-b border-ap-frame/15 dark:border-ap-edge-dark flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 ap-text-brand shrink-0" />
              <h2 className="text-base sm:text-lg font-extrabold tracking-tight">
                Meet-Day Entries, Heats, Flights &amp; NFHS 4-Event Check
              </h2>
            </div>
            <input
              type="text"
              value={meetTitle}
              onChange={(e) => setMeetTitle(e.target.value)}
              aria-label="Meet Title"
              className="mt-1 min-h-[34px] rounded-lg border border-ap-frame/20 dark:border-ap-edge-dark bg-ap-card-inset px-2.5 text-xs font-semibold w-full sm:w-80"
            />
          </div>
          <button
            type="button"
            aria-label="Close Meet-Day Modal"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-xl ap-card-inset inline-flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sub-Tabs */}
        <div className="px-4 sm:px-5 py-2 border-b border-ap-frame/15 dark:border-ap-edge-dark flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1 p-0.5 rounded-xl liquid-capsule-track text-xs font-bold">
            {(
              [
                { id: 'ENTRIES', label: `Entries & NFHS Cap (${entries.length})`, testId: 'meet-tab-entries' },
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
                className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-lg cursor-pointer ${
                  subTab === t.id ? 'ap-nav-volt-active' : 'text-ap-ink dark:text-ap-chalk'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="meet-export-hytek-btn"
              onClick={handleExportHyTekCsv}
              className="ap-btn-secondary !min-h-[44px] sm:!min-h-[36px] px-3 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
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
                  entries,
                })
              }
              className="ap-btn-primary !min-h-[44px] sm:!min-h-[36px] px-3.5 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <ClipboardText className="w-3.5 h-3.5" />
              <span>Print Meet-Day Packet</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-xs">
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
                  {violations.map((v) => `${v.athleteName} (${v.eventCount}: ${v.events.join(', ')})`).join(' · ')}
                </span>
              </div>
            ) : (
              <div className="rounded-xl ap-status-prime px-3.5 py-2 flex items-center gap-2 font-semibold">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>NFHS Rule 4-2 Verified: All entered athletes are within the 4-event limit.</span>
              </div>
            )}
          </div>

          {subTab === 'ENTRIES' && (
            <>
              <form onSubmit={handleAddEntry} className="rounded-xl ap-card-inset p-3 grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                <label className="sm:col-span-4 space-y-1">
                  <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">Athlete</span>
                  <select
                    data-testid="meet-add-athlete-select"
                    value={activeAthleteChoice?.id || ''}
                    onChange={(e) => setNewAthleteKey(e.target.value)}
                    className="w-full min-h-[44px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 font-semibold"
                  >
                    {athleteChoices.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="sm:col-span-3 space-y-1">
                  <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">Event</span>
                  <select
                    data-testid="meet-add-event-select"
                    value={newEventCode}
                    onChange={(e) => setNewEventCode(e.target.value)}
                    className="w-full min-h-[44px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 font-mono font-bold"
                  >
                    {ALL_MEET_DAY_EVENTS.map((ev) => (
                      <option key={ev.code} value={ev.code}>
                        {ev.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="sm:col-span-3 space-y-1">
                  <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">Seed Time / Mark</span>
                  <input
                    type="text"
                    data-testid="meet-add-seed-input"
                    value={newSeedMark}
                    onChange={(e) => setNewSeedMark(e.target.value)}
                    placeholder="11.20 or 21' 6&quot;"
                    className="w-full min-h-[44px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 font-mono"
                  />
                </label>
                <button
                  type="submit"
                  data-testid="meet-add-entry-btn"
                  className="sm:col-span-2 ap-btn-primary !min-h-[44px] px-3 py-2 font-bold inline-flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> Add
                </button>
              </form>

              <div className="space-y-1.5">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-xl ap-card-inset px-3 py-2 flex items-center justify-between gap-2 font-mono"
                  >
                    <div className="min-w-0">
                      <span className="font-bold text-ap-ink dark:text-ap-chalk">{entry.athleteName}</span>
                      <span className="mx-2 text-ap-cobalt dark:text-ap-volt font-bold">{entry.eventCode}</span>
                      <span className="text-ap-muted dark:text-ap-muted-dark">Seed: {entry.seedMark}</span>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${entry.athleteName} ${entry.eventCode}`}
                      onClick={() => setEntries((prev) => prev.filter((x) => x.id !== entry.id))}
                      className="p-1.5 text-rose-500 hover:text-rose-400 cursor-pointer"
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
              {trackHeats.length === 0 ? (
                <div className="rounded-xl ap-card-inset p-4 text-ap-muted dark:text-ap-muted-dark">
                  No entries in {selectedHeatEvent} yet. Add an athlete in Entries tab.
                </div>
              ) : (
                <div className="space-y-1.5 font-mono">
                  {trackHeats.map((h) => (
                    <div
                      key={`${h.heatNumber}-${h.lane}-${h.athleteId}`}
                      className="rounded-xl ap-card-inset px-3 py-2 flex items-center justify-between gap-2"
                    >
                      <span>
                        <strong className="text-ap-cobalt dark:text-ap-volt">
                          Heat {h.heatNumber} · Lane {h.lane}
                        </strong>{' '}
                        — {h.athleteName}
                      </span>
                      <span className="font-bold">Seed {h.seedMark}</span>
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
              {fieldFlights.length === 0 ? (
                <div className="rounded-xl ap-card-inset p-4 text-ap-muted dark:text-ap-muted-dark">
                  No field entries in {selectedFlightEvent} yet. Add an athlete in Entries tab.
                </div>
              ) : (
                <div className="space-y-1.5 font-mono">
                  {fieldFlights.map((f) => (
                    <div
                      key={`${f.flightNumber}-${f.orderIndex}-${f.athleteId}`}
                      className="rounded-xl ap-card-inset px-3 py-2 flex items-center justify-between gap-2"
                    >
                      <span>
                        <strong className="text-ap-cobalt dark:text-ap-volt">
                          Flight {f.flightNumber} #{f.orderIndex}
                        </strong>{' '}
                        — {f.athleteName}
                      </span>
                      <span className="font-bold">Seed {f.seedMark}</span>
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
