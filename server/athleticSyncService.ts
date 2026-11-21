import crypto from 'crypto';
import { isSafeHttpsUrl } from './securityUtils.ts';
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
import { getLocalDateIso } from '../src/physiology/stravaLoadCalibration.ts';
import { archiveCoachActivitiesForMember } from './athleteArchiveHelper.ts';
import { assertSafeExternalFetch } from './securityUtils.ts';
import { withTeamRowLock } from './tokenVault.ts';
import {
  addTeamToUserIndex,
  findTeamDocumentByCodeOrSlug,
  loadTeamDocRaw,
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
            'User-Agent': 'THRESH-CalendarSync/2.1 (+https://thresh-dev.vercel.app)',
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

  for (const row of (params.results || []).slice(0, 200)) {
    const { mem, created } = findOrCreateExternalMembership(doc, {
      name: row.athleteName,
      squadGroup: row.squadGroup,
      graduationYear: row.graduationYear,
      genderDivision: row.genderDivision,
      seedMarkOrFtp: row.displayFatTime,
      externalSource: row.externalSource,
      externalAthleteId: row.externalAthleteId,
      externalProfileUrl: row.externalProfileUrl,
      isMinorU18: doc.brand.orgType === 'HIGH_SCHOOL',
    });
    if (created) addedAthletes += 1;

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
      stats: { athleteCount: 0, meetCount: 0, officialResultCount: 0 },
    };
  }

  const todayIso = getLocalDateIso();
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

      const abbreviateUnconsentedMinor = Boolean(
        !m.externalSource && m.isMinorU18 && m.parentConsentStatus === 'PENDING'
      );
      let displayName = m.invitedName;
      if (abbreviateUnconsentedMinor) {
        const parts = m.invitedName.trim().split(/\s+/).filter(Boolean);
        displayName =
          parts.length >= 2 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] || 'Athlete';
      }

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
      };
    });

  return {
    found: true,
    brand: {
      teamId: doc.brand.teamId,
      slug: doc.brand.slug,
      joinCode: doc.brand.joinCode,
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
      ...(doc.brand.externalSync ? { externalSync: doc.brand.externalSync } : {}),
    },
    upcomingMeets,
    recentSchedule,
    rosterLeaderboard,
    stats: {
      athleteCount: rosterLeaderboard.length,
      meetCount: meetItems.length,
      officialResultCount,
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
