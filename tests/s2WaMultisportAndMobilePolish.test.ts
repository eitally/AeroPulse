import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AeroPulseLogo } from '../src/components/AeroPulseLogo';
import { CockpitFooter } from '../src/components/CockpitFooter';
import { computeActivityThreeChannelLoads } from '../src/physiology/orthopedicEngine';
import {
  STRAVA_LOAD_MODEL_VERSION,
  classifyMultiSportActivity,
  computeStravaActivityLoadV2,
} from '../src/physiology/stravaLoadCalibration';
import { mergeActivitiesNonDestructive } from '../src/utils/telemetryStorage';
import type { AthleteProfile, UnifiedActivity } from '../src/types';

function makeBaseProfile(): AthleteProfile {
  return {
    athleteId: 'test-athlete',
    name: 'Test Athlete',
    weightKg: 68,
    restingHr: 48,
    vo2MaxCycling: 60,
    vo2MaxRunning: 62,
    ftp: 280,
    indoorFtp: 270,
    eFtp: 280,
    wPrime: 18000,
    pMax: 1050,
    lthr: 168,
    maxHr: 192,
    sweetSpotMinPct: 88,
    sweetSpotMaxPct: 93,
    runFtp: 300,
    runEFtp: 300,
    runLthr: 174,
    runMaxHr: 194,
    thresholdPaceSecsPerKm: 240,
    hrZones: [],
    runHrZones: [],
    powerZones: [],
    lastSyncedAt: '2026-11-18T00:00:00Z',
    source: 'CUSTOM_OVERRIDE',
  };
}

function makeActivity(overrides: Partial<UnifiedActivity>): UnifiedActivity {
  return {
    id: 'act-1',
    startDateLocal: '2026-11-18T08:00:00Z',
    name: 'Session',
    sportCategory: 'Multisport',
    subType: 'Road',
    environment: 'OUTDOOR',
    movingTimeSecs: 3600,
    distanceMeters: 0,
    elevationGainMeters: 0,
    trainingLoad: 40,
    avgHr: 140,
    maxHr: 168,
    efficiencyFactor: 1.5,
    aerobicDecouplingPct: 0,
    firstHalfEf: 0,
    secondHalfEf: 0,
    zoneSecs: { hr: [0, 0, 0, 0, 0, 0, 0] },
    stravaPrCount: 0,
    segmentEfforts: [],
    sourceBadges: ['Strava'],
    ...overrides,
  };
}

describe('BRD-02 & SYNC-02 · S2 × W-A Brand Modularity, Multi-Sport TSS v4 & Non-Destructive Sync', () => {
  it('renders decoupled S2 mark, W-A wordmark, horizontal lockup, and high-contrast on-dark footer', () => {
    const markOnlyHtml = renderToStaticMarkup(
      React.createElement(AeroPulseLogo, { mode: 'mark-only', size: 'sm' })
    );
    expect(markOnlyHtml).toContain('viewBox="0 0 128 128"');
    expect(markOnlyHtml).not.toContain('viewBox="0 0 326 64"');

    const wordmarkOnlyHtml = renderToStaticMarkup(
      React.createElement(AeroPulseLogo, { mode: 'wordmark-only', surface: 'on-dark' })
    );
    expect(wordmarkOnlyHtml).toContain('viewBox="0 0 326 64"');
    expect(wordmarkOnlyHtml).not.toContain('viewBox="0 0 128 128"');
    expect(wordmarkOnlyHtml).toContain('--thresh-ink:#F6F3EC');

    const footerHtml = renderToStaticMarkup(
      React.createElement(CockpitFooter, {
        athleteFtp: 280,
        onOpenProfile: () => {},
        onOpenDataSources: () => {},
        onOpenGuide: () => {},
        onOpenBrandStudio: () => {},
      })
    );
    expect(footerHtml).toContain('--thresh-volt:#B83A24');
    expect(footerHtml).toContain('--thresh-volt:#D8FF2A');
    expect(footerHtml).toContain('--thresh-ink:#121413');
    expect(footerHtml).toContain('--thresh-ink:#F6F3EC');
    expect(footerHtml).toContain('text-ap-muted');
    expect(footerHtml).toContain('text-ap-clay');
  });

  it('classifies all non-run/non-bike sports cleanly and uses Load Model v4 without inflating casual/strength work', () => {
    expect(STRAVA_LOAD_MODEL_VERSION).toBe(4);

    const hikeClass = classifyMultiSportActivity('Hike', 'Pikes Peak Ascent');
    expect(hikeClass.sportCategory).toBe('Multisport');
    expect(hikeClass.subType).toBe('Hiking');

    const rowClass = classifyMultiSportActivity('Rowing', 'Concept2 3x2000m', {
      trainer: true,
      hasGps: false,
    });
    expect(rowClass.sportCategory).toBe('Multisport');
    expect(rowClass.subType).toBe('Rowing');
    expect(rowClass.environment).toBe('INDOOR');

    const yogaClass = classifyMultiSportActivity('Yoga', 'Evening Mobility Flow');
    expect(yogaClass.sportCategory).toBe('Strength');
    expect(yogaClass.subType).toBe('Yoga & Mobility');

    const swimLoad = computeStravaActivityLoadV2({
      sportCategory: 'Swimming',
      rawSportType: 'Swim',
      name: '3000m Threshold Swim',
      movingTimeSecs: 3000,
      distanceMeters: 3000,
      avgHr: 148,
      calibratedFtp: 280,
      calibratedBikeLthr: 168,
      calibratedRunLthr: 174,
      calibratedThresholdPaceSecsPerKm: 240,
      restingHr: 48,
    });
    expect(swimLoad.trainingLoad).toBeGreaterThanOrEqual(45);

    const mountainHike = computeStravaActivityLoadV2({
      sportCategory: 'Multisport',
      rawSportType: 'Hike',
      name: 'Steep Ridge Hike',
      movingTimeSecs: 5400,
      distanceMeters: 8500,
      elevationGainMeters: 950,
      avgHr: 138,
      calibratedFtp: 280,
      calibratedBikeLthr: 168,
      calibratedRunLthr: 174,
      calibratedThresholdPaceSecsPerKm: 240,
      restingHr: 48,
    });
    const flatWalk = computeStravaActivityLoadV2({
      sportCategory: 'Multisport',
      rawSportType: 'Walk',
      name: 'Neighborhood Walk',
      movingTimeSecs: 5400,
      distanceMeters: 6000,
      elevationGainMeters: 20,
      avgHr: 104,
      calibratedFtp: 280,
      calibratedBikeLthr: 168,
      calibratedRunLthr: 174,
      calibratedThresholdPaceSecsPerKm: 240,
      restingHr: 48,
    });
    expect(mountainHike.trainingLoad).toBeGreaterThan(flatWalk.trainingLoad);

    const strengthSession = computeStravaActivityLoadV2({
      sportCategory: 'Strength',
      rawSportType: 'WeightTraining',
      name: 'Heavy Squats & Deadlifts',
      movingTimeSecs: 3600,
      distanceMeters: 0,
      avgHr: 122,
      calibratedFtp: 280,
      calibratedBikeLthr: 168,
      calibratedRunLthr: 174,
      calibratedThresholdPaceSecsPerKm: 240,
      restingHr: 48,
    });
    expect(strengthSession.trainingLoad).toBeGreaterThanOrEqual(18);
    expect(strengthSession.trainingLoad).toBeLessThanOrEqual(55);

    const yogaSession = computeStravaActivityLoadV2({
      sportCategory: 'Multisport',
      rawSportType: 'Yoga',
      name: 'Evening Flow',
      movingTimeSecs: 2400,
      distanceMeters: 0,
      avgHr: 96,
      calibratedFtp: 280,
      calibratedBikeLthr: 168,
      calibratedRunLthr: 174,
      calibratedThresholdPaceSecsPerKm: 240,
      restingHr: 48,
    });
    expect(yogaSession.isLowImpactCasual).toBe(true);
    expect(yogaSession.trainingLoad).toBeLessThan(25);
  });

  it('zeros eccentric impact in orthopedicEngine for zero-impact cross-training sports', () => {
    const profile = makeBaseProfile();
    for (const sample of [
      { sportCategory: 'Swimming' as const, subType: 'Pool' as const },
      { sportCategory: 'Multisport' as const, subType: 'Rowing' as const },
      { sportCategory: 'Multisport' as const, subType: 'Elliptical' as const },
      { sportCategory: 'Multisport' as const, subType: 'Yoga & Mobility' as const },
      { sportCategory: 'Multisport' as const, subType: 'Paddling & Water' as const },
    ]) {
      const channels = computeActivityThreeChannelLoads(makeActivity(sample), profile);
      expect(channels.eccentricImpact).toBe(0);
    }

    const hikeChannels = computeActivityThreeChannelLoads(
      makeActivity({
        sportCategory: 'Multisport',
        subType: 'Hiking',
        distanceMeters: 9000,
        elevationGainMeters: 600,
      }),
      profile
    );
    expect(hikeChannels.eccentricImpact).toBeGreaterThan(0);
    expect(hikeChannels.concentricTorque).toBeGreaterThan(0);
  });

  it('never merges two distinct Strava activities occurring close together on the same day', () => {
    const runSession = makeActivity({
      id: 'strava-1001',
      stravaId: '1001',
      sportCategory: 'Running',
      name: 'Morning Track Repeats',
      startDateLocal: '2026-11-18T08:00:00Z',
      movingTimeSecs: 1800,
      distanceMeters: 5000,
    });
    const cooldownSession = makeActivity({
      id: 'strava-1002',
      stravaId: '1002',
      sportCategory: 'Running',
      name: 'Track Cooldown',
      startDateLocal: '2026-11-18T08:03:00Z',
      movingTimeSecs: 900,
      distanceMeters: 2000,
    });

    const merged = mergeActivitiesNonDestructive([runSession], [cooldownSession]);
    expect(merged.length).toBe(2);
    expect(merged.map((a) => a.stravaId).sort()).toEqual(['1001', '1002']);
  });
});
