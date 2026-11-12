import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Users,
  Shield,
  UserPlus,
  Copy,
  Check,
  CalendarPlus,
  Eye,
  Lock,
  Activity,
  HeartPulse,
  MapPin,
  CheckCircle2,
  Trash2,
  ArrowUpRight,
  Timer,
  Trophy,
  Zap,
} from "./icons/PhosphorIcons";
import {
  AthleteConnectionRole,
  AthletePrivacySettings,
  AthleteProfile,
  ConnectedAthleteRecord,
  DistanceUnit,
  PrivacyVisibilityTier,
  TeamSummaryWithRole,
  VdotPodIntensity,
} from '../types';
import { applyAthletePrivacyShield } from '../data/athleteRosterData';
import {
  computeTeamVdotPacingPods,
  formatPrintablePodSplitSheet,
  formatTrackMark,
  summarizeNcaaCaraWeeklyHours,
  type VdotPodRosterInput,
} from '../physiology/scholasticEngine';
import { AeroPulseLogo } from './AeroPulseLogo';
import { TeamManagementPanel } from './TeamManagementPanel';

export type RosterTab =
  | 'TEAMS_BRANDING'
  | 'LEADERBOARD'
  | 'SCHOLASTIC_COACH'
  | 'CONNECT_INVITE'
  | 'PRIVACY_SHIELD';

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
  activeAthleteId: string; // 'SELF' or ConnectedAthleteRecord.id
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
}

const AVATAR_PALETTE = ['#F97316', '#38BDF8', '#10B981', '#A855F7', '#F43F5E'];

export const AthleteRosterModal: React.FC<AthleteRosterModalProps> = ({
  isOpen,
  onClose,
  selfName,
  selfInviteCode,
  selfCtl,
  selfAtl,
  selfTsb,
  selfHrv,
  selfProfile,
  selfPrivacySettings,
  onUpdateSelfPrivacy,
  roster,
  activeAthleteId,
  onSelectAthleteViewport,
  onApproveRequest,
  onRemoveOrDeclineAthlete,
  onToggleAthleteRole,
  onAddFollowByInviteOrName,
  onPushCoachWorkout,
  myTeams = [],
  activeTeamId = null,
  resendConfigured = false,
  initialTab = 'TEAMS_BRANDING',
  onSelectActiveTeam,
  onTeamsUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<RosterTab>(initialTab);
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  const activeTeamObj = useMemo(
    () => myTeams.find((t) => t.brand.teamId === activeTeamId) || null,
    [myTeams, activeTeamId]
  );

  // Follow / Invite form state
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteRole, setInviteRole] = useState<'COACH_EDIT' | 'FRIEND_VIEW'>('FRIEND_VIEW');
  const [inviteSpecialty, setInviteSpecialty] = useState<'Running' | 'Cycling'>('Running');
  const [followFeedback, setFollowFeedback] = useState<string | null>(null);

  // Coach Push Workout state
  const [pushTargetAthleteId, setPushTargetAthleteId] = useState<string | null>(null);
  const [workoutDate, setWorkoutDate] = useState<string>(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  });
  const [workoutName, setWorkoutName] = useState('Coach Prescribed: 5x1km @ 102% Threshold');
  const [workoutSport, setWorkoutSport] = useState<'Running' | 'Cycling'>('Running');
  const [workoutDurationMins, setWorkoutDurationMins] = useState(60);
  const [workoutLoad, setWorkoutLoad] = useState(82);
  const [workoutSyntax, setWorkoutSyntax] = useState(
    '- 15m 65% Pace\n- 5x 4m 102% Pace / 90s 60% Pace\n- 10m 65% Pace'
  );
  const [workoutNotes, setWorkoutNotes] = useState(
    'Focus on relaxed shoulders and even 400m splits. Pushed via Thresh Coach Desk.'
  );
  const [pushSuccessBanner, setPushSuccessBanner] = useState<string | null>(null);

  // HS & College Coach Deck State (VDOT Pacing Pods + Watchless Multi-Athlete Split Pad)
  const [podIntensity, setPodIntensity] = useState<VdotPodIntensity>('THRESHOLD_CV');
  const [podRepCount, setPodRepCount] = useState<number>(6);
  const [podRepDistance, setPodRepDistance] = useState<200 | 400 | 800 | 1000 | 1600>(1000);
  const [podRecoveryLabel, setPodRecoveryLabel] = useState<string>('60s jog');
  const [extraPodAthletes, setExtraPodAthletes] = useState<VdotPodRosterInput[]>([]);
  const [guestPodName, setGuestPodName] = useState<string>('');
  const [guestPodVdot, setGuestPodVdot] = useState<string>('56.0');
  const [copiedSplitSheet, setCopiedSplitSheet] = useState<boolean>(false);

  // Trackside Watchless / Spikes-On Multi-Athlete Split Stopwatch
  const [stopwatchRunning, setStopwatchRunning] = useState<boolean>(false);
  const [stopwatchElapsedMs, setStopwatchElapsedMs] = useState<number>(0);
  const stopwatchStartRef = useRef<number | null>(null);
  const [athleteLapTimestampsSecs, setAthleteLapTimestampsSecs] = useState<
    Record<string, number[]>
  >({});
  const [copiedStopwatchCsv, setCopiedStopwatchCsv] = useState<boolean>(false);

  useEffect(() => {
    if (!stopwatchRunning) return;
    stopwatchStartRef.current = performance.now() - stopwatchElapsedMs;
    const id = window.setInterval(() => {
      if (stopwatchStartRef.current !== null) {
        setStopwatchElapsedMs(Math.max(0, performance.now() - stopwatchStartRef.current));
      }
    }, 50);
    return () => window.clearInterval(id);
  }, [stopwatchRunning]);

  const connectedRoster = useMemo(
    () => roster.filter((a) => a.status === 'CONNECTED'),
    [roster]
  );
  const pendingRequests = useMemo(
    () => roster.filter((a) => a.status !== 'CONNECTED'),
    [roster]
  );

  const isCoachingActiveTeam =
    activeTeamObj?.myRole === 'HEAD_COACH' || activeTeamObj?.myRole === 'ASSISTANT_COACH';
  const [includeSelfInPods, setIncludeSelfInPods] = useState<boolean>(!isCoachingActiveTeam);

  useEffect(() => {
    setIncludeSelfInPods(!isCoachingActiveTeam);
  }, [isCoachingActiveTeam]);

  const combinedPodRoster = useMemo<VdotPodRosterInput[]>(() => {
    const base: VdotPodRosterInput[] = [
      ...(includeSelfInPods || (connectedRoster.length === 0 && extraPodAthletes.length === 0)
        ? [
            {
              id: 'SELF',
              name: selfName || 'Coach / Lead',
              thresholdPaceSecsPerKm: selfProfile.thresholdPaceSecsPerKm || 245,
            },
          ]
        : []),
      ...connectedRoster.map((c) => ({
        id: c.id,
        name: c.name,
        thresholdPaceSecsPerKm: c.athleteProfile.thresholdPaceSecsPerKm || 250,
      })),
      ...extraPodAthletes,
    ];
    return base;
  }, [
    includeSelfInPods,
    selfName,
    selfProfile.thresholdPaceSecsPerKm,
    connectedRoster,
    extraPodAthletes,
  ]);

  const generatedVdotPods = useMemo(
    () =>
      computeTeamVdotPacingPods({
        roster: combinedPodRoster,
        intensity: podIntensity,
        repCount: podRepCount,
        repDistanceMeters: podRepDistance,
        recoveryLabel: podRecoveryLabel,
      }),
    [combinedPodRoster, podIntensity, podRepCount, podRepDistance, podRecoveryLabel]
  );

  if (!isOpen) return null;

  const handleCopyInvite = () => {
    navigator.clipboard.writeText(selfInviteCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleFollowSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteQuery.trim()) return;
    onAddFollowByInviteOrName(inviteQuery.trim(), inviteRole, inviteSpecialty);
    setFollowFeedback(
      `Connected with "${inviteQuery.trim()}" as ${
        inviteRole === 'COACH_EDIT' ? 'Coached Athlete (Edit Calendar)' : 'Friend (View Telemetry)'
      }.`
    );
    setInviteQuery('');
    setTimeout(() => setFollowFeedback(null), 4000);
  };

  const handleOpenCoachPush = (athlete: ConnectedAthleteRecord) => {
    setPushTargetAthleteId(athlete.id);
    if (athlete.primarySport === 'Cycling') {
      setWorkoutSport('Cycling');
      setWorkoutName('Coach Prescribed: 4x10m @ 98% FTP Over/Unders');
      setWorkoutDurationMins(75);
      setWorkoutLoad(88);
      setWorkoutSyntax('- 15m 60% FTP\n- 4x 10m 98% FTP / 4m 55% FTP\n- 10m 55% FTP');
      setWorkoutNotes('Keep cadence above 90rpm on the threshold blocks.');
    } else {
      setWorkoutSport('Running');
      setWorkoutName('Coach Prescribed: 5x1km @ 102% Threshold');
      setWorkoutDurationMins(55);
      setWorkoutLoad(78);
      setWorkoutSyntax('- 15m 65% Pace\n- 5x 4m 102% Pace / 90s 60% Pace\n- 10m 65% Pace');
      setWorkoutNotes('Hit each kilometer split within ±2s/km of target threshold pace.');
    }
  };

  const handleConfirmPushWorkout = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pushTargetAthleteId) return;
    const targetAthlete = roster.find((r) => r.id === pushTargetAthleteId);
    onPushCoachWorkout(pushTargetAthleteId, {
      date: workoutDate,
      name: workoutName,
      sportCategory: workoutSport,
      plannedDurationSecs: workoutDurationMins * 60,
      plannedLoad: workoutLoad,
      workoutSyntax,
      description: workoutNotes,
    });
    setPushSuccessBanner(
      `Scheduled "${workoutName}" onto ${targetAthlete?.name || 'Athlete'}'s calendar for ${workoutDate}.`
    );
    setPushTargetAthleteId(null);
    setTimeout(() => setPushSuccessBanner(null), 4500);
  };

  const formatRoleBadge = (role: AthleteConnectionRole, status?: ConnectedAthleteRecord['status']) => {
    if (status && status !== 'CONNECTED') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase ap-status-caution">
          Pending Request
        </span>
      );
    }
    if (role === 'COACH_EDIT') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase ap-status-caution">
          <CalendarPlus className="w-3 h-3" />
          Coach (Edit Calendar)
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase ap-status-info">
        <Eye className="w-3 h-3" />
        Friend (View)
      </span>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Athletes, Friends & Coaching Hub"
      onClick={onClose}
      className="fixed inset-0 z-[60] bg-slate-950/60 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-2xl liquid-glass shadow-2xl border border-stone-200/90 dark:border-white/10 text-slate-900 dark:text-slate-100 max-w-6xl w-full max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-stone-200/80 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-4 liquid-glass-subtle">
          <div className="flex items-center gap-3">
            <AeroPulseLogo size="sm" teamBrand={activeTeamObj?.brand || null} />
            <div className="h-6 w-px bg-stone-300 dark:bg-slate-800 hidden sm:block" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Teams, Bulk Invites &amp; Coaching Hub
                </h2>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-sky-500/10 text-sky-700 dark:text-[#38BDF8] border border-sky-500/30">
                  MULTI-TEAM &amp; SAFE-SPORT
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Create school/club branding, send bulk Resend email invites, switch multi-team rosters, or run VDOT pacing pods.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Personal Invite Code Pill */}
            <div className="hidden sm:flex items-center gap-2 liquid-glass-subtle border border-stone-200/80 dark:border-white/10 rounded-lg px-3 py-1.5">
              <span className="text-[10px] font-mono uppercase text-slate-500 dark:text-slate-400">Your Invite Code:</span>
              <span className="text-xs font-mono font-bold ap-text-brand">{selfInviteCode}</span>
              <button
                onClick={handleCopyInvite}
                className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                title="Copy your THRESH Invite Code"
              >
                {copiedCode ? (
                  <Check className="w-3.5 h-3.5 text-[#10B981]" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            <button
              onClick={onClose}
              className="px-2.5 py-1.5 rounded-lg liquid-glass-subtle hover:bg-stone-200/70 dark:hover:bg-slate-800 border border-stone-200/80 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors flex items-center gap-1.5 text-xs font-mono"
              title="Close Roster Hub (Esc)"
            >
              <span>Esc</span>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 border-b border-stone-200/80 dark:border-slate-800/80 bg-[#ECEEE6]/80 dark:bg-[#0E1210] flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-1 overflow-x-auto">
            <button
              onClick={() => setActiveTab('TEAMS_BRANDING')}
              className={`px-3.5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                activeTab === 'TEAMS_BRANDING'
                  ? 'border-[#558B00] dark:border-[#C8FF00] text-slate-900 dark:text-white font-semibold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Users className="w-3.5 h-3.5 ap-text-brand" />
              <span>Teams, Bulk Invite &amp; Branding ({myTeams.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('LEADERBOARD')}
              className={`px-3.5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                activeTab === 'LEADERBOARD'
                  ? 'border-[#F97316] text-slate-900 dark:text-white font-semibold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-[#F97316]" />
              <span>Roster Triage ({connectedRoster.length + 1})</span>
            </button>

            <button
              onClick={() => setActiveTab('SCHOLASTIC_COACH')}
              className={`px-4 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'SCHOLASTIC_COACH'
                  ? 'border-amber-500 text-slate-900 dark:text-white font-semibold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Trophy className="w-3.5 h-3.5 text-amber-500" />
              <span>HS &amp; College Coach Deck</span>
            </button>

            <button
              onClick={() => setActiveTab('CONNECT_INVITE')}
              className={`px-4 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'CONNECT_INVITE'
                  ? 'border-[#38BDF8] text-slate-900 dark:text-white font-semibold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5 text-[#38BDF8]" />
              <span>Follow Friends &amp; Requests</span>
              {pendingRequests.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-[#F59E0B] text-black font-bold text-[10px]">
                  {pendingRequests.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('PRIVACY_SHIELD')}
              className={`px-4 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'PRIVACY_SHIELD'
                  ? 'border-[#10B981] text-slate-900 dark:text-white font-semibold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Shield className="w-3.5 h-3.5 text-[#10B981]" />
              <span>Privacy &amp; Strava Security Controls</span>
            </button>
          </div>

          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 py-2">
            Viewing Context:{' '}
            <span className="text-slate-900 dark:text-white font-semibold">
              {activeAthleteId === 'SELF'
                ? `${selfName} (You)`
                : roster.find((r) => r.id === activeAthleteId)?.name || 'Athlete'}
            </span>
          </div>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {pushSuccessBanner && (
            <div className="bg-[#10B981]/15 border border-[#10B981]/40 rounded-lg px-4 py-3 flex items-center justify-between text-xs text-emerald-700 dark:text-[#10B981] font-mono">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{pushSuccessBanner}</span>
              </div>
              <button onClick={() => setPushSuccessBanner(null)} className="text-xs underline">
                Dismiss
              </button>
            </div>
          )}

          {/* TAB 0: MULTI-TEAM BRANDING STUDIO, BULK RESEND INVITER & ONBOARDING FUNNEL */}
          {activeTab === 'TEAMS_BRANDING' && (
            <TeamManagementPanel
              selfName={selfName}
              myTeams={myTeams}
              activeTeamId={activeTeamId}
              resendConfigured={resendConfigured}
              onSelectActiveTeam={(nextId) => onSelectActiveTeam?.(nextId)}
              onTeamsUpdated={(nextTeams, nextActiveId) =>
                onTeamsUpdated?.(nextTeams, nextActiveId)
              }
            />
          )}

          {/* TAB 1: TEAM & FRIENDS ROSTER LEADERBOARD */}
          {activeTab === 'LEADERBOARD' && (
            <div className="space-y-5">
              {/* Exception-Based Coach & Club 6:00 AM Triage Inbox */}
              <div className="rounded-xl border border-stone-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/70 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="ap-status-caution px-2 py-0.5 rounded-md font-mono text-[10px] font-bold uppercase">
                        Coach Triage Inbox · 6:00 AM Exception Scan
                      </span>
                      <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                        Autonomic HRV &amp; Orthopedic Guardrail Exceptions
                      </h3>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Surfaces only athletes with suppressed overnight rMSSD, deep negative TSB (&lt;-20), or elevated running impact ACWR so coaches can approve morphed workouts in 1 click.
                    </p>
                  </div>
                  <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                    {connectedRoster.length} Connected Athlete{connectedRoster.length === 1 ? '' : 's'}
                  </span>
                </div>

                {connectedRoster.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-stone-300 dark:border-slate-800 px-4 py-3 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2">
                    <span>
                      No coached athletes connected yet. Share your invite code ({selfInviteCode}) or connect an athlete in the Follow tab to activate morning exception triage.
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('CONNECT_INVITE')}
                      className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs whitespace-nowrap"
                    >
                      + Connect Athlete
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {connectedRoster.map((ath) => {
                      const latestW =
                        ath.wellnessDays && ath.wellnessDays.length > 0
                          ? ath.wellnessDays[ath.wellnessDays.length - 1]
                          : null;
                      const tsb = latestW?.tsb ?? 0;
                      const hrv = latestW?.hrvRMSSD ?? 60;
                      const isStrained = tsb < -20 || hrv < 48;
                      return (
                        <div
                          key={`triage-${ath.id}`}
                          className="rounded-lg border border-stone-200 dark:border-slate-800 p-3 flex flex-wrap items-center justify-between gap-2 text-xs"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                                  isStrained ? 'ap-status-strained' : 'ap-status-prime'
                                }`}
                              >
                                {isStrained ? 'Action Needed' : 'Green Readiness'}
                              </span>
                              <span className="font-bold text-slate-900 dark:text-white">
                                {ath.name}
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                              HRV {Math.round(hrv)}ms · TSB {tsb >= 0 ? `+${Math.round(tsb)}` : Math.round(tsb)} ·{' '}
                              {ath.primarySport}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              onPushCoachWorkout(ath.id, {
                                date: workoutDate,
                                name: 'Coach Approved: Autonomous Z2 Recovery Morph',
                                sportCategory: 'Cycling',
                                plannedDurationSecs: 45 * 60,
                                plannedLoad: 38,
                                workoutSyntax: '- 10m 55% FTP\n- 25m 68% FTP 92rpm\n- 10m 50% FTP',
                                description:
                                  '1-click Coach Triage approval: swapped high-impact session to zero-impact Z2 recovery spin.',
                              });
                              setPushSuccessBanner(
                                `Approved autonomous Z2 morph for ${ath.name} (${workoutDate}).`
                              );
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-[11px] whitespace-nowrap"
                          >
                            1-Click Approve Z2 Morph
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="overflow-x-auto rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-stone-200/80 dark:border-slate-800/80 text-[10px] font-mono uppercase text-slate-500 dark:text-slate-400 bg-stone-200/40 dark:bg-[#0F131A]">
                      <th className="py-3 px-4">Athlete / Strava ID</th>
                      <th className="py-3 px-3">Access Role</th>
                      <th className="py-3 px-3">Fitness (CTL)</th>
                      <th className="py-3 px-3">Fatigue (ATL)</th>
                      <th className="py-3 px-3">Form (TSB)</th>
                      <th className="py-3 px-3">Morning HRV</th>
                      <th className="py-3 px-3">FTP / W/kg</th>
                      <th className="py-3 px-3">Target Objective</th>
                      <th className="py-3 px-4 text-right">Workspace Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200/70 dark:divide-slate-800/80 text-xs">
                    {/* Row 0: Self */}
                    <tr
                      className={`transition-colors ${
                        activeAthleteId === 'SELF'
                          ? 'bg-[#F97316]/10'
                          : 'hover:bg-stone-200/40 dark:hover:bg-[#14181F]/60'
                      }`}
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#F97316] to-[#3B82F6] flex items-center justify-center font-mono font-bold text-xs text-white">
                            YOU
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                              <span>{selfName}</span>
                              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#F97316]/20 text-orange-600 dark:text-[#F97316]">
                                Primary Account
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                              Invite: {selfInviteCode}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                          Owner (Full Control)
                        </span>
                      </td>
                      <td className="py-3.5 px-3 font-mono font-semibold text-sky-600 dark:text-[#38BDF8]">
                        {Math.round(selfCtl)}
                      </td>
                      <td className="py-3.5 px-3 font-mono text-purple-600 dark:text-[#A855F7]">
                        {Math.round(selfAtl)}
                      </td>
                      <td className="py-3.5 px-3 font-mono">
                        <span
                          className={
                            selfTsb >= 0
                              ? 'text-emerald-600 dark:text-[#10B981] font-semibold'
                              : selfTsb >= -15
                              ? 'text-sky-600 dark:text-[#38BDF8]'
                              : 'text-amber-600 dark:text-[#F59E0B]'
                          }
                        >
                          {selfTsb > 0 ? `+${Math.round(selfTsb)}` : Math.round(selfTsb)}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 font-mono text-emerald-600 dark:text-[#10B981]">{selfHrv} ms</td>
                      <td className="py-3.5 px-3 font-mono text-slate-700 dark:text-slate-300">
                        {selfProfile.safeSportHideWeight
                          ? `${selfProfile.ftp}W (Safe-Sport)`
                          : `${selfProfile.ftp}W (${(selfProfile.ftp / Math.max(40, selfProfile.weightKg)).toFixed(2)} W/kg)`}
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="text-xs text-slate-900 dark:text-white font-medium">
                          {selfProfile.ftp}W FTP ·{' '}
                          {Math.floor((selfProfile.thresholdPaceSecsPerKm || 245) / 60)}:
                          {String(
                            Math.round((selfProfile.thresholdPaceSecsPerKm || 245) % 60)
                          ).padStart(2, '0')}
                          /km LT
                        </div>
                        <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                          Active Plan Architect
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => {
                            onSelectAthleteViewport('SELF');
                            onClose();
                          }}
                          className={`px-3 py-1.5 rounded text-xs font-mono transition-colors ${
                            activeAthleteId === 'SELF'
                              ? 'bg-[#F97316] text-white font-semibold'
                              : 'bg-white dark:bg-[#14181F] hover:bg-stone-100 dark:hover:bg-[#1E2530] text-slate-800 dark:text-slate-200 border border-stone-300 dark:border-slate-800'
                          }`}
                        >
                          {activeAthleteId === 'SELF' ? 'Active Viewport' : 'Switch to My Profile'}
                        </button>
                      </td>
                    </tr>

                    {/* Connected Athletes */}
                    {connectedRoster.map((rawAthlete, idx) => {
                      const shielded = applyAthletePrivacyShield(rawAthlete);
                      const isSelected = activeAthleteId === rawAthlete.id;
                      const rawLatest =
                        rawAthlete.wellnessDays[rawAthlete.wellnessDays.length - 1];
                      const shieldedLatest =
                        shielded.wellnessDays[shielded.wellnessDays.length - 1];
                      const avatarColor = AVATAR_PALETTE[idx % AVATAR_PALETTE.length];

                      const hrvMasked = shielded.redactedWellness;
                      const pmcMasked =
                        rawAthlete.role === 'FRIEND_VIEW' &&
                        rawAthlete.privacySettings.sharePmcAndZones === 'PRIVATE';

                      const ctlVal = rawLatest?.ctl ?? 65;
                      const atlVal = rawLatest?.atl ?? 60;
                      const tsbVal = rawLatest?.tsb ?? 5;
                      const wPerKg = (
                        rawAthlete.athleteProfile.ftp /
                        Math.max(40, rawAthlete.athleteProfile.weightKg)
                      ).toFixed(2);
                      const weeklyTss = rawAthlete.wellnessDays
                        .slice(-7)
                        .reduce((acc, d) => acc + (d.dailyLoad || 0), 0);

                      return (
                        <tr
                          key={rawAthlete.id}
                          className={`transition-colors ${
                            isSelected ? 'bg-[#38BDF8]/10' : 'hover:bg-stone-200/40 dark:hover:bg-[#14181F]/60'
                          }`}
                        >
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-3">
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center font-mono font-bold text-xs text-slate-900 dark:text-white border"
                                style={{
                                  backgroundColor: `${avatarColor}25`,
                                  borderColor: `${avatarColor}80`,
                                }}
                              >
                                {rawAthlete.avatarInitials}
                              </div>
                              <div>
                                <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                                  <span>{rawAthlete.name}</span>
                                  <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                                    #{rawAthlete.stravaAthleteId}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-600 dark:text-slate-400">
                                  {rawAthlete.location} • {rawAthlete.primarySport}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="py-3.5 px-3">
                            <div className="flex flex-col items-start gap-1">
                              {formatRoleBadge(rawAthlete.role, rawAthlete.status)}
                              <button
                                onClick={() => onToggleAthleteRole(rawAthlete.id)}
                                className="text-[10px] font-mono text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white underline"
                              >
                                Switch to {rawAthlete.role === 'COACH_EDIT' ? 'Friend View' : 'Coach Edit'}
                              </button>
                            </div>
                          </td>

                          <td className="py-3.5 px-3 font-mono font-semibold text-sky-600 dark:text-[#38BDF8]">
                            {pmcMasked ? (
                              <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                <Lock className="w-3 h-3" /> Private
                              </span>
                            ) : (
                              Math.round(ctlVal)
                            )}
                          </td>

                          <td className="py-3.5 px-3 font-mono text-purple-600 dark:text-[#A855F7]">
                            {pmcMasked ? '—' : Math.round(atlVal)}
                          </td>

                          <td className="py-3.5 px-3 font-mono">
                            {pmcMasked ? (
                              '—'
                            ) : (
                              <span
                                className={
                                  tsbVal >= 0
                                    ? 'text-emerald-600 dark:text-[#10B981] font-semibold'
                                    : tsbVal >= -15
                                    ? 'text-sky-600 dark:text-[#38BDF8]'
                                    : 'text-amber-600 dark:text-[#F59E0B]'
                                }
                              >
                                {tsbVal > 0 ? `+${Math.round(tsbVal)}` : Math.round(tsbVal)}
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-3 font-mono">
                            {hrvMasked ? (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-[#F59E0B] bg-[#F59E0B]/10 border border-[#F59E0B]/30 px-1.5 py-0.5 rounded"
                                title="Hidden by Athlete's Privacy Shield for Friend View"
                              >
                                <Lock className="w-3 h-3" /> Coaches Only
                              </span>
                            ) : (
                              <span className="text-emerald-600 dark:text-[#10B981]">
                                {shieldedLatest?.hrvRMSSD || rawLatest?.hrvRMSSD || 58} ms
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-3 font-mono text-slate-700 dark:text-slate-300">
                            {rawAthlete.athleteProfile.safeSportHideWeight ||
                            activeTeamObj?.brand.defaultSafeSportShield
                              ? `${rawAthlete.athleteProfile.ftp}W (Safe-Sport)`
                              : `${rawAthlete.athleteProfile.ftp}W (${wPerKg} W/kg)`}
                          </td>

                          <td className="py-3.5 px-3">
                            <div className="text-xs text-slate-900 dark:text-white font-medium">
                              {rawAthlete.primaryGoalSummary}
                            </div>
                            <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                              7d Load: {weeklyTss} TSS
                            </div>
                          </td>

                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {rawAthlete.role === 'COACH_EDIT' &&
                                rawAthlete.privacySettings.allowCoachCalendarEdits && (
                                  <button
                                    onClick={() => handleOpenCoachPush(rawAthlete)}
                                    className="px-2.5 py-1.5 rounded text-xs font-mono bg-[#F97316]/15 hover:bg-[#F97316]/25 text-orange-700 dark:text-[#F97316] border border-[#F97316]/40 flex items-center gap-1 transition-colors"
                                    title="Push Structured Workout to Athlete's Calendar"
                                  >
                                    <CalendarPlus className="w-3.5 h-3.5" />
                                    <span>Push Workout</span>
                                  </button>
                                )}

                              <button
                                onClick={() => {
                                  onSelectAthleteViewport(rawAthlete.id);
                                  onClose();
                                }}
                                className={`px-3 py-1.5 rounded text-xs font-mono flex items-center gap-1 transition-colors ${
                                  isSelected
                                    ? 'bg-[#38BDF8] text-black font-semibold'
                                    : 'bg-white dark:bg-[#14181F] hover:bg-stone-100 dark:hover:bg-[#1E2530] text-slate-900 dark:text-white border border-stone-300 dark:border-slate-800'
                                }`}
                              >
                                <span>{isSelected ? 'Viewing' : 'View Dashboard'}</span>
                                <ArrowUpRight className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Inline Coach Workout Prescription Drawer */}
              {pushTargetAthleteId && (
                <form
                  onSubmit={handleConfirmPushWorkout}
                  className="rounded-xl liquid-glass-subtle border border-[#F97316]/50 p-5 space-y-4 shadow-xl"
                >
                  <div className="flex items-center justify-between border-b border-stone-200/80 dark:border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <CalendarPlus className="w-4 h-4 text-[#F97316]" />
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        Coach Workout Prescription Desk — Target:{' '}
                        <span className="text-[#F97316]">
                          {roster.find((r) => r.id === pushTargetAthleteId)?.name}
                        </span>
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPushTargetAthleteId(null)}
                      className="text-xs font-mono text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-[10px] font-mono uppercase text-slate-600 dark:text-slate-400 mb-1">
                        Workout Title
                      </label>
                      <input
                        type="text"
                        value={workoutName}
                        onChange={(e) => setWorkoutName(e.target.value)}
                        className="w-full bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 rounded px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 font-mono"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-mono uppercase text-slate-600 dark:text-slate-400 mb-1">
                        Scheduled Date
                      </label>
                      <input
                        type="date"
                        value={workoutDate}
                        onChange={(e) => setWorkoutDate(e.target.value)}
                        className="w-full bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 rounded px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 font-mono"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-mono uppercase text-slate-600 dark:text-slate-400 mb-1">
                        Sport &amp; Target Load
                      </label>
                      <div className="flex gap-2">
                        <select
                          value={workoutSport}
                          onChange={(e) => setWorkoutSport(e.target.value as 'Running' | 'Cycling')}
                          className="bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 rounded px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100 font-mono"
                        >
                          <option value="Running">Running</option>
                          <option value="Cycling">Cycling</option>
                        </select>
                        <input
                          type="number"
                          value={workoutLoad}
                          onChange={(e) => setWorkoutLoad(Number(e.target.value))}
                          className="w-20 bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 rounded px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100 font-mono"
                          placeholder="TSS"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-mono uppercase text-slate-600 dark:text-slate-400 mb-1">
                        Intervals.icu Structured Workout Syntax
                      </label>
                      <textarea
                        rows={3}
                        value={workoutSyntax}
                        onChange={(e) => setWorkoutSyntax(e.target.value)}
                        className="w-full bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 rounded p-2.5 text-xs font-mono text-sky-700 dark:text-[#38BDF8]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono uppercase text-slate-600 dark:text-slate-400 mb-1">
                        Coach Execution Notes &amp; Duration (Mins)
                      </label>
                      <textarea
                        rows={2}
                        value={workoutNotes}
                        onChange={(e) => setWorkoutNotes(e.target.value)}
                        className="w-full bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 rounded p-2.5 text-xs text-slate-900 dark:text-slate-100 mb-2"
                      />
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-mono text-slate-600 dark:text-slate-400">
                          <span>Duration (min):</span>
                          <input
                            type="number"
                            value={workoutDurationMins}
                            onChange={(e) => setWorkoutDurationMins(Number(e.target.value))}
                            className="w-16 bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 rounded px-2 py-1 text-xs text-slate-900 dark:text-slate-100"
                          />
                        </div>
                        <button
                          type="submit"
                          className="px-4 py-1.5 rounded bg-[#F97316] hover:bg-[#EA580C] text-white text-xs font-mono font-semibold transition-colors"
                        >
                          Push Workout to Athlete Calendar
                        </button>
                      </div>
                    </div>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* TAB 1B: HIGH SCHOOL & COLLEGIATE COACH DECK (VDOT PODS, WATCHLESS SPLIT PAD & NCAA CARA) */}
          {activeTab === 'SCHOLASTIC_COACH' && (
            <div className="space-y-6">
              {pushSuccessBanner && (
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-mono flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    {pushSuccessBanner}
                  </span>
                  <button
                    onClick={() => setPushSuccessBanner(null)}
                    className="text-slate-500 hover:text-slate-900 dark:hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Section 1: Auto-Clustered VDOT Pacing Pods & Trackside Split Sheet */}
              <div className="rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10 p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="ap-status-caution px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase">
                        Auto-Scaled Squad Pacing
                      </span>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        VDOT Pacing Pod Generator &amp; Printable Trackside Sheet
                      </h3>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                      Write 1 workout once: Thresh clusters your varsity &amp; developmental squad into cohesive VDOT pods (±2s/400m) with exact 200m–1600m splits.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const sheet = formatPrintablePodSplitSheet(
                        `${podRepCount}x${podRepDistance}m (${podIntensity})`,
                        workoutDate,
                        generatedVdotPods
                      );
                      navigator.clipboard.writeText(sheet);
                      setCopiedSplitSheet(true);
                      window.setTimeout(() => setCopiedSplitSheet(false), 2500);
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold font-mono transition-colors flex items-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>
                      {copiedSplitSheet
                        ? 'Copied Printable Pod Sheet!'
                        : 'Copy Printable Clipboard Sheet'}
                    </span>
                  </button>
                </div>

                {/* Workout Prescription Controls + Walk-On Tryout Adder */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-xs">
                  <div className="lg:col-span-2">
                    <label className="block text-[10px] font-mono uppercase text-slate-500 mb-1">
                      Physiological Intensity
                    </label>
                    <select
                      value={podIntensity}
                      onChange={(e) => setPodIntensity(e.target.value as VdotPodIntensity)}
                      className="w-full rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono text-xs"
                    >
                      <option value="THRESHOLD_CV">Threshold / Tinman CV (~99% LT)</option>
                      <option value="INTERVAL_VO2">VO2max Interval (3K–5K Pace)</option>
                      <option value="REPETITION">Mile / Speed Repetition</option>
                      <option value="MARATHON">Steady State / Aerobic Tempo</option>
                      <option value="EASY">Easy / Recovery Run</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono uppercase text-slate-500 mb-1">
                      Rep Count
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={podRepCount}
                      onChange={(e) => setPodRepCount(Math.max(1, Number(e.target.value) || 1))}
                      className="w-full rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono uppercase text-slate-500 mb-1">
                      Rep Distance
                    </label>
                    <select
                      value={podRepDistance}
                      onChange={(e) =>
                        setPodRepDistance(Number(e.target.value) as 200 | 400 | 800 | 1000 | 1600)
                      }
                      className="w-full rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono text-xs"
                    >
                      <option value={200}>200m</option>
                      <option value={400}>400m</option>
                      <option value={800}>800m</option>
                      <option value={1000}>1000m</option>
                      <option value={1600}>1600m</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono uppercase text-slate-500 mb-1">
                      Recovery Cue
                    </label>
                    <input
                      type="text"
                      value={podRecoveryLabel}
                      onChange={(e) => setPodRecoveryLabel(e.target.value)}
                      className="w-full rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono uppercase text-slate-500 mb-1">
                      Scheduled Date
                    </label>
                    <input
                      type="date"
                      value={workoutDate}
                      onChange={(e) => setWorkoutDate(e.target.value)}
                      className="w-full rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono text-xs"
                    />
                  </div>
                </div>

                {/* Optional Quick Add Walk-On / Tryout Runner to Pod Sheet */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-mono text-slate-500">
                      + Add Walk-On / Unconnected Teammate to Pod Sheet:
                    </span>
                    <input
                      type="text"
                      placeholder="Runner Name (e.g. J. Ramirez)"
                      value={guestPodName}
                      onChange={(e) => setGuestPodName(e.target.value)}
                      className="rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1 font-mono text-xs w-48"
                    />
                    <input
                      type="number"
                      step="0.5"
                      min={30}
                      max={85}
                      placeholder="VDOT"
                      value={guestPodVdot}
                      onChange={(e) => setGuestPodVdot(e.target.value)}
                      className="rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1 font-mono text-xs w-20"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!guestPodName.trim()) return;
                        const v = Math.max(30, Math.min(85, Number(guestPodVdot) || 55));
                        setExtraPodAthletes((prev) => [
                          ...prev,
                          {
                            id: `guest-${Date.now()}`,
                            name: guestPodName.trim(),
                            thresholdPaceSecsPerKm: 250,
                            vdotOverride: v,
                          },
                        ]);
                        setGuestPodName('');
                      }}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 text-white font-mono text-[11px]"
                    >
                      + Add to Pod
                    </button>
                    {extraPodAthletes.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setExtraPodAthletes([])}
                        className="text-[11px] font-mono text-slate-500 hover:text-rose-500"
                      >
                        Clear {extraPodAthletes.length} guest{extraPodAthletes.length === 1 ? '' : 's'}
                      </button>
                    )}
                  </div>

                  {connectedRoster.length > 0 && (
                    <label className="inline-flex items-center gap-1.5 text-[11px] font-mono text-slate-600 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeSelfInPods}
                        onChange={(e) => setIncludeSelfInPods(e.target.checked)}
                        className="rounded"
                      />
                      <span>Include {selfName || 'Me'} in pods</span>
                    </label>
                  )}
                </div>

                {/* Generated Pod Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                  {generatedVdotPods.map((pod) => {
                    const coachedMemberIds = pod.athletes
                      .map((m) => m.id)
                      .filter((id) =>
                        connectedRoster.some(
                          (c) =>
                            c.id === id &&
                            c.role === 'COACH_EDIT' &&
                            c.privacySettings.allowCoachCalendarEdits
                        )
                      );

                    return (
                      <div
                        key={pod.podId}
                        className="rounded-xl border border-stone-200 dark:border-slate-800 bg-white/85 dark:bg-slate-950/75 p-4 space-y-2.5 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                              <Zap className="w-3.5 h-3.5 text-amber-500" />
                              <span>{pod.podName}</span>
                              <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-sky-300 font-mono text-[10px]">
                                VDOT{' '}
                                {pod.minVdot === pod.maxVdot
                                  ? pod.centerVdot
                                  : `${pod.minVdot}–${pod.maxVdot}`}
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 font-semibold mt-0.5">
                              {pod.workoutPrescriptionLine}
                            </div>
                          </div>

                          {coachedMemberIds.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                for (const athId of coachedMemberIds) {
                                  onPushCoachWorkout(athId, {
                                    date: workoutDate,
                                    name: `${pod.podName}: ${podRepCount}x${podRepDistance}m`,
                                    sportCategory: 'Running',
                                    plannedDurationSecs: 55 * 60,
                                    plannedLoad: 78,
                                    workoutSyntax: pod.workoutSyntax,
                                    description: `${pod.workoutPrescriptionLine} · Auto-scaled for ${pod.podName} (VDOT ${pod.centerVdot}).`,
                                  });
                                }
                                setPushSuccessBanner(
                                  `Pushed ${pod.podName} splits (${podRepCount}x${podRepDistance}m) to ${coachedMemberIds.length} coached athlete calendar${
                                    coachedMemberIds.length === 1 ? '' : 's'
                                  } for ${workoutDate}.`
                                );
                              }}
                              className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-[11px] whitespace-nowrap"
                            >
                              Push to Pod ({coachedMemberIds.length})
                            </button>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          {pod.athletes.map((a) => (
                            <span
                              key={a.id}
                              className="px-2 py-0.5 rounded-md bg-stone-200/70 dark:bg-slate-800 font-mono text-[11px] text-slate-800 dark:text-slate-200"
                            >
                              {a.name} ({a.vdot})
                            </span>
                          ))}
                        </div>

                        <div className="grid grid-cols-5 gap-1.5 pt-1 font-mono tabular-nums text-center">
                          {[
                            { lbl: '200m', val: pod.splitsSecs.split200m },
                            { lbl: '400m', val: pod.splitsSecs.split400m },
                            { lbl: '800m', val: pod.splitsSecs.split800m },
                            { lbl: '1000m', val: pod.splitsSecs.split1000m },
                            { lbl: '1600m', val: pod.splitsSecs.split1600m },
                          ].map((sp) => (
                            <div
                              key={sp.lbl}
                              className="rounded-lg bg-stone-100 dark:bg-slate-900 border border-stone-200/80 dark:border-slate-800 py-1.5 px-1"
                            >
                              <div className="text-[10px] text-slate-500">{sp.lbl}</div>
                              <div className="text-xs font-bold text-slate-900 dark:text-white">
                                {formatTrackMark(sp.val, 1)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Section 2: Trackside "Watchless / Spikes-On" Multi-Athlete Split Pad + NCAA CARA Cap */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <div className="lg:col-span-7 rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10 p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Timer className="w-4 h-4 text-sky-500" />
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                          Trackside &quot;Spikes-On / Watchless&quot; Multi-Athlete Split Pad
                        </h3>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                        Athletes racing or repping in spikes without GPS watches? Tap an athlete&apos;s row as they cross the line to capture 0.01s splits.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 font-mono">
                      <span className="text-lg font-extrabold tabular-nums text-sky-600 dark:text-sky-300 px-3 py-1 rounded-lg bg-slate-900/5 dark:bg-slate-950 border border-stone-200 dark:border-slate-800">
                        {formatTrackMark(stopwatchElapsedMs / 1000, 2)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setStopwatchRunning((r) => !r)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-colors ${
                          stopwatchRunning
                            ? 'bg-amber-600 hover:bg-amber-500'
                            : 'bg-emerald-600 hover:bg-emerald-500'
                        }`}
                      >
                        {stopwatchRunning ? 'Pause' : stopwatchElapsedMs > 0 ? 'Resume' : 'Start Gun'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setStopwatchRunning(false);
                          setStopwatchElapsedMs(0);
                          setAthleteLapTimestampsSecs({});
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-stone-300 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-stone-200/60 dark:hover:bg-slate-800"
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {combinedPodRoster.map((runner) => {
                      const marks = athleteLapTimestampsSecs[runner.id] || [];
                      const lapDeltas = marks.map((cumSecs, i) =>
                        Number((i === 0 ? cumSecs : cumSecs - marks[i - 1]).toFixed(2))
                      );
                      const lastLap = lapDeltas[lapDeltas.length - 1];
                      const cumTotal = marks[marks.length - 1];

                      return (
                        <div
                          key={runner.id}
                          className="rounded-lg border border-stone-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/70 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-[140px]">
                            <div className="font-bold text-slate-900 dark:text-white">
                              {runner.name}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                              {lapDeltas.length === 0
                                ? 'No laps tapped yet'
                                : `Laps (${lapDeltas.length}): ${lapDeltas
                                    .map((d) => formatTrackMark(d, 2))
                                    .join(', ')}`}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 font-mono tabular-nums">
                            {lastLap !== undefined && (
                              <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-bold text-[11px]">
                                Last: {formatTrackMark(lastLap, 2)} (Cum {formatTrackMark(cumTotal, 2)})
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                const nowSecs = Number(
                                  Math.max(0.01, stopwatchElapsedMs / 1000).toFixed(2)
                                );
                                setAthleteLapTimestampsSecs((prev) => ({
                                  ...prev,
                                  [runner.id]: [...(prev[runner.id] || []), nowSecs],
                                }));
                              }}
                              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs"
                            >
                              + Tap Split
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {Object.keys(athleteLapTimestampsSecs).length > 0 && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          const csvRows = ['Athlete,LapCount,CumulativeTime,LapSplits'];
                          for (const r of combinedPodRoster) {
                            const m = athleteLapTimestampsSecs[r.id];
                            if (!m || m.length === 0) continue;
                            const deltas = m.map((c, i) =>
                              formatTrackMark(i === 0 ? c : c - m[i - 1], 2)
                            );
                            csvRows.push(
                              `"${r.name}",${m.length},${formatTrackMark(
                                m[m.length - 1],
                                2
                              )},"${deltas.join(' | ')}"`
                            );
                          }
                          navigator.clipboard.writeText(csvRows.join('\n'));
                          setCopiedStopwatchCsv(true);
                          window.setTimeout(() => setCopiedStopwatchCsv(false), 2500);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 dark:bg-slate-700 text-white font-mono text-xs"
                      >
                        {copiedStopwatchCsv ? '✓ Copied Split CSV' : 'Copy All Splits (CSV)'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Right 5 Cols: NCAA Bylaw 17.1 (20-Hour Weekly CARA Cap) Compliance Monitor */}
                <div className="lg:col-span-5 rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10 p-5 space-y-3">
                  <div>
                    <span className="ap-status-info px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase">
                      NCAA Bylaw 17.1 Compliance
                    </span>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white mt-1">
                      20-Hour Weekly / 4-Hour Daily CARA Audit
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                      Rolling 7-day Countable Athletically Related Activities (CARA) across connected roster athletes.
                    </p>
                  </div>

                  {connectedRoster.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-stone-300 dark:border-slate-700 p-3.5 text-xs text-slate-500">
                      Connect squad athletes via Invite Code in the &quot;Follow Friends &amp; Requests&quot; tab to audit live rolling 7-day NCAA CARA hours automatically.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {connectedRoster.map((ath) => {
                        const baseAudit = summarizeNcaaCaraWeeklyHours(ath.activities);
                        const resolvedHours =
                          ath.activities.length === 0 && typeof ath.caraHours7d === 'number'
                            ? Number(ath.caraHours7d.toFixed(1))
                            : baseAudit.rolling7dCountableHours;
                        const compliant =
                          ath.activities.length === 0 && typeof ath.caraHours7d === 'number'
                            ? resolvedHours <= baseAudit.weeklyCapHours
                            : baseAudit.compliant;
                        const statusLabel = !compliant
                          ? 'Exceeds 20h Cap'
                          : resolvedHours >= 17
                            ? 'Approaching 20h Cap'
                            : 'CARA Compliant';
                        const barPct = Math.min(
                          100,
                          Math.round((resolvedHours / baseAudit.weeklyCapHours) * 100)
                        );
                        return (
                          <div
                            key={ath.id}
                            className="rounded-lg border border-stone-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/70 p-3 space-y-1.5 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-slate-900 dark:text-white">
                                {ath.name}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                                  compliant ? 'ap-status-prime' : 'ap-status-strained'
                                }`}
                              >
                                {statusLabel}
                              </span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-stone-200 dark:bg-slate-800 overflow-hidden">
                              <div
                                style={{ width: `${barPct}%` }}
                                className={`h-full rounded-full ${
                                  !compliant
                                    ? 'bg-rose-500'
                                    : barPct >= 85
                                      ? 'bg-amber-500'
                                      : 'bg-emerald-500'
                                }`}
                              />
                            </div>
                            <div className="flex justify-between font-mono text-[11px] text-slate-500 tabular-nums">
                              <span>7d Logged: {resolvedHours}h / 20h</span>
                              <span>
                                {ath.activities.length > 0
                                  ? `Peak Day: ${baseAudit.maxSingleDayHours}h / 4h`
                                  : 'Summary Sync'}
                              </span>
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

          {/* TAB 2: FOLLOW FRIENDS, INVITE CODES & PENDING REQUESTS */}
          {activeTab === 'CONNECT_INVITE' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left 6 cols: Add Athlete by Invite Code or Strava Name */}
              <div className="lg:col-span-6 space-y-4">
                <div className="rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10 p-5 space-y-4">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-sky-600 dark:text-[#38BDF8]">
                      ADD FRIEND OR COACHED ATHLETE
                    </span>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                      Follow Athlete by Invite Code or Strava Handle
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                      Enter a friend&apos;s THRESH Invite Code (e.g. <code className="text-[#D9480F] dark:text-[#FB6514]">TH-4401-TRACK</code>) or name to add them to your athlete switcher.
                    </p>
                  </div>

                  {followFeedback && (
                    <div className="p-3 rounded-lg ap-status-prime text-xs font-mono">
                      {followFeedback}
                    </div>
                  )}

                  <form onSubmit={handleFollowSubmit} className="space-y-3">
                    <div>
                      <label className="block text-[10px] font-mono uppercase text-slate-600 dark:text-slate-400 mb-1">
                        Athlete Name or Invite Code
                      </label>
                      <input
                        type="text"
                        value={inviteQuery}
                        onChange={(e) => setInviteQuery(e.target.value)}
                        placeholder="e.g. Jordan Mercer or TH-5120-VELO"
                        className="w-full bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#38BDF8]"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-mono uppercase text-slate-600 dark:text-slate-400 mb-1">
                          Connection Permission Tier
                        </label>
                        <select
                          value={inviteRole}
                          onChange={(e) =>
                            setInviteRole(e.target.value as 'COACH_EDIT' | 'FRIEND_VIEW')
                          }
                          className="w-full bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-slate-100 font-mono"
                        >
                          <option value="FRIEND_VIEW">Friend (View Telemetry)</option>
                          <option value="COACH_EDIT">Coached Athlete (Edit Calendar)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-mono uppercase text-slate-600 dark:text-slate-400 mb-1">
                          Primary Discipline
                        </label>
                        <select
                          value={inviteSpecialty}
                          onChange={(e) =>
                            setInviteSpecialty(e.target.value as 'Running' | 'Cycling')
                          }
                          className="w-full bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-slate-100 font-mono"
                        >
                          <option value="Running">Running / Track</option>
                          <option value="Cycling">Cycling / Power</option>
                        </select>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full py-2.5 rounded-lg bg-[#38BDF8] hover:bg-[#0284C7] text-black hover:text-white font-mono font-semibold text-xs transition-colors"
                    >
                      + Connect Athlete to Roster
                    </button>
                  </form>
                </div>

                {/* Share Your Invite Code Card */}
                <div className="rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10 p-5 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[10px] font-mono uppercase text-[#F97316]">
                      SHARE YOUR INVITE CODE WITH COACHES OR TEAMMATES
                    </div>
                    <div className="text-lg font-mono font-bold text-slate-900 dark:text-white mt-0.5">
                      {selfInviteCode}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-400">
                      Anyone with this code can request Friend View or Coach access to your telemetry.
                    </div>
                  </div>
                  <button
                    onClick={handleCopyInvite}
                    className="px-3.5 py-2 rounded-lg bg-white dark:bg-[#14181F] hover:bg-stone-100 dark:hover:bg-[#1E2530] border border-stone-300 dark:border-slate-800 text-xs font-mono text-slate-900 dark:text-white flex items-center gap-1.5 shrink-0"
                  >
                    {copiedCode ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[#10B981]" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Code</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Right 6 cols: Pending Incoming Requests & Connected Roster Management */}
              <div className="lg:col-span-6 space-y-4">
                <div className="rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-amber-600 dark:text-[#F59E0B]">
                      INCOMING FOLLOW &amp; COACHING REQUESTS ({pendingRequests.length})
                    </span>
                  </div>

                  {pendingRequests.length === 0 ? (
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono py-4 text-center">
                      No pending follow requests.
                    </div>
                  ) : (
                    pendingRequests.map((req, idx) => {
                      const avatarColor = AVATAR_PALETTE[(idx + 2) % AVATAR_PALETTE.length];
                      return (
                        <div
                          key={req.id}
                          className="bg-white/80 dark:bg-[#090B0E] border border-stone-200/90 dark:border-slate-800 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className="w-9 h-9 rounded-full flex items-center justify-center font-mono font-bold text-xs text-slate-900 dark:text-white"
                              style={{ backgroundColor: `${avatarColor}30` }}
                            >
                              {req.avatarInitials}
                            </div>
                            <div>
                              <div className="text-xs font-bold text-slate-900 dark:text-white">
                                {req.name}{' '}
                                <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                                  ({req.inviteCode})
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-600 dark:text-slate-400">
                                {req.location} • Goal: {req.primaryGoalSummary}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => onApproveRequest(req.id, 'FRIEND_VIEW')}
                              className="px-2.5 py-1.5 rounded bg-[#38BDF8]/15 hover:bg-[#38BDF8]/25 border border-[#38BDF8]/40 text-sky-700 dark:text-[#38BDF8] text-[11px] font-mono"
                            >
                              Approve as Friend
                            </button>
                            <button
                              onClick={() => onApproveRequest(req.id, 'COACH_EDIT')}
                              className="px-2.5 py-1.5 rounded bg-[#F97316]/15 hover:bg-[#F97316]/25 border border-[#F97316]/40 text-orange-700 dark:text-[#F97316] text-[11px] font-mono"
                            >
                              Approve as Coach
                            </button>
                            <button
                              onClick={() => onRemoveOrDeclineAthlete(req.id)}
                              className="p-1.5 rounded bg-stone-100 dark:bg-[#14181F] hover:bg-red-500/20 text-slate-500 dark:text-slate-400 hover:text-red-500"
                              title="Decline request"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Connected Athletes Role Manager */}
                <div className="rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10 p-5 space-y-3">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400">
                    CONNECTED ATHLETES ({connectedRoster.length})
                  </div>
                  <div className="space-y-2">
                    {connectedRoster.map((ath) => {
                      const latestCtlVal =
                        ath.wellnessDays[ath.wellnessDays.length - 1]?.ctl ?? 65;
                      return (
                        <div
                          key={ath.id}
                          className="bg-white/80 dark:bg-[#090B0E] border border-stone-200/90 dark:border-slate-800 rounded-lg px-3.5 py-2.5 flex items-center justify-between gap-2"
                        >
                          <div>
                            <div className="text-xs font-semibold text-slate-900 dark:text-white">{ath.name}</div>
                            <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                              {ath.inviteCode} • CTL {Math.round(latestCtlVal)}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {formatRoleBadge(ath.role, ath.status)}
                            <button
                              onClick={() => onRemoveOrDeclineAthlete(ath.id)}
                              className="p-1 rounded hover:bg-red-500/20 text-slate-500 dark:text-slate-400 hover:text-red-500"
                              title="Remove Connection"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: GRANULAR PRIVACY & STRAVA API SECURITY SHIELD */}
          {activeTab === 'PRIVACY_SHIELD' && (
            <div className="space-y-5">
              <div className="rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200/80 dark:border-slate-800 pb-4">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-600 dark:text-[#10B981]">
                      ZERO-TRUST BIOMETRIC &amp; STRAVA API DATA GOVERNANCE
                    </span>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                      Your Outbound Athlete Privacy &amp; Sharing Permissions
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      Control exactly which physiological streams and wellness markers your Friends (<code className="text-sky-600 dark:text-[#38BDF8]">FRIEND_VIEW</code>) and Coaches (<code className="text-[#F97316]">COACH_EDIT</code>) can inspect when they switch to your profile.
                    </p>
                  </div>
                  <div className="px-3 py-1.5 rounded bg-[#10B981]/10 border border-[#10B981]/30 text-xs font-mono text-emerald-700 dark:text-[#10B981]">
                    ● Shield Active
                  </div>
                </div>

                {/* 3 Granular Visibility Selectors */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* 1. Morning HRV & Wellness */}
                  <div className="bg-white/80 dark:bg-[#090B0E] border border-stone-200/90 dark:border-slate-800 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <HeartPulse className="w-4 h-4 text-[#10B981]" />
                        Morning HRV, RHR &amp; Sleep
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400">
                      Controls visibility of daily HRV (ms), resting heart rate, and sleep quality scores.
                    </p>
                    <select
                      value={selfPrivacySettings.shareWellnessAndHrv}
                      onChange={(e) =>
                        onUpdateSelfPrivacy({
                          ...selfPrivacySettings,
                          shareWellnessAndHrv: e.target.value as PrivacyVisibilityTier,
                        })
                      }
                      className="w-full bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 rounded px-2.5 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
                    >
                      <option value="ALL_CONNECTIONS">Friends &amp; Coaches (All Connections)</option>
                      <option value="COACHES_ONLY">Coaches Only (Hidden from Friends)</option>
                      <option value="PRIVATE">Strictly Private (Only Me)</option>
                    </select>
                  </div>

                  {/* 2. PMC Load & Power/Pace Zones */}
                  <div className="bg-white/80 dark:bg-[#090B0E] border border-stone-200/90 dark:border-slate-800 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <Activity className="w-4 h-4 text-[#38BDF8]" />
                        PMC Fitness (CTL/ATL) &amp; Zones
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400">
                      Controls visibility of your Chronic Training Load, Form (TSB), FTP, and Effort Stripes.
                    </p>
                    <select
                      value={selfPrivacySettings.sharePmcAndZones}
                      onChange={(e) =>
                        onUpdateSelfPrivacy({
                          ...selfPrivacySettings,
                          sharePmcAndZones: e.target.value as PrivacyVisibilityTier,
                        })
                      }
                      className="w-full bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 rounded px-2.5 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
                    >
                      <option value="ALL_CONNECTIONS">Friends &amp; Coaches (All Connections)</option>
                      <option value="COACHES_ONLY">Coaches Only (Hidden from Friends)</option>
                      <option value="PRIVATE">Strictly Private (Only Me)</option>
                    </select>
                  </div>

                  {/* 3. Outdoor GPS Route Polylines */}
                  <div className="bg-white/80 dark:bg-[#090B0E] border border-stone-200/90 dark:border-slate-800 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <MapPin className="w-4 h-4 text-[#F97316]" />
                        Outdoor GPS Maps &amp; Start Times
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400">
                      Masks exact GPS home/work start coordinates while preserving distance, pace, and lap splits.
                    </p>
                    <select
                      value={selfPrivacySettings.shareGpsRoutes}
                      onChange={(e) =>
                        onUpdateSelfPrivacy({
                          ...selfPrivacySettings,
                          shareGpsRoutes: e.target.value as PrivacyVisibilityTier,
                        })
                      }
                      className="w-full bg-white dark:bg-[#14161B] border border-stone-300 dark:border-slate-800 rounded px-2.5 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
                    >
                      <option value="ALL_CONNECTIONS">Friends &amp; Coaches (All Connections)</option>
                      <option value="COACHES_ONLY">Coaches Only (Hidden from Friends)</option>
                      <option value="PRIVATE">Strictly Private (Only Me)</option>
                    </select>
                  </div>
                </div>

                {/* Boolean Security Toggles */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <label className="bg-white/80 dark:bg-[#090B0E] border border-stone-200/90 dark:border-slate-800 rounded-lg p-4 flex items-start justify-between gap-4 cursor-pointer">
                    <div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-white">
                        Allow Assigned Coaches to Push Workouts to My Calendar
                      </div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                        When enabled, connections granted the <code className="text-[#F97316]">COACH_EDIT</code> role can schedule structured workouts onto your Training Calendar.
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={selfPrivacySettings.allowCoachCalendarEdits}
                      onChange={(e) =>
                        onUpdateSelfPrivacy({
                          ...selfPrivacySettings,
                          allowCoachCalendarEdits: e.target.checked,
                        })
                      }
                      className="mt-1 accent-[#F97316] w-4 h-4"
                    />
                  </label>

                  <label className="bg-white/80 dark:bg-[#090B0E] border border-stone-200/90 dark:border-slate-800 rounded-lg p-4 flex items-start justify-between gap-4 cursor-pointer">
                    <div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-white">
                        Strava API Compliance Shield (Explicit Opt-In Enforcement)
                      </div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                        Ensures your Strava-synced activity streams are never exposed to third parties without an approved Friend or Coach connection.
                      </div>
                    </div>
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
