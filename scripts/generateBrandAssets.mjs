import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { BRAND_ASSET_CATALOG, buildAdOgBannerSvg } from '../src/utils/brandAssetEngine.ts';

const outDir = path.resolve(process.cwd(), 'public', 'brand');
const publicDir = path.resolve(process.cwd(), 'public');
fs.mkdirSync(outDir, { recursive: true });

// 1. Write all canonical catalog SVGs + AD OpenGraph SVG
for (const asset of BRAND_ASSET_CATALOG) {
  const target = path.join(outDir, `${asset.id}.svg`);
  fs.writeFileSync(target, asset.svgMarkup, 'utf8');
  console.log(`[Brand Gen] SVG -> ${path.relative(process.cwd(), target)} (${asset.svgMarkup.length} bytes)`);
}

const adOgSvg = buildAdOgBannerSvg();
fs.writeFileSync(path.join(outDir, 'meetready-og-ad-1200x630.svg'), adOgSvg, 'utf8');
console.log(`[Brand Gen] SVG -> public/brand/meetready-og-ad-1200x630.svg (${adOgSvg.length} bytes)`);

// 2. Render crisp high-DPI static PNG exports + full-bleed opaque iOS/PWA app icons
const pngTargets = [
  { id: 'meetready-og-1200x630', outPath: path.join(outDir, 'meetready-og-1200x630.png'), width: 1200, height: 630, omitBackground: false },
  { customSvg: adOgSvg, outPath: path.join(outDir, 'meetready-og-ad-1200x630.png'), width: 1200, height: 630, omitBackground: false },
  { id: 'meetready-lockup-dark', outPath: path.join(outDir, 'meetready-lockup-dark-2x.png'), width: 944, height: 248, omitBackground: true },
  { id: 'meetready-lockup-light', outPath: path.join(outDir, 'meetready-lockup-light-2x.png'), width: 944, height: 248, omitBackground: true },
  { id: 'meetready-stacked-dark', outPath: path.join(outDir, 'meetready-stacked-dark-2x.png'), width: 640, height: 480, omitBackground: true },
  { id: 'meetready-stacked-light', outPath: path.join(outDir, 'meetready-stacked-light-2x.png'), width: 640, height: 480, omitBackground: true },
  { id: 'meetready-sticker-diecut', outPath: path.join(outDir, 'meetready-sticker-diecut-2x.png'), width: 944, height: 248, omitBackground: true },
  { id: 'meetready-sticker-crest', outPath: path.join(outDir, 'meetready-sticker-crest-2x.png'), width: 720, height: 720, omitBackground: true },
  { id: 'meetready-sticker-mark-diecut', outPath: path.join(outDir, 'meetready-sticker-mark-diecut-2x.png'), width: 600, height: 600, omitBackground: true },
  { id: 'meetready-1ink-stencil', outPath: path.join(outDir, 'meetready-1ink-stencil-2x.png'), width: 944, height: 248, omitBackground: true },
  { id: 'meetready-1ink-stencil-white', outPath: path.join(outDir, 'meetready-1ink-stencil-white-2x.png'), width: 944, height: 248, omitBackground: true },
  { id: 'meetready-merch-tee-back', outPath: path.join(outDir, 'meetready-merch-tee-back-2x.png'), width: 1200, height: 880, omitBackground: false },
  { id: 'meetready-banner-10x3-qr', outPath: path.join(outDir, 'meetready-banner-10x3-qr-2x.png'), width: 2400, height: 720, omitBackground: false },
  { id: 'meetready-icon-square-fullbleed', outPath: path.join(outDir, 'meetready-icon-square-512.png'), width: 512, height: 512, omitBackground: false },
  { id: 'meetready-icon-square-fullbleed', outPath: path.join(outDir, 'meetready-icon-square-1024.png'), width: 1024, height: 1024, omitBackground: false },
  // Full-bleed opaque #0B120E exports for iOS apple-touch-icon (prevents black transparent corners!) & PWA launcher
  { id: 'meetready-icon-square-fullbleed', outPath: path.join(publicDir, 'apple-touch-icon.png'), width: 180, height: 180, omitBackground: false },
  { id: 'meetready-icon-square-fullbleed', outPath: path.join(publicDir, 'pwa-192x192.png'), width: 192, height: 192, omitBackground: false },
  { id: 'meetready-icon-square-fullbleed', outPath: path.join(publicDir, 'pwa-512x512.png'), width: 512, height: 512, omitBackground: false },
  { id: 'meetready-icon-square-fullbleed', outPath: path.join(publicDir, 'pwa-maskable-512x512.png'), width: 512, height: 512, omitBackground: false },
];

const FONT_LINKS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" rel="stylesheet">`;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const target of pngTargets) {
    const svgMarkup = target.customSvg ?? BRAND_ASSET_CATALOG.find((a) => a.id === target.id)?.svgMarkup;
    if (!svgMarkup) {
      throw new Error(`Missing catalog asset ${target.id}`);
    }
    await page.setViewportSize({ width: target.width, height: target.height });
    const sizedSvg = svgMarkup.replace(
      '<svg ',
      `<svg width="${target.width}" height="${target.height}" style="display:block;width:${target.width}px;height:${target.height}px;" `
    );
    await page.setContent(
      `<!doctype html><html><head>${FONT_LINKS}<style>html,body{margin:0;padding:0;background:${target.omitBackground ? 'transparent' : '#0B120E'};overflow:hidden;width:${target.width}px;height:${target.height}px;}</style></head><body>${sizedSvg}</body></html>`,
      { waitUntil: 'networkidle' }
    );
    await page.evaluate(async () => {
      if (document.fonts) {
        await Promise.race([
          Promise.all([
            document.fonts.load('800 34px "Plus Jakarta Sans"'),
            document.fonts.load('700 18px "JetBrains Mono"'),
            document.fonts.ready,
          ]),
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ]);
      }
    });
    await page.screenshot({
      path: target.outPath,
      omitBackground: Boolean(target.omitBackground),
      clip: { x: 0, y: 0, width: target.width, height: target.height },
    });
    const size = fs.statSync(target.outPath).size;
    console.log(`[Brand Gen] PNG -> ${path.relative(process.cwd(), target.outPath)} (${target.width}x${target.height}, ${size} bytes)`);
  }
} finally {
  await browser.close();
}
