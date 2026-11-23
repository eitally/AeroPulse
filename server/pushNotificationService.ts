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
  isResendConfigured,
  sendEmailViaResend,
  withBoundedTimeout,
} from './teamEmailAndOtpService.ts';
import { escapeHtml } from './securityUtils.ts';
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

export type EmailFallbackSenderFn = (params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}) => Promise<{ delivered: boolean }>;

const VAPID_VAULT_KEY = 'thresh_vapid_keys_v1';
let cachedVapidKeys: StoredVapidKeys | null = null;
let testSenderOverride: PushSenderFn | null = null;
let testEmailFallbackSenderOverride: EmailFallbackSenderFn | null = null;

export function setPushNotificationSenderForTest(fn: PushSenderFn | null): void {
  testSenderOverride = fn;
}

export function setTestEmailFallbackSenderForTests(fn: EmailFallbackSenderFn | null): void {
  testEmailFallbackSenderOverride = fn;
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
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:support@meetready.app';
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

export function isWithinQuietHours(hour: number | undefined, startHour: number, endHour: number): boolean {
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
  customSubgroupId?: string;
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

    if (params.channelScope === 'PARENTS_ONLY') {
      for (const m of activeMembers) {
        if (canViewSafeguardingMedicalRole(m.role) || m.role === 'PARENT_FOLLOWER') {
          sids.add(m.userSid!);
        }
      }
      return Array.from(sids);
    }

    if (params.channelScope === 'CUSTOM_SUBGROUP') {
      const sg = (params.doc.customSubgroups || []).find(
        (g) => g.id === params.customSubgroupId
      );
      if (!sg) return [];
      const memberSet = new Set(sg.memberIds || []);
      for (const m of activeMembers) {
        if (canViewSafeguardingMedicalRole(m.role) || memberSet.has(m.membershipId)) {
          sids.add(m.userSid!);
        } else if (
          m.role === 'PARENT_FOLLOWER' &&
          sg.includeLinkedParents !== false &&
          m.invitedEmail
        ) {
          const parentEmail = m.invitedEmail.trim().toLowerCase();
          const hasChild = params.doc.memberships.some(
            (child) =>
              memberSet.has(child.membershipId) &&
              child.parentGuardianEmail?.trim().toLowerCase() === parentEmail
          );
          if (hasChild) sids.add(m.userSid!);
        }
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
  const shortTeam = params.teamShortName || 'MeetReady';
  const cleanSnippet = String(params.bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 110);
  const isStaffConfidential = params.channelScope === 'COACHES_STAFF';
  const redactForLockScreen =
    isStaffConfidential ||
    (params.isMinorTarget &&
      (params.channelScope === 'DIRECT_TRANSPARENT' || params.kind === 'WORKOUT_COMMENT'));

  const safeBody = isStaffConfidential
    ? `New coaching staff message from ${params.senderName} — tap to open in MeetReady.`
    : redactForLockScreen
      ? `New SafeSport CC note from ${params.senderName} — tap to open in MeetReady.`
      : `${params.senderName}: ${cleanSnippet}`;

  const title =
    params.isEmergency || params.announcementCategory === 'WEATHER'
      ? `MeetReady Alert · ${shortTeam}`
      : `MeetReady · ${shortTeam}`;

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
}): Promise<{
  deliveredCount: number;
  prunedCount: number;
  deliveredSids: string[];
  undeliveredSids: string[];
}> {
  if (params.recipientSids.length === 0) {
    return { deliveredCount: 0, prunedCount: 0, deliveredSids: [], undeliveredSids: [] };
  }

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
  const deliveredSids: string[] = [];
  const undeliveredSids: string[] = [];

  for (const sid of params.recipientSids) {
    const subs = await listUserPushSubscriptions(sid);
    if (subs.length === 0) {
      undeliveredSids.push(sid);
      continue;
    }
    let sidDelivered = false;
    let skippedDueToQuietHours = false;
    for (const sub of subs) {
      if (params.isQuietHours && !params.payload.isEmergency && sub.muteQuietHours !== false) {
        skippedDueToQuietHours = true;
        continue;
      }
      try {
        await sender({ endpoint: sub.endpoint, keys: sub.keys }, payloadJson);
        deliveredCount += 1;
        sidDelivered = true;
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
    if (sidDelivered) {
      deliveredSids.push(sid);
    } else if (!skippedDueToQuietHours) {
      undeliveredSids.push(sid);
    }
  }

  return { deliveredCount, prunedCount, deliveredSids, undeliveredSids };
}

export async function dispatchTeamPushNotifications(params: {
  teamId: string;
  senderSid: string;
  senderName: string;
  kind: 'TEAM_MESSAGE' | 'WORKOUT_COMMENT' | 'ANNOUNCEMENT';
  channelScope?: TeamMessageChannelScope;
  eventGroup?: CoachEventGroup;
  customSubgroupId?: string;
  targetMembershipId?: string;
  announcementCategory?: TeamAnnouncementCategory;
  bodyText: string;
  clientLocalHour?: number;
  isEmergency?: boolean;
  excludeFallbackEmails?: string[];
  enableEmailFallback?: boolean;
  originUrl?: string;
}): Promise<{ deliveredCount: number; prunedCount: number; emailFallbackCount: number }> {
  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc) return { deliveredCount: 0, prunedCount: 0, emailFallbackCount: 0 };

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
    customSubgroupId: params.customSubgroupId,
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

  const pushRes = await dispatchPushPayloadToUsers({
    recipientSids,
    payload,
    isQuietHours: quietHours,
  });

  let emailFallbackCount = 0;
  const emailFallbackEnabled =
    policy?.enablePushEmailFallback !== false &&
    params.enableEmailFallback !== false &&
    (!quietHours || Boolean(params.isEmergency)) &&
    Boolean(testEmailFallbackSenderOverride || isResendConfigured());

  if (emailFallbackEnabled) {
    const undeliveredSet = new Set(pushRes.undeliveredSids);
    const deliveredSet = new Set(pushRes.deliveredSids);
    const senderMem = doc.memberships.find((m) => m.userSid === params.senderSid);
    const excludedEmails = new Set<string>(
      [
        senderMem?.invitedEmail,
        ...(params.excludeFallbackEmails || []),
      ]
        .filter((e): e is string => typeof e === 'string' && e.includes('@'))
        .map((e) => e.trim().toLowerCase())
    );

    const candidateEmails = new Set<string>();
    const subgroup =
      params.channelScope === 'CUSTOM_SUBGROUP' && params.customSubgroupId
        ? (doc.customSubgroups || []).find((g) => g.id === params.customSubgroupId)
        : undefined;
    const subgroupMembers = new Set(subgroup?.memberIds || []);

    for (const m of doc.memberships) {
      if (m.status === 'REVOKED' || m.status === 'ALUMNI') continue;
      if (m.userSid && m.userSid === params.senderSid) continue;

      const hadUndeliveredSid = Boolean(m.userSid && undeliveredSet.has(m.userSid));
      const hadDeliveredSid = Boolean(m.userSid && deliveredSet.has(m.userSid));
      if (hadDeliveredSid) continue;

      const parentEmailLower = m.invitedEmail?.trim().toLowerCase();
      const hasLinkedChildInSubgroup =
        Boolean(parentEmailLower) &&
        doc.memberships.some(
          (child) =>
            subgroupMembers.has(child.membershipId) &&
            child.parentGuardianEmail?.trim().toLowerCase() === parentEmailLower
        );

      const unlinkedParentInParentsScope =
        !m.userSid &&
        m.role === 'PARENT_FOLLOWER' &&
        (params.channelScope === 'PARENTS_ONLY' ||
          params.kind === 'ANNOUNCEMENT' ||
          (params.channelScope === 'CUSTOM_SUBGROUP' &&
            Boolean(subgroup) &&
            (subgroupMembers.has(m.membershipId) ||
              (subgroup!.includeLinkedParents !== false && hasLinkedChildInSubgroup))));

      const guardianAlreadyDeliveredByPush =
        Boolean(m.parentGuardianEmail) &&
        doc.memberships.some(
          (p) =>
            p.role === 'PARENT_FOLLOWER' &&
            Boolean(p.userSid && deliveredSet.has(p.userSid)) &&
            p.invitedEmail?.trim().toLowerCase() ===
              m.parentGuardianEmail?.trim().toLowerCase()
        );

      const includeGuardianForChild =
        !guardianAlreadyDeliveredByPush &&
        Boolean(m.parentGuardianEmail) &&
        (params.channelScope === 'PARENTS_ONLY' ||
          params.kind === 'ANNOUNCEMENT' ||
          (params.channelScope === 'CUSTOM_SUBGROUP' &&
            subgroup?.includeLinkedParents !== false &&
            subgroupMembers.has(m.membershipId)));

      if (hadUndeliveredSid || unlinkedParentInParentsScope) {
        const email = m.invitedEmail?.trim().toLowerCase();
        if (email && email.includes('@') && !excludedEmails.has(email)) {
          candidateEmails.add(email);
        }
      }

      if (includeGuardianForChild && m.parentGuardianEmail) {
        const guardianEmail = m.parentGuardianEmail.trim().toLowerCase();
        if (guardianEmail.includes('@') && !excludedEmails.has(guardianEmail)) {
          candidateEmails.add(guardianEmail);
        }
      }
    }

    const emailSender: EmailFallbackSenderFn =
      testEmailFallbackSenderOverride ||
      (async (emailReq) => {
        const res = await withBoundedTimeout(sendEmailViaResend(emailReq), 8000, 'push-email-fallback');
        return { delivered: res.delivered };
      });

    const cleanOrigin = (params.originUrl || 'https://meetready.app').replace(/\/+$/, '');
    const deepLink = `${cleanOrigin}${payload.url.startsWith('/') ? payload.url : `/${payload.url}`}`;
    const safeTitle = escapeHtml(payload.title);
    const safeBody = escapeHtml(payload.body);
    const safeLink = escapeHtml(deepLink);
    const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;line-height:1.5;color:#141413"><h2 style="margin:0 0 8px">${safeTitle}</h2><p style="margin:0 0 16px">${safeBody}</p><p><a href="${safeLink}" style="display:inline-block;padding:10px 16px;background:#0F172A;color:#D6FF2A;text-decoration:none;border-radius:8px;font-weight:700">Open in MeetReady</a></p><p style="font-size:12px;color:#555">Automatic email fallback delivered because push notifications are not active on your device.</p></div>`;
    const text = `${payload.title}\n\n${payload.body}\n\nOpen in MeetReady: ${deepLink}`;

    const cappedRecipients = Array.from(candidateEmails).slice(0, 50);
    if (cappedRecipients.length > 0) {
      const results = await Promise.allSettled(
        cappedRecipients.map((to) =>
          emailSender({
            to,
            subject: payload.title,
            html,
            text,
          })
        )
      );
      for (const item of results) {
        if (item.status === 'fulfilled' && item.value.delivered) {
          emailFallbackCount += 1;
        }
      }
    }
  }

  return {
    deliveredCount: pushRes.deliveredCount,
    prunedCount: pushRes.prunedCount,
    emailFallbackCount,
  };
}
