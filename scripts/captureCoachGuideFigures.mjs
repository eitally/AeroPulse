import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const PORT = 4179;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OUT_DIR = path.join(ROOT, 'public', 'docs', 'figures');

async function waitForHealth(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      // wait
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${url}/api/health`);
}

async function sanitizeDisplayedOrigin(page) {
  await page.evaluate((origin) => {
    const hostRegex = /https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/gi;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      if (n.nodeValue && hostRegex.test(n.nodeValue)) {
        n.nodeValue = n.nodeValue.replace(hostRegex, 'https://thresh.app');
      }
    }
    for (const el of document.querySelectorAll('input, textarea')) {
      if (el.value && hostRegex.test(el.value)) {
        el.value = el.value.replace(hostRegex, 'https://thresh.app');
      }
    }
    void origin;
  }, BASE_URL);
}

async function captureWebp(page, outPath, opts = {}) {
  await sanitizeDisplayedOrigin(page);
  await page.waitForTimeout(250);
  const pngBuffer = await page.screenshot({
    type: 'png',
    fullPage: Boolean(opts.fullPage),
    ...(opts.clip ? { clip: opts.clip } : {}),
  });
  const base64Png = pngBuffer.toString('base64');
  const webpBase64 = await page.evaluate(async (pngB64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${pngB64}`;
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/webp', 0.88).split(',')[1];
  }, base64Png);
  const webpBuf = Buffer.from(webpBase64, 'base64');
  if (webpBuf.slice(0, 4).toString('ascii') !== 'RIFF' || webpBuf.slice(8, 12).toString('ascii') !== 'WEBP') {
    throw new Error(`Invalid WebP output for ${outPath}`);
  }
  if (webpBuf.length < 10_000) {
    throw new Error(`Captured WebP too small (${webpBuf.length} bytes) for ${outPath}`);
  }
  fs.writeFileSync(outPath, webpBuf);
  console.log(`Captured ${path.relative(ROOT, outPath)} (${(webpBuf.length / 1024).toFixed(1)} KB)`);
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = spawn('npx', ['tsx', 'server.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SERVE_BUILT_DIST: '1',
      PORT: String(PORT),
    },
    stdio: 'pipe',
  });

  try {
    await waitForHealth(BASE_URL);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1360, height: 880 },
      serviceWorkers: 'block',
    });

    await context.addInitScript(() => {
      window.localStorage.setItem('thresh_dark_mode', 'true');
      window.localStorage.setItem('thresh_surface_theme', 'slate');
    });

    const page = await context.newPage();

    // Fig 2: 12-athlete Squad Triage + Maya Chen shin flag + Workout Comments w/ Guardian CC
    await page.goto(`${BASE_URL}/?demo=1#coach/roster`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('coach-execution-digest').waitFor({ state: 'visible', timeout: 15000 });
    await page.getByTestId('coach-workout-comments').waitFor({ state: 'visible', timeout: 15000 });
    await captureWebp(page, path.join(OUT_DIR, 'coach-fig-02-safety-squad-triage.webp'));

    // Fig 1: Team Onboarding QR, Join Code & Create/Manage Team panel
    await page.getByTestId('team-create-new-btn').scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await captureWebp(page, path.join(OUT_DIR, 'coach-fig-01-team-onboarding.webp'));

    // Fig 3: Clipboard Builder + VDOT Pace Pods + Workout Library
    await page.goto(`${BASE_URL}/?demo=1#coach/clipboard`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('coach-clipboard-builder').waitFor({ state: 'visible', timeout: 15000 });
    await page.getByTestId('clipboard-pod-preview').waitFor({ state: 'visible', timeout: 15000 });
    await captureWebp(page, path.join(OUT_DIR, 'coach-fig-03-clipboard-workout-pods.webp'));

    // Fig 4: Team Plan Rolling 2W Cohort Builder & Calendar
    await page.goto(`${BASE_URL}/?demo=1#coach/plan`, { waitUntil: 'domcontentloaded' });
    await page.getByText(/Loading Team Plan Calendar/i).waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(450);
    const cohortBtn = page.getByTestId('coach-open-cohort-plan-builder');
    await cohortBtn.waitFor({ state: 'visible', timeout: 15000 });
    await cohortBtn.click();
    await page.waitForTimeout(450);
    await captureWebp(page, path.join(OUT_DIR, 'coach-fig-04-cohort-plan-builder.webp'));

    // Fig 5: Trackside Stopwatch with realistic 01:08.42 split
    await page.evaluate(() => {
      const seededStopwatch = {
        isRunning: false,
        startedAtEpochMs: null,
        sessionStartedEpochMs: null,
        accumulatedMs: 68420,
        athleteLapTimestampsSecs: {
          'team-mem-demo-mem-ath-01': [68.42],
          'team-mem-demo-mem-ath-05': [69.15],
          'team-mem-demo-mem-ath-03': [70.24],
        },
        tapHistory: [
          {
            runnerId: 'team-mem-demo-mem-ath-01',
            runnerName: 'Lucas Alvarez',
            timestampSecs: 68.42,
            kind: 'RUNNER_SPLIT',
          },
          {
            runnerId: 'team-mem-demo-mem-ath-05',
            runnerName: 'Nolan Brooks',
            timestampSecs: 69.15,
            kind: 'RUNNER_SPLIT',
          },
        ],
        extraPodAthletes: [],
        sessionType: 'WORKOUT',
        viewMode: 'CARDS',
        showChuteBar: true,
        workoutPresetId: '8x400',
        waveMode: 'POD_STAGGER',
        chuteQueueSecs: [],
      };
      window.localStorage.setItem('thresh_trackside_stopwatch_v1', JSON.stringify(seededStopwatch));
      window.dispatchEvent(new CustomEvent('thresh:trackside-stopwatch-sync'));
    });
    await page.goto(`${BASE_URL}/?demo=1#coach/stopwatch`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Trackside Stopwatch').waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(400);
    await captureWebp(page, path.join(OUT_DIR, 'coach-fig-05-trackside-stopwatch.webp'));

    // Clear stopwatch state so Fig 6 header is clean
    await page.evaluate(() => {
      window.localStorage.removeItem('thresh_trackside_stopwatch_v1');
      window.dispatchEvent(new CustomEvent('thresh:trackside-stopwatch-sync'));
    });

    // Fig 6: Inspecting Maya Chen / Lucas Alvarez -> Today PMC with Back to Coach Roster banner
    await page.goto(`${BASE_URL}/?demo=1#coach/roster`, { waitUntil: 'domcontentloaded' });
    const digest = page.getByTestId('coach-execution-digest');
    await digest.waitFor({ state: 'visible', timeout: 15000 });
    await digest.getByRole('button', { name: 'Inspect' }).first().click();
    await page.getByRole('button', { name: /Back to Coach Roster/i }).waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(500);
    await captureWebp(page, path.join(OUT_DIR, 'coach-fig-06-post-workout-pmc.webp'));

    // Fig 7: Clean-Room Parent & Athletic.net Public Hub
    await page.goto(`${BASE_URL}/team/willow-glen-high-school-xc?demo=1`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('public-team-hub-page').waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(400);
    await captureWebp(page, path.join(OUT_DIR, 'coach-fig-07-athleticnet-parent-hub.webp'));

    await browser.close();
  } finally {
    server.kill('SIGTERM');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
