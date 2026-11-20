import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import app from '../server/vercelApp.ts';
import { warnServerFallback } from '../server/tokenVault.ts';

const ROOT = process.cwd();

const EXPLICIT_ANY_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'type annotation (: any)', regex: /:\s*any\b/g },
  { label: 'type assertion (as any)', regex: /\bas\s+any\b/g },
  { label: 'generic / angle bracket (<any>)', regex: /<any\b/g },
  { label: 'array of any (any[])', regex: /\bany\[\]/g },
  { label: 'comma generic arg (, any)', regex: /,\s*any\b/g },
  { label: 'Array<any>', regex: /\bArray<any>/g },
  { label: 'Promise<any>', regex: /\bPromise<any>/g },
  { label: 'return arrow (=> any)', regex: /=>\s*any\b/g },
];

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(fullPath));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Removes // line comments and /* block comments * / while preserving string/template
 * literals and preserving newline characters so reported line numbers stay exact.
 */
function stripCommentsPreserveLineNumbers(source: string): string {
  const out: string[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    // String or template literals (preserve verbatim, including // or /* inside)
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out.push(ch);
      i += 1;
      while (i < n) {
        const cur = source[i];
        out.push(cur);
        if (cur === '\\' && i + 1 < n) {
          out.push(source[i + 1]);
          i += 2;
          continue;
        }
        i += 1;
        if (cur === quote) break;
      }
      continue;
    }

    // Single-line comment
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < n && source[i] !== '\n') {
        i += 1;
      }
      continue;
    }

    // Block comment (preserve newlines)
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out.push('\n');
        i += 1;
      }
      i += 2;
      continue;
    }

    out.push(ch);
    i += 1;
  }
  return out.join('');
}

describe('Sprint 3D: Zero Explicit Any Guard & Server Boot/Observability', () => {
  it('contains zero explicit any usages in code across src/ and server/', () => {
    const files = [
      ...collectTsFiles(path.join(ROOT, 'src')),
      ...collectTsFiles(path.join(ROOT, 'server')),
    ];
    expect(files.length).toBeGreaterThan(80);

    const violations: string[] = [];
    for (const file of files) {
      const raw = fs.readFileSync(file, 'utf8');
      const stripped = stripCommentsPreserveLineNumbers(raw);
      const lines = stripped.split('\n');
      const rel = path.relative(ROOT, file);

      lines.forEach((line, idx) => {
        for (const { label, regex } of EXPLICIT_ANY_PATTERNS) {
          regex.lastIndex = 0;
          if (regex.test(line)) {
            violations.push(`${rel}:${idx + 1} [${label}] -> ${line.trim()}`);
          }
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it('boots server/vercelApp.ts cleanly and has a valid api/index.js bundle entry', async () => {
    expect(typeof app).toBe('function');
    const router = (app as { _router?: { stack?: unknown[] } })._router;
    expect(Array.isArray(router?.stack)).toBe(true);
    expect((router?.stack?.length ?? 0) > 0).toBe(true);

    const bundledEntry = path.join(ROOT, 'api', 'index.js');
    expect(fs.existsSync(bundledEntry)).toBe(true);
    const bundledCode = fs.readFileSync(bundledEntry, 'utf8');
    expect(bundledCode.length).toBeGreaterThan(1000);
    expect(bundledCode).toMatch(/export\s*\{[\s\S]*\bas default\b[\s\S]*\}/);

    const bundledMod = (await import('../api/index.js')) as { default?: unknown };
    expect(typeof bundledMod.default).toBe('function');
  });

  it('suppresses fallback console warnings in test runs and logs non-secret messages in runtime', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prevNodeEnv = process.env.NODE_ENV;
    const prevVitest = process.env.VITEST;

    try {
      // Under test env (current default), warnServerFallback must stay silent
      warnServerFallback('vault:test-silent', new Error('pool timeout'));
      expect(warnSpy).not.toHaveBeenCalled();

      // Outside test env, warnServerFallback emits only scope and Error.message
      process.env.NODE_ENV = 'production';
      delete process.env.VITEST;
      warnServerFallback('vault:test-runtime', new Error('connection reset'));
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith('[thresh:vault:test-runtime] connection reset');
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = prevVitest;
      warnSpy.mockRestore();
    }
  });
});
