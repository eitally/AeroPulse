import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeGearClosetSummaries,
  computeGearWearSummary,
  doesActivityMatchGear,
  getDefaultMaxRecommendedMeters,
  setPrimaryGearItem,
  toggleRetireGearItem,
  upsertGearItem,
} from '../src/utils/gearClosetUtils';
import { ShoeSpikeClosetSection } from '../src/components/goals/ShoeSpikeClosetSection';
import {
  buildCopiedWeekBatchItems,
  buildReschedulePlannedEventPatch,
  normalizeToMondayIso,
  resolveDefaultCopyTargetMondayIso,
  shiftIsoDate,
} from '../src/components/calendar/calendarDragAndWeekCopyUtils';
import { CalendarCopyWeekPopover } from '../src/components/calendar/CalendarCopyWeekPopover';
import {
  MAX_OUTBOX_ATTEMPTS,
  dismissDeadLetterStopwatchBatch,
  enqueueStopwatchOutboxBatch,
  flushStopwatchOutbox,
  listDeadLetterStopwatchBatches,
  loadStopwatchOutbox,
  persistCoachStopwatchActivitiesToServer,
} from '../src/utils/stopwatchTeamSync';
import { STORAGE_KEYS } from '../src/utils/storageKeys';
import { sanitizeAthleteCloudState } from '../server/routers/athleteStateRouter';
import { buildSampleDemoCoachSquad, buildSampleDemoGearItems } from '../src/data/sampleDemoData';
import type { AthleteGearItem, PlannedWorkoutEvent, UnifiedActivity } from '../src/types';

const ROOT = process.cwd();

function readRel(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function makeActivity(overrides: Partial<UnifiedActivity> = {}): UnifiedActivity {
  return {
    id: 'act-gear-1',
    name: 'Track Threshold Session',
    sportCategory: 'Running',
    subType: 'Track',
    environment: 'OUTDOOR',
    startDateLocal: '2026-11-18T15:30:00',
    movingTimeSecs: 2400,
    distanceMeters: 8046.72, // 5 miles
    elevationGainMeters: 10,
    trainingLoad: 64,
    avgHr: 162,
    maxHr: 180,
    efficiencyFactor: 1.5,
    firstHalfEf: 1.51,
    secondHalfEf: 1.49,
    aerobicDecouplingPct: 1.3,
    intensityFactor: 0.88,
    variabilityIndex: 1.02,
    stravaPrCount: 0,
    segmentEfforts: [],
    sourceBadges: ['Strava'],
    zoneSecs: { hr: [300, 1200, 600, 300, 0, 0, 0] },
    ...overrides,
  };
}

describe('Sprint 1 Track 1C: Shoe & Spike Closet, Calendar DnD/Copy, Sync Reliability & Docs', () => {
  const origLocalStorage = globalThis.localStorage;
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (origLocalStorage) {
      vi.stubGlobal('localStorage', origLocalStorage);
    }
    if (origFetch) {
      vi.stubGlobal('fetch', origFetch);
    }
  });

  it('computes Shoe & Spike Closet wear thresholds, matches gearId & case-insensitive gearName, and renders Active/Retired tabs', () => {
    expect(Math.round(getDefaultMaxRecommendedMeters('SHOE', 'DAILY_TRAINER') / 1609.344)).toBe(450);
    expect(Math.round(getDefaultMaxRecommendedMeters('SHOE', 'LIGHTWEIGHT_FLAT_SUPER_TRAINER') / 1609.344)).toBe(300);
    expect(Math.round(getDefaultMaxRecommendedMeters('SHOE', 'CARBON_ROAD_RACER') / 1609.344)).toBe(175);
    expect(Math.round(getDefaultMaxRecommendedMeters('SHOE', 'TRADITIONAL_TRACK_SPIKE') / 1609.344)).toBe(120);
    expect(Math.round(getDefaultMaxRecommendedMeters('SHOE', 'CARBON_SUPER_SPIKE') / 1609.344)).toBe(80);

    const spike: AthleteGearItem = {
      id: 'spike-df2',
      name: 'Dragonfly 2 Elite',
      brand: 'Nike',
      type: 'SHOE',
      footwearClass: 'CARBON_SUPER_SPIKE',
      distanceMeters: Math.round(64 * 1609.344), // 80% base
      maxRecommendedMeters: getDefaultMaxRecommendedMeters('SHOE', 'CARBON_SUPER_SPIKE'), // 80 mi
      primary: false,
    };
    const trainer: AthleteGearItem = {
      id: 'peg-41',
      name: 'Pegasus 41',
      brand: 'Nike',
      type: 'SHOE',
      footwearClass: 'DAILY_TRAINER',
      distanceMeters: Math.round(448 * 1609.344),
      maxRecommendedMeters: getDefaultMaxRecommendedMeters('SHOE', 'DAILY_TRAINER'), // 450 mi
      primary: true,
    };

    const actByName = makeActivity({ id: 'a1', gearName: 'nike dragonfly 2 elite', distanceMeters: Math.round(6 * 1609.344) }); // +6 mi => 70/80 = 88%
    const actById = makeActivity({ id: 'a2', gearId: 'peg-41', distanceMeters: Math.round(5 * 1609.344) }); // +5 mi => 453/450 = 101%

    expect(doesActivityMatchGear(actByName, spike)).toBe(true);
    expect(doesActivityMatchGear(actById, trainer)).toBe(true);
    expect(doesActivityMatchGear(actByName, trainer)).toBe(false);

    const spikeWear = computeGearWearSummary(spike, [actByName, actById]);
    expect(spikeWear.status).toBe('APPROACHING_RETIREMENT');
    expect(spikeWear.statusLabel).toBe('Approaching Retirement');
    expect(spikeWear.wearPct).toBeGreaterThanOrEqual(85);

    const trainerWear = computeGearWearSummary(trainer, [actByName, actById]);
    expect(trainerWear.status).toBe('REPLACE_SOON');
    expect(trainerWear.statusLabel).toBe('Replace Soon');
    expect(trainerWear.wearPct).toBeGreaterThanOrEqual(100);

    const retiredList = toggleRetireGearItem([trainer, spike], 'peg-41', '2026-11-22');
    expect(retiredList.find((g) => g.id === 'peg-41')?.retired).toBe(true);
    expect(retiredList.find((g) => g.id === 'peg-41')?.primary).toBe(false);

    const withPrimary = setPrimaryGearItem(retiredList, 'spike-df2');
    expect(withPrimary.find((g) => g.id === 'spike-df2')?.primary).toBe(true);
    expect(upsertGearItem(withPrimary, { ...trainer, retired: false, primary: true }).find((g) => g.id === 'spike-df2')?.primary).toBe(false);

    const demoGear = buildSampleDemoGearItems('2026-04-12');
    expect(demoGear.some((g) => !g.retired && g.footwearClass === 'CARBON_SUPER_SPIKE')).toBe(true);
    expect(demoGear.some((g) => g.retired)).toBe(true);
    expect(buildSampleDemoCoachSquad('2026-04-12').fieldMarkLogs?.map((f) => f.eventCode)).toEqual([
      'LJ',
      'HJ',
      'PV',
      'SP',
    ]);

    const summaries = computeGearClosetSummaries(demoGear, [actByName]);
    expect(summaries[0].item.primary).toBe(true);

    const html = renderToStaticMarkup(
      React.createElement(ShoeSpikeClosetSection, {
        gearItems: demoGear,
        activities: [actByName],
        distanceUnit: 'mi',
        onSaveGearItems: () => {},
      })
    );
    expect(html).toContain('Shoe &amp; Spike Closet');
    expect(html).toContain('Active (3)');
    expect(html).toContain('Retired (1)');
    expect(html).toContain('Approaching Retirement');
    expect(html).toContain('Dragonfly 2 Elite');
  });

  it('sanitizes gearItems up to 40 items in athleteStateRouter and clears Dexie gearItems before bulkPut', () => {
    const oversized = Array.from({ length: 45 }, (_, idx) => ({
      id: `g-${idx}`,
      name: `Shoe ${idx}`,
      type: 'SHOE' as const,
      distanceMeters: 1000 * idx,
      maxRecommendedMeters: 724205,
      primary: idx === 0,
      footwearClass: 'DAILY_TRAINER' as const,
    }));

    const sanitized = sanitizeAthleteCloudState({ gearItems: oversized });
    expect(sanitized.gearItems).toHaveLength(40);

    const cleared = sanitizeAthleteCloudState({ gearItems: [] }, sanitized);
    expect(cleared.gearItems).toEqual([]);

    const telemetryFacadeSrc = readRel('src/utils/telemetryStorage.ts');
    expect(telemetryFacadeSrc).toContain('./telemetryStorage/snapshotStore');
    const snapshotStoreSrc = readRel('src/utils/telemetryStorage/snapshotStore.ts');
    expect(snapshotStoreSrc).toContain('export async function replaceGearItemsInStore');
    expect(snapshotStoreSrc).toMatch(/if\s*\(Array\.isArray\(snapshot\.gearItems\)\)\s*\{\s*await db\.gearItems\.clear\(\)/);
  });

  it('computes calendar drag patches and week copies accurately across Mondays and renders Copy Week popover', () => {
    expect(normalizeToMondayIso('2026-11-18')).toBe('2026-11-16'); // Wednesday -> Monday
    expect(resolveDefaultCopyTargetMondayIso('2026-11-18')).toBe('2026-11-23');
    expect(shiftIsoDate('2026-11-23', 6)).toBe('2026-11-29');

    const monEvent: PlannedWorkoutEvent = {
      id: 'bw_101',
      date: '2026-11-16',
      name: '6x400m Track Rhythm',
      sportCategory: 'Running',
      environmentPreference: 'OUTDOOR',
      description: 'Controlled 400m reps at mile rhythm.',
      plannedLoad: 72,
      plannedDurationSecs: 3200,
      targetZoneSummary: 'Z5',
      workoutSyntax: '- 6x400m 105% Pace',
      scheduledTime: '15:30',
      sessionSlot: 'PM',
      locationName: 'Main Track',
      locationCategory: 'TRACK',
    };

    const moved = buildReschedulePlannedEventPatch(monEvent, '2026-11-19');
    expect(moved.date).toBe('2026-11-19');
    expect(moved.name).toBe('6x400m Track Rhythm');
    expect(moved.locationName).toBe('Main Track');

    const weekDays = [
      { dateStr: '2026-11-16', dayPlanned: [monEvent] },
      { dateStr: '2026-11-17', dayPlanned: [] },
      { dateStr: '2026-11-18', dayPlanned: [{ ...monEvent, id: 'bw_102', date: '2026-11-18', name: 'Tempo 20m' }] },
      { dateStr: '2026-11-19', dayPlanned: [] },
      { dateStr: '2026-11-20', dayPlanned: [] },
      { dateStr: '2026-11-21', dayPlanned: [] },
      { dateStr: '2026-11-22', dayPlanned: [] },
    ];
    const copiedBatch = buildCopiedWeekBatchItems(weekDays, '2026-11-23');
    expect(copiedBatch).toHaveLength(2);
    expect(copiedBatch[0].date).toBe('2026-11-23');
    expect(copiedBatch[1].date).toBe('2026-11-25');
    expect(copiedBatch[0].replaceExistingDate).toBe(false);

    const popoverHtml = renderToStaticMarkup(
      React.createElement(CalendarCopyWeekPopover, {
        isoWeekNum: 47,
        sourceMondayIso: '2026-11-16',
        plannedCount: 2,
        onConfirmCopy: () => {},
        onClose: () => {},
      })
    );
    expect(popoverHtml).toContain('Copy W47 (2)');
    expect(popoverHtml).toContain('Next Week (+7d)');

    const coachSrc = readRel('src/components/CoachWorkspaceView.tsx');
    expect(coachSrc).toContain('onUpdateTeamEvent={handleTeamPlanUpdate}');
    expect(coachSrc).toContain('onBatchCreateTeamEvents={handleTeamPlanBatchCreate}');
    const meetsPlanSrc = readRel('src/components/coach/CoachMeetsAndPlanView.tsx');
    expect(meetsPlanSrc).toContain('onUpdatePlannedEvent={onUpdateTeamEvent}');
    expect(meetsPlanSrc).toContain('onBatchCreatePlannedEvents={onBatchCreateTeamEvents}');
    expect(readRel('src/hooks/useCoachTeamPlanActions.ts')).toContain('/workouts/broadcast-batch');
    expect(readRel('src/components/CalendarView.tsx')).toContain('calendar-edit-planned-workout');
  });

  it('quarantines 4xx poison-pill stopwatch batches to dead-letter while flushing valid batches queued behind them', async () => {
    const sampleAct = makeActivity({ id: 'sw-dead-1' });
    const goodAct = makeActivity({ id: 'sw-good-2' });

    const poison = enqueueStopwatchOutboxBatch('team-bad', [
      { membershipId: 'mem-1', activity: sampleAct },
    ])!;
    const valid = enqueueStopwatchOutboxBatch('team-good', [
      { membershipId: 'mem-2', activity: goodAct },
    ])!;

    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: false, error: 'Coach membership revoked' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              ok: true,
              team: {
                brand: { teamId: 'team-good', name: 'Good Team', shortName: 'GOOD', joinCode: 'GOOD1', slug: 'good', orgType: 'HIGH_SCHOOL', primarySport: 'Running', primaryHex: '#B83A24', secondaryHex: '#D8FF2A', defaultSafeSportShield: true, enableParentGuardianCc: true, coachDisplayName: 'Coach', createdAt: '2026-01-01T00:00:00Z' },
                myRole: 'HEAD_COACH',
                myMembershipId: 'c1',
                totalInvited: 1,
                openedCount: 1,
                activeCount: 1,
                watchConnectedCount: 1,
                memberships: [],
                broadcastWorkouts: [],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
    );

    const flushRes = await flushStopwatchOutbox();
    expect(flushRes.syncedBatches).toBe(1);
    expect(flushRes.syncedEntries).toBe(1);
    expect(flushRes.remainingBatches).toBe(0);
    expect(loadStopwatchOutbox()).toHaveLength(0);

    const dead = listDeadLetterStopwatchBatches();
    expect(dead).toHaveLength(1);
    expect(dead[0].batchId).toBe(poison.batchId);
    expect(dead[0].status).toBe(403);
    expect(dead[0].reason).toContain('Coach membership revoked');

    dismissDeadLetterStopwatchBatch(poison.batchId);
    expect(listDeadLetterStopwatchBatches()).toHaveLength(0);

    // Retryable 503 preserves batch until MAX_OUTBOX_ATTEMPTS (8)
    const retryBatch = enqueueStopwatchOutboxBatch('team-retry', [
      { membershipId: 'mem-3', activity: { ...goodAct, id: 'sw-retry-3' } },
    ])!;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () =>
        new Response(JSON.stringify({ ok: false, error: 'Gateway timeout' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    const check503 = await persistCoachStopwatchActivitiesToServer('team-retry', retryBatch.entries);
    expect(check503.status).toBe(503);
    expect(check503.permanentFailure).toBe(false);

    for (let i = 0; i < MAX_OUTBOX_ATTEMPTS; i += 1) {
      await flushStopwatchOutbox();
    }
    expect(loadStopwatchOutbox()).toHaveLength(0);
    expect(listDeadLetterStopwatchBatches().some((b) => b.batchId === retryBatch.batchId)).toBe(true);
    expect(valid.batchId).toBeTruthy();
  });

  it('enforces honest live messaging errors, serialized dirty-safe cloud sync, Track & Field docs, and zero retired pine hexes', () => {
    const msgSrc = readRel('src/components/coach/TeamMessagingDrawer.tsx');
    expect(msgSrc).toContain('if (isSampleDemo)');
    expect(msgSrc).toContain('Queued offline — not delivered yet');
    expect(msgSrc).toContain('TeamLifecycleApiError');

    const syncSrc = readRel('src/hooks/useAthleteCloudSync.ts');
    expect(syncSrc).toContain('STORAGE_KEYS.CLOUD_STATE_DIRTY');
    expect(syncSrc).toContain('localMutationRevRef');
    expect(syncSrc).toContain("window.addEventListener('online'");
    expect(syncSrc).toContain("import('../utils/shareWorkoutEngine.ts')");
    const hydrateEffectTail = syncSrc.slice(
      syncSrc.indexOf('1. Hydrate cross-device state'),
      syncSrc.indexOf('1b. When leaving/graduating')
    );
    expect(hydrateEffectTail).not.toMatch(/plannedEvents\.length\s*,/);
    expect(hydrateEffectTail).not.toMatch(/targetGoals\.length\s*,/);
    expect(hydrateEffectTail).not.toMatch(/annualMileageGoals\.length\s*,/);
    expect(hydrateEffectTail).not.toMatch(/sessionCheckIns\.length\s*,/);

    const docsHtml = readRel('public/docs/index.html');
    expect(docsHtml).toContain('<title>MeetReady — Documentation');
    expect(docsHtml).toContain('<link rel="canonical" href="https://meetready.app/docs/" />');
    expect(docsHtml).toContain('id="themeBtn"');
    expect(docsHtml).toContain('id="sec-safesport"');
    expect(docsHtml).toContain('id="sec-overview"');
    expect(docsHtml).toContain('id="sec-onboarding"');
    expect(docsHtml).toContain('id="sec-durability"');
    expect(docsHtml).toContain('id="sec-formulas"');
    expect(docsHtml).not.toContain('#1E4D36');

    const guideSrc = readRel('src/components/UserGuideModal.tsx');
    expect(guideSrc).toContain('export type UserGuideChapterId');
    expect(guideSrc).toContain('/docs/coach.html');
    expect(guideSrc).toContain('Illustrated Coach Guide');
    expect(guideSrc).toContain('Done');
    expect(guideSrc).not.toContain('focus:ring-[#558B00]');

    const retiredPineRegex =
      /#(?:1C5436|28573B|25573A|56BA00|0B120E|0D1711|070F0B|0F1B14|0C1D14|E3ECE5|C5D4C9|DDE7DF|E9EFE9|C8FF00|1E4D36|558B00|2E6B47|193524|244230|1B2E23|2B5B3F|F4F7F2)\b/i;
    for (const rel of [
      'src/components/QuickRunLoggerCard.tsx',
      'src/components/charts/MicroGraphics.tsx',
      'src/components/auth/AuthOnboardingStepTwo.tsx',
      'src/components/DataSourcesModal.tsx',
      'src/components/AthleteRosterModal.tsx',
    ]) {
      expect(readRel(rel), `${rel} contains retired pine hex`).not.toMatch(retiredPineRegex);
    }
  });
});
