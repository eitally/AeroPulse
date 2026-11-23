import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Check,
  Copy,
  Download,
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
  CoachDataSharingTier,
  ConnectedAthleteRecord,
  DistanceUnit,
  PrivacyVisibilityTier,
  TeamSummaryWithRole,
  ThreshUser,
} from '../types';
import { useModalDialog } from '../hooks/useModalDialog';
import { useIsStopwatchRunning } from '../hooks/useTracksideStopwatch';
import { AeroPulseLogo } from './AeroPulseLogo';
import {
  changePrimaryEmailApi,
  deleteAccountApi,
  exportUserAccountDataApi,
  leaveOrGraduateTeamApi,
  revokeGuardianCcApi,
  updateMyTeamSharingTierApi,
} from '../utils/teamLifecycleApi';
import { markSessionActiveHint } from '../utils/sessionHint';

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
  onTeamsUpdated?: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string | null) => void;
  currentUser?: ThreshUser | null;
  onUserUpdated?: (user: ThreshUser) => void;
  onAccountDeleted?: () => void;
  onOpenFullScreenStopwatch?: () => void;
  onOpenCoachWorkspace?: () => void;
}

const AVATAR_PALETTE = ['#B83A24', '#0D9488', '#0284C7', '#D97706', '#E11D48'];

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
  onTeamsUpdated,
  currentUser,
  onUserUpdated,
  onAccountDeleted,
  onOpenFullScreenStopwatch,
  onOpenCoachWorkspace,
}) => {
  const [activeTab, setActiveTab] = useState<VisibleConnectionsTab>(() =>
    normalizeConnectionsTab(initialTab)
  );
  const [copiedCode, setCopiedCode] = useState(false);

  // Team membership lifecycle, login email mobility, and account erasure state
  const [accountEmailInput, setAccountEmailInput] = useState(currentUser?.email || '');
  const [pendingEmailVerify, setPendingEmailVerify] = useState<string | null>(null);
  const [emailVerifyCodeInput, setEmailVerifyCodeInput] = useState('');
  const [emailVerifyDevCode, setEmailVerifyDevCode] = useState<string | null>(null);
  const [isUpdatingEmail, setIsUpdatingEmail] = useState(false);
  const [privacyActionMsg, setPrivacyActionMsg] = useState<string | null>(null);
  const [privacyActionErr, setPrivacyActionErr] = useState<string | null>(null);
  const [busyTeamActionId, setBusyTeamActionId] = useState<string | null>(null);
  const [confirmLeaveTeamId, setConfirmLeaveTeamId] = useState<string | null>(null);
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<'json' | 'csv' | null>(null);

  useEffect(() => {
    if (currentUser?.email) {
      setAccountEmailInput(currentUser.email);
    }
  }, [currentUser?.email]);

  const handleLeaveOrGraduateTeam = async (
    teamId: string,
    mode: 'LEAVE' | 'GRADUATE_ALUMNI'
  ) => {
    setBusyTeamActionId(teamId);
    setPrivacyActionMsg(null);
    setPrivacyActionErr(null);
    try {
      const data = await leaveOrGraduateTeamApi(teamId, mode);
      if (Array.isArray(data.teams)) {
        onTeamsUpdated?.(data.teams, data.teams[0]?.brand?.teamId ?? null);
      }
      setConfirmLeaveTeamId(null);
      setPrivacyActionMsg(
        mode === 'GRADUATE_ALUMNI'
          ? 'Moved to Alumni. Your official race marks remain credited while live wellness sharing is stopped.'
          : 'Left team. Coach-recorded Stopwatch splits & official meet marks are saved in your personal history.'
      );
    } catch (err) {
      setPrivacyActionErr(err instanceof Error ? err.message : 'Could not update team membership.');
    } finally {
      setBusyTeamActionId(null);
    }
  };

  const handleRevokeGuardianCc = async (teamId: string) => {
    setBusyTeamActionId(teamId);
    setPrivacyActionMsg(null);
    setPrivacyActionErr(null);
    try {
      const data = await revokeGuardianCcApi(teamId);
      if (Array.isArray(data.teams)) {
        onTeamsUpdated?.(data.teams, activeTeamId);
      }
      setPrivacyActionMsg('Parent/guardian email CC removed for this team.');
    } catch (err) {
      setPrivacyActionErr(err instanceof Error ? err.message : 'Could not remove parent/guardian CC.');
    } finally {
      setBusyTeamActionId(null);
    }
  };

  const handleUpdateTeamSharingTier = async (
    teamId: string,
    tier: CoachDataSharingTier
  ) => {
    setBusyTeamActionId(teamId);
    setPrivacyActionMsg(null);
    setPrivacyActionErr(null);
    try {
      const data = await updateMyTeamSharingTierApi(teamId, tier);
      if (Array.isArray(data.teams)) {
        onTeamsUpdated?.(data.teams, activeTeamId);
      }
      setPrivacyActionMsg(
        tier === 'LOAD_ONLY'
          ? 'Updated team sharing to Load & Readiness Only. Activity history cleared from coach feed.'
          : tier === 'SUMMARY_ONLY'
            ? 'Updated team sharing to Workout Summaries (No GPS).'
            : 'Updated team sharing to Full 1Hz Streams & Splits.'
      );
    } catch (err) {
      setPrivacyActionErr(
        err instanceof Error ? err.message : 'Could not update team data sharing tier.'
      );
    } finally {
      setBusyTeamActionId(null);
    }
  };

  const handleChangePrimaryEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = accountEmailInput.trim().toLowerCase();
    if (!clean || !clean.includes('@')) {
      setPrivacyActionErr('Enter a valid email address.');
      return;
    }
    setIsUpdatingEmail(true);
    setPrivacyActionMsg(null);
    setPrivacyActionErr(null);
    try {
      const confirmingCode =
        pendingEmailVerify === clean ? emailVerifyCodeInput.trim() : '';
      const data = await changePrimaryEmailApi(clean, confirmingCode || undefined);
      if (data.verificationRequired) {
        setPendingEmailVerify(clean);
        setEmailVerifyCodeInput('');
        setEmailVerifyDevCode(data.devCode || null);
        setPrivacyActionMsg(
          `Verification code sent to ${clean}. Enter the 6-digit code below to finish updating your login email.`
        );
        return;
      }
      if (data.user) {
        markSessionActiveHint();
        onUserUpdated?.(data.user);
      }
      setPendingEmailVerify(null);
      setEmailVerifyCodeInput('');
      setEmailVerifyDevCode(null);
      setPrivacyActionMsg(
        'Login email updated — your training history and connected apps stay intact.'
      );
    } catch (err) {
      setPrivacyActionErr(err instanceof Error ? err.message : 'Could not update login email.');
    } finally {
      setIsUpdatingEmail(false);
    }
  };

  const handleDownloadDataExport = async (format: 'json' | 'csv') => {
    setExportingFormat(format);
    setPrivacyActionMsg(null);
    setPrivacyActionErr(null);
    try {
      const { filename, blob } = await exportUserAccountDataApi(format);
      if (typeof window !== 'undefined' && typeof URL !== 'undefined') {
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
      setPrivacyActionMsg(
        `Your MeetReady ${format.toUpperCase()} data export (${filename}) is downloading.`
      );
    } catch (err) {
      setPrivacyActionErr(
        err instanceof Error
          ? err.message
          : 'Sign in with a verified MeetReady account to download your data export.'
      );
    } finally {
      setExportingFormat(null);
    }
  };

  const handlePermanentAccountDelete = async () => {
    if (deleteConfirmText.trim() !== 'DELETE') return;
    setIsDeletingAccount(true);
    setPrivacyActionMsg(null);
    setPrivacyActionErr(null);
    try {
      await deleteAccountApi();
      onClose();
      onAccountDeleted?.();
    } catch (err) {
      setPrivacyActionErr(
        err instanceof Error ? err.message : 'Could not permanently delete account.'
      );
    } finally {
      setIsDeletingAccount(false);
    }
  };

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
  const stopwatchRunning = useIsStopwatchRunning();
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
      setConfirmLeaveTeamId(null);
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
      className="fixed inset-0 z-[60] bg-ap-obsidian/82 flex items-center justify-center p-2 sm:p-4 overflow-y-auto"
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
                Account, Teams &amp; Privacy
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-300 hidden sm:block">
                Manage team sharing tiers, 1:1 follow codes, login email, and privacy controls.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden md:flex items-center gap-2 liquid-glass-subtle border border-stone-300/80 dark:border-ap-edge-dark rounded-lg px-3 py-1.5">
              <span className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
                Invite Code:
              </span>
              <span className="text-xs font-mono font-bold ap-text-brand">{selfInviteCode}</span>
              <button
                type="button"
                onClick={handleCopyInvite}
                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center text-ap-muted dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                aria-label="Copy your MeetReady Invite Code"
              >
                {copiedCode ? (
                  <Check className="w-3.5 h-3.5 ap-ink-emerald" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close Connections & Privacy"
              className="min-h-[44px] px-3 py-2 rounded-xl liquid-glass-subtle hover:bg-ap-inset dark:hover:bg-ap-edge border border-stone-300/80 dark:border-ap-edge-dark text-slate-700 dark:text-slate-200 flex items-center gap-1.5 text-xs font-mono cursor-pointer"
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
        <div className="px-3 sm:px-6 border-b border-stone-300/70 dark:border-ap-edge-dark bg-ap-inset dark:bg-ap-carbon">
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
                  ? 'border-ap-cobalt dark:border-ap-volt text-ap-ink dark:text-white font-bold'
                  : 'border-transparent text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-white'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5 ap-text-brand shrink-0" />
              <span>Connections ({connectedRoster.length})</span>
              {pendingRequests.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-ap-obsidian font-bold text-2xs">
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
                  ? 'border-ap-cobalt dark:border-ap-volt text-ap-ink dark:text-white font-bold'
                  : 'border-transparent text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-white'
              }`}
            >
              <Shield className="w-3.5 h-3.5 ap-ink-emerald shrink-0" />
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
                      className="w-full min-h-[44px] bg-white dark:bg-ap-carbon border border-stone-300 dark:border-ap-edge-dark rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-slate-100 font-mono"
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
                        className="w-full min-h-[44px] bg-white dark:bg-ap-carbon border border-stone-300 dark:border-ap-edge-dark rounded-lg px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
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
                        className="w-full min-h-[44px] bg-white dark:bg-ap-carbon border border-stone-300 dark:border-ap-edge-dark rounded-lg px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
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
                        <Check className="w-3.5 h-3.5 ap-ink-emerald" />
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
                          className="bg-white/80 dark:bg-ap-carbon border border-stone-200/90 dark:border-ap-edge rounded-lg p-3 flex flex-wrap items-center justify-between gap-3"
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
                            className="bg-white/80 dark:bg-ap-carbon border border-stone-200/90 dark:border-ap-edge rounded-lg px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2"
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
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded ap-status-prime text-xs font-mono">
                  <span>Shield Active</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                <div className="bg-white/80 dark:bg-ap-carbon border border-stone-200/90 dark:border-ap-edge rounded-lg p-3.5 space-y-2">
                  <label
                    htmlFor={`${formIdPrefix}-priv-hrv`}
                    className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"
                  >
                    <HeartPulse className="w-4 h-4 ap-ink-emerald" />
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
                    className="w-full min-h-[44px] sm:min-h-[38px] bg-white dark:bg-ap-turf border border-stone-300 dark:border-ap-edge-dark rounded-lg px-2.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                  >
                    <option value="ALL_CONNECTIONS">Friends &amp; Coaches</option>
                    <option value="COACHES_ONLY">Coaches Only</option>
                    <option value="PRIVATE">Only Me (Private)</option>
                  </select>
                </div>

                <div className="bg-white/80 dark:bg-ap-carbon border border-stone-200/90 dark:border-ap-edge rounded-lg p-3.5 space-y-2">
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
                    className="w-full min-h-[44px] sm:min-h-[38px] bg-white dark:bg-ap-turf border border-stone-300 dark:border-ap-edge-dark rounded-lg px-2.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                  >
                    <option value="ALL_CONNECTIONS">Friends &amp; Coaches</option>
                    <option value="COACHES_ONLY">Coaches Only</option>
                    <option value="PRIVATE">Only Me (Private)</option>
                  </select>
                </div>

                <div className="bg-white/80 dark:bg-ap-carbon border border-stone-200/90 dark:border-ap-edge rounded-lg p-3.5 space-y-2">
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
                    className="w-full min-h-[44px] sm:min-h-[38px] bg-white dark:bg-ap-turf border border-stone-300 dark:border-ap-edge-dark rounded-lg px-2.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                  >
                    <option value="ALL_CONNECTIONS">Friends &amp; Coaches</option>
                    <option value="COACHES_ONLY">Coaches Only</option>
                    <option value="PRIVATE">Only Me (Private)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <label className="bg-white/80 dark:bg-ap-carbon border border-stone-200/90 dark:border-ap-edge rounded-lg p-3.5 flex items-start justify-between gap-3 cursor-pointer">
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
                    className="mt-1 accent-[#B83A24] dark:accent-[#D8FF2A] w-4 h-4"
                  />
                </label>

                <label className="bg-white/80 dark:bg-ap-carbon border border-stone-200/90 dark:border-ap-edge rounded-lg p-3.5 flex items-start justify-between gap-3 cursor-pointer">
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
                    className="mt-1 accent-[#B83A24] dark:accent-[#D8FF2A] w-4 h-4"
                  />
                </label>
              </div>

              {privacyActionErr && (
                <div className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-300">
                  {privacyActionErr}
                </div>
              )}
              {privacyActionMsg && (
                <div className="rounded-lg ap-status-prime px-3 py-2 text-xs">
                  {privacyActionMsg}
                </div>
              )}

              {myTeams.length > 0 && (
                <div className="border-t border-stone-200/80 dark:border-slate-800 pt-4 space-y-3">
                  <div>
                    <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                      Team Membership &amp; Guardian Controls
                    </h4>
                    <p className="text-2xs text-slate-600 dark:text-slate-300 mt-0.5">
                      Leaving a team stops live wellness sharing immediately while saving all coach-timed splits and official meet marks into your personal MeetReady vault.
                    </p>
                  </div>
                  <div className="divide-y divide-stone-200/70 dark:divide-slate-800">
                    {myTeams.map((team) => {
                      const mine = team.memberships.find(
                        (m) => m.membershipId === team.myMembershipId
                      );
                      const isTeamBusy = busyTeamActionId === team.brand.teamId;
                      const showGuardianRemove = Boolean(
                        mine && !mine.isMinorU18 && mine.parentGuardianEmail
                      );
                      const canGraduateSelf =
                        team.myRole === 'ATHLETE' &&
                        (team.brand.orgType === 'HIGH_SCHOOL' ||
                          team.brand.orgType === 'COLLEGIATE') &&
                        mine?.status !== 'ALUMNI';
                      const minorConsentLocked = Boolean(
                        mine?.isMinorU18 && mine.parentConsentStatus !== 'ACKNOWLEDGED'
                      );
                      const effectiveTier: CoachDataSharingTier =
                        mine?.sharingTier || 'SUMMARY_ONLY';
                      const isConfirmingLeave =
                        confirmLeaveTeamId === team.brand.teamId;

                      return (
                        <div
                          key={team.brand.teamId}
                          className="py-3 flex flex-wrap items-center justify-between gap-2.5"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-900 dark:text-white">
                              {team.brand.name}
                            </div>
                            <div className="text-2xs font-mono text-slate-500 dark:text-slate-400">
                              Role: {team.myRole.replace('_', ' ')}
                              {mine?.status === 'ALUMNI' ? ' · Alumni' : ''}
                              {minorConsentLocked ? ' · Pending parent consent (Load Only)' : ''}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {mine && mine.status !== 'ALUMNI' && (
                              <select
                                data-testid={`team-sharing-tier-${team.brand.teamId}`}
                                aria-label={`Coach data sharing tier for ${team.brand.name}`}
                                disabled={isTeamBusy}
                                value={effectiveTier}
                                onChange={(e) =>
                                  void handleUpdateTeamSharingTier(
                                    team.brand.teamId,
                                    e.target.value as CoachDataSharingTier
                                  )
                                }
                                className="min-h-[44px] sm:min-h-[36px] bg-white dark:bg-ap-turf border border-stone-300 dark:border-ap-edge-dark rounded-lg px-2.5 text-xs font-mono text-slate-900 dark:text-slate-100 cursor-pointer disabled:opacity-50"
                              >
                                <option value="LOAD_ONLY">Load &amp; Readiness Only</option>
                                <option value="SUMMARY_ONLY" disabled={minorConsentLocked}>
                                  Workout Summaries (No GPS)
                                </option>
                                <option value="FULL_STREAMS" disabled={minorConsentLocked}>
                                  Full 1Hz Streams &amp; Splits
                                </option>
                              </select>
                            )}
                            {showGuardianRemove && (
                              <button
                                type="button"
                                data-testid={`remove-guardian-${team.brand.teamId}`}
                                disabled={isTeamBusy}
                                onClick={() => void handleRevokeGuardianCc(team.brand.teamId)}
                                className="ap-btn-secondary !min-h-[44px] sm:!min-h-[36px] px-3 py-1.5 text-xs font-semibold cursor-pointer disabled:opacity-50"
                              >
                                Remove Parent/Guardian CC
                              </button>
                            )}
                            {canGraduateSelf && (
                              <button
                                type="button"
                                data-testid={`privacy-graduate-team-${team.brand.teamId}`}
                                disabled={isTeamBusy}
                                onClick={() =>
                                  void handleLeaveOrGraduateTeam(
                                    team.brand.teamId,
                                    'GRADUATE_ALUMNI'
                                  )
                                }
                                className="ap-btn-secondary !min-h-[44px] sm:!min-h-[36px] px-3 py-1.5 text-xs font-semibold cursor-pointer disabled:opacity-50"
                              >
                                Graduate to Alumni
                              </button>
                            )}
                            {team.myRole !== 'HEAD_COACH' &&
                              (!isConfirmingLeave ? (
                                <button
                                  type="button"
                                  data-testid={`privacy-leave-team-${team.brand.teamId}`}
                                  disabled={isTeamBusy}
                                  onClick={() => setConfirmLeaveTeamId(team.brand.teamId)}
                                  className="min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-600 dark:text-rose-300 hover:bg-rose-500/10 cursor-pointer disabled:opacity-50"
                                >
                                  Leave Team (Keep My Data)
                                </button>
                              ) : (
                                <div className="inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-rose-500/35 bg-rose-500/10 px-2 py-1">
                                  <span className="text-2xs font-medium text-rose-700 dark:text-rose-200 px-1">
                                    Stop sharing live wellness?
                                  </span>
                                  <button
                                    type="button"
                                    data-testid={`privacy-leave-team-confirm-${team.brand.teamId}`}
                                    disabled={isTeamBusy}
                                    onClick={() =>
                                      void handleLeaveOrGraduateTeam(team.brand.teamId, 'LEAVE')
                                    }
                                    className="min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                                  >
                                    Confirm Leave
                                  </button>
                                  <button
                                    type="button"
                                    data-testid={`privacy-leave-team-cancel-${team.brand.teamId}`}
                                    disabled={isTeamBusy}
                                    onClick={() => setConfirmLeaveTeamId(null)}
                                    className="min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-md text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="border-t border-stone-200/80 dark:border-slate-800 pt-4 space-y-4">
                <form
                  onSubmit={(e) => void handleChangePrimaryEmail(e)}
                  className="space-y-2"
                >
                  <div>
                    <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                      Login Email Mobility &amp; Account Erasure
                    </h4>
                    <p className="text-2xs text-slate-600 dark:text-slate-300 mt-0.5">
                      Switch away from a graduating school email without losing your workouts, or permanently erase your MeetReady account.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="email"
                      data-testid="account-change-email-input"
                      aria-label="New primary login email"
                      value={accountEmailInput}
                      onChange={(e) => {
                        setAccountEmailInput(e.target.value);
                        if (pendingEmailVerify && e.target.value.trim().toLowerCase() !== pendingEmailVerify) {
                          setPendingEmailVerify(null);
                          setEmailVerifyCodeInput('');
                          setEmailVerifyDevCode(null);
                        }
                      }}
                      placeholder="personal.email@example.com"
                      className="flex-1 min-h-[44px] sm:min-h-[38px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="submit"
                      data-testid="account-change-email-btn"
                      disabled={
                        isUpdatingEmail ||
                        !accountEmailInput.trim() ||
                        (pendingEmailVerify === accountEmailInput.trim().toLowerCase() &&
                          emailVerifyCodeInput.trim().length < 6)
                      }
                      className="ap-btn-secondary !min-h-[44px] sm:!min-h-[38px] px-3.5 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap disabled:opacity-50"
                    >
                      {isUpdatingEmail
                        ? 'Updating…'
                        : pendingEmailVerify === accountEmailInput.trim().toLowerCase()
                          ? 'Confirm Code'
                          : 'Update Email'}
                    </button>
                  </div>
                  {pendingEmailVerify && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        data-testid="account-change-email-code-input"
                        aria-label="6-digit email verification code"
                        value={emailVerifyCodeInput}
                        onChange={(e) => setEmailVerifyCodeInput(e.target.value)}
                        placeholder="6-digit verification code"
                        className="w-full sm:w-48 min-h-[44px] sm:min-h-[36px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-3 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                      />
                      {emailVerifyDevCode && (
                        <span
                          data-testid="account-change-email-dev-code"
                          className="text-2xs font-mono ap-ink-emerald"
                        >
                          Dev code: <strong>{emailVerifyDevCode}</strong>
                        </span>
                      )}
                    </div>
                  )}
                </form>

                <div className="rounded-xl ap-card-inset p-3.5 space-y-2.5">
                  <div>
                    <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                      Self-Serve Data Export (FERPA / GDPR)
                    </h4>
                    <p className="text-2xs text-slate-600 dark:text-slate-300 mt-0.5">
                      Download a portable copy of your profile, planned workouts, check-ins, gear, and team-scoped athletic marks.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid="account-export-json-btn"
                      disabled={exportingFormat !== null}
                      onClick={() => void handleDownloadDataExport('json')}
                      className="ap-btn-secondary !min-h-[44px] sm:!min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold cursor-pointer disabled:opacity-50"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>
                        {exportingFormat === 'json' ? 'Exporting JSON…' : 'Download My Data (JSON)'}
                      </span>
                    </button>
                    <button
                      type="button"
                      data-testid="account-export-csv-btn"
                      disabled={exportingFormat !== null}
                      onClick={() => void handleDownloadDataExport('csv')}
                      className="ap-btn-secondary !min-h-[44px] sm:!min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold cursor-pointer disabled:opacity-50"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>
                        {exportingFormat === 'csv' ? 'Exporting CSV…' : 'Download My Data (CSV)'}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="pt-2 space-y-2.5">
                  {!showDeleteAccountConfirm ? (
                    <button
                      type="button"
                      data-testid="account-delete-open-btn"
                      onClick={() => setShowDeleteAccountConfirm(true)}
                      className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-600 dark:text-rose-300 hover:bg-rose-500/10 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete My Account…</span>
                    </button>
                  ) : (
                    <div className="space-y-2.5 pt-2 border-t border-rose-500/20">
                      <p className="text-xs text-rose-700 dark:text-rose-300">
                        This permanently erases your MeetReady login credentials, encrypted cloud vault, connected watch/Strava tokens, and removes you from team rosters. Type <strong className="font-mono">DELETE</strong> below to confirm.
                      </p>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          data-testid="account-delete-confirm-input"
                          aria-label="Type DELETE to confirm permanent account deletion"
                          value={deleteConfirmText}
                          onChange={(e) => setDeleteConfirmText(e.target.value)}
                          placeholder="Type DELETE to confirm"
                          className="flex-1 min-h-[44px] sm:min-h-[38px] rounded-lg border border-rose-400/60 bg-white dark:bg-ap-turf px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                        />
                        <button
                          type="button"
                          data-testid="account-delete-submit-btn"
                          disabled={
                            isDeletingAccount || deleteConfirmText.trim() !== 'DELETE'
                          }
                          onClick={() => void handlePermanentAccountDelete()}
                          className="min-h-[44px] sm:min-h-[38px] px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer disabled:opacity-40 whitespace-nowrap"
                        >
                          {isDeletingAccount ? 'Deleting…' : 'Permanently Delete Account'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowDeleteAccountConfirm(false);
                            setDeleteConfirmText('');
                          }}
                          className="ap-btn-secondary !min-h-[44px] sm:!min-h-[38px] px-3 py-1.5 text-xs cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
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
                  <span>Open MeetReady Coach Desk</span>
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
