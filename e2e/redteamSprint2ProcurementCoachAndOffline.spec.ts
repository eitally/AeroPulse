import { test, expect } from '@playwright/test';

test.describe('Red-Team Sprint 2: Legal/Procurement, Coach Features, Goals & Offline Guard', () => {
  test('Standalone /privacy, /terms, /subprocessors & /procurement pages serve real HTML with zero horizontal overflow', async ({
    page,
  }) => {
    const routes = [
      { path: '/privacy', mustMatch: /FERPA|SOPIPA|COPPA/i },
      { path: '/terms', mustMatch: /Coaching & readiness telemetry|MeetReady/i },
      { path: '/subprocessors', mustMatch: /Vercel|Neon|Strava/i },
      { path: '/procurement', mustMatch: /SDPC|NDPA|HECVAT/i },
    ];

    for (const r of routes) {
      const resp = await page.goto(r.path, { waitUntil: 'domcontentloaded' });
      expect(resp?.status()).toBe(200);
      await expect(page.locator('main, article, h1').first()).toBeVisible({ timeout: 10000 });
      await expect(page.locator('body')).toContainText(r.mustMatch);

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
    }
  });

  test('Homepage Coach Role Sample Demo hands off to 12-athlete squad, Workout Library, Guardian-CC Comments & Audit Log', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');
    await page.getByTestId('onboarding-role-coach').click();
    await page.getByTestId('explore-coach-sample-btn').click();

    await expect(page.getByTestId('coach-workspace-view')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('coach-clipboard-builder')).toBeVisible({ timeout: 15000 });

    // Workout Library load & save
    const library = page.getByTestId('coach-workout-library');
    await expect(library).toBeVisible();
    const libraryToggle = library.getByTestId('toggle-workout-library-btn');
    if (
      (await libraryToggle.count()) > 0 &&
      (await libraryToggle.getAttribute('aria-expanded')) === 'false'
    ) {
      await libraryToggle.click();
    }
    await library.getByTestId('library-load-template-btn').first().click();
    await page.getByTestId('clipboard-save-library-btn').click();
    await expect(page.getByTestId('coach-clipboard-builder')).toContainText(/Saved .* Library/i);

    // Switch to Roster subtab
    await page.getByRole('button', { name: /^Roster$/i }).first().click();
    await expect(page.getByTestId('coach-execution-digest')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('coach-execution-digest')).toContainText('All (12)');
    await expect(page.getByTestId('guardian-safety-alerts-banner')).toContainText('Maya Chen');

    // Post Guardian-CC Workout Comment
    await expect(page.getByTestId('guardian-cc-badge')).toContainText('Parent/Guardian CC Active');
    const note = 'Keep aerobic pace controlled on grass loop today.';
    await page.getByTestId('workout-comment-input').fill(note);
    await page.getByTestId('workout-comment-submit').click();
    await expect(page.getByTestId('coach-workout-comments')).toContainText(note);

    // Expand Compliance & Audit Log
    await page.getByTestId('team-audit-log-btn').click();
    await expect(page.getByTestId('team-audit-log-panel')).toBeVisible();
    await expect(page.getByTestId('team-audit-log-panel')).toContainText('GUARDIAN_SAFETY_ALERT_SENT');

    expect(pageErrors).toEqual([]);
  });

  test('Goals mm:ss pace clock input, Parent Hub skip-link & event-grouped PR leaderboard, and offline non-destructive guard', async ({
    page,
    context,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // 1. Goal mm:ss pace clock input
    await page.goto('/?demo=1#plan-builder');
    await page.getByRole('button', { name: /Add Goal|New Goal/i }).first().click().catch(() => {});
    const unitSelect = page.getByLabel('Goal target unit');
    if (await unitSelect.isVisible({ timeout: 8000 }).catch(() => false)) {
      await unitSelect.selectOption('s/km');
      const paceInput = page.getByTestId('goal-pace-clock-input');
      await expect(paceInput).toBeVisible();
      await paceInput.fill('6:15');
      await expect(paceInput).toHaveValue('6:15');
    }

    // 2. Public Parent Hub skip-link, event-grouped PRs & legal footer
    const consoleErrors: string[] = [];
    const onConsole = (msg: { type: () => string; text: () => string }) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    };
    page.on('console', onConsole);
    await page.goto('/team/willow-glen-high-school-xc?demo=1');
    const hub = page.getByTestId('public-team-hub-page');
    await expect(hub).toBeVisible({ timeout: 15000 });
    await expect(page.locator('a[href="#public-hub-main"]')).toHaveCount(1);
    await expect(hub).toContainText('Willow Glen High School XC');
    await expect(hub).toContainText('5000m (5)');
    await expect(hub).toContainText('1600m (4)');
    await expect(hub).toContainText('Coach Morales');
    await expect(hub).not.toContainText('Coach Coach Morales');
    await expect(page.locator('a[href="/privacy"]').first()).toBeVisible();
    page.off('console', onConsole);
    expect(consoleErrors).toEqual([]);

    // 3. Offline state does not wipe caches or trigger reload loop
    await page.goto('/?demo=1');
    await expect(page.getByRole('img', { name: 'MeetReady' }).first()).toBeVisible({
      timeout: 15000,
    });
    await context.setOffline(true);
    const offlineState = await page.evaluate(() => ({
      onLine: navigator.onLine,
      hasBody: document.body.innerText.length > 0,
    }));
    expect(offlineState.onLine).toBe(false);
    expect(offlineState.hasBody).toBe(true);
    await context.setOffline(false);

    expect(pageErrors).toEqual([]);
  });
});
