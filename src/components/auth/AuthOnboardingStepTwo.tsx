import React from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ShieldCheck,
  Users,
} from '../icons/PhosphorIcons';
import type {
  CoachDataSharingTier,
  ConnectionStatus,
  DistanceUnit,
  StravaSyncWindow,
  TeamInvitePreviewPayload,
  ThreshUser,
} from '../../types';
import type { calibrateThresholdsFromSeedMark } from '../../physiology/teamOnboardingEngine';
import { SyncScopeTimelineBar } from '../charts/MicroGraphics';
import type { FirstRunCalibrationPayload } from '../StravaAuthGate';
import { SEED_EVENT_PILLS, StravaChevronMark } from './authGateShared';

export interface AuthOnboardingStepTwoProps {
  formId: string;
  status: ConnectionStatus;
  localUser: ThreshUser | null;
  activeBrand?: NonNullable<TeamInvitePreviewPayload['brand']> | null;
  onboardingRole: 'ATHLETE' | 'COACH';
  selectOnboardingRole: (nextRole: 'ATHLETE' | 'COACH') => void;
  setStep: React.Dispatch<React.SetStateAction<1 | 2 | 3>>;
  syncWindow: StravaSyncWindow;
  setSyncWindow: React.Dispatch<React.SetStateAction<StravaSyncWindow>>;
  importProfileAndGear: boolean;
  setImportProfileAndGear: React.Dispatch<React.SetStateAction<boolean>>;
  athleteName: string;
  setAthleteName: React.Dispatch<React.SetStateAction<string>>;
  birthYear: string;
  setBirthYear: React.Dispatch<React.SetStateAction<string>>;
  birthMonth: string;
  setBirthMonth: React.Dispatch<React.SetStateAction<string>>;
  parentGuardianEmail: string;
  setParentGuardianEmail: React.Dispatch<React.SetStateAction<string>>;
  deferParentEmail: boolean;
  onToggleDeferParentEmail: (val: boolean) => void;
  primarySport: 'Cycling' | 'Running' | 'Swimming' | 'Triathlon' | 'Hybrid';
  setPrimarySport: React.Dispatch<
    React.SetStateAction<'Cycling' | 'Running' | 'Swimming' | 'Triathlon' | 'Hybrid'>
  >;
  distanceUnit: DistanceUnit;
  setDistanceUnit: React.Dispatch<React.SetStateAction<DistanceUnit>>;
  setHasEditedUnits: React.Dispatch<React.SetStateAction<boolean>>;
  selectedSeedEventId: string;
  setSelectedSeedEventId: React.Dispatch<React.SetStateAction<string>>;
  rawSeedValue: string;
  setRawSeedValue: React.Dispatch<React.SetStateAction<string>>;
  safeSportHideWeight: boolean;
  setSafeSportHideWeight: React.Dispatch<React.SetStateAction<boolean>>;
  sharingTier: CoachDataSharingTier;
  setSharingTier: React.Dispatch<React.SetStateAction<CoachDataSharingTier>>;
  isSavingStep2: boolean;
  showTeamCodeDrawer: boolean;
  setShowTeamCodeDrawer: React.Dispatch<React.SetStateAction<boolean>>;
  joinCodeInput: string;
  setJoinCodeInput: React.Dispatch<React.SetStateAction<string>>;
  setJoinSlug: React.Dispatch<React.SetStateAction<string | undefined>>;
  inviteToken: string;
  setInviteToken: React.Dispatch<React.SetStateAction<string>>;
  isLoadingPreview: boolean;
  currentYear: number;
  isUnder13: boolean;
  isMinorAthlete: boolean;
  lacksActivityScope: boolean;
  selectedSeedPill: (typeof SEED_EVENT_PILLS)[number];
  composedSeedMark: string;
  liveSeedCalibration: ReturnType<typeof calibrateThresholdsFromSeedMark>;
  lookupTeamPreview: (
    codeOrSlug: string,
    token?: string,
    explicitSlug?: string,
    overrideEmail?: string
  ) => Promise<void>;
  handleStravaLaunchClick: (
    oauthMode?: 'cloud' | 'localhost',
    forcePrompt?: boolean
  ) => Promise<void>;
  handleSwitchStravaAccount: () => Promise<void>;
  handleConfirmStep2: () => Promise<void>;
  handleFinalizeOnboarding: (
    entryTarget?: FirstRunCalibrationPayload['entryTarget']
  ) => Promise<void>;
  busy: boolean;
}

export const AuthOnboardingStepTwo: React.FC<AuthOnboardingStepTwoProps> = ({
  formId,
  status,
  localUser,
  activeBrand,
  onboardingRole,
  selectOnboardingRole,
  setStep,
  syncWindow,
  setSyncWindow,
  importProfileAndGear,
  setImportProfileAndGear,
  athleteName,
  setAthleteName,
  birthYear,
  setBirthYear,
  birthMonth,
  setBirthMonth,
  parentGuardianEmail,
  setParentGuardianEmail,
  deferParentEmail,
  onToggleDeferParentEmail,
  primarySport,
  setPrimarySport,
  distanceUnit,
  setDistanceUnit,
  setHasEditedUnits,
  selectedSeedEventId,
  setSelectedSeedEventId,
  rawSeedValue,
  setRawSeedValue,
  safeSportHideWeight,
  setSafeSportHideWeight,
  sharingTier,
  setSharingTier,
  isSavingStep2,
  showTeamCodeDrawer,
  setShowTeamCodeDrawer,
  joinCodeInput,
  setJoinCodeInput,
  setJoinSlug,
  inviteToken,
  setInviteToken,
  isLoadingPreview,
  currentYear,
  isUnder13,
  isMinorAthlete,
  lacksActivityScope,
  selectedSeedPill,
  composedSeedMark,
  liveSeedCalibration,
  lookupTeamPreview,
  handleStravaLaunchClick,
  handleSwitchStravaAccount,
  handleConfirmStep2,
  handleFinalizeOnboarding,
  busy,
}) => {
  return (
    <div className="space-y-5 relative z-10">
              {/* Verified Identity Badge */}
              <div className="rounded-2xl ap-status-prime p-3.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs sm:text-sm font-bold truncate">
                      {status.stravaConnected
                        ? `Signed in with Strava${status.stravaAthleteName ? ` · ${status.stravaAthleteName}` : ''}`
                        : `Signed in as ${localUser?.name || localUser?.email || 'Athlete'}${localUser?.email && localUser?.name ? ` (${localUser.email})` : ''}`}
                    </div>
                    <div className="text-2xs opacity-90">
                      {status.stravaConnected
                        ? 'Identity verified. Choose what Strava data you want to sync to THRESH.'
                        : 'THRESH account active. Configure your telemetry sync and sport calibration below.'}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSwitchStravaAccount()}
                  className="text-2xs font-mono underline opacity-90 hover:opacity-100 cursor-pointer shrink-0"
                >
                  Switch account
                </button>
              </div>

              {onboardingRole === 'COACH' && !activeBrand && (
                <div
                  data-testid="coach-quickstart-card"
                  className="liquid-glass rounded-2xl p-4 sm:p-5 space-y-3.5 border border-ap-cobalt/25 dark:border-ap-volt/25"
                >
                  <div className="space-y-1">
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                      Coach Workspace Quick-Start
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      Skip personal wearable calibration and go straight to creating your team, importing a CSV roster, or timing track workouts.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      aria-label="Coach Name"
                      value={athleteName}
                      onChange={(e) => setAthleteName(e.target.value)}
                      placeholder="Coach Name (e.g. Coach Vega)"
                      className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      data-testid="enter-coach-mode-btn"
                      disabled={busy}
                      onClick={() => void handleFinalizeOnboarding('COACH_MODE')}
                      className="ap-btn-primary !min-h-[44px] px-4 py-2 text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span>Enter Coach Workspace</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => selectOnboardingRole('ATHLETE')}
                    className="text-2xs underline text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                  >
                    Switch to personal Athlete setup instead
                  </button>
                </div>
              )}

              {(onboardingRole !== 'COACH' || Boolean(activeBrand)) && (
                <>
                  {!status.stravaConnected ? (
                <div className="liquid-glass rounded-2xl p-4 sm:p-5 space-y-3.5 border border-orange-500/25">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <StravaChevronMark className="w-4 h-4 text-[#FC4C02]" />
                        <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                          Link Strava Workouts (Optional)
                        </h2>
                        <span className="px-2 py-0.5 rounded text-2xs font-mono uppercase bg-slate-200/70 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                          Optional
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        Automatically pull your workouts, GPS routes, and gear mileage into THRESH.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleStravaLaunchClick('cloud', false)}
                        disabled={busy}
                        className="ap-btn-strava !min-h-[40px] px-3.5 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <StravaChevronMark className="w-3.5 h-3.5" />
                        <span>Connect Strava</span>
                      </button>
                    </div>
                  </div>
                  <p className="text-2xs text-slate-500 dark:text-slate-400">
                    Not using Strava? No problem. You can link Garmin Connect or Intervals.icu in Step 3, or import .FIT/.ZIP files anytime.
                  </p>
                </div>
              ) : (
                <>
                  {lacksActivityScope && (
                    <div className="ap-status-caution rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="space-y-0.5 flex-1 min-w-[220px]">
                        <div className="font-bold">Activity permission was unchecked on Strava</div>
                        <div className="opacity-90">
                          THRESH is set to Identity Only. Re-authorize with activity read access if you want automatic workout sync.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleStravaLaunchClick('cloud', true)}
                        className="ap-btn-strava !min-h-[44px] sm:!min-h-[36px] px-3 py-1.5 rounded-lg font-bold text-xs cursor-pointer shrink-0"
                      >
                        Re-Authorize Activities
                      </button>
                    </div>
                  )}

                  <div className="space-y-2">
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                      Choose What Syncs From Strava
                    </h1>
                    <SyncScopeTimelineBar days={syncWindow === 'all' || syncWindow === '180d' ? 365 : 90} />
                  </div>

                  {/* 1. Sync Window Radio Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {(
                      [
                        {
                          id: '90d' as const,
                          title: 'Last 90 Days',
                          badge: 'Recommended · Fast',
                          desc: 'Loads your 42-day Fitness (CTL), Fatigue (ATL), and recent PRs in ~2 seconds.',
                          disabled: lacksActivityScope,
                        },
                        {
                          id: '180d' as const,
                          title: 'Last 6 Months',
                          badge: 'Season Block',
                          desc: 'Includes your full prior training block, base mileage, and threshold trends.',
                          disabled: lacksActivityScope,
                        },
                        {
                          id: 'all' as const,
                          title: 'Complete Strava Archive',
                          badge: 'All-Time',
                          desc: 'Paginates your multi-year run & ride history in the background.',
                          disabled: lacksActivityScope,
                        },
                        {
                          id: 'none' as const,
                          title: 'Identity Only (No Sync Yet)',
                          badge: 'Zero Import',
                          desc: 'Use Strava strictly for sign-in; enable sync or upload .FIT files anytime later.',
                          disabled: false,
                        },
                      ] as const
                    ).map((opt) => {
                      const selected = syncWindow === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={opt.disabled}
                          aria-pressed={selected}
                          onClick={() => setSyncWindow(opt.id)}
                          className={`text-left rounded-xl p-3.5 border-2 transition-all ${
                            opt.disabled
                              ? 'opacity-45 cursor-not-allowed border-slate-300/50 dark:border-white/10'
                              : selected
                                ? 'border-[#1E6B38] dark:border-ap-volt bg-emerald-500/10 dark:bg-ap-volt/10 cursor-pointer'
                                : 'liquid-glass hover:border-[#28573B] dark:hover:border-[#2E6B47] cursor-pointer'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                              {opt.title}
                            </span>
                            <span
                              className={`text-2xs font-mono px-2 py-0.5 rounded-md font-bold ${
                                selected
                                  ? 'ap-badge-volt'
                                  : 'bg-slate-200/70 dark:bg-white/10 text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              {opt.badge}
                            </span>
                          </div>
                          <p className="text-2xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                            {opt.desc}
                          </p>
                        </button>
                      );
                    })}
                  </div>

                  <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none px-1">
                    <input
                      type="checkbox"
                      checked={importProfileAndGear}
                      onChange={(e) => setImportProfileAndGear(e.target.checked)}
                      className="w-4 h-4 rounded accent-[#FC4C02]"
                    />
                    <span>
                      Import Strava athlete baseline (FTP / weight if set) &amp; shoe/bike gear mileage
                    </span>
                  </label>
                </>
              )}

              {/* Athlete Profile & Youth Protection */}
              <div className="liquid-glass rounded-2xl p-4 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                    Athlete Profile &amp; Eligibility
                  </h2>
                  {isMinorAthlete && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-2xs font-mono font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Safe-Sport Minor Protection</span>
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label
                      htmlFor={`${formId}-profile-name`}
                      className="block text-2xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
                    >
                      Athlete Display Name
                    </label>
                    <input
                      id={`${formId}-profile-name`}
                      type="text"
                      value={athleteName}
                      onChange={(e) => setAthleteName(e.target.value)}
                      placeholder="e.g. Maya Lin"
                      className="w-full min-h-[44px] sm:min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`${formId}-birth-year`}
                      className="block text-2xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
                    >
                      Birth Month &amp; Year <span className="text-slate-600 dark:text-slate-400 font-normal">(Age verification)</span>
                    </label>
                    <div className="flex gap-2">
                      <select
                        aria-label="Birth month (optional)"
                        value={birthMonth}
                        onChange={(e) => setBirthMonth(e.target.value)}
                        className="w-28 min-h-[44px] sm:min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                      >
                        <option value="">Month</option>
                        <option value="01">Jan</option>
                        <option value="02">Feb</option>
                        <option value="03">Mar</option>
                        <option value="04">Apr</option>
                        <option value="05">May</option>
                        <option value="06">Jun</option>
                        <option value="07">Jul</option>
                        <option value="08">Aug</option>
                        <option value="09">Sep</option>
                        <option value="10">Oct</option>
                        <option value="11">Nov</option>
                        <option value="12">Dec</option>
                      </select>
                      <input
                        id={`${formId}-birth-year`}
                        type="number"
                        min={1920}
                        max={currentYear}
                        value={birthYear}
                        onChange={(e) => setBirthYear(e.target.value)}
                        placeholder={`e.g. ${currentYear - 17}`}
                        className="flex-1 min-w-0 min-h-[44px] sm:min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  </div>
                </div>

                {/* Under-13 COPPA Hard Block */}
                {isUnder13 && (
                  <div
                    data-testid="join-coppa-u13-notice"
                    className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 space-y-1.5 text-xs"
                  >
                    <div className="font-bold flex items-center gap-1.5 text-rose-700 dark:text-rose-300">
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                      <span>13+ Minimum Age Required (COPPA)</span>
                    </div>
                    <p className="text-slate-700 dark:text-slate-300 text-2xs leading-relaxed">
                      THRESH self-serve accounts require athletes to be 13 or older (COPPA). Coaches can still time under-13 athletes watchlessly using Trackside Stopwatch without an athlete login.
                    </p>
                  </div>
                )}

                {/* Minor Youth Protection Gate: If under 18 and not yet attached to a team */}
                {!isUnder13 && isMinorAthlete && !activeBrand && (
                  <div className="ap-status-caution rounded-xl p-3.5 space-y-2.5 text-xs">
                    <div className="font-bold flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                      <span>Scholastic Youth Protection Gate</span>
                    </div>
                    <p className="text-slate-700 dark:text-slate-300 text-2xs leading-relaxed">
                      Under our U18 Safe-Sport youth privacy policy (with COPPA &lt;13 enforcement), athletes aged 13–17 join through an authorized school or club athletic team roster with parent/guardian consent.
                    </p>
                    {!showTeamCodeDrawer ? (
                      <div className="pt-1">
                        <button
                          type="button"
                          data-testid="youth-open-join-code-btn"
                          onClick={() => setShowTeamCodeDrawer(true)}
                          className="ap-btn-primary !min-h-[40px] px-3 py-1 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Users className="w-3.5 h-3.5" />
                          <span>Enter Coach / Team Join Code</span>
                        </button>
                      </div>
                    ) : (
                      <div
                        data-testid="youth-inline-join-code-box"
                        className="flex flex-col sm:flex-row gap-2 pt-1"
                      >
                        <input
                          type="text"
                          value={joinCodeInput}
                          aria-label="Enter 6-character Team Join Code"
                          onChange={(e) => {
                            setJoinCodeInput(e.target.value.toUpperCase());
                            setJoinSlug(undefined);
                            setInviteToken('');
                          }}
                          placeholder="Enter 6-char Team Code (e.g. PAXC-26)"
                          className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-2 text-xs font-mono font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100"
                        />
                        <button
                          type="button"
                          disabled={isLoadingPreview || !joinCodeInput.trim()}
                          onClick={() => void lookupTeamPreview(joinCodeInput, inviteToken)}
                          className="ap-btn-secondary !min-h-[44px] px-3 py-1.5 text-xs font-semibold shrink-0 cursor-pointer"
                        >
                          {isLoadingPreview ? 'Checking…' : 'Apply Code'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Parent / Guardian Email Requirement for Minor Athletes (13-17) */}
                {!isUnder13 && isMinorAthlete && (
                  <div className="space-y-2 pt-1 border-t border-slate-200/80 dark:border-white/10">
                    <label
                      htmlFor={`${formId}-parent-email`}
                      className="block text-2xs font-semibold text-slate-600 dark:text-slate-300"
                    >
                      Parent or Guardian Email{' '}
                      <span className="text-amber-700 dark:text-amber-400 font-bold">
                        *For Athletes Under 18
                      </span>
                    </label>
                    <input
                      id={`${formId}-parent-email`}
                      type="email"
                      disabled={deferParentEmail}
                      value={parentGuardianEmail}
                      onChange={(e) => setParentGuardianEmail(e.target.value)}
                      placeholder="parent.guardian@example.com"
                      className="w-full min-h-[44px] sm:min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 disabled:opacity-50"
                    />
                    <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-200 cursor-pointer select-none min-h-[44px] sm:min-h-[28px] py-1">
                      <input
                        type="checkbox"
                        data-testid="step2-defer-parent-email-checkbox"
                        checked={deferParentEmail}
                        onChange={(e) => onToggleDeferParentEmail(e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded accent-emerald-600 shrink-0"
                      />
                      <span>
                        I&apos;ll add my parent&apos;s email later (coach can share the link)
                      </span>
                    </label>
                    <p className="text-2xs text-slate-500 dark:text-slate-400">
                      {deferParentEmail
                        ? 'Summary telemetry stays paused (Load Only + Safe-Sport Weight Shield ON) until a parent or guardian approves via your coach link.'
                        : 'We will dispatch an automated parent notification with full transparency on data safeguards and a 1-click consent link.'}
                    </p>
                  </div>
                )}
              </div>

              {/* 2. Primary Sport & Units + Optional Day-1 Seed Mark */}
              <div className="liquid-glass rounded-2xl p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div
                      id={`${formId}-primary-sport`}
                      className="text-2xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400"
                    >
                      Primary Focus
                    </div>
                    <div
                      role="group"
                      aria-labelledby={`${formId}-primary-sport`}
                      className="inline-flex flex-wrap gap-0.5 rounded-xl p-0.5 liquid-capsule-track text-xs"
                    >
                      {(['Running', 'Cycling', 'Swimming', 'Triathlon', 'Hybrid'] as const).map((sp) => (
                        <button
                          key={sp}
                          type="button"
                          aria-pressed={primarySport === sp}
                          onClick={() => {
                            setPrimarySport(sp);
                            if (sp === 'Cycling') setSelectedSeedEventId('ftp');
                            else if (selectedSeedEventId === 'ftp' || selectedSeedEventId === '20m') {
                              setSelectedSeedEventId('5k');
                            }
                          }}
                          className={`min-h-[44px] sm:min-h-[36px] px-3 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
                            primarySport === sp
                              ? 'ap-nav-volt-active'
                              : 'text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {sp}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div
                      id={`${formId}-display-units`}
                      className="text-2xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400"
                    >
                      Display Units
                    </div>
                    <div
                      role="group"
                      aria-labelledby={`${formId}-display-units`}
                      className="inline-flex rounded-xl p-0.5 liquid-capsule-track text-xs font-mono"
                    >
                      {(['mi', 'km'] as const).map((u) => (
                        <button
                          key={u}
                          type="button"
                          aria-pressed={distanceUnit === u}
                          onClick={() => {
                            setDistanceUnit(u);
                            setHasEditedUnits(true);
                          }}
                          className={`min-h-[44px] sm:min-h-[36px] px-3 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
                            distanceUnit === u
                              ? 'ap-nav-volt-active'
                              : 'text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {u === 'mi' ? 'mi / lbs' : 'km / kg'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Optional Seed Mark Calibrator — Progressive Disclosure (Auto-open for Identity Only) */}
                <details
                  open={syncWindow === 'none' || Boolean(rawSeedValue.trim())}
                  className="pt-3 border-t border-slate-200/80 dark:border-white/10 group"
                >
                  <summary className="cursor-pointer list-none flex flex-wrap items-center justify-between gap-2 py-1 select-none">
                    <span className="text-xs font-bold text-slate-900 dark:text-white inline-flex items-center gap-1.5">
                      <span>Optional: Seed Zones From a Recent Race Time or FTP</span>
                      <ChevronDown className="w-3.5 h-3.5 text-slate-500 transition-transform group-open:rotate-180" />
                    </span>
                    <span className="text-2xs text-slate-500 dark:text-slate-400">
                      {syncWindow === 'none'
                        ? 'Recommended when importing 0 workouts'
                        : 'Skip to auto-calibrate from Strava'}
                    </span>
                  </summary>

                  <div className="pt-2.5 space-y-2.5">
                    <label
                      htmlFor={`${formId}-seed-mark`}
                      className="block text-2xs font-semibold text-slate-600 dark:text-slate-300"
                    >
                      Recent Race Mark or Threshold Power
                    </label>

                    <div
                      role="group"
                      aria-label="Seed mark event type"
                      className="flex flex-wrap gap-1.5"
                    >
                      {SEED_EVENT_PILLS.filter((p) =>
                        primarySport === 'Hybrid' ? true : p.sport === primarySport
                      ).map((pill) => (
                        <button
                          key={pill.id}
                          type="button"
                          aria-pressed={selectedSeedEventId === pill.id}
                          onClick={() => setSelectedSeedEventId(pill.id)}
                          className={`min-h-[44px] sm:min-h-[34px] px-2.5 py-1 rounded-lg text-2xs font-mono font-semibold transition-colors cursor-pointer ${
                            selectedSeedEventId === pill.id
                              ? 'ap-nav-volt-active'
                              : 'liquid-capsule-track text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {pill.label}
                        </button>
                      ))}
                    </div>

                    <input
                      id={`${formId}-seed-mark`}
                      type="text"
                      value={rawSeedValue}
                      onChange={(e) => setRawSeedValue(e.target.value)}
                      placeholder={selectedSeedPill.placeholder}
                      className="w-full min-h-[44px] sm:min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-2 text-xs sm:text-sm font-mono text-slate-900 dark:text-slate-100"
                    />

                    {composedSeedMark.trim() && (
                      <div className="rounded-xl ap-status-prime px-3 py-2 text-xs font-mono flex flex-wrap items-center justify-between gap-2">
                        {selectedSeedPill.sport === 'Cycling' || /\d+\s*w\b/i.test(composedSeedMark) ? (
                          <>
                            <span>Calibrated Cycling FTP: {liveSeedCalibration.cyclingFtpWatts}W</span>
                            <span>
                              Z2 Base: {Math.round(liveSeedCalibration.cyclingFtpWatts * 0.56)}–
                              {Math.round(liveSeedCalibration.cyclingFtpWatts * 0.75)}W
                            </span>
                          </>
                        ) : (
                          <>
                            <span>
                              {liveSeedCalibration.vdotEstimate
                                ? `VDOT ${liveSeedCalibration.vdotEstimate} · `
                                : ''}
                              LT2 {liveSeedCalibration.thresholdPaceInputDisplay}/{distanceUnit}
                            </span>
                            <span>
                              Easy {liveSeedCalibration.easyPaceInputDisplay}/{distanceUnit} · VO2{' '}
                              {liveSeedCalibration.intervalPaceInputDisplay}/{distanceUnit}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </details>
              </div>

              {/* 3. Team Roster Consent & Coach Sharing Tier (Only when joining a team) */}
              {activeBrand && (
                <div className="liquid-glass rounded-2xl p-4 space-y-3 border-2 border-[#25573A]">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                        Joining {activeBrand.name} ({activeBrand.joinCode})
                      </h2>
                    </div>
                    <span className="text-2xs font-mono ap-text-brand font-bold">
                      Coach {activeBrand.coachDisplayName}
                    </span>
                  </div>

                  <div>
                    <label
                      htmlFor={`${formId}-sharing-tier`}
                      className="block text-2xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
                    >
                      Coach Data Sharing Level
                    </label>
                    <select
                      id={`${formId}-sharing-tier`}
                      value={sharingTier}
                      onChange={(e) => setSharingTier(e.target.value as CoachDataSharingTier)}
                      className="w-full min-h-[44px] sm:min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1210] px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100"
                    >
                      <option value="SUMMARY_ONLY">
                        Workout Summaries &amp; Readiness (Recommended)
                      </option>
                      <option value="FULL_STREAMS">
                        Full Coaching Splits &amp; Pace/Power Curves
                      </option>
                      <option value="LOAD_ONLY">
                        Readiness &amp; Weekly Load Totals Only
                      </option>
                    </select>
                  </div>

                  <label
                    className={`flex items-start gap-2.5 text-xs select-none ${
                      isMinorAthlete ? 'cursor-not-allowed opacity-90' : 'cursor-pointer'
                    } text-slate-700 dark:text-slate-300`}
                  >
                    <input
                      type="checkbox"
                      checked={isMinorAthlete ? true : safeSportHideWeight}
                      disabled={isMinorAthlete}
                      onChange={(e) => !isMinorAthlete && setSafeSportHideWeight(e.target.checked)}
                      className="w-4 h-4 mt-0.5 rounded accent-emerald-600"
                    />
                    <div>
                      <span>
                        <strong>Safe-Sport Privacy Mode:</strong> Hide body weight &amp; W/kg on team views
                      </span>
                      {isMinorAthlete && (
                        <span className="block text-2xs text-emerald-700 dark:text-emerald-400 font-medium mt-0.5">
                          Enforced &amp; locked ON for minor athletes to prevent RED-S &amp; weight-sensitive eating disorder risks.
                        </span>
                      )}
                    </div>
                  </label>
                </div>
              )}

              <div className="text-center text-2xs text-slate-500 dark:text-slate-400 pt-1 flex flex-wrap items-center justify-center gap-3">
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-emerald-400 inline-flex items-center gap-1"
                >
                  <ShieldCheck className="w-3.5 h-3.5 inline" />
                  <span>Privacy Policy, COPPA &amp; Safe-Sport Shield</span>
                </a>
                <a
                  href="/procurement"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-emerald-400"
                >
                  District NDPA &amp; Terms
                </a>
              </div>

              <div className="pt-1 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="ap-btn-secondary text-xs cursor-pointer"
                >
                  ← Back
                </button>

                <button
                  type="button"
                  onClick={() => void handleConfirmStep2()}
                  disabled={
                    busy ||
                    isUnder13 ||
                    (Boolean(activeBrand) &&
                      isMinorAthlete &&
                      !deferParentEmail &&
                      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentGuardianEmail.trim()))
                  }
                  className="ap-btn-primary text-sm px-6 cursor-pointer disabled:opacity-50"
                >
                  {isSavingStep2 ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <ArrowRight className="w-4 h-4" />
                  )}
                  <span>
                    {activeBrand
                      ? `Join ${activeBrand.shortName} & Continue`
                      : status.stravaConnected
                        ? 'Confirm Strava Sync & Continue'
                        : 'Confirm & Continue'}
                  </span>
                </button>
              </div>
                </>
              )}
            </div>
  );
};
