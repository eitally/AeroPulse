import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  computeCheckInStreak,
  computeOvernightRecoveryPrescription,
  evaluateTodayTrainingReceipt,
  evaluateTomorrowLockIn,
  findMorningContinuityFromLastNight,
  resolveCircadianHeroMode,
} from '../src/physiology/eveningHabitEngine';
import { buildCoachSquadExecutionDigest } from '../src/physiology/sessionCheckInAndDigestEngine';
import { getLocalDateIso, shiftIsoDate } from '../src/physiology/stravaLoadCalibration';
import { EveningCloseoutCard } from '../src/components/today/EveningCloseoutCard';
import { DEFAULT_SELF_PRIVACY_SETTINGS } from '../src/data/athleteRosterData';
import { buildCompleteAthleteProfile } from '../src/utils/telemetryStorage';
import type {
  ConnectedAthleteRecord,
  PlannedWorkoutEvent,
  SessionCheckInRecord,
  UnifiedActivity,
} from '../src/types';

function makeActivity(dateIso: string, tss = 85): UnifiedActivity {
  return {
    id: `act-${dateIso}`,
    startDateLocal: `${dateIso}T16:30:00`,
    name: 'Threshold Intervals',
    sportCategory: 'Running',
    environment: 'OUTDOOR',
    subType: 'Track',
    movingTimeSecs: 3000,
    distanceMeters: 10500,
    elevationGainMeters: 30,
    intensityFactor: 0.94,
    trainingLoad: tss,
    avgHr: 168,
    maxHr: 184,
    aerobicDecouplingPct: 2.1,
    efficiencyFactor: 1.52,
    firstHalfEf: 1.53,
    secondHalfEf: 1.51,
    zoneSecs: { hr: [300, 1200, 900, 500, 100, 0, 0] },
    stravaPrCount: 0,
    segmentEfforts: [],
    sourceBadges: ['Garmin'],
  };
}

function makePlanned(dateIso: string, load = 90): PlannedWorkoutEvent {
  return {
    id: `plan-${dateIso}`,
    date: dateIso,
    name: '6x1km VO2 Track Session',
    sportCategory: 'Running',
    environmentPreference: 'OUTDOOR',
    description: 'Hard aerobic track intervals',
    plannedLoad: load,
    plannedDurationSecs: 3600,
    targetZoneSummary: 'Z5',
  };
}

describe('HABIT-01, BUG-03 & BRD-03 Evening Habit Loop & Timezone Sweep', () => {
  it('resolves TONIGHT circadian mode for bedtime hours (19:00–03:59) and POST_SESSION/MORNING during daytime', () => {
    expect(resolveCircadianHeroMode({ localHour: 21, hasCompletedToday: false })).toBe('TONIGHT');
    expect(resolveCircadianHeroMode({ localHour: 1, hasCompletedToday: true })).toBe('TONIGHT');
    expect(resolveCircadianHeroMode({ localHour: 14, hasCompletedToday: true })).toBe('POST_SESSION');
    expect(resolveCircadianHeroMode({ localHour: 6, hasCompletedToday: false })).toBe('MORNING');
  });

  it('computes today receipt, streak, Safe-Sport weight-free overnight Rx, tomorrow lock-in, and 6 AM morning continuity', () => {
    const todayIso = '2026-11-18';
    const yesterdayIso = shiftIsoDate(todayIso, -1);
    const tomorrowIso = shiftIsoDate(todayIso, 1);

    const receipt = evaluateTodayTrainingReceipt({
      todayIso,
      activities: [makeActivity(todayIso, 102)],
      plannedEvents: [],
    });
    expect(receipt.sessionCount).toBe(1);
    expect(receipt.totalLoadTss).toBe(102);

    const rx = computeOvernightRecoveryPrescription({
      todayLoadTss: 102,
      safeSportHideWeight: true,
      tomorrowEvent: makePlanned(tomorrowIso, 92),
      rpe: 8,
      legFeel: 'HEAVY',
      lifeStressFlag: true,
    });
    expect(rx.sleepTargetHours).toBeGreaterThanOrEqual(8.5);
    expect(rx.fuelFocusLabel).not.toMatch(/g\/kg|\bkg\b|\blbs\b/i);

    const checkIns: SessionCheckInRecord[] = [
      {
        id: 'c-yest',
        date: yesterdayIso,
        rpe: 6,
        painFlag: false,
        legFeel: 'NORMAL',
        ritualSlot: 'TONIGHT',
        sleepTargetHours: 8.5,
        createdAt: `${yesterdayIso}T21:15:00Z`,
      },
      {
        id: 'c-prev',
        date: shiftIsoDate(todayIso, -2),
        rpe: 5,
        painFlag: false,
        createdAt: `${shiftIsoDate(todayIso, -2)}T21:10:00Z`,
      },
    ];
    expect(computeCheckInStreak(checkIns, todayIso)).toBe(2);
    expect(findMorningContinuityFromLastNight(checkIns, todayIso)?.id).toBe('c-yest');

    const swapEval = evaluateTomorrowLockIn({
      todayIso,
      plannedEvents: [makePlanned(tomorrowIso, 92)],
      rpe: 7,
      painFlag: true,
      painArea: 'SHIN',
    });
    expect(swapEval.statusLabel).toBe('Auto-Morph Armed');
    expect(swapEval.swapEvaluation.shouldSwap).toBe(true);
    expect(swapEval.swapEvaluation.replacementEventInput?.name).toContain('Low-Impact Recovery Flush');
  });

  it('renders EveningCloseoutCard with canonical E2E testids, dusk toggle, and Safe-Sport compliance', () => {
    const html = renderToStaticMarkup(
      React.createElement(EveningCloseoutCard, {
        todayIso: '2026-11-18',
        activities: [makeActivity('2026-11-18', 95)],
        plannedEvents: [makePlanned('2026-11-19', 88)],
        safeSportHideWeight: true,
        sessionCheckIns: [
          {
            id: 'prev-1',
            date: '2026-11-17',
            rpe: 5,
            createdAt: '2026-11-17T21:30:00Z',
          },
        ],
        onRecordCheckIn: () => {},
        isDuskMode: true,
        onToggleDuskMode: () => {},
      })
    );
    expect(html).toContain('data-testid="athlete-session-checkin-card"');
    expect(html).toContain('data-testid="checkin-rpe-7"');
    expect(html).toContain('data-testid="toggle-circadian-dusk-btn"');
    expect(html).toContain('1d streak');
    expect(html).not.toMatch(/\bg\/kg\b/i);
  });

  it('counts 9:30 PM closeouts in the 6:00 AM coach execution digest and flags HIGH_LIFE_STRESS', () => {
    const morningToday = '2026-11-18';
    const lastNight = '2026-11-17';
    const ath: ConnectedAthleteRecord = {
      id: 'team-mem-1',
      stravaAthleteId: '1001',
      inviteCode: 'TEST-1',
      name: 'Maya NightOwl',
      avatarInitials: 'MN',
      location: 'Track',
      primarySport: 'Running',
      primaryGoalSummary: 'Sub-2:10 800m',
      role: 'COACH_EDIT',
      status: 'CONNECTED',
      athleteProfile: buildCompleteAthleteProfile({
        name: 'Maya NightOwl',
        primarySport: 'Running',
        thresholdPaceSecsPerKm: 245,
      }),
      privacySettings: { ...DEFAULT_SELF_PRIVACY_SETTINGS },
      wellnessDays: [],
      activities: [makeActivity(lastNight, 75)],
      plannedEvents: [makePlanned(lastNight, 75), makePlanned(morningToday, 60)],
      targetGoals: [],
      sessionCheckIns: [
        {
          id: 'night-chk',
          date: lastNight,
          rpe: 6,
          painFlag: false,
          lifeStressFlag: true,
          sorenessNote: 'AP Chemistry exam + travel',
          ritualSlot: 'TONIGHT',
          createdAt: `${lastNight}T21:30:00Z`,
        },
      ],
    };

    const digest = buildCoachSquadExecutionDigest({
      roster: [ath],
      todayIso: morningToday,
      windowDays: 7,
    });
    expect(digest.checkedInLast24hCount).toBe(1);
    expect(digest.lifeStressCount).toBe(1);
    expect(digest.rows[0].checkedInLast24h).toBe(true);
    expect(digest.rows[0].checkInStreakDays).toBe(1);
    expect(digest.rows[0].attentionReason).toBe('HIGH_LIFE_STRESS');
    expect(digest.rows[0].attentionSummary).toContain('AP Chemistry exam + travel');
  });

  it('preserves local evening calendar dates in getLocalDateIso and shiftIsoDate without UTC rollover', () => {
    const lateEvening = new Date(2026, 10, 18, 22, 45, 0);
    expect(getLocalDateIso(lateEvening)).toBe('2026-11-18');
    expect(shiftIsoDate('2026-11-18', 1)).toBe('2026-11-19');
    expect(shiftIsoDate('2026-11-18', -1)).toBe('2026-11-17');
  });
});
