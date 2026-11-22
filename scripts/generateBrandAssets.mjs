import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { BRAND_ASSET_CATALOG } from '../src/utils/brandAssetEngine.ts';

const outDir = path.resolve(process.cwd(), 'public', 'brand');
const publicDir = path.resolve(process.cwd(), 'public');
fs.mkdirSync(outDir, { recursive: true });

// 1. Write all 17 canonical SVG files (with true S2 x W-A compound knockouts)
for (const asset of BRAND_ASSET_CATALOG) {
  const target = path.join(outDir, `${asset.id}.svg`);
  fs.writeFileSync(target, asset.svgMarkup, 'utf8');
  console.log(`[Brand Gen] SVG -> ${path.relative(process.cwd(), target)} (${asset.svgMarkup.length} bytes)`);
}

// 2. Render key crisp high-DPI static PNG exports + PWA app icons via headless Chromium
const pngTargets = [
  { id: 'meetready-og-1200x630', outPath: path.join(outDir, 'meetready-og-1200x630.png'), width: 1200, height: 630 },
  { id: 'meetready-lockup-dark', outPath: path.join(outDir, 'meetready-lockup-dark-2x.png'), width: 944, height: 248 },
  { id: 'meetready-lockup-light', outPath: path.join(outDir, 'meetready-lockup-light-2x.png'), width: 944, height: 248 },
  { id: 'meetready-sticker-diecut', outPath: path.join(outDir, 'meetready-sticker-diecut-2x.png'), width: 944, height: 248 },
  { id: 'meetready-1ink-stencil', outPath: path.join(outDir, 'meetready-1ink-stencil-2x.png'), width: 944, height: 248 },
  { id: 'meetready-1ink-stencil-white', outPath: path.join(outDir, 'meetready-1ink-stencil-white-2x.png'), width: 944, height: 248 },
  { id: 'meetready-icon-square-fullbleed', outPath: path.join(outDir, 'meetready-icon-square-512.png'), width: 512, height: 512 },
  { id: 'meetready-icon-square-fullbleed', outPath: path.join(outDir, 'meetready-icon-square-1024.png'), width: 1024, height: 1024 },
  { id: 'meetready-icon-tile-dark', outPath: path.join(publicDir, 'apple-touch-icon.png'), width: 180, height: 180 },
  { id: 'meetready-icon-tile-dark', outPath: path.join(publicDir, 'pwa-192x192.png'), width: 192, height: 192 },
  { id: 'meetready-icon-tile-dark', outPath: path.join(publicDir, 'pwa-512x512.png'), width: 512, height: 512 },
  { id: 'meetready-icon-square-fullbleed', outPath: path.join(publicDir, 'pwa-maskable-512x512.png'), width: 512, height: 512 },
];

const FONT_LINKS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@600&family=Plus+Jakarta+Sans:wght@700;800&display=swap" rel="stylesheet">`;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const target of pngTargets) {
    const asset = BRAND_ASSET_CATALOG.find((a) => a.id === target.id);
    if (!asset) {
      throw new Error(`Missing catalog asset ${target.id}`);
    }
    await page.setViewportSize({ width: target.width, height: target.height });
    const sizedSvg = asset.svgMarkup.replace(
      '<svg ',
      `<svg width="${target.width}" height="${target.height}" style="display:block;width:${target.width}px;height:${target.height}px;" `
    );
    await page.setContent(
      `<!doctype html><html><head>${FONT_LINKS}<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden;width:${target.width}px;height:${target.height}px;}</style></head><body>${sizedSvg}</body></html>`,
      { waitUntil: 'domcontentloaded' }
    );
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) {
        await Promise.race([
          document.fonts.ready,
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      }
    });
    await page.screenshot({
      path: target.outPath,
      omitBackground: true,
      clip: { x: 0, y: 0, width: target.width, height: target.height },
    });
    const size = fs.statSync(target.outPath).size;
    console.log(`[Brand Gen] PNG -> ${path.relative(process.cwd(), target.outPath)} (${target.width}x${target.height}, ${size} bytes)`);
  }
} finally {
  await browser.close();
}
