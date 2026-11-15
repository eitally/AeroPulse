import { describe, expect, it } from 'vitest';
import {
  computeTeamVdotPacingPods,
  computeTrackEnvironmentSplitAdjustment,
  computeWorldAthleticsOvalLaneGeometry,
} from '../src/physiology/scholasticEngine';

describe('TRK-05: World Athletics Oval Lane, Indoor 200m, Heat, Wind & Altitude Physics', () => {
  it('computes exact World Athletics 400m oval lane distances (Lanes 1-8) and non-staggered 60.0s Lane-1 split scaling', () => {
    const l1 = computeWorldAthleticsOvalLaneGeometry(1);
    const l2 = computeWorldAthleticsOvalLaneGeometry(2);
    const l4 = computeWorldAthleticsOvalLaneGeometry(4);
    const l6 = computeWorldAthleticsOvalLaneGeometry(6);
    const l8 = computeWorldAthleticsOvalLaneGeometry(8);

    expect(l1.lapLengthMeters).toBeCloseTo(400.0, 1);
    expect(l2.lapLengthMeters).toBeCloseTo(407.04, 1);
    expect(l4.lapLengthMeters).toBeCloseTo(422.37, 1);
    expect(l6.lapLengthMeters).toBeCloseTo(437.7, 1);
    expect(l8.lapLengthMeters).toBeCloseTo(453.03, 1);

    expect(computeTrackEnvironmentSplitAdjustment({ baseTargetSplitSecs: 60, environment: { lane: 2 } }).adjustedTargetSplitSecs).toBeCloseTo(61.06, 1);
    expect(computeTrackEnvironmentSplitAdjustment({ baseTargetSplitSecs: 60, environment: { lane: 4 } }).adjustedTargetSplitSecs).toBeCloseTo(63.36, 1);
    expect(computeTrackEnvironmentSplitAdjustment({ baseTargetSplitSecs: 60, environment: { lane: 6 } }).adjustedTargetSplitSecs).toBeCloseTo(65.65, 1);
    expect(computeTrackEnvironmentSplitAdjustment({ baseTargetSplitSecs: 60, environment: { lane: 8 } }).adjustedTargetSplitSecs).toBeCloseTo(67.95, 1);

    // Staggered starts run exact 400m equivalent distance -> laneMultiplier === 1.0
    const l6Staggered = computeTrackEnvironmentSplitAdjustment({
      baseTargetSplitSecs: 60,
      environment: { lane: 6, isStaggeredStart: true },
    });
    expect(l6Staggered.laneMultiplier).toBe(1.0);
    expect(l6Staggered.adjustedTargetSplitSecs).toBeCloseTo(60.0, 2);
  });

  it('applies Mark Hadley T_air + T_dew interval 0.5x attenuation, <=300m speed preservation, and >180 heat abort gate', () => {
    const cool = computeTrackEnvironmentSplitAdjustment({
      baseTargetSplitSecs: 75,
      repDistanceMeters: 1000,
      zoneCode: 'CV',
      environment: { airTempF: 52, dewPointF: 44 }, // sum = 96 <= 100
      isIntervalSession: true,
    });
    expect(cool.hadleySumF).toBe(96);
    expect(cool.heatSlowdownPct).toBe(0);
    expect(cool.heatAbortTriggered).toBe(false);

    // Warm 75F + 65F = 140F -> continuous slowdown 3.0%, interval >=400m takes 0.5x = 1.5%
    const warmContinuous = computeTrackEnvironmentSplitAdjustment({
      baseTargetSplitSecs: 240,
      repDistanceMeters: 1000,
      zoneCode: 'T',
      environment: { airTempF: 75, dewPointF: 65 },
      isIntervalSession: false,
    });
    const warmInterval = computeTrackEnvironmentSplitAdjustment({
      baseTargetSplitSecs: 75,
      repDistanceMeters: 1000,
      zoneCode: 'CV',
      environment: { airTempF: 75, dewPointF: 65 },
      isIntervalSession: true,
    });
    expect(warmContinuous.heatSlowdownPct).toBeCloseTo(3.0, 2);
    expect(warmInterval.heatSlowdownPct).toBeCloseTo(1.5, 2);

    // Short R/FR <= 300m attenuates further (<= 1.5%)
    const shortRep = computeTrackEnvironmentSplitAdjustment({
      baseTargetSplitSecs: 29,
      repDistanceMeters: 200,
      zoneCode: 'R',
      environment: { airTempF: 86, dewPointF: 74 }, // sum = 160 -> continuous 6% -> 0.2x = 1.2%
      isIntervalSession: true,
    });
    expect(shortRep.heatSlowdownPct).toBeCloseTo(1.2, 2);
    expect(shortRep.heatAbortTriggered).toBe(false);

    // Unsafe heat: 98F + 84F = 182 > 180 -> Heat Abort Gate triggered
    const unsafeHeat = computeTrackEnvironmentSplitAdjustment({
      baseTargetSplitSecs: 75,
      repDistanceMeters: 1000,
      zoneCode: 'I',
      environment: { airTempF: 98, dewPointF: 84 },
      isIntervalSession: true,
    });
    expect(unsafeHeat.hadleySumF).toBe(182);
    expect(unsafeHeat.heatAbortTriggered).toBe(true);
    expect(unsafeHeat.advisoryNote).toMatch(/HEAT ABORT GATE/i);
  });

  it('models Davies/Pugh oval wind penalty (>= 4 m/s) and Daniels/Chapman altitude differential (>= 1000m)', () => {
    const calm = computeTrackEnvironmentSplitAdjustment({
      baseTargetSplitSecs: 60,
      environment: { windSpeedMps: 3.2 },
    });
    expect(calm.windNetSlowdownPct).toBe(0);

    const breezy = computeTrackEnvironmentSplitAdjustment({
      baseTargetSplitSecs: 60,
      environment: { windSpeedMps: 7.0 },
    });
    expect(breezy.windNetSlowdownPct).toBeGreaterThan(0.5);
    expect(breezy.windTolerancePlusMinusSecs).toBeGreaterThan(1.5);
    expect(breezy.adjustedTargetSplitSecs).toBeGreaterThan(60.3);

    // Daniels/Chapman at 1800m: 200m R rep keeps 0% speed penalty + 1.35-1.75x extended rest
    const alt200mR = computeTrackEnvironmentSplitAdjustment({
      baseTargetSplitSecs: 28.5,
      repDistanceMeters: 200,
      baseRestDurationSecs: 120,
      zoneCode: 'R',
      environment: { altitudeMeters: 1800 },
    });
    expect(alt200mR.altitudeSlowdownPct).toBe(0);
    expect(alt200mR.adjustedTargetSplitSecs).toBeCloseTo(28.5, 2);
    expect(alt200mR.altitudeRestMultiplier).toBeGreaterThanOrEqual(1.35);
    expect(alt200mR.altitudeRestMultiplier).toBeLessThanOrEqual(1.75);
    expect(alt200mR.adjustedRestDurationSecs).toBeGreaterThanOrEqual(162);

    // Daniels/Chapman at 1800m: 1000m I rep slows split & extends rest
    const alt1000mI = computeTrackEnvironmentSplitAdjustment({
      baseTargetSplitSecs: 180,
      repDistanceMeters: 1000,
      baseRestDurationSecs: 120,
      zoneCode: 'I',
      environment: { altitudeMeters: 1800 },
    });
    expect(alt1000mI.altitudeSlowdownPct).toBeGreaterThan(4.0);
    expect(alt1000mI.adjustedTargetSplitSecs).toBeGreaterThan(187);
    expect(alt1000mI.adjustedRestDurationSecs).toBeGreaterThan(120);
  });

  it('applies INDOOR_FLAT_200M tight-turn multipliers and scales computeTeamVdotPacingPods targets', () => {
    const flatR = computeTrackEnvironmentSplitAdjustment({
      baseTargetSplitSecs: 60,
      zoneCode: 'R',
      environment: { facility: 'INDOOR_FLAT_200M' },
    });
    const flatI = computeTrackEnvironmentSplitAdjustment({
      baseTargetSplitSecs: 60,
      zoneCode: 'I',
      environment: { facility: 'INDOOR_FLAT_200M' },
    });
    const flatT = computeTrackEnvironmentSplitAdjustment({
      baseTargetSplitSecs: 60,
      zoneCode: 'T',
      environment: { facility: 'INDOOR_FLAT_200M' },
    });
    const banked = computeTrackEnvironmentSplitAdjustment({
      baseTargetSplitSecs: 60,
      zoneCode: 'R',
      environment: { facility: 'INDOOR_BANKED_200M' },
    });

    expect(flatR.facilityMultiplier).toBe(1.015);
    expect(flatI.facilityMultiplier).toBe(1.012);
    expect(flatT.facilityMultiplier).toBe(1.009);
    expect(banked.facilityMultiplier).toBe(1.0);

    const roster = [
      { id: 'a1', name: 'Varsity A', vdotOverride: 62, thresholdPaceSecsPerKm: 205 },
      { id: 'a2', name: 'Varsity B', vdotOverride: 54, thresholdPaceSecsPerKm: 232 },
    ];
    const baselinePods = computeTeamVdotPacingPods({
      roster,
      intensity: 'INTERVAL_VO2',
      repCount: 6,
      repDistanceMeters: 400,
      recoveryLabel: '90s jog',
    });
    const adjustedPods = computeTeamVdotPacingPods({
      roster,
      intensity: 'INTERVAL_VO2',
      repCount: 6,
      repDistanceMeters: 400,
      recoveryLabel: '90s jog',
      environment: {
        lane: 4,
        facility: 'INDOOR_FLAT_200M',
        airTempF: 85,
        dewPointF: 70,
        windSpeedMps: 6,
        altitudeMeters: 1600,
      },
    });

    expect(adjustedPods).toHaveLength(baselinePods.length);
    expect(adjustedPods[0].environmentAdjustment).toBeDefined();
    expect(adjustedPods[0].targetRepSplitSecs!).toBeGreaterThan(
      baselinePods[0].targetRepSplitSecs! + 4
    );
  });
});
