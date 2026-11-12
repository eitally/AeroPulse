import { describe, expect, it } from 'vitest';
import { buildSampleDemoDataset } from '../src/data/sampleDemoData';
import { evaluateRollingTrainingProductivity } from '../src/physiology/trainingProductivityEngine';
import { buildCompleteAthleteProfile } from '../src/utils/telemetryStorage';

describe('Phase 3: Sport-Aware Defaults & Sample Demo Dataset', () => {
  it('preserves primarySport on AthleteProfile and honors Running on Day-1 0-workout calibration', () => {
    const profile = buildCompleteAthleteProfile({
      name: 'Taylor Track',
      primarySport: 'Running',
      thresholdPaceSecsPerKm: 240,
    });

    expect(profile.primarySport).toBe('Running');

    const dayOneSummary = evaluateRollingTrainingProductivity({
      activities: [],
      wellnessDays: [],
      athleteProfile: profile,
      asOfDateIso: '2026-11-12',
    });

    expect(dayOneSummary.verdict).toBe('CALIBRATING');
    expect(dayOneSummary.readinessScore).toBe(0);
    expect(dayOneSummary.efPrimarySport).toBe('Running');
  });

  it('builds a deterministic, explicitly labeled in-memory Sample Demo dataset', () => {
    const sample = buildSampleDemoDataset('2026-11-12');

    expect(sample.athleteProfile.name).toBe('Sample Athlete (Demo)');
    expect(sample.athleteProfile.primarySport).toBe('Running');
    expect(sample.wellnessDays).toHaveLength(45);
    expect(sample.activities.length).toBeGreaterThanOrEqual(10);
    expect(sample.activities[0].streams?.time.length).toBeGreaterThan(50);
    expect(sample.plannedEvents).toHaveLength(4);
    expect(sample.plannedEvents[0].date).toBe('2026-11-12');
    expect(sample.targetGoals).toHaveLength(2);
  });
});
