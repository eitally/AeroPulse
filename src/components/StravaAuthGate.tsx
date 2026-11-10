import React, { useState } from 'react';
import {
  Activity,
  ShieldCheck,
  Database,
  ExternalLink,
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
  onDisconnectCredentials?: () => Promise<void>;
  isSyncing: boolean;
  errorMessage: string | null;
}

export const StravaAuthGate: React.FC<StravaAuthGateProps> = ({
  status,
  onLaunchStravaOAuth,
  onDisconnectCredentials,
  isSyncing,
  errorMessage,
}) => {
  const [isRedirecting, setIsRedirecting] = useState(false);

  const hasSavedDeviceData = Boolean(
    status.stravaConnected || status.intervalsConnected || status.garminConnected
  );

  const handleStravaLaunchClick = async () => {
    setIsRedirecting(true);
    try {
      await onLaunchStravaOAuth('cloud');
    } finally {
      setIsRedirecting(false);
    }
  };

  const busy = isSyncing || isRedirecting;

  return (
    <div className="min-h-screen bg-white dark:bg-[#0B0C0F] text-slate-900 dark:text-slate-100 flex flex-col justify-between selection:bg-[#EA580C]/30 selection:text-white">
      {/* Top Header */}
      <header className="relative border-b border-slate-200 dark:border-slate-800/80 bg-white/95 dark:bg-[#0D1015]/90 backdrop-blur-md px-4 sm:px-6 pt-[max(0.875rem,env(safe-area-inset-top,0px))] pb-3.5 flex items-center justify-between overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[2px] ap-brand-hairline pointer-events-none" />
        <AeroPulseLogo size="md" showTagline />

        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-slate-600 dark:text-slate-400 liquid-glass-subtle px-2.5 py-1 rounded-lg">
            <Lock className="w-3 h-3 text-[#10B981]" />
            <span className="hidden xs:inline">Strava OAuth 2.0</span>
            <span className="xs:hidden">OAuth 2.0</span>
          </span>
        </div>
      </header>

      {/* Main Split-Screen Sign-In & Sign-Up Gate */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-8 lg:py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left 7 Columns: Value Proposition & Dual-Duty Strava Architecture */}
        <div className="lg:col-span-7 space-y-6 order-2 lg:order-1">
          <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-slate-900 dark:text-white leading-[1.12]">
            Run &amp; Ride Threshold Intelligence, Official PRs &amp; AI Coaching.
          </h1>

          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
            Sign in directly with <span className="text-slate-900 dark:text-white font-semibold">Strava</span> to unlock your private athlete workspace and sync your workout history in the background. Once signed in, you can connect <span className="text-slate-900 dark:text-white font-medium">Garmin Connect</span>, <span className="text-slate-900 dark:text-white font-medium">Intervals.icu</span>, and advanced API settings from <span className="font-mono text-sky-600 dark:text-[#38BDF8]">Data Sources</span>.
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
                1-Click Sign-In &amp; Background Sync
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Strava verifies your athlete identity and automatically imports your historical rides, runs, GPS routes, segments, and PRs in the background.
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
                After signing in with Strava, open <span className="font-mono text-slate-800 dark:text-slate-200">Data Sources</span> to connect Garmin Connect, Intervals.icu, or custom API keys.
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
                Every athlete session is isolated to your authenticated Strava OAuth credentials—unregistered visitors never see another athlete&apos;s data.
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
                Track <span className="font-mono text-slate-800 dark:text-slate-200">CTL / ATL / TSB</span> training load, build structured Garmin FIT workouts, and log official race PRs.
              </p>
            </div>
          </div>
        </div>

        {/* Right 5 Columns: Clean Strava OAuth Sign-In Card (Intervals.icu Style) */}
        <div className="lg:col-span-5 order-1 lg:order-2">
          <div className="liquid-glass border border-stone-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-stone-200/80 dark:border-slate-800 pb-4">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-[#FC4C02] block font-semibold">
                  ATHLETE AUTHENTICATION
                </span>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                  Sign In with Strava
                </h2>
              </div>
              <div className="px-2.5 py-1 rounded liquid-glass-subtle border border-stone-200/80 dark:border-slate-800 text-[11px] font-mono">
                <span className="text-emerald-600 dark:text-[#10B981]">● OAuth 2.0</span>
              </div>
            </div>

            {errorMessage && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-700 dark:text-red-300 leading-relaxed break-words">
                {errorMessage}
              </div>
            )}

            {/* Primary 1-Click Strava OAuth Redirect Button */}
            <div className="space-y-4">
              <button
                type="button"
                onClick={handleStravaLaunchClick}
                disabled={busy}
                className="w-full min-h-[48px] py-3.5 px-4 rounded-xl bg-[#FC4C02] hover:bg-[#E34402] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2.5 shadow-lg shadow-[#FC4C02]/25 transition-all cursor-pointer"
              >
                {busy ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Activity className="w-4 h-4" />
                )}
                <span>
                  {busy ? 'Redirecting to Strava...' : 'Connect with Strava'}
                </span>
                <ExternalLink className="w-3.5 h-3.5 opacity-80" />
              </button>

              {/* How Strava Sign-In Works */}
              <div className="liquid-glass-subtle border border-stone-200/80 dark:border-slate-800 rounded-xl p-4 space-y-2.5">
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-600 dark:text-slate-400">
                  <span>STRAVA PERMISSIONS</span>
                  <span className="text-emerald-600 dark:text-[#10B981]">READ-ONLY</span>
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
                      <strong className="text-slate-900 dark:text-white">Authorize on Strava:</strong> Signs you in with your real Strava athlete profile and returns automatically to THRESH.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#FC4C02] font-mono font-bold">2.</span>
                    <span>
                      <strong className="text-slate-900 dark:text-white">Automatic History Sync:</strong> Imports your Strava rides, runs, streams, and PRs in the background.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-sky-600 dark:text-[#38BDF8] font-mono font-bold">3.</span>
                    <span>
                      <strong className="text-slate-900 dark:text-white">Data Sources Settings:</strong> Connect Garmin Connect, Intervals.icu, or custom API keys inside <strong className="text-slate-900 dark:text-white">Data Sources</strong> after signing in.
                    </span>
                  </li>
                </ul>
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
                  <span>Clear Cached Device Data</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Bottom Status Bar */}
      <footer className="border-t border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1015] px-4 sm:px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] flex flex-wrap items-center justify-between gap-4 text-[11px] font-mono text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-3">
          <span>THRESH TELEMETRY ENGINE</span>
          <span>•</span>
          <span>STRAVA OAUTH 2.0</span>
        </div>
        <div>
          <span>Powered by Strava, Garmin &amp; Intervals.icu</span>
        </div>
      </footer>
    </div>
  );
};
