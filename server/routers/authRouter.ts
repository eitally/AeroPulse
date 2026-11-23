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
  getVerifiedSessionClaims,
  isCanonicalAuthenticatedClaims,
  isProductionDeployment,
  timingSafeStringEqual,
  escapeHtml,
  appendSetCookieHeader,
  parseCookies,
  resolveSafeOrigin,
  resolveTrustedCorsOrigin,
} from '../securityUtils.ts';
import {
  consumePasskeyChallengeJti,
  verifyWebAuthnAssertion,
  verifyWebAuthnRegistration,
} from '../webauthnVerify.ts';
import {
  USER_VAULT_COOKIE_NAME,
  buildEncryptedUserCookieHeader,
  decryptJsonFromVault,
  deleteTenantVault,
  loadTenantVaultAsync,
  saveTenantVaultAsync,
} from '../tokenVault.ts';
import {
  autoLinkPendingTeamInvitesByEmail,
  migrateAnonymousTeamsToSid,
  updateTeamMemberEmailsForUser,
} from '../teamService.ts';
import {
  buildUserDataExportPayload,
  deleteThreshAccountPermanently,
  formatUserDataExportCsv,
} from '../accountLifecycleService.ts';
import { validateCoppaAgeInput } from '../coppaGuard.ts';
import {
  checkDistributedRateLimitAsync,
  getClientRateLimitIp,
} from '../rateLimiter.ts';
import {
  findOrCreateUser,
  getUserById,
  getUserByEmail,
  getUserByProvider,
  hashAuthLookupKey,
  linkProviderToUser,
  saveUser,
  unlinkProviderFromUser,
  updateUserBirthMonthYear,
  createPendingEmailChange,
  verifyAndCommitEmailChange,
  connectServiceToUser,
  createMagicLinkToken,
  peekMagicLinkPayload,
  verifyMagicLinkPayload,
  sendMagicLinkEmail,
  issuePasskeyChallengeToken,
  verifyPasskeyChallengeToken,
  type ThreshUser,
  type ThreshPasskeyCredential,
} from '../authService.ts';

export const authRouter = express.Router();

const PENDING_DOB_TTL_MS = 15 * 60 * 1000;

async function savePendingSignupDob(key: string, birthMonthYear?: string): Promise<void> {
  if (!birthMonthYear) return;
  await saveTenantVaultAsync(key, {
    birthMonthYear,
    exp: Date.now() + PENDING_DOB_TTL_MS,
  });
}

async function consumePendingSignupDob(key: string): Promise<string | undefined> {
  const stored = await loadTenantVaultAsync<{ birthMonthYear?: string; exp?: number } | null>(
    key,
    null
  );
  if (!stored) return undefined;
  await deleteTenantVault(key).catch(() => undefined);
  if (stored.exp && Date.now() > stored.exp) return undefined;
  return stored.birthMonthYear;
}

function getRequestHostCandidate(req: Request): string {
  return String(req.headers['x-forwarded-host'] || req.get('host') || '')
    .split(',')[0]
    .trim()
    .replace(/[^a-zA-Z0-9.:-]/g, '');
}

function getAppBaseUrl(req: Request): string {
  const rawProto = String(req.headers['x-forwarded-proto'] || req.protocol || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const isHttps = req.secure || rawProto === 'https';
  const proto = isHttps ? 'https' : 'http';
  const host = getRequestHostCandidate(req);
  const headerOrigin = host ? `${proto}://${host}` : '';

  if (isProductionDeployment()) {
    const trustedHeaderOrigin = resolveTrustedCorsOrigin(headerOrigin);
    if (trustedHeaderOrigin) return trustedHeaderOrigin;

    const envCandidates = [
      process.env.APP_BASE_URL,
      process.env.APP_URL,
      process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL}` : undefined,
      process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
    ];
    for (const cand of envCandidates) {
      const resolved = resolveSafeOrigin(cand);
      if (resolved && !resolved.includes('MY_APP_URL')) {
        return resolved;
      }
    }
    return 'https://meetready.app';
  }

  return resolveSafeOrigin(headerOrigin) || 'http://localhost:3000';
}

function getRpId(req: Request): string {
  try {
    return new URL(getAppBaseUrl(req)).hostname || 'localhost';
  } catch {
    return 'localhost';
  }
}

function getExpectedWebAuthnOrigins(req: Request): string[] {
  const origins = new Set<string>([getAppBaseUrl(req)]);
  const headerOrigin = resolveTrustedCorsOrigin(req.headers.origin as string | undefined);
  if (headerOrigin) origins.add(headerOrigin);
  if (!isProductionDeployment()) {
    const host = getRequestHostCandidate(req);
    if (host) {
      origins.add(`http://${host}`);
      origins.add(`https://${host}`);
    }
  }
  return Array.from(origins);
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
  const rawProto = String(req.headers['x-forwarded-proto'] || req.protocol || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const host = getRequestHostCandidate(req);
  const trustedForwarded = host
    ? resolveTrustedCorsOrigin(`${req.secure || rawProto === 'https' ? 'https' : 'http'}://${host}`)
    : null;
  if (trustedForwarded) {
    return `${trustedForwarded}/api/auth/google/callback`;
  }
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
    birthMonthYear: user.birthMonthYear,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    authProviders: (user.authProviders || []).slice(0, 6),
    passkeys: (user.passkeys || []).slice(0, 4).map((pk) => ({
      id: pk.id,
      publicKeySpkiBase64: pk.publicKeySpkiBase64 || '',
      ...(pk.coseAlg !== undefined ? { coseAlg: pk.coseAlg } : {}),
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
  const sessionToken = setSessionCookie(req, res, user.id, userSid, 'verified');

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
      console.warn('[MeetReady Auth] Anonymous teams migration warning:', err);
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
      console.warn('[MeetReady Auth] Auto-link pending team invites warning:', err);
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
    if (!claims || !isCanonicalAuthenticatedClaims(claims)) {
      return res.json({ authenticated: false, user: null });
    }

    // Try finding user by sub (canonical MeetReady user ID)
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
    });
  } catch (err) {
    console.error('[MeetReady Auth] /api/auth/me error:', err);
    return res.status(500).json({ error: 'Failed retrieving session state.' });
  }
});

/**
 * GET /api/auth/export?format=json|csv
 * Self-serve FERPA / GDPR data export for the authenticated MeetReady account.
 */
authRouter.get('/api/auth/export', async (req: Request, res: Response) => {
  const claims = getVerifiedSessionClaims(req);
  if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
    return res.status(401).json({ ok: false, error: 'Authentication required to export your data.' });
  }

  const rl = await checkDistributedRateLimitAsync(`export_u:${claims.sid}`, 20, 10 * 60 * 1000);
  if (!rl.allowed) {
    return res.status(429).json({
      ok: false,
      error: 'Too many data export requests. Please wait a few minutes and try again.',
      retryAfterSecs: rl.retryAfterSecs,
    });
  }

  const rawFormat = String(req.query.format || 'json').trim().toLowerCase();
  if (rawFormat !== 'json' && rawFormat !== 'csv') {
    return res.status(400).json({ ok: false, error: 'Unsupported export format. Use json or csv.' });
  }

  try {
    const payload = await buildUserDataExportPayload(req);
    if (!payload) {
      return res.status(401).json({ ok: false, error: 'Authentication required to export your data.' });
    }
    res.setHeader('Cache-Control', 'no-store');
    if (rawFormat === 'csv') {
      const csvBody = formatUserDataExportCsv(payload);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="meetready-data-export.csv"');
      return res.status(200).send(csvBody);
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="meetready-data-export.json"');
    return res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error('[MeetReady Auth] /api/auth/export error:', err);
    return res.status(500).json({ ok: false, error: 'Failed building personal data export.' });
  }
});

/**
 * GET /api/auth/google/url
 * Returns Google OAuth URL, or dev mock fallback when running in non-production without credentials.
 */
authRouter.get('/api/auth/google/url', async (req: Request, res: Response) => {
  const ageCheck = validateCoppaAgeInput({
    birthMonthYear: req.query.birthMonthYear,
    birthYear: req.query.birthYear,
  });
  if (!ageCheck.ok) {
    return res.status(ageCheck.statusCode || 400).json({ ok: false, error: ageCheck.error });
  }

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
  await savePendingSignupDob(`oauth_dob_${nonce}`, ageCheck.birthMonthYear);

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
 * Exchanges Google OAuth code for userinfo, creates/links MeetReady account, sets session cookie.
 */
authRouter.get('/api/auth/google/callback', async (req: Request, res: Response) => {
  const code = String(req.query.code || '').trim();
  const state = String(req.query.state || '').trim();
  const error = String(req.query.error || '').trim();

  if (error || !code) {
    return res.redirect(`/?auth_error=${encodeURIComponent(error || 'missing_code')}`);
  }

  // Validate state token against required HttpOnly cookie nonce
  const stateClaims = verifyOAuthStateToken(state);
  const cookieNonce = getOAuthStateCookieNonce(req);
  clearOAuthStateCookie(res);

  if (!stateClaims || !cookieNonce || !timingSafeStringEqual(stateClaims.nonce, cookieNonce)) {
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
      console.error('[MeetReady Auth] Google token exchange failed:', await tokenRes.text());
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

    const pendingDob = await consumePendingSignupDob(`oauth_dob_${stateClaims.nonce}`);
    const existingGoogleUser =
      (await getUserByProvider('google', googleUser.sub)) ||
      (googleUser.email ? await getUserByEmail(googleUser.email) : null);
    const ageCheck = validateCoppaAgeInput({
      birthMonthYear: pendingDob ?? req.query.birthMonthYear,
      birthYear: req.query.birthYear,
      existingBirthMonthYear: existingGoogleUser?.birthMonthYear,
    });
    if (!ageCheck.ok) {
      return res.redirect(`/?auth_error=${encodeURIComponent(ageCheck.error || 'coppa_under_13')}`);
    }

    // 3. Find or create MeetReady user
    let user = await findOrCreateUser('google', googleUser.sub, {
      email: googleUser.email,
      name: googleUser.name,
      picture: googleUser.picture,
    });
    if (ageCheck.birthMonthYear && !user.birthMonthYear) {
      user = (await updateUserBirthMonthYear(user.id, ageCheck.birthMonthYear)) || user;
    }

    // 4. Set HttpOnly session & encrypted user cookies & auto-link team rosters by email
    await finalizeUserAuthentication(req, res, user);

    return res.redirect(buildAuthReturnRedirectUrl(stateClaims));
  } catch (err) {
    console.error('[MeetReady Auth] Google callback processing error:', err);
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

  const clientIp = getClientRateLimitIp(req);
  const ipRate = await checkDistributedRateLimitAsync(`ml_ip:${clientIp}`, 10, 10 * 60 * 1000);
  const emailRate = await checkDistributedRateLimitAsync(`ml_em:${email}`, 5, 10 * 60 * 1000);
  if (!ipRate.allowed || !emailRate.allowed) {
    return res.status(429).json({
      error: 'Too many sign-in link requests. Please wait a few minutes and try again.',
      retryAfterSecs: Math.max(ipRate.retryAfterSecs, emailRate.retryAfterSecs),
    });
  }

  const existingMlUser = await getUserByEmail(email);
  const ageCheck = validateCoppaAgeInput({
    birthMonthYear: req.body?.birthMonthYear,
    birthYear: req.body?.birthYear,
    existingBirthMonthYear: existingMlUser?.birthMonthYear,
  });
  if (!ageCheck.ok) {
    return res.status(ageCheck.statusCode || 400).json({ ok: false, error: ageCheck.error });
  }

  const joinCode = String(req.body?.joinCode || '').trim().slice(0, 32) || undefined;
  const slug = String(req.body?.slug || '').trim().slice(0, 64) || undefined;
  const inviteToken = String(req.body?.inviteToken || '').trim().slice(0, 96) || undefined;
  const pendingJoin =
    joinCode || slug || inviteToken ? { joinCode, slug, inviteToken } : undefined;

  try {
    const { token } = await createMagicLinkToken(email, pendingJoin);
    await savePendingSignupDob(`magic_link_dob_${hashAuthLookupKey(token)}`, ageCheck.birthMonthYear);
    const baseUrl = getAppBaseUrl(req);
    const verifyUrl = `${baseUrl}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`;

    const result = await sendMagicLinkEmail(email, verifyUrl);
    if (!result.sent) {
      return res.status(503).json({
        ok: false,
        error: result.error || 'Email delivery service unavailable.',
      });
    }

    const exposeDev = !isProductionDeployment() && Boolean(result.devMode);
    return res.json({
      ok: true,
      message: 'A secure sign-in link has been sent to your email.',
      devMode: exposeDev,
      previewUrl: exposeDev ? result.previewUrl : undefined,
    });
  } catch (err) {
    console.error('[MeetReady Auth] Failed generating magic link:', err);
    return res.status(500).json({ error: 'Unable to dispatch sign-in email. Please try again.' });
  }
});

/**
 * GET /api/auth/magic-link/verify
 * Non-mutating confirmation landing page (immune to Defender SafeLinks / Proofpoint link prefetchers).
 */
authRouter.get('/api/auth/magic-link/verify', async (req: Request, res: Response) => {
  const token = String(req.query.token || '').trim();
  if (!token) {
    return res.redirect('/?auth_error=missing_magic_token');
  }

  try {
    const previewPayload = await peekMagicLinkPayload(token);
    if (!previewPayload?.email) {
      return res.redirect('/?auth_error=expired_or_invalid_magic_token');
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res.status(200).type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Confirm Sign-In · MeetReady</title>
  </head>
  <body style="font-family:system-ui,-apple-system,sans-serif;background:#080D0A;color:#F4F7F4;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;box-sizing:border-box;">
    <div style="background:#111A15;border:2px solid #25573A;border-radius:18px;padding:28px 26px;max-width:420px;width:100%;text-align:center;">
      <div style="display:inline-block;padding:4px 10px;border-radius:999px;background:#163022;border:1px solid #25573A;color:#C8FF00;font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:14px;">MeetReady · Email Sign-In</div>
      <h1 style="margin:0 0 10px;font-size:20px;line-height:1.3;">Complete Sign-In</h1>
      <p style="margin:0 0 20px;color:#C8D8CE;font-size:14px;line-height:1.55;">Confirm your sign-in as <strong>${escapeHtml(previewPayload.email)}</strong> to open your MeetReady workspace.</p>
      <form method="POST" action="/api/auth/magic-link/verify">
        <input type="hidden" name="token" value="${escapeHtml(token)}" />
        <button type="submit" style="width:100%;min-height:44px;background:#C8FF00;color:#080A09;border:none;border-radius:12px;padding:12px 20px;font-weight:800;font-size:14px;cursor:pointer;">Complete Sign-In to MeetReady</button>
      </form>
    </div>
  </body>
</html>`);
  } catch (err) {
    console.error('[MeetReady Auth] Magic link preview error:', err);
    return res.redirect('/?auth_error=magic_link_verification_failed');
  }
});

/**
 * POST /api/auth/magic-link/verify
 * Atomically consumes the single-use token, creates/logs in the MeetReady user, and sets session cookie.
 */
authRouter.post('/api/auth/magic-link/verify', async (req: Request, res: Response) => {
  const token = String(req.body?.token || req.query.token || '').trim();
  if (!token) {
    return res.redirect(303, '/?auth_error=missing_magic_token');
  }

  try {
    const verifiedPayload = await verifyMagicLinkPayload(token);
    if (!verifiedPayload?.email) {
      return res.redirect(303, '/?auth_error=expired_or_invalid_magic_token');
    }

    const email = verifiedPayload.email;
    const pendingDob = await consumePendingSignupDob(`magic_link_dob_${hashAuthLookupKey(token)}`);
    const existingMlUser = await getUserByEmail(email);
    const ageCheck = validateCoppaAgeInput({
      birthMonthYear: pendingDob ?? req.body?.birthMonthYear ?? req.query.birthMonthYear,
      birthYear: req.body?.birthYear ?? req.query.birthYear,
      existingBirthMonthYear: existingMlUser?.birthMonthYear,
    });
    if (!ageCheck.ok) {
      return res.redirect(303, `/?auth_error=${encodeURIComponent(ageCheck.error || 'coppa_under_13')}`);
    }

    let user = await findOrCreateUser('magic_link', email, {
      email,
      name: email.split('@')[0],
    });
    if (ageCheck.birthMonthYear && !user.birthMonthYear) {
      user = (await updateUserBirthMonthYear(user.id, ageCheck.birthMonthYear)) || user;
    }

    await finalizeUserAuthentication(req, res, user);
    return res.redirect(303, buildAuthReturnRedirectUrl(verifiedPayload.pendingJoin || null));
  } catch (err) {
    console.error('[MeetReady Auth] Magic link verification error:', err);
    return res.redirect(303, '/?auth_error=magic_link_verification_failed');
  }
});

/**
 * POST /api/auth/passkey/register-options
 * Generates WebAuthn registration options.
 */
authRouter.post('/api/auth/passkey/register-options', async (req: Request, res: Response) => {
  const ageCheck = validateCoppaAgeInput({
    birthMonthYear: req.body?.birthMonthYear,
    birthYear: req.body?.birthYear,
  });
  if (!ageCheck.ok) {
    return res.status(ageCheck.statusCode || 400).json({ ok: false, error: ageCheck.error });
  }

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
      name: 'MeetReady',
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
 * Cryptographically verifies WebAuthn attestation, enforces single-use challenges,
 * prevents unauthenticated linking to existing emails, and saves credential to MeetReady account.
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

  const jtiFresh = await consumePasskeyChallengeJti(tokenClaims.jti);
  if (!jtiFresh) {
    return res.status(400).json({ error: 'Passkey registration challenge has already been used.' });
  }

  let verifiedReg: {
    credId: string;
    publicKeySpkiBase64: string;
    coseAlg: number;
    signCount: number;
  };
  try {
    verifiedReg = verifyWebAuthnRegistration({
      credential,
      expectedChallenge: tokenClaims.challenge,
      expectedRpId: getRpId(req),
      expectedOrigins: getExpectedWebAuthnOrigins(req),
    });
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : 'Invalid WebAuthn passkey registration.',
    });
  }

  try {
    const cleanEmail = email ? String(email).trim().toLowerCase() : '';
    const activeClaims = getVerifiedSessionClaims(req);
    let existingCandidate: ThreshUser | null = null;
    if (isCanonicalAuthenticatedClaims(activeClaims) && activeClaims?.sub?.startsWith('usr_')) {
      existingCandidate = await getUserById(activeClaims.sub);
    } else if (cleanEmail) {
      existingCandidate = await getUserByEmail(cleanEmail);
    }

    const ageCheck = validateCoppaAgeInput({
      birthMonthYear: req.body?.birthMonthYear,
      birthYear: req.body?.birthYear,
      existingBirthMonthYear: existingCandidate?.birthMonthYear,
    });
    if (!ageCheck.ok) {
      return res.status(ageCheck.statusCode || 400).json({ ok: false, error: ageCheck.error });
    }

    let user: ThreshUser | null = null;
    if (isCanonicalAuthenticatedClaims(activeClaims) && activeClaims?.sub?.startsWith('usr_')) {
      user = await getUserById(activeClaims.sub);
      if (user) {
        await linkProviderToUser(user.id, 'passkey', verifiedReg.credId, {
          email: user.email || (cleanEmail || undefined),
          name: user.name || (name ? String(name).trim() : 'Passkey Athlete'),
        });
        user = (await getUserById(user.id)) || user;
      }
    }
    if (!user) {
      if (cleanEmail) {
        const existingOwner = await getUserByEmail(cleanEmail);
        if (existingOwner) {
          return res.status(409).json({
            error:
              'An account with this email already exists. Please sign in first, then add a passkey from Account Settings.',
          });
        }
      }
      user = await findOrCreateUser('passkey', verifiedReg.credId, {
        email: cleanEmail || undefined,
        name: name ? String(name).trim() : 'Passkey Athlete',
      });
    }

    if (ageCheck.birthMonthYear && !user.birthMonthYear) {
      user.birthMonthYear = ageCheck.birthMonthYear;
    }

    if (!user.passkeys) user.passkeys = [];
    const existingIdx = user.passkeys.findIndex((p) => p.id === verifiedReg.credId);
    const passkeyObj: ThreshPasskeyCredential = {
      id: verifiedReg.credId,
      publicKeySpkiBase64: verifiedReg.publicKeySpkiBase64,
      coseAlg: verifiedReg.coseAlg,
      counter: verifiedReg.signCount,
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
    console.error('[MeetReady Auth] Passkey registration verification error:', err);
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
 * Cryptographically verifies WebAuthn assertion signature, challenge, RP ID, and signCount.
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

  const jtiFresh = await consumePasskeyChallengeJti(tokenClaims.jti);
  if (!jtiFresh) {
    return res.status(400).json({ error: 'Passkey auth challenge has already been used.' });
  }

  try {
    const credId = String(credential.id || credential.rawId || '').trim();
    if (!credId) {
      return res.status(400).json({ error: 'Invalid credential ID received.' });
    }

    const user = await getUserByProvider('passkey', credId);
    if (!user) {
      return res.status(404).json({ error: 'No MeetReady account associated with this passkey.' });
    }

    const passkey = user.passkeys?.find((p) => p.id === credId);
    if (!passkey || !passkey.publicKeySpkiBase64) {
      return res.status(401).json({ error: 'Stored passkey credential is missing or unverified.' });
    }

    const assertionCheck = verifyWebAuthnAssertion({
      credential,
      expectedChallenge: tokenClaims.challenge,
      expectedRpId: getRpId(req),
      expectedOrigins: getExpectedWebAuthnOrigins(req),
      publicKeySpkiBase64: passkey.publicKeySpkiBase64,
      coseAlg: passkey.coseAlg,
      storedCounter: passkey.counter || 0,
    });
    if (!assertionCheck.verified) {
      return res.status(401).json({ error: assertionCheck.error || 'Passkey signature verification failed.' });
    }

    if (assertionCheck.newSignCount > (passkey.counter || 0)) {
      passkey.counter = assertionCheck.newSignCount;
      await saveUser(user);
    }

    await finalizeUserAuthentication(req, res, user);
    return res.json({ ok: true, user });
  } catch (err) {
    console.error('[MeetReady Auth] Passkey auth verification error:', err);
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
    const existingMockUser = await getUserByEmail(email);
    const ageCheck = validateCoppaAgeInput({
      birthMonthYear: req.body?.birthMonthYear ?? req.query.birthMonthYear,
      birthYear: req.body?.birthYear ?? req.query.birthYear,
      existingBirthMonthYear: existingMockUser?.birthMonthYear,
    });
    if (!ageCheck.ok) {
      return res.status(ageCheck.statusCode || 400).json({ ok: false, error: ageCheck.error });
    }

    let user = await findOrCreateUser(provider, email, {
      email,
      name,
    });
    if (ageCheck.birthMonthYear && !user.birthMonthYear) {
      user = (await updateUserBirthMonthYear(user.id, ageCheck.birthMonthYear)) || user;
    }

    await finalizeUserAuthentication(req, res, user);

    // Support redirect when accessed as a GET / URL link
    if (req.method === 'GET' || req.query.redirect) {
      return res.redirect('/?auth_just_signed_in=1');
    }

    return res.json({ ok: true, user });
  } catch (err) {
    console.error('[MeetReady Auth] Mock login failed:', err);
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
    const existingMockUser = await getUserByEmail(email);
    const ageCheck = validateCoppaAgeInput({
      birthMonthYear: req.query.birthMonthYear,
      birthYear: req.query.birthYear,
      existingBirthMonthYear: existingMockUser?.birthMonthYear,
    });
    if (!ageCheck.ok) {
      return res.redirect(`/?auth_error=${encodeURIComponent(ageCheck.error || 'coppa_under_13')}`);
    }

    let user = await findOrCreateUser(provider, email, { email, name });
    if (ageCheck.birthMonthYear && !user.birthMonthYear) {
      user = (await updateUserBirthMonthYear(user.id, ageCheck.birthMonthYear)) || user;
    }
    await finalizeUserAuthentication(req, res, user);
    return res.redirect('/?auth_just_signed_in=1');
  } catch (err) {
    console.error('[MeetReady Auth] Dev mock link failed:', err);
    return res.redirect('/?auth_error=dev_mock_failed');
  }
});

/**
 * POST /api/auth/unlink-provider
 * Unlinks a provider if more than one remains.
 */
authRouter.post('/api/auth/unlink-provider', async (req: Request, res: Response) => {
  const claims = getVerifiedSessionClaims(req);
  if (!claims || !isCanonicalAuthenticatedClaims(claims)) {
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

/**
 * POST /api/auth/change-email
 * 2-step verified primary email migration (send 6-digit code -> verify code -> migrate).
 */
authRouter.post('/api/auth/change-email', async (req: Request, res: Response) => {
  const claims = getVerifiedSessionClaims(req);
  if (!claims || !isCanonicalAuthenticatedClaims(claims)) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  let userId = claims.sub?.startsWith('usr_') ? claims.sub : '';
  if (!userId && claims.sub) {
    const byStrava = await getUserByProvider('strava', claims.sub);
    if (byStrava) userId = byStrava.id;
  }
  if (!userId) {
    return res.status(400).json({ error: 'Please sign in with a MeetReady account before changing email.' });
  }

  const newEmail = String(req.body?.email || req.body?.newEmail || '').trim().toLowerCase();
  const verificationCode = String(req.body?.verificationCode || req.body?.code || '').trim();

  if (!verificationCode) {
    const reqRes = await createPendingEmailChange(userId, newEmail);
    if (!reqRes.ok) {
      const status = reqRes.error?.includes('unavailable') ? 503 : 400;
      return res.status(status).json({ error: reqRes.error || 'Could not initiate email verification.' });
    }
    const exposeDev = !isProductionDeployment() && Boolean(reqRes.devMode);
    return res.json({
      ok: true,
      verificationRequired: true,
      pendingEmail: newEmail,
      devMode: exposeDev,
      ...(exposeDev && reqRes.devCode ? { devCode: reqRes.devCode } : {}),
    });
  }

  const result = await verifyAndCommitEmailChange(
    userId,
    verificationCode,
    newEmail || undefined
  );
  if (!result.ok || !result.user || !result.newEmail) {
    return res.status(400).json({ error: result.error || 'Could not verify and update email.' });
  }

  try {
    await updateTeamMemberEmailsForUser({
      callerSid: claims.sid,
      oldEmail: result.oldEmail,
      newEmail: result.newEmail,
    });
  } catch (err) {
    console.warn('[MeetReady Auth] Team membership email update warning:', err);
  }

  await finalizeUserAuthentication(req, res, result.user);
  return res.json({ ok: true, user: result.user });
});

/**
 * POST /api/auth/birth-month
 * Updates canonical YYYY-MM birth month-year on the authenticated MeetReady user.
 * Enforces COPPA <13 block and prevents minors from altering stored DOB to an adult date.
 */
authRouter.post('/api/auth/birth-month', async (req: Request, res: Response) => {
  const claims = getVerifiedSessionClaims(req);
  if (!claims?.sub?.startsWith('usr_') || !isCanonicalAuthenticatedClaims(claims)) {
    return res.status(401).json({ error: 'MeetReady account required.' });
  }

  const existingUser = await getUserById(claims.sub);
  if (!existingUser) {
    return res.status(404).json({ error: 'Account not found.' });
  }

  const ageCheck = validateCoppaAgeInput({
    birthMonthYear: req.body?.birthMonthYear,
    birthYear: req.body?.birthYear,
    existingBirthMonthYear: existingUser.birthMonthYear,
    required: true,
  });
  if (!ageCheck.ok || !ageCheck.birthMonthYear) {
    return res.status(ageCheck.statusCode || 400).json({ error: ageCheck.error });
  }

  const updated = await updateUserBirthMonthYear(claims.sub, ageCheck.birthMonthYear);
  if (!updated) {
    return res.status(400).json({ error: 'Valid YYYY-MM birth month-year required.' });
  }
  await finalizeUserAuthentication(req, res, updated);
  return res.json({ ok: true, user: updated });
});

/**
 * DELETE /api/auth/account
 * Permanently erases user account, tokens, cloud vaults, and scrubs active team memberships.
 */
authRouter.delete('/api/auth/account', async (req: Request, res: Response) => {
  const confirmVal = String(req.body?.confirm || req.query.confirm || '').trim().toUpperCase();
  if (confirmVal !== 'DELETE') {
    return res.status(400).json({
      ok: false,
      error: 'Please pass confirm: "DELETE" to permanently delete your MeetReady account.',
    });
  }
  await deleteThreshAccountPermanently(req, res);
});
