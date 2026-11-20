import React from 'react';
import {
  Check,
  ExternalLink,
  Lightning,
  RefreshCw,
  Upload,
} from '../icons/PhosphorIcons';
import type {
  ConnectionStatus,
  StravaSyncWindow,
  TeamSummaryWithRole,
  ThreshUser,
} from '../../types';
import type { FirstRunCalibrationPayload } from '../StravaAuthGate';

export interface AuthOptionalAddonsStepProps {
  formId: string;
  status: ConnectionStatus;
  localUser: ThreshUser | null;
  syncWindow: StravaSyncWindow;
  isSyncing?: boolean;
  isEntering: boolean;
  isGarminConnected: boolean;
  secondaryConnected: boolean;
  busy: boolean;
  claimedTeamsState: {
    teams: TeamSummaryWithRole[];
    activeTeamId?: string;
    sessionToken?: string;
    calibratedFtp?: number;
    calibratedPace?: string;
    safeSportEnforced?: boolean;
  } | null;
  expandGarmin: boolean;
  setExpandGarmin: React.Dispatch<React.SetStateAction<boolean>>;
  garminPersonalKey: string;
  setGarminPersonalKey: React.Dispatch<React.SetStateAction<string>>;
  isConnectingGarmin: boolean;
  expandIntervals: boolean;
  setExpandIntervals: React.Dispatch<React.SetStateAction<boolean>>;
  intervalsAthleteId: string;
  setIntervalsAthleteId: React.Dispatch<React.SetStateAction<string>>;
  intervalsApiKey: string;
  setIntervalsApiKey: React.Dispatch<React.SetStateAction<string>>;
  isConnectingIntervals: boolean;
  setStep: React.Dispatch<React.SetStateAction<1 | 2 | 3>>;
  onOpenArchiveWizard: () => void;
  onLaunchIntervalsOAuth?: () => Promise<void>;
  onLaunchWahooOAuth?: () => Promise<void>;
  onLaunchPolarOAuth?: () => Promise<void>;
  handleConnectGarminInline: (e: React.FormEvent) => Promise<void>;
  handleConnectIntervalsInline: (e: React.FormEvent) => Promise<void>;
  handleFinalizeOnboarding: (
    entryTarget?: FirstRunCalibrationPayload['entryTarget']
  ) => Promise<void>;
}

export const AuthOptionalAddonsStep: React.FC<AuthOptionalAddonsStepProps> = ({
  formId,
  status,
  localUser,
  syncWindow,
  isSyncing,
  isEntering,
  isGarminConnected,
  secondaryConnected,
  busy,
  claimedTeamsState,
  expandGarmin,
  setExpandGarmin,
  garminPersonalKey,
  setGarminPersonalKey,
  isConnectingGarmin,
  expandIntervals,
  setExpandIntervals,
  intervalsAthleteId,
  setIntervalsAthleteId,
  intervalsApiKey,
  setIntervalsApiKey,
  isConnectingIntervals,
  setStep,
  onOpenArchiveWizard,
  onLaunchIntervalsOAuth,
  onLaunchWahooOAuth,
  onLaunchPolarOAuth,
  handleConnectGarminInline,
  handleConnectIntervalsInline,
  handleFinalizeOnboarding,
}) => {
  return (
            <div className="space-y-5 relative z-10">
              <div className="space-y-1.5">
                {isSyncing && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-2xs font-mono ap-text-strava inline-flex items-center gap-1">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      <span>Syncing Strava in background…</span>
                    </span>
                  </div>
                )}
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                  Add Overnight Sleep &amp; HRV (Optional)
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  {status.stravaConnected ? (
                    <>
                      Strava is already handling your sign-in{syncWindow !== 'none' ? ' and workout sync' : ''}. Optionally link <strong>Garmin Connect</strong> or <strong>Intervals.icu</strong> for overnight HRV, Sleep Score, and Resting HR—or enter THRESH right now.
                    </>
                  ) : (
                    <>
                      Your THRESH account is active. Optionally link <strong>Garmin Connect</strong>, <strong>Intervals.icu</strong>, <strong>Wahoo</strong>, or <strong>Polar</strong> for automatic workout &amp; overnight HRV sync—or enter THRESH right now.
                    </>
                  )}
                </p>
              </div>

              <div className="space-y-3">
                {/* Optional Card 1: Garmin Connect */}
                <div className="liquid-glass rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                          Garmin Connect
                        </h2>
                        {isGarminConnected ? (
                          <span className="ap-status-prime px-2 py-0.5 rounded-md text-2xs font-mono font-semibold">
                            Connected ✓
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-2xs font-mono uppercase bg-slate-200/70 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                            Optional
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                        Adds overnight HRV (rMSSD), Sleep Score, Resting HR, and 1-click watch workout pushes.
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-expanded={expandGarmin}
                      onClick={() => setExpandGarmin((prev) => !prev)}
                      className="ap-btn-secondary !min-h-[44px] sm:!min-h-[38px] text-xs shrink-0 cursor-pointer"
                    >
                      {isGarminConnected ? 'Update' : expandGarmin ? 'Hide' : 'Connect'}
                    </button>
                  </div>

                  {expandGarmin && (
                    <form
                      onSubmit={handleConnectGarminInline}
                      className="pt-3 border-t border-slate-200/80 dark:border-white/10 space-y-2.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-600 dark:text-slate-300">
                          Paste your Garmin Personal API Key (<code className="font-mono">GCDC_...</code>):
                        </span>
                        <a
                          href="https://connect.garmin.com/app/settings/personalApiToken"
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold ap-text-brand hover:underline inline-flex items-center gap-1"
                        >
                          <span>Get Key from Garmin</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="password"
                          required
                          aria-label="Garmin Personal API Key"
                          value={garminPersonalKey}
                          onChange={(e) => setGarminPersonalKey(e.target.value)}
                          placeholder="GCDC_00000000-0000-..."
                          className="flex-1 min-h-[44px] sm:min-h-[42px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                        />
                        <button
                          type="submit"
                          disabled={busy || !garminPersonalKey.trim()}
                          className="ap-btn-primary !min-h-[44px] sm:!min-h-[42px] text-xs shrink-0 cursor-pointer"
                        >
                          {isConnectingGarmin ? 'Linking…' : 'Link Garmin'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>

                {/* Optional Card 2: Intervals.icu */}
                <div className="liquid-glass rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                          Intervals.icu
                        </h2>
                        {status.intervalsConnected ? (
                          <span className="ap-status-prime px-2 py-0.5 rounded-md text-2xs font-mono font-semibold">
                            Connected ✓
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-2xs font-mono uppercase bg-slate-200/70 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                            Optional
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                        Syncs Intervals.icu connected devices (Garmin, COROS, Suunto, Polar, Wahoo), eFTP curves, and planned calendar workouts.
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-expanded={expandIntervals}
                      onClick={() => setExpandIntervals((prev) => !prev)}
                      className="ap-btn-secondary !min-h-[44px] sm:!min-h-[38px] text-xs shrink-0 cursor-pointer"
                    >
                      {status.intervalsConnected ? 'Update' : expandIntervals ? 'Hide' : 'Connect'}
                    </button>
                  </div>

                  {expandIntervals && (
                    <div className="pt-3 border-t border-slate-200/80 dark:border-white/10 space-y-3">
                      {onLaunchIntervalsOAuth && (
                        <button
                          type="button"
                          onClick={() => onLaunchIntervalsOAuth?.()}
                          className="w-full ap-btn-primary min-h-[44px] flex items-center justify-center gap-2 font-semibold text-xs cursor-pointer shadow-sm"
                        >
                          <Lightning className="w-4 h-4 shrink-0" />
                          <span>1-Click Connect with Intervals.icu (OAuth 2.0)</span>
                        </button>
                      )}

                      <details className="text-2xs text-slate-500 dark:text-slate-400 group/api">
                        <summary className="cursor-pointer hover:text-slate-700 dark:hover:text-slate-200 select-none py-1">
                          Power-User Option: Connect via Personal API Key
                        </summary>
                        <form
                          onSubmit={handleConnectIntervalsInline}
                          className="pt-2 space-y-2.5"
                        >
                          <div className="flex items-center justify-between text-2xs">
                            <span className="text-slate-600 dark:text-slate-300">
                              Enter Athlete ID (<code className="font-mono">0</code> for self) &amp; API Key:
                            </span>
                            <a
                              href="https://intervals.icu/settings"
                              target="_blank"
                              rel="noreferrer"
                              className="font-semibold ap-text-brand hover:underline inline-flex items-center gap-1"
                            >
                              <span>Intervals.icu Settings</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                            <input
                              type="text"
                              aria-label="Intervals.icu Athlete ID"
                              value={intervalsAthleteId}
                              onChange={(e) => setIntervalsAthleteId(e.target.value)}
                              placeholder="0 or i12345"
                              className="sm:col-span-3 min-h-[44px] sm:min-h-[42px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                            />
                            <input
                              type="password"
                              required
                              aria-label="Intervals.icu API Key"
                              value={intervalsApiKey}
                              onChange={(e) => setIntervalsApiKey(e.target.value)}
                              placeholder="Intervals.icu API Key"
                              className="sm:col-span-6 min-h-[44px] sm:min-h-[42px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                            />
                            <button
                              type="submit"
                              disabled={busy || !intervalsApiKey.trim()}
                              className="sm:col-span-3 ap-btn-primary !min-h-[44px] sm:!min-h-[42px] text-xs cursor-pointer"
                            >
                              {isConnectingIntervals ? 'Linking…' : 'Connect'}
                            </button>
                          </div>
                        </form>
                      </details>
                    </div>
                  )}
                </div>
              </div>

              {/* Wahoo Option */}
              <div className="rounded-xl ap-card-inset p-3 sm:p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-sky-500/10 text-sky-500 font-bold text-xs flex items-center justify-center">
                      W
                    </div>
                    <div>
                      <h4 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        <span>Wahoo Cloud API</span>
                        {status.wahooConnected ? (
                          <span className="text-2xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
                            Connected ({status.wahooAthleteName || 'Wahoo'})
                          </span>
                        ) : (
                          <span className="text-2xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                            Optional
                          </span>
                        )}
                      </h4>
                      <p className="text-2xs text-slate-500 dark:text-slate-400">
                        ELEMNT bike computer rides, KICKR sessions &amp; FIT files.
                      </p>
                    </div>
                  </div>
                </div>

                {!status.wahooConnected && onLaunchWahooOAuth && (
                  <button
                    type="button"
                    onClick={() => onLaunchWahooOAuth?.()}
                    disabled={busy}
                    className="w-full ap-btn-primary min-h-[44px] sm:min-h-[42px] flex items-center justify-center gap-2 font-semibold text-xs cursor-pointer shadow-sm"
                  >
                    <Lightning className="w-4 h-4 shrink-0" />
                    <span>1-Click Connect with Wahoo (OAuth 2.0)</span>
                  </button>
                )}
              </div>

              {/* Polar Option */}
              <div className="rounded-xl ap-card-inset p-3 sm:p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-rose-500/10 text-rose-500 font-bold text-xs flex items-center justify-center">
                      P
                    </div>
                    <div>
                      <h4 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        <span>Polar AccessLink</span>
                        {status.polarConnected ? (
                          <span className="text-2xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
                            Connected ({status.polarAthleteName || 'Polar'})
                          </span>
                        ) : (
                          <span className="text-2xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                            Optional
                          </span>
                        )}
                      </h4>
                      <p className="text-2xs text-slate-500 dark:text-slate-400">
                        Grit X, Vantage, Pacer, H10 &amp; running load telemetry.
                      </p>
                    </div>
                  </div>
                </div>

                {!status.polarConnected && onLaunchPolarOAuth && (
                  <button
                    type="button"
                    onClick={() => onLaunchPolarOAuth?.()}
                    disabled={busy}
                    className="w-full ap-btn-primary min-h-[44px] sm:min-h-[42px] flex items-center justify-center gap-2 font-semibold text-xs cursor-pointer shadow-sm"
                  >
                    <Lightning className="w-4 h-4 shrink-0" />
                    <span>1-Click Connect with Polar (OAuth 2.0)</span>
                  </button>
                )}
              </div>

              <div className="rounded-xl liquid-glass-subtle px-3.5 py-2.5 text-2xs text-slate-600 dark:text-slate-300 flex items-center justify-between flex-wrap gap-2">
                <span>
                  <strong>Smart Deduplication:</strong> Connecting Garmin, Intervals.icu, Wahoo, or Polar alongside Strava merges matching workouts automatically—never duplicates.
                </span>
                {!claimedTeamsState && (
                  <button
                    type="button"
                    onClick={() => void handleFinalizeOnboarding('CREATE_TEAM')}
                    disabled={busy}
                    className="font-semibold ap-text-brand hover:underline cursor-pointer shrink-0"
                  >
                    Coach? Set up a Team Workspace →
                  </button>
                )}
              </div>

              <div className="pt-1 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="ap-btn-secondary text-xs cursor-pointer"
                >
                  ← Back to Sync Choice
                </button>

                <button
                  type="button"
                  onClick={() => void handleFinalizeOnboarding('WORKSPACE')}
                  disabled={busy}
                  className="ap-btn-primary text-sm px-6 cursor-pointer"
                >
                  {isEntering ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  <span>
                    {secondaryConnected
                      ? 'Continue to THRESH →'
                      : 'Skip for Now — Enter THRESH →'}
                  </span>
                </button>
              </div>
            </div>
  );
};
