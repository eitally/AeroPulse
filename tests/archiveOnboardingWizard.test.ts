import { describe, expect, it, vi } from 'vitest';
import { gzipSync, zipSync } from 'fflate';
import {
  extractWorkoutEntriesFromArchiveBytes,
  importWorkoutFilesOrArchive,
  type ArchiveImportProgress,
} from '../src/utils/archiveImporter';
import type { UnifiedActivity } from '../src/types';

vi.mock('../src/workers/activityWorkerClient', () => {
  return {
    DEFAULT_WORKER_THRESHOLDS: { ftpWatts: 250, thresholdPaceSecsPerKm: 260 },
    parseWorkoutFileInWorker: vi
      .fn()
      .mockImplementation(async (fileObj: any, fileNameOrThresholds: any) => {
        const name = typeof fileNameOrThresholds === 'string' ? fileNameOrThresholds : fileObj?.name || 'workout';
        const dayOffset = name.includes('2') ? 11 : 10;
        return {
          activity: {
            id: `imported_${name}`,
            stravaId: `local_${name}`,
            name: `Workout from ${name}`,
            sportCategory: 'Running',
            sportType: 'Run',
            startDateLocal: `2026-11-${dayOffset}T08:00:00Z`,
            distanceMeters: 5000,
            movingTimeSecs: 1500,
            elapsedTimeSecs: 1550,
            elevationGainM: 45,
            trainingLoad: 60,
            intensityFactor: 0.85,
            aerobicTss: 60,
            anaerobicTss: 0,
            streamQuality: 'FULL_STREAM',
            sourceBadges: ['LOCAL_FILE'],
            isManual: false,
          } as unknown as UnifiedActivity,
          stream: {
            activityId: `imported_${name}`,
            time: [0, 1, 2],
            watts: [200, 205, 210],
          },
        };
      }),
  };
});

describe('ONB-01: Guided Archive Importer Onboarding Wizard & Telemetry Ingestion', () => {
  it('extracts nested zip, fit.gz, and gpx entries from multi-source export archives', () => {
    // Construct simulated Strava / Garmin export archive containing:
    // 1. activities/ride_123.fit.gz
    // 2. nested_export.zip -> containing track_456.gpx
    // 3. invalid_file.txt (should be ignored)

    const fitContent = new TextEncoder().encode('.FIT sample binary telemetry payload');
    const gpxContent = new TextEncoder().encode('<gpx version="1.1"><trk></trk></gpx>');
    const txtContent = new TextEncoder().encode('ReadMe text file');

    const innerZip = zipSync({
      'track_456.gpx': gpxContent,
    });

    const outerZip = zipSync({
      'activities/ride_123.fit.gz': gzipSync(fitContent),
      'archives/nested_export.zip': innerZip,
      'instructions.txt': txtContent,
    });

    const entries = extractWorkoutEntriesFromArchiveBytes('strava_export_2026.zip', outerZip);

    expect(entries.length).toBe(2);
    const names = entries.map((e) => e.fileName);
    expect(names).toContain('ride_123.fit');
    expect(names).toContain('track_456.gpx');
    expect(names).not.toContain('instructions.txt');

    const fitEntry = entries.find((e) => e.fileName === 'ride_123.fit');
    expect(fitEntry?.extension).toBe('fit');
    expect(new TextDecoder().decode(fitEntry?.bytes)).toBe(
      '.FIT sample binary telemetry payload'
    );
  });

  it('correctly tracks progress milestones during batch ingestion', async () => {
    const progressUpdates: ArchiveImportProgress[] = [];

    const dummyGpx = new TextEncoder().encode(
      '<?xml version="1.1"?><gpx><trk><name>Morning Run</name></trk></gpx>'
    );
    const mockFile1 = new File([dummyGpx], 'workout1.gpx', { type: 'application/gpx+xml' });
    const mockFile2 = new File([dummyGpx], 'workout2.gpx', { type: 'application/gpx+xml' });

    const result = await importWorkoutFilesOrArchive({
      files: [mockFile1, mockFile2],
      existingActivities: [],
      onProgress: (p) => {
        progressUpdates.push({ ...p });
      },
    });

    expect(result.totalDiscovered).toBe(2);
    expect(result.importedActivities.length).toBe(2);
    expect(progressUpdates.length).toBeGreaterThanOrEqual(2);
    const lastProgress = progressUpdates[progressUpdates.length - 1];
    expect(lastProgress.processed).toBe(2);
    expect(lastProgress.total).toBe(2);
    expect(lastProgress.importedCount).toBe(2);
  });

  it('skips duplicate workouts when deduplicating against existing athlete history', async () => {
    const existingActivities: UnifiedActivity[] = [
      {
        id: 'existing_run_1',
        stravaId: 'existing_run_1',
        name: 'Morning Trail Run',
        sportCategory: 'Running',
        startDateLocal: '2026-11-10T08:00:00Z',
        distanceMeters: 5000,
        movingTimeSecs: 1500,
        elapsedTimeSecs: 1550,
        elevationGainM: 45,
        trainingLoad: 60,
        intensityFactor: 0.85,
        aerobicTss: 60,
        anaerobicTss: 0,
        streamQuality: 'FULL_STREAM',
        sourceBadges: ['Strava'],
        isManual: false,
      } as unknown as UnifiedActivity,
    ];

    const dummyGpx = new TextEncoder().encode('<gpx><trk><name>Morning Run</name></trk></gpx>');
    const mockFile = new File([dummyGpx], 'workout1.gpx', { type: 'application/gpx+xml' });

    // The worker returns an activity with identical start time (+/- 120s) and distance (+/- 250m)
    const result = await importWorkoutFilesOrArchive({
      files: [mockFile],
      existingActivities,
    });

    expect(result.importedActivities.length).toBe(0);
    expect(result.skippedFiles.length).toBe(1);
    expect(result.skippedFiles[0].reason).toContain('Duplicate workout');
  });

  it('verifies 100% offline telemetry privacy: zero network requests made during ingestion', async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;

    try {
      const dummyGpx = new TextEncoder().encode('<gpx><trk></trk></gpx>');
      const mockFile = new File([dummyGpx], 'offline_run.gpx', { type: 'application/gpx+xml' });

      await importWorkoutFilesOrArchive({
        files: [mockFile],
        existingActivities: [],
      });

      // Assert that zero external API / network fetch calls were dispatched
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
