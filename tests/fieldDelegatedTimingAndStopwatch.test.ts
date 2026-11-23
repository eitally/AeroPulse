import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRouter } from '../server/apiRouter.ts';
import { findOrCreateUser } from '../server/authService.ts';
import {
  claimTeamJoinInvite,
  createTeamForCoach,
} from '../server/teamService.ts';
import {
  SESSION_COOKIE_NAME,
  deriveUserSessionSid,
  issueSessionToken,
} from '../server/securityUtils.ts';
import {
  loadTeamDocRaw,
  projectTeamSummaryForCaller,
  saveTeamDocRaw,
} from '../server/teamStoreCore.ts';
import { resetTimingDelegationRateLimitsForTesting } from '../server/routers/teamRouter.ts';
import {
  DEFAULT_RELAY_QUARTETS,
  applyResetStopwatch,
  applyStartNextRepAll,
  applyStartNextRepForPod,
  applySwapLastTwoSplits,
  applyTapRunnerSplit,
  applyUndoRunnerLastSplit,
  computeRunnerSplitTelemetry,
  getRecentSwappableSplitPair,
  resolveRunnerRepStartTimestamps,
  type PersistedTracksideStopwatchState,
} from '../src/hooks/useTracksideStopwatch.ts';
import { synthesizeTracksideRaceActivity } from '../src/utils/stopwatchActivitySynthesizer.ts';
import { resolveStopwatchSaveFeedback } from '../src/components/TracksideStopwatchView.tsx';
import {
  DELEGATED_TIMING_QUEUE_STORAGE_KEY,
  decodeDelegatedSplitHandoffPayload,
  encodeDelegatedSplitHandoffPayload,
  enqueueOfflineDelegatedSubmission,
  flushOfflineDelegatedSubmissions,
  loadOfflineDelegatedSubmissions,
  type DelegatedSplitHandoffPayload,
} from '../src/utils/timingDelegationApi.ts';
import type {
  DelegatedSplitSubmissionRecord,
  DelegatedTimingSessionRecord,
  PublicDelegatedTimingPassPayload,
} from '../src/types.ts';

function buildBaseStopwatchState(): PersistedTracksideStopwatchState {
  return {
    ...applyResetStopwatch({
      isRunning: false,
      startedAtEpochMs: null,
      sessionStartedEpochMs: null,
      accumulatedMs: 0,
      athleteLapTimestampsSecs: {},
      tapHistory: [],
      extraPodAthletes: [],
      sessionType: 'WORKOUT',
      viewMode: 'CARDS',
      showChuteBar: false,
      workoutPresetId: '8x400',
      customWorkoutSpec: null,
      raceEventLabel: '1600m',
      restDurationSecs: 60,
      waveMode: 'MASS',
      chuteQueueSecs: [],
      runnerLastTapEpochMs: {},
      sessionTitle: 'Field & Delegated Timing Test',
      soundEnabled: false,
      wakeLockEnabled: false,
      relayQuartets: DEFAULT_RELAY_QUARTETS,
      relayBatonTimestampsSecs: {},
      repStartTimestampsSecs: {},
    }),
  };
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
      return store.get(key) ?? null;
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

describe('Delegated Race Timing, FERPA Zero-PII & Trackside Stopwatch Hardening', () => {
  let server: http.Server;
  let baseUrl = '';
  const originUrl = 'http://127.0.0.1:5173';

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use(apiRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    resetTimingDelegationRateLimitsForTesting();
  });

  it('projects delegated sessions strictly by role, hides PIN hash, enforces zero-PII on public pass, PIN lock, rate limits, revoke & expiry', async () => {
    const unique = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const coachUser = await findOrCreateUser('magic_link', `coach_dt_${unique}`, {
      email: `coach.dt.${unique}@example.com`,
      name: 'Coach Rivera',
    });
    const coachSid = deriveUserSessionSid(coachUser.id);
    const coachCookie = issueSessionToken(coachUser.id, coachSid, 'verified');

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl,
      name: `Oakridge Track ${unique}`,
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
      coachDisplayName: 'Coach Rivera',
    });

    const parentEmail = `guardian.dt.${unique}@example.com`;
    const athAUser = await findOrCreateUser('magic_link', `atha_dt_${unique}`, {
      email: `atha.dt.${unique}@example.com`,
      name: 'Jordan Miles',
    });
    const athASid = deriveUserSessionSid(athAUser.id);
    const claimA = await claimTeamJoinInvite({
      callerSid: athASid,
      originUrl,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Jordan Miles',
      birthMonthYear: '2009-04',
      parentGuardianEmail: parentEmail,
    });
    expect(claimA.ok).toBe(true);

    const athBUser = await findOrCreateUser('magic_link', `athb_dt_${unique}`, {
      email: `athb.dt.${unique}@example.com`,
      name: 'Maya Patel',
    });
    const athBSid = deriveUserSessionSid(athBUser.id);
    const athBCookie = issueSessionToken(athBUser.id, athBSid, 'verified');
    const claimB = await claimTeamJoinInvite({
      callerSid: athBSid,
      originUrl,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Maya Patel',
      birthMonthYear: '2001-09',
    });
    expect(claimB.ok).toBe(true);

    const parentUser = await findOrCreateUser('magic_link', `par_dt_${unique}`, {
      email: parentEmail,
      name: 'Parent Miles',
    });
    const parentSid = deriveUserSessionSid(parentUser.id);
    const claimParent = await claimTeamJoinInvite({
      callerSid: parentSid,
      originUrl,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Parent Miles',
      birthMonthYear: '1980-01',
    });
    expect(claimParent.ok).toBe(true);

    const asstUser = await findOrCreateUser('magic_link', `asst_dt_${unique}`, {
      email: `asst.dt.${unique}@example.com`,
      name: 'Assistant Coach Kim',
    });
    const asstSid = deriveUserSessionSid(asstUser.id);
    const claimAsst = await claimTeamJoinInvite({
      callerSid: asstSid,
      originUrl,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Assistant Coach Kim',
      birthMonthYear: '1992-06',
    });
    expect(claimAsst.ok).toBe(true);

    const rawDoc = await loadTeamDocRaw(team.brand.teamId);
    expect(rawDoc).toBeTruthy();
    const memA = rawDoc!.memberships.find((m) => m.invitedName === 'Jordan Miles')!;
    const memB = rawDoc!.memberships.find((m) => m.invitedName === 'Maya Patel')!;
    const parentMem = rawDoc!.memberships.find((m) => m.invitedName === 'Parent Miles')!;
    parentMem.role = 'PARENT_FOLLOWER';
    parentMem.invitedEmail = parentEmail;
    const asstMem = rawDoc!.memberships.find((m) => m.invitedName === 'Assistant Coach Kim')!;
    asstMem.role = 'ASSISTANT_COACH';
    rawDoc!.injuryCases = [
      {
        id: `inj_${unique}`,
        teamId: team.brand.teamId,
        membershipId: memA.membershipId,
        athleteName: 'Jordan Miles',
        bodyRegion: 'SHIN',
        severity: 'LOW',
        rtpStage: 'LIMITED',
        restrictions: 'Limit spikes',
        coachGuidance: 'Soft surface warmup',
        privateClinicalNotes: 'CONFIDENTIAL MEDICAL NOTE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    rawDoc!.meetDayPackets = [
      {
        packetId: `pkt_${unique}`,
        meetTitle: 'League Championships',
        meetDate: '2026-05-02',
        laneCount: 8,
        flightSize: 12,
        partitionByDivision: true,
        meetDelayMinutes: 15,
        athleticLiveUrl: 'https://live.example.com/league',
        updatedAt: new Date().toISOString(),
        updatedByName: 'Coach Rivera',
        entries: [
          {
            id: 'eA1',
            membershipId: memA.membershipId,
            athleteName: 'Jordan Miles',
            eventCode: '1600m',
            seedMarkRaw: '4:22.10',
            officialHeat: 1,
            officialLaneOrHip: 'Hip 4',
            eventStartTime: '2:00 PM',
            checkInCallTime: '1:30 PM',
          },
          {
            id: 'eAScratch',
            membershipId: memA.membershipId,
            athleteName: 'Jordan Miles',
            eventCode: '800m',
            seedMarkRaw: '2:01.00',
            scratched: true,
            eventStartTime: '3:00 PM',
          },
          {
            id: 'eB1',
            membershipId: memB.membershipId,
            athleteName: 'Maya Patel',
            eventCode: '3200m',
            seedMarkRaw: '10:55.00',
            eventStartTime: '4:00 PM',
          },
        ],
      },
    ];
    await saveTeamDocRaw(team.brand.teamId, rawDoc!);

    // Athlete attempting to create timing session -> 403
    const forbiddenCreate = await fetch(
      `${baseUrl}/api/teams/${team.brand.teamId}/timing-sessions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE_NAME}=${athBCookie}`,
          Origin: originUrl,
        },
        body: JSON.stringify({
          meetTitle: 'League Championships',
          eventCode: '1600m',
          stationType: '200M_MARK',
          runners: [],
        }),
      }
    );
    expect(forbiddenCreate.status).toBe(403);

    // Coach creates PIN-protected 200m split station session
    const createResp = await fetch(
      `${baseUrl}/api/teams/${team.brand.teamId}/timing-sessions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE_NAME}=${coachCookie}`,
          Origin: originUrl,
        },
        body: JSON.stringify({
          meetTitle: 'League Championships',
          meetDate: '2026-05-02',
          eventCode: '1600m',
          eventLabel: '1600m Varsity',
          heatLabel: 'Heat 1',
          stationType: '200M_MARK',
          stationLabel: '200m Backstretch',
          splitPlanLabel: '400m Laps',
          targetSplitMeters: 400,
          targetLapCount: 4,
          assignedMembershipId: memA.membershipId,
          pin: '4829',
          runners: [
            {
              entryKey: `mem-${memA.membershipId}`,
              membershipId: memA.membershipId,
              displayName: 'Jordan Miles',
              hipOrLane: 'Hip 4',
              targetSplitSecs: 65,
            },
            {
              entryKey: `mem-${memB.membershipId}`,
              membershipId: memB.membershipId,
              displayName: 'Maya Patel',
              hipOrLane: 'Hip 7',
              targetSplitSecs: 74,
            },
          ],
        }),
      }
    );
    expect(createResp.status).toBe(200);
    const createdJson = (await createResp.json()) as {
      session: DelegatedTimingSessionRecord;
      passUrl: string;
    };
    const passCode = createdJson.session.passCode;
    expect(passCode).toBeTruthy();
    expect(createdJson.session.pinRequired).toBe(true);
    expect(JSON.stringify(createdJson.session)).not.toContain('pinHash');

    // Role projection checks directly via projectTeamSummaryForCaller
    const refreshedDoc = await loadTeamDocRaw(team.brand.teamId);
    const coachProjection = projectTeamSummaryForCaller(refreshedDoc!, coachSid, originUrl)!;
    expect(coachProjection.delegatedTimingSessions?.length).toBe(1);
    expect(JSON.stringify(coachProjection.delegatedTimingSessions)).not.toContain('pinHash');
    expect(coachProjection.pendingTimingSubmissions).toEqual([]);

    const asstProjection = projectTeamSummaryForCaller(refreshedDoc!, asstSid, originUrl)!;
    expect(asstProjection.delegatedTimingSessions?.length).toBe(1);
    expect(asstProjection.pendingTimingSubmissions).toEqual([]);

    const athAProjection = projectTeamSummaryForCaller(refreshedDoc!, athASid, originUrl)!;
    expect(athAProjection.delegatedTimingSessions).toBeUndefined();
    expect(athAProjection.pendingTimingSubmissions).toBeUndefined();
    expect(athAProjection.myDelegatedTimingAssignments?.length).toBe(1);
    expect(athAProjection.myDelegatedTimingAssignments?.[0].passCode).toBe(passCode);
    expect(athAProjection.myMeetDaySchedule?.length).toBe(1);
    expect(athAProjection.myMeetDaySchedule?.[0].eventCode).toBe('1600m');
    expect(athAProjection.myMeetDaySchedule?.[0].eventStartTime).toBe('2:15 PM');
    expect(athAProjection.myMeetDaySchedule?.[0].checkInCallTime).toBe('1:45 PM');
    expect(athAProjection.myMeetDaySchedule?.[0].meetDelayMinutes).toBe(15);

    const athBProjection = projectTeamSummaryForCaller(refreshedDoc!, athBSid, originUrl)!;
    expect(athBProjection.myDelegatedTimingAssignments || []).toEqual([]);
    expect(athBProjection.myMeetDaySchedule?.map((s) => s.eventCode)).toEqual(['3200m']);

    const parentProjection = projectTeamSummaryForCaller(refreshedDoc!, parentSid, originUrl)!;
    expect(parentProjection.delegatedTimingSessions).toBeUndefined();
    expect(parentProjection.pendingTimingSubmissions).toBeUndefined();
    expect(parentProjection.myDelegatedTimingAssignments).toBeUndefined();
    expect(parentProjection.myMeetDaySchedule?.map((s) => s.athleteName)).toEqual(['Jordan Miles']);
    expect(parentProjection.myMeetDaySchedule?.[0].eventStartTime).toBe('2:15 PM');

    // Public GET without PIN -> does NOT expose runners or session payload
    const noPinResp = await fetch(`${baseUrl}/api/teams/public/timing-pass/${passCode}`);
    expect(noPinResp.status).toBe(200);
    const noPinJson = (await noPinResp.json()) as PublicDelegatedTimingPassPayload;
    expect(noPinJson.found).toBe(true);
    expect(noPinJson.pinRequired).toBe(true);
    expect(noPinJson.pinVerified).toBe(false);
    expect(noPinJson.session).toBeUndefined();

    // Public GET with wrong PIN -> 403
    const wrongPinResp = await fetch(`${baseUrl}/api/teams/public/timing-pass/${passCode}?pin=0000`);
    expect(wrongPinResp.status).toBe(403);
    const wrongPinJson = (await wrongPinResp.json()) as PublicDelegatedTimingPassPayload;
    expect(wrongPinJson.pinVerified).toBe(false);
    expect(wrongPinJson.session).toBeUndefined();

    // Public GET with correct PIN -> 200 zero-PII payload (First + Last Initial ONLY)
    const validPinResp = await fetch(`${baseUrl}/api/teams/public/timing-pass/${passCode}?pin=4829`);
    expect(validPinResp.status).toBe(200);
    const validPinJson = (await validPinResp.json()) as PublicDelegatedTimingPassPayload;
    expect(validPinJson.pinVerified).toBe(true);
    expect(validPinJson.session?.meetTitle).toBe('League Championships');
    expect(validPinJson.session?.runners.map((r) => r.displayName)).toEqual([
      'Jordan M.',
      'Maya P.',
    ]);
    const serializedPublic = JSON.stringify(validPinJson);
    expect(serializedPublic).not.toContain(memA.membershipId);
    expect(serializedPublic).not.toContain(memB.membershipId);
    expect(serializedPublic).not.toContain(parentEmail);
    expect(serializedPublic).not.toContain('2009-04');
    expect(serializedPublic).not.toContain('CONFIDENTIAL MEDICAL NOTE');
    expect(serializedPublic).not.toContain('pinHash');

    // PIN brute-force rate limiting (8 attempts allowed per 10min window, 9th blocked with 429)
    resetTimingDelegationRateLimitsForTesting();
    for (let i = 0; i < 8; i += 1) {
      const attempt = await fetch(`${baseUrl}/api/teams/public/timing-pass/${passCode}?pin=9999`);
      expect(attempt.status).toBe(403);
    }
    const throttledAttempt = await fetch(
      `${baseUrl}/api/teams/public/timing-pass/${passCode}?pin=9999`
    );
    expect(throttledAttempt.status).toBe(429);
    resetTimingDelegationRateLimitsForTesting();

    // Instant revoke blocks future public access immediately
    const revokeResp = await fetch(
      `${baseUrl}/api/teams/${team.brand.teamId}/timing-sessions/${createdJson.session.sessionId}`,
      {
        method: 'DELETE',
        headers: {
          Cookie: `${SESSION_COOKIE_NAME}=${coachCookie}`,
          Origin: originUrl,
        },
      }
    );
    expect(revokeResp.status).toBe(200);

    const revokedGet = await fetch(`${baseUrl}/api/teams/public/timing-pass/${passCode}?pin=4829`);
    const revokedJson = (await revokedGet.json()) as PublicDelegatedTimingPassPayload;
    expect(revokedJson.expiredOrRevoked).toBe(true);
    expect(revokedJson.session).toBeUndefined();
  });

  it('deduplicates submissions idempotently, rejects spoofed membershipId, merges dual stations non-destructively without fake Official FAT, and allows staff post-expiry offline import', async () => {
    const unique = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const coachUser = await findOrCreateUser('magic_link', `coach_sub_${unique}`, {
      email: `coach.sub.${unique}@example.com`,
      name: 'Coach Morales',
    });
    const coachSid = deriveUserSessionSid(coachUser.id);
    const coachCookie = issueSessionToken(coachUser.id, coachSid, 'verified');

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl,
      name: `Valley Track ${unique}`,
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
      coachDisplayName: 'Coach Morales',
    });

    const athAUser = await findOrCreateUser('magic_link', `atha_sub_${unique}`, {
      email: `atha.sub.${unique}@example.com`,
      name: 'Alex Chen',
    });
    const athASid = deriveUserSessionSid(athAUser.id);
    const claimSubA = await claimTeamJoinInvite({
      callerSid: athASid,
      originUrl,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Alex Chen',
      birthMonthYear: '2001-11',
    });
    expect(claimSubA.ok).toBe(true);

    const athBUser = await findOrCreateUser('magic_link', `athb_sub_${unique}`, {
      email: `athb.sub.${unique}@example.com`,
      name: 'Sam Brooks',
    });
    const athBSid = deriveUserSessionSid(athBUser.id);
    const claimSubB = await claimTeamJoinInvite({
      callerSid: athBSid,
      originUrl,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Sam Brooks',
      birthMonthYear: '2001-03',
    });
    expect(claimSubB.ok).toBe(true);

    const docBefore = await loadTeamDocRaw(team.brand.teamId);
    const memA = docBefore!.memberships.find((m) => m.invitedName === 'Alex Chen')!;
    const memB = docBefore!.memberships.find((m) => m.invitedName === 'Sam Brooks')!;

    // Create Station 1 (200M_MARK) & Station 2 (START_FINISH)
    const createSt1 = await fetch(`${baseUrl}/api/teams/${team.brand.teamId}/timing-sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${SESSION_COOKIE_NAME}=${coachCookie}`,
        Origin: originUrl,
      },
      body: JSON.stringify({
        meetTitle: 'Dual Meet Invitational',
        meetDate: '2026-05-03',
        eventCode: '800m',
        eventLabel: '800m Open',
        heatLabel: 'Heat 1',
        stationType: '200M_MARK',
        stationLabel: '200m Curve Timer',
        splitPlanLabel: '200m Splits',
        targetSplitMeters: 200,
        targetLapCount: 4,
        runners: [
          { entryKey: `mem-${memA.membershipId}`, membershipId: memA.membershipId, displayName: 'Alex Chen', hipOrLane: 'Hip 2' },
        ],
      }),
    });
    expect(createSt1.status).toBe(200);
    const st1 = ((await createSt1.json()) as { session: DelegatedTimingSessionRecord }).session;

    const createSt2 = await fetch(`${baseUrl}/api/teams/${team.brand.teamId}/timing-sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${SESSION_COOKIE_NAME}=${coachCookie}`,
        Origin: originUrl,
      },
      body: JSON.stringify({
        meetTitle: 'Dual Meet Invitational',
        meetDate: '2026-05-03',
        eventCode: '800m',
        eventLabel: '800m Open',
        heatLabel: 'Heat 1',
        stationType: 'START_FINISH',
        stationLabel: 'Start / Finish Line',
        splitPlanLabel: '400m Laps',
        targetSplitMeters: 400,
        targetLapCount: 2,
        runners: [
          { entryKey: `mem-${memA.membershipId}`, membershipId: memA.membershipId, displayName: 'Alex Chen', hipOrLane: 'Hip 2' },
        ],
      }),
    });
    expect(createSt2.status).toBe(200);
    const st2 = ((await createSt2.json()) as { session: DelegatedTimingSessionRecord }).session;

    // Submit Station 1 twice with same clientSubmissionId + attempt to spoof memB.membershipId on a walk-on
    const clientSub1 = `csub_${unique}_1`;
    const subPayload1 = {
      clientSubmissionId: clientSub1,
      capturedByName: 'Manager Taylor',
      entries: [
        {
          entryKey: st1.runners[0].entryKey,
          membershipId: memB.membershipId, // attempted spoof should be overridden back to memA!
          athleteName: 'Alex C.',
          hipOrLane: 'Hip 2',
          totalSecs: 118.4,
          lapSplitsSecs: [28.1, 29.8, 30.2, 30.3],
          rawLapTimestampsSecs: [28.1, 57.9, 88.1, 118.4],
        },
        {
          entryKey: 'walkon-1',
          membershipId: memB.membershipId, // walk-on cannot inject arbitrary team memberId!
          athleteName: 'Guest Runner',
          isWalkOn: true,
          totalSecs: 121.0,
          lapSplitsSecs: [29.0, 30.5, 31.0, 30.5],
          rawLapTimestampsSecs: [29.0, 59.5, 90.5, 121.0],
        },
      ],
    };

    const post1a = await fetch(
      `${baseUrl}/api/teams/public/timing-pass/${st1.passCode}/submissions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subPayload1),
      }
    );
    expect(post1a.status).toBe(201);
    const json1a = (await post1a.json()) as { deduplicated: boolean; submission: DelegatedSplitSubmissionRecord };
    expect(json1a.deduplicated).toBe(false);
    expect(json1a.submission.entries[0].membershipId).toBe(memA.membershipId);
    expect(json1a.submission.entries[1].membershipId).toBeUndefined();

    // Idempotent retry
    const post1b = await fetch(
      `${baseUrl}/api/teams/public/timing-pass/${st1.passCode}/submissions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subPayload1),
      }
    );
    expect(post1b.status).toBe(200);
    const json1b = (await post1b.json()) as { deduplicated: boolean; submission: DelegatedSplitSubmissionRecord };
    expect(json1b.deduplicated).toBe(true);
    expect(json1b.submission.submissionId).toBe(json1a.submission.submissionId);

    // Submit Station 2 (complementary Start/Finish timer)
    const post2 = await fetch(
      `${baseUrl}/api/teams/public/timing-pass/${st2.passCode}/submissions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientSubmissionId: `csub_${unique}_2`,
          capturedByName: 'Assistant Lee',
          entries: [
            {
              entryKey: st2.runners[0].entryKey,
              athleteName: 'Alex C.',
              hipOrLane: 'Hip 2',
              totalSecs: 118.2,
              lapSplitsSecs: [57.8, 60.4],
              rawLapTimestampsSecs: [57.8, 118.2],
            },
          ],
        }),
      }
    );
    expect(post2.status).toBe(201);
    const json2 = (await post2.json()) as { submission: DelegatedSplitSubmissionRecord };

    // Coach approves BOTH complementary stations -> both handSplitCaptures attach non-destructively!
    const approve1 = await fetch(
      `${baseUrl}/api/teams/${team.brand.teamId}/timing-submissions/${json1a.submission.submissionId}/review`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE_NAME}=${coachCookie}`,
          Origin: originUrl,
        },
        body: JSON.stringify({ action: 'APPROVE' }),
      }
    );
    expect(approve1.status).toBe(200);

    const approve2 = await fetch(
      `${baseUrl}/api/teams/${team.brand.teamId}/timing-submissions/${json2.submission.submissionId}/review`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE_NAME}=${coachCookie}`,
          Origin: originUrl,
        },
        body: JSON.stringify({ action: 'APPROVE' }),
      }
    );
    expect(approve2.status).toBe(200);

    const afterApproveDoc = await loadTeamDocRaw(team.brand.teamId);
    const updatedMemA = afterApproveDoc!.memberships.find((m) => m.membershipId === memA.membershipId)!;
    const savedActs = updatedMemA.coachRecordedActivities || [];
    expect(savedActs.length).toBe(1);
    const captures = savedActs[0].officialRaceData?.handSplitCaptures || [];
    expect(captures.map((c) => c.stationType)).toEqual(['200M_MARK', 'START_FINISH']);
    expect(savedActs[0].sourceBadges).toContain('Delegated Hand-Timed');
    expect(savedActs[0].sourceBadges).not.toContain('Official FAT');
    expect(savedActs[0].officialRaceData?.timingMethod).toBe('HAND');
    expect(updatedMemA.liveSnapshot?.activities?.some((a) => a.id === savedActs[0].id)).toBe(true);

    // Expire Station 1 -> public POST rejected (410/400), authenticated coach POST offline handoff import succeeds (201)
    const expDoc = await loadTeamDocRaw(team.brand.teamId);
    const expSess = expDoc!.delegatedTimingSessions!.find((s) => s.sessionId === st1.sessionId)!;
    expSess.expiresAt = new Date(Date.now() - 60_000).toISOString();
    await saveTeamDocRaw(team.brand.teamId, expDoc!);

    const expiredPublicPost = await fetch(
      `${baseUrl}/api/teams/public/timing-pass/${st1.passCode}/submissions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientSubmissionId: `csub_${unique}_exp_pub`,
          capturedByName: 'Manager Taylor',
          entries: [
            {
              entryKey: st1.runners[0].entryKey,
              athleteName: 'Alex C.',
              totalSecs: 119.0,
              lapSplitsSecs: [59.0, 60.0],
              rawLapTimestampsSecs: [59.0, 119.0],
            },
          ],
        }),
      }
    );
    expect(expiredPublicPost.status).toBe(410);

    const coachOfflineImport = await fetch(
      `${baseUrl}/api/teams/public/timing-pass/${st1.passCode}/submissions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE_NAME}=${coachCookie}`,
          Origin: originUrl,
        },
        body: JSON.stringify({
          clientSubmissionId: `csub_${unique}_exp_coach`,
          capturedByName: 'Manager Taylor (Offline QR)',
          entries: [
            {
              entryKey: st1.runners[0].entryKey,
              athleteName: 'Alex C.',
              totalSecs: 118.9,
              lapSplitsSecs: [28.4, 29.8, 30.2, 30.5],
              rawLapTimestampsSecs: [28.4, 58.2, 88.4, 118.9],
            },
          ],
        }),
      }
    );
    expect(coachOfflineImport.status).toBe(201);
    const backupSub = ((await coachOfflineImport.json()) as { submission: DelegatedSplitSubmissionRecord }).submission;

    // Test ARCHIVE_BACKUP keeps activities intact while removing from pending
    const archiveResp = await fetch(
      `${baseUrl}/api/teams/${team.brand.teamId}/timing-submissions/${backupSub.submissionId}/review`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE_NAME}=${coachCookie}`,
          Origin: originUrl,
        },
        body: JSON.stringify({ action: 'ARCHIVE_BACKUP' }),
      }
    );
    expect(archiveResp.status).toBe(200);
    const afterBackupDoc = await loadTeamDocRaw(team.brand.teamId);
    const archivedRecord = afterBackupDoc!.pendingTimingSubmissions?.find(
      (s) => s.submissionId === backupSub.submissionId
    );
    expect(archivedRecord?.reviewStatus).toBe('BACKUP_ARCHIVED');
  });

  it('encodes compact QR/text handoff payloads, rejects corrupt payloads, and flushes offline localStorage staging queue', async () => {
    const sampleHandoff: DelegatedSplitHandoffPayload = {
      version: 1,
      passCode: 'ABCD1234',
      meetTitle: 'League Meet',
      eventLabel: '1600m',
      heatLabel: 'H1',
      stationType: '200M_MARK',
      capturedByName: 'Taylor K.',
      clientSubmissionId: 'sub-991',
      submittedAt: '2026-05-02T14:22:00.000Z',
      entries: [
        {
          entryKey: 'r1',
          athleteName: 'Jordan M.',
          hipOrLane: '4',
          totalSecs: 256.42,
          lapSplitsSecs: [63.1, 64.8, 65.2, 63.32],
          rawLapTimestampsSecs: [63.1, 127.9, 193.1, 256.42],
        },
      ],
    };

    const encoded = encodeDelegatedSplitHandoffPayload(sampleHandoff);
    expect(encoded.startsWith('MRDS1:')).toBe(true);
    expect(encoded.length).toBeLessThanOrEqual(220);

    // Compact 2-runner split handoff fits comfortably cleanly inside short QR payloads
    const decoded = decodeDelegatedSplitHandoffPayload(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded?.passCode).toBe('ABCD1234');
    expect(decoded?.stationType).toBe('200M_MARK');
    expect(decoded?.entries[0].totalSecs).toBeCloseTo(256.42, 2);
    expect(decoded?.entries[0].lapSplitsSecs).toEqual([63.1, 64.8, 65.2, 63.32]);

    expect(decodeDelegatedSplitHandoffPayload('NOT_VALID_MRDS1')).toBeNull();
    expect(decodeDelegatedSplitHandoffPayload('MRDS1:!!!bad_base64!!!')).toBeNull();

    const origStorage = globalThis.localStorage;
    const origFetch = globalThis.fetch;
    (globalThis as unknown as { localStorage: Storage }).localStorage = createMemoryStorage();
    try {
      enqueueOfflineDelegatedSubmission({
        clientSubmissionId: 'off-sub-1',
        passCode: 'ABCD1234',
        payload: {
          clientSubmissionId: 'off-sub-1',
          capturedByName: 'Taylor K.',
          entries: [
            {
              entryKey: 'r1',
              athleteName: 'Jordan M.',
              totalSecs: 256.42,
              lapSplitsSecs: [63.1, 64.8, 65.2, 63.32],
              rawLapTimestampsSecs: [63.1, 127.9, 193.1, 256.42],
            },
          ],
        },
        queuedAt: '2026-05-02T14:22:10.000Z',
        attempts: 0,
      });

      expect(loadOfflineDelegatedSubmissions('ABCD1234').length).toBe(1);
      expect(globalThis.localStorage.getItem(DELEGATED_TIMING_QUEUE_STORAGE_KEY)).toContain('off-sub-1');

      const mockFetch = vi.fn(async () => ({
        ok: true,
        status: 201,
        json: async () => ({
          ok: true,
          deduplicated: false,
          submission: {
            submissionId: 'srv-1',
            sessionId: 'sess-1',
            teamId: 'team-1',
            clientSubmissionId: 'off-sub-1',
            meetTitle: 'League Meet',
            meetDate: '2026-05-02',
            eventCode: '1600m',
            eventLabel: '1600m',
            stationType: '200M_MARK',
            capturedByName: 'Taylor K.',
            submittedAt: '2026-05-02T14:23:00.000Z',
            entries: [],
            reviewStatus: 'PENDING_COACH_APPROVAL',
          },
        }),
      }));
      (globalThis as unknown as { fetch: unknown }).fetch = mockFetch;

      const flushed = await flushOfflineDelegatedSubmissions('ABCD1234');
      expect(flushed.flushedCount).toBe(1);
      expect(flushed.remainingCount).toBe(0);
      expect(loadOfflineDelegatedSubmissions('ABCD1234').length).toBe(0);
    } finally {
      (globalThis as unknown as { localStorage: Storage }).localStorage = origStorage;
      (globalThis as unknown as { fetch: unknown }).fetch = origFetch;
    }
  });

  it('hardens Trackside Stopwatch: per-runner undo, swap last 2 within 4s/8s, explicit rep start vs estimated rest subtraction, honest Hand-Timed provenance, and DEAD_LETTERED banner safety', () => {
    // 1. Per-runner undo unlocks finished runner cleanly without touching later runner
    let state: PersistedTracksideStopwatchState = {
      ...buildBaseStopwatchState(),
      isRunning: true,
      startedAtEpochMs: 1_000_000,
      sessionStartedEpochMs: 1_000_000,
      accumulatedMs: 0,
    };
    state = applyTapRunnerSplit(state, 'r1', 'Maya', 1_061_200, { maxRaceLaps: 1 }).next;
    state = applyTapRunnerSplit(state, 'r2', 'Devon', 1_062_100, { maxRaceLaps: 1 }).next;

    const swapCandidate = getRecentSwappableSplitPair(state.tapHistory, 1_064_000, 4, 8000);
    expect(swapCandidate).not.toBeNull();
    expect(swapCandidate?.prev.runnerId).toBe('r1');
    expect(swapCandidate?.last.runnerId).toBe('r2');

    // Too stale (> 8s) -> hides swap button
    expect(getRecentSwappableSplitPair(state.tapHistory, 1_080_000, 4, 8000)).toBeNull();

    // Swap last 2 preserves timestamps while exchanging runner labels
    const swapped = applySwapLastTwoSplits(state);
    expect(swapped.swapped).toBe(true);
    expect(swapped.next.athleteLapTimestampsSecs.r1).toEqual([62.1]);
    expect(swapped.next.athleteLapTimestampsSecs.r2).toEqual([61.2]);

    // Per-runner undo pops ONLY r1 while leaving r2 intact
    const undoneR1 = applyUndoRunnerLastSplit(swapped.next, 'r1');
    expect(undoneR1.undone?.runnerId).toBe('r1');
    expect(undoneR1.next.athleteLapTimestampsSecs.r1).toBeUndefined();
    expect(undoneR1.next.athleteLapTimestampsSecs.r2).toEqual([61.2]);

    // 2. Explicit rep-start timestamps prevent rest duration inflation
    let workoutState: PersistedTracksideStopwatchState = {
      ...buildBaseStopwatchState(),
      isRunning: true,
      startedAtEpochMs: 500_000,
      sessionStartedEpochMs: 500_000,
      accumulatedMs: 0,
      restDurationSecs: 60,
    };
    workoutState = applyTapRunnerSplit(workoutState, 'r1', 'Maya', 570_000).next;

    // Without explicit next-rep trigger, runner shows awaiting next rep start and resting telemetry
    const restingTelem = computeRunnerSplitTelemetry({
      runnerId: 'r1',
      runnerName: 'Maya',
      podKey: 'Pod A',
      rawTimestampsSecs: workoutState.athleteLapTimestampsSecs.r1,
      repStartTimestampsSecs: resolveRunnerRepStartTimestamps(workoutState, 'r1', 'Pod A'),
      targetLapSecs: 70,
      targetRaceLaps: null,
      sessionType: 'WORKOUT',
      restDurationSecs: 60,
      lastTapEpochMs: 570_000,
      nowEpochMs: 600_000,
    });
    expect(restingTelem.isAwaitingNextRepStart).toBe(true);

    // Explicit pod rep start at 130.0s -> Rep 2 finish at 199.5s yields 69.5s exact rep time
    const startedRep2 = applyStartNextRepForPod(workoutState, 'Pod A', ['r1'], 630_000);
    expect(startedRep2.startTimestampSecs).toBeCloseTo(130, 1);
    const finishedRep2 = applyTapRunnerSplit(startedRep2.next, 'r1', 'Maya', 699_500).next;
    const explicitTelem = computeRunnerSplitTelemetry({
      runnerId: 'r1',
      runnerName: 'Maya',
      podKey: 'Pod A',
      rawTimestampsSecs: finishedRep2.athleteLapTimestampsSecs.r1,
      repStartTimestampsSecs: resolveRunnerRepStartTimestamps(finishedRep2, 'r1', 'Pod A'),
      targetLapSecs: 70,
      targetRaceLaps: null,
      sessionType: 'WORKOUT',
      restDurationSecs: 60,
      lastTapEpochMs: 699_500,
      nowEpochMs: 700_000,
    });
    expect(explicitTelem.lapSplitsSecs).toEqual([70, 69.5]);
    expect(explicitTelem.splitSources).toEqual(['GUN', 'EXPLICIT_REP_START']);
    expect(explicitTelem.hasEstimatedSplits).toBe(false);

    // Fallback ESTIMATED_REST subtraction when coach forgets Start Next Rep and standing rest sits on running clock
    const forgotRepStart = applyTapRunnerSplit(workoutState, 'r1', 'Maya', 700_500).next;
    const estTelem = computeRunnerSplitTelemetry({
      runnerId: 'r1',
      runnerName: 'Maya',
      podKey: 'Pod A',
      rawTimestampsSecs: forgotRepStart.athleteLapTimestampsSecs.r1,
      repStartTimestampsSecs: [],
      targetLapSecs: 70,
      targetRaceLaps: null,
      sessionType: 'WORKOUT',
      restDurationSecs: 60,
      lastTapEpochMs: 700_500,
      nowEpochMs: 701_000,
    });
    expect(estTelem.lapSplitsSecs).toEqual([70, 70.5]);
    expect(estTelem.splitSources).toEqual(['GUN', 'ESTIMATED_REST']);
    expect(estTelem.hasEstimatedSplits).toBe(true);

    // applyStartNextRepAll also stamps all supplied targets
    const startAll = applyStartNextRepAll(workoutState, ['Pod A', 'Pod B'], 640_000);
    expect(startAll.next.repStartTimestampsSecs?.['Pod A']?.length).toBeGreaterThanOrEqual(1);
    expect(startAll.next.repStartTimestampsSecs?.['Pod B']?.length).toBeGreaterThanOrEqual(1);

    // 3. Honest delegated hand-timed activity defaults
    const delegatedRaceAct = synthesizeTracksideRaceActivity({
      runnerId: 'r1',
      runnerName: 'Jordan M.',
      sessionTitle: 'League Championships · Heat 1',
      eventLabel: '1600m',
      eventDistanceMeters: 1600,
      lapSplitDistanceMeters: 400,
      lapSplitsSecs: [64, 65, 65, 63],
      netTotalSecs: 257,
      isDelegated: true,
      timingStation: '200M_MARK',
      capturedByName: 'Manager Taylor',
      splitsEstimated: false,
      dateIso: '2026-05-02',
    });
    expect(delegatedRaceAct.officialRaceData?.platform).toBe('MeetReady Stopwatch');
    expect(delegatedRaceAct.officialRaceData?.timingMethod).toBe('HAND');
    expect(delegatedRaceAct.officialRaceData?.includeWarmupCooldown).toBe(false);
    expect(delegatedRaceAct.sourceBadges).toEqual(['Delegated Hand-Timed']);
    expect(delegatedRaceAct.sourceBadges).not.toContain('Official FAT');

    // 4. DEAD_LETTERED & skippedReadOnlyNames NEVER emit green prime success banner
    const deadLetterFeedback = resolveStopwatchSaveFeedback(
      {
        savedCount: 1,
        selfCount: 1,
        rosterCount: 0,
        teamCount: 0,
        walkOnCount: 0,
        pendingTeamCount: 0,
        skippedReadOnlyNames: [],
        syncStatus: 'SYNCED',
        deadLetteredBatches: 1,
        syncWarning: 'Batch quarantined due to permission change',
      },
      'RACE',
      null
    );
    expect(deadLetterFeedback.tone).toBe('caution');
    expect(deadLetterFeedback.message).toContain('permission change');

    const readOnlyFeedback = resolveStopwatchSaveFeedback(
      {
        savedCount: 0,
        selfCount: 0,
        rosterCount: 0,
        teamCount: 0,
        walkOnCount: 0,
        pendingTeamCount: 0,
        skippedReadOnlyNames: ['Teammate ReadOnly'],
        syncStatus: 'LOCAL_ONLY',
      },
      'WORKOUT',
      null
    );
    expect(readOnlyFeedback.tone).toBe('caution');
    expect(readOnlyFeedback.message).toContain('Teammate ReadOnly');
  });
});
