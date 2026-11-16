import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  KeyRound,
  Lightning,
  Lock,
  LogOut,
  Moon,
  RefreshCw,
  Send,
  ShieldCheck,
  Sun,
  UploadSimple,
  Users,
} from './icons/PhosphorIcons';
import { ArchiveOnboardingWizard } from './ArchiveOnboardingWizard';
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
import { applyTeamBrandToDocument } from '../utils/teamBrandDom';
import {
  authenticateWithPasskey,
  isPasskeySupported,
  registerPasskey,
} from '../utils/passkeyAuth';
import { AeroPulseLogo, ThreshBrandWatermark } from './AeroPulseLogo';
import {
  getSavedIntervalsHeaders,
  saveStravaSyncPolicyToStorage,
} from '../utils/telemetryStorage';

export interface FirstRunCalibrationPayload {
  athleteName: string;
  primarySport: 'Cycling' | 'Running' | 'Hybrid';
  distanceUnit: DistanceUnit;
  hasCustomSeedMark?: boolean;
  weightDisplay?: number;
  cyclingFtpWatts?: number;
  thresholdPaceInput?: string;
  safeSportHideWeight?: boolean;
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
  onLaunchWahooOAuth?: () => Promise<void>;
  onLaunchPolarOAuth?: () => Promise<void>;
  onSyncNow?: (fullHistory?: boolean, explicitWindow?: StravaSyncWindow) => Promise<void>;
  onCompleteCalibrationEntry?: (payload: FirstRunCalibrationPayload) => Promise<void>;
  onDisconnectCredentials?: () => Promise<void>;
  isSyncing: boolean;
  errorMessage: string | null;
  isDark?: boolean;
  onToggleDark?: () => void;
  onEnterSampleDemo?: () => void;
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

const StravaChevronMark: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
  </svg>
);

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

const SEED_EVENT_PILLS: Array<{
  id: string;
  label: string;
  sport: 'Running' | 'Cycling';
  prefix: string;
  placeholder: string;
}> = [
  { id: '5k', label: '5K Race', sport: 'Running', prefix: '5K ', placeholder: 'e.g. 18:45' },
  { id: '3200m', label: '3200m', sport: 'Running', prefix: '3200m ', placeholder: 'e.g. 10:15' },
  { id: '1600m', label: '1600m / Mile', sport: 'Running', prefix: '1600m ', placeholder: 'e.g. 4:52' },
  { id: '800m', label: '800m', sport: 'Running', prefix: '800m ', placeholder: 'e.g. 2:04' },
  { id: 'ftp', label: 'Known FTP', sport: 'Cycling', prefix: '', placeholder: 'e.g. 265W' },
  { id: '20m', label: '20m Power', sport: 'Cycling', prefix: '20m ', placeholder: 'e.g. 280W' },
];

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

  // THRESH User Identity State (Self-Hosted Auth: Google, Passkey, Magic Link, Strava)
  const [localUser, setLocalUser] = useState<ThreshUser | null>(
    currentUser || status.currentUser || null
  );
  const [magicLinkEmail, setMagicLinkEmail] = useState(initialJoin.email || '');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [magicLinkDevUrl, setMagicLinkDevUrl] = useState<string | null>(null);
  const [isSendingMagicLink, setIsSendingMagicLink] = useState(false);
  const [isPasskeyAuthenticating, setIsPasskeyAuthenticating] = useState(false);
  const [showPasskeyRegister, setShowPasskeyRegister] = useState(false);
  const [passkeyRegEmail, setPasskeyRegEmail] = useState(initialJoin.email || '');
  const [isPasskeyRegistering, setIsPasskeyRegistering] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeySupported, setPasskeySupported] = useState<boolean>(true);
  const [isGoogleRedirecting, setIsGoogleRedirecting] = useState(false);
  const [onboardingRole, setOnboardingRole] = useState<'ATHLETE' | 'COACH'>('ATHLETE');

  const isUserAuthenticated = Boolean(status.stravaConnected || localUser || currentUser);
  const [step, setStep] = useState<WizardStep>(() =>
    status.stravaConnected || currentUser || status.currentUser ? 2 : 1
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
  const [parentGuardianEmail, setParentGuardianEmail] = useState<string>('');
  const [primarySport, setPrimarySport] = useState<'Cycling' | 'Running' | 'Hybrid'>('Running');
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
  const isMinorByBirthYear =
    !isNaN(parsedBirthYear) && parsedBirthYear > 1900 && currentYear - parsedBirthYear < 18;
  const isMinorAthlete = Boolean(
    invitePreview?.brand?.orgType === 'HIGH_SCHOOL' ||
      invitePreview?.membership?.isMinorU18 ||
      isMinorByBirthYear
  );

  useEffect(() => {
    if (isMinorAthlete) {
      setSafeSportHideWeight(true);
    }
  }, [isMinorAthlete]);

  const currentHostname =
    typeof window !== 'undefined' ? window.location.hostname : 'thresh.app';

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

  // Check WebAuthn passkey availability
  useEffect(() => {
    void isPasskeySupported().then(setPasskeySupported);
  }, []);

  // Hydrate session if already signed in via THRESH session cookie
  useEffect(() => {
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const justSignedIn = search.includes('auth_just_signed_in=1');
    if (justSignedIn) {
      try {
        localStorage.removeItem('aeropulse_logged_out');
      } catch {
        // ignore
      }
    }
    if (!localUser && !currentUser && !status.stravaConnected) {
      fetch('/api/auth/me', { credentials: 'include' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.authenticated && data?.user) {
            try {
              const notLoggedOut = localStorage.getItem('aeropulse_logged_out') !== '1';
              if (justSignedIn) localStorage.removeItem('aeropulse_logged_out');
              if ((justSignedIn || notLoggedOut) && data.sessionToken) {
                localStorage.setItem('aeropulse_session_token', String(data.sessionToken));
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
  }, [localUser, currentUser, status.stravaConnected, athleteName, athleteEmail, onAuthenticatedUser]);

  // Automatically advance from Step 1 -> Step 2 once Strava OAuth completes or user authenticates!
  useEffect(() => {
    if ((status.stravaConnected || localUser) && step === 1) {
      setStep(2);
    }
  }, [status.stravaConnected, localUser, step]);

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

  const handlePasskeySignIn = async () => {
    setIsPasskeyAuthenticating(true);
    setPasskeyError(null);
    setJoinError(null);
    try {
      const result = await authenticateWithPasskey();
      if (result.ok && result.user) {
        setLocalUser(result.user);
        if (result.user.name && !athleteName) setAthleteName(result.user.name);
        if (result.user.email && !athleteEmail) setAthleteEmail(result.user.email);
        onAuthenticatedUser?.(result.user);
        setStepNotice(`Signed in with Passkey (${result.user.name || result.user.email})!`);
        setStep(2);
      } else {
        setPasskeyError(result.error || 'Passkey authentication failed.');
        setShowPasskeyRegister(true);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPasskeyError(msg);
      setShowPasskeyRegister(true);
    } finally {
      setIsPasskeyAuthenticating(false);
    }
  };

  const handlePasskeyRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passkeyRegEmail.trim()) return;
    setIsPasskeyRegistering(true);
    setPasskeyError(null);
    try {
      const result = await registerPasskey(
        passkeyRegEmail.trim(),
        athleteName.trim() || undefined
      );
      if (result.ok && result.user) {
        setLocalUser(result.user);
        if (result.user.name && !athleteName) setAthleteName(result.user.name);
        if (result.user.email && !athleteEmail) setAthleteEmail(result.user.email);
        onAuthenticatedUser?.(result.user);
        setShowPasskeyRegister(false);
        setStepNotice('Passkey registered and signed in!');
        setStep(2);
      } else {
        setPasskeyError(result.error || 'Passkey registration failed.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPasskeyError(msg);
    } finally {
      setIsPasskeyRegistering(false);
    }
  };

  const handleSendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
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
        body: JSON.stringify({ email: cleanEmail }),
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

  // Step 2 Confirmation: Save Sync Policy + Claim Team Invite (if present) + Kick off Background Sync + Advance to Step 3
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
      const sessionTokenHeader =
        typeof window !== 'undefined'
          ? localStorage.getItem('aeropulse_session_token') || ''
          : '';
      const authHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...getSavedIntervalsHeaders(),
        ...(sessionTokenHeader ? { 'x-session-token': sessionTokenHeader } : {}),
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

      // Youth Protection Gate (COPPA & Scholastic Safe-Sport)
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
        !invitePreview?.membership?.parentGuardianEmail
      ) {
        setJoinError(
          'Parent or guardian email is required for athletes under 18 to complete registration.'
        );
        return;
      }

      // If athlete is joining a team, claim their roster spot now with their verified Strava identity!
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
            birthYear:
              !isNaN(parsedBirthYear) && parsedBirthYear > 1900 ? parsedBirthYear : undefined,
            parentGuardianEmail: parentGuardianEmail.trim() || undefined,
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
        setClaimedTeamsState({
          teams: allTeams,
          activeTeamId: claimedTeam?.brand?.teamId,
          sessionToken: claimData.sessionToken,
          calibratedFtp: claimData.calibrated?.cyclingFtpWatts,
          calibratedPace: claimData.calibrated?.thresholdPaceInputDisplay,
          safeSportEnforced: Boolean(claimData.safeSportShieldEnforced),
        });
      }

      // Kick off consented Strava sync non-blockingly in the background while user views Step 3!
      if (status.stravaConnected && syncWindow !== 'none' && onSyncNow) {
        void onSyncNow(syncWindow === 'all', syncWindow);
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
      const sessionTokenHeader =
        typeof window !== 'undefined'
          ? localStorage.getItem('aeropulse_session_token') || ''
          : '';
      const resp = await fetch('/api/config/garmin', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionTokenHeader ? { 'x-session-token': sessionTokenHeader } : {}),
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
      const hasCustomSeedMark = Boolean(composedSeedMark.trim());
      if (onCompleteCalibrationEntry) {
        await onCompleteCalibrationEntry({
          athleteName:
            athleteName.trim() ||
            status.stravaAthleteName ||
            status.garminAthleteName ||
            'Athlete',
          primarySport:
            claimedTeamsState?.teams?.[0]?.brand?.primarySport || primarySport,
          distanceUnit,
          hasCustomSeedMark,
          cyclingFtpWatts: hasCustomSeedMark
            ? claimedTeamsState?.calibratedFtp || liveSeedCalibration.cyclingFtpWatts
            : undefined,
          thresholdPaceInput: hasCustomSeedMark
            ? claimedTeamsState?.calibratedPace ||
              liveSeedCalibration.thresholdPaceInputDisplay
            : undefined,
          safeSportHideWeight: isMinorAthlete
            ? true
            : Boolean(claimedTeamsState?.safeSportEnforced || safeSportHideWeight),
          stravaSyncPolicy: confirmedPolicy,
          claimedTeams: claimedTeamsState?.teams,
          activeTeamId: claimedTeamsState?.activeTeamId,
          sessionToken: claimedTeamsState?.sessionToken,
          entryTarget,
        });
      }
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
    isPasskeyAuthenticating ||
    isPasskeyRegistering ||
    isSendingMagicLink;

  const secondaryConnected = Boolean(isGarminConnected || status.intervalsConnected);
  const showByoStravaSection = Boolean(
    status.stravaConfigured === false || showCustomStravaKeys
  );

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-clip py-4 sm:py-8 px-3 sm:px-6 flex flex-col justify-center">
      <a href="#main-content" className="ap-skip-link">
        Skip to main content
      </a>
      <div className="max-w-2xl w-full mx-auto space-y-4">
        {/* Clean Top Navigation Bar */}
        <header className="relative overflow-hidden rounded-2xl liquid-glass-header px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="ap-brand-hairline absolute inset-x-0 top-0" aria-hidden="true" />
          <div className="flex items-center gap-2.5">
            <AeroPulseLogo size="sm" teamBrand={activeBrand} />
            {!activeBrand && (
              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-md text-2xs font-mono font-semibold uppercase tracking-wider bg-[#E3ECE5] text-[#1C5436] dark:bg-[#15231B] dark:text-[#C8FF00]">
                Run &amp; Ride Readiness
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {(step === 1 || (step === 2 && isMinorAthlete)) && (
              <button
                type="button"
                onClick={() => setShowTeamCodeDrawer((prev) => !prev)}
                aria-expanded={showTeamCodeDrawer}
                className={`min-h-[44px] sm:min-h-[36px] px-3 sm:px-2.5 py-1.5 sm:py-1 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                  activeBrand || showTeamCodeDrawer
                    ? 'ap-nav-volt-active'
                    : 'liquid-capsule-track text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white'
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
              className="min-h-[44px] sm:min-h-[36px] px-3 sm:px-2.5 py-1.5 sm:py-1 rounded-xl liquid-capsule-track text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white inline-flex items-center gap-1 cursor-pointer"
            >
              <span>Guide</span>
              <ExternalLink className="w-3 h-3 opacity-75" />
            </a>

            {onToggleDark && (
              <button
                type="button"
                onClick={onToggleDark}
                aria-label="Toggle color theme"
                className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] px-2 py-1 rounded-xl liquid-capsule-track text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer"
                title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              >
                {isDark ? (
                  <Sun className="w-4 h-4 text-[#C8FF00]" weight="fill" />
                ) : (
                  <Moon className="w-4 h-4 text-[#1D3828]" weight="fill" />
                )}
              </button>
            )}
          </div>
        </header>

        {/* Main Stadium Track Framed Stage */}
        <main id="main-content" tabIndex={-1} className="ap-content-stage relative overflow-hidden p-4 sm:p-8 space-y-6 focus:outline-none">
          <ThreshBrandWatermark className="w-44 h-36 absolute right-3 bottom-3 pointer-events-none" />

          {/* 3-Step Stadium Track Progress Bar */}
          <nav
            aria-label="Onboarding steps"
            className="grid grid-cols-3 gap-1.5 sm:gap-2 px-0.5 py-0.5 text-xs relative z-10"
          >
            {(
              [
                {
                  id: 1 as const,
                  label: '1. THRESH Sign-In',
                  mobileLabel: '1. Sign In',
                  locked: false,
                },
                {
                  id: 2 as const,
                  label: '2. Sync Choice',
                  mobileLabel: '2. Sync',
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
                title={
                  s.locked ? 'Sign in with your THRESH account in Step 1 first' : s.label
                }
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
              STEP 1: THRESH IDENTITY (GOOGLE, PASSKEYS, MAGIC LINK & STRAVA)
             ============================================================== */}
          {step === 1 && (
            <div className="space-y-5 relative z-10">
              <div className="space-y-3">
                {!activeBrand && (
                  <div
                    role="group"
                    aria-label="Choose your THRESH role"
                    className="inline-flex items-center gap-1 p-1 rounded-xl liquid-capsule-track"
                  >
                    <button
                      type="button"
                      data-testid="onboarding-role-athlete"
                      aria-pressed={onboardingRole === 'ATHLETE'}
                      onClick={() => setOnboardingRole('ATHLETE')}
                      className={`min-h-[40px] sm:min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                        onboardingRole === 'ATHLETE'
                          ? 'ap-nav-volt-active'
                          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      I&apos;m an Athlete
                    </button>
                    <button
                      type="button"
                      data-testid="onboarding-role-coach"
                      aria-pressed={onboardingRole === 'COACH'}
                      onClick={() => setOnboardingRole('COACH')}
                      className={`min-h-[40px] sm:min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                        onboardingRole === 'COACH'
                          ? 'ap-nav-volt-active'
                          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      I&apos;m a Coach
                    </button>
                  </div>
                )}

                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight">
                  {activeBrand
                    ? `Join ${activeBrand.name} on THRESH`
                    : onboardingRole === 'COACH'
                      ? 'Coach Your Squad’s Pace Groups, Calendar & Track Splits.'
                      : 'Know How Hard to Push Today—Before You Lace Up or Clip In.'}
                </h1>
                {activeBrand && (
                  <div>
                    <span className="ap-lane-badge">
                      <span className="ap-lane-badge-inner">
                        {`Team Roster Invite · ${activeBrand.joinCode}`}
                      </span>
                    </span>
                  </div>
                )}
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  {activeBrand
                    ? `Sign in to verify your athlete identity for Coach ${activeBrand.coachDisplayName}'s roster. You'll choose your sync choices on the next screen.`
                    : 'Create your free THRESH athlete account with Google, Passkey, Magic Link, or Strava.'}
                </p>
              </div>

              {/* Active or Expandable Team Invite Code Lookup */}
              {showTeamCodeDrawer && (
                <div className="liquid-glass rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <Users className="w-4 h-4 ap-text-brand" />
                      <span>Joining a High School, College, or Club Team?</span>
                    </span>
                    {!activeBrand && (
                      <button
                        type="button"
                        onClick={() => setShowTeamCodeDrawer(false)}
                        className="min-h-[44px] sm:min-h-[32px] px-2 text-2xs font-mono text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                      >
                        Hide
                      </button>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={joinCodeInput}
                      aria-label="Enter 6-character Team Join Code"
                      onChange={(e) => {
                        setJoinCodeInput(e.target.value.toUpperCase());
                        setJoinSlug(undefined);
                        setInviteToken('');
                      }}
                      placeholder="Enter 6-char Team Code (e.g. PAXC-26)"
                      className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-2 text-sm font-mono font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      disabled={isLoadingPreview || !joinCodeInput.trim()}
                      onClick={() => void lookupTeamPreview(joinCodeInput, inviteToken)}
                      className="ap-btn-secondary !min-h-[44px] w-full sm:w-auto text-xs shrink-0 cursor-pointer"
                    >
                      {isLoadingPreview ? 'Checking…' : 'Apply Code'}
                    </button>
                  </div>

                  {activeBrand && (() => {
                    const bannerPalette = computeAccessibleTeamPalette(
                      activeBrand.primaryHex,
                      activeBrand.secondaryHex,
                    );
                    return (
                      <div
                        className="rounded-xl p-3.5 shadow-sm space-y-1"
                        style={{
                          background: `linear-gradient(135deg, ${bannerPalette.primaryOnLight} 0%, ${bannerPalette.secondaryOnLight} 100%)`,
                          color: bannerPalette.textOnPrimaryLight,
                        }}
                      >
                        <div className="flex items-center justify-between gap-2 text-2xs font-mono uppercase tracking-wider opacity-95">
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
                            className="text-2xs font-mono underline opacity-90 hover:opacity-100 cursor-pointer"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Embedded In-App Browser Warning (GroupMe / Instagram / Snapchat) */}
              {isEmbeddedWebView && (
                <div className="ap-status-caution rounded-xl p-3 text-xs leading-relaxed">
                  <strong>Tip for mobile team links:</strong> If external sign-in is blocked inside this messaging app, tap <strong>⋯ → Open in Safari / Chrome</strong>.
                </div>
              )}

              {/* Primary THRESH Sign-In Card (Google, Passkeys, Magic Link & Strava) */}
              <div className="liquid-glass rounded-2xl p-4 sm:p-5 space-y-4">
                {/* 1. Continue with Google */}
                <button
                  type="button"
                  onClick={() => void handleGoogleSignIn()}
                  disabled={busy || isGoogleRedirecting}
                  className="w-full !min-h-[48px] py-2.5 px-4 rounded-xl border border-slate-300 dark:border-white/15 bg-white dark:bg-[#15231B] text-slate-800 dark:text-white font-bold text-sm flex items-center justify-center gap-3 shadow-xs hover:bg-slate-50 dark:hover:bg-[#1B3024] cursor-pointer transition-colors"
                >
                  {isGoogleRedirecting ? (
                    <RefreshCw className="w-4 h-4 animate-spin text-slate-500" />
                  ) : (
                    <GoogleGIcon className="w-4 h-4" />
                  )}
                  <span>{isGoogleRedirecting ? 'Connecting to Google…' : 'Continue with Google'}</span>
                </button>

                {/* 2. Biometric Passkey (Touch ID / Face ID / WebAuthn) */}
                {passkeySupported && (
                  <button
                    type="button"
                    onClick={() => void handlePasskeySignIn()}
                    disabled={busy || isPasskeyAuthenticating}
                    className="w-full !min-h-[48px] py-2.5 px-4 rounded-xl border border-emerald-600/30 dark:border-emerald-400/20 bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 font-bold text-sm flex items-center justify-center gap-2.5 hover:bg-emerald-500/20 cursor-pointer transition-colors"
                  >
                    {isPasskeyAuthenticating ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <KeyRound className="w-4 h-4" />
                    )}
                    <span>
                      {isPasskeyAuthenticating
                        ? 'Authenticating with Touch ID / Face ID…'
                        : 'Sign in with Passkey (Biometrics)'}
                    </span>
                  </button>
                )}

                {/* Passkey registration dialog / fallback */}
                {showPasskeyRegister && (
                  <form
                    onSubmit={handlePasskeyRegister}
                    className="rounded-xl border border-emerald-600/40 p-3 space-y-2.5 bg-emerald-500/5 text-xs"
                  >
                    <div className="flex items-center justify-between font-semibold text-slate-800 dark:text-slate-200">
                      <span>Register Passkey for this device</span>
                      <button
                        type="button"
                        onClick={() => setShowPasskeyRegister(false)}
                        className="text-2xs font-mono text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                    {passkeyError && (
                      <p className="text-2xs text-rose-500 dark:text-rose-400">{passkeyError}</p>
                    )}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="email"
                        required
                        value={passkeyRegEmail}
                        onChange={(e) => setPasskeyRegEmail(e.target.value)}
                        placeholder="Enter your email to link passkey"
                        className="flex-1 min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 text-xs text-slate-900 dark:text-white"
                      />
                      <button
                        type="submit"
                        disabled={isPasskeyRegistering || !passkeyRegEmail.trim()}
                        className="ap-btn-primary !min-h-[40px] px-3 text-xs shrink-0 cursor-pointer"
                      >
                        {isPasskeyRegistering ? 'Registering…' : 'Save Passkey'}
                      </button>
                    </div>
                  </form>
                )}

                {/* Divider: or email magic link */}
                <div className="relative flex items-center justify-center my-1">
                  <div className="border-t border-slate-200 dark:border-white/10 w-full" />
                  <span className="bg-white/80 dark:bg-[#101B15] px-3 text-2xs uppercase tracking-wider text-slate-500 font-mono absolute">
                    or email magic link
                  </span>
                </div>

                {/* 3. Email Magic Link Form */}
                <form onSubmit={handleSendMagicLink} className="space-y-2">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="email"
                      required
                      value={magicLinkEmail}
                      onChange={(e) => {
                        setMagicLinkEmail(e.target.value);
                        setMagicLinkSent(false);
                      }}
                      placeholder="athlete@domain.com"
                      className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3.5 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                    />
                    <button
                      type="submit"
                      disabled={busy || isSendingMagicLink || !magicLinkEmail.trim()}
                      className="ap-btn-secondary !min-h-[44px] px-4 text-xs font-bold inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      {isSendingMagicLink ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5 ap-text-brand" />
                      )}
                      <span>{isSendingMagicLink ? 'Sending…' : 'Send Sign-In Link'}</span>
                    </button>
                  </div>
                  {magicLinkSent && (
                    <div className="ap-status-prime rounded-xl p-3 text-xs space-y-1.5">
                      <div className="flex items-center gap-2 font-bold">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>Check your inbox for a secure sign-in link!</span>
                      </div>
                      <p className="text-2xs opacity-90">
                        We sent a 15-minute login token to <strong>{magicLinkEmail}</strong>.
                      </p>
                      {magicLinkDevUrl && (
                        <div className="pt-1.5 border-t border-emerald-500/20">
                          <span className="font-mono text-2xs uppercase tracking-wider opacity-75 mr-2">
                            Dev Link:
                          </span>
                          <a
                            href={magicLinkDevUrl}
                            className="text-2xs font-bold underline ap-text-brand hover:opacity-80"
                          >
                            Complete Sign-In Now →
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </form>

                {/* Divider: or connect with Strava */}
                <div className="relative flex items-center justify-center my-1">
                  <div className="border-t border-slate-200 dark:border-white/10 w-full" />
                  <span className="bg-white/80 dark:bg-[#101B15] px-3 text-2xs uppercase tracking-wider text-slate-500 font-mono absolute">
                    or strava connector
                  </span>
                </div>

                {/* 4. Connect with Strava */}
                <button
                  type="button"
                  onClick={() => void handleStravaLaunchClick('cloud', false)}
                  disabled={busy}
                  className="ap-btn-strava w-full !min-h-[48px] py-2.5 px-4 rounded-xl disabled:opacity-60 font-bold text-sm flex items-center justify-center gap-2.5 shadow-sm cursor-pointer"
                >
                  {isRedirecting ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <StravaChevronMark className="w-4 h-4" />
                  )}
                  <span>
                    {isRedirecting
                      ? 'Opening Strava Sign-In…'
                      : activeBrand
                        ? `Connect with Strava to Join ${activeBrand.shortName}`
                        : 'Connect with Strava'}
                  </span>
                </button>

                <p className="text-2xs text-center text-slate-500 dark:text-slate-400 leading-relaxed">
                  THRESH secures your identity across devices. <strong>Nothing syncs until you choose your sync window in Step 2.</strong>
                </p>

                {/* 4-Point Read-Only Privacy Pledge */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-slate-200/80 dark:border-white/10 text-xs">
                  <div className="rounded-xl liquid-glass-subtle p-2.5 flex items-start gap-2">
                    <ShieldCheck className="w-4 h-4 ap-text-brand shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">
                        100% Read-Only Access
                      </div>
                      <div className="text-2xs text-slate-600 dark:text-slate-400">
                        Never posts to feeds, edits titles, or alters workouts.
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl liquid-glass-subtle p-2.5 flex items-start gap-2">
                    <Activity className="w-4 h-4 ap-text-brand shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">
                        You Choose What Syncs
                      </div>
                      <div className="text-2xs text-slate-600 dark:text-slate-400">
                        Pick Last 90 Days, Full Archive, or Identity-Only in Step 2.
                      </div>
                    </div>
                  </div>
                </div>

                {onEnterSampleDemo && (
                  <div className="pt-3 border-t border-slate-200/80 dark:border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
                        <span className="ap-badge-volt px-1.5 py-0.5 rounded text-2xs font-mono uppercase">
                          Sample Demo
                        </span>
                        <span>Preview Before Connecting</span>
                      </div>
                      <p className="text-2xs text-slate-600 dark:text-slate-400">
                        Inspect live Banister PMC curves, 1Hz streams, adaptive daily prescriptions, and trackside split timing with illustrative sample data.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={onEnterSampleDemo}
                      className="ap-btn-secondary !min-h-[44px] px-4 py-2 text-xs font-bold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <span>Explore Sample Cockpit</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* 100% Offline Multi-Source Archive Importer Entry */}
                <div className="pt-3 border-t border-slate-200/80 dark:border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
                      <span className="px-1.5 py-0.5 rounded text-2xs font-mono uppercase bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                        100% Offline
                      </span>
                      <span>No Strava Account? Import Training Archive</span>
                    </div>
                    <p className="text-2xs text-slate-600 dark:text-slate-400">
                      Drag &amp; drop Garmin or Strava bulk export ZIPs, FIT, or GPX files. All telemetry is unpacked client-side in your browser. Zero API permissions required.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowArchiveWizard(true)}
                    className="ap-btn-secondary !min-h-[44px] px-4 py-2 text-xs font-bold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <UploadSimple className="w-3.5 h-3.5 ap-text-brand" />
                    <span>Import Archive (.zip/.fit)</span>
                  </button>
                </div>

                {!showTeamCodeDrawer && (
                  <div className="pt-1 text-center">
                    <button
                      type="button"
                      onClick={() => setShowTeamCodeDrawer(true)}
                      className="text-xs font-semibold ap-text-brand hover:underline inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>Have a coach or school Team Join Code? Enter it here</span>
                    </button>
                  </div>
                )}

                {/* Self-Hosted BYO Strava Keys (Hidden when production server has STRAVA_CLIENT_ID configured) */}
                {showByoStravaSection && (
                  <div className="pt-3 border-t border-slate-200/80 dark:border-white/10">
                    <button
                      type="button"
                      onClick={() => setShowCustomStravaKeys((prev) => !prev)}
                      className="w-full flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer py-1"
                    >
                      <span>Self-hosting THRESH? Configure Strava API Client ID &amp; Secret</span>
                      {showCustomStravaKeys ? (
                        <ChevronUp className="w-4 h-4 shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 shrink-0" />
                      )}
                    </button>

                    {showCustomStravaKeys && (
                      <div className="mt-3 rounded-xl liquid-glass-subtle p-4 space-y-3.5 text-xs">
                        <ol className="space-y-2 text-slate-700 dark:text-slate-300 list-decimal list-inside leading-relaxed">
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
                            <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-white dark:bg-[#0D1210] border border-slate-300 dark:border-slate-700 px-3 py-1.5 font-mono">
                              <span className="font-bold text-slate-900 dark:text-white truncate">
                                {currentHostname}
                              </span>
                              <button
                                type="button"
                                onClick={handleCopyDomain}
                                className="inline-flex items-center gap-1 text-2xs font-semibold ap-text-brand shrink-0 cursor-pointer"
                              >
                                {copiedDomain ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                                    <span>Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>Copy Domain</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </li>
                          <li>Enter your Strava API Client ID and Secret:</li>
                        </ol>

                        <form onSubmit={handleSaveKeysAndLaunchStrava} className="space-y-2.5">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <input
                              type="text"
                              required
                              aria-label="Strava API Client ID"
                              value={stravaClientId}
                              onChange={(e) => setStravaClientId(e.target.value)}
                              placeholder="Client ID (e.g. 123456)"
                              className="w-full min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                            />
                            <input
                              type="password"
                              aria-label="Strava API Client Secret"
                              value={stravaClientSecret}
                              onChange={(e) => setStravaClientSecret(e.target.value)}
                              placeholder={
                                status.stravaClientId ? 'Client Secret (saved)' : 'Client Secret'
                              }
                              className="w-full min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                            />
                          </div>
                          <button
                            type="submit"
                            disabled={busy || !stravaClientId.trim()}
                            className="ap-btn-strava w-full !min-h-[44px] sm:!min-h-[40px] rounded-lg disabled:opacity-50 font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <span>Save Keys &amp; Authorize Strava</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        </form>

                        {(onExchangeStravaCode || onSaveStravaDirectToken) && (
                          <details className="pt-2 border-t border-slate-200/70 dark:border-white/10">
                            <summary className="cursor-pointer text-2xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 select-none">
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
                                className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                              />
                              <button
                                type="submit"
                                disabled={
                                  busy || (!manualCodeInput.trim() && !directRefreshToken.trim())
                                }
                                className="ap-btn-secondary w-full !min-h-[44px] sm:!min-h-[36px] text-xs cursor-pointer"
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
              </div>

              {/* Typographic 3-Column Capability Ledger (No Nested Card Scaffolds) */}
              <div className="relative z-10 pt-5 border-t border-slate-200/80 dark:border-white/10 grid grid-cols-1 sm:grid-cols-3 gap-5 sm:divide-x sm:divide-slate-200/70 dark:sm:divide-white/10">
                <div className="space-y-1">
                  <div className="font-mono text-2xs uppercase tracking-wider ap-text-brand font-bold">
                    Readiness &amp; Load
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    Banister <span className="font-mono">42d CTL / 7d ATL / TSB</span>, 3-channel orthopedic guardrails, and daily workout modulations tuned to your recovery.
                  </p>
                </div>

                <div className="space-y-1 sm:pl-5">
                  <div className="font-mono text-2xs uppercase tracking-wider ap-text-brand font-bold">
                    Run + Ride Telemetry
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    Synchronized <span className="font-mono">1Hz</span> streams, <span className="font-mono">CP / W&apos;</span> &amp; Daniels <span className="font-mono">VDOT</span> zones, fatigue-sliced durability, and <span className="font-mono">.FIT</span> import/export.
                  </p>
                </div>

                <div className="space-y-1 sm:pl-5">
                  <div className="font-mono text-2xs uppercase tracking-wider ap-text-brand font-bold">
                    Trackside &amp; Team Ops
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    Locker-room QR onboarding, auto-scaled <span className="font-mono">VDOT</span> pacing pods, watchless <span className="font-mono">0.01s</span> split timing, and U18 Safe-Sport shields.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ==============================================================
              STEP 2: EXPLICIT POST-AUTH STRAVA DATA SYNC & CALIBRATION
             ============================================================== */}
          {step === 2 && (
            <div className="space-y-5 relative z-10">
              {/* Verified Identity Badge */}
              <div className="rounded-2xl ap-status-prime p-3.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs sm:text-sm font-bold truncate">
                      {status.stravaConnected
                        ? `Signed in with Strava${status.stravaAthleteName ? ` · ${status.stravaAthleteName}` : ''}`
                        : `Signed in as ${localUser?.name || localUser?.email || 'Athlete'}${localUser?.email && localUser?.name ? ` (${localUser.email})` : ''}`}
                    </div>
                    <div className="text-2xs opacity-90">
                      {status.stravaConnected
                        ? 'Identity verified. Choose what Strava data you want to sync to THRESH.'
                        : 'THRESH account active. Configure your telemetry sync and sport calibration below.'}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSwitchStravaAccount()}
                  className="text-2xs font-mono underline opacity-90 hover:opacity-100 cursor-pointer shrink-0"
                >
                  Switch account
                </button>
              </div>

              {onboardingRole === 'COACH' && !activeBrand && (
                <div
                  data-testid="coach-quickstart-card"
                  className="liquid-glass rounded-2xl p-4 sm:p-5 space-y-3.5 border border-[#1C5436]/25 dark:border-[#C8FF00]/25"
                >
                  <div className="space-y-1">
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                      Coach Workspace Quick-Start
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      Skip personal wearable calibration and go straight to creating your team, importing a CSV roster, or timing track workouts.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      aria-label="Coach Name"
                      value={athleteName}
                      onChange={(e) => setAthleteName(e.target.value)}
                      placeholder="Coach Name (e.g. Coach Vega)"
                      className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      data-testid="enter-coach-mode-btn"
                      disabled={busy}
                      onClick={() => void handleFinalizeOnboarding('COACH_MODE')}
                      className="ap-btn-primary !min-h-[44px] px-4 py-2 text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span>Enter Coach Workspace</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOnboardingRole('ATHLETE')}
                    className="text-2xs underline text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                  >
                    Switch to personal Athlete setup instead
                  </button>
                </div>
              )}

              {(onboardingRole !== 'COACH' || Boolean(activeBrand)) && (
                <>
                  {!status.stravaConnected ? (
                <div className="liquid-glass rounded-2xl p-4 sm:p-5 space-y-3.5 border border-orange-500/25">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <StravaChevronMark className="w-4 h-4 text-[#FC4C02]" />
                        <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                          Link Strava Workouts (Optional)
                        </h2>
                        <span className="px-2 py-0.5 rounded text-2xs font-mono uppercase bg-slate-200/70 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                          Optional
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        Automatically pull your workouts, GPS routes, and gear mileage into THRESH.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleStravaLaunchClick('cloud', false)}
                        disabled={busy}
                        className="ap-btn-strava !min-h-[40px] px-3.5 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <StravaChevronMark className="w-3.5 h-3.5" />
                        <span>Connect Strava</span>
                      </button>
                    </div>
                  </div>
                  <p className="text-2xs text-slate-500 dark:text-slate-400">
                    Not using Strava? No problem. You can link Garmin Connect or Intervals.icu in Step 3, or import .FIT/.ZIP files anytime.
                  </p>
                </div>
              ) : (
                <>
                  {lacksActivityScope && (
                    <div className="ap-status-caution rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="space-y-0.5 flex-1 min-w-[220px]">
                        <div className="font-bold">Activity permission was unchecked on Strava</div>
                        <div className="opacity-90">
                          THRESH is set to Identity Only. Re-authorize with activity read access if you want automatic workout sync.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleStravaLaunchClick('cloud', true)}
                        className="ap-btn-strava !min-h-[44px] sm:!min-h-[36px] px-3 py-1.5 rounded-lg font-bold text-xs cursor-pointer shrink-0"
                      >
                        Re-Authorize Activities
                      </button>
                    </div>
                  )}

                  <div className="space-y-1">
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                      Choose What Syncs From Strava
                    </h1>
                  </div>

                  {/* 1. Sync Window Radio Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {(
                      [
                        {
                          id: '90d' as const,
                          title: 'Last 90 Days',
                          badge: 'Recommended · Fast',
                          desc: 'Loads your 42-day Fitness (CTL), Fatigue (ATL), and recent PRs in ~2 seconds.',
                          disabled: lacksActivityScope,
                        },
                        {
                          id: '180d' as const,
                          title: 'Last 6 Months',
                          badge: 'Season Block',
                          desc: 'Includes your full prior training block, base mileage, and threshold trends.',
                          disabled: lacksActivityScope,
                        },
                        {
                          id: 'all' as const,
                          title: 'Complete Strava Archive',
                          badge: 'All-Time',
                          desc: 'Paginates your multi-year run & ride history in the background.',
                          disabled: lacksActivityScope,
                        },
                        {
                          id: 'none' as const,
                          title: 'Identity Only (No Sync Yet)',
                          badge: 'Zero Import',
                          desc: 'Use Strava strictly for sign-in; enable sync or upload .FIT files anytime later.',
                          disabled: false,
                        },
                      ] as const
                    ).map((opt) => {
                      const selected = syncWindow === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={opt.disabled}
                          aria-pressed={selected}
                          onClick={() => setSyncWindow(opt.id)}
                          className={`text-left rounded-xl p-3.5 border-2 transition-all ${
                            opt.disabled
                              ? 'opacity-45 cursor-not-allowed border-slate-300/50 dark:border-white/10'
                              : selected
                                ? 'border-[#1E6B38] dark:border-[#C8FF00] bg-emerald-500/10 dark:bg-[#C8FF00]/10 cursor-pointer'
                                : 'liquid-glass hover:border-[#28573B] dark:hover:border-[#2E6B47] cursor-pointer'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                              {opt.title}
                            </span>
                            <span
                              className={`text-2xs font-mono px-2 py-0.5 rounded-md font-bold ${
                                selected
                                  ? 'ap-badge-volt'
                                  : 'bg-slate-200/70 dark:bg-white/10 text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              {opt.badge}
                            </span>
                          </div>
                          <p className="text-2xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                            {opt.desc}
                          </p>
                        </button>
                      );
                    })}
                  </div>

                  <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none px-1">
                    <input
                      type="checkbox"
                      checked={importProfileAndGear}
                      onChange={(e) => setImportProfileAndGear(e.target.checked)}
                      className="w-4 h-4 rounded accent-[#FC4C02]"
                    />
                    <span>
                      Import Strava athlete baseline (FTP / weight if set) &amp; shoe/bike gear mileage
                    </span>
                  </label>
                </>
              )}

              {/* Athlete Profile & Youth Protection */}
              <div className="liquid-glass rounded-2xl p-4 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                    Athlete Profile &amp; Eligibility
                  </h2>
                  {isMinorAthlete && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-2xs font-mono font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Safe-Sport Minor Protection</span>
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label
                      htmlFor={`${formId}-profile-name`}
                      className="block text-2xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
                    >
                      Athlete Display Name
                    </label>
                    <input
                      id={`${formId}-profile-name`}
                      type="text"
                      value={athleteName}
                      onChange={(e) => setAthleteName(e.target.value)}
                      placeholder="e.g. Maya Lin"
                      className="w-full min-h-[44px] sm:min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`${formId}-birth-year`}
                      className="block text-2xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
                    >
                      Birth Year <span className="text-slate-400 font-normal">(Age verification)</span>
                    </label>
                    <input
                      id={`${formId}-birth-year`}
                      type="number"
                      min={1920}
                      max={currentYear}
                      value={birthYear}
                      onChange={(e) => setBirthYear(e.target.value)}
                      placeholder={`e.g. ${currentYear - 17}`}
                      className="w-full min-h-[44px] sm:min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>

                {/* Minor Youth Protection Gate: If under 18 and not yet attached to a team */}
                {isMinorAthlete && !activeBrand && (
                  <div className="ap-status-caution rounded-xl p-3.5 space-y-2.5 text-xs">
                    <div className="font-bold flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                      <span>Scholastic Youth Protection Gate</span>
                    </div>
                    <p className="text-slate-700 dark:text-slate-300 text-2xs leading-relaxed">
                      Under COPPA and our youth privacy rules, athletes under 18 must join through an authorized school or club athletic team roster.
                    </p>
                    {!showTeamCodeDrawer ? (
                      <div className="pt-1">
                        <button
                          type="button"
                          data-testid="youth-open-join-code-btn"
                          onClick={() => setShowTeamCodeDrawer(true)}
                          className="ap-btn-primary !min-h-[40px] px-3 py-1 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Users className="w-3.5 h-3.5" />
                          <span>Enter Coach / Team Join Code</span>
                        </button>
                      </div>
                    ) : (
                      <div
                        data-testid="youth-inline-join-code-box"
                        className="flex flex-col sm:flex-row gap-2 pt-1"
                      >
                        <input
                          type="text"
                          value={joinCodeInput}
                          aria-label="Enter 6-character Team Join Code"
                          onChange={(e) => {
                            setJoinCodeInput(e.target.value.toUpperCase());
                            setJoinSlug(undefined);
                            setInviteToken('');
                          }}
                          placeholder="Enter 6-char Team Code (e.g. PAXC-26)"
                          className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-2 text-xs font-mono font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100"
                        />
                        <button
                          type="button"
                          disabled={isLoadingPreview || !joinCodeInput.trim()}
                          onClick={() => void lookupTeamPreview(joinCodeInput, inviteToken)}
                          className="ap-btn-secondary !min-h-[44px] px-3 py-1.5 text-xs font-semibold shrink-0 cursor-pointer"
                        >
                          {isLoadingPreview ? 'Checking…' : 'Apply Code'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Parent / Guardian Email Requirement for Minor Athletes */}
                {isMinorAthlete && (
                  <div className="space-y-1.5 pt-1 border-t border-slate-200/80 dark:border-white/10">
                    <label
                      htmlFor={`${formId}-parent-email`}
                      className="block text-2xs font-semibold text-slate-600 dark:text-slate-300"
                    >
                      Parent or Guardian Email <span className="text-amber-400 font-bold">*Required for Athletes Under 18</span>
                    </label>
                    <input
                      id={`${formId}-parent-email`}
                      type="email"
                      value={parentGuardianEmail}
                      onChange={(e) => setParentGuardianEmail(e.target.value)}
                      placeholder="parent.guardian@example.com"
                      className="w-full min-h-[44px] sm:min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />
                    <p className="text-2xs text-slate-500 dark:text-slate-400">
                      We will dispatch an automated parent notification with full transparency on data safeguards and a 1-click consent link.
                    </p>
                  </div>
                )}
              </div>

              {/* 2. Primary Sport & Units + Optional Day-1 Seed Mark */}
              <div className="liquid-glass rounded-2xl p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div
                      id={`${formId}-primary-sport`}
                      className="text-2xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400"
                    >
                      Primary Focus
                    </div>
                    <div
                      role="group"
                      aria-labelledby={`${formId}-primary-sport`}
                      className="inline-flex rounded-xl p-0.5 liquid-capsule-track text-xs"
                    >
                      {(['Running', 'Cycling', 'Hybrid'] as const).map((sp) => (
                        <button
                          key={sp}
                          type="button"
                          aria-pressed={primarySport === sp}
                          onClick={() => {
                            setPrimarySport(sp);
                            if (sp === 'Cycling') setSelectedSeedEventId('ftp');
                            else if (selectedSeedEventId === 'ftp' || selectedSeedEventId === '20m') {
                              setSelectedSeedEventId('5k');
                            }
                          }}
                          className={`min-h-[44px] sm:min-h-[36px] px-3 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
                            primarySport === sp
                              ? 'ap-nav-volt-active'
                              : 'text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {sp}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div
                      id={`${formId}-display-units`}
                      className="text-2xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400"
                    >
                      Display Units
                    </div>
                    <div
                      role="group"
                      aria-labelledby={`${formId}-display-units`}
                      className="inline-flex rounded-xl p-0.5 liquid-capsule-track text-xs font-mono"
                    >
                      {(['mi', 'km'] as const).map((u) => (
                        <button
                          key={u}
                          type="button"
                          aria-pressed={distanceUnit === u}
                          onClick={() => {
                            setDistanceUnit(u);
                            setHasEditedUnits(true);
                          }}
                          className={`min-h-[44px] sm:min-h-[36px] px-3 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
                            distanceUnit === u
                              ? 'ap-nav-volt-active'
                              : 'text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {u === 'mi' ? 'mi / lbs' : 'km / kg'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Optional Seed Mark Calibrator — Progressive Disclosure (Auto-open for Identity Only) */}
                <details
                  open={syncWindow === 'none' || Boolean(rawSeedValue.trim())}
                  className="pt-3 border-t border-slate-200/80 dark:border-white/10 group"
                >
                  <summary className="cursor-pointer list-none flex flex-wrap items-center justify-between gap-2 py-1 select-none">
                    <span className="text-xs font-bold text-slate-900 dark:text-white inline-flex items-center gap-1.5">
                      <span>Optional: Seed Zones From a Recent Race Time or FTP</span>
                      <ChevronDown className="w-3.5 h-3.5 text-slate-500 transition-transform group-open:rotate-180" />
                    </span>
                    <span className="text-2xs text-slate-500 dark:text-slate-400">
                      {syncWindow === 'none'
                        ? 'Recommended when importing 0 workouts'
                        : 'Skip to auto-calibrate from Strava'}
                    </span>
                  </summary>

                  <div className="pt-2.5 space-y-2.5">
                    <label
                      htmlFor={`${formId}-seed-mark`}
                      className="block text-2xs font-semibold text-slate-600 dark:text-slate-300"
                    >
                      Recent Race Mark or Threshold Power
                    </label>

                    <div
                      role="group"
                      aria-label="Seed mark event type"
                      className="flex flex-wrap gap-1.5"
                    >
                      {SEED_EVENT_PILLS.filter((p) =>
                        primarySport === 'Hybrid' ? true : p.sport === primarySport
                      ).map((pill) => (
                        <button
                          key={pill.id}
                          type="button"
                          aria-pressed={selectedSeedEventId === pill.id}
                          onClick={() => setSelectedSeedEventId(pill.id)}
                          className={`min-h-[44px] sm:min-h-[34px] px-2.5 py-1 rounded-lg text-2xs font-mono font-semibold transition-colors cursor-pointer ${
                            selectedSeedEventId === pill.id
                              ? 'ap-nav-volt-active'
                              : 'liquid-capsule-track text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {pill.label}
                        </button>
                      ))}
                    </div>

                    <input
                      id={`${formId}-seed-mark`}
                      type="text"
                      value={rawSeedValue}
                      onChange={(e) => setRawSeedValue(e.target.value)}
                      placeholder={selectedSeedPill.placeholder}
                      className="w-full min-h-[44px] sm:min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-2 text-xs sm:text-sm font-mono text-slate-900 dark:text-slate-100"
                    />

                    {composedSeedMark.trim() && (
                      <div className="rounded-xl ap-status-prime px-3 py-2 text-xs font-mono flex flex-wrap items-center justify-between gap-2">
                        {selectedSeedPill.sport === 'Cycling' || /\d+\s*w\b/i.test(composedSeedMark) ? (
                          <>
                            <span>Calibrated Cycling FTP: {liveSeedCalibration.cyclingFtpWatts}W</span>
                            <span>
                              Z2 Base: {Math.round(liveSeedCalibration.cyclingFtpWatts * 0.56)}–
                              {Math.round(liveSeedCalibration.cyclingFtpWatts * 0.75)}W
                            </span>
                          </>
                        ) : (
                          <>
                            <span>
                              {liveSeedCalibration.vdotEstimate
                                ? `VDOT ${liveSeedCalibration.vdotEstimate} · `
                                : ''}
                              LT2 {liveSeedCalibration.thresholdPaceInputDisplay}/{distanceUnit}
                            </span>
                            <span>
                              Easy {liveSeedCalibration.easyPaceInputDisplay}/{distanceUnit} · VO2{' '}
                              {liveSeedCalibration.intervalPaceInputDisplay}/{distanceUnit}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </details>
              </div>

              {/* 3. Team Roster Consent & Coach Sharing Tier (Only when joining a team) */}
              {activeBrand && (
                <div className="liquid-glass rounded-2xl p-4 space-y-3 border-2 border-[#25573A]">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                        Joining {activeBrand.name} ({activeBrand.joinCode})
                      </h2>
                    </div>
                    <span className="text-2xs font-mono ap-text-brand font-bold">
                      Coach {activeBrand.coachDisplayName}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label
                        htmlFor={`${formId}-roster-name`}
                        className="block text-2xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
                      >
                        Roster Display Name
                      </label>
                      <input
                        id={`${formId}-roster-name`}
                        type="text"
                        value={athleteName}
                        onChange={(e) => setAthleteName(e.target.value)}
                        placeholder="Your full name"
                        className="w-full min-h-[44px] sm:min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`${formId}-sharing-tier`}
                        className="block text-2xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
                      >
                        Coach Data Sharing Level
                      </label>
                      <select
                        id={`${formId}-sharing-tier`}
                        value={sharingTier}
                        onChange={(e) => setSharingTier(e.target.value as CoachDataSharingTier)}
                        className="w-full min-h-[44px] sm:min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100"
                      >
                        <option value="SUMMARY_ONLY">
                          Workout Summaries &amp; Readiness (Recommended)
                        </option>
                        <option value="FULL_STREAMS">
                          Full Coaching Splits &amp; Pace/Power Curves
                        </option>
                        <option value="LOAD_ONLY">
                          Readiness &amp; Weekly Load Totals Only
                        </option>
                      </select>
                    </div>
                  </div>

                  <label
                    className={`flex items-start gap-2.5 text-xs select-none ${
                      isMinorAthlete ? 'cursor-not-allowed opacity-90' : 'cursor-pointer'
                    } text-slate-700 dark:text-slate-300`}
                  >
                    <input
                      type="checkbox"
                      checked={isMinorAthlete ? true : safeSportHideWeight}
                      disabled={isMinorAthlete}
                      onChange={(e) => !isMinorAthlete && setSafeSportHideWeight(e.target.checked)}
                      className="w-4 h-4 mt-0.5 rounded accent-emerald-600"
                    />
                    <div>
                      <span>
                        <strong>Safe-Sport Privacy Mode:</strong> Hide body weight &amp; W/kg on team views
                      </span>
                      {isMinorAthlete && (
                        <span className="block text-2xs text-emerald-400 font-medium mt-0.5">
                          Enforced &amp; locked ON for minor athletes to prevent RED-S &amp; weight-sensitive eating disorder risks.
                        </span>
                      )}
                    </div>
                  </label>
                </div>
              )}

              <div className="text-center text-2xs text-slate-500 dark:text-slate-400 pt-1">
                <a
                  href="/docs/index.html#sec-safesport"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-emerald-400 inline-flex items-center gap-1"
                >
                  <ShieldCheck className="w-3.5 h-3.5 inline" />
                  <span>Youth Athlete Privacy, COPPA, &amp; Scholastic Compliance Policy</span>
                </a>
              </div>

              <div className="pt-1 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="ap-btn-secondary text-xs cursor-pointer"
                >
                  ← Back
                </button>

                <button
                  type="button"
                  onClick={() => void handleConfirmStep2()}
                  disabled={busy}
                  className="ap-btn-primary text-sm px-6 cursor-pointer"
                >
                  {isSavingStep2 ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <ArrowRight className="w-4 h-4" />
                  )}
                  <span>
                    {activeBrand
                      ? `Join ${activeBrand.shortName} & Continue`
                      : status.stravaConnected
                        ? 'Confirm Strava Sync & Continue'
                        : 'Confirm & Continue'}
                  </span>
                </button>
              </div>
                </>
              )}
            </div>
          )}

          {/* ==============================================================
              STEP 3: OPTIONAL GARMIN CONNECT OR INTERVALS.ICU (NEVER MANDATORY)
             ============================================================== */}
          {step === 3 && (
            <div className="space-y-5 relative z-10">
              <div className="space-y-1.5">
                {isSyncing && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-2xs font-mono ap-text-strava inline-flex items-center gap-1">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      <span>Syncing Strava in background…</span>
                    </span>
                  </div>
                )}
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                  Add Overnight Sleep &amp; HRV (Optional)
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  Strava is already handling your sign-in{syncWindow !== 'none' ? ' and workout sync' : ''}. Optionally link <strong>Garmin Connect</strong> or <strong>Intervals.icu</strong> for overnight HRV, Sleep Score, and Resting HR—or enter THRESH right now.
                </p>
              </div>

              <div className="space-y-3">
                {/* Optional Card 1: Garmin Connect */}
                <div className="liquid-glass rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                          Garmin Connect
                        </h2>
                        {isGarminConnected ? (
                          <span className="ap-status-prime px-2 py-0.5 rounded-md text-2xs font-mono font-semibold">
                            Connected ✓
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-2xs font-mono uppercase bg-slate-200/70 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                            Optional
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                        Adds overnight HRV (rMSSD), Sleep Score, Resting HR, and 1-click watch workout pushes.
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-expanded={expandGarmin}
                      onClick={() => setExpandGarmin((prev) => !prev)}
                      className="ap-btn-secondary !min-h-[44px] sm:!min-h-[38px] text-xs shrink-0 cursor-pointer"
                    >
                      {isGarminConnected ? 'Update' : expandGarmin ? 'Hide' : 'Connect'}
                    </button>
                  </div>

                  {expandGarmin && (
                    <form
                      onSubmit={handleConnectGarminInline}
                      className="pt-3 border-t border-slate-200/80 dark:border-white/10 space-y-2.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-600 dark:text-slate-300">
                          Paste your Garmin Personal API Key (<code className="font-mono">GCDC_...</code>):
                        </span>
                        <a
                          href="https://connect.garmin.com/app/settings/personalApiToken"
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold ap-text-brand hover:underline inline-flex items-center gap-1"
                        >
                          <span>Get Key from Garmin</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="password"
                          required
                          aria-label="Garmin Personal API Key"
                          value={garminPersonalKey}
                          onChange={(e) => setGarminPersonalKey(e.target.value)}
                          placeholder="GCDC_00000000-0000-..."
                          className="flex-1 min-h-[44px] sm:min-h-[42px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                        />
                        <button
                          type="submit"
                          disabled={busy || !garminPersonalKey.trim()}
                          className="ap-btn-primary !min-h-[44px] sm:!min-h-[42px] text-xs shrink-0 cursor-pointer"
                        >
                          {isConnectingGarmin ? 'Linking…' : 'Link Garmin'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>

                {/* Optional Card 2: Intervals.icu */}
                <div className="liquid-glass rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                          Intervals.icu
                        </h2>
                        {status.intervalsConnected ? (
                          <span className="ap-status-prime px-2 py-0.5 rounded-md text-2xs font-mono font-semibold">
                            Connected ✓
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-2xs font-mono uppercase bg-slate-200/70 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                            Optional
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                        Syncs Coros / Polar / Wahoo / Whoop wellness, eFTP curves, and planned calendar workouts.
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-expanded={expandIntervals}
                      onClick={() => setExpandIntervals((prev) => !prev)}
                      className="ap-btn-secondary !min-h-[44px] sm:!min-h-[38px] text-xs shrink-0 cursor-pointer"
                    >
                      {status.intervalsConnected ? 'Update' : expandIntervals ? 'Hide' : 'Connect'}
                    </button>
                  </div>

                  {expandIntervals && (
                    <div className="pt-3 border-t border-slate-200/80 dark:border-white/10 space-y-3">
                      {onLaunchIntervalsOAuth && (
                        <button
                          type="button"
                          onClick={() => onLaunchIntervalsOAuth?.()}
                          className="w-full ap-btn-primary min-h-[44px] flex items-center justify-center gap-2 font-semibold text-xs cursor-pointer shadow-sm"
                        >
                          <Lightning className="w-4 h-4 text-lime-400" />
                          <span>1-Click Connect with Intervals.icu (OAuth 2.0)</span>
                        </button>
                      )}

                      <details className="text-2xs text-slate-500 dark:text-slate-400 group/api">
                        <summary className="cursor-pointer hover:text-slate-700 dark:hover:text-slate-200 select-none py-1">
                          Power-User Option: Connect via Personal API Key
                        </summary>
                        <form
                          onSubmit={handleConnectIntervalsInline}
                          className="pt-2 space-y-2.5"
                        >
                          <div className="flex items-center justify-between text-2xs">
                            <span className="text-slate-600 dark:text-slate-300">
                              Enter Athlete ID (<code className="font-mono">0</code> for self) &amp; API Key:
                            </span>
                            <a
                              href="https://intervals.icu/settings"
                              target="_blank"
                              rel="noreferrer"
                              className="font-semibold ap-text-brand hover:underline inline-flex items-center gap-1"
                            >
                              <span>Intervals.icu Settings</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                            <input
                              type="text"
                              aria-label="Intervals.icu Athlete ID"
                              value={intervalsAthleteId}
                              onChange={(e) => setIntervalsAthleteId(e.target.value)}
                              placeholder="0 or i12345"
                              className="sm:col-span-3 min-h-[44px] sm:min-h-[42px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                            />
                            <input
                              type="password"
                              required
                              aria-label="Intervals.icu API Key"
                              value={intervalsApiKey}
                              onChange={(e) => setIntervalsApiKey(e.target.value)}
                              placeholder="Intervals.icu API Key"
                              className="sm:col-span-6 min-h-[44px] sm:min-h-[42px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                            />
                            <button
                              type="submit"
                              disabled={busy || !intervalsApiKey.trim()}
                              className="sm:col-span-3 ap-btn-primary !min-h-[44px] sm:!min-h-[42px] text-xs cursor-pointer"
                            >
                              {isConnectingIntervals ? 'Linking…' : 'Connect'}
                            </button>
                          </div>
                        </form>
                      </details>
                    </div>
                  )}
                </div>
              </div>

              {/* Wahoo Option */}
              <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 p-3 sm:p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-sky-500/10 text-sky-500 font-bold text-xs flex items-center justify-center">
                      W
                    </div>
                    <div>
                      <h4 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        <span>Wahoo Cloud API</span>
                        {status.wahooConnected ? (
                          <span className="text-3xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
                            Connected ({status.wahooAthleteName || 'Wahoo'})
                          </span>
                        ) : (
                          <span className="text-3xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                            Optional
                          </span>
                        )}
                      </h4>
                      <p className="text-2xs text-slate-500 dark:text-slate-400">
                        ELEMNT bike computer rides, KICKR sessions &amp; FIT files.
                      </p>
                    </div>
                  </div>
                </div>

                {!status.wahooConnected && onLaunchWahooOAuth && (
                  <button
                    type="button"
                    onClick={() => onLaunchWahooOAuth?.()}
                    disabled={busy}
                    className="w-full ap-btn-primary min-h-[44px] sm:min-h-[42px] flex items-center justify-center gap-2 font-semibold text-xs cursor-pointer shadow-sm"
                  >
                    <Lightning className="w-4 h-4 text-sky-400" />
                    <span>1-Click Connect with Wahoo (OAuth 2.0)</span>
                  </button>
                )}
              </div>

              {/* Polar Option */}
              <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 p-3 sm:p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-rose-500/10 text-rose-500 font-bold text-xs flex items-center justify-center">
                      P
                    </div>
                    <div>
                      <h4 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        <span>Polar AccessLink</span>
                        {status.polarConnected ? (
                          <span className="text-3xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
                            Connected ({status.polarAthleteName || 'Polar'})
                          </span>
                        ) : (
                          <span className="text-3xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                            Optional
                          </span>
                        )}
                      </h4>
                      <p className="text-2xs text-slate-500 dark:text-slate-400">
                        Grit X, Vantage, Pacer, H10 &amp; running load telemetry.
                      </p>
                    </div>
                  </div>
                </div>

                {!status.polarConnected && onLaunchPolarOAuth && (
                  <button
                    type="button"
                    onClick={() => onLaunchPolarOAuth?.()}
                    disabled={busy}
                    className="w-full ap-btn-primary min-h-[44px] sm:min-h-[42px] flex items-center justify-center gap-2 font-semibold text-xs cursor-pointer shadow-sm"
                  >
                    <Lightning className="w-4 h-4 text-rose-400" />
                    <span>1-Click Connect with Polar (OAuth 2.0)</span>
                  </button>
                )}
              </div>

              <div className="rounded-xl liquid-glass-subtle px-3.5 py-2.5 text-2xs text-slate-600 dark:text-slate-300 flex items-center justify-between flex-wrap gap-2">
                <span>
                  <strong>Smart Deduplication:</strong> Connecting Garmin, Intervals.icu, Wahoo, or Polar alongside Strava merges matching workouts automatically—never duplicates.
                </span>
                {!claimedTeamsState && (
                  <button
                    type="button"
                    onClick={() => void handleFinalizeOnboarding('CREATE_TEAM')}
                    disabled={busy}
                    className="font-semibold ap-text-brand hover:underline cursor-pointer shrink-0"
                  >
                    Coach? Set up a Team Workspace →
                  </button>
                )}
              </div>

              <div className="pt-1 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="ap-btn-secondary text-xs cursor-pointer"
                >
                  ← Back to Sync Choice
                </button>

                <button
                  type="button"
                  onClick={() => void handleFinalizeOnboarding('WORKSPACE')}
                  disabled={busy}
                  className="ap-btn-primary text-sm px-6 cursor-pointer"
                >
                  {isEntering ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  <span>
                    {secondaryConnected
                      ? 'Continue to THRESH →'
                      : 'Skip for Now — Enter THRESH →'}
                  </span>
                </button>
              </div>
            </div>
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
            THRESH — Run &amp; Ride Readiness
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
    </div>
  );
};
