import React, { Suspense, useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  MapPin,
  Timer,
  Trophy,
  Users,
} from '../icons/PhosphorIcons';
import { useTeamEvents } from '../../hooks/useTeamEvents';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { formatRaceTimingBadgeLabel, isHandTimedRaceData } from '../../utils/raceTimingBadge';
import { formatPracticeTime12h } from '../../utils/workoutScheduleUtils';
import type {
  TeamEventRecord,
  TeamEventRsvpRecord,
  TeamEventRsvpStatus,
  TeamEventTravelMode,
  TeamMembershipRecord,
  TeamSummaryWithRole,
} from '../../types';

const TeamCalendarSubscribeButton = lazyWithRetry(
  () =>
    import('../calendar/TeamCalendarSubscribeButton').then((m) => ({
      default: m.TeamCalendarSubscribeButton,
    })),
  { chunkKey: 'TeamCalendarSubscribeButton', restoreTab: 'fitness' }
);

export interface FamilyMeetHubCardProps {
  activeTeam: TeamSummaryWithRole;
  todayIso: string;
  isSampleDemoMode?: boolean;
}

const RSVP_BUTTONS: ReadonlyArray<{ status: TeamEventRsvpStatus; label: string }> = [
  { status: 'GOING', label: 'Going' },
  { status: 'LATE', label: 'Late' },
  { status: 'MEET_CONFLICT', label: 'Conflict' },
  { status: 'OUT', label: 'Out' },
];

const TRAVEL_MODES: ReadonlyArray<{ mode: TeamEventTravelMode; label: string }> = [
  { mode: 'TEAM_BUS', label: 'Team Bus' },
  { mode: 'PARENT_PICKUP', label: 'Parent Pickup' },
  { mode: 'SELF_TRAVEL', label: 'Self Travel' },
];

export const FamilyMeetHubCard: React.FC<FamilyMeetHubCardProps> = ({
  activeTeam,
  todayIso,
  isSampleDemoMode = false,
}) => {
  const isDemoTeam =
    isSampleDemoMode ||
    activeTeam.brand.teamId.startsWith('demo_team_') ||
    activeTeam.brand.teamId.startsWith('demo-team-');

  const { events, myRsvps, rsvpsByEventId, submitRsvp, loading } = useTeamEvents(
    activeTeam,
    isDemoTeam
  );

  const [savingRsvp, setSavingRsvp] = useState<boolean>(false);

  const rsvpByEventAndMember = useMemo(() => {
    const map = new Map<string, TeamEventRsvpRecord>();
    for (const r of [...Object.values(rsvpsByEventId).flat(), ...myRsvps]) {
      map.set(`${r.eventId}::${r.membershipId}`, r);
    }
    return map;
  }, [rsvpsByEventId, myRsvps]);

  const linkedChildren = useMemo<TeamMembershipRecord[]>(() => {
    const linkedIds = new Set(activeTeam.myLinkedChildMembershipIds || []);
    const allAthletes = (activeTeam.memberships || []).filter(
      (m) => m.role === 'ATHLETE' && m.status !== 'REVOKED'
    );
    if (linkedIds.size > 0) {
      return allAthletes.filter((m) => linkedIds.has(m.membershipId));
    }
    return isDemoTeam ? allAthletes.slice(0, 1) : [];
  }, [activeTeam.memberships, activeTeam.myLinkedChildMembershipIds, isDemoTeam]);

  const [selectedChildId, setSelectedChildId] = useState<string>(
    () => linkedChildren[0]?.membershipId || ''
  );

  const activeChild = useMemo(
    () =>
      linkedChildren.find((c) => c.membershipId === selectedChildId) ||
      linkedChildren[0] ||
      null,
    [linkedChildren, selectedChildId]
  );

  const [noteDraftByEvent, setNoteDraftByEvent] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);

  const upcomingEvents = useMemo<TeamEventRecord[]>(
    () =>
      events
        .filter((ev) => ev.date >= todayIso && ev.visibilityScope !== 'STAFF_ONLY')
        .slice(0, 4),
    [events, todayIso]
  );

  const upcomingMeetSchedule = useMemo(
    () =>
      (activeTeam.myMeetDaySchedule || [])
        .filter((item) => !item.meetDate || item.meetDate.slice(0, 10) >= todayIso)
        .filter(
          (item) =>
            !activeChild || !item.membershipId || item.membershipId === activeChild.membershipId
        )
        .slice(0, 5),
    [activeTeam.myMeetDaySchedule, activeChild, todayIso]
  );

  const childLatestSplits = useMemo(() => {
    const recorded = activeChild?.coachRecordedActivities || [];
    return recorded
      .filter((a) => Boolean(a.officialRaceData))
      .sort((a, b) => String(b.startDateLocal).localeCompare(String(a.startDateLocal)))
      .slice(0, 3);
  }, [activeChild]);

  const handleRsvp = async (
    eventId: string,
    status: TeamEventRsvpStatus,
    travelMode?: TeamEventTravelMode
  ) => {
    const membershipId = activeChild?.membershipId || activeTeam.myMembershipId;
    const note = noteDraftByEvent[eventId];
    setSavingRsvp(true);
    try {
      await submitRsvp({ eventId, membershipId, status, travelMode, note });
      setFeedback(`Saved RSVP (${status.replace('_', ' ')}) for ${activeChild?.invitedName || 'student-athlete'}.`);
    } finally {
      setSavingRsvp(false);
    }
  };

  return (
    <section
      data-testid="family-meet-hub-card"
      className="rounded-2xl liquid-glass p-4 sm:p-5 space-y-4 border border-ap-cobalt/20 dark:border-ap-volt/25"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-ap-cobalt dark:text-ap-volt">
            <Users className="w-4 h-4 shrink-0" />
            <span>{activeTeam.brand.shortName || activeTeam.brand.name} · Family Hub</span>
          </div>
          <p className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark mt-0.5">
            Guardian view · Meet schedule, 1-tap attendance RSVPs &amp; latest timed splits
          </p>
        </div>

        <Suspense fallback={null}>
          <TeamCalendarSubscribeButton
            teamId={activeTeam.brand.teamId}
            isDemoMode={isDemoTeam}
            canRotate={false}
            compact
            label="Subscribe Calendar"
            testId="family-calendar-subscribe-btn"
          />
        </Suspense>
      </div>

      {linkedChildren.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
            Student-Athlete:
          </span>
          {linkedChildren.map((child) => (
            <button
              key={child.membershipId}
              type="button"
              onClick={() => setSelectedChildId(child.membershipId)}
              className={`min-h-[34px] px-2.5 py-1 rounded-full font-semibold cursor-pointer ${
                activeChild?.membershipId === child.membershipId
                  ? 'ap-nav-volt-active'
                  : 'ap-card-inset text-ap-ink dark:text-ap-chalk'
              }`}
            >
              {child.invitedName}
            </button>
          ))}
        </div>
      )}

      {feedback && (
        <div
          role="status"
          data-testid="family-rsvp-feedback"
          className="rounded-xl ap-status-prime px-3 py-1.5 text-2xs font-semibold flex items-center gap-1.5"
        >
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Upcoming Team Events & 1-Tap RSVP */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-ap-ink dark:text-ap-chalk">
          <Calendar className="w-3.5 h-3.5 text-ap-cobalt dark:text-ap-volt" />
          <span>Upcoming Events &amp; Availability RSVP</span>
        </div>

        {upcomingEvents.length === 0 ? (
          <p className="text-2xs text-ap-muted dark:text-ap-muted-dark">
            No upcoming meets or bus events posted yet.
          </p>
        ) : (
          <div className="space-y-2.5">
            {upcomingEvents.map((ev) => {
              const memberKey = `${ev.eventId}::${activeChild?.membershipId || activeTeam.myMembershipId}`;
              const currentRsvp = rsvpByEventAndMember.get(memberKey);
              const safeLiveUrl =
                ev.liveResultsUrl && /^https:\/\//i.test(ev.liveResultsUrl.trim())
                  ? ev.liveResultsUrl.trim()
                  : null;
              return (
                <div
                  key={ev.eventId}
                  data-testid={`family-event-row-${ev.eventId}`}
                  className="rounded-xl ap-card-inset p-3 space-y-2 text-xs"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-ap-ink dark:text-ap-chalk flex flex-wrap items-center gap-1.5">
                        <span>{ev.title}</span>
                        {typeof ev.meetDelayMinutes === 'number' && ev.meetDelayMinutes > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-800 dark:text-amber-300 font-mono text-2xs font-bold">
                            +{ev.meetDelayMinutes}m Delay
                          </span>
                        )}
                      </div>
                      <div className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark flex flex-wrap items-center gap-2 mt-0.5">
                        <span>
                          {ev.date}
                          {ev.startTime
                            ? ` · ${formatPracticeTime12h(ev.startTime) || ev.startTime}`
                            : ''}
                        </span>
                        {ev.busDepartureTime && (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Bus {formatPracticeTime12h(ev.busDepartureTime) || ev.busDepartureTime}
                          </span>
                        )}
                        {ev.locationName && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {ev.locationName}
                          </span>
                        )}
                      </div>
                    </div>

                    {safeLiveUrl && (
                      <a
                        href={safeLiveUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-ap-cobalt/10 dark:bg-ap-volt/15 text-ap-cobalt dark:text-ap-volt font-mono text-2xs font-bold hover:underline"
                      >
                        <span>{ev.liveResultsLabel || 'Live Results'}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>

                  {Array.isArray(ev.curatedAlbumLinks) &&
                    ev.curatedAlbumLinks.some((a) => /^https:\/\//i.test(a.url.trim())) && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {ev.curatedAlbumLinks
                          .filter((a) => /^https:\/\//i.test(a.url.trim()))
                          .map((album) => (
                            <a
                              key={album.id}
                              data-testid={`family-event-album-link-${ev.eventId}`}
                              href={album.url.trim()}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white/80 dark:bg-ap-carbon border border-ap-frame/20 dark:border-ap-edge-dark text-ap-cobalt dark:text-ap-volt font-mono text-2xs font-bold hover:underline"
                            >
                              <span>{album.label || 'Meet Photos'}</span>
                              <ExternalLink className="w-3 h-3 shrink-0" />
                            </a>
                          ))}
                      </div>
                    )}

                  <div className="flex flex-wrap items-center gap-1.5">
                    {RSVP_BUTTONS.map((btn) => {
                      const active = currentRsvp?.status === btn.status;
                      return (
                        <button
                          key={btn.status}
                          type="button"
                          disabled={loading || savingRsvp}
                          data-testid={`family-rsvp-${ev.eventId}-${btn.status.toLowerCase()}`}
                          aria-pressed={active}
                          onClick={() =>
                            void handleRsvp(ev.eventId, btn.status, currentRsvp?.travelMode)
                          }
                          className={`min-h-[34px] px-2.5 py-1 rounded-lg font-mono text-2xs font-bold cursor-pointer transition-colors ${
                            active
                              ? btn.status === 'GOING'
                                ? 'bg-emerald-600 text-white'
                                : btn.status === 'OUT' || btn.status === 'MEET_CONFLICT'
                                  ? 'bg-rose-600 text-white'
                                  : 'bg-amber-500 text-ap-obsidian'
                              : 'bg-white dark:bg-ap-carbon border border-stone-200 dark:border-ap-edge text-ap-ink dark:text-ap-chalk'
                          }`}
                        >
                          {btn.label}
                        </button>
                      );
                    })}

                    {(ev.eventType === 'MEET' || ev.eventType === 'BUS_TRAVEL') && (
                      <select
                        aria-label={`Travel mode for ${ev.title}`}
                        data-testid={`family-travel-${ev.eventId}`}
                        value={currentRsvp?.travelMode || 'TEAM_BUS'}
                        onChange={(e) =>
                          void handleRsvp(
                            ev.eventId,
                            currentRsvp?.status || 'GOING',
                            e.target.value as TeamEventTravelMode
                          )
                        }
                        className="min-h-[34px] rounded-lg border border-stone-200 dark:border-ap-edge bg-white dark:bg-ap-carbon px-2 font-mono text-2xs"
                      >
                        {TRAVEL_MODES.map((m) => (
                          <option key={m.mode} value={m.mode}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    )}

                    <input
                      type="text"
                      maxLength={100}
                      value={noteDraftByEvent[ev.eventId] ?? currentRsvp?.note ?? ''}
                      onChange={(e) =>
                        setNoteDraftByEvent((prev) => ({ ...prev, [ev.eventId]: e.target.value }))
                      }
                      placeholder="Travel / arrival note..."
                      aria-label={`Note for ${ev.title}`}
                      className="flex-1 min-w-[130px] min-h-[34px] rounded-lg border border-stone-200 dark:border-ap-edge bg-white dark:bg-ap-carbon px-2 text-2xs"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Linked Child Meet-Day Schedule */}
      {upcomingMeetSchedule.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-ap-frame/15 dark:border-ap-edge-dark">
          <div className="flex items-center gap-1.5 text-xs font-bold text-ap-ink dark:text-ap-chalk">
            <Trophy className="w-3.5 h-3.5 text-amber-500" />
            <span>{activeChild?.invitedName || 'Student-Athlete'} Meet-Day Assignments</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {upcomingMeetSchedule.map((item, idx) => (
              <div
                key={`${item.packetId}-${item.eventCode}-${idx}`}
                className="rounded-xl bg-white/80 dark:bg-ap-carbon border border-ap-frame/15 dark:border-ap-edge px-3 py-2 text-xs font-mono"
              >
                <div className="font-bold text-ap-ink dark:text-ap-chalk">
                  {item.eventCode} · {item.meetTitle}
                </div>
                <div className="text-2xs text-ap-muted dark:text-ap-muted-dark mt-0.5">
                  {item.meetDate}
                  {item.eventStartTime ? ` · ${item.eventStartTime}` : ''}
                  {typeof item.officialHeat === 'number' ? ` · Heat ${item.officialHeat}` : ''}
                  {item.officialLaneOrHip ? ` · Lane/Hip ${item.officialLaneOrHip}` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Latest Timed Splits & Marks */}
      {childLatestSplits.length > 0 && (
        <div
          data-testid="family-latest-splits-list"
          className="space-y-1.5 pt-2 border-t border-ap-frame/15 dark:border-ap-edge-dark"
        >
          <div className="flex items-center gap-1.5 text-xs font-bold text-ap-ink dark:text-ap-chalk">
            <Timer className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
            <span>Latest Timed Splits &amp; Marks</span>
          </div>
          <div className="space-y-1.5">
            {childLatestSplits.map((act) => {
              const meta = act.officialRaceData!;
              const handTimed = isHandTimedRaceData(meta, act);
              return (
                <div
                  key={act.id}
                  className="rounded-xl bg-white/80 dark:bg-ap-carbon border border-ap-frame/15 dark:border-ap-edge px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-bold truncate">
                      {meta.eventLabel} · {meta.meetName}
                    </div>
                    <div className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                      {act.startDateLocal.slice(0, 10)}
                      {meta.lapSplitsSecs.length > 0
                        ? ` · Splits: ${meta.lapSplitsSecs.map((s) => `${s.toFixed(1)}s`).join(', ')}`
                        : ''}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded font-mono text-2xs font-bold shrink-0 ${
                      handTimed
                        ? 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-300'
                        : 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                    }`}
                  >
                    {formatRaceTimingBadgeLabel(meta, act)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};

export default FamilyMeetHubCard;
