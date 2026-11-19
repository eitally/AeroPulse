import { resolveAthleteAgeTier } from '../src/physiology/ageAndComplianceEngine.ts';
import { timingSafeStringEqual } from './securityUtils.ts';
import type {
  TeamInviteStatus,
  TeamMemberRole,
  TeamSummaryWithRole,
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
import { saveTenantVaultAsync, withVaultLock } from './tokenVault.ts';

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
  const archiveQueue: { member: StoredMembershipInternal; activities: any[] }[] = [];

  const result = await withVaultLock(teamDocVaultKey(params.teamId), async () => {
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
  return withVaultLock(teamDocVaultKey(params.teamId), async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: 'Team not found.' };

    const mem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!mem) return { ok: false, error: 'Membership not found.' };

    const canonicalBmy =
      mem.birthMonthYear ||
      params.verifiedUserBirthMonthYear ||
      (mem.isMinorU18 && !mem.birthYear ? undefined : params.birthMonthYear);
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
  let archiveTarget: { member: StoredMembershipInternal; activities: any[] } | null = null;
  let detachSid: string | undefined;

  const outcome = await withVaultLock(teamDocVaultKey(params.teamId), async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: 'Team not found.' };

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (
      !callerMem ||
      (callerMem.role !== 'HEAD_COACH' && callerMem.role !== 'ASSISTANT_COACH')
    ) {
      return { ok: false, error: 'Coach permissions required.' };
    }

    const target = doc.memberships.find((m) => m.membershipId === params.membershipId);
    if (!target) return { ok: false, error: 'Member not found.' };
    if (target.role === 'HEAD_COACH') {
      return { ok: false, error: 'Cannot remove or archive the Head Coach directly.' };
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
    return {
      ok: true,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });

  if (archiveTarget) {
    const item = archiveTarget as { member: StoredMembershipInternal; activities: any[] };
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
  const archiveList: Array<{ member: StoredMembershipInternal; activities: any[]; sid?: string }> = [];

  const res = await withVaultLock(teamDocVaultKey(params.teamId), async () => {
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
 * Promotes/demotes a claimed roster user between `ATHLETE` and `ASSISTANT_COACH` (`HEAD_COACH` only).
 */
export async function updateMemberRole(params: {
  callerSid: string;
  teamId: string;
  membershipId: string;
  role: Extract<TeamMemberRole, 'ATHLETE' | 'ASSISTANT_COACH'>;
  originUrl: string;
}): Promise<{ ok: boolean; summary?: TeamSummaryWithRole | null; error?: string }> {
  return withVaultLock(teamDocVaultKey(params.teamId), async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: 'Team not found.' };
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem || callerMem.role !== 'HEAD_COACH') {
      return { ok: false, error: 'Only the Head Coach can manage coaching staff roles.' };
    }
    const target = doc.memberships.find(
      (m) => m.membershipId === params.membershipId && m.status !== 'REVOKED'
    );
    if (!target || target.role === 'HEAD_COACH') {
      return { ok: false, error: 'Target member cannot be reassigned.' };
    }
    target.role = params.role;
    target.isMinorU18 = params.role === 'ASSISTANT_COACH' ? false : target.isMinorU18;
    doc.updatedAt = new Date().toISOString();
    await saveTeamDocRaw(params.teamId, doc);
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
  return withVaultLock(teamDocVaultKey(params.teamId), async () => {
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
        error: 'Successor must have an active signed-in THRESH membership.',
      };
    }
    currentHead.role = 'ASSISTANT_COACH';
    nextHead.role = 'HEAD_COACH';
    nextHead.isMinorU18 = false;
    doc.brand.coachDisplayName = nextHead.invitedName || doc.brand.coachDisplayName;
    doc.updatedAt = new Date().toISOString();
    await saveTeamDocRaw(params.teamId, doc);
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

  let archiveTarget: { member: StoredMembershipInternal; activities: any[] } | null = null;

  const outcome = await withVaultLock(teamDocVaultKey(params.teamId), async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: 'Team not found.' };
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (
      !callerMem ||
      (callerMem.role !== 'HEAD_COACH' && callerMem.role !== 'ASSISTANT_COACH')
    ) {
      return { ok: false, error: 'Coach permissions required.' };
    }

    const source = doc.memberships.find((m) => m.membershipId === params.sourceMembershipId);
    const target = doc.memberships.find(
      (m) => m.membershipId === params.targetMembershipId && m.status !== 'REVOKED'
    );
    if (!source || !target) return { ok: false, error: 'Duplicate or target member not found.' };

    const mergedActsMap = new Map<string, any>();
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
    return {
      ok: true,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });

  if (archiveTarget) {
    const item = archiveTarget as { member: StoredMembershipInternal; activities: any[] };
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

    await withVaultLock(teamDocVaultKey(teamId), async () => {
      const freshDoc = await loadTeamDocRaw(teamId);
      if (!freshDoc) return;
      const mem = freshDoc.memberships.find((m) => matchesToken(m));
      if (!mem) return;
      detachedSid = mem.userSid;
      mem.status = 'REVOKED';
      mem.leftAt = new Date().toISOString();
      mem.invitedName = 'Withdrawn Minor';
      sanitizeMemberPublicNameForDeletion(mem);
      mem.coachRecordedActivities = undefined;
      freshDoc.updatedAt = mem.leftAt;
      await saveTeamDocRaw(teamId, freshDoc);
    });

    if (detachedSid) {
      await removeTeamFromUserIndex(detachedSid, teamId).catch(() => undefined);
    }
    return { ok: true, athleteName, teamName };
  }
  return { ok: false, error: 'Invalid or expired parent consent link.' };
}

export async function removeTeamFromDirectoryAndVault(teamId: string): Promise<void> {
  await withVaultLock(TEAMS_DIRECTORY_KEY, async () => {
    const doc = await loadTeamDocRaw(teamId);
    const dir = await loadDirectory();
    if (doc) {
      delete dir.bySlug[doc.brand.slug];
      delete dir.byJoinCode[doc.brand.joinCode.toUpperCase()];
    }
    dir.allTeamIds = dir.allTeamIds.filter((id) => id !== teamId);
    await saveTenantVaultAsync(TEAMS_DIRECTORY_KEY, dir);
  });
}
