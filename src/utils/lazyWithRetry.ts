import React, { lazy } from 'react';
import type { ActiveTab, AnnualMileageGoal, SportCategory, TargetGoal } from '../types';

export const CANONICAL_THRESH_ORIGIN = 'https://thresh-dev.vercel.app';
export const LEGACY_AEROPULSE_HOST = 'aeropulse-eta.vercel.app';

const CHUNK_RELOAD_GUARD_STORAGE_KEY = 'thresh_chunk_reload_guard_v1';
const RESTORE_TAB_STORAGE_KEY = 'thresh_restore_tab_v1';
const CHUNK_RELOAD_COOLDOWN_MS = 15_000;
const STALE_SW_UI_CACHES = ['thresh-ui-assets-network-first-v3', 'aeropulse-ui-assets-swr'] as const;

const VALID_ACTIVE_TABS: readonly ActiveTab[] = [
  'calendar',
  'fitness',
  'trends',
  'charts',
  'activities',
  'curves',
  'totals',
  'stopwatch',
  'coach',
];

const VALID_SPORT_CATEGORIES: readonly SportCategory[] = [
  'Cycling',
  'Running',
  'Swimming',
  'Strength',
  'Multisport',
];

let preloadListenerInstalled = false;
let activeLazyImportDepth = 0;
let latestRequestedTab: ActiveTab | undefined;

/**
 * Rewrites legacy aeropulse-eta.vercel.app URLs to the canonical THRESH production origin
 * while leaving all other origins (localhost, previews, thresh-dev.vercel.app) untouched.
 */
export function canonicalizeThreshUrl(rawUrl: string): string {
  const input = String(rawUrl || '').trim();
  if (!input) return CANONICAL_THRESH_ORIGIN;
  try {
    const parsed = new URL(input);
    if (parsed.hostname.toLowerCase() === LEGACY_AEROPULSE_HOST) {
      return `${CANONICAL_THRESH_ORIGIN}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.toString();
  } catch {
    return input.replace(
      new RegExp(`^https?:\\/\\/${LEGACY_AEROPULSE_HOST.replace(/\./g, '\\.')}`, 'i'),
      CANONICAL_THRESH_ORIGIN
    );
  }
}

/**
 * Identifies Vite / ES module dynamic-import / CSS preload failures triggered when a
 * running client tab requests a superseded hashed chunk after a fresh deployment.
 */
export function isDynamicChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name?: unknown }).name || '')
      : '';
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message?: unknown }).message || '')
          : '';
  const combined = `${name} ${message}`.toLowerCase();
  return (
    combined.includes('failed to fetch dynamically imported module') ||
    combined.includes('importing a module script failed') ||
    combined.includes('error loading dynamically imported module') ||
    combined.includes('unable to preload css') ||
    combined.includes('chunkloaderror') ||
    combined.includes('dynamically imported module')
  );
}

/**
 * Deletes stale Service Worker UI/chunk caches and requests an SW update (or unregisters
 * completely if somehow executing on legacy aeropulse-eta.vercel.app). Never throws.
 */
export async function purgeStaleRuntimeChunkCaches(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const tasks: Promise<unknown>[] = [];

  if ('caches' in window && window.caches) {
    for (const cacheName of STALE_SW_UI_CACHES) {
      tasks.push(window.caches.delete(cacheName).catch(() => false));
    }
  }

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker) {
    const isLegacyHost = window.location?.hostname === LEGACY_AEROPULSE_HOST;
    tasks.push(
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) =>
          Promise.all(
            regs.map((reg) =>
              (isLegacyHost ? reg.unregister() : reg.update()).catch(() => undefined)
            )
          )
        )
        .catch(() => undefined)
    );
  }

  await Promise.all(tasks);
}

function getCurrentBrowserTargetUrl(): string {
  if (typeof window === 'undefined') return CANONICAL_THRESH_ORIGIN;
  const raw = `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`;
  return canonicalizeThreshUrl(raw);
}

/**
 * Performs a single cooldown-guarded reload on chunk mismatch while preserving the target
 * workspace tab (e.g. 'totals' for Plan Builder) and canonicalizing away from aeropulse-eta.
 */
export function triggerChunkSkewReload(chunkKey: string, restoreTab?: ActiveTab): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const now = Date.now();
  const safeKey = String(chunkKey || 'default');

  try {
    let guardMap: Record<string, number> = {};
    const existingRaw = window.sessionStorage?.getItem(CHUNK_RELOAD_GUARD_STORAGE_KEY);
    if (existingRaw) {
      const parsed = JSON.parse(existingRaw);
      if (parsed && typeof parsed === 'object') {
        guardMap = parsed as Record<string, number>;
      }
    }
    const lastAttemptAt = Number(guardMap[safeKey] || 0);
    if (Number.isFinite(lastAttemptAt) && now - lastAttemptAt < CHUNK_RELOAD_COOLDOWN_MS) {
      return false;
    }
    guardMap[safeKey] = now;
    window.sessionStorage?.setItem(CHUNK_RELOAD_GUARD_STORAGE_KEY, JSON.stringify(guardMap));
    if (restoreTab && VALID_ACTIVE_TABS.includes(restoreTab)) {
      window.sessionStorage?.setItem(RESTORE_TAB_STORAGE_KEY, restoreTab);
    }
  } catch {
    // Proceed even if sessionStorage is restricted in private browsing
  }

  const targetUrl = getCurrentBrowserTargetUrl();
  const cacheTimeout = new Promise<void>((resolve) => {
    window.setTimeout(resolve, 250);
  });

  void Promise.race([purgeStaleRuntimeChunkCaches(), cacheTimeout]).finally(() => {
    try {
      if (targetUrl === window.location.href && Boolean(window.location.hash)) {
        window.location.reload();
      } else {
        window.location.replace(targetUrl);
      }
    } catch {
      window.location.reload();
    }
  });

  return true;
}

/**
 * Reads and clears any workspace tab saved right before an automatic chunk-skew reload.
 */
export function consumeRestoredTabAfterChunkReload(): ActiveTab | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage?.getItem(RESTORE_TAB_STORAGE_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(RESTORE_TAB_STORAGE_KEY);
    return VALID_ACTIVE_TABS.includes(raw as ActiveTab) ? (raw as ActiveTab) : null;
  } catch {
    return null;
  }
}

export interface LazyWithRetryOptions {
  chunkKey: string;
  restoreTab?: ActiveTab;
}

type LazyReactComponent =
  Parameters<typeof lazy>[0] extends () => Promise<{ default: infer C }> ? C : never;

/**
 * Resolves a dynamic module importer with a single cache-busted in-place retry and
 * cooldown-guarded seamless reload on deploy chunk skew.
 */
export async function resolveLazyModuleWithRetry<T extends LazyReactComponent>(
  importer: () => Promise<{ default: T }>,
  options: LazyWithRetryOptions
): Promise<{ default: T }> {
  if (options.restoreTab) {
    latestRequestedTab = options.restoreTab;
  }

  let reloadTriggered = false;
  let retryFailure: unknown;
  activeLazyImportDepth += 1;
  try {
    try {
      return await importer();
    } catch (firstError) {
      if (!isDynamicChunkLoadError(firstError)) {
        throw firstError;
      }

      await purgeStaleRuntimeChunkCaches();

      try {
        return await importer();
      } catch (retryError) {
        if (!isDynamicChunkLoadError(retryError)) {
          throw retryError;
        }
        retryFailure = retryError;
        reloadTriggered = triggerChunkSkewReload(options.chunkKey, options.restoreTab);
        if (!reloadTriggered) {
          throw retryError;
        }
      }
    }
  } finally {
    activeLazyImportDepth = Math.max(0, activeLazyImportDepth - 1);
  }

  return await new Promise<{ default: T }>((_resolve, reject) => {
    const timer = typeof setTimeout === 'function' ? setTimeout : null;
    if (timer) {
      timer(() => reject(retryFailure), 2000);
    }
  });
}

/**
 * Wraps React.lazy dynamic imports with chunk-skew retry and recovery.
 */
export function lazyWithRetry<T extends LazyReactComponent>(
  importer: () => Promise<{ default: T }>,
  options: LazyWithRetryOptions
): React.LazyExoticComponent<T> {
  return lazy(() => resolveLazyModuleWithRetry(importer, options));
}

export function resetVitePreloadErrorListenerForTesting(): void {
  preloadListenerInstalled = false;
  activeLazyImportDepth = 0;
  latestRequestedTab = undefined;
}

/**
 * Attaches Vite's official `vite:preloadError` recovery listener and enforces canonical
 * migration off legacy `aeropulse-eta.vercel.app` if ever encountered at runtime.
 */
export function installVitePreloadErrorRecovery(): void {
  if (typeof window === 'undefined') return;

  if (window.location?.hostname === LEGACY_AEROPULSE_HOST) {
    const targetUrl = canonicalizeThreshUrl(
      `${CANONICAL_THRESH_ORIGIN}${window.location.pathname}${window.location.search}${window.location.hash}`
    );
    void purgeStaleRuntimeChunkCaches().finally(() => {
      try {
        window.location.replace(targetUrl);
      } catch {
        // ignore in mocked environments
      }
    });
    return;
  }

  if (preloadListenerInstalled) return;
  preloadListenerInstalled = true;

  window.addEventListener('vite:preloadError', (event: Event) => {
    if (activeLazyImportDepth > 0) {
      // Allow Vite's __vitePreload to re-throw directly into resolveLazyModuleWithRetry
      // so in-place retry and restoreTab ('totals') preservation run deterministically.
      return;
    }
    event.preventDefault();
    triggerChunkSkewReload('vite-preload', latestRequestedTab);
  });
}

function normalizeSportCategory(raw: unknown): SportCategory {
  return VALID_SPORT_CATEGORIES.includes(raw as SportCategory)
    ? (raw as SportCategory)
    : 'Running';
}

function normalizePriority(raw: unknown): TargetGoal['priority'] {
  if (raw === 'A-Race' || raw === 'B-Race' || raw === 'Milestone') {
    return raw;
  }
  return 'A-Race';
}

function normalizeGoalType(raw: unknown): TargetGoal['type'] {
  if (raw === 'RACE_EVENT' || raw === 'PERFORMANCE_METRIC' || raw === 'SEGMENT_TARGET') {
    return raw;
  }
  return 'RACE_EVENT';
}

/**
 * Sanitizes persisted localStorage target goals so legacy or malformed records can never
 * crash GoalsView or produce NaN phase/timeline calculations.
 */
export function sanitizePersistedTargetGoals(raw: unknown): TargetGoal[] {
  if (!Array.isArray(raw)) return [];
  const todayIso = new Date().toISOString().slice(0, 10);

  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .filter((item) => item.id !== 'goal-1' && item.id !== 'goal-2' && item.id !== 'goal-3')
    .map((item, idx) => {
      const id =
        typeof item.id === 'string' && item.id.trim()
          ? item.id.trim()
          : `goal-recovered-${idx}`;
      const title =
        typeof item.title === 'string' && item.title.trim()
          ? item.title.trim()
          : 'Performance Goal';
      const targetDate =
        typeof item.targetDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(item.targetDate)
          ? item.targetDate.slice(0, 10)
          : todayIso;
      const currentValue = Number(item.currentValue);
      const targetValue = Number(item.targetValue);
      const targetCtl = item.targetCtl !== undefined ? Number(item.targetCtl) : undefined;

      return {
        id,
        title,
        type: normalizeGoalType(item.type),
        sportCategory: normalizeSportCategory(item.sportCategory),
        targetDate,
        priority: normalizePriority(item.priority),
        ...(targetCtl !== undefined && Number.isFinite(targetCtl) ? { targetCtl } : {}),
        currentValue: Number.isFinite(currentValue) ? currentValue : 0,
        targetValue: Number.isFinite(targetValue) ? targetValue : 0,
        unit: typeof item.unit === 'string' && item.unit.trim() ? item.unit.trim() : 's/km',
        notes: typeof item.notes === 'string' ? item.notes : '',
      };
    });
}

/**
 * Sanitizes persisted localStorage annual mileage goals and falls back safely on corruption.
 */
export function sanitizePersistedAnnualGoals(
  raw: unknown,
  fallback: AnnualMileageGoal[]
): AnnualMileageGoal[] {
  if (!Array.isArray(raw) || raw.length === 0) return fallback;
  const fallbackYear = fallback[0]?.year || new Date().getFullYear();

  const cleaned: AnnualMileageGoal[] = raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => {
      const sportCategory: 'Running' | 'Cycling' =
        item.sportCategory === 'Cycling' ? 'Cycling' : 'Running';
      const yearNum = Number(item.year);
      const metersNum = Number(item.targetDistanceMeters);
      return {
        sportCategory,
        year: Number.isFinite(yearNum) && yearNum > 2000 ? Math.round(yearNum) : fallbackYear,
        targetDistanceMeters:
          Number.isFinite(metersNum) && metersNum >= 0
            ? metersNum
            : sportCategory === 'Cycling'
              ? 8_046_720
              : 1_931_213,
      };
    });

  return cleaned.length > 0 ? cleaned : fallback;
}
