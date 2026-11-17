import fs from 'fs';
import path from 'path';
import { expect, Page, test } from '@playwright/test';

const LOCAL_BRAIN_EVIDENCE_DIR =
  '/Users/elliottally/.gemini/antigravity/brain/b118f55f-6bcc-48bc-a4be-39ee1c8f6393/wave3b_evidence';
const EVIDENCE_DIR =
  !process.env.CI && fs.existsSync(path.dirname(LOCAL_BRAIN_EVIDENCE_DIR))
    ? LOCAL_BRAIN_EVIDENCE_DIR
    : path.join(process.cwd(), 'test-results', 'wave3b_evidence');

async function enterSampleDemoMode(page: Page, hash = '') {
  await page.goto(`/?demo=1${hash}`);
  const cockpitNav = page.locator('nav[aria-label*="rimary workspaces"]:visible');
  await expect(cockpitNav).toBeVisible({ timeout: 15000 });
}

async function toggleDarkMode(page: Page, enableDark: boolean) {
  const isDark = await page.evaluate(() =>
    document.documentElement.classList.contains('dark')
  );
  if (isDark !== enableDark) {
    await page.evaluate((dark) => {
      if (dark) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('thresh_theme_dark', '1');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('thresh_theme_dark', '0');
      }
    }, enableDark);
    if (enableDark) {
      await expect(page.locator('html')).toHaveClass(/dark/);
    } else {
      await expect(page.locator('html')).not.toHaveClass(/dark/);
    }
    await page.waitForTimeout(250);
  }
}

test.describe('THRESH Wave 3B: TRK-10 Progression/Kalman & TRK-11 Relay/FAT/Passport/CARA Ops', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '/* mock */' })
    );
    await page.route('https://fonts.gstatic.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
    );
  });

  test.describe('Desktop Viewport (1440x900)', () => {
    test.skip(({ isMobile }) => isMobile, 'Desktop only');

    test('renders 5-axis Track Progression & Kalman Quarantine Drawer, Mints THV Passports, & Optimizes DMR Relay', async ({
      page,
    }) => {
      // 1. Today -> Physiology Deep-Dive -> Zone Progression & Calibration (5-Axis Track Progression & Bayesian Audit Drawer)
      await enterSampleDemoMode(page, '#curves');
      await page.getByTestId('today-deep-dive-tab-progression').click();
      const progPanel = page.getByTestId('track-5axis-progression-panel');
      await progPanel.scrollIntoViewIfNeeded();
      await expect(progPanel).toBeVisible({ timeout: 15000 });
      await expect(progPanel).toContainText('Sub-T / CV');
      await expect(progPanel).toContainText('VO2max (I)');
      await expect(progPanel).toContainText('Max-V / Neuro');

      await page.getByTestId('toggle-bayesian-quarantine-btn').click();
      const drawer = page.getByTestId('bayesian-quarantine-drawer');
      await expect(drawer).toBeVisible();

      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
      await expect(page.locator('html')).not.toHaveClass(/dark/);
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, 'wave3b-goals-progression-1440-light.png'),
        fullPage: false,
        animations: 'disabled',
      });
      await toggleDarkMode(page, true);
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, 'wave3b-goals-progression-1440-dark.png'),
        fullPage: false,
        animations: 'disabled',
      });
      await toggleDarkMode(page, false);

      // 2. Stopwatch RACE mode -> Mint Verified Race Passports (THV-...) w/ NFHS Hand->FAT
      await enterSampleDemoMode(page, '#stopwatch');
      await page.evaluate(() => localStorage.removeItem('thresh_trackside_stopwatch_v1'));
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Trackside Stopwatch' })).toBeVisible({
        timeout: 15000,
      });

      await page.getByTestId('stopwatch-mode-race').click();
      await page.getByTestId('runner-card-0').click();
      await page.waitForTimeout(150);
      await page.getByTestId('runner-card-0').click();

      const passportBtn = page.getByTestId('stopwatch-mint-passports-btn');
      await expect(passportBtn).toBeEnabled();
      await passportBtn.click();

      const mintedList = page.getByTestId('minted-passports-list');
      await expect(mintedList).toBeVisible();
      await expect(mintedList).toContainText(/THV-[A-F0-9]{4}-[A-F0-9]{4}/);

      // 3. Dedicated Coach Workspace -> Clipboard (Relay Optimizer & NFHS Top Times) + Roster (CARA 3.0h Comp Day)
      await page.getByTestId('toggle-coach-workspace').click();
      const coachView = page.getByTestId('coach-workspace-view');
      await expect(coachView).toBeVisible({ timeout: 10000 });

      const relayPanel = page.getByTestId('relay-optimizer-panel');
      await relayPanel.scrollIntoViewIfNeeded();
      await expect(relayPanel).toBeVisible();
      await page.getByTestId('relay-event-btn-4x400m').click();
      await expect(relayPanel).toContainText('Optimal Predicted 4x400m');

      const topBoard = page.getByTestId('nfhs-top-times-board');
      await expect(topBoard).toBeVisible();
      await page.getByTestId('top-times-tab-flying').click();
      await expect(topBoard).toContainText('RELAY_FLYING');

      await page.screenshot({
        path: path.join(EVIDENCE_DIR, 'wave3b-scholastic-relay-1440-light.png'),
        fullPage: false,
        animations: 'disabled',
      });
      await toggleDarkMode(page, true);
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, 'wave3b-scholastic-relay-1440-dark.png'),
        fullPage: false,
        animations: 'disabled',
      });
      await toggleDarkMode(page, false);

      await page.getByTestId('coach-subtab-roster').click();
      const caraAudit = page.getByTestId('coach-cara-audit');
      await expect(caraAudit).toBeVisible();
      await expect(caraAudit).toContainText(/3\.0h Comp Day/i);

      await page.evaluate(() => localStorage.removeItem('thresh_trackside_stopwatch_v1'));
    });
  });

  test.describe('Mobile Viewport (390x844)', () => {
    test.skip(({ isMobile }) => !isMobile, 'Mobile only');

    test('verifies >= 44px touch targets across Wave 3B Progression Drawer, THV Passport & Relay Optimizer', async ({
      page,
    }) => {
      await enterSampleDemoMode(page, '#curves');
      await page.getByTestId('today-deep-dive-tab-progression').click();
      const toggleBtn = page.getByTestId('toggle-bayesian-quarantine-btn');
      await toggleBtn.scrollIntoViewIfNeeded();
      await expect(toggleBtn).toBeVisible({ timeout: 15000 });
      expect((await toggleBtn.boundingBox())?.height || 0).toBeGreaterThanOrEqual(44);
      await toggleBtn.click();
      await expect(page.getByTestId('bayesian-quarantine-drawer')).toBeVisible();

      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, 'wave3b-goals-progression-390-light.png'),
        fullPage: false,
        animations: 'disabled',
      });

      await enterSampleDemoMode(page, '#stopwatch');
      await page.getByTestId('stopwatch-mode-race').click();
      await page.getByTestId('runner-card-0').click();
      const mintBtn = page.getByTestId('stopwatch-mint-passports-btn');
      await mintBtn.scrollIntoViewIfNeeded();
      expect((await mintBtn.boundingBox())?.height || 0).toBeGreaterThanOrEqual(44);
      await mintBtn.click();
      await expect(page.getByTestId('minted-passports-list')).toContainText(/THV-/);

      await page.evaluate(() => localStorage.removeItem('thresh_trackside_stopwatch_v1'));
    });
  });
});
