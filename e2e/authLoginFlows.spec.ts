import { expect, test } from '@playwright/test';

test.describe('Authentication & OAuth Handoff Flows (Strava + Google)', () => {
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

    test('Strava BroadcastChannel OAUTH_AUTH_SUCCESS advances Step 1 -> Step 2 & Google button follows data.url', async ({
      page,
      context,
    }) => {
      // 1. Fresh AuthGate (not ?demo=1) — test Google Sign-In button reads data.url properly
      await context.clearCookies();
      await page.goto('/');
      await page.evaluate(() => localStorage.clear());
      await page.reload();

      const googleBtn = page.getByRole('button', { name: /Continue with Google/i });
      await expect(googleBtn).toBeVisible({ timeout: 15000 });

      // Mock configured Google OAuth URL + /api/auth/me (authenticated only after OAuth redirect starts)
      let interceptedAuthUrl = false;
      await page.route('**/api/auth/google/url*', async (route) => {
        interceptedAuthUrl = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            configured: true,
            url: '/?auth_just_signed_in=1',
          }),
        });
      });
      await page.route('**/api/auth/me', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            interceptedAuthUrl
              ? {
                  authenticated: true,
                  sessionToken: 'e2e_google_session_tok',
                  user: {
                    id: 'usr_e2egoogle01',
                    email: 'maya@paly.edu',
                    name: 'Maya Lin',
                    role: 'athlete',
                    createdAt: '2026-11-15T00:00:00Z',
                    updatedAt: '2026-11-15T00:00:00Z',
                    authProviders: [
                      { provider: 'google', providerId: 'g1', linkedAt: '2026-11-15T00:00:00Z' },
                    ],
                    connectedServices: [],
                  },
                }
              : { authenticated: false, user: null }
          ),
        });
      });

      await googleBtn.click();
      await expect.poll(() => interceptedAuthUrl).toBe(true);
      await expect(page.getByText(/Signed in as Maya Lin/i)).toBeVisible({ timeout: 15000 });

      // 2. Unroute mocks and verify real server /api/auth/google/url never returns broken field mismatch
      await page.unroute('**/api/auth/google/url*');
      await page.unroute('**/api/auth/me');
      await context.clearCookies();
      await page.goto('/');
      await page.evaluate(() => localStorage.clear());
      await page.reload();

      const googleUrlProbe = await page.request.get('/api/auth/google/url');
      expect(googleUrlProbe.status()).toBe(200);
      const googleUrlBody = await googleUrlProbe.json();
      expect(googleUrlBody.url ?? googleUrlBody.devMockUrl ?? googleUrlBody.error).toBeTruthy();

      // 3. Verify Strava OAUTH_AUTH_SUCCESS on BroadcastChannel advances Step 1 -> Step 2
      await expect(page.getByRole('button', { name: /Connect with Strava/i })).toBeVisible({
        timeout: 15000,
      });

      await page.evaluate(() => {
        const bc = new BroadcastChannel('aeropulse_oauth');
        bc.postMessage({
          type: 'OAUTH_AUTH_SUCCESS',
          provider: 'strava',
          sessionToken: 'e2e_strava_session_tok',
          hasExistingSyncPolicy: false,
          tokens: {
            accessToken: 'e2e_strv_acc',
            refreshToken: 'e2e_strv_ref',
            expiresAt: 1999999999,
            athleteId: '998877',
            athleteName: 'Test Strava Runner',
          },
        });
        bc.close();
      });

      await expect(page.getByText(/Signed in with Strava.*Test Strava Runner/i)).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByRole('heading', { name: /Choose What Syncs From Strava/i })).toBeVisible();

      await page.evaluate(() => localStorage.clear());
    });
  });
});
