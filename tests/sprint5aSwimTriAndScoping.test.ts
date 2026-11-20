import { describe, expect, it } from 'vitest';
import {
  buildSwimClipboardWorkout,
  buildSwimPaceZones,
  buildTriBrickClipboardWorkout,
  DEFAULT_SWIM_CSS_SECS_PER_100M,
  deriveSwimCssFromActivities,
  formatSwimDistance,
  formatSwimPacePer100,
  parseSwimClockInput,
} from '../src/physiology/swimZones';
import {
  ENDURANCE_PLAN_ARCHETYPES,
  generateEnduranceTrainingPlan,
} from '../src/physiology/cyclingPrescriptionEngine';
import { computeAnnualMileageSummary, formatGoalMetricValue } from '../src/utils/formatters';
import { sanitizePersistedAnnualGoals } from '../src/utils/lazyWithRetry';
import {
  buildCompleteAthleteProfile,
  inferPrimarySportFromActivities,
} from '../src/utils/telemetryStorage';
import { resolveWorkspaceSportAndRoleScope } from '../src/utils/workspaceScope';
import { INITIAL_ANNUAL_MILEAGE_GOALS } from '../src/data/mockTelemetry';
import type {
  TeamOrgType,
  TeamSummaryWithRole,
  UnifiedActivity,
} from '../src/types';

function makeActivity(overrides: Partial<UnifiedActivity>): UnifiedActivity {
  return {
    id: overrides.id || 'act-1',
    startDateLocal: overrides.startDateLocal || '2026-06-15T07:00:00',
    name: overrides.name || 'Training Session',
    sportCategory: overrides.sportCategory || 'Running',
    environment: overrides.environment || 'OUTDOOR',
    subType: overrides.subType || 'Road',
    movingTimeSecs: overrides.movingTimeSecs ?? 2400,
    distanceMeters: overrides.distanceMeters ?? 8000,
    elevationGainMeters: overrides.elevationGainMeters ?? 20,
    trainingLoad: overrides.trainingLoad ?? 55,
    avgHr: overrides.avgHr ?? 148,
    maxHr: overrides.maxHr ?? 172,
    aerobicDecouplingPct: overrides.aerobicDecouplingPct ?? 2.1,
    efficiencyFactor: overrides.efficiencyFactor ?? 1.5,
    firstHalfEf: overrides.firstHalfEf ?? 1.52,
    secondHalfEf: overrides.secondHalfEf ?? 1.48,
    zoneSecs: overrides.zoneSecs ?? { hr: [400, 1200, 600, 200, 0] },
    stravaPrCount: 0,
    segmentEfforts: [],
    sourceBadges: ['Garmin'],
  };
}

function makeTeam(
  orgType: TeamOrgType,
  primarySport: 'Running' | 'Cycling' | 'Swimming' | 'Triathlon' | 'Hybrid'
): TeamSummaryWithRole {
  return {
    brand: {
      teamId: `team-${orgType.toLowerCase()}`,
      slug: `team-${orgType.toLowerCase()}`,
      joinCode: 'TEST-26',
      name: `Test ${orgType}`,
      shortName: 'TEST',
      orgType,
      primarySport,
      primaryHex: '#14532D',
      secondaryHex: '#D97706',
      defaultSafeSportShield: orgType === 'HIGH_SCHOOL',
      enableParentGuardianCc: orgType === 'HIGH_SCHOOL',
      coachDisplayName: 'Coach Test',
      createdAt: '2026-01-01T00:00:00Z',
    },
    myRole: 'HEAD_COACH',
    mySquadGroup: 'Varsity',
    myMembershipId: 'mem-coach',
    totalInvited: 1,
    openedCount: 1,
    activeCount: 1,
    watchConnectedCount: 1,
    memberships: [],
    broadcastWorkouts: [],
  };
}

describe('Sprint 5A: Swimming & Triathlon Parity + Clean Sport/Role Scoping', () => {
  it('computes 5 CSS swim zones, derives CSS from swim logs, and formats m vs yd cleanly', () => {
    const zones = buildSwimPaceZones(110);
    expect(zones).toHaveLength(5);
    expect(zones[2]?.code).toBe('Z3');
    expect(zones[2]?.minPaceSecsPer100m).toBeLessThanOrEqual(zones[2]?.maxPaceSecsPer100m);

    expect(formatSwimPacePer100(110, 'km')).toBe('1:50 /100m');
    expect(formatSwimPacePer100(110, 'mi')).toBe('1:41 /100yd');
    expect(parseSwimClockInput('1:50', 'km')).toBe(110);
    expect(parseSwimClockInput('1:41', 'mi')).toBe(110);
    expect(parseSwimClockInput('bad', 'km')).toBeNull();

    expect(formatSwimDistance(2500, 'km')).toBe('2,500 m');
    expect(formatSwimDistance(1829, 'mi')).toBe('2,000 yd');
    expect(formatGoalMetricValue(105, 's/100m', 'km')).toBe('1:45 /100m');

    const derived = deriveSwimCssFromActivities([
      makeActivity({
        id: 'swim-tt-1500',
        sportCategory: 'Swimming',
        environment: 'INDOOR',
        subType: 'Pool',
        distanceMeters: 1500,
        movingTimeSecs: 1620,
      }),
    ]);
    expect(derived).toBe(105);
  });

  it('infers Swimming & Triathlon primarySport, computes Swimming annual YTD, and preserves persisted Swimming goals', () => {
    const swimActs = [
      makeActivity({ id: 'sw-1', sportCategory: 'Swimming', environment: 'INDOOR', distanceMeters: 2400, movingTimeSecs: 2700 }),
      makeActivity({ id: 'sw-2', sportCategory: 'Swimming', environment: 'INDOOR', distanceMeters: 3000, movingTimeSecs: 3300 }),
      makeActivity({ id: 'ru-1', sportCategory: 'Running', distanceMeters: 6000, movingTimeSecs: 1800 }),
    ];
    expect(inferPrimarySportFromActivities(swimActs)).toBe('Swimming');

    const triActs = [
      makeActivity({ id: 'tri-s', sportCategory: 'Swimming', environment: 'INDOOR', distanceMeters: 1500, movingTimeSecs: 1700 }),
      makeActivity({ id: 'tri-b', sportCategory: 'Cycling', distanceMeters: 40000, movingTimeSecs: 4200 }),
      makeActivity({ id: 'tri-r', sportCategory: 'Running', distanceMeters: 10000, movingTimeSecs: 2600 }),
    ];
    expect(inferPrimarySportFromActivities(triActs)).toBe('Triathlon');

    const derivedProfile = buildCompleteAthleteProfile(
      { primarySport: 'Swimming' },
      undefined,
      swimActs
    );
    expect(derivedProfile.swimCssSecsPer100m).toBe(107);
    expect(derivedProfile.swimZones).toHaveLength(5);

    const customSwimProfile = buildCompleteAthleteProfile(
      { primarySport: 'Swimming', swimCssSecsPer100m: 98, source: 'CUSTOM_OVERRIDE' },
      undefined,
      swimActs
    );
    expect(customSwimProfile.swimCssSecsPer100m).toBe(98);
    expect(customSwimProfile.swimZones).toHaveLength(5);

    const summary = computeAnnualMileageSummary('Swimming', 100_000, swimActs, 'COMBINED', 2026);
    expect(summary.sportCategory).toBe('Swimming');
    expect(summary.combinedTotalMeters).toBe(5400);
    expect(summary.pctOfAnnualTarget).toBe(5.4);

    const cleaned = sanitizePersistedAnnualGoals(
      [
        { sportCategory: 'Running', year: 2026, targetDistanceMeters: 1_500_000 },
        { sportCategory: 'Swimming', year: 2026, targetDistanceMeters: 120_000 },
      ],
      INITIAL_ANNUAL_MILEAGE_GOALS
    );
    expect(cleaned.some((g) => g.sportCategory === 'Swimming' && g.targetDistanceMeters === 120_000)).toBe(true);
  });

  it('generates SWIM_CSS_ENDURANCE, TRI_OLYMPIC, and TRI_70_3 periodized plans while keeping CYCLING=7 and ROAD=6', () => {
    expect(ENDURANCE_PLAN_ARCHETYPES.filter((a) => a.category === 'CYCLING')).toHaveLength(7);
    expect(ENDURANCE_PLAN_ARCHETYPES.filter((a) => a.category === 'ROAD')).toHaveLength(6);
    expect(ENDURANCE_PLAN_ARCHETYPES.filter((a) => a.category === 'SWIM_TRI')).toHaveLength(3);

    const profile = buildCompleteAthleteProfile({
      primarySport: 'Triathlon',
      ftp: 280,
      thresholdPaceSecsPerKm: 245,
      swimCssSecsPer100m: 102,
    });

    const swimWeeks = generateEnduranceTrainingPlan({
      archetypeId: 'SWIM_CSS_ENDURANCE',
      startDateIso: '2026-11-23',
      blockWeeks: 8,
      selectedWeekdays: [0, 2, 4, 6],
      longDayOffset: 6,
      currentCtl: 52,
      distanceUnit: 'km',
      athleteProfile: profile,
    });
    expect(swimWeeks).toHaveLength(8);
    const swimPeakTss = Math.max(...swimWeeks.slice(0, -1).map((w) => w.targetTss));
    expect(swimWeeks[swimWeeks.length - 1]!.isTaper).toBe(true);
    expect(swimWeeks[swimWeeks.length - 1]!.targetTss).toBeLessThanOrEqual(swimPeakTss * 0.6);
    for (const wk of swimWeeks) {
      for (const s of wk.sessions) {
        expect(s.sportCategory).toBe('Swimming');
        expect(`${s.name} ${s.workoutSyntax} ${s.description}`).not.toMatch(/%\s*FTP|\bFTP\b/i);
      }
    }

    const olympicWeeks = generateEnduranceTrainingPlan({
      archetypeId: 'TRI_OLYMPIC',
      startDateIso: '2026-11-23',
      blockWeeks: 12,
      selectedWeekdays: [1, 2, 3, 4, 6],
      longDayOffset: 6,
      currentCtl: 62,
      distanceUnit: 'mi',
      athleteProfile: profile,
    });
    expect(olympicWeeks).toHaveLength(12);
    const sportsPresent = new Set(olympicWeeks.flatMap((w) => w.sessions.map((s) => s.sportCategory)));
    expect(sportsPresent.has('Swimming')).toBe(true);
    expect(sportsPresent.has('Cycling')).toBe(true);
    expect(sportsPresent.has('Running')).toBe(true);
    expect(sportsPresent.has('Multisport')).toBe(true);

    const halfImWeeks = generateEnduranceTrainingPlan({
      archetypeId: 'TRI_70_3',
      startDateIso: '2026-11-23',
      blockWeeks: 16,
      selectedWeekdays: [1, 2, 3, 4, 6],
      longDayOffset: 6,
      currentCtl: 68,
      distanceUnit: 'km',
      athleteProfile: profile,
    });
    expect(halfImWeeks).toHaveLength(16);
    expect(halfImWeeks[14]!.isTaper).toBe(true);
    expect(halfImWeeks[15]!.isTaper).toBe(true);
    const peak703Tss = Math.max(...halfImWeeks.slice(0, -2).map((w) => w.targetTss));
    expect(halfImWeeks[15]!.targetTss).toBeLessThanOrEqual(peak703Tss * 0.6);
  });

  it('builds Swim CSS and Triathlon T2 Brick clipboard workouts cleanly', () => {
    const swimBuilt = buildSwimClipboardWorkout({
      sets: [{ repCount: 10, repDistanceMeters: 100, restLabel: '15s rest' }],
      cssSecsPer100m: DEFAULT_SWIM_CSS_SECS_PER_100M,
      distanceUnit: 'km',
    });
    expect(swimBuilt.workoutSyntax).toContain('10x100m @ 1:50 /100m');
    expect(swimBuilt.workoutSyntax).not.toMatch(/FTP/i);

    const brickBuilt = buildTriBrickClipboardWorkout({
      bikeMins: 45,
      runMins: 20,
    });
    expect(brickBuilt.workoutSyntax).toContain('45m 88% FTP');
    expect(brickBuilt.workoutSyntax).toContain('20m 90% Pace');
    expect(brickBuilt.summaryLine).toContain('45m Bike + 20m T2 Brick');
  });

  it('scopes Spiked-Meter, NCAA CARA, Growth-Plate PHV, Relay Optimizer, and Track Group chips cleanly by sport & org role', () => {
    const adultCyclist = resolveWorkspaceSportAndRoleScope({
      athleteProfile: { primarySport: 'Cycling', academicDivision: 'CLUB_OPEN' },
      isMinorU18: false,
    });
    expect(adultCyclist.showSpikedMeter).toBe(false);
    expect(adultCyclist.showNcaaCara).toBe(false);
    expect(adultCyclist.showGrowthPlatePhv).toBe(false);
    expect(adultCyclist.showRelayOptimizer).toBe(false);

    const adultSwimmer = resolveWorkspaceSportAndRoleScope({
      athleteProfile: { primarySport: 'Swimming', academicDivision: 'CLUB_OPEN' },
      isMinorU18: false,
    });
    expect(adultSwimmer.showSpikedMeter).toBe(false);
    expect(adultSwimmer.showNcaaCara).toBe(false);
    expect(adultSwimmer.showGrowthPlatePhv).toBe(false);

    const hsTrackMinor = resolveWorkspaceSportAndRoleScope({
      athleteProfile: { primarySport: 'Running', academicDivision: 'HS_VARSITY' },
      activeTeam: makeTeam('HIGH_SCHOOL', 'Running'),
      isMinorU18: true,
    });
    expect(hsTrackMinor.showSpikedMeter).toBe(true);
    expect(hsTrackMinor.showNcaaCara).toBe(false);
    expect(hsTrackMinor.showGrowthPlatePhv).toBe(true);
    expect(hsTrackMinor.showRelayOptimizer).toBe(true);
    expect(hsTrackMinor.showTrackEventGroupChips('Running')).toBe(true);
    expect(hsTrackMinor.showTrackEventGroupChips('Swimming')).toBe(false);

    const ncaaTrack = resolveWorkspaceSportAndRoleScope({
      athleteProfile: { primarySport: 'Running', academicDivision: 'NCAA_D1' },
      activeTeam: makeTeam('COLLEGIATE', 'Running'),
      isMinorU18: false,
    });
    expect(ncaaTrack.showSpikedMeter).toBe(true);
    expect(ncaaTrack.showNcaaCara).toBe(true);
    expect(ncaaTrack.showGrowthPlatePhv).toBe(false);
    expect(ncaaTrack.showRelayOptimizer).toBe(true);

    const veloClub = resolveWorkspaceSportAndRoleScope({
      athleteProfile: { primarySport: 'Cycling', academicDivision: 'CLUB_OPEN' },
      activeTeam: makeTeam('CYCLING_CLUB', 'Cycling'),
      isMinorU18: false,
    });
    expect(veloClub.showSpikedMeter).toBe(false);
    expect(veloClub.showNcaaCara).toBe(false);
    expect(veloClub.showRelayOptimizer).toBe(false);
    expect(veloClub.showTrackEventGroupChips('Running')).toBe(false);
  });
});
