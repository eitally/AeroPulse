import express, { type Request, type Response } from 'express';
import {
  getVerifiedSessionClaims,
  isCanonicalAuthenticatedClaims,
  resolveTrustedRequestOrigin,
} from '../../securityUtils.ts';
import {
  deleteTeamAnnouncement,
  postTeamAnnouncement,
} from '../../teamFieldAndDailyOpsService.ts';
import {
  dispatchPushPayloadToUsers,
  getOrInitVapidKeys,
  listUserPushSubscriptions,
  removeUserPushSubscription,
  saveUserPushSubscription,
} from '../../pushNotificationService.ts';
import {
  acknowledgeTeamMessage,
  deleteTeamCustomSubgroup,
  flagTeamMessageForReview,
  postTeamMessage,
  updateTeamMessagingPolicy,
  upsertTeamCustomSubgroup,
} from '../../teamMessagingService.ts';
import { listTeamsForUser } from '../../teamService.ts';
import type { CoachEventGroup, TeamMessageChannelScope } from '../../../src/types.ts';

export const messagingAndPushRouter = express.Router();

// Announcements
messagingAndPushRouter.post('/api/teams/:teamId/announcements', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
    const body = (req.body || {}) as {
      title?: unknown;
      body?: unknown;
      category?: unknown;
      targetEventGroups?: unknown;
      publishToParentHub?: unknown;
    };
    const result = await postTeamAnnouncement({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      title: String(body.title || ''),
      body: String(body.body || ''),
      category:
        typeof body.category === 'string'
          ? (body.category as 'WEATHER' | 'SCHEDULE_CHANGE' | 'MEET_LOGISTICS' | 'GENERAL')
          : undefined,
      targetEventGroups: Array.isArray(body.targetEventGroups)
        ? body.targetEventGroups.map((g) => String(g) as CoachEventGroup)
        : undefined,
      publishToParentHub: body.publishToParentHub === true,
      originUrl,
    });
    if (!result.ok) {
      res.status(403).json({
        ok: false,
        error: result.error || 'Unable to post announcement.',
      });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, announcement: result.announcement, team: result.team, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed posting announcement.',
    });
  }
});

messagingAndPushRouter.delete(
  '/api/teams/:teamId/announcements/:announcementId',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const originUrl = resolveTrustedRequestOrigin(req);
      const result = await deleteTeamAnnouncement({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        announcementId: String(req.params.announcementId || ''),
        originUrl,
      });
      if (!result.ok) {
        res.status(403).json({
          ok: false,
          error: result.error || 'Unable to delete announcement.',
        });
        return;
      }
      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({ ok: true, team: result.team, teams });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed deleting announcement.',
      });
    }
  }
);

// SafeSport MAAPP Coach-Athlete-Family Transparent Messaging & Subgroups
messagingAndPushRouter.post('/api/teams/:teamId/messages', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
    const body = (req.body || {}) as {
      channelScope?: unknown;
      eventGroup?: unknown;
      customSubgroupId?: unknown;
      targetMembershipId?: unknown;
      body?: unknown;
      privateDirectToMinor?: unknown;
      guardianCc?: unknown;
      clientLocalHour?: unknown;
      isEmergencyOverride?: unknown;
    };
    const scope = String(body.channelScope || 'ALL_TEAM') as TeamMessageChannelScope;
    const result = await postTeamMessage({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      channelScope: scope,
      eventGroup: typeof body.eventGroup === 'string' ? body.eventGroup : undefined,
      customSubgroupId: typeof body.customSubgroupId === 'string' ? body.customSubgroupId : undefined,
      targetMembershipId: typeof body.targetMembershipId === 'string' ? body.targetMembershipId : undefined,
      body: String(body.body || ''),
      privateDirectToMinor: body.privateDirectToMinor === true,
      guardianCc: typeof body.guardianCc === 'boolean' ? body.guardianCc : undefined,
      clientLocalHour: typeof body.clientLocalHour === 'number' ? body.clientLocalHour : undefined,
      isEmergencyOverride: body.isEmergencyOverride === true,
      originUrl,
    });
    if (!result.ok) {
      res.status(result.status || 403).json({
        ok: false,
        error: result.error || 'Unable to send message.',
      });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({
      ok: true,
      message: result.message,
      team: result.team,
      teams,
      ...(typeof result.emailFallbackCount === 'number'
        ? { emailFallbackCount: result.emailFallbackCount }
        : {}),
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed sending team message.',
    });
  }
});

messagingAndPushRouter.post(
  '/api/teams/:teamId/messages/:messageId/ack',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const originUrl = resolveTrustedRequestOrigin(req);
      const result = await acknowledgeTeamMessage({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        messageId: String(req.params.messageId || ''),
        originUrl,
      });
      if (!result.ok) {
        res.status(result.status || 403).json({
          ok: false,
          error: result.error || 'Unable to acknowledge message.',
        });
        return;
      }
      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({ ok: true, team: result.team, teams });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed acknowledging message.',
      });
    }
  }
);

messagingAndPushRouter.post(
  '/api/teams/:teamId/messages/:messageId/flag',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const originUrl = resolveTrustedRequestOrigin(req);
      const body = (req.body || {}) as { reason?: unknown };
      const result = await flagTeamMessageForReview({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        messageId: String(req.params.messageId || ''),
        reason: typeof body.reason === 'string' ? body.reason : undefined,
        originUrl,
      });
      if (!result.ok) {
        res.status(result.status || 403).json({
          ok: false,
          error: result.error || 'Unable to flag message.',
        });
        return;
      }
      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({ ok: true, team: result.team, teams });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed flagging message.',
      });
    }
  }
);

messagingAndPushRouter.patch(
  '/api/teams/:teamId/messaging-policy',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const originUrl = resolveTrustedRequestOrigin(req);
      const body = (req.body || {}) as {
        athleteRepliesEnabled?: unknown;
        parentRepliesEnabled?: unknown;
        enablePushEmailFallback?: unknown;
        quietHoursStartHour?: unknown;
        quietHoursEndHour?: unknown;
      };
      const result = await updateTeamMessagingPolicy({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        athleteRepliesEnabled:
          typeof body.athleteRepliesEnabled === 'boolean' ? body.athleteRepliesEnabled : undefined,
        parentRepliesEnabled:
          typeof body.parentRepliesEnabled === 'boolean' ? body.parentRepliesEnabled : undefined,
        enablePushEmailFallback:
          typeof body.enablePushEmailFallback === 'boolean' ? body.enablePushEmailFallback : undefined,
        quietHoursStartHour:
          typeof body.quietHoursStartHour === 'number' ? body.quietHoursStartHour : undefined,
        quietHoursEndHour:
          typeof body.quietHoursEndHour === 'number' ? body.quietHoursEndHour : undefined,
        originUrl,
      });
      if (!result.ok) {
        res.status(result.status || 403).json({
          ok: false,
          error: result.error || 'Unable to update messaging policy.',
        });
        return;
      }
      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({ ok: true, team: result.team, teams });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed updating messaging policy.',
      });
    }
  }
);

messagingAndPushRouter.post('/api/teams/:teamId/subgroups', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
    const body = (req.body || {}) as {
      subgroupId?: unknown;
      name?: unknown;
      description?: unknown;
      memberIds?: unknown;
      includeLinkedParents?: unknown;
    };
    const result = await upsertTeamCustomSubgroup({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      subgroupId: typeof body.subgroupId === 'string' ? body.subgroupId : undefined,
      name: String(body.name || ''),
      description: typeof body.description === 'string' ? body.description : undefined,
      memberIds: Array.isArray(body.memberIds) ? body.memberIds.map((v) => String(v)) : [],
      includeLinkedParents:
        typeof body.includeLinkedParents === 'boolean' ? body.includeLinkedParents : true,
      originUrl,
    });
    if (!result.ok) {
      res.status(result.status || 403).json({
        ok: false,
        error: result.error || 'Unable to save sub-group.',
      });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, subgroup: result.subgroup, team: result.team, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed saving sub-group.',
    });
  }
});

messagingAndPushRouter.delete(
  '/api/teams/:teamId/subgroups/:subgroupId',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const originUrl = resolveTrustedRequestOrigin(req);
      const result = await deleteTeamCustomSubgroup({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        subgroupId: String(req.params.subgroupId || ''),
        originUrl,
      });
      if (!result.ok) {
        res.status(result.status || 403).json({
          ok: false,
          error: result.error || 'Unable to delete sub-group.',
        });
        return;
      }
      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({ ok: true, team: result.team, teams });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed deleting sub-group.',
      });
    }
  }
);

// Web Push VAPID Subscription & Dispatch
messagingAndPushRouter.get('/api/push/vapid-public-key', async (_req: Request, res: Response) => {
  try {
    const keys = await getOrInitVapidKeys();
    res.json({ ok: true, publicKey: keys.publicKey });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed initializing Web Push VAPID keys.',
    });
  }
});

messagingAndPushRouter.get('/api/push/status', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const subs = await listUserPushSubscriptions(claims.sid);
    res.json({
      ok: true,
      subscriptionCount: subs.length,
      subscriptions: subs.map((s) => ({
        id: s.id,
        endpointPreview: `${s.endpoint.slice(0, 42)}…`,
        userAgent: s.userAgent,
        updatedAt: s.updatedAt,
        muteQuietHours: Boolean(s.muteQuietHours),
      })),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed loading push subscription status.',
    });
  }
});

messagingAndPushRouter.post('/api/push/subscribe', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const body = (req.body || {}) as {
      endpoint?: unknown;
      keys?: { p256dh?: unknown; auth?: unknown };
      userAgent?: unknown;
      muteQuietHours?: unknown;
    };
    const result = await saveUserPushSubscription({
      userSid: claims.sid,
      endpoint: String(body.endpoint || ''),
      keys: {
        p256dh: String(body.keys?.p256dh || ''),
        auth: String(body.keys?.auth || ''),
      },
      userAgent: typeof body.userAgent === 'string' ? body.userAgent : req.get('user-agent'),
      muteQuietHours: body.muteQuietHours === true,
    });
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error || 'Invalid push subscription.' });
      return;
    }
    const subs = await listUserPushSubscriptions(claims.sid);
    res.json({ ok: true, subscriptionCount: subs.length });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed saving device push subscription.',
    });
  }
});

messagingAndPushRouter.delete('/api/push/subscribe', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const body = (req.body || {}) as { endpoint?: unknown };
    const result = await removeUserPushSubscription({
      userSid: claims.sid,
      endpoint: typeof body.endpoint === 'string' ? body.endpoint : undefined,
    });
    res.json({ ok: true, remainingCount: result.remainingCount });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed removing device push subscription.',
    });
  }
});

messagingAndPushRouter.post('/api/push/test', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const result = await dispatchPushPayloadToUsers({
      recipientSids: [claims.sid],
      payload: {
        title: 'MeetReady Practice Alerts Active',
        body: 'Device push notifications are connected for coach messages and weather updates.',
        tag: 'thresh-test',
        url: '/?openMessages=1',
        isEmergency: false,
      },
    });
    res.json({ ok: true, deliveredCount: result.deliveredCount, prunedCount: result.prunedCount });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed sending test notification.',
    });
  }
});
