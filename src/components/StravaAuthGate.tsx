import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  HeartPulse,
  KeyRound,
  LogOut,
  Moon,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Sun,
  TrendingUp,
  Users,
} from './icons/PhosphorIcons';
import {
  ConnectionStatus,
  DistanceUnit,
  TeamInvitePreviewPayload,
  TeamSummaryWithRole,
} from '../types';
import { calibrateThresholdsFromSeedMark } from '../physiology/teamOnboardingEngine';
import { applyTeamBrandToDocument } from '../utils/teamBrandDom';
import { AeroPulseLogo } from './AeroPulseLogo';

export interface FirstRunCalibrationPayload {
  athleteName: string;
  primarySport: 'Cycling' | 'Running' | 'Hybrid';
  distanceUnit: DistanceUnit;
  weightDisplay: number;
  cyclingFtpWatts: number;
  thresholdPaceInput: string;
  safeSportHideWeight?: boolean;
  claimedTeams?: TeamSummaryWithRole[];
  activeTeamId?: string;
  sessionToken?: string;
  entryTarget: 'WORKSPACE' | 'DATA_SOURCES' | 'UPLOAD_FIT' | 'CREATE_TEAM';
}

interface StravaAuthGateProps {
  status: ConnectionStatus;
  onLaunchStravaOAuth: (mode?: 'cloud' | 'localhost') => Promise<void>;
  onSaveStravaCredentials?: (clientId: string, clientSecret: string) => Promise<void>;
  onSaveStravaDirectToken?: (refreshToken: string, accessToken?: string) => Promise<void>;
  onExchangeStravaCode?: (codeOrUrl: string) => Promise<void>;
  onConnectIntervals?: (athleteId: string, apiKey: string) => Promise<void>;
  onSyncNow?: (fullHistory?: boolean) => Promise<void>;
  onCompleteCalibrationEntry?: (payload: FirstRunCalibrationPayload) => Promise<void>;
  onDisconnectCredentials?: () => Promise<void>;
  isSyncing: boolean;
  errorMessage: string | null;
  isDark?: boolean;
  onToggleDark?: () => void;
}

type OnboardingMode = 'NEW_ATHLETE' | 'TEAM_JOIN' | 'EMAIL_OTP';
type WizardStep = 1 | 2 | 3;

function detectInitialJoinParams(): { codeOrSlug: string; token: string } {
  if (typeof window === 'undefined') return { codeOrSlug: '', token: '' };
  const pathMatch = window.location.pathname.match(/^\/join\/([^/?#]+)/i);
  const params = new URLSearchParams(window.location.search);
  const queryJoin = params.get('join') || params.get('team') || '';
  const token = params.get('t') || params.get('token') || '';
  const codeOrSlug = pathMatch ? decodeURIComponent(pathMatch[1]) : queryJoin.trim();
  return { codeOrSlug, token };
}

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
}) => {
  const initialJoin = useMemo(() => detectInitialJoinParams(), []);

  const [mode, setMode] = useState<OnboardingMode>(
    initialJoin.codeOrSlug ? 'TEAM_JOIN' : 'NEW_ATHLETE'
  );
  const [step, setStep] = useState<WizardStep>(1);

  // Basic Athlete Preferences
  const [athleteName, setAthleteName] = useState('');
  const [athleteEmail, setAthleteEmail] = useState('');
  const [primarySport, setPrimarySport] = useState<'Cycling' | 'Running' | 'Hybrid'>('Hybrid');
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>('mi');
  const [seedMarkInput, setSeedMarkInput] = useState('');
  const [safeSportHideWeight, setSafeSportHideWeight] = useState(false);

  // Strava Step 2 Credentials & Fallback State
  const [showCustomStravaKeys, setShowCustomStravaKeys] = useState(false);
  const [stravaClientId, setStravaClientId] = useState(status.stravaClientId || '');
  const [stravaClientSecret, setStravaClientSecret] = useState('');
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [directRefreshToken, setDirectRefreshToken] = useState('');
  const [copiedDomain, setCopiedDomain] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [isExchanging, setIsExchanging] = useState(false);
  const [stepNotice, setStepNotice] = useState<string | null>(null);

  // Step 3 Optional Garmin & Intervals State
  const [expandGarmin, setExpandGarmin] = useState(false);
  const [garminPersonalKey, setGarminPersonalKey] = useState(() => {
    try {
      return localStorage.getItem('aeropulse_garmin_personal_api_key') || '';
    } catch {
      return '';
    }
  });
  const [isConnectingGarmin, setIsConnectingGarmin] = useState(false);
  const [garminLinkedLocal, setGarminLinkedLocal] = useState(false);

  const [expandIntervals, setExpandIntervals] = useState(false);
  const [intervalsAthleteId, setIntervalsAthleteId] = useState(status.intervalsAthleteId || '0');
  const [intervalsApiKey, setIntervalsApiKey] = useState('');
  const [isConnectingIntervals, setIsConnectingIntervals] = useState(false);

  // Team Join Preview & Claim State
  const [joinCodeInput, setJoinCodeInput] = useState(initialJoin.codeOrSlug);
  const [inviteToken, setInviteToken] = useState(initialJoin.token);
  const [invitePreview, setInvitePreview] = useState<TeamInvitePreviewPayload | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Cross-Device Email OTP State
  const [otpEmail, setOtpEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpDevPreview, setOtpDevPreview] = useState<string | null>(null);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [otpFeedback, setOtpFeedback] = useState<string | null>(null);
  const [isEntering, setIsEntering] = useState(false);

  const currentHostname =
    typeof window !== 'undefined' ? window.location.hostname : 'thresh.app';

  const isGarminConnected = Boolean(
    status.garminConnected ||
      garminLinkedLocal ||
      (typeof window !== 'undefined' &&
        localStorage.getItem('aeropulse_garmin_personal_api_key'))
  );

  const hasSavedDeviceData = Boolean(
    status.stravaConnected || status.intervalsConnected || isGarminConnected
  );

  useEffect(() => {
    if (status.stravaClientId && !stravaClientId) {
      setStravaClientId(status.stravaClientId);
    }
  }, [status.stravaClientId, stravaClientId]);

  // Auto-open the guided Strava API credentials box if the server reports missing STRAVA_CLIENT_ID
  useEffect(() => {
    if (
      errorMessage &&
      (errorMessage.includes('STRAVA_CLIENT_ID') || errorMessage.includes('not configured'))
    ) {
      setShowCustomStravaKeys(true);
    }
  }, [errorMessage]);

  const liveSeedCalibration = useMemo(
    () => calibrateThresholdsFromSeedMark(seedMarkInput, primarySport, distanceUnit),
    [seedMarkInput, primarySport, distanceUnit]
  );

  const lookupTeamPreview = async (codeOrSlug: string, token?: string) => {
    const clean = codeOrSlug.trim();
    if (!clean) {
      setInvitePreview(null);
      applyTeamBrandToDocument(null);
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
        setSafeSportHideWeight(
          Boolean(data.brand.defaultSafeSportShield || data.membership?.isMinorU18)
        );
        if (data.membership) {
          if (data.membership.invitedName) setAthleteName(data.membership.invitedName);
          if (data.membership.invitedEmail) setAthleteEmail(data.membership.invitedEmail);
          if (data.membership.seedMarkOrFtp) setSeedMarkInput(data.membership.seedMarkOrFtp);
        }
      } else {
        applyTeamBrandToDocument(null);
        setJoinError('Team code not found — double-check the 6-character code from your coach.');
      }
    } catch {
      setJoinError('Could not reach server to preview team invite.');
    } finally {
      setIsLoadingPreview(false);
    }
  };

  useEffect(() => {
    if (initialJoin.codeOrSlug) {
      void lookupTeamPreview(initialJoin.codeOrSlug, initialJoin.token);
    }
  }, [initialJoin.codeOrSlug, initialJoin.token]);

  const handleEnterWorkspace = async (
    entryTarget: FirstRunCalibrationPayload['entryTarget'] = 'WORKSPACE'
  ) => {
    setIsEntering(true);
    setJoinError(null);
    try {
      const sessionResp = await fetch('/api/auth/session', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athleteName: athleteName.trim() || 'Athlete' }),
      })
        .then((r) => r.json())
        .catch(() => ({}));

      if (onCompleteCalibrationEntry) {
        await onCompleteCalibrationEntry({
          athleteName:
            athleteName.trim() ||
            status.stravaAthleteName ||
            status.garminAthleteName ||
            'Athlete',
          primarySport,
          distanceUnit,
          weightDisplay: distanceUnit === 'mi' ? 158 : 71.5,
          cyclingFtpWatts: seedMarkInput.trim() ? liveSeedCalibration.cyclingFtpWatts : 250,
          thresholdPaceInput: seedMarkInput.trim()
            ? liveSeedCalibration.thresholdPaceInputDisplay
            : distanceUnit === 'mi'
              ? '7:15'
              : '4:30',
          safeSportHideWeight,
          sessionToken: sessionResp?.sessionToken,
          entryTarget,
        });
      }
    } finally {
      setIsEntering(false);
    }
  };

  const handleStravaLaunchClick = async (oauthMode: 'cloud' | 'localhost' = 'cloud') => {
    setIsRedirecting(true);
    setStepNotice(null);
    try {
      await fetch('/api/auth/session', {
        method: 'POST',
        credentials: 'include',
      }).catch(() => null);
      await onLaunchStravaOAuth(oauthMode);
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
      await fetch('/api/auth/session', {
        method: 'POST',
        credentials: 'include',
      }).catch(() => null);
      if (onSaveStravaCredentials) {
        await onSaveStravaCredentials(stravaClientId.trim(), stravaClientSecret.trim());
      }
      await onLaunchStravaOAuth('cloud');
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

  const handleConnectGarminInline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!garminPersonalKey.trim()) return;
    setIsConnectingGarmin(true);
    setStepNotice(null);
    try {
      await fetch('/api/auth/session', { method: 'POST', credentials: 'include' }).catch(
        () => null
      );
      const resp = await fetch('/api/config/garmin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-session': 'active',
        },
        body: JSON.stringify({ personalApiKey: garminPersonalKey.trim() }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setStepNotice(data.error || 'Could not verify Garmin Personal API Key.');
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
        setStepNotice(
          `Garmin Connect linked${data.garminAthleteName ? ` (${data.garminAthleteName})` : ''}!`
        );
        if (onSyncNow) await onSyncNow(false);
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

  const handleClaimTeamAndEnter = async () => {
    const code = joinCodeInput.trim();
    if (!code) {
      setJoinError('Enter your 6-character Team Join Code (e.g. PAXC-26).');
      return;
    }
    setIsEntering(true);
    setJoinError(null);
    try {
      const resp = await fetch('/api/teams/join-claim', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: typeof window !== 'undefined' ? window.location.origin : undefined,
          codeOrSlug: code,
          inviteToken: inviteToken || undefined,
          athleteName: athleteName.trim() || 'Team Athlete',
          athleteEmail: athleteEmail.trim() || undefined,
          seedMarkOrFtp: seedMarkInput.trim() || undefined,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setJoinError(data.error || 'Could not claim team invite.');
        return;
      }
      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/join/')) {
        window.history.replaceState({}, '', '/');
      }
      const claimedTeam = data.team as TeamSummaryWithRole;
      const allTeams = (data.teams as TeamSummaryWithRole[]) || [claimedTeam];

      if (onCompleteCalibrationEntry) {
        await onCompleteCalibrationEntry({
          athleteName: athleteName.trim() || 'Team Athlete',
          primarySport: claimedTeam?.brand?.primarySport || primarySport,
          distanceUnit,
          weightDisplay: distanceUnit === 'mi' ? 158 : 71.5,
          cyclingFtpWatts:
            data.calibrated?.cyclingFtpWatts || liveSeedCalibration.cyclingFtpWatts || 250,
          thresholdPaceInput:
            data.calibrated?.thresholdPaceInputDisplay ||
            liveSeedCalibration.thresholdPaceInputDisplay ||
            '7:15',
          safeSportHideWeight: Boolean(data.safeSportShieldEnforced || safeSportHideWeight),
          claimedTeams: allTeams,
          activeTeamId: claimedTeam?.brand?.teamId,
          sessionToken: data.sessionToken,
          entryTarget: 'WORKSPACE',
        });
      }
    } catch {
      setJoinError('Network error claiming team invite. Please try again.');
    } finally {
      setIsEntering(false);
    }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpEmail.trim()) return;
    setIsSendingOtp(true);
    setOtpFeedback(null);
    setOtpDevPreview(null);
    try {
      const resp = await fetch('/api/auth/email/send-otp', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: otpEmail.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setOtpFeedback(data.error || 'Could not send verification code.');
        return;
      }
      setOtpSent(true);
      if (data.devPreviewCode) {
        setOtpDevPreview(String(data.devPreviewCode));
        setOtpCode(String(data.devPreviewCode));
      } else {
        setOtpFeedback(`Sent a 6-digit code to ${otpEmail.trim()}.`);
      }
    } catch {
      setOtpFeedback('Network error sending verification code.');
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpEmail.trim() || otpCode.trim().length < 6) return;
    setIsEntering(true);
    setOtpFeedback(null);
    try {
      const resp = await fetch('/api/auth/email/verify-otp', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: typeof window !== 'undefined' ? window.location.origin : undefined,
          email: otpEmail.trim(),
          code: otpCode.trim(),
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setOtpFeedback(data.error || 'Incorrect or expired verification code.');
        return;
      }
      const teams = (data.teams as TeamSummaryWithRole[]) || [];
      const firstTeam = teams[0];
      if (onCompleteCalibrationEntry) {
        await onCompleteCalibrationEntry({
          athleteName:
            data.displayName || otpEmail.trim().split('@')[0] || 'Athlete',
          primarySport: firstTeam?.brand?.primarySport || primarySport,
          distanceUnit,
          weightDisplay: distanceUnit === 'mi' ? 158 : 71.5,
          cyclingFtpWatts: 250,
          thresholdPaceInput: distanceUnit === 'mi' ? '7:15' : '4:30',
          safeSportHideWeight: Boolean(firstTeam?.brand?.defaultSafeSportShield),
          claimedTeams: teams,
          activeTeamId: firstTeam?.brand?.teamId,
          sessionToken: data.sessionToken,
          entryTarget: 'WORKSPACE',
        });
      }
    } catch {
      setOtpFeedback('Failed to verify sign-in code.');
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
    isSyncing ||
    isRedirecting ||
    isExchanging ||
    isEntering ||
    isSendingOtp ||
    isConnectingGarmin ||
    isConnectingIntervals;

  const activeBrand = mode === 'TEAM_JOIN' && invitePreview?.found ? invitePreview.brand : null;

  return (
    <div className="min-h-screen py-4 sm:py-8 px-3 sm:px-6 flex flex-col justify-center">
      <div className="max-w-2xl w-full mx-auto space-y-4">
        {/* Clean Top Navigation Bar */}
        <header className="rounded-2xl liquid-glass-header px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <AeroPulseLogo size="sm" teamBrand={activeBrand} />

          <div className="flex items-center gap-1.5 sm:gap-2">
            {mode !== 'NEW_ATHLETE' ? (
              <button
                type="button"
                onClick={() => {
                  setMode('NEW_ATHLETE');
                  applyTeamBrandToDocument(null);
                }}
                className="min-h-[34px] px-3 py-1 rounded-xl ap-btn-secondary !min-h-[34px] text-xs cursor-pointer"
              >
                ← New User Setup
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setMode('TEAM_JOIN');
                    if (invitePreview?.brand) applyTeamBrandToDocument(invitePreview.brand);
                  }}
                  className="min-h-[34px] px-2.5 py-1 rounded-xl liquid-capsule-track text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Users className="w-3.5 h-3.5 ap-text-brand" />
                  <span>Team Code</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('EMAIL_OTP');
                    applyTeamBrandToDocument(null);
                  }}
                  className="min-h-[34px] px-2.5 py-1 rounded-xl liquid-capsule-track text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <KeyRound className="w-3.5 h-3.5 ap-text-brand" />
                  <span className="hidden xs:inline">Email Sign-In</span>
                </button>
              </>
            )}

            {onToggleDark && (
              <button
                type="button"
                onClick={onToggleDark}
                aria-label="Toggle color theme"
                className="min-h-[34px] min-w-[34px] px-2 py-1 rounded-xl liquid-capsule-track text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer"
                title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              >
                {isDark ? (
                  <Sun className="w-4 h-4 text-amber-400" weight="fill" />
                ) : (
                  <Moon className="w-4 h-4 text-slate-700" weight="fill" />
                )}
              </button>
            )}
          </div>
        </header>

        {/* Main Darker-Green Framed Content Area */}
        <main className="ap-content-stage p-5 sm:p-8 space-y-6">
          {(errorMessage || joinError) && (
            <div className="ap-status-strained rounded-xl p-3.5 text-xs leading-relaxed break-words">
              {joinError || errorMessage}
            </div>
          )}

          {stepNotice && (
            <div className="ap-status-prime rounded-xl p-3 text-xs font-medium flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{stepNotice}</span>
            </div>
          )}

          {/* ==============================================================
              GUIDED 3-STEP NEW USER ONBOARDING FLOW
             ============================================================== */}
          {mode === 'NEW_ATHLETE' && (
            <>
              {/* Simple 3-Step Pill Progress Bar */}
              <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl liquid-capsule-track text-xs">
                {(
                  [
                    { id: 1 as const, label: '1. Why THRESH' },
                    { id: 2 as const, label: '2. Connect Strava' },
                    { id: 3 as const, label: '3. Garmin / More' },
                  ] as const
                ).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStep(s.id)}
                    className={`min-h-[36px] px-2 py-1 rounded-lg transition-all cursor-pointer truncate ${
                      step === s.id
                        ? 'ap-nav-volt-active'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-medium'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* STEP 1: PRIMARY BENEFITS */}
              {step === 1 && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <span className="ap-eyebrow block">Step 1 of 3 · Welcome</span>
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight">
                      Know How Hard to Push Today—Before You Head Out.
                    </h1>
                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      THRESH turns your running and cycling workouts into a clear daily recovery check and adaptive training plan, without cluttered spreadsheets.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="liquid-glass rounded-xl p-4 flex items-start gap-3.5">
                      <div className="w-9 h-9 rounded-xl ap-badge-volt flex items-center justify-center shrink-0 mt-0.5">
                        <HeartPulse className="w-4 h-4" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                          Daily Readiness &amp; Smart Workout Prescription
                        </h2>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                          See whether your recent training load is productive or strained, plus a recommended session auto-tuned to your recovery.
                        </p>
                      </div>
                    </div>

                    <div className="liquid-glass rounded-xl p-4 flex items-start gap-3.5">
                      <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-0.5">
                        <TrendingUp className="w-4 h-4" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                          Unified Run + Ride Progress &amp; PRs
                        </h2>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                          Track fitness &amp; fatigue curves, power/pace bests, route maps, and race goals across outdoor and indoor workouts.
                        </p>
                      </div>
                    </div>

                    <div className="liquid-glass rounded-xl p-4 flex items-start gap-3.5">
                      <div className="w-9 h-9 rounded-xl bg-teal-500/15 text-teal-700 dark:text-teal-300 border border-teal-500/30 flex items-center justify-center shrink-0 mt-0.5">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                          Built-In AI Coach &amp; Optional Team Rosters
                        </h2>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                          Ask the AI Coach to adjust your week in plain English, or join a school or club team with a single invite code.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => handleEnterWorkspace('WORKSPACE')}
                      disabled={busy}
                      className="text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white py-2 cursor-pointer order-2 sm:order-1"
                    >
                      Skip setup &amp; explore app
                    </button>

                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="ap-btn-primary text-sm px-6 cursor-pointer order-1 sm:order-2"
                    >
                      <span>Next: Connect Strava</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 2: AUTHENTICATE WITH STRAVA */}
              {step === 2 && (
                <div className="space-y-5">
                  <div className="space-y-1.5">
                    <span className="ap-eyebrow block">Step 2 of 3 · Strava Sign-In</span>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                      Authenticate With Strava
                    </h1>
                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      Connect your Strava account to pull in your runs, rides, routes, and personal records automatically.
                    </p>
                  </div>

                  {status.stravaConnected ? (
                    <div className="rounded-2xl ap-status-prime p-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <CheckCircle2 className="w-5 h-5 shrink-0" />
                        <div>
                          <div className="text-sm font-bold">
                            Strava Connected
                            {status.stravaAthleteName ? ` (${status.stravaAthleteName})` : ''}
                          </div>
                          <div className="text-xs opacity-90">
                            Your workouts are ready to sync. Next, optionally add Garmin or Intervals.icu.
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setStep(3)}
                        className="ap-btn-primary text-xs cursor-pointer"
                      >
                        <span>Continue to Step 3</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="liquid-glass rounded-2xl p-4 sm:p-5 space-y-4">
                      <ol className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300 list-decimal list-inside">
                        <li>
                          Click <strong>Continue with Strava</strong> below and sign in with your Strava credentials.
                        </li>
                        <li>
                          Keep <strong>&ldquo;View data about your activities&rdquo;</strong> checked and tap <strong>Authorize</strong>.
                        </li>
                        <li>
                          You&apos;ll return automatically—your Strava data stays private in read-only mode.
                        </li>
                      </ol>

                      <button
                        type="button"
                        onClick={() => handleStravaLaunchClick('cloud')}
                        disabled={busy}
                        className="w-full min-h-[48px] py-3 px-5 rounded-xl bg-[#FC4C02] hover:bg-[#E34402] disabled:opacity-60 text-white font-bold text-sm flex items-center justify-center gap-2.5 shadow-md transition-all cursor-pointer"
                      >
                        {isRedirecting ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Activity className="w-4 h-4" />
                        )}
                        <span>
                          {isRedirecting ? 'Redirecting to Strava...' : 'Continue with Strava'}
                        </span>
                        <ExternalLink className="w-3.5 h-3.5 opacity-85" />
                      </button>

                      {/* Guided Personal Strava API Credentials Walkthrough */}
                      <div className="pt-3 border-t border-slate-200/80 dark:border-white/10">
                        <button
                          type="button"
                          onClick={() => setShowCustomStravaKeys((prev) => !prev)}
                          className="w-full flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer py-1"
                        >
                          <span>
                            Using your own Strava API Client ID &amp; Secret? (60-second guide)
                          </span>
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
                                and create/view your personal API app.
                              </li>
                              <li>
                                Set Strava&apos;s <strong>Authorization Callback Domain</strong> to:
                                <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-white dark:bg-[#0D1210] border border-slate-300 dark:border-slate-700 px-3 py-1.5 font-mono">
                                  <span className="font-bold text-slate-900 dark:text-white truncate">
                                    {currentHostname}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={handleCopyDomain}
                                    className="inline-flex items-center gap-1 text-[11px] font-semibold ap-text-brand shrink-0 cursor-pointer"
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
                              <li>
                                Paste your <strong>Client ID</strong> and <strong>Client Secret</strong> below:
                              </li>
                            </ol>

                            <form onSubmit={handleSaveKeysAndLaunchStrava} className="space-y-2.5">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                <input
                                  type="text"
                                  required
                                  value={stravaClientId}
                                  onChange={(e) => setStravaClientId(e.target.value)}
                                  placeholder="Client ID (e.g. 123456)"
                                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                                />
                                <input
                                  type="password"
                                  value={stravaClientSecret}
                                  onChange={(e) => setStravaClientSecret(e.target.value)}
                                  placeholder={
                                    status.stravaClientId
                                      ? 'Client Secret (saved)'
                                      : 'Client Secret'
                                  }
                                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                                />
                              </div>
                              <button
                                type="submit"
                                disabled={busy || !stravaClientId.trim()}
                                className="w-full min-h-[40px] rounded-lg bg-[#FC4C02] hover:bg-[#E34402] disabled:opacity-50 text-white font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <span>Save Keys &amp; Authorize Strava</span>
                                <ExternalLink className="w-3.5 h-3.5" />
                              </button>
                            </form>

                            {(onExchangeStravaCode || onSaveStravaDirectToken) && (
                              <details className="pt-2 border-t border-slate-200/70 dark:border-white/10">
                                <summary className="cursor-pointer text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 select-none">
                                  Or paste a Strava Refresh Token / localhost redirect URL directly
                                </summary>
                                <form onSubmit={handleManualExchangeSubmit} className="mt-2 space-y-2">
                                  <input
                                    type="text"
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
                                    className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                                  />
                                  <button
                                    type="submit"
                                    disabled={busy || (!manualCodeInput.trim() && !directRefreshToken.trim())}
                                    className="ap-btn-secondary w-full !min-h-[36px] text-xs cursor-pointer"
                                  >
                                    Verify &amp; Connect
                                  </button>
                                </form>
                              </details>
                            )}
                          </div>
                        )}
                      </div>
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
                      onClick={() => setStep(3)}
                      className="text-xs font-semibold ap-text-brand hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      <span>
                        {status.stravaConnected
                          ? 'Next: Garmin / Intervals.icu'
                          : 'Skip Strava for now → Garmin / Intervals'}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 3: OPTIONAL GARMIN CONNECT OR INTERVALS.ICU */}
              {step === 3 && (
                <div className="space-y-5">
                  <div className="space-y-1.5">
                    <span className="ap-eyebrow block">Step 3 of 3 · Optional Biometrics</span>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                      Connect Garmin or Intervals.icu (Optional)
                    </h1>
                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      Add overnight Sleep, HRV, and Resting Heart Rate if you use Garmin Connect or Intervals.icu—or jump right into THRESH and connect later.
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
                              <span className="ap-status-prime px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold">
                                Connected ✓
                              </span>
                            ) : (
                              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                Optional
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                            Syncs Sleep, HRV, Resting HR, Weight, and Garmin workouts via Personal API Key.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setExpandGarmin((prev) => !prev)}
                          className="ap-btn-secondary !min-h-[36px] text-xs shrink-0 cursor-pointer"
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
                              Paste your <code className="font-mono">GCDC_...</code> key:
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
                          <div className="flex gap-2">
                            <input
                              type="password"
                              required
                              value={garminPersonalKey}
                              onChange={(e) => setGarminPersonalKey(e.target.value)}
                              placeholder="GCDC_00000000-0000-..."
                              className="flex-1 min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                            />
                            <button
                              type="submit"
                              disabled={busy || !garminPersonalKey.trim()}
                              className="ap-btn-primary !min-h-[40px] text-xs shrink-0 cursor-pointer"
                            >
                              {isConnectingGarmin ? 'Linking...' : 'Save Garmin'}
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
                              <span className="ap-status-prime px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold">
                                Connected ✓
                              </span>
                            ) : (
                              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                Optional
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                            Syncs training load, planned calendar workouts, and wellness metrics.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setExpandIntervals((prev) => !prev)}
                          className="ap-btn-secondary !min-h-[36px] text-xs shrink-0 cursor-pointer"
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
                              <span>Open Intervals.icu Settings</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                            <input
                              type="text"
                              value={intervalsAthleteId}
                              onChange={(e) => setIntervalsAthleteId(e.target.value)}
                              placeholder="0 or i12345"
                              className="sm:col-span-3 min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                            />
                            <input
                              type="password"
                              required
                              value={intervalsApiKey}
                              onChange={(e) => setIntervalsApiKey(e.target.value)}
                              placeholder="Intervals.icu API Key"
                              className="sm:col-span-6 min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                            />
                            <button
                              type="submit"
                              disabled={busy || !intervalsApiKey.trim()}
                              className="sm:col-span-3 ap-btn-primary !min-h-[40px] text-xs cursor-pointer"
                            >
                              {isConnectingIntervals ? 'Linking...' : 'Connect'}
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  </div>

                  {/* Lightweight Name & Units Row */}
                  <div className="rounded-xl liquid-glass-subtle p-3.5 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex-1 min-w-[180px]">
                      <input
                        type="text"
                        value={athleteName}
                        onChange={(e) => setAthleteName(e.target.value)}
                        placeholder="Your name (optional, e.g. Alex Rivera)"
                        className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div className="inline-flex rounded-lg p-0.5 liquid-capsule-track text-xs font-mono shrink-0">
                      {(['mi', 'km'] as const).map((u) => (
                        <button
                          key={u}
                          type="button"
                          onClick={() => setDistanceUnit(u)}
                          className={`min-h-[32px] px-3 py-1 rounded-md font-bold transition-colors cursor-pointer ${
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

                  <div className="pt-1 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="ap-btn-secondary text-xs cursor-pointer"
                    >
                      ← Back
                    </button>

                    <button
                      type="button"
                      onClick={() => handleEnterWorkspace('WORKSPACE')}
                      disabled={busy}
                      className="ap-btn-primary text-sm px-6 cursor-pointer"
                    >
                      {isEntering ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                      <span>Enter THRESH</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ==============================================================
              MODE B: STREAMLINED TEAM JOIN CODE FLOW
             ============================================================== */}
          {mode === 'TEAM_JOIN' && (
            <div className="space-y-4">
              <div>
                <span className="ap-eyebrow block">Team Roster Invitation</span>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
                  {activeBrand ? `Join ${activeBrand.name}` : 'Join With Your Team Code'}
                </h1>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Enter the 6-character code from your coach to unlock your team&apos;s branded workspace and pacing groups.
                </p>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={joinCodeInput}
                  onChange={(e) => {
                    setJoinCodeInput(e.target.value.toUpperCase());
                    setInviteToken('');
                  }}
                  placeholder="Team Code (e.g. PAXC-26)"
                  className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-2 text-sm font-mono font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  disabled={isLoadingPreview || !joinCodeInput.trim()}
                  onClick={() => lookupTeamPreview(joinCodeInput, inviteToken)}
                  className="ap-btn-secondary text-xs shrink-0 cursor-pointer"
                >
                  {isLoadingPreview ? 'Checking...' : 'Preview Team'}
                </button>
              </div>

              {activeBrand && (
                <div
                  className="rounded-xl p-4 text-white shadow-sm space-y-1.5"
                  style={{
                    background: `linear-gradient(135deg, ${activeBrand.primaryHex} 0%, ${activeBrand.secondaryHex} 100%)`,
                  }}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] font-mono uppercase tracking-wider opacity-95">
                    <span>
                      {invitePreview?.membership?.squadGroup || 'Team Roster'} · {activeBrand.joinCode}
                    </span>
                    <span>Coach {activeBrand.coachDisplayName}</span>
                  </div>
                  <div className="text-sm font-bold">
                    {invitePreview?.membership?.invitedName
                      ? `Spot reserved for ${invitePreview.membership.invitedName}`
                      : `Ready to join ${activeBrand.name}`}
                  </div>
                  {activeBrand.defaultSafeSportShield && (
                    <div className="text-[11px] opacity-95 flex items-center gap-1.5 pt-0.5">
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      <span>Safe-Sport Youth Mode: Body weight &amp; W/kg hidden by default.</span>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Your Name
                  </label>
                  <input
                    type="text"
                    value={athleteName}
                    onChange={(e) => setAthleteName(e.target.value)}
                    placeholder="e.g. Maya Chen"
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Recent Race Time or FTP (Optional)
                  </label>
                  <input
                    type="text"
                    value={seedMarkInput}
                    onChange={(e) => setSeedMarkInput(e.target.value)}
                    placeholder='e.g. "18:20 5K" or "260W"'
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleClaimTeamAndEnter}
                disabled={busy}
                className="w-full ap-btn-primary text-sm cursor-pointer"
              >
                {isEntering ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                <span>
                  {activeBrand ? `Accept Invite & Join ${activeBrand.shortName}` : 'Claim Team Spot'}
                </span>
              </button>
            </div>
          )}

          {/* ==============================================================
              MODE C: EMAIL OTP CROSS-DEVICE SIGN-IN
             ============================================================== */}
          {mode === 'EMAIL_OTP' && (
            <div className="space-y-4">
              <div>
                <span className="ap-eyebrow block">Cross-Device Sync</span>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
                  Sign In With Email Code
                </h1>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Enter your email to receive a 6-digit sign-in code and restore your teams across devices.
                </p>
              </div>

              {otpFeedback && (
                <div className="ap-status-info rounded-xl p-3 text-xs font-medium">{otpFeedback}</div>
              )}

              {otpDevPreview && (
                <div className="ap-status-caution rounded-xl p-3 text-xs font-mono">
                  Dev Preview Code: <strong className="text-sm">{otpDevPreview}</strong>
                </div>
              )}

              <form onSubmit={otpSent ? handleVerifyOtp : handleSendOtp} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={otpEmail}
                    onChange={(e) => {
                      setOtpEmail(e.target.value);
                      if (otpSent) setOtpSent(false);
                    }}
                    placeholder="you@example.com"
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                  />
                </div>

                {otpSent && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      6-Digit Code
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      required
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="123456"
                      className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-2 text-base font-mono tracking-[0.25em] font-bold text-slate-900 dark:text-slate-100"
                    />
                  </div>
                )}

                <div className="flex gap-2.5">
                  <button
                    type="submit"
                    disabled={busy}
                    className="flex-1 ap-btn-primary text-sm cursor-pointer"
                  >
                    {isSendingOtp || isEntering ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : otpSent ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    <span>{otpSent ? 'Verify & Sign In' : 'Send 6-Digit Code'}</span>
                  </button>
                  {otpSent && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleSendOtp}
                      className="ap-btn-secondary text-xs cursor-pointer"
                    >
                      Resend
                    </button>
                  )}
                </div>
              </form>
            </div>
          )}

          {hasSavedDeviceData && onDisconnectCredentials && (
            <div className="pt-3 border-t border-slate-200/80 dark:border-white/10 flex justify-end">
              <button
                type="button"
                onClick={onDisconnectCredentials}
                className="text-xs text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Clear saved device credentials</span>
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
