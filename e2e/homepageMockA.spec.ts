import { expect, test } from '@playwright/test';

test.describe('THRESH Homepage v3 — Editorial Split Stage (Desktop & Mobile)', () => {
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

  test('renders v3 Editorial Split Stage, No Advertising Ever, unified Coach/Athlete auth, Athletic.net/TFRRS benefits, and clickable COPPA 13+ modal in Light & Dark modes', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await expect(page.getByTestId('splash-overline')).toHaveText(/TRACK & FIELD · CROSS COUNTRY/i, {
      timeout: 15000,
    });
    await expect(
      page.getByRole('heading', { name: /Build fast teams\.\s*Protect every athlete\./i })
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: /Sign In or Get Started/i })).toBeVisible();

    // Ensure inline fake athlete telemetry preview is permanently gone from splash
    await expect(page.getByTestId('homepage-live-cockpit-preview')).toHaveCount(0);
    await expect(page.getByTestId('specimen-coach-panel')).toHaveCount(0);
    await expect(page.getByTestId('specimen-atl-value')).toHaveCount(0);

    // Prominent No Advertising. Ever. card + Interactive Sample card
    await expect(page.getByTestId('no-ads-guarantee-card')).toContainText('No Advertising. Ever.');
    await expect(page.getByTestId('splash-sample-card')).toBeVisible();
    await expect(page.getByTestId('explore-coach-sample-btn')).toContainText('Explore Coach Sample');
    await expect(page.getByTestId('try-athlete-sample-btn')).toContainText('Try Athlete View');

    // Symmetric 4-point benefits matrix including Automated setup & Athletic.net / TFRRS sync
    const matrix = page.getByTestId('splash-benefits-matrix');
    await expect(matrix).toContainText('For Coaches');
    await expect(matrix).toContainText('Automated roster & event-group setup');
    await expect(matrix).toContainText('Easy Athletic.net & TFRRS official results sync');
    await expect(matrix).toContainText('Trackside stopwatch & field events sheet');
    await expect(matrix).toContainText('SafeSport two-adult messaging & push alerts');
    await expect(matrix).toContainText('For Athletes');
    await expect(matrix).toContainText('Verified official meet & race history');
    await expect(matrix).not.toContainText('Team OS');
    await expect(matrix).not.toContainText('60s');

    // Unified auth card: no separate Register or Set Up Your Team buttons; email input always visible
    const authCard = page.getByTestId('homepage-auth-card');
    await expect(authCard.getByLabel('Email address')).toBeVisible();
    await expect(authCard.getByTestId('continue-with-email-btn')).toBeVisible();
    await expect(authCard.getByRole('button', { name: /Continue with Google/i })).toBeVisible();
    await expect(authCard.getByRole('button', { name: /Connect with Strava/i })).toBeVisible();

    // Responsive geometry & >=44px mobile touch targets
    const heroBox = await page
      .getByRole('heading', { name: /Build fast teams\.\s*Protect every athlete\./i })
      .boundingBox();
    const authBox = await authCard.boundingBox();
    expect(heroBox).not.toBeNull();
    expect(authBox).not.toBeNull();

    const isMobile = Boolean(page.viewportSize() && page.viewportSize()!.width < 900);
    if (isMobile) {
      expect(authBox!.y).toBeGreaterThan(heroBox!.y);
      const touchTargets = [
        page.getByTestId('explore-coach-sample-btn'),
        page.getByTestId('onboarding-role-coach'),
        page.getByTestId('onboarding-role-athlete'),
        page.getByTestId('continue-with-email-btn'),
        page.getByRole('button', { name: /Continue with Google/i }),
        page.getByRole('button', { name: /Connect with Strava/i }),
        page.getByTestId('coppa-explainer-trigger'),
      ];
      for (const locator of touchTargets) {
        const box = await locator.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    } else {
      expect(authBox!.x).toBeGreaterThan(heroBox!.x + heroBox!.width * 0.6);
    }

    const overflowLight = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(overflowLight).toBe(false);

    // Toggle Coach <-> Athlete role helper
    await expect(page.getByTestId('homepage-role-helper')).toContainText('Team Setup');
    await page.getByTestId('onboarding-role-athlete').click();
    await expect(page.getByTestId('homepage-role-helper')).toContainText('join your team');
    await page.getByTestId('onboarding-role-coach').click();

    // Clickable COPPA 13+ explainer modal
    await page.getByTestId('coppa-explainer-trigger').click();
    const coppaModal = page.getByTestId('coppa-explainer-modal');
    await expect(coppaModal).toBeVisible();
    await expect(coppaModal).toContainText('13 or older');
    await expect(coppaModal).toContainText('Trackside Stopwatch');
    await expect(coppaModal).toContainText('Parent / Guardian visibility');
    await expect(coppaModal).toContainText('No Advertising. Ever.');
    await page.getByTestId('coppa-explainer-close').click();
    await expect(coppaModal).toHaveCount(0);

    // Header Team Code drawer opens and focuses input
    await page.getByTestId('header-team-code-btn').click();
    await expect(page.getByTestId('homepage-drawer-teamcode')).toBeVisible();
    await expect(page.getByLabel('Enter 6-character Team Join Code')).toBeFocused();

    // Dark mode toggle + zero horizontal overflow
    await page.getByRole('button', { name: /Toggle color theme/i }).click();
    const overflowDark = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(overflowDark).toBe(false);

    // Footer links remain present
    await expect(page.locator('a[href="/privacy"]').first()).toBeVisible();
    await expect(page.locator('a[href="/terms"]').first()).toBeVisible();
    await expect(page.locator('a[href="/procurement"]').first()).toBeVisible();
    await expect(page.locator('footer a[href="/for-athletic-directors"]')).toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});
