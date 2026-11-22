import { expect, Page, test } from '@playwright/test';

const SAMPLE_CYCLING_WORKOUT_TOKEN = (() => {
  const payload = {
    kind: 'WORKOUT',
    version: 1,
    title: 'Sweet Spot & Threshold Progression',
    sport: 'Cycling',
    date: '2026-11-22',
    workoutSyntax:
      '- 10m 60% FTP Warmup\n- 4x5m 100% FTP Threshold\n- 10m 55% FTP Cooldown',
    description: 'Shared PLG-01 test session',
    referenceFtpWatts: 250,
    defaultUnit: 'mi',
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
})();

async function toggleDarkMode(page: Page, enableDark: boolean) {
  const isDark = await page.evaluate(() =>
    document.documentElement.classList.contains('dark')
  );
  if (isDark !== enableDark) {
    await page.getByTestId('share-theme-toggle').click();
    if (enableDark) {
      await expect(page.locator('html')).toHaveClass(/dark/);
    } else {
      await expect(page.locator('html')).not.toHaveClass(/dark/);
    }
  }
}

test.describe('PLG-01: Zero-Auth /share/workout Preview, Live Threshold Recalc & OAuth Calendar Stash', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '/* mock */' })
    );
    await page.route('https://fonts.gstatic.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
    );
  });

  test('renders zero-auth split preview, recalculates live FTP in Light/Dark mode, and imports across login into Demo Calendar (Desktop 1440px)', async ({
    page,
  }) => {
    test.skip(Boolean(page.viewportSize() && page.viewportSize()!.width < 768), 'Desktop flow');

    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto(`/share/workout?w=${encodeURIComponent(SAMPLE_CYCLING_WORKOUT_TOKEN)}`);

    const hero = page.getByTestId('share-workout-hero');
    await expect(hero).toBeVisible({ timeout: 15000 });
    await expect(hero).toContainText('Sweet Spot & Threshold Progression');

    // Verify default 250W threshold calculation
    await expect(page.getByTestId('share-steps-list')).toContainText('250 W (100% FTP)');

    // Dynamically adjust FTP to 300W -> live split recalculation
    const ftpInput = page.getByTestId('share-ftp-input');
    await ftpInput.fill('300');
    await expect(page.getByTestId('share-steps-list')).toContainText('300 W (100% FTP)');

    // Switch to Dark Mode and verify layout stability + button touch target dimensions
    await toggleDarkMode(page, true);
    const addBtnBox = await page.getByTestId('share-add-to-calendar-btn').boundingBox();
    expect(addBtnBox?.height).toBeGreaterThanOrEqual(44);
    await toggleDarkMode(page, false);

    // Logged-out CTA stashes workout and shows banner on Auth Gate
    await page.getByTestId('share-add-to-calendar-btn').click();
    const banner = page.getByTestId('pending-shared-workout-banner');
    await expect(banner).toBeVisible({ timeout: 15000 });
    await expect(banner).toContainText('Sweet Spot & Threshold Progression');

    // Entering Demo Cockpit automatically consumes stashed workout onto Training Calendar
    await page.getByTestId('try-athlete-sample-btn').click();
    const calendarNav = page.locator('nav[aria-label*="rimary workspaces"]:visible');
    await expect(calendarNav).toBeVisible({ timeout: 15000 });
    await expect(page.locator('main')).toContainText('Sweet Spot & Threshold Progression', {
      timeout: 15000,
    });

    expect(consoleErrors).toEqual([]);
  });

  test('renders mobile /share/workout viewport (390x844) with >=44px touch targets and zero horizontal overflow', async ({
    page,
  }) => {
    test.skip(Boolean(page.viewportSize() && page.viewportSize()!.width >= 768), 'Mobile only');

    await page.goto(`/share/workout?w=${encodeURIComponent(SAMPLE_CYCLING_WORKOUT_TOKEN)}`);
    await expect(page.getByTestId('share-workout-hero')).toBeVisible({ timeout: 15000 });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow).toBeLessThanOrEqual(2);

    const pngBox = await page.getByTestId('share-download-png-btn').boundingBox();
    expect(pngBox?.height).toBeGreaterThanOrEqual(44);
  });
});
