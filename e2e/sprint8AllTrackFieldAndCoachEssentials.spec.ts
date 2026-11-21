import { expect, test } from '@playwright/test';

test.describe('Sprint 8: All Track & Field First-Class + Coach Essentials & Trackside Field Sheet', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '/* mock */' })
    );
    await page.route('https://fonts.gstatic.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
    );
  });

  test('Desktop (1440x900): Athlete telemetry stays Pro, Watch-less check-in & T&F pain chips work, Coach Essentials + Field Sheet + 4x100m relay work', async ({
    page,
  }) => {
    test.skip(Boolean(page.viewportSize() && page.viewportSize()!.width < 768), 'Desktop only');

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/?demo=1');
    await expect(page.getByTestId('athlete-session-checkin-card')).toBeVisible({ timeout: 15000 });

    // Athlete keeps Pro analytics intact + gains T&F pain chips & Watch-less button
    await expect(page.getByText(/Systemic CTL\s+\d+/)).toBeVisible();
    await page.getByTestId('checkin-toggle-pain').click();
    await expect(page.getByTestId('checkin-pain-QUAD')).toBeVisible();
    await expect(page.getByTestId('checkin-pain-SHOULDER')).toBeVisible();
    await page.getByTestId('checkin-toggle-pain').click();

    await expect(page.getByTestId('watchless-did-workout-btn')).toBeVisible();
    await page.getByTestId('watchless-did-workout-btn').click();
    await expect(page.getByTestId('checkin-logged-summary')).toBeVisible({ timeout: 10000 });

    // Switch to Coach Workspace -> defaults to Simple (Essentials), supports Pro toggle
    await page.getByTestId('toggle-coach-workspace').click();
    const simpleBtn = page.getByTestId('coach-complexity-essentials');
    const proBtn = page.getByTestId('coach-complexity-pro');
    await expect(simpleBtn).toBeVisible({ timeout: 15000 });
    await expect(simpleBtn).toHaveAttribute('aria-pressed', 'true');
    await proBtn.click();
    await expect(proBtn).toHaveAttribute('aria-pressed', 'true');
    await simpleBtn.click();
    await expect(simpleBtn).toHaveAttribute('aria-pressed', 'true');

    // Coach Daily Ops panel is visible on Clipboard and launches Field & Multi Sheet cleanly
    await expect(page.getByTestId('coach-daily-ops-panel')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('daily-ops-launch-field').click();

    const fieldSheet = page.getByTestId('trackside-field-events-sheet');
    await expect(fieldSheet).toBeVisible({ timeout: 15000 });

    // Record Horizontal Long Jump trial in imperial ft-in
    await page.getByTestId('field-event-btn-LJ').click();
    await page.getByTestId('field-trial-input-0').fill(`21' 6.5"`);
    await expect(page.getByTestId('field-sheet-best-mark')).toContainText(`21' 6.5"`);
    await page.getByTestId('field-sheet-save-btn').click();
    await expect(page.getByTestId('field-sheet-saved-banner')).toBeVisible({ timeout: 10000 });

    // Switch to Vertical High Jump O/X/- + Raise Bar
    await page.getByTestId('field-event-btn-HJ').click();
    await page.getByTestId('field-vertical-clear-btn').click();
    await page.getByTestId('field-vertical-raise-btn').click();
    await expect(page.getByTestId('field-vertical-series-text')).toContainText(':O');
    await page.getByTestId('field-sheet-save-btn').click();
    await expect(page.getByTestId('field-sheet-saved-banner')).toBeVisible();

    // Return to Clipboard & test 4x100m Relay Optimizer
    await page.getByRole('button', { name: 'Clipboard' }).click();
    const relayAccordion = page.getByRole('button', { name: /Relay Optimizer/i });
    await expect(relayAccordion).toBeVisible({ timeout: 10000 });
    await relayAccordion.click();
    const r4x1Btn = page.getByTestId('relay-event-btn-4x100m');
    await expect(r4x1Btn).toBeVisible({ timeout: 10000 });
    await r4x1Btn.click();
    await expect(r4x1Btn).toHaveAttribute('aria-pressed', 'true');

    expect(pageErrors).toEqual([]);
  });

  test('Mobile (390x844): Watch-less CTA & Coach Essentials / Field Throws satisfy 44px touch targets with zero horizontal overflow', async ({
    page,
  }) => {
    test.skip(Boolean(page.viewportSize() && page.viewportSize()!.width >= 768), 'Mobile only');

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/?demo=1');
    const watchlessBtn = page.getByTestId('watchless-did-workout-btn');
    await expect(watchlessBtn).toBeVisible({ timeout: 15000 });
    const watchlessBox = await watchlessBtn.boundingBox();
    expect(watchlessBox).not.toBeNull();
    expect(watchlessBox!.height).toBeGreaterThanOrEqual(44);

    await page.getByTestId('toggle-coach-workspace').click();
    const simpleBtn = page.getByTestId('coach-complexity-essentials');
    await expect(simpleBtn).toBeVisible({ timeout: 15000 });
    const simpleBox = await simpleBtn.boundingBox();
    expect(simpleBox).not.toBeNull();
    expect(simpleBox!.height).toBeGreaterThanOrEqual(44);

    const launchFieldBtn = page.getByTestId('daily-ops-launch-field');
    await expect(launchFieldBtn).toBeVisible({ timeout: 10000 });
    await launchFieldBtn.click();

    await expect(page.getByTestId('trackside-field-events-sheet')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('field-event-btn-SP').click();
    await page.getByTestId('field-trial-input-0').fill(`44' 2"`);
    await expect(page.getByTestId('field-sheet-best-mark')).toContainText(`44' 2"`);
    const saveBox = await page.getByTestId('field-sheet-save-btn').boundingBox();
    expect(saveBox).not.toBeNull();
    expect(saveBox!.height).toBeGreaterThanOrEqual(44);
    await page.getByTestId('field-sheet-save-btn').click();
    await expect(page.getByTestId('field-sheet-saved-banner')).toBeVisible({ timeout: 10000 });

    const overflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollW).toBeLessThanOrEqual(overflow.clientW + 2);
    expect(pageErrors).toEqual([]);
  });
});
