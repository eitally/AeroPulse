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

test.describe('Wave 4: Device Push Notifications & Multi-Coach Staff (Desktop & Mobile)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '/* mock */' })
    );
    await page.route('https://fonts.gstatic.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
    );
  });

  test('Desktop (1440x900): Device Push Alerts toggle, Coach Scope Lens switching, 7-lane Staff Coverage Matrix, and Specialty Coach invitation', async ({
    page,
  }) => {
    test.skip(Boolean(page.viewportSize() && page.viewportSize()!.width < 768), 'Desktop only');

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/?demo=1#coach');
    await expect(page.getByTestId('coach-workspace-view')).toBeVisible({ timeout: 15000 });

    // 1. Open Team Messaging Drawer & test Device Push toggle >= 44px
    const chatBtn = page.getByTestId('open-team-messages-btn');
    await expect(chatBtn).toBeVisible({ timeout: 15000 });
    await chatBtn.click();

    const drawer = page.getByTestId('team-messaging-drawer');
    await expect(drawer).toBeVisible();
    const pushBtn = page.getByTestId('toggle-device-push-btn');
    await expect(pushBtn).toBeVisible();
    const pushBox = await pushBtn.boundingBox();
    expect(pushBox).not.toBeNull();
    expect(pushBox!.height).toBeGreaterThanOrEqual(44);

    await expect(pushBtn).toHaveAttribute('aria-pressed', 'false');
    await pushBtn.click();
    await expect(pushBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(pushBtn).toContainText('Push Alerts ON');
    await page.getByRole('button', { name: 'Close Team Messaging' }).click();
    await expect(drawer).toHaveCount(0);

    // 2. Test Coach Scope Lens dropdown switching across Specialty Coaches
    const lensSelect = page.getByTestId('coach-scope-lens-select');
    await expect(lensSelect).toBeVisible();
    await expect(lensSelect).toHaveValue('ALL_TEAM');
    await lensSelect.selectOption('demo-mem-coach-thr');
    await expect(page.getByTestId('coach-workspace-view')).toContainText('1 connected athlete');
    await lensSelect.selectOption('ALL_TEAM');
    await expect(page.getByTestId('coach-workspace-view')).toContainText('1-Tap Roll Call (2/12 Present)');
    await expect(page.getByTestId('coach-workspace-view')).toContainText('2 Athletes Flagged');

    // 3. Open Roster -> verify 7-lane Coaching Staff Coverage Matrix & Invite Specialty Coach
    await openCoachRosterTab(page);
    const staffPanel = page.getByTestId('coaching-staff-panel');
    await expect(staffPanel).toBeVisible({ timeout: 15000 });
    const coverage = page.getByTestId('staff-coverage-matrix');
    await expect(coverage).toContainText('Head Coach:');
    await expect(coverage).toContainText('Distance:');
    await expect(coverage).toContainText('Sprints:');
    await expect(coverage).toContainText('Hurdles:');
    await expect(coverage).toContainText('Jumps:');
    await expect(coverage).toContainText('Pole Vault:');
    await expect(coverage).toContainText('Throws:');

    await page.getByTestId('invite-coach-toggle-btn').click();
    await expect(page.getByTestId('invite-coach-staff-form')).toBeVisible();
    await page.getByTestId('invite-coach-specialty-select').selectOption('hurdles');
    await page.getByTestId('invite-coach-name-input').fill('Coach Tanya Rivera');
    await page.getByTestId('invite-coach-submit-btn').click();
    await expect(staffPanel).toContainText('Coach Tanya Rivera');
    await expect(lensSelect).toContainText('Coach Tanya Rivera');

    expect(pageErrors).toEqual([]);
  });

  test('Mobile (390x844): Device Push toggle, Coaching Staff panel, and Coach Scope Lens keep >=44px touch targets and zero horizontal overflow', async ({
    page,
  }) => {
    test.skip(Boolean(page.viewportSize() && page.viewportSize()!.width >= 768), 'Mobile only');

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/?demo=1#coach');
    await expect(page.getByTestId('coach-workspace-view')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('open-team-messages-btn').click();
    const pushBtn = page.getByTestId('toggle-device-push-btn');
    await expect(pushBtn).toBeVisible();
    const pushBox = await pushBtn.boundingBox();
    expect(pushBox).not.toBeNull();
    expect(pushBox!.height).toBeGreaterThanOrEqual(44);
    await pushBtn.click();
    await expect(pushBtn).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Close Team Messaging' }).click();

    const lensSelect = page.getByTestId('coach-scope-lens-select');
    await expect(lensSelect).toBeVisible();
    const lensBox = await lensSelect.boundingBox();
    expect(lensBox).not.toBeNull();
    expect(lensBox!.height).toBeGreaterThanOrEqual(44);

    await openCoachRosterTab(page);
    await expect(page.getByTestId('coaching-staff-panel')).toBeVisible({ timeout: 15000 });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow).toBeLessThanOrEqual(2);
    expect(pageErrors).toEqual([]);
  });
});
