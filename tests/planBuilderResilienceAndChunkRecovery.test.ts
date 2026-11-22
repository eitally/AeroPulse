import fs from 'fs';
import path from 'path';
import type { Request } from 'express';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoalsView } from '../src/components/GoalsView';
import { WorkspaceErrorBoundary } from '../src/components/WorkspaceErrorBoundary';
import {
  CANONICAL_THRESH_ORIGIN,
  canonicalizeThreshUrl,
  consumeRestoredTabAfterChunkReload,
  installVitePreloadErrorRecovery,
  isDynamicChunkLoadError,
  purgeStaleRuntimeChunkCaches,
  resetVitePreloadErrorListenerForTesting,
  resolveLazyModuleWithRetry,
  sanitizePersistedAnnualGoals,
  sanitizePersistedTargetGoals,
  triggerChunkSkewReload,
} from '../src/utils/lazyWithRetry';
import { INITIAL_ANNUAL_MILEAGE_GOALS } from '../src/data/mockTelemetry';
import { buildCompleteAthleteProfile } from '../src/utils/telemetryStorage';
import type { TargetGoal, UnifiedActivity } from '../src/types';
import {
  resolveIntervalsCallbackUrl,
  resolveStravaCallbackUrl,
} from '../server/oauthHelpers.ts';

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

function makeMockBrowserWindow(initialHref = 'https://thresh-dev.vercel.app/#calendar') {
  const url = new URL(initialHref);
  const sessionStore = new Map<string, string>();
  const listeners = new Map<string, EventListener[]>();
  const deletedCaches: string[] = [];
  const unregisterSpy = vi.fn().mockResolvedValue(true);
  const updateSpy = vi.fn().mockResolvedValue(undefined);
  const replaceSpy = vi.fn();
  const reloadSpy = vi.fn();

  const mockWindow = {
    location: {
      origin: url.origin,
      hostname: url.hostname,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      href: url.toString(),
      replace: replaceSpy,
      reload: reloadSpy,
    },
    sessionStorage: {
      getItem: (k: string) => (sessionStore.has(k) ? sessionStore.get(k)! : null),
      setItem: (k: string, v: string) => {
        sessionStore.set(k, String(v));
      },
      removeItem: (k: string) => {
        sessionStore.delete(k);
      },
    },
    caches: {
      delete: vi.fn(async (name: string) => {
        deletedCaches.push(name);
        return true;
      }),
    },
    addEventListener: vi.fn((type: string, cb: EventListener) => {
      const list = listeners.get(type) || [];
      list.push(cb);
      listeners.set(type, list);
    }),
    dispatchEvent: (event: Event) => {
      for (const cb of listeners.get(event.type) || []) {
        cb(event);
      }
      return true;
    },
    setTimeout: globalThis.setTimeout.bind(globalThis),
  };

  const mockNavigator = {
    serviceWorker: {
      getRegistrations: vi.fn(async () => [
        { unregister: unregisterSpy, update: updateSpy },
      ]),
    },
  };

  return {
    mockWindow,
    mockNavigator,
    deletedCaches,
    unregisterSpy,
    updateSpy,
    replaceSpy,
    reloadSpy,
    sessionStore,
  };
}

function makeMockRequest(opts: {
  origin?: string;
  host?: string;
  proto?: string;
}): Request {
  return {
    query: opts.origin ? { origin: opts.origin } : {},
    headers: {
      ...(opts.host ? { host: opts.host } : {}),
      ...(opts.proto ? { 'x-forwarded-proto': opts.proto } : {}),
    },
    protocol: opts.proto || 'https',
  } as unknown as Request;
}

describe('Plan Builder resilience, chunk-mismatch recovery & legacy origin elimination', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalEnv = { ...process.env };

  afterEach(() => {
    resetVitePreloadErrorListenerForTesting();
    vi.restoreAllMocks();
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', originalNavigator);
    }
    process.env = { ...originalEnv };
  });

  it('detects Vite/ESM dynamic chunk load errors without masking ordinary errors', () => {
    expect(
      isDynamicChunkLoadError(
        new TypeError('Failed to fetch dynamically imported module: https://thresh-dev.vercel.app/assets/GoalsView-OLD.js')
      )
    ).toBe(true);
    expect(isDynamicChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isDynamicChunkLoadError(new Error('Unable to preload CSS for /assets/GoalsView.css'))).toBe(true);
    expect(isDynamicChunkLoadError(new Error('ChunkLoadError: Loading chunk 12 failed'))).toBe(true);
    expect(isDynamicChunkLoadError(new TypeError('Cannot read properties of undefined'))).toBe(false);
  });

  it('canonicalizes legacy aeropulse-eta.vercel.app URLs to thresh-dev.vercel.app while keeping other origins unchanged', () => {
    expect(canonicalizeThreshUrl('https://aeropulse-eta.vercel.app/#plan-builder')).toBe(
      `${CANONICAL_THRESH_ORIGIN}/#plan-builder`
    );
    expect(canonicalizeThreshUrl('https://thresh-dev.vercel.app/?demo=1#totals')).toBe(
      'https://thresh-dev.vercel.app/?demo=1#totals'
    );
    expect(canonicalizeThreshUrl('http://localhost:3000/?demo=1#totals')).toBe(
      'http://localhost:3000/?demo=1#totals'
    );
  });

  it('retries a transient dynamic chunk failure in-place after purging stale SW caches without reloading', async () => {
    const env = makeMockBrowserWindow('https://thresh-dev.vercel.app/');
    (globalThis as { window: unknown }).window = env.mockWindow;
    Object.defineProperty(globalThis, 'navigator', {
      value: env.mockNavigator,
      configurable: true,
    });

    const DummyView: React.FC = () => React.createElement('div', null, 'Recovered');
    const importer = vi
      .fn<() => Promise<{ default: React.FC }>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module: GoalsView.js'))
      .mockResolvedValueOnce({ default: DummyView });

    const mod = await resolveLazyModuleWithRetry(importer, {
      chunkKey: 'GoalsView',
      restoreTab: 'totals',
    });

    expect(mod.default).toBe(DummyView);
    expect(importer).toHaveBeenCalledTimes(2);
    expect(env.deletedCaches).toContain('thresh-ui-assets-network-first-v3');
    expect(env.updateSpy).toHaveBeenCalledTimes(1);
    expect(env.replaceSpy).not.toHaveBeenCalled();
  });

  it('triggers a single cooldown-guarded reload preserving restoreTab=totals on stale deploy chunk mismatch and never redirects to aeropulse-eta', async () => {
    vi.useFakeTimers();
    const env = makeMockBrowserWindow('https://thresh-dev.vercel.app/#fitness');
    (globalThis as { window: unknown }).window = env.mockWindow;
    Object.defineProperty(globalThis, 'navigator', {
      value: env.mockNavigator,
      configurable: true,
    });

    const importer = vi
      .fn<() => Promise<{ default: React.FC }>>()
      .mockRejectedValue(new TypeError('Failed to fetch dynamically imported module: GoalsView-OLD.js'));

    const loadPromise = resolveLazyModuleWithRetry(importer, {
      chunkKey: 'GoalsView',
      restoreTab: 'totals',
    });

    // Advance microtasks + 250ms cache cleanup timeout
    await vi.advanceTimersByTimeAsync(300);

    expect(env.reloadSpy).toHaveBeenCalledTimes(1);
    expect(env.replaceSpy).not.toHaveBeenCalledWith(expect.stringContaining('aeropulse-eta'));
    expect(consumeRestoredTabAfterChunkReload()).toBe('totals');
    // Second read consumes and clears the restored tab
    expect(consumeRestoredTabAfterChunkReload()).toBeNull();

    // Cooldown guard prevents an infinite reload loop within 15s
    expect(triggerChunkSkewReload('GoalsView', 'totals')).toBe(false);

    // After 2s fallback timer, promise rejects cleanly rather than hanging forever
    const rejectionAssertion = expect(loadPromise).rejects.toThrow(
      'Failed to fetch dynamically imported module'
    );
    await vi.advanceTimersByTimeAsync(2000);
    await rejectionAssertion;
    vi.useRealTimers();
  });

  it('installs vite:preloadError recovery and canonicalizes legacy aeropulse-eta runtime tabs off the old domain', async () => {
    const legacyEnv = makeMockBrowserWindow('https://aeropulse-eta.vercel.app/#plan-builder');
    (globalThis as { window: unknown }).window = legacyEnv.mockWindow;
    Object.defineProperty(globalThis, 'navigator', {
      value: legacyEnv.mockNavigator,
      configurable: true,
    });

    installVitePreloadErrorRecovery();
    await purgeStaleRuntimeChunkCaches();
    expect(legacyEnv.unregisterSpy).toHaveBeenCalled();
    expect(legacyEnv.replaceSpy).toHaveBeenCalledWith(`${CANONICAL_THRESH_ORIGIN}/#plan-builder`);

    resetVitePreloadErrorListenerForTesting();
    const prodEnv = makeMockBrowserWindow('https://thresh-dev.vercel.app/');
    (globalThis as { window: unknown }).window = prodEnv.mockWindow;
    Object.defineProperty(globalThis, 'navigator', {
      value: prodEnv.mockNavigator,
      configurable: true,
    });

    installVitePreloadErrorRecovery();
    const preloadEvent = new Event('vite:preloadError', { cancelable: true });
    prodEnv.mockWindow.dispatchEvent(preloadEvent);
    expect(preloadEvent.defaultPrevented).toBe(true);
  });

  it('lets __vitePreload re-throw into resolveLazyModuleWithRetry so restoreTab=totals survives Vite 8 preloadError in production', async () => {
    vi.useFakeTimers();
    const prodEnv = makeMockBrowserWindow('https://thresh-dev.vercel.app/?demo=1');
    (globalThis as { window: unknown }).window = prodEnv.mockWindow;
    Object.defineProperty(globalThis, 'navigator', {
      value: prodEnv.mockNavigator,
      configurable: true,
    });

    installVitePreloadErrorRecovery();

    const observedEvents: boolean[] = [];
    const vite8PreloadWrappedImporter = vi.fn<() => Promise<{ default: React.FC }>>(async () => {
      const err = new TypeError('Failed to fetch dynamically imported module: /assets/GoalsView-OLD.js');
      const evt = new Event('vite:preloadError', { cancelable: true });
      prodEnv.mockWindow.dispatchEvent(evt);
      observedEvents.push(evt.defaultPrevented);
      if (!evt.defaultPrevented) {
        throw err;
      }
      return undefined as unknown as { default: React.FC };
    });

    const loadPromise = resolveLazyModuleWithRetry(vite8PreloadWrappedImporter, {
      chunkKey: 'GoalsView',
      restoreTab: 'totals',
    });

    await vi.advanceTimersByTimeAsync(300);

    expect(vite8PreloadWrappedImporter).toHaveBeenCalledTimes(2);
    expect(observedEvents).toEqual([false, false]);
    expect(prodEnv.replaceSpy).toHaveBeenCalledWith('https://thresh-dev.vercel.app/?demo=1');
    expect(consumeRestoredTabAfterChunkReload()).toBe('totals');

    const rejectionAssertion = expect(loadPromise).rejects.toThrow(
      'Failed to fetch dynamically imported module'
    );
    await vi.advanceTimersByTimeAsync(2000);
    await rejectionAssertion;
    vi.useRealTimers();
  });

  it('renders WorkspaceErrorBoundary recovery card instead of unmounting to a blank screen on uncaught render failures', () => {
    const derived = WorkspaceErrorBoundary.getDerivedStateFromError(
      new TypeError('Failed to fetch dynamically imported module')
    );
    expect(derived.error?.message).toContain('dynamically imported module');

    class BrokenBoundary extends WorkspaceErrorBoundary {
      state = {
        error: new Error('Failed to fetch dynamically imported module: GoalsView.js'),
      };
    }

    const html = renderToStaticMarkup(
      React.createElement(
        BrokenBoundary,
        {
          restoreTab: 'totals',
          fallbackTitle: 'Plan Builder Recovery',
          children: React.createElement('div', null, 'child'),
        },
        React.createElement('div', null, 'child')
      )
    );
    expect(html).toContain('data-testid="workspace-error-boundary"');
    expect(html).toContain('Plan Builder Recovery');
    expect(html).toContain('Retry View');
    expect(html).toContain('Reload Latest Build');
  });

  it('renders GoalsView cleanly with multi-sport activities and malformed legacy localStorage goal records', () => {
    const sanitizedGoals: TargetGoal[] = sanitizePersistedTargetGoals([
      { id: 'goal-1', title: 'Legacy Seed To Drop' },
      { id: 'custom-1', title: '', sportCategory: 'HIKING_LEGACY', targetDate: 'bad-date' },
      null,
    ]);
    const sanitizedAnnual = sanitizePersistedAnnualGoals(
      [{ sportCategory: 'Running' }],
      INITIAL_ANNUAL_MILEAGE_GOALS
    );

    expect(sanitizedGoals).toHaveLength(1);
    expect(sanitizedGoals[0]?.title).toBe('Performance Goal');
    expect(sanitizedGoals[0]?.sportCategory).toBe('Running');
    expect(sanitizedAnnual[0]?.targetDistanceMeters).toBe(1_931_213);

    const multiSportActs: UnifiedActivity[] = [
      {
        id: 'hike-1',
        startDateLocal: '2026-11-10T09:00:00',
        name: 'Ridge Hike',
        sportCategory: 'Multisport',
        environment: 'OUTDOOR',
        subType: 'Hiking',
        movingTimeSecs: 5400,
        distanceMeters: 9200,
        elevationGainMeters: 480,
        trainingLoad: 64,
        avgHr: 128,
        maxHr: 156,
        aerobicDecouplingPct: 1.9,
        efficiencyFactor: 1.32,
        firstHalfEf: 1.33,
        secondHalfEf: 1.3,
        zoneSecs: { hr: [1800, 2900, 600, 100, 0, 0, 0] },
        stravaPrCount: 0,
        segmentEfforts: [],
        sourceBadges: ['Strava'],
      },
      {
        id: 'lift-1',
        startDateLocal: '2026-11-12T17:15:00',
        name: 'Posterior Chain Lift',
        sportCategory: 'Strength',
        environment: 'INDOOR',
        subType: 'Gym',
        movingTimeSecs: 2700,
        distanceMeters: 0,
        elevationGainMeters: 0,
        trainingLoad: 38,
        avgHr: 112,
        maxHr: 141,
        aerobicDecouplingPct: 0,
        efficiencyFactor: 0,
        firstHalfEf: 0,
        secondHalfEf: 0,
        zoneSecs: { hr: [1600, 900, 200, 0, 0, 0, 0] },
        stravaPrCount: 0,
        segmentEfforts: [],
        sourceBadges: ['Strava'],
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(GoalsView, {
        annualMileageGoals: sanitizedAnnual,
        onUpdateAnnualMileageGoal: () => undefined,
        targetGoals: sanitizedGoals,
        onAddTargetGoal: () => undefined,
        onDeleteTargetGoal: () => undefined,
        activities: multiSportActs,
        wellnessDays: [],
        plannedEvents: [],
        athleteProfile: buildCompleteAthleteProfile({ primarySport: 'Hybrid' }),
        envFilter: 'COMBINED',
        onSelectEnvFilter: () => undefined,
        distanceUnit: 'mi',
        currentCtl: 54,
      })
    );

    expect(html).toContain('Plan Builder');
    expect(html).not.toContain('NaNd out');
    expect(html).not.toContain('aeropulse-eta.vercel.app');
  });

  it('awaits SW unregistration & cache purge in index.html and canonicalizes OAuth callback helpers away from aeropulse-eta', () => {
    const html = readSrc('index.html');
    expect(html).toContain('Promise.race([Promise.all(cleanupTasks), timeoutFallback]).finally');
    expect(html).toContain("window.location.replace(targetUrl)");

    const routerSrc = readSrc('src/components/WorkspaceRouter.tsx');
    expect(routerSrc).toContain('lazyWithRetry');
    expect(routerSrc).toContain("restoreTab: 'totals'");
    expect(routerSrc).toContain('<WorkspaceErrorBoundary');

    process.env.STRAVA_REDIRECT_URI = 'https://aeropulse-eta.vercel.app/auth/strava/callback';
    process.env.INTERVALS_REDIRECT_URI = 'https://aeropulse-eta.vercel.app/auth/intervals/callback';
    expect(resolveStravaCallbackUrl(makeMockRequest({}))).toBe(
      'https://meetready.app/auth/strava/callback'
    );
    expect(resolveIntervalsCallbackUrl(makeMockRequest({}))).toBe(
      'https://meetready.app/auth/intervals/callback'
    );

    delete process.env.STRAVA_REDIRECT_URI;
    delete process.env.INTERVALS_REDIRECT_URI;
    process.env.APP_URL = 'https://aeropulse-eta.vercel.app';
    expect(
      resolveStravaCallbackUrl(makeMockRequest({ origin: 'https://aeropulse-eta.vercel.app' }))
    ).toBe('https://meetready.app/auth/strava/callback');
    expect(resolveIntervalsCallbackUrl(makeMockRequest({}))).toBe(
      'https://meetready.app/auth/intervals/callback'
    );
  });
});
