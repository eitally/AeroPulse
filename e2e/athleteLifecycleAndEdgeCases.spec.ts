import { expect, test, type Page } from '@playwright/test';

async function mockGoogleFonts(page: Page) {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '/* mock */' })
  );
  await page.route('https://fonts.gstatic.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
  );
}

async function openRosterOrPersonalModeTab(page: Page) {
  const isMobile = Boolean(page.viewportSize() && page.viewportSize()!.width < 768);
  if (isMobile) {
    const mobileDock = page.locator('nav[aria-label="Mobile primary workspaces"]');
    await mobileDock.getByRole('button', { name: 'Roster' }).click();
  } else {
    await page.getByTestId('coach-subtab-roster').click();
  }
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
  const confirmBtn = page.getByRole('button', { name: /Complete Sign-In to THRESH/i });
  await expect(confirmBtn).toBeVisible({ timeout: 10000 });
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/api/auth/magic-link/verify')),
    confirmBtn.click(),
  ]);
}

test.describe('Athlete Team Lifecycle, Age Compliance & Account Deletion (Desktop & Mobile)', () => {
  test.beforeEach(async ({ page }) => {
    await mockGoogleFonts(page);
  });

  test('blocks under-13 COPPA accounts on Step 2 with clear guidance and zero overflow', async ({
    page,
    context,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await context.clearCookies();
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());

    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await signInViaDevMagicLink(page, `u13.check.${unique}@example.com`);

    const birthYearInput = page.locator('input[type="number"][min="1920"]');
    await expect(birthYearInput).toBeVisible({ timeout: 15000 });
    await birthYearInput.fill(String(new Date().getFullYear() - 10));

    await expect(page.getByTestId('join-coppa-u13-notice')).toBeVisible({ timeout: 10000 });
    const continueBtn = page.getByRole('button', { name: /Confirm.*Continue/i });
    await expect(continueBtn).toBeDisabled();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(overflow).toBe(false);
    expect(pageErrors).toEqual([]);
  });

  test('allows 18+ HS senior to join without parent email, switch to Personal Mode, update login email, leave team keeping workspace, and permanently delete account', async ({
    page,
    browser,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // 1. Create a High School team from an isolated authenticated Coach context
    const coachCtx = await browser.newContext();
    const coachReq = coachCtx.request;
    const coachLoginResp = await coachReq.post('/api/auth/mock-login', {
      data: {
        email: `coach.rivera.${unique}@school.edu`,
        name: 'Coach Rivera',
      },
    });
    expect(coachLoginResp.ok()).toBe(true);
    const teamResp = await coachReq.post('/api/teams', {
      data: {
        name: `Redwood HS Track ${unique}`,
        shortName: 'RWHS',
        orgType: 'HIGH_SCHOOL',
        primarySport: 'Running',
        coachDisplayName: 'Coach Rivera',
      },
    });
    expect(teamResp.ok()).toBe(true);
    const teamJson = await teamResp.json();
    const joinCode = teamJson.team.brand.joinCode as string;
    const teamId = teamJson.team.brand.teamId as string;
    await coachCtx.close();

    // 2. Sign in as an 18+ High School senior via Dev Magic Link carrying team join context
    const originalEmail = `senior.${unique}@school.edu`;
    const newPersonalEmail = `personal.${unique}@gmail.com`;
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await signInViaDevMagicLink(page, originalEmail, { joinCode });

    const birthYearInput = page.locator('input[type="number"][min="1920"]');
    await expect(birthYearInput).toBeVisible({ timeout: 15000 });

    // Entering an 18+ birth year on a HIGH_SCHOOL code must NOT require a parent/guardian email
    await birthYearInput.fill(String(new Date().getFullYear() - 19));
    await expect(page.getByText('*Required for Athletes Under 18')).toHaveCount(0);

    await page.getByRole('button', { name: new RegExp(`Join .*& Continue`, 'i') }).click();

    // Step 3 -> enter main workspace
    const skipBtn = page.getByRole('button', { name: /Skip for Now|Continue to THRESH/i });
    await expect(skipBtn).toBeVisible({ timeout: 15000 });
    await skipBtn.click();

    await expect(page.getByTestId('toggle-coach-workspace')).toBeVisible({ timeout: 15000 });

    // 3. Switch to Personal Mode cleanly via Team Panel
    await page.getByTestId('toggle-coach-workspace').click();
    await expect(page.getByTestId('coach-workspace-view')).toBeVisible({ timeout: 10000 });
    await openRosterOrPersonalModeTab(page);

    const personalModeBtn = page.getByTestId('team-personal-mode-btn');
    await expect(personalModeBtn).toBeVisible({ timeout: 10000 });
    await personalModeBtn.click();

    // Return to athlete Training view
    await page.getByTestId('toggle-coach-workspace').click();

    // 4. Open Account Menu -> Connections & Privacy -> Privacy Shield
    await page.getByRole('button', { name: /Account and preferences menu/i }).click();
    await page.getByTestId('open-roster-modal').click();
    await page.getByRole('tab', { name: /Privacy Shield/i }).click();

    // Update login email away from graduating .edu address (2-step code verification)
    const emailInput = page.getByTestId('account-change-email-input');
    await expect(emailInput).toBeVisible({ timeout: 10000 });
    await emailInput.fill(newPersonalEmail);
    await page.getByTestId('account-change-email-btn').click();
    const devCodeEl = page.getByTestId('account-change-email-dev-code');
    await expect(devCodeEl).toBeVisible({ timeout: 10000 });
    const devCodeText = (await devCodeEl.textContent()) || '';
    const devCodeMatch = devCodeText.match(/(\d{6})/);
    expect(devCodeMatch).not.toBeNull();
    await page.getByTestId('account-change-email-code-input').fill(devCodeMatch![1]);
    await page.getByTestId('account-change-email-btn').click();
    await expect(page.getByText(/Login email updated/i)).toBeVisible({ timeout: 10000 });

    // Leave team while keeping solo workspace intact (2-step confirmation)
    await page.getByTestId(`privacy-leave-team-${teamId}`).click();
    await page.getByTestId(`privacy-leave-team-confirm-${teamId}`).click();
    await expect(page.getByText(/Left team/i)).toBeVisible({ timeout: 10000 });

    const modalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(modalOverflow).toBe(false);

    // 5. Permanently delete THRESH account with "DELETE" confirmation -> lands back at Auth Gate
    await page.getByTestId('account-delete-open-btn').click();
    const submitDeleteBtn = page.getByTestId('account-delete-submit-btn');
    await expect(submitDeleteBtn).toBeDisabled();
    await page.getByTestId('account-delete-confirm-input').fill('DELETE');
    await expect(submitDeleteBtn).toBeEnabled();
    await submitDeleteBtn.click();

    await expect(page.getByRole('button', { name: /Connect with Strava/i })).toBeVisible({
      timeout: 15000,
    });
    expect(pageErrors).toEqual([]);
  });
});
