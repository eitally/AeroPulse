import crypto from 'crypto';
import { deleteTenantVault, loadTenantVaultAsync, saveTenantVaultAsync, withVaultLock } from './tokenVault.ts';
import {
  escapeHtml,
  getPasskeyChallengeSecret,
  isProductionDeployment,
  timingSafeStringEqual,
} from './securityUtils.ts';

export interface ThreshUserAuthProvider {
  provider: 'google' | 'magic_link' | 'passkey' | 'strava' | 'dev_mock';
  providerId: string; // e.g. Google sub, email, passkey credentialId, or Strava athleteId
  email?: string;
  name?: string;
  linkedAt: string;
}

export interface ThreshPasskeyCredential {
  id: string; // credentialId (base64url)
  publicKeySpkiBase64: string; // DER-encoded SubjectPublicKeyInfo base64
  coseAlg?: number; // COSE algorithm identifier (e.g. -7 ES256, -257 RS256, -8 EdDSA)
  counter: number;
  transports?: string[];
  createdAt: string;
}

export interface ThreshConnectedService {
  service: 'strava' | 'garmin' | 'intervals' | 'wahoo' | 'polar';
  connectedAt: string;
  status: 'CONNECTED' | 'DISCONNECTED';
  athleteId?: string;
  athleteName?: string;
}

export interface ThreshUser {
  id: string; // 'usr_' + 16 random hex
  email: string;
  name: string;
  picture?: string;
  birthMonthYear?: string;
  role: 'athlete' | 'coach' | 'admin';
  createdAt: string;
  updatedAt: string;
  authProviders: ThreshUserAuthProvider[];
  passkeys?: ThreshPasskeyCredential[];
  connectedServices: ThreshConnectedService[];
}

function hashKey(val: string): string {
  return crypto
    .createHash('sha256')
    .update(String(val ?? '').toLowerCase().trim())
    .digest('hex')
    .slice(0, 32);
}

/**
 * Persists user document and indices into the encrypted vault.
 */
export async function saveUser(user: ThreshUser): Promise<void> {
  user.updatedAt = new Date().toISOString();
  await saveTenantVaultAsync(`user_${user.id}`, user);

  // Index by email if present
  if (user.email) {
    await saveTenantVaultAsync(`auth_email_${hashKey(user.email)}`, { userId: user.id });
  }

  // Index by each provider
  for (const p of user.authProviders) {
    const provKey = `auth_prov_${p.provider}_${hashKey(p.providerId)}`;
    await saveTenantVaultAsync(provKey, { userId: user.id });
  }
}

/**
 * Retrieves a user by their canonical MeetReady user ID.
 */
export async function getUserById(userId: string): Promise<ThreshUser | null> {
  if (!userId) return null;
  const cleanId = String(userId).trim();
  const user = await loadTenantVaultAsync<ThreshUser | null>(`user_${cleanId}`, null);
  return user;
}

/**
 * Retrieves a user by primary email address.
 */
export async function getUserByEmail(email: string): Promise<ThreshUser | null> {
  if (!email) return null;
  const indexDoc = await loadTenantVaultAsync<{ userId: string } | null>(
    `auth_email_${hashKey(email)}`,
    null
  );
  if (!indexDoc?.userId) return null;
  return getUserById(indexDoc.userId);
}

/**
 * Retrieves a user by provider and providerId (e.g. Google sub, Strava athleteId).
 */
export async function getUserByProvider(
  provider: string,
  providerId: string
): Promise<ThreshUser | null> {
  if (!provider || !providerId) return null;
  const provKey = `auth_prov_${provider}_${hashKey(providerId)}`;
  const indexDoc = await loadTenantVaultAsync<{ userId: string } | null>(provKey, null);
  if (!indexDoc?.userId) return null;
  return getUserById(indexDoc.userId);
}

/**
 * Finds or creates a user for the given provider authentication.
 * If a user with the same email already exists, links this provider to the existing account.
 */
export async function findOrCreateUser(
  provider: 'google' | 'magic_link' | 'passkey' | 'strava' | 'dev_mock',
  providerId: string,
  profile: { email?: string; name?: string; picture?: string }
): Promise<ThreshUser> {
  // 1. Try finding by this exact provider link
  let user = await getUserByProvider(provider, providerId);
  if (user) {
    // Update profile info if newly available
    let changed = false;
    if (profile.name && (!user.name || user.name === 'MeetReady Athlete')) {
      user.name = profile.name;
      changed = true;
    }
    if (profile.picture && !user.picture) {
      user.picture = profile.picture;
      changed = true;
    }
    if (profile.email && !user.email) {
      user.email = profile.email.toLowerCase().trim();
      changed = true;
    }
    if (changed) {
      await saveUser(user);
    }
    return user;
  }

  // 2. Try finding by email (account linking)
  const cleanEmail = (profile.email || '').toLowerCase().trim();
  if (cleanEmail) {
    user = await getUserByEmail(cleanEmail);
    if (user) {
      // Link provider to existing user
      const exists = user.authProviders.some(
        (p) => p.provider === provider && p.providerId === providerId
      );
      if (!exists) {
        user.authProviders.push({
          provider,
          providerId,
          email: cleanEmail,
          name: profile.name,
          linkedAt: new Date().toISOString(),
        });
      }
      if (profile.picture && !user.picture) user.picture = profile.picture;
      await saveUser(user);
      return user;
    }
  }

  // 3. Create fresh MeetReady user
  const newUserId = `usr_${crypto.randomBytes(8).toString('hex')}`;
  const now = new Date().toISOString();
  const newUser: ThreshUser = {
    id: newUserId,
    email: cleanEmail,
    name: profile.name?.trim() || (cleanEmail ? cleanEmail.split('@')[0] : 'MeetReady Athlete'),
    picture: profile.picture,
    role: 'athlete',
    createdAt: now,
    updatedAt: now,
    authProviders: [
      {
        provider,
        providerId,
        email: cleanEmail || undefined,
        name: profile.name,
        linkedAt: now,
      },
    ],
    passkeys: [],
    connectedServices: [],
  };

  // If this was a Strava sign-in, record Strava as connected service
  if (provider === 'strava') {
    newUser.connectedServices.push({
      service: 'strava',
      connectedAt: now,
      status: 'CONNECTED',
      athleteId: providerId,
      athleteName: profile.name,
    });
  }

  await saveUser(newUser);
  return newUser;
}

/**
 * Links a new auth provider to an existing user account.
 */
export async function linkProviderToUser(
  userId: string,
  provider: 'google' | 'magic_link' | 'passkey' | 'strava' | 'dev_mock',
  providerId: string,
  profile?: { email?: string; name?: string }
): Promise<ThreshUser | null> {
  const user = await getUserById(userId);
  if (!user) return null;

  const existing = user.authProviders.find(
    (p) => p.provider === provider && p.providerId === providerId
  );
  if (!existing) {
    user.authProviders.push({
      provider,
      providerId,
      email: profile?.email,
      name: profile?.name,
      linkedAt: new Date().toISOString(),
    });
    await saveUser(user);
  }
  return user;
}

/**
 * Unlinks an auth provider from an account, guaranteeing at least one login method remains.
 */
export async function unlinkProviderFromUser(
  userId: string,
  provider: string
): Promise<{ ok: boolean; error?: string }> {
  const user = await getUserById(userId);
  if (!user) return { ok: false, error: 'User not found' };

  if (user.authProviders.length <= 1) {
    return {
      ok: false,
      error: 'Cannot remove your last remaining login method.',
    };
  }

  const removedProviders = user.authProviders.filter((p) => p.provider === provider);
  user.authProviders = user.authProviders.filter((p) => p.provider !== provider);
  await saveUser(user);
  for (const removed of removedProviders) {
    await deleteTenantVault(`auth_prov_${removed.provider}_${hashKey(removed.providerId)}`);
  }
  return { ok: true };
}

/**
 * Migrates a MeetReady user's primary login email (e.g. graduating high school/college
 * seniors moving off @students.district.org before summer account deactivation).
 */
export async function updateUserPrimaryEmail(
  userId: string,
  newEmail: string
): Promise<{ ok: boolean; user?: ThreshUser; oldEmail?: string; error?: string }> {
  const cleanNewEmail = String(newEmail || '').trim().toLowerCase();
  if (!cleanNewEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanNewEmail)) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }
  const user = await getUserById(userId);
  if (!user) return { ok: false, error: 'User not found.' };

  const existingOwner = await getUserByEmail(cleanNewEmail);
  if (existingOwner && existingOwner.id !== user.id) {
    return {
      ok: false,
      error: 'That email is already linked to another MeetReady account.',
    };
  }

  const oldEmail = (user.email || '').trim().toLowerCase();
  if (oldEmail && oldEmail !== cleanNewEmail) {
    await deleteTenantVault(`auth_email_${hashKey(oldEmail)}`);
  }

  const existingMagicLinks = user.authProviders.filter((p) => p.provider === 'magic_link');
  user.authProviders = user.authProviders.filter((p) => p.provider !== 'magic_link');
  for (const ml of existingMagicLinks) {
    if (ml.providerId && ml.providerId.toLowerCase() !== cleanNewEmail) {
      await deleteTenantVault(`auth_prov_magic_link_${hashKey(ml.providerId)}`);
    }
  }
  user.authProviders.push({
    provider: 'magic_link',
    providerId: cleanNewEmail,
    email: cleanNewEmail,
    name: user.name,
    linkedAt: new Date().toISOString(),
  });
  user.email = cleanNewEmail;
  await saveUser(user);
  return { ok: true, user, oldEmail: oldEmail || undefined };
}

export function hashAuthLookupKey(val: string): string {
  return hashKey(val);
}

export async function updateUserBirthMonthYear(
  userId: string,
  birthMonthYear: string
): Promise<ThreshUser | null> {
  const clean = String(birthMonthYear || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(clean)) return null;
  const user = await getUserById(userId);
  if (!user) return null;
  if (user.birthMonthYear !== clean) {
    user.birthMonthYear = clean;
    await saveUser(user);
  }
  return user;
}

/**
 * Records or updates a connected telemetry service (Strava, Garmin, intervals.icu).
 */
export async function connectServiceToUser(
  userId: string,
  service: 'strava' | 'garmin' | 'intervals' | 'wahoo' | 'polar',
  serviceAthleteId?: string,
  athleteName?: string
): Promise<ThreshUser | null> {
  const user = await getUserById(userId);
  if (!user) return null;

  const existingIdx = user.connectedServices.findIndex((s) => s.service === service);
  const now = new Date().toISOString();
  if (existingIdx >= 0) {
    user.connectedServices[existingIdx] = {
      ...user.connectedServices[existingIdx],
      status: 'CONNECTED',
      athleteId: serviceAthleteId || user.connectedServices[existingIdx].athleteId,
      athleteName: athleteName || user.connectedServices[existingIdx].athleteName,
      connectedAt: now,
    };
  } else {
    user.connectedServices.push({
      service,
      status: 'CONNECTED',
      athleteId: serviceAthleteId,
      athleteName,
      connectedAt: now,
    });
  }

  await saveUser(user);
  return user;
}

/**
 * Disconnects a telemetry service from a user.
 */
export async function disconnectServiceFromUser(
  userId: string,
  service: 'strava' | 'garmin' | 'intervals' | 'wahoo' | 'polar'
): Promise<ThreshUser | null> {
  const user = await getUserById(userId);
  if (!user) return null;

  const existingIdx = user.connectedServices.findIndex((s) => s.service === service);
  if (existingIdx >= 0) {
    user.connectedServices[existingIdx].status = 'DISCONNECTED';
    await saveUser(user);
  }
  return user;
}

/* ========================================================================== */
/* Email Magic Link Implementation (100% Free - Resend / Dev Simulation)     */
/* ========================================================================== */

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface PendingJoinContext {
  joinCode?: string;
  slug?: string;
  inviteToken?: string;
}

interface MagicLinkRecord {
  email: string;
  expiresAt: number;
  pendingJoin?: PendingJoinContext;
}

export async function createMagicLinkToken(
  email: string,
  pendingJoin?: PendingJoinContext
): Promise<{ token: string; expiresAt: number }> {
  const cleanEmail = email.toLowerCase().trim();
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = Date.now() + MAGIC_LINK_TTL_MS;

  await saveTenantVaultAsync(`magic_link_${tokenHash}`, {
    email: cleanEmail,
    expiresAt,
    ...(pendingJoin?.joinCode || pendingJoin?.slug || pendingJoin?.inviteToken
      ? { pendingJoin }
      : {}),
  });

  return { token: rawToken, expiresAt };
}

export async function peekMagicLinkPayload(
  rawToken: string
): Promise<{ email: string; pendingJoin?: PendingJoinContext } | null> {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
  const record = await loadTenantVaultAsync<MagicLinkRecord | null>(`magic_link_${tokenHash}`, null);

  if (!record || !record.email || !record.expiresAt) {
    return null;
  }

  if (Date.now() > record.expiresAt) {
    await saveTenantVaultAsync(`magic_link_${tokenHash}`, null);
    return null;
  }

  return { email: record.email, pendingJoin: record.pendingJoin };
}

export async function verifyMagicLinkPayload(
  rawToken: string
): Promise<{ email: string; pendingJoin?: PendingJoinContext } | null> {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
  const vaultKey = `magic_link_${tokenHash}`;
  return withVaultLock(vaultKey, async () => {
    const record = await loadTenantVaultAsync<MagicLinkRecord | null>(vaultKey, null);

    if (!record || !record.email || !record.expiresAt) {
      return null;
    }

    await saveTenantVaultAsync(vaultKey, null);
    if (Date.now() > record.expiresAt) {
      return null;
    }

    return { email: record.email, pendingJoin: record.pendingJoin };
  });
}

export async function verifyMagicLinkToken(rawToken: string): Promise<string | null> {
  const payload = await verifyMagicLinkPayload(rawToken);
  return payload?.email ?? null;
}

export async function sendMagicLinkEmail(
  email: string,
  verifyUrl: string
): Promise<{ sent: boolean; devMode?: boolean; previewUrl?: string; error?: string }> {
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const safeVerifyUrl = escapeHtml(verifyUrl);

  // If Resend API key is configured, send via Resend free tier (3,000/mo)
  if (resendApiKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.AUTH_EMAIL_FROM || 'MeetReady <auth@meetready.app>',
          to: [email],
          subject: 'Sign in to MeetReady',
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #0E1612; color: #E2E8F0; border-radius: 16px;">
              <h2 style="color: #C8FF00; margin-top: 0;">Sign in to MeetReady</h2>
              <p style="font-size: 14px; line-height: 1.6; color: #94A3B8;">Click the secure link below to sign in to your MeetReady endurance training cockpit. This link expires in 15 minutes.</p>
              <div style="margin: 24px 0;">
                <a href="${safeVerifyUrl}" style="background: #C8FF00; color: #0E1612; font-weight: 700; text-decoration: none; padding: 12px 24px; border-radius: 12px; display: inline-block; font-size: 14px;">Sign In to MeetReady</a>
              </div>
              <p style="font-size: 12px; color: #64748B;">If you didn't request this email, you can safely ignore it.</p>
            </div>
          `,
        }),
      });

      if (res.ok) {
        return { sent: true };
      }
      console.warn('[MeetReady Auth] Resend email send failed:', await res.text());
    } catch (err) {
      console.error('[MeetReady Auth] Failed sending email via Resend:', err);
    }
  }

  // Fail closed in production deployments (never leak magic link URLs in HTTP responses)
  if (isProductionDeployment()) {
    return {
      sent: false,
      error: 'Email delivery service is temporarily unavailable. Please try Google, Passkey, or Strava.',
    };
  }

  // Fallback to local / dev mode preview URL strictly in non-production environments
  return {
    sent: true,
    devMode: true,
    previewUrl: verifyUrl,
  };
}

/* ========================================================================== */
/* Verified Primary Email Change Flow                                         */
/* ========================================================================== */

interface PendingEmailChangeRecord {
  newEmail: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
}

export async function createPendingEmailChange(
  userId: string,
  newEmail: string
): Promise<{ ok: boolean; error?: string; devMode?: boolean; devCode?: string }> {
  const cleanNewEmail = String(newEmail || '').trim().toLowerCase();
  if (!cleanNewEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanNewEmail)) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }
  const user = await getUserById(userId);
  if (!user) return { ok: false, error: 'User not found.' };

  const existingOwner = await getUserByEmail(cleanNewEmail);
  if (existingOwner && existingOwner.id !== user.id) {
    return {
      ok: false,
      error: 'That email is already linked to another MeetReady account.',
    };
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  await saveTenantVaultAsync(`email_change_${user.id}`, {
    newEmail: cleanNewEmail,
    codeHash,
    expiresAt: Date.now() + 15 * 60 * 1000,
    attempts: 0,
  } satisfies PendingEmailChangeRecord);

  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  if (resendApiKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.AUTH_EMAIL_FROM || 'MeetReady <auth@meetready.app>',
          to: [cleanNewEmail],
          subject: 'Verify your new MeetReady email address',
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #0E1612; color: #E2E8F0; border-radius: 16px;">
              <h2 style="color: #C8FF00; margin-top: 0;">Confirm Email Change</h2>
              <p style="font-size: 14px; line-height: 1.6; color: #94A3B8;">Enter this 6-digit verification code in MeetReady to confirm moving your primary login email to <strong>${escapeHtml(cleanNewEmail)}</strong>:</p>
              <div style="margin: 20px 0; font-family: monospace; font-size: 28px; font-weight: 800; letter-spacing: 0.2em; color: #C8FF00;">${escapeHtml(code)}</div>
              <p style="font-size: 12px; color: #64748B;">This code expires in 15 minutes. If you did not request this change, you can ignore this email.</p>
            </div>
          `,
        }),
      });
      if (res.ok) {
        return { ok: true };
      }
      console.warn('[MeetReady Auth] Resend email-change dispatch failed:', await res.text());
    } catch (err) {
      console.error('[MeetReady Auth] Failed sending email-change code via Resend:', err);
    }
  }

  if (isProductionDeployment()) {
    await saveTenantVaultAsync(`email_change_${user.id}`, null);
    return {
      ok: false,
      error: 'Email verification service is unavailable right now. Please try again shortly.',
    };
  }

  return { ok: true, devMode: true, devCode: code };
}

export async function verifyAndCommitEmailChange(
  userId: string,
  rawCode: string,
  expectedNewEmail?: string
): Promise<{ ok: boolean; user?: ThreshUser; oldEmail?: string; newEmail?: string; error?: string }> {
  const cleanCode = String(rawCode || '').trim();
  if (!/^\d{6}$/.test(cleanCode)) {
    return { ok: false, error: 'Please enter the 6-digit verification code sent to your new email.' };
  }
  const vaultKey = `email_change_${userId}`;
  return withVaultLock(vaultKey, async () => {
    const rec = await loadTenantVaultAsync<PendingEmailChangeRecord | null>(vaultKey, null);
    if (!rec || !rec.newEmail || !rec.codeHash || !rec.expiresAt) {
      return { ok: false, error: 'No pending email verification request found. Request a new code.' };
    }
    if (Date.now() > rec.expiresAt) {
      await saveTenantVaultAsync(vaultKey, null);
      return { ok: false, error: 'Verification code has expired. Please request a new code.' };
    }
    if (expectedNewEmail && expectedNewEmail.trim().toLowerCase() !== rec.newEmail) {
      return { ok: false, error: 'Verification code was issued for a different email address.' };
    }
    if (rec.attempts >= 5) {
      await saveTenantVaultAsync(vaultKey, null);
      return { ok: false, error: 'Too many invalid attempts. Please request a new verification code.' };
    }

    const incomingHash = crypto.createHash('sha256').update(cleanCode).digest('hex');
    if (!timingSafeStringEqual(incomingHash, rec.codeHash)) {
      rec.attempts += 1;
      await saveTenantVaultAsync(vaultKey, rec);
      return { ok: false, error: 'Invalid verification code.' };
    }

    await saveTenantVaultAsync(vaultKey, null);
    const updated = await updateUserPrimaryEmail(userId, rec.newEmail);
    if (!updated.ok || !updated.user) {
      return { ok: false, error: updated.error || 'Could not update email.' };
    }
    return {
      ok: true,
      user: updated.user,
      oldEmail: updated.oldEmail,
      newEmail: rec.newEmail,
    };
  });
}

/* ========================================================================== */
/* Passkeys / WebAuthn Challenge & State Verification                         */
/* ========================================================================== */

export function issuePasskeyChallengeToken(payload: {
  challenge: string;
  purpose: 'register' | 'auth';
  userId?: string;
}): string {
  const data = JSON.stringify({
    ...payload,
    jti: crypto.randomBytes(12).toString('hex'),
    exp: Date.now() + 5 * 60 * 1000, // 5 min TTL
  });
  const b64 = Buffer.from(data, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getPasskeyChallengeSecret()).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

export function verifyPasskeyChallengeToken(token?: string | null): {
  challenge: string;
  purpose: 'register' | 'auth';
  userId?: string;
  jti?: string;
} | null {
  if (!token) return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getPasskeyChallengeSecret())
    .update(b64)
    .digest('base64url');

  if (!timingSafeStringEqual(sig, expectedSig)) return null;

  try {
    const claims = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (!claims.exp || Date.now() > claims.exp) return null;
    return claims;
  } catch {
    return null;
  }
}
