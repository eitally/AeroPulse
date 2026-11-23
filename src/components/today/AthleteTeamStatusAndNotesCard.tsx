import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  MessageSquare,
  Send,
  ShieldCheck,
} from '../icons/PhosphorIcons';
import {
  INJURY_REGION_METADATA,
  RTP_STAGE_METADATA,
} from '../../physiology/injuryHubEngine';
import { postTeamWorkoutCommentApi } from '../../utils/teamLifecycleApi';
import type {
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
> = ({ activeTeam, myTeams, todayIso, isSampleDemoMode = false, onTeamsUpdated }) => {
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

  if (!openRtpCase && visibleComments.length === 0) {
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
