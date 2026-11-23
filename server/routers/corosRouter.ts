import { Router, type Request, type Response } from 'express';
import {
  COROS_API_BASE,
  type CorosRawWorkout,
  ensureValidCorosAccessToken,
  getEffectiveCorosClientConfig,
  getEffectiveCorosTokens,
  normalizeCorosWorkout,
  pushWorkoutToCorosConnect,
} from '../corosConnectService.ts';
import { resolveCorosCallbackUrl } from '../oauthHelpers.ts';
import { registerOAuthConnectorRoutes } from '../oauthConnectorFactory.ts';
import { getScopedRuntimeStore } from '../sessionContext.ts';
import { parseClientTzOffsetMins } from '../../src/utils/activityTimestamp.ts';

export const corosRouter = Router();
export { getEffectiveCorosClientConfig, getEffectiveCorosTokens };

const { callbackHandler: corosCallbackHandler } = registerOAuthConnectorRoutes(corosRouter, {
  provider: 'coros',
  displayName: 'COROS',
  accentColor: '#F97316',
  authorizeUrl: `${COROS_API_BASE}/oauth2/authorize`,
  scope: (process.env.COROS_OAUTH_SCOPE || '').trim(),
  envVarNames: ['COROS_CLIENT_ID', 'COROS_CLIENT_SECRET'],
  usePkce: false,
  unconfiguredStatusCode: 503,
  unconfiguredMessage:
    'COROS Open API OAuth is not configured yet (COROS_CLIENT_ID / COROS_CLIENT_SECRET pending). Use the Intervals.icu Cross-Watch Bridge or Download .FIT to push workouts to your COROS watch in the meantime.',
  successBody:
    'Your COROS account is now linked via Official COROS Open API OAuth 2.0. Workouts, biometrics, and structured training sessions sync automatically.',
  getClientConfig: getEffectiveCorosClientConfig,
  resolveCallbackUrl: resolveCorosCallbackUrl,
  exchangeCode: async ({ code, redirectUri, clientId, clientSecret }) => {
    const tokenResp = await fetch(`${COROS_API_BASE}/oauth2/accesstoken`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!tokenResp.ok) {
      const errBody = await tokenResp.text().catch(() => '');
      throw new Error(
        `COROS token exchange failed (${tokenResp.status}): ${errBody.slice(0, 160)}`
      );
    }

    const rawTokenJson = (await tokenResp.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      openId?: string;
      scope?: string;
      data?: {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        openId?: string;
        scope?: string;
      };
    };
    const tokenData = rawTokenJson.data || rawTokenJson;
    const accessToken = String(tokenData.access_token || '').trim();
    if (!accessToken) {
      throw new Error('COROS Open API did not return a valid access token.');
    }

    let athleteId = String(tokenData.openId || '').trim();
    let athleteName = athleteId ? `COROS Athlete ${athleteId.slice(0, 6)}` : 'COROS Athlete';

    try {
      const userUrl = athleteId
        ? `${COROS_API_BASE}/v2/coros/user/info?openId=${encodeURIComponent(athleteId)}`
        : `${COROS_API_BASE}/v2/coros/user/info`;
      const profileResp = await fetch(userUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });
      if (profileResp.ok) {
        const rawUser = (await profileResp.json()) as {
          openId?: string;
          nickname?: string;
          name?: string;
          data?: { openId?: string; nickname?: string; name?: string };
        };
        const u = rawUser.data || rawUser;
        if (u.openId && !athleteId) athleteId = String(u.openId).trim();
        const resolvedName = String(u.nickname || u.name || '').trim();
        if (resolvedName) athleteName = resolvedName;
      }
    } catch {
      // non-fatal if profile endpoint is unavailable
    }

    if (!athleteId) athleteId = 'coros-athlete';

    return {
      athleteId,
      athleteName,
      scope: tokenData.scope,
      applyToStore: (store) => {
        store.corosAccessToken = accessToken;
        if (tokenData.refresh_token) store.corosRefreshToken = tokenData.refresh_token;
        if (tokenData.expires_in) {
          store.corosExpiresAt = Math.floor(Date.now() / 1000) + Number(tokenData.expires_in);
        }
        store.corosAthleteId = athleteId;
        store.corosAthleteName = athleteName;
      },
    };
  },
  clearStoreTokens: (store) => {
    store.corosAccessToken = '';
    store.corosRefreshToken = '';
    store.corosExpiresAt = 0;
    store.corosAthleteId = '';
    store.corosAthleteName = '';
  },
});

export { corosCallbackHandler };

function formatCorosDateParam(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

corosRouter.get('/api/coros/sync', async (req: Request, res: Response) => {
  try {
    const token = await ensureValidCorosAccessToken(req);
    if (!token) {
      res.status(401).json({ ok: false, error: 'COROS account is not connected.' });
      return;
    }

    const { athleteId } = getEffectiveCorosTokens(req);
    const endDate = formatCorosDateParam(new Date(Date.now() + 86400 * 1000));
    const startDate = formatCorosDateParam(new Date(Date.now() - 30 * 86400 * 1000));
    const qs = new URLSearchParams({
      startDate,
      endDate,
      ...(athleteId ? { openId: athleteId } : {}),
    });

    const resp = await fetch(`${COROS_API_BASE}/v2/coros/sport/list?${qs.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      res.status(resp.status).json({
        ok: false,
        error: `Failed to fetch COROS workouts (${resp.status}): ${errText.slice(0, 160)}`,
      });
      return;
    }

    const payload = (await resp.json()) as
      | CorosRawWorkout[]
      | {
          workouts?: CorosRawWorkout[];
          activities?: CorosRawWorkout[];
          dataList?: CorosRawWorkout[];
          data?:
            | CorosRawWorkout[]
            | { dataList?: CorosRawWorkout[]; list?: CorosRawWorkout[] };
        };

    let rawList: CorosRawWorkout[] = [];
    if (Array.isArray(payload)) {
      rawList = payload;
    } else if (Array.isArray(payload.data)) {
      rawList = payload.data;
    } else if (payload.data && Array.isArray(payload.data.dataList)) {
      rawList = payload.data.dataList;
    } else if (payload.data && Array.isArray(payload.data.list)) {
      rawList = payload.data.list;
    } else if (Array.isArray(payload.dataList)) {
      rawList = payload.dataList;
    } else if (Array.isArray(payload.workouts)) {
      rawList = payload.workouts;
    } else if (Array.isArray(payload.activities)) {
      rawList = payload.activities;
    }

    const store = getScopedRuntimeStore(req);
    const profileObj = (store.athleteProfile || {}) as {
      thresholdPaceSecsPerKm?: number;
      ftp?: number;
      lthr?: number;
      restingHr?: number;
    };
    const clientTzOffsetMins = parseClientTzOffsetMins(req.headers['x-client-tz-offset-mins']);

    const activities = rawList.map((raw) =>
      normalizeCorosWorkout(raw, {
        thresholdPaceSecsPerKm: Number(profileObj.thresholdPaceSecsPerKm) || 245,
        ftpWatts: store.athleteFtp || Number(profileObj.ftp) || 250,
        lthrBpm: store.athleteLthr || Number(profileObj.lthr) || 165,
        restingHr: Number(profileObj.restingHr) || 52,
        clientTzOffsetMins,
      })
    );

    res.json({
      ok: true,
      activities,
      count: activities.length,
      syncedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to sync COROS workouts',
    });
  }
});

corosRouter.post('/api/coros/workout/push', async (req: Request, res: Response) => {
  const { clientId, clientSecret } = getEffectiveCorosClientConfig(req);
  const corosConfigured = Boolean(clientId && clientSecret);
  try {
    const token = await ensureValidCorosAccessToken(req);
    if (!token) {
      res.status(corosConfigured ? 401 : 503).json({
        ok: false,
        pushed: false,
        setupRequired: !corosConfigured,
        connectRequired: corosConfigured,
        error: corosConfigured
          ? 'COROS is not connected yet. Connect COROS in Data Sources to push workouts directly to your watch.'
          : 'COROS Open API credentials (COROS_CLIENT_ID / COROS_CLIENT_SECRET) are not configured yet. Use the Intervals.icu Cross-Watch Bridge or Download .FIT in the meantime.',
      });
      return;
    }

    const body = req.body || {};
    const store = getScopedRuntimeStore(req);
    const profileObj = (store.athleteProfile || {}) as {
      thresholdPaceSecsPerKm?: number;
      ftp?: number;
      lthr?: number;
    };
    const { athleteId } = getEffectiveCorosTokens(req);

    const pushResult = await pushWorkoutToCorosConnect({
      accessToken: token,
      openId: athleteId || undefined,
      input: {
        date: String(body.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
        name: String(body.name || 'MeetReady Prescribed Session'),
        sportCategory: String(body.sportCategory || 'Running'),
        description: typeof body.description === 'string' ? body.description : undefined,
        workoutSyntax: typeof body.workoutSyntax === 'string' ? body.workoutSyntax : undefined,
        ftpWatts: Number(body.ftpWatts || store.athleteFtp || profileObj.ftp || 250),
        lthrBpm: Number(body.lthrBpm || store.athleteLthr || profileObj.lthr || 165),
        thresholdPaceSecsPerKm: Number(
          body.thresholdPaceSecsPerKm || profileObj.thresholdPaceSecsPerKm || 245
        ),
        steps: Array.isArray(body.steps) ? body.steps : undefined,
      },
    });

    res.json({ ok: true, ...pushResult });
  } catch (err: unknown) {
    res.status(500).json({
      ok: false,
      pushed: false,
      error: err instanceof Error ? err.message : 'Failed to push workout to COROS',
    });
  }
});
