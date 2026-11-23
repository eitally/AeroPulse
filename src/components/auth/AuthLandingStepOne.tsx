import React, { useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Moon,
  RefreshCw,
  Sun,
} from '../icons/PhosphorIcons';
import type { TeamInvitePreviewPayload } from '../../types';
import { computeAccessibleTeamPalette } from '../../physiology/teamOnboardingEngine';
import { applyTeamBrandToDocument } from '../../utils/teamBrandDom';
import {
  clearPendingSharedWorkout,
  peekPendingSharedWorkout,
} from '../../utils/shareWorkoutEngine';
import { AeroPulseLogo } from '../AeroPulseLogo';
import type { StravaOAuthJoinContext } from '../StravaAuthGate';
import { AuthByoStravaKeysSection } from './AuthByoStravaKeysSection';
import {
  GoogleGIcon,
  PENDING_TEAM_JOIN_STORAGE_KEY,
  StravaChevronMark,
  detectEmbeddedWebView,
} from './authGateShared';

export interface AuthLandingStepOneProps {
  formId: string;
  initialEmail?: string;
  activeBrand?: NonNullable<TeamInvitePreviewPayload['brand']> | null;
  invitePreview: TeamInvitePreviewPayload | null;
  onboardingRole: 'ATHLETE' | 'COACH';
  selectOnboardingRole: (nextRole: 'ATHLETE' | 'COACH') => void;
  currentJoinContext?: StravaOAuthJoinContext;
  showTeamCodeDrawer: boolean;
  setShowTeamCodeDrawer: React.Dispatch<React.SetStateAction<boolean>>;
  joinCodeInput: string;
  setJoinCodeInput: React.Dispatch<React.SetStateAction<string>>;
  joinSlug?: string;
  setJoinSlug: React.Dispatch<React.SetStateAction<string | undefined>>;
  inviteToken: string;
  setInviteToken: React.Dispatch<React.SetStateAction<string>>;
  setInvitePreview: React.Dispatch<React.SetStateAction<TeamInvitePreviewPayload | null>>;
  isLoadingPreview: boolean;
  lookupTeamPreview: (
    codeOrSlug: string,
    token?: string,
    explicitSlug?: string,
    overrideEmail?: string
  ) => Promise<void>;
  errorMessage: string | null;
  joinError: string | null;
  setJoinError: React.Dispatch<React.SetStateAction<string | null>>;
  stepNotice: string | null;
  setStepNotice: React.Dispatch<React.SetStateAction<string | null>>;
  isDark: boolean;
  onToggleDark?: () => void;
  onEnterSampleDemo?: (preferredRole?: 'ATHLETE' | 'COACH') => void;
  onOpenBrandStudio?: () => void;
  onOpenCoppaModal: () => void;
  busy: boolean;
  isRedirecting: boolean;
  setIsExchanging: (val: boolean) => void;
  handleStravaLaunchClick: (
    oauthMode?: 'cloud' | 'localhost',
    forcePrompt?: boolean
  ) => Promise<void>;
  showByoStravaSection: boolean;
  showCustomStravaKeys: boolean;
  setShowCustomStravaKeys: React.Dispatch<React.SetStateAction<boolean>>;
  currentHostname: string;
  stravaClientId: string;
  setStravaClientId: (val: string) => void;
  stravaClientSecret: string;
  setStravaClientSecret: (val: string) => void;
  savedStravaClientId?: string;
  handleSaveKeysAndLaunchStrava: (e: React.FormEvent) => Promise<void>;
  onExchangeStravaCode?: (codeOrUrl: string) => Promise<void>;
  onSaveStravaDirectToken?: (refreshToken: string, accessToken?: string) => Promise<void>;
}

export const AuthLandingStepOne: React.FC<AuthLandingStepOneProps> = ({
  formId,
  initialEmail = '',
  activeBrand,
  invitePreview,
  onboardingRole,
  selectOnboardingRole,
  currentJoinContext,
  showTeamCodeDrawer,
  setShowTeamCodeDrawer,
  joinCodeInput,
  setJoinCodeInput,
  joinSlug,
  setJoinSlug,
  inviteToken,
  setInviteToken,
  setInvitePreview,
  isLoadingPreview,
  lookupTeamPreview,
  errorMessage,
  joinError,
  setJoinError,
  stepNotice,
  setStepNotice,
  isDark,
  onToggleDark,
  onEnterSampleDemo,
  onOpenBrandStudio,
  onOpenCoppaModal,
  busy,
  isRedirecting,
  setIsExchanging,
  handleStravaLaunchClick,
  showByoStravaSection,
  showCustomStravaKeys,
  setShowCustomStravaKeys,
  currentHostname,
  stravaClientId,
  setStravaClientId,
  stravaClientSecret,
  setStravaClientSecret,
  savedStravaClientId,
  handleSaveKeysAndLaunchStrava,
  onExchangeStravaCode,
  onSaveStravaDirectToken,
}) => {
  const isEmbeddedWebView = useMemo(() => detectEmbeddedWebView(), []);
  const teamCodeInputRef = useRef<HTMLInputElement | null>(null);
  const [magicLinkEmail, setMagicLinkEmail] = useState(initialEmail);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [magicLinkDevUrl, setMagicLinkDevUrl] = useState<string | null>(null);
  const [isSendingMagicLink, setIsSendingMagicLink] = useState(false);
  const [isGoogleRedirecting, setIsGoogleRedirecting] = useState(false);
  const [heroPreviewTab, setHeroPreviewTab] = useState<'stopwatch' | 'pods'>('stopwatch');
  const [pendingSharedWorkout, setPendingSharedWorkout] = useState(() =>
    peekPendingSharedWorkout()
  );

  const isTeamCodeDrawerOpen = Boolean(showTeamCodeDrawer || activeBrand);
  const step1Busy = busy || isSendingMagicLink || isGoogleRedirecting;
  const isSlateVariant =
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('ap-midnight-slate');

  const handleOpenTeamCodeDrawer = (alwaysOpen = false, shouldFocus = false) => {
    setShowTeamCodeDrawer((prev) => (alwaysOpen ? true : !prev));
    if (shouldFocus && typeof window !== 'undefined') {
      window.setTimeout(() => {
        teamCodeInputRef.current?.focus();
      }, 30);
    }
  };

  const handleGoogleSignIn = async () => {
    selectOnboardingRole(onboardingRole);
    setIsGoogleRedirecting(true);
    setStepNotice(null);
    setJoinError(null);
    try {
      localStorage.removeItem('aeropulse_logged_out');
    } catch {
      // ignore
    }
    try {
      const qs = new URLSearchParams();
      if (currentJoinContext?.joinCode) qs.set('joinCode', currentJoinContext.joinCode);
      if (currentJoinContext?.slug) qs.set('slug', currentJoinContext.slug);
      if (currentJoinContext?.inviteToken) qs.set('inviteToken', currentJoinContext.inviteToken);
      const query = qs.toString();
      const res = await fetch(`/api/auth/google/url${query ? `?${query}` : ''}`, {
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      const targetUrl = data.url || data.authUrl;
      const devMockTarget = data.devMockUrl || data.devMockLoginUrl;
      if (res.ok && data.configured && targetUrl) {
        window.location.href = targetUrl;
        return;
      }
      if (res.ok && !data.configured && devMockTarget) {
        window.location.href = devMockTarget;
        return;
      }
      setJoinError(data.error || data.message || 'Google sign-in is not configured on this server.');
    } catch {
      setJoinError('Failed to initialize Google sign-in.');
    } finally {
      setIsGoogleRedirecting(false);
    }
  };

  const handleSendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    selectOnboardingRole(onboardingRole);
    const cleanEmail = magicLinkEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setJoinError('Please enter a valid email address.');
      return;
    }
    setIsSendingMagicLink(true);
    setJoinError(null);
    setMagicLinkDevUrl(null);
    try {
      const res = await fetch('/api/auth/magic-link/send', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          joinCode: joinCodeInput.trim() || undefined,
          slug: joinSlug || invitePreview?.brand?.slug || undefined,
          inviteToken: inviteToken || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setMagicLinkSent(true);
        if (data.devMode && data.previewUrl) {
          setMagicLinkDevUrl(data.previewUrl);
        }
      } else {
        setJoinError(data.error || 'Could not send sign-in link.');
      }
    } catch {
      setJoinError('Failed sending sign-in link. Please check your connection.');
    } finally {
      setIsSendingMagicLink(false);
    }
  };

  return (
    <div className="max-w-[1320px] w-full mx-auto px-3 sm:px-8 pt-3 sm:pt-4 pb-5 flex-1 flex flex-col">
      {/* Editorial Hairline Header — Single Schools & ADs link */}
      <header className="flex items-center justify-between gap-2 pb-3.5 mb-5 sm:mb-7 border-b border-ap-frame dark:border-white/20">
        <a
          href="#top"
          onClick={(e) => e.preventDefault()}
          className="inline-flex items-center shrink-0 min-w-0"
          aria-label="MeetReady Home"
        >
          <span className="sm:hidden">
            <AeroPulseLogo size="sm" teamBrand={activeBrand} />
          </span>
          <span className="hidden sm:inline-flex">
            <AeroPulseLogo size="md" teamBrand={activeBrand} />
          </span>
        </a>

        <nav className="flex items-center gap-1 sm:gap-3" aria-label="Primary actions">
          {onToggleDark && (
            <button
              type="button"
              onClick={onToggleDark}
              aria-label="Toggle color theme"
              className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] px-2 rounded-full border border-ap-frame/25 dark:border-white/25 hover:bg-ap-inset dark:hover:bg-ap-carbon text-ap-ink dark:text-ap-chalk inline-flex items-center justify-center cursor-pointer transition-colors"
              title={
                isDark
                  ? 'Switch to Stadium Chalk Light'
                  : isSlateVariant
                    ? 'Switch to Midnight Slate'
                    : 'Switch to Track Asphalt Dark'
              }
            >
              {isDark ? (
                <Sun className="w-4 h-4 text-[#D8FF2A]" weight="fill" />
              ) : (
                <Moon className="w-4 h-4 text-ap-ink dark:text-ap-chalk" weight="fill" />
              )}
            </button>
          )}

          <button
            type="button"
            data-testid="header-team-code-btn"
            onClick={() => handleOpenTeamCodeDrawer(false, true)}
            aria-expanded={isTeamCodeDrawerOpen}
            className={`min-h-[44px] sm:min-h-[36px] px-2 sm:px-4 rounded-full text-2xs sm:text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
              activeBrand
                ? 'ap-nav-volt-active'
                : 'border border-ap-frame dark:border-white/30 bg-ap-chalk dark:bg-ap-carbon text-ap-ink dark:text-ap-chalk hover:bg-ap-inset dark:hover:bg-ap-turf'
            }`}
          >
            <span>{activeBrand ? activeBrand.shortName : 'Team Code'}</span>
          </button>

          <a
            href="/for-athletic-directors"
            className="inline-flex min-h-[44px] sm:min-h-[36px] px-1 sm:px-2 items-center text-2xs sm:text-sm font-semibold whitespace-nowrap text-ap-ink dark:text-ap-chalk hover:text-ap-clay dark:hover:text-ap-volt transition-colors"
          >
            Schools &amp; ADs
          </a>

          {onEnterSampleDemo && (
            <button
              type="button"
              onClick={() => onEnterSampleDemo('COACH')}
              className="hidden md:inline-flex min-h-[36px] px-1 items-center text-sm font-semibold text-ap-ink dark:text-ap-chalk underline underline-offset-4 hover:opacity-75 cursor-pointer"
            >
              Explore Coach Sample
            </button>
          )}
        </nav>
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1 space-y-4 focus:outline-none">
        {(errorMessage || joinError) && (
          <div
            role="alert"
            className="ap-status-strained rounded-xl p-3.5 text-xs leading-relaxed break-words"
          >
            {joinError || errorMessage}
          </div>
        )}

        {stepNotice && (
          <div
            role="status"
            aria-live="polite"
            className="ap-status-prime rounded-xl p-3 text-xs font-medium flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{stepNotice}</span>
          </div>
        )}

        {pendingSharedWorkout && (
          <div
            data-testid="pending-shared-workout-banner"
            className="rounded-xl ap-status-prime px-4 py-3 flex items-center justify-between gap-3 text-xs"
          >
            <div className="min-w-0">
              <div className="font-bold text-ap-ink dark:text-white truncate">
                Saved for your calendar: {pendingSharedWorkout.title}
              </div>
              <div className="text-xs text-ap-ink/85 dark:text-ap-chalk/85">
                Sign in (or explore the interactive sample) to add this{' '}
                {pendingSharedWorkout.sport} workout straight to your MeetReady Calendar.
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                clearPendingSharedWorkout();
                setPendingSharedWorkout(null);
              }}
              className="min-h-[36px] px-2.5 rounded-lg ap-btn-secondary text-xs font-semibold shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {isEmbeddedWebView && (
          <div className="ap-status-caution rounded-xl p-3 text-xs leading-relaxed">
            <strong>Tip for iMessage / Band / Instagram links:</strong> External Google &amp;
            Strava sign-in is often blocked inside in-app browsers. Tap{' '}
            <strong>⋯</strong> or <strong>Share → Open in Safari / Chrome</strong>, or sign in
            with an instant Email Link below.
          </div>
        )}

        {/* Comp 1: Split Manifesto (60/38 Top Split + Overlapping Specimen Dock + Ruled Ledger) */}
        <div className="flex flex-col lg:grid lg:grid-cols-12 gap-5 lg:gap-x-7 lg:gap-y-0 items-start">
          {/* Row 1 Left: Committed Mondo Clay Track Hero */}
          <section
            aria-label="MeetReady Track, Field and Cross Country Overview"
            className="order-1 lg:col-span-7 xl:col-span-8 lg:col-start-1 lg:row-start-1 lg:self-stretch w-full rounded-xl bg-[#B83A24] dark:bg-[#9E2E1A] text-[#F6F3EC] relative overflow-hidden px-6 py-6 sm:px-9 sm:pt-8 lg:pb-24"
          >
            {/* Decorative Oval Track Banking Geometry */}
            <svg
              viewBox="0 0 600 400"
              fill="none"
              aria-hidden="true"
              className="pointer-events-none select-none absolute -right-24 sm:-right-12 -top-8 w-[420px] sm:w-[540px] h-auto opacity-15 sm:opacity-30"
            >
              <path
                d="M 600 310 H 250 A 135 135 0 0 1 250 40 H 600"
                stroke="#F6F3EC"
                strokeWidth="2"
              />
              <path
                d="M 600 340 H 250 A 165 165 0 0 1 250 10 H 600"
                stroke="#F6F3EC"
                strokeWidth="2"
              />
              <path
                d="M 600 370 H 250 A 195 195 0 0 1 250 -20 H 600"
                stroke="#F6F3EC"
                strokeWidth="2"
              />
              <path
                d="M 600 400 H 250 A 225 225 0 0 1 250 -50 H 600"
                stroke="#F6F3EC"
                strokeWidth="2"
              />
            </svg>

            <div className="relative z-10 space-y-4">
              <h1 className="font-display font-extrabold uppercase tracking-[-0.015em] leading-[0.94] text-4xl sm:text-5xl xl:text-6xl text-[#F6F3EC]">
                {activeBrand ? (
                  `Join ${activeBrand.name} on MeetReady`
                ) : (
                  <>
                    Every event. Every mark.
                    <br />
                    One team platform.
                  </>
                )}
              </h1>

              {activeBrand && (
                <div>
                  <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-[#121413]/30 border border-[#F6F3EC]/30 font-mono text-xs font-bold uppercase tracking-wider text-[#F6F3EC]">
                    {`Team Roster Invite · ${activeBrand.joinCode}`}
                  </span>
                </div>
              )}

              <p className="font-sans text-sm sm:text-base leading-relaxed text-[#F6F3EC]/92 max-w-[56ch]">
                {activeBrand
                  ? `Sign in to verify your identity for Coach ${activeBrand.coachDisplayName}'s roster. You'll finish team setup on the next screen.`
                  : 'Capture offline splits, log jumps, throws and vaults on the field sheet, auto-scale distance pace pods, and protect U18 athletes with built-in SafeSport & FERPA guardrails.'}
              </p>

              {!activeBrand && (
                <div
                  data-testid="hero-trust-strip"
                  className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-1 text-2xs sm:text-xs font-semibold text-[#F6F3EC]/92"
                >
                  <span className="text-[#F6F3EC] font-bold">Free Founding Season ($0)</span>
                  <span aria-hidden="true">·</span>
                  <span>Students &amp; Parents $0 Forever</span>
                  <span aria-hidden="true">·</span>
                  <span>FERPA / COPPA / SafeSport</span>
                  <span aria-hidden="true">·</span>
                  <span>Works Offline</span>
                </div>
              )}

              {onEnterSampleDemo && (
                <div className="flex md:hidden flex-wrap items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => onEnterSampleDemo('COACH')}
                    className="min-h-[44px] px-4 py-2 rounded-full bg-ap-volt hover:bg-[#c8ef1e] text-[#121413] font-extrabold text-xs inline-flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <span>Explore Coach Sample →</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onEnterSampleDemo('ATHLETE')}
                    className="min-h-[44px] px-3.5 py-2 rounded-full border border-[#F6F3EC]/45 text-[#F6F3EC] font-semibold text-xs inline-flex items-center cursor-pointer hover:bg-white/10 transition-colors"
                  >
                    Try Athlete View
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Row 1 Right: Start Your Free Team Pilot Auth Card */}
          <aside
            aria-label="Sign in or get started"
            data-testid="homepage-auth-card"
            className="order-2 lg:col-span-5 xl:col-span-4 lg:col-start-8 xl:col-start-9 lg:row-start-1 lg:self-stretch flex flex-col justify-between w-full bg-ap-chalk dark:bg-ap-carbon border-[1.5px] border-ap-frame dark:border-white/25 rounded-xl p-5 lg:py-3.5 lg:px-5 space-y-2.5 lg:space-y-1.5"
          >
            <h2 className="font-sans text-xl lg:text-xl sm:text-2xl font-extrabold tracking-tight text-center text-ap-ink dark:text-ap-chalk">
              {activeBrand
                ? `Join ${activeBrand.name}`
                : onboardingRole === 'COACH'
                  ? 'Start Your Free Team Pilot'
                  : 'Join Team or Start Free'}
            </h2>

            {!activeBrand && (
              <div className="space-y-2">
                <div
                  role="group"
                  aria-label="Choose your MeetReady role"
                  className="grid grid-cols-2 gap-1 p-1 rounded-full border border-ap-frame dark:border-white/25 bg-ap-chalk dark:bg-ap-obsidian"
                >
                  <button
                    type="button"
                    data-testid="onboarding-role-coach"
                    aria-pressed={onboardingRole === 'COACH'}
                    onClick={() => selectOnboardingRole('COACH')}
                    className={`min-h-[44px] lg:min-h-[36px] px-3 rounded-full text-xs sm:text-sm font-bold cursor-pointer transition-colors ${
                      onboardingRole === 'COACH'
                        ? 'bg-ap-ink text-ap-chalk dark:bg-ap-chalk dark:text-ap-obsidian'
                        : 'text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-white'
                    }`}
                  >
                    Coach
                  </button>
                  <button
                    type="button"
                    data-testid="onboarding-role-athlete"
                    aria-pressed={onboardingRole === 'ATHLETE'}
                    onClick={() => selectOnboardingRole('ATHLETE')}
                    className={`min-h-[44px] lg:min-h-[36px] px-3 rounded-full text-xs sm:text-sm font-bold cursor-pointer transition-colors ${
                      onboardingRole === 'ATHLETE'
                        ? 'bg-ap-ink text-ap-chalk dark:bg-ap-chalk dark:text-ap-obsidian'
                        : 'text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-white'
                    }`}
                  >
                    Athlete
                  </button>
                </div>
                <p
                  data-testid="homepage-role-helper"
                  className="text-2xs sm:text-xs leading-tight text-center text-ap-muted dark:text-ap-muted-dark"
                >
                  {onboardingRole === 'COACH'
                    ? 'First visit? Sign in below to create your account and start Team Setup.'
                    : 'First visit? Sign in below to sync workouts or join your team.'}
                </p>
              </div>
            )}

            {activeBrand &&
              (() => {
                const bannerPalette = computeAccessibleTeamPalette(
                  activeBrand.primaryHex,
                  activeBrand.secondaryHex
                );
                return (
                  <div
                    className="rounded-xl p-3 space-y-1"
                    style={{
                      background: `linear-gradient(135deg, ${bannerPalette.primaryOnLight} 0%, ${bannerPalette.secondaryOnLight} 100%)`,
                      color: bannerPalette.textOnPrimaryLight,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs font-mono uppercase tracking-wider opacity-95">
                      <span>
                        {invitePreview?.membership?.squadGroup || 'Squad Roster'} ·{' '}
                        {activeBrand.joinCode}
                      </span>
                      <span>Coach {activeBrand.coachDisplayName}</span>
                    </div>
                    <div className="text-sm font-bold flex items-center justify-between gap-2">
                      <span>
                        {invitePreview?.membership?.invitedName
                          ? `Spot reserved for ${invitePreview.membership.invitedName}`
                          : `Ready to join ${activeBrand.name}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setJoinCodeInput('');
                          setJoinSlug(undefined);
                          setInviteToken('');
                          setInvitePreview(null);
                          applyTeamBrandToDocument(null);
                          try {
                            sessionStorage.removeItem(PENDING_TEAM_JOIN_STORAGE_KEY);
                          } catch {
                            // ignore
                          }
                        }}
                        className="text-xs font-mono underline opacity-90 hover:opacity-100 cursor-pointer"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                );
              })()}

            {isTeamCodeDrawerOpen && (
              <div
                data-testid="homepage-drawer-teamcode"
                className="rounded-xl ap-card-inset p-3 space-y-1.5"
              >
                <div className="flex gap-2">
                  <input
                    ref={teamCodeInputRef}
                    type="text"
                    value={joinCodeInput}
                    aria-label="Enter 6-character Team Join Code"
                    onChange={(e) => {
                      setJoinCodeInput(e.target.value.toUpperCase());
                      setJoinSlug(undefined);
                      setInviteToken('');
                    }}
                    placeholder="e.g. WGXC-26"
                    className="flex-1 min-w-0 min-h-[44px] rounded-lg bg-white dark:bg-ap-obsidian border border-ap-frame dark:border-white/25 px-3 text-sm font-mono font-bold uppercase placeholder:normal-case tracking-wider text-ap-ink dark:text-ap-chalk placeholder:text-ap-muted/70 dark:placeholder:text-ap-muted-dark/70 focus:outline-none focus:ring-2 focus:ring-ap-clay dark:focus:ring-ap-volt"
                  />
                  <button
                    type="button"
                    disabled={isLoadingPreview}
                    onClick={() => {
                      if (!joinCodeInput.trim()) {
                        setJoinError(
                          'Enter a 6-character Team Join Code from your coach (e.g. WGXC-26).'
                        );
                        teamCodeInputRef.current?.focus();
                        return;
                      }
                      void lookupTeamPreview(joinCodeInput, inviteToken);
                    }}
                    className="min-h-[44px] px-3.5 rounded-lg bg-ap-volt hover:brightness-95 text-ap-obsidian font-extrabold text-xs shrink-0 cursor-pointer transition-all"
                  >
                    {isLoadingPreview ? 'Checking…' : 'Join Squad'}
                  </button>
                </div>
              </div>
            )}

            {/* Always-Visible Unified Email Entry */}
            <form onSubmit={handleSendMagicLink} className="space-y-2 lg:space-y-1.5">
              <label
                htmlFor={`${formId}-splash-email`}
                className="block text-xs font-bold text-ap-ink dark:text-ap-chalk"
              >
                Email
              </label>
              <input
                id={`${formId}-splash-email`}
                type="email"
                required
                value={magicLinkEmail}
                onChange={(e) => {
                  setMagicLinkEmail(e.target.value);
                  setMagicLinkSent(false);
                }}
                placeholder={
                  onboardingRole === 'COACH' && !activeBrand
                    ? 'coach@school.edu'
                    : 'athlete@school.edu'
                }
                aria-label="Email address"
                className="w-full min-h-[44px] lg:min-h-[38px] rounded-lg bg-white dark:bg-ap-obsidian border border-ap-frame dark:border-white/30 px-3.5 text-sm font-medium text-ap-ink dark:text-ap-chalk placeholder:text-ap-muted/70 dark:placeholder:text-ap-muted-dark/70 focus:outline-none focus:ring-2 focus:ring-ap-clay dark:focus:ring-ap-volt"
              />
              <button
                type="submit"
                data-testid="continue-with-email-btn"
                disabled={step1Busy}
                className="w-full min-h-[44px] lg:min-h-[38px] px-4 rounded-full bg-ap-volt hover:bg-[#c8ef1e] text-ap-obsidian font-extrabold text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 transition-colors"
              >
                {isSendingMagicLink && <RefreshCw className="w-4 h-4 animate-spin" />}
                <span>{isSendingMagicLink ? 'Sending Sign-In Link…' : 'Continue with Email'}</span>
              </button>

              {magicLinkSent && (
                <div className="rounded-xl ap-status-prime p-3 text-xs space-y-1.5">
                  <div className="flex items-center gap-2 font-bold">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Check your inbox for a secure sign-in link!</span>
                  </div>
                  <p className="text-xs opacity-90">
                    Sent a 15-minute link to <strong>{magicLinkEmail}</strong>.
                  </p>
                  {magicLinkDevUrl && (
                    <div className="pt-1">
                      <span className="font-mono text-xs uppercase tracking-wider opacity-80 mr-2">
                        Dev Link:
                      </span>
                      <a
                        href={magicLinkDevUrl}
                        className="text-xs font-bold underline hover:opacity-80"
                      >
                        Complete Sign-In Now →
                      </a>
                    </div>
                  )}
                </div>
              )}
            </form>

            <div className="relative flex items-center">
              <div className="flex-grow border-t border-ap-frame/20 dark:border-white/15" />
              <span className="px-3 text-xs font-medium text-ap-muted dark:text-ap-muted-dark">
                or
              </span>
              <div className="flex-grow border-t border-ap-frame/20 dark:border-white/15" />
            </div>

            {/* Unified Strava & Google OAuth Buttons */}
            <div className="space-y-2 lg:space-y-1.5">
              {(() => {
                const isGoogleFirst =
                  (!activeBrand && onboardingRole === 'COACH') ||
                  (Boolean(activeBrand) &&
                    (activeBrand?.orgType === 'HIGH_SCHOOL' ||
                      activeBrand?.orgType === 'RUNNING_CLUB'));

                const googleCtaNode = (
                  <button
                    key="google"
                    type="button"
                    onClick={() => void handleGoogleSignIn()}
                    disabled={step1Busy}
                    className="w-full min-h-[44px] lg:min-h-[38px] py-1.5 px-4 rounded-full bg-ap-chalk dark:bg-ap-obsidian border border-ap-frame dark:border-white/30 text-ap-ink dark:text-ap-chalk font-bold text-sm flex items-center justify-center gap-2.5 disabled:opacity-60 hover:bg-ap-inset dark:hover:bg-ap-turf cursor-pointer transition-colors"
                  >
                    {isGoogleRedirecting ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <GoogleGIcon className="w-[18px] h-[18px]" />
                    )}
                    <span>
                      {isGoogleRedirecting ? 'Connecting to Google…' : 'Continue with Google'}
                    </span>
                  </button>
                );

                const stravaCtaNode = (
                  <button
                    key="strava"
                    type="button"
                    onClick={() => void handleStravaLaunchClick('cloud', false)}
                    disabled={step1Busy}
                    className="w-full min-h-[44px] lg:min-h-[38px] py-1.5 px-4 rounded-full bg-ap-chalk dark:bg-ap-obsidian border border-ap-frame dark:border-white/30 text-ap-ink dark:text-ap-chalk font-bold text-sm flex items-center justify-center gap-2.5 disabled:opacity-60 hover:bg-ap-inset dark:hover:bg-ap-turf cursor-pointer transition-colors"
                  >
                    {isRedirecting ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <StravaChevronMark className="w-[18px] h-[18px] text-[#FC4C02] shrink-0" />
                    )}
                    <span>
                      {isRedirecting
                        ? 'Opening Strava Sign-In…'
                        : activeBrand
                          ? `Connect with Strava to Join ${activeBrand.shortName}`
                          : 'Connect with Strava'}
                    </span>
                  </button>
                );

                return isGoogleFirst
                  ? [googleCtaNode, stravaCtaNode]
                  : [stravaCtaNode, googleCtaNode];
              })()}
            </div>

            {/* Self-Hosted BYO Strava Keys */}
            {showByoStravaSection && (
              <AuthByoStravaKeysSection
                showCustomStravaKeys={showCustomStravaKeys}
                setShowCustomStravaKeys={setShowCustomStravaKeys}
                currentHostname={currentHostname}
                stravaClientId={stravaClientId}
                setStravaClientId={setStravaClientId}
                stravaClientSecret={stravaClientSecret}
                setStravaClientSecret={setStravaClientSecret}
                savedStravaClientId={savedStravaClientId}
                busy={step1Busy}
                setIsExchanging={setIsExchanging}
                onClearStepNotice={() => setStepNotice(null)}
                onSaveKeysAndLaunchStrava={handleSaveKeysAndLaunchStrava}
                onExchangeStravaCode={onExchangeStravaCode}
                onSaveStravaDirectToken={onSaveStravaDirectToken}
              />
            )}

            {/* Compact Inline Privacy & COPPA 13+ Trigger */}
            <div
              data-testid="no-ads-guarantee-card"
              className="pt-0.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-ap-muted dark:text-ap-muted-dark"
            >
              <span className="font-bold text-ap-ink dark:text-ap-chalk">
                No Advertising. Ever.
              </span>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                data-testid="coppa-explainer-trigger"
                onClick={onOpenCoppaModal}
                className="min-h-[44px] sm:min-h-[28px] px-1 inline-flex items-center gap-1 underline underline-offset-2 text-ap-ink dark:text-ap-chalk hover:opacity-80 cursor-pointer transition-opacity"
              >
                <span>COPPA 13+</span>
              </button>
            </div>
          </aside>

          {/* Row 2 Left: Overlapping Dark Track Asphalt Specimen Dock */}
          {onEnterSampleDemo && (
            <section
              data-testid="splash-sample-card"
              aria-label="Interactive sample workout and stopwatch dock"
              className="order-3 lg:col-span-6 lg:col-start-1 lg:row-start-2 lg:-mt-20 lg:ml-6 lg:mr-3 relative z-20 w-full rounded-xl bg-[#121413] dark:bg-[#1A1D1B] text-[#F6F3EC] border border-[#2C312E] dark:border-white/25 p-5 sm:p-6 shadow-md space-y-5"
            >
              <div
                role="tablist"
                aria-label="Product specimen preview"
                className="grid grid-cols-2 gap-1 p-1 rounded-full border border-white/25 bg-[#191C1A]"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={heroPreviewTab === 'stopwatch'}
                  onClick={() => setHeroPreviewTab('stopwatch')}
                  className={`min-h-[44px] sm:min-h-[34px] px-3 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                    heroPreviewTab === 'stopwatch'
                      ? 'bg-[#F6F3EC] text-[#121413]'
                      : 'text-[#A39E93] hover:text-[#F6F3EC]'
                  }`}
                >
                  Trackside Stopwatch
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={heroPreviewTab === 'pods'}
                  onClick={() => setHeroPreviewTab('pods')}
                  className={`min-h-[44px] sm:min-h-[34px] px-3 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                    heroPreviewTab === 'pods'
                      ? 'bg-[#F6F3EC] text-[#121413]'
                      : 'text-[#A39E93] hover:text-[#F6F3EC]'
                  }`}
                >
                  Pace Pods &amp; Field Sheet
                </button>
              </div>

              <div data-testid="hero-static-product-preview" className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
                {heroPreviewTab === 'stopwatch' ? (
                  <>
                    <div className="sm:col-span-5">
                      <div className="font-mono text-4xl xl:text-5xl font-bold tabular-nums tracking-[-0.03em] text-[#F6F3EC]">
                        01:08.42
                      </div>
                      <div className="font-mono text-2xs uppercase tracking-wider text-[#A39E93] mt-1">
                        400m · Rep 4 · 60s Rest
                      </div>
                    </div>
                    <div className="sm:col-span-7 divide-y divide-white/15 font-mono text-xs sm:text-sm tabular-nums">
                      <div className="py-1.5 flex items-center justify-between gap-2">
                        <span className="font-sans font-semibold text-[#F6F3EC]">Pod A</span>
                        <span className="text-[#D8FF2A] font-semibold">01:05.33</span>
                        <span className="text-[#A39E93]">01:03.37</span>
                      </div>
                      <div className="py-1.5 flex items-center justify-between gap-2">
                        <span className="font-sans font-semibold text-[#F6F3EC]">Pod B</span>
                        <span className="text-[#F6F3EC]">01:06.75</span>
                        <span className="text-[#A39E93]">01:06.58</span>
                      </div>
                      <div className="py-1.5 flex items-center justify-between gap-2">
                        <span className="font-sans font-semibold text-[#F6F3EC]">Pod C</span>
                        <span className="text-[#F6F3EC]">01:08.14</span>
                        <span className="text-[#A39E93]">01:08.46</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="sm:col-span-5">
                      <div className="font-mono text-4xl xl:text-5xl font-bold tabular-nums tracking-[-0.03em] text-[#F6F3EC]">
                        6&apos; 04.0&quot;
                      </div>
                      <div className="font-mono text-2xs uppercase tracking-wider text-[#D8FF2A] mt-1">
                        High Jump · Flight 1 PR
                      </div>
                    </div>
                    <div className="sm:col-span-7 divide-y divide-white/15 font-mono text-xs sm:text-sm tabular-nums">
                      <div className="py-1.5 flex items-center justify-between gap-2">
                        <span className="font-sans font-semibold text-[#F6F3EC]">High Jump</span>
                        <span className="text-[#D8FF2A] font-semibold">6&apos; 04.0&quot;</span>
                        <span className="text-[#A39E93]">O XO</span>
                      </div>
                      <div className="py-1.5 flex items-center justify-between gap-2">
                        <span className="font-sans font-semibold text-[#F6F3EC]">Shot Put</span>
                        <span className="text-[#F6F3EC]">48&apos; 06.5&quot;</span>
                        <span className="text-[#A39E93]">+1&apos; 2&quot; PR</span>
                      </div>
                      <div className="py-1.5 flex items-center justify-between gap-2">
                        <span className="font-sans font-semibold text-[#F6F3EC]">Pole Vault</span>
                        <span className="text-[#F6F3EC]">14&apos; 06.0&quot;</span>
                        <span className="text-[#A39E93]">Cleared</span>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  data-testid="explore-coach-sample-btn"
                  onClick={() => onEnterSampleDemo('COACH')}
                  className="min-h-[44px] px-5 py-2 rounded-full bg-ap-volt hover:bg-[#c8ef1e] text-[#121413] font-extrabold text-sm inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <span>Explore Coach Sample →</span>
                </button>
                <button
                  type="button"
                  data-testid="try-athlete-sample-btn"
                  onClick={() => onEnterSampleDemo('ATHLETE')}
                  className="min-h-[44px] px-4 py-2 rounded-full border border-white/40 hover:bg-white/10 text-[#F6F3EC] font-semibold text-sm inline-flex items-center cursor-pointer transition-colors"
                >
                  Try Athlete View
                </button>
              </div>
            </section>
          )}

          {/* Row 2 Right: Clean Ruled For Coaches | For Athletes Benefits Ledger */}
          <section
            data-testid="splash-benefits-matrix"
            aria-label="MeetReady platform benefits"
            className="order-4 lg:col-span-6 lg:col-start-7 lg:row-start-2 lg:pt-5 lg:pl-4 w-full grid grid-cols-1 sm:grid-cols-2 gap-6"
          >
            <div className="space-y-2.5">
              <h2 className="font-sans text-sm sm:text-base font-extrabold text-ap-ink dark:text-ap-chalk pb-2 border-b border-ap-frame dark:border-white/25">
                For Coaches
              </h2>
              <ul className="space-y-2 text-xs sm:text-sm text-ap-ink/90 dark:text-ap-chalk/90">
                <li className="flex items-start gap-2">
                  <span className="text-ap-clay dark:text-ap-volt font-bold" aria-hidden="true">•</span>
                  <span>Automated roster &amp; event-group setup</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-ap-clay dark:text-ap-volt font-bold" aria-hidden="true">•</span>
                  <span>Easy Athletic.net &amp; TFRRS official results sync</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-ap-clay dark:text-ap-volt font-bold" aria-hidden="true">•</span>
                  <span>Trackside stopwatch &amp; field events sheet</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-ap-clay dark:text-ap-volt font-bold" aria-hidden="true">•</span>
                  <span>SafeSport two-adult messaging &amp; push alerts</span>
                </li>
              </ul>
            </div>

            <div className="space-y-2.5">
              <h2 className="font-sans text-sm sm:text-base font-extrabold text-ap-ink dark:text-ap-chalk pb-2 border-b border-ap-frame dark:border-white/25">
                For Athletes
              </h2>
              <ul className="space-y-2 text-xs sm:text-sm text-ap-ink/90 dark:text-ap-chalk/90">
                <li className="flex items-start gap-2">
                  <span className="text-ap-clay dark:text-ap-volt font-bold" aria-hidden="true">•</span>
                  <span>Readiness &amp; workload without clutter</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-ap-clay dark:text-ap-volt font-bold" aria-hidden="true">•</span>
                  <span>Track splits &amp; PR progression</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-ap-clay dark:text-ap-volt font-bold" aria-hidden="true">•</span>
                  <span>Verified official meet &amp; race history</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-ap-clay dark:text-ap-volt font-bold" aria-hidden="true">•</span>
                  <span>Guardian-CC&apos;d coach workout feedback</span>
                </li>
              </ul>
            </div>
          </section>
        </div>
      </main>

      {/* Clean Deduplicated Editorial Footer */}
      <footer className="mt-8 pt-4 border-t border-ap-frame dark:border-white/20 flex flex-wrap items-center justify-between gap-3 text-xs text-ap-muted dark:text-ap-muted-dark">
        <div className="flex items-center gap-2">
          <span className="font-extrabold text-ap-ink dark:text-ap-chalk tracking-tight">
            MeetReady
          </span>
          <span>· Track, Field &amp; Cross Country Platform</span>
        </div>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-x-4 gap-y-0 font-semibold -my-1.5 sm:my-0">
          <a
            href="/docs/"
            className="min-h-[44px] sm:min-h-[32px] inline-flex items-center text-ap-ink/85 dark:text-ap-chalk/85 hover:underline"
          >
            Guide &amp; Docs
          </a>
          <a
            href="/docs/coach.html"
            className="min-h-[44px] sm:min-h-[32px] inline-flex items-center text-ap-ink/85 dark:text-ap-chalk/85 hover:underline"
          >
            Coach Guide
          </a>
          <a
            href="/brand"
            onClick={(e) => {
              if (onOpenBrandStudio && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                onOpenBrandStudio();
              }
            }}
            className="min-h-[44px] sm:min-h-[32px] inline-flex items-center text-ap-ink/85 dark:text-ap-chalk/85 hover:underline cursor-pointer"
          >
            Brand &amp; Style Guide
          </a>
          <a
            href="/privacy"
            className="min-h-[44px] sm:min-h-[32px] inline-flex items-center text-ap-ink/85 dark:text-ap-chalk/85 hover:underline"
          >
            Privacy
          </a>
          <a
            href="/terms"
            className="min-h-[44px] sm:min-h-[32px] inline-flex items-center text-ap-ink/85 dark:text-ap-chalk/85 hover:underline"
          >
            Terms
          </a>
          <a
            href="/procurement"
            className="min-h-[44px] sm:min-h-[32px] inline-flex items-center text-ap-ink/85 dark:text-ap-chalk/85 hover:underline"
          >
            Compliance
          </a>
          <a
            href="/docs/#sec-safesport"
            className="min-h-[44px] sm:min-h-[32px] inline-flex items-center text-ap-ink/85 dark:text-ap-chalk/85 hover:underline"
          >
            Safe-Sport Shield
          </a>
        </div>
      </footer>
    </div>
  );
};
