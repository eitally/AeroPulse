import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const EVIDENCE_ROOT =
  '/Users/elliottally/.gemini/antigravity/brain/b118f55f-6bcc-48bc-a4be-39ee1c8f6393';
const EVIDENCE_DIR = path.join(EVIDENCE_ROOT, 'brd01_evidence');

async function mockExternalFonts(page: Page) {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '/* mock */' })
  );
  await page.route('https://fonts.gstatic.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
  );
}

function maybeSaveEvidence(page: Page, filename: string) {
  if (!fs.existsSync(EVIDENCE_ROOT)) {
    return Promise.resolve();
  }
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  return page.screenshot({
    path: path.join(EVIDENCE_DIR, filename),
    fullPage: true,
  });
}

test.describe('BRD-01 Public /brand Studio & Universal Footer Reach', () => {
  test.beforeEach(async ({ page }) => {
    await mockExternalFonts(page);
  });

  test.describe('Desktop (1440x900)', () => {
    test.skip(({ isMobile }) => isMobile, 'Desktop only');

    test('renders zero-auth /brand in Light & Dark modes with zero overflow and captures evidence', async ({
      page,
      context,
    }) => {
      await context.clearCookies();
      await page.addInitScript(() => {
        localStorage.setItem('thresh_theme_dark', '0');
      });
      await page.goto('/brand');

      const heading = page.getByRole('heading', { name: /THRESH Brand Studio & Style Guide/i });
      await expect(heading).toBeVisible({ timeout: 15000 });
      await expect(page.locator('html')).not.toHaveClass(/dark/);

      const lightOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      );
      expect(lightOverflow).toBe(false);
      await maybeSaveEvidence(page, 'brand-desktop-1440-light.png');

      // Switch to Dark Stadium Mode
      const themeBtn = page.getByRole('button', { name: /Switch to Dark Stadium Mode/i });
      await themeBtn.click();
      await expect(page.locator('html')).toHaveClass(/dark/);

      const darkOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      );
      expect(darkOverflow).toBe(false);
      await maybeSaveEvidence(page, 'brand-desktop-1440-dark.png');
    });

    test('navigates to /brand from both StravaAuthGate public footer and logged-in CockpitFooter', async ({
      page,
      context,
    }) => {
      // 1. Unauthenticated StravaAuthGate footer -> /brand -> Enter THRESH
      await context.clearCookies();
      await page.goto('/');
      await page.evaluate(() => localStorage.clear());
      await page.reload();

      const authFooterLink = page.locator('footer').getByRole('link', { name: /Brand & Style Guide/i });
      await expect(authFooterLink).toBeVisible({ timeout: 15000 });
      await authFooterLink.click();

      await expect(page).toHaveURL(/\/brand\/?$/);
      await expect(
        page.getByRole('heading', { name: /THRESH Brand Studio & Style Guide/i })
      ).toBeVisible();

      await page.getByRole('button', { name: /Enter THRESH/i }).first().click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeVisible();

      // 2. Demo Workspace CockpitFooter -> /brand -> Back to Cockpit
      await page.goto('/?demo=1');
      const cockpitNav = page.locator('nav[aria-label*="rimary workspaces"]:visible');
      await expect(cockpitNav).toBeVisible({ timeout: 15000 });

      const cockpitFooterLink = page
        .locator('footer')
        .getByRole('link', { name: /Brand & Style Guide/i });
      await cockpitFooterLink.scrollIntoViewIfNeeded();
      await cockpitFooterLink.click();

      await expect(page).toHaveURL(/\/brand\/?$/);
      const backBtn = page.getByRole('button', { name: /Back to Cockpit/i });
      await expect(backBtn).toBeVisible();
      await backBtn.click();

      await expect(cockpitNav).toBeVisible({ timeout: 10000 });
    });

    test('stress-tests surface legality and exports .SVG, 2x PNG, Complete .ZIP Kit & Custom Team SVG', async ({
      page,
    }) => {
      await page.goto('/brand');
      await expect(
        page.getByRole('heading', { name: /THRESH Brand Studio & Style Guide/i })
      ).toBeVisible({ timeout: 15000 });

      // 1. Stress tester: click B&W Copier backdrop
      await page.getByRole('button', { name: /B&W Copier/i }).click();
      await expect(page.getByText('Copier Gold Standard').first()).toBeVisible();
      await expect(page.getByText('Avoid on Copier').first()).toBeVisible();

      // 2. Card SVG download (first card: thresh-lockup-dark.svg)
      const [svgDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('article').first().getByRole('button', { name: /^\.SVG$/ }).click(),
      ]);
      expect(svgDownload.suggestedFilename()).toBe('thresh-lockup-dark.svg');
      const svgPath = await svgDownload.path();
      expect(fs.readFileSync(svgPath!, 'utf8')).toContain('<svg ');

      // 3. Card 2x PNG raster download
      const [pngDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('article').first().getByRole('button', { name: /^2x PNG$/ }).click(),
      ]);
      expect(pngDownload.suggestedFilename()).toBe('thresh-lockup-dark-2x.png');
      const pngPath = await pngDownload.path();
      expect(fs.statSync(pngPath!).size).toBeGreaterThan(2000);

      // 4. Complete Brand Kit (.zip)
      const [zipDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /Download Complete Brand Kit \(\.zip\)/i }).click(),
      ]);
      expect(zipDownload.suggestedFilename()).toBe('THRESH-Brand-Kit.zip');
      const zipPath = await zipDownload.path();
      expect(fs.statSync(zipPath!).size).toBeGreaterThan(10000);

      // 5. Team x THRESH custom exporter (switch explicitly to Dark Stage for deterministic -dark.svg)
      await page.getByRole('button', { name: 'Dark Stage' }).click();
      const squadInput = page.getByLabel(/Squad Short Name/i);
      await squadInput.fill('PALY TRACK');
      const [teamSvgDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /Download PALY TRACK × THRESH \(\.SVG\)/i }).click(),
      ]);
      expect(teamSvgDownload.suggestedFilename()).toBe('paly-track-x-thresh-dark.svg');
      const teamSvgPath = await teamSvgDownload.path();
      expect(fs.readFileSync(teamSvgPath!, 'utf8')).toContain('PALY TRACK');
    });
  });

  test.describe('Mobile (390x844)', () => {
    test.skip(({ isMobile }) => !isMobile, 'Mobile only');

    test('renders zero-auth /brand cleanly at 390px with >= 44px touch targets & captures light/dark', async ({
      page,
      context,
    }) => {
      await context.clearCookies();
      await page.addInitScript(() => {
        localStorage.setItem('thresh_theme_dark', '0');
      });
      await page.goto('/brand');

      await expect(
        page.getByRole('heading', { name: /THRESH Brand Studio & Style Guide/i })
      ).toBeVisible({ timeout: 15000 });

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      );
      expect(overflow).toBe(false);

      // Enforce 44px mobile touch-target floor on visible interactive buttons/footer links
      const undersized = await page.evaluate(() => {
        const bad: string[] = [];
        document.querySelectorAll('button, footer a, header a').forEach((el) => {
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return;
          // Color swatches / preset chips with explicit min-h-[44px] check
          if (rect.height < 43.5) {
            bad.push(`${el.tagName}:${(el.textContent || '').trim().slice(0, 28)}=${rect.height.toFixed(1)}px`);
          }
        });
        return bad;
      });
      expect(undersized).toEqual([]);

      await maybeSaveEvidence(page, 'brand-mobile-390-light.png');

      await page.getByRole('button', { name: /Switch to Dark Stadium Mode/i }).click();
      await expect(page.locator('html')).toHaveClass(/dark/);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      await maybeSaveEvidence(page, 'brand-mobile-390-dark.png');
    });
  });
});
