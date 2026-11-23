import crypto from 'crypto';
import express, { type Request, type Response } from 'express';
import {
  getVerifiedSessionClaims,
  isCanonicalAuthenticatedClaims,
  resolveTrustedRequestOrigin,
  setSessionCookie,
} from '../securityUtils.ts';
import {
  applyExternalTeamSyncBatch,
  followTeamAsParentOrFan,
  getPublicTeamHubBySlugOrCode,
  syncTeamIcsCalendar,
  updateTeamExternalSyncConfig,
} from '../athleticSyncService.ts';
import { getUserById } from '../authService.ts';
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
      ...(sessionToken ? { sessionToken } : {}),
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
