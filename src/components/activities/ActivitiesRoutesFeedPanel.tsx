import React, { Suspense, useState } from 'react';
import {
  ExternalLink,
  MapPin,
  MessageSquare,
  Send,
  ThumbsUp,
  Trophy,
} from '../icons/PhosphorIcons';
import type { DistanceUnit, UnifiedActivity } from '../../types';
import {
  formatDistance,
  formatDuration,
  formatMultiSportPace,
  formatStopwatch,
} from '../../utils/formatters';
import { WorkspaceErrorBoundary } from '../WorkspaceErrorBoundary';
import { InteractiveRouteMap } from './activityLazyViews';

export interface ActivitiesRoutesFeedPanelProps {
  activities: UnifiedActivity[];
  filteredActivities: UnifiedActivity[];
  distanceUnit: DistanceUnit;
  isHydratingRoutes: boolean;
  onHydrateMoreRoutes?: () => Promise<void>;
  onSelectActivity: (activity: UnifiedActivity) => void;
  onToggleKudos?: (activity: UnifiedActivity) => Promise<void>;
  onAddComment?: (activity: UnifiedActivity, commentText: string) => Promise<void>;
}

export const ActivitiesRoutesFeedPanel: React.FC<ActivitiesRoutesFeedPanelProps> = ({
  activities,
  filteredActivities,
  distanceUnit,
  isHydratingRoutes,
  onHydrateMoreRoutes,
  onSelectActivity,
  onToggleKudos,
  onAddComment,
}) => {
  const [kudosFeedFilter, setKudosFeedFilter] = useState<
    'ALL' | 'WITH_KUDOS' | 'PR_HUNTS' | 'WITH_GPS'
  >('ALL');
  const [hoveredRouteActivityId, setHoveredRouteActivityId] = useState<string | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  const handleRouteMapSelectActivity = (act: UnifiedActivity) => {
    onSelectActivity(act);
  };

  return (
        <section className="rounded-2xl liquid-glass p-5 space-y-5">
          {(() => {
            const totalKudosEarned = filteredActivities.reduce(
              (acc, a) => acc + (a.kudosCount || 0),
              0
            );
            const totalPrAchievements = filteredActivities.reduce(
              (acc, a) => acc + (a.stravaPrCount || 0),
              0
            );
            const mappedActivitiesCount = filteredActivities.filter(
              (a) =>
                (Array.isArray(a.routeLatLngs) && a.routeLatLngs.length > 2) ||
                (a.streams?.latlng && a.streams.latlng.length > 2)
            ).length;

            const feedActivities = filteredActivities
              .filter((act) => {
                if (kudosFeedFilter === 'WITH_KUDOS') {
                  return (act.kudosCount || 0) > 0 || Boolean(act.hasKudoed);
                }
                if (kudosFeedFilter === 'PR_HUNTS') {
                  return (
                    (act.stravaPrCount || 0) > 0 ||
                    Boolean(
                      act.segmentEfforts &&
                        act.segmentEfforts.some(
                          (e) => e.prRank === 1 || e.prRank === 2 || e.prRank === 3
                        )
                    )
                  );
                }
                if (kudosFeedFilter === 'WITH_GPS') {
                  return (
                    (Array.isArray(act.routeLatLngs) && act.routeLatLngs.length > 2) ||
                    Boolean(act.streams?.latlng && act.streams.latlng.length > 2) ||
                    act.environment === 'OUTDOOR'
                  );
                }
                return true;
              })
              .slice(0, 18);

            return (
              <>
                {/* Top Header & Kudos Rollup Strip */}
                <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-200 dark:border-slate-800">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-[#C23800] text-white">
                        <ThumbsUp className="w-3.5 h-3.5" />
                      </span>
                      <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                        Strava Kudos Feed &amp; Interactive GPS Route Map Explorer
                      </h2>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Explore outdoor GPS tracks on the interactive map, inspect Strava Kudos &amp; segment PR crowns, give kudos, or click any route to launch the full telemetry &amp; route scrubber
                    </p>
                  </div>

                  {/* Kudos & Route Rollup Pills + Feed Filter */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center gap-3 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-mono">
                      <span className="inline-flex items-center gap-1 ap-text-strava font-bold">
                        <ThumbsUp className="w-3.5 h-3.5" />
                        <span>{totalKudosEarned.toLocaleString()} Kudos</span>
                      </span>
                      <span className="text-slate-300 dark:text-slate-700">|</span>
                      <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-bold">
                        <Trophy className="w-3.5 h-3.5" />
                        <span>{totalPrAchievements.toLocaleString()} PRs</span>
                      </span>
                      <span className="text-slate-300 dark:text-slate-700">|</span>
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-bold">
                        <MapPin className="w-3.5 h-3.5" />
                        <span>{mappedActivitiesCount} GPS Routes</span>
                      </span>
                    </div>

                    <select
                      value={kudosFeedFilter}
                      aria-label="Filter Strava route and kudos feed"
                      onChange={(e) =>
                        setKudosFeedFilter(
                          e.target.value as 'ALL' | 'WITH_KUDOS' | 'PR_HUNTS' | 'WITH_GPS'
                        )
                      }
                      className="min-h-[44px] sm:min-h-[34px] rounded-xl liquid-glass-subtle px-3 py-1 text-xs font-semibold text-slate-900 dark:text-slate-100 cursor-pointer"
                    >
                      <option value="ALL">All Recent</option>
                      <option value="WITH_KUDOS">Most Kudoed</option>
                      <option value="PR_HUNTS">Segment PRs</option>
                      <option value="WITH_GPS">Outdoor GPS</option>
                    </select>
                  </div>
                </div>

                {/* 12-Column Split: Left 7 Cols Interactive Multi-Route Map, Right 5 Cols Strava Kudos Feed */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                  {/* Left 7 Columns: Interactive Multi-Workout GPS Route Map */}
                  <div className="lg:col-span-7 space-y-2">
                    <WorkspaceErrorBoundary fallbackTitle="Route Map" restoreTab="activities">
                      <Suspense
                        fallback={
                          <div className="h-[460px] sm:h-[540px] rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                            Loading Route Map…
                          </div>
                        }
                      >
                        <InteractiveRouteMap
                          mode="MULTI"
                          activities={filteredActivities}
                          distanceUnit={distanceUnit}
                          highlightedActivityId={hoveredRouteActivityId}
                          onHoverActivity={setHoveredRouteActivityId}
                          onSelectActivity={handleRouteMapSelectActivity}
                          heightClass="h-[460px] sm:h-[540px]"
                        />
                      </Suspense>
                    </WorkspaceErrorBoundary>
                    {onHydrateMoreRoutes && (
                      <div className="flex items-center justify-between gap-2 px-1">
                        <span className="text-xs text-slate-500">
                          Want more historical outdoor routes plotted on the map?
                        </span>
                        <button
                          type="button"
                          onClick={onHydrateMoreRoutes}
                          disabled={isHydratingRoutes}
                          className="min-h-[30px] px-3 py-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50 text-xs font-semibold text-emerald-700 dark:text-emerald-300 transition-colors whitespace-nowrap"
                        >
                          {isHydratingRoutes
                            ? 'Loading +40 GPS Tracks...'
                            : 'Load +40 More Historical GPS Routes'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Right 5 Columns: Strava Kudos & Activity Social Feed */}
                  <div className="lg:col-span-5 space-y-3 max-h-[580px] overflow-y-auto pr-1">
                    {feedActivities.length === 0 ? (
                      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center text-xs text-slate-500">
                        No workouts match the selected Kudos Feed filter. Switch back to &quot;All Recent&quot; to browse all workouts.
                      </div>
                    ) : (
                      feedActivities.map((act) => {
                        const hasGps =
                          (Array.isArray(act.routeLatLngs) && act.routeLatLngs.length > 2) ||
                          Boolean(act.streams?.latlng && act.streams.latlng.length > 2);
                        const isHovered = hoveredRouteActivityId === act.id;
                        const kudoers = act.kudoers || [];
                        const comments = act.comments || [];
                        const kudosTotal = Math.max(act.kudosCount || 0, kudoers.length);
                        const topSegments = (act.segmentEfforts || []).slice(0, 3);
                        const commentDraft = commentDrafts[act.id] || '';

                        return (
                          <div
                            key={act.id}
                            onMouseEnter={() => setHoveredRouteActivityId(act.id)}
                            onMouseLeave={() =>
                              setHoveredRouteActivityId((curr) => (curr === act.id ? null : curr))
                            }
                            className={`rounded-xl border p-4 space-y-3 transition-all ${
                              isHovered
                                ? 'border-[#FC4C02] bg-[#FC4C02]/5 shadow-md'
                                : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                          >
                            {/* Card Header: Sport Badge, Workout Name, Date, Strava External Link */}
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5 text-2xs font-mono text-slate-500">
                                  <span
                                    className={`px-1.5 py-0.5 rounded font-sans font-bold text-2xs uppercase ${
                                      act.sportCategory === 'Running'
                                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                        : act.sportCategory === 'Cycling'
                                          ? 'bg-[#C23800]/12 dark:bg-[#FC4C02]/15 ap-text-strava'
                                          : 'bg-teal-500/15 text-teal-700 dark:text-teal-300'
                                    }`}
                                  >
                                    {act.sportCategory}
                                  </span>
                                  <span>{act.startDateLocal.slice(0, 10)}</span>
                                  <span>·</span>
                                  <span>{act.gearName || act.subType}</span>
                                  {hasGps && (
                                    <span className="inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400 font-semibold">
                                      <MapPin className="w-3 h-3" />
                                      GPS
                                    </span>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => onSelectActivity(act)}
                                  className="text-left text-sm font-bold text-slate-900 dark:text-slate-100 hover:text-[#B83500] dark:hover:text-[#FF7A45] transition-colors mt-0.5 line-clamp-1"
                                >
                                  {act.name}
                                </button>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {act.stravaId && (
                                  <a
                                    href={`https://www.strava.com/activities/${encodeURIComponent(
                                      act.stravaId
                                    )}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#C23800]/35 dark:border-[#FC4C02]/40 bg-[#C23800]/10 dark:bg-[#FC4C02]/10 hover:bg-[#C23800]/20 dark:hover:bg-[#FC4C02]/20 text-2xs font-semibold ap-text-strava transition-colors whitespace-nowrap"
                                    title="Open activity on Strava.com"
                                  >
                                    <span>Strava</span>
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                                <button
                                  type="button"
                                  onClick={() => onSelectActivity(act)}
                                  className="px-2.5 py-1 rounded-md bg-ap-cobalt hover:bg-[#16422A] dark:bg-ap-volt dark:hover:bg-[#B5EB00] text-white dark:text-ap-obsidian text-2xs font-semibold transition-colors whitespace-nowrap"
                                >
                                  Inspect Map &amp; Streams
                                </button>
                              </div>
                            </div>

                            {/* Key Workout Telemetry Strip */}
                            <div className="grid grid-cols-4 gap-2 text-xs font-mono tabular-nums bg-white dark:bg-ap-turf rounded-lg p-2.5 border border-slate-200/80 dark:border-slate-800">
                              <div>
                                <div className="text-2xs font-sans text-slate-500">Distance</div>
                                <div className="font-bold text-slate-900 dark:text-slate-100">
                                  {act.distanceMeters > 0
                                    ? formatDistance(act.distanceMeters, distanceUnit, 1)
                                    : 'Indoor'}
                                </div>
                              </div>
                              <div>
                                <div className="text-2xs font-sans text-slate-500">Duration</div>
                                <div className="font-bold text-slate-900 dark:text-slate-100">
                                  {formatDuration(act.movingTimeSecs)}
                                </div>
                              </div>
                              <div>
                                <div className="text-2xs font-sans text-slate-500">
                                  {act.sportCategory === 'Running' ||
                                  act.sportCategory === 'Swimming' ||
                                  (act.sportCategory === 'Multisport' && Boolean(act.avgPaceSecsPerKm))
                                    ? 'Avg Pace'
                                    : 'NP / Watts'}
                                </div>
                                <div className="font-bold text-blue-600 dark:text-blue-400">
                                  {(act.sportCategory === 'Running' ||
                                    act.sportCategory === 'Swimming' ||
                                    act.sportCategory === 'Multisport') &&
                                  act.avgPaceSecsPerKm
                                    ? formatMultiSportPace(
                                        act.avgPaceSecsPerKm,
                                        distanceUnit,
                                        act.sportCategory,
                                        act.subType
                                      )
                                    : act.normalizedPower
                                      ? `${act.normalizedPower}W`
                                      : act.avgPower
                                        ? `${act.avgPower}W`
                                        : `${act.trainingLoad} TSS`}
                                </div>
                              </div>
                              <div>
                                <div className="text-2xs font-sans text-slate-500">
                                  Elev / HR
                                </div>
                                <div className="font-bold text-slate-900 dark:text-slate-100">
                                  +{distanceUnit === 'mi' ? `${Math.round(act.elevationGainMeters * 3.28084).toLocaleString()}ft` : `${act.elevationGainMeters}m`}
                                  {act.avgHr > 0 ? ` · ${act.avgHr}bpm` : ''}
                                </div>
                              </div>
                            </div>

                            {/* Strava Segment PR Trophy Case (if segments or PRs exist) */}
                            {(act.stravaPrCount > 0 || topSegments.length > 0) && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                {act.stravaPrCount > 0 && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-2xs font-bold">
                                    <Trophy className="w-3 h-3" />
                                    {act.stravaPrCount} Strava PR{act.stravaPrCount > 1 ? 's' : ''}
                                  </span>
                                )}
                                {topSegments.map((seg, segIdx) => (
                                  <button
                                    key={`${seg.id}-${seg.segmentId}-${segIdx}`}
                                    type="button"
                                    onClick={() => onSelectActivity(act)}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md liquid-glass-subtle hover:bg-emerald-950/8 dark:hover:bg-emerald-400/12 text-2xs font-mono text-emerald-950 dark:text-emerald-100 transition-colors"
                                  >
                                    {seg.prRank === 1 && (
                                      <Trophy className="w-3 h-3 text-amber-500 shrink-0" />
                                    )}
                                    <span className="truncate max-w-[130px] font-sans font-medium">
                                      {seg.name}
                                    </span>
                                    <span className="text-slate-500">
                                      {formatStopwatch(seg.elapsedTimeSecs)}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* Kudos Action Bar & Kudoer Avatar Pills */}
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/80 dark:border-slate-800">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => onToggleKudos && onToggleKudos(act)}
                                  className={`min-h-[30px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                                    act.hasKudoed
                                      ? 'bg-[#C23800] text-white shadow-xs'
                                      : 'border border-[#C23800]/35 dark:border-[#FC4C02]/40 bg-[#C23800]/10 dark:bg-[#FC4C02]/10 ap-text-strava hover:bg-[#C23800]/20 dark:hover:bg-[#FC4C02]/20'
                                  }`}
                                >
                                  <ThumbsUp className="w-3.5 h-3.5" />
                                  <span>
                                    {act.hasKudoed ? 'Kudoed' : 'Give Kudos'} ({kudosTotal})
                                  </span>
                                </button>

                                {/* Kudoer Avatar Initials Pills */}
                                {kudoers.slice(0, 4).map((k, kIdx) => {
                                  const dispName =
                                    k.name ||
                                    `${k.firstname || ''} ${k.lastname || ''}`.trim() ||
                                    'Athlete';
                                  const dispInitials =
                                    k.avatarInitials ||
                                    dispName
                                      .split(' ')
                                      .map((p) => p[0] || '')
                                      .join('')
                                      .slice(0, 2)
                                      .toUpperCase();
                                  const dispLoc =
                                    k.location || [k.city, k.state].filter(Boolean).join(', ');
                                  return (
                                    <span
                                      key={k.id || `${dispName}-${kIdx}`}
                                      title={`${dispName}${dispLoc ? ` (${dispLoc})` : ''}`}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-200/70 dark:bg-slate-800 text-2xs font-medium text-slate-700 dark:text-slate-300"
                                    >
                                      <span className="w-4 h-4 rounded-full bg-[#C23800]/15 dark:bg-[#FC4C02]/20 ap-text-strava font-mono text-2xs font-bold flex items-center justify-center">
                                        {dispInitials}
                                      </span>
                                      <span className="truncate max-w-[90px]">{dispName}</span>
                                    </span>
                                  );
                                })}
                              </div>

                              <span className="inline-flex items-center gap-1 text-2xs font-mono text-slate-500">
                                <MessageSquare className="w-3 h-3" />
                                {comments.length} {comments.length === 1 ? 'note' : 'notes'}
                              </span>
                            </div>

                            {/* Activity Comments / Coaching Notes + Inline Quick Note Input */}
                            {comments.length > 0 && (
                              <div className="space-y-1.5 pt-1">
                                {comments.slice(-2).map((c) => (
                                  <div
                                    key={c.id}
                                    className="rounded-lg bg-white dark:bg-ap-turf border border-slate-200/70 dark:border-slate-800 px-2.5 py-1.5 text-xs"
                                  >
                                    <div className="flex items-center justify-between text-2xs text-slate-500">
                                      <span className="font-bold text-slate-800 dark:text-slate-200">
                                        {c.authorName || c.athleteName || 'Athlete'}
                                      </span>
                                      <span className="font-mono">
                                        {c.createdAt.slice(0, 10)}
                                      </span>
                                    </div>
                                    <p className="text-slate-700 dark:text-slate-300 mt-0.5">
                                      {c.text}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}

                            {onAddComment && (
                              <form
                                onSubmit={async (e) => {
                                  e.preventDefault();
                                  if (!commentDraft.trim()) return;
                                  const text = commentDraft.trim();
                                  setCommentDrafts((prev) => ({ ...prev, [act.id]: '' }));
                                  await onAddComment(act, text);
                                }}
                                className="flex items-center gap-1.5 pt-1"
                              >
                                <input
                                  type="text"
                                  value={commentDraft}
                                  aria-label={`Add workout note for ${act.name}`}
                                  onChange={(e) =>
                                    setCommentDrafts((prev) => ({
                                      ...prev,
                                      [act.id]: e.target.value,
                                    }))
                                  }
                                  placeholder="Add workout note or Strava club comment..."
                                  className="flex-1 min-h-[44px] sm:min-h-[36px] rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-ap-turf px-2.5 py-1 text-xs text-slate-900 dark:text-slate-100"
                                />
                                <button
                                  type="submit"
                                  disabled={!commentDraft.trim()}
                                  aria-label={`Post workout comment for ${act.name}`}
                                  className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-slate-800 hover:bg-[#C23800] disabled:opacity-40 text-white text-xs font-semibold transition-colors inline-flex items-center justify-center gap-1"
                                >
                                  <Send className="w-3.5 h-3.5" />
                                </button>
                              </form>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            );
          })()}
        </section>
  );
};
