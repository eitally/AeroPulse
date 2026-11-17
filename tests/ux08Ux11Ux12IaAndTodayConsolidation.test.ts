import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  formatPaceSecsForInput,
  parsePaceInputToSecsPerKm,
} from '../src/components/AthleteProfileModal';
import { inferPrimarySportFromActivities } from '../src/utils/telemetryStorage';
import type { UnifiedActivity } from '../src/types';

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

function makeActivity(id: string, sportCategory: UnifiedActivity['sportCategory']): UnifiedActivity {
  return {
    id,
    startDateLocal: '2026-11-16T08:00:00',
    name: `${sportCategory} Session`,
    sportCategory,
    environment: 'OUTDOOR',
    subType: sportCategory === 'Running' ? 'Road' : 'Road',
    movingTimeSecs: 2400,
    distanceMeters: 8000,
    elevationGainMeters: 40,
    trainingLoad: 55,
    avgHr: 152,
    maxHr: 174,
    aerobicDecouplingPct: 2.1,
    efficiencyFactor: 1.5,
    firstHalfEf: 1.52,
    secondHalfEf: 1.49,
    zoneSecs: { hr: [200, 1400, 500, 250, 50, 0, 0] },
    stravaPrCount: 0,
    segmentEfforts: [],
    sourceBadges: ['Strava'],
  };
}

describe('UX-08, UX-11 & UX-12 Post-Login 3-Pillar IA, Today Consolidation & Profile/Coach Fixes', () => {
  it('UX-08: standardizes Athlete nav on 3 pillars (Today, Training Calendar, Plan Builder) with #plan-builder alias and in-place Inspector', () => {
    const header = readSrc('src/components/CockpitHeader.tsx');
    expect(header).toContain("label: 'Today'");
    expect(header).toContain("label: 'Training Calendar'");
    expect(header).toContain("label: 'Plan Builder'");
    expect(header).toContain("href: '#plan-builder'");
    expect(header).toContain('data-testid={`coach-subtab-${item.id.toLowerCase()}`}');
    expect(header).toContain('Fitness ${latestWellness');

    const dock = readSrc('src/components/MobileDock.tsx');
    expect(dock).toContain('grid-cols-3');
    expect(dock).toContain("label: 'Calendar'");
    expect(dock).toContain("label: 'Plan Builder'");

    const app = readSrc('src/App.tsx');
    expect(app).toContain("if (hash === 'plan-builder')");
    // In-place inspector handler must not force navigation away from activeTab
    const match = app.match(/const handleSelectActivityAndOpenTab[\s\S]*?\n\s*\);/);
    expect(match?.[0]).toBeTruthy();
    expect(match?.[0]).not.toContain("setActiveTab('activities')");

    const router = readSrc('src/components/WorkspaceRouter.tsx');
    expect(router).toContain('data-testid="calendar-subview-grid"');
    expect(router).toContain('data-testid="calendar-subview-log"');
    expect(router).toContain('data-testid="calendar-bar-stopwatch-btn"');
    expect(router).toContain('inspectorOnly');

    const banners = readSrc('src/components/CockpitStageBanners.tsx');
    expect(banners).toContain('post-login-welcome-launchpad');
    expect(banners).toContain('Build a Workout or Plan');
  });

  it('UX-11: consolidates retrospective physiology into Today deep-dive, removes historical tables from GoalsView, and removes Wearable needed clutter', () => {
    const deepDive = readSrc('src/components/TodayPhysiologyDeepDive.tsx');
    expect(deepDive).toContain('today-physiology-deep-dive-toggle');
    expect(deepDive).toContain('Power, Pace & PRs');
    expect(deepDive).toContain('Durability & Distribution');
    expect(deepDive).toContain('Zone Progression & Calibration');
    expect(deepDive).toContain('Trends & Custom Lab');
    expect(deepDive).toContain('<TrackProgressionAndCalibrationPanel');
    expect(deepDive).toContain('strava-90d-history-cue');

    const goals = readSrc('src/components/GoalsView.tsx');
    expect(goals).not.toContain('Running Race Time Predictor');
    expect(goals).not.toContain('Gear Lifespan Tracker');
    expect(goals).toContain('Race Physics &amp; Fueling Simulator');

    const hero = readSrc('src/components/CircadianFirstTouchHero.tsx');
    expect(hero).toContain('strava-only-readiness-summary');
    expect(hero).toContain("Schedule Today's Workout");

    const runPreferred = inferPrimarySportFromActivities([
      makeActivity('r1', 'Running'),
      makeActivity('r2', 'Running'),
      makeActivity('b1', 'Cycling'),
    ]);
    expect(runPreferred).toBe('Running');
    expect(inferPrimarySportFromActivities([])).toBeUndefined();
  });

  it('UX-12: supports 3:30-16:00/mi threshold paces in mm:ss without the 9:39/mi slider cap, smart CustomCharts default, and Coach workspace cleanup', () => {
    // 10:30/mi -> ~391s/km (previously blocked by max=360 slider!)
    const pace1030Mi = parsePaceInputToSecsPerKm('10:30', 'mi');
    expect(pace1030Mi).toBeGreaterThan(360);
    expect(formatPaceSecsForInput(pace1030Mi!, 'mi')).toBe('10:30');

    // 12:15/mi and 4:00/mi bounds
    const pace1215Mi = parsePaceInputToSecsPerKm('12:15/mi', 'mi');
    expect(pace1215Mi).toBeGreaterThan(440);
    const fastKm = parsePaceInputToSecsPerKm('3:05', 'km');
    expect(fastKm).toBe(185);

    const profileModal = readSrc('src/components/AthleteProfileModal.tsx');
    expect(profileModal).toContain('profile-lt-pace-input');
    expect(profileModal).toContain('profile-sport-filter');
    expect(profileModal).not.toContain('min={180}\n                max={360}');

    const coachView = readSrc('src/components/CoachWorkspaceView.tsx');
    expect(coachView).toContain('initialShowCreateStudio={openCreateTeamOnSwitch}');
    expect(coachView).toContain("activeTeam.brand.orgType === 'COLLEGIATE'");
    expect(coachView).toContain('/workouts/broadcast');
    expect(coachView).not.toContain('SUB_TABS');

    const customCharts = readSrc('src/components/CustomChartsView.tsx');
    expect(customCharts).toContain('hasWearableBiometrics');
    expect(customCharts).toContain("'efficiencyFactor'");
  });
});
