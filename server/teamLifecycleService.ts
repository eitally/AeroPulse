import crypto from 'crypto';
import { resolveAthleteAgeTier } from '../src/physiology/ageAndComplianceEngine.ts';
import { timingSafeStringEqual } from './securityUtils.ts';
import {
  buildParentConsentEmailContent,
  sendEmailViaResend,
} from './teamEmailAndOtpService.ts';
import type {
  CoachDataSharingTier,
  FieldEventLogRecord,
  TeamInviteStatus,
  TeamMemberRole,
  TeamSummaryWithRole,
  UnifiedActivity,
} from '../src/types.ts';
import { archiveCoachActivitiesForMember } from './athleteArchiveHelper.ts';
import {
  TEAMS_DIRECTORY_KEY,
  type StoredMembershipInternal,
  type StoredTeamDocument,
  hashToken,
  loadDirectory,
  loadTeamDocRaw,
  projectTeamSummaryForCaller,
  removeTeamFromUserIndex,
  saveTeamDocRaw,
  teamDocVaultKey,
} from './teamService.ts';
import {
  type PersistedAuditLogEntry,
  appendAuditLogAsync,
  deleteMemberPostgresRowsAsync,
  deleteTeamPostgresRowsAsync,
  deleteTenantVault,
  loadTenantVaultAsync,
  sanitizeTenantId,
  saveTenantVaultAsync,
  withTeamRowLock,
  withVaultLock,
} from './tokenVault.ts';
import { teamFieldLogsVaultKey } from './teamFieldAndDailyOpsService.ts';

function sanitizeMemberPublicNameForDeletion(m: StoredMembershipInternal): void {
  m.userSid = undefined;
  m.stravaAthleteId = undefined;
  m.invitedEmail = undefined;
  m.invitedPhone = undefined;
  m.parentGuardianEmail = undefined;
  m.parentConsentToken = undefined;
  m.parentConsentTokenHash = undefined;
  m.liveSnapshot = undefined;
  m.rawInviteToken = undefined;
  m.inviteTokenHash = undefined;
  m.birthMonthYear = undefined;
  m.birthYear = undefined;
  m.graduationYear = undefined;
  m.seedMarkOrFtp = undefined;
  m.externalAthleteId = undefined;
  m.externalProfileUrl = undefined;
  m.genderDivision = undefined;
}

/**
 * Scrubs all PII and nested references for erased memberships across a StoredTeamDocument
 * (memberships, broadcast overrides/targets, workout comments, guardian alerts, attendance,
 * inline field mark logs, meet-day packets, injury cases, and team messages).
 */
export function scrubMemberFromTeamDocument(params: {
  doc: StoredTeamDocument;
  targetMembershipIds: Set<string>;
  targetSids: Set<string>;
  replacementName: string;
}): void {
  const { doc, targetMembershipIds, targetSids, replacementName } = params;
  const nowIso = new Date().toISOString();

  for (const m of doc.memberships) {
    const isTarget =
      targetMembershipIds.has(m.membershipId) ||
      (m.userSid ? targetSids.has(m.userSid) : false);
    if (isTarget) {
      targetMembershipIds.add(m.membershipId);
      if (m.userSid) targetSids.add(m.userSid);
      m.status = 'REVOKED';
      m.leftAt = nowIso;
      m.invitedName = replacementName;
      sanitizeMemberPublicNameForDeletion(m);
      m.coachRecordedActivities = undefined;
    } else if (Array.isArray(m.assignedAthleteMembershipIds)) {
      m.assignedAthleteMembershipIds = m.assignedAthleteMembershipIds.filter(
        (id) => !targetMembershipIds.has(id)
      );
    }
  }

  for (const bw of doc.broadcastWorkouts || []) {
    if (Array.isArray(bw.targetMembershipIds)) {
      bw.targetMembershipIds = bw.targetMembershipIds.filter(
        (id) => !targetMembershipIds.has(id)
      );
    }
    if (bw.athleteOverrides) {
      for (const memId of targetMembershipIds) {
        delete bw.athleteOverrides[memId];
      }
    }
  }

  if (Array.isArray(doc.workoutComments)) {
    doc.workoutComments = doc.workoutComments.filter(
      (c) => !targetMembershipIds.has(c.targetMembershipId) && !targetSids.has(c.authorSid)
    );
  }

  if (Array.isArray(doc.guardianSafetyAlerts)) {
    doc.guardianSafetyAlerts = doc.guardianSafetyAlerts.filter(
      (a) => !targetMembershipIds.has(a.targetMembershipId)
    );
  }

  if (doc.attendanceByDate && typeof doc.attendanceByDate === 'object') {
    for (const dateKey of Object.keys(doc.attendanceByDate)) {
      const dayMap = doc.attendanceByDate[dateKey];
      if (!dayMap || typeof dayMap !== 'object') continue;
      for (const key of Object.keys(dayMap)) {
        const rec = dayMap[key];
        if (
          targetMembershipIds.has(key) ||
          (rec?.membershipId && targetMembershipIds.has(rec.membershipId))
        ) {
          delete dayMap[key];
        }
      }
      if (Object.keys(dayMap).length === 0) {
        delete doc.attendanceByDate[dateKey];
      }
    }
  }

  if (Array.isArray(doc.fieldMarkLogs)) {
    doc.fieldMarkLogs = doc.fieldMarkLogs.filter(
      (log) => !log.membershipId || !targetMembershipIds.has(log.membershipId)
    );
  }

  if (Array.isArray(doc.meetDayPackets)) {
    for (const pkt of doc.meetDayPackets) {
      if (Array.isArray(pkt.entries)) {
        pkt.entries = pkt.entries.filter(
          (entry) => !entry.membershipId || !targetMembershipIds.has(entry.membershipId)
        );
      }
    }
  }

  if (Array.isArray(doc.injuryCases)) {
    doc.injuryCases = doc.injuryCases.filter(
      (c) => !targetMembershipIds.has(c.membershipId)
    );
  }

  if (Array.isArray(doc.teamMessages)) {
    doc.teamMessages = doc.teamMessages
      .filter(
        (msg) =>
          !targetSids.has(msg.senderSid) &&
          !targetMembershipIds.has(msg.senderMembershipId) &&
          (!msg.targetMembershipId || !targetMembershipIds.has(msg.targetMembershipId))
      )
      .map((msg) =>
        Array.isArray(msg.acknowledgedByMembershipIds)
          ? {
              ...msg,
              acknowledgedByMembershipIds: msg.acknowledgedByMembershipIds.filter(
                (id) => !targetMembershipIds.has(id)
              ),
            }
          : msg
      );
  }

  doc.updatedAt = nowIso;
}

export function collectMemberInjuryCaseIds(
  doc: StoredTeamDocument,
  targetMembershipIds: Set<string>
): Set<string> {
  return new Set<string>(
    (doc.injuryCases || [])
      .filter((c) => targetMembershipIds.has(c.membershipId))
      .map((c) => c.id)
  );
}

/**
 * Scrubs member records from external sidecar vaults (`team_field_logs_*`, `audit_log_*`)
 * and normalized PostgreSQL tables (`thresh_team_members`, `thresh_audit_log`).
 */
export async function scrubMemberSidecarVaultsAndPostgres(params: {
  teamId: string;
  targetMembershipIds: Set<string>;
  targetSids: Set<string>;
  emails?: string[];
  injuryCaseIds?: Set<string>;
}): Promise<number | undefined> {
  const { teamId, targetMembershipIds, targetSids, emails, injuryCaseIds } = params;
  let updatedFieldLogCount: number | undefined;

  const fieldKey = teamFieldLogsVaultKey(teamId);
  await withVaultLock(fieldKey, async () => {
    const existingLogs = await loadTenantVaultAsync<FieldEventLogRecord[] | null>(fieldKey, null);
    if (Array.isArray(existingLogs)) {
      const filtered = existingLogs.filter(
        (log) => !log.membershipId || !targetMembershipIds.has(log.membershipId)
      );
      updatedFieldLogCount = filtered.length;
      if (filtered.length !== existingLogs.length) {
        await saveTenantVaultAsync(fieldKey, filtered);
      }
    }
  });

  const auditKey = `audit_log_${sanitizeTenantId(teamId).slice(0, 40)}`;
  const scrubbedReferenceIds = [
    ...Array.from(targetMembershipIds),
    ...(injuryCaseIds ? Array.from(injuryCaseIds) : []),
  ].filter(Boolean);
  await withVaultLock(auditKey, async () => {
    const entries = await loadTenantVaultAsync<PersistedAuditLogEntry[]>(auditKey, []);
    let changed = false;
    const scrubbed = entries.map((entry) => {
      const matchesTarget = entry.targetId
        ? targetMembershipIds.has(entry.targetId) ||
          Boolean(injuryCaseIds && injuryCaseIds.has(entry.targetId))
        : false;
      const matchesActor = targetSids.has(entry.actorSid);
      const serializedMeta =
        entry.metadata && scrubbedReferenceIds.length > 0 ? JSON.stringify(entry.metadata) : '';
      const matchesMetadata =
        serializedMeta.length > 0 && scrubbedReferenceIds.some((id) => serializedMeta.includes(id));
      if (!matchesTarget && !matchesActor && !matchesMetadata) return entry;
      changed = true;
      return {
        ...entry,
        ...(matchesActor ? { actorSid: 'deleted_user' } : {}),
        metadata: { redacted: true },
      };
    });
    if (changed) {
      await saveTenantVaultAsync(auditKey, scrubbed);
    }
  });

  await deleteMemberPostgresRowsAsync({
    teamId,
    membershipIds: Array.from(targetMembershipIds),
    userSids: Array.from(targetSids),
    emails,
    injuryCaseIds: injuryCaseIds ? Array.from(injuryCaseIds) : [],
  });

  return updatedFieldLogCount;
}

/**
 * Athlete voluntary departure from a team (`LEAVE` -> `REVOKED`) or self-graduation (`GRADUATE_ALUMNI` -> `ALUMNI`).
 * Always archives coach-recorded Trackside Stopwatch splits & official FAT meet marks into
 * the athlete's own `athlete_state_*` vault BEFORE clearing `liveSnapshot` from the team.
 */
export async function leaveOrGraduateTeam(params: {
  callerSid: string;
  userId?: string;
  stravaAthleteId?: string;
  teamId: string;
  mode: 'LEAVE' | 'GRADUATE_ALUMNI';
  originUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  const archiveQueue: { member: StoredMembershipInternal; activities: UnifiedActivity[] }[] = [];

  const result = await withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: 'Team not found.' };

    const mem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!mem) return { ok: false, error: 'Membership not found on this team.' };

    if (mem.role === 'HEAD_COACH') {
      const otherActive = doc.memberships.filter(
        (m) =>
          m.membershipId !== mem.membershipId &&
          m.status !== 'REVOKED' &&
          m.status !== 'ALUMNI'
      );
      if (otherActive.length > 0) {
        return {
          ok: false,
          error:
            'Transfer Head Coach ownership to another staff member before leaving an active team.',
        };
      }
    }

    if (Array.isArray(mem.coachRecordedActivities) && mem.coachRecordedActivities.length > 0) {
      archiveQueue.push({
        member: {
          ...mem,
          userSid: mem.userSid || params.callerSid,
          ...(params.stravaAthleteId ? { stravaAthleteId: params.stravaAthleteId } : {}),
        },
        activities: mem.coachRecordedActivities,
      });
    }

    const nowIso = new Date().toISOString();
    mem.liveSnapshot = undefined;
    mem.parentGuardianEmail = undefined;
    mem.parentConsentToken = undefined;
    mem.parentConsentTokenHash = undefined;

    if (params.mode === 'GRADUATE_ALUMNI') {
      mem.status = 'ALUMNI';
      mem.graduatedAt = nowIso;
    } else {
      mem.status = 'REVOKED';
      mem.leftAt = nowIso;
      mem.coachRecordedActivities = undefined;
    }

    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);
    await removeTeamFromUserIndex(params.callerSid, params.teamId);
    return { ok: true };
  });

  for (const item of archiveQueue) {
    await archiveCoachActivitiesForMember(
      { ...item.member, userId: params.userId },
      item.activities
    ).catch(() => undefined);
  }

  return result;
}

/**
 * Allows an athlete aged 18+ to revoke guardian email CC & parent alerts (FERPA rights transfer at 18).
 */
export async function revokeAthleteGuardianConsentForTeam(params: {
  callerSid: string;
  teamId: string;
  originUrl: string;
  birthMonthYear?: string;
  verifiedUserBirthMonthYear?: string;
}): Promise<{ ok: boolean; summary?: TeamSummaryWithRole | null; error?: string }> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: 'Team not found.' };

    const mem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!mem) return { ok: false, error: 'Membership not found.' };

    const storedBmy =
      mem.birthMonthYear ||
      (typeof mem.birthYear === 'number' && mem.birthYear > 1900
        ? `${mem.birthYear}-12`
        : undefined);
    const canonicalBmy =
      storedBmy ||
      (mem.isMinorU18 ? undefined : params.verifiedUserBirthMonthYear || params.birthMonthYear);
    const ageCheck = resolveAthleteAgeTier({
      birthMonthYear: canonicalBmy,
      birthYear: mem.birthYear,
      orgType: doc.brand.orgType,
      graduationYear: mem.graduationYear,
    });
    const effectiveMinor =
      ageCheck.ageTier === 'UNKNOWN' ? Boolean(mem.isMinorU18) : ageCheck.isMinorU18;
    if (effectiveMinor) {
      return {
        ok: false,
        error: 'Parent/guardian contact can be removed once you reach 18 years of age.',
      };
    }

    mem.isMinorU18 = false;
    mem.parentGuardianEmail = undefined;
    mem.parentConsentToken = undefined;
    mem.parentConsentTokenHash = undefined;
    mem.parentConsentStatus = 'NOT_REQUIRED';
    if (canonicalBmy && !mem.birthMonthYear) {
      mem.birthMonthYear = canonicalBmy;
    }
    doc.updatedAt = new Date().toISOString();
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'GUARDIAN_CONSENT_REVOKED',
      targetId: mem.membershipId,
      metadata: { reason: 'ADULT_18_PLUS' },
    });
    return {
      ok: true,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}

/**
 * Allows an active or invited team member to inspect/update their post-join coach data sharing tier.
 * Respects RT-08 minor quarantine (cannot expand beyond LOAD_ONLY until guardian consent is ACKNOWLEDGED).
 */
export async function updateMyTeamSharingTier(params: {
  callerSid: string;
  teamId: string;
  sharingTier: CoachDataSharingTier;
  originUrl: string;
}): Promise<{ ok: boolean; summary?: TeamSummaryWithRole | null; error?: string }> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: 'Team not found.' };

    const mem = doc.memberships.find(
      (m) =>
        m.userSid === params.callerSid &&
        m.status !== 'REVOKED' &&
        m.status !== 'ALUMNI'
    );
    if (!mem) return { ok: false, error: 'Active team membership not found.' };

    if (
      mem.isMinorU18 &&
      mem.parentConsentStatus !== 'ACKNOWLEDGED' &&
      params.sharingTier !== 'LOAD_ONLY'
    ) {
      return {
        ok: false,
        error:
          'Parent/guardian consent must be acknowledged before expanding sharing beyond Load & Readiness Only.',
      };
    }

    mem.sharingTier = params.sharingTier;
    if (mem.liveSnapshot) {
      mem.liveSnapshot.sharingTier = params.sharingTier;
      if (params.sharingTier === 'LOAD_ONLY') {
        mem.liveSnapshot.activities = [];
      }
    }

    doc.updatedAt = new Date().toISOString();
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'SHARING_TIER_CHANGED',
      targetId: mem.membershipId,
      metadata: { sharingTier: params.sharingTier },
    });
    return {
      ok: true,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}

/**
 * Coach updates an athlete's lifecycle status (`ACTIVE`, `INJURED`, `OFF_SEASON`, `ALUMNI`, or `REVOKED`).
 */
export async function updateMemberRosterLifecycleStatus(params: {
  callerSid: string;
  teamId: string;
  membershipId: string;
  status: Extract<TeamInviteStatus, 'ACTIVE' | 'INJURED' | 'OFF_SEASON' | 'ALUMNI' | 'REVOKED'>;
  originUrl: string;
}): Promise<{ ok: boolean; summary?: TeamSummaryWithRole | null; error?: string }> {
  let archiveTarget: { member: StoredMembershipInternal; activities: UnifiedActivity[] } | null = null;
  let detachSid: string | undefined;

  const outcome = await withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: 'Team not found.' };

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    const canTrainerUpdateInjuryStatus =
      callerMem?.role === 'ATHLETIC_TRAINER' &&
      (params.status === 'ACTIVE' || params.status === 'INJURED');
    const canCoachManageLifecycle =
      callerMem?.role === 'HEAD_COACH' ||
      callerMem?.role === 'ASSISTANT_COACH' ||
      callerMem?.role === 'ORG_ADMIN';
    if (!callerMem || (!canCoachManageLifecycle && !canTrainerUpdateInjuryStatus)) {
      return {
        ok: false,
        error:
          callerMem?.role === 'ATHLETIC_TRAINER'
            ? 'Athletic trainers may only update ACTIVE or INJURED status.'
            : 'Coach permissions required.',
      };
    }

    const target = doc.memberships.find((m) => m.membershipId === params.membershipId);
    if (!target) return { ok: false, error: 'Member not found.' };
    if (target.role === 'HEAD_COACH') {
      return { ok: false, error: 'Cannot remove or archive the Head Coach directly.' };
    }
    const isStaffTarget =
      target.role === 'ORG_ADMIN' ||
      target.role === 'ASSISTANT_COACH' ||
      target.role === 'ATHLETIC_TRAINER';
    if (isStaffTarget && callerMem.role !== 'HEAD_COACH' && callerMem.role !== 'ORG_ADMIN') {
      return {
        ok: false,
        error: 'Only the Head Coach or Organization Admin can modify staff status.',
      };
    }

    const nowIso = new Date().toISOString();
    if (
      (params.status === 'ALUMNI' || params.status === 'REVOKED') &&
      Array.isArray(target.coachRecordedActivities) &&
      target.coachRecordedActivities.length > 0
    ) {
      archiveTarget = {
        member: { ...target },
        activities: target.coachRecordedActivities,
      };
    }

    target.status = params.status;
    if (params.status === 'ALUMNI') {
      target.graduatedAt = nowIso;
      target.liveSnapshot = undefined;
      detachSid = target.userSid;
    } else if (params.status === 'REVOKED') {
      target.leftAt = nowIso;
      target.liveSnapshot = undefined;
      target.coachRecordedActivities = undefined;
      detachSid = target.userSid;
    }

    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'MEMBER_REMOVED_OR_GRADUATED',
      targetId: target.membershipId,
      metadata: { status: params.status, targetName: target.invitedName },
    });
    return {
      ok: true,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });

  if (archiveTarget) {
    const item = archiveTarget as { member: StoredMembershipInternal; activities: UnifiedActivity[] };
    await archiveCoachActivitiesForMember(item.member, item.activities).catch(() => undefined);
  }
  if (detachSid) {
    await removeTeamFromUserIndex(detachSid, params.teamId).catch(() => undefined);
  }
  return outcome;
}

/**
 * Bulk-transitions all athletes matching `graduationYear` onto `ALUMNI` while preserving official marks.
 */
export async function graduateTeamClass(params: {
  callerSid: string;
  teamId: string;
  graduationYear: number;
  originUrl: string;
}): Promise<{ ok: boolean; graduatedCount: number; summary?: TeamSummaryWithRole | null; error?: string }> {
  const archiveList: Array<{ member: StoredMembershipInternal; activities: UnifiedActivity[]; sid?: string }> = [];

  const res = await withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, graduatedCount: 0, error: 'Team not found.' };

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem || callerMem.role !== 'HEAD_COACH') {
      return { ok: false, graduatedCount: 0, error: 'Head Coach permission required.' };
    }

    const nowIso = new Date().toISOString();
    let count = 0;
    for (const m of doc.memberships) {
      if (
        m.role === 'ATHLETE' &&
        m.status !== 'REVOKED' &&
        m.status !== 'ALUMNI' &&
        m.graduationYear === params.graduationYear
      ) {
        if (Array.isArray(m.coachRecordedActivities) && m.coachRecordedActivities.length > 0) {
          archiveList.push({ member: { ...m }, activities: m.coachRecordedActivities, sid: m.userSid });
        } else if (m.userSid) {
          archiveList.push({ member: { ...m }, activities: [], sid: m.userSid });
        }
        m.status = 'ALUMNI';
        m.graduatedAt = nowIso;
        m.liveSnapshot = undefined;
        count += 1;
      }
    }
    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);
    return {
      ok: true,
      graduatedCount: count,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });

  for (const item of archiveList) {
    if (item.activities.length > 0) {
      await archiveCoachActivitiesForMember(item.member, item.activities).catch(() => undefined);
    }
    if (item.sid) {
      await removeTeamFromUserIndex(item.sid, params.teamId).catch(() => undefined);
    }
  }
  return res;
}

/**
 * Promotes/demotes a claimed roster user between `ATHLETE`, `ASSISTANT_COACH`, `ORG_ADMIN`,
 * and `ATHLETIC_TRAINER` (`HEAD_COACH` or `ORG_ADMIN`).
 */
export async function updateMemberRole(params: {
  callerSid: string;
  teamId: string;
  membershipId: string;
  role: Extract<
    TeamMemberRole,
    'ATHLETE' | 'ASSISTANT_COACH' | 'ORG_ADMIN' | 'ATHLETIC_TRAINER'
  >;
  originUrl: string;
}): Promise<{ ok: boolean; summary?: TeamSummaryWithRole | null; error?: string }> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: 'Team not found.' };
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem || (callerMem.role !== 'HEAD_COACH' && callerMem.role !== 'ORG_ADMIN')) {
      return { ok: false, error: 'Only Head Coach or Org Admin can manage staff roles.' };
    }
    const target = doc.memberships.find(
      (m) => m.membershipId === params.membershipId && m.status !== 'REVOKED'
    );
    if (!target || target.role === 'HEAD_COACH') {
      return { ok: false, error: 'Target member cannot be reassigned.' };
    }
    const prevRole = target.role;
    target.role = params.role;
    target.isMinorU18 = params.role !== 'ATHLETE' ? false : target.isMinorU18;
    doc.updatedAt = new Date().toISOString();
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'ROLE_CHANGED',
      targetId: target.membershipId,
      metadata: { prevRole, nextRole: params.role, targetName: target.invitedName },
    });
    return {
      ok: true,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}

/**
 * Transfers `HEAD_COACH` ownership to another active coach/staff member without orphaning school history.
 */
export async function transferTeamHeadCoachOwnership(params: {
  callerSid: string;
  teamId: string;
  newHeadCoachMembershipId: string;
  originUrl: string;
}): Promise<{ ok: boolean; summary?: TeamSummaryWithRole | null; error?: string }> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: 'Team not found.' };
    const currentHead = doc.memberships.find(
      (m) =>
        m.userSid === params.callerSid &&
        m.role === 'HEAD_COACH' &&
        m.status !== 'REVOKED'
    );
    if (!currentHead) {
      return { ok: false, error: 'Only the current Head Coach can transfer ownership.' };
    }
    const nextHead = doc.memberships.find(
      (m) =>
        m.membershipId === params.newHeadCoachMembershipId &&
        m.status === 'ACTIVE' &&
        Boolean(m.userSid)
    );
    if (!nextHead) {
      return {
        ok: false,
        error: 'Successor must have an active signed-in MeetReady membership.',
      };
    }
    currentHead.role = 'ASSISTANT_COACH';
    nextHead.role = 'HEAD_COACH';
    nextHead.isMinorU18 = false;
    doc.brand.coachDisplayName = nextHead.invitedName || doc.brand.coachDisplayName;
    doc.updatedAt = new Date().toISOString();
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'OWNERSHIP_TRANSFERRED',
      targetId: nextHead.membershipId,
      metadata: { nextHeadName: nextHead.invitedName },
    });
    return {
      ok: true,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}

/**
 * Merges a pre-seeded/imported `INVITED` ghost row (`sourceMembershipId` holding Trackside Stopwatch splits
 * or Athletic.net official marks) onto the athlete's claimed `ACTIVE` row (`targetMembershipId`).
 */
export async function mergeDuplicateRosterMembers(params: {
  callerSid: string;
  teamId: string;
  sourceMembershipId: string;
  targetMembershipId: string;
  originUrl: string;
}): Promise<{ ok: boolean; summary?: TeamSummaryWithRole | null; error?: string }> {
  if (params.sourceMembershipId === params.targetMembershipId) {
    return { ok: false, error: 'Source and target roster rows must be different.' };
  }

  let archiveTarget: { member: StoredMembershipInternal; activities: UnifiedActivity[] } | null = null;

  const outcome = await withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: 'Team not found.' };
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (
      !callerMem ||
      (callerMem.role !== 'HEAD_COACH' &&
        callerMem.role !== 'ASSISTANT_COACH' &&
        callerMem.role !== 'ORG_ADMIN')
    ) {
      return { ok: false, error: 'Coach permissions required.' };
    }

    const source = doc.memberships.find((m) => m.membershipId === params.sourceMembershipId);
    const target = doc.memberships.find(
      (m) => m.membershipId === params.targetMembershipId && m.status !== 'REVOKED'
    );
    if (!source || !target) return { ok: false, error: 'Duplicate or target member not found.' };

    const mergedActsMap = new Map<string, UnifiedActivity>();
    for (const act of [
      ...(target.coachRecordedActivities || []),
      ...(source.coachRecordedActivities || []),
    ]) {
      if (act?.id && !mergedActsMap.has(act.id)) {
        mergedActsMap.set(act.id, act);
      }
    }
    const mergedActivities = Array.from(mergedActsMap.values()).slice(0, 80);
    target.coachRecordedActivities = mergedActivities;
    if (!target.seedMarkOrFtp && source.seedMarkOrFtp) target.seedMarkOrFtp = source.seedMarkOrFtp;
    if (!target.externalSource && source.externalSource) target.externalSource = source.externalSource;
    if (!target.externalAthleteId && source.externalAthleteId) {
      target.externalAthleteId = source.externalAthleteId;
    }
    if (!target.externalProfileUrl && source.externalProfileUrl) {
      target.externalProfileUrl = source.externalProfileUrl;
    }
    if (!target.graduationYear && source.graduationYear) target.graduationYear = source.graduationYear;
    if (!target.genderDivision && source.genderDivision) target.genderDivision = source.genderDivision;

    for (const bw of doc.broadcastWorkouts || []) {
      if (Array.isArray(bw.targetMembershipIds)) {
        bw.targetMembershipIds = bw.targetMembershipIds.map((id) =>
          id === source.membershipId ? target.membershipId : id
        );
      }
      if (bw.athleteOverrides && bw.athleteOverrides[source.membershipId]) {
        if (!bw.athleteOverrides[target.membershipId]) {
          bw.athleteOverrides[target.membershipId] = bw.athleteOverrides[source.membershipId];
        }
        delete bw.athleteOverrides[source.membershipId];
      }
    }

    source.status = 'REVOKED';
    source.leftAt = new Date().toISOString();
    sanitizeMemberPublicNameForDeletion(source);
    source.coachRecordedActivities = undefined;

    if (mergedActivities.length > 0 && (target.userSid || target.invitedEmail || target.stravaAthleteId)) {
      archiveTarget = { member: { ...target }, activities: mergedActivities };
    }

    doc.updatedAt = new Date().toISOString();
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'MEMBERS_MERGED',
      targetId: target.membershipId,
      metadata: { mergedSourceId: source.membershipId },
    });
    return {
      ok: true,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });

  if (archiveTarget) {
    const item = archiveTarget as { member: StoredMembershipInternal; activities: UnifiedActivity[] };
    await archiveCoachActivitiesForMember(item.member, item.activities).catch(() => undefined);
  }
  return outcome;
}

/**
 * Non-mutating lookup for `GET /api/teams/parent-consent` so email security prefetch scanners
 * never accidentally confirm parental consent.
 */
export async function previewParentConsentToken(token: string): Promise<{
  ok: boolean;
  athleteName?: string;
  teamName?: string;
  coachName?: string;
  sport?: string;
  parentEmail?: string;
  alreadyAcknowledged?: boolean;
  error?: string;
}> {
  const cleanToken = String(token || '').trim();
  if (!cleanToken) {
    return { ok: false, error: 'Invalid or missing parent consent token.' };
  }
  const targetHash = hashToken(cleanToken);
  const matchesToken = (m: StoredMembershipInternal): boolean =>
    Boolean(
      (m.parentConsentTokenHash && timingSafeStringEqual(m.parentConsentTokenHash, targetHash)) ||
        (m.parentConsentToken && timingSafeStringEqual(m.parentConsentToken, cleanToken))
    );
  const dir = await loadDirectory();
  for (const teamId of dir.allTeamIds) {
    const doc = await loadTeamDocRaw(teamId);
    if (!doc) continue;
    const mem = doc.memberships.find(
      (m) => matchesToken(m) && m.status !== 'REVOKED'
    );
    if (mem) {
      return {
        ok: true,
        athleteName: mem.invitedName,
        teamName: doc.brand.name,
        coachName: doc.brand.coachDisplayName,
        sport: doc.brand.primarySport,
        parentEmail: mem.parentGuardianEmail,
        alreadyAcknowledged: mem.parentConsentStatus === 'ACKNOWLEDGED',
      };
    }
  }
  return { ok: false, error: 'Invalid or expired parent consent link.' };
}

/**
 * Parent/guardian declines consent and immediately revokes minor team membership and telemetry.
 */
export async function declineAndPurgeParentConsent(token: string): Promise<{
  ok: boolean;
  athleteName?: string;
  teamName?: string;
  error?: string;
}> {
  const cleanToken = String(token || '').trim();
  if (!cleanToken) return { ok: false, error: 'Invalid or missing parent consent token.' };
  const targetHash = hashToken(cleanToken);
  const matchesToken = (m: StoredMembershipInternal): boolean =>
    Boolean(
      (m.parentConsentTokenHash && timingSafeStringEqual(m.parentConsentTokenHash, targetHash)) ||
        (m.parentConsentToken && timingSafeStringEqual(m.parentConsentToken, cleanToken))
    );
  const dir = await loadDirectory();
  for (const teamId of dir.allTeamIds) {
    const doc = await loadTeamDocRaw(teamId);
    if (!doc) continue;
    const targetMem = doc.memberships.find(
      (m) => matchesToken(m) && m.status !== 'REVOKED'
    );
    if (!targetMem) continue;

    let detachedSid: string | undefined;
    const athleteName = targetMem.invitedName;
    const teamName = doc.brand.name;

    await withTeamRowLock(teamId, async () => {
      const freshDoc = await loadTeamDocRaw(teamId);
      if (!freshDoc) return;
      const mem = freshDoc.memberships.find((m) => matchesToken(m));
      if (!mem) return;
      detachedSid = mem.userSid;
      const targetMembershipIds = new Set<string>([mem.membershipId]);
      const targetSids = new Set<string>(mem.userSid ? [mem.userSid] : []);
      const emails = mem.invitedEmail ? [mem.invitedEmail] : [];
      const injuryCaseIds = collectMemberInjuryCaseIds(freshDoc, targetMembershipIds);
      scrubMemberFromTeamDocument({
        doc: freshDoc,
        targetMembershipIds,
        targetSids,
        replacementName: 'Withdrawn Minor',
      });
      const updatedFieldCount = await scrubMemberSidecarVaultsAndPostgres({
        teamId,
        targetMembershipIds,
        targetSids,
        emails,
        injuryCaseIds,
      });
      if (typeof updatedFieldCount === 'number') {
        freshDoc.fieldMarkLogsTotalCount = updatedFieldCount;
      } else if (Array.isArray(freshDoc.fieldMarkLogs)) {
        freshDoc.fieldMarkLogsTotalCount = freshDoc.fieldMarkLogs.length;
      }
      await saveTeamDocRaw(teamId, freshDoc);
      await appendAuditLogAsync({
        teamId,
        actorSid: 'guardian',
        action: 'PARENT_CONSENT_DECLINED',
        targetId: mem.membershipId,
        metadata: { consentOutcome: 'DECLINED_AND_PURGED' },
      });
    });

    if (detachedSid) {
      await removeTeamFromUserIndex(detachedSid, teamId).catch(() => undefined);
    }
    return { ok: true, athleteName, teamName };
  }
  return { ok: false, error: 'Invalid or expired parent consent link.' };
}

/**
 * Generates or rotates a 1-click Parent / Guardian safeguarding acknowledgement URL
 * for an athlete membership and optionally emails it when parentGuardianEmail is available.
 */
export async function issueOrResendParentConsentLink(params: {
  callerSid: string;
  teamId: string;
  membershipId: string;
  originUrl: string;
  parentGuardianEmail?: string;
}): Promise<{
  ok: boolean;
  consentUrl?: string;
  emailStatus?: 'SENT_RESEND' | 'READY_MANUAL_LINK' | 'FAILED';
  team?: TeamSummaryWithRole | null;
  error?: string;
}> {
  const cleanOrigin = params.originUrl.replace(/\/+$/, '');
  const cleanIncomingEmail = params.parentGuardianEmail?.trim().toLowerCase();
  if (cleanIncomingEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanIncomingEmail)) {
    return { ok: false, error: 'Enter a valid parent or guardian email address.' };
  }

  let emailTarget: { to: string; subject: string; html: string; text: string } | null = null;
  const lockedOutcome = await withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: 'Team not found.' };

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (
      !callerMem ||
      (callerMem.role !== 'HEAD_COACH' &&
        callerMem.role !== 'ASSISTANT_COACH' &&
        callerMem.role !== 'ORG_ADMIN')
    ) {
      return { ok: false, error: 'Coach or admin permissions required.' };
    }

    const mem = doc.memberships.find(
      (m) =>
        m.membershipId === params.membershipId &&
        m.role === 'ATHLETE' &&
        m.status !== 'REVOKED'
    );
    if (!mem) return { ok: false, error: 'Roster athlete not found.' };

    if (cleanIncomingEmail) {
      mem.parentGuardianEmail = cleanIncomingEmail;
    }

    const rawConsentToken = crypto.randomBytes(16).toString('base64url');
    mem.parentConsentTokenHash = hashToken(rawConsentToken);
    mem.parentConsentToken = undefined;
    if (mem.parentConsentStatus !== 'ACKNOWLEDGED') {
      mem.parentConsentStatus = 'PENDING';
    }

    const consentUrl = `${cleanOrigin}/api/teams/parent-consent?token=${rawConsentToken}`;
    if (mem.parentGuardianEmail) {
      const content = buildParentConsentEmailContent({
        brand: doc.brand,
        athleteName: mem.invitedName,
        parentConsentUrl: consentUrl,
      });
      emailTarget = { to: mem.parentGuardianEmail, ...content };
    }

    doc.updatedAt = new Date().toISOString();
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'PARENT_CONSENT_LINK_ISSUED',
      targetId: mem.membershipId,
      metadata: {
        athleteName: mem.invitedName,
        hasParentEmail: Boolean(mem.parentGuardianEmail),
      },
    });

    return {
      ok: true,
      consentUrl,
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });

  if (!lockedOutcome || !lockedOutcome.ok || !lockedOutcome.consentUrl) {
    return { ok: false, error: lockedOutcome?.error || 'Could not issue parent consent link.' };
  }

  let emailStatus: 'SENT_RESEND' | 'READY_MANUAL_LINK' | 'FAILED' = 'READY_MANUAL_LINK';
  if (emailTarget) {
    const sendRes = await sendEmailViaResend(emailTarget);
    emailStatus = sendRes.status;
  }

  return {
    ok: true,
    consentUrl: lockedOutcome.consentUrl,
    emailStatus,
    team: lockedOutcome.team,
  };
}

export async function removeTeamFromDirectoryAndVault(teamId: string): Promise<void> {
  const memberSids: string[] = [];
  await withVaultLock(TEAMS_DIRECTORY_KEY, async () => {
    const doc = await loadTeamDocRaw(teamId);
    const dir = await loadDirectory();
    if (doc) {
      delete dir.bySlug[doc.brand.slug];
      delete dir.byJoinCode[doc.brand.joinCode.toUpperCase()];
      for (const m of doc.memberships || []) {
        if (m.userSid) memberSids.push(m.userSid);
      }
    }
    dir.allTeamIds = dir.allTeamIds.filter((id) => id !== teamId);
    await saveTenantVaultAsync(TEAMS_DIRECTORY_KEY, dir);
  });
  for (const sid of memberSids) {
    await removeTeamFromUserIndex(sid, teamId).catch(() => undefined);
  }
  const safeId = sanitizeTenantId(teamId);
  await deleteTenantVault(teamDocVaultKey(teamId)).catch(() => undefined);
  await deleteTenantVault(teamFieldLogsVaultKey(teamId)).catch(() => undefined);
  await deleteTenantVault(`audit_log_${safeId.slice(0, 40)}`).catch(() => undefined);
  await deleteTenantVault(`team_parent_email_subs_${safeId.slice(0, 40)}`).catch(() => undefined);
  await deleteTenantVault(`team_parent_email_subs_${safeId}`).catch(() => undefined);
  await deleteTeamPostgresRowsAsync(teamId).catch(() => undefined);
}
