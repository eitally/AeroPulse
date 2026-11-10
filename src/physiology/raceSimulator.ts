import type {
  AthleteProfile,
  DurabilityAnalysisReport,
  RaceFuelingPlan,
  RaceSimulationReport,
  RaceSimulationSegment,
} from '../types';

export interface RaceSimulatorInput {
  sport: 'Cycling' | 'Running';
  raceName: string;
  distanceKm: number;
  elevationGainMeters: number;
  ambientTempC: number;
  altitudeMeters: number;
  athleteProfile: AthleteProfile;
  durabilityReport?: DurabilityAnalysisReport | null;
}

/**
 * 10x Differentiator #4: Integrated Course Physics, Durability, Weather & Carb/Sodium Race Simulator
 *
 * Computes segment-by-segment power (`W`, `W/kg`) or pace (`s/km`, `GAP`) caps derated by:
 *  - Heat stress above 15°C (Cycling) or 12°C (Running)
 *  - Altitude hypoxia above 1,000m (Bassett & Howley VO2max decay curve)
 *  - Personal `kJ/kg` or `kcal` durability slope across the 5 course segments
 *  - Course elevation grade profile
 * Plus an hourly carbohydrate (`g/hr`), sodium (`mg/hr`), fluid (`mL/hr`), and caffeine schedule.
 */
export function simulateCoursePacingAndFueling(
  input: RaceSimulatorInput
): RaceSimulationReport {
  const {
    sport,
    raceName,
    distanceKm,
    elevationGainMeters,
    ambientTempC,
    altitudeMeters,
    athleteProfile,
    durabilityReport,
  } = input;

  const cleanDistKm = Math.max(1.5, distanceKm);
  const cleanElevM = Math.max(0, elevationGainMeters);
  const weightKg = Math.max(42, athleteProfile.weightKg || 72);
  const ftp = Math.max(140, athleteProfile.ftp || athleteProfile.indoorFtp || 275);
  const thresholdPaceSecsKm = Math.max(
    155,
    athleteProfile.thresholdPaceSecsPerKm || 245
  );

  // 1. Thermal derating above optimal racing temperature (12°C run / 16°C bike)
  const optimalTempC = sport === 'Running' ? 12 : 16;
  const excessTempC = Math.max(0, ambientTempC - optimalTempC);
  const thermalDeratingPct =
    Math.round(Math.min(14, Math.pow(excessTempC, 1.28) * 0.42) * 10) / 10;

  // 2. Altitude hypoxia derating above 900m (~0.65% per 100m above 900m)
  const excessAltM = Math.max(0, altitudeMeters - 900);
  const altitudeDeratingPct =
    Math.round(Math.min(18, (excessAltM / 100) * 0.65) * 10) / 10;

  // 3. Durability slope derating from athlete's 10x #2 profile
  const decayPerBucketPct = durabilityReport?.decaySlopePerUnitPct ?? 2.1;
  const envRetentionFactor =
    (1 - thermalDeratingPct / 100) * (1 - altitudeDeratingPct / 100);

  // Partition course into 5 tactical segments with realistic terrain distribution
  const gradeMultipliers = [0.7, 1.15, 1.35, 1.1, 0.7];
  const segmentLabels = [
    'Seg 1 · Opening Settling & Rhythm',
    'Seg 2 · Early Terrain Build',
    'Seg 3 · Mid-Course Crux & Climb',
    'Seg 4 · Deep-Fatigue Threshold Hold',
    'Seg 5 · Final Kick & Redline Finish',
  ];

  const segDistKm = cleanDistKm / 5;
  const baseGradePct = (cleanElevM / (cleanDistKm * 1000)) * 100;

  // Estimate baseline race intensity factor from event duration
  const estHours =
    sport === 'Cycling'
      ? cleanDistKm / 33 + cleanElevM / 1100
      : (cleanDistKm * thresholdPaceSecsKm) / 3600;
  const baseRaceIf =
    estHours <= 0.45
      ? 1.03
      : estHours <= 1.1
        ? 0.96
        : estHours <= 2.2
          ? 0.88
          : estHours <= 4.0
            ? 0.81
            : 0.74;

  // Compute Fueling Plan (g/hr carbs, mg/hr sodium, mL/hr fluid)
  const rawCarbsPerHr =
    estHours < 0.85
      ? 35
      : estHours < 1.75
        ? 65
        : estHours < 3.0
          ? sport === 'Cycling'
            ? 85
            : 75
          : sport === 'Cycling'
            ? 95
            : 85;
  const carbsGramsPerHour = Math.round(rawCarbsPerHr);
  const glucoseFructoseRatio: RaceFuelingPlan['glucoseFructoseRatio'] =
    carbsGramsPerHour >= 80
      ? '1:0.8 High-Oxidation'
      : carbsGramsPerHour >= 55
        ? '2:1 Dual-Source'
        : 'Single-Source';

  const sweatFactor = Math.max(0, ambientTempC - 10) * 18;
  const sodiumMgPerHour = Math.round(500 + sweatFactor);
  const fluidMlPerHour = Math.round(520 + Math.max(0, ambientTempC - 10) * 22);

  const segments: RaceSimulationSegment[] = [];
  let totalTimeSecs = 0;
  let weightedWattsSum = 0;
  let weightedPaceSum = 0;
  let cumKjPerKg = 0;
  let cumKcal = 0;

  for (let i = 0; i < 5; i++) {
    const startKm = Math.round(i * segDistKm * 10) / 10;
    const endKm = Math.round((i + 1) * segDistKm * 10) / 10;
    const segGradePct = Math.round(baseGradePct * gradeMultipliers[i] * 10) / 10;

    // Durability derating increases progressively in segments 3, 4, 5
    const durabilityPenaltyPct =
      i === 0 ? 0 : i === 1 ? decayPerBucketPct * 0.35 : i === 2 ? decayPerBucketPct * 0.85 : i === 3 ? decayPerBucketPct * 1.45 : decayPerBucketPct * 1.15;
    const segDurabilityFactor = Math.max(0.82, 1 - durabilityPenaltyPct / 100);

    // Pacing discipline multiplier (controlled start in Seg 1, climb bias in Seg 3, final kick in Seg 5)
    const tacticalFactor =
      i === 0 ? 0.97 : i === 1 ? 1.0 : i === 2 ? 1.02 : i === 3 ? 0.99 : 1.02;

    if (sport === 'Cycling') {
      const targetWatts = Math.round(
        ftp * baseRaceIf * envRetentionFactor * segDurabilityFactor * tacticalFactor
      );
      const targetWkg = Math.round((targetWatts / weightKg) * 100) / 100;

      // Physics-informed cycling speed estimate (aerodynamic + gravity on grade)
      const gradeRad = segGradePct / 100;
      const flatSpeedMps = Math.pow(targetWatts / 0.24, 1 / 3);
      const climbPenaltyMps = gradeRad * 95;
      const speedMps = Math.max(3.4, flatSpeedMps - climbPenaltyMps);
      const segSecs = Math.round((segDistKm * 1000) / speedMps);

      const fatigueLabel = `${Math.round(cumKjPerKg)} kJ/kg`;
      cumKjPerKg += ((targetWatts * segSecs) / 1000) / weightKg;

      const segHours = segSecs / 3600;
      segments.push({
        segmentIndex: i + 1,
        segmentLabel: segmentLabels[i],
        startKm,
        endKm,
        avgGradePct: segGradePct,
        accumulatedFatigueLabel: fatigueLabel,
        targetWatts,
        targetWkg,
        targetPaceSecsPerKm: null,
        targetGapSecsPerKm: null,
        segmentDurationSecs: segSecs,
        carbsGramsTarget: Math.round(carbsGramsPerHour * segHours),
        sodiumMgTarget: Math.round(sodiumMgPerHour * segHours),
        fluidMlTarget: Math.round(fluidMlPerHour * segHours),
        coachingCue:
          i === 0
            ? `Cap surges strictly at ${ Math.round(targetWatts * 1.06) }W for the first 12 minutes to preserve W'.`
            : i === 2
              ? `Crux climb (${segGradePct}% avg): hold ${targetWatts}W (${targetWkg} W/kg) seated at 85+ rpm.`
              : i === 3
                ? `Entering deep work (${fatigueLabel}): take 1 gel + 200mL fluid before kilometer ${startKm}.`
                : `Empty remaining W' tank over the final ${(endKm - startKm).toFixed(1)} km.`,
      });

      totalTimeSecs += segSecs;
      weightedWattsSum += targetWatts * segSecs;
    } else {
      // Running simulation
      const effectiveIf = baseRaceIf * envRetentionFactor * segDurabilityFactor * tacticalFactor;
      const targetGapSecsPerKm = Math.round(thresholdPaceSecsKm / Math.max(0.65, effectiveIf));
      const gradeSlowdownFactor = 1 + Math.max(0, segGradePct) * 0.033;
      const targetPaceSecsPerKm = Math.round(targetGapSecsPerKm * gradeSlowdownFactor);
      const segSecs = Math.round(segDistKm * targetPaceSecsPerKm);

      const fatigueLabel = `${Math.round(cumKcal)} kcal`;
      cumKcal += segDistKm * weightKg * 1.036;

      const segHours = segSecs / 3600;
      segments.push({
        segmentIndex: i + 1,
        segmentLabel: segmentLabels[i],
        startKm,
        endKm,
        avgGradePct: segGradePct,
        accumulatedFatigueLabel: fatigueLabel,
        targetWatts: null,
        targetWkg: null,
        targetPaceSecsPerKm,
        targetGapSecsPerKm,
        segmentDurationSecs: segSecs,
        carbsGramsTarget: Math.round(carbsGramsPerHour * segHours),
        sodiumMgTarget: Math.round(sodiumMgPerHour * segHours),
        fluidMlTarget: Math.round(fluidMlPerHour * segHours),
        coachingCue:
          i === 0
            ? 'Bank zero seconds early — lock onto target GAP rhythm and protect glycogen stores.'
            : i === 2
              ? `Grade rises to ${segGradePct}%: shorten stride, keep cadence >=176 spm, and run by GAP effort.`
              : i === 3
                ? `Passing ${fatigueLabel}: ingest ${Math.max(20, Math.round(carbsGramsPerHour * segHours))}g carbs before neuromuscular fade sets in.`
                : 'Final segment: lift cadence +3 spm and empty remaining D\' reserve to the line.',
      });

      totalTimeSecs += segSecs;
      weightedPaceSum += targetPaceSecsPerKm * segDistKm;
    }
  }

  const totalHours = Math.max(0.25, totalTimeSecs / 3600);
  const durabilityDeratingPct = Math.round(decayPerBucketPct * 1.25 * 10) / 10;

  const fuelingPlan: RaceFuelingPlan = {
    carbsGramsPerHour,
    totalCarbsGrams: Math.round(carbsGramsPerHour * totalHours),
    glucoseFructoseRatio,
    sodiumMgPerHour,
    totalSodiumMg: Math.round(sodiumMgPerHour * totalHours),
    fluidMlPerHour,
    totalFluidMl: Math.round(fluidMlPerHour * totalHours),
    gelEquivalentsCount: Math.max(0, Math.round((carbsGramsPerHour * totalHours) / 25)),
    caffeineMgRecommendation: Math.round(weightKg * (totalHours > 1.5 ? 3.5 : 2.5)),
  };

  const averageTargetWatts =
    sport === 'Cycling' && totalTimeSecs > 0
      ? Math.round(weightedWattsSum / totalTimeSecs)
      : null;

  return {
    sport,
    raceName: raceName || (sport === 'Cycling' ? 'Target Cycling Event' : 'Target Road/Trail Race'),
    distanceKm: cleanDistKm,
    elevationGainMeters: cleanElevM,
    ambientTempC,
    altitudeMeters,
    predictedFinishTimeSecs: totalTimeSecs,
    averageTargetWatts,
    normalizedTargetWatts: averageTargetWatts ? Math.round(averageTargetWatts * 1.04) : null,
    averageTargetPaceSecsPerKm:
      sport === 'Running' ? Math.round(weightedPaceSum / cleanDistKm) : null,
    thermalDeratingPct,
    altitudeDeratingPct,
    durabilityDeratingPct,
    fuelingPlan,
    segments,
  };
}
