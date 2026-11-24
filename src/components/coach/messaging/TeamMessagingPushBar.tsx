import React from 'react';
import {
  Bell,
  BellRinging,
  Download,
  MessageSquare,
  ShieldCheck,
  X,
} from '../../icons/PhosphorIcons';
import type { TeamMessagingPolicy, TeamSummaryWithRole } from '../../../types';

interface TeamMessagingHeaderAndTabsProps {
  headingId: string;
  activeTeam: TeamSummaryWithRole;
  canManagePolicy: boolean;
  policy: TeamMessagingPolicy;
  onToggleAthleteReplies: () => void;
  onExportAuditCsv: () => void;
  onClose: () => void;
  commsTab: 'CHAT' | 'ANNOUNCEMENTS' | 'WORKOUT_NOTES';
  onSelectTab: (tab: 'CHAT' | 'ANNOUNCEMENTS' | 'WORKOUT_NOTES') => void;
}

export const TeamMessagingHeaderAndTabs: React.FC<TeamMessagingHeaderAndTabsProps> = ({
  headingId,
  activeTeam,
  canManagePolicy,
  policy,
  onToggleAthleteReplies,
  onExportAuditCsv,
  onClose,
  commsTab,
  onSelectTab,
}) => (
  <>
    <div className="px-4 py-3 border-b border-ap-frame/15 dark:border-ap-edge-dark flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 ap-text-brand shrink-0" />
          <h2 id={headingId} className="text-sm sm:text-base font-extrabold truncate">
            {activeTeam.brand.shortName || activeTeam.brand.name} · Comms Hub
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
                onClick={onToggleAthleteReplies}
                className="min-h-[44px] sm:min-h-[28px] px-2.5 py-0.5 rounded-full ap-card-inset font-semibold cursor-pointer"
              >
                {policy.athleteRepliesEnabled ? 'Replies: ON' : 'Broadcast Only'}
              </button>
              <button
                type="button"
                data-testid="messaging-export-csv-btn"
                onClick={onExportAuditCsv}
                className="min-h-[44px] sm:min-h-[28px] px-2.5 py-0.5 rounded-full ap-card-inset font-semibold inline-flex items-center gap-1 cursor-pointer"
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

    <div
      role="tablist"
      aria-label="Comms Hub Sections"
      className="px-4 py-2 border-b border-ap-frame/15 dark:border-ap-edge-dark flex items-center gap-1.5"
    >
      {(
        [
          {
            id: 'CHAT' as const,
            label: 'Chat',
            count: (activeTeam.teamMessages || []).length,
            testId: 'comms-tab-chat',
          },
          {
            id: 'ANNOUNCEMENTS' as const,
            label: 'Announcements',
            count: (activeTeam.announcements || []).length,
            testId: 'comms-tab-announcements',
          },
          {
            id: 'WORKOUT_NOTES' as const,
            label: 'Workout Notes',
            count: (activeTeam.workoutComments || []).length,
            testId: 'comms-tab-workout-notes',
          },
        ] as const
      ).map((tab) => {
        const active = commsTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            data-testid={tab.testId}
            aria-selected={active}
            onClick={() => onSelectTab(tab.id)}
            className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl text-xs font-extrabold cursor-pointer inline-flex items-center gap-1.5 ${
              active ? 'ap-nav-volt-active' : 'liquid-capsule-track text-ap-ink dark:text-ap-chalk'
            }`}
          >
            <span>{tab.label}</span>
            <span className="text-2xs font-mono opacity-80">({tab.count})</span>
          </button>
        );
      })}
    </div>
  </>
);

interface TeamMessagingPushBarProps {
  pushEnabled: boolean;
  pushPanelExpanded: boolean;
  setPushPanelExpanded: (expanded: boolean) => void;
  pushCount: number;
  pushNotice: string | null;
  iosStandaloneNeeded: boolean;
  isSampleDemo: boolean;
  pushLoading: boolean;
  onSendTestPush: () => void;
  onToggleDevicePush: () => void;
}

export const TeamMessagingPushBar: React.FC<TeamMessagingPushBarProps> = ({
  pushEnabled,
  pushPanelExpanded,
  setPushPanelExpanded,
  pushCount,
  pushNotice,
  iosStandaloneNeeded,
  isSampleDemo,
  pushLoading,
  onSendTestPush,
  onToggleDevicePush,
}) => {
  if (!pushEnabled || pushPanelExpanded) {
    return (
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
                ? 'iPhone/iPad: Add to Home Screen for push, or rely on automatic MeetReady Email Fallback when push is off.'
                : 'No push on this device? MeetReady automatically sends SafeSport-safe email fallbacks for urgent team updates.')}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {pushEnabled && !isSampleDemo && (
            <button
              type="button"
              disabled={pushLoading}
              data-testid="send-test-push-btn"
              onClick={onSendTestPush}
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
            onClick={onToggleDevicePush}
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
              className="min-h-[44px] sm:min-h-[36px] px-2.5 rounded-lg text-2xs font-mono text-ap-muted dark:text-ap-muted-dark cursor-pointer"
            >
              Hide
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
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
        className="min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-lg ap-status-prime font-mono font-bold inline-flex items-center gap-1 cursor-pointer"
      >
        <span>Push Alerts ON{pushCount > 1 ? ` (${pushCount})` : ''}</span>
        <span className="opacity-75">· Manage</span>
      </button>
    </div>
  );
};
