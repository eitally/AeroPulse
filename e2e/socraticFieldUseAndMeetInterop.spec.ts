import { expect, test, type Page } from '@playwright/test';

async function mockGoogleFonts(page: Page) {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '/* mock */' })
  );
  await page.route('https://fonts.gstatic.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
  );
}

async function signInViaDevMagicLink(page: Page, email: string) {
  const res = await page.request.post('/api/auth/magic-link/send', {
    data: { email },
  });
  expect(res.ok()).toBe(true);
  const payload = (await res.json()) as { previewUrl?: string };
  expect(payload.previewUrl).toBeTruthy();
  const parsed = new URL(payload.previewUrl!);
  await page.goto(`${parsed.pathname}${parsed.search}`);
  const confirmBtn = page.getByRole('button', { name: /Complete Sign-In to MeetReady/i });
  await expect(confirmBtn).toBeVisible({ timeout: 10000 });
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/api/auth/magic-link/verify')),
    confirmBtn.click(),
  ]);

  const confirmStep2Btn = page.getByRole('button', { name: /Confirm.*Continue/i });
  const switchAthleteBtn = page.getByRole('button', {
    name: /Switch to personal Athlete setup instead/i,
  });
  await expect(switchAthleteBtn.or(confirmStep2Btn)).toBeVisible({ timeout: 15000 });
  if (await switchAthleteBtn.isVisible()) {
    await switchAthleteBtn.click();
  }
  await expect(confirmStep2Btn).toBeVisible({ timeout: 15000 });
  const birthYearInput = page.locator('input[type="number"][min="1920"]');
  if (
    (await birthYearInput.count()) > 0 &&
    (await birthYearInput.first().isVisible()) &&
    !(await birthYearInput.first().inputValue())
  ) {
    await birthYearInput.first().fill('1994');
  }
  await confirmStep2Btn.click();

  const enterWorkspaceBtn = page.getByRole('button', {
    name: /Skip for Now — Enter MeetReady|Continue to MeetReady/i,
  });
  await expect(enterWorkspaceBtn).toBeVisible({ timeout: 15000 });
  await enterWorkspaceBtn.click();
}

test.describe('Socratic Field-Use: 3:15 PM Quick Ops, Delegated Pocket Timing & External Meet Interop', () => {
  test.beforeEach(async ({ page }) => {
    await mockGoogleFonts(page);
  });

  test('Desktop (1440x900): 3:15 PM Quick Ops, External Meet Heat Sheet Import, Clerk Override, Full-Team Export Guard & Coach Roll Call safety', async ({
    page,
  }) => {
    test.skip(Boolean(page.viewportSize() && page.viewportSize()!.width < 768), 'Desktop only');

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/?demo=1&sample=coach');
    await expect(page.getByTestId('coach-workspace-view')).toBeVisible({ timeout: 15000 });

    // 1. 3:15 PM Quick Ops strip sits immediately at top of Clipboard
    const quickOps = page.getByTestId('coach-quick-ops-strip');
    await expect(quickOps).toBeVisible();
    await expect(page.getByTestId('quick-ops-roll-call-btn')).toBeVisible();
    await expect(page.getByTestId('quick-ops-stopwatch-btn')).toBeVisible();
    await expect(page.getByTestId('quick-ops-delegate-timing-btn')).toBeVisible();
    await expect(page.getByTestId('quick-ops-pending-splits-btn')).toBeVisible();

    // 2. Roll Call unmarked safety check (never silently mark unmarked athletes PRESENT)
    const rollCounts = page.getByTestId('roll-call-counts');
    await expect(rollCounts).toBeVisible();
    await expect(rollCounts).toContainText(/unmarked/i);
    await page.getByTestId('roll-call-save-btn').click();
    await expect(page.getByTestId('roll-call-saved-banner')).toBeVisible();
    await expect(page.getByTestId('coach-daily-ops-panel')).not.toContainText('1-Tap Roll Call (12/12 Present)');

    // 3. Open Delegate Timing Modal cleanly from Quick Ops
    await page.getByTestId('quick-ops-delegate-timing-btn').click();
    const delegateModal = page.getByTestId('coach-delegate-timing-modal');
    await expect(delegateModal).toBeVisible({ timeout: 10000 });
    await page.getByTestId('create-delegated-pass-btn').click();
    await expect(delegateModal).toContainText(/Active Timing Passes/i);
    await page.getByRole('button', { name: /Close Delegated Timing/i }).click();
    await expect(delegateModal).toHaveCount(0);

    // 4. Open Meet-Day Packet -> verify EXTERNAL_MEET default (no fake lanes) + Hy-Tek paste + Clerk Override + Full-Team Export Guard
    await page.getByTestId('coach-open-meet-packet-btn').click();
    const meetModal = page.getByTestId('meet-day-packet-modal');
    await expect(meetModal).toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId('meet-authority-external')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('meet-tab-heats').click();
    await expect(meetModal).toContainText('TBD (Official Program)');
    await page.getByTestId('meet-tab-entries').click();

    // Paste external Friday-night heat sheet
    await page.getByTestId('toggle-external-heat-import-btn').click();
    await page.getByTestId('external-heat-sheet-textarea').fill(
      [
        'Event 14 Boys 1600m Run',
        'Heat 2',
        'Lane 7 Lucas Alvarez 4:24.10',
        'Lane 3 Nolan Brooks 4:27.90',
      ].join('\n')
    );
    await expect(page.getByTestId('external-import-matched-count')).toContainText(/[1-9]\d* matched/i);
    await page.getByTestId('external-import-merge-btn').click();
    await expect(meetModal).toContainText(/H2\s+(?:Lane|Ln|Box\/Hip)\s+7|Heat 2/i);

    // Filtering by Boys triggers explicit Full-Team vs Filtered-Only export guard
    await page.getByTestId('meet-filter-gender-m').click();
    const exportBanner = page.getByTestId('meet-export-scope-banner');
    await expect(exportBanner).toBeVisible();
    await expect(page.getByTestId('meet-export-scope-full')).toHaveAttribute('aria-pressed', 'true');

    expect(pageErrors).toEqual([]);
  });

  test('Mobile (390x844): Unauthenticated Pocket Timing Pad (/time/:passCode) isolates zero PII, supports Swap Last 2 & Per-Runner Undo, and submits to Coach Review Queue', async ({
    page,
    browser,
  }) => {
    test.skip(Boolean(page.viewportSize() && page.viewportSize()!.width >= 768), 'Mobile only');

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const secretEmailA = `jordan.secret.${unique}@family.example.org`;
    const secretEmailB = `ethan.secret.${unique}@family.example.org`;

    // 1. Coach signs in and creates a real team + 2 invited athletes + delegated timing pass
    await signInViaDevMagicLink(page, `coach.delegate.${unique}@example.com`);
    const teamResp = await page.request.post('/api/teams', {
      data: {
        name: `MeetReady Timers HS ${unique}`,
        shortName: 'MRHS',
        orgType: 'HIGH_SCHOOL',
        primarySport: 'Running',
        coachDisplayName: 'Coach Morales',
      },
    });
    expect(teamResp.ok()).toBe(true);
    const teamJson = (await teamResp.json()) as {
      team?: { brand?: { teamId: string }; memberships?: Array<{ membershipId: string }> };
    };
    const teamId = teamJson.team?.brand?.teamId || '';
    expect(teamId).toBeTruthy();

    await page.request.post(`/api/teams/${encodeURIComponent(teamId)}/members`, {
      data: {
        invitedName: 'Jordan Mendoza',
        invitedEmail: secretEmailA,
        squadGroup: 'Boys Distance',
        role: 'ATHLETE',
      },
    });
    await page.request.post(`/api/teams/${encodeURIComponent(teamId)}/members`, {
      data: {
        invitedName: 'Ethan Patel',
        invitedEmail: secretEmailB,
        squadGroup: 'Boys Distance',
        role: 'ATHLETE',
      },
    });

    const todayIso = new Date().toISOString().slice(0, 10);
    const passResp = await page.request.post(
      `/api/teams/${encodeURIComponent(teamId)}/timing-sessions`,
      {
        data: {
          meetTitle: 'Central Coast Invite',
          meetDate: todayIso,
          eventCode: '1600m',
          eventLabel: 'Boys 1600m',
          heatLabel: 'Heat 2',
          stationType: '200M_MARK',
          stationLabel: '200m Mark',
          splitPlanLabel: '400m splits from 200m mark',
          targetSplitMeters: 400,
          targetLapCount: 4,
          runners: [
            { displayName: 'Jordan Mendoza', hipOrLane: 'Hip 4' },
            { displayName: 'Ethan Patel', hipOrLane: 'Hip 8' },
          ],
        },
      }
    );
    expect(passResp.ok()).toBe(true);
    const passJson = (await passResp.json()) as {
      session?: { passCode?: string };
    };
    const passCode = passJson.session?.passCode || '';
    expect(passCode).toBeTruthy();

    // 2. Open /time/:passCode in a clean unauthenticated 390x844 mobile context
    const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const guestPage = await guestContext.newPage();
    await mockGoogleFonts(guestPage);

    await guestPage.goto(`/time/${encodeURIComponent(passCode)}`);
    const pad = guestPage.getByTestId('delegated-timing-pad-page');
    await expect(pad).toBeVisible({ timeout: 15000 });

    // Zero PII leak: student emails never appear anywhere in DOM/source
    const bodyText = await guestPage.locator('body').innerText();
    expect(bodyText).not.toContain(secretEmailA);
    expect(bodyText).not.toContain(secretEmailB);
    expect(bodyText).toContain('Central Coast Invite');

    // Touch target & zero horizontal overflow check
    const overflow = await guestPage.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow).toBeLessThanOrEqual(2);
    const gunBtn = guestPage.getByTestId('delegated-gun-btn');
    const gunBox = await gunBtn.boundingBox();
    expect(gunBox?.height).toBeGreaterThanOrEqual(44);

    // Start Gun -> record two rapid splits -> test ⇄ Swap Last 2 -> test Per-Runner ↺ Undo
    await gunBtn.click();
    await guestPage.waitForTimeout(250);
    await guestPage.getByTestId('runner-card-0').click();
    await guestPage.waitForTimeout(120);
    await guestPage.getByTestId('runner-card-1').click();

    await expect(guestPage.getByTestId('runner-inline-laps-0')).toBeVisible();
    await expect(guestPage.getByTestId('delegated-swap-last-two-btn')).toBeVisible();
    await guestPage.getByTestId('delegated-swap-last-two-btn').click();

    await expect(guestPage.getByTestId('runner-undo-1')).toBeVisible();
    await guestPage.getByTestId('runner-undo-1').click();
    await expect(guestPage.getByTestId('runner-undo-1')).toHaveCount(0);

    // Hold 0.45s to Pause -> fill timer name -> submit staged splits
    const pauseBox = await gunBtn.boundingBox();
    expect(pauseBox).not.toBeNull();
    await guestPage.mouse.move(pauseBox!.x + pauseBox!.width / 2, pauseBox!.y + pauseBox!.height / 2);
    await guestPage.mouse.down();
    await guestPage.waitForTimeout(550);
    await guestPage.mouse.up();

    await guestPage.getByLabel('Your Name').fill('Captain Maya');
    await guestPage.getByTestId('delegated-send-splits-btn').click();
    await expect(guestPage.getByTestId('delegated-submit-status')).toContainText(/Pending|Coach/i, {
      timeout: 10000,
    });

    await guestContext.close();

    // 3. Coach opens Quick Ops -> Pending Splits (1) -> Approves submission cleanly
    await page.goto('/');
    const coachView = page.getByTestId('coach-workspace-view');
    const toggleCoachBtn = page.getByTestId('toggle-coach-workspace');
    await expect(coachView.or(toggleCoachBtn)).toBeVisible({ timeout: 15000 });
    if ((await toggleCoachBtn.isVisible()) && !(await coachView.isVisible())) {
      await toggleCoachBtn.click();
    }
    await expect(coachView).toBeVisible({ timeout: 15000 });
    const pendingBtn = page.getByTestId('quick-ops-pending-splits-btn');
    await expect(pendingBtn).toContainText('Pending Splits (1)', { timeout: 10000 });
    await pendingBtn.click();

    const modal = page.getByTestId('coach-delegate-timing-modal');
    await expect(modal).toBeVisible({ timeout: 10000 });
    await expect(modal).toContainText('Captain Maya');
    const approveBtn = modal.getByRole('button', { name: /Approve & Attach/i }).first();
    await approveBtn.click();
    await expect(modal).toContainText(/APPROVED/i, { timeout: 10000 });

    expect(pageErrors).toEqual([]);
  });
});
