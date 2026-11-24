import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  inferWorkoutLibraryCategory,
  parseStructuredTrackWorkout,
} from '../src/utils/workoutParser';
import { buildSampleDemoCoachSquad } from '../src/data/sampleDemoData';

const ROOT = process.cwd();

describe('Coach-POV walkthrough polish regressions', () => {
  it('parses WU and CD abbreviations in coach shorthand alongside interval repeats', () => {
    const ast = parseStructuredTrackWorkout('2mi WU, 6x400m @ 5K (60s rest), 1mi CD', 240);
    expect(ast).toHaveLength(3);
    expect(ast[0]).toMatchObject({ type: 'step' });
    if (ast[0].type === 'step') {
      expect(ast[0].step.stepKind).toBe('warmup');
      expect(ast[0].step.distanceMeters).toBe(3219);
    }
    expect(ast[1]).toMatchObject({ type: 'repeat', repeatCount: 6 });
    expect(ast[2]).toMatchObject({ type: 'step' });
    if (ast[2].type === 'step') {
      expect(ast[2].step.stepKind).toBe('cooldown');
      expect(ast[2].step.distanceMeters).toBe(1609);
    }
  });

  it('infers TRACK and XC_TEMPO workout library categories accurately even under 45 TSS', () => {
    expect(
      inferWorkoutLibraryCategory({
        sportCategory: 'Running',
        name: '5x1000m CV Ladder Test',
        plannedLoad: 38,
        isTrack: true,
      })
    ).toBe('TRACK');

    expect(
      inferWorkoutLibraryCategory({
        sportCategory: 'Running',
        name: '6x400m @ 5K',
        description: '6 x 400m',
        plannedLoad: 26,
        isTrack: true,
      })
    ).toBe('TRACK');

    expect(
      inferWorkoutLibraryCategory({
        sportCategory: 'Running',
        name: 'Hill Strides & Tempo',
        plannedLoad: 34,
        isTrack: false,
      })
    ).toBe('XC_TEMPO');

    expect(
      inferWorkoutLibraryCategory({
        sportCategory: 'Running',
        name: 'Easy Shakeout Run',
        plannedLoad: 22,
        isTrack: false,
      })
    ).toBe('RECOVERY');
  });

  it('populates explicit genderDivision on demo athletes for balanced Boys/Girls Meet-Day ops', () => {
    const squad = buildSampleDemoCoachSquad();
    const athletes = squad.memberships.filter((m) => m.role === 'ATHLETE');
    const byName = new Map(athletes.map((a) => [a.invitedName, a.genderDivision]));
    expect(byName.get('Maya Chen')).toBe('F');
    expect(byName.get('Sofia Rodriguez')).toBe('F');
    expect(byName.get('Chloe Okafor')).toBe('F');
    expect(byName.get('Ava Washington')).toBe('F');
    expect(byName.get('Lucas Alvarez')).toBe('M');
    expect(byName.get('Devon Carter')).toBe('M');
    expect(athletes.filter((a) => a.genderDivision === 'F').length).toBe(6);
    expect(athletes.filter((a) => a.genderDivision === 'M').length).toBe(6);
  });

  it('keeps coach UI fixes intact across Inspector, MeetDay, Builder, Stopwatch, Messaging & CSS', () => {
    const inspectorSrc = fs.readFileSync(
      path.join(ROOT, 'src/components/activities/ActivityInspectorModal.tsx'),
      'utf8'
    );
    expect(inspectorSrc).toContain('RPE, Exogenous Fueling (g/hr · mg/hr) &amp; Gear Tag');
    expect(inspectorSrc).not.toContain('(`g/hr` · `mg/hr`)');
    expect(inspectorSrc).not.toContain('>mg/h<');

    const meetSrc = fs.readFileSync(
      path.join(ROOT, 'src/components/coach/MeetDayHeatAndFlightModal.tsx'),
      'utf8'
    );
    expect(meetSrc).toContain('aria-label="Back to Calendar"');

    const builderSrc = fs.readFileSync(
      path.join(ROOT, 'src/components/VisualWorkoutBuilder.tsx'),
      'utf8'
    );
    expect(builderSrc).toContain('col-span-2 sm:col-span-3 flex gap-1.5');
    expect(builderSrc).toContain('min-w-[56px]');

    const hudSrc = fs.readFileSync(
      path.join(ROOT, 'src/components/stopwatch/TracksideHudSetupControls.tsx'),
      'utf8'
    );
    expect(hudSrc).toContain("showChuteBar ? 'Chute Bar ON' : 'Show Chute'");

    const feedSrc = fs.readFileSync(
      path.join(ROOT, 'src/components/coach/messaging/TeamMessagingFeedAndComposer.tsx'),
      'utf8'
    );
    expect(feedSrc).toContain('min-h-[180px]');

    const cssSrc = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8');
    expect(cssSrc).toContain('align-content: center;');
  });
});
