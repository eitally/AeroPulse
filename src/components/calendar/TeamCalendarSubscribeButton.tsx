import React, { useEffect, useState } from 'react';
import {
  Calendar,
  Check,
  Copy,
  ExternalLink,
  RefreshCw,
} from '../icons/PhosphorIcons';
import {
  fetchTeamCalendarFeedMeta,
  rotateTeamCalendarFeedToken,
  type TeamCalendarFeedMeta,
} from '../../utils/teamEventsApi';

export interface TeamCalendarSubscribeButtonProps {
  teamId?: string | null;
  isDemoMode?: boolean;
  canRotate?: boolean;
  compact?: boolean;
  label?: string;
  testId?: string;
}

function buildDemoFeedMeta(teamId: string, canRotate: boolean): TeamCalendarFeedMeta {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://meetready.app';
  const feedUrl = `${origin}/api/teams/${encodeURIComponent(teamId)}/calendar-feed/demo-preview-token-01.ics`;
  const webcalUrl = feedUrl.replace(/^https?:\/\//i, 'webcal://');
  const googleCalendarUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feedUrl)}`;
  return {
    feedUrl,
    webcalUrl,
    googleCalendarUrl,
    canRotate,
  };
}

export const TeamCalendarSubscribeButton: React.FC<TeamCalendarSubscribeButtonProps> = ({
  teamId,
  isDemoMode = false,
  canRotate = false,
  compact = false,
  label = 'Subscribe Calendar',
  testId = 'team-calendar-subscribe-btn',
}) => {
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<TeamCalendarFeedMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !teamId) return;
    if (isDemoMode || teamId.startsWith('demo')) {
      setMeta((prev) => prev || buildDemoFeedMeta(teamId, canRotate));
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchTeamCalendarFeedMeta(teamId)
      .then((res) => {
        if (!cancelled) setMeta(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load calendar feed link.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, teamId, isDemoMode, canRotate]);

  if (!teamId) return null;

  const handleCopy = () => {
    if (!meta?.feedUrl) return;
    navigator.clipboard?.writeText(meta.feedUrl).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const handleRotate = async () => {
    if (!teamId) return;
    if (isDemoMode || teamId.startsWith('demo')) {
      const origin =
        typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : 'https://meetready.app';
      const rotatedToken = `demo-rotated-${Date.now().toString(36)}`;
      const feedUrl = `${origin}/api/teams/${encodeURIComponent(teamId)}/calendar-feed/${rotatedToken}.ics`;
      setMeta({
        feedUrl,
        webcalUrl: feedUrl.replace(/^https?:\/\//i, 'webcal://'),
        googleCalendarUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feedUrl)}`,
        canRotate: true,
      });
      return;
    }
    setRotating(true);
    setError(null);
    try {
      const nextMeta = await rotateTeamCalendarFeedToken(teamId);
      setMeta(nextMeta);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to rotate calendar feed link.');
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        data-testid={testId}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={`ap-btn-secondary inline-flex items-center gap-1.5 font-semibold cursor-pointer ${
          compact
            ? '!min-h-[36px] px-2.5 py-1 text-2xs'
            : '!min-h-[44px] sm:!min-h-[36px] px-3 py-1.5 text-xs'
        }`}
      >
        <Calendar className="w-3.5 h-3.5 text-ap-cobalt dark:text-ap-volt shrink-0" />
        <span>{label}</span>
      </button>

      {open && (
        <div
          role="region"
          aria-label="Private Team Calendar Feed"
          data-testid="team-calendar-subscribe-popover"
          className="mt-2 w-72 sm:w-80 rounded-2xl border border-stone-200 dark:border-ap-edge bg-white dark:bg-ap-obsidian shadow-lg p-3.5 space-y-2.5 text-xs z-30"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-ap-ink dark:text-ap-chalk">
              Sync to Apple &amp; Google Calendar
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-ap-chalk cursor-pointer"
            >
              Close
            </button>
          </div>

          <p className="text-2xs text-ap-muted dark:text-ap-muted-dark leading-relaxed">
            Private RFC 5545 schedule feed with start times, venues, delays, and live results URLs. Zero athlete biometrics or PII.
          </p>

          {loading && !meta && (
            <div className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark py-1">
              Generating private calendar link…
            </div>
          )}

          {error && (
            <div className="rounded-lg px-2.5 py-1.5 text-2xs font-semibold ap-status-caution">
              {error}
            </div>
          )}

          {meta && (
            <div className="space-y-1.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <a
                  href={meta.webcalUrl}
                  data-testid="ics-apple-webcal-link"
                  className="min-h-[40px] sm:min-h-[34px] px-2.5 rounded-lg ap-btn-primary text-2xs font-bold inline-flex items-center justify-center gap-1.5"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Apple / Outlook</span>
                </a>
                <a
                  href={meta.googleCalendarUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="ics-google-calendar-link"
                  className="min-h-[40px] sm:min-h-[34px] px-2.5 rounded-lg ap-btn-secondary text-2xs font-semibold inline-flex items-center justify-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Google Calendar</span>
                </a>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  data-testid="ics-copy-url-btn"
                  onClick={handleCopy}
                  className="flex-1 min-h-[38px] sm:min-h-[32px] px-2.5 rounded-lg ap-btn-secondary text-2xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copied ? 'Link Copied' : 'Copy Feed URL'}</span>
                </button>
                {(canRotate || meta.canRotate) && (
                  <button
                    type="button"
                    disabled={rotating}
                    data-testid="ics-rotate-token-btn"
                    onClick={() => void handleRotate()}
                    className="min-h-[38px] sm:min-h-[32px] px-2.5 rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-stone-50 dark:bg-ap-carbon text-2xs font-semibold text-ap-ink dark:text-ap-chalk inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>{rotating ? 'Rotating…' : 'Rotate Link'}</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TeamCalendarSubscribeButton;
