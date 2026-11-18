import crypto from 'crypto';
import fs from 'fs';
import { execFileSync } from 'child_process';
import http from 'http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apiRouter } from '../server/apiRouter.ts';
import { setSessionCookie } from '../server/securityUtils.ts';
import { deleteTenantVault } from '../server/tokenVault.ts';
import { scopedStoresInMemory } from '../server/sessionContext.ts';
import {
  claimTeamJoinInvite,
  createTeamForCoach,
  listTeamsForUser,
  updateTeamMemberEventGroup,
} from '../server/teamService.ts';
import {
  buildCoachSquadExecutionDigest,
  evaluateSafetySwapFromCheckIn,
} from '../src/physiology/sessionCheckInAndDigestEngine.ts';
import { selectSessionsForPublishCadence } from '../src/physiology/planPublishEngine.ts';
import { buildCompleteAthleteProfile } from '../src/utils/telemetryStorage.ts';
import { DEFAULT_SELF_PRIVACY_SETTINGS } from '../src/data/athleteRosterData.ts';
import type { ConnectedAthleteRecord, PlannedWorkoutEvent } from '../src/types.ts';

function extractCookiePairs(
  setCookieHeader: string[] | string | undefined
): Record<string, string> {
  const list = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];
  const out: Record<string, string> = {};
  for (const raw of list) {
    const first = raw.split(';')[0] || '';
    const eqIdx = first.indexOf('=');
    if (eqIdx > 0) {
      out[first.slice(0, eqIdx).trim()] = first.slice(eqIdx + 1).trim();
    }
  }
  return out;
}

describe('COACH-01 & COACH-02: Pure Engines + Safe-Sport Team API Sync & Cohort Publishing', () => {
  let server: http.Server;
  let baseUrl = '';
  const origEnv = { ...process.env };
  const createdTeamIds: string[] = [];
  const createdSids: string[] = [];

  beforeEach(async () => {
    process.env.SESSION_SECRET = 'test_session_secret_for_coach01_02_unit_suite_12345';

    const app = express();
    app.use(express.json());
    app.post('/__test/issue-cookie', (req, res) => {
      const sid = String(req.body?.sid || crypto.randomBytes(16).toString('hex'));
      setSessionCookie(req, res, String(req.body?.sub || 'test'), sid);
      res.json({ ok: true, sid });
    });
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

  afterEach(async () => {
    process.env = { ...origEnv };
    scopedStoresInMemory.clear();
    for (const id of createdTeamIds.splice(0)) {
      deleteTenantVault(`team_doc_${id}`);
    }
    for (const sid of createdSids.splice(0)) {
      deleteTenantVault(`user_teams_${sid}`);
      deleteTenantVault(`session_${sid.slice(0, 24)}`);
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('triggers low-impact safety swap for pain flag or RPE >= 9 before key workouts, and leaves easy days untouched', () => {
    const todayIso = '2026-11-18';
    const hardTrackEvent: PlannedWorkoutEvent = {
      id: 'evt-hard-1',
      date: '2026-11-19',
      name: '6 x 800m VO2max Track Repeats',
      sportCategory: 'Running',
      environmentPreference: 'OUTDOOR',
      description: 'Intervals at 5K pace',
      plannedLoad: 85,
      plannedDurationSecs: 3600,
      targetZoneSummary: 'Z5',
      workoutSyntax: '- 15m 65% Pace\nMain Set 6x\n- 800m 106% Pace\n- 400m 55% Pace',
    };

    const easyRecoveryEvent: PlannedWorkoutEvent = {
      id: 'evt-easy-1',
      date: '2026-11-19',
      name: 'Easy Aerobic Spin',
      sportCategory: 'Cycling',
      environmentPreference: 'INDOOR',
      description: 'Low impact Z2 flush',
      plannedLoad: 40,
      plannedDurationSecs: 2400,
      targetZoneSummary: 'Z2',
    };

    // Pain flagged -> triggers replacement swap on hard track session
    const painSwap = evaluateSafetySwapFromCheckIn({
      checkIn: {
        date: todayIso,
        rpe: 7,
        painFlag: true,
        painArea: 'SHIN',
      },
      upcomingEvents: [hardTrackEvent],
      todayIso,
    });
    expect(painSwap.shouldSwap).toBe(true);
    expect(painSwap.targetEvent?.id).toBe('evt-hard-1');
    expect(painSwap.replacementEventInput?.name).toContain('Safety Swap');
    expect(painSwap.replacementEventInput?.environmentPreference).toBe('INDOOR');
    expect(painSwap.replacementEventInput?.plannedLoad).toBeLessThan(40);

    // High RPE 9 before hard workout -> triggers RPE guardrail swap
    const highRpeSwap = evaluateSafetySwapFromCheckIn({
      checkIn: { date: todayIso, rpe: 9, painFlag: false },
      upcomingEvents: [hardTrackEvent],
      todayIso,
    });
    expect(highRpeSwap.shouldSwap).toBe(true);
    expect(highRpeSwap.replacementEventInput?.name).toContain('RPE Guardrail');

    // Easy day + normal RPE 6 -> no unnecessary swap
    const noSwap = evaluateSafetySwapFromCheckIn({
      checkIn: { date: todayIso, rpe: 6, painFlag: false },
      upcomingEvents: [easyRecoveryEvent],
      todayIso,
    });
    expect(noSwap.shouldSwap).toBe(false);
    expect(noSwap.replacementEventInput).toBeNull();
  });

  it('builds Squad Execution Digest sorted with PAIN_FLAG -> HIGH_RPE_STRAIN -> MISSED_KEY_SESSIONS -> ON_TRACK', () => {
    const todayIso = '2026-11-18';
    const profile = buildCompleteAthleteProfile(null);

    const makeAth = (
      id: string,
      name: string,
      extra: Partial<ConnectedAthleteRecord>
    ): ConnectedAthleteRecord => ({
      id,
      name,
      avatarInitials: name.slice(0, 2).toUpperCase(),
      location: 'Varsity',
      stravaAthleteId: '',
      inviteCode: 'CODE',
      role: 'COACH_EDIT',
      status: 'CONNECTED',
      primaryGoalSummary: 'Track',
      primarySport: 'Running',
      athleteProfile: profile,
      privacySettings: { ...DEFAULT_SELF_PRIVACY_SETTINGS },
      wellnessDays: [],
      activities: [],
      plannedEvents: [],
      targetGoals: [],
      ...extra,
    });

    const digest = buildCoachSquadExecutionDigest({
      todayIso,
      roster: [
        makeAth('ath-ok', 'Alex OnTrack', {
          plannedEvents: [
            {
              id: 'p-ok',
              date: todayIso,
              name: 'Tempo',
              sportCategory: 'Running',
              environmentPreference: 'OUTDOOR',
              description: '',
              plannedLoad: 60,
              plannedDurationSecs: 2400,
              targetZoneSummary: 'Z3',
            },
          ],
          activities: [
            {
              id: 'a-ok',
              startDateLocal: `${todayIso}T08:00:00`,
              name: 'Morning Tempo',
              sportCategory: 'Running',
              environment: 'OUTDOOR',
              subType: 'Road',
              movingTimeSecs: 2400,
              distanceMeters: 9000,
              elevationGainMeters: 20,
              intensityFactor: 0.85,
              trainingLoad: 60,
              avgHr: 162,
              maxHr: 174,
              aerobicDecouplingPct: 2.1,
              efficiencyFactor: 1.4,
              firstHalfEf: 1.41,
              secondHalfEf: 1.39,
              zoneSecs: { hr: [0, 0, 0, 0, 0, 0, 0] },
              stravaPrCount: 0,
              segmentEfforts: [],
              sourceBadges: [],
            },
          ],
          sessionCheckIns: [
            {
              id: 'c-ok',
              date: todayIso,
              rpe: 5,
              painFlag: false,
              createdAt: `${todayIso}T09:00:00Z`,
            },
          ],
        }),
        makeAth('ath-missed', 'Bailey Missed', {
          plannedEvents: [
            {
              id: 'pm-1',
              date: '2026-11-16',
              name: 'Easy',
              sportCategory: 'Running',
              environmentPreference: 'OUTDOOR',
              description: '',
              plannedLoad: 40,
              plannedDurationSecs: 2400,
              targetZoneSummary: 'Z2',
            },
            {
              id: 'pm-2',
              date: todayIso,
              name: 'Intervals',
              sportCategory: 'Running',
              environmentPreference: 'OUTDOOR',
              description: '',
              plannedLoad: 80,
              plannedDurationSecs: 3000,
              targetZoneSummary: 'Z4',
            },
          ],
        }),
        makeAth('ath-pain', 'Casey ShinPain', {
          eventGroup: 'MID_DISTANCE',
          sessionCheckIns: [
            {
              id: 'c-pain',
              date: todayIso,
              rpe: 7,
              painFlag: true,
              painArea: 'SHIN',
              autoSwappedToRecovery: true,
              createdAt: `${todayIso}T10:00:00Z`,
            },
          ],
        }),
      ],
    });

    expect(digest.totalAthletes).toBe(3);
    expect(digest.painFlagCount).toBe(1);
    expect(digest.swappedCount).toBe(1);
    expect(digest.checkedInTodayCount).toBe(2);
    expect(digest.rows.map((r) => r.athleteId)).toEqual([
      'ath-pain',
      'ath-missed',
      'ath-ok',
    ]);
    expect(digest.rows[0].attentionReason).toBe('PAIN_FLAG');
    expect(digest.rows[0].attentionSummary).toBe('Pain · SHIN (Swapped)');
  });

  it('syncs sessionCheckIns via /api/teams/sync-snapshot for Coaches while shielding peer Athletes', async () => {
    const coachSid = crypto.randomBytes(16).toString('hex');
    const ath1Sid = crypto.randomBytes(16).toString('hex');
    const ath2Sid = crypto.randomBytes(16).toString('hex');
    createdSids.push(coachSid, ath1Sid, ath2Sid);

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: 'https://thresh-dev.vercel.app',
      name: 'Digest Shield High',
      orgType: 'HIGH_SCHOOL',
    });
    createdTeamIds.push(team.brand.teamId);

    await claimTeamJoinInvite({
      callerSid: ath1Sid,
      originUrl: 'https://thresh-dev.vercel.app',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Jordan Runner',
      birthYear: 2009,
      parentGuardianEmail: 'parent@example.com',
    });
    await claimTeamJoinInvite({
      callerSid: ath2Sid,
      originUrl: 'https://thresh-dev.vercel.app',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Teammate Peer',
      birthYear: 2009,
      parentGuardianEmail: 'parent2@example.com',
    });

    const ath1CookieRes = await fetch(`${baseUrl}/__test/issue-cookie`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: ath1Sid, sub: 'ath1' }),
    });
    const ath1Cookies = extractCookiePairs(ath1CookieRes.headers.getSetCookie?.() || []);

    const syncRes = await fetch(`${baseUrl}/api/teams/sync-snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `thresh_session=${ath1Cookies.thresh_session}`,
      },
      body: JSON.stringify({
        origin: 'https://thresh-dev.vercel.app',
        athleteName: 'Jordan Runner',
        snapshot: {
          hasConnectedWatch: false,
          readinessScore: 74,
          sessionCheckIns: [
            {
              id: 'chk-1',
              date: '2026-11-18',
              workoutName: '6x400m Track',
              rpe: 8,
              painFlag: true,
              painArea: 'SHIN',
              sorenessNote: 'Tight left shin',
              autoSwappedToRecovery: true,
            },
          ],
        },
      }),
    });
    expect(syncRes.status).toBe(200);

    // Coach view sees athlete check-ins
    const coachTeams = await listTeamsForUser(coachSid, 'https://thresh-dev.vercel.app');
    const jordanForCoach = coachTeams[0].memberships.find(
      (m) => m.invitedName === 'Jordan Runner'
    );
    expect(jordanForCoach?.liveSnapshot?.sessionCheckIns).toHaveLength(1);
    expect(jordanForCoach?.liveSnapshot?.sessionCheckIns?.[0].painArea).toBe('SHIN');

    // Fellow athlete peer CANNOT see another athlete's pain/RPE check-ins
    const peerTeams = await listTeamsForUser(ath2Sid, 'https://thresh-dev.vercel.app');
    const jordanForPeer = peerTeams[0].memberships.find(
      (m) => m.invitedName === 'Jordan Runner'
    );
    expect(jordanForPeer?.liveSnapshot?.sessionCheckIns).toBeUndefined();
  });

  it('publishes Rolling 1W/2W vs Full Block cleanly via broadcast-batch & isolates Event-Group cohorts', async () => {
    const coachSid = crypto.randomBytes(16).toString('hex');
    const midSid = crypto.randomBytes(16).toString('hex');
    const sprSid = crypto.randomBytes(16).toString('hex');
    createdSids.push(coachSid, midSid, sprSid);

    const sampleWeeks = [1, 2, 3, 4].map((wk) => ({
      weekNum: wk,
      sessions: [
        {
          date: `2026-12-0${wk}`,
          name: `Week ${wk} Key Workout`,
          sportCategory: 'Running' as const,
          environmentPreference: 'OUTDOOR' as const,
          plannedDurationSecs: 3000,
          plannedLoad: 75,
          workoutSyntax: '- 20m 85% Effort',
          description: `Wk ${wk}`,
        },
        {
          date: `2026-12-1${wk}`,
          name: `Week ${wk} Aerobic`,
          sportCategory: 'Running' as const,
          environmentPreference: 'OUTDOOR' as const,
          plannedDurationSecs: 2400,
          plannedLoad: 48,
          workoutSyntax: '- 40m 68% Effort',
          description: `Wk ${wk} Easy`,
        },
      ],
    }));

    const rolling2 = selectSessionsForPublishCadence(sampleWeeks, 'ROLLING_2W', 1, {
      blockId: 'blk-test-2w',
      baseTitle: '800m Championship Block',
      audience: 'EVENT_MID_DISTANCE',
    });
    expect(rolling2.sessions).toHaveLength(4); // Weeks 2 & 3 (2 sessions each)
    expect(rolling2.startWeekNum).toBe(2);
    expect(rolling2.endWeekNum).toBe(3);
    expect(rolling2.sessions[0].planBlockName).toBe('[800M / MILE] 800m Championship Block');

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: 'https://thresh-dev.vercel.app',
      name: 'Track Cohort High',
      orgType: 'HIGH_SCHOOL',
    });
    createdTeamIds.push(team.brand.teamId);

    const midClaim = await claimTeamJoinInvite({
      callerSid: midSid,
      originUrl: 'https://thresh-dev.vercel.app',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Mid Runner',
      birthYear: 2009,
      parentGuardianEmail: 'p1@example.com',
    });
    const sprClaim = await claimTeamJoinInvite({
      callerSid: sprSid,
      originUrl: 'https://thresh-dev.vercel.app',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Sprinter Athlete',
      birthYear: 2009,
      parentGuardianEmail: 'p2@example.com',
    });

    await updateTeamMemberEventGroup({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      membershipId: midClaim.summary!.myMembershipId,
      originUrl: 'https://thresh-dev.vercel.app',
      eventGroup: 'MID_DISTANCE',
    });
    await updateTeamMemberEventGroup({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      membershipId: sprClaim.summary!.myMembershipId,
      originUrl: 'https://thresh-dev.vercel.app',
      eventGroup: 'SPRINTS',
    });

    const coachCookieRes = await fetch(`${baseUrl}/__test/issue-cookie`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: coachSid, sub: 'coach' }),
    });
    const coachCookies = extractCookiePairs(coachCookieRes.headers.getSetCookie?.() || []);

    // Publish Rolling 2W strictly to MID_DISTANCE
    const batchRes = await fetch(
      `${baseUrl}/api/teams/${encodeURIComponent(team.brand.teamId)}/workouts/broadcast-batch`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `thresh_session=${coachCookies.thresh_session}`,
        },
        body: JSON.stringify({
          origin: 'https://thresh-dev.vercel.app',
          targetSquadGroup: 'ALL',
          targetEventGroups: ['MID_DISTANCE'],
          publishMode: 'ROLLING_2W',
          planBlockId: 'blk-mid-2w',
          planBlockName: '[800M / MILE] Championship',
          workouts: rolling2.sessions,
        }),
      }
    );
    expect(batchRes.status).toBe(200);
    const batchBody = await batchRes.json();
    expect(batchBody.publishedCount).toBe(4);

    // Mid-distance runner sees all 4 sessions; Sprinter sees 0!
    const midTeams = await listTeamsForUser(midSid, 'https://thresh-dev.vercel.app');
    const sprTeams = await listTeamsForUser(sprSid, 'https://thresh-dev.vercel.app');
    expect(midTeams[0].broadcastWorkouts).toHaveLength(4);
    expect(sprTeams[0].broadcastWorkouts).toHaveLength(0);

    // Recall / delete block removes all 4 sessions
    const delRes = await fetch(
      `${baseUrl}/api/teams/${encodeURIComponent(team.brand.teamId)}/workouts/blocks/blk-mid-2w`,
      {
        method: 'DELETE',
        headers: {
          Cookie: `thresh_session=${coachCookies.thresh_session}`,
        },
      }
    );
    expect(delRes.status).toBe(200);
    const midAfterRecall = await listTeamsForUser(midSid, 'https://thresh-dev.vercel.app');
    expect(midAfterRecall[0].broadcastWorkouts).toHaveLength(0);
  });

  it('passes Impeccable detect.mjs with 0 anti-pattern findings on Wave 2 UI files', () => {
    const detectorPath =
      '/Users/elliottally/.gemini/config/plugins/impeccable/skills/impeccable/scripts/detect.mjs';
    if (!fs.existsSync(detectorPath)) {
      return;
    }
    const output = execFileSync(
      'node',
      [
        detectorPath,
        'src/components/AthleteSessionCheckInCard.tsx',
        'src/components/CoachExecutionDigestPanel.tsx',
        'src/components/CoachWorkspaceView.tsx',
        'src/components/GoalsView.tsx',
      ],
      { encoding: 'utf8' }
    );
    expect(output.trim()).toBe('');
  });
});
