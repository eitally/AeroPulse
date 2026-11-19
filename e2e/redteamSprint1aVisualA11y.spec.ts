import { expect, Page, test } from '@playwright/test';

async function mockGoogleFonts(page: Page) {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '/* mock */' })
  );
  await page.route('https://fonts.gstatic.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
  );
}

test.describe('Sprint 1 Wave 1A — Design System, WCAG AA, Radar/Calendar & Mobile Card Polish (RT-16, RT-23, RT-25)', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await mockGoogleFonts(page);
  });

  test('cockpit renders inside framed .ap-content-stage, Calendar merges double planned workouts & wraps titles cleanly', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/?demo=1');
    const stage = page.getByTestId('cockpit-content-stage');
    await expect(stage).toBeVisible({ timeout: 15000 });
    await expect(stage).toHaveClass(/ap-content-stage/);

    // Navigate to Training Calendar
    await page.goto('/?demo=1#calendar');
    await expect(stage).toBeVisible({ timeout: 15000 });
    const viewport = page.viewportSize()!;
    if (viewport.width >= 1280) {
      await expect(
        page.locator('main button[title="Click to edit workout in place"]').first()
      ).toBeVisible({ timeout: 15000 });
    } else {
      await expect(page.locator('main').getByText(/Planned ·/i).first()).toBeVisible({
        timeout: 15000,
      });
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(overflow).toBe(false);

    if (viewport.width >= 1280) {
      // Any planned card whose day cell has zero completed activities must NOT also show a duplicate compact Rx button
      const duplicateCheck = await page.evaluate(() => {
        const titleButtons = Array.from(
          document.querySelectorAll('button[title="Click to edit workout in place"]')
        );
        const allLineClamped = titleButtons.every((b) =>
          b.className.includes('line-clamp-2')
        );
        const rxStripeButtons = Array.from(document.querySelectorAll('button')).filter(
          (b) => (b.getAttribute('title') || '').includes('(Scheduled Workout):')
        );
        // Every remaining Rx stripe must share its day cell with a completed workout (none on planned-only cells)
        const plannedOnlyHasStripe = rxStripeButtons.some((btn) => {
          const cell = btn.closest('div[class*="min-h-"]');
          if (!cell) return false;
          const text = cell.textContent || '';
          const hasCompleted = /\b(km|mi)\b/.test(text) && text.includes('TSS') && !text.includes('~');
          return !hasCompleted && cell.querySelector('button[title="Click to edit workout in place"]');
        });
        return {
          titleCount: titleButtons.length,
          allLineClamped,
          plannedOnlyHasStripe,
        };
      });
      expect(duplicateCheck.titleCount).toBeGreaterThan(0);
      expect(duplicateCheck.allLineClamped).toBe(true);
      expect(duplicateCheck.plannedOnlyHasStripe).toBe(false);
    }

    expect(pageErrors).toEqual([]);
  });

  test('Activities and Plan Builder Race Simulator render mobile cards on phones and desktop tables on desktop with zero overflow', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const viewport = page.viewportSize()!;
    const isMobile = viewport.width < 768;

    await page.goto('/?demo=1#activities');
    const mobileCards = page.getByTestId('activities-mobile-cards');
    const desktopTable = page.locator('table th', { hasText: 'Output (NP / Pace)' }).first();
    if (isMobile) {
      await expect(mobileCards).toBeVisible({ timeout: 15000 });
      await expect(desktopTable).toBeHidden();
    } else {
      await expect(desktopTable).toBeVisible({ timeout: 15000 });
      await expect(mobileCards).toBeHidden();
    }

    const actOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(actOverflow).toBe(false);

    // Check Plan Builder Race Physics mobile cards vs desktop table
    await page.goto('/?demo=1#plan-builder');
    const raceCards = page.getByTestId('race-physics-mobile-cards');
    const raceTable = page.locator('table th', { hasText: 'Course Segment' }).first();
    if (isMobile) {
      await raceCards.scrollIntoViewIfNeeded();
      await expect(raceCards).toBeVisible({ timeout: 15000 });
      await expect(raceTable).toBeHidden();
    } else {
      await raceTable.scrollIntoViewIfNeeded();
      await expect(raceTable).toBeVisible({ timeout: 15000 });
      await expect(raceCards).toBeHidden();
    }

    const planOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(planOverflow).toBe(false);

    expect(pageErrors).toEqual([]);
  });

  test('Radar SVG exposes wide viewBox & accessible role, Trends uses .ap-btn-pine & >=44px Quick Combos on mobile', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    const isMobile = Boolean(page.viewportSize() && page.viewportSize()!.width < 640);

    // 1. Curves & Radar view
    await page.goto('/?demo=1#curves');
    const radarSvg = page.locator('svg[viewBox="-56 -12 452 364"]').first();
    await radarSvg.scrollIntoViewIfNeeded({ timeout: 15000 });
    await expect(radarSvg).toBeVisible({ timeout: 15000 });
    await expect(radarSvg).toHaveAttribute('role', 'img');
    const ariaLabel = await radarSvg.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();

    const selectA = page.getByLabel('Select Radar Athlete A');
    const boxA = await selectA.boundingBox();
    expect(boxA).not.toBeNull();
    if (isMobile) {
      expect(boxA!.height).toBeGreaterThanOrEqual(44);
    }

    // 2. Trends view: .ap-btn-pine CTA (no legacy blue gradient) & Quick Combos touch height
    await page.goto('/?demo=1#trends');
    const trendAuditBtn = page.getByRole('button', { name: /Coach Trend Audit/i });
    await trendAuditBtn.scrollIntoViewIfNeeded({ timeout: 15000 });
    await expect(trendAuditBtn).toBeVisible({ timeout: 15000 });
    await expect(trendAuditBtn).toHaveClass(/ap-btn-pine/);

    const quickComboBtn = page.getByRole('button', { name: 'Ceiling + Bike eFTP' });
    await expect(quickComboBtn).toBeVisible();
    const comboBox = await quickComboBtn.boundingBox();
    expect(comboBox).not.toBeNull();
    if (isMobile) {
      expect(comboBox!.height).toBeGreaterThanOrEqual(44);
    }

    expect(pageErrors).toEqual([]);
  });
});
