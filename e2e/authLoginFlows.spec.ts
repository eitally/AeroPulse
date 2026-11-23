import { expect, test, type Page } from '@playwright/test';

async function installStravaWorkspaceMocks(
  page: Page,
  opts: {
    athleteId?: string;
    athleteName?: string;
    initialPolicyWindow?: '90d' | '180d' | '365d' | 'all' | 'none';
  } = {}
) {
  const athleteId = opts.athleteId || '998877';
  const athleteName = opts.athleteName || 'Test Strava Runner';
  let syncedPolicy = opts.initialPolicyWindow
    ? {
        window: opts.initialPolicyWindow,
        importProfileAndGear: true,
        confirmedAt: '2026-11-16T00:00:00.000Z',
      }
    : undefined;

  await page.route('**/api/config/status*', async (route) => {
    const loggedOut = route.request().headers()['x-strava-access-token'] ? false : false;
    void loggedOut;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        vaultStorageBackend: 'ENCRYPTED_FILE',
        stravaConfigured: true,
        stravaClientId: '121717',
        stravaConnected: true,
        stravaSource: 'OAUTH',
        stravaAthleteId: athleteId,
        stravaAthleteName: athleteName,
        stravaGrantedScope: 'read,activity:read_all,profile:read_all',
        stravaSyncPolicy: syncedPolicy,
        mapTileProvider: 'OSM_KEYLESS',
        mapTileApiKeyConfigured: false,
      }),
    });
  });

  await page.route('**/api/strava/sync-policy*', async (route) => {
    let body: any = {};
    try {
      body = route.request().postDataJSON();
    } catch {
      body = {};
    }
    syncedPolicy = {
      window: body.window || '90d',
      importProfileAndGear: body.importProfileAndGear !== false,
      confirmedAt: new Date().toISOString(),
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, stravaSyncPolicy: syncedPolicy }),
    });
  });

  await page.route('**/api/strava/sync*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        athleteId,
        athleteName,
        activities: [],
        starredSegments: [],
        gearItems: [],
      }),
    });
  });

  await page.route('**/api/teams/my-teams*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ teams: [] }),
    });
  });
}

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

    test('Google leads Coach-first homepage, Athlete toggle surfaces Strava #1, and standalone Strava enters workspace directly', async ({
      page,
      context,
    }) => {
      // 1. Fresh AuthGate (Coach-first default) — Continue with Google sits above Connect with Strava
      await context.clearCookies();
      await page.goto('/');
      await page.evaluate(() => localStorage.clear());
      await page.reload();

      const stravaBtn = page.getByRole('button', { name: /Connect with Strava/i });
      const googleBtn = page.getByRole('button', { name: /Continue with Google/i });
      await expect(stravaBtn).toBeVisible({ timeout: 15000 });
      await expect(googleBtn).toBeVisible({ timeout: 15000 });

      const coachStravaBox = await stravaBtn.boundingBox();
      const coachGoogleBox = await googleBtn.boundingBox();
      expect(coachStravaBox).not.toBeNull();
      expect(coachGoogleBox).not.toBeNull();
      expect(coachGoogleBox!.y).toBeLessThan(coachStravaBox!.y);

      // Switching to Solo Athlete swaps Connect with Strava back to #1 above Google
      await page.getByTestId('onboarding-role-athlete').click();
      const athleteStravaBox = await stravaBtn.boundingBox();
      const athleteGoogleBox = await googleBtn.boundingBox();
      expect(athleteStravaBox).not.toBeNull();
      expect(athleteGoogleBox).not.toBeNull();
      expect(athleteStravaBox!.y).toBeLessThan(athleteGoogleBox!.y);

      // Google OAuth still follows data.url -> Step 2 setup for non-Strava accounts
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

      // 3. Strava OAUTH_AUTH_SUCCESS on BroadcastChannel enters workspace directly without Step 2 or Step 3
      await installStravaWorkspaceMocks(page);
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
            grantedScope: 'read,activity:read_all,profile:read_all',
          },
        });
        bc.close();
      });

      await expect(page.getByRole('link', { name: 'Today' })).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('heading', { name: /Choose What Syncs From Strava/i })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Connect with Strava/i })).toHaveCount(0);

      const savedPolicy = await page.evaluate(() => {
        const raw = localStorage.getItem('aeropulse_strava_sync_policy');
        return raw ? JSON.parse(raw) : null;
      });
      expect(savedPolicy?.window).toBe('90d');

      await page.evaluate(() => localStorage.clear());
    });

    test('Clicking Connect with Strava completes popup OAuth callback straight to workspace without Failed to fetch', async ({
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
            stravaGrantedScope: oauthDone ? 'read,activity:read_all,profile:read_all' : undefined,
          }),
        });
      });

      await page.route('**/api/strava/sync-policy*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            stravaSyncPolicy: {
              window: '90d',
              importProfileAndGear: true,
              confirmedAt: new Date().toISOString(),
            },
          }),
        });
      });

      await page.route('**/api/strava/sync*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            athleteId: '776655',
            athleteName: 'Popup Test Runner',
            activities: [],
            starredSegments: [],
            gearItems: [],
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
          hasPendingTeamJoin: false,
          isPopupFlow: true,
          tokens: {
            accessToken: 'e2e_popup_acc',
            refreshToken: 'e2e_popup_ref',
            expiresAt: 2100000000,
            clientId: '121717',
            athleteId: '776655',
            athleteName: 'Popup Test Runner',
            grantedScope: 'read,activity:read_all,profile:read_all',
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

      await expect(page.getByRole('link', { name: 'Today' })).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByRole('heading', { name: /Choose What Syncs From Strava/i })).toHaveCount(0);
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

    test('Sign Out wipes local sync policy on shared devices, Strava re-login restores server policy, and Team Join links show Step 2 claim', async ({
      page,
      context,
    }) => {
      await context.clearCookies();
      await installStravaWorkspaceMocks(page, {
        athleteId: '554433',
        athleteName: 'Returning Runner',
        initialPolicyWindow: 'all',
      });

      await page.goto('/');
      await page.evaluate(() => {
        localStorage.clear();
        localStorage.setItem('aeropulse_auth_gate_passed', '1');
        localStorage.setItem('thresh_session_active_hint', '1');
        localStorage.setItem('aeropulse_strava_athlete_id', '554433');
        localStorage.setItem('aeropulse_strava_athlete_name', 'Returning Runner');
        localStorage.setItem(
          'aeropulse_strava_sync_policy',
          JSON.stringify({
            window: 'all',
            importProfileAndGear: true,
            confirmedAt: '2026-11-16T00:00:00.000Z',
          })
        );
      });
      await page.reload();

      // Workspace loaded directly -> Sign Out via account menu
      await expect(page.getByRole('link', { name: 'Today' })).toBeVisible({ timeout: 15000 });
      await page.getByRole('button', { name: /Account and preferences menu/i }).click();
      await page.getByRole('menuitem', { name: /Back to Welcome \/ Sign Out/i }).click();

      // Back on homepage; shared-device Sign Out (RT-10) must sweep user sync policy from localStorage
      await expect(page.getByRole('button', { name: /Connect with Strava/i })).toBeVisible({
        timeout: 15000,
      });
      const policyAfterLogout = await page.evaluate(() =>
        localStorage.getItem('aeropulse_strava_sync_policy')
      );
      expect(policyAfterLogout).toBeNull();

      // Re-login via Strava -> enters workspace directly and keeps window='all'
      await page.evaluate(() => {
        const bc = new BroadcastChannel('aeropulse_oauth');
        bc.postMessage({
          type: 'OAUTH_AUTH_SUCCESS',
          provider: 'strava',
          sessionToken: 'tok_returning_2',
          hasExistingSyncPolicy: false,
          tokens: {
            accessToken: 'acc_returning_2',
            refreshToken: 'ref_returning_2',
            expiresAt: 2100000000,
            athleteId: '554433',
            athleteName: 'Returning Runner',
            grantedScope: 'read,activity:read_all',
          },
        });
        bc.close();
      });

      await expect(page.getByRole('link', { name: 'Today' })).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('heading', { name: /Choose What Syncs From Strava/i })).toHaveCount(0);
      await expect
        .poll(
          async () =>
            page.evaluate(
              () =>
                JSON.parse(localStorage.getItem('aeropulse_strava_sync_policy') || '{}')
                  .window
            ),
          { timeout: 10000 }
        )
        .toBe('all');

      // Now test Team Join link (?join=PAXC-26) still routes Strava user to Step 2 for roster claim
      await page.unroute('**/api/config/status*');
      await page.route('**/api/teams/join-preview*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            found: true,
            brand: {
              teamId: 'team_paxc',
              slug: 'paly-xc',
              name: 'Palo Alto XC',
              shortName: 'PAXC',
              primarySport: 'Running',
              joinCode: 'PAXC-26',
              coachDisplayName: 'Miller',
              primaryHex: '#1C5436',
              secondaryHex: '#C8FF00',
              orgType: 'COLLEGIATE',
              defaultSafeSportShield: false,
            },
          }),
        });
      });

      await context.clearCookies();
      await page.evaluate(() => localStorage.clear());
      await page.goto('/?join=PAXC-26');

      await expect(
        page.getByRole('button', { name: /Connect with Strava to Join PAXC/i })
      ).toBeVisible({ timeout: 15000 });

      await page.evaluate(() => {
        const bc = new BroadcastChannel('aeropulse_oauth');
        bc.postMessage({
          type: 'OAUTH_AUTH_SUCCESS',
          provider: 'strava',
          sessionToken: 'tok_join_1',
          hasExistingSyncPolicy: false,
          tokens: {
            accessToken: 'acc_join_1',
            refreshToken: 'ref_join_1',
            expiresAt: 2100000000,
            athleteId: '667788',
            athleteName: 'Join Athlete',
          },
        });
        bc.close();
      });

      await expect(page.getByRole('heading', { name: /Choose What Syncs From Strava/i })).toBeVisible({
        timeout: 15000,
      });

      await page.evaluate(() => localStorage.clear());
    });
  });
});
