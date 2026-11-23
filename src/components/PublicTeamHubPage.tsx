import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Award,
  Bell,
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  MapPin,
  Moon,
  ShieldCheck,
  Sun,
  Trophy,
  UserPlus,
  Users,
} from './icons/PhosphorIcons';
import type {
  PublicTeamHubFieldPrItem,
  PublicTeamHubPayload,
  TeamSummaryWithRole,
} from '../types';
import { getFieldEventSpec } from '../physiology/fieldEventsEngine';
import { buildPresetExternalTeamSummary } from '../utils/athleticNetAndTfrrsEngine';
import { buildCleanRoomPublicHubFromTeamSummary } from '../utils/publicTeamHubRoute';
import { formatPracticeTime12h } from '../utils/workoutScheduleUtils';
import { getSavedIntervalsHeaders } from '../utils/telemetryStorage';
import { markSessionActiveHint } from '../utils/sessionHint';
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

/** Formats a race placeFinish label without prefixing a duplicate `#` on `#10` or `Leg #2`. */
export function formatPublicPlaceFinish(placeFinish?: string | null): string {
  const trimmed = String(placeFinish || '').trim();
  if (!trimmed) return '';
  return /^\d+$/.test(trimmed) ? `#${trimmed}` : trimmed;
}

type FieldHubFilter = 'ALL' | 'JUMPS' | 'THROWS' | 'POLE_VAULT' | 'MULTI';

const FIELD_HUB_FILTER_OPTIONS: ReadonlyArray<{ id: FieldHubFilter; label: string }> = [
  { id: 'ALL', label: 'All Field' },
  { id: 'JUMPS', label: 'Jumps' },
  { id: 'THROWS', label: 'Throws' },
  { id: 'POLE_VAULT', label: 'Vault' },
  { id: 'MULTI', label: 'Multi' },
];

function formatPublicFieldWindBadge(item: PublicTeamHubFieldPrItem): string | null {
  if (typeof item.windMps === 'number' && Number.isFinite(item.windMps)) {
    const signed = `${item.windMps > 0 ? '+' : ''}${item.windMps.toFixed(1)}`;
    return item.isWindAided ? `${signed}w` : `${signed} m/s`;
  }
  return item.isWindAided ? 'w' : null;
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
  const [selectedFieldFilter, setSelectedFieldFilter] = useState<FieldHubFilter>('ALL');
  const [followNotice, setFollowNotice] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState<boolean>(false);
  const [showCalendarSubscribe, setShowCalendarSubscribe] = useState<boolean>(false);
  const [copiedFeedUrl, setCopiedFeedUrl] = useState<boolean>(false);
  const [subscribeEmail, setSubscribeEmail] = useState<string>('');
  const [subscribingEmail, setSubscribingEmail] = useState<boolean>(false);
  const [subscribeNotice, setSubscribeNotice] = useState<{
    tone: 'ok' | 'error';
    text: string;
  } | null>(null);

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

    const isDemoQuery =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('demo') === '1';
    if (isDemoQuery) {
      const demoFallback = resolveFallback();
      if (demoFallback) {
        setPayload(demoFallback);
        setLoading(false);
        return;
      }
    }

    (async () => {
      try {
        const resp = await fetch(`/api/teams/public/${encodeURIComponent(slugOrCode)}`, {
          credentials: 'include',
        });
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

  const fieldPrGroups = useMemo(() => {
    const items = payload?.fieldLeaderboard || [];
    const filtered = items.filter((item) => {
      if (selectedSquad !== 'ALL' && item.squadGroup !== selectedSquad) return false;
      if (selectedFieldFilter === 'ALL') return true;
      return getFieldEventSpec(item.eventCode).eventGroup === selectedFieldFilter;
    });

    const grouped = new Map<
      string,
      { eventCode: string; eventLabel: string; rows: PublicTeamHubFieldPrItem[] }
    >();
    for (const item of filtered) {
      const existing = grouped.get(item.eventCode);
      if (existing) {
        existing.rows.push(item);
      } else {
        grouped.set(item.eventCode, {
          eventCode: item.eventCode,
          eventLabel: item.eventLabel,
          rows: [item],
        });
      }
    }
    return Array.from(grouped.values());
  }, [payload?.fieldLeaderboard, selectedFieldFilter, selectedSquad]);

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
        markSessionActiveHint();
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

  const calendarFeedUrls = useMemo(() => {
    const slug = payload?.brand?.slug || slugOrCode;
    const encodedSlug = encodeURIComponent(slug);
    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'https://meetready.app';
    const host =
      typeof window !== 'undefined' ? window.location.host : 'meetready.app';
    const httpFeedUrl = `${origin}/api/teams/public/${encodedSlug}/calendar.ics`;
    const webcalFeedUrl = `webcal://${host}/api/teams/public/${encodedSlug}/calendar.ics`;
    const googleCalendarUrl = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(
      webcalFeedUrl
    )}`;
    return { httpFeedUrl, webcalFeedUrl, googleCalendarUrl };
  }, [payload?.brand?.slug, slugOrCode]);

  const handleCopyFeedUrl = async () => {
    try {
      await navigator.clipboard.writeText(calendarFeedUrls.httpFeedUrl);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = calendarFeedUrls.httpFeedUrl;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedFeedUrl(true);
    window.setTimeout(() => setCopiedFeedUrl(false), 2200);
  };

  const handleDownloadFallbackIcs = () => {
    if (!payload?.brand) return;
    const allMeets = [...payload.upcomingMeets, ...payload.recentSchedule];
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//MeetReady//Parent Hub Calendar//EN',
      `X-WR-CALNAME:${payload.brand.name.replace(/[,;\n]/g, ' ')} Meet Schedule`,
    ];
    for (const meet of allMeets) {
      const ymd = meet.date.replace(/-/g, '');
      const safeTitle = `${payload.brand.shortName || 'Team'} · ${meet.name}`.replace(
        /[,;\n]/g,
        ' '
      );
      const safeLoc = (meet.locationName || '').replace(/[,;\n]/g, ' ');
      lines.push(
        'BEGIN:VEVENT',
        `UID:${meet.id}@meetready.app`,
        `DTSTART;VALUE=DATE:${ymd}`,
        `SUMMARY:${safeTitle}`,
        ...(safeLoc ? [`LOCATION:${safeLoc}`] : []),
        'END:VEVENT'
      );
    }
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(payload.brand.slug || 'team').toLowerCase()}-meets.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleSubscribeParentEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payload?.brand) return;
    const cleanEmail = subscribeEmail.trim();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
      setSubscribeNotice({ tone: 'error', text: 'Enter a valid email address.' });
      return;
    }

    const isDemoQuery =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('demo') === '1';
    if (isDemoQuery) {
      setSubscribeNotice({
        tone: 'ok',
        text: `Demo preview: ${cleanEmail} would receive a confirmation link for ${payload.brand.shortName} meet & weather updates.`,
      });
      setSubscribeEmail('');
      return;
    }

    setSubscribingEmail(true);
    setSubscribeNotice(null);
    try {
      const resp = await fetch(
        `/api/teams/public/${encodeURIComponent(payload.brand.slug)}/subscribe`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail }),
        }
      );
      const data = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (!resp.ok || data.ok === false) {
        setSubscribeNotice({
          tone: 'error',
          text: data.error || 'Could not save subscription right now.',
        });
        return;
      }
      setSubscribeNotice({
        tone: 'ok',
        text:
          data.message ||
          `Subscription recorded for ${cleanEmail}. Check your inbox to confirm updates.`,
      });
      setSubscribeEmail('');
    } catch {
      setSubscribeNotice({
        tone: 'error',
        text: 'Network error subscribing. Try Calendar Subscribe (.ics) above.',
      });
    } finally {
      setSubscribingEmail(false);
    }
  };

  return (
    <div
      data-testid="public-team-hub-page"
      className="ap-shell min-h-screen text-ap-ink dark:text-ap-chalk"
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
              <span>MeetReady Home</span>
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
            {payload?.found && payload.brand?.joinCode && (
              <a
                href={`/?join=${encodeURIComponent(payload.brand.joinCode)}&role=athlete`}
                data-testid="public-hub-join-btn"
                className="ap-btn-secondary !min-h-[44px] sm:!min-h-[36px] px-3.5 py-1.5 text-xs font-bold inline-flex items-center gap-1.5"
              >
                <span>Join Roster</span>
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
              className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center rounded-xl border border-ap-frame/20 dark:border-ap-edge bg-white/90 dark:bg-ap-carbon cursor-pointer"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main id="public-hub-main" tabIndex={-1} className="max-w-6xl mx-auto px-3.5 sm:px-6 py-5">
        <div className="ap-content-stage rounded-2xl p-3.5 sm:p-6 space-y-4">
        {loading ? (
          <div className="ap-card p-6 text-center font-mono text-xs text-ap-muted dark:text-ap-muted-dark">
            Loading Team Hub...
          </div>
        ) : !payload?.found || !payload.brand ? (
          <section className="ap-card p-6 space-y-3">
            <h1 className="text-lg font-bold">Team Hub Unavailable</h1>
            <p className="text-xs text-ap-muted dark:text-ap-muted-dark">
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
                    <span className="px-2 py-0.5 rounded-md font-mono text-2xs font-bold bg-[#E3ECE5] text-ap-cobalt dark:bg-ap-turf dark:text-ap-volt">
                      {payload.brand.shortName}
                    </span>
                  </div>
                  {payload.brand.mascotOrMotto && (
                    <p className="text-xs sm:text-sm text-ap-muted dark:text-ap-muted-dark">
                      {payload.brand.mascotOrMotto} ·{' '}
                      {/^coach\b/i.test(payload.brand.coachDisplayName.trim())
                        ? payload.brand.coachDisplayName.trim()
                        : `Coach ${payload.brand.coachDisplayName.trim()}`}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
                  <div className="rounded-lg border border-ap-frame/20 dark:border-ap-edge bg-ap-chalk/70 dark:bg-ap-carbon px-3 py-1.5">
                    <span className="text-ap-muted dark:text-ap-muted-dark">Athletes:</span>{' '}
                    <strong>{payload.stats.athleteCount}</strong>
                  </div>
                  <div className="rounded-lg border border-ap-frame/20 dark:border-ap-edge bg-ap-chalk/70 dark:bg-ap-carbon px-3 py-1.5">
                    <span className="text-ap-muted dark:text-ap-muted-dark">Meets:</span>{' '}
                    <strong>{payload.stats.meetCount}</strong>
                  </div>
                  <div className="rounded-lg border border-ap-frame/20 dark:border-ap-edge bg-ap-chalk/70 dark:bg-ap-carbon px-3 py-1.5">
                    <span className="text-ap-muted dark:text-ap-muted-dark">Results:</span>{' '}
                    <strong>{payload.stats.officialResultCount}</strong>
                  </div>
                  {(payload.stats.fieldPrCount ?? 0) > 0 && (
                    <div className="rounded-lg border border-ap-frame/20 dark:border-ap-edge bg-ap-chalk/70 dark:bg-ap-carbon px-3 py-1.5">
                      <span className="text-ap-muted dark:text-ap-muted-dark">Field PRs:</span>{' '}
                      <strong>{payload.stats.fieldPrCount}</strong>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-2 border-t border-ap-frame/15 dark:border-ap-edge flex items-center gap-2 text-2xs text-ap-muted dark:text-ap-muted-dark">
                <ShieldCheck className="w-4 h-4 text-ap-cobalt dark:text-ap-volt shrink-0" />
                <span>
                  Safe-Sport Team Hub: Displays public meet schedules, rosters, and official results only. Private athlete health metrics, personal contacts, and GPS routes are never shown.
                </span>
              </div>
            </section>

            {(payload.announcements || []).length > 0 && (
              <section
                data-testid="public-hub-announcements"
                className="rounded-2xl liquid-glass border border-amber-500/35 px-4 py-3 space-y-2"
              >
                <div className="flex items-center gap-2 text-xs font-extrabold text-ap-ink dark:text-ap-chalk uppercase tracking-wider font-mono">
                  <Bell className="w-4 h-4 text-amber-500 shrink-0" />
                  <span>Active Weather &amp; Schedule Alerts</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {payload.announcements!.slice(0, 4).map((ann) => (
                    <div
                      key={ann.id}
                      className="rounded-xl ap-card-inset px-3 py-2 text-xs space-y-0.5"
                    >
                      <div className="flex items-center justify-between gap-2 font-mono text-2xs">
                        <span className="font-bold text-ap-cobalt dark:text-ap-volt">
                          [{ann.category}] {ann.title}
                        </span>
                        <span className="text-ap-muted dark:text-ap-muted-dark">
                          {ann.createdAt.slice(0, 10)}
                        </span>
                      </div>
                      <p className="text-ap-ink dark:text-ap-chalk leading-snug">{ann.body}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              {/* Left Column: Meet Schedule, Live Calendar Subscribe & Parent Email Updates */}
              <div className="lg:col-span-5 space-y-4">
              <section className="ap-card p-4 sm:p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-ap-cobalt dark:text-ap-volt" />
                    <h2 className="text-sm sm:text-base font-bold">
                      Season Meet Schedule
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid="public-hub-calendar-subscribe-btn"
                      aria-expanded={showCalendarSubscribe}
                      onClick={() => setShowCalendarSubscribe((prev) => !prev)}
                      className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-lg ap-card-inset text-2xs font-mono font-bold text-ap-cobalt dark:text-ap-volt hover:underline inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Calendar Subscribe</span>
                    </button>
                    <span className="font-mono text-2xs text-ap-muted dark:text-ap-muted-dark">
                      {payload.upcomingMeets.length} upcoming
                    </span>
                  </div>
                </div>

                {showCalendarSubscribe && (
                  <div
                    data-testid="public-hub-calendar-subscribe-panel"
                    className="rounded-xl ap-card-inset p-3 space-y-2.5 text-xs"
                  >
                    <div className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                      Live RFC 5545 schedule feed (auto-refreshes every 6h · public meets only):
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      <a
                        href={calendarFeedUrls.webcalFeedUrl}
                        data-testid="public-hub-webcal-link"
                        className="min-h-[44px] sm:min-h-[36px] px-3 rounded-lg ap-btn-primary text-2xs font-bold inline-flex items-center justify-center gap-1.5"
                      >
                        <Calendar className="w-3.5 h-3.5" />
                        <span>Apple / Outlook (webcal)</span>
                      </a>
                      <a
                        href={calendarFeedUrls.googleCalendarUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="public-hub-gcal-link"
                        className="min-h-[44px] sm:min-h-[36px] px-3 rounded-lg ap-btn-secondary text-2xs font-semibold inline-flex items-center justify-center gap-1.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Google Calendar</span>
                      </a>
                      <button
                        type="button"
                        data-testid="public-hub-copy-ics-url-btn"
                        onClick={() => void handleCopyFeedUrl()}
                        className="min-h-[44px] sm:min-h-[36px] px-3 rounded-lg ap-btn-secondary text-2xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        {copiedFeedUrl ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedFeedUrl ? 'Feed URL Copied' : 'Copy Feed URL'}</span>
                      </button>
                      <button
                        type="button"
                        data-testid="public-hub-download-ics-btn"
                        onClick={handleDownloadFallbackIcs}
                        className="min-h-[44px] sm:min-h-[36px] px-3 rounded-lg ap-btn-secondary text-2xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download .ics File</span>
                      </button>
                    </div>
                  </div>
                )}

                {payload.upcomingMeets.length === 0 && payload.recentSchedule.length === 0 ? (
                  <p className="text-xs text-ap-muted dark:text-ap-muted-dark">
                    No meets published yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {[...payload.upcomingMeets, ...payload.recentSchedule].map((meet) => {
                      const isUpcoming = payload.upcomingMeets.some((u) => u.id === meet.id);
                      return (
                        <div
                          key={meet.id}
                          className="rounded-xl border border-ap-frame/20 dark:border-ap-edge bg-ap-chalk/70 dark:bg-ap-carbon p-3 space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2 font-mono text-2xs">
                            <span
                              className={
                                isUpcoming
                                  ? 'font-bold text-ap-cobalt dark:text-ap-volt'
                                  : 'text-ap-muted dark:text-ap-muted-dark'
                              }
                            >
                              {meet.date}
                              {meet.scheduledTime
                                ? ` · ${formatPracticeTime12h(meet.scheduledTime)}`
                                : ''}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-white dark:bg-ap-turf text-ap-muted dark:text-ap-muted-dark">
                              {isUpcoming ? 'Upcoming' : 'Completed'}
                            </span>
                          </div>
                          <div className="text-xs sm:text-sm font-bold">{meet.name}</div>
                          {meet.locationName && (
                            <div className="flex items-center gap-1 text-2xs text-ap-muted dark:text-ap-muted-dark">
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

              {/* Compact Parent Email Updates Card */}
              <section
                data-testid="public-hub-email-subscribe-card"
                className="ap-card p-4 sm:p-5 space-y-2.5"
              >
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-ap-clay dark:text-ap-volt shrink-0" />
                  <h2 className="text-sm font-bold">Parent Email Updates</h2>
                </div>
                <p className="text-2xs text-ap-muted dark:text-ap-muted-dark leading-relaxed">
                  Get weather changes, meet bus updates &amp; official results. Zero minor PII · 1-click unsubscribe anytime.
                </p>
                <form
                  onSubmit={(e) => void handleSubscribeParentEmail(e)}
                  className="flex flex-col sm:flex-row gap-2"
                >
                  <input
                    type="email"
                    required
                    aria-label="Parent or supporter email address"
                    data-testid="public-hub-subscribe-email-input"
                    value={subscribeEmail}
                    onChange={(e) => setSubscribeEmail(e.target.value)}
                    placeholder="parent@family.com"
                    className="flex-1 min-h-[44px] rounded-xl border border-ap-frame/25 dark:border-ap-edge bg-white dark:bg-ap-carbon px-3 text-xs text-ap-ink dark:text-ap-chalk"
                  />
                  <button
                    type="submit"
                    disabled={subscribingEmail}
                    data-testid="public-hub-subscribe-btn"
                    className="ap-btn-primary !min-h-[44px] px-4 py-2 text-xs font-bold cursor-pointer disabled:opacity-55 shrink-0"
                  >
                    {subscribingEmail ? 'Saving…' : 'Get Updates'}
                  </button>
                </form>
                {subscribeNotice && (
                  <div
                    role="status"
                    data-testid="public-hub-subscribe-status"
                    className={`rounded-xl px-3 py-2 text-2xs font-semibold ${
                      subscribeNotice.tone === 'ok'
                        ? 'ap-status-prime'
                        : 'ap-status-strained'
                    }`}
                  >
                    {subscribeNotice.text}
                  </div>
                )}
              </section>
              </div>

              {/* Right Column: Roster & Official Results */}
              <section className="lg:col-span-7 ap-card p-4 sm:p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-ap-cobalt dark:text-ap-volt" />
                    <h2 className="text-sm sm:text-base font-bold">
                      Squad Roster &amp; Official Marks
                    </h2>
                  </div>

                  {squadOptions.length > 1 && (
                    <select
                      aria-label="Filter squad division"
                      value={selectedSquad}
                      onChange={(e) => setSelectedSquad(e.target.value)}
                      className="min-h-[44px] sm:min-h-[34px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2.5 text-xs font-semibold"
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
                  <div className="flex items-center gap-2 text-xs text-ap-muted dark:text-ap-muted-dark">
                    <Users className="w-4 h-4" />
                    <span>No roster athletes published yet.</span>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {rosterByEventGroup.map((group) => (
                      <div key={group.eventLabel} className="space-y-1">
                        <div className="text-2xs font-mono font-bold uppercase tracking-wider text-ap-cobalt dark:text-ap-volt border-b border-ap-frame/20 dark:border-ap-edge pb-1">
                          {group.eventLabel} ({group.rows.length})
                        </div>
                        <div className="divide-y divide-ap-frame/15 dark:divide-ap-edge">
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
                                        className="text-ap-cobalt dark:text-ap-volt"
                                      >
                                        <ExternalLink className="w-3.5 h-3.5" />
                                      </a>
                                    )}
                                  </div>
                                  <div className="font-mono text-2xs text-ap-muted dark:text-ap-muted-dark">
                                    {ath.squadGroup}
                                    {ath.graduationYear ? ` · Class of ${ath.graduationYear}` : ''}
                                  </div>
                                </div>

                                <div className="text-right font-mono shrink-0">
                                  {latestMark ? (
                                    <>
                                      <div className="font-extrabold text-ap-cobalt dark:text-ap-volt">
                                        {latestMark.displayFatTime}{' '}
                                        <span className="font-normal text-2xs text-ap-muted dark:text-ap-muted-dark">
                                          ({latestMark.eventLabel})
                                        </span>
                                      </div>
                                      <div className="text-2xs text-ap-muted dark:text-ap-muted-dark">
                                        {latestMark.meetName}
                                        {formatPublicPlaceFinish(latestMark.placeFinish)
                                          ? ` · ${formatPublicPlaceFinish(latestMark.placeFinish)}`
                                          : ''}
                                      </div>
                                    </>
                                  ) : (
                                    <div className="font-bold text-ap-ink dark:text-ap-chalk">
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

            {(payload.fieldLeaderboard || []).length > 0 && (
              <section
                data-testid="public-hub-field-prs"
                className="ap-card p-4 sm:p-5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Award className="w-4 h-4 text-ap-cobalt dark:text-ap-volt shrink-0" />
                    <div>
                      <h2 className="text-sm sm:text-base font-bold">
                        Field Event PRs &amp; Leaderboard
                      </h2>
                      <p className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                        Verified Competition Marks · Wind-Legal Preferred · Dual Imperial &amp; Metric
                      </p>
                    </div>
                  </div>
                  <div
                    role="group"
                    aria-label="Filter field event category"
                    className="flex flex-wrap items-center gap-1.5"
                  >
                    {FIELD_HUB_FILTER_OPTIONS.map((opt) => {
                      const active = selectedFieldFilter === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          data-testid={`public-hub-field-filter-${opt.id}`}
                          aria-pressed={active}
                          onClick={() => setSelectedFieldFilter(opt.id)}
                          className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl text-xs font-mono font-bold cursor-pointer transition-colors ${
                            active
                              ? 'bg-ap-cobalt text-white dark:bg-ap-volt dark:text-ap-obsidian'
                              : 'ap-card-inset text-ap-ink dark:text-ap-chalk hover:border-ap-cobalt/60 dark:hover:border-ap-volt/60'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {fieldPrGroups.length === 0 ? (
                  <p className="text-xs font-mono text-ap-muted dark:text-ap-muted-dark py-2">
                    No competition field PRs match this filter yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {fieldPrGroups.map((group) => (
                      <div
                        key={group.eventCode}
                        className="rounded-xl border border-ap-frame/20 dark:border-ap-edge bg-ap-chalk/70 dark:bg-ap-carbon p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2 border-b border-ap-frame/15 dark:border-ap-edge pb-1.5">
                          <span className="text-xs font-mono font-extrabold uppercase tracking-wider text-ap-cobalt dark:text-ap-volt">
                            {group.eventLabel}
                          </span>
                          <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                            {group.rows.length} PR{group.rows.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        <div className="divide-y divide-ap-frame/15 dark:divide-ap-edge">
                          {group.rows.map((pr, idx) => {
                            const windBadge = formatPublicFieldWindBadge(pr);
                            return (
                              <div
                                key={`${pr.id}-${pr.membershipId || pr.displayName}`}
                                data-testid="public-hub-field-row"
                                className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                              >
                                <div className="min-w-0">
                                  <div className="font-bold flex items-center gap-1.5">
                                    <span className="font-mono text-2xs text-ap-muted dark:text-ap-muted-dark tabular-nums">
                                      #{idx + 1}
                                    </span>
                                    <span className="truncate">{pr.displayName}</span>
                                    {windBadge && (
                                      <span
                                        title={
                                          pr.isWindAided
                                            ? 'Wind-aided mark (> +2.0 m/s)'
                                            : 'Wind-legal reading'
                                        }
                                        className={`px-1.5 py-0.5 rounded font-mono text-2xs font-bold tabular-nums ${
                                          pr.isWindAided
                                            ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30'
                                            : 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30'
                                        }`}
                                      >
                                        {windBadge}
                                      </span>
                                    )}
                                  </div>
                                  <div className="font-mono text-2xs text-ap-muted dark:text-ap-muted-dark truncate">
                                    {pr.squadGroup || 'Team'}
                                    {pr.graduationYear ? ` · '${String(pr.graduationYear).slice(-2)}` : ''}
                                    {pr.meetName ? ` · ${pr.meetName}` : ''}
                                    {pr.date ? ` (${pr.date})` : ''}
                                  </div>
                                </div>
                                <div className="text-right font-mono font-extrabold text-ap-cobalt dark:text-ap-volt shrink-0 tabular-nums">
                                  {pr.displayMark}
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
            )}
          </>
        )}
        </div>
      </main>

      <div className="max-w-6xl mx-auto px-3.5 sm:px-6 pb-6">
        <footer className="bg-ap-obsidian text-ap-chalk border border-ap-edge rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-2xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ap-chalk">MeetReady Safe-Sport Team Hub</span>
            <span className="text-ap-muted-dark" aria-hidden="true">·</span>
            <a href="/?role=coach" className="font-bold text-ap-volt hover:underline">
              Coaching Track, Field or XC? Start a Free Founding Season Pilot →
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-3 font-semibold text-ap-chalk/90">
            <a href="/for-athletic-directors" className="min-h-[44px] sm:min-h-0 inline-flex items-center hover:text-ap-volt hover:underline">
              For ADs
            </a>
            <a href="/privacy" className="min-h-[44px] sm:min-h-0 inline-flex items-center hover:text-ap-volt hover:underline">
              Privacy
            </a>
            <a href="/terms" className="min-h-[44px] sm:min-h-0 inline-flex items-center hover:text-ap-volt hover:underline">
              Terms
            </a>
            <a href="/subprocessors" className="min-h-[44px] sm:min-h-0 inline-flex items-center hover:text-ap-volt hover:underline">
              Subprocessors
            </a>
            <a href="/procurement" className="min-h-[44px] sm:min-h-0 inline-flex items-center hover:text-ap-volt hover:underline">
              Procurement
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default PublicTeamHubPage;
