import { Router, type Request, type Response } from 'express';
import { resolveWahooCallbackUrl } from '../oauthHelpers.ts';
import { registerOAuthConnectorRoutes } from '../oauthConnectorFactory.ts';
import { getScopedRuntimeStore, requestContext, saveSessionCacheAsync } from '../sessionContext.ts';
import {
  normalizeActivityTimestamps,
  parseClientTzOffsetMins,
  parseIsoWithExplicitOffsetToUtcMs,
  resolveIanaTimeZoneOffsetMinutes,
} from '../../src/utils/activityTimestamp.ts';

export const wahooRouter = Router();

interface WahooWorkoutSummaryRaw {
  duration_active_seconds?: number | string;
  duration_seconds?: number | string;
  distance_metres?: number | string;
  ascent_metres?: number | string;
  power_avg?: number | string | null;
  heart_rate_avg?: number | string;
  heart_rate_max?: number | string;
  cadence_avg?: number | string | null;
  calories?: number | string | null;
}

export interface WahooWorkoutRaw {
  id: string | number;
  name?: string;
  workout_type_id?: number;
  starts?: string;
  timezone?: string;
  workout_summary?: WahooWorkoutSummaryRaw;
  file?: { url?: string };
}

export function getEffectiveWahooClientConfig(req?: Request) {
  const activeReq = req ?? requestContext.getStore();
  const headerClientId = (activeReq?.headers['x-wahoo-client-id'] as string | undefined) || '';
  const headerClientSecret = (activeReq?.headers['x-wahoo-client-secret'] as string | undefined) || '';
  const clientId = (headerClientId || process.env.WAHOO_CLIENT_ID || '').trim();
  const clientSecret = (headerClientSecret || process.env.WAHOO_CLIENT_SECRET || '').trim();
  return { clientId, clientSecret };
}

export function getEffectiveWahooTokens(req?: Request) {
  const activeReq = req ?? requestContext.getStore();
  const store = getScopedRuntimeStore(activeReq);
  const headerToken = (activeReq?.headers['x-wahoo-access-token'] as string | undefined) || '';
  const accessToken = (headerToken || store.wahooAccessToken || '').trim();
  const refreshToken = (store.wahooRefreshToken || '').trim();
  const expiresAt = store.wahooExpiresAt || 0;
  const athleteId = store.wahooUserId || '';
  const athleteName = store.wahooAthleteName || '';
  const scope = store.wahooScope || '';
  return { accessToken, refreshToken, expiresAt, athleteId, athleteName, scope };
}

export async function ensureValidWahooAccessToken(
  req?: Request,
  forceRefresh = false
): Promise<string> {
  const activeReq = req ?? requestContext.getStore();
  const store = getScopedRuntimeStore(activeReq);
  const { clientId, clientSecret } = getEffectiveWahooClientConfig(activeReq);
  const { accessToken, refreshToken, expiresAt } = getEffectiveWahooTokens(activeReq);

  if (!accessToken && !refreshToken) {
    return '';
  }

  const nowSecs = Math.floor(Date.now() / 1000);
  const needsRefresh =
    forceRefresh || !accessToken || (expiresAt > 0 && nowSecs >= expiresAt - 300);

  if (needsRefresh && clientId && clientSecret && refreshToken) {
    try {
      const resp = await fetch('https://api.wahooligan.com/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }).toString(),
      });

      if (resp.ok) {
        const refreshed = (await resp.json()) as {
          access_token: string;
          refresh_token?: string;
          expires_in?: number;
        };
        store.wahooAccessToken = refreshed.access_token;
        if (refreshed.refresh_token) store.wahooRefreshToken = refreshed.refresh_token;
        if (refreshed.expires_in) {
          store.wahooExpiresAt = Math.floor(Date.now() / 1000) + refreshed.expires_in;
        }
        if (activeReq) {
          activeReq.headers['x-wahoo-access-token'] = refreshed.access_token;
        }
        await saveSessionCacheAsync(activeReq);
        return refreshed.access_token;
      }
    } catch {
      // non-fatal
    }
  }

  return accessToken;
}

const { callbackHandler: wahooCallbackHandler } = registerOAuthConnectorRoutes(wahooRouter, {
  provider: 'wahoo',
  displayName: 'Wahoo',
  accentColor: '#0EA5E9',
  authorizeUrl: 'https://api.wahooligan.com/oauth/authorize',
  scope: 'user_read workouts_read',
  envVarNames: ['WAHOO_CLIENT_ID', 'WAHOO_CLIENT_SECRET'],
  usePkce: true,
  successBody:
    'Your Wahoo Cloud account is now linked via OAuth 2.0 / PKCE. ELEMNT rides, workouts, and FIT files will sync automatically with smart deduplication.',
  getClientConfig: getEffectiveWahooClientConfig,
  resolveCallbackUrl: resolveWahooCallbackUrl,
  exchangeCode: async ({ code, redirectUri, clientId, clientSecret, codeVerifier }) => {
    const bodyParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    if (codeVerifier) {
      bodyParams.set('code_verifier', codeVerifier);
    }

    const tokenResp = await fetch('https://api.wahooligan.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: bodyParams.toString(),
    });

    if (!tokenResp.ok) {
      const errBody = await tokenResp.text();
      throw new Error(
        `Wahoo token exchange failed (${tokenResp.status}): ${errBody.slice(0, 160)}`
      );
    }

    const tokenData = (await tokenResp.json()) as {
      token_type?: string;
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      user?: {
        id?: string | number;
        first_name?: string;
        last_name?: string;
        email?: string;
      };
    };

    const accessToken = String(tokenData.access_token || '').trim();
    if (!accessToken) {
      throw new Error('Wahoo did not return a valid access token.');
    }

    const athleteId = String(tokenData.user?.id || '0').trim();
    const athleteName = String(
      [tokenData.user?.first_name, tokenData.user?.last_name].filter(Boolean).join(' ') ||
        `Wahoo Athlete ${athleteId}`
    ).trim();

    return {
      athleteId,
      athleteName,
      scope: tokenData.scope,
      applyToStore: (store) => {
        store.wahooAccessToken = accessToken;
        if (tokenData.refresh_token) store.wahooRefreshToken = tokenData.refresh_token;
        if (tokenData.expires_in) {
          store.wahooExpiresAt = Math.floor(Date.now() / 1000) + tokenData.expires_in;
        }
        store.wahooScope = tokenData.scope || 'user_read workouts_read';
        store.wahooUserId = athleteId;
        store.wahooAthleteName = athleteName;
      },
    };
  },
  clearStoreTokens: (store) => {
    store.wahooAccessToken = '';
    store.wahooRefreshToken = '';
    store.wahooExpiresAt = 0;
    store.wahooScope = '';
    store.wahooUserId = '';
    store.wahooAthleteName = '';
  },
});

export { wahooCallbackHandler };

wahooRouter.get('/api/wahoo/workouts', async (req: Request, res: Response) => {
  try {
    const token = await ensureValidWahooAccessToken(req);
    if (!token) {
      res.status(401).json({ error: 'Wahoo account is not connected.' });
      return;
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(50, Math.max(1, Number(req.query.per_page) || 50));
    const url = `https://api.wahooligan.com/v1/workouts?page=${page}&per_page=${perPage}&order=created_at`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      res.status(resp.status).json({
        error: `Failed to fetch Wahoo workouts (${resp.status}): ${errText.slice(0, 160)}`,
      });
      return;
    }

    const data = (await resp.json()) as WahooWorkoutRaw[] | { workouts?: WahooWorkoutRaw[] };
    const rawWorkouts = Array.isArray(data)
      ? data
      : Array.isArray(data?.workouts)
        ? data.workouts
        : [];
    res.json({ workouts: rawWorkouts });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to retrieve Wahoo workouts',
    });
  }
});

wahooRouter.get('/api/wahoo/workouts/:id/file', async (req: Request, res: Response) => {
  try {
    const token = await ensureValidWahooAccessToken(req);
    if (!token) {
      res.status(401).json({ error: 'Wahoo account is not connected.' });
      return;
    }
    const workoutId = encodeURIComponent(String(req.params.id || '').trim());
    if (!workoutId) {
      res.status(400).json({ error: 'Workout ID is required' });
      return;
    }

    const url = `https://api.wahooligan.com/v1/workouts/${workoutId}/file`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      res.status(resp.status).json({
        error: `Failed to download Wahoo FIT file (${resp.status}): ${errText.slice(0, 160)}`,
      });
      return;
    }

    const arrayBuf = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="wahoo-workout-${workoutId}.fit"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to download Wahoo workout file',
    });
  }
});

wahooRouter.get('/api/wahoo/sync', async (req: Request, res: Response) => {
  try {
    const token = await ensureValidWahooAccessToken(req);
    if (!token) {
      res.status(401).json({ error: 'Wahoo account is not connected.' });
      return;
    }

    const resp = await fetch('https://api.wahooligan.com/v1/workouts?per_page=50&order=created_at', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      res.status(resp.status).json({
        error: `Failed to fetch Wahoo workouts (${resp.status}): ${errText.slice(0, 160)}`,
      });
      return;
    }

    const data = (await resp.json()) as WahooWorkoutRaw[] | { workouts?: WahooWorkoutRaw[] };
    const rawWorkouts = Array.isArray(data)
      ? data
      : Array.isArray(data?.workouts)
        ? data.workouts
        : [];
    const clientTzName = String(
      req.headers['x-client-tz'] || req.query.tz || ''
    ).trim();
    const clientTzOffsetMins = parseClientTzOffsetMins(
      req.headers['x-client-tz-offset-mins'] ?? req.query.tzOffsetMins
    );

    const activities = rawWorkouts.map((w) => {
      const summary = w.workout_summary || {};
      const sport = w.workout_type_id === 2 ? 'Running' : 'Cycling';
      const duration = Number(summary.duration_active_seconds || summary.duration_seconds || 0);
      const isIndoor = /kickr|indoor|trainer/i.test(w.name || '');
      const rawStartUtc = w.starts || new Date().toISOString();
      const rawUtcMs = parseIsoWithExplicitOffsetToUtcMs(rawStartUtc) ?? Date.parse(rawStartUtc);
      const resolvedOffsetMins =
        (typeof w.timezone === 'string' && Number.isFinite(rawUtcMs)
          ? resolveIanaTimeZoneOffsetMinutes(rawUtcMs, w.timezone)
          : undefined) ??
        (clientTzName && Number.isFinite(rawUtcMs)
          ? resolveIanaTimeZoneOffsetMinutes(rawUtcMs, clientTzName)
          : undefined) ??
        clientTzOffsetMins;
      const normalizedTimestamps = normalizeActivityTimestamps({
        startDateUtc: rawStartUtc,
        timeZoneOffsetMins: resolvedOffsetMins,
        fallbackBrowserTz: true,
      });

      return {
        id: `wahoo_${w.id}`,
        wahooId: String(w.id),
        startDateLocal: normalizedTimestamps.startDateLocal,
        ...(normalizedTimestamps.startDateUtcMs !== undefined
          ? { startDateUtcMs: normalizedTimestamps.startDateUtcMs }
          : {}),
        name: w.name || 'Wahoo Workout',
        sportCategory: sport,
        environment: isIndoor ? 'INDOOR' : 'OUTDOOR',
        subType: isIndoor ? 'Smart Trainer' : 'Road',
        movingTimeSecs: duration,
        distanceMeters: Number(summary.distance_metres || 0),
        elevationGainMeters: Number(summary.ascent_metres || 0),
        avgPower: summary.power_avg != null ? Number(summary.power_avg) : undefined,
        normalizedPower: summary.power_avg != null ? Number(summary.power_avg) : undefined,
        avgHr: Number(summary.heart_rate_avg || 0),
        maxHr: Number(summary.heart_rate_max || 0),
        avgCadence: summary.cadence_avg != null ? Number(summary.cadence_avg) : undefined,
        calories: summary.calories != null ? Number(summary.calories) : undefined,
        trainingLoad: Math.round((duration * 60) / 3600),
        sourceBadges: ['Wahoo'],
        deviceName: 'Wahoo ELEMNT',
        fileUrl: w.file?.url || undefined,
        cleanRoomEligibleForAiAndCoaching: true,
      };
    });

    const { athleteId, athleteName } = getEffectiveWahooTokens(req);
    res.json({
      ok: true,
      activities,
      athleteId,
      athleteName,
      receivedCount: activities.length,
      exercisesCount: activities.length,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to sync Wahoo workouts',
    });
  }
});
