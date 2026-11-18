import React, { useState, useEffect, useRef } from 'react';
import { AeroPulseLogo } from './AeroPulseLogo';
import { TracksideLiveHeaderPill } from './TracksideLiveHeaderPill';
import { PWAInstallButton } from './PWAInstallButton';
import type { RosterTab } from './AthleteRosterModal';
import {
  HeartPulse,
  Calendar,
  Target,
  RefreshCw,
  Users,
  Database,
  Bot,
  Sun,
  Moon,
  ChevronDown,
  ChevronLeft,
  ClipboardText,
  Sliders,
  Timer,
  HelpCircle,
  LogOut,
} from './icons/PhosphorIcons';
import type {
  ActiveTab,
  AthleteProfile,
  CoachWorkspaceSubTab,
  ConnectedAthleteRecord,
  DistanceUnit,
  EnvironmentFilter,
  SportCategory,
  TeamSummaryWithRole,
  ThreshUser,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';

export interface CockpitHeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  coachSubTab?: CoachWorkspaceSubTab;
  onSelectCoachSubTab?: (subTab: CoachWorkspaceSubTab) => void;
  activeTeam: TeamSummaryWithRole | null;
  myTeams: TeamSummaryWithRole[];
  activeTeamId: string | null;
  onSelectActiveTeam: (teamId: string | null) => void;
  onOpenRosterModalWithTab: (tab: RosterTab) => void;
  syncLiveTelemetry: (fullHistory?: boolean) => Promise<void>;
  isSyncing: boolean;
  latestWellness: UnifiedWellnessDay | null;
  envFilter: EnvironmentFilter;
  setEnvFilter: (env: EnvironmentFilter) => void;
  selectedSport: SportCategory | 'ALL';
  setSelectedSport: (sport: SportCategory | 'ALL') => void;
  lastProgressTab: ActiveTab;
  activeViewedAthleteId: string;
  setActiveViewedAthleteId: (id: string) => void;
  setSelectedActivity: (act: UnifiedActivity | null) => void;
  primaryAthleteDisplayName: string;
  primaryAthleteInitials: string;
  combinedRoster: ConnectedAthleteRecord[];
  anySourceConnected: boolean;
  onOpenDataSources: () => void;
  onOpenCoach: () => void;
  isDark: boolean;
  onToggleDark: () => void;
  currentUser: ThreshUser | null;
  effectiveActivities: UnifiedActivity[];
  effectiveAthleteProfile: AthleteProfile;
  onOpenProfileModal: () => void;
  onOpenGuide: () => void;
  distanceUnit: DistanceUnit;
  setDistanceUnit: (unit: DistanceUnit) => void;
  onLogoutSession: () => void;
  onLogoutAndClearData: () => Promise<void>;
  isAccountMenuOpen?: boolean;
  setIsAccountMenuOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  accountMenuRef?: React.RefObject<HTMLDivElement | null>;
  accountTriggerRef?: React.RefObject<HTMLButtonElement | null>;
}

export const CockpitHeader: React.FC<CockpitHeaderProps> = ({
  activeTab,
  setActiveTab,
  coachSubTab = 'CLIPBOARD',
  onSelectCoachSubTab,
  activeTeam,
  myTeams,
  activeTeamId,
  onSelectActiveTeam,
  onOpenRosterModalWithTab,
  syncLiveTelemetry,
  isSyncing,
  latestWellness,
  envFilter,
  setEnvFilter,
  selectedSport,
  setSelectedSport,
  lastProgressTab: _lastProgressTab,
  activeViewedAthleteId,
  setActiveViewedAthleteId,
  setSelectedActivity,
  primaryAthleteDisplayName,
  primaryAthleteInitials,
  combinedRoster,
  anySourceConnected,
  onOpenDataSources,
  onOpenCoach,
  isDark,
  onToggleDark,
  currentUser,
  effectiveActivities,
  effectiveAthleteProfile,
  onOpenProfileModal,
  onOpenGuide,
  distanceUnit,
  setDistanceUnit,
  onLogoutSession,
  onLogoutAndClearData,
  isAccountMenuOpen: controlledOpen,
  setIsAccountMenuOpen: controlledSetOpen,
  accountMenuRef: controlledMenuRef,
  accountTriggerRef: controlledTriggerRef,
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const internalMenuRef = useRef<HTMLDivElement>(null);
  const internalTriggerRef = useRef<HTMLButtonElement>(null);

  const hasStoredStopwatchSession = () => {
    try {
      const raw = window.localStorage.getItem('thresh_trackside_stopwatch_v1');
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      const laps = parsed?.athleteLapTimestampsSecs;
      const hasRecordedSplits = Boolean(
        laps &&
          typeof laps === 'object' &&
          Object.values(laps).some((arr) => Array.isArray(arr) && arr.length > 0)
      );
      return Boolean(
        parsed &&
          (parsed.isRunning || Number(parsed.accumulatedMs || 0) > 0 || hasRecordedSplits)
      );
    } catch {
      return false;
    }
  };
  const [hasActiveStopwatchPill, setHasActiveStopwatchPill] = useState<boolean>(hasStoredStopwatchSession);
  useEffect(() => {
    const refresh = () => setHasActiveStopwatchPill(hasStoredStopwatchSession());
    window.addEventListener('thresh:trackside-stopwatch-sync', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('thresh:trackside-stopwatch-sync', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  const isAccountMenuOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setIsAccountMenuOpen = controlledSetOpen || setInternalOpen;
  const accountMenuRef = controlledMenuRef || internalMenuRef;
  const accountTriggerRef = controlledTriggerRef || internalTriggerRef;

  useEffect(() => {
    if (!isAccountMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setIsAccountMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setIsAccountMenuOpen(false);
        window.requestAnimationFrame(() => {
          accountTriggerRef.current?.focus();
        });
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      const container = accountMenuRef.current;
      if (!container) return;
      const items = Array.from(
        container.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled])'
        )
      );
      if (items.length === 0) return;
      e.preventDefault();
      const activeIdx = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'Home') {
        items[0].focus();
      } else if (e.key === 'End') {
        items[items.length - 1].focus();
      } else if (e.key === 'ArrowDown') {
        const nextIdx = activeIdx < 0 ? 0 : (activeIdx + 1) % items.length;
        items[nextIdx].focus();
      } else if (e.key === 'ArrowUp') {
        const prevIdx = activeIdx <= 0 ? items.length - 1 : activeIdx - 1;
        items[prevIdx].focus();
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAccountMenuOpen, accountMenuRef, accountTriggerRef, setIsAccountMenuOpen]);

  return (
    <div className="sticky top-[max(0.25rem,env(safe-area-inset-top,0px))] z-40 ap-container pt-1.5 sm:pt-2">
      <header className="rounded-2xl liquid-glass-header px-2.5 sm:px-5 py-1.5 sm:py-2">
        <div className="flex flex-nowrap items-center justify-between gap-1.5 sm:gap-3">
          {/* 1. Brand Wordmark (Co-Branded when Team Active) + Multi-Team Switcher + Telemetry Sync Pill */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 shrink">
            <a
              href="#fitness"
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('fitness');
              }}
              className="flex items-center whitespace-nowrap min-w-0 shrink overflow-hidden"
            >
              <span className="inline-flex scale-[0.86] origin-left sm:scale-100">
                <AeroPulseLogo size="sm" teamBrand={activeTeam?.brand || null} />
              </span>
            </a>

            <button
              type="button"
              data-testid="toggle-coach-workspace"
              aria-label={
                activeTab === 'coach'
                  ? 'Return to My Training'
                  : activeTeam
                    ? `Open Coach Workspace (${activeTeam.brand.shortName || activeTeam.brand.name})`
                    : 'Open Coach Workspace'
              }
              onClick={() => setActiveTab(activeTab === 'coach' ? 'fitness' : 'coach')}
              className={`min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-xl text-2xs font-mono font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activeTab === 'coach'
                  ? 'ap-nav-volt-active'
                  : 'liquid-capsule-track text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white'
              }`}
              title={
                activeTab === 'coach'
                  ? 'Switch back to your personal Athlete view'
                  : 'Open full-screen Coach Workspace (Clipboard, Team Plan, Stopwatch & Roster)'
              }
            >
              {activeTab === 'coach' ? (
                <>
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span className="sm:hidden">Exit</span>
                  <span className="hidden sm:inline">My Training</span>
                </>
              ) : (
                <>
                  <Users className="w-3.5 h-3.5 ap-text-brand" />
                  <span>
                    Coach
                    {activeTeam ? (
                      <span className="hidden sm:inline">
                        {` · ${activeTeam.brand.shortName || activeTeam.brand.name}`}
                      </span>
                    ) : null}
                  </span>
                </>
              )}
            </button>

            {myTeams.length > 0 && (
              <div className="hidden xl:inline-flex items-center gap-1 rounded-xl liquid-capsule-track px-2 py-1 shrink-0">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    backgroundColor:
                      activeTeam?.brand.primaryHex || 'var(--ap-thresh-vermilion)',
                  }}
                />
                <select
                  value={activeTeamId || ''}
                  onChange={(e) =>
                    onSelectActiveTeam(e.target.value ? e.target.value : null)
                  }
                  aria-label="Switch Active Team Workspace"
                  className="bg-transparent text-2xs font-mono font-bold text-slate-800 dark:text-slate-100 focus:outline-none cursor-pointer max-w-[110px] truncate"
                >
                  {myTeams.map((t) => (
                    <option
                      key={t.brand.teamId}
                      value={t.brand.teamId}
                      className="bg-white dark:bg-[#121715] text-slate-900 dark:text-white"
                    >
                      {t.brand.shortName || t.brand.name}
                    </option>
                  ))}
                  <option
                    value=""
                    className="bg-white dark:bg-[#121715] text-slate-900 dark:text-white"
                  >
                    Personal Mode
                  </option>
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={() => syncLiveTelemetry(true)}
              disabled={isSyncing}
              className="hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl liquid-capsule-track text-2xs font-mono text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
              title="Sync connected telemetry sources in the background"
            >
              <RefreshCw
                weight="bold"
                className={`w-3 h-3 ap-text-brand ${isSyncing ? 'animate-spin' : ''}`}
              />
              <span className="ap-text-brand font-semibold">
                {isSyncing
                  ? 'Syncing...'
                  : `Fitness ${latestWellness ? latestWellness.ctl.toFixed(0) : '—'}`}
              </span>
            </button>

            {(envFilter !== 'COMBINED' || selectedSport !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setEnvFilter('COMBINED');
                  setSelectedSport('ALL');
                }}
                className="min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl ap-status-caution text-2xs font-mono font-semibold transition-colors whitespace-nowrap cursor-pointer"
                title="Active viewport filter — click to reset to All Sports & Environments"
              >
                <span className="max-w-[140px] sm:max-w-none truncate">
                  Filter:{' '}
                  {[
                    envFilter === 'INDOOR'
                      ? 'Indoor'
                      : envFilter === 'OUTDOOR'
                        ? 'Outdoor'
                        : null,
                    selectedSport !== 'ALL' ? selectedSport : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span aria-hidden="true">×</span>
              </button>
            )}
          </div>

          {/* 2. Center: 3-Pillar Athlete Nav (Today | Training Calendar | Plan Builder) OR Coach Mode 4 Tabs */}
          <nav
            aria-label="Primary workspaces"
            className="hidden md:flex items-center gap-1 lg:gap-1.5 px-1 py-1 shrink-0"
          >
            {activeTab === 'coach' && onSelectCoachSubTab ? (
              (
                [
                  { id: 'CLIPBOARD', label: 'Clipboard', icon: ClipboardText },
                  { id: 'TEAM_PLAN', label: 'Team Plan', icon: Calendar },
                  { id: 'STOPWATCH', label: 'Stopwatch', icon: Timer },
                  { id: 'ROSTER', label: 'Roster', icon: Users },
                ] as const
              ).map((item) => {
                const NavIcon = item.icon;
                const isActive = coachSubTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`coach-subtab-${item.id.toLowerCase()}`}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => onSelectCoachSubTab(item.id)}
                    className={`min-h-[38px] inline-flex items-center px-2.5 lg:px-3 py-1 text-xs transition-all whitespace-nowrap shrink-0 cursor-pointer ap-track-tab ${
                      isActive ? 'ap-nav-volt-active' : 'ap-track-tab-idle'
                    }`}
                  >
                    <span className="ap-track-tab-inner">
                      <NavIcon
                        className="w-3.5 h-3.5"
                        weight={isActive ? 'fill' : 'duotone'}
                      />
                      <span>{item.label}</span>
                    </span>
                  </button>
                );
              })
            ) : (
              (
                [
                  {
                    id: 'fitness',
                    label: 'Today',
                    icon: HeartPulse,
                    href: '#fitness',
                    match: ['fitness', 'curves', 'trends', 'charts'],
                  },
                  {
                    id: 'calendar',
                    label: 'Training Calendar',
                    icon: Calendar,
                    href: '#calendar',
                    match: ['calendar', 'activities', 'stopwatch'],
                  },
                  {
                    id: 'totals',
                    label: 'Plan Builder',
                    icon: Target,
                    href: '#plan-builder',
                    match: ['totals'],
                  },
                ] as const
              ).map((item) => {
                const NavIcon = item.icon;
                const isActive = (item.match as readonly string[]).includes(activeTab);
                return (
                  <a
                    key={item.id}
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      setActiveTab(item.id);
                    }}
                    className={`min-h-[38px] inline-flex items-center px-2.5 lg:px-3.5 py-1 text-xs transition-all whitespace-nowrap shrink-0 ap-track-tab ${
                      isActive ? 'ap-nav-volt-active' : 'ap-track-tab-idle'
                    }`}
                  >
                    <span className="ap-track-tab-inner">
                      <NavIcon
                        className="w-3.5 h-3.5"
                        weight={isActive ? 'fill' : 'duotone'}
                      />
                      <span>{item.label}</span>
                    </span>
                  </a>
                );
              })
            )}
          </nav>

          {/* Right: Live Floating Stopwatch Pill + Athlete Switcher + Data Sources + AI Coach + Theme + Account */}
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            {activeTab !== 'stopwatch' && !(activeTab === 'coach' && coachSubTab === 'STOPWATCH') && (
              <div className="hidden sm:inline-flex shrink-0">
                <TracksideLiveHeaderPill
                  onOpenTracksidePad={() => {
                    if (activeTab === 'coach' && onSelectCoachSubTab) {
                      onSelectCoachSubTab('STOPWATCH');
                    } else {
                      setActiveTab('stopwatch');
                    }
                  }}
                  showIdleLauncher={false}
                />
              </div>
            )}

            {/* Athlete Context Switcher — shown only when part of a team or viewing a teammate */}
            {(myTeams.length > 0 || activeViewedAthleteId !== 'SELF') && (
              <div className="hidden xl:flex min-h-[36px] items-center gap-1 rounded-xl liquid-capsule-track px-2 py-1 border border-emerald-800/25 dark:border-emerald-700/40 min-w-0">
                <Users className="w-3.5 h-3.5 ap-text-brand shrink-0" weight="duotone" />
                <select
                  value={activeViewedAthleteId}
                  onChange={(e) => {
                    setActiveViewedAthleteId(e.target.value);
                    setSelectedActivity(null);
                  }}
                  aria-label="Switch Active Athlete Profile"
                  className="bg-transparent text-2xs font-mono font-semibold text-slate-800 dark:text-slate-100 focus:outline-none cursor-pointer pr-0.5 max-w-[130px] truncate"
                >
                  <option value="SELF" className="bg-white dark:bg-[#121715] text-slate-900 dark:text-white">
                    {primaryAthleteDisplayName} (You)
                  </option>
                  {combinedRoster
                    .filter((a) => a.status === 'CONNECTED')
                    .map((a) => (
                      <option key={a.id} value={a.id} className="bg-white dark:bg-[#121715] text-slate-900 dark:text-white">
                        {a.name} ({a.role === 'COACH_EDIT' ? 'Coach' : 'Teammate'})
                      </option>
                    ))}
                </select>
              </div>
            )}

            {/* Right Utility Cluster: Floating Live Stopwatch (active only) + Athlete Switcher + AI Coach + Theme + Account */}

            {/* AI Coach Action Button — Stadium Pine Instrument Pill */}
            <button
              type="button"
              onClick={onOpenCoach}
              aria-label="Open AI Coach"
              className="min-h-[44px] sm:min-h-[36px] min-w-[44px] sm:min-w-0 inline-flex items-center justify-center gap-1.5 py-1 px-2.5 sm:px-3.5 rounded-xl bg-[#1D3828] hover:bg-[#163022] text-white dark:bg-[#183122] dark:hover:bg-[#21422E] dark:text-[#C8FF00] border border-[#2B5B3F] text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer shadow-xs"
            >
              <Bot className="w-4 h-4 sm:w-3.5 sm:h-3.5" weight="fill" />
              <span className="hidden sm:inline">AI Coach</span>
            </button>

            {/* 1-Click Theme Toggle */}
            <button
              type="button"
              onClick={onToggleDark}
              className="min-h-[44px] w-[44px] sm:min-h-[36px] sm:w-[36px] inline-flex items-center justify-center rounded-xl liquid-glass-subtle hover:border-[#28573B] dark:hover:border-[#2E6B47] text-slate-700 dark:text-slate-200 transition-all cursor-pointer"
              title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDark ? (
                <Sun className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-[#C8FF00]" weight="fill" />
              ) : (
                <Moon className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-[#1D3828]" weight="fill" />
              )}
            </button>

            {/* Unified Account, Preferences & Logout Menu */}
            <div className="relative" ref={accountMenuRef}>
              <button
                ref={accountTriggerRef}
                type="button"
                onClick={() => setIsAccountMenuOpen((prev) => !prev)}
                aria-label={`Account and preferences menu (${primaryAthleteDisplayName})`}
                className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 sm:gap-2 pl-2 sm:pl-1.5 pr-2 sm:pr-2.5 py-1 rounded-xl liquid-glass-subtle hover:border-[#28573B] dark:hover:border-[#2E6B47] text-xs font-semibold text-slate-800 dark:text-slate-100 transition-all cursor-pointer"
                aria-expanded={isAccountMenuOpen}
                aria-haspopup="menu"
                title="Account, Profile Zones, Data Sources, Guide & Log Out"
              >
                {currentUser?.picture ? (
                  <img
                    src={currentUser.picture}
                    alt=""
                    className="w-6 h-6 rounded-lg object-cover border border-[#28573B] shrink-0"
                  />
                ) : (
                  <span className="w-6 h-6 rounded-lg bg-[#1D3828] text-[#C8FF00] border border-[#28573B] font-mono text-2xs font-bold flex items-center justify-center shadow-xs">
                    {primaryAthleteInitials}
                  </span>
                )}
                <span className="hidden xl:inline max-w-[90px] truncate">
                  {currentUser?.name || primaryAthleteDisplayName}
                </span>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-slate-600 dark:text-slate-400 transition-transform ${
                    isAccountMenuOpen ? 'rotate-180 ap-text-brand' : ''
                  }`}
                />
              </button>

              {isAccountMenuOpen && (
                <div
                  role="menu"
                  aria-label="Account and workspace settings"
                  className="absolute right-0 mt-2 w-[min(20rem,calc(100vw-1.5rem))] max-h-[82vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#101B15] border-2 border-[#28573B] dark:border-[#25573A] shadow-2xl p-3 space-y-3 z-50 text-xs"
                >
                  {/* Account Identity & Connection Summary */}
                  <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-slate-200/80 dark:border-white/10">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {currentUser?.picture ? (
                        <img
                          src={currentUser.picture}
                          alt=""
                          className="w-9 h-9 rounded-xl object-cover border border-[#28573B] shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-xl bg-[#1D3828] text-[#C8FF00] border border-[#28573B] font-mono text-xs font-bold flex items-center justify-center shrink-0">
                          {primaryAthleteInitials}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 dark:text-white truncate">
                          {currentUser?.name || primaryAthleteDisplayName}
                        </div>
                        {currentUser?.email && (
                          <div className="text-2xs text-slate-500 dark:text-slate-400 truncate">
                            {currentUser.email}
                          </div>
                        )}
                        <div className="text-2xs font-mono text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          <span className="truncate">
                            {effectiveActivities.length.toLocaleString()} workouts synced
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        syncLiveTelemetry(true);
                        setIsAccountMenuOpen(false);
                      }}
                      disabled={isSyncing}
                      className="min-h-[44px] sm:min-h-[34px] px-2.5 py-1.5 rounded-xl bg-[#C23800]/12 dark:bg-[#FC4C02]/15 hover:bg-[#C23800]/20 dark:hover:bg-[#FC4C02]/25 ap-text-strava font-mono text-2xs font-semibold flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                      title="Initiate a full Strava history sync in the background"
                    >
                      <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                      <span>{isSyncing ? 'Syncing...' : 'Sync'}</span>
                    </button>
                  </div>

                  {/* Section 1: Athlete & Coaching Settings */}
                  <div className="space-y-1">
                    <div className="px-2 text-2xs font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400">
                      Athlete &amp; Connections
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onOpenDataSources();
                        setIsAccountMenuOpen(false);
                      }}
                      className="w-full min-h-[44px] sm:min-h-[38px] flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <Database className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        <span>Data Sources (Strava, Garmin &amp; Intervals)</span>
                      </span>
                      <span className="font-mono text-2xs text-emerald-600 dark:text-emerald-400">
                        {anySourceConnected ? 'Active ●' : 'Connect'}
                      </span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onOpenProfileModal();
                        setIsAccountMenuOpen(false);
                      }}
                      className="w-full min-h-[44px] sm:min-h-[38px] flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <Sliders className="w-4 h-4 ap-text-brand" />
                        <span>Profile, Thresholds &amp; Zones</span>
                      </span>
                      <span className="font-mono text-2xs font-bold ap-text-brand bg-emerald-500/10 px-2 py-0.5 rounded-md">
                        {effectiveAthleteProfile.primarySport === 'Running'
                          ? (() => {
                              const secs = Math.max(
                                150,
                                Math.round(effectiveAthleteProfile.thresholdPaceSecsPerKm || 250)
                              );
                              return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}/km`;
                            })()
                          : `${effectiveAthleteProfile.ftp}W`}
                      </span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      data-testid="open-roster-modal"
                      onClick={() => {
                        onOpenRosterModalWithTab('TEAMS_BRANDING');
                        setIsAccountMenuOpen(false);
                      }}
                      className="w-full min-h-[44px] sm:min-h-[38px] flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        <span>Teams, Bulk Invites &amp; Roster</span>
                      </span>
                      <span className="font-mono text-2xs text-slate-600 dark:text-slate-400">
                        {myTeams.length > 0
                          ? `${myTeams.length} team${myTeams.length === 1 ? '' : 's'}`
                          : 'Manage'}
                      </span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onOpenGuide();
                        setIsAccountMenuOpen(false);
                      }}
                      className="w-full min-h-[44px] sm:min-h-[38px] flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <HelpCircle className="w-4 h-4 text-amber-500" />
                        <span>User Guide &amp; Metrics Glossary</span>
                      </span>
                      <span className="font-mono text-2xs text-slate-600 dark:text-slate-400">
                        Help
                      </span>
                    </button>
                  </div>

                  {/* Section 2: Quick Display Preferences (Units, Modality, Theme) */}
                  <div className="space-y-2 pt-2 border-t border-slate-200/80 dark:border-white/10">
                    <div className="px-2 text-2xs font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400">
                      Display Preferences
                    </div>

                    {/* Modality Filter */}
                    <div className="flex items-center justify-between px-2">
                      <span className="text-slate-600 dark:text-slate-300 font-medium">
                        Environment
                      </span>
                      <div className="flex items-center gap-0.5 p-0.5 rounded-lg liquid-capsule-track text-2xs">
                        {(
                          [
                            { id: 'COMBINED', label: 'All' },
                            { id: 'OUTDOOR', label: 'Outdoor' },
                            { id: 'INDOOR', label: 'Indoor' },
                          ] as const
                        ).map((env) => (
                          <button
                            key={env.id}
                            type="button"
                            role="menuitemradio"
                            aria-checked={envFilter === env.id}
                            onClick={() => setEnvFilter(env.id)}
                            className={`min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                              envFilter === env.id
                                ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {env.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Distance Units Row */}
                    <div className="flex items-center justify-between px-2">
                      <span className="text-slate-600 dark:text-slate-300 font-medium">
                        Distance Units
                      </span>
                      <div className="flex items-center gap-0.5 p-0.5 rounded-lg liquid-capsule-track font-mono text-2xs">
                        {(['mi', 'km'] as const).map((u) => (
                          <button
                            key={u}
                            type="button"
                            role="menuitemradio"
                            aria-checked={distanceUnit === u}
                            onClick={() => {
                              setDistanceUnit(u);
                              try {
                                localStorage.setItem('thresh_distance_unit_user_set', '1');
                              } catch {
                                // ignore
                              }
                            }}
                            className={`min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                              distanceUnit === u
                                ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {u}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="px-2 pt-0.5">
                      <PWAInstallButton variant="compact" />
                    </div>
                  </div>

                  {/* Section 3: Session & Logout Controls */}
                  <div className="pt-2 border-t border-slate-200/80 dark:border-white/10 space-y-1">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={onLogoutSession}
                      className="w-full min-h-[44px] sm:min-h-[38px] flex items-center justify-between px-2.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-300 font-semibold transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <LogOut className="w-4 h-4" weight="bold" />
                        <span>Back to Welcome / Sign Out</span>
                      </span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={onLogoutAndClearData}
                      className="w-full min-h-[44px] sm:min-h-[34px] flex items-center justify-between px-2.5 py-1.5 rounded-xl hover:bg-rose-500/10 text-rose-700/80 dark:text-rose-300/80 hover:text-rose-700 dark:hover:text-rose-300 text-2xs transition-colors cursor-pointer"
                    >
                      <span>Disconnect All Credentials &amp; Reset</span>
                      <span className="font-mono text-2xs">Reset</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile & Compact (< xl) Context Strip: suppressed in live stopwatch timing to preserve viewport */}
        {activeTab !== 'stopwatch' &&
          !(activeTab === 'coach' && coachSubTab === 'STOPWATCH') &&
          ((activeTab !== 'coach' && hasActiveStopwatchPill) ||
            myTeams.length > 0 ||
            activeViewedAthleteId !== 'SELF') && (
          <div className="xl:hidden mt-2 pt-2 border-t border-emerald-900/10 dark:border-white/10 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {activeTab !== 'coach' && (
              <div className="sm:hidden shrink-0">
                <TracksideLiveHeaderPill
                  onOpenTracksidePad={() => setActiveTab('stopwatch')}
                  showIdleLauncher={false}
                />
              </div>
            )}
            {myTeams.length > 0 && (
              <div className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl liquid-capsule-track px-2.5 py-1 shrink-0">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    backgroundColor:
                      activeTeam?.brand.primaryHex || 'var(--ap-thresh-vermilion)',
                  }}
                />
                <select
                  value={activeTeamId || ''}
                  onChange={(e) =>
                    onSelectActiveTeam(e.target.value ? e.target.value : null)
                  }
                  aria-label="Switch Active Team Workspace (Mobile)"
                  className="bg-transparent text-xs font-mono font-bold text-slate-800 dark:text-slate-100 focus:outline-none max-w-[110px] truncate"
                >
                  {myTeams.map((t) => (
                    <option
                      key={t.brand.teamId}
                      value={t.brand.teamId}
                      className="bg-white dark:bg-[#121715] text-slate-900 dark:text-white"
                    >
                      {t.brand.shortName || t.brand.name}
                    </option>
                  ))}
                  <option
                    value=""
                    className="bg-white dark:bg-[#121715] text-slate-900 dark:text-white"
                  >
                    Personal Mode
                  </option>
                </select>
              </div>
            )}

            {(myTeams.length > 0 || activeViewedAthleteId !== 'SELF') && (
              <div className="min-h-[44px] inline-flex items-center gap-1 rounded-xl liquid-capsule-track px-2.5 py-1 shrink-0">
                <Users className="w-3.5 h-3.5 ap-text-brand shrink-0" weight="duotone" />
                <select
                  value={activeViewedAthleteId}
                  onChange={(e) => {
                    setActiveViewedAthleteId(e.target.value);
                    setSelectedActivity(null);
                  }}
                  aria-label="Switch Active Athlete Profile (Mobile)"
                  className="bg-transparent text-xs font-mono font-semibold text-slate-800 dark:text-slate-100 focus:outline-none max-w-[125px] truncate"
                >
                  <option value="SELF" className="bg-white dark:bg-[#121715] text-slate-900 dark:text-white">
                    {primaryAthleteDisplayName} (You)
                  </option>
                  {combinedRoster
                    .filter((a) => a.status === 'CONNECTED')
                    .map((a) => (
                      <option key={a.id} value={a.id} className="bg-white dark:bg-[#121715] text-slate-900 dark:text-white">
                        {a.name}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>
        )}
      </header>
    </div>
  );
};
