import React, { useState } from 'react';
import {
  RefreshCw,
  Database,
  CalendarPlus,
  Eye,
  Lock,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  X,
} from './icons/PhosphorIcons';
import type {
  AthleteProfile,
  ConnectedAthleteRecord,
  ConnectionStatus,
  DistanceUnit,
} from '../types';
import { formatPace } from '../utils/formatters';

interface CockpitStageBannersProps {
  pendingUrlJoinOffer: {
    token?: string;
    teamName: string;
    shortName: string;
    codeOrSlug: string;
  } | null;
  onAcceptJoinOffer: () => Promise<void>;
  onDismissJoinOffer: () => void;

  isSyncing: boolean;
  activitiesCount: number;
  onOpenDataSources: () => void;

  activeConnectedAthlete: ConnectedAthleteRecord | null;
  shieldedConnectedTelemetry: {
    redactedWellness: boolean;
    redactedGpsRoutes: boolean;
  } | null;
  onOpenRosterModal: () => void;
  onReturnToMyProfile: () => void;

  readOnlyNotice: string | null;
  onDismissReadOnlyNotice: () => void;

  redactedStravaCount: number;
  connectionStatus: ConnectionStatus;
  dismissedStravaBanner: boolean;
  onLaunchStravaOAuth: (mode: 'cloud' | 'local') => void;
  onDismissStravaBanner: () => void;

  isSampleDemoMode: boolean;
  onExitSampleDemo: (connectStrava?: boolean) => void;

  dismissedQuickConnectBanner: boolean;
  onDismissQuickConnectBanner: () => void;

  myTeamsCount?: number;
  isCoachMode?: boolean;
  athleteProfile?: AthleteProfile;
  distanceUnit?: DistanceUnit;
  onOpenProfileModal?: () => void;
  onOpenPlanBuilder?: () => void;
  onExploreFitness?: () => void;
}

export const CockpitStageBanners: React.FC<CockpitStageBannersProps> = ({
  pendingUrlJoinOffer,
  onAcceptJoinOffer,
  onDismissJoinOffer,
  isSyncing,
  activitiesCount,
  onOpenDataSources,
  activeConnectedAthlete,
  shieldedConnectedTelemetry,
  onOpenRosterModal,
  onReturnToMyProfile,
  readOnlyNotice,
  onDismissReadOnlyNotice,
  redactedStravaCount,
  connectionStatus,
  dismissedStravaBanner,
  onLaunchStravaOAuth,
  onDismissStravaBanner,
  isSampleDemoMode,
  onExitSampleDemo,
  dismissedQuickConnectBanner,
  onDismissQuickConnectBanner,
  myTeamsCount = 0,
  isCoachMode = false,
  athleteProfile,
  distanceUnit = 'mi',
  onOpenProfileModal,
  onOpenPlanBuilder,
  onExploreFitness,
}) => {
  const [dismissedWelcomeFork, setDismissedWelcomeFork] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('thresh_dismiss_welcome_fork_v1') === '1';
    } catch {
      return false;
    }
  });

  const dismissWelcomeFork = () => {
    setDismissedWelcomeFork(true);
    try {
      window.localStorage.setItem('thresh_dismiss_welcome_fork_v1', '1');
    } catch {
      // ignore storage failure
    }
  };

  const activeBannerSlot = readOnlyNotice
    ? 'READ_ONLY'
    : activeConnectedAthlete
      ? 'CONNECTED_ATHLETE'
      : pendingUrlJoinOffer
        ? 'JOIN_OFFER'
        : isSampleDemoMode
          ? 'SAMPLE_DEMO'
          : isSyncing
            ? 'SYNCING'
            : redactedStravaCount > 0 &&
                !connectionStatus.stravaConnected &&
                !dismissedStravaBanner
              ? 'STRAVA_UNLOCK'
              : !isSampleDemoMode &&
                  !connectionStatus.stravaConnected &&
                  !connectionStatus.garminConnected &&
                  !connectionStatus.intervalsConnected &&
                  activitiesCount === 0 &&
                  !isSyncing &&
                  !dismissedQuickConnectBanner &&
                  myTeamsCount === 0 &&
                  !isCoachMode
                ? 'QUICK_CONNECT'
                : !isSampleDemoMode &&
                    connectionStatus.stravaConnected &&
                    activitiesCount > 0 &&
                    !isSyncing &&
                    !isCoachMode &&
                    !dismissedWelcomeFork
                  ? 'WELCOME_FORK'
                  : null;

  return (
    <>
      {/* Multi-Team Magic Join Offer Banner */}
      {activeBannerSlot === 'JOIN_OFFER' && pendingUrlJoinOffer && (
        <div className="rounded-2xl liquid-glass border-lime-600/35 dark:border-[#C8FF00]/35 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded-md font-mono uppercase text-2xs font-bold ap-badge-volt">
              Team Invite
            </span>
            <span className="font-bold text-slate-900 dark:text-white text-sm">
              Join {pendingUrlJoinOffer.teamName} and add it to your Team Switcher?
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onAcceptJoinOffer}
              className="ap-btn-primary text-xs cursor-pointer"
            >
              Accept &amp; Join {pendingUrlJoinOffer.shortName}
            </button>
            <button
              type="button"
              onClick={onDismissJoinOffer}
              className="ap-btn-secondary text-xs cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Non-blocking Background Strava History Sync Progress Bar */}
      {activeBannerSlot === 'SYNCING' && isSyncing && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl liquid-glass border-[#FC4C02]/35 px-4 py-3 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-[#FC4C02]/15 border border-[#FC4C02]/40 flex items-center justify-center text-[#FC4C02] shrink-0">
              <RefreshCw className="w-4 h-4 animate-spin" />
            </div>
            <div className="text-xs min-w-0">
              <div className="font-bold text-slate-900 dark:text-white">
                Syncing your selected training window in the background…
              </div>
              <div className="text-2xs text-slate-600 dark:text-slate-300">
                {activitiesCount > 0
                  ? `${activitiesCount.toLocaleString()} workouts loaded so far. You can explore THRESH while this finishes.`
                  : 'Importing workouts, routes, and gear mileage. You can explore THRESH while this finishes.'}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenDataSources}
              className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-xl liquid-glass-subtle hover:border-[#28573B] text-slate-800 dark:text-slate-100 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Database className="w-3.5 h-3.5 text-emerald-500" />
              <span>Sync Settings &amp; Optional Sources</span>
            </button>
          </div>
        </div>
      )}

      {/* Active Friend / Coached Athlete Context Banner */}
      {activeBannerSlot === 'CONNECTED_ATHLETE' && activeConnectedAthlete && (
        <div className="rounded-2xl liquid-glass border-sky-500/40 p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-sky-500/20 border border-sky-500/50 flex items-center justify-center font-mono font-bold text-sm text-sky-300">
              {activeConnectedAthlete.avatarInitials}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-slate-900 dark:text-white">
                  Viewing {activeConnectedAthlete.name}
                </span>
                {activeConnectedAthlete.role === 'COACH_EDIT' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-2xs font-mono uppercase bg-orange-500/15 text-orange-400 border border-orange-500/40">
                    <CalendarPlus className="w-3 h-3" />
                    Coach Access (Calendar Edit Enabled)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-2xs font-mono uppercase bg-sky-500/15 text-sky-400 border border-sky-500/40">
                    <Eye className="w-3 h-3" />
                    Friend Access (Read-Only View)
                  </span>
                )}
                {(shieldedConnectedTelemetry?.redactedWellness ||
                  shieldedConnectedTelemetry?.redactedGpsRoutes) && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-2xs font-mono uppercase bg-amber-500/15 text-amber-400 border border-amber-500/40">
                    <Lock className="w-3 h-3" />
                    Privacy Shield Active (HRV/GPS Masked for Friends)
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 font-mono">
                {activeConnectedAthlete.location} • Strava #{activeConnectedAthlete.stravaAthleteId} • Goal:{' '}
                <span className="text-sky-400 font-semibold">
                  {activeConnectedAthlete.primaryGoalSummary}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpenRosterModal}
              className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 text-xs font-mono text-sky-300 flex items-center gap-1.5 cursor-pointer"
            >
              <Shield className="w-3.5 h-3.5" />
              <span>Manage Roster &amp; Coach Push</span>
            </button>
            <button
              type="button"
              onClick={onReturnToMyProfile}
              className="ap-btn-primary min-h-[44px] sm:min-h-[36px] px-3 py-1.5 text-xs font-mono cursor-pointer"
            >
              Return to My Profile
            </button>
          </div>
        </div>
      )}

      {activeBannerSlot === 'READ_ONLY' && readOnlyNotice && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl liquid-glass border-amber-500/50 bg-amber-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-700 dark:text-amber-300 font-medium"
        >
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-500 shrink-0" />
            <span>{readOnlyNotice}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenRosterModal}
              className="min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-2xs font-mono font-semibold cursor-pointer"
            >
              Open Roster Roles
            </button>
            <button
              type="button"
              onClick={onDismissReadOnlyNotice}
              className="min-h-[44px] sm:min-h-[32px] px-2 py-1 rounded-lg hover:bg-white/10 text-2xs font-mono cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {activeBannerSlot === 'STRAVA_UNLOCK' &&
        redactedStravaCount > 0 &&
        !connectionStatus.stravaConnected &&
        !dismissedStravaBanner && (
          <div className="rounded-2xl liquid-glass border-amber-500/35 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-700 dark:text-slate-200">
              <span className="font-bold text-amber-700 dark:text-amber-400">
                Unlock {redactedStravaCount.toLocaleString()} Strava workouts:
              </span>{' '}
              Connect Strava directly to load full GPS route maps, splits, and segment PRs.
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onLaunchStravaOAuth('cloud')}
                className="ap-btn-strava !min-h-[44px] sm:!min-h-[34px] px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer"
              >
                Connect with Strava
              </button>
              <button
                type="button"
                onClick={onOpenDataSources}
                className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-xl liquid-glass-subtle text-slate-700 dark:text-slate-200 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                Data Sources
              </button>
              <button
                type="button"
                aria-label="Dismiss Strava unlock notice"
                onClick={onDismissStravaBanner}
                className="min-h-[44px] min-w-[44px] sm:min-h-[34px] sm:min-w-[34px] px-2 py-1 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 text-xs font-medium transition-colors cursor-pointer"
                title="Dismiss notice"
              >
                ✕
              </button>
            </div>
          </div>
        )}

      {activeBannerSlot === 'SAMPLE_DEMO' && isSampleDemoMode && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl liquid-glass-subtle border-[#28573B]/35 dark:border-[#25573A] px-3 py-2 flex flex-wrap items-center justify-between gap-2"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#35463B] dark:text-slate-200 min-w-0">
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-2xs font-mono font-semibold uppercase tracking-wider bg-[#E3ECE5] text-[#1C5436] dark:bg-[#15231B] dark:text-[#C8FF00] shrink-0">
              Sample Demo
            </span>
            <span className="hidden sm:inline">
              Illustrative athlete &amp; coach telemetry — nothing is saved to your device or Strava.
            </span>
            <span className="sm:hidden text-2xs">
              Illustrative sample data — nothing saved.
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onExitSampleDemo(true)}
              className="ap-btn-strava !min-h-[44px] sm:!min-h-[32px] px-3 py-1 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer"
            >
              Connect with Strava
            </button>
            <button
              type="button"
              onClick={() => onExitSampleDemo(false)}
              className="ap-btn-secondary !min-h-[44px] sm:!min-h-[32px] px-2.5 py-1 text-xs font-semibold whitespace-nowrap cursor-pointer"
            >
              Exit Demo
            </button>
          </div>
        </div>
      )}

      {activeBannerSlot === 'QUICK_CONNECT' && (
          <div className="rounded-2xl liquid-glass border-[#28573B]/35 dark:border-[#25573A] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-700 dark:text-slate-200 max-w-xl">
              <span className="font-bold ap-text-brand">Connect your training data:</span>{' '}
              Sign in with Strava for automatic run &amp; ride sync, or connect Garmin Connect / Intervals.icu for daily HRV &amp; sleep readiness.
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onLaunchStravaOAuth('cloud')}
                className="ap-btn-strava !min-h-[44px] sm:!min-h-[34px] px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer"
              >
                Connect with Strava
              </button>
              <button
                type="button"
                onClick={onOpenDataSources}
                className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-xl liquid-glass-subtle hover:border-[#28573B] text-slate-800 dark:text-slate-100 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                Garmin / Intervals.icu
              </button>
              <button
                type="button"
                aria-label="Dismiss connect training data notice"
                onClick={onDismissQuickConnectBanner}
                className="min-h-[44px] min-w-[44px] sm:min-h-[34px] sm:min-w-[34px] px-2 py-1 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 text-xs font-medium transition-colors cursor-pointer"
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        )}

      {activeBannerSlot === 'WELCOME_FORK' && (
        <section
          data-testid="post-login-welcome-launchpad"
          aria-label="Post-login quick start"
          className="rounded-2xl liquid-glass border-[#28573B]/35 dark:border-[#C8FF00]/30 px-4 py-3 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-[#E3ECE5] dark:bg-[#15231B] flex items-center justify-center text-[#1C5436] dark:text-[#C8FF00] shrink-0 mt-0.5">
              <Sparkles className="w-4 h-4" weight="duotone" />
            </div>
            <div className="min-w-0 space-y-0.5 text-xs">
              <div className="font-bold text-slate-900 dark:text-white flex flex-wrap items-center gap-1.5">
                <span>
                  Synced {activitiesCount.toLocaleString()} Strava workouts
                </span>
                {athleteProfile && (
                  <span className="font-mono text-2xs px-2 py-0.5 rounded-md bg-[#E3ECE5] text-[#1C5436] dark:bg-[#15231B] dark:text-[#C8FF00]">
                    {athleteProfile.primarySport === 'Running'
                      ? `Running · LT ${formatPace(athleteProfile.thresholdPaceSecsPerKm || 250, distanceUnit)}`
                      : `Cycling · FTP ${athleteProfile.ftp}W`}
                  </span>
                )}
                {onOpenProfileModal && (
                  <button
                    type="button"
                    onClick={onOpenProfileModal}
                    className="text-2xs font-semibold underline text-[#1C5436] dark:text-[#C8FF00] cursor-pointer"
                  >
                    Edit Zones
                  </button>
                )}
              </div>
              <p className="text-2xs text-slate-600 dark:text-slate-300">
                Choose your next step: review readiness &amp; trends below, or build a custom workout or goal training block.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                onExploreFitness?.();
                window.setTimeout(() => {
                  const target =
                    document.getElementById('today-pmc-anchor') ||
                    document.getElementById('fitness-sec-pmc') ||
                    document.querySelector('[data-testid="today-physiology-deep-dive"]');
                  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 60);
              }}
              className="ap-btn-secondary !min-h-[44px] sm:!min-h-[34px] px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Explore My Fitness</span>
            </button>
            <button
              type="button"
              data-testid="welcome-open-plan-builder-btn"
              onClick={() => onOpenPlanBuilder?.()}
              className="ap-btn-primary !min-h-[44px] sm:!min-h-[34px] px-3.5 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Target className="w-3.5 h-3.5" />
              <span>Build a Workout or Plan</span>
            </button>
            <button
              type="button"
              aria-label="Dismiss welcome quick start"
              onClick={dismissWelcomeFork}
              className="min-h-[44px] min-w-[44px] sm:min-h-[34px] sm:min-w-[34px] flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </section>
      )}
    </>
  );
};
