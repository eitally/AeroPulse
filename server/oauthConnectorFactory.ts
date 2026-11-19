import { type Request, type Response, type Router } from 'express';
import {
  clearOAuthStateCookie,
  escapeHtml,
  generatePkcePair,
  getOAuthStateCookieNonce,
  getVerifiedSessionClaims,
  issueOAuthStateToken,
  safeJsonForScript,
  setOAuthStateCookie,
  setSessionCookie,
  timingSafeStringEqual,
  verifyOAuthStateToken,
} from './securityUtils.ts';
import { ensureRequestSessionSid, renderThreshOAuthHtml } from './oauthHelpers.ts';
import {
  bindRequestScopeKey,
  getScopedRuntimeStore,
  saveSessionCacheAsync,
} from './sessionContext.ts';
import { connectServiceToUser, disconnectServiceFromUser } from './authService.ts';
import { isGenericName } from './physiologyEngine.ts';

export type OAuthConnectorRuntimeStore = ReturnType<typeof getScopedRuntimeStore>;

export interface OAuthCodeExchangeContext {
  req: Request;
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  codeVerifier?: string;
}

export interface OAuthCodeExchangeResult {
  athleteId: string;
  athleteName: string;
  scope?: string;
  applyToStore: (store: OAuthConnectorRuntimeStore) => void;
}

export interface OAuthConnectorConfig {
  provider: 'polar' | 'wahoo';
  displayName: string;
  accentColor: string;
  authorizeUrl: string;
  scope: string;
  envVarNames: [string, string];
  usePkce?: boolean;
  successBody: string;
  getClientConfig: (req?: Request) => { clientId: string; clientSecret: string };
  resolveCallbackUrl: (req: Request) => string;
  exchangeCode: (ctx: OAuthCodeExchangeContext) => Promise<OAuthCodeExchangeResult>;
  clearStoreTokens: (store: OAuthConnectorRuntimeStore) => void;
}

function buildPopupRelayScript(payloadJson: string): string {
  return `(function() {
          var payload = ${payloadJson};
          try {
            if (window.opener && window.opener !== window) {
              window.opener.postMessage(payload, window.location.origin);
            }
          } catch (e) {}
          try {
            var bc = new BroadcastChannel('aeropulse_oauth');
            bc.postMessage(payload);
          } catch (e) {}
        })();`;
}

const POPUP_CLOSE_ONCLICK =
  "if (window.opener || window.name === 'aeropulse_oauth_popup') { try { window.close(); } catch (e) {} return false; }";

/**
 * Registers standardized OAuth 2.0 (+ optional PKCE) authorization URL, redirect login,
 * multi-alias callback handler, and disconnect endpoints on a telemetry provider router.
 */
export function registerOAuthConnectorRoutes(
  router: Router,
  config: OAuthConnectorConfig
): { callbackHandler: (req: Request, res: Response) => Promise<void> } {
  const {
    provider,
    displayName,
    accentColor,
    authorizeUrl,
    scope,
    envVarNames,
    usePkce = false,
    successBody,
    getClientConfig,
    resolveCallbackUrl,
    exchangeCode,
    clearStoreTokens,
  } = config;

  const returnHref = '/#fitness?openDataSources=1';

  const buildAuthorizeParams = (
    req: Request,
    res: Response,
    clientId: string,
    clientNonce?: string
  ) => {
    const sid = ensureRequestSessionSid(req, res);
    const mode = String(req.query.mode || 'cloud').toLowerCase();
    const flow = String(req.query.flow || 'redirect').toLowerCase() === 'popup' ? 'popup' : 'redirect';
    const pkce = usePkce ? generatePkcePair() : null;
    const { stateToken, nonce } = issueOAuthStateToken({
      ...(clientNonce ? { nonce: clientNonce } : {}),
      sid,
      flow,
      mode,
      ...(pkce ? { codeVerifier: pkce.codeVerifier } : {}),
    });
    setOAuthStateCookie(req, res, nonce);

    const redirectUri = resolveCallbackUrl(req);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      state: stateToken,
      ...(pkce
        ? {
            code_challenge: pkce.codeChallenge,
            code_challenge_method: 'S256',
          }
        : {}),
    });

    return {
      authUrl: `${authorizeUrl}?${params.toString()}`,
      redirectUri,
      stateToken,
    };
  };

  router.get([`/api/${provider}/auth/url`, `/api/auth/${provider}/url`], (req: Request, res: Response) => {
    const { clientId, clientSecret } = getClientConfig(req);
    if (!clientId || !clientSecret) {
      res.status(400).json({
        error: `${displayName} OAuth is not configured on this server yet. Please set ${envVarNames[0]} and ${envVarNames[1]} in your environment variables.`,
      });
      return;
    }

    const clientNonce = String(req.query.state || '').trim();
    const { authUrl, redirectUri, stateToken } = buildAuthorizeParams(req, res, clientId, clientNonce);
    res.json({ url: authUrl, redirectUri, clientId, state: stateToken });
  });

  router.get([`/api/${provider}/auth/login`, `/api/auth/${provider}/login`], (req: Request, res: Response) => {
    const { clientId, clientSecret } = getClientConfig(req);
    if (!clientId || !clientSecret) {
      const msg = encodeURIComponent(
        `${displayName} OAuth is not configured on this server yet (missing ${envVarNames[0]} or ${envVarNames[1]}).`
      );
      res.redirect(302, `/?auth_error=${msg}`);
      return;
    }

    const { authUrl } = buildAuthorizeParams(req, res, clientId);
    res.redirect(302, authUrl);
  });

  const callbackHandler = async (req: Request, res: Response): Promise<void> => {
    const code = String(req.query.code || '').trim();
    const error = String(req.query.error || '').trim();
    const stateToken = String(req.query.state || '').trim();

    const cookieNonce = getOAuthStateCookieNonce(req);
    const verifiedState = verifyOAuthStateToken(stateToken);
    clearOAuthStateCookie(res);

    if (error) {
      const errMsg = error === 'access_denied' ? `Access was denied by the user on ${displayName}.` : error;
      const errJson = safeJsonForScript({
        type: 'OAUTH_AUTH_ERROR',
        provider,
        error: `${displayName} connection failed: ${errMsg}`,
      });
      res.status(400).type('html').send(
        renderThreshOAuthHtml({
          title: `${displayName} Connection Error`,
          heading: `${displayName} Connection Could Not Complete`,
          accentColor,
          body: escapeHtml(errMsg),
          ctaLabel: 'Return to THRESH',
          ctaHref: returnHref,
          ctaOnClick: POPUP_CLOSE_ONCLICK,
          scriptBody: buildPopupRelayScript(errJson),
        })
      );
      return;
    }

    if (!code) {
      res.status(400).type('html').send(
        renderThreshOAuthHtml({
          title: 'Missing Authorization Code',
          heading: `${displayName} Authorization Code Missing`,
          accentColor,
          body: `No authorization code was returned by ${displayName}.`,
          ctaLabel: 'Return to THRESH',
          ctaHref: returnHref,
        })
      );
      return;
    }

    if (!verifiedState || !cookieNonce || !timingSafeStringEqual(cookieNonce, verifiedState.nonce)) {
      res.status(400).type('html').send(
        renderThreshOAuthHtml({
          title: 'Invalid OAuth State',
          heading: 'Security Verification Failed',
          accentColor,
          body: !verifiedState
            ? `OAuth state token was invalid or expired. Please re-initiate ${displayName} connection.`
            : `Browser OAuth verification cookie was missing or did not match. Please re-initiate ${displayName} connection.`,
          ctaLabel: 'Return to THRESH',
          ctaHref: returnHref,
        })
      );
      return;
    }

    try {
      const { clientId, clientSecret } = getClientConfig(req);
      if (!clientId || !clientSecret) {
        throw new Error(
          `${displayName} OAuth client credentials (${envVarNames[0]} / ${envVarNames[1]}) are not configured.`
        );
      }

      const redirectUri = resolveCallbackUrl(req);
      const exchanged = await exchangeCode({
        req,
        code,
        redirectUri,
        clientId,
        clientSecret,
        codeVerifier: verifiedState.codeVerifier,
      });

      const sid = verifiedState.sid || ensureRequestSessionSid(req, res);
      bindRequestScopeKey(req, sid);
      const store = getScopedRuntimeStore(req);
      exchanged.applyToStore(store);

      const callerClaims = getVerifiedSessionClaims(req);
      if (callerClaims && callerClaims.sub?.startsWith('usr_')) {
        await connectServiceToUser(
          callerClaims.sub,
          provider,
          exchanged.athleteId,
          exchanged.athleteName
        );
      }

      const sessionToken = setSessionCookie(req, res, exchanged.athleteName, sid, 'verified');
      await saveSessionCacheAsync(req, res, sid);

      const oauthPayloadJson = safeJsonForScript({
        type: 'OAUTH_AUTH_SUCCESS',
        provider,
        athleteId: exchanged.athleteId,
        athleteName: exchanged.athleteName,
        sessionToken,
        ...(exchanged.scope !== undefined ? { scope: exchanged.scope } : {}),
        returnUrl: returnHref,
      });

      res.type('html').send(
        renderThreshOAuthHtml({
          title: `${displayName} Connected · THRESH`,
          heading: `${displayName} Connected${exchanged.athleteName && !isGenericName(exchanged.athleteName) ? ` · ${escapeHtml(exchanged.athleteName)}` : ''}`,
          accentColor,
          body: successBody,
          ctaLabel: 'Continue to THRESH',
          ctaHref: returnHref,
          scriptBody: `(function() {
          var payload = ${oauthPayloadJson};
          try {
            if (payload.sessionToken) {
              localStorage.setItem('aeropulse_session_token', payload.sessionToken);
            }
            if (payload.athleteId) {
              localStorage.setItem('aeropulse_${provider}_athlete_id', String(payload.athleteId));
            }
            if (payload.athleteName) {
              localStorage.setItem('aeropulse_${provider}_athlete_name', payload.athleteName);
            }
            localStorage.setItem('aeropulse_${provider}_connected', '1');
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
            window.location.replace(payload.returnUrl || '${returnHref}');
          }
        })();`,
        })
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      const errJson = safeJsonForScript({
        type: 'OAUTH_AUTH_ERROR',
        provider,
        error: `${displayName} connection failed: ${errMsg}`,
      });
      res.status(500).type('html').send(
        renderThreshOAuthHtml({
          title: `${displayName} Connection Error`,
          heading: `${displayName} Connection Failed`,
          accentColor: '#FB7185',
          body: escapeHtml(errMsg),
          ctaLabel: 'Return to THRESH',
          ctaHref: returnHref,
          ctaOnClick: POPUP_CLOSE_ONCLICK,
          scriptBody: buildPopupRelayScript(errJson),
        })
      );
    }
  };

  router.get(
    [
      `/auth/${provider}/callback`,
      `/auth/${provider}/callback/`,
      `/api/${provider}/callback`,
      `/api/${provider}/callback/`,
      `/api/auth/${provider}/callback`,
      `/api/auth/${provider}/callback/`,
    ],
    callbackHandler
  );

  router.post(`/api/${provider}/disconnect`, async (req: Request, res: Response) => {
    const store = getScopedRuntimeStore(req);
    clearStoreTokens(store);

    const callerClaims = getVerifiedSessionClaims(req);
    if (callerClaims && callerClaims.sub?.startsWith('usr_')) {
      await disconnectServiceFromUser(callerClaims.sub, provider);
    }

    await saveSessionCacheAsync(req, res);
    res.json({ connected: false });
  });

  return { callbackHandler };
}
