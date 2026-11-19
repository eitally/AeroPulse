import { expect, test, type Page } from '@playwright/test';

async function mockGoogleFonts(page: Page) {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '/* mock */' })
  );
  await page.route('https://fonts.gstatic.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
  );
}

async function signInViaDevMagicLink(page: Page, email: string) {
  const res = await page.request.post('/api/auth/magic-link/send', {
    data: { email },
  });
  expect(res.ok()).toBe(true);
  const payload = await res.json();
  expect(payload.previewUrl).toBeTruthy();
  const parsed = new URL(payload.previewUrl);
  await page.goto(`${parsed.pathname}${parsed.search}`);
  const confirmBtn = page.getByRole('button', { name: /Complete Sign-In to THRESH/i });
  await expect(confirmBtn).toBeVisible({ timeout: 10000 });
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/api/auth/magic-link/verify')),
    confirmBtn.click(),
  ]);

  const confirmStep2Btn = page.getByRole('button', { name: /Confirm & Continue/i });
  await expect(confirmStep2Btn).toBeVisible({ timeout: 15000 });
  await confirmStep2Btn.click();

  const enterWorkspaceBtn = page.getByRole('button', {
    name: /Skip for Now — Enter THRESH|Continue to THRESH/i,
  });
  await expect(enterWorkspaceBtn).toBeVisible({ timeout: 15000 });
  await enterWorkspaceBtn.click();
}

test.describe('Sprint 1C E2E: Demo Isolation, 0-Activity Persistence, Honest Trends & WebP Coach Guide (RT-17, RT-20, RT-21)', () => {
  test.beforeEach(async ({ page }) => {
    await mockGoogleFonts(page);
  });

  test('Desktop: preserves real stopwatch state when exiting Sample Demo, persists 0-activity planned workouts across reload, and shows honest empty state in Trends', async ({
    page,
  }) => {
    test.skip(Boolean(page.viewportSize() && page.viewportSize()!.width < 768), 'Desktop only');

    // 1. Sample Demo Exit strips ?demo=1 from URL, stays out across reload, and restores real stopwatch state
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('__seeded_real_sw_once')) {
        localStorage.setItem(
          'thresh_trackside_stopwatch_v1',
          JSON.stringify({
            isRunning: false,
            accumulatedMs: 43210,
            runStartedEpochMs: null,
            sessionType: 'WORKOUT',
            runners: [{ id: 'real-1', name: 'Real Saved Runner', pod: 'A', vdot: 55 }],
            athleteLapTimestampsSecs: {},
            runnerLastTapEpochMs: {},
          })
        );
        sessionStorage.setItem('__seeded_real_sw_once', '1');
      }
    });

    await page.goto('/?demo=1');
    const nav = page.locator('nav[aria-label="Primary workspaces"]');
    await expect(nav).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Exit Demo', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sign in or create account' })).toBeVisible({
      timeout: 15000,
    });
    expect(new URL(page.url()).searchParams.has('demo')).toBe(false);

    // Reload stays outside demo mode and real stopwatch entry survives
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sign in or create account' })).toBeVisible({
      timeout: 15000,
    });
    const preservedSw = await page.evaluate(() =>
      localStorage.getItem('thresh_trackside_stopwatch_v1')
    );
    expect(preservedSw).toContain('Real Saved Runner');

    // 2. 0-Activity user creates planned workout -> persists across reload & Trends shows honest empty state
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await signInViaDevMagicLink(page, `zeroact.${unique}@example.com`);
    await expect(nav).toBeVisible({ timeout: 15000 });

    // Schedule a planned workout with 0 activities synced
    await nav.getByRole('link', { name: 'Training Calendar' }).click();
    await page.getByRole('button', { name: 'Schedule', exact: true }).click();
    await page.getByLabel('Workout Title').fill('Zero-Activity Persistence Session');
    await page.getByRole('button', { name: 'Save to Calendar' }).click();
    await expect(
      page.locator(':text("Zero-Activity Persistence Session"):visible').first()
    ).toBeVisible({
      timeout: 10000,
    });

    // Reload page -> 0-activity planned session must survive IndexedDB & cloud reload
    await page.reload();
    await expect(nav).toBeVisible({ timeout: 15000 });
    await expect(
      page.locator(':text("Zero-Activity Persistence Session"):visible').first()
    ).toBeVisible({
      timeout: 10000,
    });

    // Navigate to Trends on 0-biometrics account -> honest empty state, never fake 51/310/52 baselines
    await nav.getByRole('link', { name: 'Progress' }).click();
    await page.goto('/#trends');
    await expect(page.getByTestId('standalone-progress-view')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('trends-empty-state')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('51.0 mL/kg/min')).toHaveCount(0);
    await expect(page.getByText('310 W')).toHaveCount(0);
    await expect(page.getByText('52 ms')).toHaveCount(0);
  });

  test('Coach Guide WebP figures load with non-zero dimensions on /docs/coach.html', async ({
    page,
  }) => {
    await page.goto('/docs/coach.html');
    const imgs = page.locator('figure.doc-figure img');
    const count = await imgs.count();
    expect(count).toBe(7);
    for (let i = 0; i < count; i++) {
      const img = imgs.nth(i);
      await img.scrollIntoViewIfNeeded();
      await expect
        .poll(async () =>
          img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 100)
        )
        .toBe(true);
    }
  });
});
