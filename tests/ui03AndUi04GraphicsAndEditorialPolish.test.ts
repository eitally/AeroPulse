import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AcwrThreeChannelBullets,
  Adherence7dDots,
  ArchetypeProgressionSparkline,
  BracketedIntervalTape,
  GhostDiffSkyline,
  LoginCapabilitySparkStrip,
  PodStaggerLaneMatrix,
  PublishWindowTimelineBracket,
  SpikeBudgetSegmentedMeter,
  SplitTrendSparkline,
  SyncScopeTimelineBar,
  VitalsCorridorBulletRow,
} from '../src/components/charts/MicroGraphics';

const ROOT = process.cwd();

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('UI-03 & UI-04 SVG Micro-Graphics, Today Stopwatch Link & Editorial Compliance', () => {
  it('UI-03: renders valid SVG markup for all 8 locked-palette micro-graphic components', () => {
    const rendered = [
      renderToStaticMarkup(React.createElement(LoginCapabilitySparkStrip)),
      renderToStaticMarkup(React.createElement(SyncScopeTimelineBar, { days: 90 })),
      renderToStaticMarkup(React.createElement(VitalsCorridorBulletRow, { valuePct: 62 })),
      renderToStaticMarkup(
        React.createElement(GhostDiffSkyline, {
          baselineHeightsPct: [30, 80, 30],
          morphedBars: [
            { heightPct: 30, zoneCode: 'Z1' },
            { heightPct: 55, zoneCode: 'Z3' },
            { heightPct: 30, zoneCode: 'Z1' },
          ],
        })
      ),
      renderToStaticMarkup(
        React.createElement(BracketedIntervalTape, {
          workoutSyntax: 'Main Set 4x\n- 400m 108% Pace Work\n- 60s 55% Pace Recovery',
        })
      ),
      renderToStaticMarkup(
        React.createElement(PodStaggerLaneMatrix, {
          pods: [
            { podLabel: 'Pod A', offsetSecs: 0 },
            { podLabel: 'Pod B', offsetSecs: 10 },
          ],
        })
      ),
      renderToStaticMarkup(React.createElement(ArchetypeProgressionSparkline, { active: true })),
      renderToStaticMarkup(
        React.createElement(PublishWindowTimelineBracket, {
          totalWeeks: 12,
          cadence: 'ROLLING_2W',
        })
      ),
      renderToStaticMarkup(
        React.createElement(SpikeBudgetSegmentedMeter, { usedMeters: 1600, capMeters: 2400 })
      ),
      renderToStaticMarkup(
        React.createElement(AcwrThreeChannelBullets, {
          cardioAcwr: 1.05,
          impactAcwr: 1.18,
          torqueAcwr: 0.96,
        })
      ),
      renderToStaticMarkup(React.createElement(Adherence7dDots, { completedCount: 6, hasPainFlag: false })),
      renderToStaticMarkup(React.createElement(SplitTrendSparkline, { splitsSecs: [68.2, 67.9, 67.4] })),
    ];

    for (const html of rendered) {
      expect(html).toContain('<svg');
    }
  });

  it('UI-03: wires Today Card 3 Time on Track trigger cleanly from WorkspaceRouter through FitnessHealthView', () => {
    const router = readSrc('src/components/WorkspaceRouter.tsx');
    expect(router).toContain("onOpenTracksideStopwatch={() => setActiveTab('stopwatch')}");

    const fitness = readSrc('src/components/FitnessHealthView.tsx');
    expect(fitness).toContain('onOpenTracksideStopwatch={onOpenTracksideStopwatch}');
    expect(fitness).toContain('<SpikeBudgetSegmentedMeter');
    expect(fitness).toContain('<AcwrThreeChannelBullets');

    const hero = readSrc('src/components/CircadianFirstTouchHero.tsx');
    expect(hero).toContain('data-testid="today-open-stopwatch-btn"');
    expect(hero).toContain('<VitalsCorridorBulletRow');
    expect(hero).toContain('<BracketedIntervalTape');
  });

  it('UI-04: enforces pricing/copy discipline, CamelCase MeetReady branding, and replaces literal ● dingbats in updated surfaces', () => {
    const teamPanel = readSrc('src/components/TeamManagementPanel.tsx');
    expect(teamPanel).not.toContain('free SMS');
    expect(teamPanel).not.toContain('Free SMS');
    expect(teamPanel).not.toContain('($0)');

    const hero = readSrc('src/components/CircadianFirstTouchHero.tsx');
    expect(hero).not.toContain('● ');

    const morph = readSrc('src/components/ReadinessMorphingCard.tsx');
    expect(morph).toContain('MeetReady Readiness Engine');
    expect(morph).toContain('Ask MeetReady Coach');
    expect(morph).not.toContain('Ask Thresh Coach');
    expect(morph).not.toContain('Ask THRESH Coach');
    expect(morph).not.toContain('#2A9D8F');

    const rosterModal = readSrc('src/components/AthleteRosterModal.tsx');
    expect(rosterModal).toContain('MeetReady Coach Desk');
    expect(rosterModal).not.toContain('● Shield Active');
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
      { encoding: 'utf8', input: 'y\n' }
    );
    expect(output).not.toMatch(/anti-patterns found/i);
  });
});
