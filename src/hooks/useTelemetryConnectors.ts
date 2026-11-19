import React, { useCallback, useEffect, useRef } from 'react';
import type {
  AthleteProfile,
  ConnectionStatus,
  DistanceUnit,
  MapTileProvider,
  StravaSyncPolicy,
  StravaSyncWindow,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import type { StravaOAuthJoinContext } from '../components/StravaAuthGate';
import {
  buildCompleteAthleteProfile,
  clearPersistedTelemetrySnapshot,
  getSavedIntervalsHeaders,
  hasPendingTeamJoinInBrowser,
  isGenericAthleteName,
  loadStravaSyncPolicyFromStorage,
  safeParseResponseJson,
  sanitizeHttpHeaderValue,
  saveRotatedStravaTokensToStorage,
  saveStravaSyncPolicyToStorage,
} from '../utils/telemetryStorage';

interface UseTelemetryConnectorsParams {
  setSyncError: React.Dispatch<React.SetStateAction<string | null>>;
  fetchServerConfigStatus: () => Promise<any>;
  syncLiveTelemetry: (fullHistory?: boolean, explicitWindow?: StravaSyncWindow) => Promise<void>;
  reconcileStoreOwnerAthleteId: (incomingAthleteId?: string | number | null) => Promise<void>;
  athleteProfileRef: React.MutableRefObject<AthleteProfile>;
  setAthleteProfile: React.Dispatch<React.SetStateAction<AthleteProfile>>;
  wellnessDaysRef: React.MutableRefObject<UnifiedWellnessDay[]>;
  activitiesRef: React.MutableRefObject<UnifiedActivity[]>;
  setConnectionStatus: React.Dispatch<React.SetStateAction<ConnectionStatus>>;
  setDistanceUnit: (unit: DistanceUnit) => void;
  setIsSessionLoggedOut: (val: boolean) => void;
  isSessionLoggedOut: boolean;
  hasEnteredWorkspaceRef: React.MutableRefObject<boolean>;
  setHasEnteredWorkspace: (val: boolean) => void;
  setIdbSavedAt: (val: string | null) => void;
}

export function useTelemetryConnectors({
  setSyncError,
  fetchServerConfigStatus,
  syncLiveTelemetry,
  reconcileStoreOwnerAthleteId,
  athleteProfileRef,
  setAthleteProfile,
  wellnessDaysRef,
  activitiesRef,
  setConnectionStatus,
  setDistanceUnit,
  setIsSessionLoggedOut,
  isSessionLoggedOut,
  hasEnteredWorkspaceRef,
  setHasEnteredWorkspace,
  setIdbSavedAt,
}: UseTelemetryConnectorsParams) {
  const handledOAuthTokensRef = useRef<Set<string>>(new Set());
  const oauthErrorReceivedRef = useRef<boolean>(false);
  const oauthCompletedRef = useRef<boolean>(false);
  const activePollTimerRef = useRef<number | null>(null);

  const stopStravaOAuthPoll = useCallback(() => {
    if (activePollTimerRef.current !== null) {
      window.clearInterval(activePollTimerRef.current);
      activePollTimerRef.current = null;
    }
  }, []);

  const completeStravaAuthHandshake = useCallback(
    async (opts: {
      tokens?: any;
      sessionToken?: string;
      hasExistingSyncPolicy?: boolean;
    }) => {
      const { tokens, sessionToken, hasExistingSyncPolicy } = opts;
      oauthCompletedRef.current = true;
      stopStravaOAuthPoll();
      const dedupeKey = String(
        tokens?.accessToken || tokens?.refreshToken || sessionToken || ''
      ).trim();
      if (dedupeKey) {
        if (handledOAuthTokensRef.current.has(dedupeKey)) return;
        handledOAuthTokensRef.current.add(dedupeKey);
      }

      if (tokens?.athleteId) {
        await reconcileStoreOwnerAthleteId(tokens.athleteId);
      }
      try {
        localStorage.removeItem('aeropulse_logged_out');
        if (sessionToken) {
          localStorage.setItem('aeropulse_session_token', String(sessionToken));
        }
      } catch {
        // ignore
      }
      if (tokens) {
        saveRotatedStravaTokensToStorage(tokens);
        const cleanName =
          tokens.athleteName && !isGenericAthleteName(tokens.athleteName)
            ? String(tokens.athleteName).trim()
            : undefined;
        const weightKg = Number(tokens.weightKg ?? tokens.athleteWeightKg ?? 0);
        const ftp = Number(tokens.ftp ?? tokens.athleteFtp ?? 0);
        const measurementPref: DistanceUnit | undefined =
          tokens.measurementPreference === 'km' || tokens.measurementPreference === 'meters'
            ? 'km'
            : tokens.measurementPreference === 'mi' || tokens.measurementPreference === 'feet'
              ? 'mi'
              : undefined;
        if (measurementPref) {
          try {
            if (!localStorage.getItem('thresh_distance_unit_user_set')) {
              setDistanceUnit(measurementPref);
            }
          } catch {
            setDistanceUnit(measurementPref);
          }
        }
        if (cleanName || weightKg > 30 || ftp > 50) {
          const updatedProf = buildCompleteAthleteProfile(
            {
              ...athleteProfileRef.current,
              ...(cleanName ? { name: cleanName } : {}),
              ...(weightKg > 30 ? { weightKg } : {}),
              ...(ftp > 50 ? { ftp, indoorFtp: ftp } : {}),
            },
            wellnessDaysRef.current[wellnessDaysRef.current.length - 1],
            activitiesRef.current
          );
          setAthleteProfile(updatedProf);
          athleteProfileRef.current = updatedProf;
        }
        setConnectionStatus((prev) => ({
          ...prev,
          mode: 'LIVE',
          stravaConnected: true,
          stravaSource: 'OAUTH',
          stravaAthleteId: tokens.athleteId ? String(tokens.athleteId) : prev.stravaAthleteId,
          stravaAthleteName: cleanName || prev.stravaAthleteName,
          stravaMeasurementPreference: measurementPref || prev.stravaMeasurementPreference,
          stravaGrantedScope: tokens.grantedScope ?? prev.stravaGrantedScope,
        }));
      }

      setIsSessionLoggedOut(false);
      const pendingTeamJoin = hasPendingTeamJoinInBrowser();
      if (!pendingTeamJoin) {
        const existingLocalPolicy = loadStravaSyncPolicyFromStorage();
        if (!existingLocalPolicy?.window) {
          const grantedScope = String(tokens?.grantedScope || '');
          const lacksScope = Boolean(grantedScope) && !grantedScope.includes('activity:read');
          saveStravaSyncPolicyToStorage({
            window: lacksScope ? 'none' : '90d',
            importProfileAndGear: true,
            confirmedAt: new Date().toISOString(),
            grantedScope: grantedScope || undefined,
          });
        }
        try {
          localStorage.setItem('aeropulse_auth_gate_passed', '1');
          const pendingRole = sessionStorage.getItem('thresh_onboarding_role');
          if (pendingRole === 'COACH') {
            sessionStorage.removeItem('thresh_onboarding_role');
            window.location.hash = '#coach';
          } else if (!window.location.hash) {
            window.location.hash = '#fitness';
          }
        } catch {
          // ignore storage/hash errors
        }
        hasEnteredWorkspaceRef.current = true;
        setHasEnteredWorkspace(true);
      }

      const statusData = await fetchServerConfigStatus();
      if (!pendingTeamJoin) {
        if (!statusData?.stravaSyncPolicy?.confirmedAt) {
          const activePolicy = loadStravaSyncPolicyFromStorage();
          void fetch('/api/strava/sync-policy', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              ...getSavedIntervalsHeaders(),
            },
            body: JSON.stringify({
              window: activePolicy?.window || '90d',
              importProfileAndGear: activePolicy?.importProfileAndGear !== false,
            }),
          }).catch(() => null);
        }
        void syncLiveTelemetry(false);
        return;
      }

      const alreadyHasPolicy = Boolean(
        hasExistingSyncPolicy ||
          statusData?.stravaSyncPolicy?.confirmedAt ||
          statusData?.stravaSyncPolicy?.consentedAt ||
          hasEnteredWorkspaceRef.current
      );
      if (alreadyHasPolicy) {
        try {
          localStorage.setItem('aeropulse_auth_gate_passed', '1');
        } catch {
          // ignore
        }
        hasEnteredWorkspaceRef.current = true;
        setHasEnteredWorkspace(true);
        void syncLiveTelemetry(false);
      }
    },
    [
      activitiesRef,
      athleteProfileRef,
      fetchServerConfigStatus,
      hasEnteredWorkspaceRef,
      reconcileStoreOwnerAthleteId,
      setAthleteProfile,
      setConnectionStatus,
      setDistanceUnit,
      setHasEnteredWorkspace,
      setIsSessionLoggedOut,
      syncLiveTelemetry,
      wellnessDaysRef,
    ]
  );

  // Listen for OAuth popup completion via window.postMessage and BroadcastChannel
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel('aeropulse_oauth');
        bc.onmessage = (event) => {
          processIncomingOAuthPayload(event.data);
        };
      }
    } catch {
      // ignore
    }

    const processIncomingOAuthPayload = (payload: any) => {
      if (!payload || typeof payload !== 'object') return;
      if (payload.type === 'OAUTH_AUTH_SUCCESS' || payload.type === 'aeropulse_oauth_success') {
        if (payload.provider === 'intervals') {
          if (payload.athleteId) {
            localStorage.setItem('aeropulse_intervals_athlete_id', String(payload.athleteId));
          }
          if (payload.athleteName) {
            localStorage.setItem('aeropulse_intervals_athlete_name', payload.athleteName);
          }
          if (payload.sessionToken) {
            localStorage.setItem('aeropulse_session_token', payload.sessionToken);
          }
          localStorage.removeItem('aeropulse_logged_out');
          localStorage.removeItem('aeropulse_intervals_api_key');
          void fetchServerConfigStatus().then(() => syncLiveTelemetry(false));
          return;
        }
        if (payload.provider === 'wahoo') {
          if (payload.athleteId) {
            localStorage.setItem('aeropulse_wahoo_athlete_id', String(payload.athleteId));
          }
          if (payload.athleteName) {
            localStorage.setItem('aeropulse_wahoo_athlete_name', payload.athleteName);
          }
          if (payload.sessionToken) {
            localStorage.setItem('aeropulse_session_token', payload.sessionToken);
          }
          localStorage.removeItem('aeropulse_logged_out');
          localStorage.setItem('aeropulse_wahoo_connected', '1');
          void fetchServerConfigStatus().then(() => syncLiveTelemetry(false));
          return;
        }
        if (payload.provider === 'polar') {
          if (payload.athleteId) {
            localStorage.setItem('aeropulse_polar_athlete_id', String(payload.athleteId));
          }
          if (payload.athleteName) {
            localStorage.setItem('aeropulse_polar_athlete_name', payload.athleteName);
          }
          if (payload.sessionToken) {
            localStorage.setItem('aeropulse_session_token', payload.sessionToken);
          }
          localStorage.removeItem('aeropulse_logged_out');
          localStorage.setItem('aeropulse_polar_connected', '1');
          void fetchServerConfigStatus().then(() => syncLiveTelemetry(false));
          return;
        }
        if (payload.tokens) {
          void completeStravaAuthHandshake({
            tokens: payload.tokens,
            sessionToken: payload.sessionToken,
            hasExistingSyncPolicy: payload.hasExistingSyncPolicy,
          });
        }
      } else if (
        (payload.type === 'OAUTH_AUTH_ERROR' || payload.type === 'aeropulse_oauth_error') &&
        payload.error
      ) {
        oauthErrorReceivedRef.current = true;
        stopStravaOAuthPoll();
        if (!payload.cancelled) {
          setSyncError(String(payload.error));
        }
      } else if (
        (payload.type === 'OAUTH_AUTH_CODE' || payload.type === 'aeropulse_oauth_code') &&
        payload.code
      ) {
        const codeStr = String(payload.code).trim();
        const dedupeKey = `code:${codeStr}`;
        if (handledOAuthTokensRef.current.has(dedupeKey)) return;
        handledOAuthTokensRef.current.add(dedupeKey);
        (async () => {
          try {
            const exResp = await fetch('/api/strava/exchange-code', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
              body: JSON.stringify({ code: codeStr }),
            });
            const exData = await safeParseResponseJson(exResp);
            const resolvedTokens =
              exData?.tokens ||
              (exData?.accessToken || exData?.refreshToken
                ? {
                    accessToken: exData.accessToken,
                    refreshToken: exData.refreshToken,
                    expiresAt: exData.expiresAt,
                    clientId: exData.clientId,
                    athleteId: exData.athleteId,
                    athleteName: exData.athleteName,
                    weightKg: exData.weightKg,
                    ftp: exData.ftp,
                    measurementPreference: exData.measurementPreference,
                    grantedScope: exData.grantedScope,
                  }
                : null);
            if (exResp.ok && resolvedTokens) {
              await completeStravaAuthHandshake({
                tokens: resolvedTokens,
                sessionToken: exData.sessionToken,
                hasExistingSyncPolicy: exData.hasExistingSyncPolicy,
              });
            } else if (exData?.error) {
              setSyncError(exData.error);
            }
          } catch (err) {
            setSyncError(err instanceof Error ? err.message : 'Failed to complete Strava sign-in.');
          }
        })();
      }
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      processIncomingOAuthPayload(event.data);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== 'aeropulse_oauth_result_v1' || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue) as { payload?: any };
        if (parsed?.payload) {
          processIncomingOAuthPayload(parsed.payload);
        }
      } catch {
        // ignore malformed storage payload
      }
    };

    window.addEventListener('message', handleMessage);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('storage', handleStorage);
      stopStravaOAuthPoll();
      if (bc) bc.close();
    };
  }, [completeStravaAuthHandshake, setSyncError, stopStravaOAuthPoll]);

  const launchProviderOAuth = async (urlPath: string, providerLabel: string, flow = 'popup') => {
    const popupWidth = 600;
    const popupHeight = 720;
    const left = Math.max(0, window.screenX + (window.outerWidth - popupWidth) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - popupHeight) / 2);
    const popup =
      flow === 'popup'
        ? window.open(
            'about:blank',
            'aeropulse_oauth_popup',
            `width=${popupWidth},height=${popupHeight},left=${left},top=${top},scrollbars=yes,resizable=yes`
          )
        : null;
    try {
      setSyncError(null);
      const resp = await fetch(`${urlPath}?flow=${encodeURIComponent(flow)}`, {
        credentials: 'include',
      });
      const data = await safeParseResponseJson(resp);
      if (!resp.ok || !data.url) {
        if (popup && !popup.closed) popup.close();
        throw new Error(data.error || `Failed to start ${providerLabel} OAuth`);
      }
      if (flow === 'popup' && popup && !popup.closed) {
        popup.location.href = data.url;
      } else {
        window.location.href = data.url;
      }
    } catch (err) {
      if (popup && !popup.closed) popup.close();
      setSyncError(err instanceof Error ? err.message : `Failed to launch ${providerLabel} OAuth`);
    }
  };

  const handleLaunchIntervalsOAuth = (flow = 'popup') =>
    launchProviderOAuth('/api/intervals/auth/url', 'Intervals.icu', flow);

  const handleConnectIntervals = async (athleteId: string, apiKey: string) => {
    setSyncError(null);
    const resp = await fetch('/api/intervals/connect', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
      body: JSON.stringify({ athleteId, apiKey }),
    });
    const data = await safeParseResponseJson(resp);
    if (!resp.ok) {
      setSyncError(data.error || 'Failed to connect Intervals.icu');
      throw new Error(data.error || 'Failed to connect Intervals.icu');
    }
    try {
      localStorage.setItem('aeropulse_intervals_api_key', apiKey.trim());
      localStorage.setItem(
        'aeropulse_intervals_athlete_id',
        (data.athleteId || athleteId || '0').trim()
      );
    } catch {
      // ignore
    }
    await syncLiveTelemetry(false);
  };

  const handleDisconnectIntervals = async () => {
    try {
      localStorage.removeItem('aeropulse_intervals_api_key');
      localStorage.removeItem('aeropulse_intervals_athlete_id');
      localStorage.removeItem('aeropulse_intervals_athlete_name');
    } catch {
      // ignore
    }
    await fetch('/api/intervals/disconnect', {
      method: 'POST',
      credentials: 'include',
      headers: getSavedIntervalsHeaders(),
    }).catch(() => null);
    await fetchServerConfigStatus();
  };

  const handleDisconnectGarmin = async () => {
    try {
      localStorage.removeItem('aeropulse_garmin_personal_api_key');
      localStorage.removeItem('aeropulse_garmin_bearer_token');
      localStorage.removeItem('aeropulse_garmin_oauth1_token');
      localStorage.removeItem('aeropulse_garmin_oauth1_secret');
      localStorage.removeItem('aeropulse_garmin_athlete_name');
    } catch {
      // ignore
    }
    await fetch('/api/garmin/disconnect', {
      method: 'POST',
      credentials: 'include',
      headers: getSavedIntervalsHeaders(),
    }).catch(() => null);
    await fetchServerConfigStatus();
  };

  const handleLaunchWahooOAuth = (flow = 'popup') =>
    launchProviderOAuth('/api/wahoo/auth/url', 'Wahoo', flow);

  const handleDisconnectWahoo = async () => {
    try {
      localStorage.removeItem('aeropulse_wahoo_connected');
      localStorage.removeItem('aeropulse_wahoo_athlete_id');
      localStorage.removeItem('aeropulse_wahoo_athlete_name');
    } catch {
      // ignore
    }
    await fetch('/api/wahoo/disconnect', {
      method: 'POST',
      credentials: 'include',
      headers: getSavedIntervalsHeaders(),
    }).catch(() => null);
    await fetchServerConfigStatus();
  };

  const handleLaunchPolarOAuth = (flow = 'popup') =>
    launchProviderOAuth('/api/polar/auth/url', 'Polar', flow);

  const handleDisconnectPolar = async () => {
    try {
      localStorage.removeItem('aeropulse_polar_connected');
      localStorage.removeItem('aeropulse_polar_athlete_id');
      localStorage.removeItem('aeropulse_polar_athlete_name');
    } catch {
      // ignore
    }
    await fetch('/api/polar/disconnect', {
      method: 'POST',
      credentials: 'include',
      headers: getSavedIntervalsHeaders(),
    }).catch(() => null);
    await fetchServerConfigStatus();
  };

  const handleDisconnectStravaOnly = async () => {
    try {
      localStorage.removeItem('aeropulse_strava_access_token');
      localStorage.removeItem('aeropulse_strava_refresh_token');
      localStorage.removeItem('aeropulse_strava_expires_at');
      localStorage.removeItem('aeropulse_strava_athlete_id');
      localStorage.removeItem('aeropulse_strava_athlete_name');
      localStorage.removeItem('aeropulse_strava_sync_policy');
    } catch {
      // ignore
    }
    await fetch('/api/strava/disconnect', {
      method: 'POST',
      credentials: 'include',
      headers: getSavedIntervalsHeaders(),
    }).catch(() => null);
    await fetchServerConfigStatus();
  };

  const handleUpdateStravaSyncPolicy = async (
    windowChoice: StravaSyncWindow,
    importProfileAndGear = true
  ): Promise<StravaSyncPolicy | null> => {
    setSyncError(null);
    const resp = await fetch('/api/strava/sync-policy', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
      body: JSON.stringify({ window: windowChoice, importProfileAndGear }),
    });
    const data = await safeParseResponseJson(resp);
    if (!resp.ok) {
      setSyncError(data.error || 'Could not update Strava sync preference.');
      return null;
    }
    if (data.stravaSyncPolicy) {
      saveStravaSyncPolicyToStorage(data.stravaSyncPolicy);
      setConnectionStatus((prev) => ({
        ...prev,
        stravaSyncPolicy: data.stravaSyncPolicy,
      }));
      if (windowChoice !== 'none') {
        void syncLiveTelemetry(windowChoice === 'all', windowChoice);
      }
      return data.stravaSyncPolicy as StravaSyncPolicy;
    }
    return null;
  };

  const handleClearPersistedArchive = async () => {
    await clearPersistedTelemetrySnapshot();
    setIdbSavedAt(null);
    activitiesRef.current = [];
    wellnessDaysRef.current = [];
    await syncLiveTelemetry(true);
  };

  const handleSaveStravaCredentials = async (clientId: string, clientSecret: string) => {
    setSyncError(null);
    const resp = await fetch('/api/strava/credentials', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
      body: JSON.stringify({ clientId, clientSecret }),
    });
    const data = await safeParseResponseJson(resp);
    if (!resp.ok) {
      setSyncError(data.error || 'Failed to save Strava credentials');
      return;
    }
    try {
      if (clientId.trim()) localStorage.setItem('aeropulse_strava_client_id', clientId.trim());
      if (clientSecret.trim())
        localStorage.setItem('aeropulse_strava_client_secret', clientSecret.trim());
    } catch {
      // ignore
    }
    await fetchServerConfigStatus();
  };

  const startStravaOAuthPoll = useCallback(
    (pollStateToken: string, popup: Window | null) => {
      stopStravaOAuthPoll();
      let attempts = 0;
      const pollHeaders: Record<string, string> = {};
      try {
        const sessionTok = sanitizeHttpHeaderValue(
          localStorage.getItem('aeropulse_session_token')
        );
        if (sessionTok) pollHeaders['x-session-token'] = sessionTok;
      } catch {
        // ignore
      }
      const timer = window.setInterval(async () => {
        attempts += 1;
        if (oauthCompletedRef.current || oauthErrorReceivedRef.current || attempts > 80) {
          stopStravaOAuthPoll();
          return;
        }
        try {
          const pollResp = await fetch(
            `/api/strava/auth/poll?state=${encodeURIComponent(pollStateToken)}`,
            { credentials: 'include', headers: pollHeaders }
          );
          if (!pollResp.ok) return;
          const pollData = await pollResp.json();
          if (pollData?.completed && pollData.tokens) {
            stopStravaOAuthPoll();
            try {
              if (popup && !popup.closed) popup.close();
            } catch {
              // ignore
            }
            await completeStravaAuthHandshake({
              tokens: pollData.tokens,
              sessionToken: pollData.sessionToken,
              hasExistingSyncPolicy: pollData.hasExistingSyncPolicy,
            });
          }
        } catch {
          // ignore transient poll errors
        }
      }, 1500);
      activePollTimerRef.current = timer;
    },
    [completeStravaAuthHandshake, stopStravaOAuthPoll]
  );

  const handleLaunchStravaOAuth = async (
    mode: 'cloud' | 'localhost' = 'cloud',
    joinContext?: StravaOAuthJoinContext,
    forcePrompt = false
  ) => {
    setSyncError(null);
    oauthErrorReceivedRef.current = false;
    oauthCompletedRef.current = false;
    stopStravaOAuthPoll();
    try {
      localStorage.removeItem('aeropulse_oauth_result_v1');
    } catch {
      // ignore
    }
    if (forcePrompt && !hasEnteredWorkspaceRef.current) {
      try {
        localStorage.removeItem('aeropulse_auth_gate_passed');
      } catch {
        // ignore
      }
    }
    const oauthState =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

    // Open centered Strava OAuth popup synchronously inside the user click gesture on desktop
    // (falls back automatically to top-level navigation on mobile phones, installed PWAs, or if blocked).
    const isStandalonePwa =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      Boolean((window.navigator as any)?.standalone);
    const isMobileViewport =
      window.innerWidth < 680 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    const shouldUsePopup = mode === 'localhost' || (!isStandalonePwa && !isMobileViewport);

    let popup: Window | null = null;
    if (shouldUsePopup) {
      const width = 600;
      const height = 740;
      const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
      const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
      popup = window.open(
        'about:blank',
        'strava_oauth_popup',
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
      );
      if (popup) {
        try {
          popup.document.open();
          popup.document.write(
            '<!doctype html><html><head><title>Connecting to Strava…</title></head><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0C1D14;color:#F8FAFC;font-family:system-ui,sans-serif;text-align:center;"><div style="padding:28px 32px;border-radius:16px;background:#111915;border:2px solid #25573A;"><div style="font-weight:700;font-size:16px;color:#FF7A45;margin-bottom:6px;">Connecting to Strava…</div><div style="font-size:13px;color:#CBD5E1;">Opening secure Strava authorization…</div></div></body></html>'
          );
          popup.document.close();
        } catch {
          // ignore cross-document write edge cases
        }
      }
    }

    const prompt =
      forcePrompt || (hasEnteredWorkspaceRef.current && !isSessionLoggedOut) ? 'force' : 'auto';
    const authQs = new URLSearchParams({
      origin: window.location.origin,
      mode,
      flow: popup && !popup.closed ? 'popup' : 'redirect',
      prompt,
      state: oauthState,
    });
    if (joinContext?.joinCode) authQs.set('joinCode', joinContext.joinCode);
    if (joinContext?.slug) authQs.set('slug', joinContext.slug);
    if (joinContext?.inviteToken) authQs.set('inviteToken', joinContext.inviteToken);

    const launchHeaders: Record<string, string> = {};
    try {
      const sessionTok = sanitizeHttpHeaderValue(localStorage.getItem('aeropulse_session_token'));
      const cid = sanitizeHttpHeaderValue(localStorage.getItem('aeropulse_strava_client_id'));
      const csec = sanitizeHttpHeaderValue(localStorage.getItem('aeropulse_strava_client_secret'));
      if (sessionTok) launchHeaders['x-session-token'] = sessionTok;
      if (cid && csec) {
        launchHeaders['x-strava-client-id'] = cid;
        launchHeaders['x-strava-client-secret'] = csec;
      }
    } catch {
      // ignore
    }

    try {
      const resp = await fetch(`/api/strava/auth/url?${authQs.toString()}`, {
        credentials: 'include',
        headers: launchHeaders,
      });
      const data = await safeParseResponseJson(resp);
      if (!resp.ok || !data?.url) {
        if (popup && !popup.closed) {
          try {
            popup.close();
          } catch {
            // ignore
          }
        }
        setSyncError(
          data?.error ||
            'Strava sign-in is temporarily unavailable on this server. Ask your administrator to configure STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET.'
        );
        return;
      }

      if (data.sessionToken) {
        try {
          if (!localStorage.getItem('aeropulse_session_token')) {
            localStorage.setItem('aeropulse_session_token', String(data.sessionToken));
          }
        } catch {
          // ignore
        }
      }

      const pollStateToken = String(data.state || oauthState);

      if (popup && !popup.closed) {
        popup.location.replace(data.url);
        popup.focus();

        // Poll /api/strava/auth/poll alongside postMessage, BroadcastChannel & storage for cross-browser resilience
        if (mode === 'cloud') {
          startStravaOAuthPoll(pollStateToken, popup);
        }
        return;
      }

      // Fallback when on mobile, standalone PWA, or when popup opening was blocked
      window.location.assign(data.url);
    } catch {
      const fallbackLoginUrl = `/api/strava/auth/login?${authQs.toString()}`;
      try {
        if (popup && !popup.closed) {
          popup.location.replace(fallbackLoginUrl);
          popup.focus();
          if (mode === 'cloud') {
            startStravaOAuthPoll(oauthState, popup);
          }
          return;
        }
        window.location.assign(fallbackLoginUrl);
      } catch {
        if (popup && !popup.closed) {
          try {
            popup.close();
          } catch {
            // ignore
          }
        }
        setSyncError(
          'Unable to reach the Strava sign-in endpoint. Refresh the page and try again, or verify your connection to thresh-dev.vercel.app.'
        );
      }
    }
  };

  const handleExchangeStravaCode = async (codeOrUrl: string) => {
    setSyncError(null);
    const resp = await fetch('/api/strava/exchange-code', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
      body: JSON.stringify({ code: codeOrUrl }),
    });
    const data = await safeParseResponseJson(resp);
    if (!resp.ok) {
      setSyncError(data.error || 'Failed to exchange Strava authorization code.');
      throw new Error(data.error || 'Failed to exchange Strava authorization code.');
    }
    await completeStravaAuthHandshake({
      tokens: {
        refreshToken: data.refreshToken,
        accessToken: data.accessToken,
        expiresAt: data.expiresAt,
        clientId: data.clientId,
        athleteId: data.athleteId,
        athleteName: data.athleteName,
        weightKg: data.weightKg,
        ftp: data.ftp,
        measurementPreference: data.measurementPreference,
        grantedScope: data.grantedScope,
      },
      sessionToken: data.sessionToken,
      hasExistingSyncPolicy: data.hasExistingSyncPolicy,
    });
  };

  const handleSaveStravaDirectToken = async (refreshToken: string, accessToken?: string) => {
    setSyncError(null);
    const resp = await fetch('/api/strava/token', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
      body: JSON.stringify({ refreshToken, accessToken }),
    });
    const data = await safeParseResponseJson(resp);
    if (!resp.ok) {
      setSyncError(data.error || 'Failed to connect Strava token.');
      throw new Error(data.error || 'Failed to connect Strava token.');
    }
    await completeStravaAuthHandshake({
      tokens: {
        refreshToken: data.refreshToken,
        accessToken: data.accessToken,
        expiresAt: data.expiresAt,
        clientId: data.clientId,
        athleteId: data.athleteId,
        athleteName: data.athleteName,
        weightKg: data.weightKg,
        ftp: data.ftp,
        measurementPreference: data.measurementPreference,
        grantedScope: data.grantedScope,
      },
      sessionToken: data.sessionToken,
      hasExistingSyncPolicy: data.hasExistingSyncPolicy,
    });
  };

  const handleSaveMapTileConfig = async (provider: MapTileProvider, apiKey: string) => {
    setSyncError(null);
    const cleanKey = apiKey.trim();
    try {
      localStorage.setItem('aeropulse_map_tile_provider', provider);
      if (cleanKey) {
        localStorage.setItem('aeropulse_map_tile_api_key', cleanKey);
      } else {
        localStorage.removeItem('aeropulse_map_tile_api_key');
      }
    } catch {
      // ignore
    }
    await fetch('/api/map/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
      body: JSON.stringify({ provider, apiKey: cleanKey }),
    });
    setConnectionStatus((prev) => ({
      ...prev,
      mapTileProvider: provider,
      mapTileApiKeyConfigured: Boolean(cleanKey),
      mapTileApiKey: cleanKey || undefined,
    }));
    window.dispatchEvent(new CustomEvent('aeropulse-map-config-updated'));
  };

  const handleSaveGeminiApiKey = async (apiKey: string) => {
    const cleanKey = apiKey.trim();
    try {
      if (cleanKey) {
        localStorage.setItem('aeropulse_gemini_api_key', cleanKey);
      } else {
        localStorage.removeItem('aeropulse_gemini_api_key');
      }
    } catch {
      // ignore
    }
    try {
      const resp = await fetch('/api/gemini/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
        body: JSON.stringify({ apiKey: cleanKey }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setConnectionStatus((prev) => ({
          ...prev,
          hasGeminiServerKey: Boolean(data.hasGeminiServerKey),
        }));
        return;
      }
    } catch {
      // ignore
    }
    setConnectionStatus((prev) => ({
      ...prev,
      hasGeminiServerKey: Boolean(cleanKey),
    }));
  };

  const handleExportConnectionBundle = async (): Promise<{
    bundle: string;
    envText: string;
  } | null> => {
    try {
      const resp = await fetch('/api/config/export-bundle', {
        headers: getSavedIntervalsHeaders(),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      return { bundle: data.bundle, envText: data.envText };
    } catch {
      return null;
    }
  };

  const handleImportConnectionBundle = async (bundleOrEnv: string) => {
    setSyncError(null);
    const resp = await fetch('/api/config/import-bundle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
      body: JSON.stringify({ bundle: bundleOrEnv }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setSyncError(data.error || 'Failed to import Connection Bundle.');
      throw new Error(data.error || 'Failed to import Connection Bundle.');
    }
    const creds = data.credentials || {};
    try {
      if (creds.intervalsApiKey)
        localStorage.setItem('aeropulse_intervals_api_key', creds.intervalsApiKey);
      if (creds.intervalsAthleteId)
        localStorage.setItem('aeropulse_intervals_athlete_id', creds.intervalsAthleteId);
      if (creds.stravaClientId)
        localStorage.setItem('aeropulse_strava_client_id', creds.stravaClientId);
      if (creds.stravaClientSecret)
        localStorage.setItem('aeropulse_strava_client_secret', creds.stravaClientSecret);
      if (creds.stravaRefreshToken)
        localStorage.setItem('aeropulse_strava_refresh_token', creds.stravaRefreshToken);
      if (creds.stravaAccessToken)
        localStorage.setItem('aeropulse_strava_access_token', creds.stravaAccessToken);
      if (creds.mapTileApiKey)
        localStorage.setItem('aeropulse_map_tile_api_key', creds.mapTileApiKey);
      if (creds.mapTileProvider)
        localStorage.setItem('aeropulse_map_tile_provider', creds.mapTileProvider);
      if (creds.geminiApiKey)
        localStorage.setItem('aeropulse_gemini_api_key', creds.geminiApiKey);
      localStorage.removeItem('aeropulse_logged_out');
      localStorage.setItem('aeropulse_auth_gate_passed', '1');
      window.dispatchEvent(new CustomEvent('aeropulse-map-config-updated'));
    } catch {
      // ignore
    }
    setIsSessionLoggedOut(false);
    setHasEnteredWorkspace(true);
    await syncLiveTelemetry(true);
  };

  return {
    completeStravaAuthHandshake,
    handleLaunchIntervalsOAuth,
    handleConnectIntervals,
    handleDisconnectIntervals,
    handleDisconnectGarmin,
    handleLaunchWahooOAuth,
    handleDisconnectWahoo,
    handleLaunchPolarOAuth,
    handleDisconnectPolar,
    handleDisconnectStravaOnly,
    handleUpdateStravaSyncPolicy,
    handleClearPersistedArchive,
    handleSaveStravaCredentials,
    handleLaunchStravaOAuth,
    handleExchangeStravaCode,
    handleSaveStravaDirectToken,
    handleSaveMapTileConfig,
    handleSaveGeminiApiKey,
    handleExportConnectionBundle,
    handleImportConnectionBundle,
  };
}
