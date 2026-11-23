import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  CaretDown,
  CheckCircle2,
  Copy,
  Database,
  Download,
  ExternalLink,
  Lightning,
  Lock,
  Map as MapIcon,
  RefreshCw,
  Shield,
  Sliders,
  Upload,
  X,
} from './icons/PhosphorIcons';
import {
  ConnectionStatus,
  MapTileProvider,
  StravaSyncPolicy,
  StravaSyncWindow,
  UnifiedActivity,
} from '../types';
import { useModalDialog } from '../hooks/useModalDialog';
import { PWAInstallButton } from './PWAInstallButton';
import {
  importWorkoutFilesOrArchive,
  type ArchiveImportProgress,
} from '../utils/archiveImporter';
import { downloadSupportDiagnosticsJson } from '../utils/supportDiagnostics';

type ExtendedConnectionStatus = ConnectionStatus & {
  wahooScope?: string;
  wahooCanPushWorkouts?: boolean;
  polarCanPushWorkouts?: boolean;
};

interface DataSourcesModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: ConnectionStatus;
  onConnectIntervals: (athleteId: string, apiKey: string) => Promise<void>;
  onLaunchIntervalsOAuth?: () => Promise<void>;
  onDisconnectIntervals: () => Promise<void>;
  onLaunchWahooOAuth?: () => Promise<void>;
  onDisconnectWahoo?: () => Promise<void>;
  onLaunchPolarOAuth?: () => Promise<void>;
  onDisconnectPolar?: () => Promise<void>;
  onLaunchGarminOAuth?: () => Promise<void>;
  onDisconnectGarmin?: () => Promise<void>;
  onLaunchCorosOAuth?: () => Promise<void>;
  onDisconnectCoros?: () => Promise<void>;
  onDisconnectStrava?: () => void;
  hasStandaloneAccount?: boolean;
  onUpdateStravaSyncPolicy?: (
    windowChoice: StravaSyncWindow,
    importProfileAndGear?: boolean
  ) => Promise<StravaSyncPolicy | null>;
  onSaveStravaCredentials: (clientId: string, clientSecret: string) => Promise<void>;
  onLaunchStravaOAuth: (mode?: 'cloud' | 'localhost') => Promise<void>;
  onExchangeStravaCode: (codeOrUrl: string) => Promise<void>;
  onSaveStravaDirectToken: (refreshToken: string, accessToken?: string) => Promise<void>;
  onSaveMapTileConfig: (provider: MapTileProvider, apiKey: string) => Promise<void>;
  onExportBundle: () => Promise<{ bundle: string; envText: string } | null>;
  onImportBundle: (bundleOrEnv: string) => Promise<void>;
  onSyncNow: (fullHistory?: boolean, explicitWindow?: StravaSyncWindow) => Promise<void>;
  isSyncing: boolean;
  errorMessage: string | null;
  idbSavedAt?: string | null;
  persistedWorkoutCount?: number;
  onRebuildPersistedArchive?: () => Promise<void>;
  existingActivities?: UnifiedActivity[];
  onImportBatchActivities?: (activities: UnifiedActivity[]) => void;
}

const SYNC_WINDOW_OPTIONS: Array<{ id: StravaSyncWindow; label: string; hint: string }> = [
  { id: '90d', label: 'Last 90 Days', hint: 'Fastest · Recommended' },
  { id: '180d', label: 'Last 6 Months', hint: 'Full season build' },
  { id: 'all', label: 'All-Time Archive', hint: 'Career PRs & gear' },
  { id: 'none', label: 'Identity Only', hint: 'Pause workout sync' },
];

export const DataSourcesModal: React.FC<DataSourcesModalProps> = ({
  isOpen,
  onClose,
  status,
  onConnectIntervals,
  onLaunchIntervalsOAuth,
  onDisconnectIntervals,
  onLaunchWahooOAuth,
  onDisconnectWahoo,
  onLaunchPolarOAuth,
  onDisconnectPolar,
  onLaunchGarminOAuth,
  onDisconnectGarmin,
  onLaunchCorosOAuth,
  onDisconnectCoros,
  onDisconnectStrava,
  hasStandaloneAccount = false,
  onUpdateStravaSyncPolicy,
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

  // Strava Sync Policy controls
  const [selectedSyncWindow, setSelectedSyncWindow] = useState<StravaSyncWindow>(
    status.stravaSyncPolicy?.window || '90d'
  );
  const [includeGearAndProfile, setIncludeGearAndProfile] = useState<boolean>(
    status.stravaSyncPolicy?.importProfileAndGear !== false
  );
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);

  // Intervals.icu
  const [athleteId, setAthleteId] = useState(status.intervalsAthleteId || '0');
  const [intervalsKey, setIntervalsKey] = useState('');

  // Strava custom keys / token fallback (only shown when server Strava OAuth is unconfigured)
  const [stravaClientId, setStravaClientId] = useState(status.stravaClientId || '');
  const [stravaClientSecret, setStravaClientSecret] = useState('');
  const [stravaFallbackInput, setStravaFallbackInput] = useState('');

  // Garmin Connect (Official Partner OAuth 2.0 PKCE + Read-Only Personal API Key)
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
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false);

  useEffect(() => {
    if (status.stravaSyncPolicy?.window) {
      setSelectedSyncWindow(status.stravaSyncPolicy.window);
    }
    if (typeof status.stravaSyncPolicy?.importProfileAndGear === 'boolean') {
      setIncludeGearAndProfile(status.stravaSyncPolicy.importProfileAndGear);
    }
  }, [status.stravaSyncPolicy?.window, status.stravaSyncPolicy?.importProfileAndGear]);

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

  const dialogRef = useRef<HTMLDivElement | null>(null);

  useModalDialog({
    isOpen,
    onClose,
    dialogRef,
  });

  if (!isOpen) return null;

  const activeDomainOnly = status.currentOriginCallbackUrl
    .replace(/^https?:\/\//, '')
    .split('/')[0];

  const isGarminConnected = Boolean(
    status.garminConnected ||
      (() => {
        try {
          return typeof localStorage !== 'undefined'
            ? localStorage.getItem('aeropulse_garmin_personal_api_key')
            : null;
        } catch {
          return null;
        }
      })()
  );

  const stravaServerUnconfigured = status.stravaConfigured === false;
  const missingActivityScope =
    Boolean(status.stravaGrantedScope) &&
    !String(status.stravaGrantedScope).includes('activity:read');

  const extStatus = status as ExtendedConnectionStatus;
  const wahooScopeTokens = String(extStatus.wahooScope || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const wahooCanPushWorkouts = Boolean(
    extStatus.wahooCanPushWorkouts ||
      wahooScopeTokens.includes('workouts_write') ||
      wahooScopeTokens.includes('plans_write')
  );

  const totalWorkouts = persistedWorkoutCount || status.totalActivitiesCount || 0;

  const buildAuthHeaders = (): Record<string, string> => ({
    'Content-Type': 'application/json',
  });

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedLabel(label);
    window.setTimeout(() => setCopiedLabel(null), 2000);
  };

  const handleSaveSyncPolicy = async (
    nextWindow: StravaSyncWindow,
    nextIncludeGear: boolean
  ) => {
    setSelectedSyncWindow(nextWindow);
    setIncludeGearAndProfile(nextIncludeGear);
    setIsSavingPolicy(true);
    setLocalStatusMsg(null);
    try {
      if (onUpdateStravaSyncPolicy) {
        await onUpdateStravaSyncPolicy(nextWindow, nextIncludeGear);
      } else {
        await fetch('/api/strava/sync-policy', {
          method: 'POST',
          credentials: 'include',
          headers: buildAuthHeaders(),
          body: JSON.stringify({
            window: nextWindow,
            includeGearAndProfile: nextIncludeGear,
          }),
        });
        if (nextWindow !== 'none') {
          void onSyncNow(nextWindow === 'all', nextWindow);
        }
      }
      setLocalStatusMsg(
        nextWindow === 'none'
          ? 'Strava set to Identity Only — workout syncing paused.'
          : `Strava sync window updated (${
              SYNC_WINDOW_OPTIONS.find((o) => o.id === nextWindow)?.label || nextWindow
            }).`
      );
    } finally {
      setIsSavingPolicy(false);
    }
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
    setLocalStatusMsg('Strava API keys saved. Opening Strava authorization...');
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
    setLocalStatusMsg('Strava connected!');
  };

  const handleGarminTokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!garminPersonalApiKey.trim()) return;
    setIsConnectingGarmin(true);
    setLocalStatusMsg(null);
    try {
      const resp = await fetch('/api/config/garmin', {
        method: 'POST',
        credentials: 'include',
        headers: buildAuthHeaders(),
        body: JSON.stringify({
          personalApiKey: garminPersonalApiKey.trim(),
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setLocalStatusMsg(data.error || 'Could not verify Garmin token.');
      } else {
        localStorage.setItem('aeropulse_garmin_personal_api_key', garminPersonalApiKey.trim());
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

  const handleDisconnectGarminClick = async () => {
    if (onDisconnectGarmin) {
      await onDisconnectGarmin();
    } else {
      await fetch('/api/garmin/disconnect', {
        method: 'POST',
        credentials: 'include',
        headers: buildAuthHeaders(),
      }).catch(() => null);
      localStorage.removeItem('aeropulse_garmin_personal_api_key');
      localStorage.removeItem('aeropulse_garmin_bearer_token');
      localStorage.removeItem('aeropulse_garmin_oauth1_token');
      localStorage.removeItem('aeropulse_garmin_oauth1_secret');
      localStorage.removeItem('aeropulse_garmin_athlete_name');
    }
    setGarminPersonalApiKey('');
    setLocalStatusMsg('Garmin Connect disconnected (Strava sign-in remains active).');
  };

  const handleIntervalsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalStatusMsg(null);
    try {
      await onConnectIntervals(athleteId.trim() || '0', intervalsKey.trim());
      setIntervalsKey('');
      setLocalStatusMsg('Intervals.icu connected! Syncing wellness & structured plans...');
    } catch {
      // error surfaced via errorMessage
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ap-obsidian/82 p-3 sm:p-6 overflow-y-auto"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="thresh-data-sources-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl ap-content-stage overflow-hidden my-auto"
      >
        {/* Clean Header */}
        <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-stone-200/80 dark:border-ap-edge bg-[#FAF8F4] dark:bg-ap-carbon">
          <div>
            <h2
              id="thresh-data-sources-title"
              className="text-lg font-bold text-slate-900 dark:text-slate-100"
            >
              Identity, Sync Window &amp; Optional Add-Ons
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              {totalWorkouts > 0
                ? `${totalWorkouts.toLocaleString()} workouts synced${
                    status.lastSyncedAt
                      ? ` · Updated ${new Date(status.lastSyncedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}`
                      : ''
                  }`
                : 'MeetReady account active · Strava, Garmin & Intervals.icu are optional data connectors'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                onSyncNow(
                  selectedSyncWindow === 'all',
                  selectedSyncWindow === 'none' ? '90d' : selectedSyncWindow
                )
              }
              disabled={isSyncing}
              className="ap-btn-primary !min-h-[44px] !px-3.5 !py-1.5 text-xs cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl liquid-glass-subtle text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
              aria-label="Close Data Sources modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Simplified Body */}
        <div className="p-5 sm:p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {errorMessage && (
            <div role="alert" className="ap-status-strained rounded-xl px-4 py-3 text-xs">
              {errorMessage}
            </div>
          )}
          {localStatusMsg && (
            <div
              role="status"
              aria-live="polite"
              className="ap-status-prime rounded-xl px-4 py-3 text-xs"
            >
              {localStatusMsg}
            </div>
          )}

          {/* 1. STRAVA — IDENTITY & PRIMARY WORKOUT SYNC */}
          <section className="liquid-glass rounded-2xl p-4 sm:p-5 space-y-4 border border-[#FC4C02]/30">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Strava</h3>
                  <span className="px-2 py-0.5 rounded-md text-2xs font-mono font-bold uppercase tracking-wider bg-[#C23800]/12 dark:bg-[#FC4C02]/15 ap-text-strava border border-[#C23800]/30 dark:border-[#FC4C02]/35">
                    Data Connector
                  </span>
                  {status.stravaConnected ? (
                    <span className="ap-status-prime px-2 py-0.5 rounded-md text-2xs font-mono font-semibold">
                      Connected{status.stravaAthleteName ? ` · ${status.stravaAthleteName}` : ''}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md text-2xs font-mono bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                      Not Connected
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Full-archive telemetry connector. Syncs all Strava activity types (runs, rides, swims, hikes, rowing, strength, HIIT &amp; cross-training) with sport-accurate TSS.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onLaunchStravaOAuth('cloud')}
                  disabled={isSyncing}
                  className="ap-btn-strava !min-h-[44px] sm:!min-h-[40px] rounded-xl px-3.5 py-2 text-xs font-bold cursor-pointer"
                >
                  <Activity className="w-4 h-4" />
                  <span>{status.stravaConnected ? 'Switch / Re-Auth' : 'Connect with Strava'}</span>
                </button>
                {status.stravaConnected && onDisconnectStrava && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onDisconnectStrava();
                    }}
                    className="min-h-[44px] sm:min-h-[40px] px-3 py-2 rounded-xl liquid-glass-subtle text-xs font-semibold text-rose-600 dark:text-rose-300 hover:bg-rose-500/10 cursor-pointer"
                  >
                    {hasStandaloneAccount ? 'Disconnect Strava' : 'Sign Out'}
                  </button>
                )}
              </div>
            </div>

            {status.stravaConnected && missingActivityScope && (
              <div className="rounded-xl ap-status-caution p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span>
                  Strava activity permission was unchecked during sign-in. Re-authorize to sync workouts.
                </span>
                <button
                  type="button"
                  onClick={() => onLaunchStravaOAuth('cloud')}
                  className="ap-btn-strava !min-h-[44px] sm:!min-h-[36px] px-3 py-1.5 rounded-lg font-semibold text-xs cursor-pointer"
                >
                  Grant Activity Read Access
                </button>
              </div>
            )}

            {status.stravaConnected && (
              <div className="space-y-2.5 pt-2 border-t border-slate-200/80 dark:border-white/10">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    Strava Workout Sync Window
                  </span>
                  {isSavingPolicy && (
                    <span className="text-2xs font-mono ap-text-brand">Saving…</span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {SYNC_WINDOW_OPTIONS.map((opt) => {
                    const active = selectedSyncWindow === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={isSavingPolicy || isSyncing}
                        onClick={() => handleSaveSyncPolicy(opt.id, includeGearAndProfile)}
                        className={`text-left rounded-xl p-2.5 border transition-all cursor-pointer ${
                          active
                            ? 'border-ap-clay dark:border-ap-volt bg-ap-clay/8 dark:bg-ap-volt/10'
                            : 'border-stone-200 dark:border-white/10 hover:border-ap-clay/60 dark:hover:border-ap-volt/60'
                        }`}
                      >
                        <div className="text-xs font-bold text-slate-900 dark:text-white">
                          {opt.label}
                        </div>
                        <div className="text-2xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                          {opt.hint}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={includeGearAndProfile}
                    onChange={(e) =>
                      handleSaveSyncPolicy(selectedSyncWindow, e.target.checked)
                    }
                    className="rounded border-slate-400 accent-[#B83A24] dark:accent-[#D8FF2A]"
                  />
                  <span>Sync Strava shoe/bike mileage &amp; profile FTP / weight</span>
                </label>
              </div>
            )}

            <div className="rounded-xl ap-card-inset px-3 py-2 flex items-center gap-2 text-2xs text-ap-ink dark:text-ap-chalk">
              <Lock className="w-3.5 h-3.5 ap-text-brand shrink-0" />
              <span>
                <strong>Read-Only Pledge:</strong> MeetReady never posts to your Strava feed, edits activity titles, or sends kudos without you clicking it.
              </span>
            </div>

            {stravaServerUnconfigured && (
              <details
                open
                className="pt-2 border-t border-slate-200/80 dark:border-white/10 text-xs"
              >
                <summary className="cursor-pointer font-semibold text-amber-700 dark:text-amber-300 select-none py-1">
                  Self-Hosted Setup: Configure Strava Client ID &amp; Secret
                </summary>
                <div className="mt-3 space-y-3 rounded-xl liquid-glass-subtle p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-2xs">
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
                          <CheckCircle2 className="w-3.5 h-3.5 ap-ink-emerald" />
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

                  <form
                    onSubmit={handleStravaKeysAndLaunch}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2"
                  >
                    <input
                      type="text"
                      aria-label="Strava Client ID"
                      value={stravaClientId}
                      onChange={(e) => setStravaClientId(e.target.value)}
                      placeholder="Client ID"
                      className="sm:col-span-4 min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                    />
                    <input
                      type="password"
                      aria-label="Strava Client Secret"
                      value={stravaClientSecret}
                      onChange={(e) => setStravaClientSecret(e.target.value)}
                      placeholder="Client Secret"
                      className="sm:col-span-5 min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="submit"
                      className="sm:col-span-3 min-h-[44px] sm:min-h-[40px] rounded-lg bg-ap-obsidian hover:bg-ap-turf border border-[#FC4C02]/60 text-white font-semibold text-xs px-3 cursor-pointer"
                    >
                      Save &amp; Connect
                    </button>
                  </form>

                  <form
                    onSubmit={handleStravaFallbackSubmit}
                    className="flex gap-2 pt-2 border-t border-slate-200/70 dark:border-white/10"
                  >
                    <input
                      type="password"
                      aria-label="Strava refresh token or redirect URL"
                      value={stravaFallbackInput}
                      onChange={(e) => setStravaFallbackInput(e.target.value)}
                      placeholder="Or paste Strava Refresh Token / redirect URL..."
                      className="flex-1 min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-3 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="submit"
                      disabled={!stravaFallbackInput.trim()}
                      className="ap-btn-secondary !min-h-[44px] sm:!min-h-[40px] text-xs cursor-pointer disabled:opacity-50"
                    >
                      Verify Token
                    </button>
                  </form>
                </div>
              </details>
            )}
          </section>

          {/* 2. GARMIN CONNECT (OFFICIAL PARTNER OAUTH 2.0 PKCE + READ-ONLY PERSONAL API KEY) */}
          <details
            open={isGarminConnected}
            className="liquid-glass rounded-2xl p-4 sm:p-5 group"
          >
            <summary className="cursor-pointer list-none flex flex-wrap items-center justify-between gap-3 select-none">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Garmin Connect
                  </h3>
                  {isGarminConnected ? (
                    <span className="ap-status-prime px-2 py-0.5 rounded-md text-2xs font-mono font-semibold">
                      Connected
                      {status.garminAthleteName ? ` · ${status.garminAthleteName}` : ''}
                      {status.garminCanPushWorkouts ? ' · 2-Way Watch Push' : ' · Read-Only Sync'}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md text-2xs font-mono bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                      Optional Add-On
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Adds overnight Sleep Score, HRV (rMSSD), Resting HR, and Official Partner OAuth 2.0 PKCE watch workout push.
                </p>
              </div>
              <span className="text-xs font-semibold ap-text-brand">
                {isGarminConnected ? 'Manage' : '+ Connect'}
              </span>
            </summary>

            <div className="mt-4 pt-3 border-t border-slate-200/80 dark:border-white/10 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {onLaunchGarminOAuth && (
                  <button
                    type="button"
                    data-testid="garmin-partner-oauth-btn"
                    onClick={() => onLaunchGarminOAuth?.()}
                    className="flex-1 min-w-[220px] ap-btn-primary min-h-[44px] flex items-center justify-center gap-2 font-semibold text-xs cursor-pointer shadow-sm"
                  >
                    <Lightning className="w-4 h-4 text-current" />
                    <span>
                      {status.garminAuthMethod === 'OAUTH'
                        ? 'Re-Authorize Garmin Partner (OAuth 2.0 PKCE)'
                        : '1-Click Connect with Garmin Partner (OAuth 2.0 PKCE)'}
                    </span>
                  </button>
                )}

                {isGarminConnected && (
                  <button
                    type="button"
                    onClick={handleDisconnectGarminClick}
                    className="ap-btn-secondary !min-h-[44px] text-xs cursor-pointer"
                  >
                    Disconnect Garmin
                  </button>
                )}
              </div>

              {status.garminConfigured === false && (
                <p className="text-2xs rounded-lg ap-status-caution px-3 py-2">
                  Official Garmin Health &amp; Training Partner OAuth keys are pending configuration on this server. Connect a read-only Personal API Key (<code className="font-mono">GCDC_...</code>), use <strong>Intervals.icu Cross-Watch Bridge</strong>, or download <code className="font-mono">.FIT</code> workout files.
                </p>
              )}

              <details
                open={status.garminAuthMethod === 'PERSONAL_KEY'}
                className="text-2xs text-slate-600 dark:text-slate-300"
              >
                <summary className="cursor-pointer font-semibold hover:text-slate-900 dark:hover:text-white select-none py-1">
                  Read-Only Biometrics Option: Garmin Personal API Token (GCDC_...)
                </summary>
                <div className="pt-2 space-y-2">
                  <form
                    onSubmit={handleGarminTokenSubmit}
                    className="flex flex-wrap sm:flex-nowrap gap-2"
                  >
                    <input
                      type="password"
                      aria-label="Garmin personal API token"
                      autoComplete="off"
                      value={garminPersonalApiKey}
                      onChange={(e) => setGarminPersonalApiKey(e.target.value)}
                      placeholder="Paste Garmin Personal API Token (GCDC_...)"
                      className="flex-1 min-w-[200px] min-h-[44px] rounded-xl border border-slate-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="submit"
                      disabled={isConnectingGarmin || !garminPersonalApiKey.trim()}
                      className="ap-btn-secondary !min-h-[44px] text-xs cursor-pointer disabled:opacity-50"
                    >
                      {isConnectingGarmin ? 'Verifying...' : 'Verify Token'}
                    </button>
                  </form>
                  <p className="text-2xs text-slate-500 dark:text-slate-400">
                    Personal API Keys (<code className="font-mono">GCDC_...</code>) are strictly read-only per Garmin policy. Use Official Garmin Partner OAuth, Intervals.icu Bridge, or <code className="font-mono">.FIT</code> export to send workouts to your watch.
                  </p>
                </div>
              </details>
            </div>
          </details>

          {/* 3. INTERVALS.ICU (OPTIONAL SECONDARY STRUCTURED WORKOUTS & CROSS-WATCH BRIDGE) */}
          <details
            open={status.intervalsConnected}
            className="liquid-glass rounded-2xl p-4 sm:p-5 group"
          >
            <summary className="cursor-pointer list-none flex flex-wrap items-center justify-between gap-3 select-none">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Intervals.icu
                  </h3>
                  {status.intervalsConnected ? (
                    <span className="ap-status-prime px-2 py-0.5 rounded-md text-2xs font-mono font-semibold">
                      Connected
                      {status.intervalsAthleteName ? ` · ${status.intervalsAthleteName}` : ''}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md text-2xs font-mono bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                      Optional Add-On
                    </span>
                  )}
                  {status.intervalsConnected && status.intervalsCanWriteCalendar && (
                    <span
                      data-testid="intervals-cross-watch-bridge-badge"
                      className="px-2 py-0.5 rounded-md text-2xs font-mono font-semibold bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25"
                    >
                      Cross-Watch Bridge · Garmin / COROS / Suunto / Wahoo (CALENDAR:WRITE)
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Syncs structured workout calendars, Intervals.icu-relayed devices (COROS / Suunto / Apple Watch / Oura / WHOOP), and pushes workouts to linked watches via <code className="font-mono">CALENDAR:WRITE</code>.
                </p>
              </div>
              <span className="text-xs font-semibold ap-text-brand">
                {status.intervalsConnected ? 'Manage' : '+ Connect'}
              </span>
            </summary>

            <div className="mt-4 pt-3 border-t border-slate-200/80 dark:border-white/10 space-y-3">
              {status.intervalsConnected ? (
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3.5 rounded-xl ap-card-inset text-xs">
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <span>
                          Connected via{' '}
                          {status.intervalsAuthMethod === 'OAUTH'
                            ? 'OAuth 2.0'
                            : 'Personal API Key'}
                        </span>
                      </div>
                      <p className="text-2xs text-slate-600 dark:text-slate-300 mt-0.5">
                        Athlete ID: {status.intervalsAthleteId}
                        {status.intervalsAthleteName
                          ? ` · ${status.intervalsAthleteName}`
                          : ''}
                        {status.intervalsScope ? ` · Scope: ${status.intervalsScope}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={onDisconnectIntervals}
                      className="ap-btn-secondary !min-h-[38px] !px-3 text-xs cursor-pointer text-rose-600 dark:text-rose-300"
                    >
                      Disconnect
                    </button>
                  </div>

                  {status.intervalsAuthMethod === 'OAUTH' &&
                    !status.intervalsCanWriteCalendar &&
                    onLaunchIntervalsOAuth && (
                      <div className="rounded-xl ap-status-caution p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span>
                          Connected with read-only calendar scope. Upgrade to{' '}
                          <code className="font-mono">CALENDAR:WRITE</code> to relay workouts to Garmin, COROS, Suunto &amp; Wahoo watches.
                        </span>
                        <button
                          type="button"
                          data-testid="intervals-upgrade-scope-btn"
                          onClick={() => onLaunchIntervalsOAuth?.()}
                          className="ap-btn-primary !min-h-[38px] px-3 py-1.5 rounded-lg font-semibold text-xs cursor-pointer"
                        >
                          Upgrade Scope to Watch Push
                        </button>
                      </div>
                    )}
                </div>
              ) : (
                <div className="space-y-3">
                  {onLaunchIntervalsOAuth && (
                    <button
                      type="button"
                      onClick={() => onLaunchIntervalsOAuth?.()}
                      className="w-full ap-btn-primary min-h-[44px] flex items-center justify-center gap-2 font-semibold text-xs cursor-pointer shadow-sm"
                    >
                      <Lightning className="w-4 h-4 text-current" />
                      <span>1-Click Connect with Intervals.icu (OAuth 2.0)</span>
                    </button>
                  )}

                  <details className="text-2xs text-slate-500 dark:text-slate-400 group/api">
                    <summary className="cursor-pointer hover:text-slate-700 dark:hover:text-slate-200 select-none py-1">
                      Power-User Option: Connect via Personal API Key
                    </summary>
                    <div className="pt-2 space-y-2">
                      <div className="flex items-center justify-between text-2xs">
                        <span>Find your Developer API Key at intervals.icu/settings</span>
                        <a
                          href="https://intervals.icu/settings"
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-semibold ap-text-brand hover:underline whitespace-nowrap"
                        >
                          <span>Get API Key</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>

                      <form
                        onSubmit={handleIntervalsSubmit}
                        className="grid grid-cols-1 sm:grid-cols-12 gap-2"
                      >
                        <input
                          type="text"
                          aria-label="Intervals.icu Athlete ID"
                          value={athleteId}
                          onChange={(e) => setAthleteId(e.target.value)}
                          placeholder="Athlete ID (0 for self)"
                          className="sm:col-span-3 min-h-[44px] rounded-xl border border-slate-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                        />
                        <input
                          type="password"
                          aria-label="Intervals.icu API Key"
                          value={intervalsKey}
                          onChange={(e) => setIntervalsKey(e.target.value)}
                          placeholder="Paste Intervals.icu API Key"
                          className="sm:col-span-6 min-h-[44px] rounded-xl border border-slate-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                        />
                        <div className="sm:col-span-3 flex gap-2">
                          <button
                            type="submit"
                            disabled={!intervalsKey.trim()}
                            className="flex-1 ap-btn-primary !min-h-[44px] text-xs cursor-pointer disabled:opacity-50"
                          >
                            Connect
                          </button>
                        </div>
                      </form>
                    </div>
                  </details>
                </div>
              )}
            </div>
          </details>

          {/* 3b. WAHOO CLOUD API (ELEMNT, KICKR & MULTI-SPORT SYNC) */}
          <details
            open={status.wahooConnected}
            className="group rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 p-4 transition-all"
          >
            <summary className="flex items-center justify-between cursor-pointer list-none">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center font-bold text-xs">
                  W
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Wahoo Cloud API
                    </h4>
                    {status.wahooConnected ? (
                      <>
                        <span className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full ap-status-prime font-medium">
                          <CheckCircle2 className="w-3 h-3" /> Connected
                        </span>
                        <span
                          data-testid="wahoo-push-capability-badge"
                          className={`text-2xs px-2 py-0.5 rounded-md font-mono font-semibold ${
                            wahooCanPushWorkouts
                              ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25'
                              : 'ap-status-caution'
                          }`}
                        >
                          {wahooCanPushWorkouts
                            ? '2-Way Workout Push'
                            : 'Read-Only (Reconnect to Push)'}
                        </span>
                      </>
                    ) : (
                      <span className="text-2xs px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        Optional
                      </span>
                    )}
                  </div>
                  <p className="text-2xs text-slate-500 dark:text-slate-400">
                    Syncs ELEMNT GPS bike computer rides, KICKR trainer sessions &amp; FIT files
                  </p>
                </div>
              </div>
              <CaretDown className="w-4 h-4 text-slate-600 dark:text-slate-400 group-open:rotate-180 transition-transform" />
            </summary>

            <div className="mt-4 pt-4 border-t border-slate-200/60 dark:border-slate-800/60 space-y-3">
              {status.wahooConnected ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between p-3 rounded-xl bg-sky-500/5 border border-sky-500/20 text-xs">
                    <div>
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {status.wahooAthleteName || 'Wahoo Athlete'}
                      </span>
                      {status.wahooAthleteId && (
                        <span className="text-2xs text-slate-500 ml-2 font-mono">
                          ID: {status.wahooAthleteId}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onDisconnectWahoo?.()}
                      className="text-xs text-rose-600 dark:text-rose-300 hover:underline font-medium cursor-pointer"
                    >
                      Disconnect
                    </button>
                  </div>
                  {!wahooCanPushWorkouts && (
                    <div className="rounded-xl ap-status-caution p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span>
                        Wahoo is currently connected with read-only sync. Reconnect with{' '}
                        <code className="font-mono">workouts_write</code> &amp;{' '}
                        <code className="font-mono">plans_write</code> permissions to push structured workouts to your ELEMNT.
                      </span>
                      <button
                        type="button"
                        data-testid="wahoo-upgrade-permissions-btn"
                        disabled={!onLaunchWahooOAuth}
                        onClick={() => onLaunchWahooOAuth?.()}
                        className="ap-btn-primary !min-h-[38px] px-3 py-1.5 rounded-lg font-semibold text-xs cursor-pointer disabled:opacity-50"
                      >
                        Upgrade Wahoo Permissions
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {onLaunchWahooOAuth && (
                    <button
                      type="button"
                      onClick={() => onLaunchWahooOAuth?.()}
                      className="w-full ap-btn-primary min-h-[44px] flex items-center justify-center gap-2 font-semibold text-xs cursor-pointer shadow-sm"
                    >
                      <Lightning className="w-4 h-4 text-current" />
                      <span>1-Click Connect with Wahoo (OAuth 2.0 / PKCE)</span>
                    </button>
                  )}
                  <p className="text-2xs text-slate-500 dark:text-slate-400">
                    Direct integration with Wahoo Cloud via OAuth 2.0 and PKCE. Automatically imports .FIT workout binaries with smart ±5-minute deduplication against Strava and Garmin.
                  </p>
                </div>
              )}
            </div>
          </details>

          {/* 3c. POLAR ACCESSLINK (GRIT, VANTAGE, PACER & RUNNING DYNAMICS) */}
          <details
            open={status.polarConnected}
            className="group rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 p-4 transition-all"
          >
            <summary className="flex items-center justify-between cursor-pointer list-none">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold text-xs">
                  P
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Polar AccessLink
                    </h4>
                    {status.polarConnected ? (
                      <span className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full ap-status-prime font-medium">
                        <CheckCircle2 className="w-3 h-3" /> Connected
                      </span>
                    ) : (
                      <span className="text-2xs px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        Optional
                      </span>
                    )}
                    <span
                      data-testid="polar-capability-badge"
                      className="text-2xs px-2 py-0.5 rounded-md font-mono font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300/70 dark:border-slate-700"
                    >
                      Read-Only Sync (Use .FIT Export or Intervals.icu Bridge)
                    </span>
                  </div>
                  <p className="text-2xs text-slate-500 dark:text-slate-400">
                    Syncs Grit X, Vantage, Pacer watches, H10/Verity HR monitors &amp; running load (read-only API; push structured workouts via .FIT Export or Intervals.icu Bridge)
                  </p>
                </div>
              </div>
              <CaretDown className="w-4 h-4 text-slate-600 dark:text-slate-400 group-open:rotate-180 transition-transform" />
            </summary>

            <div className="mt-4 pt-4 border-t border-slate-200/60 dark:border-slate-800/60 space-y-3">
              {status.polarConnected ? (
                <div className="flex items-center justify-between p-3 rounded-xl bg-rose-500/5 border border-rose-500/20 text-xs">
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {status.polarAthleteName || 'Polar Athlete'}
                    </span>
                    {status.polarAthleteId && (
                      <span className="text-2xs text-slate-500 ml-2 font-mono">
                        ID: {status.polarAthleteId}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onDisconnectPolar?.()}
                    className="text-xs text-rose-500 hover:text-rose-600 font-medium cursor-pointer"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {onLaunchPolarOAuth && (
                    <button
                      type="button"
                      onClick={() => onLaunchPolarOAuth?.()}
                      className="w-full ap-btn-primary min-h-[44px] flex items-center justify-center gap-2 font-semibold text-xs cursor-pointer shadow-sm"
                    >
                      <Lightning className="w-4 h-4 text-current" />
                      <span>1-Click Connect with Polar (OAuth 2.0)</span>
                    </button>
                  )}
                  <p className="text-2xs text-slate-500 dark:text-slate-400">
                    Direct integration with Polar AccessLink via OAuth 2.0. Automatically imports exercise sessions, heart-rate zones, and calculated rTSS with smart ±5-minute deduplication against Strava and Garmin.
                  </p>
                </div>
              )}
            </div>
          </details>

          {/* 3d. COROS OPEN API (PACE, APEX, VERTIX & DURA) */}
          <details
            open={status.corosConnected}
            className="group rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 p-4 transition-all"
          >
            <summary className="flex items-center justify-between cursor-pointer list-none">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-orange-500/10 text-orange-700 dark:text-orange-300 flex items-center justify-center font-bold text-xs">
                  C
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                      COROS Open API
                    </h4>
                    {status.corosConnected ? (
                      <span className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full ap-status-prime font-medium">
                        <CheckCircle2 className="w-3 h-3" /> Connected
                      </span>
                    ) : (
                      <span className="text-2xs px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                        Optional
                      </span>
                    )}
                  </div>
                  <p className="text-2xs text-slate-600 dark:text-slate-300">
                    2-way workout sync &amp; structured track/run push for PACE, APEX, VERTIX &amp; DURA
                  </p>
                </div>
              </div>
              <CaretDown className="w-4 h-4 text-slate-600 dark:text-slate-400 group-open:rotate-180 transition-transform" />
            </summary>

            <div className="mt-4 pt-4 border-t border-slate-200/60 dark:border-slate-800/60 space-y-3">
              {status.corosConnected ? (
                <div className="flex items-center justify-between p-3 rounded-xl bg-orange-500/5 border border-orange-500/20 text-xs">
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {status.corosAthleteName || 'COROS Athlete'}
                    </span>
                    {status.corosAthleteId && (
                      <span className="text-2xs text-slate-600 dark:text-slate-300 ml-2 font-mono">
                        ID: {status.corosAthleteId}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onDisconnectCoros?.()}
                    className="text-xs text-rose-600 dark:text-rose-300 hover:underline font-medium cursor-pointer"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {onLaunchCorosOAuth && (
                    <button
                      type="button"
                      data-testid="coros-oauth-btn"
                      onClick={() => onLaunchCorosOAuth?.()}
                      className="w-full ap-btn-primary min-h-[44px] flex items-center justify-center gap-2 font-semibold text-xs cursor-pointer shadow-sm"
                    >
                      <Lightning className="w-4 h-4 text-current" />
                      <span>1-Click Connect with COROS (OAuth 2.0)</span>
                    </button>
                  )}
                  {status.corosConfigured === false && (
                    <p className="text-2xs rounded-lg ap-status-caution px-3 py-2">
                      COROS Open API partner credentials are pending on this server. Connect <strong>Intervals.icu</strong> (<code className="font-mono">CALENDAR:WRITE</code>) to relay structured workouts to your COROS watch automatically.
                    </p>
                  )}
                  <p className="text-2xs text-slate-600 dark:text-slate-300">
                    Direct integration with COROS Open API via OAuth 2.0. Automatically syncs runs, tracks structured repeats, and pushes scheduled workouts to your COROS Training Calendar.
                  </p>
                </div>
              )}
            </div>
          </details>

          {/* SUUNTO & CROSS-WATCH BRIDGE NOTE */}
          <div
            data-testid="suunto-intervals-bridge-note"
            className="rounded-xl liquid-glass-subtle px-3.5 py-2.5 flex items-center gap-2.5 text-2xs text-slate-600 dark:text-slate-300"
          >
            <RefreshCw className="w-4 h-4 ap-text-brand shrink-0" />
            <span>
              <strong>Suunto &amp; Polar Structured Workout Relay (Intervals.icu Bridge):</strong> Connect <strong>Suunto</strong> watches (or read-only Polar devices) through <strong>Intervals.icu</strong> (<code className="font-mono">CALENDAR:WRITE</code>) above to push scheduled workouts automatically, or use 1-click <code className="font-mono">.FIT</code> workout export.
            </span>
          </div>

          {/* SMART DEDUPLICATION ASSURANCE */}
          <div className="rounded-xl liquid-glass-subtle px-3.5 py-2.5 flex items-center gap-2.5 text-2xs text-slate-600 dark:text-slate-300">
            <Shield className="w-4 h-4 ap-text-brand shrink-0" />
            <span>
              <strong>Smart Multi-Source Deduplication:</strong> Connecting Garmin, COROS, Intervals.icu, Wahoo, or Polar alongside Strava never double-counts workouts—matching activities are automatically merged into a single record with all badges.
            </span>
          </div>

          {/* 4. DIRECT FILE UPLOAD (.FIT / .GPX / .TCX / .ZIP) */}
          {onImportBatchActivities && (
            <section className="liquid-glass rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Upload Workout Files (.FIT, .GPX, .TCX, or .ZIP)
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    Import single workout files or a full Garmin / Strava export{' '}
                    <code className="font-mono">.zip</code> directly in your browser.
                  </p>
                </div>
                <label className="ap-btn-secondary !min-h-[44px] sm:!min-h-[40px] text-xs cursor-pointer whitespace-nowrap">
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
                      className="h-full bg-ap-clay dark:bg-ap-volt transition-all duration-150"
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
                    aria-label="Activity map tile provider"
                    value={mapTileProvider}
                    onChange={(e) => setMapTileProvider(e.target.value as MapTileProvider)}
                    className="sm:col-span-4 min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="OSM_KEYLESS">OpenStreetMap (Free / No Key)</option>
                    <option value="MAPBOX">Mapbox High-DPI</option>
                    <option value="THUNDERFOREST">OpenCycleMap / Thunderforest</option>
                  </select>
                  <input
                    type="password"
                    aria-label="Optional Mapbox or Thunderforest API key"
                    value={mapTileApiKey}
                    onChange={(e) => {
                      const val = e.target.value;
                      setMapTileApiKey(val);
                      if (val.trim().startsWith('pk.')) setMapTileProvider('MAPBOX');
                    }}
                    placeholder="Optional Mapbox (pk.ey...) or Thunderforest key"
                    className="sm:col-span-5 min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="submit"
                    className="sm:col-span-3 ap-btn-secondary !min-h-[44px] sm:!min-h-[40px] text-xs cursor-pointer"
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
                    <span>Transfer Optional Keys to Another Browser</span>
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
                    className="ap-btn-secondary !min-h-[44px] sm:!min-h-[40px] text-xs cursor-pointer"
                  >
                    {copiedLabel === 'bundle' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 ap-ink-emerald" />
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
                    aria-label="Connection bundle string to restore"
                    value={bundleInput}
                    onChange={(e) => setBundleInput(e.target.value)}
                    placeholder="Paste Connection Bundle here to restore optional keys..."
                    className="flex-1 min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-3 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="submit"
                    disabled={isSyncing || !bundleInput.trim()}
                    className="ap-btn-secondary !min-h-[44px] sm:!min-h-[40px] text-xs cursor-pointer disabled:opacity-50"
                  >
                    Restore
                  </button>
                </form>
              </div>

              {/* Local Cache & PWA Install */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200/70 dark:border-white/10">
                <div className="text-2xs text-slate-500 dark:text-slate-400">
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

              {/* Support Diagnostics (Redacted / Zero PII) */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200/70 dark:border-white/10">
                <div className="space-y-0.5">
                  <div className="font-bold text-slate-900 dark:text-white">
                    Redacted Support Diagnostics
                  </div>
                  <p className="text-2xs text-slate-600 dark:text-slate-300">
                    Exports build version, offline outbox counts, service worker &amp; health status. Zero personal data, tokens, or workouts included.
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="data-sources-diagnostics-btn"
                  disabled={isExportingDiagnostics}
                  onClick={async () => {
                    setIsExportingDiagnostics(true);
                    setLocalStatusMsg(null);
                    try {
                      const res = await downloadSupportDiagnosticsJson({
                        source: 'data-sources-modal',
                        persistedWorkoutCount,
                        idbSavedAt,
                        connectionStatus: extStatus,
                      });
                      setLocalStatusMsg(
                        res.downloaded
                          ? `Downloaded redacted diagnostics (${res.filename}).`
                          : 'Generated redacted diagnostics snapshot.'
                      );
                    } finally {
                      setIsExportingDiagnostics(false);
                    }
                  }}
                  className="ap-btn-secondary !min-h-[44px] sm:!min-h-[40px] px-3.5 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>
                    {isExportingDiagnostics
                      ? 'Preparing Diagnostics…'
                      : 'Download Support Diagnostics'}
                  </span>
                </button>
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
};
