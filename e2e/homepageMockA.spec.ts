import { expect, test } from '@playwright/test';

test.describe('THRESH Homepage Mock A — Live Instrument Split (Desktop & Mobile)', () => {
  test.beforeEach(async ({ page, context }) => {
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '/* mock */' })
    );
    await page.route('https://fonts.gstatic.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
    );
    await context.clearCookies();
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('renders Live Instrument Split with interactive readiness simulation, coach triage toggle, and 3-pill auth drawers', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await expect(
      page.getByRole('heading', { name: /Know today's readiness before you step on the line/i })
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: /Sign in or create account/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Live Cockpit Preview/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /For Individual Athletes/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /For Coaches & Programs/i })).toBeVisible();

    const heroBox = await page
      .getByRole('heading', { name: /Know today's readiness before you step on the line/i })
      .boundingBox();
    const authBox = await page.getByTestId('homepage-auth-card').boundingBox();
    const specimenBox = await page.getByTestId('homepage-live-cockpit-preview').boundingBox();
    expect(heroBox).not.toBeNull();
    expect(authBox).not.toBeNull();
    expect(specimenBox).not.toBeNull();

    const isMobile = Boolean(page.viewportSize() && page.viewportSize()!.width < 900);
    if (isMobile) {
      // Mobile thumb-zone order: Headline -> Auth Card -> Live Cockpit Preview
      expect(authBox!.y).toBeGreaterThan(heroBox!.y);
      expect(specimenBox!.y).toBeGreaterThan(authBox!.y);

      const touchTargets = [
        page.getByRole('button', { name: /Connect with Strava/i }),
        page.getByRole('button', { name: /Continue with Google/i }),
        page.getByTestId('homepage-drawer-passkey-btn'),
        page.getByTestId('homepage-drawer-teamcode-btn'),
        page.getByTestId('homepage-drawer-fit-btn'),
        page.getByRole('button', { name: /Explore (?:Live )?Sample Cockpit/i }),
      ];
      for (const locator of touchTargets) {
        const box = await locator.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    } else {
      // Desktop asymmetric 7+5 split: Auth Card positioned in right column alongside Headline & Preview
      expect(authBox!.x).toBeGreaterThan(heroBox!.x + heroBox!.width * 0.6);
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(overflow).toBe(false);

    // 1. Toggle Readiness Simulation: Optimal (+6 TSB) -> Fatigued (-24 TSB)
    await expect(page.getByTestId('specimen-atl-value')).toHaveText('58');
    await expect(page.getByTestId('specimen-tsb-value')).toHaveText('+6');
    await expect(page.locator('body')).toContainText('920');
    await expect(page.getByTestId('specimen-prescription-text')).toContainText(
      'Today: 5 × 1km @ 3:42/km'
    );

    await page.getByTestId('specimen-readiness-fatigued').click();
    await expect(page.getByTestId('specimen-atl-value')).toHaveText('88');
    await expect(page.getByTestId('specimen-tsb-value')).toHaveText('-24');
    await expect(page.getByTestId('specimen-prescription-text')).toContainText(
      'Today: 4 × 1km @ 3:48/km · Auto-modulated -15% strain guard'
    );

    // Verify 1,180 TSS Fatigued weekly load, FREE FOR ATHLETES pricing badge & legal links
    await expect(page.locator('body')).toContainText('1,180');
    await expect(page.locator('body')).toContainText(/FREE FOR ATHLETES/i);
    await expect(page.locator('a[href="/privacy"]').first()).toBeVisible();
    await expect(page.locator('a[href="/terms"]').first()).toBeVisible();
    await expect(page.locator('a[href="/procurement"]').first()).toBeVisible();

    // 2. Role selector syncs Live Cockpit Preview to Team Coach & updates helper copy
    await page.getByTestId('onboarding-role-coach').click();
    await expect(page.getByTestId('homepage-role-helper')).toContainText(
      'Create a school, college, or club workspace in 60 seconds.'
    );
    await expect(page.getByTestId('specimen-coach-panel')).toBeVisible();
    await expect(page.getByTestId('specimen-coach-panel')).toContainText('24 Cleared');
    await expect(page.getByTestId('specimen-coach-panel')).toContainText('0.01s PHONE STOPWATCH');

    // Switch Live Cockpit Preview tab back to Solo Athlete
    await page.getByTestId('specimen-tab-solo').click();
    await expect(page.getByTestId('specimen-atl-value')).toBeVisible();

    // 3. 3-pill Progressive Disclosure Drawers
    await page.getByTestId('homepage-drawer-passkey-btn').click();
    await expect(page.getByTestId('homepage-drawer-passkey')).toBeVisible();

    await page.getByTestId('homepage-drawer-fit-btn').click();
    await expect(page.getByTestId('homepage-drawer-fit')).toBeVisible();
    await expect(page.getByTestId('homepage-drawer-passkey')).toHaveCount(0);

    // Header Team Code pill opens drawer and focuses join code input
    await page.getByTestId('header-team-code-btn').click();
    await expect(page.getByTestId('homepage-drawer-teamcode')).toBeVisible();
    await expect(page.getByTestId('homepage-drawer-fit')).toHaveCount(0);
    await expect(page.getByLabel('Enter 6-character Team Join Code')).toBeFocused();

    expect(pageErrors).toEqual([]);
  });
});
