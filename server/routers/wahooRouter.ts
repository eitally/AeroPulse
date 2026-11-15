import { Router, type Request, type Response } from 'express';
import {
  generatePkcePair,
  issueOAuthStateToken,
  setOAuthStateCookie,
  verifyOAuthStateToken,
  clearOAuthStateCookie,
  safeJsonForScript,
  escapeHtml,
  setSessionCookie,
  getVerifiedSessionClaims,
} from '../securityUtils.ts';
import {
  ensureRequestSessionSid,
  renderThreshOAuthHtml,
  resolveWahooCallbackUrl,
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

export const wahooRouter = Router();

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
        if (refreshed.expires_in)
          store.wahooExpiresAt = Math.floor(Date.now() / 1000) + refreshed.expires_in;
        if (activeReq) {
          activeReq.headers['x-wahoo-access-token'] = refreshed.access_token;
        }
        return refreshed.access_token;
      }
    } catch {
      // non-fatal
    }
  }

  return accessToken;
}

wahooRouter.get(['/api/wahoo/auth/url', '/api/auth/wahoo/url'], (req: Request, res: Response) => {
  const { clientId, clientSecret } = getEffectiveWahooClientConfig(req);
  if (!clientId || !clientSecret) {
    res.status(400).json({
      error:
        'Wahoo OAuth is not configured on this server yet. Please set WAHOO_CLIENT_ID and WAHOO_CLIENT_SECRET in your environment variables.',
    });
    return;
  }

  const sid = ensureRequestSessionSid(req, res);
  const mode = String(req.query.mode || 'cloud').toLowerCase();
  const flow = String(req.query.flow || 'redirect').toLowerCase() === 'popup' ? 'popup' : 'redirect';
  const clientNonce = String(req.query.state || '').trim();

  const { codeVerifier, codeChallenge } = generatePkcePair();
  const { stateToken, nonce } = issueOAuthStateToken({
    nonce: clientNonce || undefined,
    sid,
    flow,
    mode,
    codeVerifier,
  });
  setOAuthStateCookie(req, res, nonce);

  const redirectUri = resolveWahooCallbackUrl(req);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'user_read workouts_read',
    state: stateToken,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const authUrl = `https://api.wahooligan.com/oauth/authorize?${params.toString()}`;
  res.json({ url: authUrl, redirectUri, clientId, state: stateToken });
});

wahooRouter.get(['/api/wahoo/auth/login', '/api/auth/wahoo/login'], (req: Request, res: Response) => {
  const { clientId, clientSecret } = getEffectiveWahooClientConfig(req);
  if (!clientId || !clientSecret) {
    const msg = encodeURIComponent(
      'Wahoo OAuth is not configured on this server yet (missing WAHOO_CLIENT_ID or WAHOO_CLIENT_SECRET).'
    );
    res.redirect(302, `/?auth_error=${msg}`);
    return;
  }
  const sid = ensureRequestSessionSid(req, res);
  const flow = String(req.query.flow || 'redirect').toLowerCase() === 'popup' ? 'popup' : 'redirect';
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const { stateToken, nonce } = issueOAuthStateToken({ sid, flow, mode: 'cloud', codeVerifier });
  setOAuthStateCookie(req, res, nonce);

  const redirectUri = resolveWahooCallbackUrl(req);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'user_read workouts_read',
    state: stateToken,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  res.redirect(302, `https://api.wahooligan.com/oauth/authorize?${params.toString()}`);
});

export const wahooCallbackHandler = async (req: Request, res: Response): Promise<void> => {
  const code = String(req.query.code || '').trim();
  const error = String(req.query.error || '').trim();
  const stateToken = String(req.query.state || '').trim();

  const verifiedState = verifyOAuthStateToken(stateToken);
  clearOAuthStateCookie(res);

  if (error) {
    const errMsg = error === 'access_denied' ? 'Access was denied by the user on Wahoo.' : error;
    const errJson = safeJsonForScript({
      type: 'OAUTH_AUTH_ERROR',
      provider: 'wahoo',
      error: `Wahoo connection failed: ${errMsg}`,
    });
    res.status(400).type('html').send(
      renderThreshOAuthHtml({
        title: 'Wahoo Connection Error',
        heading: 'Wahoo Connection Could Not Complete',
        accentColor: '#0EA5E9',
        body: escapeHtml(errMsg),
        ctaLabel: 'Return to THRESH',
        ctaHref: '/?tab=settings',
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
        heading: 'Wahoo Authorization Code Missing',
        accentColor: '#0EA5E9',
        body: 'No authorization code was returned by Wahoo.',
        ctaLabel: 'Return to THRESH',
        ctaHref: '/?tab=settings',
      })
    );
    return;
  }

  if (!verifiedState) {
    res.status(400).type('html').send(
      renderThreshOAuthHtml({
        title: 'Invalid OAuth State',
        heading: 'Security Verification Failed',
        accentColor: '#0EA5E9',
        body: 'OAuth state token was invalid or expired. Please re-initiate Wahoo connection.',
        ctaLabel: 'Return to THRESH',
        ctaHref: '/?tab=settings',
      })
    );
    return;
  }

  try {
    const { clientId, clientSecret } = getEffectiveWahooClientConfig(req);
    if (!clientId || !clientSecret) {
      throw new Error(
        'Wahoo OAuth client credentials (WAHOO_CLIENT_ID / WAHOO_CLIENT_SECRET) are not configured.'
      );
    }

    const redirectUri = resolveWahooCallbackUrl(req);
    const bodyParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    if (verifiedState.codeVerifier) {
      bodyParams.set('code_verifier', verifiedState.codeVerifier);
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

    const sid = verifiedState.sid || ensureRequestSessionSid(req, res);
    bindRequestScopeKey(req, sid);
    const store = getScopedRuntimeStore(req);
    store.wahooAccessToken = accessToken;
    if (tokenData.refresh_token) store.wahooRefreshToken = tokenData.refresh_token;
    if (tokenData.expires_in) {
      store.wahooExpiresAt = Math.floor(Date.now() / 1000) + tokenData.expires_in;
    }
    store.wahooScope = tokenData.scope || 'user_read workouts_read';
    store.wahooUserId = athleteId;
    store.wahooAthleteName = athleteName;

    const callerClaims = getVerifiedSessionClaims(req);
    if (callerClaims && callerClaims.sub?.startsWith('usr_')) {
      await connectServiceToUser(callerClaims.sub, 'wahoo', athleteId, athleteName);
    }

    const sessionToken = setSessionCookie(req, res, athleteName, sid);
    await saveSessionCacheAsync(req, res, sid);

    const oauthPayloadJson = safeJsonForScript({
      type: 'OAUTH_AUTH_SUCCESS',
      provider: 'wahoo',
      athleteId,
      athleteName,
      sessionToken,
      scope: tokenData.scope,
      returnUrl: '/?tab=settings',
    });

    res.type('html').send(
      renderThreshOAuthHtml({
        title: 'Wahoo Connected · THRESH',
        heading: `Wahoo Connected${athleteName && !isGenericName(athleteName) ? ` · ${escapeHtml(athleteName)}` : ''}`,
        accentColor: '#0EA5E9',
        body: 'Your Wahoo Cloud account is now linked via OAuth 2.0 / PKCE. ELEMNT rides, workouts, and FIT files will sync automatically with smart deduplication.',
        ctaLabel: 'Continue to THRESH',
        ctaHref: '/?tab=settings',
        scriptBody: `(function() {
          var payload = ${oauthPayloadJson};
          try {
            if (payload.sessionToken) {
              localStorage.setItem('aeropulse_session_token', payload.sessionToken);
            }
            if (payload.athleteId) {
              localStorage.setItem('aeropulse_wahoo_athlete_id', String(payload.athleteId));
            }
            if (payload.athleteName) {
              localStorage.setItem('aeropulse_wahoo_athlete_name', payload.athleteName);
            }
            localStorage.setItem('aeropulse_wahoo_connected', '1');
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
            window.location.replace(payload.returnUrl || '/?tab=settings');
          }
        })();`,
      })
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    const errJson = safeJsonForScript({
      type: 'OAUTH_AUTH_ERROR',
      provider: 'wahoo',
      error: `Wahoo connection failed: ${errMsg}`,
    });
    res.status(500).type('html').send(
      renderThreshOAuthHtml({
        title: 'Wahoo Connection Error',
        heading: 'Wahoo Connection Failed',
        accentColor: '#FB7185',
        body: escapeHtml(errMsg),
        ctaLabel: 'Return to THRESH',
        ctaHref: '/?tab=settings',
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

wahooRouter.get(
  [
    '/auth/wahoo/callback',
    '/auth/wahoo/callback/',
    '/api/wahoo/callback',
    '/api/wahoo/callback/',
    '/api/auth/wahoo/callback',
    '/api/auth/wahoo/callback/',
  ],
  wahooCallbackHandler
);

wahooRouter.post('/api/wahoo/disconnect', async (req: Request, res: Response) => {
  const store = getScopedRuntimeStore(req);
  store.wahooAccessToken = '';
  store.wahooRefreshToken = '';
  store.wahooExpiresAt = 0;
  store.wahooScope = '';
  store.wahooUserId = '';
  store.wahooAthleteName = '';

  const callerClaims = getVerifiedSessionClaims(req);
  if (callerClaims && callerClaims.sub?.startsWith('usr_')) {
    await disconnectServiceFromUser(callerClaims.sub, 'wahoo');
  }

  await saveSessionCacheAsync(req, res);
  res.json({ connected: false });
});

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

    const data = await resp.json();
    const rawWorkouts = Array.isArray(data) ? data : Array.isArray(data?.workouts) ? data.workouts : [];
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

    const data = await resp.json();
    const rawWorkouts = Array.isArray(data) ? data : Array.isArray(data?.workouts) ? data.workouts : [];

    const activities = rawWorkouts.map((w: any) => {
      const summary = w.workout_summary || {};
      const sport = w.workout_type_id === 2 ? 'Running' : 'Cycling';
      const duration = Number(summary.duration_active_seconds || summary.duration_seconds || 0);
      const isIndoor = /kickr|indoor|trainer/i.test(w.name || '');
      return {
        id: `wahoo_${w.id}`,
        wahooId: String(w.id),
        startDateLocal: w.starts || new Date().toISOString(),
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
