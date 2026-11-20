import React, { Suspense, useEffect, useMemo, useState } from 'react';
import type {
  AthleteProfile,
  CoachWorkspaceSubTab,
  ConnectedAthleteRecord,
  DistanceUnit,
  EnvironmentFilter,
  NcaaCaraSeasonSegment,
  PlannedWorkoutEvent,
  PracticeVenueCategory,
  SessionCheckInRecord,
  SportCategory,
  TargetGoal,
  TeamSummaryWithRole,
  TrackWorkoutSpec,
  UnifiedActivity,
  UnifiedWellnessDay,
  WorkoutSessionSlot,
} from '../types';
import {
  buildNcaaCaraComplianceCsv,
  summarizeNcaaCaraWeeklyHours,
  type NcaaCaraCsvRow,
  type VdotPodRosterInput,
} from '../physiology/scholasticEngine';
import { evaluateSafeSportPatternWatch } from '../physiology/safeSportPatternWatchEngine';
import { resolveAthleteAgeTier } from '../physiology/ageAndComplianceEngine';
import { buildCoachSquadExecutionDigest } from '../physiology/sessionCheckInAndDigestEngine';
import { resolveWorkspaceSportAndRoleScope } from '../utils/workspaceScope';
import { buildThreshSessionHeaders } from '../utils/teamLifecycleApi';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { WorkspaceErrorBoundary } from './WorkspaceErrorBoundary';
import type { SavedStopwatchEntry } from './TracksideStopwatchView';
import type {
  StopwatchOutboxFlushResult,
  StopwatchSaveResult,
} from '../utils/stopwatchTeamSync';
import { CoachExecutionDigestPanel } from './CoachExecutionDigestPanel';
import { getLocalDateIso } from '../physiology/trainingProductivityEngine';
import {
  ChevronDown,
  Download,
  Globe,
  HelpCircle,
  Shield,
  Users,
} from './icons/PhosphorIcons';

const CalendarView = lazyWithRetry(
  () => import('./CalendarView').then((m) => ({ default: m.CalendarView })),
  { chunkKey: 'CoachCalendarView', restoreTab: 'coach' }
);
const TeamManagementPanel = lazyWithRetry(
  () => import('./TeamManagementPanel').then((m) => ({ default: m.TeamManagementPanel })),
  { chunkKey: 'TeamManagementPanel', restoreTab: 'coach' }
);
const AthleticNetTfrrsSyncModal = lazyWithRetry(
  () =>
    import('./AthleticNetTfrrsSyncModal').then((m) => ({
      default: m.AthleticNetTfrrsSyncModal,
    })),
  { chunkKey: 'AthleticNetTfrrsSyncModal', restoreTab: 'coach' }
);
const TracksideStopwatchView = lazyWithRetry(
  () => import('./TracksideStopwatchView').then((m) => ({ default: m.TracksideStopwatchView })),
  { chunkKey: 'CoachTracksideStopwatchView', restoreTab: 'coach' }
);
const ScholasticRelayAndTopTimesPanel = lazyWithRetry(
  () =>
    import('./track/ScholasticRelayAndTopTimesPanel').then((m) => ({
      default: m.ScholasticRelayAndTopTimesPanel,
    })),
  { chunkKey: 'ScholasticRelayAndTopTimesPanel', restoreTab: 'coach' }
);
const CoachClipboardWorkoutBuilder = lazyWithRetry(
  () =>
    import('./CoachClipboardWorkoutBuilder').then((m) => ({
      default: m.CoachClipboardWorkoutBuilder,
    })),
  { chunkKey: 'CoachClipboardWorkoutBuilder', restoreTab: 'coach' }
);

export interface CoachWorkspaceViewProps {
  subTab: CoachWorkspaceSubTab;
  setSubTab: (tab: CoachWorkspaceSubTab) => void;
  activeTeam: TeamSummaryWithRole | null;
  myTeams: TeamSummaryWithRole[];
  activeTeamId: string | null;
  onSelectActiveTeam: (teamId: string | null) => void;
  combinedRoster: ConnectedAthleteRecord[];
  activeViewedAthleteId: string;
  onSelectAthleteViewport: (athleteId: string) => void;
  primaryAthleteDisplayName: string;
  selfProfile: AthleteProfile;
  athleteFtp: number;
  selfSessionCheckIns?: SessionCheckInRecord[];
  effectivePlannedEvents: PlannedWorkoutEvent[];
  effectiveActivities: UnifiedActivity[];
  effectiveWellnessDays: UnifiedWellnessDay[];
  effectiveTargetGoals: TargetGoal[];
  envFilter: EnvironmentFilter;
  selectedSport: SportCategory | 'ALL';
  onSelectSport: (sport: SportCategory | 'ALL') => void;
  distanceUnit: DistanceUnit;
  resendConfigured: boolean;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string | null) => void;
  onSelectActivityAndOpenTab: (act: UnifiedActivity) => void;
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
    sessionSlot?: import('../types').WorkoutSessionSlot;
    locationName?: string;
    locationCategory?: import('../types').PracticeVenueCategory;
    meetingNotes?: string;
    trackSpec?: TrackWorkoutSpec;
    replaceExistingDate?: boolean;
  }) => Promise<void>;
  onUpdatePlannedEvent?: (
    id: string,
    patch: {
      date: string;
      name: string;
      sportCategory: SportCategory;
      environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
      plannedDurationSecs: number;
      plannedLoad: number;
      workoutSyntax: string;
      description: string;
      scheduledTime?: string;
      sessionSlot?: import('../types').WorkoutSessionSlot;
      locationName?: string;
      locationCategory?: import('../types').PracticeVenueCategory;
      meetingNotes?: string;
      trackSpec?: TrackWorkoutSpec;
    }
  ) => Promise<void>;
  onDeletePlannedEvent: (id: string) => Promise<void>;
  onDeletePlanBlock?: (planBlockId: string) => Promise<void>;
  onBatchCreatePlannedEvents: (
    events: {
      date: string;
      name: string;
      sportCategory: SportCategory;
      environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
      plannedDurationSecs: number;
      plannedLoad: number;
      workoutSyntax: string;
      description: string;
      trackSpec?: TrackWorkoutSpec;
    }[],
    clearFutureEvents?: boolean
  ) => Promise<void>;
  onOpenProfileModal: () => void;
  onOpenGoalsTab: () => void;
  onOpenOfficialRaceModal: () => void;
  onOpenCoachWithPrompt: (prompt: string) => void;
  onSaveStopwatchActivities: (
    entries: SavedStopwatchEntry[]
  ) => Promise<StopwatchSaveResult> | StopwatchSaveResult | number;
  onFlushStopwatchOutbox?: () => Promise<StopwatchOutboxFlushResult>;
  onOpenAthleteToday: () => void;
  onOpenRosterModal: () => void;
  onOpenPublicTeamHub?: (slugOrCode: string) => void;
  onOpenCoachGuide?: () => void;
  isSampleDemoMode?: boolean;
}

export const CoachWorkspaceView: React.FC<CoachWorkspaceViewProps> = ({
  subTab,
  setSubTab,
  activeTeam,
  myTeams,
  activeTeamId,
  onSelectActiveTeam,
  combinedRoster,
  activeViewedAthleteId,
  onSelectAthleteViewport,
  primaryAthleteDisplayName,
  selfProfile,
  athleteFtp,
  selfSessionCheckIns = [],
  effectivePlannedEvents,
  effectiveActivities,
  effectiveWellnessDays,
  effectiveTargetGoals,
  envFilter,
  selectedSport,
  onSelectSport,
  distanceUnit,
  resendConfigured,
  onTeamsUpdated,
  onSelectActivityAndOpenTab,
  onCreatePlannedEvent,
  onUpdatePlannedEvent,
  onDeletePlannedEvent,
  onDeletePlanBlock,
  onBatchCreatePlannedEvents,
  onOpenProfileModal,
  onOpenGoalsTab,
  onOpenOfficialRaceModal,
  onOpenCoachWithPrompt,
  onSaveStopwatchActivities,
  onFlushStopwatchOutbox,
  onOpenAthleteToday,
  onOpenRosterModal,
  onOpenPublicTeamHub,
  onOpenCoachGuide,
  isSampleDemoMode = false,
}) => {
  const [openCreateTeamOnSwitch, setOpenCreateTeamOnSwitch] = useState<boolean>(false);
  const [isExternalSyncOpen, setIsExternalSyncOpen] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined' && window.location.hash === '#coach-sync';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const handleHashSync = () => {
      try {
        if (window.location.hash === '#coach-sync') {
          setIsExternalSyncOpen(true);
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener('hashchange', handleHashSync);
    return () => window.removeEventListener('hashchange', handleHashSync);
  }, []);

  const handleCloseExternalSync = () => {
    setIsExternalSyncOpen(false);
    try {
      if (typeof window !== 'undefined' && window.location.hash === '#coach-sync') {
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${window.location.search}#coach`
        );
      }
    } catch {
      // ignore
    }
  };

  const [teamPlanError, setTeamPlanError] = useState<string | null>(null);

  const handleTeamPlanCreate = async (eventInput: {
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
  }) => {
    setTeamPlanError(null);
    const canBroadcastTeam =
      activeTeam &&
      (activeTeam.myRole === 'HEAD_COACH' ||
        activeTeam.myRole === 'ASSISTANT_COACH' ||
        activeTeam.myRole === 'ORG_ADMIN');
    if (canBroadcastTeam && activeTeam) {
      if (isSampleDemoMode || activeTeam.brand.teamId.startsWith('demo_team_')) {
        const newBroadcast = {
          broadcastId: `bw_demo_${Date.now()}`,
          teamId: activeTeam.brand.teamId,
          targetSquadGroup: 'ALL',
          date: eventInput.date,
          name: eventInput.name,
          sportCategory: eventInput.sportCategory,
          plannedDurationSecs: eventInput.plannedDurationSecs,
          plannedLoad: eventInput.plannedLoad,
          workoutSyntax: eventInput.workoutSyntax,
          description: eventInput.description,
          ...(eventInput.scheduledTime ? { scheduledTime: eventInput.scheduledTime } : {}),
          ...(eventInput.sessionSlot ? { sessionSlot: eventInput.sessionSlot } : {}),
          ...(eventInput.locationName ? { locationName: eventInput.locationName } : {}),
          ...(eventInput.locationCategory
            ? { locationCategory: eventInput.locationCategory }
            : {}),
          ...(eventInput.meetingNotes ? { meetingNotes: eventInput.meetingNotes } : {}),
          ...(eventInput.trackSpec ? { trackSpec: eventInput.trackSpec } : {}),
          pushedByCoachName: activeTeam.brand.coachDisplayName || 'Coach',
          createdAt: new Date().toISOString(),
        };
        const updatedTeam = {
          ...activeTeam,
          broadcastWorkouts: [...(activeTeam.broadcastWorkouts || []), newBroadcast],
        };
        onTeamsUpdated(
          myTeams.map((t) =>
            t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
          ),
          updatedTeam.brand.teamId
        );
        return;
      }
      try {
        const resp = await fetch(
          `/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}/workouts/broadcast`,
          {
            method: 'POST',
            credentials: 'include',
            headers: buildThreshSessionHeaders(),
            body: JSON.stringify({
              origin: window.location.origin,
              targetSquadGroup: 'ALL',
              date: eventInput.date,
              name: eventInput.name,
              sportCategory: eventInput.sportCategory,
              plannedDurationSecs: eventInput.plannedDurationSecs,
              plannedLoad: eventInput.plannedLoad,
              workoutSyntax: eventInput.workoutSyntax,
              description: eventInput.description,
              ...(eventInput.scheduledTime ? { scheduledTime: eventInput.scheduledTime } : {}),
              ...(eventInput.sessionSlot ? { sessionSlot: eventInput.sessionSlot } : {}),
              ...(eventInput.locationName ? { locationName: eventInput.locationName } : {}),
              ...(eventInput.locationCategory
                ? { locationCategory: eventInput.locationCategory }
                : {}),
              ...(eventInput.meetingNotes ? { meetingNotes: eventInput.meetingNotes } : {}),
              ...(eventInput.trackSpec ? { trackSpec: eventInput.trackSpec } : {}),
              replaceSameDateTarget:
                typeof eventInput.replaceExistingDate === 'boolean'
                  ? eventInput.replaceExistingDate &&
                    (eventInput.sessionSlot || 'SINGLE') === 'SINGLE'
                  : (eventInput.sessionSlot || 'SINGLE') === 'SINGLE',
            }),
          }
        );
        const data = await resp.json().catch(() => ({}));
        if (resp.ok) {
          if (Array.isArray(data.teams)) {
            onTeamsUpdated(data.teams, activeTeam.brand.teamId);
          }
          return;
        }
        setTeamPlanError(data?.error || 'Could not broadcast team session to server.');
        return;
      } catch {
        // Fallback to local state only when offline
      }
    }
    await onCreatePlannedEvent(eventInput);
  };
  const connectedAthletesOnly = useMemo(
    () =>
      combinedRoster.filter(
        (a) =>
          a.status === 'CONNECTED' &&
          a.teamMemberStatus !== 'ALUMNI' &&
          a.teamMemberStatus !== 'OFF_SEASON' &&
          a.teamMemberStatus !== 'REVOKED'
      ),
    [combinedRoster]
  );

  const podRoster = useMemo<VdotPodRosterInput[]>(() => {
    const activePodAthletes = connectedAthletesOnly.filter(
      (a) => a.teamMemberStatus !== 'INJURED'
    );
    if (activePodAthletes.length === 0) {
      return [
        {
          id: 'SELF',
          name: primaryAthleteDisplayName || 'Lead Runner',
          thresholdPaceSecsPerKm: selfProfile.thresholdPaceSecsPerKm || 245,
        },
      ];
    }
    return activePodAthletes.map((a) => ({
      id: a.id,
      name: a.name,
      thresholdPaceSecsPerKm: a.athleteProfile.thresholdPaceSecsPerKm || 250,
    }));
  }, [connectedAthletesOnly, primaryAthleteDisplayName, selfProfile.thresholdPaceSecsPerKm]);

  const relayCandidates = useMemo(
    () =>
      connectedAthletesOnly
        .filter((a) => a.teamMemberStatus !== 'INJURED')
        .map((a) => ({
          id: a.id,
          name: a.name,
          thresholdPaceSecsPerKm: a.athleteProfile.thresholdPaceSecsPerKm || 250,
          genderDivision:
            a.genderDivision ||
            (a.athleteProfile.competitionGender === 'WOMEN'
              ? 'F'
              : a.athleteProfile.competitionGender === 'MEN'
                ? 'M'
                : undefined),
        })),
    [connectedAthletesOnly]
  );

  const [showRelayAndTopTimes, setShowRelayAndTopTimes] = useState<boolean>(false);
  const [caraSegment, setCaraSegment] = useState<NcaaCaraSeasonSegment>('IN_SEASON');
  const [caraStrengthHours, setCaraStrengthHours] = useState<number>(0);
  const [caraMeetingHours, setCaraMeetingHours] = useState<number>(0);
  const [caraVaraHours, setCaraVaraHours] = useState<number>(0);

  const workspaceScope = useMemo(
    () =>
      resolveWorkspaceSportAndRoleScope({
        athleteProfile: selfProfile,
        activeTeam,
      }),
    [selfProfile, activeTeam]
  );

  const todayIso = getLocalDateIso();

  const teamPlanEvents = useMemo(() => {
    if (!activeTeam) return effectivePlannedEvents;
    const broadcastIds = new Set(
      (activeTeam.broadcastWorkouts || []).map((bw) => bw.broadcastId)
    );
    const scoped = effectivePlannedEvents.filter((ev) => broadcastIds.has(ev.id));
    return scoped.length > 0 ? scoped : effectivePlannedEvents;
  }, [activeTeam, effectivePlannedEvents]);

  const flaggedTriageCount = useMemo(() => {
    const digest = buildCoachSquadExecutionDigest({
      roster: connectedAthletesOnly,
      selfFallback: {
        id: 'SELF',
        name: primaryAthleteDisplayName || 'Coach / Demo Athlete',
        plannedEvents: effectivePlannedEvents,
        activities: effectiveActivities,
        sessionCheckIns: selfSessionCheckIns,
      },
      todayIso,
      windowDays: 7,
    });
    const flaggedIds = new Set<string>();
    for (const r of digest.rows) {
      if (r.attentionReason !== 'ON_TRACK') flaggedIds.add(r.athleteId);
    }
    for (const ath of connectedAthletesOnly) {
      const latestW =
        ath.wellnessDays && ath.wellnessDays.length > 0
          ? ath.wellnessDays[ath.wellnessDays.length - 1]
          : null;
      const tsb = latestW?.tsb ?? 0;
      const hrv = latestW?.hrvRMSSD ?? 60;
      const watchLight = evaluateSafeSportPatternWatch({
        activities: ath.activities || [],
        wellnessDays: ath.wellnessDays || [],
        isMinorU18:
          typeof ath.isMinorU18 === 'boolean'
            ? ath.isMinorU18
            : resolveAthleteAgeTier({
                birthMonthYear: ath.athleteProfile.birthMonthYear,
              }).isMinorU18,
      }).trafficLight;
      if (tsb < -20 || hrv < 48 || watchLight !== 'GREEN_CLEAR') {
        flaggedIds.add(ath.id);
      }
    }
    return flaggedIds.size;
  }, [
    connectedAthletesOnly,
    primaryAthleteDisplayName,
    effectivePlannedEvents,
    effectiveActivities,
    selfSessionCheckIns,
    todayIso,
  ]);

  return (
    <div className="space-y-3" data-testid="coach-workspace-view">
      {/* Unified Coach Mode Context Header — omitted on Stopwatch so athletes sit at 0px scroll */}
      {subTab !== 'STOPWATCH' && (
        <section className="rounded-2xl liquid-glass px-3.5 py-2.5 sm:px-4 sm:py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <h1 className="text-base sm:text-lg font-bold text-ap-ink dark:text-ap-chalk tracking-tight truncate">
                {activeTeam ? `${activeTeam.brand.name} · Coach` : 'Coach Workspace'}
              </h1>
              {activeTeam && (
                <span className="px-2 py-0.5 rounded-md text-2xs font-mono font-semibold bg-[#E3ECE5] text-ap-cobalt dark:bg-ap-turf dark:text-ap-volt">
                  {activeTeam.brand.joinCode}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {myTeams.length > 0 && (
                <select
                  value={activeTeamId || ''}
                  onChange={(e) => onSelectActiveTeam(e.target.value || null)}
                  aria-label="Select Team in Coach Workspace"
                  className="min-h-[44px] sm:min-h-[36px] rounded-xl border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-xs font-semibold text-ap-ink dark:text-ap-chalk"
                >
                  {myTeams.map((t) => (
                    <option key={t.brand.teamId} value={t.brand.teamId}>
                      {t.brand.shortName || t.brand.name}
                    </option>
                  ))}
                  <option value="">Personal Mode</option>
                </select>
              )}

              <button
                type="button"
                data-testid="coach-open-cohort-plan-builder"
                onClick={() => {
                  try {
                    window.sessionStorage.setItem('thresh_open_plan_cohort', 'TEAM_ALL');
                  } catch {
                    // ignore storage failures
                  }
                  onOpenGoalsTab();
                }}
                className="min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-xl ap-btn-secondary text-xs font-semibold cursor-pointer"
              >
                Build Cohort Plan
              </button>
              <button
                type="button"
                data-testid="coach-open-external-sync-btn"
                onClick={() => setIsExternalSyncOpen(true)}
                className="min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-xl ap-btn-secondary text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5" weight="duotone" />
                <span>Athletic.net / TFRRS</span>
              </button>
              {onOpenCoachGuide && (
                <button
                  type="button"
                  data-testid="coach-open-guide-btn"
                  onClick={onOpenCoachGuide}
                  className="min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-xl ap-btn-secondary text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <HelpCircle className="w-3.5 h-3.5 ap-text-brand" />
                  <span>Coach Guide</span>
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 1. CLIPBOARD (COACH HOME — Opens at 0px scroll directly on Workout Builder) */}
      {subTab === 'CLIPBOARD' && (
        <div className="space-y-3">
          {flaggedTriageCount > 0 ? (
            <button
              type="button"
              data-testid="clipboard-flagged-triage-btn"
              onClick={() => setSubTab('ROSTER')}
              className="w-full min-h-[44px] rounded-xl ap-status-caution px-3.5 py-2 flex items-center justify-between gap-2 text-xs font-bold cursor-pointer"
            >
              <span className="inline-flex items-center gap-2 min-w-0">
                <Shield className="w-4 h-4 shrink-0" weight="bold" />
                <span className="truncate">
                  {flaggedTriageCount}{' '}
                  {flaggedTriageCount === 1 ? 'Athlete' : 'Athletes'} Flagged (Pain / High Strain)
                </span>
              </span>
              <span className="font-mono text-2xs shrink-0 underline">
                Review Squad Triage →
              </span>
            </button>
          ) : (
            connectedAthletesOnly.length > 0 && (
              <button
                type="button"
                onClick={() => setSubTab('ROSTER')}
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card-inset px-3.5 py-2 flex items-center justify-between gap-2 text-xs font-semibold text-ap-ink dark:text-ap-chalk cursor-pointer"
              >
                <span className="truncate">
                  All {connectedAthletesOnly.length} connected athletes clear for full training today
                </span>
                <span className="font-mono text-2xs ap-text-brand shrink-0 underline">
                  Open 7d Squad Triage →
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
              <button
                type="button"
                data-testid="coach-empty-setup-btn"
                onClick={() => {
                  setOpenCreateTeamOnSwitch(true);
                  setSubTab('ROSTER');
                }}
                className="ap-btn-primary !min-h-[44px] sm:!min-h-[36px] px-3.5 py-1.5 text-xs font-bold cursor-pointer"
              >
                Set Up Team or Import Roster
              </button>
            </section>
          )}

          {/* Track Multi-Set Workout Builder, Event Groups & Pace Pod Splits */}
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
                connectedAthletes={connectedAthletesOnly}
                primaryAthleteDisplayName={primaryAthleteDisplayName}
                selfProfile={selfProfile}
                onTeamsUpdated={onTeamsUpdated}
                onCreatePlannedEvent={onCreatePlannedEvent}
                onOpenStopwatchSubTab={() => setSubTab('STOPWATCH')}
              />
            </Suspense>
          </WorkspaceErrorBoundary>

          {workspaceScope.showRelayOptimizer && (
          <div className="rounded-2xl liquid-glass overflow-hidden">
            <button
              type="button"
              aria-expanded={showRelayAndTopTimes}
              onClick={() => setShowRelayAndTopTimes((prev) => !prev)}
              className="w-full min-h-[44px] px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs font-bold text-ap-ink dark:text-ap-chalk cursor-pointer"
            >
              <span>Relay Optimizer &amp; NFHS FAT Top Times</span>
              <ChevronDown
                className={`w-4 h-4 text-ap-muted dark:text-ap-muted-dark transition-transform ${
                  showRelayAndTopTimes ? 'rotate-180' : ''
                }`}
              />
            </button>
            {showRelayAndTopTimes && (
              <div className="px-3 pb-3 pt-1">
                <WorkspaceErrorBoundary fallbackTitle="Relay & Top Times" restoreTab="coach">
                  <Suspense
                    fallback={
                      <div className="h-32 rounded-xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                        Loading Relay Optimizer…
                      </div>
                    }
                  >
                    <ScholasticRelayAndTopTimesPanel
                      candidates={relayCandidates.length > 0 ? relayCandidates : podRoster}
                      roster={combinedRoster.filter(
                        (a) =>
                          a.status === 'CONNECTED' &&
                          a.teamMemberStatus !== 'REVOKED'
                      )}
                    />
                  </Suspense>
                </WorkspaceErrorBoundary>
              </div>
            )}
          </div>
          )}
        </div>
      )}

      {/* 2. TEAM PLAN */}
      {subTab === 'TEAM_PLAN' && (
        <div className="space-y-3">
          {teamPlanError && (
            <div
              role="alert"
              className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50/90 dark:bg-red-950/50 px-3.5 py-2 text-xs font-semibold text-red-700 dark:text-red-300"
            >
              {teamPlanError}
            </div>
          )}
          <WorkspaceErrorBoundary fallbackTitle="Team Plan Calendar" restoreTab="coach">
            <Suspense
              fallback={
                <div className="h-80 rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                  Loading Team Plan Calendar…
                </div>
              }
            >
              <CalendarView
                activities={effectiveActivities}
                wellnessDays={effectiveWellnessDays}
                plannedEvents={teamPlanEvents}
                targetGoals={effectiveTargetGoals}
                envFilter={envFilter}
                selectedSport={selectedSport}
                onSelectSport={onSelectSport}
                distanceUnit={distanceUnit}
                athleteFtp={athleteFtp}
                athleteProfile={selfProfile}
                onSelectActivity={onSelectActivityAndOpenTab}
                onCreatePlannedEvent={handleTeamPlanCreate}
                onUpdatePlannedEvent={onUpdatePlannedEvent}
                onDeletePlannedEvent={onDeletePlannedEvent}
                onDeletePlanBlock={onDeletePlanBlock}
                onBatchCreatePlannedEvents={onBatchCreatePlannedEvents}
                onOpenTodayWorkout={onOpenAthleteToday}
                onOpenAthleteProfileModal={onOpenProfileModal}
                onOpenGoalsArchitect={onOpenGoalsTab}
                onOpenOfficialRaceModal={onOpenOfficialRaceModal}
                onOpenCoachWithPrompt={onOpenCoachWithPrompt}
                onOpenTracksideStopwatch={() => setSubTab('STOPWATCH')}
              />
            </Suspense>
          </WorkspaceErrorBoundary>
        </div>
      )}

      {/* 3. STOPWATCH */}
      {subTab === 'STOPWATCH' && (
        <WorkspaceErrorBoundary fallbackTitle="Trackside Stopwatch" restoreTab="coach">
          <Suspense
            fallback={
              <div className="h-80 rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                Loading Trackside Stopwatch…
              </div>
            }
          >
            <TracksideStopwatchView
              selfName={primaryAthleteDisplayName}
              selfProfile={selfProfile}
              roster={combinedRoster}
              myTeams={myTeams}
              activeTeamId={activeTeamId}
              onSaveStopwatchActivities={onSaveStopwatchActivities}
              onFlushStopwatchOutbox={onFlushStopwatchOutbox}
              onOpenActivitiesTab={() => setSubTab('TEAM_PLAN')}
              postSaveActionLabel="View Team Plan"
              onOpenRosterModal={() => setSubTab('ROSTER')}
            />
          </Suspense>
        </WorkspaceErrorBoundary>
      )}

      {/* 4. ROSTER, SQUAD TRIAGE & TEAM SETTINGS */}
      {subTab === 'ROSTER' && (
        <div className="space-y-3">
          <CoachExecutionDigestPanel
            roster={connectedAthletesOnly}
            selfFallback={{
              id: 'SELF',
              name: primaryAthleteDisplayName || 'Coach / Demo Athlete',
              plannedEvents: effectivePlannedEvents,
              activities: effectiveActivities,
              sessionCheckIns: selfSessionCheckIns,
            }}
            todayIso={todayIso}
            activeTeam={activeTeam}
            myTeams={myTeams}
            isSampleDemoMode={isSampleDemoMode}
            onTeamsUpdated={onTeamsUpdated}
            primaryAthleteDisplayName={primaryAthleteDisplayName}
            onInspectAthlete={(athId) => {
              onSelectAthleteViewport(athId);
              onOpenAthleteToday();
            }}
            onOpenTeamPlan={() => setSubTab('TEAM_PLAN')}
          />

          <WorkspaceErrorBoundary fallbackTitle="Team Roster & Management" restoreTab="coach">
            <Suspense
              fallback={
                <div className="h-64 rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                  Loading Team Management…
                </div>
              }
            >
              <TeamManagementPanel
                selfName={primaryAthleteDisplayName}
                myTeams={myTeams}
                activeTeamId={activeTeamId}
                resendConfigured={resendConfigured}
                isSampleDemoMode={isSampleDemoMode}
                initialShowCreateStudio={openCreateTeamOnSwitch}
                onSelectActiveTeam={onSelectActiveTeam}
                onTeamsUpdated={onTeamsUpdated}
                onOpenClipboard={() => setSubTab('CLIPBOARD')}
                onOpenExternalSync={() => setIsExternalSyncOpen(true)}
                onOpenPublicTeamHub={onOpenPublicTeamHub}
              />
            </Suspense>
          </WorkspaceErrorBoundary>

          {activeTeam?.brand?.orgType === 'COLLEGIATE' && workspaceScope.showNcaaCara && (
          <section
            data-testid="coach-cara-audit"
            className="rounded-2xl liquid-glass p-4 sm:p-5 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  Weekly Practice Hours ({caraSegment === 'OUT_OF_SEASON' ? '8h Out-of-Season' : '20h In-Season'} Cap)
                </h2>
                <span className="px-2 py-0.5 rounded font-mono text-2xs font-bold ap-status-info">
                  3.0h Comp Day
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="group"
                  aria-label="NCAA CARA Season Segment"
                  className="inline-flex items-center gap-0.5 p-0.5 rounded-lg liquid-capsule-track text-2xs font-semibold"
                >
                  <button
                    type="button"
                    data-testid="cara-segment-in-season"
                    aria-pressed={caraSegment === 'IN_SEASON'}
                    onClick={() => setCaraSegment('IN_SEASON')}
                    className={`min-h-[44px] sm:min-h-[34px] px-2.5 py-0.5 rounded-md cursor-pointer ${
                      caraSegment === 'IN_SEASON'
                        ? 'ap-nav-volt-active'
                        : 'text-ap-muted dark:text-ap-muted-dark'
                    }`}
                  >
                    In-Season (20h)
                  </button>
                  <button
                    type="button"
                    data-testid="cara-segment-out-of-season"
                    aria-pressed={caraSegment === 'OUT_OF_SEASON'}
                    onClick={() => setCaraSegment('OUT_OF_SEASON')}
                    className={`min-h-[44px] sm:min-h-[34px] px-2.5 py-0.5 rounded-md cursor-pointer ${
                      caraSegment === 'OUT_OF_SEASON'
                        ? 'ap-nav-volt-active'
                        : 'text-ap-muted dark:text-ap-muted-dark'
                    }`}
                  >
                    Out-of-Season (8h)
                  </button>
                </div>

                {connectedAthletesOnly.length > 0 && (
                  <button
                    type="button"
                    data-testid="cara-export-csv-btn"
                    onClick={() => {
                      const csvRows: NcaaCaraCsvRow[] = connectedAthletesOnly.map((ath) => {
                        const audit = summarizeNcaaCaraWeeklyHours(
                          ath.activities,
                          todayIso,
                          0,
                          [],
                          {
                            seasonSegment: caraSegment,
                            strengthHours: caraStrengthHours,
                            meetingFilmHours: caraMeetingHours,
                            varaHours: caraVaraHours,
                          }
                        );
                        return {
                          athleteName: ath.name,
                          seasonSegment: caraSegment,
                          weekEndingIso: todayIso,
                          audit,
                          varaHours: caraVaraHours,
                        };
                      });
                      const csvContent = buildNcaaCaraComplianceCsv(csvRows);
                      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const anchor = document.createElement('a');
                      anchor.href = url;
                      anchor.download = `thresh-ncaa-cara-${todayIso}.csv`;
                      document.body.appendChild(anchor);
                      anchor.click();
                      document.body.removeChild(anchor);
                      URL.revokeObjectURL(url);
                    }}
                    className="ap-btn-secondary !min-h-[44px] sm:!min-h-[34px] px-3 py-1 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 ap-text-brand" />
                    <span>Export ARMS / Teamworks CSV</span>
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <label className="rounded-xl border border-stone-200 dark:border-ap-edge bg-white/70 dark:bg-ap-carbon px-3 py-2 flex items-center justify-between gap-2">
                <span className="text-2xs font-mono text-slate-600 dark:text-slate-300">
                  Weights / S&amp;C (h)
                </span>
                <input
                  data-testid="cara-weights-input"
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  value={caraStrengthHours}
                  onChange={(e) =>
                    setCaraStrengthHours(Math.max(0, Math.min(10, Number(e.target.value) || 0)))
                  }
                  className="w-20 min-h-[40px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2 py-1 text-right font-mono text-xs text-slate-900 dark:text-white"
                />
              </label>
              <label className="rounded-xl border border-stone-200 dark:border-ap-edge bg-white/70 dark:bg-ap-carbon px-3 py-2 flex items-center justify-between gap-2">
                <span className="text-2xs font-mono text-slate-600 dark:text-slate-300">
                  Meetings / Film (h)
                </span>
                <input
                  data-testid="cara-meetings-input"
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  value={caraMeetingHours}
                  onChange={(e) =>
                    setCaraMeetingHours(Math.max(0, Math.min(10, Number(e.target.value) || 0)))
                  }
                  className="w-20 min-h-[40px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2 py-1 text-right font-mono text-xs text-slate-900 dark:text-white"
                />
              </label>
              <label className="rounded-xl border border-stone-200 dark:border-ap-edge bg-white/70 dark:bg-ap-carbon px-3 py-2 flex items-center justify-between gap-2">
                <span className="text-2xs font-mono text-slate-600 dark:text-slate-300">
                  VARA Excluded (h)
                </span>
                <input
                  data-testid="cara-vara-input"
                  type="number"
                  min={0}
                  max={15}
                  step={0.5}
                  value={caraVaraHours}
                  onChange={(e) =>
                    setCaraVaraHours(Math.max(0, Math.min(15, Number(e.target.value) || 0)))
                  }
                  className="w-20 min-h-[40px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2 py-1 text-right font-mono text-xs text-slate-900 dark:text-white"
                />
              </label>
            </div>

            {connectedAthletesOnly.length === 0 ? (
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Connect roster athletes above to monitor rolling 7-day {caraSegment === 'OUT_OF_SEASON' ? '8h out-of-season' : '20h in-season'} practice hour caps, mandatory days off, and 3.0h competition day limits.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {connectedAthletesOnly.map((ath) => {
                  const baseAudit = summarizeNcaaCaraWeeklyHours(
                    ath.activities,
                    todayIso,
                    0,
                    [],
                    {
                      seasonSegment: caraSegment,
                      strengthHours: caraStrengthHours,
                      meetingFilmHours: caraMeetingHours,
                      varaHours: caraVaraHours,
                    }
                  );
                  const hours =
                    ath.activities.length === 0 && typeof ath.caraHours7d === 'number'
                      ? Number(
                          (ath.caraHours7d + caraStrengthHours + caraMeetingHours).toFixed(1)
                        )
                      : baseAudit.rolling7dCountableHours;
                  const compliant =
                    hours <= baseAudit.weeklyCapHours &&
                    baseAudit.maxSingleDayHours <= baseAudit.dailyCapHours &&
                    (ath.activities.length === 0 || baseAudit.daysOffCompliant !== false) &&
                    baseAudit.outOfSeasonSkillCompliant !== false;
                  return (
                    <div
                      key={`cara-${ath.id}`}
                      className="rounded-xl border border-stone-200 dark:border-ap-edge bg-white/80 dark:bg-ap-carbon p-3 text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-900 dark:text-white">{ath.name}</span>
                        <span
                          className={`px-2 py-0.5 rounded text-2xs font-mono font-bold ${
                            compliant ? 'ap-status-prime' : 'ap-status-strained'
                          }`}
                        >
                          {hours}h / {baseAudit.weeklyCapHours}h
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-1 text-2xs font-mono text-slate-600 dark:text-slate-300">
                        <span>
                          Days Off: {baseAudit.daysOffCount ?? 7}/{baseAudit.requiredDaysOff ?? 1}
                        </span>
                        {caraVaraHours > 0 && (
                          <span>VARA Excl: {caraVaraHours.toFixed(1)}h</span>
                        )}
                      </div>
                      {!compliant && (
                        <div className="text-2xs font-semibold text-rose-700 dark:text-rose-300">
                          {baseAudit.statusLabel}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          )}
        </div>
      )}

      {isExternalSyncOpen && (
        <WorkspaceErrorBoundary fallbackTitle="External Roster & Meet Sync" restoreTab="coach">
          <Suspense fallback={null}>
            <AthleticNetTfrrsSyncModal
              isOpen={isExternalSyncOpen}
              onClose={handleCloseExternalSync}
              activeTeam={activeTeam}
              myTeams={myTeams}
              selfName={primaryAthleteDisplayName}
              onTeamsUpdated={onTeamsUpdated}
              onOpenPublicHub={onOpenPublicTeamHub}
            />
          </Suspense>
        </WorkspaceErrorBoundary>
      )}
    </div>
  );
};
