import express, { type Request, type Response } from 'express';
import {
  getVerifiedSessionClaims,
  isCanonicalAuthenticatedClaims,
  resolveTrustedRequestOrigin,
} from '../securityUtils.ts';
import {
  deleteTeamInjuryCase,
  listTeamInjuryCases,
  upsertTeamInjuryCase,
} from '../teamInjuryService.ts';
import { listTeamsForUser } from '../teamStoreCore.ts';

export const teamInjuryRouter = express.Router();

teamInjuryRouter.get('/api/teams/:teamId/injuries', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }

    const result = await listTeamInjuryCases({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
    });
    if (!result.ok) {
      res.status(result.status || 403).json({
        ok: false,
        error: result.error || 'Unable to load injury cases.',
      });
      return;
    }

    res.json({ ok: true, cases: result.cases || [] });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed loading team injury cases.',
    });
  }
});

teamInjuryRouter.post('/api/teams/:teamId/injuries', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }

    const originUrl = resolveTrustedRequestOrigin(req);
    const body = (req.body || {}) as Record<string, unknown>;
    const result = await upsertTeamInjuryCase({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      originUrl,
      input: {
        id: body.id,
        membershipId: body.membershipId,
        bodyRegion: body.bodyRegion,
        severity: body.severity,
        rtpStage: body.rtpStage,
        restrictions: body.restrictions,
        coachGuidance: body.coachGuidance,
        privateClinicalNotes: body.privateClinicalNotes,
        targetReturnDate: body.targetReturnDate,
      },
    });
    if (!result.ok) {
      res.status(result.status || 403).json({
        ok: false,
        error: result.error || 'Unable to save injury case.',
      });
      return;
    }

    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({
      ok: true,
      case: result.injuryCase,
      cases: result.cases || [],
      team: result.team,
      teams,
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed saving injury case.',
    });
  }
});

teamInjuryRouter.delete(
  '/api/teams/:teamId/injuries/:caseId',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }

      const originUrl = resolveTrustedRequestOrigin(req);
      const result = await deleteTeamInjuryCase({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        caseId: String(req.params.caseId || ''),
        originUrl,
      });
      if (!result.ok) {
        res.status(result.status || 403).json({
          ok: false,
          error: result.error || 'Unable to delete injury case.',
        });
        return;
      }

      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({
        ok: true,
        cases: result.cases || [],
        team: result.team,
        teams,
      });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed deleting injury case.',
      });
    }
  }
);
