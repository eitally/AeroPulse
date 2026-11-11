import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bike,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Database,
  ExternalLink,
  Footprints,
  KeyRound,
  Lock,
  LogOut,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trophy,
  Upload,
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
  onExchangeStravaCode?: (codeOrUrl: string) => Promise<void>;
  onCompleteCalibrationEntry?: (payload: FirstRunCalibrationPayload) => Promise<void>;
  onDisconnectCredentials?: () => Promise<void>;
  isSyncing: boolean;
  errorMessage: string | null;
}

type OnboardingMode = 'NEW_ATHLETE' | 'TEAM_JOIN' | 'EMAIL_OTP';

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
  onExchangeStravaCode,
  onCompleteCalibrationEntry,
  onDisconnectCredentials,
  isSyncing,
  errorMessage,
}) => {
  const initialJoin = useMemo(() => detectInitialJoinParams(), []);

  const [mode, setMode] = useState<OnboardingMode>(
    initialJoin.codeOrSlug ? 'TEAM_JOIN' : 'NEW_ATHLETE'
  );

  // Shared Athlete Calibration State
  const [athleteName, setAthleteName] = useState('');
  const [athleteEmail, setAthleteEmail] = useState('');
  const [primarySport, setPrimarySport] = useState<'Cycling' | 'Running' | 'Hybrid'>('Hybrid');
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>('mi');
  const [weightInput, setWeightInput] = useState('158');
  const [ftpInput, setFtpInput] = useState('260');
  const [paceInput, setPaceInput] = useState('7:15');
  const [seedMarkInput, setSeedMarkInput] = useState('');
  const [useExactLabThresholds, setUseExactLabThresholds] = useState(false);
  const [safeSportHideWeight, setSafeSportHideWeight] = useState(false);

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

  // Strava & Action State
  const [isEntering, setIsEntering] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [showStravaDrawer, setShowStravaDrawer] = useState(false);
  const [showRedirectHelp, setShowRedirectHelp] = useState(false);
  const [copiedDomain, setCopiedDomain] = useState(false);
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [isExchanging, setIsExchanging] = useState(false);

  const currentHostname =
    typeof window !== 'undefined' ? window.location.hostname : 'thresh.app';

  const hasSavedDeviceData = Boolean(
    status.stravaConnected || status.intervalsConnected || status.garminConnected
  );

  // Live VDOT / Wattage auto-calibration preview for beginners & watchless athletes
  const liveSeedCalibration = useMemo(
    () => calibrateThresholdsFromSeedMark(seedMarkInput, primarySport, distanceUnit),
    [seedMarkInput, primarySport, distanceUnit]
  );

  // Fetch team preview when arriving via `/join/<slug>?t=<token>` or looking up a code
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
        const enforceShield = Boolean(
          data.brand.defaultSafeSportShield || data.membership?.isMinorU18
        );
        setSafeSportHideWeight(enforceShield);
        if (data.membership) {
          if (data.membership.invitedName) setAthleteName(data.membership.invitedName);
          if (data.membership.invitedEmail) setAthleteEmail(data.membership.invitedEmail);
          if (data.membership.seedMarkOrFtp) {
            setSeedMarkInput(data.membership.seedMarkOrFtp);
          }
        }
      } else {
        applyTeamBrandToDocument(null);
        setJoinError('Team code not found yet — double-check the 6-character code from your coach.');
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

  const handleUnitChange = (nextUnit: DistanceUnit) => {
    if (nextUnit === distanceUnit) return;
    const curW = Number(weightInput);
    if (Number.isFinite(curW) && curW > 0) {
      setWeightInput(
        nextUnit === 'km'
          ? (curW / 2.20462).toFixed(1)
          : String(Math.round(curW * 2.20462))
      );
    }
    if (paceInput === '7:15' && nextUnit === 'km') setPaceInput('4:30');
    else if (paceInput === '4:30' && nextUnit === 'mi') setPaceInput('7:15');
    setDistanceUnit(nextUnit);
  };

  const resolveEffectiveThresholds = () => {
    if (!useExactLabThresholds && seedMarkInput.trim()) {
      return {
        ftpWatts: liveSeedCalibration.cyclingFtpWatts,
        paceDisplay: liveSeedCalibration.thresholdPaceInputDisplay,
      };
    }
    return {
      ftpWatts: Math.max(80, Math.round(Number(ftpInput) || 250)),
      paceDisplay: paceInput.trim() || (distanceUnit === 'mi' ? '7:15' : '4:30'),
    };
  };

  const handleCalibrationLaunch = async (
    entryTarget: FirstRunCalibrationPayload['entryTarget']
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

      const { ftpWatts, paceDisplay } = resolveEffectiveThresholds();

      if (onCompleteCalibrationEntry) {
        await onCompleteCalibrationEntry({
          athleteName: athleteName.trim() || 'Athlete',
          primarySport,
          distanceUnit,
          weightDisplay: Math.max(
            35,
            Number(weightInput) || (distanceUnit === 'mi' ? 158 : 71.5)
          ),
          cyclingFtpWatts: ftpWatts,
          thresholdPaceInput: paceDisplay,
          safeSportHideWeight,
          sessionToken: sessionResp?.sessionToken,
          entryTarget,
        });
      }
    } finally {
      setIsEntering(false);
    }
  };

  const handleClaimTeamAndEnter = async (
    entryTarget: FirstRunCalibrationPayload['entryTarget'] = 'WORKSPACE'
  ) => {
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

      const { ftpWatts, paceDisplay } = resolveEffectiveThresholds();
      const claimedTeam = data.team as TeamSummaryWithRole;
      const allTeams = (data.teams as TeamSummaryWithRole[]) || [claimedTeam];

      if (onCompleteCalibrationEntry) {
        await onCompleteCalibrationEntry({
          athleteName: athleteName.trim() || 'Team Athlete',
          primarySport: claimedTeam?.brand?.primarySport || primarySport,
          distanceUnit,
          weightDisplay: Math.max(
            35,
            Number(weightInput) || (distanceUnit === 'mi' ? 158 : 71.5)
          ),
          cyclingFtpWatts: data.calibrated?.cyclingFtpWatts || ftpWatts,
          thresholdPaceInput: data.calibrated?.thresholdPaceInputDisplay || paceDisplay,
          safeSportHideWeight: Boolean(
            data.safeSportShieldEnforced || safeSportHideWeight
          ),
          claimedTeams: allTeams,
          activeTeamId: claimedTeam?.brand?.teamId,
          sessionToken: data.sessionToken,
          entryTarget,
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
        setOtpFeedback(`Sent a 6-digit code via Resend to ${otpEmail.trim()}.`);
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
            data.displayName ||
            athleteName.trim() ||
            otpEmail.trim().split('@')[0] ||
            'Athlete',
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

  const handleStravaLaunchClick = async (oauthMode: 'cloud' | 'localhost' = 'cloud') => {
    setIsRedirecting(true);
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

  const handleCopyDomain = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(currentHostname).catch(() => {});
      setCopiedDomain(true);
      window.setTimeout(() => setCopiedDomain(false), 2000);
    }
  };

  const handleManualExchangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onExchangeStravaCode || !manualCodeInput.trim()) return;
    setIsExchanging(true);
    try {
      await onExchangeStravaCode(manualCodeInput.trim());
      setManualCodeInput('');
    } finally {
      setIsExchanging(false);
    }
  };

  const busy = isSyncing || isRedirecting || isExchanging || isEntering || isSendingOtp;
  const activeBrand = mode === 'TEAM_JOIN' && invitePreview?.found ? invitePreview.brand : null;

  return (
    <div className="min-h-screen bg-[#F7F6F2] dark:bg-[#0A0B0D] text-slate-900 dark:text-slate-100 flex flex-col justify-between">
      {/* Top Header (Co-Branded immediately when opening a Team Invite Link!) */}
      <header className="relative border-b border-stone-200 dark:border-slate-800/80 bg-[#F7F6F2]/95 dark:bg-[#121419]/95 px-4 sm:px-6 pt-[max(0.875rem,env(safe-area-inset-top,0px))] pb-3.5 flex items-center justify-between overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[2px] ap-brand-hairline pointer-events-none" />
        <AeroPulseLogo size="md" showTagline teamBrand={activeBrand} />

        <div className="flex items-center gap-2.5">
          {activeBrand?.defaultSafeSportShield && (
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-mono ap-status-prime px-2.5 py-1 rounded-lg">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Safe-Sport Youth Defaults ON</span>
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono ap-status-info px-2.5 py-1 rounded-lg">
            <Lock className="w-3 h-3" />
            <span className="hidden xs:inline">Isolated Session</span>
            <span className="xs:hidden">Private</span>
          </span>
        </div>
      </header>

      {/* Main Split-Screen Onboarding & Calibration */}
      <main className="flex-1 max-w-[1380px] w-full mx-auto px-4 sm:px-6 py-8 lg:py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left 6 Columns: THRESH Value Proposition (or Team Context Highlights) */}
        <div className="lg:col-span-6 space-y-6 order-2 lg:order-1 lg:pt-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full ap-status-info text-xs font-mono font-semibold">
            <span>
              {activeBrand
                ? `${activeBrand.shortName} · OFFICIAL TEAM ROSTER INVITATION`
                : 'FIRST-TOUCH DAILY ENDURANCE & TEAM LAB'}
            </span>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-slate-900 dark:text-white leading-[1.12]">
            {activeBrand
              ? `Join ${activeBrand.name} on THRESH in 45 Seconds.`
              : 'Wake Up Knowing Whether Your Training Is Productive.'}
          </h1>

          <p className="text-sm sm:text-base text-slate-700 dark:text-slate-300 max-w-2xl leading-relaxed">
            {activeBrand ? (
              <>
                Coach <strong className="text-slate-900 dark:text-white">{activeBrand.coachDisplayName}</strong> set up your squad&apos;s daily readiness hub, VDOT pacing pods, and post-workout performance debriefs. Works with <strong className="text-slate-900 dark:text-white">Garmin</strong>, <strong className="text-slate-900 dark:text-white">Intervals.icu</strong>, <strong className="text-slate-900 dark:text-white">.FIT</strong> files, or <strong className="text-slate-900 dark:text-white">watchless track/XC times</strong>.
              </>
            ) : (
              <>
                7-day rolling ramp, strain &amp; Low/High/Neuromuscular Load Focus every morning—paired with frictionless <strong className="text-slate-900 dark:text-white">High School, Collegiate &amp; Club Team Rosters</strong>, bulk Resend invites, and custom team branding.
              </>
            )}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
            <div className="liquid-glass rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-[#1D4ED8] dark:text-[#60A5FA] font-bold">
                  01 / 7-DAY PRODUCTIVITY
                </span>
                <Activity className="w-4 h-4 text-[#1D4ED8] dark:text-[#60A5FA]" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                First-Touch Morning Verdict
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Synthesizes 7-day load ramp, TSB strain, and Low Aerobic / High Aerobic / Neuromuscular balance into one actionable daily brief.
              </p>
            </div>

            <div className="liquid-glass rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-[#0D9488] dark:text-[#2DD4BF] font-bold">
                  02 / MULTI-TEAM &amp; BRANDING
                </span>
                <Users className="w-4 h-4 text-[#0D9488] dark:text-[#2DD4BF]" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                1-Click School &amp; Club Rosters
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Belong to both your High School / College team and off-season Running or Cycling club, switching branded team workspaces in 1 click.
              </p>
            </div>

            <div className="liquid-glass rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-[#047857] dark:text-[#34D399] font-bold">
                  03 / YOUTH SAFEGUARDING
                </span>
                <ShieldCheck className="w-4 h-4 text-[#047857] dark:text-[#34D399]" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Safe-Sport Defaults &amp; Parent CC
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                High School teams automatically mask body weight &amp; W/kg by default and support transparent Parent/Guardian CC on roster invites.
              </p>
            </div>

            <div className="liquid-glass rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-[#D9480F] dark:text-[#FB6514] font-bold">
                  04 / WATCHLESS INCLUSIVE
                </span>
                <Trophy className="w-4 h-4 text-[#D9480F] dark:text-[#FB6514]" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Garmin, .FIT, or Race-Time VDOT
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Sync Garmin Connect &amp; Intervals.icu automatically, or calibrate accurate threshold pacing pods from a single 1600m or 5K race mark.
              </p>
            </div>
          </div>
        </div>

        {/* Right 6 Columns: Multi-Path Onboarding Card */}
        <div className="lg:col-span-6 order-1 lg:order-2">
          <div className="liquid-glass rounded-2xl p-5 sm:p-6 shadow-xl space-y-5">
            {/* 3-Mode Segmented Switcher */}
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl liquid-capsule-track text-xs font-semibold">
              <button
                type="button"
                onClick={() => {
                  setMode('NEW_ATHLETE');
                  applyTeamBrandToDocument(null);
                }}
                className={`min-h-[38px] px-2 py-1.5 rounded-lg transition-all cursor-pointer ${
                  mode === 'NEW_ATHLETE'
                    ? 'liquid-capsule-active text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                New Athlete / Coach
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('TEAM_JOIN');
                  if (invitePreview?.brand) applyTeamBrandToDocument(invitePreview.brand);
                }}
                className={`min-h-[38px] px-2 py-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  mode === 'TEAM_JOIN'
                    ? 'liquid-capsule-active text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Users className="w-3.5 h-3.5 text-[#0D9488]" />
                <span>Join w/ Team Code</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('EMAIL_OTP');
                  applyTeamBrandToDocument(null);
                }}
                className={`min-h-[38px] px-2 py-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  mode === 'EMAIL_OTP'
                    ? 'liquid-capsule-active text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5 text-[#D9480F]" />
                <span>Email Sign-In</span>
              </button>
            </div>

            {(errorMessage || joinError) && (
              <div className="ap-status-strained rounded-xl p-3 text-xs leading-relaxed break-words">
                {joinError || errorMessage}
              </div>
            )}

            {/* ==============================================================
                MODE C: CROSS-DEVICE EMAIL OTP SIGN-IN (RESEND)
               ============================================================== */}
            {mode === 'EMAIL_OTP' && (
              <div className="space-y-4">
                <div className="border-b border-stone-200 dark:border-slate-800 pb-3">
                  <span className="text-[11px] font-mono uppercase tracking-widest text-[#D9480F] dark:text-[#FB6514] block font-bold">
                    PASSWORDLESS CROSS-DEVICE SYNC
                  </span>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                    Sign In With 6-Digit Email Code
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    Restores your teams, coach invitations, and encrypted vault session across your laptop and phone.
                  </p>
                </div>

                {otpFeedback && (
                  <div className="ap-status-info rounded-xl p-3 text-xs font-medium">
                    {otpFeedback}
                  </div>
                )}

                {otpDevPreview && (
                  <div className="ap-status-caution rounded-xl p-3 text-xs font-mono">
                    Local Dev Mode (set <code>RESEND_API_KEY</code> in prod): Verification Code{' '}
                    <strong className="text-sm">{otpDevPreview}</strong>
                  </div>
                )}

                <form onSubmit={otpSent ? handleVerifyOtp : handleSendOtp} className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Athlete or Coach Email
                    </label>
                    <input
                      type="email"
                      required
                      value={otpEmail}
                      onChange={(e) => {
                        setOtpEmail(e.target.value);
                        if (otpSent) setOtpSent(false);
                      }}
                      placeholder="you@school.edu"
                      className="w-full min-h-[44px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  {otpSent && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        6-Digit Verification Code
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        required
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="123456"
                        className="w-full min-h-[44px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] px-3 py-2 text-base font-mono tracking-[0.25em] font-bold text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2.5 pt-1">
                    <button
                      type="submit"
                      disabled={busy}
                      className="flex-1 ap-btn-primary text-sm flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {isSendingOtp || isEntering ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : otpSent ? (
                        <Check className="w-4 h-4" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      <span>
                        {otpSent ? 'Verify Code & Sync Workspace' : 'Send 6-Digit Email Code'}
                      </span>
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

            {/* ==============================================================
                MODE A & B: TEAM INVITE CLAIM OR NEW ATHLETE / COACH SETUP
               ============================================================== */}
            {mode !== 'EMAIL_OTP' && (
              <>
                <div className="flex items-center justify-between border-b border-stone-200 dark:border-slate-800 pb-4 gap-2">
                  <div>
                    <span className="text-[11px] font-mono uppercase tracking-widest text-[#D9480F] dark:text-[#FB6514] block font-bold">
                      {mode === 'TEAM_JOIN'
                        ? '45-SECOND TEAM ROSTER CLAIM'
                        : '60-SECOND CALIBRATION'}
                    </span>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                      {mode === 'TEAM_JOIN' && activeBrand
                        ? `Welcome to ${activeBrand.name}`
                        : mode === 'TEAM_JOIN'
                          ? 'Enter Your Team Join Code'
                          : 'Configure Your THRESH Workspace'}
                    </h2>
                  </div>
                  <div className="inline-flex rounded-lg p-0.5 bg-stone-200/70 dark:bg-slate-800 text-xs font-mono shrink-0">
                    {(['mi', 'km'] as const).map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => handleUnitChange(u)}
                        className={`min-h-[32px] px-2.5 py-1 rounded-md font-bold transition-colors cursor-pointer ${
                          distanceUnit === u
                            ? 'bg-[#1D4ED8] text-white'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {u === 'mi' ? 'mi / lbs' : 'km / kg'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Team Code Lookup + Branded Coach Welcome Banner */}
                {mode === 'TEAM_JOIN' && (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={joinCodeInput}
                        onChange={(e) => {
                          setJoinCodeInput(e.target.value.toUpperCase());
                          setInviteToken('');
                        }}
                        placeholder="Team Code (e.g. PAXC-26) or slug"
                        className="flex-1 min-h-[44px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] px-3 py-2 text-sm font-mono font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100"
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
                        className="rounded-xl p-3.5 text-white shadow-sm space-y-1.5"
                        style={{
                          background: `linear-gradient(135deg, ${activeBrand.primaryHex} 0%, ${activeBrand.secondaryHex} 100%)`,
                        }}
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px] font-mono uppercase tracking-wider opacity-95">
                          <span>
                            {invitePreview?.membership?.squadGroup || 'Varsity Roster'} · Code{' '}
                            {activeBrand.joinCode}
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
                            <span>
                              Safe-Sport Youth Mode: Body weight &amp; W/kg hidden by default.
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Calibration Fields */}
                <div className="space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Athlete / Coach Name
                      </label>
                      <input
                        type="text"
                        value={athleteName}
                        onChange={(e) => setAthleteName(e.target.value)}
                        placeholder="e.g. Maya Chen"
                        className="w-full min-h-[44px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Primary Focus
                      </label>
                      <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-stone-200/60 dark:bg-slate-900 border border-stone-300/70 dark:border-slate-800">
                        {(
                          [
                            { id: 'Hybrid', label: 'Run + Ride' },
                            { id: 'Cycling', label: 'Cycling' },
                            { id: 'Running', label: 'Running' },
                          ] as const
                        ).map((sp) => (
                          <button
                            key={sp.id}
                            type="button"
                            onClick={() => setPrimarySport(sp.id)}
                            className={`min-h-[34px] rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                              primarySport === sp.id
                                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                                : 'text-slate-600 dark:text-slate-400'
                            }`}
                          >
                            {sp.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Beginner-Friendly VDOT Race-Time / Power Calibrator vs Exact Lab Thresholds */}
                  <div className="rounded-xl liquid-glass-subtle p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-[#0D9488]" />
                        <span>
                          {useExactLabThresholds
                            ? 'Exact FTP & Lactate Threshold Pace'
                            : 'Quick Zone Calibration (No Lab Numbers Needed)'}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setUseExactLabThresholds((prev) => !prev)}
                        className="text-[11px] font-mono font-semibold text-[#1D4ED8] dark:text-[#60A5FA] hover:underline cursor-pointer"
                      >
                        {useExactLabThresholds
                          ? 'Use Race Time instead'
                          : 'Enter exact FTP / LT Pace'}
                      </button>
                    </div>

                    {!useExactLabThresholds ? (
                      <div className="space-y-1.5">
                        <input
                          type="text"
                          value={seedMarkInput}
                          onChange={(e) => setSeedMarkInput(e.target.value)}
                          placeholder={
                            primarySport === 'Cycling'
                              ? 'Optional: e.g. "265W" or "20m 280W" (or leave blank for Garmin sync)'
                              : 'Optional: e.g. "18:20 5K", "5:15 1600m", or leave blank for Garmin sync'
                          }
                          className="w-full min-h-[42px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] px-3 py-2 text-xs sm:text-sm font-mono text-slate-900 dark:text-slate-100"
                        />
                        <div className="text-[11px] font-mono text-[#065F46] dark:text-emerald-300">
                          {liveSeedCalibration.summaryNote}
                        </div>
                      </div>
                    ) : (
                      <div
                        className={`grid gap-2.5 ${
                          safeSportHideWeight ? 'grid-cols-2' : 'grid-cols-3'
                        }`}
                      >
                        {!safeSportHideWeight && (
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                              Weight ({distanceUnit === 'mi' ? 'lbs' : 'kg'})
                            </label>
                            <input
                              type="number"
                              step="0.5"
                              min="35"
                              max="350"
                              value={weightInput}
                              onChange={(e) => setWeightInput(e.target.value)}
                              className="w-full min-h-[44px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100"
                            />
                          </div>
                        )}

                        <div>
                          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            <span className="inline-flex items-center gap-1">
                              <Bike className="w-3.5 h-3.5 text-[#1D4ED8] dark:text-[#60A5FA]" />
                              <span>FTP (Watts)</span>
                            </span>
                          </label>
                          <input
                            type="number"
                            min="80"
                            max="550"
                            value={ftpInput}
                            onChange={(e) => setFtpInput(e.target.value)}
                            className="w-full min-h-[44px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            <span className="inline-flex items-center gap-1">
                              <Footprints className="w-3.5 h-3.5 text-[#0D9488] dark:text-[#2DD4BF]" />
                              <span>LT Pace (/{distanceUnit})</span>
                            </span>
                          </label>
                          <input
                            type="text"
                            value={paceInput}
                            onChange={(e) => setPaceInput(e.target.value)}
                            placeholder={distanceUnit === 'mi' ? '7:15' : '4:30'}
                            className="w-full min-h-[44px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Primary & Multi-Source Entry Actions */}
                {mode === 'TEAM_JOIN' ? (
                  <div className="space-y-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => handleClaimTeamAndEnter('WORKSPACE')}
                      disabled={busy}
                      className="w-full ap-btn-primary text-sm flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {isEntering ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                      <span>
                        {activeBrand
                          ? `Accept Invite & Join ${activeBrand.shortName}`
                          : 'Claim Team Spot & Enter THRESH'}
                      </span>
                    </button>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => handleClaimTeamAndEnter('DATA_SOURCES')}
                        disabled={busy}
                        className="ap-btn-secondary text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Database className="w-4 h-4 text-[#1D4ED8] dark:text-[#60A5FA]" />
                        <span>Join + Connect Garmin / Intervals</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleClaimTeamAndEnter('UPLOAD_FIT')}
                        disabled={busy}
                        className="ap-btn-secondary text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Upload className="w-4 h-4 text-[#0D9488] dark:text-[#2DD4BF]" />
                        <span>Join + Upload .FIT File</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCalibrationLaunch('WORKSPACE')}
                      disabled={busy}
                      className="w-full ap-btn-primary text-sm flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {isEntering ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                      <span>Save Baseline &amp; Enter THRESH</span>
                    </button>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => handleCalibrationLaunch('DATA_SOURCES')}
                        disabled={busy}
                        className="ap-btn-secondary text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Database className="w-4 h-4 text-[#1D4ED8] dark:text-[#60A5FA]" />
                        <span>Connect Garmin / Intervals.icu</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleCalibrationLaunch('CREATE_TEAM')}
                        disabled={busy}
                        className="ap-btn-secondary text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Users className="w-4 h-4 text-[#0D9488] dark:text-[#2DD4BF]" />
                        <span>Create School / Club Team</span>
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Secondary Optional Strava Route/Segment Import */}
            <div className="pt-3 border-t border-stone-200 dark:border-slate-800 space-y-2.5">
              <button
                type="button"
                onClick={() => setShowStravaDrawer((prev) => !prev)}
                className="w-full min-h-[40px] flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer px-1"
              >
                <span className="inline-flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-[#FC4C02]" />
                  <span>Optional: Connect Strava Personal Route &amp; PR Log</span>
                </span>
                {showStravaDrawer ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {showStravaDrawer && (
                <div className="rounded-xl liquid-glass-subtle p-3.5 space-y-3">
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    Imports your personal Strava activities, GPS polylines, and PRs in read-only mode. Under THRESH&apos;s Clean-Room Firewall, Strava data is displayed strictly to you and is never sent to AI models or shared across teammates.
                  </p>

                  <button
                    type="button"
                    onClick={() => handleStravaLaunchClick('cloud')}
                    disabled={busy}
                    className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-[#FC4C02] hover:bg-[#E34402] disabled:opacity-60 text-white font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    {isRedirecting ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Activity className="w-4 h-4" />
                    )}
                    <span>{isRedirecting ? 'Redirecting to Strava...' : 'Connect with Strava OAuth'}</span>
                    <ExternalLink className="w-3.5 h-3.5 opacity-80" />
                  </button>

                  <div>
                    <button
                      type="button"
                      onClick={() => setShowRedirectHelp((prev) => !prev)}
                      className="w-full flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors cursor-pointer py-1"
                    >
                      <span>Callback domain &amp; localhost token exchange</span>
                      {showRedirectHelp ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {showRedirectHelp && (
                      <div className="mt-2 rounded-lg bg-white/80 dark:bg-[#0E1015] border border-stone-200 dark:border-slate-800 p-3 space-y-2.5 text-xs">
                        <div className="flex items-center justify-between gap-2 rounded-lg bg-stone-100 dark:bg-[#14181F] px-2.5 py-1.5 font-mono text-[11px]">
                          <span className="truncate text-slate-900 dark:text-slate-100 font-semibold">
                            {currentHostname}
                          </span>
                          <button
                            type="button"
                            onClick={handleCopyDomain}
                            className="shrink-0 inline-flex items-center gap-1 text-[10px] text-[#1D4ED8] dark:text-[#60A5FA] hover:underline cursor-pointer"
                          >
                            {copiedDomain ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-500" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        </div>

                        {onExchangeStravaCode && (
                          <form
                            onSubmit={handleManualExchangeSubmit}
                            className="pt-2 border-t border-stone-200 dark:border-slate-800 space-y-2"
                          >
                            <button
                              type="button"
                              onClick={() => handleStravaLaunchClick('localhost')}
                              disabled={busy}
                              className="w-full min-h-[36px] rounded-lg border border-[#FC4C02]/40 bg-[#FC4C02]/10 hover:bg-[#FC4C02]/20 text-[#D9480F] dark:text-[#FB6514] font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                            >
                              <span>1. Open Strava Auth Popup (localhost)</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={manualCodeInput}
                                onChange={(e) => setManualCodeInput(e.target.value)}
                                placeholder="2. Paste http://localhost/exchange_token?code=... URL"
                                className="flex-1 min-h-[38px] rounded-lg bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 px-2.5 py-1.5 text-[11px] font-mono text-slate-900 dark:text-slate-100"
                              />
                              <button
                                type="submit"
                                disabled={busy || !manualCodeInput.trim()}
                                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-50 text-white font-semibold text-xs transition-colors cursor-pointer shrink-0"
                              >
                                Exchange
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {hasSavedDeviceData && onDisconnectCredentials && (
              <div className="pt-2 border-t border-stone-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={onDisconnectCredentials}
                  className="w-full min-h-[40px] py-2 px-4 rounded-xl liquid-glass-subtle hover:bg-rose-500/15 border border-stone-300 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-300 font-medium text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Clear Cached Device Data</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Bottom Status Bar */}
      <footer className="border-t border-stone-200 dark:border-slate-800/80 bg-[#F7F6F2] dark:bg-[#121419] px-4 sm:px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] flex flex-wrap items-center justify-between gap-4 text-[11px] font-mono text-slate-600 dark:text-slate-400">
        <div className="flex items-center gap-3">
          <span>THRESH TELEMETRY ENGINE</span>
          <span>•</span>
          <span>MULTI-TEAM · RESEND EMAIL · SAFE-SPORT DEFAULT</span>
        </div>
        <div>
          <span>Garmin Connect · Intervals.icu · Native .FIT · Optional Strava</span>
        </div>
      </footer>
    </div>
  );
};
