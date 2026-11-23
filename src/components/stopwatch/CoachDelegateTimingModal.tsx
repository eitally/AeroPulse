import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  DelegatedSplitSubmissionRecord,
  DelegatedTimingSessionRecord,
  DelegatedTimingStation,
  TeamSummaryWithRole,
} from '../../types';
import { useModalDialog } from '../../hooks/useModalDialog';
import { getLocalDateIso } from '../../physiology/stravaLoadCalibration';
import { formatFatTime, OFFICIAL_RACE_EVENTS } from '../../utils/officialRaceSynthesizer';
import { generateQrCodeSvgMarkup } from '../../utils/qrCodeSvg';
import {
  applyLocalDemoSubmissionReview,
  buildLocalDemoTimingSession,
  createTimingSessionApi,
  decodeDelegatedSplitHandoffPayload,
  isLocalDemoTeam,
  reviewDelegatedSubmissionApi,
  revokeTimingSessionApi,
  submitDelegatedSplitsApi,
} from '../../utils/timingDelegationApi';
import {
  Check,
  CheckCircle2,
  Copy,
  Key,
  Link2,
  Plus,
  Trash2,
  UserCheck,
  X,
} from '../icons/PhosphorIcons';

export interface CoachDelegateTimingPreset {
  meetTitle?: string;
  meetDate?: string;
  eventCode?: string;
  heatLabel?: string;
  runners?: Array<{
    membershipId?: string;
    athleteName: string;
    hipOrLane?: string;
  }>;
}

export interface CoachDelegateTimingModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTeam: TeamSummaryWithRole | null;
  onTeamsUpdated?: (teams: TeamSummaryWithRole[], preferredActiveId?: string | null) => void;
  isSampleDemoMode?: boolean;
  initialPreset?: CoachDelegateTimingPreset | null;
  initialTab?: 'CREATE' | 'REVIEW';
}

const DELEGATABLE_EVENTS = [
  ...OFFICIAL_RACE_EVENTS.filter((e) =>
    [
      '60m',
      '100m',
      '200m',
      '400m',
      '800m',
      '1500m',
      '1600m',
      '1 Mile',
      '3000m',
      '3200m',
      '5000m',
      'XC 5K',
    ].includes(e.label)
  ).map((e) => ({
    code: e.label,
    splitMeters: e.defaultSplitMeters,
    lapCount: e.defaultLapCount,
  })),
  { code: '4x100m', splitMeters: 100 as const, lapCount: 4 },
  { code: '4x400m', splitMeters: 400 as const, lapCount: 4 },
  { code: '4x800m', splitMeters: 400 as const, lapCount: 4 },
  { code: 'DMR', splitMeters: 400 as const, lapCount: 4 },
];

const STATION_CHOICES: Array<{ value: DelegatedTimingStation; label: string }> = [
  { value: 'START_FINISH', label: 'Start/Finish' },
  { value: '200M_MARK', label: '200m Mark' },
  { value: '100M_MARK', label: '100m Mark' },
  { value: 'RELAY_ZONE', label: 'Relay Zone' },
];

function stationDisplayLabel(station: DelegatedTimingStation): string {
  return STATION_CHOICES.find((s) => s.value === station)?.label || station;
}

export const CoachDelegateTimingModal: React.FC<CoachDelegateTimingModalProps> = ({
  isOpen,
  onClose,
  activeTeam,
  onTeamsUpdated,
  isSampleDemoMode = false,
  initialPreset = null,
  initialTab = 'CREATE',
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  useModalDialog({ isOpen, onClose, dialogRef });

  const [activeModalTab, setActiveModalTab] = useState<'CREATE' | 'REVIEW'>(initialTab);
  const [meetTitle, setMeetTitle] = useState<string>(
    initialPreset?.meetTitle || activeTeam?.meetDayPackets?.[0]?.meetTitle || 'Track Meet'
  );
  const [meetDate, setMeetDate] = useState<string>(
    initialPreset?.meetDate || activeTeam?.meetDayPackets?.[0]?.meetDate || getLocalDateIso()
  );
  const [eventCode, setEventCode] = useState<string>(initialPreset?.eventCode || '1600m');
  const [heatLabel, setHeatLabel] = useState<string>(initialPreset?.heatLabel || 'Heat 1');
  const [stationType, setStationType] = useState<DelegatedTimingStation>('START_FINISH');
  const [delegateMode, setDelegateMode] = useState<'QR_LINK' | 'TEAMMATE'>('QR_LINK');
  const [assignedMembershipId, setAssignedMembershipId] = useState<string>('');
  const [pin, setPin] = useState<string>('');
  const [selectedRunnerIds, setSelectedRunnerIds] = useState<string[]>([]);
  const [hipByRunnerId, setHipByRunnerId] = useState<Record<string, string>>({});
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [copiedPassCode, setCopiedPassCode] = useState<string | null>(null);
  const [offlineCodeInput, setOfflineCodeInput] = useState<string>('');
  const [isReviewingId, setIsReviewingId] = useState<string | null>(null);

  const activeAthletes = useMemo(
    () =>
      (activeTeam?.memberships || []).filter(
        (m) => m.role === 'ATHLETE' && m.status !== 'REVOKED' && m.status !== 'ALUMNI'
      ),
    [activeTeam?.memberships]
  );

  useEffect(() => {
    if (!isOpen) return;
    setActiveModalTab(initialTab);
    setActionError(null);
    setActionSuccess(null);
    if (initialPreset) {
      if (initialPreset.meetTitle) setMeetTitle(initialPreset.meetTitle);
      if (initialPreset.meetDate) setMeetDate(initialPreset.meetDate);
      if (initialPreset.eventCode) setEventCode(initialPreset.eventCode);
      if (initialPreset.heatLabel) setHeatLabel(initialPreset.heatLabel);
      if (initialPreset.runners && initialPreset.runners.length > 0) {
        const ids: string[] = [];
        const hips: Record<string, string> = {};
        for (const r of initialPreset.runners) {
          if (r.membershipId) {
            ids.push(r.membershipId);
            if (r.hipOrLane) hips[r.membershipId] = r.hipOrLane;
          }
        }
        if (ids.length > 0) {
          setSelectedRunnerIds(ids);
          setHipByRunnerId(hips);
        }
      }
    } else if (selectedRunnerIds.length === 0 && activeAthletes.length > 0) {
      setSelectedRunnerIds(activeAthletes.slice(0, 5).map((m) => m.membershipId));
    }
  }, [isOpen, initialTab, initialPreset, activeAthletes, selectedRunnerIds.length]);

  const pendingSubmissions = useMemo(
    () =>
      (activeTeam?.pendingTimingSubmissions || []).filter(
        (s) => s.reviewStatus === 'PENDING_COACH_APPROVAL'
      ),
    [activeTeam?.pendingTimingSubmissions]
  );

  const reviewedSubmissions = useMemo(
    () =>
      (activeTeam?.pendingTimingSubmissions || [])
        .filter((s) => s.reviewStatus !== 'PENDING_COACH_APPROVAL')
        .slice(0, 12),
    [activeTeam?.pendingTimingSubmissions]
  );

  const groupedPendingHeatBuckets = useMemo(() => {
    const groups = new Map<string, DelegatedSplitSubmissionRecord[]>();
    for (const sub of pendingSubmissions) {
      const key = `${sub.meetTitle}__${sub.eventLabel}__${sub.heatLabel || 'All Heats'}`;
      const list = groups.get(key) || [];
      list.push(sub);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).map(([key, items]) => ({
      key,
      meetTitle: items[0].meetTitle,
      eventLabel: items[0].eventLabel,
      heatLabel: items[0].heatLabel,
      items,
    }));
  }, [pendingSubmissions]);

  const activeSessions = useMemo(
    () =>
      (activeTeam?.delegatedTimingSessions || []).filter((s) => !s.revokedAt).slice(0, 12),
    [activeTeam?.delegatedTimingSessions]
  );

  const decodedOfflinePreview = useMemo(
    () => (offlineCodeInput.trim() ? decodeDelegatedSplitHandoffPayload(offlineCodeInput) : null),
    [offlineCodeInput]
  );

  if (!isOpen) return null;

  const isLocalOnly = isSampleDemoMode || isLocalDemoTeam(activeTeam);
  const originUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://meetready.app';

  const applyTeamUpdate = (nextTeam: TeamSummaryWithRole) => {
    onTeamsUpdated?.([nextTeam], nextTeam.brand.teamId);
  };

  const handleCreatePass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTeam || isCreating) return;
    setActionError(null);
    setActionSuccess(null);

    if (pin.trim() && !/^\d{4}$/.test(pin.trim())) {
      setActionError('Optional PIN must be exactly 4 digits.');
      return;
    }
    if (delegateMode === 'TEAMMATE' && !assignedMembershipId) {
      setActionError('Select a teammate to assign.');
      return;
    }

    const eventMeta =
      DELEGATABLE_EVENTS.find(
        (ev) => ev.code.toLowerCase() === eventCode.trim().toLowerCase()
      ) || DELEGATABLE_EVENTS[4];

    const selectedRunners = activeAthletes
      .filter((m) => selectedRunnerIds.includes(m.membershipId))
      .map((m, idx) => ({
        entryKey: `r_${idx + 1}`,
        membershipId: m.membershipId,
        displayName: m.invitedName,
        ...(hipByRunnerId[m.membershipId]?.trim()
          ? { hipOrLane: hipByRunnerId[m.membershipId].trim() }
          : {}),
      }));

    const presetWalkOns =
      (initialPreset?.runners || [])
        .filter((r) => !r.membershipId && r.athleteName.trim())
        .map((r, idx) => ({
          entryKey: `preset_wo_${idx + 1}`,
          displayName: r.athleteName.trim(),
          ...(r.hipOrLane ? { hipOrLane: r.hipOrLane } : {}),
          isWalkOn: true,
        })) || [];

    const runners = [...selectedRunners, ...presetWalkOns];
    const payload = {
      meetTitle: meetTitle.trim() || 'Track Meet',
      meetDate,
      eventCode: eventMeta.code,
      eventLabel: eventMeta.code,
      ...(heatLabel.trim() ? { heatLabel: heatLabel.trim() } : {}),
      stationType,
      stationLabel: stationDisplayLabel(stationType),
      splitPlanLabel: `${eventMeta.lapCount} × ${eventMeta.splitMeters}m`,
      targetSplitMeters: eventMeta.splitMeters,
      targetLapCount: eventMeta.lapCount,
      runners,
      ...(delegateMode === 'TEAMMATE' && assignedMembershipId ? { assignedMembershipId } : {}),
      ...(pin.trim() ? { pin: pin.trim() } : {}),
    };

    if (isLocalOnly) {
      const { session, updatedTeam } = buildLocalDemoTimingSession(activeTeam, payload);
      applyTeamUpdate(updatedTeam);
      setActionSuccess(
        `Created demo pass ${session.passCode} (${session.eventLabel} · ${session.stationLabel}).`
      );
      setPin('');
      return;
    }

    setIsCreating(true);
    try {
      const res = await createTimingSessionApi(activeTeam.brand.teamId, payload);
      if (res.teams && res.teams.length > 0) {
        onTeamsUpdated?.(res.teams, activeTeam.brand.teamId);
      } else if (res.team) {
        applyTeamUpdate(res.team);
      }
      setActionSuccess(
        `Created timing pass ${res.session.passCode} for ${res.session.eventLabel} (${res.session.stationLabel}).`
      );
      setPin('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to create timing pass.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevokeSession = async (session: DelegatedTimingSessionRecord) => {
    if (!activeTeam) return;
    setActionError(null);
    if (isLocalOnly) {
      const nextSessions = (activeTeam.delegatedTimingSessions || []).map((s) =>
        s.sessionId === session.sessionId ? { ...s, revokedAt: new Date().toISOString() } : s
      );
      applyTeamUpdate({ ...activeTeam, delegatedTimingSessions: nextSessions });
      return;
    }
    try {
      const res = await revokeTimingSessionApi(activeTeam.brand.teamId, session.sessionId);
      if (res.teams && res.teams.length > 0) {
        onTeamsUpdated?.(res.teams, activeTeam.brand.teamId);
      } else if (res.team) {
        applyTeamUpdate(res.team);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to revoke pass.');
    }
  };

  const handleReviewAction = async (
    submissionId: string,
    action: 'APPROVE' | 'ARCHIVE_BACKUP' | 'DISCARD'
  ) => {
    if (!activeTeam || isReviewingId) return;
    setActionError(null);
    setActionSuccess(null);
    if (isLocalOnly) {
      applyTeamUpdate(applyLocalDemoSubmissionReview(activeTeam, submissionId, action));
      setActionSuccess(
        action === 'APPROVE'
          ? 'Approved & attached delegated hand-timed splits to athlete profiles.'
          : action === 'ARCHIVE_BACKUP'
            ? 'Archived submission as backup.'
            : 'Discarded submission.'
      );
      return;
    }
    setIsReviewingId(submissionId);
    try {
      const res = await reviewDelegatedSubmissionApi(
        activeTeam.brand.teamId,
        submissionId,
        action
      );
      if (res.teams && res.teams.length > 0) {
        onTeamsUpdated?.(res.teams, activeTeam.brand.teamId);
      } else if (res.team) {
        applyTeamUpdate(res.team);
      }
      setActionSuccess(
        action === 'APPROVE'
          ? 'Approved & attached delegated splits non-destructively.'
          : action === 'ARCHIVE_BACKUP'
            ? 'Archived submission as backup.'
            : 'Discarded submission.'
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Review action failed.');
    } finally {
      setIsReviewingId(null);
    }
  };

  const handleImportOfflineCode = async () => {
    if (!activeTeam || !decodedOfflinePreview) return;
    setActionError(null);
    setActionSuccess(null);

    if (isLocalOnly) {
      const matchedSession = (activeTeam.delegatedTimingSessions || []).find(
        (s) => s.passCode.toUpperCase() === decodedOfflinePreview.passCode.toUpperCase()
      );
      const localSub: DelegatedSplitSubmissionRecord = {
        submissionId: `dsub_imp_${Date.now()}`,
        sessionId: matchedSession?.sessionId || 'demo_offline_import',
        teamId: activeTeam.brand.teamId,
        clientSubmissionId: decodedOfflinePreview.clientSubmissionId,
        meetTitle: decodedOfflinePreview.meetTitle || matchedSession?.meetTitle || 'Track Meet',
        meetDate: matchedSession?.meetDate || getLocalDateIso(),
        eventCode: decodedOfflinePreview.eventLabel || matchedSession?.eventCode || '1600m',
        eventLabel: decodedOfflinePreview.eventLabel || matchedSession?.eventLabel || '1600m',
        ...(decodedOfflinePreview.heatLabel
          ? { heatLabel: decodedOfflinePreview.heatLabel }
          : {}),
        stationType: decodedOfflinePreview.stationType,
        capturedByName: decodedOfflinePreview.capturedByName,
        submittedAt: decodedOfflinePreview.submittedAt,
        entries: decodedOfflinePreview.entries.map((e) => {
          const matchedRunner = matchedSession?.runners.find((r) => r.entryKey === e.entryKey);
          return {
            entryKey: e.entryKey,
            ...(matchedRunner?.membershipId ? { membershipId: matchedRunner.membershipId } : {}),
            athleteName: matchedRunner?.displayName || e.athleteName,
            ...(e.hipOrLane ? { hipOrLane: e.hipOrLane } : {}),
            totalSecs: e.totalSecs,
            lapSplitsSecs: e.lapSplitsSecs,
            rawLapTimestampsSecs: e.rawLapTimestampsSecs || e.lapSplitsSecs,
            ...(e.isWalkOn ? { isWalkOn: true } : {}),
          };
        }),
        reviewStatus: 'PENDING_COACH_APPROVAL',
      };
      applyTeamUpdate({
        ...activeTeam,
        pendingTimingSubmissions: [localSub, ...(activeTeam.pendingTimingSubmissions || [])],
      });
      setOfflineCodeInput('');
      setActionSuccess('Imported offline split handoff into Pending Review.');
      return;
    }

    try {
      const res = await submitDelegatedSplitsApi(decodedOfflinePreview.passCode, {
        clientSubmissionId: decodedOfflinePreview.clientSubmissionId,
        capturedByName: decodedOfflinePreview.capturedByName,
        entries: decodedOfflinePreview.entries.map((e) => ({
          entryKey: e.entryKey,
          athleteName: e.athleteName,
          ...(e.hipOrLane ? { hipOrLane: e.hipOrLane } : {}),
          totalSecs: e.totalSecs,
          lapSplitsSecs: e.lapSplitsSecs,
          rawLapTimestampsSecs: e.rawLapTimestampsSecs || e.lapSplitsSecs,
          ...(e.isWalkOn ? { isWalkOn: true } : {}),
        })),
      });
      if (res.teams && res.teams.length > 0) {
        onTeamsUpdated?.(res.teams, activeTeam.brand.teamId);
      } else if (res.team) {
        applyTeamUpdate(res.team);
      }
      setOfflineCodeInput('');
      setActionSuccess(
        res.deduplicated
          ? 'Offline handoff was already staged (deduplicated).'
          : 'Imported offline splits into Pending Review.'
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed importing offline code.');
    }
  };

  const handleCopyPassLink = async (passCodeVal: string) => {
    const url = `${originUrl}/time/${encodeURIComponent(passCodeVal)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedPassCode(passCodeVal);
      window.setTimeout(() => setCopiedPassCode(null), 2000);
    } catch {
      setCopiedPassCode(null);
    }
  };

  return (
    <div className="ap-modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        data-testid="coach-delegate-timing-modal"
        className="ap-modal-sheet ap-card max-w-3xl p-4 sm:p-6 space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-base sm:text-lg font-extrabold text-ap-ink dark:text-ap-chalk">
              Delegated Track Timing &amp; Splits Review
            </h2>
            <p className="text-xs text-ap-muted dark:text-ap-muted-dark">
              Share a scoped timing pass with an assistant, manager, or teammate — review splits
              before attaching to athlete logs.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close delegated timing modal"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-xl ap-card-inset inline-flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" weight="bold" />
          </button>
        </div>

        {/* Two Clean Modal Tabs */}
        <div role="tablist" className="grid grid-cols-2 gap-1.5 p-1 rounded-xl liquid-capsule-track">
          <button
            type="button"
            role="tab"
            aria-selected={activeModalTab === 'CREATE'}
            data-testid="delegate-tab-create"
            onClick={() => setActiveModalTab('CREATE')}
            className={`min-h-[44px] rounded-lg px-3 text-xs font-bold cursor-pointer ${
              activeModalTab === 'CREATE'
                ? 'liquid-capsule-active'
                : 'text-ap-muted dark:text-ap-muted-dark'
            }`}
          >
            Create Pass / Assign Teammate
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeModalTab === 'REVIEW'}
            data-testid="delegate-tab-review"
            onClick={() => setActiveModalTab('REVIEW')}
            className={`min-h-[44px] rounded-lg px-3 text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer ${
              activeModalTab === 'REVIEW'
                ? 'liquid-capsule-active'
                : 'text-ap-muted dark:text-ap-muted-dark'
            }`}
          >
            <span>Pending Splits Review ({pendingSubmissions.length})</span>
          </button>
        </div>

        {actionError && (
          <div role="alert" className="rounded-xl ap-status-strained px-3 py-2 text-xs font-semibold">
            {actionError}
          </div>
        )}
        {actionSuccess && (
          <div role="status" className="rounded-xl ap-status-prime px-3 py-2 text-xs font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" weight="bold" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {activeModalTab === 'CREATE' ? (
          <div className="space-y-4">
            <form onSubmit={(e) => void handleCreatePass(e)} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <label className="space-y-1">
                  <span className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
                    Meet Title
                  </span>
                  <input
                    type="text"
                    value={meetTitle}
                    onChange={(e) => setMeetTitle(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl ap-card-inset px-3 text-xs font-semibold"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
                    Meet Date
                  </span>
                  <input
                    type="date"
                    value={meetDate}
                    onChange={(e) => setMeetDate(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl ap-card-inset px-3 text-xs font-mono font-semibold"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <label className="space-y-1">
                  <span className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
                    Event
                  </span>
                  <select
                    aria-label="Delegated Event"
                    value={eventCode}
                    onChange={(e) => setEventCode(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl ap-card-inset px-3 text-xs font-semibold"
                  >
                    {DELEGATABLE_EVENTS.map((ev) => (
                      <option key={ev.code} value={ev.code}>
                        {ev.code} ({ev.lapCount} × {ev.splitMeters}m)
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
                    Heat / Section
                  </span>
                  <input
                    type="text"
                    value={heatLabel}
                    onChange={(e) => setHeatLabel(e.target.value)}
                    placeholder="e.g. Heat 1 · Varsity"
                    className="w-full min-h-[44px] rounded-xl ap-card-inset px-3 text-xs font-semibold"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
                    Timing Station
                  </span>
                  <select
                    aria-label="Timing Station"
                    value={stationType}
                    onChange={(e) => setStationType(e.target.value as DelegatedTimingStation)}
                    className="w-full min-h-[44px] rounded-xl ap-card-inset px-3 text-xs font-semibold"
                  >
                    {STATION_CHOICES.map((st) => (
                      <option key={st.value} value={st.value}>
                        {st.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Delegate Method */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDelegateMode('QR_LINK')}
                  className={`min-h-[44px] rounded-xl px-3 text-xs font-bold inline-flex items-center justify-center gap-1.5 border cursor-pointer ${
                    delegateMode === 'QR_LINK'
                      ? 'ap-status-info border-[#121413]/30 dark:border-ap-volt/50'
                      : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark border-transparent'
                  }`}
                >
                  <Link2 className="w-4 h-4" weight="bold" />
                  <span>Generate QR / Link Pass</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDelegateMode('TEAMMATE')}
                  className={`min-h-[44px] rounded-xl px-3 text-xs font-bold inline-flex items-center justify-center gap-1.5 border cursor-pointer ${
                    delegateMode === 'TEAMMATE'
                      ? 'ap-status-info border-[#121413]/30 dark:border-ap-volt/50'
                      : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark border-transparent'
                  }`}
                >
                  <UserCheck className="w-4 h-4" weight="bold" />
                  <span>Assign In-App Teammate</span>
                </button>
              </div>

              {delegateMode === 'TEAMMATE' ? (
                <label className="block space-y-1">
                  <span className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
                    Assign Roster Teammate
                  </span>
                  <select
                    aria-label="Assign Roster Teammate"
                    value={assignedMembershipId}
                    onChange={(e) => setAssignedMembershipId(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl ap-card-inset px-3 text-xs font-semibold"
                  >
                    <option value="">Select athlete / teammate timer…</option>
                    {activeAthletes.map((m) => (
                      <option key={m.membershipId} value={m.membershipId}>
                        {m.invitedName} ({m.squadGroup})
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="block space-y-1">
                  <span className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark inline-flex items-center gap-1">
                    <Key className="w-3.5 h-3.5" weight="bold" />
                    <span>Optional 4-Digit Pass PIN</span>
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="Leave blank for 1-scan QR entry, or enter 4 digits"
                    className="w-full min-h-[44px] rounded-xl ap-card-inset px-3 text-xs font-mono"
                  />
                </label>
              )}

              {/* Runners in this Heat */}
              <div className="space-y-1.5">
                <div className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
                  Runners in Pass ({selectedRunnerIds.length} selected)
                </div>
                <div className="max-h-44 overflow-y-auto rounded-xl ap-card-inset p-2 space-y-1.5">
                  {activeAthletes.length === 0 ? (
                    <p className="text-xs text-ap-muted dark:text-ap-muted-dark p-1">
                      Timer can add walk-on runners directly on the Pocket Timing Pad.
                    </p>
                  ) : (
                    activeAthletes.map((m) => {
                      const checked = selectedRunnerIds.includes(m.membershipId);
                      return (
                        <div key={m.membershipId} className="flex items-center justify-between gap-2">
                          <label className="min-h-[44px] flex-1 flex items-center gap-2 px-2 rounded-lg hover:bg-white/60 dark:hover:bg-white/5 cursor-pointer text-xs font-semibold">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setSelectedRunnerIds((prev) =>
                                  prev.includes(m.membershipId)
                                    ? prev.filter((id) => id !== m.membershipId)
                                    : [...prev, m.membershipId]
                                )
                              }
                            />
                            <span className="truncate">{m.invitedName}</span>
                          </label>
                          {checked && (
                            <input
                              type="text"
                              value={hipByRunnerId[m.membershipId] || ''}
                              onChange={(e) =>
                                setHipByRunnerId((prev) => ({
                                  ...prev,
                                  [m.membershipId]: e.target.value.slice(0, 8),
                                }))
                              }
                              placeholder="Hip/Ln"
                              aria-label={`Hip or lane for ${m.invitedName}`}
                              className="w-20 min-h-[40px] rounded-lg ap-card px-2 font-mono text-2xs"
                            />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={isCreating}
                data-testid="create-delegated-pass-btn"
                className="ap-btn-primary w-full min-h-[44px] cursor-pointer"
              >
                <Plus className="w-4 h-4" weight="bold" />
                <span>
                  {isCreating
                    ? 'Creating Pass…'
                    : delegateMode === 'TEAMMATE'
                      ? 'Assign Timing Pass to Teammate'
                      : 'Create Scoped Timing Pass & QR'}
                </span>
              </button>
            </form>

            {/* Active Passes with QR + Copy Link + Revoke */}
            {activeSessions.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-[#121413]/15 dark:border-white/15">
                <div className="text-2xs font-mono uppercase font-bold text-ap-muted dark:text-ap-muted-dark">
                  Active Timing Passes ({activeSessions.length})
                </div>
                <div className="space-y-2">
                  {activeSessions.map((sess) => {
                    const passUrl = `${originUrl}/time/${encodeURIComponent(sess.passCode)}`;
                    const qrSvg = generateQrCodeSvgMarkup(passUrl, '#080A09', 88);
                    return (
                      <div
                        key={sess.sessionId}
                        data-testid={`delegated-session-card-${sess.passCode}`}
                        className="rounded-xl ap-card-inset p-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="bg-white p-1.5 rounded-lg border border-[#121413]/15 shrink-0"
                            dangerouslySetInnerHTML={{ __html: qrSvg }}
                          />
                          <div className="min-w-0 space-y-0.5">
                            <div className="text-xs font-extrabold truncate">
                              {sess.eventLabel}
                              {sess.heatLabel ? ` · ${sess.heatLabel}` : ''} · {sess.stationLabel}
                            </div>
                            <div className="font-mono text-2xs text-ap-muted dark:text-ap-muted-dark">
                              Code: <span className="font-bold text-ap-ink dark:text-ap-chalk">{sess.passCode}</span>
                              {sess.pinRequired ? ' · PIN Protected' : ''}
                              {sess.assignedDelegateName ? ` · Assigned: ${sess.assignedDelegateName}` : ''}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 w-full sm:w-auto justify-end">
                          <button
                            type="button"
                            onClick={() => void handleCopyPassLink(sess.passCode)}
                            className="ap-btn-secondary min-h-[44px] px-3 text-xs cursor-pointer"
                          >
                            {copiedPassCode === sess.passCode ? (
                              <Check className="w-3.5 h-3.5" weight="bold" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" weight="bold" />
                            )}
                            <span>{copiedPassCode === sess.passCode ? 'Copied' : 'Copy Link'}</span>
                          </button>
                          <button
                            type="button"
                            data-testid={`revoke-pass-btn-${sess.passCode}`}
                            onClick={() => void handleRevokeSession(sess)}
                            className="ap-btn-secondary min-h-[44px] px-3 text-xs text-rose-700 dark:text-rose-300 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" weight="bold" />
                            <span>Revoke</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Import Offline Split Code */}
            <div className="rounded-xl ap-card-inset p-3 space-y-2">
              <div className="text-xs font-extrabold">Import Offline Split Code</div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={offlineCodeInput}
                  onChange={(e) => setOfflineCodeInput(e.target.value)}
                  placeholder="Paste MRDS1:... offline split handoff code…"
                  aria-label="Import Offline Split Code"
                  data-testid="import-offline-split-input"
                  className="flex-1 min-h-[44px] rounded-xl ap-card px-3 font-mono text-xs"
                />
                <button
                  type="button"
                  data-testid="import-offline-split-btn"
                  disabled={!decodedOfflinePreview}
                  onClick={() => void handleImportOfflineCode()}
                  className="ap-btn-primary min-h-[44px] px-4 text-xs cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  Import to Queue
                </button>
              </div>
              {decodedOfflinePreview && (
                <div className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                  Ready: {decodedOfflinePreview.entries.length} runner(s) from{' '}
                  {decodedOfflinePreview.capturedByName} ({stationDisplayLabel(decodedOfflinePreview.stationType)})
                </div>
              )}
            </div>

            {/* Side-by-Side Complementary / Duplicate Review Queue */}
            {groupedPendingHeatBuckets.length === 0 ? (
              <div className="rounded-xl ap-card-inset p-6 text-center text-xs text-ap-muted dark:text-ap-muted-dark">
                No pending delegated split submissions awaiting review.
              </div>
            ) : (
              <div className="space-y-3">
                {groupedPendingHeatBuckets.map((bucket) => (
                  <div key={bucket.key} className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-extrabold uppercase tracking-wider text-ap-ink dark:text-ap-chalk">
                        {bucket.meetTitle} · {bucket.eventLabel}
                        {bucket.heatLabel ? ` · ${bucket.heatLabel}` : ''}
                      </h3>
                      <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                        Approving attaches Hand-Timed captures non-destructively
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {bucket.items.map((sub) => (
                        <div
                          key={sub.submissionId}
                          data-testid={`pending-submission-card-${sub.submissionId}`}
                          className="rounded-xl ap-card-inset p-3 space-y-2.5 flex flex-col justify-between"
                        >
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="px-2 py-0.5 rounded ap-status-info font-mono text-2xs font-bold">
                                {stationDisplayLabel(sub.stationType)}
                              </span>
                              <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                                By {sub.capturedByName}
                              </span>
                            </div>

                            <div className="space-y-1">
                              {sub.entries.map((entry) => (
                                <div
                                  key={entry.entryKey}
                                  className="rounded-lg bg-white dark:bg-[#121413] px-2.5 py-1.5 flex items-center justify-between gap-2 text-xs"
                                >
                                  <div className="min-w-0">
                                    <div className="font-bold truncate">
                                      {entry.hipOrLane ? `${entry.hipOrLane} · ` : ''}
                                      {entry.athleteName}
                                    </div>
                                    <div className="font-mono text-2xs text-ap-muted dark:text-ap-muted-dark">
                                      {entry.lapSplitsSecs.map((s) => s.toFixed(2)).join(' · ')}
                                    </div>
                                  </div>
                                  <span className="font-mono font-extrabold tabular-nums shrink-0">
                                    {formatFatTime(entry.totalSecs)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            <button
                              type="button"
                              disabled={isReviewingId === sub.submissionId}
                              data-testid={`approve-submission-btn-${sub.submissionId}`}
                              onClick={() => void handleReviewAction(sub.submissionId, 'APPROVE')}
                              className="ap-btn-primary flex-1 min-h-[44px] px-3 text-xs cursor-pointer"
                            >
                              Approve &amp; Attach
                            </button>
                            <button
                              type="button"
                              disabled={isReviewingId === sub.submissionId}
                              onClick={() =>
                                void handleReviewAction(sub.submissionId, 'ARCHIVE_BACKUP')
                              }
                              className="ap-btn-secondary min-h-[44px] px-3 text-xs cursor-pointer"
                            >
                              Archive Backup
                            </button>
                            <button
                              type="button"
                              disabled={isReviewingId === sub.submissionId}
                              onClick={() => void handleReviewAction(sub.submissionId, 'DISCARD')}
                              className="ap-btn-secondary min-h-[44px] px-3 text-xs text-rose-700 dark:text-rose-300 cursor-pointer"
                            >
                              Discard
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {reviewedSubmissions.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-[#121413]/15 dark:border-white/15">
                <div className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
                  Recent Reviewed Captures
                </div>
                {reviewedSubmissions.map((sub) => (
                  <div
                    key={sub.submissionId}
                    className="rounded-lg ap-card-inset px-3 py-2 flex items-center justify-between gap-2 text-2xs font-mono"
                  >
                    <span className="truncate">
                      {sub.eventLabel} · {stationDisplayLabel(sub.stationType)} · By{' '}
                      {sub.capturedByName}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded font-bold ${
                        sub.reviewStatus === 'APPROVED'
                          ? 'ap-status-prime'
                          : sub.reviewStatus === 'BACKUP_ARCHIVED'
                            ? 'ap-status-info'
                            : 'ap-status-strained'
                      }`}
                    >
                      {sub.reviewStatus}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
