import { test, expect, Page } from '@playwright/test';

/**
 * Enters Sample Demo mode from the initial StravaAuthGate.
 * Sets local storage flags to avoid repeated onboarding gates.
 */
async function enterSampleDemoMode(page: Page) {
  await page.goto('/');

  // If Auth Gate is shown, wait and click "Explore Sample Cockpit"
  const sampleDemoBtn = page.getByRole('button', { name: /Explore Sample Cockpit/i });
  try {
    await sampleDemoBtn.waitFor({ state: 'visible', timeout: 5000 });
    await sampleDemoBtn.click();
  } catch {
    // Already in Cockpit session
  }

  // Wait for the main cockpit to load (#main-content is only rendered in Cockpit)
  await expect(page.locator('#main-content')).toBeVisible({ timeout: 15000 });
}

test.describe('THRESH Core Screens Visual & E2E Net (QA-01)', () => {
  test.describe('Desktop Viewport (1440x900)', () => {
    test.skip(({ isMobile }) => isMobile, 'Desktop only');

    test('1. Today Screen — Light and Dark Mode', async ({ page }) => {
      await enterSampleDemoMode(page);

      // Verify Today screen elements
      await expect(page.locator('#main-content')).toBeVisible();

      // Light mode capture
      await expect(page.locator('html')).not.toHaveClass(/dark/);
      await page.screenshot({
        path: 'test-results/screenshots/today-desktop-1440-light.png',
        fullPage: false,
      });

      // Toggle Dark mode
      const themeToggle = page.locator('button[aria-label*="Switch to Dark Mode"]');
      if (await themeToggle.isVisible()) {
        await themeToggle.click();
      }
      await expect(page.locator('html')).toHaveClass(/dark/);

      // Dark mode capture
      await page.screenshot({
        path: 'test-results/screenshots/today-desktop-1440-dark.png',
        fullPage: false,
      });
    });

    test('2. Plan Screen — Light and Dark Mode', async ({ page }) => {
      await enterSampleDemoMode(page);

      // Switch to Plan tab
      const planTab = page.locator('nav a[href="#calendar"]');
      await expect(planTab).toBeVisible();
      await planTab.click();

      // Verify Plan calendar is loaded
      await page.waitForTimeout(600); // Allow calendar transitions to settle
      await expect(page.locator('html')).not.toHaveClass(/dark/);
      await page.screenshot({
        path: 'test-results/screenshots/plan-desktop-1440-light.png',
        fullPage: false,
      });

      // Switch to dark mode
      const themeToggle = page.locator('button[aria-label*="Switch to Dark Mode"]');
      if (await themeToggle.isVisible()) {
        await themeToggle.click();
        await expect(page.locator('html')).toHaveClass(/dark/);
        await page.screenshot({
          path: 'test-results/screenshots/plan-desktop-1440-dark.png',
          fullPage: false,
        });
      }
    });

    test('3. Athlete Roster Modal — Light and Dark Mode', async ({ page }) => {
      await enterSampleDemoMode(page);

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
      });

      // Dark mode capture for Roster dialog
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      await page.screenshot({
        path: 'test-results/screenshots/roster-modal-desktop-1440-dark.png',
        fullPage: false,
      });
      await page.evaluate(() => document.documentElement.classList.remove('dark'));

      // Close modal
      const closeBtn = dialog.locator('button[aria-label*="Close"], button:has-text("✕"), button:has-text("Close")').first();
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
      } else {
        await page.keyboard.press('Escape');
      }
      await expect(dialog).not.toBeVisible();
    });
  });

  test.describe('Mobile Viewport (390x844)', () => {
    test.skip(({ isMobile }) => !isMobile, 'Mobile only');

    test('4. Today Screen (Mobile 390) — Light and Dark Mode', async ({ page }) => {
      await enterSampleDemoMode(page);

      // Verify mobile header & today content
      await expect(page.locator('#main-content')).toBeVisible();

      // Mobile Light mode capture
      await page.screenshot({
        path: 'test-results/screenshots/today-mobile-390-light.png',
        fullPage: false,
      });

      // Toggle Dark mode
      const themeToggle = page.locator('button[aria-label*="Switch to Dark Mode"]');
      if (await themeToggle.isVisible()) {
        await themeToggle.click();
        await expect(page.locator('html')).toHaveClass(/dark/);
        await page.screenshot({
          path: 'test-results/screenshots/today-mobile-390-dark.png',
          fullPage: false,
        });
      }
    });

    test('5. Plan Screen (Mobile 390) — Light and Dark Mode', async ({ page }) => {
      await enterSampleDemoMode(page);

      // Navigate to Plan tab on mobile dock
      const planTab = page.locator('nav[aria-label="Mobile primary workspaces"] button:has-text("Plan")');
      await expect(planTab).toBeVisible({ timeout: 5000 });
      await planTab.click();

      await page.waitForTimeout(600);

      // Mobile Plan capture
      await page.screenshot({
        path: 'test-results/screenshots/plan-mobile-390-light.png',
        fullPage: false,
      });

      // Dark mode Mobile Plan capture
      const themeToggle = page.locator('button[aria-label*="Switch to Dark Mode"]');
      if (await themeToggle.isVisible()) {
        await themeToggle.click();
        await expect(page.locator('html')).toHaveClass(/dark/);
        await page.screenshot({
          path: 'test-results/screenshots/plan-mobile-390-dark.png',
          fullPage: false,
        });
      }
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
      });

      // Toggle Docs Theme
      const themeBtn = page.locator('#themeBtn');
      await expect(themeBtn).toBeVisible();
      await themeBtn.click();

      await expect(page.locator('html')).toHaveClass(/dark/);
      await page.screenshot({
        path: 'test-results/screenshots/docs-dark.png',
        fullPage: false,
      });
    });
  });
});
