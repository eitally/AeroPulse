import crypto from 'crypto';
import type {
  TeamInjuryCaseRecord,
  TeamInjuryRtpStage,
  TeamSummaryWithRole,
} from '../src/types.ts';
import {
  normalizePainArea,
  stripClinicalNotesForRole,
} from '../src/physiology/injuryHubEngine.ts';
import {
  canViewSafeguardingMedicalRole,
  loadTeamDocRaw,
  projectTeamSummaryForCaller,
  saveTeamDocRaw,
} from './teamStoreCore.ts';
import { appendAuditLogAsync, withTeamRowLock } from './tokenVault.ts';

const VALID_RTP_STAGES = new Set<TeamInjuryRtpStage>([
  'OUT',
  'MODIFIED',
  'LIMITED',
  'CLEARED',
]);

const VALID_SEVERITIES = new Set<TeamInjuryCaseRecord['severity']>([
  'LOW',
  'MODERATE',
  'HIGH',
]);

function syncAthleteStatusFromInjuryCases(
  member: { status: string; membershipId: string },
  cases: TeamInjuryCaseRecord[]
): void {
  if (member.status === 'REVOKED' || member.status === 'ALUMNI') {
    return;
  }
  const activeCases = cases.filter((c) => c.membershipId === member.membershipId);
  if (activeCases.length === 0) return;

  const hasOutOrModified = activeCases.some(
    (c) => c.rtpStage === 'OUT' || c.rtpStage === 'MODIFIED'
  );
  if (hasOutOrModified) {
    member.status = 'INJURED';
    return;
  }

  const hasClearedOnly = activeCases.every((c) => c.rtpStage === 'CLEARED');
  if (hasClearedOnly && member.status === 'INJURED') {
    member.status = 'ACTIVE';
  }
}

export async function listTeamInjuryCases(params: {
  callerSid: string;
  teamId: string;
}): Promise<{
  ok: boolean;
  status?: number;
  cases?: TeamInjuryCaseRecord[];
  error?: string;
}> {
  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc) {
    return { ok: false, status: 404, error: 'Team not found.' };
  }

  const callerMem = doc.memberships.find(
    (m) => m.userSid === params.callerSid && m.status !== 'REVOKED' && m.status !== 'ALUMNI'
  );
  if (!callerMem || !canViewSafeguardingMedicalRole(callerMem.role)) {
    return {
      ok: false,
      status: 403,
      error: 'Coach, Athletic Trainer, or Org Admin permissions required.',
    };
  }

  const cases = stripClinicalNotesForRole(doc.injuryCases || [], callerMem.role);
  return { ok: true, cases };
}

export async function upsertTeamInjuryCase(params: {
  callerSid: string;
  teamId: string;
  originUrl: string;
  input: {
    id?: unknown;
    membershipId?: unknown;
    bodyRegion?: unknown;
    severity?: unknown;
    rtpStage?: unknown;
    restrictions?: unknown;
    coachGuidance?: unknown;
    privateClinicalNotes?: unknown;
    targetReturnDate?: unknown;
  };
}): Promise<{
  ok: boolean;
  status?: number;
  injuryCase?: TeamInjuryCaseRecord;
  cases?: TeamInjuryCaseRecord[];
  team?: TeamSummaryWithRole | null;
  error?: string;
}> {
  const membershipId = String(params.input?.membershipId || '').trim();
  if (!membershipId) {
    return { ok: false, status: 400, error: 'Athlete membershipId is required.' };
  }

  const bodyRegion = normalizePainArea(params.input?.bodyRegion);
  if (!bodyRegion) {
    return {
      ok: false,
      status: 400,
      error: 'Valid 13-region bodyRegion is required.',
    };
  }

  const rawStage = String(params.input?.rtpStage || '').trim().toUpperCase() as TeamInjuryRtpStage;
  if (!VALID_RTP_STAGES.has(rawStage)) {
    return {
      ok: false,
      status: 400,
      error: 'rtpStage must be OUT, MODIFIED, LIMITED, or CLEARED.',
    };
  }

  const rawSeverity = String(params.input?.severity || 'MODERATE')
    .trim()
    .toUpperCase() as TeamInjuryCaseRecord['severity'];
  if (!VALID_SEVERITIES.has(rawSeverity)) {
    return {
      ok: false,
      status: 400,
      error: 'severity must be LOW, MODERATE, or HIGH.',
    };
  }

  const restrictions = String(params.input?.restrictions || '').trim().slice(0, 320);
  const coachGuidance = String(params.input?.coachGuidance || '').trim().slice(0, 400);
  const rawTargetDate = String(params.input?.targetReturnDate || '').trim().slice(0, 10);
  const targetReturnDate = /^\d{4}-\d{2}-\d{2}$/.test(rawTargetDate)
    ? rawTargetDate
    : undefined;
  const requestedId =
    typeof params.input?.id === 'string'
      ? params.input.id.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
      : '';

  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) {
      return { ok: false, status: 404, error: 'Team not found.' };
    }

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED' && m.status !== 'ALUMNI'
    );
    if (!callerMem || !canViewSafeguardingMedicalRole(callerMem.role)) {
      return {
        ok: false,
        status: 403,
        error: 'Coach, Athletic Trainer, or Org Admin permissions required.',
      };
    }

    const targetMem = doc.memberships.find(
      (m) => m.membershipId === membershipId && m.status !== 'REVOKED'
    );
    if (!targetMem) {
      return { ok: false, status: 404, error: 'Athlete membership not found on this team.' };
    }

    const existingList = Array.isArray(doc.injuryCases) ? [...doc.injuryCases] : [];
    const existingCase = requestedId
      ? existingList.find((c) => c.id === requestedId)
      : undefined;
    if (existingCase && existingCase.membershipId !== targetMem.membershipId) {
      return {
        ok: false,
        status: 400,
        error: 'Injury case ID belongs to a different athlete membership.',
      };
    }

    const isTrainer = callerMem.role === 'ATHLETIC_TRAINER';
    const hasClinicalInput = params.input?.privateClinicalNotes !== undefined;
    const cleanClinicalInput = hasClinicalInput
      ? String(params.input?.privateClinicalNotes || '').trim().slice(0, 1200)
      : undefined;

    // Only ATHLETIC_TRAINER may read or write privateClinicalNotes; coach updates preserve existing AT notes untouched.
    const nextPrivateNotes = isTrainer
      ? hasClinicalInput
        ? cleanClinicalInput || undefined
        : existingCase?.privateClinicalNotes
      : existingCase?.privateClinicalNotes;

    const nowIso = new Date().toISOString();
    const savedCase: TeamInjuryCaseRecord = {
      id: existingCase?.id || requestedId || `inj_${crypto.randomBytes(6).toString('hex')}`,
      teamId: doc.brand.teamId,
      membershipId: targetMem.membershipId,
      athleteName: targetMem.invitedName,
      bodyRegion,
      severity: rawSeverity,
      rtpStage: rawStage,
      restrictions,
      coachGuidance,
      ...(nextPrivateNotes ? { privateClinicalNotes: nextPrivateNotes } : {}),
      ...(targetReturnDate ? { targetReturnDate } : {}),
      createdAt: existingCase?.createdAt || nowIso,
      updatedAt: nowIso,
      updatedBySid: params.callerSid,
      updatedByName: callerMem.invitedName || callerMem.role,
    };

    doc.injuryCases = [
      savedCase,
      ...existingList.filter((c) => c.id !== savedCase.id),
    ].slice(0, 200);

    if (rawStage === 'OUT' || rawStage === 'MODIFIED') {
      if (targetMem.status !== 'REVOKED' && targetMem.status !== 'ALUMNI') {
        targetMem.status = 'INJURED';
      }
    } else if (rawStage === 'CLEARED') {
      syncAthleteStatusFromInjuryCases(targetMem, doc.injuryCases);
    }

    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'INJURY_CASE_UPDATED',
      targetId: savedCase.id,
      metadata: {
        membershipId: targetMem.membershipId,
        athleteName: targetMem.invitedName,
        bodyRegion,
        severity: rawSeverity,
        rtpStage: rawStage,
        isNew: !existingCase,
        hasClinicalNotes: Boolean(savedCase.privateClinicalNotes),
      },
    });

    const visibleCases = stripClinicalNotesForRole(doc.injuryCases, callerMem.role);
    const visibleCase = stripClinicalNotesForRole([savedCase], callerMem.role)[0];

    return {
      ok: true,
      injuryCase: visibleCase,
      cases: visibleCases,
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}

export async function deleteTeamInjuryCase(params: {
  callerSid: string;
  teamId: string;
  caseId: string;
  originUrl: string;
}): Promise<{
  ok: boolean;
  status?: number;
  cases?: TeamInjuryCaseRecord[];
  team?: TeamSummaryWithRole | null;
  error?: string;
}> {
  const cleanCaseId = String(params.caseId || '').trim();
  if (!cleanCaseId) {
    return { ok: false, status: 400, error: 'Injury case ID is required.' };
  }

  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) {
      return { ok: false, status: 404, error: 'Team not found.' };
    }

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED' && m.status !== 'ALUMNI'
    );
    const canDeleteInjuryRole =
      callerMem &&
      (callerMem.role === 'ATHLETIC_TRAINER' ||
        callerMem.role === 'HEAD_COACH' ||
        callerMem.role === 'ORG_ADMIN');
    if (!callerMem || !canDeleteInjuryRole) {
      return {
        ok: false,
        status: 403,
        error:
          'Athletic Trainer, Head Coach, or Org Admin permissions required to delete injury cases.',
      };
    }

    const existingList = Array.isArray(doc.injuryCases) ? doc.injuryCases : [];
    const targetCase = existingList.find((c) => c.id === cleanCaseId);
    if (!targetCase) {
      return { ok: false, status: 404, error: 'Injury case not found.' };
    }
    if (
      callerMem.role !== 'ATHLETIC_TRAINER' &&
      Boolean(targetCase.privateClinicalNotes && targetCase.privateClinicalNotes.trim())
    ) {
      return {
        ok: false,
        status: 403,
        error: 'Only an Athletic Trainer may delete an injury case containing private clinical notes.',
      };
    }

    doc.injuryCases = existingList.filter((c) => c.id !== cleanCaseId);

    const targetMem = doc.memberships.find((m) => m.membershipId === targetCase.membershipId);
    if (
      targetMem &&
      (targetCase.rtpStage === 'OUT' || targetCase.rtpStage === 'MODIFIED') &&
      targetMem.status === 'INJURED'
    ) {
      const stillOutOrModified = doc.injuryCases.some(
        (c) =>
          c.membershipId === targetMem.membershipId &&
          (c.rtpStage === 'OUT' || c.rtpStage === 'MODIFIED')
      );
      if (!stillOutOrModified) {
        targetMem.status = 'ACTIVE';
      }
    }

    doc.updatedAt = new Date().toISOString();
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'INJURY_CASE_DELETED',
      targetId: cleanCaseId,
      metadata: {
        membershipId: targetCase.membershipId,
        bodyRegion: targetCase.bodyRegion,
      },
    });

    return {
      ok: true,
      cases: stripClinicalNotesForRole(doc.injuryCases, callerMem.role),
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}
