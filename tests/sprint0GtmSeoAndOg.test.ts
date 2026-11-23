import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOgPreviewRouter } from '../server/routers/ogPreviewRouter.ts';
import {
  BRAND_ASSET_CATALOG,
  BRAND_SURFACES,
  evaluateAssetOnBackdrop,
} from '../src/utils/brandAssetEngine.ts';
import {
  BANNER_HEADLINE_OUTLINE_PATH,
  CREST_DOMAIN_LABEL_OUTLINE_PATH,
  CREST_TOP_MEETREADY_OUTLINE_PATH,
  DIECUT_DOMAIN_LABEL_OUTLINE_PATH,
  TEE_HEADLINE_OUTLINE_PATH,
} from '../src/utils/brandPrintOutlines.ts';
import { generateQrMatrix } from '../src/utils/qrCodeSvg.ts';
import {
  decodeSharedWorkoutPayload,
  encodeSharedWorkoutPayload,
  formatMmSs,
} from '../src/utils/shareWorkoutCodec.ts';
import * as shareWorkoutRoute from '../src/utils/shareWorkoutRoute.ts';
import type { PublicTeamHubPayload, TeamInvitePreviewPayload } from '../src/types.ts';

const ROOT = process.cwd();

describe('Sprint 0 Track B: GTM Vanity Redirects, Technical SEO, Print Outlines & Dynamic OG Previews', () => {
  describe('1. vercel.json redirects, rewrites, security headers & includeFiles', () => {
    it('routes all print/demo vanity QRs to Coach Demo with print UTMs and includes /team, /join, /share/workout rewrites before SPA fallback', () => {
      const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')) as {
        functions: Record<string, { maxDuration?: number; includeFiles?: string }>;
        headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
        redirects: Array<{ source: string; destination: string; permanent: boolean }>;
        rewrites: Array<{ source: string; destination: string }>;
      };

      expect(vercel.functions['api/index.js']?.includeFiles).toBe('dist/index.html');

      const rootHeaders = vercel.headers[0]?.headers ?? [];
      const hsts = rootHeaders.find((h) => h.key === 'Strict-Transport-Security');
      const csp = rootHeaders.find((h) => h.key === 'Content-Security-Policy');
      const permissionsPolicy = rootHeaders.find((h) => h.key === 'Permissions-Policy');
      expect(hsts?.value).toContain('max-age=63072000');
      expect(permissionsPolicy?.value).toBe('camera=(), microphone=(), geolocation=(self)');
      expect(csp?.value).toContain("'self'");
      expect(csp?.value).toContain("'unsafe-inline'");
      expect(csp?.value).toContain('https://fonts.googleapis.com');
      expect(csp?.value).toContain('https://fonts.gstatic.com');
      expect(csp?.value).toContain('*.tile.openstreetmap.org');
      expect(csp?.value).toContain('*.basemaps.cartocdn.com');
      expect(csp?.value).toContain('server.arcgisonline.com');
      expect(csp?.value).toContain('api.mapbox.com');
      expect(csp?.value).toContain('tile.thunderforest.com');
      expect(csp?.value).toContain('https://*.googleusercontent.com');
      expect(csp?.value).toContain('https://*.strava.com');
      expect(csp?.value).toContain('https://*.cloudfront.net');
      expect(csp?.value).toContain("worker-src 'self' blob:");
      expect(csp?.value).toContain("img-src 'self' data: blob: https:");
      expect(csp?.value).toContain("connect-src 'self' https:");
      expect(csp?.value).toContain("frame-ancestors 'none'");
      expect(csp?.value).toContain("object-src 'none'");

      const expectedCoachQrRedirects: Array<{ source: string; medium: string }> = [
        { source: '/demo', medium: 'utm_medium=qr' },
        { source: '/meet', medium: 'utm_medium=banner' },
        { source: '/go/clipboard', medium: 'utm_medium=clipboard_qr' },
        { source: '/sticker', medium: 'utm_medium=sticker' },
        { source: '/tee', medium: 'utm_medium=tee' },
        { source: '/clinic', medium: 'utm_medium=qr' },
        { source: '/flyer', medium: 'utm_medium=flyer' },
      ];

      for (const item of expectedCoachQrRedirects) {
        const match = vercel.redirects.find((r) => r.source === item.source);
        expect(match, `Missing redirect ${item.source}`).toBeDefined();
        expect(match?.permanent).toBe(false);
        expect(match?.destination).toContain('demo=1');
        expect(match?.destination).toContain('sample=coach');
        expect(match?.destination).toContain('#coach');
        expect(match?.destination).toContain('utm_source=');
        expect(match?.destination).toContain(item.medium);
        expect(match?.destination).toContain('utm_campaign=');
      }

      const shareRedirect = vercel.redirects.find((r) => r.source === '/share');
      expect(shareRedirect?.permanent).toBe(false);
      expect(shareRedirect?.destination).toBe(
        '/share/workout?preset=8x400&utm_source=share&utm_medium=card&utm_campaign=share_card'
      );

      const adRedirect = vercel.redirects.find((r) => r.source === '/ad');
      expect(adRedirect?.permanent).toBe(false);
      expect(adRedirect?.destination).toBe(
        '/for-athletic-directors?utm_source=print&utm_medium=ad_packet&utm_campaign=school_po'
      );

      const spaCatchAllIdx = vercel.rewrites.findIndex((r) => r.destination === '/index.html');
      expect(spaCatchAllIdx).toBeGreaterThan(-1);

      for (const ogSource of ['/team/:slug', '/join/:slug', '/share/workout']) {
        const idx = vercel.rewrites.findIndex(
          (r) => r.source === ogSource && r.destination === '/api/index'
        );
        expect(idx, `Missing OG rewrite ${ogSource}`).toBeGreaterThan(-1);
        expect(idx).toBeLessThan(spaCatchAllIdx);
      }
    });

    it('extends index.html SW skip guard, canonical link, and JSON-LD while keeping multiline THESIS comment', () => {
      const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
      expect(html).toContain("window.location.search.includes('sample=coach')");
      expect(html).toContain('<link rel="canonical" href="https://meetready.app/" />');
      expect(html).toContain('<script type="application/ld+json">');
      expect(html).toContain('"@type": "SoftwareApplication"');
      expect(html).toContain('"@type": "Organization"');
      expect(html).toContain('"price": "0"');
      expect(html).toContain('"price": "250"');
      expect(html).not.toContain('<!-- THESIS:');
      expect(html).toContain('Promise.race([Promise.all(cleanupTasks), timeoutFallback]).finally');
      expect(html).toContain('/icon.svg?v=7');

      const appSrc = fs.readFileSync(path.join(ROOT, 'src', 'App.tsx'), 'utf8');
      expect(appSrc).toContain("sampleParam === 'coach'");
      expect(appSrc).toContain("sampleParam === 'athlete'");
      expect(appSrc).toContain("return 'coach'");
    });
  });

  describe('2. Technical SEO (robots.txt, sitemap.xml & static first-party UTM capture)', () => {
    it('ships robots.txt and sitemap.xml covering all public URLs', () => {
      const robots = fs.readFileSync(path.join(ROOT, 'public', 'robots.txt'), 'utf8');
      expect(robots).toContain('Allow: /');
      expect(robots).toContain('Disallow: /api/');
      expect(robots).toContain('Sitemap: https://meetready.app/sitemap.xml');

      const sitemap = fs.readFileSync(path.join(ROOT, 'public', 'sitemap.xml'), 'utf8');
      const expectedUrls = [
        'https://meetready.app/',
        'https://meetready.app/for-athletic-directors',
        'https://meetready.app/brand',
        'https://meetready.app/docs/',
        'https://meetready.app/docs/coach.html',
        'https://meetready.app/procurement',
        'https://meetready.app/privacy',
        'https://meetready.app/terms',
        'https://meetready.app/subprocessors',
      ];
      for (const u of expectedUrls) {
        expect(sitemap).toContain(`<loc>${u}</loc>`);
      }
    });

    it('adds complete SEO meta tags, first-party UTM pass-through, and Asphalt Dark labels across static HTML pages', () => {
      const staticPages = [
        { file: 'public/for-athletic-directors.html', canonical: 'https://meetready.app/for-athletic-directors' },
        { file: 'public/docs/index.html', canonical: 'https://meetready.app/docs/' },
        { file: 'public/docs/coach.html', canonical: 'https://meetready.app/docs/coach.html' },
        { file: 'public/legal/procurement.html', canonical: 'https://meetready.app/procurement', isLegal: true },
        { file: 'public/legal/privacy.html', canonical: 'https://meetready.app/privacy', isLegal: true },
        { file: 'public/legal/terms.html', canonical: 'https://meetready.app/terms', isLegal: true },
        { file: 'public/legal/subprocessors.html', canonical: 'https://meetready.app/subprocessors', isLegal: true },
      ];

      for (const page of staticPages) {
        const html = fs.readFileSync(path.join(ROOT, page.file), 'utf8');
        expect(html, `${page.file} missing description`).toMatch(/<meta\b[^>]*name="description"/i);
        expect(html, `${page.file} missing canonical`).toContain(
          `<link rel="canonical" href="${page.canonical}" />`
        );
        expect(html, `${page.file} missing og:title`).toContain('property="og:title"');
        expect(html, `${page.file} missing og:description`).toContain('property="og:description"');
        expect(html, `${page.file} missing og:url`).toContain(`property="og:url" content="${page.canonical}"`);
        expect(html, `${page.file} missing twitter:title`).toContain('name="twitter:title"');
        expect(html, `${page.file} missing twitter:description`).toContain('name="twitter:description"');
        expect(html, `${page.file} missing first-party UTM capture`).toContain(
          'meetready_first_party_attr_v1'
        );
        expect(html).toContain('document.referrer');
        expect(html).not.toMatch(/googletagmanager|google-analytics|gtag\(|fbq\(|segment\.com/i);

        if (page.isLegal) {
          expect(html).not.toContain('Pine Dark');
          expect(html).toContain('Asphalt Dark');
        }
      }
    });
  });

  describe('3. React-free shareWorkoutCodec & dynamic ogPreviewRouter', () => {
    let server: http.Server;
    let baseUrl = '';
    let shellServer: http.Server;
    let shellBaseUrl = '';
    let tmpHtmlPath = '';

    const mockTeamHub: PublicTeamHubPayload = {
      found: true,
      brand: {
        teamId: 'tm_test_1',
        slug: 'lincoln-high-track',
        joinCode: 'LHS-26',
        name: 'Lincoln High <Varsity> & $250 Track',
        shortName: 'LHS',
        orgType: 'HIGH_SCHOOL',
        primarySport: 'Running',
        primaryHex: '#B83A24',
        secondaryHex: '#D8FF2A',
        defaultSafeSportShield: true,
        coachDisplayName: 'Coach Rivera',
      },
      upcomingMeets: [],
      recentSchedule: [],
      rosterLeaderboard: [],
      stats: { athleteCount: 42, meetCount: 8, officialResultCount: 114 },
    };

    const mockJoinPreview: TeamInvitePreviewPayload = {
      found: true,
      brand: {
        teamId: 'tm_test_1',
        slug: 'lincoln-high-track',
        joinCode: 'LHS-26',
        name: 'Lincoln High Track',
        shortName: 'LHS',
        orgType: 'HIGH_SCHOOL',
        primarySport: 'Running',
        primaryHex: '#B83A24',
        secondaryHex: '#D8FF2A',
        defaultSafeSportShield: true,
        enableParentGuardianCc: true,
        coachDisplayName: 'Coach Rivera',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      membership: {
        membershipId: 'mem_1',
        invitedName: 'Secret Student',
        invitedEmail: 'student.secret@school.edu',
        parentGuardianEmail: 'parent.secret@example.com',
        squadGroup: 'Varsity',
        role: 'ATHLETE',
        isMinorU18: true,
        parentConsentStatus: 'PENDING',
      },
    };

    beforeAll(async () => {
      const app = express();
      app.use(
        createOgPreviewRouter({
          indexHtmlPath: path.join(os.tmpdir(), 'nonexistent-meetready-dist-index.html'),
          loadTeamHub: async (slug) =>
            slug === 'lincoln-high-track'
              ? mockTeamHub
              : {
                  found: false,
                  upcomingMeets: [],
                  recentSchedule: [],
                  rosterLeaderboard: [],
                  stats: { athleteCount: 0, meetCount: 0, officialResultCount: 0 },
                },
          loadTeamJoinPreview: async (slug) =>
            slug === 'lincoln-high-track' ? mockJoinPreview : { found: false },
        })
      );

      await new Promise<void>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          if (typeof addr === 'object' && addr) {
            baseUrl = `http://127.0.0.1:${addr.port}`;
          }
          resolve();
        });
      });

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-og-'));
      tmpHtmlPath = path.join(tmpDir, 'index.html');
      fs.writeFileSync(
        tmpHtmlPath,
        fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
        'utf8'
      );
      const shellApp = express();
      shellApp.use(
        createOgPreviewRouter({
          indexHtmlPath: tmpHtmlPath,
          loadTeamHub: async () => mockTeamHub,
          loadTeamJoinPreview: async () => mockJoinPreview,
        })
      );
      await new Promise<void>((resolve) => {
        shellServer = shellApp.listen(0, '127.0.0.1', () => {
          const addr = shellServer.address();
          if (typeof addr === 'object' && addr) {
            shellBaseUrl = `http://127.0.0.1:${addr.port}`;
          }
          resolve();
        });
      });
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
      await new Promise<void>((resolve) => (shellServer ? shellServer.close(() => resolve()) : resolve()));
      if (tmpHtmlPath) {
        fs.rmSync(path.dirname(tmpHtmlPath), { recursive: true, force: true });
      }
    });

    it('keeps shareWorkoutCodec React-free and re-exported from shareWorkoutRoute', () => {
      const codecSrc = fs.readFileSync(path.join(ROOT, 'src/utils/shareWorkoutCodec.ts'), 'utf8');
      expect(codecSrc).not.toMatch(/from\s+['"]react['"]/);
      expect(shareWorkoutRoute.decodeSharedWorkoutPayload).toBe(decodeSharedWorkoutPayload);
      expect(shareWorkoutRoute.formatMmSs).toBe(formatMmSs);

      const token = encodeSharedWorkoutPayload({
        kind: 'WORKOUT',
        version: 1,
        title: '8 x 400m Threshold',
        sport: 'Running',
        workoutSyntax: '8x400m @ 100%',
        plannedDurationSecs: 2400,
      });
      const decoded = decodeSharedWorkoutPayload(token);
      expect(decoded?.title).toBe('8 x 400m Threshold');
    });

    it('serves escaped dynamic OG tags on /team/:slug with short public CDN caching', async () => {
      const resp = await fetch(`${baseUrl}/team/lincoln-high-track`);
      expect(resp.status).toBe(200);
      expect(resp.headers.get('cache-control')).toBe(
        'public, s-maxage=300, stale-while-revalidate=600'
      );
      const html = await resp.text();
      expect(html).toContain('<title>Lincoln High &lt;Varsity&gt; &amp; $250 Track — MeetReady Team Hub</title>');
      expect(html).toContain('property="og:url" content="https://meetready.app/team/lincoln-high-track"');
      expect(html).toContain('property="og:image" content="https://meetready.app/brand/meetready-og-1200x630.png"');
      expect(html).toContain('42 athletes');
      expect(html).not.toContain('<Varsity>');
    });

    it('loads real index.html shell once and injects multiline meta replacements cleanly', async () => {
      const resp = await fetch(`${shellBaseUrl}/team/lincoln-high-track`);
      expect(resp.status).toBe(200);
      const html = await resp.text();
      expect(html).toContain('<title>Lincoln High &lt;Varsity&gt; &amp; $250 Track — MeetReady Team Hub</title>');
      expect(html).toContain('content="Lincoln High &lt;Varsity&gt; &amp; $250 Track (Running) public meet schedule');
      expect(html).toContain('<script type="module" src="/src/main.tsx"></script>');
    });

    it('never leaks ?t= token or emails on /join/:slug and enforces private, no-store when ?t= is present', async () => {
      const tokenizedResp = await fetch(
        `${baseUrl}/join/lincoln-high-track?t=secret_invite_token_xyz&email=leak@school.edu`
      );
      expect(tokenizedResp.status).toBe(200);
      expect(tokenizedResp.headers.get('cache-control')).toBe('private, no-store');
      const html = await tokenizedResp.text();
      expect(html).toContain('<title>Join Lincoln High Track on MeetReady</title>');
      expect(html).toContain('link rel="canonical" href="https://meetready.app/join/lincoln-high-track"');
      expect(html).toContain('property="og:url" content="https://meetready.app/join/lincoln-high-track"');
      expect(html).not.toContain('secret_invite_token_xyz');
      expect(html).not.toContain('leak@school.edu');
      expect(html).not.toContain('student.secret@school.edu');
      expect(html).not.toContain('Secret Student');

      const cleanResp = await fetch(`${baseUrl}/join/lincoln-high-track`);
      expect(cleanResp.status).toBe(200);
      expect(cleanResp.headers.get('cache-control')).toBe(
        'public, s-maxage=300, stale-while-revalidate=600'
      );
    });

    it('renders dynamic OG metadata on /share/workout without leaking emails', async () => {
      const encoded = encodeSharedWorkoutPayload({
        kind: 'STOPWATCH',
        version: 1,
        title: '4x800m Splits coach@school.edu',
        sport: 'Running',
        teamName: 'Paly Track',
        splits: [
          { label: 'Rep 1', lapTime: '2:12.40' },
          { label: 'Rep 2', lapTime: '2:11.85' },
        ],
      });
      const resp = await fetch(`${baseUrl}/share/workout?w=${encodeURIComponent(encoded)}`);
      expect(resp.status).toBe(200);
      expect(resp.headers.get('cache-control')).toBe(
        'public, s-maxage=300, stale-while-revalidate=600'
      );
      const html = await resp.text();
      expect(html).toContain('4x800m Splits [redacted] — MeetReady Stopwatch Splits');
      expect(html).toContain('2 splits');
      expect(html).not.toContain('coach@school.edu');
    });
  });

  describe('4. Print & Merch Outlined Vectors, 2-Ink Tee, Dynamic QR & Copy Cleanup', () => {
    it('eliminates <text> and <textPath> from print/sticker/merch SVGs and uses dynamic QR sizing', () => {
      const printIds = [
        'meetready-sticker-crest',
        'meetready-sticker-diecut',
        'meetready-merch-tee-back',
        'meetready-banner-10x3-qr',
      ];
      for (const id of printIds) {
        const asset = BRAND_ASSET_CATALOG.find((a) => a.id === id);
        expect(asset, `Missing asset ${id}`).toBeDefined();
        expect(asset!.svgMarkup).not.toMatch(/<text[\s>]/i);
        expect(asset!.svgMarkup).not.toMatch(/<textPath/i);
      }

      const crest = BRAND_ASSET_CATALOG.find((a) => a.id === 'meetready-sticker-crest')!;
      expect(crest.svgMarkup).toContain(CREST_TOP_MEETREADY_OUTLINE_PATH);
      expect(crest.svgMarkup).toContain(CREST_DOMAIN_LABEL_OUTLINE_PATH);

      const diecut = BRAND_ASSET_CATALOG.find((a) => a.id === 'meetready-sticker-diecut')!;
      expect(diecut.svgMarkup).toContain(DIECUT_DOMAIN_LABEL_OUTLINE_PATH);

      const tee = BRAND_ASSET_CATALOG.find((a) => a.id === 'meetready-merch-tee-back')!;
      expect(tee.svgMarkup).toContain(TEE_HEADLINE_OUTLINE_PATH);
      expect(tee.svgMarkup).not.toContain('#B83A24');
      expect(tee.svgMarkup).not.toContain('#A39E93');
      expect(tee.svgMarkup).not.toContain('opacity=');

      const banner = BRAND_ASSET_CATALOG.find((a) => a.id === 'meetready-banner-10x3-qr')!;
      const expectedQrTotal = generateQrMatrix('https://meetready.app/meet').length + 8;
      expect(banner.svgMarkup).toContain(BANNER_HEADLINE_OUTLINE_PATH);
      expect(banner.svgMarkup).toContain(`viewBox="0 0 ${expectedQrTotal} ${expectedQrTotal}"`);
    });

    it('updates stale pine surface swatch & copy while keeping exact copier badge labels', () => {
      expect(BRAND_ASSET_CATALOG).toHaveLength(23);
      const nightPhoto = BRAND_SURFACES.find((s) => s.id === 'photo-night');
      expect(nightPhoto?.swatchHex).toBe('#121413');

      const darkLockup = BRAND_ASSET_CATALOG.find((a) => a.id === 'meetready-lockup-dark')!;
      const blackStencil = BRAND_ASSET_CATALOG.find((a) => a.id === 'meetready-1ink-stencil')!;
      expect(evaluateAssetOnBackdrop(blackStencil, 'bw-copier').badgeLabel).toBe(
        'Copier Gold Standard'
      );
      expect(evaluateAssetOnBackdrop(darkLockup, 'bw-copier').badgeLabel).toBe('Avoid on Copier');
    });
  });
});
