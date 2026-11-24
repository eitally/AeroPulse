import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useModalDialog } from '../../hooks/useModalDialog';
import {
  acknowledgeTeamMessageApi,
  deleteTeamCustomSubgroupApi,
  flagTeamMessageApi,
  postTeamMessageApi,
  TeamLifecycleApiError,
  updateTeamMessagingPolicyApi,
} from '../../utils/teamLifecycleApi';
import {
  enqueueChatOutboxMessage,
  flushChatOutbox,
  hydrateChatOutboxFromDexie,
  loadChatOutbox,
  removeChatOutboxMessage,
  type QueuedChatOutboxMessage,
} from '../../utils/chatOutbox';
import {
  copyTextToClipboardSafe,
  formatMessageForRemindOrParentSquare,
} from '../../utils/remindFormatter';
import {
  fetchPushStatus,
  isIosStandaloneHintNeeded,
  sendTestWebPush,
  subscribeToThreshWebPush,
  unsubscribeFromThreshWebPush,
} from '../../utils/pushNotificationsClient';
import {
  CommsAnnouncementsTab,
  CommsWorkoutNotesTab,
} from './CommsHubSecondaryTabs';
import {
  buildDirectThreadsSummary,
  buildLocalDemoTeamMessage,
  downloadMessagingAuditCsv,
  filterVisibleQueuedOutboxMessages,
  filterVisibleTeamMessages,
  isLocalHourInQuietHours,
  resolveDirectThreadAthlete,
  type TeamMessagingDrawerProps,
} from './messaging/teamMessagingHelpers';
import {
  TeamMessagingHeaderAndTabs,
  TeamMessagingPushBar,
} from './messaging/TeamMessagingPushBar';
import { TeamMessagingChannelRail } from './messaging/TeamMessagingChannelRail';
import { TeamMessagingFeedAndComposer } from './messaging/TeamMessagingFeedAndComposer';
import type {
  CoachEventGroup,
  TeamMessageChannelScope,
  TeamMessageRecord,
  TeamMessagingPolicy,
  TeamSummaryWithRole,
} from '../../types';

export type { TeamMessagingDrawerProps };

const QUEUED_OFFLINE_BADGE_LABEL = 'Queued offline — not delivered yet';

export const TeamMessagingDrawer: React.FC<TeamMessagingDrawerProps> = ({
  isOpen,
  onClose,
  activeTeam,
  myTeams,
  onTeamsUpdated,
  viewerMode = 'ATHLETE',
  initialScope = 'ALL_TEAM',
}) => {
  const [commsTab, setCommsTab] = useState<'CHAT' | 'ANNOUNCEMENTS' | 'WORKOUT_NOTES'>('CHAT');
  const [activeScope, setActiveScope] = useState<TeamMessageChannelScope>(initialScope);
  const [selectedGroup, setSelectedGroup] = useState<CoachEventGroup>('SPRINTS');
  const [selectedSubgroupId, setSelectedSubgroupId] = useState<string>('');
  const [subgroupComposerOpen, setSubgroupComposerOpen] = useState<boolean>(false);
  const [openReceiptMsgId, setOpenReceiptMsgId] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [selectedAthleteMembershipId, setSelectedAthleteMembershipId] = useState<string>('');
  const [draftBody, setDraftBody] = useState<string>('');
  const [emergencyOverride, setEmergencyOverride] = useState<boolean>(false);
  const [sending, setSending] = useState<boolean>(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusInfo, setStatusInfo] = useState<string | null>(null);
  const [queuedOfflineMessages, setQueuedOfflineMessages] = useState<QueuedChatOutboxMessage[]>(() =>
    loadChatOutbox(activeTeam?.brand.teamId)
  );
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [flushingOutbox, setFlushingOutbox] = useState<boolean>(false);
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
    if (isOpen) {
      setCommsTab('CHAT');
      setActiveScope(initialScope);
      setOpenReceiptMsgId(null);
      setStatusError(null);
      setStatusInfo(null);
    }
  }, [isOpen, initialScope]);

  const activeTeamId = activeTeam?.brand.teamId;

  useEffect(() => {
    if (!isOpen || !activeTeamId) return;
    setQueuedOfflineMessages(loadChatOutbox(activeTeamId));
    void hydrateChatOutboxFromDexie(activeTeamId).then((items) => {
      setQueuedOfflineMessages(items);
    });
    const onOutboxEvent = () => {
      setQueuedOfflineMessages(loadChatOutbox(activeTeamId));
    };
    const onOnlineEvent = () => {
      if (isSampleDemo) return;
      void flushChatOutbox(async (q) => {
        const resp = await postTeamMessageApi({
          teamId: q.teamId,
          channelScope: q.channelScope,
          eventGroup: q.eventGroup,
          customSubgroupId: q.customSubgroupId,
          targetMembershipId: q.targetMembershipId,
          body: q.body,
          guardianCc: q.guardianCc ?? true,
          clientLocalHour: q.clientLocalHour,
          isEmergencyOverride: q.isEmergencyOverride,
        });
        if (resp.teams && resp.teams.length > 0) {
          onTeamsUpdated(resp.teams, q.teamId);
        } else if (resp.team) {
          onTeamsUpdated(
            myTeams.map((t) => (t.brand.teamId === resp.team!.brand.teamId ? resp.team! : t)),
            resp.team.brand.teamId
          );
        }
      }, activeTeamId).then((res) => {
        setQueuedOfflineMessages(loadChatOutbox(activeTeamId));
        if (res.sentCount > 0) {
          setStatusInfo(`Delivered ${res.sentCount} queued offline message(s) ✓`);
        }
      });
    };
    window.addEventListener('thresh:chat-outbox-updated', onOutboxEvent);
    window.addEventListener('online', onOnlineEvent);
    return () => {
      window.removeEventListener('thresh:chat-outbox-updated', onOutboxEvent);
      window.removeEventListener('online', onOnlineEvent);
    };
  }, [activeTeamId, isOpen, isSampleDemo, myTeams, onTeamsUpdated]);

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

  const resolvedDirectAthlete = useMemo(
    () =>
      resolveDirectThreadAthlete({
        isStaff,
        activeTeam,
        athleteMembers,
        selectedAthleteMembershipId,
      }),
    [activeTeam, athleteMembers, isStaff, selectedAthleteMembershipId]
  );

  const directThreads = useMemo(
    () =>
      buildDirectThreadsSummary({
        isStaff,
        teamMessages: activeTeam?.teamMessages || [],
        athleteMembers,
      }),
    [activeTeam?.teamMessages, athleteMembers, isStaff]
  );

  const localHour = new Date().getHours();
  const isQuietHours = isLocalHourInQuietHours(policy, localHour);

  const resolvedSubgroupId = useMemo(() => {
    const groups = activeTeam?.customSubgroups || [];
    if (selectedSubgroupId && groups.some((g) => g.id === selectedSubgroupId)) {
      return selectedSubgroupId;
    }
    return groups[0]?.id || '';
  }, [activeTeam?.customSubgroups, selectedSubgroupId]);

  const visibleMessages = useMemo(
    () =>
      filterVisibleTeamMessages({
        teamMessages: activeTeam?.teamMessages || [],
        isStaff,
        myRole: activeTeam?.myRole,
        activeScope,
        selectedGroup,
        resolvedSubgroupId,
        resolvedDirectAthlete,
      }),
    [
      activeScope,
      activeTeam?.myRole,
      activeTeam?.teamMessages,
      isStaff,
      resolvedDirectAthlete,
      resolvedSubgroupId,
      selectedGroup,
    ]
  );

  const visibleQueuedMessages = useMemo(
    () =>
      filterVisibleQueuedOutboxMessages({
        queuedOfflineMessages,
        activeTeamId: activeTeam?.brand.teamId,
        activeScope,
        selectedGroup,
        resolvedSubgroupId,
        resolvedDirectAthlete,
      }),
    [
      activeScope,
      activeTeam?.brand.teamId,
      queuedOfflineMessages,
      resolvedDirectAthlete,
      resolvedSubgroupId,
      selectedGroup,
    ]
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

    if (
      !isStaff &&
      (activeScope === 'ALL_TEAM' ||
        activeScope === 'EVENT_GROUP' ||
        activeScope === 'CUSTOM_SUBGROUP') &&
      !policy.athleteRepliesEnabled
    ) {
      setStatusError(
        'Team channels are set to Coach Announcements Only. Use Direct (SafeSport CC) to message coaching staff.'
      );
      return;
    }

    if (activeScope === 'PARENTS_ONLY' && !isStaff && policy.parentRepliesEnabled === false) {
      setStatusError('Parents Only channel is set to coach announcements only.');
      return;
    }

    const activeSubgroup =
      activeScope === 'CUSTOM_SUBGROUP'
        ? (activeTeam.customSubgroups || []).find((g) => g.id === resolvedSubgroupId)
        : undefined;
    if (activeScope === 'CUSTOM_SUBGROUP' && !activeSubgroup) {
      setStatusError('Select or create a custom sub-group before posting.');
      return;
    }

    const fallbackLocalSend = () => {
      const newMsg = buildLocalDemoTeamMessage({
        activeTeam,
        activeScope,
        selectedGroup,
        activeSubgroup,
        resolvedDirectAthlete,
        isStaff,
        body: clean,
        policy,
        isQuietHours,
        emergencyOverride,
      });
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
      const queued = enqueueChatOutboxMessage({
        teamId: activeTeam.brand.teamId,
        channelScope: activeScope,
        eventGroup: activeScope === 'EVENT_GROUP' ? selectedGroup : undefined,
        customSubgroupId: activeSubgroup?.id,
        targetMembershipId:
          activeScope === 'DIRECT_TRANSPARENT'
            ? resolvedDirectAthlete?.membershipId
            : undefined,
        body: clean,
        guardianCc: true,
        clientLocalHour: localHour,
        isEmergencyOverride: emergencyOverride,
      });
      if (queued) {
        setQueuedOfflineMessages(loadChatOutbox(activeTeam.brand.teamId));
      }
      setDraftBody('');
      setStatusInfo('Saved offline — will auto-send when back online.');
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
        customSubgroupId: activeSubgroup?.id,
        targetMembershipId:
          activeScope === 'DIRECT_TRANSPARENT' ? resolvedDirectAthlete?.membershipId : undefined,
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
      setStatusInfo(
        (resp.emailFallbackCount || 0) > 0
          ? `Message delivered + ${resp.emailFallbackCount} email fallback(s) ✓`
          : 'Message delivered ✓'
      );
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

  const handleRetryQueuedMessage = async (item: QueuedChatOutboxMessage) => {
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
        customSubgroupId: item.customSubgroupId,
        targetMembershipId: item.targetMembershipId,
        body: item.body,
        guardianCc: item.guardianCc ?? true,
        clientLocalHour: item.clientLocalHour,
        isEmergencyOverride: item.isEmergencyOverride,
      });
      if (resp.teams && resp.teams.length > 0) {
        onTeamsUpdated(resp.teams, item.teamId);
      } else if (resp.team) {
        applyUpdatedTeam(resp.team);
      }
      removeChatOutboxMessage(item.localId);
      setQueuedOfflineMessages(loadChatOutbox(activeTeam.brand.teamId));
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

  const handleFlushAllOutbox = async () => {
    setStatusError(null);
    setFlushingOutbox(true);
    try {
      const res = await flushChatOutbox(async (q) => {
        const resp = await postTeamMessageApi({
          teamId: q.teamId,
          channelScope: q.channelScope,
          eventGroup: q.eventGroup,
          customSubgroupId: q.customSubgroupId,
          targetMembershipId: q.targetMembershipId,
          body: q.body,
          guardianCc: q.guardianCc ?? true,
          clientLocalHour: q.clientLocalHour,
          isEmergencyOverride: q.isEmergencyOverride,
        });
        if (resp.teams && resp.teams.length > 0) {
          onTeamsUpdated(resp.teams, q.teamId);
        } else if (resp.team) {
          applyUpdatedTeam(resp.team);
        }
      }, activeTeam.brand.teamId);
      setQueuedOfflineMessages(loadChatOutbox(activeTeam.brand.teamId));
      if (res.sentCount > 0) {
        setStatusInfo(`Delivered ${res.sentCount} queued offline message(s) ✓`);
      } else if (res.lastError) {
        setStatusError(res.lastError);
      }
    } finally {
      setFlushingOutbox(false);
    }
  };

  const handleCopyRemindMessage = async (msg: TeamMessageRecord) => {
    const scopeLabel =
      msg.channelScope === 'PARENTS_ONLY'
        ? 'Parents & Guardians Notice'
        : msg.channelScope === 'CUSTOM_SUBGROUP' && msg.customSubgroupName
          ? msg.customSubgroupName
          : undefined;
    const formatted = formatMessageForRemindOrParentSquare({
      teamShortName: activeTeam.brand.shortName || activeTeam.brand.name,
      teamSlug: activeTeam.brand.slug,
      senderName: msg.senderName,
      categoryLabel: scopeLabel,
      body: msg.body,
    });
    const ok = await copyTextToClipboardSafe(formatted);
    setCopiedMsgId(msg.id);
    setStatusInfo(ok ? 'Copied for Remind / ParentSquare ✓' : formatted);
    window.setTimeout(() => {
      setCopiedMsgId((prev) => (prev === msg.id ? null : prev));
    }, 2400);
  };

  const handleDeleteSubgroup = async (subgroupId: string) => {
    if (isSampleDemo) {
      applyUpdatedTeam({
        ...activeTeam,
        customSubgroups: (activeTeam.customSubgroups || []).filter((g) => g.id !== subgroupId),
      });
      setSelectedSubgroupId('');
      return;
    }
    try {
      const resp = await deleteTeamCustomSubgroupApi({
        teamId: activeTeam.brand.teamId,
        subgroupId,
      });
      if (resp.teams && resp.teams.length > 0) {
        onTeamsUpdated(resp.teams, activeTeam.brand.teamId);
      } else if (resp.team) {
        applyUpdatedTeam(resp.team);
      }
      setSelectedSubgroupId('');
    } catch (err) {
      setStatusError(
        err instanceof TeamLifecycleApiError ? err.message : 'Unable to delete sub-group.'
      );
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
    downloadMessagingAuditCsv(activeTeam);
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
        <TeamMessagingHeaderAndTabs
          headingId={headingId}
          activeTeam={activeTeam}
          canManagePolicy={canManagePolicy}
          policy={policy}
          onToggleAthleteReplies={() => void handleToggleAthleteReplies()}
          onExportAuditCsv={handleExportAuditCsv}
          onClose={onClose}
          commsTab={commsTab}
          onSelectTab={(tab) => {
            setCommsTab(tab);
            setStatusError(null);
            setStatusInfo(null);
          }}
        />

        <TeamMessagingPushBar
          pushEnabled={pushEnabled}
          pushPanelExpanded={pushPanelExpanded}
          setPushPanelExpanded={setPushPanelExpanded}
          pushCount={pushCount}
          pushNotice={pushNotice}
          iosStandaloneNeeded={iosStandaloneNeeded}
          isSampleDemo={isSampleDemo}
          pushLoading={pushLoading}
          onSendTestPush={() => void handleSendTestPush()}
          onToggleDevicePush={() => void handleToggleDevicePush()}
        />

        {commsTab === 'ANNOUNCEMENTS' && (
          <CommsAnnouncementsTab
            activeTeam={activeTeam}
            isStaff={isStaff}
            isSampleDemo={isSampleDemo}
            onApplyTeam={applyUpdatedTeam}
            onTeamsUpdated={onTeamsUpdated}
            onNotify={(msg) => {
              setStatusError(null);
              setStatusInfo(msg);
            }}
            onError={(msg) => setStatusError(msg)}
          />
        )}

        {commsTab === 'WORKOUT_NOTES' && (
          <CommsWorkoutNotesTab
            activeTeam={activeTeam}
            isStaff={isStaff}
            isSampleDemo={isSampleDemo}
            onApplyTeam={applyUpdatedTeam}
            onTeamsUpdated={onTeamsUpdated}
            onNotify={(msg) => {
              setStatusError(null);
              setStatusInfo(msg);
            }}
            onError={(msg) => setStatusError(msg)}
          />
        )}

        {commsTab === 'CHAT' && (
          <>
            <TeamMessagingChannelRail
              activeTeam={activeTeam}
              isStaff={isStaff}
              isSampleDemo={isSampleDemo}
              activeScope={activeScope}
              setActiveScope={setActiveScope}
              setStatusError={setStatusError}
              setStatusInfo={setStatusInfo}
              setOpenReceiptMsgId={setOpenReceiptMsgId}
              selectedGroup={selectedGroup}
              setSelectedGroup={setSelectedGroup}
              resolvedSubgroupId={resolvedSubgroupId}
              setSelectedSubgroupId={setSelectedSubgroupId}
              subgroupComposerOpen={subgroupComposerOpen}
              setSubgroupComposerOpen={setSubgroupComposerOpen}
              onApplyTeam={applyUpdatedTeam}
              onTeamsUpdated={onTeamsUpdated}
              onDeleteSubgroup={(sgId) => void handleDeleteSubgroup(sgId)}
              athleteMembers={athleteMembers}
              resolvedDirectAthlete={resolvedDirectAthlete}
              setSelectedAthleteMembershipId={setSelectedAthleteMembershipId}
              directThreads={directThreads}
              isQuietHours={isQuietHours}
              policy={policy}
              emergencyOverride={emergencyOverride}
              setEmergencyOverride={setEmergencyOverride}
            />

            <TeamMessagingFeedAndComposer
              activeTeam={activeTeam}
              isStaff={isStaff}
              activeScope={activeScope}
              queuedOfflineMessages={queuedOfflineMessages}
              visibleMessages={visibleMessages}
              visibleQueuedMessages={visibleQueuedMessages}
              flushingOutbox={flushingOutbox}
              onFlushAllOutbox={() => void handleFlushAllOutbox()}
              openReceiptMsgId={openReceiptMsgId}
              setOpenReceiptMsgId={setOpenReceiptMsgId}
              copiedMsgId={copiedMsgId}
              onAck={(id) => void handleAck(id)}
              onCopyRemindMessage={(msg) => void handleCopyRemindMessage(msg)}
              onFlag={(id) => void handleFlag(id)}
              retryingId={retryingId}
              onRetryQueuedMessage={(item) => void handleRetryQueuedMessage(item)}
              queuedOfflineBadgeLabel={QUEUED_OFFLINE_BADGE_LABEL}
              draftBody={draftBody}
              setDraftBody={setDraftBody}
              sending={sending}
              statusError={statusError}
              statusInfo={statusInfo}
              onSend={(e) => void handleSend(e)}
            />
          </>
        )}

        {commsTab !== 'CHAT' && (statusError || statusInfo) && (
          <div className="px-4 py-2 border-t border-ap-frame/15 dark:border-ap-edge-dark">
            {statusError && (
              <div role="alert" className="text-2xs font-mono text-rose-600 dark:text-rose-400">
                {statusError}
              </div>
            )}
            {statusInfo && (
              <div className="text-2xs font-mono text-emerald-600 dark:text-emerald-400">
                {statusInfo}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
