import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Check,
  Copy,
  Eye,
  HeartPulse,
  MapPin,
  Shield,
  Timer,
  Trash2,
  UserPlus,
  Users,
  X,
} from './icons/PhosphorIcons';
import type {
  AthleteConnectionRole,
  AthletePrivacySettings,
  AthleteProfile,
  ConnectedAthleteRecord,
  DistanceUnit,
  PrivacyVisibilityTier,
  TeamSummaryWithRole,
} from '../types';
import { useModalDialog } from '../hooks/useModalDialog';
import { useTracksideStopwatch } from '../hooks/useTracksideStopwatch';
import { AeroPulseLogo } from './AeroPulseLogo';

export type RosterTab =
  | 'TEAMS_BRANDING'
  | 'LEADERBOARD'
  | 'SCHOLASTIC_COACH'
  | 'CONNECT_INVITE'
  | 'PRIVACY_SHIELD';

type VisibleConnectionsTab = 'CONNECT_INVITE' | 'PRIVACY_SHIELD';

function normalizeConnectionsTab(tab?: RosterTab): VisibleConnectionsTab {
  return tab === 'PRIVACY_SHIELD' ? 'PRIVACY_SHIELD' : 'CONNECT_INVITE';
}

interface AthleteRosterModalProps {
  isOpen: boolean;
  onClose: () => void;
  selfName: string;
  selfInviteCode: string;
  selfCtl: number;
  selfAtl: number;
  selfTsb: number;
  selfHrv: number;
  selfProfile: AthleteProfile;
  selfPrivacySettings: AthletePrivacySettings;
  onUpdateSelfPrivacy: (updated: AthletePrivacySettings) => void;
  roster: ConnectedAthleteRecord[];
  activeAthleteId: string;
  onSelectAthleteViewport: (athleteId: string) => void;
  onApproveRequest: (athleteId: string, role: 'COACH_EDIT' | 'FRIEND_VIEW') => void;
  onRemoveOrDeclineAthlete: (athleteId: string) => void;
  onToggleAthleteRole: (athleteId: string) => void;
  onAddFollowByInviteOrName: (
    query: string,
    role: 'COACH_EDIT' | 'FRIEND_VIEW',
    specialty: 'Running' | 'Cycling'
  ) => void;
  onPushCoachWorkout: (
    athleteId: string,
    workout: {
      date: string;
      name: string;
      sportCategory: 'Running' | 'Cycling';
      plannedDurationSecs: number;
      plannedLoad: number;
      workoutSyntax: string;
      description: string;
    }
  ) => void;
  distanceUnit: DistanceUnit;
  myTeams?: TeamSummaryWithRole[];
  activeTeamId?: string | null;
  resendConfigured?: boolean;
  initialTab?: RosterTab;
  onSelectActiveTeam?: (teamId: string | null) => void;
  onTeamsUpdated?: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string) => void;
  onOpenFullScreenStopwatch?: () => void;
  onOpenCoachWorkspace?: () => void;
}

const AVATAR_PALETTE = ['#1C5436', '#0D9488', '#0284C7', '#D97706', '#E11D48'];

export const AthleteRosterModal: React.FC<AthleteRosterModalProps> = ({
  isOpen,
  onClose,
  selfInviteCode,
  selfPrivacySettings,
  onUpdateSelfPrivacy,
  roster,
  onApproveRequest,
  onRemoveOrDeclineAthlete,
  onToggleAthleteRole,
  onAddFollowByInviteOrName,
  myTeams = [],
  activeTeamId = null,
  initialTab = 'CONNECT_INVITE',
  onOpenFullScreenStopwatch,
  onOpenCoachWorkspace,
}) => {
  const [activeTab, setActiveTab] = useState<VisibleConnectionsTab>(() =>
    normalizeConnectionsTab(initialTab)
  );
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(normalizeConnectionsTab(initialTab));
    }
  }, [isOpen, initialTab]);

  const activeTeamObj = useMemo(
    () => myTeams.find((t) => t.brand.teamId === activeTeamId) || null,
    [myTeams, activeTeamId]
  );

  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteRole, setInviteRole] = useState<'COACH_EDIT' | 'FRIEND_VIEW'>('FRIEND_VIEW');
  const [inviteSpecialty, setInviteSpecialty] = useState<'Running' | 'Cycling'>('Running');
  const [followFeedback, setFollowFeedback] = useState<string | null>(null);

  const formIdPrefix = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const { stopwatchRunning } = useTracksideStopwatch(50);
  const [backdropRunningNotice, setBackdropRunningNotice] = useState<boolean>(false);
  const [confirmDeleteAthleteId, setConfirmDeleteAthleteId] = useState<string | null>(null);

  useModalDialog({
    isOpen,
    onClose,
    dialogRef,
  });

  useEffect(() => {
    if (!isOpen) {
      setBackdropRunningNotice(false);
      setConfirmDeleteAthleteId(null);
    }
  }, [isOpen]);

  const connectedRoster = useMemo(
    () => roster.filter((a) => a.status === 'CONNECTED'),
    [roster]
  );
  const pendingRequests = useMemo(
    () => roster.filter((a) => a.status !== 'CONNECTED'),
    [roster]
  );

  if (!isOpen) return null;

  const handleCopyInvite = () => {
    navigator.clipboard.writeText(selfInviteCode).catch(() => {});
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleFollowSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteQuery.trim()) return;
    onAddFollowByInviteOrName(inviteQuery.trim(), inviteRole, inviteSpecialty);
    setFollowFeedback(
      `Connected with "${inviteQuery.trim()}" as ${
        inviteRole === 'COACH_EDIT' ? 'Coached Athlete (Edit Calendar)' : 'Teammate (View Only)'
      }.`
    );
    setInviteQuery('');
    setTimeout(() => setFollowFeedback(null), 4000);
  };

  const renderRoleBadge = (role: AthleteConnectionRole) => (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-2xs font-mono uppercase ${
        role === 'COACH_EDIT' ? 'ap-status-caution' : 'ap-status-info'
      }`}
    >
      <Eye className="w-3 h-3" />
      <span>{role === 'COACH_EDIT' ? 'Coach (Edit Calendar)' : 'Teammate (View Only)'}</span>
    </span>
  );

  return (
    <div
      onClick={() => {
        if (stopwatchRunning) {
          setBackdropRunningNotice(true);
          return;
        }
        onClose();
      }}
      className="fixed inset-0 z-[60] bg-[#070F0B]/82 flex items-center justify-center p-2 sm:p-4 overflow-y-auto"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="thresh-roster-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="rounded-2xl liquid-glass shadow-2xl border border-stone-200/90 dark:border-white/10 text-slate-900 dark:text-slate-100 max-w-5xl w-full max-h-[92dvh] sm:max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-stone-200/80 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3 liquid-glass-subtle">
          <div className="flex items-center gap-3 min-w-0">
            <AeroPulseLogo size="sm" teamBrand={activeTeamObj?.brand || null} />
            <div className="h-6 w-px bg-stone-300 dark:bg-slate-800 hidden sm:block" />
            <div className="min-w-0">
              <h2
                id="thresh-roster-modal-title"
                className="text-sm sm:text-base font-bold text-slate-900 dark:text-white"
              >
                Connections &amp; Privacy
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-300 hidden sm:block">
                Manage 1:1 follow codes and control what teammates or coaches can see.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden md:flex items-center gap-2 liquid-glass-subtle border border-[#C5D4C9] dark:border-[#244230] rounded-lg px-3 py-1.5">
              <span className="text-2xs font-mono uppercase text-[#43584B] dark:text-[#93A39A]">
                Invite Code:
              </span>
              <span className="text-xs font-mono font-bold ap-text-brand">{selfInviteCode}</span>
              <button
                type="button"
                onClick={handleCopyInvite}
                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center text-[#43584B] dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                aria-label="Copy your THRESH Invite Code"
              >
                {copiedCode ? (
                  <Check className="w-3.5 h-3.5 text-[#10B981]" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close Connections & Privacy"
              className="min-h-[44px] px-3 py-2 rounded-xl liquid-glass-subtle hover:bg-[#DDE7DF] dark:hover:bg-[#1B2E23] border border-[#C5D4C9] dark:border-[#244230] text-slate-700 dark:text-slate-200 flex items-center gap-1.5 text-xs font-mono cursor-pointer"
            >
              <span>Close</span>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {backdropRunningNotice && stopwatchRunning && (
          <div
            role="status"
            aria-live="polite"
            className="px-4 sm:px-6 py-2 ap-status-caution text-xs font-mono flex items-center justify-between gap-2"
          >
            <span>
              Backdrop tap ignored while Trackside Stopwatch is running. Use Close or Esc.
            </span>
            <button
              type="button"
              onClick={() => setBackdropRunningNotice(false)}
              className="underline font-semibold cursor-pointer"
            >
              Got it
            </button>
          </div>
        )}

        {/* 2 Focused Tabs */}
        <div className="px-3 sm:px-6 border-b border-[#C5D4C9] dark:border-[#244230] bg-[#E9EFE9] dark:bg-[#101B15]">
          <div
            role="tablist"
            aria-label="Connections and privacy sections"
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const order: VisibleConnectionsTab[] = ['CONNECT_INVITE', 'PRIVACY_SHIELD'];
              const idx = order.indexOf(activeTab);
              const nextIdx = (idx + 1) % order.length;
              setActiveTab(order[nextIdx]);
              const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
              buttons[nextIdx]?.focus();
            }}
            className="flex items-center gap-1"
          >
            <button
              type="button"
              role="tab"
              tabIndex={activeTab === 'CONNECT_INVITE' ? 0 : -1}
              aria-selected={activeTab === 'CONNECT_INVITE'}
              onClick={() => setActiveTab('CONNECT_INVITE')}
              className={`min-h-[44px] px-3 py-2 text-xs font-mono uppercase tracking-wide border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'CONNECT_INVITE'
                  ? 'border-[#1C5436] dark:border-[#C8FF00] text-[#101411] dark:text-white font-bold'
                  : 'border-transparent text-[#43584B] dark:text-[#93A39A] hover:text-[#101411] dark:hover:text-white'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5 ap-text-brand shrink-0" />
              <span>Connections ({connectedRoster.length})</span>
              {pendingRequests.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-[#F59E0B] text-[#080A09] font-bold text-2xs">
                  {pendingRequests.length}
                </span>
              )}
            </button>

            <button
              type="button"
              role="tab"
              tabIndex={activeTab === 'PRIVACY_SHIELD' ? 0 : -1}
              aria-selected={activeTab === 'PRIVACY_SHIELD'}
              onClick={() => setActiveTab('PRIVACY_SHIELD')}
              className={`min-h-[44px] px-3 py-2 text-xs font-mono uppercase tracking-wide border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'PRIVACY_SHIELD'
                  ? 'border-[#1C5436] dark:border-[#C8FF00] text-[#101411] dark:text-white font-bold'
                  : 'border-transparent text-[#43584B] dark:text-[#93A39A] hover:text-[#101411] dark:hover:text-white'
              }`}
            >
              <Shield className="w-3.5 h-3.5 text-emerald-700 dark:text-[#10B981] shrink-0" />
              <span>Privacy Shield</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-5">
          {activeTab === 'CONNECT_INVITE' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left: Follow form + My Code */}
              <div className="lg:col-span-5 space-y-4">
                <form
                  onSubmit={handleFollowSubmit}
                  className="rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10 p-4 space-y-3"
                >
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      Connect by Invite Code
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                      Enter a teammate&apos;s code (e.g. TH-4401-TRACK) to follow or coach 1:1.
                    </p>
                  </div>

                  {followFeedback && (
                    <div role="status" aria-live="polite" className="p-2.5 rounded-lg ap-status-prime text-xs font-mono">
                      {followFeedback}
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor={`${formIdPrefix}-invite-query`}
                      className="block text-2xs font-mono uppercase text-slate-600 dark:text-slate-300 mb-1"
                    >
                      Athlete Name or Invite Code
                    </label>
                    <input
                      id={`${formIdPrefix}-invite-query`}
                      type="text"
                      value={inviteQuery}
                      onChange={(e) => setInviteQuery(e.target.value)}
                      placeholder="e.g. Jordan Mercer or TH-5120-VELO"
                      className="w-full min-h-[44px] bg-white dark:bg-[#101B15] border border-stone-300 dark:border-[#2B543B] rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-slate-100 font-mono"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label
                        htmlFor={`${formIdPrefix}-invite-role`}
                        className="block text-2xs font-mono uppercase text-slate-600 dark:text-slate-300 mb-1"
                      >
                        Permission
                      </label>
                      <select
                        id={`${formIdPrefix}-invite-role`}
                        value={inviteRole}
                        onChange={(e) =>
                          setInviteRole(e.target.value as 'COACH_EDIT' | 'FRIEND_VIEW')
                        }
                        className="w-full min-h-[44px] bg-white dark:bg-[#101B15] border border-stone-300 dark:border-[#2B543B] rounded-lg px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
                      >
                        <option value="FRIEND_VIEW">Teammate (View Only)</option>
                        <option value="COACH_EDIT">Coached Athlete (Edit Calendar)</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor={`${formIdPrefix}-invite-sport`}
                        className="block text-2xs font-mono uppercase text-slate-600 dark:text-slate-300 mb-1"
                      >
                        Sport
                      </label>
                      <select
                        id={`${formIdPrefix}-invite-sport`}
                        value={inviteSpecialty}
                        onChange={(e) =>
                          setInviteSpecialty(e.target.value as 'Running' | 'Cycling')
                        }
                        className="w-full min-h-[44px] bg-white dark:bg-[#101B15] border border-stone-300 dark:border-[#2B543B] rounded-lg px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
                      >
                        <option value="Running">Running / Track</option>
                        <option value="Cycling">Cycling / Power</option>
                      </select>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full min-h-[44px] py-2 rounded-xl ap-btn-primary font-semibold text-xs cursor-pointer"
                  >
                    Connect Athlete
                  </button>
                </form>

                <div className="rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10 p-4 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                      Your Personal Invite Code
                    </h4>
                    <div className="text-base font-mono font-bold ap-text-brand mt-0.5">
                      {selfInviteCode}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyInvite}
                    className="min-h-[44px] px-3.5 py-2 rounded-xl ap-btn-secondary text-xs font-mono flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    {copiedCode ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[#10B981]" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Right: Requests + Connected List */}
              <div className="lg:col-span-7 space-y-4">
                {pendingRequests.length > 0 && (
                  <div className="rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10 p-4 space-y-2.5">
                    <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                      Pending Requests ({pendingRequests.length})
                    </h3>
                    {pendingRequests.map((req, idx) => {
                      const avatarColor = AVATAR_PALETTE[(idx + 2) % AVATAR_PALETTE.length];
                      return (
                        <div
                          key={req.id}
                          className="bg-white/80 dark:bg-[#101B15] border border-stone-200/90 dark:border-[#244331] rounded-lg p-3 flex flex-wrap items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-2.5">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center font-mono font-bold text-xs text-slate-900 dark:text-white"
                              style={{ backgroundColor: `${avatarColor}30` }}
                            >
                              {req.avatarInitials}
                            </div>
                            <div>
                              <div className="text-xs font-bold text-slate-900 dark:text-white">
                                {req.name}
                              </div>
                              <div className="text-2xs text-slate-600 dark:text-slate-300">
                                {req.inviteCode} · {req.location}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => onApproveRequest(req.id, 'FRIEND_VIEW')}
                              className="min-h-[44px] sm:min-h-[34px] px-2.5 py-1 rounded-lg ap-status-info text-xs font-mono cursor-pointer"
                            >
                              Approve Friend
                            </button>
                            <button
                              type="button"
                              onClick={() => onApproveRequest(req.id, 'COACH_EDIT')}
                              className="min-h-[44px] sm:min-h-[34px] px-2.5 py-1 rounded-lg ap-status-caution text-xs font-mono cursor-pointer"
                            >
                              Approve Coach
                            </button>
                            <button
                              type="button"
                              onClick={() => onRemoveOrDeclineAthlete(req.id)}
                              className="min-h-[44px] min-w-[44px] sm:min-h-[34px] sm:min-w-[34px] inline-flex items-center justify-center rounded-lg hover:bg-rose-500/15 text-rose-700 dark:text-rose-300 cursor-pointer"
                              aria-label={`Decline request from ${req.name}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10 p-4 space-y-2.5">
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                    Connected Athletes &amp; Friends ({connectedRoster.length})
                  </h3>
                  {connectedRoster.length === 0 ? (
                    <p className="text-xs text-slate-600 dark:text-slate-300 py-3 text-center">
                      No 1:1 connections yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {connectedRoster.map((ath) => {
                        const latestCtlVal = ath.wellnessDays[ath.wellnessDays.length - 1]?.ctl ?? 65;
                        const isConfirmingRemove = confirmDeleteAthleteId === ath.id;
                        return (
                          <div
                            key={ath.id}
                            className="bg-white/80 dark:bg-[#101B15] border border-stone-200/90 dark:border-[#244331] rounded-lg px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2"
                          >
                            <div>
                              <div className="text-xs font-semibold text-slate-900 dark:text-white">
                                {ath.name}
                              </div>
                              <div className="text-2xs font-mono text-slate-600 dark:text-slate-300">
                                {ath.inviteCode} · CTL {Math.round(latestCtlVal)}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => onToggleAthleteRole(ath.id)}
                                className="cursor-pointer"
                                title="Click to toggle Coach / View-Only permission"
                              >
                                {renderRoleBadge(ath.role)}
                              </button>
                              {isConfirmingRemove ? (
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onRemoveOrDeclineAthlete(ath.id);
                                      setConfirmDeleteAthleteId(null);
                                    }}
                                    className="min-h-[44px] sm:min-h-[34px] px-2.5 py-1 rounded-lg bg-rose-600 text-white text-xs font-mono font-bold cursor-pointer"
                                  >
                                    Remove
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteAthleteId(null)}
                                    className="min-h-[44px] sm:min-h-[34px] px-2 py-1 rounded-lg border border-stone-300 dark:border-slate-700 text-xs font-mono cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteAthleteId(ath.id)}
                                  className="min-h-[44px] min-w-[44px] sm:min-h-[34px] sm:min-w-[34px] inline-flex items-center justify-center rounded-lg hover:bg-rose-500/15 text-rose-700 dark:text-rose-300 cursor-pointer"
                                  aria-label={`Remove connection with ${ath.name}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'PRIVACY_SHIELD' && (
            <div className="rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10 p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200/80 dark:border-slate-800 pb-3.5">
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    Outbound Privacy &amp; Strava Compliance Shield
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                    Control what Teammates (View Only) and Coached Athletes can inspect on your profile.
                  </p>
                </div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-[#059669]/10 border border-[#059669]/30 text-xs font-mono text-emerald-700 dark:text-[#10B981]">
                  <span>Shield Active</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                <div className="bg-white/80 dark:bg-[#101B15] border border-stone-200/90 dark:border-[#244331] rounded-lg p-3.5 space-y-2">
                  <label
                    htmlFor={`${formIdPrefix}-priv-hrv`}
                    className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"
                  >
                    <HeartPulse className="w-4 h-4 text-[#10B981]" />
                    <span>Morning HRV, RHR &amp; Sleep</span>
                  </label>
                  <select
                    id={`${formIdPrefix}-priv-hrv`}
                    value={selfPrivacySettings.shareWellnessAndHrv}
                    onChange={(e) =>
                      onUpdateSelfPrivacy({
                        ...selfPrivacySettings,
                        shareWellnessAndHrv: e.target.value as PrivacyVisibilityTier,
                      })
                    }
                    className="w-full min-h-[44px] sm:min-h-[38px] bg-white dark:bg-[#15231B] border border-stone-300 dark:border-[#2B543B] rounded-lg px-2.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                  >
                    <option value="ALL_CONNECTIONS">Friends &amp; Coaches</option>
                    <option value="COACHES_ONLY">Coaches Only</option>
                    <option value="PRIVATE">Only Me (Private)</option>
                  </select>
                </div>

                <div className="bg-white/80 dark:bg-[#101B15] border border-stone-200/90 dark:border-[#244331] rounded-lg p-3.5 space-y-2">
                  <label
                    htmlFor={`${formIdPrefix}-priv-pmc`}
                    className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"
                  >
                    <Activity className="w-4 h-4 ap-text-brand" />
                    <span>Fitness (CTL) &amp; Zones</span>
                  </label>
                  <select
                    id={`${formIdPrefix}-priv-pmc`}
                    value={selfPrivacySettings.sharePmcAndZones}
                    onChange={(e) =>
                      onUpdateSelfPrivacy({
                        ...selfPrivacySettings,
                        sharePmcAndZones: e.target.value as PrivacyVisibilityTier,
                      })
                    }
                    className="w-full min-h-[44px] sm:min-h-[38px] bg-white dark:bg-[#15231B] border border-stone-300 dark:border-[#2B543B] rounded-lg px-2.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                  >
                    <option value="ALL_CONNECTIONS">Friends &amp; Coaches</option>
                    <option value="COACHES_ONLY">Coaches Only</option>
                    <option value="PRIVATE">Only Me (Private)</option>
                  </select>
                </div>

                <div className="bg-white/80 dark:bg-[#101B15] border border-stone-200/90 dark:border-[#244331] rounded-lg p-3.5 space-y-2">
                  <label
                    htmlFor={`${formIdPrefix}-priv-gps`}
                    className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"
                  >
                    <MapPin className="w-4 h-4 text-amber-500" />
                    <span>Outdoor GPS Maps</span>
                  </label>
                  <select
                    id={`${formIdPrefix}-priv-gps`}
                    value={selfPrivacySettings.shareGpsRoutes}
                    onChange={(e) =>
                      onUpdateSelfPrivacy({
                        ...selfPrivacySettings,
                        shareGpsRoutes: e.target.value as PrivacyVisibilityTier,
                      })
                    }
                    className="w-full min-h-[44px] sm:min-h-[38px] bg-white dark:bg-[#15231B] border border-stone-300 dark:border-[#2B543B] rounded-lg px-2.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                  >
                    <option value="ALL_CONNECTIONS">Friends &amp; Coaches</option>
                    <option value="COACHES_ONLY">Coaches Only</option>
                    <option value="PRIVATE">Only Me (Private)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <label className="bg-white/80 dark:bg-[#101B15] border border-stone-200/90 dark:border-emerald-400/20 rounded-lg p-3.5 flex items-start justify-between gap-3 cursor-pointer">
                  <span>
                    <span className="block text-xs font-semibold text-slate-900 dark:text-white">
                      Allow Coached Athlete (Edit Calendar) Push
                    </span>
                    <span className="block text-2xs text-slate-600 dark:text-slate-300 mt-0.5">
                      Lets your approved coach add workouts onto your calendar.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={selfPrivacySettings.allowCoachCalendarEdits}
                    onChange={(e) =>
                      onUpdateSelfPrivacy({
                        ...selfPrivacySettings,
                        allowCoachCalendarEdits: e.target.checked,
                      })
                    }
                    className="mt-1 accent-[#1C5436] dark:accent-[#C8FF00] w-4 h-4"
                  />
                </label>

                <label className="bg-white/80 dark:bg-[#101B15] border border-stone-200/90 dark:border-emerald-400/20 rounded-lg p-3.5 flex items-start justify-between gap-3 cursor-pointer">
                  <span>
                    <span className="block text-xs font-semibold text-slate-900 dark:text-white">
                      Strava Compliance Isolation
                    </span>
                    <span className="block text-2xs text-slate-600 dark:text-slate-300 mt-0.5">
                      Keeps raw Strava activities hidden from third parties unless connected.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={selfPrivacySettings.stravaComplianceShield}
                    onChange={(e) =>
                      onUpdateSelfPrivacy({
                        ...selfPrivacySettings,
                        stravaComplianceShield: e.target.checked,
                      })
                    }
                    className="mt-1 accent-[#10B981] w-4 h-4"
                  />
                </label>
              </div>
            </div>
          )}

          {/* Coach Desk & Trackside Stopwatch Shortcut Footer */}
          <div className="rounded-xl ap-card-inset px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-700 dark:text-slate-200">
              <strong className="text-slate-900 dark:text-white">Coaching a full squad?</strong>{' '}
              Manage teams, QR posters, pace pods, and triage in Coach Workspace.
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {onOpenCoachWorkspace && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenCoachWorkspace();
                  }}
                  className="ap-btn-primary !min-h-[44px] sm:!min-h-[36px] px-3.5 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Open THRESH Coach Desk</span>
                </button>
              )}
              {onOpenFullScreenStopwatch && (
                <button
                  type="button"
                  data-testid="roster-open-stopwatch-btn"
                  onClick={onOpenFullScreenStopwatch}
                  className="ap-btn-secondary !min-h-[44px] sm:!min-h-[36px] px-3.5 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Timer className="w-3.5 h-3.5 ap-text-brand" />
                  <span>Open Stopwatch</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
