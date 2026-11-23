import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  MessageSquare,
  Send,
  Shield,
  ShieldCheck,
  Users,
} from './icons/PhosphorIcons';
import {
  buildCoachSquadExecutionDigest,
  type DigestFallbackAthleteInput,
} from '../physiology/sessionCheckInAndDigestEngine';
import { evaluateSafeSportPatternWatch } from '../physiology/safeSportPatternWatchEngine';
import { resolveAthleteAgeTier } from '../physiology/ageAndComplianceEngine';
import type {
  CoachComplexityTier,
  CoachEventGroup,
  ConnectedAthleteRecord,
  TeamSummaryWithRole,
  TeamWorkoutComment,
} from '../types';
import { postTeamWorkoutCommentApi } from '../utils/teamLifecycleApi';
import { Adherence7dDots } from './charts/MicroGraphics';

export interface CoachExecutionDigestPanelProps {
  roster: ConnectedAthleteRecord[];
  selfFallback: DigestFallbackAthleteInput;
  todayIso: string;
  activeTeam?: TeamSummaryWithRole | null;
  myTeams?: TeamSummaryWithRole[];
  isSampleDemoMode?: boolean;
  onTeamsUpdated?: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string) => void;
  primaryAthleteDisplayName?: string;
  complexityTier?: CoachComplexityTier;
  eventGroupFilter?: CoachEventGroup[];
  onQuickInspectDrawer?: (athleteId: string) => void;
  onInspectAthlete: (athleteId: string) => void;
  onOpenTeamPlan: () => void;
}

export const CoachExecutionDigestPanel: React.FC<CoachExecutionDigestPanelProps> = ({
  roster,
  selfFallback,
  todayIso,
  activeTeam = null,
  myTeams = [],
  isSampleDemoMode = false,
  onTeamsUpdated,
  primaryAthleteDisplayName,
  complexityTier = 'PRO',
  eventGroupFilter,
  onQuickInspectDrawer,
  onInspectAthlete,
  onOpenTeamPlan,
}) => {
  const [filterMode, setFilterMode] = useState<'ALL' | 'ATTENTION' | 'ON_TRACK'>('ALL');
  const [digestSearch, setDigestSearch] = useState<string>('');
  const [showAllDigestRows, setShowAllDigestRows] = useState<boolean>(false);
  const athleteMembers = useMemo(
    () =>
      (activeTeam?.memberships || []).filter(
        (m) => m.role === 'ATHLETE' && m.status !== 'REVOKED'
      ),
    [activeTeam?.memberships]
  );
  const [commentTargetMembershipId, setCommentTargetMembershipId] = useState<string>(
    () => athleteMembers[0]?.membershipId || ''
  );
  useEffect(() => {
    if (
      athleteMembers.length > 0 &&
      !athleteMembers.some((m) => m.membershipId === commentTargetMembershipId)
    ) {
      setCommentTargetMembershipId(athleteMembers[0].membershipId);
    }
  }, [athleteMembers, commentTargetMembershipId]);
  const [commentDraft, setCommentDraft] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  const selectedCommentMember = useMemo(
    () => athleteMembers.find((m) => m.membershipId === commentTargetMembershipId) || athleteMembers[0] || null,
    [athleteMembers, commentTargetMembershipId]
  );
  const isGuardianCcRequired = Boolean(
    activeTeam &&
      (activeTeam.brand.orgType === 'HIGH_SCHOOL' ||
        activeTeam.brand.enableParentGuardianCc ||
        selectedCommentMember?.isMinorU18)
  );

  const handlePostWorkoutComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTeam || !selectedCommentMember || !commentDraft.trim()) return;
    setCommentError(null);
    const body = commentDraft.trim();

    if (isSampleDemoMode || activeTeam.brand.teamId.startsWith('demo_team_')) {
      const nextComment: TeamWorkoutComment = {
        id: `demo-comment-${Date.now()}`,
        teamId: activeTeam.brand.teamId,
        targetMembershipId: selectedCommentMember.membershipId,
        targetAthleteName: selectedCommentMember.invitedName,
        workoutDate: todayIso,
        authorSid: activeTeam.myMembershipId,
        authorName: activeTeam.brand.coachDisplayName || primaryAthleteDisplayName || 'Coach',
        authorRole: activeTeam.myRole,
        body,
        guardianCcApplied: isGuardianCcRequired,
        guardianVisible: true,
        createdAt: new Date().toISOString(),
      };
      const updatedTeam: TeamSummaryWithRole = {
        ...activeTeam,
        workoutComments: [nextComment, ...(activeTeam.workoutComments || [])],
      };
      onTeamsUpdated?.(
        myTeams.map((t) => (t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t)),
        updatedTeam.brand.teamId
      );
      setCommentDraft('');
      return;
    }

    setIsPostingComment(true);
    try {
      const res = await postTeamWorkoutCommentApi(activeTeam.brand.teamId, {
        targetMembershipId: selectedCommentMember.membershipId,
        workoutDate: todayIso,
        body,
        guardianCc: true,
      });
      if (Array.isArray(res.teams)) {
        onTeamsUpdated?.(res.teams, activeTeam.brand.teamId);
      } else if (res.team) {
        onTeamsUpdated?.(
          myTeams.map((t) => (t.brand.teamId === res.team!.brand.teamId ? res.team! : t)),
          res.team.brand.teamId
        );
      }
      setCommentDraft('');
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : 'Could not post comment.');
    } finally {
      setIsPostingComment(false);
    }
  };

  const digest = useMemo(
    () =>
      buildCoachSquadExecutionDigest({
        roster,
        selfFallback,
        todayIso,
        windowDays: 7,
      }),
    [roster, selfFallback, todayIso]
  );

  const readinessByAthleteId = useMemo(() => {
    const map = new Map<string, { hrv: number; tsb: number; watchLight: string }>();
    for (const ath of roster) {
      const latestW =
        ath.wellnessDays && ath.wellnessDays.length > 0
          ? ath.wellnessDays[ath.wellnessDays.length - 1]
          : null;
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
      map.set(ath.id, {
        hrv: latestW?.hrvRMSSD ?? 0,
        tsb: latestW?.tsb ?? 0,
        watchLight,
      });
    }
    return map;
  }, [roster]);

  const visibleRows = useMemo(() => {
    const groupScoped =
      eventGroupFilter && eventGroupFilter.length > 0
        ? digest.rows.filter(
            (r) =>
              r.isSelfFallback ||
              !r.eventGroup ||
              eventGroupFilter.includes(r.eventGroup as CoachEventGroup)
          )
        : digest.rows;
    if (filterMode === 'ATTENTION') {
      return groupScoped.filter((r) => r.attentionReason !== 'ON_TRACK');
    }
    if (filterMode === 'ON_TRACK') {
      return groupScoped.filter((r) => r.attentionReason === 'ON_TRACK');
    }
    return groupScoped;
  }, [digest.rows, eventGroupFilter, filterMode]);

  const visibleDigestRows = useMemo(() => {
    const q = digestSearch.trim().toLowerCase();
    const searched = q
      ? visibleRows.filter((r) => r.name.toLowerCase().includes(q))
      : visibleRows;
    return showAllDigestRows ? searched : searched.slice(0, 25);
  }, [digestSearch, showAllDigestRows, visibleRows]);

  return (
    <section
      data-testid="coach-execution-digest"
      className="rounded-2xl liquid-glass p-3 sm:p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 ap-text-brand shrink-0" weight="duotone" />
          <h2 className="text-sm sm:text-base font-bold text-ap-ink dark:text-ap-chalk">
            Squad Triage (7d)
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter digest rows">
          {(
            [
              { id: 'ALL', label: `All (${digest.rows.length})` },
              {
                id: 'ATTENTION',
                label: `Attention (${digest.rows.filter((r) => r.attentionReason !== 'ON_TRACK').length})`,
              },
              {
                id: 'ON_TRACK',
                label: `On Track (${digest.rows.filter((r) => r.attentionReason === 'ON_TRACK').length})`,
              },
            ] as const
          ).map((f) => {
            const active = filterMode === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilterMode(f.id)}
                className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl text-xs font-semibold cursor-pointer ${
                  active
                    ? 'ap-nav-volt-active'
                    : 'liquid-capsule-track text-slate-700 dark:text-slate-200'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {digest.rows.length > 6 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <input
            type="search"
            data-testid="digest-search-input"
            aria-label="Search athletes in triage"
            value={digestSearch}
            onChange={(e) => setDigestSearch(e.target.value)}
            placeholder={`Search ${digest.rows.length} athletes...`}
            className="w-full sm:w-64 min-h-[40px] sm:min-h-[36px] rounded-xl border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-3 text-xs text-ap-ink dark:text-ap-chalk"
          />
          {visibleRows.length > 25 && (
            <button
              type="button"
              onClick={() => setShowAllDigestRows((prev) => !prev)}
              className="min-h-[36px] px-2.5 rounded-lg ap-card-inset text-2xs font-mono font-bold cursor-pointer"
            >
              {showAllDigestRows ? 'Show First 25' : `Show All (${visibleRows.length})`}
            </button>
          )}
        </div>
      )}

      {/* 4 Crisp Summary Metric Tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 font-mono tabular-nums">
        <div className="rounded-xl ap-card-inset px-3.5 py-2.5">
          <div className="text-2xs uppercase tracking-wider text-slate-600 dark:text-slate-400">
            7d Compliance
          </div>
          <div className="text-lg font-extrabold text-slate-900 dark:text-white">
            {digest.teamCompliancePct}%
          </div>
        </div>
        <div className="rounded-xl ap-card-inset px-3.5 py-2.5">
          <div className="text-2xs uppercase tracking-wider text-slate-600 dark:text-slate-400">
            Checked In (24h)
          </div>
          <div className="text-lg font-extrabold text-slate-900 dark:text-white">
            {digest.checkedInLast24hCount}/{digest.totalAthletes}
          </div>
        </div>
        <div className="rounded-xl ap-card-inset px-3.5 py-2.5">
          <div className="text-2xs uppercase tracking-wider text-slate-600 dark:text-slate-400">
            Pain / Safety Swaps
          </div>
          <div
            className={`text-lg font-extrabold ${
              digest.painFlagCount > 0
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-slate-900 dark:text-white'
            }`}
          >
            {digest.painFlagCount} ({digest.swappedCount} swapped)
          </div>
        </div>
        <div className="rounded-xl ap-card-inset px-3.5 py-2.5">
          <div className="text-2xs uppercase tracking-wider text-slate-600 dark:text-slate-400">
            High Strain / Stress
          </div>
          <div className="text-lg font-extrabold text-slate-900 dark:text-white">
            {digest.highRpeCount}
            {digest.lifeStressCount > 0 ? ` · ${digest.lifeStressCount} stress` : ''}
          </div>
        </div>
      </div>

      {/* Athlete Digest List */}
      {visibleDigestRows.length === 0 ? (
        <div className="rounded-xl ap-card-inset p-4 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
          <Users className="w-4 h-4 ap-text-brand shrink-0" />
          <span>No athletes match the selected filter right now.</span>
        </div>
      ) : (
        <div className="space-y-2">
          {visibleDigestRows.map((row) => {
            const readiness = readinessByAthleteId.get(row.athleteId);
            const hasWatchAlert =
              readiness && readiness.watchLight !== 'GREEN_CLEAR';
            const badgeClass =
              row.attentionReason === 'PAIN_FLAG' ||
              row.attentionReason === 'INJURED' ||
              readiness?.watchLight === 'RED_MEDICAL_REVIEW'
                ? 'ap-status-strained'
                : row.attentionReason === 'HIGH_RPE_STRAIN' ||
                    row.attentionReason === 'HIGH_LIFE_STRESS' ||
                    row.attentionReason === 'MISSED_KEY_SESSIONS' ||
                    hasWatchAlert
                  ? 'ap-status-caution'
                  : 'ap-status-prime';

            return (
              <div
                key={row.athleteId}
                data-testid={`digest-row-${row.athleteId}`}
                className="rounded-xl border border-ap-frame/15 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`px-2 py-0.5 rounded text-2xs font-mono font-bold uppercase ${badgeClass}`}
                    >
                      {row.attentionReason === 'PAIN_FLAG'
                        ? 'Pain Flag'
                        : row.attentionReason === 'INJURED'
                          ? 'Injured'
                          : row.attentionReason === 'HIGH_RPE_STRAIN'
                            ? 'High Strain'
                            : row.attentionReason === 'HIGH_LIFE_STRESS'
                              ? 'High Stress'
                              : row.attentionReason === 'MISSED_KEY_SESSIONS'
                                ? 'Missed Sessions'
                                : readiness?.watchLight === 'RED_MEDICAL_REVIEW'
                                  ? 'Medical Check'
                                  : readiness?.watchLight === 'AMBER_WATCH'
                                    ? 'Needs Review'
                                    : 'On Track'}
                    </span>
                    <span className="font-bold text-ap-ink dark:text-ap-chalk truncate">
                      {row.name}
                    </span>
                    {row.checkInStreakDays > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-2xs font-mono bg-amber-500/15 text-amber-700 dark:text-amber-300 tabular-nums">
                        {row.checkInStreakDays}d streak
                      </span>
                    )}
                    {complexityTier !== 'ESSENTIALS' &&
                      readiness &&
                      (readiness.hrv > 0 || readiness.tsb !== 0) && (
                      <span className="px-1.5 py-0.5 rounded text-2xs font-mono ap-card-inset text-ap-muted dark:text-ap-muted-dark tabular-nums">
                        {readiness.hrv > 0 ? `HRV ${Math.round(readiness.hrv)}ms · ` : ''}
                        Form {readiness.tsb >= 0 ? `+${Math.round(readiness.tsb)}` : Math.round(readiness.tsb)}
                      </span>
                    )}
                    {row.eventGroup && (
                      <span className="px-1.5 py-0.5 rounded text-2xs font-mono ap-card-inset text-[#1F3528] dark:text-[#C8D8CE]">
                        {row.eventGroup}
                      </span>
                    )}
                    {row.isSelfFallback && (
                      <span className="px-1.5 py-0.5 rounded text-2xs font-mono ap-card-inset text-ap-muted dark:text-ap-muted-dark">
                        Coach Preview
                      </span>
                    )}
                  </div>
                  <div className="text-2xs text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    {row.attentionReason === 'ON_TRACK' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    ) : (
                      <Shield className="w-3.5 h-3.5 ap-text-brand shrink-0" />
                    )}
                    <span>{row.attentionSummary}</span>
                    {row.latestCheckIn?.sorenessNote && (
                      <span className="text-slate-500 dark:text-slate-400 truncate">
                        · {row.latestCheckIn.sorenessNote}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 font-mono">
                  <Adherence7dDots
                    completedCount={row.completedCount7d}
                    hasPainFlag={row.attentionReason === 'PAIN_FLAG'}
                  />
                  <div className="text-right tabular-nums">
                    <div className="font-bold text-slate-900 dark:text-white">
                      {row.completedCount7d}/{row.plannedCount7d} ({row.compliancePct}%)
                    </div>
                    <div className="text-2xs text-slate-600 dark:text-slate-400">
                      {row.latestCheckIn ? `RPE ${row.latestCheckIn.rpe}/10` : 'No check-in yet'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (row.isSelfFallback) {
                        onOpenTeamPlan();
                      } else if (complexityTier === 'ESSENTIALS' && onQuickInspectDrawer) {
                        onQuickInspectDrawer(row.athleteId);
                      } else {
                        onInspectAthlete(row.athleteId);
                      }
                    }}
                    className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-lg bg-[#E3ECE5] dark:bg-ap-turf text-ap-cobalt dark:text-ap-volt text-2xs font-semibold cursor-pointer"
                  >
                    {row.isSelfFallback ? 'Team Plan' : complexityTier === 'ESSENTIALS' ? 'Summary' : 'Inspect'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTeam && (activeTeam.guardianSafetyAlerts?.length || 0) > 0 && (
        <div
          data-testid="guardian-safety-alerts-banner"
          className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2.5 space-y-1 text-xs"
        >
          <div className="font-bold text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 shrink-0" />
            <span>
              Guardian Safety Alerts ({activeTeam.guardianSafetyAlerts!.length})
            </span>
          </div>
          {activeTeam.guardianSafetyAlerts!.slice(0, 3).map((al) => (
            <div
              key={al.id}
              className="text-2xs font-mono text-slate-800 dark:text-slate-200 flex flex-wrap items-center justify-between gap-2"
            >
              <span>{al.summary}</span>
              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-900 dark:text-amber-200">
                {al.deliveryStatus === 'SENT' ? 'Guardian Notified' : al.deliveryStatus}
              </span>
            </div>
          ))}
        </div>
      )}

      {activeTeam && athleteMembers.length > 0 && (
        <div
          data-testid="coach-workout-comments"
          className="pt-2 border-t border-stone-200/80 dark:border-ap-edge space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 ap-text-brand shrink-0" weight="duotone" />
              <h3 className="text-xs sm:text-sm font-bold text-ap-ink dark:text-ap-chalk">
                Workout Notes &amp; SafeSport Comments
              </h3>
            </div>
            {isGuardianCcRequired && (
              <span
                data-testid="guardian-cc-badge"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-mono font-semibold ap-status-prime"
              >
                <ShieldCheck className="w-3 h-3" />
                <span>Parent/Guardian CC Active</span>
              </span>
            )}
          </div>

          <form onSubmit={(e) => void handlePostWorkoutComment(e)} className="flex flex-wrap items-center gap-2">
            <select
              data-testid="workout-comment-athlete-select"
              aria-label="Target athlete for workout comment"
              value={commentTargetMembershipId}
              onChange={(e) => setCommentTargetMembershipId(e.target.value)}
              className="min-h-[44px] sm:min-h-[36px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-carbon px-2.5 py-1 text-xs font-semibold text-slate-900 dark:text-slate-100"
            >
              {athleteMembers.map((m) => (
                <option key={m.membershipId} value={m.membershipId}>
                  {m.invitedName}
                </option>
              ))}
            </select>
            <input
              type="text"
              data-testid="workout-comment-input"
              aria-label="Workout feedback note"
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              placeholder="Share split feedback or recovery cue (auto-CC'd to guardian for minors)..."
              className="flex-1 min-w-[220px] min-h-[44px] sm:min-h-[36px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-carbon px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              data-testid="workout-comment-submit"
              disabled={isPostingComment || !commentDraft.trim()}
              className="ap-btn-primary !min-h-[44px] sm:!min-h-[36px] px-3.5 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isPostingComment ? 'Posting…' : 'Post Note'}</span>
            </button>
          </form>

          {commentError && (
            <div role="alert" className="text-2xs font-mono text-red-600 dark:text-red-400">
              {commentError}
            </div>
          )}

          {(activeTeam.workoutComments || []).length > 0 && (
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {(activeTeam.workoutComments || []).slice(0, 6).map((c) => (
                <div
                  key={c.id}
                  className="rounded-xl border border-stone-200 dark:border-ap-edge bg-white/80 dark:bg-ap-carbon px-3 py-2 text-xs space-y-0.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-2xs font-mono text-slate-500">
                    <span>
                      <strong className="text-slate-900 dark:text-white">{c.authorName}</strong>
                      {' → '}
                      {c.targetAthleteName || 'Athlete'} · {c.workoutDate}
                    </span>
                    {c.guardianCcApplied && (
                      <span className="px-1.5 py-0.5 rounded ap-status-info text-2xs">
                        Guardian CC ✓
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-800 dark:text-slate-200 leading-snug">
                    {c.body}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
