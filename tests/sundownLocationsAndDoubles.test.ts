import crypto from 'crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import {
  computeLocalSundownWindow,
  resolveEffectiveThemeState,
} from '../src/utils/sundownThemeEngine';
import {
  formatPracticeTime12h,
  formatSessionLogisticsLine,
  sortPlannedEventsChronologically,
} from '../src/utils/workoutScheduleUtils';
import {
  buildBedtimeReminderIcs,
  isPastReminderTime,
} from '../src/utils/bedtimeReminderEngine';
import { evaluatePlannedVsCompletedCompliance } from '../src/physiology/complianceAndGitDiff';
import {
  computeOvernightRecoveryPrescription,
  evaluateTodayTrainingReceipt,
  evaluateTomorrowLockIn,
} from '../src/physiology/eveningHabitEngine';
import { EveningCloseoutCard } from '../src/components/today/EveningCloseoutCard';
import {
  broadcastWorkoutToTeamSquad,
  createTeamForCoach,
} from '../server/teamService';
import { deleteTenantVault } from '../server/tokenVault';
import type { PlannedWorkoutEvent, UnifiedActivity } from '../src/types';

function makePlanned(overrides: Partial<PlannedWorkoutEvent>): PlannedWorkoutEvent {
  return {
    id: overrides.id || 'plan-1',
    date: overrides.date || '2026-11-18',
    name: overrides.name || 'Session',
    sportCategory: overrides.sportCategory || 'Running',
    environmentPreference: overrides.environmentPreference || 'OUTDOOR',
    description: overrides.description || 'Structured workout',
    plannedLoad: overrides.plannedLoad ?? 60,
    plannedDurationSecs: overrides.plannedDurationSecs ?? 2400,
    targetZoneSummary: overrides.targetZoneSummary || 'Z2-Z4',
    ...overrides,
  };
}

function makeActivity(overrides: Partial<UnifiedActivity>): UnifiedActivity {
  return {
    id: overrides.id || 'act-1',
    startDateLocal: overrides.startDateLocal || '2026-11-18T15:45:00',
    name: overrides.name || 'Run',
    sportCategory: overrides.sportCategory || 'Running',
    environment: overrides.environment || 'OUTDOOR',
    subType: overrides.subType || 'Track',
    movingTimeSecs: overrides.movingTimeSecs ?? 2400,
    distanceMeters: overrides.distanceMeters ?? 8000,
    elevationGainMeters: overrides.elevationGainMeters ?? 20,
    intensityFactor: overrides.intensityFactor ?? 0.85,
    trainingLoad: overrides.trainingLoad ?? 60,
    avgHr: 155,
    maxHr: 175,
    aerobicDecouplingPct: 1.5,
    efficiencyFactor: 1.5,
    firstHalfEf: 1.5,
    secondHalfEf: 1.5,
    zoneSecs: { hr: [300, 1200, 600, 300, 0, 0, 0] },
    stravaPrCount: 0,
    segmentEfforts: [],
    sourceBadges: ['Strava'],
    ...overrides,
  };
}

describe('Sundown P2 Theme, Practice Time & Locations, Doubles, and Bedtime Reminder', () => {
  const createdTeamIds: string[] = [];
  const createdCoachSids: string[] = [];

  afterEach(async () => {
    while (createdTeamIds.length > 0) {
      const id = createdTeamIds.pop();
      if (id) {
        try {
          await deleteTenantVault(`team:${id}`);
        } catch {
          // ignore cleanup miss
        }
      }
    }
    while (createdCoachSids.length > 0) {
      const sid = createdCoachSids.pop();
      if (sid) {
        try {
          await deleteTenantVault(`user_teams:${sid}`);
        } catch {
          // ignore
        }
      }
    }
  });

  it('respects Daylight vs Track Pine in daytime and transitions to P2 Midnight Slate after sundown', () => {
    const noon = new Date(2026, 10, 18, 12, 30, 0);
    const lateEvening = new Date(2026, 10, 18, 21, 15, 0);

    const dayWin = computeLocalSundownWindow(noon, 39);
    const nightWin = computeLocalSundownWindow(lateEvening, 39);
    expect(dayWin.isAfterSundown).toBe(false);
    expect(nightWin.isAfterSundown).toBe(true);

    // Daytime allows either Daylight or Track Pine
    expect(
      resolveEffectiveThemeState({
        daytimePalette: 'DAYLIGHT',
        sundownPolicy: 'AUTO_MIDNIGHT_SLATE',
        isAfterSundown: false,
      })
    ).toEqual({ activeVariant: 'DAYLIGHT', isDark: false });

    expect(
      resolveEffectiveThemeState({
        daytimePalette: 'TRACK_PINE',
        sundownPolicy: 'AUTO_MIDNIGHT_SLATE',
        isAfterSundown: false,
      })
    ).toEqual({ activeVariant: 'TRACK_PINE', isDark: true });

    // After sundown automatically upgrades to P2 Midnight Slate
    expect(
      resolveEffectiveThemeState({
        daytimePalette: 'DAYLIGHT',
        sundownPolicy: 'AUTO_MIDNIGHT_SLATE',
        isAfterSundown: true,
      })
    ).toEqual({ activeVariant: 'MIDNIGHT_SLATE', isDark: true });

    expect(
      resolveEffectiveThemeState({
        daytimePalette: 'TRACK_PINE',
        sundownPolicy: 'AUTO_MIDNIGHT_SLATE',
        isAfterSundown: true,
      })
    ).toEqual({ activeVariant: 'MIDNIGHT_SLATE', isDark: true });

    // User explicit light toggle wins until re-enabled
    expect(
      resolveEffectiveThemeState({
        daytimePalette: 'DAYLIGHT',
        sundownPolicy: 'AUTO_MIDNIGHT_SLATE',
        isAfterSundown: true,
        sessionLightOverride: true,
      })
    ).toEqual({ activeVariant: 'DAYLIGHT', isDark: false });

    // Clean ?demo=1 Playwright boot starts deterministically light when OS is light (including /brand and reload)
    expect(
      resolveEffectiveThemeState({
        daytimePalette: 'DAYLIGHT',
        sundownPolicy: 'AUTO_MIDNIGHT_SLATE',
        isAfterSundown: true,
        isDemoSession: true,
        hasExplicitPolicy: false,
        explicitLegacyDark: null,
        systemPrefersDark: false,
      })
    ).toEqual({ activeVariant: 'DAYLIGHT', isDark: false });

    expect(
      resolveEffectiveThemeState({
        daytimePalette: 'DAYLIGHT',
        sundownPolicy: 'AUTO_MIDNIGHT_SLATE',
        isAfterSundown: true,
        isBrandStudioRoute: true,
        explicitLegacyDark: null,
      })
    ).toEqual({ activeVariant: 'DAYLIGHT', isDark: false });
  });

  it('formats 12h practice time, location lines, and sorts doubles AM before PM', () => {
    expect(formatPracticeTime12h('15:45')).toBe('3:45 PM');
    expect(formatPracticeTime12h('06:30')).toBe('6:30 AM');

    const line = formatSessionLogisticsLine({
      sessionSlot: 'PM',
      scheduledTime: '15:45',
      locationName: 'Foothills XC Park',
    });
    expect(line).toBe('PM · 3:45 PM · Foothills XC Park');

    const pmRun = makePlanned({
      id: 'pm-track',
      date: '2026-11-18',
      name: '6x800m Track',
      sessionSlot: 'PM',
      scheduledTime: '15:45',
    });
    const amGym = makePlanned({
      id: 'am-gym',
      date: '2026-11-18',
      name: 'Morning Weight Room Lift',
      sportCategory: 'Strength',
      sessionSlot: 'AM',
      scheduledTime: '06:45',
    });

    const sorted = sortPlannedEventsChronologically([pmRun, amGym]);
    expect(sorted.map((s) => s.id)).toEqual(['am-gym', 'pm-track']);
  });

  it('preserves AM + PM and Gym + Run doubles with time & XC/Track location in coach broadcasts', async () => {
    const coachSid = `coach_${crypto.randomBytes(6).toString('hex')}`;
    createdCoachSids.push(coachSid);
    const created = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: 'https://thresh.test',
      name: 'Paly XC & Track',
      coachDisplayName: 'Coach Test',
      primarySport: 'Running',
      orgType: 'HIGH_SCHOOL',
    });
    createdTeamIds.push(created.brand.teamId);

    await broadcastWorkoutToTeamSquad({
      callerSid: coachSid,
      teamId: created.brand.teamId,
      originUrl: 'https://thresh.test',
      targetSquadGroup: 'ALL',
      date: '2026-11-19',
      name: 'AM Core & Strength Lift',
      sportCategory: 'Strength',
      plannedDurationSecs: 2400,
      plannedLoad: 42,
      workoutSyntax: 'Warmup\n- 10m 55% Effort Mobility\n\nMain Set\n- 3x 10m 75% Effort Compound Lift',
      description: 'Pre-school lift',
      sessionSlot: 'AM',
      scheduledTime: '06:45',
      locationName: 'Weight Room',
      locationCategory: 'GYM_WEIGHTS',
      replaceSameDateTarget: true,
    });

    const afterDouble = await broadcastWorkoutToTeamSquad({
      callerSid: coachSid,
      teamId: created.brand.teamId,
      originUrl: 'https://thresh.test',
      targetSquadGroup: 'ALL',
      date: '2026-11-19',
      name: 'XC Tempo Hills',
      sportCategory: 'Running',
      plannedDurationSecs: 3600,
      plannedLoad: 78,
      workoutSyntax: 'Warmup\n- 2mi Z1 Warmup\n\nMain Set\n- 4x 5m 95% Pace Hills',
      description: 'Post-school off-campus XC venue session',
      sessionSlot: 'PM',
      scheduledTime: '15:45',
      locationName: 'Foothills XC Park',
      locationCategory: 'XC_COURSE',
      replaceSameDateTarget: true,
    });

    expect(afterDouble?.broadcastWorkouts.length).toBe(2);
    const gym = afterDouble?.broadcastWorkouts.find((w) => w.sportCategory === 'Strength');
    const run = afterDouble?.broadcastWorkouts.find((w) => w.sportCategory === 'Running');
    expect(gym?.scheduledTime).toBe('06:45');
    expect(gym?.locationName).toBe('Weight Room');
    expect(run?.scheduledTime).toBe('15:45');
    expect(run?.locationName).toBe('Foothills XC Park');
    expect(run?.locationCategory).toBe('XC_COURSE');
  });

  it('surfaces double days + practice location across Today Receipt, Tomorrow Lock-In & Compliance', () => {
    const amShakeout = makePlanned({
      id: 'am-run',
      date: '2026-11-18',
      name: 'Morning Shakeout 4mi',
      sportCategory: 'Running',
      sessionSlot: 'AM',
      scheduledTime: '06:30',
      locationName: 'Campus Loop',
      plannedDurationSecs: 1800,
      plannedLoad: 32,
    });
    const pmTrack = makePlanned({
      id: 'pm-track',
      date: '2026-11-18',
      name: '5x1000m @ CV',
      sportCategory: 'Running',
      sessionSlot: 'PM',
      scheduledTime: '15:45',
      locationName: 'School Track',
      plannedDurationSecs: 3600,
      plannedLoad: 84,
    });

    const tomorrowXc = makePlanned({
      id: 'tmw-xc',
      date: '2026-11-19',
      name: 'Woodward Park Tempo',
      sportCategory: 'Running',
      sessionSlot: 'PM',
      scheduledTime: '15:30',
      locationName: 'Woodward Park XC',
      plannedLoad: 80,
    });

    // Reverse order activities (PM first, AM second) to ensure AM/PM alignment works!
    const actPm = makeActivity({
      id: 'act-pm',
      startDateLocal: '2026-11-18T15:50:00',
      name: 'Afternoon Track 5x1000m',
      movingTimeSecs: 3550,
      trainingLoad: 82,
    });
    const actAm = makeActivity({
      id: 'act-am',
      startDateLocal: '2026-11-18T06:35:00',
      name: 'Morning Shakeout',
      movingTimeSecs: 1820,
      trainingLoad: 31,
    });

    const compliance = evaluatePlannedVsCompletedCompliance(
      [pmTrack, amShakeout],
      [actPm, actAm],
      '2026-11-18'
    );
    expect(compliance).toHaveLength(2);
    expect(compliance[0].plannedEventId).toBe('am-run');
    expect(compliance[0].matchedActivityId).toBe('act-am');
    expect(compliance[1].plannedEventId).toBe('pm-track');
    expect(compliance[1].matchedActivityId).toBe('act-pm');
    expect(compliance[0].complianceScore).toBeGreaterThanOrEqual(90);
    expect(compliance[1].complianceScore).toBeGreaterThanOrEqual(90);

    const partialReceipt = evaluateTodayTrainingReceipt({
      todayIso: '2026-11-18',
      activities: [actAm],
      plannedEvents: [amShakeout, pmTrack],
    });
    expect(partialReceipt.plannedCount).toBe(2);
    expect(partialReceipt.headline).toContain('1 of 2 planned');

    const lockIn = evaluateTomorrowLockIn({
      todayIso: '2026-11-18',
      plannedEvents: [tomorrowXc],
      rpe: 5,
      painFlag: false,
    });
    expect(lockIn.actionSummary).toContain('3:30 PM');
    expect(lockIn.actionSummary).toContain('Woodward Park XC');

    const overnightRx = computeOvernightRecoveryPrescription({
      todayLoadTss: 113,
      tomorrowEvents: lockIn.tomorrowEvents,
      safeSportHideWeight: true,
    });
    expect(overnightRx.tomorrowHeadline).toContain('Woodward Park XC');
  });

  it('builds recurring 9:15 PM bedtime reminder ICS & renders closeout reminder button', () => {
    expect(isPastReminderTime('21:15', new Date(2026, 10, 18, 21, 14, 0))).toBe(false);
    expect(isPastReminderTime('21:15', new Date(2026, 10, 18, 21, 15, 0))).toBe(true);

    const ics = buildBedtimeReminderIcs('21:15');
    expect(ics).toContain('RRULE:FREQ=DAILY');
    expect(ics).toContain('9:15 PM');

    const html = renderToStaticMarkup(
      React.createElement(EveningCloseoutCard, {
        todayIso: '2026-11-18',
        activities: [],
        plannedEvents: [
          makePlanned({
            date: '2026-11-19',
            name: 'XC Park Fartlek',
            scheduledTime: '15:45',
            locationName: 'Crystal Springs XC',
          }),
        ],
        sessionCheckIns: [],
        onRecordCheckIn: () => {},
        isDuskMode: false,
        onToggleDuskMode: () => {},
      })
    );
    expect(html).toContain('data-testid="toggle-bedtime-reminder-btn"');
    expect(html).toContain('Crystal Springs XC');
  });
});
