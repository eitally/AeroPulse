import crypto from 'crypto';
import type {
  CoachEventGroup,
  FieldEventCode,
  FieldEventLogRecord,
  FieldTrialEntry,
  TeamAnnouncementCategory,
  TeamAnnouncementRecord,
  TeamAttendanceRecord,
  TeamAttendanceStatus,
  TeamSummaryWithRole,
  UnifiedActivity,
} from '../src/types.ts';
import {
  getFieldEventSpec,
  summarizeFieldSeries,
} from '../src/physiology/fieldEventsEngine.ts';
import {
  canManageTeamGovernanceRole,
  canProgramWorkoutsRole,
  canViewSafeguardingMedicalRole,
  loadTeamDocRaw,
  projectTeamSummaryForCaller,
  sanitizeTargetEventGroups,
  saveTeamDocRaw,
} from './teamStoreCore.ts';
import { appendAuditLogAsync, withTeamRowLock } from './tokenVault.ts';

const VALID_ATTENDANCE_STATUSES = new Set<TeamAttendanceStatus>([
  'PRESENT',
  'LATE',
  'EXCUSED',
  'ABSENT',
  'INJURED_MODIFIED',
]);

const VALID_ANNOUNCEMENT_CATEGORIES = new Set<TeamAnnouncementCategory>([
  'WEATHER',
  'SCHEDULE_CHANGE',
  'MEET_LOGISTICS',
  'GENERAL',
]);

const VALID_FIELD_EVENT_CODES = new Set<FieldEventCode>([
  'LJ',
  'TJ',
  'HJ',
  'PV',
  'SP',
  'DISCUS',
  'JAVELIN',
  'HAMMER',
  'PENT',
  'HEPT',
  'DEC',
]);

export async function recordTeamAttendanceBatch(params: {
  callerSid: string;
  teamId: string;
  date: string;
  entries: Array<{
    membershipId: string;
    status: TeamAttendanceStatus;
    note?: string;
  }>;
  originUrl: string;
}): Promise<{ ok: boolean; recordedCount: number; team?: TeamSummaryWithRole | null; error?: string }> {
  const cleanDate = String(params.date || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    return { ok: false, recordedCount: 0, error: 'Valid YYYY-MM-DD attendance date required.' };
  }

  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, recordedCount: 0, error: 'Team not found.' };

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem || !canViewSafeguardingMedicalRole(callerMem.role)) {
      return { ok: false, recordedCount: 0, error: 'Coach or Athletic Trainer permissions required.' };
    }

    const nowIso = new Date().toISOString();
    doc.attendanceByDate = doc.attendanceByDate || {};
    const dayBucket: Record<string, TeamAttendanceRecord> = {
      ...(doc.attendanceByDate[cleanDate] || {}),
    };

    let recordedCount = 0;
    for (const rawEntry of (params.entries || []).slice(0, 450)) {
      const memId = String(rawEntry.membershipId || '').trim();
      const status = String(rawEntry.status || '').trim().toUpperCase() as TeamAttendanceStatus;
      if (!memId || !VALID_ATTENDANCE_STATUSES.has(status)) continue;
      const targetMem = doc.memberships.find(
        (m) => m.membershipId === memId && m.status !== 'REVOKED'
      );
      if (!targetMem) continue;

      dayBucket[memId] = {
        date: cleanDate,
        membershipId: memId,
        status,
        ...(rawEntry.note ? { note: String(rawEntry.note).trim().slice(0, 140) } : {}),
        updatedAt: nowIso,
        updatedBySid: params.callerSid,
      };
      recordedCount += 1;
    }

    doc.attendanceByDate[cleanDate] = dayBucket;
    // Keep most recent 45 dates bounded in storage
    const allDates = Object.keys(doc.attendanceByDate).sort();
    if (allDates.length > 45) {
      for (const oldKey of allDates.slice(0, allDates.length - 45)) {
        delete doc.attendanceByDate[oldKey];
      }
    }

    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'ATTENDANCE_RECORDED',
      targetId: cleanDate,
      metadata: { recordedCount },
    });

    return {
      ok: true,
      recordedCount,
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}

export async function postTeamAnnouncement(params: {
  callerSid: string;
  teamId: string;
  title: string;
  body: string;
  category?: TeamAnnouncementCategory;
  targetEventGroups?: CoachEventGroup[];
  publishToParentHub?: boolean;
  originUrl: string;
}): Promise<{
  ok: boolean;
  announcement?: TeamAnnouncementRecord;
  team?: TeamSummaryWithRole | null;
  error?: string;
}> {
  const cleanTitle = String(params.title || '').trim().slice(0, 120);
  const cleanBody = String(params.body || '').trim().slice(0, 600);
  if (!cleanTitle || !cleanBody) {
    return { ok: false, error: 'Announcement title and message body are required.' };
  }
  const catRaw = String(params.category || 'GENERAL').toUpperCase() as TeamAnnouncementCategory;
  const category: TeamAnnouncementCategory = VALID_ANNOUNCEMENT_CATEGORIES.has(catRaw)
    ? catRaw
    : 'GENERAL';

  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: 'Team not found.' };

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem || (!canProgramWorkoutsRole(callerMem.role) && callerMem.role !== 'ORG_ADMIN')) {
      return { ok: false, error: 'Coach or admin permissions required.' };
    }

    const nowIso = new Date().toISOString();
    const targetGroups = sanitizeTargetEventGroups(params.targetEventGroups);
    const announcement: TeamAnnouncementRecord = {
      id: `ann_${crypto.randomBytes(6).toString('hex')}`,
      teamId: doc.brand.teamId,
      title: cleanTitle,
      body: cleanBody,
      category,
      ...(targetGroups && targetGroups.length > 0 ? { targetEventGroups: targetGroups } : {}),
      publishToParentHub: params.publishToParentHub !== false,
      authorName: callerMem.invitedName || doc.brand.coachDisplayName || 'Coach',
      createdAt: nowIso,
    };

    doc.announcements = [announcement, ...(doc.announcements || [])].slice(0, 30);
    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'ANNOUNCEMENT_POSTED',
      targetId: announcement.id,
      metadata: {
        category: announcement.category,
        publishToParentHub: announcement.publishToParentHub,
      },
    });

    return {
      ok: true,
      announcement,
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}

export async function deleteTeamAnnouncement(params: {
  callerSid: string;
  teamId: string;
  announcementId: string;
  originUrl: string;
}): Promise<{ ok: boolean; team?: TeamSummaryWithRole | null; error?: string }> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: 'Team not found.' };

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem || (!canProgramWorkoutsRole(callerMem.role) && callerMem.role !== 'ORG_ADMIN')) {
      return { ok: false, error: 'Coach or admin permissions required.' };
    }

    const beforeCount = (doc.announcements || []).length;
    doc.announcements = (doc.announcements || []).filter((a) => a.id !== params.announcementId);
    if (doc.announcements.length === beforeCount) {
      return { ok: false, error: 'Announcement not found.' };
    }

    doc.updatedAt = new Date().toISOString();
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'ANNOUNCEMENT_DELETED',
      targetId: params.announcementId,
      metadata: {},
    });

    return {
      ok: true,
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}

export async function recordTeamFieldMarks(params: {
  callerSid: string;
  teamId: string;
  entries: Array<{
    membershipId?: string;
    athleteName: string;
    date: string;
    eventCode: FieldEventCode;
    isCompetition?: boolean;
    meetOrPracticeTitle?: string;
    implementSpec?: string;
    poleSpec?: string;
    approachSteps?: number;
    attempts: FieldTrialEntry[];
    multiPoints?: number;
    rpe?: number;
  }>;
  originUrl: string;
}): Promise<{ ok: boolean; recordedCount: number; team?: TeamSummaryWithRole | null; error?: string }> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, recordedCount: 0, error: 'Team not found.' };

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem || (!canProgramWorkoutsRole(callerMem.role) && callerMem.role !== 'ORG_ADMIN')) {
      return { ok: false, recordedCount: 0, error: 'Coach permissions required.' };
    }

    const nowIso = new Date().toISOString();
    doc.fieldMarkLogs = doc.fieldMarkLogs || [];
    let recordedCount = 0;

    for (const rawEntry of (params.entries || []).slice(0, 60)) {
      const code = String(rawEntry.eventCode || '').toUpperCase() as FieldEventCode;
      if (!VALID_FIELD_EVENT_CODES.has(code)) continue;
      const spec = getFieldEventSpec(code);
      const cleanDate = /^\d{4}-\d{2}-\d{2}$/.test(String(rawEntry.date || ''))
        ? String(rawEntry.date).slice(0, 10)
        : nowIso.slice(0, 10);
      const cleanAttempts = Array.isArray(rawEntry.attempts)
        ? rawEntry.attempts.slice(0, 24)
        : [];
      const summary = summarizeFieldSeries(code, cleanAttempts, rawEntry.rpe);

      const targetMem = rawEntry.membershipId
        ? doc.memberships.find(
            (m) => m.membershipId === rawEntry.membershipId && m.status !== 'REVOKED'
          )
        : undefined;
      const athleteName = String(
        targetMem?.invitedName || rawEntry.athleteName || 'Team Athlete'
      )
        .trim()
        .slice(0, 64);

      const recordId = `fld_${crypto.randomBytes(6).toString('hex')}`;
      const record: FieldEventLogRecord = {
        id: recordId,
        teamId: doc.brand.teamId,
        ...(targetMem ? { membershipId: targetMem.membershipId } : {}),
        athleteName,
        date: cleanDate,
        eventCode: code,
        eventGroup: spec.eventGroup,
        isCompetition: Boolean(rawEntry.isCompetition),
        meetOrPracticeTitle:
          String(rawEntry.meetOrPracticeTitle || '').trim().slice(0, 100) ||
          `${spec.label} ${rawEntry.isCompetition ? 'Competition' : 'Practice Sheet'}`,
        ...(rawEntry.implementSpec
          ? { implementSpec: String(rawEntry.implementSpec).trim().slice(0, 64) }
          : {}),
        ...(rawEntry.poleSpec ? { poleSpec: String(rawEntry.poleSpec).trim().slice(0, 64) } : {}),
        ...(typeof rawEntry.approachSteps === 'number' && Number.isFinite(rawEntry.approachSteps)
          ? { approachSteps: Math.max(1, Math.min(30, Math.round(rawEntry.approachSteps))) }
          : {}),
        attempts: cleanAttempts,
        ...(summary.bestMarkMeters !== null ? { bestMarkMeters: summary.bestMarkMeters } : {}),
        ...(typeof rawEntry.multiPoints === 'number' && Number.isFinite(rawEntry.multiPoints)
          ? { multiPoints: Math.round(rawEntry.multiPoints) }
          : {}),
        ...(typeof rawEntry.rpe === 'number' && Number.isFinite(rawEntry.rpe)
          ? { rpe: Math.max(1, Math.min(10, rawEntry.rpe)) }
          : {}),
        createdAt: nowIso,
      };

      doc.fieldMarkLogs.unshift(record);
      recordedCount += 1;

      if (targetMem) {
        const bestLabel =
          summary.bestMarkMeters !== null ? `${summary.bestMarkMeters.toFixed(2)}m` : `${summary.totalContacts} attempts`;
        const mirroredAct: UnifiedActivity = {
          id: recordId,
          startDateLocal: `${cleanDate}T15:30:00`,
          name: `${spec.shortLabel}: ${bestLabel}${rawEntry.isCompetition ? ' (Meet)' : ''}`,
          sportCategory: 'Running',
          environment: 'OUTDOOR',
          subType: 'Track',
          movingTimeSecs: 1800,
          distanceMeters: 0,
          elevationGainMeters: 0,
          trainingLoad: summary.estimatedLoadTss,
          avgHr: 0,
          maxHr: 0,
          aerobicDecouplingPct: 0,
          efficiencyFactor: 0,
          firstHalfEf: 0,
          secondHalfEf: 0,
          zoneSecs: { hr: [0, 0, 0, 0, 0, 0, 0] },
          sourceBadges: [],
          stravaPrCount: 0,
          segmentEfforts: [],
          isCompetitionDay: Boolean(rawEntry.isCompetition),
          deviceName: 'THRESH Trackside Field Sheet',
        };
        targetMem.coachRecordedActivities = [
          mirroredAct,
          ...(targetMem.coachRecordedActivities || []),
        ].slice(0, 80);
      }
    }

    doc.fieldMarkLogs = doc.fieldMarkLogs.slice(0, 200);
    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'FIELD_MARKS_RECORDED',
      metadata: { recordedCount },
    });

    return {
      ok: true,
      recordedCount,
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}

export async function updateAssistantCoachEventGroups(params: {
  callerSid: string;
  teamId: string;
  membershipId: string;
  coachEventGroups: CoachEventGroup[];
  originUrl: string;
}): Promise<{ ok: boolean; team?: TeamSummaryWithRole | null; error?: string }> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: 'Team not found.' };

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem || !canManageTeamGovernanceRole(callerMem.role)) {
      return { ok: false, error: 'Head Coach or Org Admin permissions required.' };
    }

    const target = doc.memberships.find(
      (m) => m.membershipId === params.membershipId && m.status !== 'REVOKED'
    );
    if (!target) return { ok: false, error: 'Staff member not found.' };

    const cleanGroups = sanitizeTargetEventGroups(params.coachEventGroups) || [];
    target.coachEventGroups = cleanGroups.length > 0 ? cleanGroups : undefined;
    doc.updatedAt = new Date().toISOString();
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'COACH_GROUPS_UPDATED',
      targetId: target.membershipId,
      metadata: { coachEventGroups: cleanGroups },
    });

    return {
      ok: true,
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}
