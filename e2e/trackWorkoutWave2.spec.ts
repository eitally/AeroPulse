import { expect, Page, test } from '@playwright/test';

async function enterSampleDemoMode(page: Page, hash = '') {
  await page.goto(`/?demo=1${hash}`);
  if (hash === '#stopwatch') {
    await expect(page.getByRole('heading', { name: 'Trackside Stopwatch' })).toBeVisible({
      timeout: 15000,
    });
    return;
  }
  const cockpitNav = page.locator('nav[aria-label*="rimary workspaces"]:visible');
  await expect(cockpitNav).toBeVisible({ timeout: 15000 });
}

async function toggleDarkMode(page: Page, enableDark: boolean) {
  const isCurrentlyDark = await page.evaluate(() =>
    document.documentElement.classList.contains('dark')
  );
  if (isCurrentlyDark !== enableDark) {
    const themeBtn = page
      .locator(
        'button[aria-label*="Switch to Dark Mode"], button[aria-label*="Switch to Light Mode"]'
      )
      .first();
    const canClick = await themeBtn.isVisible().catch(() => false);
    if (canClick) {
      await themeBtn.click();
    } else {
      await page.evaluate((dark) => {
        if (dark) {
          document.documentElement.classList.add('dark');
          localStorage.setItem('thresh_theme_dark', '1');
        } else {
          document.documentElement.classList.remove('dark');
          localStorage.setItem('thresh_theme_dark', '0');
        }
      }, enableDark);
    }
    if (enableDark) {
      await expect(page.locator('html')).toHaveClass(/dark/);
    } else {
      await expect(page.locator('html')).not.toHaveClass(/dark/);
    }
    await page.waitForTimeout(300);
  }
}

test.describe('THRESH Wave 2 Track Physics, Safety & Morphing E2E (TRK-05..07, TRK-12)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '/* mock */' })
    );
    await page.route('https://fonts.gstatic.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
    );
  });

  test.describe('Desktop Viewport (1440x900)', () => {
    test.skip(({ isMobile }) => isMobile, 'Desktop only');

    test('TRK-05 Stopwatch Oval Lane 4 + Hadley >180 Heat Abort Gate & TRK-06/07/12 Today Workspace', async ({
      page,
    }) => {
      // 1. Trackside Stopwatch Environmental & Lane Physics
      await enterSampleDemoMode(page, '#stopwatch');
      await page.evaluate(() => localStorage.removeItem('thresh_trackside_stopwatch_v1'));
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Trackside Stopwatch' })).toBeVisible({
        timeout: 15000,
      });

      await page.getByTestId('stopwatch-toggle-env-physics').click();
      const envPanel = page.getByTestId('stopwatch-env-physics-panel');
      await expect(envPanel).toBeVisible();

      await page.getByTestId('stopwatch-lane-select').selectOption('4');
      await expect(envPanel).toContainText('422.37m/lap');

      await page.getByTestId('stopwatch-temp-input').fill('98');
      await page.getByTestId('stopwatch-dew-input').fill('85');

      const heatAbortBanner = page.getByTestId('stopwatch-heat-abort-banner');
      await expect(heatAbortBanner).toBeVisible();
      await expect(heatAbortBanner).toContainText('Hadley Index 183');

      await expect(page.locator('html')).not.toHaveClass(/dark/);
      await page.screenshot({
        path: 'test-results/screenshots/trk-wave2-stopwatch-1440-light.png',
        fullPage: false,
        animations: 'disabled',
      });
      await toggleDarkMode(page, true);
      await page.screenshot({
        path: 'test-results/screenshots/trk-wave2-stopwatch-1440-dark.png',
        fullPage: false,
        animations: 'disabled',
      });
      await toggleDarkMode(page, false);

      // 2. Today Workspace -> Running ReadinessMorphingCard + Ortho Spike Tile + PHV & Safe-Sport Watch
      await enterSampleDemoMode(page);
      const customizeBtn = page.getByRole('button', { name: /Customize & Export/i }).first();
      await expect(customizeBtn).toBeVisible({ timeout: 15000 });
      await customizeBtn.click();

      const morphCard = page
        .locator('section')
        .filter({ has: page.getByTestId('readiness-mode-auto') })
        .first();
      await expect(morphCard).toBeVisible({ timeout: 10000 });

      await morphCard.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(page.getByTestId('readiness-spike-trigger')).toBeVisible();
      await expect(page.getByTestId('readiness-mode-bone_stress_stop')).toBeVisible();

      const morphRunningText = await morphCard.innerText();
      expect(morphRunningText).toMatch(/Ln rMSSD/i);
      expect(morphRunningText).not.toMatch(/%\s*FTP/i);

      await page.getByTestId('readiness-mode-bone_stress_stop').click();
      await expect(morphCard).toContainText('Deep-Water Aqua Jog');
      expect(await morphCard.innerText()).not.toMatch(/%\s*FTP/i);

      // 3. Fitness & Health Drawers: Spiked-Meter Budget + PHV Selectors + Safe-Sport Watch
      const spikeBudgetTile = page.getByTestId('ortho-spike-budget-tile');
      if (!(await spikeBudgetTile.isVisible())) {
        await page.getByRole('button', { name: /Impact & Run\/Bike Load/i }).click();
      }
      await expect(spikeBudgetTile).toBeVisible();
      await expect(spikeBudgetTile).toContainText(/Spiked-Meter & Curve Budget/i);

      await page.getByRole('button', { name: /Soreness & Cross-Training/i }).click();
      await expect(page.getByTestId('phv-knee-select')).toBeVisible();
      await expect(page.getByTestId('phv-heel-select')).toBeVisible();
      const safeSportCard = page.getByTestId('safesport-pattern-watch-card');
      await expect(safeSportCard).toBeVisible();
      await expect(safeSportCard).toContainText(/Zero-Weight/i);

      await page.screenshot({
        path: 'test-results/screenshots/trk-wave2-today-1440-light.png',
        fullPage: false,
        animations: 'disabled',
      });
      await toggleDarkMode(page, true);
      await page.screenshot({
        path: 'test-results/screenshots/trk-wave2-today-1440-dark.png',
        fullPage: false,
        animations: 'disabled',
      });
      await toggleDarkMode(page, false);

      await page.evaluate(() => localStorage.removeItem('thresh_trackside_stopwatch_v1'));
    });
  });

  test.describe('Mobile Viewport (390x844)', () => {
    test.skip(({ isMobile }) => !isMobile, 'Mobile only');

    test('TRK-05..07 & TRK-12 Mobile: >= 44px touch targets & Wave 2 responsive flows', async ({
      page,
    }) => {
      await enterSampleDemoMode(page, '#stopwatch');
      await page.evaluate(() => localStorage.removeItem('thresh_trackside_stopwatch_v1'));
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Trackside Stopwatch' })).toBeVisible({
        timeout: 15000,
      });

      const toggleEnvBtn = page.getByTestId('stopwatch-toggle-env-physics');
      await expect(toggleEnvBtn).toBeVisible();
      expect((await toggleEnvBtn.boundingBox())?.height || 0).toBeGreaterThanOrEqual(44);
      await toggleEnvBtn.click();

      for (const testId of [
        'stopwatch-lane-select',
        'stopwatch-temp-input',
        'stopwatch-footwear-select',
      ]) {
        const el = page.getByTestId(testId);
        await expect(el).toBeVisible();
        await el.scrollIntoViewIfNeeded();
        expect((await el.boundingBox())?.height || 0).toBeGreaterThanOrEqual(44);
      }

      await page.getByTestId('stopwatch-lane-select').selectOption('4');
      await expect(page.getByTestId('stopwatch-env-physics-panel')).toContainText('422.37m/lap');

      // Navigate to Today and check ReadinessMorphingCard + PHV controls >= 44px
      await enterSampleDemoMode(page);
      const customizeBtn = page.getByRole('button', { name: /Customize & Export/i }).first();
      await expect(customizeBtn).toBeVisible({ timeout: 15000 });
      await customizeBtn.scrollIntoViewIfNeeded();
      await customizeBtn.click();

      const morphCard = page
        .locator('section')
        .filter({ has: page.getByTestId('readiness-mode-auto') })
        .first();
      await morphCard.getByRole('button', { name: 'Run', exact: true }).click();

      const boneStopBtn = page.getByTestId('readiness-mode-bone_stress_stop');
      await boneStopBtn.scrollIntoViewIfNeeded();
      expect((await boneStopBtn.boundingBox())?.height || 0).toBeGreaterThanOrEqual(44);

      const sorenessPill = page.getByRole('button', { name: /Soreness & Cross-Training/i });
      await sorenessPill.scrollIntoViewIfNeeded();
      await sorenessPill.click();
      const phvKneeSelect = page.getByTestId('phv-knee-select');
      await phvKneeSelect.scrollIntoViewIfNeeded();
      expect((await phvKneeSelect.boundingBox())?.height || 0).toBeGreaterThanOrEqual(44);

      await page.evaluate(() => localStorage.removeItem('thresh_trackside_stopwatch_v1'));
    });
  });
});
