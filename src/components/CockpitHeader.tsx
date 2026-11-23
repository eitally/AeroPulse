import React, { useState, useEffect, useRef } from 'react';
import { AeroPulseLogo } from './AeroPulseLogo';
import { formatPace } from '../utils/formatters';
import type {
  DaytimePalette,
  EffectiveThemeVariant,
  SundownPolicy,
} from '../utils/sundownThemeEngine';
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
  TrendingUp,
  HelpCircle,
  LogOut,
  MessageSquare,
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
  onOpenTeamMessages?: () => void;
  isDark: boolean;
  onToggleDark: () => void;
  activeThemeVariant?: EffectiveThemeVariant;
  daytimePalette?: DaytimePalette;
  onSelectDaytimePalette?: (palette: DaytimePalette) => void;
  sundownPolicy?: SundownPolicy;
  onSelectSundownPolicy?: (policy: SundownPolicy) => void;
  sunsetLabel12h?: string;
  currentUser: ThreshUser | null;
  effectiveActivities: UnifiedActivity[];
  effectiveAthleteProfile: AthleteProfile;
  onOpenProfileModal: () => void;
  onOpenGuide: () => void;
  distanceUnit: DistanceUnit;
  setDistanceUnit: (unit: DistanceUnit) => void;
  isSampleDemoMode?: boolean;
  plainLanguageMode?: boolean;
  onTogglePlainLanguage?: () => void;
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
  isDark,
  onToggleDark,
  activeThemeVariant = isDark ? 'TRACK_PINE' : 'DAYLIGHT',
  daytimePalette = isDark ? 'TRACK_PINE' : 'DAYLIGHT',
  onSelectDaytimePalette,
  sundownPolicy = 'AUTO_MIDNIGHT_SLATE',
  onSelectSundownPolicy,
  sunsetLabel12h = '6:00 PM',
  combinedRoster,
  anySourceConnected,
  onOpenDataSources,
  onOpenCoach,
  onOpenTeamMessages,
  currentUser,
  effectiveActivities,
  effectiveAthleteProfile,
  onOpenProfileModal,
  onOpenGuide,
  distanceUnit,
  setDistanceUnit,
  isSampleDemoMode = false,
  plainLanguageMode = false,
  onTogglePlainLanguage,
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

  const hasCoachOnboardingRole = (() => {
    try {
      return (
        typeof window !== 'undefined' &&
        (localStorage.getItem('thresh_onboarding_role') === 'COACH' ||
          sessionStorage.getItem('thresh_onboarding_role') === 'COACH')
      );
    } catch {
      return false;
    }
  })();
  const showCoachSwitchInHeader =
    activeTab === 'coach' ||
    myTeams.length > 0 ||
    isSampleDemoMode ||
    hasCoachOnboardingRole;

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
    <header className="sticky top-0 z-40 w-full liquid-glass-header">
      <div className="ap-container py-1.5 sm:py-2">
        <div className="flex flex-nowrap items-center justify-between gap-1.5 sm:gap-2 min-w-0">
          {/* 1. Brand Wordmark (Co-Branded when Team Active) + Multi-Team Switcher + Telemetry Sync Pill */}
          <div className="flex items-center gap-1.5 xl:gap-2 shrink-0">
            <a
              href="#fitness"
              aria-label={
                activeTeam?.brand
                  ? `${activeTeam.brand.shortName || activeTeam.brand.name} on MeetReady Home`
                  : 'MeetReady Home'
              }
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('fitness');
              }}
              className="min-h-[44px] sm:min-h-[36px] inline-flex items-center whitespace-nowrap min-w-0 shrink-0"
            >
              {activeTeam?.brand ? (
                <>
                  <span className="inline-flex xl:hidden">
                    <AeroPulseLogo size="sm" mode="mark-only" teamBrand={activeTeam.brand} />
                  </span>
                  <span className="hidden xl:inline-flex">
                    <AeroPulseLogo size="sm" teamBrand={activeTeam.brand} />
                  </span>
                </>
              ) : (
                <>
                  <span className="inline-flex min-[380px]:hidden">
                    <AeroPulseLogo size="sm" mode="mark-only" teamBrand={null} />
                  </span>
                  <span className="hidden min-[380px]:inline-flex">
                    <AeroPulseLogo size="sm" mode="horizontal" teamBrand={null} />
                  </span>
                </>
              )}
            </a>

            {showCoachSwitchInHeader && (
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
                onClick={() => {
                  if (activeTab !== 'coach' && activeViewedAthleteId !== 'SELF') {
                    setActiveViewedAthleteId('SELF');
                    setSelectedActivity(null);
                  }
                  setActiveTab(activeTab === 'coach' ? 'fitness' : 'coach');
                }}
                className={`min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1 px-2 sm:px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  activeTab === 'coach'
                    ? 'ap-card-inset text-ap-ink dark:text-ap-chalk border border-ap-frame/20 dark:border-white/20'
                    : 'ap-card-inset text-ap-ink dark:text-ap-chalk hover:bg-[#e3dfd3] dark:hover:bg-[#242826]'
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
                    <span className="lg:hidden">Exit</span>
                    <span className="hidden lg:inline">My Training</span>
                  </>
                ) : (
                  <>
                    <Users className="w-3.5 h-3.5 ap-text-brand" />
                    <span className={activeViewedAthleteId !== 'SELF' ? 'hidden 2xl:inline' : undefined}>
                      Coach
                    </span>
                  </>
                )}
              </button>
            )}

            {myTeams.length > 1 && activeTab !== 'coach' && (
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
                  className="bg-transparent text-2xs font-mono font-bold text-slate-800 dark:text-slate-100 cursor-pointer max-w-[110px] truncate rounded"
                >
                  {myTeams.map((t) => (
                    <option
                      key={t.brand.teamId}
                      value={t.brand.teamId}
                      className="bg-white dark:bg-ap-carbon text-slate-900 dark:text-white"
                    >
                      {t.brand.shortName || t.brand.name}
                    </option>
                  ))}
                  <option
                    value=""
                    className="bg-white dark:bg-ap-carbon text-slate-900 dark:text-white"
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
              className="hidden 2xl:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl liquid-capsule-track text-2xs font-mono text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer shrink-0"
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

          {/* 2. Center: 4-Pillar Athlete Nav (Today | Training Calendar | Progress | Plan Builder) OR Coach Mode 4 Tabs */}
          <nav
            aria-label="Primary workspaces"
            className="hidden md:flex items-center justify-center gap-0.5 lg:gap-1 px-1 py-1 min-w-0"
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
                    className={`min-h-[38px] inline-flex items-center px-1.5 lg:px-2.5 xl:px-3 py-1 text-2xs lg:text-xs transition-all whitespace-nowrap shrink-0 cursor-pointer ap-track-tab ${
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
                    href: '#today',
                    match: ['fitness'],
                  },
                  {
                    id: 'calendar',
                    label: 'Training Calendar',
                    icon: Calendar,
                    href: '#calendar',
                    match: ['calendar', 'activities', 'stopwatch'],
                  },
                  {
                    id: 'curves',
                    label: 'Progress',
                    icon: TrendingUp,
                    href: '#progress',
                    match: ['curves', 'trends', 'charts'],
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
                    className={`min-h-[38px] inline-flex items-center px-1.5 lg:px-2 2xl:px-3 py-1 text-2xs lg:text-xs transition-all whitespace-nowrap shrink-0 ap-track-tab ${
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
          <div className="flex items-center gap-1 shrink-0">
            {activeTab !== 'stopwatch' && !(activeTab === 'coach' && coachSubTab === 'STOPWATCH') && (
              <div className="hidden lg:inline-flex shrink-0">
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

            {/* Athlete Context Switcher — shown only in Personal mode when inspecting another athlete */}
            {activeViewedAthleteId !== 'SELF' && activeTab !== 'coach' && (
              <div className="hidden xl:flex min-h-[36px] items-center gap-1 rounded-xl liquid-capsule-track px-2 py-1 border border-ap-frame/25 dark:border-white/20 min-w-0">
                <Users className="w-3.5 h-3.5 ap-text-brand shrink-0" weight="duotone" />
                <select
                  value={activeViewedAthleteId}
                  onChange={(e) => {
                    setActiveViewedAthleteId(e.target.value);
                    setSelectedActivity(null);
                  }}
                  aria-label="Switch Active Athlete Profile"
                  className="bg-transparent text-2xs font-mono font-semibold text-slate-800 dark:text-slate-100 cursor-pointer pr-0.5 max-w-[84px] 2xl:max-w-[130px] truncate rounded"
                >
                  <option value="SELF" className="bg-white dark:bg-ap-carbon text-slate-900 dark:text-white">
                    {primaryAthleteDisplayName} (You)
                  </option>
                  {combinedRoster
                    .filter((a) => a.status === 'CONNECTED')
                    .map((a) => (
                      <option key={a.id} value={a.id} className="bg-white dark:bg-ap-carbon text-slate-900 dark:text-white">
                        {a.name} ({a.role === 'COACH_EDIT' ? 'Coach' : 'Teammate'})
                      </option>
                    ))}
                </select>
              </div>
            )}

            {/* Right Utility Cluster: Floating Live Stopwatch (active only) + Athlete Switcher + Team Chat + AI Coach + Theme + Account */}

            {activeTeam && onOpenTeamMessages && (
              <button
                type="button"
                data-testid="open-team-messages-btn"
                onClick={onOpenTeamMessages}
                aria-label="Open Team Messaging"
                className="relative min-h-[44px] w-[44px] lg:w-auto sm:min-h-[36px] inline-flex items-center justify-center gap-1.5 py-1 lg:px-2.5 xl:px-3 rounded-lg ap-btn-secondary text-xs font-semibold whitespace-nowrap cursor-pointer shrink-0"
              >
                <MessageSquare className="w-4 h-4 sm:w-3.5 sm:h-3.5 ap-text-brand" />
                <span className="hidden lg:inline">Team Chat</span>
                {(activeTeam.teamMessages?.length || 0) > 0 && (
                  <span className="hidden lg:inline px-1.5 py-0.5 rounded-full text-2xs font-mono font-bold bg-[#EDE9DF] text-[#121413] dark:bg-[#242826] dark:text-[#D8FF2A]">
                    {activeTeam.teamMessages!.length}
                  </span>
                )}
              </button>
            )}

            {/* AI Coach Action Button — Track Asphalt Instrument Pill */}
            <button
              type="button"
              onClick={onOpenCoach}
              aria-label="Open AI Coach"
              className="min-h-[44px] sm:min-h-[36px] min-w-[44px] lg:min-w-0 inline-flex items-center justify-center gap-1.5 py-1 px-2 lg:px-2.5 2xl:px-3.5 rounded-lg bg-[#121413] hover:bg-[#242826] text-[#F6F3EC] dark:bg-[#1A1D1B] dark:hover:bg-[#242826] dark:text-[#D8FF2A] border border-[#121413] dark:border-white/25 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              <Bot className="w-4 h-4 sm:w-3.5 sm:h-3.5" weight="fill" />
              <span className="hidden lg:inline">AI Coach</span>
            </button>

            {/* 1-Click Theme Toggle */}
            <button
              type="button"
              onClick={onToggleDark}
              className="min-h-[44px] w-[44px] sm:min-h-[36px] sm:w-[36px] inline-flex items-center justify-center rounded-lg ap-card-inset hover:border-ap-frame/35 dark:hover:border-white/30 text-ap-ink dark:text-ap-chalk transition-all cursor-pointer"
              title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDark ? (
                <Sun className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-ap-volt" weight="fill" />
              ) : (
                <Moon className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-[#121413]" weight="fill" />
              )}
            </button>

            {/* Unified Account, Preferences & Logout Menu */}
            <div className="relative" ref={accountMenuRef}>
              <button
                ref={accountTriggerRef}
                type="button"
                onClick={() => setIsAccountMenuOpen((prev) => !prev)}
                aria-label={`Account and preferences menu (${primaryAthleteDisplayName})`}
                className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 sm:gap-2 pl-2 sm:pl-1.5 pr-2 sm:pr-2.5 py-1 rounded-lg ap-card-inset hover:border-ap-frame/35 dark:hover:border-white/30 text-xs font-semibold text-ap-ink dark:text-ap-chalk transition-all cursor-pointer"
                aria-expanded={isAccountMenuOpen}
                aria-haspopup="menu"
                title="Account, Profile Zones, Data Sources, Guide & Log Out"
              >
                {currentUser?.picture ? (
                  <img
                    src={currentUser.picture}
                    alt=""
                    className="w-6 h-6 rounded-md object-cover border border-ap-frame/25 shrink-0"
                  />
                ) : (
                  <span className="w-6 h-6 rounded-md bg-[#121413] text-ap-volt border border-ap-frame/30 font-mono text-2xs font-bold flex items-center justify-center">
                    {primaryAthleteInitials}
                  </span>
                )}
                <span className="hidden 2xl:inline max-w-[90px] truncate">
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
                  className="absolute right-0 mt-2 w-[min(20rem,calc(100vw-1.5rem))] max-h-[82vh] overflow-y-auto rounded-2xl bg-white dark:bg-ap-carbon border border-ap-frame dark:border-white/25 shadow-2xl p-3 space-y-3 z-50 text-xs"
                >
                  {/* Account Identity & Connection Summary */}
                  <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-slate-200/80 dark:border-white/10">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {currentUser?.picture ? (
                        <img
                          src={currentUser.picture}
                          alt=""
                          className="w-9 h-9 rounded-xl object-cover border border-ap-frame/40 shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-xl bg-[#121413] text-ap-volt border border-ap-frame/30 font-mono text-xs font-bold flex items-center justify-center shrink-0">
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
                        <div className="text-2xs font-mono text-[#1E4D36] dark:text-[#86efac] flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#1E4D36] dark:bg-[#4ade80]" />
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
                        <Database className="w-4 h-4 text-[#1E4D36] dark:text-[#86efac]" />
                        <span>Data Sources (Strava, Garmin &amp; Intervals)</span>
                      </span>
                      <span className="font-mono text-2xs text-[#1E4D36] dark:text-[#86efac]">
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
                      <span className="font-mono text-2xs font-bold ap-text-brand bg-ap-clay/10 dark:bg-ap-volt/10 px-2 py-0.5 rounded-md">
                        {effectiveAthleteProfile.primarySport === 'Running'
                          ? formatPace(
                              Math.max(
                                150,
                                Math.round(effectiveAthleteProfile.thresholdPaceSecsPerKm || 250)
                              ),
                              distanceUnit
                            )
                          : `${effectiveAthleteProfile.ftp}W`}
                      </span>
                    </button>

                    {onSelectCoachSubTab && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setActiveTab('coach');
                          onSelectCoachSubTab('ROSTER');
                          setIsAccountMenuOpen(false);
                        }}
                        className="w-full min-h-[44px] sm:min-h-[38px] flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                      >
                        <span className="flex items-center gap-2 font-medium">
                          <ClipboardText className="w-4 h-4 text-ap-clay dark:text-ap-volt" />
                          <span>Coach &amp; Team Setup</span>
                        </span>
                        <span className="font-mono text-2xs text-slate-600 dark:text-slate-400">
                          {myTeams.length > 0
                            ? `${myTeams.length} team${myTeams.length === 1 ? '' : 's'}`
                            : 'Open'}
                        </span>
                      </button>
                    )}

                    <button
                      type="button"
                      role="menuitem"
                      data-testid="open-roster-modal"
                      onClick={() => {
                        onOpenRosterModalWithTab('CONNECT_INVITE');
                        setIsAccountMenuOpen(false);
                      }}
                      className="w-full min-h-[44px] sm:min-h-[38px] flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <Users className="w-4 h-4 text-ap-clay dark:text-ap-volt" />
                        <span>Account, Teams &amp; Privacy</span>
                      </span>
                      <span className="font-mono text-2xs text-slate-600 dark:text-slate-400">
                        {myTeams.length > 0
                          ? `${myTeams.length} team${myTeams.length === 1 ? '' : 's'}`
                          : 'Privacy'}
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

                    {onTogglePlainLanguage && (
                      <div className="flex items-center justify-between px-2">
                        <span
                          className="text-slate-600 dark:text-slate-300 font-medium"
                          title="Simplify readiness and workload terms on Today"
                        >
                          Plain Language Labels
                        </span>
                        <button
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={plainLanguageMode}
                          data-testid="toggle-plain-language"
                          onClick={onTogglePlainLanguage}
                          className={`min-h-[44px] sm:min-h-[32px] px-3 py-1 rounded-lg font-mono text-2xs font-semibold transition-all cursor-pointer ${
                            plainLanguageMode
                              ? 'ap-nav-volt-active'
                              : 'liquid-capsule-track text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {plainLanguageMode ? 'Plain On' : 'Standard'}
                        </button>
                      </div>
                    )}

                    {/* Unified Light / Dark / Auto Appearance Control */}
                    {onSelectDaytimePalette && onSelectSundownPolicy && (
                      <div className="px-2 pt-1.5 space-y-2 border-t border-slate-200/70 dark:border-white/10">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className="text-slate-600 dark:text-slate-300 font-medium"
                            title={`Auto switches to Midnight Slate around local sunset (~${sunsetLabel12h})`}
                          >
                            Appearance
                          </span>
                          <div className="flex items-center gap-0.5 p-0.5 rounded-lg liquid-capsule-track text-2xs">
                            {(
                              [
                                { id: 'DAYTIME_ONLY', label: 'Light' },
                                { id: 'ALWAYS_MIDNIGHT_SLATE', label: 'Dark' },
                                { id: 'AUTO_MIDNIGHT_SLATE', label: 'Auto' },
                              ] as const
                            ).map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                role="menuitemradio"
                                aria-checked={sundownPolicy === opt.id}
                                onClick={() => onSelectSundownPolicy(opt.id)}
                                className={`min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                                  sundownPolicy === opt.id
                                    ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                                    : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {sundownPolicy !== 'ALWAYS_MIDNIGHT_SLATE' && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-600 dark:text-slate-300 font-medium">
                              Daytime Tint
                            </span>
                            <div className="flex items-center gap-0.5 p-0.5 rounded-lg liquid-capsule-track text-2xs">
                              {(
                                [
                                  { id: 'DAYLIGHT', label: 'Daylight' },
                                  { id: 'TRACK_PINE', label: 'Track Pine' },
                                ] as const
                              ).map((opt) => (
                                <button
                                  key={opt.id}
                                  type="button"
                                  role="menuitemradio"
                                  aria-checked={daytimePalette === opt.id}
                                  onClick={() => onSelectDaytimePalette(opt.id)}
                                  className={`min-h-[44px] sm:min-h-[32px] px-2 py-1 rounded-md transition-all cursor-pointer ${
                                    daytimePalette === opt.id
                                      ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                                      : 'text-slate-500 dark:text-slate-400'
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="px-2 pt-0.5">
                      <PWAInstallButton variant="compact" />
                    </div>
                  </div>

                  {/* Section 3: Session & Logout Controls */}
                  <div className="pt-2 border-t border-slate-200/80 dark:border-white/10 space-y-1">
                    <button
                      type="button"
                      role="menuitem"
                      aria-label="Back to Welcome / Sign Out"
                      onClick={onLogoutSession}
                      className="w-full min-h-[44px] sm:min-h-[38px] flex items-center justify-between px-2.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-300 font-semibold transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <LogOut className="w-4 h-4" weight="bold" />
                        <span>Sign Out</span>
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

        {/* Mobile (< md) Context Strip: strictly hidden on >= md/lg and during live stopwatch timing */}
        {activeTab !== 'stopwatch' &&
          !(activeTab === 'coach' && coachSubTab === 'STOPWATCH') &&
          ((activeTab !== 'coach' && hasActiveStopwatchPill) ||
            myTeams.length > 0 ||
            activeViewedAthleteId !== 'SELF') && (
          <div className="md:hidden mt-2 pt-2 border-t border-ap-frame/15 dark:border-white/10 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {activeTab !== 'coach' && (
              <div className="shrink-0">
                <TracksideLiveHeaderPill
                  onOpenTracksidePad={() => setActiveTab('stopwatch')}
                  showIdleLauncher={false}
                />
              </div>
            )}
            {myTeams.length > 0 && activeTab !== 'coach' && (
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
                  className="bg-transparent text-xs font-mono font-bold text-slate-800 dark:text-slate-100 max-w-[110px] truncate rounded"
                >
                  {myTeams.map((t) => (
                    <option
                      key={t.brand.teamId}
                      value={t.brand.teamId}
                      className="bg-white dark:bg-ap-carbon text-slate-900 dark:text-white"
                    >
                      {t.brand.shortName || t.brand.name}
                    </option>
                  ))}
                  <option
                    value=""
                    className="bg-white dark:bg-ap-carbon text-slate-900 dark:text-white"
                  >
                    Personal Mode
                  </option>
                </select>
              </div>
            )}

            {(myTeams.length > 0 || activeViewedAthleteId !== 'SELF') && activeTab !== 'coach' && (
              <div className="min-h-[44px] inline-flex items-center gap-1 rounded-xl liquid-capsule-track px-2.5 py-1 shrink-0">
                <Users className="w-3.5 h-3.5 ap-text-brand shrink-0" weight="duotone" />
                <select
                  value={activeViewedAthleteId}
                  onChange={(e) => {
                    setActiveViewedAthleteId(e.target.value);
                    setSelectedActivity(null);
                  }}
                  aria-label="Switch Active Athlete Profile (Mobile)"
                  className="bg-transparent text-xs font-mono font-semibold text-slate-800 dark:text-slate-100 max-w-[125px] truncate rounded"
                >
                  <option value="SELF" className="bg-white dark:bg-ap-carbon text-slate-900 dark:text-white">
                    {primaryAthleteDisplayName} (You)
                  </option>
                  {combinedRoster
                    .filter((a) => a.status === 'CONNECTED')
                    .map((a) => (
                      <option key={a.id} value={a.id} className="bg-white dark:bg-ap-carbon text-slate-900 dark:text-white">
                        {a.name}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
