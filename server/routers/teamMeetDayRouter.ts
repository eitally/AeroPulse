import express, { type Request, type Response } from 'express';
import {
  getVerifiedSessionClaims,
  isCanonicalAuthenticatedClaims,
  resolveTrustedRequestOrigin,
} from '../securityUtils.ts';
import {
  deleteMeetDayPacket,
  listMeetDayPackets,
  saveMeetDayPacket,
} from '../teamMeetDayOpsService.ts';
import { listTeamsForUser } from '../teamStoreCore.ts';

export const teamMeetDayRouter = express.Router();

teamMeetDayRouter.get(
  '/api/teams/:teamId/meet-day-packets',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const result = await listMeetDayPackets({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
      });
      if (!result.ok) {
        res.status(result.status || 403).json({
          ok: false,
          error: result.error || 'Unable to load meet-day packets.',
        });
        return;
      }
      res.json({ ok: true, packets: result.packets || [] });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed loading meet-day packets.',
      });
    }
  }
);

teamMeetDayRouter.post(
  '/api/teams/:teamId/meet-day-packets',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const originUrl = resolveTrustedRequestOrigin(req);
      const body = (req.body || {}) as Record<string, unknown>;
      const result = await saveMeetDayPacket({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        originUrl,
        packet: {
          packetId: body.packetId,
          meetTitle: body.meetTitle,
          meetDate: body.meetDate,
          laneCount: body.laneCount,
          flightSize: body.flightSize,
          partitionByDivision: body.partitionByDivision,
          seedingAuthority: body.seedingAuthority,
          athleticLiveUrl: body.athleticLiveUrl,
          meetDelayMinutes: body.meetDelayMinutes,
          entries: body.entries,
        },
      });
      if (!result.ok) {
        res.status(result.status || 403).json({
          ok: false,
          error: result.error || 'Unable to save meet-day packet.',
        });
        return;
      }
      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({
        ok: true,
        packet: result.packet,
        packets: result.packets || [],
        team: result.team,
        teams,
      });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed saving meet-day packet.',
      });
    }
  }
);

teamMeetDayRouter.delete(
  '/api/teams/:teamId/meet-day-packets/:packetId',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const originUrl = resolveTrustedRequestOrigin(req);
      const result = await deleteMeetDayPacket({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        packetId: String(req.params.packetId || ''),
        originUrl,
      });
      if (!result.ok) {
        res.status(result.status || 403).json({
          ok: false,
          error: result.error || 'Unable to delete meet-day packet.',
        });
        return;
      }
      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({
        ok: true,
        packets: result.packets || [],
        team: result.team,
        teams,
      });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed deleting meet-day packet.',
      });
    }
  }
);
