import type {
  CoachEventGroup,
  TeamMembershipRecord,
  TeamMessageChannelScope,
  TeamMessageRecord,
  TeamMessagingPolicy,
  TeamSummaryWithRole,
  TeamCustomSubgroup,
} from '../../../types';
import type { QueuedChatOutboxMessage } from '../../../utils/chatOutbox';

export interface TeamMessagingDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeTeam: TeamSummaryWithRole | null;
  myTeams: TeamSummaryWithRole[];
  onTeamsUpdated: (teams: TeamSummaryWithRole[], activeTeamId?: string) => void;
  viewerMode?: 'ATHLETE' | 'COACH';
  initialScope?: TeamMessageChannelScope;
}

export const COACH_QUICK_TEMPLATES = [
  'Meet bus departs 2:30 PM from North Gate. Bring spikes & warmups.',
  'Lightning Shelter: All groups move inside main gym immediately.',
  'Hydration check + bring extra water & warmup jersey today.',
  'Great work today! Log a 10-second soreness check-in tonight.',
];

export function formatMsgTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso.slice(11, 16);
  }
}

export function sanitizeCsvCell(raw: unknown): string {
  const s = String(raw ?? '').replace(/[\r\n"]/g, ' ').trim();
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe}"`;
}

export function resolveDirectThreadAthlete(params: {
  isStaff: boolean;
  activeTeam: TeamSummaryWithRole | null;
  athleteMembers: TeamMembershipRecord[];
  selectedAthleteMembershipId: string;
}): TeamMembershipRecord | null {
  const { isStaff, activeTeam, athleteMembers, selectedAthleteMembershipId } = params;
  if (!isStaff) {
    if (activeTeam?.myRole === 'PARENT_FOLLOWER') {
      const linkedIds = new Set(activeTeam.myLinkedChildMembershipIds || []);
      const linkedChild = athleteMembers.find((m) => linkedIds.has(m.membershipId));
      if (linkedChild) return linkedChild;
    }
    return (
      athleteMembers.find((m) => m.membershipId === activeTeam?.myMembershipId) ||
      athleteMembers[0] ||
      null
    );
  }
  return (
    athleteMembers.find((m) => m.membershipId === selectedAthleteMembershipId) ||
    athleteMembers[0] ||
    null
  );
}

export interface DirectThreadSummary {
  membershipId: string;
  athleteName: string;
  preview: string;
  createdAt: string;
  count: number;
}

export function buildDirectThreadsSummary(params: {
  isStaff: boolean;
  teamMessages: TeamMessageRecord[];
  athleteMembers: TeamMembershipRecord[];
}): DirectThreadSummary[] {
  if (!params.isStaff) return [];
  const byMemId = new Map<string, DirectThreadSummary>();
  for (const msg of params.teamMessages) {
    if (msg.channelScope !== 'DIRECT_TRANSPARENT' || !msg.targetMembershipId) continue;
    const member = params.athleteMembers.find((m) => m.membershipId === msg.targetMembershipId);
    const prev = byMemId.get(msg.targetMembershipId);
    const count = (prev?.count || 0) + 1;
    if (!prev || msg.createdAt > prev.createdAt) {
      byMemId.set(msg.targetMembershipId, {
        membershipId: msg.targetMembershipId,
        athleteName: member?.invitedName || msg.targetAthleteName || msg.senderName,
        preview: msg.body,
        createdAt: msg.createdAt,
        count,
      });
    } else {
      byMemId.set(msg.targetMembershipId, { ...prev, count });
    }
  }
  return Array.from(byMemId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function isLocalHourInQuietHours(policy: TeamMessagingPolicy, localHour: number): boolean {
  return policy.quietHoursStartHour > policy.quietHoursEndHour
    ? localHour >= policy.quietHoursStartHour || localHour < policy.quietHoursEndHour
    : policy.quietHoursStartHour < policy.quietHoursEndHour &&
        localHour >= policy.quietHoursStartHour &&
        localHour < policy.quietHoursEndHour;
}

export function filterVisibleTeamMessages(params: {
  teamMessages: TeamMessageRecord[];
  isStaff: boolean;
  myRole?: TeamSummaryWithRole['myRole'];
  activeScope: TeamMessageChannelScope;
  selectedGroup: CoachEventGroup;
  resolvedSubgroupId: string;
  resolvedDirectAthlete: TeamMembershipRecord | null;
}): TeamMessageRecord[] {
  const {
    teamMessages,
    isStaff,
    myRole,
    activeScope,
    selectedGroup,
    resolvedSubgroupId,
    resolvedDirectAthlete,
  } = params;
  return teamMessages
    .filter((m) => {
      if (!isStaff && m.channelScope === 'COACHES_STAFF') return false;
      if (myRole === 'ATHLETE' && m.channelScope === 'PARENTS_ONLY') return false;
      if (m.channelScope !== activeScope) return false;
      if (activeScope === 'EVENT_GROUP') return !m.eventGroup || m.eventGroup === selectedGroup;
      if (activeScope === 'CUSTOM_SUBGROUP') {
        return !resolvedSubgroupId || m.customSubgroupId === resolvedSubgroupId;
      }
      if (activeScope === 'DIRECT_TRANSPARENT') {
        return !resolvedDirectAthlete || m.targetMembershipId === resolvedDirectAthlete.membershipId;
      }
      return true;
    })
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function filterVisibleQueuedOutboxMessages(params: {
  queuedOfflineMessages: QueuedChatOutboxMessage[];
  activeTeamId: string | undefined;
  activeScope: TeamMessageChannelScope;
  selectedGroup: CoachEventGroup;
  resolvedSubgroupId: string;
  resolvedDirectAthlete: TeamMembershipRecord | null;
}): QueuedChatOutboxMessage[] {
  const {
    queuedOfflineMessages,
    activeTeamId,
    activeScope,
    selectedGroup,
    resolvedSubgroupId,
    resolvedDirectAthlete,
  } = params;
  return queuedOfflineMessages.filter(
    (q) =>
      Boolean(activeTeamId) &&
      q.teamId === activeTeamId &&
      q.channelScope === activeScope &&
      (activeScope !== 'EVENT_GROUP' || q.eventGroup === selectedGroup) &&
      (activeScope !== 'CUSTOM_SUBGROUP' ||
        !resolvedSubgroupId ||
        q.customSubgroupId === resolvedSubgroupId) &&
      (activeScope !== 'DIRECT_TRANSPARENT' ||
        !resolvedDirectAthlete ||
        q.targetMembershipId === resolvedDirectAthlete.membershipId)
  );
}

export function buildLocalDemoTeamMessage(params: {
  activeTeam: TeamSummaryWithRole;
  activeScope: TeamMessageChannelScope;
  selectedGroup: CoachEventGroup;
  activeSubgroup?: TeamCustomSubgroup;
  resolvedDirectAthlete: TeamMembershipRecord | null;
  isStaff: boolean;
  body: string;
  policy: TeamMessagingPolicy;
  isQuietHours: boolean;
  emergencyOverride: boolean;
}): TeamMessageRecord {
  const {
    activeTeam,
    activeScope,
    selectedGroup,
    activeSubgroup,
    resolvedDirectAthlete,
    isStaff,
    body,
    policy,
    isQuietHours,
    emergencyOverride,
  } = params;
  const targetMem = activeScope === 'DIRECT_TRANSPARENT' ? resolvedDirectAthlete : null;
  return {
    id: `msg-local-${Date.now()}`,
    teamId: activeTeam.brand.teamId,
    channelId:
      activeScope === 'ALL_TEAM'
        ? 'team:all'
        : activeScope === 'PARENTS_ONLY'
          ? 'parents'
          : activeScope === 'CUSTOM_SUBGROUP'
            ? `subgroup:${activeSubgroup?.id || 'custom'}`
            : activeScope === 'COACHES_STAFF'
              ? 'staff:only'
              : activeScope === 'EVENT_GROUP'
                ? `group:${selectedGroup}`
                : `dm:${targetMem?.membershipId || 'self'}`,
    channelScope: activeScope,
    ...(activeScope === 'EVENT_GROUP' ? { eventGroup: selectedGroup } : {}),
    ...(activeSubgroup
      ? { customSubgroupId: activeSubgroup.id, customSubgroupName: activeSubgroup.name }
      : {}),
    ...(targetMem
      ? { targetMembershipId: targetMem.membershipId, targetAthleteName: targetMem.invitedName }
      : {}),
    senderSid: 'local-user',
    senderMembershipId: activeTeam.myMembershipId,
    senderName: isStaff ? activeTeam.brand.coachDisplayName : 'Sample Athlete',
    senderRole: isStaff ? activeTeam.myRole : 'ATHLETE',
    body,
    createdAt: new Date().toISOString(),
    guardianCcApplied: activeScope !== 'COACHES_STAFF' && policy.requireGuardianCcForMinors,
    secondAdultVisible: true,
    ...(isQuietHours && !emergencyOverride ? { sentDuringQuietHours: true } : {}),
    ...(emergencyOverride ? { isEmergencyOverride: true } : {}),
    acknowledgedByMembershipIds: [activeTeam.myMembershipId],
  };
}

export function downloadMessagingAuditCsv(activeTeam: TeamSummaryWithRole): void {
  const rows = [
    [
      'CreatedAt',
      'Channel',
      'Sender',
      'Role',
      'Target',
      'GuardianCC',
      'QuietHours',
      'Flagged',
      'Message',
    ].join(','),
    ...(activeTeam.teamMessages || []).map((m) =>
      [
        sanitizeCsvCell(m.createdAt),
        sanitizeCsvCell(m.channelId),
        sanitizeCsvCell(m.senderName),
        sanitizeCsvCell(m.senderRole),
        sanitizeCsvCell(m.targetAthleteName || ''),
        sanitizeCsvCell(m.guardianCcApplied ? 'YES' : 'NO'),
        sanitizeCsvCell(m.sentDuringQuietHours ? 'YES' : 'NO'),
        sanitizeCsvCell(m.flaggedForAdminReview ? 'FLAGGED' : 'OK'),
        sanitizeCsvCell(m.body),
      ].join(',')
    ),
  ].join('\n');
  const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${activeTeam.brand.slug}-safesport-messages-audit.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
