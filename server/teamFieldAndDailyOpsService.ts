import crypto from 'crypto';
import type {
  CoachEventGroup,
  FieldAttemptOutcome,
  FieldEventCode,
  FieldEventLogRecord,
  FieldTrialEntry,
  TeamAnnouncementCategory,
  TeamAnnouncementRecord,
  TeamAttendanceRecord,
  TeamAttendanceStatus,
  TeamMemberRole,
  TeamMembershipRecord,
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
  hashToken,
  loadTeamDocRaw,
  projectTeamSummaryForCaller,
  sanitizeTargetEventGroups,
  saveTeamDocRaw,
  type StoredMembershipInternal,
} from './teamStoreCore.ts';
import {
  isResendConfigured,
  sendEmailViaResend,
  withBoundedTimeout,
} from './teamEmailAndOtpService.ts';
import { dispatchTeamPushNotifications } from './pushNotificationService.ts';
import { escapeHtml } from './securityUtils.ts';
import {
  appendAuditLogAsync,
  loadTenantVaultAsync,
  sanitizeTenantId,
  saveTenantVaultAsync,
  withTeamRowLock,
} from './tokenVault.ts';

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

  let pendingPushPayload: Parameters<typeof dispatchTeamPushNotifications>[0] | null = null;

  const lockedResult = await withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false as const, error: 'Team not found.' };

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem || (!canProgramWorkoutsRole(callerMem.role) && callerMem.role !== 'ORG_ADMIN')) {
      return { ok: false as const, error: 'Coach or admin permissions required.' };
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

    pendingPushPayload = {
      teamId: params.teamId,
      senderSid: params.callerSid,
      senderName: announcement.authorName,
      kind: 'ANNOUNCEMENT',
      announcementCategory: category,
      eventGroup: targetGroups && targetGroups.length === 1 ? targetGroups[0] : undefined,
      bodyText: `${cleanTitle} — ${cleanBody}`,
      isEmergency: category === 'WEATHER',
    };

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
      ok: true as const,
      announcement,
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });

  if (lockedResult.ok && pendingPushPayload) {
    const pushToSend = pendingPushPayload as Parameters<typeof dispatchTeamPushNotifications>[0];
    await Promise.allSettled([
      withBoundedTimeout(dispatchTeamPushNotifications(pushToSend), 8000, 'announcement-push'),
    ]);
  }

  return lockedResult;
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

const VALID_FIELD_ATTEMPT_OUTCOMES = new Set<FieldAttemptOutcome>([
  'MARK',
  'FOUL',
  'PASS',
  'CLEAR',
  'MISS',
]);

export function teamFieldLogsVaultKey(teamId: string): string {
  return `team_field_logs_${sanitizeTenantId(teamId).slice(0, 48)}`;
}

function sanitizeClientBatchId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 72);
  return cleaned || undefined;
}

function sanitizeFieldAttempts(rawAttempts: unknown): FieldTrialEntry[] {
  if (!Array.isArray(rawAttempts)) return [];
  const out: FieldTrialEntry[] = [];
  for (let i = 0; i < Math.min(24, rawAttempts.length); i += 1) {
    const raw = rawAttempts[i];
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Partial<FieldTrialEntry>;
    const outcome = String(item.outcome || '').toUpperCase() as FieldAttemptOutcome;
    if (!VALID_FIELD_ATTEMPT_OUTCOMES.has(outcome)) continue;

    const attemptNumber =
      typeof item.attemptNumber === 'number' && Number.isFinite(item.attemptNumber)
        ? Math.max(1, Math.min(24, Math.round(item.attemptNumber)))
        : i + 1;

    const markMeters =
      typeof item.markMeters === 'number' &&
      Number.isFinite(item.markMeters) &&
      item.markMeters >= 0.3 &&
      item.markMeters <= 110
        ? Number(item.markMeters.toFixed(3))
        : undefined;

    const barHeightMeters =
      typeof item.barHeightMeters === 'number' &&
      Number.isFinite(item.barHeightMeters) &&
      item.barHeightMeters >= 0.3 &&
      item.barHeightMeters <= 10
        ? Number(item.barHeightMeters.toFixed(3))
        : undefined;

    const windMps =
      typeof item.windMps === 'number' &&
      Number.isFinite(item.windMps) &&
      item.windMps >= -20 &&
      item.windMps <= 20
        ? Number(item.windMps.toFixed(2))
        : undefined;

    const round =
      item.round === 'PRELIM' || item.round === 'FINAL' ? item.round : undefined;

    const note =
      typeof item.note === 'string' && item.note.trim()
        ? item.note.trim().slice(0, 120)
        : undefined;

    out.push({
      attemptNumber,
      outcome,
      ...(markMeters !== undefined ? { markMeters } : {}),
      ...(barHeightMeters !== undefined ? { barHeightMeters } : {}),
      ...(windMps !== undefined ? { windMps } : {}),
      ...(round ? { round } : {}),
      ...(note ? { note } : {}),
    });
  }
  return out;
}

/**
 * Loads the uncapped team field mark archive from encrypted vault storage,
 * falling back/migrating cleanly from inline `doc.fieldMarkLogs` when needed.
 */
export async function loadFullTeamFieldMarksArchive(
  teamId: string,
  inlineFallback?: FieldEventLogRecord[]
): Promise<FieldEventLogRecord[]> {
  const vaulted = await loadTenantVaultAsync<FieldEventLogRecord[] | null>(
    teamFieldLogsVaultKey(teamId),
    null
  );
  const inline = Array.isArray(inlineFallback) ? inlineFallback : [];
  if (!Array.isArray(vaulted)) {
    return [...inline];
  }
  if (inline.length === 0) {
    return [...vaulted];
  }
  const seenIds = new Set(vaulted.map((r) => r.id));
  const extraInline = inline.filter((r) => r && r.id && !seenIds.has(r.id));
  return extraInline.length > 0 ? [...extraInline, ...vaulted] : [...vaulted];
}

export async function listTeamFieldMarks(params: {
  teamId: string;
  callerSid: string;
  eventCode?: FieldEventCode | string;
  limit?: number;
  offset?: number;
}): Promise<{
  ok: boolean;
  logs: FieldEventLogRecord[];
  totalCount: number;
  limit: number;
  offset: number;
  error?: string;
}> {
  const limit = Math.max(1, Math.min(200, Math.floor(params.limit ?? 100)));
  const offset = Math.max(0, Math.floor(params.offset ?? 0));

  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc) {
    return { ok: false, logs: [], totalCount: 0, limit, offset, error: 'Team not found.' };
  }

  const callerMem = doc.memberships.find(
    (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
  );
  if (!callerMem || callerMem.role === 'PARENT_FOLLOWER') {
    return {
      ok: false,
      logs: [],
      totalCount: 0,
      limit,
      offset,
      error: 'Coach or athlete team membership required.',
    };
  }

  const archive = await loadFullTeamFieldMarksArchive(params.teamId, doc.fieldMarkLogs);
  const isStaff = canViewSafeguardingMedicalRole(callerMem.role);
  const requestedCode = params.eventCode
    ? (String(params.eventCode).toUpperCase() as FieldEventCode)
    : undefined;
  const filterByCode =
    requestedCode && VALID_FIELD_EVENT_CODES.has(requestedCode) ? requestedCode : undefined;

  const visible = archive.filter((log) => {
    if (!isStaff && log.membershipId !== callerMem.membershipId) return false;
    if (filterByCode && log.eventCode !== filterByCode) return false;
    return true;
  });

  return {
    ok: true,
    logs: visible.slice(offset, offset + limit),
    totalCount: visible.length,
    limit,
    offset,
  };
}

export interface RecordTeamFieldMarkInput {
  membershipId?: string;
  athleteName: string;
  date: string;
  eventCode: FieldEventCode;
  isCompetition?: boolean;
  meetOrPracticeTitle?: string;
  flightName?: string;
  implementSpec?: string;
  poleSpec?: string;
  approachSteps?: number;
  attempts: FieldTrialEntry[];
  bestMarkMeters?: number;
  bestWindLegalMeters?: number;
  bestMarkWindMps?: number;
  isWindAidedBest?: boolean;
  isNoHeight?: boolean;
  missesAtClearingHeight?: number;
  totalVerticalMisses?: number;
  placeRank?: number;
  advancedToFinals?: boolean;
  multiPoints?: number;
  rpe?: number;
  clientBatchId?: string;
}

export async function recordTeamFieldMarks(params: {
  callerSid: string;
  teamId: string;
  clientBatchId?: string;
  entries: RecordTeamFieldMarkInput[];
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
    const archive = await loadFullTeamFieldMarksArchive(params.teamId, doc.fieldMarkLogs);
    const existingBatchKeys = new Set<string>();
    for (const existing of archive) {
      if (!existing.clientBatchId) continue;
      const who = existing.membershipId || `name:${existing.athleteName.toLowerCase()}`;
      existingBatchKeys.add(`${existing.clientBatchId}|${existing.eventCode}|${who}`);
    }
    const topBatchId = sanitizeClientBatchId(params.clientBatchId);
    let recordedCount = 0;

    for (const rawEntry of (params.entries || []).slice(0, 120)) {
      const code = String(rawEntry.eventCode || '').toUpperCase() as FieldEventCode;
      if (!VALID_FIELD_EVENT_CODES.has(code)) continue;
      const spec = getFieldEventSpec(code);
      const cleanDate = /^\d{4}-\d{2}-\d{2}$/.test(String(rawEntry.date || ''))
        ? String(rawEntry.date).slice(0, 10)
        : nowIso.slice(0, 10);
      const cleanAttempts = sanitizeFieldAttempts(rawEntry.attempts);
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

      const entryBatchId = sanitizeClientBatchId(rawEntry.clientBatchId) || topBatchId;
      if (entryBatchId) {
        const who = targetMem
          ? targetMem.membershipId
          : `name:${athleteName.toLowerCase()}`;
        const batchKey = `${entryBatchId}|${code}|${who}`;
        if (existingBatchKeys.has(batchKey)) {
          continue;
        }
      }

      const bestMarkMeters =
        summary.bestMarkMeters !== null
          ? summary.bestMarkMeters
          : typeof rawEntry.bestMarkMeters === 'number' &&
              Number.isFinite(rawEntry.bestMarkMeters) &&
              rawEntry.bestMarkMeters > 0
            ? Number(rawEntry.bestMarkMeters.toFixed(3))
            : undefined;
      const bestWindLegalMeters =
        summary.bestWindLegalMeters !== null
          ? summary.bestWindLegalMeters
          : typeof rawEntry.bestWindLegalMeters === 'number' &&
              Number.isFinite(rawEntry.bestWindLegalMeters) &&
              rawEntry.bestWindLegalMeters > 0
            ? Number(rawEntry.bestWindLegalMeters.toFixed(3))
            : undefined;
      const bestMarkWindMps =
        summary.bestMarkWindMps !== undefined
          ? summary.bestMarkWindMps
          : typeof rawEntry.bestMarkWindMps === 'number' &&
              Number.isFinite(rawEntry.bestMarkWindMps)
            ? Number(rawEntry.bestMarkWindMps.toFixed(2))
            : undefined;
      const isWindAidedBest =
        bestMarkMeters !== undefined
          ? summary.bestMarkMeters !== null
            ? summary.isWindAidedBest
            : Boolean(rawEntry.isWindAidedBest)
          : undefined;
      const isNoHeight =
        summary.isNoHeight !== undefined
          ? summary.isNoHeight
          : typeof rawEntry.isNoHeight === 'boolean'
            ? rawEntry.isNoHeight
            : undefined;
      const missesAtClearingHeight =
        summary.missesAtClearingHeight !== undefined
          ? summary.missesAtClearingHeight
          : typeof rawEntry.missesAtClearingHeight === 'number' &&
              Number.isFinite(rawEntry.missesAtClearingHeight)
            ? Math.max(0, Math.round(rawEntry.missesAtClearingHeight))
            : undefined;
      const totalVerticalMisses =
        summary.totalVerticalMisses !== undefined
          ? summary.totalVerticalMisses
          : typeof rawEntry.totalVerticalMisses === 'number' &&
              Number.isFinite(rawEntry.totalVerticalMisses)
            ? Math.max(0, Math.round(rawEntry.totalVerticalMisses))
            : undefined;
      const flightName =
        typeof rawEntry.flightName === 'string' && rawEntry.flightName.trim()
          ? rawEntry.flightName.trim().slice(0, 48)
          : undefined;
      const placeRank =
        typeof rawEntry.placeRank === 'number' &&
        Number.isFinite(rawEntry.placeRank) &&
        rawEntry.placeRank >= 1
          ? Math.round(rawEntry.placeRank)
          : undefined;
      const advancedToFinals =
        typeof rawEntry.advancedToFinals === 'boolean' ? rawEntry.advancedToFinals : undefined;

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
        ...(flightName ? { flightName } : {}),
        ...(rawEntry.implementSpec
          ? { implementSpec: String(rawEntry.implementSpec).trim().slice(0, 64) }
          : {}),
        ...(rawEntry.poleSpec ? { poleSpec: String(rawEntry.poleSpec).trim().slice(0, 64) } : {}),
        ...(typeof rawEntry.approachSteps === 'number' && Number.isFinite(rawEntry.approachSteps)
          ? { approachSteps: Math.max(1, Math.min(30, Math.round(rawEntry.approachSteps))) }
          : {}),
        attempts: cleanAttempts,
        ...(bestMarkMeters !== undefined ? { bestMarkMeters } : {}),
        ...(bestWindLegalMeters !== undefined ? { bestWindLegalMeters } : {}),
        ...(bestMarkWindMps !== undefined ? { bestMarkWindMps } : {}),
        ...(isWindAidedBest ? { isWindAidedBest: true } : {}),
        ...(isNoHeight ? { isNoHeight: true } : {}),
        ...(missesAtClearingHeight !== undefined ? { missesAtClearingHeight } : {}),
        ...(totalVerticalMisses !== undefined ? { totalVerticalMisses } : {}),
        ...(placeRank !== undefined ? { placeRank } : {}),
        ...(advancedToFinals !== undefined ? { advancedToFinals } : {}),
        ...(typeof rawEntry.multiPoints === 'number' && Number.isFinite(rawEntry.multiPoints)
          ? { multiPoints: Math.round(rawEntry.multiPoints) }
          : {}),
        ...(typeof rawEntry.rpe === 'number' && Number.isFinite(rawEntry.rpe)
          ? { rpe: Math.max(1, Math.min(10, rawEntry.rpe)) }
          : {}),
        ...(entryBatchId ? { clientBatchId: entryBatchId } : {}),
        createdAt: nowIso,
      };

      archive.unshift(record);
      recordedCount += 1;

      if (targetMem) {
        const bestLabel =
          bestMarkMeters !== undefined
            ? `${bestMarkMeters.toFixed(2)}m`
            : `${summary.totalContacts} attempts`;
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
          deviceName: 'MeetReady Trackside Field Sheet',
        };
        targetMem.coachRecordedActivities = [
          mirroredAct,
          ...(targetMem.coachRecordedActivities || []),
        ].slice(0, 80);
      }
    }

    await saveTenantVaultAsync(teamFieldLogsVaultKey(params.teamId), archive);
    doc.fieldMarkLogs = archive.slice(0, 150);
    doc.fieldMarkLogsTotalCount = archive.length;
    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'FIELD_MARKS_RECORDED',
      metadata: {
        recordedCount,
        totalArchiveCount: archive.length,
        ...(topBatchId ? { clientBatchId: topBatchId } : {}),
      },
    });

    return {
      ok: true,
      recordedCount,
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}

const VALID_COACH_STAFF_ROLES = new Set<TeamMemberRole>([
  'HEAD_COACH',
  'ASSISTANT_COACH',
  'ATHLETIC_TRAINER',
  'ORG_ADMIN',
]);

function filterValidAssignedAthleteIds(
  memberships: StoredMembershipInternal[],
  rawIds?: string[]
): string[] | undefined {
  if (!Array.isArray(rawIds)) return undefined;
  const athleteIds = new Set(
    memberships
      .filter((m) => m.role === 'ATHLETE' && m.status !== 'REVOKED')
      .map((m) => m.membershipId)
  );
  const cleaned: string[] = [];
  for (const id of rawIds) {
    const trimmed = String(id || '').trim();
    if (trimmed && athleteIds.has(trimmed) && !cleaned.includes(trimmed)) {
      cleaned.push(trimmed);
    }
  }
  return cleaned;
}

export async function updateAssistantCoachEventGroups(params: {
  callerSid: string;
  teamId: string;
  membershipId: string;
  coachEventGroups: CoachEventGroup[];
  coachSpecialtyTitle?: string;
  assignedAthleteMembershipIds?: string[];
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

    if (params.coachSpecialtyTitle !== undefined) {
      const cleanTitle = String(params.coachSpecialtyTitle || '').trim().slice(0, 60);
      target.coachSpecialtyTitle = cleanTitle || undefined;
    }

    if (params.assignedAthleteMembershipIds !== undefined) {
      const validIds = filterValidAssignedAthleteIds(
        doc.memberships,
        params.assignedAthleteMembershipIds
      );
      target.assignedAthleteMembershipIds = validIds && validIds.length > 0 ? validIds : undefined;
    }

    doc.updatedAt = new Date().toISOString();
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'COACH_GROUPS_UPDATED',
      targetId: target.membershipId,
      metadata: {
        coachEventGroups: cleanGroups,
        coachSpecialtyTitle: target.coachSpecialtyTitle,
        assignedAthleteCount: target.assignedAthleteMembershipIds?.length ?? 0,
      },
    });

    return {
      ok: true,
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}

export async function inviteTeamCoachingStaff(params: {
  callerSid: string;
  teamId: string;
  staffName: string;
  staffEmail?: string;
  role?: TeamMemberRole;
  coachSpecialtyTitle?: string;
  coachEventGroups?: CoachEventGroup[];
  assignedAthleteMembershipIds?: string[];
  originUrl: string;
}): Promise<{
  ok: boolean;
  member?: TeamMembershipRecord;
  inviteUrl?: string;
  emailStatus?: 'SENT_RESEND' | 'READY_MANUAL_LINK' | 'FAILED';
  team?: TeamSummaryWithRole | null;
  error?: string;
}> {
  const cleanName = String(params.staffName || '').trim().slice(0, 64);
  if (!cleanName) {
    return { ok: false, error: 'Coach or staff name is required.' };
  }
  const cleanEmail = params.staffEmail ? String(params.staffEmail).trim().toLowerCase() : '';
  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return { ok: false, error: 'Please enter a valid coach email address.' };
  }
  const role: TeamMemberRole =
    params.role && VALID_COACH_STAFF_ROLES.has(params.role) ? params.role : 'ASSISTANT_COACH';
  const cleanSpecialty = String(params.coachSpecialtyTitle || '').trim().slice(0, 60);

  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: 'Team not found.' };

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem || !canManageTeamGovernanceRole(callerMem.role)) {
      return { ok: false, error: 'Head Coach or Org Admin permissions required.' };
    }

    if (cleanEmail) {
      const duplicate = doc.memberships.find(
        (m) => m.status !== 'REVOKED' && m.invitedEmail?.toLowerCase() === cleanEmail
      );
      if (duplicate) {
        return {
          ok: false,
          error: 'A team or coaching staff member with that email already exists on this roster.',
        };
      }
    }

    const cleanGroups = sanitizeTargetEventGroups(params.coachEventGroups) || [];
    const validAthleteIds = filterValidAssignedAthleteIds(
      doc.memberships,
      params.assignedAthleteMembershipIds
    );
    const rawInviteToken = crypto.randomBytes(16).toString('base64url');
    const nowIso = new Date().toISOString();
    const cleanOrigin = (params.originUrl || 'https://meetready.app').replace(/\/+$/, '');
    const inviteUrl = `${cleanOrigin}/join/${doc.brand.slug}?t=${rawInviteToken}`;

    let emailStatus: 'SENT_RESEND' | 'READY_MANUAL_LINK' | 'FAILED' = 'READY_MANUAL_LINK';
    if (cleanEmail && isResendConfigured()) {
      const roleLabel = cleanSpecialty || role.replace(/_/g, ' ');
      const sendRes = await sendEmailViaResend({
        to: cleanEmail,
        subject: `Coaching staff invite: ${doc.brand.name} (${roleLabel}) on MeetReady`,
        html: `<p>Hi <strong>${escapeHtml(cleanName)}</strong>,</p><p>You have been invited to join <strong>${escapeHtml(doc.brand.name)}</strong> on MeetReady as <strong>${escapeHtml(roleLabel)}</strong>.</p><p><a href="${escapeHtml(inviteUrl)}" style="display:inline-block;padding:12px 20px;background:#C8FF00;color:#111318;font-weight:700;text-decoration:none;border-radius:10px;">Accept Coach Invite</a></p><p style="font-size:12px;color:#64748B;">Or paste team code: <strong>${escapeHtml(doc.brand.joinCode)}</strong></p>`,
        text: `Hi ${cleanName}, you are invited to join ${doc.brand.name} on MeetReady as ${roleLabel}. Accept here: ${inviteUrl} (Team code: ${doc.brand.joinCode})`,
      });
      emailStatus = sendRes.status;
    }

    const newMem: StoredMembershipInternal = {
      membershipId: `mem_coach_${crypto.randomBytes(6).toString('hex')}`,
      teamId: doc.brand.teamId,
      role,
      squadGroup: 'Coaching Staff',
      ...(cleanGroups.length > 0 ? { coachEventGroups: cleanGroups } : {}),
      ...(cleanSpecialty ? { coachSpecialtyTitle: cleanSpecialty } : {}),
      ...(validAthleteIds && validAthleteIds.length > 0
        ? { assignedAthleteMembershipIds: validAthleteIds }
        : {}),
      sharingTier: 'FULL_STREAMS',
      invitedName: cleanName,
      ...(cleanEmail ? { invitedEmail: cleanEmail } : {}),
      isMinorU18: false,
      parentConsentStatus: 'NOT_REQUIRED',
      status: 'INVITED',
      emailDeliveryStatus: emailStatus,
      magicJoinUrl: inviteUrl,
      rawInviteToken,
      inviteTokenHash: hashToken(rawInviteToken),
      invitedAt: nowIso,
    };

    doc.memberships.push(newMem);
    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'COACHING_STAFF_INVITED',
      targetId: newMem.membershipId,
      metadata: {
        role,
        coachSpecialtyTitle: cleanSpecialty || undefined,
        coachEventGroups: cleanGroups,
        assignedAthleteCount: validAthleteIds?.length ?? 0,
      },
    });

    const summary = projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
    const projectedMember = summary?.memberships.find((m) => m.membershipId === newMem.membershipId);
    return {
      ok: true,
      member: projectedMember,
      inviteUrl,
      emailStatus,
      team: summary,
    };
  });
}
