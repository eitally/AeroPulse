import { expect, Page, test } from '@playwright/test';

async function openCoachRosterTab(page: Page) {
  const isMobile = Boolean(page.viewportSize() && page.viewportSize()!.width < 768);
  if (isMobile) {
    const mobileDock = page.locator('nav[aria-label="Mobile primary workspaces"]');
    await mobileDock.getByRole('button', { name: 'Roster' }).click();
  } else {
    await page.getByTestId('coach-subtab-roster').click();
  }
}

test.describe('Simplified Coach Onboarding & Illustrated Coach Guide (Desktop & Mobile)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '/* mock */' })
    );
    await page.route('https://fonts.gstatic.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
    );
  });

  test('Team onboarding flow collapses optional branding, creates a team cleanly, opens Coach Guide modal, and verifies touch/overflow geometry', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/?demo=1#coach');
    await expect(page.getByTestId('coach-workspace-view')).toBeVisible({ timeout: 15000 });

    await openCoachRosterTab(page);

    // Seeded 12-athlete Willow Glen demo squad is ready immediately
    await expect(page.getByTestId('coach-execution-digest')).toContainText('Maya Chen');

    const createBtn = page.getByTestId('team-create-new-btn');
    await expect(createBtn).toBeVisible({ timeout: 10000 });
    await createBtn.click();

    await expect(page.getByTestId('team-studio-form')).toBeVisible({ timeout: 10000 });
    const advancedBrandingToggle = page.getByTestId('team-toggle-advanced-branding');
    await expect(advancedBrandingToggle).toBeVisible();
    await expect(advancedBrandingToggle).toHaveAttribute('aria-expanded', 'false');

    await page.getByTestId('team-name-input').fill('Willow Glen Varsity');
    await page.getByTestId('team-studio-submit-btn').click();

    await expect(page.getByRole('button', { name: 'Copy Join Link' })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole('button', { name: 'Print QR Poster' })).toBeVisible();
    await expect(page.getByText(/Code:\s*[A-Z0-9-]+/i)).toBeVisible();

    // Check zero horizontal overflow & >= 44px touch targets on mobile
    const layoutMetrics = await page.evaluate(() => {
      const copyJoinBtn = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Copy Join Link')
      );
      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        copyJoinHeight: copyJoinBtn?.getBoundingClientRect().height ?? 0,
      };
    });
    expect(layoutMetrics.scrollWidth).toBeLessThanOrEqual(layoutMetrics.innerWidth);
    if (page.viewportSize() && page.viewportSize()!.width < 768) {
      expect(layoutMetrics.copyJoinHeight).toBeGreaterThanOrEqual(44);
    }

    // Open Coach Guide from Coach Workspace header -> verify modal lands on Coach chapter with /docs/coach.html link
    const openGuideBtn = page.getByTestId('coach-open-guide-btn');
    await openGuideBtn.scrollIntoViewIfNeeded();
    await openGuideBtn.click();

    const guideLink = page.locator('a[href="/docs/coach.html"]', {
      hasText: 'Illustrated Coach Guide',
    });
    await expect(guideLink).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Done' }).click();

    expect(pageErrors).toEqual([]);
  });

  test('Standalone /docs/coach.html loads all 5 chapters, renders all 7 figures, toggles dark mode cleanly, and never overflows', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/docs/coach.html');
    await expect(page.getByRole('heading', { name: 'THRESH Coach User Guide' })).toBeVisible({
      timeout: 15000,
    });

    for (const id of [
      'ch1-onboard',
      'ch2-safety',
      'ch3-workouts',
      'ch4-review',
      'ch5-integrations',
    ]) {
      await expect(page.locator(`#${id}`)).toBeVisible();
    }

    // Ensure lazy-loaded figures decode properly by scrolling through the manual
    const figCount = await page.locator('figure.doc-figure img').count();
    expect(figCount).toBe(7);

    for (let i = 0; i < figCount; i += 1) {
      const img = page.locator('figure.doc-figure img').nth(i);
      await img.scrollIntoViewIfNeeded();
      await expect
        .poll(
          async () =>
            img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
          { timeout: 10000 }
        )
        .toBe(true);
    }

    // Theme toggle switches html.dark cleanly
    const themeBtn = page.locator('#themeBtn');
    const initiallyDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    );
    await themeBtn.click();
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.classList.contains('dark'))
      )
      .toBe(!initiallyDark);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
    expect(pageErrors).toEqual([]);
  });
});
