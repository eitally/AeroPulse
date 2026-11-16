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

    test('Clicking Connect with Strava completes popup OAuth callback -> Step 2 without Failed to fetch', async ({
      page,
      context,
    }) => {
      await context.clearCookies();
      await page.goto('/');
      await page.evaluate(() => localStorage.clear());
      await page.reload();

      let oauthDone = false;
      await page.route('**/api/config/status*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            vaultStorageBackend: 'ENCRYPTED_FILE',
            stravaConfigured: true,
            stravaClientId: '121717',
            stravaConnected: oauthDone,
            stravaSource: oauthDone ? 'OAUTH' : 'NONE',
            stravaAthleteId: oauthDone ? '776655' : undefined,
            stravaAthleteName: oauthDone ? 'Popup Test Runner' : undefined,
          }),
        });
      });

      await page.route('**/api/strava/auth/url*', async (route) => {
        const reqUrl = new URL(route.request().url());
        const callerOrigin = reqUrl.searchParams.get('origin') || 'http://localhost:3000';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            url: `${callerOrigin}/auth/strava/callback?e2e_mock=1&state=mock_state_1`,
            redirectUri: `${callerOrigin}/auth/strava/callback`,
            clientId: '121717',
            state: 'mock_state_1',
            sessionToken: 'e2e_popup_session_tok',
          }),
        });
      });

      await context.route('**/auth/strava/callback*', async (route) => {
        oauthDone = true;
        const payload = {
          type: 'OAUTH_AUTH_SUCCESS',
          provider: 'strava',
          athleteId: '776655',
          athleteName: 'Popup Test Runner',
          sessionToken: 'e2e_popup_session_tok',
          hasExistingSyncPolicy: false,
          isPopupFlow: true,
          tokens: {
            accessToken: 'e2e_popup_acc',
            refreshToken: 'e2e_popup_ref',
            expiresAt: 2100000000,
            clientId: '121717',
            athleteId: '776655',
            athleteName: 'Popup Test Runner',
          },
        };
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: `<!doctype html><html><body><p>Connected</p><script>
            (function(){
              var payload = ${JSON.stringify(payload)};
              try { if (window.opener && window.opener !== window) window.opener.postMessage(payload, window.location.origin); } catch (e) {}
              try { new BroadcastChannel('aeropulse_oauth').postMessage(payload); } catch (e) {}
              try { localStorage.setItem('aeropulse_oauth_result_v1', JSON.stringify({ ts: Date.now(), payload: payload })); } catch (e) {}
              setTimeout(function(){ try { window.close(); } catch (e) {} }, 120);
            })();
          </script></body></html>`,
        });
      });

      await page.route('**/api/strava/auth/poll*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ completed: false }),
        });
      });

      const stravaBtn = page.getByRole('button', { name: /Connect with Strava/i });
      await expect(stravaBtn).toBeVisible({ timeout: 15000 });

      const popupPromise = page.waitForEvent('popup');
      await stravaBtn.click();
      const popup = await popupPromise;
      await popup.waitForEvent('close', { timeout: 15000 });

      await expect(page.getByRole('heading', { name: /Choose What Syncs From Strava/i })).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByText(/Failed to fetch/i)).toHaveCount(0);
      await context.unroute('**/auth/strava/callback*');
      await page.evaluate(() => localStorage.clear());
    });

    test('Falls back to /api/strava/auth/login inside popup without Failed to fetch when /api/strava/auth/url aborts', async ({
      page,
      context,
    }) => {
      await context.clearCookies();
      await page.goto('/');
      await page.evaluate(() => localStorage.clear());
      await page.reload();

      let abortedAuthUrl = false;
      let interceptedFallbackUrl = '';

      await page.route('**/api/strava/auth/url*', async (route) => {
        abortedAuthUrl = true;
        await route.abort('failed');
      });

      await context.route('**/api/strava/auth/login*', async (route) => {
        interceptedFallbackUrl = route.request().url();
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><html><body><h1>Mock Strava Login</h1></body></html>',
        });
      });

      await page.route('**/api/strava/auth/poll*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ completed: false }),
        });
      });

      const stravaBtn = page.getByRole('button', { name: /Connect with Strava/i });
      await expect(stravaBtn).toBeVisible({ timeout: 15000 });

      const popupPromise = page.waitForEvent('popup');
      await stravaBtn.click();
      const popup = await popupPromise;

      await expect.poll(() => abortedAuthUrl).toBe(true);
      await expect.poll(() => interceptedFallbackUrl).toContain('/api/strava/auth/login');
      expect(interceptedFallbackUrl).toContain('flow=popup');
      expect(popup.isClosed()).toBe(false);
      await expect(page.getByText(/Failed to fetch/i)).toHaveCount(0);

      await popup.close();
      await context.unroute('**/api/strava/auth/login*');
      await page.evaluate(() => localStorage.clear());
    });
  });
});
