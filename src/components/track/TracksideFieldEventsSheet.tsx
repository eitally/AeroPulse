import React, { useMemo, useState } from 'react';
import { Award, Check, CheckCircle2, Flame, Plus, Target, Trash2, X } from '../icons/PhosphorIcons';
import {
  FIELD_EVENT_CATALOG,
  computeMultiEventScore,
  formatFieldMarkDual,
  getFieldEventSpec,
  parseFieldMarkToMeters,
  summarizeFieldSeries,
} from '../../physiology/fieldEventsEngine';
import { recordTeamFieldMarksApi } from '../../utils/teamLifecycleApi';
import type {
  CoachEventGroup,
  ConnectedAthleteRecord,
  DistanceUnit,
  FieldEventCode,
  FieldEventLogRecord,
  FieldTrialEntry,
  TeamSummaryWithRole,
} from '../../types';

export interface TracksideFieldEventsSheetProps {
  activeTeam: TeamSummaryWithRole | null;
  myTeams: TeamSummaryWithRole[];
  rosterAthletes: ConnectedAthleteRecord[];
  allowedEventGroups?: CoachEventGroup[];
  distanceUnit?: DistanceUnit;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], activeId?: string) => void;
}

const MULTI_DISCIPLINES: Record<'DEC' | 'HEPT' | 'PENT_F' | 'PENT_M', Array<{ key: string; label: string; kind: 'TIME' | 'MARK'; placeholder: string }>> = {
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

interface AthleteOption {
  id: string;
  membershipId?: string;
  name: string;
  eventGroup?: CoachEventGroup | null;
}

export const TracksideFieldEventsSheet: React.FC<TracksideFieldEventsSheetProps> = ({
  activeTeam,
  myTeams,
  rosterAthletes,
  allowedEventGroups,
  onTeamsUpdated,
}) => {
  const [eventCode, setEventCode] = useState<FieldEventCode>('LJ');
  const spec = useMemo(() => getFieldEventSpec(eventCode), [eventCode]);

  const athleteOptions = useMemo<AthleteOption[]>(() => {
    const teamMembers = (activeTeam?.memberships || [])
      .filter((m) => m.role === 'ATHLETE')
      .map((m) => ({
        id: m.membershipId,
        membershipId: m.membershipId,
        name: m.invitedName,
        eventGroup: m.eventGroup || null,
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

  const [selectedAthleteId, setSelectedAthleteId] = useState<string>('');
  const [customAthleteName, setCustomAthleteName] = useState<string>('');
  const resolvedAthlete = useMemo(() => {
    if (athleteOptions.length === 0) return null;
    return athleteOptions.find((a) => a.id === selectedAthleteId) || athleteOptions[0];
  }, [athleteOptions, selectedAthleteId]);

  const [sessionDate, setSessionDate] = useState<string>(todayLocalIso);
  const [isCompetition, setIsCompetition] = useState<boolean>(true);
  const [meetTitle, setMeetTitle] = useState<string>('Spring Practice / Meet Sheet');
  const [implementSpec, setImplementSpec] = useState<string>('');
  const [poleSpec, setPoleSpec] = useState<string>("14'0 155lb");
  const [approachSteps, setApproachSteps] = useState<string>('7');
  const [rpe, setRpe] = useState<number>(6);

  // Horizontal & Throws trials
  const [trialInputs, setTrialInputs] = useState<Array<{ raw: string; outcome: 'MARK' | 'FOUL' | 'PASS' }>>([
    { raw: "20' 6.5\"", outcome: 'MARK' },
    { raw: '', outcome: 'MARK' },
    { raw: '', outcome: 'MARK' },
  ]);

  // Vertical bars (HJ / PV)
  const [barHeightRaw, setBarHeightRaw] = useState<string>("5' 10\"");
  const [verticalAttempts, setVerticalAttempts] = useState<FieldTrialEntry[]>([]);

  // Multi-event inputs
  const [multiGender, setMultiGender] = useState<'F' | 'M'>('M');
  const [multiRaw, setMultiRaw] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [localSavedLogs, setLocalSavedLogs] = useState<FieldEventLogRecord[]>([]);

  const handleSelectEvent = (next: FieldEventCode) => {
    setEventCode(next);
    setSaveMessage(null);
    setErrorMessage(null);
    const nextSpec = getFieldEventSpec(next);
    if (nextSpec.mode === 'VERTICAL') {
      setBarHeightRaw(next === 'PV' ? "12' 6\"" : "5' 10\"");
      setVerticalAttempts([]);
    }
    if (nextSpec.mode === 'THROW' && nextSpec.implementPresets?.length) {
      setImplementSpec(nextSpec.implementPresets[0]);
    }
  };

  const builtAttempts = useMemo<FieldTrialEntry[]>(() => {
    if (spec.mode === 'VERTICAL') return verticalAttempts;
    if (spec.mode === 'MULTI') return [];
    return trialInputs.map((t, idx) => {
      const parsed = t.outcome === 'MARK' ? parseFieldMarkToMeters(t.raw) : null;
      return {
        attemptNumber: idx + 1,
        outcome: t.outcome,
        markMeters: parsed ?? undefined,
      };
    });
  }, [spec.mode, trialInputs, verticalAttempts]);

  const seriesSummary = useMemo(
    () => summarizeFieldSeries(eventCode, builtAttempts, rpe),
    [eventCode, builtAttempts, rpe]
  );

  const multiScore = useMemo(() => {
    if (spec.mode !== 'MULTI') return null;
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
      const raw = (multiRaw[d.key] || '').trim();
      if (!raw) continue;
      if (d.kind === 'TIME') {
        const secs = Number(raw);
        if (Number.isFinite(secs) && secs > 0) marks[d.key] = secs;
      } else {
        const meters = parseFieldMarkToMeters(raw);
        if (meters !== null) marks[d.key] = meters;
      }
    }
    return computeMultiEventScore(eventCode as 'PENT' | 'HEPT' | 'DEC', multiGender, marks);
  }, [eventCode, multiGender, multiRaw, spec.mode]);

  const currentBarMeters = useMemo(() => parseFieldMarkToMeters(barHeightRaw), [barHeightRaw]);

  const handleLogVerticalAttempt = (outcome: 'CLEAR' | 'MISS' | 'PASS') => {
    if (currentBarMeters === null) {
      setErrorMessage("Enter a valid bar height (e.g. 5' 10\" or 1.78m) before logging.");
      return;
    }
    setErrorMessage(null);
    setVerticalAttempts((prev) => [
      ...prev,
      {
        attemptNumber: prev.length + 1,
        outcome,
        barHeightMeters: currentBarMeters,
      },
    ]);
  };

  const handleRaiseBar = () => {
    const base = currentBarMeters ?? (eventCode === 'PV' ? 3.81 : 1.78);
    const step = spec.barStepMeters ?? 0.0508;
    const nextMeters = Number((base + step).toFixed(3));
    setBarHeightRaw(`${nextMeters.toFixed(2)}m`);
  };

  const handleSaveSheet = async () => {
    setSaveMessage(null);
    setErrorMessage(null);
    const athleteName = customAthleteName.trim() || resolvedAthlete?.name || 'Track Athlete';
    if (spec.mode === 'MULTI' && (!multiScore || multiScore.totalPoints <= 0)) {
      setErrorMessage('Enter at least one multi-event mark or time before saving.');
      return;
    }
    const validAttempts = builtAttempts.filter(
      (a) =>
        a.outcome === 'FOUL' ||
        a.outcome === 'PASS' ||
        a.outcome === 'MISS' ||
        (a.markMeters ?? 0) > 0 ||
        (a.barHeightMeters ?? 0) > 0
    );
    if (spec.mode !== 'MULTI' && validAttempts.length === 0) {
      setErrorMessage('Record at least one valid mark, bar attempt, or foul before saving.');
      return;
    }

    const entry = {
      membershipId: resolvedAthlete?.membershipId,
      athleteName,
      date: sessionDate,
      eventCode,
      isCompetition,
      meetOrPracticeTitle: meetTitle.trim() || undefined,
      implementSpec: spec.mode === 'THROW' ? implementSpec.trim() || spec.defaultImplementSpec : undefined,
      poleSpec: eventCode === 'PV' ? poleSpec.trim() || undefined : undefined,
      approachSteps: Number(approachSteps) > 0 ? Number(approachSteps) : undefined,
      attempts: spec.mode === 'MULTI' ? [] : validAttempts,
      multiPoints: spec.mode === 'MULTI' ? multiScore?.totalPoints : undefined,
      rpe,
    };

    const recordLocally = () => {
      const localRecord: FieldEventLogRecord = {
        id: `field-local-${Date.now()}`,
        teamId: activeTeam?.brand.teamId,
        membershipId: entry.membershipId,
        athleteName: entry.athleteName,
        date: entry.date,
        eventCode: entry.eventCode,
        eventGroup: spec.eventGroup,
        isCompetition: entry.isCompetition,
        meetOrPracticeTitle: entry.meetOrPracticeTitle || `${spec.shortLabel} Session`,
        implementSpec: entry.implementSpec,
        poleSpec: entry.poleSpec,
        approachSteps: entry.approachSteps,
        attempts: entry.attempts,
        bestMarkMeters: seriesSummary.bestMarkMeters ?? undefined,
        multiPoints: entry.multiPoints,
        rpe: entry.rpe,
        createdAt: new Date().toISOString(),
      };
      setLocalSavedLogs((prev) => [localRecord, ...prev]);
      if (activeTeam) {
        const updatedTeam: TeamSummaryWithRole = {
          ...activeTeam,
          fieldMarkLogs: [localRecord, ...(activeTeam.fieldMarkLogs || [])].slice(0, 60),
        };
        onTeamsUpdated(
          myTeams.map((t) => (t.brand.teamId === activeTeam.brand.teamId ? updatedTeam : t)),
          activeTeam.brand.teamId
        );
      }
      setSaveMessage(`Saved ${spec.shortLabel} sheet for ${entry.athleteName} ✓`);
    };

    if (!activeTeam) {
      recordLocally();
      return;
    }

    setSaving(true);
    try {
      const resp = await recordTeamFieldMarksApi({
        teamId: activeTeam.brand.teamId,
        entries: [entry],
      });
      if (resp.teams && resp.teams.length > 0) {
        onTeamsUpdated(resp.teams, activeTeam.brand.teamId);
      } else if (resp.team) {
        onTeamsUpdated(
          myTeams.map((t) => (t.brand.teamId === resp.team!.brand.teamId ? resp.team! : t)),
          resp.team.brand.teamId
        );
      }
      setSaveMessage(`Saved ${spec.shortLabel} marks for ${entry.athleteName} to Team Log ✓`);
    } catch {
      // Demo/local workspaces fall back cleanly without losing marks
      recordLocally();
    } finally {
      setSaving(false);
    }
  };

  const recentLogs = useMemo(() => {
    const serverLogs = activeTeam?.fieldMarkLogs || [];
    const seen = new Set(serverLogs.map((l) => l.id));
    return [...serverLogs, ...localSavedLogs.filter((l) => !seen.has(l.id))].slice(0, 8);
  }, [activeTeam?.fieldMarkLogs, localSavedLogs]);

  const activeMultiKey =
    eventCode === 'DEC'
      ? 'DEC'
      : eventCode === 'HEPT'
        ? 'HEPT'
        : multiGender === 'M'
          ? 'PENT_M'
          : 'PENT_F';

  return (
    <section
      data-testid="trackside-field-events-sheet"
      className="rounded-2xl bg-ap-obsidian text-ap-chalk border border-ap-edge p-3.5 sm:p-5 space-y-4 shadow-xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ap-edge pb-3">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-ap-volt shrink-0" />
          <div>
            <h2 className="text-base sm:text-lg font-extrabold tracking-tight text-ap-chalk">
              Trackside Field &amp; Multi-Event Sheet
            </h2>
            <p className="text-2xs font-mono text-ap-muted-dark">
              Horizontal Jumps · Vertical O/X/- · Throws Implements · WA Multi Scoring
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs">
          <button
            type="button"
            onClick={() => setIsCompetition(true)}
            aria-pressed={isCompetition}
            className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl font-bold cursor-pointer ${
              isCompetition ? 'bg-ap-volt text-ap-obsidian' : 'bg-ap-turf text-ap-chalk border border-ap-edge'
            }`}
          >
            Meet Marks
          </button>
          <button
            type="button"
            onClick={() => setIsCompetition(false)}
            aria-pressed={!isCompetition}
            className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl font-bold cursor-pointer ${
              !isCompetition ? 'bg-ap-volt text-ap-obsidian' : 'bg-ap-turf text-ap-chalk border border-ap-edge'
            }`}
          >
            Practice Contacts
          </button>
        </div>
      </div>

      {/* Event Pill Strip */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Select field or multi event">
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

      {/* Athlete + Metadata Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
        <label className="space-y-1">
          <span className="block text-2xs font-mono uppercase text-ap-muted-dark">Athlete</span>
          {athleteOptions.length > 0 ? (
            <select
              data-testid="field-sheet-athlete-select"
              value={resolvedAthlete?.id || ''}
              onChange={(e) => setSelectedAthleteId(e.target.value)}
              className="w-full min-h-[44px] rounded-xl bg-ap-carbon border border-ap-edge px-3 py-2 text-ap-chalk font-semibold"
            >
              {athleteOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.eventGroup ? ` (${a.eventGroup})` : ''}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              data-testid="field-sheet-athlete-input"
              value={customAthleteName}
              onChange={(e) => setCustomAthleteName(e.target.value)}
              placeholder="Athlete Name (e.g. Jordan Maya)"
              className="w-full min-h-[44px] rounded-xl bg-ap-carbon border border-ap-edge px-3 py-2 text-ap-chalk font-semibold"
            />
          )}
        </label>

        <label className="space-y-1">
          <span className="block text-2xs font-mono uppercase text-ap-muted-dark">Date &amp; Title</span>
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
              placeholder="Dual Meet / Practice"
              className="flex-1 min-w-0 min-h-[44px] rounded-xl bg-ap-carbon border border-ap-edge px-2.5 py-1.5 text-ap-chalk"
            />
          </div>
        </label>

        {spec.mode === 'THROW' ? (
          <label className="space-y-1">
            <span className="block text-2xs font-mono uppercase text-ap-muted-dark">Implement Weight</span>
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
            <span className="block text-2xs font-mono uppercase text-ap-muted-dark">Pole Spec &amp; Steps</span>
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
                aria-label="Approach steps"
                className="w-16 min-h-[44px] rounded-xl bg-ap-carbon border border-ap-edge px-2 font-mono text-ap-chalk"
              />
            </div>
          </label>
        ) : (
          <label className="space-y-1">
            <span className="block text-2xs font-mono uppercase text-ap-muted-dark">Approach Steps</span>
            <input
              type="number"
              min={3}
              max={22}
              value={approachSteps}
              onChange={(e) => setApproachSteps(e.target.value)}
              className="w-full min-h-[44px] rounded-xl bg-ap-carbon border border-ap-edge px-3 font-mono text-ap-chalk"
            />
          </label>
        )}

        <label className="space-y-1">
          <span className="block text-2xs font-mono uppercase text-ap-muted-dark">Effort RPE (1–10)</span>
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

      {/* Mode 1: Horizontal & Throws Attempts */}
      {(spec.mode === 'HORIZONTAL' || spec.mode === 'THROW') && (
        <div className="rounded-xl bg-ap-carbon border border-ap-edge p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-ap-chalk">
              {spec.label} Trials (ft-in like 21&apos; 6.5&quot; or 6.57m)
            </span>
            {trialInputs.length < 6 && (
              <button
                type="button"
                onClick={() => setTrialInputs((prev) => [...prev, { raw: '', outcome: 'MARK' }])}
                className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl bg-ap-turf border border-ap-edge text-xs font-mono font-bold text-ap-volt inline-flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Add Trial
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {trialInputs.map((t, idx) => {
              const parsedMeters = t.outcome === 'MARK' ? parseFieldMarkToMeters(t.raw) : null;
              return (
                <div key={idx} className="rounded-xl bg-ap-obsidian border border-ap-edge p-2.5 space-y-2">
                  <div className="flex items-center justify-between text-2xs font-mono">
                    <span className="font-bold text-ap-volt">TRIAL {idx + 1}</span>
                    {parsedMeters !== null && (
                      <span className="text-ap-chalk tabular-nums">{formatFieldMarkDual(parsedMeters)}</span>
                    )}
                  </div>
                  <input
                    type="text"
                    data-testid={`field-trial-input-${idx}`}
                    disabled={t.outcome !== 'MARK'}
                    value={t.outcome === 'MARK' ? t.raw : t.outcome}
                    onChange={(e) =>
                      setTrialInputs((prev) =>
                        prev.map((row, i) => (i === idx ? { ...row, raw: e.target.value, outcome: 'MARK' } : row))
                      )
                    }
                    placeholder={spec.mode === 'THROW' ? "44' 2\" or 13.46m" : "21' 6\" or 6.55m"}
                    className="w-full min-h-[44px] rounded-lg bg-ap-carbon border border-ap-edge px-2.5 font-mono text-sm font-bold text-ap-chalk disabled:opacity-50"
                  />
                  <div className="flex gap-1.5 font-mono text-2xs">
                    {(['MARK', 'FOUL', 'PASS'] as const).map((out) => (
                      <button
                        key={out}
                        type="button"
                        data-testid={`field-trial-${out.toLowerCase()}-${idx}`}
                        onClick={() =>
                          setTrialInputs((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, outcome: out } : row))
                          )
                        }
                        className={`flex-1 min-h-[44px] sm:min-h-[34px] rounded-lg font-bold cursor-pointer ${
                          t.outcome === out
                            ? out === 'FOUL'
                              ? 'bg-rose-600 text-white'
                              : 'bg-ap-volt text-ap-obsidian'
                            : 'bg-ap-turf text-ap-muted-dark border border-ap-edge'
                        }`}
                      >
                        {out === 'FOUL' ? 'Foul (X)' : out === 'PASS' ? 'Pass (-)' : 'Mark'}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Mode 2: Vertical HJ / PV Bar Stepper & O / X / - */}
      {spec.mode === 'VERTICAL' && (
        <div className="rounded-xl bg-ap-carbon border border-ap-edge p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex-1 min-w-[160px]">
              <span className="block text-2xs font-mono uppercase text-ap-muted-dark mb-1">Current Bar Height</span>
              <input
                type="text"
                data-testid="field-vertical-bar-input"
                value={barHeightRaw}
                onChange={(e) => setBarHeightRaw(e.target.value)}
                placeholder={eventCode === 'PV' ? "12' 6\" or 3.81m" : "5' 10\" or 1.78m"}
                className="w-full min-h-[44px] rounded-xl bg-ap-obsidian border border-ap-edge px-3 font-mono text-base font-extrabold text-ap-volt"
              />
            </label>
            <button
              type="button"
              data-testid="field-vertical-clear-btn"
              onClick={() => handleLogVerticalAttempt('CLEAR')}
              className="min-h-[44px] px-4 rounded-xl bg-emerald-500 text-ap-obsidian font-mono font-extrabold text-xs inline-flex items-center gap-1 cursor-pointer mt-5"
            >
              <Check className="w-4 h-4" /> O Clear
            </button>
            <button
              type="button"
              data-testid="field-vertical-miss-btn"
              onClick={() => handleLogVerticalAttempt('MISS')}
              className="min-h-[44px] px-4 rounded-xl bg-rose-600 text-white font-mono font-extrabold text-xs inline-flex items-center gap-1 cursor-pointer mt-5"
            >
              <X className="w-4 h-4" /> X Miss
            </button>
            <button
              type="button"
              data-testid="field-vertical-pass-btn"
              onClick={() => handleLogVerticalAttempt('PASS')}
              className="min-h-[44px] px-3 rounded-xl bg-ap-turf border border-ap-edge text-ap-chalk font-mono font-bold text-xs cursor-pointer mt-5"
            >
              - Pass
            </button>
            <button
              type="button"
              data-testid="field-vertical-raise-btn"
              onClick={handleRaiseBar}
              className="min-h-[44px] px-3 rounded-xl bg-ap-volt text-ap-obsidian font-mono font-extrabold text-xs cursor-pointer mt-5"
            >
              +{eventCode === 'PV' ? '6"' : '2"'} Bar ↑
            </button>
          </div>
          {verticalAttempts.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono bg-ap-obsidian border border-ap-edge rounded-xl px-3 py-2">
              <span data-testid="field-vertical-series-text" className="text-ap-chalk tabular-nums">
                Series: {seriesSummary.verticalSeriesSummary}
              </span>
              <button
                type="button"
                onClick={() => setVerticalAttempts([])}
                className="text-rose-400 inline-flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" /> Reset
              </button>
            </div>
          )}
        </div>
      )}

      {/* Mode 3: Multi-Event WA Calculator */}
      {spec.mode === 'MULTI' && (
        <div className="rounded-xl bg-ap-carbon border border-ap-edge p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-ap-chalk">
              World Athletics {spec.label} Scorer
            </span>
            {eventCode === 'PENT' && (
              <div className="flex gap-1.5 font-mono text-xs">
                {(['F', 'M'] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setMultiGender(g)}
                    className={`min-h-[44px] sm:min-h-[34px] px-3 rounded-lg font-bold cursor-pointer ${
                      multiGender === g ? 'bg-ap-volt text-ap-obsidian' : 'bg-ap-turf text-ap-chalk border border-ap-edge'
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
                    {multiScore?.breakdown[d.key] ?? 0} pts
                  </strong>
                </span>
                <input
                  type="text"
                  data-testid={`multi-input-${d.key}`}
                  value={multiRaw[d.key] || ''}
                  onChange={(e) => setMultiRaw((prev) => ({ ...prev, [d.key]: e.target.value }))}
                  placeholder={d.placeholder}
                  className="w-full min-h-[44px] rounded-lg bg-ap-obsidian border border-ap-edge px-2.5 font-mono text-xs font-bold text-ap-chalk"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Live Series Summary + Save CTA */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ap-turf border border-ap-edge px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums">
          {spec.mode === 'MULTI' ? (
            <span className="inline-flex items-center gap-1.5 font-extrabold text-ap-volt text-sm">
              <Award className="w-4 h-4" />
              Total: {multiScore?.totalPoints ?? 0} pts
            </span>
          ) : (
            <span>
              Best:{' '}
              <strong data-testid="field-sheet-best-mark" className="text-ap-volt">
                {seriesSummary.bestMarkMeters ? formatFieldMarkDual(seriesSummary.bestMarkMeters) : '—'}
              </strong>
            </span>
          )}
          <span>
            Contacts: <strong className="text-ap-chalk">{seriesSummary.totalContacts}</strong>
          </span>
          <span className="inline-flex items-center gap-1">
            <Flame className="w-3.5 h-3.5 text-ap-volt" />
            Est. Load: <strong className="text-ap-chalk">{seriesSummary.estimatedLoadTss} TSS</strong>
          </span>
        </div>

        <button
          type="button"
          data-testid="field-sheet-save-btn"
          disabled={saving}
          onClick={() => void handleSaveSheet()}
          className="min-h-[44px] px-4 py-2 rounded-xl bg-ap-volt text-ap-obsidian font-mono font-extrabold text-xs inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>{saving ? 'Saving…' : 'Save Field Sheet'}</span>
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
          <div className="text-2xs font-mono uppercase tracking-wider text-ap-muted-dark">
            Recent Team Field &amp; Multi Logs
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {recentLogs.slice(0, 4).map((log) => (
              <div
                key={log.id}
                className="rounded-xl bg-ap-carbon border border-ap-edge px-3 py-2 flex items-center justify-between gap-2 text-xs font-mono"
              >
                <div className="min-w-0">
                  <div className="font-bold text-ap-chalk truncate">
                    {log.athleteName} · {log.eventCode}
                  </div>
                  <div className="text-2xs text-ap-muted-dark truncate">
                    {log.date} · {log.isCompetition ? 'Meet' : 'Practice'}
                    {log.implementSpec ? ` · ${log.implementSpec}` : ''}
                    {log.poleSpec ? ` · ${log.poleSpec}` : ''}
                  </div>
                </div>
                <span className="font-extrabold text-ap-volt shrink-0 tabular-nums">
                  {typeof log.multiPoints === 'number'
                    ? `${log.multiPoints} pts`
                    : log.bestMarkMeters
                      ? formatFieldMarkDual(log.bestMarkMeters)
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
