import { expect, test } from '@playwright/test';

test.describe('Sprint 9: SafeSport MAAPP Messaging & Meet-Day Heats/Flights/NFHS Guardrail', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '/* mock */' })
    );
    await page.route('https://fonts.gstatic.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
    );
  });

  test('Desktop (1440x900): SafeSport Athlete->Coach messaging, Two-Adult CC, Coach Staff channel, and Meet-Day NFHS 4-event packet', async ({
    page,
  }) => {
    test.skip(Boolean(page.viewportSize() && page.viewportSize()!.width < 768), 'Desktop only');

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/?demo=1');
    const chatBtn = page.getByTestId('open-team-messages-btn');
    await expect(chatBtn).toBeVisible({ timeout: 15000 });
    await chatBtn.click();

    const drawer = page.getByTestId('team-messaging-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('Track practice starts 3:15 PM sharp today');

    // Athlete does NOT see Coaches & Staff channel
    await expect(page.getByTestId('msg-channel-staff')).toHaveCount(0);

    // 1-tap Got It acknowledgement + send reply in Whole Team
    const ackBtn = page.getByTestId('msg-ack-btn-demo-msg-all-1');
    await ackBtn.click();
    await expect(ackBtn).toContainText('Got It (3)');

    await page.getByTestId('team-msg-input').fill('Ready for curve handoffs at 3:15!');
    await page.getByTestId('team-msg-send-btn').click();
    await expect(drawer).toContainText('Ready for curve handoffs at 3:15!');

    // Transparent SafeSport Direct Channel
    await page.getByTestId('msg-channel-direct').click();
    await expect(page.getByTestId('msg-safesport-cc-banner')).toBeVisible();
    await page.getByRole('button', { name: 'Close Team Messaging' }).click();
    await expect(drawer).toHaveCount(0);

    // Switch to Coach Workspace -> opens Staff channel & policy controls + Meet Packet Modal
    await page.getByTestId('toggle-coach-workspace').click();
    await chatBtn.click();
    await expect(page.getByTestId('msg-channel-staff')).toBeVisible();
    await page.getByTestId('msg-channel-staff').click();
    await expect(drawer).toContainText('Maya Chen flagged mild right shin tightness');

    const policyToggle = page.getByTestId('messaging-policy-replies-toggle');
    await expect(policyToggle).toContainText('Replies: ON');
    await policyToggle.click();
    await expect(policyToggle).toContainText('Broadcast Only');
    await page.getByRole('button', { name: 'Close Team Messaging' }).click();

    // Open Meet-Day Heat & Flight Modal and trigger NFHS Rule 4-2 5th-event alert
    await page.getByTestId('coach-open-meet-packet-btn').click();
    const meetModal = page.getByTestId('meet-day-packet-modal');
    await expect(meetModal).toBeVisible();

    for (const ev of ['200m', '400m', '4x100m', 'LJ']) {
      await page.getByTestId('meet-add-event-select').selectOption(ev);
      await page.getByTestId('meet-add-entry-btn').click();
    }
    await expect(page.getByTestId('nfhs-over-limit-alert')).toBeVisible();
    await expect(page.getByTestId('nfhs-over-limit-alert')).toContainText('NFHS Rule 4-2 Violation');

    await page.getByTestId('meet-tab-heats').click();
    await expect(meetModal).toContainText(/Heat 1 · Lane \d/);

    await page.getByTestId('meet-tab-flights').click();
    await expect(meetModal).toContainText(/Flight 1 #1/);

    expect(pageErrors).toEqual([]);
  });

  test('Mobile (390x844): Header Team Chat CTA & Meet-Day Packet maintain >=44px touch targets and zero horizontal overflow', async ({
    page,
  }) => {
    test.skip(Boolean(page.viewportSize() && page.viewportSize()!.width >= 768), 'Mobile only');

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/?demo=1');
    const chatBtn = page.getByTestId('open-team-messages-btn');
    await expect(chatBtn).toBeVisible({ timeout: 15000 });
    const box = await chatBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    const overflowBefore = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    expect(overflowBefore.scrollW).toBeLessThanOrEqual(overflowBefore.clientW + 2);

    await chatBtn.click();
    await expect(page.getByTestId('team-messaging-drawer')).toBeVisible();
    await page.getByRole('button', { name: 'Close Team Messaging' }).click();

    await page.getByTestId('toggle-coach-workspace').click();
    await page.getByTestId('coach-open-meet-packet-btn').click();
    await expect(page.getByTestId('meet-day-packet-modal')).toBeVisible();

    const overflowCoach = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    expect(overflowCoach.scrollW).toBeLessThanOrEqual(overflowCoach.clientW + 2);
    expect(pageErrors).toEqual([]);
  });
});
