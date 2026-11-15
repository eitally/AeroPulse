import { expect, Page, test } from '@playwright/test';

async function enterSampleDemoMode(page: Page, hash = '') {
  await page.goto(`/?demo=1${hash}`);
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

test.describe('THRESH Wave 1 Adaptive Track Engine E2E (TRK-01..04)', () => {
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

    test('TRK-01..04: Goals Track Architect -> 4:05 Mile R split -> Populate Calendar -> Launch Stopwatch', async ({
      page,
    }) => {
      await enterSampleDemoMode(page, '#totals');

      // Select Track Oval category & 1500m / Mile Track Architect
      await page.getByRole('button', { name: 'Track Oval', exact: true }).click();
      await page.getByRole('button', { name: /1500m \/ Mile Track Architect/i }).click();

      const reservePanel = page.getByTestId('track-speed-reserve-panel');
      await expect(reservePanel).toBeVisible();

      // Seed 4:05 Mile and verify un-clamped ~60-62s 400m R split (not 1:15 / 75s)
      const seedInput = page.getByTestId('track-seed-input');
      await seedInput.fill('4:05');

      const rZoneRow = page.getByTestId('track-zone-row-R');
      await expect(rZoneRow).toBeVisible();
      await expect(rZoneRow.locator('td').nth(3)).toHaveText(/^(5[89]\.\d|6[0-3]\.\d)s$/);
      const rRowText = (await rZoneRow.textContent()) || '';
      expect(rRowText).not.toContain('75.0s');
      expect(rRowText).not.toContain('1:15');

      // Capture Light & Dark Track Architect before calendar jump
      await expect(page.locator('html')).not.toHaveClass(/dark/);
      await page.screenshot({
        path: 'test-results/screenshots/trk-wave1-desktop-1440-light.png',
        fullPage: false,
        animations: 'disabled',
      });
      await toggleDarkMode(page, true);
      await page.screenshot({
        path: 'test-results/screenshots/trk-wave1-desktop-1440-dark.png',
        fullPage: false,
        animations: 'disabled',
      });
      await toggleDarkMode(page, false);

      // Populate multi-week track block onto Training Calendar and jump to Calendar
      await page.getByRole('button', { name: /Populate \d+-Week Block to Calendar/i }).click();
      const viewCalBtn = page.getByRole('button', { name: /View on Calendar/i });
      await expect(viewCalBtn).toBeVisible();
      await viewCalBtn.click();

      // Click first visible planned "Time on Track" button inside Calendar
      const calLaunchBtn = page.locator('[data-testid="calendar-launch-stopwatch"]:visible').first();
      await expect(calLaunchBtn).toBeVisible({ timeout: 15000 });
      await calLaunchBtn.scrollIntoViewIfNeeded();
      await calLaunchBtn.click();

      // Assert Trackside Stopwatch opens in WORKOUT mode with 'custom-plan' preset
      await expect(page.getByRole('heading', { name: 'Trackside Stopwatch' })).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByTestId('stopwatch-mode-workout')).toHaveAttribute(
        'aria-checked',
        'true'
      );
      await expect(page.getByLabel('Workout Preset')).toHaveValue('custom-plan');

      await page.evaluate(() => {
        localStorage.removeItem('thresh_trackside_stopwatch_v1');
        localStorage.removeItem('aeropulse_planned_events_v1');
      });
    });
  });

  test.describe('Mobile Viewport (390x844)', () => {
    test.skip(({ isMobile }) => !isMobile, 'Mobile only');

    test('TRK-01..04 Mobile: 44px touch targets & closed-loop Track -> Calendar -> Stopwatch', async ({
      page,
    }) => {
      await enterSampleDemoMode(page, '#totals');

      await page.getByRole('button', { name: 'Track Oval', exact: true }).click();
      await page.getByRole('button', { name: /1500m \/ Mile Track Architect/i }).click();

      const seedInput = page.getByTestId('track-seed-input');
      await expect(seedInput).toBeVisible();
      await seedInput.fill('4:05');

      const seedBox = await seedInput.boundingBox();
      expect(seedBox?.height || 0).toBeGreaterThanOrEqual(44);

      const goalsLaunchBtn = page.locator('[data-testid="goals-launch-stopwatch"]:visible').first();
      await expect(goalsLaunchBtn).toBeVisible();
      await goalsLaunchBtn.scrollIntoViewIfNeeded();
      const goalsLaunchBox = await goalsLaunchBtn.boundingBox();
      expect(goalsLaunchBox?.height || 0).toBeGreaterThanOrEqual(44);

      await page.getByRole('button', { name: /Populate \d+-Week Block to Calendar/i }).click();
      const viewCalBtn = page.getByRole('button', { name: /View on Calendar/i });
      await expect(viewCalBtn).toBeVisible();
      await viewCalBtn.click();

      const calLaunchBtn = page.locator('[data-testid="calendar-launch-stopwatch"]:visible').first();
      await expect(calLaunchBtn).toBeVisible({ timeout: 15000 });
      await calLaunchBtn.scrollIntoViewIfNeeded();
      const calLaunchBox = await calLaunchBtn.boundingBox();
      expect(calLaunchBox?.height || 0).toBeGreaterThanOrEqual(44);
      expect(await page.locator('#main-content').innerText()).not.toMatch(/\d+\.\d{3,}m/);

      await page.screenshot({
        path: 'test-results/screenshots/trk-wave1-mobile-390-light.png',
        fullPage: false,
        animations: 'disabled',
      });

      await calLaunchBtn.click();

      await expect(page.getByRole('heading', { name: 'Trackside Stopwatch' })).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByTestId('stopwatch-mode-workout')).toHaveAttribute(
        'aria-checked',
        'true'
      );
      await expect(page.getByLabel('Workout Preset')).toHaveValue('custom-plan');

      await page.evaluate(() => {
        localStorage.removeItem('thresh_trackside_stopwatch_v1');
        localStorage.removeItem('aeropulse_planned_events_v1');
      });
    });
  });
});
