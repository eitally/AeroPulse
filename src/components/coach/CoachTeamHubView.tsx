import React, { Suspense, useState } from 'react';
import type {
  CoachComplexityTier,
  CoachEventGroup,
  ConnectedAthleteRecord,
  NcaaCaraSeasonSegment,
  PlannedWorkoutEvent,
  SessionCheckInRecord,
  TeamSummaryWithRole,
  UnifiedActivity,
} from '../../types';
import {
  buildNcaaCaraComplianceCsv,
  summarizeNcaaCaraWeeklyHours,
  type NcaaCaraCsvRow,
} from '../../physiology/scholasticEngine';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { WorkspaceErrorBoundary } from '../WorkspaceErrorBoundary';
import { CoachExecutionDigestPanel } from '../CoachExecutionDigestPanel';
import { Download, HeartPulse, Users } from '../icons/PhosphorIcons';

const TeamManagementPanel = lazyWithRetry(
  () => import('../TeamManagementPanel').then((m) => ({ default: m.TeamManagementPanel })),
  { chunkKey: 'TeamManagementPanel', restoreTab: 'coach' }
);
const AthleticTrainerInjuryHub = lazyWithRetry(
  () =>
    import('./AthleticTrainerInjuryHub').then((m) => ({
      default: m.AthleticTrainerInjuryHub,
    })),
  { chunkKey: 'AthleticTrainerInjuryHub', restoreTab: 'coach' }
);

export type TeamHubSubView = 'ROSTER' | 'HEALTH';

export interface CoachTeamHubViewProps {
  subView: TeamHubSubView;
  onSelectSubView: (view: TeamHubSubView) => void;
  activeInjuryBadgeCount: number;
  todayIso: string;
  activeTeam: TeamSummaryWithRole | null;
  myTeams: TeamSummaryWithRole[];
  activeTeamId: string | null;
  resendConfigured: boolean;
  isSampleDemoMode: boolean;
  primaryAthleteDisplayName: string;
  complexityTier: CoachComplexityTier;
  effectiveAllowedEventGroups?: CoachEventGroup[];
  connectedAthletesOnly: ConnectedAthleteRecord[];
  scopedConnectedAthletes: ConnectedAthleteRecord[];
  effectivePlannedEvents: PlannedWorkoutEvent[];
  effectiveActivities: UnifiedActivity[];
  selfSessionCheckIns: SessionCheckInRecord[];
  showNcaaCara: boolean;
  openCreateTeamOnSwitch: boolean;
  openBillingPlanOnRoster: 'DISTRICT_2000' | null;
  onConsumedInitialBilling: () => void;
  onSelectActiveTeam: (teamId: string | null) => void;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string | null) => void;
  onQuickInspectDrawer: (athleteId: string) => void;
  onInspectAthlete: (athleteId: string) => void;
  onOpenTeamPlan: () => void;
  onOpenClipboard: () => void;
  onOpenExternalSync: () => void;
  onOpenPublicTeamHub?: (slugOrCode: string) => void;
}

export const CoachTeamHubView: React.FC<CoachTeamHubViewProps> = ({
  subView,
  onSelectSubView,
  activeInjuryBadgeCount,
  todayIso,
  activeTeam,
  myTeams,
  activeTeamId,
  resendConfigured,
  isSampleDemoMode,
  primaryAthleteDisplayName,
  complexityTier,
  effectiveAllowedEventGroups,
  connectedAthletesOnly,
  scopedConnectedAthletes,
  effectivePlannedEvents,
  effectiveActivities,
  selfSessionCheckIns,
  showNcaaCara,
  openCreateTeamOnSwitch,
  openBillingPlanOnRoster,
  onConsumedInitialBilling,
  onSelectActiveTeam,
  onTeamsUpdated,
  onQuickInspectDrawer,
  onInspectAthlete,
  onOpenTeamPlan,
  onOpenClipboard,
  onOpenExternalSync,
  onOpenPublicTeamHub,
}) => {
  const [caraSegment, setCaraSegment] = useState<NcaaCaraSeasonSegment>('IN_SEASON');
  const [caraStrengthHours, setCaraStrengthHours] = useState<number>(0);
  const [caraMeetingHours, setCaraMeetingHours] = useState<number>(0);
  const [caraVaraHours, setCaraVaraHours] = useState<number>(0);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl liquid-glass px-3 py-2 flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Team Hub Sections"
          className="inline-flex flex-wrap items-center gap-1 p-0.5 rounded-xl liquid-capsule-track text-xs font-bold"
        >
          <button
            type="button"
            role="tab"
            data-testid="team-subview-roster"
            aria-selected={subView === 'ROSTER'}
            onClick={() => onSelectSubView('ROSTER')}
            className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-lg inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
              subView === 'ROSTER'
                ? 'ap-nav-volt-active'
                : 'text-ap-ink dark:text-ap-chalk'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Roster &amp; Staff</span>
          </button>
          <button
            type="button"
            role="tab"
            data-testid="team-subview-health"
            aria-selected={subView === 'HEALTH'}
            onClick={() => onSelectSubView('HEALTH')}
            className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-lg inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
              subView === 'HEALTH'
                ? 'ap-nav-volt-active'
                : 'text-ap-ink dark:text-ap-chalk'
            }`}
          >
            <HeartPulse className="w-3.5 h-3.5 text-ap-clay dark:text-ap-volt" />
            <span>Health &amp; Injuries</span>
            {activeInjuryBadgeCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-2xs font-mono font-bold bg-ap-clay text-white tabular-nums">
                {activeInjuryBadgeCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {subView === 'HEALTH' ? (
        <WorkspaceErrorBoundary fallbackTitle="Athletic Trainer Injury Hub" restoreTab="coach">
          <Suspense
            fallback={
              <div className="h-64 rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                Loading Injury &amp; RTP Hub…
              </div>
            }
          >
            <AthleticTrainerInjuryHub
              isOpen={true}
              inline={true}
              onClose={() => onSelectSubView('ROSTER')}
              activeTeam={activeTeam}
              myTeams={myTeams}
              isSampleDemoMode={isSampleDemoMode}
              onTeamsUpdated={onTeamsUpdated}
            />
          </Suspense>
        </WorkspaceErrorBoundary>
      ) : (
        <div className="space-y-3">
          <CoachExecutionDigestPanel
            roster={scopedConnectedAthletes}
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
            complexityTier={complexityTier}
            eventGroupFilter={effectiveAllowedEventGroups}
            onQuickInspectDrawer={onQuickInspectDrawer}
            onInspectAthlete={onInspectAthlete}
            onOpenTeamPlan={onOpenTeamPlan}
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
                initialOpenBillingPlan={openBillingPlanOnRoster}
                onConsumedInitialBilling={onConsumedInitialBilling}
                onSelectActiveTeam={onSelectActiveTeam}
                onTeamsUpdated={onTeamsUpdated}
                onOpenClipboard={onOpenClipboard}
                onOpenExternalSync={onOpenExternalSync}
                onOpenPublicTeamHub={onOpenPublicTeamHub}
              />
            </Suspense>
          </WorkspaceErrorBoundary>

          {activeTeam?.brand?.orgType === 'COLLEGIATE' && showNcaaCara && (
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
                        anchor.download = `meetready-ncaa-cara-${todayIso}.csv`;
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
    </div>
  );
};
