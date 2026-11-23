import crypto from 'crypto';
import {
  assertSafeExternalFetch,
  escapeHtml,
  isSafeHttpsUrl,
  timingSafeStringEqual,
} from './securityUtils.ts';
import type {
  CoachEventGroup,
  ExternalTeamPlatform,
  PublicTeamHubAthleteResultItem,
  PublicTeamHubMeetItem,
  PublicTeamHubPayload,
  PublicTeamHubRosterEntry,
  TeamBroadcastWorkout,
  TeamExternalSyncConfig,
  TeamSummaryWithRole,
  UnifiedActivity,
} from '../src/types.ts';
import {
  normalizeAthleteMatchKey,
  normalizeWebcalUrl,
  parseExternalTeamUrl,
  parseIcsCalendarToMeets,
  type ParsedExternalMeetEvent,
  type ParsedExternalMeetResultRow,
  type ParsedExternalRosterAthlete,
} from '../src/utils/athleticNetAndTfrrsEngine.ts';
import {
  computeOfficialRaceTrainingLoad,
  formatFatTime,
  synthesizeOfficialRaceActivity,
} from '../src/utils/officialRaceSynthesizer.ts';
import {
  calibrateThresholdsFromSeedMark,
  getOrgTypeSafeguardingDefaults,
  inferEventGroupFromSeedMark,
} from '../src/physiology/teamOnboardingEngine.ts';
import {
  buildPublicFieldLeaderboardFromLogs,
  formatPublicSafeSportDisplayName,
} from '../src/physiology/fieldEventsEngine.ts';
import { getLocalDateIso } from '../src/physiology/stravaLoadCalibration.ts';
import { formatPracticeTime12h } from '../src/utils/workoutScheduleUtils.ts';
import { archiveCoachActivitiesForMember } from './athleteArchiveHelper.ts';
import {
  applyParsedExternalFieldMarksToDoc,
  type MatchedExternalFieldMarkInput,
} from './athleticFieldSyncHelper.ts';
import {
  loadFullTeamFieldMarksArchive,
  teamFieldLogsVaultKey,
} from './teamFieldAndDailyOpsService.ts';
import { isResendConfigured, sendEmailViaResend } from './teamEmailAndOtpService.ts';
import {
  loadTenantVaultAsync,
  sanitizeTenantId,
  saveTenantVaultAsync,
  withTeamRowLock,
  withVaultLock,
} from './tokenVault.ts';
import {
  addTeamToUserIndex,
  findTeamDocumentByCodeOrSlug,
  hashToken,
  loadTeamDocRaw,
  projectSafePublicExternalSync,
  projectTeamSummaryForCaller,
  saveTeamDocRaw,
  sanitizeExternalSyncConfig,
  type StoredMembershipInternal,
  type StoredTeamDocument,
} from './teamService.ts';

function assertCoachMembership(
  doc: StoredTeamDocument,
  callerSid: string
): StoredMembershipInternal | null {
  const mem = doc.memberships.find(
    (m) => m.userSid === callerSid && m.status !== 'REVOKED'
  );
  if (!mem || (mem.role !== 'HEAD_COACH' && mem.role !== 'ASSISTANT_COACH')) {
    return null;
  }
  return mem;
}

function upsertMeetEventsOnDoc(
  doc: StoredTeamDocument,
  meets: ParsedExternalMeetEvent[],
  sourceLabel: ExternalTeamPlatform
): number {
  const existingKeySet = new Set(
    (doc.broadcastWorkouts || []).map(
      (bw) => `${bw.date}|${normalizeAthleteMatchKey(bw.name)}`
    )
  );
  let added = 0;
  const nowIso = new Date().toISOString();
  const additions: TeamBroadcastWorkout[] = [];

  for (const meet of meets.slice(0, 60)) {
    const cleanName = String(meet.name || '').trim().slice(0, 100);
    const cleanDate = String(meet.date || '').slice(0, 10);
    if (!cleanName || !/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) continue;
    const dedupeKey = `${cleanDate}|${normalizeAthleteMatchKey(cleanName)}`;
    if (existingKeySet.has(dedupeKey)) continue;
    existingKeySet.add(dedupeKey);

    const estDist = meet.distanceMeters || 5000;
    const estLoad = computeOfficialRaceTrainingLoad(estDist, estDist >= 4000 ? 1100 : 300, true);
    additions.push({
      broadcastId: `meet_${crypto.randomBytes(6).toString('hex')}`,
      teamId: doc.brand.teamId,
      targetSquadGroup: 'ALL',
      date: cleanDate,
      name: cleanName,
      sportCategory: 'Running',
      plannedDurationSecs: 5400,
      plannedLoad: estLoad,
      workoutSyntax: estDist >= 4000 ? `Warmup 20m Z1\nMain: ${cleanName}\nCooldown 15m Z1` : `Warmup 25m\nRace: ${cleanName}\nCooldown 15m`,
      description:
        meet.description ||
        `Synced ${sourceLabel === 'TFRRS' ? 'TFRRS' : 'Athletic.net'} meet schedule event.`,
      ...(meet.scheduledTime ? { scheduledTime: meet.scheduledTime } : {}),
      locationName: meet.locationName,
      locationCategory: meet.locationCategory || 'XC_COURSE',
      planBlockId: `ext-sched-${sourceLabel.toLowerCase()}`,
      planBlockName:
        sourceLabel === 'TFRRS' ? 'TFRRS Meet Schedule' : 'Athletic.net Meet Schedule',
      isOfficialMeet: true,
      externalSource: meet.externalSource || sourceLabel,
      pushedByCoachName: doc.brand.coachDisplayName,
      createdAt: nowIso,
    });
    added += 1;
  }

  if (additions.length > 0) {
    doc.broadcastWorkouts = [...additions, ...(doc.broadcastWorkouts || [])].slice(0, 400);
  }
  return added;
}

export async function updateTeamExternalSyncConfig(params: {
  callerSid: string;
  teamId: string;
  originUrl: string;
  config: Partial<TeamExternalSyncConfig>;
  teamUrl?: string;
}): Promise<TeamSummaryWithRole | null> {
  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc || !assertCoachMembership(doc, params.callerSid)) return null;

  let mergedConfig: Partial<TeamExternalSyncConfig> = { ...(params.config || {}) };
  if (params.teamUrl) {
    const parsed = parseExternalTeamUrl(params.teamUrl);
    if (parsed) {
      mergedConfig = {
        ...mergedConfig,
        platform: parsed.platform,
        ...(parsed.platform === 'ATHLETIC_NET'
          ? {
              athleticNetSchoolId: parsed.athleticNetSchoolId,
              athleticNetSportSlug: parsed.athleticNetSportSlug,
              athleticNetUrl: parsed.canonicalUrl,
            }
          : {
              tfrrsTeamUrl: parsed.canonicalUrl,
              tfrrsTeamCode: parsed.tfrrsTeamCode,
            }),
        ...(parsed.inferredTeamName && !mergedConfig.teamFilterKeyword
          ? { teamFilterKeyword: parsed.inferredTeamName.replace(/\s+high\s+school$/i, '') }
          : {}),
      };
    }
  }

  doc.brand.externalSync = sanitizeExternalSyncConfig(
    mergedConfig,
    doc.brand.externalSync
  );
  doc.updatedAt = new Date().toISOString();
  await saveTeamDocRaw(params.teamId, doc);
  return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
}

export async function syncTeamIcsCalendar(params: {
  callerSid: string;
  teamId: string;
  originUrl: string;
  icsUrl?: string;
  icsText?: string;
}): Promise<{
  ok: boolean;
  summary: TeamSummaryWithRole | null;
  addedMeetsCount: number;
  parsedMeetsCount: number;
  cloudflareBlocked?: boolean;
  note?: string;
}> {
  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc || !assertCoachMembership(doc, params.callerSid)) {
    return {
      ok: false,
      summary: null,
      addedMeetsCount: 0,
      parsedMeetsCount: 0,
      note: 'Coach permissions required to sync team schedule.',
    };
  }

  let resolvedIcsText = String(params.icsText || '').trim();
  const normalizedUrl = params.icsUrl ? normalizeWebcalUrl(params.icsUrl) : '';

  if (!resolvedIcsText && normalizedUrl) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6500);
      const resp = await assertSafeExternalFetch(
        normalizedUrl,
        {
          headers: {
            'User-Agent': 'MeetReady-CalendarSync/2.1 (+https://meetready.app)',
            Accept: 'text/calendar, text/plain, */*;q=0.8',
          },
          signal: controller.signal,
        },
        2
      );
      clearTimeout(timer);

      if (!resp) {
        return {
          ok: false,
          summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
          addedMeetsCount: 0,
          parsedMeetsCount: 0,
          note: 'Blocked unsafe or private network calendar URL.',
        };
      }

      const body = await resp.text();
      if (!resp.ok || /just a moment|cf-mitigated|enable javascript and cookies/i.test(body)) {
        return {
          ok: false,
          summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
          addedMeetsCount: 0,
          parsedMeetsCount: 0,
          cloudflareBlocked: true,
          note:
            'Athletic.net / remote firewall blocked direct server fetch (HTTP ' +
            resp.status +
            '). Click "Download calendar" (.ics) in your browser and upload or paste it below.',
        };
      }
      resolvedIcsText = body;
    } catch {
      return {
        ok: false,
        summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
        addedMeetsCount: 0,
        parsedMeetsCount: 0,
        cloudflareBlocked: true,
        note: 'Unable to fetch remote .ics URL from server; download the .ics file in your browser and drop or paste it below.',
      };
    }
  }

  if (!resolvedIcsText || !resolvedIcsText.includes('VEVENT')) {
    return {
      ok: false,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
      addedMeetsCount: 0,
      parsedMeetsCount: 0,
      note: 'No VEVENT calendar entries found in the provided .ics feed.',
    };
  }

  const extSource: ExternalTeamPlatform =
    doc.brand.externalSync?.platform === 'TFRRS' ? 'TFRRS' : 'ATHLETIC_NET';
  const meets = parseIcsCalendarToMeets(resolvedIcsText, extSource);
  const addedCount = upsertMeetEventsOnDoc(doc, meets, extSource);
  const nowIso = new Date().toISOString();

  doc.brand.externalSync = sanitizeExternalSyncConfig(
    {
      ...(normalizedUrl ? { icsCalendarUrl: normalizedUrl } : {}),
      lastSyncedAt: nowIso,
    },
    doc.brand.externalSync
  );
  doc.updatedAt = nowIso;
  await saveTeamDocRaw(params.teamId, doc);

  return {
    ok: true,
    summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    addedMeetsCount: addedCount,
    parsedMeetsCount: meets.length,
    note:
      addedCount > 0
        ? `Added ${addedCount} meets from .ics calendar.`
        : `Checked ${meets.length} meets (all already up to date).`,
  };
}

function findOrCreateExternalMembership(
  doc: StoredTeamDocument,
  candidate: {
    name: string;
    squadGroup?: string;
    eventGroup?: CoachEventGroup;
    graduationYear?: number;
    genderDivision?: 'M' | 'F' | 'NONBINARY';
    seedMarkOrFtp?: string;
    externalSource: ExternalTeamPlatform;
    externalAthleteId?: string;
    externalProfileUrl?: string;
    isMinorU18?: boolean;
  }
): { mem: StoredMembershipInternal; created: boolean } {
  const normKey = normalizeAthleteMatchKey(candidate.name);
  const existing = doc.memberships.find((m) => {
    if (m.status === 'REVOKED' || m.role === 'PARENT_FOLLOWER') return false;
    if (
      candidate.externalAthleteId &&
      m.externalAthleteId &&
      m.externalAthleteId === candidate.externalAthleteId
    ) {
      return true;
    }
    return Boolean(normKey) && normalizeAthleteMatchKey(m.invitedName) === normKey;
  });

  const safeSportOn = Boolean(
    doc.brand.defaultSafeSportShield ||
      candidate.isMinorU18 ||
      doc.brand.orgType === 'HIGH_SCHOOL'
  );
  const calibrated = candidate.seedMarkOrFtp
    ? calibrateThresholdsFromSeedMark(
        candidate.seedMarkOrFtp,
        doc.brand.primarySport,
        'mi'
      )
    : undefined;
  const nowIso = new Date().toISOString();

  const cleanCandidateUrl =
    candidate.externalProfileUrl && isSafeHttpsUrl(candidate.externalProfileUrl.trim())
      ? candidate.externalProfileUrl.trim()
      : undefined;

  if (existing) {
    existing.externalSource = existing.externalSource || candidate.externalSource;
    if (candidate.externalAthleteId) existing.externalAthleteId = candidate.externalAthleteId;
    if (cleanCandidateUrl) existing.externalProfileUrl = cleanCandidateUrl;
    if (candidate.graduationYear) existing.graduationYear = candidate.graduationYear;
    if (candidate.genderDivision) existing.genderDivision = candidate.genderDivision;
    if (candidate.seedMarkOrFtp && !existing.seedMarkOrFtp) {
      existing.seedMarkOrFtp = candidate.seedMarkOrFtp;
    }
    if (!existing.eventGroup && (candidate.eventGroup || candidate.seedMarkOrFtp)) {
      const inferred = candidate.eventGroup || inferEventGroupFromSeedMark(candidate.seedMarkOrFtp);
      if (inferred) existing.eventGroup = inferred;
    }
    if (calibrated && (!existing.liveSnapshot || !existing.liveSnapshot.thresholdPaceSecsPerKm)) {
      existing.liveSnapshot = {
        updatedAt: nowIso,
        hasConnectedWatch: Boolean(existing.liveSnapshot?.hasConnectedWatch),
        verdictLabel: existing.liveSnapshot?.verdictLabel || 'Synced Roster',
        readinessScore: existing.liveSnapshot?.readinessScore || 0,
        ctl: existing.liveSnapshot?.ctl || 0,
        atl: existing.liveSnapshot?.atl || 0,
        tsb: existing.liveSnapshot?.tsb || 0,
        acuteLoad7d: existing.liveSnapshot?.acuteLoad7d || 0,
        lowAerobicPct: existing.liveSnapshot?.lowAerobicPct || 0,
        highAerobicPct: existing.liveSnapshot?.highAerobicPct || 0,
        neuromuscularPct: existing.liveSnapshot?.neuromuscularPct || 0,
        caraHours7d: existing.liveSnapshot?.caraHours7d || 0,
        ...(existing.liveSnapshot || {}),
        thresholdPaceSecsPerKm: calibrated.thresholdPaceSecsPerKm,
        safeSportHideWeight: safeSportOn,
      };
    }
    return { mem: existing, created: false };
  }

  const isMinorImport = Boolean(
    candidate.isMinorU18 || doc.brand.orgType === 'HIGH_SCHOOL'
  );
  const orgDefaults = getOrgTypeSafeguardingDefaults(doc.brand.orgType);
  const rawToken = crypto.randomBytes(12).toString('base64url');
  const resolvedCreatedGroup =
    candidate.eventGroup || inferEventGroupFromSeedMark(candidate.seedMarkOrFtp);
  const createdMem: StoredMembershipInternal = {
    membershipId: `mem_${crypto.randomBytes(6).toString('hex')}`,
    teamId: doc.brand.teamId,
    role: 'ATHLETE',
    squadGroup: candidate.squadGroup || orgDefaults.defaultSquads[0] || 'Varsity',
    ...(resolvedCreatedGroup ? { eventGroup: resolvedCreatedGroup } : {}),
    invitedName: String(candidate.name || 'Team Athlete').trim().slice(0, 64),
    graduationYear: candidate.graduationYear,
    isMinorU18: isMinorImport,
    parentConsentStatus: isMinorImport ? 'PENDING' : 'NOT_REQUIRED',
    seedMarkOrFtp: candidate.seedMarkOrFtp,
    externalSource: candidate.externalSource,
    externalAthleteId: candidate.externalAthleteId,
    externalProfileUrl: cleanCandidateUrl,
    genderDivision: candidate.genderDivision,
    status: 'INVITED',
    emailDeliveryStatus: 'READY_MANUAL_LINK',
    rawInviteToken: rawToken,
    inviteTokenHash: crypto.createHash('sha256').update(rawToken).digest('hex'),
    invitedAt: nowIso,
    liveSnapshot: {
      updatedAt: nowIso,
      hasConnectedWatch: false,
      verdictLabel: `${candidate.externalSource === 'TFRRS' ? 'TFRRS' : 'Athletic.net'} Synced`,
      readinessScore: 0,
      ctl: 0,
      atl: 0,
      tsb: 0,
      acuteLoad7d: 0,
      lowAerobicPct: 0,
      highAerobicPct: 0,
      neuromuscularPct: 0,
      caraHours7d: 0,
      thresholdPaceSecsPerKm: calibrated?.thresholdPaceSecsPerKm || 245,
      safeSportHideWeight: safeSportOn,
    },
  };

  doc.memberships.push(createdMem);
  return { mem: createdMem, created: true };
}

export async function applyExternalTeamSyncBatch(params: {
  callerSid: string;
  teamId: string;
  originUrl: string;
  externalSyncPatch?: Partial<TeamExternalSyncConfig>;
  athletes?: ParsedExternalRosterAthlete[];
  meets?: ParsedExternalMeetEvent[];
  results?: ParsedExternalMeetResultRow[];
}): Promise<{
  summary: TeamSummaryWithRole | null;
  addedAthletes: number;
  updatedAthletes: number;
  addedMeets: number;
  recordedResults: number;
}> {
  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc || !assertCoachMembership(doc, params.callerSid)) {
    return {
      summary: null,
      addedAthletes: 0,
      updatedAthletes: 0,
      addedMeets: 0,
      recordedResults: 0,
    };
  }

  let addedAthletes = 0;
  let updatedAthletes = 0;
  let addedMeets = 0;
  let recordedResults = 0;
  const nowIso = new Date().toISOString();

  for (const ath of (params.athletes || []).slice(0, 400)) {
    const res = findOrCreateExternalMembership(doc, ath);
    if (res.created) addedAthletes += 1;
    else updatedAthletes += 1;
  }

  if (Array.isArray(params.meets) && params.meets.length > 0) {
    const extSource: ExternalTeamPlatform =
      params.externalSyncPatch?.platform === 'TFRRS' || doc.brand.externalSync?.platform === 'TFRRS'
        ? 'TFRRS'
        : 'ATHLETIC_NET';
    addedMeets = upsertMeetEventsOnDoc(doc, params.meets, extSource);
  }

  const matchedFieldItems: MatchedExternalFieldMarkInput[] = [];
  for (const row of (params.results || []).slice(0, 200)) {
    const { mem, created } = findOrCreateExternalMembership(doc, {
      name: row.athleteName,
      squadGroup: row.squadGroup,
      graduationYear: row.graduationYear,
      genderDivision: row.genderDivision,
      seedMarkOrFtp: row.isFieldEvent
        ? row.displayFieldMark || row.displayFatTime
        : row.displayFatTime,
      externalSource: row.externalSource,
      externalAthleteId: row.externalAthleteId,
      externalProfileUrl: row.externalProfileUrl,
      isMinorU18: doc.brand.orgType === 'HIGH_SCHOOL',
    });
    if (created) addedAthletes += 1;

    if (row.isFieldEvent) {
      matchedFieldItems.push({ row, mem });
      continue;
    }

    const existingActs = Array.isArray(mem.coachRecordedActivities)
      ? mem.coachRecordedActivities
      : [];
    const duplicate = existingActs.some(
      (a) =>
        a.startDateLocal?.slice(0, 10) === row.date &&
        a.officialRaceData?.eventDistanceMeters === row.eventDistanceMeters &&
        Math.abs((a.officialRaceData?.fatTimeSecs || 0) - row.fatTimeSecs) < 0.05
    );
    if (duplicate) continue;

    const activity: UnifiedActivity = synthesizeOfficialRaceActivity({
      id: `ext-meet-${crypto.randomBytes(5).toString('hex')}`,
      date: row.date,
      meetName: row.meetName,
      eventLabel: row.eventLabel,
      eventDistanceMeters: row.eventDistanceMeters,
      fatTimeSecs: row.fatTimeSecs,
      displayFatTime: row.displayFatTime || formatFatTime(row.fatTimeSecs),
      platform: row.platform,
      trackType: row.trackType,
      placeFinish: row.placeFinish,
      lapSplitDistanceMeters:
        row.eventDistanceMeters <= 400
          ? 200
          : row.eventDistanceMeters >= 3000
            ? 1000
            : 400,
      lapSplitsSecs: [],
      includeWarmupCooldown: false,
      sourceUrl: row.externalProfileUrl || row.sourceUrl,
      startDateLocalIso: `${row.date}T09:00:00`,
    });

    mem.coachRecordedActivities = [activity, ...existingActs].slice(0, 80);
    if (!mem.seedMarkOrFtp) {
      mem.seedMarkOrFtp = activity.officialRaceData?.displayFatTime || row.displayFatTime;
    }
    if (mem.userSid || mem.stravaAthleteId || mem.invitedEmail) {
      await archiveCoachActivitiesForMember(mem, [activity]).catch(() => undefined);
    }
    recordedResults += 1;
  }

  if (matchedFieldItems.length > 0) {
    const existingFieldLogs = await loadFullTeamFieldMarksArchive(
      params.teamId,
      doc.fieldMarkLogs
    );
    const fieldRes = applyParsedExternalFieldMarksToDoc({
      doc,
      existingLogs: existingFieldLogs,
      matchedFieldItems,
    });
    await saveTenantVaultAsync(teamFieldLogsVaultKey(params.teamId), fieldRes.mergedLogs);
    doc.fieldMarkLogs = fieldRes.mergedLogs.slice(0, 150);
    doc.fieldMarkLogsTotalCount = fieldRes.mergedLogs.length;
    recordedResults += fieldRes.addedCount;
  }

  doc.brand.externalSync = sanitizeExternalSyncConfig(
    {
      ...(params.externalSyncPatch || {}),
      lastSyncedAt: nowIso,
    },
    doc.brand.externalSync
  );
  doc.updatedAt = nowIso;
  await saveTeamDocRaw(params.teamId, doc);

  return {
    summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    addedAthletes,
    updatedAthletes,
    addedMeets,
    recordedResults,
  };
}

/**
 * Projects a zero-PII Clean-Room Public Parent & Fan Read-Only Team Hub for /team/:slug.
 * Never returns athlete emails, phones, guardian emails, GPS routes, HRV, sleep, RPE, pain flags, or weight.
 */
export async function getPublicTeamHubBySlugOrCode(
  slugOrCode: string
): Promise<PublicTeamHubPayload> {
  const doc = await findTeamDocumentByCodeOrSlug(slugOrCode);
  if (!doc || !doc.brand.externalSync?.enablePublicParentHub) {
    return {
      found: false,
      error: 'Team Hub not found or public parent access is turned off.',
      upcomingMeets: [],
      recentSchedule: [],
      rosterLeaderboard: [],
      fieldLeaderboard: [],
      stats: { athleteCount: 0, meetCount: 0, officialResultCount: 0, fieldPrCount: 0 },
    };
  }

  const todayIso = getLocalDateIso();
  const fullFieldLogs = await loadFullTeamFieldMarksArchive(
    doc.brand.teamId,
    doc.fieldMarkLogs
  );
  const { fieldPrsByMembershipId, fieldLeaderboard } =
    buildPublicFieldLeaderboardFromLogs({
      orgType: doc.brand.orgType,
      memberships: doc.memberships,
      fieldLogs: fullFieldLogs,
    });

  const meetItems: PublicTeamHubMeetItem[] = (doc.broadcastWorkouts || [])
    .filter((bw) => bw.isOfficialMeet || /meet|invitational|finals|dual|champ|xc/i.test(bw.name))
    .filter((bw) => !bw.targetMembershipIds || bw.targetMembershipIds.length === 0)
    .map((bw) => ({
      id: bw.broadcastId,
      date: bw.date,
      name: bw.name,
      ...(bw.scheduledTime ? { scheduledTime: bw.scheduledTime } : {}),
      ...(bw.locationName ? { locationName: bw.locationName } : {}),
      ...(bw.locationCategory ? { locationCategory: bw.locationCategory } : {}),
      ...(bw.description ? { description: bw.description } : {}),
      ...(bw.externalSource ? { externalSource: bw.externalSource } : {}),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const upcomingMeets = meetItems.filter((m) => m.date >= todayIso);
  const recentSchedule = meetItems.filter((m) => m.date < todayIso).reverse();

  let officialResultCount = 0;
  const rosterLeaderboard: PublicTeamHubRosterEntry[] = doc.memberships
    .filter((m) => m.status !== 'REVOKED' && m.role === 'ATHLETE')
    .map((m) => {
      const officialResults: PublicTeamHubAthleteResultItem[] = (
        m.coachRecordedActivities || []
      )
        .filter((a) => Boolean(a.officialRaceData))
        .map((a) => {
          const r = a.officialRaceData!;
          return {
            date: a.startDateLocal.slice(0, 10),
            meetName: r.meetName,
            eventLabel: r.eventLabel,
            eventDistanceMeters: r.eventDistanceMeters,
            displayFatTime: r.displayFatTime,
            fatTimeSecs: r.fatTimeSecs,
            ...(r.placeFinish ? { placeFinish: r.placeFinish } : {}),
            vdotScore: r.vdotScore,
            platform: r.platform,
            trackType: r.trackType,
            ...(r.sourceUrl ? { sourceUrl: r.sourceUrl } : {}),
          };
        })
        .sort((a, b) => b.date.localeCompare(a.date));

      officialResultCount += officialResults.length;

      const displayName = formatPublicSafeSportDisplayName({
        invitedName: m.invitedName,
        externalSource: m.externalSource,
        isMinorU18: m.isMinorU18,
        parentConsentStatus: m.parentConsentStatus,
        orgType: doc.brand.orgType,
      });
      const memberFieldPrs = fieldPrsByMembershipId.get(m.membershipId);

      return {
        membershipId: m.membershipId,
        name: displayName,
        squadGroup: m.squadGroup,
        ...(m.eventGroup ? { eventGroup: m.eventGroup } : {}),
        ...(m.graduationYear ? { graduationYear: m.graduationYear } : {}),
        ...(m.genderDivision ? { genderDivision: m.genderDivision } : {}),
        ...(m.seedMarkOrFtp ? { seedMarkOrFtp: m.seedMarkOrFtp } : {}),
        ...(m.externalSource ? { externalSource: m.externalSource } : {}),
        ...(m.externalAthleteId ? { externalAthleteId: m.externalAthleteId } : {}),
        ...(m.externalProfileUrl && isSafeHttpsUrl(m.externalProfileUrl.trim())
          ? { externalProfileUrl: m.externalProfileUrl.trim() }
          : {}),
        officialResults,
        ...(memberFieldPrs && memberFieldPrs.length > 0 ? { fieldPrs: memberFieldPrs } : {}),
      };
    });

  const safePublicExternalSync = projectSafePublicExternalSync(doc.brand.externalSync);

  return {
    found: true,
    brand: {
      teamId: doc.brand.teamId,
      slug: doc.brand.slug,
      name: doc.brand.name,
      shortName: doc.brand.shortName,
      ...(doc.brand.mascotOrMotto ? { mascotOrMotto: doc.brand.mascotOrMotto } : {}),
      orgType: doc.brand.orgType,
      primarySport: doc.brand.primarySport,
      ...(doc.brand.logoDataUrl ? { logoDataUrl: doc.brand.logoDataUrl } : {}),
      primaryHex: doc.brand.primaryHex,
      secondaryHex: doc.brand.secondaryHex,
      defaultSafeSportShield: doc.brand.defaultSafeSportShield,
      coachDisplayName: doc.brand.coachDisplayName,
      ...(safePublicExternalSync ? { externalSync: safePublicExternalSync } : {}),
    },
    upcomingMeets,
    recentSchedule,
    rosterLeaderboard,
    fieldLeaderboard,
    announcements: (doc.announcements || [])
      .filter((a) => a.publishToParentHub)
      .slice(0, 6)
      .map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        category: a.category,
        createdAt: a.createdAt,
      })),
    stats: {
      athleteCount: rosterLeaderboard.length,
      meetCount: meetItems.length,
      officialResultCount,
      fieldPrCount: fieldLeaderboard.length,
    },
  };
}

export async function followTeamAsParentOrFan(params: {
  callerSid: string;
  codeOrSlug: string;
  followerName?: string;
  verifiedEmail?: string;
  originUrl: string;
}): Promise<{ ok: boolean; summary?: TeamSummaryWithRole; error?: string }> {
  const initialDoc = await findTeamDocumentByCodeOrSlug(params.codeOrSlug);
  if (!initialDoc) {
    return { ok: false, error: 'Team not found for this code or URL.' };
  }
  return withTeamRowLock(initialDoc.brand.teamId, async () => {
    const doc = (await loadTeamDocRaw(initialDoc.brand.teamId)) || initialDoc;
    if (!doc.brand.externalSync?.enablePublicParentHub) {
      return { ok: false, error: 'Public parent/supporter following is disabled for this team.' };
    }

    const cleanVerifiedEmail = params.verifiedEmail?.trim().toLowerCase();
    let mem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!mem) {
      const nowIso = new Date().toISOString();
      mem = {
        membershipId: `mem_${crypto.randomBytes(6).toString('hex')}`,
        teamId: doc.brand.teamId,
        userSid: params.callerSid,
        role: 'PARENT_FOLLOWER',
        squadGroup: 'Parents & Supporters',
        invitedName:
          String(params.followerName || '').trim().slice(0, 48) || 'Parent / Supporter',
        ...(cleanVerifiedEmail ? { invitedEmail: cleanVerifiedEmail } : {}),
        isMinorU18: false,
        parentConsentStatus: 'NOT_REQUIRED',
        status: 'ACTIVE',
        invitedAt: nowIso,
        openedAt: nowIso,
        joinedAt: nowIso,
      };
      doc.memberships.push(mem);
      doc.updatedAt = nowIso;
      await saveTeamDocRaw(doc.brand.teamId, doc);
    } else if (cleanVerifiedEmail && mem.invitedEmail !== cleanVerifiedEmail) {
      mem.invitedEmail = cleanVerifiedEmail;
      doc.updatedAt = new Date().toISOString();
      await saveTeamDocRaw(doc.brand.teamId, doc);
    }

    await addTeamToUserIndex(params.callerSid, doc.brand.teamId, mem.invitedName, cleanVerifiedEmail);
    return {
      ok: true,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl)!,
    };
  });
}

// ============================================================================
// Parent Hub Live RFC 5545 .ics Feed & Zero-PII Email Subscriptions
// ============================================================================

function escapeIcsText(raw?: string): string {
  return String(raw || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .trim();
}

function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [line.slice(0, 75)];
  let idx = 75;
  while (idx < line.length) {
    chunks.push(` ${line.slice(idx, idx + 74)}`);
    idx += 74;
  }
  return chunks.join('\r\n');
}

function formatIcsUtcTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function nextIcsDateYmd(isoDate: string): string {
  const parsed = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate.slice(0, 10).replace(/-/g, '');
  }
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Generates a strict zero-PII RFC 5545 iCalendar feed for the Public Parent Hub.
 */
export function buildPublicTeamCalendarIcs(payload: PublicTeamHubPayload): string {
  const teamName = payload.brand?.name || 'MeetReady Team';
  const shortName = payload.brand?.shortName || teamName;
  const dtStamp = formatIcsUtcTimestamp(new Date());
  const seenIds = new Set<string>();
  const combinedMeets = [...(payload.upcomingMeets || []), ...(payload.recentSchedule || [])]
    .filter((m) => {
      if (!m?.id || !/^\d{4}-\d{2}-\d{2}$/.test(m.date || '')) return false;
      if (seenIds.has(m.id)) return false;
      seenIds.add(m.id);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MeetReady//Parent Hub Live Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(`${teamName} Meet Schedule`)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];

  for (const meet of combinedMeets) {
    const startYmd = meet.date.replace(/-/g, '');
    const endYmd = nextIcsDateYmd(meet.date);
    const uidSafe = String(meet.id).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
    const descParts = [
      meet.scheduledTime ? `Scheduled time: ${formatPracticeTime12h(meet.scheduledTime)}` : '',
      meet.description || '',
      payload.brand?.slug ? `Public Team Hub: https://meetready.app/team/${payload.brand.slug}` : '',
    ].filter(Boolean);

    lines.push(
      'BEGIN:VEVENT',
      `UID:meetready-${uidSafe}@meetready.app`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART;VALUE=DATE:${startYmd}`,
      `DTEND;VALUE=DATE:${endYmd}`,
      `SUMMARY:${escapeIcsText(`${shortName} · ${meet.name}`)}`,
      ...(meet.locationName ? [`LOCATION:${escapeIcsText(meet.locationName)}`] : []),
      ...(descParts.length > 0 ? [`DESCRIPTION:${escapeIcsText(descParts.join(' · '))}`] : []),
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

export interface ParentHubEmailSubscriptionRecord {
  id: string;
  teamId: string;
  email: string;
  status: 'PENDING' | 'CONFIRMED' | 'UNSUBSCRIBED';
  confirmTokenHash?: string;
  unsubscribeTokenHashes: string[];
  createdAt: string;
  confirmedAt?: string;
  unsubscribedAt?: string;
}

export function parentEmailSubsVaultKey(teamId: string): string {
  return `team_parent_email_subs_${sanitizeTenantId(teamId).slice(0, 40)}`;
}

const VALID_PARENT_EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export async function subscribeParentEmailToPublicHub(params: {
  slugOrCode: string;
  email: string;
  originUrl: string;
}): Promise<{
  ok: boolean;
  statusCode?: number;
  status?: 'PENDING_CONFIRMATION' | 'PENDING_UNCONFIGURED_EMAIL' | 'ALREADY_CONFIRMED';
  emailConfigured: boolean;
  emailSent: boolean;
  message?: string;
  error?: string;
}> {
  const cleanEmail = String(params.email || '').trim().toLowerCase().slice(0, 160);
  if (!cleanEmail || !VALID_PARENT_EMAIL_RE.test(cleanEmail)) {
    return {
      ok: false,
      statusCode: 400,
      emailConfigured: isResendConfigured(),
      emailSent: false,
      error: 'Please enter a valid email address.',
    };
  }

  const doc = await findTeamDocumentByCodeOrSlug(params.slugOrCode);
  if (!doc || !doc.brand.externalSync?.enablePublicParentHub) {
    return {
      ok: false,
      statusCode: 404,
      emailConfigured: isResendConfigured(),
      emailSent: false,
      error: 'Team Hub not found or public parent updates are disabled.',
    };
  }

  const rawConfirmToken = crypto.randomBytes(24).toString('base64url');
  const rawUnsubToken = crypto.randomBytes(24).toString('base64url');
  const confirmHash = hashToken(rawConfirmToken);
  const unsubHash = hashToken(rawUnsubToken);
  const vaultKey = parentEmailSubsVaultKey(doc.brand.teamId);

  const lockOutcome = await withVaultLock(vaultKey, async () => {
    const existingList = await loadTenantVaultAsync<ParentHubEmailSubscriptionRecord[]>(
      vaultKey,
      []
    );
    const existing = existingList.find((r) => r.email === cleanEmail);
    const nowIso = new Date().toISOString();

    if (existing && existing.status === 'CONFIRMED') {
      return { alreadyConfirmed: true as const };
    }

    const updatedRecord: ParentHubEmailSubscriptionRecord = {
      id: existing?.id || `psub_${crypto.randomBytes(6).toString('hex')}`,
      teamId: doc.brand.teamId,
      email: cleanEmail,
      status: 'PENDING',
      confirmTokenHash: confirmHash,
      unsubscribeTokenHashes: [unsubHash, ...(existing?.unsubscribeTokenHashes || [])].slice(0, 6),
      createdAt: existing?.createdAt || nowIso,
    };

    const nextList = [
      updatedRecord,
      ...existingList.filter((r) => r.email !== cleanEmail),
    ].slice(0, 500);
    await saveTenantVaultAsync(vaultKey, nextList);
    return { alreadyConfirmed: false as const };
  });

  if (lockOutcome.alreadyConfirmed) {
    return {
      ok: true,
      statusCode: 200,
      status: 'ALREADY_CONFIRMED',
      emailConfigured: isResendConfigured(),
      emailSent: false,
      message: `${cleanEmail} is already confirmed for ${doc.brand.shortName} schedule updates.`,
    };
  }

  const resendConfigured = isResendConfigured();
  if (!resendConfigured) {
    return {
      ok: true,
      statusCode: 200,
      status: 'PENDING_UNCONFIGURED_EMAIL',
      emailConfigured: false,
      emailSent: false,
      message:
        'Subscription saved. Email dispatch is not configured on this server yet — use Calendar Subscribe (.ics / Webcal) above for instant schedule updates.',
    };
  }

  const cleanOrigin = params.originUrl.replace(/\/+$/, '');
  const slugEnc = encodeURIComponent(doc.brand.slug);
  const confirmUrl = `${cleanOrigin}/api/teams/public/${slugEnc}/subscribe/confirm?token=${encodeURIComponent(
    rawConfirmToken
  )}`;
  const unsubscribeUrl = `${cleanOrigin}/api/teams/public/${slugEnc}/unsubscribe?token=${encodeURIComponent(
    rawUnsubToken
  )}`;
  const safeTeamName = escapeHtml(doc.brand.name);
  const safeConfirm = escapeHtml(confirmUrl);
  const safeUnsub = escapeHtml(unsubscribeUrl);

  const sendRes = await sendEmailViaResend({
    to: cleanEmail,
    subject: `Confirm Parent Hub Updates for ${doc.brand.name} on MeetReady`,
    html: `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#F6F3EC;padding:24px 12px;color:#121413;"><div style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #CFC9BC;border-radius:16px;padding:24px;"><div style="font-size:11px;font-weight:700;letter-spacing:0.06em;color:#B83A24;text-transform:uppercase;">MeetReady Safe-Sport Parent Hub</div><h1 style="font-size:20px;margin:8px 0 12px;">Confirm Schedule &amp; Weather Updates</h1><p style="font-size:14px;line-height:1.5;color:#2C2A26;">Tap below to receive public meet schedule shifts, weather alerts, and official competition summaries for <strong>${safeTeamName}</strong>. Zero private athlete biometrics or student emails are ever included.</p><div style="margin:22px 0;text-align:center;"><a href="${safeConfirm}" style="display:inline-block;background:#B83A24;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:10px;">Confirm Email Updates</a></div><p style="font-size:12px;color:#57544D;">Didn&apos;t request this? <a href="${safeUnsub}" style="color:#B83A24;">Unsubscribe immediately</a>.</p></div></body></html>`,
    text: [
      `Confirm MeetReady Parent Hub updates for ${doc.brand.name}:`,
      confirmUrl,
      ``,
      `Strict Zero-PII Policy: Public meet schedules, weather notices & official team summaries only.`,
      `Unsubscribe: ${unsubscribeUrl}`,
    ].join('\n'),
  });

  return {
    ok: true,
    statusCode: 200,
    status: 'PENDING_CONFIRMATION',
    emailConfigured: true,
    emailSent: sendRes.delivered,
    message: sendRes.delivered
      ? `Confirmation link sent to ${cleanEmail}. Check your inbox to activate updates.`
      : `Subscription saved, but email delivery failed (${sendRes.error || 'retry shortly'}).`,
  };
}

export async function confirmParentEmailSubscription(params: {
  slugOrCode: string;
  token: string;
}): Promise<{
  ok: boolean;
  statusCode?: number;
  teamName?: string;
  slug?: string;
  alreadyConfirmed?: boolean;
  error?: string;
}> {
  const cleanToken = String(params.token || '').trim();
  if (!cleanToken) {
    return { ok: false, statusCode: 400, error: 'Missing confirmation token.' };
  }

  const doc = await findTeamDocumentByCodeOrSlug(params.slugOrCode);
  if (!doc || !doc.brand.externalSync?.enablePublicParentHub) {
    return {
      ok: false,
      statusCode: 404,
      error: 'Team Hub not found or public parent access is disabled.',
    };
  }

  const targetHash = hashToken(cleanToken);
  const vaultKey = parentEmailSubsVaultKey(doc.brand.teamId);

  return withVaultLock(vaultKey, async () => {
    const records = await loadTenantVaultAsync<ParentHubEmailSubscriptionRecord[]>(
      vaultKey,
      []
    );
    const match = records.find(
      (r) => r.confirmTokenHash && timingSafeStringEqual(r.confirmTokenHash, targetHash)
    );
    if (!match) {
      return {
        ok: false,
        statusCode: 400,
        error: 'Invalid or already-used confirmation token.',
      };
    }

    const alreadyConfirmed = match.status === 'CONFIRMED';
    match.status = 'CONFIRMED';
    match.confirmedAt = match.confirmedAt || new Date().toISOString();
    delete match.confirmTokenHash;

    await saveTenantVaultAsync(vaultKey, records);
    return {
      ok: true,
      statusCode: 200,
      teamName: doc.brand.name,
      slug: doc.brand.slug,
      alreadyConfirmed,
    };
  });
}

export async function unsubscribeParentEmailSubscription(params: {
  slugOrCode: string;
  token: string;
}): Promise<{
  ok: boolean;
  statusCode?: number;
  teamName?: string;
  slug?: string;
  error?: string;
}> {
  const cleanToken = String(params.token || '').trim();
  if (!cleanToken) {
    return { ok: false, statusCode: 400, error: 'Missing unsubscribe token.' };
  }

  const doc = await findTeamDocumentByCodeOrSlug(params.slugOrCode);
  if (!doc) {
    return { ok: false, statusCode: 404, error: 'Team Hub not found.' };
  }

  const targetHash = hashToken(cleanToken);
  const vaultKey = parentEmailSubsVaultKey(doc.brand.teamId);

  return withVaultLock(vaultKey, async () => {
    const records = await loadTenantVaultAsync<ParentHubEmailSubscriptionRecord[]>(
      vaultKey,
      []
    );
    const match = records.find((r) =>
      (r.unsubscribeTokenHashes || []).some((h) => timingSafeStringEqual(h, targetHash))
    );
    if (!match) {
      return {
        ok: false,
        statusCode: 400,
        error: 'Invalid or expired unsubscribe token.',
      };
    }

    match.status = 'UNSUBSCRIBED';
    match.unsubscribedAt = new Date().toISOString();
    delete match.confirmTokenHash;
    await saveTenantVaultAsync(vaultKey, records);

    return {
      ok: true,
      statusCode: 200,
      teamName: doc.brand.name,
      slug: doc.brand.slug,
    };
  });
}

export async function dispatchParentHubAnnouncementEmails(params: {
  teamId: string;
  teamName: string;
  teamSlug: string;
  category: string;
  title: string;
  body: string;
  originUrl: string;
}): Promise<{ sentCount: number }> {
  if (!isResendConfigured()) {
    return { sentCount: 0 };
  }

  const vaultKey = parentEmailSubsVaultKey(params.teamId);
  const dispatchTargets: Array<{ email: string; rawUnsubToken: string }> = [];

  await withVaultLock(vaultKey, async () => {
    const records = await loadTenantVaultAsync<ParentHubEmailSubscriptionRecord[]>(
      vaultKey,
      []
    );
    const confirmed = records.filter((r) => r.status === 'CONFIRMED').slice(0, 50);
    if (confirmed.length === 0) return;

    for (const rec of confirmed) {
      const rawUnsubToken = crypto.randomBytes(24).toString('base64url');
      rec.unsubscribeTokenHashes = [
        hashToken(rawUnsubToken),
        ...(rec.unsubscribeTokenHashes || []),
      ].slice(0, 6);
      dispatchTargets.push({ email: rec.email, rawUnsubToken });
    }
    await saveTenantVaultAsync(vaultKey, records);
  });

  if (dispatchTargets.length === 0) {
    return { sentCount: 0 };
  }

  const cleanOrigin = params.originUrl.replace(/\/+$/, '');
  const slugEnc = encodeURIComponent(params.teamSlug);
  const hubUrl = `${cleanOrigin}/team/${slugEnc}`;
  const safeTeam = escapeHtml(params.teamName);
  const safeCat = escapeHtml(params.category);
  const safeTitle = escapeHtml(params.title);
  const safeBody = escapeHtml(params.body);
  const safeHubUrl = escapeHtml(hubUrl);

  const results = await Promise.allSettled(
    dispatchTargets.map(async (target) => {
      const unsubUrl = `${cleanOrigin}/api/teams/public/${slugEnc}/unsubscribe?token=${encodeURIComponent(
        target.rawUnsubToken
      )}`;
      const safeUnsub = escapeHtml(unsubUrl);
      return sendEmailViaResend({
        to: target.email,
        subject: `[${params.teamName}] ${params.title}`,
        html: `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#F6F3EC;padding:24px 12px;color:#121413;"><div style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #CFC9BC;border-radius:16px;padding:24px;"><div style="font-size:11px;font-weight:700;letter-spacing:0.06em;color:#B83A24;text-transform:uppercase;">${safeTeam} · ${safeCat}</div><h1 style="font-size:19px;margin:8px 0 10px;">${safeTitle}</h1><p style="font-size:14px;line-height:1.55;color:#2C2A26;margin:0 0 18px;">${safeBody}</p><a href="${safeHubUrl}" style="display:inline-block;background:#121413;color:#D8FF2A;text-decoration:none;font-weight:700;font-size:13px;padding:10px 18px;border-radius:10px;">Open Public Team Hub</a><p style="margin-top:20px;font-size:12px;color:#57544D;">Public team notice only · <a href="${safeUnsub}" style="color:#B83A24;">Unsubscribe</a></p></div></body></html>`,
        text: `${params.teamName} [${params.category}]\n${params.title}\n\n${params.body}\n\nPublic Team Hub: ${hubUrl}\nUnsubscribe: ${unsubUrl}`,
      });
    })
  );

  let sentCount = 0;
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.delivered) {
      sentCount += 1;
    }
  }
  return { sentCount };
}

