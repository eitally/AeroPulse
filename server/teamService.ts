import crypto from 'crypto';
import { escapeHtml, timingSafeStringEqual } from './securityUtils.ts';
import { resolveAthleteAgeTier } from '../src/physiology/ageAndComplianceEngine.ts';
import { normalizeAthleteMatchKey } from '../src/utils/athleticNetAndTfrrsEngine.ts';
import {
  appendAuditLogAsync,
  loadTenantVaultAsync,
  saveTenantVaultAsync,
  withTeamRowLock,
  withVaultLock,
} from './tokenVault.ts';
import {
  type ParsedBulkRosterRow,
  calibrateThresholdsFromSeedMark,
  generateTeamJoinCode,
  getOrgTypeSafeguardingDefaults,
  inferEventGroupFromSeedMark,
  normalizeHexColor,
  parseBulkRosterCsvOrText,
  sanitizeTargetEventGroups,
  slugifyTeamName,
} from '../src/physiology/teamOnboardingEngine.ts';
import type { CoachLandingAttribution } from '../src/utils/attribution.ts';
import {
  EMAIL_DIRECTORY_KEY,
  TEAMS_DIRECTORY_KEY,
  addTeamToUserIndex,
  hashToken,
  loadDirectory,
  projectTeamSummaryForCaller,
  sanitizeExternalSyncConfig,
  saveTeamDocRaw,
  teamDocVaultKey,
  userTeamsVaultKey,
  type EmailAccountDirectory,
  type StoredMembershipInternal,
  type StoredTeamDocument,
  type UserTeamsIndex,
} from './teamStoreCore.ts';
import {
  buildParentConsentEmailContent,
  buildTeamInviteEmailContent,
  isResendConfigured,
  sendEmailViaResend,
  withBoundedTimeout,
} from './teamEmailAndOtpService.ts';
import type {
  CoachDataSharingTier,
  CoachEventGroup,
  DistanceUnit,
  TeamBrandConfig,
  TeamExternalSyncConfig,
  TeamInvitePreviewPayload,
  TeamMembershipRecord,
  TeamOrgType,
  TeamSummaryWithRole,
} from '../src/types.ts';

export * from './teamStoreCore.ts';
export * from './teamEmailAndOtpService.ts';
export * from './teamWorkoutAndGovernanceService.ts';

export async function updateTeamMemberEmailsForUser(params: {
  callerSid?: string;
  oldEmail?: string;
  newEmail: string;
}): Promise<void> {
  const cleanNew = params.newEmail.trim().toLowerCase();
  const cleanOld = params.oldEmail?.trim().toLowerCase();
  if (!cleanNew) return;

  if (cleanOld && cleanOld !== cleanNew) {
    await withVaultLock(EMAIL_DIRECTORY_KEY, async () => {
      const emailDir = await loadTenantVaultAsync<EmailAccountDirectory>(EMAIL_DIRECTORY_KEY, {
        byEmail: {},
      });
      const existingEntry = emailDir.byEmail[cleanOld];
      if (existingEntry) {
        delete emailDir.byEmail[cleanOld];
        emailDir.byEmail[cleanNew] = {
          ...existingEntry,
          updatedAt: new Date().toISOString(),
        };
        await saveTenantVaultAsync(EMAIL_DIRECTORY_KEY, emailDir);
      }
    });
  }

  if (params.callerSid) {
    const idx = await loadTenantVaultAsync<UserTeamsIndex>(userTeamsVaultKey(params.callerSid), {
      teamIds: [],
      updatedAt: new Date().toISOString(),
    });
    if (idx.email !== cleanNew) {
      idx.email = cleanNew;
      idx.updatedAt = new Date().toISOString();
      await saveTenantVaultAsync(userTeamsVaultKey(params.callerSid), idx);
    }
    for (const teamId of idx.teamIds) {
      await withVaultLock(teamDocVaultKey(teamId), async () => {
        const doc = await loadTenantVaultAsync<StoredTeamDocument | null>(
          teamDocVaultKey(teamId),
          null
        );
        if (!doc) return;
        let changed = false;
        for (const m of doc.memberships) {
          if (m.userSid === params.callerSid && m.status !== 'REVOKED') {
            m.invitedEmail = cleanNew;
            changed = true;
          }
        }
        if (changed) {
          doc.updatedAt = new Date().toISOString();
          await saveTenantVaultAsync(teamDocVaultKey(teamId), doc);
        }
      });
    }
  }
}

/**
 * Seamlessly migrates any teams created or joined under a temporary pre-OAuth browser `sid`
 * onto a persistent identity `sid` when the user authenticates.
 */
export async function migrateAnonymousTeamsToSid(params: {
  oldSid?: string | null;
  newSid: string;
  athleteName?: string;
  stravaAthleteId?: string;
  email?: string;
}): Promise<void> {
  const { oldSid, newSid, athleteName, stravaAthleteId, email } = params;
  if (!oldSid || !newSid || oldSid === newSid) return;

  const oldIdx = await loadTenantVaultAsync<UserTeamsIndex>(userTeamsVaultKey(oldSid), {
    teamIds: [],
    updatedAt: '',
  });
  if (oldIdx.teamIds.length === 0) return;

  for (const teamId of oldIdx.teamIds) {
    const doc = await loadTenantVaultAsync<StoredTeamDocument | null>(
      teamDocVaultKey(teamId),
      null
    );
    if (!doc) continue;
    let changed = false;
    for (const m of doc.memberships) {
      if (m.userSid === oldSid && m.status !== 'REVOKED') {
        m.userSid = newSid;
        if (stravaAthleteId) m.stravaAthleteId = stravaAthleteId;
        if (email && !m.invitedEmail) m.invitedEmail = email;
        if (
          athleteName &&
          (!m.invitedName ||
            m.invitedName === 'Team Athlete' ||
            m.invitedName.toLowerCase().startsWith('anonymous'))
        ) {
          m.invitedName = athleteName.slice(0, 64);
        }
        changed = true;
      }
    }
    if (changed) {
      doc.updatedAt = new Date().toISOString();
      await saveTenantVaultAsync(teamDocVaultKey(teamId), doc);
      await addTeamToUserIndex(newSid, teamId, athleteName || oldIdx.displayName, email || oldIdx.email);
    }
  }
}

/**
 * Seamlessly migrates any teams created or joined under a temporary pre-OAuth browser `sid`
 * onto the deterministic Strava identity `sid` when the user completes Strava OAuth.
 */
export async function migrateAnonymousTeamsToStravaSid(params: {
  oldSid?: string | null;
  stravaSid: string;
  athleteName?: string;
  stravaAthleteId?: string;
}): Promise<void> {
  return migrateAnonymousTeamsToSid({
    oldSid: params.oldSid,
    newSid: params.stravaSid,
    athleteName: params.athleteName,
    stravaAthleteId: params.stravaAthleteId,
  });
}

function sanitizeCoachAttribution(raw?: unknown): CoachLandingAttribution | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const input = raw as Record<string, unknown>;
  const cleanField = (key: string, maxLen: number): string | undefined => {
    const val = input[key];
    if (typeof val !== 'string') return undefined;
    const trimmed = val.trim().slice(0, maxLen);
    return trimmed || undefined;
  };
  const out: CoachLandingAttribution = {
    ...(cleanField('utm_source', 80) ? { utm_source: cleanField('utm_source', 80) } : {}),
    ...(cleanField('utm_medium', 80) ? { utm_medium: cleanField('utm_medium', 80) } : {}),
    ...(cleanField('utm_campaign', 80) ? { utm_campaign: cleanField('utm_campaign', 80) } : {}),
    ...(cleanField('utm_content', 80) ? { utm_content: cleanField('utm_content', 80) } : {}),
    ...(cleanField('src', 80) ? { src: cleanField('src', 80) } : {}),
    ...(cleanField('landing_path', 120) ? { landing_path: cleanField('landing_path', 120) } : {}),
    ...(cleanField('selfReportedChannel', 60)
      ? { selfReportedChannel: cleanField('selfReportedChannel', 60) }
      : {}),
    ...(cleanField('capturedAt', 40) ? { capturedAt: cleanField('capturedAt', 40) } : {}),
  };
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function createTeamForCoach(params: {
  callerSid: string;
  originUrl: string;
  name: string;
  shortName?: string;
  mascotOrMotto?: string;
  orgType: TeamOrgType;
  primarySport?: 'Running' | 'Cycling' | 'Swimming' | 'Triathlon' | 'Hybrid';
  primaryHex?: string;
  secondaryHex?: string;
  logoDataUrl?: string;
  defaultSafeSportShield?: boolean;
  enableParentGuardianCc?: boolean;
  coachDisplayName?: string;
  coachEmail?: string;
  externalSync?: TeamExternalSyncConfig;
  attribution?: CoachLandingAttribution;
  coachEventGroups?: CoachEventGroup[];
}): Promise<TeamSummaryWithRole> {
  const dir = await loadDirectory();
  const orgType: TeamOrgType = params.orgType || 'HIGH_SCHOOL';
  const orgDefaults = getOrgTypeSafeguardingDefaults(orgType);

  const cleanName = String(params.name || '').trim().slice(0, 80) || 'Varsity Endurance';
  const cleanShort =
    String(params.shortName || '')
      .trim()
      .slice(0, 22) ||
    cleanName
      .split(/\s+/)
      .slice(0, 2)
      .join(' ')
      .toUpperCase()
      .slice(0, 14);

  let slug = slugifyTeamName(cleanName);
  if (dir.bySlug[slug]) {
    slug = `${slug}-${crypto.randomInt(10, 99)}`;
  }

  let joinCode = generateTeamJoinCode(cleanShort);
  if (dir.byJoinCode[joinCode]) {
    joinCode = generateTeamJoinCode(cleanShort, crypto.randomInt(10, 99));
  }

  const teamId = `tm_${crypto.randomBytes(8).toString('hex')}`;
  const nowIso = new Date().toISOString();

  // Safeguarding defaults automatically ON for High School unless explicitly overridden
  const defaultSafeSportShield =
    typeof params.defaultSafeSportShield === 'boolean'
      ? params.defaultSafeSportShield
      : orgDefaults.defaultSafeSportShield;
  const enableParentGuardianCc =
    typeof params.enableParentGuardianCc === 'boolean'
      ? params.enableParentGuardianCc
      : orgDefaults.enableParentGuardianCc;

  const safeLogo =
    params.logoDataUrl &&
    params.logoDataUrl.startsWith('data:image/') &&
    params.logoDataUrl.length <= 96_000
      ? params.logoDataUrl
      : undefined;

  const brand: TeamBrandConfig = {
    teamId,
    slug,
    joinCode,
    name: cleanName,
    shortName: cleanShort,
    mascotOrMotto: params.mascotOrMotto ? String(params.mascotOrMotto).trim().slice(0, 64) : undefined,
    orgType,
    primarySport: params.primarySport || orgDefaults.defaultPrimarySport,
    logoDataUrl: safeLogo,
    primaryHex: normalizeHexColor(params.primaryHex || '#14532D', '#14532D'),
    secondaryHex: normalizeHexColor(params.secondaryHex || '#D97706', '#D97706'),
    defaultSafeSportShield,
    enableParentGuardianCc,
    coachDisplayName:
      String(params.coachDisplayName || '').trim().slice(0, 48) || 'Head Coach',
    planTier: 'SANDBOX',
    ...(params.externalSync
      ? { externalSync: sanitizeExternalSyncConfig(params.externalSync) }
      : {}),
    createdAt: nowIso,
  };

  const cleanCoachEventGroups = sanitizeTargetEventGroups(params.coachEventGroups);
  const coachAttribution = sanitizeCoachAttribution(params.attribution);

  const coachMembership: StoredMembershipInternal = {
    membershipId: `mem_${crypto.randomBytes(6).toString('hex')}`,
    teamId,
    userSid: params.callerSid,
    role: 'HEAD_COACH',
    squadGroup: orgDefaults.defaultSquads[0] || 'Varsity',
    ...(cleanCoachEventGroups && cleanCoachEventGroups.length > 0
      ? { coachEventGroups: cleanCoachEventGroups }
      : {}),
    invitedName: brand.coachDisplayName,
    invitedEmail: params.coachEmail ? params.coachEmail.trim().toLowerCase() : undefined,
    isMinorU18: false,
    status: 'ACTIVE',
    invitedAt: nowIso,
    openedAt: nowIso,
    joinedAt: nowIso,
  };

  const doc: StoredTeamDocument = {
    brand,
    memberships: [coachMembership],
    broadcastWorkouts: [],
    ...(coachAttribution ? { coachAttribution } : {}),
    updatedAt: nowIso,
  };

  await withVaultLock(TEAMS_DIRECTORY_KEY, async () => {
    const latestDir = await loadDirectory();
    latestDir.bySlug[slug] = teamId;
    latestDir.byJoinCode[joinCode.toUpperCase()] = teamId;
    if (!latestDir.allTeamIds.includes(teamId)) latestDir.allTeamIds.push(teamId);
    await saveTeamDocRaw(teamId, doc);
    await saveTenantVaultAsync(TEAMS_DIRECTORY_KEY, latestDir);
  });
  await addTeamToUserIndex(
    params.callerSid,
    teamId,
    brand.coachDisplayName,
    params.coachEmail
  );
  await appendAuditLogAsync({
    teamId,
    actorSid: params.callerSid,
    action: 'TEAM_CREATED',
    targetId: teamId,
    metadata: { orgType, name: cleanName },
  });

  return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl)!;
}

export async function updateTeamBranding(params: {
  callerSid: string;
  teamId: string;
  originUrl: string;
  updates: Partial<
    Pick<
      TeamBrandConfig,
      | 'name'
      | 'shortName'
      | 'mascotOrMotto'
      | 'orgType'
      | 'primarySport'
      | 'logoDataUrl'
      | 'primaryHex'
      | 'secondaryHex'
      | 'defaultSafeSportShield'
      | 'enableParentGuardianCc'
      | 'coachDisplayName'
      | 'externalSync'
    >
  >;
}): Promise<TeamSummaryWithRole | null> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTenantVaultAsync<StoredTeamDocument | null>(
      teamDocVaultKey(params.teamId),
      null
    );
    if (!doc) return null;

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (
      !callerMem ||
      (callerMem.role !== 'HEAD_COACH' &&
        callerMem.role !== 'ASSISTANT_COACH' &&
        callerMem.role !== 'ORG_ADMIN')
    ) {
      return null;
    }

    const u = params.updates;
    if (u.name) doc.brand.name = String(u.name).trim().slice(0, 80);
    if (u.shortName) doc.brand.shortName = String(u.shortName).trim().slice(0, 22);
    if (typeof u.mascotOrMotto === 'string') {
      doc.brand.mascotOrMotto = u.mascotOrMotto.trim().slice(0, 64) || undefined;
    }
    if (u.orgType && callerMem.role === 'HEAD_COACH') doc.brand.orgType = u.orgType;
    if (u.primarySport) doc.brand.primarySport = u.primarySport;
    if (u.primaryHex) doc.brand.primaryHex = normalizeHexColor(u.primaryHex, doc.brand.primaryHex);
    if (u.secondaryHex) {
      doc.brand.secondaryHex = normalizeHexColor(u.secondaryHex, doc.brand.secondaryHex);
    }
    if (typeof u.defaultSafeSportShield === 'boolean') {
      if (u.defaultSafeSportShield || callerMem.role === 'HEAD_COACH') {
        doc.brand.defaultSafeSportShield = u.defaultSafeSportShield;
      }
    }
    if (typeof u.enableParentGuardianCc === 'boolean') {
      if (u.enableParentGuardianCc || callerMem.role === 'HEAD_COACH') {
        doc.brand.enableParentGuardianCc = u.enableParentGuardianCc;
      }
    }
    if (u.coachDisplayName && callerMem.role === 'HEAD_COACH') {
      doc.brand.coachDisplayName = String(u.coachDisplayName).trim().slice(0, 48);
    }
    if (u.externalSync) {
      doc.brand.externalSync = sanitizeExternalSyncConfig(u.externalSync, doc.brand.externalSync);
    }
    if (u.logoDataUrl === '') {
      doc.brand.logoDataUrl = undefined;
    } else if (
      u.logoDataUrl &&
      u.logoDataUrl.startsWith('data:image/') &&
      u.logoDataUrl.length <= 96_000
    ) {
      doc.brand.logoDataUrl = u.logoDataUrl;
    }

    doc.updatedAt = new Date().toISOString();
    await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);
    return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
  });
}

export async function bulkCreateAndSendInvites(params: {
  callerSid: string;
  teamId: string;
  originUrl: string;
  rawCsvOrText?: string;
  rows?: ParsedBulkRosterRow[];
  sendEmailsNow?: boolean;
}): Promise<{
  summary: TeamSummaryWithRole | null;
  addedCount: number;
  emailedCount: number;
  manualLinkCount: number;
  resendConfigured: boolean;
}> {
  const doc = await loadTenantVaultAsync<StoredTeamDocument | null>(
    teamDocVaultKey(params.teamId),
    null
  );
  if (!doc) {
    return {
      summary: null,
      addedCount: 0,
      emailedCount: 0,
      manualLinkCount: 0,
      resendConfigured: isResendConfigured(),
    };
  }

  const callerMem = doc.memberships.find(
    (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
  );
  if (
    !callerMem ||
    (callerMem.role !== 'HEAD_COACH' && callerMem.role !== 'ASSISTANT_COACH')
  ) {
    return {
      summary: null,
      addedCount: 0,
      emailedCount: 0,
      manualLinkCount: 0,
      resendConfigured: isResendConfigured(),
    };
  }

  const orgDefaults = getOrgTypeSafeguardingDefaults(doc.brand.orgType);
  const parsedRows: ParsedBulkRosterRow[] =
    Array.isArray(params.rows) && params.rows.length > 0
      ? params.rows
      : parseBulkRosterCsvOrText(
          params.rawCsvOrText || '',
          doc.brand.orgType,
          orgDefaults.defaultSquads[0] || 'Varsity'
        );

  const cleanOrigin = params.originUrl.replace(/\/+$/, '');
  const nowIso = new Date().toISOString();
  const pendingEmails: Array<{
    membershipId: string;
    to: string;
    cc?: string;
    subject: string;
    html: string;
    text: string;
  }> = [];

  const lockedResult = await withTeamRowLock(params.teamId, async () => {
    const latestDoc = await loadTenantVaultAsync<StoredTeamDocument | null>(
      teamDocVaultKey(params.teamId),
      null
    );
    if (!latestDoc) return null;

    let addedCount = 0;
    let manualLinkCount = 0;

    for (const row of parsedRows.slice(0, 400)) {
      const cleanEmail = row.invitedEmail?.trim().toLowerCase();
      if (
        cleanEmail &&
        latestDoc.memberships.some(
          (existing) =>
            existing.invitedEmail?.toLowerCase() === cleanEmail &&
            existing.status !== 'REVOKED'
        )
      ) {
        continue;
      }

      const rawToken = crypto.randomBytes(12).toString('base64url');
      const membershipId = `mem_${crypto.randomBytes(6).toString('hex')}`;
      const emailParam = cleanEmail ? `&email=${encodeURIComponent(cleanEmail)}` : '';
      const magicJoinUrl = `${cleanOrigin}/join/${latestDoc.brand.slug}?t=${rawToken}${emailParam}`;

      const parentCc =
        latestDoc.brand.enableParentGuardianCc && row.parentGuardianEmail
          ? row.parentGuardianEmail.trim().toLowerCase()
          : undefined;

      if (cleanEmail && params.sendEmailsNow !== false) {
        const emailContent = buildTeamInviteEmailContent({
          brand: latestDoc.brand,
          invitedName: row.invitedName,
          squadGroup: row.squadGroup || orgDefaults.defaultSquads[0] || 'Varsity',
          magicJoinUrl,
          hasParentCc: Boolean(parentCc),
          seedMarkOrFtp: row.seedMarkOrFtp,
        });
        pendingEmails.push({
          membershipId,
          to: cleanEmail,
          cc: parentCc,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        });
      } else {
        manualLinkCount += 1;
      }

      const resolvedEventGroup =
        row.eventGroup || inferEventGroupFromSeedMark(row.seedMarkOrFtp);
      latestDoc.memberships.push({
        membershipId,
        teamId: latestDoc.brand.teamId,
        role: 'ATHLETE',
        squadGroup: row.squadGroup || orgDefaults.defaultSquads[0] || 'Varsity',
        ...(resolvedEventGroup ? { eventGroup: resolvedEventGroup } : {}),
        ...(row.genderDivision ? { genderDivision: row.genderDivision } : {}),
        invitedName: String(row.invitedName || 'Team Athlete').trim().slice(0, 64),
        invitedEmail: cleanEmail,
        invitedPhone: row.invitedPhone,
        parentGuardianEmail: row.parentGuardianEmail?.trim().toLowerCase(),
        graduationYear: row.graduationYear,
        isMinorU18: Boolean(row.isMinorU18 || latestDoc.brand.orgType === 'HIGH_SCHOOL'),
        seedMarkOrFtp: row.seedMarkOrFtp,
        status: 'INVITED',
        emailDeliveryStatus: 'READY_MANUAL_LINK',
        rawInviteToken: rawToken,
        inviteTokenHash: hashToken(rawToken),
        invitedAt: nowIso,
      });
      addedCount += 1;
    }

    // Persist invite tokens BEFORE outbound email dispatch so timeouts never strand unpersisted magic links
    latestDoc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, latestDoc);
    return { latestDoc, addedCount, manualLinkCount };
  });

  if (!lockedResult) {
    return {
      summary: null,
      addedCount: 0,
      emailedCount: 0,
      manualLinkCount: 0,
      resendConfigured: isResendConfigured(),
    };
  }

  const { addedCount, manualLinkCount } = lockedResult;
  let emailedCount = 0;

  if (pendingEmails.length > 0) {
    const statusById = new Map<string, TeamMembershipRecord['emailDeliveryStatus']>();
    for (let i = 0; i < pendingEmails.length; i += 4) {
      const batch = pendingEmails.slice(i, i + 4);
      await Promise.all(
        batch.map(async (item) => {
          const sendRes = await sendEmailViaResend({
            to: item.to,
            cc: item.cc,
            subject: item.subject,
            html: item.html,
            text: item.text,
          });
          statusById.set(item.membershipId, sendRes.status);
          if (sendRes.delivered) emailedCount += 1;
        })
      );
    }

    await withTeamRowLock(params.teamId, async () => {
      const finalDoc = await loadTenantVaultAsync<StoredTeamDocument | null>(
        teamDocVaultKey(params.teamId),
        null
      );
      if (!finalDoc) return;
      for (const m of finalDoc.memberships) {
        const nextStatus = statusById.get(m.membershipId);
        if (nextStatus) m.emailDeliveryStatus = nextStatus;
      }
      finalDoc.updatedAt = new Date().toISOString();
      await saveTeamDocRaw(params.teamId, finalDoc);
    });
  }

  const finalDoc =
    (await loadTenantVaultAsync<StoredTeamDocument | null>(
      teamDocVaultKey(params.teamId),
      null
    )) || lockedResult.latestDoc;

  return {
    summary: projectTeamSummaryForCaller(finalDoc, params.callerSid, params.originUrl),
    addedCount,
    emailedCount,
    manualLinkCount,
    resendConfigured: isResendConfigured(),
  };
}

export async function resendPendingTeamInvites(params: {
  callerSid: string;
  teamId: string;
  originUrl: string;
  membershipId?: string; // Omit or 'ALL_PENDING' to nudge all pending
}): Promise<{
  summary: TeamSummaryWithRole | null;
  emailedCount: number;
  resendConfigured: boolean;
}> {
  const doc = await loadTenantVaultAsync<StoredTeamDocument | null>(
    teamDocVaultKey(params.teamId),
    null
  );
  if (!doc) return { summary: null, emailedCount: 0, resendConfigured: isResendConfigured() };

  const callerMem = doc.memberships.find(
    (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
  );
  if (
    !callerMem ||
    (callerMem.role !== 'HEAD_COACH' && callerMem.role !== 'ASSISTANT_COACH')
  ) {
    return { summary: null, emailedCount: 0, resendConfigured: isResendConfigured() };
  }

  const cleanOrigin = params.originUrl.replace(/\/+$/, '');
  let emailedCount = 0;

  for (const m of doc.memberships) {
    if (m.status === 'ACTIVE' || m.status === 'REVOKED' || !m.invitedEmail) continue;
    if (
      params.membershipId &&
      params.membershipId !== 'ALL_PENDING' &&
      m.membershipId !== params.membershipId
    ) {
      continue;
    }

    if (!m.rawInviteToken) {
      m.rawInviteToken = crypto.randomBytes(12).toString('base64url');
      m.inviteTokenHash = hashToken(m.rawInviteToken);
    }

    const emailParam = m.invitedEmail ? `&email=${encodeURIComponent(m.invitedEmail)}` : '';
    const magicJoinUrl = `${cleanOrigin}/join/${doc.brand.slug}?t=${m.rawInviteToken}${emailParam}`;
    const ccEmail =
      doc.brand.enableParentGuardianCc && m.parentGuardianEmail
        ? m.parentGuardianEmail
        : undefined;
    const emailContent = buildTeamInviteEmailContent({
      brand: doc.brand,
      invitedName: m.invitedName,
      squadGroup: m.squadGroup,
      magicJoinUrl,
      hasParentCc: Boolean(ccEmail),
      seedMarkOrFtp: m.seedMarkOrFtp,
    });

    const sendRes = await sendEmailViaResend({
      to: m.invitedEmail,
      cc: ccEmail,
      subject: `Reminder: ${emailContent.subject}`,
      html: emailContent.html,
      text: emailContent.text,
    });

    m.emailDeliveryStatus = sendRes.status;
    if (sendRes.delivered) emailedCount += 1;
  }

  doc.updatedAt = new Date().toISOString();
  await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);
  return {
    summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    emailedCount,
    resendConfigured: isResendConfigured(),
  };
}

export async function findTeamDocumentByCodeOrSlug(
  rawCodeOrSlug: string
): Promise<StoredTeamDocument | null> {
  const query = String(rawCodeOrSlug || '').trim();
  if (!query) return null;
  const dir = await loadDirectory();
  const teamId =
    dir.byJoinCode[query.toUpperCase()] ||
    dir.bySlug[query.toLowerCase()] ||
    dir.bySlug[slugifyTeamName(query)];
  if (!teamId) return null;
  return loadTenantVaultAsync<StoredTeamDocument | null>(teamDocVaultKey(teamId), null);
}

export async function previewTeamJoinInvite(
  codeOrSlug: string,
  inviteToken?: string,
  athleteEmail?: string
): Promise<TeamInvitePreviewPayload> {
  const doc = await findTeamDocumentByCodeOrSlug(codeOrSlug);
  if (!doc) return { found: false };

  let matchedMem: StoredMembershipInternal | undefined;
  const cleanEmail = athleteEmail?.trim().toLowerCase();

  if (inviteToken) {
    const targetHash = hashToken(inviteToken);
    matchedMem = doc.memberships.find(
      (m) => m.inviteTokenHash === targetHash && m.status !== 'REVOKED'
    );
  }

  // Primary CSV matching by server-verified athlete email if token didn't match or wasn't provided
  if (!matchedMem && cleanEmail) {
    matchedMem = doc.memberships.find(
      (m) => m.invitedEmail?.toLowerCase() === cleanEmail && m.status !== 'REVOKED'
    );
  }

  return {
    found: true,
    brand: doc.brand,
    membership: matchedMem
      ? {
          membershipId: matchedMem.membershipId,
          invitedName: matchedMem.invitedName,
          invitedEmail: matchedMem.invitedEmail,
          parentGuardianEmail: matchedMem.parentGuardianEmail,
          squadGroup: matchedMem.squadGroup,
          role: matchedMem.role,
          ...(matchedMem.coachSpecialtyTitle
            ? { coachSpecialtyTitle: matchedMem.coachSpecialtyTitle }
            : {}),
          isMinorU18: matchedMem.isMinorU18,
          birthYear: matchedMem.birthYear,
          parentConsentStatus: matchedMem.parentConsentStatus,
          seedMarkOrFtp: matchedMem.seedMarkOrFtp,
        }
      : undefined,
  };
}

export async function claimTeamJoinInvite(params: {
  callerSid: string;
  originUrl: string;
  codeOrSlug: string;
  inviteToken?: string;
  athleteName?: string;
  athleteEmail?: string;
  stravaAthleteId?: string;
  squadGroup?: string;
  seedMarkOrFtp?: string;
  distanceUnit?: DistanceUnit;
  sharingTier?: CoachDataSharingTier;
  birthYear?: number;
  birthMonthYear?: string;
  graduationYear?: number;
  parentGuardianEmail?: string;
  deferParentEmail?: boolean;
}): Promise<{
  ok: boolean;
  summary?: TeamSummaryWithRole;
  calibrated?: ReturnType<typeof calibrateThresholdsFromSeedMark>;
  safeSportShieldEnforced?: boolean;
  error?: string;
}> {
  const initialDoc = await findTeamDocumentByCodeOrSlug(params.codeOrSlug);
  if (!initialDoc) {
    return {
      ok: false,
      error: 'No team matched that Join Code or link. Check the 6-character code with your coach.',
    };
  }

  let pendingConsentEmail: { to: string; subject: string; html: string; text: string } | null = null;

  const lockedResult = await withTeamRowLock(initialDoc.brand.teamId, async () => {
    const doc =
      (await loadTenantVaultAsync<StoredTeamDocument | null>(
        teamDocVaultKey(initialDoc.brand.teamId),
        null
      )) || initialDoc;

    const nowIso = new Date().toISOString();
    const cleanEmail = params.athleteEmail?.trim().toLowerCase();
    const cleanNameLower = params.athleteName?.trim().toLowerCase().replace(/\s+/g, ' ');
    const normClaimNameKey = params.athleteName
      ? normalizeAthleteMatchKey(params.athleteName)
      : '';
    const cleanStravaId = params.stravaAthleteId?.trim();
    let mem: StoredMembershipInternal | undefined;

    if (params.inviteToken) {
      const targetHash = hashToken(params.inviteToken);
      mem = doc.memberships.find(
        (m) =>
          m.inviteTokenHash === targetHash &&
          m.status !== 'REVOKED' &&
          (!m.userSid || m.userSid === params.callerSid)
      );
    }
    // 1. Primary CSV match: email address (athletes or invited staff, unclaimed or own row)
    if (!mem && cleanEmail) {
      mem = doc.memberships.find(
        (m) =>
          m.invitedEmail?.toLowerCase() === cleanEmail &&
          m.status !== 'REVOKED' &&
          (!m.userSid || m.userSid === params.callerSid)
      );
    }
    // 2. Caller SID match (reconnecting or updating settings)
    if (!mem) {
      mem = doc.memberships.find(
        (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
      );
    }
    // 3. Secondary fallback: verified Strava athlete ID (athletes only, unclaimed or own row)
    if (!mem && cleanStravaId) {
      mem = doc.memberships.find(
        (m) =>
          m.role === 'ATHLETE' &&
          m.stravaAthleteId === cleanStravaId &&
          m.status !== 'REVOKED' &&
          (!m.userSid || m.userSid === params.callerSid)
      );
    }
    // 4. Tertiary fallback: normalized athlete full name (only rows with no invitedEmail, strips diacritics & handles "Last, First")
    if (!mem && cleanNameLower && cleanNameLower !== 'team athlete' && cleanNameLower !== 'athlete') {
      const unclaimed = doc.memberships.filter(
        (m) =>
          (m.status === 'INVITED' || m.status === 'OPENED') &&
          !m.userSid &&
          !m.invitedEmail &&
          m.role === 'ATHLETE'
      );
      const exactMatches = unclaimed.filter(
        (m) =>
          m.invitedName.trim().toLowerCase().replace(/\s+/g, ' ') === cleanNameLower ||
          (normClaimNameKey && normalizeAthleteMatchKey(m.invitedName) === normClaimNameKey)
      );
      if (exactMatches.length === 1) {
        mem = exactMatches[0];
      } else if (exactMatches.length > 1 && params.graduationYear) {
        mem = exactMatches.find((m) => m.graduationYear === params.graduationYear);
      } else if (normClaimNameKey) {
        // Unambiguous last-name + graduationYear match (e.g. "Luke Alvarez" vs "Lucas Alvarez" '27)
        const parts = normClaimNameKey.split(' ').filter(Boolean);
        const lastName = parts[parts.length - 1];
        if (lastName && lastName.length >= 3 && params.graduationYear) {
          const lastNameMatches = unclaimed.filter((m) => {
            const mParts = normalizeAthleteMatchKey(m.invitedName).split(' ').filter(Boolean);
            return (
              mParts[mParts.length - 1] === lastName &&
              m.graduationYear === params.graduationYear
            );
          });
          if (lastNameMatches.length === 1) {
            mem = lastNameMatches[0];
          }
        }
      }
    }

    const isStaffInvite = Boolean(mem && mem.role !== 'ATHLETE');

    // Evaluate COPPA (<13) and Minor/Adult (13-17 vs 18+) before mutating roster
    // Prefer existing stored DOB over incoming payload so a minor cannot overwrite DOB to 18+.
    const ageCheck = isStaffInvite
      ? {
          ageTier: 'ADULT_18_PLUS' as const,
          isUnder13: false,
          isMinorU18: false,
          birthYear: undefined,
          birthMonthYear: undefined,
        }
      : resolveAthleteAgeTier({
          birthMonthYear: mem?.birthMonthYear || params.birthMonthYear,
          birthYear: mem?.birthYear ?? params.birthYear,
          orgType: doc.brand.orgType,
          graduationYear: params.graduationYear ?? mem?.graduationYear,
        });

    if (ageCheck.isUnder13) {
      return {
        ok: false,
        error:
          'MeetReady accounts require athletes to be 13 or older (COPPA). Coaches can time U13 athletes watchlessly using Trackside Stopwatch without child accounts.',
      };
    }

    const effectiveParentEmail = isStaffInvite
      ? undefined
      : params.parentGuardianEmail?.trim().toLowerCase() ||
        mem?.parentGuardianEmail?.trim().toLowerCase();

    if (
      !isStaffInvite &&
      (ageCheck.ageTier === 'YOUTH_13_17' ||
        (ageCheck.ageTier === 'UNKNOWN' && doc.brand.orgType === 'HIGH_SCHOOL')) &&
      !effectiveParentEmail &&
      !params.deferParentEmail
    ) {
      return {
        ok: false,
        error: 'Parent or guardian email is required for athletes aged 13–17.',
      };
    }

    const orgDefaults = getOrgTypeSafeguardingDefaults(doc.brand.orgType);
    const isMinor = isStaffInvite
      ? false
      : ageCheck.ageTier === 'UNKNOWN'
        ? Boolean(doc.brand.orgType === 'HIGH_SCHOOL' || mem?.isMinorU18)
        : ageCheck.isMinorU18;
    const isDeferredMinorParentEmail = Boolean(
      isMinor && !effectiveParentEmail && params.deferParentEmail
    );
    const resolvedSharingTier: CoachDataSharingTier = isStaffInvite
      ? 'FULL_STREAMS'
      : isDeferredMinorParentEmail
        ? 'LOAD_ONLY'
        : params.sharingTier || 'SUMMARY_ONLY';

    if (!mem) {
      mem = {
        membershipId: `mem_${crypto.randomBytes(6).toString('hex')}`,
        teamId: doc.brand.teamId,
        userSid: params.callerSid,
        stravaAthleteId: cleanStravaId,
        sharingTier: resolvedSharingTier,
        role: 'ATHLETE',
        squadGroup:
          params.squadGroup?.trim() || orgDefaults.defaultSquads[0] || 'Varsity',
        ...(inferEventGroupFromSeedMark(params.seedMarkOrFtp)
          ? { eventGroup: inferEventGroupFromSeedMark(params.seedMarkOrFtp) }
          : {}),
        invitedName:
          params.athleteName?.trim().slice(0, 64) || 'Team Athlete',
        invitedEmail: cleanEmail,
        graduationYear: params.graduationYear,
        isMinorU18: isMinor,
        seedMarkOrFtp: params.seedMarkOrFtp?.trim(),
        status: 'ACTIVE',
        invitedAt: nowIso,
        openedAt: nowIso,
        joinedAt: nowIso,
      };
      doc.memberships.push(mem);
    } else {
      mem.userSid = params.callerSid;
      if (cleanStravaId) mem.stravaAthleteId = cleanStravaId;
      if (isStaffInvite) mem.sharingTier = 'FULL_STREAMS';
      else if (isDeferredMinorParentEmail) mem.sharingTier = 'LOAD_ONLY';
      else if (params.sharingTier) mem.sharingTier = params.sharingTier;
      else if (!mem.sharingTier) mem.sharingTier = 'SUMMARY_ONLY';
      if (params.athleteName?.trim()) {
        mem.invitedName = params.athleteName.trim().slice(0, 64);
      }
      if (cleanEmail && !mem.invitedEmail) {
        mem.invitedEmail = cleanEmail;
      }
      if (params.squadGroup?.trim()) {
        mem.squadGroup = params.squadGroup.trim();
      }
      if (params.graduationYear) {
        mem.graduationYear = params.graduationYear;
      }
      if (params.seedMarkOrFtp?.trim()) {
        mem.seedMarkOrFtp = params.seedMarkOrFtp.trim();
        if (!mem.eventGroup) {
          const inferredGroup = inferEventGroupFromSeedMark(mem.seedMarkOrFtp);
          if (inferredGroup) mem.eventGroup = inferredGroup;
        }
      }
      mem.status = 'ACTIVE';
      if (!mem.openedAt) mem.openedAt = nowIso;
      if (!mem.joinedAt) mem.joinedAt = nowIso;
    }

    mem.isMinorU18 = isMinor;
    if (ageCheck.birthMonthYear && !mem.birthMonthYear) {
      mem.birthMonthYear = ageCheck.birthMonthYear;
    }
    if (ageCheck.birthYear && ageCheck.birthYear > 1900 && !mem.birthYear) {
      mem.birthYear = ageCheck.birthYear;
    }
    if (ageCheck.ageTier === 'ADULT_18_PLUS') {
      // 18+ athletes own their account; remove mandatory minor guardian requirement
      mem.parentGuardianEmail = undefined;
      mem.parentConsentToken = undefined;
      mem.parentConsentTokenHash = undefined;
      mem.parentConsentStatus = 'NOT_REQUIRED';
    } else if (effectiveParentEmail) {
      mem.parentGuardianEmail = effectiveParentEmail;
    }

    // If athlete is minor and has a parent/guardian email, trigger parent consent notification
    if (mem.isMinorU18 && mem.parentGuardianEmail) {
      let rawConsentToken = '';
      if (!mem.parentConsentTokenHash) {
        rawConsentToken = crypto.randomBytes(16).toString('base64url');
        mem.parentConsentTokenHash = hashToken(rawConsentToken);
        mem.parentConsentToken = undefined;
      }
      if (!mem.parentConsentStatus || mem.parentConsentStatus === 'NOT_REQUIRED') {
        mem.parentConsentStatus = 'PENDING';
      }

      if (rawConsentToken) {
        const cleanOrigin = params.originUrl.replace(/\/+$/, '');
        const consentUrl = `${cleanOrigin}/api/teams/parent-consent?token=${rawConsentToken}`;
        const emailContent = buildParentConsentEmailContent({
          brand: doc.brand,
          athleteName: mem.invitedName,
          parentConsentUrl: consentUrl,
        });

        pendingConsentEmail = {
          to: mem.parentGuardianEmail,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        };
      }
    } else if (!mem.parentConsentStatus) {
      mem.parentConsentStatus = mem.isMinorU18 ? 'PENDING' : 'NOT_REQUIRED';
    }

    const safeSportShieldEnforced = Boolean(
      doc.brand.defaultSafeSportShield || mem.isMinorU18
    );
    const calibrated = calibrateThresholdsFromSeedMark(
      mem.seedMarkOrFtp || params.seedMarkOrFtp || '',
      doc.brand.primarySport,
      params.distanceUnit || 'mi'
    );

    if (!mem.liveSnapshot) {
      mem.liveSnapshot = {
        updatedAt: nowIso,
        hasConnectedWatch: false,
        verdictLabel: 'Joined · Awaiting First Sync',
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
        sharingTier: mem.sharingTier,
      };
    } else {
      if (params.seedMarkOrFtp?.trim()) {
        mem.liveSnapshot.ftpWatts = calibrated.cyclingFtpWatts;
        mem.liveSnapshot.thresholdPaceSecsPerKm = calibrated.thresholdPaceSecsPerKm;
      }
      mem.liveSnapshot.sharingTier = mem.sharingTier;
    }

    doc.updatedAt = nowIso;
    await saveTeamDocRaw(doc.brand.teamId, doc);
    await addTeamToUserIndex(
      params.callerSid,
      doc.brand.teamId,
      mem.invitedName,
      mem.invitedEmail
    );
    await appendAuditLogAsync({
      teamId: doc.brand.teamId,
      actorSid: params.callerSid,
      action: 'MEMBER_JOINED',
      targetId: mem.membershipId,
      metadata: {
        role: mem.role,
        isMinorU18: mem.isMinorU18,
        parentConsentStatus: mem.parentConsentStatus,
      },
    });

    return {
      ok: true,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl)!,
      calibrated,
      safeSportShieldEnforced,
    };
  });

  if (lockedResult.ok && pendingConsentEmail) {
    const emailToSend = pendingConsentEmail as {
      to: string;
      subject: string;
      html: string;
      text: string;
    };
    await Promise.allSettled([
      withBoundedTimeout(sendEmailViaResend(emailToSend), 8000, 'parent-consent-email'),
    ]);
  }

  return lockedResult;
}

export async function acknowledgeParentConsent(token: string): Promise<{
  ok: boolean;
  athleteName?: string;
  teamName?: string;
  coachName?: string;
  sport?: string;
  parentEmail?: string;
  acknowledgedAt?: string;
  alreadyAcknowledged?: boolean;
  error?: string;
}> {
  const cleanToken = String(token || '').trim();
  if (!cleanToken) {
    return { ok: false, error: 'Invalid or missing parent consent token.' };
  }

  const targetHash = hashToken(cleanToken);
  const dir = await loadDirectory();
  for (const teamId of dir.allTeamIds) {
    const doc = await loadTenantVaultAsync<StoredTeamDocument | null>(
      teamDocVaultKey(teamId),
      null
    );
    if (!doc) continue;

    const mem = doc.memberships.find(
      (m) =>
        m.status !== 'REVOKED' &&
        ((m.parentConsentTokenHash && timingSafeStringEqual(m.parentConsentTokenHash, targetHash)) ||
          (m.parentConsentToken && timingSafeStringEqual(m.parentConsentToken, cleanToken)))
    );
    if (mem) {
      return withTeamRowLock(teamId, async () => {
        const freshDoc =
          (await loadTenantVaultAsync<StoredTeamDocument | null>(
            teamDocVaultKey(teamId),
            null
          )) || doc;
        const lockedMem = freshDoc.memberships.find((m) => m.membershipId === mem.membershipId);
        if (!lockedMem) return { ok: false, error: 'Membership not found.' };
        const wasAcknowledged = lockedMem.parentConsentStatus === 'ACKNOWLEDGED';
        if (!wasAcknowledged) {
          lockedMem.parentConsentStatus = 'ACKNOWLEDGED';
          lockedMem.parentConsentAt = new Date().toISOString();
          freshDoc.updatedAt = lockedMem.parentConsentAt;
          await saveTeamDocRaw(teamId, freshDoc);
          await appendAuditLogAsync({
            teamId,
            actorSid: lockedMem.parentGuardianEmail || 'guardian',
            action: 'PARENT_CONSENT_ACKNOWLEDGED',
            targetId: lockedMem.membershipId,
            metadata: { athleteName: lockedMem.invitedName },
          });
        }
        return {
          ok: true,
          athleteName: lockedMem.invitedName,
          teamName: freshDoc.brand.name,
          coachName: freshDoc.brand.coachDisplayName,
          sport: freshDoc.brand.primarySport,
          parentEmail: lockedMem.parentGuardianEmail,
          acknowledgedAt: lockedMem.parentConsentAt,
          alreadyAcknowledged: wasAcknowledged,
        };
      });
    }
  }

  return { ok: false, error: 'Invalid or expired parent consent link.' };
}
