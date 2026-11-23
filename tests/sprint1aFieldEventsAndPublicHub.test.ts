import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  advanceFlightToFinals,
  computeHorizontalFlightStandings,
  evaluateVerticalFlightAthlete,
  raiseBarHeight,
  rankVerticalFlight,
  summarizeFieldSeries,
} from '../src/physiology/fieldEventsEngine.ts';
import {
  clearFieldOutboxDb,
  countPendingFieldOutboxEntries,
  enqueueFieldOutboxBatch,
  flushFieldOutbox,
  loadFieldOutbox,
  overlayPendingFieldOutboxOnTeams,
  removeFieldOutboxBatch,
} from '../src/utils/fieldEventsOutbox.ts';
import { STORAGE_KEYS } from '../src/utils/storageKeys.ts';
import { buildCleanRoomPublicHubFromTeamSummary } from '../src/utils/publicTeamHubRoute.ts';
import { TracksideFieldEventsSheet } from '../src/components/track/TracksideFieldEventsSheet.tsx';
import { PublicTeamHubPage } from '../src/components/PublicTeamHubPage.tsx';
import { apiRouter } from '../server/apiRouter.ts';
import { getPublicTeamHubBySlugOrCode } from '../server/athleticSyncService.ts';
import {
  loadFullTeamFieldMarksArchive,
  recordTeamFieldMarks,
  teamFieldLogsVaultKey,
} from '../server/teamFieldAndDailyOpsService.ts';
import {
  bulkCreateAndSendInvites,
  claimTeamJoinInvite,
  createTeamForCoach,
  loadTeamDocRaw,
} from '../server/teamService.ts';
import { removeTeamFromDirectoryAndVault } from '../server/teamLifecycleService.ts';
import { SESSION_COOKIE_NAME, issueSessionToken } from '../server/securityUtils.ts';
import { loadTenantVaultAsync } from '../server/tokenVault.ts';
import type { TeamSummaryWithRole } from '../src/types.ts';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

describe('Sprint 1A: Multi-Athlete Field Flight Sheet, Offline Outbox, Uncapped Archive & Public Hub Field PRs', () => {
  const createdTeamIds: string[] = [];

  afterEach(async () => {
    while (createdTeamIds.length > 0) {
      const id = createdTeamIds.pop();
      if (id) await removeTeamFromDirectoryAndVault(id).catch(() => undefined);
    }
  });

  describe('1. Engine: Bar Stepping, Wind-Legality, Horizontal Tiebreaker/Finals & Vertical Countback', () => {
    it('steps HJ (+2" / +0.05m) and PV (+6" / +0.15m) bar heights with zero cumulative float drift', () => {
      let hjMeters = 70 * 0.0254; // 5' 10"
      const hjDisplays: string[] = [];
      for (let i = 0; i < 15; i += 1) {
        const res = raiseBarHeight({ currentMeters: hjMeters, eventCode: 'HJ', unit: 'mi' });
        hjMeters = res.nextMeters;
        hjDisplays.push(res.displayValue);
      }
      expect(hjDisplays[0]).toBe(`6' 0"`);
      expect(hjDisplays[1]).toBe(`6' 2"`);
      expect(hjDisplays[14]).toBe(`8' 4"`);
      expect(hjMeters).toBeCloseTo(100 * 0.0254, 4);

      const pvImp = raiseBarHeight({ currentMeters: 144 * 0.0254, eventCode: 'PV', unit: 'mi' });
      expect(pvImp.displayValue).toBe(`12' 6"`);

      let metricHj = 1.75;
      const metricDisplays: string[] = [];
      for (let i = 0; i < 6; i += 1) {
        const res = raiseBarHeight({ currentMeters: metricHj, eventCode: 'HJ', unit: 'km' });
        metricHj = res.nextMeters;
        metricDisplays.push(res.displayValue);
      }
      expect(metricDisplays).toEqual(['1.80m', '1.85m', '1.90m', '1.95m', '2.00m', '2.05m']);

      const pvMetric = raiseBarHeight({ currentMeters: 3.8, eventCode: 'PV', unit: 'km' });
      expect(pvMetric.displayValue).toBe('3.95m');
      expect(pvMetric.nextMeters).toBe(3.95);
    });

    it('tracks wind-legal best vs wind-aided best, resolves horizontal tiebreakers, and cuts top 8/9 in reverse prelim order', () => {
      const windSummary = summarizeFieldSeries('LJ', [
        { attemptNumber: 1, outcome: 'MARK', markMeters: 6.55, windMps: 1.4 },
        { attemptNumber: 2, outcome: 'MARK', markMeters: 6.72, windMps: 2.4 },
        { attemptNumber: 3, outcome: 'MARK', markMeters: 6.45, windMps: 2.0 },
      ]);
      expect(windSummary.bestMarkMeters).toBe(6.72);
      expect(windSummary.bestWindLegalMeters).toBe(6.55);
      expect(windSummary.bestMarkWindMps).toBe(2.4);
      expect(windSummary.isWindAidedBest).toBe(true);

      const tiedBestLegal = summarizeFieldSeries('LJ', [
        { attemptNumber: 1, outcome: 'MARK', markMeters: 6.55, windMps: 2.5 },
        { attemptNumber: 2, outcome: 'MARK', markMeters: 6.55, windMps: 1.8 },
      ]);
      expect(tiedBestLegal.bestMarkMeters).toBe(6.55);
      expect(tiedBestLegal.bestWindLegalMeters).toBe(6.55);
      expect(tiedBestLegal.isWindAidedBest).toBe(false);
      expect(tiedBestLegal.bestMarkWindMps).toBe(1.8);

      const athletes = Array.from({ length: 10 }, (_, idx) => {
        if (idx === 0) {
          return {
            athleteId: 'ath-tie-second',
            athleteName: 'Tie Second Best',
            eventCode: 'LJ' as const,
            attempts: [
              { attemptNumber: 1, outcome: 'MARK' as const, markMeters: 6.5 },
              { attemptNumber: 2, outcome: 'MARK' as const, markMeters: 6.42 },
            ],
          };
        }
        if (idx === 1) {
          return {
            athleteId: 'ath-tie-first',
            athleteName: 'Tie Weaker Second',
            eventCode: 'LJ' as const,
            attempts: [
              { attemptNumber: 1, outcome: 'MARK' as const, markMeters: 6.5 },
              { attemptNumber: 2, outcome: 'MARK' as const, markMeters: 6.31 },
            ],
          };
        }
        return {
          athleteId: `ath-${idx}`,
          athleteName: `Jumper ${idx}`,
          eventCode: 'LJ' as const,
          attempts: [
            { attemptNumber: 1, outcome: 'MARK' as const, markMeters: 6.4 - idx * 0.1 },
          ],
        };
      });

      const standings = computeHorizontalFlightStandings(athletes);
      expect(standings[0].athleteId).toBe('ath-tie-second');
      expect(standings[0].placeRank).toBe(1);
      expect(standings[1].athleteId).toBe('ath-tie-first');
      expect(standings[1].placeRank).toBe(2);

      const cut8 = advanceFlightToFinals(standings, 8);
      expect(cut8.standings.filter((s) => s.advancedToFinals)).toHaveLength(8);
      expect(cut8.finalsOrder[0].placeRank).toBe(8);
      expect(cut8.finalsOrder[7].placeRank).toBe(1);

      const cut9 = advanceFlightToFinals(standings, 9);
      expect(cut9.standings.filter((s) => s.advancedToFinals)).toHaveLength(9);
      expect(cut9.finalsOrder[0].placeRank).toBe(9);
    });

    it('eliminates vertical athletes after 3 consecutive misses across passed heights and ranks by World Athletics countback', () => {
      const passElimEval = evaluateVerticalFlightAthlete([
        { attemptNumber: 1, outcome: 'CLEAR', barHeightMeters: 1.75 },
        { attemptNumber: 2, outcome: 'MISS', barHeightMeters: 1.8 },
        { attemptNumber: 3, outcome: 'MISS', barHeightMeters: 1.8 },
        { attemptNumber: 4, outcome: 'PASS', barHeightMeters: 1.8 },
        { attemptNumber: 5, outcome: 'MISS', barHeightMeters: 1.85 },
        // Hypothetical post-elimination attempt must not resurrect cleared height
        { attemptNumber: 6, outcome: 'CLEAR', barHeightMeters: 1.85 },
      ]);
      expect(passElimEval.isEliminated).toBe(true);
      expect(passElimEval.isNoHeight).toBe(false);
      expect(passElimEval.bestClearedHeightMeters).toBe(1.75);
      expect(passElimEval.totalMisses).toBe(0);

      const nhEval = evaluateVerticalFlightAthlete([
        { attemptNumber: 1, outcome: 'MISS', barHeightMeters: 1.7 },
        { attemptNumber: 2, outcome: 'PASS', barHeightMeters: 1.7 },
        { attemptNumber: 3, outcome: 'MISS', barHeightMeters: 1.75 },
        { attemptNumber: 4, outcome: 'MISS', barHeightMeters: 1.75 },
      ]);
      expect(nhEval.isEliminated).toBe(true);
      expect(nhEval.isNoHeight).toBe(true);
      expect(nhEval.bestClearedHeightMeters).toBeNull();

      const ranked = rankVerticalFlight([
        {
          athleteId: 'v-a',
          athleteName: 'Fewest Total Misses',
          attempts: [
            { attemptNumber: 1, outcome: 'CLEAR', barHeightMeters: 1.75 },
            { attemptNumber: 2, outcome: 'MISS', barHeightMeters: 1.8 },
            { attemptNumber: 3, outcome: 'CLEAR', barHeightMeters: 1.8 },
            { attemptNumber: 4, outcome: 'MISS', barHeightMeters: 1.85 },
            { attemptNumber: 5, outcome: 'MISS', barHeightMeters: 1.85 },
            { attemptNumber: 6, outcome: 'MISS', barHeightMeters: 1.85 },
          ],
        },
        {
          athleteId: 'v-b',
          athleteName: 'More Prior Misses',
          attempts: [
            { attemptNumber: 1, outcome: 'MISS', barHeightMeters: 1.75 },
            { attemptNumber: 2, outcome: 'CLEAR', barHeightMeters: 1.75 },
            { attemptNumber: 3, outcome: 'MISS', barHeightMeters: 1.8 },
            { attemptNumber: 4, outcome: 'CLEAR', barHeightMeters: 1.8 },
            { attemptNumber: 5, outcome: 'MISS', barHeightMeters: 1.85 },
            { attemptNumber: 6, outcome: 'MISS', barHeightMeters: 1.85 },
            { attemptNumber: 7, outcome: 'MISS', barHeightMeters: 1.85 },
          ],
        },
        {
          athleteId: 'v-c',
          athleteName: 'Cleared First Attempt',
          attempts: [
            { attemptNumber: 1, outcome: 'MISS', barHeightMeters: 1.75 },
            { attemptNumber: 2, outcome: 'MISS', barHeightMeters: 1.75 },
            { attemptNumber: 3, outcome: 'CLEAR', barHeightMeters: 1.75 },
            { attemptNumber: 4, outcome: 'CLEAR', barHeightMeters: 1.8 },
          ],
        },
        {
          athleteId: 'v-nh',
          athleteName: 'No Height',
          attempts: [
            { attemptNumber: 1, outcome: 'MISS', barHeightMeters: 1.75 },
            { attemptNumber: 2, outcome: 'MISS', barHeightMeters: 1.75 },
            { attemptNumber: 3, outcome: 'MISS', barHeightMeters: 1.75 },
          ],
        },
      ]);

      expect(ranked.map((r) => r.athleteId)).toEqual(['v-c', 'v-a', 'v-b', 'v-nh']);
      expect(ranked[0].placeRank).toBe(1);
      expect(ranked[1].placeRank).toBe(2);
      expect(ranked[2].placeRank).toBe(3);
      expect(ranked[3].placeRank).toBeNull();
      expect(ranked[3].isNoHeight).toBe(true);
    });
  });

  describe('2. Offline Outbox (localStorage Fallback + Retry/Quarantine)', () => {
    const origLocalStorage = globalThis.localStorage;
    const origFetch = globalThis.fetch;

    beforeEach(() => {
      vi.stubGlobal('localStorage', createMemoryStorage());
    });

    afterEach(async () => {
      await clearFieldOutboxDb();
      vi.unstubAllGlobals();
      if (origLocalStorage) globalThis.localStorage = origLocalStorage;
      if (origFetch) globalThis.fetch = origFetch;
    });

    it('queues, overlays onto teams, stays queued offline, preserves transient 503/401 errors, drops permanent 400/403/422 errors, and flushes on 200', async () => {
      const batch = enqueueFieldOutboxBatch(
        'tm_outbox_1',
        [
          {
            membershipId: 'mem_1',
            athleteName: 'Mateo Flores',
            date: '2026-04-18',
            eventCode: 'LJ',
            isCompetition: true,
            attempts: [{ attemptNumber: 1, outcome: 'MARK', markMeters: 6.55, windMps: 1.2 }],
          },
        ],
        'flb_test_1'
      );
      expect(batch).not.toBeNull();
      expect(loadFieldOutbox()).toHaveLength(1);
      expect(countPendingFieldOutboxEntries('tm_outbox_1')).toBe(1);
      expect(localStorage.getItem(STORAGE_KEYS.FIELD_EVENTS_OUTBOX)).toContain('flb_test_1');

      const baseTeam: TeamSummaryWithRole = {
        brand: {
          teamId: 'tm_outbox_1',
          slug: 'oak-track',
          joinCode: 'OAK26',
          name: 'Oak Track',
          shortName: 'OAK',
          orgType: 'HIGH_SCHOOL',
          primarySport: 'Running',
          primaryHex: '#B83A24',
          secondaryHex: '#D8FF2A',
          defaultSafeSportShield: true,
          enableParentGuardianCc: true,
          coachDisplayName: 'Coach Morales',
          planTier: 'FOUNDING_TEAM',
          createdAt: '2026-04-01T00:00:00Z',
        },
        myRole: 'HEAD_COACH',
        mySquadGroup: 'Coaching Staff',
        myMembershipId: 'mem_coach',
        totalInvited: 1,
        openedCount: 1,
        activeCount: 1,
        watchConnectedCount: 0,
        memberships: [],
        broadcastWorkouts: [],
        fieldMarkLogs: [],
      };

      const overlaid = overlayPendingFieldOutboxOnTeams([baseTeam]);
      expect(overlaid[0].fieldMarkLogs).toHaveLength(1);
      expect(overlaid[0].fieldMarkLogsTotalCount).toBe(1);

      // Offline navigator.onLine === false must skip network calls and keep queued
      const fetchMockOffline = vi.fn();
      vi.stubGlobal('navigator', { onLine: false });
      vi.stubGlobal('fetch', fetchMockOffline);
      const resOffline = await flushFieldOutbox();
      expect(resOffline.remainingBatches).toBe(1);
      expect(fetchMockOffline).not.toHaveBeenCalled();
      vi.stubGlobal('navigator', { onLine: true });

      // Transient 503 stays queued with incremented attempts
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(JSON.stringify({ ok: false, error: 'Backend busy' }), { status: 503 })
        )
      );
      const res503 = await flushFieldOutbox();
      expect(res503.remainingBatches).toBe(1);
      expect(res503.syncedBatches).toBe(0);
      expect(loadFieldOutbox()[0].attempts).toBe(1);

      // Permanent 422 drops cleanly without infinite retries
      const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(JSON.stringify({ ok: false, error: 'Invalid mark' }), { status: 422 })
        )
      );
      const res422 = await flushFieldOutbox();
      expect(res422.droppedBatches).toBe(1);
      expect(res422.remainingBatches).toBe(0);
      expect(loadFieldOutbox()).toHaveLength(0);
      consoleErrSpy.mockRestore();

      // Re-enqueue and succeed with 200
      enqueueFieldOutboxBatch(
        'tm_outbox_1',
        [
          {
            membershipId: 'mem_1',
            athleteName: 'Mateo Flores',
            date: '2026-04-18',
            eventCode: 'HJ',
            isCompetition: true,
            attempts: [{ attemptNumber: 1, outcome: 'CLEAR', barHeightMeters: 1.88 }],
          },
        ],
        'flb_test_2'
      );
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(JSON.stringify({ ok: true, recordedCount: 1, team: baseTeam }), {
            status: 200,
          })
        )
      );
      const onUpdated = vi.fn();
      const res200 = await flushFieldOutbox(onUpdated);
      expect(res200.syncedBatches).toBe(1);
      expect(res200.remainingBatches).toBe(0);
      expect(onUpdated).toHaveBeenCalledTimes(1);

      // Remove helper smoke test
      enqueueFieldOutboxBatch('tm_outbox_1', [
        {
          athleteName: 'Walk On',
          date: '2026-04-18',
          eventCode: 'SP',
          attempts: [{ attemptNumber: 1, outcome: 'MARK', markMeters: 13.5 }],
        },
      ], 'flb_test_3');
      removeFieldOutboxBatch('flb_test_3');
      expect(loadFieldOutbox()).toHaveLength(0);
    });
  });

  describe('3. Uncapped Server Archive, Idempotent Retries, Vault Cleanup & Public Team Hub SafeSport PRs', () => {
    let server: http.Server;
    let baseUrl = '';

    beforeAll(async () => {
      const app = express();
      app.use(express.json({ limit: '5mb' }));
      app.use(apiRouter);
      await new Promise<void>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          if (typeof addr === 'object' && addr) {
            baseUrl = `http://127.0.0.1:${addr.port}`;
          }
          resolve();
        });
      });
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => {
        if (server) server.close(() => resolve());
        else resolve();
      });
    });

    it('stores >200 logs uncapped in vault, paginates GET /field-marks, deduplicates retries, cleans vault on delete, and enforces SafeSport Public Hub PRs', async () => {
      const coachSid = crypto.randomBytes(16).toString('hex');
      const athMinorSid = crypto.randomBytes(16).toString('hex');
      const athLegalSid = crypto.randomBytes(16).toString('hex');
      const outsiderSid = crypto.randomBytes(16).toString('hex');

      const team = await createTeamForCoach({
        callerSid: coachSid,
        originUrl: 'https://meetready.app',
        name: 'Bayview HS Track & Field',
        orgType: 'HIGH_SCHOOL',
        primarySport: 'Running',
        externalSync: { enablePublicParentHub: true },
      });
      const teamId = team.brand.teamId;
      createdTeamIds.push(teamId);

      const currentYear = new Date().getFullYear();
      // Unconsented non-external U18 minor -> MUST abbreviate to "Maya T."
      const minorJoin = await claimTeamJoinInvite({
        callerSid: athMinorSid,
        originUrl: 'https://meetready.app',
        codeOrSlug: team.brand.joinCode,
        athleteName: 'Maya Torres',
        birthYear: currentYear - 16,
        deferParentEmail: true,
      });
      const minorMem = minorJoin.summary!.memberships.find((m) => m.invitedName === 'Maya Torres')!;

      // External / consented athlete -> full name "Lucas Alvarez"
      await bulkCreateAndSendInvites({
        callerSid: coachSid,
        teamId,
        originUrl: 'https://meetready.app',
        rows: [
          {
            invitedName: 'Lucas Alvarez',
            squadGroup: 'Boys Varsity',
            isMinorU18: true,
          },
        ],
      });
      const legalJoin = await claimTeamJoinInvite({
        callerSid: athLegalSid,
        originUrl: 'https://meetready.app',
        codeOrSlug: team.brand.joinCode,
        athleteName: 'Lucas Alvarez',
        birthYear: currentYear - 17,
        deferParentEmail: true,
      });
      const legalMem = legalJoin.summary!.memberships.find((m) => m.invitedName === 'Lucas Alvarez')!;
      // Mark Lucas as parent-consent acknowledged in doc for full name test
      const docPre = await loadTeamDocRaw(teamId);
      const docLucas = docPre!.memberships.find((m) => m.membershipId === legalMem.membershipId)!;
      docLucas.parentConsentStatus = 'ACKNOWLEDGED';
      const { saveTeamDocRaw } = await import('../server/teamService.ts');
      await saveTeamDocRaw(teamId, docPre!);

      // Record 220 uncapped marks across 2 batches (110 + 110)
      const batch1 = Array.from({ length: 110 }, (_, idx) => ({
        membershipId: minorMem.membershipId,
        athleteName: 'Maya Torres',
        date: '2026-03-15',
        eventCode: 'SP' as const,
        isCompetition: false, // Practice logs must stay private!
        meetOrPracticeTitle: `Practice Throw #${idx + 1}`,
        attempts: [{ attemptNumber: 1, outcome: 'MARK' as const, markMeters: 10.5 }],
        rpe: 9,
      }));
      const batch2 = Array.from({ length: 110 }, (_, idx) => ({
        membershipId: legalMem.membershipId,
        athleteName: 'Lucas Alvarez',
        date: '2026-03-20',
        eventCode: 'DISCUS' as const,
        isCompetition: false,
        meetOrPracticeTitle: `Discus Drill #${idx + 1}`,
        attempts: [{ attemptNumber: 1, outcome: 'MARK' as const, markMeters: 42.1 }],
        rpe: 8,
      }));

      await recordTeamFieldMarks({
        callerSid: coachSid,
        teamId,
        clientBatchId: 'batch-uncapped-1',
        entries: batch1,
        originUrl: 'https://meetready.app',
      });
      await recordTeamFieldMarks({
        callerSid: coachSid,
        teamId,
        clientBatchId: 'batch-uncapped-2',
        entries: batch2,
        originUrl: 'https://meetready.app',
      });

      // Record competition marks + idempotent retry + walk-on + wind-legal vs wind-aided
      const compCoachSession = issueSessionToken('usr_coach', coachSid, 'verified');
      const compRes1 = await fetch(`${baseUrl}/api/teams/${teamId}/field-marks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE_NAME}=${compCoachSession}`,
        },
        body: JSON.stringify({
          clientBatchId: 'batch-comp-idempotent',
          entries: [
            {
              membershipId: minorMem.membershipId,
              athleteName: 'Maya Torres',
              date: '2026-04-10',
              eventCode: 'LJ',
              isCompetition: true,
              meetOrPracticeTitle: 'Bayview Invitational',
              poleSpec: 'Secret Note Pole',
              approachSteps: 15,
              rpe: 9,
              attempts: [
                { attemptNumber: 1, outcome: 'MARK', markMeters: 5.45, windMps: 1.4 },
                { attemptNumber: 2, outcome: 'MARK', markMeters: 5.62, windMps: 2.5 },
              ],
            },
            {
              membershipId: legalMem.membershipId,
              athleteName: 'Lucas Alvarez',
              date: '2026-04-10',
              eventCode: 'LJ',
              isCompetition: true,
              meetOrPracticeTitle: 'Bayview Invitational',
              attempts: [{ attemptNumber: 1, outcome: 'MARK', markMeters: 6.72, windMps: 2.4 }],
            },
            {
              athleteName: 'Unlinked Walk-On Kid',
              date: '2026-04-10',
              eventCode: 'HJ',
              isCompetition: true,
              meetOrPracticeTitle: 'Bayview Invitational',
              attempts: [{ attemptNumber: 1, outcome: 'CLEAR', barHeightMeters: 1.9 }],
            },
          ],
        }),
      });
      expect(compRes1.status).toBe(200);
      const compJson1 = await compRes1.json();
      expect(compJson1.recordedCount).toBe(3);

      // Retry exact same clientBatchId -> idempotently deduplicated (recordedCount === 0)
      const compRetry = await fetch(`${baseUrl}/api/teams/${teamId}/field-marks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE_NAME}=${compCoachSession}`,
        },
        body: JSON.stringify({
          clientBatchId: 'batch-comp-idempotent',
          entries: [
            {
              membershipId: minorMem.membershipId,
              athleteName: 'Maya Torres',
              date: '2026-04-10',
              eventCode: 'LJ',
              isCompetition: true,
              attempts: [{ attemptNumber: 1, outcome: 'MARK', markMeters: 5.45, windMps: 1.4 }],
            },
          ],
        }),
      });
      const retryJson = await compRetry.json();
      expect(retryJson.recordedCount).toBe(0);

      // Verify uncapped archive has 223 logs while inline doc stays <= 150
      const archive = await loadFullTeamFieldMarksArchive(teamId);
      expect(archive).toHaveLength(223);
      const latestDoc = await loadTeamDocRaw(teamId);
      expect(latestDoc!.fieldMarkLogs).toHaveLength(150);
      expect(latestDoc!.fieldMarkLogsTotalCount).toBe(223);

      // Verify authenticated GET /api/teams/:teamId/field-marks pagination & auth guards
      const unauthGet = await fetch(`${baseUrl}/api/teams/${teamId}/field-marks`);
      expect(unauthGet.status).toBe(401);

      const outsiderSession = issueSessionToken('usr_out', outsiderSid, 'verified');
      const outsiderGet = await fetch(`${baseUrl}/api/teams/${teamId}/field-marks`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${outsiderSession}` },
      });
      expect(outsiderGet.status).toBe(403);

      const page2Res = await fetch(
        `${baseUrl}/api/teams/${teamId}/field-marks?limit=50&offset=180`,
        {
          headers: { Cookie: `${SESSION_COOKIE_NAME}=${compCoachSession}` },
        }
      );
      expect(page2Res.status).toBe(200);
      const page2 = await page2Res.json();
      expect(page2.totalCount).toBe(223);
      expect(page2.logs).toHaveLength(43);

      // Verify Public Team Hub SafeSport Field PRs
      const hub = await getPublicTeamHubBySlugOrCode(team.brand.slug);
      expect(hub.found).toBe(true);
      expect(hub.stats.fieldPrCount).toBe(2); // Maya T. LJ + Lucas Alvarez LJ (NO practice, NO walk-on!)
      const hubJsonStr = JSON.stringify(hub);
      expect(hubJsonStr).not.toContain('Maya Torres');
      expect(hubJsonStr).not.toContain('Unlinked Walk-On Kid');
      expect(hubJsonStr).not.toContain('Practice Throw');
      expect(hubJsonStr).not.toContain('Secret Note Pole');
      expect(hubJsonStr).not.toContain('approachSteps');

      const mayaPr = hub.fieldLeaderboard!.find((p) => p.membershipId === minorMem.membershipId)!;
      expect(mayaPr.displayName).toBe('Maya T.');
      expect(mayaPr.bestMarkMeters).toBe(5.45); // Wind-legal 5.45 preferred over wind-aided 5.62
      expect(mayaPr.windMps).toBe(1.4);
      expect(mayaPr.isWindAided).toBeUndefined();

      const lucasPr = hub.fieldLeaderboard!.find((p) => p.membershipId === legalMem.membershipId)!;
      expect(lucasPr.displayName).toBe('Lucas Alvarez');
      expect(lucasPr.bestMarkMeters).toBe(6.72); // Falls back to wind-aided when no legal mark exists
      expect(lucasPr.windMps).toBe(2.4);
      expect(lucasPr.isWindAided).toBe(true);

      // Verify clean-room helper matches server U18 abbreviation and field PRs
      const clientHub = buildCleanRoomPublicHubFromTeamSummary({
        ...team,
        memberships: latestDoc!.memberships,
        fieldMarkLogs: archive,
      });
      expect(clientHub.stats.fieldPrCount).toBe(2);
      expect(clientHub.fieldLeaderboard?.map((f) => f.displayName)).toContain('Maya T.');

      // Verify cleanup removes team_field_logs_${teamId} from vault
      const vaultKey = teamFieldLogsVaultKey(teamId);
      expect(await loadTenantVaultAsync(vaultKey, null)).not.toBeNull();
      await removeTeamFromDirectoryAndVault(teamId);
      createdTeamIds.pop();
      expect(await loadTenantVaultAsync(vaultKey, null)).toBeNull();
    });
  });

  describe('4. SSR UI Checks: Multi-Athlete Flight Sheet & Public Team Hub Field PRs', () => {
    it('renders multi-athlete flight cards without hardcoded prefill values and excludes REVOKED/ALUMNI members', () => {
      const mockTeam: TeamSummaryWithRole = {
        brand: {
          teamId: 'tm_ssr_1',
          slug: 'ssr-track',
          joinCode: 'SSR26',
          name: 'SSR Track Club',
          shortName: 'SSR',
          orgType: 'HIGH_SCHOOL',
          primarySport: 'Running',
          primaryHex: '#B83A24',
          secondaryHex: '#D8FF2A',
          defaultSafeSportShield: true,
          enableParentGuardianCc: true,
          coachDisplayName: 'Coach Morales',
          planTier: 'FOUNDING_TEAM',
          createdAt: '2026-04-01T00:00:00Z',
        },
        myRole: 'HEAD_COACH',
        mySquadGroup: 'Coaching Staff',
        myMembershipId: 'mem_c',
        totalInvited: 4,
        openedCount: 4,
        activeCount: 4,
        watchConnectedCount: 0,
        memberships: [
          {
            membershipId: 'mem_a1',
            teamId: 'tm_ssr_1',
            role: 'ATHLETE',
            squadGroup: 'Varsity',
            eventGroup: 'JUMPS',
            invitedName: 'Hannah Kim',
            isMinorU18: true,
            status: 'ACTIVE',
            invitedAt: '2026-04-01T00:00:00Z',
          },
          {
            membershipId: 'mem_a2',
            teamId: 'tm_ssr_1',
            role: 'ATHLETE',
            squadGroup: 'Varsity',
            eventGroup: 'JUMPS',
            invitedName: 'Devon Brooks',
            isMinorU18: true,
            status: 'ACTIVE',
            invitedAt: '2026-04-01T00:00:00Z',
          },
          {
            membershipId: 'mem_revoked',
            teamId: 'tm_ssr_1',
            role: 'ATHLETE',
            squadGroup: 'Varsity',
            eventGroup: 'JUMPS',
            invitedName: 'Revoked Athlete',
            isMinorU18: true,
            status: 'REVOKED',
            invitedAt: '2026-04-01T00:00:00Z',
          },
          {
            membershipId: 'mem_alumni',
            teamId: 'tm_ssr_1',
            role: 'ATHLETE',
            squadGroup: 'Alumni',
            eventGroup: 'JUMPS',
            invitedName: 'Graduated Alumni',
            isMinorU18: false,
            status: 'ALUMNI',
            invitedAt: '2026-04-01T00:00:00Z',
          },
        ],
        broadcastWorkouts: [],
        fieldMarkLogs: [
          {
            id: 'fld_comp_1',
            teamId: 'tm_ssr_1',
            membershipId: 'mem_a1',
            athleteName: 'Hannah Kim',
            date: '2026-04-12',
            eventCode: 'LJ',
            eventGroup: 'JUMPS',
            isCompetition: true,
            meetOrPracticeTitle: 'League Opener',
            attempts: [{ attemptNumber: 1, outcome: 'MARK', markMeters: 5.54, windMps: 1.4 }],
            bestMarkMeters: 5.54,
            bestWindLegalMeters: 5.54,
            bestMarkWindMps: 1.4,
            createdAt: '2026-04-12T16:00:00Z',
          },
        ],
      };

      const sheetHtml = renderToStaticMarkup(
        React.createElement(TracksideFieldEventsSheet, {
          activeTeam: mockTeam,
          myTeams: [mockTeam],
          rosterAthletes: [],
          distanceUnit: 'mi',
          onTeamsUpdated: () => {},
        })
      );

      expect(sheetHtml).toContain('field-flight-cards-grid');
      expect(sheetHtml).toContain('Hannah Kim');
      expect(sheetHtml).toContain('Devon Brooks');
      expect(sheetHtml).not.toContain('Revoked Athlete');
      expect(sheetHtml).not.toContain('Graduated Alumni');
      expect(sheetHtml).toContain('field-trial-input-0');
      expect(sheetHtml).toContain('field-trial-wind-0');
      expect(sheetHtml).toContain('field-sheet-best-mark');
      expect(sheetHtml).toContain('field-sheet-save-btn');
      // Must not have hardcoded old prefills as input values
      expect(sheetHtml).not.toContain(`value="20&#x27; 6.5&quot;"`);

      const hubPayload = buildCleanRoomPublicHubFromTeamSummary(mockTeam);
      const hubHtml = renderToStaticMarkup(
        React.createElement(PublicTeamHubPage, {
          slugOrCode: 'ssr-track',
          isDark: false,
          onToggleDark: () => {},
          initialPayloadForTest: hubPayload,
          onExitHub: () => {},
        })
      );
      expect(hubHtml).toContain('public-hub-field-prs');
      expect(hubHtml).toContain('Hannah K.');
      expect(hubHtml).toContain('+1.4 m/s');
      expect(hubHtml).toContain('5.54m');
      expect(hubHtml).toContain('All Field');
    });
  });
});
