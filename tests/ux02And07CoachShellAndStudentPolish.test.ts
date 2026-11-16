import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { formatHumanReadableStepLine } from '../src/utils/workoutParser';
import { partitionSavedStopwatchEntries } from '../src/utils/stopwatchTeamSync';
import {
  claimTeamJoinInvite,
  createTeamForCoach,
  listTeamsForUser,
  recordCoachStopwatchActivities,
} from '../server/teamService';
import { buildCompleteAthleteProfile } from '../src/utils/telemetryStorage';
import { DEFAULT_SELF_PRIVACY_SETTINGS } from '../src/data/athleteRosterData';
import type { ConnectedAthleteRecord, UnifiedActivity } from '../src/types';

function makeMockActivity(id: string): UnifiedActivity {
  return {
    id,
    startDateLocal: '2026-11-16T15:30:00',
    name: 'Trackside 5x800m CV',
    sportCategory: 'Running',
    environment: 'OUTDOOR',
    subType: 'Track',
    movingTimeSecs: 960,
    distanceMeters: 4000,
    elevationGainMeters: 0,
    intensityFactor: 0.96,
    trainingLoad: 38,
    avgHr: 174,
    maxHr: 186,
    avgPaceSecsPerKm: 240,
    aerobicDecouplingPct: 1.5,
    efficiencyFactor: 1.44,
    firstHalfEf: 1.45,
    secondHalfEf: 1.43,
    zoneSecs: { hr: [0, 120, 180, 300, 300, 60, 0] },
    stravaPrCount: 0,
    segmentEfforts: [],
    sourceBadges: [],
    // @ts-expect-error Verify Safe-Sport sanitizer strips body-weight fields on server write
    weightKg: 61.2,
  };
}

describe('UX-02 & UX-07 Coach Workspace, 4-Tab Nav & Student Polish', () => {
  it('translates raw % Pace and % FTP step syntax into plain athlete-readable splits and wattage', () => {
    const runEasy = formatHumanReadableStepLine('- 10m 65% Pace', 'Running', 240, 'mi');
    expect(runEasy).not.toContain('% Pace');
    expect(runEasy).toMatch(/10m @ \d{1,2}:\d{2}\/mi/);

    const runKm = formatHumanReadableStepLine('4x800m 100% Pace', 'Running', 240, 'km');
    expect(runKm).not.toContain('% Pace');
    expect(runKm).toBe('4 × 800m @ 4:00/km');

    const bikeThresh = formatHumanReadableStepLine('- 8m 100% FTP', 'Cycling', undefined, 'mi', 280);
    expect(bikeThresh).not.toContain('% FTP');
    expect(bikeThresh).toBe('8m @ 280W');
  });

  it('partitions saved stopwatch entries cleanly between self, coach-editable team athletes, and read-only friends', () => {
    const mockProfile = buildCompleteAthleteProfile({
      name: 'Roster Runner',
      weightKg: 65,
      restingHr: 50,
      lthr: 170,
      maxHr: 192,
      ftp: 240,
      indoorFtp: 230,
      runFtp: 260,
    });
    const roster: ConnectedAthleteRecord[] = [
      {
        id: 'team-mem-mem_coach_edit_1',
        name: 'Maya Chen',
        avatarInitials: 'MC',
        location: 'Palo Alto, CA',
        stravaAthleteId: '',
        inviteCode: 'TH-1001-MC',
        role: 'COACH_EDIT',
        status: 'CONNECTED',
        primaryGoalSummary: '1600m',
        primarySport: 'Running',
        privacySettings: DEFAULT_SELF_PRIVACY_SETTINGS,
        athleteProfile: mockProfile,
        wellnessDays: [],
        activities: [],
        plannedEvents: [],
        targetGoals: [],
      },
      {
        id: 'friend-readonly-1',
        name: 'Alex Friend',
        avatarInitials: 'AF',
        location: 'Mountain View, CA',
        stravaAthleteId: '',
        inviteCode: 'TH-1002-AF',
        role: 'FRIEND_VIEW',
        status: 'CONNECTED',
        primaryGoalSummary: '5000m',
        primarySport: 'Running',
        privacySettings: DEFAULT_SELF_PRIVACY_SETTINGS,
        athleteProfile: mockProfile,
        wellnessDays: [],
        activities: [],
        plannedEvents: [],
        targetGoals: [],
      },
    ];

    const partitioned = partitionSavedStopwatchEntries(
      [
        { runnerId: 'SELF', runnerName: 'Me', activity: makeMockActivity('sw-self-1') },
        {
          runnerId: 'team-mem-mem_coach_edit_1',
          runnerName: 'Maya Chen',
          activity: makeMockActivity('sw-maya-1'),
        },
        {
          runnerId: 'friend-readonly-1',
          runnerName: 'Alex Friend',
          activity: makeMockActivity('sw-friend-1'),
        },
      ],
      roster
    );

    expect(partitioned.selfActs.map((a) => a.id)).toEqual(['sw-self-1']);
    expect(partitioned.teamApiEntries).toHaveLength(1);
    expect(partitioned.teamApiEntries[0].membershipId).toBe('mem_coach_edit_1');
    expect(partitioned.rosterByRunnerId.has('friend-readonly-1')).toBe(false);
    expect(partitioned.savedCount).toBe(2);
  });

  it('persists coach stopwatch recordings onto watchless U18 athlete memberships with weight masking & blocks athlete callers', async () => {
    const coachSid = `ux07_coach_${crypto.randomBytes(6).toString('hex')}`;
    const athleteSid = `ux07_ath_${crypto.randomBytes(6).toString('hex')}`;
    const originUrl = 'https://thresh.test';

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl,
      name: `Paly Track ${crypto.randomInt(100, 999)}`,
      shortName: 'PALY',
      orgType: 'HIGH_SCHOOL',
      coachDisplayName: 'Coach Miller',
    });

    const joined = await claimTeamJoinInvite({
      callerSid: athleteSid,
      originUrl,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Jordan Watchless',
      birthYear: new Date().getFullYear() - 16,
    });
    expect(joined.ok).toBe(true);
    expect(joined.safeSportShieldEnforced).toBe(true);

    const athleteMembership = joined.summary!.memberships.find((m) => m.userSid === athleteSid)!;
    expect(athleteMembership).toBeTruthy();

    // Non-coach ATHLETE caller must be rejected (null -> HTTP 403 in router)
    const denied = await recordCoachStopwatchActivities({
      callerSid: athleteSid,
      teamId: team.brand.teamId,
      originUrl,
      entries: [{ membershipId: athleteMembership.membershipId, activity: makeMockActivity('denied-1') }],
    });
    expect(denied).toBeNull();

    // Coach caller persists watchless stopwatch workout safely and masks body weight
    const saved = await recordCoachStopwatchActivities({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl,
      entries: [{ membershipId: athleteMembership.membershipId, activity: makeMockActivity('sw-u18-1') }],
    });
    expect(saved).not.toBeNull();

    const updatedMembership = saved!.memberships.find(
      (m) => m.membershipId === athleteMembership.membershipId
    )!;
    expect(updatedMembership.coachRecordedActivities?.map((a) => a.id)).toContain('sw-u18-1');
    expect((updatedMembership.coachRecordedActivities?.[0] as any)?.weightKg).toBeUndefined();

    const athletePerspective = (await listTeamsForUser(athleteSid, originUrl)).find(
      (t) => t.brand.teamId === team.brand.teamId
    )!;
    const myMem = athletePerspective.memberships.find(
      (m) => m.membershipId === athleteMembership.membershipId
    )!;
    expect(myMem.coachRecordedActivities?.map((a) => a.id)).toContain('sw-u18-1');
  });
});
