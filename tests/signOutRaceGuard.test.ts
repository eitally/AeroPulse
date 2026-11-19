import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicTeamHubPage } from '../src/components/PublicTeamHubPage';
import { buildPresetExternalTeamSummary } from '../src/utils/athleticNetAndTfrrsEngine';
import { buildCleanRoomPublicHubFromTeamSummary } from '../src/utils/publicTeamHubRoute';
import { STORAGE_KEYS, clearAllUserBrowserStorage } from '../src/utils/storageKeys';
import {
  isBrowserSessionLoggedOut,
  loadStravaSyncPolicyFromStorage,
  savePersistedTelemetrySnapshot,
  saveRotatedStravaTokensToStorage,
  saveStravaSyncPolicyToStorage,
} from '../src/utils/telemetryStorage';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

describe('Track 2: Shared-Device Sign-Out Race Guards & Public Team Hub Fixes', () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;

  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    vi.stubGlobal('sessionStorage', createMemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalLocalStorage) globalThis.localStorage = originalLocalStorage;
    if (originalSessionStorage) globalThis.sessionStorage = originalSessionStorage;
  });

  it('refuses sync-policy and rotated-token writes while logged out, allows explicit null removal, and resumes after re-login', () => {
    localStorage.setItem(STORAGE_KEYS.LOGGED_OUT, '1');
    expect(isBrowserSessionLoggedOut()).toBe(true);

    saveStravaSyncPolicyToStorage({
      window: 'all',
      importProfileAndGear: true,
      confirmedAt: '2026-11-19T00:00:00.000Z',
    });
    saveRotatedStravaTokensToStorage({
      accessToken: 'stale_acc',
      refreshToken: 'stale_ref',
      expiresAt: 2100000000,
      athleteId: '554433',
      athleteName: 'Returning Runner',
    });

    expect(loadStravaSyncPolicyFromStorage()).toBeNull();
    expect(localStorage.getItem('aeropulse_strava_access_token')).toBeNull();
    expect(localStorage.getItem('aeropulse_strava_refresh_token')).toBeNull();
    expect(localStorage.getItem('aeropulse_strava_athlete_id')).toBeNull();

    // Explicit removal (null) must still remove any stray key even when logged out
    localStorage.setItem(STORAGE_KEYS.STRAVA_SYNC_POLICY, '{"window":"90d"}');
    saveStravaSyncPolicyToStorage(null);
    expect(localStorage.getItem(STORAGE_KEYS.STRAVA_SYNC_POLICY)).toBeNull();

    // Clearing LOGGED_OUT on fresh sign-in restores normal persistence
    localStorage.removeItem(STORAGE_KEYS.LOGGED_OUT);
    expect(isBrowserSessionLoggedOut()).toBe(false);

    saveStravaSyncPolicyToStorage({
      window: '90d',
      importProfileAndGear: true,
      confirmedAt: '2026-11-19T01:00:00.000Z',
    });
    saveRotatedStravaTokensToStorage({
      accessToken: 'fresh_acc',
      refreshToken: 'fresh_ref',
      expiresAt: 2100000000,
      athleteId: '554433',
      athleteName: 'Returning Runner',
    });

    expect(loadStravaSyncPolicyFromStorage()?.window).toBe('90d');
    expect(localStorage.getItem('aeropulse_strava_access_token')).toBe('fresh_acc');
    expect(localStorage.getItem('aeropulse_strava_athlete_id')).toBe('554433');
  });

  it('aborts savePersistedTelemetrySnapshot and returns null when logged out', async () => {
    localStorage.setItem(STORAGE_KEYS.LOGGED_OUT, '1');
    const saved = await savePersistedTelemetrySnapshot({
      activities: [],
      wellnessDays: [],
      plannedEvents: [],
      gearItems: [],
      redactedStravaCount: 0,
    });
    expect(saved).toBeNull();
  });

  it('prevents an in-flight /api/config/status resolution from re-hydrating user keys after shared-device Sign Out', async () => {
    // 1. User A starts signed in while /api/config/status is in-flight
    localStorage.setItem(STORAGE_KEYS.SESSION_TOKEN, 'tok_user_a');
    localStorage.setItem(STORAGE_KEYS.STRAVA_SYNC_POLICY, JSON.stringify({ window: 'all' }));

    let resolveConfigStatus!: (value: Record<string, unknown>) => void;
    const inFlightConfigStatus = new Promise<Record<string, unknown>>((resolve) => {
      resolveConfigStatus = resolve;
    });

    // 2. User A clicks Sign Out before the network response lands
    clearAllUserBrowserStorage({ preserveLoggedOutFlag: true });
    expect(localStorage.getItem(STORAGE_KEYS.LOGGED_OUT)).toBe('1');
    expect(localStorage.getItem(STORAGE_KEYS.STRAVA_SYNC_POLICY)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.SESSION_TOKEN)).toBeNull();

    // 3. Stale server status arrives after Sign Out
    resolveConfigStatus({
      stravaConnected: true,
      sessionToken: 'tok_user_a_reissued',
      stravaSyncPolicy: { window: 'all', importProfileAndGear: true, confirmedAt: '2026-11-19T00:00:00Z' },
      stravaTokens: {
        accessToken: 'acc_leaked',
        refreshToken: 'ref_leaked',
        expiresAt: 2100000000,
        athleteId: '554433',
        athleteName: 'Returning Runner',
      },
    });
    const stalePayload = await inFlightConfigStatus;

    // Storage helpers themselves block late writes while LOGGED_OUT === '1'
    saveStravaSyncPolicyToStorage(stalePayload.stravaSyncPolicy as any);
    saveRotatedStravaTokensToStorage(stalePayload.stravaTokens as any);
    expect(localStorage.getItem(STORAGE_KEYS.STRAVA_SYNC_POLICY)).toBeNull();
    expect(localStorage.getItem('aeropulse_strava_access_token')).toBeNull();
    expect(localStorage.getItem('aeropulse_strava_athlete_name')).toBeNull();

    // Verify useTelemetrySync.ts guards post-await writes in fetchServerConfigStatus & syncLiveTelemetry
    const hookSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/hooks/useTelemetrySync.ts'),
      'utf8'
    );
    expect(hookSrc).toContain('isBrowserSessionLoggedOut');
    const guardMatches = hookSrc.match(/isBrowserSessionLoggedOut\(\)/g) || [];
    expect(guardMatches.length).toBeGreaterThanOrEqual(12);
    expect(hookSrc).toContain('const isNotLoggedOut = () => !isBrowserSessionLoggedOut();');
  });

  it('renders PublicTeamHubPage without duplicate Coach prefix and bypasses remote fetch for ?demo=1 presets', () => {
    const withCoachPrefix = buildPresetExternalTeamSummary('WILLOW_GLEN', 'Coach Morales');
    const hubWithPrefix = buildCleanRoomPublicHubFromTeamSummary(withCoachPrefix);
    const html1 = renderToStaticMarkup(
      React.createElement(PublicTeamHubPage, {
        slugOrCode: 'willow-glen-high-school-xc',
        isDark: false,
        onToggleDark: () => {},
        initialPayloadForTest: hubWithPrefix,
        onExitHub: () => {},
      })
    );
    expect(html1).toContain('Coach Morales');
    expect(html1).not.toContain('Coach Coach Morales');

    const withoutCoachPrefix = buildPresetExternalTeamSummary('WILLOW_GLEN', 'Morales');
    const hubWithoutPrefix = buildCleanRoomPublicHubFromTeamSummary(withoutCoachPrefix);
    const html2 = renderToStaticMarkup(
      React.createElement(PublicTeamHubPage, {
        slugOrCode: 'willow-glen-high-school-xc',
        isDark: false,
        onToggleDark: () => {},
        initialPayloadForTest: hubWithoutPrefix,
        onExitHub: () => {},
      })
    );
    expect(html2).toContain('Coach Morales');
    expect(html2).not.toContain('Coach Coach');

    const hubSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/PublicTeamHubPage.tsx'),
      'utf8'
    );
    const demoCheckIdx = hubSrc.indexOf("new URLSearchParams(window.location.search).get('demo') === '1'");
    const fetchIdx = hubSrc.indexOf('fetch(`/api/teams/public/');
    expect(demoCheckIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(demoCheckIdx);
  });
});
