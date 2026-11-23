import fs from 'fs';
import type { Request, Response } from 'express';
import type {
  AthleteCloudStateEnvelope,
  AthleteGearItem,
  AthleteProfile,
  DistanceUnit,
  FieldEventLogRecord,
  PlannedWorkoutEvent,
  SessionCheckInRecord,
  TargetGoal,
  TeamAthleteLiveSnapshot,
  TeamAttendanceRecord,
  TeamInjuryCaseRecord,
  TeamMembershipRecord,
  TeamMessageRecord,
  TeamOrgType,
  TeamWorkoutComment,
  UnifiedActivity,
  AnnualMileageGoal,
} from '../src/types.ts';
import {
  clearGarminSessionAsync,
} from './garminConnectService.ts';
import {
  getUserById,
  getUserByProvider,
  hashAuthLookupKey,
  type ThreshUser,
} from './authService.ts';
import {
  GARMIN_SESSION_DIR,
  bindRequestScopeKey,
  getScopedRuntimeStore,
  runtimeStore,
  type RuntimeSessionStore,
} from './sessionContext.ts';
import {
  USER_VAULT_COOKIE_NAME,
  buildClearUserCookieHeader,
  buildClearVaultCookieHeader,
  decryptJsonFromVault,
  deleteMemberPostgresRowsAsync,
  deleteTeamPostgresRowsAsync,
  deleteTenantVault,
  loadTenantVaultAsync,
  sanitizeTenantId,
  saveTenantVaultAsync,
  withTeamRowLock,
  withVaultLock,
} from './tokenVault.ts';
import {
  appendSetCookieHeader,
  clearSessionCookie,
  deriveStravaSessionSid,
  deriveUserSessionSid,
  getVerifiedSessionClaims,
  isCanonicalAuthenticatedClaims,
  parseCookies,
  resolveSafeOrigin,
} from './securityUtils.ts';
import {
  EMAIL_DIRECTORY_KEY,
  TEAMS_DIRECTORY_KEY,
  type EmailAccountDirectory,
  type UserTeamsIndex,
  loadDirectory,
  loadTeamDocRaw,
  removeTeamFromUserIndex,
  saveTeamDocRaw,
  teamDocVaultKey,
  userTeamsVaultKey,
} from './teamService.ts';
import {
  loadFullTeamFieldMarksArchive,
  teamFieldLogsVaultKey,
} from './teamFieldAndDailyOpsService.ts';
import {
  scrubMemberFromTeamDocument,
  scrubMemberSidecarVaultsAndPostgres,
} from './teamLifecycleService.ts';

export interface ExportedTeamMembershipBundle {
  teamId: string;
  teamName: string;
  slug: string;
  orgType: TeamOrgType;
  primarySport: string;
  membership: Omit<TeamMembershipRecord, 'parentConsentToken' | 'liveSnapshot' | 'coachRecordedActivities'>;
  liveSnapshot?: TeamAthleteLiveSnapshot;
  coachRecordedActivities: UnifiedActivity[];
  attendanceRecords: TeamAttendanceRecord[];
  fieldMarkLogs: FieldEventLogRecord[];
  workoutComments: TeamWorkoutComment[];
  teamMessages: TeamMessageRecord[];
  injuryCases: TeamInjuryCaseRecord[];
}

export interface UserDataExportPayload {
  schemaVersion: 'meetready-export-v1';
  exportedAt: string;
  account: {
    id: string;
    email: string;
    name: string;
    picture?: string;
    birthMonthYear?: string;
    role: string;
    createdAt: string;
    updatedAt: string;
    authProviders: Array<{
      provider: string;
      providerId: string;
      email?: string;
      name?: string;
      linkedAt: string;
    }>;
    passkeys: Array<{
      id: string;
      counter: number;
      createdAt: string;
    }>;
    connectedServices: Array<{
      service: string;
      status: string;
      athleteId?: string;
      athleteName?: string;
      connectedAt: string;
    }>;
  } | null;
  athleteState: {
    updatedAt: string;
    distanceUnit?: DistanceUnit;
    athleteProfile?: Partial<AthleteProfile>;
    plannedEvents: PlannedWorkoutEvent[];
    targetGoals: TargetGoal[];
    annualMileageGoals: AnnualMileageGoal[];
    gearItems: AthleteGearItem[];
    sessionCheckIns: SessionCheckInRecord[];
    coachArchivedActivities: UnifiedActivity[];
  };
  teams: ExportedTeamMembershipBundle[];
  summary: {
    plannedEventsCount: number;
    sessionCheckInsCount: number;
    coachArchivedActivitiesCount: number;
    gearItemsCount: number;
    teamMembershipsCount: number;
    fieldMarkLogsCount: number;
  };
}

function collectCandidateIdentityContext(
  req: Request,
  user: ThreshUser | null,
  claimsSid: string
): { candidateSids: Set<string>; stravaIds: Set<string> } {
  const activeStore = getScopedRuntimeStore(req);
  const candidateSids = new Set<string>([claimsSid]);
  if (user?.id) {
    candidateSids.add(deriveUserSessionSid(user.id));
  }
  const stravaIds = new Set<string>();
  if (activeStore?.stravaAthleteId) {
    stravaIds.add(String(activeStore.stravaAthleteId));
  }
  for (const p of user?.authProviders || []) {
    if (p.provider === 'strava' && p.providerId) stravaIds.add(p.providerId);
  }
  for (const s of user?.connectedServices || []) {
    if (s.service === 'strava' && s.athleteId) stravaIds.add(s.athleteId);
  }
  for (const stravaId of stravaIds) {
    candidateSids.add(deriveStravaSessionSid(stravaId));
  }
  return { candidateSids, stravaIds };
}

async function resolveAuthenticatedUserForRequest(
  req: Request,
  sub: string
): Promise<ThreshUser | null> {
  if (sub.startsWith('usr_')) {
    const found = await getUserById(sub);
    if (found) return found;
    const cookies = parseCookies(req.headers.cookie);
    const backupEnvelope = cookies[USER_VAULT_COOKIE_NAME];
    if (backupEnvelope) {
      const restored = decryptJsonFromVault<ThreshUser>(backupEnvelope);
      if (restored && restored.id === sub) {
        return restored;
      }
    }
    return null;
  }
  if (sub) {
    return getUserByProvider('strava', sub);
  }
  return null;
}

/**
 * Builds a clean-room, strictly caller-scoped FERPA / GDPR data export bundle
 * for the authenticated user without leaking secrets, tokens, or other athletes' PII.
 */
export async function buildUserDataExportPayload(
  req: Request
): Promise<UserDataExportPayload | null> {
  const claims = getVerifiedSessionClaims(req);
  if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
    return null;
  }

  const user = await resolveAuthenticatedUserForRequest(req, claims.sub);
  const { candidateSids, stravaIds } = collectCandidateIdentityContext(req, user, claims.sid);

  // Load personal athlete cloud state (priority: user -> strava -> sid)
  const candidateStateKeys: string[] = [];
  if (user?.id) {
    const cleanUsr = user.id.replace(/[^0-9a-zA-Z_-]/g, '');
    if (cleanUsr) candidateStateKeys.push(`athlete_state_user_${cleanUsr}`);
  }
  for (const stravaId of stravaIds) {
    const cleanStrava = stravaId.replace(/[^0-9a-zA-Z_-]/g, '');
    if (cleanStrava) candidateStateKeys.push(`athlete_state_strava_${cleanStrava}`);
  }
  for (const sid of candidateSids) {
    const cleanSid = sid.replace(/[^0-9a-zA-Z_-]/g, '');
    if (cleanSid) {
      candidateStateKeys.push(`athlete_state_sid_${cleanSid.slice(0, 32)}`);
      candidateStateKeys.push(`athlete_state_sid_${cleanSid.slice(0, 24)}`);
    }
  }

  let resolvedState: AthleteCloudStateEnvelope | null = null;
  for (const vaultKey of candidateStateKeys) {
    const env = await loadTenantVaultAsync<AthleteCloudStateEnvelope | null>(vaultKey, null);
    if (
      env &&
      (Boolean(env.updatedAt) ||
        (env.plannedEvents && env.plannedEvents.length > 0) ||
        (env.sessionCheckIns && env.sessionCheckIns.length > 0) ||
        (env.coachArchivedActivities && env.coachArchivedActivities.length > 0) ||
        Boolean(env.athleteProfile))
    ) {
      resolvedState = env;
      break;
    }
  }

  // Gather all teams where caller holds an active/invited/alumni membership
  const teamIdSet = new Set<string>();
  for (const sid of candidateSids) {
    const idx = await loadTenantVaultAsync<UserTeamsIndex>(userTeamsVaultKey(sid), {
      teamIds: [],
      updatedAt: '',
    });
    for (const id of idx.teamIds || []) {
      teamIdSet.add(id);
    }
  }
  const dir = await loadDirectory();
  for (const id of dir.allTeamIds || []) {
    teamIdSet.add(id);
  }

  const cleanUserEmail = user?.email?.trim().toLowerCase() || '';
  const exportedTeams: ExportedTeamMembershipBundle[] = [];

  for (const teamId of teamIdSet) {
    const doc = await loadTeamDocRaw(teamId);
    if (!doc) continue;

    const myMem = doc.memberships.find(
      (m) =>
        m.status !== 'REVOKED' &&
        (candidateSids.has(m.userSid || '') ||
          (cleanUserEmail && m.invitedEmail?.trim().toLowerCase() === cleanUserEmail))
    );
    if (!myMem) continue;

    const {
      rawInviteToken: _dropRawInv,
      inviteTokenHash: _dropInvHash,
      parentConsentToken: _dropConsentTok,
      parentConsentTokenHash: _dropConsentHash,
      liveSnapshot,
      coachRecordedActivities,
      ...safeMembership
    } = myMem;

    const attendanceRecords: TeamAttendanceRecord[] = [];
    if (doc.attendanceByDate && typeof doc.attendanceByDate === 'object') {
      for (const dayMap of Object.values(doc.attendanceByDate)) {
        if (!dayMap || typeof dayMap !== 'object') continue;
        const entry = dayMap[myMem.membershipId];
        if (entry) {
          attendanceRecords.push(entry);
        }
      }
    }

    const fullFieldLogs = await loadFullTeamFieldMarksArchive(teamId, doc.fieldMarkLogs);
    const myFieldLogs = fullFieldLogs.filter(
      (log) => log.membershipId === myMem.membershipId
    );

    const myComments = (doc.workoutComments || []).filter(
      (c) => c.targetMembershipId === myMem.membershipId || candidateSids.has(c.authorSid)
    );

    const myMessages = (doc.teamMessages || []).filter(
      (msg) =>
        candidateSids.has(msg.senderSid) ||
        msg.senderMembershipId === myMem.membershipId ||
        msg.targetMembershipId === myMem.membershipId
    );

    const myInjuries = (doc.injuryCases || [])
      .filter((c) => c.membershipId === myMem.membershipId)
      .map((c) => {
        if (myMem.role === 'ATHLETIC_TRAINER') return c;
        const { privateClinicalNotes: _dropClinical, ...safeCase } = c;
        return safeCase;
      });

    exportedTeams.push({
      teamId: doc.brand.teamId,
      teamName: doc.brand.name,
      slug: doc.brand.slug,
      orgType: doc.brand.orgType,
      primarySport: doc.brand.primarySport,
      membership: safeMembership,
      ...(liveSnapshot ? { liveSnapshot } : {}),
      coachRecordedActivities: Array.isArray(coachRecordedActivities)
        ? coachRecordedActivities.map((act) => ({ ...act, streams: undefined }))
        : [],
      attendanceRecords,
      fieldMarkLogs: myFieldLogs,
      workoutComments: myComments,
      teamMessages: myMessages,
      injuryCases: myInjuries,
    });
  }

  const athleteState: UserDataExportPayload['athleteState'] = {
    updatedAt: resolvedState?.updatedAt || '',
    ...(resolvedState?.distanceUnit ? { distanceUnit: resolvedState.distanceUnit } : {}),
    ...(resolvedState?.athleteProfile ? { athleteProfile: resolvedState.athleteProfile } : {}),
    plannedEvents: Array.isArray(resolvedState?.plannedEvents) ? resolvedState.plannedEvents : [],
    targetGoals: Array.isArray(resolvedState?.targetGoals) ? resolvedState.targetGoals : [],
    annualMileageGoals: Array.isArray(resolvedState?.annualMileageGoals)
      ? resolvedState.annualMileageGoals
      : [],
    gearItems: Array.isArray(resolvedState?.gearItems) ? resolvedState.gearItems : [],
    sessionCheckIns: Array.isArray(resolvedState?.sessionCheckIns)
      ? resolvedState.sessionCheckIns
      : [],
    coachArchivedActivities: Array.isArray(resolvedState?.coachArchivedActivities)
      ? resolvedState.coachArchivedActivities.map((act) => ({ ...act, streams: undefined }))
      : [],
  };

  const totalFieldMarks = exportedTeams.reduce(
    (sum, t) => sum + t.fieldMarkLogs.length,
    0
  );

  return {
    schemaVersion: 'meetready-export-v1',
    exportedAt: new Date().toISOString(),
    account: user
      ? {
          id: user.id,
          email: user.email,
          name: user.name,
          ...(user.picture ? { picture: user.picture } : {}),
          ...(user.birthMonthYear ? { birthMonthYear: user.birthMonthYear } : {}),
          role: user.role,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          authProviders: (user.authProviders || []).map((p) => ({
            provider: p.provider,
            providerId: p.providerId,
            ...(p.email ? { email: p.email } : {}),
            ...(p.name ? { name: p.name } : {}),
            linkedAt: p.linkedAt,
          })),
          passkeys: (user.passkeys || []).map((pk) => ({
            id: pk.id,
            counter: pk.counter,
            createdAt: pk.createdAt,
          })),
          connectedServices: (user.connectedServices || []).map((svc) => ({
            service: svc.service,
            status: svc.status,
            ...(svc.athleteId ? { athleteId: svc.athleteId } : {}),
            ...(svc.athleteName ? { athleteName: svc.athleteName } : {}),
            connectedAt: svc.connectedAt,
          })),
        }
      : null,
    athleteState,
    teams: exportedTeams,
    summary: {
      plannedEventsCount: athleteState.plannedEvents.length,
      sessionCheckInsCount: athleteState.sessionCheckIns.length,
      coachArchivedActivitiesCount: athleteState.coachArchivedActivities.length,
      gearItemsCount: athleteState.gearItems.length,
      teamMembershipsCount: exportedTeams.length,
      fieldMarkLogsCount: totalFieldMarks,
    },
  };
}

function escapeCsvCell(value: unknown): string {
  const raw = String(value ?? '');
  const needsFormulaGuard =
    /^[=+\t\r@]/.test(raw) || (/^-/.test(raw) && !/^-\d+(\.\d+)?$/.test(raw));
  const safe = needsFormulaGuard ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Formats a `UserDataExportPayload` into an RFC 4180 CSV document with formula-injection neutralization.
 */
export function formatUserDataExportCsv(payload: UserDataExportPayload): string {
  const rows: string[][] = [
    ['record_type', 'date', 'title_or_name', 'category_or_team', 'detail', 'metric_a', 'metric_b'],
  ];

  const pushRow = (
    recordType: string,
    date: string,
    title: string,
    category: string,
    detail: string,
    metricA: unknown = '',
    metricB: unknown = ''
  ) => {
    rows.push([
      recordType,
      date,
      title,
      category,
      detail,
      String(metricA ?? ''),
      String(metricB ?? ''),
    ]);
  };

  if (payload.account) {
    pushRow(
      'ACCOUNT',
      payload.account.createdAt.slice(0, 10),
      payload.account.name,
      payload.account.role,
      payload.account.email || '',
      payload.account.birthMonthYear || '',
      payload.account.authProviders.map((p) => p.provider).join('|')
    );
  }

  if (payload.athleteState.athleteProfile) {
    const prof = payload.athleteState.athleteProfile;
    pushRow(
      'PROFILE',
      payload.athleteState.updatedAt.slice(0, 10),
      prof.name || '',
      prof.primarySport || '',
      payload.athleteState.distanceUnit || '',
      prof.ftp ?? '',
      prof.thresholdPaceSecsPerKm ?? ''
    );
  }

  for (const ev of payload.athleteState.plannedEvents) {
    pushRow(
      'PLANNED_WORKOUT',
      ev.date,
      ev.name,
      ev.sportCategory,
      ev.description || ev.workoutSyntax || '',
      ev.plannedDurationSecs,
      ev.plannedLoad
    );
  }

  for (const chk of payload.athleteState.sessionCheckIns) {
    pushRow(
      'SESSION_CHECKIN',
      chk.date,
      chk.workoutName || 'Daily Check-In',
      chk.painArea || 'NONE',
      chk.sorenessNote || '',
      chk.rpe,
      chk.legFeel || ''
    );
  }

  for (const goal of payload.athleteState.targetGoals) {
    pushRow(
      'GOAL',
      goal.targetDate || '',
      goal.title,
      goal.type,
      goal.notes || goal.unit || '',
      goal.targetValue,
      goal.currentValue ?? ''
    );
  }

  for (const gear of payload.athleteState.gearItems) {
    pushRow(
      'GEAR',
      gear.purchaseDate || '',
      gear.name,
      gear.footwearClass || gear.type,
      gear.brand || '',
      gear.distanceMeters,
      gear.maxRecommendedMeters
    );
  }

  for (const act of payload.athleteState.coachArchivedActivities) {
    pushRow(
      'COACH_ACTIVITY',
      (act.startDateLocal || '').slice(0, 10),
      act.name,
      act.sportCategory,
      act.subType || '',
      act.distanceMeters,
      act.movingTimeSecs
    );
  }

  for (const team of payload.teams) {
    pushRow(
      'TEAM_MEMBERSHIP',
      (team.membership.joinedAt || team.membership.invitedAt || '').slice(0, 10),
      team.teamName,
      team.membership.role,
      team.membership.squadGroup,
      team.membership.status,
      team.membership.sharingTier || ''
    );
    for (const act of team.coachRecordedActivities) {
      pushRow(
        'TEAM_STOPWATCH_ACTIVITY',
        (act.startDateLocal || '').slice(0, 10),
        act.name,
        team.teamName,
        act.subType || '',
        act.distanceMeters,
        act.movingTimeSecs
      );
    }
    for (const att of team.attendanceRecords) {
      pushRow('ATTENDANCE', att.date, team.teamName, att.status, att.note || '', '', '');
    }
    for (const fm of team.fieldMarkLogs) {
      pushRow(
        'FIELD_MARK',
        fm.date,
        fm.eventCode,
        team.teamName,
        fm.meetOrPracticeTitle,
        fm.bestMarkMeters ?? '',
        fm.placeRank ?? ''
      );
    }
    for (const ic of team.injuryCases) {
      pushRow(
        'INJURY_CASE',
        ic.updatedAt.slice(0, 10),
        ic.bodyRegion,
        team.teamName,
        ic.restrictions,
        ic.rtpStage,
        ic.severity
      );
    }
  }

  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n') + '\r\n';
}

async function bestEffortRevokeUpstreamTokens(
  stravaAccessToken?: string,
  polarAccessToken?: string,
  polarUserId?: string
): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if (stravaAccessToken) {
    tasks.push(
      fetch(
        `https://www.strava.com/oauth/deauthorize?access_token=${encodeURIComponent(stravaAccessToken)}`,
        { method: 'POST', signal: AbortSignal.timeout(4000) }
      ).catch(() => undefined)
    );
  }
  if (polarAccessToken && polarUserId) {
    tasks.push(
      fetch(`https://polarremote.com/v2/users/${encodeURIComponent(polarUserId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${polarAccessToken}` },
        signal: AbortSignal.timeout(4000),
      }).catch(() => undefined)
    );
  }
  await Promise.allSettled(tasks);
}

/**
 * Full GDPR / CCPA / FERPA / COPPA account & PII erasure.
 * Revokes external OAuth tokens, scrubs all active team memberships, sub-arrays, sidecar vaults,
 * and Postgres rows, deletes personal cloud vaults/indices/sessions, and clears all cookies.
 */
export async function deleteThreshAccountPermanently(
  req: Request,
  res: Response
): Promise<void> {
  const claims = getVerifiedSessionClaims(req);
  if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
    res.status(401).json({ ok: false, error: 'Authentication required.' });
    return;
  }

  const user = await resolveAuthenticatedUserForRequest(req, claims.sub);
  const activeStore = getScopedRuntimeStore(req);
  const { candidateSids, stravaIds } = collectCandidateIdentityContext(req, user, claims.sid);
  const cleanEmail = user?.email ? user.email.trim().toLowerCase() : '';

  // Sole Head Coach safety guard: prevent leaving active athletes/staff orphaned on a headless team
  const dirForGuard = await loadDirectory();
  for (const teamId of dirForGuard.allTeamIds || []) {
    const doc = await loadTeamDocRaw(teamId);
    if (!doc) continue;
    const isMyHeadCoach = doc.memberships.some(
      (m) =>
        candidateSids.has(m.userSid || '') &&
        m.role === 'HEAD_COACH' &&
        m.status !== 'REVOKED'
    );
    if (!isMyHeadCoach) continue;
    const otherActive = doc.memberships.filter(
      (m) => !candidateSids.has(m.userSid || '') && m.status !== 'REVOKED'
    );
    const hasAnotherHeadCoach = otherActive.some((m) => m.role === 'HEAD_COACH');
    if (otherActive.length > 0 && !hasAnotherHeadCoach) {
      res.status(409).json({
        ok: false,
        error:
          'You are the sole Head Coach of an active team. Transfer Head Coach ownership to another staff member in Team Settings before permanently deleting your account.',
      });
      return;
    }
  }

  // Gather upstream tokens before deleting session vaults
  let stravaAccessToken = activeStore?.stravaAccessToken || '';
  let stravaRefreshToken = activeStore?.stravaRefreshToken || '';
  let stravaExpiresAt = Number(activeStore?.stravaExpiresAt || 0);
  let stravaClientId = activeStore?.stravaClientId || (process.env.STRAVA_CLIENT_ID || '').trim();
  let stravaClientSecret =
    activeStore?.stravaClientSecret || (process.env.STRAVA_CLIENT_SECRET || '').trim();
  let polarAccessToken = activeStore?.polarAccessToken || '';
  let polarUserId = activeStore?.polarUserId || '';
  for (const sid of candidateSids) {
    const scopeKey = sid.slice(0, 24);
    const sDoc = await loadTenantVaultAsync<Partial<RuntimeSessionStore> | null>(
      `session_${scopeKey}`,
      null
    );
    if (sDoc?.stravaAccessToken && !stravaAccessToken) stravaAccessToken = sDoc.stravaAccessToken;
    if (sDoc?.stravaRefreshToken && !stravaRefreshToken) stravaRefreshToken = sDoc.stravaRefreshToken;
    if (sDoc?.stravaExpiresAt && !stravaExpiresAt) stravaExpiresAt = Number(sDoc.stravaExpiresAt || 0);
    if (sDoc?.stravaClientId && !stravaClientId) stravaClientId = sDoc.stravaClientId;
    if (sDoc?.stravaClientSecret && !stravaClientSecret) stravaClientSecret = sDoc.stravaClientSecret;
    if (sDoc?.polarAccessToken && !polarAccessToken) polarAccessToken = sDoc.polarAccessToken;
    if (sDoc?.polarUserId && !polarUserId) polarUserId = sDoc.polarUserId;
  }
  const nowSecs = Math.floor(Date.now() / 1000);
  if (
    (!stravaAccessToken || (stravaExpiresAt > 0 && nowSecs >= stravaExpiresAt - 60)) &&
    stravaRefreshToken &&
    stravaClientId &&
    stravaClientSecret
  ) {
    try {
      const refResp = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: stravaClientId,
          client_secret: stravaClientSecret,
          grant_type: 'refresh_token',
          refresh_token: stravaRefreshToken,
        }),
        signal: AbortSignal.timeout(4000),
      });
      if (refResp.ok) {
        const refData = (await refResp.json()) as { access_token?: string };
        if (refData.access_token) stravaAccessToken = refData.access_token;
      }
    } catch {
      // best effort
    }
  }
  await bestEffortRevokeUpstreamTokens(stravaAccessToken, polarAccessToken, polarUserId);

  // Collect all teams touched by any candidate sid or directory match
  const affectedTeamIds = new Set<string>(dirForGuard.allTeamIds || []);
  for (const sid of candidateSids) {
    const idx = await loadTenantVaultAsync<UserTeamsIndex>(userTeamsVaultKey(sid), {
      teamIds: [],
      updatedAt: '',
    });
    for (const id of idx.teamIds) {
      affectedTeamIds.add(id);
    }
  }

  // Scrub team memberships, nested sub-arrays, sidecar vaults, and Postgres rows
  const deletedTeamIds: string[] = [];
  for (const teamId of affectedTeamIds) {
    await withTeamRowLock(teamId, async () => {
      const doc = await loadTeamDocRaw(teamId);
      if (!doc) return;

      const myMems = doc.memberships.filter(
        (m) =>
          candidateSids.has(m.userSid || '') ||
          (cleanEmail && m.invitedEmail?.trim().toLowerCase() === cleanEmail)
      );
      if (myMems.length === 0) return;

      const targetMembershipIds = new Set<string>(myMems.map((m) => m.membershipId));
      const otherActive = doc.memberships.filter(
        (m) => !targetMembershipIds.has(m.membershipId) && m.status !== 'REVOKED'
      );

      if (myMems.some((m) => m.role === 'HEAD_COACH') && otherActive.length === 0) {
        const safeId = sanitizeTenantId(teamId);
        await deleteTenantVault(teamDocVaultKey(teamId));
        await deleteTenantVault(teamFieldLogsVaultKey(teamId)).catch(() => undefined);
        await deleteTenantVault(`audit_log_${safeId.slice(0, 40)}`).catch(() => undefined);
        await deleteTenantVault(`team_parent_email_subs_${safeId.slice(0, 40)}`).catch(() => undefined);
        await deleteTenantVault(`team_parent_email_subs_${safeId}`).catch(() => undefined);
        await deleteTeamPostgresRowsAsync(teamId).catch(() => undefined);
        deletedTeamIds.push(teamId);
        return;
      }

      const targetSids = new Set<string>(candidateSids);
      scrubMemberFromTeamDocument({
        doc,
        targetMembershipIds,
        targetSids,
        replacementName: 'Deleted Athlete',
      });
      const updatedFieldCount = await scrubMemberSidecarVaultsAndPostgres({
        teamId,
        targetMembershipIds,
        targetSids,
        emails: cleanEmail ? [cleanEmail] : [],
      });
      if (typeof updatedFieldCount === 'number') {
        doc.fieldMarkLogsTotalCount = updatedFieldCount;
      } else if (Array.isArray(doc.fieldMarkLogs)) {
        doc.fieldMarkLogsTotalCount = doc.fieldMarkLogs.length;
      }
      await saveTeamDocRaw(teamId, doc);
    });

    for (const sid of candidateSids) {
      await removeTeamFromUserIndex(sid, teamId).catch(() => undefined);
    }
  }

  for (const sid of candidateSids) {
    await deleteTenantVault(userTeamsVaultKey(sid)).catch(() => undefined);
    await deleteTenantVault(`push_subs_${sanitizeTenantId(sid)}`).catch(() => undefined);
  }
  await deleteMemberPostgresRowsAsync({
    userSids: Array.from(candidateSids),
    emails: cleanEmail ? [cleanEmail] : [],
  }).catch(() => undefined);

  if (deletedTeamIds.length > 0) {
    await withVaultLock(TEAMS_DIRECTORY_KEY, async () => {
      const dir = await loadDirectory();
      const deletedSet = new Set(deletedTeamIds);
      for (const [slug, tId] of Object.entries(dir.bySlug)) {
        if (deletedSet.has(tId)) delete dir.bySlug[slug];
      }
      for (const [code, tId] of Object.entries(dir.byJoinCode)) {
        if (deletedSet.has(tId)) delete dir.byJoinCode[code];
      }
      dir.allTeamIds = dir.allTeamIds.filter((id) => !deletedSet.has(id));
      await saveTenantVaultAsync(TEAMS_DIRECTORY_KEY, dir);
    });
  }

  // Scrub Email OTP directory, user auth lookup indices, and user doc
  if (cleanEmail) {
    await deleteTenantVault(`auth_email_${hashAuthLookupKey(cleanEmail)}`);
    await withVaultLock(EMAIL_DIRECTORY_KEY, async () => {
      const emailDir = await loadTenantVaultAsync<EmailAccountDirectory>(EMAIL_DIRECTORY_KEY, {
        byEmail: {},
      });
      if (emailDir.byEmail[cleanEmail]) {
        delete emailDir.byEmail[cleanEmail];
        await saveTenantVaultAsync(EMAIL_DIRECTORY_KEY, emailDir);
      }
    });
  }
  if (user) {
    for (const p of user.authProviders || []) {
      await deleteTenantVault(`auth_prov_${p.provider}_${hashAuthLookupKey(p.providerId)}`);
    }
    await deleteTenantVault(`user_${user.id}`);
    await deleteTenantVault(`athlete_state_user_${user.id}`);
  }

  // Delete session, garmin, sid/strava athlete_state vaults, and /tmp raw Strava archives
  for (const sid of candidateSids) {
    const scopeKey = sid.slice(0, 24);
    await deleteTenantVault(`session_${scopeKey}`);
    await deleteTenantVault(`session_${sid}`);
    await clearGarminSessionAsync(GARMIN_SESSION_DIR, scopeKey);
    await deleteTenantVault(`athlete_state_sid_${sid}`);
    await deleteTenantVault(`athlete_state_sid_${sid.slice(0, 32)}`);
    await deleteTenantVault(`athlete_state_sid_${scopeKey}`);
  }
  for (const stravaId of stravaIds) {
    const cleanStravaId = String(stravaId).replace(/[^0-9a-zA-Z_-]/g, '');
    if (cleanStravaId) {
      await deleteTenantVault(`athlete_state_strava_${cleanStravaId}`);
      try {
        const archivePath = `/tmp/aeropulse-strava-archive-${cleanStravaId}.json`;
        if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
      } catch {
        // ignore
      }
    }
  }

  runtimeStore.stravaAccessToken = '';
  runtimeStore.stravaRefreshToken = '';
  runtimeStore.stravaAthleteId = undefined;
  bindRequestScopeKey(req, '');
  clearSessionCookie(res);
  appendSetCookieHeader(res, buildClearVaultCookieHeader());
  appendSetCookieHeader(res, buildClearUserCookieHeader());
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, deleted: true, origin: resolveSafeOrigin(req.headers.origin as string) });
}
