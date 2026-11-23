import { deflateSync, inflateSync } from 'fflate';
import type {
  DelegatedHandSplitCaptureSummary,
  DelegatedSplitSubmissionEntry,
  DelegatedSplitSubmissionRecord,
  DelegatedTimingRunner,
  DelegatedTimingSessionRecord,
  DelegatedTimingStation,
  PublicDelegatedTimingPassPayload,
  TeamSummaryWithRole,
  UnifiedActivity,
} from '../types';
import {
  OFFICIAL_RACE_EVENTS,
  formatFatTime,
  synthesizeOfficialRaceActivity,
} from './officialRaceSynthesizer';
import { TeamLifecycleApiError, buildThreshSessionHeaders } from './teamLifecycleApi';

export const DELEGATED_TIMING_QUEUE_STORAGE_KEY = 'thresh_delegated_timing_outbox_v1';
export const DELEGATED_PASS_CACHE_PREFIX = 'thresh_delegated_pass_cache_v1:';
const DELEGATED_TIMING_IDB_NAME = 'meetready_delegated_timing_v1';
const DELEGATED_TIMING_IDB_STORE = 'submissions';

const STATION_TO_SHORT_IDX: Record<DelegatedTimingStation, number> = {
  START_FINISH: 0,
  '200M_MARK': 1,
  '100M_MARK': 2,
  RELAY_ZONE: 3,
  CUSTOM: 4,
};

const SHORT_IDX_TO_STATION: DelegatedTimingStation[] = [
  'START_FINISH',
  '200M_MARK',
  '100M_MARK',
  'RELAY_ZONE',
  'CUSTOM',
];

export interface CreateTimingSessionPayload {
  meetTitle: string;
  meetDate: string;
  eventCode: string;
  eventLabel?: string;
  heatLabel?: string;
  stationType: DelegatedTimingStation;
  stationLabel?: string;
  splitPlanLabel?: string;
  targetSplitMeters?: number;
  targetLapCount?: number;
  runners: Array<{
    entryKey?: string;
    membershipId?: string;
    displayName: string;
    hipOrLane?: string;
    targetSplitSecs?: number;
    isWalkOn?: boolean;
  }>;
  assignedMembershipId?: string;
  pin?: string;
  expiresAt?: string;
}

export interface SubmitDelegatedSplitsPayload {
  clientSubmissionId: string;
  capturedByName: string;
  gunStartEpochMs?: number;
  entries: DelegatedSplitSubmissionEntry[];
}

export interface OfflineQueuedDelegatedSubmission {
  clientSubmissionId: string;
  passCode: string;
  pin?: string;
  payload: SubmitDelegatedSplitsPayload;
  queuedAt: string;
  attempts: number;
  lastError?: string;
}

export interface DelegatedSplitHandoffEntry {
  entryKey: string;
  athleteName: string;
  hipOrLane?: string;
  totalSecs: number;
  lapSplitsSecs: number[];
  rawLapTimestampsSecs?: number[];
  isWalkOn?: boolean;
}

export interface DelegatedSplitHandoffPayload {
  version: 1;
  passCode: string;
  meetTitle?: string;
  eventLabel?: string;
  heatLabel?: string;
  stationType: DelegatedTimingStation;
  capturedByName: string;
  clientSubmissionId: string;
  submittedAt: string;
  entries: DelegatedSplitHandoffEntry[];
}

function sanitizeSafeText(raw: unknown, maxLen: number): string {
  return String(raw ?? '')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted]')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
}

function uint8ToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToUint8(token: string): Uint8Array {
  const padded =
    token.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((token.length + 3) % 4);
  if (typeof atob === 'function') {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

async function requestDelegationJson<T>(
  url: string,
  init: RequestInit
): Promise<T & { ok?: boolean; error?: string }> {
  const resp = await fetch(url, {
    credentials: 'include',
    headers: buildThreshSessionHeaders(),
    ...init,
  });
  const data = (await resp.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!resp.ok || data?.ok === false) {
    throw new TeamLifecycleApiError(data?.error || `Request failed (${resp.status}).`, resp.status);
  }
  return data;
}

export function createTimingSessionApi(teamId: string, payload: CreateTimingSessionPayload) {
  return requestDelegationJson<{
    session: DelegatedTimingSessionRecord;
    passUrl: string;
    team?: TeamSummaryWithRole;
    teams?: TeamSummaryWithRole[];
  }>(`/api/teams/${encodeURIComponent(teamId)}/timing-sessions`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function revokeTimingSessionApi(teamId: string, sessionId: string) {
  return requestDelegationJson<{
    team?: TeamSummaryWithRole;
    teams?: TeamSummaryWithRole[];
  }>(
    `/api/teams/${encodeURIComponent(teamId)}/timing-sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' }
  );
}

export async function fetchPublicTimingPassApi(
  passCode: string,
  pin?: string
): Promise<PublicDelegatedTimingPassPayload & { error?: string; httpStatus?: number; retryAfterSecs?: number }> {
  const cleanCode = sanitizeSafeText(passCode, 24).toUpperCase();
  const headers: Record<string, string> = {};
  if (pin && pin.trim()) {
    headers['x-timing-pin'] = pin.trim();
  }
  const resp = await fetch(
    `/api/teams/public/timing-pass/${encodeURIComponent(cleanCode)}`,
    {
      method: 'GET',
      credentials: 'omit',
      headers,
    }
  );
  const data = (await resp.json().catch(() => ({ found: false }))) as PublicDelegatedTimingPassPayload & {
    error?: string;
    retryAfterSecs?: number;
  };
  return {
    ...data,
    httpStatus: resp.status,
  };
}

export async function submitDelegatedSplitsApi(
  passCode: string,
  payload: SubmitDelegatedSplitsPayload,
  pin?: string
): Promise<{
  ok: boolean;
  deduplicated: boolean;
  submission: DelegatedSplitSubmissionRecord;
  team?: TeamSummaryWithRole;
  teams?: TeamSummaryWithRole[];
}> {
  const cleanCode = sanitizeSafeText(passCode, 24).toUpperCase();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (pin && pin.trim()) {
    headers['x-timing-pin'] = pin.trim();
  }
  const resp = await fetch(
    `/api/teams/public/timing-pass/${encodeURIComponent(cleanCode)}/submissions`,
    {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ ...payload, ...(pin ? { pin: pin.trim() } : {}) }),
    }
  );
  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    deduplicated?: boolean;
    submission?: DelegatedSplitSubmissionRecord;
    team?: TeamSummaryWithRole;
    teams?: TeamSummaryWithRole[];
    error?: string;
  };
  if (!resp.ok || data?.ok === false || !data.submission) {
    throw new TeamLifecycleApiError(data?.error || `Submit failed (${resp.status}).`, resp.status);
  }
  return {
    ok: true,
    deduplicated: Boolean(data.deduplicated),
    submission: data.submission,
    ...(data.team ? { team: data.team } : {}),
    ...(data.teams ? { teams: data.teams } : {}),
  };
}

export function reviewDelegatedSubmissionApi(
  teamId: string,
  submissionId: string,
  action: 'APPROVE' | 'ARCHIVE_BACKUP' | 'DISCARD'
) {
  return requestDelegationJson<{
    submission: DelegatedSplitSubmissionRecord;
    team?: TeamSummaryWithRole;
    teams?: TeamSummaryWithRole[];
  }>(
    `/api/teams/${encodeURIComponent(teamId)}/timing-submissions/${encodeURIComponent(submissionId)}/review`,
    {
      method: 'POST',
      body: JSON.stringify({ action }),
    }
  );
}

// ----------------------------------------------------------------------------
// Offline LocalStorage + IndexedDB Staging Queue
// ----------------------------------------------------------------------------

function readLocalQueue(): OfflineQueuedDelegatedSubmission[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(DELEGATED_TIMING_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is OfflineQueuedDelegatedSubmission =>
        Boolean(item && typeof item.clientSubmissionId === 'string' && typeof item.passCode === 'string')
    );
  } catch {
    return [];
  }
}

function writeLocalQueue(items: OfflineQueuedDelegatedSubmission[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (items.length === 0) {
      localStorage.removeItem(DELEGATED_TIMING_QUEUE_STORAGE_KEY);
    } else {
      localStorage.setItem(DELEGATED_TIMING_QUEUE_STORAGE_KEY, JSON.stringify(items.slice(0, 60)));
    }
  } catch {
    // ignore quota errors
  }
}

function openDelegatedIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DELEGATED_TIMING_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DELEGATED_TIMING_IDB_STORE)) {
          db.createObjectStore(DELEGATED_TIMING_IDB_STORE, { keyPath: 'clientSubmissionId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function putIdbQueueItem(item: OfflineQueuedDelegatedSubmission): Promise<void> {
  const db = await openDelegatedIdb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(DELEGATED_TIMING_IDB_STORE, 'readwrite');
      tx.objectStore(DELEGATED_TIMING_IDB_STORE).put(item);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

async function deleteIdbQueueItem(clientSubmissionId: string): Promise<void> {
  const db = await openDelegatedIdb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(DELEGATED_TIMING_IDB_STORE, 'readwrite');
      tx.objectStore(DELEGATED_TIMING_IDB_STORE).delete(clientSubmissionId);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

async function listIdbQueueItems(): Promise<OfflineQueuedDelegatedSubmission[]> {
  const db = await openDelegatedIdb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DELEGATED_TIMING_IDB_STORE, 'readonly');
      const req = tx.objectStore(DELEGATED_TIMING_IDB_STORE).getAll();
      req.onsuccess = () => {
        db.close();
        resolve(Array.isArray(req.result) ? req.result : []);
      };
      req.onerror = () => {
        db.close();
        resolve([]);
      };
    } catch {
      db.close();
      resolve([]);
    }
  });
}

export function loadOfflineDelegatedSubmissions(passCode?: string): OfflineQueuedDelegatedSubmission[] {
  const cleanCode = passCode ? passCode.trim().toUpperCase() : '';
  return readLocalQueue().filter((item) => !cleanCode || item.passCode.toUpperCase() === cleanCode);
}

export async function loadOfflineDelegatedSubmissionsAsync(
  passCode?: string
): Promise<OfflineQueuedDelegatedSubmission[]> {
  const local = readLocalQueue();
  const idb = await listIdbQueueItems();
  const byId = new Map<string, OfflineQueuedDelegatedSubmission>();
  for (const item of [...idb, ...local]) {
    if (item?.clientSubmissionId) {
      byId.set(item.clientSubmissionId, item);
    }
  }
  const merged = Array.from(byId.values());
  const cleanCode = passCode ? passCode.trim().toUpperCase() : '';
  return merged.filter((item) => !cleanCode || item.passCode.toUpperCase() === cleanCode);
}

export function enqueueOfflineDelegatedSubmission(
  item: OfflineQueuedDelegatedSubmission
): OfflineQueuedDelegatedSubmission[] {
  const existing = readLocalQueue().filter(
    (q) => q.clientSubmissionId !== item.clientSubmissionId
  );
  const next = [item, ...existing].slice(0, 60);
  writeLocalQueue(next);
  void putIdbQueueItem(item);
  return next;
}

export function removeOfflineDelegatedSubmission(clientSubmissionId: string): void {
  const remaining = readLocalQueue().filter(
    (item) => item.clientSubmissionId !== clientSubmissionId
  );
  writeLocalQueue(remaining);
  void deleteIdbQueueItem(clientSubmissionId);
}

export async function flushOfflineDelegatedSubmissions(passCode?: string): Promise<{
  flushedCount: number;
  remainingCount: number;
}> {
  const allQueued = await loadOfflineDelegatedSubmissionsAsync();
  const cleanCode = passCode ? passCode.trim().toUpperCase() : '';
  const targets = allQueued.filter(
    (item) => !cleanCode || item.passCode.toUpperCase() === cleanCode
  );
  if (targets.length === 0) {
    return { flushedCount: 0, remainingCount: allQueued.length };
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { flushedCount: 0, remainingCount: targets.length };
  }

  let flushedCount = 0;
  for (const item of targets) {
    try {
      await submitDelegatedSplitsApi(item.passCode, item.payload, item.pin);
      removeOfflineDelegatedSubmission(item.clientSubmissionId);
      flushedCount += 1;
    } catch (err) {
      const status = err instanceof TeamLifecycleApiError ? err.status : 0;
      if (status === 400 || status === 404 || status === 410) {
        removeOfflineDelegatedSubmission(item.clientSubmissionId);
      } else {
        const updated: OfflineQueuedDelegatedSubmission = {
          ...item,
          attempts: (item.attempts || 0) + 1,
          lastError: err instanceof Error ? err.message : 'Sync failed',
        };
        enqueueOfflineDelegatedSubmission(updated);
      }
    }
  }
  const remaining = loadOfflineDelegatedSubmissions(passCode);
  return { flushedCount, remainingCount: remaining.length };
}

export function cachePublicTimingPassLocally(
  passCode: string,
  payload: PublicDelegatedTimingPassPayload
): void {
  if (typeof localStorage === 'undefined' || !payload.found || !payload.session) return;
  try {
    localStorage.setItem(
      `${DELEGATED_PASS_CACHE_PREFIX}${passCode.trim().toUpperCase()}`,
      JSON.stringify(payload)
    );
  } catch {
    // ignore quota errors
  }
}

export function readCachedPublicTimingPass(
  passCode: string
): PublicDelegatedTimingPassPayload | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(
      `${DELEGATED_PASS_CACHE_PREFIX}${passCode.trim().toUpperCase()}`
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PublicDelegatedTimingPassPayload;
    if (!parsed?.found || !parsed?.session) return null;
    if (parsed.session.expiresAt && Date.parse(parsed.session.expiresAt) < Date.now()) {
      return { found: true, expiredOrRevoked: true, teamShortName: parsed.teamShortName };
    }
    return parsed;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Compact QR / Text Split Handoff Codec (MRDS1:<deflate+base64url>)
// ----------------------------------------------------------------------------

type CompactEntryTuple = [
  entryKey: string,
  athleteName: string,
  totalCs: number,
  splitsCs: number[],
  hipOrLane?: string,
  isWalkOn?: 0 | 1,
];

type CompactHandoffTuple = [
  version: 1,
  passCode: string,
  stationIdx: number,
  capturedByName: string,
  clientSubmissionId: string,
  submittedAtEpochSec: number,
  entries: CompactEntryTuple[],
  meetTitle?: string,
  eventLabel?: string,
  heatLabel?: string,
];

export function encodeDelegatedSplitHandoffPayload(payload: DelegatedSplitHandoffPayload): string {
  const cleanCode = sanitizeSafeText(payload.passCode, 24).toUpperCase();
  const stationIdx = STATION_TO_SHORT_IDX[payload.stationType] ?? 0;
  const capturedBy = sanitizeSafeText(payload.capturedByName || 'Timer', 48);
  const subId = sanitizeSafeText(
    payload.clientSubmissionId || `dsub_${Date.now()}`,
    64
  );
  const parsedSubMs = Date.parse(payload.submittedAt || '');
  const subEpochSec = Number.isFinite(parsedSubMs)
    ? Math.round(parsedSubMs / 1000)
    : Math.round(Date.now() / 1000);

  const entries: CompactEntryTuple[] = (payload.entries || [])
    .slice(0, 32)
    .filter((e) => e && Number.isFinite(e.totalSecs) && e.totalSecs > 0)
    .map((e) => {
      const tuple: CompactEntryTuple = [
        sanitizeSafeText(e.entryKey, 48),
        sanitizeSafeText(e.athleteName, 48),
        Math.round(e.totalSecs * 100),
        (e.lapSplitsSecs || [])
          .slice(0, 64)
          .filter((s) => Number.isFinite(s) && s > 0)
          .map((s) => Math.round(s * 100)),
      ];
      const hip = sanitizeSafeText(e.hipOrLane, 10);
      if (hip || e.isWalkOn) {
        tuple.push(hip || '');
      }
      if (e.isWalkOn) {
        tuple.push(1);
      }
      return tuple;
    });

  const optionalMeta: string[] = [
    sanitizeSafeText(payload.meetTitle, 64),
    sanitizeSafeText(payload.eventLabel, 32),
    sanitizeSafeText(payload.heatLabel, 32),
  ];
  while (optionalMeta.length > 0 && !optionalMeta[optionalMeta.length - 1]) {
    optionalMeta.pop();
  }

  const packed: CompactHandoffTuple = [
    1,
    cleanCode,
    stationIdx,
    capturedBy,
    subId,
    subEpochSec,
    entries,
    ...(optionalMeta as [string?, string?, string?]),
  ] as CompactHandoffTuple;

  const jsonBytes = new TextEncoder().encode(JSON.stringify(packed));
  const compressed = deflateSync(jsonBytes, { level: 9 });
  return `MRDS1:${uint8ToBase64Url(compressed)}`;
}

function reconstructCumulativeTimestamps(lapSplitsSecs: number[]): number[] {
  const out: number[] = [];
  let sum = 0;
  for (const s of lapSplitsSecs) {
    sum += s;
    out.push(Number(sum.toFixed(2)));
  }
  return out;
}

function sanitizeDecodedHandoffObject(raw: unknown): DelegatedSplitHandoffPayload | null {
  if (!raw || typeof raw !== 'object') return null;

  if (Array.isArray(raw)) {
    const arr = raw as unknown[];
    if (arr[0] !== 1 || typeof arr[1] !== 'string' || !Array.isArray(arr[6])) return null;
    const passCode = sanitizeSafeText(arr[1], 24).toUpperCase();
    const stationIdx = Number(arr[2]);
    const stationType = SHORT_IDX_TO_STATION[stationIdx] || 'START_FINISH';
    const capturedByName = sanitizeSafeText(arr[3] || 'Timer', 48) || 'Timer';
    const clientSubmissionId = sanitizeSafeText(arr[4], 64) || `dsub_${Date.now()}`;
    const subSec = Number(arr[5]);
    const submittedAt = Number.isFinite(subSec) && subSec > 0
      ? new Date(subSec * 1000).toISOString()
      : new Date().toISOString();
    const entriesRaw = arr[6] as unknown[];
    const entries: DelegatedSplitHandoffEntry[] = [];
    for (const item of entriesRaw.slice(0, 32)) {
      if (!Array.isArray(item) || item.length < 4) continue;
      const entryKey = sanitizeSafeText(item[0], 48);
      const athleteName = sanitizeSafeText(item[1], 48);
      const totalCs = Number(item[2]);
      if (!entryKey || !athleteName || !Number.isFinite(totalCs) || totalCs <= 0) continue;
      const splitsCs = Array.isArray(item[3]) ? item[3] : [];
      const lapSplitsSecs = splitsCs
        .slice(0, 64)
        .map((n) => Number(n) / 100)
        .filter((n) => Number.isFinite(n) && n > 0 && n <= 86400)
        .map((n) => Number(n.toFixed(2)));
      const totalSecs = Number((totalCs / 100).toFixed(2));
      const finalSplits = lapSplitsSecs.length > 0 ? lapSplitsSecs : [totalSecs];
      const hipOrLane = typeof item[4] === 'string' && item[4] ? sanitizeSafeText(item[4], 10) : undefined;
      const isWalkOn = item[5] === 1;
      entries.push({
        entryKey,
        athleteName,
        ...(hipOrLane ? { hipOrLane } : {}),
        totalSecs,
        lapSplitsSecs: finalSplits,
        rawLapTimestampsSecs: reconstructCumulativeTimestamps(finalSplits),
        ...(isWalkOn ? { isWalkOn: true } : {}),
      });
    }
    if (!passCode || entries.length === 0) return null;
    const meetTitle = typeof arr[7] === 'string' && arr[7] ? sanitizeSafeText(arr[7], 64) : undefined;
    const eventLabel = typeof arr[8] === 'string' && arr[8] ? sanitizeSafeText(arr[8], 32) : undefined;
    const heatLabel = typeof arr[9] === 'string' && arr[9] ? sanitizeSafeText(arr[9], 32) : undefined;
    return {
      version: 1,
      passCode,
      ...(meetTitle ? { meetTitle } : {}),
      ...(eventLabel ? { eventLabel } : {}),
      ...(heatLabel ? { heatLabel } : {}),
      stationType,
      capturedByName,
      clientSubmissionId,
      submittedAt,
      entries,
    };
  }

  const obj = raw as Record<string, unknown>;
  const passCode = sanitizeSafeText(obj.passCode, 24).toUpperCase();
  if (!passCode || !Array.isArray(obj.entries)) return null;
  const stationRaw = String(obj.stationType || 'START_FINISH').toUpperCase() as DelegatedTimingStation;
  const stationType = stationRaw in STATION_TO_SHORT_IDX ? stationRaw : 'START_FINISH';
  const entries: DelegatedSplitHandoffEntry[] = [];
  for (const rawEntry of obj.entries.slice(0, 32)) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue;
    const rec = rawEntry as Record<string, unknown>;
    const entryKey = sanitizeSafeText(rec.entryKey, 48);
    const athleteName = sanitizeSafeText(rec.athleteName, 48);
    const totalSecs = Number(rec.totalSecs);
    if (!entryKey || !athleteName || !Number.isFinite(totalSecs) || totalSecs <= 0) continue;
    const lapSplitsSecs = Array.isArray(rec.lapSplitsSecs)
      ? rec.lapSplitsSecs
          .slice(0, 64)
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && n > 0 && n <= 86400)
          .map((n) => Number(n.toFixed(2)))
      : [Number(totalSecs.toFixed(2))];
    const finalSplits = lapSplitsSecs.length > 0 ? lapSplitsSecs : [Number(totalSecs.toFixed(2))];
    entries.push({
      entryKey,
      athleteName,
      ...(typeof rec.hipOrLane === 'string' && rec.hipOrLane
        ? { hipOrLane: sanitizeSafeText(rec.hipOrLane, 10) }
        : {}),
      totalSecs: Number(totalSecs.toFixed(2)),
      lapSplitsSecs: finalSplits,
      rawLapTimestampsSecs: reconstructCumulativeTimestamps(finalSplits),
      ...(rec.isWalkOn ? { isWalkOn: true } : {}),
    });
  }
  if (entries.length === 0) return null;
  return {
    version: 1,
    passCode,
    ...(typeof obj.meetTitle === 'string' && obj.meetTitle
      ? { meetTitle: sanitizeSafeText(obj.meetTitle, 64) }
      : {}),
    ...(typeof obj.eventLabel === 'string' && obj.eventLabel
      ? { eventLabel: sanitizeSafeText(obj.eventLabel, 32) }
      : {}),
    ...(typeof obj.heatLabel === 'string' && obj.heatLabel
      ? { heatLabel: sanitizeSafeText(obj.heatLabel, 32) }
      : {}),
    stationType,
    capturedByName: sanitizeSafeText(obj.capturedByName || 'Timer', 48) || 'Timer',
    clientSubmissionId: sanitizeSafeText(obj.clientSubmissionId, 64) || `dsub_${Date.now()}`,
    submittedAt:
      typeof obj.submittedAt === 'string' && Number.isFinite(Date.parse(obj.submittedAt))
        ? obj.submittedAt
        : new Date().toISOString(),
    entries,
  };
}

export function decodeDelegatedSplitHandoffPayload(
  raw: string | null | undefined
): DelegatedSplitHandoffPayload | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    let trimmed = raw.trim();
    if (!trimmed || trimmed.length > 16000) return null;
    if (/^https?:\/\//i.test(trimmed) || trimmed.includes('handoff=')) {
      const idx = trimmed.indexOf('handoff=');
      if (idx >= 0) {
        const after = trimmed.slice(idx + 'handoff='.length).split('&')[0];
        trimmed = decodeURIComponent(after);
      }
    }
    if (trimmed.startsWith('MRDS1:')) {
      const token = trimmed.slice('MRDS1:'.length).trim();
      const compressed = base64UrlToUint8(token);
      const decompressed = inflateSync(compressed);
      const jsonStr = new TextDecoder().decode(decompressed);
      return sanitizeDecodedHandoffObject(JSON.parse(jsonStr));
    }
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return sanitizeDecodedHandoffObject(JSON.parse(trimmed));
    }
    return null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Sample Demo Mode Helpers (Offline-First Local Coach Delegation Simulation)
// ----------------------------------------------------------------------------

export function isLocalDemoTeam(team?: TeamSummaryWithRole | null): boolean {
  const id = team?.brand?.teamId || '';
  return id.startsWith('demo_team_') || id.startsWith('demo-team-');
}

export function buildLocalDemoTimingSession(
  team: TeamSummaryWithRole,
  input: CreateTimingSessionPayload
): { session: DelegatedTimingSessionRecord; updatedTeam: TeamSummaryWithRole } {
  const eventDef = OFFICIAL_RACE_EVENTS.find(
    (e) => e.label.toLowerCase() === input.eventCode.trim().toLowerCase()
  );
  const targetSplitMeters = input.targetSplitMeters || eventDef?.defaultSplitMeters || 400;
  const targetLapCount = input.targetLapCount || eventDef?.defaultLapCount || 4;
  const code = `DEMO${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const assignee = input.assignedMembershipId
    ? team.memberships.find((m) => m.membershipId === input.assignedMembershipId)
    : undefined;

  const runners: DelegatedTimingRunner[] = (input.runners || []).map((r, idx) => ({
    entryKey: r.entryKey || `r_${idx + 1}`,
    ...(r.membershipId ? { membershipId: r.membershipId } : {}),
    displayName: r.displayName,
    ...(r.hipOrLane ? { hipOrLane: r.hipOrLane } : {}),
    ...(typeof r.targetSplitSecs === 'number' ? { targetSplitSecs: r.targetSplitSecs } : {}),
    ...(r.isWalkOn ? { isWalkOn: true } : {}),
  }));

  const session: DelegatedTimingSessionRecord = {
    sessionId: `dts_demo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    teamId: team.brand.teamId,
    passCode: code,
    meetTitle: input.meetTitle || 'Track Meet',
    meetDate: input.meetDate || new Date().toISOString().slice(0, 10),
    eventCode: input.eventCode || '1600m',
    eventLabel: input.eventLabel || input.eventCode || '1600m',
    ...(input.heatLabel ? { heatLabel: input.heatLabel } : {}),
    stationType: input.stationType,
    stationLabel: input.stationLabel || input.stationType,
    splitPlanLabel: input.splitPlanLabel || `${targetLapCount} × ${targetSplitMeters}m`,
    targetSplitMeters,
    targetLapCount,
    runners,
    ...(assignee
      ? {
          assignedMembershipId: assignee.membershipId,
          assignedDelegateName: assignee.invitedName,
        }
      : {}),
    createdBySid: 'demo-coach',
    createdByName: team.brand.coachDisplayName || 'Coach',
    expiresAt: input.expiresAt || new Date(Date.now() + 12 * 3600_000).toISOString(),
    pinRequired: Boolean(input.pin && /^\d{4}$/.test(input.pin.trim())),
    createdAt: new Date().toISOString(),
  };

  const updatedTeam: TeamSummaryWithRole = {
    ...team,
    delegatedTimingSessions: [session, ...(team.delegatedTimingSessions || [])],
  };
  return { session, updatedTeam };
}

export function applyLocalDemoSubmissionReview(
  team: TeamSummaryWithRole,
  submissionId: string,
  action: 'APPROVE' | 'ARCHIVE_BACKUP' | 'DISCARD'
): TeamSummaryWithRole {
  const statusMap = {
    APPROVE: 'APPROVED',
    ARCHIVE_BACKUP: 'BACKUP_ARCHIVED',
    DISCARD: 'DISCARDED',
  } as const;
  const nextStatus = statusMap[action];
  const nowIso = new Date().toISOString();
  const target = (team.pendingTimingSubmissions || []).find(
    (s) => s.submissionId === submissionId
  );
  if (!target) return team;

  const updatedSubmissions = (team.pendingTimingSubmissions || []).map((s) =>
    s.submissionId === submissionId
      ? {
          ...s,
          reviewStatus: nextStatus,
          reviewedAt: nowIso,
          reviewedByName: team.brand.coachDisplayName || 'Coach',
        }
      : s
  );

  if (action !== 'APPROVE') {
    return { ...team, pendingTimingSubmissions: updatedSubmissions };
  }

  const nextMemberships = team.memberships.map((mem) => {
    const entry = target.entries.find((e) => e.membershipId === mem.membershipId);
    if (!entry) return mem;
    const capture: DelegatedHandSplitCaptureSummary = {
      submissionId: target.submissionId,
      capturedByName: target.capturedByName,
      stationType: target.stationType,
      totalSecs: entry.totalSecs,
      lapSplitsSecs: entry.lapSplitsSecs,
      capturedAt: target.submittedAt,
    };
    const prevRecorded = mem.coachRecordedActivities || [];
    const existingIdx = prevRecorded.findIndex(
      (a) =>
        a.officialRaceData &&
        String(a.startDateLocal || '').slice(0, 10) === target.meetDate &&
        a.officialRaceData.meetName.toLowerCase() === target.meetTitle.toLowerCase() &&
        a.officialRaceData.eventLabel.toLowerCase() === target.eventLabel.toLowerCase()
    );
    let nextRecorded: UnifiedActivity[];
    if (existingIdx >= 0) {
      const ex = prevRecorded[existingIdx];
      const prevCaps = ex.officialRaceData?.handSplitCaptures || [];
      const nextCaps = prevCaps.some((c) => c.submissionId === capture.submissionId)
        ? prevCaps
        : [...prevCaps, capture];
      const nextBadges = ex.sourceBadges.includes('Delegated Hand-Timed')
        ? ex.sourceBadges
        : [...ex.sourceBadges, 'Delegated Hand-Timed' as const];
      const updatedAct: UnifiedActivity = {
        ...ex,
        sourceBadges: nextBadges,
        officialRaceData: {
          ...ex.officialRaceData!,
          handSplitCaptures: nextCaps,
        },
      };
      nextRecorded = prevRecorded.map((a, i) => (i === existingIdx ? updatedAct : a));
    } else {
      const eventDef = OFFICIAL_RACE_EVENTS.find(
        (e) => e.label.toLowerCase() === target.eventLabel.toLowerCase()
      );
      const baseRace = synthesizeOfficialRaceActivity({
        id: `stopwatch-delegated-race-${target.submissionId}-${mem.membershipId}`,
        date: target.meetDate,
        startDateLocalIso: `${target.meetDate}T10:30:00`,
        meetName: target.meetTitle,
        eventLabel: target.eventLabel,
        eventDistanceMeters: eventDef?.distanceMeters || 1600,
        fatTimeSecs: entry.totalSecs,
        displayFatTime: formatFatTime(entry.totalSecs),
        platform: 'MeetReady Stopwatch',
        trackType: target.eventLabel === 'XC 5K' ? 'XC_COURSE' : 'OUTDOOR_400M',
        lapSplitDistanceMeters: eventDef?.defaultSplitMeters || 400,
        lapSplitsSecs: entry.lapSplitsSecs,
        includeWarmupCooldown: false,
      });
      const created: UnifiedActivity = {
        ...baseRace,
        name: `${target.eventLabel} Hand-Timed (${formatFatTime(entry.totalSecs)}) — ${target.meetTitle}`,
        sourceBadges: ['Delegated Hand-Timed'],
        officialRaceData: {
          ...baseRace.officialRaceData!,
          platform: 'MeetReady Stopwatch',
          timingMethod: 'HAND',
          handTimedTotalSecs: entry.totalSecs,
          capturedByName: target.capturedByName,
          timingStation: target.stationType,
          handSplitCaptures: [capture],
        },
      };
      nextRecorded = [created, ...prevRecorded];
    }
    return { ...mem, coachRecordedActivities: nextRecorded };
  });

  return {
    ...team,
    memberships: nextMemberships,
    pendingTimingSubmissions: updatedSubmissions,
  };
}
