import React from 'react';
import type { ActiveTab, CoachWorkspaceSubTab } from '../types';
import {
  HeartPulse,
  Calendar,
  Target,
  Timer,
  ClipboardText,
  Users,
} from './icons/PhosphorIcons';

export interface MobileDockProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  lastProgressTab?: ActiveTab;
  coachSubTab?: CoachWorkspaceSubTab;
  onSelectCoachSubTab?: (subTab: CoachWorkspaceSubTab) => void;
}

export const MobileDock: React.FC<MobileDockProps> = ({
  activeTab,
  onSelectTab,
  coachSubTab = 'CLIPBOARD',
  onSelectCoachSubTab,
}) => {
  if (activeTab === 'coach' && onSelectCoachSubTab) {
    const coachTabs: ReadonlyArray<{
      id: CoachWorkspaceSubTab;
      label: string;
      icon: typeof ClipboardText;
    }> = [
      { id: 'CLIPBOARD', label: 'Clipboard', icon: ClipboardText },
      { id: 'TEAM_PLAN', label: 'Team Plan', icon: Calendar },
      { id: 'STOPWATCH', label: 'Stopwatch', icon: Timer },
      { id: 'ROSTER', label: 'Roster', icon: Users },
    ];

    return (
      <nav
        aria-label="Mobile primary workspaces"
        className="md:hidden fixed bottom-2 left-3 right-3 z-40 rounded-2xl liquid-glass-header grid grid-cols-4 items-center min-h-[58px] px-1.5 py-1 ap-mobile-dock"
      >
        {coachTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = coachSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onSelectCoachSubTab(tab.id)}
              className={`min-h-[46px] flex flex-col items-center justify-center rounded-xl transition-all cursor-pointer ${
                isActive
                  ? 'ap-nav-volt-active'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Icon className="w-4 h-4" weight={isActive ? 'fill' : 'duotone'} />
              <span className="text-2xs tracking-tight mt-0.5 whitespace-nowrap">
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>
    );
  }

  const tabs = [
    {
      id: 'fitness' as const,
      label: 'Today',
      icon: HeartPulse,
      match: ['fitness', 'curves', 'trends', 'charts'],
    },
    {
      id: 'calendar' as const,
      label: 'Calendar',
      icon: Calendar,
      match: ['calendar', 'activities', 'stopwatch'],
    },
    {
      id: 'totals' as const,
      label: 'Plan Builder',
      icon: Target,
      match: ['totals'],
    },
  ] as const;

  return (
    <nav
      aria-label="Mobile primary workspaces"
      className="md:hidden fixed bottom-2 left-3 right-3 z-40 rounded-2xl liquid-glass-header grid grid-cols-3 items-center min-h-[58px] px-1.5 py-1 ap-mobile-dock"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = (tab.match as readonly string[]).includes(activeTab);
        return (
          <button
            key={tab.id}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelectTab(tab.id)}
            className={`min-h-[46px] flex flex-col items-center justify-center rounded-xl transition-all cursor-pointer ${
              isActive
                ? 'ap-nav-volt-active'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Icon className="w-4 h-4" weight={isActive ? 'fill' : 'duotone'} />
            <span className="text-2xs tracking-tight mt-0.5 whitespace-nowrap">
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
