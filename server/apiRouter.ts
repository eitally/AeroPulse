import express, { Request, Response } from 'express';
import { GoogleGenAI, Type } from '@google/genai';

export const apiRouter = express.Router();

// In-memory runtime credential store for single-user / fork self-service mode
// (Supplements environment variables when users enter credentials via the Data Sources UI)
interface RuntimeSessionStore {
  intervalsApiKey: string;
  intervalsAthleteId: string;
  intervalsAthleteName: string;
  stravaClientId: string;
  stravaClientSecret: string;
  stravaAccessToken: string;
  stravaRefreshToken: string;
  stravaExpiresAt: number;
  stravaAthleteName: string;
}

const runtimeStore: RuntimeSessionStore = {
  intervalsApiKey: process.env.INTERVALS_API_KEY || '',
  intervalsAthleteId: process.env.INTERVALS_ATHLETE_ID || '0',
  intervalsAthleteName: '',
  stravaClientId: process.env.STRAVA_CLIENT_ID || '',
  stravaClientSecret: process.env.STRAVA_CLIENT_SECRET || '',
  stravaAccessToken: '',
  stravaRefreshToken: '',
  stravaExpiresAt: 0,
  stravaAthleteName: '',
};

function getGeminiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getEffectiveIntervalsConfig(req: Request) {
  const headerKey = req.headers['x-intervals-api-key'] as string | undefined;
  const headerAthlete = req.headers['x-intervals-athlete-id'] as string | undefined;
  const apiKey = (headerKey || runtimeStore.intervalsApiKey || process.env.INTERVALS_API_KEY || '').trim();
  const athleteId = (headerAthlete || runtimeStore.intervalsAthleteId || process.env.INTERVALS_ATHLETE_ID || '0').trim() || '0';
  return { apiKey, athleteId };
}

function getEffectiveStravaClientConfig(req: Request) {
  const headerClientId = req.headers['x-strava-client-id'] as string | undefined;
  const headerClientSecret = req.headers['x-strava-client-secret'] as string | undefined;
  const clientId = (headerClientId || runtimeStore.stravaClientId || process.env.STRAVA_CLIENT_ID || '').trim();
  const clientSecret = (headerClientSecret || runtimeStore.stravaClientSecret || process.env.STRAVA_CLIENT_SECRET || '').trim();
  return { clientId, clientSecret };
}

function resolveCallbackUrl(req: Request): string {
  const explicitOrigin = (req.query.origin as string | undefined)?.replace(/\/$/, '');
  if (explicitOrigin) {
    return `${explicitOrigin}/auth/strava/callback`;
  }
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  if (appUrl && !appUrl.includes('MY_APP_URL')) {
    return `${appUrl}/auth/strava/callback`;
  }
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000';
  return `${proto}://${host}/auth/strava/callback`;
}

// ----------------------------------------------------------------------------
// 1. Configuration & Connection Status
// ----------------------------------------------------------------------------
apiRouter.get('/api/config/status', (req: Request, res: Response) => {
  const { apiKey: intervalsKey, athleteId } = getEffectiveIntervalsConfig(req);
  const { clientId: stravaClientId } = getEffectiveStravaClientConfig(req);
  const hasIntervalsEnv = Boolean(process.env.INTERVALS_API_KEY && process.env.INTERVALS_API_KEY.trim());
  const hasStravaEnv = Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);
  const hasGeminiServerKey = Boolean(
    process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY' && process.env.GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY'
  );

  res.json({
    intervalsConnected: Boolean(intervalsKey),
    intervalsAthleteId: athleteId,
    intervalsAthleteName: runtimeStore.intervalsAthleteName || undefined,
    intervalsSource: hasIntervalsEnv ? 'ENV' : intervalsKey ? 'USER_INPUT' : 'NONE',
    stravaConfigured: Boolean(stravaClientId),
    stravaConnected: Boolean(runtimeStore.stravaAccessToken),
    stravaAthleteName: runtimeStore.stravaAthleteName || undefined,
    stravaSource: runtimeStore.stravaAccessToken ? 'OAUTH' : hasStravaEnv ? 'ENV' : 'NONE',
    hasGeminiServerKey,
    callbackUrl: resolveCallbackUrl(req),
  });
});

// ----------------------------------------------------------------------------
// 2. Intervals.icu Integration (Athlete, Garmin-Synced Wellness, Activities, Streams)
// ----------------------------------------------------------------------------
apiRouter.post('/api/intervals/connect', async (req: Request, res: Response) => {
  try {
    const apiKey = (req.body?.apiKey || process.env.INTERVALS_API_KEY || '').trim();
    const athleteId = (req.body?.athleteId || process.env.INTERVALS_ATHLETE_ID || '0').trim() || '0';

    if (!apiKey) {
      res.status(400).json({ error: 'Please provide a valid Intervals.icu Personal API Key.' });
      return;
    }

    const authHeader = 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64');
    const profileResp = await fetch(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });

    if (!profileResp.ok) {
      const errText = await profileResp.text();
      res.status(profileResp.status).json({
        error: `Intervals.icu authentication failed (${profileResp.status}). Verify your Athlete ID (use "0" for default) and API Key at https://intervals.icu/settings. Details: ${errText.slice(0, 140)}`,
      });
      return;
    }

    const profileData = (await profileResp.json()) as { id?: string; name?: string; firstname?: string; lastname?: string };
    const resolvedId = profileData.id || athleteId;
    const resolvedName =
      profileData.name || [profileData.firstname, profileData.lastname].filter(Boolean).join(' ') || `Athlete ${resolvedId}`;

    runtimeStore.intervalsApiKey = apiKey;
    runtimeStore.intervalsAthleteId = resolvedId;
    runtimeStore.intervalsAthleteName = resolvedName;

    res.json({
      connected: true,
      athleteId: resolvedId,
      athleteName: resolvedName,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to connect to Intervals.icu',
    });
  }
});

apiRouter.post('/api/intervals/disconnect', (_req: Request, res: Response) => {
  runtimeStore.intervalsApiKey = '';
  runtimeStore.intervalsAthleteName = '';
  res.json({ connected: false });
});

apiRouter.get('/api/intervals/sync', async (req: Request, res: Response) => {
  try {
    const { apiKey, athleteId } = getEffectiveIntervalsConfig(req);
    if (!apiKey) {
      res.status(401).json({ error: 'Intervals.icu API Key is not configured.' });
      return;
    }

    const authHeader = 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64');
    const newest = new Date().toISOString().slice(0, 10);
    const oldestDate = new Date();
    oldestDate.setUTCDate(oldestDate.getUTCDate() - 90);
    const oldest = oldestDate.toISOString().slice(0, 10);

    const [wellnessResp, activitiesResp, eventsResp] = await Promise.all([
      fetch(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/wellness?oldest=${oldest}&newest=${newest}`, {
        headers: { Authorization: authHeader, Accept: 'application/json' },
      }),
      fetch(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/activities?oldest=${oldest}&newest=${newest}`, {
        headers: { Authorization: authHeader, Accept: 'application/json' },
      }),
      fetch(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/events?oldest=${newest}&newest=${newest}`, {
        headers: { Authorization: authHeader, Accept: 'application/json' },
      }),
    ]);

    if (!wellnessResp.ok || !activitiesResp.ok) {
      res.status(502).json({
        error: `Intervals.icu sync returned status wellness=${wellnessResp.status}, activities=${activitiesResp.status}`,
      });
      return;
    }

    const rawWellness = (await wellnessResp.json()) as Record<string, any>[];
    const rawActivities = (await activitiesResp.json()) as Record<string, any>[];
    const rawEvents = eventsResp.ok ? ((await eventsResp.json()) as Record<string, any>[]) : [];

    // Normalize Wellness records
    const wellnessDays = rawWellness.map((w, idx, arr) => {
      const ctl = Number((w.ctl ?? 0).toFixed(1));
      const atl = Number((w.atl ?? 0).toFixed(1));
      const tsb = Number((ctl - atl).toFixed(1));
      const hrv = Math.round(w.hrv ?? w.hrvRMSSD ?? 65);
      // 7-day rolling baseline
      const sliceStart = Math.max(0, idx - 6);
      const recentSlice = arr.slice(sliceStart, idx + 1);
      const baseline =
        recentSlice.reduce((acc, item) => acc + (item.hrv ?? item.hrvRMSSD ?? hrv), 0) / Math.max(1, recentSlice.length);
      const sleepSecs = Number(w.sleepSecs ?? 26400);
      const sleepScore = Number(w.sleepScore ?? Math.min(98, Math.round((sleepSecs / 28800) * 85)));
      let readinessStatus: 'Optimal' | 'Caution' | 'Strain' = 'Optimal';
      if (tsb < -18 || hrv < baseline - 7 || sleepScore < 68) readinessStatus = 'Strain';
      else if (tsb < -10 || hrv < baseline - 3) readinessStatus = 'Caution';

      return {
        date: w.id || w.date || newest,
        ctl,
        atl,
        tsb,
        rampRate: Number((w.rampRate ?? 1.2).toFixed(1)),
        hrvRMSSD: hrv,
        hrvBaseline7d: Math.round(baseline),
        restingHR: Math.round(w.restingHR ?? 48),
        sleepSecs,
        sleepScore,
        weightKg: Number((w.weight ?? 70).toFixed(1)),
        vo2MaxCycling: w.vo2max ?? 60,
        vo2MaxRunning: w.vo2max ?? 58,
        soreness: w.soreness ?? 1,
        readinessStatus,
        dailyLoad: Math.round(w.ctlLoad ?? w.atlLoad ?? 0),
      };
    });

    // Normalize Activities including Outdoor vs. Indoor (Trainer/Treadmill)
    const activities = rawActivities
      .filter((a) => a && a.start_date_local)
      .map((a) => {
        const rawType = String(a.type || 'Ride');
        let sportCategory: 'Cycling' | 'Running' | 'Swimming' | 'Strength' | 'Multisport' = 'Cycling';
        if (/run|trail/i.test(rawType)) sportCategory = 'Running';
        else if (/swim/i.test(rawType)) sportCategory = 'Swimming';
        else if (/weight|strength|workout|crossfit/i.test(rawType)) sportCategory = 'Strength';
        else if (/triathlon|brick|multisport/i.test(rawType)) sportCategory = 'Multisport';

        const isIndoor =
          Boolean(a.trainer) ||
          /virtual|indoor|treadmill|zwift|trainer/i.test(rawType) ||
          /virtual|indoor|treadmill|zwift|trainer/i.test(String(a.name || ''));

        const movingTimeSecs = Number(a.moving_time ?? a.elapsed_time ?? 3600);
        const distanceMeters = Number(a.distance ?? 0);
        const avgPower = a.icu_average_watts ?? a.average_watts ?? undefined;
        const normalizedPower = a.icu_weighted_avg_watts ?? avgPower;
        const avgHr = Number(a.average_heartrate ?? 145);
        const avgPaceSecsPerKm =
          sportCategory === 'Running' && distanceMeters > 0 ? Math.round(movingTimeSecs / (distanceMeters / 1000)) : undefined;

        return {
          id: String(a.id),
          intervalsId: String(a.id),
          stravaId: a.strava_id ? String(a.strava_id) : undefined,
          startDateLocal: String(a.start_date_local),
          name: String(a.name || `${sportCategory} Session`),
          sportCategory,
          environment: isIndoor ? ('INDOOR' as const) : ('OUTDOOR' as const),
          subType: isIndoor
            ? sportCategory === 'Running'
              ? ('Treadmill' as const)
              : ('Smart Trainer' as const)
            : sportCategory === 'Running'
              ? /trail/i.test(rawType)
                ? ('Trail' as const)
                : ('Road' as const)
              : ('Road' as const),
          movingTimeSecs,
          distanceMeters,
          elevationGainMeters: Math.round(Number(a.total_elevation_gain ?? 0)),
          avgPower: avgPower ? Math.round(avgPower) : undefined,
          normalizedPower: normalizedPower ? Math.round(normalizedPower) : undefined,
          intensityFactor: a.icu_intensity ? Number((a.icu_intensity / 100).toFixed(2)) : undefined,
          trainingLoad: Math.round(Number(a.icu_training_load ?? 60)),
          avgHr: Math.round(avgHr),
          maxHr: Math.round(Number(a.max_heartrate ?? avgHr + 20)),
          avgCadence: a.average_cadence ? Math.round(Number(a.average_cadence)) : undefined,
          avgPaceSecsPerKm,
          gapPaceSecsPerKm: avgPaceSecsPerKm,
          aerobicDecouplingPct: Number((a.decoupling ?? 1.8).toFixed(1)),
          efficiencyFactor: Number((a.icu_efficiency_factor ?? 1.72).toFixed(2)),
          firstHalfEf: Number(((a.icu_efficiency_factor ?? 1.72) * 1.01).toFixed(2)),
          secondHalfEf: Number(((a.icu_efficiency_factor ?? 1.72) * 0.99).toFixed(2)),
          zoneSecs: {
            hr: Array.isArray(a.icu_hr_zone_times) ? a.icu_hr_zone_times.slice(0, 7) : [300, 1400, 900, 600, 120, 0, 0],
            power: Array.isArray(a.icu_zone_times)
              ? a.icu_zone_times.slice(0, 7).map((z: any) => (typeof z === 'number' ? z : Number(z?.secs ?? 0)))
              : undefined,
          },
          gearName: a.gear?.name || undefined,
          stravaPrCount: Number(a.pr_count ?? 0),
          segmentEfforts: [],
          sourceBadges: ['Intervals.icu', 'Garmin'] as ('Intervals.icu' | 'Garmin' | 'Strava')[],
        };
      });

    const plannedEvents = rawEvents.map((ev) => ({
      id: String(ev.id || Math.random()),
      date: String(ev.start_date_local || newest).slice(0, 10),
      name: String(ev.name || 'Planned Workout'),
      sportCategory: (/run/i.test(String(ev.type || '')) ? 'Running' : 'Cycling') as 'Running' | 'Cycling',
      environmentPreference: 'FLEXIBLE' as const,
      description: String(ev.description || 'Structured workout synced from Intervals.icu calendar.'),
      plannedLoad: Math.round(Number(ev.icu_training_load ?? 75)),
      plannedDurationSecs: Number(ev.moving_time ?? 3600),
      targetZoneSummary: 'Intervals.icu Scheduled Target',
    }));

    res.json({
      wellnessDays,
      activities,
      plannedEvents,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to sync Intervals.icu data',
    });
  }
});

apiRouter.get('/api/intervals/activities/:id/streams', async (req: Request, res: Response) => {
  try {
    const { apiKey } = getEffectiveIntervalsConfig(req);
    if (!apiKey) {
      res.status(401).json({ error: 'Intervals.icu API Key is not configured.' });
      return;
    }

    const authHeader = 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64');
    const activityId = req.params.id;
    const resp = await fetch(
      `https://intervals.icu/api/v1/activity/${encodeURIComponent(activityId)}/streams?types=time,watts,heartrate,velocity_smooth,cadence,altitude`,
      { headers: { Authorization: authHeader, Accept: 'application/json' } }
    );

    if (!resp.ok) {
      res.status(resp.status).json({ error: `Failed to fetch streams (${resp.status})` });
      return;
    }

    const rawStreams = (await resp.json()) as { type: string; data: number[] }[];
    const streamMap: Record<string, number[]> = {};
    if (Array.isArray(rawStreams)) {
      for (const s of rawStreams) {
        if (s && s.type && Array.isArray(s.data)) {
          // Downsample to ~80 points for fast UI rendering
          const step = Math.max(1, Math.floor(s.data.length / 80));
          streamMap[s.type] = s.data.filter((_, idx) => idx % step === 0);
        }
      }
    }

    res.json({
      time: streamMap.time || [],
      watts: streamMap.watts,
      heartrate: streamMap.heartrate,
      velocitySmooth: streamMap.velocity_smooth,
      cadence: streamMap.cadence,
      altitude: streamMap.altitude,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load activity streams',
    });
  }
});

// ----------------------------------------------------------------------------
// 3. Strava OAuth2 (Popup-Based Flow per oauth-integration Skill) & Segments
// ----------------------------------------------------------------------------
apiRouter.post('/api/strava/credentials', (req: Request, res: Response) => {
  const clientId = (req.body?.clientId || '').trim();
  const clientSecret = (req.body?.clientSecret || '').trim();
  if (!clientId || !clientSecret) {
    res.status(400).json({ error: 'Both Strava Client ID and Client Secret are required.' });
    return;
  }
  runtimeStore.stravaClientId = clientId;
  runtimeStore.stravaClientSecret = clientSecret;
  res.json({ saved: true, clientId });
});

apiRouter.get('/api/strava/auth/url', (req: Request, res: Response) => {
  const { clientId } = getEffectiveStravaClientConfig(req);
  if (!clientId) {
    res.status(400).json({
      error:
        'Strava Client ID is not configured yet. Enter your Strava Client ID & Secret in the Data Sources modal or set STRAVA_CLIENT_ID in your environment variables.',
    });
    return;
  }

  const redirectUri = resolveCallbackUrl(req);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all,profile:read_all',
  });

  const authUrl = `https://www.strava.com/oauth/authorize?${params.toString()}`;
  res.json({ url: authUrl, redirectUri });
});

const stravaCallbackHandler = async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string | undefined;
    if (!code) {
      res.status(400).send('Missing authorization code from Strava.');
      return;
    }

    const { clientId, clientSecret } = getEffectiveStravaClientConfig(req);
    const tokenResp = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      res.status(500).send(`Strava token exchange failed: ${errText}`);
      return;
    }

    const tokenData = (await tokenResp.json()) as {
      access_token: string;
      refresh_token: string;
      expires_at: number;
      athlete?: { firstname?: string; lastname?: string };
    };

    runtimeStore.stravaAccessToken = tokenData.access_token;
    runtimeStore.stravaRefreshToken = tokenData.refresh_token;
    runtimeStore.stravaExpiresAt = tokenData.expires_at;
    runtimeStore.stravaAthleteName =
      [tokenData.athlete?.firstname, tokenData.athlete?.lastname].filter(Boolean).join(' ') || 'Strava Athlete';

    // Popup communication via postMessage per oauth-integration guidelines
    res.send(`
      <!doctype html>
      <html>
        <head><title>Strava Connected</title></head>
        <body style="font-family: sans-serif; background: #0B0F17; color: #F8FAFC; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'strava' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Strava authentication successful. This window will close automatically...</p>
        </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send(`Strava callback error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

apiRouter.get(['/auth/strava/callback', '/auth/strava/callback/'], stravaCallbackHandler);

apiRouter.get('/api/strava/sync', async (req: Request, res: Response) => {
  try {
    if (!runtimeStore.stravaAccessToken) {
      res.status(401).json({ error: 'Strava is not connected via OAuth yet.' });
      return;
    }

    // Refresh token if expired
    const nowSecs = Math.floor(Date.now() / 1000);
    if (runtimeStore.stravaExpiresAt && nowSecs >= runtimeStore.stravaExpiresAt - 60 && runtimeStore.stravaRefreshToken) {
      const { clientId, clientSecret } = getEffectiveStravaClientConfig(req);
      const refreshResp = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: runtimeStore.stravaRefreshToken,
        }),
      });
      if (refreshResp.ok) {
        const refreshed = (await refreshResp.json()) as {
          access_token: string;
          refresh_token: string;
          expires_at: number;
        };
        runtimeStore.stravaAccessToken = refreshed.access_token;
        runtimeStore.stravaRefreshToken = refreshed.refresh_token;
        runtimeStore.stravaExpiresAt = refreshed.expires_at;
      }
    }

    const headers = { Authorization: `Bearer ${runtimeStore.stravaAccessToken}` };
    const [listResp, starredResp] = await Promise.all([
      fetch('https://www.strava.com/api/v3/athlete/activities?per_page=15', { headers }),
      fetch('https://www.strava.com/api/v3/segments/starred?per_page=10', { headers }),
    ]);

    if (!listResp.ok) {
      res.status(listResp.status).json({ error: `Failed to fetch Strava activities (${listResp.status})` });
      return;
    }

    const activitiesList = (await listResp.json()) as Record<string, any>[];
    const starredSegments = starredResp.ok ? ((await starredResp.json()) as Record<string, any>[]) : [];

    // Fetch detailed activity payloads for the top 4 recent activities to extract segment_efforts
    const topIds = activitiesList.slice(0, 4).map((a) => a.id);
    const detailedPayloads = await Promise.all(
      topIds.map(async (id) => {
        const dResp = await fetch(`https://www.strava.com/api/v3/activities/${id}?include_all_efforts=true`, { headers });
        return dResp.ok ? ((await dResp.json()) as Record<string, any>) : null;
      })
    );
    const detailById = new Map<number, Record<string, any>>();
    for (const d of detailedPayloads) {
      if (d && d.id) detailById.set(Number(d.id), d);
    }

    const normalizedStravaActivities = activitiesList.map((a) => {
      const detail = detailById.get(Number(a.id)) || a;
      const sportType = String(a.sport_type || a.type || 'Ride');
      const isRunning = /run|trail/i.test(sportType);
      const isIndoor = Boolean(a.trainer) || /virtual|indoor|treadmill/i.test(sportType);
      const rawEfforts = Array.isArray(detail.segment_efforts) ? detail.segment_efforts : [];

      const segmentEfforts = rawEfforts.slice(0, 8).map((se: Record<string, any>) => ({
        id: String(se.id),
        segmentId: String(se.segment?.id || se.id),
        name: String(se.name || se.segment?.name || 'Segment'),
        sportCategory: isRunning ? ('Running' as const) : ('Cycling' as const),
        distanceMeters: Math.round(Number(se.distance || se.segment?.distance || 0)),
        averageGradePct: Number(se.segment?.average_grade ?? 0),
        elapsedTimeSecs: Number(se.elapsed_time || 0),
        movingTimeSecs: Number(se.moving_time || se.elapsed_time || 0),
        avgWatts: se.average_watts ? Math.round(Number(se.average_watts)) : undefined,
        avgHr: se.average_heartrate ? Math.round(Number(se.average_heartrate)) : undefined,
        prRank: se.pr_rank === 1 || se.pr_rank === 2 || se.pr_rank === 3 ? se.pr_rank : null,
        komRank: typeof se.kom_rank === 'number' ? se.kom_rank : null,
        startDateLocal: String(se.start_date_local || a.start_date_local),
        activityId: String(a.id),
        activityName: String(a.name),
      }));

      return {
        stravaId: String(a.id),
        startDateLocal: String(a.start_date_local),
        name: String(a.name),
        sportCategory: isRunning ? 'Running' : 'Cycling',
        environment: isIndoor ? 'INDOOR' : 'OUTDOOR',
        distanceMeters: Number(a.distance || 0),
        movingTimeSecs: Number(a.moving_time || 0),
        elevationGainMeters: Math.round(Number(a.total_elevation_gain || 0)),
        avgPower: a.average_watts ? Math.round(Number(a.average_watts)) : undefined,
        normalizedPower: a.weighted_average_watts ? Math.round(Number(a.weighted_average_watts)) : undefined,
        avgHr: Math.round(Number(a.average_heartrate || 145)),
        maxHr: Math.round(Number(a.max_heartrate || 170)),
        gearName: detail.gear?.name || undefined,
        stravaPrCount: Number(a.pr_count || 0),
        kudosCount: Number(a.kudos_count || 0),
        segmentEfforts,
      };
    });

    res.json({
      athleteName: runtimeStore.stravaAthleteName,
      activities: normalizedStravaActivities,
      starredSegments: starredSegments.map((s) => ({
        segmentId: String(s.id),
        name: String(s.name),
        sportCategory: /run/i.test(String(s.activity_type || '')) ? 'Running' : 'Cycling',
        distanceMeters: Math.round(Number(s.distance || 0)),
        averageGradePct: Number(s.average_grade || 0),
        location: [s.city, s.state].filter(Boolean).join(', ') || 'Starred Segment',
        prElapsedTimeSecs: Number(s.athlete_pr_effort?.elapsed_time || 0),
      })),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to sync Strava activities and segments',
    });
  }
});

// ----------------------------------------------------------------------------
// 4. Gemini AI Coach — 3-Option Daily Workout Generator & Multi-Turn Health/Fitness Chat
// ----------------------------------------------------------------------------
apiRouter.post('/api/coach/options', async (req: Request, res: Response) => {
  try {
    const {
      sportPreference = 'Cycling',
      environmentPreference = 'INDOOR',
      durationMinutes = 60,
      telemetrySummary,
    } = req.body || {};

    const ai = getGeminiClient();
    const prompt = `
You are an elite endurance sports physiologist and multi-sport coach.
Generate 3 distinct, actionable daily workout options for today based on the athlete's live physiological telemetry and preferences:
- Preferred Sport for Today: ${sportPreference}
- Preferred Environment: ${environmentPreference} (e.g., OUTDOOR road/trail vs INDOOR Smart Trainer/Treadmill)
- Available Duration: ${durationMinutes} minutes
- Athlete Telemetry Context: ${JSON.stringify(telemetrySummary || {})}

Return an array of 3 workout options in JSON matching the schema:
1. Tier "OPTIMAL" (Option A · Optimal Progression — pushes toward race/FTP/pace goals when readiness permits)
2. Tier "MODULATED" (Option B · Modulated Aerobic Durability — steady Zone 2 / controlled tempo advancing annual mileage with low autonomic cost)
3. Tier "RECOVERY" (Option C · Active Parasympathetic Recovery — low-strain Zone 1 spin/jog + mobility)
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction:
          'Always cite exact numbers from the athlete telemetry (HRV in ms vs 7d baseline, Resting HR, Sleep Score, CTL/ATL/TSB, annual mileage progress, and FTP/threshold pace targets). Keep workout intervals crisp and practical.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              tier: { type: Type.STRING },
              tierLabel: { type: Type.STRING },
              title: { type: Type.STRING },
              sportCategory: { type: Type.STRING },
              environment: { type: Type.STRING },
              durationMinutes: { type: Type.INTEGER },
              estimatedLoad: { type: Type.INTEGER },
              summary: { type: Type.STRING },
              physiologicalWhy: { type: Type.STRING },
              structuredSteps: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    duration: { type: Type.STRING },
                    targetZoneOrOutput: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      },
    });

    const jsonText = (response.text ?? '[]').trim();
    const parsed = JSON.parse(jsonText);
    res.json({ options: parsed });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate daily workout options with Gemini.',
    });
  }
});

apiRouter.post('/api/coach/chat', async (req: Request, res: Response) => {
  try {
    const { message, history = [], telemetrySummary } = req.body || {};
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Message is required.' });
      return;
    }

    const ai = getGeminiClient();
    const conversationContext = Array.isArray(history)
      ? history
          .slice(-6)
          .map((m: { role: string; content: string }) => `${m.role.toUpperCase()}: ${m.content}`)
          .join('\n\n')
      : '';

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: `
ATHLETE LIVE TELEMETRY & GOALS SNAPSHOT:
${JSON.stringify(telemetrySummary || {}, null, 2)}

RECENT CONVERSATION:
${conversationContext}

ATHLETE QUESTION:
${message}
`,
      config: {
        systemInstruction:
          'You are AeroPulse AI Coach, an expert exercise physiologist for cycling, running, swimming, and strength. Ground every answer in the athlete’s exact HRV (ms), Resting HR, Sleep Score, CTL/ATL/TSB, Outdoor vs Indoor (Treadmill/Trainer) mileage splits, Strava segment PRs, aerobic decoupling (Pw:Hr / Pa:Hr), and target race goals. Be concise, quantitative, and structured.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: {
              type: Type.STRING,
              description: 'Clear markdown-formatted coaching response citing specific metrics.',
            },
            citedMetrics: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '3 to 4 short metric callouts cited in the answer (e.g., "HRV 71 ms (+3 ms)", "CTL 74.2", "Old La Honda PR 17:48").',
            },
          },
        },
      },
    });

    const rawText = (response.text ?? '{}').trim();
    const parsed = JSON.parse(rawText);
    res.json({
      reply: parsed.reply || 'Here is my analysis based on your physiological profile.',
      citedMetrics: Array.isArray(parsed.citedMetrics) ? parsed.citedMetrics : [],
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate coaching response from Gemini.',
    });
  }
});
