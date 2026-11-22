import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          id: '/',
          name: 'MeetReady — Track & Field & Cross Country',
          short_name: 'MeetReady',
          description:
            'Coach clipboard, auto-scaled distance pace pods, watchless 0.01s trackside stopwatch, and 1Hz endurance physiology for teams and athletes.',
          theme_color: '#0C1D14',
          background_color: '#0C1D14',
          display: 'standalone',
          orientation: 'any',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          importScripts: ['/sw-push.js'],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,webmanifest}'],
          globIgnores: [
            '**/brand/**',
            '**/docs/**',
            '**/legal/**',
            '**/for-athletic-directors.html',
            '**/assets/vendor-leaflet-*',
            '**/assets/vendor-uplot-*',
            '**/assets/FitnessHealthView-*',
            '**/assets/TodayPhysiologyDeepDive-*',
            '**/assets/GoalsView-*',
            '**/assets/StravaAuthGate-*',
            '**/assets/BrandGuidePage-*',
            '**/assets/UserGuideModal-*',
            '**/assets/CoachWorkspaceView-*',
            '**/assets/TeamManagementPanel-*',
            '**/assets/CoachClipboardWorkoutBuilder-*',
            '**/assets/DataSourcesModal-*',
            '**/assets/AthleteProfileModal-*',
            '**/assets/OfficialRaceModal-*',
            '**/assets/AthleteRosterModal-*',
            '**/assets/AthleticNetTfrrsSyncModal-*',
            '**/assets/AthletePerformanceRadar-*',
            '**/assets/InteractiveRouteMap-*',
            '**/assets/UPlotPMCDashboard-*',
            '**/assets/UPlotStreamChart-*',
            '**/assets/ShareWorkoutPage-*',
            '**/assets/PublicTeamHubPage-*',
            '**/assets/AICoachDrawer-*',
            '**/assets/ArchiveOnboardingWizard-*',
            '**/assets/ScholasticRelayAndTopTimesPanel-*',
            '**/assets/CoachDailyOpsPanel-*',
            '**/assets/CoachOnboardingWizard-*',
            '**/assets/CoachingStaffPanel-*',
            '**/assets/TeamMessagingDrawer-*',
            '**/assets/MeetDayHeatAndFlightModal-*',
            '**/assets/athleticNetAndTfrrsEngine-*',
            '**/assets/durabilityEngine-*',
            '**/assets/sessionCheckInAndDigestEngine-*',
            '**/assets/activityProcessor.worker-*',
          ],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [
            /^\/api\//,
            /^\/auth\//,
            /^\/docs(\/|$)/,
            /^\/(legal|privacy|terms|subprocessors|procurement|for-athletic-directors)(\/|$)/,
          ],
          runtimeCaching: [
            {
              // Network-First for UI scripts, stylesheets, HTML documents, and Web Worker chunks
              // Never intercept /api/* or /auth/* in the Service Worker so OAuth callbacks & API calls go directly to the network
              urlPattern: ({ request, url }) =>
                !/^\/(api|auth)\//i.test(url.pathname) &&
                (request.destination === 'script' ||
                  request.destination === 'style' ||
                  request.destination === 'worker' ||
                  request.destination === 'document'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'thresh-ui-assets-network-first-v3',
                networkTimeoutSeconds: 4,
                expiration: {
                  maxEntries: 120,
                  maxAgeSeconds: 60 * 60 * 24 * 7,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              // Cache-First for static icons and font files
              urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff|woff2|ttf)$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'thresh-static-cache-first-v2',
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 15,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 15,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              // Stale-While-Revalidate for public GPS route map tiles
              urlPattern:
                /^https:\/\/(?:[abc]\.tile\.openstreetmap\.org|[abcd]\.basemaps\.cartocdn\.com)\/.*/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'thresh-map-tiles-swr',
                expiration: {
                  maxEntries: 250,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: false,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/leaflet')) {
              return 'vendor-leaflet';
            }
            if (id.includes('node_modules/uplot')) {
              return 'vendor-uplot';
            }
            if (id.includes('node_modules/dexie')) {
              return 'vendor-dexie';
            }
            if (id.includes('node_modules/fflate')) {
              return 'vendor-zip';
            }
            if (
              id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/scheduler/')
            ) {
              return 'vendor-react';
            }
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      allowedHosts: true as const,
    },
  };
});
