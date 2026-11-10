import type {
  ActivityInterval,
  ActivityStreamSet,
  SportCategory,
  UnifiedActivity,
} from '../types';
import type {
  ActivityWorkerRequest,
  ActivityWorkerResponse,
  ComputedStreamAnalytics,
  WorkerAthleteThresholds,
} from './activityProcessor.worker';
import {
  bulkUpsertActivitiesToDexie,
  saveActivityStreamToDexie,
} from '../db/workoutStore';

let sharedWorker: Worker | null = null;
const pendingCallbacks = new Map<
  string,
  {
    resolve: (res: any) => void;
    reject: (err: Error) => void;
  }
>();

function getActivityWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    return null;
  }
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL('./activityProcessor.worker.ts', import.meta.url), {
      type: 'module',
    });
    sharedWorker.onmessage = (event: MessageEvent<ActivityWorkerResponse>) => {
      const data = event.data;
      if (!data || !data.id) return;
      const pending = pendingCallbacks.get(data.id);
      if (!pending) return;
      pendingCallbacks.delete(data.id);
      if (data.ok) {
        pending.resolve(data.result);
      } else {
        pending.reject(new Error(data.error || 'Worker task failed'));
      }
    };
    sharedWorker.onerror = (err) => {
      console.error('ActivityProcessor Worker Error:', err);
    };
  }
  return sharedWorker;
}

function dispatchToWorker<T>(
  request: Omit<ActivityWorkerRequest, 'id'>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = getActivityWorker();
    if (!worker) {
      reject(new Error('Web Workers are not supported in this environment.'));
      return;
    }
    const id = `wk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pendingCallbacks.set(id, { resolve, reject });
    const fullRequest = { ...request, id } as ActivityWorkerRequest;
    worker.postMessage(fullRequest);
  });
}

export type { ComputedStreamAnalytics, WorkerAthleteThresholds };

export const DEFAULT_WORKER_THRESHOLDS: WorkerAthleteThresholds = {
  ftp: 300,
  indoorFtp: 290,
  lthr: 171,
  maxHr: 192,
  restingHr: 48,
  weightKg: 72.5,
};

/**
 * Offloads 1Hz stream analytics (NP, IF, TSS, Banister/Edwards TRIMP, Pw:Hr Decoupling,
 * 7-Zone distribution, Peak Windows, and Interval Detection) to the background Web Worker.
 */
export async function computeStreamAnalyticsInWorker(params: {
  streams: ActivityStreamSet;
  sportCategory: SportCategory;
  thresholds?: WorkerAthleteThresholds;
  existingIntervals?: ActivityInterval[];
}): Promise<ComputedStreamAnalytics> {
  return dispatchToWorker<ComputedStreamAnalytics>({
    type: 'COMPUTE_STREAM_ANALYTICS',
    payload: {
      ...params,
      thresholds: params.thresholds || DEFAULT_WORKER_THRESHOLDS,
    },
  });
}

/**
 * Upsamples coarse or summary-only workout telemetry to 1Hz in the background Web Worker,
 * computes full NP/TSS/TRIMP/Zone analytics, and persists the 1Hz stream to Dexie IndexedDB.
 */
export async function upsampleAndAnalyzeActivityInWorker(
  activity: UnifiedActivity,
  thresholds: WorkerAthleteThresholds = DEFAULT_WORKER_THRESHOLDS
): Promise<{
  streams: ActivityStreamSet;
  analytics: ComputedStreamAnalytics;
}> {
  const res = await dispatchToWorker<{
    streams: ActivityStreamSet;
    analytics: ComputedStreamAnalytics;
  }>({
    type: 'UPSAMPLE_TO_1HZ_STREAM',
    payload: { activity, thresholds },
  });

  await saveActivityStreamToDexie(activity.id, res.streams, res.analytics.intervals);
  return res;
}

/**
 * Parses a user-uploaded .FIT, .GPX, .TCX, or .JSON workout file on the Web Worker thread,
 * computes NP/TSS/TRIMP/Decoupling/Zones, and persists the resulting workout + 1Hz stream to Dexie.
 */
export async function parseWorkoutFileInWorker(
  fileOrText: File | string,
  thresholdsOrFileName?: WorkerAthleteThresholds | string,
  sportCategory?: SportCategory
): Promise<{
  activity: UnifiedActivity;
  analytics: ComputedStreamAnalytics;
}> {
  const isStringInput = typeof fileOrText === 'string';
  const fileName = isStringInput
    ? typeof thresholdsOrFileName === 'string'
      ? thresholdsOrFileName
      : 'workout-1hz.gpx'
    : fileOrText.name;
  const thresholds =
    typeof thresholdsOrFileName === 'object' && thresholdsOrFileName !== null
      ? thresholdsOrFileName
      : DEFAULT_WORKER_THRESHOLDS;

  const isFit = !isStringInput && fileName.toLowerCase().endsWith('.fit');
  const fileBuffer = !isStringInput && isFit ? await fileOrText.arrayBuffer() : undefined;
  const fileText = isStringInput
    ? fileOrText
    : !isFit
      ? await fileOrText.text()
      : undefined;

  const res = await dispatchToWorker<{
    activity: UnifiedActivity;
    analytics: ComputedStreamAnalytics;
  }>({
    type: 'PARSE_WORKOUT_FILE',
    payload: {
      fileName,
      fileText,
      fileBuffer,
      sportCategory,
      thresholds,
    },
  });

  await bulkUpsertActivitiesToDexie([res.activity]);
  return res;
}

/**
 * Generates a realistic 1Hz GPX XML payload with Garmin Power + HR + Cadence TrackPointExtensions
 * for 1-click Web Worker benchmark testing in the UI.
 */
export function buildSample1HzGpxString(
  title = 'Hawk Hill & Coastal Headlands Threshold Repeat (1Hz GPX)',
  durationSecs = 2400,
  ftp = 300
): string {
  const startMs = Date.now() - durationSecs * 1000;
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<gpx creator="Thresh Telemetry Engine" version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">`,
    `  <metadata><time>${new Date(startMs).toISOString()}</time></metadata>`,
    `  <trk>`,
    `    <name>${title}</name>`,
    `    <type>cycling</type>`,
    `    <trkseg>`,
  ];

  let lat = 37.827;
  let lon = -122.4994;

  for (let s = 0; s < durationSecs; s++) {
    const frac = s / durationSecs;
    const isInterval =
      (frac >= 0.15 && frac <= 0.35) ||
      (frac >= 0.45 && frac <= 0.65) ||
      (frac >= 0.72 && frac <= 0.88);
    lat += Math.sin(frac * Math.PI * 3) * 0.000075 + 0.00002;
    lon += Math.cos(frac * Math.PI * 3) * 0.000075 - 0.000015;
    const ele = (65 + Math.sin(frac * Math.PI * 2) * 115 + frac * 70).toFixed(1);
    const watts = Math.round(
      (isInterval ? ftp * 1.03 : ftp * 0.67) + Math.sin(s * 0.35) * 16 + Math.cos(s * 0.11) * 9
    );
    const hr = Math.round((isInterval ? 168 : 138) + frac * 6 + Math.sin(s * 0.12) * 3);
    const cad = Math.round((isInterval ? 94 : 86) + Math.sin(s * 0.2) * 3);
    const iso = new Date(startMs + s * 1000).toISOString();

    lines.push(
      `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${ele}</ele><time>${iso}</time><extensions><power>${watts}</power><gpxtpx:TrackPointExtension><gpxtpx:hr>${hr}</gpxtpx:hr><gpxtpx:cad>${cad}</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>`
    );
  }

  lines.push(`    </trkseg>`, `  </trk>`, `</gpx>`);
  return lines.join('\n');
}
