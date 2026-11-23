import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sliders,
  UserPlus,
  Users,
  X,
} from '../icons/PhosphorIcons';
import {
  COACH_EVENT_GROUP_OPTIONS,
  COACH_SPECIALTY_PRESETS,
  doesCoachOwnAthlete,
} from '../../physiology/teamOnboardingEngine';
import {
  inviteTeamCoachingStaffApi,
  updateAssistantCoachEventGroupsApi,
} from '../../utils/teamLifecycleApi';
import type {
  CoachEventGroup,
  TeamMemberRole,
  TeamMembershipRecord,
  TeamSummaryWithRole,
} from '../../types';

export interface CoachingStaffPanelProps {
  activeTeam: TeamSummaryWithRole;
  myTeams: TeamSummaryWithRole[];
  isSampleDemoMode?: boolean;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string | null) => void;
}

const SEVEN_STAFF_LANES: Array<{
  id: string;
  label: string;
  matchGroups?: CoachEventGroup[];
  matchHead?: boolean;
}> = [
  { id: 'head', label: 'Head Coach', matchHead: true },
  { id: 'distance', label: 'Distance', matchGroups: ['DISTANCE', 'MID_DISTANCE'] },
  { id: 'sprints', label: 'Sprints', matchGroups: ['SPRINTS'] },
  { id: 'hurdles', label: 'Hurdles', matchGroups: ['HURDLES'] },
  { id: 'jumps', label: 'Jumps', matchGroups: ['JUMPS'] },
  { id: 'pole_vault', label: 'Pole Vault', matchGroups: ['POLE_VAULT'] },
  { id: 'throws', label: 'Throws', matchGroups: ['THROWS'] },
];

export const CoachingStaffPanel: React.FC<CoachingStaffPanelProps> = ({
  activeTeam,
  myTeams,
  isSampleDemoMode = false,
  onTeamsUpdated,
}) => {
  const isDemoTeam = Boolean(
    isSampleDemoMode ||
      activeTeam.brand.teamId.startsWith('demo_team_') ||
      activeTeam.brand.teamId.startsWith('demo-team-')
  );
  const canManageStaff =
    activeTeam.myRole === 'HEAD_COACH' || activeTeam.myRole === 'ORG_ADMIN';

  const staffMembers = useMemo(
    () =>
      activeTeam.memberships.filter(
        (m) =>
          m.status !== 'REVOKED' &&
          m.role !== 'ATHLETE' &&
          m.role !== 'PARENT_FOLLOWER'
      ),
    [activeTeam.memberships]
  );

  const athleteMembers = useMemo(
    () =>
      activeTeam.memberships.filter(
        (m) => m.role === 'ATHLETE' && m.status !== 'REVOKED'
      ),
    [activeTeam.memberships]
  );

  const [showInviteForm, setShowInviteForm] = useState<boolean>(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('pole_vault');
  const [inviteName, setInviteName] = useState<string>('');
  const [inviteEmail, setInviteEmail] = useState<string>('');
  const [inviteRole, setInviteRole] = useState<TeamMemberRole>('ASSISTANT_COACH');
  const [inviteSpecialty, setInviteSpecialty] = useState<string>('Pole Vault Coach');
  const [inviteGroups, setInviteGroups] = useState<CoachEventGroup[]>(['POLE_VAULT']);
  const [inviteAthleteIds, setInviteAthleteIds] = useState<string[]>([]);
  const [savingInvite, setSavingInvite] = useState<boolean>(false);
  const [latestInviteUrl, setLatestInviteUrl] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [staffStatus, setStaffStatus] = useState<string | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const [editingGroups, setEditingGroups] = useState<CoachEventGroup[]>([]);
  const [editingAthleteIds, setEditingAthleteIds] = useState<string[]>([]);
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  const applyTeamUpdate = (nextTeam: TeamSummaryWithRole) => {
    const nextList = myTeams.map((t) =>
      t.brand.teamId === nextTeam.brand.teamId ? nextTeam : t
    );
    onTeamsUpdated(nextList, nextTeam.brand.teamId);
  };

  const handlePresetChange = (presetId: string) => {
    setSelectedPresetId(presetId);
    if (presetId === 'custom') return;
    const preset = COACH_SPECIALTY_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setInviteSpecialty(preset.title);
    setInviteRole(preset.defaultRole);
    setInviteGroups([...preset.defaultEventGroups]);
  };

  const toggleGroupInList = (
    list: CoachEventGroup[],
    group: CoachEventGroup
  ): CoachEventGroup[] =>
    list.includes(group) ? list.filter((g) => g !== group) : [...list, group];

  const toggleAthleteIdInList = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const handleCopyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // ignore clipboard errors in sandboxed browsers
    }
  };

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = inviteName.trim();
    if (!cleanName) {
      setStaffError('Coach or staff name is required.');
      return;
    }
    setStaffError(null);
    setStaffStatus(null);
    setLatestInviteUrl(null);
    setSavingInvite(true);

    const localFallbackAdd = () => {
      const demoId = `demo-mem-coach-${Date.now()}`;
      const origin =
        typeof window !== 'undefined' ? window.location.origin : 'https://meetready.app';
      const inviteUrl = `${origin}/join/${activeTeam.brand.slug}?t=demo-staff-${Date.now()}`;
      const newCoach: TeamMembershipRecord = {
        membershipId: demoId,
        teamId: activeTeam.brand.teamId,
        role: inviteRole,
        squadGroup: 'Coaching Staff',
        ...(inviteSpecialty.trim() ? { coachSpecialtyTitle: inviteSpecialty.trim() } : {}),
        ...(inviteGroups.length > 0 ? { coachEventGroups: inviteGroups } : {}),
        ...(inviteAthleteIds.length > 0
          ? { assignedAthleteMembershipIds: inviteAthleteIds }
          : {}),
        sharingTier: 'FULL_STREAMS',
        invitedName: cleanName,
        ...(inviteEmail.trim() ? { invitedEmail: inviteEmail.trim().toLowerCase() } : {}),
        isMinorU18: false,
        parentConsentStatus: 'NOT_REQUIRED',
        status: 'INVITED',
        emailDeliveryStatus: 'READY_MANUAL_LINK',
        magicJoinUrl: inviteUrl,
        invitedAt: new Date().toISOString(),
      };
      applyTeamUpdate({
        ...activeTeam,
        memberships: [...activeTeam.memberships, newCoach],
      });
      setLatestInviteUrl(inviteUrl);
      setStaffStatus(`Added ${cleanName} (${inviteSpecialty || inviteRole}) in demo mode.`);
      setInviteName('');
      setInviteEmail('');
      setInviteAthleteIds([]);
    };

    try {
      if (isDemoTeam) {
        localFallbackAdd();
        return;
      }
      const res = await inviteTeamCoachingStaffApi({
        teamId: activeTeam.brand.teamId,
        staffName: cleanName,
        staffEmail: inviteEmail.trim() || undefined,
        role: inviteRole,
        coachSpecialtyTitle: inviteSpecialty.trim() || undefined,
        coachEventGroups: inviteGroups,
        assignedAthleteMembershipIds: inviteAthleteIds,
      });
      if (res.teams && res.teams.length > 0) {
        onTeamsUpdated(res.teams, activeTeam.brand.teamId);
      } else if (res.team) {
        applyTeamUpdate(res.team);
      }
      if (res.inviteUrl) {
        setLatestInviteUrl(res.inviteUrl);
      }
      setStaffStatus(
        res.emailStatus === 'SENT_RESEND'
          ? `Emailed coaching invite to ${cleanName}.`
          : `Created staff invite link for ${cleanName}.`
      );
      setInviteName('');
      setInviteEmail('');
      setInviteAthleteIds([]);
    } catch (err) {
      setStaffError(err instanceof Error ? err.message : 'Unable to invite coaching staff.');
    } finally {
      setSavingInvite(false);
    }
  };

  const openEditor = (member: TeamMembershipRecord) => {
    if (editingMemberId === member.membershipId) {
      setEditingMemberId(null);
      return;
    }
    setEditingMemberId(member.membershipId);
    setEditingTitle(member.coachSpecialtyTitle || '');
    setEditingGroups(member.coachEventGroups || []);
    setEditingAthleteIds(member.assignedAthleteMembershipIds || []);
    setStaffError(null);
  };

  const handleSaveMemberOwnership = async (member: TeamMembershipRecord) => {
    setSavingEdit(true);
    setStaffError(null);
    setStaffStatus(null);

    const applyLocalSave = () => {
      applyTeamUpdate({
        ...activeTeam,
        memberships: activeTeam.memberships.map((m) =>
          m.membershipId === member.membershipId
            ? {
                ...m,
                coachSpecialtyTitle: editingTitle.trim() || undefined,
                coachEventGroups: editingGroups.length > 0 ? editingGroups : undefined,
                assignedAthleteMembershipIds:
                  editingAthleteIds.length > 0 ? editingAthleteIds : undefined,
              }
            : m
        ),
      });
      setStaffStatus(`Updated ownership for ${member.invitedName}.`);
      setEditingMemberId(null);
    };

    try {
      if (isDemoTeam) {
        applyLocalSave();
        return;
      }
      const res = await updateAssistantCoachEventGroupsApi({
        teamId: activeTeam.brand.teamId,
        membershipId: member.membershipId,
        coachEventGroups: editingGroups,
        coachSpecialtyTitle: editingTitle.trim(),
        assignedAthleteMembershipIds: editingAthleteIds,
      });
      if (res.teams && res.teams.length > 0) {
        onTeamsUpdated(res.teams, activeTeam.brand.teamId);
      } else if (res.team) {
        applyTeamUpdate(res.team);
      }
      setStaffStatus(`Updated ownership for ${member.invitedName}.`);
      setEditingMemberId(null);
    } catch (err) {
      setStaffError(err instanceof Error ? err.message : 'Could not update staff ownership.');
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <section
      data-testid="coaching-staff-panel"
      className="rounded-2xl liquid-glass border border-ap-frame/15 dark:border-ap-edge-dark p-4 sm:p-5 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Users className="w-4 h-4 ap-text-brand shrink-0" weight="duotone" />
            <h4 className="text-sm sm:text-base font-extrabold text-ap-ink dark:text-ap-chalk">
              Coaching Staff &amp; Event Group Ownership ({staffMembers.length})
            </h4>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full ap-status-prime text-2xs font-mono font-bold">
              <ShieldCheck className="w-3 h-3" /> Multi-Coach Scoped
            </span>
          </div>
          <p className="text-xs text-ap-muted dark:text-ap-muted-dark">
            Assign Head, Distance, Sprints, Hurdles, Jumps, Pole Vault, Throws &amp; Athletic Trainer responsibilities to specific event groups or athlete subsets.
          </p>
        </div>

        {canManageStaff && (
          <button
            type="button"
            data-testid="invite-coach-toggle-btn"
            onClick={() => setShowInviteForm((prev) => !prev)}
            className="min-h-[44px] sm:min-h-[38px] px-3.5 py-1.5 rounded-xl ap-btn-primary text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <UserPlus className="w-4 h-4" />
            <span>{showInviteForm ? 'Close Staff Invite' : 'Add Specialty Coach'}</span>
          </button>
        )}
      </div>

      {/* 7-Role Track & Field Coverage Strip */}
      <div
        data-testid="staff-coverage-matrix"
        className="flex flex-wrap items-center gap-1.5"
      >
        {SEVEN_STAFF_LANES.map((lane) => {
          const matched = staffMembers.filter((m) => {
            if (lane.matchHead) return m.role === 'HEAD_COACH';
            const groups = m.coachEventGroups || [];
            return lane.matchGroups?.some((g) => groups.includes(g));
          });
          const covered = matched.length > 0;
          return (
            <span
              key={lane.id}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-mono font-semibold border ${
                covered
                  ? 'ap-status-prime border-emerald-500/30'
                  : 'ap-card-inset border-ap-frame/15 dark:border-ap-edge-dark text-ap-muted dark:text-ap-muted-dark'
              }`}
            >
              <span>{lane.label}:</span>
              <strong>
                {covered ? matched.map((c) => c.invitedName.split(' ').pop()).join(', ') : 'Open'}
              </strong>
            </span>
          );
        })}
      </div>

      {staffError && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-200">
          {staffError}
        </div>
      )}
      {staffStatus && (
        <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
          <span>{staffStatus}</span>
          {latestInviteUrl && (
            <button
              type="button"
              onClick={() => void handleCopyText(latestInviteUrl, 'latest-staff-link')}
              className="min-h-[36px] px-2.5 py-1 rounded-lg ap-card-inset text-2xs font-mono font-bold inline-flex items-center gap-1 cursor-pointer"
            >
              {copiedKey === 'latest-staff-link' ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copiedKey === 'latest-staff-link' ? 'Copied Join Link' : 'Copy Magic Join Link'}</span>
            </button>
          )}
        </div>
      )}

      {/* Invite New Specialty Coach Form */}
      {canManageStaff && showInviteForm && (
        <form
          data-testid="invite-coach-staff-form"
          onSubmit={(e) => void handleInviteSubmit(e)}
          className="rounded-2xl ap-card-inset border border-ap-frame/20 dark:border-ap-edge-dark p-4 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="block space-y-1">
              <span className="text-2xs font-mono font-bold uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark">
                Specialty Role Preset
              </span>
              <select
                data-testid="invite-coach-specialty-select"
                value={selectedPresetId}
                onChange={(e) => handlePresetChange(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-xs font-semibold text-ap-ink dark:text-ap-chalk"
              >
                {COACH_SPECIALTY_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
                <option value="custom">Custom Coach / Volunteer Role</option>
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-2xs font-mono font-bold uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark">
                Coach Full Name
              </span>
              <input
                type="text"
                required
                data-testid="invite-coach-name-input"
                placeholder="e.g. Coach Rivera"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-3 text-xs text-ap-ink dark:text-ap-chalk"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-2xs font-mono font-bold uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark">
                Coach Email (Optional)
              </span>
              <input
                type="email"
                data-testid="invite-coach-email-input"
                placeholder="rivera@school.edu"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-3 text-xs text-ap-ink dark:text-ap-chalk"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-2xs font-mono font-bold uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark">
                Display Title
              </span>
              <input
                type="text"
                data-testid="invite-coach-title-input"
                placeholder="Pole Vault Coach"
                value={inviteSpecialty}
                onChange={(e) => setInviteSpecialty(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-3 text-xs text-ap-ink dark:text-ap-chalk"
              />
            </label>
          </div>

          <div className="space-y-1.5">
            <span className="text-2xs font-mono font-bold uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark">
              Assigned Event Groups (Leave empty for Whole Team visibility)
            </span>
            <div className="flex flex-wrap gap-1.5">
              {COACH_EVENT_GROUP_OPTIONS.map((opt) => {
                const active = inviteGroups.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setInviteGroups((prev) => toggleGroupInList(prev, opt.id))}
                    className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
                      active
                        ? 'ap-nav-volt-active'
                        : 'liquid-capsule-track text-ap-ink dark:text-ap-chalk'
                    }`}
                  >
                    {opt.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>

          {athleteMembers.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-2xs font-mono font-bold uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark">
                Specific Individual Athletes (Optional Subset)
              </span>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto py-1">
                {athleteMembers.map((ath) => {
                  const selected = inviteAthleteIds.includes(ath.membershipId);
                  return (
                    <button
                      key={ath.membershipId}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setInviteAthleteIds((prev) =>
                          toggleAthleteIdInList(prev, ath.membershipId)
                        )
                      }
                      className={`min-h-[36px] px-2.5 py-1 rounded-lg text-2xs font-semibold cursor-pointer border ${
                        selected
                          ? 'ap-nav-volt-active border-transparent'
                          : 'bg-white/70 dark:bg-ap-carbon border-ap-frame/20 dark:border-ap-edge-dark text-ap-ink dark:text-ap-chalk'
                      }`}
                    >
                      {ath.invitedName}
                      {ath.eventGroup ? ` (${ath.eventGroup.replace('_', ' ')})` : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <label className="inline-flex items-center gap-2 text-xs text-ap-ink dark:text-ap-chalk">
              <span className="font-mono text-2xs uppercase">Permission Tier:</span>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as TeamMemberRole)}
                className="min-h-[36px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 text-xs font-semibold"
              >
                <option value="ASSISTANT_COACH">Assistant / Event Coach</option>
                <option value="HEAD_COACH">Co-Head Coach (Full Admin)</option>
                <option value="ATHLETIC_TRAINER">Athletic Trainer (Medical / Rehab)</option>
                <option value="ORG_ADMIN">Athletic Director / Admin</option>
              </select>
            </label>

            <button
              type="submit"
              disabled={savingInvite}
              data-testid="invite-coach-submit-btn"
              className="min-h-[44px] px-4 py-2 rounded-xl ap-btn-primary text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {savingInvite ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              <span>Create Coach Invite</span>
            </button>
          </div>
        </form>
      )}

      {/* Active & Invited Coaching Staff Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {staffMembers.map((member) => {
          const ownedCount = athleteMembers.filter((ath) =>
            doesCoachOwnAthlete({
              coachEventGroups: member.coachEventGroups,
              assignedAthleteMembershipIds: member.assignedAthleteMembershipIds,
              athleteEventGroup: ath.eventGroup,
              athleteMembershipId: ath.membershipId,
            })
          ).length;
          const isEditing = editingMemberId === member.membershipId;

          return (
            <div
              key={member.membershipId}
              data-testid={`staff-member-card-${member.membershipId}`}
              className="rounded-2xl ap-card-inset border border-ap-frame/15 dark:border-ap-edge-dark p-3.5 space-y-2.5"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-extrabold text-ap-ink dark:text-ap-chalk truncate">
                      {member.invitedName}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-2xs font-mono font-bold ap-nav-volt-active">
                      {member.coachSpecialtyTitle || member.role.replace(/_/g, ' ')}
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-2xs font-mono bg-white/70 dark:bg-ap-carbon text-ap-muted dark:text-ap-muted-dark">
                      {member.status}
                    </span>
                  </div>
                  <div className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark mt-0.5">
                    Owns {ownedCount} of {athleteMembers.length} athletes
                    {member.assignedAthleteMembershipIds?.length
                      ? ` (${member.assignedAthleteMembershipIds.length} pinned)`
                      : ''}
                    {member.coachEventGroups && member.coachEventGroups.length > 0
                      ? ` · ${member.coachEventGroups.join(', ')}`
                      : ' · Full Team Access'}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {member.magicJoinUrl && (
                    <button
                      type="button"
                      onClick={() =>
                        void handleCopyText(member.magicJoinUrl || '', `copy-${member.membershipId}`)
                      }
                      className="min-h-[36px] px-2.5 py-1 rounded-lg bg-white/80 dark:bg-ap-carbon border border-ap-frame/20 dark:border-ap-edge-dark text-2xs font-mono font-semibold inline-flex items-center gap-1 cursor-pointer"
                    >
                      {copiedKey === `copy-${member.membershipId}` ? (
                        <Check className="w-3 h-3" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{copiedKey === `copy-${member.membershipId}` ? 'Copied' : 'Invite Link'}</span>
                    </button>
                  )}
                  {canManageStaff && (
                    <button
                      type="button"
                      data-testid={`edit-staff-ownership-${member.membershipId}`}
                      onClick={() => openEditor(member)}
                      className="min-h-[36px] px-2.5 py-1 rounded-lg ap-btn-secondary text-2xs font-bold inline-flex items-center gap-1 cursor-pointer"
                    >
                      {isEditing ? <X className="w-3 h-3" /> : <Sliders className="w-3 h-3" />}
                      <span>{isEditing ? 'Close' : 'Scope'}</span>
                    </button>
                  )}
                </div>
              </div>

              {canManageStaff && isEditing && (
                <div className="pt-2 border-t border-ap-frame/15 dark:border-ap-edge-dark space-y-2.5">
                  <label className="block space-y-1">
                    <span className="text-2xs font-mono font-bold text-ap-muted dark:text-ap-muted-dark">
                      Specialty Coach Title
                    </span>
                    <input
                      type="text"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      placeholder="e.g. Throws & Multi Coach"
                      className="w-full min-h-[38px] rounded-xl border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-xs"
                    />
                  </label>

                  <div className="space-y-1">
                    <span className="text-2xs font-mono font-bold text-ap-muted dark:text-ap-muted-dark">
                      Event Groups
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {COACH_EVENT_GROUP_OPTIONS.map((opt) => {
                        const active = editingGroups.includes(opt.id);
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            aria-pressed={active}
                            onClick={() =>
                              setEditingGroups((prev) => toggleGroupInList(prev, opt.id))
                            }
                            className={`min-h-[36px] px-2.5 py-1 rounded-lg text-2xs font-bold cursor-pointer ${
                              active
                                ? 'ap-nav-volt-active'
                                : 'bg-white/75 dark:bg-ap-carbon text-ap-ink dark:text-ap-chalk'
                            }`}
                          >
                            {opt.shortLabel}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {athleteMembers.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-2xs font-mono font-bold text-ap-muted dark:text-ap-muted-dark">
                        Pin Specific Athletes
                      </span>
                      <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto py-0.5">
                        {athleteMembers.map((ath) => {
                          const selected = editingAthleteIds.includes(ath.membershipId);
                          return (
                            <button
                              key={ath.membershipId}
                              type="button"
                              aria-pressed={selected}
                              onClick={() =>
                                setEditingAthleteIds((prev) =>
                                  toggleAthleteIdInList(prev, ath.membershipId)
                                )
                              }
                              className={`min-h-[34px] px-2 py-0.5 rounded-lg text-2xs font-semibold cursor-pointer ${
                                selected
                                  ? 'ap-nav-volt-active'
                                  : 'bg-white/75 dark:bg-ap-carbon text-ap-ink dark:text-ap-chalk'
                              }`}
                            >
                              {ath.invitedName}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={savingEdit}
                      data-testid={`save-staff-ownership-${member.membershipId}`}
                      onClick={() => void handleSaveMemberOwnership(member)}
                      className="min-h-[44px] sm:min-h-[38px] px-4 py-1.5 rounded-xl ap-btn-primary text-xs font-extrabold cursor-pointer disabled:opacity-50"
                    >
                      {savingEdit ? 'Saving…' : 'Save Coach Ownership'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
