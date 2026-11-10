import { gunzipSync, unzipSync } from 'fflate';
import type { SportCategory, UnifiedActivity } from '../types';
import {
  DEFAULT_WORKER_THRESHOLDS,
  parseWorkoutFileInWorker,
  type WorkerAthleteThresholds,
} from '../workers/activityWorkerClient';

export interface ExtractedWorkoutEntry {
  fileName: string;
  extension: 'fit' | 'gpx' | 'tcx' | 'json';
  bytes: Uint8Array;
}

export interface ArchiveImportProgress {
  processed: number;
  total: number;
  importedCount: number;
  skippedCount: number;
  currentFileName: string;
}

export interface ArchiveImportResult {
  importedActivities: UnifiedActivity[];
  skippedFiles: { fileName: string; reason: string }[];
  totalDiscovered: number;
}

function detectSupportedExtension(
  rawPath: string
): { cleanName: string; ext: 'fit' | 'gpx' | 'tcx' | 'json'; isGzipped: boolean } | null {
  const base = rawPath.split('/').pop() || rawPath;
  if (!base || base.startsWith('.') || base.startsWith('__MACOSX')) return null;
  const lower = base.toLowerCase();

  if (lower.endsWith('.fit.gz')) {
    return { cleanName: base.slice(0, -3), ext: 'fit', isGzipped: true };
  }
  if (lower.endsWith('.gpx.gz')) {
    return { cleanName: base.slice(0, -3), ext: 'gpx', isGzipped: true };
  }
  if (lower.endsWith('.tcx.gz')) {
    return { cleanName: base.slice(0, -3), ext: 'tcx', isGzipped: true };
  }
  if (lower.endsWith('.fit')) {
    return { cleanName: base, ext: 'fit', isGzipped: false };
  }
  if (lower.endsWith('.gpx')) {
    return { cleanName: base, ext: 'gpx', isGzipped: false };
  }
  if (lower.endsWith('.tcx')) {
    return { cleanName: base, ext: 'tcx', isGzipped: false };
  }
  return null;
}

/**
 * Pure extractor: unpacks a `.zip`, `.fit.gz`, `.gpx.gz`, `.tcx.gz`, or raw `.fit`/`.gpx`/`.tcx`
 * buffer into normalized `ExtractedWorkoutEntry` payloads (including nested `.zip` and `.gz` entries
 * common in Garmin DI-Connect and Strava bulk exports).
 */
export function extractWorkoutEntriesFromArchiveBytes(
  fileName: string,
  rawBytes: Uint8Array,
  maxDepth = 2
): ExtractedWorkoutEntry[] {
  const lower = fileName.toLowerCase();

  if (lower.endsWith('.zip') && maxDepth > 0) {
    const entries = unzipSync(rawBytes);
    const out: ExtractedWorkoutEntry[] = [];
    for (const [entryPath, entryBytes] of Object.entries(entries)) {
      if (!entryBytes || entryBytes.length === 0) continue;
      if (entryPath.includes('__MACOSX/')) continue;

      if (entryPath.toLowerCase().endsWith('.zip') && maxDepth > 1) {
        out.push(...extractWorkoutEntriesFromArchiveBytes(entryPath, entryBytes, maxDepth - 1));
        continue;
      }

      const detected = detectSupportedExtension(entryPath);
      if (!detected) continue;

      try {
        const payload = detected.isGzipped ? gunzipSync(entryBytes) : entryBytes;
        if (payload.length > 0) {
          out.push({
            fileName: detected.cleanName,
            extension: detected.ext,
            bytes: payload,
          });
        }
      } catch {
        // skip corrupt inner archive entry
      }
    }
    return out;
  }

  const detected = detectSupportedExtension(fileName);
  if (!detected) return [];
  const payload = detected.isGzipped ? gunzipSync(rawBytes) : rawBytes;
  return [
    {
      fileName: detected.cleanName,
      extension: detected.ext,
      bytes: payload,
    },
  ];
}

/**
 * Batch-imports one or more `.zip`, `.fit`, `.fit.gz`, `.gpx`, `.gpx.gz`, or `.tcx` files
 * via the background Web Worker, deduplicating by `(startDateLocal, distanceMeters)` against existing workouts.
 */
export async function importWorkoutFilesOrArchive(params: {
  files: File[];
  existingActivities?: UnifiedActivity[];
  thresholds?: WorkerAthleteThresholds;
  overrideSport?: SportCategory;
  onProgress?: (progress: ArchiveImportProgress) => void;
}): Promise<ArchiveImportResult> {
  const {
    files,
    existingActivities = [],
    thresholds = DEFAULT_WORKER_THRESHOLDS,
    overrideSport,
    onProgress,
  } = params;

  const allEntries: ExtractedWorkoutEntry[] = [];
  for (const file of files) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const extracted = extractWorkoutEntriesFromArchiveBytes(file.name, buf);
    allEntries.push(...extracted);
  }

  const seenFingerprints = new Set<string>(
    existingActivities.map(
      (a) => `${(a.startDateLocal || '').slice(0, 16)}:${Math.round((a.distanceMeters || 0) / 50)}`
    )
  );

  const importedActivities: UnifiedActivity[] = [];
  const skippedFiles: { fileName: string; reason: string }[] = [];

  for (let i = 0; i < allEntries.length; i++) {
    const entry = allEntries[i];
    onProgress?.({
      processed: i,
      total: allEntries.length,
      importedCount: importedActivities.length,
      skippedCount: skippedFiles.length,
      currentFileName: entry.fileName,
    });

    try {
      const fileObj =
        entry.extension === 'fit'
          ? new File([entry.bytes.slice()], entry.fileName, {
              type: 'application/octet-stream',
            })
          : new TextDecoder('utf-8').decode(entry.bytes);

      const { activity } = await parseWorkoutFileInWorker(
        fileObj,
        typeof fileObj === 'string' ? entry.fileName : thresholds,
        overrideSport
      );

      const fp = `${(activity.startDateLocal || '').slice(0, 16)}:${Math.round((activity.distanceMeters || 0) / 50)}`;
      if (seenFingerprints.has(fp)) {
        skippedFiles.push({ fileName: entry.fileName, reason: 'Duplicate workout timestamp' });
        continue;
      }
      seenFingerprints.add(fp);
      importedActivities.push(activity);
    } catch (err) {
      skippedFiles.push({
        fileName: entry.fileName,
        reason: err instanceof Error ? err.message : 'Unsupported or empty telemetry file',
      });
    }
  }

  onProgress?.({
    processed: allEntries.length,
    total: allEntries.length,
    importedCount: importedActivities.length,
    skippedCount: skippedFiles.length,
    currentFileName: 'Complete',
  });

  return {
    importedActivities,
    skippedFiles,
    totalDiscovered: allEntries.length,
  };
}
