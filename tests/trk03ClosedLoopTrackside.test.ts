import { afterEach, describe, expect, it } from 'vitest';
import { computeTeamVdotPacingPods } from '../src/physiology/scholasticEngine';
import { buildPrintablePodClipboardHtml } from '../src/utils/teamQrHelper';
import {
  inferTrackWorkoutSpecFromPlannedEvent,
  readPersistedTracksideStopwatch,
  stageWorkoutInTracksideStopwatch,
  TRACKSIDE_STOPWATCH_STORAGE_KEY,
} from '../src/hooks/useTracksideStopwatch';

describe('TRK-03: Multi-Pod Tracking, 4-Up Clipboard & Closed-Loop Stopwatch Launch', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it('clusters multi-tier athletes into VDOT pods with un-clamped R splits, 300/600/1200 splits, and Pursuit wave offsets', () => {
    const pods = computeTeamVdotPacingPods({
      roster: [
        {
          id: 'ath-elite',
          name: 'Alex Fast',
          thresholdPaceSecsPerKm: 182,
          vdotOverride: 73.2,
          seedMarks: [{ distanceMeters: 1609.34, durationSecs: 245 }],
        },
        {
          id: 'ath-hs',
          name: 'Jordan Varsity',
          thresholdPaceSecsPerKm: 205,
          seedMarks: [{ distanceMeters: 1609.34, durationSecs: 275 }],
        },
        {
          id: 'ath-club',
          name: 'Taylor Pack',
          thresholdPaceSecsPerKm: 245,
          seedMarks: [{ distanceMeters: 1609.34, durationSecs: 320 }],
        },
      ],
      intensity: 'REPETITION',
      repCount: 8,
      repDistanceMeters: 400,
      recoveryLabel: '90s jog',
    });

    expect(pods.length).toBeGreaterThanOrEqual(2);

    const fastPod = pods[0];
    const slowPod = pods[pods.length - 1];

    expect(fastPod.splitsSecs.split400m).toBeLessThan(62.5);
    expect(fastPod.splitsSecs.split300m).toBeGreaterThan(0);
    expect(fastPod.splitsSecs.split600m).toBeGreaterThan(0);
    expect(fastPod.splitsSecs.split1200m).toBeGreaterThan(0);
    expect(fastPod.targetRepSplitSecs).toBeCloseTo(fastPod.splitsSecs.split400m, 1);

    // Slowest pod starts at 0.0s in Pursuit, faster pods hold to finish together
    expect(slowPod.pursuitStaggerOffsetSecs).toBe(0);
    const expectedOffset = Number(
      ((slowPod.targetRepSplitSecs ?? 0) - (fastPod.targetRepSplitSecs ?? 0)).toFixed(1)
    );
    expect(fastPod.pursuitStaggerOffsetSecs).toBeGreaterThan(0);
    expect(fastPod.pursuitStaggerOffsetSecs).toBeCloseTo(expectedOffset, 1);

    // Verify monotonic speed ordering across newly supported track intensities
    const subTPods = computeTeamVdotPacingPods({
      roster: [
        {
          id: 'ath-hs',
          name: 'Jordan Varsity',
          thresholdPaceSecsPerKm: 205,
          vdotOverride: 63.0,
        },
      ],
      intensity: 'SUB_THRESHOLD',
      repCount: 4,
      repDistanceMeters: 1200,
    });
    const race800Pods = computeTeamVdotPacingPods({
      roster: [
        {
          id: 'ath-hs',
          name: 'Jordan Varsity',
          thresholdPaceSecsPerKm: 205,
          vdotOverride: 63.0,
        },
      ],
      intensity: 'RACE_800M',
      repCount: 6,
      repDistanceMeters: 300,
    });

    expect(race800Pods[0].targetPaceSecsPerKm).toBeLessThan(pods[1]?.targetPaceSecsPerKm ?? 999);
    expect(pods[1]?.targetPaceSecsPerKm ?? 0).toBeLessThan(subTPods[0].targetPaceSecsPerKm);
    expect(subTPods[0].targetRepSplitSecs).toBeCloseTo(subTPods[0].splitsSecs.split1200m!, 1);
    expect(race800Pods[0].targetRepSplitSecs).toBeCloseTo(race800Pods[0].splitsSecs.split300m!, 1);
  });

  it('builds XSS-escaped 4-up landscape printable clipboard HTML with Pursuit offsets and full track splits', () => {
    const pods = computeTeamVdotPacingPods({
      roster: [
        { id: '1', name: '<b>Evil</b> Runner', thresholdPaceSecsPerKm: 195, vdotOverride: 67.5 },
        { id: '2', name: 'Pat Steady', thresholdPaceSecsPerKm: 245, vdotOverride: 54.0 },
      ],
      intensity: 'REPETITION',
      repCount: 6,
      repDistanceMeters: 400,
      recoveryLabel: '200m jog',
    });

    const html = buildPrintablePodClipboardHtml({
      workoutTitle: 'Mile Tune-Up 6x400m',
      dateStr: '2026-04-08',
      repDistanceMeters: 400,
      repCount: 6,
      recoveryLabel: '200m jog',
      pods,
      teamName: '<script>alert(1)</script> Oak Creek XC',
    });

    expect(html).toContain('@page { size: landscape');
    expect(html).toContain('.pod-grid');
    expect(html).toContain('Pursuit');
    expect(html).toContain('300m');
    expect(html).toContain('400m');
    expect(html).toContain('600m');
    expect(html).toContain('1600m');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<b>Evil</b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;Evil&lt;/b&gt; Runner');
  });

  it('infers TrackWorkoutSpec from AST/event and stages Pursuit custom-plan state into Trackside Stopwatch storage', () => {
    const explicitSpec = {
      repCount: 5,
      repDistanceMeters: 1000 as const,
      zoneCode: 'CV' as const,
      podIntensity: 'THRESHOLD_CV' as const,
      restDurationSecs: 60,
      waveMode: 'MASS' as const,
    };
    const preserved = inferTrackWorkoutSpecFromPlannedEvent({
      name: '5 x 1000m @ CV',
      workoutSyntax: '',
      trackSpec: explicitSpec,
    });
    expect(preserved).toEqual(explicitSpec);

    const parsedFromSyntax = inferTrackWorkoutSpecFromPlannedEvent({
      name: '8 x 400m Economy Reps',
      workoutSyntax:
        'Warmup\n- 15m 68% Pace\n\nMain Set 8x\n- 400m 116% Pace\n- 90s 55% Pace jog\n\nCooldown\n- 10m 65% Pace',
    });
    expect(parsedFromSyntax).not.toBeNull();
    expect(parsedFromSyntax?.repCount).toBe(8);
    expect(parsedFromSyntax?.repDistanceMeters).toBe(400);
    expect(parsedFromSyntax?.zoneCode).toBe('R');
    expect(parsedFromSyntax?.restDurationSecs).toBe(90);

    const storageMap = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => {
          storageMap.set(k, v);
        },
        removeItem: (k: string) => {
          storageMap.delete(k);
        },
      },
      dispatchEvent: () => true,
    };

    const pods = computeTeamVdotPacingPods({
      roster: [
        { id: '1', name: 'Fast Lead', thresholdPaceSecsPerKm: 185, vdotOverride: 71.0 },
        { id: '2', name: 'Pack Two', thresholdPaceSecsPerKm: 235, vdotOverride: 56.0 },
      ],
      intensity: 'REPETITION',
      repCount: 8,
      repDistanceMeters: 400,
    });

    stageWorkoutInTracksideStopwatch({
      title: 'Squad 8x400m Pursuit',
      spec: {
        repCount: 8,
        repDistanceMeters: 400,
        zoneCode: 'R',
        podIntensity: 'REPETITION',
        restDurationSecs: 90,
        waveMode: 'PURSUIT',
      },
      pods,
    });

    expect(storageMap.has(TRACKSIDE_STOPWATCH_STORAGE_KEY)).toBe(true);
    const persisted = readPersistedTracksideStopwatch();
    expect(persisted.sessionType).toBe('WORKOUT');
    expect(persisted.sessionTitle).toBe('Squad 8x400m Pursuit');
    expect(persisted.workoutPresetId).toBe('custom-plan');
    expect(persisted.customWorkoutSpec?.repCount).toBe(8);
    expect(persisted.customWorkoutSpec?.repDistanceMeters).toBe(400);
    expect(persisted.waveMode).toBe('PURSUIT');
    expect(persisted.restDurationSecs).toBe(90);
    expect(persisted.podWaveOffsetsSecs?.['Pod A']).toBeGreaterThan(0);
    expect(persisted.podWaveOffsetsSecs?.['Pod B']).toBe(0);
  });
});
