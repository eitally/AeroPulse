import crypto from 'crypto';
import { loadTenantVaultAsync, saveTenantVaultAsync } from './tokenVault.ts';

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
  role: 'athlete' | 'coach' | 'admin';
  createdAt: string;
  updatedAt: string;
  authProviders: ThreshUserAuthProvider[];
  passkeys?: ThreshPasskeyCredential[];
  connectedServices: ThreshConnectedService[];
}

function hashKey(val: string): string {
  return crypto.createHash('sha256').update(val.toLowerCase().trim()).digest('hex').slice(0, 32);
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
 * Retrieves a user by their canonical THRESH user ID.
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
    if (profile.name && (!user.name || user.name === 'THRESH Athlete')) {
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

  // 3. Create fresh THRESH user
  const newUserId = `usr_${crypto.randomBytes(8).toString('hex')}`;
  const now = new Date().toISOString();
  const newUser: ThreshUser = {
    id: newUserId,
    email: cleanEmail,
    name: profile.name?.trim() || (cleanEmail ? cleanEmail.split('@')[0] : 'THRESH Athlete'),
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

  user.authProviders = user.authProviders.filter((p) => p.provider !== provider);
  await saveUser(user);
  return { ok: true };
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

interface MagicLinkRecord {
  email: string;
  expiresAt: number;
}

export async function createMagicLinkToken(email: string): Promise<{ token: string; expiresAt: number }> {
  const cleanEmail = email.toLowerCase().trim();
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = Date.now() + MAGIC_LINK_TTL_MS;

  await saveTenantVaultAsync(`magic_link_${tokenHash}`, {
    email: cleanEmail,
    expiresAt,
  });

  return { token: rawToken, expiresAt };
}

export async function verifyMagicLinkToken(rawToken: string): Promise<string | null> {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
  const record = await loadTenantVaultAsync<MagicLinkRecord | null>(`magic_link_${tokenHash}`, null);

  if (!record || !record.email || !record.expiresAt) {
    return null;
  }

  if (Date.now() > record.expiresAt) {
    // Expired
    await saveTenantVaultAsync(`magic_link_${tokenHash}`, null);
    return null;
  }

  // Valid single-use token: consume it
  await saveTenantVaultAsync(`magic_link_${tokenHash}`, null);
  return record.email;
}

export async function sendMagicLinkEmail(
  email: string,
  verifyUrl: string
): Promise<{ sent: boolean; devMode?: boolean; previewUrl?: string }> {
  const resendApiKey = process.env.RESEND_API_KEY?.trim();

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
          from: process.env.AUTH_EMAIL_FROM || 'THRESH <auth@thresh.run>',
          to: [email],
          subject: 'Sign in to THRESH',
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #0E1612; color: #E2E8F0; border-radius: 16px;">
              <h2 style="color: #C8FF00; margin-top: 0;">Sign in to THRESH</h2>
              <p style="font-size: 14px; line-height: 1.6; color: #94A3B8;">Click the secure link below to sign in to your THRESH endurance training cockpit. This link expires in 15 minutes.</p>
              <div style="margin: 24px 0;">
                <a href="${verifyUrl}" style="background: #C8FF00; color: #0E1612; font-weight: 700; text-decoration: none; padding: 12px 24px; border-radius: 12px; display: inline-block; font-size: 14px;">Sign In to THRESH</a>
              </div>
              <p style="font-size: 12px; color: #64748B;">If you didn't request this email, you can safely ignore it.</p>
            </div>
          `,
        }),
      });

      if (res.ok) {
        return { sent: true };
      }
      console.warn('[THRESH Auth] Resend email send failed:', await res.text());
    } catch (err) {
      console.error('[THRESH Auth] Failed sending email via Resend:', err);
    }
  }

  // Fallback to local / dev mode preview URL
  return {
    sent: true,
    devMode: true,
    previewUrl: verifyUrl,
  };
}

/* ========================================================================== */
/* Passkeys / WebAuthn Challenge & State Verification                         */
/* ========================================================================== */

const PASSPORT_STATE_SECRET = 'thresh-passkey-state-v1';

export function issuePasskeyChallengeToken(payload: {
  challenge: string;
  purpose: 'register' | 'auth';
  userId?: string;
}): string {
  const data = JSON.stringify({
    ...payload,
    exp: Date.now() + 5 * 60 * 1000, // 5 min TTL
  });
  const b64 = Buffer.from(data, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', PASSPORT_STATE_SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

export function verifyPasskeyChallengeToken(token?: string | null): {
  challenge: string;
  purpose: 'register' | 'auth';
  userId?: string;
} | null {
  if (!token) return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', PASSPORT_STATE_SECRET)
    .update(b64)
    .digest('base64url');

  if (sig !== expectedSig) return null;

  try {
    const claims = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (!claims.exp || Date.now() > claims.exp) return null;
    return claims;
  } catch {
    return null;
  }
}
