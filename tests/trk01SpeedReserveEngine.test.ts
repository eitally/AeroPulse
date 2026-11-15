import { describe, expect, it } from 'vitest';
import {
  blendTrackZonesForWeek,
  buildTrackSpeedReserveProfile,
  solveCriticalSpeedAndDPrimeOls,
  solveShortSubThresholdPaceSecsPerKm,
} from '../src/physiology/trackSpeedReserveEngine';
import {
  computeCriticalSpeedAndDPrime,
  deriveThresholdPaceSecsPerKmFromVdot,
} from '../src/utils/officialRaceSynthesizer';
import { calibrateThresholdsFromSeedMark } from '../src/physiology/teamOnboardingEngine';

describe('TRK-01: 2-Parameter Speed-Reserve (CS + D\' & ASR) + 7-Zone Track Pace Engine', () => {
  it('distinguishes Tier 1A (4:05 Endurance Miler) vs Tier 1B (4:05 Speed Miler) across aerobic zones while converging on 400m @ R (~60.5s)', () => {
    const tier1AEndurance = buildTrackSpeedReserveProfile({
      marks: [
        { distanceMeters: 1609.34, durationSecs: 245, eventLabel: '1 Mile' },
        { distanceMeters: 3000, durationSecs: 475, eventLabel: '3000m' },
        { distanceMeters: 5000, durationSecs: 815, eventLabel: '5000m' },
      ],
    });

    const tier1BSpeed = buildTrackSpeedReserveProfile({
      marks: [
        { distanceMeters: 800, durationSecs: 107.5, eventLabel: '800m' },
        { distanceMeters: 1609.34, durationSecs: 245, eventLabel: '1 Mile' },
        { distanceMeters: 3000, durationSecs: 512, eventLabel: '3000m' },
      ],
    });

    expect(tier1AEndurance.modelSource).toBe('MULTI_MARK_CS_DPRIME');
    expect(tier1BSpeed.modelSource).toBe('MULTI_MARK_CS_DPRIME');
    expect(tier1AEndurance.phenotype).toBe('ENDURANCE');
    expect(tier1BSpeed.phenotype).toBe('SPEED');

    // Endurance miler has substantially higher CS / VDOT_aer and smaller D'
    expect(tier1AEndurance.csMps).toBeGreaterThan(tier1BSpeed.csMps + 0.3);
    expect(tier1BSpeed.dPrimeMeters).toBeGreaterThan(tier1AEndurance.dPrimeMeters + 50);
    expect(tier1AEndurance.vdotAer).toBeGreaterThan(tier1BSpeed.vdotAer + 4);

    // Both prescribe ~60.5–62.3s / 400m for R (un-clamped below 157 s/km!)
    expect(tier1AEndurance.zones.R.paceSecsPerKm).toBeLessThan(157);
    expect(tier1AEndurance.zones.R.splitsSecs.m400).toBeGreaterThan(58.5);
    expect(tier1AEndurance.zones.R.splitsSecs.m400).toBeLessThan(62.5);
    expect(tier1BSpeed.zones.R.splitsSecs.m400).toBeGreaterThan(58.5);
    expect(tier1BSpeed.zones.R.splitsSecs.m400).toBeLessThan(62.5);

    // Yet Sub-T / T / I diverge markedly so the Speed miler does not overcook aerobic workouts
    expect(tier1BSpeed.zones.SUB_T.paceSecsPerKm).toBeGreaterThan(
      tier1AEndurance.zones.SUB_T.paceSecsPerKm + 10
    );
    expect(tier1BSpeed.zones.I.splitsSecs.m400).toBeGreaterThan(
      tier1AEndurance.zones.I.splitsSecs.m400 + 3.5
    );

    // Fast Rep (FR) 200m split must be truly un-clamped (< 28.5s / 200m, i.e., < 142.5 s/km)
    expect(tier1BSpeed.zones.FR.paceSecsPerKm).toBeLessThan(140);
    expect(tier1BSpeed.zones.FR.splitsSecs.m200).toBeLessThan(28.0);
  });

  it('produces monotonically faster splits across all 7 zones (E -> FR) for Tiers 2, 3, and 4', () => {
    const tier2Hs = buildTrackSpeedReserveProfile({
      marks: [{ distanceMeters: 1609.34, durationSecs: 275 }], // 4:35 Mile
    });
    const tier3Club = buildTrackSpeedReserveProfile({
      marks: [{ distanceMeters: 1609.34, durationSecs: 315 }], // 5:15 Mile
    });
    const tier4Dev = buildTrackSpeedReserveProfile({
      marks: [{ distanceMeters: 1609.34, durationSecs: 375 }], // 6:15 Mile
    });

    for (const prof of [tier2Hs, tier3Club, tier4Dev]) {
      expect(prof.zones.E.paceSecsPerKm).toBeGreaterThan(prof.zones.SUB_T.paceSecsPerKm);
      expect(prof.zones.SUB_T.paceSecsPerKm).toBeGreaterThan(prof.zones.T.paceSecsPerKm);
      expect(prof.zones.T.paceSecsPerKm).toBeGreaterThan(prof.zones.CV.paceSecsPerKm);
      expect(prof.zones.CV.paceSecsPerKm).toBeGreaterThan(prof.zones.I.paceSecsPerKm);
      expect(prof.zones.I.paceSecsPerKm).toBeGreaterThan(prof.zones.R.paceSecsPerKm);
      expect(prof.zones.R.paceSecsPerKm).toBeGreaterThan(prof.zones.FR.paceSecsPerKm);
    }

    // Tier ordering on 400m @ R: ~68s, ~78s, ~93s
    expect(tier2Hs.zones.R.splitsSecs.m400).toBeLessThan(72);
    expect(tier3Club.zones.R.splitsSecs.m400).toBeGreaterThan(74);
    expect(tier3Club.zones.R.splitsSecs.m400).toBeLessThan(83);
    expect(tier4Dev.zones.R.splitsSecs.m400).toBeGreaterThan(88);

    // Broken 400m Sub-T is slightly crisper than 1000m+ Sub-T
    const shortSubT = solveShortSubThresholdPaceSecsPerKm(tier2Hs);
    expect(shortSubT).toBeLessThan(tier2Hs.zones.SUB_T.paceSecsPerKm);
    expect(shortSubT).toBeGreaterThan(tier2Hs.zones.CV.paceSecsPerKm - 5);
  });

  it('applies single-mark anaerobic deflation for 800m and 1600m seed marks and un-clamps legacy wrappers', () => {
    const solo800 = buildTrackSpeedReserveProfile({
      marks: [{ distanceMeters: 800, durationSecs: 120 }], // 2:00 800m
    });
    expect(solo800.modelSource).toBe('SINGLE_MARK_SCALED');
    expect(solo800.vdotAer).toBeLessThan(solo800.vdotRawBest);
    expect(solo800.vdotAer).toBeCloseTo(solo800.vdotRawBest * 0.945, 0);

    // Un-clamped elite onboarding seed (4:05 Mile -> T ~188 s/km; 3:52 Mile -> T < 176 s/km)
    const quick = calibrateThresholdsFromSeedMark('4:05 Mile', 'Running', 'mi');
    expect(quick.vdotEstimate).toBeGreaterThan(70);
    expect(quick.thresholdPaceSecsPerKm).toBeLessThan(192);
    const sub4Quick = calibrateThresholdsFromSeedMark('3:52 Mile', 'Running', 'mi');
    expect(sub4Quick.thresholdPaceSecsPerKm).toBeLessThan(180);

    // Multi-mark OLS deduplicates duplicate distances and beats old [3.2, 6.4] / [165, 390] clamps
    const fastThresh = deriveThresholdPaceSecsPerKmFromVdot(88);
    expect(fastThresh).toBeLessThan(165);
    const ols = solveCriticalSpeedAndDPrimeOls([
      { distanceMeters: 1600, durationSecs: 252 },
      { distanceMeters: 1609.34, durationSecs: 245 }, // duplicate ~1600m bucket, keeps faster
      { distanceMeters: 5000, durationSecs: 825 },
    ]);
    expect(ols).not.toBeNull();
    expect(ols!.csMps).toBeGreaterThan(5.6);

    const raceBridge = computeCriticalSpeedAndDPrime([
      { distanceMeters: 1609.34, timeSecs: 245 },
      { distanceMeters: 5000, timeSecs: 825 },
    ]);
    expect(raceBridge.phenotype).toBe('ENDURANCE');
    expect(raceBridge.vdotAer).toBeGreaterThan(70);
    expect(raceBridge.asrMps).toBeGreaterThan(1.5);
  });

  it('keeps aerobic/threshold zones strictly at Date Pace (w_aer = 0) across 16 weeks while capping ambitious Goal Pace blending', () => {
    const dateProfile = buildTrackSpeedReserveProfile({
      marks: [{ distanceMeters: 1609.34, durationSecs: 315 }], // 5:15 current miler
    });

    // Ambitious 4:35 goal (-12.7%, well beyond +deltaMax)
    const week2Base = blendTrackZonesForWeek({
      dateProfile,
      targetEvent: '1500_MILE',
      goalTimeSecs: 275,
      weekNum: 2,
      totalWeeks: 16,
      phase: 'BASE',
    });

    const week11Specific = blendTrackZonesForWeek({
      dateProfile,
      targetEvent: '1500_MILE',
      goalTimeSecs: 275,
      weekNum: 11,
      totalWeeks: 16,
      phase: 'SPECIFIC',
    });

    const week16Peak = blendTrackZonesForWeek({
      dateProfile,
      targetEvent: '1500_MILE',
      goalTimeSecs: 275,
      weekNum: 16,
      totalWeeks: 16,
      phase: 'PEAK_TAPER',
    });

    for (const wk of [week2Base, week11Specific, week16Peak]) {
      expect(wk.ambitiousGoalWarning).toBe(true);
      expect(wk.appliedWeights.wAer).toBe(0);
      expect(wk.zones.E.paceSecsPerKm).toBe(dateProfile.zones.E.paceSecsPerKm);
      expect(wk.zones.SUB_T.paceSecsPerKm).toBe(dateProfile.zones.SUB_T.paceSecsPerKm);
      expect(wk.zones.T.paceSecsPerKm).toBe(dateProfile.zones.T.paceSecsPerKm);
      expect(wk.zones.CV.paceSecsPerKm).toBe(dateProfile.zones.CV.paceSecsPerKm);
    }

    // In Base, R stays on Date Pace; by Specific/Peak, R sharpens smoothly without exceeding deltaMax
    expect(week2Base.zones.R.paceSecsPerKm).toBe(dateProfile.zones.R.paceSecsPerKm);
    expect(week11Specific.zones.R.paceSecsPerKm).toBeLessThan(dateProfile.zones.R.paceSecsPerKm);
    expect(week16Peak.zones.R.paceSecsPerKm).toBeLessThanOrEqual(
      week11Specific.zones.R.paceSecsPerKm
    );
    // Capped at <= +deltaMax (~3.3-3.7% for VDOT ~55) rather than jumping all the way to 4:35!
    expect(week16Peak.zones.R.splitsSecs.m400).toBeGreaterThan(73.5);
  });
});
