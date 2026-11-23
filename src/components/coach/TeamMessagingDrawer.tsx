import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useModalDialog } from '../../hooks/useModalDialog';
import {
  AlertTriangle,
  Bell,
  BellRinging,
  Check,
  Download,
  Flag,
  Lock,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldCheck,
  WifiOff,
  X,
} from '../icons/PhosphorIcons';
import { COACH_EVENT_GROUP_OPTIONS } from '../../physiology/teamOnboardingEngine';
import {
  acknowledgeTeamMessageApi,
  flagTeamMessageApi,
  postTeamMessageApi,
  TeamLifecycleApiError,
  updateTeamMessagingPolicyApi,
} from '../../utils/teamLifecycleApi';
import {
  fetchPushStatus,
  isIosStandaloneHintNeeded,
  sendTestWebPush,
  subscribeToThreshWebPush,
  unsubscribeFromThreshWebPush,
} from '../../utils/pushNotificationsClient';
import type {
  CoachEventGroup,
  TeamMessageChannelScope,
  TeamMessageRecord,
  TeamMessagingPolicy,
  TeamSummaryWithRole,
} from '../../types';

export interface TeamMessagingDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeTeam: TeamSummaryWithRole | null;
  myTeams: TeamSummaryWithRole[];
  onTeamsUpdated: (teams: TeamSummaryWithRole[], activeTeamId?: string) => void;
  viewerMode?: 'ATHLETE' | 'COACH';
  initialScope?: TeamMessageChannelScope;
}

const COACH_QUICK_TEMPLATES = [
  'Meet bus departs 2:30 PM from North Gate. Bring spikes & warmups.',
  'Lightning Shelter: All groups move inside main gym immediately.',
  'Hydration check + bring extra water & warmup jersey today.',
  'Great work today! Log a 10-second soreness check-in tonight.',
];

function formatMsgTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso.slice(11, 16);
  }
}

function sanitizeCsvCell(raw: unknown): string {
  const s = String(raw ?? '').replace(/[\r\n"]/g, ' ').trim();
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe}"`;
}

interface QueuedOfflineTeamMessage {
  localId: string;
  teamId: string;
  channelScope: TeamMessageChannelScope;
  eventGroup?: CoachEventGroup;
  targetMembershipId?: string;
  body: string;
  clientLocalHour: number;
  isEmergencyOverride: boolean;
  createdAt: string;
}

export const TeamMessagingDrawer: React.FC<TeamMessagingDrawerProps> = ({
  isOpen,
  onClose,
  activeTeam,
  myTeams,
  onTeamsUpdated,
  viewerMode = 'ATHLETE',
  initialScope = 'ALL_TEAM',
}) => {
  const [activeScope, setActiveScope] = useState<TeamMessageChannelScope>(initialScope);
  const [selectedGroup, setSelectedGroup] = useState<CoachEventGroup>('SPRINTS');
  const [selectedAthleteMembershipId, setSelectedAthleteMembershipId] = useState<string>('');
  const [draftBody, setDraftBody] = useState<string>('');
  const [emergencyOverride, setEmergencyOverride] = useState<boolean>(false);
  const [sending, setSending] = useState<boolean>(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusInfo, setStatusInfo] = useState<string | null>(null);
  const [queuedOfflineMessages, setQueuedOfflineMessages] = useState<QueuedOfflineTeamMessage[]>([]);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState<boolean>(false);
  const [pushCount, setPushCount] = useState<number>(0);
  const [pushLoading, setPushLoading] = useState<boolean>(false);
  const [pushNotice, setPushNotice] = useState<string | null>(null);
  const [pushPanelExpanded, setPushPanelExpanded] = useState<boolean>(false);
  const iosStandaloneNeeded = useMemo(() => isIosStandaloneHintNeeded(), []);
  const isSampleDemo = Boolean(
    activeTeam?.brand.teamId.startsWith('demo_team_') ||
      activeTeam?.brand.teamId.startsWith('demo-team-')
  );
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const headingId = useId();

  useModalDialog({
    isOpen: Boolean(isOpen && activeTeam),
    onClose,
    dialogRef,
  });

  useEffect(() => {
    if (!isOpen || isSampleDemo) return;
    let cancelled = false;
    void fetchPushStatus().then((status) => {
      if (cancelled) return;
      setPushEnabled(status.permission === 'granted' && status.subscriptionCount > 0);
      setPushCount(status.subscriptionCount);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, isSampleDemo]);

  const isStaff = Boolean(
    activeTeam &&
      viewerMode === 'COACH' &&
      (activeTeam.myRole === 'HEAD_COACH' ||
        activeTeam.myRole === 'ASSISTANT_COACH' ||
        activeTeam.myRole === 'ATHLETIC_TRAINER' ||
        activeTeam.myRole === 'ORG_ADMIN')
  );
  const canManagePolicy = Boolean(
    activeTeam &&
      viewerMode === 'COACH' &&
      (activeTeam.myRole === 'HEAD_COACH' || activeTeam.myRole === 'ORG_ADMIN')
  );

  const policy: TeamMessagingPolicy = useMemo(
    () =>
      activeTeam?.messagingPolicy || {
        athleteRepliesEnabled: true,
        quietHoursStartHour: 21,
        quietHoursEndHour: 6,
        requireGuardianCcForMinors: Boolean(
          activeTeam?.brand.orgType === 'HIGH_SCHOOL' || activeTeam?.brand.defaultSafeSportShield
        ),
      },
    [activeTeam]
  );

  const athleteMembers = useMemo(
    () => (activeTeam?.memberships || []).filter((m) => m.role === 'ATHLETE' && m.status !== 'REVOKED'),
    [activeTeam?.memberships]
  );

  const resolvedDirectAthlete = useMemo(() => {
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
  }, [
    activeTeam?.myLinkedChildMembershipIds,
    activeTeam?.myMembershipId,
    activeTeam?.myRole,
    athleteMembers,
    isStaff,
    selectedAthleteMembershipId,
  ]);

  const directThreads = useMemo(() => {
    if (!isStaff) return [];
    const byMemId = new Map<
      string,
      { membershipId: string; athleteName: string; preview: string; createdAt: string; count: number }
    >();
    for (const msg of activeTeam?.teamMessages || []) {
      if (msg.channelScope !== 'DIRECT_TRANSPARENT' || !msg.targetMembershipId) continue;
      const member = athleteMembers.find((m) => m.membershipId === msg.targetMembershipId);
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
  }, [activeTeam?.teamMessages, athleteMembers, isStaff]);

  const localHour = new Date().getHours();
  const isQuietHours =
    policy.quietHoursStartHour > policy.quietHoursEndHour
      ? localHour >= policy.quietHoursStartHour || localHour < policy.quietHoursEndHour
      : policy.quietHoursStartHour < policy.quietHoursEndHour &&
        localHour >= policy.quietHoursStartHour &&
        localHour < policy.quietHoursEndHour;

  const visibleMessages = useMemo(() => {
    const all = activeTeam?.teamMessages || [];
    return all
      .filter((m) => {
        if (!isStaff && m.channelScope === 'COACHES_STAFF') return false;
        if (m.channelScope !== activeScope) return false;
        if (activeScope === 'EVENT_GROUP') return !m.eventGroup || m.eventGroup === selectedGroup;
        if (activeScope === 'DIRECT_TRANSPARENT') {
          return !resolvedDirectAthlete || m.targetMembershipId === resolvedDirectAthlete.membershipId;
        }
        return true;
      })
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [activeScope, activeTeam?.teamMessages, isStaff, resolvedDirectAthlete, selectedGroup]);

  const visibleQueuedMessages = useMemo(
    () =>
      queuedOfflineMessages.filter(
        (q) =>
          activeTeam &&
          q.teamId === activeTeam.brand.teamId &&
          q.channelScope === activeScope &&
          (activeScope !== 'EVENT_GROUP' || q.eventGroup === selectedGroup) &&
          (activeScope !== 'DIRECT_TRANSPARENT' ||
            !resolvedDirectAthlete ||
            q.targetMembershipId === resolvedDirectAthlete.membershipId)
      ),
    [activeScope, activeTeam, queuedOfflineMessages, resolvedDirectAthlete, selectedGroup]
  );

  if (!isOpen || !activeTeam) return null;

  const applyUpdatedTeam = (updated: TeamSummaryWithRole) => {
    onTeamsUpdated(
      myTeams.map((t) => (t.brand.teamId === updated.brand.teamId ? updated : t)),
      updated.brand.teamId
    );
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = draftBody.trim();
    if (!clean) return;
    setStatusError(null);
    setStatusInfo(null);

    if (!isStaff && (activeScope === 'ALL_TEAM' || activeScope === 'EVENT_GROUP') && !policy.athleteRepliesEnabled) {
      setStatusError(
        'Team channels are set to Coach Announcements Only. Use Direct (SafeSport CC) to message coaching staff.'
      );
      return;
    }

    const fallbackLocalSend = () => {
      const targetMem = activeScope === 'DIRECT_TRANSPARENT' ? resolvedDirectAthlete : null;
      const newMsg: TeamMessageRecord = {
        id: `msg-local-${Date.now()}`,
        teamId: activeTeam.brand.teamId,
        channelId:
          activeScope === 'ALL_TEAM'
            ? 'team:all'
            : activeScope === 'COACHES_STAFF'
              ? 'staff:only'
              : activeScope === 'EVENT_GROUP'
                ? `group:${selectedGroup}`
                : `dm:${targetMem?.membershipId || 'self'}`,
        channelScope: activeScope,
        ...(activeScope === 'EVENT_GROUP' ? { eventGroup: selectedGroup } : {}),
        ...(targetMem ? { targetMembershipId: targetMem.membershipId, targetAthleteName: targetMem.invitedName } : {}),
        senderSid: 'local-user',
        senderMembershipId: activeTeam.myMembershipId,
        senderName: isStaff ? activeTeam.brand.coachDisplayName : 'Sample Athlete',
        senderRole: isStaff ? activeTeam.myRole : 'ATHLETE',
        body: clean,
        createdAt: new Date().toISOString(),
        guardianCcApplied: activeScope !== 'COACHES_STAFF' && policy.requireGuardianCcForMinors,
        secondAdultVisible: true,
        ...(isQuietHours && !emergencyOverride ? { sentDuringQuietHours: true } : {}),
        ...(emergencyOverride ? { isEmergencyOverride: true } : {}),
        acknowledgedByMembershipIds: [activeTeam.myMembershipId],
      };
      applyUpdatedTeam({
        ...activeTeam,
        teamMessages: [newMsg, ...(activeTeam.teamMessages || [])].slice(0, 500),
      });
      setDraftBody('');
      setStatusInfo(
        activeScope === 'DIRECT_TRANSPARENT'
          ? 'Sent with SafeSport Guardian & Staff CC ✓'
          : 'Message sent ✓'
      );
    };

    if (isSampleDemo) {
      fallbackLocalSend();
      return;
    }

    const queueOffline = () => {
      const queuedItem: QueuedOfflineTeamMessage = {
        localId: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        teamId: activeTeam.brand.teamId,
        channelScope: activeScope,
        eventGroup: activeScope === 'EVENT_GROUP' ? selectedGroup : undefined,
        targetMembershipId:
          activeScope === 'DIRECT_TRANSPARENT'
            ? resolvedDirectAthlete?.membershipId
            : undefined,
        body: clean,
        clientLocalHour: localHour,
        isEmergencyOverride: emergencyOverride,
        createdAt: new Date().toISOString(),
      };
      setQueuedOfflineMessages((prev) => [...prev, queuedItem]);
      setDraftBody('');
    };

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      queueOffline();
      return;
    }

    setSending(true);
    try {
      const resp = await postTeamMessageApi({
        teamId: activeTeam.brand.teamId,
        channelScope: activeScope,
        eventGroup: activeScope === 'EVENT_GROUP' ? selectedGroup : undefined,
        targetMembershipId: activeScope === 'DIRECT_TRANSPARENT' ? resolvedDirectAthlete?.membershipId : undefined,
        body: clean,
        guardianCc: true,
        clientLocalHour: localHour,
        isEmergencyOverride: emergencyOverride,
      });
      if (resp.teams && resp.teams.length > 0) {
        onTeamsUpdated(resp.teams, activeTeam.brand.teamId);
      } else if (resp.team) {
        applyUpdatedTeam(resp.team);
      }
      setDraftBody('');
      setStatusInfo('Message delivered ✓');
    } catch (err) {
      if (err instanceof TeamLifecycleApiError) {
        setStatusError(err.message);
      } else {
        queueOffline();
      }
    } finally {
      setSending(false);
    }
  };

  const handleRetryQueuedMessage = async (item: QueuedOfflineTeamMessage) => {
    setStatusError(null);
    setStatusInfo(null);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setStatusError('Still offline — reconnect to deliver queued message.');
      return;
    }
    setRetryingId(item.localId);
    try {
      const resp = await postTeamMessageApi({
        teamId: item.teamId,
        channelScope: item.channelScope,
        eventGroup: item.eventGroup,
        targetMembershipId: item.targetMembershipId,
        body: item.body,
        guardianCc: true,
        clientLocalHour: item.clientLocalHour,
        isEmergencyOverride: item.isEmergencyOverride,
      });
      if (resp.teams && resp.teams.length > 0) {
        onTeamsUpdated(resp.teams, item.teamId);
      } else if (resp.team) {
        applyUpdatedTeam(resp.team);
      }
      setQueuedOfflineMessages((prev) => prev.filter((q) => q.localId !== item.localId));
      setStatusInfo('Message delivered ✓');
    } catch (err) {
      if (err instanceof TeamLifecycleApiError) {
        setStatusError(err.message);
      } else {
        setStatusError('Network error — queued message could not be delivered yet.');
      }
    } finally {
      setRetryingId(null);
    }
  };

  const handleAck = async (msgId: string) => {
    setStatusError(null);
    const localAck = () => {
      applyUpdatedTeam({
        ...activeTeam,
        teamMessages: (activeTeam.teamMessages || []).map((m) =>
          m.id === msgId
            ? {
                ...m,
                acknowledgedByMembershipIds: Array.from(
                  new Set([...(m.acknowledgedByMembershipIds || []), activeTeam.myMembershipId])
                ),
              }
            : m
        ),
      });
    };
    if (isSampleDemo) {
      localAck();
      return;
    }
    try {
      const resp = await acknowledgeTeamMessageApi({ teamId: activeTeam.brand.teamId, messageId: msgId });
      if (resp.teams && resp.teams.length > 0) onTeamsUpdated(resp.teams, activeTeam.brand.teamId);
      else if (resp.team) applyUpdatedTeam(resp.team);
    } catch (err) {
      setStatusError(
        err instanceof TeamLifecycleApiError
          ? err.message
          : 'Offline — acknowledgement not saved. Reconnect and try again.'
      );
    }
  };

  const handleFlag = async (msgId: string) => {
    setStatusError(null);
    const localFlag = () => {
      applyUpdatedTeam({
        ...activeTeam,
        teamMessages: (activeTeam.teamMessages || []).map((m) =>
          m.id === msgId ? { ...m, flaggedForAdminReview: true } : m
        ),
      });
      setStatusInfo('Flagged for Athletic Administrator review.');
    };
    if (isSampleDemo) {
      localFlag();
      return;
    }
    try {
      const resp = await flagTeamMessageApi({ teamId: activeTeam.brand.teamId, messageId: msgId });
      if (resp.teams && resp.teams.length > 0) onTeamsUpdated(resp.teams, activeTeam.brand.teamId);
      else if (resp.team) applyUpdatedTeam(resp.team);
      setStatusInfo('Flagged for Athletic Administrator review.');
    } catch (err) {
      setStatusError(
        err instanceof TeamLifecycleApiError
          ? err.message
          : 'Offline — message flag not saved. Reconnect and try again.'
      );
    }
  };

  const handleToggleAthleteReplies = async () => {
    setStatusError(null);
    const nextVal = !policy.athleteRepliesEnabled;
    const localUpdate = () => {
      applyUpdatedTeam({ ...activeTeam, messagingPolicy: { ...policy, athleteRepliesEnabled: nextVal } });
    };
    if (isSampleDemo) {
      localUpdate();
      return;
    }
    try {
      const resp = await updateTeamMessagingPolicyApi({
        teamId: activeTeam.brand.teamId,
        athleteRepliesEnabled: nextVal,
      });
      if (resp.teams && resp.teams.length > 0) onTeamsUpdated(resp.teams, activeTeam.brand.teamId);
      else if (resp.team) applyUpdatedTeam(resp.team);
    } catch (err) {
      setStatusError(
        err instanceof TeamLifecycleApiError
          ? err.message
          : 'Offline — messaging policy update failed. Reconnect and try again.'
      );
    }
  };

  const handleExportAuditCsv = () => {
    const rows = [
      ['CreatedAt', 'Channel', 'Sender', 'Role', 'Target', 'GuardianCC', 'QuietHours', 'Flagged', 'Message'].join(','),
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
  };

  const handleToggleDevicePush = async () => {
    setPushLoading(true);
    setPushNotice(null);
    setStatusError(null);
    try {
      if (pushEnabled) {
        if (!isSampleDemo) {
          await unsubscribeFromThreshWebPush();
        }
        setPushEnabled(false);
        setPushCount(0);
        setPushNotice('Device push alerts paused for this browser.');
      } else {
        const res = await subscribeToThreshWebPush({
          muteQuietHours: true,
          isSampleDemoMode: isSampleDemo,
        });
        if (!res.ok) {
          setStatusError(res.error || 'Unable to enable device push alerts.');
        } else {
          setPushEnabled(true);
          setPushCount(res.subscriptionCount || 1);
          setPushNotice(
            res.demoLocalOnly
              ? 'Demo Push Alerts active (sign in on a live team to sync Web Push to phones).'
              : 'Device push alerts enabled for messages, comments & weather alerts.'
          );
        }
      }
    } finally {
      setPushLoading(false);
    }
  };

  const handleSendTestPush = async () => {
    setPushLoading(true);
    setStatusError(null);
    try {
      const res = await sendTestWebPush();
      if (!res.ok) {
        setStatusError(res.error || 'Could not send test push alert.');
      } else {
        setPushNotice(`Test notification dispatched to ${res.deliveredCount || 1} device(s).`);
      }
    } finally {
      setPushLoading(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      tabIndex={-1}
      data-testid="team-messaging-drawer"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-stretch justify-end bg-black/60"
    >
      <div className="w-full max-w-xl h-full max-h-[92dvh] sm:max-h-none overflow-y-auto rounded-t-2xl sm:rounded-none bg-white dark:bg-ap-obsidian text-ap-ink dark:text-ap-chalk border-l border-ap-edge flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-4 py-3 border-b border-ap-frame/15 dark:border-ap-edge-dark flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 ap-text-brand shrink-0" />
              <h2 id={headingId} className="text-sm sm:text-base font-extrabold truncate">
                {activeTeam.brand.shortName || activeTeam.brand.name} · Team Messaging
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-2xs font-mono">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full ap-status-prime font-bold">
                <ShieldCheck className="w-3 h-3" /> SafeSport MAAPP Two-Adult CC
              </span>
              {canManagePolicy && (
                <>
                  <button
                    type="button"
                    data-testid="messaging-policy-replies-toggle"
                    onClick={() => void handleToggleAthleteReplies()}
                    className="px-2 py-0.5 rounded-full ap-card-inset font-semibold cursor-pointer"
                  >
                    {policy.athleteRepliesEnabled ? 'Replies: ON' : 'Broadcast Only'}
                  </button>
                  <button
                    type="button"
                    data-testid="messaging-export-csv-btn"
                    onClick={handleExportAuditCsv}
                    className="px-2 py-0.5 rounded-full ap-card-inset font-semibold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Download className="w-3 h-3" /> Audit CSV
                  </button>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Team Messaging"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-xl ap-card-inset inline-flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Device Push Alerts Bar (expanded until enabled, then compact pill to maximize chat height) */}
        {(!pushEnabled || pushPanelExpanded) ? (
          <div className="px-4 py-2 border-b border-ap-frame/15 dark:border-ap-edge-dark ap-card-inset flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 space-y-0.5 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-ap-ink dark:text-ap-chalk">
                {pushEnabled ? (
                  <BellRinging className="w-4 h-4 ap-text-brand shrink-0" weight="fill" />
                ) : (
                  <Bell className="w-4 h-4 text-ap-muted dark:text-ap-muted-dark shrink-0" />
                )}
                <span>Device Push Notifications</span>
                {pushEnabled && (
                  <span className="px-2 py-0.5 rounded-full ap-status-prime text-2xs font-mono font-bold">
                    ON{pushCount > 1 ? ` (${pushCount})` : ''}
                  </span>
                )}
              </div>
              <p className="text-2xs text-ap-muted dark:text-ap-muted-dark leading-snug">
                {pushNotice ||
                  (iosStandaloneNeeded
                    ? 'iPhone/iPad: tap Share → Add to Home Screen first to enable lock-screen alerts.'
                    : 'Get instant alerts for coach messages, workout notes & lightning weather.')}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {pushEnabled && !isSampleDemo && (
                <button
                  type="button"
                  disabled={pushLoading}
                  data-testid="send-test-push-btn"
                  onClick={() => void handleSendTestPush()}
                  className="min-h-[44px] px-3 py-1.5 rounded-xl ap-btn-secondary text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  Test Alert
                </button>
              )}
              <button
                type="button"
                disabled={pushLoading}
                data-testid="toggle-device-push-btn"
                aria-pressed={pushEnabled}
                onClick={() => void handleToggleDevicePush()}
                className={`min-h-[44px] px-3.5 py-1.5 rounded-xl text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                  pushEnabled ? 'ap-nav-volt-active' : 'ap-btn-primary'
                }`}
              >
                {pushEnabled ? (
                  <BellRinging className="w-4 h-4" weight="bold" />
                ) : (
                  <Bell className="w-4 h-4" weight="bold" />
                )}
                <span>{pushLoading ? 'Updating…' : pushEnabled ? 'Push Alerts ON' : 'Enable Device Push'}</span>
              </button>
              {pushEnabled && (
                <button
                  type="button"
                  onClick={() => setPushPanelExpanded(false)}
                  className="min-h-[36px] px-2 rounded-lg text-2xs font-mono text-ap-muted dark:text-ap-muted-dark cursor-pointer"
                >
                  Hide
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="px-4 py-1.5 border-b border-ap-frame/15 dark:border-ap-edge-dark flex items-center justify-between gap-2 text-2xs">
            <span className="inline-flex items-center gap-1.5 font-mono font-semibold text-ap-muted dark:text-ap-muted-dark">
              <BellRinging className="w-3.5 h-3.5 ap-text-brand" weight="fill" />
              <span>Device Push Alerts</span>
            </span>
            <button
              type="button"
              data-testid="toggle-device-push-btn"
              aria-pressed={true}
              onClick={() => setPushPanelExpanded(true)}
              className="px-2.5 py-1 rounded-lg ap-status-prime font-mono font-bold inline-flex items-center gap-1 cursor-pointer"
            >
              <span>Push Alerts ON{pushCount > 1 ? ` (${pushCount})` : ''}</span>
              <span className="opacity-75">· Manage</span>
            </button>
          </div>
        )}

        {/* Channel Rail */}
        <div className="px-4 py-2 border-b border-ap-frame/15 dark:border-ap-edge-dark flex flex-wrap items-center gap-1.5" role="tablist">
          {(
            [
              { id: 'ALL_TEAM', label: 'Whole Team', testId: 'msg-channel-all', show: true },
              { id: 'EVENT_GROUP', label: 'Event Group', testId: 'msg-channel-group', show: true },
              { id: 'COACHES_STAFF', label: 'Coaches & Staff', testId: 'msg-channel-staff', show: isStaff },
              { id: 'DIRECT_TRANSPARENT', label: 'Direct (SafeSport CC)', testId: 'msg-channel-direct', show: true },
            ] as const
          )
            .filter((c) => c.show)
            .map((ch) => {
              const active = activeScope === ch.id;
              return (
                <button
                  key={ch.id}
                  type="button"
                  role="tab"
                  data-testid={ch.testId}
                  aria-selected={active}
                  onClick={() => {
                    setActiveScope(ch.id);
                    setStatusError(null);
                  }}
                  className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl text-xs font-bold cursor-pointer ${
                    active ? 'ap-nav-volt-active' : 'liquid-capsule-track text-ap-ink dark:text-ap-chalk'
                  }`}
                >
                  {ch.label}
                </button>
              );
            })}
        </div>

        {/* Sub-selector bar for Event Group or Transparent Direct Thread */}
        {activeScope === 'EVENT_GROUP' && (
          <div className="px-4 py-2 bg-ap-card-inset/50 flex items-center gap-2 text-xs border-b border-ap-frame/10 dark:border-ap-edge-dark">
            <span className="font-mono text-2xs uppercase text-ap-muted dark:text-ap-muted-dark">Group:</span>
            <select
              aria-label="Select Event Group Channel"
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value as CoachEventGroup)}
              className="min-h-[38px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-xs font-semibold"
            >
              {COACH_EVENT_GROUP_OPTIONS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.shortLabel}
                </option>
              ))}
            </select>
          </div>
        )}

        {activeScope === 'DIRECT_TRANSPARENT' && (
          <div
            data-testid="msg-safesport-cc-banner"
            className="px-4 py-2 bg-emerald-500/10 border-b border-emerald-500/25 space-y-2 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-emerald-800 dark:text-emerald-300 inline-flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" />
                Zero-Secret-DM Rule Active: Head Coach &amp; Parent/Guardian CC&apos;d
              </span>
              {isStaff && athleteMembers.length > 0 && (
                <select
                  aria-label="Select Athlete for SafeSport Thread"
                  value={resolvedDirectAthlete?.membershipId || ''}
                  onChange={(e) => setSelectedAthleteMembershipId(e.target.value)}
                  className="min-h-[38px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 text-xs font-semibold"
                >
                  {athleteMembers.map((m) => (
                    <option key={m.membershipId} value={m.membershipId}>
                      {m.invitedName}
                      {m.parentGuardianEmail ? ' (Guardian Email CC)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {isStaff && directThreads.length > 0 && (
              <div
                data-testid="msg-active-threads-inbox"
                className="flex flex-wrap items-center gap-1.5"
              >
                <span className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark mr-1">
                  Active Threads:
                </span>
                {directThreads.slice(0, 6).map((thr) => {
                  const isSel = resolvedDirectAthlete?.membershipId === thr.membershipId;
                  return (
                    <button
                      key={thr.membershipId}
                      type="button"
                      onClick={() => setSelectedAthleteMembershipId(thr.membershipId)}
                      className={`min-h-[32px] px-2.5 py-0.5 rounded-full text-2xs font-semibold cursor-pointer truncate max-w-[200px] ${
                        isSel
                          ? 'ap-nav-volt-active'
                          : 'bg-white dark:bg-ap-carbon border border-ap-frame/20 dark:border-ap-edge-dark text-ap-ink dark:text-ap-chalk'
                      }`}
                    >
                      {thr.athleteName} ({thr.count})
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Quiet Hours Banner */}
        {isQuietHours && (
          <div className="px-4 py-1.5 bg-amber-500/15 border-b border-amber-500/30 flex flex-wrap items-center justify-between gap-2 text-2xs font-mono text-amber-900 dark:text-amber-200">
            <span className="inline-flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              Quiet Hours ({policy.quietHoursStartHour}:00–{policy.quietHoursEndHour}:00): avoid non-urgent texts.
            </span>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                data-testid="msg-emergency-override"
                checked={emergencyOverride}
                onChange={(e) => setEmergencyOverride(e.target.checked)}
              />
              <span>Emergency / Weather Override</span>
            </label>
          </div>
        )}

        {/* Messages Feed */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
          {visibleMessages.length === 0 && visibleQueuedMessages.length === 0 ? (
            <div className="rounded-xl ap-card-inset p-4 text-xs text-ap-muted dark:text-ap-muted-dark">
              No messages in this channel yet. Post a meet reminder or practice note below.
            </div>
          ) : (
            visibleMessages.map((msg) => {
              const ackCount = msg.acknowledgedByMembershipIds?.length || 0;
              const alreadyAcked = msg.acknowledgedByMembershipIds?.includes(activeTeam.myMembershipId);
              return (
                <div
                  key={msg.id}
                  data-testid={`team-msg-item-${msg.id}`}
                  className={`rounded-xl border px-3 py-2.5 space-y-1.5 text-xs ${
                    msg.flaggedForAdminReview
                      ? 'border-rose-500/40 bg-rose-500/10'
                      : 'border-ap-frame/15 dark:border-ap-edge-dark ap-card-inset'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-2xs font-mono">
                    <span className="font-bold text-ap-ink dark:text-ap-chalk">
                      {msg.senderName}{' '}
                      <span className="text-ap-muted dark:text-ap-muted-dark font-normal">
                        ({activeTeam.memberships.find((m) => m.membershipId === msg.senderMembershipId)?.coachSpecialtyTitle || msg.senderRole})
                      </span>
                      {msg.targetAthleteName ? ` → ${msg.targetAthleteName}` : ''}
                    </span>
                    <div className="flex flex-wrap items-center gap-1">
                      {msg.guardianCcApplied && (
                        <span className="px-1.5 py-0.5 rounded ap-status-info">Guardian CC ✓</span>
                      )}
                      {msg.isEmergencyOverride && (
                        <span className="px-1.5 py-0.5 rounded ap-status-caution">Emergency</span>
                      )}
                      {msg.flaggedForAdminReview && (
                        <span className="px-1.5 py-0.5 rounded ap-status-strained">Flagged</span>
                      )}
                      <span className="text-ap-muted dark:text-ap-muted-dark">
                        {formatMsgTimestamp(msg.createdAt)}
                      </span>
                    </div>
                  </div>
                  <p className="text-ap-ink dark:text-ap-chalk leading-snug">{msg.body}</p>
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <button
                      type="button"
                      data-testid={`msg-ack-btn-${msg.id}`}
                      onClick={() => void handleAck(msg.id)}
                      className={`min-h-[34px] px-2.5 py-0.5 rounded-lg text-2xs font-mono font-semibold inline-flex items-center gap-1 cursor-pointer ${
                        alreadyAcked
                          ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                          : 'bg-white dark:bg-ap-carbon border border-ap-frame/20 dark:border-ap-edge-dark'
                      }`}
                    >
                      <Check className="w-3 h-3" />
                      <span>Got It ({ackCount})</span>
                    </button>
                    {!msg.flaggedForAdminReview && (
                      <button
                        type="button"
                        data-testid={`msg-flag-btn-${msg.id}`}
                        onClick={() => void handleFlag(msg.id)}
                        className="min-h-[34px] px-2 py-0.5 rounded-lg text-2xs font-mono text-ap-muted dark:text-ap-muted-dark hover:text-rose-500 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Flag className="w-3 h-3" />
                        <span>Flag</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
          {visibleQueuedMessages.map((q) => (
              <div
                key={q.localId}
                data-testid={`team-msg-queued-${q.localId}`}
                className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 space-y-1.5 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-2xs font-mono">
                  <span className="inline-flex items-center gap-1 font-bold text-amber-900 dark:text-amber-200">
                    <WifiOff className="w-3.5 h-3.5 shrink-0" />
                    <span>Queued offline — not delivered yet</span>
                  </span>
                  <button
                    type="button"
                    data-testid="team-msg-retry-btn"
                    disabled={retryingId === q.localId}
                    onClick={() => void handleRetryQueuedMessage(q)}
                    className="min-h-[34px] px-2.5 py-0.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>{retryingId === q.localId ? 'Retrying…' : 'Retry'}</span>
                  </button>
                </div>
                <p className="text-ap-ink dark:text-ap-chalk leading-snug">{q.body}</p>
              </div>
            ))}
        </div>

        {/* Composer */}
        <form onSubmit={(e) => void handleSend(e)} className="px-4 py-3 border-t border-ap-frame/15 dark:border-ap-edge-dark space-y-2">
          {isStaff && (
            <div className="flex flex-wrap gap-1">
              {COACH_QUICK_TEMPLATES.map((tpl) => (
                <button
                  key={tpl}
                  type="button"
                  onClick={() => setDraftBody(tpl)}
                  className="px-2 py-0.5 rounded-md ap-card-inset text-2xs text-ap-ink dark:text-ap-chalk hover:underline cursor-pointer truncate max-w-[200px]"
                >
                  {tpl}
                </button>
              ))}
            </div>
          )}

          {statusError && (
            <div role="alert" className="text-2xs font-mono text-rose-600 dark:text-rose-400">
              {statusError}
            </div>
          )}
          {statusInfo && (
            <div className="text-2xs font-mono text-emerald-600 dark:text-emerald-400">{statusInfo}</div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="text"
              data-testid="team-msg-input"
              aria-label="Message text"
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              placeholder={
                activeScope === 'DIRECT_TRANSPARENT'
                  ? 'Write a SafeSport transparent note (Guardian & Coach CC)...'
                  : 'Write an immutable, audited team message...'
              }
              className="flex-1 min-h-[44px] rounded-xl border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-3 text-xs text-ap-ink dark:text-ap-chalk"
            />
            <button
              type="submit"
              data-testid="team-msg-send-btn"
              disabled={sending || !draftBody.trim()}
              className="ap-btn-primary !min-h-[44px] px-4 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
