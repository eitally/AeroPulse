import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Lock,
  MessageSquare,
  Send,
  ShieldCheck,
} from '../icons/PhosphorIcons';
import type {
  CoachEventGroup,
  TeamAuditLogEntry,
  TeamMemberRole,
  TeamSummaryWithRole,
} from '../../types';
import {
  COACH_EVENT_GROUP_OPTIONS,
  buildFreeNativeSmsUri,
} from '../../physiology/teamOnboardingEngine';
import {
  buildThreshSessionHeaders,
  fetchTeamAuditLogApi,
  graduateClassApi,
  mergeRosterMembersApi,
  requestParentConsentLinkApi,
  transferHeadCoachApi,
  updateAssistantCoachEventGroupsApi,
  updateMemberRoleApi,
  updateMemberStatusApi,
  updateTeamMemberPhotoReleaseApi,
} from '../../utils/teamLifecycleApi';

function sanitizeCsvCell(raw: unknown): string {
  const text = String(raw ?? '').replace(/[\r\n]+/g, ' ').trim();
  const guarded = /^[=+\-@\t]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export interface TeamRosterAndAuditSectionProps {
  activeTeam: TeamSummaryWithRole;
  myTeams: TeamSummaryWithRole[];
  activeJoinUrl: string;
  originUrl: string;
  resendConfigured: boolean;
  isSampleDemoMode: boolean;
  isActiveTeamCoach: boolean;
  canManageGovernance: boolean;
  isDemoTeam: boolean;
  isSendingBulk: boolean;
  setIsSendingBulk: React.Dispatch<React.SetStateAction<boolean>>;
  copiedId: string | null;
  onCopyText: (key: string, value: string) => void;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string | null) => void;
  onBannerMessage: (msg: { tone: 'success' | 'info' | 'error'; text: string } | null) => void;
}

export const TeamRosterAndAuditSection: React.FC<TeamRosterAndAuditSectionProps> = ({
  activeTeam,
  myTeams,
  activeJoinUrl,
  originUrl,
  resendConfigured,
  isSampleDemoMode,
  isActiveTeamCoach,
  canManageGovernance,
  isDemoTeam,
  isSendingBulk,
  setIsSendingBulk,
  copiedId,
  onCopyText,
  onTeamsUpdated,
  onBannerMessage,
}) => {
  const [busyRosterMemberId, setBusyRosterMemberId] = useState<string | null>(null);
  const [isGraduatingClass, setIsGraduatingClass] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [auditEntries, setAuditEntries] = useState<TeamAuditLogEntry[]>([]);
  const [isLoadingAuditLog, setIsLoadingAuditLog] = useState(false);
  const [auditLogError, setAuditLogError] = useState<string | null>(null);
  const [copyingParentLinkId, setCopyingParentLinkId] = useState<string | null>(null);
  const [rosterSearchQuery, setRosterSearchQuery] = useState('');
  const [rosterEventFilter, setRosterEventFilter] = useState<string>('ALL');
  const [rosterAwaitingParentOnly, setRosterAwaitingParentOnly] = useState(false);

  useEffect(() => {
    setShowAuditLog(false);
    setAuditEntries([]);
    setAuditLogError(null);
  }, [activeTeam.brand.teamId]);

  const applyUpdatedTeamSummary = (updatedTeam: TeamSummaryWithRole) => {
    onTeamsUpdated(
      myTeams.map((t) =>
        t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
      ),
      updatedTeam.brand.teamId
    );
  };

  const handleCopyParentConsentLink = async (membershipId: string) => {
    if (!activeTeam) return;
    if (isDemoTeam) {
      onCopyText(
        `parent-${membershipId}`,
        `${originUrl}/api/teams/parent-consent?token=demo-${membershipId}`
      );
      onBannerMessage({ tone: 'info', text: 'Copied 1-click Parent Consent link.' });
      return;
    }
    setCopyingParentLinkId(membershipId);
    try {
      const data = await requestParentConsentLinkApi({
        teamId: activeTeam.brand.teamId,
        membershipId,
        originUrl,
      });
      if (data.consentUrl) {
        onCopyText(`parent-${membershipId}`, data.consentUrl);
      }
      if (data.team) {
        applyUpdatedTeamSummary(data.team);
      }
      onBannerMessage({
        tone: 'success',
        text:
          data.emailStatus === 'SENT_RESEND'
            ? 'Copied Parent Consent link & emailed guardian.'
            : 'Copied 1-click Parent Consent link — paste via text or email.',
      });
    } catch (err) {
      onBannerMessage({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Failed generating parent consent link.',
      });
    } finally {
      setCopyingParentLinkId(null);
    }
  };

  const runMemberMutation = async (
    membershipId: string,
    fn: () => Promise<{ team?: TeamSummaryWithRole; error?: string }>,
    successMsg?: string
  ) => {
    setBusyRosterMemberId(membershipId);
    onBannerMessage(null);
    try {
      const data = await fn();
      if (data.team) applyUpdatedTeamSummary(data.team);
      if (successMsg) onBannerMessage({ tone: 'success', text: successMsg });
    } catch (err) {
      onBannerMessage({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Roster update failed.',
      });
    } finally {
      setBusyRosterMemberId(null);
    }
  };

  const handleGraduateClass = async (graduationYear: number) => {
    if (!activeTeam) return;
    setIsGraduatingClass(true);
    onBannerMessage(null);
    try {
      const data = await graduateClassApi(activeTeam.brand.teamId, graduationYear, originUrl);
      if (data.team) applyUpdatedTeamSummary(data.team);
      onBannerMessage({
        tone: 'success',
        text: `Graduated Class of ${graduationYear} (${data.graduatedCount || 0} moved to Alumni).`,
      });
    } catch (err) {
      onBannerMessage({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Could not graduate class.',
      });
    } finally {
      setIsGraduatingClass(false);
    }
  };

  const handleResendPending = async (membershipId = 'ALL_PENDING') => {
    if (!activeTeam) return;
    setIsSendingBulk(true);
    try {
      const resp = await fetch(
        `/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}/invites/resend`,
        {
          method: 'POST',
          credentials: 'include',
          headers: buildThreshSessionHeaders(),
          body: JSON.stringify({ origin: originUrl, membershipId }),
        }
      );
      const data = await resp.json();
      if (resp.ok && data.team) {
        const updatedTeam = data.team as TeamSummaryWithRole;
        onTeamsUpdated(
          myTeams.map((t) =>
            t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
          ),
          updatedTeam.brand.teamId
        );
        onBannerMessage({
          tone: 'info',
          text:
            data.emailedCount > 0
              ? `Sent ${data.emailedCount} invite reminder email(s).`
              : 'Refreshed magic invite links — share via Copy Link, Email, or Text.',
        });
      }
    } finally {
      setIsSendingBulk(false);
    }
  };

  const handleToggleAuditLog = async () => {
    if (!activeTeam) return;
    if (showAuditLog) {
      setShowAuditLog(false);
      return;
    }
    setShowAuditLog(true);
    setAuditLogError(null);
    if (isDemoTeam) {
      setAuditEntries([
        {
          eventId: 'demo-audit-1',
          createdAt: activeTeam.brand.createdAt,
          teamId: activeTeam.brand.teamId,
          actorSid: activeTeam.myMembershipId,
          action: 'TEAM_CREATED',
          metadata: { orgType: activeTeam.brand.orgType, safeSportShield: true },
        },
        {
          eventId: 'demo-audit-2',
          createdAt: new Date().toISOString(),
          teamId: activeTeam.brand.teamId,
          actorSid: activeTeam.myMembershipId,
          action: 'GUARDIAN_SAFETY_ALERT_SENT',
          targetId: 'demo-mem-ath-02',
          metadata: { category: 'PAIN_FLAG', painLocation: 'SHIN', ccGuardian: true },
        },
      ]);
      return;
    }
    setIsLoadingAuditLog(true);
    try {
      const res = await fetchTeamAuditLogApi(activeTeam.brand.teamId, 100);
      setAuditEntries(res.entries || []);
    } catch (err) {
      setAuditLogError(err instanceof Error ? err.message : 'Could not load audit log.');
    } finally {
      setIsLoadingAuditLog(false);
    }
  };

  const awaitingParentCount = activeTeam.memberships.filter(
    (m) =>
      m.role === 'ATHLETE' &&
      m.isMinorU18 &&
      m.parentConsentStatus !== 'ACKNOWLEDGED' &&
      m.status !== 'REVOKED'
  ).length;
  const cleanSearch = rosterSearchQuery.trim().toLowerCase();
  const filteredMemberships = activeTeam.memberships.filter((m) => {
    if (
      rosterAwaitingParentOnly &&
      !(
        m.role === 'ATHLETE' &&
        m.isMinorU18 &&
        m.parentConsentStatus !== 'ACKNOWLEDGED' &&
        m.status !== 'REVOKED'
      )
    ) {
      return false;
    }
    if (rosterEventFilter !== 'ALL' && m.eventGroup !== rosterEventFilter) {
      return false;
    }
    if (cleanSearch) {
      const hay = `${m.invitedName} ${m.invitedEmail || ''} ${m.squadGroup}`.toLowerCase();
      if (!hay.includes(cleanSearch)) return false;
    }
    return true;
  });

  const gradYears = activeTeam.memberships
    .filter(
      (m) =>
        typeof m.graduationYear === 'number' &&
        m.status !== 'ALUMNI' &&
        m.status !== 'REVOKED'
    )
    .map((m) => m.graduationYear as number);
  const targetGradYear = gradYears.length > 0 ? Math.min(...gradYears) : null;

  const handleExportRosterCsv = () => {
    const header = [
      'Name',
      'Role',
      'SquadGroup',
      'EventGroup',
      'Status',
      'Email',
      'GradYear',
      'SeedMark',
      'ParentConsent',
      'Verdict',
      'CTL',
      'TSB',
    ].join(',');
    const rows = filteredMemberships.map((m) =>
      [
        sanitizeCsvCell(m.invitedName),
        sanitizeCsvCell(m.role),
        sanitizeCsvCell(m.squadGroup),
        sanitizeCsvCell(m.eventGroup || ''),
        sanitizeCsvCell(m.status),
        sanitizeCsvCell(m.invitedEmail || ''),
        sanitizeCsvCell(m.graduationYear ?? ''),
        sanitizeCsvCell(m.seedMarkOrFtp || ''),
        sanitizeCsvCell(m.isMinorU18 ? m.parentConsentStatus || 'PENDING' : 'NOT_REQUIRED'),
        sanitizeCsvCell(m.liveSnapshot?.verdictLabel || ''),
        sanitizeCsvCell(
          typeof m.liveSnapshot?.ctl === 'number' ? Math.round(m.liveSnapshot.ctl) : ''
        ),
        sanitizeCsvCell(
          typeof m.liveSnapshot?.tsb === 'number' ? Math.round(m.liveSnapshot.tsb) : ''
        ),
      ].join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeTeam.brand.slug || 'team'}-roster.csv`;
    document.body?.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore revoke failures
      }
    }, 1000);
  };

  return (
    <div className="rounded-2xl liquid-glass border border-stone-200/90 dark:border-white/10 overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">
            {activeTeam.brand.name} — Roster ({filteredMemberships.length}
            {filteredMemberships.length !== activeTeam.memberships.length
              ? ` / ${activeTeam.memberships.length}`
              : ''})
          </h4>
          {awaitingParentCount > 0 && (
            <button
              type="button"
              data-testid="roster-awaiting-parent-pill"
              onClick={() => setRosterAwaitingParentOnly((prev) => !prev)}
              className={`min-h-[44px] sm:min-h-[28px] px-2.5 py-0.5 rounded-full text-2xs font-mono font-bold cursor-pointer ${
                rosterAwaitingParentOnly ? 'ap-nav-volt-active' : 'ap-status-caution'
              }`}
            >
              {awaitingParentCount} awaiting parent
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isActiveTeamCoach && filteredMemberships.length > 0 && (
            <button
              type="button"
              data-testid="roster-export-csv-btn"
              onClick={handleExportRosterCsv}
              className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-xl ap-btn-secondary text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 ap-text-brand" />
              <span>Export Roster CSV</span>
            </button>
          )}
          {canManageGovernance && (
            <button
              type="button"
              data-testid="team-audit-log-btn"
              onClick={() => void handleToggleAuditLog()}
              className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-xl ap-btn-secondary text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5 ap-text-brand" />
              <span>{showAuditLog ? 'Hide Audit Log' : 'Compliance & Audit Log'}</span>
            </button>
          )}

          {activeTeam.myRole === 'HEAD_COACH' && targetGradYear !== null && (
            <button
              type="button"
              data-testid="team-graduate-class-btn"
              disabled={isGraduatingClass}
              onClick={() => void handleGraduateClass(targetGradYear)}
              className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-xl ap-btn-secondary text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              {isGraduatingClass
                ? 'Graduating…'
                : `Graduate Class of ${targetGradYear}`}
            </button>
          )}

          {isActiveTeamCoach &&
            activeTeam.memberships.some((m) => m.status !== 'ACTIVE') && (
              <button
                type="button"
                disabled={isSendingBulk}
                onClick={() => handleResendPending('ALL_PENDING')}
                className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-xl bg-ap-cobalt hover:bg-ap-clay-dark dark:bg-ap-volt dark:hover:bg-[#C8EF1E] text-white dark:text-ap-obsidian text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Nudge All Pending</span>
              </button>
            )}
        </div>
      </div>

      {showAuditLog && canManageGovernance && (
        <div
          data-testid="team-audit-log-panel"
          className="px-5 py-3 border-b border-stone-200 dark:border-slate-800 bg-stone-50/90 dark:bg-ap-carbon space-y-2 text-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 ap-text-brand" />
              <span>Immutable Governance &amp; Compliance Audit Log</span>
            </span>
            <span className="text-2xs font-mono text-slate-500">
              {auditEntries.length} events
            </span>
          </div>
          {isLoadingAuditLog && (
            <p className="text-2xs font-mono text-slate-500">Loading audit trail…</p>
          )}
          {auditLogError && (
            <p role="alert" className="text-2xs font-mono text-red-600 dark:text-red-400">
              {auditLogError}
            </p>
          )}
          {!isLoadingAuditLog && !auditLogError && auditEntries.length === 0 && (
            <p className="text-2xs font-mono text-slate-500">
              No governance events recorded for this team yet.
            </p>
          )}
          {auditEntries.length > 0 && (
            <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
              {auditEntries.map((ev) => (
                <div
                  key={ev.eventId}
                  className="rounded-lg border border-stone-200 dark:border-slate-800 bg-white dark:bg-ap-turf px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 font-mono text-2xs"
                >
                  <span className="font-bold text-ap-cobalt dark:text-ap-volt">
                    {ev.action}
                  </span>
                  <span className="text-slate-600 dark:text-slate-300 truncate max-w-[320px]">
                    {ev.targetId ? `Target: ${ev.targetId} · ` : ''}
                    {Object.keys(ev.metadata || {}).length > 0
                      ? JSON.stringify(ev.metadata)
                      : 'Recorded'}
                  </span>
                  <span className="text-slate-500">{ev.createdAt.slice(0, 19).replace('T', ' ')}Z</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="px-5 py-2.5 border-b border-stone-200/80 dark:border-slate-800 flex flex-wrap items-center gap-2 bg-stone-50/70 dark:bg-ap-carbon/60">
        <input
          type="search"
          aria-label="Search roster"
          value={rosterSearchQuery}
          onChange={(e) => setRosterSearchQuery(e.target.value)}
          placeholder="Search roster..."
          className="flex-1 min-w-[170px] min-h-[44px] sm:min-h-[38px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-3 text-xs text-slate-900 dark:text-slate-100"
        />
        <select
          aria-label="Filter roster by event group"
          value={rosterEventFilter}
          onChange={(e) => setRosterEventFilter(e.target.value)}
          className="min-h-[44px] sm:min-h-[38px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2.5 text-xs font-mono text-slate-800 dark:text-slate-100"
        >
          <option value="ALL">All Events</option>
          {COACH_EVENT_GROUP_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.shortLabel}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-pressed={rosterAwaitingParentOnly}
          onClick={() => setRosterAwaitingParentOnly((prev) => !prev)}
          className={`min-h-[44px] sm:min-h-[38px] px-3 rounded-xl text-xs font-mono font-semibold cursor-pointer ${
            rosterAwaitingParentOnly
              ? 'ap-nav-volt-active'
              : 'ap-card-inset text-slate-700 dark:text-slate-200'
          }`}
        >
          Awaiting Parent
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-xs border-collapse">
          <thead className="bg-stone-100 dark:bg-ap-carbon text-2xs font-mono uppercase text-slate-500">
            <tr>
              <th className="py-2.5 px-4">Member</th>
              <th className="py-2.5 px-3">Squad / Role</th>
              <th className="py-2.5 px-3">Funnel Status</th>
              <th className="py-2.5 px-3">7d Readiness / Seed</th>
              <th className="py-2.5 px-4 text-right">Invite &amp; Share Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200/70 dark:divide-slate-800">
            {filteredMemberships.map((m) => {
              const joinLink = m.magicJoinUrl || activeJoinUrl;
              const firstName = m.invitedName.split(/\s+/)[0];
              const isSelfRow = m.membershipId === activeTeam.myMembershipId;
              const isRowBusy = busyRosterMemberId === m.membershipId;
              const activeMergeTargets = activeTeam.memberships.filter(
                (other) =>
                  other.membershipId !== m.membershipId &&
                  other.status === 'ACTIVE' &&
                  other.role === 'ATHLETE'
              );
              const allowDirectSms =
                !m.isMinorU18 && activeTeam.brand.orgType !== 'HIGH_SCHOOL';
              const smsHref =
                allowDirectSms && m.invitedPhone
                  ? buildFreeNativeSmsUri(
                      m.invitedPhone,
                      activeTeam.brand,
                      joinLink,
                      firstName
                    )
                  : null;
              const mailtoHref = m.invitedEmail
                ? `mailto:${encodeURIComponent(m.invitedEmail)}?${
                    activeTeam.brand.enableParentGuardianCc &&
                    m.isMinorU18 &&
                    m.parentGuardianEmail
                      ? `cc=${encodeURIComponent(m.parentGuardianEmail)}&`
                      : ''
                  }subject=${encodeURIComponent(
                    `Join ${activeTeam.brand.name} on MeetReady`
                  )}&body=${encodeURIComponent(
                    `Hi ${firstName},\n\nTap your personalized link to join ${activeTeam.brand.name} (${m.squadGroup}) on MeetReady:\n${joinLink}\n\nTeam Join Code: ${activeTeam.brand.joinCode}`
                  )}`
                : null;

              return (
                <tr key={m.membershipId}>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900 dark:text-white flex flex-wrap items-center gap-1.5">
                      <span>{m.invitedName}</span>
                      {m.isMinorU18 && (
                        <span
                          className="px-1.5 py-0.5 rounded text-2xs font-mono ap-status-prime"
                          title="Safe-Sport Weight Shield Active"
                        >
                          Safe-Sport
                        </span>
                      )}
                      {m.role === 'ATHLETE' && m.isMinorU18 && (
                        <span
                          className={`px-1.5 py-0.5 rounded text-2xs font-mono ${
                            m.parentConsentStatus === 'ACKNOWLEDGED'
                              ? 'ap-status-prime'
                              : 'ap-status-caution'
                          }`}
                        >
                          {m.parentConsentStatus === 'ACKNOWLEDGED'
                            ? 'Parent Approved ✓'
                            : 'Awaiting Parent'}
                        </span>
                      )}
                    </div>
                    {m.invitedEmail && (
                      <div className="text-2xs font-mono text-slate-500">
                        {m.invitedEmail}
                        {m.parentGuardianEmail ? ` · CC: ${m.parentGuardianEmail}` : ''}
                      </div>
                    )}
                  </td>

                  <td className="py-3 px-3">
                    <div className="font-medium">{m.squadGroup}</div>
                    <div className="text-2xs font-mono uppercase text-slate-500">
                      {m.role.replace(/_/g, ' ')}
                    </div>
                    {canManageGovernance &&
                      !isSelfRow &&
                      m.status === 'ACTIVE' &&
                      m.role !== 'HEAD_COACH' &&
                      m.role !== 'PARENT_FOLLOWER' && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <select
                            aria-label={`Role for ${m.invitedName}`}
                            disabled={isRowBusy}
                            value={
                              m.role === 'ASSISTANT_COACH' ||
                              m.role === 'ORG_ADMIN' ||
                              m.role === 'ATHLETIC_TRAINER'
                                ? m.role
                                : 'ATHLETE'
                            }
                            onChange={(e) => {
                              const nextRole = e.target.value as Extract<
                                TeamMemberRole,
                                'ATHLETE' | 'ASSISTANT_COACH' | 'ORG_ADMIN' | 'ATHLETIC_TRAINER'
                              >;
                              if (isDemoTeam) {
                                applyUpdatedTeamSummary({
                                  ...activeTeam,
                                  memberships: activeTeam.memberships.map((mem) =>
                                    mem.membershipId === m.membershipId
                                      ? { ...mem, role: nextRole }
                                      : mem
                                  ),
                                });
                                return;
                              }
                              void runMemberMutation(m.membershipId, () =>
                                updateMemberRoleApi(
                                  activeTeam.brand.teamId,
                                  m.membershipId,
                                  nextRole,
                                  originUrl
                                )
                              );
                            }}
                            className="min-h-[44px] sm:min-h-[34px] rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2 py-0.5 text-2xs font-mono text-slate-800 dark:text-slate-100"
                          >
                            <option value="ATHLETE">Athlete</option>
                            <option value="ASSISTANT_COACH">Assistant Coach</option>
                            <option value="ORG_ADMIN">Org / Athletic Admin</option>
                            <option value="ATHLETIC_TRAINER">Athletic Trainer</option>
                          </select>
                          {m.role === 'ASSISTANT_COACH' && (
                            <button
                              type="button"
                              disabled={isRowBusy}
                              onClick={() => {
                                if (isDemoTeam) {
                                  applyUpdatedTeamSummary({
                                    ...activeTeam,
                                    memberships: activeTeam.memberships.map((mem) =>
                                      mem.membershipId === m.membershipId
                                        ? { ...mem, role: 'HEAD_COACH' }
                                        : mem
                                    ),
                                  });
                                  onBannerMessage({
                                    tone: 'success',
                                    text: `Promoted ${m.invitedName} to Co-Head Coach in demo mode.`,
                                  });
                                  return;
                                }
                                void runMemberMutation(
                                  m.membershipId,
                                  () =>
                                    transferHeadCoachApi(
                                      activeTeam.brand.teamId,
                                      m.membershipId,
                                      originUrl
                                    ),
                                  'Head Coach ownership transferred successfully.'
                                );
                              }}
                              className="min-h-[44px] sm:min-h-[34px] px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-300 text-2xs font-mono cursor-pointer disabled:opacity-50"
                            >
                              Make Head Coach
                            </button>
                          )}
                        </div>
                      )}
                    {isActiveTeamCoach && m.role === 'ASSISTANT_COACH' && (
                      <div className="mt-1.5 flex flex-wrap gap-1" role="group" aria-label={`Groups coached by ${m.invitedName}`}>
                        {COACH_EVENT_GROUP_OPTIONS.map((opt) => {
                          const active = (m.coachEventGroups || []).includes(opt.id);
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              disabled={isRowBusy}
                              aria-pressed={active}
                              onClick={() => {
                                const curr = m.coachEventGroups || [];
                                const next = active ? curr.filter((g) => g !== opt.id) : [...curr, opt.id];
                                if (isDemoTeam) {
                                  applyUpdatedTeamSummary({
                                    ...activeTeam,
                                    memberships: activeTeam.memberships.map((mem) =>
                                      mem.membershipId === m.membershipId
                                        ? {
                                            ...mem,
                                            coachEventGroups: next.length > 0 ? next : undefined,
                                          }
                                        : mem
                                    ),
                                  });
                                  onBannerMessage({
                                    tone: 'success',
                                    text: `Updated coached event groups for ${m.invitedName}.`,
                                  });
                                  return;
                                }
                                void runMemberMutation(
                                  m.membershipId,
                                  () =>
                                    updateAssistantCoachEventGroupsApi({
                                      teamId: activeTeam.brand.teamId,
                                      membershipId: m.membershipId,
                                      coachEventGroups: next,
                                    }),
                                  `Updated coached event groups for ${m.invitedName}.`
                                );
                              }}
                              className={`min-h-[44px] sm:min-h-[28px] px-2 py-0.5 rounded text-2xs font-mono cursor-pointer ${
                                active ? 'bg-ap-cobalt text-white dark:bg-ap-volt dark:text-ap-obsidian font-bold' : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark'
                              }`}
                            >
                              {opt.shortLabel}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {isActiveTeamCoach && m.role === 'ATHLETE' && (
                      <select
                        aria-label={`Event group for ${m.invitedName}`}
                        value={m.eventGroup || ''}
                        onChange={async (e) => {
                          const val = (e.target.value || null) as CoachEventGroup | null;
                          if (isDemoTeam) {
                            applyUpdatedTeamSummary({
                              ...activeTeam,
                              memberships: activeTeam.memberships.map((mem) =>
                                mem.membershipId === m.membershipId
                                  ? { ...mem, eventGroup: val ?? undefined }
                                  : mem
                              ),
                            });
                            return;
                          }
                          try {
                            const res = await fetch(
                              `/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}/members/${encodeURIComponent(m.membershipId)}/event-group`,
                              {
                                method: 'PATCH',
                                credentials: 'include',
                                headers: buildThreshSessionHeaders(),
                                body: JSON.stringify({ eventGroup: val, origin: originUrl }),
                              }
                            );
                            const payload = await res.json();
                            if (res.ok && payload.team) {
                              const updatedTeam = payload.team as TeamSummaryWithRole;
                              onTeamsUpdated(
                                myTeams.map((t) =>
                                  t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
                                ),
                                updatedTeam.brand.teamId
                              );
                            }
                          } catch {
                            // ignore offline event-group change error
                          }
                        }}
                        className="mt-1 min-h-[44px] sm:min-h-[34px] rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2 py-0.5 text-2xs font-mono text-slate-800 dark:text-slate-100"
                      >
                        <option value="">All Events</option>
                        {COACH_EVENT_GROUP_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.shortLabel}
                          </option>
                        ))}
                      </select>
                    )}
                    {m.role === 'ATHLETE' && (isActiveTeamCoach || isSelfRow) && (
                      <button
                        type="button"
                        disabled={isRowBusy}
                        data-testid={`roster-photo-optout-toggle-${m.membershipId}`}
                        aria-pressed={Boolean(m.photoReleaseOptOut)}
                        onClick={() => {
                          const nextOptOut = !m.photoReleaseOptOut;
                          if (isDemoTeam) {
                            applyUpdatedTeamSummary({
                              ...activeTeam,
                              memberships: activeTeam.memberships.map((mem) =>
                                mem.membershipId === m.membershipId
                                  ? { ...mem, photoReleaseOptOut: nextOptOut }
                                  : mem
                              ),
                            });
                            onBannerMessage({
                              tone: nextOptOut ? 'info' : 'success',
                              text: nextOptOut
                                ? `FERPA No Public Photos enabled for ${m.invitedName}.`
                                : `Photo release enabled for ${m.invitedName}.`,
                            });
                            return;
                          }
                          void runMemberMutation(
                            m.membershipId,
                            () =>
                              updateTeamMemberPhotoReleaseApi({
                                teamId: activeTeam.brand.teamId,
                                membershipId: m.membershipId,
                                photoReleaseOptOut: nextOptOut,
                              }),
                            nextOptOut
                              ? `FERPA No Public Photos enabled for ${m.invitedName}.`
                              : `Photo release enabled for ${m.invitedName}.`
                          );
                        }}
                        className={`mt-1 block min-h-[34px] px-2 py-0.5 rounded-lg text-2xs font-mono font-semibold cursor-pointer ${
                          m.photoReleaseOptOut
                            ? 'ap-status-caution border border-amber-500/40'
                            : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark'
                        }`}
                      >
                        {m.photoReleaseOptOut ? 'No Public Photos (FERPA)' : 'Photo Release OK'}
                      </button>
                    )}
                  </td>

                  <td className="py-3 px-3">
                    <span
                      className={`px-2 py-0.5 rounded text-2xs font-mono font-bold uppercase ${
                        m.status === 'ACTIVE'
                          ? 'ap-status-prime'
                          : m.status === 'OPENED' || m.status === 'ALUMNI'
                            ? 'ap-status-info'
                            : m.status === 'INJURED'
                              ? 'ap-status-strained'
                              : 'ap-status-caution'
                      }`}
                    >
                      {m.status === 'ACTIVE'
                        ? 'Joined'
                        : m.status === 'OPENED'
                          ? 'Link Opened'
                          : m.status === 'INJURED'
                            ? 'Injured'
                            : m.status === 'OFF_SEASON'
                              ? 'Off-Season'
                              : m.status === 'ALUMNI'
                                ? 'Alumni'
                                : 'Invited'}
                    </span>
                    {m.emailDeliveryStatus === 'SENT_RESEND' && (
                      <span className="ml-1.5 text-2xs font-mono text-emerald-600 dark:text-emerald-400">
                        · Emailed ✓
                      </span>
                    )}
                    {isActiveTeamCoach && !isSelfRow && (
                      <div className="mt-1">
                        <select
                          aria-label={`Status for ${m.invitedName}`}
                          disabled={isRowBusy}
                          value={
                            m.status === 'INVITED' || m.status === 'OPENED'
                              ? ''
                              : m.status
                          }
                          onChange={(e) => {
                            const nextStatus = e.target.value as
                              | 'ACTIVE'
                              | 'INJURED'
                              | 'OFF_SEASON'
                              | 'ALUMNI'
                              | 'REVOKED';
                            if (!nextStatus) return;
                            if (isDemoTeam) {
                              applyUpdatedTeamSummary({
                                ...activeTeam,
                                memberships: activeTeam.memberships.map((mem) =>
                                  mem.membershipId === m.membershipId
                                    ? { ...mem, status: nextStatus }
                                    : mem
                                ),
                              });
                              return;
                            }
                            void runMemberMutation(m.membershipId, () =>
                              updateMemberStatusApi(
                                activeTeam.brand.teamId,
                                m.membershipId,
                                nextStatus,
                                originUrl
                              )
                            );
                          }}
                          className="min-h-[44px] sm:min-h-[34px] rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2 py-0.5 text-2xs font-mono text-slate-800 dark:text-slate-100"
                        >
                          {(m.status === 'INVITED' || m.status === 'OPENED') && (
                            <option value="" disabled>
                              {m.status === 'OPENED' ? 'Link Opened' : 'Invited (Pending)'}
                            </option>
                          )}
                          <option value="ACTIVE">Joined</option>
                          <option value="INJURED">Injured</option>
                          <option value="OFF_SEASON">Off-Season</option>
                          <option value="ALUMNI">Alumni</option>
                          <option value="REVOKED">Remove</option>
                        </select>
                      </div>
                    )}
                  </td>

                  <td className="py-3 px-3 font-mono text-2xs">
                    {m.liveSnapshot ? (
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {m.liveSnapshot.verdictLabel}
                        </span>
                        <span className="block text-2xs text-slate-500">
                          CTL {Math.round(m.liveSnapshot.ctl)} · TSB{' '}
                          {m.liveSnapshot.tsb >= 0
                            ? `+${Math.round(m.liveSnapshot.tsb)}`
                            : Math.round(m.liveSnapshot.tsb)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-500">
                        {m.seedMarkOrFtp ? `Seed: ${m.seedMarkOrFtp}` : 'Pending claim'}
                      </span>
                    )}
                  </td>

                  <td className="py-3 px-4 text-right">
                    {isActiveTeamCoach && m.role === 'ATHLETE' && (
                      <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            onCopyText(m.membershipId, joinLink)
                          }
                          className="min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-lg bg-stone-200/70 dark:bg-slate-800 hover:bg-stone-300 text-2xs font-mono inline-flex items-center gap-1 cursor-pointer"
                        >
                          {copiedId === m.membershipId ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-600" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Link</span>
                            </>
                          )}
                        </button>

                        {m.isMinorU18 && (
                          <button
                            type="button"
                            disabled={copyingParentLinkId === m.membershipId}
                            onClick={() => void handleCopyParentConsentLink(m.membershipId)}
                            className="min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-300 border border-amber-500/30 text-2xs font-mono inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          >
                            <ShieldCheck className="w-3 h-3" />
                            <span>
                              {copiedId === `parent-${m.membershipId}`
                                ? 'Parent Link Copied ✓'
                                : copyingParentLinkId === m.membershipId
                                  ? 'Creating…'
                                  : 'Copy Parent Link'}
                            </span>
                          </button>
                        )}

                        {allowDirectSms && smsHref && (
                          <a
                            href={smsHref}
                            className="min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30 text-2xs font-mono inline-flex items-center gap-1"
                            title="Open native Messages / SMS pre-filled with Magic Join Link"
                          >
                            <MessageSquare className="w-3 h-3" />
                            <span>Text</span>
                          </a>
                        )}

                        {m.status !== 'ACTIVE' &&
                          (resendConfigured ? (
                            <button
                              type="button"
                              onClick={() => handleResendPending(m.membershipId)}
                              className="min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 text-blue-700 dark:text-sky-300 border border-blue-500/30 text-2xs font-mono cursor-pointer"
                            >
                              Nudge
                            </button>
                          ) : (
                            mailtoHref && (
                              <a
                                href={mailtoHref}
                                className="min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 text-blue-700 dark:text-sky-300 border border-blue-500/30 text-2xs font-mono inline-flex items-center gap-1"
                              >
                                <ExternalLink className="w-3 h-3" />
                                <span>Email</span>
                              </a>
                            )
                          ))}
                        {m.status === 'INVITED' &&
                          activeMergeTargets.length > 0 && (
                            <select
                              aria-label={`Merge ${m.invitedName} into active athlete`}
                              disabled={isRowBusy}
                              defaultValue=""
                              onChange={(e) => {
                                const targetId = e.target.value;
                                if (targetId) {
                                  void runMemberMutation(
                                    m.membershipId,
                                    () =>
                                      mergeRosterMembersApi(
                                        activeTeam.brand.teamId,
                                        m.membershipId,
                                        targetId,
                                        originUrl
                                      ),
                                    'Merged pre-seeded profile & official marks into the claimed athlete account.'
                                  );
                                  e.target.value = '';
                                }
                              }}
                              className="min-h-[44px] sm:min-h-[34px] rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2 py-0.5 text-2xs font-mono text-slate-700 dark:text-slate-200"
                            >
                              <option value="">Merge into…</option>
                              {activeMergeTargets.map((target) => (
                                <option
                                  key={target.membershipId}
                                  value={target.membershipId}
                                >
                                  {target.invitedName}
                                </option>
                              ))}
                            </select>
                          )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
