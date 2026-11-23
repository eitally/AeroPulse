import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FUNNEL_EVENT_NAMES,
  FUNNEL_VAULT_KEY,
  MAX_VAULT_FUNNEL_EVENTS,
  getFunnelSummaryAsync,
  recordFunnelEventAsync,
  sanitizeFunnelEventInput,
} from '../server/funnelAnalyticsService.ts';
import { analyticsRouter } from '../server/routers/analyticsRouter.ts';
import { resetRateLimitsForTesting } from '../server/rateLimiter.ts';
import { createStripeCheckoutSession } from '../server/teamBillingService.ts';
import { createTeamForCoach } from '../server/teamService.ts';
import { removeTeamFromDirectoryAndVault } from '../server/teamLifecycleService.ts';
import {
  deleteTenantVault,
  loadTenantVaultAsync,
  saveTenantVaultAsync,
  type FunnelEventDbRow,
} from '../server/tokenVault.ts';
import { buildSampleDemoDataset } from '../src/data/sampleDemoData.ts';
import { emitFunnelEvent } from '../src/utils/funnelTelemetry.ts';
import {
  buildSupportDiagnosticsSnapshot,
  downloadSupportDiagnosticsJson,
  redactDiagnosticString,
} from '../src/utils/supportDiagnostics.ts';
import { buildSchoolPoInvoicePrintHtml } from '../src/utils/schoolPoInvoiceHelper.ts';
import { STORAGE_KEYS } from '../src/utils/storageKeys.ts';
import { WorkspaceErrorBoundary } from '../src/components/WorkspaceErrorBoundary.tsx';
import { DataSourcesModal } from '../src/components/DataSourcesModal.tsx';
import { AthleteRosterModal } from '../src/components/AthleteRosterModal.tsx';
import { TeamBillingAndPoModal } from '../src/components/coach/TeamBillingAndPoModal.tsx';
import type { ConnectionStatus, TeamSummaryWithRole } from '../src/types.ts';

const ROOT = process.cwd();

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (idx: number) => Array.from(map.keys())[idx] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
}

function makeBaseStatus(overrides?: Partial<ConnectionStatus> & {
  wahooScope?: string;
  wahooCanPushWorkouts?: boolean;
}): ConnectionStatus {
  return {
    mode: 'LIVE',
    intervalsConnected: false,
    intervalsAthleteId: '0',
    intervalsSource: 'NONE',
    stravaConnected: false,
    stravaSource: 'NONE',
    hasGeminiServerKey: false,
    devCallbackUrl: 'http://localhost:5173/api/strava/callback',
    sharedCallbackUrl: 'https://meetready.app/api/strava/callback',
    currentOriginCallbackUrl: 'https://meetready.app/api/strava/callback',
    ...overrides,
  } as ConnectionStatus;
}

function makeSampleTeam(planCode: 'FREE_FOUNDING' | 'DISTRICT_2000' = 'FREE_FOUNDING'): TeamSummaryWithRole {
  return {
    brand: {
      teamId: 'tm_test_billing_1',
      slug: 'oakridge-tf',
      joinCode: 'OAK-26',
      name: 'Oakridge High Track & Field',
      shortName: 'OAK TF',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
      primaryHex: '#B83A24',
      secondaryHex: '#D8FF2A',
      defaultSafeSportShield: true,
      enableParentGuardianCc: true,
      coachDisplayName: 'Coach Morales',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    myRole: 'HEAD_COACH',
    mySquadGroup: 'All',
    myMembershipId: 'mem_coach_1',
    totalInvited: 24,
    openedCount: 24,
    activeCount: 24,
    watchConnectedCount: 10,
    memberships: [],
    broadcastWorkouts: [],
    billing: {
      planCode,
      status: planCode === 'DISTRICT_2000' ? 'ACTIVE_PAID' : 'PILOT',
      poInvoices: [],
    },
  };
}

describe('Sprint 3B: Funnel Telemetry, Support Diagnostics & Commercialization Polish', () => {
  let server: http.Server;
  let baseUrl = '';
  let tmpVaultDir = '';
  const prevVaultDir = process.env.THRESH_VAULT_DIR;
  const prevCronSecret = process.env.CRON_SECRET;
  const prevStripeKey = process.env.STRIPE_SECRET_KEY;

  beforeAll(async () => {
    tmpVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-sprint3b-'));
    process.env.THRESH_VAULT_DIR = tmpVaultDir;

    const app = express();
    app.use(express.json());
    app.use(analyticsRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr) {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  beforeEach(async () => {
    resetRateLimitsForTesting('funnel:');
    await deleteTenantVault(FUNNEL_VAULT_KEY);
    if (prevCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevCronSecret;
    if (prevStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prevStripeKey;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    if (prevVaultDir === undefined) delete process.env.THRESH_VAULT_DIR;
    else process.env.THRESH_VAULT_DIR = prevVaultDir;
    if (prevCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevCronSecret;
    if (prevStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prevStripeKey;
    if (tmpVaultDir) {
      fs.rmSync(tmpVaultDir, { recursive: true, force: true });
    }
  });

  describe('1. First-Party COPPA/FERPA-Safe Funnel Analytics Service & Router', () => {
    it('enforces strict event allowlist, strips PII, truncates tags, and normalizes /join/* & /team/*', () => {
      expect(FUNNEL_EVENT_NAMES).toEqual([
        'landing_view',
        'demo_enter',
        'auth_complete',
        'team_created',
        'workout_published',
        'po_generated',
        'stripe_checkout_started',
      ]);

      expect(sanitizeFunnelEventInput({ event: 'page_view' })).toBeNull();
      expect(sanitizeFunnelEventInput({ event: 'custom_click' })).toBeNull();

      const sanitized = sanitizeFunnelEventInput({
        event: 'team_created',
        email: 'coach@school.edu',
        name: 'Jane Doe',
        userId: 'usr_secret_123',
        sid: 'sid_secret_456',
        teamId: 'tm_secret_789',
        ip: '192.168.1.44',
        userAgent: 'Mozilla/5.0 Secret',
        utm_source: 'x'.repeat(90),
        utm_medium: 'qr',
        utm_campaign: 'spring_2026',
        utm_content: 'coach@leak.org banner',
        src: 'ad_pack',
        referrerHost: 'https://www.Athletic.net/TrackAndField/MeetResults.aspx?Meet=991',
        landing_path: '/join/palo-alto-high-2026?t=secret_token_abc#coach',
        role: 'coach',
        tier: 'high_school',
      });

      expect(sanitized).toEqual({
        event_name: 'team_created',
        utm_source: 'x'.repeat(64),
        utm_medium: 'qr',
        utm_campaign: 'spring_2026',
        utm_content: '[redacted] banner',
        src: 'ad_pack',
        referrer_host: 'www.athletic.net',
        landing_path: '/join/:slug',
        role: 'COACH',
        tier: 'HIGH_SCHOOL',
      });

      const serialized = JSON.stringify(sanitized);
      for (const secret of [
        'coach@school.edu',
        'Jane Doe',
        'usr_secret_123',
        'sid_secret_456',
        'tm_secret_789',
        '192.168.1.44',
        'Mozilla/5.0',
        'palo-alto-high-2026',
        'secret_token_abc',
        'MeetResults.aspx',
        'coach@leak.org',
      ]) {
        expect(serialized).not.toContain(secret);
      }

      const teamSlugSanitized = sanitizeFunnelEventInput({
        event: 'landing_view',
        landing_path: 'https://meetready.app/team/bellarmine-xc?view=schedule',
        referrer_host: 'coach@school.edu',
        role: 'SUPERADMIN',
        tier: 'UNKNOWN_TIER',
      });
      expect(teamSlugSanitized?.landing_path).toBe('/team/:slug');
      expect(teamSlugSanitized?.referrer_host).toBeUndefined();
      expect(teamSlugSanitized?.role).toBe('UNKNOWN');
      expect(teamSlugSanitized?.tier).toBeUndefined();
    });

    it('records events to encrypted vault fallback capped at 2,000 events and computes accurate summaries', async () => {
      const seedRows: FunnelEventDbRow[] = Array.from({ length: MAX_VAULT_FUNNEL_EVENTS + 15 }, (_, idx) => ({
        event_name: 'landing_view',
        created_at: new Date(Date.now() - (idx + 1) * 1000).toISOString(),
        utm_source: 'seed',
        role: 'UNKNOWN',
      }));
      await saveTenantVaultAsync(FUNNEL_VAULT_KEY, seedRows);

      const recRes = await recordFunnelEventAsync({
        event: 'demo_enter',
        utm_source: 'print',
        utm_medium: 'qr',
        utm_campaign: 'spring_track',
        referrer_host: 'athletic.net',
        role: 'COACH',
        tier: 'DEMO_COACH',
      });
      expect(recRes.ok).toBe(true);
      expect(recRes.recorded).toBe(true);

      const storedAfter = await loadTenantVaultAsync<FunnelEventDbRow[]>(FUNNEL_VAULT_KEY, []);
      expect(storedAfter).toHaveLength(MAX_VAULT_FUNNEL_EVENTS);
      expect(storedAfter[storedAfter.length - 1]?.event_name).toBe('demo_enter');

      await deleteTenantVault(FUNNEL_VAULT_KEY);
      await recordFunnelEventAsync({ event: 'landing_view', utm_source: 'print', role: 'ORG_ADMIN' });
      await recordFunnelEventAsync({ event: 'landing_view', utm_source: 'print', role: 'COACH' });
      await recordFunnelEventAsync({ event: 'demo_enter', utm_source: 'print', role: 'COACH', tier: 'DEMO_COACH' });
      await recordFunnelEventAsync({ event: 'auth_complete', utm_source: 'print', role: 'COACH' });
      await recordFunnelEventAsync({ event: 'team_created', utm_source: 'print', role: 'COACH', tier: 'HIGH_SCHOOL' });
      await recordFunnelEventAsync({ event: 'po_generated', utm_source: 'print', role: 'ORG_ADMIN', tier: 'HS_250' });

      const summary = await getFunnelSummaryAsync({ windowDays: 30 });
      expect(summary.windowDays).toBe(30);
      expect(summary.totalEvents).toBe(6);
      expect(summary.byEvent.landing_view).toBe(2);
      expect(summary.byEvent.demo_enter).toBe(1);
      expect(summary.byEvent.team_created).toBe(1);
      expect(summary.byEvent.po_generated).toBe(1);
      expect(summary.conversionRates.landingToDemoPct).toBe(50);
      expect(summary.conversionRates.teamToPoPct).toBe(100);
      expect(summary.byUtmSource.print).toBe(6);
      expect(summary.byRole.COACH).toBe(4);
      expect(summary.byRole.ORG_ADMIN).toBe(2);
      expect(summary.byTier.HS_250).toBe(1);
      expect(summary.dailyCounts.length).toBeGreaterThanOrEqual(1);
    });

    it('handles POST /api/analytics/event (202/400/429) and GET /api/analytics/summary CRON_SECRET auth (401/200)', async () => {
      const badResp = await fetch(`${baseUrl}/api/analytics/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'not_allowed' }),
      });
      expect(badResp.status).toBe(400);

      const okResp = await fetch(`${baseUrl}/api/analytics/event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.55',
          'user-agent': 'SecretAgent/1.0',
        },
        body: JSON.stringify({
          event: 'landing_view',
          utm_source: 'clinic',
          email: 'leak@school.edu',
          landing_path: '/team/lincoln-high?t=secret',
        }),
      });
      expect(okResp.status).toBe(202);
      expect(await okResp.json()).toEqual({ ok: true, recorded: true });

      const storedRows = await loadTenantVaultAsync<FunnelEventDbRow[]>(FUNNEL_VAULT_KEY, []);
      expect(storedRows).toHaveLength(1);
      expect(JSON.stringify(storedRows[0])).not.toContain('203.0.113.55');
      expect(JSON.stringify(storedRows[0])).not.toContain('SecretAgent');
      expect(JSON.stringify(storedRows[0])).not.toContain('leak@school.edu');
      expect(storedRows[0]?.landing_path).toBe('/team/:slug');

      // Enforce 60/min rate limit on POST /api/analytics/event
      for (let i = 0; i < 59; i++) {
        const res = await fetch(`${baseUrl}/api/analytics/event`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '203.0.113.55',
          },
          body: JSON.stringify({ event: 'landing_view' }),
        });
        expect(res.status).toBe(202);
      }
      const blocked = await fetch(`${baseUrl}/api/analytics/event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.55',
        },
        body: JSON.stringify({ event: 'landing_view' }),
      });
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);

      // Summary endpoint auth check
      process.env.CRON_SECRET = 'cron_secret_test_xyz';
      const unauth = await fetch(`${baseUrl}/api/analytics/summary?windowDays=14`);
      expect(unauth.status).toBe(401);

      const badSecret = await fetch(`${baseUrl}/api/analytics/summary`, {
        headers: { Authorization: 'Bearer wrong_secret' },
      });
      expect(badSecret.status).toBe(401);

      const authSummary = await fetch(`${baseUrl}/api/analytics/summary?windowDays=999`, {
        headers: { Authorization: 'Bearer cron_secret_test_xyz' },
      });
      expect(authSummary.status).toBe(200);
      const summaryJson = (await authSummary.json()) as {
        ok: boolean;
        summary: { windowDays: number; totalEvents: number };
      };
      expect(summaryJson.ok).toBe(true);
      expect(summaryJson.summary.windowDays).toBe(365);
      expect(summaryJson.summary.totalEvents).toBe(60);
    });

    it('client emitFunnelEvent skips minors, deduplicates session keys, omits cookies, and reads attribution', async () => {
      const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
      const sessionStorage = makeMemoryStorage();
      sessionStorage.setItem(
        'meetready_first_party_attr_v1',
        JSON.stringify({
          utm_source: 'print',
          utm_medium: 'banner',
          referrerHost: 'athletic.net',
          landing_path: '/join/paly-xc#coach',
        })
      );

      vi.stubGlobal('window', {
        location: { pathname: '/join/paly-xc', hostname: 'meetready.app' },
        sessionStorage,
      });
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, init });
        return new Response(JSON.stringify({ ok: true, recorded: true }), { status: 202 });
      });

      // Minor users must NEVER emit telemetry
      expect(
        emitFunnelEvent('auth_complete', { role: 'ATHLETE', isMinorUser: true })
      ).toBe(false);
      expect(fetchCalls).toHaveLength(0);

      // Adult coach event fires with keepalive, omit credentials, normalized path, and attribution
      expect(
        emitFunnelEvent('team_created', {
          role: 'COACH',
          tier: 'HIGH_SCHOOL',
          dedupeSessionKey: 'team_created_once',
        })
      ).toBe(true);
      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]?.init?.credentials).toBe('omit');
      expect(fetchCalls[0]?.init?.keepalive).toBe(true);
      const body = JSON.parse(String(fetchCalls[0]?.init?.body || '{}')) as Record<string, unknown>;
      expect(body.event).toBe('team_created');
      expect(body.utm_source).toBe('print');
      expect(body.referrerHost).toBe('athletic.net');
      expect(body.landing_path).toBe('/join/:slug');

      // Dedupe prevents repeat emission
      expect(
        emitFunnelEvent('team_created', {
          role: 'COACH',
          tier: 'HIGH_SCHOOL',
          dedupeSessionKey: 'team_created_once',
        })
      ).toBe(false);
      expect(fetchCalls).toHaveLength(1);
    });
  });

  describe('2. Supportability, Redacted Diagnostics & Wearable Capability Badges', () => {
    it('redacts emails, Bearer/JWT tokens, secrets, slugs, and query strings with zero PII in snapshots', async () => {
      const redacted = redactDiagnosticString(
        'Fetch failed for https://meetready.app/join/secret-school?t=tok_123&email=kid@school.edu with Authorization: Bearer sk_live_abc123456 from coach@school.edu'
      );
      expect(redacted).not.toContain('tok_123');
      expect(redacted).not.toContain('kid@school.edu');
      expect(redacted).not.toContain('sk_live_abc123456');
      expect(redacted).not.toContain('coach@school.edu');
      expect(redacted).not.toContain('secret-school');
      expect(redacted).toContain('[redacted-query]');
      expect(redacted).toContain('[redacted-auth]');
      expect(redacted).toContain('[redacted-email]');

      const localStorage = makeMemoryStorage();
      localStorage.setItem(STORAGE_KEYS.CLOUD_STATE_DIRTY, '1');
      localStorage.setItem(STORAGE_KEYS.PLAIN_LANGUAGE, '1');
      localStorage.setItem(
        STORAGE_KEYS.STOPWATCH_OUTBOX,
        JSON.stringify([
          {
            batchId: 'batch_secret_1',
            teamId: 'tm_secret_99',
            entries: [{ membershipId: 'mem_secret_1', activity: { name: 'Secret Athlete Split' } }],
            createdAt: '2026-11-22T00:00:00.000Z',
            attempts: 2,
            lastError: 'coach@school.edu network timeout',
          },
        ])
      );

      vi.stubGlobal('localStorage', localStorage);
      vi.stubGlobal('window', {
        location: {
          hostname: 'meetready.app',
          pathname: '/team/lincoln-high',
          search: '?t=super_secret_query&email=athlete@school.edu',
          hash: '#access_token=should_never_appear',
        },
        innerWidth: 1280,
        innerHeight: 800,
        devicePixelRatio: 2,
        localStorage,
        matchMedia: () => ({ matches: false }),
      });
      vi.stubGlobal('navigator', {
        onLine: true,
        serviceWorker: {
          getRegistration: async () => ({
            scope: 'https://meetready.app/',
            active: { state: 'activated' },
            waiting: null,
          }),
        },
      });
      vi.stubGlobal('fetch', async (url: string) => {
        if (url === '/api/health') {
          return new Response(
            JSON.stringify({
              ok: true,
              storageBackend: 'POSTGRES',
              databaseConfigured: true,
              databaseHealthy: true,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        throw new Error(`Unexpected fetch ${url}`);
      });

      const snapshot = await buildSupportDiagnosticsSnapshot({
        source: 'workspace-error-boundary',
        restoreTab: 'coach',
        persistedWorkoutCount: 12,
        idbSavedAt: '2026-11-22T10:00:00.000Z',
        boundaryError: new Error(
          'Chunk fail https://meetready.app/join/secret-team?t=tok_999 Bearer xyz_secret_token coach@school.edu'
        ),
        connectionStatus: makeBaseStatus({
          wahooConnected: true,
          wahooAthleteId: 'wahoo_secret_id_777',
          wahooAthleteName: 'Secret Athlete Name',
          wahooScope: 'user_read workouts_read workouts_write',
        }),
      });

      expect(snapshot.environment.hostname).toBe('meetready.app');
      expect(snapshot.environment.routePathname).toBe('/team/:slug');
      expect(snapshot.environment.viewport).toEqual({
        width: 1280,
        height: 800,
        devicePixelRatio: 2,
      });
      expect(snapshot.serviceWorker).toMatchObject({
        supported: true,
        registered: true,
        state: 'activated',
        scopePathname: '/',
      });
      expect(snapshot.outboxes.stopwatch.pendingBatches).toBe(1);
      expect(snapshot.outboxes.stopwatch.pendingEntries).toBe(1);
      expect(snapshot.storage.cloudStateDirty).toBe(true);
      expect(snapshot.featureFlags.plainLanguage).toBe(true);
      expect(snapshot.providers?.wahooCanPushWorkouts).toBe(true);
      expect(snapshot.healthProbe.ok).toBe(true);
      expect(snapshot.healthProbe.storageBackend).toBe('POSTGRES');

      const json = JSON.stringify(snapshot);
      for (const forbidden of [
        'super_secret_query',
        'should_never_appear',
        'lincoln-high',
        'secret-team',
        'tok_999',
        'xyz_secret_token',
        'coach@school.edu',
        'athlete@school.edu',
        'batch_secret_1',
        'tm_secret_99',
        'mem_secret_1',
        'Secret Athlete',
        'wahoo_secret_id_777',
      ]) {
        expect(json).not.toContain(forbidden);
      }

      const dlResult = await downloadSupportDiagnosticsJson({ skipHealthProbe: true });
      expect(dlResult.filename).toMatch(/^meetready-diagnostics-\d{4}-\d{2}-\d{2}\.json$/);
      expect(dlResult.snapshot.schemaVersion).toBe(1);
    });

    it('renders Support Diagnostics buttons and Wahoo/Polar/Suunto capabilities in UI components', () => {
      vi.stubGlobal('localStorage', makeMemoryStorage());
      class BrokenBoundary extends WorkspaceErrorBoundary {
        state = { error: new Error('Sample render failure') };
      }
      const boundaryHtml = renderToStaticMarkup(
        React.createElement(
          BrokenBoundary,
          {
            restoreTab: 'coach',
            children: React.createElement('div', null, 'child'),
          },
          React.createElement('div', null, 'child')
        )
      );
      expect(boundaryHtml).toContain('data-testid="error-boundary-diagnostics-btn"');
      expect(boundaryHtml).toContain('Download Support Diagnostics');

      const wahooReadOnlyHtml = renderToStaticMarkup(
        React.createElement(DataSourcesModal, {
          isOpen: true,
          onClose: () => {},
          status: makeBaseStatus({
            wahooConnected: true,
            wahooScope: 'user_read workouts_read',
            polarConnected: true,
          }),
          onConnectIntervals: async () => {},
          onDisconnectIntervals: async () => {},
          onLaunchWahooOAuth: async () => {},
          onDisconnectWahoo: async () => {},
          onSaveStravaCredentials: async () => {},
          onLaunchStravaOAuth: async () => {},
          onExchangeStravaCode: async () => {},
          onSaveStravaDirectToken: async () => {},
          onSaveMapTileConfig: async () => {},
          onExportBundle: async () => null,
          onImportBundle: async () => {},
          onSyncNow: async () => {},
          isSyncing: false,
          errorMessage: null,
        })
      );
      expect(wahooReadOnlyHtml).toContain('Read-Only (Reconnect to Push)');
      expect(wahooReadOnlyHtml).toContain('data-testid="wahoo-upgrade-permissions-btn"');
      expect(wahooReadOnlyHtml).toContain('Upgrade Wahoo Permissions');
      expect(wahooReadOnlyHtml).toContain('Read-Only Sync (Use .FIT Export or Intervals.icu Bridge)');
      expect(wahooReadOnlyHtml).toContain('data-testid="suunto-intervals-bridge-note"');
      expect(wahooReadOnlyHtml).toContain('data-testid="data-sources-diagnostics-btn"');

      const wahooTwoWayHtml = renderToStaticMarkup(
        React.createElement(DataSourcesModal, {
          isOpen: true,
          onClose: () => {},
          status: makeBaseStatus({
            wahooConnected: true,
            wahooScope: 'user_read workouts_read workouts_write',
          }),
          onConnectIntervals: async () => {},
          onDisconnectIntervals: async () => {},
          onLaunchWahooOAuth: async () => {},
          onSaveStravaCredentials: async () => {},
          onLaunchStravaOAuth: async () => {},
          onExchangeStravaCode: async () => {},
          onSaveStravaDirectToken: async () => {},
          onSaveMapTileConfig: async () => {},
          onExportBundle: async () => null,
          onImportBundle: async () => {},
          onSyncNow: async () => {},
          isSyncing: false,
          errorMessage: null,
        })
      );
      expect(wahooTwoWayHtml).toContain('2-Way Workout Push');
      expect(wahooTwoWayHtml).not.toContain('data-testid="wahoo-upgrade-permissions-btn"');

      const demoData = buildSampleDemoDataset('2026-11-19');
      const rosterPrivacyHtml = renderToStaticMarkup(
        React.createElement(AthleteRosterModal, {
          isOpen: true,
          initialTab: 'PRIVACY_SHIELD',
          onClose: () => {},
          selfName: 'Sample Athlete',
          selfInviteCode: 'MR-1234',
          selfCtl: 40,
          selfAtl: 42,
          selfTsb: -2,
          selfHrv: 64,
          selfProfile: demoData.athleteProfile,
          selfPrivacySettings: {
            shareWellnessAndHrv: 'COACHES_ONLY',
            sharePmcAndZones: 'COACHES_ONLY',
            shareGpsRoutes: 'PRIVATE',
            allowCoachCalendarEdits: true,
            stravaComplianceShield: true,
          },
          onUpdateSelfPrivacy: () => {},
          roster: [],
          activeAthleteId: 'self',
          onSelectAthleteViewport: () => {},
          onApproveRequest: () => {},
          onRemoveOrDeclineAthlete: () => {},
          onToggleAthleteRole: () => {},
          onAddFollowByInviteOrName: () => {},
          onPushCoachWorkout: () => {},
          distanceUnit: 'mi',
          myTeams: [],
        })
      );
      expect(rosterPrivacyHtml).toContain('data-testid="privacy-support-diagnostics-btn"');
      expect(rosterPrivacyHtml).toContain('No personal data, tokens, or workouts included');
    });
  });

  describe('3. Commercialization, Stripe Return URLs, W-9 Vendor Block & Legal Disclosures', () => {
    it('sets root-query Stripe success_url and cancel_url with #coach/roster hash', async () => {
      const created = await createTeamForCoach({
        callerSid: 'usr_billing_coach_1',
        originUrl: 'https://meetready.app',
        name: 'Bellarmine Billing URL Check',
        shortName: 'BCP',
        orgType: 'HIGH_SCHOOL',
        primarySport: 'Running',
        coachDisplayName: 'Coach Morales',
      });
      const teamId = created.brand.teamId;

      try {
        process.env.STRIPE_SECRET_KEY = 'sk_test_meetready_url_check';
        const capturedBodies: string[] = [];
        vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();
          if (url === 'https://api.stripe.com/v1/checkout/sessions') {
            capturedBodies.push(String(init?.body || ''));
            return new Response(
              JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/pay/cs_test_1' }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          throw new Error(`Unexpected fetch ${url}`);
        });

        const res = await createStripeCheckoutSession({
          callerSid: 'usr_billing_coach_1',
          teamId,
          originUrl: 'https://meetready.app/',
          planCode: 'HS_250',
        });

        expect(res.ok).toBe(true);
        expect(capturedBodies).toHaveLength(1);
        const capturedParams = new URLSearchParams(capturedBodies[0]);
        expect(capturedParams.get('success_url')).toBe(
          'https://meetready.app/?billing=success#coach/roster'
        );
        expect(capturedParams.get('cancel_url')).toBe(
          'https://meetready.app/?billing=cancelled#coach/roster'
        );
      } finally {
        await removeTeamFromDirectoryAndVault(teamId);
      }
    });

    it('renders Procurement & IRS W-9 Vendor Summary in PO HTML, billing modal links, and District rollup note', () => {
      const invoiceHtml = buildSchoolPoInvoicePrintHtml({
        invoice: {
          invoiceNumber: 'MR-PO-2026-4411',
          planCode: 'DISTRICT_2000',
          amountUsd: 2000,
          schoolOrDistrictName: 'San Jose Unified <District>',
          poNumber: 'PO-9910',
          billingContactEmail: 'ap@sjusd.edu',
          issuedAt: '2026-11-22T00:00:00.000Z',
          dueDate: '2026-12-22',
          status: 'ISSUED',
        },
        teamName: 'Oakridge High Track',
      });
      expect(invoiceHtml).toContain('Procurement &amp; IRS W-9 Vendor Summary');
      expect(invoiceHtml).toContain('MeetReady Athletics');
      expect(invoiceHtml).toContain('California SDPC NDPA');
      expect(invoiceHtml).toContain('San Jose Unified &lt;District&gt;');
      expect(invoiceHtml).not.toContain('San Jose Unified <District>');

      const billingHtml = renderToStaticMarkup(
        React.createElement(TeamBillingAndPoModal, {
          isOpen: true,
          onClose: () => {},
          activeTeam: makeSampleTeam('DISTRICT_2000'),
          myTeams: [makeSampleTeam('DISTRICT_2000')],
          onTeamsUpdated: () => {},
        })
      );
      expect(billingHtml).toContain('Open W-9 &amp; NDPA Pack ↗');
      expect(billingHtml).toContain('href="/procurement"');
      expect(billingHtml).toContain('data-testid="billing-district-rollup-note"');
      expect(billingHtml).toContain('Multi-School District Rollup Active');

      const modalSrc = fs.readFileSync(
        path.join(ROOT, 'src/components/coach/TeamBillingAndPoModal.tsx'),
        'utf8'
      );
      expect(modalSrc).toContain('SENT_RESEND');
      expect(modalSrc).toContain('READY_MANUAL_LINK');
      expect(modalSrc).toContain("emitFunnelEvent('po_generated'");
      expect(modalSrc).toContain("emitFunnelEvent('stripe_checkout_started'");

      const wizardSrc = fs.readFileSync(
        path.join(ROOT, 'src/components/coach/CoachOnboardingWizard.tsx'),
        'utf8'
      );
      expect(wizardSrc).toContain('$0 Founding Season Pilot · Students &amp; Parents Free Forever');
      expect(wizardSrc).toContain("emitFunnelEvent('team_created'");
    });

    it('updates procurement.html, privacy.html, subprocessors.html, for-athletic-directors.html & index.html JSON-LD', () => {
      const procurementHtml = fs.readFileSync(
        path.join(ROOT, 'public/legal/procurement.html'),
        'utf8'
      );
      expect(procurementHtml).not.toContain('$49/mo');
      expect(procurementHtml).not.toContain('Private Club');
      expect(procurementHtml).toContain('$250 / yr');
      expect(procurementHtml).toContain('onclick="window.print()"');
      expect(procurementHtml).toContain('Print Procurement Pack (PDF)');
      expect(procurementHtml).toContain('/api/analytics/event');
      expect(procurementHtml).toContain('landing_view');

      const privacyHtml = fs.readFileSync(path.join(ROOT, 'public/legal/privacy.html'), 'utf8');
      expect(privacyHtml).toContain('First-Party Anonymous Aggregate Conversion Counters');
      expect(privacyHtml).toContain('zero tracking cookies');
      expect(privacyHtml).toContain('zero IP address storage');
      expect(privacyHtml).toContain('minor/student accounts');

      const subprocessorsHtml = fs.readFileSync(
        path.join(ROOT, 'public/legal/subprocessors.html'),
        'utf8'
      );
      expect(subprocessorsHtml).toContain('First-Party Anonymous Conversion Counters');
      expect(subprocessorsHtml).toContain('zero cookies');
      expect(subprocessorsHtml).toContain('zero IP address storage');
      expect(subprocessorsHtml).toContain('minor/student accounts');

      const adHtml = fs.readFileSync(
        path.join(ROOT, 'public/for-athletic-directors.html'),
        'utf8'
      );
      expect(adHtml).toContain('Slate Dark');
      expect(adHtml).toContain('Asphalt Dark');
      expect(adHtml).toContain('Chalk Light');
      expect(adHtml).not.toContain('Midnight Slate');
      expect(adHtml).not.toContain('Daylight');
      expect(adHtml).toContain('/api/analytics/event');
      expect(adHtml).toContain('landing_view');

      const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
      const ldMatch = indexHtml.match(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/
      );
      expect(ldMatch).not.toBeNull();
      const ldJson = JSON.parse(ldMatch![1]) as {
        '@graph': Array<{ '@type': string; offers?: Array<{ price: string; priceCurrency: string }> }>;
      };
      const softwareApp = ldJson['@graph'].find((item) => item['@type'] === 'SoftwareApplication');
      const prices = softwareApp?.offers?.map((o) => o.price) || [];
      expect(prices).toEqual(['0', '250', '1200', '2000']);
    });
  });
});
