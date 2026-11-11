import { describe, expect, it } from 'vitest';
import {
  autoDetectUnstructuredIntervals,
  computeCrossTrainingEquivalence,
  computeTeamVdotPacingPods,
  convertNcaaTrackPerformance,
  evaluateRecruitingStandards,
  evaluateStudentAthleteGuardrail,
  formatPrintablePodSplitSheet,
  summarizeNcaaCaraWeeklyHours,
} from '../src/physiology/scholasticEngine';
import type { ActivityStreamSet, UnifiedActivity } from '../src/types';

describe('THRESH v2.3 — High School & Collegiate Team Pack', () => {
  it('clusters a mixed-ability roster into VDOT Pacing Pods with accurate 200m-1600m splits', () => {
    const pods = computeTeamVdotPacingPods({
      roster: [
        { id: 'a1', name: 'Varsity #1', thresholdPaceSecsPerKm: 196, vdotOverride: 66.0 },
        { id: 'a2', name: 'Varsity #2', thresholdPaceSecsPerKm: 199, vdotOverride: 64.5 },
        { id: 'a3', name: 'Varsity #5', thresholdPaceSecsPerKm: 215, vdotOverride: 59.0 },
        { id: 'a4', name: 'JV #1', thresholdPaceSecsPerKm: 235, vdotOverride: 53.5 },
        { id: 'a5', name: 'Frosh #1', thresholdPaceSecsPerKm: 260, vdotOverride: 47.5 },
      ],
      intensity: 'THRESHOLD_CV',
      repCount: 6,
      repDistanceMeters: 1000,
      recoveryLabel: '60s jog',
    });

    expect(pods.length).toBeGreaterThanOrEqual(3);
    // Pod A holds the two closely matched Varsity leaders (66.0 & 64.5 within <= 3.0 VDOT)
    expect(pods[0].athletes.map((a) => a.id)).toEqual(['a1', 'a2']);
    // Faster pods have strictly faster 400m & 1000m splits than developmental pods
    expect(pods[0].splitsSecs.split400m).toBeLessThan(pods[1].splitsSecs.split400m);
    expect(pods[1].splitsSecs.split1000m).toBeLessThan(pods[2].splitsSecs.split1000m);

    const sheet = formatPrintablePodSplitSheet('6x1000m CV', '2026-11-11', pods);
    expect(sheet).toContain('THRESH TRACKSIDE POD SHEET');
    expect(sheet).toContain('Varsity #1');
    expect(sheet).toContain('Frosh #1');
  });

  it('applies official NCAA Indoor 200m Flat -> Banked/Outdoor & Altitude conversions', () => {
    const mileAtAltitudeFlat = convertNcaaTrackPerformance({
      eventLabel: 'Mile',
      gender: 'MEN',
      rawTimeSecs: 245.0, // 4:05.00 on a 200m flat track at 5,280 ft
      fromFacility: 'INDOOR_FLAT_200M',
      toFacility: 'OUTDOOR_400M',
      altitudeFeet: 5280,
    });

    expect(mileAtAltitudeFlat.facilityMultiplier).toBeLessThan(1.0);
    expect(mileAtAltitudeFlat.altitudeAllowanceSecs).toBeGreaterThan(2.5);
    expect(mileAtAltitudeFlat.convertedTimeSecs).toBeLessThan(240.0); // Sub-4:00 equivalent!

    const outdoorToFlat = convertNcaaTrackPerformance({
      eventLabel: '800m',
      gender: 'WOMEN',
      rawTimeSecs: 130.0,
      fromFacility: 'OUTDOOR_400M',
      toFacility: 'INDOOR_FLAT_200M',
      altitudeFeet: 0,
    });
    expect(outdoorToFlat.facilityMultiplier).toBeGreaterThan(1.0);
    expect(outdoorToFlat.convertedTimeSecs).toBeGreaterThan(130.0);
  });

  it('evaluates HS State, HS Nationals, and NCAA D1/D2/D3 Recruiting Standards accurately', () => {
    const standards = evaluateRecruitingStandards({
      eventLabel: '1600m',
      gender: 'MEN',
      convertedTimeSecs: 246.5, // 4:06.50
    });

    const byTier = Object.fromEntries(standards.map((s) => [s.tierId, s]));
    expect(byTier.HS_STATE.achieved).toBe(true);
    expect(byTier.NCAA_D3_RECRUIT.achieved).toBe(true);
    expect(byTier.NCAA_D2_SCHOLARSHIP.achieved).toBe(true);
    expect(byTier.HS_NATIONALS.achieved).toBe(true);
    expect(byTier.NCAA_D1_WALK_ON.achieved).toBe(true);
    expect(byTier.NCAA_D1_SCHOLARSHIP.achieved).toBe(false);
    expect(byTier.NCAA_D1_SCHOLARSHIP.gapSecs).toBeCloseTo(5.0, 1);
  });

  it('triggers Bone-Stress Stop, Iron Depletion Caution, and Exam Stress Modulation guardrails', () => {
    const bsiStop = evaluateStudentAthleteGuardrail({
      date: '2026-11-10',
      academicStress: 2,
      shinMetatarsalSoreness: 2, // Focal shin tenderness!
      achillesTendonSoreness: 0,
      sleepHours: 8.0,
      ferritinNgMl: 48,
      energyFeel: 'NORMAL',
    });
    expect(bsiStop.status).toBe('BONE_STRESS_STOP');
    expect(bsiStop.intensityScalePct).toBe(0);
    expect(bsiStop.suggestCrossTrainingSwap).toBe(true);

    const lowIron = evaluateStudentAthleteGuardrail({
      date: '2026-11-10',
      academicStress: 2,
      shinMetatarsalSoreness: 0,
      achillesTendonSoreness: 0,
      sleepHours: 8.0,
      ferritinNgMl: 21,
      energyFeel: 'NORMAL',
    });
    expect(lowIron.status).toBe('IRON_DEPLETION_CAUTION');
    expect(lowIron.intensityScalePct).toBeLessThan(90);

    const finalsWeek = evaluateStudentAthleteGuardrail({
      date: '2026-11-10',
      academicStress: 5,
      shinMetatarsalSoreness: 0,
      achillesTendonSoreness: 0,
      sleepHours: 5.7,
      ferritinNgMl: 52,
      energyFeel: 'FLAT',
    });
    expect(finalsWeek.status).toBe('ACADEMIC_MODULATION');
    expect(finalsWeek.intensityScalePct).toBe(84);
  });

  it('computes Cross-Training Virtual Miles and audits NCAA 20-Hour CARA compliance', () => {
    const aqua = computeCrossTrainingEquivalence({
      modality: 'AQUA_JOGGING',
      durationMins: 45,
      rpe: 6,
    });
    expect(aqua.equivalentRunMiles).toBeGreaterThanOrEqual(4.8);
    expect(aqua.equivalentRunMiles).toBeLessThanOrEqual(5.4);
    expect(aqua.impactLoadSavedPct).toBe(100);

    const makeAct = (date: string, hours: number): UnifiedActivity =>
      ({
        id: `act-${date}`,
        startDateLocal: `${date}T15:00:00Z`,
        name: 'Practice',
        sportCategory: 'Running',
        environment: 'OUTDOOR',
        subType: 'Track',
        movingTimeSecs: hours * 3600,
        distanceMeters: 16000,
        elevationGainMeters: 50,
        trainingLoad: 90,
        avgHr: 152,
        maxHr: 178,
        aerobicDecouplingPct: 2.1,
        efficiencyFactor: 1.8,
        firstHalfEf: 1.82,
        secondHalfEf: 1.78,
        zoneSecs: { hr: [0, 3600, 0, 0, 0, 0, 0] },
        stravaPrCount: 0,
        segmentEfforts: [],
        sourceBadges: ['Garmin'],
      }) as UnifiedActivity;

    const compliantAudit = summarizeNcaaCaraWeeklyHours(
      [
        makeAct('2026-11-05', 2.5),
        makeAct('2026-11-06', 2.0),
        makeAct('2026-11-07', 3.0),
        makeAct('2026-11-08', 2.5),
        makeAct('2026-11-09', 3.0),
      ],
      '2026-11-10'
    );
    expect(compliantAudit.compliant).toBe(true);
    expect(compliantAudit.rolling7dCountableHours).toBe(13);

    const overCapAudit = summarizeNcaaCaraWeeklyHours(
      [
        makeAct('2026-11-04', 3.5),
        makeAct('2026-11-05', 3.5),
        makeAct('2026-11-06', 3.5),
        makeAct('2026-11-07', 3.5),
        makeAct('2026-11-08', 3.5),
        makeAct('2026-11-09', 3.5),
      ],
      '2026-11-10'
    );
    expect(overCapAudit.compliant).toBe(false);
    expect(overCapAudit.rolling7dCountableHours).toBe(21);
  });

  it('recovers 6 x 400m unstructured track reps from a 1Hz stream when athlete forgot to press Lap', () => {
    const time: number[] = [];
    const velocitySmooth: number[] = [];
    const distance: number[] = [];
    const heartrate: number[] = [];

    let curT = 0;
    let curDist = 0;
    const pushBlock = (secs: number, speedMps: number, hrBase: number) => {
      for (let i = 0; i < secs; i++) {
        time.push(curT);
        velocitySmooth.push(speedMps);
        curDist += speedMps;
        distance.push(curDist);
        heartrate.push(hrBase + Math.min(18, Math.floor(i / 4)));
        curT++;
      }
    };

    // 4m warmup jog -> 6 x (65s @ 6.15 m/s = 400m + 60s @ 2.5 m/s jog) -> 3m cooldown
    pushBlock(240, 3.1, 132);
    for (let rep = 0; rep < 6; rep++) {
      pushBlock(65, 6.15, 168); // ~400m in 65s
      pushBlock(60, 2.5, 142); // 150m recovery jog
    }
    pushBlock(180, 3.0, 130);

    const streams: ActivityStreamSet = {
      time,
      velocitySmooth,
      distance,
      heartrate,
    };

    const detected = autoDetectUnstructuredIntervals(streams, 'Running');
    const workReps = detected.filter((iv) => iv.type === 'WORK');

    expect(workReps).toHaveLength(6);
    expect(workReps[0].label).toContain('~400m');
    expect(workReps[0].distanceMeters).toBeGreaterThanOrEqual(375);
    expect(workReps[0].distanceMeters).toBeLessThanOrEqual(425);
  });
});
