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

test.describe('COACH-01 & COACH-02: 2-Tap Check-In, Safety Swap, Execution Digest & Cohort Plan Publishing', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '/* mock */' })
    );
    await page.route('https://fonts.gstatic.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
    );
  });

  test('Desktop (1440x900): logs 2-tap SHIN pain check-in with safety swap, verifies Coach Digest, and publishes Rolling 2W cohort plan', async ({
    page,
  }) => {
    test.skip(Boolean(page.viewportSize() && page.viewportSize()!.width < 768), 'Desktop only');

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/?demo=1');
    const checkInCard = page.getByTestId('athlete-session-checkin-card');
    await expect(checkInCard).toBeVisible({ timeout: 15000 });

    // 1. Athlete logs RPE 7 + SHIN Pain Flag with Safety Swap
    await page.getByTestId('checkin-rpe-7').click();
    await page.getByTestId('checkin-toggle-pain').click();
    await page.getByTestId('checkin-pain-SHIN').click();
    await expect(page.getByTestId('checkin-safety-swap-preview')).toContainText('Low-Impact Recovery Flush');
    await page.getByTestId('checkin-submit-pain-swap').click();

    const summary = page.getByTestId('checkin-logged-summary');
    await expect(summary).toBeVisible({ timeout: 10000 });
    await expect(summary).toContainText('SHIN');
    await expect(summary).toContainText(/Swapped .* to low-impact recovery/i);

    // 2. Switch to Coach Workspace (Clipboard opens cleanly at 0px scroll; click Flagged/Roster for Squad Triage)
    await page.getByTestId('toggle-coach-workspace').click();
    await expect(page.getByTestId('clipboard-flagged-triage-btn')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('clipboard-flagged-triage-btn').click();
    const digest = page.getByTestId('coach-execution-digest');
    await expect(digest).toBeVisible({ timeout: 15000 });
    await expect(digest).toContainText('Pain Flag');
    await expect(digest).toContainText('Pain · SHIN (Swapped)');

    // Check Dark Mode legibility
    await toggleDarkMode(page, true);
    await expect(digest).toBeVisible();
    await toggleDarkMode(page, false);

    // 3. Open Cohort Plan Builder via Coach Desk drawer -> Rolling 2W -> 800m / Mile Cohort
    await page.getByTestId('coach-desk-menu-btn').click();
    await expect(page.getByTestId('coach-desk-drawer')).toBeVisible();
    await page.getByTestId('coach-open-cohort-plan-builder').click();
    const publishBar = page.getByTestId('plan-builder-publish-bar');
    await publishBar.scrollIntoViewIfNeeded();
    await expect(publishBar).toBeVisible({ timeout: 15000 });

    await page.getByTestId('plan-publish-cadence-ROLLING_2W').click();
    await expect(page.getByTestId('plan-publish-cadence-ROLLING_2W')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await page.getByTestId('plan-publish-audience').selectOption('EVENT_MID_DISTANCE');
    await page.getByTestId('goals-publish-plan-btn').click();

    await expect(page.locator('main')).toContainText('Rolling 2-Week Window', { timeout: 10000 });
    await expect(page.locator('main')).toContainText('800m / Mile Cohort');

    expect(pageErrors).toEqual([]);
  });

  test('Mobile (390x844): verifies >= 44px touch targets and <= 2px horizontal overflow across check-in, digest, and cohort publish bar', async ({
    page,
  }) => {
    test.skip(Boolean(page.viewportSize() && page.viewportSize()!.width >= 768), 'Mobile only');

    await page.goto('/?demo=1');
    await expect(page.getByTestId('athlete-session-checkin-card')).toBeVisible({ timeout: 15000 });

    const rpeBox = await page.getByTestId('checkin-rpe-5').boundingBox();
    expect(rpeBox?.height).toBeGreaterThanOrEqual(44);
    const painBtnBox = await page.getByTestId('checkin-toggle-pain').boundingBox();
    expect(painBtnBox?.height).toBeGreaterThanOrEqual(44);

    // Log quick RPE 5 clean check-in
    await page.getByTestId('checkin-rpe-5').click();
    await page.getByTestId('checkin-submit-clear').click();
    await expect(page.getByTestId('checkin-logged-summary')).toContainText('RPE 5/10');

    // Open Coach Digest inside Team via mobile dock on mobile
    await page.getByTestId('toggle-coach-workspace').click();
    await page.locator('nav[aria-label="Mobile primary workspaces"]').getByRole('button', { name: 'Team' }).click();
    const digest = page.getByTestId('coach-execution-digest');
    await expect(digest).toBeVisible({ timeout: 15000 });
    await expect(digest).toContainText('RPE 5/10');

    const overflowCoach = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflowCoach).toBeLessThanOrEqual(2);

    // Open Plan Builder via Coach Desk drawer and verify mobile touch target & overflow
    await page.getByTestId('coach-desk-menu-btn').click();
    await expect(page.getByTestId('coach-desk-drawer')).toBeVisible();
    await page.getByTestId('coach-open-cohort-plan-builder').click();
    const publishBar = page.getByTestId('plan-builder-publish-bar');
    await publishBar.scrollIntoViewIfNeeded();
    await expect(publishBar).toBeVisible({ timeout: 15000 });

    const rollingBtnBox = await page.getByTestId('plan-publish-cadence-ROLLING_1W').boundingBox();
    expect(rollingBtnBox?.height).toBeGreaterThanOrEqual(44);

    const overflowPlan = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflowPlan).toBeLessThanOrEqual(2);
  });
});
