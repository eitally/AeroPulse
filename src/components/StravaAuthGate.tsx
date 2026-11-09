import React, { useState } from 'react';
import {
  Activity,
  ShieldCheck,
  Users,
  Calendar,
  ExternalLink,
  Copy,
  Check,
  KeyRound,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Lock,
  Sparkles,
  Trophy,
  Flame,
  LogOut,
  UserCheck,
} from "./icons/PhosphorIcons";
import { ConnectionStatus } from '../types';
import { AeroPulseLogo } from './AeroPulseLogo';

interface StravaAuthGateProps {
  status: ConnectionStatus;
  athleteName?: string;
  onLaunchStravaOAuth: (mode?: 'cloud' | 'localhost') => Promise<void>;
  onExchangeStravaCode: (codeOrUrl: string) => Promise<void>;
  onSaveStravaCredentials: (clientId: string, clientSecret: string) => Promise<void>;
  onConnectIntervals?: (athleteId: string, apiKey: string) => Promise<void>;
  onCreateAthleteProfile?: (profileInput: {
    name: string;
    ftp: number;
    thresholdPaceSecsPerKm: number;
    weightKg: number;
    seedSampleTelemetry: boolean;
  }) => Promise<void>;
  onEnterSandbox: () => void;
  onDisconnectCredentials?: () => Promise<void>;
  isSyncing: boolean;
  errorMessage: string | null;
}

const DEV_CALLBACK_URL =
  'https://ais-dev-6ghnkmxunr54ug7sumz3hy-377968603671.us-west1.run.app/auth/strava/callback';
const SHARED_CALLBACK_URL =
  'https://ais-pre-6ghnkmxunr54ug7sumz3hy-377968603671.us-west1.run.app/auth/strava/callback';

export const StravaAuthGate: React.FC<StravaAuthGateProps> = ({
  status,
  athleteName,
  onLaunchStravaOAuth,
  onExchangeStravaCode,
  onSaveStravaCredentials,
  onConnectIntervals,
  onCreateAthleteProfile,
  onEnterSandbox,
  onDisconnectCredentials,
  isSyncing,
  errorMessage,
}) => {
  const [authMethodTab, setAuthMethodTab] = useState<'STRAVA' | 'INTERVALS' | 'NEW_PROFILE'>(
    'STRAVA'
  );
  const [showDeveloperConfig, setShowDeveloperConfig] = useState(false);
  const [clientIdInput, setClientIdInput] = useState(status.stravaClientId || '');
  const [clientSecretInput, setClientSecretInput] = useState('');
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [localSetupHint, setLocalSetupHint] = useState<string | null>(null);

  // Intervals.icu direct sign-up state
  const [intervalsAthleteId, setIntervalsAthleteId] = useState(
    status.intervalsAthleteId && status.intervalsAthleteId !== '0'
      ? status.intervalsAthleteId
      : '0'
  );
  const [intervalsApiKey, setIntervalsApiKey] = useState('');

  // New Athlete Profile sign-up state
  const [newAthleteName, setNewAthleteName] = useState('');
  const [newAthleteFtp, setNewAthleteFtp] = useState('280');
  const [newAthletePaceMinKm, setNewAthletePaceMinKm] = useState('4:15');
  const [newAthleteWeightKg, setNewAthleteWeightKg] = useState('68.5');
  const [seedSampleTelemetry, setSeedSampleTelemetry] = useState(true);

  const hasSavedSession = Boolean(status.stravaConnected || status.intervalsConnected);
  const resolvedAthleteName =
    athleteName ||
    status.stravaAthleteName ||
    status.intervalsAthleteName ||
    'Athlete';

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUrl(label);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const handleStravaLaunchClick = async (mode: 'cloud' | 'localhost' = 'cloud') => {
    setLocalSetupHint(null);
    if (!status.stravaClientId && !clientIdInput.trim()) {
      setShowDeveloperConfig(true);
      setLocalSetupHint(
        'To launch Strava OAuth on this instance, enter your Strava App Client ID & Secret below (from strava.com/settings/api), or switch to the "Intervals.icu" or "New Profile" tab above.'
      );
      return;
    }
    await onLaunchStravaOAuth(mode);
  };

  const handleSaveCredsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientIdInput.trim() || !clientSecretInput.trim()) return;
    setLocalSetupHint(null);
    await onSaveStravaCredentials(clientIdInput.trim(), clientSecretInput.trim());
    setClientSecretInput('');
  };

  const handleManualExchangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCodeInput.trim()) return;
    await onExchangeStravaCode(manualCodeInput.trim());
    setManualCodeInput('');
  };

  const handleIntervalsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intervalsApiKey.trim() || !onConnectIntervals) return;
    await onConnectIntervals(intervalsAthleteId.trim() || '0', intervalsApiKey.trim());
  };

  const parsePaceToSecsPerKm = (raw: string): number => {
    const trimmed = raw.trim();
    if (trimmed.includes(':')) {
      const [m, s] = trimmed.split(':').map((v) => Number(v) || 0);
      return Math.max(150, Math.min(600, m * 60 + s));
    }
    const num = Number(trimmed);
    if (!Number.isNaN(num) && num > 120) return Math.round(num);
    return 255;
  };

  const handleCreateProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onCreateAthleteProfile) {
      onEnterSandbox();
      return;
    }
    const cleanName = newAthleteName.trim() || 'THRESH Athlete';
    const ftp = Math.max(100, Math.min(600, Number(newAthleteFtp) || 280));
    const weightKg = Math.max(35, Math.min(160, Number(newAthleteWeightKg) || 68.5));
    const thresholdPaceSecsPerKm = parsePaceToSecsPerKm(newAthletePaceMinKm);
    await onCreateAthleteProfile({
      name: cleanName,
      ftp,
      thresholdPaceSecsPerKm,
      weightKg,
      seedSampleTelemetry,
    });
  };

  return (
    <div className="min-h-screen bg-white dark:bg-[#0B0C0F] text-slate-900 dark:text-slate-100 flex flex-col justify-between selection:bg-[#EA580C]/30 selection:text-white">
      {/* Top Header */}
      <header className="relative border-b border-slate-200 dark:border-slate-800/80 bg-white/95 dark:bg-[#0D1015]/90 backdrop-blur-md px-6 py-3.5 flex items-center justify-between overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[2px] ap-brand-hairline pointer-events-none" />
        <AeroPulseLogo
          size="md"
          showTagline
        />

        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-mono text-slate-600 dark:text-slate-400 liquid-glass-subtle px-2.5 py-1 rounded-lg">
            <Lock className="w-3 h-3 text-[#10B981]" />
            OAuth 2.0 PKCE / Local Vault
          </span>
          <button
            onClick={onEnterSandbox}
            className="text-xs font-mono text-[#0B4F9E] dark:text-[#38BDF8] hover:text-slate-900 dark:hover:text-white bg-[#0B4F9E]/10 dark:bg-[#38BDF8]/10 hover:bg-[#0B4F9E]/20 border border-[#0B4F9E]/25 dark:border-[#38BDF8]/30 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 font-semibold"
          >
            <span>{hasSavedSession ? `Resume as ${resolvedAthleteName}` : 'Try Demo Sandbox'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Main Split-Screen Sign-Up & Sign-In Gate */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-8 lg:py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left 7 Columns: Value Proposition & Multi-Athlete Capabilities */}
        <div className="lg:col-span-7 space-y-6">
          <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-slate-900 dark:text-white leading-[1.12]">
            Run &amp; Ride Threshold Intelligence, Official PRs &amp; AI Coaching.
          </h1>

          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
            Sign up in seconds with <span className="text-slate-900 dark:text-white font-medium">Strava OAuth</span>, connect your <span className="text-slate-900 dark:text-white font-medium">Intervals.icu &amp; Garmin</span> API key, or create a <span className="text-slate-900 dark:text-white font-medium">Personal Athlete Profile</span> for local <span className="font-mono text-sky-600 dark:text-[#38BDF8]">.FIT / .GPX / .TCX</span> analysis—then track <span className="font-mono text-sky-600 dark:text-[#38BDF8]">CTL / ATL / TSB</span> fitness load and prescribe structured workouts across your coaching roster.
          </p>

          {/* 4 Pillar Feature Matrix */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
            <div className="liquid-glass-subtle border border-stone-200/80 dark:border-slate-800/80 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-[#FC4C02] font-semibold">
                  01 / STRAVA &amp; INTERVALS.ICU SYNC
                </span>
                <Activity className="w-4 h-4 text-[#FC4C02]" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Instant Stream &amp; Lap Ingestion
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Imports 200+ activities, second-by-second power/HR/velocity streams, Critical Power curves, and automatic Matched Runs &amp; Rides progressions.
              </p>
            </div>

            <div className="liquid-glass-subtle border border-stone-200/80 dark:border-slate-800/80 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-sky-600 dark:text-[#38BDF8] font-semibold">
                  02 / FRIENDS &amp; COACH ROSTER
                </span>
                <Users className="w-4 h-4 text-sky-600 dark:text-[#38BDF8]" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Follow Athletes &amp; Prescribe Workouts
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Connect via shareable invite codes (<span className="font-mono text-slate-800 dark:text-slate-300">TH-8492-DEMO</span>). Friends get read-only telemetry; Coaches can schedule structured workouts onto your calendar.
              </p>
            </div>

            <div className="liquid-glass-subtle border border-stone-200/80 dark:border-slate-800/80 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-emerald-600 dark:text-[#10B981] font-semibold">
                  03 / PRIVACY &amp; API COMPLIANCE
                </span>
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-[#10B981]" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Granular Biometric Privacy Shield
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Independently control whether Friends or Coaches can see Morning HRV &amp; Sleep wellness, PMC load curves, or outdoor GPS maps.
              </p>
            </div>

            <div className="liquid-glass-subtle border border-stone-200/80 dark:border-slate-800/80 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-purple-600 dark:text-[#A855F7] font-semibold">
                  04 / TRAINING PLAN &amp; RACE PRs
                </span>
                <Trophy className="w-4 h-4 text-purple-600 dark:text-[#A855F7]" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Official Race PRs &amp; Periodized Plans
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Generate multi-week periodized training blocks with automatic recovery weeks and log official track, cross-country, and road race results.
              </p>
            </div>
          </div>

          {/* Live Roster Preview Strip */}
          <div className="liquid-glass-subtle border border-stone-200/80 dark:border-slate-800/80 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex -space-x-2">
                <div className="w-7 h-7 rounded-full bg-orange-500/20 border border-orange-500/50 flex items-center justify-center text-[10px] font-mono font-bold text-orange-700 dark:text-orange-300">
                  ML
                </div>
                <div className="w-7 h-7 rounded-full bg-sky-500/20 border border-sky-500/50 flex items-center justify-center text-[10px] font-mono font-bold text-sky-700 dark:text-sky-300">
                  LV
                </div>
                <div className="w-7 h-7 rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center text-[10px] font-mono font-bold text-emerald-700 dark:text-emerald-300">
                  ER
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-white">
                  Pre-Loaded Multi-Athlete Coaching Roster Included
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Switch between your profile, Maya Lin (Sub-20 5K), Lucas Vance (350W FTP), and Elena Rostova (2:52 Marathon)
                </div>
              </div>
            </div>
            <span className="text-[11px] font-mono text-emerald-700 dark:text-[#10B981] bg-[#10B981]/10 border border-[#10B981]/30 px-2 py-0.5 rounded">
              4 Athletes Ready
            </span>
          </div>
        </div>

        {/* Right 5 Columns: Multi-Path Sign-Up / Sign-In Card */}
        <div className="lg:col-span-5">
          <div className="liquid-glass border border-stone-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-stone-200/80 dark:border-slate-800 pb-4">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-[#FC4C02] block">
                  ATHLETE &amp; COACH ONBOARDING
                </span>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                  {hasSavedSession
                    ? 'Session Locked — Welcome Back'
                    : 'Sign Up or Connect Your Telemetry'}
                </h2>
              </div>
              <div className="px-2 py-1 rounded liquid-glass-subtle border border-stone-200/80 dark:border-slate-800 text-[11px] font-mono text-slate-600 dark:text-slate-400">
                {status.stravaConnected ? (
                  <span className="text-emerald-600 dark:text-[#10B981]">● Strava Connected</span>
                ) : status.intervalsConnected ? (
                  <span className="text-emerald-600 dark:text-[#10B981]">● Intervals.icu Connected</span>
                ) : status.stravaClientId ? (
                  <span className="text-sky-600 dark:text-[#38BDF8]">● OAuth Ready</span>
                ) : (
                  <span className="text-amber-600 dark:text-[#F59E0B]">● Ready to Sign Up</span>
                )}
              </div>
            </div>

            {/* 3-Path Onboarding Selector Tabs */}
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-stone-200/70 dark:bg-[#11151C] border border-stone-300/70 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setAuthMethodTab('STRAVA');
                  setLocalSetupHint(null);
                }}
                className={`py-2 px-2 rounded-lg text-[11px] font-mono font-semibold transition-all cursor-pointer ${
                  authMethodTab === 'STRAVA'
                    ? 'bg-[#FC4C02] text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                1. Strava OAuth
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMethodTab('INTERVALS');
                  setLocalSetupHint(null);
                }}
                className={`py-2 px-2 rounded-lg text-[11px] font-mono font-semibold transition-all cursor-pointer ${
                  authMethodTab === 'INTERVALS'
                    ? 'bg-sky-600 dark:bg-[#0284C7] text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                2. Intervals.icu
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMethodTab('NEW_PROFILE');
                  setLocalSetupHint(null);
                }}
                className={`py-2 px-2 rounded-lg text-[11px] font-mono font-semibold transition-all cursor-pointer ${
                  authMethodTab === 'NEW_PROFILE'
                    ? 'bg-emerald-600 dark:bg-[#059669] text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                3. New Athlete
              </button>
            </div>

            {errorMessage && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-700 dark:text-red-300 font-mono">
                {errorMessage}
              </div>
            )}

            {localSetupHint && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300 font-mono leading-relaxed">
                {localSetupHint}
              </div>
            )}

            {hasSavedSession && (
              <button
                type="button"
                onClick={onEnterSandbox}
                className="w-full py-3 px-4 rounded-lg bg-[#10B981] hover:bg-[#059669] text-white font-semibold text-sm flex items-center justify-center gap-2.5 shadow-lg shadow-[#10B981]/20 transition-all cursor-pointer"
              >
                <UserCheck className="w-4 h-4" weight="bold" />
                <span>Continue as {resolvedAthleteName}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {/* TAB 1: STRAVA OAUTH */}
            {authMethodTab === 'STRAVA' && (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => handleStravaLaunchClick('cloud')}
                  disabled={isSyncing}
                  className="w-full py-3 px-4 rounded-lg bg-[#FC4C02] hover:bg-[#E34402] disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2.5 shadow-lg shadow-[#FC4C02]/20 transition-all cursor-pointer"
                >
                  <Activity className="w-4 h-4" />
                  <span>
                    {isSyncing
                      ? 'Connecting to Strava OAuth...'
                      : hasSavedSession
                        ? 'Sign In with Another Strava Account'
                        : 'Continue with Strava (OAuth 2.0 Popup)'}
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 opacity-80" />
                </button>

                {/* Scopes & Security Summary */}
                <div className="liquid-glass-subtle border border-stone-200/80 dark:border-slate-800 rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-600 dark:text-slate-400">
                    <span>REQUESTED STRAVA SCOPES</span>
                    <span className="text-emerald-600 dark:text-[#10B981]">READ-ONLY TELEMETRY</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/80 dark:bg-[#14181F] border border-stone-200/90 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                      read
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/80 dark:bg-[#14181F] border border-stone-200/90 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                      activity:read_all
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/80 dark:bg-[#14181F] border border-stone-200/90 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                      profile:read_all
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Just like Intervals.icu, AeroPulse stores OAuth tokens in the server vault and enforces Strava API multi-athlete privacy rules.
                  </p>
                </div>

                {/* Expandable Developer OAuth Configuration & Manual Code Exchange */}
                <div className="border-t border-stone-200/80 dark:border-slate-800 pt-2.5">
                  <button
                    type="button"
                    onClick={() => setShowDeveloperConfig(!showDeveloperConfig)}
                    className="w-full flex items-center justify-between text-xs font-mono text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white py-1 transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-[#F97316]" />
                      <span>Strava API App Credentials &amp; Localhost Exchange</span>
                    </span>
                    {showDeveloperConfig ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>

                  {showDeveloperConfig && (
                    <div className="mt-3 space-y-4 liquid-glass-subtle border border-stone-200/80 dark:border-slate-800 rounded-xl p-3.5">
                      {/* Save Client ID & Secret */}
                      <form onSubmit={handleSaveCredsSubmit} className="space-y-2">
                        <div className="text-[10px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400">
                          1. Configure Strava Client ID &amp; Secret (strava.com/settings/api)
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={clientIdInput}
                            onChange={(e) => setClientIdInput(e.target.value)}
                            placeholder="Strava Client ID (e.g. 129481)"
                            className="bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-[#FC4C02]"
                          />
                          <input
                            type="password"
                            value={clientSecretInput}
                            onChange={(e) => setClientSecretInput(e.target.value)}
                            placeholder="Strava Client Secret"
                            className="bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-[#FC4C02]"
                          />
                        </div>
                        <button
                          type="submit"
                          className="w-full py-1.5 rounded bg-stone-200/80 dark:bg-[#1E2530] hover:bg-stone-300/80 dark:hover:bg-[#262F3D] text-xs font-mono text-slate-900 dark:text-white transition-colors cursor-pointer"
                        >
                          Save Strava App Credentials
                        </button>
                      </form>

                      {/* 2-Step Localhost Redirect + Manual Code Exchange */}
                      <form
                        onSubmit={handleManualExchangeSubmit}
                        className="space-y-2 pt-2 border-t border-stone-200/80 dark:border-slate-800"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400">
                            2. Universal Localhost Redirect Flow
                          </span>
                          <button
                            type="button"
                            onClick={() => handleStravaLaunchClick('localhost')}
                            className="text-[10px] font-mono text-[#FC4C02] hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <span>Open Localhost Auth Popup</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={manualCodeInput}
                            onChange={(e) => setManualCodeInput(e.target.value)}
                            placeholder="Paste http://localhost/exchange_token?code=... URL"
                            className="flex-1 bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-[#38BDF8]"
                          />
                          <button
                            type="submit"
                            className="px-3 py-1.5 rounded bg-[#38BDF8]/20 hover:bg-[#38BDF8]/30 border border-[#38BDF8]/40 text-xs font-mono text-sky-700 dark:text-[#38BDF8] cursor-pointer"
                          >
                            Exchange
                          </button>
                        </div>
                      </form>

                      {/* Callback URLs */}
                      <div className="space-y-1.5 pt-2 border-t border-stone-200/80 dark:border-slate-800">
                        <div className="text-[10px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400">
                          Authorized Cloud Callback URLs
                        </div>
                        <div className="flex items-center justify-between gap-2 bg-white dark:bg-[#14181F] border border-stone-200/90 dark:border-slate-800 rounded px-2.5 py-1.5">
                          <div className="truncate text-[10px] font-mono text-slate-700 dark:text-slate-300">
                            <span className="text-sky-600 dark:text-[#38BDF8] mr-1.5">[DEV]</span>
                            {DEV_CALLBACK_URL}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCopy(DEV_CALLBACK_URL, 'DEV')}
                            className="shrink-0 text-[10px] font-mono text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 cursor-pointer"
                          >
                            {copiedUrl === 'DEV' ? (
                              <Check className="w-3 h-3 text-[#10B981]" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                        <div className="flex items-center justify-between gap-2 bg-white dark:bg-[#14181F] border border-stone-200/90 dark:border-slate-800 rounded px-2.5 py-1.5">
                          <div className="truncate text-[10px] font-mono text-slate-700 dark:text-slate-300">
                            <span className="text-emerald-600 dark:text-[#10B981] mr-1.5">[SHARED]</span>
                            {SHARED_CALLBACK_URL}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCopy(SHARED_CALLBACK_URL, 'SHARED')}
                            className="shrink-0 text-[10px] font-mono text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 cursor-pointer"
                          >
                            {copiedUrl === 'SHARED' ? (
                              <Check className="w-3 h-3 text-[#10B981]" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: INTERVALS.ICU + GARMIN DIRECT SIGN-UP */}
            {authMethodTab === 'INTERVALS' && (
              <form onSubmit={handleIntervalsSubmit} className="space-y-3.5">
                <div className="liquid-glass-subtle border border-stone-200/80 dark:border-slate-800 rounded-xl p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-sky-600 dark:text-[#38BDF8] font-semibold">
                      INTERVALS.ICU + GARMIN WELLNESS
                    </span>
                    <a
                      href="https://intervals.icu/settings"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] font-mono text-sky-600 dark:text-[#38BDF8] hover:underline flex items-center gap-1"
                    >
                      <span>Get API Key</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    Any athlete with an <span className="font-medium text-slate-900 dark:text-white">Intervals.icu</span> account can sign in immediately using their Personal API Key (found under Developer Settings on <code className="text-[11px]">intervals.icu/settings</code>).
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                    <div>
                      <label className="block text-[10px] font-mono uppercase text-slate-500 dark:text-slate-400 mb-1">
                        Athlete ID
                      </label>
                      <input
                        type="text"
                        value={intervalsAthleteId}
                        onChange={(e) => setIntervalsAthleteId(e.target.value)}
                        placeholder="0 or i12345"
                        className="w-full bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 rounded px-2.5 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-[#38BDF8]"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[10px] font-mono uppercase text-slate-500 dark:text-slate-400 mb-1">
                        Personal API Key
                      </label>
                      <input
                        type="password"
                        value={intervalsApiKey}
                        onChange={(e) => setIntervalsApiKey(e.target.value)}
                        placeholder="Paste Intervals.icu API Key"
                        required
                        className="w-full bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 rounded px-2.5 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-[#38BDF8]"
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSyncing || !intervalsApiKey.trim()}
                  className="w-full py-3 px-4 rounded-lg bg-sky-600 hover:bg-sky-700 dark:bg-[#0284C7] dark:hover:bg-[#0369A1] disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-sky-500/20 transition-all cursor-pointer"
                >
                  <Calendar className="w-4 h-4" />
                  <span>
                    {isSyncing
                      ? 'Syncing Intervals.icu & Garmin History...'
                      : 'Connect Intervals.icu & Enter Telemetry Lab'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            )}

            {/* TAB 3: NEW ATHLETE PROFILE (LOCAL SIGN-UP / .FIT UPLOAD) */}
            {authMethodTab === 'NEW_PROFILE' && (
              <form onSubmit={handleCreateProfileSubmit} className="space-y-3.5">
                <div className="liquid-glass-subtle border border-stone-200/80 dark:border-slate-800 rounded-xl p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-600 dark:text-[#10B981] font-semibold">
                      CREATE PERSONAL ATHLETE PROFILE
                    </span>
                    <Flame className="w-4 h-4 text-emerald-600 dark:text-[#10B981]" />
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    No API key required. Configure your physiological thresholds to automatically compute your 7-Zone Coggan Power &amp; Pace zones and start uploading <code className="text-[11px]">.FIT / .GPX / .TCX</code> files or Official Race PRs.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="sm:col-span-2">
                      <label className="block text-[10px] font-mono uppercase text-slate-500 dark:text-slate-400 mb-1">
                        Athlete Name
                      </label>
                      <input
                        type="text"
                        value={newAthleteName}
                        onChange={(e) => setNewAthleteName(e.target.value)}
                        placeholder="e.g. Jordan Avery"
                        required
                        className="w-full bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-[#10B981]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono uppercase text-slate-500 dark:text-slate-400 mb-1">
                        Cycling FTP (Watts)
                      </label>
                      <input
                        type="number"
                        min={80}
                        max={600}
                        value={newAthleteFtp}
                        onChange={(e) => setNewAthleteFtp(e.target.value)}
                        className="w-full bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#10B981]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono uppercase text-slate-500 dark:text-slate-400 mb-1">
                        Run Threshold (/km)
                      </label>
                      <input
                        type="text"
                        value={newAthletePaceMinKm}
                        onChange={(e) => setNewAthletePaceMinKm(e.target.value)}
                        placeholder="4:15"
                        className="w-full bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#10B981]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono uppercase text-slate-500 dark:text-slate-400 mb-1">
                        Weight (kg)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min={35}
                        max={160}
                        value={newAthleteWeightKg}
                        onChange={(e) => setNewAthleteWeightKg(e.target.value)}
                        className="w-full bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#10B981]"
                      />
                    </div>
                    <div className="flex items-end pb-1">
                      <label className="flex items-center gap-2 text-[11px] text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={seedSampleTelemetry}
                          onChange={(e) => setSeedSampleTelemetry(e.target.checked)}
                          className="rounded border-stone-300 dark:border-slate-700 accent-[#10B981]"
                        />
                        <span>Pre-load 90d sample charts</span>
                      </label>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-3 px-4 rounded-lg bg-[#10B981] hover:bg-[#059669] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#10B981]/20 transition-all cursor-pointer"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>Create Athlete Profile &amp; Enter Lab</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            )}

            {/* Instant Demo Sandbox & Disconnect Controls */}
            <div className="space-y-2 pt-2 border-t border-stone-200/80 dark:border-slate-800">
              {!hasSavedSession && (
                <button
                  type="button"
                  onClick={onEnterSandbox}
                  className="w-full py-2.5 px-4 rounded-lg liquid-glass-subtle hover:bg-stone-200/60 dark:hover:bg-[#1C222C] border border-stone-300 dark:border-slate-800 hover:border-[#38BDF8]/50 text-slate-900 dark:text-slate-100 font-medium text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-sky-600 dark:text-[#38BDF8]" />
                  <span>Try Demo Sandbox (Sample Telemetry Only)</span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                </button>
              )}

              {hasSavedSession && onDisconnectCredentials && (
                <button
                  type="button"
                  onClick={onDisconnectCredentials}
                  className="w-full py-2 px-4 rounded-lg liquid-glass-subtle hover:bg-rose-500/15 border border-stone-300 dark:border-slate-800 hover:border-rose-500/40 text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-300 font-medium text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Disconnect Saved Credentials &amp; Clear Device Data</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Bottom Status Bar */}
      <footer className="border-t border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1015] px-6 py-3 flex flex-wrap items-center justify-between gap-4 text-[11px] font-mono text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-4">
          <span>THRESH TELEMETRY ENGINE v4.2</span>
          <span>•</span>
          <span>STRAVA API COMPLIANT PRIVACY SHIELD</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-slate-600 dark:text-slate-400">
            Callback Route: <code className="text-sky-600 dark:text-[#38BDF8]">/auth/strava/callback</code>
          </span>
        </div>
      </footer>
    </div>
  );
};
