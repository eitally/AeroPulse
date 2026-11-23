import React, { Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Info,
  Lock,
  LogOut,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  Users,
  X,
} from './icons/PhosphorIcons';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { WorkspaceErrorBoundary } from './WorkspaceErrorBoundary';

const ArchiveOnboardingWizard = lazyWithRetry(
  () => import('./ArchiveOnboardingWizard').then((m) => ({ default: m.ArchiveOnboardingWizard })),
  { chunkKey: 'ArchiveOnboardingWizard' }
);
import {
  CoachDataSharingTier,
  ConnectionStatus,
  DistanceUnit,
  StravaSyncPolicy,
  StravaSyncWindow,
  TeamInvitePreviewPayload,
  TeamSummaryWithRole,
  ThreshUser,
  UnifiedActivity,
} from '../types';
import {
  calibrateThresholdsFromSeedMark,
  computeAccessibleTeamPalette,
} from '../physiology/teamOnboardingEngine';
import { resolveAthleteAgeTier } from '../physiology/ageAndComplianceEngine';
import { applyTeamBrandToDocument } from '../utils/teamBrandDom';
import { AeroPulseLogo, ThreshBrandWatermark } from './AeroPulseLogo';
import { SEED_EVENT_PILLS, StravaChevronMark } from './auth/authGateShared';
import { AuthOnboardingStepTwo } from './auth/AuthOnboardingStepTwo';
import { AuthOptionalAddonsStep } from './auth/AuthOptionalAddonsStep';
import {
  getSavedIntervalsHeaders,
  isBrowserSessionLoggedOut,
  saveStravaSyncPolicyToStorage,
} from '../utils/telemetryStorage';
import {
  clearPendingSharedWorkout,
  peekPendingSharedWorkout,
} from '../utils/shareWorkoutEngine';
import { markSessionActiveHint } from '../utils/sessionHint';

export interface FirstRunCalibrationPayload {
  athleteName: string;
  primarySport: 'Cycling' | 'Running' | 'Swimming' | 'Triathlon' | 'Hybrid';
  distanceUnit: DistanceUnit;
  hasCustomSeedMark?: boolean;
  weightDisplay?: number;
  cyclingFtpWatts?: number;
  thresholdPaceInput?: string;
  safeSportHideWeight?: boolean;
  birthMonthYear?: string;
  stravaSyncPolicy?: StravaSyncPolicy;
  claimedTeams?: TeamSummaryWithRole[];
  activeTeamId?: string;
  sessionToken?: string;
  entryTarget: 'WORKSPACE' | 'DATA_SOURCES' | 'UPLOAD_FIT' | 'CREATE_TEAM' | 'COACH_MODE';
}

export interface StravaOAuthJoinContext {
  joinCode?: string;
  slug?: string;
  inviteToken?: string;
}

interface StravaAuthGateProps {
  status: ConnectionStatus;
  currentUser?: ThreshUser | null;
  onAuthenticatedUser?: (user: ThreshUser) => void;
  onLaunchStravaOAuth: (
    mode?: 'cloud' | 'localhost',
    joinContext?: StravaOAuthJoinContext,
    forcePrompt?: boolean
  ) => Promise<void>;
  onSaveStravaCredentials?: (clientId: string, clientSecret: string) => Promise<void>;
  onSaveStravaDirectToken?: (refreshToken: string, accessToken?: string) => Promise<void>;
  onExchangeStravaCode?: (codeOrUrl: string) => Promise<void>;
  onConnectIntervals?: (athleteId: string, apiKey: string) => Promise<void>;
  onLaunchIntervalsOAuth?: () => Promise<void>;
  onLaunchGarminOAuth?: () => Promise<void>;
  onLaunchCorosOAuth?: () => Promise<void>;
  onLaunchWahooOAuth?: () => Promise<void>;
  onLaunchPolarOAuth?: () => Promise<void>;
  onSyncNow?: (fullHistory?: boolean, explicitWindow?: StravaSyncWindow) => Promise<void>;
  onCompleteCalibrationEntry?: (payload: FirstRunCalibrationPayload) => Promise<void>;
  onDisconnectCredentials?: () => Promise<void>;
  isSyncing: boolean;
  errorMessage: string | null;
  isDark?: boolean;
  onToggleDark?: () => void;
  onEnterSampleDemo?: (preferredRole?: 'ATHLETE' | 'COACH') => void;
  onImportBatchActivities?: (activities: UnifiedActivity[]) => void;
  onBypassToLocalSession?: () => Promise<void>;
  onOpenBrandStudio?: () => void;
  existingActivities?: UnifiedActivity[];
  distanceUnit?: DistanceUnit;
}

type WizardStep = 1 | 2 | 3;

const PENDING_TEAM_JOIN_STORAGE_KEY = 'thresh_pending_team_join_v1';

interface StoredPendingJoin {
  codeOrSlug: string;
  slug?: string;
  token: string;
  email?: string;
}

function detectInitialJoinParams(): StoredPendingJoin {
  if (typeof window === 'undefined') return { codeOrSlug: '', token: '' };
  const pathMatch = window.location.pathname.match(/^\/join\/([^/?#]+)/i);
  const params = new URLSearchParams(window.location.search);
  const queryJoin = (params.get('join') || params.get('team') || '').trim();
  const token = (params.get('t') || params.get('token') || '').trim();
  const queryEmail = (params.get('email') || params.get('e') || '').trim().toLowerCase();
  const slug = pathMatch ? decodeURIComponent(pathMatch[1]).trim() : '';
  const codeOrSlug = slug || queryJoin;
  if (codeOrSlug) {
    return { codeOrSlug, slug: slug || undefined, token, email: queryEmail || undefined };
  }
  try {
    const saved = sessionStorage.getItem(PENDING_TEAM_JOIN_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as StoredPendingJoin;
      if (parsed?.codeOrSlug) return parsed;
    }
  } catch {
    // ignore storage errors
  }
  return { codeOrSlug: '', token: '', email: queryEmail || undefined };
}

function detectEmbeddedWebView(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Instagram|FBAN|FBAV|GroupMe|Line\/|Snapchat|TikTok|BytedanceWebview|LinkedInApp/i.test(ua);
}

const GoogleGIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3h3.88c2.27-2.09 3.665-5.17 3.665-9.09z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.26v3.09C3.26 21.36 7.33 24 12 24z"
    />
    <path
      fill="#FBBC05"
      d="M5.28 14.32c-.25-.72-.38-1.49-.38-2.32s.13-1.6.38-2.32V6.59H1.26C.46 8.19 0 9.99 0 12s.46 3.81 1.26 5.41l4.02-3.09z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.26 6.59l4.02 3.09c.95-2.83 3.6-4.93 6.72-4.93z"
    />
  </svg>
);

export const StravaAuthGate: React.FC<StravaAuthGateProps> = ({
  status,
  currentUser,
  onAuthenticatedUser,
  onLaunchStravaOAuth,
  onSaveStravaCredentials,
  onSaveStravaDirectToken,
  onExchangeStravaCode,
  onConnectIntervals,
  onLaunchIntervalsOAuth,
  onLaunchGarminOAuth,
  onLaunchCorosOAuth,
  onLaunchWahooOAuth,
  onLaunchPolarOAuth,
  onSyncNow,
  onCompleteCalibrationEntry,
  onDisconnectCredentials,
  isSyncing,
  errorMessage,
  isDark = false,
  onToggleDark,
  onEnterSampleDemo,
  onImportBatchActivities,
  onBypassToLocalSession,
  onOpenBrandStudio,
  existingActivities = [],
  distanceUnit: propDistanceUnit,
}) => {
  const formId = useId();
  const initialJoin = useMemo(() => detectInitialJoinParams(), []);
  const isEmbeddedWebView = useMemo(() => detectEmbeddedWebView(), []);

  // MeetReady User Identity State (Self-Hosted Auth: Google, Email Magic Link, Strava)
  const [localUser, setLocalUser] = useState<ThreshUser | null>(
    currentUser || status.currentUser || null
  );
  const [magicLinkEmail, setMagicLinkEmail] = useState(initialJoin.email || '');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [magicLinkDevUrl, setMagicLinkDevUrl] = useState<string | null>(null);
  const [isSendingMagicLink, setIsSendingMagicLink] = useState(false);
  const [isGoogleRedirecting, setIsGoogleRedirecting] = useState(false);
  const [showCoppaModal, setShowCoppaModal] = useState(false);
  const [onboardingRole, setOnboardingRole] = useState<'ATHLETE' | 'COACH'>(() => {
    try {
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const urlRole = params.get('role')?.toUpperCase();
        if (urlRole === 'ATHLETE' || urlRole === 'COACH') return urlRole;
        const saved =
          localStorage.getItem('thresh_onboarding_role') ||
          sessionStorage.getItem('thresh_onboarding_role');
        if (saved === 'ATHLETE' || saved === 'COACH') return saved;
      }
      return initialJoin.codeOrSlug ? 'ATHLETE' : 'COACH';
    } catch {
      return initialJoin.codeOrSlug ? 'ATHLETE' : 'COACH';
    }
  });
  const teamCodeInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingSharedWorkout, setPendingSharedWorkout] = useState(() =>
    peekPendingSharedWorkout()
  );

  const selectOnboardingRole = (nextRole: 'ATHLETE' | 'COACH') => {
    setOnboardingRole(nextRole);
    try {
      sessionStorage.setItem('thresh_onboarding_role', nextRole);
      localStorage.setItem('thresh_onboarding_role', nextRole);
    } catch {
      // ignore storage errors
    }
  };

  const isUserAuthenticated = Boolean(status.stravaConnected || localUser || currentUser);
  const [step, setStep] = useState<WizardStep>(() =>
    Boolean((currentUser || status.currentUser) && !status.stravaConnected) ||
    Boolean(status.stravaConnected && initialJoin.codeOrSlug)
      ? 2
      : 1
  );
  const [showArchiveWizard, setShowArchiveWizard] = useState(false);

  // Athlete Sync & Calibration State (Step 2)
  const [syncWindow, setSyncWindow] = useState<StravaSyncWindow>(
    status.stravaSyncPolicy?.window || '90d'
  );
  const [importProfileAndGear, setImportProfileAndGear] = useState<boolean>(
    status.stravaSyncPolicy?.importProfileAndGear ?? true
  );
  const [athleteName, setAthleteName] = useState(status.stravaAthleteName || '');
  const [athleteEmail, setAthleteEmail] = useState(initialJoin.email || '');
  const [birthYear, setBirthYear] = useState<string>('');
  const [birthMonth, setBirthMonth] = useState<string>('');
  const [parentGuardianEmail, setParentGuardianEmail] = useState<string>('');
  const [deferParentEmail, setDeferParentEmail] = useState<boolean>(false);
  const [primarySport, setPrimarySport] = useState<
    'Cycling' | 'Running' | 'Swimming' | 'Triathlon' | 'Hybrid'
  >('Running');
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>(
    status.stravaMeasurementPreference || propDistanceUnit || 'mi'
  );
  const [hasEditedUnits, setHasEditedUnits] = useState(false);

  const [selectedSeedEventId, setSelectedSeedEventId] = useState<string>('5k');
  const [rawSeedValue, setRawSeedValue] = useState('');
  const [safeSportHideWeight, setSafeSportHideWeight] = useState(false);
  const [sharingTier, setSharingTier] = useState<CoachDataSharingTier>('SUMMARY_ONLY');

  // Saved Step 2 output carried into Step 3
  const [confirmedPolicy, setConfirmedPolicy] = useState<StravaSyncPolicy | undefined>(
    status.stravaSyncPolicy
  );
  const [claimedTeamsState, setClaimedTeamsState] = useState<{
    teams: TeamSummaryWithRole[];
    activeTeamId?: string;
    sessionToken?: string;
    calibratedFtp?: number;
    calibratedPace?: string;
    safeSportEnforced?: boolean;
  } | null>(null);

  // BYO Strava API Credentials (only for self-hosted servers lacking STRAVA_CLIENT_ID)
  const [showCustomStravaKeys, setShowCustomStravaKeys] = useState(false);
  const [stravaClientId, setStravaClientId] = useState(status.stravaClientId || '');
  const [stravaClientSecret, setStravaClientSecret] = useState('');
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [directRefreshToken, setDirectRefreshToken] = useState('');
  const [copiedDomain, setCopiedDomain] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [isExchanging, setIsExchanging] = useState(false);
  const [isSavingStep2, setIsSavingStep2] = useState(false);
  const [stepNotice, setStepNotice] = useState<string | null>(null);

  // Step 3 Optional Garmin & Intervals State
  const [expandGarmin, setExpandGarmin] = useState(false);
  const [garminPersonalKey, setGarminPersonalKey] = useState('');
  const [isConnectingGarmin, setIsConnectingGarmin] = useState(false);
  const [garminLinkedLocal, setGarminLinkedLocal] = useState(false);

  const [expandIntervals, setExpandIntervals] = useState(false);
  const [intervalsAthleteId, setIntervalsAthleteId] = useState(status.intervalsAthleteId || '0');
  const [intervalsApiKey, setIntervalsApiKey] = useState('');
  const [isConnectingIntervals, setIsConnectingIntervals] = useState(false);
  const [isEntering, setIsEntering] = useState(false);

  // Inline Team Invite Lookup & Preview State
  const [showTeamCodeDrawer, setShowTeamCodeDrawer] = useState<boolean>(
    Boolean(initialJoin.codeOrSlug)
  );
  const [joinCodeInput, setJoinCodeInput] = useState(initialJoin.codeOrSlug);
  const [joinSlug, setJoinSlug] = useState<string | undefined>(initialJoin.slug);
  const [inviteToken, setInviteToken] = useState(initialJoin.token);
  const [invitePreview, setInvitePreview] = useState<TeamInvitePreviewPayload | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const parsedBirthYear = parseInt(birthYear, 10);
  const validBirthYear = !isNaN(parsedBirthYear) && parsedBirthYear > 1900 ? parsedBirthYear : null;
  const composedBirthMonthYear =
    validBirthYear !== null && birthMonth
      ? `${validBirthYear}-${birthMonth}`
      : validBirthYear !== null
        ? `${validBirthYear}-12`
        : undefined;
  const step2AgeTier = useMemo(
    () =>
      resolveAthleteAgeTier({
        birthMonthYear: composedBirthMonthYear,
        birthYear: validBirthYear ?? undefined,
        orgType: invitePreview?.brand?.orgType,
      }),
    [composedBirthMonthYear, validBirthYear, invitePreview?.brand?.orgType]
  );
  const isUnder13 = step2AgeTier.ageTier === 'U13_COPPA';
  const isMinorAthlete =
    validBirthYear !== null
      ? step2AgeTier.isMinorU18
      : Boolean(
          invitePreview?.brand?.orgType === 'HIGH_SCHOOL' ||
            invitePreview?.membership?.isMinorU18
        );

  useEffect(() => {
    if (isMinorAthlete) {
      setSafeSportHideWeight(true);
    }
  }, [isMinorAthlete]);

  const currentHostname =
    typeof window !== 'undefined' ? window.location.hostname : 'meetready.app';

  const lacksActivityScope = Boolean(
    status.stravaConnected &&
      status.stravaGrantedScope &&
      !status.stravaGrantedScope.includes('activity:read')
  );

  // Sync parent user when updated
  useEffect(() => {
    if (currentUser) {
      setLocalUser(currentUser);
      if (currentUser.name && !athleteName) setAthleteName(currentUser.name);
      if (currentUser.email && !athleteEmail) setAthleteEmail(currentUser.email);
    }
  }, [currentUser, athleteName, athleteEmail]);

  // Allow Escape key to dismiss the COPPA 13+ explainer modal
  useEffect(() => {
    if (!showCoppaModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowCoppaModal(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showCoppaModal]);

  // Hydrate session if already signed in via MeetReady session cookie
  useEffect(() => {
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const searchParams = new URLSearchParams(search);
    const justSignedIn = searchParams.get('auth_just_signed_in') === '1';
    if (justSignedIn) {
      try {
        localStorage.removeItem('aeropulse_logged_out');
      } catch {
        // ignore
      }
      try {
        searchParams.delete('auth_just_signed_in');
        const nextQs = searchParams.toString();
        const nextUrl = `${window.location.pathname}${nextQs ? `?${nextQs}` : ''}${window.location.hash}`;
        window.history.replaceState({}, '', nextUrl);
      } catch {
        // ignore URL history errors
      }
    }
    if (!justSignedIn && isBrowserSessionLoggedOut()) {
      return;
    }
    let cancelled = false;
    if (!localUser && !currentUser && !status.stravaConnected) {
      fetch('/api/auth/me', { credentials: 'include' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (cancelled || (!justSignedIn && isBrowserSessionLoggedOut())) {
            return;
          }
          if (data?.authenticated && data?.user) {
            try {
              const notLoggedOut = !isBrowserSessionLoggedOut();
              if (justSignedIn || notLoggedOut) {
                markSessionActiveHint();
              }
            } catch {
              // ignore
            }
            setLocalUser(data.user);
            onAuthenticatedUser?.(data.user);
            if (data.user.name && !athleteName) setAthleteName(data.user.name);
            if (data.user.email && !athleteEmail) setAthleteEmail(data.user.email);
          }
        })
        .catch(() => null);
    }
    return () => {
      cancelled = true;
    };
  }, [localUser, currentUser, status.stravaConnected, athleteName, athleteEmail, onAuthenticatedUser]);

  // Advance Step 1 -> Step 2 only for non-Strava accounts or Strava users actively joining a team
  useEffect(() => {
    const hasActiveTeamJoin = Boolean(
      initialJoin.codeOrSlug ||
        (invitePreview?.found && invitePreview?.brand) ||
        joinCodeInput.trim()
    );
    if (
      (Boolean(localUser && !status.stravaConnected) ||
        Boolean(status.stravaConnected && hasActiveTeamJoin)) &&
      step === 1
    ) {
      setStep(2);
    }
  }, [status.stravaConnected, localUser, step, initialJoin.codeOrSlug, invitePreview, joinCodeInput]);

  // Pre-fill athlete name & measurement preference from Strava profile
  useEffect(() => {
    if (status.stravaAthleteName && !athleteName) {
      setAthleteName(status.stravaAthleteName);
    }
  }, [status.stravaAthleteName, athleteName]);

  useEffect(() => {
    if (status.stravaMeasurementPreference && !hasEditedUnits) {
      setDistanceUnit(status.stravaMeasurementPreference);
    }
  }, [status.stravaMeasurementPreference, hasEditedUnits]);

  useEffect(() => {
    if (lacksActivityScope) {
      setSyncWindow('none');
    }
  }, [lacksActivityScope]);

  useEffect(() => {
    if (status.stravaClientId && !stravaClientId) {
      setStravaClientId(status.stravaClientId);
    }
  }, [status.stravaClientId, stravaClientId]);

  useEffect(() => {
    if (errorMessage && /STRAVA_CLIENT_ID|not configured/i.test(errorMessage)) {
      setShowCustomStravaKeys(true);
    }
  }, [errorMessage]);

  const isGarminConnected = Boolean(status.garminConnected || garminLinkedLocal);

  const selectedSeedPill = useMemo(
    () =>
      SEED_EVENT_PILLS.find((p) => p.id === selectedSeedEventId) || SEED_EVENT_PILLS[0],
    [selectedSeedEventId]
  );

  // Compose structured seed expression (e.g. "3200m 10:15" or "20m 280W") unless user typed explicit distance/units
  const composedSeedMark = useMemo(() => {
    const trimmed = rawSeedValue.trim();
    if (!trimmed) return '';
    if (/\b(5k|10k|3200m?|1600m?|1500m?|800m?|mile|20m|ftp)\b/i.test(trimmed)) {
      return trimmed;
    }
    return `${selectedSeedPill.prefix}${trimmed}`.trim();
  }, [rawSeedValue, selectedSeedPill]);

  const liveSeedCalibration = useMemo(
    () => calibrateThresholdsFromSeedMark(composedSeedMark, primarySport, distanceUnit),
    [composedSeedMark, primarySport, distanceUnit]
  );

  const lookupTeamPreview = async (
    codeOrSlug: string,
    token?: string,
    explicitSlug?: string,
    overrideEmail?: string
  ) => {
    const clean = codeOrSlug.trim();
    if (!clean) {
      setInvitePreview(null);
      applyTeamBrandToDocument(null);
      try {
        sessionStorage.removeItem(PENDING_TEAM_JOIN_STORAGE_KEY);
      } catch {
        // ignore
      }
      return;
    }
    setIsLoadingPreview(true);
    setJoinError(null);
    try {
      const qs = new URLSearchParams({ codeOrSlug: clean });
      if (token) qs.set('t', token);
      const emailToLookup = overrideEmail || athleteEmail.trim() || initialJoin.email || '';
      if (emailToLookup) qs.set('email', emailToLookup);
      const resp = await fetch(`/api/teams/join-preview?${qs.toString()}`, {
        credentials: 'include',
      });
      const data = (await resp.json()) as TeamInvitePreviewPayload;
      setInvitePreview(data);
      if (data.found && data.brand) {
        applyTeamBrandToDocument(data.brand);
        setPrimarySport(data.brand.primarySport);
        if (data.brand.primarySport === 'Cycling') {
          setSelectedSeedEventId('ftp');
        } else {
          setSelectedSeedEventId('5k');
        }
        setSafeSportHideWeight(
          Boolean(data.brand.defaultSafeSportShield || data.membership?.isMinorU18)
        );
        if (data.membership) {
          if (data.membership.invitedName && !status.stravaAthleteName) {
            setAthleteName(data.membership.invitedName);
          }
          if (data.membership.invitedEmail) setAthleteEmail(data.membership.invitedEmail);
          if (data.membership.seedMarkOrFtp) setRawSeedValue(data.membership.seedMarkOrFtp);
          if (data.membership.parentGuardianEmail) {
            setParentGuardianEmail(data.membership.parentGuardianEmail);
          }
          if (data.membership.birthYear) {
            setBirthYear(String(data.membership.birthYear));
          }
        }
        try {
          sessionStorage.setItem(
            PENDING_TEAM_JOIN_STORAGE_KEY,
            JSON.stringify({
              codeOrSlug: clean,
              slug: explicitSlug || data.brand.slug,
              token: token || '',
              email: emailToLookup || undefined,
            })
          );
        } catch {
          // ignore
        }
      } else {
        applyTeamBrandToDocument(null);
        setJoinError('Team code not found — check the 6-character code from your coach.');
      }
    } catch {
      setJoinError('Could not reach server to preview team invite.');
    } finally {
      setIsLoadingPreview(false);
    }
  };

  useEffect(() => {
    if (initialJoin.codeOrSlug) {
      void lookupTeamPreview(
        initialJoin.codeOrSlug,
        initialJoin.token,
        initialJoin.slug,
        initialJoin.email
      );
    }
  }, [initialJoin.codeOrSlug, initialJoin.token, initialJoin.slug, initialJoin.email]);

  const activeBrand = invitePreview?.found ? invitePreview.brand : null;

  const currentJoinContext = useMemo<StravaOAuthJoinContext | undefined>(() => {
    const clean = joinCodeInput.trim();
    if (!clean && !joinSlug) return undefined;
    return {
      joinCode: !joinSlug ? clean : undefined,
      slug: joinSlug || activeBrand?.slug || undefined,
      inviteToken: inviteToken || undefined,
    };
  }, [joinCodeInput, joinSlug, inviteToken, activeBrand]);

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

  const handleStravaLaunchClick = async (
    oauthMode: 'cloud' | 'localhost' = 'cloud',
    forcePrompt = false
  ) => {
    setIsRedirecting(true);
    setStepNotice(null);
    setJoinError(null);
    try {
      try {
        const cleanCode = joinCodeInput.trim();
        if (cleanCode || joinSlug) {
          sessionStorage.setItem(
            PENDING_TEAM_JOIN_STORAGE_KEY,
            JSON.stringify({
              codeOrSlug: cleanCode || joinSlug || '',
              slug: joinSlug || activeBrand?.slug || undefined,
              token: inviteToken || '',
              email: athleteEmail.trim() || undefined,
            })
          );
        }
      } catch {
        // ignore storage errors
      }
      await onLaunchStravaOAuth(oauthMode, currentJoinContext, forcePrompt);
    } finally {
      setIsRedirecting(false);
    }
  };

  const handleSaveKeysAndLaunchStrava = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stravaClientId.trim()) return;
    setIsRedirecting(true);
    setStepNotice(null);
    try {
      try {
        localStorage.setItem('aeropulse_strava_client_id', stravaClientId.trim());
        if (stravaClientSecret.trim()) {
          localStorage.setItem('aeropulse_strava_client_secret', stravaClientSecret.trim());
        }
      } catch {
        // ignore storage errors
      }
      const launchPromise = onLaunchStravaOAuth('cloud', currentJoinContext, false);
      if (onSaveStravaCredentials && stravaClientSecret.trim()) {
        void onSaveStravaCredentials(stravaClientId.trim(), stravaClientSecret.trim());
      }
      await launchPromise;
    } finally {
      setIsRedirecting(false);
    }
  };

  const handleManualExchangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCodeInput.trim() && !directRefreshToken.trim()) return;
    setIsExchanging(true);
    setStepNotice(null);
    try {
      if (directRefreshToken.trim() && onSaveStravaDirectToken) {
        await onSaveStravaDirectToken(directRefreshToken.trim());
        setDirectRefreshToken('');
      } else if (manualCodeInput.trim() && onExchangeStravaCode) {
        await onExchangeStravaCode(manualCodeInput.trim());
        setManualCodeInput('');
      }
    } finally {
      setIsExchanging(false);
    }
  };

  const handleSwitchStravaAccount = async () => {
    setStepNotice(null);
    setLocalUser(null);
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // ignore
    }
    if (onDisconnectCredentials) {
      await onDisconnectCredentials();
    }
    setStep(1);
  };

  const submitCalibrationEntry = async (
    entryTarget: FirstRunCalibrationPayload['entryTarget'] = 'WORKSPACE',
    overridePolicy?: StravaSyncPolicy,
    overrideClaimed?: typeof claimedTeamsState
  ) => {
    if (!onCompleteCalibrationEntry) return;
    const effectiveClaimed = overrideClaimed !== undefined ? overrideClaimed : claimedTeamsState;
    const hasCustomSeedMark = Boolean(composedSeedMark.trim());
    await onCompleteCalibrationEntry({
      athleteName:
        athleteName.trim() ||
        status.stravaAthleteName ||
        status.garminAthleteName ||
        'Athlete',
      primarySport:
        effectiveClaimed?.teams?.[0]?.brand?.primarySport || primarySport,
      distanceUnit,
      hasCustomSeedMark,
      cyclingFtpWatts: hasCustomSeedMark
        ? effectiveClaimed?.calibratedFtp || liveSeedCalibration.cyclingFtpWatts
        : undefined,
      thresholdPaceInput: hasCustomSeedMark
        ? effectiveClaimed?.calibratedPace ||
          liveSeedCalibration.thresholdPaceInputDisplay
        : undefined,
      safeSportHideWeight: isMinorAthlete
        ? true
        : Boolean(effectiveClaimed?.safeSportEnforced || safeSportHideWeight),
      ...(composedBirthMonthYear ? { birthMonthYear: composedBirthMonthYear } : {}),
      stravaSyncPolicy: overridePolicy ?? confirmedPolicy,
      claimedTeams: effectiveClaimed?.teams,
      activeTeamId: effectiveClaimed?.activeTeamId,
      sessionToken: effectiveClaimed?.sessionToken,
      entryTarget,
    });
  };

  // Step 2 Confirmation: Save Sync Policy + Claim Team Invite (if present) + Kick off Background Sync
  const handleConfirmStep2 = async () => {
    setIsSavingStep2(true);
    setJoinError(null);
    setStepNotice(null);
    try {
      let savedPolicy: StravaSyncPolicy = {
        window: syncWindow,
        importProfileAndGear,
        confirmedAt: new Date().toISOString(),
        grantedScope: status.stravaGrantedScope,
      };
      const authHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...getSavedIntervalsHeaders(),
      };

      if (status.stravaConnected) {
        const policyResp = await fetch('/api/strava/sync-policy', {
          method: 'POST',
          credentials: 'include',
          headers: authHeaders,
          body: JSON.stringify({
            window: syncWindow,
            importProfileAndGear,
          }),
        });
        if (policyResp.ok) {
          const pData = await policyResp.json().catch(() => ({}));
          if (pData?.stravaSyncPolicy) {
            savedPolicy = pData.stravaSyncPolicy;
          }
        }
      }
      saveStravaSyncPolicyToStorage(savedPolicy);
      setConfirmedPolicy(savedPolicy);

      // Youth Protection Gate (COPPA < 13 block + Scholastic Safe-Sport)
      if (isUnder13) {
        setJoinError(
          'MeetReady self-serve accounts require athletes to be 13 or older (COPPA). Coaches can still time under-13 athletes watchlessly using Trackside Stopwatch without an athlete login.'
        );
        return;
      }
      if (isMinorAthlete && !activeBrand && !joinCodeInput.trim()) {
        setJoinError(
          'Scholastic Youth Protection: Athletes under 18 must join through a school or club athletic team. Please enter your team join code.'
        );
        setShowTeamCodeDrawer(true);
        return;
      }

      if (
        isMinorAthlete &&
        !parentGuardianEmail.trim() &&
        !invitePreview?.membership?.parentGuardianEmail &&
        !deferParentEmail
      ) {
        setJoinError(
          'Parent or guardian email is required for athletes under 18 unless you choose to share the link later.'
        );
        return;
      }

      // If athlete is joining a team, claim their roster spot now with their verified Strava/Google identity!
      let claimedResult: typeof claimedTeamsState = null;
      if (activeBrand && joinCodeInput.trim()) {
        const claimResp = await fetch('/api/teams/join-claim', {
          method: 'POST',
          credentials: 'include',
          headers: authHeaders,
          body: JSON.stringify({
            origin: typeof window !== 'undefined' ? window.location.origin : undefined,
            codeOrSlug: joinSlug || joinCodeInput.trim(),
            inviteToken: inviteToken || undefined,
            athleteName:
              athleteName.trim() || status.stravaAthleteName || 'Team Athlete',
            athleteEmail: athleteEmail.trim() || undefined,
            seedMarkOrFtp: composedSeedMark || undefined,
            distanceUnit,
            sharingTier,
            stravaAthleteId: status.stravaAthleteId || undefined,
            birthYear: validBirthYear ?? undefined,
            birthMonthYear: composedBirthMonthYear,
            parentGuardianEmail: parentGuardianEmail.trim() || undefined,
            deferParentEmail,
          }),
        });
        const claimData = await claimResp.json().catch(() => ({}));
        if (!claimResp.ok || !claimData.ok) {
          setJoinError(claimData.error || 'Could not claim team invite. Please check your code.');
          return;
        }
        try {
          sessionStorage.removeItem(PENDING_TEAM_JOIN_STORAGE_KEY);
          if (typeof window !== 'undefined' && window.location.pathname.startsWith('/join/')) {
            window.history.replaceState({}, '', '/');
          }
        } catch {
          // ignore
        }
        const claimedTeam = claimData.team as TeamSummaryWithRole;
        const allTeams = (claimData.teams as TeamSummaryWithRole[]) || [claimedTeam];
        claimedResult = {
          teams: allTeams,
          activeTeamId: claimedTeam?.brand?.teamId,
          sessionToken: claimData.sessionToken,
          calibratedFtp: claimData.calibrated?.cyclingFtpWatts,
          calibratedPace: claimData.calibrated?.thresholdPaceInputDisplay,
          safeSportEnforced: Boolean(claimData.safeSportShieldEnforced),
        };
        setClaimedTeamsState(claimedResult);
      }

      if ((composedBirthMonthYear || validBirthYear !== null) && (localUser || currentUser)) {
        const dobResp = await fetch('/api/auth/birth-month', {
          method: 'POST',
          credentials: 'include',
          headers: authHeaders,
          body: JSON.stringify({
            ...(composedBirthMonthYear ? { birthMonthYear: composedBirthMonthYear } : {}),
            ...(validBirthYear !== null ? { birthYear: validBirthYear } : {}),
          }),
        }).catch(() => null);
        if (dobResp && !dobResp.ok) {
          const dobErr = await dobResp.json().catch(() => ({}));
          setJoinError(dobErr?.error || 'Could not save birth date.');
          return;
        }
      }

      // Kick off consented Strava sync non-blockingly in the background
      if (status.stravaConnected && syncWindow !== 'none' && onSyncNow) {
        void onSyncNow(syncWindow === 'all', syncWindow);
      }

      if (status.stravaConnected) {
        await submitCalibrationEntry(
          onboardingRole === 'COACH' && !activeBrand ? 'COACH_MODE' : 'WORKSPACE',
          savedPolicy,
          claimedResult
        );
        return;
      }

      setStep(3);
    } catch {
      setJoinError('Network error saving your sync preferences. Please try again.');
    } finally {
      setIsSavingStep2(false);
    }
  };

  const handleConnectGarminInline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!garminPersonalKey.trim()) return;
    setIsConnectingGarmin(true);
    setStepNotice(null);
    try {
      const resp = await fetch('/api/config/garmin', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ personalApiKey: garminPersonalKey.trim() }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setJoinError(data.error || 'Could not verify Garmin Personal API Key.');
      } else {
        try {
          localStorage.setItem(
            'aeropulse_garmin_personal_api_key',
            data.garminTokens?.personalApiKey || garminPersonalKey.trim()
          );
          if (data.garminAthleteName) {
            localStorage.setItem('aeropulse_garmin_athlete_name', data.garminAthleteName);
            if (!athleteName) setAthleteName(data.garminAthleteName);
          }
        } catch {
          // ignore
        }
        setGarminLinkedLocal(true);
        setExpandGarmin(false);
        setGarminPersonalKey('');
        setStepNotice(
          `Garmin Connect linked${data.garminAthleteName ? ` (${data.garminAthleteName})` : ''}!`
        );
        if (onSyncNow) void onSyncNow(false, syncWindow);
      }
    } finally {
      setIsConnectingGarmin(false);
    }
  };

  const handleConnectIntervalsInline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intervalsApiKey.trim() || !onConnectIntervals) return;
    setIsConnectingIntervals(true);
    setStepNotice(null);
    try {
      await onConnectIntervals(intervalsAthleteId.trim() || '0', intervalsApiKey.trim());
      setIntervalsApiKey('');
      setExpandIntervals(false);
      setStepNotice('Intervals.icu connected!');
    } finally {
      setIsConnectingIntervals(false);
    }
  };

  const handleFinalizeOnboarding = async (
    entryTarget: FirstRunCalibrationPayload['entryTarget'] = 'WORKSPACE'
  ) => {
    setIsEntering(true);
    setJoinError(null);
    try {
      await submitCalibrationEntry(entryTarget);
    } finally {
      setIsEntering(false);
    }
  };

  const handleCopyDomain = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(currentHostname).catch(() => {});
      setCopiedDomain(true);
      window.setTimeout(() => setCopiedDomain(false), 2000);
    }
  };

  const busy =
    isRedirecting ||
    isExchanging ||
    isSavingStep2 ||
    isEntering ||
    isConnectingGarmin ||
    isConnectingIntervals ||
    isGoogleRedirecting ||
    isSendingMagicLink;

  const secondaryConnected = Boolean(isGarminConnected || status.intervalsConnected);
  const showByoStravaSection = Boolean(
    showCustomStravaKeys || (errorMessage && /STRAVA_CLIENT_ID|not configured/i.test(errorMessage))
  );
  const isTeamCodeDrawerOpen = Boolean(showTeamCodeDrawer || activeBrand);

  const handleOpenTeamCodeDrawer = (alwaysOpen = false, shouldFocus = false) => {
    setShowTeamCodeDrawer((prev) => (alwaysOpen ? true : !prev));
    if (shouldFocus && typeof window !== 'undefined') {
      window.setTimeout(() => {
        teamCodeInputRef.current?.focus();
      }, 30);
    }
  };

  const [heroPreviewTab, setHeroPreviewTab] = useState<'stopwatch' | 'pods'>('stopwatch');

  const isSlateVariant =
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('ap-midnight-slate');

  return (
    <div className="min-h-dvh w-full max-w-full overflow-x-clip bg-ap-chalk dark:bg-ap-obsidian text-ap-ink dark:text-ap-chalk flex flex-col">
      <a href="#main-content" className="ap-skip-link">
        Skip to main content
      </a>

      {step === 1 ? (
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
                    disabled={busy || isSendingMagicLink}
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
                        disabled={busy || isGoogleRedirecting}
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
                        disabled={busy}
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
                  <div className="pt-2 border-t border-ap-frame/20 dark:border-white/15">
                    <button
                      type="button"
                      onClick={() => setShowCustomStravaKeys((prev) => !prev)}
                      className="w-full flex items-center justify-between text-xs font-semibold text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-white cursor-pointer py-1"
                    >
                      <span>Self-hosting MeetReady? Configure Strava API Keys</span>
                      {showCustomStravaKeys ? (
                        <ChevronUp className="w-4 h-4 shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 shrink-0" />
                      )}
                    </button>

                    {showCustomStravaKeys && (
                      <div className="mt-2 rounded-xl ap-card-inset p-3.5 space-y-3 text-xs">
                        <ol className="space-y-2 text-ap-ink/85 dark:text-ap-chalk/85 list-decimal list-inside leading-relaxed">
                          <li>
                            Open{' '}
                            <a
                              href="https://www.strava.com/settings/api"
                              target="_blank"
                              rel="noreferrer"
                              className="font-semibold underline ap-text-brand inline-flex items-center gap-1"
                            >
                              <span>strava.com/settings/api</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>{' '}
                            and set <strong>Authorization Callback Domain</strong> to:
                            <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-white dark:bg-ap-carbon px-3 py-1.5 font-mono">
                              <span className="font-bold text-ap-ink dark:text-white truncate">
                                {currentHostname}
                              </span>
                              <button
                                type="button"
                                onClick={handleCopyDomain}
                                className="inline-flex items-center gap-1 text-xs font-semibold ap-text-brand shrink-0 cursor-pointer"
                              >
                                {copiedDomain ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-ap-emerald" />
                                    <span>Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </li>
                          <li>Enter your Strava API Client ID and Secret:</li>
                        </ol>

                        <form onSubmit={handleSaveKeysAndLaunchStrava} className="space-y-2">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input
                              type="text"
                              required
                              aria-label="Strava API Client ID"
                              value={stravaClientId}
                              onChange={(e) => setStravaClientId(e.target.value)}
                              placeholder="Client ID (e.g. 123456)"
                              className="w-full min-h-[44px] sm:min-h-[40px] rounded-lg bg-white dark:bg-ap-carbon px-3 py-1.5 text-xs font-mono text-ap-ink dark:text-ap-chalk"
                            />
                            <input
                              type="password"
                              aria-label="Strava API Client Secret"
                              value={stravaClientSecret}
                              onChange={(e) => setStravaClientSecret(e.target.value)}
                              placeholder={
                                status.stravaClientId ? 'Client Secret (saved)' : 'Client Secret'
                              }
                              className="w-full min-h-[44px] sm:min-h-[40px] rounded-lg bg-white dark:bg-ap-carbon px-3 py-1.5 text-xs font-mono text-ap-ink dark:text-ap-chalk"
                            />
                          </div>
                          <button
                            type="submit"
                            disabled={busy || !stravaClientId.trim()}
                            className="w-full min-h-[44px] rounded-lg bg-ap-ink text-white dark:bg-ap-chalk dark:text-ap-obsidian disabled:opacity-50 font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <span>Save Keys &amp; Authorize Strava</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        </form>

                        {(onExchangeStravaCode || onSaveStravaDirectToken) && (
                          <details className="pt-1.5">
                            <summary className="cursor-pointer text-xs font-medium text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-white select-none">
                              Or paste a Strava Refresh Token / localhost callback URL
                            </summary>
                            <form onSubmit={handleManualExchangeSubmit} className="mt-2 space-y-2">
                              <input
                                type="text"
                                aria-label="Strava Refresh Token or localhost callback URL"
                                value={directRefreshToken || manualCodeInput}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val.includes('code=') || val.startsWith('http')) {
                                    setManualCodeInput(val);
                                    setDirectRefreshToken('');
                                  } else {
                                    setDirectRefreshToken(val);
                                    setManualCodeInput(val);
                                  }
                                }}
                                placeholder="Paste Refresh Token or http://localhost/...?code=..."
                                className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg bg-white dark:bg-ap-carbon px-3 py-1.5 text-xs font-mono text-ap-ink dark:text-ap-chalk"
                              />
                              <button
                                type="submit"
                                disabled={
                                  busy || (!manualCodeInput.trim() && !directRefreshToken.trim())
                                }
                                className="w-full min-h-[44px] rounded-lg ap-card-inset text-xs font-bold cursor-pointer"
                              >
                                Verify &amp; Connect
                              </button>
                            </form>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
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
                    onClick={() => setShowCoppaModal(true)}
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
      ) : (
        <div className="max-w-2xl w-full mx-auto px-4 sm:px-6 py-4 space-y-4">
          {/* Top Navigation Bar for Steps 2 & 3 */}
          <header className="relative overflow-hidden rounded-xl liquid-glass-header border border-ap-frame/15 dark:border-white/15 px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <AeroPulseLogo size="sm" teamBrand={activeBrand} />
              {!activeBrand && (
                <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-md text-2xs font-mono font-semibold uppercase tracking-wider bg-ap-inset text-ap-clay dark:bg-ap-turf dark:text-ap-volt">
                  Track &amp; Field · Cross Country
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              {step === 2 && isMinorAthlete && (
                <button
                  type="button"
                  onClick={() => setShowTeamCodeDrawer((prev) => !prev)}
                  aria-expanded={showTeamCodeDrawer}
                  className={`min-h-[44px] sm:min-h-[36px] px-3 sm:px-2.5 py-1.5 sm:py-1 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                    activeBrand || showTeamCodeDrawer
                      ? 'ap-nav-volt-active'
                      : 'liquid-capsule-track text-ap-ink dark:text-ap-chalk hover:opacity-85'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>{activeBrand ? activeBrand.shortName : 'Team Code'}</span>
                </button>
              )}

              <a
                href="/docs/"
                target="_blank"
                rel="noreferrer"
                className="min-h-[44px] sm:min-h-[36px] px-3 sm:px-2.5 py-1.5 sm:py-1 rounded-xl liquid-capsule-track text-xs font-semibold text-ap-ink dark:text-ap-chalk hover:opacity-85 inline-flex items-center gap-1 cursor-pointer"
              >
                <span>Guide</span>
                <ExternalLink className="w-3 h-3 opacity-75" />
              </a>

              {onToggleDark && (
                <button
                  type="button"
                  onClick={onToggleDark}
                  aria-label="Toggle color theme"
                  className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] px-2 py-1 rounded-xl liquid-capsule-track text-ap-ink dark:text-ap-chalk flex items-center justify-center cursor-pointer"
                  title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                >
                  {isDark ? (
                    <Sun className="w-4 h-4 text-[#D8FF2A]" weight="fill" />
                  ) : (
                    <Moon className="w-4 h-4 text-ap-ink dark:text-ap-chalk" weight="fill" />
                  )}
                </button>
              )}
            </div>
          </header>

          {/* Main Onboarding Card for Steps 2 & 3 */}
          <main
            id="main-content"
            tabIndex={-1}
            className="ap-card rounded-2xl relative overflow-hidden p-4 sm:p-8 space-y-6 focus:outline-none"
          >
            <ThreshBrandWatermark className="w-44 h-36 absolute right-3 bottom-3 pointer-events-none" />

            <nav
              aria-label="Onboarding steps"
              className="grid grid-cols-3 gap-1.5 sm:gap-2 px-0.5 py-0.5 text-xs relative z-10"
            >
              {(
                [
                  {
                    id: 1 as const,
                    label: '1. MeetReady Sign-In',
                    mobileLabel: '1. Sign In',
                    locked: false,
                  },
                  {
                    id: 2 as const,
                    label: onboardingRole === 'COACH' ? '2. Coach Quick-Start' : '2. Sync Choice',
                    mobileLabel: onboardingRole === 'COACH' ? '2. Quick-Start' : '2. Sync',
                    locked: !isUserAuthenticated,
                  },
                  {
                    id: 3 as const,
                    label: '3. Optional Add-Ons',
                    mobileLabel: '3. Add-Ons',
                    locked: !isUserAuthenticated,
                  },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={s.locked}
                  aria-current={step === s.id ? 'step' : undefined}
                  onClick={() => {
                    if (!s.locked) setStep(s.id);
                  }}
                  title={s.locked ? 'Sign in with your MeetReady account in Step 1 first' : s.label}
                  className={`min-h-[44px] sm:min-h-[38px] min-w-0 px-1.5 sm:px-2.5 py-1 transition-all ap-track-tab ${
                    step === s.id
                      ? 'ap-nav-volt-active cursor-pointer'
                      : s.locked
                        ? 'ap-track-tab-idle opacity-50 cursor-not-allowed'
                        : 'ap-track-tab-idle cursor-pointer'
                  }`}
                >
                  <span className="ap-track-tab-inner justify-center w-full min-w-0 gap-1">
                    {s.locked && <Lock className="w-3 h-3 shrink-0 opacity-70" />}
                    {!s.locked && step > s.id && (
                      <Check className="w-3 h-3 shrink-0 ap-text-brand" />
                    )}
                    <span className="sm:hidden truncate text-2xs">{s.mobileLabel}</span>
                    <span className="hidden sm:inline truncate">{s.label}</span>
                  </span>
                </button>
              ))}
            </nav>

            {(errorMessage || joinError) && (
              <div
                role="alert"
                className="ap-status-strained rounded-xl p-3.5 text-xs leading-relaxed break-words relative z-10"
              >
                {joinError || errorMessage}
              </div>
            )}

            {stepNotice && (
              <div
                role="status"
                aria-live="polite"
                className="ap-status-prime rounded-xl p-3 text-xs font-medium flex items-center gap-2 relative z-10"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{stepNotice}</span>
              </div>
            )}

          {/* ==============================================================
              STEP 2: EXPLICIT POST-AUTH STRAVA DATA SYNC & CALIBRATION
             ============================================================== */}
          {step === 2 && (
            <AuthOnboardingStepTwo
              formId={formId}
              status={status}
              localUser={localUser}
              activeBrand={activeBrand}
              onboardingRole={onboardingRole}
              selectOnboardingRole={selectOnboardingRole}
              setStep={setStep}
              syncWindow={syncWindow}
              setSyncWindow={setSyncWindow}
              importProfileAndGear={importProfileAndGear}
              setImportProfileAndGear={setImportProfileAndGear}
              athleteName={athleteName}
              setAthleteName={setAthleteName}
              birthYear={birthYear}
              setBirthYear={setBirthYear}
              birthMonth={birthMonth}
              setBirthMonth={setBirthMonth}
              parentGuardianEmail={parentGuardianEmail}
              setParentGuardianEmail={setParentGuardianEmail}
              deferParentEmail={deferParentEmail}
              onToggleDeferParentEmail={setDeferParentEmail}
              primarySport={primarySport}
              setPrimarySport={setPrimarySport}
              distanceUnit={distanceUnit}
              setDistanceUnit={setDistanceUnit}
              setHasEditedUnits={setHasEditedUnits}
              selectedSeedEventId={selectedSeedEventId}
              setSelectedSeedEventId={setSelectedSeedEventId}
              rawSeedValue={rawSeedValue}
              setRawSeedValue={setRawSeedValue}
              safeSportHideWeight={safeSportHideWeight}
              setSafeSportHideWeight={setSafeSportHideWeight}
              sharingTier={sharingTier}
              setSharingTier={setSharingTier}
              isSavingStep2={isSavingStep2}
              showTeamCodeDrawer={showTeamCodeDrawer}
              setShowTeamCodeDrawer={setShowTeamCodeDrawer}
              joinCodeInput={joinCodeInput}
              setJoinCodeInput={setJoinCodeInput}
              setJoinSlug={setJoinSlug}
              inviteToken={inviteToken}
              setInviteToken={setInviteToken}
              isLoadingPreview={isLoadingPreview}
              currentYear={currentYear}
              isUnder13={isUnder13}
              isMinorAthlete={isMinorAthlete}
              lacksActivityScope={lacksActivityScope}
              selectedSeedPill={selectedSeedPill}
              composedSeedMark={composedSeedMark}
              liveSeedCalibration={liveSeedCalibration}
              lookupTeamPreview={lookupTeamPreview}
              handleStravaLaunchClick={handleStravaLaunchClick}
              handleSwitchStravaAccount={handleSwitchStravaAccount}
              handleConfirmStep2={handleConfirmStep2}
              handleFinalizeOnboarding={handleFinalizeOnboarding}
              busy={busy}
            />
          )}

          {/* ==============================================================
              STEP 3: OPTIONAL GARMIN CONNECT OR INTERVALS.ICU (NEVER MANDATORY)
             ============================================================== */}
          {step === 3 && (
            <AuthOptionalAddonsStep
              formId={formId}
              status={status}
              localUser={localUser}
              syncWindow={syncWindow}
              isSyncing={isSyncing}
              isEntering={isEntering}
              isGarminConnected={isGarminConnected}
              secondaryConnected={secondaryConnected}
              busy={busy}
              claimedTeamsState={claimedTeamsState}
              expandGarmin={expandGarmin}
              setExpandGarmin={setExpandGarmin}
              garminPersonalKey={garminPersonalKey}
              setGarminPersonalKey={setGarminPersonalKey}
              isConnectingGarmin={isConnectingGarmin}
              expandIntervals={expandIntervals}
              setExpandIntervals={setExpandIntervals}
              intervalsAthleteId={intervalsAthleteId}
              setIntervalsAthleteId={setIntervalsAthleteId}
              intervalsApiKey={intervalsApiKey}
              setIntervalsApiKey={setIntervalsApiKey}
              isConnectingIntervals={isConnectingIntervals}
              setStep={setStep}
              onOpenArchiveWizard={() => setShowArchiveWizard(true)}
              onLaunchIntervalsOAuth={onLaunchIntervalsOAuth}
              onLaunchGarminOAuth={onLaunchGarminOAuth}
              onLaunchCorosOAuth={onLaunchCorosOAuth}
              onLaunchWahooOAuth={onLaunchWahooOAuth}
              onLaunchPolarOAuth={onLaunchPolarOAuth}
              handleConnectGarminInline={handleConnectGarminInline}
              handleConnectIntervalsInline={handleConnectIntervalsInline}
              handleFinalizeOnboarding={handleFinalizeOnboarding}
            />
          )}

          {(status.stravaConnected || localUser) && onDisconnectCredentials && (
            <div className="pt-3 border-t border-slate-200/80 dark:border-white/10 flex justify-end relative z-10">
              <button
                type="button"
                onClick={() => void handleSwitchStravaAccount()}
                className="text-xs text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Disconnect &amp; start over</span>
              </button>
            </div>
          )}
        </main>

        <footer className="ap-card-inset rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5 text-xs text-slate-600 dark:text-slate-300 relative z-10">
          <span className="font-mono text-2xs font-semibold text-slate-600 dark:text-slate-400">
            MeetReady — Every mark. Every mile.
          </span>
          <div className="flex flex-wrap items-center gap-4 font-medium">
            <a
              href="/docs/"
              className="min-h-[44px] sm:min-h-[32px] inline-flex items-center hover:text-slate-950 dark:hover:text-white transition-colors"
            >
              Guide &amp; Docs
            </a>
            <a
              href="/brand"
              onClick={(e) => {
                if (onOpenBrandStudio && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                  e.preventDefault();
                  onOpenBrandStudio();
                }
              }}
              className="min-h-[44px] sm:min-h-[32px] inline-flex items-center font-semibold ap-text-brand hover:underline cursor-pointer"
            >
              Brand &amp; Style Guide
            </a>
            <a
              href="/docs/#sec-safesport"
              className="min-h-[44px] sm:min-h-[32px] inline-flex items-center hover:text-slate-950 dark:hover:text-white transition-colors"
            >
              Safe-Sport &amp; Privacy
            </a>
          </div>
        </footer>
        </div>
      )}

      {showArchiveWizard && (
        <WorkspaceErrorBoundary fallbackTitle="Archive Import Wizard">
          <Suspense fallback={null}>
            <ArchiveOnboardingWizard
              isOpen={showArchiveWizard}
              onClose={() => setShowArchiveWizard(false)}
              existingActivities={existingActivities}
              distanceUnit={distanceUnit}
              onImportBatch={(acts) => {
                onImportBatchActivities?.(acts);
              }}
              onCompleteOnboarding={async () => {
                setShowArchiveWizard(false);
                if (onBypassToLocalSession) {
                  await onBypassToLocalSession();
                }
                setStep(3);
              }}
            />
          </Suspense>
        </WorkspaceErrorBoundary>
      )}

      {showCoppaModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="coppa-explainer-title"
          data-testid="coppa-explainer-modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCoppaModal(false);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65"
        >
          <div className="w-full max-w-lg ap-card rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-ap-emerald shrink-0" weight="fill" />
                <h2
                  id="coppa-explainer-title"
                  className="text-base sm:text-lg font-extrabold text-ap-ink dark:text-ap-chalk"
                >
                  COPPA 13+ &amp; Youth Athlete Protection
                </h2>
              </div>
              <button
                type="button"
                data-testid="coppa-explainer-close"
                aria-label="Close COPPA explanation"
                onClick={() => setShowCoppaModal(false)}
                className="min-h-[44px] min-w-[44px] -m-1.5 rounded-xl ap-card-inset inline-flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs sm:text-sm leading-relaxed text-ap-ink/90 dark:text-ap-chalk/90">
              <div className="rounded-xl ap-card-inset p-3.5 space-y-1">
                <div className="font-bold text-ap-ink dark:text-ap-chalk">
                  1. Accounts require athletes to be 13 or older (Federal COPPA)
                </div>
                <p className="text-xs text-ap-muted dark:text-ap-muted-dark">
                  Athletes under age 13 cannot register personal MeetReady logins or connect personal
                  wearable accounts.
                </p>
              </div>

              <div className="rounded-xl ap-card-inset p-3.5 space-y-1">
                <div className="font-bold text-ap-ink dark:text-ap-chalk">
                  2. Under-13 athletes can still be timed trackside
                </div>
                <p className="text-xs text-ap-muted dark:text-ap-muted-dark">
                  Coaches use MeetReady&apos;s Trackside Stopwatch and Field Events Sheet watchlessly
                  to time races and record marks without creating child accounts or collecting child
                  emails.
                </p>
              </div>

              <div className="rounded-xl ap-card-inset p-3.5 space-y-1">
                <div className="font-bold text-ap-ink dark:text-ap-chalk">
                  3. Ages 13–17 enforce Parent / Guardian visibility (SafeSport MAAPP)
                </div>
                <p className="text-xs text-ap-muted dark:text-ap-muted-dark">
                  High school and youth athletes aged 13–17 automatically include Guardian CC on
                  coach–athlete messages and workout comments — private 1:1 adult–minor messaging is
                  never allowed.
                </p>
              </div>

              <div className="rounded-xl ap-card-inset p-3.5 space-y-1">
                <div className="font-bold text-ap-ink dark:text-ap-chalk">
                  4. SafeSport Weight Shield &amp; No Advertising. Ever.
                </div>
                <p className="text-xs text-ap-muted dark:text-ap-muted-dark">
                  Body weight, BMI, and power-to-weight ratios are stripped from team views by
                  default, and athlete data is never used for advertising or sold to third parties.
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowCoppaModal(false)}
                className="min-h-[44px] px-4 rounded-xl bg-ap-volt hover:brightness-95 text-ap-obsidian font-extrabold text-xs cursor-pointer"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
