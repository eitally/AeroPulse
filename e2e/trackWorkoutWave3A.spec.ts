import fs from 'fs';
import path from 'path';
import { expect, Page, test } from '@playwright/test';

const LOCAL_BRAIN_EVIDENCE_DIR =
  '/Users/elliottally/.gemini/antigravity/brain/b118f55f-6bcc-48bc-a4be-39ee1c8f6393/wave3a_evidence';
const EVIDENCE_DIR =
  !process.env.CI && fs.existsSync(path.dirname(LOCAL_BRAIN_EVIDENCE_DIR))
    ? LOCAL_BRAIN_EVIDENCE_DIR
    : path.join(process.cwd(), 'test-results', 'wave3a_evidence');

async function enterSampleDemoStopwatch(page: Page) {
  await page.goto('/?demo=1#stopwatch');
  const cockpitNav = page.locator('nav[aria-label*="rimary workspaces"]:visible');
  await expect(cockpitNav).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('heading', { name: 'Trackside Stopwatch' })).toBeVisible({
    timeout: 15000,
  });
}

async function seedAutoRegStopwatchState(
  page: Page,
  timestampsSecs: number[],
  zoneCode: 'I' | 'CV' = 'I'
) {
  await page.evaluate(
    ({ timestamps, zCode }) => {
      const payload = {
        isRunning: false,
        startedAtEpochMs: null,
        accumulatedMs: Math.round((timestamps[timestamps.length - 1] || 210) * 1000),
        athleteLapTimestampsSecs: { SELF: timestamps },
        tapHistory: timestamps.map((ts, idx) => ({
          runnerId: 'SELF',
          runnerName: 'Self Athlete',
          timestampSecs: ts,
          kind: 'RUNNER_SPLIT',
          ...(idx === timestamps.length - 1 ? { previousLastTapEpochMs: Date.now() - 5000 } : {}),
        })),
        extraPodAthletes: [],
        sessionType: 'WORKOUT',
        viewMode: 'CARDS',
        showChuteBar: false,
        workoutPresetId: 'custom-plan',
        customWorkoutSpec: {
          repCount: 6,
          repDistanceMeters: 400,
          zoneCode: zCode,
          podIntensity: zCode === 'CV' ? 'THRESHOLD_CV' : 'INTERVAL_VO2',
          targetSplitSecs: 85.0,
          restDurationSecs: 60,
          waveMode: 'MASS',
        },
        restDurationSecs: 60,
        waveMode: 'MASS',
      };
      localStorage.setItem('thresh_trackside_stopwatch_v1', JSON.stringify(payload));
    },
    { timestamps: timestampsSecs, zCode: zoneCode }
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Trackside Stopwatch' })).toBeVisible({
    timeout: 15000,
  });
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

test.describe('THRESH Wave 3A: TRK-08 Live #stopwatch Auto-Regulated Coaching Cues & Pivots', () => {
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

    test('triggers CV_CONVERSION_PIVOT & NEURO_STOP_RULE cues and executes 1-tap pivots', async ({
      page,
    }) => {
      await enterSampleDemoStopwatch(page);
      // 3 reps: 85.0s, 87.6s (+3.1%), 87.9s (+3.4%) => 2 consecutive >2.5% fades -> CV_CONVERSION_PIVOT
      await seedAutoRegStopwatchState(page, [85.0, 172.6, 260.5], 'I');

      const banner = page.getByTestId('stopwatch-autoreg-banner');
      await expect(banner).toBeVisible();
      await expect(banner).toContainText(/Pivot to CV/i);
      await expect(banner).toContainText(/Fade \+3\.4%/i);

      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
      await expect(page.locator('html')).not.toHaveClass(/dark/);
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, 'wave3a-autoreg-1440-light.png'),
        fullPage: false,
        animations: 'disabled',
      });
      await toggleDarkMode(page, true);
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, 'wave3a-autoreg-1440-dark.png'),
        fullPage: false,
        animations: 'disabled',
      });
      await toggleDarkMode(page, false);

      // 1-tap Extend Rest +30s -> rest updates from 60 to 90
      await page.getByTestId('autoreg-extend-rest-btn').click();
      const restSelect = page.getByLabel('Recovery Countdown');
      await expect(restSelect).toHaveValue('90');

      const receipt = page.getByTestId('stopwatch-autoreg-receipt');
      await expect(receipt).toBeVisible();
      await expect(receipt).toContainText(/\+30s Rest/i);

      // 1-tap Convert Remaining to CV
      await page.getByTestId('autoreg-convert-cv-btn').click();
      await expect(receipt).toContainText(/Critical Velocity \(CV\)/i);

      // Now seed deeper >4.5% fade past half-session (90.0s on 85.0s target = +5.9%) => NEURO_STOP_RULE -> End @ 85% Stimulus
      await seedAutoRegStopwatchState(page, [85.0, 172.5, 262.5], 'I');
      await expect(banner).toBeVisible();
      await expect(banner).toContainText(/Stop Rule/i);
      await page.getByTestId('autoreg-end-85-btn').click();
      await expect(receipt).toContainText(/85% Quality Stimulus Preserved/i);

      await page.getByTestId('stopwatch-save-thresh').click();
      await expect(
        page.getByText(/Saved 1 Interval Workout Log \(85% quality stimulus preserved\)/i)
      ).toBeVisible();

      await page.evaluate(() => localStorage.removeItem('thresh_trackside_stopwatch_v1'));
    });
  });

  test.describe('Mobile Viewport (390x844)', () => {
    test.skip(({ isMobile }) => !isMobile, 'Mobile only');

    test('renders >= 44px 1-tap auto-reg controls and cleanly executes CV pivot on mobile', async ({
      page,
    }) => {
      await enterSampleDemoStopwatch(page);
      await seedAutoRegStopwatchState(page, [85.0, 172.6, 260.5], 'I');

      const banner = page.getByTestId('stopwatch-autoreg-banner');
      await expect(banner).toBeVisible();

      for (const testId of [
        'autoreg-extend-rest-btn',
        'autoreg-convert-cv-btn',
        'autoreg-end-85-btn',
      ]) {
        const btn = page.getByTestId(testId);
        await expect(btn).toBeVisible();
        await btn.scrollIntoViewIfNeeded();
        expect((await btn.boundingBox())?.height || 0).toBeGreaterThanOrEqual(44);
      }

      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, 'wave3a-autoreg-390-light.png'),
        fullPage: false,
        animations: 'disabled',
      });
      await toggleDarkMode(page, true);
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, 'wave3a-autoreg-390-dark.png'),
        fullPage: false,
        animations: 'disabled',
      });
      await toggleDarkMode(page, false);

      await page.getByTestId('autoreg-convert-cv-btn').click();
      await expect(page.getByTestId('stopwatch-autoreg-receipt')).toContainText(
        /Critical Velocity \(CV\)/i
      );

      await page.evaluate(() => localStorage.removeItem('thresh_trackside_stopwatch_v1'));
    });
  });
});
