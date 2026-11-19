import { Router, type Request, type Response } from 'express';
import {
  issueOAuthStateToken,
  setOAuthStateCookie,
  getOAuthStateCookieNonce,
  verifyOAuthStateToken,
  clearOAuthStateCookie,
  safeJsonForScript,
  escapeHtml,
  setSessionCookie,
  getVerifiedSessionClaims,
  timingSafeStringEqual,
} from '../securityUtils.ts';
import {
  ensureRequestSessionSid,
  renderThreshOAuthHtml,
  resolvePolarCallbackUrl,
} from '../oauthHelpers.ts';
import {
  bindRequestScopeKey,
  getScopedRuntimeStore,
  requestContext,
  saveSessionCacheAsync,
} from '../sessionContext.ts';
import {
  connectServiceToUser,
  disconnectServiceFromUser,
} from '../authService.ts';
import { isGenericName } from '../physiologyEngine.ts';

export const polarRouter = Router();

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

export function parsePolarDurationSecs(rawDuration: any): number {
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
  exercise: any,
  thresholdPaceSecsPerKm = 245,
  lthr = 165
): Record<string, any> {
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
    rawHrZones.forEach((z: any, i: number) => {
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

  return {
    id: `polar_${exercise.id}`,
    polarId: String(exercise.id),
    startDateLocal: exercise.start_time || exercise.startTime || new Date().toISOString(),
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

polarRouter.get(['/api/polar/auth/url', '/api/auth/polar/url'], (req: Request, res: Response) => {
  const { clientId, clientSecret } = getEffectivePolarClientConfig(req);
  if (!clientId || !clientSecret) {
    res.status(400).json({
      error:
        'Polar OAuth is not configured on this server yet. Please set POLAR_CLIENT_ID and POLAR_CLIENT_SECRET in your environment variables.',
    });
    return;
  }

  const sid = ensureRequestSessionSid(req, res);
  const mode = String(req.query.mode || 'cloud').toLowerCase();
  const flow = String(req.query.flow || 'redirect').toLowerCase() === 'popup' ? 'popup' : 'redirect';
  const clientNonce = String(req.query.state || '').trim();

  const { stateToken, nonce } = issueOAuthStateToken({
    nonce: clientNonce || undefined,
    sid,
    flow,
    mode,
  });
  setOAuthStateCookie(req, res, nonce);

  const redirectUri = resolvePolarCallbackUrl(req);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'accesslink.read_all',
    state: stateToken,
  });

  const authUrl = `https://flow.polar.com/oauth2/authorization?${params.toString()}`;
  res.json({ url: authUrl, redirectUri, clientId, state: stateToken });
});

polarRouter.get(['/api/polar/auth/login', '/api/auth/polar/login'], (req: Request, res: Response) => {
  const { clientId, clientSecret } = getEffectivePolarClientConfig(req);
  if (!clientId || !clientSecret) {
    const msg = encodeURIComponent(
      'Polar OAuth is not configured on this server yet (missing POLAR_CLIENT_ID or POLAR_CLIENT_SECRET).'
    );
    res.redirect(302, `/?auth_error=${msg}`);
    return;
  }
  const sid = ensureRequestSessionSid(req, res);
  const flow = String(req.query.flow || 'redirect').toLowerCase() === 'popup' ? 'popup' : 'redirect';
  const { stateToken, nonce } = issueOAuthStateToken({ sid, flow, mode: 'cloud' });
  setOAuthStateCookie(req, res, nonce);

  const redirectUri = resolvePolarCallbackUrl(req);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'accesslink.read_all',
    state: stateToken,
  });
  res.redirect(302, `https://flow.polar.com/oauth2/authorization?${params.toString()}`);
});

export const polarCallbackHandler = async (req: Request, res: Response): Promise<void> => {
  const code = String(req.query.code || '').trim();
  const error = String(req.query.error || '').trim();
  const stateToken = String(req.query.state || '').trim();

  const cookieNonce = getOAuthStateCookieNonce(req);
  const verifiedState = verifyOAuthStateToken(stateToken);
  clearOAuthStateCookie(res);

  if (error) {
    const errMsg = error === 'access_denied' ? 'Access was denied by the user on Polar.' : error;
    const errJson = safeJsonForScript({
      type: 'OAUTH_AUTH_ERROR',
      provider: 'polar',
      error: `Polar connection failed: ${errMsg}`,
    });
    res.status(400).type('html').send(
      renderThreshOAuthHtml({
        title: 'Polar Connection Error',
        heading: 'Polar Connection Could Not Complete',
        accentColor: '#EF4444',
        body: escapeHtml(errMsg),
        ctaLabel: 'Return to THRESH',
        ctaHref: '/#fitness?openDataSources=1',
        ctaOnClick:
          "if (window.opener || window.name === 'aeropulse_oauth_popup') { try { window.close(); } catch (e) {} return false; }",
        scriptBody: `(function() {
          var payload = ${errJson};
          try {
            if (window.opener && window.opener !== window) {
              window.opener.postMessage(payload, window.location.origin);
            }
          } catch (e) {}
          try {
            var bc = new BroadcastChannel('aeropulse_oauth');
            bc.postMessage(payload);
          } catch (e) {}
        })();`,
      })
    );
    return;
  }

  if (!code) {
    res.status(400).type('html').send(
      renderThreshOAuthHtml({
        title: 'Missing Authorization Code',
        heading: 'Polar Authorization Code Missing',
        accentColor: '#EF4444',
        body: 'No authorization code was returned by Polar.',
        ctaLabel: 'Return to THRESH',
        ctaHref: '/#fitness?openDataSources=1',
      })
    );
    return;
  }

  if (!verifiedState || !cookieNonce || !timingSafeStringEqual(cookieNonce, verifiedState.nonce)) {
    res.status(400).type('html').send(
      renderThreshOAuthHtml({
        title: 'Invalid OAuth State',
        heading: 'Security Verification Failed',
        accentColor: '#EF4444',
        body: !verifiedState
          ? 'OAuth state token was invalid or expired. Please re-initiate Polar connection.'
          : 'Browser OAuth verification cookie was missing or did not match. Please re-initiate Polar connection.',
        ctaLabel: 'Return to THRESH',
        ctaHref: '/#fitness?openDataSources=1',
      })
    );
    return;
  }

  try {
    const { clientId, clientSecret } = getEffectivePolarClientConfig(req);
    if (!clientId || !clientSecret) {
      throw new Error(
        'Polar OAuth client credentials (POLAR_CLIENT_ID / POLAR_CLIENT_SECRET) are not configured.'
      );
    }

    const redirectUri = resolvePolarCallbackUrl(req);
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
      const profileResp = await fetch(`https://polarremote.com/v2/users/${encodeURIComponent(athleteId)}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (profileResp.ok) {
        const profData = (await profileResp.json()) as { 'first-name'?: string; 'last-name'?: string };
        const fullName = [profData['first-name'], profData['last-name']].filter(Boolean).join(' ').trim();
        if (fullName) athleteName = fullName;
      }
    } catch {
      // non-fatal
    }

    const sid = verifiedState.sid || ensureRequestSessionSid(req, res);
    bindRequestScopeKey(req, sid);
    const store = getScopedRuntimeStore(req);
    store.polarAccessToken = accessToken;
    store.polarUserId = athleteId;
    store.polarAthleteName = athleteName;
    if (tokenData.expires_in) {
      store.polarExpiresAt = Math.floor(Date.now() / 1000) + tokenData.expires_in;
    }

    const callerClaims = getVerifiedSessionClaims(req);
    if (callerClaims && callerClaims.sub?.startsWith('usr_')) {
      await connectServiceToUser(callerClaims.sub, 'polar', athleteId, athleteName);
    }

    const sessionToken = setSessionCookie(req, res, athleteName, sid, 'verified');
    await saveSessionCacheAsync(req, res, sid);

    const oauthPayloadJson = safeJsonForScript({
      type: 'OAUTH_AUTH_SUCCESS',
      provider: 'polar',
      athleteId,
      athleteName,
      sessionToken,
      returnUrl: '/#fitness?openDataSources=1',
    });

    res.type('html').send(
      renderThreshOAuthHtml({
        title: 'Polar Connected · THRESH',
        heading: `Polar Connected${athleteName && !isGenericName(athleteName) ? ` · ${escapeHtml(athleteName)}` : ''}`,
        accentColor: '#EF4444',
        body: 'Your Polar AccessLink account is now linked via OAuth 2.0. Exercises, heart rate zones, and rTSS will sync automatically with smart deduplication.',
        ctaLabel: 'Continue to THRESH',
        ctaHref: '/#fitness?openDataSources=1',
        scriptBody: `(function() {
          var payload = ${oauthPayloadJson};
          try {
            if (payload.sessionToken) {
              localStorage.setItem('aeropulse_session_token', payload.sessionToken);
            }
            if (payload.athleteId) {
              localStorage.setItem('aeropulse_polar_athlete_id', String(payload.athleteId));
            }
            if (payload.athleteName) {
              localStorage.setItem('aeropulse_polar_athlete_name', payload.athleteName);
            }
            localStorage.setItem('aeropulse_polar_connected', '1');
            localStorage.setItem('aeropulse_oauth_just_connected', '1');
          } catch (e) {}
          var hasOpener = false;
          try {
            if (window.opener && window.opener !== window) {
              hasOpener = true;
              window.opener.postMessage(payload, window.location.origin);
            }
          } catch (e) {}
          try {
            var bc = new BroadcastChannel('aeropulse_oauth');
            bc.postMessage(payload);
          } catch (e) {}
          var isPopupWindow = hasOpener || window.name === 'aeropulse_oauth_popup';
          if (isPopupWindow) {
            setTimeout(function() {
              try { window.close(); } catch (e) {}
            }, 300);
          } else {
            window.location.replace(payload.returnUrl || '/#fitness?openDataSources=1');
          }
        })();`,
      })
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    const errJson = safeJsonForScript({
      type: 'OAUTH_AUTH_ERROR',
      provider: 'polar',
      error: `Polar connection failed: ${errMsg}`,
    });
    res.status(500).type('html').send(
      renderThreshOAuthHtml({
        title: 'Polar Connection Error',
        heading: 'Polar Connection Failed',
        accentColor: '#FB7185',
        body: escapeHtml(errMsg),
        ctaLabel: 'Return to THRESH',
        ctaHref: '/#fitness?openDataSources=1',
        ctaOnClick:
          "if (window.opener || window.name === 'aeropulse_oauth_popup') { try { window.close(); } catch (e) {} return false; }",
        scriptBody: `(function() {
          var payload = ${errJson};
          try {
            if (window.opener && window.opener !== window) {
              window.opener.postMessage(payload, window.location.origin);
            }
          } catch (e) {}
          try {
            var bc = new BroadcastChannel('aeropulse_oauth');
            bc.postMessage(payload);
          } catch (e) {}
        })();`,
      })
    );
  }
};

polarRouter.get(
  [
    '/auth/polar/callback',
    '/auth/polar/callback/',
    '/api/polar/callback',
    '/api/polar/callback/',
    '/api/auth/polar/callback',
    '/api/auth/polar/callback/',
  ],
  polarCallbackHandler
);

polarRouter.post('/api/polar/disconnect', async (req: Request, res: Response) => {
  const store = getScopedRuntimeStore(req);
  store.polarAccessToken = '';
  store.polarUserId = '';
  store.polarAthleteName = '';
  store.polarExpiresAt = 0;
  store.polarScope = '';

  const callerClaims = getVerifiedSessionClaims(req);
  if (callerClaims && callerClaims.sub?.startsWith('usr_')) {
    await disconnectServiceFromUser(callerClaims.sub, 'polar');
  }

  await saveSessionCacheAsync(req, res);
  res.json({ connected: false });
});

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

    const data = await resp.json();
    const rawExercises = Array.isArray(data) ? data : Array.isArray(data?.exercises) ? data.exercises : [];
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

    const data = await resp.json();
    const rawExercises = Array.isArray(data) ? data : Array.isArray(data?.exercises) ? data.exercises : [];

    const store = getScopedRuntimeStore(req);
    const athleteThresholdPace = 245;
    const athleteLthr = store.athleteLthr || 165;

    const activities = rawExercises.map((ex: any) =>
      normalizePolarExercise(ex, athleteThresholdPace, athleteLthr)
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
