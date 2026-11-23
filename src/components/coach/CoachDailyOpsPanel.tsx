import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bell,
  CheckCircle2,
  ClipboardText,
  Crosshair,
  Download,
  MapPin,
  Plus,
  Target,
  Timer,
  Trash2,
  X,
  Zap,
} from '../icons/PhosphorIcons';
import { useModalDialog } from '../../hooks/useModalDialog';
import {
  deleteTeamAnnouncementApi,
  postTeamAnnouncementApi,
  recordTeamAttendanceBatchApi,
  updateTeamPracticeVenuesApi,
} from '../../utils/teamLifecycleApi';
import { formatFieldMarkDual } from '../../physiology/fieldEventsEngine';
import type {
  CoachComplexityTier,
  CoachEventGroup,
  ConnectedAthleteRecord,
  PracticeVenueCategory,
  PracticeVenueGeofence,
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
  hideDuplicateLaunchers?: boolean;
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

function shiftLocalIsoDays(baseIso: string, deltaDays: number): string {
  const [y, m, d] = baseIso.split('-').map(Number);
  const dt = new Date(y || 2026, (m || 1) - 1, (d || 1) + deltaDays, 12, 0, 0);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function isDemoOpsTeamId(teamId?: string | null): boolean {
  if (!teamId) return false;
  return teamId.startsWith('demo_team_') || teamId.startsWith('demo-team-');
}

function formatAnnouncementCategoryLabel(category: TeamAnnouncementCategory): string {
  switch (category) {
    case 'MEET_LOGISTICS':
      return 'Meet Logistics';
    case 'SCHEDULE_CHANGE':
      return 'Schedule Change';
    case 'WEATHER':
      return 'Weather';
    default:
      return 'General';
  }
}

function escapeOpsCsvCell(value: unknown): string {
  const raw = String(value ?? '');
  const trimmed = raw.trimStart();
  const safe =
    trimmed.startsWith('=') ||
    trimmed.startsWith('+') ||
    trimmed.startsWith('-') ||
    trimmed.startsWith('@') ||
    trimmed.startsWith('\t') ||
    trimmed.startsWith('\r')
      ? `'${raw}`
      : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildAttendanceCsv(params: {
  dateIso: string;
  teamName: string;
  members: TeamSummaryWithRole['memberships'];
  attendanceByMember: Record<string, TeamAttendanceStatus>;
  savedRecords?: Record<string, TeamAttendanceRecord>;
  injuryCases?: TeamSummaryWithRole['injuryCases'];
}): string {
  const headers = [
    'Date',
    'Team',
    'Athlete',
    'Event Group',
    'Attendance Status',
    'AT RTP Stage',
    'Verified On Site',
    'Distance (m)',
    'Venue',
    'Method',
    'Note',
  ];
  const rtpByMember = new Map<string, string>();
  for (const c of params.injuryCases || []) {
    if (c.rtpStage !== 'CLEARED') rtpByMember.set(c.membershipId, c.rtpStage);
  }
  const rows = params.members.map((m) => {
    const rec = params.savedRecords?.[m.membershipId];
    const status = params.attendanceByMember[m.membershipId] || rec?.status || 'UNMARKED';
    return [
      params.dateIso,
      params.teamName,
      m.invitedName,
      m.eventGroup || '',
      status,
      rtpByMember.get(m.membershipId) || (m.status === 'INJURED' ? 'INJURED' : ''),
      rec?.verifiedOnSite ? 'Yes' : 'No',
      typeof rec?.distanceMeters === 'number' ? String(rec.distanceMeters) : '',
      rec?.venueName || '',
      rec?.method || '',
      rec?.note || '',
    ]
      .map(escapeOpsCsvCell)
      .join(',');
  });
  return [headers.map(escapeOpsCsvCell).join(','), ...rows].join('\n');
}

const VALID_ATTENDANCE_STATUSES = new Set<TeamAttendanceStatus>([
  'PRESENT',
  'LATE',
  'ABSENT',
  'EXCUSED',
  'INJURED_MODIFIED',
]);

export function buildExplicitAttendanceSaveEntries(params: {
  members: TeamSummaryWithRole['memberships'];
  attendanceMap: Record<string, TeamAttendanceStatus | undefined>;
}): Array<{ membershipId: string; status: TeamAttendanceStatus }> {
  const entries: Array<{ membershipId: string; status: TeamAttendanceStatus }> = [];
  for (const m of params.members) {
    const status = params.attendanceMap[m.membershipId];
    if (status && VALID_ATTENDANCE_STATUSES.has(status)) {
      entries.push({ membershipId: m.membershipId, status });
    }
  }
  return entries;
}

export function applyMarkAllPresentDraft(params: {
  visibleMembers: TeamSummaryWithRole['memberships'];
  attendanceMap: Record<string, TeamAttendanceStatus>;
  atRtpByMemberId: Map<string, 'OUT' | 'MODIFIED'>;
}): Record<string, TeamAttendanceStatus> {
  const next: Record<string, TeamAttendanceStatus> = { ...params.attendanceMap };
  for (const m of params.visibleMembers) {
    if (next[m.membershipId]) continue;
    const isInjured = m.status === 'INJURED' || params.atRtpByMemberId.has(m.membershipId);
    next[m.membershipId] = isInjured ? 'INJURED_MODIFIED' : 'PRESENT';
  }
  return next;
}

function readSavedAttendanceMap(
  team: TeamSummaryWithRole | null,
  dateIso: string
): Record<string, TeamAttendanceStatus> {
  const savedMap = team?.attendanceByDate?.[dateIso];
  const next: Record<string, TeamAttendanceStatus> = {};
  if (savedMap) {
    for (const rec of Object.values(savedMap)) {
      if (VALID_ATTENDANCE_STATUSES.has(rec.status)) {
        next[rec.membershipId] = rec.status;
      }
    }
  }
  return next;
}

export const CoachDailyOpsPanel: React.FC<CoachDailyOpsPanelProps> = ({
  activeTeam,
  myTeams,
  complexityTier,
  allowedEventGroups,
  hideDuplicateLaunchers = false,
  onLaunchStopwatch,
  onLaunchFieldSheet,
  onTeamsUpdated,
}) => {
  const todayIso = useMemo(() => todayLocalIso(), []);
  const minAttendanceDateIso = useMemo(() => shiftLocalIsoDays(todayIso, -45), [todayIso]);
  const [selectedDate, setSelectedDate] = useState<string>(todayIso);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [groupFilter, setGroupFilter] = useState<CoachEventGroup | 'ALL'>('ALL');
  const [attendanceMap, setAttendanceMap] = useState<Record<string, TeamAttendanceStatus>>(() =>
    readSavedAttendanceMap(activeTeam, todayIso)
  );
  const [showAllMembers, setShowAllMembers] = useState<boolean>(false);
  const autoSaveTimerRef = React.useRef<number | null>(null);
  const [savingAttendance, setSavingAttendance] = useState<boolean>(false);
  const [attendanceBanner, setAttendanceBanner] = useState<{
    text: string;
    tone: 'ok' | 'error';
  } | null>(null);

  const [alertTitle, setAlertTitle] = useState<string>('');
  const [alertBody, setAlertBody] = useState<string>('');
  const [alertCategory, setAlertCategory] = useState<TeamAnnouncementCategory>('WEATHER');
  const [publishToHub, setPublishToHub] = useState<boolean>(true);
  const [postingAlert, setPostingAlert] = useState<boolean>(false);
  const [alertBanner, setAlertBanner] = useState<{
    text: string;
    tone: 'ok' | 'error';
  } | null>(null);

  const [isVenueSetupOpen, setIsVenueSetupOpen] = useState<boolean>(false);
  const [venuesDraft, setVenuesDraft] = useState<PracticeVenueGeofence[]>(
    () => activeTeam?.brand.practiceVenues || []
  );
  const [newVenueName, setNewVenueName] = useState<string>('');
  const [newVenueCategory, setNewVenueCategory] = useState<PracticeVenueCategory>('TRACK');
  const [newVenueRadius, setNewVenueRadius] = useState<number>(250);
  const [newVenueLat, setNewVenueLat] = useState<string>('');
  const [newVenueLng, setNewVenueLng] = useState<string>('');
  const [newVenueEnabled, setNewVenueEnabled] = useState<boolean>(true);
  const [locatingVenue, setLocatingVenue] = useState<boolean>(false);
  const [savingVenues, setSavingVenues] = useState<boolean>(false);
  const [venueBanner, setVenueBanner] = useState<{
    text: string;
    tone: 'ok' | 'error';
  } | null>(null);

  useEffect(() => {
    setVenuesDraft(activeTeam?.brand.practiceVenues || []);
    setVenueBanner(null);
  }, [activeTeam?.brand.teamId, activeTeam?.brand.practiceVenues]);

  const athleteMembers = useMemo(() => {
    const members = (activeTeam?.memberships || []).filter(
      (m) => m.role === 'ATHLETE' && m.status !== 'REVOKED' && m.status !== 'ALUMNI'
    );
    if (allowedEventGroups && allowedEventGroups.length > 0) {
      const scoped = members.filter(
        (m) => !m.eventGroup || allowedEventGroups.includes(m.eventGroup)
      );
      return scoped.length > 0 ? scoped : members;
    }
    return members;
  }, [activeTeam?.memberships, allowedEventGroups]);

  const atRtpByMemberId = useMemo(() => {
    const map = new Map<string, 'OUT' | 'MODIFIED'>();
    for (const c of activeTeam?.injuryCases || []) {
      if (c.rtpStage === 'OUT' || c.rtpStage === 'MODIFIED') {
        map.set(c.membershipId, c.rtpStage);
      }
    }
    return map;
  }, [activeTeam?.injuryCases]);

  useEffect(() => {
    setAttendanceMap(readSavedAttendanceMap(activeTeam, selectedDate));
  }, [activeTeam, selectedDate]);

  const visibleMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return athleteMembers.filter((m) => {
      if (groupFilter !== 'ALL' && m.eventGroup !== groupFilter) return false;
      if (q && !m.invitedName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [athleteMembers, groupFilter, searchQuery]);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  const persistAttendanceMap = async (
    targetMap: Record<string, TeamAttendanceStatus>,
    opts?: { isAutoSave?: boolean }
  ) => {
    if (!activeTeam) return;
    const entries = buildExplicitAttendanceSaveEntries({
      members: athleteMembers,
      attendanceMap: targetMap,
    });
    if (entries.length === 0) {
      if (!opts?.isAutoSave) {
        setAttendanceBanner({
          text: 'Mark at least one athlete (or tap Mark All Present) before saving roll call.',
          tone: 'error',
        });
      }
      return;
    }
    const unmarkedAtSave = Math.max(0, athleteMembers.length - entries.length);
    const savedSummaryText = `${opts?.isAutoSave ? 'Auto-saved' : 'Saved'} roll call for ${entries.length} marked athlete${
      entries.length === 1 ? '' : 's'
    } (${selectedDate})${unmarkedAtSave > 0 ? ` · ${unmarkedAtSave} unmarked` : ''} ✓`;

    const applyLocal = () => {
      const existing = activeTeam.attendanceByDate || {};
      const nextByMember: Record<string, TeamAttendanceRecord> = {
        ...(existing[selectedDate] || {}),
      };
      for (const e of entries) {
        const prev = nextByMember[e.membershipId];
        const keepGps =
          prev?.method === 'GPS_GEOFENCE' && (e.status === 'PRESENT' || e.status === 'LATE');
        nextByMember[e.membershipId] = {
          date: selectedDate,
          membershipId: e.membershipId,
          status: e.status,
          ...(keepGps
            ? {
                checkedInAt: prev.checkedInAt,
                verifiedOnSite: prev.verifiedOnSite,
                distanceMeters: prev.distanceMeters,
                venueId: prev.venueId,
                venueName: prev.venueName,
                method: 'GPS_GEOFENCE' as const,
              }
            : { method: 'COACH_MANUAL' as const }),
          updatedAt: new Date().toISOString(),
        };
      }
      const updated: TeamSummaryWithRole = {
        ...activeTeam,
        attendanceByDate: { ...existing, [selectedDate]: nextByMember },
      };
      onTeamsUpdated(
        myTeams.map((t) => (t.brand.teamId === updated.brand.teamId ? updated : t)),
        updated.brand.teamId
      );
      setAttendanceBanner({
        text: savedSummaryText,
        tone: 'ok',
      });
    };

    if (isDemoOpsTeamId(activeTeam.brand.teamId)) {
      applyLocal();
      return;
    }

    setSavingAttendance(true);
    if (!opts?.isAutoSave) setAttendanceBanner(null);
    try {
      const resp = await recordTeamAttendanceBatchApi({
        teamId: activeTeam.brand.teamId,
        date: selectedDate,
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
      setAttendanceBanner({
        text: savedSummaryText,
        tone: 'ok',
      });
    } catch (err) {
      setAttendanceBanner({
        text: err instanceof Error ? err.message : 'Unable to save attendance roll call.',
        tone: 'error',
      });
    } finally {
      setSavingAttendance(false);
    }
  };

  const scheduleAutoSaveAttendance = (nextMap: Record<string, TeamAttendanceStatus>) => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      void persistAttendanceMap(nextMap, { isAutoSave: true });
    }, 600);
  };

  const handleMarkAllPresent = () => {
    const nextMap = applyMarkAllPresentDraft({
      visibleMembers,
      attendanceMap,
      atRtpByMemberId,
    });
    setAttendanceMap(nextMap);
    setAttendanceBanner(null);
    scheduleAutoSaveAttendance(nextMap);
  };

  const handleExportAttendanceCsv = () => {
    if (!activeTeam) return;
    const csv = buildAttendanceCsv({
      dateIso: selectedDate,
      teamName: activeTeam.brand.shortName || activeTeam.brand.name,
      members: visibleMembers,
      attendanceByMember: attendanceMap,
      savedRecords: activeTeam.attendanceByDate?.[selectedDate],
      injuryCases: activeTeam.injuryCases,
    });
    const slug = (activeTeam.brand.slug || activeTeam.brand.shortName || 'team')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${slug}-attendance-${selectedDate}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setAttendanceBanner({
      text: `Exported attendance CSV for ${selectedDate} (${visibleMembers.length} athletes).`,
      tone: 'ok',
    });
  };

  const handleSaveAttendance = async () => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    await persistAttendanceMap(attendanceMap, { isAutoSave: false });
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
      setAlertBanner({ text: 'Team alert posted ✓', tone: 'ok' });
    };

    if (isDemoOpsTeamId(activeTeam.brand.teamId)) {
      applyLocal();
      return;
    }

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
      setAlertBanner({
        text: publishToHub
          ? 'Posted to Team + Public Parent Hub ✓'
          : 'Posted Team Announcement ✓',
        tone: 'ok',
      });
    } catch (err) {
      setAlertBanner({
        text: err instanceof Error ? err.message : 'Unable to post team alert.',
        tone: 'error',
      });
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
    if (isDemoOpsTeamId(activeTeam.brand.teamId)) {
      applyLocal();
      return;
    }
    try {
      const resp = await deleteTeamAnnouncementApi({
        teamId: activeTeam.brand.teamId,
        announcementId,
      });
      if (resp.teams && resp.teams.length > 0) {
        onTeamsUpdated(resp.teams, activeTeam.brand.teamId);
      } else if (resp.team) {
        onTeamsUpdated(
          myTeams.map((t) => (t.brand.teamId === resp.team!.brand.teamId ? resp.team! : t)),
          resp.team.brand.teamId
        );
      }
    } catch (err) {
      setAlertBanner({
        text: err instanceof Error ? err.message : 'Unable to delete team alert.',
        tone: 'error',
      });
    }
  };

  const presentCount = useMemo(
    () =>
      athleteMembers.filter((m) => (attendanceMap[m.membershipId] || '') === 'PRESENT').length,
    [athleteMembers, attendanceMap]
  );
  const markedCount = useMemo(
    () =>
      athleteMembers.filter((m) => {
        const st = attendanceMap[m.membershipId];
        return Boolean(st && VALID_ATTENDANCE_STATUSES.has(st));
      }).length,
    [athleteMembers, attendanceMap]
  );
  const unmarkedCount = Math.max(0, athleteMembers.length - markedCount);

  const canManageVenues =
    activeTeam?.myRole === 'HEAD_COACH' ||
    activeTeam?.myRole === 'ASSISTANT_COACH' ||
    activeTeam?.myRole === 'ORG_ADMIN';

  const persistPracticeVenues = async (nextVenues: PracticeVenueGeofence[]) => {
    if (!activeTeam) return;
    setVenuesDraft(nextVenues);
    setSavingVenues(true);
    setVenueBanner(null);

    const applyLocal = (saved: PracticeVenueGeofence[]) => {
      const updatedTeam: TeamSummaryWithRole = {
        ...activeTeam,
        brand: { ...activeTeam.brand, practiceVenues: saved },
      };
      onTeamsUpdated(
        myTeams.map((t) => (t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t)),
        updatedTeam.brand.teamId
      );
      setVenueBanner({
        text: `Saved ${saved.length} practice venue${saved.length === 1 ? '' : 's'} ✓`,
        tone: 'ok',
      });
    };

    if (isDemoOpsTeamId(activeTeam.brand.teamId)) {
      applyLocal(nextVenues);
      setSavingVenues(false);
      return;
    }

    try {
      const resp = await updateTeamPracticeVenuesApi({
        teamId: activeTeam.brand.teamId,
        practiceVenues: nextVenues,
      });
      if (resp.teams && resp.teams.length > 0) {
        onTeamsUpdated(resp.teams, activeTeam.brand.teamId);
      } else if (resp.team) {
        onTeamsUpdated(
          myTeams.map((t) => (t.brand.teamId === resp.team!.brand.teamId ? resp.team! : t)),
          resp.team.brand.teamId
        );
      }
      setVenueBanner({
        text: `Saved ${(resp.practiceVenues || nextVenues).length} practice venue${
          (resp.practiceVenues || nextVenues).length === 1 ? '' : 's'
        } ✓`,
        tone: 'ok',
      });
    } catch (err) {
      setVenueBanner({
        text: err instanceof Error ? err.message : 'Unable to save practice venues.',
        tone: 'error',
      });
    } finally {
      setSavingVenues(false);
    }
  };

  const handleUseCurrentLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setVenueBanner({ text: 'Browser geolocation is unavailable.', tone: 'error' });
      return;
    }
    setLocatingVenue(true);
    setVenueBanner(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setNewVenueLat(pos.coords.latitude.toFixed(6));
        setNewVenueLng(pos.coords.longitude.toFixed(6));
        setLocatingVenue(false);
      },
      (err) => {
        setLocatingVenue(false);
        setVenueBanner({
          text: err?.message || 'Unable to read current GPS location.',
          tone: 'error',
        });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const handleAddVenue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTeam || venuesDraft.length >= 8) return;
    const cleanName = newVenueName.trim().slice(0, 64);
    const lat = Number(newVenueLat);
    const lng = Number(newVenueLng);
    if (
      !cleanName ||
      newVenueLat.trim() === '' ||
      newVenueLng.trim() === '' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      setVenueBanner({
        text: 'Enter a venue name and valid coordinates (or click Use My Current Location).',
        tone: 'error',
      });
      return;
    }
    const added: PracticeVenueGeofence = {
      id: `venue_${Date.now().toString(36)}`,
      name: cleanName,
      category: newVenueCategory,
      latitude: lat,
      longitude: lng,
      radiusMeters: newVenueRadius,
      enabled: newVenueEnabled,
    };
    const nextVenues = [...venuesDraft, added].slice(0, 8);
    setNewVenueName('');
    await persistPracticeVenues(nextVenues);
  };

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

        {!hideDuplicateLaunchers && (
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
        )}
      </div>

      {activeTeam && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* 1-Tap Roll Call / Attendance */}
          <div
            data-testid="coach-roll-call-panel"
            className="lg:col-span-6 rounded-xl ap-card-inset p-3 space-y-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <ClipboardText className="w-4 h-4 ap-text-brand" />
                <span className="text-xs font-bold text-ap-ink dark:text-ap-chalk">
                  1-Tap Roll Call ({presentCount}/{athleteMembers.length} Present)
                </span>
                <span
                  data-testid="roll-call-counts"
                  className="px-2 py-0.5 rounded-md bg-white dark:bg-ap-carbon border border-ap-frame/15 dark:border-ap-edge-dark font-mono text-2xs font-semibold text-ap-muted dark:text-ap-muted-dark tabular-nums"
                >
                  {markedCount} marked · {unmarkedCount} unmarked
                </span>
                <input
                  type="date"
                  data-testid="attendance-date-picker"
                  aria-label="Attendance roll call date"
                  value={selectedDate}
                  min={minAttendanceDateIso}
                  max={todayIso}
                  onChange={(e) => {
                    if (e.target.value) {
                      setSelectedDate(e.target.value);
                      setAttendanceBanner(null);
                    }
                  }}
                  className="min-h-[44px] sm:min-h-[34px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 text-2xs font-mono text-ap-ink dark:text-ap-chalk"
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  data-testid="attendance-export-csv-btn"
                  onClick={handleExportAttendanceCsv}
                  className="min-h-[44px] sm:min-h-[34px] px-2.5 py-1 rounded-lg ap-btn-secondary text-2xs font-mono font-bold inline-flex items-center gap-1 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export CSV</span>
                </button>
                <button
                  type="button"
                  data-testid="roll-call-mark-all-btn"
                  onClick={handleMarkAllPresent}
                  className="min-h-[44px] sm:min-h-[34px] px-2.5 py-1 rounded-lg bg-ap-turf text-ap-volt text-2xs font-mono font-bold cursor-pointer"
                >
                  Mark All Present
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <input
                type="search"
                aria-label="Search roster athlete"
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

            <div className="space-y-1.5 sm:max-h-80 sm:overflow-y-auto pr-0.5">
              {visibleMembers.length === 0 ? (
                <div className="text-xs text-ap-muted dark:text-ap-muted-dark py-2">
                  No athletes on roster yet. Invite athletes via join code{' '}
                  <strong className="font-mono">{activeTeam.brand.joinCode}</strong>.
                </div>
              ) : (
                (showAllMembers ? visibleMembers : visibleMembers.slice(0, 25)).map((m) => {
                  const status = attendanceMap[m.membershipId];
                  const todayRec = activeTeam.attendanceByDate?.[selectedDate]?.[m.membershipId];
                  const atRtpStage = atRtpByMemberId.get(m.membershipId);
                  const showGpsPill = Boolean(
                    todayRec?.verifiedOnSite &&
                      todayRec?.method === 'GPS_GEOFENCE' &&
                      (status === 'PRESENT' || status === 'LATE')
                  );
                  return (
                    <div
                      key={m.membershipId}
                      data-testid={`roll-call-row-${m.membershipId}`}
                      className="rounded-lg bg-white dark:bg-ap-carbon border border-ap-frame/15 dark:border-ap-edge-dark px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-ap-ink dark:text-ap-chalk truncate">
                          {m.invitedName}
                        </span>
                        {m.eventGroup && (
                          <span className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                            {m.eventGroup}
                          </span>
                        )}
                        {atRtpStage && (
                          <span
                            data-testid={`roll-call-at-badge-${m.membershipId}`}
                            className={`px-1.5 py-0.5 rounded font-mono text-2xs font-bold ${
                              atRtpStage === 'OUT' ? 'ap-status-strained' : 'ap-status-caution'
                            }`}
                          >
                            AT {atRtpStage}
                          </span>
                        )}
                        {!atRtpStage && m.status === 'INJURED' && (
                          <span
                            data-testid={`roll-call-at-badge-${m.membershipId}`}
                            className="px-1.5 py-0.5 rounded font-mono text-2xs font-bold ap-status-caution"
                          >
                            INJURED
                          </span>
                        )}
                        {showGpsPill && (
                          <span
                            data-testid={`roll-call-gps-pill-${m.membershipId}`}
                            title={
                              todayRec?.venueName
                                ? `Verified at ${todayRec.venueName} (${todayRec.distanceMeters ?? 0}m)`
                                : 'Verified on-site GPS check-in'
                            }
                            className="px-1.5 py-0.5 rounded bg-emerald-600/15 text-emerald-700 dark:bg-ap-volt/15 dark:text-ap-volt font-mono text-2xs font-bold"
                          >
                            GPS ✓ · {todayRec?.distanceMeters ?? 0}m
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 font-mono text-2xs">
                        {(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED', 'INJURED_MODIFIED'] as const).map((code) => {
                          const active = status === code;
                          const short = code === 'INJURED_MODIFIED' ? 'MOD' : code[0];
                          return (
                            <button
                              key={code}
                              type="button"
                              aria-label={`${m.invitedName} ${code}`}
                              aria-pressed={active}
                              title={code === 'INJURED_MODIFIED' ? 'Injured / Modified Practice' : code}
                              onClick={() => {
                                const nextMap = { ...attendanceMap, [m.membershipId]: code };
                                setAttendanceMap(nextMap);
                                scheduleAutoSaveAttendance(nextMap);
                              }}
                              className={`min-h-[44px] sm:min-h-[32px] min-w-[36px] px-2 rounded-lg font-bold cursor-pointer ${
                                active
                                  ? code === 'ABSENT'
                                    ? 'bg-rose-600 text-white'
                                    : code === 'LATE'
                                      ? 'bg-amber-500 text-ap-obsidian'
                                      : code === 'INJURED_MODIFIED'
                                        ? 'bg-ap-clay text-white'
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

            {visibleMembers.length > 25 && (
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  onClick={() => setShowAllMembers((prev) => !prev)}
                  className="min-h-[38px] px-3 py-1 rounded-lg ap-card-inset text-2xs font-mono font-bold cursor-pointer"
                >
                  {showAllMembers
                    ? 'Show First 25 Athletes'
                    : `Show All ${visibleMembers.length} Athletes`}
                </button>
              </div>
            )}

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
                    className={`text-2xs font-mono font-bold ${
                      attendanceBanner.tone === 'error'
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {attendanceBanner.text}
                  </span>
                )}
              </div>
            )}

            {canManageVenues && (
              <div className="border-t border-ap-frame/15 dark:border-ap-edge-dark pt-2 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    data-testid="practice-venues-toggle-btn"
                    aria-expanded={isVenueSetupOpen}
                    onClick={() => setIsVenueSetupOpen((prev) => !prev)}
                    className="min-h-[44px] sm:min-h-[36px] px-2.5 py-1 rounded-lg bg-white dark:bg-ap-carbon border border-ap-frame/20 dark:border-ap-edge-dark text-2xs font-mono font-bold text-ap-ink dark:text-ap-chalk inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <MapPin className="w-3.5 h-3.5 ap-text-brand" />
                    <span>
                      Practice Venue Geofences ({venuesDraft.filter((v) => v.enabled).length}/{venuesDraft.length})
                    </span>
                  </button>
                  {venueBanner && (
                    <span
                      className={`text-2xs font-mono font-semibold ${
                        venueBanner.tone === 'error'
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-700 dark:text-emerald-300'
                      }`}
                    >
                      {venueBanner.text}
                    </span>
                  )}
                </div>

                {isVenueSetupOpen && (
                  <div
                    data-testid="practice-venues-panel"
                    className="rounded-xl bg-white/80 dark:bg-ap-carbon/80 border border-ap-frame/20 dark:border-ap-edge-dark p-2.5 space-y-2.5"
                  >
                    <p className="text-2xs text-ap-muted dark:text-ap-muted-dark">
                      Facility pin only — athletes verify distance once on tap without storing GPS coordinates.
                    </p>

                    {venuesDraft.length > 0 && (
                      <div className="space-y-1.5">
                        {venuesDraft.map((v) => (
                          <div
                            key={v.id}
                            className="rounded-lg border border-ap-frame/15 dark:border-ap-edge-dark px-2 py-1.5 flex flex-wrap items-center justify-between gap-2 text-2xs"
                          >
                            <div className="min-w-0">
                              <span className="font-bold text-ap-ink dark:text-ap-chalk">
                                {v.name}
                              </span>
                              <span className="ml-1.5 font-mono text-ap-muted dark:text-ap-muted-dark">
                                {v.category}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <select
                                aria-label={`Radius for ${v.name}`}
                                value={v.radiusMeters}
                                onChange={(e) => {
                                  const nextRadius = Number(e.target.value) || 250;
                                  void persistPracticeVenues(
                                    venuesDraft.map((item) =>
                                      item.id === v.id ? { ...item, radiusMeters: nextRadius } : item
                                    )
                                  );
                                }}
                                className="min-h-[44px] sm:min-h-[32px] rounded-md border border-ap-frame/20 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-1.5 font-mono text-2xs"
                              >
                                <option value={100}>100m</option>
                                <option value={250}>250m</option>
                                <option value={500}>500m</option>
                              </select>
                              <label className="inline-flex items-center gap-1 font-mono cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={v.enabled}
                                  onChange={(e) =>
                                    void persistPracticeVenues(
                                      venuesDraft.map((item) =>
                                        item.id === v.id
                                          ? { ...item, enabled: e.target.checked }
                                          : item
                                      )
                                    )
                                  }
                                  className="w-3.5 h-3.5 accent-emerald-600"
                                />
                                <span>On</span>
                              </label>
                              <button
                                type="button"
                                aria-label={`Remove venue ${v.name}`}
                                onClick={() =>
                                  void persistPracticeVenues(
                                    venuesDraft.filter((item) => item.id !== v.id)
                                  )
                                }
                                className="min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] inline-flex items-center justify-center p-1 text-rose-500 hover:text-rose-400 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {venuesDraft.length < 8 && (
                      <form onSubmit={(e) => void handleAddVenue(e)} className="space-y-2">
                        <div className="flex flex-wrap gap-1.5">
                          <input
                            type="text"
                            data-testid="venue-name-input"
                            aria-label="Practice venue name"
                            value={newVenueName}
                            onChange={(e) => setNewVenueName(e.target.value)}
                            placeholder="Venue name (e.g. Campus Track)"
                            className="flex-1 min-w-[140px] min-h-[44px] sm:min-h-[36px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2 text-xs text-ap-ink dark:text-ap-chalk"
                          />
                          <select
                            data-testid="venue-category-select"
                            aria-label="Venue category"
                            value={newVenueCategory}
                            onChange={(e) =>
                              setNewVenueCategory(e.target.value as PracticeVenueCategory)
                            }
                            className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2 text-xs font-mono"
                          >
                            <option value="TRACK">Track</option>
                            <option value="XC_COURSE">XC Course</option>
                            <option value="ROAD_CAMPUS">Road / Campus</option>
                            <option value="GYM_WEIGHTS">Gym / Weights</option>
                            <option value="POOL_CROSS">Pool / Cross</option>
                            <option value="OTHER">Other</option>
                          </select>
                          <select
                            data-testid="venue-radius-select"
                            aria-label="Geofence radius"
                            value={newVenueRadius}
                            onChange={(e) => setNewVenueRadius(Number(e.target.value) || 250)}
                            className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2 text-xs font-mono"
                          >
                            <option value={100}>100m</option>
                            <option value={250}>250m</option>
                            <option value={500}>500m</option>
                          </select>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            data-testid="venue-use-current-location-btn"
                            disabled={locatingVenue}
                            onClick={handleUseCurrentLocation}
                            className="min-h-[44px] sm:min-h-[36px] px-2.5 py-1 rounded-lg ap-btn-secondary text-2xs font-mono font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          >
                            <Crosshair className="w-3.5 h-3.5 ap-text-brand" />
                            <span>
                              {locatingVenue ? 'Locating…' : 'Use My Current Location'}
                            </span>
                          </button>
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label="Venue latitude"
                            value={newVenueLat}
                            onChange={(e) => setNewVenueLat(e.target.value)}
                            placeholder="Lat"
                            className="w-24 min-h-[44px] sm:min-h-[36px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2 text-2xs font-mono"
                          />
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label="Venue longitude"
                            value={newVenueLng}
                            onChange={(e) => setNewVenueLng(e.target.value)}
                            placeholder="Lng"
                            className="w-24 min-h-[44px] sm:min-h-[36px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2 text-2xs font-mono"
                          />
                          <label className="inline-flex items-center gap-1 text-2xs font-mono cursor-pointer">
                            <input
                              type="checkbox"
                              data-testid="venue-enabled-checkbox"
                              checked={newVenueEnabled}
                              onChange={(e) => setNewVenueEnabled(e.target.checked)}
                              className="w-3.5 h-3.5 accent-emerald-600"
                            />
                            <span>Enabled</span>
                          </label>
                          <button
                            type="submit"
                            data-testid="venue-save-btn"
                            disabled={savingVenues}
                            className="min-h-[44px] sm:min-h-[36px] px-3 py-1 rounded-lg bg-ap-turf text-ap-volt text-2xs font-mono font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>{savingVenues ? 'Saving…' : 'Add Venue'}</span>
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
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
                      setAlertBanner({ text: 'Quick preset loaded into editor.', tone: 'ok' });
                    }}
                    className="min-h-[44px] sm:min-h-[36px] px-2 py-0.5 rounded-lg bg-white dark:bg-ap-carbon border border-ap-frame/20 dark:border-ap-edge-dark text-2xs font-mono font-semibold text-ap-ink dark:text-ap-chalk cursor-pointer"
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
                  aria-label="Team alert headline"
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
                  <option value="SCHEDULE_CHANGE">Schedule Change</option>
                  <option value="MEET_LOGISTICS">Meet Logistics</option>
                  <option value="GENERAL">General</option>
                </select>
              </div>
              <textarea
                rows={2}
                data-testid="announcement-body-input"
                aria-label="Team alert message"
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
                className={`text-2xs font-mono font-bold ${
                  alertBanner.tone === 'error'
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {alertBanner.text}
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
                        [{formatAnnouncementCategoryLabel(ann.category)}] {ann.title}
                      </div>
                      <p className="text-2xs text-ap-muted dark:text-ap-muted-dark line-clamp-2">
                        {ann.body}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Delete alert ${ann.title}`}
                      onClick={() => void handleDeleteAnnouncement(ann.id)}
                      className="min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] inline-flex items-center justify-center p-1 text-rose-500 hover:text-rose-400 cursor-pointer shrink-0"
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
  const drawerDialogRef = useRef<HTMLDivElement | null>(null);
  const drawerHeadingId = useId();
  useModalDialog({
    isOpen: Boolean(athlete),
    onClose,
    dialogRef: drawerDialogRef,
  });

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
      ref={drawerDialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={drawerHeadingId}
      tabIndex={-1}
      data-testid="coach-athlete-essentials-drawer"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md rounded-2xl liquid-glass bg-white dark:bg-ap-obsidian border border-ap-edge p-4 sm:p-5 space-y-4 shadow-2xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-2xs font-mono uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark">
              Essentials Coach Summary
            </div>
            <h3 id={drawerHeadingId} className="text-lg font-extrabold text-ap-ink dark:text-ap-chalk">
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
