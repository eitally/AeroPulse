import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { findMixedCaseBrandLeaks } from './checkBrandCasing.mjs';

const MAX_ENTRY_GZIP_BYTES = 220 * 1024; // 220 KB gzip strict entry chunk ceiling
const MAX_CRITICAL_INITIAL_GZIP_BYTES = 290 * 1024; // 290 KB gzip total initial HTML scripts + modulepreloads + css ceiling
const MAX_PWA_PRECACHE_RAW_BYTES = 1800 * 1024; // 1,800 KB raw ceiling for essential offline shell + stopwatch precache
const distDir = path.resolve(process.cwd(), 'dist');
const assetsDir = path.join(distDir, 'assets');

if (!fs.existsSync(assetsDir)) {
  console.error('ERROR: dist/assets not found. Run `npm run build` first.');
  process.exit(1);
}

// 1. Ensure zero leaked screenshots or sensitive developer artifacts exist anywhere in dist/
function walkFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

const allDistFiles = walkFiles(distDir);
const leakedFiles = allDistFiles.filter((f) => /screenshot|\.env/i.test(path.basename(f)));
if (leakedFiles.length > 0) {
  console.error('ERROR: Sensitive or screenshot files detected in dist/:', leakedFiles);
  process.exit(1);
}

// 2. Check gzipped size of entry JS chunk(s) matching index-*.js
const assetFiles = fs.readdirSync(assetsDir);
const entryJsFiles = assetFiles.filter((f) => /^index-[A-Za-z0-9_-]+\.js$/.test(f));

if (entryJsFiles.length === 0) {
  console.error('ERROR: Could not find entry index-*.js chunk in dist/assets.');
  process.exit(1);
}

for (const file of entryJsFiles) {
  const raw = fs.readFileSync(path.join(assetsDir, file));
  const gzipped = zlib.gzipSync(raw, { level: 9 });
  const kbGzip = (gzipped.length / 1024).toFixed(2);
  const kbRaw = (raw.length / 1024).toFixed(2);
  console.log(
    `[Bundle Budget] ${file}: ${kbRaw} KB raw | ${kbGzip} KB gzip (limit: ${(
      MAX_ENTRY_GZIP_BYTES / 1024
    ).toFixed(0)} KB gzip)`
  );
  if (gzipped.length > MAX_ENTRY_GZIP_BYTES) {
    console.error(
      `ERROR: Entry chunk ${file} (${kbGzip} KB gzip) exceeds 220 KB gzip budget!`
    );
    process.exit(1);
  }
}

// 2b. Check total critical initial JS+CSS load referenced by dist/index.html
const indexHtmlPath = path.join(distDir, 'index.html');
if (fs.existsSync(indexHtmlPath)) {
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  const assetRefs = Array.from(
    new Set([...indexHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]))
  );
  let criticalRaw = 0;
  let criticalGzip = 0;
  for (const ref of assetRefs) {
    const refPath = path.join(distDir, ref.replace(/^\//, ''));
    if (!fs.existsSync(refPath)) continue;
    const raw = fs.readFileSync(refPath);
    criticalRaw += raw.length;
    criticalGzip += zlib.gzipSync(raw, { level: 9 }).length;
  }
  console.log(
    `[Critical Initial Budget] ${assetRefs.length} assets: ${(criticalRaw / 1024).toFixed(2)} KB raw | ${(
      criticalGzip / 1024
    ).toFixed(2)} KB gzip (limit: ${(MAX_CRITICAL_INITIAL_GZIP_BYTES / 1024).toFixed(0)} KB gzip)`
  );
  if (criticalGzip > MAX_CRITICAL_INITIAL_GZIP_BYTES) {
    console.error(
      `ERROR: Critical initial load (${(criticalGzip / 1024).toFixed(2)} KB gzip) exceeds 290 KB gzip budget!`
    );
    process.exit(1);
  }
}

// 2c. Check Workbox PWA precache size in dist/sw.js
const swPath = path.join(distDir, 'sw.js');
if (fs.existsSync(swPath)) {
  const swSource = fs.readFileSync(swPath, 'utf8');
  const precacheUrls = Array.from(
    new Set([...swSource.matchAll(/url:\s*"([^"]+)"/g)].map((m) => m[1]))
  );
  let precacheRaw = 0;
  for (const url of precacheUrls) {
    const filePath = path.join(distDir, url.replace(/^\//, ''));
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      precacheRaw += fs.statSync(filePath).size;
    }
  }
  console.log(
    `[PWA Precache Budget] ${precacheUrls.length} entries: ${(precacheRaw / 1024).toFixed(
      2
    )} KB raw (limit: ${(MAX_PWA_PRECACHE_RAW_BYTES / 1024).toFixed(0)} KB raw)`
  );
  if (precacheRaw > MAX_PWA_PRECACHE_RAW_BYTES) {
    console.error(
      `ERROR: PWA precache (${(precacheRaw / 1024).toFixed(2)} KB raw) exceeds 1,800 KB raw budget!`
    );
    process.exit(1);
  }
}

// 3. Verify both native TypeScript server (`server/vercelApp.ts`) and bundled Vercel function (`api/index.js`) boot cleanly
try {
  const tsMod = await import('../server/vercelApp.ts');
  const jsMod = await import('../api/index.js');
  if (!tsMod?.default || !jsMod?.default) {
    console.error('ERROR: Server entry did not export a default Express app.');
    process.exit(1);
  }
  const srv = jsMod.default.listen(0);
  const port = srv.address().port;
  const probe = await fetch(
    `http://127.0.0.1:${port}/api/strava/auth/url?origin=https%3A%2F%2Fthresh.vercel.app&mode=cloud&state=smoketest1234`,
    { headers: { 'x-strava-client-id': '10001', 'x-strava-client-secret': 'smoke_secret' } }
  );
  srv.close();
  if (probe.status !== 200) {
    console.error(`ERROR: /api/strava/auth/url smoke probe returned HTTP ${probe.status}`);
    process.exit(1);
  }
  console.log('[Server Bundle Check] PASS — api/index.js & server/vercelApp.ts verified (Strava OAuth URL HTTP 200).');
} catch (err) {
  console.error('ERROR: Server entry verification failed (would cause HTTP 500 on Vercel):', err);
  process.exit(1);
}

const brandLeaks = findMixedCaseBrandLeaks(process.cwd());
if (brandLeaks.length > 0) {
  console.error('[Brand Casing Check] FAIL — mixed-case "Thresh" detected:');
  for (const leak of brandLeaks) {
    console.error(`  ${leak.file}:${leak.line}: ${leak.text}`);
  }
  process.exit(1);
}
console.log('[Brand Casing Check] PASS — 0 mixed-case "Thresh" leaks.');
console.log('[Bundle Budget] PASS — entry bundle within budget and dist/ clean.');
