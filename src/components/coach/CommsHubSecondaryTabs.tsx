import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Lock,
  Plus,
  Send,
  Trash2,
  Users,
  X,
} from '../icons/PhosphorIcons';
import {
  deleteTeamAnnouncementApi,
  postTeamAnnouncementApi,
  postTeamWorkoutCommentApi,
  TeamLifecycleApiError,
  upsertTeamCustomSubgroupApi,
} from '../../utils/teamLifecycleApi';
import {
  copyTextToClipboardSafe,
  formatMessageForRemindOrParentSquare,
} from '../../utils/remindFormatter';
import type {
  TeamAnnouncementCategory,
  TeamAnnouncementRecord,
  TeamCustomSubgroup,
  TeamMembershipRecord,
  TeamMessageRecord,
  TeamSummaryWithRole,
  TeamWorkoutComment,
} from '../../types';

function isStaffRole(role: TeamMembershipRecord['role']): boolean {
  return (
    role === 'HEAD_COACH' ||
    role === 'ASSISTANT_COACH' ||
    role === 'ATHLETIC_TRAINER' ||
    role === 'ORG_ADMIN'
  );
}

function resolveExpectedMessageAudience(
  message: TeamMessageRecord,
  activeTeam: TeamSummaryWithRole
): TeamMembershipRecord[] {
  const activeMembers = (activeTeam.memberships || []).filter(
    (m) => m.status !== 'REVOKED' && m.status !== 'ALUMNI'
  );
  if (message.channelScope === 'COACHES_STAFF') {
    return activeMembers.filter((m) => isStaffRole(m.role));
  }
  if (message.channelScope === 'PARENTS_ONLY') {
    return activeMembers.filter((m) => isStaffRole(m.role) || m.role === 'PARENT_FOLLOWER');
  }
  if (message.channelScope === 'EVENT_GROUP') {
    return activeMembers.filter((m) => {
      if (isStaffRole(m.role)) return true;
      if (m.role !== 'ATHLETE') return false;
      return !message.eventGroup || !m.eventGroup || m.eventGroup === message.eventGroup;
    });
  }
  if (message.channelScope === 'CUSTOM_SUBGROUP') {
    const sg = (activeTeam.customSubgroups || []).find((g) => g.id === message.customSubgroupId);
    const idSet = new Set(sg?.memberIds || []);
    return activeMembers.filter((m) => isStaffRole(m.role) || idSet.has(m.membershipId));
  }
  if (message.channelScope === 'DIRECT_TRANSPARENT') {
    return activeMembers.filter(
      (m) => isStaffRole(m.role) || m.membershipId === message.targetMembershipId
    );
  }
  return activeMembers;
}

export const CommsReadReceiptPopover: React.FC<{
  message: TeamMessageRecord;
  activeTeam: TeamSummaryWithRole;
  onClose: () => void;
}> = ({ message, activeTeam, onClose }) => {
  const { acked, unread } = useMemo(() => {
    const ackSet = new Set(message.acknowledgedByMembershipIds || []);
    const audience = resolveExpectedMessageAudience(message, activeTeam);
    const seenIds = new Set<string>();
    const ackedList: TeamMembershipRecord[] = [];
    const unreadList: TeamMembershipRecord[] = [];
    for (const member of audience) {
      if (seenIds.has(member.membershipId)) continue;
      seenIds.add(member.membershipId);
      if (ackSet.has(member.membershipId)) {
        ackedList.push(member);
      } else {
        unreadList.push(member);
      }
    }
    return { acked: ackedList, unread: unreadList };
  }, [activeTeam, message]);

  return (
    <div
      data-testid="msg-read-receipts-popover"
      className="mt-2 rounded-xl border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-obsidian p-2.5 space-y-2 text-2xs shadow-md"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono font-bold text-ap-ink dark:text-ap-chalk uppercase">
          Read Receipts · {acked.length}/{acked.length + unread.length}
        </span>
        <button
          type="button"
          aria-label="Close read receipts"
          onClick={onClose}
          className="min-h-[28px] min-w-[28px] rounded-lg ap-card-inset inline-flex items-center justify-center cursor-pointer"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="rounded-lg ap-card-inset p-2 space-y-1">
          <div className="font-mono font-bold text-emerald-700 dark:text-emerald-300">
            Acknowledged ({acked.length})
          </div>
          {acked.length === 0 ? (
            <p className="text-ap-muted dark:text-ap-muted-dark">None yet</p>
          ) : (
            <ul className="space-y-0.5 text-ap-ink dark:text-ap-chalk max-h-24 overflow-y-auto">
              {acked.map((m) => (
                <li key={m.membershipId} className="truncate">
                  ✓ {m.invitedName}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg ap-card-inset p-2 space-y-1">
          <div className="font-mono font-bold text-amber-700 dark:text-amber-300">
            Not Yet Read ({unread.length})
          </div>
          {unread.length === 0 ? (
            <p className="text-ap-muted dark:text-ap-muted-dark">Everyone read this ✓</p>
          ) : (
            <ul className="space-y-0.5 text-ap-ink dark:text-ap-chalk max-h-24 overflow-y-auto">
              {unread.map((m) => (
                <li key={m.membershipId} className="truncate">
                  · {m.invitedName}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export const CommsSubgroupManager: React.FC<{
  activeTeam: TeamSummaryWithRole;
  isSampleDemo: boolean;
  onApplyTeam: (t: TeamSummaryWithRole) => void;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], activeTeamId?: string) => void;
  onCreated: (subgroupId: string) => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}> = ({
  activeTeam,
  isSampleDemo,
  onApplyTeam,
  onTeamsUpdated,
  onCreated,
  onCancel,
  onError,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([activeTeam.myMembershipId]);
  const [includeLinkedParents, setIncludeLinkedParents] = useState(true);
  const [saving, setSaving] = useState(false);

  const eligibleMembers = useMemo(
    () =>
      (activeTeam.memberships || []).filter(
        (m) => m.status !== 'REVOKED' && m.status !== 'ALUMNI'
      ),
    [activeTeam.memberships]
  );

  const toggleMember = (membershipId: string) => {
    setSelectedIds((prev) =>
      prev.includes(membershipId)
        ? prev.filter((id) => id !== membershipId)
        : [...prev, membershipId]
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (cleanName.length < 2) {
      onError('Sub-group name must be at least 2 characters.');
      return;
    }
    if (isSampleDemo) {
      const created: TeamCustomSubgroup = {
        id: `sgrp-local-${Date.now().toString(36)}`,
        name: cleanName,
        ...(description.trim() ? { description: description.trim() } : {}),
        memberIds: selectedIds,
        includeLinkedParents,
        createdByMembershipId: activeTeam.myMembershipId,
        createdByName: activeTeam.brand.coachDisplayName || 'Coach',
        createdAt: new Date().toISOString(),
      };
      onApplyTeam({
        ...activeTeam,
        customSubgroups: [created, ...(activeTeam.customSubgroups || [])],
      });
      onCreated(created.id);
      return;
    }

    setSaving(true);
    try {
      const resp = await upsertTeamCustomSubgroupApi({
        teamId: activeTeam.brand.teamId,
        name: cleanName,
        description: description.trim() || undefined,
        memberIds: selectedIds,
        includeLinkedParents,
      });
      if (resp.teams && resp.teams.length > 0) {
        onTeamsUpdated(resp.teams, activeTeam.brand.teamId);
      } else if (resp.team) {
        onApplyTeam(resp.team);
      } else if (resp.subgroup) {
        onApplyTeam({
          ...activeTeam,
          customSubgroups: [resp.subgroup, ...(activeTeam.customSubgroups || [])],
        });
      }
      if (resp.subgroup?.id) {
        onCreated(resp.subgroup.id);
      } else {
        onCancel();
      }
    } catch (err) {
      onError(
        err instanceof TeamLifecycleApiError
          ? err.message
          : 'Could not save custom sub-group right now.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSave(e)}
      data-testid="comms-subgroup-manager"
      className="rounded-xl border border-ap-frame/20 dark:border-ap-edge-dark bg-white dark:bg-ap-obsidian p-3 space-y-2.5 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-ap-ink dark:text-ap-chalk inline-flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5 ap-text-brand" />
          New Custom Sub-Group
        </span>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel sub-group creation"
          className="min-h-[30px] px-2 rounded-lg ap-card-inset text-2xs cursor-pointer"
        >
          Cancel
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          type="text"
          required
          data-testid="comms-subgroup-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g. Varsity Boys Travel Bus)"
          className="min-h-[38px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-stone-50 dark:bg-ap-carbon px-2.5 text-xs"
        />
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional note (Meet bus #1 / Relay pool)"
          className="min-h-[38px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-stone-50 dark:bg-ap-carbon px-2.5 text-xs"
        />
      </div>
      <div className="max-h-28 overflow-y-auto rounded-lg ap-card-inset p-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
        {eligibleMembers.map((m) => (
          <label
            key={m.membershipId}
            className="flex items-center gap-1.5 text-2xs cursor-pointer truncate"
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(m.membershipId)}
              onChange={() => toggleMember(m.membershipId)}
            />
            <span className="truncate font-medium">{m.invitedName}</span>
            <span className="font-mono opacity-60">({m.role === 'ATHLETE' ? m.squadGroup : m.role})</span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex items-center gap-1.5 text-2xs cursor-pointer">
          <input
            type="checkbox"
            checked={includeLinkedParents}
            onChange={(e) => setIncludeLinkedParents(e.target.checked)}
          />
          <span>SafeSport: Include Linked Parents/Guardians</span>
        </label>
        <button
          type="submit"
          disabled={saving || name.trim().length < 2}
          data-testid="comms-subgroup-save-btn"
          className="ap-btn-primary !min-h-[36px] px-3 py-1 text-xs font-bold cursor-pointer disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Create Sub-Group'}
        </button>
      </div>
    </form>
  );
};

export const CommsAnnouncementsTab: React.FC<{
  activeTeam: TeamSummaryWithRole;
  isStaff: boolean;
  isSampleDemo: boolean;
  onApplyTeam: (t: TeamSummaryWithRole) => void;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], activeTeamId?: string) => void;
  onNotify: (msg: string) => void;
  onError: (msg: string) => void;
}> = ({
  activeTeam,
  isStaff,
  isSampleDemo,
  onApplyTeam,
  onTeamsUpdated,
  onNotify,
  onError,
}) => {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<TeamAnnouncementCategory>('MEET_LOGISTICS');
  const [publishToParentHub, setPublishToParentHub] = useState(true);
  const [posting, setPosting] = useState(false);

  const announcements = activeTeam.announcements || [];

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    if (isSampleDemo) {
      const created: TeamAnnouncementRecord = {
        id: `ann-local-${Date.now().toString(36)}`,
        teamId: activeTeam.brand.teamId,
        title: title.trim(),
        body: body.trim(),
        category,
        publishToParentHub,
        authorName: activeTeam.brand.coachDisplayName || 'Coach',
        createdAt: new Date().toISOString(),
      };
      onApplyTeam({
        ...activeTeam,
        announcements: [created, ...announcements].slice(0, 30),
      });
      setTitle('');
      setBody('');
      onNotify('Announcement posted ✓');
      return;
    }
    setPosting(true);
    try {
      const resp = await postTeamAnnouncementApi({
        teamId: activeTeam.brand.teamId,
        title: title.trim(),
        body: body.trim(),
        category,
        publishToParentHub,
      });
      if (resp.teams && resp.teams.length > 0) {
        onTeamsUpdated(resp.teams, activeTeam.brand.teamId);
      } else if (resp.team) {
        onApplyTeam(resp.team);
      }
      setTitle('');
      setBody('');
      onNotify('Announcement posted ✓');
    } catch (err) {
      onError(err instanceof TeamLifecycleApiError ? err.message : 'Unable to post announcement.');
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (announcementId: string) => {
    if (isSampleDemo) {
      onApplyTeam({
        ...activeTeam,
        announcements: announcements.filter((a) => a.id !== announcementId),
      });
      onNotify('Announcement deleted.');
      return;
    }
    try {
      const resp = await deleteTeamAnnouncementApi({
        teamId: activeTeam.brand.teamId,
        announcementId,
      });
      if (resp.teams && resp.teams.length > 0) {
        onTeamsUpdated(resp.teams, activeTeam.brand.teamId);
      } else if (resp.team) {
        onApplyTeam(resp.team);
      }
    } catch (err) {
      onError(err instanceof TeamLifecycleApiError ? err.message : 'Could not delete announcement.');
    }
  };

  const handleCopyRemind = async (ann: TeamAnnouncementRecord) => {
    const formatted = formatMessageForRemindOrParentSquare({
      teamShortName: activeTeam.brand.shortName || activeTeam.brand.name,
      teamSlug: activeTeam.brand.slug,
      title: ann.title,
      body: ann.body,
      categoryLabel: ann.category,
    });
    const copied = await copyTextToClipboardSafe(formatted);
    onNotify(copied ? 'Copied for Remind / ParentSquare ✓' : formatted);
  };

  return (
    <div data-testid="comms-announcements-panel" className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
      {isStaff && (
        <form
          onSubmit={(e) => void handlePost(e)}
          className="rounded-xl border border-ap-frame/20 dark:border-ap-edge-dark ap-card-inset p-3 space-y-2 text-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-ap-ink dark:text-ap-chalk inline-flex items-center gap-1">
              <Plus className="w-3.5 h-3.5 ap-text-brand" />
              Post Weather / Schedule Notice
            </span>
            <select
              aria-label="Announcement category"
              value={category}
              onChange={(e) => setCategory(e.target.value as TeamAnnouncementCategory)}
              className="min-h-[34px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 font-mono text-2xs"
            >
              <option value="WEATHER">WEATHER</option>
              <option value="SCHEDULE_CHANGE">SCHEDULE_CHANGE</option>
              <option value="MEET_LOGISTICS">MEET_LOGISTICS</option>
              <option value="GENERAL">GENERAL</option>
            </select>
          </div>
          <input
            type="text"
            required
            data-testid="comms-announcement-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Notice title (e.g. Meet Bus Departs 2:15 PM)"
            className="w-full min-h-[38px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-xs"
          />
          <textarea
            rows={2}
            required
            data-testid="comms-announcement-body-input"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Details for athletes, families & staff..."
            className="w-full rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 py-1.5 text-xs"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex items-center gap-1.5 text-2xs cursor-pointer">
              <input
                type="checkbox"
                checked={publishToParentHub}
                onChange={(e) => setPublishToParentHub(e.target.checked)}
              />
              <span>Publish to Parent Hub &amp; Email Fallback</span>
            </label>
            <button
              type="submit"
              disabled={posting || !title.trim() || !body.trim()}
              data-testid="comms-announcement-post-btn"
              className="ap-btn-primary !min-h-[36px] px-3 py-1 text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {posting ? 'Posting…' : 'Post Announcement'}
            </button>
          </div>
        </form>
      )}

      {announcements.length === 0 ? (
        <div className="rounded-xl ap-card-inset p-4 text-xs text-ap-muted dark:text-ap-muted-dark">
          No team announcements posted yet.
        </div>
      ) : (
        <div className="space-y-2">
          {announcements.map((ann) => (
            <div
              key={ann.id}
              data-testid={`comms-announcement-item-${ann.id}`}
              className="rounded-xl border border-ap-frame/15 dark:border-ap-edge-dark ap-card-inset px-3 py-2.5 space-y-1.5 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`px-1.5 py-0.5 rounded font-mono text-2xs font-bold uppercase ${
                      ann.category === 'WEATHER' ? 'ap-status-caution' : 'ap-status-info'
                    }`}
                  >
                    {ann.category}
                  </span>
                  <span className="font-bold text-ap-ink dark:text-ap-chalk">{ann.title}</span>
                </div>
                <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                  {ann.createdAt.slice(0, 10)}
                </span>
              </div>
              <p className="text-ap-ink dark:text-ap-chalk leading-snug">{ann.body}</p>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <button
                  type="button"
                  data-testid={`announcement-copy-remind-btn-${ann.id}`}
                  onClick={() => void handleCopyRemind(ann)}
                  className="min-h-[34px] px-2.5 py-0.5 rounded-lg ap-btn-secondary text-2xs font-mono font-semibold inline-flex items-center gap-1 cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  <span>Copy for Remind / ParentSquare</span>
                </button>
                {isStaff && (
                  <button
                    type="button"
                    data-testid={`announcement-delete-btn-${ann.id}`}
                    onClick={() => void handleDelete(ann.id)}
                    className="min-h-[34px] px-2 py-0.5 rounded-lg text-2xs font-mono text-rose-600 dark:text-rose-400 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Delete</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const CommsWorkoutNotesTab: React.FC<{
  activeTeam: TeamSummaryWithRole;
  isStaff: boolean;
  isSampleDemo: boolean;
  onApplyTeam: (t: TeamSummaryWithRole) => void;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], activeTeamId?: string) => void;
  onNotify: (msg: string) => void;
  onError: (msg: string) => void;
}> = ({
  activeTeam,
  isStaff,
  isSampleDemo,
  onApplyTeam,
  onTeamsUpdated,
  onNotify,
  onError,
}) => {
  const athletes = useMemo(
    () =>
      (activeTeam.memberships || []).filter(
        (m) => m.role === 'ATHLETE' && m.status !== 'REVOKED'
      ),
    [activeTeam.memberships]
  );
  const [targetMembershipId, setTargetMembershipId] = useState(
    () => athletes[0]?.membershipId || activeTeam.myMembershipId
  );
  const [noteBody, setNoteBody] = useState('');
  const [sending, setSending] = useState(false);

  const comments = useMemo(
    () =>
      [...(activeTeam.workoutComments || [])].sort((a, b) =>
        String(b.createdAt).localeCompare(String(a.createdAt))
      ),
    [activeTeam.workoutComments]
  );

  const resolvedTargetId = isStaff
    ? athletes.find((a) => a.membershipId === targetMembershipId)?.membershipId ||
      athletes[0]?.membershipId ||
      activeTeam.myMembershipId
    : activeTeam.myMembershipId;

  const handlePostNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = noteBody.trim();
    if (!clean) return;
    const todayIso = new Date().toISOString().slice(0, 10);
    const guardianCc = Boolean(activeTeam.brand.enableParentGuardianCc);

    if (isSampleDemo) {
      const targetMem = athletes.find((a) => a.membershipId === resolvedTargetId);
      const localNote: TeamWorkoutComment = {
        id: `wcmt-local-${Date.now().toString(36)}`,
        teamId: activeTeam.brand.teamId,
        targetMembershipId: resolvedTargetId,
        targetAthleteName: targetMem?.invitedName || 'Athlete',
        workoutDate: todayIso,
        authorSid: 'local-user',
        authorName: isStaff ? activeTeam.brand.coachDisplayName || 'Coach' : 'Athlete',
        authorRole: activeTeam.myRole,
        body: clean,
        guardianCcApplied: guardianCc,
        guardianVisible: guardianCc,
        createdAt: new Date().toISOString(),
      };
      onApplyTeam({
        ...activeTeam,
        workoutComments: [localNote, ...(activeTeam.workoutComments || [])],
      });
      setNoteBody('');
      onNotify('Workout note saved ✓');
      return;
    }

    setSending(true);
    try {
      const resp = await postTeamWorkoutCommentApi(activeTeam.brand.teamId, {
        targetMembershipId: resolvedTargetId,
        workoutDate: todayIso,
        body: clean,
        guardianCc,
      });
      if (resp.teams && resp.teams.length > 0) {
        onTeamsUpdated(resp.teams, activeTeam.brand.teamId);
      } else if (resp.team) {
        onApplyTeam(resp.team);
      }
      setNoteBody('');
      onNotify('Workout note saved ✓');
    } catch (err) {
      onError(err instanceof TeamLifecycleApiError ? err.message : 'Unable to save workout note.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div data-testid="comms-workout-notes-panel" className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {comments.length === 0 ? (
          <div className="rounded-xl ap-card-inset p-4 text-xs text-ap-muted dark:text-ap-muted-dark">
            No workout feedback notes yet. Post a SafeSport-logged session note below.
          </div>
        ) : (
          comments.map((cmt) => (
            <div
              key={cmt.id}
              data-testid={`comms-workout-note-${cmt.id}`}
              className="rounded-xl border border-ap-frame/15 dark:border-ap-edge-dark ap-card-inset px-3 py-2 space-y-1 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-2xs font-mono">
                <span className="font-bold text-ap-ink dark:text-ap-chalk">
                  {cmt.authorName} → {cmt.targetAthleteName || 'Athlete'}
                </span>
                <div className="flex items-center gap-1.5">
                  {cmt.guardianCcApplied && (
                    <span className="px-1.5 py-0.5 rounded ap-status-info inline-flex items-center gap-1">
                      <Lock className="w-2.5 h-2.5" /> Guardian CC
                    </span>
                  )}
                  <span className="text-ap-muted dark:text-ap-muted-dark">{cmt.workoutDate}</span>
                </div>
              </div>
              <p className="text-ap-ink dark:text-ap-chalk leading-snug">{cmt.body}</p>
            </div>
          ))
        )}
      </div>

      {activeTeam.myRole !== 'PARENT_FOLLOWER' && (
        <form
          onSubmit={(e) => void handlePostNote(e)}
          className="px-4 py-3 border-t border-ap-frame/15 dark:border-ap-edge-dark space-y-2"
        >
          {isStaff && athletes.length > 0 && (
            <select
              aria-label="Select athlete for workout note"
              value={resolvedTargetId}
              onChange={(e) => setTargetMembershipId(e.target.value)}
              className="w-full min-h-[36px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-xs font-semibold"
            >
              {athletes.map((a) => (
                <option key={a.membershipId} value={a.membershipId}>
                  {a.invitedName}
                </option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-2">
            <input
              type="text"
              data-testid="comms-workout-note-input"
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              placeholder="Write a workout feedback note (SafeSport CC logged)..."
              className="flex-1 min-h-[44px] rounded-xl border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-3 text-xs"
            />
            <button
              type="submit"
              disabled={sending || !noteBody.trim()}
              data-testid="comms-workout-note-send-btn"
              className="ap-btn-primary !min-h-[44px] px-4 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Post Note</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
