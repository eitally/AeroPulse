import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Copy,
  Database,
  ExternalLink,
  KeyRound,
  Link2,
  Map as MapIcon,
  RefreshCw,
  X,
} from "./icons/PhosphorIcons";
import { ConnectionStatus, MapTileProvider } from '../types';
import { PWAInstallButton } from './PWAInstallButton';

interface DataSourcesModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: ConnectionStatus;
  onConnectIntervals: (athleteId: string, apiKey: string) => Promise<void>;
  onDisconnectIntervals: () => Promise<void>;
  onSaveStravaCredentials: (clientId: string, clientSecret: string) => Promise<void>;
  onLaunchStravaOAuth: (mode?: 'cloud' | 'localhost') => Promise<void>;
  onExchangeStravaCode: (codeOrUrl: string) => Promise<void>;
  onSaveStravaDirectToken: (refreshToken: string, accessToken?: string) => Promise<void>;
  onSaveMapTileConfig: (provider: MapTileProvider, apiKey: string) => Promise<void>;
  onExportBundle: () => Promise<{ bundle: string; envText: string } | null>;
  onImportBundle: (bundleOrEnv: string) => Promise<void>;
  onSyncNow: (fullHistory?: boolean) => Promise<void>;
  isSyncing: boolean;
  errorMessage: string | null;
  idbSavedAt?: string | null;
  persistedWorkoutCount?: number;
  onRebuildPersistedArchive?: () => Promise<void>;
}

export const DataSourcesModal: React.FC<DataSourcesModalProps> = ({
  isOpen,
  onClose,
  status,
  onConnectIntervals,
  onDisconnectIntervals,
  onSaveStravaCredentials,
  onLaunchStravaOAuth,
  onExchangeStravaCode,
  onSaveStravaDirectToken,
  onSaveMapTileConfig,
  onExportBundle,
  onImportBundle,
  onSyncNow,
  isSyncing,
  errorMessage,
  idbSavedAt,
  persistedWorkoutCount = 0,
  onRebuildPersistedArchive,
}) => {
  const [athleteId, setAthleteId] = useState(status.intervalsAthleteId || '0');
  const [intervalsKey, setIntervalsKey] = useState('');
  const [stravaClientId, setStravaClientId] = useState(status.stravaClientId || '');
  const [stravaClientSecret, setStravaClientSecret] = useState('');
  const [pastedCodeOrUrl, setPastedCodeOrUrl] = useState('');
  const [directRefreshToken, setDirectRefreshToken] = useState('');
  const [directAccessToken, setDirectAccessToken] = useState('');
  const [mapTileProvider, setMapTileProvider] = useState<MapTileProvider>(
    status.mapTileProvider || 'OSM_KEYLESS'
  );
  const [mapTileApiKey, setMapTileApiKey] = useState<string>(status.mapTileApiKey || '');
  const [garminPersonalApiKey, setGarminPersonalApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem('aeropulse_garmin_personal_api_key') || '';
    } catch {
      return '';
    }
  });
  const [garminEmail, setGarminEmail] = useState('');
  const [garminPassword, setGarminPassword] = useState('');
  const [garminBearerToken, setGarminBearerToken] = useState('');
  const [isConnectingGarmin, setIsConnectingGarmin] = useState(false);
  const [bundleInput, setBundleInput] = useState('');
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [localStatusMsg, setLocalStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (status.stravaClientId && !stravaClientId) {
      setStravaClientId(status.stravaClientId);
    }
    if (status.intervalsAthleteId && athleteId === '0') {
      setAthleteId(status.intervalsAthleteId);
    }
    if (status.mapTileProvider) {
      setMapTileProvider(status.mapTileProvider);
    }
    if (status.mapTileApiKey && !mapTileApiKey) {
      setMapTileApiKey(status.mapTileApiKey);
    }
  }, [
    status.stravaClientId,
    status.intervalsAthleteId,
    status.mapTileProvider,
    status.mapTileApiKey,
    stravaClientId,
    athleteId,
    mapTileApiKey,
  ]);

  if (!isOpen) return null;

  const devDomainOnly = status.devCallbackUrl
    .replace(/^https?:\/\//, '')
    .split('/')[0];
  const sharedDomainOnly = status.sharedCallbackUrl
    .replace(/^https?:\/\//, '')
    .split('/')[0];
  const activeDomainOnly = status.currentOriginCallbackUrl
    .replace(/^https?:\/\//, '')
    .split('/')[0];

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
    setLocalStatusMsg(
      'Strava Client ID & Secret saved. Choose any of the 3 connection methods below.'
    );
  };

  const handleCodeExchangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pastedCodeOrUrl.trim()) return;
    setLocalStatusMsg(null);
    await onExchangeStravaCode(pastedCodeOrUrl.trim());
    setPastedCodeOrUrl('');
    setLocalStatusMsg('Strava authorization code exchanged and full history synced!');
  };

  const handleDirectTokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directRefreshToken.trim() && !directAccessToken.trim()) return;
    setLocalStatusMsg(null);
    await onSaveStravaDirectToken(directRefreshToken.trim(), directAccessToken.trim());
    setDirectRefreshToken('');
    setDirectAccessToken('');
    setLocalStatusMsg('Strava token verified and full history synced!');
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl rounded-2xl liquid-glass shadow-2xl overflow-hidden my-auto"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Data Sources, All-Time Archive &amp; Hourly Auto-Sync
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Connect live Intervals.icu (Garmin Connect workouts + Sleep/HRV wellness) and Strava OAuth2
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onSyncNow(true)}
              disabled={isSyncing}
              className="min-h-[38px] flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing History...' : 'Sync Complete History'}</span>
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
        <div className="p-6 space-y-6 max-h-[82vh] overflow-y-auto">
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

          {/* All-Time Archive & Hourly Cron Status Banner */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-4 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-blue-500" />
                  <span>Local Workout Archive (Deployment-Safe)</span>
                </span>
                <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                  {persistedWorkoutCount > 0 ? 'Persisted Locally' : 'Ready'}
                </span>
              </div>
              <div className="text-xs font-mono text-slate-600 dark:text-slate-300">
                Cached: <strong>{(persistedWorkoutCount || status.totalActivitiesCount || 0).toLocaleString()}</strong> workouts (Garmin:{' '}
                <strong>{status.garminActivitiesCount ?? 0}</strong> · Strava:{' '}
                <strong>{status.stravaActivitiesCount ?? 0}</strong>)
              </div>
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <span className="text-[11px] text-slate-500">
                  {idbSavedAt
                    ? `Saved ${new Date(idbSavedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })} — survives GitHub → Vercel deployments.`
                    : 'Hydrates in <50ms and merges new workouts incrementally.'}
                </span>
                {onRebuildPersistedArchive && persistedWorkoutCount > 0 && (
                  <button
                    type="button"
                    onClick={onRebuildPersistedArchive}
                    disabled={isSyncing}
                    className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
                  >
                    Force Full Re-Sync
                  </button>
                )}
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-4 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Self-Healing OAuth &amp; Incremental Sync</span>
                </span>
                <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                  Active
                </span>
              </div>
              <div className="text-xs font-mono text-slate-600 dark:text-slate-300">
                Last Sync:{' '}
                <strong>
                  {status.lastSyncedAt
                    ? new Date(status.lastSyncedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'Just now'}
                </strong>{' '}
                · Next Poll:{' '}
                <strong>
                  {status.nextHourlySyncAt
                    ? new Date(status.nextHourlySyncAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'In 60m'}
                </strong>
              </div>
              <div className="text-[11px] text-slate-500">
                Strava OAuth refresh tokens auto-rotate &amp; self-heal across Vercel cold starts so you never have to re-authorize.
              </div>
            </div>
          </div>

          {/* Section 00: 1-Click Transfer to Deployed App / Vercel (.env & Connection Bundle) */}
          <div className="rounded-xl border border-blue-500/40 bg-blue-500/5 p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Transfer Active Connection to Deployed App / Vercel (1-Click Bundle &amp; .env)
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Copy your working Intervals.icu API Key + Strava <code className="font-mono">activity:read_all</code> Refresh Token from this local session and paste it into your deployed app or Vercel Environment Variables.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const exported = await onExportBundle();
                    if (exported?.bundle) {
                      copyToClipboard(exported.bundle, 'bundle_copy');
                      setLocalStatusMsg(
                        'Copied 1-Click Connection Bundle! Paste it into your deployed app to restore both Intervals.icu and Strava immediately.'
                      );
                    }
                  }}
                  className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                >
                  {copiedLabel === 'bundle_copy' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {copiedLabel === 'bundle_copy'
                      ? 'Copied Connection Bundle!'
                      : 'Copy 1-Click Connection Bundle'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const exported = await onExportBundle();
                    if (exported?.envText) {
                      copyToClipboard(exported.envText, 'env_copy');
                      setLocalStatusMsg(
                        'Copied Vercel .env Variables (including STRAVA_REFRESH_TOKEN)! Paste directly into Vercel Project Settings → Environment Variables.'
                      );
                    }
                  }}
                  className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border border-blue-500/40 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 px-3 py-1.5 text-xs font-semibold transition-colors"
                >
                  {copiedLabel === 'env_copy' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {copiedLabel === 'env_copy'
                      ? 'Copied Vercel .env!'
                      : 'Copy Vercel .env Block'}
                  </span>
                </button>
              </div>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!bundleInput.trim()) return;
                setLocalStatusMsg(null);
                await onImportBundle(bundleInput.trim());
                setBundleInput('');
                setLocalStatusMsg(
                  'Connection Bundle imported! Syncing your complete Intervals.icu + Strava history...'
                );
              }}
              className="flex flex-wrap items-center gap-2 pt-1"
            >
              <input
                type="text"
                value={bundleInput}
                onChange={(e) => setBundleInput(e.target.value)}
                placeholder="On your deployed app: Paste Connection Bundle or .env block here to connect both accounts in 1 click"
                className="flex-1 min-w-[240px] min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={isSyncing || !bundleInput.trim()}
                className="min-h-[36px] px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white whitespace-nowrap"
              >
                {isSyncing ? 'Syncing...' : 'Import Bundle & Sync History'}
              </button>
            </form>
          </div>

          {/* Section 1: Strava OAuth2 & All-Time Multi-Page Backfill */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    01. Strava OAuth2 (All-Time Paginated Backfill, Segment PRs &amp; Redacted Rides)
                  </h3>
                  <span
                    className={`text-xs font-mono font-semibold ${
                      status.stravaConnected
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    ·{' '}
                    {status.stravaConnected
                      ? `Connected (${status.stravaAthleteName || 'OAuth Active'})`
                      : status.stravaClientId
                        ? `Client ID ${status.stravaClientId} Saved — Ready to Authorize`
                        : 'OAuth Ready'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Paginates through your entire Strava history (<code className="font-mono">per_page=200</code> across all pages) to recover all 1,372 Strava-only rides/runs, PR medals, and segment efforts.
                </p>
              </div>
              <a
                href="https://www.strava.com/settings/api"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
              >
                <span>Open Strava API Settings</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {/* Step 1: Client ID & Secret */}
            <form onSubmit={handleStravaCredsSubmit} className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-4">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Strava Client ID (<code className="font-mono">STRAVA_CLIENT_ID</code>)
                </label>
                <input
                  type="text"
                  value={stravaClientId}
                  onChange={(e) => setStravaClientId(e.target.value)}
                  placeholder="e.g. 121717"
                  className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
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
                  placeholder={
                    status.stravaClientId
                      ? '•••••••••••••••••••• (Saved on Server)'
                      : 'Paste Client Secret'
                  }
                  className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-3 flex items-end">
                <button
                  type="submit"
                  className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap"
                >
                  {status.stravaClientId ? 'Update Client Keys' : 'Save Client Keys'}
                </button>
              </div>
            </form>

            {/* Important Strava Callback Domain Note + 3 Connection Methods */}
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 p-4 space-y-4">
              {/* Method A: Cloud Popup OAuth (requires setting Strava Authorization Callback Domain) */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                    <Link2 className="w-3.5 h-3.5 text-[#FC4C02]" />
                    <span>Method A: OAuth2 Popup (Set Strava &quot;Authorization Callback Domain&quot;)</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onLaunchStravaOAuth('cloud')}
                    className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg bg-[#FC4C02] hover:bg-[#e34402] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>
                      {status.stravaConnected
                        ? 'Reconnect Strava OAuth2 Popup'
                        : 'Connect Strava via OAuth2 Popup'}
                    </span>
                  </button>
                </div>

                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  In <a href="https://www.strava.com/settings/api" target="_blank" rel="noreferrer" className="text-blue-500 underline">strava.com/settings/api</a>, Strava&apos;s <strong>Authorization Callback Domain</strong> field requires <strong>only the domain hostname</strong> (no <code className="font-mono">https://</code> and no <code className="font-mono">/auth/strava/callback</code> path):
                </p>

                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2 bg-white dark:bg-slate-950 border border-amber-500/40 rounded-md px-3 py-1.5">
                    <div className="truncate">
                      <span className="text-amber-600 dark:text-amber-400 font-semibold mr-2">
                        Strava &quot;Authorization Callback Domain&quot; (Copy this):
                      </span>
                      <code className="font-mono text-slate-900 dark:text-slate-100 font-bold">
                        {activeDomainOnly}
                      </code>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(activeDomainOnly, 'domain_active')}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 shrink-0"
                    >
                      {copiedLabel === 'domain_active' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedLabel === 'domain_active' ? 'Copied' : 'Copy Domain'}</span>
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md px-3 py-1.5">
                    <div className="truncate">
                      <span className="text-slate-500 mr-2">Dev Callback URL:</span>
                      <code className="font-mono text-slate-900 dark:text-slate-100">
                        {status.devCallbackUrl}
                      </code>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(devDomainOnly, 'domain_dev')}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 shrink-0"
                    >
                      {copiedLabel === 'domain_dev' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedLabel === 'domain_dev' ? 'Copied' : 'Copy Dev Domain'}</span>
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md px-3 py-1.5">
                    <div className="truncate">
                      <span className="text-slate-500 mr-2">Shared Callback URL:</span>
                      <code className="font-mono text-slate-900 dark:text-slate-100">
                        {status.sharedCallbackUrl}
                      </code>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(sharedDomainOnly, 'domain_shared')}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 shrink-0"
                    >
                      {copiedLabel === 'domain_shared' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedLabel === 'domain_shared' ? 'Copied' : 'Copy Shared Domain'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Method B: Keep Strava Callback Domain as 'localhost' + Paste Redirect URL/Code */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    Method B: Keep Strava Callback Domain as <code className="font-mono">localhost</code> &amp; Paste Code URL
                  </div>
                  <button
                    type="button"
                    onClick={() => onLaunchStravaOAuth('localhost')}
                    className="min-h-[32px] px-3 py-1 rounded-lg border border-[#FC4C02]/50 text-[#FC4C02] hover:bg-[#FC4C02]/10 text-xs font-semibold transition-colors"
                  >
                    1. Authorize with localhost Redirect
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  If your Strava app&apos;s Authorization Callback Domain is <code className="font-mono">localhost</code>, click the button above, click <strong>Authorize</strong> on Strava, then copy the resulting <code className="font-mono">http://localhost/exchange_token?state=&amp;code=...</code> URL from the popup&apos;s address bar and paste it here:
                </p>
                <form onSubmit={handleCodeExchangeSubmit} className="flex gap-2">
                  <input
                    type="text"
                    value={pastedCodeOrUrl}
                    onChange={(e) => setPastedCodeOrUrl(e.target.value)}
                    placeholder="Paste http://localhost/exchange_token?... or raw code here"
                    className="flex-1 min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="submit"
                    className="min-h-[36px] px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white whitespace-nowrap"
                  >
                    2. Exchange Code &amp; Sync
                  </button>
                </form>
              </div>

              {/* Method C: Direct Strava Refresh Token / Access Token Paste */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Method C: Paste Strava Refresh Token / Access Token Directly
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Or paste <strong>Your Refresh Token</strong> (and optional Access Token) directly from <a href="https://www.strava.com/settings/api" target="_blank" rel="noreferrer" className="text-blue-500 underline">strava.com/settings/api</a>:
                </p>
                <form onSubmit={handleDirectTokenSubmit} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <div className="sm:col-span-5">
                    <input
                      type="password"
                      value={directRefreshToken}
                      onChange={(e) => setDirectRefreshToken(e.target.value)}
                      placeholder="Strava Refresh Token"
                      className="w-full min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <input
                      type="password"
                      value={directAccessToken}
                      onChange={(e) => setDirectAccessToken(e.target.value)}
                      placeholder="Access Token (optional)"
                      className="w-full min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <button
                      type="submit"
                      className="w-full min-h-[36px] px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white whitespace-nowrap"
                    >
                      Save Token &amp; Sync
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>

          {/* Section 2A: Direct Garmin Connect Integration (No Intervals.icu Required) */}
          <div className="rounded-xl border border-[#007CC3]/40 bg-[#007CC3]/[0.03] p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    02. Direct Garmin Connect Personal API (Biometrics, Sleep, HRV, Weight &amp; Activities)
                  </h3>
                  <span
                    className={`text-xs font-mono font-semibold ${
                      status.garminConnected ||
                      localStorage.getItem('aeropulse_garmin_personal_api_key') ||
                      localStorage.getItem('aeropulse_garmin_bearer_token')
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-[#007CC3] dark:text-sky-400'
                    }`}
                  >
                    ·{' '}
                    {status.garminConnected ||
                    localStorage.getItem('aeropulse_garmin_personal_api_key') ||
                    localStorage.getItem('aeropulse_garmin_bearer_token')
                      ? `Connected (${status.garminAthleteName || localStorage.getItem('aeropulse_garmin_athlete_name') || 'Garmin Personal API Active'})`
                      : 'Direct Integration Ready'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Paste your official <strong>Garmin Connect Personal API Key (<code className="font-mono">GCDC_...</code>)</strong> to bypass MFA and sync your real <strong>Garmin Index Scale Weight, Overnight HRV, Sleep Duration &amp; Score, Resting HR, Fitness Age, Cycling/Running HR Zones (LTHR &amp; Max HR), and Garmin Activities</strong> directly from <code className="font-mono">personal.connectapi.garmin.com</code>.
                </p>
              </div>
              <a
                href="https://connect.garmin.com/app/settings/personalApiToken"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-[#007CC3] dark:text-sky-400 hover:underline whitespace-nowrap"
              >
                <span>Generate Garmin Personal API Key</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setIsConnectingGarmin(true);
                setLocalStatusMsg(null);
                try {
                  const resp = await fetch('/api/config/garmin', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'x-auth-session': 'active',
                    },
                    body: JSON.stringify({
                      personalApiKey: garminPersonalApiKey.trim(),
                      email: garminEmail.trim(),
                      password: garminPassword,
                      directBearerToken: garminBearerToken.trim(),
                    }),
                  });
                  const data = await resp.json().catch(() => ({}));
                  if (!resp.ok) {
                    setLocalStatusMsg(data.error || 'Failed to connect Garmin Connect.');
                  } else {
                    if (data.garminTokens?.personalApiKey || garminPersonalApiKey.trim()) {
                      localStorage.setItem(
                        'aeropulse_garmin_personal_api_key',
                        data.garminTokens?.personalApiKey || garminPersonalApiKey.trim()
                      );
                    }
                    if (data.garminTokens?.oauth2AccessToken) {
                      localStorage.setItem(
                        'aeropulse_garmin_bearer_token',
                        data.garminTokens.oauth2AccessToken
                      );
                    }
                    if (data.garminTokens?.oauth1Token) {
                      localStorage.setItem(
                        'aeropulse_garmin_oauth1_token',
                        data.garminTokens.oauth1Token
                      );
                    }
                    if (data.garminTokens?.oauth1TokenSecret) {
                      localStorage.setItem(
                        'aeropulse_garmin_oauth1_secret',
                        data.garminTokens.oauth1TokenSecret
                      );
                    }
                    if (data.garminAthleteName) {
                      localStorage.setItem(
                        'aeropulse_garmin_athlete_name',
                        data.garminAthleteName
                      );
                    }
                    setGarminPassword('');
                    setGarminBearerToken('');
                    setLocalStatusMsg(
                      `Garmin Connect Personal API linked (${data.garminAthleteName || 'Garmin Account'})! Synced your Garmin weight, HRV, sleep, RHR, LTHR/Max HR zones, and activities.`
                    );
                    await onSyncNow(false);
                  }
                } finally {
                  setIsConnectingGarmin(false);
                }
              }}
              className="space-y-3 pt-1"
            >
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-9">
                  <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1">
                    Garmin Connect Personal API Key (<code className="font-mono">GCDC_...</code> — Recommended, Bypasses MFA)
                  </label>
                  <input
                    type="password"
                    autoComplete="off"
                    value={garminPersonalApiKey}
                    onChange={(e) => setGarminPersonalApiKey(e.target.value)}
                    placeholder="GCDC_00000000-0000-0000-0000-000000000000..."
                    className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="sm:col-span-3 flex items-end gap-2">
                  <button
                    type="submit"
                    disabled={isConnectingGarmin}
                    className="w-full min-h-[38px] rounded-lg bg-[#007CC3] hover:bg-[#0066a1] disabled:opacity-50 px-3 py-1.5 text-xs font-semibold text-white transition-colors whitespace-nowrap"
                  >
                    {isConnectingGarmin ? 'Verifying...' : 'Save & Sync Garmin'}
                  </button>
                  {(status.garminConnected ||
                    localStorage.getItem('aeropulse_garmin_personal_api_key') ||
                    localStorage.getItem('aeropulse_garmin_bearer_token')) && (
                    <button
                      type="button"
                      onClick={async () => {
                        const tok = localStorage.getItem('aeropulse_session_token') || '';
                        await fetch('/api/config/garmin', {
                          method: 'DELETE',
                          credentials: 'same-origin',
                          headers: tok ? { 'x-session-token': tok } : undefined,
                        });
                        localStorage.removeItem('aeropulse_garmin_personal_api_key');
                        localStorage.removeItem('aeropulse_garmin_bearer_token');
                        localStorage.removeItem('aeropulse_garmin_oauth1_token');
                        localStorage.removeItem('aeropulse_garmin_oauth1_secret');
                        localStorage.removeItem('aeropulse_garmin_athlete_name');
                        setGarminPersonalApiKey('');
                        setLocalStatusMsg('Direct Garmin Connect session cleared.');
                      }}
                      className="min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              <details className="pt-1 border-t border-slate-200/70 dark:border-slate-800/80 text-xs">
                <summary className="cursor-pointer font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 select-none py-1">
                  Advanced: Optional Garmin Web Bearer Token or Non-MFA Login (for direct Calendar write)
                </summary>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-2">
                  <div className="sm:col-span-4">
                    <input
                      type="email"
                      value={garminEmail}
                      onChange={(e) => setGarminEmail(e.target.value)}
                      placeholder="Garmin Email (non-MFA only)"
                      className="w-full min-h-[34px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <input
                      type="password"
                      value={garminPassword}
                      onChange={(e) => setGarminPassword(e.target.value)}
                      placeholder="Garmin Password"
                      className="w-full min-h-[34px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <input
                      type="password"
                      value={garminBearerToken}
                      onChange={(e) => setGarminBearerToken(e.target.value)}
                      placeholder="Web Bearer eyJhbGci... (optional)"
                      className="w-full min-h-[34px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>
              </details>
            </form>
          </div>

          {/* Section 2B: Optional Intervals.icu Bridge */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    02B. Optional Legacy Bridge: Intervals.icu API
                  </h3>
                  <span
                    className={`text-xs font-mono font-semibold ${
                      status.intervalsConnected
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    ·{' '}
                    {status.intervalsConnected
                      ? `Connected (${status.intervalsAthleteName || status.intervalsAthleteId})`
                      : 'Optional — Not Required'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Optional secondary bridge if you also maintain an Intervals.icu account alongside Strava and Garmin Connect.
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
                  placeholder={
                    status.intervalsConnected
                      ? '•••••••••••••••••••• (Connected)'
                      : 'Paste your Intervals.icu API Key'
                  }
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

          {/* Section 3: Mapbox / OpenStreetMap Map Tile API Key Configuration */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <MapIcon className="w-4 h-4 text-[#FC4C02]" />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    03. Mapbox / OpenStreetMap Map Tile Provider &amp; API Key
                  </h3>
                  <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                    ·{' '}
                    {status.mapTileProvider === 'MAPBOX' && status.mapTileApiKeyConfigured
                      ? 'Mapbox API Key Active'
                      : status.mapTileProvider === 'THUNDERFOREST' && status.mapTileApiKeyConfigured
                        ? 'OpenStreetMap / Thunderforest Key Active'
                        : 'OpenStreetMap Keyless Tiles Active'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Configure the Leaflet map tiles used in the Activity View (Dark Matter, Outdoors/Cycle, Street, and Satellite). Choose <strong>OpenStreetMap (Free Keyless)</strong> for zero-key maps, or enter a <strong>Mapbox Public Access Token</strong> (<code className="font-mono">pk.eyJ1...</code>) or <strong>OpenStreetMap / Thunderforest API Key</strong> for high-DPI Outdoors &amp; OpenCycleMap tiles.
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <a
                  href="https://account.mapbox.com/access-tokens/"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                >
                  <span>Mapbox Tokens</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                <a
                  href="https://manage.thunderforest.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                >
                  <span>OpenCycleMap Key</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setLocalStatusMsg(null);
                const trimmedKey = mapTileApiKey.trim();
                const autoProvider: MapTileProvider =
                  trimmedKey.startsWith('pk.') && mapTileProvider === 'OSM_KEYLESS'
                    ? 'MAPBOX'
                    : trimmedKey && mapTileProvider === 'OSM_KEYLESS'
                      ? 'THUNDERFOREST'
                      : mapTileProvider;
                setMapTileProvider(autoProvider);
                await onSaveMapTileConfig(autoProvider, trimmedKey);
                setLocalStatusMsg(
                  autoProvider === 'OSM_KEYLESS' || !trimmedKey
                    ? 'Map tiles updated to Free Keyless OpenStreetMap + CARTO + Esri Satellite.'
                    : `Map tiles updated to ${autoProvider === 'MAPBOX' ? 'Mapbox 512px High-DPI Tiles' : 'OpenStreetMap / Thunderforest Cycle & Outdoors Tiles'} with your API key!`
                );
              }}
              className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-1"
            >
              <div className="sm:col-span-4">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Map Tile Provider
                </label>
                <select
                  value={mapTileProvider}
                  onChange={(e) => setMapTileProvider(e.target.value as MapTileProvider)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="OSM_KEYLESS">OpenStreetMap + CARTO (Free / No Key)</option>
                  <option value="MAPBOX">Mapbox (Dark, Outdoors, Streets, Satellite)</option>
                  <option value="THUNDERFOREST">
                    OpenStreetMap / Thunderforest (OpenCycleMap &amp; Outdoors)
                  </option>
                </select>
              </div>
              <div className="sm:col-span-5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Mapbox or OpenStreetMap API Key (<code className="font-mono">MAPBOX_ACCESS_TOKEN</code>)
                </label>
                <input
                  type="password"
                  value={mapTileApiKey}
                  onChange={(e) => {
                    const val = e.target.value;
                    setMapTileApiKey(val);
                    if (val.trim().startsWith('pk.')) {
                      setMapTileProvider('MAPBOX');
                    }
                  }}
                  placeholder={
                    mapTileProvider === 'MAPBOX'
                      ? 'pk.eyJ1Ijoi... (Mapbox Public Token)'
                      : mapTileProvider === 'THUNDERFOREST'
                        ? 'Paste Thunderforest / OpenCycleMap API Key'
                        : 'Optional — leave blank for keyless OpenStreetMap tiles'
                  }
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="sm:col-span-3 flex items-end gap-2">
                <button
                  type="submit"
                  className="w-full min-h-[40px] rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-2 text-xs font-medium text-white transition-colors whitespace-nowrap"
                >
                  Save Map Tile Key
                </button>
                {(mapTileApiKey || mapTileProvider !== 'OSM_KEYLESS') && (
                  <button
                    type="button"
                    onClick={async () => {
                      setMapTileProvider('OSM_KEYLESS');
                      setMapTileApiKey('');
                      await onSaveMapTileConfig('OSM_KEYLESS', '');
                      setLocalStatusMsg('Reset to keyless OpenStreetMap + CARTO tiles.');
                    }}
                    className="min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Use Free OSM
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Section 4: GitHub Fork & Vercel Self-Hosting Quick Guide + PWA Install */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              04. Deploying Your Own Fork to Vercel via GitHub &amp; Installing PWA
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              This repository includes <code className="font-mono">vercel.json</code> (with the <code className="font-mono">0 * * * *</code> hourly cron job), <code className="font-mono">/api/index.ts</code>, and <code className="font-mono">.env.example</code>.
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
