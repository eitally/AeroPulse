import crypto from 'crypto';
import { sanitizeTelemetryForCleanRoom } from './cleanRoomFirewall.ts';
import { escapeHtml } from './securityUtils.ts';
import {
  loadTenantVaultAsync,
  saveTenantVaultSync,
} from './tokenVault.ts';
import {
  type ParsedBulkRosterRow,
  calibrateThresholdsFromSeedMark,
  computeAccessibleTeamPalette,
  generateTeamJoinCode,
  getOrgTypeSafeguardingDefaults,
  normalizeHexColor,
  parseBulkRosterCsvOrText,
  slugifyTeamName,
} from '../src/physiology/teamOnboardingEngine.ts';
import type {
  SportCategory,
  TeamAthleteLiveSnapshot,
  TeamBrandConfig,
  TeamBroadcastWorkout,
  TeamInvitePreviewPayload,
  TeamMemberRole,
  TeamMembershipRecord,
  TeamOrgType,
  TeamSummaryWithRole,
} from '../src/types.ts';

interface TeamsDirectoryIndex {
  bySlug: Record<string, string>;
  byJoinCode: Record<string, string>;
  allTeamIds: string[];
}

interface StoredMembershipInternal extends TeamMembershipRecord {
  rawInviteToken?: string;
  inviteTokenHash?: string;
}

interface StoredTeamDocument {
  brand: TeamBrandConfig;
  memberships: StoredMembershipInternal[];
  broadcastWorkouts: TeamBroadcastWorkout[];
  updatedAt: string;
}

interface UserTeamsIndex {
  teamIds: string[];
  email?: string;
  displayName?: string;
  updatedAt: string;
}

interface EmailAccountDirectory {
  byEmail: Record<
    string,
    {
      sid: string;
      displayName?: string;
      updatedAt: string;
    }
  >;
}

interface StoredEmailOtpRecord {
  email: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
}

const TEAMS_DIRECTORY_KEY = 'teams_index_v1';
const EMAIL_DIRECTORY_KEY = 'users_email_idx_v1';

function teamDocVaultKey(teamId: string): string {
  return `team_doc_${teamId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}`;
}

function userTeamsVaultKey(sid: string): string {
  return `user_teams_${sid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)}`;
}

function emailOtpVaultKey(email: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(email.trim().toLowerCase())
    .digest('hex')
    .slice(0, 24);
  return `email_otp_${hash}`;
}

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

export function isResendConfigured(): boolean {
  return Boolean((process.env.RESEND_API_KEY || '').trim());
}

export async function sendEmailViaResend(params: {
  to: string;
  cc?: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{
  delivered: boolean;
  status: 'SENT_RESEND' | 'READY_MANUAL_LINK' | 'FAILED';
  messageId?: string;
  error?: string;
}> {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) {
    return {
      delivered: false,
      status: 'READY_MANUAL_LINK',
    };
  }

  const fromAddress = (
    process.env.RESEND_FROM_EMAIL || 'THRESH Coaching <onboarding@resend.dev>'
  ).trim();

  try {
    const payload: Record<string, unknown> = {
      from: fromAddress,
      to: [params.to.trim()],
      subject: params.subject,
      html: params.html,
      text: params.text,
    };
    if (params.cc && params.cc.includes('@')) {
      payload.cc = [params.cc.trim()];
    }

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      return {
        delivered: false,
        status: 'FAILED',
        error: `Resend HTTP ${resp.status}: ${errBody.slice(0, 180)}`,
      };
    }

    const data = (await resp.json().catch(() => ({}))) as { id?: string };
    return {
      delivered: true,
      status: 'SENT_RESEND',
      messageId: data.id,
    };
  } catch (err) {
    return {
      delivered: false,
      status: 'FAILED',
      error: err instanceof Error ? err.message : 'Network error contacting Resend API',
    };
  }
}

function buildTeamInviteEmailContent(params: {
  brand: TeamBrandConfig;
  invitedName: string;
  squadGroup: string;
  magicJoinUrl: string;
  hasParentCc: boolean;
  seedMarkOrFtp?: string;
}): { subject: string; html: string; text: string } {
  const { brand, invitedName, squadGroup, magicJoinUrl, hasParentCc, seedMarkOrFtp } = params;
  const palette = computeAccessibleTeamPalette(brand.primaryHex, brand.secondaryHex);
  const firstName = invitedName.trim().split(/\s+/)[0] || 'Athlete';
  const safeFirstName = escapeHtml(firstName);
  const safeTeamName = escapeHtml(brand.name);
  const safeShortName = escapeHtml(brand.shortName || brand.name);
  const safeCoach = escapeHtml(brand.coachDisplayName);
  const safeSquad = escapeHtml(squadGroup || 'Roster');
  const safeCode = escapeHtml(brand.joinCode);
  const safeUrl = escapeHtml(magicJoinUrl);
  const safeSeed = seedMarkOrFtp ? escapeHtml(seedMarkOrFtp) : '';

  const subject = `Coach ${brand.coachDisplayName} invited ${firstName} to join ${brand.name} on THRESH`;

  const safeSportSection =
    brand.defaultSafeSportShield || hasParentCc
      ? `<div style="margin-top:20px;padding:14px 16px;border-radius:12px;background:#ECFDF5;border:1px solid #A7F3D0;color:#065F46;font-size:13px;line-height:1.5;">
          <strong>Scholastic &amp; Safe-Sport Protections Enabled:</strong>
          <ul style="margin:6px 0 0;padding-left:18px;">
            <li>Body weight &amp; W/kg metrics are masked by default to support healthy youth development.</li>
            <li>No paid GPS watch required — athletes can calibrate zones from a single track/XC race mark or upload <code>.FIT</code> files.</li>
            ${hasParentCc ? '<li>A parent/guardian was transparently CC&apos;d on this roster invitation by the coaching staff.</li>' : ''}
          </ul>
        </div>`
      : '';

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#F7F6F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111318;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:20px;overflow:hidden;border:1px solid #E5E7EB;">
    <div style="background:linear-gradient(135deg, ${palette.primaryOnLight} 0%, ${palette.secondaryOnLight} 100%);padding:24px 28px;color:#FFFFFF;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.9;">${safeShortName} × THRESH</div>
      <h1 style="margin:6px 0 2px;font-size:22px;font-weight:800;letter-spacing:-0.02em;">${safeTeamName}</h1>
      <div style="font-size:13px;opacity:0.92;">Coach ${safeCoach} · ${safeSquad}</div>
    </div>
    <div style="padding:28px;">
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">Hi <strong>${safeFirstName}</strong>,</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#374151;">
        Coach <strong>${safeCoach}</strong> added you to <strong>${safeTeamName}</strong> (${safeSquad}) on THRESH for daily training readiness, workout pacing pods, and post-workout performance analysis.
        ${safeSeed ? `<br/><span style="color:#065F46;font-size:13px;">Your initial zones are pre-seeded from <strong>${safeSeed}</strong>.</span>` : ''}
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${safeUrl}" style="display:inline-block;padding:14px 26px;border-radius:12px;background:${palette.primaryOnLight};color:${palette.textOnPrimaryLight};text-decoration:none;font-weight:700;font-size:15px;">
          Accept Invite &amp; Join ${safeShortName} &rarr;
        </a>
      </div>
      <div style="padding:12px 16px;border-radius:12px;background:#F3F4F6;text-align:center;font-size:13px;color:#4B5563;">
        Or enter Team Join Code: <strong style="font-family:monospace;font-size:16px;color:#111318;letter-spacing:0.06em;">${safeCode}</strong>
      </div>
      ${safeSportSection}
    </div>
  </div>
</body>
</html>`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `Coach ${brand.coachDisplayName} invited you to join ${brand.name} (${squadGroup}) on THRESH.`,
    `Tap your personalized link to join in 45 seconds: ${magicJoinUrl}`,
    `Team Join Code: ${brand.joinCode}`,
    brand.defaultSafeSportShield
      ? `Safe-Sport Protection: Body weight & W/kg are hidden by default.`
      : ``,
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, html, text };
}

// ============================================================================
// Cross-Device 6-Digit Email OTP Sign-In (Resend)
// ============================================================================

export async function requestEmailOtpCode(rawEmail: string): Promise<{
  ok: boolean;
  deliveryStatus: 'SENT_RESEND' | 'READY_MANUAL_LINK' | 'FAILED';
  devPreviewCode?: string;
  error?: string;
}> {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, deliveryStatus: 'FAILED', error: 'Enter a valid email address.' };
  }

  const code = String(crypto.randomInt(100000, 999999));
  const record: StoredEmailOtpRecord = {
    email,
    codeHash: hashToken(`${email}:${code}`),
    expiresAt: Date.now() + 10 * 60 * 1000,
    attempts: 0,
  };
  saveTenantVaultSync(emailOtpVaultKey(email), record);

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:460px;margin:0 auto;padding:24px;border:1px solid #E5E7EB;border-radius:16px;background:#FFFFFF;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:#D9480F;text-transform:uppercase;">THRESH CROSS-DEVICE SIGN-IN</div>
    <h2 style="margin:8px 0 12px;color:#111318;">Your 6-Digit Verification Code</h2>
    <div style="font-family:monospace;font-size:32px;font-weight:800;letter-spacing:0.16em;padding:14px 20px;background:#F3F4F6;border-radius:12px;text-align:center;color:#111318;">${escapeHtml(code)}</div>
    <p style="font-size:13px;color:#4B5563;margin-top:14px;">Expires in 10 minutes. Enter this code in THRESH to sync your teams and athlete profile across devices.</p>
  </div>`;

  const res = await sendEmailViaResend({
    to: email,
    subject: `${code} is your THRESH sign-in code`,
    html,
    text: `Your THRESH verification code is ${code} (expires in 10 minutes).`,
  });

  const isLocalDev = process.env.NODE_ENV !== 'production' && !process.env.VERCEL;
  return {
    ok: res.status !== 'FAILED',
    deliveryStatus: res.status,
    ...(res.status === 'READY_MANUAL_LINK' && isLocalDev ? { devPreviewCode: code } : {}),
    ...(res.error ? { error: res.error } : {}),
  };
}

export async function verifyEmailOtpCode(
  rawEmail: string,
  rawCode: string,
  preferredSid?: string
): Promise<{
  ok: boolean;
  sid?: string;
  email?: string;
  displayName?: string;
  error?: string;
}> {
  const email = String(rawEmail || '').trim().toLowerCase();
  const code = String(rawCode || '').replace(/\D/g, '');
  if (!email || code.length !== 6) {
    return { ok: false, error: 'Enter the 6-digit verification code.' };
  }

  const key = emailOtpVaultKey(email);
  const stored = await loadTenantVaultAsync<StoredEmailOtpRecord | null>(key, null);
  if (!stored || Date.now() > stored.expiresAt) {
    return { ok: false, error: 'Verification code expired. Request a fresh code.' };
  }
  if (stored.attempts >= 5) {
    return { ok: false, error: 'Too many attempts. Request a fresh code.' };
  }

  const candidateHash = hashToken(`${email}:${code}`);
  const a = Buffer.from(candidateHash);
  const b = Buffer.from(stored.codeHash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    stored.attempts += 1;
    saveTenantVaultSync(key, stored);
    return { ok: false, error: 'Incorrect 6-digit code.' };
  }

  // Consume OTP
  saveTenantVaultSync(key, { ...stored, expiresAt: 0 });

  // Bind or retrieve persistent sid for this email
  const emailDir = await loadTenantVaultAsync<EmailAccountDirectory>(EMAIL_DIRECTORY_KEY, {
    byEmail: {},
  });
  let account = emailDir.byEmail[email];
  if (!account) {
    const newSid =
      preferredSid && /^[a-f0-9]{24,64}$/i.test(preferredSid)
        ? preferredSid
        : crypto.randomBytes(16).toString('hex');
    account = {
      sid: newSid,
      updatedAt: new Date().toISOString(),
    };
    emailDir.byEmail[email] = account;
    saveTenantVaultSync(EMAIL_DIRECTORY_KEY, emailDir);
  }

  // Auto-link any pending team invites addressed to this email!
  const dir = await loadTenantVaultAsync<TeamsDirectoryIndex>(TEAMS_DIRECTORY_KEY, {
    bySlug: {},
    byJoinCode: {},
    allTeamIds: [],
  });
  const userTeams = await loadTenantVaultAsync<UserTeamsIndex>(
    userTeamsVaultKey(account.sid),
    {
      teamIds: [],
      email,
      updatedAt: new Date().toISOString(),
    }
  );
  userTeams.email = email;

  for (const teamId of dir.allTeamIds) {
    const doc = await loadTenantVaultAsync<StoredTeamDocument | null>(
      teamDocVaultKey(teamId),
      null
    );
    if (!doc) continue;
    let mutated = false;
    for (const m of doc.memberships) {
      if (
        m.invitedEmail &&
        m.invitedEmail.toLowerCase() === email &&
        m.status !== 'REVOKED'
      ) {
        m.userSid = account.sid;
        if (m.status !== 'ACTIVE') {
          m.status = 'ACTIVE';
          m.joinedAt = new Date().toISOString();
        }
        if (!account.displayName && m.invitedName) {
          account.displayName = m.invitedName;
        }
        if (!userTeams.teamIds.includes(teamId)) {
          userTeams.teamIds.push(teamId);
        }
        mutated = true;
      }
    }
    if (mutated) {
      doc.updatedAt = new Date().toISOString();
      saveTenantVaultSync(teamDocVaultKey(teamId), doc);
    }
  }

  userTeams.updatedAt = new Date().toISOString();
  saveTenantVaultSync(userTeamsVaultKey(account.sid), userTeams);
  emailDir.byEmail[email] = account;
  saveTenantVaultSync(EMAIL_DIRECTORY_KEY, emailDir);

  return {
    ok: true,
    sid: account.sid,
    email,
    displayName: account.displayName,
  };
}

// ============================================================================
// Multi-Team Creation, Branding, Bulk Invites, Claiming & Clean-Room Sync
// ============================================================================

async function loadDirectory(): Promise<TeamsDirectoryIndex> {
  return loadTenantVaultAsync<TeamsDirectoryIndex>(TEAMS_DIRECTORY_KEY, {
    bySlug: {},
    byJoinCode: {},
    allTeamIds: [],
  });
}

async function addTeamToUserIndex(
  sid: string,
  teamId: string,
  displayName?: string,
  email?: string
): Promise<void> {
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
  saveTenantVaultSync(userTeamsVaultKey(sid), idx);
}

function projectTeamSummaryForCaller(
  doc: StoredTeamDocument,
  callerSid: string,
  originUrl: string
): TeamSummaryWithRole | null {
  const myMembership = doc.memberships.find(
    (m) => m.userSid === callerSid && m.status !== 'REVOKED'
  );
  if (!myMembership) return null;

  const isCoach =
    myMembership.role === 'HEAD_COACH' || myMembership.role === 'ASSISTANT_COACH';

  const athleteMembers = doc.memberships.filter((m) => m.status !== 'REVOKED');
  const totalInvited = athleteMembers.length;
  const openedCount = athleteMembers.filter(
    (m) => m.status === 'OPENED' || m.status === 'ACTIVE'
  ).length;
  const activeCount = athleteMembers.filter((m) => m.status === 'ACTIVE').length;
  const watchConnectedCount = athleteMembers.filter(
    (m) => Boolean(m.liveSnapshot?.hasConnectedWatch)
  ).length;

  const cleanOrigin = originUrl.replace(/\/+$/, '');
  const sanitizedMemberships: TeamMembershipRecord[] = athleteMembers.map((m) => {
    const base: TeamMembershipRecord = {
      membershipId: m.membershipId,
      teamId: m.teamId,
      role: m.role,
      squadGroup: m.squadGroup,
      invitedName: m.invitedName,
      graduationYear: m.graduationYear,
      isMinorU18: m.isMinorU18,
      seedMarkOrFtp: m.seedMarkOrFtp,
      status: m.status,
      emailDeliveryStatus: m.emailDeliveryStatus,
      invitedAt: m.invitedAt,
      openedAt: m.openedAt,
      joinedAt: m.joinedAt,
      liveSnapshot: m.liveSnapshot,
    };
    if (isCoach || m.userSid === callerSid) {
      base.invitedEmail = m.invitedEmail;
      base.invitedPhone = m.invitedPhone;
      base.parentGuardianEmail = m.parentGuardianEmail;
      if (m.rawInviteToken) {
        base.magicJoinUrl = `${cleanOrigin}/join/${doc.brand.slug}?t=${m.rawInviteToken}`;
      } else {
        base.magicJoinUrl = `${cleanOrigin}/join/${doc.brand.slug}`;
      }
    }
    return base;
  });

  return {
    brand: doc.brand,
    myRole: myMembership.role,
    mySquadGroup: myMembership.squadGroup,
    myMembershipId: myMembership.membershipId,
    totalInvited,
    openedCount,
    activeCount,
    watchConnectedCount,
    memberships: sanitizedMemberships,
    broadcastWorkouts: doc.broadcastWorkouts || [],
  };
}

export async function listTeamsForUser(
  callerSid: string,
  originUrl: string
): Promise<TeamSummaryWithRole[]> {
  const userIdx = await loadTenantVaultAsync<UserTeamsIndex>(
    userTeamsVaultKey(callerSid),
    {
      teamIds: [],
      updatedAt: '',
    }
  );
  const out: TeamSummaryWithRole[] = [];
  for (const teamId of userIdx.teamIds) {
    const doc = await loadTenantVaultAsync<StoredTeamDocument | null>(
      teamDocVaultKey(teamId),
      null
    );
    if (!doc) continue;
    const summary = projectTeamSummaryForCaller(doc, callerSid, originUrl);
    if (summary) out.push(summary);
  }
  return out;
}

export async function createTeamForCoach(params: {
  callerSid: string;
  originUrl: string;
  name: string;
  shortName?: string;
  mascotOrMotto?: string;
  orgType: TeamOrgType;
  primarySport?: 'Running' | 'Cycling' | 'Hybrid';
  primaryHex?: string;
  secondaryHex?: string;
  logoDataUrl?: string;
  defaultSafeSportShield?: boolean;
  enableParentGuardianCc?: boolean;
  coachDisplayName?: string;
  coachEmail?: string;
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
    createdAt: nowIso,
  };

  const coachMembership: StoredMembershipInternal = {
    membershipId: `mem_${crypto.randomBytes(6).toString('hex')}`,
    teamId,
    userSid: params.callerSid,
    role: 'HEAD_COACH',
    squadGroup: orgDefaults.defaultSquads[0] || 'Varsity',
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
    updatedAt: nowIso,
  };

  dir.bySlug[slug] = teamId;
  dir.byJoinCode[joinCode.toUpperCase()] = teamId;
  if (!dir.allTeamIds.includes(teamId)) dir.allTeamIds.push(teamId);

  saveTenantVaultSync(teamDocVaultKey(teamId), doc);
  saveTenantVaultSync(TEAMS_DIRECTORY_KEY, dir);
  await addTeamToUserIndex(
    params.callerSid,
    teamId,
    brand.coachDisplayName,
    params.coachEmail
  );

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
    >
  >;
}): Promise<TeamSummaryWithRole | null> {
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
    (callerMem.role !== 'HEAD_COACH' && callerMem.role !== 'ASSISTANT_COACH')
  ) {
    return null;
  }

  const u = params.updates;
  if (u.name) doc.brand.name = String(u.name).trim().slice(0, 80);
  if (u.shortName) doc.brand.shortName = String(u.shortName).trim().slice(0, 22);
  if (typeof u.mascotOrMotto === 'string') {
    doc.brand.mascotOrMotto = u.mascotOrMotto.trim().slice(0, 64) || undefined;
  }
  if (u.orgType) doc.brand.orgType = u.orgType;
  if (u.primarySport) doc.brand.primarySport = u.primarySport;
  if (u.primaryHex) doc.brand.primaryHex = normalizeHexColor(u.primaryHex, doc.brand.primaryHex);
  if (u.secondaryHex) {
    doc.brand.secondaryHex = normalizeHexColor(u.secondaryHex, doc.brand.secondaryHex);
  }
  if (typeof u.defaultSafeSportShield === 'boolean') {
    doc.brand.defaultSafeSportShield = u.defaultSafeSportShield;
  }
  if (typeof u.enableParentGuardianCc === 'boolean') {
    doc.brand.enableParentGuardianCc = u.enableParentGuardianCc;
  }
  if (u.coachDisplayName) {
    doc.brand.coachDisplayName = String(u.coachDisplayName).trim().slice(0, 48);
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
  saveTenantVaultSync(teamDocVaultKey(params.teamId), doc);
  return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
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
  let addedCount = 0;
  let emailedCount = 0;
  let manualLinkCount = 0;

  for (const row of parsedRows.slice(0, 150)) {
    const cleanEmail = row.invitedEmail?.trim().toLowerCase();
    // Deduplicate by email within the same team
    if (
      cleanEmail &&
      doc.memberships.some(
        (existing) =>
          existing.invitedEmail?.toLowerCase() === cleanEmail &&
          existing.status !== 'REVOKED'
      )
    ) {
      continue;
    }

    const rawToken = crypto.randomBytes(12).toString('base64url');
    const membershipId = `mem_${crypto.randomBytes(6).toString('hex')}`;
    const magicJoinUrl = `${cleanOrigin}/join/${doc.brand.slug}?t=${rawToken}`;

    const parentCc =
      doc.brand.enableParentGuardianCc && row.parentGuardianEmail
        ? row.parentGuardianEmail.trim().toLowerCase()
        : row.parentGuardianEmail?.trim().toLowerCase();

    let emailDeliveryStatus: TeamMembershipRecord['emailDeliveryStatus'] =
      'READY_MANUAL_LINK';

    if (cleanEmail && params.sendEmailsNow !== false) {
      const emailContent = buildTeamInviteEmailContent({
        brand: doc.brand,
        invitedName: row.invitedName,
        squadGroup: row.squadGroup || orgDefaults.defaultSquads[0] || 'Varsity',
        magicJoinUrl,
        hasParentCc: Boolean(parentCc),
        seedMarkOrFtp: row.seedMarkOrFtp,
      });

      const sendRes = await sendEmailViaResend({
        to: cleanEmail,
        cc: parentCc,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });

      emailDeliveryStatus = sendRes.status;
      if (sendRes.delivered) emailedCount += 1;
      else manualLinkCount += 1;
    } else {
      manualLinkCount += 1;
    }

    doc.memberships.push({
      membershipId,
      teamId: doc.brand.teamId,
      role: 'ATHLETE',
      squadGroup: row.squadGroup || orgDefaults.defaultSquads[0] || 'Varsity',
      invitedName: String(row.invitedName || 'Team Athlete').trim().slice(0, 64),
      invitedEmail: cleanEmail,
      invitedPhone: row.invitedPhone,
      parentGuardianEmail: parentCc,
      graduationYear: row.graduationYear,
      isMinorU18: Boolean(row.isMinorU18 || doc.brand.orgType === 'HIGH_SCHOOL'),
      seedMarkOrFtp: row.seedMarkOrFtp,
      status: 'INVITED',
      emailDeliveryStatus,
      rawInviteToken: rawToken,
      inviteTokenHash: hashToken(rawToken),
      invitedAt: nowIso,
    });
    addedCount += 1;
  }

  doc.updatedAt = nowIso;
  saveTenantVaultSync(teamDocVaultKey(params.teamId), doc);

  return {
    summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
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

    const magicJoinUrl = `${cleanOrigin}/join/${doc.brand.slug}?t=${m.rawInviteToken}`;
    const emailContent = buildTeamInviteEmailContent({
      brand: doc.brand,
      invitedName: m.invitedName,
      squadGroup: m.squadGroup,
      magicJoinUrl,
      hasParentCc: Boolean(m.parentGuardianEmail),
      seedMarkOrFtp: m.seedMarkOrFtp,
    });

    const sendRes = await sendEmailViaResend({
      to: m.invitedEmail,
      cc: m.parentGuardianEmail,
      subject: `Reminder: ${emailContent.subject}`,
      html: emailContent.html,
      text: emailContent.text,
    });

    m.emailDeliveryStatus = sendRes.status;
    if (sendRes.delivered) emailedCount += 1;
  }

  doc.updatedAt = new Date().toISOString();
  saveTenantVaultSync(teamDocVaultKey(params.teamId), doc);
  return {
    summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    emailedCount,
    resendConfigured: isResendConfigured(),
  };
}

async function findTeamDocumentByCodeOrSlug(
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
  inviteToken?: string
): Promise<TeamInvitePreviewPayload> {
  const doc = await findTeamDocumentByCodeOrSlug(codeOrSlug);
  if (!doc) return { found: false };

  let matchedMem: StoredMembershipInternal | undefined;
  if (inviteToken) {
    const targetHash = hashToken(inviteToken);
    matchedMem = doc.memberships.find(
      (m) => m.inviteTokenHash === targetHash && m.status !== 'REVOKED'
    );
    if (matchedMem && matchedMem.status === 'INVITED') {
      matchedMem.status = 'OPENED';
      matchedMem.openedAt = new Date().toISOString();
      doc.updatedAt = matchedMem.openedAt;
      saveTenantVaultSync(teamDocVaultKey(doc.brand.teamId), doc);
    }
  }

  return {
    found: true,
    brand: doc.brand,
    membership: matchedMem
      ? {
          membershipId: matchedMem.membershipId,
          invitedName: matchedMem.invitedName,
          invitedEmail: matchedMem.invitedEmail,
          squadGroup: matchedMem.squadGroup,
          role: matchedMem.role,
          isMinorU18: matchedMem.isMinorU18,
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
  squadGroup?: string;
  seedMarkOrFtp?: string;
}): Promise<{
  ok: boolean;
  summary?: TeamSummaryWithRole;
  calibrated?: ReturnType<typeof calibrateThresholdsFromSeedMark>;
  safeSportShieldEnforced?: boolean;
  error?: string;
}> {
  const doc = await findTeamDocumentByCodeOrSlug(params.codeOrSlug);
  if (!doc) {
    return {
      ok: false,
      error: 'No team matched that Join Code or link. Check the 6-character code with your coach.',
    };
  }

  const nowIso = new Date().toISOString();
  const cleanEmail = params.athleteEmail?.trim().toLowerCase();
  let mem: StoredMembershipInternal | undefined;

  if (params.inviteToken) {
    const targetHash = hashToken(params.inviteToken);
    mem = doc.memberships.find(
      (m) => m.inviteTokenHash === targetHash && m.status !== 'REVOKED'
    );
  }
  if (!mem) {
    mem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
  }
  if (!mem && cleanEmail) {
    mem = doc.memberships.find(
      (m) => m.invitedEmail?.toLowerCase() === cleanEmail && m.status !== 'REVOKED'
    );
  }

  const orgDefaults = getOrgTypeSafeguardingDefaults(doc.brand.orgType);
  if (!mem) {
    mem = {
      membershipId: `mem_${crypto.randomBytes(6).toString('hex')}`,
      teamId: doc.brand.teamId,
      userSid: params.callerSid,
      role: 'ATHLETE',
      squadGroup:
        params.squadGroup?.trim() || orgDefaults.defaultSquads[0] || 'Varsity',
      invitedName:
        params.athleteName?.trim().slice(0, 64) || 'Team Athlete',
      invitedEmail: cleanEmail,
      isMinorU18: doc.brand.orgType === 'HIGH_SCHOOL',
      seedMarkOrFtp: params.seedMarkOrFtp?.trim(),
      status: 'ACTIVE',
      invitedAt: nowIso,
      openedAt: nowIso,
      joinedAt: nowIso,
    };
    doc.memberships.push(mem);
  } else {
    mem.userSid = params.callerSid;
    if (params.athleteName?.trim()) {
      mem.invitedName = params.athleteName.trim().slice(0, 64);
    }
    if (cleanEmail && !mem.invitedEmail) {
      mem.invitedEmail = cleanEmail;
    }
    if (params.seedMarkOrFtp?.trim()) {
      mem.seedMarkOrFtp = params.seedMarkOrFtp.trim();
    }
    mem.status = 'ACTIVE';
    if (!mem.openedAt) mem.openedAt = nowIso;
    if (!mem.joinedAt) mem.joinedAt = nowIso;
  }

  const safeSportShieldEnforced = Boolean(
    doc.brand.defaultSafeSportShield || mem.isMinorU18
  );
  const calibrated = calibrateThresholdsFromSeedMark(
    mem.seedMarkOrFtp || params.seedMarkOrFtp || '',
    doc.brand.primarySport,
    'mi'
  );

  if (!mem.liveSnapshot) {
    mem.liveSnapshot = {
      updatedAt: nowIso,
      hasConnectedWatch: false,
      verdictLabel: 'Calibrated · Ready',
      readinessScore: 82,
      ctl: 42,
      atl: 40,
      tsb: 2,
      acuteLoad7d: 260,
      lowAerobicPct: 78,
      highAerobicPct: 16,
      neuromuscularPct: 6,
      caraHours7d: 6.5,
      ftpWatts: calibrated.cyclingFtpWatts,
      thresholdPaceSecsPerKm: calibrated.thresholdPaceSecsPerKm,
      safeSportHideWeight: safeSportShieldEnforced,
    };
  }

  doc.updatedAt = nowIso;
  saveTenantVaultSync(teamDocVaultKey(doc.brand.teamId), doc);
  await addTeamToUserIndex(
    params.callerSid,
    doc.brand.teamId,
    mem.invitedName,
    mem.invitedEmail
  );

  return {
    ok: true,
    summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl)!,
    calibrated,
    safeSportShieldEnforced,
  };
}

export async function broadcastWorkoutToTeamSquad(params: {
  callerSid: string;
  teamId: string;
  originUrl: string;
  targetSquadGroup: string;
  date: string;
  name: string;
  sportCategory: SportCategory;
  plannedDurationSecs: number;
  plannedLoad: number;
  workoutSyntax: string;
  description: string;
}): Promise<TeamSummaryWithRole | null> {
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
    (callerMem.role !== 'HEAD_COACH' && callerMem.role !== 'ASSISTANT_COACH')
  ) {
    return null;
  }

  const nowIso = new Date().toISOString();
  const workout: TeamBroadcastWorkout = {
    broadcastId: `bw_${crypto.randomBytes(6).toString('hex')}`,
    teamId: doc.brand.teamId,
    targetSquadGroup: String(params.targetSquadGroup || 'ALL').trim() || 'ALL',
    date: String(params.date || nowIso.slice(0, 10)).slice(0, 10),
    name: String(params.name || 'Team Prescribed Session').trim().slice(0, 100),
    sportCategory: params.sportCategory || 'Running',
    plannedDurationSecs: Math.max(300, Number(params.plannedDurationSecs) || 3600),
    plannedLoad: Math.max(5, Number(params.plannedLoad) || 65),
    workoutSyntax: String(params.workoutSyntax || '').slice(0, 2000),
    description: String(params.description || '').slice(0, 1000),
    pushedByCoachName: doc.brand.coachDisplayName,
    createdAt: nowIso,
  };

  doc.broadcastWorkouts = [workout, ...(doc.broadcastWorkouts || [])].slice(0, 60);
  doc.updatedAt = nowIso;
  saveTenantVaultSync(teamDocVaultKey(params.teamId), doc);

  return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
}

export async function syncAthleteSnapshotAcrossTeams(params: {
  callerSid: string;
  originUrl: string;
  athleteName?: string;
  snapshot: Partial<TeamAthleteLiveSnapshot>;
}): Promise<TeamSummaryWithRole[]> {
  const userIdx = await loadTenantVaultAsync<UserTeamsIndex>(
    userTeamsVaultKey(params.callerSid),
    {
      teamIds: [],
      updatedAt: '',
    }
  );
  if (userIdx.teamIds.length === 0) return [];

  // Enforce Clean-Room Firewall on any activities before cross-athlete team sync
  const cleanRoomPayload = sanitizeTelemetryForCleanRoom({
    activities: Array.isArray(params.snapshot.activities)
      ? params.snapshot.activities.slice(-25)
      : [],
  });
  const cleanActivities = Array.isArray(cleanRoomPayload.activities)
    ? cleanRoomPayload.activities
    : [];

  const nowIso = new Date().toISOString();
  const summaries: TeamSummaryWithRole[] = [];

  for (const teamId of userIdx.teamIds) {
    const doc = await loadTenantVaultAsync<StoredTeamDocument | null>(
      teamDocVaultKey(teamId),
      null
    );
    if (!doc) continue;

    const mem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!mem) continue;

    const enforceHideWeight = Boolean(
      doc.brand.defaultSafeSportShield ||
        mem.isMinorU18 ||
        params.snapshot.safeSportHideWeight
    );

    const sanitizedWellness = Array.isArray(params.snapshot.wellnessDays)
      ? params.snapshot.wellnessDays.slice(-28).map((w) =>
          enforceHideWeight ? { ...w, weightKg: 0 } : w
        )
      : undefined;

    if (params.athleteName?.trim() && mem.invitedName === 'Team Athlete') {
      mem.invitedName = params.athleteName.trim().slice(0, 64);
    }

    mem.liveSnapshot = {
      updatedAt: nowIso,
      hasConnectedWatch: Boolean(params.snapshot.hasConnectedWatch),
      verdictLabel: String(params.snapshot.verdictLabel || 'Active').slice(0, 48),
      readinessScore: Number(params.snapshot.readinessScore ?? 80),
      ctl: Number(params.snapshot.ctl ?? 0),
      atl: Number(params.snapshot.atl ?? 0),
      tsb: Number(params.snapshot.tsb ?? 0),
      acuteLoad7d: Number(params.snapshot.acuteLoad7d ?? 0),
      lowAerobicPct: Number(params.snapshot.lowAerobicPct ?? 75),
      highAerobicPct: Number(params.snapshot.highAerobicPct ?? 18),
      neuromuscularPct: Number(params.snapshot.neuromuscularPct ?? 7),
      caraHours7d: Number(params.snapshot.caraHours7d ?? 0),
      ftpWatts: params.snapshot.ftpWatts,
      thresholdPaceSecsPerKm: params.snapshot.thresholdPaceSecsPerKm,
      safeSportHideWeight: enforceHideWeight,
      wellnessDays: sanitizedWellness,
      activities: cleanActivities,
    };

    doc.updatedAt = nowIso;
    saveTenantVaultSync(teamDocVaultKey(teamId), doc);
    const proj = projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
    if (proj) summaries.push(proj);
  }

  return summaries;
}
