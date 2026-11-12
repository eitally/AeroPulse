import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
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
import { useModalDialog } from '../hooks/useModalDialog';
import { useTracksideStopwatch } from '../hooks/useTracksideStopwatch';
import { AeroPulseLogo } from './AeroPulseLogo';
import { TeamManagementPanel } from './TeamManagementPanel';

export type RosterTab =
  | 'TEAMS_BRANDING'
  | 'LEADERBOARD'
  | 'SCHOLASTIC_COACH'
  | 'TRACKSIDE_PAD'
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

const AVATAR_PALETTE = ['#1C5436', '#0D9488', '#0284C7', '#D97706', '#E11D48'];

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
  const formIdPrefix = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [podIntensity, setPodIntensity] = useState<VdotPodIntensity>('THRESHOLD_CV');
  const [podRepCount, setPodRepCount] = useState<number>(6);
  const [podRepDistance, setPodRepDistance] = useState<200 | 400 | 800 | 1000 | 1600>(1000);
  const [podRecoveryLabel, setPodRecoveryLabel] = useState<string>('60s jog');
  const [guestPodName, setGuestPodName] = useState<string>('');
  const [guestPodVdot, setGuestPodVdot] = useState<string>('56.0');
  const [copiedSplitSheet, setCopiedSplitSheet] = useState<boolean>(false);

  // Persistent Trackside Watchless / Spikes-On Multi-Athlete Split Stopwatch (localStorage + epoch)
  const {
    stopwatchRunning,
    stopwatchElapsedMs,
    athleteLapTimestampsSecs,
    tapHistory,
    extraPodAthletes,
    totalSplitCount,
    hasActiveSession,
    toggleStartPause,
    resetStopwatch,
    tapRunnerSplit,
    undoLastSplit,
    setExtraPodAthletes,
  } = useTracksideStopwatch(50);
  const [copiedStopwatchCsv, setCopiedStopwatchCsv] = useState<boolean>(false);
  const [confirmResetStopwatch, setConfirmResetStopwatch] = useState<boolean>(false);
  const [lastSplitAnnouncement, setLastSplitAnnouncement] = useState<string>('');
  const [backdropRunningNotice, setBackdropRunningNotice] = useState<boolean>(false);
  const [confirmDeleteAthleteId, setConfirmDeleteAthleteId] = useState<string | null>(null);

  useModalDialog({
    isOpen,
    onClose,
    dialogRef,
  });

  useEffect(() => {
    if (!isOpen) {
      setConfirmResetStopwatch(false);
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

  // Keyboard Accelerators for Trackside Split Pad: Space toggles Gun, 1–9 records runner split
  useEffect(() => {
    if (!isOpen || activeTab !== 'TRACKSIDE_PAD') return;
    const onTracksideKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.code === 'Space' && target?.tagName !== 'BUTTON') {
        e.preventDefault();
        toggleStartPause();
        return;
      }
      if (/^[1-9]$/.test(e.key) && stopwatchRunning) {
        const idx = Number(e.key) - 1;
        const runner = combinedPodRoster[idx];
        if (runner) {
          e.preventDefault();
          const nextLapNum = (athleteLapTimestampsSecs[runner.id]?.length ?? 0) + 1;
          const elapsedSecs = tapRunnerSplit(runner.id, runner.name);
          setLastSplitAnnouncement(
            `${runner.name} split ${nextLapNum} recorded at ${elapsedSecs.toFixed(2)}s`
          );
        }
      }
    };
    window.addEventListener('keydown', onTracksideKeyDown);
    return () => window.removeEventListener('keydown', onTracksideKeyDown);
  }, [
    isOpen,
    activeTab,
    toggleStartPause,
    stopwatchRunning,
    combinedPodRoster,
    athleteLapTimestampsSecs,
    tapRunnerSplit,
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
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-2xs font-mono uppercase ap-status-caution">
          Pending Request
        </span>
      );
    }
    if (role === 'COACH_EDIT') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-2xs font-mono uppercase ap-status-caution">
          <CalendarPlus className="w-3 h-3" />
          Coach (Edit Calendar)
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-2xs font-mono uppercase ap-status-info">
        <Eye className="w-3 h-3" />
        Friend (View)
      </span>
    );
  };

  const handleRecordRunnerSplit = (runner: VdotPodRosterInput) => {
    const splitSecs = tapRunnerSplit(runner.id, runner.name);
    const prevMarks = athleteLapTimestampsSecs[runner.id] || [];
    const lapIndex = prevMarks.length + 1;
    const prevCum = prevMarks.length > 0 ? prevMarks[prevMarks.length - 1] : 0;
    const lapDelta = Number(Math.max(0.01, splitSecs - prevCum).toFixed(2));
    setConfirmResetStopwatch(false);
    setLastSplitAnnouncement(
      `${runner.name} — Lap ${lapIndex}: ${formatTrackMark(lapDelta, 2)} (Total ${formatTrackMark(
        splitSecs,
        2
      )})`
    );
  };

  const renderTracksideSplitPad = (isFocusedMode: boolean) => (
    <div
      className={`rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10 p-4 sm:p-5 space-y-4 ${
        isFocusedMode ? '' : 'lg:col-span-7'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Timer className="w-4 h-4 ap-text-brand" />
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
              Trackside &quot;Spikes-On / Watchless&quot; Multi-Athlete Split Pad
            </h3>
            {hasActiveSession && (
              <span className="px-2 py-0.5 rounded ap-status-prime font-mono text-2xs font-bold">
                Auto-Saved Locally
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Tap any runner&apos;s row as they cross the line to capture <span className="font-mono">0.01s</span> splits. Splits persist across modal closes and refreshes.
          </p>
        </div>

        {!isFocusedMode && (
          <button
            type="button"
            onClick={() => setActiveTab('TRACKSIDE_PAD')}
            className="min-h-[44px] px-3 py-2 rounded-xl liquid-capsule-track text-xs font-mono font-semibold text-slate-800 dark:text-slate-100 hover:border-[#28573B] dark:hover:border-[#C8FF00]/60 flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowUpRight className="w-3.5 h-3.5 ap-text-brand" />
            <span>Full-Screen Trackside Mode</span>
          </button>
        )}
      </div>

      {/* Primary Stopwatch Readout & >=48px Ergonomic Gun / Undo / Protected Reset Controls */}
      <div className="rounded-xl bg-stone-100/90 dark:bg-[#0D1511] border border-stone-200/90 dark:border-[#244331] p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 font-mono">
        <div className="flex items-baseline gap-3">
          <span className="text-2xl sm:text-3xl font-extrabold tabular-nums text-slate-900 dark:text-[#C8FF00]">
            {formatTrackMark(stopwatchElapsedMs / 1000, 2)}
          </span>
          <span className="text-xs text-slate-600 dark:text-slate-300 tabular-nums">
            {totalSplitCount} {totalSplitCount === 1 ? 'split' : 'splits'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setConfirmResetStopwatch(false);
              toggleStartPause();
            }}
            className={`min-h-[48px] px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
              stopwatchRunning
                ? 'bg-amber-500 hover:bg-amber-400 text-[#080A09]'
                : 'ap-btn-primary'
            }`}
          >
            {stopwatchRunning ? 'Pause Clock' : stopwatchElapsedMs > 0 ? 'Resume Clock' : 'Start Gun'}
          </button>

          {tapHistory.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const undone = undoLastSplit();
                if (undone) {
                  setLastSplitAnnouncement(
                    `Undid last split for ${undone.runnerName} (${formatTrackMark(
                      undone.timestampSecs,
                      2
                    )}).`
                  );
                }
              }}
              className="min-h-[48px] px-3.5 py-2 rounded-xl border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] text-xs font-semibold text-slate-800 dark:text-slate-100 hover:opacity-90 cursor-pointer"
            >
              Undo Last
            </button>
          )}

          {hasActiveSession &&
            (confirmResetStopwatch ? (
              <div className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    resetStopwatch();
                    setConfirmResetStopwatch(false);
                    setLastSplitAnnouncement('Stopwatch and splits cleared.');
                  }}
                  className="min-h-[48px] px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer"
                >
                  Confirm Reset
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmResetStopwatch(false)}
                  className="min-h-[48px] px-3 py-2 rounded-xl border border-stone-300 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmResetStopwatch(true)}
                className="min-h-[48px] px-3.5 py-2 rounded-xl border border-stone-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-stone-200/60 dark:hover:bg-slate-800 cursor-pointer"
              >
                Reset
              </button>
            ))}
        </div>
      </div>

      {/* Live Polite Status Region for Screen Readers & Trackside Confirmation */}
      <div
        role="status"
        aria-live="polite"
        className={
          lastSplitAnnouncement
            ? 'rounded-lg px-3 py-2 ap-status-prime font-mono text-xs tabular-nums flex items-center justify-between gap-2'
            : 'sr-only'
        }
      >
        {lastSplitAnnouncement ? `Last Split: ${lastSplitAnnouncement}` : 'Trackside stopwatch ready'}
      </div>

      {/* Quick Walk-On / Unconnected Runner Adder right inside Focused Trackside Mode */}
      {isFocusedMode && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            type="text"
            aria-label="Walk-on or lane runner name"
            placeholder="Add lane / walk-on runner (e.g. J. Ramirez)"
            value={guestPodName}
            onChange={(e) => setGuestPodName(e.target.value)}
            className="min-h-[44px] rounded-xl border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-3 py-2 font-mono text-xs flex-1 min-w-[180px]"
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
            className="min-h-[44px] px-4 py-2 rounded-xl ap-btn-secondary font-mono text-xs font-semibold cursor-pointer"
          >
            + Add Runner
          </button>
        </div>
      )}

      {/* >= 56px Full-Width One-Handed Tappable Runner Split Cards */}
      <div
        className={
          isFocusedMode
            ? 'grid grid-cols-1 md:grid-cols-2 gap-2.5'
            : 'space-y-2.5'
        }
      >
        {combinedPodRoster.map((runner) => {
          const marks = athleteLapTimestampsSecs[runner.id] || [];
          const lapDeltas = marks.map((cumSecs, i) =>
            Number((i === 0 ? cumSecs : cumSecs - marks[i - 1]).toFixed(2))
          );
          const lastLap = lapDeltas[lapDeltas.length - 1];
          const cumTotal = marks[marks.length - 1];

          return (
            <button
              key={runner.id}
              type="button"
              onClick={() => handleRecordRunnerSplit(runner)}
              className="w-full min-h-[56px] text-left rounded-xl border border-stone-200 dark:border-[#244331] bg-white/90 dark:bg-[#101B15] hover:border-[#28573B] dark:hover:border-[#C8FF00]/70 active:scale-[0.99] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#558B00] dark:focus-visible:ring-[#C8FF00]"
            >
              <div className="min-w-[140px] flex-1">
                <div className="font-bold text-sm text-slate-900 dark:text-white">
                  {runner.name}
                </div>
                <div className="font-mono text-xs text-slate-600 dark:text-slate-300 tabular-nums mt-0.5">
                  {lapDeltas.length === 0
                    ? 'Tap anywhere on row to record split'
                    : `Laps (${lapDeltas.length}): ${lapDeltas
                        .map((d) => formatTrackMark(d, 2))
                        .join(' · ')}`}
                </div>
              </div>

              <div className="flex items-center gap-2 font-mono tabular-nums shrink-0">
                {lastLap !== undefined && (
                  <span className="px-2.5 py-1 rounded-lg ap-status-prime font-bold text-xs">
                    #{lapDeltas.length} {formatTrackMark(lastLap, 2)} ({formatTrackMark(cumTotal, 2)})
                  </span>
                )}
                <span className="min-h-[44px] inline-flex items-center px-3.5 py-2 rounded-xl ap-btn-primary font-bold text-xs">
                  + Tap Split
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {totalSplitCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="text-xs font-mono text-slate-600 dark:text-slate-300">
            Closing this window keeps your live clock and splits pinned in the top header.
          </span>
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
            className="min-h-[44px] px-4 py-2 rounded-xl ap-btn-secondary font-mono text-xs font-semibold cursor-pointer"
          >
            {copiedStopwatchCsv ? '✓ Copied Split CSV' : 'Copy All Splits (CSV)'}
          </button>
        </div>
      )}
    </div>
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
        className="rounded-2xl liquid-glass shadow-2xl border border-stone-200/90 dark:border-white/10 text-slate-900 dark:text-slate-100 max-w-6xl w-full max-h-[92dvh] sm:max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Modal Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-stone-200/80 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3 liquid-glass-subtle">
          <div className="flex items-center gap-3 min-w-0">
            <AeroPulseLogo size="sm" teamBrand={activeTeamObj?.brand || null} />
            <div className="h-6 w-px bg-stone-300 dark:bg-slate-800 hidden sm:block" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="thresh-roster-modal-title"
                  className="text-sm sm:text-base font-bold text-slate-900 dark:text-white"
                >
                  Teams, Bulk Invites &amp; Coaching Hub
                </h2>
                <span className="text-2xs font-mono uppercase px-2 py-0.5 rounded ap-status-info">
                  MULTI-TEAM &amp; SAFE-SPORT
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 hidden sm:block">
                Create school/club branding, send bulk Resend email invites, switch multi-team rosters, or run trackside timing.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Personal Invite Code Pill */}
            <div className="hidden md:flex items-center gap-2 liquid-glass-subtle border border-[#C5D4C9] dark:border-[#244230] rounded-lg px-3 py-1.5">
              <span className="text-2xs font-mono uppercase text-[#43584B] dark:text-[#93A39A]">Invite Code:</span>
              <span className="text-xs font-mono font-bold ap-text-brand">{selfInviteCode}</span>
              <button
                type="button"
                onClick={handleCopyInvite}
                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center text-[#43584B] dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                title="Copy your THRESH Invite Code"
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
              aria-label="Close Teams & Coaching Hub"
              className="min-h-[44px] px-3 py-2 rounded-xl liquid-glass-subtle hover:bg-[#DDE7DF] dark:hover:bg-[#1B2E23] border border-[#C5D4C9] dark:border-[#244230] text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white transition-colors flex items-center gap-1.5 text-xs font-mono cursor-pointer"
              title="Close Roster Hub (Esc — active splits stay saved)"
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
              Backdrop tap ignored while Trackside Stopwatch is running so you never lose a finish. Use &quot;Close&quot; or Esc to minimize to the top bar.
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

        {/* Navigation Tabs — Stadium Chalk / Carbon-Pine with Full 6-Tab Desktop Fit & Arrow-Key Roving */}
        <div className="px-4 sm:px-6 border-b border-[#C5D4C9] dark:border-[#244230] bg-[#E9EFE9] dark:bg-[#101B15] flex items-center justify-between flex-wrap gap-2">
          <div
            role="tablist"
            aria-label="Teams and Coaching Hub sections"
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const order = [
                'TEAMS_BRANDING',
                'TRACKSIDE_PAD',
                'SCHOLASTIC_COACH',
                'LEADERBOARD',
                'CONNECT_INVITE',
                'PRIVACY_SHIELD',
              ] as const;
              const idx = order.indexOf(activeTab);
              const nextIdx =
                e.key === 'ArrowRight'
                  ? (idx + 1) % order.length
                  : (idx - 1 + order.length) % order.length;
              setActiveTab(order[nextIdx]);
              const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
              buttons[nextIdx]?.focus();
            }}
            className="flex items-center flex-wrap gap-0.5 sm:gap-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'TEAMS_BRANDING'}
              onClick={() => setActiveTab('TEAMS_BRANDING')}
              className={`min-h-[44px] px-2.5 py-2 text-xs font-mono uppercase tracking-wide border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'TEAMS_BRANDING'
                  ? 'border-[#1C5436] dark:border-[#C8FF00] text-[#101411] dark:text-white font-bold'
                  : 'border-transparent text-[#43584B] dark:text-[#93A39A] hover:text-[#101411] dark:hover:text-white'
              }`}
            >
              <Users className="w-3.5 h-3.5 ap-text-brand shrink-0" />
              <span>Teams ({myTeams.length})</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'TRACKSIDE_PAD'}
              onClick={() => setActiveTab('TRACKSIDE_PAD')}
              className={`min-h-[44px] px-2.5 py-2 text-xs font-mono uppercase tracking-wide border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'TRACKSIDE_PAD'
                  ? 'border-[#1C5436] dark:border-[#C8FF00] text-[#101411] dark:text-white font-bold'
                  : 'border-transparent text-[#43584B] dark:text-[#93A39A] hover:text-[#101411] dark:hover:text-white'
              }`}
            >
              <Timer className="w-3.5 h-3.5 ap-text-brand shrink-0" />
              <span>Split Pad</span>
              {hasActiveSession && (
                <span className="px-1.5 py-0.5 rounded-full ap-status-prime font-bold text-2xs tabular-nums">
                  {stopwatchRunning ? 'LIVE' : totalSplitCount}
                </span>
              )}
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'SCHOLASTIC_COACH'}
              onClick={() => setActiveTab('SCHOLASTIC_COACH')}
              className={`min-h-[44px] px-2.5 py-2 text-xs font-mono uppercase tracking-wide border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'SCHOLASTIC_COACH'
                  ? 'border-[#1C5436] dark:border-[#C8FF00] text-[#101411] dark:text-white font-bold'
                  : 'border-transparent text-[#43584B] dark:text-[#93A39A] hover:text-[#101411] dark:hover:text-white'
              }`}
            >
              <Trophy className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>Pods &amp; CARA</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'LEADERBOARD'}
              onClick={() => setActiveTab('LEADERBOARD')}
              className={`min-h-[44px] px-2.5 py-2 text-xs font-mono uppercase tracking-wide border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'LEADERBOARD'
                  ? 'border-[#1C5436] dark:border-[#C8FF00] text-[#101411] dark:text-white font-bold'
                  : 'border-transparent text-[#43584B] dark:text-[#93A39A] hover:text-[#101411] dark:hover:text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5 ap-text-brand shrink-0" />
              <span>Triage ({connectedRoster.length + 1})</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'CONNECT_INVITE'}
              onClick={() => setActiveTab('CONNECT_INVITE')}
              className={`min-h-[44px] px-2.5 py-2 text-xs font-mono uppercase tracking-wide border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'CONNECT_INVITE'
                  ? 'border-[#1C5436] dark:border-[#C8FF00] text-[#101411] dark:text-white font-bold'
                  : 'border-transparent text-[#43584B] dark:text-[#93A39A] hover:text-[#101411] dark:hover:text-white'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5 ap-text-brand shrink-0" />
              <span>Connections</span>
              {pendingRequests.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-[#F59E0B] text-[#080A09] font-bold text-2xs">
                  {pendingRequests.length}
                </span>
              )}
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'PRIVACY_SHIELD'}
              onClick={() => setActiveTab('PRIVACY_SHIELD')}
              className={`min-h-[44px] px-2.5 py-2 text-xs font-mono uppercase tracking-wide border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'PRIVACY_SHIELD'
                  ? 'border-[#1C5436] dark:border-[#C8FF00] text-[#101411] dark:text-white font-bold'
                  : 'border-transparent text-[#43584B] dark:text-[#93A39A] hover:text-[#101411] dark:hover:text-white'
              }`}
            >
              <Shield className="w-3.5 h-3.5 text-emerald-700 dark:text-[#10B981] shrink-0" />
              <span>Privacy</span>
            </button>
          </div>

          <div className="hidden xl:block text-2xs font-mono text-[#43584B] dark:text-[#93A39A] py-2 shrink-0">
            Active:{' '}
            <span className="text-[#101411] dark:text-white font-semibold">
              {activeAthleteId === 'SELF'
                ? `${selfName} (You)`
                : roster.find((r) => r.id === activeAthleteId)?.name || 'Athlete'}
            </span>
          </div>
        </div>

        {/* Body Content */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-6">
          {pushSuccessBanner && (
            <div
              role="status"
              aria-live="polite"
              className="bg-[#10B981]/15 border border-[#10B981]/40 rounded-lg px-4 py-3 flex items-center justify-between text-xs text-emerald-700 dark:text-[#10B981] font-mono"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{pushSuccessBanner}</span>
              </div>
              <button
                type="button"
                onClick={() => setPushSuccessBanner(null)}
                className="min-h-[36px] px-2 text-xs underline cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* DEDICATED FULL-FOCUS TRACKSIDE WATCHLESS SPLIT PAD */}
          {activeTab === 'TRACKSIDE_PAD' && renderTracksideSplitPad(true)}

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
                      <span className="ap-status-caution px-2 py-0.5 rounded-md font-mono text-2xs font-bold uppercase">
                        Coach Triage Inbox · 6:00 AM Exception Scan
                      </span>
                      <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                        Autonomic HRV &amp; Orthopedic Guardrail Exceptions
                      </h3>
                    </div>
                    <p className="text-2xs text-slate-500 dark:text-slate-400 mt-0.5">
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
                      className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-lg bg-[#1C5436] hover:bg-[#16422A] dark:bg-[#C8FF00] dark:hover:bg-[#B5EB00] text-white dark:text-[#080A09] font-semibold text-xs whitespace-nowrap"
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
                                className={`px-2 py-0.5 rounded text-2xs font-mono font-bold uppercase ${
                                  isStrained ? 'ap-status-strained' : 'ap-status-prime'
                                }`}
                              >
                                {isStrained ? 'Action Needed' : 'Green Readiness'}
                              </span>
                              <span className="font-bold text-slate-900 dark:text-white">
                                {ath.name}
                              </span>
                            </div>
                            <div className="text-2xs font-mono text-slate-500 mt-0.5">
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
                            className="min-h-[44px] sm:min-h-[34px] px-2.5 py-1.5 rounded-lg bg-[#1C5436] hover:bg-[#16422A] dark:bg-[#C8FF00] dark:hover:bg-[#B5EB00] text-white dark:text-[#080A09] font-semibold text-2xs whitespace-nowrap"
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
                    <tr className="border-b border-stone-200/80 dark:border-slate-800/80 text-2xs font-mono uppercase text-slate-500 dark:text-slate-400 bg-stone-200/40 dark:bg-[#101B15]">
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
                          ? 'bg-emerald-950/6 dark:bg-[#C8FF00]/10'
                          : 'hover:bg-stone-200/40 dark:hover:bg-[#15231B]'
                      }`}
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[#1C5436] dark:bg-[#C8FF00] text-white dark:text-[#080A09] flex items-center justify-center font-mono font-bold text-xs">
                            YOU
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                              <span>{selfName}</span>
                              <span className="text-2xs font-mono px-1.5 py-0.5 rounded ap-status-info">
                                Primary Account
                              </span>
                            </div>
                            <div className="text-2xs font-mono text-slate-500 dark:text-slate-400">
                              Invite: {selfInviteCode}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-2xs font-mono uppercase bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                          Owner (Full Control)
                        </span>
                      </td>
                      <td className="py-3.5 px-3 font-mono font-semibold text-[#0F766E] dark:text-[#2DD4BF]">
                        {Math.round(selfCtl)}
                      </td>
                      <td className="py-3.5 px-3 font-mono text-[#BE123C] dark:text-[#FB7185]">
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
                        <div className="text-2xs font-mono text-slate-500 dark:text-slate-400">
                          Active Plan Architect
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            onSelectAthleteViewport('SELF');
                            onClose();
                          }}
                          className={`min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded text-xs font-mono transition-colors ${
                            activeAthleteId === 'SELF'
                              ? 'bg-[#1C5436] text-white dark:bg-[#C8FF00] dark:text-[#080A09] font-semibold'
                              : 'bg-white dark:bg-[#101B15] hover:bg-stone-100 dark:hover:bg-[#1C3125] text-slate-800 dark:text-slate-200 border border-stone-300 dark:border-emerald-400/25'
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
                            isSelected ? 'bg-[#38BDF8]/10' : 'hover:bg-stone-200/40 dark:hover:bg-[#15231B]'
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
                                  <span className="text-2xs font-mono text-slate-500 dark:text-slate-400">
                                    #{rawAthlete.stravaAthleteId}
                                  </span>
                                </div>
                                <div className="text-2xs text-slate-600 dark:text-slate-400">
                                  {rawAthlete.location} • {rawAthlete.primarySport}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="py-3.5 px-3">
                            <div className="flex flex-col items-start gap-1">
                              {formatRoleBadge(rawAthlete.role, rawAthlete.status)}
                              <button
                                type="button"
                                onClick={() => onToggleAthleteRole(rawAthlete.id)}
                                className="min-h-[44px] sm:min-h-[28px] inline-flex items-center text-2xs font-mono text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white underline"
                              >
                                Switch to {rawAthlete.role === 'COACH_EDIT' ? 'Friend View' : 'Coach Edit'}
                              </button>
                            </div>
                          </td>

                          <td className="py-3.5 px-3 font-mono font-semibold text-[#0F766E] dark:text-[#2DD4BF]">
                            {pmcMasked ? (
                              <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                <Lock className="w-3 h-3" /> Private
                              </span>
                            ) : (
                              Math.round(ctlVal)
                            )}
                          </td>

                          <td className="py-3.5 px-3 font-mono text-[#BE123C] dark:text-[#FB7185]">
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
                                className="inline-flex items-center gap-1 text-2xs text-amber-700 dark:text-[#F59E0B] bg-[#F59E0B]/10 border border-[#F59E0B]/30 px-1.5 py-0.5 rounded"
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
                            <div className="text-2xs font-mono text-slate-500 dark:text-slate-400">
                              7d Load: {weeklyTss} TSS
                            </div>
                          </td>

                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {rawAthlete.role === 'COACH_EDIT' &&
                                rawAthlete.privacySettings.allowCoachCalendarEdits && (
                                  <button
                                    onClick={() => handleOpenCoachPush(rawAthlete)}
                                    className="px-2.5 py-1.5 rounded text-xs font-mono bg-emerald-950/8 dark:bg-[#C8FF00]/15 hover:bg-emerald-950/15 dark:hover:bg-[#C8FF00]/25 ap-text-brand border border-emerald-800/30 dark:border-[#C8FF00]/40 flex items-center gap-1 transition-colors"
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
                                    ? 'bg-[#38BDF8] text-[#080A09] font-semibold'
                                    : 'bg-white dark:bg-[#101B15] hover:bg-stone-100 dark:hover:bg-[#1C3125] text-slate-900 dark:text-white border border-stone-300 dark:border-emerald-400/25'
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
                  className="rounded-xl liquid-glass-subtle border border-emerald-800/35 dark:border-[#C8FF00]/45 p-5 space-y-4 shadow-xl"
                >
                  <div className="flex items-center justify-between border-b border-stone-200/80 dark:border-emerald-400/15 pb-3">
                    <div className="flex items-center gap-2">
                      <CalendarPlus className="w-4 h-4 ap-text-brand" />
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        Coach Workout Prescription Desk — Target:{' '}
                        <span className="ap-text-brand">
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
                      <label
                        htmlFor={`${formIdPrefix}-workout-title`}
                        className="block text-2xs font-mono uppercase text-slate-600 dark:text-slate-300 mb-1"
                      >
                        Workout Title
                      </label>
                      <input
                        id={`${formIdPrefix}-workout-title`}
                        type="text"
                        value={workoutName}
                        onChange={(e) => setWorkoutName(e.target.value)}
                        className="w-full min-h-[40px] bg-white dark:bg-[#101B15] border border-stone-300 dark:border-[#2B543B] rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 font-mono"
                        required
                      />
                    </div>

                    <div>
                      <label
                        htmlFor={`${formIdPrefix}-workout-date`}
                        className="block text-2xs font-mono uppercase text-slate-600 dark:text-slate-300 mb-1"
                      >
                        Scheduled Date
                      </label>
                      <input
                        id={`${formIdPrefix}-workout-date`}
                        type="date"
                        value={workoutDate}
                        onChange={(e) => setWorkoutDate(e.target.value)}
                        className="w-full min-h-[40px] bg-white dark:bg-[#101B15] border border-stone-300 dark:border-[#2B543B] rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 font-mono"
                        required
                      />
                    </div>

                    <div>
                      <label
                        htmlFor={`${formIdPrefix}-workout-sport`}
                        className="block text-2xs font-mono uppercase text-slate-600 dark:text-slate-300 mb-1"
                      >
                        Sport &amp; Target Load
                      </label>
                      <div className="flex gap-2">
                        <select
                          id={`${formIdPrefix}-workout-sport`}
                          value={workoutSport}
                          onChange={(e) => setWorkoutSport(e.target.value as 'Running' | 'Cycling')}
                          className="min-h-[40px] bg-white dark:bg-[#101B15] border border-stone-300 dark:border-[#2B543B] rounded-lg px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100 font-mono"
                        >
                          <option value="Running">Running</option>
                          <option value="Cycling">Cycling</option>
                        </select>
                        <input
                          type="number"
                          aria-label="Target training load TSS"
                          value={workoutLoad}
                          onChange={(e) => setWorkoutLoad(Number(e.target.value))}
                          className="w-20 min-h-[40px] bg-white dark:bg-[#101B15] border border-stone-300 dark:border-[#2B543B] rounded-lg px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100 font-mono"
                          placeholder="TSS"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor={`${formIdPrefix}-workout-syntax`}
                        className="block text-2xs font-mono uppercase text-slate-600 dark:text-slate-300 mb-1"
                      >
                        Structured Workout Syntax
                      </label>
                      <textarea
                        id={`${formIdPrefix}-workout-syntax`}
                        rows={3}
                        value={workoutSyntax}
                        onChange={(e) => setWorkoutSyntax(e.target.value)}
                        className="w-full bg-white dark:bg-[#101B15] border border-stone-300 dark:border-[#2B543B] rounded-lg p-2.5 text-xs font-mono text-emerald-800 dark:text-[#C8FF00]"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`${formIdPrefix}-workout-notes`}
                        className="block text-2xs font-mono uppercase text-slate-600 dark:text-slate-300 mb-1"
                      >
                        Coach Execution Notes &amp; Duration (Mins)
                      </label>
                      <textarea
                        id={`${formIdPrefix}-workout-notes`}
                        rows={2}
                        value={workoutNotes}
                        onChange={(e) => setWorkoutNotes(e.target.value)}
                        className="w-full bg-white dark:bg-[#101B15] border border-stone-300 dark:border-[#2B543B] rounded-lg p-2.5 text-xs text-slate-900 dark:text-slate-100 mb-2"
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="flex items-center gap-2 text-xs font-mono text-slate-600 dark:text-slate-300">
                          <span>Duration (min):</span>
                          <input
                            type="number"
                            value={workoutDurationMins}
                            onChange={(e) => setWorkoutDurationMins(Number(e.target.value))}
                            className="w-16 min-h-[38px] bg-white dark:bg-[#101B15] border border-stone-300 dark:border-[#2B543B] rounded-lg px-2 py-1 text-xs text-slate-900 dark:text-slate-100"
                          />
                        </label>
                        <button
                          type="submit"
                          className="min-h-[44px] px-4 py-2 rounded-xl ap-btn-primary text-xs font-mono font-semibold cursor-pointer"
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
              {/* Section 1: Auto-Clustered VDOT Pacing Pods & Trackside Split Sheet */}
              <div className="rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10 p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="ap-status-caution px-2 py-0.5 rounded font-mono text-2xs font-bold uppercase">
                        Auto-Scaled Squad Pacing
                      </span>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        VDOT Pacing Pod Generator &amp; Printable Trackside Sheet
                      </h3>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                      Write 1 workout once: THRESH clusters your varsity &amp; developmental squad into cohesive VDOT pods (±2s/400m) with exact 200m–1600m splits.
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
                    className="min-h-[44px] px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#080A09] text-xs font-bold font-mono transition-colors flex items-center gap-1.5 cursor-pointer"
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
                    <label
                      htmlFor={`${formIdPrefix}-pod-intensity`}
                      className="block text-2xs font-mono uppercase text-slate-600 dark:text-slate-300 mb-1"
                    >
                      Physiological Intensity
                    </label>
                    <select
                      id={`${formIdPrefix}-pod-intensity`}
                      value={podIntensity}
                      onChange={(e) => setPodIntensity(e.target.value as VdotPodIntensity)}
                      className="w-full min-h-[42px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 py-1.5 font-mono text-xs"
                    >
                      <option value="THRESHOLD_CV">Threshold / Tinman CV (~99% LT)</option>
                      <option value="INTERVAL_VO2">VO2max Interval (3K–5K Pace)</option>
                      <option value="REPETITION">Mile / Speed Repetition</option>
                      <option value="MARATHON">Steady State / Aerobic Tempo</option>
                      <option value="EASY">Easy / Recovery Run</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor={`${formIdPrefix}-pod-reps`}
                      className="block text-2xs font-mono uppercase text-slate-600 dark:text-slate-300 mb-1"
                    >
                      Rep Count
                    </label>
                    <input
                      id={`${formIdPrefix}-pod-reps`}
                      type="number"
                      min={1}
                      max={30}
                      value={podRepCount}
                      onChange={(e) => setPodRepCount(Math.max(1, Number(e.target.value) || 1))}
                      className="w-full min-h-[42px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 py-1.5 font-mono text-xs"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`${formIdPrefix}-pod-dist`}
                      className="block text-2xs font-mono uppercase text-slate-600 dark:text-slate-300 mb-1"
                    >
                      Rep Distance
                    </label>
                    <select
                      id={`${formIdPrefix}-pod-dist`}
                      value={podRepDistance}
                      onChange={(e) =>
                        setPodRepDistance(Number(e.target.value) as 200 | 400 | 800 | 1000 | 1600)
                      }
                      className="w-full min-h-[42px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 py-1.5 font-mono text-xs"
                    >
                      <option value={200}>200m</option>
                      <option value={400}>400m</option>
                      <option value={800}>800m</option>
                      <option value={1000}>1000m</option>
                      <option value={1600}>1600m</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor={`${formIdPrefix}-pod-rec`}
                      className="block text-2xs font-mono uppercase text-slate-600 dark:text-slate-300 mb-1"
                    >
                      Recovery Cue
                    </label>
                    <input
                      id={`${formIdPrefix}-pod-rec`}
                      type="text"
                      value={podRecoveryLabel}
                      onChange={(e) => setPodRecoveryLabel(e.target.value)}
                      className="w-full min-h-[42px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 py-1.5 font-mono text-xs"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`${formIdPrefix}-pod-date`}
                      className="block text-2xs font-mono uppercase text-slate-600 dark:text-slate-300 mb-1"
                    >
                      Scheduled Date
                    </label>
                    <input
                      id={`${formIdPrefix}-pod-date`}
                      type="date"
                      value={workoutDate}
                      onChange={(e) => setWorkoutDate(e.target.value)}
                      className="w-full min-h-[42px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 py-1.5 font-mono text-xs"
                    />
                  </div>
                </div>

                {/* Optional Quick Add Walk-On / Tryout Runner to Pod Sheet */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                    <span className="text-2xs font-mono text-slate-600 dark:text-slate-300">
                      + Add Walk-On / Unconnected Teammate:
                    </span>
                    <input
                      type="text"
                      aria-label="Walk-on runner name"
                      placeholder="Runner Name (e.g. J. Ramirez)"
                      value={guestPodName}
                      onChange={(e) => setGuestPodName(e.target.value)}
                      className="min-h-[40px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 py-1.5 font-mono text-xs w-full sm:w-48"
                    />
                    <input
                      type="number"
                      aria-label="Walk-on VDOT estimate"
                      step="0.5"
                      min={30}
                      max={85}
                      placeholder="VDOT"
                      value={guestPodVdot}
                      onChange={(e) => setGuestPodVdot(e.target.value)}
                      className="min-h-[40px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 py-1.5 font-mono text-xs w-24"
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
                      className="min-h-[40px] px-3 py-1.5 rounded-lg ap-btn-secondary font-mono text-xs font-semibold cursor-pointer"
                    >
                      + Add to Pod
                    </button>
                    {extraPodAthletes.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setExtraPodAthletes([])}
                        className="min-h-[40px] px-2 text-xs font-mono text-slate-600 dark:text-slate-300 hover:text-rose-500 cursor-pointer"
                      >
                        Clear {extraPodAthletes.length} guest{extraPodAthletes.length === 1 ? '' : 's'}
                      </button>
                    )}
                  </div>

                  {connectedRoster.length > 0 && (
                    <label className="min-h-[40px] inline-flex items-center gap-1.5 text-xs font-mono text-slate-600 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeSelfInPods}
                        onChange={(e) => setIncludeSelfInPods(e.target.checked)}
                        className="rounded w-4 h-4"
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
                        className="rounded-xl border border-stone-200 dark:border-[#244331] bg-white/85 dark:bg-[#101B15] p-4 space-y-2.5 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                              <Zap className="w-3.5 h-3.5 text-amber-500" />
                              <span>{pod.podName}</span>
                              <span className="px-1.5 py-0.5 rounded ap-status-info font-mono text-2xs">
                                VDOT{' '}
                                {pod.minVdot === pod.maxVdot
                                  ? pod.centerVdot
                                  : `${pod.minVdot}–${pod.maxVdot}`}
                              </span>
                            </div>
                            <div className="text-xs font-mono text-emerald-700 dark:text-emerald-400 font-semibold mt-0.5">
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
                              className="min-h-[40px] px-3 py-1.5 rounded-xl ap-btn-primary font-semibold text-xs whitespace-nowrap cursor-pointer"
                            >
                              Push to Pod ({coachedMemberIds.length})
                            </button>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          {pod.athletes.map((a) => (
                            <span
                              key={a.id}
                              className="px-2 py-0.5 rounded-md bg-stone-200/70 dark:bg-[#15231B] font-mono text-2xs text-slate-800 dark:text-slate-200"
                            >
                              {a.name} ({a.vdot})
                            </span>
                          ))}
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 pt-1 font-mono tabular-nums text-center">
                          {[
                            { lbl: '200m', val: pod.splitsSecs.split200m },
                            { lbl: '400m', val: pod.splitsSecs.split400m },
                            { lbl: '800m', val: pod.splitsSecs.split800m },
                            { lbl: '1000m', val: pod.splitsSecs.split1000m },
                            { lbl: '1600m', val: pod.splitsSecs.split1600m },
                          ].map((sp) => (
                            <div
                              key={sp.lbl}
                              className="rounded-lg bg-stone-100 dark:bg-[#15231B] border border-stone-200/80 dark:border-[#244331] py-1.5 px-1"
                            >
                              <div className="text-2xs text-slate-600 dark:text-slate-300">{sp.lbl}</div>
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
                {renderTracksideSplitPad(false)}

                {/* Right 5 Cols: NCAA Bylaw 17.1 (20-Hour Weekly CARA Cap) Compliance Monitor */}
                <div className="lg:col-span-5 rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10 p-5 space-y-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        20-Hour Weekly / 4-Hour Daily CARA Audit
                      </h3>
                      <span className="ap-status-info px-2 py-0.5 rounded font-mono text-2xs font-bold uppercase">
                        NCAA Bylaw 17.1
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                      Rolling 7-day Countable Athletically Related Activities (CARA) across connected roster athletes.
                    </p>
                  </div>

                  {connectedRoster.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-stone-300 dark:border-[#2B543B] p-3.5 text-xs text-slate-600 dark:text-slate-300">
                      Connect squad athletes via Invite Code in the &quot;Connections&quot; tab to audit live rolling 7-day NCAA CARA hours automatically.
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
                            className="rounded-lg border border-stone-200 dark:border-[#244331] bg-white/80 dark:bg-[#101B15] p-3 space-y-1.5 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-slate-900 dark:text-white">
                                {ath.name}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded font-mono text-2xs font-bold ${
                                  compliant ? 'ap-status-prime' : 'ap-status-strained'
                                }`}
                              >
                                {statusLabel}
                              </span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-stone-200 dark:bg-[#15231B] overflow-hidden">
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
                            <div className="flex justify-between font-mono text-2xs text-slate-600 dark:text-slate-300 tabular-nums">
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
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        Follow Athlete by Invite Code or Strava Handle
                      </h3>
                      <span className="px-2 py-0.5 rounded-md ap-status-info text-2xs font-mono uppercase font-bold">
                        Invite Connect
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                      Enter a friend&apos;s THRESH Invite Code (e.g. <code className="ap-text-brand font-semibold">TH-4401-TRACK</code>) or name to add them to your athlete switcher.
                    </p>
                  </div>

                  {followFeedback && (
                    <div
                      role="status"
                      aria-live="polite"
                      className="p-3 rounded-lg ap-status-prime text-xs font-mono"
                    >
                      {followFeedback}
                    </div>
                  )}

                  <form onSubmit={handleFollowSubmit} className="space-y-3">
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
                        className="w-full min-h-[44px] bg-white dark:bg-[#101B15] border border-stone-300 dark:border-[#2B543B] rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#558B00] dark:focus:border-[#C8FF00]"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor={`${formIdPrefix}-invite-role`}
                          className="block text-2xs font-mono uppercase text-slate-600 dark:text-slate-300 mb-1"
                        >
                          Connection Permission Tier
                        </label>
                        <select
                          id={`${formIdPrefix}-invite-role`}
                          value={inviteRole}
                          onChange={(e) =>
                            setInviteRole(e.target.value as 'COACH_EDIT' | 'FRIEND_VIEW')
                          }
                          className="w-full min-h-[44px] bg-white dark:bg-[#101B15] border border-stone-300 dark:border-[#2B543B] rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-slate-100 font-mono"
                        >
                          <option value="FRIEND_VIEW">Friend (View Telemetry)</option>
                          <option value="COACH_EDIT">Coached Athlete (Edit Calendar)</option>
                        </select>
                      </div>

                      <div>
                        <label
                          htmlFor={`${formIdPrefix}-invite-sport`}
                          className="block text-2xs font-mono uppercase text-slate-600 dark:text-slate-300 mb-1"
                        >
                          Primary Discipline
                        </label>
                        <select
                          id={`${formIdPrefix}-invite-sport`}
                          value={inviteSpecialty}
                          onChange={(e) =>
                            setInviteSpecialty(e.target.value as 'Running' | 'Cycling')
                          }
                          className="w-full min-h-[44px] bg-white dark:bg-[#101B15] border border-stone-300 dark:border-[#2B543B] rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-slate-100 font-mono"
                        >
                          <option value="Running">Running / Track</option>
                          <option value="Cycling">Cycling / Power</option>
                        </select>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full min-h-[44px] py-2.5 rounded-xl ap-btn-primary font-mono font-semibold text-xs cursor-pointer"
                    >
                      + Connect Athlete to Roster
                    </button>
                  </form>
                </div>

                {/* Share Your Invite Code Card */}
                <div className="rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10 p-5 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-2xs font-mono uppercase ap-text-brand font-bold">
                      SHARE YOUR INVITE CODE WITH COACHES OR TEAMMATES
                    </div>
                    <div className="text-lg font-mono font-bold text-slate-900 dark:text-white mt-0.5">
                      {selfInviteCode}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">
                      Anyone with this code can request Friend View or Coach access to your telemetry.
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
                    <span className="text-2xs font-mono uppercase tracking-wider text-amber-700 dark:text-[#F59E0B] font-semibold">
                      INCOMING FOLLOW &amp; COACHING REQUESTS ({pendingRequests.length})
                    </span>
                  </div>

                  {pendingRequests.length === 0 ? (
                    <div className="text-xs text-slate-600 dark:text-slate-300 font-mono py-4 text-center">
                      No pending follow requests.
                    </div>
                  ) : (
                    pendingRequests.map((req, idx) => {
                      const avatarColor = AVATAR_PALETTE[(idx + 2) % AVATAR_PALETTE.length];
                      const isConfirmingDecline = confirmDeleteAthleteId === req.id;
                      return (
                        <div
                          key={req.id}
                          className="bg-white/80 dark:bg-[#101B15] border border-stone-200/90 dark:border-[#244331] rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3"
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
                                <span className="font-mono text-2xs text-slate-600 dark:text-slate-300">
                                  ({req.inviteCode})
                                </span>
                              </div>
                              <div className="text-2xs text-slate-600 dark:text-slate-300">
                                {req.location} • Goal: {req.primaryGoalSummary}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onApproveRequest(req.id, 'FRIEND_VIEW')}
                              className="min-h-[44px] sm:min-h-[38px] px-2.5 py-1.5 rounded-lg ap-status-info text-xs font-mono cursor-pointer"
                            >
                              Approve Friend
                            </button>
                            <button
                              type="button"
                              onClick={() => onApproveRequest(req.id, 'COACH_EDIT')}
                              className="min-h-[44px] sm:min-h-[38px] px-2.5 py-1.5 rounded-lg ap-status-caution text-xs font-mono cursor-pointer"
                            >
                              Approve Coach
                            </button>
                            {isConfirmingDecline ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    onRemoveOrDeclineAthlete(req.id);
                                    setConfirmDeleteAthleteId(null);
                                  }}
                                  className="min-h-[44px] sm:min-h-[38px] px-2.5 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-mono font-bold cursor-pointer"
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteAthleteId(null)}
                                  className="min-h-[44px] sm:min-h-[38px] px-2.5 py-1.5 rounded-lg border border-stone-300 dark:border-slate-700 text-xs font-mono cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteAthleteId(req.id)}
                                className="min-h-[44px] min-w-[44px] sm:min-h-[38px] sm:min-w-[38px] inline-flex items-center justify-center rounded-lg bg-stone-100 dark:bg-[#15231B] hover:bg-rose-500/15 text-rose-700/80 dark:text-rose-300/80 hover:text-rose-600 dark:hover:text-rose-300 cursor-pointer"
                                title="Decline request"
                                aria-label={`Decline request from ${req.name}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Connected Athletes Role Manager */}
                <div className="rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10 p-5 space-y-3">
                  <div className="text-2xs font-mono uppercase tracking-wider text-slate-600 dark:text-slate-300 font-semibold">
                    CONNECTED ATHLETES ({connectedRoster.length})
                  </div>
                  <div className="space-y-2">
                    {connectedRoster.map((ath) => {
                      const latestCtlVal =
                        ath.wellnessDays[ath.wellnessDays.length - 1]?.ctl ?? 65;
                      const isConfirmingRemove = confirmDeleteAthleteId === ath.id;
                      return (
                        <div
                          key={ath.id}
                          className="bg-white/80 dark:bg-[#101B15] border border-stone-200/90 dark:border-[#244331] rounded-lg px-3.5 py-2.5 flex items-center justify-between gap-2"
                        >
                          <div>
                            <div className="text-xs font-semibold text-slate-900 dark:text-white">{ath.name}</div>
                            <div className="text-2xs font-mono text-slate-600 dark:text-slate-300">
                              {ath.inviteCode} • CTL {Math.round(latestCtlVal)}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {formatRoleBadge(ath.role, ath.status)}
                            {isConfirmingRemove ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    onRemoveOrDeclineAthlete(ath.id);
                                    setConfirmDeleteAthleteId(null);
                                  }}
                                  className="min-h-[44px] sm:min-h-[38px] px-2.5 py-1 rounded-lg bg-rose-600 text-white text-xs font-mono font-bold cursor-pointer"
                                >
                                  Remove
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteAthleteId(null)}
                                  className="min-h-[44px] sm:min-h-[38px] px-2.5 py-1 rounded-lg border border-stone-300 dark:border-slate-700 text-xs font-mono cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteAthleteId(ath.id)}
                                className="min-h-[44px] min-w-[44px] sm:min-h-[38px] sm:min-w-[38px] inline-flex items-center justify-center rounded-lg hover:bg-rose-500/15 text-rose-700/80 dark:text-rose-300/80 hover:text-rose-600 dark:hover:text-rose-300 cursor-pointer"
                                title={`Remove connection with ${ath.name}`}
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
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-bold text-slate-900 dark:text-white">
                        Your Outbound Athlete Privacy &amp; Sharing Permissions
                      </h3>
                      <span className="px-2 py-0.5 rounded-md ap-status-prime text-2xs font-mono uppercase font-semibold">
                        Zero-Trust Governance
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                      Control exactly which physiological streams and wellness markers your Friends (<code className="ap-text-brand">FRIEND_VIEW</code>) and Coaches (<code className="ap-text-brand">COACH_EDIT</code>) can inspect when they switch to your profile.
                    </p>
                  </div>
                  <div className="px-3 py-1.5 rounded bg-[#10B981]/10 border border-[#10B981]/30 text-xs font-mono text-emerald-700 dark:text-[#10B981]">
                    ● Shield Active
                  </div>
                </div>

                {/* 3 Granular Visibility Selectors */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* 1. Morning HRV & Wellness */}
                  <div className="bg-white/80 dark:bg-[#101B15] border border-stone-200/90 dark:border-[#244331] rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor={`${formIdPrefix}-priv-hrv`}
                        className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"
                      >
                        <HeartPulse className="w-4 h-4 text-[#10B981]" />
                        Morning HRV, RHR &amp; Sleep
                      </label>
                    </div>
                    <p className="text-2xs text-slate-600 dark:text-slate-300">
                      Controls visibility of daily HRV (ms), resting heart rate, and sleep quality scores.
                    </p>
                    <select
                      id={`${formIdPrefix}-priv-hrv`}
                      value={selfPrivacySettings.shareWellnessAndHrv}
                      onChange={(e) =>
                        onUpdateSelfPrivacy({
                          ...selfPrivacySettings,
                          shareWellnessAndHrv: e.target.value as PrivacyVisibilityTier,
                        })
                      }
                      className="w-full min-h-[42px] bg-white dark:bg-[#15231B] border border-stone-300 dark:border-[#2B543B] rounded-lg px-2.5 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
                    >
                      <option value="ALL_CONNECTIONS">Friends &amp; Coaches (All Connections)</option>
                      <option value="COACHES_ONLY">Coaches Only (Hidden from Friends)</option>
                      <option value="PRIVATE">Strictly Private (Only Me)</option>
                    </select>
                  </div>

                  {/* 2. PMC Load & Power/Pace Zones */}
                  <div className="bg-white/80 dark:bg-[#101B15] border border-stone-200/90 dark:border-[#244331] rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor={`${formIdPrefix}-priv-pmc`}
                        className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"
                      >
                        <Activity className="w-4 h-4 ap-text-brand" />
                        PMC Fitness (CTL/ATL) &amp; Zones
                      </label>
                    </div>
                    <p className="text-2xs text-slate-600 dark:text-slate-300">
                      Controls visibility of your Chronic Training Load, Form (TSB), FTP, and Effort Stripes.
                    </p>
                    <select
                      id={`${formIdPrefix}-priv-pmc`}
                      value={selfPrivacySettings.sharePmcAndZones}
                      onChange={(e) =>
                        onUpdateSelfPrivacy({
                          ...selfPrivacySettings,
                          sharePmcAndZones: e.target.value as PrivacyVisibilityTier,
                        })
                      }
                      className="w-full min-h-[42px] bg-white dark:bg-[#15231B] border border-stone-300 dark:border-[#2B543B] rounded-lg px-2.5 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
                    >
                      <option value="ALL_CONNECTIONS">Friends &amp; Coaches (All Connections)</option>
                      <option value="COACHES_ONLY">Coaches Only (Hidden from Friends)</option>
                      <option value="PRIVATE">Strictly Private (Only Me)</option>
                    </select>
                  </div>

                  {/* 3. Outdoor GPS Route Polylines */}
                  <div className="bg-white/80 dark:bg-[#101B15] border border-stone-200/90 dark:border-[#244331] rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor={`${formIdPrefix}-priv-gps`}
                        className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"
                      >
                        <MapPin className="w-4 h-4 text-amber-500" />
                        Outdoor GPS Maps &amp; Start Times
                      </label>
                    </div>
                    <p className="text-2xs text-slate-600 dark:text-slate-300">
                      Masks exact GPS home/work start coordinates while preserving distance, pace, and lap splits.
                    </p>
                    <select
                      id={`${formIdPrefix}-priv-gps`}
                      value={selfPrivacySettings.shareGpsRoutes}
                      onChange={(e) =>
                        onUpdateSelfPrivacy({
                          ...selfPrivacySettings,
                          shareGpsRoutes: e.target.value as PrivacyVisibilityTier,
                        })
                      }
                      className="w-full min-h-[42px] bg-white dark:bg-[#15231B] border border-stone-300 dark:border-[#2B543B] rounded-lg px-2.5 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
                    >
                      <option value="ALL_CONNECTIONS">Friends &amp; Coaches (All Connections)</option>
                      <option value="COACHES_ONLY">Coaches Only (Hidden from Friends)</option>
                      <option value="PRIVATE">Strictly Private (Only Me)</option>
                    </select>
                  </div>
                </div>

                {/* Boolean Security Toggles */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <label className="bg-white/80 dark:bg-[#101B15] border border-stone-200/90 dark:border-emerald-400/20 rounded-lg p-4 flex items-start justify-between gap-4 cursor-pointer">
                    <div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-white">
                        Allow Assigned Coaches to Push Workouts to My Calendar
                      </div>
                      <div className="text-2xs text-slate-600 dark:text-slate-300 mt-0.5">
                        When enabled, connections granted the <code className="ap-text-brand font-semibold">COACH_EDIT</code> role can schedule structured workouts onto your Training Calendar.
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
                      className="mt-1 accent-[#1C5436] dark:accent-[#C8FF00] w-4 h-4"
                    />
                  </label>

                  <label className="bg-white/80 dark:bg-[#101B15] border border-stone-200/90 dark:border-emerald-400/20 rounded-lg p-4 flex items-start justify-between gap-4 cursor-pointer">
                    <div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-white">
                        Strava API Compliance Shield (Explicit Opt-In Enforcement)
                      </div>
                      <div className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5">
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
