import React, { Suspense, useEffect, useId, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ExternalLink,
  Lock,
  LogOut,
  Moon,
  Sun,
  Users,
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
import { calibrateThresholdsFromSeedMark } from '../physiology/teamOnboardingEngine';
import { resolveAthleteAgeTier } from '../physiology/ageAndComplianceEngine';
import { applyTeamBrandToDocument } from '../utils/teamBrandDom';
import { AeroPulseLogo, ThreshBrandWatermark } from './AeroPulseLogo';
import {
  PENDING_TEAM_JOIN_STORAGE_KEY,
  SEED_EVENT_PILLS,
  detectInitialJoinParams,
} from './auth/authGateShared';
import { AuthLandingStepOne } from './auth/AuthLandingStepOne';
import { AuthOnboardingStepTwo } from './auth/AuthOnboardingStepTwo';
import { AuthOptionalAddonsStep } from './auth/AuthOptionalAddonsStep';
import { CoppaExplainerModal } from './auth/CoppaExplainerModal';
import {
  getSavedIntervalsHeaders,
  isBrowserSessionLoggedOut,
  saveStravaSyncPolicyToStorage,
} from '../utils/telemetryStorage';
import { markSessionActiveHint } from '../utils/sessionHint';
import { emitFunnelEvent } from '../utils/funnelTelemetry';

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

  // MeetReady User Identity State (Self-Hosted Auth: Google, Email Magic Link, Strava)
  const [localUser, setLocalUser] = useState<ThreshUser | null>(
    currentUser || status.currentUser || null
  );
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
                emitFunnelEvent('auth_complete', {
                  role: onboardingRole === 'COACH' ? 'COACH' : 'ATHLETE',
                  isMinorUser: isMinorAthlete || isUnder13,
                  dedupeSessionKey: 'auth_complete',
                });
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

  useEffect(() => {
    if (step === 1 && !activeBrand) {
      emitFunnelEvent('landing_view', {
        role: onboardingRole === 'COACH' ? 'COACH' : 'ATHLETE',
        dedupeSessionKey: 'landing_view',
      });
    }
  }, [step, activeBrand, onboardingRole]);

  const currentJoinContext = useMemo<StravaOAuthJoinContext | undefined>(() => {
    const clean = joinCodeInput.trim();
    if (!clean && !joinSlug) return undefined;
    return {
      joinCode: !joinSlug ? clean : undefined,
      slug: joinSlug || activeBrand?.slug || undefined,
      inviteToken: inviteToken || undefined,
    };
  }, [joinCodeInput, joinSlug, inviteToken, activeBrand]);

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

  const busy =
    isRedirecting ||
    isExchanging ||
    isSavingStep2 ||
    isEntering ||
    isConnectingGarmin ||
    isConnectingIntervals;

  const secondaryConnected = Boolean(isGarminConnected || status.intervalsConnected);
  const showByoStravaSection = Boolean(
    showCustomStravaKeys || (errorMessage && /STRAVA_CLIENT_ID|not configured/i.test(errorMessage))
  );

  return (
    <div className="min-h-dvh w-full max-w-full overflow-x-clip bg-ap-chalk dark:bg-ap-obsidian text-ap-ink dark:text-ap-chalk flex flex-col">
      <a href="#main-content" className="ap-skip-link">
        Skip to main content
      </a>

      {step === 1 ? (
        <AuthLandingStepOne
          formId={formId}
          initialEmail={initialJoin.email || ''}
          activeBrand={activeBrand}
          invitePreview={invitePreview}
          onboardingRole={onboardingRole}
          selectOnboardingRole={selectOnboardingRole}
          currentJoinContext={currentJoinContext}
          showTeamCodeDrawer={showTeamCodeDrawer}
          setShowTeamCodeDrawer={setShowTeamCodeDrawer}
          joinCodeInput={joinCodeInput}
          setJoinCodeInput={setJoinCodeInput}
          joinSlug={joinSlug}
          setJoinSlug={setJoinSlug}
          inviteToken={inviteToken}
          setInviteToken={setInviteToken}
          setInvitePreview={setInvitePreview}
          isLoadingPreview={isLoadingPreview}
          lookupTeamPreview={lookupTeamPreview}
          errorMessage={errorMessage}
          joinError={joinError}
          setJoinError={setJoinError}
          stepNotice={stepNotice}
          setStepNotice={setStepNotice}
          isDark={isDark}
          onToggleDark={onToggleDark}
          onEnterSampleDemo={onEnterSampleDemo}
          onOpenBrandStudio={onOpenBrandStudio}
          onOpenCoppaModal={() => setShowCoppaModal(true)}
          busy={busy}
          isRedirecting={isRedirecting}
          setIsExchanging={setIsExchanging}
          handleStravaLaunchClick={handleStravaLaunchClick}
          showByoStravaSection={showByoStravaSection}
          showCustomStravaKeys={showCustomStravaKeys}
          setShowCustomStravaKeys={setShowCustomStravaKeys}
          currentHostname={currentHostname}
          stravaClientId={stravaClientId}
          setStravaClientId={setStravaClientId}
          stravaClientSecret={stravaClientSecret}
          setStravaClientSecret={setStravaClientSecret}
          savedStravaClientId={status.stravaClientId}
          handleSaveKeysAndLaunchStrava={handleSaveKeysAndLaunchStrava}
          onExchangeStravaCode={onExchangeStravaCode}
          onSaveStravaDirectToken={onSaveStravaDirectToken}
        />
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

      <CoppaExplainerModal
        isOpen={showCoppaModal}
        onClose={() => setShowCoppaModal(false)}
      />
    </div>
  );
};
