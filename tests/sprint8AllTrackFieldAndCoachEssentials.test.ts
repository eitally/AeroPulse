import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ALL_TF_PRACTICE_TEMPLATES,
  computeMultiEventScore,
  formatFieldMarkDual,
  getFieldEventSpec,
  parseFieldMarkToMeters,
  summarizeFieldSeries,
} from '../src/physiology/fieldEventsEngine.ts';
import { generateAllEventsTrackPlan } from '../src/physiology/allEventsPlanEngine.ts';
import { resolveAudienceCohortSpec } from '../src/physiology/planPublishEngine.ts';
import { optimizeTrackRelayLineup } from '../src/physiology/trackMeetAndRelayEngine.ts';
import {
  computeOfficialRaceTrainingLoad,
  synthesizeOfficialRaceActivity,
} from '../src/utils/officialRaceSynthesizer.ts';
import {
  bulkCreateAndSendInvites,
  claimTeamJoinInvite,
  createTeamForCoach,
  listTeamsForUser,
} from '../server/teamService.ts';
import {
  removeTeamFromDirectoryAndVault,
  updateMemberRole,
} from '../server/teamLifecycleService.ts';
import {
  deleteTeamAnnouncement,
  postTeamAnnouncement,
  recordTeamAttendanceBatch,
  recordTeamFieldMarks,
  updateAssistantCoachEventGroups,
} from '../server/teamFieldAndDailyOpsService.ts';
import { getPublicTeamHubBySlugOrCode } from '../server/athleticSyncService.ts';

describe('Wave 1B & Wave 2: All Track & Field First-Class + Coach Essentials & Daily Ops', () => {
  const createdTeamIds: string[] = [];

  afterEach(async () => {
    while (createdTeamIds.length > 0) {
      const id = createdTeamIds.pop();
      if (id) await removeTeamFromDirectoryAndVault(id).catch(() => undefined);
    }
  });

  it('synthesizes 100m sprint & 110mH hurdle races cleanly with sprint TSS', () => {
    expect(computeOfficialRaceTrainingLoad(100, 10.94, false)).toBeGreaterThanOrEqual(18);
    expect(computeOfficialRaceTrainingLoad(110, 14.32, true)).toBeGreaterThan(20);

    const sprintAct = synthesizeOfficialRaceActivity({
      id: 'race-100m',
      date: '2026-04-12',
      meetName: 'Valley Dual',
      eventLabel: '100m',
      eventDistanceMeters: 100,
      fatTimeSecs: 10.94,
      displayFatTime: '10.94',
      platform: 'Athletic.net',
      trackType: 'OUTDOOR_400M',
      lapSplitDistanceMeters: 100,
      lapSplitsSecs: [10.94],
      includeWarmupCooldown: false,
    });
    expect(sprintAct.distanceMeters).toBe(100);
    expect(sprintAct.officialRaceData?.eventDistanceMeters).toBe(100);
    expect(sprintAct.trainingLoad).toBeGreaterThanOrEqual(18);
    expect(sprintAct.officialRaceData?.eventLabel).toBe('100m');
  });

  it('optimizes 4x100m and 4x200m sprint relays across 4 legs', () => {
    const squad = [
      { id: 'a1', name: 'Ava Brooks', thresholdPaceSecsPerKm: 235, mssMps: 9.6, phenotype: 'SPEED' as const },
      { id: 'a2', name: 'Mia Cruz', thresholdPaceSecsPerKm: 242, mssMps: 9.3, phenotype: 'SPEED' as const },
      { id: 'a3', name: 'Tori Lee', thresholdPaceSecsPerKm: 240, mssMps: 9.4, phenotype: 'HYBRID' as const },
      { id: 'a4', name: 'Zoe Reed', thresholdPaceSecsPerKm: 245, mssMps: 9.1, phenotype: 'SPEED' as const },
    ];
    const r4x1 = optimizeTrackRelayLineup({ relayEvent: '4x100m', candidates: squad });
    const r4x2 = optimizeTrackRelayLineup({ relayEvent: '4x200m', candidates: squad });
    expect(r4x1.legs).toHaveLength(4);
    expect(r4x1.totalPredictedSecs).toBeGreaterThan(35);
    expect(r4x2.legs).toHaveLength(4);
    expect(r4x2.totalPredictedSecs).toBeGreaterThan(r4x1.totalPredictedSecs);
  });

  it('parses imperial & metric marks, summarizes horizontal/vertical/throw trials, and scores WA Multi-Events', () => {
    expect(parseFieldMarkToMeters(`21' 6.5"`)).toBeCloseTo(6.566, 2);
    expect(parseFieldMarkToMeters('14-6')).toBeCloseTo(4.42, 2);
    expect(parseFieldMarkToMeters('6.57m')).toBe(6.57);
    expect(formatFieldMarkDual(6.566)).toContain("21'");

    const ljSummary = summarizeFieldSeries(
      'LJ',
      [
        { attemptNumber: 1, outcome: 'MARK', markMeters: 6.4 },
        { attemptNumber: 2, outcome: 'FOUL' },
        { attemptNumber: 3, outcome: 'MARK', markMeters: 6.57 },
      ],
      7
    );
    expect(ljSummary.bestMarkMeters).toBe(6.57);
    expect(ljSummary.legalCount).toBe(2);
    expect(ljSummary.foulOrMissCount).toBe(1);
    expect(ljSummary.totalContacts).toBe(3);

    const hjSummary = summarizeFieldSeries('HJ', [
      { attemptNumber: 1, outcome: 'CLEAR', barHeightMeters: 1.78 },
      { attemptNumber: 2, outcome: 'MISS', barHeightMeters: 1.83 },
      { attemptNumber: 3, outcome: 'CLEAR', barHeightMeters: 1.83 },
      { attemptNumber: 4, outcome: 'PASS', barHeightMeters: 1.88 },
    ]);
    expect(hjSummary.bestMarkMeters).toBe(1.83);
    expect(hjSummary.verticalSeriesSummary).toContain('1.78:O');
    expect(hjSummary.verticalSeriesSummary).toContain('1.83:X');
    expect(hjSummary.verticalSeriesSummary).toContain('1.83:O');
    expect(hjSummary.verticalSeriesSummary).toContain('1.88:-');

    const decScore = computeMultiEventScore('DEC', 'M', {
      '100m': 11.0,
      LJ: 7.1,
      SP: 14.0,
      HJ: 1.95,
      '400m': 49.5,
      '110mH': 14.8,
      DISCUS: 42.0,
      PV: 4.5,
      JAVELIN: 55.0,
      '1500m': 275.0,
    });
    expect(decScore.totalPoints).toBeGreaterThan(6800);
    expect(decScore.breakdown['100m']).toBeGreaterThan(750);
    expect(getFieldEventSpec('PV').eventGroup).toBe('POLE_VAULT');
    expect(ALL_TF_PRACTICE_TEMPLATES.length).toBeGreaterThanOrEqual(6);
  });

  it('generates 4–16 week plans across Sprints/Hurdles/Jumps/Throws/Multi and resolves all 8 event audiences', () => {
    const archetypes = [
      'TRACK_SPRINTS',
      'TRACK_HURDLES',
      'TRACK_JUMPS_PV',
      'TRACK_THROWS',
      'TRACK_MULTI',
    ] as const;

    for (const arch of archetypes) {
      const weeks = generateAllEventsTrackPlan({
        archetypeId: arch,
        startDateIso: '2026-03-02',
        blockWeeks: 8,
      });
      expect(weeks).toHaveLength(8);
      expect(weeks[0].sessions.length).toBeGreaterThanOrEqual(3);
      expect(weeks[0].sessions[0].targetZoneSummary).toBeTruthy();
      expect(weeks[0].sessions[0].plannedLoad).toBeGreaterThan(0);
    }

    expect(resolveAudienceCohortSpec('EVENT_HURDLES').targetEventGroups).toEqual(['HURDLES']);
    expect(resolveAudienceCohortSpec('EVENT_JUMPS').targetEventGroups).toEqual(['JUMPS']);
    expect(resolveAudienceCohortSpec('EVENT_POLE_VAULT').targetEventGroups).toEqual(['POLE_VAULT']);
    expect(resolveAudienceCohortSpec('EVENT_THROWS').targetEventGroups).toEqual(['THROWS']);
    expect(resolveAudienceCohortSpec('EVENT_MULTI').targetEventGroups).toEqual(['MULTI']);
  });

  it('persists attendance, parent-hub announcements, field mark logs, and assistant coach group scoping via server services', async () => {
    const coachSid = `coach-s8-${crypto.randomUUID()}`;
    const athleteSid = `ath-s8-${crypto.randomUUID()}`;
    const assistantSid = `asst-s8-${crypto.randomUUID()}`;
    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: 'https://thresh.fit',
      name: 'Oakridge HS Track & Field',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
      externalSync: { enablePublicParentHub: true },
    });
    createdTeamIds.push(team.brand.teamId);

    // Athlete joins cleanly
    const currentYear = new Date().getFullYear();
    const joined = await claimTeamJoinInvite({
      callerSid: athleteSid,
      originUrl: 'https://thresh.fit',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Jordan Maya',
      birthYear: currentYear - 17,
      deferParentEmail: true,
    });
    expect(joined.ok).toBe(true);
    const athleteMem = joined.summary!.memberships.find((m) => m.invitedName === 'Jordan Maya')!;

    // Assistant coach joins + gets promoted + scoped to HURDLES & SPRINTS
    const inv = await bulkCreateAndSendInvites({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: 'https://thresh.fit',
      rows: [{ invitedName: 'Coach Morales', invitedEmail: 'morales@oak.edu', squadGroup: 'Varsity', isMinorU18: false }],
    });
    expect(inv.addedCount).toBe(1);
    const asstJoin = await claimTeamJoinInvite({
      callerSid: assistantSid,
      originUrl: 'https://thresh.fit',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Coach Morales',
      athleteEmail: 'morales@oak.edu',
      birthYear: currentYear - 34,
    });
    expect(asstJoin.ok).toBe(true);
    const asstMem = asstJoin.summary!.memberships.find((m) => m.invitedName === 'Coach Morales')!;
    await updateMemberRole({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      membershipId: asstMem.membershipId,
      role: 'ASSISTANT_COACH',
      originUrl: 'https://thresh.fit',
    });

    const deniedScope = await updateAssistantCoachEventGroups({
      callerSid: athleteSid,
      teamId: team.brand.teamId,
      membershipId: asstMem.membershipId,
      coachEventGroups: ['THROWS'],
      originUrl: 'https://thresh.fit',
    });
    expect(deniedScope.ok).toBe(false);

    const okScope = await updateAssistantCoachEventGroups({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      membershipId: asstMem.membershipId,
      coachEventGroups: ['SPRINTS', 'HURDLES'],
      originUrl: 'https://thresh.fit',
    });
    expect(okScope.ok).toBe(true);

    const asstTeams = await listTeamsForUser(assistantSid, 'https://thresh.fit');
    const asstView = asstTeams.find((t) => t.brand.teamId === team.brand.teamId)!;
    expect(asstView.myCoachEventGroups).toEqual(['SPRINTS', 'HURDLES']);

    // Attendance batch
    const attRes = await recordTeamAttendanceBatch({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      date: '2026-04-15',
      entries: [{ membershipId: athleteMem.membershipId, status: 'PRESENT' }],
      originUrl: 'https://thresh.fit',
    });
    expect(attRes.ok).toBe(true);
    expect(attRes.team?.attendanceByDate?.['2026-04-15']?.[athleteMem.membershipId]?.status).toBe('PRESENT');

    // Public vs Internal announcement filtering
    const pubAnn = await postTeamAnnouncement({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      title: 'Lightning Shelter',
      body: 'Meet delayed 30m — shelter in gym.',
      category: 'WEATHER',
      publishToParentHub: true,
      originUrl: 'https://thresh.fit',
    });
    const privAnn = await postTeamAnnouncement({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      title: 'Staff Timing Split Note',
      body: 'Keep wristwatches synced.',
      category: 'GENERAL',
      publishToParentHub: false,
      originUrl: 'https://thresh.fit',
    });
    expect(pubAnn.ok && privAnn.ok).toBe(true);

    const hub = await getPublicTeamHubBySlugOrCode(team.brand.slug);
    expect(hub.found).toBe(true);
    expect(hub.announcements?.map((a) => a.title)).toEqual(['Lightning Shelter']);

    const delRes = await deleteTeamAnnouncement({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      announcementId: pubAnn.announcement!.id,
      originUrl: 'https://thresh.fit',
    });
    expect(delRes.ok).toBe(true);
    const hubAfter = await getPublicTeamHubBySlugOrCode(team.brand.slug);
    expect(hubAfter.announcements || []).toHaveLength(0);

    // Field marks + Safe-Sport activity mirroring
    const fieldRes = await recordTeamFieldMarks({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      entries: [
        {
          membershipId: athleteMem.membershipId,
          athleteName: 'Jordan Maya',
          date: '2026-04-15',
          eventCode: 'LJ',
          isCompetition: true,
          meetOrPracticeTitle: 'League Quad Meet',
          approachSteps: 7,
          attempts: [
            { attemptNumber: 1, outcome: 'MARK', markMeters: 6.57 },
            { attemptNumber: 2, outcome: 'FOUL' },
          ],
          rpe: 7,
        },
      ],
      originUrl: 'https://thresh.fit',
    });
    expect(fieldRes.ok).toBe(true);
    expect(fieldRes.recordedCount).toBe(1);
    expect(fieldRes.team?.fieldMarkLogs?.[0]?.bestMarkMeters).toBe(6.57);
  });
});
