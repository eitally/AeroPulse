import { test, expect } from '@playwright/test';

test.describe('Plan Builder First-Click Resilience & Deploy Chunk-Skew Recovery', () => {
  test('renders Plan Builder cleanly on first click even with malformed legacy goals & simulated stale-chunk deploy skew (Desktop & Mobile)', async ({
    page,
    isMobile,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // Seed malformed legacy goals + multi-sport archive metadata prior to mount
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          'aeropulse_target_goals',
          JSON.stringify([
            { id: 'goal-1', title: 'Legacy Dummy' },
            { id: 'legacy-broken', sportCategory: 'Hiking', targetDate: 'invalid', title: '' },
          ])
        );
        localStorage.setItem(
          'aeropulse_annual_mileage_goals',
          JSON.stringify([{ sportCategory: 'Running' }])
        );
      } catch {
        // ignore storage restrictions
      }
    });

    // Fail dynamic module requests for GoalsView until triggerChunkSkewReload performs
    // its cooldown-guarded navigation reload (works identically in dev ESM and CI=1 ModuleMap builds).
    let goalsChunkRequests = 0;
    let hasReloadedAfterFailure = false;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && goalsChunkRequests >= 1) {
        hasReloadedAfterFailure = true;
      }
    });

    await page.route('**/GoalsView*', async (route) => {
      goalsChunkRequests += 1;
      if (!hasReloadedAfterFailure) {
        await route.fulfill({
          status: 404,
          contentType: 'text/html',
          body: '<!doctype html><html><body>Not Found</body></html>',
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/?demo=1');
    const navSelector = isMobile
      ? 'nav[aria-label="Mobile primary workspaces"]'
      : 'nav[aria-label="Primary workspaces"]';
    await expect(page.locator(navSelector)).toBeVisible({ timeout: 15000 });

    if (isMobile) {
      await page.locator(navSelector).getByRole('button', { name: 'Plan Builder' }).click();
    } else {
      await page.locator(navSelector).getByRole('link', { name: 'Plan Builder' }).click();
    }

    // Wait for guarded reload & tab restoration back onto Plan Builder without blanking out
    await expect(page.getByRole('heading', { name: 'Plan Builder', level: 1 })).toBeVisible({
      timeout: 20000,
    });
    expect(page.url()).not.toContain('aeropulse-eta.vercel.app');
    expect(hasReloadedAfterFailure).toBe(true);
    expect(goalsChunkRequests).toBeGreaterThanOrEqual(2);
    expect(pageErrors).toHaveLength(0);

    // Subsequent interactions inside Plan Builder stay intact and responsive
    await expect(page.getByTestId('plan-mode-single-workout')).toBeVisible();
    await page.getByTestId('plan-mode-single-workout').click();
    await expect(page.getByRole('button', { name: 'Add Workout to Calendar' })).toBeVisible();
  });
});
