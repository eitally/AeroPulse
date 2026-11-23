import type {
  CoachDataSharingTier,
  FieldEventLogRecord,
  GuardianSafetyAlertRecord,
  TeamAuditLogEntry,
  TeamMemberRole,
  TeamMembershipRecord,
  TeamSummaryWithRole,
  TeamWorkoutComment,
  TeamWorkoutLibraryCategory,
  TeamWorkoutLibraryTemplate,
  ThreshUser,
} from '../types.ts';
import type {
  CoachEventGroup,
  FieldEventCode,
  FieldTrialEntry,
  TeamAnnouncementCategory,
  TeamAnnouncementRecord,
  TeamAttendanceStatus,
  TeamMessageChannelScope,
  TeamMessageRecord,
  TeamMessagingPolicy,
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

export class TeamLifecycleApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TeamLifecycleApiError';
    this.status = status;
  }
}

async function requestLifecycleJson<T>(url: string, init: RequestInit): Promise<T & { ok?: boolean; error?: string }> {
  const resp = await fetch(url, {
    credentials: 'include',
    headers: buildThreshSessionHeaders(),
    ...init,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data?.ok === false) {
    throw new TeamLifecycleApiError(data?.error || 'Request failed.', resp.status);
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

export async function recordTeamAttendanceBatchApi(params: {
  teamId: string;
  date: string;
  entries: Array<{ membershipId: string; status: TeamAttendanceStatus; note?: string }>;
}) {
  return requestLifecycleJson<{
    recordedCount?: number;
    team?: TeamSummaryWithRole;
    teams?: TeamSummaryWithRole[];
  }>(`/api/teams/${encodeURIComponent(params.teamId)}/attendance`, {
    method: 'POST',
    body: JSON.stringify({ date: params.date, entries: params.entries }),
  });
}

export async function postTeamAnnouncementApi(params: {
  teamId: string;
  title: string;
  body: string;
  category?: TeamAnnouncementCategory;
  targetEventGroups?: CoachEventGroup[];
  publishToParentHub?: boolean;
}) {
  return requestLifecycleJson<{
    announcement?: TeamAnnouncementRecord;
    team?: TeamSummaryWithRole;
    teams?: TeamSummaryWithRole[];
  }>(`/api/teams/${encodeURIComponent(params.teamId)}/announcements`, {
    method: 'POST',
    body: JSON.stringify({
      title: params.title,
      body: params.body,
      category: params.category,
      targetEventGroups: params.targetEventGroups,
      publishToParentHub: params.publishToParentHub,
    }),
  });
}

export async function deleteTeamAnnouncementApi(params: {
  teamId: string;
  announcementId: string;
}) {
  return requestLifecycleJson<{
    team?: TeamSummaryWithRole;
    teams?: TeamSummaryWithRole[];
  }>(
    `/api/teams/${encodeURIComponent(params.teamId)}/announcements/${encodeURIComponent(params.announcementId)}`,
    {
      method: 'DELETE',
    },
  );
}

export interface RecordTeamFieldMarkEntryInput {
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

export async function recordTeamFieldMarksApi(params: {
  teamId: string;
  clientBatchId?: string;
  entries: RecordTeamFieldMarkEntryInput[];
}) {
  return requestLifecycleJson<{
    recordedCount?: number;
    team?: TeamSummaryWithRole;
    teams?: TeamSummaryWithRole[];
  }>(`/api/teams/${encodeURIComponent(params.teamId)}/field-marks`, {
    method: 'POST',
    body: JSON.stringify({
      ...(params.clientBatchId ? { clientBatchId: params.clientBatchId } : {}),
      entries: params.entries,
    }),
  });
}

export async function fetchTeamFieldMarksApi(
  teamId: string,
  opts?: {
    eventCode?: FieldEventCode;
    limit?: number;
    offset?: number;
  }
) {
  const qs = new URLSearchParams();
  if (opts?.eventCode) qs.set('eventCode', opts.eventCode);
  if (typeof opts?.limit === 'number' && Number.isFinite(opts.limit)) {
    qs.set('limit', String(Math.max(1, Math.min(200, Math.round(opts.limit)))));
  }
  if (typeof opts?.offset === 'number' && Number.isFinite(opts.offset)) {
    qs.set('offset', String(Math.max(0, Math.round(opts.offset))));
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return requestLifecycleJson<{
    logs: FieldEventLogRecord[];
    totalCount: number;
    limit: number;
    offset: number;
  }>(`/api/teams/${encodeURIComponent(teamId)}/field-marks${suffix}`, {
    method: 'GET',
  });
}

export async function updateAssistantCoachEventGroupsApi(params: {
  teamId: string;
  membershipId: string;
  coachEventGroups: CoachEventGroup[];
  coachSpecialtyTitle?: string;
  assignedAthleteMembershipIds?: string[];
}) {
  return requestLifecycleJson<{
    team?: TeamSummaryWithRole;
    teams?: TeamSummaryWithRole[];
  }>(
    `/api/teams/${encodeURIComponent(params.teamId)}/members/${encodeURIComponent(params.membershipId)}/coach-groups`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        coachEventGroups: params.coachEventGroups,
        ...(params.coachSpecialtyTitle !== undefined
          ? { coachSpecialtyTitle: params.coachSpecialtyTitle }
          : {}),
        ...(params.assignedAthleteMembershipIds !== undefined
          ? { assignedAthleteMembershipIds: params.assignedAthleteMembershipIds }
          : {}),
      }),
    },
  );
}

export async function inviteTeamCoachingStaffApi(params: {
  teamId: string;
  staffName: string;
  staffEmail?: string;
  role?: TeamMemberRole;
  coachSpecialtyTitle?: string;
  coachEventGroups?: CoachEventGroup[];
  assignedAthleteMembershipIds?: string[];
}) {
  return requestLifecycleJson<{
    member?: TeamMembershipRecord;
    inviteUrl?: string;
    emailStatus?: 'SENT_RESEND' | 'READY_MANUAL_LINK' | 'FAILED';
    team?: TeamSummaryWithRole;
    teams?: TeamSummaryWithRole[];
  }>(`/api/teams/${encodeURIComponent(params.teamId)}/staff/invite`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function postTeamMessageApi(params: {
  teamId: string;
  channelScope: TeamMessageChannelScope;
  eventGroup?: CoachEventGroup;
  targetMembershipId?: string;
  body: string;
  guardianCc?: boolean;
  clientLocalHour?: number;
  isEmergencyOverride?: boolean;
}) {
  return requestLifecycleJson<{
    message?: TeamMessageRecord;
    team?: TeamSummaryWithRole;
    teams?: TeamSummaryWithRole[];
  }>(`/api/teams/${encodeURIComponent(params.teamId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      channelScope: params.channelScope,
      eventGroup: params.eventGroup,
      targetMembershipId: params.targetMembershipId,
      body: params.body,
      guardianCc: params.guardianCc,
      clientLocalHour: params.clientLocalHour,
      isEmergencyOverride: params.isEmergencyOverride,
    }),
  });
}

export async function acknowledgeTeamMessageApi(params: {
  teamId: string;
  messageId: string;
}) {
  return requestLifecycleJson<{
    team?: TeamSummaryWithRole;
    teams?: TeamSummaryWithRole[];
  }>(
    `/api/teams/${encodeURIComponent(params.teamId)}/messages/${encodeURIComponent(params.messageId)}/ack`,
    { method: 'POST', body: '{}' },
  );
}

export async function flagTeamMessageApi(params: {
  teamId: string;
  messageId: string;
  reason?: string;
}) {
  return requestLifecycleJson<{
    team?: TeamSummaryWithRole;
    teams?: TeamSummaryWithRole[];
  }>(
    `/api/teams/${encodeURIComponent(params.teamId)}/messages/${encodeURIComponent(params.messageId)}/flag`,
    {
      method: 'POST',
      body: JSON.stringify({ reason: params.reason }),
    },
  );
}

export async function updateTeamMessagingPolicyApi(params: {
  teamId: string;
  athleteRepliesEnabled?: boolean;
  quietHoursStartHour?: number;
  quietHoursEndHour?: number;
}) {
  return requestLifecycleJson<{
    team?: TeamSummaryWithRole;
    teams?: TeamSummaryWithRole[];
  }>(`/api/teams/${encodeURIComponent(params.teamId)}/messaging-policy`, {
    method: 'PATCH',
    body: JSON.stringify({
      athleteRepliesEnabled: params.athleteRepliesEnabled,
      quietHoursStartHour: params.quietHoursStartHour,
      quietHoursEndHour: params.quietHoursEndHour,
    }),
  });
}
