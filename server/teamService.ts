import crypto from 'crypto';
import {
  sanitizeTelemetryForCleanRoom,
  stripSafeSportWeightAndBodyCompFields,
} from './cleanRoomFirewall.ts';
import { archiveCoachActivitiesForMember } from './athleteArchiveHelper.ts';
import {
  deriveUserSessionSid,
  escapeHtml,
  isProductionDeployment,
  timingSafeStringEqual,
} from './securityUtils.ts';
import { findOrCreateUser } from './authService.ts';
import { evaluateSafeSportPatternWatch } from '../src/physiology/safeSportPatternWatchEngine.ts';
import { resolveAthleteAgeTier } from '../src/physiology/ageAndComplianceEngine.ts';
import { normalizeAthleteMatchKey } from '../src/utils/athleticNetAndTfrrsEngine.ts';
import {
  loadTenantVaultAsync,
  saveTenantVaultAsync,
  withVaultLock,
} from './tokenVault.ts';
import {
  type ParsedBulkRosterRow,
  calibrateThresholdsFromSeedMark,
  computeAccessibleTeamPalette,
  generateTeamJoinCode,
  getOrgTypeSafeguardingDefaults,
  inferEventGroupFromSeedMark,
  normalizeHexColor,
  parseBulkRosterCsvOrText,
  slugifyTeamName,
} from '../src/physiology/teamOnboardingEngine.ts';
import {
  sanitizePracticeVenueCategory,
  sanitizeScheduledTime,
  sanitizeSessionSlot,
} from '../src/utils/workoutScheduleUtils.ts';
import type {
  CoachDataSharingTier,
  CoachEventGroup,
  DistanceUnit,
  ExternalTeamPlatform,
  PracticeVenueCategory,
  SessionCheckInRecord,
  SportCategory,
  TeamAthleteLiveSnapshot,
  TeamBrandConfig,
  TeamBroadcastWorkout,
  TeamExternalSyncConfig,
  TeamInvitePreviewPayload,
  TeamMemberRole,
  TeamMembershipRecord,
  TeamOrgType,
  TeamPlanTier,
  WorkoutSessionSlot,
  TeamSummaryWithRole,
  TrackWorkoutSpec,
  UnifiedActivity,
} from '../src/types.ts';

export { inferEventGroupFromSeedMark };

interface TeamsDirectoryIndex {
  bySlug: Record<string, string>;
  byJoinCode: Record<string, string>;
  allTeamIds: string[];
}

export interface StoredMembershipInternal extends TeamMembershipRecord {
  rawInviteToken?: string;
  inviteTokenHash?: string;
  parentConsentTokenHash?: string;
}

export interface StoredTeamDocument {
  brand: TeamBrandConfig;
  memberships: StoredMembershipInternal[];
  broadcastWorkouts: TeamBroadcastWorkout[];
  anonymousLinkOpens?: number;
  updatedAt: string;
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
    ...(merged.lastSyncedAt ? { lastSyncedAt: String(merged.lastSyncedAt).slice(0, 40) } : {}),
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

interface StoredEmailOtpRecord {
  email: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
}

export const TEAMS_DIRECTORY_KEY = 'teams_index_v1';
export const EMAIL_DIRECTORY_KEY = 'users_email_idx_v1';

export function teamDocVaultKey(teamId: string): string {
  return `team_doc_${teamId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}`;
}

export function userTeamsVaultKey(sid: string): string {
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

export function hashToken(rawToken: string): string {
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
        Coach <strong>${safeCoach}</strong> added you to <strong>${safeTeamName}</strong> (${safeSquad}) on THRESH for daily training readiness, workout pacing pods, and post-workout performance analysis. Sign in with your free Strava account in one tap to claim your roster spot and choose what training summary you share.
        ${safeSeed ? `<br/><span style="color:#065F46;font-size:13px;">Your initial zones are pre-seeded from <strong>${safeSeed}</strong>.</span>` : ''}
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${safeUrl}" style="display:inline-block;padding:14px 26px;border-radius:12px;background:${palette.primaryOnLight};color:${palette.textOnPrimaryLight};text-decoration:none;font-weight:700;font-size:15px;">
          Sign In With Strava &amp; Join ${safeShortName} &rarr;
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
    `Tap your personalized link to sign in with Strava and join in 45 seconds: ${magicJoinUrl}`,
    `Team Join Code: ${brand.joinCode}`,
    brand.defaultSafeSportShield
      ? `Safe-Sport Protection: Body weight & W/kg are hidden by default.`
      : ``,
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, html, text };
}

export function buildParentConsentEmailContent(params: {
  brand: TeamBrandConfig;
  athleteName: string;
  parentConsentUrl: string;
}): { subject: string; html: string; text: string } {
  const { brand, athleteName, parentConsentUrl } = params;
  const subject = `Notice: ${athleteName} joined ${brand.name} on THRESH (Scholastic Safeguards Active)`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#111318;background:#F4F6F3;margin:0;padding:24px 12px;">
  <div style="max-width:540px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:18px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.04);">
    <div style="background:${brand.primaryHex};padding:24px;color:#FFFFFF;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;">THRESH SCHOLASTIC SAFEGUARDING</div>
      <h1 style="margin:8px 0 4px;font-size:20px;font-weight:800;color:#FFFFFF;">Parent / Guardian Notice</h1>
      <div style="font-size:14px;opacity:0.9;">${escapeHtml(brand.name)} · Coach ${escapeHtml(brand.coachDisplayName)}</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:15px;margin:0 0 16px;">Hello,</p>
      <p style="font-size:14px;color:#374151;margin:0 0 16px;">
        <strong>${escapeHtml(athleteName)}</strong> has joined the <strong>${escapeHtml(brand.name)}</strong> roster on THRESH for athletic training and workout tracking under Coach ${escapeHtml(brand.coachDisplayName)}.
      </p>

      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:16px;margin:0 0 20px;">
        <div style="font-size:12px;font-weight:700;color:#0F172A;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Active Safeguards & Youth Privacy (COPPA & Safe Sport)</div>
        <ul style="font-size:13px;color:#475569;margin:0;padding-left:18px;line-height:1.6;">
          <li><strong>Safe-Sport Weight Shield Active:</strong> Body weight and power-to-weight ratios are strictly hidden to prevent disordered eating and RED-S syndrome.</li>
          <li><strong>Clean-Room Data Firewall:</strong> Training logs (distance, pace, heart rate) are shared only with certified team coaches. Zero advertising, zero tracking, and zero data sales to third parties.</li>
          <li><strong>Scholastic Retention:</strong> Roster participation data is maintained strictly for school athletic training and may be reviewed or deleted at any time upon parental request.</li>
        </ul>
      </div>

      <div style="text-align:center;margin:24px 0 16px;">
        <a href="${parentConsentUrl}" style="display:inline-block;background:${brand.primaryHex};color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px;padding:14px 28px;border-radius:10px;">
          Acknowledge & Confirm Roster Enrollment
        </a>
      </div>

      <p style="font-size:12px;color:#64748B;text-align:center;margin:0;">
        Or review via browser: <a href="${parentConsentUrl}" style="color:${brand.primaryHex};word-break:break-all;">${parentConsentUrl}</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = [
    `THRESH SCHOLASTIC SAFEGUARDING - Parent / Guardian Notice`,
    ``,
    `Hello,`,
    `${athleteName} has joined ${brand.name} on THRESH for athletic training under Coach ${brand.coachDisplayName}.`,
    ``,
    `Active Safeguards:`,
    `- Safe-Sport Weight Shield: Body weight is hidden to prevent RED-S and disordered eating.`,
    `- Clean-Room Firewall: Activity data is private to team coaches; zero ad tracking, zero data sales.`,
    ``,
    `Please acknowledge your athlete's enrollment here:`,
    parentConsentUrl,
  ].join('\n');

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
  await saveTenantVaultAsync(emailOtpVaultKey(email), record);

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:460px;margin:0 auto;padding:24px;border:1px solid #E5E7EB;border-radius:16px;background:#FFFFFF;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:#14532D;text-transform:uppercase;">THRESH CROSS-DEVICE SIGN-IN</div>
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

  const isProd = isProductionDeployment();
  if (!res.delivered && isProd) {
    return {
      ok: false,
      deliveryStatus: res.status,
      error:
        res.error ||
        'Email code delivery is not configured on this server. Please sign in with Strava instead.',
    };
  }
  return {
    ok: res.status !== 'FAILED',
    deliveryStatus: res.status,
    ...(res.status === 'READY_MANUAL_LINK' && !isProd ? { devPreviewCode: code } : {}),
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
    await saveTenantVaultAsync(key, stored);
    return { ok: false, error: 'Incorrect 6-digit code.' };
  }

  // Consume OTP
  await saveTenantVaultAsync(key, { ...stored, expiresAt: 0 });

  // Bind or retrieve persistent deterministic sid via unified ThreshUser
  const otpUser = await findOrCreateUser('magic_link', email, {
    email,
    name: email.split('@')[0],
  });
  const canonicalOtpSid = deriveUserSessionSid(otpUser.id);
  const emailDir = await loadTenantVaultAsync<EmailAccountDirectory>(EMAIL_DIRECTORY_KEY, {
    byEmail: {},
  });
  let account = emailDir.byEmail[email];
  if (!account) {
    const newSid =
      preferredSid && /^[a-f0-9]{24,64}$/i.test(preferredSid)
        ? preferredSid
        : canonicalOtpSid;
    account = {
      sid: newSid,
      displayName: otpUser.name,
      updatedAt: new Date().toISOString(),
    };
    emailDir.byEmail[email] = account;
    await saveTenantVaultAsync(EMAIL_DIRECTORY_KEY, emailDir);
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
      await saveTenantVaultAsync(teamDocVaultKey(teamId), doc);
    }
  }

  userTeams.updatedAt = new Date().toISOString();
  await saveTenantVaultAsync(userTeamsVaultKey(account.sid), userTeams);
  emailDir.byEmail[email] = account;
  await saveTenantVaultAsync(EMAIL_DIRECTORY_KEY, emailDir);

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

  const dir = await loadDirectory();
  const linkedTeamIds: string[] = [];
  const nowIso = new Date().toISOString();

  for (const teamId of dir.allTeamIds) {
    const doc = await loadTenantVaultAsync<StoredTeamDocument | null>(
      teamDocVaultKey(teamId),
      null
    );
    if (!doc) continue;

    let modified = false;
    for (const m of doc.memberships) {
      if (m.status === 'REVOKED') continue;
      if (m.invitedEmail && m.invitedEmail.trim().toLowerCase() === cleanEmail) {
        if (m.userSid !== params.userSid) {
          m.userSid = params.userSid;
          modified = true;
        }
        if (m.status === 'INVITED' || m.status === 'OPENED') {
          m.status = 'ACTIVE';
          if (!m.openedAt) m.openedAt = nowIso;
          if (!m.joinedAt) m.joinedAt = nowIso;
          modified = true;
        }
        if (params.stravaAthleteId && !m.stravaAthleteId) {
          m.stravaAthleteId = params.stravaAthleteId;
          modified = true;
        }
        if (
          params.athleteName &&
          (!m.invitedName || m.invitedName === 'Team Athlete' || m.invitedName.trim().length === 0)
        ) {
          m.invitedName = params.athleteName.trim().slice(0, 64);
          modified = true;
        }
        if (!m.sharingTier) {
          m.sharingTier = 'SUMMARY_ONLY';
          modified = true;
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
          modified = true;
        }

        await addTeamToUserIndex(
          params.userSid,
          teamId,
          m.invitedName,
          cleanEmail
        );

        if (!linkedTeamIds.includes(teamId)) {
          linkedTeamIds.push(teamId);
        }
      }
    }

    if (modified) {
      doc.updatedAt = nowIso;
      await saveTenantVaultAsync(teamDocVaultKey(teamId), doc);
    }
  }

  return linkedTeamIds;
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
      m.role !== 'PARENT_FOLLOWER'
  ).length;
  return activeOrInvitedAthletes <= 5 ? 'SANDBOX' : 'FOUNDING_TEAM';
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

  const isCoach =
    myMembership.role === 'HEAD_COACH' || myMembership.role === 'ASSISTANT_COACH';
  const isParentFollower = myMembership.role === 'PARENT_FOLLOWER';

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
        : isSelf
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

    const officialPublicResults = Array.isArray(m.coachRecordedActivities)
      ? m.coachRecordedActivities
          .filter((a) => Boolean(a?.officialRaceData))
          .map((a) => ({
            ...a,
            athleteWeightKg: undefined,
            avgHr: 0,
            maxHr: 0,
            streams: undefined,
          }))
      : undefined;

    const base: TeamMembershipRecord = {
      membershipId: m.membershipId,
      teamId: m.teamId,
      userSid: isCoach || isSelf ? m.userSid : undefined,
      stravaAthleteId: isCoach || isSelf ? m.stravaAthleteId : undefined,
      sharingTier: isParentFollower ? undefined : m.sharingTier,
      role: m.role,
      squadGroup: m.squadGroup,
      ...(m.eventGroup ? { eventGroup: m.eventGroup } : {}),
      invitedName: m.invitedName,
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
    if (!isParentFollower) return bw;
    const stripPracticeVenue =
      doc.brand.orgType === 'HIGH_SCHOOL' && !bw.isOfficialMeet;
    return {
      ...bw,
      athleteOverrides: undefined,
      ...(stripPracticeVenue
        ? {
            scheduledTime: undefined,
            locationName: undefined,
            meetingNotes: undefined,
          }
        : {}),
    };
  });

  return {
    brand: {
      ...doc.brand,
      planTier: resolveTeamPlanTier(doc.memberships),
    },
    myRole: myMembership.role,
    mySquadGroup: myMembership.squadGroup,
    ...(myMembership.eventGroup ? { myEventGroup: myMembership.eventGroup } : {}),
    myMembershipId: myMembership.membershipId,
    totalInvited,
    openedCount,
    activeCount,
    watchConnectedCount,
    memberships: sanitizedMemberships,
    broadcastWorkouts: visibleBroadcasts,
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
  externalSync?: TeamExternalSyncConfig;
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

  await withVaultLock(TEAMS_DIRECTORY_KEY, async () => {
    const latestDir = await loadDirectory();
    latestDir.bySlug[slug] = teamId;
    latestDir.byJoinCode[joinCode.toUpperCase()] = teamId;
    if (!latestDir.allTeamIds.includes(teamId)) latestDir.allTeamIds.push(teamId);
    await saveTenantVaultAsync(teamDocVaultKey(teamId), doc);
    await saveTenantVaultAsync(TEAMS_DIRECTORY_KEY, latestDir);
  });
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
      | 'externalSync'
    >
  >;
}): Promise<TeamSummaryWithRole | null> {
  return withVaultLock(teamDocVaultKey(params.teamId), async () => {
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

  const lockedResult = await withVaultLock(teamDocVaultKey(params.teamId), async () => {
    const latestDoc = await loadTenantVaultAsync<StoredTeamDocument | null>(
      teamDocVaultKey(params.teamId),
      null
    );
    if (!latestDoc) return null;

    let addedCount = 0;
    let manualLinkCount = 0;

    for (const row of parsedRows.slice(0, 220)) {
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

      latestDoc.memberships.push({
        membershipId,
        teamId: latestDoc.brand.teamId,
        role: 'ATHLETE',
        squadGroup: row.squadGroup || orgDefaults.defaultSquads[0] || 'Varsity',
        ...(inferEventGroupFromSeedMark(row.seedMarkOrFtp)
          ? { eventGroup: inferEventGroupFromSeedMark(row.seedMarkOrFtp) }
          : {}),
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
    await saveTenantVaultAsync(teamDocVaultKey(params.teamId), latestDoc);
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

  let { addedCount, manualLinkCount } = lockedResult;
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
          else manualLinkCount += 1;
        })
      );
    }

    await withVaultLock(teamDocVaultKey(params.teamId), async () => {
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
      await saveTenantVaultAsync(teamDocVaultKey(params.teamId), finalDoc);
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

  return withVaultLock(teamDocVaultKey(initialDoc.brand.teamId), async () => {
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
    // 1. Primary CSV match: athlete email address (athletes only, unclaimed or own row)
    if (!mem && cleanEmail) {
      mem = doc.memberships.find(
        (m) =>
          m.role === 'ATHLETE' &&
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
    // 4. Tertiary fallback: normalized athlete full name (strips diacritics & handles "Last, First")
    if (!mem && cleanNameLower && cleanNameLower !== 'team athlete' && cleanNameLower !== 'athlete') {
      const unclaimed = doc.memberships.filter(
        (m) =>
          (m.status === 'INVITED' || m.status === 'OPENED') &&
          !m.userSid &&
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

    // Evaluate COPPA (<13) and Minor/Adult (13-17 vs 18+) before mutating roster
    // Prefer existing stored DOB over incoming payload so a minor cannot overwrite DOB to 18+.
    const ageCheck = resolveAthleteAgeTier({
      birthMonthYear: mem?.birthMonthYear || params.birthMonthYear,
      birthYear: mem?.birthYear ?? params.birthYear,
      orgType: doc.brand.orgType,
      graduationYear: params.graduationYear ?? mem?.graduationYear,
    });

    if (ageCheck.isUnder13) {
      return {
        ok: false,
        error:
          'THRESH accounts require athletes to be 13 or older (COPPA). Coaches can time U13 athletes watchlessly using Trackside Stopwatch without child accounts.',
      };
    }

    const effectiveParentEmail =
      params.parentGuardianEmail?.trim().toLowerCase() ||
      mem?.parentGuardianEmail?.trim().toLowerCase();

    if (
      (ageCheck.ageTier === 'YOUTH_13_17' ||
        (ageCheck.ageTier === 'UNKNOWN' && doc.brand.orgType === 'HIGH_SCHOOL')) &&
      !effectiveParentEmail
    ) {
      return {
        ok: false,
        error: 'Parent or guardian email is required for athletes aged 13–17.',
      };
    }

    const orgDefaults = getOrgTypeSafeguardingDefaults(doc.brand.orgType);
    const resolvedSharingTier: CoachDataSharingTier = params.sharingTier || 'SUMMARY_ONLY';
    const isMinor =
      ageCheck.ageTier === 'UNKNOWN'
        ? Boolean(doc.brand.orgType === 'HIGH_SCHOOL' || mem?.isMinorU18)
        : ageCheck.isMinorU18;

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
      if (params.sharingTier) mem.sharingTier = params.sharingTier;
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

        void sendEmailViaResend({
          to: mem.parentGuardianEmail,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        });
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
    await saveTenantVaultAsync(teamDocVaultKey(doc.brand.teamId), doc);
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
  });
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
      const wasAcknowledged = mem.parentConsentStatus === 'ACKNOWLEDGED';
      if (!wasAcknowledged) {
        mem.parentConsentStatus = 'ACKNOWLEDGED';
        mem.parentConsentAt = new Date().toISOString();
        doc.updatedAt = mem.parentConsentAt;
        await saveTenantVaultAsync(teamDocVaultKey(teamId), doc);
      }
      return {
        ok: true,
        athleteName: mem.invitedName,
        teamName: doc.brand.name,
        coachName: doc.brand.coachDisplayName,
        sport: doc.brand.primarySport,
        parentEmail: mem.parentGuardianEmail,
        acknowledgedAt: mem.parentConsentAt,
        alreadyAcknowledged: wasAcknowledged,
      };
    }
  }

  return { ok: false, error: 'Invalid or expired parent consent link.' };
}

export async function updateTeamMemberEventGroup(params: {
  callerSid: string;
  teamId: string;
  originUrl: string;
  membershipId: string;
  eventGroup: CoachEventGroup | null;
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

  const targetMem = doc.memberships.find(
    (m) => m.membershipId === params.membershipId && m.status !== 'REVOKED'
  );
  if (!targetMem) return null;

  targetMem.eventGroup = params.eventGroup || undefined;
  doc.updatedAt = new Date().toISOString();
  await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);
  return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
}

export async function broadcastWorkoutToTeamSquad(params: {
  callerSid: string;
  teamId: string;
  originUrl: string;
  targetSquadGroup: string;
  targetEventGroups?: CoachEventGroup[];
  targetMembershipIds?: string[];
  date: string;
  name: string;
  sportCategory: SportCategory;
  plannedDurationSecs: number;
  plannedLoad: number;
  workoutSyntax: string;
  description: string;
  scheduledTime?: string;
  sessionSlot?: WorkoutSessionSlot;
  locationName?: string;
  locationCategory?: PracticeVenueCategory;
  meetingNotes?: string;
  trackSpec?: TrackWorkoutSpec;
  athleteOverrides?: TeamBroadcastWorkout['athleteOverrides'];
  planBlockId?: string;
  planBlockName?: string;
  planWeekNum?: number;
  publishMode?: 'ROLLING_1W' | 'ROLLING_2W' | 'FULL_BLOCK';
  replaceSameDateTarget?: boolean;
}): Promise<TeamSummaryWithRole | null> {
  return withVaultLock(teamDocVaultKey(params.teamId), async () => {
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
    const cleanTargets = Array.isArray(params.targetMembershipIds)
      ? params.targetMembershipIds.map((id) => String(id).trim()).filter(Boolean)
      : undefined;
    const cleanEventGroups = Array.isArray(params.targetEventGroups)
      ? params.targetEventGroups.filter(
          (g): g is CoachEventGroup => g === 'SPRINTS' || g === 'MID_DISTANCE' || g === 'DISTANCE'
        )
      : undefined;
    const dateStr = String(params.date || nowIso.slice(0, 10)).slice(0, 10);
    const targetSquadGroup = String(params.targetSquadGroup || 'ALL').trim() || 'ALL';
    const scheduledTime = sanitizeScheduledTime(params.scheduledTime);
    const sessionSlot = sanitizeSessionSlot(params.sessionSlot);
    const locationName = params.locationName
      ? String(params.locationName).trim().slice(0, 120)
      : undefined;
    const locationCategory = sanitizePracticeVenueCategory(params.locationCategory);
    const meetingNotes = params.meetingNotes
      ? String(params.meetingNotes).trim().slice(0, 240)
      : undefined;

    const workout: TeamBroadcastWorkout = {
      broadcastId: `bw_${crypto.randomBytes(6).toString('hex')}`,
      teamId: doc.brand.teamId,
      targetSquadGroup,
      ...(cleanEventGroups && cleanEventGroups.length > 0 ? { targetEventGroups: cleanEventGroups } : {}),
      ...(cleanTargets && cleanTargets.length > 0 ? { targetMembershipIds: cleanTargets } : {}),
      date: dateStr,
      name: String(params.name || 'Team Prescribed Session').trim().slice(0, 100),
      sportCategory: params.sportCategory || 'Running',
      plannedDurationSecs: Math.max(300, Number(params.plannedDurationSecs) || 3600),
      plannedLoad: Math.max(5, Number(params.plannedLoad) || 65),
      workoutSyntax: String(params.workoutSyntax || '').slice(0, 3000),
      description: String(params.description || '').slice(0, 1000),
      ...(scheduledTime ? { scheduledTime } : {}),
      ...(sessionSlot ? { sessionSlot } : {}),
      ...(locationName ? { locationName } : {}),
      ...(locationCategory ? { locationCategory } : {}),
      ...(meetingNotes ? { meetingNotes } : {}),
      ...(params.trackSpec ? { trackSpec: params.trackSpec } : {}),
      ...(params.athleteOverrides && Object.keys(params.athleteOverrides).length > 0
        ? { athleteOverrides: params.athleteOverrides }
        : {}),
      ...(params.planBlockId ? { planBlockId: String(params.planBlockId).slice(0, 80) } : {}),
      ...(params.planBlockName ? { planBlockName: String(params.planBlockName).slice(0, 120) } : {}),
      ...(typeof params.planWeekNum === 'number' ? { planWeekNum: params.planWeekNum } : {}),
      ...(params.publishMode ? { publishMode: params.publishMode } : {}),
      pushedByCoachName: callerMem.invitedName || doc.brand.coachDisplayName,
      createdAt: nowIso,
    };

    const eventGroupSignature = JSON.stringify((cleanEventGroups || []).slice().sort());
    const nextSlot = workout.sessionSlot || 'SINGLE';
    const existingFiltered = (doc.broadcastWorkouts || []).filter((bw) => {
      if (params.replaceSameDateTarget === false) return true;
      const sameDate = bw.date === dateStr;
      const sameSquad = bw.targetSquadGroup === targetSquadGroup;
      const sameGroups = JSON.stringify((bw.targetEventGroups || []).slice().sort()) === eventGroupSignature;
      const sameMembers =
        JSON.stringify((bw.targetMembershipIds || []).slice().sort()) ===
        JSON.stringify((cleanTargets || []).slice().sort());
      const sameSlot = (bw.sessionSlot || 'SINGLE') === nextSlot;
      const sameSport = (bw.sportCategory || 'Running') === workout.sportCategory;
      return !(sameDate && sameSquad && sameGroups && sameMembers && sameSlot && sameSport);
    });

    doc.broadcastWorkouts = [workout, ...existingFiltered].slice(0, 400);
    doc.updatedAt = nowIso;
    await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);

    return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
  });
}

export async function broadcastWorkoutBatchToTeamSquad(params: {
  callerSid: string;
  teamId: string;
  originUrl: string;
  targetSquadGroup: string;
  targetEventGroups?: CoachEventGroup[];
  targetMembershipIds?: string[];
  publishMode?: 'ROLLING_1W' | 'ROLLING_2W' | 'FULL_BLOCK';
  planBlockId?: string;
  planBlockName?: string;
  replaceExistingCohortRange?: boolean;
  workouts: Array<{
    date: string;
    name: string;
    sportCategory: SportCategory;
    plannedDurationSecs: number;
    plannedLoad: number;
    workoutSyntax: string;
    description: string;
    scheduledTime?: string;
    sessionSlot?: WorkoutSessionSlot;
    locationName?: string;
    locationCategory?: PracticeVenueCategory;
    meetingNotes?: string;
    trackSpec?: TrackWorkoutSpec;
    planWeekNum?: number;
  }>;
}): Promise<TeamSummaryWithRole | null> {
  return withVaultLock(teamDocVaultKey(params.teamId), async () => {
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
    const cleanTargets = Array.isArray(params.targetMembershipIds)
      ? params.targetMembershipIds.map((id) => String(id).trim()).filter(Boolean)
      : undefined;
    const cleanEventGroups = Array.isArray(params.targetEventGroups)
      ? params.targetEventGroups.filter(
          (g): g is CoachEventGroup => g === 'SPRINTS' || g === 'MID_DISTANCE' || g === 'DISTANCE'
        )
      : undefined;
    const targetSquadGroup = String(params.targetSquadGroup || 'ALL').trim() || 'ALL';
    const cleanBlockId = params.planBlockId
      ? String(params.planBlockId).slice(0, 80)
      : `tm-blk-${Date.now()}`;
    const cleanBlockName = params.planBlockName
      ? String(params.planBlockName).slice(0, 120)
      : undefined;
    const publishMode =
      params.publishMode === 'ROLLING_1W' ||
      params.publishMode === 'ROLLING_2W' ||
      params.publishMode === 'FULL_BLOCK'
        ? params.publishMode
        : 'FULL_BLOCK';

    const createdWorkouts: TeamBroadcastWorkout[] = (params.workouts || [])
      .slice(0, 160)
      .map((w) => {
        const scheduledTime = sanitizeScheduledTime(w.scheduledTime);
        const sessionSlot = sanitizeSessionSlot(w.sessionSlot);
        const locationName = w.locationName ? String(w.locationName).trim().slice(0, 120) : undefined;
        const locationCategory = sanitizePracticeVenueCategory(w.locationCategory);
        const meetingNotes = w.meetingNotes ? String(w.meetingNotes).trim().slice(0, 240) : undefined;
        return {
          broadcastId: `bw_${crypto.randomBytes(6).toString('hex')}`,
          teamId: doc.brand.teamId,
          targetSquadGroup,
          ...(cleanEventGroups && cleanEventGroups.length > 0 ? { targetEventGroups: cleanEventGroups } : {}),
          ...(cleanTargets && cleanTargets.length > 0 ? { targetMembershipIds: cleanTargets } : {}),
          date: String(w.date || nowIso.slice(0, 10)).slice(0, 10),
          name: String(w.name || 'Team Prescribed Session').trim().slice(0, 100),
          sportCategory: w.sportCategory || 'Running',
          plannedDurationSecs: Math.max(300, Number(w.plannedDurationSecs) || 3600),
          plannedLoad: Math.max(5, Number(w.plannedLoad) || 65),
          workoutSyntax: String(w.workoutSyntax || '').slice(0, 3000),
          description: String(w.description || '').slice(0, 1000),
          ...(scheduledTime ? { scheduledTime } : {}),
          ...(sessionSlot ? { sessionSlot } : {}),
          ...(locationName ? { locationName } : {}),
          ...(locationCategory ? { locationCategory } : {}),
          ...(meetingNotes ? { meetingNotes } : {}),
          ...(w.trackSpec ? { trackSpec: w.trackSpec } : {}),
          planBlockId: cleanBlockId,
          ...(cleanBlockName ? { planBlockName: cleanBlockName } : {}),
          ...(typeof w.planWeekNum === 'number' ? { planWeekNum: w.planWeekNum } : {}),
          publishMode,
          pushedByCoachName: doc.brand.coachDisplayName,
          createdAt: nowIso,
        };
      });

    const eventGroupSignature = JSON.stringify((cleanEventGroups || []).slice().sort());
    const membersSignature = JSON.stringify((cleanTargets || []).slice().sort());
    const dates = createdWorkouts.map((c) => c.date).sort();
    const minDate = dates[0] || '';
    const maxDate = dates[dates.length - 1] || '';

    const existingFiltered = (doc.broadcastWorkouts || []).filter((bw) => {
      if (params.replaceExistingCohortRange === false || !minDate || !maxDate) return true;
      const inRange = bw.date >= minDate && bw.date <= maxDate;
      const sameSquad = bw.targetSquadGroup === targetSquadGroup;
      const sameGroups = JSON.stringify((bw.targetEventGroups || []).slice().sort()) === eventGroupSignature;
      const sameMembers = JSON.stringify((bw.targetMembershipIds || []).slice().sort()) === membersSignature;
      return !(inRange && sameSquad && sameGroups && sameMembers);
    });

    doc.broadcastWorkouts = [...createdWorkouts, ...existingFiltered].slice(0, 400);
    doc.updatedAt = nowIso;
    await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);

    return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
  });
}

export async function updateBroadcastWorkoutOnTeam(params: {
  callerSid: string;
  teamId: string;
  broadcastId: string;
  originUrl: string;
  updates: {
    date?: string;
    name?: string;
    sportCategory?: SportCategory;
    plannedDurationSecs?: number;
    plannedLoad?: number;
    workoutSyntax?: string;
    description?: string;
    scheduledTime?: string | null;
    sessionSlot?: WorkoutSessionSlot | null;
    locationName?: string | null;
    locationCategory?: PracticeVenueCategory | null;
    meetingNotes?: string | null;
    trackSpec?: TrackWorkoutSpec | null;
  };
}): Promise<TeamSummaryWithRole | null> {
  return withVaultLock(teamDocVaultKey(params.teamId), async () => {
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

    const cleanId = String(params.broadcastId || '').trim();
    const list = Array.isArray(doc.broadcastWorkouts) ? doc.broadcastWorkouts : [];
    const targetIdx = list.findIndex((bw) => bw.broadcastId === cleanId);
    if (targetIdx === -1) return null;

    const existing = list[targetIdx];
    const u = params.updates || {};
    const updatedWorkout: TeamBroadcastWorkout = {
      ...existing,
      ...(typeof u.date === 'string' && u.date.trim() ? { date: u.date.trim().slice(0, 10) } : {}),
      ...(typeof u.name === 'string' && u.name.trim()
        ? { name: u.name.trim().slice(0, 100) }
        : {}),
      ...(u.sportCategory ? { sportCategory: u.sportCategory } : {}),
      ...(typeof u.plannedDurationSecs === 'number' && Number.isFinite(u.plannedDurationSecs)
        ? { plannedDurationSecs: Math.max(60, Math.round(u.plannedDurationSecs)) }
        : {}),
      ...(typeof u.plannedLoad === 'number' && Number.isFinite(u.plannedLoad)
        ? { plannedLoad: Math.max(1, Math.round(u.plannedLoad)) }
        : {}),
      ...(typeof u.workoutSyntax === 'string'
        ? { workoutSyntax: u.workoutSyntax.slice(0, 3000) }
        : {}),
      ...(typeof u.description === 'string'
        ? { description: u.description.slice(0, 1000) }
        : {}),
      ...(u.trackSpec === null ? { trackSpec: undefined } : u.trackSpec ? { trackSpec: u.trackSpec } : {}),
    };

    if ('scheduledTime' in u) {
      const cleanTime = sanitizeScheduledTime(u.scheduledTime ?? undefined);
      if (cleanTime) updatedWorkout.scheduledTime = cleanTime;
      else delete updatedWorkout.scheduledTime;
    }
    if ('sessionSlot' in u) {
      const cleanSlot = sanitizeSessionSlot(u.sessionSlot ?? undefined);
      if (cleanSlot) updatedWorkout.sessionSlot = cleanSlot;
      else delete updatedWorkout.sessionSlot;
    }
    if ('locationName' in u) {
      const cleanLoc = u.locationName ? String(u.locationName).trim().slice(0, 120) : '';
      if (cleanLoc) updatedWorkout.locationName = cleanLoc;
      else delete updatedWorkout.locationName;
    }
    if ('locationCategory' in u) {
      const cleanCat = sanitizePracticeVenueCategory(u.locationCategory ?? undefined);
      if (cleanCat) updatedWorkout.locationCategory = cleanCat;
      else delete updatedWorkout.locationCategory;
    }
    if ('meetingNotes' in u) {
      const cleanNotes = u.meetingNotes ? String(u.meetingNotes).trim().slice(0, 240) : '';
      if (cleanNotes) updatedWorkout.meetingNotes = cleanNotes;
      else delete updatedWorkout.meetingNotes;
    }

    doc.broadcastWorkouts = [
      ...list.slice(0, targetIdx),
      updatedWorkout,
      ...list.slice(targetIdx + 1),
    ];
    doc.updatedAt = new Date().toISOString();
    await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);

    return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
  });
}

export async function deleteBroadcastPlanBlockFromTeam(params: {
  callerSid: string;
  teamId: string;
  blockId: string;
  originUrl: string;
}): Promise<TeamSummaryWithRole | null> {
  return withVaultLock(teamDocVaultKey(params.teamId), async () => {
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

    const cleanBlockId = String(params.blockId || '').trim();
    doc.broadcastWorkouts = (doc.broadcastWorkouts || []).filter(
      (bw) => bw.planBlockId !== cleanBlockId
    );
    doc.updatedAt = new Date().toISOString();
    await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);

    return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
  });
}

export async function deleteBroadcastWorkoutFromTeam(params: {
  callerSid: string;
  teamId: string;
  broadcastId: string;
  originUrl: string;
}): Promise<TeamSummaryWithRole | null> {
  return withVaultLock(teamDocVaultKey(params.teamId), async () => {
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

    const cleanBroadcastId = String(params.broadcastId || '').trim();
    doc.broadcastWorkouts = (doc.broadcastWorkouts || []).filter(
      (bw) => bw.broadcastId !== cleanBroadcastId
    );
    doc.updatedAt = new Date().toISOString();
    await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);

    return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
  });
}

export async function recordCoachStopwatchActivities(params: {
  callerSid: string;
  teamId: string;
  originUrl: string;
  entries: Array<{ membershipId: string; activity: UnifiedActivity }>;
}): Promise<TeamSummaryWithRole | null> {
  const archiveQueue: Array<{
    member: StoredMembershipInternal;
    activity: UnifiedActivity;
  }> = [];

  const summary = await withVaultLock(teamDocVaultKey(params.teamId), async () => {
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
    for (const entry of params.entries || []) {
      const cleanId = String(entry?.membershipId || '').trim();
      const rawAct = entry?.activity;
      if (!cleanId || !rawAct || !rawAct.id) continue;

      const mem = doc.memberships.find(
        (m) => m.membershipId === cleanId && m.status !== 'REVOKED'
      );
      if (!mem) continue;

      const enforceHideWeight = Boolean(doc.brand.defaultSafeSportShield || mem.isMinorU18);
      const cleanList = (sanitizeTelemetryForCleanRoom({ activities: [rawAct] }).activities ||
        []) as UnifiedActivity[];
      const safeAct = enforceHideWeight
        ? stripSafeSportWeightAndBodyCompFields(cleanList, { maskWellnessWeightKgZero: true })[0]
        : cleanList[0];
      if (!safeAct) continue;

      const prevRecorded = Array.isArray(mem.coachRecordedActivities)
        ? mem.coachRecordedActivities
        : [];
      mem.coachRecordedActivities = [
        safeAct,
        ...prevRecorded.filter((a) => a.id !== safeAct.id),
      ].slice(0, 50);

      archiveQueue.push({ member: { ...mem }, activity: safeAct });

      const baseSnap: TeamAthleteLiveSnapshot = mem.liveSnapshot || {
        updatedAt: nowIso,
        hasConnectedWatch: false,
        verdictLabel: 'Coach Track Session',
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
      mem.liveSnapshot = {
        ...baseSnap,
        updatedAt: nowIso,
        safeSportHideWeight: baseSnap.safeSportHideWeight || enforceHideWeight,
        activities: [safeAct, ...prevSnapActs.filter((a) => a.id !== safeAct.id)].slice(0, 30),
      };
    }

    doc.updatedAt = nowIso;
    await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);
    return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
  });

  for (const item of archiveQueue) {
    await archiveCoachActivitiesForMember(item.member, [item.activity]).catch(() => undefined);
  }
  return summary;
}

/**
 * Produces coach-consented activity summaries according to the athlete's chosen sharing tier.
 * Always strips Strava social metadata (kudos, comments, segments), and strips GPS polylines/latlngs
 * unless the athlete explicitly selected `FULL_STREAMS` AND `privacySettings.shareGpsRoutes !== 'PRIVATE'`
 * on first-party/clean-room eligible workouts.
 */
function buildConsentedCoachActivities(
  rawActivities: UnifiedActivity[] | undefined,
  sharingTier: CoachDataSharingTier,
  allowGpsRoutes: boolean
): UnifiedActivity[] {
  if (!Array.isArray(rawActivities) || sharingTier === 'LOAD_ONLY') {
    return [];
  }
  const sortedNewestFirst = [...rawActivities].sort((a, b) =>
    String(b?.startDateLocal || '').localeCompare(String(a?.startDateLocal || ''))
  );
  const newest25 = sortedNewestFirst.slice(0, 25);
  const cleanRoomPayload = sanitizeTelemetryForCleanRoom({
    activities: newest25,
  });
  const cleanRoomActivities = (
    Array.isArray(cleanRoomPayload.activities) ? cleanRoomPayload.activities : []
  ) as UnifiedActivity[];
  const firstPartyIds = new Set(
    cleanRoomActivities.map((a) => String(a?.id || ''))
  );

  // Clean-Room & Strava Nov 2024 API Compliance: never forward Strava-sourced activities
  // into cross-user coach snapshots; FULL_STREAMS unlocks 1Hz streams & GPS on first-party hardware only.
  const sourceList = cleanRoomActivities;

  return sourceList.map((act) => {
    const isFirstParty = firstPartyIds.has(String(act.id || ''));
    const includeGps = sharingTier === 'FULL_STREAMS' && allowGpsRoutes && isFirstParty;
    const sanitized: UnifiedActivity = {
      ...act,
      // Always strip Strava social/segment/gear payloads from cross-user coach snapshots (Strava Nov 2024 Developer Agreement Sec 5.3)
      kudoers: undefined,
      comments: undefined,
      segmentEfforts: [],
      gearName: isFirstParty ? act.gearName : undefined,
      summaryPolyline: includeGps ? act.summaryPolyline : undefined,
      routeLatLngs: includeGps ? act.routeLatLngs : undefined,
      startLatLng: includeGps ? act.startLatLng : undefined,
      endLatLng: includeGps ? act.endLatLng : undefined,
      streams: sharingTier === 'FULL_STREAMS' && isFirstParty ? act.streams : undefined,
    };
    return sanitized;
  });
}

export async function syncAthleteSnapshotAcrossTeams(params: {
  callerSid: string;
  originUrl: string;
  athleteName?: string;
  verifiedUserBirthMonthYear?: string;
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

  const nowIso = new Date().toISOString();
  const summaries: TeamSummaryWithRole[] = [];

  for (const teamId of userIdx.teamIds) {
    const proj = await withVaultLock(teamDocVaultKey(teamId), async () => {
      const doc = await loadTenantVaultAsync<StoredTeamDocument | null>(
        teamDocVaultKey(teamId),
        null
      );
      if (!doc) return null;

      const mem = doc.memberships.find(
        (m) =>
          m.userSid === params.callerSid &&
          m.status !== 'REVOKED' &&
          m.status !== 'ALUMNI'
      );
      if (!mem) return null;

      const canonicalBirthMonthYear =
        mem.birthMonthYear ||
        params.verifiedUserBirthMonthYear ||
        (mem.isMinorU18 || mem.birthYear ? undefined : params.snapshot.birthMonthYear);
      const ageCompliance = resolveAthleteAgeTier({
        birthMonthYear: canonicalBirthMonthYear,
        birthYear: mem.birthYear,
        orgType: doc.brand.orgType,
        graduationYear: mem.graduationYear,
        now: nowIso,
      });

      // Automatic High School senior graduation rollover after July 15 -> stop leaking live biometrics
      if (ageCompliance.shouldAutoGraduateHs) {
        mem.status = 'ALUMNI';
        mem.graduatedAt = nowIso;
        mem.liveSnapshot = undefined;
        doc.updatedAt = nowIso;
        await saveTenantVaultAsync(teamDocVaultKey(teamId), doc);
        return null;
      }

      const effectiveIsMinor =
        ageCompliance.ageTier === 'UNKNOWN'
          ? Boolean(mem.isMinorU18)
          : ageCompliance.isMinorU18;
      mem.isMinorU18 = effectiveIsMinor;
      if (ageCompliance.birthMonthYear && !mem.birthMonthYear) {
        mem.birthMonthYear = ageCompliance.birthMonthYear;
      }
      if (ageCompliance.ageTier === 'ADULT_18_PLUS' && mem.parentConsentStatus === 'PENDING') {
        mem.parentConsentStatus = 'NOT_REQUIRED';
        mem.parentConsentToken = undefined;
        mem.parentConsentTokenHash = undefined;
      }

      const quarantineMinorPendingConsent = Boolean(
        effectiveIsMinor && mem.parentConsentStatus !== 'ACKNOWLEDGED'
      );

      let effectiveTier: CoachDataSharingTier = quarantineMinorPendingConsent
        ? 'LOAD_ONLY'
        : params.snapshot.sharingTier || mem.sharingTier || 'SUMMARY_ONLY';
      if (params.snapshot.sharingTier && !quarantineMinorPendingConsent) {
        mem.sharingTier = params.snapshot.sharingTier;
      } else if (!mem.sharingTier) {
        mem.sharingTier = effectiveTier;
      }

      const enforceHideWeight = Boolean(
        doc.brand.defaultSafeSportShield ||
          effectiveIsMinor ||
          params.snapshot.safeSportHideWeight
      );

      const priv = params.snapshot.privacySettings;
      const hidePrivateWellness = priv?.shareWellnessAndHrv === 'PRIVATE';
      const allowGpsRoutes =
        !priv || (priv.shareGpsRoutes !== 'PRIVATE' && !priv.stravaComplianceShield);

      const rawCoachActivities = buildConsentedCoachActivities(
        params.snapshot.activities,
        effectiveTier,
        allowGpsRoutes
      );
      const coachActivities = enforceHideWeight
        ? stripSafeSportWeightAndBodyCompFields(rawCoachActivities, {
            maskWellnessWeightKgZero: true,
          })
        : rawCoachActivities;

      const rawSanitizedWellness =
        quarantineMinorPendingConsent ||
        hidePrivateWellness ||
        !Array.isArray(params.snapshot.wellnessDays)
          ? undefined
          : params.snapshot.wellnessDays.slice(-56);
      const sanitizedWellness =
        rawSanitizedWellness && enforceHideWeight
          ? stripSafeSportWeightAndBodyCompFields(rawSanitizedWellness, {
              maskWellnessWeightKgZero: true,
            })
          : rawSanitizedWellness;

      const watchReport = evaluateSafeSportPatternWatch({
        activities: params.snapshot.activities || [],
        wellnessDays: rawSanitizedWellness,
        isMinorU18: effectiveIsMinor,
        hasParentGuardianCc: Boolean(mem.parentGuardianEmail && effectiveIsMinor),
        hasAthleticTrainer: doc.brand.orgType === 'HIGH_SCHOOL' || doc.brand.orgType === 'COLLEGIATE',
      });

      if (params.athleteName?.trim() && mem.invitedName === 'Team Athlete') {
        mem.invitedName = params.athleteName.trim().slice(0, 64);
      }

      const sanitizedCheckIns: SessionCheckInRecord[] | undefined =
        quarantineMinorPendingConsent || hidePrivateWellness
          ? undefined
        : Array.isArray(params.snapshot.sessionCheckIns)
          ? params.snapshot.sessionCheckIns.slice(0, 28).map((c) => {
              const validArea =
                c?.painArea === 'KNEE' ||
                c?.painArea === 'SHIN' ||
                c?.painArea === 'ACHILLES' ||
                c?.painArea === 'HAMSTRING' ||
                c?.painArea === 'HIP' ||
                c?.painArea === 'FOOT' ||
                c?.painArea === 'BACK' ||
                c?.painArea === 'OTHER'
                  ? c.painArea
                  : undefined;
              const validLegFeel =
                c?.legFeel === 'FRESH' || c?.legFeel === 'NORMAL' || c?.legFeel === 'HEAVY'
                  ? c.legFeel
                  : undefined;
              const validRitualSlot =
                c?.ritualSlot === 'MORNING' ||
                c?.ritualSlot === 'POST_SESSION' ||
                c?.ritualSlot === 'TONIGHT'
                  ? c.ritualSlot
                  : undefined;
              const rawSleepTarget = Number(c?.sleepTargetHours);
              const validSleepTarget =
                Number.isFinite(rawSleepTarget) && rawSleepTarget >= 5 && rawSleepTarget <= 12
                  ? Number(rawSleepTarget.toFixed(1))
                  : undefined;
              return {
                id: String(c?.id || `chk-${Date.now()}`).slice(0, 64),
                date: String(c?.date || nowIso.slice(0, 10)).slice(0, 10),
                ...(c?.plannedEventId ? { plannedEventId: String(c.plannedEventId).slice(0, 64) } : {}),
                ...(c?.workoutName ? { workoutName: String(c.workoutName).slice(0, 100) } : {}),
                rpe: Math.max(1, Math.min(10, Math.round(Number(c?.rpe) || 5))),
                painFlag: Boolean(c?.painFlag),
                ...(validArea ? { painArea: validArea } : {}),
                ...(c?.sorenessNote ? { sorenessNote: String(c.sorenessNote).slice(0, 140) } : {}),
                ...(c?.autoSwappedToRecovery ? { autoSwappedToRecovery: true } : {}),
                ...(validLegFeel ? { legFeel: validLegFeel } : {}),
                ...(c?.lifeStressFlag ? { lifeStressFlag: true } : {}),
                ...(validSleepTarget ? { sleepTargetHours: validSleepTarget } : {}),
                ...(c?.tomorrowLocked ? { tomorrowLocked: true } : {}),
                ...(validRitualSlot ? { ritualSlot: validRitualSlot } : {}),
                createdAt: String(c?.createdAt || nowIso).slice(0, 40),
              };
            })
          : mem.liveSnapshot?.sessionCheckIns;

      const assembledSnapshot: TeamAthleteLiveSnapshot = {
        updatedAt: nowIso,
        hasConnectedWatch: Boolean(params.snapshot.hasConnectedWatch),
        verdictLabel: quarantineMinorPendingConsent
          ? 'Awaiting Parent Consent'
          : String(params.snapshot.verdictLabel || 'Active').slice(0, 48),
        readinessScore: quarantineMinorPendingConsent
          ? 0
          : Number(params.snapshot.readinessScore ?? 0),
        ctl: Number(params.snapshot.ctl ?? 0),
        atl: Number(params.snapshot.atl ?? 0),
        tsb: Number(params.snapshot.tsb ?? 0),
        acuteLoad7d: Number(params.snapshot.acuteLoad7d ?? 0),
        lowAerobicPct: Number(params.snapshot.lowAerobicPct ?? 0),
        highAerobicPct: Number(params.snapshot.highAerobicPct ?? 0),
        neuromuscularPct: Number(params.snapshot.neuromuscularPct ?? 0),
        caraHours7d: Number(params.snapshot.caraHours7d ?? 0),
        ftpWatts: params.snapshot.ftpWatts,
        thresholdPaceSecsPerKm: params.snapshot.thresholdPaceSecsPerKm,
        safeSportHideWeight: enforceHideWeight,
        sharingTier: effectiveTier,
        privacySettings: priv,
        wellnessDays: sanitizedWellness,
        activities: coachActivities,
        ...(sanitizedCheckIns && sanitizedCheckIns.length > 0
          ? { sessionCheckIns: sanitizedCheckIns }
          : {}),
        safeSportWatch: {
          trafficLight: watchReport.trafficLight,
          coachSafeSummaryLabel: watchReport.coachSafeSummaryLabel,
          privateAlertForSelfAndParentOnly: watchReport,
        },
      };
      mem.liveSnapshot = enforceHideWeight
        ? stripSafeSportWeightAndBodyCompFields(assembledSnapshot, {
            maskWellnessWeightKgZero: true,
          })
        : assembledSnapshot;

      doc.updatedAt = nowIso;
      await saveTenantVaultAsync(teamDocVaultKey(teamId), doc);
      return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
    });
    if (proj) summaries.push(proj);
  }

  return summaries;
}
