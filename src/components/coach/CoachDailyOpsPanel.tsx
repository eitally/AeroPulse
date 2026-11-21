import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bell,
  CheckCircle2,
  ClipboardText,
  Target,
  Timer,
  Trash2,
  X,
  Zap,
} from '../icons/PhosphorIcons';
import {
  deleteTeamAnnouncementApi,
  postTeamAnnouncementApi,
  recordTeamAttendanceBatchApi,
} from '../../utils/teamLifecycleApi';
import { formatFieldMarkDual } from '../../physiology/fieldEventsEngine';
import type {
  CoachComplexityTier,
  CoachEventGroup,
  ConnectedAthleteRecord,
  TeamAnnouncementCategory,
  TeamAnnouncementRecord,
  TeamAttendanceRecord,
  TeamAttendanceStatus,
  TeamSummaryWithRole,
} from '../../types';

export interface CoachDailyOpsPanelProps {
  activeTeam: TeamSummaryWithRole | null;
  myTeams: TeamSummaryWithRole[];
  complexityTier: CoachComplexityTier;
  allowedEventGroups?: CoachEventGroup[];
  onLaunchStopwatch: () => void;
  onLaunchFieldSheet: () => void;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], activeId?: string) => void;
}

const QUICK_ALERT_PRESETS: Array<{
  id: string;
  label: string;
  category: TeamAnnouncementCategory;
  title: string;
  body: string;
}> = [
  {
    id: 'lightning',
    label: 'Lightning Delay',
    category: 'WEATHER',
    title: 'Lightning Shelter — 30m Delay',
    body: 'All groups clear the track & pits immediately and shelter inside the main gym until all-clear.',
  },
  {
    id: 'heat',
    label: 'Heat Advisory',
    category: 'WEATHER',
    title: 'Heat Modification Today',
    body: 'Hydration breaks every 15 minutes; extended recovery intervals between speed & hurdle reps.',
  },
  {
    id: 'bus',
    label: 'Bus / Meet Shift',
    category: 'MEET_LOGISTICS',
    title: 'Meet Bus Departure Update',
    body: 'Athletes dismiss at 2:15 PM for gear check; buses roll at 2:30 PM from North Lot.',
  },
];

function todayLocalIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export const CoachDailyOpsPanel: React.FC<CoachDailyOpsPanelProps> = ({
  activeTeam,
  myTeams,
  complexityTier,
  allowedEventGroups,
  onLaunchStopwatch,
  onLaunchFieldSheet,
  onTeamsUpdated,
}) => {
  const todayIso = useMemo(() => todayLocalIso(), []);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [groupFilter, setGroupFilter] = useState<CoachEventGroup | 'ALL'>('ALL');
  const [attendanceMap, setAttendanceMap] = useState<Record<string, TeamAttendanceStatus>>({});
  const [savingAttendance, setSavingAttendance] = useState<boolean>(false);
  const [attendanceBanner, setAttendanceBanner] = useState<string | null>(null);

  const [alertTitle, setAlertTitle] = useState<string>('');
  const [alertBody, setAlertBody] = useState<string>('');
  const [alertCategory, setAlertCategory] = useState<TeamAnnouncementCategory>('WEATHER');
  const [publishToHub, setPublishToHub] = useState<boolean>(true);
  const [postingAlert, setPostingAlert] = useState<boolean>(false);
  const [alertBanner, setAlertBanner] = useState<string | null>(null);

  const athleteMembers = useMemo(() => {
    const members = (activeTeam?.memberships || []).filter((m) => m.role === 'ATHLETE');
    if (allowedEventGroups && allowedEventGroups.length > 0) {
      const scoped = members.filter(
        (m) => !m.eventGroup || allowedEventGroups.includes(m.eventGroup)
      );
      return scoped.length > 0 ? scoped : members;
    }
    return members;
  }, [activeTeam?.memberships, allowedEventGroups]);

  useEffect(() => {
    const savedMap = activeTeam?.attendanceByDate?.[todayIso];
    const next: Record<string, TeamAttendanceStatus> = {};
    if (savedMap) {
      for (const rec of Object.values(savedMap)) {
        next[rec.membershipId] = rec.status;
      }
    }
    setAttendanceMap(next);
  }, [activeTeam?.brand.teamId, activeTeam?.attendanceByDate, todayIso]);

  const visibleMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return athleteMembers.filter((m) => {
      if (groupFilter !== 'ALL' && m.eventGroup !== groupFilter) return false;
      if (q && !m.invitedName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [athleteMembers, groupFilter, searchQuery]);

  const handleMarkAllPresent = () => {
    const next: Record<string, TeamAttendanceStatus> = { ...attendanceMap };
    for (const m of visibleMembers) {
      next[m.membershipId] = 'PRESENT';
    }
    setAttendanceMap(next);
    setAttendanceBanner(null);
  };

  const handleSaveAttendance = async () => {
    if (!activeTeam) return;
    const entries = visibleMembers
      .map((m) => ({
        membershipId: m.membershipId,
        status: attendanceMap[m.membershipId] || 'PRESENT',
      }));
    if (entries.length === 0) return;

    const applyLocal = () => {
      const existing = activeTeam.attendanceByDate || {};
      const nextByMember: Record<string, TeamAttendanceRecord> = { ...(existing[todayIso] || {}) };
      for (const e of entries) {
        nextByMember[e.membershipId] = {
          date: todayIso,
          membershipId: e.membershipId,
          status: e.status,
          updatedAt: new Date().toISOString(),
        };
      }
      const updated: TeamSummaryWithRole = {
        ...activeTeam,
        attendanceByDate: { ...existing, [todayIso]: nextByMember },
      };
      onTeamsUpdated(
        myTeams.map((t) => (t.brand.teamId === updated.brand.teamId ? updated : t)),
        updated.brand.teamId
      );
      setAttendanceBanner(`Saved attendance for ${entries.length} athletes ✓`);
    };

    setSavingAttendance(true);
    setAttendanceBanner(null);
    try {
      const resp = await recordTeamAttendanceBatchApi({
        teamId: activeTeam.brand.teamId,
        date: todayIso,
        entries,
      });
      if (resp.teams && resp.teams.length > 0) {
        onTeamsUpdated(resp.teams, activeTeam.brand.teamId);
      } else if (resp.team) {
        onTeamsUpdated(
          myTeams.map((t) => (t.brand.teamId === resp.team!.brand.teamId ? resp.team! : t)),
          resp.team.brand.teamId
        );
      }
      setAttendanceBanner(`Saved attendance for ${entries.length} athletes ✓`);
    } catch {
      applyLocal();
    } finally {
      setSavingAttendance(false);
    }
  };

  const handlePostAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTeam || !alertTitle.trim() || !alertBody.trim()) return;

    const applyLocal = () => {
      const created: TeamAnnouncementRecord = {
        id: `ann-local-${Date.now()}`,
        teamId: activeTeam.brand.teamId,
        title: alertTitle.trim(),
        body: alertBody.trim(),
        category: alertCategory,
        publishToParentHub: publishToHub,
        authorName: 'Head Coach',
        createdAt: new Date().toISOString(),
      };
      const updated: TeamSummaryWithRole = {
        ...activeTeam,
        announcements: [created, ...(activeTeam.announcements || [])].slice(0, 20),
      };
      onTeamsUpdated(
        myTeams.map((t) => (t.brand.teamId === updated.brand.teamId ? updated : t)),
        updated.brand.teamId
      );
      setAlertTitle('');
      setAlertBody('');
      setAlertBanner('Team alert posted ✓');
    };

    setPostingAlert(true);
    setAlertBanner(null);
    try {
      const resp = await postTeamAnnouncementApi({
        teamId: activeTeam.brand.teamId,
        title: alertTitle.trim(),
        body: alertBody.trim(),
        category: alertCategory,
        publishToParentHub: publishToHub,
      });
      if (resp.teams && resp.teams.length > 0) {
        onTeamsUpdated(resp.teams, activeTeam.brand.teamId);
      } else if (resp.team) {
        onTeamsUpdated(
          myTeams.map((t) => (t.brand.teamId === resp.team!.brand.teamId ? resp.team! : t)),
          resp.team.brand.teamId
        );
      }
      setAlertTitle('');
      setAlertBody('');
      setAlertBanner(
        publishToHub
          ? 'Posted to Team + Public Parent Hub ✓'
          : 'Posted Team Announcement ✓'
      );
    } catch {
      applyLocal();
    } finally {
      setPostingAlert(false);
    }
  };

  const handleDeleteAnnouncement = async (announcementId: string) => {
    if (!activeTeam) return;
    const applyLocal = () => {
      const updated: TeamSummaryWithRole = {
        ...activeTeam,
        announcements: (activeTeam.announcements || []).filter((a) => a.id !== announcementId),
      };
      onTeamsUpdated(
        myTeams.map((t) => (t.brand.teamId === updated.brand.teamId ? updated : t)),
        updated.brand.teamId
      );
    };
    try {
      const resp = await deleteTeamAnnouncementApi({
        teamId: activeTeam.brand.teamId,
        announcementId,
      });
      if (resp.teams && resp.teams.length > 0) {
        onTeamsUpdated(resp.teams, activeTeam.brand.teamId);
      } else {
        applyLocal();
      }
    } catch {
      applyLocal();
    }
  };

  const presentCount = useMemo(
    () =>
      athleteMembers.filter((m) => (attendanceMap[m.membershipId] || '') === 'PRESENT').length,
    [athleteMembers, attendanceMap]
  );

  return (
    <section
      data-testid="coach-daily-ops-panel"
      className="rounded-2xl liquid-glass p-3.5 sm:p-4 space-y-3"
    >
      {/* 3:15 PM Trackside Hero Row */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-ap-frame/15 dark:border-ap-edge-dark pb-3">
        <div>
          <div className="text-2xs font-mono uppercase tracking-wider text-ap-cobalt dark:text-ap-volt font-bold">
            Today&apos;s Practice Hub · {todayIso} ·{' '}
            {complexityTier === 'ESSENTIALS' ? 'Essentials Mode' : 'Pro Metrics Mode'}
          </div>
          <h2 className="text-sm sm:text-base font-extrabold text-ap-ink dark:text-ap-chalk">
            {activeTeam ? `${activeTeam.brand.name} Daily Ops` : 'Trackside Practice Ops'}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="daily-ops-launch-stopwatch"
            onClick={onLaunchStopwatch}
            className="ap-btn-primary !min-h-[44px] px-3.5 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Timer className="w-4 h-4" />
            <span>Launch Stopwatch</span>
          </button>
          <button
            type="button"
            data-testid="daily-ops-launch-field"
            onClick={onLaunchFieldSheet}
            className="ap-btn-secondary !min-h-[44px] px-3.5 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Target className="w-4 h-4 ap-text-brand" />
            <span>Field &amp; Multi Sheet</span>
          </button>
        </div>
      </div>

      {activeTeam && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* 1-Tap Roll Call / Attendance */}
          <div
            data-testid="coach-roll-call-panel"
            className="lg:col-span-6 rounded-xl ap-card-inset p-3 space-y-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <ClipboardText className="w-4 h-4 ap-text-brand" />
                <span className="text-xs font-bold text-ap-ink dark:text-ap-chalk">
                  1-Tap Roll Call ({presentCount}/{athleteMembers.length} Present)
                </span>
              </div>
              <button
                type="button"
                data-testid="roll-call-mark-all-btn"
                onClick={handleMarkAllPresent}
                className="min-h-[44px] sm:min-h-[34px] px-2.5 py-1 rounded-lg bg-ap-turf text-ap-volt text-2xs font-mono font-bold cursor-pointer"
              >
                Mark All Present
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search athlete..."
                className="flex-1 min-w-[140px] min-h-[44px] sm:min-h-[36px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-xs text-ap-ink dark:text-ap-chalk"
              />
              <select
                aria-label="Filter roll call by event group"
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value as CoachEventGroup | 'ALL')}
                className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 text-xs font-mono text-ap-ink dark:text-ap-chalk"
              >
                <option value="ALL">All Groups</option>
                <option value="SPRINTS">Sprints</option>
                <option value="HURDLES">Hurdles</option>
                <option value="DISTANCE">Distance</option>
                <option value="MID_DISTANCE">Mid-Dist</option>
                <option value="JUMPS">Jumps</option>
                <option value="POLE_VAULT">Pole Vault</option>
                <option value="THROWS">Throws</option>
                <option value="MULTI">Multi</option>
              </select>
            </div>

            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
              {visibleMembers.length === 0 ? (
                <div className="text-xs text-ap-muted dark:text-ap-muted-dark py-2">
                  No athletes on roster yet. Invite athletes via join code{' '}
                  <strong className="font-mono">{activeTeam.brand.joinCode}</strong>.
                </div>
              ) : (
                visibleMembers.map((m) => {
                  const status = attendanceMap[m.membershipId] || 'PRESENT';
                  return (
                    <div
                      key={m.membershipId}
                      data-testid={`roll-call-row-${m.membershipId}`}
                      className="rounded-lg bg-white dark:bg-ap-carbon border border-ap-frame/15 dark:border-ap-edge-dark px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold text-ap-ink dark:text-ap-chalk truncate">
                          {m.invitedName}
                        </span>
                        {m.eventGroup && (
                          <span className="ml-1.5 text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                            {m.eventGroup}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1 font-mono text-2xs">
                        {(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'] as const).map((code) => {
                          const active = status === code;
                          const short = code[0];
                          return (
                            <button
                              key={code}
                              type="button"
                              aria-label={`${m.invitedName} ${code}`}
                              aria-pressed={active}
                              onClick={() =>
                                setAttendanceMap((prev) => ({ ...prev, [m.membershipId]: code }))
                              }
                              className={`min-h-[44px] sm:min-h-[32px] min-w-[36px] px-2 rounded-lg font-bold cursor-pointer ${
                                active
                                  ? code === 'ABSENT'
                                    ? 'bg-rose-600 text-white'
                                    : code === 'LATE'
                                      ? 'bg-amber-500 text-ap-obsidian'
                                      : 'bg-ap-cobalt text-white dark:bg-ap-volt dark:text-ap-obsidian'
                                  : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark'
                              }`}
                            >
                              {short}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {visibleMembers.length > 0 && (
              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  data-testid="roll-call-save-btn"
                  disabled={savingAttendance}
                  onClick={() => void handleSaveAttendance()}
                  className="ap-btn-primary !min-h-[44px] sm:!min-h-[36px] px-3.5 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{savingAttendance ? 'Saving…' : 'Save Roll Call'}</span>
                </button>
                {attendanceBanner && (
                  <span
                    data-testid="roll-call-saved-banner"
                    className="text-2xs font-mono font-bold text-emerald-600 dark:text-emerald-400"
                  >
                    {attendanceBanner}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Weather & Practice Change Broadcasts */}
          <div
            data-testid="coach-announcements-panel"
            className="lg:col-span-6 rounded-xl ap-card-inset p-3 space-y-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Zap className="w-4 h-4 ap-text-brand" />
                <span className="text-xs font-bold text-ap-ink dark:text-ap-chalk">
                  Weather &amp; Practice Changes
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {QUICK_ALERT_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setAlertTitle(p.title);
                      setAlertBody(p.body);
                      setAlertCategory(p.category);
                      setAlertBanner(null);
                    }}
                    className="min-h-[36px] px-2 py-0.5 rounded-lg bg-white dark:bg-ap-carbon border border-ap-frame/20 dark:border-ap-edge-dark text-2xs font-mono font-semibold text-ap-ink dark:text-ap-chalk cursor-pointer"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={(e) => void handlePostAnnouncement(e)} className="space-y-2">
              <div className="flex gap-1.5">
                <input
                  type="text"
                  data-testid="announcement-title-input"
                  value={alertTitle}
                  onChange={(e) => setAlertTitle(e.target.value)}
                  placeholder="Alert headline (e.g. Track Practice Moved Inside)"
                  className="flex-1 min-h-[44px] sm:min-h-[36px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-xs font-semibold text-ap-ink dark:text-ap-chalk"
                />
                <select
                  aria-label="Alert category"
                  value={alertCategory}
                  onChange={(e) => setAlertCategory(e.target.value as TeamAnnouncementCategory)}
                  className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 text-xs font-mono text-ap-ink dark:text-ap-chalk"
                >
                  <option value="WEATHER">Weather</option>
                  <option value="SCHEDULE_CHANGE">Schedule</option>
                  <option value="MEET_LOGISTICS">Meet</option>
                  <option value="GENERAL">General</option>
                </select>
              </div>
              <textarea
                rows={2}
                data-testid="announcement-body-input"
                value={alertBody}
                onChange={(e) => setAlertBody(e.target.value)}
                placeholder="Write a 1-sentence update for athletes & parents..."
                className="w-full rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 py-1.5 text-xs text-ap-ink dark:text-ap-chalk"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 text-2xs font-mono text-ap-ink dark:text-ap-chalk cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="announcement-parent-hub-checkbox"
                    checked={publishToHub}
                    onChange={(e) => setPublishToHub(e.target.checked)}
                    className="w-4 h-4 accent-emerald-600"
                  />
                  <span>Pin to Public Parent Hub</span>
                </label>
                <button
                  type="submit"
                  data-testid="announcement-post-btn"
                  disabled={postingAlert || !alertTitle.trim() || !alertBody.trim()}
                  className="ap-btn-primary !min-h-[44px] sm:!min-h-[36px] px-3.5 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Bell className="w-3.5 h-3.5" />
                  <span>{postingAlert ? 'Posting…' : 'Post Alert'}</span>
                </button>
              </div>
            </form>

            {alertBanner && (
              <div
                data-testid="announcement-posted-banner"
                className="text-2xs font-mono font-bold text-emerald-600 dark:text-emerald-400"
              >
                {alertBanner}
              </div>
            )}

            {(activeTeam.announcements || []).length > 0 && (
              <div className="space-y-1.5 max-h-32 overflow-y-auto pr-0.5">
                {activeTeam.announcements!.slice(0, 3).map((ann) => (
                  <div
                    key={ann.id}
                    className="rounded-lg bg-white dark:bg-ap-carbon border border-ap-frame/15 dark:border-ap-edge-dark px-2.5 py-1.5 flex items-start justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-ap-ink dark:text-ap-chalk truncate">
                        [{ann.category}] {ann.title}
                      </div>
                      <p className="text-2xs text-ap-muted dark:text-ap-muted-dark line-clamp-2">
                        {ann.body}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Delete alert ${ann.title}`}
                      onClick={() => void handleDeleteAnnouncement(ann.id)}
                      className="p-1 text-rose-500 hover:text-rose-400 cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

export interface CoachAthleteSummaryDrawerProps {
  athlete: ConnectedAthleteRecord | null;
  activeTeam: TeamSummaryWithRole | null;
  onClose: () => void;
  onSwitchToProTelemetry: (athleteId: string) => void;
}

export const CoachAthleteSummaryDrawer: React.FC<CoachAthleteSummaryDrawerProps> = ({
  athlete,
  activeTeam,
  onClose,
  onSwitchToProTelemetry,
}) => {
  if (!athlete) return null;
  const checkIns = athlete.sessionCheckIns || [];
  const latest = checkIns.length > 0 ? checkIns[checkIns.length - 1] : null;
  const statusBadge =
    athlete.teamMemberStatus === 'INJURED' || latest?.painFlag
      ? 'ap-status-strained'
      : (latest?.rpe ?? 0) >= 8 || Boolean(latest?.lifeStressFlag)
        ? 'ap-status-caution'
        : 'ap-status-prime';
  const plainStatus =
    athlete.teamMemberStatus === 'INJURED' || latest?.painFlag
      ? `Pain Flag${latest?.painArea ? ` (${latest.painArea})` : ''} — Check In Before Speed/Pits`
      : (latest?.rpe ?? 0) >= 8 || Boolean(latest?.lifeStressFlag)
        ? 'Dial Back Intensity Today'
        : 'Cleared for Full Practice';

  const recentFieldMarks = (activeTeam?.fieldMarkLogs || [])
    .filter((f) => f.athleteName.toLowerCase() === athlete.name.toLowerCase())
    .slice(0, 3);

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="coach-athlete-essentials-drawer"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md rounded-2xl liquid-glass bg-white dark:bg-ap-obsidian border border-ap-edge p-4 sm:p-5 space-y-4 shadow-2xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-2xs font-mono uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark">
              Essentials Coach Summary
            </div>
            <h3 className="text-lg font-extrabold text-ap-ink dark:text-ap-chalk">
              {athlete.name}
            </h3>
            {athlete.eventGroup && (
              <span className="inline-block mt-0.5 px-2 py-0.5 rounded text-2xs font-mono ap-card-inset text-ap-ink dark:text-ap-chalk">
                {athlete.eventGroup}
              </span>
            )}
          </div>
          <button
            type="button"
            aria-label="Close athlete summary"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-xl ap-card-inset inline-flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className={`rounded-xl px-3.5 py-2.5 text-xs font-bold flex items-center gap-2 ${statusBadge}`}>
          <Activity className="w-4 h-4 shrink-0" />
          <span>{plainStatus}</span>
        </div>

        <div className="rounded-xl ap-card-inset p-3 space-y-1.5 text-xs">
          <div className="font-bold text-ap-ink dark:text-ap-chalk">Latest Athlete Check-In</div>
          {latest ? (
            <>
              <div className="font-mono text-2xs text-ap-muted dark:text-ap-muted-dark">
                {latest.date} · Effort {latest.rpe}/10 · Sleep Target {latest.sleepTargetHours ?? '—'}h
                {latest.workoutName ? ` · ${latest.workoutName}` : ''}
              </div>
              {latest.sorenessNote && (
                <p className="text-ap-ink dark:text-ap-chalk">&ldquo;{latest.sorenessNote}&rdquo;</p>
              )}
            </>
          ) : (
            <p className="text-ap-muted dark:text-ap-muted-dark">
              No daily check-in submitted yet this week.
            </p>
          )}
        </div>

        {recentFieldMarks.length > 0 && (
          <div className="rounded-xl ap-card-inset p-3 space-y-1.5 text-xs">
            <div className="font-bold text-ap-ink dark:text-ap-chalk">Recent Field / Multi Marks</div>
            {recentFieldMarks.map((m) => (
              <div key={m.id} className="flex items-center justify-between font-mono text-2xs">
                <span>
                  {m.date} · {m.eventCode}
                </span>
                <strong className="text-ap-cobalt dark:text-ap-volt">
                  {typeof m.multiPoints === 'number'
                    ? `${m.multiPoints} pts`
                    : m.bestMarkMeters
                      ? formatFieldMarkDual(m.bestMarkMeters)
                      : 'Logged'}
                </strong>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="ap-btn-secondary !min-h-[44px] px-4 py-2 text-xs font-bold cursor-pointer"
          >
            Done
          </button>
          <button
            type="button"
            data-testid="drawer-switch-pro-btn"
            onClick={() => onSwitchToProTelemetry(athlete.id)}
            className="ap-btn-primary !min-h-[44px] px-4 py-2 text-xs font-bold cursor-pointer"
          >
            Open Full Pro Telemetry →
          </button>
        </div>
      </div>
    </div>
  );
};
