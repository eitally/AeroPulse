import React, { Suspense } from 'react';
import type {
  AthleteProfile,
  CoachComplexityTier,
  CoachEventGroup,
  ConnectedAthleteRecord,
  PracticeVenueCategory,
  SportCategory,
  TeamSummaryWithRole,
  TrackWorkoutSpec,
  WorkoutSessionSlot,
} from '../../types';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { WorkspaceErrorBoundary } from '../WorkspaceErrorBoundary';
import {
  ClipboardText,
  Shield,
  Target,
  Timer,
  Users,
} from '../icons/PhosphorIcons';

const CoachDailyOpsPanel = lazyWithRetry(
  () => import('./CoachDailyOpsPanel').then((m) => ({ default: m.CoachDailyOpsPanel })),
  { chunkKey: 'CoachDailyOpsPanel', restoreTab: 'coach' }
);
const CoachClipboardWorkoutBuilder = lazyWithRetry(
  () =>
    import('../CoachClipboardWorkoutBuilder').then((m) => ({
      default: m.CoachClipboardWorkoutBuilder,
    })),
  { chunkKey: 'CoachClipboardWorkoutBuilder', restoreTab: 'coach' }
);

export interface CoachPracticeHomeProps {
  todayIso: string;
  activeTeam: TeamSummaryWithRole | null;
  myTeams: TeamSummaryWithRole[];
  connectedAthletesOnly: ConnectedAthleteRecord[];
  scopedConnectedAthletes: ConnectedAthleteRecord[];
  primaryAthleteDisplayName: string;
  selfProfile: AthleteProfile;
  complexityTier: CoachComplexityTier;
  defaultCoachEventGroup?: CoachEventGroup;
  effectiveAllowedEventGroups?: CoachEventGroup[];
  flaggedTriageCount: number;
  effectivePendingTimingCount: number;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string | null) => void;
  onCreatePlannedEvent: (event: {
    date: string;
    name: string;
    sportCategory: SportCategory;
    environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
    plannedDurationSecs: number;
    plannedLoad: number;
    workoutSyntax: string;
    description: string;
    scheduledTime?: string;
    sessionSlot?: WorkoutSessionSlot;
    locationName?: string;
    locationCategory?: PracticeVenueCategory;
    meetingNotes?: string;
    trackSpec?: TrackWorkoutSpec;
    replaceExistingDate?: boolean;
  }) => Promise<void>;
  onOpenStopwatch: (mode: 'STOPWATCH' | 'FIELD') => void;
  onOpenDelegateModal: (tab: 'CREATE' | 'REVIEW') => void;
  onOpenHealthAttention: () => void;
  onOpenRosterTab: () => void;
  onOpenSetupWizard: () => void;
  onOpenCreateTeamStudio: () => void;
}

export const CoachPracticeHome: React.FC<CoachPracticeHomeProps> = ({
  todayIso,
  activeTeam,
  myTeams,
  connectedAthletesOnly,
  scopedConnectedAthletes,
  primaryAthleteDisplayName,
  selfProfile,
  complexityTier,
  defaultCoachEventGroup,
  effectiveAllowedEventGroups,
  flaggedTriageCount,
  effectivePendingTimingCount,
  onTeamsUpdated,
  onCreatePlannedEvent,
  onOpenStopwatch,
  onOpenDelegateModal,
  onOpenHealthAttention,
  onOpenRosterTab,
  onOpenSetupWizard,
  onOpenCreateTeamStudio,
}) => {
  return (
    <div className="space-y-3">
      {/* 4 Giant Trackside Action Cards (0px scroll on Tuesday 3:15 PM) */}
      <section
        data-testid="coach-quick-ops-strip"
        className="rounded-2xl liquid-glass p-3 sm:p-3.5 space-y-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="px-2 py-0.5 rounded-md ap-status-info font-mono text-2xs font-bold uppercase tracking-wider">
              Today · {todayIso}
            </span>
            <span className="text-xs font-extrabold text-ap-ink dark:text-ap-chalk">
              3:15 PM Field Ops
            </span>
          </div>
          <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
            {scopedConnectedAthletes.length} active in scope
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <button
            type="button"
            data-testid="quick-ops-roll-call-btn"
            onClick={() => {
              const target =
                document.querySelector('[data-testid="coach-roll-call-panel"]') ||
                document.querySelector('[data-testid="coach-daily-ops-panel"]');
              target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="min-h-[64px] rounded-xl ap-btn-secondary px-3 py-2 text-left flex flex-col justify-between gap-1 cursor-pointer"
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
            data-testid="quick-ops-stopwatch-btn"
            onClick={() => onOpenStopwatch('STOPWATCH')}
            className="min-h-[64px] rounded-xl ap-btn-primary px-3 py-2 text-left flex flex-col justify-between gap-1 cursor-pointer"
          >
            <div className="flex items-center justify-between gap-1.5">
              <Timer className="w-4 h-4 shrink-0" weight="bold" />
              <span className="text-2xs font-mono uppercase opacity-80">Splits</span>
            </div>
            <span className="text-xs sm:text-sm font-extrabold">Track Stopwatch</span>
          </button>

          <button
            type="button"
            data-testid="quick-ops-field-marks-btn"
            onClick={() => onOpenStopwatch('FIELD')}
            className="min-h-[64px] rounded-xl ap-btn-secondary px-3 py-2 text-left flex flex-col justify-between gap-1 cursor-pointer"
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

          <div className="min-h-[64px] rounded-xl ap-card-inset p-2 flex flex-col justify-between gap-1.5">
            <button
              type="button"
              data-testid="quick-ops-delegate-timing-btn"
              onClick={() => onOpenDelegateModal('CREATE')}
              className="w-full min-h-[34px] px-2 py-1 rounded-lg ap-btn-secondary text-2xs sm:text-xs font-bold inline-flex items-center justify-between gap-1 cursor-pointer"
            >
              <span className="inline-flex items-center gap-1 truncate">
                <Users className="w-3.5 h-3.5 ap-text-brand shrink-0" />
                <span className="truncate">Delegate Timing</span>
              </span>
              <span className="text-2xs opacity-70">QR →</span>
            </button>
            <button
              type="button"
              data-testid="quick-ops-pending-splits-btn"
              onClick={() => onOpenDelegateModal('REVIEW')}
              className={`w-full min-h-[30px] px-2 py-0.5 rounded-lg text-2xs font-mono font-bold inline-flex items-center justify-between gap-1 cursor-pointer ${
                effectivePendingTimingCount > 0 ? 'ap-status-caution' : 'ap-card-inset'
              }`}
            >
              <span>Pending Splits ({effectivePendingTimingCount})</span>
              <span>Review</span>
            </button>
          </div>
        </div>
      </section>

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
            className="w-full min-h-[44px] sm:min-h-[36px] rounded-xl ap-card-inset px-3.5 py-1.5 flex items-center justify-between gap-2 text-xs font-semibold text-ap-ink dark:text-ap-chalk cursor-pointer"
          >
            <span className="truncate">
              All {scopedConnectedAthletes.length} connected athletes clear for full training today
            </span>
            <span className="font-mono text-2xs ap-text-brand shrink-0 underline">
              Roster Triage →
            </span>
          </button>
        )
      )}

      {myTeams.length === 0 && connectedAthletesOnly.length === 0 && (
        <section className="rounded-2xl liquid-glass px-3.5 py-2.5 sm:px-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Users className="w-4 h-4 ap-text-brand shrink-0" weight="duotone" />
            <span className="text-xs font-bold text-ap-ink dark:text-ap-chalk truncate">
              No team roster connected yet
            </span>
          </div>
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
        </section>
      )}

      {/* Daily Roll Call & Field Practice Ops right beneath Quick Ops */}
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
            hideDuplicateLaunchers={true}
            onLaunchStopwatch={() => onOpenStopwatch('STOPWATCH')}
            onLaunchFieldSheet={() => onOpenStopwatch('FIELD')}
            onTeamsUpdated={onTeamsUpdated}
          />
        </Suspense>
      </WorkspaceErrorBoundary>

      {/* Track & Field Clipboard Workout Builder */}
      <WorkspaceErrorBoundary fallbackTitle="Coach Clipboard" restoreTab="coach">
        <Suspense
          fallback={
            <div className="h-64 rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
              Loading Coach Clipboard…
            </div>
          }
        >
          <CoachClipboardWorkoutBuilder
            activeTeam={activeTeam}
            myTeams={myTeams}
            connectedAthletes={scopedConnectedAthletes}
            primaryAthleteDisplayName={primaryAthleteDisplayName}
            selfProfile={selfProfile}
            complexityTier={complexityTier}
            defaultEventGroup={defaultCoachEventGroup}
            onTeamsUpdated={onTeamsUpdated}
            onCreatePlannedEvent={onCreatePlannedEvent}
            onOpenStopwatchSubTab={() => onOpenStopwatch('STOPWATCH')}
          />
        </Suspense>
      </WorkspaceErrorBoundary>
    </div>
  );
};
