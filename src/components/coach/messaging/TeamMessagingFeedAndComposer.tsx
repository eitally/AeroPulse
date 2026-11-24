import React from 'react';
import type { QueuedChatOutboxMessage } from '../../../utils/chatOutbox';
import type {
  TeamMessageChannelScope,
  TeamMessageRecord,
  TeamSummaryWithRole,
} from '../../../types';
import {
  Check,
  Copy,
  Flag,
  RefreshCw,
  Send,
  Users,
  WifiOff,
} from '../../icons/PhosphorIcons';
import { CommsReadReceiptPopover } from '../CommsHubSecondaryTabs';
import {
  COACH_QUICK_TEMPLATES,
  formatMsgTimestamp,
} from './teamMessagingHelpers';

interface TeamMessagingFeedAndComposerProps {
  activeTeam: TeamSummaryWithRole;
  isStaff: boolean;
  activeScope: TeamMessageChannelScope;
  queuedOfflineMessages: QueuedChatOutboxMessage[];
  visibleMessages: TeamMessageRecord[];
  visibleQueuedMessages: QueuedChatOutboxMessage[];
  flushingOutbox: boolean;
  onFlushAllOutbox: () => void;
  openReceiptMsgId: string | null;
  setOpenReceiptMsgId: (id: string | null) => void;
  copiedMsgId: string | null;
  onAck: (msgId: string) => void;
  onCopyRemindMessage: (msg: TeamMessageRecord) => void;
  onFlag: (msgId: string) => void;
  retryingId: string | null;
  onRetryQueuedMessage: (item: QueuedChatOutboxMessage) => void;
  queuedOfflineBadgeLabel: string;
  draftBody: string;
  setDraftBody: (body: string) => void;
  sending: boolean;
  statusError: string | null;
  statusInfo: string | null;
  onSend: (e: React.FormEvent) => void;
}

export const TeamMessagingFeedAndComposer: React.FC<TeamMessagingFeedAndComposerProps> = ({
  activeTeam,
  isStaff,
  activeScope,
  queuedOfflineMessages,
  visibleMessages,
  visibleQueuedMessages,
  flushingOutbox,
  onFlushAllOutbox,
  openReceiptMsgId,
  setOpenReceiptMsgId,
  copiedMsgId,
  onAck,
  onCopyRemindMessage,
  onFlag,
  retryingId,
  onRetryQueuedMessage,
  queuedOfflineBadgeLabel,
  draftBody,
  setDraftBody,
  sending,
  statusError,
  statusInfo,
  onSend,
}) => (
  <>
    {queuedOfflineMessages.length > 0 && (
      <div
        data-testid="comms-outbox-queued-banner"
        className="px-4 py-1.5 bg-amber-500/20 border-b border-amber-500/35 flex items-center justify-between gap-2 text-2xs font-mono text-amber-950 dark:text-amber-100"
      >
        <span className="inline-flex items-center gap-1.5 font-bold">
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          {queuedOfflineMessages.length} queued offline (saved locally, survives reload)
        </span>
        <button
          type="button"
          data-testid="comms-outbox-retry-btn"
          disabled={flushingOutbox}
          onClick={onFlushAllOutbox}
          className="min-h-[44px] sm:min-h-[30px] px-2.5 py-0.5 rounded-lg bg-amber-600 text-white font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className="w-3 h-3" />
          <span>{flushingOutbox ? 'Syncing…' : 'Sync All'}</span>
        </button>
      </div>
    )}

    {/* Messages Feed */}
    <div className="flex-1 min-h-[180px] overflow-y-auto px-4 py-3 space-y-2.5">
      {visibleMessages.length === 0 && visibleQueuedMessages.length === 0 ? (
        <div className="rounded-xl ap-card-inset p-4 text-xs text-ap-muted dark:text-ap-muted-dark">
          No messages in this channel yet. Post a meet reminder or practice note below.
        </div>
      ) : (
        visibleMessages.map((msg) => {
          const ackCount = msg.acknowledgedByMembershipIds?.length || 0;
          const alreadyAcked = msg.acknowledgedByMembershipIds?.includes(activeTeam.myMembershipId);
          const receiptOpen = openReceiptMsgId === msg.id;
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
                    (
                    {activeTeam.memberships.find((m) => m.membershipId === msg.senderMembershipId)
                      ?.coachSpecialtyTitle || msg.senderRole}
                    )
                  </span>
                  {msg.targetAthleteName ? ` → ${msg.targetAthleteName}` : ''}
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  {msg.guardianCcApplied && (
                    <span className="px-1.5 py-0.5 rounded ap-status-info">Guardian CC ✓</span>
                  )}
                  {(msg.emailFallbackCount || 0) > 0 && (
                    <span className="px-1.5 py-0.5 rounded ap-status-info">
                      Push + Email ({msg.emailFallbackCount})
                    </span>
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
              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    data-testid={`msg-ack-btn-${msg.id}`}
                    onClick={() => onAck(msg.id)}
                    className={`min-h-[44px] sm:min-h-[34px] px-2.5 py-0.5 rounded-lg text-2xs font-mono font-semibold inline-flex items-center gap-1 cursor-pointer ${
                      alreadyAcked
                        ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                        : 'bg-white dark:bg-ap-carbon border border-ap-frame/20 dark:border-ap-edge-dark'
                    }`}
                  >
                    <Check className="w-3 h-3" />
                    <span>Got It ({ackCount})</span>
                  </button>
                  {isStaff && (
                    <button
                      type="button"
                      data-testid={`msg-read-receipts-btn-${msg.id}`}
                      aria-expanded={receiptOpen}
                      onClick={() => setOpenReceiptMsgId(receiptOpen ? null : msg.id)}
                      className="min-h-[44px] sm:min-h-[34px] px-2.5 py-0.5 rounded-lg text-2xs font-mono font-semibold bg-white dark:bg-ap-carbon border border-ap-frame/20 dark:border-ap-edge-dark inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Users className="w-3 h-3" />
                      <span>Receipts</span>
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid={`msg-copy-remind-btn-${msg.id}`}
                    onClick={() => onCopyRemindMessage(msg)}
                    className="min-h-[44px] sm:min-h-[34px] px-2.5 py-0.5 rounded-lg text-2xs font-mono font-semibold bg-white dark:bg-ap-carbon border border-ap-frame/20 dark:border-ap-edge-dark inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{copiedMsgId === msg.id ? 'Copied ✓' : 'Copy Remind'}</span>
                  </button>
                </div>
                {!msg.flaggedForAdminReview && (
                  <button
                    type="button"
                    data-testid={`msg-flag-btn-${msg.id}`}
                    onClick={() => onFlag(msg.id)}
                    className="min-h-[44px] sm:min-h-[34px] px-2 py-0.5 rounded-lg text-2xs font-mono text-ap-muted dark:text-ap-muted-dark hover:text-rose-500 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Flag className="w-3 h-3" />
                    <span>Flag</span>
                  </button>
                )}
              </div>
              {isStaff && receiptOpen && (
                <CommsReadReceiptPopover
                  message={msg}
                  activeTeam={activeTeam}
                  onClose={() => setOpenReceiptMsgId(null)}
                />
              )}
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
              <span>{queuedOfflineBadgeLabel} (saved locally)</span>
            </span>
            <button
              type="button"
              data-testid="team-msg-retry-btn"
              disabled={retryingId === q.localId}
              onClick={() => onRetryQueuedMessage(q)}
              className="min-h-[44px] sm:min-h-[34px] px-2.5 py-0.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
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
    <form
      onSubmit={onSend}
      className="px-4 py-3 border-t border-ap-frame/15 dark:border-ap-edge-dark space-y-2"
    >
      {isStaff && (
        <div className="flex flex-nowrap overflow-x-auto no-scrollbar sm:flex-wrap gap-1">
          {COACH_QUICK_TEMPLATES.map((tpl) => (
            <button
              key={tpl}
              type="button"
              onClick={() => setDraftBody(tpl)}
              className="shrink-0 min-h-[44px] sm:min-h-[32px] px-2.5 py-0.5 rounded-md ap-card-inset text-2xs text-ap-ink dark:text-ap-chalk hover:underline cursor-pointer truncate max-w-[200px]"
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
        <div className="text-2xs font-mono text-emerald-600 dark:text-emerald-400">
          {statusInfo}
        </div>
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
              : activeScope === 'PARENTS_ONLY'
                ? 'Message Parents & Guardians only...'
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
  </>
);
