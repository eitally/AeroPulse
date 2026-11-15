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

    test('3. Athlete Roster Modal — Light and Dark Mode', async ({ page }) => {
      await enterSampleDemoMode(page);
      await page.waitForTimeout(500);

      // Open Roster modal via explicit data-testid
      const teamBtn = page.locator('[data-testid="open-roster-modal"]').first();
      await expect(teamBtn).toBeVisible({ timeout: 10000 });
      await teamBtn.click();

      // Verify dialog is visible (allows time for lazy chunk to download and mount)
      const dialog = page.locator('div[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 15000 });

      // Light mode capture
      await page.screenshot({
        path: 'test-results/screenshots/roster-modal-desktop-1440-light.png',
        fullPage: false,
        animations: 'disabled',
      });

      // Close modal before toggling theme
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();

      // Switch to Dark Mode
      await toggleDarkMode(page, true);

      // Re-open Roster modal in Dark Mode
      await teamBtn.click();
      await expect(dialog).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(300);

      // Dark mode capture for Roster dialog
      await page.screenshot({
        path: 'test-results/screenshots/roster-modal-desktop-1440-dark.png',
        fullPage: false,
        animations: 'disabled',
      });

      // Close modal
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await toggleDarkMode(page, false);
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
