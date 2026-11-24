import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractActivitySeries,
  sampleSeriesAt,
} from '../src/components/activities/activitySeriesUtils';
import {
  buildActivityEffortPresentation,
  buildDayPlannedEffortStripe,
} from '../src/components/calendar/calendarEffortUtils';
import { ALL_GOAL_ARCHETYPES } from '../src/components/goals/goalArchetypeTemplates';
import { buildCompleteAthleteProfile } from '../src/utils/telemetryStorage';
import type { PlannedWorkoutEvent, UnifiedActivity } from '../src/types';

const ROOT = process.cwd();

function collectComponentFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...collectComponentFiles(p));
    } else if (ent.name.endsWith('.tsx') || ent.name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

describe('Sprint 3C: Monolith Decomposition Ceiling & Extracted Helper Guards', () => {
  it('enforces a strict <= 2,500-line ceiling on every file under src/components/', () => {
    const files = collectComponentFiles(path.join(ROOT, 'src/components'));
    expect(files.length).toBeGreaterThan(20);

    const violations: Array<{ file: string; lines: number }> = [];
    for (const file of files) {
      const lineCount = fs.readFileSync(file, 'utf8').split('\n').length;
      if (lineCount > 2500) {
        violations.push({ file: path.relative(ROOT, file), lines: lineCount });
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps src/types.ts, server/routers/teamRouter.ts, and telemetryStorage.ts as thin <= 120-line facades with <= 1,200-line submodules', () => {
    const facadeCeilings = [
      'src/types.ts',
      'server/routers/teamRouter.ts',
      'src/utils/telemetryStorage.ts',
    ];
    for (const rel of facadeCeilings) {
      const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n').length;
      expect(lines, `${rel} exceeded thin facade ceiling`).toBeLessThanOrEqual(120);
    }

    const domainDirs = ['src/types', 'server/routers/team', 'src/utils/telemetryStorage'];
    for (const dirRel of domainDirs) {
      const files = collectComponentFiles(path.join(ROOT, dirRel));
      expect(files.length, `${dirRel} should contain extracted domain modules`).toBeGreaterThanOrEqual(4);
      for (const file of files) {
        const lines = fs.readFileSync(file, 'utf8').split('\n').length;
        expect(lines, `${path.relative(ROOT, file)} exceeded 1,200-line module ceiling`).toBeLessThanOrEqual(1200);
      }
    }
  });

  it('extractActivitySeries and sampleSeriesAt extract and interpolate 1Hz activity streams accurately', () => {
    const mockActivity: UnifiedActivity = {
      id: 'act-series-1',
      name: 'Threshold Tempo',
      sportCategory: 'Cycling',
      subType: 'Road',
      environment: 'OUTDOOR',
      startDateLocal: '2026-11-18T08:00:00',
      movingTimeSecs: 100,
      distanceMeters: 1000,
      elevationGainMeters: 12,
      trainingLoad: 42,
      avgHr: 162,
      maxHr: 174,
      normalizedPower: 270,
      efficiencyFactor: 1.67,
      firstHalfEf: 1.7,
      secondHalfEf: 1.64,
      aerobicDecouplingPct: 2.1,
      intensityFactor: 0.9,
      variabilityIndex: 1.03,
      stravaPrCount: 0,
      segmentEfforts: [],
      sourceBadges: ['Strava'],
      zoneSecs: { hr: [10, 30, 30, 20, 10, 0, 0] },
      streams: {
        time: [0, 25, 50, 75, 100],
        watts: [200, 240, 280, 260, 220],
        heartrate: [130, 150, 165, 170, 155],
        cadence: [85, 90, 92, 91, 88],
      },
    };

    const { points, isRealStream } = extractActivitySeries(mockActivity, 1);
    expect(isRealStream).toBe(true);
    expect(points).toHaveLength(5);
    expect(points[2]).toMatchObject({ timeSecs: 50, pct: 50, power: 280, hr: 165, cadence: 92 });

    expect(sampleSeriesAt(points, 'TIME', 48)?.timeSecs).toBe(50);
    expect(sampleSeriesAt(points, 'PERCENT', 74)?.power).toBe(260);
    expect(sampleSeriesAt(points, 'TIME', 120)).toBeNull();
  });

  it('buildDayPlannedEffortStripe, buildActivityEffortPresentation, and ALL_GOAL_ARCHETYPES compute cleanly', () => {
    const profile = buildCompleteAthleteProfile({ ftp: 280, thresholdPaceSecsPerKm: 240 });
    const planned: PlannedWorkoutEvent[] = [
      {
        id: 'plan-1',
        date: '2026-11-19',
        name: 'Sweet Spot 3x10',
        sportCategory: 'Cycling',
        environmentPreference: 'OUTDOOR',
        plannedDurationSecs: 3600,
        plannedLoad: 72,
        targetZoneSummary: 'Z3/Z4 Sweet Spot',
        workoutSyntax:
          'Warmup\n- 15m 60%\n\nMain Set\n- 10m 90%\n- 5m 55%\n- 10m 90%\n\nCooldown\n- 10m 55%',
        description: 'Aerobic tempo & sweet spot blocks.',
      },
    ];

    const stripe = buildDayPlannedEffortStripe('2026-11-19', planned, undefined, []);
    expect(stripe).not.toBeNull();
    expect(stripe!.steps.length).toBeGreaterThan(2);
    expect(stripe!.totalDurationMins).toBeGreaterThan(0);

    const runAct: UnifiedActivity = {
      id: 'run-effort-1',
      name: 'Track Mile Repeats',
      sportCategory: 'Running',
      subType: 'Track',
      environment: 'OUTDOOR',
      startDateLocal: '2026-11-19T07:30:00',
      movingTimeSecs: 2400,
      distanceMeters: 8000,
      elevationGainMeters: 20,
      trainingLoad: 64,
      avgHr: 166,
      maxHr: 184,
      efficiencyFactor: 1.5,
      firstHalfEf: 1.52,
      secondHalfEf: 1.48,
      aerobicDecouplingPct: 2.5,
      intensityFactor: 0.92,
      variabilityIndex: 1.05,
      stravaPrCount: 1,
      segmentEfforts: [],
      sourceBadges: ['Strava'],
      zoneSecs: { power: [0, 0, 0, 0, 0, 0, 0], hr: [300, 900, 500, 400, 200, 100, 0] },
    };

    const presentation = buildActivityEffortPresentation(runAct, 280, profile);
    expect(presentation.slices.length).toBeGreaterThan(0);
    expect(presentation.zoneSharesPct.reduce((s, n) => s + n, 0)).toBeGreaterThan(95);

    expect(ALL_GOAL_ARCHETYPES.some((a) => a.trackEventGroup === '1500_MILE')).toBe(true);
    expect(ALL_GOAL_ARCHETYPES.length).toBeGreaterThanOrEqual(8);
  });
});
