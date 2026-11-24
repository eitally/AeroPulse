import type { CoachEventGroup } from './scholastic.ts';
import type { TeamMemberRole } from './team.ts';

export type TeamAnnouncementCategory =
  | 'WEATHER'
  | 'SCHEDULE_CHANGE'
  | 'MEET_LOGISTICS'
  | 'GENERAL';

export interface TeamAnnouncementRecord {
  id: string;
  teamId: string;
  title: string;
  body: string;
  category: TeamAnnouncementCategory;
  targetEventGroups?: CoachEventGroup[];
  publishToParentHub: boolean;
  authorName: string;
  createdAt: string;
}

export type TeamMessageChannelScope =
  | 'ALL_TEAM'
  | 'EVENT_GROUP'
  | 'PARENTS_ONLY'
  | 'CUSTOM_SUBGROUP'
  | 'COACHES_STAFF'
  | 'DIRECT_TRANSPARENT';

export interface TeamCustomSubgroup {
  id: string;
  name: string;
  description?: string;
  memberIds: string[];
  includeLinkedParents?: boolean;
  createdByMembershipId: string;
  createdByName: string;
  createdAt: string;
}

export interface TeamMessageRecord {
  id: string;
  teamId: string;
  channelId: string;
  channelScope: TeamMessageChannelScope;
  eventGroup?: CoachEventGroup;
  customSubgroupId?: string;
  customSubgroupName?: string;
  targetMembershipId?: string;
  targetAthleteName?: string;
  senderSid: string;
  senderMembershipId: string;
  senderName: string;
  senderRole: TeamMemberRole;
  body: string;
  createdAt: string;
  guardianCcApplied: boolean;
  guardianEmailNotified?: boolean;
  emailFallbackCount?: number;
  secondAdultVisible: boolean;
  sentDuringQuietHours?: boolean;
  isEmergencyOverride?: boolean;
  acknowledgedByMembershipIds?: string[];
  flaggedForAdminReview?: boolean;
  flaggedReason?: string;
}

export interface TeamMessagingPolicy {
  athleteRepliesEnabled: boolean;
  parentRepliesEnabled?: boolean;
  enablePushEmailFallback?: boolean;
  quietHoursStartHour: number;
  quietHoursEndHour: number;
  requireGuardianCcForMinors: boolean;
}

export interface WebPushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface StoredWebPushSubscription {
  id: string;
  userSid: string;
  endpoint: string;
  keys: WebPushSubscriptionKeys;
  userAgent?: string;
  createdAt: string;
  updatedAt: string;
  enabled: boolean;
  muteQuietHours?: boolean;
}

export interface PushDispatchPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  isEmergency?: boolean;
}

export type TeamEventType = 'PRACTICE' | 'MEET' | 'BUS_TRAVEL' | 'TEAM_MEETING';

export type TeamEventVisibilityScope =
  | 'TEAM_AND_FAMILIES_ONLY'
  | 'PUBLIC_HUB'
  | 'STAFF_ONLY';

export type CuratedMeetAlbumProvider =
  | 'GOOGLE_PHOTOS'
  | 'APPLE_ICLOUD'
  | 'SMUGMUG'
  | 'SHUTTERFLY'
  | 'HUDL'
  | 'OTHER';

export interface CuratedMeetAlbumLink {
  id: string;
  label: string;
  url: string;
  provider?: CuratedMeetAlbumProvider;
  visibility: 'TEAM_AND_FAMILIES_ONLY' | 'PUBLIC_HUB';
  addedByName?: string;
  addedAt: string;
}

export type TeamEventRsvpStatus =
  | 'GOING'
  | 'OUT'
  | 'LATE'
  | 'MEET_CONFLICT'
  | 'UNDECIDED';

export type TeamEventTravelMode = 'TEAM_BUS' | 'PARENT_PICKUP' | 'SELF_TRAVEL';

export interface TeamEventRsvpRecord {
  eventId: string;
  membershipId: string;
  status: TeamEventRsvpStatus;
  note?: string;
  travelMode?: TeamEventTravelMode;
  updatedByRole: TeamMemberRole;
  updatedAt: string;
}

export interface TeamEventRsvpCounts {
  going: number;
  out: number;
  late: number;
  conflict: number;
  undecided: number;
}

export interface TeamEventRecord {
  eventId: string;
  teamId: string;
  eventType: TeamEventType;
  title: string;
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  timezone?: string;
  locationName?: string;
  venueId?: string;
  busDepartureTime?: string;
  busReturnTime?: string;
  meetDelayMinutes?: number;
  liveResultsUrl?: string;
  liveResultsLabel?: string;
  curatedAlbumLinks?: CuratedMeetAlbumLink[];
  targetEventGroups?: CoachEventGroup[];
  visibilityScope: TeamEventVisibilityScope;
  broadcastId?: string;
  packetId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamEventsOverviewPayload {
  events: TeamEventRecord[];
  rsvpCountsByEventId: Record<string, TeamEventRsvpCounts>;
  myRsvps: TeamEventRsvpRecord[];
  rsvpsByEventId?: Record<string, TeamEventRsvpRecord[]>;
}
