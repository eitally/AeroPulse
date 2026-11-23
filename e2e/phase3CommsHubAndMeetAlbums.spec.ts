import { expect, test, type Page } from '@playwright/test';

async function assertZeroHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
}

test.describe('Phase 3: Unified Comms Hub, Sub-Groups, Read Receipts & Curated Albums + FERPA E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '/* mock */' })
    );
    await page.route('https://fonts.gstatic.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
    );
  });

  test('Desktop (1440x900): Unified Comms Hub tabs, Parents Only, Custom Sub-Group, Read Receipts, Copy Remind & FERPA Photo Opt-Out Warning', async ({
    page,
  }) => {
    test.skip(Boolean(page.viewportSize() && page.viewportSize()!.width < 768), 'Desktop only');

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/?demo=1&sample=coach');
    await expect(page.getByTestId('coach-workspace-view')).toBeVisible({ timeout: 15000 });

    // 1. Open Unified Comms Hub from Coach Home
    await page.getByTestId('coach-home-open-messaging-btn').click();
    const drawer = page.getByTestId('team-messaging-drawer');
    await expect(drawer).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('comms-tab-chat')).toBeVisible();
    await expect(page.getByTestId('comms-tab-announcements')).toBeVisible();
    await expect(page.getByTestId('comms-tab-workout-notes')).toBeVisible();

    // 2. Whole Team message: open Got It Read Receipts popover + Copy Remind
    const firstReceiptBtn = drawer.locator('[data-testid^="msg-read-receipts-btn-"]').first();
    await firstReceiptBtn.click();
    await expect(page.getByTestId('msg-read-receipts-popover')).toBeVisible();
    await expect(page.getByTestId('msg-read-receipts-popover')).toContainText('Acknowledged');

    const firstCopyRemindBtn = drawer.locator('[data-testid^="msg-copy-remind-btn-"]').first();
    await firstCopyRemindBtn.click();
    await expect(drawer).toContainText('Copied');

    // 3. Parents Only channel
    await page.getByTestId('messaging-scope-parents_only').click();
    await expect(page.getByTestId('msg-parents-only-banner')).toBeVisible();
    await page.getByTestId('team-msg-input').fill('Parent carpool staging at North Gate at 2:45 PM.');
    await page.getByTestId('team-msg-send-btn').click();
    await expect(drawer).toContainText('Parent carpool staging at North Gate at 2:45 PM.');

    // 4. Custom Sub-Group creation & post
    await page.getByTestId('messaging-scope-custom_subgroup').click();
    await page.getByTestId('comms-subgroup-create-btn').click();
    await page.getByTestId('comms-subgroup-name-input').fill('Varsity Travel Bus');
    await page.getByTestId('comms-subgroup-save-btn').click();
    await expect(drawer).toContainText('Varsity Travel Bus');
    await page.getByTestId('team-msg-input').fill('Bus #1 seats front row reserved for throws gear.');
    await page.getByTestId('team-msg-send-btn').click();
    await expect(drawer).toContainText('Bus #1 seats front row reserved for throws gear.');

    // 5. Switch to Announcements & Workout Notes tabs inside Comms Hub
    await page.getByTestId('comms-tab-announcements').click();
    await expect(page.getByTestId('comms-announcements-panel')).toBeVisible();
    await page.getByTestId('comms-announcement-title-input').fill('Lightning Shelter Protocol');
    await page.getByTestId('comms-announcement-body-input').fill('Report to main gym immediately.');
    await page.getByTestId('comms-announcement-post-btn').click();
    await expect(drawer).toContainText('Lightning Shelter Protocol');

    await page.getByTestId('comms-tab-workout-notes').click();
    await expect(page.getByTestId('comms-workout-notes-panel')).toBeVisible();
    await page.getByTestId('comms-workout-note-input').fill('Good 200m rhythm today; ice calves tonight.');
    await page.getByTestId('comms-workout-note-send-btn').click();
    await expect(drawer).toContainText('Good 200m rhythm today; ice calves tonight.');

    await page.getByRole('button', { name: 'Close Team Messaging' }).click();
    await expect(drawer).toHaveCount(0);

    // 6. Toggle FERPA Photo Opt-Out in Roster -> verify warning when saving PUBLIC_HUB meet album
    await page.getByTestId('coach-subtab-roster').click();
    const firstOptOutToggle = page.locator('[data-testid^="roster-photo-optout-toggle-"]').first();
    await expect(firstOptOutToggle).toBeVisible({ timeout: 15000 });
    await firstOptOutToggle.click();
    await expect(firstOptOutToggle).toContainText('No Public Photos (FERPA)');

    await page.getByTestId('coach-subtab-team_plan').click();
    await page.getByTestId('coach-add-team-event-btn').click();
    await page.getByTestId('coach-event-title-input').fill('Bayshore Dual Meet Photos Test');
    const composer = page.getByTestId('coach-team-event-composer');
    await composer.getByPlaceholder('Photo album label').fill('Dual Meet Gallery');
    await composer.getByPlaceholder('https://photos.app.goo.gl/...').fill('https://photos.app.goo.gl/dualMeet123');
    await composer.locator('select').last().selectOption('PUBLIC_HUB');

    await expect(page.getByTestId('event-photo-optout-warning')).toBeVisible();
    await page.getByTestId('coach-save-team-event-btn').click();
    await expect(page.getByTestId('coach-team-events-bar')).toContainText('Dual Meet Gallery');

    await assertZeroHorizontalOverflow(page);
    expect(pageErrors).toEqual([]);
  });

  test('Mobile (390x844): Unified Comms Hub responsive zero-overflow check', async ({ page }) => {
    test.skip(Boolean(page.viewportSize() && page.viewportSize()!.width >= 768), 'Mobile only');

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/?demo=1&sample=coach');
    await expect(page.getByTestId('coach-home-open-messaging-btn')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('coach-home-open-messaging-btn').click();

    const drawer = page.getByTestId('team-messaging-drawer');
    await expect(drawer).toBeVisible();
    await page.getByTestId('messaging-scope-parents_only').click();
    await expect(page.getByTestId('msg-parents-only-banner')).toBeVisible();
    await page.getByTestId('comms-tab-announcements').click();
    await expect(page.getByTestId('comms-announcements-panel')).toBeVisible();

    await assertZeroHorizontalOverflow(page);
    expect(pageErrors).toEqual([]);
  });
});
