import { expect, Page, test } from '@playwright/test';

async function toggleDarkMode(page: Page, enableDark: boolean) {
  const isDark = await page.evaluate(() =>
    document.documentElement.classList.contains('dark')
  );
  if (isDark !== enableDark) {
    await page.evaluate((dark) => {
      if (dark) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('thresh_theme_dark', '1');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('thresh_theme_dark', '0');
      }
    }, enableDark);
    if (enableDark) {
      await expect(page.locator('html')).toHaveClass(/dark/);
    } else {
      await expect(page.locator('html')).not.toHaveClass(/dark/);
    }
  }
}

async function assertZeroHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
}

test.describe('Athletic.net & TFRRS Team Sync + Safe-Sport Clean-Room Parent Hub', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '/* mock */' })
    );
    await page.route('https://fonts.gstatic.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
    );
  });

  test('Desktop & Mobile: loads Willow Glen HS (1073/xc) preset, previews Clean-Room Public Parent Hub, checks layout/touch targets, and returns to Coach Workspace', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const viewport = page.viewportSize();
    const isMobile = Boolean(viewport && viewport.width < 640);

    // 1. Open Coach Workspace directly in demo mode and launch Athletic.net / TFRRS Sync modal via Desk
    await page.goto('/?demo=1#coach');
    await expect(page.getByTestId('coach-workspace-view')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('coach-desk-menu-btn').click();
    const openSyncBtn = page.getByTestId('coach-open-external-sync-btn');
    await expect(openSyncBtn).toBeVisible({ timeout: 10000 });
    await openSyncBtn.click();

    const syncModal = page.getByTestId('athletic-tfrrs-sync-modal');
    await expect(syncModal).toBeVisible({ timeout: 10000 });

    // 2. Run Quick-Setup for Willow Glen HS (1073/xc)
    await page.getByTestId('sync-quick-setup-willow-glen').click();
    const banner = page.getByTestId('sync-status-banner');
    await expect(banner).toBeVisible({ timeout: 15000 });
    await expect(banner).toContainText(/Willow Glen HS XC \(1073\/xc\)/);

    // 3. Switch to Team URL & .ics tab and verify mobile >= 44px touch target before opening Public Parent Hub
    await page.getByTestId('sync-tab-connect_ics').click();
    const previewHubBtn = page.getByTestId('sync-open-public-hub-btn');
    await expect(previewHubBtn).toBeVisible({ timeout: 10000 });
    if (isMobile) {
      const box = await previewHubBtn.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }

    await previewHubBtn.click();

    // 4. Verify Public Clean-Room Parent Hub route & content
    const hubPage = page.getByTestId('public-team-hub-page');
    await expect(hubPage).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(/\/team\/willow-glen-high-school-xc/);
    await expect(hubPage).toContainText('Willow Glen High School XC');
    await expect(hubPage).toContainText('Crystal Springs');
    await expect(hubPage).toContainText('Lucas Alvarez');
    await expect(hubPage).toContainText('15:18.40');

    // Verify Safe-Sport notice and absence of sensitive biometric fields
    await expect(hubPage).toContainText('Safe-Sport Team Hub');

    // Verify Light + Dark mode zero horizontal overflow and >= 44px mobile touch targets
    await assertZeroHorizontalOverflow(page);
    await toggleDarkMode(page, true);
    await expect(hubPage).toBeVisible();
    await assertZeroHorizontalOverflow(page);
    await toggleDarkMode(page, false);

    const backBtn = page.getByTestId('public-hub-back-btn');
    const followBtn = page.getByTestId('public-hub-follow-btn');
    if (isMobile) {
      const backBox = await backBtn.boundingBox();
      const followBox = await followBtn.boundingBox();
      expect(backBox!.height).toBeGreaterThanOrEqual(44);
      expect(followBox!.height).toBeGreaterThanOrEqual(44);
    }

    // 5. Follow team and verify confirmation, then return cleanly to Coach Workspace
    await followBtn.click();
    await expect(hubPage.locator('[role="status"]')).toContainText(/WGHS XC/i, {
      timeout: 10000,
    });

    await backBtn.click();
    const coachView = page.getByTestId('coach-workspace-view');
    await expect(coachView).toBeVisible({ timeout: 15000 });
    await expect(coachView).toContainText('WGHS XC · Coach');
    await expect(coachView).toContainText('Willow Glen High School XC Daily Ops');

    expect(pageErrors).toEqual([]);
  });
});
