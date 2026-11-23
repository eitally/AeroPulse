import type {
  SessionCheckInRecord,
  TeamInjuryCaseRecord,
  TeamInjuryRtpStage,
  TeamSummaryWithRole,
} from '../types.ts';
import { buildThreshSessionHeaders } from './teamLifecycleApi.ts';

export class InjuryHubApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'InjuryHubApiError';
    this.status = status;
  }
}

export interface UpsertInjuryCasePayload {
  id?: string;
  membershipId: string;
  bodyRegion: NonNullable<SessionCheckInRecord['painArea']>;
  severity: 'LOW' | 'MODERATE' | 'HIGH';
  rtpStage: TeamInjuryRtpStage;
  restrictions: string;
  coachGuidance: string;
  privateClinicalNotes?: string;
  targetReturnDate?: string;
}

async function requestInjuryJson<T>(
  url: string,
  init: RequestInit
): Promise<T & { ok?: boolean; error?: string }> {
  const resp = await fetch(url, {
    credentials: 'include',
    headers: buildThreshSessionHeaders(),
    ...init,
  });
  const data = (await resp.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!resp.ok || data?.ok === false) {
    throw new InjuryHubApiError(data?.error || 'Injury Hub request failed.', resp.status);
  }
  return data;
}

export function fetchTeamInjuriesApi(teamId: string) {
  return requestInjuryJson<{ cases: TeamInjuryCaseRecord[] }>(
    `/api/teams/${encodeURIComponent(teamId)}/injuries`,
    { method: 'GET' }
  );
}

export function upsertTeamInjuryCaseApi(
  teamId: string,
  payload: UpsertInjuryCasePayload
) {
  return requestInjuryJson<{
    case: TeamInjuryCaseRecord;
    cases: TeamInjuryCaseRecord[];
    team?: TeamSummaryWithRole;
    teams?: TeamSummaryWithRole[];
  }>(`/api/teams/${encodeURIComponent(teamId)}/injuries`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteTeamInjuryCaseApi(teamId: string, caseId: string) {
  return requestInjuryJson<{
    cases: TeamInjuryCaseRecord[];
    team?: TeamSummaryWithRole;
    teams?: TeamSummaryWithRole[];
  }>(
    `/api/teams/${encodeURIComponent(teamId)}/injuries/${encodeURIComponent(caseId)}`,
    { method: 'DELETE' }
  );
}
