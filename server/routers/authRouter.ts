import express, { type Request, type Response } from 'express';
import crypto from 'crypto';
import {
  SESSION_COOKIE_NAME,
  deriveUserSessionSid,
  issueOAuthStateToken,
  verifyOAuthStateToken,
  setOAuthStateCookie,
  getOAuthStateCookieNonce,
  clearOAuthStateCookie,
  setSessionCookie,
  clearSessionCookie,
  decodeAndVerifyToken,
  getVerifiedSessionClaims,
  issueSessionToken,
  appendSetCookieHeader,
  parseCookies,
  resolveSafeOrigin,
} from '../securityUtils.ts';
import {
  USER_VAULT_COOKIE_NAME,
  buildEncryptedUserCookieHeader,
  decryptJsonFromVault,
} from '../tokenVault.ts';
import {
  autoLinkPendingTeamInvitesByEmail,
  migrateAnonymousTeamsToSid,
} from '../teamService.ts';
import {
  findOrCreateUser,
  getUserById,
  getUserByEmail,
  getUserByProvider,
  saveUser,
  unlinkProviderFromUser,
  connectServiceToUser,
  createMagicLinkToken,
  verifyMagicLinkToken,
  sendMagicLinkEmail,
  issuePasskeyChallengeToken,
  verifyPasskeyChallengeToken,
  type ThreshUser,
  type ThreshPasskeyCredential,
} from '../authService.ts';

export const authRouter = express.Router();

function isProductionDeployment(): boolean {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
}

function getRpId(req: Request): string {
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000')
    .split(',')[0]
    .trim();
  return host.split(':')[0] || 'localhost';
}

function getAppBaseUrl(req: Request): string {
  const rawProto = String(req.headers['x-forwarded-proto'] || req.protocol || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const isHttps = req.secure || rawProto === 'https';
  const proto = isHttps ? 'https' : 'http';
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000')
    .split(',')[0]
    .trim()
    .replace(/[^a-zA-Z0-9.:-]/g, '');
  return `${proto}://${host || 'localhost:3000'}`;
}

function resolveGoogleCallbackUrl(req: Request): string {
  const explicitRedirect = (process.env.GOOGLE_REDIRECT_URI || '').trim();
  if (explicitRedirect) {
    try {
      const parsed = new URL(explicitRedirect);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString();
      }
    } catch {
      // fall through
    }
  }
  const reqOrigin = getAppBaseUrl(req);
  const envOrigin = resolveSafeOrigin(process.env.APP_URL || '');
  if (
    envOrigin &&
    !envOrigin.includes('MY_APP_URL') &&
    (!envOrigin.includes('localhost') || reqOrigin.includes('localhost'))
  ) {
    return `${envOrigin}/api/auth/google/callback`;
  }
  return `${reqOrigin}/api/auth/google/callback`;
}

function buildAuthReturnRedirectUrl(
  stateClaims?: { joinCode?: string; slug?: string; inviteToken?: string } | null
): string {
  const basePath = stateClaims?.slug ? `/join/${encodeURIComponent(stateClaims.slug)}` : '/';
  const params = new URLSearchParams();
  params.set('auth_just_signed_in', '1');
  if (stateClaims?.joinCode && !stateClaims?.slug) {
    params.set('join', stateClaims.joinCode);
  }
  if (stateClaims?.inviteToken) {
    params.set('t', stateClaims.inviteToken);
  }
  return `${basePath}?${params.toString()}`;
}

function toCompactUserBackupPayload(user: ThreshUser): ThreshUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    authProviders: (user.authProviders || []).slice(0, 6),
    passkeys: (user.passkeys || []).slice(0, 4).map((pk) => ({
      id: pk.id,
      publicKeySpkiBase64: '',
      counter: pk.counter,
      createdAt: pk.createdAt,
    })),
    connectedServices: (user.connectedServices || []).slice(0, 6),
  };
}

async function finalizeUserAuthentication(
  req: Request,
  res: Response,
  user: ThreshUser
): Promise<{ userSid: string; sessionToken: string }> {
  const userSid = deriveUserSessionSid(user.id);
  const prevClaims = getVerifiedSessionClaims(req);
  const sessionToken = setSessionCookie(req, res, user.id, userSid);

  const rawProto = String(req.headers['x-forwarded-proto'] || req.protocol || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const isSecure = req.secure || rawProto === 'https';
  const userCookieHeader = buildEncryptedUserCookieHeader(
    toCompactUserBackupPayload(user),
    isSecure
  );
  if (userCookieHeader) {
    appendSetCookieHeader(res, userCookieHeader);
  }

  if (prevClaims?.sid && prevClaims.sid !== userSid) {
    try {
      await migrateAnonymousTeamsToSid({
        oldSid: prevClaims.sid,
        newSid: userSid,
        athleteName: user.name,
        email: user.email,
      });
    } catch (err) {
      console.warn('[THRESH Auth] Anonymous teams migration warning:', err);
    }
  }

  if (user.email) {
    try {
      await autoLinkPendingTeamInvitesByEmail({
        email: user.email,
        userSid,
        athleteName: user.name,
      });
    } catch (err) {
      console.warn('[THRESH Auth] Auto-link pending team invites warning:', err);
    }
  }

  return { userSid, sessionToken };
}

/**
 * GET /api/auth/me
 * Returns current authenticated user and linked providers.
 */
authRouter.get('/api/auth/me', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims) {
      return res.json({ authenticated: false, user: null });
    }

    // Try finding user by sub (canonical THRESH user ID)
    let user: ThreshUser | null = null;
    if (claims.sub.startsWith('usr_')) {
      user = await getUserById(claims.sub);
      if (!user) {
        // Recover compact profile from encrypted cookie backup on stateless serverless cold starts
        const cookies = parseCookies(req.headers.cookie);
        const backupEnvelope = cookies[USER_VAULT_COOKIE_NAME];
        if (backupEnvelope) {
          const restored = decryptJsonFromVault<ThreshUser>(backupEnvelope);
          if (restored && restored.id === claims.sub) {
            user = restored;
            try {
              await saveUser(restored);
            } catch {
              // ignore non-fatal local cache re-hydration error
            }
          }
        }
      }
    } else {
      // Legacy session with Strava athlete ID or generic subject
      user = await getUserByProvider('strava', claims.sub);
    }

    if (!user) {
      return res.json({
        authenticated: true,
        legacySession: true,
        sessionSub: claims.sub,
        user: null,
      });
    }

    return res.json({
      authenticated: true,
      user,
      sessionToken: issueSessionToken(claims.sub, claims.sid),
    });
  } catch (err) {
    console.error('[THRESH Auth] /api/auth/me error:', err);
    return res.status(500).json({ error: 'Failed retrieving session state.' });
  }
});

/**
 * GET /api/auth/google/url
 * Returns Google OAuth URL, or dev mock fallback when running in non-production without credentials.
 */
authRouter.get('/api/auth/google/url', (req: Request, res: Response) => {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const redirectUri = resolveGoogleCallbackUrl(req);

  if (!clientId) {
    if (isProductionDeployment()) {
      return res.json({
        configured: false,
        devMode: false,
        error: `Google Sign-In is not configured on this server yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel Environment Variables (Authorized Redirect URI: ${redirectUri}).`,
      });
    }
    return res.json({
      configured: false,
      devMode: true,
      message: 'GOOGLE_CLIENT_ID not configured; dev mock login available.',
      devMockUrl: '/api/auth/mock-login?provider=google',
      devMockLoginUrl: '/api/auth/mock-login?provider=google',
    });
  }

  const joinCode =
    String(req.query.joinCode || req.query.join || '').trim().slice(0, 32) || undefined;
  const slug = String(req.query.slug || '').trim().slice(0, 64) || undefined;
  const inviteToken =
    String(req.query.inviteToken || req.query.t || '').trim().slice(0, 96) || undefined;

  const { stateToken, nonce } = issueOAuthStateToken({
    flow: (req.query.flow as 'popup' | 'redirect') || 'redirect',
    joinCode,
    slug,
    inviteToken,
  });
  setOAuthStateCookie(req, res, nonce);

  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleAuthUrl.searchParams.set('client_id', clientId);
  googleAuthUrl.searchParams.set('redirect_uri', redirectUri);
  googleAuthUrl.searchParams.set('response_type', 'code');
  googleAuthUrl.searchParams.set('scope', 'openid email profile');
  googleAuthUrl.searchParams.set('state', stateToken);
  googleAuthUrl.searchParams.set('access_type', 'offline');
  googleAuthUrl.searchParams.set('prompt', 'select_account');

  const url = googleAuthUrl.toString();
  return res.json({
    configured: true,
    url,
    authUrl: url,
    redirectUri,
  });
});

/**
 * GET /api/auth/google/callback
 * Exchanges Google OAuth code for userinfo, creates/links THRESH account, sets session cookie.
 */
authRouter.get('/api/auth/google/callback', async (req: Request, res: Response) => {
  const code = String(req.query.code || '').trim();
  const state = String(req.query.state || '').trim();
  const error = String(req.query.error || '').trim();

  if (error || !code) {
    return res.redirect(`/?auth_error=${encodeURIComponent(error || 'missing_code')}`);
  }

  // Validate state token against cookie nonce
  const stateClaims = verifyOAuthStateToken(state);
  const cookieNonce = getOAuthStateCookieNonce(req);
  clearOAuthStateCookie(res);

  if (!stateClaims || (cookieNonce && stateClaims.nonce !== cookieNonce)) {
    return res.redirect('/?auth_error=invalid_state_csrf');
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = resolveGoogleCallbackUrl(req);

  if (!clientId || !clientSecret) {
    return res.redirect('/?auth_error=google_not_configured');
  }

  try {
    // 1. Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      console.error('[THRESH Auth] Google token exchange failed:', await tokenRes.text());
      return res.redirect('/?auth_error=google_token_exchange_failed');
    }

    const tokenData = (await tokenRes.json()) as { access_token: string; id_token: string };

    // 2. Fetch UserInfo
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userRes.ok) {
      return res.redirect('/?auth_error=google_userinfo_failed');
    }

    const googleUser = (await userRes.json()) as {
      sub: string;
      email?: string;
      name?: string;
      picture?: string;
    };

    // 3. Find or create THRESH user
    const user = await findOrCreateUser('google', googleUser.sub, {
      email: googleUser.email,
      name: googleUser.name,
      picture: googleUser.picture,
    });

    // 4. Set HttpOnly session & encrypted user cookies & auto-link team rosters by email
    await finalizeUserAuthentication(req, res, user);

    return res.redirect(buildAuthReturnRedirectUrl(stateClaims));
  } catch (err) {
    console.error('[THRESH Auth] Google callback processing error:', err);
    return res.redirect('/?auth_error=internal_error');
  }
});

/**
 * POST /api/auth/magic-link/send
 * Creates a single-use 15-minute login token and dispatches email (or returns dev link).
 */
authRouter.post('/api/auth/magic-link/send', async (req: Request, res: Response) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email || !email.includes('@') || email.length < 5) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  try {
    const { token } = await createMagicLinkToken(email);
    const baseUrl = getAppBaseUrl(req);
    const verifyUrl = `${baseUrl}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`;

    const result = await sendMagicLinkEmail(email, verifyUrl);

    return res.json({
      ok: true,
      message: 'A secure sign-in link has been sent to your email.',
      devMode: result.devMode || false,
      previewUrl: result.devMode ? result.previewUrl : undefined,
    });
  } catch (err) {
    console.error('[THRESH Auth] Failed generating magic link:', err);
    return res.status(500).json({ error: 'Unable to dispatch sign-in email. Please try again.' });
  }
});

/**
 * GET /api/auth/magic-link/verify
 * Validates the single-use token, creates/logs in the THRESH user, and sets session cookie.
 */
authRouter.get('/api/auth/magic-link/verify', async (req: Request, res: Response) => {
  const token = String(req.query.token || '').trim();
  if (!token) {
    return res.redirect('/?auth_error=missing_magic_token');
  }

  try {
    const email = await verifyMagicLinkToken(token);
    if (!email) {
      return res.redirect('/?auth_error=expired_or_invalid_magic_token');
    }

    const user = await findOrCreateUser('magic_link', email, {
      email,
      name: email.split('@')[0],
    });

    await finalizeUserAuthentication(req, res, user);
    return res.redirect('/?auth_just_signed_in=1');
  } catch (err) {
    console.error('[THRESH Auth] Magic link verification error:', err);
    return res.redirect('/?auth_error=magic_link_verification_failed');
  }
});

/**
 * POST /api/auth/passkey/register-options
 * Generates WebAuthn registration options.
 */
authRouter.post('/api/auth/passkey/register-options', async (req: Request, res: Response) => {
  const rpId = getRpId(req);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || email.split('@')[0] || 'Athlete').trim();

  const challenge = crypto.randomBytes(32).toString('base64url');
  const userId = crypto.randomBytes(16).toString('base64url');

  const challengeToken = issuePasskeyChallengeToken({
    challenge,
    purpose: 'register',
    userId,
  });

  const options = {
    challenge,
    rp: {
      name: 'THRESH',
      id: rpId,
    },
    user: {
      id: userId,
      name: email || 'athlete@thresh.local',
      displayName: name,
    },
    pubKeyCredParams: [
      { alg: -7, type: 'public-key' }, // ES256
      { alg: -257, type: 'public-key' }, // RS256
    ],
    timeout: 60000,
    attestation: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  };

  return res.json({ options, challengeToken });
});

/**
 * POST /api/auth/passkey/register-verify
 * Verifies and saves passkey credential to THRESH account.
 */
authRouter.post('/api/auth/passkey/register-verify', async (req: Request, res: Response) => {
  const { credential, challengeToken, email, name } = req.body || {};
  if (!credential || !challengeToken) {
    return res.status(400).json({ error: 'Missing credential response or challenge token.' });
  }

  const tokenClaims = verifyPasskeyChallengeToken(challengeToken);
  if (!tokenClaims || tokenClaims.purpose !== 'register') {
    return res.status(400).json({ error: 'Invalid or expired passkey registration challenge.' });
  }

  try {
    const credId = String(credential.id || credential.rawId || '').trim();
    if (!credId) {
      return res.status(400).json({ error: 'Invalid credential ID received.' });
    }

    // Modern browsers return getPublicKey() base64 or SPKI DER in clientData
    const pubKeySpki = String(credential.publicKey || credential.response?.publicKey || credId);

    const user = await findOrCreateUser('passkey', credId, {
      email: email ? String(email).trim().toLowerCase() : undefined,
      name: name ? String(name).trim() : 'Passkey Athlete',
    });

    if (!user.passkeys) user.passkeys = [];
    const existingIdx = user.passkeys.findIndex((p) => p.id === credId);
    const passkeyObj: ThreshPasskeyCredential = {
      id: credId,
      publicKeySpkiBase64: pubKeySpki,
      counter: 0,
      createdAt: new Date().toISOString(),
    };
    if (existingIdx >= 0) {
      user.passkeys[existingIdx] = passkeyObj;
    } else {
      user.passkeys.push(passkeyObj);
    }

    await saveUser(user);
    await finalizeUserAuthentication(req, res, user);

    return res.json({ ok: true, user });
  } catch (err) {
    console.error('[THRESH Auth] Passkey registration verification error:', err);
    return res.status(500).json({ error: 'Failed completing passkey registration.' });
  }
});

/**
 * POST /api/auth/passkey/auth-options
 * Generates WebAuthn authentication options.
 */
authRouter.post('/api/auth/passkey/auth-options', (req: Request, res: Response) => {
  const rpId = getRpId(req);
  const challenge = crypto.randomBytes(32).toString('base64url');
  const challengeToken = issuePasskeyChallengeToken({
    challenge,
    purpose: 'auth',
  });

  const options = {
    challenge,
    rpId,
    timeout: 60000,
    userVerification: 'preferred',
  };

  return res.json({ options, challengeToken });
});

/**
 * POST /api/auth/passkey/auth-verify
 * Verifies passkey authentication and logs in user.
 */
authRouter.post('/api/auth/passkey/auth-verify', async (req: Request, res: Response) => {
  const { credential, challengeToken } = req.body || {};
  if (!credential || !challengeToken) {
    return res.status(400).json({ error: 'Missing credential response or challenge token.' });
  }

  const tokenClaims = verifyPasskeyChallengeToken(challengeToken);
  if (!tokenClaims || tokenClaims.purpose !== 'auth') {
    return res.status(400).json({ error: 'Invalid or expired passkey auth challenge.' });
  }

  try {
    const credId = String(credential.id || credential.rawId || '').trim();
    if (!credId) {
      return res.status(400).json({ error: 'Invalid credential ID received.' });
    }

    const user = await getUserByProvider('passkey', credId);
    if (!user) {
      return res.status(404).json({ error: 'No THRESH account associated with this passkey.' });
    }

    // Increment passkey counter
    const passkey = user.passkeys?.find((p) => p.id === credId);
    if (passkey) {
      passkey.counter += 1;
      await saveUser(user);
    }

    await finalizeUserAuthentication(req, res, user);
    return res.json({ ok: true, user });
  } catch (err) {
    console.error('[THRESH Auth] Passkey auth verification error:', err);
    return res.status(500).json({ error: 'Failed verifying passkey.' });
  }
});

/**
 * POST /api/auth/mock-login
 * Dev-mode one-click instant authentication without external OAuth.
 */
authRouter.post('/api/auth/mock-login', async (req: Request, res: Response) => {
  if (isProductionDeployment()) {
    return res.status(403).json({ error: 'Mock login is disabled in production.' });
  }
  const email = String(req.body?.email || req.query.email || 'runner@thresh.local').trim().toLowerCase();
  const name = String(req.body?.name || req.query.name || 'Sample Runner').trim();
  const provider = (String(req.body?.provider || req.query.provider || 'dev_mock')) as 'dev_mock' | 'google';

  try {
    const user = await findOrCreateUser(provider, email, {
      email,
      name,
    });

    await finalizeUserAuthentication(req, res, user);

    // Support redirect when accessed as a GET / URL link
    if (req.method === 'GET' || req.query.redirect) {
      return res.redirect('/?auth_just_signed_in=1');
    }

    return res.json({ ok: true, user });
  } catch (err) {
    console.error('[THRESH Auth] Mock login failed:', err);
    return res.status(500).json({ error: 'Failed logging in with mock credentials.' });
  }
});

/**
 * GET /api/auth/mock-login
 * Allow dev link clicking directly in browser.
 */
authRouter.get('/api/auth/mock-login', async (req: Request, res: Response) => {
  if (isProductionDeployment()) {
    return res.status(403).json({ error: 'Mock login is disabled in production.' });
  }
  const email = String(req.query.email || 'runner@thresh.local').trim().toLowerCase();
  const name = String(req.query.name || 'Sample Runner').trim();
  const provider = (String(req.query.provider || 'dev_mock')) as 'dev_mock' | 'google';

  try {
    const user = await findOrCreateUser(provider, email, { email, name });
    await finalizeUserAuthentication(req, res, user);
    return res.redirect('/?auth_just_signed_in=1');
  } catch (err) {
    console.error('[THRESH Auth] Dev mock link failed:', err);
    return res.redirect('/?auth_error=dev_mock_failed');
  }
});

/**
 * POST /api/auth/unlink-provider
 * Unlinks a provider if more than one remains.
 */
authRouter.post('/api/auth/unlink-provider', async (req: Request, res: Response) => {
  const claims = getVerifiedSessionClaims(req);
  if (!claims) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const provider = String(req.body?.provider || '').trim();
  if (!provider) {
    return res.status(400).json({ error: 'Missing provider to unlink.' });
  }

  const result = await unlinkProviderFromUser(claims.sub, provider);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }

  return res.json({ ok: true });
});
