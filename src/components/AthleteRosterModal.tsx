import React, { useState } from 'react';
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
} from "./icons/PhosphorIcons";
import {
  AthleteConnectionRole,
  AthletePrivacySettings,
  AthleteProfile,
  ConnectedAthleteRecord,
  DistanceUnit,
  PrivacyVisibilityTier,
} from '../types';
import { applyAthletePrivacyShield } from '../data/athleteRosterData';
import { AeroPulseLogo } from './AeroPulseLogo';

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
}

type RosterTab = 'LEADERBOARD' | 'CONNECT_INVITE' | 'PRIVACY_SHIELD';

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
}) => {
  const [activeTab, setActiveTab] = useState<RosterTab>('LEADERBOARD');
  const [copiedCode, setCopiedCode] = useState(false);

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
    'Focus on relaxed shoulders and even 400m splits. Pushed via AeroPulse Coach Desk.'
  );
  const [pushSuccessBanner, setPushSuccessBanner] = useState<string | null>(null);

  if (!isOpen) return null;

  const connectedRoster = roster.filter((a) => a.status === 'CONNECTED');
  const pendingRequests = roster.filter((a) => a.status !== 'CONNECTED');

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
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-[#F59E0B]/15 text-[#F59E0B] border border-[#F59E0B]/40">
          Pending Request
        </span>
      );
    }
    if (role === 'COACH_EDIT') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-[#F97316]/15 text-[#F97316] border border-[#F97316]/40">
          <CalendarPlus className="w-3 h-3" />
          Coach (Edit Calendar)
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-[#38BDF8]/15 text-[#38BDF8] border border-[#38BDF8]/40">
        <Eye className="w-3 h-3" />
        Friend (View)
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#0D1015] border border-[#262F3D] rounded-xl max-w-6xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[#1E2530] flex flex-wrap items-center justify-between gap-4 bg-[#11151C]">
          <div className="flex items-center gap-3">
            <AeroPulseLogo size="sm" />
            <div className="h-6 w-px bg-[#1E2530] hidden sm:block" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">
                  Athletes, Friends &amp; Coaching Hub
                </h2>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#14181F] text-[#38BDF8] border border-[#262F3D]">
                  ROSTER &amp; PRIVACY SHIELD
                </span>
              </div>
              <p className="text-xs text-[#94A3B8]">
                Switch athlete calendars, compare live CTL/ATL/TSB fitness load, manage friend follow requests, or push coach workouts.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Personal Invite Code Pill */}
            <div className="hidden sm:flex items-center gap-2 bg-[#090B0E] border border-[#1E2530] rounded-lg px-3 py-1.5">
              <span className="text-[10px] font-mono uppercase text-[#64748B]">Your Invite Code:</span>
              <span className="text-xs font-mono font-bold text-[#F97316]">{selfInviteCode}</span>
              <button
                onClick={handleCopyInvite}
                className="text-[#94A3B8] hover:text-white transition-colors"
                title="Copy your AeroPulse Invite Code"
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
              className="px-2.5 py-1.5 rounded-lg bg-[#14181F] hover:bg-[#1E2530] border border-[#262F3D] text-[#94A3B8] hover:text-white transition-colors flex items-center gap-1.5 text-xs font-mono"
              title="Close Roster Hub (Esc)"
            >
              <span>Esc</span>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 border-b border-[#1E2530] bg-[#0F131A] flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('LEADERBOARD')}
              className={`px-4 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'LEADERBOARD'
                  ? 'border-[#F97316] text-white font-semibold'
                  : 'border-transparent text-[#94A3B8] hover:text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-[#F97316]" />
              <span>Team &amp; Friends Roster ({connectedRoster.length + 1})</span>
            </button>

            <button
              onClick={() => setActiveTab('CONNECT_INVITE')}
              className={`px-4 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'CONNECT_INVITE'
                  ? 'border-[#38BDF8] text-white font-semibold'
                  : 'border-transparent text-[#94A3B8] hover:text-white'
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
                  ? 'border-[#10B981] text-white font-semibold'
                  : 'border-transparent text-[#94A3B8] hover:text-white'
              }`}
            >
              <Shield className="w-3.5 h-3.5 text-[#10B981]" />
              <span>Privacy &amp; Strava Security Controls</span>
            </button>
          </div>

          <div className="text-[11px] font-mono text-[#64748B] py-2">
            Viewing Context:{' '}
            <span className="text-white font-semibold">
              {activeAthleteId === 'SELF'
                ? `${selfName} (You)`
                : roster.find((r) => r.id === activeAthleteId)?.name || 'Athlete'}
            </span>
          </div>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {pushSuccessBanner && (
            <div className="bg-[#10B981]/15 border border-[#10B981]/40 rounded-lg px-4 py-3 flex items-center justify-between text-xs text-[#10B981] font-mono">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{pushSuccessBanner}</span>
              </div>
              <button onClick={() => setPushSuccessBanner(null)} className="text-xs underline">
                Dismiss
              </button>
            </div>
          )}

          {/* TAB 1: TEAM & FRIENDS ROSTER LEADERBOARD */}
          {activeTab === 'LEADERBOARD' && (
            <div className="space-y-5">
              <div className="overflow-x-auto border border-[#1E2530] rounded-xl bg-[#090B0E]">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#1E2530] text-[10px] font-mono uppercase text-[#64748B] bg-[#0F131A]">
                      <th className="py-3 px-4">Athlete / Strava ID</th>
                      <th className="py-3 px-3">Access Role</th>
                      <th className="py-3 px-3">Fitness (CTL)</th>
                      <th className="py-3 px-3">Fatigue (ATL)</th>
                      <th className="py-3 px-3">Form (TSB)</th>
                      <th className="py-3 px-3">Morning HRV</th>
                      <th className="py-3 px-3">FTP / W·kg⁻¹</th>
                      <th className="py-3 px-3">Target Objective</th>
                      <th className="py-3 px-4 text-right">Workspace Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E2530] text-xs">
                    {/* Row 0: Self */}
                    <tr
                      className={`transition-colors ${
                        activeAthleteId === 'SELF'
                          ? 'bg-[#F97316]/10'
                          : 'hover:bg-[#14181F]/60'
                      }`}
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#F97316] to-[#3B82F6] flex items-center justify-center font-mono font-bold text-xs text-white">
                            YOU
                          </div>
                          <div>
                            <div className="font-semibold text-white flex items-center gap-1.5">
                              <span>{selfName}</span>
                              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#F97316]/20 text-[#F97316]">
                                Primary Account
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-[#64748B]">
                              Invite: {selfInviteCode}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                          Owner (Full Control)
                        </span>
                      </td>
                      <td className="py-3.5 px-3 font-mono font-semibold text-[#38BDF8]">
                        {Math.round(selfCtl)}
                      </td>
                      <td className="py-3.5 px-3 font-mono text-[#A855F7]">
                        {Math.round(selfAtl)}
                      </td>
                      <td className="py-3.5 px-3 font-mono">
                        <span
                          className={
                            selfTsb >= 0
                              ? 'text-[#10B981] font-semibold'
                              : selfTsb >= -15
                              ? 'text-[#38BDF8]'
                              : 'text-[#F59E0B]'
                          }
                        >
                          {selfTsb > 0 ? `+${Math.round(selfTsb)}` : Math.round(selfTsb)}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 font-mono text-[#10B981]">{selfHrv} ms</td>
                      <td className="py-3.5 px-3 font-mono text-[#CBD5E1]">
                        {selfProfile.ftp}W ({(selfProfile.ftp / Math.max(40, selfProfile.weightKg)).toFixed(2)} W/kg)
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="text-xs text-white font-medium">Sub-20 5K / 350W FTP</div>
                        <div className="text-[10px] font-mono text-[#64748B]">Active Plan Architect</div>
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
                              : 'bg-[#14181F] hover:bg-[#1E2530] text-[#CBD5E1] border border-[#262F3D]'
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
                            isSelected ? 'bg-[#38BDF8]/10' : 'hover:bg-[#14181F]/60'
                          }`}
                        >
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-3">
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center font-mono font-bold text-xs text-white border"
                                style={{
                                  backgroundColor: `${avatarColor}25`,
                                  borderColor: `${avatarColor}80`,
                                }}
                              >
                                {rawAthlete.avatarInitials}
                              </div>
                              <div>
                                <div className="font-semibold text-white flex items-center gap-1.5">
                                  <span>{rawAthlete.name}</span>
                                  <span className="text-[10px] font-mono text-[#64748B]">
                                    #{rawAthlete.stravaAthleteId}
                                  </span>
                                </div>
                                <div className="text-[11px] text-[#94A3B8]">
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
                                className="text-[10px] font-mono text-[#64748B] hover:text-white underline"
                              >
                                Switch to {rawAthlete.role === 'COACH_EDIT' ? 'Friend View' : 'Coach Edit'}
                              </button>
                            </div>
                          </td>

                          <td className="py-3.5 px-3 font-mono font-semibold text-[#38BDF8]">
                            {pmcMasked ? (
                              <span className="text-[#64748B] flex items-center gap-1">
                                <Lock className="w-3 h-3" /> Private
                              </span>
                            ) : (
                              Math.round(ctlVal)
                            )}
                          </td>

                          <td className="py-3.5 px-3 font-mono text-[#A855F7]">
                            {pmcMasked ? '—' : Math.round(atlVal)}
                          </td>

                          <td className="py-3.5 px-3 font-mono">
                            {pmcMasked ? (
                              '—'
                            ) : (
                              <span
                                className={
                                  tsbVal >= 0
                                    ? 'text-[#10B981] font-semibold'
                                    : tsbVal >= -15
                                    ? 'text-[#38BDF8]'
                                    : 'text-[#F59E0B]'
                                }
                              >
                                {tsbVal > 0 ? `+${Math.round(tsbVal)}` : Math.round(tsbVal)}
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-3 font-mono">
                            {hrvMasked ? (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] text-[#F59E0B] bg-[#F59E0B]/10 border border-[#F59E0B]/30 px-1.5 py-0.5 rounded"
                                title="Hidden by Athlete's Privacy Shield for Friend View"
                              >
                                <Lock className="w-3 h-3" /> Coaches Only
                              </span>
                            ) : (
                              <span className="text-[#10B981]">
                                {shieldedLatest?.hrvRMSSD || rawLatest?.hrvRMSSD || 58} ms
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-3 font-mono text-[#CBD5E1]">
                            {rawAthlete.athleteProfile.ftp}W ({wPerKg} W/kg)
                          </td>

                          <td className="py-3.5 px-3">
                            <div className="text-xs text-white font-medium">
                              {rawAthlete.primaryGoalSummary}
                            </div>
                            <div className="text-[10px] font-mono text-[#64748B]">
                              7d Load: {weeklyTss} TSS
                            </div>
                          </td>

                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {rawAthlete.role === 'COACH_EDIT' &&
                                rawAthlete.privacySettings.allowCoachCalendarEdits && (
                                  <button
                                    onClick={() => handleOpenCoachPush(rawAthlete)}
                                    className="px-2.5 py-1.5 rounded text-xs font-mono bg-[#F97316]/15 hover:bg-[#F97316]/25 text-[#F97316] border border-[#F97316]/40 flex items-center gap-1 transition-colors"
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
                                    : 'bg-[#14181F] hover:bg-[#1E2530] text-white border border-[#262F3D]'
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
                  className="bg-[#11151C] border border-[#F97316]/50 rounded-xl p-5 space-y-4 shadow-xl"
                >
                  <div className="flex items-center justify-between border-b border-[#1E2530] pb-3">
                    <div className="flex items-center gap-2">
                      <CalendarPlus className="w-4 h-4 text-[#F97316]" />
                      <h3 className="text-sm font-bold text-white">
                        Coach Workout Prescription Desk — Target:{' '}
                        <span className="text-[#F97316]">
                          {roster.find((r) => r.id === pushTargetAthleteId)?.name}
                        </span>
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPushTargetAthleteId(null)}
                      className="text-xs font-mono text-[#94A3B8] hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-[10px] font-mono uppercase text-[#94A3B8] mb-1">
                        Workout Title
                      </label>
                      <input
                        type="text"
                        value={workoutName}
                        onChange={(e) => setWorkoutName(e.target.value)}
                        className="w-full bg-[#090B0E] border border-[#262F3D] rounded px-3 py-1.5 text-xs text-white font-mono"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-mono uppercase text-[#94A3B8] mb-1">
                        Scheduled Date
                      </label>
                      <input
                        type="date"
                        value={workoutDate}
                        onChange={(e) => setWorkoutDate(e.target.value)}
                        className="w-full bg-[#090B0E] border border-[#262F3D] rounded px-3 py-1.5 text-xs text-white font-mono"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-mono uppercase text-[#94A3B8] mb-1">
                        Sport &amp; Target Load
                      </label>
                      <div className="flex gap-2">
                        <select
                          value={workoutSport}
                          onChange={(e) => setWorkoutSport(e.target.value as 'Running' | 'Cycling')}
                          className="bg-[#090B0E] border border-[#262F3D] rounded px-2 py-1.5 text-xs text-white font-mono"
                        >
                          <option value="Running">Running</option>
                          <option value="Cycling">Cycling</option>
                        </select>
                        <input
                          type="number"
                          value={workoutLoad}
                          onChange={(e) => setWorkoutLoad(Number(e.target.value))}
                          className="w-20 bg-[#090B0E] border border-[#262F3D] rounded px-2 py-1.5 text-xs text-white font-mono"
                          placeholder="TSS"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-mono uppercase text-[#94A3B8] mb-1">
                        Intervals.icu Structured Workout Syntax
                      </label>
                      <textarea
                        rows={3}
                        value={workoutSyntax}
                        onChange={(e) => setWorkoutSyntax(e.target.value)}
                        className="w-full bg-[#090B0E] border border-[#262F3D] rounded p-2.5 text-xs font-mono text-[#38BDF8]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono uppercase text-[#94A3B8] mb-1">
                        Coach Execution Notes &amp; Duration (Mins)
                      </label>
                      <textarea
                        rows={2}
                        value={workoutNotes}
                        onChange={(e) => setWorkoutNotes(e.target.value)}
                        className="w-full bg-[#090B0E] border border-[#262F3D] rounded p-2.5 text-xs text-white mb-2"
                      />
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-mono text-[#94A3B8]">
                          <span>Duration (min):</span>
                          <input
                            type="number"
                            value={workoutDurationMins}
                            onChange={(e) => setWorkoutDurationMins(Number(e.target.value))}
                            className="w-16 bg-[#090B0E] border border-[#262F3D] rounded px-2 py-1 text-xs text-white"
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

          {/* TAB 2: FOLLOW FRIENDS, INVITE CODES & PENDING REQUESTS */}
          {activeTab === 'CONNECT_INVITE' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left 6 cols: Add Athlete by Invite Code or Strava Name */}
              <div className="lg:col-span-6 space-y-4">
                <div className="bg-[#0F131A] border border-[#1E2530] rounded-xl p-5 space-y-4">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[#38BDF8]">
                      ADD FRIEND OR COACHED ATHLETE
                    </span>
                    <h3 className="text-sm font-bold text-white mt-0.5">
                      Follow Athlete by Invite Code or Strava Handle
                    </h3>
                    <p className="text-xs text-[#94A3B8] mt-1">
                      Enter a friend&apos;s AeroPulse Invite Code (e.g. <code className="text-[#F97316]">AP-4401-TRACK</code>) or name to add them to your athlete switcher.
                    </p>
                  </div>

                  {followFeedback && (
                    <div className="p-3 rounded-lg bg-[#10B981]/15 border border-[#10B981]/30 text-xs text-[#10B981] font-mono">
                      {followFeedback}
                    </div>
                  )}

                  <form onSubmit={handleFollowSubmit} className="space-y-3">
                    <div>
                      <label className="block text-[10px] font-mono uppercase text-[#94A3B8] mb-1">
                        Athlete Name, Strava ID, or Invite Code
                      </label>
                      <input
                        type="text"
                        value={inviteQuery}
                        onChange={(e) => setInviteQuery(e.target.value)}
                        placeholder="e.g. Jordan Mercer or AP-5120-VELO"
                        className="w-full bg-[#090B0E] border border-[#262F3D] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-[#38BDF8]"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-mono uppercase text-[#94A3B8] mb-1">
                          Connection Permission Tier
                        </label>
                        <select
                          value={inviteRole}
                          onChange={(e) =>
                            setInviteRole(e.target.value as 'COACH_EDIT' | 'FRIEND_VIEW')
                          }
                          className="w-full bg-[#090B0E] border border-[#262F3D] rounded-lg px-3 py-2 text-xs text-white font-mono"
                        >
                          <option value="FRIEND_VIEW">Friend (View Telemetry)</option>
                          <option value="COACH_EDIT">Coached Athlete (Edit Calendar)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-mono uppercase text-[#94A3B8] mb-1">
                          Primary Discipline
                        </label>
                        <select
                          value={inviteSpecialty}
                          onChange={(e) =>
                            setInviteSpecialty(e.target.value as 'Running' | 'Cycling')
                          }
                          className="w-full bg-[#090B0E] border border-[#262F3D] rounded-lg px-3 py-2 text-xs text-white font-mono"
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
                <div className="bg-[#0F131A] border border-[#1E2530] rounded-xl p-5 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[10px] font-mono uppercase text-[#F97316]">
                      SHARE YOUR INVITE CODE WITH COACHES OR TEAMMATES
                    </div>
                    <div className="text-lg font-mono font-bold text-white mt-0.5">
                      {selfInviteCode}
                    </div>
                    <div className="text-xs text-[#64748B]">
                      Anyone with this code can request Friend View or Coach access to your telemetry.
                    </div>
                  </div>
                  <button
                    onClick={handleCopyInvite}
                    className="px-3.5 py-2 rounded-lg bg-[#14181F] hover:bg-[#1E2530] border border-[#262F3D] text-xs font-mono text-white flex items-center gap-1.5 shrink-0"
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
                <div className="bg-[#0F131A] border border-[#1E2530] rounded-xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[#F59E0B]">
                      INCOMING FOLLOW &amp; COACHING REQUESTS ({pendingRequests.length})
                    </span>
                  </div>

                  {pendingRequests.length === 0 ? (
                    <div className="text-xs text-[#64748B] font-mono py-4 text-center">
                      No pending follow requests.
                    </div>
                  ) : (
                    pendingRequests.map((req, idx) => {
                      const avatarColor = AVATAR_PALETTE[(idx + 2) % AVATAR_PALETTE.length];
                      return (
                        <div
                          key={req.id}
                          className="bg-[#090B0E] border border-[#262F3D] rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className="w-9 h-9 rounded-full flex items-center justify-center font-mono font-bold text-xs text-white"
                              style={{ backgroundColor: `${avatarColor}30` }}
                            >
                              {req.avatarInitials}
                            </div>
                            <div>
                              <div className="text-xs font-bold text-white">
                                {req.name}{' '}
                                <span className="font-mono text-[10px] text-[#64748B]">
                                  ({req.inviteCode})
                                </span>
                              </div>
                              <div className="text-[11px] text-[#94A3B8]">
                                {req.location} • Goal: {req.primaryGoalSummary}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => onApproveRequest(req.id, 'FRIEND_VIEW')}
                              className="px-2.5 py-1.5 rounded bg-[#38BDF8]/15 hover:bg-[#38BDF8]/25 border border-[#38BDF8]/40 text-[#38BDF8] text-[11px] font-mono"
                            >
                              Approve as Friend
                            </button>
                            <button
                              onClick={() => onApproveRequest(req.id, 'COACH_EDIT')}
                              className="px-2.5 py-1.5 rounded bg-[#F97316]/15 hover:bg-[#F97316]/25 border border-[#F97316]/40 text-[#F97316] text-[11px] font-mono"
                            >
                              Approve as Coach
                            </button>
                            <button
                              onClick={() => onRemoveOrDeclineAthlete(req.id)}
                              className="p-1.5 rounded bg-[#14181F] hover:bg-red-500/20 text-[#64748B] hover:text-red-400"
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
                <div className="bg-[#0F131A] border border-[#1E2530] rounded-xl p-5 space-y-3">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[#94A3B8]">
                    CONNECTED ATHLETES ({connectedRoster.length})
                  </div>
                  <div className="space-y-2">
                    {connectedRoster.map((ath) => {
                      const latestCtlVal =
                        ath.wellnessDays[ath.wellnessDays.length - 1]?.ctl ?? 65;
                      return (
                        <div
                          key={ath.id}
                          className="bg-[#090B0E] border border-[#1E2530] rounded-lg px-3.5 py-2.5 flex items-center justify-between gap-2"
                        >
                          <div>
                            <div className="text-xs font-semibold text-white">{ath.name}</div>
                            <div className="text-[10px] font-mono text-[#64748B]">
                              {ath.inviteCode} • CTL {Math.round(latestCtlVal)}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {formatRoleBadge(ath.role, ath.status)}
                            <button
                              onClick={() => onRemoveOrDeclineAthlete(ath.id)}
                              className="p-1 rounded hover:bg-red-500/20 text-[#64748B] hover:text-red-400"
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
              <div className="bg-[#0F131A] border border-[#1E2530] rounded-xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1E2530] pb-4">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[#10B981]">
                      ZERO-TRUST BIOMETRIC &amp; STRAVA API DATA GOVERNANCE
                    </span>
                    <h3 className="text-base font-bold text-white mt-0.5">
                      Your Outbound Athlete Privacy &amp; Sharing Permissions
                    </h3>
                    <p className="text-xs text-[#94A3B8]">
                      Control exactly which physiological streams and wellness markers your Friends (<code className="text-[#38BDF8]">FRIEND_VIEW</code>) and Coaches (<code className="text-[#F97316]">COACH_EDIT</code>) can inspect when they switch to your profile.
                    </p>
                  </div>
                  <div className="px-3 py-1.5 rounded bg-[#10B981]/10 border border-[#10B981]/30 text-xs font-mono text-[#10B981]">
                    ● Shield Active
                  </div>
                </div>

                {/* 3 Granular Visibility Selectors */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* 1. Morning HRV & Wellness */}
                  <div className="bg-[#090B0E] border border-[#1E2530] rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                        <HeartPulse className="w-4 h-4 text-[#10B981]" />
                        Morning HRV, RHR &amp; Sleep
                      </span>
                    </div>
                    <p className="text-[11px] text-[#94A3B8]">
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
                      className="w-full bg-[#14181F] border border-[#262F3D] rounded px-2.5 py-2 text-xs font-mono text-white"
                    >
                      <option value="ALL_CONNECTIONS">Friends &amp; Coaches (All Connections)</option>
                      <option value="COACHES_ONLY">Coaches Only (Hidden from Friends)</option>
                      <option value="PRIVATE">Strictly Private (Only Me)</option>
                    </select>
                  </div>

                  {/* 2. PMC Load & Power/Pace Zones */}
                  <div className="bg-[#090B0E] border border-[#1E2530] rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                        <Activity className="w-4 h-4 text-[#38BDF8]" />
                        PMC Fitness (CTL/ATL) &amp; Zones
                      </span>
                    </div>
                    <p className="text-[11px] text-[#94A3B8]">
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
                      className="w-full bg-[#14181F] border border-[#262F3D] rounded px-2.5 py-2 text-xs font-mono text-white"
                    >
                      <option value="ALL_CONNECTIONS">Friends &amp; Coaches (All Connections)</option>
                      <option value="COACHES_ONLY">Coaches Only (Hidden from Friends)</option>
                      <option value="PRIVATE">Strictly Private (Only Me)</option>
                    </select>
                  </div>

                  {/* 3. Outdoor GPS Route Polylines */}
                  <div className="bg-[#090B0E] border border-[#1E2530] rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                        <MapPin className="w-4 h-4 text-[#F97316]" />
                        Outdoor GPS Maps &amp; Start Times
                      </span>
                    </div>
                    <p className="text-[11px] text-[#94A3B8]">
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
                      className="w-full bg-[#14181F] border border-[#262F3D] rounded px-2.5 py-2 text-xs font-mono text-white"
                    >
                      <option value="ALL_CONNECTIONS">Friends &amp; Coaches (All Connections)</option>
                      <option value="COACHES_ONLY">Coaches Only (Hidden from Friends)</option>
                      <option value="PRIVATE">Strictly Private (Only Me)</option>
                    </select>
                  </div>
                </div>

                {/* Boolean Security Toggles */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <label className="bg-[#090B0E] border border-[#1E2530] rounded-lg p-4 flex items-start justify-between gap-4 cursor-pointer">
                    <div>
                      <div className="text-xs font-semibold text-white">
                        Allow Assigned Coaches to Push Workouts to My Calendar
                      </div>
                      <div className="text-[11px] text-[#94A3B8] mt-0.5">
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

                  <label className="bg-[#090B0E] border border-[#1E2530] rounded-lg p-4 flex items-start justify-between gap-4 cursor-pointer">
                    <div>
                      <div className="text-xs font-semibold text-white">
                        Strava API Compliance Shield (Explicit Opt-In Enforcement)
                      </div>
                      <div className="text-[11px] text-[#94A3B8] mt-0.5">
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
