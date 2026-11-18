import React, { useMemo, useState } from 'react';
import type {
  AthleteProfile,
  CoachWorkspaceSubTab,
  ConnectedAthleteRecord,
  DistanceUnit,
  EnvironmentFilter,
  PlannedWorkoutEvent,
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
import { getSavedIntervalsHeaders } from '../utils/telemetryStorage';
import { CalendarView } from './CalendarView';
import { TeamManagementPanel } from './TeamManagementPanel';
import { TracksideStopwatchView, type SavedStopwatchEntry } from './TracksideStopwatchView';
import { ScholasticRelayAndTopTimesPanel } from './track/ScholasticRelayAndTopTimesPanel';
import { CoachClipboardWorkoutBuilder } from './CoachClipboardWorkoutBuilder';
import {
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
              sportCategory: eventInput.sportCategory === 'Cycling' ? 'Cycling' : 'Running',
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

  const triageAthletes = useMemo(() => {
    return connectedAthletesOnly.map((ath) => {
      const latestW =
        ath.wellnessDays && ath.wellnessDays.length > 0
          ? ath.wellnessDays[ath.wellnessDays.length - 1]
          : null;
      const tsb = latestW?.tsb ?? 0;
      const hrv = latestW?.hrvRMSSD ?? 60;
      const isStrained = tsb < -20 || hrv < 48;
      const watchLight = evaluateSafeSportPatternWatch({
        activities: ath.activities || [],
        wellnessDays: ath.wellnessDays || [],
        isMinorU18: Boolean(ath.athleteProfile.safeSportHideWeight),
      }).trafficLight;
      return { ath, tsb, hrv, isStrained, watchLight };
    });
  }, [connectedAthletesOnly]);

  return (
    <div className="space-y-4" data-testid="coach-workspace-view">
      {/* Unified Coach Mode Context Header */}
      <section className="rounded-2xl liquid-glass p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight">
              {activeTeam ? `${activeTeam.brand.name} · Coach` : 'Coach Workspace'}
            </h1>
            {activeTeam && (
              <span className="px-2 py-0.5 rounded-md text-2xs font-mono font-semibold bg-[#E3ECE5] text-[#1C5436] dark:bg-[#15231B] dark:text-[#C8FF00]">
                Code: {activeTeam.brand.joinCode}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {myTeams.length > 0 && (
              <select
                value={activeTeamId || ''}
                onChange={(e) => onSelectActiveTeam(e.target.value || null)}
                aria-label="Select Team in Coach Workspace"
                className="min-h-[44px] sm:min-h-[36px] rounded-xl border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 text-xs font-semibold text-slate-800 dark:text-slate-100"
              >
                {myTeams.map((t) => (
                  <option key={t.brand.teamId} value={t.brand.teamId}>
                    {t.brand.shortName || t.brand.name}
                  </option>
                ))}
              </select>
            )}

            {connectedAthletesOnly.length > 0 && (
              <select
                value={activeViewedAthleteId}
                onChange={(e) => {
                  onSelectAthleteViewport(e.target.value);
                  if (e.target.value !== 'SELF') {
                    onOpenAthleteToday();
                  }
                }}
                aria-label="Inspect Individual Athlete Cockpit"
                className="min-h-[44px] sm:min-h-[36px] rounded-xl border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 text-xs font-semibold text-slate-800 dark:text-slate-100"
              >
                <option value="SELF">Inspect Athlete…</option>
                {connectedAthletesOnly.map((ath) => (
                  <option key={ath.id} value={ath.id}>
                    {ath.name}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={onOpenAthleteToday}
              className="md:hidden min-h-[44px] px-3 py-1.5 rounded-xl ap-btn-secondary text-xs font-semibold cursor-pointer"
            >
              Exit Coach
            </button>
          </div>
        </div>
      </section>

      {/* 1. CLIPBOARD (COACH HOME) */}
      {subTab === 'CLIPBOARD' && (
        <div className="space-y-4">
          {myTeams.length === 0 && connectedAthletesOnly.length === 0 ? (
            <section className="rounded-2xl liquid-glass p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[#E3ECE5] dark:bg-[#15231B] flex items-center justify-center text-[#1C5436] dark:text-[#C8FF00] shrink-0">
                  <Users className="w-5 h-5" weight="duotone" />
                </div>
                <div className="space-y-0.5">
                  <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    Set Up Your Team &amp; Roster
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-300 max-w-xl">
                    Create your team workspace, import a CSV roster or QR sheet, and assign workouts across pace groups.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="coach-empty-setup-btn"
                  onClick={() => {
                    setOpenCreateTeamOnSwitch(true);
                    setSubTab('ROSTER');
                  }}
                  className="ap-btn-primary !min-h-[44px] sm:!min-h-[38px] px-4 py-2 text-xs font-bold cursor-pointer"
                >
                  Create Team or Import CSV
                </button>
                <button
                  type="button"
                  onClick={() => setSubTab('STOPWATCH')}
                  className="ap-btn-secondary !min-h-[44px] sm:!min-h-[38px] px-4 py-2 text-xs font-semibold cursor-pointer"
                >
                  Open Trackside Stopwatch
                </button>
              </div>
            </section>
          ) : (
            <section className="rounded-2xl liquid-glass p-4 sm:p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Shield className="w-4 h-4 ap-text-brand" />
                    <span>Morning Readiness Check</span>
                  </h2>
                  <button
                    type="button"
                    onClick={() => setSubTab('ROSTER')}
                    className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl liquid-glass-subtle text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    Manage Roster ({connectedAthletesOnly.length})
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {triageAthletes.map(({ ath, tsb, hrv, isStrained, watchLight }) => (
                    <div
                      key={ath.id}
                      className="rounded-xl border border-stone-200 dark:border-[#244331] bg-white/80 dark:bg-[#101B15] p-3 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`px-2 py-0.5 rounded text-2xs font-mono font-bold uppercase ${
                              isStrained || watchLight !== 'GREEN_CLEAR'
                                ? 'ap-status-caution'
                                : 'ap-status-prime'
                            }`}
                          >
                            {watchLight === 'RED_MEDICAL_REVIEW'
                              ? 'Medical Check'
                              : isStrained || watchLight === 'AMBER_WATCH'
                                ? 'Needs Review'
                                : 'Ready'}
                          </span>
                          <span className="font-bold text-slate-900 dark:text-white truncate">
                            {ath.name}
                          </span>
                        </div>
                        <div className="text-2xs font-mono text-slate-500 mt-0.5">
                          HRV {Math.round(hrv)}ms · Form {tsb >= 0 ? `+${Math.round(tsb)}` : Math.round(tsb)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectAthleteViewport(ath.id);
                          onOpenAthleteToday();
                        }}
                        className="min-h-[44px] sm:min-h-[34px] px-2.5 py-1 rounded-lg bg-[#E3ECE5] dark:bg-[#15231B] text-[#1C5436] dark:text-[#C8FF00] text-2xs font-semibold shrink-0 cursor-pointer"
                      >
                        Inspect
                      </button>
                    </div>
                  ))}
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

          <ScholasticRelayAndTopTimesPanel
                candidates={podRoster}
                roster={connectedAthletesOnly}
              />
        </div>
      )}

      {/* 2. TEAM PLAN */}
      {subTab === 'TEAM_PLAN' && (
        <CalendarView
          activities={effectiveActivities}
          wellnessDays={effectiveWellnessDays}
          plannedEvents={effectivePlannedEvents}
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
          onOpenActivitiesTab={() => setSubTab('CLIPBOARD')}
          onOpenRosterModal={onOpenRosterModal}
        />
      )}

      {/* 4. ROSTER & TEAM SETTINGS */}
      {subTab === 'ROSTER' && (
        <div className="space-y-4">
          <TeamManagementPanel
            selfName={primaryAthleteDisplayName}
            myTeams={myTeams}
            activeTeamId={activeTeamId}
            resendConfigured={resendConfigured}
            initialShowCreateStudio={openCreateTeamOnSwitch}
            onSelectActiveTeam={onSelectActiveTeam}
            onTeamsUpdated={onTeamsUpdated}
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
