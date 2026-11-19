import { Router, type Request, type Response } from 'express';
import { resolvePolarCallbackUrl } from '../oauthHelpers.ts';
import { registerOAuthConnectorRoutes } from '../oauthConnectorFactory.ts';
import { getScopedRuntimeStore, requestContext } from '../sessionContext.ts';
import {
  normalizeActivityTimestamps,
  parseClientTzOffsetMins,
} from '../../src/utils/activityTimestamp.ts';

export const polarRouter = Router();

export interface PolarHrZoneRaw {
  index?: number | string;
  in_zone?: number | string;
  in_zone_seconds?: number | string;
  duration?: number | string;
}

export interface PolarExerciseRaw {
  id: string | number;
  duration?: number | string;
  duration_seconds?: number | string;
  durationSecs?: number | string;
  distance?: number | string;
  distance_metres?: number | string;
  distanceMeters?: number | string;
  sport?: string;
  detailed_sport_info?: string;
  title?: string;
  name?: string;
  heart_rate?: {
    average?: number | string;
    maximum?: number | string;
    zones?: PolarHrZoneRaw[];
  };
  average_heart_rate?: number | string;
  maximum_heart_rate?: number | string;
  avgHr?: number | string;
  maxHr?: number | string;
  zones?: {
    heart_rate?: PolarHrZoneRaw[];
  };
  start_time_utc_offset?: number;
  start_time?: string;
  startTime?: string;
  start_time_utc?: string;
  startTimeUtc?: string;
  ascent?: number | string;
  elevationGainMeters?: number | string;
  calories?: number | string | null;
  device?: string;
  device_name?: string;
  deviceName?: string;
}

export function getEffectivePolarClientConfig(req?: Request) {
  const activeReq = req ?? requestContext.getStore();
  const headerClientId = (activeReq?.headers['x-polar-client-id'] as string | undefined) || '';
  const headerClientSecret = (activeReq?.headers['x-polar-client-secret'] as string | undefined) || '';
  const clientId = (headerClientId || process.env.POLAR_CLIENT_ID || '').trim();
  const clientSecret = (headerClientSecret || process.env.POLAR_CLIENT_SECRET || '').trim();
  return { clientId, clientSecret };
}

export function getEffectivePolarTokens(req?: Request) {
  const activeReq = req ?? requestContext.getStore();
  const store = getScopedRuntimeStore(activeReq);
  const headerToken = (activeReq?.headers['x-polar-access-token'] as string | undefined) || '';
  const accessToken = (headerToken || store.polarAccessToken || '').trim();
  const athleteId = store.polarUserId || '';
  const athleteName = store.polarAthleteName || '';
  const expiresAt = store.polarExpiresAt || 0;
  const scope = store.polarScope || '';
  return { accessToken, athleteId, athleteName, expiresAt, scope };
}

export function parsePolarDurationSecs(rawDuration: unknown): number {
  if (typeof rawDuration === 'number') return Math.max(0, Math.round(rawDuration));
  if (typeof rawDuration !== 'string') return 0;
  const match = rawDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/i);
  if (!match) {
    const raw = Number(rawDuration);
    return Number.isNaN(raw) ? 0 : Math.max(0, Math.round(raw));
  }
  const hours = Number(match[1] || 0);
  const mins = Number(match[2] || 0);
  const secs = Number(match[3] || 0);
  return Math.round(hours * 3600 + mins * 60 + secs);
}

export function normalizePolarExercise(
  exercise: PolarExerciseRaw,
  thresholdPaceSecsPerKm = 245,
  lthr = 165,
  clientTzOffsetMins?: number
): Record<string, unknown> {
  const durationSecs = Math.max(
    1,
    parsePolarDurationSecs(exercise.duration || exercise.duration_seconds || exercise.durationSecs)
  );
  const distanceMeters = Number(
    exercise.distance || exercise.distance_metres || exercise.distanceMeters || 0
  );
  const sportStr = String(exercise.sport || exercise.detailed_sport_info || '').toUpperCase();
  const isRun = /RUN|JOG|TRACK/i.test(sportStr);
  const isCycle = /CYCL|BIKE|SPIN/i.test(sportStr);
  const sportCategory = isRun ? 'Running' : isCycle ? 'Cycling' : 'Running';
  const isIndoor =
    /INDOOR|TREADMILL|STATIONARY/i.test(sportStr) ||
    /treadmill|indoor|stationary/i.test(exercise.title || exercise.name || '');
  const subType = isIndoor ? (isRun ? 'Treadmill' : 'Smart Trainer') : 'Road';

  const avgHr = Number(exercise.heart_rate?.average || exercise.average_heart_rate || exercise.avgHr || 0);
  const maxHr = Number(exercise.heart_rate?.maximum || exercise.maximum_heart_rate || exercise.maxHr || 0);

  let trainingLoad = 0;
  let intensityFactor: number | undefined;
  if (isRun && distanceMeters > 0 && durationSecs > 0) {
    const paceSecsPerKm = (durationSecs / distanceMeters) * 1000;
    const safeThresholdPace = Math.max(120, thresholdPaceSecsPerKm);
    const ifVal = Number((safeThresholdPace / paceSecsPerKm).toFixed(2));
    intensityFactor = ifVal;
    trainingLoad = Math.max(1, Math.round((durationSecs * (ifVal ** 2) * 100) / 3600));
  } else if (avgHr > 0) {
    const safeLthr = Math.max(100, lthr);
    const ifVal = Number((avgHr / safeLthr).toFixed(2));
    intensityFactor = ifVal;
    trainingLoad = Math.max(1, Math.round((durationSecs * (ifVal ** 2) * 100) / 3600));
  } else {
    trainingLoad = Math.max(1, Math.round((durationSecs * 60) / 3600));
  }

  let efficiencyFactor: number | undefined;
  if (avgHr > 0 && distanceMeters > 0 && durationSecs > 0) {
    const speedMPerMin = distanceMeters / (durationSecs / 60);
    efficiencyFactor = Number((speedMPerMin / avgHr).toFixed(2));
  }

  const hrZones = [0, 0, 0, 0, 0, 0, 0];
  const rawHrZones = Array.isArray(exercise.zones?.heart_rate)
    ? exercise.zones.heart_rate
    : Array.isArray(exercise.heart_rate?.zones)
      ? exercise.heart_rate.zones
      : [];
  if (rawHrZones.length > 0) {
    rawHrZones.forEach((z, i) => {
      const rawIdx = z.index != null ? Number(z.index) : i + 1;
      const targetIdx = rawIdx >= 1 && rawIdx <= 7 ? rawIdx - 1 : i;
      const inZoneSecs = parsePolarDurationSecs(z.in_zone ?? z.in_zone_seconds ?? z.duration ?? 0);
      if (targetIdx >= 0 && targetIdx < 7) {
        hrZones[targetIdx] = inZoneSecs;
      }
    });
  }

  const avgPaceSecsPerKm =
    distanceMeters > 0 ? Math.round((durationSecs / distanceMeters) * 1000) : undefined;
  const polarOffsetMins =
    typeof exercise.start_time_utc_offset === 'number' &&
    Number.isFinite(exercise.start_time_utc_offset)
      ? Math.round(exercise.start_time_utc_offset)
      : clientTzOffsetMins;
  const polarTimestamps = normalizeActivityTimestamps({
    startDateLocal: exercise.start_time || exercise.startTime || undefined,
    startDateUtc: exercise.start_time_utc || exercise.startTimeUtc || undefined,
    timeZoneOffsetMins: polarOffsetMins,
    fallbackBrowserTz: true,
  });

  return {
    id: `polar_${exercise.id}`,
    polarId: String(exercise.id),
    startDateLocal: polarTimestamps.startDateLocal,
    ...(polarTimestamps.startDateUtcMs !== undefined
      ? { startDateUtcMs: polarTimestamps.startDateUtcMs }
      : {}),
    name: exercise.title || exercise.name || (isRun ? 'Polar Run' : 'Polar Ride'),
    sportCategory,
    environment: isIndoor ? 'INDOOR' : 'OUTDOOR',
    subType,
    movingTimeSecs: durationSecs,
    distanceMeters,
    elevationGainMeters: Number(exercise.ascent || exercise.elevationGainMeters || 0),
    avgHr,
    maxHr,
    trainingLoad,
    intensityFactor,
    efficiencyFactor,
    avgPaceSecsPerKm,
    gapPaceSecsPerKm: avgPaceSecsPerKm,
    calories: exercise.calories != null ? Number(exercise.calories) : undefined,
    sourceBadges: ['Polar'],
    deviceName: exercise.device || exercise.device_name || exercise.deviceName || 'Polar Flow',
    zoneSecs: { hr: hrZones },
    cleanRoomEligibleForAiAndCoaching: true,
  };
}

const { callbackHandler: polarCallbackHandler } = registerOAuthConnectorRoutes(polarRouter, {
  provider: 'polar',
  displayName: 'Polar',
  accentColor: '#EF4444',
  authorizeUrl: 'https://flow.polar.com/oauth2/authorization',
  scope: 'accesslink.read_all',
  envVarNames: ['POLAR_CLIENT_ID', 'POLAR_CLIENT_SECRET'],
  usePkce: false,
  successBody:
    'Your Polar AccessLink account is now linked via OAuth 2.0. Exercises, heart rate zones, and rTSS will sync automatically with smart deduplication.',
  getClientConfig: getEffectivePolarClientConfig,
  resolveCallbackUrl: resolvePolarCallbackUrl,
  exchangeCode: async ({ code, redirectUri, clientId, clientSecret }) => {
    const basicAuth = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenResp = await fetch('https://polarremote.com/v2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json;charset=UTF-8',
        Authorization: basicAuth,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!tokenResp.ok) {
      const errBody = await tokenResp.text();
      throw new Error(
        `Polar token exchange failed (${tokenResp.status}): ${errBody.slice(0, 160)}`
      );
    }

    const tokenData = (await tokenResp.json()) as {
      token_type?: string;
      access_token?: string;
      expires_in?: number;
      x_user_id?: number | string;
    };

    const accessToken = String(tokenData.access_token || '').trim();
    if (!accessToken) {
      throw new Error('Polar did not return a valid access token.');
    }

    const athleteId = String(tokenData.x_user_id || '0').trim();

    try {
      await fetch('https://polarremote.com/v2/users', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ 'member-id': `thresh_${athleteId}` }),
      });
    } catch {
      // non-fatal
    }

    let athleteName = `Polar Athlete ${athleteId}`;
    try {
      const profileResp = await fetch(
        `https://polarremote.com/v2/users/${encodeURIComponent(athleteId)}`,
        {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        }
      );
      if (profileResp.ok) {
        const profData = (await profileResp.json()) as {
          'first-name'?: string;
          'last-name'?: string;
        };
        const fullName = [profData['first-name'], profData['last-name']].filter(Boolean).join(' ').trim();
        if (fullName) athleteName = fullName;
      }
    } catch {
      // non-fatal
    }

    return {
      athleteId,
      athleteName,
      applyToStore: (store) => {
        store.polarAccessToken = accessToken;
        store.polarUserId = athleteId;
        store.polarAthleteName = athleteName;
        if (tokenData.expires_in) {
          store.polarExpiresAt = Math.floor(Date.now() / 1000) + tokenData.expires_in;
        }
      },
    };
  },
  clearStoreTokens: (store) => {
    store.polarAccessToken = '';
    store.polarUserId = '';
    store.polarAthleteName = '';
    store.polarExpiresAt = 0;
    store.polarScope = '';
  },
});

export { polarCallbackHandler };

polarRouter.get('/api/polar/exercises', async (req: Request, res: Response) => {
  try {
    const { accessToken, athleteId } = getEffectivePolarTokens(req);
    if (!accessToken) {
      res.status(401).json({ error: 'Polar account is not connected.' });
      return;
    }

    const url = athleteId
      ? `https://polarremote.com/v2/users/${encodeURIComponent(athleteId)}/exercises`
      : 'https://polarremote.com/v2/exercises';

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      res.status(resp.status).json({
        error: `Failed to fetch Polar exercises (${resp.status}): ${errText.slice(0, 160)}`,
      });
      return;
    }

    const data = (await resp.json()) as PolarExerciseRaw[] | { exercises?: PolarExerciseRaw[] };
    const rawExercises = Array.isArray(data)
      ? data
      : Array.isArray(data?.exercises)
        ? data.exercises
        : [];
    res.json({ exercises: rawExercises });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to retrieve Polar exercises',
    });
  }
});

polarRouter.get('/api/polar/sync', async (req: Request, res: Response) => {
  try {
    const { accessToken, athleteId, athleteName } = getEffectivePolarTokens(req);
    if (!accessToken) {
      res.status(401).json({ error: 'Polar account is not connected.' });
      return;
    }

    const url = athleteId
      ? `https://polarremote.com/v2/users/${encodeURIComponent(athleteId)}/exercises`
      : 'https://polarremote.com/v2/exercises';

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      res.status(resp.status).json({
        error: `Failed to fetch Polar exercises (${resp.status}): ${errText.slice(0, 160)}`,
      });
      return;
    }

    const data = (await resp.json()) as PolarExerciseRaw[] | { exercises?: PolarExerciseRaw[] };
    const rawExercises = Array.isArray(data)
      ? data
      : Array.isArray(data?.exercises)
        ? data.exercises
        : [];

    const store = getScopedRuntimeStore(req);
    const athleteThresholdPace = 245;
    const athleteLthr = store.athleteLthr || 165;
    const clientTzOffsetMins = parseClientTzOffsetMins(
      req.headers['x-client-tz-offset-mins'] ?? req.query.tzOffsetMins
    );

    const activities = rawExercises.map((ex) =>
      normalizePolarExercise(ex, athleteThresholdPace, athleteLthr, clientTzOffsetMins)
    );

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
      error: err instanceof Error ? err.message : 'Failed to sync Polar exercises',
    });
  }
});
