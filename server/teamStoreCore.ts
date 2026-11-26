import crypto from 'crypto';
import { stripSafeSportWeightAndBodyCompFields } from './cleanRoomFirewall.ts';
import {
  findTeamIdsByInvitedEmailPostgresAsync,
  findTeamIdsForUserPostgresAsync,
  loadTenantVaultAsync,
  loadTenantVaultsBatchAsync,
  saveTenantVaultAsync,
  syncNormalizedTeamPostgresAsync,
  withTeamRowLock,
  withVaultLock,
} from './tokenVault.ts';
import { resolveAthleteAgeTier } from '../src/physiology/ageAndComplianceEngine.ts';
import {
  calibrateThresholdsFromSeedMark,
  inferEventGroupFromSeedMark,
  normalizeCoachEventGroup,
  sanitizeTargetEventGroups,
} from '../src/physiology/teamOnboardingEngine.ts';
import type { CoachLandingAttribution } from '../src/utils/attribution.ts';
import { isHandTimedRaceData } from '../src/utils/raceTimingBadge.ts';
import type {
  AthleteOwnMeetScheduleItem,
  DelegatedSplitSubmissionRecord,
  DelegatedTimingSessionRecord,
  FieldEventLogRecord,
  GuardianSafetyAlertRecord,
  MeetDayPacketRecord,
  PracticeVenueCategory,
  PracticeVenueGeofence,
  TeamAnnouncementRecord,
  TeamAthleteLiveSnapshot,
  TeamAttendanceRecord,
  TeamBillingSummary,
  TeamBrandConfig,
  TeamBroadcastWorkout,
  TeamCustomSubgroup,
  TeamExternalSyncConfig,
  TeamInjuryCaseRecord,
  TeamMemberRole,
  TeamMembershipRecord,
  TeamMessageRecord,
  TeamMessagingPolicy,
  TeamPlanTier,
  TeamSummaryWithRole,
  TeamWorkoutComment,
  TeamWorkoutLibraryTemplate,
  UnifiedActivity,
} from '../src/types.ts';

export {
  inferEventGroupFromSeedMark,
  normalizeCoachEventGroup,
  sanitizeTargetEventGroups,
};

export function canProgramWorkoutsRole(role?: TeamMemberRole | string): boolean {
  return role === 'HEAD_COACH' || role === 'ASSISTANT_COACH';
}

export function canViewSafeguardingMedicalRole(role?: TeamMemberRole | string): boolean {
  return (
    role === 'HEAD_COACH' ||
    role === 'ASSISTANT_COACH' ||
    role === 'ATHLETIC_TRAINER' ||
    role === 'ORG_ADMIN'
  );
}

export function canViewAuditLogRole(role?: TeamMemberRole | string): boolean {
  return role === 'HEAD_COACH' || role === 'ORG_ADMIN';
}

export function canManageTeamGovernanceRole(role?: TeamMemberRole | string): boolean {
  return role === 'HEAD_COACH' || role === 'ORG_ADMIN';
}

export function maskEmailForDisplay(email?: string): string | undefined {
  const clean = String(email || '').trim().toLowerCase();
  const atIdx = clean.indexOf('@');
  if (atIdx <= 0) return undefined;
  const local = clean.slice(0, atIdx);
  const domain = clean.slice(atIdx + 1);
  return `${local.slice(0, 2)}***@${domain}`;
}

export interface TeamsDirectoryIndex {
  bySlug: Record<string, string>;
  byJoinCode: Record<string, string>;
  allTeamIds: string[];
}

export interface StoredMembershipInternal extends TeamMembershipRecord {
  rawInviteToken?: string;
  inviteTokenHash?: string;
  parentConsentTokenHash?: string;
}

export interface StoredDelegatedTimingSessionInternal extends DelegatedTimingSessionRecord {
  pinHash?: string;
}

export interface StoredTeamDocument {
  brand: TeamBrandConfig;
  memberships: StoredMembershipInternal[];
  broadcastWorkouts: TeamBroadcastWorkout[];
  workoutLibrary?: TeamWorkoutLibraryTemplate[];
  workoutComments?: TeamWorkoutComment[];
  guardianSafetyAlerts?: GuardianSafetyAlertRecord[];
  attendanceByDate?: Record<string, Record<string, TeamAttendanceRecord>>;
  announcements?: TeamAnnouncementRecord[];
  fieldMarkLogs?: FieldEventLogRecord[];
  fieldMarkLogsTotalCount?: number;
  meetDayPackets?: MeetDayPacketRecord[];
  delegatedTimingSessions?: StoredDelegatedTimingSessionInternal[];
  pendingTimingSubmissions?: DelegatedSplitSubmissionRecord[];
  injuryCases?: TeamInjuryCaseRecord[];
  billing?: TeamBillingSummary;
  teamMessages?: TeamMessageRecord[];
  messagingPolicy?: TeamMessagingPolicy;
  customSubgroups?: TeamCustomSubgroup[];
  coachAttribution?: CoachLandingAttribution;
  anonymousLinkOpens?: number;
  calendarFeedTokenHash?: string;
  calendarFeedTokenPlain?: string;
  updatedAt: string;
}

export interface UserTeamsIndex {
  teamIds: string[];
  email?: string;
  displayName?: string;
  updatedAt: string;
}

export interface EmailAccountDirectory {
  byEmail: Record<
    string,
    {
      sid: string;
      displayName?: string;
      updatedAt: string;
    }
  >;
}

export const TEAMS_DIRECTORY_KEY = 'teams_index_v1';
export const EMAIL_DIRECTORY_KEY = 'users_email_idx_v1';

export function teamDocVaultKey(teamId: string): string {
  return `team_doc_${teamId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}`;
}

export function userTeamsVaultKey(sid: string): string {
  return `user_teams_${sid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)}`;
}

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

export function sanitizeExternalSyncConfig(
  raw: Partial<TeamExternalSyncConfig> | undefined,
  existing?: TeamExternalSyncConfig
): TeamExternalSyncConfig | undefined {
  if (!raw && !existing) return undefined;
  const merged = { ...(existing || {}), ...(raw || {}) };
  const cleanUrl = (v?: string) => {
    if (!v) return undefined;
    const s = String(v).trim().slice(0, 300);
    return /^https?:\/\//i.test(s) || /^webcals?:\/\//i.test(s) ? s : undefined;
  };
  return {
    ...(merged.platform === 'ATHLETIC_NET' || merged.platform === 'TFRRS'
      ? { platform: merged.platform }
      : {}),
    ...(merged.athleticNetSchoolId
      ? { athleticNetSchoolId: String(merged.athleticNetSchoolId).replace(/[^0-9]/g, '').slice(0, 12) }
      : {}),
    ...(merged.athleticNetSportSlug === 'xc' ||
    merged.athleticNetSportSlug === 'track-and-field-outdoor' ||
    merged.athleticNetSportSlug === 'track-and-field-indoor'
      ? { athleticNetSportSlug: merged.athleticNetSportSlug }
      : {}),
    ...(cleanUrl(merged.athleticNetUrl) ? { athleticNetUrl: cleanUrl(merged.athleticNetUrl) } : {}),
    ...(cleanUrl(merged.tfrrsTeamUrl) ? { tfrrsTeamUrl: cleanUrl(merged.tfrrsTeamUrl) } : {}),
    ...(merged.tfrrsTeamCode
      ? { tfrrsTeamCode: String(merged.tfrrsTeamCode).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) }
      : {}),
    ...(merged.teamFilterKeyword
      ? { teamFilterKeyword: String(merged.teamFilterKeyword).trim().slice(0, 64) }
      : {}),
    ...(cleanUrl(merged.icsCalendarUrl) ? { icsCalendarUrl: cleanUrl(merged.icsCalendarUrl) } : {}),
    enablePublicParentHub:
      typeof merged.enablePublicParentHub === 'boolean'
        ? merged.enablePublicParentHub
        : false,
    publishUnofficialSplits:
      typeof merged.publishUnofficialSplits === 'boolean'
        ? merged.publishUnofficialSplits
        : false,
    ...(merged.lastSyncedAt ? { lastSyncedAt: String(merged.lastSyncedAt).slice(0, 40) } : {}),
  };
}

const VALID_PRACTICE_VENUE_CATEGORIES = new Set<PracticeVenueCategory>([
  'TRACK',
  'XC_COURSE',
  'ROAD_CAMPUS',
  'GYM_WEIGHTS',
  'POOL_CROSS',
  'OTHER',
]);

export function sanitizeDistrictName(raw?: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim().slice(0, 80);
  return trimmed || undefined;
}

export function sanitizePracticeVenues(raw?: unknown): PracticeVenueGeofence[] {
  if (!Array.isArray(raw)) return [];
  const out: PracticeVenueGeofence[] = [];
  const seenIds = new Set<string>();
  for (const entry of raw) {
    if (out.length >= 8) break;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    const name = String(item.name || '').trim().slice(0, 64);
    if (!name) continue;
    const hasLat =
      item.latitude !== undefined &&
      item.latitude !== null &&
      String(item.latitude).trim() !== '';
    const hasLng =
      item.longitude !== undefined &&
      item.longitude !== null &&
      String(item.longitude).trim() !== '';
    const lat = hasLat ? Number(item.latitude) : Number.NaN;
    const lng = hasLng ? Number(item.longitude) : Number.NaN;
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      continue;
    }
    const rawRadius =
      item.radiusMeters !== undefined &&
      item.radiusMeters !== null &&
      String(item.radiusMeters).trim() !== ''
        ? Number(item.radiusMeters)
        : NaN;
    const radiusMeters = Number.isFinite(rawRadius)
      ? Math.max(50, Math.min(1500, Math.round(rawRadius)))
      : 250;
    const rawCat = String(item.category || 'TRACK')
      .trim()
      .toUpperCase() as PracticeVenueCategory;
    const category: PracticeVenueCategory = VALID_PRACTICE_VENUE_CATEGORIES.has(rawCat)
      ? rawCat
      : 'TRACK';
    let id =
      typeof item.id === 'string'
        ? item.id.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)
        : '';
    if (!id || seenIds.has(id)) {
      id = `venue_${crypto.randomBytes(4).toString('hex')}`;
    }
    seenIds.add(id);
    out.push({
      id,
      name,
      category,
      latitude: lat,
      longitude: lng,
      radiusMeters,
      enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
    });
  }
  return out;
}

export function projectSafePublicExternalSync(
  externalSync?: TeamExternalSyncConfig
): TeamExternalSyncConfig | undefined {
  if (!externalSync) return undefined;
  return {
    ...(externalSync.platform ? { platform: externalSync.platform } : {}),
    ...(externalSync.athleticNetSchoolId
      ? { athleticNetSchoolId: externalSync.athleticNetSchoolId }
      : {}),
    ...(externalSync.athleticNetSportSlug
      ? { athleticNetSportSlug: externalSync.athleticNetSportSlug }
      : {}),
    ...(externalSync.athleticNetUrl ? { athleticNetUrl: externalSync.athleticNetUrl } : {}),
    ...(externalSync.tfrrsTeamUrl ? { tfrrsTeamUrl: externalSync.tfrrsTeamUrl } : {}),
    ...(externalSync.tfrrsTeamCode ? { tfrrsTeamCode: externalSync.tfrrsTeamCode } : {}),
    ...(typeof externalSync.enablePublicParentHub === 'boolean'
      ? { enablePublicParentHub: externalSync.enablePublicParentHub }
      : {}),
    ...(typeof externalSync.publishUnofficialSplits === 'boolean'
      ? { publishUnofficialSplits: externalSync.publishUnofficialSplits }
      : {}),
    ...(externalSync.lastSyncedAt ? { lastSyncedAt: externalSync.lastSyncedAt } : {}),
  };
}

export async function loadTeamDocRaw(teamId: string): Promise<StoredTeamDocument | null> {
  return loadTenantVaultAsync<StoredTeamDocument | null>(teamDocVaultKey(teamId), null);
}

export async function saveTeamDocRaw(
  teamId: string,
  doc: StoredTeamDocument
): Promise<void> {
  await saveTenantVaultAsync(teamDocVaultKey(teamId), doc);
  await syncNormalizedTeamPostgresAsync(
    teamId,
    {
      slug: doc.brand.slug,
      joinCode: doc.brand.joinCode,
      orgType: doc.brand.orgType,
    },
    doc,
    (doc.memberships || []).map((m) => ({
      membershipId: m.membershipId,
      userSid: m.userSid,
      invitedEmail: m.invitedEmail,
      role: m.role,
      status: m.status,
    }))
  );
}

export async function loadDirectory(): Promise<TeamsDirectoryIndex> {
  return loadTenantVaultAsync<TeamsDirectoryIndex>(TEAMS_DIRECTORY_KEY, {
    bySlug: {},
    byJoinCode: {},
    allTeamIds: [],
  });
}

export async function addTeamToUserIndex(
  sid: string,
  teamId: string,
  displayName?: string,
  email?: string
): Promise<void> {
  await withVaultLock(userTeamsVaultKey(sid), async () => {
    const idx = await loadTenantVaultAsync<UserTeamsIndex>(userTeamsVaultKey(sid), {
      teamIds: [],
      updatedAt: new Date().toISOString(),
    });
    if (!idx.teamIds.includes(teamId)) {
      idx.teamIds.push(teamId);
    }
    if (displayName) idx.displayName = displayName;
    if (email) idx.email = email;
    idx.updatedAt = new Date().toISOString();
    await saveTenantVaultAsync(userTeamsVaultKey(sid), idx);
  });
}

export async function removeTeamFromUserIndex(sid: string, teamId: string): Promise<void> {
  if (!sid) return;
  await withVaultLock(userTeamsVaultKey(sid), async () => {
    const idx = await loadTenantVaultAsync<UserTeamsIndex>(userTeamsVaultKey(sid), {
      teamIds: [],
      updatedAt: new Date().toISOString(),
    });
    if (idx.teamIds.includes(teamId)) {
      idx.teamIds = idx.teamIds.filter((id) => id !== teamId);
      idx.updatedAt = new Date().toISOString();
      await saveTenantVaultAsync(userTeamsVaultKey(sid), idx);
    }
  });
}

/**
 * Tracks D2 free coach sandbox (<= 5 non-revoked athletes) vs Founding Team (> 5)
 * on the backend without adding checkout/billing friction during beta.
 */
export function resolveTeamPlanTier(
  memberships: Array<{ role?: string; status?: string }>
): TeamPlanTier {
  const activeOrInvitedAthletes = (memberships || []).filter(
    (m) =>
      m.status !== 'REVOKED' &&
      m.status !== 'ALUMNI' &&
      m.role !== 'HEAD_COACH' &&
      m.role !== 'ASSISTANT_COACH' &&
      m.role !== 'ORG_ADMIN' &&
      m.role !== 'ATHLETIC_TRAINER' &&
      m.role !== 'PARENT_FOLLOWER'
  ).length;
  return activeOrInvitedAthletes <= 5 ? 'SANDBOX' : 'FOUNDING_TEAM';
}

export function shiftMeetClockTime(rawTime?: string, delayMinutes?: number): string | undefined {
  if (!rawTime) return undefined;
  const trimmed = String(rawTime).trim();
  if (!trimmed) return undefined;
  if (typeof delayMinutes !== 'number' || !Number.isFinite(delayMinutes) || delayMinutes === 0) {
    return trimmed;
  }
  const shift = Math.round(delayMinutes);
  const amPmMatch = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (amPmMatch) {
    let hrs = Number(amPmMatch[1]);
    const mins = Number(amPmMatch[2]);
    const meridiem = amPmMatch[3].toUpperCase();
    if (hrs < 1 || hrs > 12 || mins < 0 || mins > 59) return trimmed;
    if (meridiem === 'PM' && hrs !== 12) hrs += 12;
    if (meridiem === 'AM' && hrs === 12) hrs = 0;
    const total = (((hrs * 60 + mins + shift) % 1440) + 1440) % 1440;
    const nextHrs24 = Math.floor(total / 60);
    const nextMins = total % 60;
    const nextMeridiem = nextHrs24 >= 12 ? 'PM' : 'AM';
    const nextHrs12 = nextHrs24 % 12 === 0 ? 12 : nextHrs24 % 12;
    return `${nextHrs12}:${String(nextMins).padStart(2, '0')} ${nextMeridiem}`;
  }
  const militaryMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (militaryMatch) {
    const hrs = Number(militaryMatch[1]);
    const mins = Number(militaryMatch[2]);
    if (hrs < 0 || hrs > 23 || mins < 0 || mins > 59) return trimmed;
    const total = (((hrs * 60 + mins + shift) % 1440) + 1440) % 1440;
    const nextHrs = Math.floor(total / 60);
    const nextMins = total % 60;
    return `${String(nextHrs).padStart(2, '0')}:${String(nextMins).padStart(2, '0')}`;
  }
  return trimmed;
}

function buildOwnMeetDaySchedule(params: {
  packets?: MeetDayPacketRecord[];
  targetMembershipIds: ReadonlySet<string>;
}): AthleteOwnMeetScheduleItem[] {
  const { packets, targetMembershipIds } = params;
  if (!Array.isArray(packets) || packets.length === 0 || targetMembershipIds.size === 0) {
    return [];
  }
  const out: AthleteOwnMeetScheduleItem[] = [];
  for (const pkt of packets) {
    if (!pkt || !Array.isArray(pkt.entries)) continue;
    const delayMins =
      typeof pkt.meetDelayMinutes === 'number' && Number.isFinite(pkt.meetDelayMinutes)
        ? Math.round(pkt.meetDelayMinutes)
        : undefined;
    for (const entry of pkt.entries) {
      if (!entry || entry.scratched) continue;
      if (!entry.membershipId || !targetMembershipIds.has(entry.membershipId)) continue;
      const shiftedStart = shiftMeetClockTime(entry.eventStartTime, delayMins);
      const shiftedCall = shiftMeetClockTime(entry.checkInCallTime, delayMins);
      out.push({
        packetId: pkt.packetId,
        meetTitle: pkt.meetTitle,
        meetDate: pkt.meetDate,
        eventCode: entry.eventCode,
        seedMarkRaw: entry.seedMarkRaw,
        ...(entry.division ? { division: entry.division } : {}),
        ...(entry.genderDivision ? { genderDivision: entry.genderDivision } : {}),
        ...(entry.relayTeamCode ? { relayTeamCode: entry.relayTeamCode } : {}),
        ...(entry.relayLegOrder ? { relayLegOrder: entry.relayLegOrder } : {}),
        ...(entry.isAlternate !== undefined ? { isAlternate: entry.isAlternate } : {}),
        ...(entry.officialHeat !== undefined ? { officialHeat: entry.officialHeat } : {}),
        ...(entry.officialLaneOrHip ? { officialLaneOrHip: entry.officialLaneOrHip } : {}),
        ...(entry.officialFlight !== undefined ? { officialFlight: entry.officialFlight } : {}),
        ...(entry.officialOrder !== undefined ? { officialOrder: entry.officialOrder } : {}),
        ...(shiftedStart ? { eventStartTime: shiftedStart } : {}),
        ...(shiftedCall ? { checkInCallTime: shiftedCall } : {}),
        ...(entry.bibNumber ? { bibNumber: entry.bibNumber } : {}),
        ...(entry.assignmentSource ? { assignmentSource: entry.assignmentSource } : {}),
        ...(pkt.athleticLiveUrl ? { athleticLiveUrl: pkt.athleticLiveUrl } : {}),
        ...(delayMins !== undefined ? { meetDelayMinutes: delayMins } : {}),
        athleteName: entry.athleteName,
        membershipId: entry.membershipId,
      });
    }
  }
  return out;
}

function sanitizeDelegatedTimingSessionForCaller(
  session: StoredDelegatedTimingSessionInternal
): DelegatedTimingSessionRecord {
  const { pinHash: _dropPinHash, ...clean } = session;
  return clean;
}

export function resolveLinkedChildMembershipIds(
  memberships: TeamMembershipRecord[],
  myMembership: Pick<TeamMembershipRecord, 'role' | 'invitedEmail'> | undefined
): Set<string> | null {
  if (!myMembership || myMembership.role !== 'PARENT_FOLLOWER') return null;
  const parentFollowerEmail = myMembership.invitedEmail?.trim().toLowerCase();
  if (!parentFollowerEmail) return new Set<string>();
  return new Set(
    memberships
      .filter(
        (m) =>
          m.role === 'ATHLETE' &&
          m.status !== 'REVOKED' &&
          m.parentGuardianEmail?.trim().toLowerCase() === parentFollowerEmail
      )
      .map((m) => m.membershipId)
  );
}

export function projectTeamSummaryForCaller(
  doc: StoredTeamDocument,
  callerSid: string,
  originUrl: string
): TeamSummaryWithRole | null {
  const myMembership = doc.memberships.find(
    (m) =>
      m.userSid === callerSid &&
      m.status !== 'REVOKED' &&
      m.status !== 'ALUMNI'
  );
  if (!myMembership) return null;

  const isStaffViewer = canViewSafeguardingMedicalRole(myMembership.role);
  const isCoach = isStaffViewer;
  const isParentFollower = myMembership.role === 'PARENT_FOLLOWER';
  const linkedChildMembershipIds = resolveLinkedChildMembershipIds(doc.memberships, myMembership);

  const athleteMembers = doc.memberships.filter(
    (m) =>
      m.status !== 'REVOKED' &&
      (!isParentFollower || m.role === 'ATHLETE')
  );
  const totalInvited = athleteMembers.length;
  const individualOpened = athleteMembers.filter(
    (m) => m.status === 'OPENED' || m.status === 'ACTIVE'
  ).length;
  const openedCount = Math.max(
    individualOpened,
    individualOpened + (doc.anonymousLinkOpens || 0)
  );
  const activeCount = athleteMembers.filter((m) => m.status === 'ACTIVE').length;
  const watchConnectedCount = athleteMembers.filter(
    (m) => Boolean(m.liveSnapshot?.hasConnectedWatch)
  ).length;

  const cleanOrigin = originUrl.replace(/\/+$/, '');
  const nowRef = new Date();
  const sanitizedMemberships: TeamMembershipRecord[] = athleteMembers.map((m) => {
    const isSelf = m.userSid === callerSid;
    const isPeerTeammate = !isSelf && !isCoach && !isParentFollower;
    const priv = m.liveSnapshot?.privacySettings;
    const hideWellnessFromCoach = !isSelf && priv?.shareWellnessAndHrv === 'PRIVATE';
    const hidePmcFromCoach = !isSelf && priv?.sharePmcAndZones === 'PRIVATE';
    const ageResolved = resolveAthleteAgeTier({
      birthMonthYear: m.birthMonthYear,
      birthYear: m.birthYear,
      orgType: doc.brand.orgType,
      graduationYear: m.graduationYear,
      now: nowRef,
    });
    const effectiveIsMinor =
      ageResolved.ageTier === 'UNKNOWN' ? Boolean(m.isMinorU18) : ageResolved.isMinorU18;
    const safeSportShieldEnforced = Boolean(
      doc.brand.defaultSafeSportShield ||
        effectiveIsMinor ||
        m.liveSnapshot?.safeSportHideWeight
    );

    let projectedSnapshot: TeamAthleteLiveSnapshot | undefined;
    if (m.liveSnapshot && !isParentFollower) {
      const rawWatch = m.liveSnapshot.safeSportWatch;
      const projectedSafeSportWatch = !rawWatch
        ? undefined
        : isSelf || myMembership.role === 'ATHLETIC_TRAINER'
          ? rawWatch
          : isCoach
            ? {
                trafficLight: rawWatch.trafficLight,
                coachSafeSummaryLabel: rawWatch.coachSafeSummaryLabel,
              }
            : undefined;

      const hidePmc = !isSelf && (!isCoach || hidePmcFromCoach);
      const hideWellness = !isSelf && (!isCoach || hideWellnessFromCoach);
      const rawVerdict = m.liveSnapshot.verdictLabel;
      const isNeutralVerdict =
        rawVerdict === 'Awaiting Parent Consent' ||
        rawVerdict === 'Active' ||
        rawVerdict === 'Connected' ||
        rawVerdict === 'Joined · Awaiting First Sync';

      const baseSnapshot: TeamAthleteLiveSnapshot = {
        ...m.liveSnapshot,
        verdictLabel: isPeerTeammate
          ? 'Connected'
          : hideWellness && !isNeutralVerdict
            ? 'Private'
            : rawVerdict,
        readinessScore: hideWellness ? 0 : m.liveSnapshot.readinessScore,
        acuteLoad7d: hidePmc ? 0 : m.liveSnapshot.acuteLoad7d,
        caraHours7d: hidePmc ? 0 : m.liveSnapshot.caraHours7d,
        lowAerobicPct: hidePmc ? 0 : m.liveSnapshot.lowAerobicPct,
        highAerobicPct: hidePmc ? 0 : m.liveSnapshot.highAerobicPct,
        neuromuscularPct: hidePmc ? 0 : m.liveSnapshot.neuromuscularPct,
        ftpWatts:
          hidePmc || (safeSportShieldEnforced && !isCoach && !isSelf)
            ? undefined
            : m.liveSnapshot.ftpWatts,
        thresholdPaceSecsPerKm: hidePmc
          ? undefined
          : m.liveSnapshot.thresholdPaceSecsPerKm,
        ctl: hidePmc ? 0 : m.liveSnapshot.ctl,
        atl: hidePmc ? 0 : m.liveSnapshot.atl,
        tsb: hidePmc ? 0 : m.liveSnapshot.tsb,
        // Never leak raw biometric wellnessDays or activity logs to fellow teammates
        wellnessDays: hideWellness ? undefined : m.liveSnapshot.wellnessDays,
        activities: isSelf || isCoach ? m.liveSnapshot.activities : undefined,
        sessionCheckIns: hideWellness ? undefined : m.liveSnapshot.sessionCheckIns,
        safeSportWatch: projectedSafeSportWatch,
      };
      projectedSnapshot = safeSportShieldEnforced
        ? stripSafeSportWeightAndBodyCompFields(baseSnapshot, {
            maskWellnessWeightKgZero: true,
          })
        : baseSnapshot;
    }

    const isLinkedChild = Boolean(
      linkedChildMembershipIds && linkedChildMembershipIds.has(m.membershipId)
    );
    const officialPublicResults = Array.isArray(m.coachRecordedActivities)
      ? m.coachRecordedActivities
          .filter((a) => {
            if (!a?.officialRaceData) return false;
            if (isLinkedChild) return true;
            return !isHandTimedRaceData(a.officialRaceData, a);
          })
          .map((a) => {
            const sanitized = {
              ...a,
              athleteWeightKg: undefined,
              avgHr: 0,
              maxHr: 0,
              streams: undefined,
              summaryPolyline: undefined,
              routeLatLngs: undefined,
              startLatLng: undefined,
              endLatLng: undefined,
            } as UnifiedActivity & { map?: unknown; description?: unknown };
            delete sanitized.summaryPolyline;
            delete sanitized.streams;
            delete sanitized.routeLatLngs;
            delete sanitized.startLatLng;
            delete sanitized.endLatLng;
            delete sanitized.map;
            delete sanitized.description;
            return sanitized as UnifiedActivity;
          })
      : undefined;
    const shouldAbbreviateForParent = Boolean(
      isParentFollower &&
        !isLinkedChild &&
        !m.externalSource &&
        effectiveIsMinor &&
        m.parentConsentStatus !== 'ACKNOWLEDGED'
    );
    let projectedInvitedName = m.invitedName;
    if (shouldAbbreviateForParent) {
      const nameParts = String(m.invitedName || '').trim().split(/\s+/).filter(Boolean);
      projectedInvitedName =
        nameParts.length >= 2
          ? `${nameParts[0]} ${nameParts[nameParts.length - 1][0]}.`
          : nameParts[0] || 'Athlete';
    }

    const base: TeamMembershipRecord = {
      membershipId: m.membershipId,
      teamId: m.teamId,
      userSid: isCoach || isSelf ? m.userSid : undefined,
      stravaAthleteId: isCoach || isSelf ? m.stravaAthleteId : undefined,
      sharingTier: isParentFollower ? undefined : m.sharingTier,
      role: m.role,
      squadGroup: m.squadGroup,
      ...(m.eventGroup ? { eventGroup: m.eventGroup } : {}),
      ...(isStaffViewer && Array.isArray(m.coachEventGroups) && m.coachEventGroups.length > 0
        ? { coachEventGroups: m.coachEventGroups }
        : {}),
      ...((isStaffViewer || isSelf) && m.coachSpecialtyTitle
        ? { coachSpecialtyTitle: m.coachSpecialtyTitle }
        : {}),
      ...((isStaffViewer || isSelf) &&
      Array.isArray(m.assignedAthleteMembershipIds) &&
      m.assignedAthleteMembershipIds.length > 0
        ? { assignedAthleteMembershipIds: m.assignedAthleteMembershipIds }
        : {}),
      invitedName: projectedInvitedName,
      graduationYear: m.graduationYear,
      birthYear: isCoach || isSelf ? m.birthYear : undefined,
      birthMonthYear: isCoach || isSelf ? m.birthMonthYear : undefined,
      isMinorU18: effectiveIsMinor,
      parentConsentStatus:
        isCoach || isSelf
          ? effectiveIsMinor
            ? m.parentConsentStatus
            : 'NOT_REQUIRED'
          : undefined,
      parentConsentAt: isCoach || isSelf ? m.parentConsentAt : undefined,
      seedMarkOrFtp: m.seedMarkOrFtp,
      ...(m.externalSource ? { externalSource: m.externalSource } : {}),
      ...(m.externalAthleteId ? { externalAthleteId: m.externalAthleteId } : {}),
      ...(m.externalProfileUrl ? { externalProfileUrl: m.externalProfileUrl } : {}),
      ...(m.genderDivision ? { genderDivision: m.genderDivision } : {}),
      ...((isStaffViewer || isSelf || isLinkedChild) && typeof m.photoReleaseOptOut === 'boolean'
        ? { photoReleaseOptOut: m.photoReleaseOptOut }
        : {}),
      status: m.status,
      emailDeliveryStatus: isCoach || isSelf ? m.emailDeliveryStatus : undefined,
      invitedAt: m.invitedAt,
      openedAt: m.openedAt,
      joinedAt: m.joinedAt,
      ...(m.leftAt ? { leftAt: m.leftAt } : {}),
      ...(m.graduatedAt ? { graduatedAt: m.graduatedAt } : {}),
      liveSnapshot: projectedSnapshot,
      coachRecordedActivities: isParentFollower
        ? officialPublicResults
        : (isCoach || isSelf) && Array.isArray(m.coachRecordedActivities)
          ? safeSportShieldEnforced
            ? stripSafeSportWeightAndBodyCompFields(m.coachRecordedActivities, {
                maskWellnessWeightKgZero: true,
              })
            : m.coachRecordedActivities
          : undefined,
    };
    if (isCoach || isSelf) {
      base.invitedEmail = m.invitedEmail;
      base.invitedPhone = m.invitedPhone;
      base.parentGuardianEmail = m.parentGuardianEmail;
      const emailParam = m.invitedEmail ? `email=${encodeURIComponent(m.invitedEmail)}` : '';
      if (m.rawInviteToken) {
        base.magicJoinUrl = `${cleanOrigin}/join/${doc.brand.slug}?t=${m.rawInviteToken}${emailParam ? `&${emailParam}` : ''}`;
      } else {
        base.magicJoinUrl = `${cleanOrigin}/join/${doc.brand.slug}${emailParam ? `?${emailParam}` : ''}`;
      }
    }
    return base;
  });

  const visibleBroadcasts = (doc.broadcastWorkouts || []).filter((bw) => {
    if (isCoach) return true;
    if (isParentFollower) {
      return !bw.targetMembershipIds || bw.targetMembershipIds.length === 0;
    }
    if (bw.athleteOverrides && bw.athleteOverrides[myMembership.membershipId]) {
      return true;
    }
    if (Array.isArray(bw.targetMembershipIds) && bw.targetMembershipIds.length > 0) {
      return bw.targetMembershipIds.includes(myMembership.membershipId);
    }
    const squadMatches =
      bw.targetSquadGroup === 'ALL' ||
      bw.targetSquadGroup.toLowerCase() === myMembership.squadGroup.toLowerCase();
    if (!squadMatches) return false;
    if (Array.isArray(bw.targetEventGroups) && bw.targetEventGroups.length > 0) {
      return Boolean(myMembership.eventGroup) && bw.targetEventGroups.includes(myMembership.eventGroup!);
    }
    return true;
  }).map((bw) => {
    if (isStaffViewer) return bw;
    if (isParentFollower) {
      return {
        ...bw,
        athleteOverrides: undefined,
        targetMembershipIds: undefined,
      };
    }
    const ownOverride = bw.athleteOverrides?.[myMembership.membershipId];
    return {
      ...bw,
      athleteOverrides: ownOverride ? { [myMembership.membershipId]: ownOverride } : undefined,
      targetMembershipIds: undefined,
    };
  });

  const visibleComments = (doc.workoutComments || []).filter((c) => {
    if (isStaffViewer) return true;
    if (isParentFollower) {
      return Boolean(
        c.guardianVisible &&
          linkedChildMembershipIds &&
          linkedChildMembershipIds.has(c.targetMembershipId)
      );
    }
    return c.targetMembershipId === myMembership.membershipId;
  });

  const visibleSafetyAlerts = (doc.guardianSafetyAlerts || []).filter((a) => {
    if (isStaffViewer) return true;
    if (isParentFollower) {
      return Boolean(
        linkedChildMembershipIds && linkedChildMembershipIds.has(a.targetMembershipId)
      );
    }
    return a.targetMembershipId === myMembership.membershipId;
  });

  const visibleAnnouncements = (doc.announcements || []).filter((ann) => {
    if (isStaffViewer) return true;
    if (isParentFollower) return Boolean(ann.publishToParentHub);
    if (!Array.isArray(ann.targetEventGroups) || ann.targetEventGroups.length === 0) {
      return true;
    }
    return Boolean(myMembership.eventGroup) && ann.targetEventGroups.includes(myMembership.eventGroup!);
  });

  const visibleFieldMarks = isParentFollower
    ? []
    : isStaffViewer
      ? doc.fieldMarkLogs || []
      : (doc.fieldMarkLogs || []).filter((f) => f.membershipId === myMembership.membershipId);

  const subgroupById = new Map<string, TeamCustomSubgroup>(
    (doc.customSubgroups || []).map((sg) => [sg.id, sg])
  );
  const subgroupRequiresLinkedParents = (sg: TeamCustomSubgroup): boolean =>
    sg.includeLinkedParents !== false ||
    doc.brand.orgType === 'HIGH_SCHOOL' ||
    doc.memberships.some((m) => sg.memberIds.includes(m.membershipId) && Boolean(m.isMinorU18));

  const visibleCustomSubgroups = (doc.customSubgroups || []).filter((sg) => {
    if (isStaffViewer) return true;
    if (sg.memberIds.includes(myMembership.membershipId)) return true;
    if (isParentFollower && subgroupRequiresLinkedParents(sg) && linkedChildMembershipIds) {
      return sg.memberIds.some((mid) => linkedChildMembershipIds.has(mid));
    }
    return false;
  });

  const visibleTeamMessages: TeamMessageRecord[] = (doc.teamMessages || []).filter((msg) => {
    if (isStaffViewer) return true;
    if (msg.channelScope === 'COACHES_STAFF') return false;
    if (msg.channelScope === 'PARENTS_ONLY') {
      return isParentFollower;
    }
    if (msg.channelScope === 'CUSTOM_SUBGROUP') {
      const sg = msg.customSubgroupId ? subgroupById.get(msg.customSubgroupId) : undefined;
      if (!sg) return false;
      if (sg.memberIds.includes(myMembership.membershipId)) return true;
      if (isParentFollower && subgroupRequiresLinkedParents(sg) && linkedChildMembershipIds) {
        return sg.memberIds.some((mid) => linkedChildMembershipIds.has(mid));
      }
      return false;
    }
    if (msg.channelScope === 'ALL_TEAM') {
      if (isParentFollower) {
        return canViewSafeguardingMedicalRole(msg.senderRole);
      }
      return true;
    }
    if (msg.channelScope === 'EVENT_GROUP') {
      if (isParentFollower) {
        if (!msg.eventGroup) return Boolean(linkedChildMembershipIds && linkedChildMembershipIds.size > 0);
        return doc.memberships.some(
          (child) =>
            linkedChildMembershipIds?.has(child.membershipId) &&
            (!child.eventGroup || child.eventGroup === msg.eventGroup)
        );
      }
      return !msg.eventGroup || !myMembership.eventGroup || msg.eventGroup === myMembership.eventGroup;
    }
    if (msg.channelScope === 'DIRECT_TRANSPARENT') {
      if (isParentFollower) {
        return Boolean(
          msg.guardianCcApplied &&
            msg.targetMembershipId &&
            linkedChildMembershipIds?.has(msg.targetMembershipId)
        );
      }
      return Boolean(msg.targetMembershipId && msg.targetMembershipId === myMembership.membershipId);
    }
    return false;
  });

  const resolvedMessagingPolicy: TeamMessagingPolicy = {
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

  const projectedExternalSync = isParentFollower
    ? projectSafePublicExternalSync(doc.brand.externalSync)
    : doc.brand.externalSync;

  const projectedAttendanceByDate: Record<string, Record<string, TeamAttendanceRecord>> | undefined =
    doc.attendanceByDate
      ? isStaffViewer
        ? doc.attendanceByDate
        : !isParentFollower && myMembership.role === 'ATHLETE'
          ? (() => {
              const ownOnly: Record<string, Record<string, TeamAttendanceRecord>> = {};
              for (const [dateKey, dayMap] of Object.entries(doc.attendanceByDate)) {
                const selfRec = dayMap?.[myMembership.membershipId];
                if (selfRec) {
                  ownOnly[dateKey] = { [myMembership.membershipId]: selfRec };
                }
              }
              return ownOnly;
            })()
          : undefined
      : undefined;

  const isProgramStaff = canProgramWorkoutsRole(myMembership.role);
  const nowMs = Date.now();
  const projectedDelegatedSessions =
    isProgramStaff && !isParentFollower
      ? (doc.delegatedTimingSessions || []).map(sanitizeDelegatedTimingSessionForCaller)
      : undefined;
  const projectedPendingSubmissions =
    isProgramStaff && !isParentFollower ? doc.pendingTimingSubmissions || [] : undefined;
  const projectedMyTimingAssignments =
    !isParentFollower && myMembership.role === 'ATHLETE'
      ? (doc.delegatedTimingSessions || [])
          .filter(
            (s) =>
              s.assignedMembershipId === myMembership.membershipId &&
              !s.revokedAt &&
              (!s.expiresAt || Date.parse(s.expiresAt) > nowMs)
          )
          .map(sanitizeDelegatedTimingSessionForCaller)
      : undefined;
  const projectedMyMeetDaySchedule =
    myMembership.role === 'ATHLETE'
      ? buildOwnMeetDaySchedule({
          packets: doc.meetDayPackets,
          targetMembershipIds: new Set([myMembership.membershipId]),
        })
      : isParentFollower
        ? buildOwnMeetDaySchedule({
            packets: doc.meetDayPackets,
            targetMembershipIds: linkedChildMembershipIds || new Set<string>(),
          })
        : undefined;

  return {
    brand: {
      ...doc.brand,
      ...(isParentFollower ? { joinCode: '' } : {}),
      ...(doc.brand.externalSync
        ? projectedExternalSync
          ? { externalSync: projectedExternalSync }
          : { externalSync: undefined }
        : {}),
      planTier: resolveTeamPlanTier(doc.memberships),
    },
    myRole: myMembership.role,
    mySquadGroup: myMembership.squadGroup,
    ...(myMembership.eventGroup ? { myEventGroup: myMembership.eventGroup } : {}),
    ...(Array.isArray(myMembership.coachEventGroups) && myMembership.coachEventGroups.length > 0
      ? { myCoachEventGroups: myMembership.coachEventGroups }
      : {}),
    ...(myMembership.coachSpecialtyTitle
      ? { myCoachSpecialtyTitle: myMembership.coachSpecialtyTitle }
      : {}),
    ...(Array.isArray(myMembership.assignedAthleteMembershipIds) &&
    myMembership.assignedAthleteMembershipIds.length > 0
      ? { myAssignedAthleteMembershipIds: myMembership.assignedAthleteMembershipIds }
      : {}),
    ...(linkedChildMembershipIds && linkedChildMembershipIds.size > 0
      ? { myLinkedChildMembershipIds: Array.from(linkedChildMembershipIds) }
      : {}),
    myMembershipId: myMembership.membershipId,
    totalInvited,
    openedCount,
    activeCount,
    watchConnectedCount,
    memberships: sanitizedMemberships,
    broadcastWorkouts: visibleBroadcasts,
    ...(isParentFollower ? {} : { workoutLibrary: doc.workoutLibrary || [] }),
    workoutComments: visibleComments,
    guardianSafetyAlerts: visibleSafetyAlerts,
    ...(projectedAttendanceByDate ? { attendanceByDate: projectedAttendanceByDate } : {}),
    announcements: visibleAnnouncements,
    ...(isParentFollower ? {} : { fieldMarkLogs: visibleFieldMarks }),
    ...(typeof doc.fieldMarkLogsTotalCount === 'number' && !isParentFollower
      ? { fieldMarkLogsTotalCount: doc.fieldMarkLogsTotalCount }
      : {}),
    ...(isStaffViewer && !isParentFollower ? { meetDayPackets: doc.meetDayPackets || [] } : {}),
    ...(projectedDelegatedSessions !== undefined
      ? { delegatedTimingSessions: projectedDelegatedSessions }
      : {}),
    ...(projectedPendingSubmissions !== undefined
      ? { pendingTimingSubmissions: projectedPendingSubmissions }
      : {}),
    ...(projectedMyTimingAssignments !== undefined
      ? { myDelegatedTimingAssignments: projectedMyTimingAssignments }
      : {}),
    ...(projectedMyMeetDaySchedule !== undefined
      ? { myMeetDaySchedule: projectedMyMeetDaySchedule }
      : {}),
    ...(Array.isArray(doc.injuryCases)
      ? {
          injuryCases: doc.injuryCases
            .filter((c) => {
              if (isStaffViewer) return true;
              if (isParentFollower) {
                return Boolean(
                  linkedChildMembershipIds && linkedChildMembershipIds.has(c.membershipId)
                );
              }
              return c.membershipId === myMembership.membershipId;
            })
            .map((c) => {
              if (myMembership.role === 'ATHLETIC_TRAINER') return c;
              const { privateClinicalNotes: _dropClinical, ...coachSafe } = c;
              return coachSafe;
            }),
        }
      : {}),
    ...(canManageTeamGovernanceRole(myMembership.role) && doc.billing
      ? (() => {
          const {
            stripeCustomerId: _stripeCust,
            stripeSubscriptionId: _stripeSub,
            ...safeBilling
          } = doc.billing;
          return {
            billing: {
              ...safeBilling,
              stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
            },
          };
        })()
      : {}),
    teamMessages: visibleTeamMessages,
    messagingPolicy: resolvedMessagingPolicy,
    ...(visibleCustomSubgroups.length > 0 ? { customSubgroups: visibleCustomSubgroups } : {}),
  };
}

/**
 * Batch-loads all team documents associated with a caller SID using the user's index,
 * Postgres membership table (when active), and `loadTenantVaultsBatchAsync` to eliminate N+1 reads.
 */
export async function loadTeamDocsForCaller(callerSid: string): Promise<StoredTeamDocument[]> {
  const userIdx = await loadTenantVaultAsync<UserTeamsIndex>(
    userTeamsVaultKey(callerSid),
    {
      teamIds: [],
      updatedAt: '',
    }
  );
  const pgTeamIds = await findTeamIdsForUserPostgresAsync([callerSid]);
  const teamIds = Array.from(
    new Set([...(userIdx.teamIds || []), ...(pgTeamIds || [])].filter(Boolean))
  );
  if (teamIds.length === 0) return [];
  const docKeys = teamIds.map((teamId) => teamDocVaultKey(teamId));
  const docsByKey = await loadTenantVaultsBatchAsync<StoredTeamDocument | null>(docKeys);
  const docs: StoredTeamDocument[] = [];
  for (const key of docKeys) {
    const doc = docsByKey.get(key) ?? null;
    if (doc) docs.push(doc);
  }
  return docs;
}

export async function listTeamsForUser(
  callerSid: string,
  originUrl: string
): Promise<TeamSummaryWithRole[]> {
  const docs = await loadTeamDocsForCaller(callerSid);
  const out: TeamSummaryWithRole[] = [];
  for (const doc of docs) {
    const summary = projectTeamSummaryForCaller(doc, callerSid, originUrl);
    if (summary) out.push(summary);
  }
  return out;
}

/**
 * Scans team rosters and automatically links pending invites (status INVITED or OPENED)
 * to a verified user session when their email matches the invited email address.
 */
export async function autoLinkPendingTeamInvitesByEmail(params: {
  email: string;
  userSid: string;
  athleteName?: string;
  stravaAthleteId?: string;
}): Promise<string[]> {
  const cleanEmail = params.email?.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@') || !params.userSid) return [];

  const pgTeamIds = await findTeamIdsByInvitedEmailPostgresAsync(cleanEmail);
  const candidateTeamIds =
    pgTeamIds !== null ? pgTeamIds : (await loadDirectory()).allTeamIds;
  const linkedTeamIds: string[] = [];

  for (const teamId of candidateTeamIds) {
    const linkedResult = await withTeamRowLock(teamId, async () => {
      const doc = await loadTeamDocRaw(teamId);
      if (!doc) return null;

      const nowIso = new Date().toISOString();
      let modified = false;
      let linkedDisplayName: string | undefined;
      let hasMatchedInvite = false;

      for (const m of doc.memberships) {
        if (m.status === 'REVOKED') continue;
        if (!m.invitedEmail || m.invitedEmail.trim().toLowerCase() !== cleanEmail) continue;

        const isPendingInvite = m.status === 'INVITED' || m.status === 'OPENED';
        if (!isPendingInvite) continue;
        if (m.userSid && m.userSid !== params.userSid) continue;

        hasMatchedInvite = true;
        linkedDisplayName = m.invitedName;

        if (m.userSid !== params.userSid) {
          m.userSid = params.userSid;
          modified = true;
        }
        m.status = 'ACTIVE';
        if (!m.openedAt) m.openedAt = nowIso;
        if (!m.joinedAt) m.joinedAt = nowIso;
        modified = true;

        if (params.stravaAthleteId && !m.stravaAthleteId) {
          m.stravaAthleteId = params.stravaAthleteId;
        }
        if (
          params.athleteName &&
          (!m.invitedName || m.invitedName === 'Team Athlete' || m.invitedName.trim().length === 0)
        ) {
          m.invitedName = params.athleteName.trim().slice(0, 64);
          linkedDisplayName = m.invitedName;
        }
        const requiresParentConsent = Boolean(
          m.isMinorU18 && m.parentConsentStatus !== 'ACKNOWLEDGED'
        );
        if (requiresParentConsent) {
          m.parentConsentStatus = m.parentConsentStatus || 'PENDING';
          m.sharingTier = 'LOAD_ONLY';
        } else if (!m.sharingTier) {
          m.sharingTier = 'SUMMARY_ONLY';
        }
        if (!m.liveSnapshot) {
          const safeSportShieldEnforced = Boolean(
            doc.brand.defaultSafeSportShield || m.isMinorU18
          );
          const calibrated = calibrateThresholdsFromSeedMark(
            m.seedMarkOrFtp || '',
            doc.brand.primarySport,
            'mi'
          );
          m.liveSnapshot = {
            updatedAt: nowIso,
            hasConnectedWatch: Boolean(m.stravaAthleteId),
            verdictLabel: 'Auto-Matched · Email Verified',
            readinessScore: 0,
            ctl: 0,
            atl: 0,
            tsb: 0,
            acuteLoad7d: 0,
            lowAerobicPct: 0,
            highAerobicPct: 0,
            neuromuscularPct: 0,
            caraHours7d: 0,
            ftpWatts: calibrated.cyclingFtpWatts,
            thresholdPaceSecsPerKm: calibrated.thresholdPaceSecsPerKm,
            safeSportHideWeight: safeSportShieldEnforced,
            sharingTier: m.sharingTier,
          };
        }
      }

      if (modified) {
        doc.updatedAt = nowIso;
        await saveTeamDocRaw(teamId, doc);
      }

      return hasMatchedInvite ? { displayName: linkedDisplayName } : null;
    });

    if (linkedResult) {
      await addTeamToUserIndex(
        params.userSid,
        teamId,
        linkedResult.displayName,
        cleanEmail
      );
      if (!linkedTeamIds.includes(teamId)) {
        linkedTeamIds.push(teamId);
      }
    }
  }

  return linkedTeamIds;
}
