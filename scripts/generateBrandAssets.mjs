import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { BRAND_ASSET_CATALOG } from '../src/utils/brandAssetEngine.ts';

const outDir = path.resolve(process.cwd(), 'public', 'brand');
fs.mkdirSync(outDir, { recursive: true });

// 1. Write all 17 canonical SVG files (with namespaced gradients and true compound knockouts)
for (const asset of BRAND_ASSET_CATALOG) {
  const target = path.join(outDir, `${asset.id}.svg`);
  fs.writeFileSync(target, asset.svgMarkup, 'utf8');
  console.log(`[Brand Gen] SVG -> ${path.relative(process.cwd(), target)} (${asset.svgMarkup.length} bytes)`);
}

// 2. Render key crisp high-DPI static PNG exports via headless Chromium
const pngTargets = [
  { id: 'thresh-og-1200x630', filename: 'thresh-og-1200x630.png', width: 1200, height: 630 },
  { id: 'thresh-lockup-dark', filename: 'thresh-lockup-dark-2x.png', width: 944, height: 248 },
  { id: 'thresh-lockup-light', filename: 'thresh-lockup-light-2x.png', width: 944, height: 248 },
  { id: 'thresh-sticker-diecut', filename: 'thresh-sticker-diecut-2x.png', width: 944, height: 248 },
  { id: 'thresh-1ink-stencil', filename: 'thresh-1ink-stencil-2x.png', width: 944, height: 248 },
  { id: 'thresh-1ink-stencil-white', filename: 'thresh-1ink-stencil-white-2x.png', width: 944, height: 248 },
  { id: 'thresh-icon-square-fullbleed', filename: 'thresh-icon-square-512.png', width: 512, height: 512 },
  { id: 'thresh-icon-square-fullbleed', filename: 'thresh-icon-square-1024.png', width: 1024, height: 1024 },
];

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
      `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden;width:${target.width}px;height:${target.height}px;}</style></head><body>${sizedSvg}</body></html>`,
      { waitUntil: 'load' }
    );
    const outPath = path.join(outDir, target.filename);
    await page.screenshot({
      path: outPath,
      omitBackground: true,
      clip: { x: 0, y: 0, width: target.width, height: target.height },
    });
    const size = fs.statSync(outPath).size;
    console.log(`[Brand Gen] PNG -> ${path.relative(process.cwd(), outPath)} (${target.width}x${target.height}, ${size} bytes)`);
  }
} finally {
  await browser.close();
}
