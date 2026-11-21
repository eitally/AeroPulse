import crypto from 'crypto';
import {
  deriveUserSessionSid,
  escapeHtml,
  isProductionDeployment,
} from './securityUtils.ts';
import { findOrCreateUser } from './authService.ts';
import { loadTenantVaultAsync, saveTenantVaultAsync } from './tokenVault.ts';
import { computeAccessibleTeamPalette } from '../src/physiology/teamOnboardingEngine.ts';
import {
  EMAIL_DIRECTORY_KEY,
  TEAMS_DIRECTORY_KEY,
  hashToken,
  teamDocVaultKey,
  userTeamsVaultKey,
  type EmailAccountDirectory,
  type StoredTeamDocument,
  type TeamsDirectoryIndex,
  type UserTeamsIndex,
} from './teamStoreCore.ts';
import type { TeamBrandConfig } from '../src/types.ts';

interface StoredEmailOtpRecord {
  email: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
}

function emailOtpVaultKey(email: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(email.trim().toLowerCase())
    .digest('hex')
    .slice(0, 24);
  return `email_otp_${hash}`;
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
    process.env.RESEND_FROM_EMAIL || 'THRESH Coaching <auth@thresh.fit>'
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

export function buildTeamInviteEmailContent(params: {
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
        Coach <strong>${safeCoach}</strong> added you to <strong>${safeTeamName}</strong> (${safeSquad}) on THRESH for workout pace groups, practice schedules, and split timing. Sign in with school Google or Email in one tap — no GPS watch or Strava required (optional watch sync anytime).
        ${safeSeed ? `<br/><span style="color:#065F46;font-size:13px;">Your initial zones are pre-seeded from <strong>${safeSeed}</strong>.</span>` : ''}
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${safeUrl}" style="display:inline-block;padding:14px 26px;border-radius:12px;background:${palette.primaryOnLight};color:${palette.textOnPrimaryLight};text-decoration:none;font-weight:700;font-size:15px;">
          Sign In &amp; Join ${safeShortName} &rarr;
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
    `Tap your personalized link to sign in with Google or Email and join in 45 seconds (no GPS watch or Strava needed): ${magicJoinUrl}`,
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
