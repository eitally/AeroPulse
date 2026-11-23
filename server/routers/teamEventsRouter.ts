import express, { type Request, type Response } from 'express';
import {
  getVerifiedSessionClaims,
  isCanonicalAuthenticatedClaims,
  resolveTrustedRequestOrigin,
} from '../securityUtils.ts';
import {
  deleteTeamEvent,
  getOrMintPrivateCalendarMeta,
  getPrivateTeamCalendarIcsByToken,
  listTeamEventsForCaller,
  rotatePrivateCalendarToken,
  submitTeamEventRsvp,
  upsertTeamEvent,
} from '../teamEventsService.ts';

export const teamEventsRouter = express.Router();

teamEventsRouter.get('/api/teams/:teamId/events', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const result = await listTeamEventsForCaller({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
    });
    if (!result.ok || !result.payload) {
      res.status(result.status || 403).json({
        ok: false,
        error: result.error || 'Unable to load team events.',
      });
      return;
    }
    res.json({ ok: true, ...result.payload });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed loading team events.',
    });
  }
});

teamEventsRouter.post('/api/teams/:teamId/events', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
    const body = (req.body || {}) as Record<string, unknown>;
    const result = await upsertTeamEvent({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      input: body,
      originUrl,
    });
    if (!result.ok || !result.event) {
      res.status(result.status || 403).json({
        ok: false,
        error: result.error || 'Unable to save team event.',
      });
      return;
    }
    res.json({
      ok: true,
      event: result.event,
      ...(result.photoReleaseOptOutNames?.length
        ? { photoReleaseOptOutNames: result.photoReleaseOptOutNames }
        : {}),
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed saving team event.',
    });
  }
});

teamEventsRouter.delete(
  '/api/teams/:teamId/events/:eventId',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const result = await deleteTeamEvent({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        eventId: String(req.params.eventId || ''),
      });
      if (!result.ok) {
        res.status(result.status || 403).json({
          ok: false,
          error: result.error || 'Unable to delete team event.',
        });
        return;
      }
      res.json({ ok: true, deleted: Boolean(result.deleted) });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed deleting team event.',
      });
    }
  }
);

teamEventsRouter.put(
  '/api/teams/:teamId/events/:eventId/rsvp',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const body = (req.body || {}) as Record<string, unknown>;
      const result = await submitTeamEventRsvp({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        eventId: String(req.params.eventId || ''),
        membershipId: typeof body.membershipId === 'string' ? body.membershipId : undefined,
        status: body.status,
        travelMode: body.travelMode,
        note: body.note,
      });
      if (!result.ok || !result.rsvp) {
        res.status(result.status || 403).json({
          ok: false,
          error: result.error || 'Unable to submit RSVP.',
        });
        return;
      }
      res.json({
        ok: true,
        rsvp: result.rsvp,
        counts: result.counts,
      });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed submitting RSVP.',
      });
    }
  }
);

teamEventsRouter.get(
  '/api/teams/:teamId/calendar-feed/meta',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const result = await getOrMintPrivateCalendarMeta({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        originUrl: resolveTrustedRequestOrigin(req),
      });
      if (!result.ok || !result.feedUrl) {
        res.status(result.status || 403).json({
          ok: false,
          error: result.error || 'Unable to load private calendar link.',
        });
        return;
      }
      res.json({
        ok: true,
        feedUrl: result.feedUrl,
        webcalUrl: result.webcalUrl,
        googleCalendarUrl: result.googleCalendarUrl,
        canRotate: Boolean(result.canRotate),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed loading calendar metadata.',
      });
    }
  }
);

teamEventsRouter.post(
  '/api/teams/:teamId/calendar-feed/rotate',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const result = await rotatePrivateCalendarToken({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        originUrl: resolveTrustedRequestOrigin(req),
      });
      if (!result.ok || !result.feedUrl) {
        res.status(result.status || 403).json({
          ok: false,
          error: result.error || 'Unable to rotate calendar feed token.',
        });
        return;
      }
      res.json({
        ok: true,
        feedUrl: result.feedUrl,
        webcalUrl: result.webcalUrl,
        googleCalendarUrl: result.googleCalendarUrl,
        canRotate: Boolean(result.canRotate),
      });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed rotating calendar token.',
      });
    }
  }
);

teamEventsRouter.get(
  '/api/teams/:teamId/calendar-feed/:tokenFile',
  async (req: Request, res: Response) => {
    try {
      const result = await getPrivateTeamCalendarIcsByToken({
        teamId: String(req.params.teamId || ''),
        token: String(req.params.tokenFile || ''),
        originUrl: resolveTrustedRequestOrigin(req),
      });
      if (!result.ok || !result.icsBody) {
        res.status(result.status || 404).type('text/plain').send('Team calendar feed not found.');
        return;
      }
      const safeSlug =
        String(result.slug || 'team')
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .slice(0, 48) || 'team';
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="${safeSlug}-team-schedule.ics"`);
      res.setHeader('Cache-Control', 'private, max-age=900');
      res.status(200).send(result.icsBody);
    } catch {
      res.status(500).type('text/plain').send('Unable to generate team calendar feed.');
    }
  }
);
