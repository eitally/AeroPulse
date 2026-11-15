import { describe, expect, it } from 'vitest';
import { buildTrackSpeedReserveProfile } from '../src/physiology/trackSpeedReserveEngine';
import { generatePeriodizedTrackPlan } from '../src/physiology/trackPrescriptionEngine';

describe('TRK-02: Event x Phase Periodized Track Plan Architect', () => {
  it('prescribes distinct 400m @ R splits across 4:05 vs 5:15 milers and applies Tier 3-4 VO2max rep-duration guards for 6:15 milers', () => {
    const elite405 = buildTrackSpeedReserveProfile({
      marks: [{ distanceMeters: 1609.34, durationSecs: 245 }],
    });
    const club515 = buildTrackSpeedReserveProfile({
      marks: [{ distanceMeters: 1609.34, durationSecs: 315 }],
    });
    const dev615 = buildTrackSpeedReserveProfile({
      marks: [{ distanceMeters: 1609.34, durationSecs: 375 }],
    });

    const dev655 = buildTrackSpeedReserveProfile({
      marks: [{ distanceMeters: 1609.34, durationSecs: 415 }], // 6:55 mile -> VDOT_aer < 45
    });

    const elitePlan = generatePeriodizedTrackPlan({
      startDateIso: '2026-03-02',
      blockWeeks: 12,
      eventGroup: '1500_MILE',
      dateProfile: elite405,
    });
    const clubPlan = generatePeriodizedTrackPlan({
      startDateIso: '2026-03-02',
      blockWeeks: 12,
      eventGroup: '1500_MILE',
      dateProfile: club515,
    });
    const dev3kPlan615 = generatePeriodizedTrackPlan({
      startDateIso: '2026-03-02',
      blockWeeks: 12,
      eventGroup: '3000_3200M',
      dateProfile: dev615,
      startingPhase: 'SPECIFIC',
    });
    const dev3kPlan655 = generatePeriodizedTrackPlan({
      startDateIso: '2026-03-02',
      blockWeeks: 12,
      eventGroup: '3000_3200M',
      dateProfile: dev655,
      startingPhase: 'SPECIFIC',
    });

    const eliteSpecWk = elitePlan.weeks.find((w) => w.phaseKey === 'SPECIFIC')!;
    const clubSpecWk = clubPlan.weeks.find((w) => w.phaseKey === 'SPECIFIC')!;
    const eliteQ1 = eliteSpecWk.sessions[0].trackSpec!;
    const clubQ1 = clubSpecWk.sessions[0].trackSpec!;

    expect(eliteQ1.targetSplitSecs).toBeGreaterThan(58.5);
    expect(eliteQ1.targetSplitSecs).toBeLessThan(62.5);
    expect(clubQ1.targetSplitSecs).toBeGreaterThan(75);
    expect(clubQ1.targetSplitSecs).toBeLessThan(84);

    // Tier 3-4 duration guards: 6:15 miler (VDOT_aer ~45) steps 1000m -> 800m; 6:55 miler (VDOT_aer < 45) steps -> 600m
    const vo2Session615 = dev3kPlan615.weeks[0].sessions.find(
      (s) => s.trackSpec?.zoneCode === 'I'
    )!;
    const vo2Session655 = dev3kPlan655.weeks[0].sessions.find(
      (s) => s.trackSpec?.zoneCode === 'I'
    )!;
    expect(vo2Session615.trackSpec?.repDistanceMeters).toBe(800);
    expect(vo2Session615.trackSpec?.targetSplitSecs).toBeLessThan(260);
    expect(vo2Session655.trackSpec?.repDistanceMeters).toBe(600);
    expect(vo2Session655.trackSpec?.targetSplitSecs).toBeLessThan(230);
  });

  it('branches prescription structure cleanly between ENDURANCE and SPEED ASR phenotypes at identical 4:05 Mile PR', () => {
    const endurance405 = buildTrackSpeedReserveProfile({
      marks: [
        { distanceMeters: 1609.34, durationSecs: 245 },
        { distanceMeters: 5000, durationSecs: 815 },
      ],
    });
    const speed405 = buildTrackSpeedReserveProfile({
      marks: [
        { distanceMeters: 800, durationSecs: 107.5 },
        { distanceMeters: 1609.34, durationSecs: 245 },
        { distanceMeters: 3000, durationSecs: 512 },
      ],
    });

    const planEnd = generatePeriodizedTrackPlan({
      startDateIso: '2026-03-02',
      blockWeeks: 16,
      eventGroup: '1500_MILE',
      dateProfile: endurance405,
    });
    const planSpd = generatePeriodizedTrackPlan({
      startDateIso: '2026-03-02',
      blockWeeks: 16,
      eventGroup: '1500_MILE',
      dateProfile: speed405,
    });

    // Base Q1: Endurance uses 1000m Sub-T cruises; Speed uses fractional 800m Sub-T
    expect(planEnd.weeks[0].sessions[0].trackSpec?.repDistanceMeters).toBe(1000);
    expect(planSpd.weeks[0].sessions[0].trackSpec?.repDistanceMeters).toBe(800);

    // Specific Q2: Endurance drives VO2max (I); Speed preserves aerobic base (SUB_T)
    const endSpecQ2 = planEnd.weeks.find((w) => w.phaseKey === 'SPECIFIC')!.sessions[2];
    const spdSpecQ2 = planSpd.weeks.find((w) => w.phaseKey === 'SPECIFIC')!.sessions[2];
    expect(endSpecQ2.trackSpec?.zoneCode).toBe('I');
    expect(spdSpecQ2.trackSpec?.zoneCode).toBe('SUB_T');
  });

  it('enforces single-session and weekly safety volume caps across all 4 events x all 16 weeks and emits valid Main Set Nx syntax', () => {
    const varsity = buildTrackSpeedReserveProfile({
      marks: [{ distanceMeters: 1609.34, durationSecs: 275 }],
    });

    for (const eventGroup of ['800M', '1500_MILE', '3000_3200M', '5000M'] as const) {
      const plan = generatePeriodizedTrackPlan({
        startDateIso: '2026-02-02',
        blockWeeks: 16,
        eventGroup,
        dateProfile: varsity,
      });

      expect(plan.weeks).toHaveLength(16);
      for (const wk of plan.weeks) {
        const weeklyMeters = wk.targetDistanceKm * 1000;
        let comboHighIntensityMeters = 0;

        for (const sess of wk.sessions) {
          expect(sess.workoutSyntax).toBeTruthy();
          if (sess.trackSpec) {
            expect(sess.workoutSyntax).toContain(`Main Set ${sess.trackSpec.repCount}x`);
            const sessionMeters =
              sess.trackSpec.repCount * sess.trackSpec.repDistanceMeters;

            if (sess.trackSpec.zoneCode === 'FR') {
              expect(sessionMeters).toBeLessThanOrEqual(2400);
            }
            if (sess.trackSpec.zoneCode === 'R') {
              expect(sessionMeters).toBeLessThanOrEqual(4800);
            }
            if (sess.trackSpec.zoneCode === 'I') {
              expect(sessionMeters).toBeLessThanOrEqual(6000);
            }
            if (['CV', 'I', 'R', 'FR'].includes(sess.trackSpec.zoneCode)) {
              comboHighIntensityMeters += sessionMeters;
            }
          }
        }
        // Combined CV + I + R + FR stays under 15% + small rounding floor for short taper weeks
        expect(comboHighIntensityMeters).toBeLessThanOrEqual(
          Math.max(2400, Math.round(weeklyMeters * 0.16))
        );
      }
    }
  });
});
