import React, { Suspense, useEffect, useMemo, useState } from 'react';
import type {
  AthleteProfile,
  CoachComplexityTier,
  CoachEventGroup,
  CoachWorkspaceSubTab,
  ConnectedAthleteRecord,
  DistanceUnit,
  EnvironmentFilter,
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
import type { PlannedEventBatchItem } from './GoalsView';
import type { VdotPodRosterInput } from '../physiology/scholasticEngine';
import { evaluateSafeSportPatternWatch } from '../physiology/safeSportPatternWatchEngine';
import { resolveAthleteAgeTier } from '../physiology/ageAndComplianceEngine';
import { doesCoachOwnAthlete } from '../physiology/teamOnboardingEngine';
import { buildCoachSquadExecutionDigest } from '../physiology/sessionCheckInAndDigestEngine';
import { resolveWorkspaceSportAndRoleScope } from '../utils/workspaceScope';
import { useCoachTeamPlanActions } from '../hooks/useCoachTeamPlanActions';
import { hasSessionActiveHint } from '../utils/sessionHint';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { WorkspaceErrorBoundary } from './WorkspaceErrorBoundary';
import type {
  SavedStopwatchEntry,
  TracksideStopwatchLaunchPreset,
} from './TracksideStopwatchView';
import type { CoachDelegateTimingPreset } from './stopwatch/CoachDelegateTimingModal';
import type {
  StopwatchOutboxFlushResult,
  StopwatchSaveResult,
} from '../utils/stopwatchTeamSync';
import { getLocalDateIso } from '../physiology/trainingProductivityEngine';
import type { MeetsPlanSubView } from './coach/CoachMeetsAndPlanView';
import type { TeamHubSubView } from './coach/CoachTeamHubView';
import {
  HeartPulse,
  SlidersHorizontal,
  Trophy,
} from './icons/PhosphorIcons';

const CoachPracticeHome = lazyWithRetry(
  () => import('./coach/CoachPracticeHome').then((m) => ({ default: m.CoachPracticeHome })),
  { chunkKey: 'CoachPracticeHome', restoreTab: 'coach' }
);
const CoachMeetsAndPlanView = lazyWithRetry(
  () =>
    import('./coach/CoachMeetsAndPlanView').then((m) => ({
      default: m.CoachMeetsAndPlanView,
    })),
  { chunkKey: 'CoachMeetsAndPlanView', restoreTab: 'coach' }
);
const CoachTeamHubView = lazyWithRetry(
  () => import('./coach/CoachTeamHubView').then((m) => ({ default: m.CoachTeamHubView })),
  { chunkKey: 'CoachTeamHubView', restoreTab: 'coach' }
);
const CoachDeskDrawer = lazyWithRetry(
  () => import('./coach/CoachDeskDrawer').then((m) => ({ default: m.CoachDeskDrawer })),
  { chunkKey: 'CoachDeskDrawer', restoreTab: 'coach' }
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
const TracksideFieldEventsSheet = lazyWithRetry(
  () =>
    import('./track/TracksideFieldEventsSheet').then((m) => ({
      default: m.TracksideFieldEventsSheet,
    })),
  { chunkKey: 'TracksideFieldEventsSheet', restoreTab: 'coach' }
);
const CoachAthleteSummaryDrawer = lazyWithRetry(
  () =>
    import('./coach/CoachDailyOpsPanel').then((m) => ({
      default: m.CoachAthleteSummaryDrawer,
    })),
  { chunkKey: 'CoachAthleteSummaryDrawer', restoreTab: 'coach' }
);
const CoachOnboardingWizard = lazyWithRetry(
  () =>
    import('./coach/CoachOnboardingWizard').then((m) => ({
      default: m.CoachOnboardingWizard,
    })),
  { chunkKey: 'CoachOnboardingWizard', restoreTab: 'coach' }
);
const DistrictAdOverviewModal = lazyWithRetry(
  () =>
    import('./coach/DistrictAdOverviewModal').then((m) => ({
      default: m.DistrictAdOverviewModal,
    })),
  { chunkKey: 'DistrictAdOverviewModal', restoreTab: 'coach' }
);
const CoachDelegateTimingModal = lazyWithRetry(
  () =>
    import('./stopwatch/CoachDelegateTimingModal').then((m) => ({
      default: m.CoachDelegateTimingModal,
    })),
  { chunkKey: 'CoachDelegateTimingModal', restoreTab: 'coach' }
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
    sessionSlot?: WorkoutSessionSlot;
    locationName?: string;
    locationCategory?: PracticeVenueCategory;
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
      sessionSlot?: WorkoutSessionSlot;
      locationName?: string;
      locationCategory?: PracticeVenueCategory;
      meetingNotes?: string;
      trackSpec?: TrackWorkoutSpec;
    }
  ) => Promise<void>;
  onDeletePlannedEvent: (id: string) => Promise<void>;
  onDeletePlanBlock?: (planBlockId: string) => Promise<void>;
  onBatchCreatePlannedEvents: (
    events: PlannedEventBatchItem[],
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
  onOpenDelegateTimingModal?: (preset?: {
    meetTitle?: string;
    meetDate?: string;
    eventCode?: string;
    heatLabel?: string;
    runners?: Array<{ membershipId?: string; athleteName: string; hipOrLane?: string }>;
  }) => void;
  pendingTimingSubmissionsCount?: number;
  isSampleDemoMode?: boolean;
}

export function shouldShowPrimarySetupWizardChip(
  activeTeam: TeamSummaryWithRole | null | undefined
): boolean {
  if (!activeTeam) return true;
  const activeAthleteCount = (activeTeam.memberships || []).filter(
    (m) => m.role === 'ATHLETE' && m.status !== 'REVOKED' && m.status !== 'ALUMNI'
  ).length;
  const broadcastCount = (activeTeam.broadcastWorkouts || []).length;
  return activeAthleteCount <= 1 || broadcastCount === 0;
}

export const CoachWorkspaceView: React.FC<CoachWorkspaceViewProps> = ({
  subTab,
  setSubTab,
  activeTeam,
  myTeams,
  activeTeamId,
  onSelectActiveTeam,
  combinedRoster,
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
  onOpenPublicTeamHub,
  onOpenCoachGuide,
  onOpenDelegateTimingModal,
  pendingTimingSubmissionsCount,
  isSampleDemoMode = false,
}) => {
  const [openCreateTeamOnSwitch, setOpenCreateTeamOnSwitch] = useState<boolean>(false);
  const [openBillingPlanOnRoster, setOpenBillingPlanOnRoster] = useState<'DISTRICT_2000' | null>(
    null
  );
  const [meetsPlanSubView, setMeetsPlanSubView] = useState<MeetsPlanSubView>('CALENDAR');
  const [teamHubSubView, setTeamHubSubView] = useState<TeamHubSubView>('ROSTER');
  const [showDeskDrawer, setShowDeskDrawer] = useState<boolean>(false);

  const isDemoTeam = Boolean(
    isSampleDemoMode ||
      activeTeam?.brand.teamId.startsWith('demo_team_') ||
      activeTeam?.brand.teamId.startsWith('demo-team-')
  );
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

  const {
    teamPlanError,
    teamPlanEvents,
    handleTeamPlanCreate,
    handleTeamPlanUpdate,
    handleTeamPlanBatchCreate,
    handleTeamPlanDelete,
    handleTeamPlanBlockDelete,
  } = useCoachTeamPlanActions({
    activeTeam,
    myTeams,
    isDemoTeam,
    effectivePlannedEvents,
    onTeamsUpdated,
    onCreatePlannedEvent,
    onUpdatePlannedEvent,
    onDeletePlannedEvent,
    onDeletePlanBlock,
    onBatchCreatePlannedEvents,
  });

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

  const staffMembers = useMemo(
    () =>
      (activeTeam?.memberships || []).filter(
        (m) =>
          m.status !== 'REVOKED' &&
          m.role !== 'ATHLETE' &&
          m.role !== 'PARENT_FOLLOWER'
      ),
    [activeTeam?.memberships]
  );

  const isScopedSelfCoach = Boolean(
    activeTeam?.myRole === 'ASSISTANT_COACH' &&
      ((activeTeam.myCoachEventGroups && activeTeam.myCoachEventGroups.length > 0) ||
        (activeTeam.myAssignedAthleteMembershipIds &&
          activeTeam.myAssignedAthleteMembershipIds.length > 0))
  );

  const [coachLensId, setCoachLensId] = useState<string>(() =>
    isScopedSelfCoach ? 'MY_SCOPE' : 'ALL_TEAM'
  );

  useEffect(() => {
    setCoachLensId(isScopedSelfCoach ? 'MY_SCOPE' : 'ALL_TEAM');
  }, [activeTeam?.brand.teamId, isScopedSelfCoach]);

  const activeLensScope = useMemo<{
    groups?: CoachEventGroup[];
    athleteIds?: string[];
  }>(() => {
    if (coachLensId === 'MY_SCOPE' && activeTeam) {
      return {
        groups: activeTeam.myCoachEventGroups,
        athleteIds: activeTeam.myAssignedAthleteMembershipIds,
      };
    }
    if (coachLensId !== 'ALL_TEAM') {
      const staff = staffMembers.find((s) => s.membershipId === coachLensId);
      if (staff) {
        return {
          groups: staff.coachEventGroups,
          athleteIds: staff.assignedAthleteMembershipIds,
        };
      }
    }
    return {};
  }, [coachLensId, activeTeam, staffMembers]);

  const effectiveAllowedEventGroups = useMemo<CoachEventGroup[] | undefined>(
    () =>
      activeLensScope.groups && activeLensScope.groups.length > 0
        ? activeLensScope.groups
        : undefined,
    [activeLensScope.groups]
  );
  const defaultCoachEventGroup = effectiveAllowedEventGroups?.[0];

  const scopedConnectedAthletes = useMemo(() => {
    if (
      (!activeLensScope.groups || activeLensScope.groups.length === 0) &&
      (!activeLensScope.athleteIds || activeLensScope.athleteIds.length === 0)
    ) {
      return connectedAthletesOnly;
    }
    return connectedAthletesOnly.filter((ath) => {
      const memId = ath.id.startsWith('team-mem-')
        ? ath.id.slice('team-mem-'.length)
        : ath.id;
      return doesCoachOwnAthlete({
        coachEventGroups: activeLensScope.groups,
        assignedAthleteMembershipIds: activeLensScope.athleteIds,
        athleteEventGroup: ath.eventGroup,
        athleteMembershipId: memId,
      });
    });
  }, [connectedAthletesOnly, activeLensScope]);

  const scopedStopwatchRoster = useMemo(() => {
    if (
      (!activeLensScope.groups || activeLensScope.groups.length === 0) &&
      (!activeLensScope.athleteIds || activeLensScope.athleteIds.length === 0)
    ) {
      return combinedRoster;
    }
    return combinedRoster.filter((ath) => {
      if (ath.id === 'SELF') return true;
      const memId = ath.id.startsWith('team-mem-')
        ? ath.id.slice('team-mem-'.length)
        : ath.id;
      return doesCoachOwnAthlete({
        coachEventGroups: activeLensScope.groups,
        assignedAthleteMembershipIds: activeLensScope.athleteIds,
        athleteEventGroup: ath.eventGroup,
        athleteMembershipId: memId,
      });
    });
  }, [combinedRoster, activeLensScope]);

  const podRoster = useMemo<VdotPodRosterInput[]>(() => {
    const activePodAthletes = scopedConnectedAthletes.filter(
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
  }, [scopedConnectedAthletes, primaryAthleteDisplayName, selfProfile.thresholdPaceSecsPerKm]);

  const [complexityTierState, setComplexityTierState] = useState<CoachComplexityTier | null>(() => {
    try {
      const saved = window.localStorage.getItem('thresh_coach_complexity_tier');
      return saved === 'PRO' || saved === 'ESSENTIALS' ? saved : null;
    } catch {
      return null;
    }
  });
  const complexityTier: CoachComplexityTier =
    complexityTierState ??
    (activeTeam?.brand?.orgType === 'COLLEGIATE' ? 'PRO' : 'ESSENTIALS');
  const setComplexityTier = (next: CoachComplexityTier) => {
    setComplexityTierState(next);
    try {
      window.localStorage.setItem('thresh_coach_complexity_tier', next);
    } catch {
      // ignore storage failures
    }
  };
  const [tracksideMode, setTracksideMode] = useState<'STOPWATCH' | 'FIELD'>('STOPWATCH');
  const [showOnboardingWizard, setShowOnboardingWizard] = useState<boolean>(false);

  useEffect(() => {
    if (
      isSampleDemoMode ||
      subTab !== 'CLIPBOARD' ||
      myTeams.length > 0 ||
      connectedAthletesOnly.length > 0 ||
      showOnboardingWizard
    ) {
      return;
    }
    try {
      if (
        typeof window === 'undefined' ||
        !hasSessionActiveHint() ||
        window.sessionStorage.getItem('meetready_coach_wizard_seen') === '1'
      ) {
        return;
      }
    } catch {
      return;
    }
    const timer = window.setTimeout(() => {
      try {
        window.sessionStorage.setItem('meetready_coach_wizard_seen', '1');
      } catch {
        // ignore storage failures
      }
      setShowOnboardingWizard(true);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    isSampleDemoMode,
    subTab,
    myTeams.length,
    connectedAthletesOnly.length,
    showOnboardingWizard,
  ]);

  const [showDistrictAdModal, setShowDistrictAdModal] = useState<boolean>(false);
  const [delegateModalOpen, setDelegateModalOpen] = useState<boolean>(false);
  const [delegateModalTab, setDelegateModalTab] = useState<'CREATE' | 'REVIEW'>('CREATE');
  const [delegatePreset, setDelegatePreset] = useState<CoachDelegateTimingPreset | null>(null);
  const [stopwatchLaunchPreset, setStopwatchLaunchPreset] =
    useState<TracksideStopwatchLaunchPreset | null>(null);
  const [drawerAthleteId, setDrawerAthleteId] = useState<string | null>(null);

  const workspaceScope = useMemo(
    () =>
      resolveWorkspaceSportAndRoleScope({
        athleteProfile: selfProfile,
        activeTeam,
      }),
    [selfProfile, activeTeam]
  );

  const drawerAthlete = useMemo(
    () =>
      drawerAthleteId
        ? connectedAthletesOnly.find((a) => a.id === drawerAthleteId) || null
        : null,
    [connectedAthletesOnly, drawerAthleteId]
  );

  const todayIso = getLocalDateIso();

  const flaggedTriageCount = useMemo(() => {
    const digest = buildCoachSquadExecutionDigest({
      roster: scopedConnectedAthletes,
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
      if (!r.isSelfFallback && r.attentionReason !== 'ON_TRACK') flaggedIds.add(r.athleteId);
    }
    for (const ath of scopedConnectedAthletes) {
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
    scopedConnectedAthletes,
    primaryAthleteDisplayName,
    effectivePlannedEvents,
    effectiveActivities,
    selfSessionCheckIns,
    todayIso,
  ]);

  const activeInjuryBadgeCount = useMemo(() => {
    const ids = new Set<string>();
    for (const c of activeTeam?.injuryCases || []) {
      if (c.rtpStage !== 'CLEARED') ids.add(c.membershipId);
    }
    const cutoffMs = Date.parse(`${todayIso}T00:00:00Z`) - 6 * 86_400_000;
    for (const m of activeTeam?.memberships || []) {
      if (m.status === 'INJURED') ids.add(m.membershipId);
      const hasRecentPain = (m.liveSnapshot?.sessionCheckIns || []).some(
        (chk) => chk.painFlag && Date.parse(`${String(chk.date || '').slice(0, 10)}T12:00:00Z`) >= cutoffMs
      );
      if (hasRecentPain) ids.add(m.membershipId);
    }
    for (const ath of scopedConnectedAthletes) {
      const memId = ath.id.startsWith('team-mem-')
        ? ath.id.slice('team-mem-'.length)
        : ath.id;
      if (ath.teamMemberStatus === 'INJURED') ids.add(memId);
      const hasRecentPain = (ath.sessionCheckIns || []).some(
        (chk) => chk.painFlag && Date.parse(`${String(chk.date || '').slice(0, 10)}T12:00:00Z`) >= cutoffMs
      );
      if (hasRecentPain) ids.add(memId);
    }
    return ids.size;
  }, [activeTeam?.injuryCases, activeTeam?.memberships, scopedConnectedAthletes, todayIso]);

  const effectivePendingTimingCount =
    typeof pendingTimingSubmissionsCount === 'number'
      ? pendingTimingSubmissionsCount
      : (activeTeam?.pendingTimingSubmissions || []).filter(
          (s) => s.reviewStatus === 'PENDING_COACH_APPROVAL'
        ).length;

  return (
    <div className="space-y-3 max-w-full" data-testid="coach-workspace-view">
      {/* Compact 1-Line Coach Field Header — omitted on Stopwatch so timing sits at 0px scroll */}
      {subTab !== 'STOPWATCH' && (
        <section
          data-testid="coach-compact-header"
          className="rounded-2xl liquid-glass px-3.5 py-2 sm:px-4 max-w-full"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 max-w-full">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <h1 className="text-sm sm:text-base font-bold text-ap-ink dark:text-ap-chalk tracking-tight truncate">
                {activeTeam ? `${activeTeam.brand.shortName || activeTeam.brand.name} · Coach` : 'Coach Workspace'}
              </h1>
              {activeTeam && (
                <span className="px-2 py-0.5 rounded-md text-2xs font-mono font-semibold bg-ap-inset text-ap-clay dark:bg-ap-turf dark:text-ap-volt">
                  {activeTeam.brand.joinCode}
                </span>
              )}
              {activeTeam && (staffMembers.length > 1 || isScopedSelfCoach) && (
                <select
                  data-testid="coach-scope-lens-select"
                  aria-label="Coach Scope Lens"
                  value={coachLensId}
                  onChange={(e) => setCoachLensId(e.target.value)}
                  className="min-h-[44px] sm:h-[36px] sm:min-h-[36px] py-1 leading-tight max-w-[190px] rounded-xl border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 text-2xs font-semibold text-ap-ink dark:text-ap-chalk"
                >
                  {isScopedSelfCoach && (
                    <option value="MY_SCOPE">
                      My Group ({activeTeam.myCoachSpecialtyTitle || effectiveAllowedEventGroups?.join(', ') || 'Scoped'})
                    </option>
                  )}
                  <option value="ALL_TEAM">All Coaches (Full Team)</option>
                  {staffMembers
                    .filter(
                      (s) =>
                        (s.coachEventGroups && s.coachEventGroups.length > 0) ||
                        (s.assignedAthleteMembershipIds && s.assignedAthleteMembershipIds.length > 0)
                    )
                    .map((s) => (
                      <option key={s.membershipId} value={s.membershipId}>
                        {s.invitedName} — {s.coachSpecialtyTitle || s.coachEventGroups?.join('/')}
                      </option>
                    ))}
                </select>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                data-testid="coach-open-meet-packet-btn"
                onClick={() => {
                  setMeetsPlanSubView('MEET_DAY');
                  setSubTab('TEAM_PLAN');
                }}
                className="min-h-[40px] sm:min-h-[34px] px-2.5 sm:px-3 py-1 rounded-xl ap-btn-secondary text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Trophy className="w-3.5 h-3.5 ap-text-brand" />
                <span>Meet Day</span>
              </button>

              <button
                type="button"
                data-testid="coach-open-injury-hub-btn"
                onClick={() => {
                  setTeamHubSubView('HEALTH');
                  setSubTab('ROSTER');
                }}
                className="min-h-[40px] sm:min-h-[34px] px-2.5 sm:px-3 py-1 rounded-xl ap-btn-secondary text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <HeartPulse className="w-3.5 h-3.5 text-ap-clay dark:text-ap-volt" />
                <span>Health</span>
                {activeInjuryBadgeCount > 0 && (
                  <span
                    data-testid="coach-injury-hub-badge"
                    className="px-1.5 py-0.5 rounded-full text-2xs font-mono font-bold bg-ap-clay text-white tabular-nums"
                  >
                    {activeInjuryBadgeCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                data-testid="coach-desk-menu-btn"
                onClick={() => setShowDeskDrawer(true)}
                aria-label="Open Coach Desk & Admin Drawer"
                className="min-h-[40px] sm:min-h-[34px] px-2.5 sm:px-3 py-1 rounded-xl ap-btn-secondary text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 ap-text-brand" />
                <span>Desk</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 1. PRACTICE HOME */}
      {subTab === 'CLIPBOARD' && (
        <WorkspaceErrorBoundary fallbackTitle="Practice Home" restoreTab="coach">
          <Suspense
            fallback={
              <div className="h-64 rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                Loading Practice Ops…
              </div>
            }
          >
            <CoachPracticeHome
              todayIso={todayIso}
              activeTeam={activeTeam}
              myTeams={myTeams}
              connectedAthletesOnly={connectedAthletesOnly}
              scopedConnectedAthletes={scopedConnectedAthletes}
              primaryAthleteDisplayName={primaryAthleteDisplayName}
              selfProfile={selfProfile}
              complexityTier={complexityTier}
              defaultCoachEventGroup={defaultCoachEventGroup}
              effectiveAllowedEventGroups={effectiveAllowedEventGroups}
              flaggedTriageCount={flaggedTriageCount}
              effectivePendingTimingCount={effectivePendingTimingCount}
              onTeamsUpdated={onTeamsUpdated}
              onCreatePlannedEvent={onCreatePlannedEvent}
              onOpenStopwatch={(mode) => {
                setTracksideMode(mode);
                setSubTab('STOPWATCH');
              }}
              onOpenDelegateModal={(tab) => {
                setDelegatePreset(null);
                setDelegateModalTab(tab);
                setDelegateModalOpen(true);
                onOpenDelegateTimingModal?.();
              }}
              onOpenHealthAttention={() => {
                setTeamHubSubView('ROSTER');
                setSubTab('ROSTER');
              }}
              onOpenRosterTab={() => {
                setTeamHubSubView('ROSTER');
                setSubTab('ROSTER');
              }}
              onOpenSetupWizard={() => setShowOnboardingWizard(true)}
              onOpenCreateTeamStudio={() => {
                setOpenCreateTeamOnSwitch(true);
                setTeamHubSubView('ROSTER');
                setSubTab('ROSTER');
              }}
            />
          </Suspense>
        </WorkspaceErrorBoundary>
      )}

      {/* 2. MEETS & PLAN */}
      {subTab === 'TEAM_PLAN' && (
        <WorkspaceErrorBoundary fallbackTitle="Meets and Plan" restoreTab="coach">
          <Suspense
            fallback={
              <div className="h-80 rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                Loading Meets &amp; Plan…
              </div>
            }
          >
            <CoachMeetsAndPlanView
              subView={meetsPlanSubView}
              onSelectSubView={setMeetsPlanSubView}
              showRelayOptimizer={workspaceScope.showRelayOptimizer}
              teamPlanError={teamPlanError}
              activeTeam={activeTeam}
              myTeams={myTeams}
              connectedAthletesOnly={connectedAthletesOnly}
              scopedConnectedAthletes={scopedConnectedAthletes}
              podRoster={podRoster}
              primaryAthleteDisplayName={primaryAthleteDisplayName}
              selfProfile={selfProfile}
              athleteFtp={athleteFtp}
              teamPlanEvents={teamPlanEvents}
              effectiveActivities={effectiveActivities}
              effectiveWellnessDays={effectiveWellnessDays}
              effectiveTargetGoals={effectiveTargetGoals}
              envFilter={envFilter}
              selectedSport={selectedSport}
              onSelectSport={onSelectSport}
              distanceUnit={distanceUnit}
              isDemoTeam={isDemoTeam}
              onTeamsUpdated={onTeamsUpdated}
              onSelectActivityAndOpenTab={onSelectActivityAndOpenTab}
              onCreateTeamEvent={handleTeamPlanCreate}
              onUpdateTeamEvent={handleTeamPlanUpdate}
              onDeleteTeamEvent={handleTeamPlanDelete}
              onDeleteTeamPlanBlock={handleTeamPlanBlockDelete}
              onBatchCreateTeamEvents={handleTeamPlanBatchCreate}
              onOpenAthleteToday={onOpenAthleteToday}
              onOpenProfileModal={onOpenProfileModal}
              onOpenGoalsTab={onOpenGoalsTab}
              onOpenOfficialRaceModal={onOpenOfficialRaceModal}
              onOpenCoachWithPrompt={onOpenCoachWithPrompt}
              onLaunchStopwatchPreset={(preset) => {
                setStopwatchLaunchPreset(preset);
                setTracksideMode('STOPWATCH');
                setSubTab('STOPWATCH');
              }}
              onOpenStopwatchDirect={() => setSubTab('STOPWATCH')}
              onDelegateEventTimer={(preset) => {
                setDelegatePreset(preset);
                setDelegateModalTab('CREATE');
                setDelegateModalOpen(true);
              }}
            />
          </Suspense>
        </WorkspaceErrorBoundary>
      )}

      {/* 3. TIMING (STOPWATCH & FIELD MARKS) */}
      {subTab === 'STOPWATCH' && (
        <div className="space-y-3">
          <div
            role="group"
            aria-label="Trackside Timing or Field Marks"
            className="rounded-2xl liquid-glass px-3 py-2 flex flex-wrap items-center justify-between gap-2"
          >
            <div className="inline-flex items-center gap-1 p-0.5 rounded-xl liquid-capsule-track text-xs font-bold">
              <button
                type="button"
                data-testid="trackside-mode-stopwatch"
                aria-pressed={tracksideMode === 'STOPWATCH'}
                onClick={() => setTracksideMode('STOPWATCH')}
                className={`min-h-[44px] sm:min-h-[34px] px-3.5 py-1 rounded-lg cursor-pointer transition-colors ${
                  tracksideMode === 'STOPWATCH'
                    ? 'bg-white dark:bg-[#242826] text-ap-ink dark:text-ap-chalk border border-ap-frame dark:border-white/30 shadow-xs'
                    : 'text-ap-muted dark:text-ap-muted-dark border border-transparent hover:text-ap-ink dark:hover:text-ap-chalk'
                }`}
              >
                Track Stopwatch
              </button>
              <button
                type="button"
                data-testid="trackside-mode-field"
                aria-pressed={tracksideMode === 'FIELD'}
                onClick={() => setTracksideMode('FIELD')}
                className={`min-h-[44px] sm:min-h-[34px] px-3.5 py-1 rounded-lg cursor-pointer transition-colors ${
                  tracksideMode === 'FIELD'
                    ? 'bg-white dark:bg-[#242826] text-ap-ink dark:text-ap-chalk border border-ap-frame dark:border-white/30 shadow-xs'
                    : 'text-ap-muted dark:text-ap-muted-dark border border-transparent hover:text-ap-ink dark:hover:text-ap-chalk'
                }`}
              >
                Field Marks &amp; Multi
              </button>
            </div>
            <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
              {tracksideMode === 'STOPWATCH'
                ? 'Sprints · Hurdles · Mid-Dist · Distance Lanes'
                : 'LJ · TJ · HJ · PV · Throws · Pent / Hept / Dec'}
            </span>
          </div>

          {tracksideMode === 'STOPWATCH' ? (
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
                  roster={scopedStopwatchRoster}
                  myTeams={myTeams}
                  activeTeamId={activeTeamId}
                  onSaveStopwatchActivities={onSaveStopwatchActivities}
                  onFlushStopwatchOutbox={onFlushStopwatchOutbox}
                  onOpenActivitiesTab={() => setSubTab('TEAM_PLAN')}
                  postSaveActionLabel="View Meets & Plan"
                  onOpenRosterModal={() => setSubTab('ROSTER')}
                  onOpenDelegateTiming={() => {
                    setDelegatePreset(null);
                    setDelegateModalTab(effectivePendingTimingCount > 0 ? 'REVIEW' : 'CREATE');
                    setDelegateModalOpen(true);
                  }}
                  pendingTimingCount={effectivePendingTimingCount}
                  launchPreset={stopwatchLaunchPreset}
                  complexityTier={complexityTier}
                />
              </Suspense>
            </WorkspaceErrorBoundary>
          ) : (
            <WorkspaceErrorBoundary fallbackTitle="Trackside Field Sheet" restoreTab="coach">
              <Suspense
                fallback={
                  <div className="h-80 rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                    Loading Field &amp; Multi Sheet…
                  </div>
                }
              >
                <TracksideFieldEventsSheet
                  activeTeam={activeTeam}
                  myTeams={myTeams}
                  rosterAthletes={scopedConnectedAthletes}
                  allowedEventGroups={effectiveAllowedEventGroups}
                  defaultEventGroup={defaultCoachEventGroup}
                  distanceUnit={distanceUnit}
                  onTeamsUpdated={onTeamsUpdated}
                />
              </Suspense>
            </WorkspaceErrorBoundary>
          )}
        </div>
      )}

      {/* 4. TEAM HUB (ROSTER, HEALTH & INJURIES, STAFF) */}
      {subTab === 'ROSTER' && (
        <WorkspaceErrorBoundary fallbackTitle="Team Hub" restoreTab="coach">
          <Suspense
            fallback={
              <div className="h-64 rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                Loading Team Hub…
              </div>
            }
          >
            <CoachTeamHubView
              subView={teamHubSubView}
              onSelectSubView={setTeamHubSubView}
              activeInjuryBadgeCount={activeInjuryBadgeCount}
              todayIso={todayIso}
              activeTeam={activeTeam}
              myTeams={myTeams}
              activeTeamId={activeTeamId}
              resendConfigured={resendConfigured}
              isSampleDemoMode={isSampleDemoMode}
              primaryAthleteDisplayName={primaryAthleteDisplayName}
              complexityTier={complexityTier}
              effectiveAllowedEventGroups={effectiveAllowedEventGroups}
              connectedAthletesOnly={connectedAthletesOnly}
              scopedConnectedAthletes={scopedConnectedAthletes}
              effectivePlannedEvents={effectivePlannedEvents}
              effectiveActivities={effectiveActivities}
              selfSessionCheckIns={selfSessionCheckIns}
              showNcaaCara={workspaceScope.showNcaaCara}
              openCreateTeamOnSwitch={openCreateTeamOnSwitch}
              openBillingPlanOnRoster={openBillingPlanOnRoster}
              onConsumedInitialBilling={() => setOpenBillingPlanOnRoster(null)}
              onSelectActiveTeam={onSelectActiveTeam}
              onTeamsUpdated={onTeamsUpdated}
              onQuickInspectDrawer={(athId) => setDrawerAthleteId(athId)}
              onInspectAthlete={(athId) => {
                onSelectAthleteViewport(athId);
                onOpenAthleteToday();
              }}
              onOpenTeamPlan={() => setSubTab('TEAM_PLAN')}
              onOpenClipboard={() => setSubTab('CLIPBOARD')}
              onOpenExternalSync={() => setIsExternalSyncOpen(true)}
              onOpenPublicTeamHub={onOpenPublicTeamHub}
            />
          </Suspense>
        </WorkspaceErrorBoundary>
      )}

      {showDeskDrawer && (
        <WorkspaceErrorBoundary fallbackTitle="Coach Desk" restoreTab="coach">
          <Suspense fallback={null}>
            <CoachDeskDrawer
              isOpen={showDeskDrawer}
              onClose={() => setShowDeskDrawer(false)}
              activeTeam={activeTeam}
              myTeams={myTeams}
              activeTeamId={activeTeamId}
              onSelectActiveTeam={onSelectActiveTeam}
              complexityTier={complexityTier}
              onSetComplexityTier={setComplexityTier}
              onOpenWizard={() => setShowOnboardingWizard(true)}
              onOpenCohortPlanBuilder={() => {
                try {
                  window.sessionStorage.setItem('thresh_open_plan_cohort', 'TEAM_ALL');
                } catch {
                  // ignore storage failures
                }
                onOpenGoalsTab();
              }}
              onOpenExternalSync={() => setIsExternalSyncOpen(true)}
              onOpenDistrictOverview={() => setShowDistrictAdModal(true)}
              onOpenCoachGuide={onOpenCoachGuide}
              onOpenTeamStaffTab={() => {
                setTeamHubSubView('ROSTER');
                setSubTab('ROSTER');
              }}
              onOpenProfileModal={onOpenProfileModal}
            />
          </Suspense>
        </WorkspaceErrorBoundary>
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

      {showOnboardingWizard && (
        <WorkspaceErrorBoundary fallbackTitle="Team Setup Wizard" restoreTab="coach">
          <Suspense fallback={null}>
            <CoachOnboardingWizard
              isOpen={showOnboardingWizard}
              myTeams={myTeams}
              selfName={primaryAthleteDisplayName}
              isSampleDemoMode={isSampleDemoMode}
              onClose={() => setShowOnboardingWizard(false)}
              onSetComplexityTier={(tier) => setComplexityTier(tier)}
              onTeamCreated={(teams, createdId) => {
                onTeamsUpdated(teams, createdId);
                setSubTab('CLIPBOARD');
              }}
              onOpenRosterStudio={() => {
                setOpenCreateTeamOnSwitch(false);
                setTeamHubSubView('ROSTER');
                setSubTab('ROSTER');
              }}
            />
          </Suspense>
        </WorkspaceErrorBoundary>
      )}

      {drawerAthlete && (
        <WorkspaceErrorBoundary fallbackTitle="Athlete Coach Summary" restoreTab="coach">
          <Suspense fallback={null}>
            <CoachAthleteSummaryDrawer
              athlete={drawerAthlete}
              activeTeam={activeTeam}
              onClose={() => setDrawerAthleteId(null)}
              onSwitchToProTelemetry={(athId) => {
                setComplexityTier('PRO');
                setDrawerAthleteId(null);
                onSelectAthleteViewport(athId);
                onOpenAthleteToday();
              }}
            />
          </Suspense>
        </WorkspaceErrorBoundary>
      )}

      {delegateModalOpen && (
        <WorkspaceErrorBoundary fallbackTitle="Delegated Race Timing" restoreTab="coach">
          <Suspense fallback={null}>
            <CoachDelegateTimingModal
              isOpen={delegateModalOpen}
              onClose={() => setDelegateModalOpen(false)}
              activeTeam={activeTeam}
              onTeamsUpdated={onTeamsUpdated}
              isSampleDemoMode={isSampleDemoMode}
              initialPreset={delegatePreset}
              initialTab={delegateModalTab}
            />
          </Suspense>
        </WorkspaceErrorBoundary>
      )}

      {showDistrictAdModal && (
        <WorkspaceErrorBoundary fallbackTitle="District AD Overview" restoreTab="coach">
          <Suspense fallback={null}>
            <DistrictAdOverviewModal
              isOpen={showDistrictAdModal}
              onClose={() => setShowDistrictAdModal(false)}
              myTeams={myTeams}
              activeTeamId={activeTeamId}
              isSampleDemoMode={isSampleDemoMode}
              onSelectActiveTeam={(teamId) => onSelectActiveTeam(teamId)}
              onOpenDistrictBilling={() => {
                setOpenCreateTeamOnSwitch(false);
                if (!activeTeamId) {
                  const firstGoverned = myTeams.find(
                    (t) => t.myRole === 'HEAD_COACH' || t.myRole === 'ORG_ADMIN'
                  );
                  if (firstGoverned) onSelectActiveTeam(firstGoverned.brand.teamId);
                }
                setOpenBillingPlanOnRoster('DISTRICT_2000');
                setTeamHubSubView('ROSTER');
                setSubTab('ROSTER');
              }}
            />
          </Suspense>
        </WorkspaceErrorBoundary>
      )}
    </div>
  );
};
