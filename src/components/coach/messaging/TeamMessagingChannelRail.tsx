import React from 'react';
import { COACH_EVENT_GROUP_OPTIONS } from '../../../physiology/teamOnboardingEngine';
import type {
  CoachEventGroup,
  TeamMembershipRecord,
  TeamMessageChannelScope,
  TeamMessagingPolicy,
  TeamSummaryWithRole,
} from '../../../types';
import {
  AlertTriangle,
  Lock,
  Plus,
  Trash2,
  Users,
} from '../../icons/PhosphorIcons';
import { CommsSubgroupManager } from '../CommsHubSecondaryTabs';
import type { DirectThreadSummary } from './teamMessagingHelpers';

interface TeamMessagingChannelRailProps {
  activeTeam: TeamSummaryWithRole;
  isStaff: boolean;
  isSampleDemo: boolean;
  activeScope: TeamMessageChannelScope;
  setActiveScope: (scope: TeamMessageChannelScope) => void;
  setStatusError: (msg: string | null) => void;
  setStatusInfo: (msg: string | null) => void;
  setOpenReceiptMsgId: (id: string | null) => void;
  selectedGroup: CoachEventGroup;
  setSelectedGroup: (group: CoachEventGroup) => void;
  resolvedSubgroupId: string;
  setSelectedSubgroupId: (id: string) => void;
  subgroupComposerOpen: boolean;
  setSubgroupComposerOpen: (open: boolean) => void;
  onApplyTeam: (updated: TeamSummaryWithRole) => void;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], activeTeamId?: string) => void;
  onDeleteSubgroup: (subgroupId: string) => void;
  athleteMembers: TeamMembershipRecord[];
  resolvedDirectAthlete: TeamMembershipRecord | null;
  setSelectedAthleteMembershipId: (id: string) => void;
  directThreads: DirectThreadSummary[];
  isQuietHours: boolean;
  policy: TeamMessagingPolicy;
  emergencyOverride: boolean;
  setEmergencyOverride: (val: boolean) => void;
}

export const TeamMessagingChannelRail: React.FC<TeamMessagingChannelRailProps> = ({
  activeTeam,
  isStaff,
  isSampleDemo,
  activeScope,
  setActiveScope,
  setStatusError,
  setStatusInfo,
  setOpenReceiptMsgId,
  selectedGroup,
  setSelectedGroup,
  resolvedSubgroupId,
  setSelectedSubgroupId,
  subgroupComposerOpen,
  setSubgroupComposerOpen,
  onApplyTeam,
  onTeamsUpdated,
  onDeleteSubgroup,
  athleteMembers,
  resolvedDirectAthlete,
  setSelectedAthleteMembershipId,
  directThreads,
  isQuietHours,
  policy,
  emergencyOverride,
  setEmergencyOverride,
}) => (
  <>
    {/* Channel Rail */}
    <div
      className="px-4 py-2 border-b border-ap-frame/15 dark:border-ap-edge-dark flex flex-nowrap overflow-x-auto no-scrollbar sm:flex-wrap items-center gap-1.5"
      role="tablist"
    >
      {(
        [
          { id: 'ALL_TEAM', label: 'Whole Team', testId: 'msg-channel-all', show: true },
          { id: 'EVENT_GROUP', label: 'Event Group', testId: 'msg-channel-group', show: true },
          {
            id: 'PARENTS_ONLY',
            label: 'Parents Only',
            testId: 'messaging-scope-parents_only',
            show: isStaff || activeTeam.myRole === 'PARENT_FOLLOWER',
          },
          {
            id: 'CUSTOM_SUBGROUP',
            label: 'Sub-Groups',
            testId: 'messaging-scope-custom_subgroup',
            show: isStaff || (activeTeam.customSubgroups?.length || 0) > 0,
          },
          {
            id: 'COACHES_STAFF',
            label: 'Coaches & Staff',
            testId: 'msg-channel-staff',
            show: isStaff,
          },
          {
            id: 'DIRECT_TRANSPARENT',
            label: 'Direct (SafeSport CC)',
            testId: 'msg-channel-direct',
            show: true,
          },
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
                setOpenReceiptMsgId(null);
              }}
              className={`shrink-0 min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl text-xs font-bold cursor-pointer ${
                active ? 'ap-nav-volt-active' : 'liquid-capsule-track text-ap-ink dark:text-ap-chalk'
              }`}
            >
              {ch.label}
            </button>
          );
        })}
    </div>

    {activeScope === 'PARENTS_ONLY' && (
      <div
        data-testid="msg-parents-only-banner"
        className="px-4 py-2 bg-ap-cobalt/10 dark:bg-ap-volt/10 border-b border-ap-frame/15 dark:border-ap-edge-dark text-2xs font-mono text-ap-ink dark:text-ap-chalk flex items-center gap-1.5"
      >
        <Users className="w-3.5 h-3.5 ap-text-brand shrink-0" />
        <span>Parents &amp; Coaching Staff Only — athletes never see messages posted here.</span>
      </div>
    )}

    {activeScope === 'CUSTOM_SUBGROUP' && (
      <div className="px-4 py-2 bg-ap-card-inset/50 border-b border-ap-frame/10 dark:border-ap-edge-dark space-y-2 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {(activeTeam.customSubgroups || []).map((sg) => {
              const activeSg = resolvedSubgroupId === sg.id;
              return (
                <div key={sg.id} className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    data-testid={`comms-subgroup-pill-${sg.id}`}
                    onClick={() => setSelectedSubgroupId(sg.id)}
                    className={`min-h-[44px] sm:min-h-[34px] px-2.5 py-1 rounded-lg font-bold text-2xs cursor-pointer ${
                      activeSg
                        ? 'ap-nav-volt-active'
                        : 'bg-white dark:bg-ap-carbon border border-ap-frame/20 dark:border-ap-edge-dark'
                    }`}
                  >
                    {sg.name} ({sg.memberIds.length})
                  </button>
                  {isStaff && activeSg && (
                    <button
                      type="button"
                      aria-label={`Delete sub-group ${sg.name}`}
                      onClick={() => onDeleteSubgroup(sg.id)}
                      className="min-h-[44px] min-w-[44px] sm:min-h-[30px] sm:min-w-[30px] rounded-lg text-rose-500 inline-flex items-center justify-center cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
            {(activeTeam.customSubgroups || []).length === 0 && !subgroupComposerOpen && (
              <span className="text-2xs text-ap-muted dark:text-ap-muted-dark">
                No custom sub-groups yet (e.g. Travel Bus #1, Meet Volunteers).
              </span>
            )}
          </div>
          {isStaff && !subgroupComposerOpen && (
            <button
              type="button"
              data-testid="comms-subgroup-create-btn"
              onClick={() => setSubgroupComposerOpen(true)}
              className="min-h-[44px] sm:min-h-[34px] px-2.5 py-1 rounded-lg ap-btn-secondary text-2xs font-bold inline-flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Sub-Group</span>
            </button>
          )}
        </div>

        {subgroupComposerOpen && (
          <CommsSubgroupManager
            activeTeam={activeTeam}
            isSampleDemo={isSampleDemo}
            onApplyTeam={onApplyTeam}
            onTeamsUpdated={onTeamsUpdated}
            onCreated={(sgId) => {
              setSelectedSubgroupId(sgId);
              setSubgroupComposerOpen(false);
              setStatusInfo('Custom sub-group created ✓');
            }}
            onCancel={() => setSubgroupComposerOpen(false)}
            onError={(msg) => setStatusError(msg)}
          />
        )}
      </div>
    )}

    {/* Sub-selector bar for Event Group or Transparent Direct Thread */}
    {activeScope === 'EVENT_GROUP' && (
      <div className="px-4 py-2 bg-ap-card-inset/50 border-b border-ap-frame/10 dark:border-ap-edge-dark flex items-center gap-2 text-xs">
        <span className="font-mono text-2xs uppercase text-ap-muted dark:text-ap-muted-dark">
          Group:
        </span>
        <select
          aria-label="Select Event Group Channel"
          value={selectedGroup}
          onChange={(e) => setSelectedGroup(e.target.value as CoachEventGroup)}
          className="min-h-[44px] sm:min-h-[38px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-xs font-semibold"
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
              className="min-h-[44px] sm:min-h-[38px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 text-xs font-semibold"
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
                  className={`min-h-[44px] sm:min-h-[32px] px-2.5 py-0.5 rounded-full text-2xs font-semibold cursor-pointer truncate max-w-[200px] ${
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
  </>
);
