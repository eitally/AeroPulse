import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function collectTsxFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsxFiles(fullPath));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('UI-01 & UI-02 Mobile Focus Stopwatch, Squad Triage Placement & Compact Density', () => {
  it('UI-01: fixes stored stopwatch false positive, defaults <1024px Focus HUD, floats AutoReg, and places Squad Triage in Roster', () => {
    const header = readSrc('src/components/CockpitHeader.tsx');
    expect(header).toContain('parsed.isRunning');
    expect(header).toContain('Number(parsed.accumulatedMs || 0) > 0');

    const stopwatch = readSrc('src/components/TracksideStopwatchView.tsx');
    expect(stopwatch).toContain('stopwatch-tools-btn');
    expect(stopwatch).toContain('isFloatingFocusMode={false}');
    expect(stopwatch).not.toContain('stopwatch-focus-mode-toggle');

    const coachView = readSrc('src/components/CoachWorkspaceView.tsx');
    expect(coachView).toContain('clipboard-flagged-triage-btn');
    expect(coachView).toContain("<CoachExecutionDigestPanel");
    expect(coachView).toContain("sessionStorage.setItem('thresh_open_plan_cohort', 'TEAM_ALL')");

    const goalsView = readSrc('src/components/GoalsView.tsx');
    expect(goalsView).toContain("sessionStorage.getItem('thresh_open_plan_cohort')");
    expect(goalsView).toContain("setPublishAudience('TEAM_ALL')");
  });

  it('UI-02: removes all text-3xs typography classes, fixes Custom range highlight bug, and keeps ChartInfoTooltip >=44px hit-slop', () => {
    const srcFiles = collectTsxFiles(path.join(ROOT, 'src'));
    const filesWith3xs = srcFiles.filter((filePath) =>
      fs.readFileSync(filePath, 'utf8').includes('text-3xs')
    );
    expect(filesWith3xs).toEqual([]);

    const tooltip = readSrc('src/components/ChartInfoTooltip.tsx');
    expect(tooltip).toContain('after:-inset-3');

    const fitness = readSrc('src/components/FitnessHealthView.tsx');
    expect(fitness).toContain('Custom…');
    const customBtnSlice = fitness.slice(
      fitness.indexOf('setIsDatePickerOpen((prev) => !prev)'),
      fitness.indexOf('Custom…')
    );
    expect(customBtnSlice).not.toContain("rangePreset === '7D'");
  });

  it('passes Impeccable DESIGN.md static audit with 0 anti-patterns across src/components', () => {
    const detectorPath =
      process.env.IMPECCABLE_DETECT_PATH ||
      path.join(
        os.homedir(),
        '.gemini/config/plugins/impeccable/skills/impeccable/scripts/detect.mjs'
      );
    if (!fs.existsSync(detectorPath)) {
      return;
    }
    const output = execFileSync(
      'node',
      [detectorPath, path.join(ROOT, 'src/components')],
      { encoding: 'utf8' }
    );
    expect(output).not.toMatch(/anti-patterns found/i);
  });
});
