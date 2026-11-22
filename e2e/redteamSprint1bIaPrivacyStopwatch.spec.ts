import { expect, test, type Page } from '@playwright/test';

async function mockGoogleFonts(page: Page) {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '/* mock */' })
  );
  await page.route('https://fonts.gstatic.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
  );
}

async function signInViaDevMagicLink(
  page: Page,
  email: string,
  joinOpts?: { joinCode?: string; slug?: string }
) {
  const res = await page.request.post('/api/auth/magic-link/send', {
    data: {
      email,
      ...(joinOpts?.joinCode ? { joinCode: joinOpts.joinCode } : {}),
      ...(joinOpts?.slug ? { slug: joinOpts.slug } : {}),
    },
  });
  expect(res.ok()).toBe(true);
  const payload = await res.json();
  expect(payload.previewUrl).toBeTruthy();
  const parsed = new URL(payload.previewUrl);
  await page.goto(`${parsed.pathname}${parsed.search}`);
  const confirmBtn = page.getByRole('button', { name: /Complete Sign-In to MeetReady/i });
  await expect(confirmBtn).toBeVisible({ timeout: 10000 });
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/api/auth/magic-link/verify')),
    confirmBtn.click(),
  ]);
}

test.describe('Sprint 1B E2E: 4-Pillar IA, Standalone #progress, Post-Join Privacy, Last Session & Mobile Stopwatch (RT-14, RT-24, RT-25)', () => {
  test.beforeEach(async ({ page }) => {
    await mockGoogleFonts(page);
  });

  test('Desktop (1440x900): separates standalone #progress from Today, syncs hash, exposes Last Run + Plain Language + 1440px team switcher + post-join privacy tier', async ({
    page,
    browser,
  }) => {
    test.skip(Boolean(page.viewportSize() && page.viewportSize()!.width < 768), 'Desktop only');
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // 1. Sample Demo Today -> Last Session strip & Plain Language persistence
    await page.goto('/?demo=1');
    const nav = page.locator('nav[aria-label="Primary workspaces"]');
    await expect(nav).toBeVisible({ timeout: 15000 });
    for (const label of ['Today', 'Training Calendar', 'Progress', 'Plan Builder']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }

    const lastRunStrip = page.getByTestId('today-last-run-strip');
    await expect(lastRunStrip).toBeVisible({ timeout: 10000 });
    await expect(lastRunStrip).toContainText('Morning Aerobic Base Loop');

    // Default uses technical term Optimal Tunnel -> toggling Plain Language changes to Healthy Weekly Range and persists
    await expect(page.getByText(/Optimal Tunnel:/i).first()).toBeVisible();
    await page.getByRole('button', { name: /Account and preferences menu/i }).click();
    await expect(page.getByTestId('open-roster-modal')).toContainText('Account, Teams & Privacy');
    await expect(page.getByTestId('open-roster-modal')).not.toContainText('1:1');
    await page.getByTestId('toggle-plain-language').click();
    await page.keyboard.press('Escape');

    await expect(page.getByText(/Healthy Weekly Range:/i).first()).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Healthy Weekly Range:/i).first()).toBeVisible({ timeout: 15000 });

    // Clicking Inspect on Last Session opens in-place Activity Inspector without leaving Today
    await page.getByTestId('today-last-run-inspect-btn').click();
    await expect(page.getByTestId('activity-inspector-tabs')).toBeVisible({ timeout: 10000 });
    await page.keyboard.press('Escape');

    // 2. Clicking Progress navigates cleanly to standalone #curves without Today stacked above and with single visible H1
    await nav.getByRole('link', { name: 'Progress' }).click();
    await expect.poll(() => new URL(page.url()).hash).toBe('#curves');
    const progressView = page.getByTestId('standalone-progress-view');
    await expect(progressView).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Morning Readiness' })).toHaveCount(0);
    const visibleH1Count = await page.locator('h1:visible').count();
    expect(visibleH1Count).toBe(1);

    // Direct #charts hash opens Custom Correlation Lab directly inside Progress
    await page.goto('/?demo=1#charts');
    await expect(page.getByTestId('standalone-progress-view')).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole('heading', { name: /Custom Chart Builder & Correlation Lab/i })
    ).toBeVisible();

    // 3. Authenticated athlete: 1440px multi-team switcher + post-join sharingTier + Leave confirmation
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const coachCtx = await browser.newContext();
    const coachReq = coachCtx.request;
    await coachReq.post('/api/auth/mock-login', {
      data: { email: `coach.mb.${unique}@school.edu`, name: 'Coach Multi' },
    });
    const t1 = await (
      await coachReq.post('/api/teams', {
        data: {
          name: `Northside TC ${unique}`,
          shortName: 'NSTC',
          orgType: 'RUNNING_CLUB',
          primarySport: 'Running',
          coachDisplayName: 'Coach Multi',
        },
      })
    ).json();
    const t2 = await (
      await coachReq.post('/api/teams', {
        data: {
          name: `Southside Track ${unique}`,
          shortName: 'SSTC',
          orgType: 'RUNNING_CLUB',
          primarySport: 'Running',
          coachDisplayName: 'Coach Multi',
        },
      })
    ).json();
    await coachCtx.close();

    const team1Id = t1.team.brand.teamId as string;
    const team1Code = t1.team.brand.joinCode as string;
    const team2Code = t2.team.brand.joinCode as string;

    const athleteEmail = `multi.ath.${unique}@example.com`;
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await signInViaDevMagicLink(page, athleteEmail, { joinCode: team1Code });

    const birthYearInput = page.locator('input[type="number"][min="1920"]');
    await expect(birthYearInput).toBeVisible({ timeout: 15000 });
    await birthYearInput.fill('1999');
    await page.getByRole('button', { name: /Join .*& Continue/i }).click();
    await page.getByRole('button', { name: /Skip for Now|Continue to MeetReady/i }).click();

    // Join second team via API under the same browser cookie context & reload to populate myTeams(2)
    await page.request.post('/api/teams/join-claim', {
      data: { codeOrSlug: team2Code, athleteName: 'Multi Runner', birthMonthYear: '1999-05' },
    });
    await page.reload();

    // 1440px multi-team switcher in CockpitHeader MUST be visible at 1440x900 (fixing 2xl gap)
    const teamSwitcher = page.getByLabel('Switch Active Team Workspace', { exact: true });
    await expect(teamSwitcher).toBeVisible({ timeout: 15000 });

    // Open Account, Teams & Privacy -> Privacy Shield -> adjust team sharingTier & test Cancel + Confirm Leave
    await page.getByRole('button', { name: /Account and preferences menu/i }).click();
    await page.getByTestId('open-roster-modal').click();
    await page.getByRole('tab', { name: /Privacy Shield/i }).click();

    const tierSelect = page.getByTestId(`team-sharing-tier-${team1Id}`);
    await expect(tierSelect).toBeVisible({ timeout: 10000 });
    await tierSelect.selectOption('LOAD_ONLY');
    await expect(page.getByText(/Load & Readiness Only/i).first()).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: /Account and preferences menu/i }).click();
    await page.getByTestId('open-roster-modal').click();
    await page.getByRole('tab', { name: /Privacy Shield/i }).click();
    await expect(page.getByTestId(`team-sharing-tier-${team1Id}`)).toHaveValue('LOAD_ONLY');

    // Cancel leave preserves membership; Confirm Leave executes departure
    await page.getByTestId(`privacy-leave-team-${team1Id}`).click();
    await expect(page.getByTestId(`privacy-leave-team-confirm-${team1Id}`)).toBeVisible();
    await page.getByTestId(`privacy-leave-team-cancel-${team1Id}`).click();
    await expect(page.getByTestId(`team-sharing-tier-${team1Id}`)).toBeVisible();

    await page.getByTestId(`privacy-leave-team-${team1Id}`).click();
    await page.getByTestId(`privacy-leave-team-confirm-${team1Id}`).click();
    await expect(page.getByText(/Left team\./i)).toBeVisible({ timeout: 10000 });

    expect(pageErrors).toEqual([]);
  });

  test('Mobile (390x844): Stopwatch hides MobileDock/Footer, shows bottom thumb bar with Hold-to-Pause, rep stepper, 350ms split debounce & WCAG 2.1.4 shortcut toggle', async ({
    page,
  }) => {
    test.skip(Boolean(page.viewportSize() && page.viewportSize()!.width >= 768), 'Mobile only');
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/?demo=1#stopwatch');
    await page.evaluate(() => {
      localStorage.removeItem('thresh_trackside_stopwatch_v1');
      localStorage.removeItem('thresh_stopwatch_shortcuts_v1');
    });
    await page.reload();

    await expect(page.getByRole('heading', { name: 'Trackside Stopwatch' })).toBeVisible({
      timeout: 15000,
    });

    // MobileDock & Footer suppressed inside Stopwatch; dedicated bottom thumb bar is visible
    await expect(page.locator('nav[aria-label="Mobile primary workspaces"]')).toHaveCount(0);
    await expect(page.locator('footer')).toHaveCount(0);
    const thumbBar = page.getByTestId('stopwatch-mobile-thumb-bar');
    await expect(thumbBar).toBeVisible();

    // 4x800m preset + inline rep stepper & quick distance buttons
    const presetSelect = page.getByLabel('Workout Preset');
    await presetSelect.selectOption('4x800');
    await expect(page.getByTestId('stopwatch-rep-count')).toHaveText('4 reps');
    await page.getByTestId('stopwatch-rep-inc').click();
    await expect(page.getByTestId('stopwatch-rep-count')).toHaveText('5 reps');
    await page.getByTestId('stopwatch-dist-400').click();
    await expect(page.getByTestId('stopwatch-dist-400')).toHaveAttribute('aria-pressed', 'true');

    // Add a runner and test 1-tap Start Gun + Hold-to-Pause protection against accidental tap
    await page.getByLabel('Walk-On Runner Name').fill('Maya Lin');
    await page.getByRole('button', { name: 'Add Runner' }).click();

    const mobileGunBtn = page.getByTestId('stopwatch-mobile-gun-btn');
    await mobileGunBtn.click();
    await expect(mobileGunBtn).toContainText('Hold Pause');

    // Short tap must NOT pause running stopwatch
    await page.waitForTimeout(200);
    await mobileGunBtn.click();
    await expect(mobileGunBtn).toContainText('Hold Pause');

    // 350ms double-tap debounce: rapid double tap records only 1 split
    const runnerCard = page.getByTestId('runner-card-0');
    await runnerCard.click();
    await page.waitForTimeout(80);
    await runnerCard.click();
    await expect(runnerCard).not.toContainText('Tap Split');
    await page.getByTestId('stopwatch-view-matrix').click();
    const matrix = page.getByTestId('stopwatch-matrix-table');
    await expect(matrix).toBeVisible();
    await expect(matrix.getByRole('columnheader', { name: 'L1' })).toBeVisible();
    await expect(matrix.getByRole('columnheader', { name: 'L2' })).toHaveCount(0);
    await page.getByTestId('stopwatch-view-cards').click();

    // WCAG 2.1.4: disabling keyboard shortcuts blocks 'c' from queuing Chute marks
    await page.getByTestId('stopwatch-tools-btn').click();
    const shortcutsToggle = page.getByTestId('stopwatch-shortcuts-toggle');
    await expect(shortcutsToggle).toHaveAttribute('aria-pressed', 'true');
    await shortcutsToggle.click();
    await expect(shortcutsToggle).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('c');
    await expect(page.getByTestId('chute-pill-0')).toHaveCount(0);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(overflow).toBe(false);
    expect(pageErrors).toEqual([]);
  });
});
