import React, { useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, KeyRound, Link2, RefreshCw, X } from 'lucide-react';
import { ConnectionStatus } from '../types';
import { PWAInstallButton } from './PWAInstallButton';

interface DataSourcesModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: ConnectionStatus;
  onConnectIntervals: (athleteId: string, apiKey: string) => Promise<void>;
  onDisconnectIntervals: () => Promise<void>;
  onSaveStravaCredentials: (clientId: string, clientSecret: string) => Promise<void>;
  onLaunchStravaOAuth: () => Promise<void>;
  onSyncNow: () => Promise<void>;
  isSyncing: boolean;
  errorMessage: string | null;
}

export const DataSourcesModal: React.FC<DataSourcesModalProps> = ({
  isOpen,
  onClose,
  status,
  onConnectIntervals,
  onDisconnectIntervals,
  onSaveStravaCredentials,
  onLaunchStravaOAuth,
  onSyncNow,
  isSyncing,
  errorMessage,
}) => {
  const [athleteId, setAthleteId] = useState(status.intervalsAthleteId || '0');
  const [intervalsKey, setIntervalsKey] = useState('');
  const [stravaClientId, setStravaClientId] = useState('');
  const [stravaClientSecret, setStravaClientSecret] = useState('');
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [localStatusMsg, setLocalStatusMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedLabel(label);
    setTimeout(() => setCopiedLabel(null), 2000);
  };

  const handleIntervalsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalStatusMsg(null);
    await onConnectIntervals(athleteId, intervalsKey);
    setIntervalsKey('');
  };

  const handleStravaCredsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveStravaCredentials(stravaClientId, stravaClientSecret);
    setLocalStatusMsg('Strava Client ID & Secret saved for this instance. Click "Connect Strava via OAuth Popup" below.');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto">
      <div className="w-full max-w-3xl rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden my-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Data Sources, API Keys & Fork Setup
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Connect your live Intervals.icu (including Garmin Connect wellness/workouts) and Strava OAuth2 accounts
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onSyncNow}
              disabled={isSyncing}
              className="min-h-[38px] flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing...' : 'Sync Telemetry'}</span>
            </button>
            <button
              onClick={onClose}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {errorMessage && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-600 dark:text-red-300">
              {errorMessage}
            </div>
          )}
          {localStatusMsg && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-700 dark:text-emerald-300">
              {localStatusMsg}
            </div>
          )}

          {/* Section 1: Intervals.icu + Garmin Connect Sync */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    01. Intervals.icu API + Garmin Connect Wellness Bridge
                  </h3>
                  <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                    · {status.intervalsConnected ? `Connected (${status.intervalsAthleteName || status.intervalsAthleteId})` : 'Using Calibration Dataset'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Pulls CTL/ATL/TSB load, power/HR/pace streams, planned calendar workouts, and Garmin-synced daily HRV, Resting HR, Sleep Score, and VO2max.
                </p>
              </div>
              <a
                href="https://intervals.icu/settings"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
              >
                <span>Open Intervals.icu Settings</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <form onSubmit={handleIntervalsSubmit} className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-1">
              <div className="sm:col-span-4">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Athlete ID (use <code className="font-mono">0</code> for self)
                </label>
                <input
                  type="text"
                  value={athleteId}
                  onChange={(e) => setAthleteId(e.target.value)}
                  placeholder="0 or i123456"
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="sm:col-span-5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Personal API Key (<code className="font-mono">INTERVALS_API_KEY</code>)
                </label>
                <input
                  type="password"
                  value={intervalsKey}
                  onChange={(e) => setIntervalsKey(e.target.value)}
                  placeholder={status.intervalsConnected ? '•••••••••••••••••••• (Connected)' : 'Paste your Intervals.icu API Key'}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="sm:col-span-3 flex items-end gap-2">
                <button
                  type="submit"
                  className="w-full min-h-[40px] rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-2 text-xs font-medium text-white transition-colors whitespace-nowrap"
                >
                  {status.intervalsConnected ? 'Update Key' : 'Connect API'}
                </button>
                {status.intervalsConnected && (
                  <button
                    type="button"
                    onClick={onDisconnectIntervals}
                    className="min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Reset
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Section 2: Strava OAuth2 & Segment Performance */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    02. Strava OAuth2 (Activities, Segment PRs & Gear Mileage)
                  </h3>
                  <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                    · {status.stravaConnected ? `Connected (${status.stravaAthleteName || 'OAuth Active'})` : 'OAuth Ready'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Enriches activities with Strava <code className="font-mono">segment_efforts</code>, PR medals (#1/2/3), starred benchmark climbs, and indoor/outdoor flags.
                </p>
              </div>
              <a
                href="https://www.strava.com/settings/api"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
              >
                <span>Strava API Dashboard</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {/* Required OAuth Callback URLs */}
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 p-3.5 space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                <Link2 className="w-3.5 h-3.5 text-blue-500" />
                <span>OAuth Redirect / Callback URLs (Copy for Strava API Settings)</span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md px-3 py-1.5">
                  <div className="truncate">
                    <span className="text-slate-500 mr-2">Active Origin Callback:</span>
                    <code className="font-mono text-slate-900 dark:text-slate-100">{status.currentOriginCallbackUrl}</code>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(status.currentOriginCallbackUrl, 'active')}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 shrink-0"
                  >
                    {copiedLabel === 'active' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedLabel === 'active' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md px-3 py-1.5">
                  <div className="truncate">
                    <span className="text-slate-500 mr-2">Development URL:</span>
                    <code className="font-mono text-slate-900 dark:text-slate-100">{status.devCallbackUrl}</code>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(status.devCallbackUrl, 'dev')}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 shrink-0"
                  >
                    {copiedLabel === 'dev' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedLabel === 'dev' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md px-3 py-1.5">
                  <div className="truncate">
                    <span className="text-slate-500 mr-2">Shared / Deployed URL:</span>
                    <code className="font-mono text-slate-900 dark:text-slate-100">{status.sharedCallbackUrl}</code>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(status.sharedCallbackUrl, 'shared')}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 shrink-0"
                  >
                    {copiedLabel === 'shared' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedLabel === 'shared' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Optional runtime Strava Client ID/Secret form for forkers who haven't set .env yet */}
            <form onSubmit={handleStravaCredsSubmit} className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-4">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Strava Client ID (<code className="font-mono">STRAVA_CLIENT_ID</code>)
                </label>
                <input
                  type="text"
                  value={stravaClientId}
                  onChange={(e) => setStravaClientId(e.target.value)}
                  placeholder="e.g. 129481"
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Strava Client Secret (<code className="font-mono">STRAVA_CLIENT_SECRET</code>)
                </label>
                <input
                  type="password"
                  value={stravaClientSecret}
                  onChange={(e) => setStravaClientSecret(e.target.value)}
                  placeholder="Paste Client Secret (or set in .env / Vercel)"
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-3 flex items-end">
                <button
                  type="submit"
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap"
                >
                  Save Client Keys
                </button>
              </div>
            </form>

            <div className="pt-1 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={onLaunchStravaOAuth}
                className="min-h-[42px] inline-flex items-center gap-2 rounded-lg bg-[#FC4C02] hover:bg-[#e34402] px-4 py-2 text-xs font-semibold text-white transition-colors"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>{status.stravaConnected ? 'Reconnect Strava OAuth2 Popup' : 'Connect Strava via OAuth2 Popup'}</span>
              </button>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Opens <code className="font-mono">strava.com/oauth/authorize</code> directly in a popup window
              </span>
            </div>
          </div>

          {/* Section 3: GitHub Fork & Vercel Self-Hosting Quick Guide + PWA Install */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              03. Deploying Your Own Fork to Vercel via GitHub & Installing PWA
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              This repository includes <code className="font-mono">vercel.json</code>, <code className="font-mono">/api/index.ts</code>, <code className="font-mono">.env.example</code>, and a full <code className="font-mono">README.md</code> guide. Anyone forking the repo on GitHub can import it into Vercel and set <code className="font-mono">GEMINI_API_KEY</code>, <code className="font-mono">INTERVALS_API_KEY</code>, <code className="font-mono">STRAVA_CLIENT_ID</code>, and <code className="font-mono">STRAVA_CLIENT_SECRET</code> in Vercel Environment Variables—or enter their keys directly in this modal.
            </p>
            <div className="pt-1 max-w-xs">
              <PWAInstallButton variant="full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
