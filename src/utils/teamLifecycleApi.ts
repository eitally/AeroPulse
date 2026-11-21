import type {
  CoachDataSharingTier,
  GuardianSafetyAlertRecord,
  TeamAuditLogEntry,
  TeamMemberRole,
  TeamSummaryWithRole,
  TeamWorkoutComment,
  TeamWorkoutLibraryCategory,
  TeamWorkoutLibraryTemplate,
  ThreshUser,
} from '../types.ts';
import { getSavedIntervalsHeaders } from './telemetryStorage.ts';

export function buildThreshSessionHeaders(): Record<string, string> {
  const token =
    typeof window !== 'undefined'
      ? localStorage.getItem('aeropulse_session_token') || ''
      : '';
  return {
    'Content-Type': 'application/json',
    ...getSavedIntervalsHeaders(),
    ...(token ? { 'x-session-token': token } : {}),
  };
}

async function requestLifecycleJson<T>(url: string, init: RequestInit): Promise<T & { ok?: boolean; error?: string }> {
  const resp = await fetch(url, {
    credentials: 'include',
    headers: buildThreshSessionHeaders(),
    ...init,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error || 'Request failed.');
  }
  return data;
}

export function leaveOrGraduateTeamApi(
  teamId: string,
  mode: 'LEAVE' | 'GRADUATE_ALUMNI',
  origin?: string
) {
  return requestLifecycleJson<{ teams?: TeamSummaryWithRole[] }>(
    `/api/teams/${encodeURIComponent(teamId)}/leave`,
    { method: 'POST', body: JSON.stringify({ mode, origin }) }
  );
}

export function revokeGuardianCcApi(teamId: string, origin?: string) {
  return requestLifecycleJson<{ teams?: TeamSummaryWithRole[] }>(
    `/api/teams/${encodeURIComponent(teamId)}/members/me/guardian`,
    { method: 'DELETE', body: JSON.stringify({ origin }) }
  );
}

export function updateMyTeamSharingTierApi(
  teamId: string,
  sharingTier: CoachDataSharingTier,
  origin?: string
) {
  return requestLifecycleJson<{ team?: TeamSummaryWithRole; teams?: TeamSummaryWithRole[] }>(
    `/api/teams/${encodeURIComponent(teamId)}/members/me/sharing-tier`,
    { method: 'PATCH', body: JSON.stringify({ sharingTier, origin }) }
  );
}

export function updateMemberStatusApi(
  teamId: string,
  membershipId: string,
  status: string,
  origin?: string
) {
  return requestLifecycleJson<{ team?: TeamSummaryWithRole }>(
    `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(membershipId)}/status`,
    { method: 'PATCH', body: JSON.stringify({ status, origin }) }
  );
}

export function updateMemberRoleApi(
  teamId: string,
  membershipId: string,
  role: Extract<TeamMemberRole, 'ATHLETE' | 'ASSISTANT_COACH' | 'ORG_ADMIN' | 'ATHLETIC_TRAINER'>,
  origin?: string
) {
  return requestLifecycleJson<{ team?: TeamSummaryWithRole }>(
    `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(membershipId)}/role`,
    { method: 'PATCH', body: JSON.stringify({ role, origin }) }
  );
}

export function fetchTeamAuditLogApi(teamId: string, limit = 100) {
  return requestLifecycleJson<{ entries: TeamAuditLogEntry[] }>(
    `/api/teams/${encodeURIComponent(teamId)}/audit-log?limit=${encodeURIComponent(String(limit))}`,
    { method: 'GET' }
  );
}

export function saveWorkoutLibraryTemplateApi(
  teamId: string,
  template: {
    id?: string;
    name: string;
    category: TeamWorkoutLibraryCategory;
    sportCategory: TeamWorkoutLibraryTemplate['sportCategory'];
    workoutSyntax: string;
    description: string;
    plannedDurationSecs: number;
    plannedLoad: number;
    trackSpec?: TeamWorkoutLibraryTemplate['trackSpec'];
  }
) {
  return requestLifecycleJson<{
    template: TeamWorkoutLibraryTemplate;
    team?: TeamSummaryWithRole;
    teams?: TeamSummaryWithRole[];
  }>(`/api/teams/${encodeURIComponent(teamId)}/workout-library`, {
    method: 'POST',
    body: JSON.stringify(template),
  });
}

export function deleteWorkoutLibraryTemplateApi(teamId: string, templateId: string) {
  return requestLifecycleJson<{ team?: TeamSummaryWithRole; teams?: TeamSummaryWithRole[] }>(
    `/api/teams/${encodeURIComponent(teamId)}/workout-library/${encodeURIComponent(templateId)}`,
    { method: 'DELETE' }
  );
}

export function postTeamWorkoutCommentApi(
  teamId: string,
  payload: {
    targetMembershipId: string;
    workoutDate?: string;
    activityId?: string;
    body: string;
    guardianCc?: boolean;
  }
) {
  return requestLifecycleJson<{
    comment: TeamWorkoutComment;
    team?: TeamSummaryWithRole;
    teams?: TeamSummaryWithRole[];
  }>(`/api/teams/${encodeURIComponent(teamId)}/comments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function recordGuardianSafetyAlertApi(
  teamId: string,
  payload: {
    targetMembershipId: string;
    category: GuardianSafetyAlertRecord['category'];
    severity: GuardianSafetyAlertRecord['severity'];
    summary: string;
    painLocation?: string;
  }
) {
  return requestLifecycleJson<{
    alert: GuardianSafetyAlertRecord;
    team?: TeamSummaryWithRole;
    teams?: TeamSummaryWithRole[];
  }>(`/api/teams/${encodeURIComponent(teamId)}/safety-alerts`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function transferHeadCoachApi(
  teamId: string,
  newHeadCoachMembershipId: string,
  origin?: string
) {
  return requestLifecycleJson<{ team?: TeamSummaryWithRole }>(
    `/api/teams/${encodeURIComponent(teamId)}/transfer-ownership`,
    { method: 'POST', body: JSON.stringify({ newHeadCoachMembershipId, origin }) }
  );
}

export function mergeRosterMembersApi(
  teamId: string,
  sourceMembershipId: string,
  targetMembershipId: string,
  origin?: string
) {
  return requestLifecycleJson<{ team?: TeamSummaryWithRole }>(
    `/api/teams/${encodeURIComponent(teamId)}/members/merge`,
    {
      method: 'POST',
      body: JSON.stringify({ sourceMembershipId, targetMembershipId, origin }),
    }
  );
}

export function graduateClassApi(
  teamId: string,
  graduationYear: number,
  origin?: string
) {
  return requestLifecycleJson<{ team?: TeamSummaryWithRole; graduatedCount?: number }>(
    `/api/teams/${encodeURIComponent(teamId)}/graduate-class`,
    { method: 'POST', body: JSON.stringify({ graduationYear, origin }) }
  );
}

export function changePrimaryEmailApi(newEmail: string, verificationCode?: string) {
  return requestLifecycleJson<{
    user?: ThreshUser;
    verificationRequired?: boolean;
    pendingEmail?: string;
    devMode?: boolean;
    devCode?: string;
    sessionToken?: string;
  }>('/api/auth/change-email', {
    method: 'POST',
    body: JSON.stringify({
      newEmail,
      ...(verificationCode ? { verificationCode } : {}),
    }),
  });
}

export function requestParentConsentLinkApi(params: {
  teamId: string;
  membershipId: string;
  originUrl?: string;
  parentGuardianEmail?: string;
}) {
  return requestLifecycleJson<{
    consentUrl?: string;
    emailStatus?: 'SENT_RESEND' | 'READY_MANUAL_LINK' | 'FAILED';
    team?: TeamSummaryWithRole;
  }>(
    `/api/teams/${encodeURIComponent(params.teamId)}/members/${encodeURIComponent(params.membershipId)}/parent-consent-link`,
    {
      method: 'POST',
      body: JSON.stringify({
        origin: params.originUrl,
        ...(params.parentGuardianEmail ? { parentGuardianEmail: params.parentGuardianEmail } : {}),
      }),
    }
  );
}

export function deleteAccountApi() {
  return requestLifecycleJson<{ ok: boolean }>('/api/auth/account?confirm=DELETE', {
    method: 'DELETE',
    body: JSON.stringify({ confirm: 'DELETE' }),
  });
}
