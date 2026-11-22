import crypto from 'crypto';
import { generateVAPIDKeys, sendNotification } from 'web-push';
import type {
  CoachEventGroup,
  PushDispatchPayload,
  StoredWebPushSubscription,
  TeamAnnouncementCategory,
  TeamMessageChannelScope,
  WebPushSubscriptionKeys,
} from '../src/types.ts';
import { doesCoachOwnAthlete } from '../src/physiology/teamOnboardingEngine.ts';
import {
  canManageTeamGovernanceRole,
  canViewSafeguardingMedicalRole,
  loadTeamDocRaw,
  type StoredMembershipInternal,
  type StoredTeamDocument,
} from './teamStoreCore.ts';
import {
  loadTenantVaultAsync,
  sanitizeTenantId,
  saveTenantVaultAsync,
  withVaultLock,
} from './tokenVault.ts';

interface StoredVapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
  createdAt: string;
}

export type PushSenderFn = (
  subscription: { endpoint: string; keys: WebPushSubscriptionKeys },
  payloadJson: string
) => Promise<{ statusCode: number }>;

const VAPID_VAULT_KEY = 'thresh_vapid_keys_v1';
let cachedVapidKeys: StoredVapidKeys | null = null;
let testSenderOverride: PushSenderFn | null = null;

export function setPushNotificationSenderForTest(fn: PushSenderFn | null): void {
  testSenderOverride = fn;
}

export function resetVapidKeyCacheForTest(): void {
  cachedVapidKeys = null;
}

function pushSubsVaultKey(userSid: string): string {
  return `push_subs_${sanitizeTenantId(userSid)}`;
}

export async function getOrInitVapidKeys(): Promise<StoredVapidKeys> {
  const envPublic = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:support@thresh.fit';
  if (envPublic && envPrivate) {
    return {
      publicKey: envPublic,
      privateKey: envPrivate,
      subject,
      createdAt: 'env',
    };
  }
  if (cachedVapidKeys) return cachedVapidKeys;

  return withVaultLock(VAPID_VAULT_KEY, async () => {
    if (cachedVapidKeys) return cachedVapidKeys;
    const existing = await loadTenantVaultAsync<StoredVapidKeys | null>(VAPID_VAULT_KEY, null);
    if (existing?.publicKey && existing?.privateKey) {
      cachedVapidKeys = existing;
      return existing;
    }
    const generated = generateVAPIDKeys();
    const record: StoredVapidKeys = {
      publicKey: generated.publicKey,
      privateKey: generated.privateKey,
      subject,
      createdAt: new Date().toISOString(),
    };
    await saveTenantVaultAsync(VAPID_VAULT_KEY, record);
    cachedVapidKeys = record;
    return record;
  });
}

export async function listUserPushSubscriptions(
  userSid: string
): Promise<StoredWebPushSubscription[]> {
  if (!userSid) return [];
  const subs = await loadTenantVaultAsync<StoredWebPushSubscription[]>(
    pushSubsVaultKey(userSid),
    []
  );
  return Array.isArray(subs) ? subs.filter((s) => s.enabled !== false) : [];
}

export async function saveUserPushSubscription(params: {
  userSid: string;
  endpoint: string;
  keys: WebPushSubscriptionKeys;
  userAgent?: string;
  muteQuietHours?: boolean;
}): Promise<{ ok: boolean; subscription?: StoredWebPushSubscription; error?: string }> {
  const cleanEndpoint = String(params.endpoint || '').trim();
  const p256dh = String(params.keys?.p256dh || '').trim();
  const auth = String(params.keys?.auth || '').trim();
  if (!cleanEndpoint) {
    return { ok: false, error: 'Valid push subscription endpoint URL is required.' };
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(cleanEndpoint);
  } catch {
    return { ok: false, error: 'Valid push subscription endpoint URL is required.' };
  }
  const host = parsedUrl.hostname.toLowerCase();
  const isPrivateHost =
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.localhost') ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('169.254.') ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (parsedUrl.protocol !== 'https:' || isPrivateHost) {
    return { ok: false, error: 'Push subscription endpoint must be a public HTTPS URL.' };
  }
  if (!p256dh || !auth) {
    return { ok: false, error: 'Valid Web Push encryption keys (p256dh, auth) are required.' };
  }

  const key = pushSubsVaultKey(params.userSid);
  const nowIso = new Date().toISOString();
  return withVaultLock(key, async () => {
    const existing = await loadTenantVaultAsync<StoredWebPushSubscription[]>(key, []);
    const prior = existing.find((s) => s.endpoint === cleanEndpoint);
    const entry: StoredWebPushSubscription = {
      id: prior?.id || `psub_${crypto.randomBytes(6).toString('hex')}`,
      userSid: params.userSid,
      endpoint: cleanEndpoint,
      keys: { p256dh, auth },
      ...(params.userAgent ? { userAgent: String(params.userAgent).slice(0, 140) } : {}),
      createdAt: prior?.createdAt || nowIso,
      updatedAt: nowIso,
      enabled: true,
      muteQuietHours:
        typeof params.muteQuietHours === 'boolean'
          ? params.muteQuietHours
          : prior?.muteQuietHours ?? true,
    };
    const filtered = existing.filter((s) => s.endpoint !== cleanEndpoint);
    const next = [entry, ...filtered].slice(0, 8);
    await saveTenantVaultAsync(key, next);
    return { ok: true, subscription: entry };
  });
}

export async function removeUserPushSubscription(params: {
  userSid: string;
  endpoint?: string;
}): Promise<{ ok: boolean; remainingCount: number }> {
  const key = pushSubsVaultKey(params.userSid);
  return withVaultLock(key, async () => {
    const existing = await loadTenantVaultAsync<StoredWebPushSubscription[]>(key, []);
    const next = params.endpoint
      ? existing.filter((s) => s.endpoint !== params.endpoint)
      : [];
    await saveTenantVaultAsync(key, next);
    return { ok: true, remainingCount: next.length };
  });
}

function isWithinQuietHours(hour: number | undefined, startHour: number, endHour: number): boolean {
  if (typeof hour !== 'number' || !Number.isFinite(hour) || hour < 0 || hour > 23) return false;
  if (startHour === endHour) return false;
  if (startHour > endHour) {
    return hour >= startHour || hour < endHour;
  }
  return hour >= startHour && hour < endHour;
}

export function resolvePushRecipientSidsForTeamEvent(params: {
  doc: StoredTeamDocument;
  senderSid: string;
  kind: 'TEAM_MESSAGE' | 'WORKOUT_COMMENT' | 'ANNOUNCEMENT';
  channelScope?: TeamMessageChannelScope;
  eventGroup?: CoachEventGroup;
  targetMembershipId?: string;
}): string[] {
  const activeMembers = params.doc.memberships.filter(
    (m) =>
      m.status !== 'REVOKED' &&
      m.status !== 'ALUMNI' &&
      Boolean(m.userSid) &&
      m.userSid !== params.senderSid
  );

  const sids = new Set<string>();

  if (params.kind === 'ANNOUNCEMENT') {
    for (const m of activeMembers) {
      if (canViewSafeguardingMedicalRole(m.role)) {
        sids.add(m.userSid!);
      } else if (!params.eventGroup || !m.eventGroup || m.eventGroup === params.eventGroup) {
        sids.add(m.userSid!);
      }
    }
    return Array.from(sids);
  }

  if (params.kind === 'TEAM_MESSAGE') {
    if (params.channelScope === 'COACHES_STAFF') {
      for (const m of activeMembers) {
        if (canViewSafeguardingMedicalRole(m.role)) sids.add(m.userSid!);
      }
      return Array.from(sids);
    }

    if (params.channelScope === 'ALL_TEAM') {
      for (const m of activeMembers) {
        sids.add(m.userSid!);
      }
      return Array.from(sids);
    }

    if (params.channelScope === 'EVENT_GROUP') {
      for (const m of activeMembers) {
        if (canViewSafeguardingMedicalRole(m.role)) {
          if (
            canManageTeamGovernanceRole(m.role) ||
            !params.eventGroup ||
            !m.coachEventGroups?.length ||
            m.coachEventGroups.includes(params.eventGroup)
          ) {
            sids.add(m.userSid!);
          }
        } else if (m.role === 'ATHLETE') {
          if (!params.eventGroup || !m.eventGroup || m.eventGroup === params.eventGroup) {
            sids.add(m.userSid!);
          }
        }
      }
      return Array.from(sids);
    }
  }

  // DIRECT_TRANSPARENT or WORKOUT_COMMENT
  const targetAthlete: StoredMembershipInternal | undefined = params.targetMembershipId
    ? params.doc.memberships.find((m) => m.membershipId === params.targetMembershipId)
    : undefined;

  if (targetAthlete?.userSid && targetAthlete.userSid !== params.senderSid) {
    sids.add(targetAthlete.userSid);
  }

  // Two-adult transparency + assigned specialty coach responsibility
  for (const m of activeMembers) {
    if (canViewSafeguardingMedicalRole(m.role)) {
      const ownsAthlete = doesCoachOwnAthlete({
        coachEventGroups: m.coachEventGroups,
        assignedAthleteMembershipIds: m.assignedAthleteMembershipIds,
        athleteEventGroup: targetAthlete?.eventGroup,
        athleteMembershipId: targetAthlete?.membershipId,
      });
      if (canManageTeamGovernanceRole(m.role) || ownsAthlete) {
        sids.add(m.userSid!);
      }
    } else if (
      m.role === 'PARENT_FOLLOWER' &&
      targetAthlete?.parentGuardianEmail &&
      m.invitedEmail?.trim().toLowerCase() ===
        targetAthlete.parentGuardianEmail.trim().toLowerCase()
    ) {
      sids.add(m.userSid!);
    }
  }

  return Array.from(sids);
}

export function buildSafePushPayload(params: {
  teamId: string;
  teamShortName: string;
  senderName: string;
  kind: 'TEAM_MESSAGE' | 'WORKOUT_COMMENT' | 'ANNOUNCEMENT';
  channelScope?: TeamMessageChannelScope;
  announcementCategory?: TeamAnnouncementCategory;
  bodyText: string;
  isMinorTarget: boolean;
  isEmergency?: boolean;
}): PushDispatchPayload {
  const shortTeam = params.teamShortName || 'THRESH';
  const cleanSnippet = String(params.bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 110);
  const isStaffConfidential = params.channelScope === 'COACHES_STAFF';
  const redactForLockScreen =
    isStaffConfidential ||
    (params.isMinorTarget &&
      (params.channelScope === 'DIRECT_TRANSPARENT' || params.kind === 'WORKOUT_COMMENT'));

  const safeBody = isStaffConfidential
    ? `New coaching staff message from ${params.senderName} — tap to open in THRESH.`
    : redactForLockScreen
      ? `New SafeSport CC note from ${params.senderName} — tap to open in THRESH.`
      : `${params.senderName}: ${cleanSnippet}`;

  const title =
    params.isEmergency || params.announcementCategory === 'WEATHER'
      ? `THRESH Alert · ${shortTeam}`
      : `THRESH · ${shortTeam}`;

  return {
    title,
    body: safeBody,
    url: `/?openMessages=1&teamId=${encodeURIComponent(params.teamId)}`,
    tag:
      params.kind === 'ANNOUNCEMENT'
        ? `thresh-ann-${params.teamId}`
        : `thresh-msg-${params.teamId}`,
    isEmergency: Boolean(params.isEmergency || params.announcementCategory === 'WEATHER'),
  };
}

export async function dispatchPushPayloadToUsers(params: {
  recipientSids: string[];
  payload: PushDispatchPayload;
  isQuietHours?: boolean;
}): Promise<{ deliveredCount: number; prunedCount: number }> {
  if (params.recipientSids.length === 0) return { deliveredCount: 0, prunedCount: 0 };

  const keys = await getOrInitVapidKeys();
  const sender: PushSenderFn =
    testSenderOverride ||
    (async (sub, payloadJson) => {
      const res = await sendNotification(sub, payloadJson, {
        vapidDetails: {
          subject: keys.subject,
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
        },
        TTL: 60 * 60,
      });
      return { statusCode: res.statusCode };
    });

  const payloadJson = JSON.stringify(params.payload);
  let deliveredCount = 0;
  let prunedCount = 0;

  for (const sid of params.recipientSids) {
    const subs = await listUserPushSubscriptions(sid);
    for (const sub of subs) {
      if (params.isQuietHours && !params.payload.isEmergency && sub.muteQuietHours !== false) {
        continue;
      }
      try {
        await sender({ endpoint: sub.endpoint, keys: sub.keys }, payloadJson);
        deliveredCount += 1;
      } catch (err: unknown) {
        const statusCode =
          typeof err === 'object' && err !== null && 'statusCode' in err
            ? Number((err as { statusCode?: unknown }).statusCode)
            : 0;
        if (statusCode === 404 || statusCode === 410) {
          await removeUserPushSubscription({ userSid: sid, endpoint: sub.endpoint });
          prunedCount += 1;
        }
      }
    }
  }

  return { deliveredCount, prunedCount };
}

export async function dispatchTeamPushNotifications(params: {
  teamId: string;
  senderSid: string;
  senderName: string;
  kind: 'TEAM_MESSAGE' | 'WORKOUT_COMMENT' | 'ANNOUNCEMENT';
  channelScope?: TeamMessageChannelScope;
  eventGroup?: CoachEventGroup;
  targetMembershipId?: string;
  announcementCategory?: TeamAnnouncementCategory;
  bodyText: string;
  clientLocalHour?: number;
  isEmergency?: boolean;
}): Promise<{ deliveredCount: number; prunedCount: number }> {
  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc) return { deliveredCount: 0, prunedCount: 0 };

  const targetMem = params.targetMembershipId
    ? doc.memberships.find((m) => m.membershipId === params.targetMembershipId)
    : undefined;
  const isMinorTarget = Boolean(
    targetMem?.isMinorU18 || doc.brand.orgType === 'HIGH_SCHOOL' || doc.brand.defaultSafeSportShield
  );

  const policy = doc.messagingPolicy;
  const quietHours = isWithinQuietHours(
    params.clientLocalHour,
    policy?.quietHoursStartHour ?? 21,
    policy?.quietHoursEndHour ?? 6
  );

  const recipientSids = resolvePushRecipientSidsForTeamEvent({
    doc,
    senderSid: params.senderSid,
    kind: params.kind,
    channelScope: params.channelScope,
    eventGroup: params.eventGroup,
    targetMembershipId: params.targetMembershipId,
  });

  const payload = buildSafePushPayload({
    teamId: doc.brand.teamId,
    teamShortName: doc.brand.shortName || doc.brand.name,
    senderName: params.senderName,
    kind: params.kind,
    channelScope: params.channelScope,
    announcementCategory: params.announcementCategory,
    bodyText: params.bodyText,
    isMinorTarget,
    isEmergency: params.isEmergency,
  });

  return dispatchPushPayloadToUsers({
    recipientSids,
    payload,
    isQuietHours: quietHours,
  });
}
