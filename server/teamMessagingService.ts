import crypto from 'crypto';
import type {
  CoachEventGroup,
  TeamMessageChannelScope,
  TeamMessageRecord,
  TeamMessagingPolicy,
  TeamSummaryWithRole,
} from '../src/types.ts';
import { resolveAthleteAgeTier } from '../src/physiology/ageAndComplianceEngine.ts';
import { normalizeCoachEventGroup } from '../src/physiology/teamOnboardingEngine.ts';
import { isResendConfigured, sendEmailViaResend } from './teamEmailAndOtpService.ts';
import { dispatchTeamPushNotifications } from './pushNotificationService.ts';
import {
  canManageTeamGovernanceRole,
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

export async function postTeamMessage(params: {
  callerSid: string;
  teamId: string;
  channelScope: TeamMessageChannelScope;
  eventGroup?: CoachEventGroup | string;
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
  error?: string;
}> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, status: 404, error: 'Team not found.' };

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED' && m.status !== 'ALUMNI'
    );
    if (!callerMem) {
      return { ok: false, status: 403, error: 'Active team membership is required to send messages.' };
    }

    const cleanBody = String(params.body || '').trim().slice(0, 800);
    if (!cleanBody) {
      return { ok: false, status: 400, error: 'Message body is required.' };
    }

    const isStaff = canViewSafeguardingMedicalRole(callerMem.role);
    const isParentFollower = callerMem.role === 'PARENT_FOLLOWER';
    const policy = defaultPolicyForDoc(doc);
    const nowIso = new Date().toISOString();

    if (params.channelScope === 'COACHES_STAFF' && !isStaff) {
      return {
        ok: false,
        status: 403,
        error: 'Coaches & Staff channel is restricted to coaching, medical, and athletic admin staff.',
      };
    }

    if (isParentFollower && params.channelScope === 'EVENT_GROUP') {
      return {
        ok: false,
        status: 403,
        error: 'Parents may view announcements or message coaching staff transparently.',
      };
    }

    if (
      callerMem.role === 'ATHLETE' &&
      (params.channelScope === 'ALL_TEAM' || params.channelScope === 'EVENT_GROUP') &&
      !policy.athleteRepliesEnabled
    ) {
      return {
        ok: false,
        status: 403,
        error:
          'This team channel is currently set to coach announcements only. Use Direct (SafeSport CC) to message your coach.',
      };
    }

    let channelId = 'team:all';
    let resolvedEventGroup: CoachEventGroup | undefined;
    let targetMembershipId: string | undefined;
    let targetAthleteName: string | undefined;
    let guardianCcApplied = Boolean(doc.brand.enableParentGuardianCc);
    let guardianEmailNotified = false;

    if (params.channelScope === 'COACHES_STAFF') {
      channelId = 'staff:only';
      guardianCcApplied = false;
    } else if (params.channelScope === 'EVENT_GROUP') {
      resolvedEventGroup =
        (normalizeCoachEventGroup(String(params.eventGroup || '')) ||
          callerMem.eventGroup ||
          'DISTANCE') as CoachEventGroup;
      channelId = `group:${resolvedEventGroup}`;
    } else if (params.channelScope === 'DIRECT_TRANSPARENT') {
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
          ok: false,
          status: 404,
          error: 'Select a valid athlete on the roster for a transparent SafeSport message.',
        };
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
          ok: false,
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
        guardianEmailNotified = true;
        void sendEmailViaResend({
          to: targetMem.parentGuardianEmail,
          subject: `[MeetReady SafeSport CC] Coach message for ${targetMem.invitedName}`,
          html: `<p><strong>${escapeHtml(callerMem.invitedName || doc.brand.coachDisplayName)}</strong> (${escapeHtml(callerMem.role)}) sent a team message to ${escapeHtml(targetMem.invitedName)}:</p><blockquote>${escapeHtml(cleanBody)}</blockquote><p style="font-size:12px;color:#555;">Copied automatically under MeetReady SafeSport MAAPP two-adult transparency.</p>`,
          text: `${callerMem.invitedName || doc.brand.coachDisplayName} messaged ${targetMem.invitedName}: ${cleanBody}`,
        });
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
      ...(targetMembershipId ? { targetMembershipId } : {}),
      ...(targetAthleteName ? { targetAthleteName } : {}),
      senderSid: params.callerSid,
      senderMembershipId: callerMem.membershipId,
      senderName: callerMem.invitedName || doc.brand.coachDisplayName,
      senderRole: callerMem.role,
      body: cleanBody,
      createdAt: nowIso,
      guardianCcApplied,
      ...(guardianEmailNotified ? { guardianEmailNotified: true } : {}),
      secondAdultVisible: true,
      ...(quietHoursActive && !params.isEmergencyOverride ? { sentDuringQuietHours: true } : {}),
      ...(params.isEmergencyOverride ? { isEmergencyOverride: true } : {}),
      acknowledgedByMembershipIds: [callerMem.membershipId],
    };

    doc.teamMessages = [record, ...(doc.teamMessages || [])].slice(0, 500);
    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);

    void dispatchTeamPushNotifications({
      teamId: params.teamId,
      senderSid: params.callerSid,
      senderName: record.senderName,
      kind: 'TEAM_MESSAGE',
      channelScope: params.channelScope,
      eventGroup: resolvedEventGroup,
      targetMembershipId,
      bodyText: cleanBody,
      clientLocalHour: params.clientLocalHour,
      isEmergency: params.isEmergencyOverride === true,
    }).catch(() => {});

    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'TEAM_MESSAGE_SENT',
      targetId: targetMembershipId || channelId,
      metadata: {
        channelScope: params.channelScope,
        guardianCcApplied,
        secondAdultVisible: true,
        sentDuringQuietHours: Boolean(record.sentDuringQuietHours),
        isEmergencyOverride: Boolean(record.isEmergencyOverride),
      },
    });

    return {
      ok: true,
      message: record,
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
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
