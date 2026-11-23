import React, { useEffect, useMemo, useState } from 'react';
import {
  Award,
  CheckCircle2,
  Flame,
  Target,
  WifiOff,
} from '../icons/PhosphorIcons';
import {
  FIELD_EVENT_CATALOG,
  advanceFlightToFinals,
  computeHorizontalFlightStandings,
  computeMultiEventScore,
  evaluateVerticalFlightAthlete,
  formatBarHeightForUnit,
  formatFieldMark,
  formatFieldMarkDual,
  getFieldEventSpec,
  parseFieldMarkToMeters,
  raiseBarHeight,
  rankVerticalFlight,
  summarizeFieldSeries,
} from '../../physiology/fieldEventsEngine';
import {
  countPendingFieldOutboxEntries,
  enqueueFieldOutboxBatch,
  flushFieldOutbox,
  overlayPendingFieldOutboxOnTeams,
} from '../../utils/fieldEventsOutbox';
import {
  TeamLifecycleApiError,
  fetchTeamFieldMarksApi,
  recordTeamFieldMarksApi,
  type RecordTeamFieldMarkEntryInput,
} from '../../utils/teamLifecycleApi';
import type {
  CoachEventGroup,
  ConnectedAthleteRecord,
  DistanceUnit,
  FieldEventCode,
  FieldEventLogRecord,
  FieldTrialEntry,
  TeamSummaryWithRole,
} from '../../types';
import {
  FieldFlightCardsBoard,
  formatTrialChip,
  type AthleteFlightSummaryView,
  type FlightAthleteOption,
  type HorizontalTrialDraft,
} from './FieldFlightCardsBoard';
import { FieldVerticalFlightPanel } from './FieldVerticalFlightPanel';

export interface TracksideFieldEventsSheetProps {
  activeTeam: TeamSummaryWithRole | null;
  myTeams: TeamSummaryWithRole[];
  rosterAthletes: ConnectedAthleteRecord[];
  allowedEventGroups?: CoachEventGroup[];
  defaultEventGroup?: CoachEventGroup;
  distanceUnit?: DistanceUnit;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], activeId?: string) => void;
}

const MULTI_DISCIPLINES: Record<
  'DEC' | 'HEPT' | 'PENT_F' | 'PENT_M',
  Array<{ key: string; label: string; kind: 'TIME' | 'MARK'; placeholder: string }>
> = {
  DEC: [
    { key: '100m', label: '100m (s)', kind: 'TIME', placeholder: '11.20' },
    { key: 'LJ', label: 'LJ (m or ft-in)', kind: 'MARK', placeholder: "22' 4\"" },
    { key: 'SP', label: 'SP', kind: 'MARK', placeholder: "42' 6\"" },
    { key: 'HJ', label: 'HJ', kind: 'MARK', placeholder: "6' 2\"" },
    { key: '400m', label: '400m (s)', kind: 'TIME', placeholder: '50.80' },
    { key: '110mH', label: '110mH (s)', kind: 'TIME', placeholder: '15.10' },
    { key: 'DISCUS', label: 'Discus', kind: 'MARK', placeholder: "130' 0\"" },
    { key: 'PV', label: 'PV', kind: 'MARK', placeholder: "13' 6\"" },
    { key: 'JAVELIN', label: 'Javelin', kind: 'MARK', placeholder: "160' 0\"" },
    { key: '1500m', label: '1500m (s)', kind: 'TIME', placeholder: '282.0' },
  ],
  HEPT: [
    { key: '100mH', label: '100mH (s)', kind: 'TIME', placeholder: '14.60' },
    { key: 'HJ', label: 'HJ', kind: 'MARK', placeholder: "5' 6\"" },
    { key: 'SP', label: 'SP', kind: 'MARK', placeholder: "36' 2\"" },
    { key: '200m', label: '200m (s)', kind: 'TIME', placeholder: '25.40' },
    { key: 'LJ', label: 'LJ', kind: 'MARK', placeholder: "18' 4\"" },
    { key: 'JAVELIN', label: 'Javelin', kind: 'MARK', placeholder: "118' 0\"" },
    { key: '800m', label: '800m (s)', kind: 'TIME', placeholder: '142.0' },
  ],
  PENT_F: [
    { key: '60mH', label: '60mH (s)', kind: 'TIME', placeholder: '8.95' },
    { key: 'HJ', label: 'HJ', kind: 'MARK', placeholder: "5' 5\"" },
    { key: 'SP', label: 'SP', kind: 'MARK', placeholder: "35' 0\"" },
    { key: 'LJ', label: 'LJ', kind: 'MARK', placeholder: "18' 0\"" },
    { key: '800m', label: '800m (s)', kind: 'TIME', placeholder: '145.0' },
  ],
  PENT_M: [
    { key: 'LJ', label: 'LJ', kind: 'MARK', placeholder: "21' 6\"" },
    { key: 'JAVELIN', label: 'Javelin', kind: 'MARK', placeholder: "155' 0\"" },
    { key: '200m', label: '200m (s)', kind: 'TIME', placeholder: '22.80' },
    { key: 'DISCUS', label: 'Discus', kind: 'MARK', placeholder: "122' 0\"" },
    { key: '1500m', label: '1500m (s)', kind: 'TIME', placeholder: '285.0' },
  ],
};

function todayLocalIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function createEmptyTrials(count = 3): HorizontalTrialDraft[] {
  return Array.from({ length: count }, (_, idx) => ({
    raw: '',
    windRaw: '',
    outcome: 'MARK' as const,
    round: idx >= 3 ? ('FINAL' as const) : ('PRELIM' as const),
  }));
}

function defaultBarRaw(code: FieldEventCode, unit: DistanceUnit): string {
  if (unit === 'km') return code === 'PV' ? '3.80m' : '1.78m';
  return code === 'PV' ? "12' 6\"" : "5' 10\"";
}

function buildAttemptsFromDrafts(drafts: HorizontalTrialDraft[]): FieldTrialEntry[] {
  return drafts.map((t, idx) => {
    const parsed = t.outcome === 'MARK' ? parseFieldMarkToMeters(t.raw) : null;
    const windStr = t.windRaw.trim();
    const windParsed = windStr !== '' ? Number(windStr) : NaN;
    return {
      attemptNumber: idx + 1,
      outcome: t.outcome,
      ...(parsed !== null ? { markMeters: parsed } : {}),
      ...(Number.isFinite(windParsed) ? { windMps: Number(windParsed.toFixed(2)) } : {}),
      ...(t.round ? { round: t.round } : {}),
    };
  });
}

function computeMultiScoreForMap(
  eventCode: FieldEventCode,
  multiGender: 'F' | 'M',
  rawMap: Record<string, string>
): { totalPoints: number; breakdown: Record<string, number> } {
  const key =
    eventCode === 'DEC'
      ? 'DEC'
      : eventCode === 'HEPT'
        ? 'HEPT'
        : multiGender === 'M'
          ? 'PENT_M'
          : 'PENT_F';
  const marks: Partial<Record<string, number>> = {};
  for (const d of MULTI_DISCIPLINES[key]) {
    const raw = (rawMap[d.key] || '').trim();
    if (!raw) continue;
    if (d.kind === 'TIME') {
      const secs = Number(raw);
      if (Number.isFinite(secs) && secs > 0) marks[d.key] = secs;
    } else {
      const meters = parseFieldMarkToMeters(raw);
      if (meters !== null) marks[d.key] = meters;
    }
  }
  return computeMultiEventScore(
    eventCode as 'PENT' | 'HEPT' | 'DEC',
    multiGender,
    marks
  );
}

export const TracksideFieldEventsSheet: React.FC<TracksideFieldEventsSheetProps> = ({
  activeTeam,
  myTeams,
  rosterAthletes,
  allowedEventGroups,
  defaultEventGroup,
  distanceUnit = 'mi',
  onTeamsUpdated,
}) => {
  const [unit, setUnit] = useState<DistanceUnit>(distanceUnit);
  useEffect(() => {
    setUnit(distanceUnit);
  }, [distanceUnit]);

  const [eventCode, setEventCode] = useState<FieldEventCode>(
    defaultEventGroup === 'POLE_VAULT'
      ? 'PV'
      : defaultEventGroup === 'THROWS'
        ? 'SP'
        : defaultEventGroup === 'MULTI'
          ? 'DEC'
          : 'LJ'
  );
  useEffect(() => {
    if (defaultEventGroup === 'POLE_VAULT') {
      setEventCode('PV');
      setBarHeightRaw(defaultBarRaw('PV', distanceUnit));
    } else if (defaultEventGroup === 'THROWS') setEventCode('SP');
    else if (defaultEventGroup === 'JUMPS') setEventCode('LJ');
    else if (defaultEventGroup === 'MULTI') setEventCode('DEC');
  }, [defaultEventGroup, distanceUnit]);

  const spec = useMemo(() => getFieldEventSpec(eventCode), [eventCode]);

  const eligibleRoster = useMemo<FlightAthleteOption[]>(() => {
    const teamMembers = (activeTeam?.memberships || [])
      .filter(
        (m) =>
          m.role === 'ATHLETE' &&
          m.status !== 'REVOKED' &&
          m.status !== 'ALUMNI'
      )
      .map((m) => ({
        id: m.membershipId,
        membershipId: m.membershipId,
        name: m.invitedName,
        eventGroup: m.eventGroup || null,
        squadGroup: m.squadGroup,
      }));
    if (teamMembers.length > 0) {
      if (allowedEventGroups && allowedEventGroups.length > 0) {
        const scoped = teamMembers.filter(
          (m) => !m.eventGroup || allowedEventGroups.includes(m.eventGroup)
        );
        return scoped.length > 0 ? scoped : teamMembers;
      }
      return teamMembers;
    }
    return rosterAthletes.map((a) => ({
      id: a.id,
      name: a.name,
      eventGroup: a.eventGroup || null,
    }));
  }, [activeTeam?.memberships, allowedEventGroups, rosterAthletes]);

  const [walkOnAthletes, setWalkOnAthletes] = useState<FlightAthleteOption[]>([]);
  const [selectedFlightIds, setSelectedFlightIds] = useState<string[] | null>(null);
  const [flightOrderOverride, setFlightOrderOverride] = useState<string[] | null>(null);

  const flightRoster = useMemo<FlightAthleteOption[]>(() => {
    const combined = [...eligibleRoster, ...walkOnAthletes];
    if (combined.length === 0) {
      return [{ id: 'walkon-default-1', name: 'Track Athlete', isWalkOn: true }];
    }
    const byId = new Map(combined.map((a) => [a.id, a]));
    let list: FlightAthleteOption[];
    if (selectedFlightIds && selectedFlightIds.length > 0) {
      list = selectedFlightIds
        .map((id) => byId.get(id))
        .filter((a): a is FlightAthleteOption => Boolean(a));
      if (list.length === 0) list = combined.slice(0, 12);
    } else {
      list = combined.slice(0, 12);
    }
    if (flightOrderOverride && flightOrderOverride.length > 0) {
      const orderIdx = new Map(flightOrderOverride.map((id, i) => [id, i]));
      list = [...list].sort(
        (a, b) => (orderIdx.get(a.id) ?? 999) - (orderIdx.get(b.id) ?? 999)
      );
    }
    return list;
  }, [eligibleRoster, walkOnAthletes, selectedFlightIds, flightOrderOverride]);

  const [activeAthleteId, setActiveAthleteId] = useState<string>('');
  const resolvedActiveAthlete = useMemo(() => {
    return (
      flightRoster.find((a) => a.id === activeAthleteId) ||
      flightRoster[0]
    );
  }, [flightRoster, activeAthleteId]);

  const [flightName, setFlightName] = useState<string>('Flight A');
  const [sessionDate, setSessionDate] = useState<string>(todayLocalIso);
  const [isCompetition, setIsCompetition] = useState<boolean>(true);
  const [meetTitle, setMeetTitle] = useState<string>('');
  const [implementSpec, setImplementSpec] = useState<string>('');
  const [poleSpec, setPoleSpec] = useState<string>('');
  const [approachSteps, setApproachSteps] = useState<string>('');
  const [rpe, setRpe] = useState<number>(6);

  const [trialsByAthleteId, setTrialsByAthleteId] = useState<
    Record<string, HorizontalTrialDraft[]>
  >({});
  const [verticalByAthleteId, setVerticalByAthleteId] = useState<
    Record<string, FieldTrialEntry[]>
  >({});
  const [multiByAthleteId, setMultiByAthleteId] = useState<
    Record<string, Record<string, string>>
  >({});
  const [barHeightRaw, setBarHeightRaw] = useState<string>(() =>
    defaultBarRaw(defaultEventGroup === 'POLE_VAULT' ? 'PV' : 'HJ', distanceUnit)
  );
  const [multiGender, setMultiGender] = useState<'F' | 'M'>('M');
  const [isFinalsMode, setIsFinalsMode] = useState<boolean>(false);
  const [finalsCutSize, setFinalsCutSize] = useState<8 | 9>(8);
  const [finalistIds, setFinalistIds] = useState<Set<string>>(new Set());

  const [saving, setSaving] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [localSavedLogs, setLocalSavedLogs] = useState<FieldEventLogRecord[]>([]);
  const [archiveLogs, setArchiveLogs] = useState<FieldEventLogRecord[] | null>(null);
  const [archiveLoading, setArchiveLoading] = useState<boolean>(false);
  const [pendingOutboxCount, setPendingOutboxCount] = useState<number>(() =>
    countPendingFieldOutboxEntries(activeTeam?.brand.teamId)
  );

  useEffect(() => {
    const syncPendingCount = () => {
      setPendingOutboxCount(
        countPendingFieldOutboxEntries(activeTeam?.brand.teamId)
      );
    };
    syncPendingCount();

    const handleOnline = () => {
      if (
        typeof navigator !== 'undefined' &&
        navigator.onLine !== false &&
        activeTeam &&
        !activeTeam.brand.teamId.startsWith('demo_')
      ) {
        void flushFieldOutbox((updatedTeam) => {
          const nextTeams = overlayPendingFieldOutboxOnTeams(
            myTeams.map((t) =>
              t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
            )
          );
          onTeamsUpdated(nextTeams, updatedTeam.brand.teamId);
        }).then(syncPendingCount);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('thresh:field-outbox-updated', syncPendingCount);
      window.addEventListener('online', handleOnline);
      return () => {
        window.removeEventListener('thresh:field-outbox-updated', syncPendingCount);
        window.removeEventListener('online', handleOnline);
      };
    }
    return undefined;
  }, [activeTeam, myTeams, onTeamsUpdated]);

  const handleToggleUnit = (nextUnit: DistanceUnit) => {
    setUnit(nextUnit);
    if (spec.mode === 'VERTICAL') {
      const parsed = parseFieldMarkToMeters(barHeightRaw);
      if (parsed !== null) {
        setBarHeightRaw(formatBarHeightForUnit(parsed, nextUnit));
      } else {
        setBarHeightRaw(defaultBarRaw(eventCode, nextUnit));
      }
    }
  };

  const handleSelectEvent = (next: FieldEventCode) => {
    setEventCode(next);
    setSaveMessage(null);
    setErrorMessage(null);
    setIsFinalsMode(false);
    setFinalistIds(new Set());
    setFlightOrderOverride(null);
    setTrialsByAthleteId({});
    setVerticalByAthleteId({});
    setMultiByAthleteId({});
    setPoleSpec('');
    setApproachSteps('');
    const nextSpec = getFieldEventSpec(next);
    if (nextSpec.mode === 'VERTICAL') {
      setBarHeightRaw(defaultBarRaw(next, unit));
    }
    if (nextSpec.mode === 'THROW' && nextSpec.implementPresets?.length) {
      setImplementSpec(nextSpec.implementPresets[0]);
    } else {
      setImplementSpec('');
    }
  };

  const activeTrials = useMemo<HorizontalTrialDraft[]>(() => {
    return (
      trialsByAthleteId[resolvedActiveAthlete.id] ||
      createEmptyTrials(isFinalsMode ? 6 : 3)
    );
  }, [trialsByAthleteId, resolvedActiveAthlete.id, isFinalsMode]);

  const activeVerticalAttempts = useMemo<FieldTrialEntry[]>(() => {
    return verticalByAthleteId[resolvedActiveAthlete.id] || [];
  }, [verticalByAthleteId, resolvedActiveAthlete.id]);

  const activeMultiRaw = useMemo<Record<string, string>>(() => {
    return multiByAthleteId[resolvedActiveAthlete.id] || {};
  }, [multiByAthleteId, resolvedActiveAthlete.id]);

  const activeBuiltAttempts = useMemo<FieldTrialEntry[]>(() => {
    if (spec.mode === 'VERTICAL') return activeVerticalAttempts;
    if (spec.mode === 'MULTI') return [];
    return buildAttemptsFromDrafts(activeTrials);
  }, [spec.mode, activeTrials, activeVerticalAttempts]);

  const activeSeriesSummary = useMemo(
    () => summarizeFieldSeries(eventCode, activeBuiltAttempts, rpe),
    [eventCode, activeBuiltAttempts, rpe]
  );

  const activeMultiScore = useMemo(() => {
    if (spec.mode !== 'MULTI') return null;
    return computeMultiScoreForMap(eventCode, multiGender, activeMultiRaw);
  }, [eventCode, multiGender, activeMultiRaw, spec.mode]);

  const activeVerticalEval = useMemo(
    () => evaluateVerticalFlightAthlete(activeVerticalAttempts),
    [activeVerticalAttempts]
  );

  const horizontalStandings = useMemo(() => {
    if (spec.mode !== 'HORIZONTAL' && spec.mode !== 'THROW') return [];
    const base = computeHorizontalFlightStandings(
      flightRoster.map((ath) => ({
        athleteId: ath.id,
        membershipId: ath.membershipId,
        athleteName: ath.name,
        eventCode,
        attempts: buildAttemptsFromDrafts(
          trialsByAthleteId[ath.id] || createEmptyTrials(3)
        ),
      }))
    );
    return base.map((s) => ({
      ...s,
      advancedToFinals: finalistIds.has(s.athleteId) || s.advancedToFinals,
    }));
  }, [spec.mode, flightRoster, eventCode, trialsByAthleteId, finalistIds]);

  const verticalStandings = useMemo(() => {
    if (spec.mode !== 'VERTICAL') return [];
    return rankVerticalFlight(
      flightRoster.map((ath) => ({
        athleteId: ath.id,
        membershipId: ath.membershipId,
        athleteName: ath.name,
        attempts: verticalByAthleteId[ath.id] || [],
      }))
    );
  }, [spec.mode, flightRoster, verticalByAthleteId]);

  const athleteSummariesById = useMemo(() => {
    const map = new Map<string, AthleteFlightSummaryView>();
    const hLookup = new Map(horizontalStandings.map((s) => [s.athleteId, s]));
    const vLookup = new Map(verticalStandings.map((s) => [s.athleteId, s]));

    for (const ath of flightRoster) {
      if (spec.mode === 'VERTICAL') {
        const v = vLookup.get(ath.id);
        const attempts = verticalByAthleteId[ath.id] || [];
        map.set(ath.id, {
          athleteId: ath.id,
          bestMarkMeters: v?.bestClearedHeightMeters ?? null,
          bestWindLegalMeters: v?.bestClearedHeightMeters ?? null,
          isWindAidedBest: false,
          placeRank: v?.placeRank ?? null,
          advancedToFinals: false,
          isNoHeight: v?.isNoHeight,
          isEliminated: v?.isEliminated,
          attemptsSummaryChips: attempts.map((a) => formatTrialChip(a, unit)),
        });
      } else if (spec.mode === 'MULTI') {
        const score = computeMultiScoreForMap(
          eventCode,
          multiGender,
          multiByAthleteId[ath.id] || {}
        );
        map.set(ath.id, {
          athleteId: ath.id,
          bestMarkMeters: null,
          bestWindLegalMeters: null,
          isWindAidedBest: false,
          placeRank: null,
          advancedToFinals: false,
          attemptsSummaryChips: [],
          multiPoints: score.totalPoints,
        });
      } else {
        const h = hLookup.get(ath.id);
        const drafts = trialsByAthleteId[ath.id] || [];
        const built = buildAttemptsFromDrafts(drafts).filter(
          (a) => a.outcome !== 'MARK' || (a.markMeters ?? 0) > 0
        );
        map.set(ath.id, {
          athleteId: ath.id,
          bestMarkMeters: h?.bestMarkMeters ?? null,
          bestWindLegalMeters: h?.bestWindLegalMeters ?? null,
          bestMarkWindMps: h?.bestMarkWindMps,
          isWindAidedBest: Boolean(h?.isWindAidedBest),
          placeRank: h?.placeRank ?? null,
          advancedToFinals: finalistIds.has(ath.id),
          attemptsSummaryChips: built.map((a) => formatTrialChip(a, unit)),
        });
      }
    }
    return map;
  }, [
    flightRoster,
    spec.mode,
    horizontalStandings,
    verticalStandings,
    verticalByAthleteId,
    unit,
    eventCode,
    multiGender,
    multiByAthleteId,
    trialsByAthleteId,
    finalistIds,
  ]);

  const currentBarMeters = useMemo(
    () => parseFieldMarkToMeters(barHeightRaw),
    [barHeightRaw]
  );

  const handleLogVerticalAttempt = (outcome: 'CLEAR' | 'MISS' | 'PASS') => {
    if (currentBarMeters === null) {
      setErrorMessage(
        "Enter a valid bar height (e.g. 5' 10\" or 1.78m) before logging."
      );
      return;
    }
    setErrorMessage(null);
    setVerticalByAthleteId((prev) => {
      const existing = prev[resolvedActiveAthlete.id] || [];
      return {
        ...prev,
        [resolvedActiveAthlete.id]: [
          ...existing,
          {
            attemptNumber: existing.length + 1,
            outcome,
            barHeightMeters: currentBarMeters,
          },
        ],
      };
    });
  };

  const handleRaiseBar = () => {
    const stepped = raiseBarHeight({
      currentMeters: currentBarMeters ?? undefined,
      eventCode: eventCode === 'PV' ? 'PV' : 'HJ',
      unit,
    });
    setBarHeightRaw(stepped.displayValue);
  };

  const handleAdvanceRotation = () => {
    if (flightRoster.length <= 1) return;
    const curIdx = Math.max(
      0,
      flightRoster.findIndex((a) => a.id === resolvedActiveAthlete.id)
    );
    for (let offset = 1; offset <= flightRoster.length; offset += 1) {
      const candidate = flightRoster[(curIdx + offset) % flightRoster.length];
      if (!athleteSummariesById.get(candidate.id)?.isEliminated) {
        setActiveAthleteId(candidate.id);
        return;
      }
    }
  };

  const handleToggleAthleteInFlight = (ath: FlightAthleteOption) => {
    const currentIds = flightRoster.map((a) => a.id);
    if (currentIds.includes(ath.id)) {
      if (currentIds.length <= 1) return;
      const nextIds = currentIds.filter((id) => id !== ath.id);
      setSelectedFlightIds(nextIds);
      if (resolvedActiveAthlete.id === ath.id) {
        setActiveAthleteId(nextIds[0]);
      }
      return;
    }
    if (currentIds.length >= 16) return;
    setSelectedFlightIds([...currentIds, ath.id]);
  };

  const handleAddWalkOn = (name: string) => {
    const walkOn: FlightAthleteOption = {
      id: `walkon-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      isWalkOn: true,
    };
    const nextIds = [...flightRoster.map((a) => a.id), walkOn.id];
    setWalkOnAthletes((prev) => [...prev, walkOn]);
    setSelectedFlightIds(nextIds);
    setActiveAthleteId(walkOn.id);
  };

  const handleCutToFinals = () => {
    const cut = advanceFlightToFinals(horizontalStandings, finalsCutSize);
    const qualifiedIds = cut.finalsOrder.map((s) => s.athleteId);
    if (qualifiedIds.length === 0) {
      setErrorMessage('Record at least one legal prelim mark before cutting to Finals.');
      return;
    }
    setErrorMessage(null);
    setFinalistIds(new Set(qualifiedIds));
    setIsFinalsMode(true);
    setFlightOrderOverride(qualifiedIds);
    setActiveAthleteId(qualifiedIds[0]);
    setTrialsByAthleteId((prev) => {
      const updated = { ...prev };
      for (const id of qualifiedIds) {
        const cur = updated[id] || createEmptyTrials(3);
        if (cur.length < 6) {
          const extras: HorizontalTrialDraft[] = [];
          for (let i = cur.length; i < 6; i += 1) {
            extras.push({ raw: '', windRaw: '', outcome: 'MARK', round: 'FINAL' });
          }
          updated[id] = [...cur, ...extras];
        }
      }
      return updated;
    });
  };

  const handleReturnToPrelims = () => {
    setIsFinalsMode(false);
    setFlightOrderOverride(null);
  };

  const handleChangeTrial = (idx: number, patch: Partial<HorizontalTrialDraft>) => {
    const athId = resolvedActiveAthlete.id;
    setTrialsByAthleteId((prev) => {
      const existing = prev[athId] || createEmptyTrials(isFinalsMode ? 6 : 3);
      return {
        ...prev,
        [athId]: existing.map((row, i) => (i === idx ? { ...row, ...patch } : row)),
      };
    });
  };

  const handleAddTrial = () => {
    const athId = resolvedActiveAthlete.id;
    setTrialsByAthleteId((prev) => {
      const existing = prev[athId] || createEmptyTrials(3);
      if (existing.length >= 6) return prev;
      return {
        ...prev,
        [athId]: [
          ...existing,
          {
            raw: '',
            windRaw: '',
            outcome: 'MARK',
            round: existing.length >= 3 ? 'FINAL' : 'PRELIM',
          },
        ],
      };
    });
  };

  const handleSaveFlightSheet = async () => {
    setSaveMessage(null);
    setErrorMessage(null);
    const clientBatchId = `flb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const hRankLookup = new Map(horizontalStandings.map((s) => [s.athleteId, s]));
    const vRankLookup = new Map(verticalStandings.map((s) => [s.athleteId, s]));

    const entries: RecordTeamFieldMarkEntryInput[] = [];
    for (const ath of flightRoster) {
      if (spec.mode === 'MULTI') {
        const score = computeMultiScoreForMap(
          eventCode,
          multiGender,
          multiByAthleteId[ath.id] || {}
        );
        if (score.totalPoints <= 0) continue;
        entries.push({
          membershipId: ath.membershipId,
          athleteName: ath.name,
          date: sessionDate,
          eventCode,
          isCompetition,
          meetOrPracticeTitle: meetTitle.trim() || undefined,
          flightName,
          approachSteps: Number(approachSteps) > 0 ? Number(approachSteps) : undefined,
          attempts: [],
          multiPoints: score.totalPoints,
          rpe,
          clientBatchId,
        });
        continue;
      }

      if (spec.mode === 'VERTICAL') {
        const attempts = verticalByAthleteId[ath.id] || [];
        if (attempts.length === 0) continue;
        const vStat = vRankLookup.get(ath.id);
        const sum = summarizeFieldSeries(eventCode, attempts, rpe);
        entries.push({
          membershipId: ath.membershipId,
          athleteName: ath.name,
          date: sessionDate,
          eventCode,
          isCompetition,
          meetOrPracticeTitle: meetTitle.trim() || undefined,
          flightName,
          poleSpec: eventCode === 'PV' ? poleSpec.trim() || undefined : undefined,
          approachSteps: Number(approachSteps) > 0 ? Number(approachSteps) : undefined,
          attempts,
          bestMarkMeters: sum.bestMarkMeters ?? undefined,
          bestWindLegalMeters: sum.bestWindLegalMeters ?? undefined,
          isNoHeight: vStat?.isNoHeight ?? sum.isNoHeight,
          missesAtClearingHeight:
            vStat?.missesAtClearingHeight ?? sum.missesAtClearingHeight,
          totalVerticalMisses: vStat?.totalMisses ?? sum.totalVerticalMisses,
          placeRank: vStat?.placeRank ?? undefined,
          rpe,
          clientBatchId,
        });
        continue;
      }

      const drafts = trialsByAthleteId[ath.id] || [];
      const built = buildAttemptsFromDrafts(drafts).filter(
        (a) =>
          a.outcome === 'FOUL' ||
          a.outcome === 'PASS' ||
          (a.markMeters ?? 0) > 0
      );
      if (built.length === 0) continue;
      const sum = summarizeFieldSeries(eventCode, built, rpe);
      const hStat = hRankLookup.get(ath.id);
      entries.push({
        membershipId: ath.membershipId,
        athleteName: ath.name,
        date: sessionDate,
        eventCode,
        isCompetition,
        meetOrPracticeTitle: meetTitle.trim() || undefined,
        flightName,
        implementSpec:
          spec.mode === 'THROW'
            ? implementSpec.trim() || spec.defaultImplementSpec
            : undefined,
        approachSteps: Number(approachSteps) > 0 ? Number(approachSteps) : undefined,
        attempts: built,
        bestMarkMeters: sum.bestMarkMeters ?? undefined,
        bestWindLegalMeters: sum.bestWindLegalMeters ?? undefined,
        bestMarkWindMps: sum.bestMarkWindMps,
        isWindAidedBest: sum.isWindAidedBest,
        placeRank: hStat?.placeRank ?? undefined,
        advancedToFinals: finalistIds.has(ath.id) || undefined,
        rpe,
        clientBatchId,
      });
    }

    if (entries.length === 0) {
      setErrorMessage(
        spec.mode === 'MULTI'
          ? 'Enter at least one multi-event mark or time before saving.'
          : 'Record at least one valid mark, bar attempt, or foul before saving.'
      );
      return;
    }

    const buildLocalRecords = (): FieldEventLogRecord[] =>
      entries.map((entry, idx) => ({
        id: `field-local-${Date.now()}-${idx}`,
        teamId: activeTeam?.brand.teamId,
        membershipId: entry.membershipId,
        athleteName: entry.athleteName,
        date: entry.date,
        eventCode: entry.eventCode,
        eventGroup: spec.eventGroup,
        isCompetition: Boolean(entry.isCompetition),
        meetOrPracticeTitle: entry.meetOrPracticeTitle || `${spec.shortLabel} Session`,
        ...(entry.flightName ? { flightName: entry.flightName } : {}),
        ...(entry.implementSpec ? { implementSpec: entry.implementSpec } : {}),
        ...(entry.poleSpec ? { poleSpec: entry.poleSpec } : {}),
        ...(entry.approachSteps ? { approachSteps: entry.approachSteps } : {}),
        attempts: entry.attempts,
        ...(entry.bestMarkMeters !== undefined ? { bestMarkMeters: entry.bestMarkMeters } : {}),
        ...(entry.bestWindLegalMeters !== undefined
          ? { bestWindLegalMeters: entry.bestWindLegalMeters }
          : {}),
        ...(entry.bestMarkWindMps !== undefined ? { bestMarkWindMps: entry.bestMarkWindMps } : {}),
        ...(entry.isWindAidedBest ? { isWindAidedBest: true } : {}),
        ...(entry.isNoHeight ? { isNoHeight: true } : {}),
        ...(entry.missesAtClearingHeight !== undefined
          ? { missesAtClearingHeight: entry.missesAtClearingHeight }
          : {}),
        ...(entry.totalVerticalMisses !== undefined
          ? { totalVerticalMisses: entry.totalVerticalMisses }
          : {}),
        ...(entry.placeRank !== undefined ? { placeRank: entry.placeRank } : {}),
        ...(entry.advancedToFinals !== undefined
          ? { advancedToFinals: entry.advancedToFinals }
          : {}),
        ...(entry.multiPoints !== undefined ? { multiPoints: entry.multiPoints } : {}),
        ...(entry.rpe !== undefined ? { rpe: entry.rpe } : {}),
        clientBatchId,
        createdAt: new Date().toISOString(),
      }));

    const saveLocalDemoOrPersonal = () => {
      const localRecords = buildLocalRecords();
      setLocalSavedLogs((prev) => [...localRecords, ...prev]);
      if (activeTeam) {
        const updatedTeam: TeamSummaryWithRole = {
          ...activeTeam,
          fieldMarkLogs: [...localRecords, ...(activeTeam.fieldMarkLogs || [])].slice(0, 150),
          fieldMarkLogsTotalCount:
            (activeTeam.fieldMarkLogsTotalCount ?? (activeTeam.fieldMarkLogs || []).length) +
            localRecords.length,
        };
        onTeamsUpdated(
          myTeams.map((t) =>
            t.brand.teamId === activeTeam.brand.teamId ? updatedTeam : t
          ),
          activeTeam.brand.teamId
        );
      }
      setSaveMessage(
        `Saved ${entries.length} ${spec.shortLabel} flight record${entries.length === 1 ? '' : 's'} ✓`
      );
    };

    const queueOffline = (reasonLabel: string) => {
      if (!activeTeam) {
        saveLocalDemoOrPersonal();
        return;
      }
      enqueueFieldOutboxBatch(activeTeam.brand.teamId, entries, clientBatchId);
      const overlaid = overlayPendingFieldOutboxOnTeams(myTeams);
      onTeamsUpdated(overlaid, activeTeam.brand.teamId);
      setPendingOutboxCount(countPendingFieldOutboxEntries(activeTeam.brand.teamId));
      setSaveMessage(
        `${reasonLabel} — queued ${entries.length} ${spec.shortLabel} record${entries.length === 1 ? '' : 's'} offline for auto-sync ✓`
      );
    };

    const isOffline =
      typeof navigator !== 'undefined' && navigator.onLine === false;
    if (isOffline) {
      queueOffline('Offline Mode');
      return;
    }

    if (!activeTeam || activeTeam.brand.teamId.startsWith('demo_')) {
      saveLocalDemoOrPersonal();
      return;
    }

    setSaving(true);
    try {
      const resp = await recordTeamFieldMarksApi({
        teamId: activeTeam.brand.teamId,
        clientBatchId,
        entries,
      });
      if (resp.teams && resp.teams.length > 0) {
        onTeamsUpdated(
          overlayPendingFieldOutboxOnTeams(resp.teams),
          activeTeam.brand.teamId
        );
      } else if (resp.team) {
        onTeamsUpdated(
          overlayPendingFieldOutboxOnTeams(
            myTeams.map((t) =>
              t.brand.teamId === resp.team!.brand.teamId ? resp.team! : t
            )
          ),
          resp.team.brand.teamId
        );
      }
      setSaveMessage(
        `Saved ${entries.length} ${spec.shortLabel} flight record${entries.length === 1 ? '' : 's'} to Team Log ✓`
      );
    } catch (err: unknown) {
      const status =
        err instanceof TeamLifecycleApiError ? err.status : undefined;
      if (status === 400 || status === 403 || status === 404 || status === 422) {
        setErrorMessage(
          err instanceof Error && err.message
            ? err.message
            : 'Unable to save field flight sheet.'
        );
      } else {
        queueOffline('Connection Delayed');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleLoadFullArchive = async () => {
    if (!activeTeam || activeTeam.brand.teamId.startsWith('demo_')) return;
    setArchiveLoading(true);
    try {
      const res = await fetchTeamFieldMarksApi(activeTeam.brand.teamId, {
        limit: 200,
      });
      setArchiveLogs(res.logs);
    } catch {
      // Keep inline logs if offline
    } finally {
      setArchiveLoading(false);
    }
  };

  const recentLogs = useMemo(() => {
    const serverLogs = archiveLogs ?? (activeTeam?.fieldMarkLogs || []);
    const seen = new Set(serverLogs.map((l) => l.id));
    return [...serverLogs, ...localSavedLogs.filter((l) => !seen.has(l.id))].slice(0, 8);
  }, [archiveLogs, activeTeam?.fieldMarkLogs, localSavedLogs]);

  const activeMultiKey =
    eventCode === 'DEC'
      ? 'DEC'
      : eventCode === 'HEPT'
        ? 'HEPT'
        : multiGender === 'M'
          ? 'PENT_M'
          : 'PENT_F';

  const readyToSaveCount = useMemo(() => {
    let count = 0;
    for (const ath of flightRoster) {
      const sum = athleteSummariesById.get(ath.id);
      if (spec.mode === 'MULTI') {
        if ((sum?.multiPoints ?? 0) > 0) count += 1;
      } else if ((sum?.attemptsSummaryChips.length ?? 0) > 0) {
        count += 1;
      }
    }
    return count;
  }, [flightRoster, athleteSummariesById, spec.mode]);

  return (
    <section
      data-testid="trackside-field-events-sheet"
      className="rounded-2xl bg-ap-obsidian text-ap-chalk border border-ap-edge p-3.5 sm:p-5 space-y-4 shadow-xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ap-edge pb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Target className="w-5 h-5 text-ap-volt shrink-0" />
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-extrabold tracking-tight text-ap-chalk">
              Trackside Field &amp; Multi-Event Flight Sheet
            </h2>
            <p className="text-2xs font-mono text-ap-muted-dark">
              Multi-Athlete Flight Board · Wind-Legal Tracking · Vertical Countback
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          {pendingOutboxCount > 0 && (
            <span
              data-testid="field-outbox-pending-pill"
              className="px-2.5 py-1 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/40 inline-flex items-center gap-1 text-2xs font-bold"
            >
              <WifiOff className="w-3.5 h-3.5" />
              {pendingOutboxCount} Pending Sync
            </span>
          )}
          <div
            role="group"
            aria-label="Measurement unit"
            className="inline-flex rounded-xl bg-ap-turf border border-ap-edge p-0.5"
          >
            <button
              type="button"
              data-testid="field-unit-mi"
              aria-pressed={unit === 'mi'}
              onClick={() => handleToggleUnit('mi')}
              className={`min-h-[40px] sm:min-h-[30px] px-2.5 rounded-lg font-bold cursor-pointer ${
                unit === 'mi' ? 'bg-ap-volt text-ap-obsidian' : 'text-ap-muted-dark'
              }`}
            >
              Imperial (ft-in)
            </button>
            <button
              type="button"
              data-testid="field-unit-km"
              aria-pressed={unit === 'km'}
              onClick={() => handleToggleUnit('km')}
              className={`min-h-[40px] sm:min-h-[30px] px-2.5 rounded-lg font-bold cursor-pointer ${
                unit === 'km' ? 'bg-ap-volt text-ap-obsidian' : 'text-ap-muted-dark'
              }`}
            >
              Metric (m)
            </button>
          </div>
          <button
            type="button"
            onClick={() => setIsCompetition(true)}
            aria-pressed={isCompetition}
            className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl font-bold cursor-pointer ${
              isCompetition
                ? 'bg-ap-volt text-ap-obsidian'
                : 'bg-ap-turf text-ap-chalk border border-ap-edge'
            }`}
          >
            Meet Marks
          </button>
          <button
            type="button"
            onClick={() => setIsCompetition(false)}
            aria-pressed={!isCompetition}
            className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl font-bold cursor-pointer ${
              !isCompetition
                ? 'bg-ap-volt text-ap-obsidian'
                : 'bg-ap-turf text-ap-chalk border border-ap-edge'
            }`}
          >
            Practice Contacts
          </button>
        </div>
      </div>

      {/* Event Pill Strip */}
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label="Select field or multi event"
      >
        {FIELD_EVENT_CATALOG.map((ev) => {
          const active = ev.code === eventCode;
          return (
            <button
              key={ev.code}
              type="button"
              data-testid={`field-event-btn-${ev.code}`}
              aria-pressed={active}
              onClick={() => handleSelectEvent(ev.code)}
              className={`min-h-[44px] sm:min-h-[36px] px-3 py-1 rounded-xl text-xs font-mono font-bold cursor-pointer transition-colors ${
                active
                  ? 'bg-ap-volt text-ap-obsidian shadow-sm'
                  : 'bg-ap-carbon text-ap-chalk border border-ap-edge hover:border-ap-volt/60'
              }`}
            >
              {ev.shortLabel}
            </button>
          );
        })}
      </div>

      {/* Session Metadata Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
        <label className="space-y-1">
          <span className="block text-2xs font-mono uppercase text-ap-muted-dark">
            Date &amp; Meet / Practice Title
          </span>
          <div className="flex gap-1.5">
            <input
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              className="w-[135px] min-h-[44px] rounded-xl bg-ap-carbon border border-ap-edge px-2 py-1.5 font-mono text-ap-chalk"
            />
            <input
              type="text"
              value={meetTitle}
              onChange={(e) => setMeetTitle(e.target.value)}
              placeholder="Dual Meet / Practice Sheet"
              className="flex-1 min-w-0 min-h-[44px] rounded-xl bg-ap-carbon border border-ap-edge px-2.5 py-1.5 text-ap-chalk"
            />
          </div>
        </label>

        {spec.mode === 'THROW' ? (
          <label className="space-y-1">
            <span className="block text-2xs font-mono uppercase text-ap-muted-dark">
              Implement Weight
            </span>
            <select
              value={implementSpec || spec.implementPresets?.[0] || ''}
              onChange={(e) => setImplementSpec(e.target.value)}
              className="w-full min-h-[44px] rounded-xl bg-ap-carbon border border-ap-edge px-3 py-2 font-mono text-ap-chalk"
            >
              {(spec.implementPresets || [spec.defaultImplementSpec || 'Standard']).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        ) : eventCode === 'PV' ? (
          <label className="space-y-1">
            <span className="block text-2xs font-mono uppercase text-ap-muted-dark">
              Pole Spec &amp; Steps
            </span>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={poleSpec}
                onChange={(e) => setPoleSpec(e.target.value)}
                placeholder="14'0 155lb"
                className="flex-1 min-w-0 min-h-[44px] rounded-xl bg-ap-carbon border border-ap-edge px-2.5 font-mono text-ap-chalk"
              />
              <input
                type="number"
                min={3}
                max={20}
                value={approachSteps}
                onChange={(e) => setApproachSteps(e.target.value)}
                placeholder="7"
                aria-label="Approach steps"
                className="w-20 min-h-[44px] rounded-xl bg-ap-carbon border border-ap-edge px-2 font-mono text-ap-chalk"
              />
            </div>
          </label>
        ) : (
          <label className="space-y-1">
            <span className="block text-2xs font-mono uppercase text-ap-muted-dark">
              Approach Steps
            </span>
            <input
              type="number"
              min={3}
              max={22}
              value={approachSteps}
              onChange={(e) => setApproachSteps(e.target.value)}
              placeholder="7"
              className="w-full min-h-[44px] rounded-xl bg-ap-carbon border border-ap-edge px-3 font-mono text-ap-chalk"
            />
          </label>
        )}

        <label className="space-y-1">
          <span className="block text-2xs font-mono uppercase text-ap-muted-dark">
            Flight Effort RPE ({rpe}/10)
          </span>
          <input
            type="range"
            min={1}
            max={10}
            value={rpe}
            onChange={(e) => setRpe(Number(e.target.value))}
            className="w-full min-h-[44px] accent-lime-400 cursor-pointer"
          />
        </label>
      </div>

      {/* Multi-Athlete Flight Cards Board + Active Horizontal/Throws Deck */}
      <FieldFlightCardsBoard
        eventCode={eventCode}
        unit={unit}
        flightName={flightName}
        onChangeFlightName={setFlightName}
        flightRoster={flightRoster}
        eligibleRoster={eligibleRoster}
        activeAthleteId={resolvedActiveAthlete.id}
        onSelectActiveAthlete={setActiveAthleteId}
        onAdvanceRotation={handleAdvanceRotation}
        onToggleAthleteInFlight={handleToggleAthleteInFlight}
        onAddWalkOn={handleAddWalkOn}
        athleteSummariesById={athleteSummariesById}
        isFinalsMode={isFinalsMode}
        finalsCutSize={finalsCutSize}
        onChangeFinalsCutSize={setFinalsCutSize}
        onCutToFinals={handleCutToFinals}
        onReturnToPrelims={handleReturnToPrelims}
        activeTrials={activeTrials}
        onChangeTrial={handleChangeTrial}
        onAddTrial={handleAddTrial}
        horizontalStandings={horizontalStandings}
        verticalStandings={verticalStandings}
      />

      {/* Mode 2: Vertical HJ / PV Flight Panel */}
      {spec.mode === 'VERTICAL' && (
        <FieldVerticalFlightPanel
          eventCode={eventCode === 'PV' ? 'PV' : 'HJ'}
          unit={unit}
          activeAthleteName={resolvedActiveAthlete.name}
          barHeightRaw={barHeightRaw}
          onChangeBarHeightRaw={setBarHeightRaw}
          activeAttempts={activeVerticalAttempts}
          activeEval={activeVerticalEval}
          standings={verticalStandings}
          onLogAttempt={handleLogVerticalAttempt}
          onRaiseBar={handleRaiseBar}
          onResetActiveAttempts={() =>
            setVerticalByAthleteId((prev) => ({
              ...prev,
              [resolvedActiveAthlete.id]: [],
            }))
          }
          onSelectAthlete={setActiveAthleteId}
        />
      )}

      {/* Mode 3: Multi-Event WA Calculator */}
      {spec.mode === 'MULTI' && (
        <div className="rounded-xl bg-ap-carbon border border-ap-edge p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-ap-chalk">
              World Athletics {spec.label} Scorer · {resolvedActiveAthlete.name}
            </span>
            {eventCode === 'PENT' && (
              <div className="flex gap-1.5 font-mono text-xs">
                {(['F', 'M'] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setMultiGender(g)}
                    className={`min-h-[44px] sm:min-h-[34px] px-3 rounded-lg font-bold cursor-pointer ${
                      multiGender === g
                        ? 'bg-ap-volt text-ap-obsidian'
                        : 'bg-ap-turf text-ap-chalk border border-ap-edge'
                    }`}
                  >
                    {g === 'F' ? 'Girls / Women (Indoor)' : 'Boys / Men'}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {MULTI_DISCIPLINES[activeMultiKey].map((d) => (
              <label key={d.key} className="space-y-1">
                <span className="flex items-center justify-between text-2xs font-mono text-ap-muted-dark">
                  <span>{d.label}</span>
                  <strong className="text-ap-volt tabular-nums">
                    {activeMultiScore?.breakdown[d.key] ?? 0} pts
                  </strong>
                </span>
                <input
                  type="text"
                  data-testid={`multi-input-${d.key}`}
                  value={activeMultiRaw[d.key] || ''}
                  onChange={(e) =>
                    setMultiByAthleteId((prev) => ({
                      ...prev,
                      [resolvedActiveAthlete.id]: {
                        ...(prev[resolvedActiveAthlete.id] || {}),
                        [d.key]: e.target.value,
                      },
                    }))
                  }
                  placeholder={d.placeholder}
                  className="w-full min-h-[44px] rounded-lg bg-ap-obsidian border border-ap-edge px-2.5 font-mono text-xs font-bold text-ap-chalk"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Live Series Summary + Save Flight Sheet CTA */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ap-turf border border-ap-edge px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums">
          {spec.mode === 'MULTI' ? (
            <span className="inline-flex items-center gap-1.5 font-extrabold text-ap-volt text-sm">
              <Award className="w-4 h-4" />
              Total: {activeMultiScore?.totalPoints ?? 0} pts
            </span>
          ) : (
            <span>
              Best ({resolvedActiveAthlete.name}):{' '}
              <strong data-testid="field-sheet-best-mark" className="text-ap-volt">
                {activeSeriesSummary.bestMarkMeters
                  ? formatFieldMarkDual(activeSeriesSummary.bestMarkMeters)
                  : '—'}
              </strong>
            </span>
          )}
          <span>
            Contacts:{' '}
            <strong className="text-ap-chalk">
              {activeSeriesSummary.totalContacts}
            </strong>
          </span>
          <span className="inline-flex items-center gap-1">
            <Flame className="w-3.5 h-3.5 text-ap-volt" />
            Est. Load:{' '}
            <strong className="text-ap-chalk">
              {activeSeriesSummary.estimatedLoadTss} TSS
            </strong>
          </span>
        </div>

        <button
          type="button"
          data-testid="field-sheet-save-btn"
          disabled={saving}
          onClick={() => void handleSaveFlightSheet()}
          className="min-h-[44px] px-4 py-2 rounded-xl bg-ap-volt text-ap-obsidian font-mono font-extrabold text-xs inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>
            {saving
              ? 'Saving…'
              : readyToSaveCount > 1
                ? `Save Flight Sheet (${readyToSaveCount})`
                : 'Save Flight Sheet'}
          </span>
        </button>
      </div>

      {errorMessage && (
        <div role="alert" className="text-xs font-mono text-rose-400">
          {errorMessage}
        </div>
      )}
      {saveMessage && (
        <div
          data-testid="field-sheet-saved-banner"
          className="rounded-xl bg-emerald-500/15 border border-emerald-500/40 px-3 py-2 text-xs font-mono font-bold text-emerald-300"
        >
          {saveMessage}
        </div>
      )}

      {recentLogs.length > 0 && (
        <div className="pt-2 border-t border-ap-edge space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-2xs font-mono uppercase tracking-wider text-ap-muted-dark">
              Recent Team Field &amp; Multi Logs
              {typeof activeTeam?.fieldMarkLogsTotalCount === 'number'
                ? ` (${activeTeam.fieldMarkLogsTotalCount} total)`
                : ''}
            </div>
            {activeTeam && !activeTeam.brand.teamId.startsWith('demo_') && (
              <button
                type="button"
                onClick={() => void handleLoadFullArchive()}
                disabled={archiveLoading}
                className="text-2xs font-mono text-ap-volt hover:underline cursor-pointer disabled:opacity-50"
              >
                {archiveLoading ? 'Loading archive…' : 'Refresh Full Archive'}
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {recentLogs.slice(0, 6).map((log) => (
              <div
                key={log.id}
                className="rounded-xl bg-ap-carbon border border-ap-edge px-3 py-2 flex items-center justify-between gap-2 text-xs font-mono"
              >
                <div className="min-w-0">
                  <div className="font-bold text-ap-chalk truncate">
                    {log.athleteName} · {log.eventCode}
                    {log.placeRank ? ` · #${log.placeRank}` : ''}
                    {log.isNoHeight ? ' · NH' : ''}
                  </div>
                  <div className="text-2xs text-ap-muted-dark truncate">
                    {log.date} · {log.isCompetition ? 'Meet' : 'Practice'}
                    {log.flightName ? ` · ${log.flightName}` : ''}
                    {log.implementSpec ? ` · ${log.implementSpec}` : ''}
                    {log.poleSpec ? ` · ${log.poleSpec}` : ''}
                  </div>
                </div>
                <span className="font-extrabold text-ap-volt shrink-0 tabular-nums">
                  {typeof log.multiPoints === 'number'
                    ? `${log.multiPoints} pts`
                    : log.bestMarkMeters
                      ? `${formatFieldMark(log.bestMarkMeters, unit)}${log.isWindAidedBest ? 'w' : ''}`
                      : log.isNoHeight
                        ? 'NH'
                        : 'Logged'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
