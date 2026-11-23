import crypto from 'crypto';
import type {
  CoachEventGroup,
  TeamCustomSubgroup,
  TeamMessageChannelScope,
  TeamMessageRecord,
  TeamMessagingPolicy,
  TeamSummaryWithRole,
} from '../src/types.ts';
import { resolveAthleteAgeTier } from '../src/physiology/ageAndComplianceEngine.ts';
import { normalizeCoachEventGroup } from '../src/physiology/teamOnboardingEngine.ts';
import {
  isResendConfigured,
  sendEmailViaResend,
  withBoundedTimeout,
} from './teamEmailAndOtpService.ts';
import { dispatchTeamPushNotifications } from './pushNotificationService.ts';
import {
  canManageTeamGovernanceRole,
  canProgramWorkoutsRole,
  canViewSafeguardingMedicalRole,
  loadTeamDocRaw,
  projectTeamSummaryForCaller,
  saveTeamDocRaw,
} from './teamStoreCore.ts';
import { appendAuditLogAsync, withTeamRowLock } from './tokenVault.ts';

function escapeHtml(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function defaultPolicyForDoc(doc: {
  brand: { orgType: string; defaultSafeSportShield: boolean };
  messagingPolicy?: TeamMessagingPolicy;
}): TeamMessagingPolicy {
  return {
    athleteRepliesEnabled: doc.messagingPolicy?.athleteRepliesEnabled ?? true,
    parentRepliesEnabled: doc.messagingPolicy?.parentRepliesEnabled ?? true,
    enablePushEmailFallback: doc.messagingPolicy?.enablePushEmailFallback ?? true,
    quietHoursStartHour: doc.messagingPolicy?.quietHoursStartHour ?? 21,
    quietHoursEndHour: doc.messagingPolicy?.quietHoursEndHour ?? 6,
    requireGuardianCcForMinors: Boolean(
      doc.brand.orgType === 'HIGH_SCHOOL' ||
        doc.brand.defaultSafeSportShield ||
        (doc.messagingPolicy?.requireGuardianCcForMinors ?? true)
    ),
  };
}

function isWithinQuietHours(hour: number | undefined, startHour: number, endHour: number): boolean {
  if (typeof hour !== 'number' || !Number.isFinite(hour) || hour < 0 || hour > 23) return false;
  if (startHour === endHour) return false;
  if (startHour > endHour) {
    return hour >= startHour || hour < endHour;
  }
  return hour >= startHour && hour < endHour;
}

const ALLOWED_CHANNEL_SCOPES = new Set<TeamMessageChannelScope>([
  'ALL_TEAM',
  'EVENT_GROUP',
  'PARENTS_ONLY',
  'CUSTOM_SUBGROUP',
  'DIRECT_TRANSPARENT',
  'COACHES_STAFF',
]);

export async function postTeamMessage(params: {
  callerSid: string;
  teamId: string;
  channelScope: TeamMessageChannelScope;
  eventGroup?: CoachEventGroup | string;
  customSubgroupId?: string;
  targetMembershipId?: string;
  body: string;
  privateDirectToMinor?: boolean;
  guardianCc?: boolean;
  clientLocalHour?: number;
  isEmergencyOverride?: boolean;
  originUrl: string;
}): Promise<{
  ok: boolean;
  status?: number;
  message?: TeamMessageRecord;
  team?: TeamSummaryWithRole | null;
  emailFallbackCount?: number;
  error?: string;
}> {
  if (!ALLOWED_CHANNEL_SCOPES.has(params.channelScope)) {
    return { ok: false, status: 400, error: 'Invalid team message channel scope.' };
  }

  let pendingGuardianEmail: { to: string; subject: string; html: string; text: string } | null = null;
  let pendingPushPayload: Parameters<typeof dispatchTeamPushNotifications>[0] | null = null;

  const lockedResult = await withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false as const, status: 404, error: 'Team not found.' };

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED' && m.status !== 'ALUMNI'
    );
    if (!callerMem) {
      return { ok: false as const, status: 403, error: 'Active team membership is required to send messages.' };
    }

    const cleanBody = String(params.body || '').trim().slice(0, 800);
    if (!cleanBody) {
      return { ok: false as const, status: 400, error: 'Message body is required.' };
    }

    const isStaff = canViewSafeguardingMedicalRole(callerMem.role);
    const isParentFollower = callerMem.role === 'PARENT_FOLLOWER';
    const effectiveEmergencyOverride = isStaff && params.isEmergencyOverride === true;
    const policy = defaultPolicyForDoc(doc);
    const nowIso = new Date().toISOString();

    if (params.channelScope === 'COACHES_STAFF' && !isStaff) {
      return {
        ok: false as const,
        status: 403,
        error: 'Coaches & Staff channel is restricted to coaching, medical, and athletic admin staff.',
      };
    }

    if (params.channelScope === 'PARENTS_ONLY' && callerMem.role === 'ATHLETE') {
      return {
        ok: false as const,
        status: 403,
        error: 'Athletes cannot post to or view the Parents Only channel.',
      };
    }

    if (params.channelScope === 'PARENTS_ONLY' && isParentFollower && policy.parentRepliesEnabled === false) {
      return {
        ok: false as const,
        status: 403,
        error: 'Parent replies in Parents Only are currently set to coach-announcements-only.',
      };
    }

    if (
      isParentFollower &&
      (params.channelScope === 'ALL_TEAM' ||
        params.channelScope === 'EVENT_GROUP' ||
        params.channelScope === 'COACHES_STAFF')
    ) {
      return {
        ok: false as const,
        status: 403,
        error: 'Parents may use Parents Only, linked sub-groups, or transparent Direct threads with coaching staff.',
      };
    }

    if (
      callerMem.role === 'ATHLETE' &&
      (params.channelScope === 'ALL_TEAM' || params.channelScope === 'EVENT_GROUP') &&
      !policy.athleteRepliesEnabled
    ) {
      return {
        ok: false as const,
        status: 403,
        error:
          'This team channel is currently set to coach announcements only. Use Direct (SafeSport CC) to message your coach.',
      };
    }

    let channelId = 'team:all';
    let resolvedEventGroup: CoachEventGroup | undefined;
    let customSubgroupId: string | undefined;
    let customSubgroupName: string | undefined;
    let targetMembershipId: string | undefined;
    let targetAthleteName: string | undefined;
    let guardianCcApplied = Boolean(doc.brand.enableParentGuardianCc);

    if (params.channelScope === 'COACHES_STAFF') {
      channelId = 'staff:only';
      guardianCcApplied = false;
    } else if (params.channelScope === 'PARENTS_ONLY') {
      channelId = 'parents';
      guardianCcApplied = true;
    } else if (params.channelScope === 'CUSTOM_SUBGROUP') {
      const requestedId = String(params.customSubgroupId || '').trim();
      const subgroup = (doc.customSubgroups || []).find((sg) => sg.id === requestedId);
      if (!subgroup) {
        return {
          ok: false as const,
          status: 404,
          error: 'Select a valid team sub-group.',
        };
      }
      const isDirectMember = subgroup.memberIds.includes(callerMem.membershipId);
      const callerParentEmail = callerMem.invitedEmail?.trim().toLowerCase();
      const isLinkedParentMember =
        isParentFollower &&
        subgroup.includeLinkedParents !== false &&
        Boolean(callerParentEmail) &&
        doc.memberships.some(
          (child) =>
            subgroup.memberIds.includes(child.membershipId) &&
            child.parentGuardianEmail?.trim().toLowerCase() === callerParentEmail
        );
      if (!isStaff && !isDirectMember && !isLinkedParentMember) {
        return {
          ok: false as const,
          status: 403,
          error: 'You are not assigned to this team sub-group.',
        };
      }
      if (callerMem.role === 'ATHLETE' && !policy.athleteRepliesEnabled) {
        return {
          ok: false as const,
          status: 403,
          error:
            'Athlete replies are currently set to coach announcements only. Use Direct (SafeSport CC) to message your coach.',
        };
      }
      if (isParentFollower && policy.parentRepliesEnabled === false) {
        return {
          ok: false as const,
          status: 403,
          error: 'Parent replies are currently set to coach announcements only.',
        };
      }
      const hasMinorInSubgroup = doc.memberships.some(
        (m) =>
          subgroup.memberIds.includes(m.membershipId) &&
          (m.isMinorU18 || doc.brand.orgType === 'HIGH_SCHOOL')
      );
      channelId = `subgroup:${subgroup.id}`;
      customSubgroupId = subgroup.id;
      customSubgroupName = subgroup.name;
      guardianCcApplied = Boolean(hasMinorInSubgroup || subgroup.includeLinkedParents !== false);
    } else if (params.channelScope === 'EVENT_GROUP') {
      resolvedEventGroup =
        (normalizeCoachEventGroup(String(params.eventGroup || '')) ||
          callerMem.eventGroup ||
          'DISTANCE') as CoachEventGroup;
      channelId = `group:${resolvedEventGroup}`;
    } else if (params.channelScope === 'DIRECT_TRANSPARENT') {
      const callerParentEmail = callerMem.invitedEmail?.trim().toLowerCase();
      if (isParentFollower && !callerParentEmail) {
        return {
          ok: false as const,
          status: 403,
          error: 'Parents may only message coaches in the transparent thread of their linked child athlete.',
        };
      }
      const targetMem =
        callerMem.role === 'ATHLETE'
          ? callerMem
          : doc.memberships.find(
              (m) =>
                m.membershipId === params.targetMembershipId &&
                m.status !== 'REVOKED' &&
                m.role === 'ATHLETE'
            );
      if (!targetMem) {
        return {
          ok: false as const,
          status: 404,
          error: 'Select a valid athlete on the roster for a transparent SafeSport message.',
        };
      }
      if (isParentFollower) {
        const targetParentEmail = targetMem.parentGuardianEmail?.trim().toLowerCase();
        if (!callerParentEmail || !targetParentEmail || callerParentEmail !== targetParentEmail) {
          return {
            ok: false as const,
            status: 403,
            error: 'Parents may only message coaches in the transparent thread of their linked child athlete.',
          };
        }
      }

      const ageResolved = resolveAthleteAgeTier({
        birthMonthYear: targetMem.birthMonthYear,
        birthYear: targetMem.birthYear,
        orgType: doc.brand.orgType,
        graduationYear: targetMem.graduationYear,
      });
      const targetIsProtectedMinor = Boolean(
        (ageResolved.ageTier === 'UNKNOWN' ? targetMem.isMinorU18 : ageResolved.isMinorU18) ||
          doc.brand.orgType === 'HIGH_SCHOOL'
      );

      if (
        (targetIsProtectedMinor || policy.requireGuardianCcForMinors) &&
        (params.privateDirectToMinor === true || params.guardianCc === false)
      ) {
        return {
          ok: false as const,
          status: 403,
          error:
            'SafeSport MAAPP policy prohibits private 1:1 messages with minor athletes. Parent/Guardian CC and coaching staff oversight are mandatory.',
        };
      }

      channelId = `dm:${targetMem.membershipId}`;
      targetMembershipId = targetMem.membershipId;
      targetAthleteName = targetMem.invitedName;
      guardianCcApplied = Boolean(
        targetIsProtectedMinor || doc.brand.enableParentGuardianCc || targetMem.parentGuardianEmail
      );

      if (
        guardianCcApplied &&
        targetMem.parentGuardianEmail &&
        callerMem.userSid !== targetMem.userSid &&
        isResendConfigured()
      ) {
        pendingGuardianEmail = {
          to: targetMem.parentGuardianEmail,
          subject: `[MeetReady SafeSport CC] Coach message for ${targetMem.invitedName}`,
          html: `<p><strong>${escapeHtml(callerMem.invitedName || doc.brand.coachDisplayName)}</strong> (${escapeHtml(callerMem.role)}) sent a team message to ${escapeHtml(targetMem.invitedName)}:</p><blockquote>${escapeHtml(cleanBody)}</blockquote><p style="font-size:12px;color:#555;">Copied automatically under MeetReady SafeSport MAAPP two-adult transparency.</p>`,
          text: `${callerMem.invitedName || doc.brand.coachDisplayName} messaged ${targetMem.invitedName}: ${cleanBody}`,
        };
      }
    }

    const quietHoursActive = isWithinQuietHours(
      params.clientLocalHour,
      policy.quietHoursStartHour,
      policy.quietHoursEndHour
    );

    const record: TeamMessageRecord = {
      id: `msg_${crypto.randomBytes(6).toString('hex')}`,
      teamId: doc.brand.teamId,
      channelId,
      channelScope: params.channelScope,
      ...(resolvedEventGroup ? { eventGroup: resolvedEventGroup } : {}),
      ...(customSubgroupId ? { customSubgroupId } : {}),
      ...(customSubgroupName ? { customSubgroupName } : {}),
      ...(targetMembershipId ? { targetMembershipId } : {}),
      ...(targetAthleteName ? { targetAthleteName } : {}),
      senderSid: params.callerSid,
      senderMembershipId: callerMem.membershipId,
      senderName: callerMem.invitedName || doc.brand.coachDisplayName,
      senderRole: callerMem.role,
      body: cleanBody,
      createdAt: nowIso,
      guardianCcApplied,
      ...(pendingGuardianEmail ? { guardianEmailNotified: false } : {}),
      secondAdultVisible: true,
      ...(quietHoursActive && !effectiveEmergencyOverride ? { sentDuringQuietHours: true } : {}),
      ...(effectiveEmergencyOverride ? { isEmergencyOverride: true } : {}),
      acknowledgedByMembershipIds: [callerMem.membershipId],
    };

    doc.teamMessages = [record, ...(doc.teamMessages || [])].slice(0, 500);
    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);

    pendingPushPayload = {
      teamId: params.teamId,
      senderSid: params.callerSid,
      senderName: record.senderName,
      kind: 'TEAM_MESSAGE',
      channelScope: params.channelScope,
      eventGroup: resolvedEventGroup,
      customSubgroupId,
      targetMembershipId,
      bodyText: cleanBody,
      clientLocalHour: params.clientLocalHour,
      isEmergency: effectiveEmergencyOverride,
      originUrl: params.originUrl,
      ...(pendingGuardianEmail ? { excludeFallbackEmails: [pendingGuardianEmail.to] } : {}),
    };

    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'TEAM_MESSAGE_SENT',
      targetId: targetMembershipId || channelId,
      metadata: {
        channelScope: params.channelScope,
        ...(customSubgroupId ? { customSubgroupId } : {}),
        guardianCcApplied,
        secondAdultVisible: true,
        sentDuringQuietHours: Boolean(record.sentDuringQuietHours),
        isEmergencyOverride: Boolean(record.isEmergencyOverride),
      },
    });

    return {
      ok: true as const,
      message: record,
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });

  if (!lockedResult.ok) {
    return lockedResult;
  }

  const emailToSend = pendingGuardianEmail as {
    to: string;
    subject: string;
    html: string;
    text: string;
  } | null;
  const pushToSend = pendingPushPayload as Parameters<typeof dispatchTeamPushNotifications>[0] | null;

  const [emailOutcome, pushOutcome] = await Promise.allSettled([
    emailToSend
      ? withBoundedTimeout(sendEmailViaResend(emailToSend), 8000, 'guardian-dm-email')
      : Promise.resolve(null),
    pushToSend
      ? withBoundedTimeout(dispatchTeamPushNotifications(pushToSend), 8000, 'team-message-push')
      : Promise.resolve(null),
  ]);

  const emailDelivered =
    Boolean(emailToSend) &&
    emailOutcome.status === 'fulfilled' &&
    emailOutcome.value !== null &&
    emailOutcome.value.delivered === true;

  const pushEmailFallbackCount =
    pushOutcome.status === 'fulfilled' && pushOutcome.value !== null
      ? pushOutcome.value.emailFallbackCount || 0
      : 0;

  if (emailDelivered || pushEmailFallbackCount > 0) {
    const refreshedTeam = await withTeamRowLock(params.teamId, async () => {
      const freshDoc = await loadTeamDocRaw(params.teamId);
      if (!freshDoc) return null;
      const targetMsg = (freshDoc.teamMessages || []).find((m) => m.id === lockedResult.message.id);
      if (targetMsg) {
        if (emailDelivered) targetMsg.guardianEmailNotified = true;
        if (pushEmailFallbackCount > 0) targetMsg.emailFallbackCount = pushEmailFallbackCount;
        freshDoc.updatedAt = new Date().toISOString();
        await saveTeamDocRaw(params.teamId, freshDoc);
      }
      return projectTeamSummaryForCaller(freshDoc, params.callerSid, params.originUrl);
    });
    if (emailDelivered) lockedResult.message.guardianEmailNotified = true;
    if (pushEmailFallbackCount > 0) {
      lockedResult.message.emailFallbackCount = pushEmailFallbackCount;
    }
    if (refreshedTeam) {
      lockedResult.team = refreshedTeam;
    }
  }

  return {
    ...lockedResult,
    ...(pushEmailFallbackCount > 0 ? { emailFallbackCount: pushEmailFallbackCount } : {}),
  };
}

export async function acknowledgeTeamMessage(params: {
  callerSid: string;
  teamId: string;
  messageId: string;
  originUrl: string;
}): Promise<{ ok: boolean; status?: number; team?: TeamSummaryWithRole | null; error?: string }> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, status: 404, error: 'Team not found.' };

    const projected = projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
    if (!projected) return { ok: false, status: 403, error: 'Membership required.' };

    const canSee = (projected.teamMessages || []).some((m) => m.id === params.messageId);
    if (!canSee) return { ok: false, status: 404, error: 'Message not found or not accessible.' };

    const target = (doc.teamMessages || []).find((m) => m.id === params.messageId);
    if (!target) return { ok: false, status: 404, error: 'Message not found.' };

    const existingAcks = new Set(target.acknowledgedByMembershipIds || []);
    existingAcks.add(projected.myMembershipId);
    target.acknowledgedByMembershipIds = Array.from(existingAcks);
    doc.updatedAt = new Date().toISOString();
    await saveTeamDocRaw(params.teamId, doc);

    return {
      ok: true,
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}

export async function flagTeamMessageForReview(params: {
  callerSid: string;
  teamId: string;
  messageId: string;
  reason?: string;
  originUrl: string;
}): Promise<{ ok: boolean; status?: number; team?: TeamSummaryWithRole | null; error?: string }> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, status: 404, error: 'Team not found.' };

    const projected = projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
    if (!projected) return { ok: false, status: 403, error: 'Membership required.' };

    const canSee = (projected.teamMessages || []).some((m) => m.id === params.messageId);
    if (!canSee) return { ok: false, status: 404, error: 'Message not found or not accessible.' };

    const target = (doc.teamMessages || []).find((m) => m.id === params.messageId);
    if (!target) return { ok: false, status: 404, error: 'Message not found.' };

    const cleanReason = String(params.reason || 'Flagged for athletic administrator review').trim().slice(0, 200);
    target.flaggedForAdminReview = true;
    target.flaggedReason = cleanReason;
    doc.updatedAt = new Date().toISOString();
    await saveTeamDocRaw(params.teamId, doc);

    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'TEAM_MESSAGE_FLAGGED',
      targetId: target.id,
      metadata: {
        channelId: target.channelId,
        reason: cleanReason,
      },
    });

    return {
      ok: true,
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}

export async function updateTeamMessagingPolicy(params: {
  callerSid: string;
  teamId: string;
  athleteRepliesEnabled?: boolean;
  parentRepliesEnabled?: boolean;
  enablePushEmailFallback?: boolean;
  quietHoursStartHour?: number;
  quietHoursEndHour?: number;
  originUrl: string;
}): Promise<{ ok: boolean; status?: number; team?: TeamSummaryWithRole | null; error?: string }> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, status: 404, error: 'Team not found.' };

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem || !canManageTeamGovernanceRole(callerMem.role)) {
      return {
        ok: false,
        status: 403,
        error: 'Only Head Coaches or Athletic Admins may change team messaging rules.',
      };
    }

    const current = defaultPolicyForDoc(doc);
    doc.messagingPolicy = {
      athleteRepliesEnabled:
        typeof params.athleteRepliesEnabled === 'boolean'
          ? params.athleteRepliesEnabled
          : current.athleteRepliesEnabled,
      parentRepliesEnabled:
        typeof params.parentRepliesEnabled === 'boolean'
          ? params.parentRepliesEnabled
          : current.parentRepliesEnabled ?? true,
      enablePushEmailFallback:
        typeof params.enablePushEmailFallback === 'boolean'
          ? params.enablePushEmailFallback
          : current.enablePushEmailFallback ?? true,
      quietHoursStartHour:
        typeof params.quietHoursStartHour === 'number' &&
        params.quietHoursStartHour >= 0 &&
        params.quietHoursStartHour <= 23
          ? Math.round(params.quietHoursStartHour)
          : current.quietHoursStartHour,
      quietHoursEndHour:
        typeof params.quietHoursEndHour === 'number' &&
        params.quietHoursEndHour >= 0 &&
        params.quietHoursEndHour <= 23
          ? Math.round(params.quietHoursEndHour)
          : current.quietHoursEndHour,
      requireGuardianCcForMinors: Boolean(
        doc.brand.orgType === 'HIGH_SCHOOL' ||
          doc.brand.defaultSafeSportShield ||
          current.requireGuardianCcForMinors
      ),
    };
    doc.updatedAt = new Date().toISOString();
    await saveTeamDocRaw(params.teamId, doc);

    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'TEAM_MESSAGING_POLICY_UPDATED',
      targetId: params.teamId,
      metadata: doc.messagingPolicy as unknown as Record<string, unknown>,
    });

    return {
      ok: true,
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}

export async function upsertTeamCustomSubgroup(params: {
  callerSid: string;
  teamId: string;
  subgroupId?: string;
  name: string;
  description?: string;
  memberIds: string[];
  includeLinkedParents?: boolean;
  originUrl: string;
}): Promise<{
  ok: boolean;
  status?: number;
  subgroup?: TeamCustomSubgroup;
  team?: TeamSummaryWithRole | null;
  error?: string;
}> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, status: 404, error: 'Team not found.' };

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED' && m.status !== 'ALUMNI'
    );
    if (!callerMem || (!canProgramWorkoutsRole(callerMem.role) && callerMem.role !== 'ORG_ADMIN')) {
      return {
        ok: false,
        status: 403,
        error: 'Coaching or Athletic Admin permissions are required to manage team sub-groups.',
      };
    }

    const cleanName = String(params.name || '').trim().slice(0, 48);
    if (cleanName.length < 2) {
      return { ok: false, status: 400, error: 'Sub-group name must be at least 2 characters.' };
    }

    const activeMemberSet = new Set(
      doc.memberships
        .filter((m) => m.status !== 'REVOKED' && m.status !== 'ALUMNI')
        .map((m) => m.membershipId)
    );
    const validMemberIds = Array.from(
      new Set(
        (Array.isArray(params.memberIds) ? params.memberIds : [])
          .map((id) => String(id || '').trim())
          .filter((id) => activeMemberSet.has(id))
      )
    );

    const existingList = doc.customSubgroups || [];
    const targetId = params.subgroupId ? String(params.subgroupId).trim() : '';
    const existingIdx = targetId ? existingList.findIndex((g) => g.id === targetId) : -1;

    if (existingIdx < 0 && existingList.length >= 20) {
      return {
        ok: false,
        status: 400,
        error: 'Maximum of 20 custom sub-groups per team reached.',
      };
    }

    const nowIso = new Date().toISOString();
    const cleanDesc = params.description ? String(params.description).trim().slice(0, 140) : undefined;
    const saved: TeamCustomSubgroup = {
      id: existingIdx >= 0 ? existingList[existingIdx].id : `sgrp_${crypto.randomBytes(5).toString('hex')}`,
      name: cleanName,
      ...(cleanDesc ? { description: cleanDesc } : {}),
      memberIds: validMemberIds,
      includeLinkedParents: params.includeLinkedParents !== false,
      createdByMembershipId:
        existingIdx >= 0 ? existingList[existingIdx].createdByMembershipId : callerMem.membershipId,
      createdByName:
        existingIdx >= 0
          ? existingList[existingIdx].createdByName
          : callerMem.invitedName || doc.brand.coachDisplayName || 'Coach',
      createdAt: existingIdx >= 0 ? existingList[existingIdx].createdAt : nowIso,
    };

    const nextList =
      existingIdx >= 0
        ? existingList.map((g, i) => (i === existingIdx ? saved : g))
        : [saved, ...existingList];

    doc.customSubgroups = nextList;
    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);

    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'CUSTOM_SUBGROUP_SAVED',
      targetId: saved.id,
      metadata: {
        name: saved.name,
        memberCount: saved.memberIds.length,
        includeLinkedParents: saved.includeLinkedParents,
      },
    });

    return {
      ok: true,
      subgroup: saved,
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}

export async function deleteTeamCustomSubgroup(params: {
  callerSid: string;
  teamId: string;
  subgroupId: string;
  originUrl: string;
}): Promise<{ ok: boolean; status?: number; team?: TeamSummaryWithRole | null; error?: string }> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, status: 404, error: 'Team not found.' };

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem || (!canProgramWorkoutsRole(callerMem.role) && callerMem.role !== 'ORG_ADMIN')) {
      return {
        ok: false,
        status: 403,
        error: 'Coaching or Athletic Admin permissions are required to delete sub-groups.',
      };
    }

    const beforeCount = (doc.customSubgroups || []).length;
    doc.customSubgroups = (doc.customSubgroups || []).filter((g) => g.id !== params.subgroupId);
    if (doc.customSubgroups.length === beforeCount) {
      return { ok: false, status: 404, error: 'Sub-group not found.' };
    }
    doc.updatedAt = new Date().toISOString();
    await saveTeamDocRaw(params.teamId, doc);

    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'CUSTOM_SUBGROUP_DELETED',
      targetId: params.subgroupId,
      metadata: {},
    });

    return {
      ok: true,
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}
