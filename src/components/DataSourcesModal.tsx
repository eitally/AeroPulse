import React, { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  Map as MapIcon,
  RefreshCw,
  Sliders,
  Upload,
  X,
} from './icons/PhosphorIcons';
import { ConnectionStatus, MapTileProvider, UnifiedActivity } from '../types';
import { PWAInstallButton } from './PWAInstallButton';
import {
  importWorkoutFilesOrArchive,
  type ArchiveImportProgress,
} from '../utils/archiveImporter';

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
  existingActivities?: UnifiedActivity[];
  onImportBatchActivities?: (activities: UnifiedActivity[]) => void;
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
  existingActivities = [],
  onImportBatchActivities,
}) => {
  const [archiveProgress, setArchiveProgress] = useState<ArchiveImportProgress | null>(null);
  const [isImportingArchive, setIsImportingArchive] = useState(false);

  // Intervals.icu
  const [athleteId, setAthleteId] = useState(status.intervalsAthleteId || '0');
  const [intervalsKey, setIntervalsKey] = useState('');

  // Strava custom keys / token fallback
  const [stravaClientId, setStravaClientId] = useState(status.stravaClientId || '');
  const [stravaClientSecret, setStravaClientSecret] = useState('');
  const [stravaFallbackInput, setStravaFallbackInput] = useState('');

  // Garmin Connect Personal API
  const [garminPersonalApiKey, setGarminPersonalApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem('aeropulse_garmin_personal_api_key') || '';
    } catch {
      return '';
    }
  });
  const [isConnectingGarmin, setIsConnectingGarmin] = useState(false);

  // Advanced: Map Tiles & Cross-Device Bundle
  const [mapTileProvider, setMapTileProvider] = useState<MapTileProvider>(
    status.mapTileProvider || 'OSM_KEYLESS'
  );
  const [mapTileApiKey, setMapTileApiKey] = useState<string>(status.mapTileApiKey || '');
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

  const activeDomainOnly = status.currentOriginCallbackUrl
    .replace(/^https?:\/\//, '')
    .split('/')[0];

  const isGarminConnected = Boolean(
    status.garminConnected ||
      localStorage.getItem('aeropulse_garmin_personal_api_key') ||
      localStorage.getItem('aeropulse_garmin_bearer_token')
  );

  const totalWorkouts = persistedWorkoutCount || status.totalActivitiesCount || 0;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedLabel(label);
    window.setTimeout(() => setCopiedLabel(null), 2000);
  };

  const handleStravaKeysAndLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalStatusMsg(null);
    try {
      if (stravaClientId.trim()) {
        localStorage.setItem('aeropulse_strava_client_id', stravaClientId.trim());
      }
      if (stravaClientSecret.trim()) {
        localStorage.setItem('aeropulse_strava_client_secret', stravaClientSecret.trim());
      }
    } catch {
      // ignore
    }
    const launchPromise = onLaunchStravaOAuth('cloud');
    if (stravaClientId.trim() && stravaClientSecret.trim()) {
      void onSaveStravaCredentials(stravaClientId.trim(), stravaClientSecret.trim());
    }
    setLocalStatusMsg('Strava API keys saved. Opening Strava authorization popup...');
    await launchPromise;
  };

  const handleStravaFallbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = stravaFallbackInput.trim();
    if (!raw) return;
    setLocalStatusMsg(null);
    if (raw.includes('code=') || raw.startsWith('http')) {
      await onExchangeStravaCode(raw);
    } else {
      await onSaveStravaDirectToken(raw);
    }
    setStravaFallbackInput('');
    setLocalStatusMsg('Strava connected! Syncing your workout history...');
  };

  const handleGarminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!garminPersonalApiKey.trim()) return;
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
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setLocalStatusMsg(data.error || 'Could not connect Garmin Connect.');
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
          localStorage.setItem('aeropulse_garmin_oauth1_token', data.garminTokens.oauth1Token);
        }
        if (data.garminTokens?.oauth1TokenSecret) {
          localStorage.setItem(
            'aeropulse_garmin_oauth1_secret',
            data.garminTokens.oauth1TokenSecret
          );
        }
        if (data.garminAthleteName) {
          localStorage.setItem('aeropulse_garmin_athlete_name', data.garminAthleteName);
        }
        setLocalStatusMsg(
          `Garmin Connect linked (${data.garminAthleteName || 'Active'})! Syncing sleep, HRV & workouts...`
        );
        await onSyncNow(false);
      }
    } finally {
      setIsConnectingGarmin(false);
    }
  };

  const handleDisconnectGarmin = async () => {
    const tok = localStorage.getItem('aeropulse_session_token') || '';
    await fetch('/api/config/garmin', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: tok ? { 'x-session-token': tok } : undefined,
    }).catch(() => null);
    localStorage.removeItem('aeropulse_garmin_personal_api_key');
    localStorage.removeItem('aeropulse_garmin_bearer_token');
    localStorage.removeItem('aeropulse_garmin_oauth1_token');
    localStorage.removeItem('aeropulse_garmin_oauth1_secret');
    localStorage.removeItem('aeropulse_garmin_athlete_name');
    setGarminPersonalApiKey('');
    setLocalStatusMsg('Garmin Connect disconnected.');
  };

  const handleIntervalsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalStatusMsg(null);
    await onConnectIntervals(athleteId.trim() || '0', intervalsKey.trim());
    setIntervalsKey('');
    setLocalStatusMsg('Intervals.icu connected!');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Connected Apps & Workout Import"
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl ap-content-stage overflow-hidden my-auto"
      >
        {/* Clean Header */}
        <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-[#121815]/90">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Connected Apps &amp; Workout Import
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {totalWorkouts > 0
                ? `${totalWorkouts.toLocaleString()} workouts synced${
                    status.lastSyncedAt
                      ? ` · Last updated ${new Date(status.lastSyncedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}`
                      : ''
                  }`
                : 'Link Strava, Garmin, or Intervals.icu—or drop workout files below'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onSyncNow(true)}
              disabled={isSyncing}
              className="ap-btn-primary !min-h-[38px] !px-3.5 !py-1.5 text-xs cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl liquid-glass-subtle text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Simplified Body */}
        <div className="p-5 sm:p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {errorMessage && (
            <div className="ap-status-strained rounded-xl px-4 py-3 text-xs">{errorMessage}</div>
          )}
          {localStatusMsg && (
            <div className="ap-status-prime rounded-xl px-4 py-3 text-xs">{localStatusMsg}</div>
          )}

          {/* 1. STRAVA */}
          <section className="liquid-glass rounded-2xl p-4 sm:p-5 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Strava</h3>
                  {status.stravaConnected ? (
                    <span className="ap-status-prime px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold">
                      Connected{status.stravaAthleteName ? ` · ${status.stravaAthleteName}` : ''}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                      Not Connected
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Imports runs, rides, GPS routes, gear mileage, and segment PRs automatically.
                </p>
              </div>

              <button
                type="button"
                onClick={() => onLaunchStravaOAuth('cloud')}
                disabled={isSyncing}
                className="min-h-[40px] inline-flex items-center gap-2 rounded-xl bg-[#FC4C02] hover:bg-[#e34402] px-4 py-2 text-xs font-bold text-white transition-colors cursor-pointer shrink-0"
              >
                <Activity className="w-4 h-4" />
                <span>{status.stravaConnected ? 'Reconnect Strava' : 'Connect with Strava'}</span>
              </button>
            </div>

            <details className="pt-2 border-t border-slate-200/80 dark:border-white/10 text-xs">
              <summary className="cursor-pointer font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 select-none py-1">
                Use your own Strava API keys or paste a token manually
              </summary>
              <div className="mt-3 space-y-3 rounded-xl liquid-glass-subtle p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="text-slate-600 dark:text-slate-300">
                    In{' '}
                    <a
                      href="https://www.strava.com/settings/api"
                      target="_blank"
                      rel="noreferrer"
                      className="underline font-semibold ap-text-brand"
                    >
                      strava.com/settings/api
                    </a>
                    , set Callback Domain to{' '}
                    <code className="font-mono font-bold text-slate-900 dark:text-white">
                      {activeDomainOnly}
                    </code>
                  </span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(activeDomainOnly, 'domain')}
                    className="inline-flex items-center gap-1 font-semibold ap-text-brand cursor-pointer"
                  >
                    {copiedLabel === 'domain' ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
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

                <form onSubmit={handleStravaKeysAndLaunch} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <input
                    type="text"
                    value={stravaClientId}
                    onChange={(e) => setStravaClientId(e.target.value)}
                    placeholder="Client ID"
                    className="sm:col-span-4 min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                  <input
                    type="password"
                    value={stravaClientSecret}
                    onChange={(e) => setStravaClientSecret(e.target.value)}
                    placeholder={status.stravaClientId ? 'Client Secret (saved)' : 'Client Secret'}
                    className="sm:col-span-5 min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="submit"
                    className="sm:col-span-3 min-h-[38px] rounded-lg bg-[#FC4C02] hover:bg-[#e34402] text-white font-semibold text-xs px-3 cursor-pointer"
                  >
                    Save &amp; Connect
                  </button>
                </form>

                <form onSubmit={handleStravaFallbackSubmit} className="flex gap-2 pt-2 border-t border-slate-200/70 dark:border-white/10">
                  <input
                    type="password"
                    value={stravaFallbackInput}
                    onChange={(e) => setStravaFallbackInput(e.target.value)}
                    placeholder="Or paste Strava Refresh Token / redirect URL..."
                    className="flex-1 min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="submit"
                    disabled={!stravaFallbackInput.trim()}
                    className="ap-btn-secondary !min-h-[36px] text-xs cursor-pointer disabled:opacity-50"
                  >
                    Verify Token
                  </button>
                </form>
              </div>
            </details>
          </section>

          {/* 2. GARMIN CONNECT */}
          <section className="liquid-glass rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Garmin Connect
                  </h3>
                  {isGarminConnected ? (
                    <span className="ap-status-prime px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold">
                      Connected
                      {status.garminAthleteName ? ` · ${status.garminAthleteName}` : ''}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                      Optional
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Syncs overnight Sleep, HRV, Resting HR, Weight, and Garmin activities directly.
                </p>
              </div>
              <a
                href="https://connect.garmin.com/app/settings/personalApiToken"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold ap-text-brand hover:underline whitespace-nowrap"
              >
                <span>Get Garmin Key</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <form onSubmit={handleGarminSubmit} className="flex flex-wrap sm:flex-nowrap gap-2">
              <input
                type="password"
                autoComplete="off"
                value={garminPersonalApiKey}
                onChange={(e) => setGarminPersonalApiKey(e.target.value)}
                placeholder="Paste Garmin Personal API Key (GCDC_...)"
                className="flex-1 min-w-[200px] min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={isConnectingGarmin || !garminPersonalApiKey.trim()}
                className="ap-btn-primary !min-h-[40px] text-xs cursor-pointer disabled:opacity-50"
              >
                {isConnectingGarmin ? 'Verifying...' : 'Connect Garmin'}
              </button>
              {isGarminConnected && (
                <button
                  type="button"
                  onClick={handleDisconnectGarmin}
                  className="ap-btn-secondary !min-h-[40px] text-xs cursor-pointer"
                >
                  Disconnect
                </button>
              )}
            </form>
          </section>

          {/* 3. INTERVALS.ICU */}
          <section className="liquid-glass rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Intervals.icu
                  </h3>
                  {status.intervalsConnected ? (
                    <span className="ap-status-prime px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold">
                      Connected
                      {status.intervalsAthleteName
                        ? ` · ${status.intervalsAthleteName}`
                        : ''}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                      Optional
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Syncs structured workouts, training load curves, and wellness logs from Intervals.icu.
                </p>
              </div>
              <a
                href="https://intervals.icu/settings"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold ap-text-brand hover:underline whitespace-nowrap"
              >
                <span>Get API Key</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <form onSubmit={handleIntervalsSubmit} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <input
                type="text"
                value={athleteId}
                onChange={(e) => setAthleteId(e.target.value)}
                placeholder="Athlete ID (0 for self)"
                className="sm:col-span-3 min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
              <input
                type="password"
                value={intervalsKey}
                onChange={(e) => setIntervalsKey(e.target.value)}
                placeholder={
                  status.intervalsConnected ? 'API Key Connected (paste to update)' : 'Paste Intervals.icu API Key'
                }
                className="sm:col-span-6 min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
              <div className="sm:col-span-3 flex gap-2">
                <button
                  type="submit"
                  disabled={!intervalsKey.trim()}
                  className="flex-1 ap-btn-primary !min-h-[40px] text-xs cursor-pointer disabled:opacity-50"
                >
                  {status.intervalsConnected ? 'Update' : 'Connect'}
                </button>
                {status.intervalsConnected && (
                  <button
                    type="button"
                    onClick={onDisconnectIntervals}
                    className="ap-btn-secondary !min-h-[40px] !px-2.5 text-xs cursor-pointer"
                  >
                    Reset
                  </button>
                )}
              </div>
            </form>
          </section>

          {/* 4. DIRECT FILE UPLOAD (.FIT / .GPX / .TCX / .ZIP) */}
          {onImportBatchActivities && (
            <section className="liquid-glass rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Upload Workout Files (.FIT, .GPX, .TCX, or .ZIP)
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    Import single workout files or a full Garmin / Strava export <code className="font-mono">.zip</code> directly in your browser.
                  </p>
                </div>
                <label className="ap-btn-secondary !min-h-[40px] text-xs cursor-pointer whitespace-nowrap">
                  <Upload className="w-3.5 h-3.5 ap-text-brand" />
                  <span>{isImportingArchive ? 'Importing...' : 'Choose Files'}</span>
                  <input
                    type="file"
                    multiple
                    disabled={isImportingArchive}
                    accept=".fit,.fit.gz,.gpx,.gpx.gz,.tcx,.tcx.gz,.zip,.json"
                    onChange={async (e) => {
                      const files = e.target.files ? Array.from(e.target.files) : [];
                      if (files.length === 0) return;
                      setIsImportingArchive(true);
                      setLocalStatusMsg(null);
                      try {
                        const res = await importWorkoutFilesOrArchive({
                          files,
                          existingActivities,
                          onProgress: (p) => setArchiveProgress({ ...p }),
                        });
                        if (res.importedActivities.length > 0) {
                          onImportBatchActivities(res.importedActivities);
                        }
                        setLocalStatusMsg(
                          `Imported ${res.importedActivities.length} workout${
                            res.importedActivities.length === 1 ? '' : 's'
                          }.`
                        );
                      } catch {
                        setLocalStatusMsg('Could not parse one or more selected files.');
                      } finally {
                        setArchiveProgress(null);
                        setIsImportingArchive(false);
                        e.target.value = '';
                      }
                    }}
                    className="hidden"
                  />
                </label>
              </div>

              {archiveProgress && (
                <div className="space-y-1.5 text-xs font-mono">
                  <div className="flex justify-between ap-text-brand">
                    <span>
                      Reading ({archiveProgress.processed} / {archiveProgress.total}):{' '}
                      {archiveProgress.currentFileName}
                    </span>
                    <span>{archiveProgress.importedCount} imported</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-[#84CC16] dark:bg-[#C8FF00] transition-all duration-150"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            (archiveProgress.processed / Math.max(1, archiveProgress.total)) * 100
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </section>
          )}

          {/* 5. COLLAPSED ADVANCED SETTINGS (Map Tiles, Backup Bundle, Cache & PWA) */}
          <details className="rounded-2xl liquid-glass-subtle p-4 text-xs">
            <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2 select-none">
              <Sliders className="w-3.5 h-3.5 ap-text-brand" />
              <span>Advanced Options (Map Styles, Cross-Device Backup &amp; Cache)</span>
            </summary>

            <div className="mt-4 space-y-5 pt-4 border-t border-slate-200/80 dark:border-white/10">
              {/* Map Tiles */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white">
                  <MapIcon className="w-3.5 h-3.5 ap-text-brand" />
                  <span>Activity Map Tile Style</span>
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
                    setLocalStatusMsg('Map tile preferences saved.');
                  }}
                  className="grid grid-cols-1 sm:grid-cols-12 gap-2"
                >
                  <select
                    value={mapTileProvider}
                    onChange={(e) => setMapTileProvider(e.target.value as MapTileProvider)}
                    className="sm:col-span-4 min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="OSM_KEYLESS">OpenStreetMap (Free / No Key)</option>
                    <option value="MAPBOX">Mapbox High-DPI</option>
                    <option value="THUNDERFOREST">OpenCycleMap / Thunderforest</option>
                  </select>
                  <input
                    type="password"
                    value={mapTileApiKey}
                    onChange={(e) => {
                      const val = e.target.value;
                      setMapTileApiKey(val);
                      if (val.trim().startsWith('pk.')) setMapTileProvider('MAPBOX');
                    }}
                    placeholder="Optional Mapbox (pk.ey...) or Thunderforest key"
                    className="sm:col-span-5 min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="submit"
                    className="sm:col-span-3 ap-btn-secondary !min-h-[38px] text-xs cursor-pointer"
                  >
                    Save Map Style
                  </button>
                </form>
              </div>

              {/* Cross-Device Connection Backup */}
              <div className="space-y-2 pt-3 border-t border-slate-200/70 dark:border-white/10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white">
                    <Database className="w-3.5 h-3.5 ap-text-brand" />
                    <span>Transfer Connections to Another Browser</span>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const exported = await onExportBundle();
                      if (exported?.bundle) {
                        copyToClipboard(exported.bundle, 'bundle');
                        setLocalStatusMsg('Copied Connection Bundle to clipboard.');
                      }
                    }}
                    className="ap-btn-secondary !min-h-[34px] text-xs cursor-pointer"
                  >
                    {copiedLabel === 'bundle' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedLabel === 'bundle' ? 'Copied!' : 'Copy Connection Bundle'}</span>
                  </button>
                </div>

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!bundleInput.trim()) return;
                    setLocalStatusMsg(null);
                    await onImportBundle(bundleInput.trim());
                    setBundleInput('');
                    setLocalStatusMsg('Connection Bundle restored!');
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={bundleInput}
                    onChange={(e) => setBundleInput(e.target.value)}
                    placeholder="Paste Connection Bundle here to restore accounts..."
                    className="flex-1 min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="submit"
                    disabled={isSyncing || !bundleInput.trim()}
                    className="ap-btn-secondary !min-h-[36px] text-xs cursor-pointer disabled:opacity-50"
                  >
                    Restore
                  </button>
                </form>
              </div>

              {/* Local Cache & PWA Install */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200/70 dark:border-white/10">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {idbSavedAt
                    ? `Local cache saved at ${new Date(idbSavedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`
                    : 'Workouts are cached locally in your browser for instant load.'}
                  {onRebuildPersistedArchive && persistedWorkoutCount > 0 && (
                    <button
                      type="button"
                      onClick={onRebuildPersistedArchive}
                      disabled={isSyncing}
                      className="ml-2 font-semibold ap-text-brand hover:underline cursor-pointer"
                    >
                      Rebuild Local Cache
                    </button>
                  )}
                </div>
                <PWAInstallButton variant="compact" />
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
};
