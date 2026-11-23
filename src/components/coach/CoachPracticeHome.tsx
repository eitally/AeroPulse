import React, { Suspense, useState } from 'react';
import type {
  CoachComplexityTier,
  CoachEventGroup,
  ConnectedAthleteRecord,
  TeamAnnouncementRecord,
  TeamEventRsvpRecord,
  TeamMessageChannelScope,
  TeamSummaryWithRole,
} from '../../types';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { WorkspaceErrorBoundary } from '../WorkspaceErrorBoundary';
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  ClipboardText,
  MessageSquare,
  Shield,
  Target,
  Timer,
  Trophy,
  Users,
} from '../icons/PhosphorIcons';

const CoachDailyOpsPanel = lazyWithRetry(
  () => import('./CoachDailyOpsPanel').then((m) => ({ default: m.CoachDailyOpsPanel })),
  { chunkKey: 'CoachDailyOpsPanel', restoreTab: 'coach' }
);

export interface CoachPracticeHomeProps {
  todayIso: string;
  activeTeam: TeamSummaryWithRole | null;
  myTeams: TeamSummaryWithRole[];
  connectedAthletesOnly: ConnectedAthleteRecord[];
  scopedConnectedAthletes: ConnectedAthleteRecord[];
  complexityTier: CoachComplexityTier;
  effectiveAllowedEventGroups?: CoachEventGroup[];
  flaggedTriageCount: number;
  effectivePendingTimingCount: number;
  upcomingConflictCount?: number;
  todayRsvpsByMemberId?: Record<string, TeamEventRsvpRecord>;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string | null) => void;
  onOpenStopwatch: (mode: 'STOPWATCH' | 'FIELD') => void;
  onOpenWorkoutsTab: () => void;
  onOpenMeetDayTab: () => void;
  onOpenDelegateModal: (tab: 'CREATE' | 'REVIEW') => void;
  onOpenHealthAttention: () => void;
  onOpenRosterTab: () => void;
  onOpenSetupWizard: () => void;
  onOpenCreateTeamStudio: () => void;
  onOpenTeamMessages?: (scope?: TeamMessageChannelScope) => void;
}

function formatMessageScopeLabel(scope: TeamMessageChannelScope): string {
  if (scope === 'COACHES_STAFF') return 'Staff';
  if (scope === 'EVENT_GROUP') return 'Group';
  if (scope === 'DIRECT_TRANSPARENT') return 'Direct';
  return 'Team';
}

function formatHomeTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso.slice(11, 16);
  }
}

export const CoachPracticeHome: React.FC<CoachPracticeHomeProps> = ({
  todayIso,
  activeTeam,
  myTeams,
  connectedAthletesOnly,
  scopedConnectedAthletes,
  complexityTier,
  effectiveAllowedEventGroups,
  flaggedTriageCount,
  effectivePendingTimingCount,
  upcomingConflictCount = 0,
  todayRsvpsByMemberId,
  onTeamsUpdated,
  onOpenStopwatch,
  onOpenWorkoutsTab,
  onOpenMeetDayTab,
  onOpenDelegateModal,
  onOpenHealthAttention,
  onOpenRosterTab,
  onOpenSetupWizard,
  onOpenCreateTeamStudio,
  onOpenTeamMessages,
}) => {
  const [homePane, setHomePane] = useState<'OVERVIEW' | 'ROLL_CALL'>('OVERVIEW');

  const recentAnnouncements: TeamAnnouncementRecord[] = (activeTeam?.announcements || []).slice(0, 2);
  const recentMessages = [...(activeTeam?.teamMessages || [])]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 3);

  if (homePane === 'ROLL_CALL') {
    return (
      <div className="space-y-3" data-testid="coach-roll-call-pane">
        <div className="rounded-2xl liquid-glass px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            data-testid="coach-back-to-home-btn"
            onClick={() => setHomePane('OVERVIEW')}
            className="min-h-[44px] sm:min-h-[36px] px-3 py-1 rounded-xl ap-btn-secondary text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Coach Home</span>
          </button>
          <span className="text-2xs font-mono uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark font-bold">
            Daily Roll Call &amp; Weather Alerts
          </span>
        </div>

        <WorkspaceErrorBoundary fallbackTitle="Daily Practice Ops" restoreTab="coach">
          <Suspense
            fallback={
              <div className="h-32 rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                Loading Practice Roll Call…
              </div>
            }
          >
            <CoachDailyOpsPanel
              activeTeam={activeTeam}
              myTeams={myTeams}
              complexityTier={complexityTier}
              allowedEventGroups={effectiveAllowedEventGroups}
              todayRsvpsByMemberId={todayRsvpsByMemberId}
              hideDuplicateLaunchers={true}
              onLaunchStopwatch={() => onOpenStopwatch('STOPWATCH')}
              onLaunchFieldSheet={() => onOpenStopwatch('FIELD')}
              onTeamsUpdated={onTeamsUpdated}
            />
          </Suspense>
        </WorkspaceErrorBoundary>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 1. LINKS TO FUNCTIONAL PANELS */}
      <section
        data-testid="coach-quick-ops-strip"
        className="rounded-2xl liquid-glass p-3 sm:p-4 space-y-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="px-2 py-0.5 rounded-md ap-status-info font-mono text-2xs font-bold uppercase tracking-wider">
              Today · {todayIso}
            </span>
            <h2 className="text-xs sm:text-sm font-extrabold text-ap-ink dark:text-ap-chalk">
              Quick Launch Panels
            </h2>
          </div>
          <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
            {scopedConnectedAthletes.length} active in scope
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <button
            type="button"
            data-testid="quick-ops-stopwatch-btn"
            onClick={() => onOpenStopwatch('STOPWATCH')}
            className="min-h-[60px] rounded-xl ap-btn-primary px-3 py-2 text-left flex flex-col justify-between gap-1 cursor-pointer"
          >
            <div className="flex items-center justify-between gap-1.5">
              <Timer className="w-4 h-4 shrink-0" weight="bold" />
              <span className="text-2xs font-mono uppercase opacity-80">Timing</span>
            </div>
            <span className="text-xs sm:text-sm font-extrabold">Track Stopwatch</span>
          </button>

          <button
            type="button"
            data-testid="quick-ops-workouts-btn"
            onClick={onOpenWorkoutsTab}
            className="min-h-[60px] rounded-xl ap-btn-secondary px-3 py-2 text-left flex flex-col justify-between gap-1 cursor-pointer"
          >
            <div className="flex items-center justify-between gap-1.5">
              <Target className="w-4 h-4 ap-text-brand shrink-0" />
              <span className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
                Pods &amp; Presets
              </span>
            </div>
            <span className="text-xs sm:text-sm font-extrabold text-ap-ink dark:text-ap-chalk">
              Workout Builder
            </span>
          </button>

          <button
            type="button"
            data-testid="quick-ops-roll-call-btn"
            onClick={() => setHomePane('ROLL_CALL')}
            className="min-h-[60px] rounded-xl ap-btn-secondary px-3 py-2 text-left flex flex-col justify-between gap-1 cursor-pointer"
          >
            <div className="flex items-center justify-between gap-1.5">
              <ClipboardText className="w-4 h-4 ap-text-brand shrink-0" />
              <span className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
                Attendance
              </span>
            </div>
            <span className="text-xs sm:text-sm font-extrabold text-ap-ink dark:text-ap-chalk">
              Take Roll Call
            </span>
          </button>

          <button
            type="button"
            data-testid="quick-ops-field-marks-btn"
            onClick={() => onOpenStopwatch('FIELD')}
            className="min-h-[60px] rounded-xl ap-btn-secondary px-3 py-2 text-left flex flex-col justify-between gap-1 cursor-pointer"
          >
            <div className="flex items-center justify-between gap-1.5">
              <Target className="w-4 h-4 ap-text-brand shrink-0" />
              <span className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
                Jumps &amp; Throws
              </span>
            </div>
            <span className="text-xs sm:text-sm font-extrabold text-ap-ink dark:text-ap-chalk">
              Field Marks
            </span>
          </button>

          <button
            type="button"
            data-testid="quick-ops-meet-day-btn"
            onClick={onOpenMeetDayTab}
            className="min-h-[60px] rounded-xl ap-btn-secondary px-3 py-2 text-left flex flex-col justify-between gap-1 cursor-pointer"
          >
            <div className="flex items-center justify-between gap-1.5">
              <Trophy className="w-4 h-4 ap-text-brand shrink-0" />
              <span className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
                Heats &amp; RSVPs
              </span>
            </div>
            <span className="text-xs sm:text-sm font-extrabold text-ap-ink dark:text-ap-chalk">
              Meet Day Hub
            </span>
          </button>

          <button
            type="button"
            data-testid="quick-ops-delegate-timing-btn"
            onClick={() => onOpenDelegateModal('CREATE')}
            className="min-h-[60px] rounded-xl ap-btn-secondary px-3 py-2 text-left flex flex-col justify-between gap-1 cursor-pointer"
          >
            <div className="flex items-center justify-between gap-1.5">
              <Users className="w-4 h-4 ap-text-brand shrink-0" />
              <span className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
                Split Helper
              </span>
            </div>
            <span className="text-xs sm:text-sm font-extrabold text-ap-ink dark:text-ap-chalk">
              Delegate Timing
            </span>
          </button>
        </div>
      </section>

      {/* 2. ALERTS (HEALTH FLAGS, PENDING SPLITS, RSVP CONFLICTS, WEATHER/SCHEDULE) */}
      <section
        data-testid="coach-home-alerts"
        className="rounded-2xl liquid-glass p-3 sm:p-4 space-y-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 ap-text-brand shrink-0" />
            <h2 className="text-xs sm:text-sm font-extrabold text-ap-ink dark:text-ap-chalk">
              Team Alerts &amp; Attention
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setHomePane('ROLL_CALL')}
            className="text-2xs font-mono font-bold ap-text-brand underline cursor-pointer min-h-[32px]"
          >
            + Post Weather / Schedule Alert
          </button>
        </div>

        <div className="space-y-1.5">
          {flaggedTriageCount > 0 ? (
            <button
              type="button"
              data-testid="clipboard-flagged-triage-btn"
              onClick={onOpenHealthAttention}
              className="w-full min-h-[44px] rounded-xl ap-status-caution px-3.5 py-2 flex items-center justify-between gap-2 text-xs font-bold cursor-pointer"
            >
              <span className="inline-flex items-center gap-2 min-w-0">
                <Shield className="w-4 h-4 shrink-0" weight="bold" />
                <span className="truncate">
                  {flaggedTriageCount} {flaggedTriageCount === 1 ? 'Athlete' : 'Athletes'} Flagged (Pain / High Strain)
                </span>
              </span>
              <span className="font-mono text-2xs shrink-0 underline">Squad Triage →</span>
            </button>
          ) : (
            scopedConnectedAthletes.length > 0 && (
              <button
                type="button"
                onClick={onOpenRosterTab}
                className="w-full min-h-[40px] rounded-xl ap-card-inset px-3.5 py-1.5 flex items-center justify-between gap-2 text-xs font-semibold text-ap-ink dark:text-ap-chalk cursor-pointer"
              >
                <span className="truncate">
                  All {scopedConnectedAthletes.length} connected athletes clear for full training today
                </span>
                <span className="font-mono text-2xs ap-text-brand shrink-0 underline">
                  Roster →
                </span>
              </button>
            )
          )}

          {effectivePendingTimingCount > 0 ? (
            <button
              type="button"
              data-testid="quick-ops-pending-splits-btn"
              onClick={() => onOpenDelegateModal('REVIEW')}
              className="w-full min-h-[44px] rounded-xl ap-status-caution px-3.5 py-2 flex items-center justify-between gap-2 text-xs font-bold cursor-pointer"
            >
              <span className="inline-flex items-center gap-2 min-w-0">
                <Timer className="w-4 h-4 shrink-0" />
                <span className="truncate">
                  Pending Splits ({effectivePendingTimingCount}) awaiting coach approval
                </span>
              </span>
              <span className="font-mono text-2xs shrink-0 underline">Review →</span>
            </button>
          ) : (
            <button
              type="button"
              data-testid="quick-ops-pending-splits-btn"
              onClick={() => onOpenDelegateModal('REVIEW')}
              className="w-full min-h-[38px] rounded-xl ap-card-inset px-3.5 py-1.5 flex items-center justify-between gap-2 text-2xs font-mono font-semibold text-ap-muted dark:text-ap-muted-dark cursor-pointer"
            >
              <span>Pending Splits (0)</span>
              <span>Review Queue →</span>
            </button>
          )}

          {upcomingConflictCount > 0 && (
            <button
              type="button"
              data-testid="coach-home-rsvp-alert"
              onClick={onOpenMeetDayTab}
              className="w-full min-h-[44px] rounded-xl ap-status-info px-3.5 py-2 flex items-center justify-between gap-2 text-xs font-bold cursor-pointer"
            >
              <span className="truncate">
                {upcomingConflictCount} upcoming RSVP {upcomingConflictCount === 1 ? 'conflict / absence' : 'conflicts / absences'}
              </span>
              <span className="font-mono text-2xs shrink-0 underline">Meet &amp; Relays →</span>
            </button>
          )}

          {recentAnnouncements.map((ann) => (
            <div
              key={ann.id}
              className="rounded-xl ap-card-inset px-3 py-2 flex items-start justify-between gap-2 text-xs"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <Bell className="w-3.5 h-3.5 ap-text-brand shrink-0" />
                  <span className="font-bold text-ap-ink dark:text-ap-chalk truncate">
                    {ann.title}
                  </span>
                </div>
                <p className="text-2xs text-ap-muted dark:text-ap-muted-dark line-clamp-2">
                  {ann.body}
                </p>
              </div>
              <span className="px-2 py-0.5 rounded font-mono text-2xs uppercase bg-white/70 dark:bg-ap-carbon shrink-0">
                {ann.category}
              </span>
            </div>
          ))}

          {myTeams.length === 0 && connectedAthletesOnly.length === 0 && (
            <div className="rounded-xl ap-card-inset px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-ap-ink dark:text-ap-chalk">
                No team roster connected yet
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="coach-empty-wizard-btn"
                  onClick={onOpenSetupWizard}
                  className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl ap-btn-primary text-xs font-bold cursor-pointer"
                >
                  60s Setup Wizard
                </button>
                <button
                  type="button"
                  onClick={onOpenCreateTeamStudio}
                  className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl ap-btn-secondary text-xs font-semibold cursor-pointer"
                >
                  Invite / Create Team
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 3. MESSAGING PREVIEW & CHANNEL LAUNCH */}
      <section
        data-testid="coach-home-messaging"
        className="rounded-2xl liquid-glass p-3 sm:p-4 space-y-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <MessageSquare className="w-4 h-4 ap-text-brand shrink-0" />
            <h2 className="text-xs sm:text-sm font-extrabold text-ap-ink dark:text-ap-chalk">
              Team Messaging
            </h2>
          </div>
          {onOpenTeamMessages && (
            <button
              type="button"
              data-testid="coach-home-open-messaging-btn"
              onClick={() => onOpenTeamMessages('ALL_TEAM')}
              className="min-h-[40px] sm:min-h-[32px] px-3 py-1 rounded-xl ap-btn-primary text-2xs sm:text-xs font-bold cursor-pointer"
            >
              Open Team Chat →
            </button>
          )}
        </div>

        {onOpenTeamMessages && (
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { scope: 'ALL_TEAM', label: 'Whole Team' },
                { scope: 'EVENT_GROUP', label: 'Event Groups' },
                { scope: 'COACHES_STAFF', label: 'Coaches & Staff' },
                { scope: 'DIRECT_TRANSPARENT', label: 'Direct (SafeSport CC)' },
              ] as const
            ).map((ch) => (
              <button
                key={ch.scope}
                type="button"
                onClick={() => onOpenTeamMessages(ch.scope)}
                className="min-h-[36px] px-2.5 py-1 rounded-lg ap-card-inset text-2xs font-mono font-semibold text-ap-ink dark:text-ap-chalk cursor-pointer"
              >
                {ch.label}
              </button>
            ))}
          </div>
        )}

        {recentMessages.length === 0 ? (
          <p className="text-2xs text-ap-muted dark:text-ap-muted-dark rounded-xl ap-card-inset px-3 py-2">
            No team messages sent yet. Tap Open Team Chat to message athletes, parents, or assistant coaches.
          </p>
        ) : (
          <div className="space-y-1.5">
            {recentMessages.map((msg) => (
              <button
                key={msg.id}
                type="button"
                onClick={() => onOpenTeamMessages?.(msg.channelScope)}
                className="w-full text-left rounded-xl ap-card-inset px-3 py-2 flex items-start justify-between gap-2 cursor-pointer"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-2xs font-mono">
                    <span className="font-bold text-ap-ink dark:text-ap-chalk">
                      {msg.senderName}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-white/70 dark:bg-ap-carbon text-ap-muted dark:text-ap-muted-dark">
                      {formatMessageScopeLabel(msg.channelScope)}
                    </span>
                  </div>
                  <p className="text-xs text-ap-ink dark:text-ap-chalk line-clamp-1">
                    {msg.body}
                  </p>
                </div>
                <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark shrink-0">
                  {formatHomeTimestamp(msg.createdAt)}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
