import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  HeartPulse,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from '../icons/PhosphorIcons';
import { useModalDialog } from '../../hooks/useModalDialog';
import {
  ALL_INJURY_BODY_REGIONS,
  INJURY_REGION_METADATA,
  RTP_STAGE_METADATA,
  buildDemoSeedInjuryCases,
  computePainTrendHeatmap,
  stripClinicalNotesForRole,
  type InjuryBodyRegion,
} from '../../physiology/injuryHubEngine';
import {
  deleteTeamInjuryCaseApi,
  fetchTeamInjuriesApi,
  upsertTeamInjuryCaseApi,
} from '../../utils/injuryHubApi';
import { getLocalDateIso } from '../../physiology/stravaLoadCalibration';
import type {
  TeamInjuryCaseRecord,
  TeamInjuryRtpStage,
  TeamSummaryWithRole,
} from '../../types';

export interface AthleticTrainerInjuryHubProps {
  isOpen: boolean;
  onClose: () => void;
  activeTeam: TeamSummaryWithRole | null;
  myTeams: TeamSummaryWithRole[];
  isSampleDemoMode?: boolean;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string) => void;
}

const RTP_STAGE_ORDER: readonly TeamInjuryRtpStage[] = [
  'OUT',
  'MODIFIED',
  'LIMITED',
  'CLEARED',
] as const;

const SEVERITY_OPTIONS: ReadonlyArray<{
  id: TeamInjuryCaseRecord['severity'];
  label: string;
}> = [
  { id: 'LOW', label: 'Low' },
  { id: 'MODERATE', label: 'Moderate' },
  { id: 'HIGH', label: 'High' },
];

function rtpStageStatusClass(stage: TeamInjuryRtpStage): string {
  const tone = RTP_STAGE_METADATA[stage].tone;
  if (tone === 'strained') return 'ap-status-strained';
  if (tone === 'caution') return 'ap-status-caution';
  if (tone === 'prime') return 'ap-status-prime';
  return 'ap-status-info';
}

function escapeClearanceCsvCell(value: unknown): string {
  const raw = String(value ?? '');
  const trimmed = raw.trimStart();
  const safe =
    trimmed.startsWith('=') ||
    trimmed.startsWith('+') ||
    trimmed.startsWith('-') ||
    trimmed.startsWith('@') ||
    trimmed.startsWith('\t') ||
    trimmed.startsWith('\r')
      ? `'${raw}`
      : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildDailyClearanceCsv(
  cases: TeamInjuryCaseRecord[],
  teamName: string,
  dateIso: string
): string {
  const headers = [
    'Team',
    'Date',
    'Athlete',
    'Body Region',
    'Severity',
    'RTP Stage',
    'Coach Restrictions',
    'Coach Guidance',
    'Target Return Date',
    'Updated By',
  ];
  const rows = cases.map((c) =>
    [
      teamName,
      dateIso,
      c.athleteName,
      c.bodyRegion,
      c.severity,
      c.rtpStage,
      c.restrictions || '',
      c.coachGuidance || '',
      c.targetReturnDate || '',
      c.updatedByName || 'Athletic Trainer',
    ]
      .map(escapeClearanceCsvCell)
      .join(',')
  );
  return [headers.map(escapeClearanceCsvCell).join(','), ...rows].join('\n');
}

function heatTileClass(
  heatLevel: 'NONE' | 'LOW' | 'ELEVATED' | 'HOTSPOT',
  selected: boolean
): string {
  const ring = selected ? 'ring-2 ring-ap-clay dark:ring-ap-volt' : '';
  if (heatLevel === 'HOTSPOT') return `ap-status-strained ${ring}`;
  if (heatLevel === 'ELEVATED') return `ap-status-caution ${ring}`;
  if (heatLevel === 'LOW') return `ap-status-info ${ring}`;
  return `ap-card-inset ${ring}`;
}

export const AthleticTrainerInjuryHub: React.FC<AthleticTrainerInjuryHubProps> = ({
  isOpen,
  onClose,
  activeTeam,
  myTeams,
  isSampleDemoMode = false,
  onTeamsUpdated,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const headingId = useId();
  const formId = useId();

  useModalDialog({ isOpen, onClose, dialogRef });

  const activeTeamRef = useRef(activeTeam);
  activeTeamRef.current = activeTeam;
  const myTeamsRef = useRef(myTeams);
  myTeamsRef.current = myTeams;
  const onTeamsUpdatedRef = useRef(onTeamsUpdated);
  onTeamsUpdatedRef.current = onTeamsUpdated;

  const isAthleticTrainer = activeTeam?.myRole === 'ATHLETIC_TRAINER';
  const [heatmapWindow, setHeatmapWindow] = useState<7 | 30>(7);
  const [stageFilter, setStageFilter] = useState<TeamInjuryRtpStage | 'ALL'>('ALL');
  const [selectedRegionFilter, setSelectedRegionFilter] = useState<InjuryBodyRegion | 'ALL'>(
    'ALL'
  );
  const [demoFallbackCases, setDemoFallbackCases] = useState<TeamInjuryCaseRecord[] | null>(
    null
  );
  const [isLoadingCases, setIsLoadingCases] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Create / Edit Case Form State
  const [showCaseForm, setShowCaseForm] = useState<boolean>(false);
  const [editingCaseId, setEditingCaseId] = useState<string | undefined>(undefined);
  const [formMembershipId, setFormMembershipId] = useState<string>('');
  const [formBodyRegion, setFormBodyRegion] = useState<InjuryBodyRegion>('SHIN');
  const [formSeverity, setFormSeverity] =
    useState<TeamInjuryCaseRecord['severity']>('MODERATE');
  const [formRtpStage, setFormRtpStage] = useState<TeamInjuryRtpStage>('MODIFIED');
  const [formTargetReturnDate, setFormTargetReturnDate] = useState<string>('');
  const [formRestrictions, setFormRestrictions] = useState<string>('');
  const [formCoachGuidance, setFormCoachGuidance] = useState<string>('');
  const [formClinicalNotes, setFormClinicalNotes] = useState<string>('');

  const rosterAthletes = useMemo(
    () =>
      (activeTeam?.memberships || []).filter(
        (m) => m.role === 'ATHLETE' && m.status !== 'REVOKED' && m.status !== 'ALUMNI'
      ),
    [activeTeam?.memberships]
  );

  useEffect(() => {
    if (!isOpen || !activeTeam) return;
    setStatusBanner(null);
    setErrorBanner(null);
    if (
      (isSampleDemoMode || !(activeTeam.injuryCases && activeTeam.injuryCases.length > 0)) &&
      isSampleDemoMode
    ) {
      setDemoFallbackCases(buildDemoSeedInjuryCases(activeTeam));
    } else {
      setDemoFallbackCases(null);
    }

    if (isSampleDemoMode) return;
    const targetTeamId = activeTeam.brand.teamId;
    let cancelled = false;
    setIsLoadingCases(true);
    fetchTeamInjuriesApi(targetTeamId)
      .then((res) => {
        if (cancelled) return;
        const latestTeams = myTeamsRef.current;
        const latestTeam =
          latestTeams.find((t) => t.brand.teamId === targetTeamId) ||
          (activeTeamRef.current?.brand.teamId === targetTeamId ? activeTeamRef.current : null);
        if (!latestTeam) return;
        const updatedTeam: TeamSummaryWithRole = {
          ...latestTeam,
          injuryCases: res.cases || [],
        };
        onTeamsUpdatedRef.current(
          latestTeams.map((t) => (t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t)),
          updatedTeam.brand.teamId
        );
      })
      .catch(() => {
        // Keep team summary injuryCases or offline/demo preview safely when server route is unavailable
      })
      .finally(() => {
        if (!cancelled) setIsLoadingCases(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, activeTeam?.brand.teamId, isSampleDemoMode]);

  const effectiveCases = useMemo<TeamInjuryCaseRecord[]>(() => {
    if (!activeTeam) return [];
    const serverCases = activeTeam.injuryCases;
    const rawCases =
      Array.isArray(serverCases) && serverCases.length > 0
        ? serverCases
        : demoFallbackCases || [];
    return stripClinicalNotesForRole(rawCases, activeTeam.myRole);
  }, [activeTeam, demoFallbackCases]);

  const dashboard = useMemo(
    () =>
      computePainTrendHeatmap({
        memberships: activeTeam?.memberships || [],
        injuryCases: effectiveCases,
        windowDays: heatmapWindow,
        referenceDateIso: getLocalDateIso(),
      }),
    [activeTeam?.memberships, effectiveCases, heatmapWindow]
  );

  const visibleCases = useMemo(() => {
    return effectiveCases.filter((c) => {
      if (stageFilter !== 'ALL' && c.rtpStage !== stageFilter) return false;
      if (selectedRegionFilter !== 'ALL' && c.bodyRegion !== selectedRegionFilter) return false;
      return true;
    });
  }, [effectiveCases, stageFilter, selectedRegionFilter]);

  if (!isOpen) return null;

  const openNewCaseForm = (opts?: {
    membershipId?: string;
    bodyRegion?: InjuryBodyRegion;
    restrictions?: string;
  }) => {
    const region = opts?.bodyRegion || 'SHIN';
    const defaultMemberId = opts?.membershipId || rosterAthletes[0]?.membershipId || '';
    setEditingCaseId(undefined);
    setFormMembershipId(defaultMemberId);
    setFormBodyRegion(region);
    setFormSeverity('MODERATE');
    setFormRtpStage('MODIFIED');
    setFormTargetReturnDate('');
    setFormRestrictions(
      opts?.restrictions || INJURY_REGION_METADATA[region].defaultRestrictionHint
    );
    setFormCoachGuidance('Substitute zero-impact bike/aqua flush during high-impact reps.');
    setFormClinicalNotes('');
    setShowCaseForm(true);
    setErrorBanner(null);
  };

  const openEditCaseForm = (c: TeamInjuryCaseRecord) => {
    setEditingCaseId(c.id);
    setFormMembershipId(c.membershipId);
    setFormBodyRegion(c.bodyRegion);
    setFormSeverity(c.severity);
    setFormRtpStage(c.rtpStage);
    setFormTargetReturnDate(c.targetReturnDate || '');
    setFormRestrictions(c.restrictions);
    setFormCoachGuidance(c.coachGuidance);
    setFormClinicalNotes(isAthleticTrainer ? c.privateClinicalNotes || '' : '');
    setShowCaseForm(true);
    setErrorBanner(null);
  };

  const applyLocalTeamMutation = (
    nextCases: TeamInjuryCaseRecord[],
    targetMembershipId: string,
    nextStage: TeamInjuryRtpStage
  ) => {
    if (!activeTeam) return;
    if (isSampleDemoMode && !(activeTeam.injuryCases && activeTeam.injuryCases.length > 0)) {
      setDemoFallbackCases(nextCases);
    }
    const nextMemberships = activeTeam.memberships.map((m) => {
      if (m.membershipId !== targetMembershipId) return m;
      if (m.status === 'REVOKED' || m.status === 'ALUMNI') return m;
      if (nextStage === 'OUT' || nextStage === 'MODIFIED') {
        return { ...m, status: 'INJURED' as const };
      }
      if (nextStage === 'CLEARED' && m.status === 'INJURED') {
        const stillInjured = nextCases.some(
          (c) =>
            c.membershipId === targetMembershipId &&
            (c.rtpStage === 'OUT' || c.rtpStage === 'MODIFIED')
        );
        return stillInjured ? m : { ...m, status: 'ACTIVE' as const };
      }
      return m;
    });
    const latestTeams = myTeamsRef.current;
    const baseTeam =
      latestTeams.find((t) => t.brand.teamId === activeTeam.brand.teamId) || activeTeam;
    const updatedTeam: TeamSummaryWithRole = {
      ...baseTeam,
      memberships: nextMemberships,
      injuryCases: nextCases,
    };
    onTeamsUpdatedRef.current(
      latestTeams.map((t) => (t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t)),
      updatedTeam.brand.teamId
    );
  };

  const handleExportDailyClearance = () => {
    if (!activeTeam) return;
    const todayIso = getLocalDateIso();
    const sanitized = stripClinicalNotesForRole(visibleCases, 'HEAD_COACH');
    const csv = buildDailyClearanceCsv(
      sanitized,
      activeTeam.brand.shortName || activeTeam.brand.name,
      todayIso
    );
    const slug = (activeTeam.brand.slug || activeTeam.brand.shortName || 'team')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${slug}-daily-clearance-${todayIso}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setStatusBanner(
      `Exported daily RTP clearance CSV (${sanitized.length} row${sanitized.length === 1 ? '' : 's'}, clinical notes excluded).`
    );
  };

  const handleSaveCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTeam || !formMembershipId) {
      setErrorBanner('Select an athlete from the team roster.');
      return;
    }

    const targetAth = rosterAthletes.find((m) => m.membershipId === formMembershipId);
    const nowIso = new Date().toISOString();

    if (isSampleDemoMode) {
      const localRecord: TeamInjuryCaseRecord = {
        id: editingCaseId || `demo-inj-${Date.now()}`,
        teamId: activeTeam.brand.teamId,
        membershipId: formMembershipId,
        athleteName: targetAth?.invitedName || 'Roster Athlete',
        bodyRegion: formBodyRegion,
        severity: formSeverity,
        rtpStage: formRtpStage,
        restrictions: formRestrictions.trim() || INJURY_REGION_METADATA[formBodyRegion].defaultRestrictionHint,
        coachGuidance: formCoachGuidance.trim() || 'Follow Athletic Trainer RTP guidelines.',
        ...(isAthleticTrainer && formClinicalNotes.trim()
          ? { privateClinicalNotes: formClinicalNotes.trim() }
          : {}),
        ...(formTargetReturnDate ? { targetReturnDate: formTargetReturnDate } : {}),
        createdAt: nowIso,
        updatedAt: nowIso,
        updatedByName: isAthleticTrainer ? 'Athletic Trainer' : activeTeam.brand.coachDisplayName,
      };
      const nextList = [
        localRecord,
        ...effectiveCases.filter((c) => c.id !== localRecord.id),
      ];
      applyLocalTeamMutation(nextList, formMembershipId, formRtpStage);
      setShowCaseForm(false);
      setStatusBanner(
        `Saved ${localRecord.athleteName} (${localRecord.bodyRegion} · ${localRecord.rtpStage}) in demo preview.`
      );
      return;
    }

    setIsSaving(true);
    setErrorBanner(null);
    setStatusBanner(null);
    try {
      const resp = await upsertTeamInjuryCaseApi(activeTeam.brand.teamId, {
        ...(editingCaseId ? { id: editingCaseId } : {}),
        membershipId: formMembershipId,
        bodyRegion: formBodyRegion,
        severity: formSeverity,
        rtpStage: formRtpStage,
        restrictions: formRestrictions.trim(),
        coachGuidance: formCoachGuidance.trim(),
        ...(isAthleticTrainer ? { privateClinicalNotes: formClinicalNotes.trim() } : {}),
        ...(formTargetReturnDate ? { targetReturnDate: formTargetReturnDate } : {}),
      });
      if (resp.teams && resp.teams.length > 0) {
        onTeamsUpdatedRef.current(resp.teams, activeTeam.brand.teamId);
      } else if (resp.team) {
        onTeamsUpdatedRef.current(
          myTeamsRef.current.map((t) => (t.brand.teamId === resp.team!.brand.teamId ? resp.team! : t)),
          resp.team.brand.teamId
        );
      }
      setShowCaseForm(false);
      setStatusBanner(
        `Saved ${resp.case.athleteName} (${resp.case.bodyRegion} · ${resp.case.rtpStage}) & synced roster status.`
      );
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to save injury case.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuickStageUpdate = async (
    c: TeamInjuryCaseRecord,
    nextStage: TeamInjuryRtpStage
  ) => {
    if (!activeTeam || c.rtpStage === nextStage) return;

    if (isSampleDemoMode) {
      const updatedCase: TeamInjuryCaseRecord = {
        ...c,
        rtpStage: nextStage,
        updatedAt: new Date().toISOString(),
      };
      const nextList = effectiveCases.map((item) => (item.id === c.id ? updatedCase : item));
      applyLocalTeamMutation(nextList, c.membershipId, nextStage);
      setStatusBanner(
        `Updated ${c.athleteName} to ${nextStage} (${RTP_STAGE_METADATA[nextStage].rosterSyncLabel}).`
      );
      return;
    }

    setIsSaving(true);
    setErrorBanner(null);
    try {
      const resp = await upsertTeamInjuryCaseApi(activeTeam.brand.teamId, {
        id: c.id,
        membershipId: c.membershipId,
        bodyRegion: c.bodyRegion,
        severity: c.severity,
        rtpStage: nextStage,
        restrictions: c.restrictions,
        coachGuidance: c.coachGuidance,
        ...(c.targetReturnDate ? { targetReturnDate: c.targetReturnDate } : {}),
      });
      if (resp.teams && resp.teams.length > 0) {
        onTeamsUpdatedRef.current(resp.teams, activeTeam.brand.teamId);
      } else if (resp.team) {
        onTeamsUpdatedRef.current(
          myTeamsRef.current.map((t) => (t.brand.teamId === resp.team!.brand.teamId ? resp.team! : t)),
          resp.team.brand.teamId
        );
      }
      setStatusBanner(
        `Updated ${c.athleteName} to ${nextStage} (${RTP_STAGE_METADATA[nextStage].rosterSyncLabel}).`
      );
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Could not update RTP stage.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteCase = async (c: TeamInjuryCaseRecord) => {
    if (!activeTeam) return;
    if (isSampleDemoMode) {
      const nextList = effectiveCases.filter((item) => item.id !== c.id);
      applyLocalTeamMutation(nextList, c.membershipId, 'CLEARED');
      setStatusBanner(`Removed injury case for ${c.athleteName}.`);
      return;
    }
    setIsSaving(true);
    setErrorBanner(null);
    try {
      const resp = await deleteTeamInjuryCaseApi(activeTeam.brand.teamId, c.id);
      if (resp.teams && resp.teams.length > 0) {
        onTeamsUpdatedRef.current(resp.teams, activeTeam.brand.teamId);
      } else if (resp.team) {
        onTeamsUpdatedRef.current(
          myTeamsRef.current.map((t) => (t.brand.teamId === resp.team!.brand.teamId ? resp.team! : t)),
          resp.team.brand.teamId
        );
      }
      setStatusBanner(`Removed injury case for ${c.athleteName}.`);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to delete injury case.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      tabIndex={-1}
      data-testid="athletic-trainer-injury-hub"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 sm:p-5"
    >
      <div className="w-full max-w-5xl max-h-[92dvh] overflow-y-auto rounded-2xl liquid-glass bg-white dark:bg-ap-obsidian border border-ap-frame/25 dark:border-ap-edge p-4 sm:p-6 space-y-4 shadow-2xl text-ap-ink dark:text-ap-chalk">
        {/* Top Bar */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ap-frame/15 dark:border-ap-edge pb-3">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md font-mono text-2xs font-bold uppercase tracking-wider bg-ap-clay text-white">
                <HeartPulse className="w-3.5 h-3.5" />
                <span>Athletic Trainer Injury Hub</span>
              </span>
              {activeTeam && (
                <span className="px-2 py-0.5 rounded-md font-mono text-2xs font-bold ap-status-info">
                  {activeTeam.brand.shortName || activeTeam.brand.name}
                </span>
              )}
              <span
                data-testid="injury-hub-role-badge"
                className={`px-2 py-0.5 rounded-md font-mono text-2xs font-bold inline-flex items-center gap-1 ${
                  isAthleticTrainer ? 'ap-status-prime' : 'ap-card-inset'
                }`}
              >
                <Lock className="w-3 h-3" />
                <span>
                  {isAthleticTrainer
                    ? 'Athletic Trainer Clinical Access'
                    : 'Coach RTP View · Clinical Notes Masked'}
                </span>
              </span>
            </div>
            <h2 id={headingId} className="text-lg sm:text-xl font-extrabold tracking-tight">
              Return-to-Play Board &amp; 13-Region Pain Heatmap
            </h2>
            <p className="text-xs text-ap-muted dark:text-ap-muted-dark">
              Track Out / Modified / Limited / Cleared status, sync roster availability automatically, and surface 7d/30d overuse hot spots early.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              data-testid="injury-hub-export-clearance-btn"
              onClick={handleExportDailyClearance}
              className="ap-btn-secondary !min-h-[44px] sm:!min-h-[38px] px-3 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Export Clearance CSV</span>
            </button>
            <button
              type="button"
              data-testid="injury-hub-new-case-btn"
              onClick={() => openNewCaseForm()}
              className="ap-btn-primary !min-h-[44px] sm:!min-h-[38px] px-3.5 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Log Injury / RTP Case</span>
            </button>
            <button
              type="button"
              data-testid="injury-hub-close-btn"
              aria-label="Close Injury Hub"
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] sm:min-h-[38px] sm:min-w-[38px] rounded-xl ap-card-inset inline-flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Status & Error Banners */}
        {statusBanner && (
          <div
            role="status"
            data-testid="injury-hub-status-banner"
            className="rounded-xl px-3.5 py-2.5 text-xs font-semibold ap-status-prime flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{statusBanner}</span>
          </div>
        )}
        {errorBanner && (
          <div
            role="alert"
            className="rounded-xl px-3.5 py-2.5 text-xs font-semibold ap-status-strained flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorBanner}</span>
          </div>
        )}

        {/* KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="rounded-xl ap-card-inset px-3 py-2.5">
            <div className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
              Active RTP Cases
            </div>
            <div className="text-xl font-extrabold font-mono tabular-nums">
              {dashboard.activeCaseCount}
            </div>
          </div>
          <div className="rounded-xl ap-card-inset px-3 py-2.5">
            <div className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
              Out / Modified
            </div>
            <div className="text-xl font-extrabold font-mono tabular-nums text-ap-clay dark:text-ap-volt">
              {dashboard.outCount + dashboard.modifiedCount}
            </div>
          </div>
          <div className="rounded-xl ap-card-inset px-3 py-2.5">
            <div className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
              7d Pain Flags
            </div>
            <div className="text-xl font-extrabold font-mono tabular-nums">
              {dashboard.totalPainFlags7d}
            </div>
          </div>
          <div className="rounded-xl ap-card-inset px-3 py-2.5">
            <div className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
              SafeSport Watch
            </div>
            <div className="text-xl font-extrabold font-mono tabular-nums">
              {dashboard.safeSportFlags.length}
            </div>
          </div>
        </div>

        {/* Create / Edit Case Drawer */}
        {showCaseForm && (
          <form
            onSubmit={(e) => void handleSaveCase(e)}
            data-testid="injury-case-form"
            className="rounded-2xl border border-ap-clay/35 dark:border-ap-volt/35 bg-ap-chalk/70 dark:bg-ap-carbon p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold">
                {editingCaseId ? 'Update Return-to-Play Case' : 'Create Injury / RTP Case'}
              </h3>
              <button
                type="button"
                onClick={() => setShowCaseForm(false)}
                className="min-h-[44px] sm:min-h-[36px] px-2.5 rounded-lg text-xs font-mono text-ap-muted dark:text-ap-muted-dark hover:underline cursor-pointer"
              >
                Cancel
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <div>
                <label
                  htmlFor={`${formId}-athlete`}
                  className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark mb-1"
                >
                  Athlete
                </label>
                <select
                  id={`${formId}-athlete`}
                  data-testid="injury-form-athlete-select"
                  value={formMembershipId}
                  onChange={(e) => setFormMembershipId(e.target.value)}
                  disabled={Boolean(editingCaseId)}
                  className="w-full min-h-[44px] rounded-xl border border-ap-frame/25 dark:border-ap-edge bg-white dark:bg-ap-obsidian px-2.5 text-xs font-semibold"
                >
                  {rosterAthletes.length === 0 ? (
                    <option value="">No roster athletes yet</option>
                  ) : (
                    rosterAthletes.map((m) => (
                      <option key={m.membershipId} value={m.membershipId}>
                        {m.invitedName} ({m.squadGroup})
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label
                  htmlFor={`${formId}-region`}
                  className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark mb-1"
                >
                  Body Region (13-Region)
                </label>
                <select
                  id={`${formId}-region`}
                  data-testid="injury-form-region-select"
                  value={formBodyRegion}
                  onChange={(e) => {
                    const next = e.target.value as InjuryBodyRegion;
                    setFormBodyRegion(next);
                    if (!editingCaseId) {
                      setFormRestrictions(INJURY_REGION_METADATA[next].defaultRestrictionHint);
                    }
                  }}
                  className="w-full min-h-[44px] rounded-xl border border-ap-frame/25 dark:border-ap-edge bg-white dark:bg-ap-obsidian px-2.5 text-xs font-semibold"
                >
                  {ALL_INJURY_BODY_REGIONS.map((reg) => (
                    <option key={reg} value={reg}>
                      {INJURY_REGION_METADATA[reg].label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor={`${formId}-stage`}
                  className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark mb-1"
                >
                  RTP Stage
                </label>
                <select
                  id={`${formId}-stage`}
                  data-testid="injury-form-stage-select"
                  value={formRtpStage}
                  onChange={(e) => setFormRtpStage(e.target.value as TeamInjuryRtpStage)}
                  className="w-full min-h-[44px] rounded-xl border border-ap-frame/25 dark:border-ap-edge bg-white dark:bg-ap-obsidian px-2.5 text-xs font-semibold"
                >
                  {RTP_STAGE_ORDER.map((stage) => (
                    <option key={stage} value={stage}>
                      {RTP_STAGE_METADATA[stage].label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor={`${formId}-severity`}
                  className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark mb-1"
                >
                  Severity &amp; Target Return
                </label>
                <div className="flex gap-1.5">
                  <select
                    id={`${formId}-severity`}
                    value={formSeverity}
                    onChange={(e) =>
                      setFormSeverity(e.target.value as TeamInjuryCaseRecord['severity'])
                    }
                    className="w-1/2 min-h-[44px] rounded-xl border border-ap-frame/25 dark:border-ap-edge bg-white dark:bg-ap-obsidian px-2 text-xs font-semibold"
                  >
                    {SEVERITY_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    aria-label="Target return date"
                    value={formTargetReturnDate}
                    onChange={(e) => setFormTargetReturnDate(e.target.value)}
                    className="w-1/2 min-h-[44px] rounded-xl border border-ap-frame/25 dark:border-ap-edge bg-white dark:bg-ap-obsidian px-2 text-xs font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label
                  htmlFor={`${formId}-restrictions`}
                  className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark mb-1"
                >
                  Practice Restrictions (Coach-Visible)
                </label>
                <input
                  id={`${formId}-restrictions`}
                  data-testid="injury-form-restrictions-input"
                  type="text"
                  value={formRestrictions}
                  onChange={(e) => setFormRestrictions(e.target.value)}
                  placeholder="e.g. No spikes or hard track turns; turf only."
                  className="w-full min-h-[44px] rounded-xl border border-ap-frame/25 dark:border-ap-edge bg-white dark:bg-ap-obsidian px-3 text-xs"
                />
              </div>

              <div>
                <label
                  htmlFor={`${formId}-guidance`}
                  className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark mb-1"
                >
                  Coach Workout Guidance (Coach-Visible)
                </label>
                <input
                  id={`${formId}-guidance`}
                  data-testid="injury-form-guidance-input"
                  type="text"
                  value={formCoachGuidance}
                  onChange={(e) => setFormCoachGuidance(e.target.value)}
                  placeholder="e.g. Swap threshold intervals for 35m pool run."
                  className="w-full min-h-[44px] rounded-xl border border-ap-frame/25 dark:border-ap-edge bg-white dark:bg-ap-obsidian px-3 text-xs"
                />
              </div>
            </div>

            {isAthleticTrainer ? (
              <div>
                <label
                  htmlFor={`${formId}-clinical`}
                  className="block text-2xs font-mono uppercase text-emerald-700 dark:text-emerald-300 mb-1"
                >
                  Private Clinical Notes (Athletic Trainer Only — Never Shown to Coaches)
                </label>
                <textarea
                  id={`${formId}-clinical`}
                  data-testid="injury-form-clinical-notes"
                  rows={2}
                  value={formClinicalNotes}
                  onChange={(e) => setFormClinicalNotes(e.target.value)}
                  placeholder="Clinical evaluation, palpation findings, modality notes..."
                  className="w-full rounded-xl border border-emerald-500/40 bg-white dark:bg-ap-obsidian p-2.5 text-xs"
                />
              </div>
            ) : (
              <div className="rounded-xl ap-card-inset px-3 py-2 text-2xs text-ap-muted dark:text-ap-muted-dark flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Private clinical evaluation notes are restricted to the team&apos;s Athletic Trainer role. Coaches manage RTP stages, restrictions, and practice modifications only.
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="submit"
                data-testid="injury-form-submit-btn"
                disabled={isSaving || !formMembershipId}
                className="ap-btn-primary !min-h-[44px] px-4 py-2 text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {isSaving
                  ? 'Saving…'
                  : editingCaseId
                    ? 'Save Case Updates'
                    : 'Create RTP Case'}
              </button>
            </div>
          </form>
        )}

        {/* 13-Region Pain Trend Heatmap */}
        <section
          data-testid="injury-pain-heatmap"
          className="rounded-2xl ap-card p-3.5 sm:p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold">13-Region Pain Trend Heatmap</h3>
              <p className="text-2xs text-ap-muted dark:text-ap-muted-dark">
                Combines athlete check-in pain flags ({heatmapWindow}d) + open injury cases. Click any region to filter or log.
              </p>
            </div>
            <div
              role="group"
              aria-label="Pain heatmap window"
              className="inline-flex items-center gap-1 p-0.5 rounded-lg liquid-capsule-track text-2xs font-mono font-bold"
            >
              <button
                type="button"
                data-testid="heatmap-window-7d"
                aria-pressed={heatmapWindow === 7}
                onClick={() => setHeatmapWindow(7)}
                className={`min-h-[44px] sm:min-h-[36px] px-2.5 rounded-md cursor-pointer ${
                  heatmapWindow === 7
                    ? 'ap-nav-volt-active'
                    : 'text-ap-muted dark:text-ap-muted-dark'
                }`}
              >
                7d ({dashboard.totalPainFlags7d})
              </button>
              <button
                type="button"
                data-testid="heatmap-window-30d"
                aria-pressed={heatmapWindow === 30}
                onClick={() => setHeatmapWindow(30)}
                className={`min-h-[44px] sm:min-h-[36px] px-2.5 rounded-md cursor-pointer ${
                  heatmapWindow === 30
                    ? 'ap-nav-volt-active'
                    : 'text-ap-muted dark:text-ap-muted-dark'
                }`}
              >
                30d ({dashboard.totalPainFlags30d})
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2">
            {dashboard.regions.map((reg) => {
              const isSelected = selectedRegionFilter === reg.region;
              return (
                <div
                  key={reg.region}
                  data-testid={`heatmap-region-${reg.region}`}
                  className={`rounded-xl p-2.5 space-y-1.5 border border-ap-frame/15 dark:border-ap-edge transition-colors ${heatTileClass(
                    reg.heatLevel,
                    isSelected
                  )}`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedRegionFilter((prev) =>
                          prev === reg.region ? 'ALL' : reg.region
                        )
                      }
                      className="text-left text-xs font-bold hover:underline cursor-pointer truncate"
                    >
                      {reg.shortLabel}
                    </button>
                    <span className="font-mono text-2xs font-extrabold tabular-nums">
                      {reg.totalSignalCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-1 text-2xs font-mono opacity-85">
                    <span>
                      {reg.activeCaseCount} case · {reg.checkInCount} flag
                    </span>
                    <button
                      type="button"
                      aria-label={`Log ${reg.label} case`}
                      onClick={() => openNewCaseForm({ bodyRegion: reg.region })}
                      className="min-h-[44px] min-w-[44px] sm:min-h-[28px] sm:min-w-[28px] px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 font-bold inline-flex items-center justify-center cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Active RTP Board + Triage/SafeSport Rail */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* RTP Board */}
          <section
            data-testid="injury-rtp-board"
            className="lg:col-span-8 rounded-2xl ap-card p-3.5 sm:p-4 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold">
                Active Return-to-Play Board ({visibleCases.length})
              </h3>
              <div className="flex flex-wrap items-center gap-1">
                {(['ALL', ...RTP_STAGE_ORDER] as const).map((stage) => {
                  const active = stageFilter === stage;
                  return (
                    <button
                      key={stage}
                      type="button"
                      data-testid={`rtp-filter-${stage}`}
                      onClick={() => setStageFilter(stage)}
                      className={`min-h-[44px] sm:min-h-[36px] px-2.5 rounded-lg text-2xs font-mono font-bold cursor-pointer ${
                        active
                          ? 'bg-ap-cobalt text-white dark:bg-ap-volt dark:text-ap-obsidian'
                          : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark'
                      }`}
                    >
                      {stage}
                    </button>
                  );
                })}
                {selectedRegionFilter !== 'ALL' && (
                  <button
                    type="button"
                    onClick={() => setSelectedRegionFilter('ALL')}
                    className="min-h-[44px] sm:min-h-[36px] px-2 rounded-lg ap-status-info text-2xs font-mono font-bold cursor-pointer"
                  >
                    Region: {selectedRegionFilter} ×
                  </button>
                )}
              </div>
            </div>

            {isLoadingCases && visibleCases.length === 0 ? (
              <div className="py-6 text-center text-xs font-mono text-ap-muted dark:text-ap-muted-dark">
                Loading injury board…
              </div>
            ) : visibleCases.length === 0 ? (
              <div className="rounded-xl ap-card-inset p-4 text-xs text-ap-muted dark:text-ap-muted-dark">
                No injury cases match this filter. Use &ldquo;Log Injury / RTP Case&rdquo; or click any 7-day soreness flag to start tracking RTP progression.
              </div>
            ) : (
              <div className="space-y-2.5">
                {visibleCases.map((c) => (
                  <article
                    key={c.id}
                    data-testid={`injury-case-card-${c.id}`}
                    className="rounded-xl border border-ap-frame/20 dark:border-ap-edge bg-ap-chalk/60 dark:bg-ap-carbon p-3.5 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-extrabold">{c.athleteName}</span>
                          <span
                            className={`px-2 py-0.5 rounded font-mono text-2xs font-bold ${rtpStageStatusClass(
                              c.rtpStage
                            )}`}
                          >
                            {c.rtpStage}
                          </span>
                          <span className="px-2 py-0.5 rounded font-mono text-2xs font-bold ap-card-inset">
                            {INJURY_REGION_METADATA[c.bodyRegion]?.label || c.bodyRegion}
                          </span>
                          <span className="px-1.5 py-0.5 rounded font-mono text-2xs text-ap-muted dark:text-ap-muted-dark border border-ap-frame/20 dark:border-ap-edge">
                            {c.severity}
                          </span>
                        </div>
                        <div className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                          {RTP_STAGE_METADATA[c.rtpStage].rosterSyncLabel}
                          {c.targetReturnDate ? ` · Target Return ${c.targetReturnDate}` : ''}
                          {c.updatedByName ? ` · Updated by ${c.updatedByName}` : ''}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => openEditCaseForm(c)}
                          className="min-h-[44px] sm:min-h-[36px] px-2.5 rounded-lg ap-btn-secondary text-2xs font-semibold cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete injury case for ${c.athleteName}`}
                          onClick={() => void handleDeleteCase(c)}
                          className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] rounded-lg ap-card-inset text-rose-600 dark:text-rose-400 inline-flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-white dark:bg-ap-obsidian border border-ap-frame/15 dark:border-ap-edge px-2.5 py-2">
                        <div className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
                          Restrictions
                        </div>
                        <p className="mt-0.5 leading-snug">{c.restrictions || 'None specified'}</p>
                      </div>
                      <div className="rounded-lg bg-white dark:bg-ap-obsidian border border-ap-frame/15 dark:border-ap-edge px-2.5 py-2">
                        <div className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
                          Coach Practice Guidance
                        </div>
                        <p className="mt-0.5 leading-snug">{c.coachGuidance || 'Follow AT guidance'}</p>
                      </div>
                    </div>

                    {isAthleticTrainer && c.privateClinicalNotes && (
                      <div
                        data-testid={`injury-clinical-notes-${c.id}`}
                        className="rounded-lg px-2.5 py-2 text-xs ap-status-prime space-y-0.5"
                      >
                        <div className="text-2xs font-mono font-bold uppercase flex items-center gap-1">
                          <Lock className="w-3 h-3" />
                          <span>Private Clinical Notes (AT Only)</span>
                        </div>
                        <p className="leading-snug">{c.privateClinicalNotes}</p>
                      </div>
                    )}

                    {/* Quick 1-Tap RTP Progression */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-ap-frame/15 dark:border-ap-edge">
                      <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                        Move RTP Stage:
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {RTP_STAGE_ORDER.map((stage) => {
                          const active = c.rtpStage === stage;
                          return (
                            <button
                              key={stage}
                              type="button"
                              disabled={isSaving || active}
                              data-testid={`rtp-move-${c.id}-${stage}`}
                              onClick={() => void handleQuickStageUpdate(c, stage)}
                              className={`min-h-[44px] sm:min-h-[36px] px-2.5 rounded-lg text-2xs font-mono font-bold cursor-pointer disabled:cursor-default ${
                                active
                                  ? 'bg-ap-obsidian text-white dark:bg-ap-volt dark:text-ap-obsidian'
                                  : 'ap-card-inset text-ap-ink dark:text-ap-chalk hover:border-ap-clay'
                              }`}
                            >
                              {stage}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Triage Queue & SafeSport Watch Context */}
          <aside className="lg:col-span-4 space-y-3">
            <section
              data-testid="injury-triage-queue"
              className="rounded-2xl ap-card p-3.5 space-y-2.5"
            >
              <div className="flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-ap-clay dark:text-ap-volt" />
                <h3 className="text-sm font-bold">7d Check-In Pain Queue</h3>
              </div>
              {dashboard.triageQueue.length === 0 ? (
                <p className="text-xs text-ap-muted dark:text-ap-muted-dark">
                  All recent post-practice pain check-ins are already triaged.
                </p>
              ) : (
                <div className="space-y-2">
                  {dashboard.triageQueue.slice(0, 6).map((item) => (
                    <div
                      key={item.checkInId}
                      className="rounded-xl ap-card-inset p-2.5 space-y-1.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold truncate">{item.athleteName}</span>
                        <span className="px-1.5 py-0.5 rounded ap-status-caution font-mono text-2xs font-bold">
                          {item.bodyRegion}
                        </span>
                      </div>
                      <div className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                        {item.date} · RPE {item.rpe}/10
                        {item.sorenessNote ? ` · “${item.sorenessNote}”` : ''}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          openNewCaseForm({
                            membershipId: item.membershipId,
                            bodyRegion: item.bodyRegion,
                            restrictions: item.sorenessNote
                              ? `Triaged from check-in: ${item.sorenessNote}`
                              : undefined,
                          })
                        }
                        className="w-full min-h-[44px] sm:min-h-[36px] rounded-lg ap-btn-secondary text-2xs font-bold cursor-pointer"
                      >
                        Open RTP Case →
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section
              data-testid="injury-safesport-context"
              className="rounded-2xl ap-card p-3.5 space-y-2.5"
            >
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-ap-cobalt dark:text-ap-volt" />
                <h3 className="text-sm font-bold">SafeSport Pattern Watch</h3>
              </div>
              <p className="text-2xs text-ap-muted dark:text-ap-muted-dark">
                Longitudinal cardiac drift, HR recovery &amp; growth-plate traction flags (zero weight/BMI fields).
              </p>
              {dashboard.safeSportFlags.length === 0 ? (
                <div className="rounded-xl ap-status-prime px-3 py-2 text-2xs font-semibold">
                  All roster athletes clear on longitudinal SafeSport pattern watch.
                </div>
              ) : (
                <div className="space-y-2">
                  {dashboard.safeSportFlags.map((flag) => (
                    <div
                      key={flag.membershipId}
                      className={`rounded-xl px-3 py-2 text-xs space-y-0.5 ${
                        flag.trafficLight === 'RED_MEDICAL_REVIEW'
                          ? 'ap-status-strained'
                          : 'ap-status-caution'
                      }`}
                    >
                      <div className="font-bold flex items-center justify-between gap-2">
                        <span>{flag.athleteName}</span>
                        <span className="font-mono text-2xs">
                          {flag.trafficLight === 'RED_MEDICAL_REVIEW' ? 'MEDICAL REVIEW' : 'WATCH'}
                        </span>
                      </div>
                      <div className="text-2xs">{flag.coachSafeSummaryLabel}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default AthleticTrainerInjuryHub;
