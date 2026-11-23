import { expect, test } from '@playwright/test';

test.describe('Sprint 3C & 3B: Coach Parity, Direct Wahoo Push, Commercialization & Supportability', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '/* mock */' })
    );
    await page.route('https://fonts.gstatic.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
    );
  });

  test('Desktop (1440x900): GPS practice check-in, District AD overview, Wahoo push, Data Sources diagnostics, /procurement & /api/health', async ({
    page,
    context,
    request,
  }, testInfo) => {
    test.skip(Boolean(page.viewportSize() && page.viewportSize()!.width < 768), 'Desktop only');

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 37.3025, longitude: -121.8942 });

    // 1. Today screen GPS Practice Check-In + demo check-in receipt
    await page.goto('/?demo=1');
    const checkInCard = page.getByTestId('practice-attendance-checkin-card');
    await expect(checkInCard).toBeVisible({ timeout: 15000 });
    await expect(checkInCard).toContainText('Willow Glen High School Track');
    await expect(checkInCard).toContainText('never saved or tracked');

    const checkInBtn = page.getByTestId('gps-practice-checkin-btn');
    await expect(checkInBtn).toBeVisible();
    await checkInBtn.click();
    const receipt = page.getByTestId('gps-practice-checkin-receipt');
    await expect(receipt).toBeVisible({ timeout: 10000 });
    await expect(receipt).toContainText('Willow Glen High School Track');

    // 2. Data Sources modal: Wahoo/Polar/Suunto capabilities + Redacted Support Diagnostics
    await page.getByRole('button', { name: 'Data Sources' }).first().click();
    await expect(page.getByText('Wahoo Cloud API')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('polar-capability-badge')).toContainText(
      'Read-Only Sync (Use .FIT Export or Intervals.icu Bridge)'
    );
    await expect(page.getByTestId('suunto-intervals-bridge-note')).toBeVisible();

    await page
      .locator('summary', { hasText: 'Advanced Options (Map Styles, Cross-Device Backup & Cache)' })
      .click();
    const diagBtn = page.getByTestId('data-sources-diagnostics-btn');
    await expect(diagBtn).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('sprint3-data-sources-light.png'),
      fullPage: false,
    });
    await page.getByRole('button', { name: 'Close data sources modal' }).click().catch(async () => {
      await page.keyboard.press('Escape');
    });

    // 3. Coach Workspace: District AD Overview modal (via Desk) + Clipboard Watch Push Menu (Garmin, COROS, Wahoo, Intervals)
    await page.goto('/?demo=1&sample=coach');
    const deskBtn = page.getByTestId('coach-desk-menu-btn');
    await expect(deskBtn).toBeVisible({ timeout: 15000 });
    await deskBtn.click();
    const districtBtn = page.getByTestId('coach-open-district-ad-btn');
    await expect(districtBtn).toBeVisible({ timeout: 10000 });
    await districtBtn.click();

    const districtModal = page.getByTestId('district-ad-overview-modal');
    await expect(districtModal).toBeVisible({ timeout: 15000 });
    await expect(districtModal).toContainText('San Jose Unified School District');
    await expect(districtModal).toContainText('Willow Glen High School XC');
    await expect(districtModal.getByRole('button', { name: /Print District AD/i })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('sprint3-district-ad-light.png'),
      fullPage: false,
    });
    await page.keyboard.press('Escape');
    await expect(districtModal).not.toBeVisible({ timeout: 5000 });

    // Clipboard Export / Print watch push menu lives inside dedicated Workouts tab
    await page.getByTestId('quick-ops-workouts-btn').click();
    await expect(page.getByTestId('coach-clipboard-builder')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Export \/ Print/i }).click();
    await expect(page.getByTestId('clipboard-push-garmin')).toBeVisible();
    await expect(page.getByTestId('clipboard-push-wahoo')).toContainText('Wahoo ELEMNT');
    await expect(page.getByTestId('clipboard-push-coros')).toBeVisible();
    await expect(page.getByTestId('clipboard-push-intervals')).toBeVisible();

    // 4. /procurement Print Pack button + no $49/mo copy drift + enhanced /api/health
    await page.goto('/procurement');
    await expect(page.locator('body')).not.toContainText('$49/mo');
    await expect(
      page.getByRole('button', { name: /Print Procurement Pack \(PDF\)/i })
    ).toBeVisible({ timeout: 10000 });

    const healthResp = await request.get('/api/health');
    expect(healthResp.status()).toBe(200);
    const healthJson = (await healthResp.json()) as {
      ok: boolean;
      rateLimitBackend?: string;
      appVersion?: string;
      buildTimestamp?: string;
      integrations?: Record<string, boolean>;
    };
    expect(healthJson.ok).toBe(true);
    expect(['UPSTASH_REDIS', 'POSTGRES', 'MEMORY']).toContain(healthJson.rateLimitBackend);
    expect(healthJson.appVersion).toBe('2.1.0');
    expect(typeof healthJson.buildTimestamp).toBe('string');
    expect(typeof healthJson.integrations?.wahoo).toBe('boolean');
    expect(typeof healthJson.integrations?.stripeBilling).toBe('boolean');

    expect(pageErrors).toEqual([]);
  });
});
