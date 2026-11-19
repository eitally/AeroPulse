import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ExternalLink,
  MapPin,
  Moon,
  ShieldCheck,
  Sun,
  Trophy,
  UserPlus,
  Users,
} from './icons/PhosphorIcons';
import type { PublicTeamHubPayload, TeamSummaryWithRole } from '../types';
import { buildPresetExternalTeamSummary } from '../utils/athleticNetAndTfrrsEngine';
import { buildCleanRoomPublicHubFromTeamSummary } from '../utils/publicTeamHubRoute';
import { formatPracticeTime12h } from '../utils/workoutScheduleUtils';
import { getSavedIntervalsHeaders } from '../utils/telemetryStorage';
import { AeroPulseLogo } from './AeroPulseLogo';

export interface PublicTeamHubPageProps {
  slugOrCode: string;
  isDark: boolean;
  onToggleDark: () => void;
  localTeamsFallback?: TeamSummaryWithRole[];
  initialPayloadForTest?: PublicTeamHubPayload | null;
  onFollowedTeam?: (teams: TeamSummaryWithRole[], activeTeamId?: string) => void;
  onExitHub: () => void;
}

export const PublicTeamHubPage: React.FC<PublicTeamHubPageProps> = ({
  slugOrCode,
  isDark,
  onToggleDark,
  localTeamsFallback = [],
  initialPayloadForTest = null,
  onFollowedTeam,
  onExitHub,
}) => {
  const [payload, setPayload] = useState<PublicTeamHubPayload | null>(initialPayloadForTest);
  const [loading, setLoading] = useState<boolean>(!initialPayloadForTest);
  const [selectedSquad, setSelectedSquad] = useState<string>('ALL');
  const [followNotice, setFollowNotice] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState<boolean>(false);

  useEffect(() => {
    if (initialPayloadForTest) {
      setPayload(initialPayloadForTest);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const resolveFallback = (): PublicTeamHubPayload | null => {
      const clean = slugOrCode.trim().toLowerCase();
      const matchedLocal = localTeamsFallback.find(
        (t) =>
          t.brand.slug.toLowerCase() === clean ||
          t.brand.joinCode.toLowerCase() === clean ||
          t.brand.teamId.toLowerCase() === clean
      );
      if (matchedLocal) {
        return buildCleanRoomPublicHubFromTeamSummary(matchedLocal);
      }
      if (clean.includes('willow-glen') || clean === 'wghs-26' || clean === '1073') {
        return buildCleanRoomPublicHubFromTeamSummary(
          buildPresetExternalTeamSummary('WILLOW_GLEN', 'Coach')
        );
      }
      if (clean.includes('pacific') || clean === 'pac-26') {
        return buildCleanRoomPublicHubFromTeamSummary(
          buildPresetExternalTeamSummary('COLLEGIATE_TFRRS', 'Coach')
        );
      }
      return null;
    };

    (async () => {
      try {
        const resp = await fetch(`/api/teams/public/${encodeURIComponent(slugOrCode)}`);
        if (!cancelled && resp.ok) {
          const data = (await resp.json()) as PublicTeamHubPayload;
          if (data.found) {
            setPayload(data);
            setLoading(false);
            return;
          }
        }
      } catch {
        // Offline or local demo fallback
      }
      if (cancelled) return;
      const fb = resolveFallback();
      setPayload(
        fb || {
          found: false,
          error: 'Public Team Hub not found for this link.',
          upcomingMeets: [],
          recentSchedule: [],
          rosterLeaderboard: [],
          stats: { athleteCount: 0, meetCount: 0, officialResultCount: 0 },
        }
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [slugOrCode, localTeamsFallback, initialPayloadForTest]);

  const squadOptions = useMemo(() => {
    if (!payload?.rosterLeaderboard) return [];
    const set = new Set<string>();
    for (const r of payload.rosterLeaderboard) {
      if (r.squadGroup) set.add(r.squadGroup);
    }
    return Array.from(set);
  }, [payload]);

  const visibleRoster = useMemo(() => {
    if (!payload?.rosterLeaderboard) return [];
    const filtered =
      selectedSquad === 'ALL'
        ? payload.rosterLeaderboard
        : payload.rosterLeaderboard.filter((r) => r.squadGroup === selectedSquad);
    return [...filtered].sort((a, b) => {
      const bestA = a.officialResults[0]?.fatTimeSecs ?? Number.POSITIVE_INFINITY;
      const bestB = b.officialResults[0]?.fatTimeSecs ?? Number.POSITIVE_INFINITY;
      if (bestA !== bestB) return bestA - bestB;
      return a.name.localeCompare(b.name);
    });
  }, [payload, selectedSquad]);

  const rosterByEventGroup = useMemo(() => {
    const groups = new Map<
      string,
      { eventLabel: string; distanceMeters: number; rows: PublicTeamHubPayload['rosterLeaderboard'] }
    >();
    for (const ath of visibleRoster) {
      const topMark = ath.officialResults[0];
      const eventLabel = topMark?.eventLabel || 'Roster Athletes';
      const dist = topMark?.eventDistanceMeters ?? Number.MAX_SAFE_INTEGER;
      const existing = groups.get(eventLabel);
      if (existing) {
        existing.rows.push(ath);
      } else {
        groups.set(eventLabel, { eventLabel, distanceMeters: dist, rows: [ath] });
      }
    }
    return Array.from(groups.values())
      .map((g) => ({
        ...g,
        rows: [...g.rows].sort((a, b) => {
          const tA = a.officialResults[0]?.fatTimeSecs ?? Number.POSITIVE_INFINITY;
          const tB = b.officialResults[0]?.fatTimeSecs ?? Number.POSITIVE_INFINITY;
          if (tA !== tB) return tA - tB;
          return a.name.localeCompare(b.name);
        }),
      }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }, [visibleRoster]);

  const handleFollowAsSupporter = async () => {
    if (!payload?.brand) return;
    setIsFollowing(true);
    try {
      const resp = await fetch('/api/teams/follow', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
        body: JSON.stringify({
          origin: typeof window !== 'undefined' ? window.location.origin : '',
          codeOrSlug: payload.brand.slug,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.sessionToken && typeof window !== 'undefined') {
          try {
            localStorage.setItem('aeropulse_session_token', String(data.sessionToken));
          } catch {
            // ignore
          }
        }
        if (Array.isArray(data.teams) && onFollowedTeam) {
          onFollowedTeam(data.teams, payload.brand.teamId);
        }
        setFollowNotice(`Following ${payload.brand.shortName} in read-only Parent & Supporter mode.`);
        return;
      }
    } catch {
      // ignore offline
    } finally {
      setIsFollowing(false);
    }
    setFollowNotice(`Bookmarked ${payload.brand.shortName} hub in this browser.`);
  };

  const externalUrl =
    payload?.brand?.externalSync?.athleticNetUrl ||
    payload?.brand?.externalSync?.tfrrsTeamUrl;

  return (
    <div
      data-testid="public-team-hub-page"
      className="ap-shell min-h-screen text-[#101411] dark:text-[#F4F7F4]"
    >
      <a href="#public-hub-main" className="ap-skip-link">
        Skip to team hub content
      </a>
      <header className="liquid-glass-header sticky top-0 z-30 px-3.5 sm:px-6 py-2.5">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              data-testid="public-hub-back-btn"
              onClick={onExitHub}
              className="ap-btn-secondary !min-h-[44px] sm:!min-h-[36px] px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Workspace</span>
            </button>
            <AeroPulseLogo size="sm" />
          </div>

          <div className="flex items-center gap-2">
            {externalUrl && (
              <a
                href={externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ap-btn-secondary !min-h-[44px] sm:!min-h-[36px] px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <span>
                  {payload?.brand?.externalSync?.platform === 'TFRRS'
                    ? 'TFRRS'
                    : 'Athletic.net'}
                </span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            {payload?.found && (
              <button
                type="button"
                disabled={isFollowing}
                data-testid="public-hub-follow-btn"
                onClick={() => void handleFollowAsSupporter()}
                className="ap-btn-primary !min-h-[44px] sm:!min-h-[36px] px-3.5 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Follow Team</span>
              </button>
            )}
            <button
              type="button"
              onClick={onToggleDark}
              aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center rounded-xl border border-stone-200 dark:border-[#244331] bg-white/80 dark:bg-[#101B15] cursor-pointer"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main id="public-hub-main" tabIndex={-1} className="max-w-6xl mx-auto px-3.5 sm:px-6 py-5 space-y-4">
        {loading ? (
          <div className="ap-card p-6 text-center font-mono text-xs text-[#43584B] dark:text-[#93A39A]">
            Loading Team Hub...
          </div>
        ) : !payload?.found || !payload.brand ? (
          <section className="ap-card p-6 space-y-3">
            <h1 className="text-lg font-bold">Team Hub Unavailable</h1>
            <p className="text-xs text-[#43584B] dark:text-[#93A39A]">
              {payload?.error || 'Check the team share link with your coach.'}
            </p>
          </section>
        ) : (
          <>
            {followNotice && (
              <div
                role="status"
                className="rounded-xl px-3.5 py-2.5 text-xs font-semibold ap-status-prime flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{followNotice}</span>
              </div>
            )}

            {/* Team Banner Card */}
            <section className="ap-card p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="w-3.5 h-3.5 rounded-full shrink-0 border border-black/10"
                      style={{ backgroundColor: payload.brand.primaryHex }}
                      aria-hidden="true"
                    />
                    <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight truncate">
                      {payload.brand.name}
                    </h1>
                    <span className="px-2 py-0.5 rounded-md font-mono text-2xs font-bold bg-[#E3ECE5] text-[#1C5436] dark:bg-[#15231B] dark:text-[#C8FF00]">
                      {payload.brand.shortName}
                    </span>
                  </div>
                  {payload.brand.mascotOrMotto && (
                    <p className="text-xs sm:text-sm text-[#43584B] dark:text-[#93A39A]">
                      {payload.brand.mascotOrMotto} · Coach {payload.brand.coachDisplayName}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
                  <div className="rounded-lg border border-stone-200 dark:border-[#244331] bg-stone-50 dark:bg-[#101B15] px-3 py-1.5">
                    <span className="text-[#43584B] dark:text-[#93A39A]">Athletes:</span>{' '}
                    <strong>{payload.stats.athleteCount}</strong>
                  </div>
                  <div className="rounded-lg border border-stone-200 dark:border-[#244331] bg-stone-50 dark:bg-[#101B15] px-3 py-1.5">
                    <span className="text-[#43584B] dark:text-[#93A39A]">Meets:</span>{' '}
                    <strong>{payload.stats.meetCount}</strong>
                  </div>
                  <div className="rounded-lg border border-stone-200 dark:border-[#244331] bg-stone-50 dark:bg-[#101B15] px-3 py-1.5">
                    <span className="text-[#43584B] dark:text-[#93A39A]">Results:</span>{' '}
                    <strong>{payload.stats.officialResultCount}</strong>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-stone-200 dark:border-[#244331] flex items-center gap-2 text-2xs text-[#43584B] dark:text-[#93A39A]">
                <ShieldCheck className="w-4 h-4 text-[#1C5436] dark:text-[#C8FF00] shrink-0" />
                <span>
                  Safe-Sport Clean-Room Hub: Displays public meet schedules, rosters, and official race marks only. Biometric HRV, sleep, GPS routes, RPE, and weight are never exposed.
                </span>
              </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              {/* Left Column: Meet Schedule */}
              <section className="lg:col-span-5 ap-card p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-[#1C5436] dark:text-[#C8FF00]" />
                    <h2 className="text-sm sm:text-base font-bold">
                      Season Meet Schedule
                    </h2>
                  </div>
                  <span className="font-mono text-2xs text-[#43584B] dark:text-[#93A39A]">
                    {payload.upcomingMeets.length} upcoming
                  </span>
                </div>

                {payload.upcomingMeets.length === 0 && payload.recentSchedule.length === 0 ? (
                  <p className="text-xs text-[#43584B] dark:text-[#93A39A]">
                    No meets published yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {[...payload.upcomingMeets, ...payload.recentSchedule].map((meet) => {
                      const isUpcoming = payload.upcomingMeets.some((u) => u.id === meet.id);
                      return (
                        <div
                          key={meet.id}
                          className="rounded-xl border border-stone-200 dark:border-[#244331] bg-stone-50 dark:bg-[#101B15] p-3 space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2 font-mono text-2xs">
                            <span
                              className={
                                isUpcoming
                                  ? 'font-bold text-[#1C5436] dark:text-[#C8FF00]'
                                  : 'text-[#43584B] dark:text-[#93A39A]'
                              }
                            >
                              {meet.date}
                              {meet.scheduledTime
                                ? ` · ${formatPracticeTime12h(meet.scheduledTime)}`
                                : ''}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-white dark:bg-[#15231B] text-[#43584B] dark:text-[#93A39A]">
                              {isUpcoming ? 'Upcoming' : 'Completed'}
                            </span>
                          </div>
                          <div className="text-xs sm:text-sm font-bold">{meet.name}</div>
                          {meet.locationName && (
                            <div className="flex items-center gap-1 text-2xs text-[#43584B] dark:text-[#93A39A]">
                              <MapPin className="w-3.5 h-3.5 shrink-0" />
                              <span className="truncate">{meet.locationName}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Right Column: Roster & Official Results */}
              <section className="lg:col-span-7 ap-card p-4 sm:p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-[#1C5436] dark:text-[#C8FF00]" />
                    <h2 className="text-sm sm:text-base font-bold">
                      Squad Roster &amp; Official Marks
                    </h2>
                  </div>

                  {squadOptions.length > 1 && (
                    <select
                      aria-label="Filter squad division"
                      value={selectedSquad}
                      onChange={(e) => setSelectedSquad(e.target.value)}
                      className="min-h-[44px] sm:min-h-[34px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-2.5 text-xs font-semibold"
                    >
                      <option value="ALL">All Squads ({payload.rosterLeaderboard.length})</option>
                      {squadOptions.map((sq) => (
                        <option key={sq} value={sq}>
                          {sq}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {visibleRoster.length === 0 ? (
                  <div className="flex items-center gap-2 text-xs text-[#43584B] dark:text-[#93A39A]">
                    <Users className="w-4 h-4" />
                    <span>No roster athletes published yet.</span>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {rosterByEventGroup.map((group) => (
                      <div key={group.eventLabel} className="space-y-1">
                        <div className="text-2xs font-mono font-bold uppercase tracking-wider text-[#1C5436] dark:text-[#C8FF00] border-b border-stone-200 dark:border-[#244331] pb-1">
                          {group.eventLabel} ({group.rows.length})
                        </div>
                        <div className="divide-y divide-stone-200 dark:divide-[#244331]">
                          {group.rows.map((ath) => {
                            const latestMark = ath.officialResults[0];
                            return (
                              <div
                                key={ath.membershipId}
                                data-testid="public-hub-roster-row"
                                className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                              >
                                <div className="min-w-0">
                                  <div className="font-bold flex items-center gap-1.5">
                                    <span className="truncate">{ath.name}</span>
                                    {ath.externalProfileUrl && /^https:\/\//i.test(ath.externalProfileUrl.trim()) && (
                                      <a
                                        href={ath.externalProfileUrl.trim()}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        aria-label={`Open external profile for ${ath.name}`}
                                        className="text-[#1C5436] dark:text-[#C8FF00]"
                                      >
                                        <ExternalLink className="w-3.5 h-3.5" />
                                      </a>
                                    )}
                                  </div>
                                  <div className="font-mono text-2xs text-[#43584B] dark:text-[#93A39A]">
                                    {ath.squadGroup}
                                    {ath.graduationYear ? ` · Class of ${ath.graduationYear}` : ''}
                                  </div>
                                </div>

                                <div className="text-right font-mono shrink-0">
                                  {latestMark ? (
                                    <>
                                      <div className="font-extrabold text-[#1C5436] dark:text-[#C8FF00]">
                                        {latestMark.displayFatTime}{' '}
                                        <span className="font-normal text-2xs text-[#43584B] dark:text-[#93A39A]">
                                          ({latestMark.eventLabel})
                                        </span>
                                      </div>
                                      <div className="text-2xs text-[#43584B] dark:text-[#93A39A]">
                                        {latestMark.meetName}
                                        {latestMark.placeFinish ? ` · #${latestMark.placeFinish}` : ''}
                                      </div>
                                    </>
                                  ) : (
                                    <div className="font-bold text-[#101411] dark:text-[#F4F7F4]">
                                      {ath.seedMarkOrFtp ? `Seed ${ath.seedMarkOrFtp}` : 'Rostered'}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </main>

      <footer className="max-w-6xl mx-auto px-3.5 sm:px-6 pb-6 pt-2 flex flex-wrap items-center justify-between gap-2 text-2xs text-[#43584B] dark:text-[#93A39A]">
        <span>THRESH Clean-Room Team Hub · Youth Safe-Sport Shield</span>
        <div className="flex flex-wrap items-center gap-3 font-semibold">
          <a href="/privacy" className="min-h-[44px] sm:min-h-0 inline-flex items-center hover:underline">
            Privacy
          </a>
          <a href="/terms" className="min-h-[44px] sm:min-h-0 inline-flex items-center hover:underline">
            Terms
          </a>
          <a href="/subprocessors" className="min-h-[44px] sm:min-h-0 inline-flex items-center hover:underline">
            Subprocessors
          </a>
          <a href="/procurement" className="min-h-[44px] sm:min-h-0 inline-flex items-center hover:underline">
            Procurement
          </a>
        </div>
      </footer>
    </div>
  );
};

export default PublicTeamHubPage;
