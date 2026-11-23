import crypto from 'crypto';
import express, { type Request, type Response } from 'express';
import {
  escapeHtml,
  getVerifiedSessionClaims,
  isCanonicalAuthenticatedClaims,
  resolveTrustedRequestOrigin,
  setSessionCookie,
} from '../securityUtils.ts';
import {
  applyExternalTeamSyncBatch,
  buildPublicTeamCalendarIcs,
  confirmParentEmailSubscription,
  followTeamAsParentOrFan,
  getPublicTeamHubBySlugOrCode,
  previewParentEmailSubscriptionConfirm,
  previewParentEmailSubscriptionUnsubscribe,
  subscribeParentEmailToPublicHub,
  syncTeamIcsCalendar,
  unsubscribeParentEmailSubscription,
  updateTeamExternalSyncConfig,
} from '../athleticSyncService.ts';
import { getUserById, hashAuthLookupKey } from '../authService.ts';
import {
  checkDistributedRateLimitAsync,
  getClientRateLimitIp,
} from '../rateLimiter.ts';
import { listTeamsForUser } from '../teamService.ts';

export const teamSyncRouter = express.Router();

function resolveSyncOrigin(req: Request): string {
  return resolveTrustedRequestOrigin(req);
}

teamSyncRouter.post(
  '/api/teams/:teamId/external-sync/config',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const originUrl = resolveSyncOrigin(req);
      const summary = await updateTeamExternalSyncConfig({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        originUrl,
        config: req.body?.config || req.body || {},
        teamUrl: req.body?.teamUrl ? String(req.body.teamUrl) : undefined,
      });
      if (!summary) {
        res.status(403).json({
          ok: false,
          error: 'Coach permissions required to update Athletic.net / TFRRS sync config.',
        });
        return;
      }
      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({ ok: true, team: summary, teams });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to update external sync settings.',
      });
    }
  }
);

teamSyncRouter.post(
  '/api/teams/:teamId/external-sync/ics',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const originUrl = resolveSyncOrigin(req);
      const result = await syncTeamIcsCalendar({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        originUrl,
        icsUrl: req.body?.icsUrl ? String(req.body.icsUrl) : undefined,
        icsText: req.body?.icsText ? String(req.body.icsText) : undefined,
      });
      if (!result.summary) {
        res.status(403).json({ ok: false, error: result.note || 'Forbidden.' });
        return;
      }
      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({
        ...result,
        teams,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to sync .ics calendar.',
      });
    }
  }
);

teamSyncRouter.post(
  '/api/teams/:teamId/external-sync/apply',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const originUrl = resolveSyncOrigin(req);
      const result = await applyExternalTeamSyncBatch({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        originUrl,
        externalSyncPatch: req.body?.externalSyncPatch,
        athletes: Array.isArray(req.body?.athletes) ? req.body.athletes : undefined,
        meets: Array.isArray(req.body?.meets) ? req.body.meets : undefined,
        results: Array.isArray(req.body?.results) ? req.body.results : undefined,
      });
      if (!result.summary) {
        res.status(403).json({
          ok: false,
          error: 'Coach permissions required to import external team data.',
        });
        return;
      }
      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({
        ok: true,
        team: result.summary,
        teams,
        addedAthletes: result.addedAthletes,
        updatedAthletes: result.updatedAthletes,
        addedMeets: result.addedMeets,
        recordedResults: result.recordedResults,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to apply team sync.',
      });
    }
  }
);

teamSyncRouter.get(
  '/api/teams/public/:slugOrCode',
  async (req: Request, res: Response) => {
    try {
      const payload = await getPublicTeamHubBySlugOrCode(
        String(req.params.slugOrCode || '')
      );
      if (!payload.found) {
        res.status(404).json(payload);
        return;
      }
      res.json(payload);
    } catch (err) {
      res.status(500).json({
        found: false,
        error: err instanceof Error ? err.message : 'Failed to load public team hub.',
        upcomingMeets: [],
        recentSchedule: [],
        rosterLeaderboard: [],
        stats: { athleteCount: 0, meetCount: 0, officialResultCount: 0 },
      });
    }
  }
);

teamSyncRouter.post('/api/teams/follow', async (req: Request, res: Response) => {
  try {
    const existing = getVerifiedSessionClaims(req);
    let sid = existing?.sid;
    let sessionToken: string | undefined;
    if (!sid) {
      const anonSid = crypto.randomBytes(16).toString('hex');
      sessionToken = setSessionCookie(
        req,
        res,
        `anon_supporter_${anonSid.slice(0, 8)}`,
        anonSid,
        'anon'
      );
      sid = anonSid;
    }
    const originUrl = resolveSyncOrigin(req);
    const verifiedUser =
      existing && isCanonicalAuthenticatedClaims(existing) && existing.sub.startsWith('usr_')
        ? await getUserById(existing.sub).catch(() => null)
        : null;
    const result = await followTeamAsParentOrFan({
      callerSid: sid,
      codeOrSlug: String(req.body?.codeOrSlug || ''),
      followerName: req.body?.followerName ? String(req.body.followerName) : undefined,
      verifiedEmail: verifiedUser?.email,
      originUrl,
    });
    if (!result.ok || !result.summary) {
      res.status(400).json({ ok: false, error: result.error || 'Could not follow team.' });
      return;
    }
    const teams = await listTeamsForUser(sid, originUrl);
    res.json({
      ok: true,
      team: result.summary,
      teams,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to follow team.',
    });
  }
});

teamSyncRouter.get(
  '/api/teams/public/:slugOrCode/calendar.ics',
  async (req: Request, res: Response) => {
    try {
      const payload = await getPublicTeamHubBySlugOrCode(
        String(req.params.slugOrCode || '')
      );
      if (!payload.found || !payload.brand) {
        res.status(404).type('text/plain').send('Public team schedule not found.');
        return;
      }

      const icsBody = buildPublicTeamCalendarIcs(payload);
      const safeSlug = payload.brand.slug.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'team';
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="${safeSlug}-schedule.ics"`);
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.status(200).send(icsBody);
    } catch {
      res.status(500).type('text/plain').send('Unable to generate calendar feed.');
    }
  }
);

teamSyncRouter.post(
  '/api/teams/public/:slugOrCode/subscribe',
  async (req: Request, res: Response) => {
    try {
      const clientIp = getClientRateLimitIp(req);
      const normalizedEmail = String(req.body?.email || '').trim().toLowerCase();
      const ipRl = await checkDistributedRateLimitAsync(
        `pub_sub_ip:${clientIp}`,
        5,
        15 * 60 * 1000
      );
      const emailRl = normalizedEmail
        ? await checkDistributedRateLimitAsync(
            `pub_sub_em:${hashAuthLookupKey(normalizedEmail)}`,
            2,
            15 * 60 * 1000
          )
        : { allowed: true, retryAfterSecs: 0 };
      if (!ipRl.allowed || !emailRl.allowed) {
        const retryAfterSecs = Math.max(ipRl.retryAfterSecs || 0, emailRl.retryAfterSecs || 0, 1);
        res.setHeader('Retry-After', String(retryAfterSecs));
        res.status(429).json({
          ok: false,
          error: 'Too many subscription requests. Please wait a few minutes and try again.',
          retryAfterSecs,
        });
        return;
      }

      const originUrl = resolveSyncOrigin(req);
      const result = await subscribeParentEmailToPublicHub({
        slugOrCode: String(req.params.slugOrCode || ''),
        email: String(req.body?.email || ''),
        originUrl,
      });
      if (!result.ok) {
        res.status(result.statusCode || 400).json({
          ok: false,
          error: result.error || 'Could not subscribe email.',
        });
        return;
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Subscription failed.',
      });
    }
  }
);

function renderParentHubSubscriptionHtml(params: {
  ok: boolean;
  title: string;
  heading: string;
  body: string;
  slug?: string;
}): string {
  const safeHubHref = params.slug ? `/team/${encodeURIComponent(params.slug)}` : '/';
  const accent = params.ok ? '#1E4D36' : '#B83A24';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(
    params.title
  )}</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#F6F3EC;color:#121413;padding:40px 16px;margin:0;"><div style="max-width:500px;margin:0 auto;background:#FFFFFF;border:1px solid #CFC9BC;border-radius:16px;padding:28px;"><div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${accent};">MeetReady Parent Hub</div><h1 style="margin:8px 0 10px;font-size:20px;">${escapeHtml(
    params.heading
  )}</h1><p style="font-size:14px;line-height:1.55;color:#2C2A26;margin:0 0 20px;">${escapeHtml(
    params.body
  )}</p><a href="${safeHubHref}" style="display:inline-block;background:#121413;color:#D8FF2A;text-decoration:none;font-weight:700;font-size:13px;padding:10px 18px;border-radius:10px;">Back to Team Hub</a></div></body></html>`;
}

function renderParentHubSubscriptionActionFormHtml(params: {
  title: string;
  heading: string;
  body: string;
  actionUrl: string;
  buttonLabel: string;
  token: string;
  buttonColor?: string;
}): string {
  const btnBg = params.buttonColor || '#121413';
  const btnFg = params.buttonColor ? '#FFFFFF' : '#D8FF2A';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(
    params.title
  )}</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#F6F3EC;color:#121413;padding:40px 16px;margin:0;"><div style="max-width:500px;margin:0 auto;background:#FFFFFF;border:1px solid #CFC9BC;border-radius:16px;padding:28px;"><div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#1E4D36;">MeetReady Parent Hub</div><h1 style="margin:8px 0 10px;font-size:20px;">${escapeHtml(
    params.heading
  )}</h1><p style="font-size:14px;line-height:1.55;color:#2C2A26;margin:0 0 20px;">${escapeHtml(
    params.body
  )}</p><form method="POST" action="${escapeHtml(
    params.actionUrl
  )}" style="margin:0;"><input type="hidden" name="token" value="${escapeHtml(
    params.token
  )}" /><button type="submit" style="display:inline-block;background:${btnBg};color:${btnFg};border:none;cursor:pointer;font-weight:700;font-size:14px;padding:12px 20px;border-radius:10px;">${escapeHtml(
    params.buttonLabel
  )}</button></form></div></body></html>`;
}

function requestPrefersJson(req: Request): boolean {
  const accept = String(req.headers.accept || '');
  return accept.includes('application/json') && !accept.includes('text/html');
}

function extractSubscriptionToken(req: Request): string {
  return String(req.body?.token || req.query?.token || '').trim();
}

async function handlePublicSubscriptionGet(
  req: Request,
  res: Response,
  mode: 'confirm' | 'unsubscribe'
): Promise<void> {
  const slugOrCode = String(req.params.slugOrCode || '');
  const token = String(req.query?.token || '').trim();
  const preview =
    mode === 'confirm'
      ? await previewParentEmailSubscriptionConfirm({ slugOrCode, token })
      : await previewParentEmailSubscriptionUnsubscribe({ slugOrCode, token });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (requestPrefersJson(req)) {
    res.status(preview.statusCode || (preview.ok ? 200 : 400)).json({
      ...preview,
      requiresConfirmation: preview.ok,
    });
    return;
  }

  if (!preview.ok) {
    res
      .type('html')
      .status(preview.statusCode || 400)
      .send(
        renderParentHubSubscriptionHtml({
          ok: false,
          title:
            mode === 'confirm'
              ? 'Subscription Link Error · MeetReady'
              : 'Unsubscribe Link Error · MeetReady',
          heading:
            mode === 'confirm'
              ? 'Could Not Confirm Subscription'
              : 'Unsubscribe Link Not Recognized',
          body:
            preview.error ||
            (mode === 'confirm'
              ? 'This confirmation link is invalid or already used.'
              : 'This unsubscribe link could not be verified.'),
        })
      );
    return;
  }

  const encodedSlugOrCode = encodeURIComponent(slugOrCode);
  const actionUrl =
    mode === 'confirm'
      ? `/api/teams/public/${encodedSlugOrCode}/subscribe/confirm`
      : `/api/teams/public/${encodedSlugOrCode}/unsubscribe`;

  res
    .type('html')
    .status(200)
    .send(
      renderParentHubSubscriptionActionFormHtml({
        title:
          mode === 'confirm'
            ? 'Confirm Parent Hub Subscription · MeetReady'
            : 'Confirm Unsubscribe · MeetReady',
        heading:
          mode === 'confirm'
            ? `Confirm Updates for ${preview.teamName || 'Team Hub'}`
            : `Unsubscribe from ${preview.teamName || 'Team Hub'}?`,
        body:
          mode === 'confirm'
            ? `Click below to activate public schedule, weather, and meet notices for ${
                preview.teamName || 'this team'
              }.`
            : `Click below to stop receiving Parent Hub email alerts for ${
                preview.teamName || 'this team'
              }.`,
        actionUrl,
        buttonLabel:
          mode === 'confirm' ? 'Confirm Email Subscription' : 'Unsubscribe from Alerts',
        token,
        ...(mode === 'unsubscribe' ? { buttonColor: '#B83A24' } : {}),
      })
    );
}

async function handlePublicSubscriptionPost(
  req: Request,
  res: Response,
  mode: 'confirm' | 'unsubscribe'
): Promise<void> {
  const slugOrCode = String(req.params.slugOrCode || '');
  const token = extractSubscriptionToken(req);
  const result =
    mode === 'confirm'
      ? await confirmParentEmailSubscription({ slugOrCode, token })
      : await unsubscribeParentEmailSubscription({ slugOrCode, token });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (requestPrefersJson(req)) {
    res.status(result.statusCode || (result.ok ? 200 : 400)).json(result);
    return;
  }

  if (!result.ok) {
    res
      .type('html')
      .status(result.statusCode || 400)
      .send(
        renderParentHubSubscriptionHtml({
          ok: false,
          title:
            mode === 'confirm'
              ? 'Subscription Link Error · MeetReady'
              : 'Unsubscribe Link Error · MeetReady',
          heading:
            mode === 'confirm'
              ? 'Could Not Confirm Subscription'
              : 'Unsubscribe Link Not Recognized',
          body:
            result.error ||
            (mode === 'confirm'
              ? 'This confirmation link is invalid or already used.'
              : 'This unsubscribe link could not be verified.'),
        })
      );
    return;
  }

  res
    .type('html')
    .status(200)
    .send(
      renderParentHubSubscriptionHtml({
        ok: true,
        title:
          mode === 'confirm'
            ? 'Subscription Confirmed · MeetReady'
            : 'Unsubscribed · MeetReady',
        heading:
          mode === 'confirm' ? 'Parent Hub Updates Confirmed' : 'Email Updates Turned Off',
        body:
          mode === 'confirm'
            ? `You are subscribed to public schedule alerts, weather changes, and meet notices for ${
                result.teamName || 'this team'
              }.`
            : `Your email has been unsubscribed from ${
                result.teamName || 'this team'
              } Parent Hub notifications.`,
        slug: result.slug,
      })
    );
}

teamSyncRouter.get(
  '/api/teams/public/:slugOrCode/subscribe/confirm',
  async (req: Request, res: Response) => {
    try {
      await handlePublicSubscriptionGet(req, res, 'confirm');
    } catch {
      res.status(500).send('Unable to load subscription confirmation.');
    }
  }
);

teamSyncRouter.post(
  '/api/teams/public/:slugOrCode/subscribe/confirm',
  async (req: Request, res: Response) => {
    try {
      await handlePublicSubscriptionPost(req, res, 'confirm');
    } catch {
      res.status(500).send('Unable to confirm subscription.');
    }
  }
);

teamSyncRouter.get(
  '/api/teams/public/:slugOrCode/unsubscribe',
  async (req: Request, res: Response) => {
    try {
      await handlePublicSubscriptionGet(req, res, 'unsubscribe');
    } catch {
      res.status(500).send('Unable to load unsubscribe confirmation.');
    }
  }
);

teamSyncRouter.post(
  '/api/teams/public/:slugOrCode/unsubscribe',
  async (req: Request, res: Response) => {
    try {
      await handlePublicSubscriptionPost(req, res, 'unsubscribe');
    } catch {
      res.status(500).send('Unable to unsubscribe.');
    }
  }
);
