import React, { useId, useRef } from 'react';
import {
  Activity,
  Calendar,
  Globe,
  HelpCircle,
  Layers,
  Shield,
  Target,
  Users,
  X,
} from '../icons/PhosphorIcons';
import { useModalDialog } from '../../hooks/useModalDialog';
import type { CoachComplexityTier, TeamSummaryWithRole } from '../../types';

export interface CoachDeskDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeTeam: TeamSummaryWithRole | null;
  myTeams: TeamSummaryWithRole[];
  activeTeamId: string | null;
  onSelectActiveTeam: (teamId: string | null) => void;
  complexityTier: CoachComplexityTier;
  onSetComplexityTier: (tier: CoachComplexityTier) => void;
  onOpenWizard: () => void;
  onOpenCohortPlanBuilder: () => void;
  onOpenExternalSync: () => void;
  onOpenDistrictOverview?: () => void;
  onOpenCoachGuide?: () => void;
  onOpenTeamStaffTab: () => void;
  onOpenProfileModal?: () => void;
}

export const CoachDeskDrawer: React.FC<CoachDeskDrawerProps> = ({
  isOpen,
  onClose,
  activeTeam,
  myTeams,
  activeTeamId,
  onSelectActiveTeam,
  complexityTier,
  onSetComplexityTier,
  onOpenWizard,
  onOpenCohortPlanBuilder,
  onOpenExternalSync,
  onOpenDistrictOverview,
  onOpenCoachGuide,
  onOpenTeamStaffTab,
  onOpenProfileModal,
}) => {
  const headingId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useModalDialog({
    isOpen,
    onClose,
    dialogRef,
  });

  if (!isOpen) return null;

  const canSeeDistrictOverview = Boolean(
    onOpenDistrictOverview &&
      myTeams.some((t) => t.myRole === 'HEAD_COACH' || t.myRole === 'ORG_ADMIN')
  );

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      tabIndex={-1}
      data-testid="coach-desk-drawer"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex justify-end bg-black/55 backdrop-blur-xs"
    >
      <div className="w-full max-w-md h-full bg-ap-chalk dark:bg-ap-obsidian text-ap-ink dark:text-ap-chalk border-l border-ap-frame/20 dark:border-ap-edge-dark shadow-2xl flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-ap-frame/15 dark:border-ap-edge-dark flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 id={headingId} className="text-sm sm:text-base font-extrabold tracking-tight truncate">
              Coach Desk &amp; Team Admin
            </h2>
            <p className="text-2xs text-ap-muted dark:text-ap-muted-dark truncate">
              Setup, imports, season blocks, and governance tucked off your live track screen
            </p>
          </div>
          <button
            type="button"
            aria-label="Close Coach Desk"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-xl ap-card-inset inline-flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {myTeams.length > 0 && (
            <div className="rounded-xl ap-card-inset p-3 space-y-1.5">
              <label className="block text-2xs font-mono uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark font-bold">
                Active Team / Workspace
              </label>
              <select
                value={activeTeamId || ''}
                onChange={(e) => {
                  onSelectActiveTeam(e.target.value || null);
                  onClose();
                }}
                aria-label="Select Team in Coach Workspace"
                className="w-full min-h-[44px] rounded-xl border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-3 text-xs font-semibold text-ap-ink dark:text-ap-chalk"
              >
                {myTeams.map((t) => (
                  <option key={t.brand.teamId} value={t.brand.teamId}>
                    {t.brand.name} ({t.brand.joinCode})
                  </option>
                ))}
                <option value="">Personal Mode</option>
              </select>
            </div>
          )}

          <div className="rounded-xl ap-card-inset p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold">
                <Activity className="w-3.5 h-3.5 ap-text-brand" />
                <span>Physiology &amp; Pro Metrics</span>
              </span>
              <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                {complexityTier === 'PRO' ? 'Pro Mode' : 'Simple Mode'}
              </span>
            </div>
            <p className="text-2xs text-ap-muted dark:text-ap-muted-dark">
              Show CTL / HRV / TSB telemetry badges &amp; Track Physics drawers or keep trackside views minimal.
            </p>
            <div
              role="group"
              aria-label="Coach Workspace Complexity"
              className="grid grid-cols-2 gap-1 p-1 rounded-xl liquid-capsule-track text-xs font-semibold"
            >
              <button
                type="button"
                data-testid="coach-complexity-essentials"
                aria-pressed={complexityTier === 'ESSENTIALS'}
                onClick={() => onSetComplexityTier('ESSENTIALS')}
                className={`min-h-[44px] sm:min-h-[36px] px-3 py-1 rounded-lg cursor-pointer transition-colors ${
                  complexityTier === 'ESSENTIALS'
                    ? 'liquid-capsule-active text-ap-ink dark:text-white font-bold'
                    : 'text-ap-ink dark:text-ap-chalk'
                }`}
              >
                Simple
              </button>
              <button
                type="button"
                data-testid="coach-complexity-pro"
                aria-pressed={complexityTier === 'PRO'}
                onClick={() => onSetComplexityTier('PRO')}
                className={`min-h-[44px] sm:min-h-[36px] px-3 py-1 rounded-lg cursor-pointer transition-colors ${
                  complexityTier === 'PRO'
                    ? 'liquid-capsule-active text-ap-ink dark:text-white font-bold'
                    : 'text-ap-ink dark:text-ap-chalk'
                }`}
              >
                Pro Metrics
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-2xs font-mono uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark font-bold px-1">
              Season Planning &amp; External Sync
            </div>

            <button
              type="button"
              data-testid="coach-open-cohort-plan-builder"
              onClick={() => {
                onClose();
                onOpenCohortPlanBuilder();
              }}
              className="w-full min-h-[46px] px-3.5 py-2 rounded-xl ap-btn-secondary flex items-center justify-between gap-2 text-xs font-semibold cursor-pointer"
            >
              <span className="inline-flex items-center gap-2">
                <Target className="w-4 h-4 ap-text-brand" />
                <span>Build Cohort Season Plan</span>
              </span>
              <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                12-Week Arc →
              </span>
            </button>

            <button
              type="button"
              data-testid="coach-open-external-sync-btn"
              onClick={() => {
                onClose();
                onOpenExternalSync();
              }}
              className="w-full min-h-[46px] px-3.5 py-2 rounded-xl ap-btn-secondary flex items-center justify-between gap-2 text-xs font-semibold cursor-pointer"
            >
              <span className="inline-flex items-center gap-2">
                <Globe className="w-4 h-4 ap-text-brand" weight="duotone" />
                <span>Athletic.net / TFRRS Sync</span>
              </span>
              <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                Roster &amp; PRs →
              </span>
            </button>
          </div>

          <div className="space-y-2">
            <div className="text-2xs font-mono uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark font-bold px-1">
              Program Setup, Billing &amp; Governance
            </div>

            <button
              type="button"
              data-testid="coach-desk-open-team-admin-btn"
              onClick={() => {
                onClose();
                onOpenTeamStaffTab();
              }}
              className="w-full min-h-[46px] px-3.5 py-2 rounded-xl ap-btn-secondary flex items-center justify-between gap-2 text-xs font-semibold cursor-pointer"
            >
              <span className="inline-flex items-center gap-2">
                <Users className="w-4 h-4 ap-text-brand" />
                <span>Branding, QR Poster, PO &amp; Staff</span>
              </span>
              <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                Team →
              </span>
            </button>

            <button
              type="button"
              data-testid="coach-open-wizard-btn"
              onClick={() => {
                onClose();
                onOpenWizard();
              }}
              className="w-full min-h-[46px] px-3.5 py-2 rounded-xl ap-btn-secondary flex items-center justify-between gap-2 text-xs font-semibold cursor-pointer"
            >
              <span className="inline-flex items-center gap-2">
                <Calendar className="w-4 h-4 ap-text-brand" />
                <span>60s Squad Setup Wizard</span>
              </span>
              <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                {activeTeam ? activeTeam.brand.joinCode : 'New Team'}
              </span>
            </button>

            {canSeeDistrictOverview && (
              <button
                type="button"
                data-testid="coach-open-district-ad-btn"
                onClick={() => {
                  onClose();
                  onOpenDistrictOverview?.();
                }}
                className="w-full min-h-[46px] px-3.5 py-2 rounded-xl ap-btn-secondary flex items-center justify-between gap-2 text-xs font-semibold cursor-pointer"
              >
                <span className="inline-flex items-center gap-2">
                  <Layers className="w-4 h-4 ap-text-brand" />
                  <span>District Overview</span>
                </span>
                <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                  AD Rollup →
                </span>
              </button>
            )}

            {onOpenCoachGuide && (
              <button
                type="button"
                data-testid="coach-open-guide-btn"
                onClick={() => {
                  onClose();
                  onOpenCoachGuide();
                }}
                className="w-full min-h-[46px] px-3.5 py-2 rounded-xl ap-btn-secondary flex items-center justify-between gap-2 text-xs font-semibold cursor-pointer"
              >
                <span className="inline-flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 ap-text-brand" />
                  <span>Illustrated Coach Guide</span>
                </span>
                <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                  Help →
                </span>
              </button>
            )}

            {onOpenProfileModal && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenProfileModal();
                }}
                className="w-full min-h-[46px] px-3.5 py-2 rounded-xl ap-card-inset flex items-center justify-between gap-2 text-xs font-semibold cursor-pointer"
              >
                <span className="inline-flex items-center gap-2">
                  <Shield className="w-4 h-4 ap-text-brand" />
                  <span>Coach / Athlete Zones &amp; Profile</span>
                </span>
                <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                  Profile →
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
