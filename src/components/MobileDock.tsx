import React from 'react';
import type { ActiveTab } from '../types';
import {
  HeartPulse,
  Calendar,
  Activity,
  Target,
  Timer,
} from './icons/PhosphorIcons';

export interface MobileDockProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  lastProgressTab?: ActiveTab;
}

export const MobileDock: React.FC<MobileDockProps> = ({
  activeTab,
  onSelectTab,
  lastProgressTab = 'totals',
}) => {
  const tabs = [
    {
      id: 'fitness' as const,
      label: 'Today',
      icon: HeartPulse,
      match: ['fitness'],
    },
    {
      id: 'calendar' as const,
      label: 'Plan',
      icon: Calendar,
      match: ['calendar'],
    },
    {
      id: 'stopwatch' as const,
      label: 'Stopwatch',
      icon: Timer,
      match: ['stopwatch'],
    },
    {
      id: 'activities' as const,
      label: 'Activities',
      icon: Activity,
      match: ['activities'],
    },
    {
      id: 'totals' as const,
      label: 'Progress',
      icon: Target,
      match: ['totals', 'curves', 'trends', 'charts'],
    },
  ] as const;

  return (
    <nav
      aria-label="Mobile primary workspaces"
      className="md:hidden fixed bottom-2 left-3 right-3 z-40 rounded-2xl liquid-glass-header grid grid-cols-5 items-center min-h-[58px] px-1.5 py-1 ap-mobile-dock"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = (tab.match as readonly string[]).includes(activeTab);
        return (
          <button
            key={tab.id}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() =>
              onSelectTab(
                tab.id === 'totals'
                  ? isActive
                    ? 'totals'
                    : lastProgressTab
                  : tab.id
              )
            }
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
