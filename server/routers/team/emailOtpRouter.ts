import express, { type Request, type Response } from 'express';
import {
  getVerifiedSessionClaims,
  isCanonicalAuthenticatedClaims,
  isProductionDeployment,
  resolveTrustedRequestOrigin,
  setSessionCookie,
} from '../../securityUtils.ts';
import {
  checkDistributedRateLimitAsync,
  getClientRateLimitIp,
  resetRateLimitsForTesting,
} from '../../rateLimiter.ts';
import {
  isResendConfigured,
  listTeamsForUser,
  requestEmailOtpCode,
  verifyEmailOtpCode,
} from '../../teamService.ts';

export const emailOtpRouter = express.Router();

const OTP_RATE_WINDOW_MS = 10 * 60 * 1000;

export function resetEmailOtpRateLimitsForTesting(): void {
  resetRateLimitsForTesting('otp_');
}

// 1. Send 6-Digit Cross-Device Email OTP via Resend
emailOtpRouter.post('/api/auth/email/send-otp', async (req: Request, res: Response) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const clientIp = getClientRateLimitIp(req);
    const ipRate = await checkDistributedRateLimitAsync(
      `otp_send_ip:${clientIp}`,
      10,
      OTP_RATE_WINDOW_MS
    );
    const emailRate = email
      ? await checkDistributedRateLimitAsync(`otp_send_em:${email}`, 5, OTP_RATE_WINDOW_MS)
      : { allowed: true, retryAfterSecs: 0 };
    if (!ipRate.allowed || !emailRate.allowed) {
      res.status(429).json({
        ok: false,
        error: 'Too many verification code requests. Please wait a few minutes and try again.',
        retryAfterSecs: Math.max(ipRate.retryAfterSecs, emailRate.retryAfterSecs),
      });
      return;
    }
    const result = await requestEmailOtpCode(email, {
      birthMonthYear: req.body?.birthMonthYear,
      birthYear: req.body?.birthYear,
    });
    if (!result.ok) {
      res
        .status(result.statusCode || 400)
        .json({ ok: false, error: result.error || 'Unable to send OTP.' });
      return;
    }
    res.json({
      ok: true,
      deliveryStatus: result.deliveryStatus,
      resendConfigured: isResendConfigured(),
      ...(!isProductionDeployment() && result.devPreviewCode
        ? { devPreviewCode: result.devPreviewCode }
        : {}),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to send verification code.',
    });
  }
});

// 2. Verify 6-Digit Email OTP & Bind Persistent Cross-Device Session
emailOtpRouter.post('/api/auth/email/verify-otp', async (req: Request, res: Response) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    const clientIp = getClientRateLimitIp(req);
    const ipRate = await checkDistributedRateLimitAsync(
      `otp_verify_ip:${clientIp}`,
      20,
      OTP_RATE_WINDOW_MS
    );
    const emailRate = email
      ? await checkDistributedRateLimitAsync(`otp_verify_em:${email}`, 10, OTP_RATE_WINDOW_MS)
      : { allowed: true, retryAfterSecs: 0 };
    if (!ipRate.allowed || !emailRate.allowed) {
      res.status(429).json({
        ok: false,
        error: 'Too many verification attempts. Please wait a few minutes and try again.',
        retryAfterSecs: Math.max(ipRate.retryAfterSecs, emailRate.retryAfterSecs),
      });
      return;
    }
    const currentClaims = getVerifiedSessionClaims(req);
    const verifiedPreferredSid =
      currentClaims && isCanonicalAuthenticatedClaims(currentClaims)
        ? currentClaims.sid
        : undefined;
    const result = await verifyEmailOtpCode(email, code, verifiedPreferredSid, {
      birthMonthYear: req.body?.birthMonthYear,
      birthYear: req.body?.birthYear,
    });
    if (!result.ok || !result.sid) {
      res
        .status(result.statusCode || 400)
        .json({ ok: false, error: result.error || 'Invalid code.' });
      return;
    }

    setSessionCookie(
      req,
      res,
      result.userId || `usr_${result.sid}`,
      result.sid,
      'verified'
    );
    const originUrl = resolveTrustedRequestOrigin(req);
    const teams = await listTeamsForUser(result.sid, originUrl);

    res.json({
      ok: true,
      email: result.email,
      displayName: result.displayName,
      teams,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Verification failed.',
    });
  }
});
