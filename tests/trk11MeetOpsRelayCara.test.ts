import { describe, expect, it } from 'vitest';
import {
  batchGenerateStopwatchRacePassports,
  buildSquadTopTimesBoard,
  computeMultiEventMeetDayTss,
  convertHandTimeToNfhsFat,
  optimizeTrackRelayLineup,
} from '../src/physiology/trackMeetAndRelayEngine';
import { generateWeeklyTrainingGitDiff } from '../src/physiology/complianceAndGitDiff';
import { summarizeNcaaCaraWeeklyHours } from '../src/physiology/scholasticEngine';
import type {
  OrthopedicLoadSummary,
  PlannedWorkoutEvent,
  UnifiedActivity,
} from '../src/types';

const GREEN_ORTHO: OrthopedicLoadSummary = {
  centralAutonomicLoad7d: 260,
  eccentricImpactLoad7d: 240,
  concentricTorqueLoad7d: 0,
  impactAcwr: 1.02,
  torqueAcwr: 0.9,
  centralAcwr: 1.01,
  riskTier: 'OPTIMAL',
  guardrailHeadline: 'Optimal',
  guardrailRecommendation: 'Clear',
  canMorphTodayRunToBike: false,
  suggestedBikeDurationMins: 50,
  suggestedBikeTss: 42,
  suggestedBikeWorkoutSyntax: '',
  spikedMeters7d: 800,
  superSpikeMeters7d: 0,
  spikedMeters72h: 0,
  spikedMetersWeeklyCap: 2400,
  superSpikeWeeklyCap: 1600,
  spikeRatio72h: 0,
  spikeAcwr: 0.8,
  hoursSinceLastSuperSpike: null,
  trainerOnly48hLockActive: false,
  trainerOnlyLockReason: null,
  spikeGuardrailStatus: 'CLEAR',
};

describe('TRK-11: Meet Micro-Periodization, Relay Optimizer, NFHS/FAT Board & CARA 3.0h Rule', () => {
  it('enforces NCAA Bylaw 17.1.7.1 statutory flat 3.0h Competition Day CARA rule regardless of event count or race duration', () => {
    const makeRun = (
      id: string,
      date: string,
      movingSecs: number,
      isRace = false
    ): UnifiedActivity => ({
      id,
      startDateLocal: `${date}T14:00:00`,
      name: isRace ? '1600m Final' : 'Practice Run',
      sportCategory: 'Running',
      environment: 'OUTDOOR',
      subType: 'Track',
      movingTimeSecs: movingSecs,
      distanceMeters: 4000,
      elevationGainMeters: 0,
      trainingLoad: 55,
      avgHr: 165,
      maxHr: 192,
      aerobicDecouplingPct: 2,
      efficiencyFactor: 1.7,
      firstHalfEf: 1.7,
      secondHalfEf: 1.7,
      zoneSecs: { hr: [0, movingSecs, 0, 0, 0, 0, 0] },
      officialRaceData: isRace
        ? {
            platform: 'Official FAT',
            meetName: 'Conference Dual',
            eventLabel: '1600m',
            eventDistanceMeters: 1600,
            fatTimeSecs: 252,
            displayFatTime: '4:12.00',
            trackType: 'OUTDOOR_400M',
            lapSplitsSecs: [62, 64, 65, 61],
            vdotScore: 68,
            includeWarmupCooldown: false,
          }
        : undefined,
      stravaPrCount: 0,
      segmentEfforts: [],
      sourceBadges: ['Official FAT'],
    });

    // Two normal 2.0h days = 4.0h, plus a Saturday triple-event meet totaling 5.5h raw moving secs -> MUST count flat 3.0h!
    const audit = summarizeNcaaCaraWeeklyHours(
      [
        makeRun('p1', '2026-11-05', 7200, false),
        makeRun('p2', '2026-11-06', 7200, false),
        makeRun('r1', '2026-11-07', 252, true),
        makeRun('r2', '2026-11-07', 19548, true), // 5.4h moving time across prelim/finals/cool-down on same comp day!
      ],
      '2026-11-10'
    );

    expect(audit.competitionDaysCount).toBe(1);
    expect(audit.rolling7dCountableHours).toBe(7.0); // 2.0 + 2.0 + flat 3.0h!
    expect(audit.maxSingleDayHours).toBe(3.0);
    expect(audit.compliant).toBe(true);
  });

  it('compounds multi-event meet day TSS via 1 + 0.14*(k - 1) and deduplicates shared warmup', () => {
    const double = computeMultiEventMeetDayTss([
      { eventLabel: '1600m', distanceMeters: 1600, timeSecs: 255, includeWarmupCooldown: true },
      { eventLabel: '800m', distanceMeters: 800, timeSecs: 118, includeWarmupCooldown: true },
    ]);

    expect(double.eventCount).toBe(2);
    expect(double.netRaceTssSum).toBe(98); // 54 + 44
    expect(double.compoundingMultiplier).toBe(1.14);
    expect(double.sharedWarmupCooldownTss).toBe(32); // Charged once!
    expect(double.totalMeetTss).toBe(Math.round(98 * 1.14) + 32);
  });

  it('solves CS+D\' DMR relay lineup assigning SPEED runner to 400m and ENDURANCE anchor to 1600m with flying handoffs', () => {
    const opt = optimizeTrackRelayLineup({
      relayEvent: 'DMR',
      candidates: [
        {
          id: 'endurance-star',
          name: 'Liam Endurance',
          thresholdPaceSecsPerKm: 185,
          phenotype: 'ENDURANCE',
          dPrimeMeters: 175,
        },
        {
          id: 'speed-sprinter',
          name: 'Devon Speed',
          thresholdPaceSecsPerKm: 205,
          phenotype: 'SPEED',
          dPrimeMeters: 310,
          mssMps: 9.4,
        },
        {
          id: 'half-miler',
          name: 'Marcus 800',
          thresholdPaceSecsPerKm: 194,
          phenotype: 'HYBRID',
          dPrimeMeters: 245,
          mssMps: 8.6,
        },
        {
          id: 'opener-1200',
          name: 'Eli Strength',
          thresholdPaceSecsPerKm: 190,
          phenotype: 'HYBRID',
          dPrimeMeters: 215,
        },
      ],
    });

    expect(opt.legs).toHaveLength(4);
    expect(opt.legs[0].splitContext).toBe('RELAY_LEADOFF');
    expect(opt.legs[1].splitContext).toBe('RELAY_FLYING');
    // 400m leg goes to highest ASR speed runner; 1600m anchor goes to strongest aerobic CS runner!
    expect(opt.legs.find((l) => l.distanceMeters === 400)?.athleteId).toBe('speed-sprinter');
    expect(opt.legs.find((l) => l.distanceMeters === 1600)?.athleteId).toBe('endurance-star');
  });

  it('applies NFHS Hand->FAT ceiling tenth +0.24s/+0.14s rules and separates RELAY_FLYING from Open/Leadoff records', () => {
    const m100 = convertHandTimeToNfhsFat(10.81, 100);
    expect(m100.ceilingTenthSecs).toBe(10.9);
    expect(m100.addendSecs).toBe(0.24);
    expect(m100.fatEquivalentSecs).toBe(11.14);

    const m400 = convertHandTimeToNfhsFat(49.12, 400, 'TIERED_024_014');
    expect(m400.ceilingTenthSecs).toBe(49.2);
    expect(m400.addendSecs).toBe(0.14);
    expect(m400.fatEquivalentSecs).toBe(49.34);

    const exactZero = convertHandTimeToNfhsFat(49.0, 400, 'TIERED_024_014');
    expect(exactZero.ceilingTenthSecs).toBe(49.0);
    expect(exactZero.fatEquivalentSecs).toBe(49.14);

    const board = buildSquadTopTimesBoard([
      {
        id: 'open-1',
        athleteId: 'a1',
        athleteName: 'Open FAT',
        eventLabel: '400m',
        distanceMeters: 400,
        rawTimeSecs: 49.45,
        dateIso: '2026-10-20',
        meetName: 'Invite',
        timingMethod: 'FAT',
        splitContext: 'OPEN_FAT',
      },
      {
        id: 'fly-1',
        athleteId: 'a1',
        athleteName: 'Flying Split',
        eventLabel: '400m',
        distanceMeters: 400,
        rawTimeSecs: 48.15,
        dateIso: '2026-10-20',
        meetName: 'Invite',
        timingMethod: 'FAT',
        splitContext: 'RELAY_FLYING',
      },
    ]);

    expect(board.openAndLeadoffMarks).toHaveLength(1);
    expect(board.openAndLeadoffMarks[0].normalizedFatSecs).toBe(49.45);
    expect(board.flyingRelaySplits).toHaveLength(1);
    expect(board.flyingRelaySplits[0].normalizedFatSecs).toBe(48.15);
  });

  it('auto-morphs Tue Dual + Sat Invitational week and batch-mints THV-... Verified Passports', () => {
    const plannedEvents: PlannedWorkoutEvent[] = [
      {
        id: 'mon',
        date: '2026-11-09',
        name: 'Easy Aerobic Run',
        sportCategory: 'Running',
        environmentPreference: 'OUTDOOR',
        description: '',
        plannedLoad: 48,
        plannedDurationSecs: 2700,
        targetZoneSummary: 'Z2',
      },
      {
        id: 'tue',
        date: '2026-11-10',
        name: 'League Dual Meet #3',
        meetPriorityTier: 'DUAL_TRAINING_THROUGH',
        sportCategory: 'Running',
        environmentPreference: 'OUTDOOR',
        description: '',
        plannedLoad: 78,
        plannedDurationSecs: 3000,
        targetZoneSummary: 'Race',
      },
      {
        id: 'thu',
        date: '2026-11-12',
        name: 'VO2max 6x800m Track Session',
        sportCategory: 'Running',
        environmentPreference: 'OUTDOOR',
        description: '',
        plannedLoad: 88,
        plannedDurationSecs: 3600,
        targetZoneSummary: 'Z5',
      },
      {
        id: 'sat',
        date: '2026-11-14',
        name: 'Stanford Invitational 1600m',
        meetPriorityTier: 'INVITATIONAL_B',
        sportCategory: 'Running',
        environmentPreference: 'OUTDOOR',
        description: '',
        plannedLoad: 92,
        plannedDurationSecs: 3000,
        targetZoneSummary: 'B-Race',
      },
    ];

    const diff = generateWeeklyTrainingGitDiff({
      plannedEvents,
      orthopedicSummary: GREEN_ORTHO,
      todayIso: '2026-11-09',
    });

    expect(diff.triggerReason).toContain('Tue Dual + Weekend Invitational');
    const thuDiff = diff.dayChanges.find((d) => d.date === '2026-11-12');
    expect(thuDiff?.changeType).toBe('MODIFIED');
    expect(thuDiff?.proposedTss).toBeLessThan(88);

    const passports = batchGenerateStopwatchRacePassports({
      sessionTitle: 'Friday Twilight 1600m',
      eventLabel: '1600m',
      eventDistanceMeters: 1600,
      isHandTimed: true,
      finishers: [
        {
          runnerName: 'Jordan Reyes',
          netTotalSecs: 256.32, // ceiling 256.4 + 0.14 = 256.54
          lapSplitsSecs: [62.5, 64.8, 65.2, 63.82],
        },
      ],
    });

    expect(passports).toHaveLength(1);
    expect(passports[0].verificationHash).toMatch(/^THV-[A-F0-9]{4}-[A-F0-9]{4}$/);
    expect(passports[0].officialChipOrFatSecs).toBe(256.54);
  });
});
