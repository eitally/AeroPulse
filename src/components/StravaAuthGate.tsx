import React, { useState } from 'react';
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
  Lock,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trophy,
  Upload,
} from './icons/PhosphorIcons';
import { ConnectionStatus, DistanceUnit } from '../types';
import { AeroPulseLogo } from './AeroPulseLogo';

export interface FirstRunCalibrationPayload {
  athleteName: string;
  primarySport: 'Cycling' | 'Running' | 'Hybrid';
  distanceUnit: DistanceUnit;
  weightDisplay: number;
  cyclingFtpWatts: number;
  thresholdPaceInput: string; // e.g. "4:15" per km or "6:50" per mi
  entryTarget: 'WORKSPACE' | 'DATA_SOURCES' | 'UPLOAD_FIT';
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

export const StravaAuthGate: React.FC<StravaAuthGateProps> = ({
  status,
  onLaunchStravaOAuth,
  onExchangeStravaCode,
  onCompleteCalibrationEntry,
  onDisconnectCredentials,
  isSyncing,
  errorMessage,
}) => {
  const [athleteName, setAthleteName] = useState('');
  const [primarySport, setPrimarySport] = useState<'Cycling' | 'Running' | 'Hybrid'>('Hybrid');
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>('mi');
  const [weightInput, setWeightInput] = useState('158');
  const [ftpInput, setFtpInput] = useState('260');
  const [paceInput, setPaceInput] = useState('7:15');

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

  const handleCalibrationLaunch = async (
    entryTarget: FirstRunCalibrationPayload['entryTarget']
  ) => {
    setIsEntering(true);
    try {
      await fetch('/api/auth/session', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => null);

      if (onCompleteCalibrationEntry) {
        await onCompleteCalibrationEntry({
          athleteName: athleteName.trim() || 'Athlete',
          primarySport,
          distanceUnit,
          weightDisplay: Math.max(35, Number(weightInput) || (distanceUnit === 'mi' ? 158 : 71.5)),
          cyclingFtpWatts: Math.max(80, Math.round(Number(ftpInput) || 250)),
          thresholdPaceInput: paceInput.trim() || (distanceUnit === 'mi' ? '7:15' : '4:30'),
          entryTarget,
        });
      }
    } finally {
      setIsEntering(false);
    }
  };

  const handleStravaLaunchClick = async (mode: 'cloud' | 'localhost' = 'cloud') => {
    setIsRedirecting(true);
    try {
      await fetch('/api/auth/session', {
        method: 'POST',
        credentials: 'include',
      }).catch(() => null);
      await onLaunchStravaOAuth(mode);
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

  const busy = isSyncing || isRedirecting || isExchanging || isEntering;

  return (
    <div className="min-h-screen bg-[#F7F6F2] dark:bg-[#0A0B0D] text-slate-900 dark:text-slate-100 flex flex-col justify-between">
      {/* Top Header */}
      <header className="relative border-b border-stone-200 dark:border-slate-800/80 bg-[#F7F6F2]/95 dark:bg-[#121419]/95 px-4 sm:px-6 pt-[max(0.875rem,env(safe-area-inset-top,0px))] pb-3.5 flex items-center justify-between overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[2px] ap-brand-hairline pointer-events-none" />
        <AeroPulseLogo size="md" showTagline />

        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono ap-status-prime px-2.5 py-1 rounded-lg">
            <Lock className="w-3 h-3" />
            <span className="hidden xs:inline">Isolated Session</span>
            <span className="xs:hidden">Private</span>
          </span>
        </div>
      </header>

      {/* Main Split-Screen Onboarding & Calibration */}
      <main className="flex-1 max-w-[1380px] w-full mx-auto px-4 sm:px-6 py-8 lg:py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left 6 Columns: THRESH Value Proposition */}
        <div className="lg:col-span-6 space-y-6 order-2 lg:order-1 lg:pt-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full ap-status-info text-xs font-mono font-semibold">
            <span>PRECISION EDITORIAL ENDURANCE LAB</span>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-slate-900 dark:text-white leading-[1.12]">
            Daily Run &amp; Ride Readiness, Deflection Thresholds &amp; Periodized Load.
          </h1>

          <p className="text-sm sm:text-base text-slate-700 dark:text-slate-300 max-w-2xl leading-relaxed">
            Calibrate your physiological baseline in 60 seconds and connect <strong className="text-slate-900 dark:text-white">Garmin Connect</strong>, <strong className="text-slate-900 dark:text-white">Intervals.icu</strong>, or direct <strong className="text-slate-900 dark:text-white">.FIT / .GPX</strong> telemetry—no single vendor lock-in required.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
            <div className="liquid-glass rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-[#1D4ED8] dark:text-[#60A5FA] font-bold">
                  01 / 6:00 AM MORNING BRIEF
                </span>
                <Activity className="w-4 h-4 text-[#1D4ED8] dark:text-[#60A5FA]" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Autonomic Readiness Morphing
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Evaluates overnight HRV, resting heart rate, sleep, and TSB to prescribe or adapt today&apos;s workout with 1-tap Garmin `.FIT` export.
              </p>
            </div>

            <div className="liquid-glass rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-[#0D9488] dark:text-[#2DD4BF] font-bold">
                  02 / MULTI-SOURCE TELEMETRY
                </span>
                <Database className="w-4 h-4 text-[#0D9488] dark:text-[#2DD4BF]" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Garmin, Intervals.icu &amp; Native .FIT
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Decode compressed-timestamp `.FIT` streams locally in a Web Worker, or sync wellness and workouts from Garmin Connect and Intervals.icu.
              </p>
            </div>

            <div className="liquid-glass rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-[#047857] dark:text-[#34D399] font-bold">
                  03 / CLEAN-ROOM PRIVACY
                </span>
                <ShieldCheck className="w-4 h-4 text-[#047857] dark:text-[#34D399]" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Cryptographic Session Isolation
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Isolated `HttpOnly` session storage with strict API Clean-Room boundaries—optional Strava imports stay strictly in your personal route log.
              </p>
            </div>

            <div className="liquid-glass rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-[#D9480F] dark:text-[#FB6514] font-bold">
                  04 / 42D PMC &amp; OFFICIAL FAT PRS
                </span>
                <Trophy className="w-4 h-4 text-[#D9480F] dark:text-[#FB6514]" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Fitness, Fatigue &amp; Race Calibration
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Track 42-day CTL, 7-day ATL, Form zones, Critical Power (`CP` / `W&apos;`), and watchless `0.01s` track &amp; road race marks.
              </p>
            </div>
          </div>
        </div>

        {/* Right 6 Columns: 60-Second Calibration + Multi-Source Onboarding Card */}
        <div className="lg:col-span-6 order-1 lg:order-2">
          <div className="liquid-glass rounded-2xl p-5 sm:p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between border-b border-stone-200 dark:border-slate-800 pb-4">
              <div>
                <span className="text-[11px] font-mono uppercase tracking-widest text-[#D9480F] dark:text-[#FB6514] block font-bold">
                  60-SECOND CALIBRATION
                </span>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                  Configure Your THRESH Workspace
                </h2>
              </div>
              <div className="inline-flex rounded-lg p-0.5 bg-stone-200/70 dark:bg-slate-800 text-xs font-mono">
                {(['mi', 'km'] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => handleUnitChange(u)}
                    className={`min-h-[32px] px-2.5 py-1 rounded-md font-bold transition-colors ${
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

            {errorMessage && (
              <div className="ap-status-strained rounded-xl p-3 text-xs leading-relaxed break-words">
                {errorMessage}
              </div>
            )}

            {/* Calibration Fields */}
            <div className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Athlete Name
                  </label>
                  <input
                    type="text"
                    value={athleteName}
                    onChange={(e) => setAthleteName(e.target.value)}
                    placeholder="e.g. Alex Rivera"
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
                        className={`min-h-[34px] rounded-lg text-xs font-semibold transition-colors ${
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

              <div className="grid grid-cols-3 gap-2.5">
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
            </div>

            {/* Primary & Multi-Source Entry Actions */}
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
                  onClick={() => handleCalibrationLaunch('UPLOAD_FIT')}
                  disabled={busy}
                  className="ap-btn-secondary text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-4 h-4 text-[#0D9488] dark:text-[#2DD4BF]" />
                  <span>Upload .FIT / .GPX Files</span>
                </button>
              </div>
            </div>

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
                    Imports your personal Strava activities, GPS polylines, and PRs in read-only mode. Under THRESH&apos;s Clean-Room Firewall, Strava data is displayed strictly to you and is never sent to AI models or shared across athletes.
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
          <span>MULTI-SOURCE &amp; CLEAN-ROOM ISOLATED</span>
        </div>
        <div>
          <span>Garmin Connect · Intervals.icu · Native .FIT · Optional Strava</span>
        </div>
      </footer>
    </div>
  );
};
