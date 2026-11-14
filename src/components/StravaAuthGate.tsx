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
  Lock,
  LogOut,
  Moon,
  RefreshCw,
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
  UnifiedActivity,
} from '../types';
import {
  calibrateThresholdsFromSeedMark,
  computeAccessibleTeamPalette,
} from '../physiology/teamOnboardingEngine';
import { applyTeamBrandToDocument } from '../utils/teamBrandDom';
import { AeroPulseLogo, ThreshBrandWatermark } from './AeroPulseLogo';

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
  entryTarget: 'WORKSPACE' | 'DATA_SOURCES' | 'UPLOAD_FIT' | 'CREATE_TEAM';
}

export interface StravaOAuthJoinContext {
  joinCode?: string;
  slug?: string;
  inviteToken?: string;
}

interface StravaAuthGateProps {
  status: ConnectionStatus;
  onLaunchStravaOAuth: (
    mode?: 'cloud' | 'localhost',
    joinContext?: StravaOAuthJoinContext,
    forcePrompt?: boolean
  ) => Promise<void>;
  onSaveStravaCredentials?: (clientId: string, clientSecret: string) => Promise<void>;
  onSaveStravaDirectToken?: (refreshToken: string, accessToken?: string) => Promise<void>;
  onExchangeStravaCode?: (codeOrUrl: string) => Promise<void>;
  onConnectIntervals?: (athleteId: string, apiKey: string) => Promise<void>;
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
  existingActivities?: UnifiedActivity[];
  distanceUnit?: DistanceUnit;
}

type WizardStep = 1 | 2 | 3;

const PENDING_TEAM_JOIN_STORAGE_KEY = 'thresh_pending_team_join_v1';

interface StoredPendingJoin {
  codeOrSlug: string;
  slug?: string;
  token: string;
}

function detectInitialJoinParams(): StoredPendingJoin {
  if (typeof window === 'undefined') return { codeOrSlug: '', token: '' };
  const pathMatch = window.location.pathname.match(/^\/join\/([^/?#]+)/i);
  const params = new URLSearchParams(window.location.search);
  const queryJoin = (params.get('join') || params.get('team') || '').trim();
  const token = (params.get('t') || params.get('token') || '').trim();
  const slug = pathMatch ? decodeURIComponent(pathMatch[1]).trim() : '';
  const codeOrSlug = slug || queryJoin;
  if (codeOrSlug) {
    return { codeOrSlug, slug: slug || undefined, token };
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
  return { codeOrSlug: '', token: '' };
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
  onLaunchStravaOAuth,
  onSaveStravaCredentials,
  onSaveStravaDirectToken,
  onExchangeStravaCode,
  onConnectIntervals,
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
  existingActivities = [],
  distanceUnit: propDistanceUnit,
}) => {
  const formId = useId();
  const initialJoin = useMemo(() => detectInitialJoinParams(), []);
  const isEmbeddedWebView = useMemo(() => detectEmbeddedWebView(), []);

  const [step, setStep] = useState<WizardStep>(() => (status.stravaConnected ? 2 : 1));
  const [showArchiveWizard, setShowArchiveWizard] = useState(false);

  // Athlete Sync & Calibration State (Step 2)
  const [syncWindow, setSyncWindow] = useState<StravaSyncWindow>(
    status.stravaSyncPolicy?.window || '90d'
  );
  const [importProfileAndGear, setImportProfileAndGear] = useState<boolean>(
    status.stravaSyncPolicy?.importProfileAndGear ?? true
  );
  const [athleteName, setAthleteName] = useState(status.stravaAthleteName || '');
  const [athleteEmail, setAthleteEmail] = useState('');
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

  const currentHostname =
    typeof window !== 'undefined' ? window.location.hostname : 'thresh.app';

  const lacksActivityScope = Boolean(
    status.stravaConnected &&
      status.stravaGrantedScope &&
      !status.stravaGrantedScope.includes('activity:read')
  );

  // Automatically advance from Step 1 -> Step 2 once Strava OAuth completes!
  useEffect(() => {
    if (status.stravaConnected && step === 1) {
      setStep(2);
    }
  }, [status.stravaConnected, step]);

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

  const lookupTeamPreview = async (codeOrSlug: string, token?: string, explicitSlug?: string) => {
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
        }
        try {
          sessionStorage.setItem(
            PENDING_TEAM_JOIN_STORAGE_KEY,
            JSON.stringify({
              codeOrSlug: clean,
              slug: explicitSlug || data.brand.slug,
              token: token || '',
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
      void lookupTeamPreview(initialJoin.codeOrSlug, initialJoin.token, initialJoin.slug);
    }
  }, [initialJoin.codeOrSlug, initialJoin.token, initialJoin.slug]);

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
        ...(sessionTokenHeader ? { 'x-session-token': sessionTokenHeader } : {}),
      };

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
      setConfirmedPolicy(savedPolicy);

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
      if (syncWindow !== 'none' && onSyncNow) {
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
          safeSportHideWeight: Boolean(
            claimedTeamsState?.safeSportEnforced || safeSportHideWeight
          ),
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
    isConnectingIntervals;

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
        <header className="rounded-2xl liquid-glass-header px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <AeroPulseLogo size="sm" teamBrand={activeBrand} />

          <div className="flex items-center gap-1.5 sm:gap-2">
            {step === 1 && (
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
                  label: '1. Strava Sign-In',
                  mobileLabel: '1. Sign In',
                  locked: false,
                },
                {
                  id: 2 as const,
                  label: '2. Sync Choice',
                  mobileLabel: '2. Sync',
                  locked: !status.stravaConnected,
                },
                {
                  id: 3 as const,
                  label: '3. Optional Add-Ons',
                  mobileLabel: '3. Add-Ons',
                  locked: !status.stravaConnected,
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
                  s.locked ? 'Sign in with Strava in Step 1 first' : s.label
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
              STEP 1: STRAVA IDENTITY (PRIMARY AUTH FOR INDIVIDUALS & TEAMS)
             ============================================================== */}
          {step === 1 && (
            <div className="space-y-5 relative z-10">
              <div className="space-y-2">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight">
                  {activeBrand
                    ? `Join ${activeBrand.name} on THRESH`
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
                    ? `Sign in with Strava to verify your athlete identity for Coach ${activeBrand.coachDisplayName}'s roster. You'll choose exactly what workout data syncs on the next screen.`
                    : 'THRESH turns your running and cycling training into a daily readiness check, calibrated threshold zones, and adaptive workout plan.'}
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
                  <strong>Tip for mobile team links:</strong> If Strava sign-in is blocked inside this messaging app, tap <strong>⋯ → Open in Safari / Chrome</strong>.
                </div>
              )}

              {/* Primary Strava Sign-In Card */}
              <div className="liquid-glass rounded-2xl p-4 sm:p-5 space-y-4">
                <button
                  type="button"
                  onClick={() => void handleStravaLaunchClick('cloud', false)}
                  disabled={busy}
                  className="ap-btn-strava w-full !min-h-[50px] py-3 px-5 rounded-xl disabled:opacity-60 font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 shadow-md cursor-pointer"
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

                <p className="text-xs text-center text-slate-600 dark:text-slate-300 leading-relaxed">
                  Strava handles your THRESH identity across devices. <strong>Nothing syncs until you choose your sync window in Step 2.</strong>
                </p>

                {/* 4-Point Read-Only Privacy Pledge */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-slate-200/80 dark:border-white/10 text-xs">
                  <div className="rounded-xl liquid-glass-subtle p-2.5 flex items-start gap-2">
                    <ShieldCheck className="w-4 h-4 ap-text-brand shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">
                        100% Read-Only Strava Access
                      </div>
                      <div className="text-2xs text-slate-600 dark:text-slate-400">
                        Never posts to your feed, edits titles, or modifies workouts.
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
                        Pick Last 90 Days, Full Archive, or Identity-Only after sign-in.
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
              {/* Verified Strava Identity Badge */}
              <div className="rounded-2xl ap-status-prime p-3.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs sm:text-sm font-bold truncate">
                      Signed in with Strava
                      {status.stravaAthleteName ? ` · ${status.stravaAthleteName}` : ''}
                    </div>
                    <div className="text-2xs opacity-90">
                      Identity verified. Choose what Strava data you want to sync to THRESH.
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

                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={safeSportHideWeight}
                      onChange={(e) => setSafeSportHideWeight(e.target.checked)}
                      className="w-4 h-4 rounded accent-emerald-600"
                    />
                    <span>
                      <strong>Safe-Sport Privacy Mode:</strong> Hide body weight &amp; W/kg on team views
                    </span>
                  </label>
                </div>
              )}

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
                      : 'Confirm Strava Sync & Continue'}
                  </span>
                </button>
              </div>
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
                    <form
                      onSubmit={handleConnectIntervalsInline}
                      className="pt-3 border-t border-slate-200/80 dark:border-white/10 space-y-2.5"
                    >
                      <div className="flex items-center justify-between text-xs">
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
                  )}
                </div>
              </div>

              <div className="rounded-xl liquid-glass-subtle px-3.5 py-2.5 text-2xs text-slate-600 dark:text-slate-300 flex items-center justify-between flex-wrap gap-2">
                <span>
                  <strong>Smart Deduplication:</strong> Connecting Garmin or Intervals.icu alongside Strava merges matching workouts automatically—never duplicates.
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

          {status.stravaConnected && onDisconnectCredentials && (
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
