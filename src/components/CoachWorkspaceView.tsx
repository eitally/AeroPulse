import React, { useMemo, useState } from 'react';
import type {
  AthleteProfile,
  CoachWorkspaceSubTab,
  ConnectedAthleteRecord,
  DistanceUnit,
  EnvironmentFilter,
  PlannedWorkoutEvent,
  SessionCheckInRecord,
  SportCategory,
  TargetGoal,
  TeamSummaryWithRole,
  TrackWorkoutSpec,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import {
  summarizeNcaaCaraWeeklyHours,
  type VdotPodRosterInput,
} from '../physiology/scholasticEngine';
import { evaluateSafeSportPatternWatch } from '../physiology/safeSportPatternWatchEngine';
import { buildCoachSquadExecutionDigest } from '../physiology/sessionCheckInAndDigestEngine';
import { getSavedIntervalsHeaders } from '../utils/telemetryStorage';
import { CalendarView } from './CalendarView';
import { TeamManagementPanel } from './TeamManagementPanel';
import { TracksideStopwatchView, type SavedStopwatchEntry } from './TracksideStopwatchView';
import { ScholasticRelayAndTopTimesPanel } from './track/ScholasticRelayAndTopTimesPanel';
import { CoachClipboardWorkoutBuilder } from './CoachClipboardWorkoutBuilder';
import { CoachExecutionDigestPanel } from './CoachExecutionDigestPanel';
import { getLocalDateIso } from '../physiology/trainingProductivityEngine';
import {
  ChevronDown,
  Shield,
  Users,
} from './icons/PhosphorIcons';

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
  onTeamsUpdated: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string) => void;
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
  onSaveStopwatchActivities: (entries: SavedStopwatchEntry[]) => number;
  onOpenAthleteToday: () => void;
  onOpenRosterModal: () => void;
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
  onOpenAthleteToday,
  onOpenRosterModal,
}) => {
  const [openCreateTeamOnSwitch, setOpenCreateTeamOnSwitch] = useState<boolean>(false);

  const handleTeamPlanCreate = async (eventInput: {
    date: string;
    name: string;
    sportCategory: SportCategory;
    environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
    plannedDurationSecs: number;
    plannedLoad: number;
    workoutSyntax: string;
    description: string;
    trackSpec?: TrackWorkoutSpec;
    replaceExistingDate?: boolean;
  }) => {
    const canBroadcastTeam =
      activeTeam &&
      (activeTeam.myRole === 'HEAD_COACH' || activeTeam.myRole === 'ASSISTANT_COACH');
    if (canBroadcastTeam && activeTeam) {
      try {
        const resp = await fetch(
          `/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}/workouts/broadcast`,
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              ...getSavedIntervalsHeaders(),
            },
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
              ...(eventInput.trackSpec ? { trackSpec: eventInput.trackSpec } : {}),
            }),
          }
        );
        if (resp.ok) {
          const data = await resp.json().catch(() => ({}));
          if (Array.isArray(data.teams)) {
            onTeamsUpdated(data.teams, activeTeam.brand.teamId);
          }
          return;
        }
      } catch {
        // Fallback to local state if offline or sandboxed
      }
    }
    await onCreatePlannedEvent(eventInput);
  };
  const connectedAthletesOnly = useMemo(
    () => combinedRoster.filter((a) => a.status === 'CONNECTED'),
    [combinedRoster]
  );

  const podRoster = useMemo<VdotPodRosterInput[]>(() => {
    if (connectedAthletesOnly.length === 0) {
      return [
        {
          id: 'SELF',
          name: primaryAthleteDisplayName || 'Lead Runner',
          thresholdPaceSecsPerKm: selfProfile.thresholdPaceSecsPerKm || 245,
        },
      ];
    }
    return connectedAthletesOnly.map((a) => ({
      id: a.id,
      name: a.name,
      thresholdPaceSecsPerKm: a.athleteProfile.thresholdPaceSecsPerKm || 250,
    }));
  }, [connectedAthletesOnly, primaryAthleteDisplayName, selfProfile.thresholdPaceSecsPerKm]);

  const [showRelayAndTopTimes, setShowRelayAndTopTimes] = useState<boolean>(false);

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
        isMinorU18: Boolean(ath.athleteProfile.safeSportHideWeight),
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
              <h1 className="text-base sm:text-lg font-bold text-[#101411] dark:text-[#F4F7F4] tracking-tight truncate">
                {activeTeam ? `${activeTeam.brand.name} · Coach` : 'Coach Workspace'}
              </h1>
              {activeTeam && (
                <span className="px-2 py-0.5 rounded-md text-2xs font-mono font-semibold bg-[#E3ECE5] text-[#1C5436] dark:bg-[#15231B] dark:text-[#C8FF00]">
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
                  className="hidden md:block min-h-[36px] rounded-xl border border-[#2B5B3F]/25 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 text-xs font-semibold text-[#101411] dark:text-[#F4F7F4]"
                >
                  {myTeams.map((t) => (
                    <option key={t.brand.teamId} value={t.brand.teamId}>
                      {t.brand.shortName || t.brand.name}
                    </option>
                  ))}
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
            </div>
          </div>
        </section>
      )}

      {/* 1. CLIPBOARD (COACH HOME — Opens at 0px scroll directly on Workout Builder) */}
      {subTab === 'CLIPBOARD' && (
        <div className="space-y-3">
          {flaggedTriageCount > 0 && (
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
          )}

          {myTeams.length === 0 && connectedAthletesOnly.length === 0 && (
            <section className="rounded-2xl liquid-glass px-3.5 py-2.5 sm:px-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Users className="w-4 h-4 ap-text-brand shrink-0" weight="duotone" />
                <span className="text-xs font-bold text-[#101411] dark:text-[#F4F7F4] truncate">
                  No team roster connected yet
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="coach-empty-setup-btn"
                  onClick={() => {
                    setOpenCreateTeamOnSwitch(true);
                    setSubTab('ROSTER');
                  }}
                  className="ap-btn-primary !min-h-[44px] sm:!min-h-[34px] px-3 py-1.5 text-xs font-bold cursor-pointer"
                >
                  Create Team or Import CSV
                </button>
                <button
                  type="button"
                  onClick={() => setSubTab('STOPWATCH')}
                  className="ap-btn-secondary !min-h-[44px] sm:!min-h-[34px] px-3 py-1.5 text-xs font-semibold cursor-pointer"
                >
                  Open Stopwatch
                </button>
              </div>
            </section>
          )}

          {/* Track Multi-Set Workout Builder, Event Groups & Pace Pod Splits */}
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

          <div className="rounded-2xl liquid-glass overflow-hidden">
            <button
              type="button"
              aria-expanded={showRelayAndTopTimes}
              onClick={() => setShowRelayAndTopTimes((prev) => !prev)}
              className="w-full min-h-[44px] px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs font-bold text-[#101411] dark:text-[#F4F7F4] cursor-pointer"
            >
              <span>Relay Optimizer &amp; NFHS FAT Top Times</span>
              <ChevronDown
                className={`w-4 h-4 text-[#43584B] dark:text-[#93A39A] transition-transform ${
                  showRelayAndTopTimes ? 'rotate-180' : ''
                }`}
              />
            </button>
            {showRelayAndTopTimes && (
              <div className="px-3 pb-3 pt-1">
                <ScholasticRelayAndTopTimesPanel
                  candidates={podRoster}
                  roster={connectedAthletesOnly}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. TEAM PLAN */}
      {subTab === 'TEAM_PLAN' && (
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
      )}

      {/* 3. STOPWATCH */}
      {subTab === 'STOPWATCH' && (
        <TracksideStopwatchView
          selfName={primaryAthleteDisplayName}
          selfProfile={selfProfile}
          roster={combinedRoster}
          myTeams={myTeams}
          activeTeamId={activeTeamId}
          onSaveStopwatchActivities={onSaveStopwatchActivities}
          onOpenActivitiesTab={() => setSubTab('TEAM_PLAN')}
          onOpenRosterModal={onOpenRosterModal}
        />
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
            onInspectAthlete={(athId) => {
              onSelectAthleteViewport(athId);
              onOpenAthleteToday();
            }}
            onOpenTeamPlan={() => setSubTab('TEAM_PLAN')}
          />

          <TeamManagementPanel
            selfName={primaryAthleteDisplayName}
            myTeams={myTeams}
            activeTeamId={activeTeamId}
            resendConfigured={resendConfigured}
            initialShowCreateStudio={openCreateTeamOnSwitch}
            onSelectActiveTeam={onSelectActiveTeam}
            onTeamsUpdated={onTeamsUpdated}
            onOpenClipboard={() => setSubTab('CLIPBOARD')}
          />

          {(!activeTeam || activeTeam.brand.orgType === 'COLLEGIATE') && (
          <section
            data-testid="coach-cara-audit"
            className="rounded-2xl liquid-glass p-4 sm:p-5 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                Weekly Practice Hours (20h Cap)
              </h2>
              <span className="px-2 py-0.5 rounded font-mono text-2xs font-bold ap-status-info">
                3.0h Comp Day
              </span>
            </div>
            {connectedAthletesOnly.length === 0 ? (
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Connect roster athletes above to monitor rolling 7-day 20h practice hour caps and 3.0h competition day limits.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {connectedAthletesOnly.map((ath) => {
                  const baseAudit = summarizeNcaaCaraWeeklyHours(ath.activities);
                  const hours =
                    ath.activities.length === 0 && typeof ath.caraHours7d === 'number'
                      ? Number(ath.caraHours7d.toFixed(1))
                      : baseAudit.rolling7dCountableHours;
                  const compliant = hours <= baseAudit.weeklyCapHours;
                  return (
                    <div
                      key={`cara-${ath.id}`}
                      className="rounded-xl border border-stone-200 dark:border-[#244331] bg-white/80 dark:bg-[#101B15] p-3 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-900 dark:text-white">{ath.name}</span>
                        <span
                          className={`px-2 py-0.5 rounded text-2xs font-mono font-bold ${
                            compliant ? 'ap-status-prime' : 'ap-status-strained'
                          }`}
                        >
                          {hours}h / 20h
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          )}
        </div>
      )}
    </div>
  );
};
