import type { CuratedMeetAlbumLink } from './commsAndEvents.ts';

export type MeetPriorityTier = 'DUAL_TRAINING_THROUGH' | 'INVITATIONAL_B' | 'CHAMPIONSHIP_A';

export type TrackSplitTimingContext =
  | 'OPEN_FAT'
  | 'HAND_CONVERTED'
  | 'RELAY_LEADOFF'
  | 'RELAY_FLYING';

export type DelegatedTimingStation =
  | 'START_FINISH'
  | '200M_MARK'
  | '100M_MARK'
  | 'RELAY_ZONE'
  | 'CUSTOM';

export interface DelegatedHandSplitCaptureSummary {
  submissionId?: string;
  capturedByName: string;
  stationType: DelegatedTimingStation;
  totalSecs: number;
  lapSplitsSecs: number[];
  capturedAt: string;
}

export type MeetSeedingAuthority = 'EXTERNAL_MEET' | 'HOST_DUAL_MEET';

export type MeetAssignmentSource =
  | 'UNASSIGNED'
  | 'IMPORTED_HYTEK'
  | 'IMPORTED_ATHLETICLIVE'
  | 'CLERK_OVERRIDE'
  | 'LOCAL_HOST_SEED';

export interface MeetDayPacketEntryRecord {
  id: string;
  athleteName: string;
  membershipId?: string;
  genderDivision?: 'M' | 'F' | 'NONBINARY';
  division?: string;
  graduationYear?: number;
  eventCode: string;
  seedMarkRaw: string;
  relayTeamCode?: string;
  relayLegOrder?: 1 | 2 | 3 | 4;
  isAlternate?: boolean;
  scratched?: boolean;
  officialHeat?: number;
  officialLaneOrHip?: string;
  officialFlight?: number;
  officialOrder?: number;
  eventStartTime?: string;
  checkInCallTime?: string;
  bibNumber?: string;
  assignmentSource?: MeetAssignmentSource;
}

export interface MeetDayPacketRecord {
  packetId: string;
  eventId?: string;
  meetTitle: string;
  meetDate: string;
  laneCount: number;
  flightSize: number;
  partitionByDivision: boolean;
  seedingAuthority?: MeetSeedingAuthority;
  athleticLiveUrl?: string;
  liveResultsUrl?: string;
  liveResultsLabel?: string;
  curatedAlbumLinks?: CuratedMeetAlbumLink[];
  meetDelayMinutes?: number;
  entries: MeetDayPacketEntryRecord[];
  updatedAt: string;
  updatedByName?: string;
}

export interface DelegatedTimingRunner {
  entryKey: string;
  membershipId?: string;
  displayName: string;
  hipOrLane?: string;
  targetSplitSecs?: number;
  isWalkOn?: boolean;
}

export interface DelegatedTimingSessionRecord {
  sessionId: string;
  teamId: string;
  eventId?: string;
  passCode: string;
  meetTitle: string;
  meetDate: string;
  eventCode: string;
  eventLabel: string;
  heatLabel?: string;
  stationType: DelegatedTimingStation;
  stationLabel: string;
  splitPlanLabel: string;
  targetSplitMeters: number;
  targetLapCount: number;
  runners: DelegatedTimingRunner[];
  assignedMembershipId?: string;
  assignedDelegateName?: string;
  createdBySid: string;
  createdByName: string;
  expiresAt: string;
  revokedAt?: string;
  pinRequired?: boolean;
  createdAt: string;
}

export interface DelegatedSplitSubmissionEntry {
  entryKey: string;
  membershipId?: string;
  athleteName: string;
  hipOrLane?: string;
  totalSecs: number;
  lapSplitsSecs: number[];
  rawLapTimestampsSecs: number[];
  isWalkOn?: boolean;
}

export type DelegatedSubmissionReviewStatus =
  | 'PENDING_COACH_APPROVAL'
  | 'APPROVED'
  | 'BACKUP_ARCHIVED'
  | 'DISCARDED';

export interface DelegatedSplitSubmissionRecord {
  submissionId: string;
  sessionId: string;
  teamId: string;
  eventId?: string;
  clientSubmissionId: string;
  meetTitle: string;
  meetDate: string;
  eventCode: string;
  eventLabel: string;
  heatLabel?: string;
  stationType: DelegatedTimingStation;
  capturedByName: string;
  capturedByMembershipId?: string;
  gunStartEpochMs?: number;
  submittedAt: string;
  entries: DelegatedSplitSubmissionEntry[];
  reviewStatus: DelegatedSubmissionReviewStatus;
  reviewedAt?: string;
  reviewedByName?: string;
}

export interface PublicDelegatedTimingPassPayload {
  found: boolean;
  expiredOrRevoked?: boolean;
  pinRequired?: boolean;
  pinVerified?: boolean;
  teamShortName?: string;
  teamName?: string;
  session?: {
    sessionId: string;
    teamId: string;
    passCode: string;
    meetTitle: string;
    meetDate: string;
    eventCode: string;
    eventLabel: string;
    heatLabel?: string;
    stationType: DelegatedTimingStation;
    stationLabel: string;
    splitPlanLabel: string;
    targetSplitMeters: number;
    targetLapCount: number;
    runners: DelegatedTimingRunner[];
    expiresAt: string;
  };
}

export interface AthleteOwnMeetScheduleItem {
  packetId: string;
  meetTitle: string;
  meetDate: string;
  eventCode: string;
  seedMarkRaw: string;
  division?: string;
  genderDivision?: 'M' | 'F' | 'NONBINARY';
  relayTeamCode?: string;
  relayLegOrder?: 1 | 2 | 3 | 4;
  isAlternate?: boolean;
  scratched?: boolean;
  officialHeat?: number;
  officialLaneOrHip?: string;
  officialFlight?: number;
  officialOrder?: number;
  eventStartTime?: string;
  checkInCallTime?: string;
  bibNumber?: string;
  assignmentSource?: MeetAssignmentSource;
  athleticLiveUrl?: string;
  meetDelayMinutes?: number;
  athleteName?: string;
  membershipId?: string;
}
