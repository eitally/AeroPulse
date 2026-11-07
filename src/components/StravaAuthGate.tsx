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
} from 'lucide-react';
import { ConnectionStatus } from '../types';

interface StravaAuthGateProps {
  status: ConnectionStatus;
  onLaunchStravaOAuth: () => Promise<void>;
  onExchangeStravaCode: (codeOrUrl: string) => Promise<void>;
  onSaveStravaCredentials: (clientId: string, clientSecret: string) => Promise<void>;
  onEnterSandbox: () => void;
  isSyncing: boolean;
  errorMessage: string | null;
}

const DEV_CALLBACK_URL =
  'https://ais-dev-6ghnkmxunr54ug7sumz3hy-377968603671.us-west1.run.app/api/strava/callback';
const SHARED_CALLBACK_URL =
  'https://ais-pre-6ghnkmxunr54ug7sumz3hy-377968603671.us-west1.run.app/api/strava/callback';

export const StravaAuthGate: React.FC<StravaAuthGateProps> = ({
  status,
  onLaunchStravaOAuth,
  onExchangeStravaCode,
  onSaveStravaCredentials,
  onEnterSandbox,
  isSyncing,
  errorMessage,
}) => {
  const [showDeveloperConfig, setShowDeveloperConfig] = useState(false);
  const [clientIdInput, setClientIdInput] = useState('');
  const [clientSecretInput, setClientSecretInput] = useState('');
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUrl(label);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const handleSaveCredsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientIdInput.trim() || !clientSecretInput.trim()) return;
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
    <div className="min-h-screen bg-[#090B0E] text-[#F1F5F9] flex flex-col justify-between selection:bg-[#FC4C02]/30 selection:text-white">
      {/* Top Diagnostic Telemetry Header */}
      <header className="border-b border-[#1E2530] bg-[#0D1015]/90 backdrop-blur-md px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-gradient-to-br from-[#F97316] to-[#3B82F6] flex items-center justify-center shadow-lg shadow-orange-500/10">
            <Activity className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold tracking-tight text-sm text-[#F1F5F9]">AEROPULSE</span>
              <span className="text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded bg-[#14181F] text-[#F97316] border border-[#262F3D]">
                INTERVALS × RUNNA × STRAVA LAB
              </span>
            </div>
            <p className="text-[11px] text-[#64748B]">
              Multi-Athlete Physiological Telemetry, Adaptive Goal Architect &amp; Coaching Platform
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-mono text-[#94A3B8] bg-[#14181F] border border-[#1E2530] px-2.5 py-1 rounded">
            <Lock className="w-3 h-3 text-[#10B981]" />
            OAuth 2.0 PKCE / Server Token Vault
          </span>
          <button
            onClick={onEnterSandbox}
            className="text-xs font-mono text-[#38BDF8] hover:text-white bg-[#38BDF8]/10 hover:bg-[#38BDF8]/20 border border-[#38BDF8]/30 px-3 py-1.5 rounded transition-colors flex items-center gap-1.5"
          >
            <span>Enter Live Sandbox</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Main Split-Screen Sign-Up & Sign-In Gate */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-8 lg:py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left 7 Columns: Value Proposition & Multi-Athlete Capabilities */}
        <div className="lg:col-span-7 space-y-6">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-[#FC4C02]/10 border border-[#FC4C02]/30 text-[#FC4C02] text-xs font-mono uppercase tracking-wider">
            <Flame className="w-3.5 h-3.5" />
            <span>Direct Strava OAuth Athlete &amp; Coaching Network</span>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-white leading-[1.12]">
            One Telemetry Lab for Your Training, Official Track PRs &amp; Coaching Roster.
          </h1>

          <p className="text-sm sm:text-base text-[#94A3B8] max-w-2xl leading-relaxed">
            Sign in with Strava just like <span className="text-white font-medium">Intervals.icu</span> to automatically synchronize power, heart-rate, and pace streams—then follow training partners, compare live <span className="font-mono text-[#38BDF8]">CTL / ATL / TSB</span> fitness load, or let your coach push structured interval workouts directly onto your calendar.
          </p>

          {/* 4 Pillar Feature Matrix */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
            <div className="bg-[#0F131A] border border-[#1E2530] rounded-lg p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-[#FC4C02] font-semibold">
                  01 / STRAVA OAUTH SYNC
                </span>
                <Activity className="w-4 h-4 text-[#FC4C02]" />
              </div>
              <h3 className="text-sm font-semibold text-white">
                Instant Stream &amp; Lap Ingestion
              </h3>
              <p className="text-xs text-[#94A3B8] leading-relaxed">
                Imports 200+ activities, second-by-second power/HR/velocity streams, Critical Power curves, and automatic Matched Runs &amp; Rides progressions.
              </p>
            </div>

            <div className="bg-[#0F131A] border border-[#1E2530] rounded-lg p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-[#38BDF8] font-semibold">
                  02 / FRIENDS &amp; COACH ROSTER
                </span>
                <Users className="w-4 h-4 text-[#38BDF8]" />
              </div>
              <h3 className="text-sm font-semibold text-white">
                Follow Athletes &amp; Prescribe Workouts
              </h3>
              <p className="text-xs text-[#94A3B8] leading-relaxed">
                Connect via shareable invite codes (<span className="font-mono text-slate-300">AP-8492-TALLY</span>). Friends get read-only telemetry; Coaches can schedule structured workouts onto your calendar.
              </p>
            </div>

            <div className="bg-[#0F131A] border border-[#1E2530] rounded-lg p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-[#10B981] font-semibold">
                  03 / PRIVACY &amp; API COMPLIANCE
                </span>
                <ShieldCheck className="w-4 h-4 text-[#10B981]" />
              </div>
              <h3 className="text-sm font-semibold text-white">
                Granular Biometric Privacy Shield
              </h3>
              <p className="text-xs text-[#94A3B8] leading-relaxed">
                Independently control whether Friends or Coaches can see Morning HRV &amp; Sleep wellness, PMC load curves, or outdoor GPS maps.
              </p>
            </div>

            <div className="bg-[#0F131A] border border-[#1E2530] rounded-lg p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-[#A855F7] font-semibold">
                  04 / ADAPTIVE GOAL ARCHITECT
                </span>
                <Trophy className="w-4 h-4 text-[#A855F7]" />
              </div>
              <h3 className="text-sm font-semibold text-white">
                Watchless Track PRs &amp; Periodized Plans
              </h3>
              <p className="text-xs text-[#94A3B8] leading-relaxed">
                Generate multi-week Runna/TrainerRoad periodized blocks and import official Athletic.net, TFRRS, and MileSplit FAT track races.
              </p>
            </div>
          </div>

          {/* Live Roster Preview Strip */}
          <div className="bg-[#0F131A]/90 border border-[#1E2530] rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex -space-x-2">
                <div className="w-7 h-7 rounded-full bg-orange-500/20 border border-orange-500/50 flex items-center justify-center text-[10px] font-mono font-bold text-orange-300">
                  ML
                </div>
                <div className="w-7 h-7 rounded-full bg-sky-500/20 border border-sky-500/50 flex items-center justify-center text-[10px] font-mono font-bold text-sky-300">
                  LV
                </div>
                <div className="w-7 h-7 rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center text-[10px] font-mono font-bold text-emerald-300">
                  ER
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold text-white">
                  Pre-Loaded Multi-Athlete Coaching Roster Included
                </div>
                <div className="text-[11px] text-[#64748B]">
                  Switch between your profile, Maya Lin (Sub-20 5K), Lucas Vance (350W FTP), and Elena Rostova (2:52 Marathon)
                </div>
              </div>
            </div>
            <span className="text-[11px] font-mono text-[#10B981] bg-[#10B981]/10 border border-[#10B981]/30 px-2 py-0.5 rounded">
              4 Athletes Ready
            </span>
          </div>
        </div>

        {/* Right 5 Columns: Strava Sign-Up / Sign-In Card */}
        <div className="lg:col-span-5">
          <div className="bg-[#0F131A] border border-[#262F3D] rounded-xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-[#1E2530] pb-4">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-[#FC4C02] block">
                  ATHLETE &amp; COACH AUTHENTICATION
                </span>
                <h2 className="text-lg font-bold text-white mt-0.5">
                  Sign Up or Log In with Strava
                </h2>
              </div>
              <div className="px-2 py-1 rounded bg-[#14181F] border border-[#1E2530] text-[11px] font-mono text-[#94A3B8]">
                {status.stravaConnected ? (
                  <span className="text-[#10B981]">● Strava Connected</span>
                ) : status.stravaClientId ? (
                  <span className="text-[#38BDF8]">● OAuth Ready</span>
                ) : (
                  <span className="text-[#F59E0B]">● Client Setup / Demo</span>
                )}
              </div>
            </div>

            {errorMessage && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-300 font-mono">
                {errorMessage}
              </div>
            )}

            {/* Primary CTA: Continue with Strava */}
            <div className="space-y-3">
              <button
                onClick={onLaunchStravaOAuth}
                disabled={isSyncing}
                className="w-full py-3 px-4 rounded-lg bg-[#FC4C02] hover:bg-[#E34402] disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2.5 shadow-lg shadow-[#FC4C02]/20 transition-all cursor-pointer"
              >
                <Activity className="w-4 h-4" />
                <span>
                  {isSyncing
                    ? 'Connecting to Strava OAuth...'
                    : status.stravaConnected
                    ? 'Re-Sync Strava Account & Enter Workspace'
                    : 'Continue with Strava (OAuth 2.0 Popup)'}
                </span>
                <ExternalLink className="w-3.5 h-3.5 opacity-80" />
              </button>

              {/* Secondary CTA: 1-Click Live Athlete & Coach Sandbox */}
              <button
                onClick={onEnterSandbox}
                className="w-full py-2.5 px-4 rounded-lg bg-[#14181F] hover:bg-[#1C222C] border border-[#262F3D] hover:border-[#38BDF8]/50 text-[#F1F5F9] font-medium text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#38BDF8]" />
                <span>Enter Live Athlete &amp; Coach Sandbox (Instant Demo Bypass)</span>
                <ArrowRight className="w-3.5 h-3.5 text-[#94A3B8]" />
              </button>
            </div>

            {/* Scopes & Security Summary */}
            <div className="bg-[#090B0E] border border-[#1E2530] rounded-lg p-3.5 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono text-[#94A3B8]">
                <span>REQUESTED STRAVA SCOPES</span>
                <span className="text-[#10B981]">READ-ONLY TELEMETRY</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#14181F] border border-[#1E2530] text-[#CBD5E1]">
                  read
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#14181F] border border-[#1E2530] text-[#CBD5E1]">
                  activity:read_all
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#14181F] border border-[#1E2530] text-[#CBD5E1]">
                  profile:read_all
                </span>
              </div>
              <p className="text-[11px] text-[#64748B] leading-relaxed">
                Just like Intervals.icu, AeroPulse stores OAuth tokens in an HTTP-only server vault and enforces Strava API multi-athlete privacy rules.
              </p>
            </div>

            {/* Expandable Developer OAuth Configuration & Manual Code Exchange */}
            <div className="border-t border-[#1E2530] pt-3">
              <button
                type="button"
                onClick={() => setShowDeveloperConfig(!showDeveloperConfig)}
                className="w-full flex items-center justify-between text-xs font-mono text-[#94A3B8] hover:text-white py-1 transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-[#F97316]" />
                  <span>Strava API App Credentials &amp; Callback URLs</span>
                </span>
                {showDeveloperConfig ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {showDeveloperConfig && (
                <div className="mt-3 space-y-4 bg-[#090B0E] border border-[#1E2530] rounded-lg p-3.5">
                  {/* Callback URLs */}
                  <div className="space-y-2">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-[#94A3B8]">
                      Authorized OAuth Callback URLs (Set Domain in strava.com/settings/api)
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 bg-[#14181F] border border-[#1E2530] rounded px-2.5 py-1.5">
                        <div className="truncate text-[10px] font-mono text-[#CBD5E1]">
                          <span className="text-[#38BDF8] mr-1.5">[DEV]</span>
                          {DEV_CALLBACK_URL}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopy(DEV_CALLBACK_URL, 'DEV')}
                          className="shrink-0 text-[10px] font-mono text-[#94A3B8] hover:text-white flex items-center gap-1"
                        >
                          {copiedUrl === 'DEV' ? (
                            <Check className="w-3 h-3 text-[#10B981]" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-2 bg-[#14181F] border border-[#1E2530] rounded px-2.5 py-1.5">
                        <div className="truncate text-[10px] font-mono text-[#CBD5E1]">
                          <span className="text-[#10B981] mr-1.5">[SHARED]</span>
                          {SHARED_CALLBACK_URL}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopy(SHARED_CALLBACK_URL, 'SHARED')}
                          className="shrink-0 text-[10px] font-mono text-[#94A3B8] hover:text-white flex items-center gap-1"
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

                  {/* Save Client ID & Secret */}
                  <form onSubmit={handleSaveCredsSubmit} className="space-y-2 pt-1 border-t border-[#1E2530]">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-[#94A3B8]">
                      1. Configure Strava Client ID &amp; Client Secret
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={clientIdInput}
                        onChange={(e) => setClientIdInput(e.target.value)}
                        placeholder="Strava Client ID (e.g. 129481)"
                        className="bg-[#14181F] border border-[#262F3D] rounded px-2.5 py-1.5 text-xs font-mono text-white placeholder-[#64748B] focus:outline-none focus:border-[#FC4C02]"
                      />
                      <input
                        type="password"
                        value={clientSecretInput}
                        onChange={(e) => setClientSecretInput(e.target.value)}
                        placeholder="Strava Client Secret"
                        className="bg-[#14181F] border border-[#262F3D] rounded px-2.5 py-1.5 text-xs font-mono text-white placeholder-[#64748B] focus:outline-none focus:border-[#FC4C02]"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full py-1.5 rounded bg-[#1E2530] hover:bg-[#262F3D] text-xs font-mono text-white transition-colors"
                    >
                      Save Strava App Credentials to Server Vault
                    </button>
                  </form>

                  {/* Manual Code Exchange Fallback */}
                  <form onSubmit={handleManualExchangeSubmit} className="space-y-2 pt-1 border-t border-[#1E2530]">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-[#94A3B8]">
                      2. Or Paste Redirect URL / Authorization Code Directly
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={manualCodeInput}
                        onChange={(e) => setManualCodeInput(e.target.value)}
                        placeholder="Paste ?code=... or full callback URL"
                        className="flex-1 bg-[#14181F] border border-[#262F3D] rounded px-2.5 py-1.5 text-xs font-mono text-white placeholder-[#64748B] focus:outline-none focus:border-[#38BDF8]"
                      />
                      <button
                        type="submit"
                        className="px-3 py-1.5 rounded bg-[#38BDF8]/20 hover:bg-[#38BDF8]/30 border border-[#38BDF8]/40 text-xs font-mono text-[#38BDF8]"
                      >
                        Exchange
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Bottom Status Bar */}
      <footer className="border-t border-[#1E2530] bg-[#0D1015] px-6 py-3 flex flex-wrap items-center justify-between gap-4 text-[11px] font-mono text-[#64748B]">
        <div className="flex items-center gap-4">
          <span>AEROPULSE TELEMETRY ENGINE v4.2</span>
          <span>•</span>
          <span>STRAVA API COMPLIANT PRIVACY SHIELD</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[#94A3B8]">
            Callback Route: <code className="text-[#38BDF8]">/api/strava/callback</code>
          </span>
        </div>
      </footer>
    </div>
  );
};
