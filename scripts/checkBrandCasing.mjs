import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.html',
  '.css',
  '.md',
]);

const SCAN_ROOTS = ['src', 'server', 'public', 'docs', 'README.md', 'DESIGN.md'];
const MIXED_CASE_BRAND_RE = /\b(?:THRESH|Thresh|MEETREADY|Meetready|meetReady)\b/;

function walkTarget(absPath, out) {
  if (!fs.existsSync(absPath)) return;
  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(absPath, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walkTarget(path.join(absPath, entry.name), out);
    }
    return;
  }
  if (TEXT_EXTENSIONS.has(path.extname(absPath).toLowerCase())) {
    out.push(absPath);
  }
}

export function findMixedCaseBrandLeaks(rootDir = process.cwd()) {
  const files = [];
  for (const rel of SCAN_ROOTS) {
    walkTarget(path.join(rootDir, rel), files);
  }
  const leaks = [];
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (MIXED_CASE_BRAND_RE.test(lines[i])) {
        leaks.push({
          file: path.relative(rootDir, filePath),
          line: i + 1,
          text: lines[i].trim().slice(0, 140),
        });
      }
    }
  }
  return leaks;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const leaks = findMixedCaseBrandLeaks(process.cwd());
  if (leaks.length > 0) {
    console.error('[Brand Casing Check] FAIL — non-canonical brand casing detected (must be CamelCase MeetReady):');
    for (const leak of leaks) {
      console.error(`  ${leak.file}:${leak.line}: ${leak.text}`);
    }
    process.exit(1);
  }
  console.log('[Brand Casing Check] PASS — 0 non-canonical brand casing leaks across src/, server/, public/, docs/, README.md, DESIGN.md.');
}
