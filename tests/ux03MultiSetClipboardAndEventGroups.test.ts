import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  buildTrackSpeedReserveProfile,
  solve400mRacePaceSecsPerKm,
} from '../src/physiology/trackSpeedReserveEngine';
import { computeMultiSetPodSplits } from '../src/physiology/scholasticEngine';
import {
  formatHumanReadableStepLine,
  parseStructuredTrackWorkout,
} from '../src/utils/workoutParser';
import { buildFitStepsFromWorkoutSyntax } from '../src/utils/fitWorkoutEncoder';
import { inferTrackWorkoutSpecFromPlannedEvent } from '../src/hooks/useTracksideStopwatch';
import { synthesizeTracksideWorkoutActivity } from '../src/utils/stopwatchActivitySynthesizer';
import {
  broadcastWorkoutToTeamSquad,
  claimTeamJoinInvite,
  createTeamForCoach,
  listTeamsForUser,
  updateTeamMemberEventGroup,
} from '../server/teamService';

describe('UX-03 Multi-Set Coach Clipboard, 400m/Mile Pace Engine & Event Groups', () => {
  it('parses Elliot’s full multi-set prompt ("2mi warm-up, 2x200m at 800m pace, 4x800m at mile pace, 2x200m at 400m pace, 2mi cooldown") and short walk recovery without misreading mile pace as distance', () => {
    const prompt =
      '2mi warm-up, 2x200m at 800m pace, 4x800m at mile pace, 2x200m at 400m pace, 2mi cooldown';
    const ast = parseStructuredTrackWorkout(prompt, 240);

    expect(ast).toHaveLength(5);
    expect(ast[0].type).toBe('step');
    expect(ast[1].type).toBe('repeat');
    expect(ast[2].type).toBe('repeat');
    expect(ast[3].type).toBe('repeat');
    expect(ast[4].type).toBe('step');

    if (ast[0].type === 'step') {
      expect(ast[0].step.stepKind).toBe('warmup');
      expect(ast[0].step.distanceMeters).toBe(3219);
      expect(ast[0].step.intensityPct).toBe(55);
    }

    let pace800 = 0;
    let paceMile = 0;
    let pace400 = 0;

    if (ast[1].type === 'repeat') {
      expect(ast[1].repeatCount).toBe(2);
      expect(ast[1].steps[0].distanceMeters).toBe(200);
      pace800 = ast[1].steps[0].targetPaceSecsPerKm || 0;
    }
    if (ast[2].type === 'repeat') {
      expect(ast[2].repeatCount).toBe(4);
      // Must be 800m, never hijacked by "mile" -> 1609m!
      expect(ast[2].steps[0].distanceMeters).toBe(800);
      paceMile = ast[2].steps[0].targetPaceSecsPerKm || 0;
    }
    if (ast[3].type === 'repeat') {
      expect(ast[3].repeatCount).toBe(2);
      expect(ast[3].steps[0].distanceMeters).toBe(200);
      pace400 = ast[3].steps[0].targetPaceSecsPerKm || 0;
    }
    if (ast[4].type === 'step') {
      expect(ast[4].step.stepKind).toBe('cooldown');
      expect(ast[4].step.distanceMeters).toBe(3219);
      expect(ast[4].step.intensityPct).toBe(55);
    }

    // Strict physiological speed hierarchy: 400m pace < 800m pace < mile pace
    expect(pace400).toBeGreaterThan(90);
    expect(pace400).toBeLessThan(pace800);
    expect(pace800).toBeLessThan(paceMile);

    // "<100m walk" recovery must parse as 60m walk (~<120s), NEVER 60min (3600s)
    const walkAst = parseStructuredTrackWorkout('4x200m at 400m pace (60m walk)', 240);
    expect(walkAst[0].type).toBe('repeat');
    if (walkAst[0].type === 'repeat') {
      expect(walkAst[0].steps[1].distanceMeters).toBe(60);
      expect(walkAst[0].steps[1].durationSecs).toBeLessThan(120);
    }

    // Garmin .FIT encoder compiles all 3 repeat loops cleanly
    const fitSteps = buildFitStepsFromWorkoutSyntax(prompt, {
      sport: 'Running',
      thresholdPaceSecsPerKm: 240,
    });
    const loopSteps = fitSteps.filter((s) => s.durationType === 'repeat_until_steps_cmplt');
    expect(loopSteps).toHaveLength(3);
  });

  it('infers multi-set TrackWorkoutSpec, computes 400m + pod splits, and synthesizes all 8 reps with accurate VU/CD mileage', () => {
    const sr = buildTrackSpeedReserveProfile({ thresholdPaceSecsPerKm: 240 });
    expect(solve400mRacePaceSecsPerKm(sr)).toBeLessThan(sr.zones.FR.paceSecsPerKm);

    const prompt =
      '2mi warm-up, 2x200m at 800m pace, 4x800m at mile pace, 2x200m at 400m pace, 2mi cooldown';
    const spec = inferTrackWorkoutSpecFromPlannedEvent({
      name: '800/Mile Speed Combo',
      workoutSyntax: prompt,
    });
    expect(spec).not.toBeNull();
    expect(spec!.sets).toHaveLength(3);
    expect(spec!.repCount).toBe(8);
    expect(spec!.warmupDistanceMeters).toBe(3219);
    expect(spec!.cooldownDistanceMeters).toBe(3219);

    const pods = computeMultiSetPodSplits({
      roster: [
        { id: 'a1', name: 'Varsity 1', thresholdPaceSecsPerKm: 215 },
        { id: 'a2', name: 'JV 1', thresholdPaceSecsPerKm: 265 },
      ],
      sets: [
        { repCount: 2, repDistanceMeters: 200, intensity: 'RACE_800M', restLabel: '60s jog' },
        { repCount: 4, repDistanceMeters: 800, intensity: 'RACE_1600M', restLabel: '2m jog' },
        { repCount: 2, repDistanceMeters: 200, intensity: 'RACE_400M', restLabel: '90s jog' },
      ],
    });
    expect(pods.length).toBeGreaterThanOrEqual(2);
    expect(pods[0].setSplits).toHaveLength(3);
    expect(pods[0].setSplits[2].targetSplitSecs).toBeLessThan(pods[0].setSplits[0].targetSplitSecs);

    const activity = synthesizeTracksideWorkoutActivity({
      runnerId: 'a1',
      runnerName: 'Varsity 1',
      thresholdPaceSecsPerKm: 215,
      sessionTitle: '800/Mile Speed Combo',
      presetLabel: 'Multi-Set',
      repDistanceMeters: spec!.repDistanceMeters,
      restDurationSecs: 60,
      lapSplitsSecs: [28, 28, 134, 135, 135, 133, 26, 25],
      multiSetSpec: spec,
    });
    const workIntervals = (activity.intervals || []).filter((i) => i.type === 'WORK');
    expect(workIntervals).toHaveLength(8);
    expect(workIntervals[0].distanceMeters).toBe(200);
    expect(workIntervals[2].distanceMeters).toBe(800);
    expect(workIntervals[7].distanceMeters).toBe(200);
    expect(workIntervals[2].label).toContain('Set 2');
    // Work (400 + 3200 + 400 = 4000m) + 4mi WU/CD (~6438m) + recovery > 10km
    expect(activity.distanceMeters).toBeGreaterThan(10000);

    expect(formatHumanReadableStepLine('- 4x800m at mile pace', 'Running', 240, 'mi')).toContain('/rep');
  });

  it('isolates team broadcasts by Event Group (800m/Mile vs 3000/3200m+) and applies individual athlete overrides', async () => {
    const coachSid = `ux03_coach_${crypto.randomBytes(6).toString('hex')}`;
    const midSid = `ux03_mid_${crypto.randomBytes(6).toString('hex')}`;
    const distSid = `ux03_dist_${crypto.randomBytes(6).toString('hex')}`;
    const origin = 'https://thresh.test';

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: origin,
      name: `Central Track ${crypto.randomInt(100, 999)}`,
      shortName: 'CTRL',
      orgType: 'HIGH_SCHOOL',
      coachDisplayName: 'Coach Grant',
    });

    const midJoin = await claimTeamJoinInvite({
      callerSid: midSid,
      originUrl: origin,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Miler Alex',
      seedMarkOrFtp: '4:28 Mile',
    });
    const distJoin = await claimTeamJoinInvite({
      callerSid: distSid,
      originUrl: origin,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'TwoMiler Sam',
      seedMarkOrFtp: '9:35 3200m',
    });

    const midMemId = midJoin.summary!.memberships.find((m) => m.userSid === midSid)!.membershipId;
    const distMemId = distJoin.summary!.memberships.find((m) => m.userSid === distSid)!.membershipId;

    // Verify inferred event groups AND explicit PATCH service toggle
    const afterUpdate = await updateTeamMemberEventGroup({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: origin,
      membershipId: midMemId,
      eventGroup: 'MID_DISTANCE',
    });
    expect(afterUpdate?.memberships.find((m) => m.membershipId === midMemId)?.eventGroup).toBe(
      'MID_DISTANCE'
    );
    expect(afterUpdate?.memberships.find((m) => m.membershipId === distMemId)?.eventGroup).toBe(
      'DISTANCE'
    );

    await broadcastWorkoutToTeamSquad({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: origin,
      targetSquadGroup: 'ALL',
      targetEventGroups: ['MID_DISTANCE'],
      date: '2026-11-18',
      name: '800/Mile Speed Combo',
      sportCategory: 'Running',
      plannedDurationSecs: 3600,
      plannedLoad: 72,
      workoutSyntax: '2mi warm-up, 2x200m at 800m pace, 4x800m at mile pace, 2mi cooldown',
      description: 'Miler group speed endurance',
      athleteOverrides: {
        [distMemId]: {
          name: 'Modified 3200m Tempo + 200s',
          workoutSyntax: '2mi warm-up, 4x1000m at CV pace, 2mi cooldown',
        },
      },
    });

    const midView = (await listTeamsForUser(midSid, origin))[0];
    expect(midView.broadcastWorkouts).toHaveLength(1);
    expect(midView.broadcastWorkouts[0].name).toBe('800/Mile Speed Combo');

    const distView = (await listTeamsForUser(distSid, origin))[0];
    // Distance athlete sees it ONLY because of explicit athleteOverride; another un-overridden MID_DISTANCE workout wouldn't match
    expect(distView.broadcastWorkouts[0].athleteOverrides?.[distMemId]?.name).toBe(
      'Modified 3200m Tempo + 200s'
    );

    await broadcastWorkoutToTeamSquad({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: origin,
      targetSquadGroup: 'ALL',
      targetEventGroups: ['MID_DISTANCE'],
      date: '2026-11-19',
      name: 'Pure 800m Specific',
      sportCategory: 'Running',
      plannedDurationSecs: 3000,
      plannedLoad: 64,
      workoutSyntax: '2x200m at 400m pace',
      description: 'Mid-distance only',
    });

    const distView2 = (await listTeamsForUser(distSid, origin))[0];
    expect(distView2.broadcastWorkouts.some((bw) => bw.name === 'Pure 800m Specific')).toBe(false);
    const midView2 = (await listTeamsForUser(midSid, origin))[0];
    expect(midView2.broadcastWorkouts.some((bw) => bw.name === 'Pure 800m Specific')).toBe(true);
  });
});
