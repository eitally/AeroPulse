import crypto from 'crypto';
import type {
  DelegatedHandSplitCaptureSummary,
  DelegatedSplitSubmissionEntry,
  DelegatedSplitSubmissionRecord,
  DelegatedSubmissionReviewStatus,
  DelegatedTimingRunner,
  DelegatedTimingSessionRecord,
  DelegatedTimingStation,
  PublicDelegatedTimingPassPayload,
  TeamAthleteLiveSnapshot,
  TeamSummaryWithRole,
  UnifiedActivity,
} from '../src/types.ts';
import {
  OFFICIAL_RACE_EVENTS,
  formatFatTime,
  synthesizeOfficialRaceActivity,
} from '../src/utils/officialRaceSynthesizer.ts';
import { archiveCoachActivitiesForMember } from './athleteArchiveHelper.ts';
import {
  dispatchPushPayloadToUsers,
  isWithinQuietHours,
} from './pushNotificationService.ts';
import {
  sanitizeTelemetryForCleanRoom,
  stripSafeSportWeightAndBodyCompFields,
} from './cleanRoomFirewall.ts';
import {
  canProgramWorkoutsRole,
  hashToken,
  loadDirectory,
  loadTeamDocRaw,
  projectTeamSummaryForCaller,
  saveTeamDocRaw,
  type StoredDelegatedTimingSessionInternal,
  type StoredMembershipInternal,
} from './teamStoreCore.ts';
import {
  appendAuditLogAsync,
  loadTenantVaultAsync,
  saveTenantVaultAsync,
  withTeamRowLock,
  withVaultLock,
} from './tokenVault.ts';

const TIMING_PASS_INDEX_KEY = 'timing_pass_index_v1';
const PASS_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const VALID_STATIONS = new Set<DelegatedTimingStation>([
  'START_FINISH',
  '200M_MARK',
  '100M_MARK',
  'RELAY_ZONE',
  'CUSTOM',
]);

export const DELEGATED_STATION_LABELS: Record<DelegatedTimingStation, string> = {
  START_FINISH: 'Start / Finish',
  '200M_MARK': '200m Mark',
  '100M_MARK': '100m Mark',
  RELAY_ZONE: 'Relay Zone',
  CUSTOM: 'Custom Mark',
};

interface TimingPassDirectoryIndex {
  byPassCode: Record<
    string,
    {
      teamId: string;
      sessionId: string;
      expiresAt: string;
    }
  >;
}

const RELAY_EVENT_SPECS: Record<
  string,
  { distanceMeters: number; splitMeters: 60 | 100 | 200 | 400 | 1000; lapCount: number }
> = {
  '4x100m': { distanceMeters: 400, splitMeters: 100, lapCount: 4 },
  '4x200m': { distanceMeters: 800, splitMeters: 200, lapCount: 4 },
  '4x400m': { distanceMeters: 1600, splitMeters: 400, lapCount: 4 },
  '4x800m': { distanceMeters: 3200, splitMeters: 400, lapCount: 4 },
  dmr: { distanceMeters: 4000, splitMeters: 400, lapCount: 4 },
};

function sanitizeText(raw: unknown, maxLen: number): string {
  return String(raw ?? '')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted]')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
}

export function abbreviatePublicRunnerName(fullName: string): string {
  const parts = sanitizeText(fullName, 64).split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
  }
  return parts[0] || 'Runner';
}

function generatePassCode(): string {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += PASS_CODE_ALPHABET[bytes[i] % PASS_CODE_ALPHABET.length];
  }
  return out;
}

function hashTimingPassPin(sessionId: string, pin: string): string {
  return hashToken(`timing_pin_v1:${sessionId}:${pin}`);
}

function verifyTimingPassPin(sessionId: string, pinHash: string, candidatePin: string): boolean {
  const expected = hashTimingPassPin(sessionId, candidatePin);
  const a = Buffer.from(pinHash, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function resolveEventDefaults(eventCode: string): {
  eventLabel: string;
  distanceMeters: number;
  splitMeters: 60 | 100 | 200 | 400 | 1000;
  lapCount: number;
} {
  const clean = sanitizeText(eventCode, 32) || '1600m';
  const relayMatch = RELAY_EVENT_SPECS[clean.toLowerCase()];
  if (relayMatch) {
    return {
      eventLabel: clean,
      distanceMeters: relayMatch.distanceMeters,
      splitMeters: relayMatch.splitMeters,
      lapCount: relayMatch.lapCount,
    };
  }
  const official = OFFICIAL_RACE_EVENTS.find(
    (e) => e.label.toLowerCase() === clean.toLowerCase()
  );
  if (official) {
    return {
      eventLabel: official.label,
      distanceMeters: official.distanceMeters,
      splitMeters: official.defaultSplitMeters,
      lapCount: official.defaultLapCount,
    };
  }
  const numericMeters = Number(clean.replace(/[^0-9]/g, ''));
  const dist =
    Number.isFinite(numericMeters) && numericMeters >= 50 && numericMeters <= 50000
      ? numericMeters
      : 1600;
  const splitMeters: 60 | 100 | 200 | 400 | 1000 =
    dist <= 60 ? 60 : dist <= 120 ? 100 : dist <= 400 ? 200 : dist >= 5000 ? 1000 : 400;
  return {
    eventLabel: clean,
    distanceMeters: dist,
    splitMeters,
    lapCount: Math.max(1, Math.round(dist / splitMeters)),
  };
}

function snapLapSplitMeters(rawMeters: number): 60 | 100 | 200 | 400 | 1000 {
  const options: Array<60 | 100 | 200 | 400 | 1000> = [60, 100, 200, 400, 1000];
  return options.reduce((best, cur) =>
    Math.abs(cur - rawMeters) < Math.abs(best - rawMeters) ? cur : best
  );
}

function resolveDefaultMidnightExpiryIso(meetDate: string): string {
  const match = meetDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return new Date(Date.now() + 18 * 3600_000).toISOString();
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // End of meet day across North American timezones (UTC+8h past midnight) or min +8h from now
  const endOfMeetDayMs = Date.UTC(year, month - 1, day + 1, 7, 59, 59, 999);
  const nowPlusEightHrs = Date.now() + 8 * 3600_000;
  const maxBounded = Date.now() + 72 * 3600_000;
  return new Date(Math.min(maxBounded, Math.max(endOfMeetDayMs, nowPlusEightHrs))).toISOString();
}

async function upsertPassDirectoryEntry(
  passCode: string,
  entry: { teamId: string; sessionId: string; expiresAt: string }
): Promise<void> {
  await withVaultLock(TIMING_PASS_INDEX_KEY, async () => {
    const idx = await loadTenantVaultAsync<TimingPassDirectoryIndex>(TIMING_PASS_INDEX_KEY, {
      byPassCode: {},
    });
    const nextByCode = { ...(idx.byPassCode || {}) };
    nextByCode[passCode.toUpperCase()] = entry;
    const keys = Object.keys(nextByCode);
    if (keys.length > 1500) {
      const nowMs = Date.now();
      for (const k of keys) {
        const parsed = Date.parse(nextByCode[k].expiresAt);
        if (Number.isFinite(parsed) && parsed < nowMs - 48 * 3600_000) {
          delete nextByCode[k];
        }
      }
    }
    await saveTenantVaultAsync(TIMING_PASS_INDEX_KEY, { byPassCode: nextByCode });
  });
}

async function findTeamIdForPassCode(passCode: string): Promise<string | null> {
  const cleanCode = sanitizeText(passCode, 24).toUpperCase();
  if (!cleanCode) return null;
  const idx = await loadTenantVaultAsync<TimingPassDirectoryIndex>(TIMING_PASS_INDEX_KEY, {
    byPassCode: {},
  });
  const hit = idx.byPassCode?.[cleanCode];
  if (hit?.teamId) return hit.teamId;

  // Fallback directory scan if test seeded team document directly
  const dir = await loadDirectory();
  for (const tid of dir.allTeamIds || []) {
    const doc = await loadTeamDocRaw(tid);
    if (doc?.delegatedTimingSessions?.some((s) => s.passCode.toUpperCase() === cleanCode)) {
      return tid;
    }
  }
  return null;
}

function isSessionExpiredOrRevoked(
  session: StoredDelegatedTimingSessionInternal,
  nowMs: number = Date.now()
): boolean {
  if (session.revokedAt) return true;
  if (session.expiresAt) {
    const expMs = Date.parse(session.expiresAt);
    if (Number.isFinite(expMs) && nowMs > expMs) return true;
  }
  return false;
}

export async function createDelegatedTimingSession(params: {
  callerSid: string;
  teamId: string;
  originUrl: string;
  meetTitle?: unknown;
  meetDate?: unknown;
  eventCode?: unknown;
  eventLabel?: unknown;
  heatLabel?: unknown;
  stationType?: unknown;
  stationLabel?: unknown;
  splitPlanLabel?: unknown;
  targetSplitMeters?: unknown;
  targetLapCount?: unknown;
  runners?: unknown;
  assignedMembershipId?: unknown;
  pin?: unknown;
  expiresAt?: unknown;
}): Promise<{
  ok: boolean;
  statusCode?: number;
  session?: DelegatedTimingSessionRecord;
  passUrl?: string;
  team?: TeamSummaryWithRole | null;
  error?: string;
}> {
  const cleanPinRaw =
    typeof params.pin === 'string'
      ? params.pin.trim()
      : typeof params.pin === 'number'
        ? String(params.pin).trim()
        : '';
  if (cleanPinRaw && !/^\d{4}$/.test(cleanPinRaw)) {
    return {
      ok: false,
      statusCode: 400,
      error: 'Optional timing pass PIN must be exactly 4 numeric digits.',
    };
  }

  const rawDate = sanitizeText(params.meetDate, 10);
  const meetDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? rawDate
    : new Date().toISOString().slice(0, 10);

  let resolvedExpiresAt = resolveDefaultMidnightExpiryIso(meetDate);
  if (typeof params.expiresAt === 'string' && params.expiresAt.trim()) {
    const parsedExp = Date.parse(params.expiresAt.trim());
    if (!Number.isFinite(parsedExp)) {
      return { ok: false, statusCode: 400, error: 'Invalid expiresAt timestamp.' };
    }
    resolvedExpiresAt = new Date(parsedExp).toISOString();
  }

  const rawStation = String(params.stationType || 'START_FINISH')
    .trim()
    .toUpperCase() as DelegatedTimingStation;
  const stationType: DelegatedTimingStation = VALID_STATIONS.has(rawStation)
    ? rawStation
    : 'START_FINISH';
  const stationLabel =
    sanitizeText(params.stationLabel, 48) || DELEGATED_STATION_LABELS[stationType];

  const eventCode = sanitizeText(params.eventCode, 32) || '1600m';
  const eventDefaults = resolveEventDefaults(eventCode);
  const eventLabel = sanitizeText(params.eventLabel, 48) || eventDefaults.eventLabel;

  const rawSplitMeters = Number(params.targetSplitMeters);
  const targetSplitMeters =
    Number.isFinite(rawSplitMeters) && rawSplitMeters >= 30 && rawSplitMeters <= 5000
      ? Math.round(rawSplitMeters)
      : eventDefaults.splitMeters;

  const rawLapCount = Number(params.targetLapCount);
  const targetLapCount =
    Number.isFinite(rawLapCount) && rawLapCount >= 1 && rawLapCount <= 50
      ? Math.round(rawLapCount)
      : eventDefaults.lapCount;

  const splitPlanLabel =
    sanitizeText(params.splitPlanLabel, 48) ||
    `${targetLapCount} × ${targetSplitMeters}m`;

  const meetTitle = sanitizeText(params.meetTitle, 120) || 'Track Meet';
  const heatLabel = sanitizeText(params.heatLabel, 40) || undefined;

  const result = await withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) {
      return { ok: false, statusCode: 404, error: 'Team not found.' };
    }
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED' && m.status !== 'ALUMNI'
    );
    if (!callerMem || !canProgramWorkoutsRole(callerMem.role)) {
      return {
        ok: false,
        statusCode: 403,
        error: 'Head Coach or Assistant Coach permissions required to delegate timing.',
      };
    }

    let assignedMembershipId: string | undefined;
    let assignedDelegateName: string | undefined;
    const requestedAssigneeId = sanitizeText(params.assignedMembershipId, 64);
    if (requestedAssigneeId) {
      const assigneeMem = doc.memberships.find(
        (m) =>
          m.membershipId === requestedAssigneeId &&
          m.status !== 'REVOKED' &&
          m.status !== 'ALUMNI'
      );
      if (!assigneeMem) {
        return {
          ok: false,
          statusCode: 404,
          error: 'Assigned teammate membership not found on active roster.',
        };
      }
      assignedMembershipId = assigneeMem.membershipId;
      assignedDelegateName = assigneeMem.invitedName;
    }

    const rawRunners = Array.isArray(params.runners) ? params.runners : [];
    const runners: DelegatedTimingRunner[] = [];
    const seenKeys = new Set<string>();
    for (let i = 0; i < Math.min(24, rawRunners.length); i++) {
      const item = rawRunners[i];
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const obj = item as Record<string, unknown>;
      const reqMemId = sanitizeText(obj.membershipId, 64);
      const matchedMem = reqMemId
        ? doc.memberships.find(
            (m) => m.membershipId === reqMemId && m.status !== 'REVOKED' && m.status !== 'ALUMNI'
          )
        : undefined;
      const displayName =
        matchedMem?.invitedName || sanitizeText(obj.displayName || obj.athleteName, 64);
      if (!displayName) continue;
      const rawCandidateKey = sanitizeText(obj.entryKey, 48).replace(/[^a-zA-Z0-9_-]/g, '');
      const containsMemberId =
        Boolean(matchedMem && rawCandidateKey.includes(matchedMem.membershipId)) ||
        rawCandidateKey.startsWith('mem_') ||
        rawCandidateKey.startsWith('mem-');
      let entryKey =
        rawCandidateKey && !containsMemberId
          ? rawCandidateKey
          : `r_${i + 1}`;
      if (seenKeys.has(entryKey)) {
        entryKey = `${entryKey}_${i + 1}`;
      }
      seenKeys.add(entryKey);
      const hipOrLane = sanitizeText(obj.hipOrLane, 12) || undefined;
      const rawTargetSplit = Number(obj.targetSplitSecs);
      const targetSplitSecs =
        Number.isFinite(rawTargetSplit) && rawTargetSplit > 0 && rawTargetSplit < 3600
          ? Number(rawTargetSplit.toFixed(2))
          : undefined;
      const isWalkOn = !matchedMem && Boolean(obj.isWalkOn);
      runners.push({
        entryKey,
        ...(matchedMem ? { membershipId: matchedMem.membershipId } : {}),
        displayName,
        ...(hipOrLane ? { hipOrLane } : {}),
        ...(targetSplitSecs !== undefined ? { targetSplitSecs } : {}),
        ...(isWalkOn ? { isWalkOn: true } : {}),
      });
    }

    const sessionId = `dts_${crypto.randomBytes(6).toString('hex')}`;
    const existingCodes = new Set(
      (doc.delegatedTimingSessions || []).map((s) => s.passCode.toUpperCase())
    );
    let passCode = generatePassCode();
    while (existingCodes.has(passCode)) {
      passCode = generatePassCode();
    }

    const nowIso = new Date().toISOString();
    const internalRecord: StoredDelegatedTimingSessionInternal = {
      sessionId,
      teamId: params.teamId,
      passCode,
      meetTitle,
      meetDate,
      eventCode,
      eventLabel,
      ...(heatLabel ? { heatLabel } : {}),
      stationType,
      stationLabel,
      splitPlanLabel,
      targetSplitMeters,
      targetLapCount,
      runners,
      ...(assignedMembershipId ? { assignedMembershipId, assignedDelegateName } : {}),
      createdBySid: params.callerSid,
      createdByName: callerMem.invitedName || doc.brand.coachDisplayName || 'Coach',
      expiresAt: resolvedExpiresAt,
      ...(cleanPinRaw
        ? {
            pinRequired: true,
            pinHash: hashTimingPassPin(sessionId, cleanPinRaw),
          }
        : { pinRequired: false }),
      createdAt: nowIso,
    };

    const prevSessions = Array.isArray(doc.delegatedTimingSessions)
      ? doc.delegatedTimingSessions
      : [];
    doc.delegatedTimingSessions = [internalRecord, ...prevSessions].slice(0, 80);
    doc.updatedAt = nowIso;

    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'DELEGATED_TIMING_SESSION_CREATED',
      targetId: sessionId,
      metadata: {
        passCode,
        eventLabel,
        stationType,
        runnerCount: runners.length,
        pinRequired: Boolean(cleanPinRaw),
        assignedMembershipId: assignedMembershipId || null,
      },
    });

    const { pinHash: _dropPinHash, ...publicSession } = internalRecord;
    const cleanOrigin = params.originUrl.replace(/\/+$/, '');
    return {
      ok: true,
      statusCode: 200,
      session: publicSession,
      passUrl: `${cleanOrigin}/time/${encodeURIComponent(passCode)}`,
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
      expiresAt: resolvedExpiresAt,
    };
  });

  if (result.ok && result.session) {
    await upsertPassDirectoryEntry(result.session.passCode, {
      teamId: params.teamId,
      sessionId: result.session.sessionId,
      expiresAt: result.session.expiresAt,
    });
  }

  return result;
}

export async function revokeDelegatedTimingSession(params: {
  callerSid: string;
  teamId: string;
  sessionId: string;
  originUrl: string;
}): Promise<{
  ok: boolean;
  statusCode?: number;
  team?: TeamSummaryWithRole | null;
  error?: string;
}> {
  const cleanSessionId = sanitizeText(params.sessionId, 64);
  if (!cleanSessionId) {
    return { ok: false, statusCode: 400, error: 'Session ID is required.' };
  }

  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) {
      return { ok: false, statusCode: 404, error: 'Team not found.' };
    }
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED' && m.status !== 'ALUMNI'
    );
    if (
      !callerMem ||
      (!canProgramWorkoutsRole(callerMem.role) && callerMem.role !== 'ORG_ADMIN')
    ) {
      return {
        ok: false,
        statusCode: 403,
        error: 'Coach permissions required to revoke timing passes.',
      };
    }

    const sessions = Array.isArray(doc.delegatedTimingSessions)
      ? doc.delegatedTimingSessions
      : [];
    const target = sessions.find((s) => s.sessionId === cleanSessionId);
    if (!target) {
      return { ok: false, statusCode: 404, error: 'Timing pass session not found.' };
    }

    const nowIso = new Date().toISOString();
    target.revokedAt = nowIso;
    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'DELEGATED_TIMING_SESSION_REVOKED',
      targetId: cleanSessionId,
      metadata: { passCode: target.passCode },
    });

    return {
      ok: true,
      statusCode: 200,
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}

export async function getPublicDelegatedTimingPass(params: {
  passCode: string;
  pin?: string;
}): Promise<PublicDelegatedTimingPassPayload & { statusCode: number; error?: string }> {
  const cleanCode = sanitizeText(params.passCode, 24).toUpperCase();
  if (!cleanCode) {
    return { found: false, statusCode: 404 };
  }
  const teamId = await findTeamIdForPassCode(cleanCode);
  if (!teamId) {
    return { found: false, statusCode: 404 };
  }
  const doc = await loadTeamDocRaw(teamId);
  if (!doc) {
    return { found: false, statusCode: 404 };
  }
  const session = (doc.delegatedTimingSessions || []).find(
    (s) => s.passCode.toUpperCase() === cleanCode
  );
  if (!session) {
    return { found: false, statusCode: 404 };
  }

  if (isSessionExpiredOrRevoked(session)) {
    return {
      found: true,
      expiredOrRevoked: true,
      teamShortName: doc.brand.shortName,
      teamName: doc.brand.name,
      statusCode: 410,
      error: session.revokedAt
        ? 'This timing pass was revoked by the coach.'
        : 'This timing pass has expired.',
    };
  }

  const pinRequired = Boolean(session.pinRequired && session.pinHash);
  const candidatePin = sanitizeText(params.pin, 12);
  if (pinRequired) {
    const pinVerified =
      Boolean(candidatePin) &&
      /^\d{4}$/.test(candidatePin) &&
      verifyTimingPassPin(session.sessionId, session.pinHash!, candidatePin);
    if (!pinVerified) {
      return {
        found: true,
        pinRequired: true,
        pinVerified: false,
        teamShortName: doc.brand.shortName,
        teamName: doc.brand.name,
        statusCode: candidatePin ? 403 : 200,
        ...(candidatePin ? { error: 'Incorrect 4-digit timing pass PIN.' } : {}),
      };
    }
  }

  // Zero-PII public pass projection: strictly allowlisted fields, abbreviated First + Last Initial
  const safeRunners: DelegatedTimingRunner[] = (session.runners || []).map((r) => ({
    entryKey: r.entryKey,
    displayName: abbreviatePublicRunnerName(r.displayName),
    ...(r.hipOrLane ? { hipOrLane: r.hipOrLane } : {}),
    ...(typeof r.targetSplitSecs === 'number' ? { targetSplitSecs: r.targetSplitSecs } : {}),
    ...(r.isWalkOn ? { isWalkOn: true } : {}),
  }));

  return {
    found: true,
    expiredOrRevoked: false,
    pinRequired,
    pinVerified: true,
    teamShortName: doc.brand.shortName,
    teamName: doc.brand.name,
    statusCode: 200,
    session: {
      sessionId: session.sessionId,
      teamId: session.teamId,
      passCode: session.passCode,
      meetTitle: session.meetTitle,
      meetDate: session.meetDate,
      eventCode: session.eventCode,
      eventLabel: session.eventLabel,
      ...(session.heatLabel ? { heatLabel: session.heatLabel } : {}),
      stationType: session.stationType,
      stationLabel: session.stationLabel,
      splitPlanLabel: session.splitPlanLabel,
      targetSplitMeters: session.targetSplitMeters,
      targetLapCount: session.targetLapCount,
      runners: safeRunners,
      expiresAt: session.expiresAt,
    },
  };
}

function sanitizeSubmissionEntries(
  rawEntries: unknown,
  sessionRunners: DelegatedTimingRunner[]
): DelegatedSplitSubmissionEntry[] {
  if (!Array.isArray(rawEntries)) return [];
  const sessionRunnerByKey = new Map(sessionRunners.map((r) => [r.entryKey, r]));
  const out: DelegatedSplitSubmissionEntry[] = [];

  for (let i = 0; i < Math.min(40, rawEntries.length); i++) {
    const raw = rawEntries[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const obj = raw as Record<string, unknown>;
    const entryKey = sanitizeText(obj.entryKey, 64).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!entryKey) continue;

    const rawTimestamps = Array.isArray(obj.rawLapTimestampsSecs)
      ? obj.rawLapTimestampsSecs
          .slice(0, 100)
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && n >= 0 && n <= 86400)
          .map((n) => Number(n.toFixed(2)))
      : [];
    const rawSplits = Array.isArray(obj.lapSplitsSecs)
      ? obj.lapSplitsSecs
          .slice(0, 100)
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && n > 0 && n <= 86400)
          .map((n) => Number(n.toFixed(2)))
      : [];

    const totalNum = Number(obj.totalSecs);
    const derivedTotal =
      Number.isFinite(totalNum) && totalNum > 0 && totalNum <= 86400
        ? Number(totalNum.toFixed(2))
        : rawSplits.length > 0
          ? Number(rawSplits.reduce((s, v) => s + v, 0).toFixed(2))
          : 0;
    if (derivedTotal <= 0) continue;

    const finalSplits = rawSplits.length > 0 ? rawSplits : [derivedTotal];
    const finalTimestamps = rawTimestamps.length > 0 ? rawTimestamps : [derivedTotal];

    // Never trust client-supplied membershipId for non-session roster members; resolve strictly from session
    const matchedSessionRunner = sessionRunnerByKey.get(entryKey);
    const isWalkOn = !matchedSessionRunner || Boolean(matchedSessionRunner.isWalkOn);
    const athleteName = matchedSessionRunner
      ? matchedSessionRunner.displayName
      : sanitizeText(obj.athleteName, 64) || `Walk-On ${i + 1}`;

    out.push({
      entryKey,
      ...(matchedSessionRunner?.membershipId
        ? { membershipId: matchedSessionRunner.membershipId }
        : {}),
      athleteName,
      ...(matchedSessionRunner?.hipOrLane
        ? { hipOrLane: matchedSessionRunner.hipOrLane }
        : sanitizeText(obj.hipOrLane, 12)
          ? { hipOrLane: sanitizeText(obj.hipOrLane, 12) }
          : {}),
      totalSecs: derivedTotal,
      lapSplitsSecs: finalSplits,
      rawLapTimestampsSecs: finalTimestamps,
      ...(isWalkOn ? { isWalkOn: true } : {}),
    });
  }
  return out;
}

export async function submitDelegatedSplits(params: {
  passCode: string;
  pin?: string;
  callerSid?: string;
  clientSubmissionId?: unknown;
  capturedByName?: unknown;
  gunStartEpochMs?: unknown;
  entries?: unknown;
  originUrl?: string;
}): Promise<{
  ok: boolean;
  statusCode: number;
  deduplicated?: boolean;
  submission?: DelegatedSplitSubmissionRecord;
  team?: TeamSummaryWithRole | null;
  error?: string;
}> {
  const cleanCode = sanitizeText(params.passCode, 24).toUpperCase();
  if (!cleanCode) {
    return { ok: false, statusCode: 400, error: 'Timing pass code is required.' };
  }

  const teamId = await findTeamIdForPassCode(cleanCode);
  if (!teamId) {
    return { ok: false, statusCode: 404, error: 'Timing pass not found.' };
  }

  return withTeamRowLock(teamId, async () => {
    const doc = await loadTeamDocRaw(teamId);
    if (!doc) {
      return { ok: false, statusCode: 404, error: 'Team not found.' };
    }
    const session = (doc.delegatedTimingSessions || []).find(
      (s) => s.passCode.toUpperCase() === cleanCode
    );
    if (!session) {
      return { ok: false, statusCode: 404, error: 'Timing pass not found.' };
    }

    const authMember = params.callerSid
      ? doc.memberships.find(
          (m) => m.userSid === params.callerSid && m.status !== 'REVOKED' && m.status !== 'ALUMNI'
        )
      : undefined;
    const isStaffMember = Boolean(authMember && canProgramWorkoutsRole(authMember.role));

    if (session.revokedAt) {
      return {
        ok: false,
        statusCode: 410,
        error: 'This timing pass has been revoked by the coach.',
      };
    }

    // Allow staff importing offline handoff codes after midnight; strictly block expired unauthenticated passes
    if (!isStaffMember && isSessionExpiredOrRevoked(session)) {
      return {
        ok: false,
        statusCode: 410,
        error: 'This timing pass has expired.',
      };
    }

    if (session.pinRequired && session.pinHash && !authMember) {
      const candidatePin = sanitizeText(params.pin, 12);
      if (
        !candidatePin ||
        !/^\d{4}$/.test(candidatePin) ||
        !verifyTimingPassPin(session.sessionId, session.pinHash, candidatePin)
      ) {
        return {
          ok: false,
          statusCode: 403,
          error: 'Valid 4-digit timing pass PIN is required to submit splits.',
        };
      }
    }

    const cleanClientSubmissionId =
      sanitizeText(params.clientSubmissionId, 96).replace(/[^a-zA-Z0-9_.:-]/g, '') ||
      `dsub_cli_${crypto.randomBytes(8).toString('hex')}`;

    const existingList = Array.isArray(doc.pendingTimingSubmissions)
      ? doc.pendingTimingSubmissions
      : [];
    const existingDuplicate = existingList.find(
      (sub) =>
        sub.sessionId === session.sessionId &&
        sub.clientSubmissionId === cleanClientSubmissionId
    );
    if (existingDuplicate) {
      return {
        ok: true,
        statusCode: 200,
        deduplicated: true,
        submission: existingDuplicate,
        ...(authMember && params.originUrl
          ? { team: projectTeamSummaryForCaller(doc, authMember.userSid!, params.originUrl) }
          : {}),
      };
    }

    const cleanEntries = sanitizeSubmissionEntries(params.entries, session.runners || []);
    if (cleanEntries.length === 0) {
      return {
        ok: false,
        statusCode: 400,
        error: 'At least one runner split entry is required.',
      };
    }

    const capturedByName =
      sanitizeText(params.capturedByName, 64) ||
      authMember?.invitedName ||
      session.assignedDelegateName ||
      'Trackside Helper';

    const rawGunMs = Number(params.gunStartEpochMs);
    const gunStartEpochMs =
      Number.isFinite(rawGunMs) && rawGunMs > 0 ? Math.round(rawGunMs) : undefined;

    const nowIso = new Date().toISOString();
    const submission: DelegatedSplitSubmissionRecord = {
      submissionId: `dsub_${crypto.randomBytes(6).toString('hex')}`,
      sessionId: session.sessionId,
      teamId,
      clientSubmissionId: cleanClientSubmissionId,
      meetTitle: session.meetTitle,
      meetDate: session.meetDate,
      eventCode: session.eventCode,
      eventLabel: session.eventLabel,
      ...(session.heatLabel ? { heatLabel: session.heatLabel } : {}),
      stationType: session.stationType,
      capturedByName,
      ...(authMember ? { capturedByMembershipId: authMember.membershipId } : {}),
      ...(gunStartEpochMs !== undefined ? { gunStartEpochMs } : {}),
      submittedAt: nowIso,
      entries: cleanEntries,
      reviewStatus: 'PENDING_COACH_APPROVAL',
    };

    const nextSubmissions = [submission, ...existingList];
    // Preserve all PENDING items first, then recent reviewed items up to 200 total
    const pendingItems = nextSubmissions.filter(
      (s) => s.reviewStatus === 'PENDING_COACH_APPROVAL'
    );
    const reviewedItems = nextSubmissions.filter(
      (s) => s.reviewStatus !== 'PENDING_COACH_APPROVAL'
    );
    doc.pendingTimingSubmissions = [...pendingItems, ...reviewedItems].slice(0, 200);
    doc.updatedAt = nowIso;

    await saveTeamDocRaw(teamId, doc);
    await appendAuditLogAsync({
      teamId,
      actorSid: params.callerSid || `pass:${session.passCode}`,
      action: 'DELEGATED_SPLITS_SUBMITTED',
      targetId: submission.submissionId,
      metadata: {
        sessionId: session.sessionId,
        stationType: session.stationType,
        entryCount: cleanEntries.length,
        authenticated: Boolean(authMember),
      },
    });

    return {
      ok: true,
      statusCode: 201,
      deduplicated: false,
      submission,
      ...(authMember && params.originUrl
        ? { team: projectTeamSummaryForCaller(doc, authMember.userSid!, params.originUrl) }
        : {}),
    };
  });
}

function doesActivityMatchDelegatedRace(
  act: UnifiedActivity,
  submission: DelegatedSplitSubmissionRecord
): boolean {
  const race = act.officialRaceData;
  if (!race) return false;
  const sameDate = String(act.startDateLocal || '').slice(0, 10) === submission.meetDate;
  const sameEvent =
    String(race.eventLabel || '').trim().toLowerCase() ===
    submission.eventLabel.trim().toLowerCase();
  const sameMeet =
    String(race.meetName || '').trim().toLowerCase() ===
    submission.meetTitle.trim().toLowerCase();
  return sameDate && sameEvent && sameMeet;
}

function attachCaptureNonDestructively(
  existingAct: UnifiedActivity,
  capture: DelegatedHandSplitCaptureSummary,
  enforceHideWeight: boolean
): UnifiedActivity {
  const prevRace = existingAct.officialRaceData!;
  const prevCaptures = Array.isArray(prevRace.handSplitCaptures)
    ? prevRace.handSplitCaptures
    : [];
  const alreadyHasCapture = Boolean(
    capture.submissionId && prevCaptures.some((c) => c.submissionId === capture.submissionId)
  );
  const nextCaptures = alreadyHasCapture ? prevCaptures : [...prevCaptures, capture];

  const prevBadges = Array.isArray(existingAct.sourceBadges) ? existingAct.sourceBadges : [];
  const nextBadges = prevBadges.includes('Delegated Hand-Timed')
    ? prevBadges
    : [...prevBadges, 'Delegated Hand-Timed' as const];

  const updated: UnifiedActivity = {
    ...existingAct,
    sourceBadges: nextBadges,
    officialRaceData: {
      ...prevRace,
      handSplitCaptures: nextCaptures,
    },
  };
  return enforceHideWeight
    ? stripSafeSportWeightAndBodyCompFields([updated], { maskWellnessWeightKgZero: true })[0]
    : updated;
}

export async function reviewDelegatedSplitSubmission(params: {
  callerSid: string;
  teamId: string;
  submissionId: string;
  action: unknown;
  originUrl: string;
  clientLocalHour?: number;
}): Promise<{
  ok: boolean;
  statusCode: number;
  submission?: DelegatedSplitSubmissionRecord;
  team?: TeamSummaryWithRole | null;
  error?: string;
}> {
  const cleanSubmissionId = sanitizeText(params.submissionId, 64);
  const rawAction = String(params.action || '')
    .trim()
    .toUpperCase();
  const statusMap: Record<string, DelegatedSubmissionReviewStatus> = {
    APPROVE: 'APPROVED',
    ARCHIVE_BACKUP: 'BACKUP_ARCHIVED',
    DISCARD: 'DISCARDED',
  };
  const nextStatus = statusMap[rawAction];
  if (!cleanSubmissionId || !nextStatus) {
    return {
      ok: false,
      statusCode: 400,
      error: 'Valid submissionId and action (APPROVE | ARCHIVE_BACKUP | DISCARD) required.',
    };
  }

  const archiveQueue: Array<{
    member: StoredMembershipInternal;
    activity: UnifiedActivity;
  }> = [];
  const pushQueue: Array<{
    recipientSids: string[];
    teamId: string;
    teamShortName: string;
    eventLabel: string;
    meetTitle: string;
    isMinorTarget: boolean;
    quietHoursStart: number;
    quietHoursEnd: number;
  }> = [];

  const outcome = await withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) {
      return { ok: false, statusCode: 404, error: 'Team not found.' };
    }
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED' && m.status !== 'ALUMNI'
    );
    if (!callerMem || !canProgramWorkoutsRole(callerMem.role)) {
      return {
        ok: false,
        statusCode: 403,
        error: 'Head Coach or Assistant Coach permissions required to review splits.',
      };
    }

    const submissions = Array.isArray(doc.pendingTimingSubmissions)
      ? doc.pendingTimingSubmissions
      : [];
    const targetSub = submissions.find((s) => s.submissionId === cleanSubmissionId);
    if (!targetSub) {
      return { ok: false, statusCode: 404, error: 'Split submission not found.' };
    }

    const nowIso = new Date().toISOString();
    const reviewerName = callerMem.invitedName || doc.brand.coachDisplayName || 'Coach';

    if (targetSub.reviewStatus === 'APPROVED' && nextStatus === 'APPROVED') {
      return {
        ok: true,
        statusCode: 200,
        submission: targetSub,
        team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
      };
    }

    targetSub.reviewStatus = nextStatus;
    targetSub.reviewedAt = nowIso;
    targetSub.reviewedByName = reviewerName;

    if (nextStatus === 'APPROVED') {
      const linkedSession = (doc.delegatedTimingSessions || []).find(
        (s) => s.sessionId === targetSub.sessionId
      );
      const eventInfo = resolveEventDefaults(targetSub.eventCode || targetSub.eventLabel);
      const splitMeters = snapLapSplitMeters(
        linkedSession?.targetSplitMeters || eventInfo.splitMeters
      );

      for (const entry of targetSub.entries) {
        if (!entry.membershipId) continue;
        const mem = doc.memberships.find(
          (m) => m.membershipId === entry.membershipId && m.status !== 'REVOKED'
        );
        if (!mem) continue;

        const enforceHideWeight = Boolean(doc.brand.defaultSafeSportShield || mem.isMinorU18);
        const captureSummary: DelegatedHandSplitCaptureSummary = {
          submissionId: targetSub.submissionId,
          capturedByName: targetSub.capturedByName,
          stationType: targetSub.stationType,
          totalSecs: entry.totalSecs,
          lapSplitsSecs: entry.lapSplitsSecs,
          capturedAt: targetSub.submittedAt,
        };

        const prevRecorded = Array.isArray(mem.coachRecordedActivities)
          ? mem.coachRecordedActivities
          : [];
        const existingIdx = prevRecorded.findIndex((a) =>
          doesActivityMatchDelegatedRace(a, targetSub)
        );

        let attachedActivity: UnifiedActivity;
        if (existingIdx >= 0) {
          // Two-timer non-destructive merge: NEVER overwrite existing FAT or primary station splits
          attachedActivity = attachCaptureNonDestructively(
            prevRecorded[existingIdx],
            captureSummary,
            enforceHideWeight
          );
          const nextRecorded = [...prevRecorded];
          nextRecorded[existingIdx] = attachedActivity;
          mem.coachRecordedActivities = nextRecorded.slice(0, 50);
        } else {
          const raceId = `stopwatch-delegated-race-${targetSub.submissionId}-${mem.membershipId}`;
          const baseRace = synthesizeOfficialRaceActivity({
            id: raceId,
            date: targetSub.meetDate,
            startDateLocalIso: `${targetSub.meetDate}T10:30:00`,
            meetName: targetSub.meetTitle,
            eventLabel: targetSub.eventLabel,
            eventDistanceMeters: eventInfo.distanceMeters,
            fatTimeSecs: entry.totalSecs,
            displayFatTime: formatFatTime(entry.totalSecs),
            platform: 'MeetReady Stopwatch',
            trackType: targetSub.eventLabel === 'XC 5K' ? 'XC_COURSE' : 'OUTDOOR_400M',
            lapSplitDistanceMeters: splitMeters,
            lapSplitsSecs: entry.lapSplitsSecs,
            includeWarmupCooldown: false,
          });
          const rawActivity: UnifiedActivity = {
            ...baseRace,
            name: `${targetSub.eventLabel} Hand-Timed (${formatFatTime(entry.totalSecs)}) — ${targetSub.meetTitle}`,
            deviceName: `MeetReady Delegated Stopwatch (${DELEGATED_STATION_LABELS[targetSub.stationType]})`,
            sourceBadges: ['Delegated Hand-Timed'],
            officialRaceData: {
              ...baseRace.officialRaceData!,
              platform: 'MeetReady Stopwatch',
              timingMethod: 'HAND',
              splitContext: 'HAND_CONVERTED',
              handTimedTotalSecs: Number(entry.totalSecs.toFixed(2)),
              capturedByName: targetSub.capturedByName,
              timingStation: targetSub.stationType,
              handSplitCaptures: [captureSummary],
            },
            stopwatchFusionMeta: {
              stopwatchActivityId: raceId,
              lapSplitsSecs: entry.lapSplitsSecs,
              repDistanceMeters: splitMeters,
              restDurationSecs: 0,
              fusedWithWearableStreams: false,
            },
          };
          const cleanList = (sanitizeTelemetryForCleanRoom({ activities: [rawActivity] })
            .activities || []) as UnifiedActivity[];
          const safeAct = enforceHideWeight
            ? stripSafeSportWeightAndBodyCompFields(cleanList, { maskWellnessWeightKgZero: true })[0]
            : cleanList[0];
          if (!safeAct) continue;
          attachedActivity = safeAct;
          mem.coachRecordedActivities = [
            attachedActivity,
            ...prevRecorded.filter((a) => a.id !== attachedActivity.id),
          ].slice(0, 50);
        }

        archiveQueue.push({ member: { ...mem }, activity: attachedActivity });

        const baseSnap: TeamAthleteLiveSnapshot = mem.liveSnapshot || {
          updatedAt: nowIso,
          hasConnectedWatch: false,
          verdictLabel: 'Delegated Track Mark',
          readinessScore: 80,
          ctl: 0,
          atl: 0,
          tsb: 0,
          acuteLoad7d: 0,
          lowAerobicPct: 80,
          highAerobicPct: 15,
          neuromuscularPct: 5,
          caraHours7d: 0,
          safeSportHideWeight: enforceHideWeight,
          sharingTier: mem.sharingTier || 'SUMMARY_ONLY',
          activities: [],
        };
        const prevSnapActs = Array.isArray(baseSnap.activities) ? baseSnap.activities : [];
        const snapMatchIdx = prevSnapActs.findIndex(
          (a) => a.id === attachedActivity.id || doesActivityMatchDelegatedRace(a, targetSub)
        );
        const nextSnapActs =
          snapMatchIdx >= 0
            ? prevSnapActs.map((a, idx) => (idx === snapMatchIdx ? attachedActivity : a))
            : [attachedActivity, ...prevSnapActs];
        mem.liveSnapshot = {
          ...baseSnap,
          updatedAt: nowIso,
          safeSportHideWeight: baseSnap.safeSportHideWeight || enforceHideWeight,
          activities: nextSnapActs.slice(0, 30),
        };

        const recipientSet = new Set<string>();
        if (mem.userSid && mem.userSid !== params.callerSid) {
          recipientSet.add(mem.userSid);
        }
        const guardianEmailLower = mem.parentGuardianEmail?.trim().toLowerCase();
        if (guardianEmailLower) {
          for (const candidate of doc.memberships) {
            if (
              candidate.status !== 'REVOKED' &&
              candidate.status !== 'ALUMNI' &&
              candidate.role === 'PARENT_FOLLOWER' &&
              candidate.userSid &&
              candidate.userSid !== params.callerSid &&
              candidate.invitedEmail?.trim().toLowerCase() === guardianEmailLower
            ) {
              recipientSet.add(candidate.userSid);
            }
          }
        }
        if (recipientSet.size > 0) {
          pushQueue.push({
            recipientSids: Array.from(recipientSet),
            teamId: doc.brand.teamId,
            teamShortName: doc.brand.shortName || doc.brand.name || 'MeetReady',
            eventLabel: targetSub.eventLabel,
            meetTitle: targetSub.meetTitle,
            isMinorTarget: Boolean(
              mem.isMinorU18 ||
                doc.brand.orgType === 'HIGH_SCHOOL' ||
                doc.brand.defaultSafeSportShield
            ),
            quietHoursStart: doc.messagingPolicy?.quietHoursStartHour ?? 21,
            quietHoursEnd: doc.messagingPolicy?.quietHoursEndHour ?? 6,
          });
        }
      }
    }

    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'DELEGATED_SPLITS_REVIEWED',
      targetId: cleanSubmissionId,
      metadata: {
        action: rawAction,
        reviewStatus: nextStatus,
        entryCount: targetSub.entries.length,
      },
    });

    return {
      ok: true,
      statusCode: 200,
      submission: targetSub,
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });

  for (const item of archiveQueue) {
    await archiveCoachActivitiesForMember(item.member, [item.activity]).catch(() => undefined);
  }

  for (const item of pushQueue) {
    const body = item.isMinorTarget
      ? 'New coach-approved hand-timed split ready — tap to open in MeetReady.'
      : `${item.eventLabel} hand-timed split approved for ${item.meetTitle} — tap to view in MeetReady.`;
    await dispatchPushPayloadToUsers({
      recipientSids: item.recipientSids,
      payload: {
        title: `MeetReady · ${item.teamShortName}`,
        body,
        url: `/?tab=FITNESS&teamId=${encodeURIComponent(item.teamId)}`,
        tag: `thresh-split-${item.teamId}`,
        isEmergency: false,
      },
      isQuietHours: isWithinQuietHours(
        params.clientLocalHour,
        item.quietHoursStart,
        item.quietHoursEnd
      ),
    }).catch(() => undefined);
  }

  return outcome;
}
