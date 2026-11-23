import React, { Suspense, useMemo, useState } from 'react';
import {
  Calendar,
  ExternalLink,
  Plus,
  Trash2,
  X,
} from '../icons/PhosphorIcons';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { formatPracticeTime12h } from '../../utils/workoutScheduleUtils';
import type { SaveTeamEventInput } from '../../utils/teamEventsApi';
import type {
  CuratedMeetAlbumLink,
  TeamEventRecord,
  TeamEventRsvpCounts,
  TeamEventType,
  TeamEventVisibilityScope,
} from '../../types';

const TeamCalendarSubscribeButton = lazyWithRetry(
  () =>
    import('../calendar/TeamCalendarSubscribeButton').then((m) => ({
      default: m.TeamCalendarSubscribeButton,
    })),
  { chunkKey: 'TeamCalendarSubscribeButton', restoreTab: 'coach' }
);

export interface CoachTeamEventsBarProps {
  teamId?: string | null;
  isDemoMode?: boolean;
  events: TeamEventRecord[];
  rsvpCountsByEventId: Record<string, TeamEventRsvpCounts>;
  isSaving?: boolean;
  onSaveEvent: (input: SaveTeamEventInput) => Promise<void>;
  onDeleteEvent: (eventId: string) => Promise<void>;
}

export const CoachTeamEventsBar: React.FC<CoachTeamEventsBarProps> = ({
  teamId,
  isDemoMode = false,
  events,
  rsvpCountsByEventId,
  isSaving = false,
  onSaveEvent,
  onDeleteEvent,
}) => {
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [eventType, setEventType] = useState<TeamEventType>('MEET');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('15:30');
  const [endTime, setEndTime] = useState('18:30');
  const [locationName, setLocationName] = useState('');
  const [busDepartureTime, setBusDepartureTime] = useState('');
  const [meetDelayMinutes, setMeetDelayMinutes] = useState('0');
  const [liveResultsUrl, setLiveResultsUrl] = useState('');
  const [liveResultsLabel, setLiveResultsLabel] = useState('');
  const [visibilityScope, setVisibilityScope] =
    useState<TeamEventVisibilityScope>('PUBLIC_HUB');
  const [albumLabel, setAlbumLabel] = useState('');
  const [albumUrl, setAlbumUrl] = useState('');
  const [albumVisibility, setAlbumVisibility] = useState<
    'TEAM_AND_FAMILIES_ONLY' | 'PUBLIC_HUB'
  >('TEAM_AND_FAMILIES_ONLY');
  const [errorText, setErrorText] = useState<string | null>(null);

  const visibleEvents = useMemo(
    () => [...events].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6),
    [events]
  );

  const openNewComposer = () => {
    setEditingId(undefined);
    setTitle('');
    setEventType('MEET');
    setDate(new Date().toISOString().slice(0, 10));
    setStartTime('15:30');
    setEndTime('18:30');
    setLocationName('');
    setBusDepartureTime('');
    setMeetDelayMinutes('0');
    setLiveResultsUrl('');
    setLiveResultsLabel('');
    setVisibilityScope('PUBLIC_HUB');
    setAlbumLabel('');
    setAlbumUrl('');
    setAlbumVisibility('TEAM_AND_FAMILIES_ONLY');
    setErrorText(null);
    setComposerOpen(true);
  };

  const openEditComposer = (ev: TeamEventRecord) => {
    setEditingId(ev.eventId);
    setTitle(ev.title);
    setEventType(ev.eventType);
    setDate(ev.date);
    setStartTime(ev.startTime || '');
    setEndTime(ev.endTime || '');
    setLocationName(ev.locationName || '');
    setBusDepartureTime(ev.busDepartureTime || '');
    setMeetDelayMinutes(String(ev.meetDelayMinutes || 0));
    setLiveResultsUrl(ev.liveResultsUrl || '');
    setLiveResultsLabel(ev.liveResultsLabel || '');
    setVisibilityScope(ev.visibilityScope);
    const firstAlbum = ev.curatedAlbumLinks?.[0];
    setAlbumLabel(firstAlbum?.label || '');
    setAlbumUrl(firstAlbum?.url || '');
    setAlbumVisibility(firstAlbum?.visibility || 'TEAM_AND_FAMILIES_ONLY');
    setErrorText(null);
    setComposerOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setErrorText('Event title and YYYY-MM-DD date are required.');
      return;
    }
    const curatedAlbumLinks: CuratedMeetAlbumLink[] | undefined =
      albumUrl.trim() && /^https:\/\//i.test(albumUrl.trim())
        ? [
            {
              id: `alb_${Date.now().toString(36)}`,
              label: albumLabel.trim() || 'Meet Photos',
              url: albumUrl.trim(),
              visibility: albumVisibility,
              addedAt: new Date().toISOString(),
            },
          ]
        : undefined;

    try {
      setErrorText(null);
      await onSaveEvent({
        ...(editingId ? { eventId: editingId } : {}),
        title: title.trim(),
        eventType,
        date,
        ...(startTime.trim() ? { startTime: startTime.trim() } : {}),
        ...(endTime.trim() ? { endTime: endTime.trim() } : {}),
        ...(locationName.trim() ? { locationName: locationName.trim() } : {}),
        ...(busDepartureTime.trim() ? { busDepartureTime: busDepartureTime.trim() } : {}),
        meetDelayMinutes: Math.max(0, Number(meetDelayMinutes) || 0),
        ...(liveResultsUrl.trim() ? { liveResultsUrl: liveResultsUrl.trim() } : {}),
        ...(liveResultsLabel.trim() ? { liveResultsLabel: liveResultsLabel.trim() } : {}),
        visibilityScope,
        ...(curatedAlbumLinks ? { curatedAlbumLinks } : {}),
      });
      setComposerOpen(false);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Unable to save event.');
    }
  };

  return (
    <section
      data-testid="coach-team-events-bar"
      className="rounded-2xl liquid-glass px-3.5 py-3 space-y-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-extrabold text-ap-ink dark:text-ap-chalk">
          <Calendar className="w-4 h-4 text-ap-cobalt dark:text-ap-volt shrink-0" />
          <span>Team Events &amp; RSVP Logistics ({events.length})</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Suspense fallback={null}>
            <TeamCalendarSubscribeButton
              teamId={teamId}
              isDemoMode={isDemoMode}
              canRotate
              compact
              label="Feed"
              testId="coach-events-calendar-subscribe-btn"
            />
          </Suspense>
          <button
            type="button"
            data-testid="coach-add-team-event-btn"
            onClick={openNewComposer}
            className="ap-btn-primary !min-h-[36px] px-3 py-1 text-2xs font-bold inline-flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Event</span>
          </button>
        </div>
      </div>

      {visibleEvents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {visibleEvents.map((ev) => {
            const counts = rsvpCountsByEventId[ev.eventId] || {
              going: 0,
              out: 0,
              late: 0,
              conflict: 0,
              undecided: 0,
            };
            const safeLiveUrl =
              ev.liveResultsUrl && /^https:\/\//i.test(ev.liveResultsUrl.trim())
                ? ev.liveResultsUrl.trim()
                : null;
            return (
              <div
                key={ev.eventId}
                data-testid={`coach-event-chip-${ev.eventId}`}
                className="rounded-xl ap-card-inset p-2.5 text-xs space-y-1.5"
              >
                <div className="flex items-start justify-between gap-1.5">
                  <button
                    type="button"
                    onClick={() => openEditComposer(ev)}
                    className="text-left min-w-0 flex-1 cursor-pointer hover:underline"
                  >
                    <div className="font-bold text-ap-ink dark:text-ap-chalk truncate">
                      {ev.title}
                    </div>
                    <div className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark truncate">
                      {ev.date}
                      {ev.startTime ? ` · ${formatPracticeTime12h(ev.startTime)}` : ''}
                      {ev.busDepartureTime
                        ? ` · Bus ${formatPracticeTime12h(ev.busDepartureTime)}`
                        : ''}
                    </div>
                  </button>
                  {safeLiveUrl && (
                    <a
                      href={safeLiveUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open live results for ${ev.title}`}
                      className="text-ap-cobalt dark:text-ap-volt shrink-0"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 font-mono text-2xs">
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 font-bold">
                    {counts.going} Going
                  </span>
                  {counts.late > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-800 dark:text-amber-300 font-bold">
                      {counts.late} Late
                    </span>
                  )}
                  {(counts.out > 0 || counts.conflict > 0) && (
                    <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-800 dark:text-rose-300 font-bold">
                      {counts.out + counts.conflict} Out/Conflict
                    </span>
                  )}
                  {typeof ev.meetDelayMinutes === 'number' && ev.meetDelayMinutes > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-800 dark:text-amber-200 font-bold">
                      +{ev.meetDelayMinutes}m Delay
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {composerOpen && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          data-testid="coach-team-event-composer"
          className="rounded-xl border border-stone-200 dark:border-ap-edge bg-white dark:bg-ap-obsidian p-3.5 space-y-3 text-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-ap-ink dark:text-ap-chalk">
              {editingId ? 'Edit Team Event' : 'Create Team Event'}
            </span>
            <div className="flex items-center gap-1.5">
              {editingId && (
                <button
                  type="button"
                  onClick={() => {
                    void onDeleteEvent(editingId);
                    setComposerOpen(false);
                  }}
                  className="min-h-[32px] px-2 rounded-lg text-rose-600 dark:text-rose-400 inline-flex items-center gap-1 text-2xs font-semibold cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              )}
              <button
                type="button"
                aria-label="Close event form"
                onClick={() => setComposerOpen(false)}
                className="min-h-[32px] min-w-[32px] rounded-lg ap-card-inset inline-flex items-center justify-center cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {errorText && (
            <div role="alert" className="rounded-lg px-2.5 py-1.5 text-2xs font-semibold ap-status-caution">
              {errorText}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              required
              data-testid="coach-event-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title (e.g. League Finals #2)"
              className="sm:col-span-2 min-h-[36px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-stone-50 dark:bg-ap-carbon px-2.5"
            />
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value as TeamEventType)}
              className="min-h-[36px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-stone-50 dark:bg-ap-carbon px-2 font-mono"
            >
              <option value="MEET">Meet</option>
              <option value="PRACTICE">Practice</option>
              <option value="BUS_TRAVEL">Bus Travel</option>
              <option value="TEAM_MEETING">Team Meeting</option>
            </select>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <input
              type="date"
              required
              data-testid="coach-event-date-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="min-h-[36px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-stone-50 dark:bg-ap-carbon px-2 font-mono"
            />
            <input
              type="text"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              placeholder="Start (15:30)"
              className="min-h-[36px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-stone-50 dark:bg-ap-carbon px-2 font-mono"
            />
            <input
              type="text"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              placeholder="End (18:30)"
              className="min-h-[36px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-stone-50 dark:bg-ap-carbon px-2 font-mono"
            />
            <input
              type="text"
              value={busDepartureTime}
              onChange={(e) => setBusDepartureTime(e.target.value)}
              placeholder="Bus time (14:00)"
              className="min-h-[36px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-stone-50 dark:bg-ap-carbon px-2 font-mono"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
              placeholder="Venue / Stadium"
              className="min-h-[36px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-stone-50 dark:bg-ap-carbon px-2.5"
            />
            <input
              type="url"
              value={liveResultsUrl}
              onChange={(e) => setLiveResultsUrl(e.target.value)}
              placeholder="https://live.athletic.net/..."
              className="min-h-[36px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-stone-50 dark:bg-ap-carbon px-2.5 font-mono"
            />
            <select
              value={visibilityScope}
              onChange={(e) => setVisibilityScope(e.target.value as TeamEventVisibilityScope)}
              className="min-h-[36px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-stone-50 dark:bg-ap-carbon px-2 font-mono"
            >
              <option value="PUBLIC_HUB">Public Hub + Team</option>
              <option value="TEAM_AND_FAMILIES_ONLY">Team &amp; Families Only</option>
              <option value="STAFF_ONLY">Staff Only</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <input
              type="number"
              min={0}
              max={240}
              value={meetDelayMinutes}
              onChange={(e) => setMeetDelayMinutes(e.target.value)}
              placeholder="Delay mins"
              aria-label="Meet delay minutes"
              className="min-h-[36px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-stone-50 dark:bg-ap-carbon px-2 font-mono"
            />
            <input
              type="text"
              value={albumLabel}
              onChange={(e) => setAlbumLabel(e.target.value)}
              placeholder="Photo album label"
              className="min-h-[36px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-stone-50 dark:bg-ap-carbon px-2"
            />
            <input
              type="url"
              value={albumUrl}
              onChange={(e) => setAlbumUrl(e.target.value)}
              placeholder="https://photos.app.goo.gl/..."
              className="min-h-[36px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-stone-50 dark:bg-ap-carbon px-2 font-mono"
            />
            <select
              value={albumVisibility}
              onChange={(e) =>
                setAlbumVisibility(e.target.value as 'TEAM_AND_FAMILIES_ONLY' | 'PUBLIC_HUB')
              }
              className="min-h-[36px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-stone-50 dark:bg-ap-carbon px-2 font-mono"
            >
              <option value="TEAM_AND_FAMILIES_ONLY">Album: Team &amp; Families</option>
              <option value="PUBLIC_HUB">Album: Public Hub</option>
            </select>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="submit"
              disabled={isSaving}
              data-testid="coach-save-team-event-btn"
              className="ap-btn-primary !min-h-[36px] px-4 py-1.5 text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : 'Save Team Event'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
};

export default CoachTeamEventsBar;
