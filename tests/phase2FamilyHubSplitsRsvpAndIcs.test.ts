import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { apiRouter } from '../server/apiRouter.ts';
import {
  followTeamAsParentOrFan,
  getPublicTeamHubBySlugOrCode,
  updateTeamExternalSyncConfig,
} from '../server/athleticSyncService.ts';
import { buildTimedTeamCalendarIcs } from '../server/teamCalendarIcs.ts';
import {
  resetVapidKeyCacheForTest,
  saveUserPushSubscription,
  setPushNotificationSenderForTest,
} from '../server/pushNotificationService.ts';
import {
  SESSION_COOKIE_NAME,
  issueSessionToken,
} from '../server/securityUtils.ts';
import {
  bulkCreateAndSendInvites,
  claimTeamJoinInvite,
  createTeamForCoach,
} from '../server/teamService.ts';
import { removeTeamFromDirectoryAndVault } from '../server/teamLifecycleService.ts';
import {
  createDelegatedTimingSession,
  reviewDelegatedSplitSubmission,
  submitDelegatedSplits,
} from '../server/teamTimingDelegationService.ts';
import { upsertTeamEvent } from '../server/teamEventsService.ts';
import { deleteTenantVault } from '../server/tokenVault.ts';
import { buildSampleDemoCoachSquad } from '../src/data/sampleDemoData.ts';
import { PublicTeamHubPage } from '../src/components/PublicTeamHubPage.tsx';
import { CoachDailyOpsPanel } from '../src/components/coach/CoachDailyOpsPanel.tsx';
import { MeetDayHeatAndFlightModal } from '../src/components/coach/MeetDayHeatAndFlightModal.tsx';
import { AthleteTeamStatusAndNotesCard } from '../src/components/today/AthleteTeamStatusAndNotesCard.tsx';
import { FamilyMeetHubCard } from '../src/components/today/FamilyMeetHubCard.tsx';
import { ScholasticRelayAndTopTimesPanel } from '../src/components/track/ScholasticRelayAndTopTimesPanel.tsx';
import { synthesizeOfficialRaceActivity } from '../src/utils/officialRaceSynthesizer.ts';
import { buildCleanRoomPublicHubFromTeamSummary } from '../src/utils/publicTeamHubRoute.ts';
import {
  formatRaceTimingBadgeLabel,
  getRaceTimingKindLabel,
  isHandTimedRaceData,
} from '../src/utils/raceTimingBadge.ts';
import {
  synthesizeTracksideRaceActivity,
  synthesizeTracksideWorkoutActivity,
} from '../src/utils/stopwatchActivitySynthesizer.ts';
import { buildCompleteAthleteProfile } from '../src/utils/telemetryStorage.ts';
import type { ConnectedAthleteRecord, TeamSummaryWithRole } from '../src/types.ts';

function buildRosterFromSquad(squad: TeamSummaryWithRole): ConnectedAthleteRecord[] {
  const baseProfile = buildCompleteAthleteProfile({});
  return (squad.memberships || [])
    .filter((m) => m.role === 'ATHLETE' && m.status !== 'REVOKED')
    .map((m) => ({
      id: m.membershipId,
      name: m.invitedName,
      avatarInitials: m.invitedName.slice(0, 2).toUpperCase(),
      location: 'Palo Alto, CA',
      stravaAthleteId: m.membershipId,
      inviteCode: 'TEST',
      role: 'COACH_EDIT' as const,
      status: 'CONNECTED' as const,
      primaryGoalSummary: m.seedMarkOrFtp || 'Track & XC',
      primarySport: 'Running' as const,
      eventGroup: m.eventGroup,
      teamMemberStatus: m.status,
      isMinorU18: m.isMinorU18,
      genderDivision: m.genderDivision,
      athleteProfile: baseProfile,
      privacySettings: {
        shareWellnessAndHrv: 'COACHES_ONLY',
        sharePmcAndZones: 'ALL_CONNECTIONS',
        shareGpsRoutes: 'PRIVATE',
        stravaComplianceShield: true,
        allowCoachCalendarEdits: true,
        safeSportHideWeight: Boolean(squad.brand.defaultSafeSportShield),
      },
      wellnessDays: [],
      activities: m.coachRecordedActivities || [],
      plannedEvents: [],
      targetGoals: [],
    }));
}

function authCookie(userId: string, sid: string): string {
  return `${SESSION_COOKIE_NAME}=${issueSessionToken(userId, sid, 'verified')}`;
}

describe('Phase 2: Honest Splits, Split Push, Public Hub Opt-In, Timed .ics & Family/Coach RSVP Ops', () => {
  const createdTeamIds: string[] = [];
  const createdPushSids: string[] = [];
  const origEnv = { ...process.env };
  let server: http.Server;
  let baseUrl = '';

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

  afterEach(async () => {
    setPushNotificationSenderForTest(null);
    resetVapidKeyCacheForTest();
    process.env = { ...origEnv };
    while (createdPushSids.length > 0) {
      const sid = createdPushSids.pop();
      if (sid) deleteTenantVault(`push_subs_${sid.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
    }
    while (createdTeamIds.length > 0) {
      const id = createdTeamIds.pop();
      if (id) {
        deleteTenantVault(`team_events_${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
        deleteTenantVault(`team_rsvps_${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
        await removeTeamFromDirectoryAndVault(id).catch(() => undefined);
      }
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
  });

  it('distinguishes Hand-Timed vs Official FAT accurately across synthesizers and raceTimingBadge', () => {
    const workoutAct = synthesizeTracksideWorkoutActivity({
      runnerId: 'ath-1',
      runnerName: 'Jordan Reyes',
      thresholdPaceSecsPerKm: 235,
      presetLabel: '4x400m R',
      repDistanceMeters: 400,
      restDurationSecs: 90,
      lapSplitsSecs: [64.2, 63.8, 63.4, 62.9],
      dateIso: '2026-11-23',
    });
    expect(workoutAct.sourceBadges).toEqual(['Hand-Timed']);

    const handRaceAct = synthesizeTracksideRaceActivity({
      runnerId: 'ath-1',
      runnerName: 'Jordan Reyes',
      sessionTitle: 'Dual Meet #1',
      eventLabel: '800m',
      eventDistanceMeters: 800,
      lapSplitDistanceMeters: 400,
      lapSplitsSecs: [59.8, 61.2],
      netTotalSecs: 121.0,
      dateIso: '2026-11-23',
      capturedByName: 'Manager Sam',
      timingStation: 'START_FINISH',
    });
    expect(isHandTimedRaceData(handRaceAct.officialRaceData, handRaceAct)).toBe(true);
    expect(getRaceTimingKindLabel(handRaceAct.officialRaceData, handRaceAct)).toBe('Hand-Timed');
    expect(formatRaceTimingBadgeLabel(handRaceAct.officialRaceData!, handRaceAct)).toContain(
      'Hand-Timed'
    );
    expect(formatRaceTimingBadgeLabel(handRaceAct.officialRaceData!, handRaceAct)).not.toContain(
      'FAT'
    );

    const officialFatAct = synthesizeOfficialRaceActivity({
      id: 'fat-800',
      date: '2026-11-20',
      meetName: 'CCS Finals',
      eventLabel: '800m',
      eventDistanceMeters: 800,
      lapSplitDistanceMeters: 400,
      fatTimeSecs: 117.42,
      displayFatTime: '1:57.42',
      platform: 'Athletic.net',
      trackType: 'OUTDOOR_400M',
      lapSplitsSecs: [58.1, 59.32],
      placeFinish: '2nd',
      includeWarmupCooldown: false,
    });
    expect(isHandTimedRaceData(officialFatAct.officialRaceData, officialFatAct)).toBe(false);
    expect(getRaceTimingKindLabel(officialFatAct.officialRaceData, officialFatAct)).toBe(
      'Official FAT'
    );
    expect(formatRaceTimingBadgeLabel(officialFatAct.officialRaceData!, officialFatAct)).toContain(
      'FAT'
    );
  });

  it('dispatches SafeSport-redacted Web Push on split approval to athlete + linked guardian and never blocks when sender fails', async () => {
    const coachSid = `hc-${crypto.randomBytes(6).toString('hex')}`;
    const athSid = `ath-${crypto.randomBytes(6).toString('hex')}`;
    const parentSid = `par-${crypto.randomBytes(6).toString('hex')}`;
    createdPushSids.push(coachSid, athSid, parentSid);

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: 'https://meetready.app',
      name: 'Lincoln Track & Field',
      shortName: 'LTF',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
      externalSync: { enablePublicParentHub: true },
    });
    createdTeamIds.push(team.brand.teamId);

    const currentYear = new Date().getFullYear();
    await bulkCreateAndSendInvites({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: 'https://meetready.app',
      rows: [
        {
          invitedName: 'Maya Minor Runner',
          invitedEmail: 'maya@lincoln.org',
          parentGuardianEmail: 'parent.maya@lincoln.org',
          squadGroup: 'Distance',
          eventGroup: 'DISTANCE',
          isMinorU18: true,
        },
      ],
    });
    const claim = await claimTeamJoinInvite({
      callerSid: athSid,
      originUrl: 'https://meetready.app',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Maya Minor Runner',
      athleteEmail: 'maya@lincoln.org',
      birthYear: currentYear - 16,
      parentGuardianEmail: 'parent.maya@lincoln.org',
    });
    expect(claim.ok).toBe(true);
    const athMembershipId = claim.summary!.myMembershipId;

    await followTeamAsParentOrFan({
      callerSid: parentSid,
      codeOrSlug: team.brand.slug,
      followerName: 'Elena Minor-Parent',
      verifiedEmail: 'parent.maya@lincoln.org',
      originUrl: 'https://meetready.app',
    });

    await saveUserPushSubscription({
      userSid: athSid,
      endpoint: 'https://push.example.com/ath-device',
      keys: { p256dh: 'p-ath', auth: 'a-ath' },
    });
    await saveUserPushSubscription({
      userSid: parentSid,
      endpoint: 'https://push.example.com/parent-device',
      keys: { p256dh: 'p-par', auth: 'a-par' },
    });

    const delivered: Array<{ endpoint: string; title: string; body: string; url: string }> = [];
    setPushNotificationSenderForTest(async (sub, payloadJson) => {
      const parsed = JSON.parse(payloadJson) as {
        title: string;
        body: string;
        url: string;
      };
      delivered.push({ endpoint: sub.endpoint, ...parsed });
      return { statusCode: 201 };
    });

    const session = await createDelegatedTimingSession({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: 'https://meetready.app',
      meetTitle: 'Bay League Dual',
      meetDate: '2026-11-24',
      eventCode: '800',
      eventLabel: '800m',
      stationType: 'START_FINISH',
      runners: [{ membershipId: athMembershipId, athleteName: 'Maya Minor Runner' }],
    });
    expect(session.ok).toBe(true);

    const runnerKey = session.session!.runners[0].entryKey;
    const submitted = await submitDelegatedSplits({
      passCode: session.session!.passCode,
      callerSid: athSid,
      capturedByName: 'Team Timer',
      entries: [
        {
          entryKey: runnerKey,
          athleteName: 'Maya Minor Runner',
          totalSecs: 138.4,
          lapSplitsSecs: [68.2, 70.2],
        },
      ],
      originUrl: 'https://meetready.app',
    });
    expect(submitted.ok).toBe(true);

    const approved = await reviewDelegatedSplitSubmission({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      submissionId: submitted.submission!.submissionId,
      action: 'APPROVE',
      originUrl: 'https://meetready.app',
    });
    expect(approved.ok).toBe(true);
    expect(delivered).toHaveLength(2);
    expect(delivered.map((d) => d.endpoint).sort()).toEqual([
      'https://push.example.com/ath-device',
      'https://push.example.com/parent-device',
    ]);
    // Minor PII must be redacted on lock screen
    expect(delivered[0].body).not.toContain('Maya');
    expect(delivered[0].body).toContain('hand-timed split');

    // Non-blocking: failing push sender must still approve second submission cleanly
    setPushNotificationSenderForTest(async () => {
      throw new Error('Transient push outage');
    });
    const submitted2 = await submitDelegatedSplits({
      passCode: session.session!.passCode,
      callerSid: athSid,
      capturedByName: 'Team Timer',
      entries: [
        {
          entryKey: runnerKey,
          athleteName: 'Maya Minor Runner',
          totalSecs: 137.1,
          lapSplitsSecs: [67.8, 69.3],
        },
      ],
      originUrl: 'https://meetready.app',
    });
    const approved2 = await reviewDelegatedSplitSubmission({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      submissionId: submitted2.submission!.submissionId,
      action: 'APPROVE',
      originUrl: 'https://meetready.app',
    });
    expect(approved2.ok).toBe(true);
  });

  it('keeps unofficial splits off Public Hub by default, enables SafeSport opt-in splits + Live Results/Delay metadata, and serves timed revocable .ics feeds', async () => {
    const coachSid = crypto.randomBytes(12).toString('hex');
    const athSid = crypto.randomBytes(12).toString('hex');
    const parentSid = crypto.randomBytes(12).toString('hex');
    const coachCookie = authCookie('usr_p2_coach', coachSid);
    const athCookie = authCookie('usr_p2_ath', athSid);

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: baseUrl,
      name: 'Fremont Firebirds Track',
      shortName: 'FFT',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
      externalSync: { enablePublicParentHub: true, publishUnofficialSplits: false },
    });
    const teamId = team.brand.teamId;
    createdTeamIds.push(teamId);

    await bulkCreateAndSendInvites({
      callerSid: coachSid,
      teamId,
      originUrl: baseUrl,
      rows: [
        {
          invitedName: 'Carlos Navarro',
          invitedEmail: 'carlos@fft.org',
          parentGuardianEmail: 'family.carlos@fft.org',
          squadGroup: 'Varsity',
          eventGroup: 'DISTANCE',
          isMinorU18: true,
        },
      ],
    });
    const claimed = await claimTeamJoinInvite({
      callerSid: athSid,
      originUrl: baseUrl,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Carlos Navarro',
      athleteEmail: 'carlos@fft.org',
      birthYear: new Date().getFullYear() - 16,
      parentGuardianEmail: 'family.carlos@fft.org',
    });
    const athMemId = claimed.summary!.myMembershipId;

    await followTeamAsParentOrFan({
      callerSid: parentSid,
      codeOrSlug: team.brand.slug,
      followerName: 'Navarro Family',
      verifiedEmail: 'family.carlos@fft.org',
      originUrl: baseUrl,
    });

    // Attach coach-approved hand-timed split
    const timingSess = await createDelegatedTimingSession({
      callerSid: coachSid,
      teamId,
      originUrl: baseUrl,
      meetTitle: 'De Anza Dual',
      meetDate: '2026-11-28',
      eventCode: '1600',
      eventLabel: '1600m',
      stationType: 'START_FINISH',
      runners: [{ membershipId: athMemId, athleteName: 'Carlos Navarro' }],
    });
    const subRes = await submitDelegatedSplits({
      passCode: timingSess.session!.passCode,
      callerSid: athSid,
      capturedByName: 'Manager Lin',
      entries: [
        {
          entryKey: timingSess.session!.runners[0].entryKey,
          athleteName: 'Carlos Navarro',
          totalSecs: 274.5,
          lapSplitsSecs: [67.2, 68.5, 69.4, 69.4],
        },
      ],
      originUrl: baseUrl,
    });
    expect(subRes.ok).toBe(true);
    await reviewDelegatedSplitSubmission({
      callerSid: coachSid,
      teamId,
      submissionId: subRes.submission!.submissionId,
      action: 'APPROVE',
      originUrl: baseUrl,
    });

    // Create PUBLIC_HUB event with delay, bus time & liveResultsUrl
    await upsertTeamEvent({
      callerSid: coachSid,
      teamId,
      originUrl: baseUrl,
      input: {
        eventType: 'MEET',
        title: 'CCS Championship Prelim',
        date: '2026-12-12',
        startTime: '15:30',
        endTime: '19:00',
        locationName: 'Gilroy Stadium',
        busDepartureTime: '13:45',
        meetDelayMinutes: 20,
        liveResultsUrl: 'https://live.athletic.net/meets/ccs-prelim',
        liveResultsLabel: 'AthleticLIVE Prelim',
        visibilityScope: 'PUBLIC_HUB',
      },
    });

    // Default publishUnofficialSplits: false -> zero unofficial splits exposed, zero leaks into officialResults
    const hubDefault = await getPublicTeamHubBySlugOrCode(team.brand.slug);
    expect(hubDefault.found).toBe(true);
    expect(hubDefault.unofficialStopwatchSplits).toBeUndefined();
    expect(hubDefault.rosterLeaderboard[0].officialResults).toHaveLength(0);
    expect(hubDefault.upcomingMeets[0].liveResultsUrl).toBe(
      'https://live.athletic.net/meets/ccs-prelim'
    );
    expect(hubDefault.upcomingMeets[0].meetDelayMinutes).toBe(20);
    expect(hubDefault.upcomingMeets[0].busDepartureTime).toBe('13:45');

    // Opt-in publishUnofficialSplits: true -> projects SafeSport initials + Hand-Timed badge
    await updateTeamExternalSyncConfig({
      callerSid: coachSid,
      teamId,
      originUrl: baseUrl,
      config: { enablePublicParentHub: true, publishUnofficialSplits: true },
    });
    const hubOptIn = await getPublicTeamHubBySlugOrCode(team.brand.slug);
    expect(hubOptIn.unofficialStopwatchSplits).toHaveLength(1);
    expect(hubOptIn.unofficialStopwatchSplits![0].timingLabel).toBe('Hand-Timed');
    expect(hubOptIn.unofficialStopwatchSplits![0].athleteDisplayName).toBe('Carlos N.');

    const hubHtml = renderToStaticMarkup(
      React.createElement(PublicTeamHubPage, {
        slugOrCode: team.brand.slug,
        isDark: false,
        onToggleDark: () => {},
        initialPayloadForTest: hubOptIn,
        onExitHub: () => {},
      })
    );
    expect(hubHtml).toContain('data-testid="public-hub-unofficial-splits"');
    expect(hubHtml).toContain('Unofficial · Hand-Timed');
    expect(hubHtml).toContain('data-testid="public-hub-live-results-link"');
    expect(hubHtml).toContain('+20m Delay');

    // Timed RFC 5545 buildTimedTeamCalendarIcs
    const sampleIcs = buildTimedTeamCalendarIcs({
      teamName: 'Fremont Firebirds Track',
      shortName: 'FFT',
      slug: team.brand.slug,
      timezone: 'America/New_York',
      events: [
        {
          uid: 'timed-1',
          title: 'Timed Finals',
          date: '2026-12-12',
          startTime: '15:30',
          endTime: '18:00',
          meetDelayMinutes: 15,
          liveResultsUrl: 'https://live.athletic.net/meets/123',
        },
        { uid: 'allday-1', title: 'Untimed Banquet', date: '2026-12-14' },
      ],
    });
    expect(sampleIcs).toContain('DTSTART;TZID=America/New_York:20261212T153000');
    expect(sampleIcs).toContain('DTEND;TZID=America/New_York:20261212T180000');
    expect(sampleIcs).toContain('SEQUENCE:');
    expect(sampleIcs).toContain('LAST-MODIFIED:');
    expect(sampleIcs).toContain('URL:https://live.athletic.net/meets/123');
    expect(sampleIcs).toContain('DTSTART;VALUE=DATE:20261214');

    // Private calendar feed endpoints & token rotation
    const unauthMeta = await fetch(`${baseUrl}/api/teams/${teamId}/calendar-feed/meta`);
    expect(unauthMeta.status).toBe(401);

    const metaRes = await fetch(`${baseUrl}/api/teams/${teamId}/calendar-feed/meta`, {
      headers: { Cookie: coachCookie },
    });
    expect(metaRes.status).toBe(200);
    const metaJson = (await metaRes.json()) as {
      feedUrl: string;
      webcalUrl: string;
      googleCalendarUrl: string;
    };
    const token1Path = new URL(metaJson.feedUrl).pathname;
    const icsRes1 = await fetch(`${baseUrl}${token1Path}`);
    expect(icsRes1.status).toBe(200);
    const icsText1 = await icsRes1.text();
    expect(icsText1).toContain('CCS Championship Prelim');
    expect(icsText1).not.toContain('carlos@fft.org');

    // Athlete cannot rotate token (403)
    const athRotateRes = await fetch(`${baseUrl}/api/teams/${teamId}/calendar-feed/rotate`, {
      method: 'POST',
      headers: { Cookie: athCookie },
    });
    expect(athRotateRes.status).toBe(403);

    // Coach rotates token -> old link returns 404, new link returns 200
    const coachRotateRes = await fetch(`${baseUrl}/api/teams/${teamId}/calendar-feed/rotate`, {
      method: 'POST',
      headers: { Cookie: coachCookie },
    });
    expect(coachRotateRes.status).toBe(200);
    const rotatedJson = (await coachRotateRes.json()) as { feedUrl: string };
    expect(rotatedJson.feedUrl).not.toBe(metaJson.feedUrl);
    const oldTokenCheck = await fetch(`${baseUrl}${token1Path}`);
    expect(oldTokenCheck.status).toBe(404);
    const newTokenPath = new URL(rotatedJson.feedUrl).pathname;
    const newTokenCheck = await fetch(`${baseUrl}${newTokenPath}`);
    expect(newTokenCheck.status).toBe(200);

    // Demo CleanRoom Hub respects publishUnofficialSplits
    const baseSquad = buildSampleDemoCoachSquad('2026-11-23');
    const cleanOff = buildCleanRoomPublicHubFromTeamSummary(baseSquad);
    expect(cleanOff.unofficialStopwatchSplits).toBeUndefined();
  });

  it('renders FamilyMeetHubCard for parents, Athlete splits/RSVP card, and Coach RSVP conflict controls', () => {
    const todayIso = '2026-11-23';
    const baseSquad = buildSampleDemoCoachSquad(todayIso);
    const firstAthlete = baseSquad.memberships.find((m) => m.role === 'ATHLETE')!;

    const handRaceAct = synthesizeTracksideRaceActivity({
      runnerId: firstAthlete.membershipId,
      runnerName: firstAthlete.invitedName,
      sessionTitle: 'Home Tri-Meet',
      eventLabel: '1600m',
      eventDistanceMeters: 1600,
      lapSplitDistanceMeters: 400,
      lapSplitsSecs: [70.2, 71.8, 72.1, 69.5],
      netTotalSecs: 283.6,
      dateIso: todayIso,
      capturedByName: 'Manager Pat',
    });

    const parentTeam: TeamSummaryWithRole = {
      ...baseSquad,
      myRole: 'PARENT_FOLLOWER',
      myLinkedChildMembershipIds: [firstAthlete.membershipId],
      myMeetDaySchedule: [
        {
          packetId: 'pkt-1',
          meetTitle: 'Saturday Invitational',
          meetDate: '2026-11-28',
          eventCode: '1600',
          seedMarkRaw: '4:42.0',
          officialHeat: 2,
          officialLaneOrHip: 'Hip 4',
        },
      ],
      memberships: baseSquad.memberships.map((m) =>
        m.membershipId === firstAthlete.membershipId
          ? { ...m, coachRecordedActivities: [handRaceAct] }
          : m
      ),
    };

    const familyHtml = renderToStaticMarkup(
      React.createElement(FamilyMeetHubCard, {
        activeTeam: parentTeam,
        todayIso,
        isSampleDemoMode: true,
      })
    );
    expect(familyHtml).toContain('data-testid="family-meet-hub-card"');
    expect(familyHtml).toContain('data-testid="family-latest-splits-list"');
    expect(familyHtml).toContain('Hand-Timed');
    expect(familyHtml).not.toContain('Official FAT');
    expect(familyHtml).toContain('Saturday Invitational');
    expect(familyHtml).toContain('Hip 4');

    const athleteTeam: TeamSummaryWithRole = {
      ...baseSquad,
      myRole: 'ATHLETE',
      myMembershipId: firstAthlete.membershipId,
      memberships: parentTeam.memberships,
    };
    const athleteHtml = renderToStaticMarkup(
      React.createElement(AthleteTeamStatusAndNotesCard, {
        activeTeam: athleteTeam,
        myTeams: [athleteTeam],
        todayIso,
        isSampleDemoMode: true,
        activities: [handRaceAct],
      })
    );
    expect(athleteHtml).toContain('data-testid="athlete-upcoming-rsvp-section"');
    expect(athleteHtml).toContain('data-testid="athlete-latest-splits-card"');
    expect(athleteHtml).toContain('Hand-Timed');

    // Coach RSVP ops glue: Meet Day banner, Relay exclusion, Roll Call Apply RSVPs
    const rsvpConflicts = {
      [firstAthlete.membershipId]: {
        eventId: 'ev-1',
        membershipId: firstAthlete.membershipId,
        status: 'OUT' as const,
        updatedByRole: 'PARENT_FOLLOWER' as const,
        updatedAt: `${todayIso}T12:00:00Z`,
      },
    };

    const meetModalHtml = renderToStaticMarkup(
      React.createElement(MeetDayHeatAndFlightModal, {
        isOpen: true,
        inline: true,
        onClose: () => {},
        activeTeam: baseSquad,
        connectedAthletes: buildRosterFromSquad(baseSquad),
        meetRsvpsByMemberId: rsvpConflicts,
      })
    );
    expect(meetModalHtml).toContain('data-testid="meet-rsvp-conflict-banner"');
    expect(meetModalHtml).toContain('data-testid="meet-scratch-conflict-btn"');
    expect(meetModalHtml).toContain(firstAthlete.invitedName);

    const roster = buildRosterFromSquad(baseSquad);
    const relayHtml = renderToStaticMarkup(
      React.createElement(ScholasticRelayAndTopTimesPanel, {
        candidates: roster.map((r) => ({
          id: r.id,
          name: r.name,
          thresholdPaceSecsPerKm: r.athleteProfile.thresholdPaceSecsPerKm || 245,
          genderDivision: r.genderDivision,
        })),
        roster,
        meetRsvpsByMemberId: rsvpConflicts,
      })
    );
    expect(relayHtml).toContain('data-testid="relay-exclude-rsvp-out-toggle"');
    expect(relayHtml).toContain('1 unavailable');

    const rollCallHtml = renderToStaticMarkup(
      React.createElement(CoachDailyOpsPanel, {
        activeTeam: baseSquad,
        myTeams: [baseSquad],
        complexityTier: 'ESSENTIALS',
        todayRsvpsByMemberId: rsvpConflicts,
        onLaunchStopwatch: () => {},
        onLaunchFieldSheet: () => {},
        onTeamsUpdated: () => {},
      })
    );
    expect(rollCallHtml).toContain('data-testid="roll-call-apply-rsvps-btn"');
  });
});
