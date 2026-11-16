import { test, expect, Page } from '@playwright/test';

/**
 * Enters Sample Demo mode deterministically via ?demo=1 query parameter.
 * Guarantees zero auth gate redirection, zero client-side hydration races,
 * and immediate mounting of the core Cockpit workspace.
 */
async function enterSampleDemoMode(page: Page, hash = '') {
  await page.goto(`/?demo=1${hash}`);

  // Guarantee Cockpit workspace navigation is fully visible and interactive
  const cockpitNav = page.locator('nav[aria-label*="rimary workspaces"]:visible');
  await expect(cockpitNav).toBeVisible({ timeout: 15000 });
}

/**
 * Toggles dark mode reliably by clicking the accessible theme toggle button,
 * ensuring React state, ECharts canvas themes, and document classList update cleanly.
 */
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
    await page.waitForTimeout(350);
  }
}

test.describe('THRESH Core Screens Visual & E2E Net (QA-01)', () => {
  test.beforeEach(async ({ page }) => {
    // Prevent external Google Font network stalls from blocking headless screenshots in CI
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '/* mock */' })
    );
    await page.route('https://fonts.gstatic.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
    );
  });

  test.describe('Desktop Viewport (1440x900)', () => {
    test.skip(({ isMobile }) => isMobile, 'Desktop only');

    test('1. Today Screen — Light and Dark Mode', async ({ page }) => {
      await enterSampleDemoMode(page);

      // Verify Today screen elements
      await expect(page.locator('#main-content')).toBeVisible();

      // Verify DES-02 Desktop 3-column bento order: Load Focus (col 1-5) sits to the left of Morning Readiness (col 6-8)
      const loadFocusTooltip = page.getByRole('button', { name: /7-Day Rolling Training Productivity/i });
      const readinessHeading = page.getByRole('heading', { name: 'Morning Readiness' });
      await expect(readinessHeading).toBeVisible();
      const loadFocusBox = await loadFocusTooltip.boundingBox();
      const readinessBox = await readinessHeading.boundingBox();
      if (loadFocusBox && readinessBox) {
        expect(loadFocusBox.x).toBeLessThan(readinessBox.x);
      }

      // Light mode capture
      await expect(page.locator('html')).not.toHaveClass(/dark/);
      await page.screenshot({
        path: 'test-results/screenshots/today-desktop-1440-light.png',
        fullPage: false,
        animations: 'disabled',
      });

      // Toggle Dark mode cleanly
      await toggleDarkMode(page, true);

      // Dark mode capture
      await page.screenshot({
        path: 'test-results/screenshots/today-desktop-1440-dark.png',
        fullPage: false,
        animations: 'disabled',
      });
      await toggleDarkMode(page, false);
    });

    test('1b. PMC Interactive Dashboard (uPlot) — Light and Dark Mode', async ({ page }) => {
      await enterSampleDemoMode(page);

      // Verify PMC dashboard controls (Load Bars, Ramp, eFTP) are mounted
      const loadBarsBtn = page.getByRole('button', { name: 'Load Bars', exact: true });
      await expect(loadBarsBtn).toBeVisible({ timeout: 15000 });
      const rampBtn = page.getByRole('button', { name: 'Ramp', exact: true });
      await expect(rampBtn).toBeVisible();
      const eftpBtn = page.getByRole('button', { name: 'eFTP', exact: true });
      await expect(eftpBtn).toBeVisible();

      // Verify uPlot canvas elements exist
      const uplotCanvases = page.locator('.uplot canvas');
      await expect(uplotCanvases.first()).toBeVisible({ timeout: 10000 });

      // Light mode capture of PMC
      await page.screenshot({
        path: 'test-results/screenshots/pmc-desktop-1440-light.png',
        fullPage: false,
        animations: 'disabled',
      });

      // Toggle dark mode
      await toggleDarkMode(page, true);
      await page.screenshot({
        path: 'test-results/screenshots/pmc-desktop-1440-dark.png',
        fullPage: false,
        animations: 'disabled',
      });
      await toggleDarkMode(page, false);
    });

    test('2. Plan Screen — Light and Dark Mode', async ({ page }) => {
      await enterSampleDemoMode(page, '#calendar');

      // DES-03: Verify consolidated toolbar has <= 4 control groups and exactly one solid Volt CTA (+ Schedule)
      const scheduleBtn = page.getByRole('button', { name: 'Schedule', exact: true });
      await expect(scheduleBtn).toBeVisible({ timeout: 15000 });
      await expect(scheduleBtn).toHaveClass(/ap-btn-primary/);

      const actionsBtn = page.getByRole('button', { name: 'Actions', exact: true });
      await expect(actionsBtn).toBeVisible();

      // Open Actions dropdown to verify secondary actions (AI Review & Log Race)
      await actionsBtn.click();
      const aiReviewItem = page.getByRole('menuitem', { name: /AI Calendar Review/ });
      await expect(aiReviewItem).toBeVisible();
      await actionsBtn.click(); // Close Actions dropdown

      const viewBtn = page.getByRole('button', { name: 'View', exact: true });
      await expect(viewBtn).toBeVisible();

      await expect(page.locator('html')).not.toHaveClass(/dark/);
      await page.screenshot({
        path: 'test-results/screenshots/plan-desktop-1440-light.png',
        fullPage: false,
        animations: 'disabled',
      });

      // Switch to dark mode
      await toggleDarkMode(page, true);
      await page.screenshot({
        path: 'test-results/screenshots/plan-desktop-1440-dark.png',
        fullPage: false,
        animations: 'disabled',
      });
      await toggleDarkMode(page, false);
    });

    test('3. Coach Workspace Mode & Account Roster Access — Light and Dark Mode', async ({ page }) => {
      await enterSampleDemoMode(page);
      await page.waitForTimeout(400);

      // Enter dedicated Coach Workspace Mode via header toggle
      const coachToggle = page.getByTestId('toggle-coach-workspace');
      await expect(coachToggle).toBeVisible({ timeout: 10000 });
      await coachToggle.click();

      const coachView = page.getByTestId('coach-workspace-view');
      await expect(coachView).toBeVisible({ timeout: 15000 });

      const nav = page.locator('nav[aria-label="Primary workspaces"]');
      for (const label of ['Clipboard', 'Team Plan', 'Stopwatch', 'Roster']) {
        await expect(nav.getByRole('button', { name: label })).toBeVisible();
      }

      // Light mode capture
      await page.screenshot({
        path: 'test-results/screenshots/roster-modal-desktop-1440-light.png',
        fullPage: false,
        animations: 'disabled',
      });

      // Switch to Dark Mode
      await toggleDarkMode(page, true);
      await expect(coachView).toBeVisible();
      await page.waitForTimeout(300);

      // Dark mode capture for Coach Workspace
      await page.screenshot({
        path: 'test-results/screenshots/roster-modal-desktop-1440-dark.png',
        fullPage: false,
        animations: 'disabled',
      });

      await toggleDarkMode(page, false);

      // Return to personal Athlete Mode and verify 4-tab Athlete Nav
      await coachToggle.click();
      await expect(coachView).not.toBeVisible();
      for (const label of ['Today', 'Plan', 'Log', 'Lab']) {
        await expect(nav.getByRole('link', { name: label })).toBeVisible();
      }
    });

    test('3b. Trackside Stopwatch Workspace & Offline Airplane-Mode Resilience (FEA-01)', async ({ page, context }) => {
      await enterSampleDemoMode(page, '#stopwatch');
      await page.evaluate(() => localStorage.removeItem('thresh_trackside_stopwatch_v1'));
      await page.reload();

      const heading = page.getByRole('heading', { name: 'Trackside Stopwatch' });
      await expect(heading).toBeVisible({ timeout: 15000 });

      // Add 2 walk-on athletes and record sample splits for clean Light & Dark captures
      const walkOnInput = page.getByLabel('Walk-On Runner Name');
      await walkOnInput.fill('Jordan Miles');
      await page.getByRole('button', { name: 'Add Runner' }).click();
      await walkOnInput.fill('Maya Chen');
      await page.getByRole('button', { name: 'Add Runner' }).click();

      await page.getByTestId('stopwatch-gun-btn').click();
      await page.waitForTimeout(350);
      await page.getByTestId('runner-card-0').click();
      await page.waitForTimeout(150);
      await page.getByTestId('runner-card-1').click();

      await expect(page.locator('html')).not.toHaveClass(/dark/);
      await page.screenshot({
        path: 'test-results/screenshots/stopwatch-desktop-1440-light.png',
        fullPage: false,
        animations: 'disabled',
      });

      await toggleDarkMode(page, true);
      await page.screenshot({
        path: 'test-results/screenshots/stopwatch-desktop-1440-dark.png',
        fullPage: false,
        animations: 'disabled',
      });
      await toggleDarkMode(page, false);

      // Clear state and verify Airplane-Mode workflow via 4-tab Athlete Nav (Today -> Log -> Time Session while Offline)
      await page.evaluate(() => localStorage.removeItem('thresh_trackside_stopwatch_v1'));
      await enterSampleDemoMode(page);
      const desktopNav = page.locator('nav[aria-label="Primary workspaces"]');
      for (const label of ['Today', 'Plan', 'Log', 'Lab']) {
        await expect(desktopNav.getByRole('link', { name: label })).toBeVisible();
      }
      await expect(desktopNav.getByRole('link', { name: 'Stopwatch' })).toHaveCount(0);
      await page.waitForTimeout(1300);

      await context.setOffline(true);
      try {
        await desktopNav.getByRole('link', { name: 'Log' }).click();
        const openStopwatchBtn = page.getByTestId('log-open-stopwatch-btn');
        await expect(openStopwatchBtn).toBeVisible({ timeout: 10000 });
        await openStopwatchBtn.click();
        await expect(page.getByRole('heading', { name: 'Trackside Stopwatch' })).toBeVisible({
          timeout: 10000,
        });
        await expect(page.getByText(/Offline/i).first()).toBeVisible();

        // Switch to RACE mode (auto-enables Chute Bar), start gun, queue 2 Chute Taps, assign #1
        await page.getByTestId('stopwatch-mode-race').click();
        await expect(page.getByTestId('stopwatch-mode-race')).toHaveAttribute('aria-checked', 'true');

        await page.getByTestId('stopwatch-gun-btn').click();
        await page.waitForTimeout(300);
        await page.getByTestId('stopwatch-chute-tap').click();
        await page.waitForTimeout(150);
        await page.getByTestId('stopwatch-chute-tap').click();
        await expect(page.getByTestId('chute-pill-0')).toBeVisible();
        await expect(page.getByTestId('chute-pill-1')).toBeVisible();

        await page.getByTestId('runner-card-0').click();
        await expect(page.getByTestId('chute-pill-1')).not.toBeVisible();

        // Switch to Matrix view & export CSV while STILL offline
        await page.getByTestId('stopwatch-view-matrix').click();
        await expect(page.getByTestId('stopwatch-matrix-table')).toBeVisible();

        const [download] = await Promise.all([
          page.waitForEvent('download'),
          page.getByTestId('stopwatch-export-csv').click(),
        ]);
        expect(download.suggestedFilename()).toMatch(/^thresh-stopwatch-race-.*\.csv$/);
      } finally {
        await context.setOffline(false);
      }

      // Verify full persistence after reload and 1-click Save Official Race Marks into THRESH
      await page.goto('/?demo=1#stopwatch');
      await expect(page.getByTestId('stopwatch-mode-race')).toHaveAttribute('aria-checked', 'true', {
        timeout: 15000,
      });
      await expect(page.getByTestId('stopwatch-save-thresh')).toBeEnabled();
      await page.getByTestId('stopwatch-save-thresh').click();
      await expect(page.getByText(/Saved .* Official Race/i)).toBeVisible();

      await page.evaluate(() => localStorage.removeItem('thresh_trackside_stopwatch_v1'));
    });
  });

  test.describe('Mobile Viewport (390x844)', () => {
    test.skip(({ isMobile }) => !isMobile, 'Mobile only');

    test('4. Today Screen (Mobile 390) — Light and Dark Mode', async ({ page }) => {
      await enterSampleDemoMode(page);

      // Verify mobile header & today content
      await expect(page.locator('#main-content')).toBeVisible();

      // Verify DES-02 Mobile layout: Morning Readiness sits above Load Focus and is in viewport without scrolling
      const readinessHeading = page.getByRole('heading', { name: 'Morning Readiness' });
      await expect(readinessHeading).toBeInViewport();
      const loadFocusTooltip = page.getByRole('button', { name: /7-Day Rolling Training Productivity/i });
      const readinessBox = await readinessHeading.boundingBox();
      const loadFocusBox = await loadFocusTooltip.boundingBox();
      if (readinessBox && loadFocusBox) {
        expect(readinessBox.y).toBeLessThan(loadFocusBox.y);
      }

      // Mobile Light mode capture
      await page.screenshot({
        path: 'test-results/screenshots/today-mobile-390-light.png',
        fullPage: false,
        animations: 'disabled',
      });

      // Toggle Dark mode cleanly
      await toggleDarkMode(page, true);
      await page.screenshot({
        path: 'test-results/screenshots/today-mobile-390-dark.png',
        fullPage: false,
        animations: 'disabled',
      });
      await toggleDarkMode(page, false);
    });

    test('4b. PMC Interactive Dashboard (Mobile 390) — Light and Dark Mode', async ({ page }) => {
      await enterSampleDemoMode(page);

      // Verify PMC dashboard controls are mounted on mobile
      const loadBarsBtn = page.getByRole('button', { name: 'Load Bars', exact: true });
      await expect(loadBarsBtn).toBeVisible({ timeout: 15000 });
      const rampBtn = page.getByRole('button', { name: 'Ramp', exact: true });
      await expect(rampBtn).toBeVisible();

      // Mobile PMC light capture
      await page.screenshot({
        path: 'test-results/screenshots/pmc-mobile-390-light.png',
        fullPage: false,
        animations: 'disabled',
      });

      // Mobile PMC dark capture
      await toggleDarkMode(page, true);
      await page.screenshot({
        path: 'test-results/screenshots/pmc-mobile-390-dark.png',
        fullPage: false,
        animations: 'disabled',
      });
      await toggleDarkMode(page, false);
    });

    test('5. Plan Screen (Mobile 390) — Light and Dark Mode', async ({ page }) => {
      await enterSampleDemoMode(page, '#calendar');

      // Ensure calendar is mounted and schedule button is visible
      const scheduleBtn = page.getByRole('button', { name: 'Schedule', exact: true });
      await expect(scheduleBtn).toBeVisible({ timeout: 15000 });

      // Mobile Plan capture
      await page.screenshot({
        path: 'test-results/screenshots/plan-mobile-390-light.png',
        fullPage: false,
        animations: 'disabled',
      });

      // Dark mode Mobile Plan capture
      await toggleDarkMode(page, true);
      await page.screenshot({
        path: 'test-results/screenshots/plan-mobile-390-dark.png',
        fullPage: false,
        animations: 'disabled',
      });
      await toggleDarkMode(page, false);
    });

    test('5b. Trackside Stopwatch Workspace (Mobile 390) — Light and Dark Mode', async ({ page }) => {
      await enterSampleDemoMode(page, '#stopwatch');
      await page.evaluate(() => localStorage.removeItem('thresh_trackside_stopwatch_v1'));
      await page.reload();

      await expect(page.getByRole('heading', { name: 'Trackside Stopwatch' })).toBeVisible({
        timeout: 15000,
      });

      // Verify 4-tab Athlete MobileDock switches cleanly to 4-tab Coach MobileDock and back
      const mobileDock = page.locator('nav[aria-label="Mobile primary workspaces"]');
      for (const label of ['Today', 'Plan', 'Log', 'Lab']) {
        await expect(mobileDock.getByRole('button', { name: label })).toBeVisible();
      }
      await expect(mobileDock.getByRole('button', { name: 'Log' })).toHaveAttribute('aria-current', 'page');

      await page.getByTestId('toggle-coach-workspace').click();
      for (const label of ['Clipboard', 'Team Plan', 'Stopwatch', 'Roster']) {
        await expect(mobileDock.getByRole('button', { name: label })).toBeVisible();
      }
      await mobileDock.getByRole('button', { name: 'Stopwatch' }).click();
      await expect(page.getByRole('heading', { name: 'Trackside Stopwatch' })).toBeVisible({
        timeout: 10000,
      });
      await page.getByTestId('toggle-coach-workspace').click();
      await expect(mobileDock.getByRole('button', { name: 'Today' })).toBeVisible();
      await mobileDock.getByRole('button', { name: 'Log' }).click();
      await page.getByTestId('log-open-stopwatch-btn').click();
      await expect(page.getByRole('heading', { name: 'Trackside Stopwatch' })).toBeVisible({
        timeout: 10000,
      });

      // Add walk-on athlete and record 1 split so mobile cards showcase active timing
      await page.getByLabel('Walk-On Runner Name').fill('Jordan Miles');
      await page.getByRole('button', { name: 'Add Runner' }).click();
      await page.getByTestId('stopwatch-gun-btn').click();
      await page.waitForTimeout(250);
      await page.getByTestId('runner-card-0').click();

      // Enforce large >= 72px trackside runner touch target
      const cardBox = await page.getByTestId('runner-card-0').boundingBox();
      expect(cardBox?.height || 0).toBeGreaterThanOrEqual(72);

      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(150);

      await page.screenshot({
        path: 'test-results/screenshots/stopwatch-mobile-390-light.png',
        fullPage: false,
        animations: 'disabled',
      });

      await toggleDarkMode(page, true);
      await page.screenshot({
        path: 'test-results/screenshots/stopwatch-mobile-390-dark.png',
        fullPage: false,
        animations: 'disabled',
      });
      await toggleDarkMode(page, false);

      await page.evaluate(() => localStorage.removeItem('thresh_trackside_stopwatch_v1'));
    });
  });

  test.describe('Documentation & Physiology Reference (/docs/)', () => {
    test('6. Documentation Page — Light and Dark Mode', async ({ page }) => {
      await page.goto('/docs/');

      // Verify Docs title & content
      await expect(page).toHaveTitle(/THRESH — Documentation/i);
      const mainHeading = page.locator('h1, h2').first();
      await expect(mainHeading).toBeVisible();

      // Light mode capture
      await page.screenshot({
        path: 'test-results/screenshots/docs-light.png',
        fullPage: false,
        animations: 'disabled',
      });

      // Toggle Docs Theme
      const themeBtn = page.locator('#themeBtn');
      await expect(themeBtn).toBeVisible();
      await themeBtn.click();

      await expect(page.locator('html')).toHaveClass(/dark/);
      await page.screenshot({
        path: 'test-results/screenshots/docs-dark.png',
        fullPage: false,
        animations: 'disabled',
      });
    });
  });
});
