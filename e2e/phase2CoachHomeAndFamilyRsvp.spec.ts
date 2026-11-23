import { expect, test, type Page } from '@playwright/test';

async function assertZeroHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
}

test.describe('Phase 2: Coach 5-Tab Home/Workouts Split, Calendar Feed & RSVP Ops E2E', () => {
  test('Desktop (1440x900): clean 3-section Coach Home -> Workouts tab -> Roll Call Apply RSVPs -> Meets & Plan Conflict Scratch -> Athlete RSVP', async ({
    page,
  }) => {
    test.skip(Boolean(page.viewportSize() && page.viewportSize()!.width < 768), 'Desktop only');

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // 1. Coach Demo Mode -> clean 3-section Home (panel links, alerts, messaging only)
    await page.goto('/?demo=1&sample=coach');
    await expect(page.getByTestId('coach-workspace-view')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('coach-quick-ops-strip')).toBeVisible();
    await expect(page.getByTestId('coach-home-alerts')).toBeVisible();
    await expect(page.getByTestId('coach-home-messaging')).toBeVisible();

    // Roll Call and Workout Builder must NOT render on initial Home overview
    await expect(page.getByTestId('roll-call-save-btn')).toHaveCount(0);
    await expect(page.getByTestId('coach-clipboard-builder')).toHaveCount(0);

    // 2. Navigate to dedicated Workouts tab -> Workout Builder renders
    await page.getByTestId('coach-subtab-workouts').click();
    await expect(page.getByTestId('coach-workouts-screen')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('coach-clipboard-builder')).toBeVisible({ timeout: 15000 });

    // 3. Return to Home -> open Roll Call sub-pane -> Apply RSVPs -> Back to Home
    await page.getByTestId('coach-subtab-clipboard').click();
    await page.getByTestId('quick-ops-roll-call-btn').click();
    await expect(page.getByTestId('coach-daily-ops-panel')).toBeVisible({ timeout: 15000 });
    const applyRsvpsBtn = page.getByTestId('roll-call-apply-rsvps-btn');
    await expect(applyRsvpsBtn).toBeVisible();
    await applyRsvpsBtn.click();
    await expect(page.getByTestId('roll-call-saved-banner')).toBeVisible();
    await page.getByTestId('coach-back-to-home-btn').click();
    await expect(page.getByTestId('coach-quick-ops-strip')).toBeVisible();

    // 4. Open Meets & Plan -> Coach Team Events Bar & Calendar Subscribe Popover
    await page.getByTestId('coach-subtab-team_plan').click();
    await expect(page.getByTestId('coach-team-events-bar')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('coach-events-calendar-subscribe-btn').click();
    await expect(page.getByTestId('ics-apple-webcal-link')).toBeVisible();
    await expect(page.getByTestId('ics-google-calendar-link')).toBeVisible();
    const rotateBtn = page.getByTestId('ics-rotate-token-btn');
    await expect(rotateBtn).toBeVisible();
    const beforeCopyHref = await page.getByTestId('ics-apple-webcal-link').getAttribute('href');
    await rotateBtn.click();
    const afterRotateHref = await page.getByTestId('ics-apple-webcal-link').getAttribute('href');
    expect(afterRotateHref).not.toBe(beforeCopyHref);

    // 5. Meet Day Hub RSVP conflict banner + Scratch Conflicted button
    await page.getByTestId('meets-subview-meetday').click();
    const conflictBanner = page.getByTestId('meet-rsvp-conflict-banner');
    await expect(conflictBanner).toBeVisible({ timeout: 15000 });
    await page.getByTestId('meet-scratch-conflict-btn').click();
    await expect(conflictBanner).toHaveCount(0);

    // 6. Relays & Top Times RSVP exclusion toggle
    await page.getByTestId('meets-subview-relays').click();
    const relayToggle = page.getByTestId('relay-exclude-rsvp-out-toggle');
    await expect(relayToggle).toBeVisible({ timeout: 15000 });
    await expect(relayToggle).toBeChecked();

    // 7. Return Home -> launch Messaging Drawer from Coach Home card
    await page.getByTestId('coach-subtab-clipboard').click();
    await page.getByTestId('coach-home-open-messaging-btn').click();
    await expect(page.getByTestId('team-messaging-drawer')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Close Team Messaging' }).click();

    // 8. Athlete Mode -> verify Upcoming RSVP 1-tap toggle works cleanly
    await page.goto('/?demo=1');
    const rsvpSection = page.getByTestId('athlete-upcoming-rsvp-section');
    await expect(rsvpSection).toBeVisible({ timeout: 15000 });
    const firstGoingBtn = rsvpSection.locator('[data-testid^="athlete-rsvp-"]').first();
    await firstGoingBtn.click();
    await expect(firstGoingBtn).toHaveAttribute('aria-pressed', 'true');

    expect(pageErrors).toEqual([]);
  });

  test('Mobile (390x844): 5-tab Coach MobileDock, dedicated Workouts screen, and zero horizontal overflow', async ({
    page,
  }) => {
    test.skip(Boolean(page.viewportSize() && page.viewportSize()!.width >= 768), 'Mobile only');

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/?demo=1&sample=coach');
    await expect(page.getByTestId('coach-workspace-view')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('coach-quick-ops-strip')).toBeVisible();
    await expect(page.getByTestId('coach-home-alerts')).toBeVisible();
    await expect(page.getByTestId('coach-home-messaging')).toBeVisible();
    await assertZeroHorizontalOverflow(page);

    const mobileDock = page.locator('nav[aria-label="Mobile primary workspaces"]');
    await expect(mobileDock.getByTestId('mobile-dock-coach-workouts')).toBeVisible();
    await mobileDock.getByTestId('mobile-dock-coach-workouts').click();
    await expect(page.getByTestId('coach-workouts-screen')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('coach-clipboard-builder')).toBeVisible({ timeout: 15000 });
    await assertZeroHorizontalOverflow(page);

    expect(pageErrors).toEqual([]);
  });
});
