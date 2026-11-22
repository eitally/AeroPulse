import { expect, Page, test } from '@playwright/test';

async function mockGoogleFonts(page: Page) {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '/* mock */' })
  );
  await page.route('https://fonts.gstatic.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
  );
}

async function signInAndEnterWorkspace(
  page: Page,
  user: { email: string; name: string }
) {
  const loginResp = await page.request.post('/api/auth/mock-login', {
    data: { email: user.email, name: user.name },
  });
  expect(loginResp.ok()).toBe(true);

  await page.goto('/?auth_just_signed_in=1&role=athlete');
  const confirmStep2Btn = page.getByRole('button', { name: /Confirm & Continue/i });
  await expect(confirmStep2Btn).toBeVisible({ timeout: 15000 });
  await confirmStep2Btn.click();

  const enterWorkspaceBtn = page.getByRole('button', {
    name: /Skip for Now — Enter MeetReady|Continue to MeetReady/i,
  });
  await expect(enterWorkspaceBtn).toBeVisible({ timeout: 15000 });
  await enterWorkspaceBtn.click();

  await expect(page.getByRole('button', { name: /Account and preferences menu/i })).toBeVisible({
    timeout: 15000,
  });
}

async function openCoachStopwatchSubTab(page: Page) {
  const gunBtn = page.getByTestId('stopwatch-gun-btn');
  if (
    new URL(page.url()).hash === '#coach/stopwatch' ||
    (await gunBtn.isVisible().catch(() => false))
  ) {
    await expect(gunBtn).toBeVisible({ timeout: 10000 });
    return;
  }
  const isMobile = Boolean(page.viewportSize() && page.viewportSize()!.width < 768);
  if (isMobile) {
    const mobileDock = page.locator('nav[aria-label="Mobile primary workspaces"]');
    await expect(mobileDock).toBeVisible({ timeout: 10000 });
    await mobileDock.getByRole('button', { name: 'Stopwatch' }).click();
  } else {
    const subTabBtn = page.getByTestId('coach-subtab-stopwatch');
    await expect(subTabBtn).toBeVisible({ timeout: 10000 });
    await subTabBtn.click();
  }
  await expect(gunBtn).toBeVisible({ timeout: 10000 });
}

test.describe('Sprint 0 Wave 0B — RT-10, RT-11, RT-13, RT-15 & RT-26 E2E', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await mockGoogleFonts(page);
  });

  test('RT-10: shared-device Sign Out wipes all user/credential/dynamic storage keys while preserving device preferences', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await signInAndEnterWorkspace(page, {
      email: `rt10.usera.${unique}@example.com`,
      name: 'User A Runner',
    });

    await page.evaluate(() => {
      localStorage.setItem('aeropulse_strava_client_secret', 'user_a_secret_token');
      localStorage.setItem('aeropulse_gemini_api_key', 'user_a_gemini_key');
      localStorage.setItem('aeropulse_target_goals', JSON.stringify([{ id: 'g1', name: '10k PR' }]));
      localStorage.setItem('aeropulse_strava_backfill_v4_999', '1');
      localStorage.setItem('thresh_daily_soreness_v1:2026-11-19', JSON.stringify({ score: 4 }));
      localStorage.setItem('thresh_stopwatch_outbox_v1', JSON.stringify([{ batchId: 'b_a' }]));
      localStorage.setItem(
        'thresh_walkon_stopwatch_logs_v1',
        JSON.stringify([{ runnerName: 'Walk-On User A' }])
      );
      localStorage.setItem('thresh_theme_dark', '1');
      localStorage.setItem('thresh_distance_unit', 'mi');
    });

    await page.getByRole('button', { name: /Account and preferences menu/i }).click();
    const signOutBtn = page.getByRole('menuitem', { name: /Back to Welcome \/ Sign Out/i });
    await expect(signOutBtn).toBeVisible({ timeout: 10000 });
    await signOutBtn.click();

    await expect(
      page.getByRole('heading', { name: /Sign In or Get Started/i })
    ).toBeVisible({ timeout: 15000 });

    const storageAfterLogout = await page.evaluate(() => ({
      stravaSecret: localStorage.getItem('aeropulse_strava_client_secret'),
      geminiKey: localStorage.getItem('aeropulse_gemini_api_key'),
      targetGoals: localStorage.getItem('aeropulse_target_goals'),
      backfill: localStorage.getItem('aeropulse_strava_backfill_v4_999'),
      soreness: localStorage.getItem('thresh_daily_soreness_v1:2026-11-19'),
      outbox: localStorage.getItem('thresh_stopwatch_outbox_v1'),
      walkOns: localStorage.getItem('thresh_walkon_stopwatch_logs_v1'),
      loggedOutFlag: localStorage.getItem('aeropulse_logged_out'),
      themeDark: localStorage.getItem('thresh_theme_dark'),
      distanceUnit: localStorage.getItem('thresh_distance_unit'),
    }));

    expect(storageAfterLogout.stravaSecret).toBeNull();
    expect(storageAfterLogout.geminiKey).toBeNull();
    expect(storageAfterLogout.targetGoals).toBeNull();
    expect(storageAfterLogout.backfill).toBeNull();
    expect(storageAfterLogout.soreness).toBeNull();
    expect(storageAfterLogout.outbox).toBeNull();
    expect(storageAfterLogout.walkOns).toBeNull();
    expect(storageAfterLogout.loggedOutFlag).toBe('1');
    expect(storageAfterLogout.themeDark).toBe('1');
    expect(storageAfterLogout.distanceUnit).toBe('mi');

    expect(pageErrors).toEqual([]);
  });

  test('RT-11: watchless INVITED athletes appear in Coach Stopwatch, walk-ons stay isolated from SELF, and offline outbox persists & flushes', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const loginResp = await page.request.post('/api/auth/mock-login', {
      data: {
        email: `rt11.coach.${unique}@school.edu`,
        name: 'Coach Morales',
      },
    });
    expect(loginResp.ok()).toBe(true);

    const teamResp = await page.request.post('/api/teams', {
      data: {
        name: `Trackside Outbox Panthers ${unique}`,
        shortName: 'Panthers',
        orgType: 'HIGH_SCHOOL',
        primarySport: 'Running',
        coachDisplayName: 'Coach Morales',
      },
    });
    expect(teamResp.ok()).toBe(true);
    const teamJson = (await teamResp.json()) as {
      ok: boolean;
      team: { brand: { teamId: string } };
    };
    const teamId = teamJson.team.brand.teamId;

    const bulkInviteResp = await page.request.post(`/api/teams/${teamId}/invites/bulk`, {
      data: {
        rows: [
          {
            invitedName: 'Watchless Riley',
            invitedEmail: `riley.${unique}@school.edu`,
            squadGroup: 'Varsity',
            isMinorU18: false,
          },
        ],
        sendEmailsNow: false,
      },
    });
    expect(bulkInviteResp.ok()).toBe(true);
    const bulkInviteJson = (await bulkInviteResp.json()) as {
      ok: boolean;
      team: { memberships: Array<{ membershipId: string; invitedName: string }> };
    };
    const rileyMembershipId = bulkInviteJson.team.memberships.find(
      (m) => m.invitedName === 'Watchless Riley'
    )?.membershipId;
    expect(rileyMembershipId).toBeTruthy();

    // Enter workspace via onboarding flow
    await page.goto('/?auth_just_signed_in=1&role=athlete');
    await page.getByRole('button', { name: /Confirm & Continue/i }).click();
    await page
      .getByRole('button', { name: /Skip for Now — Enter MeetReady|Continue to MeetReady/i })
      .click();
    await expect(page.getByTestId('toggle-coach-workspace')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('toggle-coach-workspace').click();
    await expect(page.getByTestId('coach-workspace-view')).toBeVisible({ timeout: 15000 });

    await openCoachStopwatchSubTab(page);

    const watchlessCard = page.locator('button', { hasText: 'Watchless Riley' }).first();
    await expect(watchlessCard).toBeVisible({ timeout: 15000 });

    await page.getByLabel('Walk-On Runner Name').fill('Walk-On Sam');
    await page.getByRole('button', { name: 'Add Runner' }).click();
    const walkOnCard = page.locator('button', { hasText: 'Walk-On Sam' }).first();
    await expect(walkOnCard).toBeVisible({ timeout: 10000 });

    // Simulate trackside network failure on stopwatch-activities sync
    const blockStopwatchSync = (route: import('@playwright/test').Route) =>
      route.abort('failed');
    await page.route('**/api/teams/*/stopwatch-activities', blockStopwatchSync);

    await page.getByTestId('stopwatch-gun-btn').click();
    await page.waitForTimeout(350);
    await watchlessCard.click();
    await walkOnCard.click();

    await page.getByTestId('stopwatch-save-thresh').click();

    const outboxBanner = page.getByTestId('stopwatch-outbox-banner');
    await expect(outboxBanner).toBeVisible({ timeout: 10000 });
    await expect(outboxBanner).toContainText(/Pending Sync/i);

    const savedState = await page.evaluate(() => {
      const outbox = JSON.parse(localStorage.getItem('thresh_stopwatch_outbox_v1') || '[]');
      const walkOns = JSON.parse(localStorage.getItem('thresh_walkon_stopwatch_logs_v1') || '[]');
      return { outbox, walkOns };
    });
    expect(savedState.outbox.length).toBeGreaterThanOrEqual(1);
    const outboxMembershipIds = savedState.outbox.flatMap(
      (b: { entries: Array<{ membershipId: string }> }) =>
        b.entries.map((e) => e.membershipId)
    );
    expect(outboxMembershipIds).toEqual([rileyMembershipId]);
    expect(savedState.walkOns).toHaveLength(1);
    expect(savedState.walkOns[0].runnerName).toBe('Walk-On Sam');

    // Confirm feedback confirms isolated walk-on vs team outbox and never mentions attributing Walk-On to Coach SELF
    const feedback = page.getByTestId('stopwatch-save-feedback');
    await expect(feedback).toBeVisible();
    await expect(feedback).toContainText(/walk-on/i);

    // Reload while still offline for stopwatch sync -> #coach/stopwatch hash keeps Coach Stopwatch open & outbox banner persists
    await page.reload();
    const coachView = page.getByTestId('coach-workspace-view');
    await expect(coachView).toBeVisible({ timeout: 15000 });
    await openCoachStopwatchSubTab(page);

    await expect(page.getByTestId('stopwatch-outbox-banner')).toBeVisible({ timeout: 10000 });

    // Restore network and click Sync Now -> POST 200 clears outbox cleanly
    await page.unroute('**/api/teams/*/stopwatch-activities', blockStopwatchSync);
    const syncResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/teams/${teamId}/stopwatch-activities`) &&
        res.request().method() === 'POST'
    );
    await page.getByTestId('stopwatch-outbox-sync-now').click();
    const syncResp = await syncResponsePromise;
    expect(syncResp.status()).toBe(200);

    await expect(page.getByTestId('stopwatch-outbox-banner')).toHaveCount(0, { timeout: 10000 });
    const remainingOutbox = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('thresh_stopwatch_outbox_v1') || '[]')
    );
    expect(remainingOutbox).toHaveLength(0);

    expect(pageErrors).toEqual([]);
  });

  test('RT-13: Today Hero reconciles Impact Guardrail & Systemic CTL and Hide Tools toggles cleanly', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/?demo=1');
    const readinessBadge = page.getByTestId('morning-readiness-state-badge');
    await expect(readinessBadge).toBeVisible({ timeout: 15000 });
    await expect(readinessBadge).toContainText(/Impact Guardrail/i);
    await expect(readinessBadge).not.toContainText(/PRIME/i);

    await expect(page.getByTestId('readiness-guardrail-reconciliation')).toBeVisible();

    const systemicCtlBadge = page.getByText(/Systemic CTL\s+\d+(?:\.\d+)?/);
    await expect(systemicCtlBadge).toBeVisible({ timeout: 10000 });
    const systemicText = await systemicCtlBadge.innerText();
    const ctlMatch = systemicText.match(/Systemic CTL\s+(\d+(?:\.\d+)?)/);
    expect(ctlMatch).not.toBeNull();
    expect(Number(ctlMatch![1])).toBeGreaterThan(30);

    const toggleToolsBtn = page.getByTestId('toggle-guardrails-tools');
    await expect(toggleToolsBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(toggleToolsBtn).toContainText('Hide Tools');

    await toggleToolsBtn.click();
    await expect(toggleToolsBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(toggleToolsBtn).toContainText('Open Tools');
    await expect(systemicCtlBadge).toHaveCount(0);

    await toggleToolsBtn.click();
    await expect(toggleToolsBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(toggleToolsBtn).toContainText('Hide Tools');

    await page.getByRole('button', { name: /Impact & Run\/Bike Load/i }).click();
    await expect(systemicCtlBadge).toBeVisible({ timeout: 10000 });

    expect(pageErrors).toEqual([]);
  });

  test('RT-15 & RT-26: mobile header brand, Plan Builder 12-week Load Arc geometry, and /docs + /docs/coach.html routes', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/?demo=1#plan-builder');
    const brandLink = page.locator('header a[aria-label*="MeetReady"]');
    await expect(brandLink).toBeVisible({ timeout: 15000 });

    const viewport = page.viewportSize()!;
    const brandBox = await brandLink.boundingBox();
    expect(brandBox).not.toBeNull();
    expect(brandBox!.x).toBeGreaterThanOrEqual(0);
    expect(brandBox!.x + brandBox!.width).toBeLessThanOrEqual(viewport.width + 1);
    if (viewport.width < 640) {
      expect(brandBox!.height).toBeGreaterThanOrEqual(44);
    }

    const loadArc = page.getByTestId('plan-builder-load-arc');
    await expect(loadArc).toBeVisible({ timeout: 15000 });
    const weekSessionsHeading = page.getByText(/Week \d+ Sessions \(\d+\)/).first();
    await expect(weekSessionsHeading).toBeVisible({ timeout: 10000 });

    const loadArcBox = await loadArc.boundingBox();
    const sessionsBox = await weekSessionsHeading.boundingBox();
    expect(loadArcBox).not.toBeNull();
    expect(sessionsBox).not.toBeNull();
    if (viewport.width < 1024) {
      // Stacked on mobile/tablet: Load Arc must finish strictly above the Sessions heading
      expect(loadArcBox!.y + loadArcBox!.height).toBeLessThanOrEqual(sessionsBox!.y + 4);
    }

    const planOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(planOverflow).toBe(false);

    // RT-26: /docs (without trailing slash) must serve public/docs/index.html (NOT SPA fallback)
    const docsResp = await page.goto('/docs');
    expect(docsResp?.status()).toBe(200);
    await expect(page).toHaveTitle(/MeetReady.*Documentation|MeetReady User Guide/i);
    await expect(
      page.getByRole('heading', { name: /Sign in or create account/i })
    ).toHaveCount(0);
    const docsOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(docsOverflow).toBe(false);

    const coachDocsResp = await page.goto('/docs/coach.html');
    expect(coachDocsResp?.status()).toBe(200);
    const coachDocsOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(coachDocsOverflow).toBe(false);

    expect(pageErrors).toEqual([]);
  });
});
