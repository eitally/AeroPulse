import React, { useState } from 'react';
import {
  Activity,
  ShieldCheck,
  Database,
  ExternalLink,
  Copy,
  Check,
  KeyRound,
  ChevronDown,
  ChevronUp,
  Lock,
  Trophy,
  LogOut,
  RefreshCw,
} from './icons/PhosphorIcons';
import { ConnectionStatus } from '../types';
import { AeroPulseLogo } from './AeroPulseLogo';

interface StravaAuthGateProps {
  status: ConnectionStatus;
  onLaunchStravaOAuth: (mode?: 'cloud' | 'localhost') => Promise<void>;
  onExchangeStravaCode: (codeOrUrl: string) => Promise<void>;
  onSaveStravaCredentials: (clientId: string, clientSecret: string) => Promise<void>;
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
  onLaunchStravaOAuth,
  onExchangeStravaCode,
  onSaveStravaCredentials,
  onDisconnectCredentials,
  isSyncing,
  errorMessage,
}) => {
  const [showDeveloperConfig, setShowDeveloperConfig] = useState(false);
  const [clientIdInput, setClientIdInput] = useState(status.stravaClientId || '');
  const [clientSecretInput, setClientSecretInput] = useState('');
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [localSetupHint, setLocalSetupHint] = useState<string | null>(null);

  const hasSavedDeviceData = Boolean(status.stravaConnected || status.intervalsConnected);

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
        'To launch Strava OAuth on this instance, enter your Strava App Client ID & Secret below (from strava.com/settings/api).'
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

  return (
    <div className="min-h-screen bg-white dark:bg-[#0B0C0F] text-slate-900 dark:text-slate-100 flex flex-col justify-between selection:bg-[#EA580C]/30 selection:text-white">
      {/* Top Header */}
      <header className="relative border-b border-slate-200 dark:border-slate-800/80 bg-white/95 dark:bg-[#0D1015]/90 backdrop-blur-md px-6 py-3.5 flex items-center justify-between overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[2px] ap-brand-hairline pointer-events-none" />
        <AeroPulseLogo size="md" showTagline />

        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-slate-600 dark:text-slate-400 liquid-glass-subtle px-2.5 py-1 rounded-lg">
            <Lock className="w-3 h-3 text-[#10B981]" />
            Strava OAuth 2.0 Required
          </span>
        </div>
      </header>

      {/* Main Split-Screen Sign-In & Sign-Up Gate */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-8 lg:py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left 7 Columns: Value Proposition & Dual-Duty Strava Architecture */}
        <div className="lg:col-span-7 space-y-6">
          <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-slate-900 dark:text-white leading-[1.12]">
            Run &amp; Ride Threshold Intelligence, Official PRs &amp; AI Coaching.
          </h1>

          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
            Authenticate with <span className="text-slate-900 dark:text-white font-semibold">Strava OAuth 2.0</span> to unlock your private athlete workspace and sync your complete Strava workout history in the background. Once signed in, you can optionally connect <span className="text-slate-900 dark:text-white font-medium">Garmin Connect</span>, <span className="text-slate-900 dark:text-white font-medium">Intervals.icu</span>, and other services from the <span className="font-mono text-sky-600 dark:text-[#38BDF8]">Data Sources</span> screen.
          </p>

          {/* 4 Pillar Feature Matrix */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
            <div className="liquid-glass-subtle border border-stone-200/80 dark:border-slate-800/80 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-[#FC4C02] font-semibold">
                  01 / STRAVA OAUTH + FULL ARCHIVE SYNC
                </span>
                <Activity className="w-4 h-4 text-[#FC4C02]" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Dual-Duty Identity &amp; Background Sync
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Strava verifies your identity and automatically syncs your entire historical workout archive, GPS routes, segments, and PRs in the background.
              </p>
            </div>

            <div className="liquid-glass-subtle border border-stone-200/80 dark:border-slate-800/80 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-sky-600 dark:text-[#38BDF8] font-semibold">
                  02 / MULTI-SERVICE DATA SOURCES
                </span>
                <Database className="w-4 h-4 text-sky-600 dark:text-[#38BDF8]" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Layer Garmin &amp; Intervals.icu Anytime
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                After signing in with Strava, open <span className="font-mono text-slate-800 dark:text-slate-200">Data Sources</span> to connect Garmin Connect or Intervals.icu for Morning HRV, RHR, and Sleep telemetry.
              </p>
            </div>

            <div className="liquid-glass-subtle border border-stone-200/80 dark:border-slate-800/80 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-emerald-600 dark:text-[#10B981] font-semibold">
                  03 / STRICT TENANT ISOLATION
                </span>
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-[#10B981]" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Zero Unauthenticated Data Exposure
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Every athlete session is strictly isolated to your authenticated Strava OAuth credentials—unregistered visitors can never view another user&apos;s data.
              </p>
            </div>

            <div className="liquid-glass-subtle border border-stone-200/80 dark:border-slate-800/80 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-purple-600 dark:text-[#A855F7] font-semibold">
                  04 / PMC LOAD, CALENDAR &amp; AI COACH
                </span>
                <Trophy className="w-4 h-4 text-purple-600 dark:text-[#A855F7]" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Fitness, Freshness &amp; Periodized Plans
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Track <span className="font-mono text-slate-800 dark:text-slate-200">CTL / ATL / TSB</span> training load, build multi-week periodized training blocks, and log official race PRs.
              </p>
            </div>
          </div>

          {/* Security & Background Sync Assurance Strip */}
          <div className="liquid-glass-subtle border border-stone-200/80 dark:border-slate-800/80 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#FC4C02]/15 border border-[#FC4C02]/40 flex items-center justify-center text-[#FC4C02] shrink-0">
                <Lock className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-white">
                  Mandatory Strava OAuth 2.0 Security &amp; Telemetry Gate
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Sign in with your Strava account to unlock your personal dashboard and start background history synchronization.
                </div>
              </div>
            </div>
            <span className="text-[11px] font-mono text-emerald-700 dark:text-[#10B981] bg-[#10B981]/10 border border-[#10B981]/30 px-2.5 py-0.5 rounded">
              Isolated Per-Athlete Vault
            </span>
          </div>
        </div>

        {/* Right 5 Columns: Mandatory Strava OAuth Sign-In / Sign-Up Card */}
        <div className="lg:col-span-5">
          <div className="liquid-glass border border-stone-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-stone-200/80 dark:border-slate-800 pb-4">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-[#FC4C02] block font-semibold">
                  STRAVA OAUTH 2.0 AUTHENTICATION
                </span>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                  Sign In or Sign Up with Strava
                </h2>
              </div>
              <div className="px-2.5 py-1 rounded liquid-glass-subtle border border-stone-200/80 dark:border-slate-800 text-[11px] font-mono text-slate-600 dark:text-slate-400">
                {status.stravaClientId ? (
                  <span className="text-emerald-600 dark:text-[#10B981]">● OAuth Ready</span>
                ) : (
                  <span className="text-amber-600 dark:text-[#F59E0B]">● Setup Required</span>
                )}
              </div>
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

            {/* Primary Strava OAuth Action */}
            <div className="space-y-3.5">
              <button
                type="button"
                onClick={() => handleStravaLaunchClick('cloud')}
                disabled={isSyncing}
                className="w-full py-3.5 px-4 rounded-xl bg-[#FC4C02] hover:bg-[#E34402] disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2.5 shadow-lg shadow-[#FC4C02]/25 transition-all cursor-pointer"
              >
                {isSyncing ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Activity className="w-4 h-4" />
                )}
                <span>
                  {isSyncing
                    ? 'Authenticating & Syncing Strava History...'
                    : 'Sign In with Strava (OAuth 2.0)'}
                </span>
                <ExternalLink className="w-3.5 h-3.5 opacity-80" />
              </button>

              {/* How Dual-Duty Strava Auth Works */}
              <div className="liquid-glass-subtle border border-stone-200/80 dark:border-slate-800 rounded-xl p-4 space-y-2.5">
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-600 dark:text-slate-400">
                  <span>DUAL-DUTY AUTH &amp; TELEMETRY</span>
                  <span className="text-emerald-600 dark:text-[#10B981]">READ-ONLY SCOPES</span>
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
                <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1.5 pt-1 leading-relaxed">
                  <li className="flex items-start gap-2">
                    <span className="text-[#FC4C02] font-mono font-bold">1.</span>
                    <span>
                      <strong className="text-slate-900 dark:text-white">Identity &amp; Security:</strong> Verifies your Strava account so only you can access your training history.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#FC4C02] font-mono font-bold">2.</span>
                    <span>
                      <strong className="text-slate-900 dark:text-white">Background Full-History Sync:</strong> Automatically imports all of your Strava rides, runs, streams, and PRs in the background.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-sky-600 dark:text-[#38BDF8] font-mono font-bold">3.</span>
                    <span>
                      <strong className="text-slate-900 dark:text-white">Additional Services:</strong> Connect <span className="font-mono text-[11px]">Garmin Connect</span> or <span className="font-mono text-[11px]">Intervals.icu</span> anytime via <strong className="text-slate-900 dark:text-white">Data Sources</strong> after signing in.
                    </span>
                  </li>
                </ul>
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

            {hasSavedDeviceData && onDisconnectCredentials && (
              <div className="pt-2 border-t border-stone-200/80 dark:border-slate-800">
                <button
                  type="button"
                  onClick={onDisconnectCredentials}
                  className="w-full py-2 px-4 rounded-lg liquid-glass-subtle hover:bg-rose-500/15 border border-stone-300 dark:border-slate-800 hover:border-rose-500/40 text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-300 font-medium text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Disconnect Saved Credentials &amp; Clear Device Data</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Bottom Status Bar */}
      <footer className="border-t border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1015] px-6 py-3 flex flex-wrap items-center justify-between gap-4 text-[11px] font-mono text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-4">
          <span>THRESH TELEMETRY ENGINE v4.2</span>
          <span>•</span>
          <span>STRAVA OAUTH 2.0 MANDATORY SECURITY GATE</span>
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
