import type { TeamSummaryWithRole, ThreshUser } from '../types.ts';
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
  role: 'ATHLETE' | 'ASSISTANT_COACH',
  origin?: string
) {
  return requestLifecycleJson<{ team?: TeamSummaryWithRole }>(
    `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(membershipId)}/role`,
    { method: 'PATCH', body: JSON.stringify({ role, origin }) }
  );
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

export function changePrimaryEmailApi(newEmail: string) {
  return requestLifecycleJson<{ user?: ThreshUser }>('/api/auth/change-email', {
    method: 'POST',
    body: JSON.stringify({ newEmail }),
  });
}

export function deleteAccountApi() {
  return requestLifecycleJson<{ ok: boolean }>('/api/auth/account?confirm=DELETE', {
    method: 'DELETE',
    body: JSON.stringify({ confirm: 'DELETE' }),
  });
}
