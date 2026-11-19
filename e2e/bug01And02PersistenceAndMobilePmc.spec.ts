import fs from 'fs';
import path from 'path';
import { expect, test, type Page } from '@playwright/test';

const EVIDENCE_DIR =
  process.env.THRESH_EVIDENCE_DIR ||
  path.join(process.cwd(), 'test-results', 'bug01_02_evidence');

async function setupStravaPersistenceMocksAndSeed(
  page: Page,
  seed: {
    activity: Record<string, any>;
    snapshotMeta: Record<string, any>;
  }
): Promise<string[]> {
  const syncUrls: string[] = [];

  await page.route('**/api/config/status**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        vaultStorageBackend: 'ENCRYPTED_FILE',
        stravaConfigured: true,
        stravaConnected: true,
        stravaAthleteId: '777888',
        stravaAthleteName: 'Eli Runner',
        stravaSource: 'OAUTH',
        stravaGrantedScope: 'read,activity:read_all,profile:read_all',
        stravaSyncPolicy: {
          window: '90d',
          importProfileAndGear: true,
          confirmedAt: '2026-11-15T12:00:00.000Z',
        },
        stravaTokens: {
          accessToken: 'fresh_e2e_access_v2',
          refreshToken: 'fresh_e2e_refresh_v2',
          expiresAt: Math.floor(Date.now() / 1000) + 21600,
          athleteId: '777888',
          athleteName: 'Eli Runner',
        },
        sessionToken: 'e2e_session_tok',
        callbackUrl: 'http://127.0.0.1:4173/auth/strava/callback',
        mapTileProvider: 'OSM_KEYLESS',
        mapTileApiKeyConfigured: false,
      }),
    });
  });

  await page.route('**/api/auth/me**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: false, user: null }),
    });
  });

  await page.route('**/api/teams/my-teams**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ teams: [] }),
    });
  });

  await page.route('**/api/strava/sync**', async (route) => {
    syncUrls.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        athleteId: '777888',
        athleteName: 'Eli Runner',
        activities: [],
        starredSegments: [],
        gearItems: [],
      }),
    });
  });

  // Seed browser IndexedDB (Dexie `this.version(1)` -> native IndexedDB version 10) + localStorage sync policy
  await page.goto('/?demo=1');
  await page.evaluate(async ({ activity, snapshotMeta }) => {
    localStorage.removeItem('thresh_sample_demo_active');
    localStorage.setItem('aeropulse_logged_out', '0');
    localStorage.setItem('aeropulse_auth_gate_passed', '1');
    localStorage.setItem('aeropulse_strava_athlete_id', '777888');
    localStorage.setItem('aeropulse_store_owner_athlete_id', '777888');
    localStorage.setItem('aeropulse_strava_athlete_name', 'Eli Runner');
    localStorage.setItem(
      'aeropulse_strava_sync_policy',
      JSON.stringify({
        window: '90d',
        importProfileAndGear: true,
        confirmedAt: '2026-11-15T12:00:00.000Z',
      })
    );

    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('AeroPulseWorkoutStoreDB', 10);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('activities')) {
          const actStore = db.createObjectStore('activities', { keyPath: 'id' });
          actStore.createIndex('start_date', 'start_date', { unique: false });
        }
        if (!db.objectStoreNames.contains('activityStreams')) {
          db.createObjectStore('activityStreams', { keyPath: 'activityId' });
        }
        if (!db.objectStoreNames.contains('wellnessDays')) {
          const wStore = db.createObjectStore('wellnessDays', { keyPath: 'date' });
          wStore.createIndex('date', 'date', { unique: false });
        }
        if (!db.objectStoreNames.contains('plannedEvents')) {
          const pStore = db.createObjectStore('plannedEvents', { keyPath: 'id' });
          pStore.createIndex('date', 'date', { unique: false });
        }
        if (!db.objectStoreNames.contains('gearItems')) {
          db.createObjectStore('gearItems', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['activities', 'metadata'], 'readwrite');
        tx.objectStore('activities').put(activity);
        tx.objectStore('metadata').put({ key: 'snapshot_meta', value: snapshotMeta });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, seed);

  return syncUrls;
}

test.describe('BUG-01 & BUG-02: Strava Deployment Persistence & Mobile Portrait/Landscape PMC', () => {
  test('BUG-01: restores Strava auth, preserves IndexedDB workouts & triggers incremental delta sync across reload', async ({
    page,
  }) => {
    const syncUrls = await setupStravaPersistenceMocksAndSeed(page, {
      activity: {
        id: 'strava-99887766',
        stravaId: '99887766',
        start_date: '2026-11-14T15:00:00.000Z',
        startDateLocal: '2026-11-14T08:00:00',
        name: 'Seeded Track Repeats (IndexedDB)',
        sportCategory: 'Running',
        environment: 'OUTDOOR',
        subType: 'Road',
        movingTimeSecs: 2700,
        distanceMeters: 9600,
        elevationGainMeters: 42,
        intensityFactor: 0.92,
        trainingLoad: 74,
        loadModelVersion: 4,
        avgHr: 162,
        maxHr: 184,
        avgPaceSecsPerKm: 281,
        aerobicDecouplingPct: 2.1,
        efficiencyFactor: 1.5,
        firstHalfEf: 1.52,
        secondHalfEf: 1.49,
        zoneSecs: { hr: [0, 0, 0, 0, 0, 0, 0] },
        sourceBadges: ['Strava'],
      },
      snapshotMeta: {
        savedAt: '2026-11-14T16:00:00.000Z',
        pmcModelVersion: 4,
        ownerAthleteId: '777888',
      },
    });

    // Reload non-demo workspace URL
    await page.goto('/#fitness');
    await expect(page.getByText('Fitness, Fatigue & Freshness')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Connect with Strava')).toHaveCount(0);

    // Assert rotated tokens from /api/config/status were persisted into localStorage
    const persistedRefresh = await page.evaluate(() =>
      localStorage.getItem('aeropulse_strava_refresh_token')
    );
    expect(persistedRefresh).toBe('fresh_e2e_refresh_v2');

    // Assert incremental delta sync was issued with afterEpoch rather than re-pulling full history
    await expect.poll(() => syncUrls.length, { timeout: 8000 }).toBeGreaterThan(0);
    expect(syncUrls[0]).toContain('deltaOnly=true');
    expect(syncUrls[0]).toContain('afterEpoch=');
  });

  test('BUG-01b: self-heals legacy v1 IndexedDB snapshot via one-time full backfill, then resumes deltaOnly=true on next reload', async ({
    page,
  }) => {
    const syncUrls = await setupStravaPersistenceMocksAndSeed(page, {
      activity: {
        id: 'strava-99887766',
        stravaId: '99887766',
        start_date: '2026-11-14T15:00:00.000Z',
        startDateLocal: '2026-11-14T08:00:00',
        name: 'Casual Cruiser Ride (Inflated v1)',
        sportCategory: 'Cycling',
        environment: 'OUTDOOR',
        subType: 'Road',
        movingTimeSecs: 2400,
        distanceMeters: 14000,
        elevationGainMeters: 50,
        avgPower: 118,
        normalizedPower: 118,
        trainingLoad: 185,
        avgHr: 116,
        maxHr: 132,
        aerobicDecouplingPct: 0,
        efficiencyFactor: 1.0,
        firstHalfEf: 0,
        secondHalfEf: 0,
        zoneSecs: { hr: [0, 0, 0, 0, 0, 0, 0] },
        sourceBadges: ['Strava'],
      },
      // Legacy v1 snapshot_meta without pmcModelVersion
      snapshotMeta: { savedAt: '2026-11-14T16:00:00.000Z', ownerAthleteId: '777888' },
    });

    await page.goto('/#fitness');
    await expect(page.getByText('Fitness, Fatigue & Freshness')).toBeVisible({ timeout: 10000 });
    await expect.poll(() => syncUrls.length, { timeout: 8000 }).toBeGreaterThanOrEqual(1);
    expect(syncUrls[0]).not.toContain('deltaOnly=true');

    // Verify activity load was self-healed in IndexedDB (< 35 instead of 185) and pmcModelVersion is 2
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            return await new Promise<{ trainingLoad?: number; pmcModelVersion?: number }>((resolve, reject) => {
              const req = indexedDB.open('AeroPulseWorkoutStoreDB');
              req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction(['activities', 'metadata'], 'readonly');
                let trainingLoad: number | undefined;
                let pmcModelVersion: number | undefined;
                tx.objectStore('activities').get('strava-99887766').onsuccess = (e: any) => {
                  trainingLoad = e.target?.result?.trainingLoad;
                };
                tx.objectStore('metadata').get('snapshot_meta').onsuccess = (e: any) => {
                  pmcModelVersion = e.target?.result?.value?.pmcModelVersion;
                };
                tx.oncomplete = () => {
                  db.close();
                  resolve({ trainingLoad, pmcModelVersion });
                };
                tx.onerror = () => {
                  db.close();
                  reject(tx.error);
                };
              };
              req.onerror = () => reject(req.error);
            });
          }),
        { timeout: 8000 }
      )
      .toMatchObject({ pmcModelVersion: 4 });

    const healedAct = await page.evaluate(async () => {
      return await new Promise<number | undefined>((resolve, reject) => {
        const req = indexedDB.open('AeroPulseWorkoutStoreDB');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['activities'], 'readonly');
          tx.objectStore('activities').get('strava-99887766').onsuccess = (e: any) => {
            db.close();
            resolve(e.target?.result?.trainingLoad);
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
        req.onerror = () => reject(req.error);
      });
    });
    expect(healedAct).toBeLessThan(35);

    // Reload again -> should resume incremental deltaOnly=true!
    await page.reload();
    await expect.poll(() => syncUrls.length, { timeout: 8000 }).toBeGreaterThanOrEqual(2);
    expect(syncUrls[syncUrls.length - 1]).toContain('deltaOnly=true');
    expect(syncUrls[syncUrls.length - 1]).toContain('afterEpoch=');
  });

  test('BUG-02: maximizes mobile PMC chart plot width in portrait (390x844) & landscape (844x390) across 7d/42d/90d', async ({
    page,
  }) => {
    test.skip(test.info().project.name.includes('desktop'), 'Mobile PMC viewport check');
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    // Start in mobile portrait 390x844 (dark mode)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?demo=1#fitness');
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
      localStorage.setItem('thresh_theme_dark', '1');
    });

    const wrapper = page.getByTestId('pmc-uplot-wrapper');
    await wrapper.scrollIntoViewIfNeeded();
    await expect(wrapper).toBeVisible({ timeout: 10000 });

    // Verify no horizontal overflow on 390px phone
    const docOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(docOverflow).toBeLessThanOrEqual(0);

    // Wait for uPlot to populate exact plot metrics
    await expect
      .poll(async () => Number((await wrapper.getAttribute('data-plot-width')) || '0'))
      .toBeGreaterThanOrEqual(290);

    const canvasWidthPortrait = Number((await wrapper.getAttribute('data-canvas-width')) || '0');
    const plotWidthPortrait = Number((await wrapper.getAttribute('data-plot-width')) || '0');
    expect(canvasWidthPortrait).toBeGreaterThanOrEqual(330);
    expect(plotWidthPortrait).toBeGreaterThanOrEqual(295);

    // Compact inline readout bar should be visible on mobile (no giant floating tooltip)
    await expect(page.getByTestId('pmc-mobile-inline-readout')).toBeVisible();

    // All chart control toggles must stay >= 44px tall on mobile
    for (const label of ['Load Bars', 'Ramp', 'eFTP']) {
      const box = await page.getByRole('button', { name: label, exact: true }).boundingBox();
      expect(box?.height || 0).toBeGreaterThanOrEqual(44);
    }

    // Switch through 7d, 42d, and 90d cleanly
    for (const preset of ['7d', '90d', '42d']) {
      await page.getByRole('button', { name: preset, exact: true }).click();
      await expect
        .poll(async () => Number((await wrapper.getAttribute('data-plot-width')) || '0'))
        .toBeGreaterThanOrEqual(295);
    }

    // Center wrapper vertically away from bottom MobileDock before screenshot
    await wrapper.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(100);
    await wrapper.screenshot({
      path: path.join(EVIDENCE_DIR, 'pmc-mobile-portrait-390-dark.png'),
    });

    // Verify light mode portrait legibility
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('thresh_theme_dark', '0');
    });
    await page.waitForTimeout(150);
    await wrapper.screenshot({
      path: path.join(EVIDENCE_DIR, 'pmc-mobile-portrait-390-light.png'),
    });

    // Rotate phone horizontally to Landscape (844x390)
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
      localStorage.setItem('thresh_theme_dark', '1');
    });
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(250);
    await wrapper.evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await page.waitForTimeout(150);

    await expect
      .poll(async () => Number((await wrapper.getAttribute('data-plot-width')) || '0'))
      .toBeGreaterThanOrEqual(710);

    const landscapeCanvasHeights = await wrapper.evaluate((el) =>
      Array.from(el.querySelectorAll('canvas')).map((c) => Math.round(c.getBoundingClientRect().height))
    );
    expect(landscapeCanvasHeights.length).toBeGreaterThanOrEqual(2);
    // Compact combined Pane 1 + Pane 2 fits cleanly on 390px vertical phone landscape
    expect((landscapeCanvasHeights[0] || 0) + (landscapeCanvasHeights[1] || 0)).toBeLessThanOrEqual(
      275
    );

    await wrapper.screenshot({
      path: path.join(EVIDENCE_DIR, 'pmc-mobile-landscape-844x390-dark.png'),
    });
  });
});
