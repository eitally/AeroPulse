import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ExternalLink,
  MessageSquare,
  Send,
  ShieldCheck,
  Timer,
} from '../icons/PhosphorIcons';
import {
  INJURY_REGION_METADATA,
  RTP_STAGE_METADATA,
} from '../../physiology/injuryHubEngine';
import { postTeamWorkoutCommentApi } from '../../utils/teamLifecycleApi';
import type {
  AthleteOwnMeetScheduleItem,
  DelegatedTimingSessionRecord,
  TeamInjuryCaseRecord,
  TeamInjuryRtpStage,
  TeamSummaryWithRole,
  TeamWorkoutComment,
} from '../../types';

export interface AthleteTeamStatusAndNotesCardProps {
  activeTeam: TeamSummaryWithRole;
  myTeams: TeamSummaryWithRole[];
  todayIso: string;
  isSampleDemoMode?: boolean;
  onTeamsUpdated?: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string) => void;
  onLaunchDelegatedTiming?: (assignment: DelegatedTimingSessionRecord) => void;
}

export function isDelegatedTimingAssignmentActive(
  session: DelegatedTimingSessionRecord,
  todayIso: string
): boolean {
  if (session.revokedAt) return false;
  if (!session.expiresAt) return true;
  return session.expiresAt.slice(0, 10) >= todayIso;
}

export function formatMeetTimeWithDelay(
  rawTime?: string,
  delayMinutes = 0
): { display: string; delayApplied: boolean } | null {
  const trimmed = rawTime?.trim();
  if (!trimmed) return null;
  const cleanDelay = Number.isFinite(delayMinutes) ? Math.round(delayMinutes) : 0;

  const match24 = trimmed.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  const match12 = trimmed.match(/^(\d{1,2}):([0-5]\d)\s*(AM|PM)$/i);
  let totalMins: number | null = null;
  if (match24) {
    totalMins = Number(match24[1]) * 60 + Number(match24[2]);
  } else if (match12) {
    let h = Number(match12[1]) % 12;
    if (match12[3].toUpperCase() === 'PM') h += 12;
    totalMins = h * 60 + Number(match12[2]);
  }

  if (totalMins === null) {
    return {
      display: cleanDelay !== 0 ? `${trimmed} (${cleanDelay > 0 ? `+${cleanDelay}m` : `${cleanDelay}m`})` : trimmed,
      delayApplied: cleanDelay !== 0,
    };
  }

  const shifted = ((totalMins + cleanDelay) % 1440 + 1440) % 1440;
  const hh = Math.floor(shifted / 60);
  const mm = shifted % 60;
  const period = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return {
    display: `${h12}:${String(mm).padStart(2, '0')} ${period}`,
    delayApplied: cleanDelay !== 0,
  };
}

function sanitizeExternalMeetUrl(url?: string): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

const ZERO_IMPACT_MODULATION_GUIDANCE: Record<Exclude<TeamInjuryRtpStage, 'CLEARED'>, string> = {
  OUT: 'Hold all running and impact reps today. Stick to AT-cleared rest or supine mobility work only.',
  MODIFIED:
    'Zero-impact modulation: replace track/road impact with stationary bike spin, aqua jogging, or elliptical Z1/Z2.',
  LIMITED:
    'Sub-threshold modulation: cap intensity and volume strictly within your Athletic Trainer restrictions; stop immediately if pain spikes.',
};

function rtpBannerClass(stage: TeamInjuryRtpStage): string {
  if (stage === 'OUT') return 'ap-status-strained border border-rose-500/35';
  if (stage === 'MODIFIED') return 'ap-status-caution border border-amber-500/35';
  return 'ap-status-info border border-sky-500/35';
}

export const AthleteTeamStatusAndNotesCard: React.FC<
  AthleteTeamStatusAndNotesCardProps
> = ({
  activeTeam,
  myTeams,
  todayIso,
  isSampleDemoMode = false,
  onTeamsUpdated,
  onLaunchDelegatedTiming,
}) => {
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const openRtpCase = useMemo<TeamInjuryCaseRecord | null>(() => {
    const cases = activeTeam.injuryCases || [];
    return (
      cases.find(
        (c) => c.membershipId === activeTeam.myMembershipId && c.rtpStage !== 'CLEARED'
      ) || null
    );
  }, [activeTeam.injuryCases, activeTeam.myMembershipId]);

  const activeDelegatedAssignments = useMemo<DelegatedTimingSessionRecord[]>(
    () =>
      (activeTeam.myDelegatedTimingAssignments || []).filter((s) =>
        isDelegatedTimingAssignmentActive(s, todayIso)
      ),
    [activeTeam.myDelegatedTimingAssignments, todayIso]
  );

  const upcomingMeetSchedule = useMemo<AthleteOwnMeetScheduleItem[]>(() => {
    const items = (activeTeam.myMeetDaySchedule || []).filter(
      (item) => !item.meetDate || item.meetDate.slice(0, 10) >= todayIso
    );
    return [...items].sort((a, b) => {
      const dateCmp = String(a.meetDate || '').localeCompare(String(b.meetDate || ''));
      if (dateCmp !== 0) return dateCmp;
      return String(a.checkInCallTime || a.eventStartTime || a.eventCode).localeCompare(
        String(b.checkInCallTime || b.eventStartTime || b.eventCode)
      );
    });
  }, [activeTeam.myMeetDaySchedule, todayIso]);

  const visibleComments = useMemo<TeamWorkoutComment[]>(() => {
    const allComments = activeTeam.workoutComments || [];
    const scoped =
      activeTeam.myRole === 'ATHLETE'
        ? allComments.filter((c) => c.targetMembershipId === activeTeam.myMembershipId)
        : allComments;
    return [...scoped]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 6);
  }, [activeTeam.workoutComments, activeTeam.myRole, activeTeam.myMembershipId]);

  if (activeTeam.myRole === 'PARENT_FOLLOWER') {
    return null;
  }

  if (
    !openRtpCase &&
    visibleComments.length === 0 &&
    activeDelegatedAssignments.length === 0 &&
    upcomingMeetSchedule.length === 0
  ) {
    return null;
  }

  const isDemoTeam =
    isSampleDemoMode ||
    activeTeam.brand.teamId.startsWith('demo_team_') ||
    activeTeam.brand.teamId.startsWith('demo-team-');

  const replyTargetMembershipId =
    activeTeam.myRole === 'ATHLETE'
      ? activeTeam.myMembershipId
      : visibleComments[0]?.targetMembershipId || activeTeam.myMembershipId;

  const myMember = (activeTeam.memberships || []).find(
    (m) => m.membershipId === activeTeam.myMembershipId
  );

  const handleSubmitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = replyText.trim();
    if (!trimmed || isSending) return;
    setErrorMessage(null);
    setStatusMessage(null);

    const guardianCc = Boolean(activeTeam.brand.enableParentGuardianCc);

    if (isDemoTeam) {
      const targetMem = (activeTeam.memberships || []).find(
        (m) => m.membershipId === replyTargetMembershipId
      );
      const localComment: TeamWorkoutComment = {
        id: `demo-comment-${Date.now()}`,
        teamId: activeTeam.brand.teamId,
        targetMembershipId: replyTargetMembershipId,
        targetAthleteName: targetMem?.invitedName || 'Team Athlete',
        workoutDate: todayIso,
        authorSid: activeTeam.myMembershipId,
        authorName: myMember?.invitedName || activeTeam.brand.coachDisplayName || 'You',
        authorRole: activeTeam.myRole,
        body: trimmed,
        guardianCcApplied: guardianCc,
        guardianVisible: guardianCc,
        createdAt: new Date().toISOString(),
      };
      const updatedTeam: TeamSummaryWithRole = {
        ...activeTeam,
        workoutComments: [localComment, ...(activeTeam.workoutComments || [])],
      };
      const nextTeams =
        myTeams.length > 0
          ? myTeams.map((t) => (t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t))
          : [updatedTeam];
      onTeamsUpdated?.(nextTeams, updatedTeam.brand.teamId);
      setReplyText('');
      setStatusMessage(
        guardianCc
          ? 'Note posted with SafeSport Guardian-CC visibility.'
          : 'Note posted to coach thread.'
      );
      return;
    }

    setIsSending(true);
    try {
      const resp = await postTeamWorkoutCommentApi(activeTeam.brand.teamId, {
        targetMembershipId: replyTargetMembershipId,
        workoutDate: todayIso,
        body: trimmed,
        guardianCc,
      });
      if (resp.teams && resp.teams.length > 0) {
        onTeamsUpdated?.(resp.teams, activeTeam.brand.teamId);
      } else if (resp.team) {
        const nextTeams =
          myTeams.length > 0
            ? myTeams.map((t) => (t.brand.teamId === resp.team!.brand.teamId ? resp.team! : t))
            : [resp.team];
        onTeamsUpdated?.(nextTeams, resp.team.brand.teamId);
      } else if (resp.comment) {
        const updatedTeam: TeamSummaryWithRole = {
          ...activeTeam,
          workoutComments: [resp.comment, ...(activeTeam.workoutComments || [])],
        };
        const nextTeams =
          myTeams.length > 0
            ? myTeams.map((t) => (t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t))
            : [updatedTeam];
        onTeamsUpdated?.(nextTeams, updatedTeam.brand.teamId);
      }
      setReplyText('');
      setStatusMessage(
        guardianCc
          ? 'Note posted with SafeSport Guardian-CC visibility.'
          : 'Note posted to coach thread.'
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not post comment to team thread.'
      );
    } finally {
      setIsSending(false);
    }
  };

  const openRtpStage =
    openRtpCase && openRtpCase.rtpStage !== 'CLEARED' ? openRtpCase.rtpStage : null;

  return (
    <div className="space-y-2.5" data-testid="athlete-team-status-and-notes">
      {openRtpCase && openRtpStage && (
        <section
          data-testid="athlete-at-rtp-banner"
          className={`rounded-2xl px-3.5 py-3 sm:px-4 space-y-2 ${rtpBannerClass(openRtpStage)}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="text-xs font-extrabold tracking-tight">
                Athletic Trainer Return-to-Play Status · {openRtpStage}
              </span>
              <span className="px-2 py-0.5 rounded font-mono text-2xs font-bold bg-black/10 dark:bg-white/10">
                {INJURY_REGION_METADATA[openRtpCase.bodyRegion]?.shortLabel ||
                  openRtpCase.bodyRegion}
              </span>
            </div>
            {openRtpCase.targetReturnDate && (
              <span className="text-2xs font-mono font-bold">
                Target Return: {openRtpCase.targetReturnDate}
              </span>
            )}
          </div>

          <p className="text-xs leading-snug font-medium">
            <strong className="font-bold">Restrictions:</strong>{' '}
            {openRtpCase.restrictions || RTP_STAGE_METADATA[openRtpStage].rosterSyncLabel}
          </p>

          <p className="text-2xs leading-snug opacity-90">
            <strong className="font-bold">Zero-Impact Modulation Guidance:</strong>{' '}
            {ZERO_IMPACT_MODULATION_GUIDANCE[openRtpStage]}{' '}
            {openRtpCase.coachGuidance ? `(${openRtpCase.coachGuidance})` : ''}
          </p>
        </section>
      )}

      {activeDelegatedAssignments.length > 0 && (
        <section
          data-testid="athlete-delegated-timing-card"
          className="rounded-2xl liquid-glass px-3.5 py-3 sm:px-4 space-y-2.5 border border-ap-cobalt/25 dark:border-ap-volt/35"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Timer className="w-4 h-4 ap-text-brand shrink-0" weight="duotone" />
              <span className="text-xs font-extrabold tracking-tight text-ap-ink dark:text-ap-chalk">
                Assigned to Time ({activeDelegatedAssignments.length})
              </span>
            </div>
            <span className="px-2 py-0.5 rounded-md ap-status-prime font-mono text-2xs font-bold uppercase">
              Pocket Timing Ready
            </span>
          </div>

          <div className="space-y-2">
            {activeDelegatedAssignments.map((session) => (
              <div
                key={session.sessionId}
                data-testid={`athlete-delegated-session-${session.sessionId}`}
                className="rounded-xl ap-card-inset px-3 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="font-extrabold text-ap-ink dark:text-ap-chalk">
                      {session.eventLabel || session.eventCode}
                      {session.heatLabel ? ` · ${session.heatLabel}` : ''}
                    </span>
                    <span className="px-1.5 py-0.5 rounded ap-status-info font-mono text-2xs font-bold">
                      {session.stationLabel}
                    </span>
                  </div>
                  <div className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                    {session.meetTitle} · {session.meetDate} · {session.splitPlanLabel} ·{' '}
                    {session.runners.length} runner{session.runners.length === 1 ? '' : 's'}
                  </div>
                  {session.runners.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {session.runners.slice(0, 6).map((runner) => (
                        <span
                          key={runner.entryKey}
                          className="px-1.5 py-0.5 rounded bg-white/80 dark:bg-ap-carbon border border-ap-frame/15 dark:border-ap-edge-dark text-2xs font-mono text-ap-ink dark:text-ap-chalk"
                        >
                          {runner.hipOrLane ? `${runner.hipOrLane} · ` : ''}
                          {runner.displayName}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  data-testid={`open-delegated-timing-pad-${session.sessionId}`}
                  onClick={() => onLaunchDelegatedTiming?.(session)}
                  className="ap-btn-primary !min-h-[44px] sm:!min-h-[38px] px-3.5 py-2 text-xs font-bold inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <Timer className="w-3.5 h-3.5 shrink-0" weight="bold" />
                  <span>Open Pocket Timing Pad</span>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {upcomingMeetSchedule.length > 0 && (
        <section
          data-testid="athlete-meet-day-card"
          className="rounded-2xl liquid-glass px-3.5 py-3 sm:px-4 space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Calendar className="w-4 h-4 ap-text-brand shrink-0" weight="duotone" />
              <span className="text-xs font-extrabold tracking-tight text-ap-ink dark:text-ap-chalk">
                My Meet Day Card ({upcomingMeetSchedule.length})
              </span>
            </div>
            <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
              Official heats, call times &amp; lane assignments
            </span>
          </div>

          <div className="space-y-2">
            {upcomingMeetSchedule.map((item) => {
              const callTime = formatMeetTimeWithDelay(
                item.checkInCallTime,
                item.meetDelayMinutes
              );
              const startTime = formatMeetTimeWithDelay(
                item.eventStartTime,
                item.meetDelayMinutes
              );
              const safeLiveUrl = sanitizeExternalMeetUrl(item.athleticLiveUrl);
              return (
                <div
                  key={`${item.packetId}-${item.eventCode}-${item.officialHeat ?? 'x'}-${item.officialLaneOrHip ?? 'x'}`}
                  data-testid={`athlete-meet-entry-${item.eventCode}`}
                  className="rounded-xl ap-card-inset px-3 py-2.5 space-y-1.5 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      <span
                        className={`font-extrabold text-ap-ink dark:text-ap-chalk ${
                          item.scratched ? 'line-through opacity-65' : ''
                        }`}
                      >
                        {item.eventCode}
                      </span>
                      {item.division && (
                        <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                          · {item.division}
                        </span>
                      )}
                      {item.relayTeamCode && (
                        <span className="px-1.5 py-0.5 rounded ap-status-info font-mono text-2xs font-bold">
                          Relay {item.relayTeamCode}
                          {item.relayLegOrder ? ` · Leg ${item.relayLegOrder}` : ''}
                          {item.isAlternate ? ' (Alt)' : ''}
                        </span>
                      )}
                      {item.scratched && (
                        <span className="px-2 py-0.5 rounded ap-status-strained font-mono text-2xs font-bold uppercase">
                          SCRATCHED
                        </span>
                      )}
                      {typeof item.meetDelayMinutes === 'number' &&
                        item.meetDelayMinutes !== 0 && (
                          <span className="px-2 py-0.5 rounded ap-status-caution font-mono text-2xs font-bold">
                            Meet Delay {item.meetDelayMinutes > 0 ? `+${item.meetDelayMinutes}m` : `${item.meetDelayMinutes}m`}
                          </span>
                        )}
                    </div>

                    <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                      {item.meetTitle} · {item.meetDate}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 font-mono text-2xs text-ap-ink dark:text-ap-chalk">
                    {typeof item.officialHeat === 'number' && (
                      <span className="px-2 py-0.5 rounded bg-white/80 dark:bg-ap-carbon border border-ap-frame/15 dark:border-ap-edge-dark font-bold">
                        Heat {item.officialHeat}
                      </span>
                    )}
                    {item.officialLaneOrHip && (
                      <span className="px-2 py-0.5 rounded bg-white/80 dark:bg-ap-carbon border border-ap-frame/15 dark:border-ap-edge-dark font-bold">
                        Lane / Hip {item.officialLaneOrHip}
                      </span>
                    )}
                    {typeof item.officialFlight === 'number' && (
                      <span className="px-2 py-0.5 rounded bg-white/80 dark:bg-ap-carbon border border-ap-frame/15 dark:border-ap-edge-dark font-bold">
                        Flight {item.officialFlight}
                        {typeof item.officialOrder === 'number' ? ` #${item.officialOrder}` : ''}
                      </span>
                    )}
                    {item.bibNumber && (
                      <span className="px-2 py-0.5 rounded bg-white/80 dark:bg-ap-carbon border border-ap-frame/15 dark:border-ap-edge-dark">
                        Bib #{item.bibNumber}
                      </span>
                    )}
                    {item.seedMarkRaw && (
                      <span className="text-ap-muted dark:text-ap-muted-dark">
                        Seed {item.seedMarkRaw}
                      </span>
                    )}
                  </div>

                  {(callTime || startTime || safeLiveUrl) && (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-2xs font-mono">
                      <div className="flex flex-wrap items-center gap-2 text-ap-ink dark:text-ap-chalk">
                        {callTime && (
                          <span>
                            Check-In Call: <strong>{callTime.display}</strong>
                          </span>
                        )}
                        {startTime && (
                          <span>
                            Event Start: <strong>{startTime.display}</strong>
                          </span>
                        )}
                        {(callTime?.delayApplied || startTime?.delayApplied) && (
                          <span className="text-amber-700 dark:text-amber-300 font-semibold">
                            (includes meet delay)
                          </span>
                        )}
                      </div>
                      {safeLiveUrl && (
                        <a
                          href={safeLiveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-bold text-ap-cobalt dark:text-ap-volt hover:underline min-h-[32px]"
                        >
                          <span>AthleticLIVE</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {visibleComments.length > 0 && (
        <section
          data-testid="athlete-coach-notes-card"
          className="rounded-2xl liquid-glass px-3.5 py-3 sm:px-4 space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-extrabold text-ap-ink dark:text-ap-chalk">
              <MessageSquare className="w-4 h-4 ap-text-brand shrink-0" weight="duotone" />
              <span>
                {activeTeam.brand.shortName || activeTeam.brand.name} · Coach Notes &amp; Feedback
              </span>
            </div>
            {activeTeam.brand.enableParentGuardianCc && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md ap-status-prime font-mono text-2xs font-bold">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>SafeSport Guardian-CC Active</span>
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            {visibleComments.map((comment) => (
              <div
                key={comment.id}
                data-testid={`athlete-coach-note-${comment.id}`}
                className="rounded-xl ap-card-inset px-3 py-2 space-y-1 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-1.5 text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                  <span className="font-bold text-ap-ink dark:text-ap-chalk">
                    {comment.authorName}
                    {comment.targetAthleteName && activeTeam.myRole !== 'ATHLETE'
                      ? ` → ${comment.targetAthleteName}`
                      : ''}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {comment.guardianCcApplied && (
                      <span className="px-1.5 py-0.5 rounded ap-status-info text-2xs font-bold">
                        Guardian-CC
                      </span>
                    )}
                    <span>{comment.workoutDate || String(comment.createdAt).slice(0, 10)}</span>
                  </div>
                </div>
                <p className="text-xs leading-snug text-ap-ink dark:text-ap-chalk">
                  {comment.body}
                </p>
              </div>
            ))}
          </div>

          <form onSubmit={(e) => void handleSubmitReply(e)} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              maxLength={400}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Reply to coach note (Guardian-CC logged)..."
              aria-label="Reply to coach note"
              data-testid="athlete-coach-note-reply-input"
              className="flex-1 min-h-[44px] sm:min-h-[38px] rounded-xl border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-3 text-xs text-ap-ink dark:text-ap-chalk"
            />
            <button
              type="submit"
              disabled={isSending || !replyText.trim()}
              data-testid="athlete-coach-note-reply-submit"
              className="ap-btn-primary !min-h-[44px] sm:!min-h-[38px] px-3.5 py-1.5 text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
            >
              <Send className="w-3.5 h-3.5 shrink-0" />
              <span>{isSending ? 'Sending…' : 'Send Reply'}</span>
            </button>
          </form>

          {statusMessage && (
            <div
              role="status"
              className="rounded-lg px-2.5 py-1.5 text-2xs font-semibold ap-status-prime flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="rounded-lg px-2.5 py-1.5 text-2xs font-semibold ap-status-caution flex items-center gap-1.5"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
        </section>
      )}
    </div>
  );
};
