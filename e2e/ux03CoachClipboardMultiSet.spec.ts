import { test, expect } from '@playwright/test';

test.describe('UX-03 Coach Clipboard Multi-Set Workout Builder & Event Groups', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '/* mock */' })
    );
    await page.route('https://fonts.gstatic.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
    );
  });

  test.skip(({ isMobile }) => isMobile, 'Desktop E2E flow');

  test('builds multi-set warm-up/working-sets/cooldown workout from shorthand for 800m/Mile group, assigns, and launches Stopwatch in Light & Dark modes', async ({
    page,
  }) => {
    await page.goto('/?demo=1');
    const toggleCoach = page.getByTestId('toggle-coach-workspace');
    await expect(toggleCoach).toBeVisible({ timeout: 15000 });
    await toggleCoach.click();

    await page.getByTestId('quick-ops-workouts-btn').click();
    await expect(page.getByTestId('coach-clipboard-builder')).toBeVisible({ timeout: 15000 });

    // Select 800m / Mile event group
    const midGroupChip = page.getByTestId('clipboard-group-MID_DISTANCE');
    await midGroupChip.click();
    await expect(midGroupChip).toHaveAttribute('aria-pressed', 'true');

    // Paste coach shorthand for Elliot's exact multi-set session
    const prompt =
      '2mi warm-up, 2x200m at 800m pace, 4x800m at mile pace, 2x200m at 400m pace, 2mi cooldown';
    await page.getByTestId('clipboard-shorthand-input').fill(prompt);
    await page.getByTestId('clipboard-parse-shorthand-btn').click();

    // Verify all 3 structured set rows populated accurately
    await expect(page.getByTestId('clipboard-set-row-0')).toBeVisible();
    await expect(page.getByTestId('clipboard-set-row-1')).toBeVisible();
    await expect(page.getByTestId('clipboard-set-row-2')).toBeVisible();
    await expect(page.getByLabel('Set 1 Distance')).toHaveValue('200');
    await expect(page.getByLabel('Set 2 Distance')).toHaveValue('800');
    await expect(page.getByLabel('Set 3 Distance')).toHaveValue('200');

    const podPreview = page.getByTestId('clipboard-pod-preview');
    await expect(podPreview).toContainText('2×200m');
    await expect(podPreview).toContainText('4×800m');

    // Assign workout to group calendar
    await page.getByTestId('clipboard-assign-workout-btn').click();
    await expect(page.getByText(/Assigned "/)).toBeVisible();

    // Verify Dark Mode legibility too
    await page.locator('button[aria-label*="Switch to Dark Mode"]').first().click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(podPreview).toBeVisible();

    // Stage in Trackside Stopwatch & verify Multi-Set banner
    await page.getByTestId('clipboard-launch-stopwatch-btn').click();
    await expect(page.getByRole('heading', { name: 'Trackside Stopwatch' })).toBeVisible({
      timeout: 10000,
    });
    const strip = page.getByTestId('stopwatch-multiset-plan-strip');
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('2×200m');
    await expect(strip).toContainText('4×800m');
  });
});
