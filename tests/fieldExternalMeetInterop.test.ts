import fs from 'fs';
import os from 'os';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  ALL_MEET_DAY_EVENTS,
  applyDelayToMeetTimeString,
  applyImportedAssignmentsToEntries,
  buildMeetDayPacketHtml,
  deserializePacketEntriesToMeetEntries,
  downloadMeetPacketHtmlFallback,
  formatOfficialLaneOrHip,
  groupEntriesIntoRelaySquads,
  openPrintableMeetDayPacketWindow,
  parseExternalHeatSheetForRoster,
  seedTrackHeats,
  serializeMeetEntriesToPacketEntries,
  validateNfhsFourEventLimits,
  type MeetEntryRecord,
} from '../src/physiology/meetDayOpsEngine';
import {
  MeetDayHeatAndFlightModal,
  buildEntriesFromRosterMarks,
} from '../src/components/coach/MeetDayHeatAndFlightModal';
import { ExternalHeatSheetImportPanel } from '../src/components/coach/ExternalHeatSheetImportPanel';
import {
  parseOfficialResultsTextDeterministically,
  synthesizeOfficialRaceActivity,
} from '../src/utils/officialRaceSynthesizer';
import { synthesizeTracksideRaceActivity } from '../src/utils/stopwatchActivitySynthesizer';
import {
  isStopwatchWearableSameSessionMatch,
  mergeActivitiesNonDestructive,
} from '../src/utils/telemetryStorage';
import { createTeamForCoach } from '../server/teamService.ts';
import {
  listMeetDayPackets,
  saveMeetDayPacket,
} from '../server/teamMeetDayOpsService.ts';
import { applyExternalTeamSyncBatch } from '../server/athleticSyncService.ts';
import { loadTeamDocRaw, saveTeamDocRaw, teamDocVaultKey, userTeamsVaultKey } from '../server/teamStoreCore.ts';
import { deleteTenantVault } from '../server/tokenVault.ts';
import type {
  FieldEventLogRecord,
  TeamMembershipRecord,
  TeamSummaryWithRole,
  UnifiedActivity,
} from '../src/types';

function makeMembership(overrides: Partial<TeamMembershipRecord>): TeamMembershipRecord {
  const id = overrides.membershipId || 'mem-1';
  return {
    membershipId: id,
    teamId: overrides.teamId || 't1',
    userSid: `user-${id}`,
    invitedName: 'Devon Carter',
    role: 'ATHLETE',
    status: 'ACTIVE',
    genderDivision: 'M',
    squadGroup: 'Boys Varsity',
    isMinorU18: false,
    invitedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeBrand(teamId: string, name: string) {
  return {
    teamId,
    name,
    shortName: 'OAK',
    slug: teamId.toLowerCase(),
    joinCode: 'OAK123',
    orgType: 'HIGH_SCHOOL' as const,
    primarySport: 'Running' as const,
    primaryHex: '#1E5631',
    secondaryHex: '#D97706',
    defaultSafeSportShield: true,
    enableParentGuardianCc: true,
    coachDisplayName: 'Coach Morales',
    createdAt: '2026-01-01T00:00:00Z',
  };
}

function makeEntry(overrides: Partial<MeetEntryRecord>): MeetEntryRecord {
  return {
    id: 'e-1',
    athleteId: 'ath-1',
    athleteName: 'Devon Carter',
    genderDivision: 'M',
    division: 'Varsity',
    eventCode: '100m',
    seedMark: '10.94',
    ...overrides,
  };
}

function makeWatchActivity(overrides: Partial<UnifiedActivity> = {}): UnifiedActivity {
  return {
    id: 'garmin-race-1',
    startDateLocal: '2026-04-18T14:29:55',
    name: 'Afternoon Run',
    sportCategory: 'Running',
    environment: 'OUTDOOR',
    subType: 'Track',
    movingTimeSecs: 264,
    distanceMeters: 1612,
    elevationGainMeters: 2,
    trainingLoad: 38,
    loadModelVersion: 3,
    avgHr: 181,
    maxHr: 196,
    avgCadence: 196,
    avgPaceSecsPerKm: 164,
    gapPaceSecsPerKm: 164,
    aerobicDecouplingPct: 1.2,
    efficiencyFactor: 1.98,
    firstHalfEf: 2.0,
    secondHalfEf: 1.96,
    deviceName: 'Garmin Forerunner 965',
    zoneSecs: {
      hr: [0, 0, 12, 42, 110, 80, 20],
      pace: [0, 0, 12, 42, 110, 80, 20],
    },
    stravaPrCount: 0,
    segmentEfforts: [],
    sourceBadges: ['Garmin'],
    ...overrides,
  };
}

const cleanupKeys: string[] = [];

afterAll(() => {
  for (const key of cleanupKeys) {
    try {
      deleteTenantVault(key);
    } catch {
      // ignore
    }
  }
});

describe('External Meet Interop & 3-Layer Official FAT/Stopwatch/Wearable Reconciliation', () => {
  it('groups relays into 1 heat/lane slot per squad with legs 1-4 and separates alternates', () => {
    const squadEntries: MeetEntryRecord[] = [
      makeEntry({
        id: 'rel-1',
        athleteId: 'ath-1',
        athleteName: 'Devon Carter',
        eventCode: '4x100m',
        seedMark: '42.85',
        relayTeamCode: 'A',
        relayLegOrder: 1,
        officialHeat: 2,
        officialLaneOrHip: 'Lane 4',
        eventStartTime: '2:15 PM',
      }),
      makeEntry({
        id: 'rel-2',
        athleteId: 'ath-2',
        athleteName: 'Noah Lee',
        eventCode: '4x100m',
        seedMark: '42.85',
        relayTeamCode: 'A',
        relayLegOrder: 2,
      }),
      makeEntry({
        id: 'rel-3',
        athleteId: 'ath-3',
        athleteName: 'Marcus Vance',
        eventCode: '4x100m',
        seedMark: '42.85',
        relayTeamCode: 'A',
        relayLegOrder: 3,
      }),
      makeEntry({
        id: 'rel-4',
        athleteId: 'ath-4',
        athleteName: 'Ethan Cole',
        eventCode: '4x100m',
        seedMark: '42.85',
        relayTeamCode: 'A',
        relayLegOrder: 4,
      }),
      makeEntry({
        id: 'rel-alt',
        athleteId: 'ath-5',
        athleteName: 'Liam Brooks',
        eventCode: '4x100m',
        seedMark: '42.85',
        relayTeamCode: 'A',
        isAlternate: true,
      }),
    ];

    const squads = groupEntriesIntoRelaySquads(squadEntries);
    expect(squads).toHaveLength(1);
    expect(squads[0].activeLegs.map((l) => l.athleteName)).toEqual([
      'Devon Carter',
      'Noah Lee',
      'Marcus Vance',
      'Ethan Cole',
    ]);
    expect(squads[0].alternates.map((a) => a.athleteName)).toEqual(['Liam Brooks']);
    expect(squads[0].officialHeat).toBe(2);
    expect(squads[0].officialLaneOrHip).toBe('Lane 4');

    // Seeding must take ONLY 1 lane/heat slot rather than 4-5 lanes
    const seeded = seedTrackHeats(squadEntries, '4x100m', 8, true);
    expect(seeded).toHaveLength(1);
    expect(seeded[0].isRelaySquad).toBe(true);
    expect(seeded[0].relayLegs).toHaveLength(4);
    expect(seeded[0].relayAlternates?.map((a) => a.athleteName)).toEqual(['Liam Brooks']);
  });

  it('preserves 4-arg seedTrackHeats fast-first default, supports slowToFast option, and uses Box/Hip for >=800m', () => {
    const entries: MeetEntryRecord[] = [
      makeEntry({ id: 'm1', athleteId: 'a1', athleteName: 'Fast Runner', eventCode: '1600m', seedMark: '4:18.00' }),
      makeEntry({ id: 'm2', athleteId: 'a2', athleteName: 'Mid Runner', eventCode: '1600m', seedMark: '4:32.00' }),
      makeEntry({ id: 'm3', athleteId: 'a3', athleteName: 'Third Runner', eventCode: '1600m', seedMark: '4:48.00' }),
    ];

    const fastFirst = seedTrackHeats(entries, '1600m', 2, false);
    expect(fastFirst.find((r) => r.athleteName === 'Fast Runner')?.heatNumber).toBe(1);
    expect(fastFirst[0].positionLabel).toMatch(/^Box\/Hip /);
    expect(formatOfficialLaneOrHip('1600m', '5')).toBe('Box/Hip 5');
    expect(formatOfficialLaneOrHip('200m', '5')).toBe('Lane 5');

    const slowToFast = seedTrackHeats(entries, '1600m', 2, false, { slowToFast: true });
    expect(slowToFast.find((r) => r.athleteName === 'Third Runner')?.heatNumber).toBe(1);
    expect(slowToFast.find((r) => r.athleteName === 'Fast Runner')?.heatNumber).toBe(2);
  });

  it('skips scratched entries in NFHS 4-event limit and flags alternates as advisory only', () => {
    const entries: MeetEntryRecord[] = [
      makeEntry({ id: '1', eventCode: '100m' }),
      makeEntry({ id: '2', eventCode: '200m' }),
      makeEntry({ id: '3', eventCode: '400m' }),
      makeEntry({ id: '4', eventCode: 'LJ' }),
      makeEntry({ id: '5', eventCode: '4x100m', scratched: true }),
      makeEntry({ id: '6', eventCode: '4x400m', isAlternate: true }),
    ];

    const audit = validateNfhsFourEventLimits(entries, 4);
    expect(audit).toHaveLength(1);
    expect(audit[0].eventCount).toBe(4);
    expect(audit[0].overLimit).toBe(false);
    expect(audit[0].alternateCount).toBe(1);
    expect(audit[0].alternateEvents).toEqual(['4x400m']);
    expect(audit[0].hasAlternateAdvisory).toBe(true);
  });

  it('parses messy Hy-Tek, AthleticLIVE, and FinishLynx .evt formats without throwing and respects Clerk Overrides', () => {
    const memberships: TeamMembershipRecord[] = [
      makeMembership({ membershipId: 'm1', invitedName: 'Devon Carter', genderDivision: 'M' }),
      makeMembership({ membershipId: 'm2', invitedName: 'Chloe Okafor', genderDivision: 'F', squadGroup: 'Girls Varsity' }),
      makeMembership({ membershipId: 'm3', invitedName: 'Maya Chen', genderDivision: 'F', squadGroup: 'Girls Varsity' }),
    ];
    const teamEntries: MeetEntryRecord[] = [
      makeEntry({ id: 'e1', athleteId: 'm1', athleteName: 'Devon Carter', eventCode: '100m', genderDivision: 'M' }),
      makeEntry({
        id: 'e2',
        athleteId: 'm2',
        athleteName: 'Chloe Okafor',
        eventCode: '1600m',
        genderDivision: 'F',
        officialHeat: 1,
        officialLaneOrHip: 'Box/Hip 2',
        assignmentSource: 'CLERK_OVERRIDE',
      }),
      makeEntry({ id: 'e3', athleteId: 'm3', athleteName: 'Maya Chen', eventCode: 'LJ', genderDivision: 'F' }),
    ];
    const pktEntries = serializeMeetEntriesToPacketEntries(teamEntries);

    const hyTekSample = `
====================================================================
Event 12  Boys 100 Meter Dash Varsity
Check-In 1:40 PM   Start Time 2:15 PM
====================================================================
Heat 3 of 5
  4  Carter, Devon               11 Oak Ridge              10.94
  5  Opponent, Fast              12 West Valley            10.88

Girls 1600m Run · Heat 2 · 3:05 PM
Pos/Hip 7   Okafor, Chloe (Bib 412)
`;
    const parsedHyTek = parseExternalHeatSheetForRoster(hyTekSample, pktEntries, memberships);
    expect(parsedHyTek.matchedAssignments.length).toBeGreaterThanOrEqual(2);
    const devonMatch = parsedHyTek.matchedAssignments.find((a) => a.matchedEntryId === 'e1');
    expect(devonMatch?.officialHeat).toBe(3);
    expect(devonMatch?.officialLaneOrHip).toBe('Lane 4');
    expect(devonMatch?.eventStartTime).toBe('2:15 PM');
    expect(devonMatch?.checkInCallTime).toBe('1:40 PM');
    expect(devonMatch?.assignmentSource).toBe('IMPORTED_HYTEK');

    const chloeMatch = parsedHyTek.matchedAssignments.find((a) => a.matchedEntryId === 'e2');
    expect(chloeMatch?.officialLaneOrHip).toBe('Box/Hip 7');
    expect(chloeMatch?.bibNumber).toBe('412');

    // Clerk override must NOT be overwritten on safe merge OR replace when overwriteClerkOverrides is false
    const mergedSafe = applyImportedAssignmentsToEntries({
      entries: teamEntries,
      parseResult: parsedHyTek,
      mode: 'MERGE_PRESERVE_CLERK',
      overwriteClerkOverrides: false,
    });
    expect(mergedSafe.preservedClerkCount).toBe(1);
    const chloeAfter = mergedSafe.entries.find((e) => e.id === 'e2')!;
    expect(chloeAfter.officialHeat).toBe(1);
    expect(chloeAfter.officialLaneOrHip).toBe('Box/Hip 2');
    expect(chloeAfter.assignmentSource).toBe('CLERK_OVERRIDE');

    const devonAfter = mergedSafe.entries.find((e) => e.id === 'e1')!;
    expect(devonAfter.officialHeat).toBe(3);
    expect(devonAfter.officialLaneOrHip).toBe('Lane 4');

    // FinishLynx lynx.evt support + Long Jump flight order
    const evtText = `
15,1,2,Girls Long Jump Varsity,11:30 AM
,6,809,Chen,Maya,Oak Ridge
15,1,2,BadMalformedLineWithoutClose
`;
    const parsedEvt = parseExternalHeatSheetForRoster(evtText, pktEntries, memberships);
    const mayaMatch = parsedEvt.matchedAssignments.find((a) => a.matchedEntryId === 'e3');
    expect(mayaMatch?.officialFlight).toBe(2);
    expect(mayaMatch?.officialOrder).toBe(6);
    expect(mayaMatch?.bibNumber).toBe('809');
    expect(mayaMatch?.eventStartTime).toBe('11:30 AM');

    // Corrupt/random text must never throw
    expect(() => parseExternalHeatSheetForRoster(';;;\0\uFFFD\n###$$$\n,,,', [], [])).not.toThrow();
  });

  it('external mode never invents fake lanes/flights in printable packet, supports +Delay, itinerary, and blocked popup fallback', () => {
    const entries: MeetEntryRecord[] = [
      makeEntry({
        id: 'e1',
        athleteId: 'ath-1',
        athleteName: 'Devon Carter',
        eventCode: '100m',
        officialHeat: 3,
        officialLaneOrHip: 'Lane 5',
        eventStartTime: '2:15 PM',
        checkInCallTime: '1:50 PM',
        assignmentSource: 'IMPORTED_HYTEK',
      }),
      makeEntry({
        id: 'e2',
        athleteId: 'ath-2',
        athleteName: 'Noah Lee',
        eventCode: '200m',
      }),
    ];

    const html = buildMeetDayPacketHtml({
      teamName: 'Oak Ridge Track',
      meetTitle: 'Arcadia Invitational',
      meetDate: '2026-04-18',
      entries,
      seedingAuthority: 'EXTERNAL_MEET',
      athleticLiveUrl: 'https://live.athletic.net/meets/12345',
      meetDelayMinutes: 15,
      showItinerary: true,
    });

    expect(html).toContain('External Meet Official Program (Athletic.net / Hy-Tek / Clerk)');
    expect(html).toContain('Chronological Meet Schedule');
    expect(html).toContain('Athlete-by-Athlete Itinerary');
    expect(html).toContain('H3 Lane 5');
    expect(html).toContain('2:30 PM'); // 2:15 PM + 15m delay
    expect(applyDelayToMeetTimeString('11:50 AM', 15)).toBe('12:05 PM');
    expect(html).toContain('TBD (Official Program)');
    expect(html).not.toContain('Heat 1 · Lane 4');

    const prevWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      value: { open: () => null },
      configurable: true,
    });
    try {
      const opened = openPrintableMeetDayPacketWindow({
        teamName: 'Oak Ridge Track',
        meetTitle: 'Arcadia Invitational',
        meetDate: '2026-04-18',
        entries,
        seedingAuthority: 'EXTERNAL_MEET',
      });
      expect(opened).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'window', {
        value: prevWindow,
        configurable: true,
      });
    }

    const fallbackHtml = downloadMeetPacketHtmlFallback({
      teamName: 'Oak Ridge Track',
      meetTitle: 'Arcadia Invitational',
      meetDate: '2026-04-18',
      entries,
      seedingAuthority: 'EXTERNAL_MEET',
    });
    expect(fallbackHtml).toContain('Arcadia Invitational');
    expect(fallbackHtml).toContain('TBD (Official Program)');
  });

  it('builds entries across all multi-event marks and legal fieldMarkLogs in buildEntriesFromRosterMarks', () => {
    const fieldLogs: FieldEventLogRecord[] = [
      {
        id: 'fl-wind',
        teamId: 't1',
        membershipId: 'm1',
        athleteName: 'Devon Carter',
        date: '2026-04-10',
        eventCode: 'LJ',
        eventGroup: 'JUMPS',
        isCompetition: true,
        meetOrPracticeTitle: 'Woody Wilson',
        bestMarkMeters: 7.1,
        bestWindLegalMeters: 6.72,
        isWindAidedBest: true,
        attempts: [{ attemptNumber: 1, outcome: 'MARK', markMeters: 6.72, windMps: 1.2 }],
        createdAt: '2026-04-10T18:00:00Z',
      },
      {
        id: 'fl-sp',
        teamId: 't1',
        membershipId: 'm1',
        athleteName: 'Devon Carter',
        date: '2026-04-10',
        eventCode: 'SP',
        eventGroup: 'THROWS',
        isCompetition: true,
        meetOrPracticeTitle: 'Woody Wilson',
        bestMarkMeters: 15.24,
        attempts: [{ attemptNumber: 1, outcome: 'MARK', markMeters: 15.24 }],
        createdAt: '2026-04-10T18:00:00Z',
      },
    ];

    const team: TeamSummaryWithRole = {
      brand: makeBrand('t1', 'Oak Ridge Track'),
      myRole: 'HEAD_COACH',
      mySquadGroup: 'Varsity',
      myMembershipId: 'coach-1',
      totalInvited: 1,
      openedCount: 1,
      activeCount: 1,
      watchConnectedCount: 1,
      memberships: [
        makeMembership({
          membershipId: 'm1',
          invitedName: 'Devon Carter',
          genderDivision: 'M',
          coachRecordedActivities: [
            makeWatchActivity({
              id: 'r1',
              officialRaceData: {
                platform: 'Athletic.net',
                meetName: 'Invite 1',
                eventLabel: '100m',
                eventDistanceMeters: 100,
                fatTimeSecs: 10.92,
                displayFatTime: '10.92',
                trackType: 'OUTDOOR_400M',
                lapSplitDistanceMeters: 100,
                lapSplitsSecs: [],
                vdotScore: 60,
                includeWarmupCooldown: false,
              },
            }),
            makeWatchActivity({
              id: 'r2',
              officialRaceData: {
                platform: 'Athletic.net',
                meetName: 'Invite 1',
                eventLabel: '200m',
                eventDistanceMeters: 200,
                fatTimeSecs: 22.14,
                displayFatTime: '22.14',
                trackType: 'OUTDOOR_400M',
                lapSplitDistanceMeters: 200,
                lapSplitsSecs: [],
                vdotScore: 60,
                includeWarmupCooldown: false,
              },
            }),
            makeWatchActivity({
              id: 'r3',
              officialRaceData: {
                platform: 'Athletic.net',
                meetName: 'Invite 2',
                eventLabel: '100m',
                eventDistanceMeters: 100,
                fatTimeSecs: 11.15,
                displayFatTime: '11.15',
                trackType: 'OUTDOOR_400M',
                lapSplitDistanceMeters: 100,
                lapSplitsSecs: [],
                vdotScore: 58,
                includeWarmupCooldown: false,
              },
            }),
          ],
        }),
      ],
      announcements: [],
      broadcastWorkouts: [],
      fieldMarkLogs: fieldLogs,
    };

    const seeded = buildEntriesFromRosterMarks(team);
    const byEv = new Map(seeded.map((s) => [s.eventCode, s.seedMark]));
    // Multi-event bug fixed: BOTH 100m AND 200m seeded, picking fastest 10.92, PLUS legal LJ & SP marks
    expect(byEv.get('100m')).toBe('10.92');
    expect(byEv.get('200m')).toBe('22.14');
    expect(byEv.get('LJ')).toBe("22' 0.5\"");
    expect(byEv.get('SP')).toBe("50' 0\"");
  });

  it('renders MeetDayHeatAndFlightModal defaulting to EXTERNAL_MEET and renders import panel cleanly', () => {
    const team: TeamSummaryWithRole = {
      brand: makeBrand('live_team_ui_1', 'Oak Ridge Track'),
      myRole: 'HEAD_COACH',
      mySquadGroup: 'Varsity',
      myMembershipId: 'coach-1',
      totalInvited: 2,
      openedCount: 2,
      activeCount: 2,
      watchConnectedCount: 2,
      memberships: [
        makeMembership({ membershipId: 'm1', invitedName: 'Devon Carter', genderDivision: 'M' }),
        makeMembership({ membershipId: 'm2', invitedName: 'Chloe Okafor', genderDivision: 'F', squadGroup: 'Girls Varsity' }),
      ],
      announcements: [],
      broadcastWorkouts: [],
      meetDayPackets: [
        {
          packetId: 'mdp-ui-1',
          meetTitle: 'League Championship',
          meetDate: '2026-04-18',
          laneCount: 8,
          flightSize: 12,
          partitionByDivision: true,
          entries: [
            {
              id: 'ent-1',
              athleteName: 'Devon Carter',
              genderDivision: 'M',
              eventCode: '100m',
              seedMarkRaw: '10.92',
            },
          ],
          updatedAt: '2026-04-17T20:00:00Z',
        },
      ],
    };

    const html = renderToStaticMarkup(
      React.createElement(MeetDayHeatAndFlightModal, {
        isOpen: true,
        onClose: () => undefined,
        activeTeam: team,
        connectedAthletes: [],
        onLaunchEventStopwatch: () => undefined,
        onDelegateEventTimer: () => undefined,
      })
    );
    expect(html).toContain('data-testid="meet-authority-external"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-testid="meet-athleticlive-url-input"');
    expect(html).toContain('data-testid="meet-delay-15"');
    expect(html).toContain('data-testid="toggle-external-heat-import-btn"');
    expect(html).toContain('data-testid="meet-entry-clerk-btn-ent-1"');

    const panelHtml = renderToStaticMarkup(
      React.createElement(ExternalHeatSheetImportPanel, {
        entries: deserializePacketEntriesToMeetEntries(team.meetDayPackets![0].entries),
        memberships: team.memberships,
        onApplyImportedAssignments: () => undefined,
      })
    );
    expect(panelHtml).toContain('data-testid="external-heat-sheet-import-panel"');
    expect(panelHtml).toContain('data-testid="external-heat-sheet-textarea"');
  });

  it('sanitizes and persists external meet metadata and entry assignments via saveMeetDayPacket', async () => {
    const coachSid = `coach-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const createdTeam = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: 'https://meetready.app',
      name: 'Oak Ridge Track',
      coachDisplayName: 'Coach Morales',
      orgType: 'HIGH_SCHOOL',
    });
    const teamId = createdTeam.brand.teamId;
    cleanupKeys.push(teamDocVaultKey(teamId), userTeamsVaultKey(coachSid));

    const saveRes = await saveMeetDayPacket({
      callerSid: coachSid,
      teamId,
      originUrl: 'https://meetready.app',
      packet: {
        packetId: 'mdp-ext-persist-1',
        meetTitle: 'Woody Wilson Classic',
        meetDate: '2026-04-18',
        seedingAuthority: 'EXTERNAL_MEET',
        athleticLiveUrl: 'https://live.athletic.net/meets/99881',
        meetDelayMinutes: 20,
        entries: [
          {
            id: 'pe-1',
            athleteName: 'Devon Carter',
            membershipId: 'm1',
            genderDivision: 'M',
            division: 'Varsity',
            eventCode: '800m',
            seedMarkRaw: '1:55.80',
            officialHeat: 3,
            officialLaneOrHip: 'Box/Hip 4',
            eventStartTime: '3:15 PM',
            checkInCallTime: '2:50 PM',
            bibNumber: '514',
            assignmentSource: 'CLERK_OVERRIDE',
          },
          {
            id: 'pe-2',
            athleteName: 'Noah Lee',
            eventCode: 'LJ',
            seedMarkRaw: "21' 4\"",
            officialFlight: 2,
            officialOrder: 9,
            isAlternate: true,
            scratched: true,
            assignmentSource: 'IMPORTED_ATHLETICLIVE',
          },
        ],
      },
    });

    expect(saveRes.ok).toBe(true);
    expect(saveRes.packet?.seedingAuthority).toBe('EXTERNAL_MEET');
    expect(saveRes.packet?.athleticLiveUrl).toBe('https://live.athletic.net/meets/99881');
    expect(saveRes.packet?.meetDelayMinutes).toBe(20);
    expect(saveRes.packet?.entries[0].officialHeat).toBe(3);
    expect(saveRes.packet?.entries[0].officialLaneOrHip).toBe('Box/Hip 4');
    expect(saveRes.packet?.entries[0].assignmentSource).toBe('CLERK_OVERRIDE');
    expect(saveRes.packet?.entries[1].officialFlight).toBe(2);
    expect(saveRes.packet?.entries[1].officialOrder).toBe(9);
    expect(saveRes.packet?.entries[1].scratched).toBe(true);
    expect(saveRes.packet?.entries[1].isAlternate).toBe(true);

    // Unsafe URLs must be dropped
    const xssRes = await saveMeetDayPacket({
      callerSid: coachSid,
      teamId,
      originUrl: 'https://meetready.app',
      packet: {
        packetId: 'mdp-ext-persist-1',
        meetTitle: 'Woody Wilson Classic',
        meetDate: '2026-04-18',
        athleticLiveUrl: 'javascript:alert(1)',
        meetDelayMinutes: 999,
        entries: [],
      },
    });
    expect(xssRes.packet?.athleticLiveUrl).toBeUndefined();
    expect(xssRes.packet?.meetDelayMinutes).toBe(240);

    const listed = await listMeetDayPackets({ callerSid: coachSid, teamId });
    expect(listed.ok).toBe(true);
    expect(listed.packets).toHaveLength(1);
  });

  it('defaults Official FAT parsing to includeWarmupCooldown=false, tags synthetic splits, and keeps athleticSync empty splits without clobbering stopwatch splits', async () => {
    const parsedNoSplits = parseOfficialResultsTextDeterministically(
      '2026-04-18 | Woody Wilson Classic | 1600m | 4:16.40a | 1st | Outdoor 400m | Athletic.net'
    );
    expect(parsedNoSplits).toHaveLength(1);
    expect(parsedNoSplits[0].includeWarmupCooldown).toBe(false);
    expect(parsedNoSplits[0].splitsEstimated).toBe(true);
    const synthEst = synthesizeOfficialRaceActivity(parsedNoSplits[0]);
    expect(synthEst.officialRaceData?.includeWarmupCooldown).toBe(false);
    expect(synthEst.officialRaceData?.splitsEstimated).toBe(true);

    const parsedExplicit = parseOfficialResultsTextDeterministically(
      '2026-04-18 | Woody Wilson Classic | 800m | 1:56.38a | 2nd | Outdoor 400m | Splits: 56.92, 59.46 | Athletic.net'
    );
    expect(parsedExplicit[0].splitsEstimated).toBe(false);

    // athleticSyncService leaves empty lapSplitsSecs: [] and preserves pre-existing stopwatch splits
    const coachSid = `coach-sync-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const createdTeam = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: 'https://meetready.app',
      name: 'Oak Ridge Sync',
      coachDisplayName: 'Coach Vega',
      orgType: 'HIGH_SCHOOL',
    });
    const teamId = createdTeam.brand.teamId;
    cleanupKeys.push(teamDocVaultKey(teamId), userTeamsVaultKey(coachSid));

    await applyExternalTeamSyncBatch({
      callerSid: coachSid,
      teamId,
      originUrl: 'https://meetready.app',
      results: [
        {
          athleteName: 'Jordan Hayes',
          date: '2026-04-18',
          meetName: 'Arcadia',
          eventLabel: '1600m',
          eventDistanceMeters: 1600,
          fatTimeSecs: 256.4,
          displayFatTime: '4:16.40',
          platform: 'Athletic.net',
          trackType: 'OUTDOOR_400M',
          externalSource: 'ATHLETIC_NET',
        },
      ],
    });

    const doc1 = await loadTeamDocRaw(teamId);
    const jordan = doc1!.memberships.find((m) => m.invitedName === 'Jordan Hayes')!;
    const syncedRace = jordan.coachRecordedActivities![0];
    expect(syncedRace.officialRaceData?.lapSplitsSecs).toEqual([]);
    expect(syncedRace.officialRaceData?.splitsEstimated).toBe(true);
    expect(syncedRace.officialRaceData?.includeWarmupCooldown).toBe(false);

    // Now seed an existing stopwatch race with real splits and verify syncing FAT reconciles without clobbering real splits
    const stopwatchRace = synthesizeTracksideRaceActivity({
      runnerId: 'devon-1',
      runnerName: 'Devon Carter',
      sessionTitle: 'Arcadia Invitational',
      eventLabel: '800m',
      eventDistanceMeters: 800,
      lapSplitDistanceMeters: 400,
      lapSplitsSecs: [57.12, 58.3],
      netTotalSecs: 115.42,
      dateIso: '2026-04-18',
      startDateLocalIso: '2026-04-18T14:22:00',
    });
    stopwatchRace.officialRaceData = {
      ...stopwatchRace.officialRaceData!,
      platform: 'MeetReady Stopwatch',
      capturedByName: 'Coach Morales',
      timingStation: 'START_FINISH',
    };
    doc1!.memberships.push({
      membershipId: 'devon-mem',
      teamId,
      invitedName: 'Devon Carter',
      role: 'ATHLETE',
      status: 'ACTIVE',
      squadGroup: 'Boys Varsity',
      isMinorU18: false,
      invitedAt: '2026-04-01T00:00:00Z',
      coachRecordedActivities: [stopwatchRace],
    });
    await saveTeamDocRaw(teamId, doc1!);

    await applyExternalTeamSyncBatch({
      callerSid: coachSid,
      teamId,
      originUrl: 'https://meetready.app',
      results: [
        {
          athleteName: 'Devon Carter',
          date: '2026-04-18',
          meetName: 'Arcadia Invitational',
          eventLabel: '800m',
          eventDistanceMeters: 800,
          fatTimeSecs: 115.18,
          displayFatTime: '1:55.18',
          placeFinish: '1st (Invitational)',
          platform: 'Athletic.net',
          trackType: 'OUTDOOR_400M',
          externalSource: 'ATHLETIC_NET',
        },
      ],
    });

    const doc2 = await loadTeamDocRaw(teamId);
    const devonMem = doc2!.memberships.find((m) => m.invitedName === 'Devon Carter')!;
    expect(devonMem.coachRecordedActivities).toHaveLength(1);
    const rec = devonMem.coachRecordedActivities![0].officialRaceData!;
    expect(rec.fatTimeSecs).toBe(115.18);
    expect(rec.handTimedTotalSecs).toBe(115.42);
    expect(rec.lapSplitsSecs).toEqual([57.12, 58.3]);
    expect(rec.capturedByName).toBe('Coach Morales');
    expect(rec.timingStation).toBe('START_FINISH');
  });

  it('prevents warmup-hijack and keeps same-day meet doubles cleanly separate', () => {
    const swRace1600 = synthesizeTracksideRaceActivity({
      runnerId: 'ath-1',
      runnerName: 'Devon Carter',
      eventLabel: '1600m',
      eventDistanceMeters: 1600,
      lapSplitDistanceMeters: 400,
      lapSplitsSecs: [64.1, 65.0, 65.2, 62.1],
      netTotalSecs: 256.4,
      dateIso: '2026-04-18',
      startDateLocalIso: '2026-04-18T14:30:00',
      includeWarmupCooldown: false,
    });

    // 1. Pre-race warmup ending before race start (non-overlapping) AND named Warmup -> rejected
    const warmupWatch = makeWatchActivity({
      id: 'garmin-warmup',
      name: 'Pre-Race Warmup Jog',
      startDateLocal: '2026-04-18T13:55:00',
      movingTimeSecs: 1200,
      distanceMeters: 3200,
      avgPaceSecsPerKm: 375,
    });
    expect(isStopwatchWearableSameSessionMatch(warmupWatch, swRace1600)).toBe(false);

    // 2. Overlapping activity still named Cool-Down -> rejected
    const namedCooldownOverlapping = makeWatchActivity({
      id: 'garmin-cd',
      name: 'Cool-Down Shakeout',
      startDateLocal: '2026-04-18T14:30:00',
      movingTimeSecs: 260,
      distanceMeters: 1600,
      avgPaceSecsPerKm: 162,
    });
    expect(isStopwatchWearableSameSessionMatch(namedCooldownOverlapping, swRace1600)).toBe(false);

    // 3. Long run >2.5x duration and >2.0x distance with >20% slower pace (no stream) -> rejected
    const slowLongWatch = makeWatchActivity({
      id: 'garmin-long-jog',
      name: 'Afternoon Run',
      startDateLocal: '2026-04-18T14:20:00',
      movingTimeSecs: 1800,
      distanceMeters: 4500,
      avgPaceSecsPerKm: 400,
    });
    expect(isStopwatchWearableSameSessionMatch(slowLongWatch, swRace1600)).toBe(false);

    // 4. Genuine race recording overlaps cleanly
    const trueWatchRace = makeWatchActivity({
      id: 'garmin-true-1600',
      name: 'Afternoon Run',
      startDateLocal: '2026-04-18T14:29:56',
      movingTimeSecs: 258,
      distanceMeters: 1605,
      avgPaceSecsPerKm: 161,
    });
    expect(isStopwatchWearableSameSessionMatch(trueWatchRace, swRace1600)).toBe(true);

    // 5. Meet double (800m at 11:00 AM + 1600m at 2:30 PM) NEVER collapses even when FAT sync stamps 09:00:00 on both
    const fat800 = synthesizeOfficialRaceActivity({
      id: 'ext-meet-800',
      date: '2026-04-18',
      startDateLocalIso: '2026-04-18T09:00:00',
      meetName: 'Woody Wilson',
      eventLabel: '800m',
      eventDistanceMeters: 800,
      fatTimeSecs: 115.2,
      displayFatTime: '1:55.20',
      platform: 'Athletic.net',
      trackType: 'OUTDOOR_400M',
      lapSplitDistanceMeters: 400,
      lapSplitsSecs: [],
      preserveEmptySplits: true,
      splitsEstimated: true,
      includeWarmupCooldown: false,
    });
    const fat1600 = synthesizeOfficialRaceActivity({
      id: 'ext-meet-1600',
      date: '2026-04-18',
      startDateLocalIso: '2026-04-18T09:00:00',
      meetName: 'Woody Wilson',
      eventLabel: '1600m',
      eventDistanceMeters: 1600,
      fatTimeSecs: 256.4,
      displayFatTime: '4:16.40',
      platform: 'Athletic.net',
      trackType: 'OUTDOOR_400M',
      lapSplitDistanceMeters: 400,
      lapSplitsSecs: [],
      preserveEmptySplits: true,
      splitsEstimated: true,
      includeWarmupCooldown: false,
    });

    const sw800 = synthesizeTracksideRaceActivity({
      runnerId: 'ath-1',
      runnerName: 'Devon Carter',
      eventLabel: '800m',
      eventDistanceMeters: 800,
      lapSplitDistanceMeters: 400,
      lapSplitsSecs: [56.9, 58.5],
      netTotalSecs: 115.4,
      dateIso: '2026-04-18',
      startDateLocalIso: '2026-04-18T11:00:00',
      includeWarmupCooldown: false,
    });

    const doubleMerged = mergeActivitiesNonDestructive([fat800, fat1600], [sw800, swRace1600]);
    expect(doubleMerged).toHaveLength(2);
    const merged800 = doubleMerged.find((a) => a.officialRaceData?.eventDistanceMeters === 800)!;
    const merged1600 = doubleMerged.find((a) => a.officialRaceData?.eventDistanceMeters === 1600)!;
    expect(merged800.officialRaceData?.lapSplitsSecs).toEqual([56.9, 58.5]);
    expect(merged1600.officialRaceData?.lapSplitsSecs).toEqual([64.1, 65.0, 65.2, 62.1]);
  });

  it('reconciles 3-layer Official FAT + Stopwatch + Watch into 1 consolidated activity in all 6 orders and auto-upgrades self-logged placeholders', () => {
    const fatAct = synthesizeOfficialRaceActivity({
      id: 'ext-meet-arcadia-800',
      date: '2026-04-18',
      startDateLocalIso: '2026-04-18T09:00:00',
      meetName: 'Arcadia Invitational',
      eventLabel: '800m',
      eventDistanceMeters: 800,
      fatTimeSecs: 115.18,
      displayFatTime: '1:55.18',
      placeFinish: '1st (Invite)',
      platform: 'Athletic.net',
      trackType: 'OUTDOOR_400M',
      lapSplitDistanceMeters: 400,
      lapSplitsSecs: [],
      preserveEmptySplits: true,
      splitsEstimated: true,
      includeWarmupCooldown: false,
      sourceUrl: 'https://www.athletic.net/result/999',
    });

    const swBase = synthesizeTracksideRaceActivity({
      runnerId: 'ath-1',
      runnerName: 'Devon Carter',
      sessionTitle: 'Arcadia Invitational',
      eventLabel: '800m',
      eventDistanceMeters: 800,
      lapSplitDistanceMeters: 400,
      lapSplitsSecs: [56.84, 58.56],
      netTotalSecs: 115.4,
      dateIso: '2026-04-18',
      startDateLocalIso: '2026-04-18T14:22:00',
      includeWarmupCooldown: false,
    });
    const swAct: UnifiedActivity = {
      ...swBase,
      sourceBadges: ['MeetReady Stopwatch', 'Hand-Timed'],
      officialRaceData: {
        ...swBase.officialRaceData!,
        platform: 'MeetReady Stopwatch',
        timingMethod: 'HAND',
        handTimedTotalSecs: 115.4,
        capturedByName: 'Coach Morales',
        timingStation: '200M_MARK',
      },
    };

    const watchAct = makeWatchActivity({
      id: 'garmin-800-arcadia',
      startDateLocal: '2026-04-18T14:21:55',
      movingTimeSecs: 118,
      distanceMeters: 804,
      avgPaceSecsPerKm: 147,
      trainingLoad: 29,
      avgHr: 184,
      maxHr: 198,
    });

    const items: UnifiedActivity[] = [fatAct, swAct, watchAct];
    const permutations = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];

    for (const [i, j, k] of permutations) {
      const step1 = mergeActivitiesNonDestructive([items[i]], [items[j]]);
      const step2 = mergeActivitiesNonDestructive(step1, [items[k]]);
      expect(step2).toHaveLength(1);
      const u = step2[0];
      expect(u.id).toBe('garmin-800-arcadia');
      expect(u.trainingLoad).toBe(29);
      expect(u.avgHr).toBe(184);
      expect(u.name).toContain('800m Official Race (1:55.18)');
      expect(u.officialRaceData?.platform).toBe('Athletic.net');
      expect(u.officialRaceData?.fatTimeSecs).toBe(115.18);
      expect(u.officialRaceData?.placeFinish).toBe('1st (Invite)');
      expect(u.officialRaceData?.timingMethod).toBe('FAT');
      expect(u.officialRaceData?.handTimedTotalSecs).toBe(115.4);
      expect(u.officialRaceData?.lapSplitsSecs).toEqual([56.84, 58.56]);
      expect(u.officialRaceData?.splitsEstimated).toBe(false);
      expect(u.officialRaceData?.capturedByName).toBe('Coach Morales');
      expect(u.officialRaceData?.timingStation).toBe('200M_MARK');
      expect(u.sourceBadges).toEqual(expect.arrayContaining(['Athletic.net', 'Hand-Timed', 'Garmin']));
    }

    // Watchless self-logged placeholder auto-upgrades to real watch running activity on same calendar date
    const selfLogged: UnifiedActivity = {
      id: 'self-logged-2026-04-15-plan-1',
      startDateLocal: '2026-04-15T12:00:00',
      name: 'Easy 6mi Aerobic',
      sportCategory: 'Running',
      environment: 'OUTDOOR',
      subType: 'Road',
      movingTimeSecs: 2700,
      distanceMeters: 9656,
      elevationGainMeters: 0,
      trainingLoad: 55,
      avgHr: 0,
      maxHr: 0,
      aerobicDecouplingPct: 0,
      efficiencyFactor: 0,
      firstHalfEf: 0,
      secondHalfEf: 0,
      deviceName: 'Self-Logged',
      zoneSecs: { hr: [0, 0, 0, 0, 0, 0, 0] },
      stravaPrCount: 0,
      segmentEfforts: [],
      quickLog: { rpe: 5, feelRating: 'STRONG', loggedAt: '2026-04-15T12:05:00Z' },
      sourceBadges: ['Self-Logged'],
    };
    const watchSameDate = makeWatchActivity({
      id: 'strava-run-0415',
      stravaId: '77441122',
      startDateLocal: '2026-04-15T16:10:00',
      name: 'Evening Shakeout',
      movingTimeSecs: 2640,
      distanceMeters: 9710,
      trainingLoad: 61,
      avgHr: 146,
      sourceBadges: ['Strava'],
    });

    for (const ordered of [
      mergeActivitiesNonDestructive([selfLogged], [watchSameDate]),
      mergeActivitiesNonDestructive([watchSameDate], [selfLogged]),
    ]) {
      expect(ordered).toHaveLength(1);
      expect(ordered[0].id).toBe('strava-run-0415');
      expect(ordered[0].trainingLoad).toBe(61);
      expect(ordered[0].quickLog?.rpe).toBe(5);
      expect(ordered[0].sourceBadges).not.toContain('Self-Logged');
      expect(ordered[0].sourceBadges).toContain('Strava');
    }
  });
});
