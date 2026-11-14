import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import { apiRouter } from '../server/apiRouter.ts';
import {
  findOrCreateUser,
  getUserById,
  getUserByEmail,
  getUserByProvider,
  linkProviderToUser,
  unlinkProviderFromUser,
  createMagicLinkToken,
  verifyMagicLinkToken,
  sendMagicLinkEmail,
  issuePasskeyChallengeToken,
  verifyPasskeyChallengeToken,
} from '../server/authService.ts';
import { SESSION_COOKIE_NAME, issueSessionToken } from '../server/securityUtils.ts';

describe('AUTH-01 · Self-Hosted Zero-Cost Auth Engine', () => {
  let server: http.Server;
  let baseUrl = '';

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(apiRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr) {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
  });

  describe('1. User Identity & Account Linking (authService)', () => {
    const runId = Math.random().toString(36).slice(2, 7);
    const primaryEmail = `marathoner_${runId}@thresh.local`;
    const googleSub = `google_sub_${runId}`;
    const passkeyCredId = `passkey_cred_${runId}`;

    it('creates a fresh THRESH user account from Google OAuth identity', async () => {
      const user = await findOrCreateUser('google', googleSub, {
        email: primaryEmail,
        name: 'Elena Rostova',
        picture: 'https://example.com/elena.jpg',
      });

      expect(user.id).toMatch(/^usr_[a-f0-9]{16}$/);
      expect(user.email).toBe(primaryEmail);
      expect(user.name).toBe('Elena Rostova');
      expect(user.authProviders).toHaveLength(1);
      expect(user.authProviders[0].provider).toBe('google');
      expect(user.authProviders[0].providerId).toBe(googleSub);

      // Verify retrieval by ID, email, and provider
      const byId = await getUserById(user.id);
      expect(byId?.id).toBe(user.id);

      const byEmail = await getUserByEmail(primaryEmail);
      expect(byEmail?.id).toBe(user.id);

      const byProvider = await getUserByProvider('google', googleSub);
      expect(byProvider?.id).toBe(user.id);
    });

    it('links a secondary provider (passkey) to an existing user when email matches', async () => {
      // User created with Google earlier
      const user = await findOrCreateUser('passkey', passkeyCredId, {
        email: primaryEmail,
        name: 'Elena Rostova',
      });

      expect(user.email).toBe(primaryEmail);
      expect(user.authProviders).toHaveLength(2);
      expect(user.authProviders.some((p) => p.provider === 'google')).toBe(true);
      expect(user.authProviders.some((p) => p.provider === 'passkey')).toBe(true);
    });

    it('prevents unlinking when only one provider remains, and allows when multiple exist', async () => {
      const user = await getUserByEmail(primaryEmail);
      expect(user).not.toBeNull();
      if (!user) return;

      // Currently has 2 providers (google, passkey); unlinking one should succeed
      const unlinkRes = await unlinkProviderFromUser(user.id, 'passkey');
      expect(unlinkRes.ok).toBe(true);

      const updated = await getUserById(user.id);
      expect(updated?.authProviders).toHaveLength(1);

      // Unlinking the last provider must be blocked
      const lastUnlink = await unlinkProviderFromUser(user.id, 'google');
      expect(lastUnlink.ok).toBe(false);
      expect(lastUnlink.error).toContain('Cannot remove your last remaining login method');
    });
  });

  describe('2. Passwordless Email Magic Links (100% Free)', () => {
    it('generates a cryptographically random single-use token and consumes it on verification', async () => {
      const email = 'xc_coach@school.edu';
      const { token, expiresAt } = await createMagicLinkToken(email);

      expect(token).toHaveLength(64);
      expect(expiresAt).toBeGreaterThan(Date.now());

      // First verification succeeds
      const verifiedEmail = await verifyMagicLinkToken(token);
      expect(verifiedEmail).toBe(email);

      // Second verification fails (single-use consumed)
      const secondVerify = await verifyMagicLinkToken(token);
      expect(secondVerify).toBeNull();
    });

    it('provides devMode fallback preview URL when RESEND_API_KEY is not configured', async () => {
      const result = await sendMagicLinkEmail('athlete@thresh.local', 'http://localhost:3000/api/auth/magic-link/verify?token=abc');
      expect(result.sent).toBe(true);
      expect(result.devMode).toBe(true);
      expect(result.previewUrl).toContain('/api/auth/magic-link/verify?token=abc');
    });
  });

  describe('3. Passkey (WebAuthn) Challenge Signing', () => {
    it('issues an HMAC-signed challenge token with TTL and verifies validity', () => {
      const challengeToken = issuePasskeyChallengeToken({
        challenge: 'random_challenge_bytes_123',
        purpose: 'register',
        userId: 'usr_mock_123',
      });

      const claims = verifyPasskeyChallengeToken(challengeToken);
      expect(claims).not.toBeNull();
      expect(claims?.challenge).toBe('random_challenge_bytes_123');
      expect(claims?.purpose).toBe('register');
      expect(claims?.userId).toBe('usr_mock_123');

      // Tampered token fails
      const tampered = challengeToken.replace(/^[^.]+\./, 'tampered.');
      expect(verifyPasskeyChallengeToken(tampered)).toBeNull();
    });
  });

  describe('4. HTTP Auth Endpoints Integration', () => {
    it('GET /api/auth/me returns authenticated: false when no cookie is present', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.authenticated).toBe(false);
      expect(data.user).toBeNull();
    });

    it('GET /api/auth/google/url returns dev mock details when GOOGLE_CLIENT_ID is not set', async () => {
      const res = await fetch(`${baseUrl}/api/auth/google/url`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.devMode).toBe(true);
      expect(data.devMockUrl).toBeDefined();
    });

    it('POST /api/auth/magic-link/send dispatches link and allows verify round-trip', async () => {
      const sendRes = await fetch(`${baseUrl}/api/auth/magic-link/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'sprinter@thresh.run' }),
      });

      expect(sendRes.status).toBe(200);
      const sendData = await sendRes.json();
      expect(sendData.ok).toBe(true);
      expect(sendData.devMode).toBe(true);
      expect(sendData.previewUrl).toBeDefined();

      // Extract token from previewUrl
      const url = new URL(sendData.previewUrl);
      const token = url.searchParams.get('token');
      expect(token).toBeTruthy();

      // Follow verify endpoint (manual redirect handling to inspect Set-Cookie)
      const verifyRes = await fetch(`${baseUrl}/api/auth/magic-link/verify?token=${token}`, {
        redirect: 'manual',
      });

      expect([302, 303, 307]).toContain(verifyRes.status);
      const setCookie = verifyRes.headers.get('set-cookie');
      expect(setCookie).toContain(SESSION_COOKIE_NAME);

      // Verify session via /api/auth/me
      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: setCookie! },
      });
      const meData = await meRes.json();
      expect(meData.authenticated).toBe(true);
      expect(meData.user?.email).toBe('sprinter@thresh.run');
      expect(meData.user?.authProviders[0].provider).toBe('magic_link');
    });

    it('POST /api/auth/passkey/register-options and register-verify creates account', async () => {
      const passkeyEmail = `touchid_${Math.random().toString(36).slice(2, 7)}@thresh.run`;
      const uniqueCredId = `cred_mock_${Math.random().toString(36).slice(2, 9)}`;

      const optRes = await fetch(`${baseUrl}/api/auth/passkey/register-options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: passkeyEmail, name: 'Biometric Runner' }),
      });

      expect(optRes.status).toBe(200);
      const optData = await optRes.json();
      expect(optData.challengeToken).toBeDefined();
      expect(optData.options?.challenge).toBeDefined();

      // Simulate browser credential creation response
      const verifyRes = await fetch(`${baseUrl}/api/auth/passkey/register-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeToken: optData.challengeToken,
          email: passkeyEmail,
          name: 'Biometric Runner',
          credential: {
            id: uniqueCredId,
            rawId: uniqueCredId,
            response: {
              publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEmock',
            },
          },
        }),
      });

      expect(verifyRes.status).toBe(200);
      const verifyData = await verifyRes.json();
      expect(verifyData.ok).toBe(true);
      expect(verifyData.user?.passkeys).toHaveLength(1);
      expect(verifyData.user?.passkeys[0].id).toBe(uniqueCredId);

      // Now authenticate via passkey
      const authOptRes = await fetch(`${baseUrl}/api/auth/passkey/auth-options`, {
        method: 'POST',
      });
      const authOptData = await authOptRes.json();

      const authVerifyRes = await fetch(`${baseUrl}/api/auth/passkey/auth-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeToken: authOptData.challengeToken,
          credential: {
            id: uniqueCredId,
          },
        }),
      });

      expect(authVerifyRes.status).toBe(200);
      const authVerifyData = await authVerifyRes.json();
      expect(authVerifyData.ok).toBe(true);
      expect(authVerifyData.user?.email).toBe(passkeyEmail);
    });

    it('POST /api/auth/mock-login enables instantaneous test authentication', async () => {
      const res = await fetch(`${baseUrl}/api/auth/mock-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'trail_runner@thresh.run', name: 'Marcus Vance' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.user?.email).toBe('trail_runner@thresh.run');
      expect(data.user?.name).toBe('Marcus Vance');
    });
  });
});
